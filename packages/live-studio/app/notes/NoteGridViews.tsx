// Notion-style Grid/Structured Notes views: Board (Kanban), Table, List, and Gallery.
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Camera,
  Check,
  ClipboardCheck,
  Columns3,
  MessageSquarePlus,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { useLit } from "../activity/activity";
import { TabStage } from "../components/Motion";
import { chunkRows } from "../components/virtual-utils";
import { useVirtualTable, VirtualList } from "../components/VirtualList";
import { PHONE } from "../core/device";
import { say } from "../core/store";
import { stamp } from "../core/time";
import { noteShotTitle } from "./note-card-meta";
import {
  Empty,
  ExpandableNoteText,
  formatShortDate,
  InlineFeedbackBox,
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
  boardTransition,
  groupNotesByShot,
  isCreatorNeedsWork,
  type PlacedWithState,
  type SortDir,
  sortTableItems,
  STATE_META,
  type TableSortKey,
} from "./note-views-model";
import {
  approveNote,
  editOldNote,
  goToNote,
  noteMedia,
  openNote,
  originOf,
  removeNote,
  reopenNote,
  reviewNote,
} from "./notes";
import type { NoteState, NoteStatusFilter } from "./slice";

function BoardCard({
  item,
  draggable,
  showStatus = false,
  replyId,
  setReplyId,
  onDragStartNote,
  onDragEndNote,
}: {
  item: PlacedWithState;
  draggable: boolean;
  showStatus?: boolean;
  replyId: string | null;
  setReplyId: (id: string | null) => void;
  onDragStartNote: (item: PlacedWithState) => void;
  onDragEndNote: () => void;
}) {
  const { n, t, state } = item;
  const shot = noteShotTitle(n.shot, n.shotName);
  const lit = useLit(`note:${n.id}`);
  const timeText = stamp(t);
  const asking = state === "check" && !!n.fixes?.at(-1)?.ask;
  const needsWork = isCreatorNeedsWork(n, state);
  return (
    <Card
      size="sm"
      tone={state}
      data-note={n.id}
      data-ai-lit={lit || undefined}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", n.id);
        onDragStartNote(item);
      }}
      onDragEnd={onDragEndNote}
    >
      <CardContent>
        <div className={cn("flex flex-col", draggable && "cursor-grab active:cursor-grabbing")}>
          <div className="flex flex-wrap items-center gap-1.5">
            <NoteNumber id={n.id} />
            {(showStatus || asking || needsWork) && (
              <StatusPill state={state} asking={asking} needsWork={needsWork} />
            )}
            <NoteTimeChip note={n} t={t} />
            <span className="text-label text-tag min-w-0 flex-1 truncate" title={shot.full}>
              <span className="text-foreground/90 font-medium">{shot.primary}</span>
              {shot.secondary && <span className="text-label/75"> · {shot.secondary}</span>}
            </span>
          </div>
          <div className="mt-2 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ExpandableNoteText
                text={n.text}
                clampLines={3}
                openLabel={`Open note at ${timeText}: ${n.text || "no words"}`}
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
            replying={replyId === n.id}
            onToggleReply={() => setReplyId(replyId === n.id ? null : n.id)}
            onDoneReply={() => setReplyId(null)}
            compact
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function NoteBoardView({
  items,
  statusFilter = "all",
}: {
  items: readonly PlacedWithState[];
  statusFilter?: NoteStatusFilter;
}) {
  const [groupBy, setGroupBy] = useState<"status" | "shot">("status");
  const [replyId, setReplyId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<PlacedWithState | null>(null);
  const [dropCol, setDropCol] = useState<NoteState | null>(null);

  const statusColumns = useMemo(() => {
    const byState: Record<NoteState, PlacedWithState[]> = { check: [], open: [], done: [] };
    for (const it of items) byState[it.state].push(it);
    const states =
      statusFilter === "all" ? (["check", "open", "done"] as const) : ([statusFilter] as const);
    return states.map((s) => ({
      id: s,
      label: STATE_META[s].label,
      tone: STATE_META[s].tone,
      items: byState[s],
    }));
  }, [items, statusFilter]);

  const shotColumns = useMemo(() => groupNotesByShot(items), [items]);

  const handleDropStatus = (target: NoteState) => {
    setDropCol(null);
    if (!dragging) return;
    const tx = boardTransition(dragging.state, target, !!dragging.n.fixes?.at(-1)?.ask);
    if (!tx) {
      say(
        dragging.state === "open"
          ? "To fix notes move to To check after the AI fixes them"
          : dragging.n.fixes?.at(-1)?.ask
            ? "Answer the AI's question before approving"
            : "This status move isn't available",
      );
      setDragging(null);
      return;
    }
    if (tx === "approve") approveNote(dragging.n);
    else if (tx === "reopen") reopenNote(dragging.n);
    else if (tx === "feedback") setReplyId(dragging.n.id);
    setDragging(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between gap-2 px-3 pb-2">
        <div className="inline-flex items-center gap-1.5">
          <Columns3 aria-hidden className="text-label size-3.5" />
          <ToggleGroup
            value={[groupBy]}
            onValueChange={(v: string[]) => {
              if (v[0] === "status" || v[0] === "shot") setGroupBy(v[0]);
            }}
            aria-label="Group board by"
            variant="segment"
            size="sm"
            spacing={0.5}
          >
            <ToggleGroupItem value="status" className="pointer-coarse:min-h-9">
              By status
            </ToggleGroupItem>
            <ToggleGroupItem value="shot" className="pointer-coarse:min-h-9">
              By shot
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <span className="text-tag text-label font-mono tabular-nums">
          {groupBy === "status"
            ? `${statusColumns.length} col${statusColumns.length === 1 ? "" : "s"}`
            : `${shotColumns.length} shot${shotColumns.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <TabStage
        activeKey={groupBy}
        order={["status", "shot"]}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="scroll-fade-x @container flex min-h-0 flex-1 snap-x snap-proximity items-stretch gap-2.5 overflow-x-auto overflow-y-hidden overscroll-contain px-3 pb-3">
          {groupBy === "status" ? (
            statusColumns.map((col) => {
              const validTarget =
                dragging &&
                boardTransition(dragging.state, col.id, !!dragging.n.fixes?.at(-1)?.ask) !== null;
              const singleCol = statusColumns.length === 1;
              return (
                <section
                  key={col.id}
                  aria-label={`${col.label} column`}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = validTarget ? "move" : "none";
                    if (dropCol !== col.id) setDropCol(col.id);
                  }}
                  onDragLeave={(e) => {
                    if (
                      !e.currentTarget.contains(e.relatedTarget as Node | null) &&
                      dropCol === col.id
                    ) {
                      setDropCol(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropStatus(col.id);
                  }}
                  className={cn(
                    "flex max-h-full shrink-0 snap-start flex-col rounded-xl border transition-colors duration-150",
                    singleCol
                      ? "w-full min-w-0"
                      : col.items.length === 0 && !dragging
                        ? "w-36 min-w-36"
                        : "w-[min(88cqw,310px)] min-w-56 @[580px]:w-[min(46cqw,285px)]",
                    col.id === "check"
                      ? "border-warn/40 bg-warn-bg/20"
                      : col.id === "done"
                        ? "border-ok/25 bg-background/40"
                        : "border-border/75 bg-background/60",
                    dropCol === col.id &&
                      (validTarget ? "border-primary bg-tint/40" : "border-destructive/60"),
                  )}
                >
                  <header className="border-border/50 flex flex-none items-center justify-between gap-2 border-b px-2.5 py-2">
                    <StatusPill state={col.id} />
                    <span className="text-label font-mono text-xs font-semibold tabular-nums">
                      {col.items.length}
                    </span>
                  </header>
                  {col.items.length === 0 ? (
                    <div className="min-h-0 flex-1 p-2">
                      <Empty>
                        {col.id === "check"
                          ? "AI fixes & questions land here"
                          : col.id === "open"
                            ? "Nothing waiting to fix"
                            : "Approved notes land here"}
                      </Empty>
                    </div>
                  ) : (
                    <VirtualList
                      items={col.items}
                      getKey={(it) => it.n.id}
                      estimateSize={132}
                      gap={8}
                      overscan={4}
                      ariaLabel={`${col.label} notes`}
                      className="min-h-0 flex-1 px-2 py-2"
                      renderItem={(item) => (
                        <BoardCard
                          item={item}
                          draggable
                          replyId={replyId}
                          setReplyId={setReplyId}
                          onDragStartNote={setDragging}
                          onDragEndNote={() => {
                            setDragging(null);
                            setDropCol(null);
                          }}
                        />
                      )}
                    />
                  )}
                  {col.id === "open" && (
                    <footer className="border-border/40 flex-none border-t p-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start"
                        onClick={(e) => openNote(null, true, originOf(e.currentTarget))}
                      >
                        <Plus aria-hidden data-icon="inline-start" />
                        Add note
                      </Button>
                    </footer>
                  )}
                </section>
              );
            })
          ) : shotColumns.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <Empty>No notes match the current filter</Empty>
            </div>
          ) : (
            shotColumns.map((col) => (
              <section
                key={col.shot}
                aria-label={`${col.title} column`}
                className="bg-background/60 border-border/75 flex max-h-full w-[min(88cqw,310px)] min-w-56 shrink-0 snap-start flex-col rounded-xl border @[580px]:w-[min(46cqw,285px)]"
              >
                <header className="border-border/50 flex flex-none items-center justify-between gap-2 border-b px-2.5 py-2">
                  <span
                    className="min-w-0 truncate text-xs font-semibold"
                    title={col.subtitle ?? col.title}
                  >
                    {col.title}
                    {col.subtitle && (
                      <span className="text-label/80 font-normal"> · {col.subtitle}</span>
                    )}
                  </span>
                  <span className="text-label shrink-0 font-mono text-xs tabular-nums">
                    {col.items.length}
                  </span>
                </header>
                <VirtualList
                  items={col.items}
                  getKey={(it) => it.n.id}
                  estimateSize={132}
                  gap={8}
                  overscan={4}
                  ariaLabel={`${col.title} notes`}
                  className="min-h-0 flex-1 px-2 py-2"
                  renderItem={(item) => (
                    <BoardCard
                      item={item}
                      draggable={false}
                      showStatus
                      replyId={replyId}
                      setReplyId={setReplyId}
                      onDragStartNote={setDragging}
                      onDragEndNote={() => {
                        setDragging(null);
                        setDropCol(null);
                      }}
                    />
                  )}
                />
              </section>
            ))
          )}
        </div>
      </TabStage>
    </div>
  );
}

function SortIcon({
  col,
  sortKey,
  sortDir,
}: {
  col: TableSortKey;
  sortKey: TableSortKey;
  sortDir: SortDir;
}) {
  if (sortKey !== col) return <ArrowUpDown aria-hidden className="size-3 opacity-45" />;
  return sortDir === "asc" ? (
    <ArrowUp aria-hidden className="text-primary size-3" />
  ) : (
    <ArrowDown aria-hidden className="text-primary size-3" />
  );
}

function NoteTableRow({
  item,
  index,
  measureRow,
  replying,
  onToggleReply,
  onDoneReply,
}: {
  item: PlacedWithState;
  index: number;
  measureRow: (el: Element | null) => void;
  replying: boolean;
  onToggleReply: () => void;
  onDoneReply: () => void;
}) {
  const { n, t, state } = item;
  const shot = noteShotTitle(n.shot, n.shotName);
  const fix = n.fixes?.at(-1);
  const asking = state === "check" && !!fix?.ask;
  const needsWork = isCreatorNeedsWork(n, state);
  const created = formatShortDate(n.at);
  const lit = useLit(`note:${n.id}`);

  return (
    <TableRow
      tone={state}
      data-index={index}
      data-note={n.id}
      data-ai-lit={lit || undefined}
      ref={measureRow}
    >
      <TableCell className="align-top">
        <div className="flex flex-col items-start gap-1">
          <NoteTimeChip note={n} t={t} />
          <NoteNumber id={n.id} className="@[520px]:hidden" />
        </div>
      </TableCell>
      <TableCell className="hidden align-top @[520px]:table-cell">
        <div className="flex items-center gap-1.5">
          <NoteNumber id={n.id} />
          <StatusPill state={state} asking={asking} needsWork={needsWork} />
        </div>
      </TableCell>
      <TableCell className="min-w-44 align-top">
        <div className="flex max-w-lg min-w-0 flex-col gap-1 whitespace-normal">
          <div className="flex flex-wrap items-center gap-1.5 @[520px]:hidden">
            <StatusPill state={state} asking={asking} needsWork={needsWork} />
            <span className="text-label text-tag truncate" title={shot.full}>
              {shot.primary}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ExpandableNoteText
                text={n.text}
                clampLines={3}
                openLabel={`Open note at ${stamp(t)}: ${n.text || "no words"}`}
                onOpen={(el) => openNoteRow(n, state, el)}
              />
            </div>
            <NoteThumb note={n} t={t} shotFull={shot.full} size="sm" muted={state === "done"} />
          </div>
          <NoteFollowups note={n} state={state} compact />
          <div className="@[760px]:hidden">
            <NoteTags note={n} />
          </div>
          {replying && <InlineFeedbackBox note={n} ask={!!fix?.ask} onDone={onDoneReply} />}
        </div>
      </TableCell>
      <TableCell className="hidden align-top @[600px]:table-cell">
        <span className="text-label block max-w-36 truncate" title={shot.full}>
          <span className="text-foreground/90 font-medium">{shot.primary}</span>
          {shot.secondary && ` · ${shot.secondary}`}
        </span>
      </TableCell>
      <TableCell className="hidden align-top @[680px]:table-cell">
        <span className="text-label font-mono tabular-nums">{created || "—"}</span>
      </TableCell>
      <TableCell className="hidden align-top @[760px]:table-cell">
        <NoteTags note={n} />
      </TableCell>
      <TableCell className="text-right align-top">
        <div className="inline-flex flex-col items-end justify-end gap-1.5 @[480px]:flex-row @[480px]:flex-wrap @[480px]:items-center">
          {state === "check" && !fix?.ask && (
            <Button
              variant="approve"
              size="sm"
              className="pointer-coarse:min-h-9"
              onClick={() => approveNote(n)}
            >
              <Check aria-hidden data-icon="inline-start" />
              Approve
            </Button>
          )}
          {state === "check" && (
            <Button
              variant={fix?.ask ? "approve" : "secondary"}
              size="sm"
              className="pointer-coarse:min-h-9"
              onClick={onToggleReply}
            >
              <MessageSquarePlus aria-hidden data-icon="inline-start" />
              {fix?.ask ? "Answer" : "Needs work"}
            </Button>
          )}
          {state === "done" && (
            <Button
              variant="outline"
              size="sm"
              className="pointer-coarse:min-h-9"
              onClick={() => reopenNote(n)}
            >
              <RotateCcw aria-hidden data-icon="inline-start" />
              Reopen
            </Button>
          )}
          {!PHONE && (
            <Button
              variant="outline"
              size="sm"
              className="pointer-coarse:min-h-9"
              onClick={() => reviewNote(n)}
            >
              <ClipboardCheck aria-hidden data-icon="inline-start" />
              Review
            </Button>
          )}
          {state === "open" && (
            <div className="inline-flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="icon-sm"
                className="pointer-coarse:size-9"
                aria-label={`Edit note at ${stamp(t)}`}
                onClick={(e) => editOldNote(n, originOf(e.currentTarget))}
              >
                <Pencil />
              </Button>
              <Button
                variant="remove"
                size="icon-sm"
                className="pointer-coarse:size-9"
                aria-label={`Delete note at ${stamp(t)}`}
                onClick={() => removeNote(n)}
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function NoteTableView({ items }: { items: readonly PlacedWithState[] }) {
  const [sortKey, setSortKey] = useState<TableSortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [replyId, setReplyId] = useState<string | null>(null);

  const sorted = useMemo(() => sortTableItems(items, sortKey, sortDir), [items, sortKey, sortDir]);
  const { scrollRef, virtualItems, spacers, measureRow } = useVirtualTable({
    items: sorted,
    getKey: (it) => it.n.id,
    estimateSize: 64,
    overscan: 8,
  });

  const toggleSort = (key: TableSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "created" ? "desc" : "asc");
    }
  };

  const ariaSort = (col: TableSortKey): "ascending" | "descending" | "none" =>
    sortKey !== col ? "none" : sortDir === "asc" ? "ascending" : "descending";

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-2">
      <Table
        containerRef={scrollRef}
        containerClassName="@container min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        <TableHeader sticky>
          <TableRow>
            <TableHead aria-sort={ariaSort("time")}>
              <button
                type="button"
                onClick={() => toggleSort("time")}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm py-0.5 font-medium outline-none focus-visible:ring-2"
              >
                Time
                <SortIcon col="time" sortKey={sortKey} sortDir={sortDir} />
              </button>
            </TableHead>
            <TableHead className="hidden @[520px]:table-cell" aria-sort={ariaSort("status")}>
              <button
                type="button"
                onClick={() => toggleSort("status")}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm py-0.5 font-medium outline-none focus-visible:ring-2"
              >
                Status
                <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
              </button>
            </TableHead>
            <TableHead aria-sort={ariaSort("text")}>
              <button
                type="button"
                onClick={() => toggleSort("text")}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm py-0.5 font-medium outline-none focus-visible:ring-2"
              >
                Note
                <SortIcon col="text" sortKey={sortKey} sortDir={sortDir} />
              </button>
            </TableHead>
            <TableHead className="hidden @[600px]:table-cell" aria-sort={ariaSort("shot")}>
              <button
                type="button"
                onClick={() => toggleSort("shot")}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm py-0.5 font-medium outline-none focus-visible:ring-2"
              >
                Shot
                <SortIcon col="shot" sortKey={sortKey} sortDir={sortDir} />
              </button>
            </TableHead>
            <TableHead className="hidden @[680px]:table-cell" aria-sort={ariaSort("created")}>
              <button
                type="button"
                onClick={() => toggleSort("created")}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm py-0.5 font-medium outline-none focus-visible:ring-2"
              >
                Created
                <SortIcon col="created" sortKey={sortKey} sortDir={sortDir} />
              </button>
            </TableHead>
            <TableHead className="hidden @[760px]:table-cell">Markers</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {spacers.top > 0 && (
            <tr aria-hidden>
              <td colSpan={7} aria-hidden className="p-0">
                <div
                  className="h-(--spacer)"
                  style={{ "--spacer": `${spacers.top}px` } as CSSProperties}
                />
              </td>
            </tr>
          )}
          {virtualItems.map((vi) => {
            const item = sorted[vi.index]!;
            return (
              <NoteTableRow
                key={item.n.id}
                item={item}
                index={vi.index}
                measureRow={measureRow}
                replying={replyId === item.n.id}
                onToggleReply={() => setReplyId(replyId === item.n.id ? null : item.n.id)}
                onDoneReply={() => setReplyId(null)}
              />
            );
          })}
          {spacers.bottom > 0 && (
            <tr aria-hidden>
              <td colSpan={7} aria-hidden className="p-0">
                <div
                  className="h-(--spacer)"
                  style={{ "--spacer": `${spacers.bottom}px` } as CSSProperties}
                />
              </td>
            </tr>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

type FlatListRow =
  | { kind: "head"; key: string; state: NoteState; count: number }
  | { kind: "item"; key: string; item: PlacedWithState; showCompactStatus: boolean };

function NoteListRow({
  item,
  showCompactStatus,
  replyId,
  setReplyId,
}: {
  item: PlacedWithState;
  showCompactStatus: boolean;
  replyId: string | null;
  setReplyId: (id: string | null) => void;
}) {
  const { n, t, state } = item;
  const lit = useLit(`note:${n.id}`);
  const shot = noteShotTitle(n.shot, n.shotName);
  const fix = n.fixes?.at(-1);
  const asking = state === "check" && !!fix?.ask;
  const needsWork = isCreatorNeedsWork(n, state);
  const created = formatShortDate(n.at);
  return (
    <div
      data-note={n.id}
      data-ai-lit={lit || undefined}
      className={noteSurfaceClass(state, { compact: true })}
    >
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">
        <NoteNumber id={n.id} />
        {(showCompactStatus || asking || needsWork) && (
          <StatusPill state={state} asking={asking} needsWork={needsWork} />
        )}
        <NoteTimeChip note={n} t={t} />
        <span className="text-label text-tag min-w-0 flex-1 truncate" title={shot.full}>
          <span className="text-foreground/90 font-medium">{shot.primary}</span>
          {shot.secondary && <span className="text-label/75"> · {shot.secondary}</span>}
        </span>
        {created && (
          <span className="text-label/75 text-tag shrink-0 font-mono tabular-nums">{created}</span>
        )}
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
      <NoteFollowups note={n} state={state} compact />
      <NoteCardActions
        note={n}
        t={t}
        state={state}
        replying={replyId === n.id}
        onToggleReply={() => setReplyId(replyId === n.id ? null : n.id)}
        onDoneReply={() => setReplyId(null)}
        compact
        showApprovedDate={state === "done"}
      />
    </div>
  );
}

export function NoteListView({ items }: { items: readonly PlacedWithState[] }) {
  const [grouped, setGrouped] = useState(true);
  const [replyId, setReplyId] = useState<string | null>(null);

  const flatRows = useMemo<FlatListRow[]>(() => {
    if (!grouped) {
      return items.map((item) => ({
        kind: "item",
        key: item.n.id,
        item,
        showCompactStatus: true,
      }));
    }
    const rows: FlatListRow[] = [];
    for (const s of ["check", "open", "done"] as const) {
      const bucket = items.filter((it) => it.state === s);
      if (!bucket.length) continue;
      rows.push({ kind: "head", key: `head:${s}`, state: s, count: bucket.length });
      for (const item of bucket) {
        rows.push({ kind: "item", key: item.n.id, item, showCompactStatus: false });
      }
    }
    return rows;
  }, [grouped, items]);

  return (
    <div className="@container flex min-h-0 flex-1 flex-col px-3 pb-2">
      <div className="mb-2 flex flex-none items-center justify-between gap-2">
        <ToggleGroup
          value={[grouped ? "status" : "flat"]}
          onValueChange={(v: string[]) => {
            if (v[0] === "status") setGrouped(true);
            else if (v[0] === "flat") setGrouped(false);
          }}
          aria-label="List grouping"
          variant="segment"
          size="sm"
          spacing={0.5}
        >
          <ToggleGroupItem value="status" className="pointer-coarse:min-h-9">
            By status
          </ToggleGroupItem>
          <ToggleGroupItem value="flat" className="pointer-coarse:min-h-9">
            Flat list
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-tag text-label font-mono tabular-nums">{items.length} shown</span>
      </div>

      <VirtualList
        items={flatRows}
        getKey={(r) => r.key}
        estimateSize={(i) => (flatRows[i]?.kind === "head" ? 30 : 108)}
        gap={6}
        overscan={8}
        role="list"
        ariaLabel="Notes list"
        className="scroll-fade min-h-0 flex-1 px-0.5"
        renderItem={(row) => {
          if (row.kind === "head") {
            return (
              <div className="flex items-center gap-2 px-0.5 pt-1.5 pb-0.5">
                <StatusPill state={row.state} />
                <span className="text-label text-tag font-mono tabular-nums">{row.count}</span>
              </div>
            );
          }
          return (
            <NoteListRow
              item={row.item}
              showCompactStatus={row.showCompactStatus}
              replyId={replyId}
              setReplyId={setReplyId}
            />
          );
        }}
      />
    </div>
  );
}

function GalleryCard({
  item,
  replyId,
  setReplyId,
}: {
  item: PlacedWithState;
  replyId: string | null;
  setReplyId: (id: string | null) => void;
}) {
  const { n, t, state } = item;
  const media = noteMedia(n);
  const cover = media.thumb ?? media.refs[0] ?? null;
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const showImage = !!cover && failedCover !== cover;
  const shot = noteShotTitle(n.shot, n.shotName);
  const lit = useLit(`note:${n.id}`);
  const created = formatShortDate(n.at);
  const asking = state === "check" && !!n.fixes?.at(-1)?.ask;
  const needsWork = isCreatorNeedsWork(n, state);

  return (
    <Card
      size="sm"
      tone={state}
      data-note={n.id}
      data-ai-lit={lit || undefined}
      className="flex h-full flex-col"
    >
      {cover && (
        <div
          data-slot="card-media"
          className="bg-backdrop border-border/80 relative aspect-video w-full overflow-hidden border-b"
        >
          <button
            type="button"
            aria-label={`${showImage ? "Inspect" : "Open"} note at ${stamp(t)}${n.text ? `: ${n.text}` : ""}`}
            onClick={(e) => openNoteRow(n, state, e.currentTarget)}
            className="focus-visible:ring-ring block size-full cursor-pointer text-left outline-none focus-visible:ring-2"
          >
            {showImage ? (
              <img
                src={cover}
                loading="lazy"
                decoding="async"
                alt={`Frame at ${stamp(t)}`}
                onError={() => setFailedCover(cover)}
                className={cn(
                  "block size-full object-cover transition-opacity duration-150",
                  state === "done" && "opacity-75 group-hover/card:opacity-100",
                )}
              />
            ) : (
              <span className="text-label flex size-full flex-col items-center justify-center gap-1 text-xs">
                <Camera aria-hidden className="size-4 opacity-60" />
                <span>{shot.primary}</span>
              </span>
            )}
          </button>
          {n.pin && media.crop && showImage && (
            <img
              src={media.crop}
              alt={`Pin: ${n.pin.what}`}
              className="border-primary/80 bg-backdrop pointer-events-none absolute bottom-1.5 left-1.5 size-10 rounded-md border object-cover shadow-md"
            />
          )}
          <Button
            variant="scrim"
            size="sm"
            aria-label={`Jump to ${stamp(t)}`}
            className="absolute top-1.5 left-1.5 pointer-coarse:min-h-9"
            onClick={() => goToNote(n)}
          >
            <span className="font-mono tabular-nums">{stamp(t)}</span>
          </Button>
        </div>
      )}
      <CardContent className="flex flex-1 flex-col">
        <div className="mb-1.5 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <NoteNumber id={n.id} />
            {!cover && <NoteTimeChip note={n} t={t} />}
            <StatusPill
              state={state}
              asking={asking}
              needsWork={needsWork}
              compact
              className="ms-auto shrink-0"
            />
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span
              className="text-label text-tag min-w-0 flex-1 truncate font-medium"
              title={shot.full}
            >
              <span className="text-foreground/90">{shot.primary}</span>
              {shot.secondary && ` · ${shot.secondary}`}
            </span>
            {created && (
              <span className="text-label/75 text-tag shrink-0 font-mono tabular-nums">
                {created}
              </span>
            )}
          </div>
        </div>
        <ExpandableNoteText
          text={n.text}
          clampLines={3}
          openLabel={`Open note at ${stamp(t)}: ${n.text || "no words"}`}
          onOpen={cover ? undefined : (el) => openNoteRow(n, state, el)}
        />
        <NoteTags note={n} />
        <NoteFollowups note={n} state={state} />
        <div className="mt-auto pt-1">
          <NoteCardActions
            note={n}
            t={t}
            state={state}
            replying={replyId === n.id}
            onToggleReply={() => setReplyId(replyId === n.id ? null : n.id)}
            onDoneReply={() => setReplyId(null)}
            compact
            showEdit
            showApprovedDate={state === "done"}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function NoteGalleryView({ items }: { items: readonly PlacedWithState[] }) {
  const [replyId, setReplyId] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(2);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const syncCols = (width: number) => {
      const next = width >= 580 ? 3 : width >= 390 ? 2 : 1;
      setCols((prev) => (prev === next ? prev : next));
    };
    syncCols(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      syncCols(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => chunkRows(items, cols), [items, cols]);
  const gridCls =
    cols === 3
      ? "grid grid-cols-3 gap-2.5"
      : cols === 2
        ? "grid grid-cols-2 gap-2.5"
        : "grid grid-cols-1 gap-2.5";

  return (
    <div ref={hostRef} className="flex min-h-0 flex-1 flex-col">
      <VirtualList
        items={rows}
        getKey={(row) => row.map((it) => it.n.id).join(":")}
        estimateSize={255}
        gap={10}
        overscan={4}
        ariaLabel="Gallery notes grid"
        className="scroll-fade min-h-0 flex-1 px-3 pb-3"
        renderItem={(row) => (
          <div className={gridCls}>
            {row.map((item) => (
              <GalleryCard key={item.n.id} item={item} replyId={replyId} setReplyId={setReplyId} />
            ))}
          </div>
        )}
      />
    </div>
  );
}
