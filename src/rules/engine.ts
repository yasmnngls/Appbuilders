import type { Baseline, FlagEvidence, FlagKind, Signal, SessionTime } from "../domain/types";
import { BaselineLearner } from "./baseline";
import { RULES } from "./config";
import { DebouncedCondition } from "./debounce";
import { ReadingPatternDetector } from "./readingPattern";

export type GazeDirection = NonNullable<FlagEvidence["direction"]>;

export interface FlagTransition {
  kind: FlagKind;
  state: "start" | "end";
  t: SessionTime;
  detail?: string;
  /** Observable measurements behind the Flag (FR-009). On `start`: what triggered it; on `end`: e.g. the peak. */
  evidence?: FlagEvidence;
}

const thresholds = (b: Baseline) => ({
  x: Math.max(RULES.offScreen.spreadMultiplier * b.spreadX, RULES.offScreen.minThreshold),
  y: Math.max(RULES.offScreen.spreadMultiplier * b.spreadY, RULES.offScreen.minThreshold),
});

const offScreenScore = (s: Signal, b: Baseline) => {
  const thr = thresholds(b);
  return Math.max(Math.abs(s.gazeX! - b.centreX) / thr.x, Math.abs(s.gazeY! - b.centreY) / thr.y);
};

/** Largest deviation from the baseline centre on either axis, in degrees. */
const deviation = (s: Signal, b: Baseline) => Math.max(Math.abs(s.gazeX! - b.centreX), Math.abs(s.gazeY! - b.centreY));

/** Direction of the gaze relative to the baseline centre, as seen by the Interviewer. */
export function gazeDirection(s: Signal, b: Baseline): GazeDirection | undefined {
  if (s.gazeX === null || s.gazeY === null) return undefined;
  const dx = s.gazeX - b.centreX;
  const dy = s.gazeY - b.centreY;
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "up" : "down";
  return dx >= 0 ? "right" : "left";
}

/** Plain observation words (PRD §18.1 "gaze moved"). */
export function directionDetail(d: GazeDirection): string {
  return d === "up" || d === "down" ? `gaze moved ${d}` : `gaze moved to the ${d}`;
}

/** Feeds Signals through every rule and reports Flag start/end transitions. Pure logic, no DOM. */
export class RuleEngine {
  private baseline = new BaselineLearner();
  private offScreen = new DebouncedCondition(RULES.offScreen.onMs, RULES.offScreen.offMs);
  private faceMissing = new DebouncedCondition(RULES.faceMissing.onMs, RULES.faceMissing.offMs);
  private secondFace = new DebouncedCondition(RULES.secondFace.onMs, RULES.secondFace.offMs);
  private reading = new ReadingPatternDetector();
  /** Peak deviation (deg) since the off-screen condition last became true; reset once it is fully off. */
  private offPeak = 0;
  /** Most faces seen since the second-face condition last became true. */
  private maxFaces = 0;

  push(s: Signal): FlagTransition[] {
    const out: FlagTransition[] = [];
    const add = (
      kind: FlagKind,
      tr: { state: "start" | "end"; t: SessionTime } | null,
      start?: { detail?: string; evidence?: FlagEvidence },
      endEvidence?: FlagEvidence,
    ) => {
      if (!tr) return;
      const extra = tr.state === "start" ? start : endEvidence ? { evidence: endEvidence } : undefined;
      out.push({
        kind,
        ...tr,
        ...(extra?.detail ? { detail: extra.detail } : {}),
        ...(extra?.evidence ? { evidence: extra.evidence } : {}),
      });
    };

    add("face-missing", this.faceMissing.update(s.t, s.faceCount === 0));

    const two = s.faceCount >= 2;
    if (two) this.maxFaces = Math.max(this.maxFaces, s.faceCount);
    const sf = this.secondFace.update(s.t, two);
    add("second-face", sf, { detail: `${this.maxFaces} faces visible`, evidence: { faceCount: this.maxFaces } });
    if (!two && !this.secondFace.isActive) this.maxFaces = 0;

    const b = this.baseline.push(s);
    if (!b) return out;

    const single = s.faceCount === 1 && s.gazeX !== null && s.gazeY !== null;
    const off = single && offScreenScore(s, b) > 1;
    if (off) this.offPeak = Math.max(this.offPeak, deviation(s, b));
    const dir = single ? gazeDirection(s, b) : undefined;
    const ot = this.offScreen.update(s.t, off);
    const thr = thresholds(b);
    add(
      "off-screen",
      ot,
      {
        detail: dir ? directionDetail(dir) : undefined,
        evidence: { baseline: { ...b }, thresholdDeg: thr, ...(dir ? { direction: dir } : {}) },
      },
      { peakDeviationDeg: this.offPeak },
    );
    if (!off && !this.offScreen.isActive) this.offPeak = 0;

    const r = this.reading.push(s.t, single ? s.gazeX : null);
    if (r)
      add(
        "reading-pattern",
        r,
        { detail: `${r.cycles} line sweeps in ${RULES.reading.windowMs / 1000}s`, evidence: { baseline: { ...b }, cycles: r.cycles } },
        { cycles: r.cycles },
      );
    return out;
  }

  /** Forget the learned Baseline; ongoing Flags end at time t. */
  resetBaseline(t: SessionTime): FlagTransition[] {
    const out: FlagTransition[] = [];
    if (this.offScreen.isActive) out.push({ kind: "off-screen", state: "end", t, evidence: { peakDeviationDeg: this.offPeak } });
    if (this.reading.isActive) out.push({ kind: "reading-pattern", state: "end", t });
    this.baseline = new BaselineLearner();
    this.offScreen = new DebouncedCondition(RULES.offScreen.onMs, RULES.offScreen.offMs);
    this.reading = new ReadingPatternDetector();
    this.offPeak = 0;
    return out;
  }

  get baselineProgress() {
    return this.baseline.progress;
  }

  get currentBaseline(): Baseline | null {
    return this.baseline.value;
  }
}

