import type { NoteCompareSource } from "../picture/compare-video-model";
import type { NoteFreeView } from "./note-card-meta";
import type { NoteView } from "./note-views-model";

export interface Pin {
  x: number;
  y: number;
  what: string;
  world?: number[];
}
export interface Fix {
  what: string;
  checkpoint?: string;
  at: string;
  ask?: boolean;
  after?: string;
  noAfterReason?: string;
  t?: number;
  cam?: {
    p: number[];
    l: number[];
    fov?: number;
    roll?: number;
    wave?: number;
  };
}
export type NoteState = "open" | "check" | "done";
export interface Remember {
  scope: "film" | "all";
  at: string;
}
export interface Note {
  id: string;
  at: string;
  t: number;
  time: string;
  frame: number;
  shot: number;
  shotName?: string;
  srcT?: number;
  text: string;
  done: boolean;
  pin?: Pin | null;
  freeCam?: boolean;
  compareVideo?: NoteCompareSource;
  staleBuild?: boolean;
  img?: string;
  fixes?: Fix[];
  state?: NoteState;
  asks?: { text: string; at: string }[];
  edits?: { at?: string; was: string }[];
  approved?: string;
  remember?: Remember;
  learned?: { what: string; scope: Remember["scope"]; at: string };
  [key: string]: unknown;
}
export interface RefStroke {
  color: string;
  size: number;
  pts: [number, number, number][];
}
export interface RefPic {
  id: string;
  src: string;
  strokes: RefStroke[];
  url: string;
}
export interface StageAnchor {
  x: number;
  y: number;
}
export interface ComposeCreate {
  kind: "create";
  t: number;
  shot: number;
  shotName: string;
  pin: Pin | null;
  anchor?: StageAnchor;
  resume: boolean;
  wasPlaying?: boolean;
  spoken?: string;
  compareVideo?: NoteCompareSource;
}
export interface ComposeEdit {
  kind: "edit";
  id: string;
  time: string;
  original: string;
  t: number;
  shot: number;
  shotName: string;
  pin: null;
  resume: boolean;
}
export type Compose = ComposeCreate | ComposeEdit;

export const isComposeDirty = (
  compose: Compose | null,
  words: string,
  hasInk: boolean,
): boolean => {
  if (!compose) return false;
  const trimmed = words.trim();
  return compose.kind === "edit"
    ? Boolean(trimmed && trimmed !== compose.original.trim())
    : Boolean(trimmed || hasInk);
};

const normalizePin = (raw: unknown): Pin | null => {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (
    typeof p.x !== "number" ||
    !Number.isFinite(p.x) ||
    typeof p.y !== "number" ||
    !Number.isFinite(p.y) ||
    typeof p.what !== "string"
  )
    return null;
  return {
    x: p.x,
    y: p.y,
    what: p.what,
    ...(Array.isArray(p.world) &&
    p.world.every((n): n is number => typeof n === "number" && Number.isFinite(n))
      ? { world: p.world }
      : {}),
  };
};

const normalizeAnchor = (raw: unknown): StageAnchor | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  if (
    typeof a.x !== "number" ||
    !Number.isFinite(a.x) ||
    typeof a.y !== "number" ||
    !Number.isFinite(a.y)
  )
    return undefined;
  return { x: Math.min(1, Math.max(0, a.x)), y: Math.min(1, Math.max(0, a.y)) };
};

const normalizeCompareSource = (raw: unknown): NoteCompareSource | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  if (typeof v.path !== "string" || !v.path) return undefined;
  if (v.category !== "compare" && v.category !== "render" && v.category !== "reference")
    return undefined;
  if (v.layout !== "hstack" && v.layout !== "vstack" && v.layout !== "single") return undefined;
  return {
    path: v.path,
    category: v.category,
    layout: v.layout,
    ...(typeof v.startSec === "number" && Number.isFinite(v.startSec) && v.startSec > 0
      ? { startSec: v.startSec }
      : {}),
  };
};

