import { useEffect, useRef, useState } from "react";
import { finish } from "../app/controller";
import { FLAG_LABELS, type Flag, type Question } from "../domain/types";
import { formatTime } from "../llm/notes";
import { nextQuestion, sessionNow, useStore } from "../store/session";
import { VideoPanel } from "./VideoPanel";

export function LiveScreen() {
  return (
    <div className="grid h-full min-h-0 gap-5 p-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
      <section className="flex min-h-0 flex-col gap-4">
        <VideoPanel />
        <SignalReadout />
      </section>
      <aside className="flex min-h-0 flex-col gap-4">
        <QuestionBar />
        <FlagList />
        <NotesPanel />
        <button
          type="button"
          onClick={() => void finish()}
          className="press rounded-lg bg-zinc-100 px-4 py-2.5 font-medium text-zinc-950 hover:bg-white"
        >
          End session & write report
        </button>
      </aside>
    </div>
  );
}

/** Re-renders once a second so running clocks and ongoing durations tick. */
function useTick() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

function QuestionBar() {
  useTick();
  const question = useStore((s) => s.session!.questions.at(-1)!);
  const [label, setLabel] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const next = () => {
    nextQuestion(label);
    setLabel("");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.activeElement instanceof HTMLInputElement) return;
      e.preventDefault();
      nextQuestion();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-400">Now asking</span>
        <span className="font-mono tabular-nums text-zinc-400">{formatTime(sessionNow())}</span>
      </div>
      <div className="mt-1 text-lg font-medium">
        Q{question.number} · {question.label}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          ref={input}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              next();
              input.current?.blur();
            }
          }}
          placeholder="Next question label (optional)"
          className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
        />
        <button
          type="button"
          onClick={next}
          className="press rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
        >
          Next question <kbd className="ml-1 rounded bg-emerald-700/40 px-1 text-xs">N</kbd>
        </button>
      </div>
    </div>
  );
}

const duration = (f: Flag) => (f.end === null ? sessionNow() : f.end) - f.start;

function FlagList() {
  useTick();
  const flags = useStore((s) => s.session!.flags);
  const questions = useStore((s) => s.session!.questions);
  const byId = new Map<string, Question>(questions.map((q) => [q.id, q]));

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="border-b border-zinc-800 px-4 py-3 text-sm font-medium">Flags · {flags.length}</div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {flags.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">No observations yet.</li>}
        {[...flags].reverse().map((f) => {
          const q = f.questionId ? byId.get(f.questionId) : undefined;
          return (
            <li key={f.id} className="enter flex items-start gap-3 border-b border-zinc-800/60 px-4 py-2.5 last:border-0">
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${f.end === null ? "animate-pulse bg-amber-400" : "bg-zinc-500"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{FLAG_LABELS[f.kind]}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-400">
                    {formatTime(f.start)}
                    {f.end !== null && `–${formatTime(f.end)}`} · {Math.round(duration(f) / 1000)}s
                  </span>
                </div>
                <div className="text-xs text-zinc-400">
                  {q && `Q${q.number}`}
                  {f.detail && ` · ${f.detail}`}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function NotesPanel() {
  const notes = useStore((s) => s.session!.notes);
  const llm = useStore((s) => s.llm);

  return (
    <div className="flex max-h-[38%] min-h-0 flex-col rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 text-sm">
        <span className="font-medium">Interviewer Notes</span>
        <span className="text-xs text-zinc-500">local LLM · every 30s</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {llm === "unavailable" && (
          <div className="px-4 py-3 text-sm text-amber-300">
            Local LLM unavailable. Flags still work. Start Ollama to get notes.
          </div>
        )}
        {notes.length === 0 && llm !== "unavailable" && (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">Notes appear when there is something to say.</div>
        )}
        {[...notes].reverse().map((n) => (
          <div key={n.id} className="enter enter-blur border-b border-zinc-800/60 px-4 py-3 text-sm last:border-0">
            <div className="font-mono text-xs text-zinc-500">{formatTime(n.t)}</div>
            <p className="mt-1 leading-relaxed">{n.text}</p>
            {n.followUp && <p className="mt-1.5 text-emerald-300">Ask: {n.followUp}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalReadout() {
  const s = useStore((st) => st.latestSignal);
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}°`);
  const items: [string, string][] = [
    ["Faces", String(s?.faceCount ?? "—")],
    ["Head yaw", fmt(s?.headYaw)],
    ["Head pitch", fmt(s?.headPitch)],
    ["Gaze X", fmt(s?.gazeX)],
    ["Gaze Y", fmt(s?.gazeY)],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-5">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg bg-zinc-900 px-3 py-2">
          <div className="text-xs text-zinc-500">{k}</div>
          <div className="font-mono tabular-nums">{v}</div>
        </div>
      ))}
    </div>
  );
}
