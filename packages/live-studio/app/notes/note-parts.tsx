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
  PanelRightOpen,
  Pencil,
  PenLine,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Video,
  X,
  ZoomIn,
} from "lucide-react";
import { type ReactElement, type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Empty as UiEmpty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useEnterMotion } from "../components/Motion";
import { Tip } from "../components/Tip";
import { PHONE } from "../core/device";
import { set, useDialogModal, useStudio } from "../core/store";
import { rangeText, stamp } from "../core/time";
import { frameSize } from "../picture/frame";
import { inkWords } from "./ink";
import { noteActionTarget, noteRangePill, pinShortLabel } from "./note-card-meta";
import {
  formatShortDate,
  formatShotOptionLabel,
  NOTE_FACETS,
  type NotePriorEntry,
  shortDayFormat,
  type ShotFilterOption,
  summarizeNoteThread,
} from "./note-views-model";
import {
  answerNote,
  approveNote,
  clearNoteFilters,
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
  "group/card relative rounded-lg border border-s-2 p-2.5 transition-colors duration-150 ease-out motion-reduce:transition-none";

export const noteSurfaceClass = (
  state: NoteState,
  opts?: { near?: boolean; editing?: boolean; compact?: boolean; asking?: boolean },
): string => {
  const base =
    state === "check" && opts?.asking
      ? "border-hairline border-s-ai/85 bg-backdrop/85 hover:border-hairline-strong hover:border-s-ai hover:bg-backdrop"
      : state === "check"
        ? "border-warn/35 border-s-warn/80 bg-warn-card/80 hover:border-warn/55 hover:border-s-warn hover:bg-warn-card-hover/85"
        : state === "done"
          ? "border-hairline-subtle border-s-ok/40 bg-surface-subtle/50 text-foreground/78 hover:border-hairline hover:border-s-ok/65 hover:bg-surface-subtle"
          : "border-hairline border-s-primary/70 bg-backdrop/75 hover:border-hairline-strong hover:border-s-primary hover:bg-backdrop/95";
  const ring = opts?.editing
    ? "border-warn/85 border-s-warn ring-1 ring-warn/35"
    : opts?.near && state !== "done"
      ? "border-hairline-strong ring-hairline-strong ring-1"
      : "";
  return cn(
    opts?.compact
      ? "group/card rounded-md border border-s-2 px-2.5 py-2 transition-colors duration-150 motion-reduce:transition-none"
      : cardBase,
    base,
    ring,
  );
};

export const day = shortDayFormat;
export { formatShortDate };

const cleanCheckpoint = (cp?: string) => (cp && cp !== "no git" ? cp : "");

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

export const noteStatusLabel = (state: NoteState, asking = false, needsWork = false): string =>
  state === "check" && asking
    ? "AI asks"
    : state === "open" && needsWork
      ? "Needs work"
      : STATUS_LABEL[state];

export const noteStatusTextClass = (state: NoteState, asking = false, needsWork = false): string =>
  state === "check"
    ? asking
      ? "text-ai-text"
      : "text-warn-text"
    : state === "done"
      ? "text-ok-text"
      : needsWork
        ? "text-primary-text font-semibold"
        : "text-primary-text";

export function NoteCardStatus({
  state,
  asking = false,
  needsWork = false,
}: {
  state: NoteState;
  asking?: boolean;
  needsWork?: boolean;
}) {
  const label = noteStatusLabel(state, asking, needsWork);
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <NoteStatusGlyph state={state} asking={asking} needsWork={needsWork} />
      <span
        className={cn(
          "text-xs font-medium whitespace-nowrap",
          noteStatusTextClass(state, asking, needsWork),
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function NoteCardHeader({
  note,
  t,
  state,
  asking = false,
  needsWork = false,
  shotPrimary,
  shotSecondary,
  shotFull,
  lit = false,
  trailing,
  showTime = true,
  hideShot = false,
  className,
}: {
  note: Note;
  t: number;
  state: NoteState;
  asking?: boolean;
  needsWork?: boolean;
  shotPrimary: string;
  shotSecondary?: string | null;
  shotFull: string;
  lit?: boolean;
  trailing?: ReactNode;
  showTime?: boolean;
  hideShot?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-6 flex-wrap items-center gap-1.5", className)}>
      <NoteNumber id={note.id} className="shrink-0" />
      <NoteCardStatus state={state} asking={asking} needsWork={needsWork} />
      {showTime && (
        <Tip label="Jump here">
          <NoteTimeChip note={note} t={t} />
        </Tip>
      )}
      {hideShot ? (
        <span className="min-w-0 flex-1" />
      ) : (
        <span
          className={cn(
            "text-ui min-w-0 flex-1 truncate",
            state === "done" ? "text-label/70" : "text-label/80",
          )}
          title={shotFull}
        >
          <span className={cn("font-medium", state === "done" ? "text-label/90" : "text-label")}>
            {shotPrimary}
          </span>
          {shotSecondary && <span className="text-label/75"> · {shotSecondary}</span>}
        </span>
      )}
      {lit && state !== "done" && (
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ring-1",
            asking
              ? "bg-ai/15 text-ai-text ring-ai/35"
              : state === "check"
                ? "bg-warn/15 text-warn-text ring-warn/35"
                : "bg-primary/15 text-primary-text ring-primary/35",
          )}
        >
          Updated
        </span>
      )}
      {trailing}
    </div>
  );
}

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
  const color =
    state === "check"
      ? asking
        ? "text-ai-text"
        : "text-warn-text"
      : state === "done"
        ? "text-ok-text"
        : "text-primary-text";
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
  const badgeVariant = state === "check" && asking ? "ai" : state;
  return (
    <Badge variant={badgeVariant} className={className}>
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
        "text-label/80 font-mono text-xs leading-none font-medium tabular-nums",
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
  const target = noteActionTarget(noteNum(note.id), stamp(t));
  return (
    <button
      type="button"
      aria-label={`Jump to ${target}`}
      onClick={(e) => {
        e.stopPropagation();
        goToNote(note);
      }}
      className={cn(
        "text-label hover:bg-tint hover:text-primary-text hover:border-primary/45 focus-visible:ring-ring border-hairline bg-surface-subtle inline-flex h-6 min-h-6 min-w-6 shrink-0 cursor-pointer items-center justify-center rounded border px-1.5 py-0.5 font-mono text-xs leading-none font-medium tracking-tight tabular-nums transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:h-10 pointer-coarse:min-h-10",
        className,
      )}
    >
      {stamp(t)}
    </button>
  );
}

export function ExpandableNoteText({
  text,
  clampLines,
  compact = false,
  className,
  onOpen,
  openLabel,
}: {
  text: string;
  clampLines?: 2 | 3;
  compact?: boolean;
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
            "text-label hover:text-foreground focus-visible:ring-ring hover:bg-surface-subtle inline-flex min-h-6 cursor-pointer items-center rounded-sm text-left italic transition-colors outline-none focus-visible:ring-2 pointer-coarse:min-h-10",
            compact ? "text-sm/[1.5]" : "text-title/[1.55]",
            className,
          )}
        >
          (no words)
        </button>
      );
    }
    return (
      <p
        className={cn(
          "text-label italic",
          compact ? "text-sm/[1.5]" : "text-title/[1.55]",
          className,
        )}
      >
        (no words)
      </p>
    );
  }

  const textCls = cn(
    "block font-normal text-pretty wrap-anywhere whitespace-pre-wrap",
    compact ? "text-sm/[1.5]" : "text-title/[1.55]",
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
          className="hover:text-foreground focus-visible:ring-ring hover:bg-surface-subtle flex min-h-6 w-full cursor-pointer items-center rounded-sm text-left text-current transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-10"
        >
          <span ref={setEl} className={cn("w-full", textCls)}>
            {text}
          </span>
        </button>
      ) : (
        <p ref={setEl} className={cn("text-current", textCls)}>
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
          className="text-label hover:text-primary-text text-ui focus-visible:ring-ring mt-0.5 inline-flex min-h-6 cursor-pointer items-center rounded-sm font-medium transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-10"
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
    <Badge variant="tag" title={`Marked to remember for ${scopeLabel}`} className="max-w-full">
      <Bookmark aria-hidden className="text-ok-text" />
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
      <p className="text-ui text-foreground/70 mt-0.5 leading-normal text-pretty wrap-anywhere">
        <span className="text-ok-text font-medium">Learned ({scopeLabel}): </span>
        <span className="text-foreground/75">{note.learned.what}</span>
        {dateLabel && (
          <span className="text-label/75 ms-1.5 inline-block font-mono text-xs whitespace-nowrap tabular-nums">
            {dateLabel}
          </span>
        )}
      </p>
    );
  }
  return (
    <Alert variant="ok" role={undefined} className="mt-2">
      <Sparkles aria-hidden />
      <AlertDescription size="prose" className="min-w-0 wrap-anywhere">
        <span className="text-ok-text font-medium">Learned ({scopeLabel}): </span>
        <span>{note.learned.what}</span>
        {dateLabel && (
          <span className="text-label/75 ms-1.5 inline-block font-mono text-xs whitespace-nowrap tabular-nums">
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
        className="text-label hover:text-foreground text-ui focus-visible:ring-ring inline-flex min-h-6 cursor-pointer items-center gap-1 rounded px-1 py-0.5 font-medium transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-10"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
        <span>
          History ({prior.length} prior {prior.length === 1 ? "entry" : "entries"})
        </span>
      </button>
      {open && (
        <div className="border-border/60 mt-1 flex flex-col gap-1.5 border-s ps-2.5">
          {prior.map((item, i) => {
            const cp = cleanCheckpoint(item.checkpoint);
            const role =
              item.by === "ai"
                ? item.ask
                  ? "AI asked"
                  : cp
                    ? `Earlier fix · ${cp}`
                    : "Earlier fix"
                : item.reworded
                  ? "Previous wording"
                  : "Creator follow-up";
            const dateLabel = formatShortDate(item.at);
            return (
              <div
                key={`${item.at}-${i}`}
                className="text-ui leading-normal text-pretty wrap-anywhere"
              >
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
                    {role}
                  </span>
                  {dateLabel && <span className="font-mono tabular-nums">{dateLabel}</span>}
                </div>
                <p
                  className={cn(
                    "text-foreground/90 mt-0.5 whitespace-pre-wrap",
                    item.reworded && "text-foreground/65 line-through",
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
      <p className="text-ui mt-1 leading-normal text-pretty wrap-anywhere">
        <span className="text-primary-text font-medium">Needs work: </span>
        <span className="text-foreground/90">{ask.text || "(no words)"}</span>
        {dateLabel && (
          <>
            {" "}
            <span className="text-label/75 font-mono text-xs whitespace-nowrap tabular-nums">
              {dateLabel}
            </span>
          </>
        )}
      </p>
    );
  }
  return (
    <Alert variant="open" role={undefined} className="mt-2">
      <MessageSquarePlus aria-hidden />
      <AlertDescription size="prose" className="min-w-0 wrap-anywhere">
        <span className="text-primary-text font-medium">Needs work: </span>
        <span>{ask.text || "(no words)"}</span>
        {dateLabel && (
          <>
            {" "}
            <span className="text-label/75 font-mono text-xs whitespace-nowrap tabular-nums">
              {dateLabel}
            </span>
          </>
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
  const cp = cleanCheckpoint(fix.checkpoint);
  const variant =
    state === "check" ? (fix.ask ? "ai" : "warn") : state === "done" ? "ok" : "default";
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
    state === "open"
      ? "text-label"
      : fix.ask
        ? "text-ai-text"
        : state === "check"
          ? "text-warn-text"
          : "text-ok-text";
  if (compact) {
    return (
      <p className="text-ui mt-1 leading-normal text-pretty wrap-anywhere">
        <span className={cn("font-medium", labelCls)}>{prefix}</span>
        <span className="text-foreground/90">{fix.what}</span>
        {(cp || dateLabel) && (
          <>
            {" "}
            <span className="text-label/75 font-mono text-xs whitespace-nowrap tabular-nums">
              {cp && dateLabel ? `${cp} · ${dateLabel}` : cp || dateLabel}
            </span>
          </>
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
      <AlertDescription size="prose" className="min-w-0 wrap-anywhere">
        <span className={cn("font-medium", labelCls)}>{prefix}</span>
        <span>{fix.what}</span>
        {(cp || dateLabel) && (
          <>
            {" "}
            <span className="text-label/75 font-mono text-xs whitespace-nowrap tabular-nums">
              {cp && dateLabel ? `${cp} · ${dateLabel}` : cp || dateLabel}
            </span>
          </>
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
  useDialogModal("noteRefs", open);
  return (
    <>
      <Badge
        variant="refs"
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
        <ImageIcon aria-hidden className="text-label" />
        {count} picture{count > 1 ? "s" : ""}
      </Badge>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          font="md"
          className="max-h-[94vh] overflow-y-auto overscroll-contain sm:max-w-[min(92vw,1400px)]"
        >
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

export function NoteTags({ note, className }: { note: Note; className?: string }) {
  const pinName = pinShortLabel(note.pin?.what);
  const range = noteRangePill(note);
  const marks = note.marks as Mark[] | undefined;
  const hasMarks = Boolean(marks?.length);
  const refs = Array.isArray(note.refs) ? note.refs.length : 0;
  const showRemember = Boolean(
    note.remember && !(note.learned?.what && note.remember.scope === note.learned.scope),
  );
  if (!pinName && !range && !note.freeCam && !hasMarks && !refs && !showRemember) return null;
  return (
    <div className={cn("mt-1.5 flex flex-wrap items-center gap-1", className)}>
      {showRemember && <RememberChip note={note} />}
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
              "group/thumb bg-backdrop hover:outline-primary/85 focus-visible:ring-ring outline-hairline relative flex-none cursor-pointer overflow-hidden rounded-md shadow-xs outline-1 -outline-offset-1 transition-opacity duration-150 ease-out focus-visible:ring-2 motion-reduce:transition-none",
              muted && "opacity-75 group-hover/card:opacity-100 hover:opacity-100",
              size === "sm"
                ? portrait
                  ? "h-11 w-auto"
                  : "aspect-video w-16 pointer-coarse:w-20"
                : portrait
                  ? "h-16 w-auto"
                  : "aspect-video w-16 sm:w-21 pointer-coarse:w-20",
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
          className="text-picture/85 group-hover/thumb:text-primary-text bg-scrim group-hover/thumb:bg-scrim-strong pointer-events-none absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-sm transition-colors duration-150 motion-reduce:transition-none"
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
              "font-md bg-popover text-popover-foreground shadow-float ring-hairline-strong motion-safe:data-closed:animate-out motion-safe:data-closed:fade-out-0 motion-safe:data-closed:zoom-out-95 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0 motion-safe:data-open:zoom-in-95 max-w-sm origin-(--transform-origin) overflow-hidden rounded-xl p-1.5 ring-1 motion-safe:duration-150",
              portrait ? "w-60" : "w-96",
            )}
          >
            <div className="bg-backdrop outline-hairline relative overflow-hidden rounded-lg outline-1 -outline-offset-1">
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
            <div className="text-ui mt-1.5 flex items-center gap-1.5 px-1 pb-0.5">
              <span className="text-primary-text font-mono font-semibold tabular-nums">
                {timeText}
              </span>
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
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== box.current) {
      returnFocusRef.current = active;
    }
  }, []);
  useEnterMotion(wrapRef, { y: -4, scale: 0.99, duration: 150 });
  const cancel = () => {
    const prev = returnFocusRef.current;
    onDone();
    if (prev?.isConnected) requestAnimationFrame(() => prev.focus({ preventScroll: true }));
  };
  const submit = () => {
    const trimmed = words.trim();
    if (!trimmed) return;
    answerNote(note, trimmed);
    setWords("");
    onDone();
  };
  const label = ask ? "Your answer to the AI" : "What still needs work";
  const askPrompt = ask ? note.fixes?.at(-1)?.what : undefined;
  return (
    <div
      ref={wrapRef}
      className="border-border/70 bg-background/75 mt-2 rounded-lg border p-2"
      onClick={(e) => e.stopPropagation()}
    >
      {askPrompt && (
        <p className="text-ai-text mb-1.5 text-sm leading-normal text-pretty wrap-anywhere">
          <span className="font-medium">AI asks: </span>
          {askPrompt}
        </p>
      )}
      <Textarea
        ref={box}
        autoFocus
        variant="note"
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
            cancel();
          }
        }}
        className="min-h-14"
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <Button type="button" variant="subtle" size="sm" onClick={cancel}>
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

const withTip = (showTip: boolean, label: string, node: ReactElement) =>
  showTip ? <Tip label={label}>{node}</Tip> : node;

export function CheckActions({
  note,
  ask,
  replying,
  onToggleReply,
  compact = false,
  iconOnly = false,
  showEdit = false,
}: {
  note: Note;
  ask: boolean;
  replying: boolean;
  onToggleReply: () => void;
  compact?: boolean;
  iconOnly?: boolean;
  showEdit?: boolean;
}) {
  const size = "sm";
  const iconSize = "icon-sm";
  const target = noteActionTarget(noteNum(note.id), stamp(note.t));
  const compactReview = iconOnly || compact;
  return (
    <div
      className={cn(
        "border-hairline-subtle @container/actions mt-2 flex items-center border-t pt-2",
        iconOnly ? "flex-nowrap gap-1" : "flex-wrap gap-1.5",
      )}
    >
      {!ask &&
        withTip(
          iconOnly,
          "Approve fix",
          <Button
            variant="approve"
            size={iconOnly ? iconSize : size}
            aria-label={`Approve note ${target}`}
            onClick={(e) => {
              e.stopPropagation();
              approveNote(note);
            }}
          >
            <Check aria-hidden data-icon={iconOnly ? undefined : "inline-start"} />
            {!iconOnly && "Approve"}
          </Button>,
        )}
      {withTip(
        iconOnly,
        ask ? "Answer AI question" : "Needs work — send back to AI",
        <Button
          variant={replying ? "lit" : ask ? "ai" : "subtle"}
          size={iconOnly ? iconSize : size}
          aria-label={ask ? `Answer AI question ${target}` : `Needs work ${target}`}
          aria-expanded={replying}
          onClick={(e) => {
            e.stopPropagation();
            onToggleReply();
          }}
        >
          {ask ? (
            <MessageCircleQuestion aria-hidden data-icon={iconOnly ? undefined : "inline-start"} />
          ) : (
            <Undo2 aria-hidden data-icon={iconOnly ? undefined : "inline-start"} />
          )}
          {!iconOnly && (ask ? "Answer" : "Needs work")}
        </Button>,
      )}
      {(showEdit || !PHONE) && (
        <div
          className={cn(
            "flex items-center gap-1",
            compactReview ? "ms-auto" : "@[220px]/actions:ms-auto",
          )}
        >
          {!PHONE &&
            withTip(
              compactReview,
              "Review in big view",
              <Button
                variant="subtle"
                size={compactReview ? iconSize : size}
                aria-label={`Review note ${target}`}
                onClick={(e) => {
                  e.stopPropagation();
                  reviewNote(note, e.currentTarget);
                }}
              >
                <PanelRightOpen
                  aria-hidden
                  data-icon={compactReview ? undefined : "inline-start"}
                />
                {!compactReview && "Review"}
              </Button>,
            )}
          {showEdit && (
            <Tip label="Edit note">
              <Button
                variant="subtle"
                size={iconSize}
                aria-label={`Edit note ${target}`}
                onClick={(e) => {
                  e.stopPropagation();
                  editOldNote(note, originOf(e.currentTarget));
                }}
              >
                <Pencil aria-hidden />
              </Button>
            </Tip>
          )}
        </div>
      )}
    </div>
  );
}

export function NoteOpenActions({
  note,
  t,
  compact = false,
  iconOnly = false,
}: {
  note: Note;
  t: number;
  compact?: boolean;
  iconOnly?: boolean;
}) {
  const target = noteActionTarget(noteNum(note.id), stamp(t));
  const size = "sm";
  const iconSize = "icon-sm";
  const compactReview = iconOnly || compact;
  return (
    <div
      className={cn(
        "border-hairline-subtle mt-2 flex items-center border-t pt-2",
        iconOnly ? "flex-nowrap gap-1" : "flex-wrap gap-1.5",
      )}
    >
      {withTip(
        iconOnly,
        "Edit note",
        <Button
          variant="subtle"
          size={iconOnly ? iconSize : size}
          aria-label={`Edit note ${target}`}
          onClick={(e) => {
            e.stopPropagation();
            editOldNote(note, originOf(e.currentTarget));
          }}
        >
          <Pencil aria-hidden data-icon={iconOnly ? undefined : "inline-start"} />
          {!iconOnly && "Edit"}
        </Button>,
      )}
      <div className="ms-auto flex items-center gap-1">
        {!PHONE &&
          withTip(
            compactReview,
            "Review in big view",
            <Button
              variant="subtle"
              size={compactReview ? iconSize : size}
              aria-label={`Review note ${target}`}
              onClick={(e) => {
                e.stopPropagation();
                reviewNote(note, e.currentTarget);
              }}
            >
              <PanelRightOpen aria-hidden data-icon={compactReview ? undefined : "inline-start"} />
              {!compactReview && "Review"}
            </Button>,
          )}
        <Tip label="Delete note">
          <Button
            variant="remove"
            size="icon-sm"
            aria-label={`Delete note ${target}`}
            onClick={(e) => {
              e.stopPropagation();
              removeNote(note);
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </Tip>
      </div>
    </div>
  );
}

export function NoteDoneActions({
  note,
  t,
  approved,
  showDate = true,
  compact = false,
  iconOnly = false,
  showEdit = true,
}: {
  note: Note;
  t: number;
  approved?: string;
  showDate?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
  showEdit?: boolean;
}) {
  const target = noteActionTarget(noteNum(note.id), stamp(t));
  const doneDate = formatShortDate(approved);
  const compactReview = iconOnly || compact;
  return (
    <div
      className={cn(
        "border-hairline-subtle mt-2 flex items-center border-t pt-2",
        iconOnly ? "flex-nowrap gap-1" : "flex-wrap gap-1.5",
      )}
    >
      {showDate && (
        <span className="text-label/75 truncate font-mono text-xs tabular-nums">
          {doneDate ? `Approved ${doneDate}` : "Done"}
        </span>
      )}
      <div className="ms-auto flex items-center gap-1.5">
        {showEdit && (
          <Tip label="Edit note">
            <Button
              variant="subtle"
              size="icon-sm"
              aria-label={`Edit note ${target}`}
              onClick={(e) => {
                e.stopPropagation();
                editOldNote(note, originOf(e.currentTarget));
              }}
            >
              <Pencil aria-hidden />
            </Button>
          </Tip>
        )}
        {!PHONE &&
          withTip(
            compactReview,
            "Review in big view",
            <Button
              variant="subtle"
              size={compactReview ? "icon-sm" : "sm"}
              aria-label={`Review note ${target}`}
              onClick={(e) => {
                e.stopPropagation();
                reviewNote(note, e.currentTarget);
              }}
            >
              <PanelRightOpen aria-hidden data-icon={compactReview ? undefined : "inline-start"} />
              {!compactReview && "Review"}
            </Button>,
          )}
        {withTip(
          iconOnly,
          "Reopen note",
          <Button
            variant="subtle"
            size={iconOnly ? "icon-sm" : "sm"}
            aria-label={`Reopen note ${target}`}
            onClick={(e) => {
              e.stopPropagation();
              reopenNote(note);
            }}
          >
            <RotateCcw aria-hidden data-icon={iconOnly ? undefined : "inline-start"} />
            {!iconOnly && "Reopen"}
          </Button>,
        )}
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
  iconOnly = false,
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
  iconOnly?: boolean;
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
          iconOnly={iconOnly}
          showEdit={showEdit}
        />
        {replying && <InlineFeedbackBox note={note} ask={ask} onDone={onDoneReply} />}
      </>
    );
  }
  if (state === "done") {
    return (
      <NoteDoneActions
        note={note}
        t={t}
        approved={note.approved}
        showDate={showApprovedDate}
        compact={compact}
        iconOnly={iconOnly}
      />
    );
  }
  return <NoteOpenActions note={note} t={t} compact={compact} iconOnly={iconOnly} />;
}

export const openNoteRow = (n: Note, state: NoteState, el: Element) => {
  if (state === "open") editOldNote(n, originOf(el));
  else if (!PHONE) reviewNote(n, el);
  else goToNote(n);
};

/** Shared active filter pills strip with single-filter removal and Reset all. */
export function ActiveFilterChips({
  includeSearch = false,
  shotOptions = [],
  className,
}: {
  includeSearch?: boolean;
  shotOptions?: readonly ShotFilterOption[];
  className?: string;
}) {
  const q = useStudio((s) => s.noteSearch);
  const scope = useStudio((s) => s.noteScope);
  const shot = useStudio((s) => s.noteShot);
  const facets = useStudio((s) => s.noteFacets);
  const notes = useStudio((s) => s.notes);

  const hasSearch = includeSearch && Boolean(q.trim());
  if (!hasSearch && scope !== "shot" && shot === null && facets.length === 0) return null;

  const shotLabel =
    shot === null
      ? null
      : (shotOptions.find((o) => o.shot === shot)?.label ??
        formatShotOptionLabel(shot, notes.find((n) => n.shot === shot)?.shotName));

  return (
    <div className={cn("flex flex-wrap items-center gap-1 pt-0.5", className)}>
      {hasSearch && (
        <Button
          variant="secondary"
          size="pill"
          aria-label="Clear search filter"
          onClick={() => set({ noteSearch: "" })}
        >
          <span>“{q.trim()}”</span>
          <X aria-hidden />
        </Button>
      )}
      {scope === "shot" && (
        <Button
          variant="secondary"
          size="pill"
          aria-label="Clear current shot scope"
          onClick={() => set({ noteScope: "all" })}
        >
          <span>Current shot</span>
          <X aria-hidden />
        </Button>
      )}
      {shot !== null && shotLabel && (
        <Button
          variant="secondary"
          size="pill"
          aria-label="Clear shot filter"
          onClick={() => set({ noteShot: null })}
        >
          <span>{shotLabel}</span>
          <X aria-hidden />
        </Button>
      )}
      {facets.map((fid) => {
        const meta = NOTE_FACETS.find((m) => m.id === fid);
        if (!meta) return null;
        return (
          <Button
            key={fid}
            variant="secondary"
            size="pill"
            aria-label={`Remove ${meta.label} filter`}
            onClick={() => set({ noteFacets: facets.filter((f) => f !== fid) })}
          >
            <span>{meta.label}</span>
            <X aria-hidden />
          </Button>
        );
      })}
      <Button variant="link" size="sm" onClick={clearNoteFilters} className="ms-1">
        Reset all
      </Button>
    </div>
  );
}
