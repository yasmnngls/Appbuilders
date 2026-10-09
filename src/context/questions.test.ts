import { describe, expect, it } from "vitest";
import type { Question } from "../domain/types";
import { decideSpokenQuestion, looksLikeQuestion, shortLabel } from "./questions";

describe("looksLikeQuestion", () => {
  it.each([
    "Tell me about a project you're proud of.",
    "So, walk me through how you debugged that outage",
    "How did you decide which database to use",
    "Could you give me an example of a conflict on your team",
    "Okay, describe the architecture of your last system",
    "Do you have any questions for me?",
    "Any questions for me?",
    "You led the migration yourself, right?",
  ])("accepts %s", (t) => expect(looksLikeQuestion(t)).toBe(true));

  it.each([
    "Can you hear me okay?",
    "Can you see my screen now?",
    "Okay.",
    "Thank you so much for that.",
    "Why?",
    "What about it",
    "That sounds like a solid approach to me overall",
    "How are you doing today?",
  ])("rejects %s", (t) => expect(looksLikeQuestion(t)).toBe(false));
});

describe("shortLabel", () => {
  it("drops lead-ins and trailing punctuation, keeps it short", () => {
    expect(shortLabel("So, tell me about a project you're proud of?")).toBe("Tell me about a project you're proud of");
    expect(shortLabel("Walk me through how you would design a rate limiter for a public API")).toBe("Walk me through how you would design a…");
  });
});

describe("decideSpokenQuestion", () => {
  const q1: Question = { id: "q1", number: 1, label: "Introduction", start: 0 };
  const q2: Question = { id: "q2", number: 2, label: "Projects", start: 60_000, origin: "spoken", text: "x" };
  const base = {
    text: "Tell me about your most recent project",
    speaker: "interviewer" as const,
    t: 100_000,
    current: q2,
    phase: "observing" as const,
    lastAskAt: null,
    candidateSpokeInCurrent: true,
  };

  it("starts a new Question from an interviewer question", () => expect(decideSpokenQuestion(base)).toBe("new"));
  it("mixed speaker counts too", () => expect(decideSpokenQuestion({ ...base, speaker: "mixed" })).toBe("new"));
  it("ignores the Candidate", () => expect(decideSpokenQuestion({ ...base, speaker: "candidate" })).toBe("none"));
  it("ignores non-questions", () => expect(decideSpokenQuestion({ ...base, text: "That makes sense, thanks a lot" })).toBe("none"));
  it("waits ~20 s after the current Question started", () => expect(decideSpokenQuestion({ ...base, t: 70_000 })).toBe("none"));
  it("re-observing → the follow-up being spoken", () => expect(decideSpokenQuestion({ ...base, phase: "re_observing" })).toBe("follow-up"));
  it("just after Ask Follow-up → follow-up", () => expect(decideSpokenQuestion({ ...base, lastAskAt: 90_000 })).toBe("follow-up"));
  it("long after Ask Follow-up → new", () => expect(decideSpokenQuestion({ ...base, lastAskAt: 50_000 })).toBe("new"));
  it("relabels the auto Q1 before the Candidate speaks", () =>
    expect(decideSpokenQuestion({ ...base, current: q1, t: 5_000, candidateSpokeInCurrent: false })).toBe("relabel"));
  it("Q1 with Candidate speech → new Question (after 20 s)", () =>
    expect(decideSpokenQuestion({ ...base, current: q1, t: 30_000, candidateSpokeInCurrent: true })).toBe("new"));
  it("a manually marked Q1 is not relabelled", () =>
    expect(decideSpokenQuestion({ ...base, current: { ...q1, origin: "manual" }, t: 5_000, candidateSpokeInCurrent: false })).toBe("none"));
});
