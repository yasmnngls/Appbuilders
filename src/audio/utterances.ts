import type { SessionTime, Speaker } from "../domain/types";
import { SPEECH, SpeechActivityDetector } from "./speechActivity";

/**
 * Utterance capture for local speech recognition.
 *
 * Audio track → 16 kHz mono → voice-activity segmentation → one utterance at a time to transcribe().
 * PCM lives only in memory until its utterance is transcribed (or dropped); nothing is stored, and the
 * interview is never transcribed twice.
 */

export const ASR_RATE = 16_000;

export const UTTERANCE = {
  /** Audio kept before the detected onset, so first syllables aren't clipped. */
  PRE_ROLL_MS: 300,
  /** Audio kept after speech ends (taken from the detector's release window). Must be ≤ SPEECH.RELEASE_MS. */
  POST_ROLL_MS: 300,
  /** Longest utterance sent in one request; longer speech is cut and continues as a new utterance. */
  MAX_MS: 15_000,
  /** Speech shorter than this is dropped (coughs, clicks, "mm"). */
  MIN_MS: 500,
  /** Most utterances waiting for transcription per stream; beyond this the oldest is dropped. */
  MAX_PENDING: 3,
} as const;

/** Frame length used for the VAD: the same cadence the energy detector was tuned for. */
const FRAME_MS = SPEECH.SAMPLE_MS;
const FRAME_SAMPLES = (ASR_RATE * FRAME_MS) / 1000;

// ---------------------------------------------------------------------------
// Downsampling

/**
 * Streaming box-filter resampler to 16 kHz. Keeps the fractional read position and unread samples between
 * chunks so chunk boundaries never drop or duplicate samples.
 */
export class Downsampler {
  private readonly ratio: number;
  private carry: Float32Array = new Float32Array(0);
  private pos = 0;

  constructor(inRate: number, outRate: number = ASR_RATE) {
    if (!(inRate > 0) || !(outRate > 0)) throw new Error("Invalid sample rate");
    this.ratio = inRate / outRate;
  }

  push(chunk: Float32Array): Float32Array {
    const buf = new Float32Array(this.carry.length + chunk.length);
    buf.set(this.carry);
    buf.set(chunk, this.carry.length);
    const r = this.ratio;
    const out = new Float32Array(Math.max(0, Math.floor((buf.length - this.pos) / r) + 1));
    let n = 0;
    let pos = this.pos;
    while (pos + r <= buf.length + 1e-9) {
      const a = Math.floor(pos);
      const b = Math.max(a + 1, Math.min(buf.length, Math.floor(pos + r)));
      let sum = 0;
      for (let i = a; i < b; i++) sum += buf[i];
      out[n++] = sum / (b - a);
      pos += r;
    }
    const used = Math.min(buf.length, Math.floor(pos));
    this.carry = buf.slice(used);
    this.pos = pos - used;
    return out.slice(0, n);
  }
}

/** One-shot downsample of a whole buffer to 16 kHz mono. */
export function downsampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === ASR_RATE) return input.slice();
  return new Downsampler(inRate).push(input);
}

// ---------------------------------------------------------------------------
// Segmentation

export interface Utterance {
  start: SessionTime;
  end: SessionTime;
  pcm: Float32Array;
}

interface Frame {
  t: SessionTime;
  pcm: Float32Array;
}

const rms = (x: Float32Array) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return x.length ? Math.sqrt(s / x.length) : 0;
};

function concat(frames: Frame[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.pcm.length, 0));
  let o = 0;
  for (const f of frames) {
    out.set(f.pcm, o);
    o += f.pcm.length;
  }
  return out;
}

/**
 * Cuts 16 kHz mono audio into utterances using the same energy VAD (thresholds, hysteresis, adaptive floor)
 * as the speech-activity context. Adds pre-roll and post-roll, cuts at MAX_MS, drops speech under MIN_MS.
 */
export class UtteranceSegmenter {
  private readonly vad = new SpeechActivityDetector();
  /** Recent frames while not in an utterance (for pre-roll). */
  private ring: Frame[] = [];
  /** Frames of the utterance being collected. */
  private cur: Frame[] | null = null;
  /** When speech in the current utterance began (onset, or the cut point). */
  private speechStart: SessionTime = 0;
  private pendingSamples = new Float32Array(0);
  private clock: SessionTime;

  constructor(startT: SessionTime = 0) {
    this.clock = startT;
  }

  /** True while the VAD considers this stream to be speaking. */
  get speaking(): boolean {
    return this.vad.state === "speaking";
  }

  /** Feed any number of 16 kHz samples; time advances by the internal clock (50 ms per frame). */
  pushSamples(samples: Float32Array): Utterance[] {
    const buf = new Float32Array(this.pendingSamples.length + samples.length);
    buf.set(this.pendingSamples);
    buf.set(samples, this.pendingSamples.length);
    const out: Utterance[] = [];
    let o = 0;
    for (; o + FRAME_SAMPLES <= buf.length; o += FRAME_SAMPLES) {
      out.push(...this.pushFrame(buf.slice(o, o + FRAME_SAMPLES), this.clock));
      this.clock += FRAME_MS;
    }
    this.pendingSamples = buf.slice(o);
    return out;
  }

