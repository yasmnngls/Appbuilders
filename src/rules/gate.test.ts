import { describe, expect, it } from "vitest";
import type { Flag, FlagKind, Pause, Question } from "../domain/types";
import { initialFollowUp } from "./followUp";
import { evaluateGate, type GateInput } from "./gate";

const Q: Question = { id: "q2", number: 2, label: "Tell me about a project", start: 100_000 };
const G = Q.start + 10_000; // end of grace window

let n = 0;
const flag = (kind: FlagKind, start: number, end: number | null, extra: Partial<Flag> = {}): Flag => ({
  id: `f${++n}`,
  kind,
  start,
  end,
  questionId: Q.id,
  ...extra,
});

function input(flags: Flag[], now: number, over: Partial<GateInput> = {}): GateInput {
  return {
    now,
    question: Q,
    followUp: initialFollowUp(Q.id, Q.start),
    flags,
    baselineReady: true,
    speech: { available: true, pauses: [] },
    ...over,
  };
}
const noSpeech = { speech: { available: false, pauses: [] as Pause[] } };

describe("evaluateGate", () => {
  it("1. never opens before the Baseline is ready", () => {
    const f = flag("reading-pattern", G + 1_000, null, { evidence: { cycles: 4 } });
    expect(evaluateGate(input([f], G + 5_000, { baselineReady: false }))).toBeNull();
    expect(evaluateGate(input([f], G + 5_000))).not.toBeNull();
  });

  it("2. grace window: a Flag starting inside it never counts; one just after does", () => {
    const early = flag("off-screen", Q.start + 5_000, Q.start + 25_000);
    for (let t = Q.start; t <= Q.start + 40_000; t += 250) expect(evaluateGate(input([early], t))).toBeNull();
    const late = flag("off-screen", Q.start + 11_000, Q.start + 18_000);
    expect(evaluateGate(input([late], Q.start + 18_000))?.kind).toBe("off-screen");
  });

  it("never opens inside the grace window even for a Flag of the question that qualifies", () => {
    const f = flag("second-face", Q.start, null);
    expect(evaluateGate(input([f], G - 1))).toBeNull();
  });

  it("3. sustained off-screen: 5.9 s null, 6 s hit; without speech 7.9 s null, 8 s hit", () => {
    const f = flag("off-screen", G + 1_000, null);
    expect(evaluateGate(input([f], G + 6_900))).toBeNull();
    const hit = evaluateGate(input([f], G + 7_000));
    expect(hit).toEqual({ kind: "off-screen", reason: "Gaze moved outside the usual range for 6 s", flagIds: [f.id] });
    expect(evaluateGate(input([f], G + 8_900, noSpeech))).toBeNull();
    expect(evaluateGate(input([f], G + 9_000, noSpeech))?.reason).toBe("Gaze moved outside the usual range for 8 s");
  });

  it("3b. an ended off-screen Flag counts its real duration", () => {
    const f = flag("off-screen", G + 1_000, G + 6_900);
    expect(evaluateGate(input([f], G + 30_000))).toBeNull();
  });

  it("4. repeated glances: 2 null, 3 hit; no speech 3 null, 4 hit; spread over 61 s null", () => {
    const glances = (starts: number[]) => starts.map((s) => flag("off-screen", s, s + 2_000));
    const two = glances([G + 1_000, G + 10_000]);
    expect(evaluateGate(input(two, G + 20_000))).toBeNull();
    const three = glances([G + 1_000, G + 10_000, G + 20_000]);
    const hit = evaluateGate(input(three, G + 23_000));
    expect(hit?.kind).toBe("off-screen");
    expect(hit?.reason).toBe("3 off-screen glances within 60 s");
    expect(hit?.flagIds).toEqual(three.map((f) => f.id));
    expect(evaluateGate(input(three, G + 23_000, noSpeech))).toBeNull();
    const four = glances([G + 1_000, G + 10_000, G + 20_000, G + 30_000]);
    expect(evaluateGate(input(four, G + 33_000, noSpeech))?.reason).toBe("4 off-screen glances within 60 s");
    const spread = glances([G + 1_000, G + 31_000, G + 62_000]);
    expect(evaluateGate(input(spread, G + 62_000))).toBeNull();
  });

  it("5. thinking pauses: ended 3 s pause drops the glance; ended 5 s pause does not; open pause drops it for now", () => {
    const glances = [G + 1_000, G + 10_000, G + 20_000].map((s) => flag("off-screen", s, s + 2_000));
    const now = G + 25_000;
    const short: Pause[] = [{ start: G + 19_000, end: G + 22_000 }];
    expect(evaluateGate(input(glances, now, { speech: { available: true, pauses: short } }))).toBeNull();
    const long: Pause[] = [{ start: G + 19_000, end: G + 24_000 }];
    expect(evaluateGate(input(glances, now, { speech: { available: true, pauses: long } }))?.kind).toBe("off-screen");
    const open: Pause[] = [{ start: G + 19_000, end: null }];
    expect(evaluateGate(input(glances, now, { speech: { available: true, pauses: open } }))).toBeNull();
    // Once the open pause ends long, the glance counts again on a later tick.
    const closedLong: Pause[] = [{ start: G + 19_000, end: G + 26_000 }];
    expect(evaluateGate(input(glances, G + 26_250, { speech: { available: true, pauses: closedLong } }))?.kind).toBe("off-screen");
    // Pauses are ignored when speech is unavailable (stricter thresholds apply instead).
    const four = [...glances, flag("off-screen", G + 22_000, G + 23_000)];
    expect(evaluateGate(input(four, now, { speech: { available: false, pauses: short } }))?.kind).toBe("off-screen");
  });

  it("6. second face 2.9 s null, 3 s hit; face missing 4.9 s null, 5 s hit", () => {
    const sf = flag("second-face", G + 1_000, null);
    expect(evaluateGate(input([sf], G + 3_900))).toBeNull();
    expect(evaluateGate(input([sf], G + 4_000))).toEqual({ kind: "second-face", reason: "A second face was visible for 3 s", flagIds: [sf.id] });
    const fm = flag("face-missing", G + 1_000, null);
    expect(evaluateGate(input([fm], G + 5_900))).toBeNull();
    expect(evaluateGate(input([fm], G + 6_000))).toEqual({ kind: "face-missing", reason: "The face was out of view for 5 s", flagIds: [fm.id] });
  });

  it("reading pattern: any eligible Flag, reason names the line sweeps", () => {
    const r = flag("reading-pattern", G + 1_000, null, { evidence: { cycles: 4 } });
    expect(evaluateGate(input([r], G + 1_100))).toEqual({
      kind: "reading-pattern",
      reason: "A reading-like gaze pattern was observed (4 line sweeps)",
      flagIds: [r.id],
    });
  });

  it("7. a Flag that started before watchFrom is ignored even while ongoing", () => {
    const f = flag("off-screen", G + 1_000, null);
    const followUp = { ...initialFollowUp(Q.id, Q.start), watchFrom: G + 2_000 };
    expect(evaluateGate(input([f], G + 20_000, { followUp }))).toBeNull();
  });

  it("8. a dismissed Flag is ignored", () => {
    const f = flag("second-face", G + 1_000, null, { dismissed: true });
    expect(evaluateGate(input([f], G + 20_000))).toBeNull();
  });

  it("9. a Flag from the previous Question is ignored", () => {
    const f = flag("second-face", G + 1_000, null, { questionId: "q1" });
    expect(evaluateGate(input([f], G + 20_000))).toBeNull();
  });

  it("10. priority: second face beats off-screen", () => {
    const off = flag("off-screen", G + 1_000, null);
    const sf = flag("second-face", G + 2_000, null);
    expect(evaluateGate(input([off, sf], G + 20_000))?.kind).toBe("second-face");
  });

  it("only asked in observing or re_observing", () => {
    const f = flag("second-face", G + 1_000, null);
    for (const phase of ["worth_exploring", "persisting", "settled", "limit_reached", "dismissed"] as const) {
      const followUp = { ...initialFollowUp(Q.id, Q.start), phase };
      expect(evaluateGate(input([f], G + 20_000, { followUp }))).toBeNull();
    }
    const followUp = { ...initialFollowUp(Q.id, Q.start), phase: "re_observing" as const, reObserveUntil: G + 30_000 };
    expect(evaluateGate(input([f], G + 20_000, { followUp }))?.kind).toBe("second-face");
  });
});
