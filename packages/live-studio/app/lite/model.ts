import {
  compareHitForPoint,
  type CompareVideoCatalog,
  type CompareVideoCategory,
  type CompareVideoItem,
  type CompareVideoLayout,
  defaultCompareLayout,
  type NoteCompareSource,
  pickDefaultLiteVideo,
} from "../../src/compare-video-meta.ts";
import { FPS, SAME, stamp } from "../core/time.ts";
import { compareLayoutBadge } from "../picture/compare-video-model.ts";
import type {
  Compose,
  Fix,
  Hit,
  LiteShot,
  Mark,
  Note,
  NoteChange,
  NoteState,
  OutgoingNote,
  Pin,
  ScrubberMark,
} from "./types.ts";

export const pickDefaultVideoPath = (
  catalog: CompareVideoCatalog | null | undefined,
): string | null => {
  if (!catalog?.videos.length) return null;
  const picked = pickDefaultLiteVideo(catalog.videos);
  if (picked) return picked;
  if (catalog.defaultPath && catalog.videos.some((v) => v.path === catalog.defaultPath)) {
    return catalog.defaultPath;
  }
  return catalog.videos[0]?.path ?? null;
};

export interface VideoCategoryGroup {
  category: CompareVideoCategory;
  label: string;
  items: CompareVideoItem[];
}

export const groupVideosByCategory = (
  videos: readonly CompareVideoItem[],
  filmRatio = "16:9",
): VideoCategoryGroup[] => {
  const pairLabel = compareLayoutBadge("compare", defaultCompareLayout("compare", filmRatio));
  const groups: { category: CompareVideoCategory; label: string }[] = [
    { category: "compare", label: `Compare (${pairLabel})` },
    { category: "render", label: "Renders" },
    { category: "reference", label: "Reference" },
  ];
  return groups
    .map((g) => ({
      ...g,
      items: videos.filter((v) => v.category === g.category),
    }))
    .filter((g) => g.items.length > 0);
};

export const folderHint = (path: string): string => {
  const parts = path.split("/");
  return parts.length > 1 ? `${parts.slice(0, -1).join("/")}/` : "";
};

export const STATES: readonly NoteState[] = ["open", "check", "done"];

export const noteState = (n: Pick<Note, "state" | "done">): NoteState =>
  n.state && STATES.includes(n.state) ? n.state : n.done ? "done" : "open";

const setNoteState = (n: Note, state: NoteState) => {
  n.state = state;
  n.done = state !== "open";
};

export const applyNoteChange = (
  n: Note,
  change: NoteChange,
  at = new Date().toISOString(),
): { ok: true } | { ok: false; why: string } => {
  const keys = Object.keys(change);
  if (keys.length !== 1) return { ok: false, why: `expected 1 change key, got ${keys.join(", ")}` };

  if ("done" in change) {
    if (!change.done) {
      setNoteState(n, "open");
      return { ok: true };
    }
    if (noteState(n) === "done") return { ok: true };
    n.fixes = [...(n.fixes ?? []), { what: "marked done", at }];
    setNoteState(n, "check");
    return { ok: true };
  }

  if ("approve" in change) {
    if (noteState(n) !== "check") {
      return { ok: false, why: "nothing to approve: the AI has not answered this note" };
    }
    if (n.fixes?.at(-1)?.ask) {
      return { ok: false, why: "the AI asked a question here: answer it (again) instead" };
    }
    n.approved = at;
    setNoteState(n, "done");
    return { ok: true };
  }

  if ("again" in change) {
    if (typeof change.again !== "string" || !change.again.trim()) {
      return { ok: false, why: "again takes the creator's words" };
    }
    n.asks = [...(n.asks ?? []), { text: change.again, at }];
    setNoteState(n, "open");
    return { ok: true };
  }

  if ("text" in change) {
    if (typeof change.text !== "string") {
      return { ok: false, why: "text takes the note's new words" };
    }
    if (change.text !== n.text) {
      n.edits = [...(n.edits ?? []), { at, was: n.text }];
    }
    n.text = change.text;
    setNoteState(n, "open");
    return { ok: true };
  }

  if ("remember" in change) {
    if (change.remember === null) {
      delete n.remember;
      return { ok: true };
    }
    if (change.remember === "film" || change.remember === "all") {
      n.remember = { scope: change.remember, at };
      return { ok: true };
    }
    return { ok: false, why: 'remember takes "film", "all" or null' };
  }

  return { ok: false, why: `unknown change: ${keys[0]}` };
};

