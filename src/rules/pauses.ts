import type { Pause, SessionTime } from "../domain/types";
import { RULES } from "./config";

/** True if t falls inside a pause that has ended (speech resumed) and lasted at most maxMs. */
export function isThinkingPause(pauses: Pause[], t: SessionTime, maxMs: number = RULES.followUp.thinkingPauseMaxMs): boolean {
  return pauses.some((p) => p.end !== null && t >= p.start && t <= p.end && p.end - p.start <= maxMs);
}

/** True if t falls inside a pause that is still ongoing (end === null). */
export function inOpenPause(pauses: Pause[], t: SessionTime): boolean {
  return pauses.some((p) => p.end === null && t >= p.start);
}
