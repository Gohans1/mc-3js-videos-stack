import { compareHitForPoint, type CompareVideoCategory, type CompareVideoLayout } from "../../src/compare-video-meta.ts";
import { SAME } from "../core/time.ts";
import { IDLE_INK_GESTURE, type InkGesture, stepInk } from "../notes/ink-gesture.ts";
import { shapeOf } from "../notes/shape.ts";
import { markHitsForCompare } from "./model.ts";
import type { InkKind, Mark, Pin } from "./types.ts";

export interface StageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StagePointerContext {
  category: CompareVideoCategory;
  layout: CompareVideoLayout;
  noteSaving: boolean;
  isEditing: boolean;
}

export interface StagePointerDeps {
  getRect: () => StageRect;
  getContext: () => StagePointerContext | null;
  getInkTool: () => InkKind | null;
  getPlaybackTime: () => number;
  isPlaying: () => boolean;
  pause: () => void;
  ensureComposeForDraw: (wasPlaying: boolean) => void;
  openPin: (pin: Pin, t: number, wasPlaying: boolean) => void;
  getMarks: () => readonly Mark[];
  setMarks: (marks: Mark[]) => void;
  getLiveMark: () => Mark | null;
  setLiveMark: (mark: Mark | null) => void;
  renderOverlays: () => void;
  capturePointer?: (pointerId: number) => void;
}

const clamp01 = (v: number) => +Math.min(1, Math.max(0, v)).toFixed(4);

const normalize = (clientX: number, clientY: number, r: StageRect): [number, number] => {
  if (r.width <= 0 || r.height <= 0) return [0.5, 0.5];
  return [clamp01((clientX - r.left) / r.width), clamp01((clientY - r.top) / r.height)];
};

