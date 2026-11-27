import { overlayFramePoint, type OverlayInspection, overlayPoint } from "film-stage/openfilm";
import type { PageOverride } from "film-stage/openfilm-page";

import { CLEAR_PICKS } from "../core/selection";
import { S } from "../core/state";
import { set, studio } from "../core/store";
import { picturePoint } from "../picture/preview-state";
import { setPlaying } from "../playback/transport";
import { openFilmDoc, type OverlayItem, useOpenFilm } from "./state";

export const pageLayers = () => S.render?.inspectOpenFilm?.() ?? [];
studio.subscribe((s, previous) => {
  if (s.side !== "openfilm" && previous.side === "openfilm")
    useOpenFilm.setState({ selection: { kind: "none" } });
});

export function drawPageSelection() {
  const svg = S.el.stage.querySelector<SVGSVGElement>("[data-page-selection]");
  if (!svg) return;
  const { selection } = useOpenFilm.getState();
  const hasElement = selection.kind === "element" && !S.playing;
  svg.style.display = hasElement ? "" : "none";
  if (!hasElement) return;
  const layer = pageLayers().find((it) => it.id === selection.id),
    node = layer?.elements.find((it) => it.selector === selection.selector);
  if (!layer || !node) {
    svg.style.display = "none";
    return;
  }
  const [x, y, w, h] = node.rect;
  const fw = S.el.canvas.clientWidth,
    fh = S.el.canvas.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${fw} ${fh}`);
  const points = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
    .map(([px, py]) => {
      const [ax, ay] = overlayFramePoint(layer, px, py);
      return `${ax * fw},${ay * fh}`;
    })
    .join(" ");
  svg.querySelector("polygon")?.setAttribute("points", points);
}

export function updateElement(item: OverlayItem, selector: string, patch: Partial<PageOverride>) {
  item.elements ??= [];
  let value = item.elements.find((x) => x.selector === selector);
  if (!value) {
    value = { selector };
    item.elements.push(value);
  }
  Object.assign(value, patch, patch.style ? { style: { ...value.style, ...patch.style } } : {});
}

export function selectPageElement(id: string, selector: string | null) {
  set({ ...CLEAR_PICKS, side: "openfilm", lib: "openfilm" });
  useOpenFilm.setState({
    selection: selector ? { kind: "element", id, selector } : { kind: "item", id },
  });
  S.dirty = true;
}

function pageTargetAt(at: readonly [number, number]) {
  if (S.tools?.free.on) return null;
  let layer: OverlayInspection | undefined, selector: string | undefined;
  for (const entry of pageLayers().reverse()) {
    const [x, y] = overlayPoint(entry, ...at);
    const target = entry.hitTest(x, y);
    const hit = entry.elements.find((el) => el.selector === target);
    if (hit) {
      layer = entry;
      selector = hit.selector;
      break;
    }
  }
  return layer && selector ? { layer, selector } : null;
}

export function pickPageAt(at: readonly [number, number]) {
  const target = pageTargetAt(at);
  if (!target) return false;
  selectPageElement(target.layer.id, target.selector);
  return true;
}

export function startPageDrag(
  e: PointerEvent,
  firstMove: PointerEvent,
  at: readonly [number, number],
) {
  const hit = pageTargetAt(at);
  if (!hit) return false;
  const { layer, selector } = hit;
  setPlaying(false);
  selectPageElement(layer.id, selector);
  if (!openFilmDoc.data) return true;
  const matrix = layer.elements.find((el) => el.selector === selector)!.translateMatrix;
  if (!matrix) return true;
  const chosen = layer,
    target = selector,
    start = overlayPoint(chosen, ...at),
    snap = openFilmDoc.snapshot();
  const item = openFilmDoc.data.items.find((it) => it.id === chosen.id)!;
  if (!item) return true;
  const before = item.elements?.find((it) => it.selector === target)?.translate ?? [0, 0];
  const canvas = S.el.canvas;
  let moved = false;
  canvas.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
    moved = true;
    const point = overlayPoint(chosen, ...picturePoint(ev, canvas));
    const dx = point[0] - start[0],
      dy = point[1] - start[1];
    openFilmDoc.restore(snap);
    openFilmDoc.preview((data) =>
      updateElement(
        data.items.find((it) => it.id === chosen.id)!,
        target,
        {
          translate: [
            before[0] + matrix[0] * dx + matrix[2] * dy,
            before[1] + matrix[1] * dx + matrix[3] * dy,
          ],
        },
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
    if (!moved) return;
    const after = openFilmDoc.snapshot();
    openFilmDoc.restore(snap);
    if (!cancel)
      openFilmDoc.edit((data) => {
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
