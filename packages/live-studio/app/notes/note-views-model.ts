// Pure data transformations for Notion-style Notes views (Board, Table, List, Gallery, Timeline, Calendar, Feed, Chart).
import { noteShotTitle } from "./note-card-meta";
import type { Placed } from "./notes";
import type {
  Fix,
  Note,
  NoteFacet,
  NoteScope,
  NoteSort,
  NoteState,
  NoteStatusFilter,
} from "./slice";

export const NOTE_VIEWS = [
  "cards",
  "board",
  "table",
  "list",
  "gallery",
  "timeline",
  "calendar",
  "feed",
  "chart",
] as const;
export type NoteView = (typeof NOTE_VIEWS)[number];

export const PRIMARY_NOTE_VIEWS = ["cards", "list", "board", "gallery"] as const;
export const EXTRA_NOTE_VIEWS = ["table", "timeline", "calendar", "feed", "chart"] as const;
export type ExtraNoteView = (typeof EXTRA_NOTE_VIEWS)[number];
export const isExtraNoteView = (v: NoteView): v is ExtraNoteView =>
  (EXTRA_NOTE_VIEWS as readonly string[]).includes(v);
export const isOverflowNoteView = (v: NoteView, upright = false): boolean =>
  isExtraNoteView(v) || (upright && v === "gallery");

export type PlacedWithState = Placed & { state: NoteState };

export const isNoteAsking = (n: Pick<Note, "fixes">, state: NoteState): boolean =>
  state === "check" && Boolean(n.fixes?.at(-1)?.ask);

export const STATE_META: Record<
  NoteState,
  { label: string; order: number; tone: "warn" | "primary" | "ok" }
> = {
  check: { label: "To check", order: 0, tone: "warn" },
  open: { label: "To fix", order: 1, tone: "primary" },
  done: { label: "Done", order: 2, tone: "ok" },
};

export const combineFilteredNotes = (
  shown: {
    check: readonly Placed[];
    open: readonly Placed[];
    done: readonly Placed[];
  },
  status: NoteStatusFilter = "all",
): PlacedWithState[] => [
  ...(status === "all"
    ? shown.check.map((p) => ({ ...p, state: "check" as const }))
    : status === "asking"
      ? shown.check
          .filter((p) => Boolean(p.n.fixes?.at(-1)?.ask))
          .map((p) => ({ ...p, state: "check" as const }))
      : status === "check"
        ? shown.check
            .filter((p) => !p.n.fixes?.at(-1)?.ask)
            .map((p) => ({ ...p, state: "check" as const }))
        : []),
  ...(status === "all" || status === "open"
    ? shown.open.map((p) => ({ ...p, state: "open" as const }))
    : []),
  ...(status === "all" || status === "done"
    ? shown.done.map((p) => ({ ...p, state: "done" as const }))
    : []),
];

// Enforces note-state.mjs transition rules for drag/move actions in Board view.
export type BoardTransition = "approve" | "feedback" | "reopen";
export const boardTransition = (
  from: NoteState,
  to: NoteState,
  hasAsk: boolean,
): BoardTransition | null => {
  if (from === to) return null;
  if (from === "check" && to === "done" && !hasAsk) return "approve";
  if (from === "check" && to === "open") return "feedback";
  if (from === "done" && to === "open") return "reopen";
  return null;
};

export interface ShotGroup {
  shot: number;
  title: string;
  subtitle: string | null;
  items: PlacedWithState[];
}

export const groupNotesByShot = (
  items: readonly PlacedWithState[],
  preserveOrder = false,
): ShotGroup[] => {
  const byShot = new Map<number, ShotGroup>();
  for (const item of items) {
    const { shot, shotName } = item.n;
    let group = byShot.get(shot);
    if (!group) {
      const meta = noteShotTitle(shot, shotName);
      group = { shot, title: meta.primary, subtitle: meta.secondary, items: [] };
      byShot.set(shot, group);
    }
    group.items.push(item);
  }
  return [...byShot.values()]
    .toSorted((a, b) => a.shot - b.shot)
    .map((g) => ({ ...g, items: preserveOrder ? g.items : g.items.toSorted((a, b) => a.t - b.t) }));
};

export type TableSortKey = "time" | "status" | "shot" | "text" | "created";
export type SortDir = "asc" | "desc";

