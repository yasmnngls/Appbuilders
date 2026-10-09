import { useState } from "react";
import { begin } from "../app/controller";
import type { Session } from "../domain/types";
import { useStore } from "../store/session";

const CONSENT_SCRIPT =
  "Before we start: this interview uses on-device gaze analysis on my laptop. It notes where your eyes and face are " +
  "pointed, such as looking away or reading, so I can ask better follow-up questions. Nothing is recorded, no video " +
  "or images are saved or sent anywhere, and these are observations, not judgements. Is that okay with you?";

export function SetupScreen() {
  const [name, setName] = useState("");
  const [source, setSource] = useState<Session["source"]>("window");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const visionReady = useStore((s) => s.vision.status === "ready");

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      await begin({ candidateName: name.trim() || "Candidate", source });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };

  const SourceCard = ({ value, title, body }: { value: Session["source"]; title: string; body: string }) => (
    <button
      type="button"
      onClick={() => setSource(value)}
      className={`press rounded-xl border p-4 text-left ${
        source === value ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-800 hover:border-zinc-600"
      }`}
    >
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-sm text-zinc-400">{body}</div>
    </button>
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Start an interview session</h1>
        <p className="mt-1 text-zinc-400">
          Face tracking and the language model run on this laptop. Nothing is recorded.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-zinc-400">Candidate name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Juan dela Cruz"
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 outline-none focus:border-emerald-500"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-zinc-400">Watch the candidate through</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <SourceCard value="window" title="Meeting window" body="Capture the Meet or Zoom window. The candidate installs nothing." />
          <SourceCard value="webcam" title="This laptop's webcam" body="Works with no internet at all." />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm font-medium text-zinc-300">Read this to the candidate</div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">“{CONSENT_SCRIPT}”</p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="size-4 accent-emerald-500" />
          The candidate has been informed and agreed
        </label>
      </div>

      {error && <div className="enter rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}

      <button
        type="button"
        disabled={!consent || !visionReady || starting}
        onClick={start}
        className="press rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!visionReady ? "Loading vision model…" : starting ? "Starting…" : "Start session"}
      </button>
    </div>
  );
}
