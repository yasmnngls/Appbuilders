import { useStore } from "../store/session";

const Pill = ({ tone, children }: { tone: "ok" | "warn" | "bad" | "idle"; children: React.ReactNode }) => {
  const tones = {
    ok: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    warn: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    bad: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
    idle: "bg-zinc-800 text-zinc-400 ring-zinc-700",
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${tones[tone]}`}>{children}</span>;
};

export function StatusBar() {
  const vision = useStore((s) => s.vision);
  const llm = useStore((s) => s.llm);
  const online = useStore((s) => s.online);
  const fps = useStore((s) => (s.session && !s.session.endedAt ? s.fps : null));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {vision.status === "loading" && <Pill tone="idle">Vision model loading…</Pill>}
      {vision.status === "ready" && <Pill tone="ok">Vision on {vision.delegate}</Pill>}
      {vision.status === "error" && <Pill tone="bad">Vision failed</Pill>}
      {fps !== null && <Pill tone={fps >= 20 ? "ok" : "warn"}>{fps.toFixed(0)} fps</Pill>}
      {llm === "ready" && <Pill tone="ok">Local LLM ready</Pill>}
      {llm === "busy" && <Pill tone="ok">Local LLM writing…</Pill>}
      {llm === "unavailable" && <Pill tone="warn">Local LLM unavailable</Pill>}
      {llm === "unknown" && <Pill tone="idle">Checking local LLM…</Pill>}
      <Pill tone={online ? "idle" : "ok"}>{online ? "Online" : "Offline · everything runs on this laptop"}</Pill>
    </div>
  );
}
