import { describe, expect, it } from "vitest";
import type { Pause } from "../domain/types";
import { inOpenPause as rulesInOpenPause, isThinkingPause as rulesIsThinkingPause } from "../rules/pauses";
import { inOpenPause, isThinkingPause, SPEECH, SpeechActivityDetector, type ActivityTransition } from "./speechActivity";

const STEP = SPEECH.SAMPLE_MS;

/** Feeds a constant RMS for ms starting at t0; returns the transitions and the next sample time. */
function feed(d: SpeechActivityDetector, t0: number, ms: number, rms: number | ((t: number) => number)) {
  const out: ActivityTransition[] = [];
  let t = t0;
  for (; t < t0 + ms; t += STEP) {
    const tr = d.push(t, typeof rms === "number" ? rms : rms(t));
    if (tr) out.push(tr);
  }
  return { out, t };
}

describe("SpeechActivityDetector", () => {
  it("1. silence at RMS 0.002 stays paused", () => {
    const d = new SpeechActivityDetector();
    expect(feed(d, 0, 10_000, 0.002).out).toEqual([]);
    expect(d.state).toBe("pause");
  });

  it("2. a 100 ms burst is below onset; a 200 ms burst starts speaking at the burst start", () => {
    const d = new SpeechActivityDetector();
    let { t } = feed(d, 0, 2_000, 0.002);
    const short = feed(d, t, 100, 0.05);
    expect(short.out).toEqual([]);
    t = feed(d, short.t, 1_000, 0.002).t;
    const burstStart = t;
    const long = feed(d, t, 200, 0.05);
    expect(long.out).toEqual([{ state: "speaking", t: burstStart }]);
    expect(d.state).toBe("speaking");
  });

  it("3. while speaking, a 300 ms dip stays speaking; a 500 ms dip pauses at the dip start", () => {
    const d = new SpeechActivityDetector();
    let { t } = feed(d, 0, 2_000, 0.002);
    t = feed(d, t, 1_000, 0.05).t;
    expect(d.state).toBe("speaking");
    const dip = feed(d, t, 300, 0.002);
    expect(dip.out).toEqual([]);
    t = feed(d, dip.t, 500, 0.05).t;
    expect(d.state).toBe("speaking");
    const dipStart = t;
    const long = feed(d, t, 500, 0.002);
    expect(long.out).toEqual([{ state: "pause", t: dipStart }]);
    expect(d.state).toBe("pause");
  });

  it("4. a slowly rising noise floor (fan) does not trigger speech", () => {
    const d = new SpeechActivityDetector();
    // 0.002 → 0.04 over 60 s: the floor adapts and the threshold rises with it.
    const r = feed(d, 0, 60_000, (t) => 0.002 + (0.038 * t) / 60_000);
    expect(r.out).toEqual([]);
    expect(d.state).toBe("pause");
  });

  it("5. NaN or negative RMS is treated as 0", () => {
    const d = new SpeechActivityDetector();
    expect(feed(d, 0, 2_000, NaN).out).toEqual([]);
    expect(feed(d, 2_000, 2_000, -1).out).toEqual([]);
    expect(d.state).toBe("pause");
    // Still able to detect speech afterwards.
    expect(feed(d, 4_000, 300, 0.05).out).toEqual([{ state: "speaking", t: 4_000 }]);
    // While speaking, NaN counts as silence.
    expect(feed(d, 4_300, 500, NaN).out).toEqual([{ state: "pause", t: 4_300 }]);
  });
});

describe("pause helpers", () => {
  const pauses: Pause[] = [
    { start: 1_000, end: 5_000 }, // exactly 4,000 ms
    { start: 10_000, end: 14_001 }, // 4,001 ms
    { start: 20_000, end: null }, // open
  ];

  it("6. isThinkingPause: a pause of exactly 4,000 ms counts, 4,001 ms does not; inclusive ends", () => {
    expect(isThinkingPause(pauses, 1_000)).toBe(true);
    expect(isThinkingPause(pauses, 5_000)).toBe(true);
    expect(isThinkingPause(pauses, 5_001)).toBe(false);
    expect(isThinkingPause(pauses, 999)).toBe(false);
    expect(isThinkingPause(pauses, 12_000)).toBe(false);
    expect(isThinkingPause(pauses, 12_000, 5_000)).toBe(true);
    // An open pause is never a thinking pause (speech has not resumed yet).
    expect(isThinkingPause(pauses, 25_000)).toBe(false);
  });

  it("6. inOpenPause: only the ongoing pause, from its start", () => {
    expect(inOpenPause(pauses, 19_999)).toBe(false);
    expect(inOpenPause(pauses, 20_000)).toBe(true);
    expect(inOpenPause(pauses, 99_000)).toBe(true);
    expect(inOpenPause(pauses, 3_000)).toBe(false);
    expect(inOpenPause([{ start: 0, end: 4_000 }], 4_000)).toBe(false);
  });

  it("audio re-exports the rules/ helpers", () => {
    expect(isThinkingPause).toBe(rulesIsThinkingPause);
    expect(inOpenPause).toBe(rulesInOpenPause);
  });
});
