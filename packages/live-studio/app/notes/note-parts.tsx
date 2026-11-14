// Shared note UI building blocks reused across NoteList (Cards view) and Notion-style NoteViews.
import { PreviewCard } from "@base-ui/react/preview-card";
import {
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Crosshair,
  Image as ImageIcon,
  MessageCircleQuestion,
  MessageSquarePlus,
  Pencil,
  PenLine,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Video,
  ZoomIn,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Empty as UiEmpty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useEnterMotion } from "../components/Motion";
import { PHONE } from "../core/device";
import { rangeText, stamp } from "../core/time";
import { frameSize } from "../picture/frame";
import { inkWords } from "./ink";
import { noteRangePill, pinShortLabel } from "./note-card-meta";
import {
  formatShortDate,
  type NotePriorEntry,
  shortDayFormat,
  summarizeNoteThread,
} from "./note-views-model";
import {
  answerNote,
  approveNote,
  editOldNote,
  goToNote,
  noteMedia,
  noteNum,
  originOf,
  removeNote,
  reopenNote,
  reviewNote,
} from "./notes";
import type { Fix, Mark, Note, NoteState } from "./slice";

export const cardBase =
  "group/card relative rounded-lg border p-2.5 transition-[background-color,border-color,box-shadow] duration-150 ease-out";

export const noteSurfaceClass = (
  state: NoteState,
  opts?: { near?: boolean; editing?: boolean; compact?: boolean },
): string => {
  const base =
    state === "check"
      ? "border-warn/35 bg-[color-mix(in_srgb,var(--warn-bg)_48%,var(--card))] hover:border-warn/55 hover:bg-[color-mix(in_srgb,var(--warn-bg)_65%,var(--card))]"
      : state === "done"
        ? "border-white/[0.06] bg-background/60 text-foreground/80 hover:border-white/[0.12] hover:bg-card/55"
        : "border-white/[0.08] bg-card/90 hover:border-white/[0.16] hover:bg-card";
  const ring = opts?.editing
    ? "border-warn/85 ring-1 ring-warn/30"
    : opts?.near && state === "open"
      ? "border-primary/75 ring-1 ring-primary/25"
      : "";
  return cn(
    opts?.compact
      ? "group/card rounded-md border px-2.5 py-2 transition-[background-color,border-color] duration-150"
      : cardBase,
    base,
    ring,
  );
};

export const day = shortDayFormat;
export { formatShortDate };

export const Empty = ({ children }: { children: ReactNode }) => (
  <UiEmpty>
    <EmptyHeader>
      <EmptyDescription>{children}</EmptyDescription>
    </EmptyHeader>
  </UiEmpty>
);

const STATUS_LABEL: Record<NoteState, string> = {
  check: "To check",
  open: "To fix",
  done: "Done",
};

