import { EDIT } from "film/edit";

import { overlayTime } from "../../src/layer-timing.mjs";
import { layerClock } from "../../src/timing-state.mjs";
import { clipIsLit, hasClipActivity } from "../activity/timeline-activity";
import { S } from "../core/state";
import { get, noSnap, say } from "../core/store";
import { picturePoint } from "../picture/preview-state";
import { openTextEditor } from "./inline-editor";
import {
  edit,
  isShape,
  items,
  locked,
  pickText,
  preview,
  resolveItem,
  restore,
  snapshot,
  type TextItem,
  type TextTrack,
} from "./text";
import { textTransform } from "./text-transform";

const SNAP = 0.012;
const rotationHandle = (points: number[][], anchor: number[]) => {
  const x = (points[0][0] + points[1][0]) / 2,
    y = (points[0][1] + points[1][1]) / 2;
  const d = Math.max(1, Math.hypot(x - anchor[0], y - anchor[1]));
  return [x + (24 * (x - anchor[0])) / d, y + (24 * (y - anchor[1])) / d];
};

const boxesNow = () => {
  const tl = S.tools?.titles;
  if (!tl || S.tools?.free.on || !layerClock.visible(layerClock.sourceAt(S.t))) return [];
  const text = (
    EDIT as {
      text?: {
        items: unknown[];
        tracks?: Record<string, TextTrack>;
        preset?: string;
        defaults?: Record<string, unknown>;
      };
    }
  ).text;
  return tl.boxes(
    text ?? [],
    layerClock.sourceAt(S.t),
    S.tools!.camera,
    text?.tracks,
    (item) => overlayTime(layerClock, S.t, item as TextItem),
  );
};

export const drawTextSel = () => {
  const el = S.el?.textsel;
  if (!el) return;
  const picks = get().textPicks;
  const recent = !S.playing && hasClipActivity("text");
  if (!picks.length && !recent && !el.childElementCount) return;
  const shown =
    picks.length || recent
      ? boxesNow().flatMap((box) => {
          const id = items[box.i]?.id;
          const picked = picks.includes(box.i);
          return picked || (recent && typeof id === "string" && clipIsLit("text", id))
            ? [{ box, picked }]
            : [];
        })
      : [];
  const w = el.clientWidth,
    h = el.clientHeight;
  const svg = (tag: string) => document.createElementNS("http://www.w3.org/2000/svg", tag);
  while (el.children.length < shown.length) {
    const frame = svg("svg");
    for (const [color, width] of [
      ["var(--scrim)", "3"],
      ["var(--picture)", "1"],
    ]) {
      const line = svg("polygon");
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", width);
      frame.append(line);
    }
    for (let i = 0; i < 4; i++) {
      const dot = svg("circle");
      dot.setAttribute("r", "3.5");
      dot.setAttribute("fill", "var(--picture)");
      dot.setAttribute("stroke", "var(--scrim-soft)");
      frame.append(dot);
    }
    const stem = svg("line"),
      turn = svg("circle");
    stem.setAttribute("stroke", "var(--picture)");
    turn.setAttribute("r", "4.5");
    turn.setAttribute("fill", "var(--picture)");
    frame.append(stem, turn);
    el.append(frame);
  }
  [...el.children].forEach((d, k) => {
    const entry = shown[k],
      frame = d as SVGSVGElement;
    frame.style.display = entry ? "" : "none";
    if (!entry) return;
    const { box: b, picked } = entry;
    frame.dataset.textIndex = String(b.i);
    frame.toggleAttribute("data-text-activity", !picked);
    frame.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const points = (
      b.corners ?? [
        [b.box[0], b.box[1]],
        [b.box[2], b.box[1]],
        [b.box[2], b.box[3]],
        [b.box[0], b.box[3]],
      ]
    ).map(([x, y]) => [x * w, y * h]);
    const path = points.map((p) => p.join(",")).join(" ");
    frame.children[0].setAttribute("points", path);
    frame.children[1].setAttribute("points", path);
    frame.children[1].setAttribute("stroke", picked ? "var(--picture)" : "var(--ai)");
    points.forEach(([x, y], i) => {
      (frame.children[i + 2] as SVGElement).style.display = picked ? "" : "none";
      frame.children[i + 2].setAttribute("cx", String(x));
      frame.children[i + 2].setAttribute("cy", String(y));
    });
    const anchor = b.anchor
      ? [b.anchor[0] * w, b.anchor[1] * h]
      : [((b.box[0] + b.box[2]) * w) / 2, ((b.box[1] + b.box[3]) * h) / 2];
    const turn = rotationHandle(points, anchor);
    const stem = frame.children[6];
    stem.setAttribute("x1", String((points[0][0] + points[1][0]) / 2));
    stem.setAttribute("y1", String((points[0][1] + points[1][1]) / 2));
    stem.setAttribute("x2", String(turn[0]));
    stem.setAttribute("y2", String(turn[1]));
    frame.children[7].setAttribute("cx", String(turn[0]));
    frame.children[7].setAttribute("cy", String(turn[1]));
  });
};

