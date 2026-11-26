import { Check, Film, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { isSafeSoundId } from "../../src/sound-kit-classify.mjs";
import type { RecommendedSound } from "../../src/sound-kit-similar.d.mts";
import { Tip } from "../components/Tip";
import { say } from "../core/store";
import { cleanAudioTitle } from "./library-view";
import type { ClipRef } from "./slice";
import { clipOf, ensureSoundLibrary, itemOf, locked } from "./sound";
import {
  applyKitSoundToFilm,
  fetchRecommendedKit,
  previewSoundInVideo,
  saveKitAb,
  stopVideoPreview,
  stopVideoPreviewIfTarget,
  useSoundKit,
} from "./sound-kit-client";
import { inferClipKitCategory } from "./sound-kit-view";

export function ClipKitSwapBar({ clip, className }: { clip: ClipRef; className?: string }) {
  const kit = useSoundKit(true);
  const c = clipOf(clip);
  const [loaded, setLoaded] = useState<{
    baseKey: string;
    reqKey: string;
    picks: readonly RecommendedSound[];
  }>({
    baseKey: "",
    reqKey: "",
    picks: [],
  });

  const { list: clipList, i: clipIndex } = clip;
  useEffect(() => {
    void ensureSoundLibrary();
  }, []);

  useEffect(
    () => () => {
      stopVideoPreviewIfTarget({ list: clipList, i: clipIndex });
    },
    [clipList, clipIndex],
  );

  const isPreviewingThisClip =
    kit.videoPreview.active &&
    kit.videoPreview.targetClip?.list === clipList &&
    kit.videoPreview.targetClip?.i === clipIndex;
  const rawClipName = c?.name ?? "";
  const baseClipName = isPreviewingThisClip
    ? (kit.videoPreview.originalClipName ?? rawClipName)
    : rawClipName;
  const baseItem = baseClipName ? itemOf(baseClipName) : undefined;
  const clipCategory = baseClipName
    ? inferClipKitCategory(baseClipName, clipList, baseItem, kit.state)
    : null;
  const coreCount = Object.values(kit.state.items).filter(
    (x) => x.status === "core" && (!clipCategory || x.category === clipCategory),
  ).length;
  const baseKey = baseClipName && coreCount > 0 ? `${baseClipName}\0${clipCategory ?? ""}` : "";
  const reqKey = baseKey ? `${baseKey}\0${kit.stateRev}` : "";

  useEffect(() => {
    if (!reqKey || !baseKey) return;
    const controller = new AbortController();
    void fetchRecommendedKit({
      category: clipCategory,
      top: 5,
      ref: baseClipName,
      signal: controller.signal,
    }).then((res) => {
      if (controller.signal.aborted) return;
      setLoaded({ baseKey, reqKey, picks: res?.picks ?? [] });
    });
    return () => controller.abort();
  }, [reqKey, baseKey, clipCategory, baseClipName]);

  const picks = baseKey && loaded.baseKey === baseKey ? loaded.picks : [];

  if (!c || locked(clip) || !baseKey || picks.length === 0) return null;

  const loadIntoAb = () => {
    const ids = [...new Set([baseClipName, ...picks.map((p) => p.id)])]
      .filter((id) => isSafeSoundId(id))
      .slice(0, 4);
    if (!ids.length) return;
    void saveKitAb(ids).then((saved) => {
      if (saved) say(`Loaded ${ids.length} sounds into Core Kit A/B deck`);
    });
  };

  return (
    <div
      data-keep-click-focus
      className={cn(
        "border-border/60 bg-raised-2/60 flex flex-col gap-1.5 rounded-lg border p-2",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <Sparkles aria-hidden className="text-primary-text size-3 flex-none" />
        <span className="text-tag text-foreground font-semibold">
          Core Kit Quick-Swap{clipCategory ? ` · ${clipCategory}` : ""}
        </span>
        {isPreviewingThisClip ? (
          <Button
            variant="secondary"
            size="xs"
            className="ms-auto"
            onClick={() => stopVideoPreview(true)}
          >
            <X data-icon="inline-start" />
            Revert
          </Button>
        ) : (
          <Tip label="Load current clip + top picks into the A/B deck">
            <Button variant="tool" size="xs" className="ms-auto" onClick={loadIntoAb}>
              Load A/B
            </Button>
          </Tip>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {picks.map((p, idx) => {
          const isCurrent = p.id === baseClipName;
          const isLive = isPreviewingThisClip && kit.videoPreview.soundId === p.id;
          const isDecoding = kit.videoPreviewPendingId === p.id;
          const label = cleanAudioTitle(p.title || p.id, { mc: itemOf(p.id)?.kind === "mc" });
          return (
            <div
              key={p.id}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-1.5 py-1 transition-colors duration-150 motion-reduce:transition-none",
                isLive
                  ? "border-primary bg-tint"
                  : isCurrent
                    ? "border-primary/45 bg-raised-3"
                    : "border-border/50 bg-card/80",
              )}
            >
              <Tip label="Hear live in video at this clip's exact position">
                <Button
                  variant="tool"
                  size="icon-sm"
                  aria-pressed={isLive}
                  aria-busy={isDecoding}
                  aria-label={`${isLive ? "Stop previewing" : "Hear"} ${label} in video`}
                  onClick={() => {
                    if (isLive) stopVideoPreview(true);
                    else void previewSoundInVideo(p.id, clip);
                  }}
                >
                  {isDecoding ? <Loader2 className="motion-safe:animate-spin" /> : <Film />}
                </Button>
              </Tip>
              <span title={label} className="text-tag text-foreground min-w-0 flex-1 truncate">
                <span className="text-muted-foreground tabular-nums">{idx + 1}. </span>
                {label}
              </span>
              {isCurrent ? (
                <Badge variant="open">Current</Badge>
              ) : (
                <Button
                  variant="secondary"
                  size="xs"
                  aria-label={`Use ${label}`}
                  onClick={() =>
                    void applyKitSoundToFilm(
                      p.id,
                      p.category,
                      picks.filter((x) => x.id !== p.id).map((x) => x.id),
                      clip,
                    )
                  }
                >
                  <Check data-icon="inline-start" />
                  Use
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
