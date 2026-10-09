import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeWav, stripNonSpeech, transcribe, whisperStatus } from "./whisperClient";
import { WHISPER_MODEL } from "./config";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encodeWav", () => {
  it("writes a 16-bit mono 16 kHz PCM header and clamped samples", () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    const v = new DataView(buf);
    const str = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(buf.byteLength).toBe(44 + 12);
    expect(str(0)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(36 + 12);
    expect(str(8)).toBe("WAVE");
    expect(str(12)).toBe("fmt ");
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(str(36)).toBe("data");
    expect(v.getUint32(40, true)).toBe(12);
    const samples = [0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
});

describe("stripNonSpeech", () => {
  it.each([
    ["[BLANK_AUDIO]", ""],
    [" (music) ", ""],
    ["[ Silence ]", ""],
    ["*laughs*", ""],
    [" Tell me about a project. [BLANK_AUDIO]", "Tell me about a project."],
    ["(upbeat music) I worked on   a web app.\n", "I worked on a web app."],
  ])("%j -> %j", (input, out) => {
    expect(stripNonSpeech(input)).toBe(out);
  });
});

describe("transcribe", () => {
  it("posts multipart WAV to /whisper/inference and returns cleaned text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ text: " Hello there. [BLANK_AUDIO]\n" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(transcribe(new Float32Array(1600))).resolves.toBe("Hello there.");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/whisper/inference");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("response_format")).toBe("json");
    expect(form.get("temperature")).toBe("0");
    expect((form.get("file") as Blob).size).toBe(44 + 3200);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns empty string for silence-only output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ text: "[ Silence ]" })));
    await expect(transcribe(new Float32Array(10))).resolves.toBe("");
  });

  it("skips the request for empty audio", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(transcribe(new Float32Array(0))).resolves.toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on HTTP errors, server errors, bad bodies and network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 500 })));
    await expect(transcribe(new Float32Array(10))).rejects.toThrow(/500/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "failed to read WAV file" })));
    await expect(transcribe(new Float32Array(10))).rejects.toThrow(/WAV/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({})));
    await expect(transcribe(new Float32Array(10))).rejects.toThrow(/no text/);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(transcribe(new Float32Array(10))).rejects.toThrow(/fetch failed/);
  });

  it("aborts when the caller signal aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_r, reject) => {
            init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
          }),
      ),
    );
    const ctl = new AbortController();
    const p = transcribe(new Float32Array(10), ctl.signal);
    ctl.abort(new Error("cancelled"));
    await expect(p).rejects.toThrow(/cancelled/);
  });
});

describe("whisperStatus", () => {
  it("reports available with the configured model when /health is ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(whisperStatus()).resolves.toEqual({ available: true, model: WHISPER_MODEL });
    expect(fetchMock.mock.calls[0][0]).toBe("/whisper/health");
  });

  it("falls back to / when /health is missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(whisperStatus()).resolves.toEqual({ available: true, model: WHISPER_MODEL });
    expect(fetchMock.mock.calls[1][0]).toBe("/whisper/");
  });

  it("never throws: unreachable or failing server is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED")));
    await expect(whisperStatus()).resolves.toEqual({ available: false, model: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 502 })));
    await expect(whisperStatus()).resolves.toEqual({ available: false, model: null });
  });
});
