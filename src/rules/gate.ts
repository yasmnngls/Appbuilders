import type { Flag, FlagKind, FollowUpState, Pause, Question, SessionTime } from "../domain/types";
import { RULES } from "./config";
import { inOpenPause, isThinkingPause } from "./pauses";

export interface GateInput {
  now: SessionTime;
  question: Question;
  followUp: FollowUpState; // uses watchFrom
  flags: Flag[]; // whole session; filtered inside
  baselineReady: boolean;
  speech: { available: boolean; pauses: Pause[] };
}

export interface GateHit {
  kind: FlagKind;
  /** Plain observable reason, e.g. "3 off-screen glances within 60 s". Shown in the UI and passed to the LLM. */
  reason: string;
  flagIds: string[];
}

const secs = (ms: number) => Math.round(ms / 1000);

/**
 * Evidence gate (ARCHITECTURE §3.2, FR-010): first trigger that passes, in fixed priority order, or null.
 * Pure; called ~4×/s by the controller.
 */
export function evaluateGate(input: GateInput): GateHit | null {
  const { now, question, followUp, flags, baselineReady, speech } = input;
  const cfg = RULES.followUp;
  if (!baselineReady) return null;
  if (followUp.phase !== "observing" && followUp.phase !== "re_observing") return null;
  const graceEnd = question.start + cfg.graceMs;
  if (now < graceEnd) return null;

  const eligible = flags
    .filter((f) => f.questionId === question.id && !f.dismissed && f.start >= followUp.watchFrom && f.start >= graceEnd && f.start <= now)
    .sort((a, b) => a.start - b.start);
  const held = (f: Flag) => (f.end ?? now) - f.start;
  const ofKind = (k: FlagKind) => eligible.filter((f) => f.kind === k);

  // 1. Second face held long enough.
  const second = ofKind("second-face").find((f) => held(f) >= cfg.secondFaceMs);
  if (second) return { kind: "second-face", reason: `A second face was visible for ${secs(held(second))} s`, flagIds: [second.id] };

  // 2. Face missing held long enough.
  const missing = ofKind("face-missing").find((f) => held(f) >= cfg.faceMissingMs);
  if (missing) return { kind: "face-missing", reason: `The face was out of view for ${secs(held(missing))} s`, flagIds: [missing.id] };

  // 3. Any reading pattern (the rule already needs RULES.reading.minCycles line sweeps).
  const reading = ofKind("reading-pattern")[0];
  if (reading) {
    const n = reading.evidence?.cycles;
    return {
      kind: "reading-pattern",
      reason: n ? `A reading-like gaze pattern was observed (${n} line sweeps)` : "A reading-like gaze pattern was observed",
      flagIds: [reading.id],
    };
  }

  // Off-screen: drop glances inside a short pause after which speech resumed (thinking), and glances
  // inside a still-open pause (re-evaluated on later ticks once it ends).
  const off = ofKind("off-screen").filter(
    (f) => !speech.available || !(isThinkingPause(speech.pauses, f.start, cfg.thinkingPauseMaxMs) || inOpenPause(speech.pauses, f.start)),
  );

  // 4. One off-screen Flag sustained.
  const sustainedMs = speech.available ? cfg.offScreenSustainedMs : cfg.offScreenSustainedNoSpeechMs;
  const sustained = off.find((f) => held(f) >= sustainedMs);
  if (sustained)
    return { kind: "off-screen", reason: `Gaze moved outside the usual range for ${secs(held(sustained))} s`, flagIds: [sustained.id] };

  // 5. Repeated off-screen glances within the window.
  const count = speech.available ? cfg.repeatCount : cfg.repeatCountNoSpeech;
  const recent = off.filter((f) => f.start >= now - cfg.repeatWindowMs);
  if (recent.length >= count)
    return {
      kind: "off-screen",
      reason: `${recent.length} off-screen glances within ${secs(cfg.repeatWindowMs)} s`,
      flagIds: recent.map((f) => f.id),
    };

  return null;
}
