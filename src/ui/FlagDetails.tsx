import { useEffect, useRef, useState } from "react";
import { dismissFlag, exploreFlag } from "../app/controller";
import { MAX_FOLLOW_UPS } from "../domain/types";
import { sessionNow, setOpenFlag, useStore } from "../store/session";
import { explainFlag } from "./explain";

/**
 * Overlay 5 (FR-009): why a Flag was raised. A native modal <dialog>, so the page behind is inert
 * (focus is trapped) and Esc closes it.
 */
export function FlagDetails() {
  const flag = useStore((s) => (s.openFlagId ? (s.session?.flags.find((f) => f.id === s.openFlagId) ?? null) : null));
  const followUp = useStore((s) => s.session?.followUp ?? null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (flag && !d.open) d.showModal();
    if (!flag && d.open) d.close();
  }, [flag]);

  // Ongoing Flags: keep the duration current.
  const ongoing = flag?.end === null;
  useEffect(() => {
    if (!ongoing) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [ongoing]);

  const close = () => setOpenFlag(null);

  const e = flag ? explainFlag(flag, sessionNow()) : null;
  const budgetLeft = followUp ? followUp.used < MAX_FOLLOW_UPS : false;
  const currentQuestion = !!flag && flag.questionId === followUp?.questionId;
  const canExplore = !!flag && !flag.dismissed && currentQuestion && followUp?.phase === "observing" && budgetLeft;
  const whyNot = !flag
    ? ""
    : flag.dismissed
      ? "This Flag was dismissed."
      : !currentQuestion
        ? "This Flag belongs to an earlier Question."
        : !budgetLeft
        ? "The follow-up limit for this Question is reached."
        : followUp?.phase !== "observing"
          ? "A follow-up is already in progress, or suggestions are paused for this Question."
          : "";

  return (
    <dialog
      ref={dialog}
      onClose={() => flag && close()}
      onClick={(ev) => ev.target === dialog.current && close()}
      aria-labelledby="flag-details-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-zinc-800 bg-zinc-900 p-0 text-zinc-100 shadow-2xl shadow-black/50"
    >
      {flag && e && (
        <div className="card-enter p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="flag-details-title" className="text-sm font-semibold tracking-wide text-zinc-100">
                {e.title}
              </h2>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-xs tabular-nums text-zinc-400">
                {ongoing && <span aria-hidden className="size-1.5 rounded-full bg-amber-400" />}
                {e.meta}
                {flag.dismissed && <span className="font-sans text-zinc-500">· dismissed</span>}
              </div>
            </div>
            <button type="button" onClick={close} aria-label="Close" className="press -m-1 rounded-md px-2 py-1 text-zinc-400 hover:text-zinc-100">
              ✕
            </button>
          </div>

          <p className="mt-4 leading-relaxed">{e.observation}</p>

          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {e.baseline && (
              <>
                <dt className="text-zinc-500">Baseline</dt>
                <dd className="text-zinc-200">{e.baseline}</dd>
              </>
            )}
            {e.observed && (
              <>
                <dt className="text-zinc-500">Observed</dt>
                <dd className="text-zinc-200">{e.observed}</dd>
              </>
            )}
            <dt className="text-zinc-500">Threshold</dt>
            <dd className="text-zinc-200">{e.threshold}</dd>
          </dl>

          <p className="mt-4 text-sm text-zinc-400">{e.disclaimer}</p>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {!canExplore && whyNot && <span className="mr-auto text-xs text-zinc-500">{whyNot}</span>}
            <button
              type="button"
              disabled={flag.dismissed}
              onClick={() => {
                dismissFlag(flag.id);
                close();
              }}
              className="press rounded-lg border border-zinc-700 px-3.5 py-2 text-sm hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Dismiss
            </button>
            <button
              type="button"
              disabled={!canExplore}
              title={whyNot || "Open a Moment worth exploring from this Flag"}
              onClick={() => {
                exploreFlag(flag.id);
                close();
              }}
              className="press rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Explore
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
