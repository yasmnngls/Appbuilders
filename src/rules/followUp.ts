import { MAX_FOLLOW_UPS } from "../domain/types";
import type { FlagKind, FollowUpPhase, FollowUpState, Moment, SessionTime, TimelineKind } from "../domain/types";
import { RULES } from "./config";
import type { GateHit } from "./gate";

export type FollowUpEvent =
  /** `label` (optional) is the Question as shown, e.g. "Q2 Tell me about…"; used only for the timeline text. */
  | { type: "question_started"; questionId: string; t: SessionTime; label?: string }
  | { type: "gate_hit"; hit: GateHit; momentId: string; t: SessionTime }
  | { type: "ask"; t: SessionTime }
  | { type: "continue"; t: SessionTime }
  | { type: "dismiss"; t: SessionTime }
  | { type: "explore"; flagId: string; momentId: string; t: SessionTime } // from Flag Details
  | { type: "tick"; t: SessionTime };

export type FollowUpEffect =
  | { type: "open_moment"; momentId: string; hit: GateHit | null; flagId?: string; followUpNumber: number; final: boolean }
  | { type: "moment_decision"; momentId: string; decision: Moment["decision"]; t: SessionTime }
  | { type: "moment_result"; momentId: string; result: "settled" | "persisting" }
  | { type: "timeline"; kind: TimelineKind; text: string; t: SessionTime };

export type FollowUpAction = "ask" | "continue" | "dismiss" | "next_question";

/**
 * The asked Moment must be remembered while re-observing (to report settled/persisting on it), but
 * `momentId` is null in that phase by invariant. It rides along as an extra field on the state object;
 * keep the state object as returned (spreading it is fine).
 */
type MachineState = FollowUpState;

const TERMINAL: readonly FollowUpPhase[] = ["settled", "limit_reached", "dismissed"];

export const isTerminal = (phase: FollowUpPhase) => TERMINAL.includes(phase);

const KIND_TEXT: Record<FlagKind, string> = {
  "off-screen": "off-screen gaze pattern",
  "reading-pattern": "reading-like pattern",
  "face-missing": "face out of view",
  "second-face": "second face visible",
};

export function initialFollowUp(questionId: string, t: SessionTime): FollowUpState {
  const s: MachineState = { questionId, phase: "observing", used: 0, reObserveUntil: null, momentId: null, watchFrom: t, askedMomentId: null };
  return s;
}

const unchanged = (s: FollowUpState) => ({ state: s, effects: [] as FollowUpEffect[] });

const DEV_LOG = Boolean(import.meta.env?.DEV) && import.meta.env?.MODE !== "test";

export function reduceFollowUp(s: FollowUpState, e: FollowUpEvent): { state: FollowUpState; effects: FollowUpEffect[] } {
  const out = step(s, e);
  if (import.meta.env?.DEV) {
    const broken = checkFollowUpInvariants(out.state);
    if (broken) console.error(`followUp invariant broken after ${e.type}: ${broken}`);
  }
  return out;
}

