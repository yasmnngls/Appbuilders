import type { Baseline, Signal } from "../domain/types";
import { RULES } from "./config";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Robust spread: median absolute deviation scaled to approximate a standard deviation. */
const spread = (xs: number[], centre: number) => median(xs.map((x) => Math.abs(x - centre))) * 1.4826;

/** Learns the Candidate's normal gaze from the first stretch of single-face Signals. */
export class BaselineLearner {
  private xs: number[] = [];
  private ys: number[] = [];
  private trackedMs = 0;
  private lastT: number | null = null;
  private result: Baseline | null = null;

  push(s: Signal): Baseline | null {
    if (this.result) return this.result;
    const ok = s.faceCount === 1 && s.gazeX !== null && s.gazeY !== null;
    if (ok) {
      if (this.lastT !== null) this.trackedMs += Math.min(s.t - this.lastT, 200);
      this.xs.push(s.gazeX!);
      this.ys.push(s.gazeY!);
    }
    this.lastT = ok ? s.t : null;
    if (this.trackedMs >= RULES.baseline.durationMs) {
      const centreX = median(this.xs);
      const centreY = median(this.ys);
      this.result = {
        centreX,
        centreY,
        spreadX: Math.max(spread(this.xs, centreX), RULES.baseline.minSpread),
        spreadY: Math.max(spread(this.ys, centreY), RULES.baseline.minSpread),
      };
    }
    return this.result;
  }

  get value(): Baseline | null {
    return this.result;
  }

  /** 0..1 progress for the UI. */
  get progress() {
    return Math.min(this.trackedMs / RULES.baseline.durationMs, 1);
  }
}
