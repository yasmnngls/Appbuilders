import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractOutput } from "../llm/contract";
import { findBanned, OBSERVATION_WORDS } from "../llm/guard";
import { contextFor, MAX_ANSWER_CHARS } from "./answer";
import { analyzeAnswer, gapIdOf, gapTemplate, topicOf } from "./gaps";
import { CASES, caseSession, HERO_ANSWER, HERO_QUESTION, type FollowUpCase } from "./testing/followUpCases";

const chat = vi.hoisted(() => ({ fn: vi.fn(), fail: null as Error | null }));
vi.mock("../llm/ollama", () => ({
  chatJSON: async (...a: unknown[]) => {
    const r = chat.fn(...a);
    if (chat.fail) throw chat.fail;
    return r;
  },
  currentModel: () => "qwen2.5:3b",
  lastLatencyMs: () => 1234,
}));

const { writeSuggestion, fallbackSuggestion, NO_TRANSCRIPT_REASON } = await import("../llm/moments");

const byId = (id: string) => CASES.find((c) => c.id === id) as FollowUpCase;
const NOTE = "A reading-like gaze pattern was observed during Q2.";
const out = (o: Partial<ContractOutput>): ContractOutput => ({
  answer_covers_question: false, gap: null, reason: "The answer leaves one area unclear.", follow_up: null, interviewer_note: NOTE, ...o,
});
/** A mocked model that targets the analyzer's first offered gap with the given follow-up. */
const modelSays = (o: Partial<ContractOutput>) => chat.fn.mockResolvedValue(out(o));

beforeEach(() => {
  chat.fn.mockReset();
  chat.fail = null;
});
afterEach(() => vi.useRealTimers());

describe("analyzeAnswer", () => {
  it("A: a complete answer has no gaps", () => {
    const a = analyzeAnswer(byId("A").answer);
    expect(a).toMatchObject({ complete: true, tooBrief: false, gaps: [] });
    expect(a.covered).toEqual(expect.arrayContaining(["personal actions", "specific steps", "the result"]));
  });

  it("B: team but not self is a personal-contribution gap, with the evidence", () => {
    const a = analyzeAnswer(byId("B").answer);
    expect(a.gaps.map((g) => g.id)).toEqual(["personal"]);
    expect(a.gaps[0].reason).toMatch(/"we" ×2/);
    expect(a.gaps[0].reason).toMatch(/not what the Candidate personally did/);
  });

  it("C: a vague action with no how-detail is a specific-steps gap", () => {
    const a = analyzeAnswer(byId("C").answer);
    expect(a.gaps.map((g) => g.id)).toEqual(["steps"]);
    expect(a.gaps[0].reason).toBe('The answer says "solved" but not how it was done.');
  });

  it("D: situation and action without a result is an outcome gap", () => {
    expect(analyzeAnswer(byId("D").answer).gaps.map((g) => g.id)).toEqual(["outcome"]);
  });

  it("hero demo: personal, steps and outcome are all unclear, in that order", () => {
    expect(analyzeAnswer(HERO_ANSWER).gaps.map((g) => g.id)).toEqual(["personal", "steps", "outcome"]);
  });

  it("too brief to judge is not a gap", () => {
    expect(analyzeAnswer("We fixed it quickly.")).toMatchObject({ tooBrief: true, complete: false, gaps: [] });
  });

  it("a how-detail clears the steps gap; a number clears the outcome gap", () => {
    expect(analyzeAnswer("The deploy was failing, and I fixed it by rolling back the schema migration first.").gaps.map((g) => g.id)).toEqual(["outcome"]);
    expect(analyzeAnswer("The deploy was failing, and I fixed it by rolling back the migration, which cut errors by 90%.").complete).toBe(true);
  });

  it("first-person concrete action clears the personal gap; 'I worked on' does not", () => {
    expect(analyzeAnswer("Our team built a new search page and I designed the ranking rules for it in the end.").gaps.map((g) => g.id)).not.toContain("personal");
    expect(analyzeAnswer("I worked on the search page with the team and it was launched last year.").gaps.map((g) => g.id)).toContain("personal");
  });
});

