import type { SessionTime } from "../domain/types";
import { RULES } from "./config";

interface Run {
  dir: 1 | -1;
  amp: number;
  /** When the run had covered 20% / 80% of its amplitude: its "core" movement, excluding fixations at either end. */
  start: SessionTime;
  end: SessionTime;
  /** Gaze value where the run began (for a drift: the line's starting margin). */
  from: number;
}

export interface ReadingUpdate {
  state: "start" | "end";
  t: SessionTime;
  cycles: number;
}

/**
 * Detects the sawtooth gaze of someone reading lines of text: a slow drift one way
 * (along the line) then a fast return the other way (to the next line), repeated.
 * Direction-agnostic, so it works whether or not the video is mirrored.
 */
export class ReadingPatternDetector {
  private cfg = RULES.reading;
  private smooth: number | null = null;
  private dir: 0 | 1 | -1 = 0;
  private runStartT = 0;
  private runStartV = 0;
  private extT = 0;
  private extV = 0;
  /** Smoothed samples since the current run started, used to time the run's core movement. */
  private samples: { t: SessionTime; v: number }[] = [];
  private lastRun: Run | null = null;
  private cycles: { t: SessionTime; dir: 1 | -1; driftStart: SessionTime; margin: number; chain: number; chainStart: SessionTime }[] = [];
  /** Number of completed runs; used to check that cycles follow each other back to back. */
  private runCount = 0;
  private lastCycleRun = -10;
  private active = false;
  private activeSince: SessionTime = 0;

  push(t: SessionTime, gazeX: number | null): ReadingUpdate | null {
    if (gazeX === null) {
      this.resetRun();
      return this.maybeEnd(t);
    }
    const a = this.cfg.smoothing;
    const first = this.smooth === null;
    const v = (this.smooth = first ? gazeX : a * gazeX + (1 - a) * this.smooth!);
    if (first) {
      this.runStartT = t;
      this.runStartV = v;
    }
    this.samples.push({ t, v });

    if (this.dir === 0) {
      if (Math.abs(v - this.runStartV) > this.cfg.hysteresis) {
        this.dir = v > this.runStartV ? 1 : -1;
        this.extV = v;
        this.extT = t;
      } else if (t - this.runStartT > 1000) {
        this.runStartT = t;
        this.runStartV = v;
        this.samples = [{ t, v }];
      }
    } else if ((v - this.extV) * this.dir > 0) {
      this.extV = v;
      this.extT = t;
    } else if ((this.extV - v) * this.dir > this.cfg.hysteresis) {
      this.completeRun(this.coreTiming(this.dir));
      this.samples = this.samples.filter((s) => s.t >= this.extT);
      this.runStartT = this.extT;
      this.runStartV = this.extV;
      this.dir = this.dir === 1 ? -1 : 1;
      this.extV = v;
      this.extT = t;
    }

    return this.evaluate(t);
  }

  /** Time between first reaching 20% and 80% of the run's amplitude (robust to noise at either end). */
  private coreTiming(dir: 1 | -1): Run {
    const amp = Math.abs(this.extV - this.runStartV);
    let t10: SessionTime | null = null;
    let t90: SessionTime = this.extT;
    for (const s of this.samples) {
      if (s.t > this.extT) break;
      const progress = ((s.v - this.runStartV) * dir) / amp;
      if (t10 === null && progress >= 0.2) t10 = s.t;
      if (progress >= 0.8) {
        t90 = s.t;
        break;
      }
    }
    return { dir, amp, start: t10 ?? this.runStartT, end: t90, from: this.runStartV };
  }

  private completeRun(run: Run) {
    const prev = this.lastRun;
    this.lastRun = run;
    this.runCount++;
    if (!prev || prev.dir === run.dir) return;
    const prevMs = prev.end - prev.start;
    const runMs = run.end - run.start;
    const isDrift = prev.amp >= this.cfg.driftMinAmp && prevMs >= this.cfg.driftMinMs;
    const isReturn = runMs <= this.cfg.returnMaxMs && run.amp >= prev.amp * this.cfg.returnMinFraction;
    if (!isDrift || !isReturn) return;
    // Lines of text are read back to back (drift, return, drift, return...) and start at the same margin.
    const last = this.cycles.at(-1);
    const chained =
      last !== undefined &&
      this.lastCycleRun === this.runCount - 2 &&
      last.dir === prev.dir &&
      Math.abs(last.margin - prev.from) <= this.cfg.marginTolerance;
    this.lastCycleRun = this.runCount;
    this.cycles.push({
      t: run.end,
      dir: prev.dir,
      driftStart: prev.start,
      margin: prev.from,
      chain: chained ? last.chain + 1 : 1,
      chainStart: chained ? last.chainStart : prev.start,
    });
  }

  private evaluate(t: SessionTime): ReadingUpdate | null {
    this.cycles = this.cycles.filter((c) => t - c.t <= this.cfg.windowMs);
    if (!this.active) {
      const last = this.cycles.at(-1);
      if (!last || last.chain < this.cfg.minCycles || last.t - last.chainStart > this.cfg.windowMs) return null;
      this.active = true;
      // The pattern began when the first line of the chain started.
      this.activeSince = last.chainStart;
      return { state: "start", t: this.activeSince, cycles: last.chain };
    }
    return this.maybeEnd(t);
  }

  private maybeEnd(t: SessionTime): ReadingUpdate | null {
    if (!this.active) return null;
    const last = this.cycles.at(-1)?.t ?? this.activeSince;
    if (t - last < this.cfg.endAfterMs) return null;
    this.active = false;
    const count = this.cycles.length;
    this.cycles = [];
    return { state: "end", t: last, cycles: count };
  }

  private resetRun() {
    this.smooth = null;
    this.dir = 0;
    this.lastRun = null;
    this.samples = [];
    this.lastCycleRun = -10;
  }

  get isActive() {
    return this.active;
  }
}
