import { FLAG_LABELS, type Flag, type FlagKind, type Question, type Session, type SessionReport } from "../domain/types";
import { describeFlag, formatTime } from "./notes";
import { chatJSON } from "./ollama";

const PRIVACY_FOOTER = "Generated on-device. No video or images were stored or transmitted.";

const sessionEnd = (s: Session) => (s.endedAt ?? Date.now()) - s.startedAt;
const flagsOf = (s: Session, q: Question) => s.flags.filter((f) => f.questionId === q.id);
const notesOf = (s: Session, q: Question) => s.notes.filter((n) => n.questionId === q.id);
const durationSec = (f: Flag, endT: number) => Math.max(0, Math.round(((f.end ?? endT) - f.start) / 1000));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function kindSummary(flags: Flag[], endT: number): string {
  const byKind = new Map<FlagKind, { n: number; secs: number }>();
  for (const f of flags) {
    const k = byKind.get(f.kind) ?? { n: 0, secs: 0 };
    byKind.set(f.kind, { n: k.n + 1, secs: k.secs + durationSec(f, endT) });
  }
  return [...byKind].map(([kind, { n, secs }]) => `${FLAG_LABELS[kind]} ×${n} (${secs}s total)`).join(", ");
}

/** Deterministic Session Report built without the language model. */
export function fallbackReport(session: Session): SessionReport {
  const endT = sessionEnd(session);
  const flagged = session.questions.filter((q) => flagsOf(session, q).length);
  const summary = session.flags.length
    ? `${plural(session.flags.length, "Flag")} across ${plural(session.questions.length, "question")}: ${kindSummary(session.flags, endT)}. Flags were raised during ${flagged.map((q) => `Q${q.number}`).join(", ")}.`
    : `No Flags were raised across ${plural(session.questions.length, "question")}.`;
  return {
    summary,
    perQuestion: session.questions.map((q) => {
      const flags = flagsOf(session, q);
      const lastFollowUp = notesOf(session, q).reverse().find((n) => n.followUp)?.followUp ?? null;
      return {
        questionId: q.id,
        observation: flags.length ? `${plural(flags.length, "Flag")}: ${kindSummary(flags, endT)}.` : "No Flags during this question.",
        followUp: lastFollowUp,
      };
    }),
    generatedAt: endT,
  };
}

const REPORT_SYSTEM = `You assist a job interviewer after an interview. An on-device tool raised Flags: neutral, time-stamped observations of where the Candidate's eyes and face were (Looking off-screen, Reading pattern, Face missing, Second face).
Write a Session Report as JSON:
- "summary": 2-3 sentences describing the overall pattern of Flags across the interview, referencing question numbers.
- "perQuestion": one entry for EVERY question listed, with "questionNumber", "observation" (one short factual sentence about the Flags in that question, or that there were none) and "followUp" (one follow-up question the interviewer could ask to explore that topic further with personal specifics, or null if the question had no Flags).
Report observations only. Do not guess why anything happened, do not judge honesty or intent, and do not use words like cheating, lying, violation or suspicious.`;

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    perQuestion: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionNumber: { type: "integer" },
          observation: { type: "string" },
          followUp: { type: ["string", "null"] },
        },
        required: ["questionNumber", "observation", "followUp"],
      },
    },
  },
  required: ["summary", "perQuestion"],
};

interface RawReport {
  summary?: unknown;
  perQuestion?: { questionNumber?: unknown; observation?: unknown; followUp?: unknown }[];
}

/** Session Report written by the local model; any question the model omits is filled from fallbackReport. */
export async function generateReport(session: Session, signal?: AbortSignal): Promise<SessionReport> {
  const endT = sessionEnd(session);
  const fallback = fallbackReport(session);
  const user = session.questions
    .map((q) => {
      const flags = flagsOf(session, q).map((f) => describeFlag(session, f, endT));
      return `Q${q.number} "${q.label}" (starts ${formatTime(q.start)}):\n${flags.length ? flags.join("\n") : "- no Flags"}`;
    })
    .join("\n\n");
  const raw = await chatJSON<RawReport>(REPORT_SYSTEM, `Interview length ${formatTime(endT)}.\n\n${user}`, REPORT_SCHEMA, signal);
  const entries = Array.isArray(raw.perQuestion) ? raw.perQuestion : [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    summary: str(raw.summary) ?? fallback.summary,
    perQuestion: session.questions.map((q, i) => {
      const e = entries.find((e) => Number(e?.questionNumber) === q.number);
      const fb = fallback.perQuestion[i];
      return e ? { questionId: q.id, observation: str(e.observation) ?? fb.observation, followUp: str(e.followUp) } : fb;
    }),
    generatedAt: endT,
  };
}

/** Exportable Markdown Session Report. Uses session.report, or the fallback if none was generated. */
export function toMarkdown(session: Session): string {
  const endT = sessionEnd(session);
  const report = session.report ?? fallbackReport(session);
  const lines = [
    `# Session Report — ${session.candidateName}`,
    "",
    `- Date: ${new Date(session.startedAt).toLocaleString()}`,
    `- Consent confirmed: ${new Date(session.consentAt).toLocaleString()}`,
    `- Source: ${session.source === "webcam" ? "webcam" : "meeting window"}`,
    `- Length: ${formatTime(endT)}`,
  ];
  if (session.baseline) {
    const b = session.baseline;
    lines.push(`- Baseline: gaze centre (${b.centreX.toFixed(1)}°, ${b.centreY.toFixed(1)}°), spread (${b.spreadX.toFixed(1)}°, ${b.spreadY.toFixed(1)}°)`);
  }
  lines.push("", "## Summary", "", report.summary);
  for (const q of session.questions) {
    const entry = report.perQuestion.find((p) => p.questionId === q.id);
    const flags = flagsOf(session, q);
    const notes = notesOf(session, q);
    lines.push("", `## Q${q.number}: ${q.label}`, "", `_Started at ${formatTime(q.start)}_`, "");
    if (entry) lines.push(entry.observation, "");
    lines.push("**Flags**", "");
    if (flags.length) {
      for (const f of flags) {
        lines.push(`- ${FLAG_LABELS[f.kind]} — ${formatTime(f.start)}–${formatTime(f.end ?? endT)} (${durationSec(f, endT)}s)${f.detail ? `: ${f.detail}` : ""}`);
      }
    } else lines.push("- None");
    if (notes.length) {
      lines.push("", "**Interviewer Notes**", "");
      for (const n of notes) lines.push(`- ${formatTime(n.t)} — ${n.text}${n.followUp ? ` _Follow-up: ${n.followUp}_` : ""}`);
    }
    const followUps = [...new Set([entry?.followUp, ...notes.map((n) => n.followUp)].filter((x): x is string => !!x))];
    if (followUps.length) lines.push("", "**Suggested follow-ups**", "", ...followUps.map((f) => `- ${f}`));
  }
  lines.push("", "---", "", `_${PRIVACY_FOOTER}_`, "");
  return lines.join("\n");
}

/** Full Session as pretty-printed JSON. */
export function toJSON(session: Session): string {
  return JSON.stringify(session, null, 2);
}

/** Save content as a file via a temporary Blob link. */
export function downloadFile(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
