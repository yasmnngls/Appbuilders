import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { transcribe, whisperStatus } from "../asr/whisperClient";
import { attachSpeechActivity } from "../audio/speechActivity";
import { attachUtterances, type SpokenSegment, type UtterancePipeline } from "../audio/utterances";
import { hasAudio, micIdOf, openLocalVideo, openMic, openWebcam, openWindowCapture, shareAudioNotice, stopStream } from "../capture/source";
import { decideSpokenQuestion, looksLikeQuestion, shortLabel } from "../context/questions";
import { MAX_FOLLOW_UPS, type FollowUpState, type Moment, type Pause, type Session, type SessionTime } from "../domain/types";
import { fallbackSuggestion, writeSuggestion } from "../llm/moments";
import { checkOllama, currentModel, isLightweight, lastLatencyMs, onModelChange, warmUp } from "../llm/ollama";
import { fallbackReport, generateReport } from "../llm/report";
import { VISION } from "../rules/config";
import { RuleEngine } from "../rules/engine";
import { allowedActions, reduceFollowUp, type FollowUpEffect, type FollowUpEvent } from "../rules/followUp";
import { evaluateGate } from "../rules/gate";
import * as S from "../store/session";
import { sessionNow, store } from "../store/session";
import { createFaceLandmarker } from "../vision/faceTracker";
import { type CropRect, VisionPipeline } from "../vision/pipeline";

/** Wires capture → vision → rules → store → local LLM. Owns every timer, stream and async call; React only calls these. */

const TICK_MS = 250;
const BASELINE_READY_MS = 1_500;
const PAUSE_RING_MS = 120_000;

let landmarker: Promise<{ landmarker: FaceLandmarker; delegate: "GPU" | "CPU" }> | null = null;
let preloaded = false;

let stream: MediaStream | null = null;
let revokeVideo: (() => void) | null = null;
let detachSource: (() => void) | null = null;

let pipeline: VisionPipeline | null = null;
let engine: RuleEngine | null = null;
let crop: CropRect | null = null;
let loop: ReturnType<typeof setInterval> | null = null;
let stopSpeech: (() => void) | null = null;
let pauses: Pause[] = [];
let baselineTimer: ReturnType<typeof setTimeout> | null = null;

/** Aborted at Session end: cancels the in-flight and queued suggestions. */
let llmAbort: AbortController | null = null;
/** Suggestions run one at a time (one local LLM call at a time, §14A.4). */
let suggestionQueue: Promise<void> = Promise.resolve();
let reportAbort: AbortController | null = null;
let finishing = false;

/** The Interviewer's own mic (window/video Sources). The webcam's mic is part of `stream` (speaker "mixed"). */
let micStream: MediaStream | null = null;
let chosenMicId: string | null = null;
/** Utterance capture → local whisper.cpp. Started only while local speech recognition is available. */
let interviewerPipe: UtterancePipeline | null = null;
let candidatePipe: UtterancePipeline | null = null;
let asrPoll: ReturnType<typeof setInterval> | null = null;
/** When the Interviewer last clicked Ask Follow-up (an interviewer question right after it is the follow-up). */
let lastAskAt: SessionTime | null = null;
const ASR_POLL_MS = 15_000;

/** The latest raw landmarker result, read by the overlay each animation frame (kept out of React state). */
export const live: { result: FaceLandmarkerResult | null; crop: CropRect | null } = { result: null, crop: null };

export const video = typeof document === "undefined" ? (null as unknown as HTMLVideoElement) : document.createElement("video");
if (video) {
  video.muted = true;
  video.playsInline = true;
  video.className = "h-full w-full object-contain";
}

const uid = () => Math.random().toString(36).slice(2, 10);
const isLive = () => {
  const s = store.get().session;
  return !!s && s.endedAt === null;
};

function syncLlm() {
  S.setLlm({ model: currentModel(), latencyMs: lastLatencyMs(), lightweight: isLightweight() });
  applyFpsCap();
}

