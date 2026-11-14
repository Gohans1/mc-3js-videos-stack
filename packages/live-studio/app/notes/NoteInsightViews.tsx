// Notion-style Temporal, Stream & Analytics views: Timeline (Gantt), Calendar, Feed, and Chart.
import { DURATION } from "film/scene";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  PieChart,
  X,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { noteThread } from "../../src/note-state.mjs";
import { useLit, useLitAny } from "../activity/activity";
import { VirtualList } from "../components/VirtualList";
import { PHONE } from "../core/device";
import { stamp } from "../core/time";
import { noteShotTitle } from "./note-card-meta";
import {
  Empty,
  ExpandableNoteText,
  formatShortDate,
  LearnedCallout,
  NoteCardActions,
  NoteFollowups,
  NoteNumber,
  noteSurfaceClass,
  NoteTags,
  NoteThumb,
  NoteTimeChip,
  openNoteRow,
  StatusPill,
} from "./note-parts";
import {
  buildCalendarMonth,
  buildChartStats,
  buildDonutBuckets,
  buildTimelineLanes,
  calendarStatusBreakdown,
  isCreatorNeedsWork,
  latestNoteMonth,
  localDateKey,
  packTimelineRows,
  type PlacedWithState,
  sortPlacedNotes,
  timelineMinPillPct,
} from "./note-views-model";
import { goToNote, noteMedia, noteNum } from "./notes";
import type { NoteState } from "./slice";

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

function StateGlyph({ state }: { state: NoteState }) {
  if (state === "check") return <AlertCircle aria-hidden className="size-3 shrink-0" />;
  if (state === "done") return <Check aria-hidden className="text-ok-text size-3 shrink-0" />;
  return <CircleDot aria-hidden className="size-3 shrink-0" />;
}

