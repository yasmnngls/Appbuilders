/**
 * Opens the local webcam with microphone audio (for local speech-activity context only).
 * If the mic is denied or missing, falls back to video only so the app still works.
 */
export async function openWebcam(): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
    facingMode: "user",
  };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video,
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio: false, video });
  }
}

/**
 * Asks the Interviewer to pick a meeting window/tab (Meet/Zoom) to capture.
 * Requests audio too (Chrome offers tab/system audio); if the Interviewer doesn't
 * share audio the stream simply has no audio track.
 */
export function openWindowCapture(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: { displaySurface: "window", frameRate: { ideal: 30 } } as MediaTrackConstraints,
  });
}

/** Stops every track (video and audio) of the stream. */
export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** True when the stream carries at least one live audio track (speech-activity context is possible). */
export function hasAudio(stream: MediaStream | null): boolean {
  return !!stream && stream.getAudioTracks().some((t) => t.readyState === "live");
}

/** One audio graph per <video>: createMediaElementSource may only be called once for an element. */
const elementAudio = new WeakMap<HTMLVideoElement, { ctx: AudioContext; source: MediaElementAudioSourceNode }>();

/**
 * Local Video Source (FR-002, P1). Plays a file in the shared <video>; returns its stream for audio.
 *
 * The file is played from an object URL: nothing is copied or uploaded. `loop` is off; the caller ends the
 * Session on the element's `ended` event and calls `revoke()` in finish().
 *
 * Audio is tapped with createMediaElementSource into a MediaStreamDestination and never connected to the
 * speakers, so there is no playback (and it does not depend on how Chrome treats captureStream() on a muted
 * element). `stream` is null when the file has no audio or audio could not be tapped; the Session then runs
 * with speech context unavailable.
 */
export async function openLocalVideo(video: HTMLVideoElement, file: File): Promise<{ stream: MediaStream | null; revoke: () => void }> {
  const url = URL.createObjectURL(file);
  video.srcObject = null;
  video.loop = false;
  video.src = url;

  let stream: MediaStream | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let tapped = elementAudio.get(video) ?? null;
  try {
    if (!tapped) {
      const ctx = new AudioContext();
      tapped = { ctx, source: ctx.createMediaElementSource(video) };
      elementAudio.set(video, tapped);
    }
    dest = tapped.ctx.createMediaStreamDestination();
    tapped.source.connect(dest);
    void tapped.ctx.resume().catch(() => {});
    video.muted = false; // the element's output goes only into the graph above, never to the speakers
  } catch {
    video.muted = true;
    tapped = null;
  }

  await new Promise<void>((resolve, reject) => {
    if (video.readyState >= 2) return resolve();
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("This video file could not be played."));
    };
    const cleanup = () => {
      video.removeEventListener("loadeddata", ok);
      video.removeEventListener("error", fail);
    };
    video.addEventListener("loadeddata", ok);
    video.addEventListener("error", fail);
  }).catch((err) => {
    URL.revokeObjectURL(url);
    throw err;
  });

  try {
    await video.play();
  } catch {
    // Autoplay with sound refused: play muted, without speech context.
    video.muted = true;
    await video.play();
    if (dest && tapped) tapped.source.disconnect(dest);
    dest = null;
  }

  if (dest && (await fileHasAudio(video))) stream = dest.stream;
  else if (dest && tapped) {
    tapped.source.disconnect(dest);
    dest = null;
  }

  let revoked = false;
  return {
    stream,
    revoke: () => {
      if (revoked) return;
      revoked = true;
      if (dest && tapped) {
        try {
          tapped.source.disconnect(dest);
        } catch {
          /* already disconnected */
        }
      }
      stream?.getTracks().forEach((t) => t.stop());
      URL.revokeObjectURL(url);
    },
  };
}

/** Chrome exposes decoded audio bytes; give playback a moment, then check. Unknown → assume audio. */
async function fileHasAudio(video: HTMLVideoElement): Promise<boolean> {
  const v = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean };
  if (typeof v.mozHasAudio === "boolean") return v.mozHasAudio;
  if (typeof v.webkitAudioDecodedByteCount !== "number") return true;
  await new Promise((r) => setTimeout(r, 400));
  return (v.webkitAudioDecodedByteCount ?? 0) > 0;
}
