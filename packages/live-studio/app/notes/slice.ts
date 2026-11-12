// The notes' part of the page state (core/store.ts): the notes, the one being written and what is drawn on it
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
  approved?: string;
  remember?: Remember; // the creator asked the AI to keep what this note teaches
  learned?: { what: string; scope: Remember["scope"]; at: string }; // and what the AI kept, where
  [key: string]: unknown;
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

// The list's search and menus (NoteList.tsx), as Frame.io's comments panel: Show narrows it to drawn notes or the shot under the
// playhead, Sort orders the notes to fix by film time or by when they were written
export type NoteShow = "all" | "drawn" | "shot";
export type NoteSort = "film" | "newest" | "oldest";

export interface NotesSlice {
  notes: Note[];
  noteSearch: string;
  noteShow: NoteShow;
  noteSort: NoteSort;
  saved: "busy" | "fail" | null;
  compose: Compose | null;
  draft: string;
  nearNote: string | null;
  ink: InkKind | null; // the drawing tool in hand, null when a tap on the picture pins a note
  inkSaid: string; // what is drawn on the note being written ("" when nothing): "3 strokes across 2 moments: 0:54 → 0:56"
  review: boolean; // the Review room (ReviewRoom.tsx) in place of the timeline and the panels
  reviewTab: NoteState;
  reviewPick: string | null; // the note open in the room
}
export const notesSlice: NotesSlice = {
  notes: [],
  noteSearch: "",
  noteShow: "all",
  noteSort: "film",
  saved: null,
  compose: null,
  draft: "",
  nearNote: null,
  ink: null,
  inkSaid: "",
  review: false,
  reviewTab: "check",
  reviewPick: null,
};
