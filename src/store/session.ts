import { useRef, useSyncExternalStore } from "react";
import type { FlagTransition } from "../rules/engine";
import type { Flag, InterviewerNote, Question, Session, SessionReport, Signal } from "../domain/types";

/** Live, non-persisted app state. Vision code writes; React reads via useStore (throttled). */
export interface LiveState {
  session: Session | null;
  latestSignal: Signal | null;
  fps: number;
  baselineProgress: number;
  llm: "unknown" | "ready" | "busy" | "unavailable";
  vision: { status: "loading" } | { status: "ready"; delegate: "GPU" | "CPU" } | { status: "error"; message: string };
  reportStatus: "idle" | "generating" | "done" | "fallback";
  online: boolean;
}

let state: LiveState = {
  session: null,
  latestSignal: null,
  fps: 0,
  baselineProgress: 0,
  llm: "unknown",
  vision: { status: "loading" },
  reportStatus: "idle",
  online: typeof navigator === "undefined" ? true : navigator.onLine,
};

const listeners = new Set<() => void>();
let scheduled = false;

/** Notify subscribers at most ~10x per second so 30fps vision updates never thrash React. */
function emit() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    listeners.forEach((l) => l());
  }, 100);
}

export const store = {
  get: () => state,
  set(patch: Partial<LiveState>) {
    state = { ...state, ...patch };
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const shallowEqual = (a: unknown, b: unknown) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.is((a as never)[k], (b as never)[k]));
};

/** Subscribe to a slice of state. Derived arrays/objects are fine: results are compared shallowly. */
export function useStore<T>(select: (s: LiveState) => T): T {
  const last = useRef<{ value: T } | null>(null);
  return useSyncExternalStore(store.subscribe, () => {
    const next = select(state);
    if (last.current && shallowEqual(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  });
}

const uid = () => Math.random().toString(36).slice(2, 10);

function updateSession(fn: (s: Session) => Session) {
  if (state.session) store.set({ session: fn(state.session) });
}

export function startSession(input: { candidateName: string; source: Session["source"]; consentAt: number }) {
  const now = Date.now();
  store.set({
    session: {
      ...input,
      startedAt: now,
      endedAt: null,
      baseline: null,
      questions: [{ id: uid(), number: 1, label: "Introduction", start: 0 }],
      flags: [],
      notes: [],
      report: null,
    },
  });
}

/** Milliseconds since the Session started. */
export const sessionNow = () => (state.session ? Date.now() - state.session.startedAt : 0);

export const currentQuestion = (s: Session): Question => s.questions[s.questions.length - 1];

export function nextQuestion(label?: string) {
  updateSession((s) => {
    const number = s.questions.length + 1;
    return { ...s, questions: [...s.questions, { id: uid(), number, label: label?.trim() || `Question ${number}`, start: sessionNow() }] };
  });
}

export function applyTransitions(transitions: FlagTransition[]) {
  if (!transitions.length) return;
  updateSession((s) => {
    let flags = s.flags;
    for (const tr of transitions) {
      if (tr.state === "start") {
        const q = [...s.questions].reverse().find((q) => q.start <= tr.t) ?? currentQuestion(s);
        const flag: Flag = { id: uid(), kind: tr.kind, start: tr.t, end: null, questionId: q.id, detail: tr.detail };
        flags = [...flags, flag];
      } else {
        flags = flags.map((f) => (f.kind === tr.kind && f.end === null ? { ...f, end: tr.t } : f));
      }
    }
    return { ...s, flags };
  });
}

export function addNote(note: Omit<InterviewerNote, "id">) {
  updateSession((s) => ({ ...s, notes: [...s.notes, { ...note, id: uid() }] }));
}

export function setBaseline(baseline: Session["baseline"]) {
  updateSession((s) => ({ ...s, baseline }));
}

export function endSession() {
  const t = sessionNow();
  updateSession((s) => ({
    ...s,
    endedAt: Date.now(),
    flags: s.flags.map((f) => (f.end === null ? { ...f, end: t } : f)),
  }));
}

export function setReport(report: SessionReport) {
  updateSession((s) => ({ ...s, report }));
}

export function clearSession() {
  store.set({ session: null, latestSignal: null, baselineProgress: 0, reportStatus: "idle" });
}
