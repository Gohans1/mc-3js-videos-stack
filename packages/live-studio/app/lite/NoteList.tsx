import {
  Check,
  ChevronRight,
  MessageCircleQuestion,
  Pencil,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { memo, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { stamp } from "../core/time.ts";
import {
  filterAndGroupNotes,
  isCreatorNeedsWork,
  noteActionTarget,
  noteState,
} from "./model.ts";
import {
  EmptyState,
  ExpandableText,
  GroupHeading,
  InlineFeedbackBox,
  jumpToNote,
  NoteCardHeader,
  NoteFollowups,
  NoteTags,
  NoteThumb,
  RememberButton,
  StatusGlyph,
  surfaceClass,
} from "./NoteCardParts.tsx";
import { playback } from "./playback.ts";
import { lite, liteNoteSavingOf, useLite } from "./store.ts";
import type { Note, NoteStatusFilter } from "./types.ts";

const STATUS_TABS: { id: NoteStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "check", label: "To check" },
  { id: "asking", label: "AI asks" },
  { id: "open", label: "To fix" },
  { id: "done", label: "Done" },
];

const OpenNoteCard = memo(function OpenNoteCard({
  note,
  num,
  editing,
  noteSaving,
}: {
  note: Note;
  num: number | null;
  editing: boolean;
  noteSaving: boolean;
}) {
  const target = noteActionTarget(num, stamp(note.t));
  const needsWork = isCreatorNeedsWork(note, "open");
  return (
    <article
      data-note={note.id}
      data-tone="open"
      className={surfaceClass("open", { editing })}
    >
      <NoteCardHeader note={note} num={num} state="open" needsWork={needsWork} />
      <div className="mt-1 flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ExpandableText
            text={note.text}
            clampLines={2}
            onTap={() => jumpToNote(note, false)}
          />
          <NoteTags note={note} />
        </div>
        <div className="flex shrink-0 items-center gap-1 empty:hidden">
          <NoteThumb note={note} />
        </div>
      </div>
      <NoteFollowups note={note} state="open" />
      <div className="border-hairline-subtle mt-1 flex flex-wrap items-center gap-1 border-t pt-1">
        <Button
          type="button"
          variant="subtle"
          size="phone-xs"
          aria-label={`Mark done note ${target}`}
          onClick={(e) => {
            e.stopPropagation();
            lite.markNoteDone(note);
          }}
        >
          <Check aria-hidden data-icon="inline-start" />
          Done
        </Button>
        <div className="ms-auto flex items-center gap-1">
          <RememberButton note={note} target={target} />
          <Button
            type="button"
            variant="subtle"
            size="phone-icon"
            aria-label={`Edit note ${target}`}
            disabled={noteSaving}
            onClick={(e) => {
              e.stopPropagation();
              const wasPlaying = playback.isPlaying;
              if (wasPlaying) playback.pause();
              lite.openEditNote(note, wasPlaying);
            }}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            type="button"
            variant="remove"
            size="phone-icon"
            aria-label={`Delete note ${target}`}
            onClick={(e) => {
              e.stopPropagation();
              lite.removeNote(note);
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
    </article>
  );
});

const CheckNoteCard = memo(function CheckNoteCard({
  note,
  num,
  editing,
  noteSaving,
}: {
  note: Note;
  num: number | null;
  editing: boolean;
  noteSaving: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const fix = note.fixes?.at(-1);
  const asking = Boolean(fix?.ask);
  const target = noteActionTarget(num, stamp(note.t));
  return (
    <article
      data-note={note.id}
      data-tone={asking ? "ai" : "check"}
      className={surfaceClass("check", { editing, asking })}
    >
      <NoteCardHeader note={note} num={num} state="check" asking={asking} />
      <div className="mt-1 flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ExpandableText
            text={note.text}
            clampLines={2}
            onTap={() => jumpToNote(note, true)}
          />
          <NoteTags note={note} />
        </div>
        <div className="flex shrink-0 items-center gap-1 empty:hidden">
          <NoteThumb note={note} />
        </div>
      </div>
      <NoteFollowups note={note} state="check" />
      <div className="border-hairline-subtle mt-1 flex flex-wrap items-center gap-1 border-t pt-1">
        {!asking && (
          <Button
            type="button"
            variant="approve"
            size="phone-xs"
            aria-label={`Approve note ${target}`}
            onClick={(e) => {
              e.stopPropagation();
              lite.approveNote(note);
            }}
          >
            <Check aria-hidden data-icon="inline-start" />
            Approve
          </Button>
        )}
        <Button
          type="button"
          variant={replying ? "lit" : asking ? "ai" : "subtle"}
          size="phone-xs"
          aria-label={asking ? `Answer AI question ${target}` : `Needs work ${target}`}
          aria-expanded={replying}
          onClick={(e) => {
            e.stopPropagation();
            setReplying((r) => !r);
          }}
        >
          {asking ? (
            <MessageCircleQuestion aria-hidden data-icon="inline-start" />
          ) : (
            <Undo2 aria-hidden data-icon="inline-start" />
          )}
          {asking ? "Answer" : "Needs work"}
        </Button>
        <div className="ms-auto flex items-center gap-1">
          <RememberButton note={note} target={target} />
          <Button
            type="button"
            variant="subtle"
            size="phone-icon"
            aria-label={`Edit note ${target}`}
            disabled={noteSaving}
            onClick={(e) => {
              e.stopPropagation();
              const wasPlaying = playback.isPlaying;
              if (wasPlaying) playback.pause();
              lite.openEditNote(note, wasPlaying);
            }}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            type="button"
            variant="remove"
            size="phone-icon"
            aria-label={`Delete note ${target}`}
            onClick={(e) => {
              e.stopPropagation();
              lite.removeNote(note);
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      {replying && (
        <InlineFeedbackBox note={note} ask={asking} onDone={() => setReplying(false)} />
      )}
    </article>
  );
});

const DoneNoteCard = memo(function DoneNoteCard({
  note,
  num,
  editing,
  noteSaving,
}: {
  note: Note;
  num: number | null;
  editing: boolean;
  noteSaving: boolean;
}) {
  const target = noteActionTarget(num, stamp(note.t));
  return (
    <article
      data-note={note.id}
      data-tone="done"
      className={surfaceClass("done", { editing })}
    >
      <NoteCardHeader note={note} num={num} state="done" />
      <div className="mt-1 flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ExpandableText
            text={note.text}
            clampLines={1}
            onTap={() => jumpToNote(note, true)}
          />
          <NoteTags note={note} />
        </div>
        <div className="flex shrink-0 items-center gap-1 empty:hidden">
          <NoteThumb note={note} muted />
        </div>
      </div>
      <NoteFollowups note={note} state="done" />
      <div className="border-hairline-subtle mt-1 flex flex-wrap items-center gap-1 border-t pt-1">
        <div className="ms-auto flex items-center gap-1">
          <RememberButton note={note} target={target} />
          <Button
            type="button"
            variant="subtle"
            size="phone-icon"
            aria-label={`Edit note ${target}`}
            disabled={noteSaving}
            onClick={(e) => {
              e.stopPropagation();
              const wasPlaying = playback.isPlaying;
              if (wasPlaying) playback.pause();
              lite.openEditNote(note, wasPlaying);
            }}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            type="button"
            variant="subtle"
            size="phone-icon"
            aria-label={`Reopen note ${target}`}
            onClick={(e) => {
              e.stopPropagation();
              lite.reopenNote(note);
            }}
          >
            <RotateCcw aria-hidden />
          </Button>
          <Button
            type="button"
            variant="remove"
            size="phone-icon"
            aria-label={`Delete note ${target}`}
            onClick={(e) => {
              e.stopPropagation();
              lite.removeNote(note);
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
    </article>
  );
});

export function NoteList() {
  const notes = useLite((s) => s.notes);
  const noteNumbers = useLite((s) => s.noteNumbers);
  const flushStatus = useLite((s) => s.flushStatus);
  const noteSaving = useLite(liteNoteSavingOf);
  const statusFilter = useLite((s) => s.noteStatus);
  const editingId = useLite((s) =>
    s.composeState.status === "edit" ? s.composeState.compose.id : undefined,
  );
  const [doneOpen, setDoneOpen] = useState(false);

  const grouped = useMemo(() => filterAndGroupNotes(notes), [notes]);
  const doneLearnedCount = useMemo(
    () => grouped.done.filter((n) => Boolean(n.learned?.what)).length,
    [grouped.done],
  );

  const renderCard = (note: Note) => {
    const st = noteState(note);
    const num = noteNumbers[note.id] ?? null;
    const editing = note.id === editingId;
    if (st === "done") {
      return <DoneNoteCard key={note.id} note={note} num={num} editing={editing} noteSaving={noteSaving} />;
    }
    if (st === "check") {
      return <CheckNoteCard key={note.id} note={note} num={num} editing={editing} noteSaving={noteSaving} />;
    }
    return <OpenNoteCard key={note.id} note={note} num={num} editing={editing} noteSaving={noteSaving} />;
  };

  const saveText =
    flushStatus === "flushing"
      ? "Saving…"
      : flushStatus === "backoff"
        ? "Not sent. Retrying…"
        : notes.length
          ? "Saved"
          : "";

  return (
    <section
      aria-label="Notes"
      className="font-md @container relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <div className="flex flex-none flex-col">
        <div className="flex flex-none items-center gap-1.5 px-2.5 pt-1 pb-0.5">
          <h2 className="flex min-h-5 shrink-0 items-center px-0.5 text-sm leading-tight font-semibold tracking-tight whitespace-nowrap tabular-nums">
            <span>Notes</span>
            {notes.length > 0 && (
              <span className="text-label ms-1 font-mono text-xs font-medium tabular-nums">
                ({notes.length})
              </span>
            )}
          </h2>
          {saveText && (
            <span
              role="status"
              className={cn(
                "text-ui ms-auto text-end leading-snug tabular-nums",
                flushStatus === "backoff"
                  ? "text-warn-text font-semibold"
                  : flushStatus === "flushing"
                    ? "text-label font-medium"
                    : "text-ok-text font-medium",
              )}
            >
              {saveText}
            </span>
          )}
        </div>

        {notes.length > 0 && (
          <div
            role="tablist"
            aria-label="Filter notes by status"
            className="flex flex-none items-center gap-1 [scrollbar-width:none] overflow-x-auto px-2.5 pb-1"
          >
            {STATUS_TABS.map((tab) => {
              const count = grouped.counts[tab.id];
              const active = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-status-filter={tab.id}
                  onClick={() => lite.setNoteStatus(tab.id)}
                  className={cn(
                    "focus-visible:ring-ring inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2",
                    active
                      ? tab.id === "check"
                        ? "bg-warn/16 text-warn-text ring-warn/45 font-semibold ring-1"
                        : tab.id === "asking"
                          ? "bg-ai/16 text-ai-text ring-ai/45 font-semibold ring-1"
                          : tab.id === "open"
                            ? "bg-primary/16 text-primary-text ring-primary/45 font-semibold ring-1"
                            : tab.id === "done"
                              ? "bg-ok/16 text-ok-text ring-ok/45 font-semibold ring-1"
                              : "bg-secondary text-foreground ring-hairline-strong font-semibold ring-1"
                      : "text-label hover:bg-surface-subtle hover:text-foreground",
                  )}
                >
                  <span>{tab.label}</span>
                  <span className="text-tag font-mono tabular-nums opacity-85">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-hairline-subtle flex min-h-0 w-full flex-1 flex-col border-t pt-1">
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-2.5 pb-2">
          {statusFilter === "check" ? (
            grouped.check.length ? (
              grouped.check.map(renderCard)
            ) : (
              <EmptyState>Nothing waiting to check.</EmptyState>
            )
          ) : statusFilter === "asking" ? (
            grouped.asking.length ? (
              grouped.asking.map(renderCard)
            ) : (
              <EmptyState>No AI questions waiting.</EmptyState>
            )
          ) : statusFilter === "open" ? (
            grouped.open.length ? (
              grouped.open.map(renderCard)
            ) : (
              <EmptyState>Nothing left to fix.</EmptyState>
            )
          ) : statusFilter === "done" ? (
            grouped.done.length ? (
              grouped.done.map(renderCard)
            ) : (
              <EmptyState>Notes you approve land here.</EmptyState>
            )
          ) : (
            <>
              {grouped.check.length > 0 && (
                <>
                  <GroupHeading
                    label="To check"
                    count={grouped.check.length}
                    tone="text-warn-text"
                    state="check"
                  />
                  {grouped.check.map(renderCard)}
                </>
              )}
              {grouped.asking.length > 0 && (
                <>
                  <GroupHeading
                    label="AI asks"
                    count={grouped.asking.length}
                    tone="text-ai-text"
                    state="check"
                    asking
                  />
                  {grouped.asking.map(renderCard)}
                </>
              )}
              {grouped.open.length > 0 ? (
                <>
                  <GroupHeading
                    label="To fix"
                    count={grouped.open.length}
                    tone="text-primary-text"
                    state="open"
                  />
                  {grouped.open.map(renderCard)}
                </>
              ) : (
                grouped.check.length === 0 &&
                grouped.asking.length === 0 && (
                  <EmptyState>
                    {grouped.done.length
                      ? "Nothing left to fix"
                      : "No notes yet. Tap the video or Note to add one"}
                  </EmptyState>
                )
              )}
              {notes.length > 0 && (
                <div className="pt-0.5">
                  <button
                    type="button"
                    aria-expanded={doneOpen}
                    onClick={() => setDoneOpen((v) => !v)}
                    className="text-label hover:text-foreground focus-visible:ring-ring border-hairline-subtle bg-surface-subtle hover:bg-hairline flex min-h-7.5 w-full cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs leading-tight font-semibold transition-colors outline-none focus-visible:ring-2"
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        "size-3.5 transition-transform duration-150",
                        doneOpen && "rotate-90",
                      )}
                    />
                    <StatusGlyph state="done" />
                    <span>Done</span>
                    <span className="text-muted-foreground text-tag font-mono font-medium tabular-nums">
                      {grouped.done.length}
                    </span>
                    {!doneOpen && doneLearnedCount > 0 && (
                      <span className="text-ok-text text-xs font-medium">
                        · {doneLearnedCount} learned
                      </span>
                    )}
                  </button>
                  {doneOpen && (
                    <div className="mt-1.5 space-y-1.5">
                      {grouped.done.length ? (
                        grouped.done.map(renderCard)
                      ) : (
                        <EmptyState>Notes you approve land here.</EmptyState>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
