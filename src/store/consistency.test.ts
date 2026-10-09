import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FOLLOW_UPS, type Session } from "../domain/types";
import { buildJourneys, toJSON, toMarkdown } from "../llm/report";
import { reduceFollowUp, type FollowUpEvent } from "../rules/followUp";
import {
  applyFollowUp,
  applyTransitions,
  clearSession,
  confirmConsent,
  dismissFlag,
  endSession,
  MAX_LABEL_LENGTH,
  MAX_NAME_LENGTH,
  nextQuestion,
  openMoment,
  setBaseline,
  startSession,
  store,
  uid,
} from "./session";

/** Relationship invariants of a Session (audit K). Returns every problem found. */
export function checkConsistency(s: Session): string[] {
  const problems: string[] = [];
  const qIds = new Set(s.questions.map((q) => q.id));
  const flagById = new Map(s.flags.map((f) => [f.id, f]));
  const momentIds = new Set(s.moments.map((m) => m.id));
  const ids = [...s.questions.map((q) => q.id), ...s.flags.map((f) => f.id), ...s.moments.map((m) => m.id)];
  if (new Set(ids).size !== ids.length) problems.push("duplicate ids");
  s.questions.forEach((q, i) => {
    if (q.number !== i + 1) problems.push(`question ${q.id} numbered ${q.number}`);
    if (i > 0 && q.start < s.questions[i - 1].start) problems.push(`question ${q.id} starts before the previous one`);
  });
  for (const f of s.flags) {
    if (f.questionId === null || !qIds.has(f.questionId)) problems.push(`flag ${f.id} → unknown question`);
    if (f.end !== null && f.end < f.start) problems.push(`flag ${f.id} ends before it starts`);
    if (s.endedAt !== null && f.end === null) problems.push(`flag ${f.id} still open after the end`);
    // FR-007: the Question active when the Flag started.
    const active = [...s.questions].reverse().find((q) => q.start <= f.start);
    if (active && active.id !== f.questionId) problems.push(`flag ${f.id} not on the Question active at its start`);
  }
  for (const m of s.moments) {
    if (!qIds.has(m.questionId)) problems.push(`moment ${m.id} → unknown question`);
    for (const id of m.flagIds) {
      const f = flagById.get(id);
      if (!f) problems.push(`moment ${m.id} → unknown flag ${id}`);
      else if (f.questionId !== m.questionId) problems.push(`moment ${m.id} uses flag ${id} of another question`);
    }
    if (m.followUpNumber < 1 || m.followUpNumber > MAX_FOLLOW_UPS) problems.push(`moment ${m.id} follow-up ${m.followUpNumber}`);
    if ((m.decision === "asked") !== (m.askedAt !== null)) problems.push(`moment ${m.id} askedAt/decision mismatch`);
    if (m.result !== null && m.decision !== "asked") problems.push(`moment ${m.id} has a result but was not asked`);
  }
  for (const q of s.questions) {
    const asked = s.moments.filter((m) => m.questionId === q.id && m.decision === "asked").length;
    if (asked > MAX_FOLLOW_UPS) problems.push(`question ${q.id} has ${asked} follow-ups`);
  }
  if (!qIds.has(s.followUp.questionId)) problems.push("followUp → unknown question");
  if (s.followUp.momentId && !momentIds.has(s.followUp.momentId)) problems.push("followUp → unknown moment");
  for (const e of s.timeline) if (!qIds.has(e.questionId)) problems.push(`timeline ${e.kind} → unknown question`);
  const count = (k: string) => s.timeline.filter((e) => e.kind === k).length;
  if (count("question") !== s.questions.length) problems.push("question events ≠ questions");
  if (count("flag") !== s.flags.length) problems.push("flag events ≠ flags");
  // A Moment opens with a "moment" event, or with "persisting" when the pattern returns during re-observation.
  if (count("moment") + count("persisting") !== s.moments.length) problems.push("moment events ≠ moments");
  if (count("follow-up-asked") !== s.moments.filter((m) => m.decision === "asked").length) problems.push("asked events ≠ asked moments");
  if (count("settled") !== s.moments.filter((m) => m.result === "settled").length) problems.push("settled events ≠ settled moments");
  if (count("session-end") !== (s.endedAt === null ? 0 : 1)) problems.push("session-end events");
  return problems;
}

const T0 = 1_700_000_000_000;
let now = 0;
const at = (ms: number) => {
  now = ms;
  vi.setSystemTime(T0 + ms);
};
const session = () => store.get().session!;

/** The controller's dispatch, without capture or the LLM. */
function dispatch(e: FollowUpEvent) {
  const s = session();
  const { state, effects } = reduceFollowUp(s.followUp, e);
  for (const fx of effects) {
    if (fx.type !== "open_moment") continue;
    const flag = fx.flagId ? s.flags.find((f) => f.id === fx.flagId) : undefined;
    const kind = fx.hit?.kind ?? flag?.kind;
    if (!kind) continue;
    openMoment({
      id: fx.momentId, questionId: state.questionId, t: e.t, kind, origin: fx.hit ? "gate" : "interviewer",
      reason: fx.hit?.reason ?? "Opened by the Interviewer from a Flag", flagIds: fx.hit?.flagIds ?? (fx.flagId ? [fx.flagId] : []),
      followUpNumber: fx.followUpNumber, note: "n", followUp: "Could you walk me through that?", quality: null,
      suggestion: "fallback", decision: "pending", askedAt: null, result: null,
    });
  }
  applyFollowUp(state, effects);
}

