import type { Flag, FollowUpReasoning, Moment, Session } from "../domain/types";
import { contextFor, type AnswerContext } from "../context/answer";
import { analyzeAnswer, gapIdOf, gapTemplate, type AnswerAnalysis, type Gap } from "../context/gaps";
import { LLM } from "./config";
import { buildContractInput, CONTRACT_SCHEMA, CONTRACT_SYSTEM, contractUserMessage, type ContractOutput } from "./contract";
import { checkFollowUp, checkNote, clip, MAX_FOLLOW_UP_CHARS, MAX_NOTE_CHARS, passesFollowUp, similarity, REPEAT_SIMILARITY, stripUngroundedTopic } from "./guard";
import { chatJSON, currentModel, lastLatencyMs } from "./ollama";

export interface Suggestion {
  note: string;
  /** Null = no follow-up suggested (answer covers the Question, too brief, no transcript, or every gap already asked). */
  followUp: string | null;
  quality: { specific: boolean; neutral: boolean; grounded: boolean } | null;
  source: "llm" | "fallback";
  model: string | null;
  latencyMs: number | null;
  reasoning: FollowUpReasoning;
  /** Raw model output of the last call, for the benchmark only. */
  modelOutput?: ContractOutput | null;
}

export interface SuggestionOptions {
  /** True while the Candidate's current utterance is still going; the model is called only once it ends. */
  candidateSpeaking?: () => boolean;
  /** The latest Session (re-read after waiting, so the transcript includes the end of the utterance). */
  latest?: () => Session | null | undefined;
}

/** Longest wait for the Candidate's utterance to end before the model is called. */
export const UTTERANCE_WAIT_MS = 8_000;
const POLL_MS = 250;

export const NO_TRANSCRIPT_REASON = "No transcript for this answer — no follow-up suggested.";
export const tooBriefReason = (n: number) => `The answer so far is too brief to judge (${n} ${n === 1 ? "word" : "words"}) — no follow-up suggested.`;
export const coveredReason = (covered: string[]) =>
  `The answer covers ${covered.length ? listText(covered) : "what the question asks"} — no follow-up suggested.`;
export const allAskedReason = (labels: string[]) =>
  `Every unclear area in this answer (${listText(labels)}) was already followed up — no follow-up suggested.`;
export const MODEL_COVERED_REASON = "The local model judged that the answer covers the question — no follow-up suggested.";

