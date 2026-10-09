/**
 * False-positive / false-negative audit (areas G and H). Every case drives the real RuleEngine → evaluateGate →
 * reduceFollowUp pipeline with synthetic Signals and asserts both the Flags raised and the Moments opened.
 */
import { describe, expect, it } from "vitest";
import { MAX_FOLLOW_UPS, type FlagKind, type FollowUpState, type Pause, type Question } from "../../domain/types";
import { RULES } from "../config";
import { allowedActions, initialFollowUp, reduceFollowUp, type FollowUpEvent } from "../followUp";
import { evaluateGate, type GateHit } from "../gate";
import { alwaysAsk, analyse, baselineAt, SignalBuilder, simulate, type Interviewer } from "./synthetic";

const Q = (n: number, start: number, label = "Tell me about a project"): Question => ({ id: `q${n}`, number: n, label, start });
const speaking = { available: true, pauses: [] as Pause[] };
const noSpeech = { available: false, pauses: [] as Pause[] };
const kinds = (flags: { kind: FlagKind }[]) => flags.map((f) => f.kind);
const momentKinds = (r: ReturnType<typeof simulate>) => r.moments.map((m) => (m.type === "open_moment" ? m.hit?.kind : null));

/** 16 s of steady gaze (Baseline ready), then Q1 starts and 12 s pass (grace window over). */
function afterGrace(seed: number) {
  const b = new SignalBuilder(seed).setNoise(1).steady(16_000);
  const q = Q(1, b.t);
  b.steady(12_000);
  return { b, q };
}