function applyFpsCap() {
  pipeline?.setMaxFps(isLightweight() ? VISION.lightweightMaxFps : VISION.maxFps);
}

// ---------------------------------------------------------------------------
// Preload, consent, Source preview

export function preload() {
  landmarker ??= createFaceLandmarker();
  landmarker
    .then(({ delegate }) => store.set({ vision: { status: "ready", delegate } }))
    .catch((e) => store.set({ vision: { status: "error", message: String(e) } }));
  if (preloaded) return;
  preloaded = true;
  checkOllama().then((ok) => {
    S.setLlm({ status: ok ? "ready" : "unavailable", model: currentModel() });
    if (ok) warmUp().catch(() => {});
  });
  onModelChange(() => syncLlm());
  const syncOnline = () => store.set({ online: navigator.onLine });
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
}

export function confirmConsent(candidateName: string) {
  S.confirmConsent(candidateName);
}

/** Screen 2: opens a Source and shows it in the shared <video>. Replaces any previously open Source. */
export async function openSource(kind: Session["source"], file?: File): Promise<void> {
  // FR-001: no camera, window or file is opened before Consent is confirmed.
  if (!store.get().draft) throw new Error("Confirm Consent first.");
  closeSource();
  const onEnded = () => {
    if (isLive()) void finish();
    else closeSource();
  };
  if (kind === "video") {
    if (!file) throw new Error("Choose a video file first.");
    video.srcObject = null;
    video.loop = false;
    const opened = await openLocalVideo(video, file);
    stream = opened.stream;
    revokeVideo = opened.revoke;
    video.addEventListener("ended", onEnded);
    detachSource = () => video.removeEventListener("ended", onEnded);
  } else {
    const s = kind === "webcam" ? await openWebcam(chosenMicId ?? undefined) : await openWindowCapture();
    stream = s;
    const track = s.getVideoTracks()[0];
    track?.addEventListener("ended", onEnded);
    detachSource = () => track?.removeEventListener("ended", onEnded);
    video.srcObject = s;
  }
  const opened = stream;
  await video.play().catch(() => {});
  // The Source can end (or be replaced) while play() is pending; don't show a preview that is gone.
  if (stream !== opened || (kind !== "video" && !opened?.getVideoTracks().some((t) => t.readyState === "live")))
    throw new Error("The source stopped before the preview started. Try again.");
  // Interviewer mic: separate for a shared meeting or a file; the webcam's own mic is shared ("mixed").
  if (kind !== "webcam") {
    const mic = await openMic(chosenMicId ?? undefined);
    if (stream !== opened) {
      stopStream(mic);
      throw new Error("The source stopped before the preview started. Try again.");
    }
    micStream = mic;
  }
  publishSourceReady(kind);
  void refreshAsr();
}

function publishSourceReady(kind: Session["source"]) {
  const shared = kind === "window" && stream ? shareAudioNotice(stream) : null;
  const notice = kind === "video" && !hasAudio(stream) ? "This video file has no audio track, so the Candidate can't be transcribed." : shared;
  S.setSourceReady({
    kind,
    hasAudio: hasAudio(stream),
    mic: kind === "webcam" ? hasAudio(stream) : hasAudio(micStream),
    interviewAudio: kind !== "webcam" && hasAudio(stream),
    notice,
  });
}

/** Checks local speech recognition (never throws) and records it; starts listening if a Session is live. */
async function refreshAsr() {
  const st = await whisperStatus();
  S.setAsr(st);
  if (st.available && isLive()) startListening();
}

/** Screen 2: switch the Interviewer microphone (preview only). */
export async function setMic(deviceId: string): Promise<void> {
  const ready = store.get().sourceReady;
  if (!ready || isLive()) return;
  chosenMicId = deviceId || null;
  const mic = await openMic(deviceId || undefined);
  if (!mic) return;
  if (ready.kind === "webcam" && stream) {
    // One shared mic: swap the webcam stream's audio track.
    stream.getAudioTracks().forEach((t) => {
      t.stop();
      stream?.removeTrack(t);
    });
    mic.getAudioTracks().forEach((t) => stream?.addTrack(t));
  } else {
    stopStream(micStream);
    micStream = mic;
  }
  publishSourceReady(ready.kind);
}

