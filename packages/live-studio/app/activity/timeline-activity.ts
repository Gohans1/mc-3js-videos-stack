import type { ActivitySurface } from "../../src/activity.mjs";
import { equalJson } from "../../src/merge-edits.mjs";
import { get as studio } from "../core/store";
import { tone } from "../timeline/canvas";
import { activity, lightEdit } from "./activity";

const uniqueIndices = <T>(rows: readonly T[], identify: (row: T) => string | undefined) => {
  const indices = new Map<string, number | null>();
  rows.forEach((row, i) => {
    const id = identify(row);
    if (id !== undefined) indices.set(id, indices.has(id) ? null : i);
  });
  return indices;
};

export const changedRows = <T>(
  before: readonly T[],
  after: readonly T[],
  identify: (row: T) => string | undefined,
) => {
  const previous = uniqueIndices(before, identify);
  return [...uniqueIndices(after, identify)].flatMap(([id, i]) => {
    const was = previous.get(id);
    return i === null || was === null || (was !== undefined && equalJson(before[was], after[i]))
      ? []
      : [i];
  });
};

export const itemKey = (surface: ActivitySurface, id: string) => `clip:${surface}:${id}`;
const clipPrefix = (surface: ActivitySurface) => `clip:${surface}:`;
export const hasClipActivity = (surface: ActivitySurface) =>
  studio().aiActivity &&
  Object.keys(activity.getState().lit).some((key) => key.startsWith(clipPrefix(surface)));
export const clipIsLit = (surface: ActivitySurface, id: string) =>
  studio().aiActivity && itemKey(surface, id) in activity.getState().lit;

export const lightItems = <T>(
  surface: ActivitySurface,
  before: readonly T[],
  after: readonly T[],
  identify: (row: T) => string | undefined,
  place: (index: number) => {
    key?: string;
    track?: string | number;
    range: readonly [number, number];
  },
) => {
  if (!studio().aiActivity) return;
  const places = changedRows(before, after, identify).slice(0, 20).map(place);
  lightEdit(
    surface,
    places.flatMap(({ key, track }) => [
      ...(key === undefined ? [] : [itemKey(surface, key)]),
      ...(track === undefined ? [] : [`track:${surface}:${track}`]),
    ]),
    places.map((place) => place.range),
  );
};

export const paintActivityMark = (
  g: CanvasRenderingContext2D,
  surface: ActivitySurface,
  id: string,
  x: number,
  y: number,
  width: number,
) => {
  if (width > 0 && clipIsLit(surface, id)) {
    g.fillStyle = tone("ai");
    g.fillRect(x, y, width, 2);
  }
};

export const onClipActivity = (surface: ActivitySurface, draw: () => void) => {
  const prefix = clipPrefix(surface);
  let frame = 0;
  const changed = (a: Record<string, number>, b: Record<string, number>) =>
    Object.keys(a).some((key) => key.startsWith(prefix) && !(key in b));
  const off = activity.subscribe((a, b) => {
    if (frame || a.lit === b.lit || (!changed(a.lit, b.lit) && !changed(b.lit, a.lit))) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  });
  return () => {
    off();
    cancelAnimationFrame(frame);
  };
};
