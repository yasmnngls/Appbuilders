import { useEffect, useRef, useState } from "react";
import { closeSource, currentMicId, openSource, setMic, startBaseline, video } from "../app/controller";
import { listMics } from "../capture/source";
import type { Session } from "../domain/types";
import { useStore } from "../store/session";
import { VideoPanel } from "./VideoPanel";

type Kind = Session["source"];

const SOURCES: { kind: Kind; title: string; body: string; tag?: string }[] = [
  {
    kind: "window",
    title: "Online Interview (Meet / Zoom / Teams)",
    body: "Share the meeting's browser tab with tab audio, or the entire screen with system audio. The Candidate installs nothing.",
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
  const asr = useStore((s) => s.asrStatus);
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
            <Chip on={!!sourceReady.mic}>Mic</Chip>
            <Chip on={!!sourceReady.interviewAudio || (sourceReady.kind === "webcam" && sourceReady.hasAudio)}>Interview audio</Chip>
            <Chip on={playing}>Video</Chip>
            <Chip on={!!asr?.available} title={asr?.model ?? undefined}>
              Speech recognition (local) {asr === null ? "checking…" : asr.available ? "available" : "unavailable"}
            </Chip>
          </div>
          <AudioSetup kind={sourceReady.kind} mic={!!sourceReady.mic} interviewAudio={!!sourceReady.interviewAudio} />
          {sourceReady.notice && (
            <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {sourceReady.notice}
            </div>
          )}
          {!sourceReady.hasAudio && <p className="text-sm text-zinc-500">No Candidate audio — stricter visual-only thresholds will be used.</p>}
          {asr && !asr.available && (
            <p className="text-sm text-zinc-500">
              Local speech recognition is off — follow-ups need a transcript. Start it with <code className="text-zinc-300">npm run whisper</code>.
            </p>
          )}
          {sourceReady.kind === "window" && <p className="text-sm text-zinc-500">Tip: select the Candidate's tile for steadier tracking.</p>}
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
            Start Baseline begins the Session. Questions are picked up from what the Interviewer asks; nothing needs typing. Small talk is ideal while the Baseline is learned (about 15 s).
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

function Chip({ on, title, children }: { on: boolean; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={`flex items-center gap-1.5 ${on ? "text-emerald-300" : "text-zinc-400"}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-zinc-500"}`} />
      {children}
    </span>
  );
}

/** Who is heard from where. Speakers are separated by audio source, never by voice. */
function AudioSetup({ kind, mic, interviewAudio }: { kind: Kind; mic: boolean; interviewAudio: boolean }) {
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      void listMics().then((m) => {
        if (!alive) return;
        setMics(m);
        setSelected(currentMicId() ?? m[0]?.id ?? "");
      });
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, [kind, mic]);

  const candidate =
    kind === "webcam"
      ? "In person: the same mic hears both of you, so lines are marked “Speaker”, not split by person."
      : kind === "window"
        ? interviewAudio
          ? "From the shared meeting audio."
          : "Not available: the shared surface has no audio."
        : interviewAudio
          ? "From the video file's audio."
          : "Not available: the file has no audio.";

  return (
    <div className="grid gap-3 rounded-xl border border-zinc-800 p-4 text-sm sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mic-select" className="font-medium">
          {kind === "webcam" ? "Microphone (Interviewer + Candidate)" : "Microphone (Interviewer)"}
        </label>
        <select
          id="mic-select"
          value={selected}
          disabled={mics.length === 0}
          onChange={(e) => {
            setSelected(e.target.value);
            void setMic(e.target.value);
          }}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 outline-none focus:border-emerald-500 disabled:opacity-50"
        >
          {mics.length === 0 && <option value="">No microphone found</option>}
          {mics.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {!mic && <span className="text-zinc-400">Mic not available — allow it in the browser's site settings.</span>}
        {kind !== "webcam" && <span className="text-zinc-500">Use headphones so your mic doesn't pick up the Candidate.</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-medium">Interview audio (Candidate)</span>
        <span className={interviewAudio || kind === "webcam" ? "text-zinc-300" : "text-zinc-400"}>{candidate}</span>
      </div>
    </div>
  );
}