/** The mic device currently in use (for the Screen 2 dropdown). */
export const currentMicId = (): string | null => {
  const kind = store.get().sourceReady?.kind;
  return micIdOf(kind === "webcam" ? stream : micStream) ?? chosenMicId;
};

/** Back/cancel on Screen 2, and part of finish(): stops the stream and releases the file. */
export function closeSource() {
  detachSource?.();
  detachSource = null;
  stopStream(stream);
  stream = null;
  stopStream(micStream);
  micStream = null;
  video.pause();
  video.srcObject = null;
  if (revokeVideo) {
    video.removeAttribute("src");
    video.load();
    revokeVideo();
    revokeVideo = null;
  }
  if (store.get().sourceReady) S.setSourceReady(null);
}

// ---------------------------------------------------------------------------
// Session start: Session + pipeline + speech + gate loop

export function startBaseline() {
  const ready = store.get().sourceReady;
  // FR-001: observation never starts without Consent confirmed for this Session.
  if (!ready || isLive() || !store.get().draft) return;
  finishing = false;
  pauses = [];
  llmAbort = new AbortController();
  suggestionQueue = Promise.resolve();

  // Speech context (FR-005A): null = no audio track → stricter visual-only thresholds.
  const startT = Date.now();
  stopSpeech = stream ? attachSpeechActivity(stream, () => (store.get().session ? sessionNow() : Date.now() - startT), onSpeech) : null;
  const asr = store.get().asrStatus ?? { available: false, model: null };
  if (!S.startSession({ source: ready.kind, speechAvailable: stopSpeech !== null, llmModel: currentModel(), asr })) {
    stopSpeech?.();
    stopSpeech = null;
    return;
  }
  S.setSpeech(stopSpeech ? "pause" : "unavailable");
  lastAskAt = null;
  if (asr.available) startListening();
  // Re-check local speech recognition now, then every 15 s while it is off (it can be started mid-Session).
  void refreshAsr();
  asrPoll = setInterval(() => {
    if (!store.get().session?.asr.available || !interviewerPipe && !candidatePipe) void refreshAsr();
  }, ASR_POLL_MS);

  engine = new RuleEngine();
  crop = null;
  live.crop = null;
  loop = setInterval(tick, TICK_MS);

  const session = store.get().session;
  void (landmarker ??= createFaceLandmarker()).then(({ landmarker: lm }) => {
    if (!isLive() || pipeline || store.get().session?.startedAt !== session?.startedAt) return;
    pipeline = new VisionPipeline({
      video,
      landmarker: lm,
      getSessionTime: sessionNow,
      onFrame: (signal, result) => {
        live.result = result;
        const e = engine;
        if (!e) return;
        S.applyTransitions(e.push(signal));
        const s = store.get().session;
        if (s && !s.baseline && e.currentBaseline) {
          S.setBaseline(e.currentBaseline);
          store.set({ baselineJustCompleted: true });
          if (baselineTimer) clearTimeout(baselineTimer);
          baselineTimer = setTimeout(() => store.set({ baselineJustCompleted: false }), BASELINE_READY_MS);
        }
        store.set({ latestSignal: signal, fps: pipeline?.fps ?? 0, baselineProgress: e.baselineProgress });
      },
    });
    pipeline.setCrop(crop);
    applyFpsCap();
    pipeline.start();
  }).catch((e) => store.set({ vision: { status: "error", message: String(e) } }));
}

// ---------------------------------------------------------------------------
// Listening: utterances → local transcript → spoken Questions

