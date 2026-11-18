import type { OpenFilmItem } from "film-stage/openfilm";
import { useEffect, useRef } from "react";

import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { makeSnapper } from "../core/time";
import { seek, setPlaying } from "../playback/transport";
import { sized, tone, UI_FONT } from "../timeline/canvas";
import { holdView, marks, timeAt, timelineWheel, view } from "../timeline/timeline";
import { onShownResize } from "../timeline/visible";
import { readOpenFilm, saveOpenFilm, useOpenFilm } from "./state";

export function OpenFilmTrack() {
  const doc = useOpenFilm((s) => s.doc),
    selected = useOpenFilm((s) => s.selected);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    void readOpenFilm().catch((e) => say(e.message));
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !doc.data.items.length) return;
    let draft = doc.data.items;
    const tracks = [...new Set(draft.map((it) => it.track ?? 0))].sort((a, b) => b - a);
    c.style.height = `${tracks.length * 28}px`;
    let gesture: {
      item: OpenFilmItem;
      x: number;
      mode: "left" | "right" | "move";
      snap: ReturnType<typeof makeSnapper>;
    } | null = null;
    const boxes: { item: OpenFilmItem; x: number; y: number; w: number }[] = [];
    const draw = () => {
      const { g, w, h } = sized(c),
        { a, v } = view();
      g.fillStyle = tone("track");
      g.fillRect(0, 0, w, h);
      g.font = `11px ${UI_FONT}`;
      boxes.length = 0;
      for (const it of draft) {
        const x = ((it.from - a) / v) * w,
          width = Math.max(2, ((it.to - it.from) / v) * w),
          y = tracks.indexOf(it.track ?? 0) * 28 + 3;
        g.fillStyle = tone(it.id === selected ? "pick" : "clip-shape");
        g.fillRect(x, y, width, 22);
        g.save();
        g.beginPath();
        g.rect(x + 3, y, Math.max(0, width - 6), 22);
        g.clip();
        g.fillStyle = tone("foreground");
        g.fillText(it.asset.split("/").pop()!, x + 5, y + 15);
        g.restore();
        boxes.push({ item: it, x, y, w: width });
      }
    };
    const point = (e: PointerEvent) => ({
      x: e.clientX - c.getBoundingClientRect().left,
      y: e.clientY - c.getBoundingClientRect().top,
    });
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = point(e),
        box = [...boxes]
          .reverse()
          .find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + 22);
      setPlaying(false);
      if (!box) {
        seek(Math.max(0, timeAt(p.x, c.clientWidth)));
        return;
      }
      c.focus();
      c.setPointerCapture(e.pointerId);
      holdView(true);
      gesture = {
        item: box.item,
        x: p.x,
        mode: p.x - box.x < 7 ? "left" : box.x + box.w - p.x < 7 ? "right" : "move",
        snap: makeSnapper(),
      };
    };
    const move = (e: PointerEvent) => {
      if (!gesture) return;
      const { item, mode, snap } = gesture,
        perPx = view().v / c.clientWidth;
      const delta = (point(e).x - gesture.x) * perPx;
      const edges = [
        S.t,
        ...doc.data.items.filter((it) => it.id !== item.id).flatMap((it) => [it.from, it.to]),
      ];
      const value = snap(
        (mode === "right" ? item.to : item.from) + delta,
        mode === "move" ? [0, item.to - item.from] : [0],
        edges,
        perPx,
        !get().magnet || e.shiftKey,
        true,
      ).time;
      const from =
        mode === "right"
          ? item.from
          : Math.max(0, Math.min(value, mode === "left" ? item.to - 1 / 30 : Infinity));
      const to =
        mode === "left"
          ? item.to
          : mode === "right"
            ? Math.max(item.from + 1 / 30, value)
            : from + item.to - item.from;
      draft = doc.data.items.map((it) => (it.id === item.id ? { ...it, from, to } : it));
      draw();
    };
    const up = () => {
      if (!gesture) return;
      const id = gesture.item.id;
      gesture = null;
      holdView(false);
      void saveOpenFilm(draft)
        .then(() => {
          set({ lib: "openfilm", side: "openfilm" });
          useOpenFilm.setState({ selected: id, element: null });
        })
        .catch((e) => say(e.message));
    };
    const cancel = () => {
      gesture = null;
      holdView(false);
      draft = doc.data.items;
      draw();
    };
    marks.openfilm = draw;
    const offResize = onShownResize(c, draw);
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", cancel);
    c.addEventListener("wheel", timelineWheel, { passive: false });
    draw();
    return () => {
      marks.openfilm = () => {};
      offResize();
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", cancel);
      c.removeEventListener("wheel", timelineWheel);
    };
  }, [doc, selected]);
  if (!doc.data.items.length) return null;
  return (
    <div className="col-span-2 mt-1 grid grid-cols-subgrid">
      <button
        className="border-track-line bg-track-head text-ui text-label border-e px-1.5 text-left"
        onClick={() => set({ lib: "openfilm", side: "openfilm" })}
      >
        Overlays
      </button>
      <canvas
        ref={canvas}
        tabIndex={0}
        aria-label="Overlay layers: click to edit, drag to move, drag either edge to trim"
        className="focus-visible:ring-ring block w-full touch-none outline-none focus-visible:ring-2"
        onKeyDown={(e) => {
          if ((e.key === "Delete" || e.key === "Backspace") && selected) {
            e.preventDefault();
            e.stopPropagation();
            void saveOpenFilm(doc.data.items.filter((it) => it.id !== selected)).catch((err) =>
              say(err.message),
            );
          }
        }}
      />
    </div>
  );
}
