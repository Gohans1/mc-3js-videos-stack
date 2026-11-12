// The side list: notes still to fix, then the fixed ones folded away under them. CapCut has no notes list, so it follows
// Frame.io's comments panel: a search over the words, what was tapped and the shot, a Show menu (drawn notes, this shot) and a
// Sort menu (film order, newest, oldest). Both To-fix and Done cards share one scannable anatomy with a compact frame thumbnail
// that enlarges in a floating portal on hover. Only the cards in view are built (@tanstack/react-virtual): a film with thousands
// of notes plays as smoothly as one with none. In film order the list keeps the note at the playhead in view, unless a finger or
// wheel moved it in the last few seconds or a note is being edited.
import { PreviewCard } from "@base-ui/react/preview-card";
import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Crosshair,
  ListFilter,
  MessageCircleQuestion,
  PenLine,
  RotateCcw,
  Video,
  X,
  ZoomIn,
} from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { SaveStatus } from "../components/inspector";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { set, useStudio } from "../core/store";
import { rangeText, stamp } from "../core/time";
import { frameSize } from "../picture/frame";
import { inkWords } from "./ink";
import { noteRangePill, noteShotTitle, pinShortLabel } from "./note-card-meta";
import {
  approveNote,
  editOldNote,
  goToNote,
  noteMedia,
  type Placed,
  removeNote,
  reopenNote,
  reviewNote,
  setReview,
  shownNotes,
} from "./notes";
import { type Fix, type Mark, type Note, type NoteShow, type NoteSort } from "./slice";

const HOLD_LIST = 4000;
const cardBase =
  "group/card relative rounded-xl border p-2.5 shadow-xs transition-colors duration-150 ease-out";
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const Empty = ({ children }: { children: ReactNode }) => (
  <div className="text-muted-foreground px-0.5 py-2">{children}</div>
);

function FixCallout({ fix }: { fix: Fix }) {
  return (
    <Callout variant="ok" className="mt-2">
      <CheckCircle2 aria-hidden />
      <div className="min-w-0 flex-1 wrap-anywhere">
        <span className="text-foreground/95">{fix.what}</span>
        <span className="text-tag text-label/75 ms-1.5 inline-block font-mono tabular-nums">
          {fix.checkpoint ? `${fix.checkpoint} · ` : ""}
          {day.format(new Date(fix.at))}
        </span>
      </div>
    </Callout>
  );
}

function NoteTags({ note }: { note: Note }) {
  const pinName = pinShortLabel(note.pin?.what);
  const range = noteRangePill(note);
  const marks = note.marks as Mark[] | undefined;
  const hasMarks = Boolean(marks?.length);
  if (!pinName && !range && !note.freeCam && !hasMarks) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {pinName && (
        <Badge variant="tag" title={note.pin!.what} className="max-w-44">
          <Crosshair aria-hidden className="text-primary" />
          <span className="truncate">{pinName}</span>
        </Badge>
      )}
      {range && <Badge variant="inOut">{rangeText(range)}</Badge>}
      {note.freeCam && (
        <Badge variant="tag">
          <Video aria-hidden className="text-warn" />
          Free cam
        </Badge>
      )}
      {hasMarks && (
        <Badge variant="ink">
          <PenLine aria-hidden />
          <span className="wrap-anywhere">{inkWords(marks!)}</span>
        </Badge>
      )}
    </div>
  );
}