/** Starts utterance capture on the Interviewer mic and the interview audio (or the one shared webcam mic). Idempotent. */
function startListening() {
  const kind = store.get().session?.source;
  if (!kind || !isLive()) return;
  const common = { getT: sessionNow, transcribe, onSegment, onError: onAsrError };
  if (kind === "webcam") {
    interviewerPipe ??= stream ? attachUtterances({ ...common, stream, speaker: "mixed" }) : null;
  } else {
    interviewerPipe ??= micStream ? attachUtterances({ ...common, stream: micStream, speaker: "interviewer" }) : null;
    candidatePipe ??= stream ? attachUtterances({ ...common, stream, speaker: "candidate" }) : null;
  }
  S.setListening(!!(interviewerPipe || candidatePipe));
}

function stopListening() {
  interviewerPipe?.stop();
  candidatePipe?.stop();
  interviewerPipe = null;
  candidatePipe = null;
  if (asrPoll) clearInterval(asrPoll);
  asrPoll = null;
  S.setListening(false);
}

/** A failed request: re-check the server; if it went away, stop listening until the poll finds it again. */
let checkingAsr = false;
function onAsrError() {
  if (checkingAsr) return;
  checkingAsr = true;
  void whisperStatus()
    .then((st) => {
      if (!isLive()) return;
      S.setAsr(st);
      if (!st.available) {
        interviewerPipe?.stop();
        candidatePipe?.stop();
        interviewerPipe = candidatePipe = null;
        S.setListening(false);
      }
    })
    .finally(() => (checkingAsr = false));
}

/** True while the Candidate is speaking right now (interview audio, or the shared webcam mic). */
export function candidateSpeaking(): boolean {
  if (!isLive()) return false;
  if (candidatePipe?.speaking()) return true;
  if (store.get().session?.source === "webcam" && interviewerPipe?.speaking()) return true;
  return store.get().speech === "speaking";
}

/** One transcribed utterance → transcript + timeline; an Interviewer question may start (or name) a Question. */
function onSegment(seg: SpokenSegment) {
  const s = store.get().session;
  if (!s || s.endedAt !== null) return;
  if (seg.speaker === "candidate") {
    S.appendTranscript(seg, "candidate-speech");
    return;
  }
  const current = S.currentQuestion(s);
  const decision = decideSpokenQuestion({
    text: seg.text,
    speaker: seg.speaker,
    t: seg.start,
    current,
    phase: s.followUp.phase,
    lastAskAt,
    candidateSpokeInCurrent: s.transcript.some(
      (x) => x.questionId === current.id && (x.speaker === "candidate" || (x.speaker === "mixed" && !looksLikeQuestion(x.text))),
    ),
  });
  if (decision === "new") {
    const q = startQuestion(shortLabel(seg.text), { origin: "spoken", text: seg.text });
    S.appendTranscript({ ...seg, questionId: q?.id }, "interviewer-speech");
  } else if (decision === "relabel") {
    S.relabelQuestion(current.id, seg.text, shortLabel(seg.text));
    S.appendTranscript({ ...seg, questionId: current.id }, "interviewer-speech");
  } else {
    // Mixed (one shared mic): a question is the Interviewer; anything else is most likely the Candidate.
    const kind = seg.speaker === "mixed" && decision === "none" && !looksLikeQuestion(seg.text) ? "candidate-speech" : "interviewer-speech";
    S.appendTranscript(seg, kind);
  }
}

/** Feeds one transcribed utterance as if it came from the pipelines (tests and dev harness). */
export const ingestSegment = (seg: SpokenSegment) => onSegment(seg);

/** Speech transitions → status + the pauses ring (last 120 s, open pause last). */
function onSpeech(state: "speaking" | "pause", t: SessionTime) {
  if (state === "pause") {
    pauses = [...pauses.filter((p) => p.end !== null), { start: t, end: null }];
  } else {
    pauses = pauses.map((p) => (p.end === null ? { ...p, end: Math.max(p.start, t) } : p));
  }
  const cutoff = t - PAUSE_RING_MS;
  pauses = pauses.filter((p) => p.end === null || p.end >= cutoff);
  S.setSpeech(state);
}

