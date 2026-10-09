import { useEffect, useState } from "react";
import { finish, newQuestion, resetBaseline } from "../app/controller";
import { FLAG_LABELS, type Flag, type Moment, type Question, type Speaker } from "../domain/types";
import { formatTime } from "../llm/notes";
import { currentQuestion, selectScreen, sessionNow, setOpenFlag, store, useStore } from "../store/session";
import { FlagDetails } from "./FlagDetails";
import { FollowUpCard } from "./FollowUpCard";
import { VideoPanel } from "./VideoPanel";

/** Screens 3 and 4 (FR-004, FR-007, FR-008). The Baseline overlay lives in the video panel. */
export function LiveScreen() {
  useNewQuestionHotkey();
  const learning = useStore((s) => selectScreen(s) === "baseline");

  return (
    <div className="grid min-h-full gap-5 p-5 lg:h-full lg:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
      <section className="flex min-h-0 flex-col gap-4">
        <VideoPanel />
        <Diagnostics />
      </section>
      <aside className="flex min-h-0 flex-col gap-4">
        <FollowUpCard />
        <CurrentQuestion />
        <LiveContext />
        <Recent />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={resetBaseline}
            disabled={learning}
            className="press rounded-lg border border-zinc-700 px-3 py-2.5 text-sm hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset baseline
          </button>
          <button
            type="button"
            onClick={() => void finish()}
            className="press flex-1 rounded-lg bg-zinc-100 px-4 py-2.5 font-medium text-zinc-950 hover:bg-white"
          >
            End session
          </button>
        </div>
      </aside>
      <FlagDetails />
    </div>
  );
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement);

/** N starts a new Question. Never while typing, never with modifiers, never under an overlay. No animation. */
function useNewQuestionHotkey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTyping(e.target) || isTyping(document.activeElement)) return;
      const s = store.get();
      if (s.openFlagId || !s.session || s.session.endedAt) return;
      e.preventDefault();
      newQuestion();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Re-renders once a second so running clocks and ongoing durations tick. */
function useTick() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

function CurrentQuestion() {
  useTick();
  const question = useStore((s) => currentQuestion(s.session!));
  const now = sessionNow();

  return (
    <section aria-label="Current Question" className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500">
        <span>Current Question</span>
        <span className="font-mono normal-case tabular-nums tracking-normal">
          <span className="text-zinc-300">{formatTime(now - question.start)}</span>
          <span className="text-zinc-600"> · session {formatTime(now)}</span>
        </span>
      </div>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0 text-lg font-medium">
          Q{question.number} · {question.label}
        </div>
        <button
          type="button"
          onClick={() => newQuestion()}
          title="Fallback: Questions are normally picked up from what you ask."
          className="press mt-0.5 shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
        >
          Mark new question <kbd className="ml-1 rounded bg-zinc-800 px-1 text-[10px]">N</kbd>
        </button>
      </div>
    </section>
  );
}

const SPEAKER: Record<Speaker, string> = { interviewer: "Interviewer", candidate: "Candidate", mixed: "Speaker" };

