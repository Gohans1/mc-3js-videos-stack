// The Review room: the notes alone beside the picture, in place of the timeline and the panels (N, or the button over the notes).
// It is where the creator and the AI pass a note back and forth (src/note-state.mjs): the AI fixes or asks, the creator looks at
// the moment then and now, approves, or sends words back; and may ask the AI to remember what a note teaches. Frame.io's review
// is the model (Approve / Needs work, a reply thread on the comment, compare versions with an overlay slider); CapCut has none.
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ClipboardCheck,
  MessageCircleQuestion,
  Play,
  X,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
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
import { Segmented } from "../components/inspector";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { set, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { Compose } from "./Compose";
import { noteShotTitle, pinShortLabel } from "./note-card-meta";
import {
  answerNote,
  approveNote,
  goToNote,
  noteMedia,
  nowPicture,
  type Placed,
  playNote,
  rememberNote,
  reviewList,
  setReview,
} from "./notes";
import type { Note, NoteState } from "./slice";

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const when = (at: string) => (at ? day.format(new Date(at)) : "");
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
const typing = (e: KeyboardEvent) =>
  e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;

// The note's own picture over the film as it is now at that moment, split by a handle: drag it, or use the arrow keys on it
function Compare({ n, at }: { n: Note; at: number }) {
  const then = noteMedia(n).thumb;
  // drawn by the film's renderer, outside React's render, after the room has painted: a render of the film takes a moment
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const f = requestAnimationFrame(() => setNow(nowPicture(n)));
    return () => cancelAnimationFrame(f);
  }, [n]);
  const [split, setSplit] = useState(50);
  if (!then && !now) return null;
  const label = "rounded-sm bg-black/70 px-1.5 py-0.5 text-tag font-semibold text-picture";
  return (
    <figure
      className="bg-backdrop has-focus-visible:ring-ring relative aspect-(--frame) w-full overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-white/10 has-focus-visible:ring-2"
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
          />
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
      <figcaption className="pointer-events-none absolute inset-x-2 top-2 flex justify-between">
        {then && <span className={label}>Then</span>}
        {now && <span className={cn(label, "ms-auto")}>Now</span>}
      </figcaption>
    </figure>
  );
}

