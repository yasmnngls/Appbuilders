import { useEffect } from "react";
import { preload } from "./app/controller";
import { useStore } from "./store/session";
import { LiveScreen } from "./ui/LiveScreen";
import { ReportScreen } from "./ui/ReportScreen";
import { SetupScreen } from "./ui/SetupScreen";
import { StatusBar } from "./ui/StatusBar";

export default function App() {
  useEffect(preload, []);
  const phase = useStore((s) => (!s.session ? "setup" : s.session.endedAt ? "report" : "live"));

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">Gazewise</span>
          <span className="text-sm text-zinc-400">On-device interview observations</span>
        </div>
        <StatusBar />
      </header>
      <main className="min-h-0 flex-1">
        {phase === "setup" && <SetupScreen />}
        {phase === "live" && <LiveScreen />}
        {phase === "report" && <ReportScreen />}
      </main>
    </div>
  );
}