/** Every 250 ms (setInterval keeps running in background tabs). */
function tick() {
  const s = store.get().session;
  if (!s || s.endedAt !== null) return;
  const now = sessionNow();
  dispatch({ type: "tick", t: now });

  const s2 = store.get().session!;
  const fu = s2.followUp;
  if (fu.phase !== "observing" && fu.phase !== "re_observing") return;
  const hit = evaluateGate({
    now,
    question: S.currentQuestion(s2),
    followUp: fu,
    flags: s2.flags,
    baselineReady: !!s2.baseline,
    speech: { available: s2.speechAvailable, pauses },
  });
  if (hit) dispatch({ type: "gate_hit", hit, momentId: uid(), t: now });
}

/** Runs one event through the follow-up reducer and applies its effects. */
function dispatch(e: FollowUpEvent) {
  const s = store.get().session;
  if (!s || s.endedAt !== null) return;
  const { state, effects } = reduceFollowUp(s.followUp, e);
  if (state === s.followUp && effects.length === 0) return;
  if (import.meta.env?.DEV) checkInvariants(state, e);

  for (const fx of effects) {
    if (fx.type === "open_moment") {
      const m = momentSkeleton(fx, state, e.t, s);
      if (m) {
        S.openMoment(m);
        requestSuggestion(m.id);
      }
    }
  }
  S.applyFollowUp(state, effects);
}

function momentSkeleton(fx: Extract<FollowUpEffect, { type: "open_moment" }>, fu: FollowUpState, t: SessionTime, s: Session): Moment | null {
  const flag = fx.flagId ? s.flags.find((f) => f.id === fx.flagId) : undefined;
  const kind = fx.hit?.kind ?? flag?.kind;
  if (!kind) return null;
  return {
    id: fx.momentId,
    questionId: fu.questionId,
    t,
    kind,
    origin: fx.hit ? "gate" : "interviewer",
    reason: fx.hit?.reason ?? "Opened by the Interviewer from a Flag",
    flagIds: fx.hit?.flagIds ?? (fx.flagId ? [fx.flagId] : []),
    followUpNumber: fx.followUpNumber,
    note: null,
    followUp: null,
    quality: null,
    suggestion: "generating",
    decision: "pending",
    askedAt: null,
    result: null,
  };
}

/**
 * Queues one suggestion. One call in flight at a time; aborted at Session end.
 * The Moment is always updated when text arrives, even if the Interviewer already acted or moved on.
 */
function requestSuggestion(momentId: string) {
  const signal = llmAbort?.signal;
  suggestionQueue = suggestionQueue.then(async () => {
    const s = store.get().session;
    const m = s?.moments.find((x) => x.id === momentId);
    if (!s || !m) return;
    S.setLlm({ status: store.get().llm === "unavailable" ? "unavailable" : "busy" });
    let sug;
    try {
      // The model is called once the Candidate's utterance ends, on the latest transcript.
      sug = signal?.aborted
        ? fallbackSuggestion(s, m)
        : await writeSuggestion(s, m, signal, { candidateSpeaking, latest: () => store.get().session });
    } catch {
      sug = fallbackSuggestion(s, m);
    }
    S.updateMoment(momentId, { note: sug.note, followUp: sug.followUp, quality: sug.quality, suggestion: sug.source, reasoning: sug.reasoning });
    if (store.get().llm === "busy") S.setLlm({ status: "ready" });
    syncLlm();
  });
}

const TERMINAL = new Set<FollowUpState["phase"]>(["settled", "limit_reached", "dismissed"]);

/** Dev-only: M2.3 invariants after each reduce. */
function checkInvariants(fu: FollowUpState, e: FollowUpEvent) {
  const problems: string[] = [];
  if (fu.used < 0 || fu.used > MAX_FOLLOW_UPS) problems.push(`used=${fu.used}`);
  const needsMoment = fu.phase === "worth_exploring" || fu.phase === "persisting";
  if (needsMoment !== (fu.momentId !== null)) problems.push(`momentId=${fu.momentId} in ${fu.phase}`);
  if ((fu.phase === "re_observing") !== (fu.reObserveUntil !== null)) problems.push(`reObserveUntil=${fu.reObserveUntil} in ${fu.phase}`);
  const prev = store.get().session?.followUp;
  if (prev && TERMINAL.has(prev.phase) && e.type !== "question_started" && prev.phase !== fu.phase) problems.push(`left terminal ${prev.phase} on ${e.type}`);
  if (problems.length) console.error("Follow-up invariant failed:", problems.join("; "), { event: e, state: fu });
}

