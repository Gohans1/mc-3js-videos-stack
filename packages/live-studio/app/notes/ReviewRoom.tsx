// The Review room: the notes alone beside the picture, in place of the timeline and the panels (N, or the button over the notes).
// It is where the creator and the AI pass a note back and forth (src/note-state.mjs): the AI fixes or asks, the creator looks at
// the moment then and now, approves, or sends words back; and may ask the AI to remember what a note teaches. Frame.io's review
// is the model (Approve / Needs work, a reply thread on the comment, compare versions with an overlay slider); CapCut has none.
import {
  Bookmark,
  BookmarkCheck,
  Camera,
  Check,
  ChevronDown,
  ChevronsLeftRight,
  ClipboardCheck,
  MessageCircleQuestion,
  Play,
  Plus,
  X,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { noteState, noteThread } from "../../src/note-state.mjs";
import { useLit, useLitAny } from "../activity/activity";
import { Segmented } from "../components/inspector";
import { TabStage, useEnterMotion } from "../components/Motion";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { VirtualList } from "../components/VirtualList";
import { get, set, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { Compose } from "./Compose";
import { noteShotTitle, pinShortLabel } from "./note-card-meta";
import { LearnedCallout, NoteNumber } from "./note-parts";
import { formatShortDate, isCreatorNeedsWork } from "./note-views-model";
import {
  answerNote,
  approveNote,
  approveReviewCurrent,
  focusReviewRow,
  goToNote,
  noteMedia,
  nowPicture,
  openNote,
  originOf,
  type Placed,
  playNote,
  rememberNote,
  reviewList,
  setReview,
  stepReview,
} from "./notes";
import { nextReviewNeighborId, replyStaysInList } from "./review-nav";
import type { Note, NoteState } from "./slice";

const when = (at: string) => (at ? formatShortDate(at) : "");
const lastFix = (n: Note) => n.fixes?.at(-1);
// What the creator can do with a note now, and the words the reply box offers for it
type Kind = "fix" | "ask" | "open" | "done";
const kindOf = (n: Note): Kind => {
  const s = noteState(n);
  return s === "check" ? (lastFix(n)?.ask ? "ask" : "fix") : s;
};
const REPLY: Record<Kind, { hint: string; send: string }> = {
  fix: { hint: "What still needs work? Enter sends it back to the AI", send: "Needs work" },
  ask: { hint: "Your answer. Enter sends it to the AI", send: "Answer" },
  open: { hint: "Add to this note. Enter sends it", send: "Add" },
  done: { hint: "What needs work again? Enter reopens it", send: "Reopen" },
};
const TABS: { id: NoteState; title: string }[] = [
  { id: "check", title: "To check" },
  { id: "open", title: "To fix" },
  { id: "done", title: "Done" },
];
const pic = (rel: string) => `/api/note-img/${rel.split("/").pop()}`;

// The note's own picture over the film as it is now at that moment, split by a handle: drag it, or use the arrow keys on it
function Compare({ n, at }: { n: Note; at: number }) {
  const then = noteMedia(n).thumb;
  const loading = useStudio((s) => s.loading),
    final = useStudio((s) => s.final),
    pictureRev = useStudio((s) => s.pictureRev);
  // drawn by the film's renderer, outside React's render, after the room has painted: a render of the film takes a moment
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const f = requestAnimationFrame(() => setNow(nowPicture(n)));
    return () => cancelAnimationFrame(f);
  }, [n, at, loading, final, pictureRev]);
  const [split, setSplit] = useState(50);
  if (!then && !now) return null;
  const label = "bg-scrim-strong text-tag text-picture rounded-sm px-1.5 py-0.5 font-semibold";
  return (
    <figure
      className="bg-backdrop has-focus-visible:ring-ring outline-border/60 upright:max-w-[calc(min(12rem,24dvh)*(var(--frame)))] relative mx-auto aspect-(--frame) w-full max-w-[calc(min(17rem,38dvh)*(var(--frame)))] overflow-hidden rounded-lg outline-1 -outline-offset-1 has-focus-visible:ring-2"
      style={{ "--split": `${split}%`, "--hide": `${100 - split}%` }}
    >
      {now && (
        <img
          src={now}
          alt={`The film now at ${stamp(at)}`}
          className="absolute inset-0 size-full object-contain"
        />
      )}
      {then && (
        <img
          src={then}
          alt="The moment when the note was written"
          className={cn(
            "absolute inset-0 size-full object-contain",
            now && "[clip-path:inset(0_var(--hide)_0_0)]",
          )}
        />
      )}
      {then && now && (
        <>
          <div
            aria-hidden
            className="bg-picture pointer-events-none absolute inset-y-0 left-(--split) w-0.5 shadow-md"
          >
            <span className="bg-picture ring-background text-picture-foreground absolute top-1/2 left-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-md ring-2">
              <ChevronsLeftRight className="size-3.5" />
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(e) => setSplit(+e.target.value)}
            aria-label="Then and now: how much of the old picture shows"
            className="absolute inset-0 size-full cursor-ew-resize opacity-0"
          />
        </>
      )}
      <figcaption className="pointer-events-none absolute inset-2 flex justify-between">
        {then && <span className={cn(label, "self-start")}>Then</span>}
        {now && <span className={cn(label, "ms-auto self-end")}>Now</span>}
      </figcaption>
    </figure>
  );
}

