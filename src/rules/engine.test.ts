import { describe, expect, it } from "vitest";
import type { FlagKind, Signal } from "../domain/types";
import { RuleEngine } from "./engine";
import { run, SignalBuilder, type TimedTransition } from "./testing/synthetic";

const BASELINE_MS = 15_000;
const of = (trs: TimedTransition[], kind: FlagKind) => trs.filter((t) => t.kind === kind);

/** Starts and ends of each kind must alternate start,end,start,... and (optionally) finish closed. */
function expectWellFormed(trs: TimedTransition[], closed = true) {
  const kinds = new Set(trs.map((t) => t.kind));
  for (const k of kinds) {
    const seq = of(trs, k);
    seq.forEach((tr, i) => expect(tr.state, `${k} #${i}`).toBe(i % 2 === 0 ? "start" : "end"));
    if (closed) expect(seq.length % 2, `${k} left open`).toBe(0);
    for (let i = 1; i < seq.length; i++) expect(seq[i].t).toBeGreaterThanOrEqual(seq[i - 1].t);
  }
}

/** A builder that has already completed a steady 15s Baseline (plus a little margin). */
function afterBaseline(seed: number, noise = 1) {
  const b = new SignalBuilder(seed).setNoise(noise);
  b.steady(BASELINE_MS + 1_000);
  return b;
}

describe("steady gaze", () => {
  it.each([1, 2, 3, 4, 5])("60s of jittery steady gaze raises no Flags (seed %i)", (seed) => {
    const b = new SignalBuilder(seed).setNoise(1).steady(60_000);
    expect(run(b.frames)).toEqual([]);
  });
});

describe("natural conversation (false-positive guard)", () => {
  const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
  it.each(seeds)("3 min of conversation raises no off-screen or reading Flags (seed %i)", (seed) => {
    const b = new SignalBuilder(seed).setNoise(1).conversation(180_000);
    const trs = run(b.frames);
    expect(of(trs, "off-screen")).toEqual([]);
    expect(of(trs, "reading-pattern")).toEqual([]);
  });

  it.each(seeds)("conversation after a steady baseline raises no gaze Flags (seed %i)", (seed) => {
    const b = afterBaseline(seed).conversation(120_000);
    const trs = run(b.frames);
    expect(of(trs, "off-screen")).toEqual([]);
    expect(of(trs, "reading-pattern")).toEqual([]);
  });

  it.each([1, 2, 3, 4, 5])("conversation with noisier tracking (±1.5°) stays quiet (seed %i)", (seed) => {
    const b = new SignalBuilder(seed).setNoise(1.5).conversation(120_000);
    const trs = run(b.frames);
    expect(of(trs, "off-screen")).toEqual([]);
    expect(of(trs, "reading-pattern")).toEqual([]);
  });

  it("soak: 100 x 3 min of conversation at �1-1.5� noise (5 hours) raises no reading Flag", () => {
    let flagged = 0;
    for (let seed = 1000; seed < 1100; seed++) {
      const b = new SignalBuilder(seed).setNoise(seed % 2 ? 1 : 1.5).steady(16_000).conversation(180_000);
      if (run(b.frames).some((t) => t.kind === "reading-pattern" || t.kind === "off-screen")) flagged++;
    }
    expect(flagged).toBe(0);
  }, 60_000);

  it("repeated glances to the same side (every ~2s) do not look like reading", () => {
    const b = afterBaseline(7);
    for (let i = 0; i < 15; i++) {
      b.move(12, 0, 80).hold(b.uniform(500, 900)).move(b.uniform(-1, 1), 0, 80).hold(b.uniform(800, 1500));
    }
    b.steady(6_000);
    const trs = run(b.frames);
    expect(of(trs, "reading-pattern")).toEqual([]);
    expect(of(trs, "off-screen")).toEqual([]);
  });
});

