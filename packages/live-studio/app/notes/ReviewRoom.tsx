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
  Crosshair,
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
import { get, set, useDialogModal, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { Compose } from "./Compose";
import { noteShotTitle, pinShortLabel } from "./note-card-meta";
import { ActiveFilterChips, LearnedCallout, NoteNumber, NoteStatusGlyph } from "./note-parts";
import { formatShortDate, isCreatorNeedsWork } from "./note-views-model";
import {
  answerNote,
  approveNote,
  approveReviewCurrent,
  clearNoteFilters,
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
import type { Note, ReviewTab } from "./slice";

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
const TABS: { id: ReviewTab; title: string }[] = [
  { id: "check", title: "To check" },
  { id: "asking", title: "AI asks" },
  { id: "open", title: "To fix" },
  { id: "done", title: "Done" },
];
const pic = (rel: string) => `/api/note-img/${rel.split("/").pop()}`;

// The note's own picture over the film as it is now at that moment, split by a handle: drag it, or use the arrow keys on it
function Compare({ n, at }: { n: Note; at: number }) {
  const then = noteMedia(n).thumb;
  const fix = lastFix(n);
  const showDiff = !!fix && !fix.ask && noteState(n) !== "open";
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
  const label = "bg-scrim-strong text-picture rounded-sm px-1.5 py-0.5 text-xs font-medium";
  if (!showDiff) {
    const single = now ?? then;
    if (!single) return null;
    return (
      <div className="bg-backdrop/90 border-hairline flex w-full justify-center rounded-lg border p-2">
        <figure className="bg-backdrop ring-hairline upright:max-w-[calc(min(12rem,24dvh)*(var(--frame)))] relative aspect-(--frame) w-full max-w-[calc(min(15.5rem,32dvh)*(var(--frame)))] overflow-hidden rounded-md ring-1">
          <img
            src={single}
            alt={now ? `The film now at ${stamp(at)}` : `Saved frame at ${stamp(at)}`}
            className="absolute inset-0 size-full object-contain"
          />
          <figcaption className="pointer-events-none absolute inset-2 flex items-end justify-end">
            <span className={label}>{now ? "Current frame" : "Saved frame"}</span>
          </figcaption>
        </figure>
      </div>
    );
  }
  return (
    <div className="bg-backdrop/90 border-hairline flex w-full justify-center rounded-lg border p-2">
      <figure
        className="bg-backdrop has-focus-visible:ring-ring ring-hairline upright:max-w-[calc(min(12rem,24dvh)*(var(--frame)))] relative aspect-(--frame) w-full max-w-[calc(min(15.5rem,32dvh)*(var(--frame)))] overflow-hidden rounded-md ring-1 has-focus-visible:ring-2"
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
                <ChevronsLeftRight aria-hidden className="size-3.5" />
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(+e.target.value)}
              aria-label="Then and now: how much of the old picture shows"
              aria-valuetext={`${split}% previous frame, ${100 - split}% current frame`}
              className="peer absolute inset-0 size-full cursor-ew-resize touch-pan-y opacity-0"
            />
            <span
              aria-hidden
              className="bg-backdrop/90 text-label border-hairline-strong pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border px-2 py-0.5 text-xs opacity-0 transition-opacity duration-150 peer-focus-visible:opacity-100 motion-reduce:transition-none"
            >
              ← / → to sweep
            </span>
          </>
        )}
        <figcaption className="pointer-events-none absolute inset-x-2 top-2 flex items-center justify-between">
          {then && <span className={label}>Then</span>}
          {now && <span className={cn(label, "ms-auto")}>Now</span>}
        </figcaption>
      </figure>
    </div>
  );
}

