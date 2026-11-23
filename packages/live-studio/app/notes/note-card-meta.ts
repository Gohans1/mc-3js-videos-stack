import { frameAt, frameVisible, type TimingClock, visibleOutputAt } from "../../src/timing.mjs";
import type { Fix } from "./slice";

export interface NoteMediaSource {
  id: string;
  img?: string;
  crop?: unknown;
  refs?: unknown;
  fixes?: Fix[];
}

export interface QueuedNoteMedia {
  note: { id: string };
  img?: string | null;
  crop?: string | null;
  refs?: string[];
}

const SAFE_NOTE_IMG_RE = /^[a-z0-9]+(?:_crop|_strip|_f\d+|_r\d+|_fix\d+)?\.(?:jpg|jpeg|png|webp)$/;

const noteImgUrl = (rel: unknown): string | null => {
  if (typeof rel !== "string" || !rel) return null;
  const file = rel.split("/").pop() ?? "";
  return SAFE_NOTE_IMG_RE.test(file) ? `/api/note-img/${file}` : null;
};

const resolveFixCam = (cam: Fix["cam"]): NoteFreeView | null => {
  if (!cam || typeof cam !== "object") return null;
  const p = vec3Tuple(cam.p);
  const l = vec3Tuple(cam.l);
  if (!p || !l) return null;
  return {
    p,
    l,
    ...(typeof cam.fov === "number" && Number.isFinite(cam.fov) ? { fov: cam.fov } : {}),
    ...(typeof cam.roll === "number" && Number.isFinite(cam.roll) ? { roll: cam.roll } : {}),
    ...(typeof cam.wave === "number" && Number.isFinite(cam.wave) ? { wave: cam.wave } : {}),
  };
};

export const latestEvidenceFix = (fixes: readonly Fix[] | undefined): Fix | null => {
  if (!fixes?.length) return null;
  for (let i = fixes.length - 1; i >= 0; i--) {
    const f = fixes[i];
    if (f.after || f.noAfterReason || f.cam || typeof f.t === "number") return f;
    if (!f.ask) return f;
  }
  return fixes.at(-1) ?? null;
};

export interface ResolvedNoteMedia {
  thumb: string | null;
  crop: string | null;
  refs: string[];
  after: string | null;
  noAfterReason: string | null;
  afterCam: NoteFreeView | null;
  afterTime: number | null;
}

export const resolveNoteMedia = (
  note: NoteMediaSource,
  unsentQueue: readonly QueuedNoteMedia[],
): ResolvedNoteMedia => {
  const queued = unsentQueue.find((x) => x.note.id === note.id);
  const thumb = note.img ? `/api/note-img/${note.id}.jpg` : (queued?.img ?? null);
  const crop =
    typeof note.crop === "string" && note.crop
      ? `/api/note-img/${note.id}_crop.jpg`
      : (queued?.crop ?? null);
  const refs = Array.isArray(note.refs)
    ? note.refs.map((r) => `/api/note-img/${String(r).split("/").pop()}`)
    : (queued?.refs ?? []);
  const fix = latestEvidenceFix(note.fixes);
  const after = fix ? noteImgUrl(fix.after) : null;
  const noAfterReason =
    fix && !after && typeof fix.noAfterReason === "string" && fix.noAfterReason.trim()
      ? fix.noAfterReason.trim()
      : null;
  const afterCam = fix ? resolveFixCam(fix.cam) : null;
  const afterTime =
    fix && typeof fix.t === "number" && Number.isFinite(fix.t) && fix.t >= 0 ? fix.t : null;
  return { thumb, crop, refs, after, noAfterReason, afterCam, afterTime };
};

export const pinShortLabel = (what: string | undefined | null): string | null => {
  const trimmed = what?.trim() ?? "";
  if (!trimmed) return null;
  const match = /^(.+?)\s+\([^()]+\)$/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
};

export const noteNumberMap = (
  notes: readonly { id: string }[],
  headerJson?: string | null,
): Record<string, number> => {
  if (headerJson) {
    try {
      const parsed = JSON.parse(headerJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, number> = {};
        let valid = true;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
            valid = false;
            break;
          }
          out[k] = v;
        }
        if (valid) return out;
      }
    } catch {}
  }
  const fallback: Record<string, number> = {};
  notes.forEach((n, i) => {
    fallback[n.id] = i + 1;
  });
  return fallback;
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

