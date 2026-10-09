import { describe, expect, it } from "vitest";
import type { Flag, FlagKind } from "../domain/types";
import { findBanned } from "../llm/guard";
import { DISCLAIMER, describeCentre, explainFlag } from "./explain";

const baseline = { centreX: 0.5, centreY: -3, spreadX: 3.1, spreadY: 2.4 };

const flags: Record<FlagKind, Flag> = {
  "off-screen": {
    id: "f1",
    kind: "off-screen",
    start: 42_000,
    end: 46_000,
    questionId: "q1",
    evidence: { baseline, thresholdDeg: { x: 10, y: 10 }, peakDeviationDeg: 18, direction: "right" },
  },
  "reading-pattern": {
    id: "f2",
    kind: "reading-pattern",
    start: 60_000,
    end: 72_000,
    questionId: "q1",
    evidence: { baseline, cycles: 5 },
  },
  "face-missing": { id: "f3", kind: "face-missing", start: 90_000, end: 93_000, questionId: "q2" },
  "second-face": { id: "f4", kind: "second-face", start: 100_000, end: null, questionId: "q2", evidence: { faceCount: 2 } },
};

const allText = (e: ReturnType<typeof explainFlag>) =>
  [e.title, e.meta, e.observation, e.baseline, e.observed, e.threshold, e.disclaimer].filter(Boolean).join(" ");

describe("explainFlag", () => {
  for (const [kind, flag] of Object.entries(flags)) {
    it(`explains ${kind} with a duration and no banned words`, () => {
      const e = explainFlag(flag, 105_000);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.observation).toMatch(/about \d+ seconds?/);
      expect(e.meta).toMatch(/\d+:\d\d · \d+ s/);
      expect(e.threshold.length).toBeGreaterThan(0);
      expect(e.disclaimer).toBe(DISCLAIMER);
      expect(findBanned(allText(e))).toEqual([]);
    });
  }

  it("matches the FR-009 off-screen example", () => {
    const e = explainFlag(flags["off-screen"], 50_000);
    expect(e.title).toBe("LOOKING OFF-SCREEN");
    expect(e.meta).toBe("0:42 · 4 s");
    expect(e.observation).toBe("The Candidate's gaze moved outside their usual gaze range for about 4 seconds.");
    expect(e.baseline).toBe("normal gaze slightly below centre (±3.1° × ±2.4°)");
    expect(e.observed).toBe("gaze moved to the right, up to 18° from centre");
    expect(e.threshold).toContain("10° sideways / 10° vertical");
  });

  it("marks ongoing Flags as so far, using now", () => {
    const e = explainFlag(flags["second-face"], 103_000);
    expect(e.meta).toBe("1:40 · 3 s so far");
    expect(e.observation).toContain("so far");
    expect(e.observed).toBe("up to 2 faces in view");
  });

  it("copes with a Flag without evidence", () => {
    const e = explainFlag({ id: "x", kind: "off-screen", start: 0, end: 2000, questionId: null }, 2000);
    expect(e.baseline).toBeNull();
    expect(e.threshold.length).toBeGreaterThan(0);
  });
});

describe("describeCentre", () => {
  it("says near centre for a centred baseline", () => {
    expect(describeCentre({ centreX: 0, centreY: 1, spreadX: 3, spreadY: 3 })).toBe("normal gaze near centre (±3° × ±3°)");
  });
  it("combines vertical and horizontal offsets", () => {
    expect(describeCentre({ centreX: -8, centreY: 4, spreadX: 3, spreadY: 3 })).toBe("normal gaze slightly above and left of centre (±3° × ±3°)");
  });
});