// The other pictures saved with the note: the seconds around it, the close-up under the tap, one per drawn moment
function Pictures({ n, open }: { n: Note; open: (p: { src: string; alt: string }) => void }) {
  const media = noteMedia(n);
  const list: { src: string; alt: string; wide?: boolean }[] = [
    ...media.refs.map((src, i) => ({ src, alt: `Your picture ${i + 1}` })),
    ...(typeof n.strip === "string"
      ? [{ src: pic(n.strip), alt: "Seconds around it (-2 -1 0 +1)", wide: true }]
      : []),
    ...(media.crop ? [{ src: media.crop, alt: "Under the tap" }] : []),
    ...((n.frames as { t: number; img: string }[] | undefined) ?? []).map((f) => ({
      src: pic(f.img),
      alt: `Drawn at ${stamp(f.t)}`,
    })),
  ];
  if (!list.length) return null;
  return (
    <div className="grid w-full grid-cols-2 gap-1.5 @[440px]:grid-cols-4">
      {list.map((p) => (
        <button
          key={p.src}
          type="button"
          onClick={() => open(p)}
          aria-label={`Open ${p.alt}`}
          className={cn(
            "group/pic border-hairline bg-surface-subtle hover:border-primary/65 focus-visible:ring-ring overflow-hidden rounded-md border transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
            p.wide && "col-span-full",
          )}
        >
          <img
            src={p.src}
            alt=""
            decoding="async"
            className={cn(
              "block w-full",
              p.wide ? "bg-backdrop h-24 object-contain" : "h-18 object-cover",
            )}
          />
          <span className="text-label block truncate px-1.5 py-0.5 text-left text-xs">{p.alt}</span>
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
  const state = noteState(n);
  let lastAiIdx = -1;
  thread.forEach((entry, idx) => {
    if (entry.by === "ai") lastAiIdx = idx;
  });
  return (
    <div className="flex max-w-[65ch] flex-col gap-2">
      <ol
        className={cn("flex flex-col gap-2", thread.length > 1 && "border-hairline border-s ps-3")}
        aria-label="The conversation on this note"
      >
        {thread.map((m, i) => {
          const reworded = "reworded" in m && m.reworded;
          const isLatestAi = m.by === "ai" && i === lastAiIdx;
          const isAskingNow = isLatestAi && state === "check" && !!m.ask;
          const isPendingFix = isLatestAi && state === "check" && !m.ask;
          const isApprovedFix = isLatestAi && state === "done" && !m.ask;
          return (
            <li
              key={`${m.at}-${i}`}
              className={cn(
                "rounded-lg border px-2.5 py-2",
                reworded
                  ? "bg-surface-subtle/50 border-transparent"
                  : m.by === "creator"
                    ? "border-hairline-subtle bg-surface-subtle"
                    : isAskingNow
                      ? "border-hairline-subtle border-s-ai/85 bg-surface-subtle border-s-2"
                      : isPendingFix
                        ? "border-hairline-subtle border-s-warn/80 bg-warn-card/65 border-s-2"
                        : isApprovedFix
                          ? "border-hairline-subtle border-s-ok/75 bg-surface-subtle border-s-2"
                          : "border-hairline-subtle border-s-hairline-strong bg-surface-subtle/75 border-s-2",
              )}
            >
              <div className="text-label mb-0.5 flex items-center gap-1.5 text-xs font-semibold">
                <span
                  className={cn(
                    reworded
                      ? "text-foreground/65"
                      : isAskingNow
                        ? "text-ai-text"
                        : isPendingFix
                          ? "text-warn-text"
                          : isApprovedFix
                            ? "text-ok-text"
                            : undefined,
                  )}
                >
                  {reworded
                    ? "Previous wording"
                    : m.by === "creator"
                      ? "You"
                      : isAskingNow
                        ? "AI asks"
                        : isPendingFix
                          ? "AI says fixed"
                          : isApprovedFix
                            ? "AI fixed"
                            : m.ask
                              ? state === "done"
                                ? "AI asked"
                                : "Previous AI question"
                              : "Previous AI fix"}
                </span>
                {m.checkpoint && m.checkpoint !== "no git" && (
                  <span className="font-mono font-normal whitespace-nowrap">{m.checkpoint}</span>
                )}
                <span className="ms-auto font-mono font-normal whitespace-nowrap">
                  {when(m.at)}
                </span>
              </div>
              <p
                className={cn(
                  "text-title/[1.55] font-normal text-pretty wrap-anywhere whitespace-pre-wrap",
                  reworded ? "text-foreground/65 line-through" : "text-foreground/95",
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
          className="text-label hover:text-foreground focus-visible:ring-ring inline-flex min-h-6 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-10"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3 duration-150 motion-safe:transition-transform",
              showEdits && "rotate-180",
            )}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const scope = n.remember?.scope ?? "no";
  const label = n.remember
    ? `Remembering: ${scope === "all" ? "every film" : "this film"}`
    : "Remember";
  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <Tip
        label="Ask the AI to keep what this note teaches, as a rule for later"
        side="top"
        open={menuOpen ? false : undefined}
      >
        <DropdownMenuTrigger render={<Button variant={n.remember ? "lit" : "subtle"} size="md" />}>
          {n.remember ? (
            <BookmarkCheck aria-hidden data-icon="inline-start" />
          ) : (
            <Bookmark aria-hidden data-icon="inline-start" />
          )}
          {label}
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent
        align="end"
        finalFocus={(closedBy) => closedBy === "keyboard"}
        font="md"
        className="w-auto min-w-52"
      >
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
  useDialogModal("reviewImage", !!big);
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
      data-tone={kind === "ask" ? "ai" : noteState(n)}
      data-ai-lit={lit || undefined}
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg"
    >
      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2.5 pb-6">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <NoteNumber id={n.id} />
          <Tip label="Jump here">
            <Button variant="time" size="sm" onClick={() => goToNote(n)}>
              {stamp(t)}
            </Button>
          </Tip>
          <span className="text-ui min-w-0 flex-1 truncate" title={shot.full}>
            <span className="text-label font-medium">{shot.primary}</span>
            {shot.secondary && <span className="text-label/75"> · {shot.secondary}</span>}
          </span>
          {pinShortLabel(n.pin?.what) && (
            <Badge variant="tag" title={n.pin!.what} className="max-w-28">
              <Crosshair aria-hidden className="text-label" />
              <span className="truncate">{pinShortLabel(n.pin?.what)}</span>
            </Badge>
          )}
          <Tip label="Play from 2 s before (Space stops)">
            <Button variant="subtle" size="sm" onClick={() => playNote(n)}>
              <Play aria-hidden data-icon="inline-start" />
              Play moment
            </Button>
          </Tip>
        </div>
        {kind === "fix" && (
          <Alert variant="warn" role={undefined} className="mb-2 max-w-[65ch]">
            <ClipboardCheck aria-hidden />
            <AlertDescription size="prose" className="min-w-0 wrap-anywhere">
              AI says fixed: <span className="text-foreground">{fix?.what}</span>
            </AlertDescription>
          </Alert>
        )}
        {kind === "ask" && (
          <Alert variant="ai" role={undefined} className="mb-2 max-w-[65ch]">
            <MessageCircleQuestion aria-hidden />
            <AlertDescription size="prose" className="min-w-0 wrap-anywhere">
              AI asks: <span className="text-foreground">{fix?.what}</span>
            </AlertDescription>
          </Alert>
        )}
        <Compare n={n} at={t} />
        <div className="mt-2">
          <Pictures n={n} open={setBig} />
        </div>
        <div className="mt-2 pb-1">
          <Thread n={n} />
        </div>
        {n.learned?.what ? (
          <div className="max-w-[65ch]">
            <LearnedCallout note={n} />
          </div>
        ) : (
          n.remember && (
            <p className="text-muted-foreground mt-2 max-w-[65ch] text-sm/[1.55] text-pretty">
              Waiting for the AI to keep it as a rule: it sees your ask the next time it reads the
              notes.
            </p>
          )
        )}
      </div>
      <div className="bg-backdrop/90 border-hairline flex-none border-t p-2 @lg:p-2.5">
        <Textarea
          ref={box}
          variant="note"
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
          className="max-h-24 min-h-9 @lg:max-h-32 @lg:min-h-10"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-2 @lg:mt-2">
          {kind === "fix" && (
            <Button variant="approve" size="md" onClick={() => approveNote(n) && next()}>
              <Check aria-hidden data-icon="inline-start" />
              Approve
              <Kbd className="pointer-coarse:hidden">A</Kbd>
            </Button>
          )}
          <Button
            variant={kind === "fix" ? "subtle" : kind === "ask" ? "ai" : "default"}
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
        <DialogContent
          font="md"
          className="max-h-[94vh] overflow-y-auto sm:max-w-[min(92vw,1400px)]"
        >
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
  const firstLine = n.text.split(/\r?\n/, 1)[0]?.trim() || "";
  const rowTone = on
    ? "bg-surface-selected border border-hairline-strong border-s-2 " +
      (kind === "ask"
        ? "border-s-ai"
        : state === "check"
          ? "border-s-warn"
          : state === "done"
            ? "border-s-ok"
            : "border-s-primary")
    : cn(
        "hover:bg-surface-subtle border border-s-2 border-transparent",
        kind === "ask"
          ? "border-s-ai/80"
          : state === "check"
            ? "border-s-warn/75"
            : state === "open"
              ? "border-s-primary/65"
              : "text-foreground/78 border-s-ok/40 hover:bg-surface-subtle",
      );
  return (
    <button
      type="button"
      data-review-row={n.id}
      data-tone={kind === "ask" ? "ai" : state}
      data-ai-lit={lit || undefined}
      aria-current={on || undefined}
      onClick={pick}
      className={cn(
        "focus-visible:ring-ring studio-press flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
        rowTone,
      )}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="ring-hairline aspect-video w-18 flex-none rounded-sm object-cover ring-1"
        />
      ) : (
        <span className="bg-backdrop text-label/60 ring-hairline-subtle flex aspect-video w-18 flex-none items-center justify-center rounded-sm ring-1">
          <Camera aria-hidden className="size-3.5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <NoteStatusGlyph state={state} asking={kind === "ask"} needsWork={needsWork} />
          <NoteNumber id={n.id} />
          <span className="text-label font-mono text-xs font-medium tabular-nums">{stamp(t)}</span>
          {kind === "ask" && <span className="text-ai-text text-xs font-medium">AI asks</span>}
          {needsWork && <span className="text-primary-text text-xs font-medium">Needs work</span>}
          {n.remember && (
            <>
              <Bookmark aria-hidden className="text-ok-text size-3.5" />
              <span className="sr-only">to remember</span>
            </>
          )}
        </span>
        <span className="line-clamp-2 text-sm leading-normal font-medium">
          {firstLine || "(no words)"}
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
  id: ReviewTab;
  title: string;
  items: readonly Placed[];
}) {
  const lit = useLitAny(items.map((x) => `note:${x.n.id}`));
  return (
    <span
      data-tone={id === "asking" ? "ai" : id}
      data-ai-lit={lit || undefined}
      title={`${title} (${items.length})`}
      className="flex items-center gap-1.5 rounded whitespace-nowrap"
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          id === "check"
            ? "bg-warn"
            : id === "asking"
              ? "bg-ai"
              : id === "open"
                ? "bg-primary"
                : "bg-ok",
          !items.length && "opacity-45",
        )}
      />
      <span>{title}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          id === "check" && items.length
            ? "text-warn-text font-semibold"
            : id === "asking" && items.length
              ? "text-ai-text font-semibold"
              : id === "open" && items.length
                ? "text-primary-text font-semibold"
                : id === "done" && items.length
                  ? "text-ok-text/85 font-medium"
                  : "text-label",
        )}
      >
        {items.length}
      </span>
    </span>
  );
}

export function ReviewRoom() {
  useStudio((s) => s.notes);
  useStudio((s) => s.noteSort);
  const roomRef = useRef<HTMLElement>(null);
  useEnterMotion(roomRef, { x: -12, y: 0, scale: 0.992, duration: 210 });
  const tab = useStudio((s) => s.reviewTab),
    pickId = useStudio((s) => s.reviewPick),
    q = useStudio((s) => s.noteSearch),
    scope = useStudio((s) => s.noteScope),
    shotFilter = useStudio((s) => s.noteShot),
    facets = useStudio((s) => s.noteFacets),
    composeOpen = useStudio((s) => !!s.compose);
  useStudio((s) => (scope === "shot" ? s.shot : "")); // Follow current shot filter if locked to playhead
  const hasSideFilters = scope === "shot" || shotFilter !== null || facets.length > 0;
  const lists = {
    check: reviewList("check"),
    asking: reviewList("asking"),
    open: reviewList("open"),
    done: reviewList("done"),
  };
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
    if (
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement ||
      (e.target instanceof HTMLInputElement &&
        (e.target.type !== "range" || e.key === "ArrowUp" || e.key === "ArrowDown")) ||
      (e.target instanceof HTMLElement && e.target.isContentEditable)
    )
      return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (get().settingsOpen || get().ink || get().compose || get().modal !== null) return;
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
      className="font-md bg-background upright:flex-1 upright:rounded-none sideways:rounded-none sideways:row-span-3 @container col-start-1 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg outline-none"
    >
      <header className="bg-backdrop/90 border-hairline flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1.5">
        <h2 className="text-title flex h-8 items-center gap-1.5 font-semibold text-balance">
          <ClipboardCheck aria-hidden className="text-label size-4" />
          Review
        </h2>
        <Segmented
          label="Which notes"
          className="border-hairline bg-backdrop/75"
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
        <div className="ms-auto flex items-center gap-1.5">
          <Tip label="Add a note at the playhead (M)">
            <Button
              variant="subtle"
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
              variant="subtle"
              size="icon-lg"
              aria-label="Close Review"
              onClick={() => setReview(false)}
            >
              <X aria-hidden />
            </Button>
          </Tip>
        </div>
      </header>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden @lg:flex-row",
          composeOpen && "upright:hidden",
        )}
      >
        <div className="border-hairline bg-surface-subtle/40 flex max-h-60 min-h-20 flex-none flex-col border-b @lg:max-h-none @lg:min-h-0 @lg:w-[clamp(13rem,34%,20rem)] @lg:border-r @lg:border-b-0">
          <div className="border-hairline-subtle flex flex-none flex-col gap-1 border-b p-1.5">
            <SearchBox
              name="review-search"
              value={q}
              onChange={(x) => set({ noteSearch: x })}
              label="Search notes"
              placeholder="Search notes…"
              className="w-full"
            />
            <ActiveFilterChips />
          </div>
          <TabStage
            activeKey={tab}
            order={["check", "asking", "open", "done"]}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {list.length > 0 ? (
              <VirtualList
                items={list}
                getKey={(x) => x.n.id}
                estimateSize={74}
                gap={2}
                role="list"
                ariaLabel="Review notes"
                stickyKeys={pickId ? [pickId] : undefined}
                scrollToIndex={matched >= 0 ? matched : null}
                className="min-h-0 flex-1 overscroll-contain p-1.5"
                renderItem={(x) => <Row p={x} on={x === p} pick={() => pick(x)} />}
              />
            ) : (
              <p className="text-muted-foreground p-3 text-sm leading-relaxed text-pretty">
                {q.trim() ? (
                  `No notes match “${q.trim()}”.`
                ) : hasSideFilters ? (
                  <>
                    No notes match your active filters.{" "}
                    <Button variant="link" size="inline" onClick={clearNoteFilters}>
                      Reset filters
                    </Button>
                  </>
                ) : tab === "check" ? (
                  "Nothing waits for you. Fixes the AI finishes land here."
                ) : tab === "asking" ? (
                  "No open AI questions."
                ) : tab === "open" ? (
                  "Nothing left to fix."
                ) : (
                  "Notes you approve land here."
                )}
              </p>
            )}
            {tab === "check" && fixes.length > 1 && (
              <div className="flex-none p-1.5">
                <Button
                  variant="approve"
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
          <p className="text-label border-hairline-subtle flex flex-none flex-wrap items-center gap-x-2 gap-y-1 border-t px-3 py-1.5 text-xs @max-lg:hidden pointer-coarse:hidden">
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
            </span>
            {tab === "check" && p && kindOf(p.n) === "fix" && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Kbd>A</Kbd> approve
              </span>
            )}
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Kbd>Space</Kbd> play
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Kbd>M</Kbd> new note
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Kbd>Esc</Kbd> close
            </span>
          </p>
        </div>
        <TabStage
          activeKey={tab}
          order={["check", "asking", "open", "done"]}
          axis="x"
          distance={8}
          duration={160}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {p ? (
            <Detail key={p.n.id} p={p} next={next} />
          ) : (
            <div className="text-muted-foreground grid flex-1 place-items-center p-6 text-center text-sm leading-relaxed text-pretty">
              Pick a note.
            </div>
          )}
        </TabStage>
      </div>
      <Compose dock inline />
    </section>
  );
}
