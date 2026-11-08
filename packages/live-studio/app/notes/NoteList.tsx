// The side list: notes still to fix, then the fixed ones folded away under them. CapCut has no notes list, so it follows
// Frame.io's comments panel: a search over the words, what was tapped and the shot, a Show menu (drawn notes, this shot) and a
// Sort menu (film order, newest, oldest). Only the cards in view are built (@tanstack/react-virtual): a film with thousands of
// notes plays as smoothly as one with none. In film order the list keeps the note at the playhead in view, unless a finger or
// wheel moved it in the last few seconds or a note is being edited
import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import { ListFilter, X } from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { rangeText, stamp } from "../core/time";
import { frameSize } from "../picture/frame";
import { inkWords } from "./ink";
import { editOldNote, goToNote, type Placed, removeNote, reopenNote, shownNotes } from "./notes";
import { type Fix, type Mark, type Note, type NoteShow, type NoteSort } from "./slice";
import { set, useStudio } from "../core/store";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";

const HOLD_LIST = 4000;
const card = "rounded-[10px] border border-transparent bg-card px-2.5 pt-1.5 pb-2.5";
const timeButton = "min-h-7.5 bg-tint px-2 font-mono text-sm font-semibold text-primary tabular-nums hover:bg-tint-hover pointer-coarse:px-2.5";
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const FixLine = ({ fix }: { fix: Fix }) => (
  <div className="mt-1.5 text-[13px] text-ok">Fixed: {fix.what} ({fix.checkpoint}, {day.format(new Date(fix.at))})</div>
);
const Empty = ({ children }: { children: ReactNode }) => <div className="px-0.5 py-2 text-muted-foreground">{children}</div>;
const Drawn = ({ note }: { note: Note }) => {
  const marks = note.marks as Mark[] | undefined;
  return marks?.length ? <div className="mt-1 text-xs wrap-anywhere text-ink">Drawn: {inkWords(marks)}</div> : null;
};

const NoteCard = memo(function NoteCard({ p: { n, t }, near, editing }: { p: Placed; near: boolean; editing: boolean }) {
  const range = !n.marks && Array.isArray(n.range) ? (n.range as [number, number]) : null; // In to Out (timeline/inout.ts)
  const where = `shot ${n.shot}${range ? ` | ${rangeText(range)}` : ""}${n.pin ? ` | ${n.pin.what}` : ""}`;
  return (
    <article
      data-note={n.id}
      className={cn(card, "cursor-pointer hover:bg-raised-2", near && "border-primary bg-tint", editing && "border-warn")}
      onClick={() => editOldNote(n)}
    >
      <div className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
        <Tip label="Jump here"><Button className={timeButton} onClick={(e) => { e.stopPropagation(); goToNote(n); }}>{stamp(t)}</Button></Tip>
        {/* text-label, not muted: muted fails 4.5:1 on the card's near (tint) and hover backgrounds */}
        <span className="min-w-0 flex-1 truncate text-xs text-label" title={where}>{where}</span>
        <Button variant="ghost" size="icon" className="-me-1.5 size-8 text-muted-foreground pointer-coarse:size-11" title="Delete note" aria-label={`Delete note at ${stamp(t)}`} onClick={(e) => { e.stopPropagation(); removeNote(n); }}>
          <X />
        </Button>
      </div>
      {/* The words are the way to edit from the keyboard; a click anywhere else on the card does the same */}
      <button type="button" className="mt-0.5 block w-full rounded-sm text-left whitespace-pre-wrap wrap-anywhere" aria-label={`Edit note at ${stamp(t)}: ${n.text}`}>
        {n.text || <span className="text-label">(drawing only)</span>}
      </button>
      <Drawn note={n} />
      {n.fixes?.length ? <FixLine fix={n.fixes.at(-1)!} /> : null}
    </article>
  );
});

