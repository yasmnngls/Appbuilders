import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../domain/types";
/** A small Session with two questions and three Flags, shared by the llm tests. */
function makeSession(): Session {
  return {
    candidateName: "Alex Doe",
    consentAt: Date.UTC(2026, 9, 9, 9, 0, 0),
    startedAt: Date.UTC(2026, 9, 9, 9, 0, 5),
    endedAt: Date.UTC(2026, 9, 9, 9, 3, 5),
    source: "window",
    baseline: { centreX: 1, centreY: -2, spreadX: 3, spreadY: 2 },
    questions: [
      { id: "q1", number: 1, label: "Introduction", start: 0 },
      { id: "q2", number: 2, label: "Explain how a hash map handles collisions", start: 60000 },
    ],
    flags: [
      { id: "f1", kind: "off-screen", start: 72000, end: 76500, questionId: "q2", detail: "gaze held to the right" },
      { id: "f2", kind: "reading-pattern", start: 80000, end: 88000, questionId: "q2", detail: "5 left-to-right sweeps" },
      { id: "f3", kind: "face-missing", start: 95000, end: null, questionId: "q2" },
    ],
    notes: [],
    report: null,
  };
}
import { chatJSON, setOllamaBase } from "./ollama";
import { describeFlags, formatTime, generateNote, startNoteLoop } from "./notes";
import { generateReport, toMarkdown } from "./report";

const chatResponse = (content: unknown) =>
  new Response(JSON.stringify({ message: { role: "assistant", content: JSON.stringify(content) } }), { status: 200 });

beforeEach(() => setOllamaBase("http://ollama.test"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("describeFlags", () => {
  it("formats overlapping Flags with times, duration, question and detail", () => {
    const s = makeSession();
    expect(formatTime(95000)).toBe("1:35");
    expect(describeFlags(s, 70000, 100000)).toBe(
      [
        `- Looking off-screen, 1:12–1:16 (5s), during Q2 "Explain how a hash map handles collisions": gaze held to the right`,
        `- Reading pattern, 1:20–1:28 (8s), during Q2 "Explain how a hash map handles collisions": 5 left-to-right sweeps`,
        `- Face missing, 1:35–ongoing (5s so far), during Q2 "Explain how a hash map handles collisions"`,
      ].join("\n"),
    );
  });

  it("excludes Flags outside the window and returns empty string when none", () => {
    const s = makeSession();
    expect(describeFlags(s, 77000, 79000)).toBe("");
    expect(describeFlags(s, 0, 60000)).toBe("");
    expect(describeFlags(s, 200000, 230000)).toContain("Face missing");
  });
});

describe("chatJSON", () => {
  it("sends the schema as format with temperature 0 and parses content", async () => {
    const fetchMock = vi.fn(async () => chatResponse({ a: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const schema = { type: "object", properties: { a: { type: "number" } } };
    await expect(chatJSON("sys", "usr", schema)).resolves.toEqual({ a: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://ollama.test/api/chat");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ stream: false, format: schema, options: { temperature: 0 }, keep_alive: "30m" });
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
  });

  it("throws on HTTP failure and bad JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(chatJSON("s", "u", {})).rejects.toThrow(/HTTP 500/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: { content: "not json" } }))));
    await expect(chatJSON("s", "u", {})).rejects.toThrow(/invalid JSON/);
  });
});

describe("generateNote", () => {
  it("returns null without calling fetch when no Flags overlap", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateNote(makeSession(), 0, 30000)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the model's note", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chatResponse({ text: "During Q2 gaze held right.", followUp: null })));
    await expect(generateNote(makeSession(), 60000, 90000)).resolves.toEqual({ text: "During Q2 gaze held right.", followUp: null });
  });
});

describe("generateReport", () => {
  it("fills questions the model omitted from the fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        chatResponse({ summary: "Flags clustered in Q2.", perQuestion: [{ questionNumber: 2, observation: "Gaze off-screen then reading.", followUp: "Walk me through a collision you debugged." }] }),
      ),
    );
    const r = await generateReport(makeSession());
    expect(r.summary).toBe("Flags clustered in Q2.");
    expect(r.perQuestion.map((p) => p.questionId)).toEqual(["q1", "q2"]);
    expect(r.perQuestion[0].observation).toBe("No Flags during this question.");
    expect(r.perQuestion[1]).toEqual({ questionId: "q2", observation: "Gaze off-screen then reading.", followUp: "Walk me through a collision you debugged." });
  });
});

describe("toMarkdown", () => {
  it("contains every question and the privacy footer", () => {
    const s = makeSession();
    s.notes = [{ id: "n1", t: 90000, questionId: "q2", text: "During Q2 the Candidate read.", followUp: "Why that design?" }];
    const md = toMarkdown(s);
    expect(md).toContain("Alex Doe");
    expect(md).toContain("## Q1: Introduction");
    expect(md).toContain("## Q2: Explain how a hash map handles collisions");
    expect(md).toContain("meeting window");
    expect(md).toContain("During Q2 the Candidate read.");
    expect(md).toContain("Generated on-device. No video or images were stored or transmitted.");
    expect(md).not.toMatch(/cheat|lying|violation|suspicious/i);
  });
});

describe("startNoteLoop", () => {
  it("never overlaps calls and advances the window after success", async () => {
    vi.useFakeTimers();
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    const s = makeSession();
    let t = 100000;
    const onNote = vi.fn();
    const statuses: string[] = [];
    const stop = startNoteLoop({ intervalMs: 1000, getSession: () => s, now: () => t, onNote, onStatus: (x) => statuses.push(x) });

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(chatResponse({ text: "Face missing during Q2.", followUp: "Can you go on?" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onNote).toHaveBeenCalledWith({ t: 100000, questionId: "q2", text: "Face missing during Q2.", followUp: "Can you go on?" });
    expect(statuses).toEqual(["busy", "ready"]);

    t = 110000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[1].content).toContain("Window: 1:40–1:50");
    stop();
  });

  it("reports unavailable on error and keeps trying", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const statuses: string[] = [];
    const stop = startNoteLoop({ intervalMs: 1000, getSession: () => makeSession(), now: () => 100000, onNote: vi.fn(), onStatus: (x) => statuses.push(x) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(statuses).toEqual(["busy", "unavailable", "busy", "unavailable"]);
    stop();
  });
});

/** Real call against a local Ollama: OLLAMA_LIVE=1 npx vitest run src/llm */
describe.skipIf(!process.env.OLLAMA_LIVE)("live Ollama", () => {
  it("writes a real note and report", async () => {
    setOllamaBase("http://127.0.0.1:11434");
    const { checkOllama, warmUp } = await import("./ollama");
    expect(await checkOllama()).toBe(true);
    let t0 = performance.now();
    await warmUp();
    console.log(`warmUp ${Math.round(performance.now() - t0)}ms`);
    const s = makeSession();
    for (let i = 0; i < 3; i++) {
      t0 = performance.now();
      const note = await generateNote(s, 60000, 100000);
      console.log(`note ${Math.round(performance.now() - t0)}ms`, JSON.stringify(note));
      expect(note?.text).toBeTruthy();
    }
    t0 = performance.now();
    const report = await generateReport(s);
    console.log(`report ${Math.round(performance.now() - t0)}ms`, JSON.stringify(report, null, 2));
    expect(report.perQuestion).toHaveLength(2);
  }, 180000);
});