/** Quiet live context: what was last said, the Question as asked, and whether the app is listening/observing. */
function LiveContext() {
  const lines = useStore((s) => s.session!.transcript.slice(-4));
  const question = useStore((s) => currentQuestion(s.session!));
  const asrOn = useStore((s) => s.session!.asr.available);
  const listening = useStore((s) => s.listening);
  const observing = useStore((s) => s.fps > 0);

  return (
    <section aria-label="Live context" className="rounded-xl border border-zinc-800/70 px-4 py-3 text-sm">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500">
        <span>Live context</span>
        <span className="flex gap-3 normal-case tracking-normal">
          <Indicator on={listening}>Listening</Indicator>
          <Indicator on={observing}>Observing</Indicator>
        </span>
      </div>
      {question.text && <p className="mt-2 text-zinc-300">“{question.text}”</p>}
      {!asrOn ? (
        <p className="mt-2 text-zinc-500">
          Local speech recognition is off — follow-ups need a transcript. Start it with <code>npm run whisper</code>.
        </p>
      ) : lines.length === 0 ? (
        <p className="mt-2 text-zinc-500">Nothing transcribed yet.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1">
          {lines.map((l) => (
            <li key={l.id} className="line-clamp-2 text-zinc-400">
              <span className={l.speaker === "candidate" ? "text-zinc-200" : "text-zinc-300"}>{SPEAKER[l.speaker]}:</span> {l.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Indicator({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className={`flex items-center gap-1.5 ${on ? "text-emerald-300" : "text-zinc-500"}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${on ? "bg-emerald-400" : "bg-zinc-600"}`} />
      {children}
    </span>
  );
}

type Row = { kind: "flag"; t: number; flag: Flag } | { kind: "moment"; t: number; moment: Moment };

const momentStatus = (m: Moment): string => {
  switch (m.decision) {
    case "pending":
      return "open";
    case "continued":
      return "continued";
    case "dismissed":
      return "dismissed";
    case "asked":
      return m.result === "settled" ? "follow-up asked · settled" : m.result === "persisting" ? "follow-up asked · pattern continued" : "follow-up asked";
  }
};

function Recent() {
  useTick();
  const flags = useStore((s) => s.session!.flags);
  const moments = useStore((s) => s.session!.moments);
  const questions = useStore((s) => s.session!.questions);
  const byId = new Map<string, Question>(questions.map((q) => [q.id, q]));
  const qLabel = (id: string | null) => {
    const q = id ? byId.get(id) : undefined;
    return q ? `Q${q.number}` : "";
  };
  const now = sessionNow();

  const rows: Row[] = [
    ...flags.map((flag): Row => ({ kind: "flag", t: flag.start, flag })),
    ...moments.map((moment): Row => ({ kind: "moment", t: moment.t, moment })),
  ].sort((a, b) => b.t - a.t || (a.kind === "moment" ? -1 : 1));

  return (
    <section aria-label="Recent" className="flex min-h-48 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
        <span>Recent</span>
        <span className="normal-case tracking-normal">
          {flags.length} Flag{flags.length === 1 ? "" : "s"} · {moments.length} Moment{moments.length === 1 ? "" : "s"}
        </span>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">No observations yet.</li>}
        {rows.map((r) =>
          r.kind === "flag" ? (
            <li key={r.flag.id} className="card-enter border-b border-zinc-800/60 last:border-0">
              <button
                type="button"
                onClick={() => setOpenFlag(r.flag.id)}
                className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-zinc-800/50 ${r.flag.dismissed ? "opacity-50" : ""}`}
              >
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${r.flag.end === null ? "bg-amber-400/80" : "bg-zinc-600"}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{FLAG_LABELS[r.flag.kind]}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-400">
                      {formatTime(r.flag.start)} · {Math.max(0, Math.round(((r.flag.end ?? now) - r.flag.start) / 1000))}s
                    </span>
                  </span>
                  <span className="block text-xs text-zinc-400">
                    {[qLabel(r.flag.questionId), r.flag.end === null ? "ongoing" : null, r.flag.detail, r.flag.dismissed ? "dismissed" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ) : (
            <li key={r.moment.id} className="card-enter flex items-start gap-3 border-b border-zinc-800/60 px-4 py-2.5 last:border-0">
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${r.moment.result === "settled" ? "bg-emerald-400" : r.moment.decision === "pending" ? "bg-amber-400/80" : "bg-zinc-600"}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">Moment worth exploring</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-400">{formatTime(r.moment.t)}</span>
                </span>
                <span className="block text-xs text-zinc-400">
                  {[qLabel(r.moment.questionId), r.moment.reason, momentStatus(r.moment)].filter(Boolean).join(" · ")}
                </span>
              </span>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

/** P1 diagnostics: raw per-frame measurements, collapsed by default. */
function Diagnostics() {
  const [open, setOpen] = useState(false);
  return (
    <details className="rounded-xl border border-zinc-800/70 text-sm" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer select-none rounded-xl px-4 py-2 text-zinc-500 hover:text-zinc-300">Diagnostics</summary>
      {open && <SignalReadout />}
    </details>
  );
}

function SignalReadout() {
  const s = useStore((st) => st.latestSignal);
  const fps = useStore((st) => st.fps);
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}°`);
  const items: [string, string][] = [
    ["Faces", String(s?.faceCount ?? "—")],
    ["Head yaw", fmt(s?.headYaw)],
    ["Head pitch", fmt(s?.headPitch)],
    ["Gaze X", fmt(s?.gazeX)],
    ["Gaze Y", fmt(s?.gazeY)],
    ["Frames/s", fps ? fps.toFixed(0) : "—"],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 px-4 pb-3 sm:grid-cols-6">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg bg-zinc-900 px-3 py-2">
          <div className="text-xs text-zinc-500">{k}</div>
          <div className="font-mono tabular-nums">{v}</div>
        </div>
      ))}
    </div>
  );
}