describe("topics and templates", () => {
  it("picks the answer's own topic noun", () => {
    expect(topicOf(HERO_ANSWER)).toBe("backend");
    expect(topicOf(byId("B").answer)).toBe("reporting dashboard");
    expect(topicOf(byId("F").answer)).toBe("billing database");
  });

  it("fills templates from the answer", () => {
    expect(gapTemplate("personal", HERO_ANSWER)).toBe("What did you personally do on the backend?");
    expect(gapTemplate("steps", byId("C").answer)).toBe("What specific steps did you take to solve the problem?");
    expect(gapTemplate("steps", HERO_ANSWER)).toBe("What specific steps did you take to finish the backend?");
    expect(gapTemplate("outcome", byId("D").answer)).toBe("What happened as a result?");
    expect(gapTemplate("personal", "We did a lot of things over many weeks and it was fine.")).toBe("What did you personally do in that situation?");
  });

  it("templates never point at the observation and use no banned word", () => {
    for (const c of CASES) {
      for (const g of ["personal", "steps", "outcome"] as const) {
        const t = gapTemplate(g, c.answer);
        expect(findBanned(t)).toEqual([]);
        for (const w of OBSERVATION_WORDS) expect(t.toLowerCase()).not.toMatch(new RegExp(`\\b${w}\\b`));
        expect(t.endsWith("?")).toBe(true);
      }
    }
  });

  it("maps free-text gap names", () => {
    expect(gapIdOf("personal contribution")).toBe("personal");
    expect(gapIdOf("specific steps")).toBe("steps");
    expect(gapIdOf("outcome")).toBe("outcome");
    expect(gapIdOf("teamwork")).toBe(null);
  });
});

describe("contextFor", () => {
  it("uses the spoken question, Candidate speech only, and the previous follow-ups", () => {
    const { session } = caseSession(byId("G"));
    const ctx = contextFor(session, "q2", Infinity);
    expect(ctx.question).toBe(HERO_QUESTION);
    expect(ctx.answer).toBe(HERO_ANSWER);
    expect(ctx.answerWords).toBe(18);
    expect(ctx.previousFollowUps).toEqual(["What did you personally do on the backend?"]);
    expect(ctx.askedGaps).toEqual(["personal"]);
    expect(ctx.recentExchange[0]).toEqual({ speaker: "interviewer", text: HERO_QUESTION });
  });

  it("falls back to the label, skips mixed question segments and clips long answers to the end", () => {
    const { session } = caseSession({ question: "x", answer: "", kind: "off-screen" });
    session.questions[1] = { ...session.questions[1], text: undefined, label: "System design" };
    const long = "word ".repeat(400).trim();
    session.transcript = [
      { id: "m1", speaker: "mixed", start: 60_000, end: 61_000, text: "How would you design it?", questionId: "q2" },
      { id: "m2", speaker: "mixed", start: 62_000, end: 70_000, text: `${long} final`, questionId: "q2" },
      { id: "o", speaker: "candidate", start: 1000, end: 2000, text: "other question", questionId: "q1" },
    ];
    const ctx = contextFor(session, "q2", Infinity);
    expect(ctx.question).toBe("System design");
    expect(ctx.answer.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS + 1);
    expect(ctx.answer.endsWith("final")).toBe(true);
    expect(ctx.answer).not.toMatch(/design it|other question/);
  });
});