// Compact frame thumbnail shared by both To-fix and Done cards; hovering opens a full-detail floating frame preview
function NoteThumb({ note, t, shotFull }: { note: Note; t: number; shotFull: string }) {
  const media = noteMedia(note);
  if (!media.thumb) return null;
  const [w, h] = frameSize(960);
  const portrait = h > w;
  const pinName = pinShortLabel(note.pin?.what);
  const timeText = stamp(t);
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={100}
        closeDelay={75}
        render={
          <button
            type="button"
            aria-label={`Preview frame at ${timeText} (click to jump)`}
            onClick={(e) => {
              e.stopPropagation();
              goToNote(note);
            }}
            className={cn(
              "group/thumb bg-backdrop hover:outline-primary/85 focus-visible:ring-ring relative flex-none cursor-pointer overflow-hidden rounded-md shadow-xs outline-1 -outline-offset-1 outline-white/12 transition-colors duration-150 ease-out focus-visible:ring-2",
              portrait ? "h-16 w-auto" : "aspect-video w-21",
            )}
          />
        }
      >
        <img
          src={media.thumb}
          loading="lazy"
          decoding="async"
          width={w}
          height={h}
          alt=""
          className="block size-full object-cover"
        />
        <span
          aria-hidden
          className="text-picture/85 group-hover/thumb:text-primary pointer-events-none absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-sm bg-black/65 transition-colors duration-150 group-hover/thumb:bg-black/85"
        >
          <ZoomIn className="size-2.5" />
        </span>
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="right"
          align="center"
          sideOffset={10}
          collisionPadding={12}
          className="isolate z-50"
        >
          <PreviewCard.Popup
            data-note-preview={note.id}
            className={cn(
              "bg-popover text-popover-foreground shadow-float motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 motion-safe:data-closed:zoom-out-95 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-open:zoom-in-95 max-w-sm origin-(--transform-origin) overflow-hidden rounded-xl p-1.5 ring-1 ring-white/15 motion-safe:duration-150",
              portrait ? "w-60" : "w-96",
            )}
          >
            <div className="bg-backdrop relative overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-white/10">
              <img
                src={media.thumb}
                width={w}
                height={h}
                alt={`Frame at ${timeText}`}
                className={cn("block", portrait ? "mx-auto max-h-80 w-auto" : "h-auto w-full")}
              />
              {note.pin && media.crop && (
                <img
                  src={media.crop}
                  width={480}
                  height={480}
                  alt={`Pinned detail: ${note.pin.what}`}
                  className="border-primary/75 bg-backdrop pointer-events-none absolute bottom-1.5 left-1.5 size-14 rounded-md border object-cover shadow-md"
                />
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 px-1 pb-0.5 text-xs">
              <span className="text-primary font-mono font-semibold tabular-nums">{timeText}</span>
              <span className="text-label min-w-0 flex-1 truncate">{shotFull}</span>
              {pinName && (
                <Badge variant="tag" className="max-w-32 shrink-0">
                  <span className="truncate">{pinName}</span>
                </Badge>
              )}
            </div>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
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
  return (
    <article
      data-note={n.id}
      className={cn(
        cardBase,
        "border-border/80 bg-card hover:border-foreground/20 hover:bg-raised-3/50 cursor-pointer",
        near && !editing && "border-primary/85 bg-card ring-primary/25 shadow-sm ring-1",
        editing && "border-warn/85 bg-card ring-warn/30 ring-1",
      )}
      onClick={() => editOldNote(n)}
    >
      <div className="flex min-h-7 items-center gap-2 pointer-coarse:min-h-10">
        <Tip label="Jump here">
          <Button
            variant="time"
            size="sm"
            className="pointer-coarse:h-9"
            onClick={(e) => {
              e.stopPropagation();
              goToNote(n);
            }}
          >
            {timeText}
          </Button>
        </Tip>
        <span className="min-w-0 flex-1 truncate text-xs" title={shotTitle.full}>
          <span className="text-foreground/95 font-semibold">{shotTitle.primary}</span>
          {shotTitle.secondary && <span className="text-label/80"> · {shotTitle.secondary}</span>}
        </span>
        <Button
          variant="remove"
          size="icon-sm"
          className="-me-1 pointer-coarse:size-9"
          title="Delete note"
          aria-label={`Delete note at ${timeText}`}
          onClick={(e) => {
            e.stopPropagation();
            removeNote(n);
          }}
        >
          <X />
        </Button>
      </div>
      <div className="mt-1.5 flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          {/* The words are the way to edit from the keyboard; a click anywhere else on the card does the same */}
          <button
            type="button"
            className="text-ui text-foreground focus-visible:ring-ring block w-full rounded-sm text-left leading-relaxed wrap-anywhere whitespace-pre-wrap outline-none focus-visible:ring-2"
            aria-label={`Edit note at ${timeText}: ${n.text || "drawing only"}`}
          >
            {n.text || <span className="text-label italic">(drawing only)</span>}
          </button>
          <NoteTags note={n} />
        </div>
        <NoteThumb note={n} t={t} shotFull={shotTitle.full} />
      </div>
      {n.fixes?.length ? <FixCallout fix={n.fixes.at(-1)!} /> : null}
    </article>
  );
});

// A fixed note keeps what was asked, what the frame looked like and what was done. It's a record: the way back is "Reopen"
const DoneCard = memo(function DoneCard({ p: { n, t } }: { p: Placed }) {
  const shotTitle = noteShotTitle(n.shot, n.shotName);
  const timeText = stamp(t);
  return (
    <article
      data-note={n.id}
      className={cn(cardBase, "border-border/55 bg-card/85 hover:border-border")}
    >
      <div className="flex min-h-7 items-center gap-2 pointer-coarse:min-h-10">
        <Tip label="Jump here">
          <Button
            variant="time"
            size="sm"
            className="pointer-coarse:h-9"
            onClick={() => goToNote(n)}
          >
            {timeText}
          </Button>
        </Tip>
        <span className="min-w-0 flex-1 truncate text-xs" title={shotTitle.full}>
          <span className="text-foreground/90 font-semibold">{shotTitle.primary}</span>
          {shotTitle.secondary && <span className="text-label/75"> · {shotTitle.secondary}</span>}
        </span>
        <Button
          variant="secondary"
          size="sm"
          className="pointer-coarse:h-9"
          onClick={() => reopenNote(n)}
        >
          <RotateCcw aria-hidden className="text-label size-3" />
          Reopen
        </Button>
      </div>
      <div className="mt-1.5 flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-ui text-foreground/90 leading-relaxed wrap-anywhere whitespace-pre-wrap">
            {n.text || <span className="text-label italic">(drawing only)</span>}
          </div>
          <NoteTags note={n} />
        </div>
        <NoteThumb note={n} t={t} shotFull={shotTitle.full} />
      </div>
      {n.fixes?.map((f) => (
        <FixCallout key={f.at} fix={f} />
      ))}
    </article>
  );
});

// The AI answered: a fix waiting for the creator's yes, or a question waiting for their words. Yellow until they act on it
const CheckCard = memo(function CheckCard({ p: { n, t } }: { p: Placed }) {
  const shotTitle = noteShotTitle(n.shot, n.shotName);
  const timeText = stamp(t);
  const fix = n.fixes?.at(-1);
  return (
    <article
      data-note={n.id}
      className={cn(cardBase, "border-warn/60 bg-warn-bg hover:border-warn/85 cursor-pointer")}
      onClick={() => reviewNote(n)}
    >
      <div className="flex min-h-7 items-center gap-2 pointer-coarse:min-h-10">
        <Tip label="Jump here">
          <Button
            variant="time"
            size="sm"
            className="pointer-coarse:h-9"
            onClick={(e) => {
              e.stopPropagation();
              goToNote(n);
            }}
          >
            {timeText}
          </Button>
        </Tip>
        <span className="min-w-0 flex-1 truncate text-xs" title={shotTitle.full}>
          <span className="text-foreground/95 font-semibold">{shotTitle.primary}</span>
          {shotTitle.secondary && <span className="text-label/80"> · {shotTitle.secondary}</span>}
        </span>
      </div>
      <div className="mt-1.5 flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-ui text-foreground/90 line-clamp-2 leading-relaxed wrap-anywhere">
            {n.text || <span className="text-label italic">(drawing only)</span>}
          </div>
          <div className="text-ui text-warn mt-1.5 flex items-start gap-1.5 wrap-anywhere">
            {fix?.ask ? (
              <MessageCircleQuestion aria-hidden className="mt-0.5 size-3.5 flex-none" />
            ) : (
              <ClipboardCheck aria-hidden className="mt-0.5 size-3.5 flex-none" />
            )}
            <span className="min-w-0">
              {fix?.ask ? "The AI asks: " : "The AI says it is fixed: "}
              <span className="text-foreground">{fix?.what}</span>
            </span>
          </div>
        </div>
        <NoteThumb note={n} t={t} shotFull={shotTitle.full} />
      </div>
      <div className="mt-2 flex gap-2">
        {!fix?.ask && (
          <Button
            variant="approve"
            size="md"
            onClick={(e) => {
              e.stopPropagation();
              approveNote(n);
            }}
          >
            <Check aria-hidden />
            Approve
          </Button>
        )}
        <Button
          variant="secondary"
          size="md"
          onClick={(e) => {
            e.stopPropagation();
            reviewNote(n);
          }}
        >
          {fix?.ask ? "Answer" : "Review"}
        </Button>
      </div>
    </article>
  );
});

const SHOWS: { value: NoteShow; title: string }[] = [
  { value: "all", title: "All notes" },
  { value: "drawn", title: "Drawn on" },
  { value: "shot", title: "In this shot" },
];
const SORTS: { value: NoteSort; title: string }[] = [
  { value: "film", title: "Film order" },
  { value: "newest", title: "Newest first" },
  { value: "oldest", title: "Oldest first" },
];
function ShowMenu() {
  const show = useStudio((s) => s.noteShow),
    sort = useStudio((s) => s.noteSort),
    changed = show !== "all" || sort !== "film";
  const label = `Show and sort notes${changed ? `: ${SHOWS.find((x) => x.value === show)!.title}, ${SORTS.find((x) => x.value === sort)!.title}` : ""}`;
  return (
    <DropdownMenu>
      <Tip label={label}>
        <DropdownMenuTrigger
          render={
            <Button
              variant={changed ? "lit" : "quiet"}
              size="icon-lg"
              aria-label={label}
              className="relative flex-none pointer-coarse:size-10"
            />
          }
        >
          <ListFilter />
          {changed && (
            <span aria-hidden className="bg-primary absolute top-1 right-1 size-1.5 rounded-full" />
          )}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={show}
            onValueChange={(v) => set({ noteShow: v as NoteShow })}
          >
            {SHOWS.map((x) => (
              <DropdownMenuRadioItem key={x.value} value={x.value}>
                {x.title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort notes to fix</DropdownMenuLabel>
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
  | { key: string; kind: "checkHead" | "openHead" | "none" | "fold" | "noneDone" };

export function NoteList() {
  const notes = useStudio((s) => s.notes),
    saved = useStudio((s) => s.saved),
    nearNote = useStudio((s) => s.nearNote);
  const editing = useStudio((s) => (s.compose?.kind === "edit" ? s.compose.id : undefined)),
    q = useStudio((s) => s.noteSearch),
    show = useStudio((s) => s.noteShow),
    sort = useStudio((s) => s.noteSort);
  useStudio((s) => (s.noteShow === "shot" ? s.shot : "")); // "In this shot" follows the playhead from shot to shot
  const [doneOpen, setDoneOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null),
    touched = useRef(-1e9),
    focused = useRef<string | null>(null);
  const { open, check, done, ix } = shownNotes(),
    narrowed = !!q.trim() || show !== "all";

  const rows = useMemo(() => {
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
  }, [open, check, done, doneOpen, notes.length]);
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
    estimateSize: (i) =>
      ({ done: 132, check: 150, checkHead: 28, openHead: 28 })[rows[i].kind as string] ?? 96,
  });

  useEffect(() => {
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

  const clear = () => set({ noteSearch: "", noteShow: "all" });
  const count = (shownHere: Placed[], all: Placed[]) =>
    narrowed ? `${shownHere.length} of ${all.length}` : all.length;
  const row = (r: Row): ReactNode => {
    if (r.kind === "open")
      return <NoteCard p={r.p} near={r.p.n.id === nearNote} editing={r.p.n.id === editing} />;
    if (r.kind === "done") return <DoneCard p={r.p} />;
    if (r.kind === "check") return <CheckCard p={r.p} />;
    if (r.kind === "checkHead")
      return (
        <h3 className="text-ui text-warn flex h-7 items-center px-0.5 font-semibold tabular-nums">
          To check ({count(check, ix.check)})
        </h3>
      );
    if (r.kind === "openHead")
      return (
        <h3 className="text-ui flex h-7 items-center px-0.5 font-semibold tabular-nums">
          To fix ({count(open, ix.open)})
        </h3>
      );
    if (r.kind === "none") {
      if (narrowed && ix.open.length)
        return (
          <Empty>
            No {show === "drawn" ? "drawn notes" : "notes"} to fix
            {show === "shot" ? " in this shot" : ""}
            {q.trim() ? ` match “${q.trim()}”` : ""}.{" "}
            <Button variant="link" size="inline" onClick={clear}>
              Show all notes
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
        <p className="text-ui text-muted-foreground px-2.5">
          {narrowed && ix.done.length ? "No fixed notes match." : "Notes the AI fixes move here."}
        </p>
      );
    // Folded by default: they are answered, and the list is for what still needs doing. Shown at 0 too, so the creator knows where fixed notes will go
    return (
      <button
        type="button"
        aria-expanded={doneOpen}
        onClick={() => setDoneOpen(!doneOpen)}
        className="text-ui text-muted-foreground hover:bg-card hover:text-foreground focus-visible:ring-ring mt-1 flex min-h-9 w-full items-center gap-2 rounded-xl px-2.5 font-semibold outline-none focus-visible:ring-2 pointer-coarse:min-h-10"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 motion-safe:transition-transform", doneOpen && "rotate-90")}
        />
        Done ({narrowed ? `${done.length} of ${ix.done.length}` : ix.done.length})
      </button>
    );
  };

  return (
    <section aria-label="Notes" className="flex min-h-0 flex-1 flex-col">
      <div className="upright:py-1.5 sideways:py-1 flex flex-none flex-wrap items-center gap-x-1 px-3 pt-2.5 pb-2">
        <h2 className="text-ui sideways:h-9 flex h-8 items-center px-0.5 font-semibold tabular-nums pointer-coarse:h-10">
          {check.length ? "Notes" : `To fix (${count(open, ix.open)})`}
        </h2>
        {ix.check.length + ix.open.length + ix.done.length > 0 && (
          <Tip label="Review room: notes and pictures, big (N)">
            <Button
              variant="quiet"
              size="md"
              aria-label={`Review room${ix.check.length ? `, ${ix.check.length} to check` : ""}`}
              onClick={() => setReview(true)}
            >
              <ClipboardCheck aria-hidden />
              Review
              {ix.check.length > 0 && (
                <span
                  aria-hidden
                  className="bg-warn ms-0.5 rounded-full px-1.5 text-xs font-semibold text-black tabular-nums"
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
          idleText={notes.length ? "All changes saved" : ""}
          failText="Not sent. Kept on this device, retrying…"
          className={cn(
            "flex-1 text-end",
            saved === "fail" ? "whitespace-normal" : "whitespace-nowrap",
          )}
        />
      </div>
      {notes.length > 0 && (
        <div className="upright:pb-1.5 sideways:pb-1 flex flex-none items-center gap-1 px-3 pb-2">
          <SearchBox
            name="note-search"
            value={q}
            onChange={(x) => set({ noteSearch: x })}
            label="Search notes"
            placeholder={`Search ${notes.length} notes…`}
            className="min-w-0 flex-1"
          />
          <ShowMenu />
        </div>
      )}
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
        <div className="relative h-(--total) w-full" style={{ "--total": `${v.getTotalSize()}px` }}>
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
    </section>
  );
}
