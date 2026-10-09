import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/face_landmarker.task";

/** Loads FaceLandmarker from vendored assets (never a CDN). Tries GPU, falls back to CPU. */
export async function createFaceLandmarker(): Promise<{ landmarker: FaceLandmarker; delegate: "GPU" | "CPU" }> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const make = (delegate: "GPU" | "CPU") =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: "VIDEO",
      numFaces: 2,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    });
  try {
    return { landmarker: await make("GPU"), delegate: "GPU" };
  } catch (err) {
    console.warn("FaceLandmarker GPU delegate failed, falling back to CPU", err);
    return { landmarker: await make("CPU"), delegate: "CPU" };
  }
}