// The other pictures saved with the note: the seconds around it, the close-up under the tap, one per drawn moment
function Pictures({ n, open }: { n: Note; open: (p: { src: string; alt: string }) => void }) {
  const list = [
    ...(typeof n.strip === "string"
      ? [{ src: pic(n.strip), alt: "Seconds around it (-2 -1 0 +1)" }]
      : []),
    ...(noteMedia(n).crop ? [{ src: noteMedia(n).crop!, alt: "Under the tap" }] : []),
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
          className="group/pic hover:outline-primary/85 focus-visible:ring-ring flex-none overflow-hidden rounded-md outline-1 -outline-offset-1 outline-white/12 focus-visible:ring-2"
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
  return (
    <ol className="flex flex-col gap-2" aria-label="The conversation on this note">
      {noteThread(n).map((m, i) => (
        <li
          key={`${m.at}-${i}`}
          className={cn(
            "rounded-lg px-2.5 py-2",
            m.by === "creator" ? "bg-card" : m.ask ? "bg-warn-bg" : "bg-ok/10",
          )}
        >
          <div className="text-tag text-label mb-0.5 flex items-center gap-1.5 font-semibold">
            {m.by === "creator" ? "You" : m.ask ? "AI asks" : "AI fixed"}
            {m.checkpoint && <span className="font-mono font-normal">{m.checkpoint}</span>}
            <span className="ms-auto font-normal">{when(m.at)}</span>
          </div>
          <p className="text-ui text-foreground leading-relaxed wrap-anywhere whitespace-pre-wrap">
            {m.text || <span className="text-label italic">(drawing only)</span>}
          </p>
        </li>
      ))}
    </ol>
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
    fix = lastFix(n);
  const [words, setWords] = useState("");
  const [big, setBig] = useState<{ src: string; alt: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    const w = words.trim();
    if (w && answerNote(n, w)) next();
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2.5">
        <div className="mb-2 flex items-center gap-2">
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
            <Badge variant="tag" title={n.pin!.what} className="max-w-40">
              <span className="truncate">{pinShortLabel(n.pin?.what)}</span>
            </Badge>
          )}
          <Tip label="Play from 2 s before (Space stops)">
            <Button variant="secondary" size="sm" onClick={() => playNote(n)}>
              <Play aria-hidden />
              Play moment
            </Button>
          </Tip>
        </div>
        {kind === "fix" && (
          <Callout variant="warn" className="mb-2">
            <ClipboardCheck aria-hidden />
            <span className="min-w-0 wrap-anywhere">
              The AI says it is fixed: <span className="text-foreground">{fix?.what}</span>
            </span>
          </Callout>
        )}
        {kind === "ask" && (
          <Callout variant="warn" className="mb-2">
            <MessageCircleQuestion aria-hidden />
            <span className="min-w-0 wrap-anywhere">
              The AI asks: <span className="text-foreground">{fix?.what}</span>
            </span>
          </Callout>
        )}
        <Compare n={n} at={t} />
        <div className="mt-2">
          <Pictures n={n} open={setBig} />
        </div>
        <div className="mt-2">
          <Thread n={n} />
        </div>
        {n.learned ? (
          <Callout variant="ok" className="mt-2">
            <BookmarkCheck aria-hidden />
            <span className="min-w-0 wrap-anywhere">
              The AI kept this for {n.learned.scope === "all" ? "every film" : "this film"}:{" "}
              <span className="text-foreground/95">{n.learned.what}</span>
            </span>
          </Callout>
        ) : (
          n.remember && (
            <p className="text-ui text-muted-foreground mt-2">
              Waiting for the AI to keep it as a rule: it sees your ask the next time it reads the
              notes.
            </p>
          )
        )}
      </div>
      <div className="bg-card flex-none border-t border-white/5 p-2.5">
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
          className="max-h-32 min-h-10"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {kind === "fix" && (
            <Button variant="approve" size="md" onClick={() => approveNote(n) && next()}>
              <Check aria-hidden />
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
    kind = kindOf(n);
  return (
    <li>
      <button
        type="button"
        data-review-row={n.id}
        aria-current={on || undefined}
        onClick={pick}
        className={cn(
          "focus-visible:ring-ring flex w-full items-start gap-2 rounded-lg p-1.5 text-left outline-none focus-visible:ring-2",
          on ? "bg-tint ring-primary/60 ring-1" : "hover:bg-card",
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
          <span className="bg-backdrop aspect-video w-18 flex-none rounded-sm" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-primary font-mono text-xs font-semibold tabular-nums">
              {stamp(t)}
            </span>
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
            {n.text || "(drawing only)"}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ReviewRoom() {
  useStudio((s) => s.notes);
  const tab = useStudio((s) => s.reviewTab),
    pickId = useStudio((s) => s.reviewPick),
    q = useStudio((s) => s.noteSearch);
  const lists = { check: reviewList("check"), open: reviewList("open"), done: reviewList("done") };
  const list = lists[tab],
    i = Math.max(
      0,
      list.findIndex((p) => p.n.id === pickId),
    ),
    p = list[i] ?? null;
  // the picture beside goes to the note picked
  const pick = (to: Placed | undefined) => {
    if (!to) return;
    set({ reviewPick: to.n.id });
    goToNote(to.n);
  };
  // after an answer the note leaves this list: the one after it, else the one before, is next
  const next = () => {
    const to = list[i + 1] ?? list[i - 1];
    if (to) pick(to);
    else set({ reviewPick: null });
  };
  const fixes = lists.check.filter((x) => kindOf(x.n) === "fix");
  const keys = (e: KeyboardEvent) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const to = list[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (to) {
        pick(to);
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>(`[data-review-row="${to.n.id}"]`)?.focus(),
        );
      }
    } else if (e.key.toLowerCase() === "a" && p && kindOf(p.n) === "fix") {
      if (approveNote(p.n)) next();
    } else if (e.key === "Escape") setReview(false);
    else return;
    e.preventDefault();
    e.stopPropagation(); // the editor's own A, Escape and arrows stay out of the room
  };
  return (
    <section
      aria-label="Review notes"
      onKeyDown={keys}
      className="bg-background upright:flex-1 upright:rounded-none sideways:rounded-none sideways:row-span-3 @container col-start-2 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg"
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
            set({ reviewTab: v, reviewPick: null });
            if (lists[v][0]) goToNote(lists[v][0].n);
          }}
          items={TABS.map((x) => ({
            id: x.id,
            title: (
              <span className="flex items-center gap-1.5 px-1 whitespace-nowrap">
                {x.title}
                <span
                  className={cn(
                    "tabular-nums",
                    x.id === "check" && lists.check.length ? "text-warn" : "text-label",
                  )}
                >
                  {lists[x.id].length}
                </span>
              </span>
            ),
          }))}
        />
        <SearchBox
          name="review-search"
          value={q}
          onChange={(x) => set({ noteSearch: x })}
          label="Search notes"
          placeholder="Search notes…"
          className="max-w-56 min-w-32 flex-1"
        />
        <Tip label="Back to editing (Esc or N)">
          <Button
            variant="quiet"
            size="icon-lg"
            className="ms-auto"
            aria-label="Close Review"
            onClick={() => setReview(false)}
          >
            <X />
          </Button>
        </Tip>
      </header>
      <Compose />
      <div className="flex min-h-0 flex-1 flex-col @xl:flex-row">
        <div className="flex max-h-[34%] flex-none flex-col border-b border-white/5 @xl:max-h-none @xl:w-[clamp(13rem,34%,20rem)] @xl:border-r @xl:border-b-0">
          <ul data-arrow-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            {list.map((x) => (
              <Row key={x.n.id} p={x} on={x === p} pick={() => pick(x)} />
            ))}
          </ul>
          {!list.length && (
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
                }}
              >
                <Check aria-hidden />
                Approve all {fixes.length} fixes
              </Button>
            </div>
          )}
          <p className="text-tag text-label flex-none px-3 pb-2 pointer-coarse:hidden">
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move · <Kbd>A</Kbd> approve · <Kbd>Space</Kbd> play ·{" "}
            <Kbd>M</Kbd> new note
          </p>
        </div>
        {p ? (
          <Detail key={p.n.id} p={p} next={next} />
        ) : (
          <div className="text-ui text-muted-foreground grid flex-1 place-items-center p-6 text-center">
            Pick a note.
          </div>
        )}
      </div>
    </section>
  );
}