export const isNoteAsking = (n: Pick<Note, "fixes">, state: NoteState): boolean =>
  state === "check" && Boolean(n.fixes?.at(-1)?.ask);

export interface NotePriorEntry {
  by: "creator" | "ai";
  text: string;
  at: string;
  ask?: boolean;
  checkpoint?: string;
  reworded?: boolean;
}

export interface NoteThreadSummary {
  activeFix: Fix | null;
  activeAsk: { text: string; at?: string } | null;
  prior: NotePriorEntry[];
}

export const summarizeNoteThread = (
  note: Pick<Note, "fixes" | "asks" | "edits">,
  state: NoteState,
): NoteThreadSummary => {
  const fixes = note.fixes ?? [];
  const asks = note.asks ?? [];
  const edits = note.edits ?? [];
  const lastFix = fixes.at(-1) ?? null;
  const lastAsk = asks.at(-1) ?? null;

  let activeAsk: { text: string; at?: string } | null = null;
  let activeFix: Fix | null = null;

  if (state === "open") {
    if (lastAsk && (!lastFix || (lastAsk.at ?? "") >= (lastFix.at ?? ""))) {
      activeAsk = lastAsk;
    } else if (lastFix) {
      activeFix = lastFix;
    }
  } else {
    activeFix = lastFix;
  }

  const prior: NotePriorEntry[] = [
    ...fixes
      .filter((f) => f !== activeFix)
      .map(
        (f): NotePriorEntry => ({
          by: "ai",
          text: f.what,
          at: f.at ?? "",
          ask: !!f.ask,
          checkpoint: f.checkpoint,
        }),
      ),
    ...asks
      .filter((a) => a !== activeAsk)
      .map(
        (a): NotePriorEntry => ({
          by: "creator",
          text: a.text,
          at: a.at ?? "",
        }),
      ),
    ...edits.map(
      (e): NotePriorEntry => ({
        by: "creator",
        text: e.was,
        at: e.at ?? "",
        reworded: true,
      }),
    ),
  ].toSorted((a, b) => (a.at > b.at ? 1 : a.at < b.at ? -1 : 0));

  return { activeFix, activeAsk, prior };
};

export const isCreatorNeedsWork = (
  note: Pick<Note, "fixes" | "asks" | "edits">,
  state: NoteState,
): boolean => state === "open" && summarizeNoteThread(note, state).activeAsk !== null;

export const isComposeDirty = (
  compose: Compose | null,
  words: string,
  hasExtra: boolean,
): boolean => {
  if (!compose) return false;
  const trimmed = words.trim();
  return compose.kind === "edit"
    ? Boolean(trimmed && trimmed !== compose.original.trim())
    : Boolean(trimmed || hasExtra);
};

export const shotAtTime = (
  shots: readonly LiteShot[],
  duration: number,
  t: number,
): { index: number; name: string; from: number; to: number; into: number } => {
  const safeT = Number.isFinite(t) && t >= 0 ? t : 0;
  const safeDur = Number.isFinite(duration) && duration > 0 ? duration : safeT;
  if (!shots.length) {
    return {
      index: 0,
      name: "",
      from: 0,
      to: +safeDur.toFixed(3),
      into: +safeT.toFixed(3),
    };
  }
  let idx = 0;
  for (let i = 0; i < shots.length; i++) {
    if (shots[i]!.t <= safeT + 1e-4) idx = i;
    else break;
  }
  const cur = shots[idx]!;
  const next = shots[idx + 1];
  const from = cur.t;
  const to = next ? next.t : Math.max(safeDur, from);
  return {
    index: idx,
    name: cur.name ?? "",
    from: +from.toFixed(3),
    to: +to.toFixed(3),
    into: +Math.max(0, safeT - from).toFixed(3),
  };
};