// The other pictures saved with the note: the seconds around it, the close-up under the tap, one per drawn moment
function Pictures({ n, open }: { n: Note; open: (p: { src: string; alt: string }) => void }) {
  const media = noteMedia(n);
  const list = [
    ...media.refs.map((src, i) => ({ src, alt: `Your picture ${i + 1}` })),
    ...(typeof n.strip === "string"
      ? [{ src: pic(n.strip), alt: "Seconds around it (-2 -1 0 +1)" }]
      : []),
    ...(media.crop ? [{ src: media.crop, alt: "Under the tap" }] : []),
    ...((n.frames as { t: number; img: string }[] | undefined) ?? []).map((f) => ({
      src: pic(f.img),
      alt: `Drawn at ${stamp(f.t)}`,
    })),
  ];
  if (!list.length) return null;
  return (
    <div className="flex [scrollbar-width:thin] gap-1.5 overflow-x-auto pb-1">
      {list.map((p) => (
        <button
          key={p.src}
          type="button"
          onClick={() => open(p)}
          aria-label={`Open ${p.alt}`}
          className="group/pic hover:outline-primary/85 focus-visible:ring-ring outline-border/80 flex-none overflow-hidden rounded-md outline-1 -outline-offset-1 focus-visible:ring-2"
        >
          <img src={p.src} alt="" decoding="async" className="block h-14 w-auto" />
          <span className="text-tag text-label block px-1 py-0.5 text-left">{p.alt}</span>
        </button>
      ))}
    </div>
  );
}

// The conversation, oldest first: the creator's note, then each fix or question from the AI and each answer back
function Thread({ n }: { n: Note }) {
  const [showEdits, setShowEdits] = useState(false);
  const editsCount = n.edits?.length ?? 0;
  const thread = noteThread(n, { rewordings: showEdits });
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2" aria-label="The conversation on this note">
        {thread.map((m, i) => {
          const reworded = "reworded" in m && m.reworded;
          return (
            <li
              key={`${m.at}-${i}`}
              className={cn(
                "rounded-lg px-2.5 py-2",
                reworded
                  ? "bg-card/55 opacity-75"
                  : m.by === "creator"
                    ? "bg-card"
                    : m.ask
                      ? "bg-warn-bg"
                      : "bg-ok/10",
              )}
            >
              <div className="text-tag text-label mb-0.5 flex items-center gap-1.5 font-semibold">
                {reworded
                  ? "Previous wording"
                  : m.by === "creator"
                    ? "You"
                    : m.ask
                      ? "AI asks"
                      : "AI fixed"}
                {m.checkpoint && <span className="font-mono font-normal">{m.checkpoint}</span>}
                <span className="ms-auto font-normal">{when(m.at)}</span>
              </div>
              <p
                className={cn(
                  "text-ui text-foreground leading-relaxed wrap-anywhere whitespace-pre-wrap",
                  reworded && "text-label line-through",
                )}
              >
                {m.text || <span className="text-label italic">(no words)</span>}
              </p>
            </li>
          );
        })}
      </ol>
      {editsCount > 0 && (
        <button
          type="button"
          aria-expanded={showEdits}
          onClick={() => setShowEdits((v) => !v)}
          className="text-label hover:text-foreground text-tag inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 font-medium transition-colors"
        >
          <ChevronDown
            aria-hidden
            className={cn("size-3 transition-transform duration-150", showEdits && "rotate-180")}
          />
          <span>
            {showEdits ? "Hide" : "Show"} {editsCount} prior wording
            {editsCount === 1 ? "" : "s"}
          </span>
        </button>
      )}
    </div>
  );
}

