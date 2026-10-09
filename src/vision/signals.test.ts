import { describe, expect, it } from "vitest";
import type { FaceLandmarkerResult, Matrix, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { IRIS_GAIN, toSignal } from "./signals";

type Pt = [number, number];

/** A frontal synthetic face centred at cx with half-width w; iris shift (dx, dy) in eye-widths/heights. */
function face(cx = 0.5, w = 0.1, iris: Pt = [0, 0], noseDx = 0): NormalizedLandmark[] {
  const lm: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: cx, y: 0.5, z: 0, visibility: 0 }));
  const set = (i: number, [x, y]: Pt) => (lm[i] = { x, y, z: 0, visibility: 0 });
  set(1, [cx + noseDx, 0.5]);
  set(234, [cx - w, 0.5]);
  set(454, [cx + w, 0.5]);
  set(10, [cx, 0.35]);
  set(152, [cx, 0.65]);
  const eye = (outer: number, inner: number, up: number, lo: number, ir: number, x0: number, x1: number) => {
    set(outer, [x0, 0.45]);
    set(inner, [x1, 0.45]);
    set(up, [(x0 + x1) / 2, 0.44]);
    set(lo, [(x0 + x1) / 2, 0.46]);
    const ew = Math.abs(x1 - x0);
    set(ir, [(x0 + x1) / 2 + iris[0] * ew, 0.45 - iris[1] * 0.02]);
  };
  eye(33, 133, 159, 145, 468, cx - 0.8 * w, cx - 0.3 * w);
  eye(263, 362, 386, 374, 473, cx + 0.8 * w, cx + 0.3 * w);
  return lm;
}

/** Column-major 4x4: rotation about y (yawDeg) then x (pitchDeg), translated 50 cm in front of the camera. */
function matrix(yawDeg = 0, pitchDeg = 0, rowMajor = false): Matrix {
  const [a, b] = [(yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180];
  // Ry * Rx with Rx tilting +z toward +y for positive pitch.
  const ry = [
    [Math.cos(a), 0, Math.sin(a)],
    [0, 1, 0],
    [-Math.sin(a), 0, Math.cos(a)],
  ];
  const rx = [
    [1, 0, 0],
    [0, Math.cos(b), Math.sin(b)],
    [0, -Math.sin(b), Math.cos(b)],
  ];
  const r = ry.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * rx[k][j], 0)));
  const m = [
    [...r[0], 0],
    [...r[1], 0],
    [...r[2], -50],
    [0, 0, 0, 1],
  ];
  const data = rowMajor ? m.flat() : [0, 1, 2, 3].flatMap((c) => m.map((row) => row[c]));
  return { rows: 4, columns: 4, data };
}

const result = (faces: NormalizedLandmark[][], matrices: Matrix[] = faces.map(() => matrix())): FaceLandmarkerResult => ({
  faceLandmarks: faces,
  faceBlendshapes: [],
  facialTransformationMatrixes: matrices,
});

describe("toSignal", () => {
  it("returns nulls when no face", () => {
    const s = toSignal(result([]), 42);
    expect(s).toEqual({ t: 42, faceCount: 0, headYaw: null, headPitch: null, irisX: null, irisY: null, gazeX: null, gazeY: null });
  });

  it("centred iris and identity matrix give ~0", () => {
    const s = toSignal(result([face()]), 0);
    for (const v of [s.headYaw, s.headPitch, s.irisX, s.irisY, s.gazeX, s.gazeY]) expect(v).toBeCloseTo(0, 6);
  });

  it("iris toward image right (133 side of left eye) is positive X", () => {
    const s = toSignal(result([face(0.5, 0.1, [0.25, 0])]), 0);
    expect(s.irisX).toBeCloseTo(0.5, 6);
    expect(s.gazeX).toBeCloseTo(0.5 * IRIS_GAIN, 6);
  });

  it("iris up is positive Y", () => {
    const s = toSignal(result([face(0.5, 0.1, [0, 0.25])]), 0);
    expect(s.irisY).toBeCloseTo(0.5, 6);
    expect(s.gazeY!).toBeGreaterThan(0);
  });

  it("counts two faces and measures the wider one", () => {
    const small = face(0.2, 0.05, [-0.25, 0]);
    const big = face(0.7, 0.15, [0.25, 0]);
    const s = toSignal(result([small, big], [matrix(-30), matrix(20)]), 0);
    expect(s.faceCount).toBe(2);
    expect(s.irisX).toBeGreaterThan(0);
    expect(s.headYaw).toBeCloseTo(20, 6);
  });

  it("matrix yaw/pitch signs: head toward image right and up are positive", () => {
    const s = toSignal(result([face()], [matrix(20, 10)]), 0);
    expect(s.headYaw).toBeCloseTo(20, 6);
    expect(s.headPitch!).toBeGreaterThan(0);
  });

  it("row-major matrix is detected", () => {
    const s = toSignal(result([face()], [matrix(20, 0, true)]), 0);
    expect(s.headYaw).toBeCloseTo(20, 6);
  });

  it("landmark fallback agrees in sign with matrix yaw", () => {
    const s = toSignal(result([face(0.5, 0.1, [0, 0], 0.03)], []), 0);
    expect(s.headYaw!).toBeGreaterThan(0);
  });
});
