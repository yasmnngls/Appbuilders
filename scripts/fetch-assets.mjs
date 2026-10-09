// Vendors MediaPipe's WASM runtime and the face landmarker model into public/
// so the app runs with no network access (judges and the offline demo).
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

cpSync("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", { recursive: true });
console.log("copied wasm -> public/mediapipe/wasm");

mkdirSync("public/models", { recursive: true });
const modelPath = "public/models/face_landmarker.task";
if (existsSync(modelPath)) {
  console.log("model already present");
} else {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log("downloaded model -> " + modelPath);
}
