import {
  Bookmark,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Columns2,
  Crosshair,
  Image as ImageIcon,
  MessageCircleQuestion,
  MessageSquarePlus,
  PenLine,
  Send,
  Video,
  ZoomIn,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Empty as UiEmpty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { rangeText, stamp } from "../core/time.ts";
import {
  formatShortDate,
  inkWords,
  noteActionTarget,
  noteRangePill,
  noteShotTitle,
  pinShortLabel,
  resolveNoteMedia,
  summarizeNoteThread,
} from "./model.ts";
import { playback } from "./playback.ts";
import { lite, liteCatalogVideosOf, liteNoteSavingOf, liteVideoPathOf, useLite } from "./store.ts";
import type { Fix, Note, NoteState } from "./types.ts";

export const jumpToNote = (note: Note, useAfter = false) => {
  const s = lite.store.getState();
  if (liteNoteSavingOf(s)) return;
  playback.pause();
  const media = resolveNoteMedia(note, lite.getUnsentNotes());
  const targetTime = useAfter && media.afterTime !== null ? media.afterTime : note.t;
  if (note.compareVideo?.path && s.catalog.videos.some((v) => v.path === note.compareVideo!.path)) {
    if (liteVideoPathOf(s) !== note.compareVideo.path) {
      playback.seekAfterClipChange(targetTime);
      lite.selectVideo(note.compareVideo.path);
      return;
    }
  }
  playback.seek(targetTime);
};

const cycleRememberScope = (note: Note): "film" | "all" | null => {
  if (!note.remember) return "film";
  if (note.remember.scope === "film") return "all";
  return null;
};

export const surfaceClass = (
  state: NoteState,
  opts: { editing?: boolean; asking?: boolean },
): string => {
  const base =
    state === "check" && opts.asking
      ? "border-ai/35 bg-ai/8"
      : state === "check"
        ? "border-warn/40 bg-warn-card/80"
        : state === "done"
          ? "border-hairline-subtle bg-surface-subtle/50 text-foreground/78"
          : "border-primary/35 bg-tint";
  const ring = opts.editing ? "border-warn/85 ring-1 ring-warn/35" : "";
  return cn(
    "group/card relative rounded-md border px-2 py-1.5 transition-colors duration-150 motion-reduce:transition-none",
    base,
    ring,
  );
};

export function StatusGlyph({
  state,
  asking = false,
  needsWork = false,
}: {
  state: NoteState;
  asking?: boolean;
  needsWork?: boolean;
}) {
  const Icon =
    state === "check"
      ? asking
        ? MessageCircleQuestion
        : ClipboardCheck
      : state === "done"
        ? CheckCircle2
        : needsWork
          ? MessageSquarePlus
          : CircleDot;
  const color =
    state === "check"
      ? asking
        ? "text-ai-text"
        : "text-warn-text"
      : state === "done"
        ? "text-ok-text"
        : "text-primary-text";
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", color)} />;
}

const statusLabel = (state: NoteState, asking = false, needsWork = false): string =>
  state === "check" && asking
    ? "AI asks"
    : state === "open" && needsWork
      ? "Needs work"
      : state === "check"
        ? "To check"
        : state === "done"
          ? "Done"
          : "To fix";

const statusTextClass = (state: NoteState, asking = false, needsWork = false): string =>
  state === "check"
    ? asking
      ? "text-ai-text"
      : "text-warn-text"
    : state === "done"
      ? "text-ok-text"
      : needsWork
        ? "text-primary-text font-semibold"
        : "text-primary-text";

export function NoteCardHeader({
  note,
  num,
  state,
  asking = false,
  needsWork = false,
}: {
  note: Note;
  num: number | null;
  state: NoteState;
  asking?: boolean;
  needsWork?: boolean;
}) {
  const st = noteShotTitle(note.shot, note.shotName);
  const timeText = stamp(note.t);
  const target = noteActionTarget(num, timeText);
  return (
    <div className="flex min-h-5 flex-nowrap items-center gap-1">
      {num != null && (
        <span className="text-label shrink-0 font-mono text-xs leading-none font-medium tabular-nums">
          #{num}
        </span>
      )}
      <span className="inline-flex shrink-0 items-center gap-1">
        <StatusGlyph state={state} asking={asking} needsWork={needsWork} />
        <span className={cn("text-xs font-medium whitespace-nowrap", statusTextClass(state, asking, needsWork))}>
          {statusLabel(state, asking, needsWork)}
        </span>
      </span>
      <button
        type="button"
        aria-label={`Jump to ${target}`}
        onClick={(e) => {
          e.stopPropagation();
          jumpToNote(note, false);
        }}
        className="text-label hover:bg-tint hover:text-primary-text hover:border-primary/45 focus-visible:ring-ring border-hairline bg-surface-subtle text-tag relative inline-flex h-6 min-h-6 min-w-6 shrink-0 cursor-pointer items-center justify-center rounded border px-1 font-mono leading-none font-medium tracking-tight tabular-nums transition-colors outline-none after:absolute after:-inset-x-0.5 after:-inset-y-px focus-visible:ring-2"
      >
        {timeText}
      </button>
      <span
        className={cn(
          "me-auto min-w-0 flex-1 truncate text-xs",
          state === "done" ? "text-muted-foreground" : "text-label",
        )}
        title={st.full}
      >
        <span className={cn("font-medium", state === "done" ? "text-muted-foreground" : "text-label")}>
          {st.primary}
        </span>
        {st.secondary && <span className="text-muted-foreground"> · {st.secondary}</span>}
      </span>
    </div>
  );
}

export function ExpandableText({
  text,
  clampLines,
  onTap,
}: {
  text: string;
  clampLines: 1 | 2;
  onTap: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [el, setEl] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!el || !text) return;
    const measure = () => {
      if (!expanded) setClipped(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, text, expanded]);

  if (!text) {
    return (
      <p
        onClick={onTap}
        className="text-label text-ui/[1.35] min-h-5 cursor-pointer italic"
      >
        (no words)
      </p>
    );
  }

  return (
    <div className="max-w-[65ch] min-w-0">
      <p
        ref={setEl}
        onClick={onTap}
        className={cn(
          "text-ui/[1.35] block cursor-pointer font-normal wrap-anywhere whitespace-pre-wrap",
          !expanded && (clampLines === 1 ? "line-clamp-1" : "line-clamp-2"),
        )}
      >
        {text}
      </p>
      {(clipped || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="text-label hover:text-primary-text relative mt-0.5 inline-flex min-h-6 cursor-pointer items-center rounded-sm text-xs font-medium"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function RefsChip({ note, count }: { note: Note; count: number }) {
  const [open, setOpen] = useState(false);
  const refs = open ? resolveNoteMedia(note, lite.getUnsentNotes()).refs : [];
  return (
    <>
      <Badge
        variant="refs-dense"
        render={
          <button
            type="button"
            aria-label={`Open ${count} attached ${count === 1 ? "picture" : "pictures"}`}
          />
        }
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <ImageIcon aria-hidden className="text-label" />
        {count} picture{count > 1 ? "s" : ""}
      </Badge>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          font="md"
          className="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-[min(94vw,640px)]"
        >
          <DialogTitle>Pictures on note at {note.time}</DialogTitle>
          <div className="flex flex-col gap-2">
            {refs.map((src, i) => (
              <img
                key={`${src}-${i}`}
                src={src}
                alt={`Reference ${i + 1}`}
                className="note-image-outline block h-auto max-h-[70dvh] w-full rounded object-contain"
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NoteTags({ note }: { note: Note }) {
  const videos = useLite(liteCatalogVideosOf);
  const pinName = pinShortLabel(note.pin?.what);
  const range = noteRangePill(note);
  const marks = note.marks;
  const hasMarks = Boolean(marks?.length);
  const refsCount = resolveNoteMedia(note, lite.getUnsentNotes()).refs.length;
  const compareFile = note.compareVideo?.path
    ? note.compareVideo.path.split("/").pop() || note.compareVideo.path
    : null;
  const hasVideoInCatalog = Boolean(
    note.compareVideo?.path && videos.some((v) => v.path === note.compareVideo!.path),
  );
  const showRemember = Boolean(
    note.remember && !(note.learned?.what && note.remember.scope === note.learned.scope),
  );
  if (!pinName && !range && !note.freeCam && !compareFile && !hasMarks && !refsCount && !showRemember) {
    return null;
  }
  return (
    <div className="[&_[data-slot=badge]]:text-tag mt-1 flex flex-wrap items-center gap-1 [&_[data-slot=badge]]:py-0">
      {showRemember && note.remember && (
        <Badge variant="tag" className="max-w-full">
          <Bookmark aria-hidden className="text-ok-text" />
          <span>Remember · {note.remember.scope === "all" ? "every film" : "this film"}</span>
        </Badge>
      )}
      {compareFile &&
        (hasVideoInCatalog ? (
          <Badge
            variant="refs-dense"
            className="max-w-44"
            render={
              <button
                type="button"
                aria-label={`Open ${compareFile}`}
              />
            }
            onClick={(e) => {
              e.stopPropagation();
              jumpToNote(note, false);
            }}
          >
            <Columns2 aria-hidden className="text-label" />
            <span className="truncate">{compareFile}</span>
          </Badge>
        ) : (
          <Badge variant="refs-dense" className="max-w-44">
            <Columns2 aria-hidden className="text-label" />
            <span className="truncate">{compareFile}</span>
          </Badge>
        ))}
      {pinName && (
        <Badge variant="tag" title={note.pin!.what} className="max-w-44">
          <Crosshair aria-hidden className="text-label" />
          <span className="truncate">{pinName}</span>
        </Badge>
      )}
      {range && <Badge variant="inOut">{rangeText(range)}</Badge>}
      {note.freeCam && (
        <Badge variant="tag">
          <Video aria-hidden className="text-label" />
          Free cam
        </Badge>
      )}
      {refsCount > 0 && <RefsChip note={note} count={refsCount} />}
      {hasMarks && marks && (
        <Badge variant="ink">
          <PenLine aria-hidden />
          <span className="wrap-anywhere">{inkWords(marks)}</span>
        </Badge>
      )}
    </div>
  );
}

export function NoteThumb({ note, muted = false }: { note: Note; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  const media = resolveNoteMedia(note, lite.getUnsentNotes());
  const cover = media.thumb ?? media.after;
  if (!cover) return null;
  const hasBoth = Boolean(media.thumb && media.after);
  const timeText = stamp(note.t);
  return (
    <>
      <button
        type="button"
        aria-label={`Preview frame at ${timeText}${hasBoth ? " (Before and After)" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "group/thumb bg-backdrop focus-visible:ring-ring relative aspect-video w-12 flex-none cursor-pointer overflow-hidden rounded-md shadow-xs outline-1 -outline-offset-1 outline-transparent focus-visible:ring-2",
          muted && "opacity-75",
        )}
      >
        <img
          src={cover}
          loading="lazy"
          decoding="async"
          alt=""
          className="note-image-outline block size-full object-contain"
        />
        {hasBoth && (
          <span
            aria-hidden
            className="text-picture bg-scrim-strong text-tag pointer-events-none absolute bottom-0.5 left-0.5 rounded-sm px-1 py-px leading-none font-semibold"
          >
            B/A
          </span>
        )}
        <span
          aria-hidden
          className="text-picture/85 bg-scrim pointer-events-none absolute right-0.5 bottom-0.5 flex size-4 items-center justify-center rounded-sm"
        >
          <ZoomIn className="size-2.5" />
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          font="md"
          className="max-h-[92dvh] overflow-y-auto overscroll-contain sm:max-w-[min(94vw,680px)]"
        >
          <DialogTitle>
            Frame at {timeText}
            {note.pin?.what ? ` · ${note.pin.what}` : ""}
          </DialogTitle>
          <div className="flex flex-col gap-2">
            {media.thumb && (
              <div className="relative overflow-hidden rounded-lg bg-black">
                <img
                  src={media.thumb}
                  alt={`Frame at ${timeText}`}
                  className="note-image-outline block max-h-[55dvh] w-full object-contain"
                />
                {hasBoth && (
                  <Badge variant="frame" className="pointer-events-none absolute top-1.5 left-1.5">
                    Before
                  </Badge>
                )}
                {media.crop && (
                  <img
                    src={media.crop}
                    alt="Zoomed pin detail"
                    className="border-primary/75 bg-backdrop note-image-outline absolute bottom-1.5 left-1.5 size-16 rounded-md border object-cover shadow-md"
                  />
                )}
              </div>
            )}
            {media.after && (
              <div className="relative overflow-hidden rounded-lg bg-black">
                <img
                  src={media.after}
                  alt={`After proof at ${stamp(media.afterTime ?? note.t)}`}
                  className="note-image-outline block max-h-[55dvh] w-full object-contain"
                />
                <Badge variant="frame" className="pointer-events-none absolute top-1.5 left-1.5">
                  After
                  {media.afterTime !== null && Math.abs(media.afterTime - note.t) >= 0.01
                    ? ` (${stamp(media.afterTime)})`
                    : ""}
                </Badge>
              </div>
            )}
            {media.noAfterReason && (
              <p className="text-muted-foreground text-xs">
                No after image: {media.noAfterReason}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                size="phone-cta"
                onClick={() => {
                  setOpen(false);
                  jumpToNote(note, false);
                }}
              >
                Jump to {timeText}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NoteFollowups({ note, state }: { note: Note; state: NoteState }) {
  const { activeAsk, activeFix, prior } = summarizeNoteThread(note, state);
  const [histOpen, setHistOpen] = useState(false);

  const renderFix = (fix: Fix) => {
    const dateLabel = formatShortDate(fix.at);
    const cp = fix.checkpoint && fix.checkpoint !== "no git" ? fix.checkpoint : "";
    const prefix =
      state === "open"
        ? fix.ask
          ? "Previous AI question: "
          : "Previous AI fix: "
        : state === "check"
          ? fix.ask
            ? "AI asks: "
            : "AI says fixed: "
          : fix.ask
            ? "AI asked: "
            : "AI fixed: ";
    const cls =
      state === "open"
        ? "text-label"
        : fix.ask
          ? "text-ai-text"
          : state === "check"
            ? "text-warn-text"
            : "text-ok-text";
    return (
      <p className="text-ui mt-1 max-w-[65ch] leading-normal text-pretty wrap-anywhere">
        <span className={cn("font-medium", cls)}>{prefix}</span>
        <span className="text-foreground/90">{fix.what}</span>
        {(cp || dateLabel) && (
          <span className="text-muted-foreground ms-1 font-mono text-xs whitespace-nowrap tabular-nums">
            {cp && dateLabel ? `· ${cp} · ${dateLabel}` : cp ? `· ${cp}` : dateLabel}
          </span>
        )}
        {fix.noAfterReason && (
          <span className="text-muted-foreground mt-0.5 block text-xs">
            No after image: {fix.noAfterReason}
          </span>
        )}
      </p>
    );
  };

  return (
    <>
      {prior.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            aria-expanded={histOpen}
            onClick={(e) => {
              e.stopPropagation();
              setHistOpen((v) => !v);
            }}
            className="text-label hover:text-foreground inline-flex min-h-6 cursor-pointer items-center gap-1 rounded px-0.5 text-xs font-medium"
          >
            <ChevronDown
              aria-hidden
              className={cn("size-3 transition-transform duration-150", histOpen && "rotate-180")}
            />
            <span className="tabular-nums">
              History ({prior.length} prior {prior.length === 1 ? "entry" : "entries"})
            </span>
          </button>
          {histOpen && (
            <div className="border-border/60 mt-1 flex flex-col gap-1 border-s ps-2">
              {prior.map((item, i) => (
                <div key={`${item.at}-${i}`} className="text-ui leading-normal wrap-anywhere">
                  <div className="text-label flex items-center gap-1.5 text-xs">
                    <span
                      className={cn(
                        "font-medium",
                        item.by === "ai"
                          ? item.ask
                            ? "text-ai-text"
                            : "text-label"
                          : "text-foreground/85",
                      )}
                    >
                      {item.by === "ai"
                        ? item.ask
                          ? "AI asked"
                          : "Earlier fix"
                        : item.reworded
                          ? "Previous wording"
                          : "Creator follow-up"}
                    </span>
                    {item.at && <span className="font-mono tabular-nums">{formatShortDate(item.at)}</span>}
                  </div>
                  <p
                    className={cn(
                      "text-foreground/90 whitespace-pre-wrap",
                      item.reworded && "text-foreground/65 line-through",
                    )}
                  >
                    {item.text || "(no words)"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {activeAsk && (
        <p className="text-ui mt-1 max-w-[65ch] leading-normal wrap-anywhere">
          <span className="text-primary-text font-medium">Needs work: </span>
          <span className="text-foreground/90">{activeAsk.text || "(no words)"}</span>
          {activeAsk.at && (
            <span className="text-muted-foreground ms-1 font-mono text-xs tabular-nums">
              {formatShortDate(activeAsk.at)}
            </span>
          )}
        </p>
      )}
      {activeFix && renderFix(activeFix)}
      {note.learned?.what && (
        <p className="text-ui text-foreground/70 mt-0.5 max-w-[65ch] leading-normal wrap-anywhere">
          <span className="text-ok-text font-medium">
            Learned ({note.learned.scope === "all" ? "every film" : "this film"}):{" "}
          </span>
          <span className="text-foreground/75">{note.learned.what}</span>
        </p>
      )}
    </>
  );
}

export function InlineFeedbackBox({
  note,
  ask,
  onDone,
}: {
  note: Note;
  ask: boolean;
  onDone: () => void;
}) {
  const words = useLite((s) => s.replyDrafts.get(note.id) ?? "");
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    boxRef.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = words.trim();
    if (!trimmed) return;
    if (lite.answerNote(note, trimmed)) {
      lite.setReplyDraft(note.id, "");
      onDone();
    }
  };

  const askPrompt = ask ? note.fixes?.at(-1)?.what : undefined;

  return (
    <div
      className="border-border/70 bg-background/75 mt-1.5 rounded-lg border p-2"
      onClick={(e) => e.stopPropagation()}
    >
      {askPrompt && (
        <p className="text-ai-text mb-1.5 text-sm leading-normal wrap-anywhere">
          <span className="font-medium">AI asks: </span>
          {askPrompt}
        </p>
      )}
      <Textarea
        ref={boxRef}
        variant="note"
        name={`feedback-${note.id}`}
        aria-label={ask ? "Your answer to the AI" : "What still needs work"}
        placeholder={ask ? "Answer the AI…" : "Say what’s still wrong or add detail…"}
        value={words}
        onChange={(e) => lite.setReplyDraft(note.id, e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            lite.setReplyDraft(note.id, "");
            onDone();
          }
        }}
        className="min-h-14 max-w-[65ch]"
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <Button
          type="button"
          variant="subtle"
          size="sm"
          onClick={() => {
            lite.setReplyDraft(note.id, "");
            onDone();
          }}
        >
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!words.trim()} onClick={submit}>
          <Send aria-hidden data-icon="inline-start" />
          Send to AI
        </Button>
      </div>
    </div>
  );
}

export function RememberButton({ note, target }: { note: Note; target: string }) {
  const nextScope = cycleRememberScope(note);
  const label = !note.remember
    ? `Remember note ${target} for this film`
    : note.remember.scope === "film"
      ? `Remember note ${target} for every film`
      : `Clear remember on note ${target}`;
  return (
    <Button
      type="button"
      variant={note.remember ? "lit" : "subtle"}
      size="phone-icon"
      aria-label={label}
      aria-pressed={Boolean(note.remember)}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        lite.rememberNote(note, nextScope);
      }}
    >
      <Bookmark aria-hidden />
    </Button>
  );
}

export function GroupHeading({
  label,
  count,
  tone,
  state,
  asking = false,
}: {
  label: string;
  count: number;
  tone: string;
  state: NoteState;
  asking?: boolean;
}) {
  return (
    <h3 className={cn("flex h-5.5 items-center gap-1.5 px-0.5 text-xs font-semibold tabular-nums", tone)}>
      <StatusGlyph state={state} asking={asking} />
      <span>{label}</span>
      <span className="text-muted-foreground text-tag font-mono font-medium">{count}</span>
    </h3>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <UiEmpty>
      <EmptyHeader>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </UiEmpty>
  );
}
