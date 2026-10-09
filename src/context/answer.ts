/**
 * The conversation context for one Question: what was asked, what the Candidate said, and what was already followed up.
 * Only this small window is ever sent to the local model, never the whole interview.
 */
import type { Moment, Session, SessionTime, Speaker } from "../domain/types";
import { promptLabel, questionText, UNLABELLED_QUESTION } from "../llm/contract";
import { gapIdOf, type GapId } from "./gaps";

/** Longest Candidate answer kept (characters, the most recent part). */
export const MAX_ANSWER_CHARS = 1200;
/** Segments in the recent exchange, and the longest text kept per segment. */
export const RECENT_SEGMENTS = 6;
export const MAX_SEGMENT_CHARS = 200;

export interface AnswerContext {
  /** The Question as asked: the spoken text, else the label. */
  question: string;
  /** The Candidate's answer to this Question, clipped to the last MAX_ANSWER_CHARS characters. Empty when none. */
  answer: string;
  /** The last few utterances of both speakers in this Question, clipped. */
  recentExchange: { speaker: Speaker; text: string }[];
  /** Follow-ups the Interviewer already asked in this Question. */
  previousFollowUps: string[];
  /** Gaps those follow-ups targeted. */
  askedGaps: GapId[];
  answerWords: number;
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const clipStart = (text: string, max: number) => {
  if (text.length <= max) return text;
  const tail = text.slice(text.length - max);
  const cut = tail.indexOf(" ");
  return `…${cut >= 0 && cut < 40 ? tail.slice(cut + 1) : tail}`;
};
const clipEnd = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** Follow-ups already asked in this Question, before this Moment. */
export function askedMoments(session: Session, questionId: string, exceptId?: string): Moment[] {
  return session.moments.filter((m) => m.questionId === questionId && m.decision === "asked" && m.id !== exceptId);
}

export function contextFor(session: Session, questionId: string, nowT: SessionTime): AnswerContext {
  const q = session.questions.find((x) => x.id === questionId);
  const question = q ? (q.text?.trim() ? promptLabel(q.text) : questionText(q.label, q.number)) : UNLABELLED_QUESTION;
  const questionTexts = new Set(session.questions.map((x) => (x.text ? norm(x.text) : "")).filter(Boolean));

  const segs = (session.transcript ?? [])
    .filter((s) => s.questionId === questionId && s.start <= nowT && s.text.trim())
    .sort((a, b) => a.start - b.start);
  const isQuestionSegment = (s: (typeof segs)[number]) =>
    questionTexts.has(norm(s.text)) || (s.speaker === "mixed" && !!q && s.text.trim().endsWith("?") && Math.abs(s.start - q.start) <= 1000);
  const answerSegs = segs.filter((s) => (s.speaker === "candidate" || s.speaker === "mixed") && !isQuestionSegment(s));
  const answer = clipStart(answerSegs.map((s) => s.text.replace(/\s+/g, " ").trim()).join(" "), MAX_ANSWER_CHARS);

  const recentExchange = segs.slice(-RECENT_SEGMENTS).map((s) => ({ speaker: s.speaker, text: clipEnd(s.text.replace(/\s+/g, " ").trim(), MAX_SEGMENT_CHARS) }));

  const asked = askedMoments(session, questionId);
  const previousFollowUps = asked.map((m) => m.followUp).filter((t): t is string => !!t);
  const askedGaps = [...new Set(asked.map((m) => gapIdOf(m.reasoning?.gap)).filter((g): g is GapId => !!g))];

  return {
    question,
    answer,
    recentExchange,
    previousFollowUps,
    askedGaps,
    answerWords: answer ? answer.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0,
  };
}
