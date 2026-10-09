import { beforeEach, describe, expect, it } from "vitest";
import { applyTransitions, clearSession, confirmConsent, dismissFlag, nextQuestion, startSession, store } from "../store/session";
import { exploreFlag, openSource, startBaseline } from "./controller";

beforeEach(() => clearSession());

describe("consent gate (FR-001)", () => {
  it("opens no Source and starts no Session before Consent", async () => {
    await expect(openSource("webcam")).rejects.toThrow(/Consent/);
    store.set({ sourceReady: { kind: "webcam", hasAudio: false } });
    startBaseline();
    expect(store.get().session).toBeNull();
  });
});

describe("exploreFlag", () => {
  const live = () => {
    confirmConsent("Ana");
    startSession({ source: "webcam", speechAvailable: false, llmModel: null });
  };
  const flag = (t: number) => {
    applyTransitions([{ kind: "reading-pattern", state: "start", t }]);
    return store.get().session!.flags.at(-1)!.id;
  };
  const phase = () => store.get().session!.followUp.phase;

  it("ignores unknown, dismissed and earlier-Question Flags", () => {
    live();
    exploreFlag("nope");
    expect(phase()).toBe("observing");
    const dismissed = flag(0);
    dismissFlag(dismissed);
    exploreFlag(dismissed);
    expect(phase()).toBe("observing");
    const earlier = flag(0);
    nextQuestion("Q2");
    store.set({ session: { ...store.get().session!, followUp: { ...store.get().session!.followUp, questionId: store.get().session!.questions[1].id } } });
    exploreFlag(earlier);
    expect(phase()).toBe("observing");
    expect(store.get().session!.moments).toHaveLength(0);
    const current = flag(60_000);
    exploreFlag(current);
    expect(phase()).toBe("worth_exploring");
    expect(store.get().session!.moments[0].flagIds).toEqual([current]);
  });
});
