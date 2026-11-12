import type { Note, NoteState } from "../app/notes/slice";

export type NoteChange =
  | { fix: { what: string; ask?: boolean; checkpoint?: string } }
  | { done: boolean }
  | { approve: true }
  | { again: string }
  | { text: string }
  | { remember: "film" | "all" | null }
  | { learned: { what: string } };
export interface ThreadLine {
  by: "creator" | "ai";
  text: string;
  at: string;
  ask?: boolean;
  checkpoint?: string;
}
export const STATES: NoteState[];
export function noteState(n: Partial<Note>): NoteState;
export function applyChange(
  n: Note,
  change: NoteChange,
  at?: string,
): { ok: true } | { ok: false; why: string };
export function noteThread(n: Note): ThreadLine[];
