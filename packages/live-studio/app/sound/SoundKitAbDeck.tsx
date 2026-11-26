import {
  Check,
  Film,
  Layers,
  Minimize2,
  Pause,
  Plus,
  Sparkles,
  Trash2,
  Trophy,
  Volume2,
  X,
} from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import { classifyPopularSound, type KitCategoryId } from "../../src/sound-kit-classify.mjs";
import type { SoundKitState } from "../../src/sound-kit.d.mts";
import { Tip } from "../components/Tip";
import { say, useStudio } from "../core/store";
import { useFrame } from "../core/useFrame";
import { cleanAudioTitle, formatSoundDuration } from "./library-view";
import { itemOf, kindOf, listening, subscribeAudition } from "./sound";
import {
  applyKitSoundToFilm,
  getVideoTargetSummary,
  isEditableSoundClip,
  playKitSound,
  previewSoundInVideo,
  resolveKitAb,
  saveAbSlotsAsClipTry,
  saveKitAb,
  saveKitItem,
  setAbLoudnessMatch,
  stopVideoPreview,
  type VideoPreviewState,
} from "./sound-kit-client";

const SLOT_LETTERS = ["A", "B", "C", "D"] as const;

function VideoTargetBanner({
  videoPreview,
  onDockToWatch,
  onRestoreFocus,
}: {
  videoPreview: VideoPreviewState;
  onDockToWatch?: () => void;
  onRestoreFocus?: () => void;
}) {
  useFrame();
  const targetInfo = getVideoTargetSummary();
  const statusText = videoPreview.active
    ? `Live: ${videoPreview.targetLabel}`
    : `Ready in video: ${targetInfo.label}`;
  return (
    <div className="border-primary/35 bg-tint/50 flex items-center gap-1.5 rounded-md border px-2 py-1">
      <Film aria-hidden className="text-primary-text size-3.5 flex-none" />
      <span
        title={statusText}
        className="text-tag text-foreground min-w-0 flex-1 truncate tabular-nums"
      >
        {statusText}
      </span>
      {onDockToWatch && (
        <Tip label="Dock sidebar so you can watch the video canvas unobstructed">
          <Button variant="tool" size="xs" onClick={onDockToWatch}>
            <Minimize2 data-icon="inline-start" />
            Dock
          </Button>
        </Tip>
      )}
      {videoPreview.active && (
        <Button
          variant="secondary"
          size="xs"
          onClick={() => {
            stopVideoPreview(true);
            onRestoreFocus?.();
          }}
        >
          <X data-icon="inline-start" />
          Exit preview
        </Button>
      )}
    </div>
  );
}

