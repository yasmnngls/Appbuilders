/**
 * Deterministic synthetic Signal generator for rule tests (30 fps, seeded noise).
 * Gaze is in degrees; the generator tracks a "true" gaze point and adds uniform noise per frame.
 */
import type { Signal } from "../../domain/types";
import { RuleEngine, type FlagTransition } from "../engine";

export const FPS = 30;
const FRAME_MS = 1000 / FPS;

/** mulberry32: tiny seeded PRNG returning [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SignalBuilder {
  readonly frames: Signal[] = [];
  private i = 0;
  x: number;
  y: number;
  noise = 1;
  readonly rand: () => number;

  constructor(seed = 1, centreX = 0, centreY = 0) {
    this.rand = rng(seed);
    this.x = centreX;
    this.y = centreY;
  }

  /** Current session time (ms) of the next frame. */
  get t() {
    return Math.round(this.i * FRAME_MS);
  }

  uniform(lo: number, hi: number) {
    return lo + (hi - lo) * this.rand();
  }

  setNoise(deg: number) {
    this.noise = deg;
    return this;
  }

  private emit(faceCount = 1) {
    const n = () => (this.rand() * 2 - 1) * this.noise;
    const face = faceCount >= 1;
    this.frames.push({
      t: this.t,
      faceCount,
      headYaw: face ? this.x * 0.6 : null,
      headPitch: face ? this.y * 0.6 : null,
      irisX: face ? 0 : null,
      irisY: face ? 0 : null,
      gazeX: face ? this.x + n() : null,
      gazeY: face ? this.y + n() : null,
    });
    this.i++;
  }

  /** Hold the current gaze point for ms. */
  hold(ms: number, faceCount = 1) {
    const end = this.t + ms;
    while (this.t < end) this.emit(faceCount);
    return this;
  }

  /** Move linearly to (x, y) over ms (a saccade when ms is ~30-150). */
  move(x: number, y: number, ms: number) {
    const x0 = this.x;
    const y0 = this.y;
    const start = this.t;
    const end = start + Math.max(ms, 1);
    while (this.t < end) {
      const f = Math.min((this.t - start) / ms, 1);
      this.x = x0 + (x - x0) * f;
      this.y = y0 + (y - y0) * f;
      this.emit();
    }
    this.x = x;
    this.y = y;
    return this;
  }

  /** Jump instantly (next frame is at the new point). */
  jump(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }

  faceMissing(ms: number) {
    return this.hold(ms, 0);
  }

  faces(n: number, ms: number) {
    return this.hold(ms, n);
  }

  /** Steady attentive gaze around (cx, cy): fixations with occasional 1-3 deg micro-saccades. */
  steady(ms: number, cx = 0, cy = 0) {
    const end = this.t + ms;
    this.jump(cx, cy);
    while (this.t < end) {
      this.hold(this.uniform(300, 1200));
      if (this.rand() < 0.5) {
        const a = this.rand() * Math.PI * 2;
        const r = this.uniform(1, 3);
        // Wander but stay anchored to centre.
        const nx = Math.abs(this.x + Math.cos(a) * r - cx) > 3 ? cx : this.x + Math.cos(a) * r;
        const ny = Math.abs(this.y + Math.sin(a) * r - cy) > 3 ? cy : this.y + Math.sin(a) * r;
        this.move(nx, ny, 40);
      }
    }
    return this;
  }

  /**
   * Natural conversation: looking around near centre, slow drifts, and occasional
   * 0.5-1s glances up/aside of up to `glanceMax` degrees.
   */
  conversation(ms: number, cx = 0, cy = 0, glanceMax = 15) {
    const end = this.t + ms;
    this.jump(cx, cy);
    while (this.t < end) {
      const p = this.rand();
      if (p < 0.2) {
        // Glance up / aside and back.
        const dirs = [
          [0, 1],
          [1, 0],
          [-1, 0],
          [0.7, 0.7],
          [-0.7, 0.7],
          [0, -1],
        ];
        const [dx, dy] = dirs[Math.floor(this.rand() * dirs.length)];
        const r = this.uniform(5, glanceMax);
        this.move(cx + dx * r, cy + dy * r, this.uniform(50, 120));
        this.hold(this.uniform(500, 1000));
        this.move(cx + this.uniform(-2, 2), cy + this.uniform(-2, 2), this.uniform(50, 120));
      } else if (p < 0.4) {
        // Slow drift a few degrees, e.g. while thinking.
        this.move(cx + this.uniform(-5, 5), cy + this.uniform(-4, 4), this.uniform(600, 1500));
      } else {
        // Looking around near centre (face of the interviewer).
        this.move(cx + this.uniform(-3, 3), cy + this.uniform(-3, 3), this.uniform(30, 60));
      }
      this.hold(this.uniform(250, 900));
    }
    return this;
  }

  /**
   * Read `lines` lines of text. `dir` = +1 reads toward increasing gazeX, -1 the mirror.
   * Each line: 4-7 saccades of 1.5-2.5 deg with 200-250 ms fixations, then an 80-150 ms return.
   */
  read(lines: number, opts: { dir?: 1 | -1; startX?: number; y?: number; lineDy?: number } = {}) {
    const dir = opts.dir ?? 1;
    const startX = opts.startX ?? this.x;
    let y = opts.y ?? this.y;
    const lineDy = opts.lineDy ?? -0.6;
    this.move(startX, y, 60);
    for (let l = 0; l < lines; l++) {
      this.hold(this.uniform(200, 250));
      const n = 4 + Math.floor(this.rand() * 4);
      for (let s = 0; s < n; s++) {
        this.move(this.x + dir * this.uniform(1.5, 2.5), y, 35);
        this.hold(this.uniform(200, 250));
      }
      if (l < lines - 1) {
        y += lineDy;
        this.move(startX + this.uniform(-0.5, 0.5), y, this.uniform(80, 150));
      }
    }
    return this;
  }
}

export interface TimedTransition extends FlagTransition {
  /** Frame time at which the engine emitted this transition. */
  emittedAt: number;
}

export function run(frames: Signal[], engine = new RuleEngine()): TimedTransition[] {
  const out: TimedTransition[] = [];
  for (const s of frames) for (const tr of engine.push(s)) out.push({ ...tr, emittedAt: s.t });
  return out;
}
