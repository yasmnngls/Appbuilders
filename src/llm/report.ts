import { FLAG_LABELS, MAX_FOLLOW_UPS, type Flag, type FlagKind, type Moment, type Question, type Session, type SessionReport, type SessionTime } from "../domain/types";
import { LLM } from "./config";
import { findBanned } from "./guard";
import { formatTime } from "./notes";
import { chatJSON, isLightweight } from "./ollama";

export const PRIVACY_FOOTER = "Generated on-device. No video or images were stored or transmitted.";

/** One Question's path through the Adaptive Follow-Up Loop, built deterministically from Flags, Moments and the timeline. */
export interface QuestionJourney {
  question: Question;
  flags: Flag[];
  /** In order. */
  moments: Moment[];
  /** Only follow-ups the Interviewer actually asked. */
  followUpsAsked: { text: string; at: SessionTime; n: number }[];
  outcome: "none" | "observed" | "continued" | "dismissed" | "settled" | "persisting" | "limit_reached" | "unresolved";
}

const sessionEnd = (s: Session) => (s.endedAt ?? Date.now()) - s.startedAt;
const durationSec = (f: Flag, endT: number) => Math.max(0, Math.round(((f.end ?? endT) - f.start) / 1000));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function outcomeOf(session: Session, q: Question, flags: Flag[], moments: Moment[], asked: number): QuestionJourney["outcome"] {
  if (!flags.length && !moments.length) return "none";
  if (!moments.length) return "observed";
  const last = moments[moments.length - 1];
  const limitEvent = session.timeline.some((e) => e.questionId === q.id && e.kind === "limit-reached");
  const live = session.followUp.questionId === q.id ? session.followUp.phase : null;
  switch (last.decision) {
    case "dismissed":
      return "dismissed";
    case "continued":
      return "continued";
    case "pending":
      return "unresolved";
    case "asked":
      if (last.result === "settled") return "settled";
      if (last.result === "persisting") return limitEvent || asked >= MAX_FOLLOW_UPS || live === "limit_reached" ? "limit_reached" : "persisting";
      if (limitEvent || live === "limit_reached") return "limit_reached";
      return "unresolved";
  }
}

/** Question Journeys in Question order: Question → Moment explored → Follow-up → Result. */
export function buildJourneys(session: Session): QuestionJourney[] {
  return session.questions.map((question) => {
    const flags = session.flags.filter((f) => f.questionId === question.id).sort((a, b) => a.start - b.start);
    const moments = session.moments.filter((m) => m.questionId === question.id).sort((a, b) => a.t - b.t);
    const followUpsAsked = moments
      .filter((m) => m.decision === "asked" && m.followUp)
      .map((m) => ({ text: m.followUp as string, at: m.askedAt ?? m.t, n: m.followUpNumber }));
    return { question, flags, moments, followUpsAsked, outcome: outcomeOf(session, question, flags, moments, followUpsAsked.length) };
  });
}

const OUTCOME_TEXT: Record<QuestionJourney["outcome"], string> = {
  none: "No Flags during this question.",
  observed: "Flags were observed; none formed a moment worth exploring.",
  continued: "The Interviewer continued without asking a follow-up.",
  dismissed: "The Interviewer dismissed the moment.",
  settled: "Pattern settled after follow-up.",
  persisting: "Pattern continued after follow-up.",
  limit_reached: "Follow-up limit reached; the pattern continued.",
  unresolved: "The session ended before the pattern was re-observed.",
};

const MOMENT_TEXT: Record<FlagKind, string> = {
  "reading-pattern": "A repeated reading-like gaze pattern was observed",
  "off-screen": "Gaze moved outside the usual range",
  "face-missing": "The face was out of view",
  "second-face": "A second face was visible",
};

function kindSummary(flags: Flag[], endT: number): string {
  const byKind = new Map<FlagKind, { n: number; secs: number }>();
  for (const f of flags) {
    const k = byKind.get(f.kind) ?? { n: 0, secs: 0 };
    byKind.set(f.kind, { n: k.n + 1, secs: k.secs + durationSec(f, endT) });
  }
  return [...byKind].map(([kind, { n, secs }]) => `${FLAG_LABELS[kind]} ×${n} (${secs}s total)`).join(", ");
}

/** Deterministic one-paragraph observation for a Question. */
function journeyObservation(j: QuestionJourney, endT: number): string {
  if (j.outcome === "none") return OUTCOME_TEXT.none;
  const parts = [`${plural(j.flags.length, "Flag")}: ${kindSummary(j.flags, endT)}.`];
  for (const m of j.moments) parts.push(`${MOMENT_TEXT[m.kind]} at ${formatTime(m.t)} (${m.reason}).`);
  if (j.followUpsAsked.length) parts.push(`${plural(j.followUpsAsked.length, "follow-up")} asked.`);
  parts.push(OUTCOME_TEXT[j.outcome]);
  return parts.join(" ");
}