describe("off-screen", () => {
  it("a single 1s glance away raises nothing", () => {
    const b = afterBaseline(11);
    b.move(20, 0, 80).hold(1_000).move(0, 0, 80).steady(5_000);
    expect(run(b.frames)).toEqual([]);
  });

  it("gaze held 20° away for 3s raises one off-screen Flag from onset to return", () => {
    const b = afterBaseline(12);
    const onset = b.t;
    b.move(20, 0, 80).hold(3_000);
    const back = b.t;
    b.move(0, 0, 80).steady(5_000);
    const trs = run(b.frames);
    expect(trs.map((t) => [t.kind, t.state])).toEqual([
      ["off-screen", "start"],
      ["off-screen", "end"],
    ]);
    expect(Math.abs(trs[0].t - onset)).toBeLessThan(200);
    expect(trs[0].detail).toBe("gaze moved to the right");
    expect(Math.abs(trs[1].t - back)).toBeLessThan(250);
  });

  it("works for gaze held up and in the opposite direction", () => {
    for (const [x, y, detail] of [
      [-20, 0, "gaze moved to the left"],
      [0, 20, "gaze moved up"],
      [0, -20, "gaze moved down"],
    ] as const) {
      const b = afterBaseline(13);
      b.move(x, y, 80).hold(3_000).move(0, 0, 80).steady(3_000);
      const trs = run(b.frames);
      expect(trs.map((t) => t.state)).toEqual(["start", "end"]);
      expect(trs[0].detail).toBe(detail);
    }
  });
});

describe("reading pattern", () => {
  function readingRun(seed: number, opts: { dir?: 1 | -1; noise?: number; startX?: number; lines?: number } = {}) {
    const b = afterBaseline(seed);
    b.setNoise(opts.noise ?? 0.7);
    const onset = b.t;
    b.read(opts.lines ?? 6, { dir: opts.dir, startX: opts.startX ?? (opts.dir === -1 ? 6 : -6) });
    const stop = b.t;
    b.setNoise(1).steady(10_000);
    const trs = run(b.frames);
    return { trs, onset, stop, reading: of(trs, "reading-pattern") };
  }

  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  it.each(seeds)("6 lines (increasing gazeX) start after the 4th line (~6-10s) and end 1-5.5s after reading stops (seed %i)", (seed) => {
    const { trs, onset, stop, reading } = readingRun(seed, { dir: 1 });
    expect(reading.map((r) => r.state)).toEqual(["start", "end"]);
    // 4 back-to-back lines are needed (config.reading.minCycles); a 10-15 deg line takes ~1.5-2s to read.
    expect(reading[0].emittedAt - onset).toBeLessThanOrEqual(10_000);
    // The Flag is back-dated to the start of the first line.
    expect(reading[0].t).toBeGreaterThanOrEqual(onset - 500);
    expect(reading[0].t).toBeLessThanOrEqual(onset + 1_000);
    expect(reading[1].t).toBeLessThanOrEqual(stop);
    expect(reading[1].emittedAt - stop).toBeGreaterThan(1_000);
    expect(reading[1].emittedAt - stop).toBeLessThan(5_500);
    expect(of(trs, "off-screen")).toEqual([]);
    expectWellFormed(trs);
  });

  it.each(seeds)("mirrored direction also triggers (seed %i)", (seed) => {
    const { onset, stop, reading } = readingRun(seed, { dir: -1 });
    expect(reading.map((r) => r.state)).toEqual(["start", "end"]);
    expect(reading[0].emittedAt - onset).toBeLessThanOrEqual(10_000);
    expect(reading[1].emittedAt - stop).toBeLessThan(5_500);
  });

  it.each(seeds)("reading a script right next to the video tile (inside baseline range) triggers (seed %i)", (seed) => {
    // Lines span roughly -4..+6 deg: never off-screen relative to the baseline, but still a sawtooth.
    const { trs, reading } = readingRun(seed, { dir: 1, startX: -4 });
    expect(of(trs, "off-screen")).toEqual([]);
    expect(reading.map((r) => r.state)).toEqual(["start", "end"]);
  });

  it("noisier tracking (±1.5°) — documented hit rate", () => {
    let hits = 0;
    const N = 20;
    for (let seed = 1; seed <= N; seed++) {
      const { reading } = readingRun(seed, { dir: 1, noise: 1.5 });
      if (reading.length > 0) hits++;
      expectWellFormed(reading);
    }
    console.log(`reading detected with ±1.5° noise in ${hits}/${N} runs`);
    // Measured 12/20 (60%) with the shipped config; �2� noise drops to ~0%.
    expect(hits).toBeGreaterThanOrEqual(N * 0.4);
  });

  it.each(seeds)("3 lines alone are not enough (seed %i)", (seed) => {
    const { reading } = readingRun(seed, { lines: 3 });
    expect(reading).toEqual([]);
  });
});