export function NoteStatusGlyph({
  state,
  asking = false,
  needsWork = false,
  className,
}: {
  state: NoteState;
  asking?: boolean;
  needsWork?: boolean;
  className?: string;
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
  const color = state === "check" ? "text-warn" : state === "done" ? "text-ok-text" : "text-primary";
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", color, className)} />;
}

export function StatusPill({
  state,
  compact = false,
  asking = false,
  needsWork = false,
  className,
}: {
  state: NoteState;
  compact?: boolean;
  asking?: boolean;
  needsWork?: boolean;
  className?: string;
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
  const label =
    state === "check" && asking
      ? "AI asks"
      : state === "open" && needsWork
        ? "Needs work"
        : STATUS_LABEL[state];
  return (
    <Badge variant={state} className={className}>
      <Icon aria-hidden />
      {!compact && <span>{label}</span>}
    </Badge>
  );
}

export function NoteNumber({ id, className }: { id: string; className?: string }) {
  const num = noteNum(id);
  if (num == null) return null;
  return (
    <span
      className={cn(
        "text-label/75 text-tag font-mono leading-none font-medium tabular-nums select-none",
        className,
      )}
    >
      #{num}
    </span>
  );
}

export function NoteTimeChip({
  note,
  t,
  className,
}: {
  note: Note;
  t: number;
  className?: string;
}) {
  const timeText = stamp(t);
  return (
    <button
      type="button"
      aria-label={`Jump to ${timeText}`}
      onClick={(e) => {
        e.stopPropagation();
        goToNote(note);
      }}
      className={cn(
        "text-primary/95 hover:bg-primary/12 hover:text-primary hover:border-primary/40 focus-visible:ring-ring text-tag inline-flex min-h-5.5 shrink-0 cursor-pointer items-center rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono leading-none font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 pointer-coarse:min-h-9",
        className,
      )}
    >
      {timeText}
    </button>
  );
}

export function ExpandableNoteText({
  text,
  clampLines,
  className,
  onOpen,
  openLabel,
}: {
  text: string;
  clampLines?: 2 | 3;
  className?: string;
  onOpen?: (el: HTMLElement) => void;
  openLabel?: string;
}) {
  const key = `${clampLines ?? ""}:${text}`;
  const [prevKey, setPrevKey] = useState(key);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [el, setEl] = useState<HTMLElement | null>(null);
  if (prevKey !== key) {
    setPrevKey(key);
    setExpanded(false);
    setClipped(false);
  }

  useLayoutEffect(() => {
    if (!el || !text || clampLines == null) return;
    const measure = () => {
      if (expanded) return;
      setClipped(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, text, clampLines, expanded]);

  if (!text) {
    if (onOpen) {
      return (
        <button
          type="button"
          aria-label={openLabel ?? "Open untitled note"}
          onClick={(e) => onOpen(e.currentTarget)}
          className={cn(
            "text-label text-ui hover:text-primary focus-visible:ring-ring inline-flex min-h-6 cursor-pointer items-center rounded-sm text-left italic outline-none focus-visible:ring-2",
            className,
          )}
        >
          (no words)
        </button>
      );
    }
    return <p className={cn("text-label text-ui italic", className)}>(no words)</p>;
  }

  const textCls = cn(
    "text-ui block leading-[1.45] font-medium wrap-anywhere whitespace-pre-wrap",
    clampLines != null && !expanded && (clampLines === 2 ? "line-clamp-2" : "line-clamp-3"),
    className,
  );

  return (
    <div className="min-w-0">
      {onOpen ? (
        <button
          type="button"
          title={text}
          aria-label={openLabel}
          onClick={(e) => onOpen(e.currentTarget)}
          className="text-foreground hover:text-primary focus-visible:ring-ring block w-full cursor-pointer rounded-sm text-left transition-colors outline-none focus-visible:ring-2"
        >
          <span ref={setEl} className={textCls}>
            {text}
          </span>
        </button>
      ) : (
        <p ref={setEl} className={cn("text-foreground", textCls)}>
          {text}
        </p>
      )}
      {clampLines != null && (clipped || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="text-label hover:text-primary text-tag focus-visible:ring-ring mt-0.5 inline-flex min-h-6 cursor-pointer items-center rounded-sm font-medium transition-colors outline-none focus-visible:ring-2 pointer-coarse:min-h-9"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function RememberChip({ note }: { note: Note }) {
  if (!note.remember) return null;
  const scopeLabel = note.remember.scope === "all" ? "every film" : "this film";
  return (
    <Badge variant="ai" title={`Marked to remember for ${scopeLabel}`} className="max-w-full">
      <Bookmark aria-hidden />
      <span>Remember · {scopeLabel}</span>
    </Badge>
  );
}

export function LearnedCallout({ note, compact = false }: { note: Note; compact?: boolean }) {
  if (!note.learned?.what) return null;
  const scopeLabel = note.learned.scope === "all" ? "every film" : "this film";
  const dateLabel = formatShortDate(note.learned.at);
  if (compact) {
    return (
      <p className="text-ai-text text-tag mt-0.5 leading-snug wrap-anywhere">
        <span className="font-medium">Learned ({scopeLabel}): </span>
        <span className="text-foreground/90">{note.learned.what}</span>
        {dateLabel && (
          <span className="text-label/75 ms-1.5 font-mono tabular-nums">{dateLabel}</span>
        )}
      </p>
    );
  }
  return (
    <Alert variant="ai" role={undefined} className="mt-2">
      <Sparkles aria-hidden />
      <AlertDescription className="min-w-0 wrap-anywhere">
        <span className="text-ai-text font-medium">Learned ({scopeLabel}): </span>
        <span>{note.learned.what}</span>
        {dateLabel && (
          <span className="text-tag text-label/75 ms-1.5 inline-block font-mono tabular-nums">
            {dateLabel}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function NoteHistoryDisclosure({
  note,
  state,
  prior: providedPrior,
}: {
  note: Note;
  state: NoteState;
  prior?: readonly NotePriorEntry[];
}) {
  const [open, setOpen] = useState(false);
  const prior = providedPrior ?? summarizeNoteThread(note, state).prior;
  if (prior.length === 0) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="text-label hover:text-foreground text-tag focus-visible:ring-ring inline-flex min-h-6 cursor-pointer items-center gap-1 rounded px-1 py-0.5 font-medium transition-colors outline-none focus-visible:ring-2 pointer-coarse:min-h-9"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-3 transition-transform duration-150", open && "rotate-180")}
        />
        <span>
          History ({prior.length} prior {prior.length === 1 ? "entry" : "entries"})
        </span>
      </button>
      {open && (
        <div className="border-border/60 mt-1 flex flex-col gap-1.5 border-s ps-2.5">
          {prior.map((item, i) => {
            const role =
              item.by === "ai"
                ? item.ask
                  ? "AI asked"
                  : item.checkpoint
                    ? `Earlier fix · ${item.checkpoint}`
                    : "Earlier fix"
                : item.reworded
                  ? "Previous wording"
                  : "Creator follow-up";
            const dateLabel = formatShortDate(item.at);
            return (
              <div key={`${item.at}-${i}`} className="text-xs leading-snug wrap-anywhere">
                <div className="text-label text-tag flex items-center gap-1.5">
                  <span
                    className={cn(
                      "font-medium",
                      item.by === "ai"
                        ? item.ask
                          ? "text-warn"
                          : "text-label"
                        : "text-foreground/85",
                    )}
                  >
                    {role}
                  </span>
                  {dateLabel && <span className="font-mono tabular-nums">{dateLabel}</span>}
                </div>
                <p
                  className={cn(
                    "text-foreground/90 mt-0.5 whitespace-pre-wrap",
                    item.reworded && "text-label line-through",
                  )}
                >
                  {item.text || <span className="text-label italic">(no words)</span>}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AskCallout({
  ask,
  compact = false,
}: {
  ask: { text: string; at?: string };
  compact?: boolean;
}) {
  const dateLabel = formatShortDate(ask.at);
  if (compact) {
    return (
      <p className="text-tag mt-1 leading-snug wrap-anywhere">
        <span className="text-primary font-medium">Needs work: </span>
        <span className="text-foreground/90">{ask.text || "(no words)"}</span>
        {dateLabel && (
          <span className="text-label/75 ms-1.5 font-mono tabular-nums">{dateLabel}</span>
        )}
      </p>
    );
  }
  return (
    <Alert variant="open" role={undefined} className="mt-2">
      <MessageSquarePlus aria-hidden />
      <AlertDescription className="min-w-0 wrap-anywhere">
        <span className="text-primary font-medium">Needs work: </span>
        <span>{ask.text || "(no words)"}</span>
        {dateLabel && (
          <span className="text-tag text-label/75 ms-1.5 inline-block font-mono tabular-nums">
            {dateLabel}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function FixCallout({
  fix,
  state,
  compact = false,
}: {
  fix: Fix;
  state: NoteState;
  compact?: boolean;
}) {
  const dateLabel = formatShortDate(fix.at);
  const variant = state === "check" || fix.ask ? "warn" : state === "done" ? "ok" : "default";
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
  const labelCls =
    state === "open" ? "text-label" : fix.ask || state === "check" ? "text-warn" : "text-ok-text";
  if (compact) {
    return (
      <p className="text-tag mt-1 leading-snug wrap-anywhere">
        <span className={cn("font-medium", labelCls)}>{prefix}</span>
        <span className="text-foreground/90">{fix.what}</span>
        {(fix.checkpoint || dateLabel) && (
          <span className="text-label/75 ms-1.5 font-mono tabular-nums">
            {fix.checkpoint ? (dateLabel ? `${fix.checkpoint} · ` : fix.checkpoint) : ""}
            {dateLabel}
          </span>
        )}
      </p>
    );
  }
  return (
    <Alert variant={variant} role={undefined} className="mt-2">
      {fix.ask ? (
        <MessageCircleQuestion aria-hidden />
      ) : state === "check" ? (
        <ClipboardCheck aria-hidden />
      ) : state === "done" ? (
        <CheckCircle2 aria-hidden />
      ) : (
        <CircleDot aria-hidden className="text-label" />
      )}
      <AlertDescription className="min-w-0 wrap-anywhere">
        <span className={cn("font-medium", labelCls)}>{prefix}</span>
        <span>{fix.what}</span>
        {(fix.checkpoint || dateLabel) && (
          <span className="text-tag text-label/75 ms-1.5 inline-block font-mono tabular-nums">
            {fix.checkpoint ? (dateLabel ? `${fix.checkpoint} · ` : fix.checkpoint) : ""}
            {dateLabel}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

// Unified follow-up stack shared by cards, rows, timelines, and drawers so no state or turn gets buried.
export function NoteFollowups({
  note,
  state,
  compact = false,
}: {
  note: Note;
  state: NoteState;
  compact?: boolean;
}) {
  const { activeAsk, activeFix, prior } = summarizeNoteThread(note, state);
  return (
    <>
      <NoteHistoryDisclosure note={note} state={state} prior={prior} />
      {activeAsk && <AskCallout ask={activeAsk} compact={compact} />}
      {activeFix && <FixCallout fix={activeFix} state={state} compact={compact} />}
      <LearnedCallout note={note} compact={compact} />
    </>
  );
}

export function RefsChip({ note, count }: { note: Note; count: number }) {
  const [open, setOpen] = useState(false),
    refs = open ? noteMedia(note).refs : [];
  return (
    <>
      <Badge
        variant="tag"
        render={
          <button
            type="button"
            aria-label={`Open the ${count === 1 ? "picture" : `${count} pictures`} you pasted`}
          />
        }
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <ImageIcon aria-hidden className="text-primary" />
        {count} picture{count > 1 ? "s" : ""}
      </Badge>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-[min(92vw,1400px)]">
          <DialogTitle>Your pictures on the note at {note.time}</DialogTitle>
          {refs.map((src, i) => (
            <img
              key={src}
              src={src}
              alt={`Reference ${i + 1}, as you sent it`}
              className="block h-auto max-h-[78vh] w-full object-contain"
            />
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NoteTags({ note }: { note: Note }) {
  const pinName = pinShortLabel(note.pin?.what);
  const range = noteRangePill(note);
  const marks = note.marks as Mark[] | undefined;
  const hasMarks = Boolean(marks?.length);
  const refs = Array.isArray(note.refs) ? note.refs.length : 0;
  if (!pinName && !range && !note.freeCam && !hasMarks && !refs && !note.remember) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <RememberChip note={note} />
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
      {refs > 0 && <RefsChip note={note} count={refs} />}
      {hasMarks && (
        <Badge variant="ink">
          <PenLine aria-hidden />
          <span className="wrap-anywhere">{inkWords(marks!)}</span>
        </Badge>
      )}
    </div>
  );
}

// Compact frame thumbnail; hovering opens a floating full-detail frame preview.
export function NoteThumb({
  note,
  t,
  shotFull,
  size = "md",
  muted = false,
}: {
  note: Note;
  t: number;
  shotFull: string;
  size?: "sm" | "md";
  muted?: boolean;
}) {
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
              "group/thumb bg-backdrop hover:outline-primary/85 focus-visible:ring-ring relative flex-none cursor-pointer overflow-hidden rounded-md shadow-xs outline-1 -outline-offset-1 outline-white/12 transition-opacity duration-150 ease-out focus-visible:ring-2",
              muted && "opacity-75 group-hover/card:opacity-100 hover:opacity-100",
              size === "sm"
                ? portrait
                  ? "h-11 w-auto"
                  : "aspect-video w-16"
                : portrait
                  ? "h-16 w-auto"
                  : "aspect-video w-21",
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

// Inline feedback composer so creators can supplement or send a check/done note back to the AI anywhere, including PhoneApp.
export function InlineFeedbackBox({
  note,
  ask,
  onDone,
}: {
  note: Note;
  ask: boolean;
  onDone: () => void;
}) {
  const [words, setWords] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEnterMotion(wrapRef, { y: -4, scale: 0.99, duration: 150 });
  const submit = () => {
    const trimmed = words.trim();
    if (!trimmed) return;
    answerNote(note, trimmed);
    setWords("");
    onDone();
  };
  const label = ask ? "Your answer to the AI" : "What still needs work";
  return (
    <div
      ref={wrapRef}
      className="border-border/70 bg-background/75 mt-2 rounded-lg border p-2"
      onClick={(e) => e.stopPropagation()}
    >
      <Textarea
        ref={box}
        autoFocus
        name={`feedback-${note.id}`}
        aria-label={label}
        placeholder={ask ? "Answer the AI…" : "Say what's still wrong or add detail…"}
        value={words}
        onChange={(e) => setWords(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            onDone();
          }
        }}
        className="min-h-14"
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" variant="default" size="sm" disabled={!words.trim()} onClick={submit}>
          <Send aria-hidden data-icon="inline-start" />
          Send to AI
        </Button>
      </div>
    </div>
  );
}

export function CheckActions({
  note,
  ask,
  replying,
  onToggleReply,
  compact = false,
  showEdit = false,
}: {
  note: Note;
  ask: boolean;
  replying: boolean;
  onToggleReply: () => void;
  compact?: boolean;
  showEdit?: boolean;
}) {
  const size = compact ? "sm" : "default";
  const timeText = stamp(note.t);
  return (
    <div className="@container/actions mt-2.5 flex flex-wrap items-center gap-1.5">
      {!ask && (
        <Button
          variant="approve"
          size={size}
          className="pointer-coarse:min-h-9"
          onClick={(e) => {
            e.stopPropagation();
            approveNote(note);
          }}
        >
          <Check aria-hidden data-icon="inline-start" />
          Approve
        </Button>
      )}
      <Button
        variant={replying ? "lit" : ask ? "approve" : "secondary"}
        size={size}
        className="pointer-coarse:min-h-9"
        aria-expanded={replying}
        onClick={(e) => {
          e.stopPropagation();
          onToggleReply();
        }}
      >
        {ask ? (
          <MessageCircleQuestion aria-hidden data-icon="inline-start" />
        ) : (
          <MessageSquarePlus aria-hidden data-icon="inline-start" />
        )}
        {ask ? "Answer" : "Needs work"}
      </Button>
      {!PHONE && (
        <div className="flex items-center gap-1.5 @[250px]/actions:ms-auto">
          <Button
            variant="outline"
            size={size}
            className="pointer-coarse:min-h-9"
            onClick={(e) => {
              e.stopPropagation();
              reviewNote(note);
            }}
          >
            <ClipboardCheck aria-hidden data-icon="inline-start" />
            Review
          </Button>
          {showEdit && (
            <Button
              variant="outline"
              size={compact ? "icon-sm" : "icon"}
              className="pointer-coarse:size-9"
              aria-label={`Edit note at ${timeText}`}
              onClick={(e) => {
                e.stopPropagation();
                editOldNote(note, originOf(e.currentTarget));
              }}
            >
              <Pencil />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function NoteOpenActions({ note, t }: { note: Note; t: number }) {
  const timeText = stamp(t);
  return (
    <div className="border-border/35 mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2">
      {!PHONE && (
        <Button
          variant="outline"
          size="sm"
          className="pointer-coarse:min-h-9"
          onClick={(e) => {
            e.stopPropagation();
            reviewNote(note);
          }}
        >
          <ClipboardCheck aria-hidden data-icon="inline-start" />
          Review
        </Button>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="pointer-coarse:min-h-9"
        aria-label={`Edit note at ${timeText}`}
        onClick={(e) => {
          e.stopPropagation();
          editOldNote(note, originOf(e.currentTarget));
        }}
      >
        <Pencil aria-hidden data-icon="inline-start" />
        Edit
      </Button>
      <Button
        variant="remove"
        size="icon-sm"
        className="ms-auto pointer-coarse:size-9"
        aria-label={`Delete note at ${timeText}`}
        onClick={(e) => {
          e.stopPropagation();
          removeNote(note);
        }}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

export function NoteDoneActions({
  note,
  t,
  approved,
  showDate = true,
}: {
  note: Note;
  t: number;
  approved?: string;
  showDate?: boolean;
}) {
  const timeText = stamp(t);
  const doneDate = formatShortDate(approved);
  return (
    <div className="border-border/30 mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2">
      {showDate && (
        <span className="text-tag text-label/75 font-mono tabular-nums">
          {doneDate ? `Approved ${doneDate}` : "Done"}
        </span>
      )}
      <div className="ms-auto flex items-center gap-1.5">
        {!PHONE && (
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:min-h-9"
            onClick={(e) => {
              e.stopPropagation();
              reviewNote(note);
            }}
          >
            <ClipboardCheck aria-hidden data-icon="inline-start" />
            Review
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="pointer-coarse:min-h-9"
          aria-label={`Reopen note at ${timeText}`}
          onClick={(e) => {
            e.stopPropagation();
            reopenNote(note);
          }}
        >
          <RotateCcw aria-hidden data-icon="inline-start" />
          Reopen
        </Button>
      </div>
    </div>
  );
}

export function NoteCardActions({
  note,
  t,
  state,
  replying,
  onToggleReply,
  onDoneReply,
  compact = false,
  showEdit = false,
  showApprovedDate = true,
}: {
  note: Note;
  t: number;
  state: NoteState;
  replying: boolean;
  onToggleReply: () => void;
  onDoneReply: () => void;
  compact?: boolean;
  showEdit?: boolean;
  showApprovedDate?: boolean;
}) {
  const ask = !!note.fixes?.at(-1)?.ask;
  if (state === "check") {
    return (
      <>
        <CheckActions
          note={note}
          ask={ask}
          replying={replying}
          onToggleReply={onToggleReply}
          compact={compact}
          showEdit={showEdit}
        />
        {replying && <InlineFeedbackBox note={note} ask={ask} onDone={onDoneReply} />}
      </>
    );
  }
  if (state === "done") {
    return (
      <NoteDoneActions note={note} t={t} approved={note.approved} showDate={showApprovedDate} />
    );
  }
  return <NoteOpenActions note={note} t={t} />;
}

export const openNoteRow = (n: Note, state: NoteState, el: Element) => {
  if (state === "open") editOldNote(n, originOf(el));
  else if (!PHONE) reviewNote(n);
  else goToNote(n);
};