export const normalizeStoredCompose = (raw: unknown): Compose | null => {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (
    typeof c.t !== "number" ||
    !Number.isFinite(c.t) ||
    typeof c.shot !== "number" ||
    !Number.isFinite(c.shot)
  )
    return null;
  if (c.kind === "edit" || typeof c.editing === "string") {
    const id = typeof c.id === "string" ? c.id : typeof c.editing === "string" ? c.editing : "";
    if (!id) return null;
    return {
      kind: "edit",
      id,
      time: typeof c.time === "string" ? c.time : "",
      original: typeof c.original === "string" ? c.original : "",
      t: c.t,
      shot: c.shot,
      shotName: typeof c.shotName === "string" ? c.shotName : "",
      pin: null,
      resume: false,
    };
  }
  const pin = normalizePin(c.pin);
  const anchor = normalizeAnchor(c.anchor) ?? (pin ? { x: pin.x, y: pin.y } : undefined);
  const compareVideo = normalizeCompareSource(c.compareVideo);
  return {
    kind: "create",
    t: c.t,
    shot: c.shot,
    shotName: typeof c.shotName === "string" ? c.shotName : "",
    pin,
    ...(anchor ? { anchor } : {}),
    resume: false,
    ...(typeof c.wasPlaying === "boolean" ? { wasPlaying: c.wasPlaying } : {}),
    ...(typeof c.spoken === "string" ? { spoken: c.spoken } : {}),
    ...(compareVideo ? { compareVideo } : {}),
  };
};
export type InkKind = "pen" | "arrow" | "box" | "path";
export interface Hit {
  what: string;
  world?: number[];
}
export interface Mark {
  kind: InkKind;
  t: number;
  pts: [number, number][];
  ts?: number[];
  hits?: Hit[];
}

export type ReviewTab = NoteState | "asking";
export type NoteStatusFilter = "all" | NoteState | "asking";
export type NoteScope = "all" | "shot";
export type NoteFacet =
  "needsWork" | "asking" | "readyFix" | "drawn" | "pinned" | "refs" | "freeCam" | "learned";
export type NoteSort = "film" | "activity" | "newest" | "oldest";

export type NoteComposeState =
  | { status: "closed" }
  | { status: "create-editing"; compose: ComposeCreate; draft: string; refs: RefPic[] }
  | { status: "create-saving"; compose: ComposeCreate; draft: string; refs: RefPic[] }
  | { status: "edit-editing"; compose: ComposeEdit; draft: string }
  | { status: "edit-saving"; compose: ComposeEdit; draft: string };

const EMPTY_NOTE_REFS: readonly RefPic[] = [];

export const noteComposeOf = (s: { composeState: NoteComposeState }): Compose | null =>
  s.composeState.status === "closed" ? null : s.composeState.compose;

export const noteSavingOf = (s: { composeState: NoteComposeState }): boolean =>
  s.composeState.status === "create-saving" || s.composeState.status === "edit-saving";

export const noteDraftOf = (s: { composeState: NoteComposeState }): string =>
  s.composeState.status === "closed" ? "" : s.composeState.draft;

export const noteRefsOf = (s: { composeState: NoteComposeState }): readonly RefPic[] =>
  s.composeState.status === "create-editing" || s.composeState.status === "create-saving"
    ? s.composeState.refs
    : EMPTY_NOTE_REFS;

export interface NotesSlice {
  noteReturn: {
    at: number;
    clock: import("../../src/timing.mjs").TimingClock;
    free?: boolean;
    view?: NoteFreeView;
    compareVideo?: { on: boolean; path: string | null };
  } | null;
  reviewTarget: string | null;
  notes: Note[];
  noteSearch: string;
  noteStatus: NoteStatusFilter;
  noteScope: NoteScope;
  noteShot: number | null;
  noteFacets: NoteFacet[];
  noteSort: NoteSort;
  noteView: NoteView;
  saved: "busy" | "fail" | null;
  composeState: NoteComposeState;
  replyDrafts: ReadonlyMap<string, string>;
  nearNote: string | null;
  ink: InkKind | null;
  inkDrawing: boolean;
  inkSaid: string;
  review: boolean;
  reviewTab: ReviewTab;
  reviewPick: string | null;
}
export const notesSlice: NotesSlice = {
  noteReturn: null,
  reviewTarget: null,
  notes: [],
  noteSearch: "",
  noteStatus: "all",
  noteScope: "all",
  noteShot: null,
  noteFacets: [],
  noteSort: "film",
  noteView: "cards",
  saved: null,
  composeState: { status: "closed" },
  replyDrafts: new Map(),
  nearNote: null,
  ink: null,
  inkDrawing: false,
  inkSaid: "",
  review: false,
  reviewTab: "check",
  reviewPick: null,
};
