import { useEffect, useRef, useState } from "react";
import { closeSource, openSource, startBaseline, video } from "../app/controller";
import type { Session } from "../domain/types";
import { useStore } from "../store/session";
import { VideoPanel } from "./VideoPanel";

type Kind = Session["source"];

const SOURCES: { kind: Kind; title: string; body: string; tag?: string }[] = [
  {
    kind: "window",
    title: "Online Interview / Assessment Window",
    body: "Share the Meet, Zoom or Teams window. The Candidate installs nothing.",
  },
  { kind: "webcam", title: "Local Webcam", body: "For in-person interviews. Works with no internet at all." },
  { kind: "video", title: "Local Video", body: "Replay a recorded interview file from this laptop.", tag: "Preview" },
];

/** Neutral wording for capture errors; the Interviewer stays on this screen. */
function describeError(e: unknown, kind: Kind): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "AbortError")
    return kind === "window"
      ? "No window was shared. Choose the source again when you're ready."
      : "Camera access was not granted. Allow it in the browser's site settings, then try again.";
  if (name === "NotFoundError") return "No camera was found on this laptop.";
  if (name === "NotReadableError") return "The camera is in use by another app. Close it, then try again.";
  return e instanceof Error ? e.message : "The source could not be opened. Try again.";
}

/** Screen 2 (FR-002): choose the Source, preview it, then Start Baseline. */
export function SourceScreen() {
  const sourceReady = useStore((s) => s.sourceReady);
  const visionReady = useStore((s) => s.vision.status === "ready");
  const visionError = useStore((s) => (s.vision.status === "error" ? s.vision.message : null));
  const name = useStore((s) => s.draft?.candidateName ?? "Candidate");
  const [opening, setOpening] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setPlaying(!video.paused && video.readyState >= 2);
    sync();
    const events = ["playing", "pause", "emptied", "loadeddata", "ended"] as const;
    events.forEach((ev) => video.addEventListener(ev, sync));
    return () => events.forEach((ev) => video.removeEventListener(ev, sync));
  }, []);

  const open = async (kind: Kind, f?: File) => {
    setError(null);
    setOpening(kind);
    try {
      await openSource(kind, f);
    } catch (e) {
      setError(describeError(e, kind));
    } finally {
      setOpening(null);
    }
  };

  const choose = (kind: Kind) => (kind === "video" ? file.current?.click() : void open(kind));

  const startLabel = !visionReady ? (visionError ? "Vision model unavailable" : "Loading vision model…") : !playing ? "Waiting for the preview…" : "Start Baseline";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Where is {name}?</h1>
        <p className="mt-1 text-zinc-400">Choose where the Candidate's face comes from. The video stays on this laptop.</p>
      </div>

      <input
        ref={file}
        type="file"
        accept="video/*"
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void open("video", f);
        }}
      />

      {!sourceReady ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {SOURCES.map((s) => (
            <button
              key={s.kind}
              type="button"
              disabled={opening !== null}
              onClick={() => choose(s.kind)}
              className="press flex flex-col rounded-xl border border-zinc-800 p-4 text-left hover:border-zinc-600 disabled:opacity-60"
            >
              <span className="flex items-center gap-2 font-medium">
                {s.title}
                {s.tag && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">{s.tag}</span>}
              </span>
              <span className="mt-1 text-sm text-zinc-400">{opening === s.kind ? "Opening…" : s.body}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="card-enter flex flex-col gap-4">
          <VideoPanel maxHeight="55vh" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {sourceReady.hasAudio ? (
              <span className="flex items-center gap-1.5 text-emerald-300">
                <span aria-hidden className="size-1.5 rounded-full bg-emerald-400" />
                Speech context available
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-zinc-400">
                <span aria-hidden className="size-1.5 rounded-full bg-zinc-500" />
                No audio from this Source — stricter visual-only thresholds will be used
              </span>
            )}
            {sourceReady.kind === "window" && <span className="text-zinc-500">Tip: select the Candidate's tile for steadier tracking.</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!visionReady || !playing}
              onClick={startBaseline}
              className="press rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {startLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                closeSource();
              }}
              className="press rounded-lg border border-zinc-700 px-4 py-2.5 text-sm hover:border-zinc-500"
            >
              Change Source
            </button>
          </div>
          <p className="text-sm text-zinc-500">
            Start Baseline begins the Session with Q1 "Introduction". Small talk is ideal while the Baseline is learned (about 15 s).
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="card-enter rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
          {error}
        </div>
      )}
    </div>
  );
}
