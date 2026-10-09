import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Flag, Moment, Session, TimelineEvent } from "../domain/types";
import { LLM } from "./config";
import { buildContractInput, CONTRACT_SYSTEM, UNLABELLED_QUESTION, type ContractInput, type ContractOutput } from "./contract";
import { checkQuality, findBanned } from "./guard";
import { fallbackSuggestion, writeSuggestion } from "./moments";
import { describeFlags, formatTime } from "./notes";
import { chatJSON, checkOllama, currentModel, isLightweight, lastLatencyMs, onModelChange, setOllamaBase, warmUp } from "./ollama";
import { buildJourneys, fallbackReport, generateReport, journeysText, toJSON, toMarkdown } from "./report";

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const LABEL = "Tell me about a difficult project";

function moment(over: Partial<Moment> = {}): Moment {
  return {
    id: "m1",
    questionId: "q2",
    t: 90000,
    kind: "reading-pattern",
    origin: "gate",
    reason: "reading-like pattern held for 8 s",
    flagIds: ["f2"],
    followUpNumber: 1,
    note: null,
    followUp: null,
    quality: null,
    suggestion: "generating",
    decision: "pending",
    askedAt: null,
    result: null,
    ...over,
  };
}

/** A small Session with three questions; Q2 has Flags. */
function makeSession(): Session {
  return {
    candidateName: "Alex Doe",
    consentAt: Date.UTC(2026, 9, 9, 9, 0, 0),
    startedAt: Date.UTC(2026, 9, 9, 9, 0, 5),
    endedAt: Date.UTC(2026, 9, 9, 9, 5, 5),
    source: "window",
    speechAvailable: true,
    llmModel: "qwen2.5:3b",
    baseline: { centreX: 1, centreY: -2, spreadX: 3, spreadY: 2 },
    questions: [
      { id: "q1", number: 1, label: "Introduction", start: 0 },
      { id: "q2", number: 2, label: LABEL, start: 60000 },
      { id: "q3", number: 3, label: "Question 3", start: 200000 },
    ],
    flags: [
      { id: "f1", kind: "off-screen", start: 72000, end: 76500, questionId: "q2", detail: "gaze held to the right" },
      { id: "f2", kind: "reading-pattern", start: 80000, end: 88000, questionId: "q2", detail: "5 left-to-right sweeps", evidence: { cycles: 5 } },
      { id: "f3", kind: "face-missing", start: 95000, end: null, questionId: "q2" },
    ],
    moments: [],
    followUp: { questionId: "q2", phase: "worth_exploring", used: 0, reObserveUntil: null, momentId: "m1", watchFrom: 60000, askedMomentId: null },
    timeline: [],
    report: null,
  };
}

const chatResponse = (content: unknown) =>
  new Response(JSON.stringify({ message: { role: "assistant", content: JSON.stringify(content) } }), { status: 200 });
const tagsResponse = (...names: string[]) => new Response(JSON.stringify({ models: names.map((name) => ({ name })) }));

const GOOD: ContractOutput = {
  moment_worth_exploring: true,
  interviewer_note: "A reading-like gaze pattern was observed during Q2 (the project question).",
  follow_up: "Could you walk me through how you scoped the project?",
  quality: { specific: true, neutral: true, grounded: true },
};

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, i: number) {
  return JSON.parse((fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].body as string);
}

async function selectModels(...names: string[]) {
  vi.stubGlobal("fetch", vi.fn(async () => tagsResponse(...names)));
  await checkOllama();
}