const lastAsked = (j: QuestionJourney) => j.followUpsAsked[j.followUpsAsked.length - 1]?.text ?? null;

interface Totals {
  moments: number;
  followUps: number;
  settled: number;
  persisting: number;
  unresolved: number;
}
function totalsOf(journeys: QuestionJourney[]): Totals {
  const count = (...o: QuestionJourney["outcome"][]) => journeys.filter((j) => o.includes(j.outcome)).length;
  return {
    moments: journeys.reduce((n, j) => n + j.moments.length, 0),
    followUps: journeys.reduce((n, j) => n + j.followUpsAsked.length, 0),
    settled: count("settled"),
    persisting: count("persisting", "limit_reached"),
    unresolved: count("unresolved"),
  };
}

/** Deterministic Session Report built without the language model. Follow-ups are only the ones actually asked. */
export function fallbackReport(session: Session): SessionReport {
  const endT = sessionEnd(session);
  const journeys = buildJourneys(session);
  const t = totalsOf(journeys);
  const flagged = journeys.filter((j) => j.flags.length).map((j) => `Q${j.question.number}`);
  const summary = session.flags.length
    ? `${plural(session.flags.length, "Flag")} across ${plural(session.questions.length, "question")}, observed during ${flagged.join(", ")}. ` +
      `${plural(t.moments, "moment")} worth exploring, ${plural(t.followUps, "follow-up")} asked; ${t.settled} settled, ${t.persisting} continued, ${t.unresolved} unresolved.`
    : `No Flags were raised across ${plural(session.questions.length, "question")}.`;
  return {
    summary,
    perQuestion: journeys.map((j) => ({ questionId: j.question.id, observation: journeyObservation(j, endT), followUp: lastAsked(j) })),
    generatedAt: endT,
  };
}

const REPORT_SYSTEM = `You help a job interviewer review an interview after it ended. An on-device tool recorded neutral, time-stamped observations of where the candidate's gaze and face were, organised by question.
Write JSON with:
- "summary": 2-3 sentences describing the overall pattern of observations across the interview, naming question numbers (Q1, Q2...) and what happened after any follow-up.
- "perQuestion": one entry for EVERY question listed, with "questionNumber" and "observation": one or two short factual sentences about what was observed in that question and the result, or that nothing was observed.
Use observation words only: "observed", "pattern", "gaze moved", "face out of view", "second face", "reading-like pattern", "settled", "continued". Describe facts only: never describe the Candidate's state of mind or feelings, and never give reasons, opinions, scores or hiring advice. Do not write new follow-up questions.`;

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    perQuestion: {
      type: "array",
      items: {
        type: "object",
        properties: { questionNumber: { type: "integer" }, observation: { type: "string" } },
        required: ["questionNumber", "observation"],
      },
    },
  },
  required: ["summary", "perQuestion"],
};

/** The journeys as plain text: the only input the report model gets (no video, no landmarks). */
export function journeysText(session: Session): string {
  const endT = sessionEnd(session);
  const lines = [`Interview length ${formatTime(endT)}.`];
  for (const j of buildJourneys(session)) {
    lines.push("", `Q${j.question.number} "${j.question.label}" (starts ${formatTime(j.question.start)}):`);
    if (!j.flags.length) lines.push("- no Flags");
    for (const f of j.flags) lines.push(`- ${FLAG_LABELS[f.kind]} at ${formatTime(f.start)} for ${durationSec(f, endT)}s${f.dismissed ? " (dismissed by the interviewer)" : ""}`);
    for (const m of j.moments) lines.push(`- Moment worth exploring at ${formatTime(m.t)}: ${m.reason}; interviewer decision: ${m.decision}${m.result ? `; result: ${m.result}` : ""}`);
    for (const a of j.followUpsAsked) lines.push(`- Follow-up ${a.n} asked at ${formatTime(a.at)}: "${a.text}"`);
    lines.push(`- Outcome: ${OUTCOME_TEXT[j.outcome]}`);
  }
  return lines.join("\n");
}

interface RawReport {
  summary?: unknown;
  perQuestion?: { questionNumber?: unknown; observation?: unknown }[];
}

/** A non-empty string with no banned word, else null (that field falls back). */
const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() && findBanned(v).length === 0 ? v.trim() : null);

/**
 * Session Report: the local model writes the summary sentences over the deterministic journeys.
 * Follow-ups are always the ones actually asked. Any missing or failing field uses fallbackReport. Never throws.
 */
