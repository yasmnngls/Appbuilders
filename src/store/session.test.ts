import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Baseline } from "../domain/types";
import {
  applyFollowUp,
  applyTransitions,
  clearSession,
  confirmConsent,
  dismissFlag,
  endSession,
  nextQuestion,
  openMoment,
  selectScreen,
  setBaseline,
  setOpenFlag,
  setSourceReady,
  setSpeech,
  startSession,
  store,
  updateMoment,
  type LiveState,
} from "./session";

const T0 = 1_700_000_000_000;
const baseline: Baseline = { centreX: 0, centreY: 0, spreadX: 3, spreadY: 3 };
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const session = () => store.get().session!;

beforeEach(() => {
  vi.useFakeTimers();
  at(0);
  clearSession();
});
afterEach(() => vi.useRealTimers());

function begin() {
  confirmConsent("  Ana  ");
  startSession({ source: "webcam", speechAvailable: true, llmModel: "qwen3:4b" });
}

describe("selectScreen", () => {
  const base = () => store.get();
  it("derives every screen from state", () => {
    expect(selectScreen(base())).toBe("consent");
    confirmConsent("Ana");
    expect(selectScreen(store.get())).toBe("source");
    startSession({ source: "webcam", speechAvailable: false, llmModel: null });
    expect(store.get().draft).toBeNull();
    expect(selectScreen(store.get())).toBe("baseline");
    setBaseline(baseline);
    expect(selectScreen(store.get())).toBe("live");
    endSession();
    expect(selectScreen(store.get())).toBe("report");
  });
  it("is a pure function of the state passed in", () => {
    const s = { ...store.get(), draft: { candidateName: "x", consentAt: 1 } } as LiveState;
    expect(selectScreen(s)).toBe("source");
  });
});

describe("startSession", () => {
  it("creates Q1, the follow-up state and the first timeline entry from the draft", () => {
    begin();
    const s = session();
    expect(s.candidateName).toBe("Ana");
    expect(s.questions).toHaveLength(1);
    expect(s.questions[0]).toMatchObject({ number: 1, label: "Introduction", start: 0 });
    expect(s.followUp).toEqual({ questionId: s.questions[0].id, phase: "observing", used: 0, reObserveUntil: null, momentId: null, watchFrom: 0, askedMomentId: null });
    expect(s.timeline).toEqual([{ t: 0, kind: "question", questionId: s.questions[0].id, text: "Question started — Q1 Introduction" }]);
    expect(s.speechAvailable).toBe(true);
    expect(s.llmModel).toBe("qwen3:4b");
  });
});

describe("applyTransitions", () => {
  it("assigns a Flag to the Question active at its start, even if it ends in the next one (FR-007)", () => {
    begin();
    at(20_000);
    const q2 = nextQuestion("Tell me about a project")!;
    expect(q2.start).toBe(20_000);
    applyTransitions([{ kind: "off-screen", state: "start", t: 18_000 }]);
    applyTransitions([{ kind: "off-screen", state: "end", t: 23_000 }]);
    const [f] = session().flags;
    expect(f.questionId).toBe(session().questions[0].id);
    expect(f.end).toBe(23_000);
    const ev = session().timeline.at(-1)!;
    expect(ev).toMatchObject({ kind: "flag", t: 18_000, text: "Flag — Looking off-screen (Q1)" });
  });

  it("merges end evidence into the right open Flag", () => {
    begin();
    applyTransitions([
      { kind: "reading-pattern", state: "start", t: 1_000, evidence: { cycles: 4 } },
      { kind: "off-screen", state: "start", t: 2_000, evidence: { baseline, thresholdDeg: { x: 10, y: 10 }, direction: "right" } },
    ] as never);
    applyTransitions([{ kind: "off-screen", state: "end", t: 5_000, evidence: { peakDeviationDeg: 14 } }] as never);
    const [reading, off] = session().flags;
    expect(reading.end).toBeNull();
    expect(reading.evidence).toEqual({ cycles: 4 });
    expect(off.end).toBe(5_000);
    expect(off.evidence).toEqual({ baseline, thresholdDeg: { x: 10, y: 10 }, direction: "right", peakDeviationDeg: 14 });
  });
});

describe("follow-up and Moments", () => {
  it("applies decision, result and timeline effects and the new state", () => {
    begin();
    const qid = session().questions[0].id;
    openMoment({
      id: "m1", questionId: qid, t: 15_000, kind: "reading-pattern", origin: "gate", reason: "r", flagIds: [],
      followUpNumber: 1, note: null, followUp: null, quality: null, suggestion: "generating", decision: "pending", askedAt: null, result: null,
    });
    updateMoment("m1", { note: "n", suggestion: "fallback" });
    const fu = { questionId: qid, phase: "re_observing" as const, used: 1, reObserveUntil: 46_000, momentId: null, askedMomentId: null, watchFrom: 16_000 };
    applyFollowUp(fu, [
      { type: "moment_decision", momentId: "m1", decision: "asked", t: 16_000 },
      { type: "timeline", kind: "follow-up-asked", text: "Follow-up asked (1 / 2)", t: 16_000 },
    ]);
    applyFollowUp({ ...fu, phase: "settled", reObserveUntil: null }, [{ type: "moment_result", momentId: "m1", result: "settled" }]);
    const m = session().moments[0];
    expect(m).toMatchObject({ note: "n", suggestion: "fallback", decision: "asked", askedAt: 16_000, result: "settled" });
    expect(session().followUp.phase).toBe("settled");
    expect(session().timeline.at(-1)).toEqual({ t: 16_000, kind: "follow-up-asked", questionId: qid, text: "Follow-up asked (1 / 2)" });
  });

  it("dismissFlag marks the Flag dismissed", () => {
    begin();
    applyTransitions([{ kind: "off-screen", state: "start", t: 1_000 }]);
    const id = session().flags[0].id;
    dismissFlag(id);
    expect(session().flags[0].dismissed).toBe(true);
  });
});

describe("endSession", () => {
  it("closes open Flags and appends session-end", () => {
    begin();
    applyTransitions([{ kind: "second-face", state: "start", t: 1_000 }]);
    at(9_000);
    endSession();
    const s = session();
    expect(s.endedAt).toBe(T0 + 9_000);
    expect(s.flags[0].end).toBe(9_000);
    expect(s.timeline.at(-1)).toMatchObject({ t: 9_000, kind: "session-end", text: "Session ended" });
  });

  it("notes when the Session ended during re-observation and keeps result null", () => {
    begin();
    const qid = session().questions[0].id;
    applyFollowUp({ questionId: qid, phase: "re_observing", used: 1, reObserveUntil: 40_000, momentId: null, askedMomentId: null, watchFrom: 10_000 }, []);
    endSession();
    expect(session().timeline.at(-1)!.text).toBe("Session ended during re-observation");
  });
});

describe("clearSession", () => {
  it("resets every Session field back to Screen 1", () => {
    begin();
    setSourceReady({ kind: "webcam", hasAudio: true });
    setSpeech("speaking");
    setOpenFlag("f1");
    store.set({ fps: 30, baselineProgress: 0.5, baselineJustCompleted: true, reportStatus: "done", latestSignal: { t: 1 } as never });
    clearSession();
    const s = store.get();
    expect(s).toMatchObject({
      session: null, draft: null, sourceReady: null, speech: "unavailable", openFlagId: null,
      fps: 0, baselineProgress: 0, baselineJustCompleted: false, reportStatus: "idle", latestSignal: null,
    });
    expect(selectScreen(s)).toBe("consent");
  });
});
