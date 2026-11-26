import {
  ArrowDownToLine,
  Ban,
  Check,
  Columns2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { KitStatus } from "../../src/sound-kit-classify.mjs";
import { Tip } from "../components/Tip";
import { lightSounds, pickNamesUses, useCountOfNames } from "./sound";
import {
  type KitRow,
  type KitViewTab,
  notePlaceholderForCategory,
  suggestedTagsForCategory,
} from "./sound-kit-view";

const returnFocusToRow = (el: HTMLElement) => {
  const rowFocus = el.closest("[data-kit-row]")?.querySelector<HTMLElement>("[data-kit-row-focus]");
  if (rowFocus) rowFocus.focus({ preventScroll: true });
  else el.blur();
};

function TasteNoteInput({
  note,
  category,
  title,
  onSaveNote,
}: {
  note: string;
  category: KitRow["category"];
  title: string;
  onSaveNote: (note: string) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(note);
  const skipNextBlurRef = useRef(false);

  const commitNote = () => {
    const trimmed = noteDraft.trim();
    if (trimmed !== note) onSaveNote(trimmed);
  };

  return (
    <Input
      type="text"
      size="xs"
      value={noteDraft}
      maxLength={240}
      placeholder={notePlaceholderForCategory(category)}
      aria-label={`Taste note for ${title}`}
      onChange={(e) => setNoteDraft(e.target.value)}
      onBlur={() => {
        if (skipNextBlurRef.current) {
          skipNextBlurRef.current = false;
          return;
        }
        commitNote();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          skipNextBlurRef.current = true;
          commitNote();
          returnFocusToRow(e.currentTarget);
        } else if (e.key === "Escape") {
          e.preventDefault();
          skipNextBlurRef.current = true;
          setNoteDraft(note);
          returnFocusToRow(e.currentTarget);
        }
      }}
      className="min-w-36 @min-[560px]:flex-1"
    />
  );
}

function FocusedRowMetaEditor({
  row,
  onSaveTags,
  onSaveNote,
}: {
  row: KitRow;
  onSaveTags: (tags: string[]) => void;
  onSaveNote: (note: string) => void;
}) {
  const suggested = suggestedTagsForCategory(row.category);
  const tagSet = useMemo(() => new Set(row.tags), [row.tags]);

  const toggleTag = (tag: string) => {
    const next = tagSet.has(tag) ? row.tags.filter((t) => t !== tag) : [...row.tags, tag];
    onSaveTags(next);
  };

  return (
    <div className="border-border/50 mt-2 flex flex-col gap-1.5 border-t pt-2 @min-[560px]:flex-row @min-[560px]:flex-wrap @min-[560px]:items-center">
      <div className="flex flex-wrap items-center gap-1">
        {suggested.map((tag) => {
          const active = tagSet.has(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={active}
              onClick={() => toggleTag(tag)}
              className={cn(
                "studio-press focus-visible:ring-ring text-tag h-6 rounded-full border px-2 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
                active
                  ? "border-primary/50 bg-tint text-primary-text font-medium"
                  : "border-border/60 text-muted-foreground hover:text-foreground bg-transparent",
              )}
            >
              {tag}
            </button>
          );
        })}
      </div>
      <TasteNoteInput
        key={`${row.id}:${row.note}`}
        note={row.note}
        category={row.category}
        title={row.title}
        onSaveNote={onSaveNote}
      />
    </div>
  );
}

export const KitRowCard = memo(function KitRowCard({
  row,
  tab,
  isFocused,
  isPlaying,
  isTimelineSelected = false,
  isRevealed = false,
  hasSelectedClip,
  similarOpen,
  metaOpen,
  onFocus,
  onTogglePlay,
  onToggleMeta,
  onTriage,
  onRestorePass,
  onToggleStar,
  onToggleAb,
  onToggleSimilar,
  onApply,
  onRemove,
  onSaveTags,
  onSaveNote,
}: {
  row: KitRow;
  tab: KitViewTab;
  isFocused: boolean;
  isPlaying: boolean;
  isTimelineSelected?: boolean;
  isRevealed?: boolean;
  hasSelectedClip: boolean;
  similarOpen: boolean;
  metaOpen: boolean;
  onFocus: () => void;
  onTogglePlay: () => void;
  onToggleMeta: () => void;
  onTriage: (status: KitStatus) => void;
  onRestorePass: () => void;
  onToggleStar: () => void;
  onToggleAb: () => void;
  onToggleSimilar: () => void;
  onApply: () => void;
  onRemove: () => void;
  onSaveTags: (tags: string[]) => void;
  onSaveNote: (note: string) => void;
}) {
  const slotLetter = row.abIndex >= 0 ? String.fromCharCode(65 + row.abIndex) : null;
  const isPassed = row.status === "pass";
  const canPass = row.status === null || row.status === "inbox";
  const uses = useCountOfNames(row.variantIds);
  const alwaysShowMeta =
    row.status === "core" || row.status === "inbox" || row.tags.length > 0 || row.note.length > 0;
  const showMeta = isFocused && (metaOpen || alwaysShowMeta);

  return (
    <div
      data-kit-row={row.id}
      data-kit-status={row.status ?? "unreviewed"}
      data-timeline-selected={isTimelineSelected || undefined}
      onPointerEnter={() => lightSounds(row.variantIds)}
      onPointerLeave={() => lightSounds(null)}
      className={cn(
        "group flex flex-col rounded-lg border px-2.5 py-2 transition-colors duration-150 motion-reduce:transition-none",
        isRevealed
          ? "border-primary bg-tint/45 ring-primary/50 ring-2"
          : isTimelineSelected
            ? "border-primary/70 bg-tint/25 ring-primary/35 ring-1"
            : isPlaying
              ? "border-primary/75 bg-raised-3"
              : isFocused
                ? "border-primary/45 bg-raised-3/70"
                : isPassed
                  ? "border-border/55 bg-card/45 hover:bg-raised-3/45 border-dashed"
                  : "border-border bg-card/85 hover:border-raised-4/50 hover:bg-raised-3",
      )}
    >
      <div className="flex items-start gap-2">
        <Tip label={isPlaying ? "Pause preview" : "Preview audio"}>
          <Button
            variant="cover"
            size="cover"
            className="mt-0.5 flex-none"
            disabled={row.missingFromLibrary}
            aria-pressed={isPlaying}
            aria-label={`${isPlaying ? "Pause" : "Play"} ${row.title}`}
            onClick={onTogglePlay}
          >
            <span aria-hidden className="grid place-items-center">
              <Play
                className={cn(
                  "col-start-1 row-start-1 translate-x-[0.5px] fill-current transition-opacity duration-150 motion-reduce:transition-none",
                  isPlaying && "opacity-0",
                )}
              />
              <Pause
                className={cn(
                  "col-start-1 row-start-1 fill-current transition-opacity duration-150 motion-reduce:transition-none",
                  !isPlaying && "opacity-0",
                )}
              />
            </span>
          </Button>
        </Tip>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-h-6 items-start gap-1.5">
            <button
              type="button"
              data-kit-row-focus
              onClick={onFocus}
              onFocus={(e) => {
                if (e.currentTarget.matches(":focus-visible")) onFocus();
              }}
              title={row.title}
              className="focus-visible:ring-ring flex min-w-0 flex-1 items-start rounded py-0.5 text-start outline-none focus-visible:ring-2"
            >
              <span
                className={cn(
                  "text-ui min-w-0 flex-1 leading-snug font-medium wrap-anywhere",
                  isPassed ? "text-foreground/80" : "text-foreground",
                )}
              >
                {row.title}
              </span>
            </button>

            <div className="ms-auto flex flex-none items-center gap-1">
              {row.status === "core" && (
                <Tip label={row.tier === 1 ? "Unmark signature (T)" : "Mark signature go-to (T)"}>
                  <Button
                    variant="favorite"
                    size="icon-sm"
                    aria-pressed={row.tier === 1}
                    aria-label={
                      row.tier === 1
                        ? `Unmark ${row.title} as signature`
                        : `Mark ${row.title} as signature`
                    }
                    onClick={onToggleStar}
                  >
                    <Star className={cn(row.tier === 1 && "fill-current")} />
                  </Button>
                </Tip>
              )}

              {!row.missingFromLibrary && row.status !== "ban" && (
                <Tip label={hasSelectedClip ? "Swap onto selected clip" : "Add to track"}>
                  <Button
                    variant="card-action"
                    size="icon-sm"
                    aria-label={
                      hasSelectedClip
                        ? `Swap selected clip to ${row.title}`
                        : `Add ${row.title} at playhead`
                    }
                    onClick={onApply}
                  >
                    <Plus />
                  </Button>
                </Tip>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="card-action"
                      size="icon-sm"
                      aria-label={`More actions for ${row.title}`}
                    />
                  }
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {row.status !== "ban" && (
                    <DropdownMenuItem onClick={onToggleAb}>
                      <Columns2 />
                      <span>
                        {slotLetter ? `Remove from A/B (${slotLetter})` : "Add to A/B tray"}
                      </span>
                      <DropdownMenuShortcut>A</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={onToggleSimilar}>
                    <Sparkles />
                    <span>{similarOpen ? "Hide similar sounds" : "Find similar sounds"}</span>
                    <DropdownMenuShortcut>S</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  {row.status !== "ban" && (
                    <DropdownMenuItem onClick={onToggleStar}>
                      <Star className={cn(row.tier === 1 && "fill-current")} />
                      <span>{row.tier === 1 ? "Unmark signature" : "Mark as signature"}</span>
                      <DropdownMenuShortcut>T</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={onToggleMeta}>
                    <Tag />
                    <span>{showMeta ? "Hide tags & note" : "Tags & taste note"}</span>
                  </DropdownMenuItem>
                  {uses > 0 && (
                    <DropdownMenuItem onClick={() => pickNamesUses(row.variantIds, row.title)}>
                      <span>Select {uses > 1 ? `${uses} clips` : "clip"} on timeline</span>
                    </DropdownMenuItem>
                  )}
                  {row.status === "core" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onTriage("ban")} variant="destructive">
                        <Ban />
                        <span>Ban from AI search</span>
                        <DropdownMenuShortcut>X</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </>
                  )}
                  {row.status !== null && tab !== "popular" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onRemove} variant="destructive">
                        <Trash2 />
                        <span>Remove from kit</span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-snug tabular-nums">
              {isTimelineSelected && <Badge variant="audio">Selected</Badge>}
              {row.tier === 1 && (
                <Badge variant="audio">
                  <Star aria-hidden data-icon="inline-start" className="fill-current" />
                  Signature
                </Badge>
              )}
              {tab === "popular" && row.status === "core" && <Badge variant="done">Core</Badge>}
              {tab === "popular" && row.status === "inbox" && <Badge variant="tag">Inbox</Badge>}
              {isPassed && <Badge variant="tag">Passed</Badge>}
              {slotLetter && <Badge variant="tag-mono">A/B {slotLetter}</Badge>}
              <span>{row.category}</span>
              <span aria-hidden>·</span>
              <span className="truncate">{row.sourceLabel}</span>
              <span aria-hidden>·</span>
              <span>{row.durationLabel}</span>
              {row.variantCount > 1 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{row.variantCount} takes</span>
                </>
              )}
              {(row.wins > 0 || row.losses > 0) && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    Elo {Math.round(row.elo)} ({row.wins}W/{row.losses}L)
                  </span>
                </>
              )}
              {row.tags.length > 0 && (
                <span
                  title={row.tags.map((t) => `#${t}`).join(" ")}
                  className="text-tag text-primary-text truncate"
                >
                  {row.tags.map((t) => `#${t}`).join(" ")}
                </span>
              )}
            </span>

            <div className="ms-auto flex flex-none items-center gap-1">
              {row.status !== "core" && (
                <Tip label="Approve into Core Kit (K)">
                  <Button
                    variant="secondary"
                    size="xs"
                    aria-label={`Keep — approve ${row.title} into Core Kit`}
                    onClick={() => onTriage("core")}
                  >
                    <Check data-icon="inline-start" />
                    Keep
                  </Button>
                </Tip>
              )}

              {canPass && (
                <Tip label="Not now — push to bottom (P). AI can still find it.">
                  <Button
                    variant="tool"
                    size="xs"
                    aria-label={`Pass — push ${row.title} to bottom`}
                    onClick={() => onTriage("pass")}
                  >
                    <ArrowDownToLine data-icon="inline-start" />
                    Pass
                  </Button>
                </Tip>
              )}

              {isPassed && (
                <Tip label="Bring back to active list">
                  <Button
                    variant="tool"
                    size="xs"
                    aria-label={`Restore ${row.title} to active list`}
                    onClick={onRestorePass}
                  >
                    <RotateCcw data-icon="inline-start" />
                    Restore
                  </Button>
                </Tip>
              )}

              {row.status === "ban" ? (
                <Tip label="Restore to Inbox">
                  <Button
                    variant="secondary"
                    size="xs"
                    aria-label={`Unban — restore ${row.title} to Inbox`}
                    onClick={() => onTriage("inbox")}
                  >
                    <RotateCcw data-icon="inline-start" />
                    Unban
                  </Button>
                </Tip>
              ) : row.status !== "core" ? (
                <Tip label="Ban permanently from AI search (X)">
                  <Button
                    variant="remove"
                    size="icon-sm"
                    aria-label={`Ban ${row.title}`}
                    onClick={() => onTriage("ban")}
                  >
                    <Ban />
                  </Button>
                </Tip>
              ) : null}

              {uses > 0 && (
                <Tip
                  label={
                    uses > 1
                      ? `Select its ${uses} clips on the tracks`
                      : "Select its clip on the tracks"
                  }
                >
                  <button
                    type="button"
                    onClick={() => pickNamesUses(row.variantIds, row.title)}
                    aria-label={`Select the ${uses > 1 ? `${uses} clips` : "clip"} of ${row.title}`}
                    className={cn(
                      "focus-visible:ring-ring studio-press text-tag inline-flex h-6 flex-none items-center rounded-md px-2 font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
                      isTimelineSelected
                        ? "bg-tint text-primary-text"
                        : "bg-raised-3 text-foreground/85 hover:bg-tint hover:text-primary-text",
                    )}
                  >
                    {uses}×
                  </button>
                </Tip>
              )}
            </div>
          </div>
        </div>
      </div>

      {showMeta && (
        <FocusedRowMetaEditor row={row} onSaveTags={onSaveTags} onSaveNote={onSaveNote} />
      )}
    </div>
  );
});