function RememberMenu({ n }: { n: Note }) {
  const scope = n.remember?.scope ?? "no";
  const label = n.remember
    ? `Remembering: ${scope === "all" ? "every film" : "this film"}`
    : "Remember";
  return (
    <DropdownMenu>
      <Tip label="Ask the AI to keep what this note teaches, as a rule for later">
        <DropdownMenuTrigger
          render={<Button variant={n.remember ? "lit" : "secondary"} size="md" />}
        >
          {n.remember ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />}
          {label}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-auto min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>The AI keeps what this note teaches</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={scope}
            onValueChange={(v) => rememberNote(n, v === "no" ? null : (v as "film" | "all"))}
          >
            <DropdownMenuRadioItem closeOnClick value="film">
              For this film
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem closeOnClick value="all">
              For every film
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem closeOnClick value="no">
              Don't remember
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Detail({ p, next }: { p: Placed; next: () => void }) {
  const { n, t } = p,
    kind = kindOf(n),
    shot = noteShotTitle(n.shot, n.shotName),
    fix = lastFix(n),
    lit = useLit(`note:${n.id}`);
  const [words, setWords] = useState("");
  const [big, setBig] = useState<{ src: string; alt: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    const w = words.trim();
    if (!w || !answerNote(n, w)) return;
    setWords("");
    if (!replyStaysInList(kind)) next();
  };
  return (
    <div
      data-note={n.id}
      data-ai-lit={lit || undefined}
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2.5">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <NoteNumber id={n.id} />
          <Tip label="Jump here">
            <Button variant="time" size="sm" onClick={() => goToNote(n)}>
              {stamp(t)}
            </Button>
          </Tip>
          <span className="min-w-0 flex-1 truncate text-xs" title={shot.full}>
            <span className="text-foreground/95 font-semibold">{shot.primary}</span>
            {shot.secondary && <span className="text-label/80"> · {shot.secondary}</span>}
          </span>
          {pinShortLabel(n.pin?.what) && (
            <Badge variant="tag" title={n.pin!.what} className="max-w-28">
              <span className="truncate">{pinShortLabel(n.pin?.what)}</span>
            </Badge>
          )}
          <Tip label="Play from 2 s before (Space stops)">
            <Button variant="secondary" size="sm" onClick={() => playNote(n)}>
              <Play aria-hidden data-icon="inline-start" />
              Play moment
            </Button>
          </Tip>
        </div>
        {kind === "fix" && (
          <Alert variant="warn" className="mb-2">
            <ClipboardCheck aria-hidden />
            <AlertDescription className="min-w-0 wrap-anywhere">
              The AI says it is fixed: <span className="text-foreground">{fix?.what}</span>
            </AlertDescription>
          </Alert>
        )}
        {kind === "ask" && (
          <Alert variant="warn" className="mb-2">
            <MessageCircleQuestion aria-hidden />
            <AlertDescription className="min-w-0 wrap-anywhere">
              The AI asks: <span className="text-foreground">{fix?.what}</span>
            </AlertDescription>
          </Alert>
        )}
        <Compare n={n} at={t} />
        <div className="mt-2">
          <Pictures n={n} open={setBig} />
        </div>
        <div className="mt-2">
          <Thread n={n} />
        </div>
        {n.learned?.what ? (
          <LearnedCallout note={n} />
        ) : (
          n.remember && (
            <p className="text-ui text-muted-foreground mt-2">
              Waiting for the AI to keep it as a rule: it sees your ask the next time it reads the
              notes.
            </p>
          )
        )}
      </div>
      <div className="bg-card border-border/60 flex-none border-t p-2 @2xl:p-2.5">
        <Textarea
          ref={box}
          name="reply"
          aria-label={REPLY[kind].hint}
          placeholder={REPLY[kind].hint}
          value={words}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            } else if (e.key === "Escape") box.current?.blur();
          }}
          className="max-h-24 min-h-9 @2xl:max-h-32 @2xl:min-h-10"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-2 @2xl:mt-2">
          {kind === "fix" && (
            <Button variant="approve" size="md" onClick={() => approveNote(n) && next()}>
              <Check aria-hidden data-icon="inline-start" />
              Approve
              <Kbd className="pointer-coarse:hidden">A</Kbd>
            </Button>
          )}
          <Button
            variant={kind === "fix" ? "secondary" : "default"}
            size="md"
            disabled={!words.trim()}
            onClick={send}
          >
            {REPLY[kind].send}
          </Button>
          <span className="flex-1" />
          <RememberMenu n={n} />
        </div>
      </div>
      <Dialog open={!!big} onOpenChange={(o) => !o && setBig(null)}>
        <DialogContent className="sm:max-w-[min(92vw,1400px)]">
          <DialogTitle>{big?.alt}</DialogTitle>
          {big && (
            <img
              src={big.src}
              alt={big.alt}
              className="block h-auto max-h-[78vh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ p, on, pick }: { p: Placed; on: boolean; pick: () => void }) {
  const { n, t } = p,
    thumb = noteMedia(n).thumb,
    kind = kindOf(n),
    state = noteState(n),
    needsWork = isCreatorNeedsWork(n, state),
    lit = useLit(`note:${n.id}`);
  return (
    <button
      type="button"
      data-review-row={n.id}
      data-ai-lit={lit || undefined}
      aria-current={on || undefined}
      onClick={pick}
      className={cn(
        "focus-visible:ring-ring studio-press flex w-full items-start gap-2 rounded-lg p-1.5 text-left transition-colors outline-none focus-visible:ring-2",
        on
          ? "bg-tint ring-primary/60 ring-1"
          : state === "check"
            ? "bg-warn-bg/45 hover:bg-warn-bg/75"
            : state === "done"
              ? "hover:bg-card opacity-80 hover:opacity-100"
              : "hover:bg-card",
      )}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="aspect-video w-18 flex-none rounded-sm object-cover"
        />
      ) : (
        <span className="bg-backdrop text-label/45 flex aspect-video w-18 flex-none items-center justify-center rounded-sm">
          <Camera aria-hidden className="size-3.5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <NoteNumber id={n.id} />
          <span className="text-primary font-mono text-xs font-semibold tabular-nums">
            {stamp(t)}
          </span>
          {needsWork && <Badge variant="open">Needs work</Badge>}
          {kind === "ask" && (
            <>
              <MessageCircleQuestion aria-hidden className="text-warn size-3.5" />
              <span className="sr-only">the AI asks</span>
            </>
          )}
          {n.remember && (
            <>
              <Bookmark aria-hidden className="text-primary size-3.5" />
              <span className="sr-only">to remember</span>
            </>
          )}
        </span>
        <span className="text-ui text-foreground/90 line-clamp-2 leading-snug wrap-anywhere">
          {n.text || "(no words)"}
        </span>
      </span>
    </button>
  );
}

function ReviewTabLabel({
  id,
  title,
  items,
}: {
  id: NoteState;
  title: string;
  items: readonly Placed[];
}) {
  const lit = useLitAny(items.map((x) => `note:${x.n.id}`));
  return (
    <span
      data-ai-lit={lit || undefined}
      className="flex items-center gap-1.5 rounded px-1 whitespace-nowrap"
    >
      {title}
      <span
        className={cn("tabular-nums", id === "check" && items.length ? "text-warn" : "text-label")}
      >
        {items.length}
      </span>
    </span>
  );
}

export function ReviewRoom() {
  useStudio((s) => s.notes);
  const roomRef = useRef<HTMLElement>(null);
  useEnterMotion(roomRef, { x: -12, y: 0, scale: 0.992, duration: 210 });
  const tab = useStudio((s) => s.reviewTab),
    pickId = useStudio((s) => s.reviewPick),
    q = useStudio((s) => s.noteSearch),
    composeOpen = useStudio((s) => !!s.compose);
  const lists = { check: reviewList("check"), open: reviewList("open"), done: reviewList("done") };
  const list = lists[tab],
    matched = list.findIndex((p) => p.n.id === pickId),
    i = Math.max(0, matched),
    p = list[i] ?? null;
  useEffect(() => {
    if (get().compose) return;
    const cur = document.activeElement;
    if (cur instanceof Node && roomRef.current?.contains(cur)) return;
    const { reviewPick, reviewTab } = get();
    const targetId = reviewPick ?? reviewList(reviewTab)[0]?.n.id ?? null;
    if (targetId) focusReviewRow(targetId);
    else roomRef.current?.focus({ preventScroll: true });
  }, []);
  // the picture beside goes to the note picked
  const pick = (to: Placed | undefined) => {
    if (!to) return;
    set({ reviewPick: to.n.id });
    goToNote(to.n);
  };
  // after an answer the note leaves this list: the one after it, else the one before, is next
  const next = () => {
    const nextId = nextReviewNeighborId(
      list.map((x) => x.n.id),
      p?.n.id ?? null,
    );
    const to = nextId ? list.find((x) => x.n.id === nextId) : undefined;
    if (to) {
      pick(to);
      focusReviewRow(to.n.id);
    } else {
      set({ reviewPick: null });
      roomRef.current?.focus({ preventScroll: true });
    }
  };
  const fixes = lists.check.filter((x) => kindOf(x.n) === "fix");
  const keys = (e: KeyboardEvent) => {
    // Global useStudioHotkeys skips <input> arrows/letters; Escape bubbles so settingsOpen -> ink -> compose -> review priority holds.
    if (!(e.target instanceof HTMLInputElement && e.target.type === "range")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (get().settingsOpen || get().ink || get().compose) return;
    if (e.key === "ArrowDown") stepReview(1);
    else if (e.key === "ArrowUp") stepReview(-1);
    else if (e.key.toLowerCase() === "a") approveReviewCurrent();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <section
      ref={roomRef}
      tabIndex={-1}
      aria-label="Review notes"
      onKeyDown={keys}
      className="bg-background upright:flex-1 upright:rounded-none sideways:rounded-none sideways:row-span-3 @container col-start-1 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg outline-none"
    >
      <header className="bg-card flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5">
        <h2 className="text-ui flex h-8 items-center gap-1.5 font-semibold">
          <ClipboardCheck aria-hidden className="text-primary size-4" />
          Review
        </h2>
        <Segmented
          label="Which notes"
          className="bg-background"
          value={tab}
          onChange={(v) => {
            const first = lists[v][0];
            set({ reviewTab: v, reviewPick: first?.n.id ?? null });
            if (first) goToNote(first.n);
          }}
          items={TABS.map((x) => ({
            id: x.id,
            title: <ReviewTabLabel id={x.id} title={x.title} items={lists[x.id]} />,
          }))}
        />
        <SearchBox
          name="review-search"
          value={q}
          onChange={(x) => set({ noteSearch: x })}
          label="Search notes"
          placeholder="Search notes…"
          className="order-last w-full flex-none @[620px]:order-none @[620px]:max-w-56 @[620px]:min-w-32 @[620px]:flex-1"
        />
        <div className="ms-auto flex items-center gap-1.5">
          <Tip label="Add a note at the playhead (M)">
            <Button
              variant="secondary"
              size="md"
              aria-label="New note"
              onClick={(e) => openNote(null, true, originOf(e.currentTarget))}
            >
              <Plus aria-hidden data-icon="inline-start" />
              Note
            </Button>
          </Tip>
          <Tip label="Back to editing (Esc or N)">
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Close Review"
              onClick={() => setReview(false)}
            >
              <X />
            </Button>
          </Tip>
        </div>
      </header>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden @2xl:flex-row",
          composeOpen && "upright:hidden",
        )}
      >
        <div className="border-border/60 flex max-h-[40%] min-h-20 flex-none flex-col border-b @2xl:max-h-none @2xl:min-h-0 @2xl:w-[clamp(13rem,34%,20rem)] @2xl:border-r @2xl:border-b-0">
          <TabStage
            activeKey={tab}
            order={["check", "open", "done"]}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {list.length > 0 ? (
              <VirtualList
                items={list}
                getKey={(x) => x.n.id}
                estimateSize={66}
                gap={2}
                role="list"
                ariaLabel="Review notes"
                stickyKeys={pickId ? [pickId] : undefined}
                scrollToIndex={matched >= 0 ? matched : null}
                className="min-h-0 flex-1 overscroll-contain p-1.5"
                renderItem={(x) => <Row p={x} on={x === p} pick={() => pick(x)} />}
              />
            ) : (
              <p className="text-ui text-muted-foreground p-3">
                {q.trim()
                  ? `No notes match “${q.trim()}”.`
                  : tab === "check"
                    ? "Nothing waits for you. Notes the AI answers land here."
                    : tab === "open"
                      ? "Nothing left to fix."
                      : "Notes you approve land here."}
              </p>
            )}
            {tab === "check" && fixes.length > 1 && (
              <div className="flex-none p-1.5">
                <Button
                  variant="secondary"
                  size="md"
                  className="w-full"
                  onClick={() => {
                    for (const x of fixes) approveNote(x.n);
                    set({ reviewPick: null });
                    roomRef.current?.focus({ preventScroll: true });
                  }}
                >
                  <Check aria-hidden data-icon="inline-start" />
                  Approve all {fixes.length} fixes
                </Button>
              </div>
            )}
          </TabStage>
          <p className="text-tag text-label flex-none px-3 pb-2 @max-2xl:hidden pointer-coarse:hidden">
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>A</Kbd> approve · <Kbd>Space</Kbd> play ·{" "}
            <Kbd>M</Kbd> new note
          </p>
        </div>
        <TabStage
          activeKey={p ? p.n.id : "empty"}
          axis="y"
          distance={6}
          duration={150}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {p ? (
            <Detail key={p.n.id} p={p} next={next} />
          ) : (
            <div className="text-ui text-muted-foreground grid flex-1 place-items-center p-6 text-center">
              Pick a note.
            </div>
          )}
        </TabStage>
      </div>
      <Compose dock inline />
    </section>
  );
}