describe("face rules", () => {
  it("face missing for 3s raises face-missing start/end", () => {
    const b = afterBaseline(21);
    const gone = b.t;
    b.faceMissing(3_000);
    const back = b.t;
    b.steady(3_000);
    const trs = run(b.frames);
    expect(trs.map((t) => [t.kind, t.state])).toEqual([
      ["face-missing", "start"],
      ["face-missing", "end"],
    ]);
    expect(trs[0].t).toBe(gone);
    expect(trs[1].t).toBe(back);
  });

  it("0.5s dropout raises nothing", () => {
    const b = afterBaseline(22);
    b.faceMissing(500).steady(3_000);
    expect(run(b.frames)).toEqual([]);
  });

  it("second face for 2s raises second-face start/end", () => {
    const b = afterBaseline(23);
    b.faces(2, 2_000).steady(3_000);
    const trs = run(b.frames);
    expect(trs.map((t) => [t.kind, t.state])).toEqual([
      ["second-face", "start"],
      ["second-face", "end"],
    ]);
    expect(trs[0].detail).toBe("2 faces visible");
  });

  it("face rules work before the baseline is complete", () => {
    const b = new SignalBuilder(24).setNoise(1);
    b.steady(2_000).faceMissing(3_000).steady(1_000).faces(2, 2_000).steady(2_000);
    const trs = run(b.frames);
    expect(trs.map((t) => [t.kind, t.state])).toEqual([
      ["face-missing", "start"],
      ["face-missing", "end"],
      ["second-face", "start"],
      ["second-face", "end"],
    ]);
  });
});

describe("baseline gating and reset", () => {
  it("no off-screen or reading Flags before the 15s baseline completes", () => {
    const b = new SignalBuilder(31).setNoise(0.7);
    b.steady(500).move(25, 0, 80).hold(3_000).move(0, 0, 80);
    b.read(4, { startX: -6 });
    expect(b.t).toBeLessThan(BASELINE_MS);
    const engine = new RuleEngine();
    const trs = run(b.frames, engine);
    expect(trs).toEqual([]);
    expect(engine.currentBaseline).toBeNull();
    expect(engine.baselineProgress).toBeGreaterThan(0.5);
    expect(engine.baselineProgress).toBeLessThan(1);
  });

  it("baseline completes after ~15s of tracked face and is centred on the gaze", () => {
    const b = new SignalBuilder(32, 4, -2).setNoise(1).steady(16_000, 4, -2);
    const engine = new RuleEngine();
    run(b.frames, engine);
    const base = engine.currentBaseline!;
    expect(engine.baselineProgress).toBe(1);
    expect(Math.abs(base.centreX - 4)).toBeLessThan(1.5);
    expect(Math.abs(base.centreY + 2)).toBeLessThan(1.5);
  });

  it("resetBaseline ends an ongoing off-screen Flag and restarts learning", () => {
    const b = afterBaseline(33);
    b.move(20, 0, 80).hold(3_000);
    const engine = new RuleEngine();
    const before = run(b.frames, engine);
    expect(before.map((t) => [t.kind, t.state])).toEqual([["off-screen", "start"]]);
    const resetAt = b.t;
    const ended = engine.resetBaseline(resetAt);
    expect(ended).toMatchObject([{ kind: "off-screen", state: "end", t: resetAt }]);
    expect(ended[0].evidence?.peakDeviationDeg).toBeGreaterThan(10);
    expect(engine.currentBaseline).toBeNull();
    expect(engine.baselineProgress).toBe(0);

    // Learning starts again: gaze still at 20 deg is the new normal, so nothing new fires.
    const b2 = new SignalBuilder(34, 20, 0).setNoise(1);
    const offset = b.t;
    b2.steady(20_000, 20, 0);
    const after = run(b2.frames.map((s) => ({ ...s, t: s.t + offset })), engine);
    expect(after).toEqual([]);
    expect(Math.abs(engine.currentBaseline!.centreX - 20)).toBeLessThan(1.5);
  });

  it("resetBaseline ends an ongoing reading Flag", () => {
    const b = afterBaseline(35).setNoise(0.7);
    b.read(6, { startX: -6 });
    const engine = new RuleEngine();
    const before = run(b.frames, engine);
    expect(of(before, "reading-pattern").map((t) => t.state)).toEqual(["start"]);
    const ended = engine.resetBaseline(b.t);
    expect(ended).toEqual([{ kind: "reading-pattern", state: "end", t: b.t }]);
  });

  it("resetBaseline with nothing active returns no transitions", () => {
    const engine = new RuleEngine();
    run(afterBaseline(36).frames, engine);
    expect(engine.resetBaseline(20_000)).toEqual([]);
  });
});