// ---------------------------------------------------------------------------
// Interviewer actions

/** "Mark new question" fallback (button / N). Questions are normally detected from the Interviewer's speech. */
export function newQuestion(label?: string) {
  startQuestion(label, { origin: "manual" });
}

function startQuestion(label: string | undefined, meta: { origin: "spoken" | "manual"; text?: string }) {
  const q = S.nextQuestion(label, meta);
  if (q) dispatch({ type: "question_started", questionId: q.id, t: q.start, label: `Q${q.number} ${q.label}` });
  return q;
}

export function followUpAction(a: "ask" | "continue" | "dismiss") {
  const s = store.get().session;
  if (!s || !allowedActions(s.followUp).includes(a)) return;
  const t = sessionNow();
  if (a === "ask") lastAskAt = t;
  dispatch({ type: a, t });
}

/** Flag Details → Explore: opens a Moment from this Flag (origin "interviewer"). */
export function exploreFlag(flagId: string) {
  S.setOpenFlag(null);
  const s = store.get().session;
  const flag = s?.flags.find((f) => f.id === flagId);
  // Same rule as the Explore button: a live, undismissed Flag of the current Question.
  if (!s || !flag || flag.dismissed || flag.questionId !== s.followUp.questionId) return;
  dispatch({ type: "explore", flagId, momentId: uid(), t: sessionNow() });
}

/** Flag Details → Dismiss: the Flag no longer counts toward the evidence gate. */
export function dismissFlag(flagId: string) {
  S.dismissFlag(flagId);
  S.setOpenFlag(null);
}

export function setCrop(next: CropRect | null) {
  crop = next;
  live.crop = next;
  pipeline?.setCrop(next);
  resetBaseline();
}

/** Ongoing Flags end; the gate can't fire until the Baseline is learned again. */
export function resetBaseline() {
  if (!engine) return;
  S.applyTransitions(engine.resetBaseline(sessionNow()));
  S.setBaseline(null);
  store.set({ baselineJustCompleted: false, baselineProgress: 0 });
}

/** Stops everything (LLM, loop, pipeline, speech, stream), then writes the Session Report (local LLM, fallback). */
export async function finish(): Promise<void> {
  if (finishing) return;
  if (!isLive()) {
    closeSource();
    return;
  }
  finishing = true;
  llmAbort?.abort();
  llmAbort = null;
  if (loop) clearInterval(loop);
  loop = null;
  if (baselineTimer) clearTimeout(baselineTimer);
  baselineTimer = null;
  pipeline?.stop();
  pipeline = null;
  engine = null;
  stopSpeech?.();
  stopSpeech = null;
  stopListening();
  closeSource();
  live.result = null;
  S.endSession();
  store.set({ baselineJustCompleted: false, fps: 0, latestSignal: null });

  const session = store.get().session;
  finishing = false;
  if (!session) return;
  store.set({ reportStatus: "generating" });
  reportAbort = new AbortController();
  const mine = reportAbort;
  try {
    const report = await generateReport(session, mine.signal);
    if (store.get().session?.startedAt !== session.startedAt) return;
    S.setReport(report);
    store.set({ reportStatus: "done" });
  } catch {
    if (store.get().session?.startedAt !== session.startedAt) return;
    S.setReport(fallbackReport(session));
    store.set({ reportStatus: "fallback" });
  } finally {
    if (reportAbort === mine) reportAbort = null;
  }
}

/** Report → New session: cancels a report still being written, then returns to Screen 1 (Consent is asked again). */
export function newSession() {
  reportAbort?.abort();
  reportAbort = null;
  closeSource();
  S.clearSession();
}

export const currentCrop = () => crop;
