// CapCut's text tracks, over the camera row (its main track) on the same seconds as every other row: track 0 at the bottom, each
// one above drawn over it on the picture. An item is dragged to move (up or down onto another track, above the top one for a new
// track), by an edge to trim, with Alt held for a copy, and snaps to the playhead, cuts, words and other items' edges (Shift: no
// snap). A box dragged over empty space picks what it touches here and on the rows below (timeline/rowbox.ts, across.ts); a click
// on empty space drops the pick and moves the playhead there. Items are added from the Text library (TextLibrary.tsx).
import { DURATION, SHOTS_OUT as SHOTS } from "film/scene";

import { together } from "../core/doc";
import { S } from "../core/state";
import { get, noSnap, say } from "../core/store";
import { FPS, makeSnapper, r3, snappedTo, stamp } from "../core/time";
import { seek, setPlaying } from "../playback/transport";
import { beatTimes } from "../sound/sound";
import { type Along, alongWith, inBox, pickAcross, picked as across } from "../timeline/across";
import { drawPlayhead, sized, tone, UI_FONT } from "../timeline/canvas";
import { boxEnd, boxMove, boxStart } from "../timeline/rowbox";
import { snapLine } from "../timeline/snapline";
import { holdView, marks, onPlayhead, timeAt, timelineWheel, view } from "../timeline/timeline";
import {
  edit,
  isShape,
  items,
  locked,
  nameOf,
  pickText,
  preview,
  restore,
  settle,
  snapshot,
  trackState,
  tracksUsed,
} from "./text";
import { shapeGlyph } from "./text-anim";

export const ROW_H = 28;
const CLIP_H = 24,
  EDGE = 6;
// A shape has no CapCut clip to copy: plum, apart from the text clips' orange-brown (index.css --clip-text)
const ANIM_SHADE = "rgba(0,0,0,.28)"; // over the stretch an item animates in or out

type Box = { i: number; x0: number; x1: number; y0: number; y1: number };
let boxes: Box[] = [];
let hover = -1;

// Rows from the top: the highest track first. With none yet, one row holds the hint
const rows = () => Math.max(1, tracksUsed());
export const textRowHeight = () => rows() * ROW_H;
const yOf = (track: number) => (rows() - 1 - track) * ROW_H;
const trackAt = (y: number) => rows() - 1 - Math.floor(y / ROW_H);