describe("pairing", () => {
  it("a long mixed session yields well-formed start/end pairs that all close", () => {
    const b = afterBaseline(41);
    b.conversation(20_000);
    b.move(20, 5, 80).hold(3_000).move(0, 0, 80);
    b.conversation(10_000);
    b.setNoise(0.7).read(6, { startX: -6 }).setNoise(1);
    b.steady(6_000);
    b.faceMissing(3_000);
    b.steady(2_000).faces(2, 2_000);
    b.move(-20, 0, 80).hold(2_500).faceMissing(2_500).steady(3_000);
    b.conversation(20_000);
    const trs = run(b.frames);
    expectWellFormed(trs, true);
    const kinds = new Set(trs.map((t) => t.kind));
    expect(kinds).toEqual(new Set(["off-screen", "reading-pattern", "face-missing", "second-face"]));
  });
});

describe("Flag evidence (FR-009)", () => {
  it("off-screen carries baseline, threshold and direction on start, and a peak >= threshold on end", () => {
    const b = afterBaseline(51);
    b.move(20, 0, 80).hold(3_000).move(0, 0, 80).steady(3_000);
    const trs = of(run(b.frames), "off-screen");
    expect(trs.map((t) => t.state)).toEqual(["start", "end"]);
    const ev = trs[0].evidence!;
    expect(ev.baseline).toBeDefined();
    expect(ev.thresholdDeg!.x).toBeGreaterThanOrEqual(10);
    expect(ev.thresholdDeg!.y).toBeGreaterThanOrEqual(10);
    expect(ev.direction).toBe("right");
    const peak = trs[1].evidence!.peakDeviationDeg!;
    expect(peak).toBeGreaterThanOrEqual(Math.min(ev.thresholdDeg!.x, ev.thresholdDeg!.y));
    expect(peak).toBeGreaterThan(17);
  });

  it("second face carries faceCount 2", () => {
    const b = afterBaseline(52);
    b.faces(2, 2_000).steady(3_000);
    const start = run(b.frames).find((t) => t.kind === "second-face" && t.state === "start")!;
    expect(start.evidence).toEqual({ faceCount: 2 });
  });

  it("reading carries cycles >= 4", () => {
    const b = afterBaseline(53).setNoise(0.7);
    b.read(6, { startX: -6 }).setNoise(1).steady(8_000);
    const start = run(b.frames).find((t) => t.kind === "reading-pattern" && t.state === "start")!;
    expect(start.evidence!.cycles).toBeGreaterThanOrEqual(4);
    expect(start.evidence!.baseline).toBeDefined();
  });
});

/** Emulates the pipeline's sampling cap: keep frames at least 1000 / fps ms apart. */
function subsample(frames: Signal[], fps: number): Signal[] {
  const minGap = 1000 / fps - 1;
  const out: Signal[] = [];
  let last = -Infinity;
  for (const f of frames) {
    if (f.t - last >= minGap) {
      out.push(f);
      last = f.t;
    }
  }
  return out;
}

describe("sampling rates (VISION caps)", () => {
  it.each([10, 15, 30])("off-screen hold of 3s is flagged at %i fps", (fps) => {
    const b = afterBaseline(61);
    b.move(20, 0, 80).hold(3_000).move(0, 0, 80).steady(3_000);
    const trs = of(run(subsample(b.frames, fps)), "off-screen");
    expect(trs.map((t) => t.state)).toEqual(["start", "end"]);
  });

  it.each([10, 15, 30])("conversation stays quiet at %i fps", (fps) => {
    for (let seed = 1; seed <= 5; seed++) {
      const b = afterBaseline(seed).conversation(120_000);
      const trs = run(subsample(b.frames, fps));
      expect(of(trs, "off-screen")).toEqual([]);
      expect(of(trs, "reading-pattern")).toEqual([]);
    }
  });

  it.each([
    // Measured 8/8 at every rate with 0.7 deg noise.
    [30, 8],
    [15, 8],
    [10, 6],
  ])("reading hit rate at %i fps (documented, >= %i / 8)", (fps, minHits) => {
    let hits = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const b = afterBaseline(seed).setNoise(0.7);
      b.read(6, { dir: 1, startX: -6 }).setNoise(1).steady(10_000);
      if (of(run(subsample(b.frames, fps)), "reading-pattern").length > 0) hits++;
    }
    console.log(`reading detected at ${fps} fps in ${hits}/8 runs`);
    expect(hits).toBeGreaterThanOrEqual(minHits);
  });
});