export const noteActionTarget = (num: number | null, timeText: string): string =>
  num != null ? `#${num} at ${timeText}` : `at ${timeText}`;

export const modKeyLabel = (): string =>
  typeof navigator !== "undefined" &&
  /Mac|iP(ad|hone|od)/.test(navigator.platform || navigator.userAgent)
    ? "⌘"
    : "Ctrl+";

export const noteSecond = (
  n: NoteWhere & { t: number; srcT?: number | null },
  fromSource: (s: number) => number,
  clock: TimingClock,
  shots: readonly { t: number; name?: string }[] = [],
) => {
  const hasT = typeof n.t === "number" && Number.isFinite(n.t) && n.t >= 0;
  const s = noteScene(n, shots);
  if (!s) return typeof n.srcT === "number" && Number.isFinite(n.srcT) ? fromSource(n.srcT) : n.t;
  const matches = hasT && Math.abs(frameAt(clock, n.t) - s.at) < 0.002;
  if (matches && frameVisible(clock, n.t)) return n.t;
  return visibleOutputAt(clock, s.at) ?? (matches ? n.t : clock.outputAt(s.at, "before"));
};

export interface NoteFreeView {
  p: readonly [number, number, number];
  l: readonly [number, number, number];
  fov?: number;
  roll?: number;
  wave?: number;
  bob?: number;
  fstop?: number;
  focus?: unknown;
  handheld?: unknown;
}

const vec3Tuple = (raw: unknown): [number, number, number] | null => {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const x = Number(raw[0]),
    y = Number(raw[1]),
    z = Number(raw[2]);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : null;
};

const lineNumber = (line: string | undefined, key: string): number | undefined => {
  if (!line) return undefined;
  const m = new RegExp(`\\b${key}:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(line);
  if (!m) return undefined;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : undefined;
};

const lineTriple = (line: string | undefined, key: string): [number, number, number] | null => {
  if (!line) return null;
  const m = new RegExp(
    `\\b${key}:\\s*\\[\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\]`,
  ).exec(line);
  if (!m) return null;
  return vec3Tuple([Number(m[1]), Number(m[2]), Number(m[3])]);
};

export const noteFreeView = (note: { freeCam?: boolean; cam?: unknown }): NoteFreeView | null => {
  if (!note.freeCam || !note.cam || typeof note.cam !== "object") return null;
  const cam = note.cam as Record<string, unknown>;
  const line = typeof cam.line === "string" ? cam.line : undefined;
  const world =
    cam.world && typeof cam.world === "object" ? (cam.world as Record<string, unknown>) : null;
  const p = vec3Tuple(world?.p) ?? lineTriple(line, "p");
  const l = vec3Tuple(world?.l) ?? lineTriple(line, "l");
  if (!p || !l) return null;
  const hasModernWorld = typeof world?.fov === "number";
  const fovRaw = hasModernWorld ? (world!.fov as number) : lineNumber(line, "fov");
  const rollRaw =
    typeof world?.roll === "number"
      ? world.roll
      : hasModernWorld
        ? undefined
        : lineNumber(line, "roll");
  const waveRaw =
    typeof world?.wave === "number"
      ? world.wave
      : hasModernWorld
        ? undefined
        : lineNumber(line, "wave");
  const bobRaw = typeof world?.bob === "number" ? world.bob : undefined;
  const fstopRaw = typeof world?.fstop === "number" ? world.fstop : undefined;
  return {
    p,
    l,
    ...(typeof fovRaw === "number" && Number.isFinite(fovRaw) ? { fov: fovRaw } : {}),
    ...(typeof rollRaw === "number" && Number.isFinite(rollRaw) ? { roll: rollRaw } : {}),
    ...(typeof waveRaw === "number" && Number.isFinite(waveRaw) ? { wave: waveRaw } : {}),
    ...(typeof bobRaw === "number" && Number.isFinite(bobRaw) ? { bob: bobRaw } : {}),
    ...(typeof fstopRaw === "number" && Number.isFinite(fstopRaw) ? { fstop: fstopRaw } : {}),
    ...(world && "focus" in world && world.focus !== undefined
      ? { focus: structuredClone(world.focus) }
      : {}),
    ...(world && "handheld" in world && world.handheld !== undefined
      ? { handheld: structuredClone(world.handheld) }
      : {}),
  };
};
