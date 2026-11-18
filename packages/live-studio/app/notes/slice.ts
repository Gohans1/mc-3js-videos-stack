// The notes' part of the page state (core/store.ts): the notes, the one being written and what is drawn on it
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
  ask?: boolean; // a question from the AI, not a fix: it wants an answer, not an approval
}
// Where a note stands (src/note-state.mjs, which decides every change): to fix, waiting for the creator's check, approved
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
  img?: string;
  fixes?: Fix[];
  state?: NoteState;
  asks?: { text: string; at: string }[]; // the creator's words back after a fix or a question
  edits?: { at?: string; was: string }[]; // earlier creator wordings before an edit
  approved?: string;
  remember?: Remember; // the creator asked the AI to keep what this note teaches
  learned?: { what: string; scope: Remember["scope"]; at: string }; // and what the AI kept, where
  [key: string]: unknown;
}
// A picture the creator pasted into the note being written (refs.ts): src as pasted (made a JPEG, its long side at most
// REF_SIDE), the strokes drawn on it in its pixels (RefSketch.tsx), url the two flattened, which is what is sent
export interface RefStroke {
  color: string;
  size: number;
  pts: [number, number, number][]; // x, y, pressure
}
export interface RefPic {
  id: string;
  src: string;
  strokes: RefStroke[];
  url: string;
}
// The note being written: either a fresh note on a moment/pin ("create") or editing an existing note's text ("edit")
export interface ComposeCreate {
  kind: "create";
  t: number;
  shot: number;
  shotName: string;
  pin: Pin | null;
  resume: boolean;
  wasPlaying?: boolean;
  spoken?: string;
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
  return {
    kind: "create",
    t: c.t,
    shot: c.shot,
    shotName: typeof c.shotName === "string" ? c.shotName : "",
    pin: normalizePin(c.pin),
    resume: false,
    ...(typeof c.wasPlaying === "boolean" ? { wasPlaying: c.wasPlaying } : {}),
    ...(typeof c.spoken === "string" ? { spoken: c.spoken } : {}),
  };
};
// What a drawn note holds (ink.ts): strokes in fractions of the picture, each at the film second it was drawn on. A path is
// one point per moment ("here at 1:10, then here at 1:12"); hits name what lies under its key points, as a pin's tap does
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

// The list's search, status pills, facets and sort (NoteList.tsx): narrows by status, shot, attachments, thread state and sort order
export type ReviewTab = NoteState | "asking";
export type NoteStatusFilter = "all" | NoteState | "asking";
export type NoteScope = "all" | "shot";
export type NoteFacet =
  "needsWork" | "asking" | "readyFix" | "drawn" | "pinned" | "refs" | "freeCam" | "learned";
export type NoteSort = "film" | "activity" | "newest" | "oldest";

export interface NotesSlice {
  noteReturn: { at: number; clock: import("../../src/timing.mjs").TimingClock } | null;
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
  compose: Compose | null;
  noteSaving: boolean;
  draft: string;
  replyDrafts: ReadonlyMap<string, string>;
  refs: RefPic[]; // the note being written's pasted pictures
  nearNote: string | null;
  ink: InkKind | null; // the drawing tool in hand, null when a tap on the picture pins a note
  inkSaid: string; // what is drawn on the note being written ("" when nothing): "3 strokes across 2 moments: 0:54 → 0:56"
  review: boolean; // the Review room (ReviewRoom.tsx) in place of the timeline and the panels
  reviewTab: ReviewTab;
  reviewPick: string | null; // the note open in the room
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
  compose: null,
  noteSaving: false,
  draft: "",
  replyDrafts: new Map(),
  refs: [],
  nearNote: null,
  ink: null,
  inkSaid: "",
  review: false,
  reviewTab: "check",
  reviewPick: null,
};
