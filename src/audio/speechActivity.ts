import type { SessionTime } from "../domain/types";

/**
 * Lightweight local speech-activity context (PRD FR-005A).
 * Energy-only: no model, no transcription, never used to infer emotion or intent.
 */
export const SPEECH = {
  /** Polling interval for the analyser, in ms. */
  SAMPLE_MS: 50,
  /** RMS must stay above threshold this long before we call it speech. */
  ONSET_MS: 150,
  /** RMS must stay below the release threshold this long before we call it a pause. */
  RELEASE_MS: 400,
  /** Speech threshold = noise floor × this factor ... */
  FLOOR_FACTOR: 3,
  /** ... but never below this absolute RMS (float samples, -1..1). */
  MIN_THRESHOLD: 0.01,
  /** While speaking, drop below threshold × this to count as silence (hysteresis). */
  RELEASE_RATIO: 0.8,
  /** Per-sample floor adaptation when the level rises (slow; only while not speaking). */
  FLOOR_RISE: 0.02,
  /** Per-sample floor adaptation when the level falls (fast; quieter = truer floor). */
  FLOOR_FALL: 0.2,
  /** Analyser FFT size (time-domain window length). */
  FFT_SIZE: 2048,
} as const;

export type ActivityState = "speaking" | "pause";
export interface ActivityTransition {
  state: ActivityState;
  t: SessionTime;
}

/** Pure, deterministic voice-activity detector with onset/release hysteresis and an adaptive noise floor. */
export class SpeechActivityDetector {
  private _state: ActivityState = "pause";
  private floor: number | null = null;
  private aboveSince: SessionTime | null = null;
  private belowSince: SessionTime | null = null;

  get state(): ActivityState {
    return this._state;
  }

  private threshold(): number {
    return Math.max(SPEECH.MIN_THRESHOLD, (this.floor ?? 0) * SPEECH.FLOOR_FACTOR);
  }

  /** Feed one RMS sample. Returns a transition only when the state changes; t is when the change began. */
  push(t: SessionTime, rms: number): ActivityTransition | null {
    if (!Number.isFinite(rms) || rms < 0) rms = 0;
    if (this.floor === null) this.floor = rms;

    if (this._state === "pause") {
      // Adapt the noise floor only while not speaking: fall fast, rise slowly.
      const a = rms < this.floor ? SPEECH.FLOOR_FALL : SPEECH.FLOOR_RISE;
      this.floor += (rms - this.floor) * a;

      if (rms >= this.threshold()) {
        if (this.aboveSince === null) this.aboveSince = t;
        if (t - this.aboveSince >= SPEECH.ONSET_MS) {
          const start = this.aboveSince;
          this._state = "speaking";
          this.aboveSince = null;
          this.belowSince = null;
          return { state: "speaking", t: start };
        }
      } else {
        this.aboveSince = null;
      }
      return null;
    }

    // Speaking: floor frozen; require a sustained drop below the release threshold.
    if (rms < this.threshold() * SPEECH.RELEASE_RATIO) {
      if (this.belowSince === null) this.belowSince = t;
      if (t - this.belowSince >= SPEECH.RELEASE_MS) {
        const start = this.belowSince;
        this._state = "pause";
        this.belowSince = null;
        this.aboveSince = null;
        return { state: "pause", t: start };
      }
    } else {
      this.belowSince = null;
    }
    return null;
  }
}

/**
 * Taps the Source's audio track (no playback) and reports speaking/pause transitions.
 * Returns null when the stream has no audio track; otherwise a stop() function.
 */
export function attachSpeechActivity(
  stream: MediaStream,
  getT: () => SessionTime,
  onChange: (state: ActivityState, t: SessionTime) => void,
): (() => void) | null {
  const track = stream.getAudioTracks()[0];
  if (!track) return null;

  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  // Analyse only the audio track; never connect to ctx.destination (no playback).
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = SPEECH.FFT_SIZE;
  source.connect(analyser);
  void ctx.resume().catch(() => {});

  const buf = new Float32Array(analyser.fftSize);
  const detector = new SpeechActivityDetector();

  // setInterval (not rAF) so it keeps running while the tab is hidden.
  const id = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const change = detector.push(getT(), Math.sqrt(sum / buf.length));
    if (change) onChange(change.state, change.t);
  }, SPEECH.SAMPLE_MS);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(id);
    source.disconnect();
    void ctx.close().catch(() => {});
  };
}

/** Moved to rules/pauses.ts so rules/ never imports from audio/; re-exported here for compatibility. */
export { isThinkingPause, inOpenPause } from "../rules/pauses";
