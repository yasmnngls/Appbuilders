/** Opens the local webcam (video only). */
export function openWebcam(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: "user" },
  });
}

/** Asks the Interviewer to pick a meeting window (Meet/Zoom) to capture. Video only. */
export function openWindowCapture(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: { displaySurface: "window", frameRate: { ideal: 30 } } as MediaTrackConstraints,
  });
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}
