// Notion-style Temporal, Stream & Analytics views: Timeline (Gantt), Calendar, Feed, and Chart.
import { DURATION } from "film/scene";
import {
  BarChart3,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  PieChart,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { noteThread } from "../../src/note-state.mjs";
import { useLit, useLitAny } from "../activity/activity";
import { VirtualList } from "../components/VirtualList";
import { useCoarsePointer } from "../core/device";
import { set, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { noteActionTarget, noteShotTitle } from "./note-card-meta";
import {
  Empty,
  ExpandableNoteText,
  formatShortDate,
  LearnedCallout,
  NoteCardActions,
  NoteCardHeader,
  NoteFollowups,
  NoteNumber,
  NoteStatusGlyph,
  noteStatusLabel,
  noteStatusTextClass,
  noteSurfaceClass,
  NoteTags,
  NoteThumb,
  NoteTimeChip,
  openNoteRow,
} from "./note-parts";
import {
  buildCalendarMonth,
  buildChartStats,
  buildDonutBuckets,
  buildTimelineLanes,
  countSemanticNotes,
  formatShortTime,
  isCreatorNeedsWork,
  isNoteAsking,
  latestNoteMonth,
  localDateKey,
  packTimelineRows,
  type PlacedWithState,
  sortPlacedNotes,
  timelineMinPillPct,
} from "./note-views-model";
import { goToNote, noteMedia, noteNum } from "./notes";
import type { NoteSort, NoteState } from "./slice";

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const SHORT_DAY_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const formatDayKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return SHORT_DAY_FMT.format(new Date(y, m - 1, d));
};

const shortTick = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function InlineStatus({
  state,
  asking = false,
  needsWork = false,
}: {
  state: NoteState;
  asking?: boolean;
  needsWork?: boolean;
}) {
  const label = noteStatusLabel(state, asking, needsWork);
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <NoteStatusGlyph state={state} asking={asking} needsWork={needsWork} />
      <span className={cn("text-xs font-medium", noteStatusTextClass(state, asking, needsWork))}>
        {label}
      </span>
    </span>
  );
}

