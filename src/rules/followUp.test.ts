import { describe, expect, it } from "vitest";
import { MAX_FOLLOW_UPS, type FollowUpPhase, type FollowUpState } from "../domain/types";
import { allowedActions, checkFollowUpInvariants, initialFollowUp, reduceFollowUp, type FollowUpEffect, type FollowUpEvent } from "./followUp";
import type { GateHit } from "./gate";
import { rng } from "./testing/synthetic";

const READING: GateHit = { kind: "reading-pattern", reason: "A reading-like gaze pattern was observed (4 line sweeps)", flagIds: ["f1"] };

/** Feed events in order; return the final state and every effect batch. */
function play(events: FollowUpEvent[], start: FollowUpState = initialFollowUp("q2", 0)) {
  let s = start;
  const all: FollowUpEffect[][] = [];
  for (const e of events) {
    const r = reduceFollowUp(s, e);
    s = r.state;
    all.push(r.effects);
  }
  return { s, all };
}

describe("follow-up state machine", () => {
  it("question_started resets to observing and logs the Question", () => {
    const r = reduceFollowUp(initialFollowUp("q1", 0), { type: "question_started", questionId: "q2", t: 60_000, label: "Q2 Tell me about a project" });
    expect(r.state).toMatchObject({ questionId: "q2", phase: "observing", used: 0, watchFrom: 60_000, momentId: null, reObserveUntil: null });
    expect(r.effects).toEqual([{ type: "timeline", kind: "question", text: "Question started — Q2 Tell me about a project", t: 60_000 }]);
  });

  it("1. happy path: observing → worth_exploring → ask → re_observing → settled at +30 s", () => {
    let s = initialFollowUp("q2", 0);
    let r = reduceFollowUp(s, { type: "gate_hit", hit: READING, momentId: "m1", t: 20_000 });
    s = r.state;
    expect(s).toMatchObject({ phase: "worth_exploring", momentId: "m1", used: 0 });
    expect(r.effects).toEqual([
      { type: "open_moment", momentId: "m1", hit: READING, followUpNumber: 1, final: false },
      { type: "timeline", kind: "moment", text: "Moment worth exploring — reading-like pattern", t: 20_000 },
    ]);
    expect(allowedActions(s)).toEqual(["ask", "continue", "dismiss"]);

    r = reduceFollowUp(s, { type: "ask", t: 25_000 });
    s = r.state;
    expect(s).toMatchObject({ phase: "re_observing", used: 1, reObserveUntil: 55_000, watchFrom: 25_000, momentId: null });
    expect(r.effects).toEqual([
      { type: "moment_decision", momentId: "m1", decision: "asked", t: 25_000 },
      { type: "timeline", kind: "follow-up-asked", text: "Follow-up asked (1 / 2)", t: 25_000 },
    ]);
    expect(allowedActions(s)).toEqual([]);

    r = reduceFollowUp(s, { type: "tick", t: 54_900 });
    expect(r.state).toBe(s);
    expect(r.effects).toEqual([]);

    r = reduceFollowUp(s, { type: "tick", t: 55_000 });
    s = r.state;
    expect(s).toMatchObject({ phase: "settled", reObserveUntil: null, momentId: null, used: 1 });
    expect(r.effects).toEqual([
      { type: "moment_result", momentId: "m1", result: "settled" },
      { type: "timeline", kind: "settled", text: "Observation settled", t: 55_000 },
    ]);
    expect(allowedActions(s)).toEqual(["next_question"]);
  });

  it("2. persisting path: ask → hit → persisting (2 / 2, final) → ask → hit → limit_reached", () => {
    const { s, all } = play([
      { type: "gate_hit", hit: READING, momentId: "m1", t: 20_000 },
      { type: "ask", t: 22_000 },
      { type: "gate_hit", hit: READING, momentId: "m2", t: 32_000 },
    ]);
    expect(s).toMatchObject({ phase: "persisting", momentId: "m2", used: 1, reObserveUntil: null });
    expect(all[2]).toEqual([
      { type: "moment_result", momentId: "m1", result: "persisting" },
      { type: "open_moment", momentId: "m2", hit: READING, followUpNumber: 2, final: true },
      { type: "timeline", kind: "persisting", text: "Pattern continues", t: 32_000 },
    ]);
    const r1 = reduceFollowUp(s, { type: "ask", t: 34_000 });
    expect(r1.state).toMatchObject({ phase: "re_observing", used: 2, reObserveUntil: 64_000, watchFrom: 34_000 });
    expect(r1.effects).toEqual([
      { type: "moment_decision", momentId: "m2", decision: "asked", t: 34_000 },
      { type: "timeline", kind: "follow-up-asked", text: "Follow-up asked (2 / 2)", t: 34_000 },
    ]);
    const r2 = reduceFollowUp(r1.state, { type: "gate_hit", hit: READING, momentId: "m3", t: 40_000 });
    expect(r2.state).toMatchObject({ phase: "limit_reached", used: 2, momentId: null, reObserveUntil: null });
    expect(r2.effects).toEqual([
      { type: "moment_result", momentId: "m2", result: "persisting" },
      { type: "timeline", kind: "limit-reached", text: "Follow-up limit reached", t: 40_000 },
    ]);
  });

  it("3. no ask after the limit: allowedActions has no ask and the reducer ignores it", () => {
    const { s } = play([
      { type: "gate_hit", hit: READING, momentId: "m1", t: 20_000 },
      { type: "ask", t: 22_000 },
      { type: "gate_hit", hit: READING, momentId: "m2", t: 32_000 },
      { type: "ask", t: 34_000 },
      { type: "gate_hit", hit: READING, momentId: "m3", t: 40_000 },
    ]);
    expect(s.phase).toBe("limit_reached");
    expect(allowedActions(s)).toEqual(["next_question"]);
    const ignored: FollowUpEvent[] = [
      { type: "ask", t: 41_000 },
      { type: "gate_hit", hit: READING, momentId: "m4", t: 42_000 },
      { type: "explore", flagId: "f9", momentId: "m5", t: 43_000 },
      { type: "continue", t: 44_000 },
    ];
    for (const e of ignored) {
      const r = reduceFollowUp(s, e);
      expect(r.state).toBe(s);
      expect(r.effects).toEqual([]);
    }
  });

  it("4. continue keeps the budget and moves watchFrom", () => {
    const { s, all } = play([
      { type: "gate_hit", hit: READING, momentId: "m1", t: 20_000 },
      { type: "continue", t: 21_000 },
    ]);
    expect(s).toMatchObject({ phase: "observing", used: 0, watchFrom: 21_000, momentId: null });
    expect(all[1]).toEqual([
      { type: "moment_decision", momentId: "m1", decision: "continued", t: 21_000 },
      { type: "timeline", kind: "continued", text: "Continued", t: 21_000 },
    ]);
  });

  it("5. dismiss is terminal until the next Question", () => {
    const { s, all } = play([
      { type: "gate_hit", hit: READING, momentId: "m1", t: 20_000 },
      { type: "dismiss", t: 21_000 },
      { type: "gate_hit", hit: READING, momentId: "m2", t: 40_000 },
      { type: "explore", flagId: "f2", momentId: "m3", t: 41_000 },
      { type: "tick", t: 90_000 },
    ]);
    expect(s.phase).toBe("dismissed");
    expect(all[1]).toEqual([
      { type: "moment_decision", momentId: "m1", decision: "dismissed", t: 21_000 },
      { type: "timeline", kind: "dismissed", text: "Suggestions dismissed for this Question", t: 21_000 },
    ]);
    expect(all.slice(2).flat()).toEqual([]);
    expect(allowedActions(s)).toEqual([]);
    const r = reduceFollowUp(s, { type: "question_started", questionId: "q3", t: 100_000 });
    expect(r.state.phase).toBe("observing");
  });

  it("explore from Flag Details opens a Moment with the Flag", () => {
    const r = reduceFollowUp(initialFollowUp("q2", 0), { type: "explore", flagId: "f7", momentId: "m9", t: 15_000 });
    expect(r.state).toMatchObject({ phase: "worth_exploring", momentId: "m9" });
    expect(r.effects[0]).toEqual({ type: "open_moment", momentId: "m9", hit: null, flagId: "f7", followUpNumber: 1, final: false });
    expect(r.effects[1]).toMatchObject({ type: "timeline", kind: "moment" });
  });

  it("a gate hit arriving after the re-observation window settles instead", () => {
    const { s, all } = play([
      { type: "gate_hit", hit: READING, momentId: "m1", t: 20_000 },
      { type: "ask", t: 22_000 },
      { type: "gate_hit", hit: READING, momentId: "m2", t: 52_000 },
    ]);
    expect(s.phase).toBe("settled");
    expect(all[2][0]).toEqual({ type: "moment_result", momentId: "m1", result: "settled" });
  });

  it("6. a new Question from every phase resets to observing with used 0", () => {
    const hit = (momentId: string, t: number): FollowUpEvent => ({ type: "gate_hit", hit: READING, momentId, t });
    const paths: Record<FollowUpPhase, FollowUpEvent[]> = {
      observing: [],
      worth_exploring: [hit("m1", 20_000)],
      re_observing: [hit("m1", 20_000), { type: "ask", t: 21_000 }],
      settled: [hit("m1", 20_000), { type: "ask", t: 21_000 }, { type: "tick", t: 60_000 }],
      persisting: [hit("m1", 20_000), { type: "ask", t: 21_000 }, hit("m2", 30_000)],
      limit_reached: [hit("m1", 20_000), { type: "ask", t: 21_000 }, hit("m2", 30_000), { type: "ask", t: 31_000 }, hit("m3", 40_000)],
      dismissed: [hit("m1", 20_000), { type: "dismiss", t: 21_000 }],
    };
    for (const [phase, events] of Object.entries(paths)) {
      const { s } = play(events);
      expect(s.phase).toBe(phase);
      const r = reduceFollowUp(s, { type: "question_started", questionId: "q3", t: 100_000 });
      expect(r.state).toMatchObject({ questionId: "q3", phase: "observing", used: 0, watchFrom: 100_000, momentId: null, reObserveUntil: null });
    }
  });

  it("7. property: invariants hold over 1,000 seeded random event sequences", () => {
    const rand = rng(2026);
    const types = ["question_started", "gate_hit", "gate_hit", "ask", "ask", "continue", "dismiss", "explore", "tick", "tick", "tick"] as const;
    let asks = 0;
    for (let run = 0; run < 1_000; run++) {
      let s = initialFollowUp("q1", 0);
      let t = 0;
      let id = 0;
      for (let i = 0; i < 60; i++) {
        t += Math.floor(rand() * 15_000);
        const type = types[Math.floor(rand() * types.length)];
        let e: FollowUpEvent;
        if (type === "question_started") e = { type, questionId: `q${++id}`, t };
        else if (type === "gate_hit") e = { type, hit: READING, momentId: `m${++id}`, t };
        else if (type === "explore") e = { type, flagId: `f${id}`, momentId: `m${++id}`, t };
        else e = { type, t };
        const before = s;
        const r = reduceFollowUp(s, e);
        s = r.state;
        expect(checkFollowUpInvariants(s), `run ${run} step ${i} ${type}`).toBeNull();
        expect(s.used).toBeLessThanOrEqual(MAX_FOLLOW_UPS);
        if (["settled", "limit_reached", "dismissed"].includes(before.phase) && type !== "question_started") {
          expect(s).toBe(before);
          expect(r.effects).toEqual([]);
        }
        if (type === "ask" && !allowedActions(before).includes("ask")) expect(s).toBe(before);
        if (r.effects.some((x) => x.type === "moment_decision" && x.decision === "asked")) asks++;
      }
    }
    expect(asks).toBeGreaterThan(100);
  });
});