const pointSegmentDist = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

const rdpSimplify = (pts: [number, number][], eps: number): [number, number][] => {
  if (pts.length <= 2) return pts.slice();
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  let best = -1;
  let maxD = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointSegmentDist(pts[i]!, a, b);
    if (d > maxD) {
      maxD = d;
      best = i;
    }
  }
  if (maxD <= eps || best < 0) return [a, b];
  const left = rdpSimplify(pts.slice(0, best + 1), eps);
  const right = rdpSimplify(pts.slice(best), eps);
  return [...left.slice(0, -1), ...right];
};

export const simplifyPenPoints = (
  pts: [number, number][],
  epsilon = 0.015,
  maxPts = 6,
): [number, number][] => {
  if (pts.length <= 2) return pts.slice();
  const out = rdpSimplify(pts, epsilon);
  const cap = Math.max(2, maxPts);
  while (out.length > cap) {
    let drop = 1;
    let minD = Infinity;
    for (let i = 1; i < out.length - 1; i++) {
      const d = pointSegmentDist(out[i]!, out[i - 1]!, out[i + 1]!);
      if (d < minD) {
        minD = d;
        drop = i;
      }
    }
    out.splice(drop, 1);
  }
  return out;
};

export const markHitsForCompare = (
  mark: Mark,
  category: CompareVideoCategory,
  layout: CompareVideoLayout,
): Mark => {
  const look = (x: number, y: number): Hit => compareHitForPoint(x, y, category, layout);
  const copy: Mark = {
    ...mark,
    pts: mark.pts.slice(),
    ...(mark.ts ? { ts: mark.ts.slice() } : {}),
  };
  if (copy.kind === "path") {
    copy.hits = copy.pts.map(([x, y]) => look(x, y));
    return copy;
  }
  if (copy.kind === "pen") {
    const keyPts = simplifyPenPoints(copy.pts);
    copy.keyPts = keyPts;
    copy.hits = keyPts.map(([x, y]) => look(x, y));
    return copy;
  }
  const p = copy.pts[0]!;
  const q = copy.pts.at(-1)!;
  if (copy.kind === "box") {
    const minX = Math.min(p[0], q[0]);
    const maxX = Math.max(p[0], q[0]);
    const minY = Math.min(p[1], q[1]);
    const maxY = Math.max(p[1], q[1]);
    copy.hits = [
      look((minX + maxX) / 2, (minY + maxY) / 2),
      look(minX, minY),
      look(maxX, minY),
      look(maxX, maxY),
      look(minX, maxY),
    ];
    return copy;
  }
  copy.hits = [look(p[0], p[1]), look(q[0], q[1])];
  return copy;
};

export const inkTimes = (marks: readonly Mark[]): number[] => {
  const all = marks.flatMap((m) => m.ts ?? [m.t]).sort((a, b) => a - b);
  return all.filter((t, i) => i === 0 || t - all[i - 1]! > SAME);
};

export const inkSpan = (marks: readonly Mark[]): [number, number] | null => {
  const t = inkTimes(marks);
  return t.length ? [t[0]!, t.at(-1)!] : null;
};

export const inkWords = (marks: readonly Mark[]): string =>
  marks
    .map((m) => {
      const what = (h?: Hit) => h?.what ?? "?";
      if (m.kind === "path") {
        return `path ${(m.ts ?? []).map((t, i) => `${stamp(t)} ${what(m.hits?.[i])}`).join(" → ")}`;
      }
      const name = { pen: "pen stroke", arrow: "arrow", box: "box" }[m.kind];
      return `${name} ${stamp(m.t)}: ${
        m.kind === "arrow"
          ? `${what(m.hits?.[0])} → ${what(m.hits?.[1])}`
          : m.kind === "box"
            ? what(m.hits?.[0])
            : `${what(m.hits?.[0])} … ${what(m.hits?.at(-1))}`
      }`;
    })
    .join("; ");