function TimelinePillButton({
  p,
  row,
  leftPct,
  widthPct,
  active,
  onPick,
}: {
  p: PlacedWithState;
  row: number;
  leftPct: number;
  widthPct: number;
  active: boolean;
  onPick: () => void;
}) {
  const lit = useLit(`note:${p.n.id}`);
  const num = noteNum(p.n.id);
  const needsWork = isCreatorNeedsWork(p.n, p.state);
  const asking = p.state === "check" && !!p.n.fixes?.at(-1)?.ask;
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
  const toneCls =
    p.state === "check"
      ? "bg-warn text-black border-warn font-semibold"
      : p.state === "done"
        ? "bg-background/85 text-foreground/75 border-ok/35"
        : "bg-tint text-primary border-primary/70";
  return (
    <button
      type="button"
      data-note={p.n.id}
      data-ai-lit={lit || undefined}
      title={`${num != null ? `#${num} · ` : ""}${stateLabel} · ${stamp(p.t)} · ${p.n.text || "(no words)"}`}
      aria-label={`${num != null ? `Note #${num}, ` : ""}${stateLabel}: ${p.n.text || "Note"} at ${stamp(p.t)}`}
      aria-pressed={active}
      onClick={onPick}
      style={
        {
          "--tl-top": `${row * 28 + 3}px`,
          "--tl-left": `${leftPct}%`,
          "--tl-w": `${widthPct}%`,
        } as CSSProperties
      }
      className={cn(
        "focus-visible:ring-ring text-tag @container absolute top-(--tl-top) left-(--tl-left) flex h-6 w-(--tl-w) items-center gap-1 overflow-hidden rounded-full border px-1.5 font-medium transition-colors duration-150 outline-none focus-visible:ring-2",
        active && "ring-foreground/85 z-10 shadow-xs ring-2",
        toneCls,
      )}
    >
      <StateGlyph state={p.state} />
      {num != null && <span className="shrink-0 font-mono font-semibold tabular-nums">#{num}</span>}
      <span className="hidden shrink-0 font-mono tabular-nums opacity-80 @[74px]:inline">
        {shortTick(p.t)}
      </span>
      {p.n.text && <span className="hidden min-w-0 truncate @[118px]:inline">{p.n.text}</span>}
    </button>
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
  const needsWork = isCreatorNeedsWork(n, state);
  const shot = noteShotTitle(n.shot, n.shotName);
  const replying = replyId === n.id;

  return (
    <div className="flex-none px-3 pt-1.5 pb-2">
      <Card size="sm" tone={state} data-note={n.id} data-ai-lit={lit || undefined}>
        <CardContent>
          <div className="flex flex-wrap items-center gap-1.5">
            <NoteNumber id={n.id} />
            <StatusPill state={state} asking={!!fix?.ask} needsWork={needsWork} />
            <NoteTimeChip note={n} t={t} />
            <span className="text-label min-w-0 flex-1 truncate text-xs" title={shot.full}>
              <span className="text-foreground/90 font-medium">{shot.primary}</span>
              {shot.secondary && ` · ${shot.secondary}`}
            </span>
          </div>
          <div className="mt-1.5 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ExpandableNoteText
                text={n.text}
                clampLines={2}
                openLabel={`Open note at ${stamp(t)}: ${n.text || "no words"}`}
                onOpen={(el) => openNoteRow(n, state, el)}
              />
              <NoteTags note={n} />
            </div>
            <NoteThumb note={n} t={t} shotFull={shot.full} size="sm" muted={state === "done"} />
          </div>
          <NoteFollowups note={n} state={state} />
          <NoteCardActions
            note={n}
            t={t}
            state={state}
            replying={replying}
            onToggleReply={() => setReplyId(replying ? null : n.id)}
            onDoneReply={() => setReplyId(null)}
            compact
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
    const count = zoom === 2 ? 6 : 3;
    return Array.from({ length: count + 1 }, (_, i) => (duration * i) / count);
  }, [duration, zoom]);

  const trackWidthPx = Math.max(180, wrapWidth - 118);
  const minPillPct = timelineMinPillPct(trackWidthPx, zoom, zoom === 2 ? 124 : 58);
  const packedLanes = useMemo(
    () => lanes.map((lane) => ({ lane, ...packTimelineRows(lane.items, duration, minPillPct) })),
    [lanes, duration, minPillPct],
  );

  const picked = items.find((it) => it.n.id === pickedId) ?? lanes[0]?.items[0]?.p ?? null;
  const listWidthCls = zoom === 2 ? "w-[200%] min-w-85 px-3 pb-2" : "w-full min-w-0 px-3 pb-2";

  const ruler = (
    <div className={zoom === 2 ? "w-[200%] min-w-85 px-3 pt-1" : "w-full min-w-0 px-3 pt-1"}>
      <div className="border-border bg-background/95 sticky top-0 z-10 mb-2 flex items-center border-b pb-1 backdrop-blur-xs">
        <div className="text-label text-tag w-24 shrink-0 font-medium">Shot</div>
        <div className="relative h-5 flex-1">
          {ticks.map((sec, i) => {
            const pct = (sec / duration) * 100;
            return (
              <span
                key={i}
                style={{ "--tick-left": `${pct}%` } as CSSProperties}
                className={cn(
                  "text-label/80 text-tag absolute top-0 left-(--tick-left) font-mono whitespace-nowrap tabular-nums",
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
    </div>
  );

  return (
    <div ref={wrapRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between gap-2 px-3 pb-1.5">
        <span className="text-label text-tag font-mono tabular-nums">
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
          <ToggleGroupItem value="1" className="pointer-coarse:min-h-9">
            Fit
          </ToggleGroupItem>
          <ToggleGroupItem value="2" className="pointer-coarse:min-h-9">
            2× zoom
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <VirtualList
        items={packedLanes}
        getKey={(entry) => entry.lane.shot}
        estimateSize={(i) => (packedLanes[i]?.rows ?? 1) * 28 + 18}
        gap={6}
        overscan={4}
        ariaLabel="Timeline shot lanes"
        className="scroll-fade min-h-0 flex-1 overflow-auto"
        listClassName={listWidthCls}
        header={ruler}
        renderItem={({ lane, rows, packed }) => (
          <div className="bg-card/55 border-border/50 flex items-center rounded-lg border px-2 py-1.5">
            <div className="w-22 shrink-0 pe-2">
              <div className="text-foreground/95 truncate text-xs font-semibold">{lane.title}</div>
              {lane.subtitle && (
                <div className="text-label/75 text-tag truncate">{lane.subtitle}</div>
              )}
            </div>
            <div
              style={{ "--tl-h": `${rows * 28 + 4}px` } as CSSProperties}
              className="bg-backdrop/75 relative h-(--tl-h) flex-1 rounded-md"
            >
              {packed.map(({ item: { p }, row, leftPct, widthPct }) => (
                <TimelinePillButton
                  key={p.n.id}
                  p={p}
                  row={row}
                  leftPct={leftPct}
                  widthPct={widthPct}
                  active={picked?.n.id === p.n.id}
                  onPick={() => {
                    setPickedId(p.n.id);
                    goToNote(p.n);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      />

      {picked && <TimelinePickedCard picked={picked} replyId={replyId} setReplyId={setReplyId} />}
    </div>
  );
}

function CalendarDayCell({
  cell,
  isSelected,
  onPick,
}: {
  cell: ReturnType<typeof buildCalendarMonth>[number];
  isSelected: boolean;
  onPick: () => void;
}) {
  const keys = useMemo(() => cell.items.map((it) => `note:${it.n.id}`), [cell.items]);
  const lit = useLitAny(keys);
  const breakdown = cell.items.length ? calendarStatusBreakdown(cell.items) : null;
  return (
    <button
      type="button"
      data-ai-lit={lit || undefined}
      aria-pressed={isSelected}
      aria-label={
        breakdown
          ? `${cell.key}: ${breakdown.check} to check, ${breakdown.open} to fix, ${breakdown.done} done`
          : `${cell.key}: 0 notes`
      }
      onClick={onPick}
      className={cn(
        "focus-visible:ring-ring flex min-h-10 flex-col items-start justify-between rounded-lg border p-1 text-left transition-colors duration-100 outline-none focus-visible:ring-2 @[420px]:min-h-12",
        cell.inMonth
          ? "bg-card/65 border-border/55"
          : "bg-background/30 border-border/25 opacity-45",
        isSelected && "border-primary bg-tint/45 ring-primary/50 ring-1",
        !isSelected && "hover:border-foreground/25",
      )}
    >
      <span
        className={cn(
          "text-tag inline-flex size-4.5 items-center justify-center rounded-full font-mono tabular-nums",
          cell.isToday ? "bg-primary text-primary-foreground font-bold" : "text-foreground/85",
        )}
      >
        {cell.day}
      </span>
      {breakdown && (
        <div className="text-tag flex w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono leading-none tabular-nums">
          {breakdown.check > 0 && (
            <span
              className="text-warn inline-flex items-center gap-0.5 font-semibold"
              title="To check"
            >
              <span aria-hidden className="bg-warn size-1.5 rounded-full" />
              {breakdown.check}
            </span>
          )}
          {breakdown.open > 0 && (
            <span
              className="text-primary inline-flex items-center gap-0.5 font-semibold"
              title="To fix"
            >
              <span aria-hidden className="bg-primary size-1.5 rounded-full" />
              {breakdown.open}
            </span>
          )}
          {breakdown.done > 0 && (
            <span
              className="text-ok-text inline-flex items-center gap-0.5 font-semibold"
              title="Done"
            >
              <span aria-hidden className="bg-ok size-1.5 rounded-full" />
              {breakdown.done}
            </span>
          )}
        </div>
      )}
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
  const needsWork = isCreatorNeedsWork(n, state);
  const shot = noteShotTitle(n.shot, n.shotName);

  return (
    <Card size="sm" tone={state} data-note={n.id} data-ai-lit={lit || undefined}>
      <CardContent>
        <div className="flex flex-wrap items-center gap-1.5">
          <NoteNumber id={n.id} />
          <StatusPill state={state} asking={!!fix?.ask} needsWork={needsWork} />
          <NoteTimeChip note={n} t={t} />
          <span className="text-label min-w-0 flex-1 truncate text-xs" title={shot.full}>
            <span className="text-foreground/90 font-medium">{shot.primary}</span>
            {shot.secondary && ` · ${shot.secondary}`}
          </span>
        </div>
        <div className="mt-1.5 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ExpandableNoteText
              text={n.text}
              clampLines={3}
              openLabel={`Open note at ${stamp(t)}: ${n.text || "no words"}`}
              onOpen={(el) => openNoteRow(n, state, el)}
            />
            <NoteTags note={n} />
          </div>
          <NoteThumb note={n} t={t} shotFull={shot.full} size="sm" muted={state === "done"} />
        </div>
        <NoteFollowups note={n} state={state} />
        <NoteCardActions
          note={n}
          t={t}
          state={state}
          replying={replying}
          onToggleReply={onToggleReply}
          onDoneReply={onDoneReply}
          compact
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

  // Auto-select latest day with notes inside visible month when none selected
  const activeKey = useMemo(() => {
    if (selectedDay && cells.some((c) => c.key === selectedDay)) return selectedDay;
    const withNotes = cells.filter((c) => c.inMonth && c.items.length > 0);
    return withNotes.at(-1)?.key ?? todayKey ?? cells[0].key;
  }, [cells, selectedDay, todayKey]);

  const activeCell = cells.find((c) => c.key === activeKey);
  const monthLabel = MONTH_FMT.format(new Date(cursor.year, cursor.month, 1));

  const shiftMonth = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1);
    setManualMonth({ year: next.getFullYear(), month: next.getMonth() });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <div className="flex-none">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-foreground text-xs font-semibold tabular-nums">{monthLabel}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              className="pointer-coarse:min-h-9"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="pointer-coarse:min-h-9"
              onClick={() => {
                const now = new Date();
                setManualMonth({ year: now.getFullYear(), month: now.getMonth() });
                setSelectedDay(localDateKey(now.toISOString()));
              }}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              className="pointer-coarse:min-h-9"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-label text-tag pb-0.5 font-medium">
              {w}
            </div>
          ))}
          {cells.map((cell) => (
            <CalendarDayCell
              key={cell.key}
              cell={cell}
              isSelected={cell.key === activeKey}
              onPick={() => setSelectedDay(cell.key)}
            />
          ))}
        </div>
      </div>

      <div className="mt-2.5 flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex flex-none items-center justify-between">
          <span className="text-foreground text-xs font-semibold tabular-nums">
            <CalendarDays aria-hidden className="text-primary me-1 inline size-3.5" />
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
  const needsWork = isCreatorNeedsWork(n, state);
  const thread = useMemo(() => noteThread(n, { rewordings: true }), [n]);
  const replies = thread.slice(1);
  const lastAiIdx = replies.findLastIndex((m) => m.by === "ai");
  const created = formatShortDate(n.at);

  return (
    <Card size="sm" tone={state} data-note={n.id} data-ai-lit={lit || undefined}>
      <CardContent>
        <div className="flex flex-wrap items-center gap-1.5">
          <NoteNumber id={n.id} />
          <StatusPill state={state} asking={!!fix?.ask} needsWork={needsWork} />
          <NoteTimeChip note={n} t={t} />
          <span className="text-label min-w-0 flex-1 truncate text-xs" title={shot.full}>
            <span className="text-foreground/90 font-medium">{shot.primary}</span>
            {shot.secondary && ` · ${shot.secondary}`}
          </span>
          {created && (
            <span className="text-label/75 text-tag font-mono tabular-nums">{created}</span>
          )}
        </div>

        <button
          type="button"
          title={n.text || `Open note at ${stamp(t)}`}
          aria-label={n.text ? undefined : `Open untitled note at ${stamp(t)}`}
          onClick={(e) => openNoteRow(n, state, e.currentTarget)}
          className="text-ui text-foreground hover:text-primary focus-visible:ring-ring mt-2 w-full cursor-pointer rounded-sm text-left leading-relaxed wrap-anywhere whitespace-pre-wrap outline-none focus-visible:ring-2"
        >
          {n.text || <span className="text-label italic">(no words)</span>}
        </button>
        <NoteTags note={n} />

        {media.thumb && (
          <button
            type="button"
            aria-label={`Jump to frame at ${stamp(t)}`}
            onClick={() => goToNote(n)}
            className="bg-backdrop hover:border-primary/70 focus-visible:ring-ring border-border relative mt-2 block w-full cursor-pointer overflow-hidden rounded-lg border transition-colors outline-none focus-visible:ring-2"
          >
            {showThumb ? (
              <img
                src={media.thumb}
                loading="lazy"
                decoding="async"
                alt={`Frame at ${stamp(t)}`}
                onError={() => setFailedThumb(media.thumb)}
                className={cn(
                  "block max-h-44 w-full object-cover transition-opacity duration-150",
                  state === "done" && "opacity-75 group-hover/card:opacity-100",
                )}
              />
            ) : (
              <span className="text-label flex h-24 w-full flex-col items-center justify-center gap-1 text-xs">
                <Camera aria-hidden className="size-4 opacity-60" />
                <span>Frame unavailable ({stamp(t)})</span>
              </span>
            )}
            {n.pin && media.crop && showThumb && (
              <img
                src={media.crop}
                alt={`Pinned: ${n.pin.what}`}
                className="border-primary/80 bg-backdrop pointer-events-none absolute bottom-2 left-2 size-12 rounded-md border object-cover shadow-md"
              />
            )}
          </button>
        )}

        {replies.length > 0 && (
          <ol className="border-border/60 mt-2.5 flex flex-col gap-1.5 border-s ps-2.5">
            {replies.map((m, idx) => {
              const msgDate = formatShortDate(m.at);
              const isReword = "reworded" in m && m.reworded;
              const isLatestAi = m.by === "ai" && idx === lastAiIdx;
              const boxCls = isReword
                ? "bg-background/55 border-border/35 text-label"
                : m.by === "creator"
                  ? "bg-background/85 border-border/50"
                  : isLatestAi && state === "check"
                    ? "bg-warn-bg/85 border-warn/40"
                    : isLatestAi && state === "done"
                      ? "bg-ok/10 border-ok/30"
                      : "bg-background/65 border-border/40 text-label";
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
                <li
                  key={`${m.at ?? "m"}-${idx}`}
                  className={cn("rounded-md border px-2 py-1.5 text-xs", boxCls)}
                >
                  <div className="text-label text-tag flex items-center gap-1.5 font-semibold">
                    <span
                      className={cn(
                        isLatestAi && state === "check" && "text-warn",
                        isLatestAi && state === "done" && "text-ok-text",
                      )}
                    >
                      {who}
                    </span>
                    {"checkpoint" in m && m.checkpoint && (
                      <span className="font-mono font-normal">{m.checkpoint}</span>
                    )}
                    {msgDate && <span className="ms-auto font-normal">{msgDate}</span>}
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 leading-snug wrap-anywhere whitespace-pre-wrap",
                      isReword ? "text-label line-through opacity-75" : "text-foreground/90",
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
          showApprovedDate
        />
      </CardContent>
    </Card>
  );
}

export function NoteFeedView({ items }: { items: readonly PlacedWithState[] }) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [replyId, setReplyId] = useState<string | null>(null);

  const ordered = useMemo(
    () => (newestFirst ? sortPlacedNotes(items, "activity") : items),
    [items, newestFirst],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-2">
      <div className="mb-2 flex flex-none items-center justify-between gap-2">
        <ToggleGroup
          value={[newestFirst ? "activity" : "film"]}
          onValueChange={(v: string[]) => {
            if (v[0] === "activity" || v[0] === "film") setNewestFirst(v[0] === "activity");
          }}
          aria-label="Feed sort order"
          variant="segment"
          size="sm"
          spacing={0.5}
        >
          <ToggleGroupItem value="activity" className="pointer-coarse:min-h-9">
            Recent activity
          </ToggleGroupItem>
          <ToggleGroupItem value="film" className="pointer-coarse:min-h-9">
            Film order
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <VirtualList
        items={ordered}
        getKey={(it) => it.n.id}
        estimateSize={175}
        gap={10}
        overscan={5}
        ariaLabel="Activity feed"
        className="scroll-fade min-h-0 flex-1"
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

function ChartDrillRow({ item }: { item: PlacedWithState }) {
  const { n, t, state } = item;
  const lit = useLit(`note:${n.id}`);
  const fix = n.fixes?.at(-1);
  const needsWork = isCreatorNeedsWork(n, state);
  const actionLabel = state === "open" ? "Edit" : PHONE ? "Open" : "Review";
  return (
    <div
      role="listitem"
      data-note={n.id}
      data-ai-lit={lit || undefined}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-colors",
        noteSurfaceClass(state, { compact: true }),
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <NoteNumber id={n.id} />
        <StatusPill state={state} asking={!!fix?.ask} needsWork={needsWork} compact />
        <NoteTimeChip note={n} t={t} />
        <Button
          variant="outline"
          size="sm"
          className="ms-auto pointer-coarse:min-h-9"
          onClick={(e) => openNoteRow(n, state, e.currentTarget)}
        >
          {actionLabel}
        </Button>
      </div>
      <ExpandableNoteText text={n.text} clampLines={2} />
      <NoteFollowups note={n} state={state} compact />
    </div>
  );
}

export function NoteChartView({ items }: { items: readonly PlacedWithState[] }) {
  const [metric, setMetric] = useState<"status" | "shot" | "day">("status");
  const [chartType, setChartType] = useState<"bar" | "donut">("bar");
  const [drillKey, setDrillKey] = useState<string | null>(null);

  const stats = useMemo(() => buildChartStats(items), [items]);
  const buckets =
    metric === "status" ? stats.byStatus : metric === "shot" ? stats.byShot : stats.byDay;

  const donutBuckets = useMemo(
    () => (metric === "status" ? buckets : buildDonutBuckets(buckets, 5)),
    [buckets, metric],
  );

  const maxVal = Math.max(1, ...buckets.map((b) => b.total));
  const selected =
    buckets.find((b) => b.key === drillKey) ?? donutBuckets.find((b) => b.key === drillKey) ?? null;

  const donePct = stats.total ? Math.round((stats.counts.done / stats.total) * 100) : 0;

  const donutSegments = useMemo(() => {
    const total = Math.max(
      1,
      donutBuckets.reduce((sum, b) => sum + b.total, 0),
    );
    const palette = [
      "var(--warn)",
      "var(--primary)",
      "var(--ok)",
      "var(--ink)",
      "var(--in-out-text)",
      "var(--label)",
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
          ? i === 0
            ? "var(--warn)"
            : i === 1
              ? "var(--primary)"
              : "var(--ok)"
          : palette[i % palette.length];
      list.push({ b, frac, start, color });
      return list;
    }, []);
  }, [donutBuckets, metric]);

  const circumference = 2 * Math.PI * 38;

  return (
    <div className="scroll-fade flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3">
      <div className="grid grid-cols-2 gap-1.5 @[340px]:grid-cols-4">
        <Card size="sm" tone={stats.counts.check > 0 ? "check" : "default"}>
          <CardContent>
            <div className="text-label text-tag">To check</div>
            <div className="text-warn font-mono text-base font-semibold tabular-nums">
              {stats.counts.check}
            </div>
          </CardContent>
        </Card>
        <Card size="sm" tone="open">
          <CardContent>
            <div className="text-label text-tag">To fix</div>
            <div className="text-primary font-mono text-base font-semibold tabular-nums">
              {stats.counts.open}
            </div>
          </CardContent>
        </Card>
        <Card size="sm" tone="done">
          <CardContent>
            <div className="text-label text-tag">Done</div>
            <div className="text-ok-text font-mono text-base font-semibold tabular-nums">
              {stats.counts.done}
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <div className="text-label text-tag">Approved</div>
            <div className="text-foreground font-mono text-base font-semibold tabular-nums">
              {donePct}%
            </div>
          </CardContent>
        </Card>
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
              <ToggleGroupItem value="status" className="pointer-coarse:min-h-9">
                Status
              </ToggleGroupItem>
              <ToggleGroupItem value="shot" className="pointer-coarse:min-h-9">
                Shot
              </ToggleGroupItem>
              <ToggleGroupItem value="day" className="pointer-coarse:min-h-9">
                Day
              </ToggleGroupItem>
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
              <ToggleGroupItem
                value="bar"
                aria-label="Bar chart"
                className="pointer-coarse:min-h-9"
              >
                <BarChart3 />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="donut"
                aria-label="Donut chart"
                className="pointer-coarse:min-h-9"
              >
                <PieChart />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {chartType === "bar" ? (
            <div className="flex flex-col gap-2">
              {buckets.map((b) => {
                const active = drillKey === b.key;
                return (
                  <button
                    key={b.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDrillKey(active ? null : b.key)}
                    className={cn(
                      "hover:bg-background/70 focus-visible:ring-ring block w-full cursor-pointer rounded-lg p-1.5 text-left transition-colors outline-none focus-visible:ring-2",
                      active && "bg-tint/40 ring-primary/60 ring-1",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium">
                        {b.label}
                        {b.subtitle && (
                          <span className="text-label font-normal"> · {b.subtitle}</span>
                        )}
                      </span>
                      <span className="text-label shrink-0 font-mono tabular-nums">{b.total}</span>
                    </div>
                    <div className="bg-backdrop flex h-2.5 w-full overflow-hidden rounded-full">
                      {b.check > 0 && (
                        <div
                          style={{ "--bar-w": `${(b.check / maxVal) * 100}%` } as CSSProperties}
                          className="bg-warn h-full w-(--bar-w)"
                        />
                      )}
                      {b.open > 0 && (
                        <div
                          style={{ "--bar-w": `${(b.open / maxVal) * 100}%` } as CSSProperties}
                          className="bg-primary h-full w-(--bar-w)"
                        />
                      )}
                      {b.done > 0 && (
                        <div
                          style={{ "--bar-w": `${(b.done / maxVal) * 100}%` } as CSSProperties}
                          className="bg-ok h-full w-(--bar-w)"
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 @[340px]:flex-row">
              <div className="relative size-28 shrink-0">
                <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke="var(--backdrop)"
                    strokeWidth="12"
                  />
                  {donutSegments.map(({ b, frac, start, color }) => {
                    const len = frac * circumference;
                    return (
                      <circle
                        key={b.key}
                        cx="50"
                        cy="50"
                        r="38"
                        fill="none"
                        stroke={color}
                        strokeWidth="12"
                        strokeDasharray={`${len} ${circumference}`}
                        strokeDashoffset={-start * circumference}
                      />
                    );
                  })}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-base font-semibold tabular-nums">
                    {stats.total}
                  </span>
                  <span className="text-label text-tag">notes</span>
                </div>
              </div>
              <ul className="flex w-full min-w-0 flex-1 flex-col gap-1">
                {donutSegments.map(({ b, color }) => (
                  <li key={b.key}>
                    <button
                      type="button"
                      aria-pressed={drillKey === b.key}
                      onClick={() => setDrillKey(drillKey === b.key ? null : b.key)}
                      className={cn(
                        "hover:bg-background/70 focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs outline-none focus-visible:ring-2",
                        drillKey === b.key && "bg-tint/40 ring-primary/60 ring-1",
                      )}
                    >
                      <span
                        aria-hidden
                        style={{ "--dot": color } as CSSProperties}
                        className="size-2.5 shrink-0 rounded-full bg-(--dot)"
                      />
                      <span className="min-w-0 flex-1 truncate">{b.label}</span>
                      <span className="text-label font-mono tabular-nums">{b.total}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card size="sm">
          <CardContent>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">
                {selected.label} ({selected.items.length})
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                className="pointer-coarse:min-h-9"
                aria-label="Clear chart filter"
                onClick={() => setDrillKey(null)}
              >
                <X />
              </Button>
            </div>
            {selected.items.length <= 15 ? (
              <div
                role="list"
                aria-label={`${selected.label} notes`}
                className="flex flex-col gap-1.5"
              >
                {selected.items.map((item) => (
                  <ChartDrillRow key={item.n.id} item={item} />
                ))}
              </div>
            ) : (
              <VirtualList
                items={selected.items}
                getKey={(it) => it.n.id}
                estimateSize={74}
                gap={6}
                overscan={6}
                role="list"
                ariaLabel={`${selected.label} notes`}
                className="scroll-fade max-h-72 min-h-16 px-0.5"
                renderItem={(item) => <ChartDrillRow item={item} />}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