describe("G. false positives / negatives through the whole loop", () => {
  it("1. thinking pause: 1 s glance raises nothing; 2-3 s glances raise an off-screen Flag; none opens a Moment", () => {
    for (const [ms, flags] of [
      [1_000, 0],
      [2_000, 1],
      [3_000, 1],
    ] as const) {
      const { b, q } = afterGrace(11);
      const pauseStart = b.t;
      b.hold(300).move(20, 6, 80).hold(ms).move(0, 0, 80).hold(300);
      const pauses: Pause[] = [{ start: pauseStart, end: b.t }]; // speech resumes here
      b.steady(30_000);
      const r = simulate(analyse(b.frames), { questions: [q], speech: { available: true, pauses } });
      expect(r.flags.filter((f) => f.kind === "off-screen")).toHaveLength(flags);
      expect(r.moments).toEqual([]);
    }
  });

  it("1b. three 2.5 s thinking glances within 60 s, each inside a pause that ends with speech → 3 Flags, no Moment", () => {
    const { b, q } = afterGrace(12);
    const pauses: Pause[] = [];
    for (let i = 0; i < 3; i++) {
      const start = b.t;
      b.hold(300).move(-18, 8, 80).hold(2_500).move(0, 0, 80).hold(300);
      pauses.push({ start, end: b.t });
      b.steady(10_000);
    }
    const r = simulate(analyse(b.frames), { questions: [q], speech: { available: true, pauses } });
    expect(kinds(r.flags)).toEqual(["off-screen", "off-screen", "off-screen"]);
    expect(r.moments).toEqual([]);
  });

  it("2. one 2 s distraction to another area and back → 1 off-screen Flag, no Moment (with and without speech)", () => {
    const { b, q } = afterGrace(13);
    b.move(25, -5, 100).hold(2_000).move(0, 0, 100).steady(40_000);
    const a = analyse(b.frames);
    for (const speech of [speaking, noSpeech]) {
      const r = simulate(a, { questions: [q], speech });
      expect(kinds(r.flags)).toEqual(["off-screen"]);
      expect(r.moments).toEqual([]);
    }
  });

  it("3. 10 min of natural gaze movement while speaking → no Moment, with and without speech context", () => {
    const b = new SignalBuilder(14).setNoise(1).conversation(10 * 60_000);
    const questions = [Q(1, 20_000), Q(2, 200_000), Q(3, 400_000)];
    const a = analyse(b.frames);
    expect(baselineAt(a)).toBeLessThan(20_000);
    expect(simulate(a, { questions, speech: speaking }).moments).toEqual([]);
    expect(simulate(a, { questions, speech: noSpeech }).moments).toEqual([]);
  }, 30_000);

  it("4. sustained deviation: 7 s → Moment only with speech context; 9 s → Moment either way", () => {
    for (const [ms, withSpeech, withoutSpeech] of [
      [7_000, 1, 0],
      [9_000, 1, 1],
    ] as const) {
      const { b, q } = afterGrace(15);
      b.move(22, 0, 100).hold(ms).move(0, 0, 100).steady(20_000);
      const a = analyse(b.frames);
      const on = simulate(a, { questions: [q], speech: speaking });
      const off = simulate(a, { questions: [q], speech: noSpeech });
      expect(kinds(on.flags)).toEqual(["off-screen"]);
      expect(on.moments).toHaveLength(withSpeech);
      expect(off.moments).toHaveLength(withoutSpeech);
      if (withSpeech) expect(momentKinds(on)).toEqual(["off-screen"]);
    }
  });

  it("5. repeated reading sweeps → Reading Flag → Moment", () => {
    const { b, q } = afterGrace(16);
    b.setNoise(0.7).read(6, { startX: -6 }).setNoise(1).steady(20_000);
    const r = simulate(analyse(b.frames), { questions: [q], speech: speaking });
    expect(kinds(r.flags)).toContain("reading-pattern");
    expect(momentKinds(r)).toEqual(["reading-pattern"]);
  });

  it("6/7. face missing: 1 s → nothing; 3 s → Flag, no Moment; 6 s → Moment", () => {
    for (const [ms, flags, moments] of [
      [1_000, 0, 0],
      [3_000, 1, 0],
      [6_000, 1, 1],
    ] as const) {
      const { b, q } = afterGrace(17);
      b.faceMissing(ms).steady(20_000);
      const r = simulate(analyse(b.frames), { questions: [q], speech: speaking });
      expect(r.flags.filter((f) => f.kind === "face-missing")).toHaveLength(flags);
      expect(r.flags.filter((f) => f.kind !== "face-missing")).toEqual([]);
      expect(r.moments).toHaveLength(moments);
      if (moments) expect(momentKinds(r)).toEqual(["face-missing"]);
    }
  });

  it("8/9. second face: 0.5 s → nothing; 2 s → Flag, no Moment; 4 s → Moment", () => {
    for (const [ms, flags, moments] of [
      [500, 0, 0],
      [2_000, 1, 0],
      [4_000, 1, 1],
    ] as const) {
      const { b, q } = afterGrace(18);
      b.faces(2, ms).steady(20_000);
      const r = simulate(analyse(b.frames), { questions: [q], speech: speaking });
      expect(kinds(r.flags)).toEqual(flags ? ["second-face"] : []);
      expect(r.moments).toHaveLength(moments);
      if (moments) expect(momentKinds(r)).toEqual(["second-face"]);
    }
  });
});