function listText(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const flagsOf = (session: Session, moment: Moment): Flag[] =>
  moment.flagIds.map((id) => session.flags.find((f) => f.id === id)).filter((f): f is Flag => !!f);

const totalSecs = (flags: Flag[], nowT: number) =>
  Math.max(1, Math.round(flags.reduce((sum, f) => sum + ((f.end ?? nowT) - f.start), 0) / 1000));

export function fallbackNote(session: Session, moment: Moment): string {
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

/** Words a correct note for each Moment kind contains. */
const KIND_WORDS: Record<Moment["kind"], RegExp> = {
  "reading-pattern": /reading/i,
  "off-screen": /gaze|range|off-screen|away/i,
  "face-missing": /face/i,
  "second-face": /second face|another face|two faces|2 faces/i,
};

/** The deterministic part of the decision: the context, the analysis, and either "no follow-up" or the gaps still open. */
interface Decision {
  ctx: AnswerContext;
  analysis: AnswerAnalysis;
  /** Gaps not yet targeted by an asked follow-up in this Question. */
  open: Gap[];
  /** Set when no follow-up is suggested; the model is not called for the follow-up. */
  none: FollowUpReasoning | null;
}

export function decide(session: Session, moment: Moment): Decision {
  const ctx = contextFor(session, moment.questionId, Number.POSITIVE_INFINITY);
  const analysis = analyzeAnswer(ctx.answer);
  const open = analysis.gaps.filter((g) => !ctx.askedGaps.includes(g.id));
  const base = { question: ctx.question, answer: ctx.answer, gap: null, basis: "transcript" as const };
  let none: FollowUpReasoning | null = null;
  if (!ctx.answer.trim()) none = { ...base, answer: "", reason: NO_TRANSCRIPT_REASON, basis: "no-transcript" };
  else if (analysis.tooBrief) none = { ...base, reason: tooBriefReason(analysis.words) };
  else if (analysis.complete) none = { ...base, reason: coveredReason(analysis.covered) };
  else if (!open.length) none = { ...base, reason: allAskedReason(analysis.gaps.map((g) => g.label)) };
  return { ctx, analysis, open, none };
}

const reasoningFor = (d: Decision, gap: Gap): FollowUpReasoning => ({
  question: d.ctx.question,
  answer: d.ctx.answer,
  gap: gap.label,
  reason: gap.reason,
  basis: "transcript",
});

const qualityOf = (text: string, d: Decision) => {
  const { specific, neutral, grounded } = checkFollowUp(text, { question: d.ctx.question, answer: d.ctx.answer, previous: d.ctx.previousFollowUps });
  return { specific, neutral, grounded };
};

/** Template follow-up for the first open gap whose template is not a repeat. */
function templateFor(d: Decision): { text: string; gap: Gap } | null {
  for (const gap of d.open) {
    const text = gapTemplate(gap.id, d.ctx.answer);
    if (!d.ctx.previousFollowUps.some((p) => similarity(p, text) >= REPEAT_SIMILARITY)) return { text, gap };
  }
  return null;
}

function deterministic(session: Session, moment: Moment, d: Decision, note: string, extra: Partial<Suggestion> = {}): Suggestion {
  const base = { note, source: "fallback" as const, model: null, latencyMs: null, ...extra };
  if (d.none) return { ...base, followUp: null, quality: null, reasoning: d.none };
  const t = templateFor(d);
  if (!t) {
    return {
      ...base,
      followUp: null,
      quality: null,
      reasoning: { question: d.ctx.question, answer: d.ctx.answer, gap: null, reason: allAskedReason(d.analysis.gaps.map((g) => g.label)), basis: "transcript" },
    };
  }
  return { ...base, followUp: t.text, quality: qualityOf(t.text, d), reasoning: reasoningFor(d, t.gap) };
}

/** Deterministic suggestion (no model): used when the local model is unavailable, slow or fails the guard. */
export function fallbackSuggestion(session: Session, moment: Moment): Suggestion {
  return deterministic(session, moment, decide(session, moment), fallbackNote(session, moment));
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Waits (polling) until the Candidate's utterance ends, at most UTTERANCE_WAIT_MS, or until aborted. */
async function utteranceEnd(speaking: (() => boolean) | undefined, signal: AbortSignal): Promise<void> {
  if (!speaking) return;
  const until = Date.now() + UTTERANCE_WAIT_MS;
  while (!signal.aborted && Date.now() < until && safe(speaking)) await sleep(POLL_MS, signal);
}
const safe = (f: () => boolean) => {
  try {
    return f();
  } catch {
    return false;
  }
};

/** Only the contract's keys of a model reply (extra fields are dropped). */
const pickOutput = (o: ContractOutput | null): ContractOutput | null =>
  o && typeof o === "object" && !Array.isArray(o)
    ? { answer_covers_question: o.answer_covers_question, gap: o.gap, reason: o.reason, follow_up: o.follow_up, interviewer_note: o.interviewer_note }
    : null;

const modelNote = (out: ContractOutput | null, moment: Moment, question: string): string | null => {
  if (!out || !checkNote(out.interviewer_note).ok) return null;
  const note = clip(stripUngroundedTopic(out.interviewer_note, question), MAX_NOTE_CHARS);
  return KIND_WORDS[moment.kind].test(note) ? note : null;
};

/**
 * Event-driven: called once per opened Moment. Never throws; settles within LLM.suggestionBudgetMs (utterance wait included).
 * The analyzer decides whether a follow-up is suggested; the model only words it, and the guard checks the wording.
 */
export async function writeSuggestion(session: Session, moment: Moment, signal?: AbortSignal, opts: SuggestionOptions = {}): Promise<Suggestion> {
  const budget = AbortSignal.timeout(LLM.suggestionBudgetMs);
  const deadline = signal ? AbortSignal.any([signal, budget]) : budget;
  let s = session;
  try {
    const asrOff = !session.asr?.available && !(session.transcript ?? []).length;
    if (!asrOff) {
      await utteranceEnd(opts.candidateSpeaking, deadline);
      s = opts.latest?.() ?? session;
    }
    const d = decide(s, moment);
    if (d.none) return deterministic(s, moment, d, fallbackNote(s, moment));

    const input = buildContractInput(s, moment, {
      question: d.ctx.question,
      answer: d.ctx.answer,
      recentExchange: d.ctx.recentExchange,
      previousFollowUps: d.ctx.previousFollowUps,
      gaps: d.open,
    });
    const qNum = s.questions.find((q) => q.id === moment.questionId)?.number ?? null;
    const base = contractUserMessage(input, qNum);
    let user = base;
    let last: ContractOutput | null = null;
    let model: string | null = null;
    let latencyMs: number | null = null;
    for (let i = 0; i <= LLM.maxRetries; i++) {
      model = currentModel();
      const out = await chatJSON<ContractOutput>(CONTRACT_SYSTEM, user, CONTRACT_SCHEMA, deadline, { maxTokens: LLM.suggestionMaxTokens });
      latencyMs = lastLatencyMs();
      last = pickOutput(out);
      const note = modelNote(out, moment, d.ctx.question) ?? fallbackNote(s, moment);
      const llm = { note, source: "llm" as const, model, latencyMs, modelOutput: last };

      // Conservative: if the model judges the answer complete, no follow-up, even though the analyzer found a gap.
      if (out?.answer_covers_question === true) {
        return {
          ...llm,
          followUp: null,
          quality: null,
          reasoning: { question: d.ctx.question, answer: d.ctx.answer, gap: null, reason: MODEL_COVERED_REASON, basis: "transcript" },
        };
      }
      const problems: string[] = [];
      const claimed = gapIdOf(out?.gap);
      const target = claimed ? d.open.find((g) => g.id === claimed) : d.open[0];
      if (claimed && d.ctx.askedGaps.includes(claimed)) problems.push(`"${out.gap}" was already followed up; choose another gap`);
      else if (!target) problems.push(`"gap" must be one of: ${d.open.map((g) => g.label).join(", ")}`);
      const check = checkFollowUp(out?.follow_up, { question: d.ctx.question, answer: d.ctx.answer, previous: d.ctx.previousFollowUps });
      if (!passesFollowUp(out?.follow_up, check)) problems.push(...check.problems);
      if (!problems.length && target) {
        const followUp = clip(out.follow_up as string, MAX_FOLLOW_UP_CHARS);
        const { specific, neutral, grounded } = check;
        return { ...llm, followUp, quality: { specific, neutral, grounded }, reasoning: reasoningFor(d, target) };
      }
      user = `${base}\n\nYour previous answer was rejected because: ${(problems.length ? problems : ["it was invalid"]).join("; ")}. Write it again.`;
    }
    // The follow-up fell back to a template, so the note is the deterministic one too (source "fallback" stays truthful).
    const note = fallbackNote(s, moment);
    return deterministic(s, moment, d, note, { modelOutput: last, model, latencyMs });
  } catch {
    return fallbackSuggestion(s, moment);
  }
}