export async function generateReport(session: Session, signal?: AbortSignal): Promise<SessionReport> {
  const fallback = fallbackReport(session);
  let raw: RawReport;
  try {
    raw = await chatJSON<RawReport>(REPORT_SYSTEM, journeysText(session), REPORT_SCHEMA, signal, { timeoutMs: LLM.reportTimeoutMs, stepDown: false });
  } catch {
    return fallback;
  }
  const entries = Array.isArray(raw?.perQuestion) ? raw.perQuestion : [];
  return {
    summary: clean(raw?.summary) ?? fallback.summary,
    perQuestion: session.questions.map((q, i) => {
      const fb = fallback.perQuestion[i];
      const e = entries.find((x) => Number(x?.questionNumber) === q.number);
      return { ...fb, observation: clean(e?.observation) ?? fb.observation };
    }),
    generatedAt: fallback.generatedAt,
  };
}

const SOURCE_TEXT: Record<Session["source"], string> = { webcam: "webcam", window: "meeting window", video: "video file" };

/** Exportable Markdown Session Report. Uses session.report, or the fallback if none was generated. */
export function toMarkdown(session: Session): string {
  const endT = sessionEnd(session);
  const fallback = fallbackReport(session);
  const report = session.report ?? fallback;
  const journeys = buildJourneys(session);
  const t = totalsOf(journeys);
  const byLlm = report.summary !== fallback.summary;
  const lines = [
    `# Session Report — ${session.candidateName}`,
    "",
    "## Session",
    "",
    `- Date: ${new Date(session.startedAt).toLocaleString()}`,
    `- Consent confirmed: ${new Date(session.consentAt).toLocaleString()}`,
    `- Source: ${SOURCE_TEXT[session.source]}`,
    `- Length: ${formatTime(endT)}`,
    `- Speech context: ${session.speechAvailable ? "on" : "off"}`,
    `- Local model: ${session.llmModel ?? "none (deterministic text)"}`,
    `- Lightweight mode: ${isLightweight() ? "yes" : "no"}`,
  ];
  if (session.baseline) {
    const b = session.baseline;
    lines.push(`- Baseline: gaze centre (${b.centreX.toFixed(1)}°, ${b.centreY.toFixed(1)}°), spread (${b.spreadX.toFixed(1)}°, ${b.spreadY.toFixed(1)}°)`);
  }
  lines.push("", "## Summary", "", report.summary, "", `_${byLlm ? "Written on-device by the local model." : "Deterministic summary."}_`);
  for (const j of journeys) {
    const q = j.question;
    const entry = report.perQuestion.find((p) => p.questionId === q.id);
    lines.push("", `## Q${q.number} · ${q.label} · ${formatTime(q.start)}`, "");
    const explored = j.moments.length ? MOMENT_TEXT[j.moments[0].kind] : "No moment explored";
    const fu = j.followUpsAsked.length ? j.followUpsAsked.map((a) => `"${a.text}"`).join(" / ") : "none asked";
    lines.push(`**Journey:** Question → ${explored} → Follow-up: ${fu} → ${OUTCOME_TEXT[j.outcome]}`, "");
    if (entry) lines.push(entry.observation, "");
    if (j.followUpsAsked.length) {
      lines.push("**Follow-ups asked**", "");
      for (const a of j.followUpsAsked) lines.push(`- ${formatTime(a.at)} (follow-up ${a.n}): "${a.text}"`);
      lines.push("");
    }
    lines.push("**Flags**", "");
    if (j.flags.length) {
      for (const f of j.flags) {
        lines.push(`- ${FLAG_LABELS[f.kind]} — ${formatTime(f.start)}–${formatTime(f.end ?? endT)} (${durationSec(f, endT)}s)${f.detail ? `: ${f.detail}` : ""}${f.dismissed ? " (dismissed)" : ""}`);
      }
    } else lines.push("- None");
  }
  lines.push(
    "",
    "## Totals",
    "",
    `- Moments explored: ${t.moments}`,
    `- Follow-ups used: ${t.followUps}`,
    `- Settled: ${t.settled}`,
    `- Persisting / limit reached: ${t.persisting}`,
    `- Unresolved: ${t.unresolved}`,
    "",
    "## Session Timeline",
    "",
  );
  if (session.timeline.length) for (const e of [...session.timeline].sort((a, b) => a.t - b.t)) lines.push(`- ${formatTime(e.t)} — ${e.text}`);
  else lines.push("- No events");
  lines.push("", "---", "", `_${PRIVACY_FOOTER}_`, "");
  return lines.join("\n");
}

/** Full Session as pretty-printed JSON (it holds no images by construction). */
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
