// The side list: notes still to fix, then the fixed ones folded away under them. CapCut has no notes list, so it follows
// Frame.io's comments panel: a search over the words, what was tapped and the shot, a Show menu (drawn notes, this shot) and a
// Sort menu (film order, newest, oldest). Both To-fix and Done cards share one scannable anatomy with a compact frame thumbnail
// that enlarges in a floating portal on hover. Only the cards in view are built (@tanstack/react-virtual): a film with thousands
// of notes plays as smoothly as one with none. In film order the list keeps the note at the playhead in view, unless a finger or
// wheel moved it in the last few seconds or a note is being edited.
import { Tabs } from "@base-ui/react/tabs";
import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUpDown,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Columns3,
  GanttChart,
  LayoutGrid,
  LayoutList,
  List,
  ListFilter,
  type LucideIcon,
  MessagesSquare,
  Plus,
  Table2,
  X,
} from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useLit, useLitAny } from "../activity/activity";
import { SaveStatus } from "../components/inspector";
import { TabStage } from "../components/Motion";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { PHONE } from "../core/device";
import { S } from "../core/state";
import { set, setPref, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { Compose } from "./Compose";
import { noteShotTitle } from "./note-card-meta";
import {
  CheckActions,
  Empty,
  ExpandableNoteText,
  InlineFeedbackBox,
  NoteDoneActions,
  NoteFollowups,
  NoteNumber,
  NoteOpenActions,
  noteSurfaceClass,
  NoteTags,
  NoteThumb,
  NoteTimeChip,
  StatusPill,
} from "./note-parts";
import {
  buildShotFilterOptions,
  combineFilteredNotes,
  countNoteFacets,
  EXTRA_NOTE_VIEWS,
  isCreatorNeedsWork,
  isExtraNoteView,
  NOTE_FACETS,
  NOTE_VIEWS,
  type NoteView,
  PRIMARY_NOTE_VIEWS,
} from "./note-views-model";
import { NoteBoardView, NoteGalleryView, NoteListView, NoteTableView } from "./NoteGridViews";
import {
  NoteCalendarView,
  NoteChartView,
  NoteFeedView,
  NoteTimelineView,
} from "./NoteInsightViews";
import {
  clearNoteFilters,
  editOldNote,
  openNote,
  originOf,
  type Placed,
  setReview,
  shownNotes,
} from "./notes";
import { type NoteFacet, type NoteScope, type NoteSort, type NoteStatusFilter } from "./slice";

const HOLD_LIST = 4000;

const NOTE_VIEW_META: Record<NoteView, { label: string; icon: LucideIcon; tip: string }> = {
  cards: { label: "Cards", icon: LayoutList, tip: "Detailed card stream" },
  list: { label: "List", icon: List, tip: "Compact scannable rows" },
  board: { label: "Board", icon: Columns3, tip: "Kanban columns by status or shot" },
  gallery: { label: "Gallery", icon: LayoutGrid, tip: "Visual frame & pin grid" },
  table: { label: "Table", icon: Table2, tip: "Sortable spreadsheet table" },
  timeline: { label: "Timeline", icon: GanttChart, tip: "Chronological shot tracks" },
  calendar: { label: "Calendar", icon: CalendarDays, tip: "Month calendar by date" },
  feed: { label: "Feed", icon: MessagesSquare, tip: "Full conversation thread stream" },
  chart: { label: "Chart", icon: BarChart3, tip: "Bar & donut breakdowns" },
};

const NoteCard = memo(function NoteCard({
  p: { n, t },
  near,
  editing,
}: {
  p: Placed;
  near: boolean;
  editing: boolean;
}) {
  const shotTitle = noteShotTitle(n.shot, n.shotName);
  const timeText = stamp(t);
  const lit = useLit(`note:${n.id}`);
  const needsWork = isCreatorNeedsWork(n, "open");
  return (
    <article
      data-note={n.id}
      data-tone="open"
      data-ai-lit={lit || undefined}
      className={noteSurfaceClass("open", { near, editing })}
    >
      <div className="flex min-h-6 items-center gap-1.5">
        <NoteNumber id={n.id} />
        <Tip label="Jump here">
          <NoteTimeChip note={n} t={t} />
        </Tip>
        <span className="min-w-0 flex-1 truncate text-xs" title={shotTitle.full}>
          <span className="text-foreground/95 font-semibold">{shotTitle.primary}</span>
          {shotTitle.secondary && <span className="text-label/80"> · {shotTitle.secondary}</span>}
        </span>
        <StatusPill state="open" needsWork={needsWork} />
      </div>
      <div className="mt-2 flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <ExpandableNoteText
            text={n.text}
            clampLines={3}
            openLabel={`Edit note at ${timeText}: ${n.text || "no words"}`}
            onOpen={(el) => editOldNote(n, originOf(el))}
          />
          <NoteTags note={n} />
        </div>
        <NoteThumb note={n} t={t} shotFull={shotTitle.full} />
      </div>
      <NoteFollowups note={n} state="open" />
      <NoteOpenActions note={n} t={t} />
    </article>
  );
});

// A fixed note keeps what was asked, what the frame looked like and what was done. It stays calmer than active work so eyes skip past it.
const DoneCard = memo(function DoneCard({ p: { n, t } }: { p: Placed }) {
  const shotTitle = noteShotTitle(n.shot, n.shotName);
  const lit = useLit(`note:${n.id}`);
  return (
    <article
      data-note={n.id}
      data-tone="done"
      data-ai-lit={lit || undefined}
      className={noteSurfaceClass("done")}
    >
      <div className="flex min-h-6 items-center gap-1.5">
        <NoteNumber id={n.id} />
        <Tip label="Jump here">
          <NoteTimeChip note={n} t={t} />
        </Tip>
        <span className="min-w-0 flex-1 truncate text-xs" title={shotTitle.full}>
          <span className="text-foreground/85 font-semibold">{shotTitle.primary}</span>
          {shotTitle.secondary && <span className="text-label/70"> · {shotTitle.secondary}</span>}
        </span>
        <StatusPill state="done" />
      </div>
      <div className="mt-2 flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <ExpandableNoteText text={n.text} clampLines={2} />
          <NoteTags note={n} />
        </div>
        <NoteThumb note={n} t={t} shotFull={shotTitle.full} muted />
      </div>
      <NoteFollowups note={n} state="done" />
      <NoteDoneActions note={n} t={t} approved={n.approved} />
    </article>
  );
});

// The AI answered: a fix waiting for the creator's yes, or a question waiting for their words. Warm surface until acted on
const CheckCard = memo(function CheckCard({ p: { n, t } }: { p: Placed }) {
  const shotTitle = noteShotTitle(n.shot, n.shotName);
  const lit = useLit(`note:${n.id}`);
  const fix = n.fixes?.at(-1);
  const [replying, setReplying] = useState(false);
  return (
    <article
      data-note={n.id}
      data-tone="check"
      data-ai-lit={lit || undefined}
      className={noteSurfaceClass("check")}
    >
      <div className="flex min-h-6 items-center gap-1.5">
        <NoteNumber id={n.id} />
        <Tip label="Jump here">
          <NoteTimeChip note={n} t={t} />
        </Tip>
        <span className="min-w-0 flex-1 truncate text-xs" title={shotTitle.full}>
          <span className="text-foreground/95 font-semibold">{shotTitle.primary}</span>
          {shotTitle.secondary && <span className="text-label/80"> · {shotTitle.secondary}</span>}
        </span>
        <StatusPill state="check" asking={!!fix?.ask} />
      </div>
      <div className="mt-2 flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <ExpandableNoteText text={n.text} clampLines={3} />
          <NoteTags note={n} />
        </div>
        <NoteThumb note={n} t={t} shotFull={shotTitle.full} />
      </div>
      <NoteFollowups note={n} state="check" />
      <CheckActions
        note={n}
        ask={!!fix?.ask}
        replying={replying}
        onToggleReply={() => setReplying((r) => !r)}
        showEdit
      />
      {replying && (
        <InlineFeedbackBox note={n} ask={!!fix?.ask} onDone={() => setReplying(false)} />
      )}
    </article>
  );
});

const SORTS: { value: NoteSort; title: string }[] = [
  { value: "film", title: "Film order" },
  { value: "activity", title: "Latest activity" },
  { value: "newest", title: "Newest created" },
  { value: "oldest", title: "Oldest created" },
];

function FilterMenu({
  allItems,
}: {
  allItems: readonly {
    n: Placed["n"];
    t: number;
    span: Placed["span"];
    words: string;
    state: "check" | "open" | "done";
  }[];
}) {
  const scope = useStudio((s) => s.noteScope),
    shot = useStudio((s) => s.noteShot),
    facets = useStudio((s) => s.noteFacets);
  const facetCounts = useMemo(() => countNoteFacets(allItems), [allItems]);
  const shotOptions = useMemo(() => buildShotFilterOptions(allItems), [allItems]);
  const activeCount = (scope !== "all" ? 1 : 0) + (shot !== null ? 1 : 0) + facets.length;
  const threadFacets = NOTE_FACETS.filter((f) => f.group === "thread");
  const mediaFacets = NOTE_FACETS.filter((f) => f.group === "media");
  const toggleFacet = (id: NoteFacet) => {
    set({
      noteFacets: facets.includes(id) ? facets.filter((f) => f !== id) : [...facets, id],
    });
  };
  const label = activeCount > 0 ? `Filter notes (${activeCount} active)` : "Filter notes";

  return (
    <DropdownMenu>
      <Tip label={label}>
        <DropdownMenuTrigger
          render={
            <Button
              variant={activeCount > 0 ? "lit" : "outline"}
              size="md"
              aria-label={label}
              className="flex-none"
            />
          }
        >
          <ListFilter aria-hidden data-icon="inline-start" />
          <span className="hidden @[360px]:inline">Filter</span>
          {activeCount > 0 && (
            <span className="bg-primary text-primary-foreground text-tag rounded-full px-1.5 leading-4 font-bold tabular-nums">
              {activeCount}
            </span>
          )}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Scope</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={scope}
            onValueChange={(v) => set({ noteScope: v as NoteScope })}
          >
            <DropdownMenuRadioItem value="all">All film</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="shot">In current shot (playhead)</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {shotOptions.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span>
                  {shot !== null
                    ? `Shot: ${shotOptions.find((s) => s.shot === shot)?.label ?? `Shot ${shot}`}`
                    : "Filter by shot"}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                <DropdownMenuRadioGroup
                  value={shot === null ? "all" : String(shot)}
                  onValueChange={(v) => set({ noteShot: v === "all" ? null : Number(v) })}
                >
                  <DropdownMenuRadioItem value="all">
                    All shots ({allItems.length})
                  </DropdownMenuRadioItem>
                  {shotOptions.map((opt) => (
                    <DropdownMenuRadioItem key={opt.shot} value={String(opt.shot)}>
                      <span className="flex flex-1 items-center justify-between gap-3">
                        <span className="truncate">{opt.label}</span>
                        <span className="text-label font-mono text-xs tabular-nums">
                          {opt.count}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Attention & thread</DropdownMenuLabel>
          {threadFacets.map((f) => (
            <DropdownMenuCheckboxItem
              key={f.id}
              checked={facets.includes(f.id)}
              onCheckedChange={() => toggleFacet(f.id)}
            >
              <span className="flex flex-1 items-center justify-between gap-3">
                <span>{f.label}</span>
                <span className="text-label font-mono text-xs tabular-nums">
                  {facetCounts[f.id]}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Context & attachments</DropdownMenuLabel>
          {mediaFacets.map((f) => (
            <DropdownMenuCheckboxItem
              key={f.id}
              checked={facets.includes(f.id)}
              onCheckedChange={() => toggleFacet(f.id)}
            >
              <span className="flex flex-1 items-center justify-between gap-3">
                <span>{f.label}</span>
                <span className="text-label font-mono text-xs tabular-nums">
                  {facetCounts[f.id]}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {activeCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => set({ noteScope: "all", noteShot: null, noteFacets: [] })}
            >
              Reset filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortMenu() {
  const sort = useStudio((s) => s.noteSort);
  const active = SORTS.find((x) => x.value === sort) ?? SORTS[0];
  const label = `Sort notes: ${active.title}`;
  return (
    <DropdownMenu>
      <Tip label={label}>
        <DropdownMenuTrigger
          render={
            <Button
              variant={sort !== "film" ? "lit" : "outline"}
              size="md"
              aria-label={label}
              className="flex-none"
            />
          }
        >
          <ArrowUpDown aria-hidden data-icon="inline-start" />
          <span className="hidden @[430px]:inline">{active.title}</span>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort order</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(v) => set({ noteSort: v as NoteSort })}
          >
            {SORTS.map((x) => (
              <DropdownMenuRadioItem key={x.value} value={x.value}>
                {x.title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Row =
  | { key: string; kind: "open" | "check" | "done"; p: Placed }
  | { key: string; kind: "checkHead" | "openHead" | "doneHead" | "none" | "fold" | "noneDone" };

const STATUS_FILTERS: { id: NoteStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "check", label: "To check" },
  { id: "open", label: "To fix" },
  { id: "done", label: "Done" },
];

export function NoteViewBar({
  view,
  onChange,
}: {
  view: NoteView;
  onChange: (next: NoteView) => void;
}) {
  return (
    <div className="bg-backdrop/75 border-border/55 flex items-center gap-0.5 rounded-lg border p-0.5">
      <Tabs.Root
        value={isExtraNoteView(view) ? null : view}
        onValueChange={(v) => {
          if (v) onChange(v as NoteView);
        }}
        className="min-w-0 flex-1"
      >
        <Tabs.List
          aria-label="Notes layout view"
          className="relative flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto"
        >
          <Tabs.Indicator
            aria-hidden
            className="tab-pill-indicator bg-card ring-primary/35 z-0 rounded-md shadow-xs ring-1"
          />
          {PRIMARY_NOTE_VIEWS.map((id) => {
            const { label, icon: Icon, tip } = NOTE_VIEW_META[id];
            return (
              <Tip key={id} label={tip}>
                <Tabs.Tab
                  value={id}
                  data-note-view-tab={id}
                  className="text-muted-foreground not-data-active:hover:text-foreground not-data-active:hover:bg-muted/45 focus-visible:ring-ring data-active:text-primary studio-press relative z-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2"
                >
                  <Icon aria-hidden className="size-3.5" />
                  <span>{label}</span>
                </Tabs.Tab>
              </Tip>
            );
          })}
        </Tabs.List>
      </Tabs.Root>
      <DropdownMenu>
        <Tip label="More note views">
          <DropdownMenuTrigger
            render={
              <Button
                variant="tab"
                size="sm"
                aria-label="More note views"
                aria-pressed={isExtraNoteView(view)}
                className="h-7 shrink-0 gap-1 rounded-md px-2 text-xs font-medium"
              />
            }
          >
            {isExtraNoteView(view) ? (
              <>
                {(() => {
                  const ActiveIcon = NOTE_VIEW_META[view].icon;
                  return <ActiveIcon aria-hidden className="size-3.5" />;
                })()}
                <span>{NOTE_VIEW_META[view].label}</span>
              </>
            ) : (
              <span>More</span>
            )}
            <ChevronDown aria-hidden data-icon="inline-end" className="size-3 opacity-75" />
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuGroup>
            <DropdownMenuLabel>More views</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={view} onValueChange={(v) => onChange(v as NoteView)}>
              {EXTRA_NOTE_VIEWS.map((id) => {
                const { label, icon: Icon, tip } = NOTE_VIEW_META[id];
                return (
                  <DropdownMenuRadioItem key={id} value={id} title={tip} closeOnClick>
                    <span className="flex items-center gap-2">
                      <Icon aria-hidden className="text-label size-3.5" />
                      <span>{label}</span>
                    </span>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function NoteStatusStrip({
  status,
  counts,
  onChange,
}: {
  status: NoteStatusFilter;
  counts: Record<NoteStatusFilter, number>;
  onChange: (next: NoteStatusFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter notes by status"
      className="bg-backdrop/75 border-border/55 grid grid-cols-4 gap-0.5 rounded-lg border p-0.5"
    >
      {STATUS_FILTERS.map((sf) => {
        const active = status === sf.id;
        const nCount = counts[sf.id];
        return (
          <button
            key={sf.id}
            type="button"
            data-status-filter={sf.id}
            aria-pressed={active}
            onClick={() => onChange(sf.id)}
            className={cn(
              "focus-visible:ring-ring studio-press text-tag flex min-h-6 cursor-pointer items-center justify-center gap-1 rounded-md px-1 font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 pointer-coarse:min-h-8",
              active
                ? "bg-secondary text-foreground font-semibold shadow-xs ring-1 ring-white/12"
                : "text-label hover:bg-muted/45 hover:text-foreground",
            )}
          >
            {sf.id !== "all" && (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full transition-opacity",
                  sf.id === "check" ? "bg-warn" : sf.id === "open" ? "bg-primary" : "bg-ok",
                  !active && nCount === 0 && "opacity-45",
                )}
              />
            )}
            <span className="truncate">{sf.label}</span>
            <span
              className={cn(
                "font-mono tabular-nums",
                active
                  ? "text-foreground/85"
                  : sf.id === "check" && nCount > 0
                    ? "text-warn font-semibold"
                    : "text-label",
              )}
            >
              {nCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function NoteList({ composeDock = false }: { composeDock?: boolean }) {
  const notes = useStudio((s) => s.notes),
    saved = useStudio((s) => s.saved),
    nearNote = useStudio((s) => s.nearNote),
    view = useStudio((s) => s.noteView);
  const editing = useStudio((s) => (s.compose?.kind === "edit" ? s.compose.id : undefined)),
    q = useStudio((s) => s.noteSearch),
    status = useStudio((s) => s.noteStatus),
    scope = useStudio((s) => s.noteScope),
    shot = useStudio((s) => s.noteShot),
    facets = useStudio((s) => s.noteFacets),
    sort = useStudio((s) => s.noteSort);
  useStudio((s) => (s.noteScope === "shot" ? s.shot : "")); // "In current shot" follows the playhead from shot to shot
  const [doneOpen, setDoneOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null),
    touched = useRef(-1e9),
    focused = useRef<string | null>(null);
  const { open, check, done, ix } = shownNotes(),
    narrowed = !!q.trim() || scope !== "all" || shot !== null || facets.length > 0,
    anyFiltered = narrowed || status !== "all";
  const allRawItems = useMemo(
    () => combineFilteredNotes({ check: ix.check, open: ix.open, done: ix.done }),
    [ix],
  );
  const allItems = useMemo(
    () => combineFilteredNotes({ check, open, done }, status),
    [check, open, done, status],
  );
  const doneLitKeys = useMemo(() => ix.done.map((p) => `note:${p.n.id}`), [ix.done]);
  const doneLit = useLitAny(doneLitKeys);
  const doneLearnedCount = useMemo(
    () => ix.done.filter((p) => Boolean(p.n.learned?.what)).length,
    [ix.done],
  );
  const shotOptions = useMemo(() => buildShotFilterOptions(allRawItems), [allRawItems]);

  const rows = useMemo(() => {
    if (status === "check") {
      return check.length
        ? ([
            { key: "checkHead", kind: "checkHead" },
            ...check.map((p): Row => ({ key: p.n.id, kind: "check", p })),
          ] as Row[])
        : ([{ key: "none", kind: "none" }] as Row[]);
    }
    if (status === "open") {
      return open.length
        ? ([
            { key: "openHead", kind: "openHead" },
            ...open.map((p): Row => ({ key: p.n.id, kind: "open", p })),
          ] as Row[])
        : ([{ key: "none", kind: "none" }] as Row[]);
    }
    if (status === "done") {
      return done.length
        ? ([
            { key: "doneHead", kind: "doneHead" },
            ...done.map((p): Row => ({ key: p.n.id, kind: "done", p })),
          ] as Row[])
        : ([{ key: "noneDone", kind: "noneDone" }] as Row[]);
    }
    const r: Row[] = check.length
      ? [
          { key: "checkHead", kind: "checkHead" },
          ...check.map((p): Row => ({ key: p.n.id, kind: "check", p })),
          { key: "openHead", kind: "openHead" },
        ]
      : [];
    r.push(
      ...(open.length
        ? open.map((p): Row => ({ key: p.n.id, kind: "open", p }))
        : [{ key: "none", kind: "none" } as Row]),
    );
    if (notes.length) r.push({ key: "fold", kind: "fold" });
    if (notes.length && doneOpen)
      r.push(
        ...(done.length
          ? done.map((p): Row => ({ key: p.n.id, kind: "done", p }))
          : [{ key: "noneDone", kind: "noneDone" } as Row]),
      );
    return r;
  }, [status, open, check, done, doneOpen, notes.length]);
  const rowOf = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);

  // The card holding the keyboard's focus stays built when it scrolls out of view, or the focus would drop to the page
  const rangeExtractor = useCallback(
    (range: Range) => {
      const shownNow = defaultRangeExtractor(range),
        i = focused.current ? rowOf.get(focused.current) : undefined;
      return i === undefined || shownNow.includes(i)
        ? shownNow
        : [...shownNow, i].sort((a, b) => a - b);
    },
    [rowOf],
  );
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => list.current,
    getItemKey: (i) => rows[i].key,
    rangeExtractor,
    gap: 8,
    overscan: 6,
    initialRect: { width: 400, height: 800 },
    useFlushSync: false,
    estimateSize: (i) =>
      ({
        done: 146,
        check: 168,
        checkHead: 28,
        openHead: 28,
        doneHead: 28,
      })[rows[i].kind as string] ?? 116,
  });

  const didMount = useRef(false);
  const lastNear = useRef<string | null>(null);
  const lastTime = useRef(0);

  useEffect(() => {
    const curT = S.t;
    if (!didMount.current) {
      didMount.current = true;
      lastNear.current = nearNote ?? null;
      lastTime.current = curT;
      return;
    }
    const timeMoved = Math.abs(curT - lastTime.current) > 0.01;
    lastTime.current = curT;
    if (lastNear.current === (nearNote ?? null) || !timeMoved) {
      lastNear.current = nearNote ?? null;
      return;
    }
    lastNear.current = nearNote ?? null;
    const box = list.current,
      i = rowOf.get(nearNote ?? "");
    if (
      !box ||
      i === undefined ||
      sort !== "film" ||
      editing ||
      performance.now() - touched.current < HOLD_LIST
    )
      return;
    const to = v.getOffsetForIndex(i, "center")?.[0] ?? box.scrollTop;
    v.scrollToIndex(i, {
      align: "center",
      behavior: Math.abs(to - box.scrollTop) > 500 ? "auto" : "smooth",
    }); // a long way is a jump, not a slide past everything
  }, [nearNote, editing, sort, rowOf, v]);

  const count = (shownHere: Placed[], all: Placed[]) =>
    narrowed ? `${shownHere.length} of ${all.length}` : all.length;
  const totalShown = check.length + open.length + done.length;
  const statusCounts: Record<NoteStatusFilter, number> = {
    all: totalShown,
    check: check.length,
    open: open.length,
    done: done.length,
  };

  const row = (r: Row): ReactNode => {
    if (r.kind === "open")
      return <NoteCard p={r.p} near={r.p.n.id === nearNote} editing={r.p.n.id === editing} />;
    if (r.kind === "done") return <DoneCard p={r.p} />;
    if (r.kind === "check") return <CheckCard p={r.p} />;
    if (r.kind === "checkHead")
      return (
        <h3 className="text-ui text-warn flex h-7 items-center gap-1.5 px-0.5 font-semibold tabular-nums">
          <span aria-hidden className="bg-warn size-2 rounded-full" />
          <span>To check ({count(check, ix.check)})</span>
        </h3>
      );
    if (r.kind === "openHead")
      return (
        <h3 className="text-ui text-foreground flex h-7 items-center gap-1.5 px-0.5 font-semibold tabular-nums">
          <span aria-hidden className="bg-primary size-2 rounded-full" />
          <span>To fix ({count(open, ix.open)})</span>
        </h3>
      );
    if (r.kind === "doneHead")
      return (
        <h3 className="text-ui text-ok-text flex h-7 items-center gap-1.5 px-0.5 font-semibold tabular-nums">
          <span aria-hidden className="bg-ok size-2 rounded-full" />
          <span>Done ({count(done, ix.done)})</span>
        </h3>
      );
    if (r.kind === "none") {
      if (anyFiltered && notes.length > 0)
        return (
          <Empty>
            {status === "check"
              ? "Nothing waiting to check matching filters."
              : "No open notes match your filters."}{" "}
            <Button variant="link" size="inline" onClick={clearNoteFilters}>
              Reset filters
            </Button>
          </Empty>
        );
      return (
        <Empty>
          {ix.done.length
            ? "Nothing left to fix"
            : "No notes yet. Click the picture or press M to add one"}
        </Empty>
      );
    }
    if (r.kind === "noneDone")
      return (
        <Empty>
          {anyFiltered && ix.done.length ? (
            <>
              No fixed notes match.{" "}
              <Button variant="link" size="inline" onClick={clearNoteFilters}>
                Reset filters
              </Button>
            </>
          ) : (
            "Notes you approve land here."
          )}
        </Empty>
      );
    // Folded by default in All mode so active work leads; Done tab shows them directly expanded.
    return (
      <button
        type="button"
        aria-expanded={doneOpen}
        data-ai-lit={(!doneOpen && doneLit) || undefined}
        onClick={() => setDoneOpen(!doneOpen)}
        className="text-ui text-label hover:bg-card hover:text-foreground focus-visible:ring-ring border-border/50 bg-background/60 mt-1 flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-xl border px-2.5 font-semibold transition-colors outline-none focus-visible:ring-2 pointer-coarse:min-h-10"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 motion-safe:transition-transform", doneOpen && "rotate-90")}
        />
        <span aria-hidden className="bg-ok size-2 rounded-full" />
        <span>Done ({narrowed ? `${done.length} of ${ix.done.length}` : ix.done.length})</span>
        {!doneOpen && doneLearnedCount > 0 && (
          <span className="text-ai-text text-tag font-medium">· {doneLearnedCount} learned</span>
        )}
      </button>
    );
  };

  return (
    <section
      aria-label="Notes"
      className="@container flex min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <div className="upright:py-1.5 sideways:py-1 flex flex-none flex-wrap items-center gap-1.5 px-3 pt-2.5 pb-1.5">
        <h2 className="text-ui flex h-7 items-center px-0.5 font-semibold tabular-nums">
          Notes
          {notes.length > 0 && (
            <span className="text-label ms-1.5 font-mono text-xs font-medium">
              ({notes.length})
            </span>
          )}
        </h2>
        {!PHONE && (
          <Tip label="Add a note at the playhead (M)">
            <Button
              variant={notes.length === 0 ? "default" : "secondary"}
              size="sm"
              aria-label="New note"
              className="pointer-coarse:min-h-9"
              onClick={(e) => openNote(null, true, originOf(e.currentTarget))}
            >
              <Plus aria-hidden data-icon="inline-start" />
              Note
            </Button>
          </Tip>
        )}
        {/* The Review room is the desk's big view; highlights when notes await check */}
        {!PHONE && ix.check.length + ix.open.length + ix.done.length > 0 && (
          <Tip label="Review room: notes and pictures, big (N)">
            <Button
              variant={ix.check.length > 0 ? "warn" : "outline"}
              size="sm"
              aria-label={`Review room${ix.check.length ? `, ${ix.check.length} to check` : ""}`}
              className="pointer-coarse:min-h-9"
              onClick={() => setReview(true)}
            >
              <ClipboardCheck aria-hidden data-icon="inline-start" />
              Review
              {ix.check.length > 0 && (
                <span
                  aria-hidden
                  className="bg-warn text-tag ms-0.5 rounded-full px-1.5 leading-4 font-semibold text-black tabular-nums"
                >
                  {ix.check.length}
                </span>
              )}
            </Button>
          </Tip>
        )}
        <SaveStatus
          state={saved}
          idleTone="ok"
          idleText={notes.length ? "Saved" : ""}
          failText="Not sent. Retrying…"
          className={cn(
            "ms-auto text-end",
            saved === "fail" ? "whitespace-normal" : "whitespace-nowrap",
          )}
        />
      </div>

      {notes.length > 0 && (
        <div className="flex flex-none flex-col gap-1.5 px-3 pb-2">
          <NoteViewBar view={view} onChange={(v) => setPref("noteView", v)} />
          <NoteStatusStrip
            status={status}
            counts={statusCounts}
            onChange={(s) => set({ noteStatus: s })}
          />

          <div className="flex items-center gap-1">
            <SearchBox
              name="note-search"
              value={q}
              onChange={(x) => set({ noteSearch: x })}
              label="Search notes"
              placeholder={`Search #id, text, shot (${notes.length})…`}
              className="min-w-0 flex-1"
            />
            <FilterMenu allItems={allRawItems} />
            <SortMenu />
          </div>

          {narrowed && (
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              {q.trim() && (
                <Button
                  variant="secondary"
                  size="pill"
                  aria-label="Clear search filter"
                  onClick={() => set({ noteSearch: "" })}
                >
                  <span>“{q.trim()}”</span>
                  <X aria-hidden />
                </Button>
              )}
              {scope === "shot" && (
                <Button
                  variant="secondary"
                  size="pill"
                  aria-label="Clear current shot scope"
                  onClick={() => set({ noteScope: "all" })}
                >
                  <span>Current shot</span>
                  <X aria-hidden />
                </Button>
              )}
              {shot !== null && (
                <Button
                  variant="secondary"
                  size="pill"
                  aria-label="Clear shot filter"
                  onClick={() => set({ noteShot: null })}
                >
                  <span>{shotOptions.find((o) => o.shot === shot)?.label ?? `Shot ${shot}`}</span>
                  <X aria-hidden />
                </Button>
              )}
              {facets.map((fid) => {
                const meta = NOTE_FACETS.find((m) => m.id === fid);
                if (!meta) return null;
                return (
                  <Button
                    key={fid}
                    variant="secondary"
                    size="pill"
                    aria-label={`Remove ${meta.label} filter`}
                    onClick={() => set({ noteFacets: facets.filter((f) => f !== fid) })}
                  >
                    <span>{meta.label}</span>
                    <X aria-hidden />
                  </Button>
                );
              })}
              <Button variant="link" size="sm" onClick={clearNoteFilters} className="ms-1">
                Reset all
              </Button>
            </div>
          )}
        </div>
      )}

      <TabStage
        activeKey={notes.length === 0 ? "cards" : view}
        order={NOTE_VIEWS}
        className="border-border/50 flex min-h-0 flex-1 flex-col border-t pt-1.5"
      >
        {view === "cards" || notes.length === 0 ? (
          <div
            ref={list}
            data-arrow-scroll
            className="scroll-fade min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-3"
            onPointerDown={() => {
              touched.current = performance.now();
            }}
            onWheel={() => {
              touched.current = performance.now();
            }}
            onTouchMove={() => {
              touched.current = performance.now();
            }}
          >
            <div
              className="relative h-(--total) w-full"
              style={{ "--total": `${v.getTotalSize()}px` }}
            >
              {v.getVirtualItems().map((it) => (
                <div
                  key={it.key}
                  data-index={it.index}
                  ref={v.measureElement}
                  className="absolute inset-x-0 top-0 translate-y-(--start)"
                  style={{ "--start": `${it.start}px` }}
                  onFocus={() => {
                    focused.current = rows[it.index].key;
                  }}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                      focused.current = null;
                  }}
                >
                  {row(rows[it.index])}
                </div>
              ))}
            </div>
          </div>
        ) : allItems.length === 0 && view !== "board" ? (
          <div className="min-h-0 flex-1 px-3 py-2">
            <Empty>
              {anyFiltered ? (
                <>
                  No notes match{q.trim() ? ` “${q.trim()}”` : " current filters"}.{" "}
                  <Button variant="link" size="inline" onClick={clearNoteFilters}>
                    Reset filters
                  </Button>
                </>
              ) : (
                <>
                  No notes yet.{" "}
                  <Button
                    variant="link"
                    size="inline"
                    onClick={(e) => openNote(null, true, originOf(e.currentTarget))}
                  >
                    Add note
                  </Button>
                </>
              )}
            </Empty>
          </div>
        ) : view === "board" ? (
          <NoteBoardView items={allItems} statusFilter={status} />
        ) : view === "table" ? (
          <NoteTableView items={allItems} />
        ) : view === "list" ? (
          <NoteListView items={allItems} />
        ) : view === "gallery" ? (
          <NoteGalleryView items={allItems} />
        ) : view === "timeline" ? (
          <NoteTimelineView items={allItems} />
        ) : view === "calendar" ? (
          <NoteCalendarView items={allItems} />
        ) : view === "feed" ? (
          <NoteFeedView items={allItems} />
        ) : (
          <NoteChartView items={allItems} />
        )}
      </TabStage>
      {composeDock && <Compose dock />}
    </section>
  );
}
