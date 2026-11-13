// Pure metadata and picture-URL helpers shared by NoteList.tsx, notes.ts, scripts/at.ts and tests.
import { frameAt, type TimingClock } from "../../src/timing.mjs";

export interface NoteMediaSource {
  id: string;
  img?: string;
  crop?: unknown;
}

export interface QueuedNoteMedia {
  note: { id: string };
  img?: string | null;
  crop?: string | null;
}

export const resolveNoteMedia = (
  note: NoteMediaSource,
  unsentQueue: readonly QueuedNoteMedia[],
): { thumb: string | null; crop: string | null } => {
  const queued = unsentQueue.find((x) => x.note.id === note.id);
  const thumb = note.img ? `/api/note-img/${note.id}.jpg` : (queued?.img ?? null);
  const crop =
    typeof note.crop === "string" && note.crop
      ? `/api/note-img/${note.id}_crop.jpg`
      : (queued?.crop ?? null);
  return { thumb, crop };
};

// Strip developer file provenance like "silverfish (src/silverfish.ts, game model)" -> "silverfish" for compact card chips
export const pinShortLabel = (what: string | undefined | null): string | null => {
  const trimmed = what?.trim() ?? "";
  if (!trimmed) return null;
  const match = /^(.+?)\s+\([^()]+\)$/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
};

export const noteShotTitle = (
  shot: number,
  shotName?: string,
): { primary: string; secondary: string | null; full: string } => {
  const primary = `Shot ${shot}`;
  const secondary = shotName?.trim() || null;
  return {
    primary,
    secondary,
    full: secondary ? `${primary} · ${secondary}` : primary,
  };
};

export const noteRangePill = (note: {
  marks?: unknown;
  range?: unknown;
  [key: string]: unknown;
}): [number, number] | null => {
  if (Array.isArray(note.marks) && note.marks.length > 0) return null;
  if (!Array.isArray(note.range) || note.range.length !== 2) return null;
  const [a, b] = note.range;
  return typeof a === "number" &&
    typeof b === "number" &&
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    b > a
    ? [a, b]
    : null;
};

interface NoteWhere {
  scene?: unknown;
  shot?: number;
  shotName?: string;
  context?: { shot?: { into?: unknown } };
}

// The scene second a note's picture is at now: the one kept with it (since 2026-11-13), else its place in its shot, the shot
// found by name since shots added or removed before it renumber it. shots: today's, in scene seconds, with their names.
// The studio's note list and bun run at both place notes with this, so they agree
export const noteScene = (n: NoteWhere, shots: readonly { t: number; name?: string }[]) => {
  if (typeof n.scene === "number") return { at: n.scene, shot: null };
  const into = n.context?.shot?.into;
  if (typeof into !== "number" || n.shot == null) return null;
  const named = n.shotName ? shots.flatMap((s, i) => (s.name === n.shotName ? [i] : [])) : [];
  const i = named.includes(n.shot)
    ? n.shot
    : (named[0] ?? (!n.shotName || shots[n.shot]?.name === undefined ? n.shot : -1));
  return shots[i] ? { at: shots[i].t + into, shot: i } : null;
};

// Where a note is heard now: its picture (noteScene) through today's Speed and Freeze, else its narration second, which follows
// voice edits but not Speed or Freeze. A held picture is heard over a stretch: a note whose own second still shows its picture
// stays there; moved, it goes to the picture's first heard second
export const noteSecond = (
  n: NoteWhere & { t: number; srcT?: number | null },
  fromSource: (s: number) => number,
  clock: TimingClock,
  shots: readonly { t: number; name?: string }[] = [],
) => {
  const s = noteScene(n, shots);
  if (!s) return n.srcT != null ? fromSource(n.srcT) : n.t;
  if (Math.abs(frameAt(clock, n.t) - s.at) < 0.002) return n.t; // seconds are kept to the millisecond
  return clock.outputAt(s.at, "before");
};
