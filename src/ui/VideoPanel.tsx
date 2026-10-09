import { useEffect, useRef, useState } from "react";
import { currentCrop, live, setCrop, video } from "../app/controller";
import { FLAG_LABELS } from "../domain/types";
import { selectScreen, useStore } from "../store/session";
import type { CropRect } from "../vision/pipeline";

const EYE_POINTS = [33, 133, 159, 145, 362, 263, 386, 374, 468, 473];

/**
 * Live video with landmark overlay, ongoing-Flag chips, the Baseline overlay (Screen 3) and, in window mode,
 * a drag-to-select crop box. Used for the Source preview (Screen 2) and the Session (Screens 3-4).
 */
export function VideoPanel({ maxHeight = "62vh" }: { maxHeight?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [selecting, setSelecting] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [crop, setCropState] = useState<CropRect | null>(currentCrop());
  const source = useStore((s) => s.session?.source ?? s.sourceReady?.kind);
  const active = useStore((s) => s.session?.flags.filter((f) => f.end === null && !f.dismissed) ?? []);
  const inSession = useStore((s) => s.session !== null);
  const mirrored = source === "webcam";

  useEffect(() => {
    host.current?.prepend(video);
    // Moving the element between screens can pause it; resume if it has a source.
    if ((video.srcObject || video.src) && video.paused) video.play().catch(() => {});
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

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (setSelecting(false), setDrag(null));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

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
      <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: aspect, maxHeight }}>
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

        {inSession && <BaselineOverlay />}

        {active.length > 0 && (
          <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2" aria-live="polite">
            {active.map((f) => (
              <div key={f.id} className="card-enter flex items-center gap-2 rounded-lg bg-zinc-950/80 px-3 py-1.5 text-sm text-zinc-100 ring-1 ring-amber-400/40">
                <span aria-hidden className="size-1.5 rounded-full bg-amber-400" />
                {FLAG_LABELS[f.kind]}
              </div>
            ))}
          </div>
        )}
        {selecting && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-950/85 px-3 py-1.5 text-sm">
            Drag a box around the Candidate's video tile · Esc to cancel
          </div>
        )}
      </div>

      {source === "window" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSelecting((v) => !v)} className="press rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500">
            {selecting ? "Cancel selection" : crop ? "Reselect Candidate tile" : "Select Candidate tile"}
          </button>
          {crop && (
            <button type="button" onClick={() => commitCrop(null)} className="press rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-zinc-500">
              Use whole window
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const READY_MS = 1500;
const NO_FACE_HINT_MS = 5000;

/** Screen 3 (FR-004): shown over the video while the Baseline is learned, then "Baseline ready ✓" for 1.5 s. */
function BaselineOverlay() {
  const learning = useStore((s) => selectScreen(s) === "baseline");
  const progress = useStore((s) => s.baselineProgress);
  const justCompleted = useStore((s) => s.baselineJustCompleted);
  const faceSeen = useStore((s) => (s.latestSignal?.faceCount ?? 0) > 0);
  const [ready, setReady] = useState<"hidden" | "shown" | "fading">("hidden");
  const lastFace = useRef(Date.now());
  const [noFace, setNoFace] = useState(false);

  // "Baseline ready ✓" for 1.5 s, then fade. Timed here too so it never sticks if the flag isn't cleared.
  useEffect(() => {
    if (!justCompleted) return;
    setReady("shown");
    const a = setTimeout(() => setReady("fading"), READY_MS);
    const b = setTimeout(() => setReady("hidden"), READY_MS + 300);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [justCompleted]);

  useEffect(() => {
    if (faceSeen) lastFace.current = Date.now();
  }, [faceSeen]);

  useEffect(() => {
    if (!learning) return setNoFace(false);
    lastFace.current = Date.now();
    const id = setInterval(() => setNoFace(Date.now() - lastFace.current > NO_FACE_HINT_MS), 500);
    return () => clearInterval(id);
  }, [learning]);

  if (learning) {
    return (
      <div className="absolute inset-x-3 bottom-3 flex justify-center sm:inset-x-auto sm:left-3 sm:justify-start" role="status">
        <div className="card-enter w-full max-w-xs rounded-xl bg-zinc-950/85 p-4 text-sm shadow-lg shadow-black/30 backdrop-blur-sm">
          <div className="font-medium text-zinc-100">Learning Candidate Baseline</div>
          <ul className="mt-2 space-y-0.5 text-zinc-400">
            <li>· Natural gaze range</li>
            <li>· Typical head direction</li>
            <li>· Normal movement</li>
          </ul>
          <div
            className="mt-3 h-1 overflow-hidden rounded bg-zinc-800"
            role="progressbar"
            aria-label="Baseline progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div className="h-full origin-left bg-emerald-400 transition-transform duration-100 ease-linear" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-emerald-300">
              <span aria-hidden className="size-1.5 rounded-full bg-emerald-400" />
              Processing locally
            </span>
            <span className="font-mono tabular-nums text-zinc-500">{Math.round(progress * 100)}%</span>
          </div>
          {noFace && <div className="mt-2 text-xs text-zinc-300">Make sure one face is clearly visible.</div>}
        </div>
      </div>
    );
  }

  if (ready === "hidden") return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" role="status">
      <div className={`card-enter rounded-full bg-zinc-950/85 px-4 py-2 text-sm font-medium text-emerald-300 ring-1 ring-emerald-500/40 ${ready === "fading" ? "fade-out" : ""}`}>
        Baseline ready ✓
      </div>
    </div>
  );
}