beforeEach(async () => {
  setOllamaBase("http://ollama.test");
  await selectModels("qwen2.5:3b");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("notes helpers", () => {
  it("formats time and describes overlapping Flags", () => {
    const s = makeSession();
    expect(formatTime(95000)).toBe("1:35");
    expect(describeFlags(s, 70000, 77000)).toBe(`- Looking off-screen, 1:12–1:16 (5s), during Q2 "${LABEL}": gaze held to the right`);
    expect(describeFlags(s, 0, 60000)).toBe("");
  });
});

describe("buildContractInput", () => {
  it("gives exactly the §28 keys with the Moment's Flags first", () => {
    const s = makeSession();
    const input = buildContractInput(s, moment({ flagIds: ["f2"], t: 100000 }));
    expect(Object.keys(input).sort()).toEqual(["final", "follow_up_count", "gate_reason", "max_follow_ups", "question", "recent_flags"]);
    expect(input.question).toBe(LABEL);
    expect(input.recent_flags[0]).toEqual({ type: "reading_pattern", timestamp: "1:20", description: expect.stringContaining("Reading pattern") });
    expect(input.recent_flags.map((f) => f.type)).toEqual(["reading_pattern", "face_missing", "off_screen"]);
    expect(input).toMatchObject({ follow_up_count: 0, max_follow_ups: 2, gate_reason: "reading-like pattern held for 8 s", final: false });
    expect(JSON.stringify(input)).not.toMatch(/data:|blob:/);
  });

  it("caps at 6 Flags and marks the final follow-up", () => {
    const s = makeSession();
    for (let i = 0; i < 10; i++) s.flags.push({ id: `x${i}`, kind: "off-screen", start: 100000 + i * 1000, end: 100500 + i * 1000, questionId: "q2" });
    const input = buildContractInput(s, moment({ flagIds: ["f2"], t: 115000, followUpNumber: 2 }));
    expect(input.recent_flags).toHaveLength(6);
    expect(input.recent_flags[0].type).toBe("reading_pattern");
    expect(input.final).toBe(true);
  });

  it("uses the unlabelled wording for default labels and Introduction for Q1", () => {
    const s = makeSession();
    s.flags.push({ id: "f9", kind: "second-face", start: 210000, end: 215000, questionId: "q3" });
    expect(buildContractInput(s, moment({ questionId: "q3", flagIds: ["f9"], t: 216000 })).question).toBe(UNLABELLED_QUESTION);
    expect(buildContractInput(s, moment({ questionId: "q1", flagIds: [], t: 30000 })).question).toBe("Introduction");
  });
});

describe("chatJSON", () => {
  it("sends format, temperature 0, keep_alive and leaves think out for qwen2.5", async () => {
    const fetchMock = vi.fn(async () => chatResponse({ a: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const schema = { type: "object", properties: { a: { type: "number" } } };
    await expect(chatJSON("sys", "usr", schema)).resolves.toEqual({ a: 1 });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("http://ollama.test/api/chat");
    const body = bodyOf(fetchMock, 0);
    expect(body).toMatchObject({ model: "qwen2.5:3b", stream: false, format: schema, options: { temperature: 0 }, keep_alive: "30m" });
    expect(body).not.toHaveProperty("think");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    expect(lastLatencyMs()).not.toBeNull();
  });

  it("sends think:false for qwen3", async () => {
    await selectModels("qwen3:4b");
    const fetchMock = vi.fn(async () => chatResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    await chatJSON("s", "u", {});
    expect(bodyOf(fetchMock, 0)).toMatchObject({ model: "qwen3:4b", think: false });
  });

  it("throws on HTTP failure and bad JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(chatJSON("s", "u", {})).rejects.toThrow(/HTTP 500/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: { content: "not json" } }))));
    await expect(chatJSON("s", "u", {})).rejects.toThrow(/invalid JSON/);
  });

  it("steps down to the next installed model after a 9 s call, and reports it", async () => {
    await selectModels("qwen3:4b", "qwen2.5:3b");
    expect(isLightweight()).toBe(false);
    const changes: (string | null)[] = [];
    const off = onModelChange((m) => changes.push(m));
    const clock = [0, 9000, 10000, 10500];
    vi.spyOn(performance, "now").mockImplementation(() => clock.shift() ?? 20000);
    const fetchMock = vi.fn(async () => chatResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    await chatJSON("s", "u", {});
    expect(lastLatencyMs()).toBe(9000);
    await chatJSON("s", "u", {});
    expect(bodyOf(fetchMock, 0).model).toBe("qwen3:4b");
    expect(bodyOf(fetchMock, 1).model).toBe("qwen2.5:3b");
    expect(currentModel()).toBe("qwen2.5:3b");
    expect(isLightweight()).toBe(true);
    expect(changes).toEqual(["qwen2.5:3b"]);
    off();
  });

  it("runs one request at a time", async () => {
    const resolvers: ((r: Response) => void)[] = [];
    const fetchMock = vi.fn(() => new Promise<Response>((r) => resolvers.push(r)));
    vi.stubGlobal("fetch", fetchMock);
    const a = chatJSON("s", "first", {});
    const b = chatJSON("s", "second", {});
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolvers[0](chatResponse({ n: 1 }));
    await expect(a).resolves.toEqual({ n: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).messages[1].content).toBe("second");
    resolvers[1](chatResponse({ n: 2 }));
    await expect(b).resolves.toEqual({ n: 2 });
  });
});

describe("findBanned", () => {
  it("catches whole words case-insensitively", () => {
    expect(findBanned("Cheating is not observed")).toEqual(["cheating"]);
    expect(findBanned("He lied.")).toEqual(["lied"]);
    expect(findBanned("RISK")).toEqual(["risk"]);
    expect(findBanned("two risks")).toEqual(["risk"]);
  });
  it("ignores words that merely contain a banned word", () => {
    expect(findBanned("earlier I believe the liability relied on a lieutenant")).toEqual([]);
  });
});

describe("checkQuality", () => {
  const input: ContractInput = { question: LABEL, recent_flags: [], follow_up_count: 0, max_follow_ups: 2, gate_reason: "x", final: false };
  it("rejects follow-ups that point at the observation", () => {
    const q = checkQuality({ ...GOOD, follow_up: "Were you reading something?" }, input);
    expect(q.neutral).toBe(false);
    expect(q.problems.join(" ")).toMatch(/reading/);
  });
  it("accepts a specific, neutral, grounded follow-up", () => {
    expect(checkQuality(GOOD, input)).toMatchObject({ specific: true, neutral: true, grounded: true, problems: [] });
  });
  it("flags banned words in the note", () => {
    expect(checkQuality({ ...GOOD, interviewer_note: "The candidate seems nervous in Q2." }, input).neutral).toBe(false);
  });
  it("treats unlabelled questions as grounded", () => {
    const q = checkQuality({ ...GOOD, follow_up: "Could you walk me through a specific example of that?" }, { ...input, question: UNLABELLED_QUESTION });
    expect(q.grounded).toBe(true);
  });
});

describe("writeSuggestion", () => {
  it("returns the model's answer when it passes", async () => {
    const fetchMock = vi.fn(async () => chatResponse(GOOD));
    vi.stubGlobal("fetch", fetchMock);
    const s = await writeSuggestion(makeSession(), moment());
    expect(s).toMatchObject({ source: "llm", note: GOOD.interviewer_note, followUp: GOOD.follow_up, model: "qwen2.5:3b", quality: { specific: true, neutral: true, grounded: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock, 0).messages[0].content).toBe(CONTRACT_SYSTEM);
  });

  it("retries once after a banned word", async () => {
    const answers = [{ ...GOOD, interviewer_note: "The candidate may be cheating in Q2." }, GOOD];
    const fetchMock = vi.fn(async () => chatResponse(answers.shift()));
    vi.stubGlobal("fetch", fetchMock);
    const s = await writeSuggestion(makeSession(), moment());
    expect(s.source).toBe("llm");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).messages[1].content).toMatch(/Your previous answer was rejected because: .*cheating.*Write it again\./s);
  });

  it("falls back after two bad answers", async () => {
    const fetchMock = vi.fn(async () => chatResponse({ ...GOOD, follow_up: "Were you looking at notes?" }));
    vi.stubGlobal("fetch", fetchMock);
    const s = await writeSuggestion(makeSession(), moment());
    expect(s.source).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back on HTTP 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(writeSuggestion(makeSession(), moment())).resolves.toMatchObject({ source: "fallback" });
  });

  it("falls back on timeout and never throws", async () => {
    const saved = LLM.timeoutMs;
    LLM.timeoutMs = 30;
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_r, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
        ),
      );
      const s = await writeSuggestion(makeSession(), moment());
      expect(s.source).toBe("fallback");
      expect(s.note).toBe("A reading-like gaze pattern was observed during Q2 (5 line sweeps).");
    } finally {
      LLM.timeoutMs = saved;
    }
  });

  it("falls back when Ollama is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const t0 = performance.now();
    await expect(writeSuggestion(makeSession(), moment())).resolves.toMatchObject({ source: "fallback" });
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe("fallbackSuggestion", () => {
  it("writes the plan's note per kind and the follow-up per slot", () => {
    const s = makeSession();
    s.flags.push({ id: "f4", kind: "second-face", start: 100000, end: 104000, questionId: "q2" });
    expect(fallbackSuggestion(s, moment({ kind: "off-screen", flagIds: ["f1"], reason: "3 off-screen glances within 60s" })).note).toBe(
      "Gaze moved outside the usual range during Q2 (3 off-screen glances within 60s).",
    );
    expect(fallbackSuggestion(s, moment({ kind: "face-missing", flagIds: ["f3"], t: 101000 })).note).toBe("The face was out of view for 6 s during Q2.");
    expect(fallbackSuggestion(s, moment({ kind: "second-face", flagIds: ["f4"] })).note).toBe("A second face was visible for 4 s during Q2.");
    expect(fallbackSuggestion(s, moment()).followUp).toBe("Could you walk me through what you personally did in that situation?");
    const final = fallbackSuggestion(s, moment({ followUpNumber: 2 }));
    expect(final.followUp).toBe("Could you give me one specific example, step by step, of how you handled that?");
    expect(final.quality.neutral).toBe(true);
    expect(final.quality.specific).toBe(true);
  });
});

/** A finished Session exercising every report path. */
function finishedSession(): Session {
  const s = makeSession();
  const ev = (t: number, kind: TimelineEvent["kind"], questionId: string, text: string): TimelineEvent => ({ t, kind, questionId, text });
  s.questions.push({ id: "q4", number: 4, label: "Describe a system you designed", start: 230000 });
  s.questions.push({ id: "q5", number: 5, label: "How do you handle deadlines", start: 260000 });
  const f = (id: string, questionId: string, start: number): Flag => ({ id, kind: "off-screen", start, end: start + 2000, questionId });
  s.flags.push(f("f5", "q3", 205000), f("f6", "q4", 235000), f("f7", "q5", 265000));
  s.moments = [
    moment({ id: "m1", decision: "asked", askedAt: 92000, followUp: "Could you walk me through how you scoped the project?", result: "settled" }),
    moment({ id: "m2", questionId: "q4", flagIds: ["f6"], t: 237000, kind: "off-screen", followUp: "Never asked: how did you design it?", decision: "dismissed" }),
    moment({ id: "m3", questionId: "q5", flagIds: ["f7"], t: 267000, kind: "off-screen", followUp: "What did you decide first on the deadline?", decision: "asked", askedAt: 268000, result: "persisting" }),
    moment({ id: "m4", questionId: "q5", flagIds: ["f7"], t: 290000, kind: "off-screen", followUpNumber: 2, followUp: "Could you give one specific deadline example, step by step?", decision: "asked", askedAt: 291000, result: null }),
  ];
  s.timeline = [
    ev(0, "question", "q1", "Q1 started: Introduction"),
    ev(60000, "question", "q2", `Q2 started: ${LABEL}`),
    ev(90000, "moment", "q2", "Moment worth exploring: reading-like pattern"),
    ev(92000, "follow-up-asked", "q2", "Follow-up 1 asked"),
    ev(122000, "settled", "q2", "Pattern settled"),
    ev(300000, "session-end", "q5", "Session ended"),
  ];
  s.followUp = { questionId: "q5", phase: "re_observing", used: 2, reObserveUntil: 321000, momentId: "m4", watchFrom: 291000, askedMomentId: null };
  return s;
}

describe("buildJourneys", () => {
  it("gives the outcome for each phase path", () => {
    const j = buildJourneys(finishedSession());
    expect(j.map((x) => x.outcome)).toEqual(["none", "settled", "observed", "dismissed", "unresolved"]);
    expect(j[1].followUpsAsked).toEqual([{ text: "Could you walk me through how you scoped the project?", at: 92000, n: 1 }]);
    expect(j[4].followUpsAsked.map((a) => a.n)).toEqual([1, 2]);
  });
  it("maps continued, persisting and limit reached", () => {
    const s = finishedSession();
    s.moments[3] = { ...s.moments[3], result: "persisting" };
    s.moments[1] = { ...s.moments[1], decision: "continued" };
    let j = buildJourneys(s);
    expect(j[3].outcome).toBe("continued");
    expect(j[4].outcome).toBe("limit_reached");
    s.moments = s.moments.slice(0, 3);
    j = buildJourneys(s);
    expect(j[4].outcome).toBe("persisting");
  });
});

describe("report", () => {
  it("lists only follow-ups that were asked", async () => {
    const s = finishedSession();
    const fb = fallbackReport(s);
    expect(fb.perQuestion.map((p) => p.followUp)).toEqual([null, "Could you walk me through how you scoped the project?", null, null, "Could you give one specific deadline example, step by step?"]);
    vi.stubGlobal("fetch", vi.fn(async () => chatResponse({ summary: "Observations clustered in Q2 and Q5.", perQuestion: [{ questionNumber: 2, observation: "A reading-like pattern was observed and settled.", followUp: "Invented question?" }] })));
    const r = await generateReport(s);
    expect(r.summary).toBe("Observations clustered in Q2 and Q5.");
    expect(r.perQuestion[1]).toEqual({ questionId: "q2", observation: "A reading-like pattern was observed and settled.", followUp: "Could you walk me through how you scoped the project?" });
    expect(r.perQuestion[0].observation).toBe("No Flags during this question.");
    s.report = r;
    const md = toMarkdown(s);
    expect(md).not.toContain("Invented question");
    expect(md).not.toContain("Never asked");
    expect(journeysText(s)).not.toContain("Never asked");
  });

  it("falls back per field when the model uses a banned word or fails", async () => {
    const s = finishedSession();
    vi.stubGlobal("fetch", vi.fn(async () => chatResponse({ summary: "The candidate looked suspicious in Q2.", perQuestion: [{ questionNumber: 2, observation: "Possible deception." }, { questionNumber: 3, observation: "Gaze moved once." }] })));
    const r = await generateReport(s);
    const fb = fallbackReport(s);
    expect(r.summary).toBe(fb.summary);
    expect(r.perQuestion[1].observation).toBe(fb.perQuestion[1].observation);
    expect(r.perQuestion[2].observation).toBe("Gaze moved once.");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(generateReport(s)).resolves.toEqual(fb);
  });

  it("Markdown has every question, totals, timeline and the footer", () => {
    const md = toMarkdown(finishedSession());
    expect(md).toContain("Alex Doe");
    for (const h of ["## Q1 · Introduction · 0:00", `## Q2 · ${LABEL} · 1:00`, "## Q3 · Question 3", "## Q4 ·", "## Q5 ·"]) expect(md).toContain(h);
    expect(md).toContain("Pattern settled after follow-up.");
    expect(md).toContain("## Totals");
    expect(md).toContain("- Follow-ups used: 3");
    expect(md).toContain("## Session Timeline");
    expect(md).toContain("- 1:32 — Follow-up 1 asked");
    expect(md).toContain("meeting window");
    expect(md).toContain("Generated on-device. No video or images were stored or transmitted.");
    expect(findBanned(md)).toEqual([]);
  });

  it("JSON export holds no images", () => {
    const json = toJSON(finishedSession());
    expect(json).not.toMatch(/data:image|blob:/);
    expect(JSON.parse(json).moments).toHaveLength(4);
  });
});

/** Real calls against a local Ollama: OLLAMA_LIVE=1 npx vitest run src/llm */
describe.skipIf(!env.OLLAMA_LIVE)("live Ollama", () => {
  it("writes neutral suggestions for three real Moments and a report", async () => {
    vi.unstubAllGlobals();
    setOllamaBase("http://127.0.0.1:11434");
    expect(await checkOllama()).toBe(true);
    let t0 = performance.now();
    await warmUp();
    console.log(`model ${currentModel()} warmUp ${Math.round(performance.now() - t0)}ms`);
    const s = finishedSession();
    s.flags.push({ id: "f8", kind: "second-face", start: 100000, end: 104500, questionId: "q2", evidence: { faceCount: 2 } });
    s.flags.push({ id: "f10", kind: "off-screen", start: 110000, end: 117000, questionId: "q2" });
    s.followUp = { questionId: "q2", phase: "worth_exploring", used: 0, reObserveUntil: null, momentId: "m1", watchFrom: 60000, askedMomentId: null };
    const cases = [
      moment({ id: "L1", kind: "reading-pattern", flagIds: ["f2"], t: 90000, reason: "reading-like pattern with 5 line sweeps" }),
      moment({ id: "L2", kind: "off-screen", flagIds: ["f10"], t: 118000, reason: "gaze held outside the usual range for 7 s" }),
      moment({ id: "L3", kind: "second-face", flagIds: ["f8"], t: 105000, reason: "a second face visible for 4.5 s", followUpNumber: 2 }),
      moment({ id: "L4", questionId: "q3", kind: "off-screen", flagIds: ["f5"], t: 208000, reason: "3 off-screen glances within 60s" }),
    ];
    for (const m of cases) {
      t0 = performance.now();
      const sug = await writeSuggestion(s, m);
      console.log(`${m.id} ${m.kind}: ${Math.round(performance.now() - t0)}ms (call ${sug.latencyMs}ms) ${sug.source}`, JSON.stringify(sug));
      expect(sug.quality.neutral).toBe(true);
      expect(sug.source).toBe("llm");
    }
    t0 = performance.now();
    const report = await generateReport(s);
    console.log(`report ${Math.round(performance.now() - t0)}ms`, JSON.stringify(report, null, 2));
    expect(report.perQuestion).toHaveLength(5);
  }, 300000);
});
