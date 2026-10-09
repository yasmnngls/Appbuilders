/** Mic constraints: echo cancellation on so the Interviewer's mic doesn't re-transcribe the speakers. */
const micAudio = (deviceId?: string): MediaTrackConstraints => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
});

/**
 * Opens the local webcam with microphone audio (in-person: one shared mic, transcribed as speaker "mixed").
 * If the mic is denied or missing, falls back to video only so the app still works.
 */
export async function openWebcam(micId?: string): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
    facingMode: "user",
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: micAudio(micId), video });
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio: false, video });
  }
}

/** The Interviewer's own microphone (audio only). Null when denied or missing: the Session still runs. */
export async function openMic(deviceId?: string): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: micAudio(deviceId), video: false });
  } catch {
    if (!deviceId) return null;
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: micAudio(), video: false });
    } catch {
      return null;
    }
  }
}

/** Audio inputs on this laptop. Labels are empty until mic permission is granted. */
export async function listMics(): Promise<{ id: string; label: string }[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput" && d.deviceId)
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

/** Device id of the mic a stream is using, if any. */
export const micIdOf = (stream: MediaStream | null): string | null => stream?.getAudioTracks()[0]?.getSettings().deviceId ?? null;

/**
 * Asks the Interviewer to share the meeting (Meet/Zoom/Teams) as a browser tab, window or screen.
 * Audio is requested; Chrome only provides it for a tab ("Share tab audio") or the entire screen
 * ("Share system audio", Windows), never for a single application window. No surface is preferred,
 * so the picker doesn't steer towards a window (the one choice without audio).
 */
export function openWindowCapture(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: { frameRate: { ideal: 30 } },
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
  } as DisplayMediaStreamOptions);
}

/** What the Interviewer actually shared: "browser" (tab), "window", "monitor" (screen), or null when unknown. */
export function displaySurfaceOf(stream: MediaStream | null): "browser" | "window" | "monitor" | null {
  const s = stream?.getVideoTracks()[0]?.getSettings() as (MediaTrackSettings & { displaySurface?: string }) | undefined;
  const v = s?.displaySurface;
  return v === "browser" || v === "window" || v === "monitor" ? v : null;
}

export const WINDOW_NO_AUDIO =
  "This window has no audio. Share the meeting's browser tab, or the entire screen with 'Share system audio' on, to transcribe the Candidate.";
export const SHARE_NO_AUDIO = {
  browser: "No tab audio was shared. Share the tab again with 'Share tab audio' on to transcribe the Candidate.",
  monitor: "No system audio was shared. Share the screen again with 'Share system audio' on to transcribe the Candidate.",
  unknown: "No audio was shared. Share the meeting's browser tab (with 'Share tab audio'), or the entire screen with 'Share system audio' on, to transcribe the Candidate.",
} as const;

/** Honest message when a shared surface came back without audio; null when it has audio. */
export function shareAudioNotice(stream: MediaStream): string | null {
  if (hasAudio(stream)) return null;
  const surface = displaySurfaceOf(stream);
  if (surface === "window") return WINDOW_NO_AUDIO;
  return surface ? SHARE_NO_AUDIO[surface] : SHARE_NO_AUDIO.unknown;
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
