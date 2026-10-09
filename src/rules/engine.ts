import type { Baseline, FlagKind, Signal, SessionTime } from "../domain/types";
import { BaselineLearner } from "./baseline";
import { RULES } from "./config";
import { DebouncedCondition } from "./debounce";
import { ReadingPatternDetector } from "./readingPattern";

export interface FlagTransition {
  kind: FlagKind;
  state: "start" | "end";
  t: SessionTime;
  detail?: string;
}

const offScreenScore = (s: Signal, b: Baseline) => {
  const thrX = Math.max(RULES.offScreen.spreadMultiplier * b.spreadX, RULES.offScreen.minThreshold);
  const thrY = Math.max(RULES.offScreen.spreadMultiplier * b.spreadY, RULES.offScreen.minThreshold);
  return Math.max(Math.abs(s.gazeX! - b.centreX) / thrX, Math.abs(s.gazeY! - b.centreY) / thrY);
};

/** Feeds Signals through every rule and reports Flag start/end transitions. Pure logic, no DOM. */
export class RuleEngine {
  private baseline = new BaselineLearner();
  private offScreen = new DebouncedCondition(RULES.offScreen.onMs, RULES.offScreen.offMs);
  private faceMissing = new DebouncedCondition(RULES.faceMissing.onMs, RULES.faceMissing.offMs);
  private secondFace = new DebouncedCondition(RULES.secondFace.onMs, RULES.secondFace.offMs);
  private reading = new ReadingPatternDetector();

  push(s: Signal): FlagTransition[] {
    const out: FlagTransition[] = [];
    const add = (kind: FlagKind, tr: { state: "start" | "end"; t: SessionTime } | null, detail?: string) => {
      if (tr) out.push({ kind, ...tr, ...(tr.state === "start" && detail ? { detail } : {}) });
    };

    add("face-missing", this.faceMissing.update(s.t, s.faceCount === 0));
    add("second-face", this.secondFace.update(s.t, s.faceCount >= 2), `${s.faceCount} faces visible`);

    const b = this.baseline.push(s);
    if (!b) return out;

    const single = s.faceCount === 1 && s.gazeX !== null && s.gazeY !== null;
    const score = single ? offScreenScore(s, b) : 0;
    add("off-screen", this.offScreen.update(s.t, score > 1), describeDirection(s, b));

    const r = this.reading.push(s.t, single ? s.gazeX : null);
    if (r) add("reading-pattern", r, `${r.cycles} line sweeps in ${RULES.reading.windowMs / 1000}s`);
    return out;
  }

  /** Forget the learned Baseline; ongoing Flags end at time t. */
  resetBaseline(t: SessionTime): FlagTransition[] {
    const out: FlagTransition[] = [];
    if (this.offScreen.isActive) out.push({ kind: "off-screen", state: "end", t });
    if (this.reading.isActive) out.push({ kind: "reading-pattern", state: "end", t });
    this.baseline = new BaselineLearner();
    this.offScreen = new DebouncedCondition(RULES.offScreen.onMs, RULES.offScreen.offMs);
    this.reading = new ReadingPatternDetector();
    return out;
  }

  get baselineProgress() {
    return this.baseline.progress;
  }

  get currentBaseline(): Baseline | null {
    return this.baseline.value;
  }
}

function describeDirection(s: Signal, b: Baseline): string | undefined {
  if (s.gazeX === null || s.gazeY === null) return undefined;
  const dx = s.gazeX - b.centreX;
  const dy = s.gazeY - b.centreY;
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "looking up" : "looking down";
  return "looking to the side";
}
