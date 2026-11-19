import type { Note, NoteState } from "../app/notes/slice";

export interface FixCam {
  p: number[];
  l: number[];
  fov?: number;
  roll?: number;
  wave?: number;
}

export type NoteChange =
  | {
      fix: {
        what: string;
        ask?: boolean;
        checkpoint?: string;
        after?: string;
        afterData?: string;
        noAfterReason?: string;
        t?: number;
        cam?: FixCam;
      };
    }
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
  after?: string;
  noAfterReason?: string;
  t?: number;
  cam?: FixCam;
  reworded?: boolean;
}
export const WORD_NEAR: number;
export const STATES: NoteState[];
export function noteState(n: Partial<Note>): NoteState;
export function wholeNote(n: unknown): boolean;
export function applyChange(
  n: Note,
  change: NoteChange,
  at?: string,
): { ok: true } | { ok: false; why: string };
export function noteThread(n: Note, options?: { rewordings?: boolean }): ThreadLine[];
