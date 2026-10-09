/**
 * End-to-end loop without a browser (BUILD_PLAN M2.4): synthetic Signals → RuleEngine → store-like Flag list
 * → evaluateGate → reduceFollowUp, ticking every 250 ms like the controller.
 */
import { describe, expect, it } from "vitest";
import type { Flag, FollowUpPhase, FollowUpState, Pause, Question, Signal } from "../../domain/types";
import { RuleEngine, type FlagTransition } from "../engine";
import { initialFollowUp, reduceFollowUp, type FollowUpEffect, type FollowUpEvent } from "../followUp";
import { evaluateGate } from "../gate";
import { SignalBuilder } from "./synthetic";

const TICK_MS = 250;

interface Recorded extends FlagTransition {
  emittedAt: number;
}

/** Runs the engine once; keeps transitions with their emit time and when the Baseline became ready. */
function analyse(frames: Signal[]) {
  const engine = new RuleEngine();
  const trs: Recorded[] = [];
  let baselineAt = Infinity;
  for (const s of frames) {
    for (const tr of engine.push(s)) trs.push({ ...tr, emittedAt: s.t });
    if (baselineAt === Infinity && engine.currentBaseline) baselineAt = s.t;
  }
  return { trs, baselineAt, endT: frames.at(-1)!.t };
}

type Interviewer = (state: FollowUpState, t: number) => FollowUpEvent | null;
const alwaysAsk: Interviewer = (s, t) => (s.phase === "worth_exploring" || s.phase === "persisting" ? { type: "ask", t: t + 1_000 } : null);

function simulate(
  a: ReturnType<typeof analyse>,
  opts: { questions: Question[]; speech: { available: boolean; pauses: Pause[] }; interviewer?: Interviewer },
) {
  const { trs, baselineAt, endT } = a;
  const flags: Flag[] = [];
  const open = new Map<string, Flag>();
  const phases: FollowUpPhase[] = [];
  const effects: FollowUpEffect[] = [];
  const questions = [...opts.questions].sort((x, y) => x.start - y.start);
  const questionAt = (t: number) => [...questions].reverse().find((q) => q.start <= t) ?? null;
  let fu: FollowUpState | null = null;
  let qi = -1;
  let ti = 0;
  let ids = 0;
  let pending: FollowUpEvent | null = null;

  const apply = (e: FollowUpEvent) => {
    const r = reduceFollowUp(fu!, e);
    fu = r.state;
    effects.push(...r.effects);
    if (phases.at(-1) !== fu.phase) phases.push(fu.phase);
  };

  for (let t = 0; t <= endT; t += TICK_MS) {
    // Store: apply transitions emitted up to now.
    while (ti < trs.length && trs[ti].emittedAt <= t) {
      const tr = trs[ti++];
      if (tr.state === "start") {
        const f: Flag = { id: `f${++ids}`, kind: tr.kind, start: tr.t, end: null, questionId: questionAt(tr.t)?.id ?? null, evidence: tr.evidence };
        flags.push(f);
        open.set(tr.kind, f);
      } else {
        const f = open.get(tr.kind);
        if (f) {
          f.end = tr.t;
          f.evidence = { ...f.evidence, ...tr.evidence };
          open.delete(tr.kind);
        }
      }
    }
    // Controller: Question marker.
    while (qi + 1 < questions.length && questions[qi + 1].start <= t) {
      const q = questions[++qi];
      if (!fu) fu = initialFollowUp(q.id, q.start);
      apply({ type: "question_started", questionId: q.id, t: q.start, label: `Q${q.number} ${q.label}` });
    }
    if (!fu) continue;
    // Interviewer presses a button.
    if (pending && pending.t <= t) {
      apply(pending);
      pending = null;
    }
    // Controller tick: gate, then the re-observation clock.
    const state: FollowUpState = fu;
    if (state.phase === "observing" || state.phase === "re_observing") {
      const hit = evaluateGate({
        now: t,
        question: questions[qi],
        followUp: state,
        flags,
        baselineReady: t >= baselineAt,
        speech: opts.speech,
      });
      if (hit) apply({ type: "gate_hit", hit, momentId: `m${++ids}`, t });
    }
    apply({ type: "tick", t });
    if (!pending && opts.interviewer) pending = opts.interviewer(fu, t);
  }
  const moments = effects.filter((e) => e.type === "open_moment");
  return { flags, phases, effects, moments, final: fu as FollowUpState | null };
}