const reading = (t: number) => {
  at(t);
  applyTransitions([{ kind: "reading-pattern", state: "start", t, detail: "5 line sweeps" }]);
  const flag = session().flags.at(-1)!;
  at(t + 3_000);
  applyTransitions([{ kind: "reading-pattern", state: "end", t: t + 3_000 }]);
  return flag;
};
const gateHit = (t: number, flagId: string) => {
  at(t);
  dispatch({ type: "gate_hit", momentId: uid(), t, hit: { kind: "reading-pattern", reason: "reading-like pattern", flagIds: [flagId] } as never });
};
const newQ = (t: number, label?: string) => {
  at(t);
  const q = nextQuestion(label)!;
  dispatch({ type: "question_started", questionId: q.id, t: q.start, label: `Q${q.number} ${q.label}` });
};

beforeEach(() => {
  vi.useFakeTimers();
  at(0);
  clearSession();
});

describe("consent gate (FR-001)", () => {
  it("does not start a Session without Consent", () => {
    expect(startSession({ source: "webcam", speechAvailable: false, llmModel: null })).toBe(false);
    expect(store.get().session).toBeNull();
  });
  it("records consentAt from the confirmation and asks again after New session", () => {
    at(5);
    confirmConsent("Ana");
    at(50);
    expect(startSession({ source: "webcam", speechAvailable: false, llmModel: null })).toBe(true);
    expect(session().consentAt).toBe(T0 + 5);
    clearSession();
    expect(store.get().draft).toBeNull();
    expect(startSession({ source: "webcam", speechAvailable: false, llmModel: null })).toBe(false);
  });
});

describe("input limits", () => {
  it("caps the Candidate name and Question labels", () => {
    confirmConsent("x".repeat(10_000));
    startSession({ source: "webcam", speechAvailable: false, llmModel: null });
    expect(session().candidateName).toHaveLength(MAX_NAME_LENGTH);
    expect(nextQuestion("y".repeat(10_000))!.label).toHaveLength(MAX_LABEL_LENGTH);
  });
});

describe("Session consistency", () => {
  it("keeps every relationship valid through a scripted Session and its exports", () => {
    confirmConsent("Ana <b>");
    startSession({ source: "webcam", speechAvailable: false, llmModel: null });
    setBaseline({ centreX: 0, centreY: 0, spreadX: 2, spreadY: 2 });

    // Q2: Moment → Ask → persisting → Ask final → limit reached.
    newQ(20_000, "Tell me about a project");
    gateHit(32_000, reading(30_000).id);
    at(33_000);
    dispatch({ type: "ask", t: 33_000 });
    gateHit(42_000, reading(40_000).id);
    at(43_000);
    dispatch({ type: "ask", t: 43_000 });
    dispatch({ type: "ask", t: 43_100 }); // over the limit: ignored
    gateHit(52_000, reading(50_000).id);
    expect(session().followUp.phase).toBe("limit_reached");

    // Q3: Moment → Ask → settles.
    newQ(60_000);
    gateHit(72_000, reading(70_000).id);
    at(73_000);
    dispatch({ type: "ask", t: 73_000 });
    at(110_000);
    dispatch({ type: "tick", t: 110_000 });
    expect(session().followUp.phase).toBe("settled");

    // Q4: dismissed Flag, Moment continued, then dismissed.
    newQ(120_000);
    dismissFlag(reading(121_000).id);
    gateHit(132_000, reading(130_000).id);
    dispatch({ type: "continue", t: 132_500 });
    gateHit(142_000, reading(140_000).id);
    dispatch({ type: "dismiss", t: 142_500 });

    // 20 Questions and 50 Flags in total.
    for (let i = 0; i < 16; i++) {
      newQ(150_000 + i * 20_000, `Q label ${i}`);
      reading(150_000 + i * 20_000 + 1_000);
      if (i % 2) reading(150_000 + i * 20_000 + 5_000);
    }
    while (session().flags.length < 50) reading(now + 1_000);
    expect(session().questions).toHaveLength(20);

    at(now + 5_000);
    endSession();
    endSession(); // second End is a no-op
    const s = session();
    expect(checkConsistency(s)).toEqual([]);

    const journeys = buildJourneys(s);
    expect(journeys.map((j) => j.question.id)).toEqual(s.questions.map((q) => q.id));
    expect(journeys.flatMap((j) => j.flags).length).toBe(s.flags.length);
    expect(journeys.flatMap((j) => j.moments).length).toBe(s.moments.length);
    expect(journeys[1].outcome).toBe("limit_reached");
    expect(journeys[1].followUpsAsked).toHaveLength(MAX_FOLLOW_UPS);
    expect(journeys[2].outcome).toBe("settled");
    expect(journeys[3].outcome).toBe("dismissed");

    const md = toMarkdown(s);
    for (const q of s.questions) expect(md).toContain(`## Q${q.number} · ${q.label}`);
    expect(md.match(/^- \d+:\d\d — /gm)).toHaveLength(s.timeline.length);
    expect(md).not.toMatch(/data:image|<img|base64/);
    expect(JSON.parse(toJSON(s))).toEqual(s);
  });

  it("is consistent for an empty Session", () => {
    confirmConsent("");
    startSession({ source: "video", speechAvailable: false, llmModel: null });
    at(1_000);
    endSession();
    expect(checkConsistency(session())).toEqual([]);
    expect(buildJourneys(session())[0].outcome).toBe("none");
  });
});
