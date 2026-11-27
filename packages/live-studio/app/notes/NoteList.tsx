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
  Loader2,
  type LucideIcon,
  MessagesSquare,
  Pencil,
  Plus,
  RotateCcw,
  Table2,
  Trash2,
} from "lucide-react";
import {
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  INITIAL_VIRTUAL_RECT,
  measureVirtualElement,
  observeVirtualRect,
  scrollVirtualElement,
} from "@/components/virtual-utils";
import { cn } from "@/lib/utils";

import { useLit, useLitAny } from "../activity/activity";
import { type SaveState, SaveStatus } from "../components/inspector";
import { prefersReduced } from "../components/Motion";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { PHONE, useUpright } from "../core/device";
import { S } from "../core/state";
import { set, setPref, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { reloadNow } from "../playback/transport";
import { Compose } from "./Compose";
import { useExitedNotes, useNoteMotion } from "./note-action-motion";
import { noteActionTarget, noteShotTitle } from "./note-card-meta";
import {
  ActiveFilterChips,
  CheckActions,
  Empty,
  ExpandableNoteText,
  InlineFeedbackBox,
  NoteCardHeader,
  NoteDoneActions,
  NoteExitSlot,
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
  type NoteView,
  PRIMARY_NOTE_VIEWS,
} from "./note-views-model";
const loadNoteViews = () => import("./LazyNoteViews");
const NoteBoardView = lazy(() => loadNoteViews().then((m) => ({ default: m.NoteBoardView })));
const NoteGalleryView = lazy(() => loadNoteViews().then((m) => ({ default: m.NoteGalleryView })));
const NoteListView = lazy(() => loadNoteViews().then((m) => ({ default: m.NoteListView })));
const NoteTableView = lazy(() => loadNoteViews().then((m) => ({ default: m.NoteTableView })));
const NoteCalendarView = lazy(() => loadNoteViews().then((m) => ({ default: m.NoteCalendarView })));
const NoteChartView = lazy(() => loadNoteViews().then((m) => ({ default: m.NoteChartView })));
const NoteFeedView = lazy(() =>
  import("./NoteInsightViews").then((m) => ({ default: m.NoteFeedView })),
);
const NoteTimelineView = lazy(() =>
  import("./NoteInsightViews").then((m) => ({ default: m.NoteTimelineView })),
);
import {
  clearNoteFilters,
  editOldNote,
  noteNum,
  openNote,
  originOf,
  type Placed,
  removeNote,
  reopenNote,
  setReview,
  shownNotes,
} from "./notes";
import { type NoteFacet, type NoteScope, type NoteSort, type NoteStatusFilter } from "./slice";

const HOLD_LIST = 4000;
const EMPTY_FACETS: NoteFacet[] = [];
const rowKey = (row: Row) => row.key;

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

function DenseNoteBody({
  note,
  t,
  shotFull,
  clampLines,
  showOpenButton = false,
  openLabel,
  openTitle,
  onOpen,
  muted,
  actions,
}: {
  note: Placed["n"];
  t: number;
  shotFull: string;
  clampLines: 1 | 2;
  showOpenButton?: boolean;
  openLabel: string;
  openTitle?: string;
  onOpen: (el: HTMLElement) => void;
  muted?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <ExpandableNoteText
          text={note.text}
          dense
          showOpenButton={showOpenButton}
          clampLines={clampLines}
          openLabel={openLabel}
          openTitle={openTitle}
          onOpen={onOpen}
        />
        <NoteTags note={note} dense />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 empty:hidden">
        <NoteThumb note={note} t={t} shotFull={shotFull} size="sm" dense muted={muted} />
        {actions}
      </div>
    </div>
  );
}

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
  const target = noteActionTarget(noteNum(n.id), timeText);
  const lit = useLit(`note:${n.id}`);
  const needsWork = isCreatorNeedsWork(n, "open");
  const { ref: cardRef, noteAttr } = useNoteMotion<HTMLElement>(n.id, "open");
  return (
    <article
      ref={cardRef}
      data-note={noteAttr}
      data-tone="open"
      data-ai-lit={lit || undefined}
      className={noteSurfaceClass("open", { near, editing, dense: PHONE })}
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
        dense={PHONE}
      />
      {PHONE ? (
        <>
          <DenseNoteBody
            note={n}
            t={t}
            shotFull={shotTitle.full}
            clampLines={2}
            openLabel={`Edit note ${target}: ${n.text || "no words"}`}
            onOpen={(el) => editOldNote(n, originOf(el))}
            actions={
              <>
                <Button
                  variant="subtle"
                  size="phone-icon"
                  aria-label={`Edit note ${target}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    editOldNote(n, originOf(e.currentTarget));
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="remove"
                  size="phone-icon"
                  aria-label={`Delete note ${target}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeNote(n);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </>
            }
          />
          <NoteFollowups note={n} state="open" compact />
        </>
      ) : (
        <>
          <div className="mt-1.5 flex items-start gap-2.5">
            <div className="min-w-0 flex-1">
              <ExpandableNoteText
                text={n.text}
                clampLines={3}
                openLabel={`Edit note ${target}: ${n.text || "no words"}`}
                onOpen={(el) => editOldNote(n, originOf(el))}
              />
              <NoteTags note={n} />
            </div>
            <NoteThumb note={n} t={t} shotFull={shotTitle.full} />
          </div>
          <NoteFollowups note={n} state="open" />
          <NoteOpenActions note={n} t={t} />
        </>
      )}
    </article>
  );
});

