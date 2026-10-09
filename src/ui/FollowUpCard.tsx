import { followUpAction, newQuestion } from "../app/controller";
import { analyzeAnswer } from "../context/gaps";
import { MAX_FOLLOW_UPS, type Moment } from "../domain/types";
import { RULES } from "../rules/config";
import { allowedActions, type FollowUpAction } from "../rules/followUp";
import { sessionNow, useStore } from "../store/session";

const primary = "press rounded-lg bg-emerald-500 px-3.5 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400";
const secondary = "press rounded-lg border border-zinc-700 px-3.5 py-2 text-sm hover:border-zinc-500";

/** Cards 6 and 7 (FR-010 – FR-017). Renders from the follow-up phase; buttons come from allowedActions(). */
export function FollowUpCard() {
  const followUp = useStore((s) => s.session!.followUp);
  const moments = useStore((s) => s.session!.moments);
  const llmModel = useStore((s) => s.llmModel);
  const { phase, used } = followUp;

  if (phase === "observing") return null;

  if (phase === "dismissed") {
    return (
      <div className="card-enter flex items-center gap-2 rounded-xl border border-zinc-800 px-4 py-2.5 text-sm text-zinc-400" role="status">
        <span aria-hidden className="size-1.5 rounded-full bg-zinc-500" />
        Suggestions paused for this Question.
      </div>
    );
  }

  const current = followUp.momentId ? moments.find((m) => m.id === followUp.momentId) : undefined;
  const asked = [...moments].reverse().find((m) => m.questionId === followUp.questionId && m.decision === "asked");
  // No follow-up text (still writing, or none suggested): nothing to ask; with none suggested, Continue only.
  const noText = !!current && current.followUp === null;
  const actions = allowedActions(followUp).filter(
    (a) => !(noText && a === "ask") && !(noText && current?.suggestion !== "generating" && a === "dismiss"),
  );
  const final = used + 1 >= MAX_FOLLOW_UPS;

  const run = (a: FollowUpAction) => (a === "next_question" ? newQuestion() : followUpAction(a));
  const label: Record<FollowUpAction, string> = {
    ask: final ? "Ask final follow-up" : "Ask Follow-up",
    continue: "Continue",
    dismiss: "Dismiss",
    next_question: "Next Question",
  };

  const tone = phase === "settled" ? "border-emerald-500/40" : "border-zinc-700";

  return (
    <section
      key={`${phase}-${followUp.momentId ?? ""}`}
      aria-live="polite"
      aria-label="Follow-up"
      className={`card-enter rounded-xl border bg-zinc-900 p-4 ${tone}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className={`font-medium ${phase === "settled" ? "text-emerald-300" : "text-zinc-100"}`}>{TITLES[phase]}</h2>
        {(phase === "worth_exploring" || phase === "persisting") && <Counter n={used + 1} />}
        {phase === "re_observing" && <Counter n={used} />}
      </div>

      {(phase === "worth_exploring" || phase === "persisting") && (
        <div className="mt-2 flex flex-col gap-2 text-sm">
          {phase === "persisting" && <p className="text-zinc-300">One final follow-up is available.</p>}
          {current && <Suggestion moment={current} model={llmModel} />}
        </div>
      )}

      {phase === "re_observing" && <ReObserving until={followUp.reObserveUntil} used={used} asked={asked} />}

      {phase === "settled" && <p className="mt-1.5 text-sm text-zinc-300">No further follow-up suggested.</p>}
      {phase === "limit_reached" && (
        <p className="mt-1.5 text-sm text-zinc-300">The assistant will stop suggesting follow-ups for this Question.</p>
      )}

      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <button key={a} type="button" onClick={() => run(a)} className={a === "ask" || a === "next_question" ? primary : secondary}>
              {label[a]}
              {a === "next_question" && <kbd className="ml-1.5 rounded bg-emerald-700/40 px-1 text-xs">N</kbd>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const TITLES: Record<string, string> = {
  worth_exploring: "Moment worth exploring",
  re_observing: "Re-observing…",
  settled: "Observation settled ✓",
  persisting: "Pattern continues",
  limit_reached: "Follow-up limit reached",
};

function Counter({ n }: { n: number }) {
  return (
    <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-xs tabular-nums text-zinc-300">
      Follow-up {Math.min(n, MAX_FOLLOW_UPS)} / {MAX_FOLLOW_UPS}
    </span>
  );
}

function Suggestion({ moment, model }: { moment: Moment; model: string | null }) {
  const writing = moment.suggestion === "generating";
  return (
    <>
      <p className="text-zinc-400">{moment.reason}</p>
      {writing ? (
        <p className="text-zinc-400" role="status">
          Writing a suggestion…
        </p>
      ) : (
        <>
          {moment.note && <p className="leading-relaxed text-zinc-200">{moment.note}</p>}
          {moment.followUp ? (
            <p className="card-enter rounded-lg bg-zinc-950/60 px-3 py-2 leading-relaxed text-zinc-100">
              <span className="block text-xs text-zinc-500">Suggested follow-up</span>“{moment.followUp}”
            </p>
          ) : (
            moment.reasoning && <p className="text-zinc-300">{noFollowUpLine(moment.reasoning.reason)}</p>
          )}
          {moment.followUp && moment.reasoning && <WhyLine moment={moment} />}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {moment.followUp &&
              moment.quality &&
              (["specific", "neutral", "grounded"] as const).map((k) => (
                <span
                  key={k}
                  className={`rounded-full px-2 py-0.5 ring-1 ${
                    moment.quality![k] ? "text-emerald-300 ring-emerald-500/30" : "text-zinc-500 ring-zinc-700"
                  }`}
                >
                  {moment.quality![k] ? "✓ " : ""}
                  {k[0].toUpperCase() + k.slice(1)}
                </span>
              ))}
            <span className="ml-auto text-zinc-500">{moment.suggestion === "llm" ? `local LLM${model ? ` · ${model}` : ""}` : "template"}</span>
          </div>
        </>
      )}
    </>
  );
}

/** "No follow-up suggested — <reason>", without repeating the phrase when the reason already ends with it. */
function noFollowUpLine(reason: string): string {
  const core = reason.replace(/\s*—\s*no follow-up suggested\.?$/i, "").replace(/\.$/, "");
  return /^no transcript/i.test(core) ? reason : `No follow-up suggested — ${core.charAt(0).toLowerCase()}${core.slice(1)}.`;
}

const short = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`);

/** Compact traceability line: what was asked, what the answer covered, and what remained unclear. */
function WhyLine({ moment }: { moment: Moment }) {
  const r = moment.reasoning!;
  const covered = analyzeAnswer(r.answer).covered;
  return (
    <p className="text-xs leading-relaxed text-zinc-500">
      <span className="text-zinc-400">Why this follow-up: </span>
      Q: {short(r.question, 80)} · Answer covered: {covered.length ? covered.join(", ") : "—"}
      {r.gap && (
        <>
          {" "}
          · Unclear: <span className="text-zinc-300">{r.gap}</span> — {r.reason}
        </>
      )}
    </p>
  );
}

function ReObserving({ until, used, asked }: { until: number | null; used: number; asked: Moment | undefined }) {
  const total = RULES.followUp.reObserveMs;
  const remaining = until === null ? 0 : Math.max(0, until - sessionNow());
  return (
    <div className="mt-1.5 text-sm">
      <p className="text-zinc-300">
        Follow-up {used} / {MAX_FOLLOW_UPS} asked. Watching for {Math.round(total / 1000)} s.
      </p>
      {asked?.followUp && <p className="mt-1 text-zinc-500">“{asked.followUp}”</p>}
      <div className="mt-3 h-0.5 overflow-hidden rounded bg-zinc-800" aria-hidden>
        <div
          key={until ?? 0}
          className="drain h-full bg-zinc-400"
          style={{ animationDuration: `${remaining}ms`, "--from": String(remaining / total) } as React.CSSProperties}
        />
      </div>
    </div>
  );
}
