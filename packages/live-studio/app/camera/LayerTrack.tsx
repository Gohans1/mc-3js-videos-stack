import { useEffect, useRef } from "react";
import { DURATION, SHOTS_OUT } from "film/scene";
import { Eye, EyeOff, Lock, LockOpen, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Tip } from "../components/Tip";
import { together } from "../core/doc";
import { S } from "../core/state";
import { get, noSnap, useStudio } from "../core/store";
import { FPS, makeSnapper, r3 } from "../core/time";
import { seek, setPlaying } from "../playback/transport";
import { allClips, beatTimes, span } from "../sound/sound";
import { alongWith, inBox, pickAcross, picked, type Along } from "../timeline/across";
import { drawPlayhead, sized, tone, UI_FONT } from "../timeline/canvas";
import { boxEnd, boxMove, boxStart } from "../timeline/rowbox";
import { snapLine } from "../timeline/snapline";
import { holdView, marks, onPlayhead, timeAt, timelineWheel, view } from "../timeline/timeline";
import { addLayer, layerItems, layerLocked, layerRoom, layersDoc, layerTrack, pickLayers, shiftLayers, splitLayers } from "./layers";

const ROW = 28, HEIGHT = 20;
const trackCount = () => Math.max(1, ...layerItems().map((it) => it.track + 1));
type Box = { id: string; x0: number; x1: number; y0: number; y1: number };
type Gesture = { kind: "idle" | "box" | "scrub" } | {
  kind: "drag"; mode: "move" | "left" | "right"; id: string; ids: string[]; before: string;
  x: number; y: number; from: number; to: number; track: number; rows: number; moved: boolean; delta: number; target: number;
  room: [number, number]; along: Along | null; snap: ReturnType<typeof makeSnapper>;
};

