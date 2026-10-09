import { FLAG_LABELS, type Baseline, type Flag, type SessionTime } from "../domain/types";
import { formatTime } from "../llm/notes";
import { RULES } from "../rules/config";

/** Plain-language explanation of one Flag for Flag Details (FR-009). Observable behaviour only. */
export interface FlagExplanation {
  /** Upper-case Flag type, e.g. "LOOKING OFF-SCREEN". */
  title: string;
  /** "0:42 · 4 s" (or "0:42 · 4 s so far" while ongoing). */
  meta: string;
  observation: string;
  baseline: string | null;
  observed: string | null;
  threshold: string;
  /** Always shown under the details. */
  disclaimer: string;
}

export const DISCLAIMER = "This is an observation, not a conclusion.";

const deg = (v: number) => `${Math.round(v * 10) / 10}°`;
const secs = (ms: number) => Math.max(1, Math.round(ms / 1000));
const ms2s = (ms: number) => `${Math.round(ms / 100) / 10} s`;

/** Where the Candidate's usual gaze sits, as seen by the Interviewer (+x = image right, +y = up). */
export function describeCentre(b: Baseline): string {
  const part = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    if (a < 2) return null;
    return `${a < 6 ? "slightly " : ""}${v > 0 ? pos : neg}`;
  };
  const v = part(b.centreY, "above", "below");
  const h = part(b.centreX, "right of", "left of");
  const where = v && h ? `${v} and ${h.replace("slightly ", "")}` : (v ?? h);
  const spread = `(±${deg(b.spreadX)} × ±${deg(b.spreadY)})`;
  return where ? `normal gaze ${where} centre ${spread}` : `normal gaze near centre ${spread}`;
}

export function explainFlag(flag: Flag, now: SessionTime): FlagExplanation {
  const ongoing = flag.end === null;
  const durMs = (flag.end ?? now) - flag.start;
  const n = secs(durMs);
  const forAbout = `for about ${n} second${n === 1 ? "" : "s"}${ongoing ? " so far" : ""}`;
  const meta = `${formatTime(flag.start)} · ${n} s${ongoing ? " so far" : ""}`;
  const ev = flag.evidence ?? {};
  const base = { title: FLAG_LABELS[flag.kind].toUpperCase(), meta, disclaimer: DISCLAIMER };

  switch (flag.kind) {
    case "off-screen": {
      const thr = ev.thresholdDeg;
      const observedParts: string[] = [];
      if (ev.direction) observedParts.push(`gaze moved ${ev.direction === "up" || ev.direction === "down" ? ev.direction : `to the ${ev.direction}`}`);
      if (ev.peakDeviationDeg !== undefined) observedParts.push(`up to ${deg(ev.peakDeviationDeg)} from centre`);
      return {
        ...base,
        observation: `The Candidate's gaze moved outside their usual gaze range ${forAbout}.`,
        baseline: ev.baseline ? describeCentre(ev.baseline) : null,
        observed: observedParts.length ? observedParts.join(", ") : (flag.detail ?? null),
        threshold: thr
          ? `${deg(thr.x)} sideways / ${deg(thr.y)} vertical from the usual centre, held for ${ms2s(RULES.offScreen.onMs)}`
          : `outside the usual gaze range for ${ms2s(RULES.offScreen.onMs)}`,
      };
    }
    case "reading-pattern": {
      const r = RULES.reading;
      return {
        ...base,
        observation: `A reading-like pattern was observed: steady line-by-line gaze sweeps with quick returns, ${forAbout}.`,
        baseline: ev.baseline ? describeCentre(ev.baseline) : null,
        observed: ev.cycles !== undefined ? `${ev.cycles} line-like sweeps in a row` : (flag.detail ?? null),
        threshold: `${r.minCycles} back-to-back sweeps within ${ms2s(r.windowMs)}`,
      };
    }
    case "face-missing":
      return {
        ...base,
        observation: `No face was tracked in the video ${forAbout}.`,
        baseline: "one face tracked",
        observed: "no face in view",
        threshold: `no face for ${ms2s(RULES.faceMissing.onMs)} or longer`,
      };
    case "second-face":
      return {
        ...base,
        observation: `A second face was visible in the video ${forAbout}.`,
        baseline: "one face tracked",
        observed: `up to ${ev.faceCount ?? 2} faces in view`,
        threshold: `a second face visible for ${ms2s(RULES.secondFace.onMs)} or longer`,
      };
  }
}
