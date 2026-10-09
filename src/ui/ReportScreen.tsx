import { FLAG_LABELS } from "../domain/types";
import { formatTime } from "../llm/notes";
import { downloadFile, toJSON, toMarkdown } from "../llm/report";
import { clearSession, useStore } from "../store/session";

const button = "rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500 disabled:opacity-40";

export function ReportScreen() {
  const session = useStore((s) => s.session!);
  const status = useStore((s) => s.reportStatus);
  const report = session.report;
  const stamp = new Date(session.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const base = `${session.candidateName.replace(/\s+/g, "-").toLowerCase()}-${stamp}`;
  const length = (session.endedAt ?? session.startedAt) - session.startedAt;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Session report · {session.candidateName}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {new Date(session.startedAt).toLocaleString()} · {formatTime(length)} · consent confirmed{" "}
            {new Date(session.consentAt).toLocaleTimeString()}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!report}
            onClick={() => downloadFile(`${base}.md`, toMarkdown(session), "text/markdown")}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
          >
            Export Markdown
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={() => downloadFile(`${base}.json`, toJSON(session), "application/json")}
            className={button}
          >
            Export JSON
          </button>
          <button type="button" onClick={clearSession} className={button}>
            New session
          </button>
        </div>
      </div>

      {status === "generating" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
          The local LLM is writing the report…
        </div>
      )}
      {status === "fallback" && (
        <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          Local LLM unavailable. Showing a summary built from the Flags only.
        </div>
      )}

      {report && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="text-sm font-medium text-zinc-400">Summary</div>
          <p className="mt-2 leading-relaxed">{report.summary}</p>
        </div>
      )}

      {session.questions.map((q) => {
        const flags = session.flags.filter((f) => f.questionId === q.id);
        const entry = report?.perQuestion.find((p) => p.questionId === q.id);
        return (
          <div key={q.id} className="rounded-xl border border-zinc-800 p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">
                Q{q.number} · {q.label}
              </h2>
              <span className="font-mono text-xs text-zinc-500">{formatTime(q.start)}</span>
            </div>
            {entry && <p className="mt-2 text-sm leading-relaxed text-zinc-300">{entry.observation}</p>}
            {entry?.followUp && <p className="mt-2 text-sm text-emerald-300">Follow up: {entry.followUp}</p>}
            {flags.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1 font-mono text-xs text-zinc-400">
                {flags.map((f) => (
                  <li key={f.id}>
                    {formatTime(f.start)}–{formatTime(f.end ?? f.start)} · {FLAG_LABELS[f.kind]}
                    {f.detail && ` · ${f.detail}`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">No Flags.</p>
            )}
          </div>
        );
      })}
      <p className="text-center text-xs text-zinc-500">
        Generated on-device. No video or images were stored or transmitted.
      </p>
    </div>
  );
}
