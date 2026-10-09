import { useStore } from "../store/session";

type Tone = "ok" | "warn" | "idle";

const TONES: Record<Tone, string> = {
  ok: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  warn: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  idle: "bg-zinc-800 text-zinc-400 ring-zinc-700",
};

const Pill = ({ tone, title, children }: { tone: Tone; title?: string; children: React.ReactNode }) => (
  <span title={title} className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ring-1 transition-colors duration-200 ${TONES[tone]}`}>
    {children}
  </span>
);

/** Status on every screen: vision, fps, speech context, local LLM + model + latency, lightweight mode, online. */
export function StatusBar() {
  const vision = useStore((s) => s.vision);
  const llm = useStore((s) => s.llm);
  const model = useStore((s) => s.llmModel);
  const latency = useStore((s) => s.llmLatencyMs);
  const lightweight = useStore((s) => s.lightweight);
  const online = useStore((s) => s.online);
  const running = useStore((s) => !!s.session && !s.session.endedAt);
  const fps = useStore((s) => (s.session && !s.session.endedAt ? Math.round(s.fps) : null));
  const speech = useStore((s) => s.speech);
  const hasSource = useStore((s) => running || !!s.sourceReady);

  const latencyText = latency !== null ? ` · ${(latency / 1000).toFixed(1)} s` : "";

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Status">
      {vision.status === "loading" && <Pill tone="idle">Vision model loading…</Pill>}
      {vision.status === "ready" && <Pill tone="ok">Vision on {vision.delegate}</Pill>}
      {vision.status === "error" && (
        <Pill tone="idle" title={vision.message}>
          Vision unavailable
        </Pill>
      )}
      {fps !== null && <Pill tone={fps >= 20 ? "ok" : "idle"}>{fps} fps</Pill>}
      {hasSource && (speech === "unavailable" ? <Pill tone="idle">Speech context unavailable</Pill> : <Pill tone="ok">Speech context: on</Pill>)}
      {llm === "ready" && <Pill tone="ok">{model ? `${model}${latencyText}` : "Local LLM ready"}</Pill>}
      {llm === "busy" && <Pill tone="ok">{model ?? "Local LLM"} writing…</Pill>}
      {llm === "unavailable" && (
        <Pill tone="idle" title="Flags and template follow-ups still work. Start Ollama for written suggestions.">
          Local LLM unavailable
        </Pill>
      )}
      {llm === "unknown" && <Pill tone="idle">Checking local LLM…</Pill>}
      {lightweight && (
        <Pill tone="idle" title="A smaller local model is in use to keep suggestions quick.">
          Lightweight mode
        </Pill>
      )}
      <Pill tone={online ? "idle" : "ok"}>{online ? "Online" : "Offline · everything runs on this laptop"}</Pill>
    </div>
  );
}
