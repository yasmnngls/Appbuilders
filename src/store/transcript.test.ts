import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendTranscript, clearSession, confirmConsent, nextQuestion, relabelQuestion, setAsr, startSession, store } from "./session";

const T0 = 1_700_000_000_000;
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const session = () => store.get().session!;

beforeEach(() => {
  vi.useFakeTimers();
  at(0);
  clearSession();
  confirmConsent("Ana");
  startSession({ source: "window", speechAvailable: true, llmModel: null, asr: { available: true, model: "base.en" } });
});
afterEach(() => vi.useRealTimers());

describe("transcript", () => {
  it("starts with the ASR status and an empty transcript", () => {
    expect(session().asr).toEqual({ available: true, model: "base.en" });
    expect(session().transcript).toEqual([]);
  });

  it("appends a segment and a clipped timeline event, assigned to the Question active at its start", () => {
    at(30_000);
    const q2 = nextQuestion("Projects")!;
    const long = "I led the migration of our billing system to a new event-driven architecture over about six months.";
    appendTranscript({ speaker: "candidate", start: 31_000, end: 38_000, text: long }, "candidate-speech");
    appendTranscript({ speaker: "interviewer", start: 10_000, end: 12_000, text: "Earlier remark" }, "interviewer-speech");
    const [a, b] = session().transcript;
    expect(a).toMatchObject({ speaker: "candidate", start: 31_000, end: 38_000, text: long, questionId: q2.id });
    expect(b.questionId).toBe(session().questions[0].id);
    const ev = session().timeline.find((e) => e.kind === "candidate-speech")!;
    expect(ev.text.startsWith("Candidate: “I led the migration")).toBe(true);
    expect(ev.text.length).toBeLessThan(100);
  });

  it("ignores empty text", () => {
    expect(appendTranscript({ speaker: "candidate", start: 0, end: 1, text: "  " }, "candidate-speech")).toBeNull();
    expect(session().transcript).toHaveLength(0);
  });

  it("relabels Q1 from speech and its timeline entry", () => {
    const q1 = session().questions[0];
    relabelQuestion(q1.id, "Tell me about your last project?", "Tell me about your last project");
    expect(session().questions[0]).toMatchObject({ origin: "spoken", text: "Tell me about your last project?", label: "Tell me about your last project" });
    expect(session().timeline[0].text).toContain("Q1 Tell me about your last project");
  });

  it("marks manual and spoken Questions", () => {
    expect(nextQuestion()!.origin).toBe("manual");
    expect(nextQuestion("Design", { origin: "spoken", text: "How would you design it?" })).toMatchObject({ origin: "spoken", text: "How would you design it?" });
  });

  it("setAsr updates the live Session and the Screen 2 status", () => {
    setAsr({ available: false, model: null });
    expect(session().asr.available).toBe(false);
    expect(store.get().asrStatus).toEqual({ available: false, model: null });
  });
});
