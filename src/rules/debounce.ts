import type { SessionTime } from "../domain/types";

export type Transition = { state: "start" | "end"; t: SessionTime } | null;

/** Turns a noisy per-frame condition into start/end transitions that must hold for onMs / offMs. */
export class DebouncedCondition {
  private active = false;
  private since: SessionTime | null = null;

  constructor(
    private readonly onMs: number,
    private readonly offMs: number,
  ) {}

  update(t: SessionTime, condition: boolean): Transition {
    if (condition === this.active) {
      this.since = null;
      return null;
    }
    this.since ??= t;
    const needed = this.active ? this.offMs : this.onMs;
    if (t - this.since < needed) return null;
    this.active = condition;
    const at = this.since;
    this.since = null;
    return { state: condition ? "start" : "end", t: at };
  }

  get isActive() {
    return this.active;
  }
}