const DoneCard = memo(function DoneCard({ p: { n, t } }: { p: Placed }) {
  const shotTitle = noteShotTitle(n.shot, n.shotName);
  const timeText = stamp(t);
  const target = noteActionTarget(noteNum(n.id), timeText);
  const lit = useLit(`note:${n.id}`);
  const { ref: cardRef, noteAttr } = useNoteMotion<HTMLElement>(n.id, "done");
  return (
    <article
      ref={cardRef}
      data-note={noteAttr}
      data-tone="done"
      data-ai-lit={lit || undefined}
      className={noteSurfaceClass("done", { dense: PHONE })}
    >
      <NoteCardHeader
        note={n}
        t={t}
        state="done"
        shotPrimary={shotTitle.primary}
        shotSecondary={shotTitle.secondary}
        shotFull={shotTitle.full}
        lit={lit}
        dense={PHONE}
      />
      {PHONE ? (
        <>
          <DenseNoteBody
            note={n}
            t={t}
            shotFull={shotTitle.full}
            clampLines={1}
            showOpenButton
            muted
            openLabel={`Jump to ${target}: ${n.text || "no words"}`}
            openTitle="Jump to frame"
            onOpen={(el) => openNoteRow(n, "done", el)}
            actions={
              <>
                <Button
                  variant="subtle"
                  size="phone-icon"
                  aria-label={`Edit note ${target}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    editOldNote(n, originOf(e.currentTarget));
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="subtle"
                  size="phone-icon"
                  aria-label={`Reopen note ${target}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    reopenNote(n);
                  }}
                >
                  <RotateCcw aria-hidden />
                </Button>
              </>
            }
          />
          <NoteFollowups note={n} state="done" compact />
        </>
      ) : (
        <>
          <div className="mt-1.5 flex items-start gap-2.5">
            <div className="min-w-0 flex-1">
              <ExpandableNoteText
                text={n.text}
                clampLines={2}
                openLabel={`Open note ${target}: ${n.text || "no words"}`}
                onOpen={(el) => openNoteRow(n, "done", el)}
              />
              <NoteTags note={n} />
            </div>
            <NoteThumb note={n} t={t} shotFull={shotTitle.full} muted />
          </div>
          <NoteFollowups note={n} state="done" />
          <NoteDoneActions note={n} t={t} approved={n.approved} />
        </>
      )}
    </article>
  );
});

