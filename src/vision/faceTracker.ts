import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/face_landmarker.task";

/**
 * @mediapipe/tasks-vision 1.1.0 has a built-in usage logger that POSTs task metrics (task type, running mode,
 * OS, library version, inference latency counts) to this host with `fetch` every 60 s. No frames or landmarks,
 * but it is a non-localhost request and the app promises none, so it is refused here before any task is made.
 */
export const MEDIAPIPE_TELEMETRY_HOST = "odml.pa.googleapis.com";

let telemetryBlocked = false;

/** True for a request to the MediaPipe usage-logging host. */
export function isMediaPipeTelemetry(input: RequestInfo | URL, base = "http://localhost/"): boolean {
  try {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(href, base).hostname === MEDIAPIPE_TELEMETRY_HOST;
  } catch {
    return false;
  }
}

/** Wraps fetch once so MediaPipe's usage logger fails like an offline request (it then stops retrying). */
function blockMediaPipeTelemetry(): void {
  if (telemetryBlocked || typeof globalThis.fetch !== "function") return;
  telemetryBlocked = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    isMediaPipeTelemetry(input, globalThis.location?.href)
      ? Promise.reject(new TypeError("Blocked: MediaPipe usage logging (Gazewise sends nothing off this laptop)"))
      : realFetch(input, init);
}

/** Loads FaceLandmarker from vendored assets (never a CDN). Tries GPU, falls back to CPU. */
export async function createFaceLandmarker(): Promise<{ landmarker: FaceLandmarker; delegate: "GPU" | "CPU" }> {
  blockMediaPipeTelemetry();
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
