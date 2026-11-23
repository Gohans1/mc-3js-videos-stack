import {
  Bookmark,
  BookmarkCheck,
  Camera,
  Check,
  ChevronDown,
  ChevronsLeftRight,
  ClipboardCheck,
  Crosshair,
  Link2,
  MessageCircleQuestion,
  Play,
  Plus,
  X,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

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
import { SaveStatus, Segmented } from "../components/inspector";
import { EASE_OUT, prefersReduced } from "../components/Motion";
import { SearchBox } from "../components/SearchBox";
import { Tip } from "../components/Tip";
import { VirtualList } from "../components/VirtualList";
import { get, set, useDialogModal, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { Compose } from "./Compose";
import {
  useExitedNotes,
  useNoteExiting,
  useNoteMotion,
  useNoteSettleMotion,
} from "./note-action-motion";
import { noteShotTitle, pinShortLabel } from "./note-card-meta";
import {
  ActiveFilterChips,
  hasSelectedText,
  LearnedCallout,
  NoteExitSlot,
  NoteNumber,
  NoteStatusGlyph,
} from "./note-parts";
import { formatShortDate, isCreatorNeedsWork } from "./note-views-model";
import {
  answerNote,
  approveNote,
  approveReviewCurrent,
  clearNoteFilters,
  copyNoteLink,
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
  setReplyDraft,
  setReview,
  stepReview,
} from "./notes";
import { nextReviewNeighborId, replyStaysInList } from "./review-nav";
import type { Note, ReviewTab } from "./slice";

const when = (at: string) => (at ? formatShortDate(at) : "");
const lastFix = (n: Note) => n.fixes?.at(-1);
type Kind = "fix" | "ask" | "open" | "done";
const kindOf = (n: Note): Kind => {
  const s = noteState(n);
  return s === "check" ? (lastFix(n)?.ask ? "ask" : "fix") : s;
};
const REPLY: Record<Kind, { label: string; send: string }> = {
  fix: { label: "What still needs work", send: "Send to AI" },
  ask: { label: "Your answer to the AI", send: "Send to AI" },
  open: { label: "Add to this note", send: "Send to AI" },
  done: { label: "What needs work again", send: "Reopen and send" },
};
const TABS: { id: ReviewTab; title: string }[] = [
  { id: "check", title: "To check" },
  { id: "asking", title: "AI asks" },
  { id: "open", title: "To fix" },
  { id: "done", title: "Done" },
];
const pic = (rel: string) => `/api/note-img/${rel.split("/").pop()}`;

function Compare({ n, at }: { n: Note; at: number }) {
  const media = noteMedia(n);
  const then = media.thumb;
  const aiAfter = media.after;
  const fix = lastFix(n);
  const showDiff = !!fix && !fix.ask && noteState(n) !== "open";
  const loading = useStudio((s) => s.loading),
    final = useStudio((s) => s.final),
    pictureRev = useStudio((s) => s.pictureRev);
  const nowKey = `${n.id}|${at.toFixed(3)}|${final ? 1 : 0}|${pictureRev}`;
  const [liveNowState, setLiveNowState] = useState<{ key: string; url: string | null } | null>(
    null,
  );
  const liveNow = liveNowState?.key === nowKey ? liveNowState.url : null;
  const afterKey = `${n.id}|${aiAfter ?? ""}`;
  const [preferLiveKey, setPreferLiveKey] = useState<string | null>(null);
  const preferLive = preferLiveKey === afterKey;
  useEffect(() => {
    if (!then || !showDiff) return;
    let alive = true;
    const f = requestAnimationFrame(() => {
      void nowPicture(n).then((url) => {
        if (alive) setLiveNowState({ key: nowKey, url });
      });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(f);
    };
  }, [n, at, final, loading, nowKey, pictureRev, showDiff, then]);
  const [split, setSplit] = useState(50);
  const now = aiAfter && !preferLive ? aiAfter : liveNow;
  const nowBadge = aiAfter && !preferLive ? "After" : "Now";
  if (!then && !aiAfter) return null;
  if (!then && aiAfter) {
    return (
      <div className="bg-backdrop/90 border-hairline flex w-full flex-col items-center gap-1.5 rounded-lg border p-2">
        <figure className="bg-backdrop upright:max-w-[calc(min(12rem,24dvh)*(var(--frame)))] note-image-outline relative aspect-(--frame) w-full max-w-[calc(min(15.5rem,32dvh)*(var(--frame)))] overflow-hidden rounded-md">
          <img
            src={aiAfter}
            alt={`After proof at ${stamp(media.afterTime ?? at)}`}
            className="absolute inset-0 size-full object-contain"
          />
          <figcaption className="pointer-events-none absolute inset-2 flex items-start justify-end">
            <Badge variant="frame">After</Badge>
          </figcaption>
        </figure>
        {(media.afterCam || media.afterTime !== null) && (
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => goToNote(n, false, "after")}
          >
            <Crosshair aria-hidden data-icon="inline-start" />
            Jump to After camera
          </Button>
        )}
      </div>
    );
  }
  if (!showDiff) {
    return (
      <>
        <div className="bg-backdrop/90 border-hairline flex w-full justify-center rounded-lg border p-2">
          <figure className="bg-backdrop upright:max-w-[calc(min(12rem,24dvh)*(var(--frame)))] note-image-outline relative aspect-(--frame) w-full max-w-[calc(min(15.5rem,32dvh)*(var(--frame)))] overflow-hidden rounded-md">
            <img
              src={then!}
              alt={`Saved frame at ${stamp(at)}`}
              className="absolute inset-0 size-full object-contain"
            />
            <figcaption className="pointer-events-none absolute inset-2 flex items-end justify-end">
              <Badge variant="frame">Saved frame</Badge>
            </figcaption>
          </figure>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="bg-backdrop/90 border-hairline flex w-full flex-col items-center gap-1.5 rounded-lg border p-2">
        <figure
          className="bg-backdrop has-focus-visible:ring-ring upright:max-w-[calc(min(12rem,24dvh)*(var(--frame)))] note-image-outline relative aspect-(--frame) w-full max-w-[calc(min(15.5rem,32dvh)*(var(--frame)))] overflow-hidden rounded-md has-focus-visible:ring-2"
          style={{ "--split": `${split}%`, "--hide": `${100 - split}%` }}
        >
          {now && (
            <img
              src={now}
              alt={
                aiAfter && !preferLive
                  ? `After proof at ${stamp(media.afterTime ?? at)}`
                  : `The film now at ${stamp(at)}`
              }
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
            {then && <Badge variant="frame">Before</Badge>}
            {now && (
              <Badge variant="frame" className="ms-auto">
                {nowBadge}
              </Badge>
            )}
          </figcaption>
        </figure>
        {(aiAfter && liveNow) || media.afterCam || media.afterTime !== null ? (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {aiAfter && liveNow && (
              <Button
                type="button"
                variant="subtle"
                size="sm"
                onClick={() => setPreferLiveKey((k) => (k === afterKey ? null : afterKey))}
              >
                {preferLive ? "Show AI after shot" : "Compare live scene"}
              </Button>
            )}
            {(media.afterCam || media.afterTime !== null) && (
              <>
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  onClick={() => goToNote(n, false, "before")}
                >
                  Original view
                </Button>
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  onClick={() => goToNote(n, false, "after")}
                >
                  <Crosshair aria-hidden data-icon="inline-start" />
                  After camera
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

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
            "group/pic border-hairline bg-surface-subtle hover:border-primary/65 focus-visible:ring-ring cursor-pointer overflow-hidden rounded-md border transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
            p.wide && "col-span-full",
          )}
        >
          <img
            src={p.src}
            alt=""
            decoding="async"
            className={cn(
              "note-image-outline block w-full",
              p.wide ? "bg-backdrop h-24 object-contain" : "h-18 object-cover",
            )}
          />
          <span className="text-label block truncate px-1.5 py-0.5 text-start text-xs">
            {p.alt}
          </span>
        </button>
      ))}
    </div>
  );
}

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
                  <span className="font-mono font-normal whitespace-nowrap tabular-nums">
                    {m.checkpoint}
                  </span>
                )}
                <span className="ms-auto font-mono font-normal whitespace-nowrap tabular-nums">
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
              {"noAfterReason" in m && m.noAfterReason && (
                <p className="text-muted-foreground mt-1 text-xs">
                  No after image: {m.noAfterReason}
                </p>
              )}
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
              Don’t remember
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Detail({
  p,
  next,
  enterMotion,
}: {
  p: Placed;
  next: () => void;
  enterMotion: "action" | "pick" | null;
}) {
  const { n, t } = p,
    kind = kindOf(n),
    state = noteState(n),
    wrapRef = useRef<HTMLDivElement>(null),
    shot = noteShotTitle(n.shot, n.shotName),
    fix = lastFix(n),
    lit = useLit(`note:${n.id}`),
    media = noteMedia(n),
    hasPictures =
      Boolean(media.thumb) ||
      Boolean(media.after) ||
      media.refs.length > 0 ||
      typeof n.strip === "string" ||
      Boolean(media.crop) ||
      ((n.frames as unknown[] | undefined)?.length ?? 0) > 0;
  const aiSummary =
    kind === "fix" ? (
      <Alert variant="warn" role={undefined} className="mb-2 max-w-[65ch]">
        <ClipboardCheck aria-hidden />
        <AlertDescription size="prose" className="min-w-0 wrap-anywhere">
          AI says fixed: <span className="text-foreground">{fix?.what}</span>
          {fix?.noAfterReason && (
            <span className="text-muted-foreground mt-0.5 block text-xs">
              No after image: {fix.noAfterReason}
            </span>
          )}
        </AlertDescription>
      </Alert>
    ) : kind === "ask" ? (
      <Alert variant="ai" role={undefined} className="mb-2 max-w-[65ch]">
        <MessageCircleQuestion aria-hidden />
        <AlertDescription size="prose" className="min-w-0 wrap-anywhere">
          AI asks: <span className="text-foreground">{fix?.what}</span>
        </AlertDescription>
      </Alert>
    ) : null;
  const newBuild = useStudio((s) => s.newBuild);
  const words = useStudio((s) => s.replyDrafts.get(n.id) ?? "");
  const replyId = useId();
  const [big, setBig] = useState<{ src: string; alt: string } | null>(null);
  useDialogModal("reviewImage", !!big);
  const box = useRef<HTMLTextAreaElement>(null);
  useNoteSettleMotion(wrapRef, n.id, state);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!enterMotion || !el || typeof el.animate !== "function") return;
    const reduced = prefersReduced();
    const anim = reduced
      ? el.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 100, easing: EASE_OUT })
      : enterMotion === "action"
        ? el.animate(
            [
              { opacity: 0.25, transform: "translate3d(12px, 0, 0) scale(0.992)" },
              { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
            ],
            { duration: 185, easing: EASE_OUT },
          )
        : el.animate(
            [
              { opacity: 0.65, transform: "translate3d(0, 4px, 0)" },
              { opacity: 1, transform: "translate3d(0, 0, 0)" },
            ],
            { duration: 140, easing: EASE_OUT },
          );
    return () => anim.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const send = () => {
    const w = words.trim();
    if (!w || !answerNote(n, w)) return;
    setReplyDraft(n.id, "");
    if (!replyStaysInList(kind)) next();
  };
  return (
    <div
      ref={wrapRef}
      data-note={n.id}
      data-tone={kind === "ask" ? "ai" : state}
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
            {shot.secondary && <span className="text-muted-foreground"> · {shot.secondary}</span>}
          </span>
          {pinShortLabel(n.pin?.what) && (
            <Badge variant="tag" title={n.pin!.what} className="max-w-28">
              <Crosshair aria-hidden className="text-label" />
              <span className="truncate">{pinShortLabel(n.pin?.what)}</span>
            </Badge>
          )}
          <Tip label="Copy note link">
            <Button
              variant="quiet"
              size="icon-sm"
              aria-label="Copy note link"
              onClick={() => void copyNoteLink(n)}
            >
              <Link2 aria-hidden />
            </Button>
          </Tip>
          <Tip label="Play from 2 s before (Space stops)">
            <Button variant="subtle" size="sm" onClick={() => playNote(n)}>
              <Play aria-hidden data-icon="inline-start" />
              Play moment
            </Button>
          </Tip>
        </div>
        {newBuild && (
          <Alert className="mb-2 max-w-[65ch]">
            <AlertDescription>
              New preview build available. Now shows the loaded version until you use Reload in the
              player.
            </AlertDescription>
          </Alert>
        )}
        {hasPictures && aiSummary}
        <Compare key={n.id} n={n} at={t} />
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
            <p className="text-muted-foreground text-title/[1.55] mt-2 max-w-[65ch] text-pretty">
              Waiting for the AI to keep it as a rule: it sees your ask the next time it reads the
              notes.
            </p>
          )
        )}
      </div>
      <div className="bg-backdrop/90 border-hairline flex-none border-t p-2 @lg:p-2.5">
        <div className="text-ui mb-1 flex flex-wrap items-center justify-between gap-x-2">
          <label htmlFor={replyId} className="text-label font-medium">
            {REPLY[kind].label}
          </label>
          <span id={replyId + "-hint"} className="text-muted-foreground">
            Enter sends · Shift+Enter adds a line
          </span>
        </div>
        <Textarea
          id={replyId}
          ref={box}
          variant="note"
          name="reply"
          aria-describedby={replyId + "-hint"}
          value={words}
          onChange={(e) => setReplyDraft(n.id, e.target.value)}
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
              className="note-image-outline block h-auto max-h-[78vh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ p, on, pick }: { p: Placed; on: boolean; pick: () => void }) {
  const { n, t } = p,
    media = noteMedia(n),
    thumb = media.thumb ?? media.after,
    kind = kindOf(n),
    state = noteState(n),
    needsWork = isCreatorNeedsWork(n, state),
    lit = useLit(`note:${n.id}`),
    exiting = useNoteExiting(),
    { ref: rowMotionRef } = useNoteMotion<HTMLDivElement>(n.id, state);
  const firstLine = n.text.split(/\r?\n/, 1)[0]?.trim() || "";
  const rowTone = on
    ? cn(
        "bg-surface-selected border-hairline-strong border border-s-2",
        kind === "ask"
          ? "border-s-ai"
          : state === "check"
            ? "border-s-warn"
            : state === "done"
              ? "border-s-ok"
              : "border-s-primary",
      )
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
    <div
      ref={rowMotionRef}
      data-tone={kind === "ask" ? "ai" : state}
      data-ai-lit={lit || undefined}
      onClick={(e) => {
        if (hasSelectedText() || (e.target instanceof Element && e.target.closest("button, a"))) {
          return;
        }
        pick();
      }}
      className={cn(
        "has-[[data-review-row]:focus-visible]:ring-ring flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-start transition-colors has-[[data-review-row]:focus-visible]:ring-2 motion-reduce:transition-none",
        rowTone,
      )}
    >
      <button
        type="button"
        data-review-row={exiting ? undefined : n.id}
        aria-current={on || undefined}
        aria-label={`Select note at ${stamp(t)}${firstLine ? `: ${firstLine}` : ""}`}
        onClick={pick}
        className="studio-press shrink-0 cursor-pointer rounded-sm outline-none"
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="note-image-outline aspect-video w-18 flex-none rounded-sm object-cover"
          />
        ) : (
          <span className="bg-backdrop text-muted-foreground ring-hairline-subtle flex aspect-video w-18 flex-none items-center justify-center rounded-sm ring-1">
            <Camera aria-hidden className="size-3.5" />
          </span>
        )}
      </button>
      <div className="min-w-0 flex-1 cursor-text select-text">
        <div className="flex flex-wrap items-center gap-1.5">
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
        </div>
        <p className="line-clamp-2 text-sm leading-normal font-medium wrap-anywhere">
          {firstLine || "(no words)"}
        </p>
      </div>
    </div>
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
  const saved = useStudio((s) => s.saved);
  const roomRef = useRef<HTMLElement>(null);
  const [detailEnterMotion, setDetailEnterMotion] = useState<"action" | "pick" | null>(null);
  const tab = useStudio((s) => s.reviewTab),
    pickId = useStudio((s) => s.reviewPick),
    q = useStudio((s) => s.noteSearch),
    scope = useStudio((s) => s.noteScope),
    shotFilter = useStudio((s) => s.noteShot),
    facets = useStudio((s) => s.noteFacets),
    composeOpen = useStudio((s) => !!s.compose);
  useStudio((s) => (scope === "shot" ? s.shot : ""));
  const hasSideFilters = scope === "shot" || shotFilter !== null || facets.length > 0;
  const lists = {
    check: reviewList("check"),
    asking: reviewList("asking"),
    open: reviewList("open"),
    done: reviewList("done"),
  };
  const list = lists[tab],
    displayList = useExitedNotes(
      list,
      (x) => x.n.id,
      `review|${tab}|${q}|${scope}|${shotFilter ?? ""}|${facets.join(",")}`,
    ),
    matched = displayList.findIndex((e) => !e.exiting && e.item.n.id === pickId),
    listIdx = pickId === null ? 0 : list.findIndex((p) => p.n.id === pickId),
    p = list[listIdx] ?? null;
  useEffect(() => {
    if (get().compose) return;
    const cur = document.activeElement;
    if (cur instanceof Node && roomRef.current?.contains(cur)) return;
    const { reviewPick, reviewTab } = get();
    const targetId = reviewPick ?? reviewList(reviewTab)[0]?.n.id ?? null;
    if (targetId) focusReviewRow(targetId);
    else roomRef.current?.focus({ preventScroll: true });
  }, []);
  const pick = (to: Placed | undefined, motion: "action" | "pick" | null = "pick") => {
    if (!to) return;
    setDetailEnterMotion(motion);
    set({ reviewPick: to.n.id });
    goToNote(to.n);
  };
  const next = () => {
    const nextId = nextReviewNeighborId(
      list.map((x) => x.n.id),
      p?.n.id ?? null,
    );
    const to = nextId ? list.find((x) => x.n.id === nextId) : undefined;
    if (to) {
      pick(to, "action");
      focusReviewRow(to.n.id);
    } else {
      setDetailEnterMotion(null);
      set({ reviewPick: null });
      roomRef.current?.focus({ preventScroll: true });
    }
  };
  const fixes = lists.check.filter((x) => kindOf(x.n) === "fix");
  const search = (noteSearch: string) => {
    setDetailEnterMotion(null);
    set({ noteSearch });
    const { reviewTab, reviewPick } = get();
    const matching = reviewList(reviewTab);
    if (matching.some(({ n }) => n.id === reviewPick)) return;
    const first = matching[0];
    set({ reviewPick: first?.n.id ?? null });
    if (first) goToNote(first.n);
  };
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
    if (e.key === "ArrowDown") {
      setDetailEnterMotion(null);
      stepReview(1);
    } else if (e.key === "ArrowUp") {
      setDetailEnterMotion(null);
      stepReview(-1);
    } else if (e.key.toLowerCase() === "a") {
      setDetailEnterMotion("action");
      approveReviewCurrent();
    } else return;
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
        <h2 className="flex min-h-8 items-center gap-1.5 text-lg leading-tight font-semibold tracking-tight text-balance">
          <ClipboardCheck aria-hidden className="text-label size-4" />
          Review
        </h2>
        <Segmented
          label="Review status"
          className="border-hairline bg-backdrop/75 [&_.segmented-pill]:transition-none"
          value={tab}
          onChange={(v) => {
            const first = lists[v][0];
            setDetailEnterMotion(null);
            set({ reviewTab: v, reviewPick: first?.n.id ?? null });
            if (first) goToNote(first.n);
          }}
          items={TABS.map((x) => ({
            id: x.id,
            title: <ReviewTabLabel id={x.id} title={x.title} items={lists[x.id]} />,
          }))}
        />
        <div className="ms-auto flex items-center gap-1.5">
          <SaveStatus state={saved} failText="Not sent. Retrying…" hideWhenIdle />
          <Tip label="Add a note at the playhead (M)">
            <Button
              variant="subtle"
              size="md"
              aria-label="New note"
              onClick={(e) => openNote(null, true, originOf(e.currentTarget))}
            >
              <Plus aria-hidden data-icon="inline-start" />
              New note
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
              onChange={search}
              label="Search notes"
              placeholder="Search notes…"
              className="w-full"
            />
            <ActiveFilterChips />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {displayList.length > 0 ? (
              <VirtualList
                items={displayList}
                getKey={(entry) => entry.key}
                estimateSize={74}
                gap={2}
                role="list"
                ariaLabel="Review notes"
                stickyKeys={pickId ? [pickId] : undefined}
                scrollToIndex={matched >= 0 ? matched : null}
                className="min-h-0 flex-1 overscroll-contain p-1.5"
                renderItem={(entry) => {
                  const node = (
                    <Row
                      p={entry.item}
                      on={!entry.exiting && entry.item === p}
                      pick={() => pick(entry.item, "pick")}
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
            ) : (
              <p className="text-muted-foreground p-3 text-sm leading-relaxed text-pretty">
                {q.trim() ? (
                  <>
                    No notes match “{q.trim()}”.{" "}
                    <Button
                      variant="link"
                      size="inline"
                      onClick={() => {
                        search("");
                        roomRef.current
                          ?.querySelector<HTMLInputElement>('input[name="review-search"]')
                          ?.focus();
                      }}
                    >
                      Clear search
                    </Button>
                  </>
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
                  <span className="tabular-nums">Approve all {fixes.length} fixes</span>
                </Button>
              </div>
            )}
          </div>
          <p className="text-muted-foreground border-hairline-subtle flex flex-none flex-wrap items-center gap-x-2 gap-y-1 border-t px-3 py-1.5 text-xs @max-lg:hidden pointer-coarse:hidden">
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {p && <Detail key={p.n.id} p={p} next={next} enterMotion={detailEnterMotion} />}
        </div>
      </div>
      <Compose dock inline />
    </section>
  );
}