const CheckCard = memo(function CheckCard({ p: { n, t } }: { p: Placed }) {
  const shotTitle = noteShotTitle(n.shot, n.shotName);
  const timeText = stamp(t);
  const target = noteActionTarget(noteNum(n.id), timeText);
  const lit = useLit(`note:${n.id}`);
  const fix = n.fixes?.at(-1);
  const [replying, setReplying] = useState(false);
  const { ref: cardRef, noteAttr } = useNoteMotion<HTMLElement>(n.id, "check");
  return (
    <article
      ref={cardRef}
      data-note={noteAttr}
      data-tone={fix?.ask ? "ai" : "check"}
      data-ai-lit={lit || undefined}
      className={noteSurfaceClass("check", { asking: !!fix?.ask, dense: PHONE })}
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
        dense={PHONE}
      />
      {PHONE ? (
        <DenseNoteBody
          note={n}
          t={t}
          shotFull={shotTitle.full}
          clampLines={2}
          showOpenButton
          openLabel={`Jump to ${target}: ${n.text || "no words"}`}
          openTitle="Jump to frame"
          onOpen={(el) => openNoteRow(n, "check", el)}
        />
      ) : (
        <div className="mt-1.5 flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <ExpandableNoteText
              text={n.text}
              clampLines={3}
              openLabel={`Open note ${target}: ${n.text || "no words"}`}
              onOpen={(el) => openNoteRow(n, "check", el)}
            />
            <NoteTags note={n} />
          </div>
          <NoteThumb note={n} t={t} shotFull={shotTitle.full} />
        </div>
      )}
      <NoteFollowups note={n} state="check" compact={PHONE} />
      <CheckActions
        note={n}
        ask={!!fix?.ask}
        replying={replying}
        onToggleReply={() => setReplying((r) => !r)}
        dense={PHONE}
        showEdit
      />
      {replying && (
        <InlineFeedbackBox
          note={n}
          ask={!!fix?.ask}
          showQuestion={PHONE}
          onDone={() => setReplying(false)}
        />
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
          <span className="hidden @[336px]:inline">Filter</span>
          {activeCount > 0 && <Badge variant="count">{activeCount}</Badge>}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent
        motion="none"
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
            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span>
                    {shot !== null
                      ? `Shot: ${shotOptions.find((s) => s.shot === shot)?.label ?? `Shot ${shot}`}`
                      : "Filter by shot"}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  motion="none"
                  font="md"
                  className="max-h-72 overflow-y-auto overscroll-contain"
                >
                  <DropdownMenuRadioGroup
                    value={shot === null ? "all" : String(shot)}
                    onValueChange={(v) => set({ noteShot: v === "all" ? null : Number(v) })}
                  >
                    <DropdownMenuRadioItem value="all">
                      <span className="tabular-nums">All shots ({allItems.length})</span>
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
            </DropdownMenuGroup>
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
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => set({ noteScope: "all", noteShot: null, noteFacets: [] })}
              >
                Reset filters
              </DropdownMenuItem>
            </DropdownMenuGroup>
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
          <span className="hidden @[336px]:inline">{active.title}</span>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent
        motion="none"
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

const PHONE_ROW_HEIGHT: Partial<Record<Row["kind"], number>> = {
  done: 58,
  check: 100,
  asking: 100,
  fold: 30,
  askHead: 22,
  checkHead: 22,
  openHead: 22,
};

const DESKTOP_ROW_HEIGHT: Partial<Record<Row["kind"], number>> = {
  done: 146,
  check: 168,
  asking: 168,
  askHead: 28,
  checkHead: 28,
  openHead: 28,
};

const STATUS_FILTERS: { id: NoteStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "check", label: "To check" },
  { id: "asking", label: "AI asks" },
  { id: "open", label: "To fix" },
  { id: "done", label: "Done" },
];

const STATUS_TOGGLE_VARIANT: Record<
  NoteStatusFilter,
  "status-all" | "status-check" | "status-asking" | "status-open" | "status-done"
> = {
  all: "status-all",
  check: "status-check",
  asking: "status-asking",
  open: "status-open",
  done: "status-done",
};

const GROUP_HEAD = {
  askHead: {
    label: "AI asks",
    tone: "text-ai-text",
    state: "check" as const,
    asking: true,
  },
  checkHead: {
    label: "To check",
    tone: "text-warn-text",
    state: "check" as const,
    asking: false,
  },
  openHead: {
    label: "To fix",
    tone: "text-primary-text",
    state: "open" as const,
    asking: false,
  },
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
  const choices = [...PRIMARY_NOTE_VIEWS, ...EXTRA_NOTE_VIEWS];
  return (
    <div className="@container/note-views w-full">
      <div className="@[344px]/note-views:hidden">
        <Select
          value={view}
          items={choices.map((id) => ({ value: id, label: NOTE_VIEW_META[id].label }))}
          onValueChange={(value) => {
            if (value !== null) onChange(value);
          }}
        >
          <SelectTrigger aria-label="Notes view" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" finalFocus>
            <SelectGroup>
              {choices.map((id) => {
                const { label, icon: Icon } = NOTE_VIEW_META[id];
                return (
                  <SelectItem key={id} value={id}>
                    <Icon aria-hidden className="text-primary-text" />
                    {label}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="bg-backdrop/90 border-hairline hidden w-fit max-w-full items-center gap-0.5 rounded-lg border p-0.5 @[344px]/note-views:flex">
        <div className="scroll-fade-x min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto overscroll-x-contain">
          <ToggleGroup
            value={overflowActive ? [] : [view]}
            onValueChange={(v) => {
              const next = PRIMARY_NOTE_VIEWS.find((id) => id === v[0]);
              if (next) onChange(next);
            }}
            aria-label="Notes layout view"
            variant="pick"
            spacing={0.5}
            className="min-w-fit"
          >
            {PRIMARY_NOTE_VIEWS.map((id) => {
              const { label, icon: Icon, tip } = NOTE_VIEW_META[id];
              return (
                <Tip key={id} label={tip} side="bottom">
                  <ToggleGroupItem
                    value={id}
                    data-note-view-tab={id}
                    className={id === "gallery" ? "upright:hidden" : undefined}
                  >
                    <Icon aria-hidden className="hidden size-3.5 @md:block" />
                    <span>{label}</span>
                  </ToggleGroupItem>
                </Tip>
              );
            })}
          </ToggleGroup>
        </div>
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
                  className="w-28 shrink-0 justify-between"
                />
              }
            >
              {overflowActive ? (
                <>
                  {(() => {
                    const ActiveIcon = NOTE_VIEW_META[view].icon;
                    return (
                      <ActiveIcon
                        aria-hidden
                        data-icon="inline-start"
                        className="text-primary-text"
                      />
                    );
                  })()}
                  <span>{NOTE_VIEW_META[view].label}</span>
                </>
              ) : (
                <span>More</span>
              )}
              <ChevronDown aria-hidden data-icon="inline-end" className="text-muted-foreground" />
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent
            motion="none"
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
                        <Icon aria-hidden className="text-label" />
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
                        <Icon aria-hidden className="text-label" />
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
    <ToggleGroup
      variant="strip"
      spacing={0.5}
      aria-label="Filter notes by status"
      value={[status]}
      onValueChange={(next) => {
        const picked = next[0] as NoteStatusFilter | undefined;
        if (picked) onChange(picked);
      }}
    >
      {STATUS_FILTERS.map((sf) => {
        const active = status === sf.id;
        const nCount = sf.id === "asking" ? (counts.asking ?? 0) : counts[sf.id];
        return (
          <ToggleGroupItem
            key={sf.id}
            value={sf.id}
            variant={STATUS_TOGGLE_VARIANT[sf.id]}
            size="strip"
            data-status-filter={sf.id}
          >
            {sf.id !== "all" && (
              <span
                aria-hidden
                className={cn(
                  "hidden size-1.5 shrink-0 rounded-full transition-opacity motion-reduce:transition-none @[380px]:inline-block",
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
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

function PhoneHeaderStatus({ saved, idleText }: { saved: SaveState; idleText: string }) {
  const newBuild = useStudio((s) => s.newBuild);
  const loading = useStudio((s) => s.loading);
  const status = useStudio((s) => s.status);
  const contract = useStudio((s) => s.contract.length);

  const reloadPill = newBuild ? (
    <button
      type="button"
      onClick={reloadNow}
      className="bg-accent text-accent-foreground focus-visible:ring-ring inline-flex min-h-7 shrink-0 cursor-pointer items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2"
    >
      New version · Reload
    </button>
  ) : null;

  const liveNotice = loading ? (
    <span
      role="status"
      className="text-muted-foreground inline-flex min-w-0 items-center gap-1 text-xs"
    >
      <Loader2 className="size-3 shrink-0 motion-safe:animate-spin" aria-hidden />
      <span className="truncate">{loading}</span>
    </span>
  ) : status ? (
    <span role="status" className="text-muted-foreground min-w-0 truncate text-xs">
      {status}
    </span>
  ) : contract > 0 ? (
    <span
      role="status"
      className="bg-warn-bg text-warn-text rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap"
    >
      {contract} {contract === 1 ? "issue" : "issues"}
    </span>
  ) : null;

  const saveNotice = (
    <SaveStatus
      state={saved}
      idleTone="ok"
      idleText={idleText}
      failText="Not sent. Retrying…"
      className={saved === "fail" ? "whitespace-normal" : "whitespace-nowrap"}
    />
  );

  return (
    <div className="ms-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1.5 text-end">
      {reloadPill}
      {saved === "busy" || saved === "fail" ? (
        <>
          {liveNotice}
          {saveNotice}
        </>
      ) : (
        (liveNotice ?? (newBuild ? null : saveNotice))
      )}
    </div>
  );
}

export function NoteList({ composeDock = false }: { composeDock?: boolean }) {
  const notes = useStudio((s) => s.notes),
    saved = useStudio((s) => s.saved),
    nearNote = useStudio((s) => s.nearNote),
    rawView = useStudio((s) => s.noteView);
  const editing = useStudio((s) =>
      s.composeState.status === "edit-editing" || s.composeState.status === "edit-saving"
        ? s.composeState.compose.id
        : undefined,
    ),
    composeNew = useStudio(
      (s) =>
        s.composeState.status === "create-editing" || s.composeState.status === "create-saving",
    ),
    rawQ = useStudio((s) => s.noteSearch),
    rawStatus = useStudio((s) => s.noteStatus),
    rawScope = useStudio((s) => s.noteScope),
    rawShot = useStudio((s) => s.noteShot),
    rawFacets = useStudio((s) => s.noteFacets),
    rawSort = useStudio((s) => s.noteSort);
  const view: NoteView = PHONE ? "cards" : rawView,
    q = PHONE ? "" : rawQ,
    status: NoteStatusFilter = PHONE ? "all" : rawStatus,
    scope: NoteScope = PHONE ? "all" : rawScope,
    shot = PHONE ? null : rawShot,
    facets = PHONE ? EMPTY_FACETS : rawFacets,
    sort: NoteSort = PHONE ? "film" : rawSort;
  useStudio((s) => (!PHONE && s.noteScope === "shot" ? s.shot : ""));
  const [doneOpen, setDoneOpen] = useState(false);
  const [crampedOverlay, setCrampedOverlay] = useState(false);
  const controls = useRef<HTMLDivElement>(null);
  const clearSearch = () => {
    set({ noteSearch: "" });
    controls.current?.querySelector<HTMLInputElement>('input[name="note-search"]')?.focus();
  };
  const list = useRef<HTMLDivElement>(null),
    touched = useRef(-1e9),
    focused = useRef<string | null>(null);
  const filtered = shownNotes(),
    ix = filtered.ix,
    open = PHONE ? ix.open : filtered.open,
    check = PHONE ? ix.check : filtered.check,
    done = PHONE ? ix.done : filtered.done,
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
  const displayRows = useExitedNotes(
    rows,
    rowKey,
    `${view}|${status}|${scope}|${shot ?? ""}|${facets.join(",")}|${sort}|${q}|${doneOpen ? 1 : 0}`,
    true,
  );
  const rowOf = useMemo(
    () => new Map(displayRows.flatMap((r, i) => (r.exiting ? [] : [[r.key, i]]))),
    [displayRows],
  );

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
  const getItemKey = useCallback((i: number) => displayRows[i].key, [displayRows]);
  const v = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => list.current,
    getItemKey,
    rangeExtractor,
    gap: PHONE ? 5 : 8,
    overscan: 6,
    initialRect: INITIAL_VIRTUAL_RECT,
    observeElementRect: observeVirtualRect,
    measureElement: measureVirtualElement,
    scrollToFn: scrollVirtualElement,
    useFlushSync: false,
    estimateSize: (i) =>
      (PHONE ? PHONE_ROW_HEIGHT : DESKTOP_ROW_HEIGHT)[displayRows[i].item.kind] ??
      (PHONE ? 64 : 116),
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
    });
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
    if (r.kind === "askHead" || r.kind === "checkHead" || r.kind === "openHead") {
      const h = GROUP_HEAD[r.kind];
      const nCount =
        r.kind === "askHead"
          ? count(askNotes, ixAskNotes)
          : r.kind === "checkHead"
            ? count(readyCheck, ixReadyCheck)
            : count(open, ix.open);
      return (
        <h3
          className={cn(
            "flex items-center gap-1.5 px-0.5 font-semibold text-balance tabular-nums",
            PHONE ? "h-5.5 text-xs" : "min-h-7 text-base",
            "leading-tight",
            h.tone,
          )}
        >
          <NoteStatusGlyph state={h.state} asking={h.asking} />
          <span>{h.label}</span>
          <span
            className={cn(
              "text-muted-foreground font-mono font-medium tabular-nums",
              PHONE ? "text-tag" : "text-ui",
            )}
          >
            {nCount}
          </span>
        </h3>
      );
    }
    if (r.kind === "none") {
      if (anyFiltered && notes.length > 0)
        return (
          <Empty>
            {q.trim() ? (
              <>No notes match “{q.trim()}”.</>
            ) : status === "check" ? (
              narrowed ? (
                "Nothing waiting to check matching filters."
              ) : (
                "Nothing waiting to check."
              )
            ) : status === "asking" ? (
              narrowed ? (
                "No AI questions matching filters."
              ) : (
                "No AI questions waiting."
              )
            ) : (
              "No notes match your filters."
            )}{" "}
            <Button
              variant="link"
              size="inline"
              onClick={q.trim() ? clearSearch : clearNoteFilters}
            >
              {q.trim() ? "Clear search" : "Reset filters"}
            </Button>
          </Empty>
        );
      return (
        <Empty>
          {ix.done.length
            ? "Nothing left to fix"
            : PHONE
              ? "No notes yet. Tap the picture or Note to add one"
              : "No notes yet. Select New note or press M."}
        </Empty>
      );
    }
    if (r.kind === "noneDone")
      return (
        <Empty>
          {anyFiltered && ix.done.length ? (
            <>
              No approved notes match.{" "}
              <Button variant="link" size="inline" onClick={clearNoteFilters}>
                Reset filters
              </Button>
            </>
          ) : (
            "Notes you approve land here."
          )}
        </Empty>
      );
    return (
      <h3 className={PHONE ? "mt-0.5" : "mt-1"}>
        <button
          type="button"
          aria-expanded={doneOpen}
          data-tone="done"
          data-ai-lit={(!doneOpen && doneLit) || undefined}
          onClick={() => setDoneOpen(!doneOpen)}
          className={cn(
            "text-label hover:text-foreground focus-visible:ring-ring border-hairline-subtle bg-surface-subtle hover:bg-hairline flex w-full cursor-pointer items-center border font-semibold transition-colors duration-150 outline-none focus-visible:ring-2 motion-reduce:transition-none",
            PHONE
              ? "min-h-7.5 gap-1.5 rounded-md px-2 text-xs"
              : "min-h-8.5 gap-2 rounded-lg px-2.5 text-base pointer-coarse:min-h-10",
            "leading-tight",
          )}
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
          <span
            className={cn(
              "text-muted-foreground font-mono font-medium tabular-nums",
              PHONE ? "text-tag" : "text-ui",
            )}
          >
            {narrowed ? `${done.length} of ${ix.done.length}` : ix.done.length}
          </span>
          {!doneOpen && doneLearnedCount > 0 && (
            <span className="text-ok-text text-xs font-medium">· {doneLearnedCount} learned</span>
          )}
        </button>
      </h3>
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
        <div
          ref={controls}
          role="group"
          aria-label="Note controls"
          className="mx-auto max-h-[50%] w-full max-w-4xl flex-none overflow-y-auto overscroll-contain"
        >
          <div
            className={cn(
              "upright:px-2.5 upright:py-1 sideways:py-1 flex flex-none flex-wrap items-center gap-1.5",
              PHONE ? "px-2.5 pt-1 pb-0.5" : "px-3 pt-2 pb-1",
            )}
          >
            <h2
              className={cn(
                "flex shrink-0 items-center px-0.5 font-semibold tracking-tight text-balance whitespace-nowrap tabular-nums",
                PHONE ? "min-h-5 text-sm" : "upright:min-h-6 min-h-7 text-lg",
                "leading-tight",
              )}
            >
              <span>Notes</span>
              {notes.length > 0 && (
                <span
                  className={cn(
                    "text-label font-mono font-medium tabular-nums",
                    PHONE ? "ms-1 text-xs" : "text-ui ms-1.5",
                  )}
                >
                  ({notes.length})
                </span>
              )}
            </h2>
            {!PHONE && (
              <Tip label="Add a note at the playhead (M)">
                <Button
                  variant={composeNew ? "lit" : notes.length === 0 ? "default" : "subtle"}
                  size="md"
                  aria-label="New note"
                  aria-pressed={composeNew}
                  onClick={(e) => openNote(null, true, originOf(e.currentTarget))}
                >
                  <Plus aria-hidden data-icon="inline-start" />
                  New note
                </Button>
              </Tip>
            )}
            {!PHONE && ix.check.length + ix.open.length + ix.done.length > 0 && (
              <Tip label="Review notes (N)">
                <Button
                  variant={check.length > 0 ? "approve" : "subtle"}
                  size="md"
                  aria-label={
                    narrowed && check.length !== ix.check.length
                      ? `Review room, ${check.length} of ${ix.check.length} pending notes match filters`
                      : `Review room${ix.check.length ? `, ${ix.check.length} ${ix.check.length === 1 ? "note awaits" : "notes await"} your response` : ""}`
                  }
                  onClick={(e) => setReview(true, e.currentTarget)}
                >
                  <ClipboardCheck aria-hidden data-icon="inline-start" />
                  Review
                  {ix.check.length > 0 && (
                    <Badge
                      variant={check.length > 0 ? "count-warn" : "count-muted"}
                      aria-hidden
                      className="ms-0.5"
                    >
                      {narrowed && check.length !== ix.check.length
                        ? `${check.length}/${ix.check.length}`
                        : ix.check.length}
                    </Badge>
                  )}
                </Button>
              </Tip>
            )}
            {PHONE ? (
              <PhoneHeaderStatus saved={saved} idleText={notes.length ? "Saved" : ""} />
            ) : (
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
            )}
          </div>

          {notes.length > 0 && !PHONE && (
            <div className="upright:gap-1 upright:px-2.5 upright:pb-1 flex flex-none flex-col gap-1.5 px-3 pb-1.5">
              <NoteViewBar view={view} onChange={(v) => setPref("noteView", v)} />
              <NoteStatusStrip
                status={status}
                counts={statusCounts}
                onChange={(s) => set({ noteStatus: s })}
              />

              <div className="flex flex-wrap items-center gap-1">
                <SearchBox
                  name="note-search"
                  value={q}
                  onChange={(x) => set({ noteSearch: x })}
                  label="Search notes"
                  placeholder="Search notes or #12"
                  className="min-w-0 flex-1 basis-28"
                />
                <FilterMenu allItems={allRawItems} />
                <SortMenu fixedReason={SORT_FIXED_REASON[view]} />
              </div>

              <ActiveFilterChips includeSearch shotOptions={shotOptions} />
            </div>
          )}
        </div>
        <div
          className={cn(
            "border-hairline-subtle flex min-h-0 w-full flex-1 flex-col border-t",
            (view === "cards" || view === "list" || view === "feed") && "mx-auto max-w-4xl",
            PHONE ? "pt-1" : "pt-2",
          )}
        >
          {view === "cards" || notes.length === 0 ? (
            <div
              ref={list}
              data-arrow-scroll
              className={cn(
                "scroll-fade min-h-0 flex-1 overflow-auto overscroll-contain",
                PHONE ? "px-2.5 pb-2" : "px-3 pb-6",
              )}
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
                {v.getVirtualItems().map((it) => {
                  const entry = displayRows[it.index];
                  return (
                    <div
                      key={it.key}
                      data-index={it.index}
                      ref={v.measureElement}
                      className="absolute inset-x-0 top-0 translate-y-(--start)"
                      style={{ "--start": `${it.start}px` }}
                      onFocus={() => {
                        focused.current = entry.key;
                      }}
                      onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                          focused.current = null;
                      }}
                    >
                      {entry.exiting ? (
                        <NoteExitSlot id={entry.id} kind={entry.kind}>
                          {row(entry.item)}
                        </NoteExitSlot>
                      ) : (
                        row(entry.item)
                      )}
                    </div>
                  );
                })}
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
          ) : (
            <Suspense
              fallback={
                <Empty>
                  <span role="status">Loading notes view…</span>
                </Empty>
              }
            >
              {view === "board" ? (
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
            </Suspense>
          )}
        </div>
      </div>
      {composeDock && (
        <Compose
          dock
          className="mx-auto w-full max-w-4xl"
          onCrampedOverlayChange={setCrampedOverlay}
        />
      )}
    </section>
  );
}