export function SoundKitAbDeck({
  state,
  reasons,
  videoMode,
  videoPreview,
  loudnessPlayingId,
  abLoudnessMatch,
  activeCategory,
  selectedSlot,
  onSelectSlotIndex,
  onSelectSlot,
  onPinTab,
  onDockToWatch,
  onRestoreFocus,
}: {
  state: SoundKitState;
  reasons: readonly string[];
  videoMode: boolean;
  videoPreview: VideoPreviewState;
  loudnessPlayingId: string | null;
  abLoudnessMatch: boolean;
  activeCategory: KitCategoryId | "all";
  selectedSlot: number;
  onSelectSlotIndex: (idx: number) => void;
  onSelectSlot: (id: string) => void;
  onPinTab?: () => void;
  onDockToWatch?: () => void;
  onRestoreFocus?: () => void;
}) {
  const clip = useStudio((s) => s.clip);
  const hasEditableClip =
    isEditableSoundClip(clip) ||
    (videoPreview.active && isEditableSoundClip(videoPreview.targetClip));
  const nowPlaying = useSyncExternalStore(subscribeAudition, listening, listening);
  const banLosersId = useId();
  const [reason, setReason] = useState("");
  const [banLosers, setBanLosers] = useState(false);
  const [resolving, setResolving] = useState(false);

  const slots = state.abSlots;
  const safeIdx = slots.length ? Math.min(selectedSlot, slots.length - 1) : 0;
  const activeId = slots[safeIdx] ?? null;
  const activeInLibrary = Boolean(activeId && itemOf(activeId));
  const validLibrarySlotCount = slots.filter((id) => Boolean(itemOf(id))).length;

  const isSlotPlaying = (id: string) =>
    videoPreview.active
      ? videoPreview.soundId === id
      : loudnessPlayingId === id || nowPlaying === id;

  const triggerSlot = (idx: number) => {
    const id = slots[idx];
    if (!id) return;
    onSelectSlotIndex(idx);
    onSelectSlot(id);
    if (isSlotPlaying(id)) {
      if (videoPreview.active) stopVideoPreview(true);
      else playKitSound(id, { forcePlay: false, loudnessMatch: true });
      return;
    }
    if (videoMode) {
      void previewSoundInVideo(id);
    } else {
      playKitSound(id, { forcePlay: true, loudnessMatch: true });
    }
  };

  const resolveCategory = (id: string): KitCategoryId => {
    const tracked = Object.hasOwn(state.items, id) ? state.items[id] : undefined;
    if (tracked) return tracked.category;
    const lib = itemOf(id);
    const inferred = lib ? classifyPopularSound(lib) : null;
    if (inferred) return inferred;
    return activeCategory !== "all" ? activeCategory : "foley-core";
  };

  const handlePickWinner = async () => {
    if (!activeId || resolving) return;
    onPinTab?.();
    setResolving(true);
    try {
      const rejected = slots.filter((id) => id !== activeId);
      const category = resolveCategory(activeId);
      if (rejected.length === 0) {
        const next = await saveKitItem({
          id: activeId,
          category,
          status: "core",
          ...(reason.trim() ? { note: reason.trim() } : {}),
          addedBy: "human",
        });
        if (next) {
          setReason("");
          say(`Approved slot ${SLOT_LETTERS[safeIdx]} into Core Kit`);
        }
        return;
      }
      const targetLabel = getVideoTargetSummary().label;
      const next = await resolveKitAb({
        winner: activeId,
        rejected,
        category,
        reason: reason.trim(),
        context: videoMode ? `video:${targetLabel}` : "mini-studio",
        banRejected: banLosers,
        clearTray: false,
      });
      if (next) {
        setReason("");
        setBanLosers(false);
        const nextWinnerIdx = next.abSlots.indexOf(activeId);
        if (nextWinnerIdx >= 0) onSelectSlotIndex(nextWinnerIdx);
        else onSelectSlotIndex(0);
        const winnerItem = next.items[activeId];
        const eloText = winnerItem ? ` · Elo ${Math.round(winnerItem.elo)}` : "";
        say(`Picked slot ${SLOT_LETTERS[safeIdx]} as winner${eloText}`);
      }
    } finally {
      setResolving(false);
      onRestoreFocus?.();
    }
  };

  if (slots.length === 0 && !videoMode && !videoPreview.active) return null;

  return (
    <section
      aria-label="A/B comparison deck"
      className="border-border bg-card flex flex-none flex-col gap-2 border-t px-3 py-2"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-ui text-foreground flex flex-none items-center gap-1.5 font-semibold">
          <Sparkles aria-hidden className="text-primary-text size-3.5" />
          A/B Deck
          <span className="text-tag text-muted-foreground font-normal tabular-nums">
            {slots.length}/4
          </span>
        </span>

        {!videoMode && (
          <span className="text-tag text-muted-foreground min-w-0 truncate">Press 1–4</span>
        )}

        <div className="ms-auto flex flex-none items-center gap-1">
          {!videoMode && (
            <Tip label="Match perceived loudness across A/B slots">
              <Button
                variant="tool"
                size="xs"
                aria-pressed={abLoudnessMatch}
                onClick={() => setAbLoudnessMatch(!abLoudnessMatch)}
              >
                <Volume2 data-icon="inline-start" />
                <span>Match dB</span>
              </Button>
            </Tip>
          )}
          {slots.length > 0 && (
            <Tip label="Clear A/B tray">
              <Button
                variant="tool"
                size="icon-sm"
                aria-label="Clear A/B tray"
                onClick={() => {
                  onRestoreFocus?.();
                  void saveKitAb([]).finally(() => onRestoreFocus?.());
                }}
              >
                <Trash2 />
              </Button>
            </Tip>
          )}
        </div>
      </div>

      {(videoMode || videoPreview.active) && (
        <VideoTargetBanner
          videoPreview={videoPreview}
          onDockToWatch={onDockToWatch}
          onRestoreFocus={onRestoreFocus}
        />
      )}

      {slots.length === 0 ? (
        <p className="text-tag text-muted-foreground py-0.5 leading-relaxed">
          Press <Kbd>A</Kbd> on any sound to load up to 4 candidates for instant <Kbd>1–4</Kbd>{" "}
          switching in Studio or live inside the video.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5 @min-[580px]:grid-cols-4">
            {SLOT_LETTERS.map((letter, idx) => {
              const id = slots[idx];
              if (!id) {
                return (
                  <div
                    key={letter}
                    className="border-border/60 text-muted-foreground flex h-12 items-center justify-center rounded-md border border-dashed text-xs"
                  >
                    {letter} · empty
                  </div>
                );
              }
              const lib = itemOf(id);
              const item = Object.hasOwn(state.items, id) ? state.items[id] : undefined;
              const isSelected = idx === safeIdx;
              const isPlaying = isSlotPlaying(id);
              const label = lib
                ? cleanAudioTitle(lib.title?.trim() || id, { mc: lib.kind === "mc" })
                : id;
              const dur = lib ? formatSoundDuration(lib.seconds, kindOf(lib)) : "—";
              return (
                <div
                  key={id}
                  className={cn(
                    "group relative flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors duration-150 motion-reduce:transition-none",
                    isPlaying
                      ? "border-primary bg-tint"
                      : isSelected
                        ? "border-primary/55 bg-raised-3"
                        : "border-border bg-raised-2 hover:bg-raised-3",
                  )}
                >
                  <button
                    type="button"
                    title={`${letter}: ${label}`}
                    aria-label={`${isPlaying ? "Pause" : "Play"} slot ${letter}: ${label} (key ${idx + 1})`}
                    aria-pressed={isPlaying}
                    onClick={() => triggerSlot(idx)}
                    className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-1.5 rounded text-start outline-none focus-visible:ring-2"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-5 flex-none items-center justify-center rounded font-mono text-xs font-semibold tabular-nums",
                        isPlaying
                          ? "bg-primary text-primary-foreground"
                          : "bg-raised-4 text-foreground",
                      )}
                    >
                      {isPlaying ? <Pause className="size-3 fill-current" /> : idx + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-tag text-foreground truncate font-medium">
                        {letter}: {label}
                      </span>
                      <span className="text-tag text-muted-foreground truncate tabular-nums">
                        {dur}
                        {item ? ` · Elo ${Math.round(item.elo)}` : ""}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="remove"
                    size="icon-sm"
                    aria-label={`Remove ${label} from A/B tray`}
                    onClick={() => {
                      const nextSlots = slots.filter((s) => s !== id);
                      if (idx < safeIdx) onSelectSlotIndex(Math.max(0, safeIdx - 1));
                      else if (idx === safeIdx) {
                        onSelectSlotIndex(Math.max(0, Math.min(safeIdx, nextSlots.length - 1)));
                      }
                      onRestoreFocus?.();
                      void saveKitAb(nextSlots).finally(() => onRestoreFocus?.());
                    }}
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
          </div>

          {activeId && (
            <div className="flex flex-col gap-2 pt-0.5">
              <div className="flex flex-wrap items-center gap-1">
                {reasons.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={reason === r}
                    onClick={() => setReason((cur) => (cur === r ? "" : r))}
                    className={cn(
                      "studio-press focus-visible:ring-ring text-tag h-6 rounded-full border px-2 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none",
                      reason === r
                        ? "border-primary/50 bg-tint text-primary-text font-medium"
                        : "border-border/60 text-muted-foreground hover:text-foreground bg-transparent",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {slots.length >= 2 && (
                  <label
                    htmlFor={banLosersId}
                    className="text-tag text-foreground/85 inline-flex min-h-6 cursor-pointer items-center gap-1.5 pe-1"
                  >
                    <Checkbox
                      id={banLosersId}
                      size="sm"
                      checked={banLosers}
                      onCheckedChange={(checked) => setBanLosers(Boolean(checked))}
                    />
                    <span>Ban losers</span>
                  </label>
                )}

                <div className="ms-auto flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={resolving}
                    onClick={() => void handlePickWinner()}
                  >
                    {slots.length >= 2 ? (
                      <Trophy data-icon="inline-start" />
                    ) : (
                      <Check data-icon="inline-start" />
                    )}
                    {slots.length >= 2
                      ? `Pick ${SLOT_LETTERS[safeIdx]} winner`
                      : `Keep ${SLOT_LETTERS[safeIdx]} in core`}
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!activeInLibrary}
                    onClick={() =>
                      void applyKitSoundToFilm(
                        activeId,
                        resolveCategory(activeId),
                        slots.filter((s) => s !== activeId),
                      )
                    }
                  >
                    {hasEditableClip ? (
                      <Check data-icon="inline-start" />
                    ) : (
                      <Plus data-icon="inline-start" />
                    )}
                    {hasEditableClip ? "Apply to clip" : "Drop at playhead"}
                  </Button>

                  {hasEditableClip && validLibrarySlotCount >= 2 && (
                    <Tip label="Attach all A/B slots to this clip so you can switch A/B/C/D on the video canvas">
                      <Button
                        variant="tool"
                        size="sm"
                        onClick={() => void saveAbSlotsAsClipTry(slots)}
                      >
                        <Layers data-icon="inline-start" />
                        Save as try
                      </Button>
                    </Tip>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