  /** Feed one 50 ms frame (800 samples) starting at time t. */
  pushFrame(pcm: Float32Array, t: SessionTime): Utterance[] {
    const change = this.vad.push(t, rms(pcm));
    const frame: Frame = { t, pcm };

    if (!this.cur) {
      this.ring.push(frame);
      const keep = UTTERANCE.PRE_ROLL_MS + SPEECH.ONSET_MS + FRAME_MS;
      while (this.ring.length && this.ring[0].t < t - keep) this.ring.shift();
      if (change?.state === "speaking") {
        const from = change.t - UTTERANCE.PRE_ROLL_MS;
        this.cur = this.ring.filter((f) => f.t >= from);
        this.speechStart = change.t;
        this.ring = [];
      }
      return [];
    }

    this.cur.push(frame);
    if (change?.state === "pause") {
      const end = change.t + UTTERANCE.POST_ROLL_MS;
      const frames = this.cur.filter((f) => f.t < end);
      const speechMs = change.t - this.speechStart;
      this.cur = null;
      this.ring = [];
      return speechMs >= UTTERANCE.MIN_MS ? [this.emit(frames)] : [];
    }

    const frames = this.cur;
    if (frames[frames.length - 1].t + FRAME_MS - frames[0].t >= UTTERANCE.MAX_MS) {
      // Still speaking: cut here and continue as a new utterance.
      this.cur = [];
      this.speechStart = t + FRAME_MS;
      return [this.emit(frames)];
    }
    return [];
  }

  /** Stop: emits the utterance in progress if it is long enough. */
  flush(): Utterance[] {
    const frames = this.cur;
    this.cur = null;
    this.ring = [];
    if (!frames || !frames.length) return [];
    const end = frames[frames.length - 1].t + FRAME_MS;
    return end - this.speechStart >= UTTERANCE.MIN_MS ? [this.emit(frames)] : [];
  }

  private emit(frames: Frame[]): Utterance {
    return { start: frames[0].t, end: frames[frames.length - 1].t + FRAME_MS, pcm: concat(frames) };
  }
}

// ---------------------------------------------------------------------------
// Queue

/**
 * One request at a time per stream. If more than `maxPending` jobs wait, the oldest waiting job is dropped
 * (its PCM is released) so live transcription never falls further and further behind.
 */
export class TranscribeQueue<J> {
  private pending: J[] = [];
  private busy = false;
  private stopped = false;
  private abort = new AbortController();
  dropped = 0;

  constructor(
    private readonly run: (job: J, signal: AbortSignal) => Promise<void>,
    private readonly maxPending: number = UTTERANCE.MAX_PENDING,
  ) {}

  get size(): number {
    return this.pending.length;
  }

  get active(): boolean {
    return this.busy;
  }

  enqueue(job: J) {
    if (this.stopped) return;
    this.pending.push(job);
    while (this.pending.length > this.maxPending) {
      this.pending.shift();
      this.dropped++;
    }
    this.pump();
  }

  /** Aborts the request in flight and drops everything waiting. */
  stop() {
    this.stopped = true;
    this.pending = [];
    this.abort.abort();
  }

  private pump() {
    if (this.busy || this.stopped) return;
    const job = this.pending.shift();
    if (job === undefined) return;
    this.busy = true;
    let p: Promise<void>;
    try {
      p = this.run(job, this.abort.signal);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.catch(() => {}).finally(() => {
      this.busy = false;
      this.pump();
    });
  }
}

// ---------------------------------------------------------------------------
// Browser glue

export interface SpokenSegment {
  speaker: Speaker;
  start: SessionTime;
  end: SessionTime;
  text: string;
}

export interface UtterancePipeline {
  stop(): void;
  /** True while this stream's VAD hears speech right now. */
  speaking(): boolean;
}

/**
 * Taps the stream's audio track (never played back), segments utterances and transcribes them one at a time.
 * Returns null when the stream has no audio track or audio can't be tapped.
 */
export function attachUtterances(opts: {
  stream: MediaStream;
  speaker: Speaker;
  getT: () => SessionTime;
  transcribe: (pcm16k: Float32Array, signal?: AbortSignal) => Promise<string>;
  onSegment: (seg: SpokenSegment) => void;
  onError?: (e: unknown) => void;
}): UtterancePipeline | null {
  const track = opts.stream.getAudioTracks().find((t) => t.readyState === "live");
  if (!track) return null;

  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  // ScriptProcessor only runs when connected to the destination; a zero gain keeps it silent (no playback).
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);
  void ctx.resume().catch(() => {});

  const down = new Downsampler(ctx.sampleRate);
  let seg: UtteranceSegmenter | null = null;
  let stopped = false;

  const queue = new TranscribeQueue<Utterance>(async (u, signal) => {
    let text: string;
    try {
      text = (await opts.transcribe(u.pcm, signal)).trim();
    } catch (e) {
      if (!signal.aborted) opts.onError?.(e);
      return;
    } finally {
      u.pcm = new Float32Array(0); // release the audio as soon as it has been transcribed
    }
    if (stopped || !text || isNonSpeech(text)) return;
    opts.onSegment({ speaker: opts.speaker, start: u.start, end: u.end, text });
  });

  proc.onaudioprocess = (e) => {
    if (stopped) return;
    const input = e.inputBuffer.getChannelData(0);
    const samples = down.push(input);
    seg ??= new UtteranceSegmenter(Math.max(0, opts.getT() - (input.length / ctx.sampleRate) * 1000));
    for (const u of seg.pushSamples(samples)) queue.enqueue(u);
  };

  return {
    speaking: () => !stopped && !!seg?.speaking,
    stop() {
      if (stopped) return;
      // Transcribe the utterance in progress, but stop after that.
      for (const u of seg?.flush() ?? []) queue.enqueue(u);
      stopped = true;
      queue.stop();
      proc.onaudioprocess = null;
      try {
        source.disconnect();
        proc.disconnect();
        mute.disconnect();
      } catch {
        /* already disconnected */
      }
      void ctx.close().catch(() => {});
    },
  };
}

/** whisper.cpp marks non-speech as e.g. "[BLANK_AUDIO]", "(music)", "[ Silence ]". */
export function isNonSpeech(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const stripped = t.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, "").replace(/[\s.,!?♪-]/g, "");
  return stripped.length === 0;
}
