import { useEffect, useRef, useState } from "react";
import { currentCrop, live, resetBaseline, setCrop, video } from "../app/controller";
import { FLAG_LABELS } from "../domain/types";
import { useStore } from "../store/session";
import type { CropRect } from "../vision/pipeline";

const EYE_POINTS = [33, 133, 159, 145, 362, 263, 386, 374, 468, 473];

/** Live video with landmark overlay, active-Flag chips and (in window mode) a drag-to-select crop box. */
export function VideoPanel() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [selecting, setSelecting] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [crop, setCropState] = useState<CropRect | null>(currentCrop());
  const source = useStore((s) => s.session?.source);
  const progress = useStore((s) => s.baselineProgress);
  const active = useStore((s) => s.session?.flags.filter((f) => f.end === null) ?? []);
  const mirrored = source === "webcam";

  useEffect(() => {
    host.current?.prepend(video);
    const sync = () => video.videoWidth && setAspect(video.videoWidth / video.videoHeight);
    sync();
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("resize", sync);
    return () => {
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("resize", sync);
      video.remove();
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const { clientWidth: w, clientHeight: h } = c;
      if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      const r = live.crop ?? { left: 0, top: 0, right: 1, bottom: 1 };
      const toX = (x: number) => (r.left + x * (r.right - r.left)) * w;
      const toY = (y: number) => (r.top + y * (r.bottom - r.top)) * h;
      for (const face of live.result?.faceLandmarks ?? []) {
        ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
        for (const i of EYE_POINTS) {
          const p = face[i];
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(toX(p.x), toY(p.y), i >= 468 ? 3 : 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        const xs = face.map((p) => p.x);
        const ys = face.map((p) => p.y);
        ctx.strokeStyle = "rgba(52, 211, 153, 0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(toX(Math.min(...xs)), toY(Math.min(...ys)), toX(Math.max(...xs)) - toX(Math.min(...xs)), toY(Math.max(...ys)) - toY(Math.min(...ys)));
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  const point = (e: React.PointerEvent) => {
    const b = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(Math.max((e.clientX - b.left) / b.width, 0), 1), y: Math.min(Math.max((e.clientY - b.top) / b.height, 0), 1) };
  };

  const commitCrop = (next: CropRect | null) => {
    setCrop(next);
    setCropState(next);
    setSelecting(false);
    setDrag(null);
  };

  const shown = drag
    ? { left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), right: Math.max(drag.x0, drag.x1), bottom: Math.max(drag.y0, drag.y1) }
    : crop;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: aspect, maxHeight: "62vh" }}>
        <div ref={host} className="absolute inset-0" style={mirrored ? { transform: "scaleX(-1)" } : undefined}>
          <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
        </div>

        {shown && (
          <div
            className="pointer-events-none absolute border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{ left: `${shown.left * 100}%`, top: `${shown.top * 100}%`, width: `${(shown.right - shown.left) * 100}%`, height: `${(shown.bottom - shown.top) * 100}%` }}
          />
        )}

        {selecting && (
          <div
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = point(e);
              setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }}
            onPointerMove={(e) => drag && setDrag({ ...drag, x1: point(e).x, y1: point(e).y })}
            onPointerUp={() => {
              if (shown && shown.right - shown.left > 0.05 && shown.bottom - shown.top > 0.05) commitCrop(shown);
              else setDrag(null);
            }}
          />
        )}

        <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-2">
          {progress < 1 && (
            <div className="enter rounded-lg bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
              Learning the candidate's normal gaze… {Math.round(progress * 100)}%
              <div className="mt-1.5 h-1 w-40 overflow-hidden rounded bg-zinc-800">
                <div className="h-full origin-left bg-emerald-400 transition-transform duration-100 ease-linear" style={{ transform: `scaleX(${progress})` }} />
              </div>
            </div>
          )}
          {active.map((f) => (
            <div key={f.id} className="enter flex items-center gap-2 rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-black/30">
              <span className="size-1.5 animate-pulse rounded-full bg-zinc-950" />
              {FLAG_LABELS[f.kind]}
            </div>
          ))}
        </div>
        {selecting && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-950/85 px-3 py-1.5 text-sm">
            Drag a box around the candidate's video tile
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {source === "window" && (
          <>
            <button type="button" onClick={() => setSelecting((v) => !v)} className="press rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500">
              {selecting ? "Cancel selection" : crop ? "Reselect candidate tile" : "Select candidate tile"}
            </button>
            {crop && (
              <button type="button" onClick={() => commitCrop(null)} className="press rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500">
                Use whole window
              </button>
            )}
          </>
        )}
        <button type="button" onClick={resetBaseline} className="press rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500">
          Reset baseline
        </button>
      </div>
    </div>
  );
}