const hitContext = document.createElement("canvas").getContext("2d")!;
export const textAt = (x: number, y: number) =>
  boxesNow().findLast(({ corners, box: [x0, y0, x1, y1] }) => {
    if (!corners) return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const path = new Path2D();
    corners.forEach(([px, py], i) => (i ? path.lineTo(px, py) : path.moveTo(px, py)));
    path.closePath();
    return hitContext.isPointInPath(path, x, y);
  })?.i ?? -1;

export const startTextDrag = (
  e: PointerEvent,
  firstMove: PointerEvent,
  at: readonly [number, number],
) => {
  if (!get().text) return false;
  const canvas = S.el.canvas,
    r = canvas.getBoundingClientRect();
  const origin: [number, number] = [at[0] * r.width, at[1] * r.height];
  for (const b of boxesNow().filter((box) => get().textPicks.includes(box.i) && !locked(box.i))) {
    const points = (
      b.corners ?? [
        [b.box[0], b.box[1]],
        [b.box[2], b.box[1]],
        [b.box[2], b.box[3]],
        [b.box[0], b.box[3]],
      ]
    ).map(([x, y]) => [x * r.width, y * r.height]);
    const anchor: [number, number] = b.anchor
      ? [b.anchor[0] * r.width, b.anchor[1] * r.height]
      : [((b.box[0] + b.box[2]) * r.width) / 2, ((b.box[1] + b.box[3]) * r.height) / 2];
    const near = (p: number[]) => Math.hypot(p[0] - origin[0], p[1] - origin[1]) <= 10;
    const kind = near(rotationHandle(points, anchor))
      ? "rotate"
      : points.some(near)
        ? "scale"
        : null;
    if (!kind) continue;
    const resolved = resolveItem(items[b.i]);
    const before = { scale: resolved.scale, rotate: resolved.rotate },
      snap = snapshot();
    let moved = false;
    canvas.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      moved = true;
      const [x, y] = picturePoint(ev, canvas);
      restore(snap);
      preview((data) =>
        Object.assign(
          data.items[b.i],
          textTransform(kind, before, anchor, origin, [x * r.width, y * r.height]),
        ),
      );
    };
    const end = (ev: PointerEvent | KeyboardEvent) => {
      const cancel =
        ev.type === "pointercancel" || (ev instanceof KeyboardEvent && ev.key === "Escape");
      if (ev instanceof KeyboardEvent && !cancel) return;
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", end);
      canvas.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", end, true);
      const after = snapshot();
      restore(snap);
      if (moved && !cancel)
        edit((data) => {
          data.items = JSON.parse(after).items;
        });
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    window.addEventListener("keydown", end, true);
    move(firstMove);
    return true;
  }
  const i = textAt(...at);
  if (i < 0 || !(get().textPicks.includes(i) || e.pointerType === "mouse")) return false;
  if (!get().textPicks.includes(i)) pickText([i]);
  if (locked(i)) {
    say("This text track is locked. Unlock it in the track header to edit");
    return true;
  }
  const group = get().textPicks.filter((j) => !locked(j)),
    snap = snapshot();
  const start = group.map((j) => {
      const r = resolveItem(items[j]);
      return [r.x ?? 0.5, r.y ?? 0.5] as const;
    }),
    lead = group.indexOf(i);
  let moved = false;
  canvas.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const [x, y] = picturePoint(ev, canvas);
    let dx = x - at[0],
      dy = y - at[1];
    if (!moved && Math.hypot(dx * r.width, dy * r.height) < 3) return;
    moved = true;
    if (!noSnap(ev) && !items[i].at) {
      const [x0, y0] = start[lead];
      if (Math.abs(x0 + dx - 0.5) < SNAP) dx = 0.5 - x0;
      if (Math.abs(y0 + dy - 0.5) < SNAP) dy = 0.5 - y0;
    }
    restore(snap);
    preview((f) =>
      group.forEach((j, k) => {
        f.items[j].x = +(start[k][0] + dx).toFixed(4);
        f.items[j].y = +(start[k][1] + dy).toFixed(4);
      }),
    );
    say(
      `Position ${Math.round((start[lead][0] + dx) * 1000) / 10}%, ${Math.round((start[lead][1] + dy) * 1000) / 10}% of the frame${noSnap(ev) ? "" : " (Shift: no snapping)"}`,
      1500,
    );
  };
  const end = (ev: PointerEvent | KeyboardEvent) => {
    const cancel =
      ev.type === "pointercancel" || (ev instanceof KeyboardEvent && ev.key === "Escape");
    if (ev instanceof KeyboardEvent && !cancel) return;
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", end);
    canvas.removeEventListener("pointercancel", end);
    window.removeEventListener("keydown", end, true);
    if (!moved) return;
    const after = snapshot();
    restore(snap);
    if (cancel) return;
    edit((f) => {
      f.items = JSON.parse(after).items;
    });
  };
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  window.addEventListener("keydown", end, true);
  move(firstMove);
  return true;
};

export function textDoubleClick(e: MouseEvent, at: readonly [number, number]) {
  const i = textAt(...at),
    item = items[i],
    box = boxesNow().find((b) => b.i === i)?.box;
  if (!item || isShape(item) || locked(i) || !box) return;
  e.preventDefault();
  pickText([i]);
  openTextEditor(S.el.stage, item.text ?? "", box, (value) => {
    if (items[i] !== item) return say("This text changed elsewhere; select it again");
    edit((data) => {
      data.items[i].text = value;
    });
  });
}