export const inkSummary = (marks: readonly Mark[]): string => {
  if (!marks.length) return "";
  const t = inkTimes(marks);
  return `${marks.length} ${marks.length === 1 ? "stroke" : "strokes"}${
    t.length > 1 ? ` across ${t.length} moments: ${stamp(t[0]!)} → ${stamp(t.at(-1)!)}` : ""
  }`;
};

export const spread = <T>(xs: readonly T[], n: number): T[] =>
  xs.length <= n
    ? xs.slice()
    : Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]!);

export interface BuildNoteInput {
  id?: string;
  at?: string;
  t: number;
  shots: readonly LiteShot[];
  duration: number;
  text: string;
  pin: Pin | null;
  compareVideo: NoteCompareSource | null;
  marks: readonly Mark[];
  wasPlaying: boolean;
  rate: number;
  muted: boolean;
  volume: number;
  canvasSize: [number, number] | null;
  screenSize: [number, number];
  phone?: boolean;
}

export const buildNotePayload = (input: BuildNoteInput): Note => {
  const t = +Math.max(0, input.t).toFixed(3);
  const shot = shotAtTime(input.shots, input.duration, t);
  const marks: Mark[] = input.marks.map((m) => ({
    ...m,
    pts: m.pts.slice(),
    ...(m.ts ? { ts: m.ts.slice() } : {}),
    ...(m.hits ? { hits: m.hits.slice() } : {}),
    ...(m.keyPts ? { keyPts: m.keyPts.slice() } : {}),
  }));
  const sp = inkSpan(marks);
  const range: [number, number] | undefined =
    sp && sp[1] - sp[0] > 1 / FPS ? [+sp[0].toFixed(3), +sp[1].toFixed(3)] : undefined;

  return {
    id: input.id ?? Date.now().toString(36),
    at: input.at ?? new Date().toISOString(),
    t,
    time: stamp(t),
    frame: Math.round(t * FPS),
    shot: shot.index,
    shotName: shot.name,
    pin: input.pin,
    ...(input.compareVideo ? { compareVideo: input.compareVideo } : {}),
    context: {
      playing: input.wasPlaying,
      rate: input.rate,
      ...(input.muted ? { muted: true } : {}),
      ...(input.volume !== 1 ? { volume: input.volume } : {}),
      shot: { from: shot.from, to: shot.to, into: shot.into },
      voice: {},
      beats: [],
      view: {
        phone: input.phone ?? true,
        ...(input.canvasSize ? { canvas: input.canvasSize } : {}),
        screen: input.screenSize,
      },
    },
    text: input.text.trim(),
    done: false,
    ...(marks.length ? { marks } : {}),
    ...(range ? { range } : {}),
  };
};

const lastFixAt = (n: Note) => n.fixes?.at(-1)?.at ?? n.at ?? "";

export interface GroupedNotes {
  check: Note[];
  asking: Note[];
  open: Note[];
  done: Note[];
  counts: { all: number; check: number; asking: number; open: number; done: number };
  marks: ScrubberMark[];
}

export const filterAndGroupNotes = (notes: readonly Note[]): GroupedNotes => {
  const check: Note[] = [];
  const asking: Note[] = [];
  const open: Note[] = [];
  const done: Note[] = [];

  for (const n of notes) {
    const st = noteState(n);
    if (st === "done") done.push(n);
    else if (st === "check") {
      if (isNoteAsking(n, st)) asking.push(n);
      else check.push(n);
    } else {
      open.push(n);
    }
  }

  check.sort((a, b) => a.t - b.t);
  asking.sort((a, b) => a.t - b.t);
  open.sort((a, b) => a.t - b.t);
  done.sort((a, b) => (lastFixAt(a) < lastFixAt(b) ? 1 : -1));

  const marks: ScrubberMark[] = notes
    .toSorted((a, b) => a.t - b.t)
    .map((n) => {
      const st = noteState(n);
      const sp = n.marks?.length ? inkSpan(n.marks) : null;
      return {
        t: n.t,
        to: sp && sp[1] - sp[0] > 1 / FPS ? n.t + sp[1] - sp[0] : undefined,
        done: st === "done",
        check: st === "check",
        asking: st === "check" && Boolean(n.fixes?.at(-1)?.ask),
      };
    });

  return {
    check,
    asking,
    open,
    done,
    counts: {
      all: notes.length,
      check: check.length,
      asking: asking.length,
      open: open.length,
      done: done.length,
    },
    marks,
  };
};