function attach(canvas: HTMLCanvasElement) {
  let boxes: Box[] = [], gesture: Gesture = { kind: "idle" };
  const draw = () => {
    if (!canvas.getClientRects().length) return;
    canvas.style.height = `${trackCount() * ROW}px`;
    const { g, w, h } = sized(canvas), { a, v } = view(), X = (t: number) => (t - a) / v * w;
    g.fillStyle = tone("track"); g.fillRect(0, 0, w, h);
    g.fillStyle = tone("background"); for (let y = ROW; y <= h; y += ROW) g.fillRect(0, y - 1, w, 1);
    boxes = [];
    g.font = `11px ${UI_FONT}`; g.textBaseline = "middle";
    if (!layerItems().length) { g.fillStyle = tone("muted-foreground"); g.fillText("Drag Custom adjustment here", 8, ROW / 2); }
    for (const it of layerItems()) {
      if (it.to < a || it.from > a + v) continue;
      const x0 = X(it.from), x1 = Math.max(x0 + 4, X(it.to)), y0 = (trackCount() - 1 - it.track) * ROW + 4;
      const l = Math.max(-2, x0), r = Math.min(w + 2, x1);
      g.globalAlpha = layerTrack(it.track).hidden ? .35 : 1;
      g.fillStyle = tone("clip-adjust"); g.beginPath(); g.roundRect(l, y0, r - l, HEIGHT, 3); g.fill();
      g.save(); g.beginPath(); g.rect(l + 3, y0, Math.max(0, r - l - 6), HEIGHT); g.clip();
      g.fillStyle = tone("foreground"); g.fillText(it.name, Math.max(0, x0) + 4, y0 + HEIGHT / 2); g.restore();
      if (get().layerPicks.includes(it.id)) { g.strokeStyle = tone("foreground"); g.lineWidth = 2; g.beginPath(); g.roundRect(l + 1, y0 + 1, Math.max(0, r - l - 2), HEIGHT - 2, 3); g.stroke(); }
      boxes.push({ id: it.id, x0, x1, y0, y1: y0 + HEIGHT });
    }
    g.globalAlpha = 1; drawPlayhead(g, X(S.t), h);
  };
  const hit = (x: number, y: number) => boxes.findLast((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
  const xy = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; };
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); const { x, y, w } = xy(e), box = hit(x, y);
    if (S.playing) setPlaying(false);
    canvas.setPointerCapture(e.pointerId);
    if (!box && onPlayhead(x, w, e.pointerType === "touch")) { gesture = { kind: "scrub" }; holdView(true); return; }
    if (!box) { gesture = { kind: "box" }; boxStart(e, e.shiftKey || e.ctrlKey || e.metaKey); return; }
    const adding = e.ctrlKey || e.metaKey || e.shiftKey, p = picked();
    if (adding) { pickAcross({ ...p, layers: p.layers.includes(box.id) ? p.layers.filter((id) => id !== box.id) : [...p.layers, box.id] }); return; }
    if (!p.layers.includes(box.id)) pickLayers([box.id]);
    if (layerLocked(box.id)) return;
    if (get().blade) { splitLayers([box.id], timeAt(x, w)); return; }
    const it = layerItems().find((it) => it.id === box.id)!, ids = get().layerPicks.filter((id) => !layerLocked(id));
    const mode = x < box.x0 + 6 ? "left" : x > box.x1 - 6 ? "right" : "move", along = mode === "move" ? alongWith("layers") : null;
    const room = layerRoom(ids);
    gesture = { kind: "drag", mode, id: it.id, ids, before: layersDoc.snapshot(), x, y, from: it.from, to: it.to, track: it.track, rows: trackCount(), moved: false, delta: 0, target: it.track,
      room: [Math.max(room[0], along?.room[0] ?? -Infinity), Math.min(room[1], along?.room[1] ?? Infinity)], along, snap: makeSnapper() };
    S.dragging = { resume: false }; holdView(true);
  };
  const move = (e: PointerEvent) => {
    const { x, y, w } = xy(e), d = gesture;
    if (d.kind === "idle") { const b = hit(x, y); canvas.style.cursor = b && !layerLocked(b.id) && (x < b.x0 + 6 || x > b.x1 - 6) ? "ew-resize" : "default"; return; }
    if (d.kind === "box") { boxMove(e); return; }
    if (d.kind === "scrub") { seek(timeAt(x, w)); return; }
    if (d.kind !== "drag") return;
    if (!d.moved && Math.hypot(x - d.x, y - d.y) < 4) return;
    d.moved = true; layersDoc.restore(d.before); d.along?.restore();
    const perPx = view().v / w, raw = (x - d.x) * perPx;
    const pts = [0, DURATION, S.t, ...SHOTS_OUT.map((s) => s.t), ...allClips().flatMap(span), ...beatTimes(), ...layerItems().filter((it) => !d.ids.includes(it.id)).flatMap((it) => [it.from, it.to])];
    const edge = d.mode === "right" ? d.to : d.from;
    const snapped = d.snap(edge + raw, d.mode === "move" ? [0, d.to - d.from] : [0], pts, perPx, noSnap(e));
    d.delta = d.mode === "move" ? Math.max(d.room[0], Math.min(d.room[1], snapped.time - edge)) : d.mode === "left" ? Math.max(-d.from, Math.min(d.to - d.from - 1 / FPS, snapped.time - edge)) : Math.max(d.from - d.to + 1 / FPS, Math.min(DURATION - d.to, snapped.time - edge));
    d.target = d.mode === "move" && d.ids.length === 1 && !d.along ? Math.max(0, Math.min(d.rows, d.track + Math.round((d.y - y) / ROW))) : d.track;
    if (layerTrack(d.target).lock) d.target = d.track;
    const start = d.from + (d.mode === "right" ? 0 : d.delta), end = d.to + (d.mode === "left" ? 0 : d.delta);
    const moving = d.mode === "move" ? layerItems().filter((it) => d.ids.includes(it.id)).map((it) => ({ from: it.from + d.delta, to: it.to + d.delta, track: d.ids.length === 1 ? d.target : it.track })) : [{ from: start, to: end, track: d.target }];
    if (moving.some((m) => layerItems().some((it) => !d.ids.includes(it.id) && it.track === m.track && m.from < it.to - .001 && m.to > it.from + .001))) { d.delta = 0; d.target = d.track; }
    layersDoc.preview((f) => {
      if (d.mode === "move") { shiftLayers(d.ids, d.delta)(f); if (d.ids.length === 1) f.items.find((it) => it.id === d.id)!.track = d.target; }
      else { const it = f.items.find((it) => it.id === d.id)!; if (d.mode === "left") it.from = r3(d.from + d.delta); else it.to = r3(d.to + d.delta); }
    });
    d.along?.preview(d.delta);
    snapLine(Math.abs(edge + d.delta - snapped.time) < .001 ? snapped.target : null);
  };
  const end = (e: PointerEvent | KeyboardEvent, cancel = false) => {
    const d = gesture; gesture = { kind: "idle" };
    if (d.kind === "box") boxEnd(e instanceof PointerEvent ? e : undefined);
    if (d.kind === "drag") {
      const next = structuredClone(layersDoc.data!); layersDoc.restore(d.before); d.along?.restore();
      if (!cancel && d.moved) together(() => { layersDoc.edit((f) => { f.items = next.items; }); d.along?.commit(d.delta); });
    }
    S.dragging = null; holdView(false); snapLine(null);
  };
  const up = (e: PointerEvent) => end(e), cancel = (e: PointerEvent) => end(e, true);
  const key = (e: KeyboardEvent) => { if (e.key === "Escape" && gesture.kind !== "idle") { e.preventDefault(); end(e, true); } };
  const wheel = (e: WheelEvent) => timelineWheel(e);
  marks.layers = draw;
  inBox.layers = (r) => { const c = canvas.getBoundingClientRect(); return boxes.filter((b) => b.x1 + c.left >= r.x0 && b.x0 + c.left <= r.x1 && b.y1 + c.top >= r.y0 && b.y0 + c.top <= r.y1).map((b) => b.id); };
  canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", cancel); canvas.addEventListener("wheel", wheel, { passive: false }); window.addEventListener("keydown", key);
  return () => { marks.layers = () => {}; inBox.layers = () => []; canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", cancel); canvas.removeEventListener("wheel", wheel); window.removeEventListener("keydown", key); };
}