export const sortTableItems = (
  items: readonly PlacedWithState[],
  key: TableSortKey,
  dir: SortDir,
): PlacedWithState[] => {
  const sign = dir === "asc" ? 1 : -1;
  return items.toSorted((a, b) => {
    let cmp = 0;
    if (key === "time") cmp = a.t - b.t;
    else if (key === "status") cmp = STATE_META[a.state].order - STATE_META[b.state].order;
    else if (key === "shot") cmp = a.n.shot - b.n.shot || a.t - b.t;
    else if (key === "text") cmp = (a.n.text || "").localeCompare(b.n.text || "");
    else {
      const ta = Date.parse(a.n.at || "") || 0;
      const tb = Date.parse(b.n.at || "") || 0;
      cmp = ta - tb;
    }
    return (cmp || a.t - b.t || a.n.id.localeCompare(b.n.id)) * sign;
  });
};

export interface TimelineItem {
  p: PlacedWithState;
  startSec: number;
  endSec: number;
  isRange: boolean;
}

export interface TimelineLane {
  shot: number;
  title: string;
  subtitle: string | null;
  items: TimelineItem[];
}

export const buildTimelineLanes = (
  items: readonly PlacedWithState[],
  filmDuration: number,
): { duration: number; lanes: TimelineLane[] } => {
  let maxSec = Math.max(filmDuration || 0, 1);
  const byShot = new Map<number, TimelineLane>();

  for (const p of items) {
    const startSec = Math.max(0, p.span ? p.span[0] : p.t);
    const endSec = Math.max(startSec, p.span ? p.span[1] : p.t);
    if (endSec > maxSec) maxSec = endSec;
    let lane = byShot.get(p.n.shot);
    if (!lane) {
      const meta = noteShotTitle(p.n.shot, p.n.shotName);
      lane = { shot: p.n.shot, title: meta.primary, subtitle: meta.secondary, items: [] };
      byShot.set(p.n.shot, lane);
    }
    lane.items.push({ p, startSec, endSec, isRange: endSec - startSec > 0.05 });
  }

  const lanes = [...byShot.values()]
    .toSorted((a, b) => a.shot - b.shot)
    .map((lane) => ({
      ...lane,
      items: lane.items.toSorted((a, b) => a.startSec - b.startSec),
    }));

  return { duration: maxSec, lanes };
};

export interface PackedTimelineItem {
  item: TimelineItem;
  row: number;
  anchorPct: number;
  leftPct: number;
  widthPct: number;
}

// Packs chronological items into non-overlapping horizontal sub-lanes inside a Shot row.
export const packTimelineRows = (
  items: readonly TimelineItem[],
  duration: number,
  minPillPct = 24,
): { rows: number; packed: PackedTimelineItem[] } => {
  const safeDur = Math.max(duration || 0, 0.001);
  const rowEnds: number[] = [];
  const packed: PackedTimelineItem[] = [];
  const maxLeft = Math.max(0, 100 - minPillPct);

  for (const item of items) {
    const anchorPct = Math.min(100, Math.max(0, (item.startSec / safeDur) * 100));
    const widthPct = item.isRange
      ? Math.min(
          100 - Math.min(anchorPct, maxLeft),
          Math.max(minPillPct, ((item.endSec - item.startSec) / safeDur) * 100),
        )
      : minPillPct;
    const leftPct = item.isRange
      ? Math.min(anchorPct, maxLeft)
      : Math.max(0, Math.min(anchorPct - widthPct / 2, maxLeft));
    const endPct = Math.min(100, leftPct + widthPct);

    let row = rowEnds.findIndex((end) => end <= leftPct + 0.5);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(endPct);
    } else {
      rowEnds[row] = endPct;
    }
    packed.push({ item, row, anchorPct, leftPct, widthPct });
  }

  return { rows: Math.max(1, rowEnds.length), packed };
};

export const timelineMinPillPct = (trackWidthPx: number, zoom = 1, minPillPx = 56): number => {
  if (!(trackWidthPx > 0) || !(zoom > 0)) return 22;
  return Math.min(48, Math.max(4, (minPillPx / (trackWidthPx * zoom)) * 100));
};

export const shortDayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export const shortTimeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const parseTimestamp = (raw: unknown): Date | null => {
  if (raw === null || raw === undefined || raw === "") return null;
  const d =
    raw instanceof Date
      ? raw
      : typeof raw === "string" || typeof raw === "number"
        ? new Date(raw)
        : null;
  return d && Number.isFinite(d.getTime()) ? d : null;
};

export const formatShortDate = (raw: unknown): string => {
  const d = parseTimestamp(raw);
  return d ? shortDayFormat.format(d) : "";
};

export const formatShortTime = (raw: unknown): string => {
  if (typeof raw === "string" && !raw.includes("T") && !raw.includes(":")) return "";
  const d = parseTimestamp(raw);
  return d ? shortTimeFormat.format(d) : "";
};

