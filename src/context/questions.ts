import type { FollowUpPhase, Question, SessionTime, Speaker } from "../domain/types";

/**
 * Automatic Question detection from the Interviewer's transcribed speech.
 * Pure: the controller feeds finished segments and applies the decision.
 */

export const QUESTIONS = {
  /** A new Question needs at least this many words. */
  MIN_WORDS: 5,
  /** A new Question can't start sooner than this after the current one started. */
  MIN_GAP_MS: 20_000,
  /** After Ask Follow-up, an Interviewer question within this window is the follow-up being spoken. */
  FOLLOW_UP_WINDOW_MS: 20_000,
  /** Longest generated label. */
  LABEL_MAX: 60,
  LABEL_WORDS: 8,
} as const;

const PROMPTS = [
  "tell me",
  "tell us",
  "describe",
  "walk me through",
  "walk us through",
  "talk me through",
  "can you",
  "could you",
  "would you",
  "how",
  "what",
  "why",
  "when",
  "where",
  "which",
  "who",
  "have you",
  "do you",
  "did you",
  "are you",
  "give me an example",
  "explain",
  "share",
];

/** Leading words that don't change meaning ("So, tell me..."). */
const LEAD_INS = /^(?:(?:so|okay|ok|alright|all right|right|great|good|well|and|now|next|cool|perfect|thanks|thank you)[\s,.!-]+)+/i;

/** Small talk / meeting logistics that look like questions but aren't interview Questions. */
const FILLER = [
  /\bcan you (?:hear|see) me\b/,
  /\bcan you see my screen\b/,
  /\bam i (?:audible|on mute|muted)\b/,
  /\bis my (?:audio|mic|microphone|video|camera)\b/,
  /\bare you (?:there|ready)\b/,
  /\bhow are you(?: doing)?(?: today)?\??$/,
  /\bcan you (?:hear|see) us\b/,
];

const words = (s: string) => s.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** True when the utterance reads like an interview Question (not filler, at least ~5 words). */
export function looksLikeQuestion(text: string): boolean {
  const t = normalise(text);
  const asked = /\?\s*$/.test(t);
  // A clear "?" may be one word shorter ("Any questions for me?").
  if (words(t).length < QUESTIONS.MIN_WORDS - (asked ? 1 : 0)) return false;
  if (FILLER.some((re) => re.test(t))) return false;
  if (asked) return true;
  const body = t.replace(LEAD_INS, "");
  return PROMPTS.some((p) => body === p || body.startsWith(p + " ") || body.startsWith(p + ","));
}

/** A short version of the Question for the label (Q2 · Walk me through the outage). */
export function shortLabel(text: string): string {
  const body = text.replace(/\s+/g, " ").trim().replace(LEAD_INS, "").replace(/[?.!\s]+$/, "");
  const w = body.split(" ").filter(Boolean);
  let label = w.slice(0, QUESTIONS.LABEL_WORDS).join(" ");
  if (label.length > QUESTIONS.LABEL_MAX) label = label.slice(0, QUESTIONS.LABEL_MAX).replace(/\s+\S*$/, "");
  if (w.length > QUESTIONS.LABEL_WORDS || label.length < body.length) label += "…";
  return label ? label[0].toUpperCase() + label.slice(1) : "Question";
}

export type QuestionDecision =
  /** Start a new Question with this text. */
  | "new"
  /** Q1 was only the auto-created placeholder: give it this text instead of starting Q2. */
  | "relabel"
  /** The Interviewer is speaking the follow-up they just chose: record as speech only. */
  | "follow-up"
  | "none";

export function decideSpokenQuestion(input: {
  text: string;
  speaker: Speaker;
  /** When the utterance started. */
  t: SessionTime;
  current: Question;
  phase: FollowUpPhase;
  /** When the Interviewer last clicked Ask Follow-up, if ever. */
  lastAskAt: SessionTime | null;
  /** Any Candidate (or mixed, non-question) speech transcribed since the current Question started. */
  candidateSpokeInCurrent: boolean;
}): QuestionDecision {
  if (input.speaker === "candidate") return "none";
  if (!looksLikeQuestion(input.text)) return "none";
  if (input.phase === "re_observing") return "follow-up";
  if (input.lastAskAt !== null && input.t - input.lastAskAt >= 0 && input.t - input.lastAskAt < QUESTIONS.FOLLOW_UP_WINDOW_MS) return "follow-up";
  if (input.current.number === 1 && input.current.origin !== "spoken" && input.current.origin !== "manual" && !input.candidateSpokeInCurrent)
    return "relabel";
  if (input.t - input.current.start < QUESTIONS.MIN_GAP_MS) return "none";
  return "new";
}
