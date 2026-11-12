// The film's titles, arrows and circles (package.json "live-studio".textTimeline, {items: [...]}), drawn over the picture by the
// film's film-stage/titles.ts and edited here like the sound lanes (core/doc.ts: undo, saving, an agent's edit wins). The film
// draws from EDIT.text, so every change puts a fresh copy there and the picture follows at once.
// Tracks are CapCut's text tracks: 0 sits just over the camera row and each one above is drawn over it; two items never overlap
// on one track, so an item dropped or moved onto another goes up to the first track with room
import { EDIT } from "film/edit";
import { DURATION } from "film/scene";

import { transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { FPS, r3, stamp } from "../core/time";
import { createTimedDoc } from "../core/timed-doc";
import { shapeLabel, type TitleFxData } from "./text-anim";

export type Kind = "text" | "arrow" | "circle" | "box" | "bracket" | "underline" | (string & {});
export type Fx = TitleFxData;
export interface TextItem {
  timebase?: import("../../src/timing.mjs").LayerHistory & { sourceDuration: number };
  kind: Kind;
  from: number;
  to: number;
  track?: number;
  text?: string;
  x?: number;
  y?: number;
  at?: [number, number, number];
  size?: number;
  font?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  upper?: boolean;
  align?: "left" | "center" | "right";
  spacing?: number;
  line?: number;
  stroke?: { color?: string; width?: number };
  background?: { color?: string; opacity?: number };
  shadow?: boolean;
  opacity?: number;
  scale?: number;
  rotate?: number;
  w?: number;
  h?: number;
  width?: number;
  in?: Fx;
  out?: Fx;
  [k: string]: unknown;
}
export interface TextTrack {
  lock?: boolean;
  hidden?: boolean;
}
interface TextFile {
  items: TextItem[];
  tracks?: Record<string, TextTrack>;
  [k: string]: unknown;
}

export let items: TextItem[] = [];
const changed = () => {
  items = doc.data?.items ?? [];
  (EDIT as Record<string, unknown>).text = structuredClone(doc.source ?? { items: [] });
  S.dirty = true;
  S.finalAt = -1;
  const ps = get().textPicks;
  set({
    textRev: get().textRev + 1,
    ...(ps.some((i) => !items[i]) ? { textPicks: ps.filter((i) => items[i]) } : {}),
  });
};
const doc = createTimedDoc<TextFile>("text", {
  label: "text",
  changed,
  saved: (textSaved) => set({ textSaved }),
  replaced: (was) => {
    if (was?.items.length !== items.length && get().textPicks.length) pickText([]);
  },
});
export const { edit, preview, snapshot, restore } = doc;
export const loadText = async () => {
  set({ text: !!(await doc.load()) });
};

export const isShape = (it: TextItem) => it.kind !== "text";
export const nameOf = (it: TextItem) =>
  isShape(it) ? shapeLabel(it.kind) : (it.text ?? "").split("\n")[0].trim() || "Text";
export const tracksUsed = () => Math.max(0, ...items.map((it) => (it.track ?? 0) + 1));
export const trackState = (track: number): TextTrack => doc.data?.tracks?.[track] ?? {};
export const locked = (i: number) => !!trackState(items[i]?.track ?? 0).lock;
export const setTrack = (track: number, change: Partial<TextTrack>) =>
  edit((f) => {
    f.tracks ??= {};
    f.tracks[track] = { ...f.tracks[track], ...change };
  });

// The pick, which also opens the Text tab and drops every other kind's pick, as each row's own setter does
export const pickText = (is: number[]) => {
  const ok = [...new Set(is)].filter((i) => items[i]).sort((a, b) => a - b);
  set(transitionSelection({ kind: "text", indices: ok }, get().side));
  S.dirty = true;
};

// ---------- Tracks: whether [s, e] is free on track k, and the first track from k up that is
const TOUCH = 0.02;
const fits = (list: TextItem[], k: number, s: number, e: number, skip: Set<number>) =>
  !trackState(k).lock &&
  list.every(
    (it, i) => skip.has(i) || (it.track ?? 0) !== k || e <= it.from + TOUCH || s >= it.to - TOUCH,
  );
export const freeTrack = (
  list: TextItem[],
  s: number,
  e: number,
  from = 0,
  skip = new Set<number>(),
) => {
  let k = from;
  while (!fits(list, k, s, e, skip)) k++;
  return k;
};
// After items were moved or added: each that lands on one it wasn't moved with goes up to the first track with room
export const settle = (list: TextItem[], moved: number[]) => {
  const placed = new Set(list.map((_, i) => i).filter((i) => !moved.includes(i)));
  for (const i of [...moved].sort((a, b) => list[a].from - list[b].from)) {
    const it = list[i];
    it.track = freeTrack(
      list,
      it.from,
      it.to,
      it.track ?? 0,
      new Set(list.map((_, j) => j).filter((j) => !placed.has(j))),
    );
    placed.add(i);
  }
};
// Shifts items in time by d seconds (clamped by the caller to their room), then settles them on free tracks
export const shiftItems = (is: number[], d: number) => (f: TextFile) => {
  const moving = is.filter((i) => !locked(i));
  for (const i of moving) {
    const it = f.items[i];
    it.from = r3(it.from + d);
    it.to = r3(it.to + d);
  }
  settle(f.items, moving);
};
// How far a group may move in time: none before the film's start or past its end
export const room = (is: number[]): [number, number] => [
  -Math.min(...is.map((i) => items[i].from)),
  DURATION - Math.max(...is.map((i) => items[i].to)),
];

// ---------- CapCut's Text library: Default text, a documentary's place-and-time line, a chapter card, and the two shapes
export interface Preset {
  id: string;
  title: string;
  hint: string;
  len: number;
  item: Partial<TextItem> & { kind: Kind };
}
export const PRESETS: Preset[] = [
  {
    id: "default",
    title: "Default text",
    hint: "White, centred: type your own",
    len: 3,
    item: {
      kind: "text",
      text: "Default text",
      font: "sans",
      size: 64,
      x: 0.5,
      y: 0.5,
      align: "center",
    },
  },
  {
    id: "wordRise",
    title: "Word rise",
    hint: "Cinetic word-by-word masked baseline rise",
    len: 3,
    item: {
      kind: "text",
      text: "Every frame\ncarries weight",
      font: "sans",
      bold: true,
      size: 72,
      line: 1.15,
      x: 0.5,
      y: 0.5,
      align: "center",
      in: { fx: "wordRise", len: 0.55 },
      out: { fx: "clipDrop", len: 0.38 },
    },
  },
  {
    id: "accentInk",
    title: "Accent cool",
    hint: "Words flash electric cyan in OKLab and cool to crisp white",
    len: 3,
    item: {
      kind: "text",
      text: "BUILT IN 3D",
      font: "sans",
      bold: true,
      size: 84,
      spacing: 0.04,
      x: 0.5,
      y: 0.5,
      align: "center",
      in: { fx: "inkIn", len: 0.6, tint: "#38BDF8" },
      out: { fx: "blurExit", len: 0.4 },
    },
  },
  {
    id: "place",
    title: "Place and time",
    hint: "A documentary's lower-left line, typed on",
    len: 3.5,
    item: {
      kind: "text",
      text: "SEALED ROOM\n3:12 AM",
      font: "mono",
      size: 40,
      spacing: 0.06,
      line: 1.35,
      x: 0.07,
      y: 0.84,
      align: "left",
      in: { fx: "type", len: 1 },
      out: { fx: "fade", len: 0.5 },
    },
  },
  {
    id: "decode",
    title: "Glyph decode",
    hint: "Monospace telemetry readout locking left-to-right from cipher glyphs",
    len: 3,
    item: {
      kind: "text",
      text: "SECTOR 04 · LOCKED",
      font: "mono",
      size: 44,
      spacing: 0.08,
      x: 0.5,
      y: 0.84,
      align: "center",
      in: { fx: "scramble", len: 0.65 },
      out: { fx: "scrambleOut", len: 0.45 },
    },
  },
  {
    id: "chapter",
    title: "Chapter title",
    hint: "A serif card in the middle, faded in and out",
    len: 3,
    item: {
      kind: "text",
      text: "Chapter one",
      font: "serif",
      size: 96,
      x: 0.5,
      y: 0.5,
      align: "center",
      in: { fx: "fade", len: 0.8 },
      out: { fx: "fade", len: 0.8 },
    },
  },
  {
    id: "number",
    title: "Big number",
    hint: "A year or a count, large and bold",
    len: 2.5,
    item: {
      kind: "text",
      text: "1998",
      font: "sans",
      bold: true,
      size: 160,
      x: 0.5,
      y: 0.5,
      align: "center",
      in: { fx: "oversize", len: 0.45 },
      out: { fx: "collapseOut", len: 0.35 },
    },
  },
];
export const SHAPES: Preset[] = [
  {
    id: "arrow",
    title: "Arrow",
    hint: "Points at something: drag it there on the picture",
    len: 2.5,
    item: {
      kind: "arrow",
      size: 180,
      width: 10,
      color: "#E5484D",
      x: 0.5,
      y: 0.5,
      rotate: 30,
      in: { fx: "draw", len: 0.5 },
      out: { fx: "undraw", len: 0.4 },
    },
  },
  {
    id: "circle",
    title: "Circle",
    hint: "Rings something: drag it there on the picture",
    len: 2.5,
    item: {
      kind: "circle",
      w: 300,
      h: 190,
      width: 8,
      color: "#E5484D",
      x: 0.5,
      y: 0.5,
      in: { fx: "draw", len: 0.6 },
      out: { fx: "fade", len: 0.4 },
    },
  },
  {
    id: "box",
    title: "Frame box",
    hint: "Cinetic rounded callout frame drawn around a detail",
    len: 2.5,
    item: {
      kind: "box",
      w: 320,
      h: 190,
      width: 8,
      color: "#F5C542",
      x: 0.5,
      y: 0.5,
      in: { fx: "draw", len: 0.55 },
      out: { fx: "undraw", len: 0.4 },
    },
  },
  {
    id: "bracket",
    title: "Corner brackets",
    hint: "Tactical viewfinder L-brackets locking onto a subject",
    len: 2.5,
    item: {
      kind: "bracket",
      w: 300,
      h: 180,
      width: 8,
      color: "#3AA99F",
      x: 0.5,
      y: 0.5,
      in: { fx: "popIn", len: 0.38 },
      out: { fx: "collapseOut", len: 0.35 },
    },
  },
  {
    id: "underline",
    title: "Pen underline",
    hint: "Hand-arched emphasis stroke drawn beneath a key phrase",
    len: 2.5,
    item: {
      kind: "underline",
      size: 240,
      width: 9,
      color: "#E5484D",
      x: 0.5,
      y: 0.58,
      in: { fx: "draw", len: 0.5 },
      out: { fx: "undraw", len: 0.35 },
    },
  },
];

// A preset at the playhead (CapCut's + on a library tile), on the first track with room, picked
export const addPreset = (p: Preset) => {
  const from = r3(Math.min(S.t, Math.max(0, DURATION - p.len))),
    to = r3(Math.min(DURATION, from + p.len));
  let at = -1;
  edit((f) => {
    const it: TextItem = { ...structuredClone(p.item), from, to };
    it.track = freeTrack(f.items, from, to);
    f.items.push(it);
    at = f.items.length - 1;
  });
  pickText([at]);
  say(`${p.title} added at ${stamp(from)}. Drag it on the picture to place it`);
};
export const removeTexts = (is: number[]) => {
  const set_ = new Set(is.filter((i) => !locked(i)));
  if (!set_.size) {
    say("This text track is locked. Unlock it in the track header to edit");
    return;
  }
  edit((f) => {
    f.items = f.items.filter((_, i) => !set_.has(i));
  });
  pickText([]);
};
// Copies of items d seconds later (timeline/clipboard.ts), each on the first track with room; returns their places
export const pasteTexts = (copies: TextItem[], d: number) => {
  const got: number[] = [];
  edit((f) => {
    for (const c of copies) {
      const len = c.to - c.from,
        from = r3(Math.max(0, Math.min(DURATION - len, c.from + d)));
      const it = { ...structuredClone(c), from, to: r3(from + len) };
      it.track = freeTrack(f.items, it.from, it.to, c.track ?? 0);
      f.items.push(it);
      got.push(f.items.length - 1);
    }
  });
  return got;
};
// One change to every picked item, from the Text tab (CapCut styles every picked text at once)
export const editPicked = (change: (it: TextItem) => void, live = false) => {
  const is = get().textPicks.filter((i) => !locked(i));
  (live ? preview : edit)((f) => {
    for (const i of is) if (f.items[i]) change(f.items[i]);
  });
};

export const splitTexts = (is: number[], t = S.t) => {
  const hit = is.filter(
    (i) => !locked(i) && items[i] && t > items[i].from + 1 / FPS && t < items[i].to - 1 / FPS,
  );
  if (!hit.length) return;
  const made: number[] = [];
  edit((f) => {
    for (const i of hit) {
      const left = f.items[i],
        right = { ...structuredClone(left), from: r3(t) };
      left.to = r3(t);
      delete left.out;
      delete right.in;
      f.items.push(right);
      made.push(i, f.items.length - 1);
    }
  });
  pickText(made);
};

export const trimTexts = (is: number[], side: "left" | "right", t = S.t) => {
  const hit = is.filter(
    (i) => !locked(i) && items[i] && t > items[i].from + 1 / FPS && t < items[i].to - 1 / FPS,
  );
  if (hit.length)
    edit((f) => {
      for (const i of hit) f.items[i][side === "left" ? "from" : "to"] = r3(t);
    });
};