export const drawTextRow = () => {
  const c = S.el?.textrow;
  if (!c || !get().text || !c.getClientRects().length) return;
  const height = textRowHeight();
  if (c.style.height !== `${height}px`) c.style.height = `${height}px`;
  const { g, w, h } = sized(c);
  if (!c.width) return;
  const { a, v } = view(),
    X = (s: number) => ((s - a) / v) * w,
    picks = get().textPicks;
  g.fillStyle = tone("track");
  g.fillRect(0, 0, w, h);
  g.fillStyle = tone("background");
  for (let row = 1; row <= rows(); row++) g.fillRect(0, row * ROW_H - 1, w, 1);
  g.fillStyle = tone("grid");
  for (const s of SHOTS) if (s.t > a && s.t < a + v) g.fillRect(X(s.t), 0, 1, h);
  g.font = `12px ${UI_FONT}`;
  g.textBaseline = "middle";
  boxes = [];
  if (!items.length) {
    g.fillStyle = tone("muted-foreground");
    g.fillText("Add text or an annotation shape from the Text tab", 8, ROW_H / 2);
  }
  items.forEach((it, i) => {
    if (it.to <= it.from || it.to < a || it.from > a + v) return;
    const x0 = X(it.from),
      x1 = Math.max(x0 + 4, X(it.to)),
      y = yOf(it.track ?? 0) + (ROW_H - CLIP_H) / 2,
      cx0 = Math.max(-2, x0),
      cx1 = Math.min(w + 2, x1);
    g.globalAlpha = trackState(it.track ?? 0).hidden ? 0.35 : 1;
    g.fillStyle = tone(isShape(it) ? "clip-shape" : "clip-text");
    g.beginPath();
    g.roundRect(cx0, y, Math.max(2, cx1 - cx0), CLIP_H, 3);
    g.fill();
    // The In and Out as a darker stretch at each end, as long as they run
    const px = (x1 - x0) / Math.max(1e-3, it.to - it.from),
      span = it.to - it.from;
    const ai = it.in?.fx ? (it.in.len ?? 0.5) : 0,
      ao = it.out?.fx ? (it.out.len ?? 0.5) : 0,
      k = ai + ao > span ? span / (ai + ao) : 1;
    g.fillStyle = ANIM_SHADE;
    if (ai) g.fillRect(x0, y + CLIP_H - 5, ai * k * px, 5);
    if (ao) g.fillRect(x1 - ao * k * px, y + CLIP_H - 5, ao * k * px, 5);
    g.save();
    g.beginPath();
    g.rect(cx0, y, cx1 - cx0 - 2, CLIP_H);
    g.clip();
    const lx = Math.max(x0, 0) + 3,
      mid = y + CLIP_H / 2;
    g.font = `11px ${UI_FONT}`;
    const glyph = isShape(it) ? shapeGlyph(it.kind) : "T";
    const gw = Math.ceil(g.measureText(glyph).width);
    const tw = g.measureText(nameOf(it)).width + gw + 8;
    g.fillStyle = tone(isShape(it) ? "clip-shape-tag" : "clip-text-tag");
    g.beginPath();
    g.roundRect(lx, y + 3, tw + 8, CLIP_H - 6, 3);
    g.fill();
    g.fillStyle = tone("clip-label");
    g.font = `600 11px ${UI_FONT}`;
    g.fillText(glyph, lx + 4, mid);
    g.font = `11px ${UI_FONT}`;
    g.fillText(nameOf(it), lx + gw + 9, mid);
    g.restore();
    if (picks.includes(i)) {
      g.strokeStyle = tone("pick");
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(cx0 - 1, y - 1, cx1 - cx0 + 2, CLIP_H + 2, 4);
      g.stroke();
    } else if (hover === i) {
      g.strokeStyle = "rgba(255,255,255,.35)";
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(cx0 - 0.5, y - 0.5, cx1 - cx0 + 1, CLIP_H + 1, 3.5);
      g.stroke();
    }
    g.globalAlpha = 1;
    boxes.push({ i, x0, x1, y0: y, y1: y + CLIP_H });
  });
  drawPlayhead(g, X(S.t), h);
};

const snapPoints = (skip: number[]) => {
  const out = [S.t, ...SHOTS.map((s) => s.t), ...beatTimes()];
  for (const l of S.voiceOut) for (const word of l.words) out.push(word.s);
  items.forEach((it, i) => {
    if (!skip.includes(i)) out.push(it.from, it.to);
  });
  return out;
};
const hit = (x: number, y: number, touch: boolean) => {
  const r = touch ? 8 : 0;
  return (
    boxes.findLast(
      (b) => x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r / 2 && y <= b.y1 + r / 2,
    ) ?? null
  );
};
const itemsInBox = (m: { x0: number; x1: number; y0: number; y1: number }) => {
  const r = S.el.textrow.getBoundingClientRect();
  if (!r.height) return [];
  const x0 = m.x0 - r.left,
    x1 = m.x1 - r.left,
    y0 = m.y0 - r.top,
    y1 = m.y1 - r.top;
  return boxes
    .filter((b) => b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1 && !locked(b.i))
    .map((b) => b.i);
};

type Drag = {
  i: number;
  group: number[];
  mode: "move" | "start" | "end";
  x: number;
  y: number;
  snap: string;
  from: number;
  to: number;
  pts: number[];
  moved: boolean;
  alone: boolean;
  copy: boolean;
  moving: number[];
  along: Along | null;
  shift: number;
  magnet: ReturnType<typeof makeSnapper>;
};

