import { Check, Pause, Play, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { KitCategoryId } from "../../src/sound-kit-classify.mjs";
import type { SimilarSoundResult } from "../../src/sound-kit-similar.d.mts";
import type { SoundKitState } from "../../src/sound-kit.d.mts";
import { cleanAudioTitle, formatSoundDuration, sourceTitle } from "./library-view";
import { itemOf, listening, subscribeAudition } from "./sound";
import {
  fetchSimilarKit,
  playKitSound,
  previewSoundInVideo,
  saveKitItem,
  stopVideoPreview,
  toggleKitAbSlot,
  type VideoPreviewState,
} from "./sound-kit-client";

export function SoundKitSimilarDrawer({
  targetId,
  fallbackCategory,
  kitState,
  videoMode,
  videoPreview,
  loudnessPlayingId,
  onPinTab,
  onRestoreFocus,
  onClose,
}: {
  targetId: string;
  fallbackCategory: KitCategoryId;
  kitState: SoundKitState;
  videoMode: boolean;
  videoPreview: VideoPreviewState;
  loudnessPlayingId: string | null;
  onPinTab?: () => void;
  onRestoreFocus?: () => void;
  onClose: () => void;
}) {
  const nowPlaying = useSyncExternalStore(subscribeAudition, listening, listening);
  const [retryTick, setRetryTick] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    result: SimilarSoundResult | null;
    failed: boolean;
  }>({
    key: "",
    result: null,
    failed: false,
  });

  const reqKey = `${targetId}\0${retryTick}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetchSimilarKit(targetId, { limit: 10, signal: controller.signal }).then((res) => {
      if (controller.signal.aborted) return;
      setLoaded({ key: reqKey, result: res, failed: res === null });
    });
    return () => controller.abort();
  }, [reqKey, targetId]);

  const loading = loaded.key !== reqKey;
  const result = loading ? null : loaded.result;
  const failed = !loading && loaded.failed;
  const abSlotSet = new Set(kitState.abSlots);
  const targetLib = itemOf(targetId);
  const targetLabel = cleanAudioTitle(targetLib?.title?.trim() || targetId, {
    mc: targetLib?.kind === "mc",
  });

  return (
    <section
      aria-label={`Similar sounds to ${targetLabel}`}
      className="border-border bg-raised-2 flex flex-none flex-col gap-1.5 border-t px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden className="text-primary-text size-3.5 flex-none" />
        <span
          title={`${targetLabel} (${targetId})`}
          className="text-ui text-foreground min-w-0 flex-1 truncate font-medium"
        >
          Similar to {targetLabel}
        </span>
        {result && (
          <Badge variant="tag">
            {result.mode === "vector" ? "Audio vector" : "Metadata"} · {result.hits.length}
          </Badge>
        )}
        <Button variant="tool" size="icon-sm" aria-label="Close similar sounds" onClick={onClose}>
          <X />
        </Button>
      </div>

      {loading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Finding acoustic neighbors"
          className="flex flex-col gap-1 py-1"
        >
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : failed ? (
        <div className="flex items-center gap-2 py-1.5">
          <p className="text-tag text-muted-foreground min-w-0 flex-1">
            Could not load similar sounds. Check Live Studio and retry.
          </p>
          <Button variant="secondary" size="xs" onClick={() => setRetryTick((n) => n + 1)}>
            <RotateCcw data-icon="inline-start" />
            Retry
          </Button>
        </div>
      ) : !result?.hits.length ? (
        <p className="text-tag text-muted-foreground py-2">
          No similar sounds found in the vault for this cue.
        </p>
      ) : (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto overscroll-contain pe-0.5">
          {result.hits.map((hit) => {
            const tracked = Object.hasOwn(kitState.items, hit.name)
              ? kitState.items[hit.name]
              : undefined;
            const inAb = abSlotSet.has(hit.name);
            const isPlaying = videoPreview.active
              ? videoPreview.soundId === hit.name
              : loudnessPlayingId === hit.name || nowPlaying === hit.name;
            const label = cleanAudioTitle(hit.title || hit.name, { mc: hit.kind === "mc" });
            const hitCat = tracked?.category ?? hit.kitCategory ?? fallbackCategory;
            return (
              <li
                key={hit.name}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors duration-150 motion-reduce:transition-none",
                  isPlaying
                    ? "border-primary/65 bg-raised-3"
                    : "border-border/60 bg-card/80 hover:bg-raised-3",
                )}
              >
                <Button
                  variant="cover"
                  size="icon-sm"
                  aria-pressed={isPlaying}
                  aria-label={`${isPlaying ? "Pause" : "Play"} ${label}`}
                  onClick={() => {
                    if (isPlaying) {
                      if (videoPreview.active) stopVideoPreview(true);
                      else playKitSound(hit.name, { forcePlay: false, loudnessMatch: true });
                      return;
                    }
                    if (videoMode) void previewSoundInVideo(hit.name);
                    else playKitSound(hit.name, { forcePlay: false, loudnessMatch: true });
                  }}
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
                <div className="flex min-w-0 flex-1 flex-col">
                  <span title={label} className="text-tag text-foreground truncate font-medium">
                    {label}
                  </span>
                  <span className="text-tag text-muted-foreground truncate tabular-nums">
                    {Math.min(100, Math.max(0, Math.round(hit.score * 100)))}% ·{" "}
                    {formatSoundDuration(hit.seconds, hit.kind as "bgm" | "sfx" | "mc")} ·{" "}
                    {sourceTitle(hit.source || "film")}
                  </span>
                </div>
                {tracked?.status === "core" ? (
                  <Badge variant="done">Core</Badge>
                ) : (
                  <>
                    {tracked?.status === "pass" && <Badge variant="tag">Passed</Badge>}
                    {tracked?.status === "inbox" ? (
                      <Badge variant="tag">Inbox</Badge>
                    ) : (
                      <Button
                        variant="tool"
                        size="xs"
                        aria-label={`Inbox — stage ${label}`}
                        onClick={() => {
                          onPinTab?.();
                          void saveKitItem({
                            id: hit.name,
                            category: hitCat,
                            status: "inbox",
                            addedBy: "human",
                          }).finally(() => onRestoreFocus?.());
                        }}
                      >
                        <Plus data-icon="inline-start" />
                        Inbox
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="xs"
                      aria-label={`Keep — approve ${label} into Core Kit`}
                      onClick={() => {
                        onPinTab?.();
                        void saveKitItem({
                          id: hit.name,
                          category: hitCat,
                          status: "core",
                          addedBy: "human",
                        }).finally(() => onRestoreFocus?.());
                      }}
                    >
                      <Check data-icon="inline-start" />
                      Keep
                    </Button>
                  </>
                )}
                <Button
                  variant="tool"
                  size="xs"
                  aria-pressed={inAb}
                  aria-label={
                    inAb ? `A/B — remove ${label} from tray` : `A/B — add ${label} to tray`
                  }
                  onClick={() => {
                    onPinTab?.();
                    void toggleKitAbSlot(hit.name);
                  }}
                >
                  A/B
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
