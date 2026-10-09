import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { openWebcam, openWindowCapture, stopStream } from "../capture/source";
import type { Session } from "../domain/types";
import { checkOllama, warmUp } from "../llm/ollama";
import { startNoteLoop } from "../llm/notes";
import { fallbackReport, generateReport } from "../llm/report";
import { RuleEngine } from "../rules/engine";
import {
  addNote,
  applyTransitions,
  endSession,
  sessionNow,
  setBaseline,
  setReport,
  startSession,
  store,
} from "../store/session";
import { createFaceLandmarker } from "../vision/faceTracker";
import { type CropRect, VisionPipeline } from "../vision/pipeline";

/** Wires capture → vision → rules → store → local LLM. Owns everything that isn't React. */

let landmarker: Promise<{ landmarker: FaceLandmarker; delegate: "GPU" | "CPU" }> | null = null;
let stream: MediaStream | null = null;
let pipeline: VisionPipeline | null = null;
let engine: RuleEngine | null = null;
let stopNotes: (() => void) | null = null;
let crop: CropRect | null = null;

/** The latest raw landmarker result, read by the overlay each animation frame (kept out of React state). */
export const live: { result: FaceLandmarkerResult | null; crop: CropRect | null } = { result: null, crop: null };

export const video = typeof document === "undefined" ? (null as unknown as HTMLVideoElement) : document.createElement("video");
if (video) {
  video.muted = true;
  video.playsInline = true;
  video.className = "h-full w-full object-contain";
}

export function preload() {
  landmarker ??= createFaceLandmarker();
  landmarker
    .then(({ delegate }) => store.set({ vision: { status: "ready", delegate } }))
    .catch((e) => store.set({ vision: { status: "error", message: String(e) } }));
  checkOllama().then((ok) => {
    store.set({ llm: ok ? "ready" : "unavailable" });
    if (ok) warmUp().catch(() => {});
  });
  const syncOnline = () => store.set({ online: navigator.onLine });
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
}

export async function begin(input: { candidateName: string; source: Session["source"] }) {
  const { landmarker: lm } = await (landmarker ??= createFaceLandmarker());
  stream = input.source === "webcam" ? await openWebcam() : await openWindowCapture();
  stream.getVideoTracks()[0]?.addEventListener("ended", () => void finish());
  video.srcObject = stream;
  await video.play();

  startSession({ ...input, consentAt: Date.now() });
  engine = new RuleEngine();
  crop = null;
  live.crop = null;
  pipeline = new VisionPipeline({
    video,
    landmarker: lm,
    getSessionTime: sessionNow,
    onFrame: (signal, result) => {
      live.result = result;
      const e = engine!;
      applyTransitions(e.push(signal));
      const s = store.get().session;
      if (s && !s.baseline && e.currentBaseline) setBaseline(e.currentBaseline);
      store.set({ latestSignal: signal, fps: pipeline?.fps ?? 0, baselineProgress: e.baselineProgress });
    },
  });
  pipeline.start();

  stopNotes = startNoteLoop({
    getSession: () => store.get().session,
    now: sessionNow,
    onNote: (n) => addNote(n),
    onStatus: (llm) => store.set({ llm }),
  });
}

export function setCrop(next: CropRect | null) {
  crop = next;
  live.crop = next;
  pipeline?.setCrop(next);
  resetBaseline();
}

export function resetBaseline() {
  if (!engine) return;
  applyTransitions(engine.resetBaseline(sessionNow()));
  setBaseline(null);
}

/** Stops capture and analysis, then writes the Session Report (local LLM, deterministic fallback). */
export async function finish() {
  if (!pipeline) return;
  pipeline.stop();
  pipeline = null;
  stopNotes?.();
  stopNotes = null;
  stopStream(stream);
  stream = null;
  video.srcObject = null;
  live.result = null;
  endSession();

  const session = store.get().session;
  if (!session) return;
  store.set({ reportStatus: "generating" });
  try {
    setReport(await generateReport(session));
    store.set({ reportStatus: "done" });
  } catch {
    setReport(fallbackReport(session));
    store.set({ reportStatus: "fallback" });
  }
}

export const currentCrop = () => crop;