export const attachTextRow = () => {
  const c = S.el.textrow;
  marks.text = drawTextRow;
  inBox.text = itemsInBox;
  const local = (e: PointerEvent) => {
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
  };
  let drag: Drag | null = null,
    scrub: { resume: boolean } | null = null,
    box: { add: boolean } | null = null;
  const playheadGrab = (b: Box | null, x: number, w: number, touch: boolean) =>
    onPlayhead(x, w, touch) && (!b || (x > b.x0 + EDGE && x < b.x1 - EDGE));

  c.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const { x, y, w } = local(e),
      touch = e.pointerType === "touch",
      b = hit(x, y, touch),
      add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (get().blade) {
      if (b) say("Split cuts sound clips and shots. Trim a text item by dragging its edge");
      return;
    }
    c.setPointerCapture(e.pointerId);
    const grab = playheadGrab(b, x, w, touch);
    if (!b || grab) {
      if (touch || grab) {
        if (!grab) pickText([]);
        scrub = { resume: S.playing };
        holdView(true);
        if (S.playing) setPlaying(false);
      } else {
        box = { add };
        boxStart(e, add);
      }
      return;
    }
    if (add) {
      const p = across();
      pickAcross({
        ...p,
        text: p.text.includes(b.i) ? p.text.filter((i) => i !== b.i) : [...p.text, b.i],
      });
      return;
    }
    if (locked(b.i)) {
      pickText([b.i]);
      say("This text track is locked. Unlock it in the track header to edit");
      return;
    }
    const was = get().textPicks.includes(b.i);
    if (!was) pickText([b.i]);
    const group = get().textPicks.filter((i) => !locked(i)),
      along = was ? alongWith("text") : null,
      many = group.length > 1 || !!along;
    const edge = touch ? 10 : EDGE,
      wide = b.x1 - b.x0 > edge * 3;
    const mode =
      many || !wide ? "move" : x <= b.x0 + edge ? "start" : x >= b.x1 - edge ? "end" : "move";
    const it = items[b.i];
    drag = {
      i: b.i,
      group,
      mode,
      x,
      y,
      snap: snapshot(),
      from: it.from,
      to: it.to,
      pts: snapPoints(group),
      moved: false,
      alone: was && many,
      copy: false,
      moving: group,
      along,
      shift: 0,
      magnet: makeSnapper(),
    };
  });

  c.addEventListener("pointermove", (e) => {
    const { x, y, w } = local(e),
      perPx = view().v / w;
    if (scrub) {
      seek(timeAt(x, w));
      return;
    }
    if (box) {
      boxMove(e);
      return;
    }
    if (!drag) {
      const b = hit(x, y, false),
        edge =
          b &&
          get().textPicks.length < 2 &&
          b.x1 - b.x0 > EDGE * 3 &&
          (x <= b.x0 + EDGE || x >= b.x1 - EDGE);
      c.style.cursor = playheadGrab(b, x, w, false)
        ? "ew-resize"
        : !b
          ? "default"
          : locked(b.i)
            ? "not-allowed"
            : edge
              ? "col-resize"
              : "default";
      if ((b?.i ?? -1) !== hover) {
        hover = b?.i ?? -1;
        drawTextRow();
      }
      return;
    }
    if (!drag.moved && Math.abs(x - drag.x) < 3 && Math.abs(y - drag.y) < 6) return;
    if (!drag.moved) drag.copy = e.altKey && drag.mode === "move" && !drag.along;
    drag.moved = true;
    c.style.cursor = drag.copy ? "copy" : drag.mode === "move" ? "default" : "col-resize";
    const d = (x - drag.x) * perPx,
      off = noSnap(e),
      { i, group, from, to, pts } = drag;
    restore(drag.snap);
    const snapped = drag.magnet(
      (drag.mode === "end" ? to : from) + d,
      drag.mode === "move" ? [0, to - from] : [0],
      pts,
      perPx,
      off,
    );
    if (drag.mode === "move") {
      const ts = group.map((j) => items[j].track ?? 0),
        dk = Math.max(-Math.min(...ts), trackAt(y) - trackAt(drag.y));
      if (ts.some((k) => trackState(k + dk).lock)) {
        drag.shift = 0;
        drag.along?.restore();
        snapLine(null);
        c.style.cursor = "not-allowed";
        return;
      }
    }
    preview((f) => {
      if (drag!.mode === "move") {
        const moving = (drag!.moving = drag!.copy
          ? group.map((j) => {
              f.items.push(structuredClone(f.items[j]));
              return f.items.length - 1;
            })
          : group);
        let shift = snapped.time - from;
        const room = drag!.along?.room ?? [-Infinity, Infinity];
        shift = Math.max(
          -Math.min(...moving.map((j) => f.items[j].from)),
          room[0],
          Math.min(DURATION - Math.max(...moving.map((j) => f.items[j].to)), room[1], shift),
        );
        drag!.shift = shift;
        // Up or down by as many rows as the pointer went, the whole pick together, never under track 0
        const tracks = moving.map((j) => f.items[j].track ?? 0),
          dk = Math.max(-Math.min(...tracks), trackAt(y) - trackAt(drag!.y));
        moving.forEach((j, k) => {
          const it = f.items[j];
          it.from = r3(it.from + shift);
          it.to = r3(it.to + shift);
          it.track = tracks[k] + dk;
        });
        settle(f.items, moving);
      } else if (drag!.mode === "end")
        f.items[i].to = r3(Math.min(DURATION, Math.max(from + 1 / FPS, snapped.time)));
      else f.items[i].from = r3(Math.max(0, Math.min(to - 1 / FPS, snapped.time)));
      if (drag!.mode !== "move") settle(f.items, [i]);
    });
    if (drag.mode === "move") drag.along?.preview(drag.shift);
    const others = drag.mode === "move" ? group.length - 1 + (drag.along?.count ?? 0) : 0,
      now = items[drag.moving[group.indexOf(i)] ?? i];
    snapLine(
      snapped.target === null
        ? null
        : snappedTo(
            drag.mode === "move"
              ? [now.from, now.to]
              : drag.mode === "start"
                ? [now.from]
                : [now.to],
            [snapped.target],
          ),
    );
    say(
      `${drag.copy ? "Copy of " : ""}${nameOf(now)}${others ? ` + ${others} more` : ""}: ${stamp(now.from)} → ${stamp(now.to)}${off ? "" : " (Shift: no snapping)"}`,
      1500,
    );
  });

  const up = (e: PointerEvent) => {
    if (scrub) {
      const r = scrub.resume;
      scrub = null;
      holdView(false);
      if (r) setPlaying(true);
      return;
    }
    if (box) {
      box = null;
      boxEnd(e);
      return;
    }
    if (!drag) return;
    snapLine(null);
    const { snap, moved, alone, i, copy, moving, along, shift } = drag;
    drag = null;
    c.style.cursor = "";
    if (!moved) {
      if (alone && e.type === "pointerup") pickText([i]);
      return;
    }
    const after = snapshot();
    restore(snap);
    along?.restore();
    if (after === snap || e.type !== "pointerup") return;
    together(() => {
      edit((f) => {
        f.items = JSON.parse(after).items;
      });
      along?.commit(Math.round(shift * 1000) / 1000);
    });
    if (copy) pickText(moving);
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
  c.addEventListener("lostpointercapture", up);
  c.addEventListener("pointerleave", () => {
    if (hover >= 0 && !drag) {
      hover = -1;
      drawTextRow();
    }
  });
  c.addEventListener("wheel", timelineWheel, { passive: false });
  new ResizeObserver(drawTextRow).observe(c);
};