export const splitNoteHeadline = (text: string): { firstLine: string; extraLines: number } => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return { firstLine: lines[0] ?? "", extraLines: Math.max(0, lines.length - 1) };
};

export const calendarStatusBreakdown = (
  items: readonly PlacedWithState[],
): Record<NoteState, number> => {
  const counts: Record<NoteState, number> = { check: 0, open: 0, done: 0 };
  for (const item of items) counts[item.state]++;
  return counts;
};

export interface SemanticCounts {
  check: number;
  asking: number;
  open: number;
  done: number;
}

export const countSemanticNotes = (items: readonly PlacedWithState[]): SemanticCounts => {
  const out: SemanticCounts = { check: 0, asking: 0, open: 0, done: 0 };
  for (const item of items) {
    if (isNoteAsking(item.n, item.state)) out.asking++;
    else out[item.state]++;
  }
  return out;
};

export const localDateKey = (iso: string | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const latestNoteMonth = (
  items: readonly { n: Pick<Note, "at"> }[],
  fallback = new Date(),
): { year: number; month: number } => {
  let latest = -Infinity;
  for (const item of items) {
    const ts = Date.parse(item.n.at || "");
    if (!Number.isNaN(ts) && ts > latest) latest = ts;
  }
  const ref = Number.isFinite(latest) ? new Date(latest) : fallback;
  return { year: ref.getFullYear(), month: ref.getMonth() };
};

export interface CalendarCell {
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  items: PlacedWithState[];
}

export const buildCalendarMonth = (
  year: number,
  month: number,
  items: readonly PlacedWithState[],
  today = new Date(),
): CalendarCell[] => {
  const grouped = new Map<string, PlacedWithState[]>();
  for (const item of items) {
    const key = localDateKey(item.n.at);
    if (!key) continue;
    const list = grouped.get(key);
    if (list) list.push(item);
    else grouped.set(key, [item]);
  }
  const todayKey = localDateKey(today.toISOString());
  const firstOfMonth = new Date(year, month, 1);
  // Monday-first grid (0 = Mon ... 6 = Sun), matching Notion calendar default
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    cells.push({
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: key === todayKey,
      items: (grouped.get(key) ?? []).toSorted((a, b) => a.t - b.t),
    });
  }
  return cells;
};

export interface ChartBucket {
  key: string;
  label: string;
  subtitle?: string;
  check: number;
  asking: number;
  open: number;
  done: number;
  total: number;
  items: PlacedWithState[];
}

export interface ChartStats {
  total: number;
  counts: Record<NoteState, number>;
  asks: number;
  byStatus: ChartBucket[];
  byShot: ChartBucket[];
  byDay: ChartBucket[];
}

export const buildChartStats = (items: readonly PlacedWithState[]): ChartStats => {
  const counts: Record<NoteState, number> = { check: 0, open: 0, done: 0 };
  let asks = 0;
  const readyCheckItems: PlacedWithState[] = [];
  const askingItems: PlacedWithState[] = [];
  const openItems: PlacedWithState[] = [];
  const doneItems: PlacedWithState[] = [];
  const shotMap = new Map<number, ChartBucket>();
  const dayMap = new Map<string, ChartBucket>();

  for (const item of items) {
    const s = item.state;
    const asking = isNoteAsking(item.n, s);
    counts[s]++;
    if (asking) {
      asks++;
      askingItems.push(item);
    } else if (s === "check") {
      readyCheckItems.push(item);
    } else if (s === "open") {
      openItems.push(item);
    } else {
      doneItems.push(item);
    }

    let sb = shotMap.get(item.n.shot);
    if (!sb) {
      const meta = noteShotTitle(item.n.shot, item.n.shotName);
      sb = {
        key: `shot:${item.n.shot}`,
        label: meta.primary,
        subtitle: meta.secondary ?? undefined,
        check: 0,
        asking: 0,
        open: 0,
        done: 0,
        total: 0,
        items: [],
      };
      shotMap.set(item.n.shot, sb);
    }
    if (asking) sb.asking++;
    else sb[s]++;
    sb.total++;
    sb.items.push(item);

    const dk = localDateKey(item.n.at) ?? "unknown";
    let db = dayMap.get(dk);
    if (!db) {
      db = {
        key: `day:${dk}`,
        label: dk === "unknown" ? "No date" : dk.slice(5),
        check: 0,
        asking: 0,
        open: 0,
        done: 0,
        total: 0,
        items: [],
      };
      dayMap.set(dk, db);
    }
    if (asking) db.asking++;
    else db[s]++;
    db.total++;
    db.items.push(item);
  }

  const readyCheck = counts.check - asks;
  const byStatus: ChartBucket[] = [
    {
      key: "status:check",
      label: STATE_META.check.label,
      check: readyCheck,
      asking: 0,
      open: 0,
      done: 0,
      total: readyCheck,
      items: readyCheckItems,
    },
    ...(asks > 0
      ? [
          {
            key: "status:asking",
            label: "AI asks",
            check: 0,
            asking: asks,
            open: 0,
            done: 0,
            total: asks,
            items: askingItems,
          },
        ]
      : []),
    {
      key: "status:open",
      label: STATE_META.open.label,
      check: 0,
      asking: 0,
      open: counts.open,
      done: 0,
      total: counts.open,
      items: openItems,
    },
    {
      key: "status:done",
      label: STATE_META.done.label,
      check: 0,
      asking: 0,
      open: 0,
      done: counts.done,
      total: counts.done,
      items: doneItems,
    },
  ];

  const byShot = [...shotMap.values()].toSorted((a, b) => b.total - a.total);
  const byDay = [...dayMap.values()].toSorted((a, b) => a.key.localeCompare(b.key)).slice(-14);

  return { total: items.length, counts, asks, byStatus, byShot, byDay };
};