const SAFE_NOTE_IMG_RE = /^[a-z0-9]+(?:_crop|_strip|_f\d+|_r\d+|_fix\d+)?\.(?:jpg|jpeg|png|webp)$/;

const noteImgUrl = (rel: unknown): string | null => {
  if (typeof rel !== "string" || !rel) return null;
  const file = rel.split("/").pop() ?? "";
  return SAFE_NOTE_IMG_RE.test(file) ? `/api/note-img/${file}` : null;
};

export const latestEvidenceFix = (fixes: readonly Fix[] | undefined): Fix | null => {
  if (!fixes?.length) return null;
  for (let i = fixes.length - 1; i >= 0; i--) {
    const f = fixes[i]!;
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
  afterTime: number | null;
}

export const resolveNoteMedia = (
  note: Note,
  unsentQueue: readonly OutgoingNote[],
): ResolvedNoteMedia => {
  const queued = unsentQueue.find((x) => x.note.id === note.id);
  const thumb = note.img ? `/api/note-img/${note.id}.jpg` : (queued?.img ?? null);
  const crop =
    typeof note.crop === "string" && note.crop
      ? `/api/note-img/${note.id}_crop.jpg`
      : (queued?.crop ?? null);
  const refs = Array.isArray(note.refs)
    ? note.refs
        .map((r) => noteImgUrl(r))
        .filter((u): u is string => u !== null)
    : (queued?.refs ?? []);
  const fix = latestEvidenceFix(note.fixes);
  const after = fix ? noteImgUrl(fix.after) : null;
  const noAfterReason =
    fix && !after && typeof fix.noAfterReason === "string" && fix.noAfterReason.trim()
      ? fix.noAfterReason.trim()
      : null;
  const afterTime =
    fix && typeof fix.t === "number" && Number.isFinite(fix.t) && fix.t >= 0 ? fix.t : null;
  return { thumb, crop, refs, after, noAfterReason, afterTime };
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

export const pinShortLabel = (what: string | undefined | null): string | null => {
  const trimmed = what?.trim() ?? "";
  if (!trimmed) return null;
  const match = /^(.+?)\s+\([^()]+\)$/.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
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

export const noteRangePill = (note: Note): [number, number] | null => {
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

const shortDayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export const formatShortDate = (raw: unknown): string => {
  if (raw === null || raw === undefined || raw === "") return "";
  const d =
    raw instanceof Date
      ? raw
      : typeof raw === "string" || typeof raw === "number"
        ? new Date(raw)
        : null;
  return d && Number.isFinite(d.getTime()) ? shortDayFormat.format(d) : "";
};

export const clock = (t: number): string => {
  const s = Math.max(0, Math.floor(Number.isFinite(t) ? t : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const spoken = (t: number): string => {
  const s = Math.max(0, Math.floor(Number.isFinite(t) ? t : 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m ? `${m} minute${m === 1 ? "" : "s"} ` : ""}${r} second${r === 1 ? "" : "s"}`;
};

export const clampRatio = (t: number, d: number): number =>
  d > 0 && Number.isFinite(t) ? Math.min(Math.max(t / d, 0), 1) : 0;

export const noteActionTarget = (num: number | null, timeText: string): string =>
  num != null ? `#${num} at ${timeText}` : `at ${timeText}`;
