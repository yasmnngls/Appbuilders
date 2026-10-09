import { describe, expect, it } from "vitest";
import { ASR_RATE, Downsampler, downsampleTo16k, isNonSpeech, TranscribeQueue, UTTERANCE, UtteranceSegmenter, type Utterance } from "./utterances";

/** Synthetic 16 kHz audio: [ms, amplitude] parts; amplitude 0 = faint noise floor, else a 220 Hz tone. */
function audio(parts: [number, number][]): Float32Array {
  const total = parts.reduce((n, [ms]) => n + (ms * ASR_RATE) / 1000, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const [ms, amp] of parts) {
    const n = (ms * ASR_RATE) / 1000;
    for (let i = 0; i < n; i++, o++) out[o] = amp ? amp * Math.sin((2 * Math.PI * 220 * o) / ASR_RATE) : 0.001 * Math.sin(o * 1.3);
  }
  return out;
}

function segment(parts: [number, number][], chunk = 4096): Utterance[] {
  const seg = new UtteranceSegmenter(0);
  const pcm = audio(parts);
  const out: Utterance[] = [];
  for (let i = 0; i < pcm.length; i += chunk) out.push(...seg.pushSamples(pcm.subarray(i, i + chunk)));
  out.push(...seg.flush());
  return out;
}

describe("Downsampler", () => {
  it("48 kHz → 16 kHz keeps length and level", () => {
    const x = new Float32Array(48_000).fill(0.5);
    const y = downsampleTo16k(x, 48_000);
    expect(y.length).toBe(16_000);
    expect(y.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });

  it("44.1 kHz in odd chunks neither drops nor duplicates samples", () => {
    const d = new Downsampler(44_100);
    let n = 0;
    for (let i = 0; i < 100; i++) n += d.push(new Float32Array(441 + (i % 7))).length;
    const inTotal = Array.from({ length: 100 }, (_, i) => 441 + (i % 7)).reduce((a, b) => a + b, 0);
    expect(Math.abs(n - (inTotal * 16_000) / 44_100)).toBeLessThanOrEqual(1);
  });

  it("16 kHz passes through unchanged", () => {
    const x = Float32Array.from([0.1, -0.2, 0.3]);
    expect(Array.from(downsampleTo16k(x, 16_000))).toEqual(Array.from(x));
  });
});

describe("UtteranceSegmenter", () => {
  it("emits one utterance with pre-roll and post-roll around speech", () => {
    const [u, ...rest] = segment([[2000, 0], [1500, 0.3], [1500, 0]]);
    expect(rest).toHaveLength(0);
    // Speech 2000..3500 ms: starts ~300 ms before onset, ends ~300 ms after the release.
    expect(u.start).toBeGreaterThanOrEqual(2000 - UTTERANCE.PRE_ROLL_MS - 60);
    expect(u.start).toBeLessThanOrEqual(2000 - UTTERANCE.PRE_ROLL_MS + 60);
    expect(u.end).toBeGreaterThanOrEqual(3500 + UTTERANCE.POST_ROLL_MS - 60);
    expect(u.end).toBeLessThanOrEqual(3500 + UTTERANCE.POST_ROLL_MS + 60);
    expect(u.pcm.length).toBe(((u.end - u.start) * ASR_RATE) / 1000);
  });

  it("drops speech shorter than the minimum", () => {
    expect(segment([[2000, 0], [300, 0.3], [1500, 0]])).toHaveLength(0);
  });

  it("cuts long speech at the maximum length and continues", () => {
    const us = segment([[1000, 0], [20_000, 0.3], [1500, 0]]);
    expect(us).toHaveLength(2);
    expect(us[0].end - us[0].start).toBe(UTTERANCE.MAX_MS);
    expect(us[1].start).toBe(us[0].end);
    expect(us[1].end).toBeGreaterThan(21_000);
  });

  it("separates two utterances with a pause between them", () => {
    expect(segment([[1000, 0], [1000, 0.3], [1500, 0], [1000, 0.3], [1500, 0]])).toHaveLength(2);
  });

  it("flush emits speech still in progress", () => {
    const us = segment([[1000, 0], [2000, 0.3]]);
    expect(us).toHaveLength(1);
    expect(us[0].end).toBe(3000);
  });

  it("reports speaking while the tone is on", () => {
    const seg = new UtteranceSegmenter(0);
    seg.pushSamples(audio([[1000, 0], [500, 0.3]]));
    expect(seg.speaking).toBe(true);
    seg.pushSamples(audio([[1000, 0]]));
    expect(seg.speaking).toBe(false);
  });
});

describe("TranscribeQueue", () => {
  const deferred = () => {
    let resolve!: () => void;
    const p = new Promise<void>((r) => (resolve = r));
    return { p, resolve };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("runs one job at a time, in order", async () => {
    const started: number[] = [];
    const gates = new Map<number, ReturnType<typeof deferred>>();
    const q = new TranscribeQueue<number>((j) => {
      started.push(j);
      const d = deferred();
      gates.set(j, d);
      return d.p;
    });
    q.enqueue(1);
    q.enqueue(2);
    expect(started).toEqual([1]);
    gates.get(1)!.resolve();
    await flush();
    expect(started).toEqual([1, 2]);
  });

  it("drops the oldest waiting job when more than 3 are waiting", async () => {
    const started: number[] = [];
    const gates: (() => void)[] = [];
    const q = new TranscribeQueue<number>((j) => {
      started.push(j);
      return new Promise<void>((r) => gates.push(r));
    });
    for (let i = 1; i <= 6; i++) q.enqueue(i); // 1 runs; 2..6 wait → 2 and 3 dropped
    expect(q.dropped).toBe(2);
    for (let k = 0; k < 4; k++) {
      gates[k]();
      await flush();
    }
    expect(started).toEqual([1, 4, 5, 6]);
  });

  it("keeps going after a failed job and stop() aborts", async () => {
    const started: number[] = [];
    let seen: AbortSignal | null = null;
    const q = new TranscribeQueue<number>(async (j, signal) => {
      started.push(j);
      seen = signal;
      if (j === 1) throw new Error("boom");
      await new Promise(() => {});
    });
    q.enqueue(1);
    q.enqueue(2);
    await flush();
    expect(started).toEqual([1, 2]);
    q.stop();
    expect(seen!.aborted).toBe(true);
    q.enqueue(3);
    await flush();
    expect(started).toEqual([1, 2]);
  });
});

describe("isNonSpeech", () => {
  it("filters whisper's non-speech markers", () => {
    expect(isNonSpeech("[BLANK_AUDIO]")).toBe(true);
    expect(isNonSpeech(" (music) ")).toBe(true);
    expect(isNonSpeech("Tell me about your last project.")).toBe(false);
  });
});
