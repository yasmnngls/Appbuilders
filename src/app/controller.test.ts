import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTransitions, clearSession, confirmConsent, dismissFlag, nextQuestion, startSession, store } from "../store/session";
import { exploreFlag, ingestSegment, openSource, startBaseline } from "./controller";

beforeEach(() => clearSession());

describe("consent gate (FR-001)", () => {
  it("opens no Source and starts no Session before Consent", async () => {
    await expect(openSource("webcam")).rejects.toThrow(/Consent/);
    store.set({ sourceReady: { kind: "webcam", hasAudio: false } });
    startBaseline();
    expect(store.get().session).toBeNull();
  });
});

describe("exploreFlag", () => {
  const live = () => {
    confirmConsent("Ana");
    startSession({ source: "webcam", speechAvailable: false, llmModel: null });
  };
  const flag = (t: number) => {
    applyTransitions([{ kind: "reading-pattern", state: "start", t }]);
    return store.get().session!.flags.at(-1)!.id;
  };
  const phase = () => store.get().session!.followUp.phase;

  it("ignores unknown, dismissed and earlier-Question Flags", () => {
    live();
    exploreFlag("nope");
    expect(phase()).toBe("observing");
    const dismissed = flag(0);
    dismissFlag(dismissed);
    exploreFlag(dismissed);
    expect(phase()).toBe("observing");
    const earlier = flag(0);
    nextQuestion("Q2");
    store.set({ session: { ...store.get().session!, followUp: { ...store.get().session!.followUp, questionId: store.get().session!.questions[1].id } } });
    exploreFlag(earlier);
    expect(phase()).toBe("observing");
    expect(store.get().session!.moments).toHaveLength(0);
    const current = flag(60_000);
    exploreFlag(current);
    expect(phase()).toBe("worth_exploring");
    expect(store.get().session!.moments[0].flagIds).toEqual([current]);
  });
});

describe("spoken Questions (ingestSegment)", () => {
  const T0 = 1_700_000_000_000;
  const at = (ms: number) => vi.setSystemTime(T0 + ms);
  const s = () => store.get().session!;
  beforeEach(() => {
    vi.useFakeTimers();
    at(0);
    confirmConsent("Ana");
    startSession({ source: "window", speechAvailable: true, llmModel: null, asr: { available: true, model: "base.en" } });
  });
  afterEach(() => vi.useRealTimers());

  it("relabels Q1, then starts Q2 from the next Interviewer question, assigning segments to Questions", () => {
    at(4_000);
    ingestSegment({ speaker: "interviewer", start: 2_000, end: 4_000, text: "Tell me about a project you're proud of." });
    expect(s().questions).toHaveLength(1);
    expect(s().questions[0]).toMatchObject({ origin: "spoken", label: "Tell me about a project you're proud of" });

    at(20_000);
    ingestSegment({ speaker: "candidate", start: 5_000, end: 19_000, text: "I led the billing migration." });
    at(40_000);
    ingestSegment({ speaker: "interviewer", start: 37_000, end: 40_000, text: "How did you handle the rollback plan?" });
    expect(s().questions).toHaveLength(2);
    expect(s().questions[1]).toMatchObject({ number: 2, origin: "spoken", text: "How did you handle the rollback plan?" });
    expect(s().followUp.questionId).toBe(s().questions[1].id);
    expect(s().transcript.map((x) => x.questionId)).toEqual([s().questions[0].id, s().questions[0].id, s().questions[1].id]);
    expect(s().timeline.filter((e) => e.kind === "interviewer-speech")).toHaveLength(2);
    expect(s().timeline.filter((e) => e.kind === "candidate-speech")).toHaveLength(1);
  });

  it("a question while re-observing is the follow-up being spoken, not a new Question", () => {
    ingestSegment({ speaker: "candidate", start: 1_000, end: 2_000, text: "Hello there." });
    store.set({ session: { ...s(), followUp: { ...s().followUp, phase: "re_observing", reObserveUntil: 90_000 } } });
    at(60_000);
    ingestSegment({ speaker: "interviewer", start: 58_000, end: 60_000, text: "Could you walk me through your exact part in that?" });
    expect(s().questions).toHaveLength(1);
    expect(s().transcript.at(-1)!.speaker).toBe("interviewer");
  });

  it("mixed (one mic): questions are Interviewer speech, other lines Candidate speech", () => {
    at(30_000);
    ingestSegment({ speaker: "mixed", start: 1_000, end: 3_000, text: "So I mostly worked on the payment service." });
    ingestSegment({ speaker: "mixed", start: 25_000, end: 29_000, text: "What was the hardest bug you fixed there?" });
    expect(s().timeline.filter((e) => e.kind.includes("speech")).map((e) => e.kind)).toEqual(["candidate-speech", "interviewer-speech"]);
    expect(s().questions).toHaveLength(2);
  });
});
