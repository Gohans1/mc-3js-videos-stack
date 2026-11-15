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
import { prefersReduced, TabStage } from "../components/Motion";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { PHONE, useUpright } from "../core/device";
import { S } from "../core/state";
import { set, setPref, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { Compose } from "./Compose";
import { noteActionTarget, noteShotTitle } from "./note-card-meta";
import {
  ActiveFilterChips,
  CheckActions,
  Empty,
  ExpandableNoteText,
  InlineFeedbackBox,
  NoteCardHeader,
  NoteDoneActions,
  NoteFollowups,
  NoteOpenActions,
  NoteStatusGlyph,
  noteSurfaceClass,
  NoteTags,
  NoteThumb,
  openNoteRow,
} from "./note-parts";
import {
  buildShotFilterOptions,
  combineFilteredNotes,
  countNoteFacets,
  EXTRA_NOTE_VIEWS,
  isCreatorNeedsWork,
  isNoteAsking,
  isOverflowNoteView,
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
  noteNum,
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
      <NoteCardHeader
        note={n}
        t={t}
        state="open"
        needsWork={needsWork}
        shotPrimary={shotTitle.primary}
        shotSecondary={shotTitle.secondary}
        shotFull={shotTitle.full}
        lit={lit}
      />
      <div className="mt-1.5 flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <ExpandableNoteText
            text={n.text}
            clampLines={3}
            openLabel={`Edit note ${noteActionTarget(noteNum(n.id), timeText)}: ${n.text || "no words"}`}
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
  const timeText = stamp(t);
  const lit = useLit(`note:${n.id}`);
  return (
    <article
      data-note={n.id}
      data-tone="done"
      data-ai-lit={lit || undefined}
      className={noteSurfaceClass("done")}
    >
      <NoteCardHeader
        note={n}
        t={t}
        state="done"
        shotPrimary={shotTitle.primary}
        shotSecondary={shotTitle.secondary}
        shotFull={shotTitle.full}
        lit={lit}
      />
      <div className="mt-1.5 flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <ExpandableNoteText
            text={n.text}
            clampLines={2}
            openLabel={`Open note ${noteActionTarget(noteNum(n.id), timeText)}: ${n.text || "no words"}`}
            onOpen={(el) => openNoteRow(n, "done", el)}
          />
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
  const timeText = stamp(t);
  const lit = useLit(`note:${n.id}`);
  const fix = n.fixes?.at(-1);
  const [replying, setReplying] = useState(false);
  return (
    <article
      data-note={n.id}
      data-tone={fix?.ask ? "ai" : "check"}
      data-ai-lit={lit || undefined}
      className={noteSurfaceClass("check", { asking: !!fix?.ask })}
    >
      <NoteCardHeader
        note={n}
        t={t}
        state="check"
        asking={!!fix?.ask}
        shotPrimary={shotTitle.primary}
        shotSecondary={shotTitle.secondary}
        shotFull={shotTitle.full}
        lit={lit}
      />
      <div className="mt-1.5 flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <ExpandableNoteText
            text={n.text}
            clampLines={3}
            openLabel={`Open note ${noteActionTarget(noteNum(n.id), timeText)}: ${n.text || "no words"}`}
            onOpen={(el) => openNoteRow(n, "check", el)}
          />
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
  const [menuOpen, setMenuOpen] = useState(false);
  const label = activeCount > 0 ? `Filter notes (${activeCount} active)` : "Filter notes";

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <Tip label={label} side="bottom" open={menuOpen ? false : undefined}>
        <DropdownMenuTrigger
          render={
            <Button
              variant={activeCount > 0 ? "lit" : "subtle"}
              size="md"
              aria-label={label}
              className="flex-none"
            />
          }
        >
          <ListFilter aria-hidden data-icon="inline-start" />
          <span className="hidden @[320px]:inline">Filter</span>
          {activeCount > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs leading-4 font-bold tabular-nums">
              {activeCount}
            </span>
          )}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent
        align="end"
        finalFocus={(closedBy) => closedBy === "keyboard"}
        font="md"
        className="w-auto min-w-56"
      >
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
              <DropdownMenuSubContent
                font="md"
                className="max-h-72 overflow-y-auto overscroll-contain"
              >
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

const SORT_FIXED_REASON: Partial<Record<NoteView, string>> = {
  table: "Table sorts by clicking any column header",
  timeline: "Timeline orders notes chronologically along the film",
  calendar: "Calendar groups notes by date created",
  feed: "Feed toggles between Latest activity and Film order",
  chart: "Chart orders buckets by count",
};

function SortMenu({ fixedReason }: { fixedReason?: string }) {
  const sort = useStudio((s) => s.noteSort);
  const [menuOpen, setMenuOpen] = useState(false);
  const active = SORTS.find((x) => x.value === sort) ?? SORTS[0];
  const label = `Sort notes: ${active.title}`;
  if (fixedReason) return null;
  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <Tip label={label} side="bottom" open={menuOpen ? false : undefined}>
        <DropdownMenuTrigger
          render={
            <Button
              variant={sort !== "film" ? "lit" : "subtle"}
              size="md"
              aria-label={label}
              className="flex-none"
            />
          }
        >
          <ArrowUpDown aria-hidden data-icon="inline-start" />
          <span className="hidden @[320px]:inline">{active.title}</span>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent
        align="end"
        finalFocus={(closedBy) => closedBy === "keyboard"}
        font="md"
        className="w-auto min-w-44"
      >
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
  | { key: string; kind: "open" | "check" | "asking" | "done"; p: Placed }
  | {
      key: string;
      kind: "askHead" | "checkHead" | "openHead" | "none" | "fold" | "noneDone";
    };

const STATUS_FILTERS: { id: NoteStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "check", label: "To check" },
  { id: "asking", label: "AI asks" },
  { id: "open", label: "To fix" },
  { id: "done", label: "Done" },
];

const ACTIVE_STATUS_STYLE: Record<NoteStatusFilter, string> = {
  all: "bg-secondary text-foreground ring-hairline-strong font-semibold shadow-xs ring-1",
  check: "bg-warn/[0.16] text-warn-text ring-warn/45 font-semibold shadow-xs ring-1",
  asking: "bg-ai/[0.16] text-ai-text ring-ai/45 font-semibold shadow-xs ring-1",
  open: "bg-primary/[0.16] text-primary-text ring-primary/45 font-semibold shadow-xs ring-1",
  done: "bg-ok/[0.16] text-ok-text ring-ok/45 font-semibold shadow-xs ring-1",
};

export function NoteViewBar({
  view,
  onChange,
}: {
  view: NoteView;
  onChange: (next: NoteView) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const upright = useUpright();
  const overflowActive = isOverflowNoteView(view, upright);
  return (
    <div className="bg-backdrop/90 border-hairline upright:w-fit upright:max-w-full flex items-center gap-0.5 rounded-lg border p-0.5">
      <Tabs.Root
        value={overflowActive ? null : view}
        onValueChange={(v) => {
          if (v) onChange(v as NoteView);
        }}
        className="upright:flex-none min-w-0 flex-1"
      >
        <Tabs.List
          aria-label="Notes layout view"
          className="scroll-fade-x relative flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto overscroll-x-contain"
        >
          <Tabs.Indicator
            aria-hidden
            className="tab-pill-indicator bg-secondary ring-hairline-strong z-0 rounded-md shadow-xs ring-1"
          />
          {PRIMARY_NOTE_VIEWS.map((id) => {
            const { label, icon: Icon, tip } = NOTE_VIEW_META[id];
            return (
              <Tip key={id} label={tip} side="bottom">
                <Tabs.Tab
                  value={id}
                  data-note-view-tab={id}
                  className={cn(
                    "text-muted-foreground not-data-active:hover:text-foreground focus-visible:ring-ring data-active:[&_svg]:text-primary-text studio-press not-data-active:hover:bg-surface-subtle data-active:text-foreground text-ui relative z-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 font-medium whitespace-nowrap outline-none focus-visible:ring-2 data-active:font-semibold motion-reduce:transition-none pointer-coarse:h-10",
                    id === "gallery" && "upright:hidden",
                  )}
                >
                  <Icon aria-hidden className="size-3.5" />
                  <span>{label}</span>
                </Tabs.Tab>
              </Tip>
            );
          })}
        </Tabs.List>
      </Tabs.Root>
      <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
        <Tip label="More note views" side="bottom" open={moreOpen ? false : undefined}>
          <DropdownMenuTrigger
            render={
              <Button
                variant="tab"
                size="tab"
                aria-label={
                  overflowActive
                    ? `${NOTE_VIEW_META[view].label} — more note views`
                    : "More note views"
                }
                aria-pressed={overflowActive}
                className="shrink-0"
              />
            }
          >
            {overflowActive ? (
              <>
                {(() => {
                  const ActiveIcon = NOTE_VIEW_META[view].icon;
                  return <ActiveIcon aria-hidden className="text-primary-text size-3.5" />;
                })()}
                <span>{NOTE_VIEW_META[view].label}</span>
              </>
            ) : (
              <span>More</span>
            )}
            <ChevronDown
              aria-hidden
              data-icon="inline-end"
              className="text-muted-foreground size-3"
            />
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent
          align="end"
          finalFocus={(closedBy) => closedBy === "keyboard"}
          font="md"
          className="w-auto min-w-44"
        >
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
              <DropdownMenuSeparator className="upright:block hidden" />
              {(() => {
                const { label, icon: Icon, tip } = NOTE_VIEW_META.gallery;
                return (
                  <DropdownMenuRadioItem
                    key="gallery"
                    value="gallery"
                    title={tip}
                    closeOnClick
                    className="upright:flex hidden"
                  >
                    <span className="flex items-center gap-2">
                      <Icon aria-hidden className="text-label size-3.5" />
                      <span>{label}</span>
                    </span>
                  </DropdownMenuRadioItem>
                );
              })()}
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
  counts: { all: number; check: number; open: number; done: number; asking?: number };
  onChange: (next: NoteStatusFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter notes by status"
      className="scroll-fade-x bg-backdrop/90 border-hairline flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-lg border p-0.5"
    >
      {STATUS_FILTERS.map((sf) => {
        const active = status === sf.id;
        const nCount = sf.id === "asking" ? (counts.asking ?? 0) : counts[sf.id];
        return (
          <button
            key={sf.id}
            type="button"
            data-status-filter={sf.id}
            aria-pressed={active}
            onClick={() => onChange(sf.id)}
            className={cn(
              "focus-visible:ring-ring studio-press flex min-h-6 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none @[400px]:flex-1 pointer-coarse:min-h-10",
              active
                ? ACTIVE_STATUS_STYLE[sf.id]
                : "text-label hover:text-foreground hover:bg-surface-subtle ring-1 ring-transparent",
            )}
          >
            {sf.id !== "all" && (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full transition-opacity motion-reduce:transition-none",
                  sf.id === "check"
                    ? "bg-warn"
                    : sf.id === "asking"
                      ? "bg-ai"
                      : sf.id === "open"
                        ? "bg-primary"
                        : "bg-ok",
                  !active && nCount === 0 && "opacity-45",
                )}
              />
            )}
            <span className="truncate">{sf.label}</span>
            <span
              className={cn(
                "font-mono tabular-nums",
                active
                  ? "font-semibold text-current opacity-90"
                  : sf.id === "check" && nCount > 0
                    ? "text-warn-text font-semibold"
                    : sf.id === "asking" && nCount > 0
                      ? "text-ai-text font-semibold"
                      : sf.id === "open" && nCount > 0
                        ? "text-primary-text font-semibold"
                        : sf.id === "done" && nCount > 0
                          ? "text-ok-text/85 font-medium"
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
    composeNew = useStudio((s) => s.compose?.kind === "create"),
    q = useStudio((s) => s.noteSearch),
    status = useStudio((s) => s.noteStatus),
    scope = useStudio((s) => s.noteScope),
    shot = useStudio((s) => s.noteShot),
    facets = useStudio((s) => s.noteFacets),
    sort = useStudio((s) => s.noteSort);
  useStudio((s) => (s.noteScope === "shot" ? s.shot : "")); // "In current shot" follows the playhead from shot to shot
  const [doneOpen, setDoneOpen] = useState(false);
  const [crampedOverlay, setCrampedOverlay] = useState(false);
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
  const readyCheck = useMemo(() => check.filter((p) => !isNoteAsking(p.n, "check")), [check]);
  const askNotes = useMemo(() => check.filter((p) => isNoteAsking(p.n, "check")), [check]);
  const ixReadyCheck = useMemo(
    () => ix.check.filter((p) => !isNoteAsking(p.n, "check")),
    [ix.check],
  );
  const ixAskNotes = useMemo(() => ix.check.filter((p) => isNoteAsking(p.n, "check")), [ix.check]);

  const rows = useMemo(() => {
    if (status === "check") {
      return readyCheck.length
        ? (readyCheck.map((p): Row => ({ key: p.n.id, kind: "check", p })) as Row[])
        : ([{ key: "none", kind: "none" }] as Row[]);
    }
    if (status === "asking") {
      return askNotes.length
        ? (askNotes.map((p): Row => ({ key: p.n.id, kind: "asking", p })) as Row[])
        : ([{ key: "none", kind: "none" }] as Row[]);
    }
    if (status === "open") {
      return open.length
        ? (open.map((p): Row => ({ key: p.n.id, kind: "open", p })) as Row[])
        : ([{ key: "none", kind: "none" }] as Row[]);
    }
    if (status === "done") {
      return done.length
        ? (done.map((p): Row => ({ key: p.n.id, kind: "done", p })) as Row[])
        : ([{ key: "noneDone", kind: "noneDone" }] as Row[]);
    }
    const r: Row[] = [];
    if (readyCheck.length) {
      r.push(
        { key: "checkHead", kind: "checkHead" },
        ...readyCheck.map((p): Row => ({ key: p.n.id, kind: "check", p })),
      );
    }
    if (askNotes.length) {
      r.push(
        { key: "askHead", kind: "askHead" },
        ...askNotes.map((p): Row => ({ key: p.n.id, kind: "asking", p })),
      );
    }
    if (open.length) {
      r.push(
        { key: "openHead", kind: "openHead" },
        ...open.map((p): Row => ({ key: p.n.id, kind: "open", p })),
      );
    } else if (!readyCheck.length && !askNotes.length) {
      r.push({ key: "none", kind: "none" });
    }
    if (notes.length && (!narrowed || done.length > 0)) {
      r.push({ key: "fold", kind: "fold" });
      if (doneOpen)
        r.push(
          ...(done.length
            ? done.map((p): Row => ({ key: p.n.id, kind: "done", p }))
            : [{ key: "noneDone", kind: "noneDone" } as Row]),
        );
    }
    return r;
  }, [status, open, readyCheck, askNotes, done, doneOpen, narrowed, notes.length]);
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
        asking: 168,
        askHead: 28,
        checkHead: 28,
        openHead: 28,
      })[rows[i].kind as string] ?? 116,
  });

  const didMount = useRef(false);
  const lastNear = useRef<string | null>(null);
  const lastNearRow = useRef<number | null>(null);
  const lastTime = useRef(0);

  useEffect(() => {
    const curT = S.t;
    const i = rowOf.get(nearNote ?? "");
    if (!didMount.current) {
      didMount.current = true;
      lastNear.current = nearNote ?? null;
      lastNearRow.current = i ?? null;
      lastTime.current = curT;
      return;
    }
    const timeMoved = Math.abs(curT - lastTime.current) > 0.01;
    lastTime.current = curT;
    const prevNear = lastNear.current;
    const prevRow = lastNearRow.current;
    lastNear.current = nearNote ?? null;
    lastNearRow.current = i ?? null;
    const box = list.current;
    if (
      (prevNear === (nearNote ?? null) && prevRow === (i ?? null)) ||
      !box ||
      i === undefined ||
      (!timeMoved && prevNear === null) ||
      (!timeMoved && prevRow === (i ?? null) && i > 2) ||
      sort !== "film" ||
      editing ||
      performance.now() - touched.current < HOLD_LIST
    )
      return;
    const targetIdx = i <= 2 ? 0 : i;
    if (targetIdx === 0) {
      box.scrollTop = 0;
      return;
    }
    const align = "auto";
    const to = v.getOffsetForIndex(targetIdx, align)?.[0] ?? box.scrollTop;
    v.scrollToIndex(targetIdx, {
      align,
      behavior: prefersReduced() || Math.abs(to - box.scrollTop) > 500 ? "auto" : "smooth",
    }); // a long way is a jump, not a slide past everything
  }, [nearNote, editing, sort, rowOf, v]);

  const count = (shownHere: Placed[], all: Placed[]) =>
    narrowed ? `${shownHere.length} of ${all.length}` : all.length;
  const totalShown = check.length + open.length + done.length;
  const statusCounts: Record<NoteStatusFilter, number> & { asking: number } = {
    all: totalShown,
    check: readyCheck.length,
    asking: askNotes.length,
    open: open.length,
    done: done.length,
  };

  const row = (r: Row): ReactNode => {
    if (r.kind === "open")
      return <NoteCard p={r.p} near={r.p.n.id === nearNote} editing={r.p.n.id === editing} />;
    if (r.kind === "done") return <DoneCard p={r.p} />;
    if (r.kind === "check" || r.kind === "asking") return <CheckCard p={r.p} />;
    if (r.kind === "askHead")
      return (
        <h3 className="text-ai-text flex h-7 items-center gap-1.5 px-0.5 text-sm font-semibold text-balance tabular-nums">
          <NoteStatusGlyph state="check" asking />
          <span>AI asks</span>
          <span className="text-label/75 text-ui font-mono font-medium tabular-nums">
            {count(askNotes, ixAskNotes)}
          </span>
        </h3>
      );
    if (r.kind === "checkHead")
      return (
        <h3 className="text-warn-text flex h-7 items-center gap-1.5 px-0.5 text-sm font-semibold text-balance tabular-nums">
          <NoteStatusGlyph state="check" />
          <span>To check</span>
          <span className="text-label/75 text-ui font-mono font-medium tabular-nums">
            {count(readyCheck, ixReadyCheck)}
          </span>
        </h3>
      );
    if (r.kind === "openHead")
      return (
        <h3 className="text-primary-text flex h-7 items-center gap-1.5 px-0.5 text-sm font-semibold text-balance tabular-nums">
          <NoteStatusGlyph state="open" />
          <span>To fix</span>
          <span className="text-label/75 text-ui font-mono font-medium tabular-nums">
            {count(open, ix.open)}
          </span>
        </h3>
      );
    if (r.kind === "none") {
      if (anyFiltered && notes.length > 0)
        return (
          <Empty>
            {status === "check"
              ? narrowed
                ? "Nothing waiting to check matching filters."
                : "Nothing waiting to check."
              : status === "asking"
                ? narrowed
                  ? "No AI questions matching filters."
                  : "No AI questions waiting."
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
        data-tone="done"
        data-ai-lit={(!doneOpen && doneLit) || undefined}
        onClick={() => setDoneOpen(!doneOpen)}
        className="text-label hover:text-foreground focus-visible:ring-ring border-hairline-subtle bg-surface-subtle hover:bg-hairline mt-1 flex min-h-8.5 w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-sm font-semibold transition-colors duration-150 outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-10"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 duration-150 motion-safe:transition-transform motion-reduce:transition-none",
            doneOpen && "rotate-90",
          )}
        />
        <NoteStatusGlyph state="done" />
        <span>Done</span>
        <span className="text-label/75 text-ui font-mono font-medium tabular-nums">
          {narrowed ? `${done.length} of ${ix.done.length}` : ix.done.length}
        </span>
        {!doneOpen && doneLearnedCount > 0 && (
          <span className="text-ok-text text-xs font-medium">· {doneLearnedCount} learned</span>
        )}
      </button>
    );
  };

  return (
    <section
      aria-label="Notes"
      className="font-md @container relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <div
        inert={crampedOverlay || undefined}
        aria-hidden={crampedOverlay || undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="upright:px-2.5 upright:py-1 sideways:py-1 flex flex-none flex-wrap items-center gap-1.5 px-3 pt-2 pb-1">
          <h2 className="text-title upright:h-6 flex h-7 shrink-0 items-center px-0.5 font-semibold text-balance whitespace-nowrap tabular-nums">
            <span>Notes</span>
            {notes.length > 0 && (
              <span className="text-label text-ui ms-1.5 font-mono font-medium tabular-nums">
                ({notes.length})
              </span>
            )}
          </h2>
          {!PHONE && (
            <Tip label="Add a note at the playhead (M)">
              <Button
                variant={composeNew ? "lit" : notes.length === 0 ? "default" : "subtle"}
                size="sm"
                aria-label="New note"
                aria-pressed={composeNew}
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
                variant={check.length > 0 ? "approve" : "subtle"}
                size="sm"
                aria-label={
                  narrowed && check.length !== ix.check.length
                    ? `Review room, ${check.length} of ${ix.check.length} to check match filters`
                    : `Review room${ix.check.length ? `, ${ix.check.length} to check` : ""}`
                }
                onClick={(e) => setReview(true, e.currentTarget)}
              >
                <ClipboardCheck aria-hidden data-icon="inline-start" />
                Review
                {ix.check.length > 0 && (
                  <span
                    aria-hidden
                    className={cn(
                      "bg-background/70 ms-0.5 rounded-full px-1.5 text-xs leading-4 font-semibold tabular-nums ring-1",
                      check.length > 0
                        ? "text-warn-text ring-warn/50"
                        : "text-label ring-hairline-strong",
                    )}
                  >
                    {narrowed && check.length !== ix.check.length
                      ? `${check.length}/${ix.check.length}`
                      : ix.check.length}
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
          <div className="upright:gap-1 upright:px-2.5 upright:pb-1 flex flex-none flex-col gap-1.5 px-3 pb-1.5">
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
                placeholder="Search #id, note…"
                className="min-w-0 flex-1"
              />
              <FilterMenu allItems={allRawItems} />
              <SortMenu fixedReason={SORT_FIXED_REASON[view]} />
            </div>

            <ActiveFilterChips includeSearch shotOptions={shotOptions} />
          </div>
        )}

        <TabStage
          activeKey={notes.length === 0 ? "cards" : view}
          order={NOTE_VIEWS}
          className="border-hairline-subtle flex min-h-0 flex-1 flex-col border-t pt-2"
        >
          {view === "cards" || notes.length === 0 ? (
            <div
              ref={list}
              data-arrow-scroll
              className="scroll-fade min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-6"
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
          ) : allItems.length === 0 && (view !== "board" || anyFiltered) ? (
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
      </div>
      {composeDock && <Compose dock onCrampedOverlayChange={setCrampedOverlay} />}
    </section>
  );
}