export const buildDonutBuckets = (
  byShot: readonly ChartBucket[],
  maxPrimary = 5,
): ChartBucket[] => {
  if (byShot.length <= maxPrimary) return [...byShot];
  const head = byShot.slice(0, maxPrimary);
  const tail = byShot.slice(maxPrimary);
  const other: ChartBucket = {
    key: "shot:other",
    label: `Other (${tail.length} shots)`,
    check: 0,
    asking: 0,
    open: 0,
    done: 0,
    total: 0,
    items: [],
  };
  for (const b of tail) {
    other.check += b.check;
    other.asking += b.asking;
    other.open += b.open;
    other.done += b.done;
    other.total += b.total;
    other.items.push(...b.items);
  }
  return [...head, other];
};

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

export type NoteActivitySource = Pick<
  Note,
  "at" | "fixes" | "asks" | "edits" | "approved" | "learned"
>;

// Maximum timestamp across every note lifecycle event so "Recent activity" never sorts by an older superseded fix.
export const latestNoteActivityMs = (note: NoteActivitySource): number => {
  let latest = 0;
  const bump = (raw: string | undefined) => {
    if (!raw) return;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  };
  bump(note.at);
  bump(note.approved);
  bump(note.learned?.at);
  for (const f of note.fixes ?? []) bump(f.at);
  for (const a of note.asks ?? []) bump(a.at);
  for (const e of note.edits ?? []) bump(e.at);
  return latest;
};

export type NoteThreadSource = Pick<Note, "fixes" | "asks" | "edits">;

// Single partition shared by card/list/board callouts and History disclosure so nothing duplicates or hides creator follow-ups.
export const summarizeNoteThread = (
  note: NoteThreadSource,
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
      .map((f): NotePriorEntry => ({
        by: "ai",
        text: f.what,
        at: f.at ?? "",
        ask: !!f.ask,
        checkpoint: f.checkpoint,
      })),
    ...asks
      .filter((a) => a !== activeAsk)
      .map((a): NotePriorEntry => ({
        by: "creator",
        text: a.text,
        at: a.at ?? "",
      })),
    ...edits.map((e): NotePriorEntry => ({
      by: "creator",
      text: e.was,
      at: e.at ?? "",
      reworded: true,
    })),
  ].toSorted((a, b) => (a.at > b.at ? 1 : a.at < b.at ? -1 : 0));

  return { activeFix, activeAsk, prior };
};

export interface NoteFacetMeta {
  id: NoteFacet;
  label: string;
  group: "thread" | "media";
}

export const NOTE_FACETS: readonly NoteFacetMeta[] = [
  { id: "needsWork", label: "Sent back (Needs work)", group: "thread" },
  { id: "readyFix", label: "Fix ready to approve", group: "thread" },
  { id: "asking", label: "AI is asking", group: "thread" },
  { id: "learned", label: "Rule / Learned", group: "thread" },
  { id: "drawn", label: "Drawn on", group: "media" },
  { id: "pinned", label: "Pinned object", group: "media" },
  { id: "refs", label: "Has images", group: "media" },
  { id: "freeCam", label: "Free cam", group: "media" },
];