export function createStagePointerHandler(deps: StagePointerDeps) {
  let inkGesture: InkGesture = IDLE_INK_GESTURE;
  let tapDrag:
    | {
        id: number;
        startX: number;
        startY: number;
        startPt: [number, number];
        sketching: boolean;
        wasPlaying: boolean;
      }
    | null = null;

  const commitStroke = (mark: Mark, smart: boolean) => {
    const ctx = deps.getContext();
    if (!ctx) return;
    const r = deps.getRect();
    const first = mark.pts[0]!;
    const last = mark.pts.at(-1)!;
    const movedPx = Math.hypot((last[0] - first[0]) * r.width, (last[1] - first[1]) * r.height);
    if (movedPx < 8 && !(mark.kind === "pen" && mark.pts.length > 3)) return;

    const finalMark: Mark = { ...mark, pts: mark.pts.slice() };
    if (smart) {
      const pxPts = finalMark.pts.map(([x, y]): [number, number] => [x * r.width, y * r.height]);
      const detected = shapeOf(pxPts);
      finalMark.kind = detected;
      if (detected === "arrow") {
        finalMark.pts = [first, last];
      } else if (detected === "box") {
        const xs = finalMark.pts.map((pt) => pt[0]);
        const ys = finalMark.pts.map((pt) => pt[1]);
        finalMark.pts = [
          [Math.min(...xs), Math.min(...ys)],
          [Math.max(...xs), Math.max(...ys)],
        ];
      }
    }
    const annotated = markHitsForCompare(finalMark, ctx.category, ctx.layout);
    deps.setMarks([...deps.getMarks(), annotated]);
  };

  const reset = () => {
    inkGesture = IDLE_INK_GESTURE;
    tapDrag = null;
    if (deps.getLiveMark()) {
      deps.setLiveMark(null);
      deps.renderOverlays();
    }
  };

  const onDown = (e: {
    pointerId: number;
    button: number;
    pointerType: string;
    clientX: number;
    clientY: number;
    buttons: number;
  }): boolean => {
    if (e.button !== 0 && e.pointerType === "mouse") return false;
    const ctx = deps.getContext();
    if (!ctx || ctx.noteSaving || ctx.isEditing) return false;

    const tool = deps.getInkTool();
    if (tool) {
      const res = stepInk(inkGesture, {
        type: "down",
        id: e.pointerId,
        button: e.button,
        pointerType: e.pointerType,
        drawOnLeft: true,
        tool,
        x: e.clientX,
        y: e.clientY,
      });
      if (res.effect === "none") return false;
      deps.capturePointer?.(e.pointerId);
      inkGesture = res.gesture;
      const wasPlaying = deps.isPlaying();
      if (wasPlaying) deps.pause();
      deps.ensureComposeForDraw(wasPlaying);
      const pt = normalize(e.clientX, e.clientY, deps.getRect());
      if (res.effect === "start_stroke" && tool !== "path") {
        deps.setLiveMark({
          kind: tool,
          t: +deps.getPlaybackTime().toFixed(3),
          pts: tool === "pen" ? [pt] : [pt, pt],
        });
        deps.renderOverlays();
      }
      return true;
    }

    if (tapDrag) return false;
    deps.capturePointer?.(e.pointerId);
    tapDrag = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPt: normalize(e.clientX, e.clientY, deps.getRect()),
      sketching: false,
      wasPlaying: deps.isPlaying(),
    };
    return true;
  };

  const onMove = (e: { pointerId: number; clientX: number; clientY: number }) => {
    if (inkGesture.kind !== "idle") {
      const res = stepInk(inkGesture, {
        type: "move",
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
      });
      inkGesture = res.gesture;
      const live = deps.getLiveMark();
      if (res.effect === "move_stroke" && live) {
        const r = deps.getRect();
        const pt = normalize(e.clientX, e.clientY, r);
        if (live.kind === "pen") {
          const [lx, ly] = live.pts.at(-1)!;
          if (Math.hypot((pt[0] - lx) * r.width, (pt[1] - ly) * r.height) >= 2) {
            live.pts.push(pt);
          }
        } else {
          live.pts[1] = pt;
        }
        deps.renderOverlays();
      }
      return;
    }

    if (!tapDrag || tapDrag.id !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - tapDrag.startX, e.clientY - tapDrag.startY);
    if (!tapDrag.sketching && dist > 8) {
      tapDrag.sketching = true;
      if (tapDrag.wasPlaying) deps.pause();
      deps.ensureComposeForDraw(tapDrag.wasPlaying);
      deps.setLiveMark({
        kind: "pen",
        t: +deps.getPlaybackTime().toFixed(3),
        pts: [tapDrag.startPt],
      });
    }
    const live = deps.getLiveMark();
    if (tapDrag.sketching && live) {
      const r = deps.getRect();
      const pt = normalize(e.clientX, e.clientY, r);
      const [lx, ly] = live.pts.at(-1)!;
      if (Math.hypot((pt[0] - lx) * r.width, (pt[1] - ly) * r.height) >= 2) {
        live.pts.push(pt);
        deps.renderOverlays();
      }
    }
  };

  const onUp = (e: { pointerId: number; clientX: number; clientY: number; buttons: number }) => {
    if (inkGesture.kind !== "idle") {
      const tool = deps.getInkTool();
      const res = stepInk(inkGesture, {
        type: "up",
        id: e.pointerId,
        buttons: e.buttons,
        tool,
      });
      inkGesture = res.gesture;
      if (res.effect === "end_stroke") {
        const done = deps.getLiveMark();
        deps.setLiveMark(null);
        if (done) commitStroke(done, false);
        deps.renderOverlays();
      } else if (res.effect === "commit_path") {
        const ctx = deps.getContext();
        if (!ctx) return;
        const pt = normalize(e.clientX, e.clientY, deps.getRect());
        const nowT = +deps.getPlaybackTime().toFixed(3);
        const hit = compareHitForPoint(pt[0], pt[1], ctx.category, ctx.layout);
        const marks = deps.getMarks().map((m) => ({
          ...m,
          pts: m.pts.slice(),
          ...(m.ts ? { ts: m.ts.slice() } : {}),
          ...(m.hits ? { hits: m.hits.slice() } : {}),
        }));
        let pathMark = marks.find((m) => m.kind === "path");
        if (!pathMark) {
          pathMark = { kind: "path", t: nowT, pts: [], ts: [], hits: [] };
          marks.push(pathMark);
        }
        const sameIdx = pathMark.ts!.findIndex((t) => Math.abs(t - nowT) <= SAME);
        if (sameIdx >= 0) {
          pathMark.pts[sameIdx] = pt;
          pathMark.hits![sameIdx] = hit;
        } else {
          const insertAt = pathMark.ts!.findIndex((t) => t > nowT);
          const k = insertAt < 0 ? pathMark.ts!.length : insertAt;
          pathMark.pts.splice(k, 0, pt);
          pathMark.ts!.splice(k, 0, nowT);
          pathMark.hits!.splice(k, 0, hit);
        }
        pathMark.t = pathMark.ts![0]!;
        deps.setMarks(marks);
      }
      return;
    }

    if (!tapDrag || tapDrag.id !== e.pointerId) return;
    const finished = tapDrag;
    tapDrag = null;
    if (finished.sketching) {
      const done = deps.getLiveMark();
      deps.setLiveMark(null);
      if (done) commitStroke(done, true);
      deps.renderOverlays();
      return;
    }
    const ctx = deps.getContext();
    if (!ctx) return;
    if (finished.wasPlaying) deps.pause();
    const [x, y] = normalize(e.clientX, e.clientY, deps.getRect());
    const hit = compareHitForPoint(x, y, ctx.category, ctx.layout);
    deps.openPin({ x, y, what: hit.what }, deps.getPlaybackTime(), finished.wasPlaying);
  };

  const onCancel = (e: { pointerId: number }) => {
    if (inkGesture.kind !== "idle") {
      const res = stepInk(inkGesture, { type: "cancel", id: e.pointerId });
      inkGesture = res.gesture;
      if (res.effect === "drop") {
        deps.setLiveMark(null);
        deps.renderOverlays();
      }
    }
    if (tapDrag && tapDrag.id === e.pointerId) {
      tapDrag = null;
      deps.setLiveMark(null);
      deps.renderOverlays();
    }
  };

  return { onDown, onMove, onUp, onCancel, reset };
}