function TimelinePillButton({
  p,
  row,
  anchorPct,
  leftPct,
  widthPct,
  active,
  onPick,
  onStep,
}: {
  p: PlacedWithState;
  row: number;
  anchorPct: number;
  leftPct: number;
  widthPct: number;
  active: boolean;
  onPick: () => void;
  onStep?: (delta: -1 | 1) => void;
}) {
  const lit = useLit(`note:${p.n.id}`);
  const num = noteNum(p.n.id);
  const needsWork = isCreatorNeedsWork(p.n, p.state);
  const asking = isNoteAsking(p.n, p.state);
  const stateLabel =
    p.state === "check"
      ? asking
        ? "AI asks"
        : "To check"
      : p.state === "done"
        ? "Done"
        : needsWork
          ? "Needs work"
          : "To fix";
  const toneCls = asking
    ? "border-ai/60 bg-backdrop/95 text-ai-text font-semibold hover:bg-ai/15"
    : p.state === "check"
      ? "border-warn/60 bg-backdrop/95 text-warn-text font-semibold hover:bg-warn/15"
      : p.state === "done"
        ? "border-ok/35 bg-surface-subtle text-foreground/78 hover:border-ok/60 hover:text-foreground"
        : "border-primary/50 bg-backdrop/95 text-primary-text hover:bg-primary/15";
  const stemCls = asking
    ? "bg-ai/70"
    : p.state === "check"
      ? "bg-warn/70"
      : p.state === "done"
        ? "bg-ok/45"
        : "bg-primary/65";
  return (
    <>
      <button
        type="button"
        data-note={p.n.id}
        data-tone={asking ? "ai" : p.state}
        data-ai-lit={lit || undefined}
        title={`${num != null ? `#${num} · ` : ""}${stateLabel} · ${stamp(p.t)} · ${p.n.text || "(no words)"}`}
        aria-label={`${num != null ? `Note #${num}, ` : ""}${stateLabel}: ${p.n.text || "Note"} at ${stamp(p.t)}`}
        aria-pressed={active}
        onClick={onPick}
        onKeyDown={(e) => {
          if (!onStep) return;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            e.stopPropagation();
            onStep(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            e.stopPropagation();
            onStep(-1);
          }
        }}
        style={
          {
            "--tl-row": row,
            "--tl-left": `${leftPct}%`,
            "--tl-w": `${widthPct}%`,
          } as CSSProperties
        }
        className={cn(
          "tl-pill focus-visible:ring-ring text-tag @container absolute left-(--tl-left) flex h-6 w-(--tl-w) items-center gap-1 overflow-hidden rounded-full border px-1.5 font-medium transition-colors duration-150 outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:h-10",
          active && "ring-foreground/85 z-10 shadow-xs ring-2",
          toneCls,
        )}
      >
        <NoteStatusGlyph state={p.state} asking={asking} needsWork={needsWork} />
        {num != null && (
          <span className="hidden shrink-0 font-mono font-semibold tabular-nums @[36px]:inline">
            #{num}
          </span>
        )}
        {p.n.text && <span className="hidden min-w-0 truncate @[72px]:inline">{p.n.text}</span>}
        <span className="text-label hidden shrink-0 font-mono tabular-nums @[136px]:inline">
          {shortTick(p.t)}
        </span>
      </button>
      <span
        aria-hidden
        style={
          {
            "--tl-row": row,
            "--tl-pin-left": `${anchorPct}%`,
          } as CSSProperties
        }
        className={cn(
          "tl-stem ring-backdrop pointer-events-none absolute left-(--tl-pin-left) z-20 size-1 -translate-x-1/2 rounded-full ring-1",
          stemCls,
        )}
      />
    </>
  );
}

function TimelinePickedCard({
  picked,
  replyId,
  setReplyId,
}: {
  picked: PlacedWithState;
  replyId: string | null;
  setReplyId: (id: string | null) => void;
}) {
  const { n, t, state } = picked;
  const lit = useLit(`note:${n.id}`);
  const fix = n.fixes?.at(-1);
  const asking = state === "check" && !!fix?.ask;
  const needsWork = isCreatorNeedsWork(n, state);
  const shot = noteShotTitle(n.shot, n.shotName);
  const replying = replyId === n.id;

  return (
    <div className="max-h-[min(45%,15rem)] min-h-0 flex-none overflow-y-auto overscroll-contain px-3 pt-1.5 pb-2">
      <Card size="sm" tone={asking ? "ai" : state} data-note={n.id} data-ai-lit={lit || undefined}>
        <CardContent>
          <div className="flex flex-wrap items-center gap-1.5">
            <NoteNumber id={n.id} />
            <InlineStatus state={state} asking={asking} needsWork={needsWork} />
            <NoteTimeChip note={n} t={t} />
            <span className="text-label text-ui min-w-0 flex-1 truncate" title={shot.full}>
              <span className="text-foreground/90 font-medium">{shot.primary}</span>
              {shot.secondary && ` · ${shot.secondary}`}
            </span>
          </div>
          <div className="mt-1.5 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ExpandableNoteText
                text={n.text}
                clampLines={2}
                compact
                openLabel={`Open note ${noteActionTarget(noteNum(n.id), stamp(t))}: ${n.text || "no words"}`}
                onOpen={(el) => openNoteRow(n, state, el)}
              />
              <NoteTags note={n} />
            </div>
            <NoteThumb note={n} t={t} shotFull={shot.full} size="sm" muted={state === "done"} />
          </div>
          <NoteFollowups note={n} state={state} compact />
          <NoteCardActions
            note={n}
            t={t}
            state={state}
            replying={replying}
            onToggleReply={() => setReplyId(replying ? null : n.id)}
            onDoneReply={() => setReplyId(null)}
            compact
            showEdit
            showApprovedDate={state === "done"}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function NoteTimelineView({ items }: { items: readonly PlacedWithState[] }) {
  const [zoom, setZoom] = useState<1 | 2>(1);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [replyId, setReplyId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollToLaneRef = useRef<((index: number) => void) | null>(null);
  const [wrapWidth, setWrapWidth] = useState(320);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const sync = (w: number) => setWrapWidth((prev) => (Math.abs(prev - w) < 4 ? prev : w));
    sync(el.clientWidth);
    const ro = new ResizeObserver((entries) =>
      sync(entries[0]?.contentRect.width ?? el.clientWidth),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { duration, lanes } = useMemo(() => buildTimelineLanes(items, DURATION || 1), [items]);
  const ticks = useMemo(() => {
    const niceSteps = [1, 2, 5, 10, 15, 20, 30, 60, 120];
    const target = zoom === 2 ? 6 : 4;
    const raw = Math.max(duration, 1) / target;
    const step = niceSteps.find((s) => s >= raw) ?? Math.ceil(raw / 60) * 60;
    const out: number[] = [0];
    for (let s = step; s < duration - step * 0.35; s += step) out.push(s);
    out.push(duration);
    return out;
  }, [duration, zoom]);

  const trackWidthPx = Math.max(180, wrapWidth - 118);
  const minPillPct = timelineMinPillPct(trackWidthPx, zoom, zoom === 2 ? 120 : 56);
  const packedLanes = useMemo(
    () => lanes.map((lane) => ({ lane, ...packTimelineRows(lane.items, duration, minPillPct) })),
    [lanes, duration, minPillPct],
  );
  const timelineOrder = useMemo(
    () => lanes.flatMap((l) => l.items.map((it) => it.p)).toSorted((a, b) => a.t - b.t),
    [lanes],
  );

  const picked = items.find((it) => it.n.id === pickedId) ?? lanes[0]?.items[0]?.p ?? null;
  const pickedLaneKey = picked ? picked.n.shot : null;
  const coarseRows = useCoarsePointer();
  const stepTimeline = (currentId: string, delta: -1 | 1) => {
    if (timelineOrder.length <= 1) return;
    const idx = timelineOrder.findIndex((p) => p.n.id === currentId);
    if (idx < 0) return;
    const next = timelineOrder[(idx + delta + timelineOrder.length) % timelineOrder.length];
    if (!next) return;
    setPickedId(next.n.id);
    goToNote(next.n);
    const laneIdx = packedLanes.findIndex((entry) =>
      entry.lane.items.some((it) => it.p.n.id === next.n.id),
    );
    if (laneIdx >= 0) scrollToLaneRef.current?.(laneIdx);
    const tryFocus = (retries: number) => {
      const btn = wrapRef.current?.querySelector<HTMLButtonElement>(
        `button[data-note="${CSS.escape(next.n.id)}"]`,
      );
      if (btn) btn.focus();
      else if (retries > 0) requestAnimationFrame(() => tryFocus(retries - 1));
    };
    requestAnimationFrame(() => tryFocus(4));
  };
  const zoomWidthCls = zoom === 2 ? "w-[200%] min-w-85" : "w-full min-w-0";
  const listWidthCls = `${zoomWidthCls} pb-2`;

  const ruler = (
    <div
      className={cn(
        "bg-backdrop/95 border-hairline sticky top-0 z-10 flex items-center border-b px-2.5 py-1.5 backdrop-blur-xs",
        zoomWidthCls,
      )}
    >
      <div className="text-label border-hairline-subtle w-22 shrink-0 border-e pe-2 text-xs font-medium">
        Shot
      </div>
      <div className="relative ms-2 h-4 flex-1">
        {ticks.map((sec, i) => {
          const pct = (sec / duration) * 100;
          return (
            <span
              key={i}
              style={{ "--tick-left": `${pct}%` } as CSSProperties}
              className={cn(
                "text-label/80 absolute top-0 left-(--tick-left) font-mono text-xs whitespace-nowrap tabular-nums",
                i === ticks.length - 1
                  ? "-translate-x-full"
                  : i === 0
                    ? "translate-x-0"
                    : "-translate-x-1/2",
              )}
            >
              {shortTick(sec)}
            </span>
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between gap-2 px-3 pb-1.5">
        <span className="text-label text-ui font-mono tabular-nums">
          {lanes.length} shot{lanes.length === 1 ? "" : "s"} · {stamp(duration)} total
        </span>
        <ToggleGroup
          value={[String(zoom)]}
          onValueChange={(v: string[]) => {
            if (v[0] === "1" || v[0] === "2") setZoom(Number(v[0]) as 1 | 2);
          }}
          aria-label="Timeline zoom"
          variant="segment"
          size="sm"
          spacing={0.5}
        >
          <ToggleGroupItem value="1">Fit</ToggleGroupItem>
          <ToggleGroupItem value="2">2× zoom</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="bg-backdrop/55 border-hairline mx-3 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
        <VirtualList
          items={packedLanes}
          getKey={(entry) => entry.lane.shot}
          estimateSize={(i) => (packedLanes[i]?.rows ?? 1) * (coarseRows ? 52 : 28) + 16}
          gap={0}
          overscan={4}
          stickyKeys={pickedLaneKey !== null ? [pickedLaneKey] : undefined}
          scrollToRef={scrollToLaneRef}
          data-arrow-scroll
          role="list"
          ariaLabel="Timeline shot lanes"
          className="scroll-fade min-h-0 flex-1 overflow-auto overscroll-contain"
          listClassName={listWidthCls}
          header={ruler}
          renderItem={({ lane, rows, packed }) => (
            <div className="border-hairline-subtle hover:bg-surface-subtle/75 flex items-stretch border-b px-2.5 py-1.5 transition-colors motion-reduce:transition-none">
              <div className="border-hairline-subtle flex w-22 shrink-0 flex-col justify-center border-e pe-2">
                <div className="text-foreground/95 text-ui truncate font-medium">{lane.title}</div>
                {lane.subtitle && (
                  <div className="text-label/70 truncate text-xs">{lane.subtitle}</div>
                )}
              </div>
              <div
                style={{ "--tl-rows": rows } as CSSProperties}
                className="tl-lane relative ms-2 flex-1"
              >
                {ticks.slice(1, -1).map((sec, i) => (
                  <div
                    key={i}
                    aria-hidden
                    style={{ "--tick-left": `${(sec / duration) * 100}%` } as CSSProperties}
                    className="bg-hairline-subtle pointer-events-none absolute inset-y-0 left-(--tick-left) w-px"
                  />
                ))}
                {packed.map(({ item: { p }, row, anchorPct, leftPct, widthPct }) => (
                  <TimelinePillButton
                    key={p.n.id}
                    p={p}
                    row={row}
                    anchorPct={anchorPct}
                    leftPct={leftPct}
                    widthPct={widthPct}
                    active={picked?.n.id === p.n.id}
                    onPick={() => {
                      setPickedId(p.n.id);
                      goToNote(p.n);
                    }}
                    onStep={(delta) => stepTimeline(p.n.id, delta)}
                  />
                ))}
              </div>
            </div>
          )}
        />
      </div>

      {picked && <TimelinePickedCard picked={picked} replyId={replyId} setReplyId={setReplyId} />}
    </div>
  );
}

function CalendarDayCell({
  cell,
  isSelected,
  cellRef,
  onPick,
  onKeyDown,
}: {
  cell: ReturnType<typeof buildCalendarMonth>[number];
  isSelected: boolean;
  cellRef?: (el: HTMLButtonElement | null) => void;
  onPick: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const keys = useMemo(() => cell.items.map((it) => `note:${it.n.id}`), [cell.items]);
  const lit = useLitAny(keys);
  const breakdown = cell.items.length ? countSemanticNotes(cell.items) : null;
  const dayLabel = formatDayKey(cell.key);
  const cellTone = !lit
    ? undefined
    : breakdown?.asking
      ? "ai"
      : breakdown?.check
        ? "check"
        : breakdown?.open
          ? "open"
          : "done";
  return (
    <button
      ref={cellRef}
      type="button"
      tabIndex={isSelected ? 0 : -1}
      data-tone={cellTone}
      data-ai-lit={lit || undefined}
      aria-pressed={isSelected}
      aria-label={
        breakdown
          ? `${dayLabel}: ${breakdown.check} to check, ${breakdown.asking} AI asks, ${breakdown.open} to fix, ${breakdown.done} done`
          : `${dayLabel}: 0 notes`
      }
      onClick={onPick}
      onKeyDown={onKeyDown}
      className={cn(
        "focus-visible:ring-ring flex min-h-8 flex-col items-start justify-between gap-0.5 p-1 text-left transition-colors duration-100 outline-none focus-visible:z-10 focus-visible:ring-2 motion-reduce:transition-none @[420px]:min-h-9 pointer-coarse:min-h-10",
        cell.inMonth ? "bg-card/85" : "bg-background/55",
        isSelected
          ? "bg-surface-selected ring-hairline-strong z-10 ring-1 ring-inset"
          : "hover:bg-surface-subtle",
      )}
    >
      <span
        className={cn(
          "text-tag inline-flex size-5 items-center justify-center rounded-full font-mono tabular-nums",
          cell.isToday
            ? "text-foreground border-hairline-strong bg-secondary border font-bold"
            : cell.inMonth
              ? "text-foreground/85"
              : "text-muted-foreground",
        )}
      >
        {cell.day}
      </span>
      {breakdown &&
        (() => {
          const dots = [
            breakdown.check > 0 && {
              key: "check",
              n: breakdown.check,
              label: "To check",
              dot: "bg-warn",
              cls: "text-warn-text",
            },
            breakdown.asking > 0 && {
              key: "asking",
              n: breakdown.asking,
              label: "AI asks",
              dot: "bg-ai",
              cls: "text-ai-text",
            },
            breakdown.open > 0 && {
              key: "open",
              n: breakdown.open,
              label: "To fix",
              dot: "bg-primary",
              cls: "text-primary-text",
            },
            breakdown.done > 0 && {
              key: "done",
              n: breakdown.done,
              label: "Done",
              dot: "bg-ok",
              cls: "text-ok-text",
            },
          ].filter(Boolean) as {
            key: string;
            n: number;
            label: string;
            dot: string;
            cls: string;
          }[];
          const compactNarrow = dots.length > 2 || dots.some((d) => d.n >= 10);
          const totalDay = dots.reduce((s, d) => s + d.n, 0);
          return (
            <>
              {compactNarrow && (
                <div className="text-tag flex w-full items-center justify-between gap-1 font-mono leading-none tabular-nums @[380px]:hidden">
                  <span className="inline-flex items-center gap-0.5">
                    {dots.map((d) => (
                      <span
                        key={d.key}
                        aria-hidden
                        className={cn("size-1.5 rounded-full", d.dot)}
                      />
                    ))}
                  </span>
                  <span className="text-foreground/90 font-semibold">{totalDay}</span>
                </div>
              )}
              <div
                className={cn(
                  "text-tag w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono leading-none tabular-nums",
                  compactNarrow ? "hidden @[380px]:flex" : "flex",
                )}
              >
                {dots.map((d) => (
                  <span
                    key={d.key}
                    className={cn("inline-flex items-center gap-0.5 font-semibold", d.cls)}
                    title={d.label}
                  >
                    <span aria-hidden className={cn("size-1.5 rounded-full", d.dot)} />
                    {d.n}
                  </span>
                ))}
              </div>
            </>
          );
        })()}
    </button>
  );
}

function CalendarDayNoteCard({
  item,
  replying,
  onToggleReply,
  onDoneReply,
}: {
  item: PlacedWithState;
  replying: boolean;
  onToggleReply: () => void;
  onDoneReply: () => void;
}) {
  const { n, t, state } = item;
  const lit = useLit(`note:${n.id}`);
  const fix = n.fixes?.at(-1);
  const asking = state === "check" && !!fix?.ask;
  const needsWork = isCreatorNeedsWork(n, state);
  const shot = noteShotTitle(n.shot, n.shotName);

  return (
    <Card size="sm" tone={asking ? "ai" : state} data-note={n.id} data-ai-lit={lit || undefined}>
      <CardContent>
        <NoteCardHeader
          note={n}
          t={t}
          state={state}
          asking={asking}
          needsWork={needsWork}
          shotPrimary={shot.primary}
          shotSecondary={shot.secondary}
          shotFull={shot.full}
          lit={lit}
        />
        <div className="mt-1.5 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ExpandableNoteText
              text={n.text}
              clampLines={3}
              openLabel={`Open note ${noteActionTarget(noteNum(n.id), stamp(t))}: ${n.text || "no words"}`}
              onOpen={(el) => openNoteRow(n, state, el)}
            />
            <NoteTags note={n} />
          </div>
          <NoteThumb note={n} t={t} shotFull={shot.full} size="sm" muted={state === "done"} />
        </div>
        <NoteFollowups note={n} state={state} compact />
        <NoteCardActions
          note={n}
          t={t}
          state={state}
          replying={replying}
          onToggleReply={onToggleReply}
          onDoneReply={onDoneReply}
          compact
          showEdit
          showApprovedDate={state === "done"}
        />
      </CardContent>
    </Card>
  );
}

export function NoteCalendarView({ items }: { items: readonly PlacedWithState[] }) {
  const autoMonth = useMemo(() => latestNoteMonth(items), [items]);
  const [todayKey] = useState(() => localDateKey(new Date().toISOString()));
  const [manualMonth, setManualMonth] = useState<{ year: number; month: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [replyId, setReplyId] = useState<string | null>(null);

  const cursor = manualMonth ?? autoMonth;
  const cells = useMemo(
    () => buildCalendarMonth(cursor.year, cursor.month, items),
    [cursor.year, cursor.month, items],
  );
  const visibleCells = useMemo(
    () =>
      cells.length === 42 && cells.slice(35).every((c) => !c.inMonth && c.items.length === 0)
        ? cells.slice(0, 35)
        : cells,
    [cells],
  );

  // Auto-select latest day with notes inside visible month when none selected
  const activeKey = useMemo(() => {
    if (selectedDay && visibleCells.some((c) => c.key === selectedDay)) return selectedDay;
    const withNotes = visibleCells.filter((c) => c.inMonth && c.items.length > 0);
    return withNotes.at(-1)?.key ?? todayKey ?? visibleCells[0].key;
  }, [visibleCells, selectedDay, todayKey]);

  const activeCell = visibleCells.find((c) => c.key === activeKey);
  const monthLabel = MONTH_FMT.format(new Date(cursor.year, cursor.month, 1));
  const undatedCount = useMemo(() => items.filter((it) => !localDateKey(it.n.at)).length, [items]);
  const cellRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const shiftMonth = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1);
    setManualMonth({ year: next.getFullYear(), month: next.getMonth() });
  };

  const handleCellKeyDown = (idx: number, e: KeyboardEvent<HTMLButtonElement>) => {
    const delta =
      e.key === "ArrowLeft"
        ? -1
        : e.key === "ArrowRight"
          ? 1
          : e.key === "ArrowUp"
            ? -7
            : e.key === "ArrowDown"
              ? 7
              : e.key === "Home"
                ? -idx
                : e.key === "End"
                  ? visibleCells.length - 1 - idx
                  : 0;
    if (!delta && e.key !== "Home" && e.key !== "End") return;
    const targetCell = visibleCells[Math.max(0, Math.min(visibleCells.length - 1, idx + delta))];
    if (!targetCell) return;
    e.preventDefault();
    setSelectedDay(targetCell.key);
    cellRefs.current[targetCell.key]?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <div className="flex-none">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-foreground text-sm font-semibold tabular-nums">{monthLabel}</span>
            {undatedCount > 0 && (
              <span className="text-label/75 font-mono text-xs tabular-nums">
                {undatedCount} undated
              </span>
            )}
          </div>
          <div className="bg-backdrop/75 border-hairline flex items-center gap-0.5 rounded-lg border p-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const now = new Date();
                setManualMonth({ year: now.getFullYear(), month: now.getMonth() });
                setSelectedDay(localDateKey(now.toISOString()));
              }}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>

        <div className="border-hairline bg-hairline-subtle grid grid-cols-7 gap-px overflow-hidden rounded-lg border text-left">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-label bg-card/85 py-1 ps-1.5 text-xs font-medium">
              {w}
            </div>
          ))}
          {visibleCells.map((cell, idx) => (
            <CalendarDayCell
              key={cell.key}
              cell={cell}
              isSelected={cell.key === activeKey}
              cellRef={(el) => {
                cellRefs.current[cell.key] = el;
              }}
              onPick={() => setSelectedDay(cell.key)}
              onKeyDown={(e) => handleCellKeyDown(idx, e)}
            />
          ))}
        </div>
      </div>

      <div className="mt-2.5 flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex flex-none items-center justify-between">
          <span className="text-foreground text-sm font-semibold tabular-nums">
            <CalendarDays aria-hidden className="text-label me-1.5 inline size-3.5" />
            {formatDayKey(activeKey)} ({activeCell?.items.length ?? 0})
          </span>
        </div>
        {!activeCell?.items.length ? (
          <Empty>No notes created on this date.</Empty>
        ) : (
          <VirtualList
            items={activeCell.items}
            getKey={(it) => it.n.id}
            estimateSize={108}
            gap={6}
            overscan={4}
            data-arrow-scroll
            role="list"
            ariaLabel={`Notes on ${activeKey}`}
            className="scroll-fade min-h-24 flex-1 px-0.5"
            renderItem={(item) => (
              <CalendarDayNoteCard
                item={item}
                replying={replyId === item.n.id}
                onToggleReply={() => setReplyId(replyId === item.n.id ? null : item.n.id)}
                onDoneReply={() => setReplyId(null)}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}

function FeedCard({
  item,
  replying,
  onToggleReply,
  onDoneReply,
}: {
  item: PlacedWithState;
  replying: boolean;
  onToggleReply: () => void;
  onDoneReply: () => void;
}) {
  const { n, t, state } = item;
  const media = noteMedia(n);
  const [failedThumb, setFailedThumb] = useState<string | null>(null);
  const showThumb = !!media.thumb && failedThumb !== media.thumb;
  const shot = noteShotTitle(n.shot, n.shotName);
  const lit = useLit(`note:${n.id}`);
  const fix = n.fixes?.at(-1);
  const asking = state === "check" && !!fix?.ask;
  const needsWork = isCreatorNeedsWork(n, state);
  const thread = useMemo(() => noteThread(n, { rewordings: true }), [n]);
  const replies = thread.slice(1);
  const lastAiIdx = replies.findLastIndex((m) => m.by === "ai");
  const created = formatShortDate(n.at);
  const target = noteActionTarget(noteNum(n.id), stamp(t));

  return (
    <Card size="sm" tone={asking ? "ai" : state} data-note={n.id} data-ai-lit={lit || undefined}>
      <CardContent>
        <NoteCardHeader
          note={n}
          t={t}
          state={state}
          asking={asking}
          needsWork={needsWork}
          shotPrimary={shot.primary}
          shotSecondary={shot.secondary}
          shotFull={shot.full}
          lit={lit}
          trailing={
            created ? (
              <span className="text-label/80 font-mono text-xs tabular-nums">{created}</span>
            ) : undefined
          }
        />

        <button
          type="button"
          title={n.text || `Open note ${target}`}
          aria-label={`Open note ${target}: ${n.text || "no words"}`}
          onClick={(e) => openNoteRow(n, state, e.currentTarget)}
          className={cn(
            "text-title/[1.55] hover:text-foreground focus-visible:ring-ring hover:bg-surface-subtle mt-1.5 flex min-h-6 w-full cursor-pointer items-center rounded-sm px-0.5 text-left transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-10",
            state === "done" ? "font-normal text-current" : "text-foreground font-normal",
          )}
        >
          <span className="min-w-0 text-pretty wrap-anywhere whitespace-pre-wrap">
            {n.text || <span className="text-label font-normal italic">(no words)</span>}
          </span>
        </button>
        <NoteTags note={n} />

        {media.thumb && (
          <button
            type="button"
            aria-label={`Jump to frame ${target}`}
            onClick={() => goToNote(n)}
            className="bg-backdrop border-hairline hover:border-primary/50 focus-visible:ring-ring relative mt-2 inline-flex aspect-video max-h-24 w-auto max-w-full cursor-pointer overflow-hidden rounded-lg border transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none"
          >
            {showThumb ? (
              <img
                src={media.thumb}
                loading="lazy"
                decoding="async"
                alt={`Frame at ${stamp(t)}`}
                onError={() => setFailedThumb(media.thumb)}
                className={cn(
                  "block size-full object-contain transition-opacity duration-150 motion-reduce:transition-none",
                  state === "done" && "opacity-75 group-hover/card:opacity-100",
                )}
              />
            ) : (
              <span className="text-label flex size-full flex-col items-center justify-center gap-1 text-xs">
                <Camera aria-hidden className="size-4 opacity-60" />
                <span>Frame unavailable ({stamp(t)})</span>
              </span>
            )}
            {n.pin && media.crop && showThumb && (
              <img
                src={media.crop}
                alt={`Pin: ${n.pin.what}`}
                className="border-primary/80 bg-backdrop pointer-events-none absolute bottom-2 left-2 size-12 rounded-md border object-cover shadow-md"
              />
            )}
          </button>
        )}

        {replies.length > 0 && (
          <ol className="border-hairline mt-2.5 flex flex-col gap-1.5 border-s ps-3">
            {replies.map((m, idx) => {
              const msgDate = formatShortDate(m.at);
              const msgTime = formatShortTime(m.at);
              const prevDate = idx === 0 ? created : formatShortDate(replies[idx - 1]?.at);
              const showDate = !!msgDate && msgDate !== prevDate;
              const stampLabel = showDate ? (msgTime ? `${msgDate} ${msgTime}` : msgDate) : msgTime;
              const isReword = "reworded" in m && m.reworded;
              const isLatestAi = m.by === "ai" && idx === lastAiIdx;
              const isAsk = isLatestAi && state === "check" && !!m.ask;
              const rowCls = isReword
                ? "text-foreground/65 px-1 py-0.5"
                : m.by === "creator"
                  ? "bg-surface-subtle border border-hairline-subtle rounded-md px-2 py-1"
                  : isAsk
                    ? "bg-ai/[0.08] border border-ai/25 rounded-md px-2 py-1.5"
                    : isLatestAi && state === "check"
                      ? "bg-warn/[0.07] border border-warn/25 rounded-md px-2 py-1.5"
                      : isLatestAi && state === "done"
                        ? "bg-ok/[0.06] border border-ok/20 rounded-md px-2 py-1.5"
                        : "bg-surface-subtle/60 border border-hairline-subtle rounded-md px-2 py-1 text-label";
              const who = isReword
                ? "Previous wording"
                : m.by === "creator"
                  ? "You"
                  : isLatestAi && state === "check"
                    ? m.ask
                      ? "AI asks"
                      : "AI says fixed"
                    : isLatestAi && state === "done"
                      ? "AI fixed"
                      : m.ask
                        ? "Previous AI question"
                        : "Previous AI fix";
              return (
                <li key={`${m.at ?? "m"}-${idx}`} className={cn("text-ui", rowCls)}>
                  <div className="text-label flex items-center gap-1.5 text-xs font-semibold">
                    <span
                      className={cn(
                        isAsk
                          ? "text-ai-text"
                          : isLatestAi && state === "check"
                            ? "text-warn-text"
                            : isLatestAi && state === "done"
                              ? "text-ok-text"
                              : isReword
                                ? "text-foreground/65"
                                : undefined,
                      )}
                    >
                      {who}
                    </span>
                    {"checkpoint" in m && m.checkpoint && m.checkpoint !== "no git" && (
                      <span className="font-mono font-normal whitespace-nowrap">
                        {m.checkpoint}
                      </span>
                    )}
                    {stampLabel && (
                      <span className="ms-auto font-mono font-normal whitespace-nowrap">
                        {stampLabel}
                      </span>
                    )}
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 leading-relaxed text-pretty wrap-anywhere whitespace-pre-wrap",
                      isReword ? "text-foreground/65 line-through" : "text-current",
                    )}
                  >
                    {m.text}
                  </p>
                </li>
              );
            })}
          </ol>
        )}

        <LearnedCallout note={n} />

        <NoteCardActions
          note={n}
          t={t}
          state={state}
          replying={replying}
          onToggleReply={onToggleReply}
          onDoneReply={onDoneReply}
          showEdit
          showApprovedDate
        />
      </CardContent>
    </Card>
  );
}

export function NoteFeedView({ items }: { items: readonly PlacedWithState[] }) {
  const sort = useStudio((s) => s.noteSort);
  const [replyId, setReplyId] = useState<string | null>(null);
  const feedSort = sort === "film" ? "film" : "activity";

  const ordered = useMemo(() => {
    if (feedSort !== "activity") return sortPlacedNotes(items, feedSort);
    const active = sortPlacedNotes(
      items.filter((it) => it.state !== "done"),
      "activity",
    );
    const done = sortPlacedNotes(
      items.filter((it) => it.state === "done"),
      "activity",
    );
    return [...active, ...done];
  }, [items, feedSort]);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-2">
      <div className="mb-2 flex flex-none items-center justify-between gap-2">
        <ToggleGroup
          value={[feedSort]}
          onValueChange={(v: string[]) => {
            if (v[0] === "activity" || v[0] === "film") set({ noteSort: v[0] as NoteSort });
          }}
          aria-label="Feed sort order"
          variant="segment"
          size="sm"
          spacing={0.5}
        >
          <ToggleGroupItem value="activity">Latest activity</ToggleGroupItem>
          <ToggleGroupItem value="film">Film order</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <VirtualList
        items={ordered}
        getKey={(it) => it.n.id}
        estimateSize={175}
        gap={10}
        overscan={5}
        data-arrow-scroll
        role="list"
        ariaLabel="Activity feed"
        className="scroll-fade min-h-0 flex-1"
        listClassName="pb-6"
        renderItem={(item) => (
          <FeedCard
            item={item}
            replying={replyId === item.n.id}
            onToggleReply={() => setReplyId(replyId === item.n.id ? null : item.n.id)}
            onDoneReply={() => setReplyId(null)}
          />
        )}
      />
    </div>
  );
}

function ChartDrillRow({
  item,
  replying,
  hideShot = false,
  onToggleReply,
  onDoneReply,
}: {
  item: PlacedWithState;
  replying: boolean;
  hideShot?: boolean;
  onToggleReply: () => void;
  onDoneReply: () => void;
}) {
  const { n, t, state } = item;
  const lit = useLit(`note:${n.id}`);
  const asking = isNoteAsking(n, state);
  const needsWork = isCreatorNeedsWork(n, state);
  const shot = noteShotTitle(n.shot, n.shotName);
  return (
    <div
      data-note={n.id}
      data-tone={asking ? "ai" : state}
      data-ai-lit={lit || undefined}
      className={cn(
        noteSurfaceClass(state, { asking, compact: true }),
        "text-ui flex flex-col gap-1.5",
      )}
    >
      <NoteCardHeader
        note={n}
        t={t}
        state={state}
        asking={asking}
        needsWork={needsWork}
        shotPrimary={shot.primary}
        shotSecondary={shot.secondary}
        shotFull={shot.full}
        hideShot={hideShot}
        lit={lit}
      />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ExpandableNoteText
            text={n.text}
            clampLines={2}
            compact
            openLabel={`Open note ${noteActionTarget(noteNum(n.id), stamp(t))}: ${n.text || "no words"}`}
            onOpen={(el) => openNoteRow(n, state, el)}
          />
          <NoteTags note={n} />
        </div>
        <NoteThumb note={n} t={t} shotFull={shot.full} size="sm" muted={state === "done"} />
      </div>
      <NoteFollowups note={n} state={state} compact />
      <NoteCardActions
        note={n}
        t={t}
        state={state}
        replying={replying}
        onToggleReply={onToggleReply}
        onDoneReply={onDoneReply}
        compact
        showEdit
        showApprovedDate={state === "done"}
      />
    </div>
  );
}

export function NoteChartView({
  items,
  defaultChartType = "bar",
}: {
  items: readonly PlacedWithState[];
  defaultChartType?: "bar" | "donut";
}) {
  const [metric, setMetric] = useState<"status" | "shot" | "day">("shot");
  const [chartType, setChartType] = useState<"bar" | "donut">(defaultChartType);
  const [drillKey, setDrillKey] = useState<string | null>(null);
  const [replyId, setReplyId] = useState<string | null>(null);

  const stats = useMemo(() => buildChartStats(items), [items]);
  const buckets =
    metric === "status" ? stats.byStatus : metric === "shot" ? stats.byShot : stats.byDay;

  const donutBuckets = useMemo(
    () => (metric === "status" ? buckets : buildDonutBuckets(buckets, 5)),
    [buckets, metric],
  );

  const scaleMax =
    metric === "status" ? Math.max(1, stats.total) : Math.max(1, ...buckets.map((b) => b.total));
  const selected =
    buckets.find((b) => b.key === drillKey) ?? donutBuckets.find((b) => b.key === drillKey) ?? null;
  const activeDonut = drillKey ? (donutBuckets.find((b) => b.key === drillKey) ?? null) : null;

  const readyCheckCount = stats.counts.check - stats.asks;
  const donePct = stats.total ? Math.round((stats.counts.done / stats.total) * 100) : 0;

  const drillHighlightCls = (key: string) => {
    if (metric === "status") {
      if (key === "status:check") return "bg-surface-selected ring-warn/65 ring-1";
      if (key === "status:asking") return "bg-surface-selected ring-ai/65 ring-1";
      if (key === "status:open") return "bg-surface-selected ring-primary/65 ring-1";
      if (key === "status:done") return "bg-surface-selected ring-ok/60 ring-1";
    }
    return "bg-surface-selected ring-hairline-strong ring-1";
  };

  const donutSegments = useMemo(() => {
    const total = Math.max(
      1,
      donutBuckets.reduce((sum, b) => sum + b.total, 0),
    );
    const palette = [
      "var(--chart-4)",
      "var(--chart-5)",
      "var(--chart-3)",
      "var(--chart-6)",
      "var(--chart-7)",
      "var(--chart-8)",
    ];
    return donutBuckets.reduce<
      {
        b: (typeof donutBuckets)[number];
        frac: number;
        start: number;
        color: string;
      }[]
    >((list, b, i) => {
      const start = list.length ? list[list.length - 1].start + list[list.length - 1].frac : 0;
      const frac = b.total / total;
      const color =
        metric === "status"
          ? b.key === "status:check"
            ? "var(--warn)"
            : b.key === "status:asking"
              ? "var(--ai)"
              : b.key === "status:open"
                ? "var(--primary)"
                : "var(--ok)"
          : palette[i % palette.length];
      list.push({ b, frac, start, color });
      return list;
    }, []);
  }, [donutBuckets, metric]);

  const circumference = 2 * Math.PI * 39;
  const focusCircumference = 2 * Math.PI * 47.5;

  const pickKpiStatus = (s: "status:check" | "status:asking" | "status:open" | "status:done") => {
    setMetric("status");
    setDrillKey((prev) => (metric === "status" && prev === s ? null : s));
  };

  return (
    <div
      data-arrow-scroll
      className="scroll-fade min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-6"
    >
      <div
        className={cn(
          "border-hairline bg-hairline-subtle grid gap-px overflow-hidden rounded-lg border",
          stats.asks > 0 ? "grid-cols-2 @[340px]:grid-cols-4" : "grid-cols-3",
        )}
      >
        <button
          type="button"
          aria-pressed={metric === "status" && drillKey === "status:check"}
          onClick={() => pickKpiStatus("status:check")}
          className={cn(
            "focus-visible:ring-ring bg-backdrop/90 hover:bg-surface-subtle flex cursor-pointer flex-col items-start px-2.5 py-2 text-left transition-colors outline-none focus-visible:z-10 focus-visible:ring-2 motion-reduce:transition-none",
            metric === "status" &&
              drillKey === "status:check" &&
              "ring-warn/70 z-10 ring-1 ring-inset",
          )}
        >
          <div className="text-label flex items-center gap-1 text-xs font-medium">
            <span aria-hidden className="bg-warn size-1.5 rounded-full" />
            To check
          </div>
          <div className="text-warn-text mt-0.5 font-mono text-base font-semibold tabular-nums">
            {readyCheckCount}
          </div>
        </button>
        {stats.asks > 0 && (
          <button
            type="button"
            aria-pressed={metric === "status" && drillKey === "status:asking"}
            onClick={() => pickKpiStatus("status:asking")}
            className={cn(
              "focus-visible:ring-ring bg-backdrop/90 hover:bg-surface-subtle flex cursor-pointer flex-col items-start px-2.5 py-2 text-left transition-colors outline-none focus-visible:z-10 focus-visible:ring-2 motion-reduce:transition-none",
              metric === "status" &&
                drillKey === "status:asking" &&
                "ring-ai/70 z-10 ring-1 ring-inset",
            )}
          >
            <div className="text-label flex items-center gap-1 text-xs font-medium">
              <span aria-hidden className="bg-ai size-1.5 rounded-full" />
              AI asks
            </div>
            <div className="text-ai-text mt-0.5 font-mono text-base font-semibold tabular-nums">
              {stats.asks}
            </div>
          </button>
        )}
        <button
          type="button"
          aria-pressed={metric === "status" && drillKey === "status:open"}
          onClick={() => pickKpiStatus("status:open")}
          className={cn(
            "focus-visible:ring-ring bg-backdrop/90 hover:bg-surface-subtle flex cursor-pointer flex-col items-start px-2.5 py-2 text-left transition-colors outline-none focus-visible:z-10 focus-visible:ring-2 motion-reduce:transition-none",
            metric === "status" &&
              drillKey === "status:open" &&
              "ring-primary/70 z-10 ring-1 ring-inset",
          )}
        >
          <div className="text-label flex items-center gap-1 text-xs font-medium">
            <span aria-hidden className="bg-primary size-1.5 rounded-full" />
            To fix
          </div>
          <div className="text-primary-text mt-0.5 font-mono text-base font-semibold tabular-nums">
            {stats.counts.open}
          </div>
        </button>
        <button
          type="button"
          aria-pressed={metric === "status" && drillKey === "status:done"}
          onClick={() => pickKpiStatus("status:done")}
          className={cn(
            "focus-visible:ring-ring bg-backdrop/90 hover:bg-surface-subtle flex cursor-pointer flex-col items-start px-2.5 py-2 text-left transition-colors outline-none focus-visible:z-10 focus-visible:ring-2 motion-reduce:transition-none",
            metric === "status" &&
              drillKey === "status:done" &&
              "ring-ok/65 z-10 ring-1 ring-inset",
          )}
        >
          <div className="text-label flex items-center gap-1 text-xs font-medium">
            <span aria-hidden className="bg-ok size-1.5 rounded-full" />
            Done
          </div>
          <div className="text-ok-text mt-0.5 font-mono text-base font-semibold tabular-nums">
            {stats.counts.done}
          </div>
        </button>
        <div className="bg-backdrop/95 col-span-full flex items-center gap-3 px-2.5 py-1.5">
          <div className="text-label shrink-0 text-xs font-medium">Approved</div>
          <div aria-hidden className="bg-hairline h-1.5 flex-1 overflow-hidden rounded-full">
            <div
              style={{ "--done-w": `${donePct}%` } as CSSProperties}
              className="bg-ok h-full w-(--done-w)"
            />
          </div>
          <div className="text-foreground text-ui shrink-0 font-mono font-semibold tabular-nums">
            {donePct}%
          </div>
        </div>
      </div>

      <Card size="sm">
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              value={[metric]}
              onValueChange={(v: string[]) => {
                if (v[0] === "status" || v[0] === "shot" || v[0] === "day") {
                  setMetric(v[0]);
                  setDrillKey(null);
                }
              }}
              aria-label="Chart breakdown"
              variant="segment"
              size="sm"
              spacing={0.5}
            >
              <ToggleGroupItem value="status">Status</ToggleGroupItem>
              <ToggleGroupItem value="shot">Shot</ToggleGroupItem>
              <ToggleGroupItem value="day">Day</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              value={[chartType]}
              onValueChange={(v: string[]) => {
                if (v[0] === "bar" || v[0] === "donut") setChartType(v[0]);
              }}
              aria-label="Chart style"
              variant="segment"
              size="icon-sm"
              spacing={0.5}
            >
              <ToggleGroupItem value="bar" aria-label="Bar chart">
                <BarChart3 aria-hidden />
              </ToggleGroupItem>
              <ToggleGroupItem value="donut" aria-label="Donut chart">
                <PieChart aria-hidden />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {chartType === "bar" ? (
            <div className="flex flex-col gap-1.5">
              {buckets.map((b) => {
                const active = drillKey === b.key;
                return (
                  <button
                    key={b.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDrillKey(active ? null : b.key)}
                    className={cn(
                      "focus-visible:ring-ring hover:bg-surface-subtle block w-full cursor-pointer rounded-lg p-1.5 text-left transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-10",
                      active && drillHighlightCls(b.key),
                    )}
                  >
                    <div className="text-ui mb-1 flex items-center justify-between gap-2">
                      <span className="truncate font-medium">
                        {b.label}
                        {b.subtitle && (
                          <span className="text-label font-normal"> · {b.subtitle}</span>
                        )}
                      </span>
                      <span className="text-label shrink-0 font-mono tabular-nums">
                        {b.total}
                        {stats.total > 0 && ` (${Math.round((b.total / stats.total) * 100)}%)`}
                      </span>
                    </div>
                    <div className="bg-hairline-subtle flex h-2 w-full overflow-hidden rounded-full">
                      {b.check > 0 && (
                        <div
                          style={{ "--bar-w": `${(b.check / scaleMax) * 100}%` } as CSSProperties}
                          className="bg-warn h-full w-(--bar-w)"
                        />
                      )}
                      {b.asking > 0 && (
                        <div
                          style={{ "--bar-w": `${(b.asking / scaleMax) * 100}%` } as CSSProperties}
                          className="bg-ai h-full w-(--bar-w)"
                        />
                      )}
                      {b.open > 0 && (
                        <div
                          style={{ "--bar-w": `${(b.open / scaleMax) * 100}%` } as CSSProperties}
                          className="bg-primary h-full w-(--bar-w)"
                        />
                      )}
                      {b.done > 0 && (
                        <div
                          style={{ "--bar-w": `${(b.done / scaleMax) * 100}%` } as CSSProperties}
                          className="bg-ok h-full w-(--bar-w)"
                        />
                      )}
                    </div>
                  </button>
                );
              })}
              {metric !== "status" && buckets.length > 1 && scaleMax < stats.total && (
                <p className="text-label/75 px-1.5 pt-0.5 text-xs text-pretty">
                  Bar width scales to top bucket; % shows share of all notes.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 @[340px]:flex-row">
              <div className="relative size-28 shrink-0">
                <svg
                  viewBox="0 0 100 100"
                  aria-hidden="true"
                  className="pointer-events-none size-full -rotate-90 overflow-visible"
                >
                  <circle
                    cx="50"
                    cy="50"
                    r="39"
                    fill="none"
                    stroke="var(--backdrop)"
                    strokeWidth="11"
                  />
                  {donutSegments.map(({ b, frac, start, color }) => {
                    const len = frac * circumference;
                    const focusLen = frac * focusCircumference;
                    const active = drillKey === b.key;
                    return (
                      <g key={b.key}>
                        <circle
                          cx="50"
                          cy="50"
                          r="39"
                          fill="none"
                          stroke={color}
                          strokeWidth={active ? "14" : drillKey ? "9.5" : "11"}
                          strokeDasharray={`${len} ${circumference}`}
                          strokeDashoffset={-start * circumference}
                          className="pointer-events-none"
                        />
                        {active && (
                          <circle
                            cx="50"
                            cy="50"
                            r="47.5"
                            fill="none"
                            stroke={color}
                            strokeWidth="2"
                            strokeDasharray={`${focusLen} ${focusCircumference}`}
                            strokeDashoffset={-start * focusCircumference}
                            className="pointer-events-none opacity-85"
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-base font-semibold tabular-nums">
                    {activeDonut ? activeDonut.total : stats.total}
                  </span>
                  <span className="text-label max-w-18 truncate px-1 text-center text-xs">
                    {activeDonut ? activeDonut.label : "notes"}
                  </span>
                </div>
              </div>
              <ul className="flex w-full min-w-0 flex-1 flex-col gap-1">
                {donutSegments.map(({ b, color }) => {
                  const pct = stats.total > 0 ? Math.round((b.total / stats.total) * 100) : 0;
                  return (
                    <li key={b.key}>
                      <button
                        type="button"
                        aria-pressed={drillKey === b.key}
                        onClick={() => setDrillKey(drillKey === b.key ? null : b.key)}
                        className={cn(
                          "focus-visible:ring-ring hover:bg-surface-subtle text-ui flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-10",
                          drillKey === b.key && drillHighlightCls(b.key),
                        )}
                      >
                        <span
                          aria-hidden
                          style={{ "--dot": color } as CSSProperties}
                          className="size-2.5 shrink-0 rounded-full bg-(--dot)"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {b.label}
                          {b.subtitle && (
                            <span className="text-label font-normal"> · {b.subtitle}</span>
                          )}
                        </span>
                        <span className="text-label shrink-0 font-mono tabular-nums">
                          {b.total} ({pct}%)
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card size="sm">
          <CardContent>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold tabular-nums">
                {selected.label} ({selected.items.length})
              </span>
              <Button
                variant="subtle"
                size="icon-sm"
                aria-label="Clear chart filter"
                onClick={() => setDrillKey(null)}
              >
                <X aria-hidden />
              </Button>
            </div>
            {selected.items.length <= 15 ? (
              <ul aria-label={`${selected.label} notes`} className="flex flex-col gap-1.5">
                {selected.items.map((item) => (
                  <li key={item.n.id}>
                    <ChartDrillRow
                      item={item}
                      hideShot={metric === "shot"}
                      replying={replyId === item.n.id}
                      onToggleReply={() => setReplyId(replyId === item.n.id ? null : item.n.id)}
                      onDoneReply={() => setReplyId(null)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <VirtualList
                items={selected.items}
                getKey={(it) => it.n.id}
                estimateSize={98}
                gap={6}
                overscan={6}
                data-arrow-scroll
                role="list"
                ariaLabel={`${selected.label} notes`}
                className="scroll-fade max-h-72 min-h-16 px-0.5"
                renderItem={(item) => (
                  <ChartDrillRow
                    item={item}
                    hideShot={metric === "shot"}
                    replying={replyId === item.n.id}
                    onToggleReply={() => setReplyId(replyId === item.n.id ? null : item.n.id)}
                    onDoneReply={() => setReplyId(null)}
                  />
                )}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
