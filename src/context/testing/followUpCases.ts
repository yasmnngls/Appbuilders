/**
 * Shared follow-up reasoning cases (A–G + hero demo). Used by the vitest suite and by scripts/bench-followup.mjs,
 * so the live check runs exactly the inputs the tests run.
 */
import type { FlagKind, Moment, Session, TranscriptSegment } from "../../domain/types";
import type { GapId } from "../gaps";

export interface FollowUpCase {
  id: string;
  name: string;
  question: string;
  answer: string;
  kind: FlagKind;
  /** Follow-ups already asked in this Question, with the gap each targeted. */
  asked?: { followUp: string; gap: string }[];
  expect: {
    /** "none" = no follow-up must be suggested. */
    followUp: "none" | "some";
    /** Acceptable target gaps (any of). */
    gaps?: GapId[];
    /** The follow-up must contain one of these topic words. */
    topic?: string[];
    /** The follow-up must not target these gaps. */
    notGaps?: GapId[];
  };
}

export const HERO_QUESTION = "Tell me about a difficult project you've worked on.";
export const HERO_ANSWER = "I worked on a web application with my team. The backend was difficult, but eventually we finished it.";

export const CASES: FollowUpCase[] = [
  {
    id: "A",
    name: "complete answer",
    question: "Tell me about a time you fixed a performance problem.",
    answer:
      "When our checkout API started timing out before a big launch, I profiled the slow database queries first, then I added an index and a small cache. As a result, response time dropped from two seconds to 200 milliseconds and we launched on time.",
    kind: "off-screen",
    expect: { followUp: "none" },
  },
  {
    id: "B",
    name: "team but not self",
    question: "Tell me about a project you're proud of.",
    answer:
      "Our team rebuilt the reporting dashboard over two months. We split the work into the front end and the data pipeline, and we shipped it to all customers with a 30% faster load time.",
    kind: "off-screen",
    expect: { followUp: "some", gaps: ["personal"] },
  },
  {
    id: "C",
    name: "solved, no how",
    question: "Tell me about a time you handled a production issue.",
    answer: "There was a production bug in the login flow that blocked users from signing in. I solved the problem and everything was fine after that.",
    kind: "off-screen",
    expect: { followUp: "some", gaps: ["steps"] },
  },
  {
    id: "D",
    name: "situation + action, no result",
    question: "Tell me about a time a system you owned was failing.",
    answer: "Our payment service kept failing during a big holiday sale, so I added retries and moved the slow calls onto a queue.",
    kind: "off-screen",
    expect: { followUp: "some", gaps: ["outcome"] },
  },
  {
    id: "E",
    name: "Flag + complete answer",
    question: "Tell me about a time you fixed a performance problem.",
    answer:
      "When our checkout API started timing out before a big launch, I profiled the slow database queries first, then I added an index and a small cache. As a result, response time dropped from two seconds to 200 milliseconds and we launched on time.",
    kind: "reading-pattern",
    expect: { followUp: "none" },
  },
  {
    id: "F",
    name: "Flag + gap",
    question: "Describe a challenging migration you worked on.",
    answer: "We moved the billing database to a new cloud provider last spring. The team handled the cutover over one weekend and it went live on Monday.",
    kind: "reading-pattern",
    expect: { followUp: "some", gaps: ["personal"], topic: ["billing", "database", "cutover", "migration", "cloud"] },
  },
  {
    id: "G",
    name: "repeat: personal already asked",
    question: HERO_QUESTION,
    answer: HERO_ANSWER,
    kind: "off-screen",
    asked: [{ followUp: "What did you personally do on the backend?", gap: "personal contribution" }],
    expect: { followUp: "some", gaps: ["steps", "outcome"], notGaps: ["personal"] },
  },
  {
    id: "G2",
    name: "repeat: no gap left",
    question: "Tell me about a project you're proud of.",
    answer:
      "Our team rebuilt the reporting dashboard over two months. We split the work into the front end and the data pipeline, and we shipped it to all customers with a 30% faster load time.",
    kind: "off-screen",
    asked: [{ followUp: "What did you personally do on the reporting dashboard?", gap: "personal contribution" }],
    expect: { followUp: "none" },
  },
  {
    id: "HERO",
    name: "hero demo",
    question: HERO_QUESTION,
    answer: HERO_ANSWER,
    kind: "reading-pattern",
    expect: { followUp: "some", gaps: ["personal", "steps"], topic: ["backend"] },
  },
];

/** A Session in Q2 with the Question spoken, the Candidate's answer transcribed, any asked follow-ups, and an open Moment. */
export function caseSession(c: Pick<FollowUpCase, "question" | "answer" | "kind" | "asked">): { session: Session; moment: Moment } {
  const qStart = 60_000;
  const transcript: TranscriptSegment[] = [
    { id: "s1", speaker: "interviewer", start: qStart, end: qStart + 3000, text: c.question, questionId: "q2" },
  ];
  const sentences = c.answer ? c.answer.match(/[^.!?]+[.!?]*/g) ?? [c.answer] : [];
  sentences.forEach((text, i) =>
    transcript.push({ id: `a${i}`, speaker: "candidate", start: qStart + 4000 + i * 4000, end: qStart + 7500 + i * 4000, text: text.trim(), questionId: "q2" }),
  );
  const asked: Moment[] = (c.asked ?? []).map((a, i) => ({
    id: `prev${i}`, questionId: "q2", t: qStart + 30_000 + i * 1000, kind: c.kind, origin: "gate", reason: "3 off-screen glances within 60s",
    flagIds: ["f1"], followUpNumber: i + 1, note: "Gaze moved outside the usual range during Q2.", followUp: a.followUp,
    quality: { specific: true, neutral: true, grounded: true }, suggestion: "llm", decision: "asked", askedAt: qStart + 31_000 + i * 1000,
    result: "persisting", reasoning: { question: c.question, answer: c.answer, gap: a.gap, reason: "", basis: "transcript" },
  }));
  const used = asked.length;
  const moment: Moment = {
    id: "m-now", questionId: "q2", t: qStart + 40_000, kind: c.kind, origin: "gate", reason: "3 off-screen glances within 60s",
    flagIds: ["f1"], followUpNumber: used + 1, note: null, followUp: null, quality: null, suggestion: "generating",
    decision: "pending", askedAt: null, result: null,
  };
  const session: Session = {
    candidateName: "Sample", consentAt: 0, startedAt: 1000, endedAt: null, source: "webcam", speechAvailable: true, llmModel: "qwen2.5:3b",
    baseline: { centreX: 0, centreY: 0, spreadX: 3, spreadY: 2 },
    questions: [
      { id: "q1", number: 1, label: "Introduction", start: 0 },
      { id: "q2", number: 2, label: "Question 2", start: qStart, origin: "spoken", text: c.question },
    ],
    flags: [{ id: "f1", kind: c.kind, start: qStart + 35_000, end: qStart + 39_000, questionId: "q2", evidence: { cycles: 5 } }],
    moments: [...asked, moment],
    followUp: { questionId: "q2", phase: "worth_exploring", used, reObserveUntil: null, momentId: "m-now", watchFrom: qStart, askedMomentId: null },
    timeline: [],
    report: null,
    transcript,
    asr: { available: true, model: "whisper-base.en" },
  };
  return { session, moment };
}