describe("G. boundaries", () => {
  it("a Flag that starts in Q1 belongs to Q1; if it is still going in Q2 it counts there only from Q2's grace end", () => {
    const b = new SignalBuilder(21).setNoise(1).steady(16_000);
    const q1 = Q(1, b.t);
    b.steady(14_000);
    const q2 = Q(2, b.t + 3_000); // the face leaves 3 s before the Interviewer marks Q2
    b.faceMissing(30_000).steady(10_000);
    const r = simulate(analyse(b.frames), { questions: [q1, q2], speech: speaking });
    expect(r.flags.map((f) => [f.kind, f.questionId])).toEqual([["face-missing", "q1"]]);
    const open = r.effects.flatMap((e) => (e.type === "timeline" && e.kind === "moment" ? [e] : []));
    expect(open).toHaveLength(1);
    // Grace end + faceMissingMs, within one tick.
    expect(open[0].t).toBeGreaterThanOrEqual(q2.start + RULES.followUp.graceMs + RULES.followUp.faceMissingMs);
    expect(open[0].t).toBeLessThan(q2.start + RULES.followUp.graceMs + RULES.followUp.faceMissingMs + 500);
  });

  it("a short Q1 Flag that ends inside Q2's grace window never counts in Q2", () => {
    const b = new SignalBuilder(22).setNoise(1).steady(16_000);
    const q1 = Q(1, b.t);
    b.steady(14_000);
    const q2 = Q(2, b.t + 1_000);
    b.faces(2, 6_000).steady(30_000);
    const r = simulate(analyse(b.frames), { questions: [q1, q2], speech: speaking });
    expect(r.flags.map((f) => [f.kind, f.questionId])).toEqual([["second-face", "q1"]]);
    expect(r.moments).toEqual([]);
  });

  it("reading that starts as the Question is asked (inside grace) and keeps going opens a Moment after grace", () => {
    const b = new SignalBuilder(23).setNoise(1).steady(16_000);
    const q = Q(1, b.t);
    b.steady(1_000);
    b.setNoise(0.7);
    for (let i = 0; i < 4; i++) b.read(6, { startX: -6 }).move(-6, 0, 100);
    b.setNoise(1).steady(15_000);
    const r = simulate(analyse(b.frames), { questions: [q], speech: speaking });
    const reading = r.flags.filter((f) => f.kind === "reading-pattern");
    expect(reading.length).toBeGreaterThan(0);
    expect(reading[0].start).toBeLessThan(q.start + RULES.followUp.graceMs);
    expect(momentKinds(r)).toEqual(["reading-pattern"]);
  });

  it("grace boundary: nothing at graceEnd - 1; a Flag starting exactly at graceEnd counts in full", () => {
    const q = Q(1, 100_000);
    const g = q.start + RULES.followUp.graceMs;
    const base = { question: q, followUp: initialFollowUp(q.id, q.start), baselineReady: true, speech: speaking };
    const f = { id: "f", kind: "second-face" as const, start: g, end: null, questionId: q.id };
    expect(evaluateGate({ ...base, now: g - 1, flags: [f] })).toBeNull();
    expect(evaluateGate({ ...base, now: g + 2_999, flags: [f] })).toBeNull();
    expect(evaluateGate({ ...base, now: g + 3_000, flags: [f] })?.kind).toBe("second-face");
    // Started 2 s inside grace: counted from graceEnd, so still 3 s after it.
    const early = { ...f, start: g - 2_000 };
    expect(evaluateGate({ ...base, now: g + 2_999, flags: [early] })).toBeNull();
    expect(evaluateGate({ ...base, now: g + 3_000, flags: [early] })?.reason).toBe("A second face was visible for 3 s");
  });

  it("Baseline reset mid-question: gaze rules are blind while it relearns, face rules keep working", () => {
    const { b, q } = afterGrace(24);
    const resetAt = b.t;
    b.steady(3_000).move(22, 0, 100).hold(9_000).move(0, 0, 100); // off-screen while relearning
    b.faces(2, 4_000).steady(20_000);
    const a = analyse(b.frames, { resetAt: [resetAt] });
    expect(a.readiness.map((x) => x.ready)).toEqual([true, false, true]);
    const relearnt = a.readiness[2].t;
    const r = simulate(a, { questions: [q], speech: speaking });
    // Nothing gaze-based while relearning. (The relearnt Baseline absorbed the look-away, so returning to the
    // old centre later reads as off-screen: see the audit report.)
    expect(r.flags.filter((f) => f.kind === "off-screen" && f.start < relearnt)).toEqual([]);
    expect(momentKinds(r)[0]).toBe("second-face");
  });

  it("face out of view from the start of the Session (no Baseline yet) still opens a face-missing Moment", () => {
    const b = new SignalBuilder(25).setNoise(1).steady(2_000);
    const q = Q(1, b.t);
    b.steady(5_000).faceMissing(20_000).steady(1_000);
    const a = analyse(b.frames);
    expect(baselineAt(a)).toBe(Infinity);
    expect(momentKinds(simulate(a, { questions: [q], speech: speaking }))).toEqual(["face-missing"]);
  });
});

