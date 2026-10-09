import type { FaceLandmarkerResult, Matrix, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Signal } from "../domain/types";

/**
 * Sign convention for every angle/offset in a Signal:
 *   positive X (headYaw, irisX, gazeX) = toward IMAGE right (the Candidate's own left in an unmirrored frame);
 *   positive Y (headPitch, irisY, gazeY) = up.
 * MediaPipe's transformation matrix maps the canonical face (nose along +z) into an OpenGL-style camera
 * space (x right, y up, camera looking down -z), so the face's forward vector R*(0,0,1) already has
 * +x = image right and +y = up. Flip these if a live test shows head and iris disagree.
 */
export const HEAD_YAW_SIGN = 1;
export const HEAD_PITCH_SIGN = 1;

/** Degrees of gaze per unit of iris offset. */
export const IRIS_GAIN = 25;

const DEG = 180 / Math.PI;

/** Landmark indices (MediaPipe 478-point mesh with iris refinement). */
const LM = {
  noseTip: 1,
  cheekL: 234,
  cheekR: 454,
  forehead: 10,
  chin: 152,
  // Eye on the image left (Candidate's right): corners, lids, iris centre.
  eyeA: { outer: 33, inner: 133, upper: 159, lower: 145, iris: 468 },
  // Eye on the image right (Candidate's left).
  eyeB: { outer: 263, inner: 362, upper: 386, lower: 374, iris: 473 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const xExtent = (pts: NormalizedLandmark[]) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    if (p.x < lo) lo = p.x;
    if (p.x > hi) hi = p.x;
  }
  return hi - lo;
};

/** Head yaw/pitch from the 4x4 facial transformation matrix (column-major; row-major auto-detected). */
export function headFromMatrix(m: Matrix): { yaw: number; pitch: number } {
  const d = m.data;
  // Column-major has translation at 12..14 (z is tens of cm, far from 0); row-major puts it at 3/7/11.
  const rowMajor = Math.abs(d[11]) > Math.abs(d[14]);
  const [fx, fy, fz] = rowMajor ? [d[2], d[6], d[10]] : [d[8], d[9], d[10]];
  return {
    yaw: HEAD_YAW_SIGN * Math.atan2(fx, fz) * DEG,
    pitch: HEAD_PITCH_SIGN * Math.atan2(fy, fz) * DEG,
  };
}

/** Rough head yaw/pitch from landmarks only, used when no matrix is available. */
export function headFromLandmarks(lm: NormalizedLandmark[]): { yaw: number; pitch: number } {
  const nose = lm[LM.noseTip];
  const w = lm[LM.cheekR].x - lm[LM.cheekL].x || 1e-6;
  const h = lm[LM.chin].y - lm[LM.forehead].y || 1e-6;
  const dx = (nose.x - (lm[LM.cheekL].x + lm[LM.cheekR].x) / 2) / Math.abs(w);
  const dy = (nose.y - (lm[LM.forehead].y + lm[LM.chin].y) / 2) / Math.abs(h);
  return {
    yaw: Math.asin(clamp(2 * dx, -1, 1)) * DEG,
    pitch: -Math.asin(clamp(2 * dy, -1, 1)) * DEG,
  };
}

/** Iris offset inside the eyes, averaged over both eyes; roughly -1..1, +x = image right, +y = up. */
export function irisOffset(lm: NormalizedLandmark[]): { x: number; y: number } {
  const eye = (e: typeof LM.eyeA) => {
    const iris = lm[e.iris];
    const left = Math.min(lm[e.outer].x, lm[e.inner].x);
    const right = Math.max(lm[e.outer].x, lm[e.inner].x);
    const top = lm[e.upper].y;
    const bottom = lm[e.lower].y;
    const rx = (iris.x - left) / (right - left || 1e-6);
    const ry = (iris.y - top) / (bottom - top || 1e-6);
    return { x: 2 * rx - 1, y: 1 - 2 * ry };
  };
  const a = eye(LM.eyeA);
  const b = eye(LM.eyeB);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Turns one FaceLandmarker result into a Signal, measuring the largest face. */
export function toSignal(result: FaceLandmarkerResult, t: number): Signal {
  const faces = result.faceLandmarks;
  const faceCount = faces.length;
  if (faceCount === 0) {
    return { t, faceCount, headYaw: null, headPitch: null, irisX: null, irisY: null, gazeX: null, gazeY: null };
  }
  let best = 0;
  for (let i = 1; i < faces.length; i++) if (xExtent(faces[i]) > xExtent(faces[best])) best = i;
  const lm = faces[best];
  const matrix = result.facialTransformationMatrixes?.[best];
  const head = matrix && matrix.data?.length === 16 ? headFromMatrix(matrix) : headFromLandmarks(lm);
  const iris = irisOffset(lm);
  return {
    t,
    faceCount,
    headYaw: head.yaw,
    headPitch: head.pitch,
    irisX: iris.x,
    irisY: iris.y,
    gazeX: head.yaw + iris.x * IRIS_GAIN,
    gazeY: head.pitch + iris.y * IRIS_GAIN,
  };
}
