import { MAX_FOLLOW_UPS, type Flag, type Moment, type Session } from "../domain/types";
import { LLM } from "./config";
import { buildContractInput, CONTRACT_SCHEMA, CONTRACT_SYSTEM, contractUserMessage, type ContractInput, type ContractOutput } from "./contract";
import { checkQuality } from "./guard";
import { chatJSON, currentModel, lastLatencyMs } from "./ollama";

export interface Suggestion {
  note: string;
  followUp: string;
  quality: { specific: boolean; neutral: boolean; grounded: boolean };
  source: "llm" | "fallback";
  model: string | null;
  latencyMs: number | null;
}

/** Deterministic follow-ups by slot (1-based). Pre-checked by the language test. */
export const FALLBACK_FOLLOW_UPS = [
  "Could you walk me through what you personally did in that situation?",
  "Could you give me one specific example, step by step, of how you handled that?",
] as const;

const flagsOf = (session: Session, moment: Moment): Flag[] =>
  moment.flagIds.map((id) => session.flags.find((f) => f.id === id)).filter((f): f is Flag => !!f);

const totalSecs = (flags: Flag[], nowT: number) =>
  Math.max(1, Math.round(flags.reduce((sum, f) => sum + ((f.end ?? nowT) - f.start), 0) / 1000));

function fallbackNote(session: Session, moment: Moment): string {
  const q = session.questions.find((x) => x.id === moment.questionId);
  const qn = q ? `Q${q.number}` : "this question";
  const flags = flagsOf(session, moment);
  switch (moment.kind) {
    case "reading-pattern": {
      const cycles = flags.reduce((max, f) => Math.max(max, f.evidence?.cycles ?? 0), 0);
      return `A reading-like gaze pattern was observed during ${qn}${cycles ? ` (${cycles} line sweeps)` : ""}.`;
    }
    case "off-screen":
      return `Gaze moved outside the usual range during ${qn}${moment.reason ? ` (${moment.reason})` : ""}.`;
    case "face-missing":
      return `The face was out of view for ${totalSecs(flags, moment.t)} s during ${qn}.`;
    case "second-face":
      return `A second face was visible for ${totalSecs(flags, moment.t)} s during ${qn}.`;
  }
}

/** Deterministic Interviewer Note and follow-up for when the local model is unavailable, slow or fails the guard. */
export function fallbackSuggestion(session: Session, moment: Moment): Suggestion {
  const slot = Math.min(Math.max(moment.followUpNumber, 1), MAX_FOLLOW_UPS);
  const note = fallbackNote(session, moment);
  const followUp = FALLBACK_FOLLOW_UPS[Math.min(slot, FALLBACK_FOLLOW_UPS.length) - 1];
  const { problems: _p, ...quality } = checkQuality(
    { moment_worth_exploring: true, interviewer_note: note, follow_up: followUp, quality: { specific: true, neutral: true, grounded: true } },
    buildContractInput(session, moment),
  );
  return { note, followUp, quality, source: "fallback", model: null, latencyMs: null };
}

interface Attempt {
  out: ContractOutput;
  check: ReturnType<typeof checkQuality>;
  model: string | null;
  latencyMs: number | null;
}

/** Words a correct note for each Moment kind contains. */
const KIND_WORDS: Record<Moment["kind"], RegExp> = {
  "reading-pattern": /reading/i,
  "off-screen": /gaze|range|off-screen|away/i,
  "face-missing": /face/i,
  "second-face": /second face|another face|two faces|2 faces/i,
};

const nonEmpty = (v: unknown) => typeof v === "string" && v.trim() !== "";
/** Pass rule (M5.3): neutral, and both texts present. */
const passes = (a: Attempt) => a.check.neutral && nonEmpty(a.out?.follow_up) && nonEmpty(a.out?.interviewer_note);

/** Event-driven: called once per opened Moment. Never throws. */
export async function writeSuggestion(session: Session, moment: Moment, signal?: AbortSignal): Promise<Suggestion> {
  try {
    const input: ContractInput = buildContractInput(session, moment);
    const qNum = session.questions.find((q) => q.id === moment.questionId)?.number ?? null;
    const base = contractUserMessage(input, qNum);
    const passed: Attempt[] = [];
    let user = base;
    for (let i = 0; i <= LLM.maxRetries; i++) {
      const model = currentModel();
      const out = await chatJSON<ContractOutput>(CONTRACT_SYSTEM, user, CONTRACT_SCHEMA, signal, { maxTokens: LLM.suggestionMaxTokens });
      const check = checkQuality(out, input);
      const attempt: Attempt = { out, check, model, latencyMs: lastLatencyMs() };
      if (passes(attempt)) {
        passed.push(attempt);
        break; // specific/grounded are shown as chips but never force a retry
      }
      user = `${base}\n\nYour previous answer was rejected because: ${check.problems.join("; ")}. Write it again.`;
    }
    const best = passed[0];
    if (!best) return fallbackSuggestion(session, moment);
    const { problems: _p, ...quality } = best.check;
    const note = best.out.interviewer_note.trim();
    return {
      // Small models sometimes name the wrong observation; keep the note factual by using the deterministic one then.
      note: KIND_WORDS[moment.kind].test(note) ? note : fallbackNote(session, moment),
      followUp: best.out.follow_up.trim(),
      quality,
      source: "llm",
      model: best.model,
      latencyMs: best.latencyMs,
    };
  } catch {
    return fallbackSuggestion(session, moment);
  }
}