describe("writeSuggestion: the conversation decides", () => {
  it("A: complete answer: no follow-up, and the model is not asked", async () => {
    const { session, moment } = caseSession(byId("A"));
    const s = await writeSuggestion(session, moment);
    expect(s.followUp).toBeNull();
    expect(s.reasoning).toMatchObject({ gap: null, basis: "transcript" });
    expect(s.reasoning.reason).toMatch(/^The answer covers .* no follow-up suggested\.$/);
    expect(chat.fn).not.toHaveBeenCalled();
  });

  it("B: targets personal contribution", async () => {
    modelSays({ gap: "personal contribution", follow_up: "What was your own part in rebuilding the reporting dashboard?" });
    const { session, moment } = caseSession(byId("B"));
    const s = await writeSuggestion(session, moment);
    expect(s).toMatchObject({ source: "llm", followUp: "What was your own part in rebuilding the reporting dashboard?" });
    expect(s.reasoning.gap).toBe("personal contribution");
  });

  it("C: targets specific steps", async () => {
    modelSays({ gap: "specific steps", follow_up: "How did you track down the login bug, step by step?" });
    const { session, moment } = caseSession(byId("C"));
    const s = await writeSuggestion(session, moment);
    expect(s.reasoning.gap).toBe("specific steps");
    expect(s.followUp).toMatch(/login/);
  });

  it("D: targets the outcome", async () => {
    modelSays({ gap: "outcome", follow_up: "What happened to the payment service after you added the retries?" });
    const { session, moment } = caseSession(byId("D"));
    const s = await writeSuggestion(session, moment);
    expect(s.reasoning.gap).toBe("outcome");
  });

  it("E: Flag + complete answer: no follow-up even if the model offers one", async () => {
    modelSays({ gap: "specific steps", follow_up: "Could you walk me through how you added the index?" });
    const { session, moment } = caseSession(byId("E"));
    const s = await writeSuggestion(session, moment);
    expect(s.followUp).toBeNull();
    expect(chat.fn).not.toHaveBeenCalled();
    expect(s.note).toMatch(/reading-like gaze pattern/);
  });

  it("F: Flag + gap: a targeted follow-up reusing the answer's topic word", async () => {
    modelSays({ gap: "personal contribution", follow_up: "What did you personally handle during the billing database cutover?" });
    const { session, moment } = caseSession(byId("F"));
    const s = await writeSuggestion(session, moment);
    expect(s.followUp).toMatch(/billing database/);
    expect(s.reasoning.gap).toBe("personal contribution");
    // The template path reuses the topic too.
    expect(fallbackSuggestion(session, moment).followUp).toBe("What did you personally do on the billing database?");
  });

  it("G: an asked gap is never targeted again, and the text is not repeated", async () => {
    modelSays({ gap: "personal contribution", follow_up: "What did you personally do on the backend?" });
    const { session, moment } = caseSession(byId("G"));
    const s = await writeSuggestion(session, moment);
    expect(s.reasoning.gap).not.toBe("personal contribution");
    expect(s.followUp).not.toBe("What did you personally do on the backend?");
    expect(s.followUp).toBe("What specific steps did you take to finish the backend?");
    expect(s.source).toBe("fallback");
    // The retry told the model why.
    expect(String(chat.fn.mock.calls[1][1])).toMatch(/already followed up/);
  });

  it("G: with no un-asked gap left, no follow-up", async () => {
    modelSays({ gap: "personal contribution", follow_up: "What was your part on the dashboard?" });
    const { session, moment } = caseSession(byId("G2"));
    const s = await writeSuggestion(session, moment);
    expect(s.followUp).toBeNull();
    expect(s.reasoning.reason).toMatch(/already followed up/);
    expect(chat.fn).not.toHaveBeenCalled();
  });

  it("no transcript: no follow-up, basis no-transcript, observation note kept", async () => {
    const { session, moment } = caseSession({ question: HERO_QUESTION, answer: "", kind: "off-screen" });
    session.asr = { available: false, model: null };
    session.transcript = [];
    const s = await writeSuggestion(session, moment);
    expect(s).toMatchObject({ followUp: null, quality: null });
    expect(s.reasoning).toMatchObject({ basis: "no-transcript", gap: null, reason: NO_TRANSCRIPT_REASON });
    expect(s.note).toMatch(/Gaze moved outside the usual range during Q2/);
    expect(chat.fn).not.toHaveBeenCalled();
  });

  it("too brief: no follow-up", async () => {
    const { session, moment } = caseSession({ question: HERO_QUESTION, answer: "Yes, a web app.", kind: "off-screen" });
    const s = await writeSuggestion(session, moment);
    expect(s.followUp).toBeNull();
    expect(s.reasoning.reason).toMatch(/too brief to judge \(4 words\)/);
  });

  it("an observation-based question from the model is rejected and the template is used", async () => {
    modelSays({ gap: "personal contribution", follow_up: "Were you reading something while talking about the backend?" });
    const { session, moment } = caseSession(byId("HERO"));
    const s = await writeSuggestion(session, moment);
    expect(chat.fn).toHaveBeenCalledTimes(2);
    expect(s).toMatchObject({ source: "fallback", followUp: "What did you personally do on the backend?" });
    expect(s.reasoning.gap).toBe("personal contribution");
  });

  it("the model saying the answer covers the question means no follow-up (conservative)", async () => {
    modelSays({ answer_covers_question: true, gap: null, follow_up: null });
    const { session, moment } = caseSession(byId("B"));
    const s = await writeSuggestion(session, moment);
    expect(s.followUp).toBeNull();
    expect(s.source).toBe("llm");
  });

  it("a failing model falls back to the gap template", async () => {
    chat.fail = new Error("HTTP 500");
    const { session, moment } = caseSession(byId("C"));
    const s = await writeSuggestion(session, moment);
    expect(s).toMatchObject({ source: "fallback", followUp: "What specific steps did you take to solve the problem?" });
  });

  it("a model gap name outside the analyzer's gaps is traced to the analyzer's first open gap", async () => {
    modelSays({ gap: "teamwork", follow_up: "What did you personally do during the billing database cutover?" });
    const { session, moment } = caseSession(byId("F"));
    const s = await writeSuggestion(session, moment);
    expect(s.source).toBe("llm");
    expect(s.reasoning.gap).toBe("personal contribution");
  });

  it("hero demo: targets personal contribution around the backend", async () => {
    modelSays({ gap: "personal contribution", follow_up: "What specifically did you do when the backend problems came up?" });
    const { session, moment } = caseSession(byId("HERO"));
    const s = await writeSuggestion(session, moment);
    expect(s).toMatchObject({ source: "llm", followUp: "What specifically did you do when the backend problems came up?" });
    expect(s.reasoning).toMatchObject({ question: HERO_QUESTION, answer: HERO_ANSWER, gap: "personal contribution", basis: "transcript" });
    expect(s.quality).toEqual({ specific: true, neutral: true, grounded: true });
    // Without the model, the template still lands on the backend.
    expect(fallbackSuggestion(session, moment).followUp).toBe("What did you personally do on the backend?");
  });

  it("the model input carries the conversation, the open gaps, and the observation as context only", async () => {
    modelSays({ gap: "specific steps", follow_up: "What specific steps did you take on the backend?" });
    const { session, moment } = caseSession(byId("G"));
    await writeSuggestion(session, moment);
    const input = JSON.parse(String(chat.fn.mock.calls[0][1]).split("\n").slice(1).join("\n"));
    expect(Object.keys(input).sort()).toEqual(
      ["candidate_answer", "final", "follow_up_count", "gate_reason", "gaps", "max_follow_ups", "observation", "previous_follow_ups", "question", "recent_exchange"].sort(),
    );
    expect(input.question).toBe(HERO_QUESTION);
    expect(input.candidate_answer).toBe(HERO_ANSWER);
    expect(input.previous_follow_ups).toEqual(["What did you personally do on the backend?"]);
    expect(input.gaps.map((g: { gap: string }) => g.gap)).toEqual(["specific steps", "outcome"]);
    expect(input.follow_up_count).toBe(1);
    expect(JSON.stringify(input)).not.toMatch(/Sample/);
  });

  it("waits for the Candidate's utterance to end, then reads the latest transcript", async () => {
    vi.useFakeTimers();
    const { session, moment } = caseSession({ question: HERO_QUESTION, answer: "", kind: "off-screen" });
    let speaking = true;
    const later = caseSession(byId("A")).session;
    const p = writeSuggestion(session, moment, undefined, { candidateSpeaking: () => speaking, latest: () => later });
    await vi.advanceTimersByTimeAsync(2000);
    speaking = false;
    await vi.advanceTimersByTimeAsync(300);
    const s = await p;
    expect(s.reasoning.basis).toBe("transcript");
    expect(s.reasoning.answer).toBe(byId("A").answer);
  });

  it("stops waiting after 8 s even if speech continues", async () => {
    vi.useFakeTimers();
    modelSays({ gap: "personal contribution", follow_up: "What specifically did you do when the backend problems came up?" });
    const { session, moment } = caseSession(byId("HERO"));
    const p = writeSuggestion(session, moment, undefined, { candidateSpeaking: () => true });
    await vi.advanceTimersByTimeAsync(8_500);
    const s = await p;
    expect(s.followUp).toBe("What specifically did you do when the backend problems came up?");
  });
});

