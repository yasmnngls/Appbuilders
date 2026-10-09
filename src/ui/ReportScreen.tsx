import { FLAG_LABELS, type Session } from "../domain/types";
import { formatTime } from "../llm/notes";
import { buildJourneys, downloadFile, toJSON, toMarkdown, type QuestionJourney } from "../llm/report";
import { clearSession, useStore } from "../store/session";

const secondary = "press rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40";

const SOURCE_TEXT: Record<Session["source"], string> = {
  window: "Online interview / assessment window",
  webcam: "Local webcam",
  video: "Local video file",
};

const OUTCOME: Record<QuestionJourney["outcome"], { text: string; tone: "settled" | "plain" }> = {
  none: { text: "No Flags", tone: "plain" },
  observed: { text: "Observed, not explored", tone: "plain" },
  continued: { text: "Continued", tone: "plain" },
  dismissed: { text: "Dismissed", tone: "plain" },
  settled: { text: "Settled ✓", tone: "settled" },
  persisting: { text: "Pattern continued", tone: "plain" },
  limit_reached: { text: "Follow-up limit reached", tone: "plain" },
  unresolved: { text: "Session ended during re-observation", tone: "plain" },
};

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "candidate";

/** M10: browser print-to-PDF. Chrome/Edge use document.title as the suggested file name. */
export function exportPdf(session: Session) {
  const previous = document.title;
  const date = new Date(session.startedAt).toISOString().slice(0, 10);
  document.title = `${slug(session.candidateName)}-${date}-session-report`;
  const restore = () => {
    document.title = previous;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

/** Screen 8 (FR-018 – FR-021). Never shows images, scores or hiring recommendations. */
export function ReportScreen() {
  const session = useStore((s) => s.session!);
  const status = useStore((s) => s.reportStatus);
  const lightweight = useStore((s) => s.lightweight);
  const report = session.report;
  const journeys = buildJourneys(session);
  const stamp = new Date(session.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const base = `${slug(session.candidateName)}-${stamp}`;
  const length = (session.endedAt ?? session.startedAt) - session.startedAt;
  const ready = !!report;

  const totals = {
    moments: journeys.reduce((n, j) => n + j.moments.length, 0),
    followUps: journeys.reduce((n, j) => n + j.followUpsAsked.length, 0),
    settled: journeys.filter((j) => j.outcome === "settled").length,
    persisting: journeys.filter((j) => j.outcome === "persisting" || j.outcome === "limit_reached").length,
    unresolved: journeys.filter((j) => j.outcome === "unresolved").length,
  };

  const summaryRows: [string, string][] = [
    ["Candidate", session.candidateName],
    ["Date", new Date(session.startedAt).toLocaleString()],
    ["Consent confirmed", new Date(session.consentAt).toLocaleTimeString()],
    ["Source", SOURCE_TEXT[session.source]],
    ["Length", formatTime(length)],
    ["Speech context", session.speechAvailable ? "On" : "Off (visual-only thresholds)"],
    ["Local model", session.llmModel ?? "None (template text)"],
    ["Lightweight mode", lightweight ? "Yes" : "No"],
  ];

  return (
    <div className="print-plain mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Session Report · {session.candidateName}</h1>
          <p className="print-muted mt-1 text-sm text-zinc-400">Observations and follow-ups from this interview. Not a verdict.</p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!ready}
            onClick={() => exportPdf(session)}
            className="press rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export PDF
          </button>
          <button type="button" disabled={!ready} onClick={() => downloadFile(`${base}.md`, toMarkdown(session), "text/markdown")} className={secondary}>
            Export Markdown
          </button>
          <button type="button" disabled={!ready} onClick={() => downloadFile(`${base}.json`, toJSON(session), "application/json")} className={secondary}>
            Export JSON
          </button>
          <button type="button" onClick={clearSession} className={secondary}>
            New session
          </button>
        </div>
      </div>

      <section className="print-block rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-sm font-medium text-zinc-400">Session summary</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
          {summaryRows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="print-muted text-zinc-500">{k}</dt>
              <dd className="text-zinc-200">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {status === "generating" && (
        <div className="no-print rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300" role="status">
          The local LLM is writing the summary…
        </div>
      )}

      {report && (
        <section className="card-enter print-block rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-zinc-400">Summary</h2>
            <span className="print-muted text-xs text-zinc-500">
              {status === "fallback" ? "Template summary · local LLM unavailable" : "Written on-device by the local LLM"}
            </span>
          </div>
          <p className="mt-2 leading-relaxed">{report.summary}</p>
        </section>
      )}

      <section className="print-block grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Totals">
        {(
          [
            ["Moments explored", totals.moments],
            ["Follow-ups used", totals.followUps],
            ["Settled", totals.settled],
            ["Persisting / limit reached", totals.persisting],
            ["Unresolved", totals.unresolved],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-zinc-800 px-3 py-2.5">
            <div className="font-mono text-lg tabular-nums">{v}</div>
            <div className="print-muted text-xs text-zinc-500">{k}</div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4" aria-label="Questions">
        {journeys.map((j) => (
          <QuestionBlock key={j.question.id} journey={j} observation={report?.perQuestion.find((p) => p.questionId === j.question.id)?.observation} endT={length} />
        ))}
      </section>

      <section className="rounded-xl border border-zinc-800 p-5">
        <h2 className="text-sm font-medium text-zinc-400">Session Timeline</h2>
        {session.timeline.length ? (
          <ol className="mt-3 flex flex-col gap-1 text-sm">
            {[...session.timeline]
              .sort((a, b) => a.t - b.t)
              .map((e, i) => (
                <li key={i} className="flex gap-3">
                  <span className="print-muted w-12 shrink-0 font-mono text-xs leading-5 tabular-nums text-zinc-500">{formatTime(e.t)}</span>
                  <span className="text-zinc-300">{e.text}</span>
                </li>
              ))}
          </ol>
        ) : (
          <p className="print-muted mt-3 text-sm text-zinc-500">No events.</p>
        )}
      </section>

      <p className="print-muted text-center text-xs text-zinc-500">Generated on-device. No video or images were stored or transmitted.</p>
    </div>
  );
}

function QuestionBlock({ journey: j, observation, endT }: { journey: QuestionJourney; observation?: string; endT: number }) {
  const q = j.question;
  const outcome = OUTCOME[j.outcome];
  const explored = j.moments[0];
  const steps: { label: string; value: string; tone?: "settled" }[] = [
    { label: "Question", value: `Q${q.number}` },
    { label: "Moment explored", value: explored ? FLAG_LABELS[explored.kind] : "—" },
    { label: "Follow-up", value: j.followUpsAsked.length ? `${j.followUpsAsked.length} asked` : "—" },
    { label: "Result", value: outcome.text, tone: outcome.tone === "settled" ? "settled" : undefined },
  ];

  return (
    <article className="print-block rounded-xl border border-zinc-800 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium">
          Q{q.number} · {q.label}
        </h3>
        <span className="print-muted font-mono text-xs text-zinc-500">{formatTime(q.start)}</span>
      </div>

      <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" aria-label="Question Journey">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="print-muted text-zinc-600">
                →
              </span>
            )}
            <span className={`rounded-md px-2 py-1 ring-1 ${s.tone === "settled" ? "text-emerald-300 ring-emerald-500/30" : "text-zinc-300 ring-zinc-700"}`}>
              <span className="print-muted text-zinc-500">{s.label}: </span>
              {s.value}
            </span>
          </li>
        ))}
      </ol>

      {observation && <p className="mt-3 text-sm leading-relaxed text-zinc-300">{observation}</p>}

      {j.followUpsAsked.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {j.followUpsAsked.map((a) => (
            <li key={a.at} className="text-zinc-300">
              <span className="print-muted font-mono text-xs text-zinc-500">{formatTime(a.at)} · follow-up {a.n} · </span>“{a.text}”
            </li>
          ))}
        </ul>
      )}

      {j.flags.length > 0 ? (
        <ul className="print-muted mt-3 flex flex-col gap-1 font-mono text-xs text-zinc-400">
          {j.flags.map((f) => (
            <li key={f.id} className={f.dismissed ? "opacity-60" : undefined}>
              {formatTime(f.start)}–{formatTime(f.end ?? endT)} · {FLAG_LABELS[f.kind]}
              {f.detail && ` · ${f.detail}`}
              {f.dismissed && " · dismissed"}
            </li>
          ))}
        </ul>
      ) : (
        <p className="print-muted mt-3 text-sm text-zinc-500">No Flags.</p>
      )}
    </article>
  );
}
