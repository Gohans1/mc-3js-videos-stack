import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpDown,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  GripVertical,
  MessageCircleQuestion,
  MoreHorizontal,
  PanelRightOpen,
  Pencil,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { useLit } from "../activity/activity";
import { Tip } from "../components/Tip";
import { chunkRows, tableGapBetween } from "../components/virtual-utils";
import { useVirtualTable, VirtualList } from "../components/VirtualList";
import { PHONE } from "../core/device";
import { get, say, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { type AnimatedEntry, useExitedNotes, useNoteMotion } from "./note-action-motion";
import { noteActionTarget, noteShotTitle } from "./note-card-meta";
import {
  BeforeAfterPair,
  Empty,
  ExpandableNoteText,
  formatShortDate,
  hasSelectedText,
  InlineFeedbackBox,
  NoteCardActions,
  NoteCardStatus,
  NoteExitSlot,
  NoteFollowups,
  NoteNumber,
  NoteOpenButton,
  NoteStatusGlyph,
  noteStatusLabel,
  noteStatusTextClass,
  NoteTags,
  NoteThumb,
  NoteTimeChip,
  openNoteRow,
  useNoteFilterScopeKey,
} from "./note-parts";
import {
  boardTransition,
  getNoteInlineCue,
  groupNotesByShot,
  isCreatorNeedsWork,
  isNoteAsking,
  type NoteInlineCue,
  type PlacedWithState,
  type SortDir,
  sortTableItems,
  splitNoteHeadline,
  STATE_META,
  type TableSortKey,
} from "./note-views-model";
import {
  approveNote,
  clearNoteFilters,
  editOldNote,
  goToNote,
  noteMedia,
  noteNum,
  originOf,
  removeNote,
  reopenNote,
  reviewNote,
} from "./notes";
import type { NoteState, NoteStatusFilter } from "./slice";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const noteKey = (item: PlacedWithState) => item.n.id;
const rowKey = (row: { key: string }) => row.key;
const galleryRowKey = (row: AnimatedEntry<PlacedWithState>[]) => row.map(rowKey).join(":");

const cueTextClass = (kind: NoteInlineCue["kind"]) =>
  kind === "ask"
    ? "text-ai-text"
    : kind === "needs-work"
      ? "text-primary-text"
      : kind === "fixed"
        ? "text-warn-text"
        : "text-ok-text";

function CompactNoteBody({
  note,
  state,
  firstLine,
  extraLines,
  inlineCue,
  openLabel,
  className,
}: {
  note: PlacedWithState["n"];
  state: NoteState;
  firstLine: string;
  extraLines: number;
  inlineCue: NoteInlineCue | null;
  openLabel: string;
  className?: string;
}) {
  return (
    <>
      <div
        className={cn(
          "has-[>[data-note-open]:focus-visible]:ring-ring group/open flex w-fit min-w-0 items-start gap-1 rounded-sm has-[>[data-note-open]:focus-visible]:ring-2",
          className,
        )}
      >
        <p
          title={note.text || "Open note"}
          onClick={(e) => {
            if (!hasSelectedText()) openNoteRow(note, state, e.currentTarget);
          }}
          className={cn(
            "flex min-h-6 min-w-0 cursor-text items-center gap-1.5 rounded-sm text-start text-sm leading-normal wrap-anywhere transition-colors select-text motion-reduce:transition-none pointer-coarse:min-h-10",
            state === "done"
              ? "font-normal text-current"
              : "text-foreground/95 hover:text-foreground font-medium",
          )}
        >
          <span className="line-clamp-2 min-w-0 wrap-anywhere">
            {firstLine ? (
              firstLine
            ) : (
              <span className="text-muted-foreground font-normal italic">(no words)</span>
            )}
          </span>
          {firstLine && extraLines > 0 && (
            <Badge variant="tag-mono">
              +{extraLines} {extraLines === 1 ? "line" : "lines"}
            </Badge>
          )}
        </p>
        <NoteOpenButton
          label={openLabel}
          onClick={(el) => openNoteRow(note, state, el)}
          className="mt-0.5"
        />
      </div>
      {inlineCue && (
        <p
          className={cn(
            "text-ui max-w-[65ch] leading-normal text-pretty wrap-anywhere select-text",
            cueTextClass(inlineCue.kind),
          )}
          title={`${inlineCue.label}: ${inlineCue.text}`}
        >
          {inlineCue.label}: {inlineCue.text}
        </p>
      )}
    </>
  );
}

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
  const asking = isNoteAsking(n, state);
  const needsWork = isCreatorNeedsWork(n, state);
  const skipMoveFocusRef = useRef(false);
  const moveTargets = draggable
    ? ([
        boardTransition(state, "done", asking) === "approve" && {
          id: "done",
          label: "Move to Done (Approve)",
          run: () => approveNote(n),
          opensReply: false,
        },
        boardTransition(state, "open", asking) === "feedback" && {
          id: "open-feedback",
          label: `Move to To fix (${asking ? "Answer" : "Needs work"})`,
          run: () => setReplyId(n.id),
          opensReply: true,
        },
        boardTransition(state, "open", asking) === "reopen" && {
          id: "open-reopen",
          label: "Move to To fix (Reopen)",
          run: () => reopenNote(n),
          opensReply: false,
        },
      ].filter(Boolean) as Array<{
        id: string;
        label: string;
        run: () => void;
        opensReply: boolean;
      }>)
    : [];
  const nNum = noteNum(n.id);
  const { ref: cardRef, noteAttr } = useNoteMotion<HTMLDivElement>(n.id, state);
  return (
    <Card
      ref={cardRef}
      size="sm"
      tone={asking ? "ai" : state}
      data-note={noteAttr}
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
        <div className="flex flex-col">
          <div
            className={cn(
              "flex flex-wrap items-center gap-1.5",
              draggable && "cursor-grab active:cursor-grabbing",
            )}
          >
            {draggable && (
              <GripVertical
                aria-hidden
                className="text-muted-foreground/75 -ms-0.5 size-3.5 shrink-0"
              />
            )}
            <NoteNumber id={n.id} />
            {(showStatus || (needsWork && !n.asks?.length)) && (
              <NoteCardStatus state={state} asking={asking} needsWork={needsWork} />
            )}
            <NoteTimeChip note={n} t={t} />
            <span
              className={cn(
                "text-ui me-auto max-w-full truncate",
                state === "done" ? "text-muted-foreground" : "text-label",
              )}
              title={shot.full}
            >
              <span
                className={
                  state === "done" ? "text-muted-foreground font-medium" : "text-label font-medium"
                }
              >
                {shot.primary}
              </span>
              {shot.secondary && <span className="text-muted-foreground"> · {shot.secondary}</span>}
            </span>
            {moveTargets.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move note ${nNum ? `#${nNum}` : `at ${timeText}`} to column`}
                      title="Move card to another column"
                      onClick={(e) => e.stopPropagation()}
                    />
                  }
                >
                  <ArrowRightLeft aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  motion="none"
                  align="end"
                  finalFocus={(closedBy) => {
                    const skip = skipMoveFocusRef.current;
                    skipMoveFocusRef.current = false;
                    return closedBy === "keyboard" && !skip;
                  }}
                  font="md"
                  className="w-56"
                >
                  <DropdownMenuGroup>
                    {moveTargets.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          skipMoveFocusRef.current = m.opensReply;
                          m.run();
                        }}
                      >
                        {m.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="mt-1.5 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ExpandableNoteText
                text={n.text}
                clampLines={2}
                compact
                openLabel={`Open note ${noteActionTarget(nNum, timeText)}: ${n.text || "no words"}`}
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
            showEdit
            showApprovedDate={state === "done"}
          />
        </div>
      </CardContent>
    </Card>
  );
}

const BOARD_COL_CLS =
  "w-[84%] min-w-[min(14rem,100%)] @[480px]:w-72 @[860px]:w-auto @[860px]:min-w-[min(15rem,100%)] @[860px]:flex-1";

type BoardDropId = "check" | "asking" | "open" | "done";

function BoardColumnList({
  items,
  scopeKey,
  ariaLabel,
  emptyText,
  draggable,
  showStatus = false,
  replyId,
  setReplyId,
  onDragStartNote,
  onDragEndNote,
}: {
  items: readonly PlacedWithState[];
  scopeKey: string;
  ariaLabel: string;
  emptyText?: string;
  draggable: boolean;
  showStatus?: boolean;
  replyId: string | null;
  setReplyId: (id: string | null) => void;
  onDragStartNote: (item: PlacedWithState) => void;
  onDragEndNote: () => void;
}) {
  const animated = useExitedNotes(items, noteKey, scopeKey);
  if (animated.length === 0 && emptyText) {
    return (
      <div className="min-h-0 flex-1 p-2">
        <Empty>{emptyText}</Empty>
      </div>
    );
  }
  return (
    <VirtualList
      items={animated}
      getKey={rowKey}
      estimateSize={120}
      gap={8}
      overscan={4}
      data-arrow-scroll
      role="list"
      ariaLabel={ariaLabel}
      className="min-h-0 flex-1 p-2"
      renderItem={(entry) => {
        const card = (
          <BoardCard
            item={entry.item}
            draggable={draggable && !entry.exiting}
            showStatus={showStatus}
            replyId={replyId}
            setReplyId={setReplyId}
            onDragStartNote={onDragStartNote}
            onDragEndNote={onDragEndNote}
          />
        );
        return entry.exiting ? (
          <NoteExitSlot id={entry.id} kind={entry.kind}>
            {card}
          </NoteExitSlot>
        ) : (
          card
        );
      }}
    />
  );
}

type BoardDragState =
  | { kind: "idle" }
  | { kind: "dragging"; item: PlacedWithState; over: BoardDropId | null };

export function NoteBoardView({
  items,
  statusFilter = "all",
}: {
  items: readonly PlacedWithState[];
  statusFilter?: NoteStatusFilter;
}) {
  const [groupBy, setGroupBy] = useState<"status" | "shot">("status");
  const [replyId, setReplyId] = useState<string | null>(null);
  const [boardDrag, setBoardDrag] = useState<BoardDragState>({ kind: "idle" });
  const dragging = boardDrag.kind === "dragging" ? boardDrag.item : null;
  const dropCol = boardDrag.kind === "dragging" ? boardDrag.over : null;
  const colRefs = useRef<Record<string, HTMLElement | null>>({});

  const statusColumns = useMemo(() => {
    const checkItems: PlacedWithState[] = [];
    const askingItems: PlacedWithState[] = [];
    const openItems: PlacedWithState[] = [];
    const doneItems: PlacedWithState[] = [];
    for (const it of items) {
      if (isNoteAsking(it.n, it.state)) askingItems.push(it);
      else if (it.state === "check") checkItems.push(it);
      else if (it.state === "open") openItems.push(it);
      else doneItems.push(it);
    }
    const defs = [
      {
        id: "check" as const,
        state: "check" as NoteState,
        asking: false,
        label: STATE_META.check.label,
        items: checkItems,
      },
      {
        id: "asking" as const,
        state: "check" as NoteState,
        asking: true,
        label: "AI asks",
        items: askingItems,
      },
      {
        id: "open" as const,
        state: "open" as NoteState,
        asking: false,
        label: STATE_META.open.label,
        items: openItems,
      },
      {
        id: "done" as const,
        state: "done" as NoteState,
        asking: false,
        label: STATE_META.done.label,
        items: doneItems,
      },
    ];
    if (statusFilter === "all") {
      return defs.filter((c) => c.id !== "asking" || c.items.length > 0);
    }
    return defs.filter((c) => c.id === statusFilter);
  }, [items, statusFilter]);

  const noteSort = useStudio((s) => s.noteSort);
  const shotColumns = useMemo(
    () => groupNotesByShot(items, noteSort !== "film"),
    [items, noteSort],
  );
  const activeCols =
    groupBy === "status"
      ? statusColumns.map((c) => ({
          key: c.id,
          label: c.label,
          count: c.items.length,
          state: c.state as NoteState | null,
          asking: c.asking,
        }))
      : shotColumns.map((c) => ({
          key: String(c.shot),
          label: c.title,
          count: c.items.length,
          state: null as NoteState | null,
          asking: false,
        }));

  const boardScrollRef = useRef<HTMLDivElement>(null);
  const lastJumpAt = useRef(0);
  const [colIdx, setColIdx] = useState(0);
  const clampedColIdx = Math.min(colIdx, Math.max(0, activeCols.length - 1));

  const syncColFromScroll = () => {
    if (performance.now() - lastJumpAt.current < 400) return;
    const scroller = boardScrollRef.current;
    if (!scroller || activeCols.length <= 1) return;
    const baseLeft = scroller.getBoundingClientRect().left;
    let best = 0;
    let bestDist = Infinity;
    activeCols.forEach((c, idx) => {
      const node = colRefs.current[c.key];
      if (!node) return;
      const dist = Math.abs(node.getBoundingClientRect().left - baseLeft - 12);
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    });
    setColIdx((prev) => (prev === best ? prev : best));
  };

  const jumpToColumn = (key: string) => {
    lastJumpAt.current = performance.now();
    const idx = activeCols.findIndex((c) => c.key === key);
    if (idx >= 0) setColIdx(idx);
    colRefs.current[key]?.scrollIntoView({
      inline: "start",
      block: "nearest",
    });
  };

  const stepColumn = (delta: -1 | 1) => {
    if (activeCols.length <= 1) return;
    const next = Math.max(0, Math.min(activeCols.length - 1, clampedColIdx + delta));
    const target = activeCols[next];
    if (target) jumpToColumn(target.key);
  };

  const handleDropStatus = (target: NoteState) => {
    if (boardDrag.kind !== "dragging") return;
    const item = boardDrag.item;
    setBoardDrag({ kind: "idle" });
    const tx = boardTransition(item.state, target, !!item.n.fixes?.at(-1)?.ask);
    if (!tx) {
      say(
        item.state === "open"
          ? "To fix notes move to To check after the AI fixes them"
          : item.n.fixes?.at(-1)?.ask
            ? "Answer the AI’s question before approving"
            : "This status move isn’t available",
      );
      return;
    }
    if (tx === "approve") approveNote(item.n);
    else if (tx === "reopen") reopenNote(item.n);
    else if (tx === "feedback") setReplyId(item.n.id);
  };

  return (
    <div className="@container/board flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center justify-between gap-2 px-3 pb-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Columns3 aria-hidden className="text-label hidden size-3.5 shrink-0 @sm/board:block" />
          <NoteViewChoice
            value={groupBy}
            onChange={setGroupBy}
            label="Group board by"
            options={[
              { value: "status", label: "Status" },
              { value: "shot", label: "Shot" },
            ]}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-label hidden font-mono text-xs tabular-nums @sm/board:inline">
            {groupBy === "status"
              ? `${statusColumns.length} col${statusColumns.length === 1 ? "" : "s"}`
              : `${shotColumns.length} shot${shotColumns.length === 1 ? "" : "s"}`}
          </span>
          {activeCols.length > 1 && (
            <div className="bg-backdrop/80 border-hairline flex items-center gap-0.5 rounded-md border p-0.5 @[860px]:hidden">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Previous column"
                disabled={clampedColIdx <= 0}
                onClick={() => stepColumn(-1)}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <span className="text-label hidden px-1 font-mono text-xs tabular-nums @sm/board:inline">
                {clampedColIdx + 1}/{activeCols.length}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Next column"
                disabled={clampedColIdx >= activeCols.length - 1}
                onClick={() => stepColumn(1)}
              >
                <ChevronRight aria-hidden />
              </Button>
            </div>
          )}
        </div>
      </div>

      {groupBy === "shot" && activeCols.length > 1 && (
        <div className="scroll-fade-x flex flex-none items-center gap-1 overflow-x-auto overscroll-x-contain px-3 pb-2">
          {activeCols.map((c) => (
            <Button
              key={c.key}
              variant="subtle"
              size="xs"
              className="shrink-0"
              onClick={() => jumpToColumn(c.key)}
            >
              <span className="max-w-28 truncate">{c.label}</span>
              <span className="text-label font-mono tabular-nums">{c.count}</span>
            </Button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={boardScrollRef}
          onScroll={syncColFromScroll}
          onWheel={() => {
            lastJumpAt.current = 0;
          }}
          onPointerDown={() => {
            lastJumpAt.current = 0;
          }}
          className="scroll-fade-x scroll-fade-e-14 @container flex min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-2.5 overflow-x-auto overflow-y-hidden overscroll-contain px-3 pb-3 @[560px]:snap-proximity"
        >
          {groupBy === "status" ? (
            statusColumns.map((col) => {
              const validTarget =
                dragging &&
                boardTransition(dragging.state, col.state, !!dragging.n.fixes?.at(-1)?.ask) !==
                  null;
              const singleCol = statusColumns.length === 1;
              return (
                <section
                  key={col.id}
                  ref={(el) => {
                    colRefs.current[col.id] = el;
                  }}
                  aria-label={`${col.label} column`}
                  onDragOver={(e) => {
                    if (boardDrag.kind !== "dragging") return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = validTarget ? "move" : "none";
                    if (boardDrag.over !== col.id) {
                      setBoardDrag({ kind: "dragging", item: boardDrag.item, over: col.id });
                    }
                  }}
                  onDragLeave={(e) => {
                    if (
                      !e.currentTarget.contains(e.relatedTarget as Node | null) &&
                      boardDrag.kind === "dragging" &&
                      boardDrag.over === col.id
                    ) {
                      setBoardDrag({ kind: "dragging", item: boardDrag.item, over: null });
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropStatus(col.state);
                  }}
                  className={cn(
                    "bg-backdrop/55 border-hairline flex max-h-full shrink-0 snap-start flex-col overflow-hidden rounded-lg border transition-colors duration-150 motion-reduce:transition-none",
                    singleCol ? "w-full min-w-0" : BOARD_COL_CLS,
                    dropCol === col.id &&
                      (validTarget ? "border-primary/65 bg-tint/35" : "border-destructive/60"),
                  )}
                >
                  <header className="border-hairline-subtle bg-surface-subtle flex h-9 flex-none items-center justify-between gap-2 border-b px-2.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <NoteStatusGlyph state={col.state} asking={col.asking} />
                      <h3 className="text-foreground truncate text-base leading-tight font-semibold text-balance">
                        {col.label}
                      </h3>
                      <span className="text-muted-foreground text-ui font-mono font-medium tabular-nums">
                        {col.items.length}
                      </span>
                    </div>
                  </header>
                  <BoardColumnList
                    items={col.items}
                    scopeKey={`board|${statusFilter}|${col.id}`}
                    ariaLabel={`${col.label} notes`}
                    emptyText={
                      col.id === "asking"
                        ? "AI questions appear here"
                        : col.id === "check"
                          ? "AI fixes waiting review land here"
                          : col.id === "open"
                            ? "Nothing waiting to fix"
                            : "Approved notes land here"
                    }
                    draggable
                    replyId={replyId}
                    setReplyId={setReplyId}
                    onDragStartNote={(item) => setBoardDrag({ kind: "dragging", item, over: null })}
                    onDragEndNote={() => setBoardDrag({ kind: "idle" })}
                  />
                </section>
              );
            })
          ) : shotColumns.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <Empty>
                No notes match the current filter.{" "}
                <Button variant="link" size="inline" onClick={clearNoteFilters}>
                  Reset filters
                </Button>
              </Empty>
            </div>
          ) : (
            shotColumns.map((col) => (
              <section
                key={col.shot}
                ref={(el) => {
                  colRefs.current[String(col.shot)] = el;
                }}
                aria-label={`${col.title} column`}
                className={cn(
                  "bg-backdrop/55 border-hairline flex max-h-full shrink-0 snap-start flex-col overflow-hidden rounded-lg border",
                  shotColumns.length === 1 ? "w-full min-w-0" : BOARD_COL_CLS,
                )}
              >
                <header className="border-hairline-subtle bg-surface-subtle flex h-9 flex-none items-center justify-between gap-2 border-b px-2.5">
                  <h3
                    className="text-foreground min-w-0 truncate text-base leading-tight font-semibold text-balance"
                    title={col.subtitle ?? col.title}
                  >
                    {col.title}
                    {col.subtitle && (
                      <span className="text-muted-foreground font-normal"> · {col.subtitle}</span>
                    )}
                  </h3>
                  <span className="text-muted-foreground text-ui shrink-0 font-mono font-medium tabular-nums">
                    {col.items.length}
                  </span>
                </header>
                <BoardColumnList
                  items={col.items}
                  scopeKey={`board-shot|${statusFilter}|${col.shot}`}
                  ariaLabel={`${col.title} notes`}
                  draggable={false}
                  showStatus
                  replyId={replyId}
                  setReplyId={setReplyId}
                  onDragStartNote={(item) => setBoardDrag({ kind: "dragging", item, over: null })}
                  onDragEndNote={() => setBoardDrag({ kind: "idle" })}
                />
              </section>
            ))
          )}
        </div>
        {activeCols.length > 1 && (
          <div className="flex flex-none items-center justify-center gap-0.5 pt-0.5 pb-1.5 @[860px]:hidden">
            {activeCols.map((c, idx) => (
              <button
                key={c.key}
                type="button"
                aria-label={`Column ${idx + 1} of ${activeCols.length}: ${c.label}`}
                aria-current={idx === clampedColIdx ? "step" : undefined}
                onClick={() => jumpToColumn(c.key)}
                className="focus-visible:ring-ring inline-flex min-h-6 min-w-6 cursor-pointer items-center justify-center rounded-full px-1 outline-none focus-visible:ring-2 pointer-coarse:min-h-10 pointer-coarse:min-w-10"
              >
                <span
                  aria-hidden
                  className={cn(
                    "block h-1.5 rounded-full transition-colors duration-150 motion-reduce:transition-none",
                    idx === clampedColIdx
                      ? "bg-primary w-4"
                      : "bg-hairline-strong hover:bg-muted-foreground w-1.5",
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>
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
    <ArrowUp aria-hidden className="text-primary-text size-3" />
  ) : (
    <ArrowDown aria-hidden className="text-primary-text size-3" />
  );
}

function TableSortHead({
  col,
  label,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  col: TableSortKey;
  label: string;
  sortKey: TableSortKey;
  sortDir: SortDir;
  onSort: (col: TableSortKey) => void;
  className?: string;
}) {
  const ariaSort: "ascending" | "descending" | "none" =
    sortKey !== col ? "none" : sortDir === "asc" ? "ascending" : "descending";
  return (
    <TableHead className={className} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-6 w-full items-center gap-1 rounded-sm py-1 font-medium transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-10"
      >
        {label}
        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
      </button>
    </TableHead>
  );
}

function onTableRowKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
  const target = e.target as HTMLElement | null;
  if (!target || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  if (
    target.closest("[role=menu],[role=listbox]") ||
    target.getAttribute("aria-expanded") === "true"
  )
    return;
  const row = target.closest<HTMLTableRowElement>("tr[data-note]");
  if (!row) return;
  e.stopPropagation();
  const rows = [...e.currentTarget.querySelectorAll<HTMLTableRowElement>("tr[data-note]")];
  const nextIdx =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? rows.length - 1
        : rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1);
  const next = rows[nextIdx];
  if (!next || next === row) return;
  const focusable = next.querySelector<HTMLElement>("button:not([disabled]), a[href]");
  if (!focusable) return;
  e.preventDefault();
  focusable.scrollIntoView({ block: "nearest" });
  focusable.focus({ preventScroll: true });
}

function TableSpacerRow({ height }: { height: number }) {
  return (
    <tr aria-hidden>
      <td aria-hidden className="p-0" />
      <td aria-hidden className="hidden p-0 @[520px]:table-cell" />
      <td aria-hidden className="p-0">
        <div className="h-(--spacer)" style={{ "--spacer": `${height}px` } as CSSProperties} />
      </td>
      <td aria-hidden className="hidden p-0 @[600px]:table-cell" />
      <td aria-hidden className="hidden p-0 @[680px]:table-cell" />
      <td aria-hidden className="hidden p-0 @[760px]:table-cell" />
      <td aria-hidden className="p-0" />
    </tr>
  );
}

function NoteTableRow({
  item,
  index,
  measureRow,
  focusProps,
  replying,
  onToggleReply,
  onDoneReply,
}: {
  item: PlacedWithState;
  index: number;
  measureRow: (el: Element | null) => void;
  focusProps: ReturnType<typeof useVirtualTable<PlacedWithState>>["rowFocusProps"] extends (
    k: string | number,
  ) => infer R
    ? R
    : never;
  replying: boolean;
  onToggleReply: () => void;
  onDoneReply: () => void;
}) {
  const { n, t, state } = item;
  const shot = noteShotTitle(n.shot, n.shotName);
  const fix = n.fixes?.at(-1);
  const asking = isNoteAsking(n, state);
  const inlineCue = getNoteInlineCue(n, state);
  const needsWork = inlineCue?.kind === "needs-work";
  const created = formatShortDate(n.at);
  const lit = useLit(`note:${n.id}`);
  const { firstLine, extraLines } = splitNoteHeadline(n.text);

  const statusText = noteStatusLabel(state, asking, needsWork);
  const statusToneClass = noteStatusTextClass(state, asking, needsWork);
  const target = noteActionTarget(noteNum(n.id), stamp(t));
  const { ref: rowMotionRef, noteAttr } = useNoteMotion<HTMLTableRowElement>(n.id, state);

  return (
    <TableRow
      tone={asking ? "ai" : state}
      data-index={index}
      data-note={noteAttr}
      data-ai-lit={lit || undefined}
      ref={(el) => {
        rowMotionRef.current = el;
        measureRow(el);
      }}
      {...focusProps}
    >
      <TableCell className="align-middle whitespace-nowrap">
        <NoteTimeChip note={n} t={t} />
      </TableCell>
      <TableCell className="hidden align-middle whitespace-nowrap @[520px]:table-cell">
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <NoteNumber id={n.id} />
          <NoteStatusGlyph state={state} asking={asking} needsWork={needsWork} />
          <span className={cn("text-xs font-medium whitespace-nowrap", statusToneClass)}>
            {statusText}
          </span>
        </div>
      </TableCell>
      <TableCell className="w-full max-w-0 min-w-0 align-middle whitespace-normal">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5 @[520px]:hidden">
            <NoteNumber id={n.id} />
            <NoteStatusGlyph state={state} asking={asking} needsWork={needsWork} />
            <span className={cn("shrink-0 text-xs font-medium whitespace-nowrap", statusToneClass)}>
              {statusText}
            </span>
            <span className="text-muted-foreground min-w-0 truncate text-xs" title={shot.full}>
              · {shot.primary}
            </span>
          </div>
          <CompactNoteBody
            note={n}
            state={state}
            firstLine={firstLine}
            extraLines={extraLines}
            inlineCue={inlineCue}
            openLabel={`Open note ${target}: ${n.text || "no words"}`}
            className="max-w-full"
          />
          <NoteTags note={n} className="mt-1 @[760px]:hidden" />
          {replying && <InlineFeedbackBox note={n} ask={!!fix?.ask} onDone={onDoneReply} />}
        </div>
      </TableCell>
      <TableCell className="hidden align-middle whitespace-nowrap @[600px]:table-cell">
        <span className="text-label text-ui block max-w-36 truncate" title={shot.full}>
          <span className={state === "done" ? "font-medium" : "text-foreground/90 font-medium"}>
            {shot.primary}
          </span>
          {shot.secondary && ` · ${shot.secondary}`}
        </span>
      </TableCell>
      <TableCell className="hidden align-middle whitespace-nowrap @[680px]:table-cell">
        <span className="text-label text-ui font-mono whitespace-nowrap tabular-nums">
          {created || "—"}
        </span>
      </TableCell>
      <TableCell className="hidden align-middle whitespace-nowrap @[760px]:table-cell">
        <NoteTags note={n} />
      </TableCell>
      <TableCell className="text-end align-middle whitespace-nowrap">
        <div className="inline-flex items-center justify-end gap-0.5 pe-1">
          {state === "check" && !fix?.ask && (
            <>
              <span className="@[520px]:hidden">
                <Tip label="Approve fix">
                  <Button
                    variant="approve"
                    size="icon-sm"
                    aria-label={`Approve note ${target}`}
                    onClick={() => approveNote(n)}
                  >
                    <Check aria-hidden />
                  </Button>
                </Tip>
              </span>
              <span className="hidden @[520px]:inline-flex">
                <Button
                  variant="approve"
                  size="sm"
                  aria-label={`Approve note ${target}`}
                  onClick={() => approveNote(n)}
                >
                  <Check aria-hidden data-icon="inline-start" />
                  Approve
                </Button>
              </span>
              <Tip label="Needs work — send back to AI">
                <Button
                  variant={replying ? "lit" : "subtle"}
                  size="icon-sm"
                  aria-label={`Needs work ${target}`}
                  aria-expanded={replying}
                  onClick={onToggleReply}
                >
                  <Undo2 aria-hidden />
                </Button>
              </Tip>
            </>
          )}
          {state === "check" && fix?.ask && (
            <>
              <span className="@[520px]:hidden">
                <Tip label="Answer AI question">
                  <Button
                    variant={replying ? "lit" : "ai"}
                    size="icon-sm"
                    aria-label={`Answer AI question ${target}`}
                    aria-expanded={replying}
                    onClick={onToggleReply}
                  >
                    <MessageCircleQuestion aria-hidden />
                  </Button>
                </Tip>
              </span>
              <span className="hidden @[520px]:inline-flex">
                <Tip label="Answer AI question">
                  <Button
                    variant={replying ? "lit" : "ai"}
                    size="sm"
                    aria-label={`Answer AI question ${target}`}
                    aria-expanded={replying}
                    onClick={onToggleReply}
                  >
                    <MessageCircleQuestion aria-hidden data-icon="inline-start" />
                    Answer
                  </Button>
                </Tip>
              </span>
            </>
          )}
          {state === "done" && (
            <Tip label="Reopen note">
              <Button
                variant="subtle"
                size="icon-sm"
                aria-label={`Reopen note ${target}`}
                onClick={() => reopenNote(n)}
              >
                <RotateCcw aria-hidden />
              </Button>
            </Tip>
          )}
          {state === "open" && (
            <Tip label="Edit note">
              <Button
                variant="subtle"
                size="icon-sm"
                aria-label={`Edit note ${target}`}
                onClick={(e) => editOldNote(n, originOf(e.currentTarget))}
              >
                <Pencil aria-hidden />
              </Button>
            </Tip>
          )}
          {!PHONE && (
            <span className="hidden @[520px]:inline-flex">
              <Tip label="Review in big view">
                <Button
                  variant="subtle"
                  size="icon-sm"
                  aria-label={`Review note ${target}`}
                  onClick={(e) => reviewNote(n, e.currentTarget)}
                >
                  <PanelRightOpen aria-hidden />
                </Button>
              </Tip>
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More actions for note ${noteNum(n.id) ? `#${noteNum(n.id)}` : `at ${stamp(t)}`}`}
                  title="More actions"
                />
              }
            >
              <MoreHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              motion="none"
              align="end"
              finalFocus={(closedBy) => closedBy === "keyboard" && !get().compose}
              font="md"
              className="w-44"
            >
              <DropdownMenuGroup>
                {!PHONE && (
                  <DropdownMenuItem
                    className="@[520px]:hidden"
                    onClick={(e) => reviewNote(n, e.currentTarget)}
                  >
                    <PanelRightOpen aria-hidden />
                    Review in big view
                  </DropdownMenuItem>
                )}
                {state !== "open" && (
                  <DropdownMenuItem onClick={(e) => editOldNote(n, originOf(e.currentTarget))}>
                    <Pencil aria-hidden />
                    Edit note
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => goToNote(n)}>
                  <Camera aria-hidden />
                  Jump to {stamp(t)}
                </DropdownMenuItem>
                {state === "open" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => removeNote(n)}>
                      <Trash2 aria-hidden />
                      Delete note
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
  const { scrollRef, virtualItems, spacers, measureRow, rowFocusProps } = useVirtualTable({
    items: sorted,
    getKey: noteKey,
    estimateSize: 52,
    overscan: 8,
  });

  const toggleSort = (key: TableSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "created" ? "desc" : "asc");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-2.5">
      <div className="border-hairline-subtle bg-surface-subtle/50 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
        <Table
          className="min-w-80"
          data-arrow-scroll
          containerRef={scrollRef}
          containerClassName="@container min-h-0 flex-1 overflow-auto overscroll-contain"
        >
          <TableHeader sticky>
            <TableRow>
              <TableSortHead
                col="time"
                label="Time"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <TableSortHead
                col="status"
                label="Status"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                className="hidden @[520px]:table-cell"
              />
              <TableSortHead
                col="text"
                label="Note"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <TableSortHead
                col="shot"
                label="Shot"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                className="hidden @[600px]:table-cell"
              />
              <TableSortHead
                col="created"
                label="Created"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                className="hidden @[680px]:table-cell"
              />
              <TableHead className="hidden @[760px]:table-cell">Markers</TableHead>
              <TableHead className="text-end">
                <span className="pe-1">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody onKeyDown={onTableRowKeyDown}>
            {spacers.top > 0 && <TableSpacerRow height={spacers.top} />}
            {virtualItems.map((vi, idx) => {
              const item = sorted[vi.index]!;
              const gap = tableGapBetween(virtualItems[idx - 1], vi);
              return (
                <Fragment key={item.n.id}>
                  {gap > 0 && <TableSpacerRow height={gap} />}
                  <NoteTableRow
                    item={item}
                    index={vi.index}
                    measureRow={measureRow}
                    focusProps={rowFocusProps(item.n.id)}
                    replying={replyId === item.n.id}
                    onToggleReply={() => setReplyId(replyId === item.n.id ? null : item.n.id)}
                    onDoneReply={() => setReplyId(null)}
                  />
                </Fragment>
              );
            })}
            {spacers.bottom > 0 && <TableSpacerRow height={spacers.bottom} />}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type FlatListRow =
  | { kind: "head"; key: string; state: NoteState; asking?: boolean; count: number }
  | { kind: "item"; key: string; item: PlacedWithState };

function NoteListRow({
  item,
  grouped,
  replyId,
  setReplyId,
}: {
  item: PlacedWithState;
  grouped: boolean;
  replyId: string | null;
  setReplyId: (id: string | null) => void;
}) {
  const { n, t, state } = item;
  const lit = useLit(`note:${n.id}`);
  const shot = noteShotTitle(n.shot, n.shotName);
  const fix = n.fixes?.at(-1);
  const asking = isNoteAsking(n, state);
  const needsWork = isCreatorNeedsWork(n, state);
  const inlineCue = getNoteInlineCue(n, state);
  const replying = replyId === n.id;
  const { firstLine, extraLines } = splitNoteHeadline(n.text);
  const statusText = noteStatusLabel(state, asking, needsWork);
  const target = noteActionTarget(noteNum(n.id), stamp(t));
  const { ref: rowRef, noteAttr } = useNoteMotion<HTMLDivElement>(n.id, state);

  return (
    <div
      ref={rowRef}
      data-note={noteAttr}
      data-tone={asking ? "ai" : state}
      data-ai-lit={lit || undefined}
      className={cn(
        "group/row border-b-hairline-subtle hover:bg-surface-subtle @container/row relative border-b px-2.5 py-1.5 transition-colors duration-150 before:pointer-events-none before:absolute before:inset-y-0 before:start-0 before:w-0.5 motion-reduce:transition-none",
        asking
          ? "before:bg-ai/85"
          : state === "check"
            ? "before:bg-warn/80"
            : state === "open"
              ? "before:bg-primary/65"
              : "text-foreground/78 before:bg-ok/40 hover:bg-surface-subtle",
      )}
    >
      <div className="relative flex min-h-7.5 flex-wrap items-start gap-x-2 gap-y-1 @min-[28rem]/row:flex-nowrap">
        <span className="flex h-6 shrink-0 items-center">
          <NoteStatusGlyph state={state} asking={asking} needsWork={needsWork} />
        </span>
        <div className="flex min-h-6 min-w-8 shrink-0 items-center">
          <NoteNumber id={n.id} />
        </div>
        <div className="flex w-full min-w-0 flex-none flex-col gap-0.5 @min-[28rem]/row:w-auto @min-[28rem]/row:flex-1 @min-[28rem]/row:py-0.5">
          <CompactNoteBody
            note={n}
            state={state}
            firstLine={firstLine}
            extraLines={extraLines}
            inlineCue={inlineCue}
            openLabel={`Open note ${target} (${statusText}): ${n.text || "no words"}`}
            className="max-w-[min(65ch,100%)]"
          />
          <NoteTags note={n} className="mt-1" />
        </div>
        <div className="flex min-h-6 w-full shrink-0 flex-wrap items-center gap-1.5 @min-[28rem]/row:h-auto @min-[28rem]/row:min-h-6 @min-[28rem]/row:w-auto">
          {(!grouped || (needsWork && !inlineCue)) && (
            <Badge
              variant={
                asking
                  ? "ai"
                  : needsWork || state === "open"
                    ? "open"
                    : state === "check"
                      ? "check"
                      : "done"
              }
            >
              {statusText}
            </Badge>
          )}
          <span
            className="text-muted-foreground text-ui min-w-0 flex-1 truncate @[440px]/row:max-w-24 @[440px]/row:flex-none"
            title={shot.full}
          >
            {shot.primary}
          </span>
          <div className="border-hairline-subtle bg-surface-subtle group-focus-within/row:border-hairline group-focus-within/row:bg-hairline-subtle group-hover/row:border-hairline group-hover/row:bg-hairline-subtle flex shrink-0 items-center gap-0.5 rounded-md border px-0.5 py-0.5 opacity-85 transition-colors duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100">
            {state === "check" && !fix?.ask && (
              <Tip label="Approve fix">
                <Button
                  variant="approve"
                  size="icon-sm"
                  aria-label={`Approve note ${target}`}
                  onClick={() => approveNote(n)}
                >
                  <Check aria-hidden />
                </Button>
              </Tip>
            )}
            {state === "check" && (
              <Tip label={asking ? "Answer AI question" : "Needs work — send back to AI"}>
                <Button
                  variant={replying ? "lit" : asking ? "ai" : "subtle"}
                  size="icon-sm"
                  aria-label={asking ? `Answer AI question ${target}` : `Needs work ${target}`}
                  aria-expanded={replying}
                  onClick={() => setReplyId(replying ? null : n.id)}
                >
                  {asking ? <MessageCircleQuestion aria-hidden /> : <Undo2 aria-hidden />}
                </Button>
              </Tip>
            )}
            {state === "done" && (
              <Tip label="Reopen note">
                <Button
                  variant="subtle"
                  size="icon-sm"
                  aria-label={`Reopen note ${target}`}
                  onClick={() => reopenNote(n)}
                >
                  <RotateCcw aria-hidden />
                </Button>
              </Tip>
            )}
            <Tip label="Edit note">
              <Button
                variant="subtle"
                size="icon-sm"
                aria-label={`Edit note ${target}`}
                onClick={(e) => editOldNote(n, originOf(e.currentTarget))}
              >
                <Pencil aria-hidden />
              </Button>
            </Tip>
            {!PHONE && (
              <Tip label="Review in big view">
                <Button
                  variant="subtle"
                  size="icon-sm"
                  aria-label={`Review note ${target}`}
                  onClick={(e) => reviewNote(n, e.currentTarget)}
                >
                  <PanelRightOpen aria-hidden />
                </Button>
              </Tip>
            )}
            {state === "open" && (
              <Tip label="Delete note">
                <Button
                  variant="remove"
                  size="icon-sm"
                  aria-label={`Delete note ${target}`}
                  onClick={() => removeNote(n)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </Tip>
            )}
          </div>
          <div className="flex min-w-16 shrink-0 justify-end">
            <NoteTimeChip note={n} t={t} />
          </div>
        </div>
      </div>
      {replying && (
        <div className="mt-1.5 ps-6 pb-1">
          <InlineFeedbackBox note={n} ask={!!fix?.ask} onDone={() => setReplyId(null)} />
        </div>
      )}
    </div>
  );
}

export function NoteListView({ items }: { items: readonly PlacedWithState[] }) {
  const [grouped, setGrouped] = useState(true);
  const [replyId, setReplyId] = useState<string | null>(null);
  const filterKey = useNoteFilterScopeKey();

  const flatRows = useMemo<FlatListRow[]>(() => {
    if (!grouped) {
      return items.map((item) => ({
        kind: "item",
        key: item.n.id,
        item,
      }));
    }
    const rows: FlatListRow[] = [];
    const checkReady = items.filter((it) => it.state === "check" && !isNoteAsking(it.n, "check"));
    const checkAsking = items.filter((it) => isNoteAsking(it.n, it.state));
    const openItems = items.filter((it) => it.state === "open");
    const doneItems = items.filter((it) => it.state === "done");
    const groups: {
      key: string;
      state: NoteState;
      asking?: boolean;
      bucket: PlacedWithState[];
    }[] = [
      { key: "head:check", state: "check", bucket: checkReady },
      { key: "head:asking", state: "check", asking: true, bucket: checkAsking },
      { key: "head:open", state: "open", bucket: openItems },
      { key: "head:done", state: "done", bucket: doneItems },
    ];
    for (const g of groups) {
      if (!g.bucket.length) continue;
      rows.push({
        kind: "head",
        key: g.key,
        state: g.state,
        asking: g.asking,
        count: g.bucket.length,
      });
      for (const item of g.bucket) {
        rows.push({ kind: "item", key: item.n.id, item });
      }
    }
    return rows;
  }, [grouped, items]);
  const displayRows = useExitedNotes(
    flatRows,
    rowKey,
    `${grouped ? "list|grouped" : "list|flat"}|${filterKey}`,
  );

  return (
    <div className="@container/list flex min-h-0 flex-1 flex-col px-3 pb-2.5">
      <div className="mb-2 flex flex-none items-center justify-between gap-2">
        <NoteViewChoice
          value={grouped ? "status" : "flat"}
          onChange={(value) => setGrouped(value === "status")}
          label="List grouping"
          options={[
            { value: "status", label: "By status" },
            { value: "flat", label: "Flat list" },
          ]}
          className="flex-1"
        />
        <span className="text-muted-foreground hidden font-mono text-xs tabular-nums @sm/list:inline">
          {items.length} shown
        </span>
      </div>

      <div className="bg-backdrop/55 border-hairline flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
        <VirtualList
          items={displayRows}
          getKey={rowKey}
          estimateSize={(i) => (displayRows[i]?.item.kind === "head" ? 34 : 58)}
          gap={0}
          overscan={8}
          data-arrow-scroll
          role="list"
          ariaLabel="Notes list"
          className="scroll-fade min-h-0 flex-1"
          listClassName="pb-6"
          renderItem={(entry) => {
            const row = entry.item;
            if (row.kind === "head") {
              return (
                <div className="border-hairline-subtle bg-surface-subtle flex h-8.5 items-center justify-between gap-2 border-b px-3">
                  <div className="flex items-center gap-1.5">
                    <NoteStatusGlyph state={row.state} asking={row.asking} />
                    <h3
                      className={cn(
                        "text-base leading-tight font-semibold text-balance",
                        noteStatusTextClass(row.state, row.asking),
                      )}
                    >
                      {noteStatusLabel(row.state, row.asking)}
                    </h3>
                    <span className="text-muted-foreground text-ui font-mono font-medium tabular-nums">
                      {row.count}
                    </span>
                  </div>
                </div>
              );
            }
            const node = (
              <NoteListRow
                item={row.item}
                grouped={grouped}
                replyId={replyId}
                setReplyId={setReplyId}
              />
            );
            return entry.exiting ? (
              <NoteExitSlot id={entry.id} kind={entry.kind}>
                {node}
              </NoteExitSlot>
            ) : (
              node
            );
          }}
        />
      </div>
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
  const asking = isNoteAsking(n, state);
  const needsWork = isCreatorNeedsWork(n, state);
  const { ref: cardRef, noteAttr } = useNoteMotion<HTMLDivElement>(n.id, state);

  return (
    <Card
      ref={cardRef}
      size="sm"
      tone={asking ? "ai" : state}
      data-note={noteAttr}
      data-ai-lit={lit || undefined}
      className="flex h-full flex-col"
    >
      <div
        data-slot="card-media"
        className="bg-backdrop border-hairline-subtle relative aspect-video w-full overflow-hidden border-b"
      >
        {media.after ? (
          <BeforeAfterPair note={n} t={t} media={media} compact mutedDone={state === "done"} />
        ) : (
          <button
            type="button"
            aria-label={`Jump to frame ${noteActionTarget(noteNum(n.id), stamp(t))}`}
            onClick={() => goToNote(n)}
            className="focus-visible:ring-ring block size-full cursor-pointer text-start outline-none focus-visible:ring-2 focus-visible:ring-inset"
          >
            {showImage ? (
              <img
                src={cover}
                loading="lazy"
                decoding="async"
                alt={`Frame at ${stamp(t)}`}
                onError={() => setFailedCover(cover)}
                className={cn(
                  "note-image-outline block size-full object-cover transition-opacity duration-150 motion-reduce:transition-none",
                  state === "done" && "opacity-75 group-hover/card:opacity-100",
                )}
              />
            ) : (
              <span className="text-label flex size-full flex-col items-center justify-center gap-1 px-2 text-center text-xs">
                <Camera aria-hidden className="size-4 opacity-60" />
                <span>No frame snapshot</span>
              </span>
            )}
          </button>
        )}
        {n.pin && media.crop && showImage && !media.after && (
          <img
            src={media.crop}
            alt={`Pin: ${n.pin.what}`}
            className="border-primary/80 bg-backdrop note-image-outline pointer-events-none absolute bottom-1.5 left-1.5 size-10 rounded-md border object-cover shadow-md"
          />
        )}
        <span
          className={cn(
            "text-picture bg-scrim-strong pointer-events-none absolute left-1.5 rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums",
            media.after ? "bottom-1.5" : "top-1.5",
          )}
        >
          {stamp(t)}
        </span>
      </div>
      <CardContent className="flex flex-1 flex-col">
        <div className="mb-1.5 flex flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <NoteNumber id={n.id} className="shrink-0" />
            <div className="ms-auto flex min-w-0 items-center gap-1">
              <NoteStatusGlyph state={state} asking={asking} needsWork={needsWork} />
              <span
                className={cn(
                  "truncate text-xs font-medium",
                  noteStatusTextClass(state, asking, needsWork),
                )}
                title={noteStatusLabel(state, asking, needsWork)}
              >
                {noteStatusLabel(state, asking, needsWork)}
              </span>
            </div>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span
              className="text-label text-ui min-w-0 flex-1 truncate font-medium"
              title={shot.full}
            >
              <span className={state === "done" ? "text-current" : "text-foreground/90"}>
                {shot.primary}
              </span>
              {shot.secondary && ` · ${shot.secondary}`}
            </span>
            {created && (
              <span className="text-muted-foreground shrink-0 font-mono text-xs whitespace-nowrap tabular-nums">
                {created}
              </span>
            )}
          </div>
        </div>
        <ExpandableNoteText
          text={n.text}
          clampLines={2}
          compact
          openLabel={`Open note ${noteActionTarget(noteNum(n.id), stamp(t))}: ${n.text || "no words"}`}
          onOpen={(el) => openNoteRow(n, state, el)}
        />
        <NoteTags note={n} />
        <NoteFollowups note={n} state={state} compact />
        <div className="mt-auto pt-2">
          <NoteCardActions
            note={n}
            t={t}
            state={state}
            replying={replyId === n.id}
            onToggleReply={() => setReplyId(replyId === n.id ? null : n.id)}
            onDoneReply={() => setReplyId(null)}
            compact
            iconOnly
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
  const filterKey = useNoteFilterScopeKey();
  const hostRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 390 ? 1 : 2,
  );

  useIsoLayoutEffect(() => {
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

  const animatedItems = useExitedNotes(items, noteKey, `gallery|${cols}|${filterKey}`);
  const rows = useMemo(() => chunkRows(animatedItems, cols), [animatedItems, cols]);
  const gridCls =
    cols === 3
      ? "grid grid-cols-3 items-stretch gap-2.5"
      : cols === 2
        ? "grid grid-cols-2 items-stretch gap-2.5"
        : "grid grid-cols-1 gap-2.5";

  return (
    <div ref={hostRef} className="flex min-h-0 flex-1 flex-col">
      <VirtualList
        items={rows}
        getKey={galleryRowKey}
        estimateSize={255}
        gap={10}
        overscan={4}
        data-arrow-scroll
        role="region"
        ariaLabel="Gallery notes grid"
        className="scroll-fade min-h-0 flex-1 px-3 pb-6"
        renderItem={(row) => (
          <div className={gridCls}>
            {row.map((entry) =>
              entry.exiting ? (
                <NoteExitSlot
                  key={entry.key}
                  id={entry.id}
                  kind={entry.kind}
                  collapseHeight={false}
                  className="h-full"
                >
                  <GalleryCard item={entry.item} replyId={replyId} setReplyId={setReplyId} />
                </NoteExitSlot>
              ) : (
                <GalleryCard
                  key={entry.key}
                  item={entry.item}
                  replyId={replyId}
                  setReplyId={setReplyId}
                />
              ),
            )}
          </div>
        )}
      />
    </div>
  );
}
import { NoteViewChoice } from "./NoteViewChoice";