describe("G. Flags still going when a follow-up is asked (design D5)", () => {
  it("gaze kept away through the whole re-observation → persisting, not settled", () => {
    const { b, q } = afterGrace(31);
    b.move(22, 0, 100).hold(45_000).move(0, 0, 100).steady(40_000);
    const r = simulate(analyse(b.frames), { questions: [q], speech: speaking, interviewer: alwaysAsk });
    expect(kinds(r.flags)).toEqual(["off-screen"]);
    expect(r.phases).toEqual(["observing", "worth_exploring", "re_observing", "persisting", "re_observing", "limit_reached"]);
    expect(r.results.map((x) => (x.type === "moment_result" ? x.result : null))).toEqual(["persisting", "persisting"]);
  });

  it("gaze returns within a few seconds of the Ask → settled", () => {
    const { b, q } = afterGrace(32);
    b.move(22, 0, 100).hold(8_000).move(0, 0, 100).steady(45_000); // Moment at ~6 s, Ask at ~7 s, back at ~8 s
    const r = simulate(analyse(b.frames), { questions: [q], speech: speaking, interviewer: alwaysAsk });
    expect(r.phases).toEqual(["observing", "worth_exploring", "re_observing", "settled"]);
  });

  it("face out of view through the whole re-observation → persisting", () => {
    const { b, q } = afterGrace(33);
    b.faceMissing(50_000).steady(40_000);
    const r = simulate(analyse(b.frames), { questions: [q], speech: speaking, interviewer: alwaysAsk });
    expect(r.phases.slice(0, 4)).toEqual(["observing", "worth_exploring", "re_observing", "persisting"]);
  });

  it("reading that never pauses across the Ask → persisting", () => {
    const { b, q } = afterGrace(34);
    b.setNoise(0.7);
    for (let i = 0; i < 8; i++) b.read(6, { startX: -6 }).move(-6, 0, 100);
    b.setNoise(1).steady(40_000);
    const a = analyse(b.frames);
    const r = simulate(a, { questions: [q], speech: speaking, interviewer: alwaysAsk });
    expect(r.flags.filter((f) => f.kind === "reading-pattern")).toHaveLength(1);
    expect(r.phases.slice(0, 4)).toEqual(["observing", "worth_exploring", "re_observing", "persisting"]);
  });

  it("after Continue, the same ongoing Flag does not reopen a Moment", () => {
    const { b, q } = afterGrace(35);
    b.move(22, 0, 100).hold(45_000).move(0, 0, 100).steady(10_000);
    const cont: Interviewer = (s, t) => (s.phase === "worth_exploring" ? { type: "continue", t: t + 1_000 } : null);
    const r = simulate(analyse(b.frames), { questions: [q], speech: speaking, interviewer: cont });
    expect(r.phases).toEqual(["observing", "worth_exploring", "observing"]);
    expect(r.moments).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// H. Follow-up reducer paths

const HIT: GateHit = { kind: "off-screen", reason: "Gaze moved outside the usual range for 6 s", flagIds: ["f1"] };
const hit = (momentId: string, t: number): FollowUpEvent => ({ type: "gate_hit", hit: HIT, momentId, t });
function play(events: FollowUpEvent[], s: FollowUpState = initialFollowUp("q1", 0)) {
  const effects = [];
  for (const e of events) {
    const r = reduceFollowUp(s, e);
    s = r.state;
    effects.push(...r.effects);
  }
  return { s, effects };
}

describe("H. follow-up logic", () => {
  it("0 follow-ups: Continue keeps the budget; Dismiss ends suggestions for the Question", () => {
    const c = play([hit("m1", 20_000), { type: "continue", t: 21_000 }]);
    expect(c.s).toMatchObject({ phase: "observing", used: 0, watchFrom: 21_000 });
    const d = play([hit("m1", 20_000), { type: "dismiss", t: 21_000 }, hit("m2", 30_000), { type: "ask", t: 31_000 }]);
    expect(d.s).toMatchObject({ phase: "dismissed", used: 0 });
  });

  it("1 follow-up → settled; 2 → limit_reached; a 3rd Ask is ignored everywhere", () => {
    const one = play([hit("m1", 20_000), { type: "ask", t: 21_000 }, { type: "tick", t: 51_000 }]);
    expect(one.s).toMatchObject({ phase: "settled", used: 1 });
    const two = [hit("m1", 20_000), { type: "ask", t: 21_000 } as const, hit("m2", 30_000), { type: "ask", t: 31_000 } as const];
    const reObs = play(two);
    expect(reObs.s).toMatchObject({ phase: "re_observing", used: MAX_FOLLOW_UPS });
    expect(play([{ type: "ask", t: 32_000 }], reObs.s).s).toBe(reObs.s);
    const lim = play([hit("m3", 40_000)], reObs.s);
    expect(lim.s).toMatchObject({ phase: "limit_reached", used: 2 });
    expect(play([{ type: "ask", t: 41_000 }, hit("m4", 42_000)], lim.s).s).toBe(lim.s);
    expect(allowedActions(lim.s)).toEqual(["next_question"]);
  });

  it("a double Ask (dispatched twice quickly) spends one follow-up", () => {
    const r = play([hit("m1", 20_000), { type: "ask", t: 21_000 }, { type: "ask", t: 21_010 }]);
    expect(r.s).toMatchObject({ phase: "re_observing", used: 1, reObserveUntil: 51_000 });
    expect(r.effects.filter((e) => e.type === "moment_decision")).toHaveLength(1);
  });

  it("double Continue / Dismiss are idempotent", () => {
    const c = play([hit("m1", 20_000), { type: "continue", t: 21_000 }, { type: "continue", t: 21_010 }]);
    expect(c.effects.filter((e) => e.type === "moment_decision")).toHaveLength(1);
    const d = play([hit("m1", 20_000), { type: "dismiss", t: 21_000 }, { type: "dismiss", t: 21_010 }]);
    expect(d.effects.filter((e) => e.type === "moment_decision")).toHaveLength(1);
  });

  it("gate_hit and explore while worth_exploring are ignored", () => {
    const w = play([hit("m1", 20_000)]);
    expect(play([hit("m2", 20_250), { type: "explore", flagId: "f2", momentId: "m3", t: 20_500 }], w.s).s).toBe(w.s);
  });

  it("explore: opens the final slot after persisting → Continue; ignored with no budget, while re-observing, and in terminal phases", () => {
    const p = play([hit("m1", 20_000), { type: "ask", t: 21_000 }, hit("m2", 30_000), { type: "continue", t: 31_000 }]);
    expect(p.s).toMatchObject({ phase: "observing", used: 1 });
    const ex = play([{ type: "explore", flagId: "f9", momentId: "m9", t: 40_000 }], p.s);
    expect(ex.effects[0]).toMatchObject({ type: "open_moment", followUpNumber: 2, final: true, hit: null, flagId: "f9" });
    // No budget: observing with used = MAX can't be reached through the reducer, but a forged state must not open.
    const spent: FollowUpState = { ...initialFollowUp("q1", 0), used: MAX_FOLLOW_UPS };
    expect(play([{ type: "explore", flagId: "f", momentId: "m", t: 1 }, hit("m", 2)], spent).s).toBe(spent);
    const reObs = play([hit("m1", 20_000), { type: "ask", t: 21_000 }]).s;
    expect(play([{ type: "explore", flagId: "f", momentId: "m", t: 22_000 }], reObs).s).toBe(reObs);
    for (const terminal of [
      play([hit("m1", 20_000), { type: "ask", t: 21_000 }, { type: "tick", t: 51_000 }]).s,
      play([hit("m1", 20_000), { type: "dismiss", t: 21_000 }]).s,
    ])
      expect(play([{ type: "explore", flagId: "f", momentId: "m", t: 60_000 }], terminal).s).toBe(terminal);
  });

  it("switching Question mid re-observation resets the loop; the asked Moment gets no result (stays unresolved)", () => {
    const r = play([hit("m1", 20_000), { type: "ask", t: 21_000 }, { type: "question_started", questionId: "q2", t: 25_000 }]);
    expect(r.s).toMatchObject({ questionId: "q2", phase: "observing", used: 0, askedMomentId: null, watchFrom: 25_000 });
    expect(r.effects.filter((e) => e.type === "moment_result")).toEqual([]);
  });

  it("re-observation edge: a hit 1 ms before the window ends → persisting; a tick at the end → settled", () => {
    const base = play([hit("m1", 20_000), { type: "ask", t: 21_000 }]).s;
    expect(play([hit("m2", 50_999)], base).s.phase).toBe("persisting");
    expect(play([{ type: "tick", t: 51_000 }], base).s.phase).toBe("settled");
    expect(play([hit("m2", 51_000)], base).s.phase).toBe("settled");
  });
});
