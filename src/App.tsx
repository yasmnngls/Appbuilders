import { useEffect } from "react";
import { preload } from "./app/controller";
import { selectScreen, useStore } from "./store/session";
import { ConsentScreen } from "./ui/ConsentScreen";
import { LiveScreen } from "./ui/LiveScreen";
import { ReportScreen } from "./ui/ReportScreen";
import { SourceScreen } from "./ui/SourceScreen";
import { StatusBar } from "./ui/StatusBar";

export default function App() {
  useEffect(preload, []);
  const screen = useStore(selectScreen);
  // Baseline (Screen 3) and Live (Screen 4) share the video panel, so they share one mount:
  // no remount of the video and no screen transition when the Baseline completes.
  const mount = screen === "baseline" || screen === "live" ? "session" : screen;
  const processing = mount === "session";

  return (
    <div className="flex h-full flex-col">
      <header className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">Gazewise</span>
          <span className="hidden text-sm text-zinc-400 sm:inline">Interview assistant</span>
          {processing && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-300">
              <span aria-hidden className="size-2 rounded-full bg-emerald-400" />
              Processing locally
            </span>
          )}
        </div>
        <StatusBar />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div key={mount} className="screen-enter h-full">
          {screen === "consent" && <ConsentScreen />}
          {screen === "source" && <SourceScreen />}
          {mount === "session" && <LiveScreen />}
          {screen === "report" && <ReportScreen />}
        </div>
      </main>
    </div>
  );
}