export function LayerTrack() {
  const ref = useRef<HTMLCanvasElement>(null), enabled = useStudio((s) => s.layers);
  useStudio((s) => s.layersRev);
  useEffect(() => attach(ref.current!), []);
  return <div className={`col-span-2 grid grid-cols-subgrid mb-1 ${enabled ? "" : "hidden"}`}>
    <ul aria-label="Adjustment tracks" className="border-e border-track-line bg-track-head">
      {Array.from({ length: trackCount() }, (_, row) => { const track = trackCount() - row - 1, state = layerTrack(track), name = `Adjustment ${track + 1}`;
        const change = (prop: "lock" | "hidden", value: boolean) => layersDoc.edit((f) => { f.tracks ??= {}; f.tracks[track] = { ...f.tracks[track], [prop]: value || undefined }; });
        return <li key={track} className="flex h-7 items-center border-b border-background">
          <Tip label={`${name}: select its clips`}><Button variant="quiet" size="icon-sm" aria-label={`Select ${name}`} onClick={() => pickLayers(layerItems().filter((it) => it.track === track).map((it) => it.id))}><SlidersHorizontal /></Button></Tip>
          <Tip label={state.lock ? `Unlock ${name}` : `Lock ${name}`}><Toggle variant="quiet" size="icon-sm" pressed={!!state.lock} onPressedChange={(v) => change("lock", v)} aria-label={`Lock ${name}`}>{state.lock ? <Lock /> : <LockOpen />}</Toggle></Tip>
          <Tip label={state.hidden ? `Show ${name}` : `Hide ${name}`}><Toggle variant="quiet" size="icon-sm" pressed={!!state.hidden} onPressedChange={(v) => change("hidden", v)} aria-label={`Hide ${name}`}>{state.hidden ? <EyeOff /> : <Eye />}</Toggle></Tip>
        </li>;
      })}
    </ul>
    <canvas ref={ref} data-timeline-row aria-label="Adjustment layers: select, move or trim a shared grade" className="block h-7 w-full touch-none" onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-studio-adjustment")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }} onDrop={(e) => { if (!e.dataTransfer.types.includes("application/x-studio-adjustment")) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); addLayer(Math.max(0, timeAt(e.clientX - r.left, r.width))); }} />
  </div>;
}
