import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import type { Signal } from "../domain/types";
import { VISION } from "../rules/config";
import { toSignal } from "./signals";

/** Region of the video frame to analyse, normalized 0..1. */
export interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface VisionPipelineOptions {
  video: HTMLVideoElement;
  landmarker: FaceLandmarker;
  getSessionTime: () => number;
  /**
   * Called once per analysed frame. When `crop` is non-null, landmarks in `result` are normalized to the
   * crop region, not the full frame: full-frame x = crop.left + x * (crop.right - crop.left), same for y.
   */
  onFrame: (signal: Signal, result: FaceLandmarkerResult, crop: CropRect | null) => void;
  /** Sampling cap (§14A.2); defaults to VISION.maxFps. Lightweight mode passes VISION.lightweightMaxFps. */
  maxFps?: number;
}

/** Frames offered by the video vs frames actually analysed (benchmark / diagnostics). */
export interface FrameStats {
  offered: number;
  analysed: number;
  /** Skipped by the sampling cap. */
  skipped: number;
  /** Detection threw for the frame. */
  failed: number;
}

/** Frames arrive with jitter; allow this fraction of the interval so a 30 fps source isn't halved at a 30 fps cap. */
const CAP_TOLERANCE = 0.9;

/** Runs FaceLandmarker on new video frames (at most maxFps per second) and emits Signals. */
export class VisionPipeline {
  private readonly opts: VisionPipelineOptions;
  private crop: CropRect | null = null;
  private running = false;
  private handle: number | null = null;
  private lastTs = 0;
  private frameTimes: number[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private maxFps: number;
  private lastAnalysedAt = -Infinity;
  private counts: FrameStats = { offered: 0, analysed: 0, skipped: 0, failed: 0 };

  constructor(opts: VisionPipelineOptions) {
    this.opts = opts;
    this.maxFps = opts.maxFps ?? VISION.maxFps;
  }

  /** Change the sampling cap (e.g. lightweight mode). Non-positive or non-finite values mean VISION.maxFps. */
  setMaxFps(n: number): void {
    this.maxFps = Number.isFinite(n) && n > 0 ? n : VISION.maxFps;
  }

  get currentMaxFps(): number {
    return this.maxFps;
  }

  /** Cumulative frame counters since start (or the last resetStats). */
  get stats(): FrameStats {
    return { ...this.counts };
  }

  resetStats(): void {
    this.counts = { offered: 0, analysed: 0, skipped: 0, failed: 0 };
  }

  setCrop(crop: CropRect | null): void {
    this.crop = crop;
  }

  /** Analysed frames per second over the last ~1s. */
  get fps(): number {
    const now = performance.now();
    this.frameTimes = this.frameTimes.filter((t) => now - t <= 1000);
    return this.frameTimes.length;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.handle === null) return;
    const v = this.opts.video;
    if ("cancelVideoFrameCallback" in v) v.cancelVideoFrameCallback(this.handle);
    else cancelAnimationFrame(this.handle);
    this.handle = null;
  }

  private schedule(): void {
    if (!this.running) return;
    const v = this.opts.video;
    const tick = () => {
      this.handle = null;
      this.process();
      this.schedule();
    };
    this.handle = "requestVideoFrameCallback" in v ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  }

  private process(): void {
    const { video, landmarker, getSessionTime, onFrame } = this.opts;
    if (video.readyState < 2 || !video.videoWidth) return;
    this.counts.offered++;
    const now = performance.now();
    if (now - this.lastAnalysedAt < (1000 / this.maxFps) * CAP_TOLERANCE) {
      this.counts.skipped++;
      return;
    }
    this.lastAnalysedAt = now;
    let ts = now;
    if (ts <= this.lastTs) ts = this.lastTs + 0.001;
    this.lastTs = ts;
    const crop = this.crop;
    try {
      const result = landmarker.detectForVideo(crop ? this.drawCrop(crop) : video, ts);
      this.counts.analysed++;
      this.frameTimes.push(ts);
      if (this.frameTimes.length > 120) this.frameTimes.splice(0, this.frameTimes.length - 120);
      onFrame(toSignal(result, getSessionTime()), result, crop);
    } catch (err) {
      this.counts.failed++;
      console.warn("Face detection failed for a frame", err);
    }
  }

  /** Copies the crop region of the video at native resolution into a reusable canvas. */
  private drawCrop(crop: CropRect): HTMLCanvasElement {
    const { video } = this.opts;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = Math.round(Math.min(Math.max(crop.left, 0), 1) * vw);
    const sy = Math.round(Math.min(Math.max(crop.top, 0), 1) * vh);
    const sw = Math.max(1, Math.round(Math.min(Math.max(crop.right, 0), 1) * vw) - sx);
    const sh = Math.max(1, Math.round(Math.min(Math.max(crop.bottom, 0), 1) * vh) - sy);
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d", { alpha: false });
    }
    if (this.canvas.width !== sw) this.canvas.width = sw;
    if (this.canvas.height !== sh) this.canvas.height = sh;
    this.ctx!.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    return this.canvas;
  }
}