const Q = (n: number, start: number, label = "Tell me about a project"): Question => ({ id: `q${n}`, number: n, label, start });
const speechOn = (pauses: Pause[] = []) => ({ available: true, pauses });

describe("scenarios (PRD §21)", () => {
  it("step 1: 2 s glances inside 3 s pauses where speech resumes → nothing passes the gate", () => {
    const b = new SignalBuilder(101).setNoise(1).steady(16_000);
    const q = Q(2, b.t);
    b.steady(12_000);
    const pauses: Pause[] = [];
    for (let i = 0; i < 3; i++) {
      const pauseStart = b.t;
      b.hold(500).move(20, 0, 80).hold(2_000).move(0, 0, 80);
      b.hold(Math.max(0, pauseStart + 3_000 - b.t));
      pauses.push({ start: pauseStart, end: b.t });
      b.steady(8_000);
    }
    b.steady(20_000);
    const a = analyse(b.frames);
    expect(a.trs.filter((t) => t.kind === "off-screen" && t.state === "start")).toHaveLength(3);

    const withPauses = simulate(a, { questions: [q], speech: speechOn(pauses), interviewer: alwaysAsk });
    expect(withPauses.moments).toEqual([]);
    expect(withPauses.phases).toEqual(["observing"]);

    // Control: the same glances without the pauses would have opened a Moment.
    const control = simulate(a, { questions: [q], speech: speechOn([]) });
    expect(control.moments).toHaveLength(1);
  });

  it("steps 2–7: reading 20 s into Q2, Ask, then steady gaze → worth_exploring → re_observing → settled", () => {
    const b = new SignalBuilder(102).setNoise(1).steady(16_000);
    const q = Q(2, b.t);
    b.steady(20_000).setNoise(0.7).read(6, { startX: -6 }).setNoise(1).steady(45_000);
    const r = simulate(analyse(b.frames), { questions: [q], speech: speechOn(), interviewer: alwaysAsk });
    expect(r.phases).toEqual(["observing", "worth_exploring", "re_observing", "settled"]);
    expect(r.moments).toHaveLength(1);
    expect(r.moments[0]).toMatchObject({ hit: { kind: "reading-pattern" }, followUpNumber: 1, final: false });
    const texts = r.effects.filter((e) => e.type === "timeline").map((e) => (e.type === "timeline" ? e.text : ""));
    expect(texts).toEqual([
      "Question started — Q2 Tell me about a project",
      "Moment worth exploring — reading-like pattern",
      "Follow-up asked (1 / 2)",
      "Observation settled",
    ]);
  });

  it("reading continues after Ask → persisting → Ask → limit_reached", () => {
    const b = new SignalBuilder(103).setNoise(1).steady(16_000);
    const q = Q(2, b.t);
    b.steady(20_000);
    for (let i = 0; i < 3; i++) b.setNoise(0.7).read(6, { startX: -6 }).setNoise(1).steady(6_000);
    b.steady(30_000);
    const r = simulate(analyse(b.frames), { questions: [q], speech: speechOn(), interviewer: alwaysAsk });
    expect(r.phases).toEqual(["observing", "worth_exploring", "re_observing", "persisting", "re_observing", "limit_reached"]);
    expect(r.final).toMatchObject({ phase: "limit_reached", used: 2 });
    expect(r.moments.map((m) => (m.type === "open_moment" ? [m.followUpNumber, m.final] : null))).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("25 min of natural conversation over 8 Questions → 0 Moments, with and without speech context", () => {
    const b = new SignalBuilder(104).setNoise(1).conversation(25 * 60_000);
    const questions = Array.from({ length: 8 }, (_, i) => Q(i + 1, 20_000 + i * 180_000));
    const a = analyse(b.frames);
    expect(a.baselineAt).toBeLessThan(20_000);
    expect(simulate(a, { questions, speech: speechOn() }).moments).toEqual([]);
    expect(simulate(a, { questions, speech: { available: false, pauses: [] } }).moments).toEqual([]);
  }, 30_000);
});