// A fixed note keeps what was asked, what the frame looked like and what was done. It's a record: the way back is "Reopen"
const DoneCard = memo(function DoneCard({ p: { n, t } }: { p: Placed }) {
  const [w, h] = frameSize(960);
  return (
    <article className={card}>
      <div className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
        <Tip label="Jump here"><Button className={timeButton} onClick={() => goToNote(n)}>{stamp(t)}</Button></Tip>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">shot {n.shot}</span>
        <Button variant="secondary" size="lg" className="text-[13px]" onClick={() => reopenNote(n)}>Reopen</Button>
      </div>
      {/* Sized up front, or the list would jump as pictures arrive; a Shorts frame as tall as a wide one is wide, not the card's width */}
      {n.img && <img src={`/api/note-img/${n.id}.jpg`} loading="lazy" width={w} height={h} alt="" className={cn("mt-1.5 mb-1 block rounded-md outline-1 -outline-offset-1 outline-white/10", h > w ? "mx-auto h-60 w-auto" : "h-auto w-full")} />}
      <div className="mt-0.5 whitespace-pre-wrap wrap-anywhere">{n.text}</div>
      <Drawn note={n} />
      {n.fixes?.map((f) => <FixLine key={f.at} fix={f} />)}
    </article>
  );
});

const SHOWS: { value: NoteShow; title: string }[] = [{ value: "all", title: "All notes" }, { value: "drawn", title: "Drawn on" }, { value: "shot", title: "In this shot" }];
const SORTS: { value: NoteSort; title: string }[] = [{ value: "film", title: "Film order" }, { value: "newest", title: "Newest first" }, { value: "oldest", title: "Oldest first" }];
function ShowMenu() {
  const show = useStudio((s) => s.noteShow), sort = useStudio((s) => s.noteSort), changed = show !== "all" || sort !== "film";
  const label = `Show and sort notes${changed ? `: ${SHOWS.find((x) => x.value === show)!.title}, ${SORTS.find((x) => x.value === sort)!.title}` : ""}`;
  return (
    <DropdownMenu>
      <Tip label={label}>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={label} className={cn("relative size-8 flex-none text-muted-foreground pointer-coarse:size-10", changed && "text-primary")} />}>
          <ListFilter />
          {changed && <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={show} onValueChange={(v) => set({ noteShow: v as NoteShow })}>
            {SHOWS.map((x) => <DropdownMenuRadioItem key={x.value} value={x.value} className="text-[13px]">{x.title}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort notes to fix</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sort} onValueChange={(v) => set({ noteSort: v as NoteSort })}>
            {SORTS.map((x) => <DropdownMenuRadioItem key={x.value} value={x.value} className="text-[13px]">{x.title}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Row = { key: string; kind: "open" | "done"; p: Placed } | { key: string; kind: "none" | "fold" | "noneDone" };

export function NoteList() {
  const notes = useStudio((s) => s.notes), saved = useStudio((s) => s.saved), nearNote = useStudio((s) => s.nearNote);
  const editing = useStudio((s) => s.compose?.editing), q = useStudio((s) => s.noteSearch), show = useStudio((s) => s.noteShow), sort = useStudio((s) => s.noteSort);
  useStudio((s) => (s.noteShow === "shot" ? s.shot : "")); // "In this shot" follows the playhead from shot to shot
  const [doneOpen, setDoneOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null), touched = useRef(-1e9), focused = useRef<string | null>(null);
  const { open, done, ix } = shownNotes(), narrowed = !!q.trim() || show !== "all";

  const rows = useMemo(() => {
    const r: Row[] = open.length ? open.map((p) => ({ key: p.n.id, kind: "open", p })) : [{ key: "none", kind: "none" }];
    if (notes.length) r.push({ key: "fold", kind: "fold" });
    if (notes.length && doneOpen) r.push(...(done.length ? done.map((p): Row => ({ key: p.n.id, kind: "done", p })) : [{ key: "noneDone", kind: "noneDone" } as Row]));
    return r;
  }, [open, done, doneOpen, notes.length]);
  const rowOf = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);

  // The card holding the keyboard's focus stays built when it scrolls out of view, or the focus would drop to the page
  const rangeExtractor = useCallback((range: Range) => {
    const shownNow = defaultRangeExtractor(range), i = focused.current ? rowOf.get(focused.current) : undefined;
    return i === undefined || shownNow.includes(i) ? shownNow : [...shownNow, i].sort((a, b) => a - b);
  }, [rowOf]);
  const v = useVirtualizer({
    count: rows.length, getScrollElement: () => list.current, getItemKey: (i) => rows[i].key, rangeExtractor, gap: 6, overscan: 6,
    estimateSize: (i) => (rows[i].kind === "done" ? 300 : 88),
  });

  useEffect(() => {
    const box = list.current, i = rowOf.get(nearNote ?? "");
    if (!box || i === undefined || sort !== "film" || editing || performance.now() - touched.current < HOLD_LIST) return;
    const to = v.getOffsetForIndex(i, "center")?.[0] ?? box.scrollTop;
    v.scrollToIndex(i, { align: "center", behavior: Math.abs(to - box.scrollTop) > 500 ? "auto" : "smooth" }); // a long way is a jump, not a slide past everything
  }, [nearNote, editing, sort, rowOf, v]);

  const clear = () => set({ noteSearch: "", noteShow: "all" });
  const row = (r: Row): ReactNode => {
    if (r.kind === "open") return <NoteCard p={r.p} near={r.p.n.id === nearNote} editing={r.p.n.id === editing} />;
    if (r.kind === "done") return <DoneCard p={r.p} />;
    if (r.kind === "none") {
      if (narrowed && ix.open.length) return <Empty>No {show === "drawn" ? "drawn notes" : "notes"} to fix{show === "shot" ? " in this shot" : ""}{q.trim() ? ` match “${q.trim()}”` : ""}. <Button variant="link" className="h-auto p-0 text-[13px]" onClick={clear}>Show all notes</Button></Empty>;
      return <Empty>{ix.done.length ? "Nothing left to fix" : "No notes yet. Click the picture or press M to add one"}</Empty>;
    }
    if (r.kind === "noneDone") return <p className="px-2.5 text-[13px] text-muted-foreground">{narrowed && ix.done.length ? "No fixed notes match." : "Notes the AI fixes move here."}</p>;
    // Folded by default: they are answered, and the list is for what still needs doing. Shown at 0 too, so the creator knows where fixed notes will go
    return (
      <button type="button" aria-expanded={doneOpen} onClick={() => setDoneOpen(!doneOpen)} className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-[10px] px-2.5 text-[13px] font-semibold text-muted-foreground outline-none hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <span aria-hidden className={cn("mx-0.5 size-1.5 -rotate-45 border-r-[1.5px] border-b-[1.5px] border-current", doneOpen && "rotate-45")} />
        Done ({narrowed ? `${done.length} of ${ix.done.length}` : ix.done.length})
      </button>
    );
  };

  const savedText = saved === "fail" ? "Not sent. Kept on this device, retrying…" : saved === "busy" ? "Saving…" : notes.length ? "All changes saved" : "";
  return (
    <section aria-label="Notes" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-x-1 px-3 pt-2.5 pb-2 upright:py-1.5 sideways:py-1">
        <h2 className="flex h-8 items-center px-0.5 text-[13px] font-semibold tabular-nums pointer-coarse:h-10 sideways:h-9">To fix ({narrowed ? `${open.length} of ${ix.open.length}` : ix.open.length})</h2>
        <span role="status" className={cn("flex-1 text-end text-xs whitespace-nowrap text-ok", saved === "busy" && "text-muted-foreground", saved === "fail" && "font-semibold whitespace-normal text-warn")}>{savedText}</span>
      </div>
      {notes.length > 0 && (
        <div className="flex flex-none items-center gap-1 px-3 pb-2 upright:pb-1.5 sideways:pb-1">
          <SearchBox name="note-search" value={q} onChange={(x) => set({ noteSearch: x })} label="Search notes" placeholder={`Search ${notes.length} notes…`} className="min-w-0 flex-1" />
          <ShowMenu />
        </div>
      )}
      <div
        ref={list}
        data-arrow-scroll
        className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-3 scroll-fade"
        onPointerDown={() => { touched.current = performance.now(); }}
        onWheel={() => { touched.current = performance.now(); }}
        onTouchMove={() => { touched.current = performance.now(); }}
      >
        <div className="relative w-full" style={{ height: v.getTotalSize() }}>
          {v.getVirtualItems().map((it) => (
            <div
              key={it.key}
              data-index={it.index}
              ref={v.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${it.start}px)` }}
              onFocus={() => { focused.current = rows[it.index].key; }}
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused.current = null; }}
            >
              {row(rows[it.index])}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
