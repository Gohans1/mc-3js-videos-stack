// The notes' part of the page state (core/store.ts): the notes, the one being written and what is drawn on it
export interface Pin { x: number; y: number; what: string; world?: number[] }
export interface Fix { what: string; checkpoint?: string; at: string }
export interface Note {
  id: string; at: string; t: number; time: string; frame: number; shot: number; shotName?: string; srcT?: number;
  text: string; done: boolean; pin?: Pin | null; freeCam?: boolean; img?: string; fixes?: Fix[]; [key: string]: unknown;
}
// The note being written: where it is about, and whether the film plays on once it's sent
export interface Compose {
  t: number; shot: number; shotName: string; pin: Pin | null; resume: boolean; wasPlaying?: boolean; spoken?: string;
  editing?: string; time?: string; original?: string;
}
// What a drawn note holds (ink.ts): strokes in fractions of the picture, each at the film second it was drawn on. A path is
// one point per moment ("here at 1:10, then here at 1:12"); hits name what lies under its key points, as a pin's tap does
export type InkKind = "pen" | "arrow" | "box" | "path";
export interface Hit { what: string; world?: number[] }
export interface Mark { kind: InkKind; t: number; pts: [number, number][]; ts?: number[]; hits?: Hit[] }

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
}
export const notesSlice: NotesSlice = { notes: [], noteSearch: "", noteShow: "all", noteSort: "film", saved: null, compose: null, draft: "", nearNote: null, ink: null, inkSaid: "" };