describe("traceability", () => {
  it("every non-null follow-up carries the question, the answer and one of the analyzer's gaps", async () => {
    const replies: Partial<ContractOutput>[] = [
      { gap: "personal contribution", follow_up: "What did you personally do on that work?" },
      { gap: "specific steps", follow_up: "Which steps did you take first?" },
      { gap: "outcome", follow_up: "What happened next?" },
      { gap: null, follow_up: "Were you looking at notes?" },
    ];
    for (const reply of replies) {
      for (const c of CASES) {
        chat.fn.mockReset();
        modelSays(reply);
        const { session, moment } = caseSession(c);
        const s = await writeSuggestion(session, moment);
        const gaps = analyzeAnswer(c.answer).gaps.map((g) => g.label);
        if (c.expect.followUp === "none") expect(s.followUp, c.id).toBeNull();
        if (s.followUp === null) continue;
        expect(s.reasoning.question, c.id).toBe(c.question);
        expect(s.reasoning.answer, c.id).toBe(c.answer);
        expect(gaps, c.id).toContain(s.reasoning.gap);
        if (c.expect.notGaps) expect(c.expect.notGaps.map((g) => gapIdOf(g))).not.toContain(gapIdOf(s.reasoning.gap));
        expect(findBanned(`${s.followUp} ${s.note} ${s.reasoning.reason}`), c.id).toEqual([]);
        expect(s.followUp, c.id).not.toMatch(/\b(look|looking|notes|reading|screen|eyes?)\b/i);
      }
    }
  });
});