export const isCreatorNeedsWork = (note: NoteThreadSource, state: NoteState): boolean =>
  state === "open" && summarizeNoteThread(note, state).activeAsk !== null;

const FACET_TEST: Record<NoteFacet, (item: PlacedWithState) => boolean> = {
  needsWork: (it) => isCreatorNeedsWork(it.n, it.state),
  readyFix: (it) => it.state === "check" && !it.n.fixes?.at(-1)?.ask,
  asking: (it) => it.state === "check" && !!it.n.fixes?.at(-1)?.ask,
  learned: (it) => Boolean(it.n.learned?.what || it.n.remember),
  drawn: (it) => Boolean(it.span),
  pinned: (it) => Boolean(it.n.pin),
  refs: (it) => Array.isArray(it.n.refs) && it.n.refs.length > 0,
  freeCam: (it) => Boolean(it.n.freeCam),
};

export const matchesNoteFilters = (
  item: PlacedWithState,
  opts: {
    scope: NoteScope;
    currentShot: number;
    shot: number | null;
    facets: readonly NoteFacet[];
    shotOf?: (p: Placed) => number;
  },
): boolean => {
  const itemShot = opts.shotOf ? opts.shotOf(item) : item.n.shot;
  if (opts.scope === "shot" && itemShot !== opts.currentShot) return false;
  if (opts.shot !== null && item.n.shot !== opts.shot) return false;
  for (const facet of opts.facets) {
    if (!FACET_TEST[facet](item)) return false;
  }
  return true;
};

export const countNoteFacets = (items: readonly PlacedWithState[]): Record<NoteFacet, number> => {
  const counts: Record<NoteFacet, number> = {
    needsWork: 0,
    readyFix: 0,
    asking: 0,
    learned: 0,
    drawn: 0,
    pinned: 0,
    refs: 0,
    freeCam: 0,
  };
  for (const it of items) {
    for (const f of NOTE_FACETS) {
      if (FACET_TEST[f.id](it)) counts[f.id]++;
    }
  }
  return counts;
};

export interface ShotFilterOption {
  shot: number;
  label: string;
  count: number;
}

export const formatShotOptionLabel = (shot: number, name?: string): string => {
  const title = noteShotTitle(shot, name);
  return title.secondary ? `${title.primary} · ${title.secondary}` : title.primary;
};

export const buildShotFilterOptions = (items: readonly Placed[]): ShotFilterOption[] => {
  const map = new Map<number, { name?: string; count: number }>();
  for (const p of items) {
    const cur = map.get(p.n.shot);
    if (cur) {
      cur.count++;
      if (!cur.name && p.n.shotName) cur.name = p.n.shotName;
    } else {
      map.set(p.n.shot, { name: p.n.shotName, count: 1 });
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([shot, info]) => ({
      shot,
      label: formatShotOptionLabel(shot, info.name),
      count: info.count,
    }));
};

export const sortPlacedNotes = <T extends Placed>(items: readonly T[], sort: NoteSort): T[] => {
  if (sort === "film") return items.toSorted((a, b) => a.t - b.t);
  if (sort === "activity") {
    return items.toSorted(
      (a, b) => latestNoteActivityMs(b.n) - latestNoteActivityMs(a.n) || a.t - b.t,
    );
  }
  const dir = sort === "newest" ? -1 : 1;
  return items.toSorted((a, b) =>
    a.n.at === b.n.at ? a.t - b.t : (a.n.at < b.n.at ? -1 : 1) * dir,
  );
};

export interface NoteInlineCue {
  kind: "ask" | "needs-work" | "fixed" | "learned";
  shortLabel: string;
  label: string;
  text: string;
}

/** Single scannable status cue for compact Table and List rows, matching NoteFollowups priority. */
export const getNoteInlineCue = (n: Note, state: NoteState): NoteInlineCue | null => {
  const { activeAsk, activeFix } = summarizeNoteThread(n, state);
  if (state === "check" && activeFix?.ask && activeFix.what) {
    return { kind: "ask", shortLabel: "Ask", label: "AI asks", text: activeFix.what };
  }
  if (state === "open" && activeAsk) {
    return {
      kind: "needs-work",
      shortLabel: "Needs work",
      label: "Needs work",
      text: activeAsk.text || "(no words)",
    };
  }
  if (state === "check" && activeFix?.what) {
    return { kind: "fixed", shortLabel: "Fixed", label: "AI says fixed", text: activeFix.what };
  }
  if (n.learned?.what) {
    return { kind: "learned", shortLabel: "Learned", label: "Learned", text: n.learned.what };
  }
  return null;
};
