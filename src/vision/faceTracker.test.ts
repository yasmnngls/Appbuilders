import { describe, expect, it } from "vitest";
import { isMediaPipeTelemetry } from "./faceTracker";

describe("isMediaPipeTelemetry", () => {
  it("matches only the MediaPipe usage-logging host", () => {
    expect(isMediaPipeTelemetry("https://odml.pa.googleapis.com/v1/log")).toBe(true);
    expect(isMediaPipeTelemetry(new URL("https://odml.pa.googleapis.com/v1/log"))).toBe(true);
    expect(isMediaPipeTelemetry("/ollama/api/chat")).toBe(false);
    expect(isMediaPipeTelemetry("/models/face_landmarker.task")).toBe(false);
    expect(isMediaPipeTelemetry("http://127.0.0.1:11434/api/tags")).toBe(false);
  });
});