function step(s: FollowUpState, e: FollowUpEvent): { state: MachineState; effects: FollowUpEffect[] } {
  const st = s as MachineState;
  const tl = (kind: TimelineKind, text: string, t: SessionTime): FollowUpEffect => ({ type: "timeline", kind, text, t });

  if (e.type === "question_started") {
    return {
      state: initialFollowUp(e.questionId, e.t),
      effects: [tl("question", e.label ? `Question started — ${e.label}` : "Question started", e.t)],
    };
  }
  if (isTerminal(st.phase)) return unchanged(s);

  const open = (momentId: string, hit: GateHit | null, flagId?: string): FollowUpEffect => ({
    type: "open_moment",
    momentId,
    hit,
    ...(flagId !== undefined ? { flagId } : {}),
    followUpNumber: st.used + 1,
    final: st.used + 1 === MAX_FOLLOW_UPS,
  });

  switch (st.phase) {
    case "observing": {
      if (st.used >= MAX_FOLLOW_UPS) break;
      if (e.type === "gate_hit") {
        return {
          state: { ...st, phase: "worth_exploring", momentId: e.momentId, reObserveUntil: null },
          effects: [open(e.momentId, e.hit), tl("moment", `Moment worth exploring — ${KIND_TEXT[e.hit.kind]}`, e.t)],
        };
      }
      if (e.type === "explore") {
        return {
          state: { ...st, phase: "worth_exploring", momentId: e.momentId, reObserveUntil: null },
          effects: [open(e.momentId, null, e.flagId), tl("moment", "Moment worth exploring — opened from Flag Details", e.t)],
        };
      }
      break;
    }

    case "worth_exploring":
    case "persisting": {
      const momentId = st.momentId!;
      if (e.type === "ask") {
        if (st.used >= MAX_FOLLOW_UPS) break;
        const used = st.used + 1;
        const next: MachineState = {
          ...st,
          phase: "re_observing",
          used,
          reObserveUntil: e.t + RULES.followUp.reObserveMs,
          watchFrom: e.t,
          momentId: null,
          askedMomentId: momentId,
        };
        return {
          state: next,
          effects: [
            { type: "moment_decision", momentId, decision: "asked", t: e.t },
            tl("follow-up-asked", `Follow-up asked (${used} / ${MAX_FOLLOW_UPS})`, e.t),
          ],
        };
      }
      if (e.type === "continue") {
        return {
          state: { ...st, phase: "observing", watchFrom: e.t, momentId: null, reObserveUntil: null },
          effects: [{ type: "moment_decision", momentId, decision: "continued", t: e.t }, tl("continued", "Continued", e.t)],
        };
      }
      if (e.type === "dismiss") {
        return {
          state: { ...st, phase: "dismissed", momentId: null, reObserveUntil: null },
          effects: [
            { type: "moment_decision", momentId, decision: "dismissed", t: e.t },
            tl("dismissed", "Suggestions dismissed for this Question", e.t),
          ],
        };
      }
      break;
    }

    case "re_observing": {
      const asked = st.askedMomentId ?? null;
      const result = (r: "settled" | "persisting"): FollowUpEffect[] => (asked ? [{ type: "moment_result", momentId: asked, result: r }] : []);
      const windowOver = st.reObserveUntil !== null && e.t >= st.reObserveUntil;
      // A trigger at or after the end of the window arrives too late: the window settled first.
      if ((e.type === "tick" || e.type === "gate_hit") && windowOver) {
        return {
          state: { ...st, phase: "settled", reObserveUntil: null, momentId: null, askedMomentId: null },
          effects: [...result("settled"), tl("settled", "Observation settled", e.t)],
        };
      }
      if (e.type === "gate_hit") {
        if (st.used < MAX_FOLLOW_UPS) {
          return {
            state: { ...st, phase: "persisting", momentId: e.momentId, reObserveUntil: null, askedMomentId: null },
            effects: [...result("persisting"), open(e.momentId, e.hit), tl("persisting", "Pattern continues", e.t)],
          };
        }
        return {
          state: { ...st, phase: "limit_reached", momentId: null, reObserveUntil: null, askedMomentId: null },
          effects: [...result("persisting"), tl("limit-reached", "Follow-up limit reached", e.t)],
        };
      }
      break;
    }
  }

  if (DEV_LOG && e.type !== "tick") console.debug(`followUp: ignored ${e.type} in ${st.phase}`);
  return unchanged(s);
}

/** Which events the UI may send in this phase (buttons render from this, so UI and logic can't drift). */
export function allowedActions(s: FollowUpState): FollowUpAction[] {
  switch (s.phase) {
    case "worth_exploring":
    case "persisting":
      return s.used < MAX_FOLLOW_UPS ? ["ask", "continue", "dismiss"] : ["continue", "dismiss"];
    case "settled":
    case "limit_reached":
      return ["next_question"];
    default:
      return [];
  }
}

/** Invariants (BUILD_PLAN M2.3). Returns the first one broken, or null. Used by tests and dev assertions. */
export function checkFollowUpInvariants(s: FollowUpState): string | null {
  if (!(s.used >= 0 && s.used <= MAX_FOLLOW_UPS)) return `used out of range: ${s.used}`;
  const needsMoment = s.phase === "worth_exploring" || s.phase === "persisting";
  if ((s.momentId !== null) !== needsMoment) return `momentId ${s.momentId} in ${s.phase}`;
  if ((s.reObserveUntil !== null) !== (s.phase === "re_observing")) return `reObserveUntil ${s.reObserveUntil} in ${s.phase}`;
  return null;
}
