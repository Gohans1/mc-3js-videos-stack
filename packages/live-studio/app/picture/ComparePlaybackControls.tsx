import type { KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";

import { S } from "../core/state";
import { useStudio } from "../core/store";
import { FPS } from "../core/time";
import { seek, skipCompareVideo } from "../playback/transport";
import { setCompareVideoAudio } from "./compare-video";
import {
  compareItemLikelyHasAudio,
  compareReferenceItem,
  compareVideoUrl,
} from "./compare-video-model";
import {
  compareVideoErrorOf,
  compareVideoMetaOf,
  compareVideoPathOf,
  compareVideoReadyOf,
} from "./slice";

export function handleCompareSeekKey(e: KeyboardEvent): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowRight" && e.key !== "ArrowLeft"))
    return false;
  const direction = e.key === "ArrowRight" ? 1 : -1;
  e.preventDefault();
  e.stopPropagation();
  if (e.shiftKey) seek(S.t + (direction * 5) / FPS);
  else skipCompareVideo(direction);
  return true;
}

export function ComparePlaybackControls() {
  const videos = useStudio((s) => s.compareCatalog.videos);
  const path = useStudio(compareVideoPathOf);
  const audioMode = useStudio((s) => s.compareVideoAudio);
  const referenceStatus = useStudio((s) => s.compareReferenceAudioStatus);
  const ready = useStudio(compareVideoReadyOf);
  const error = useStudio(compareVideoErrorOf);
  const meta = useStudio(compareVideoMetaOf);
  const preferredRef = useStudio((s) => s.compareCatalog.canBuild.ref);
  const activeItem = videos.find((v) => v.path === path) ?? null;
  if (!activeItem) return null;

  const hasAudio =
    meta?.path === activeItem.path ? meta.hasAudio : compareItemLikelyHasAudio(activeItem);
  const ref = compareReferenceItem(activeItem, videos, preferredRef);
  const refState =
    ref && referenceStatus?.src === compareVideoUrl(ref) ? referenceStatus.state : null;
  const refIssue =
    !ref || refState === "unavailable"
      ? "REF audio unavailable"
      : refState === "silent"
        ? "REF has no audio"
        : refState === "ready"
          ? null
          : "Loading REF audio…";
  const mp4Label =
    activeItem.category === "reference" || activeItem.embeddedAudio === "ref"
      ? "REF in MP4"
      : activeItem.category === "render" || activeItem.embeddedAudio === "ours"
        ? "OURS export"
        : "MP4 track";
  const issue =
    audioMode === "reference"
      ? refIssue
      : audioMode === "video" && !hasAudio
        ? "MP4 has no audio"
        : null;
  const sources = [
    {
      mode: "reference",
      label: "REF original",
      disabled: refState !== "ready",
      help: refIssue ?? `Original reference sound from ${ref?.name}`,
    },
    {
      mode: "video",
      label: mp4Label,
      disabled: !hasAudio,
      help: hasAudio
        ? mp4Label === "MP4 track"
          ? "Sound embedded in this MP4. This export does not identify its audio source."
          : `Sound embedded in ${activeItem.name}`
        : "This video has no embedded audio",
    },
    {
      mode: "studio",
      label: "Live mix",
      disabled: false,
      help: "Current Studio sound, including live edits",
    },
  ] as const;

  return (
    <>
      <div role="group" aria-label="Compare seek" className="flex shrink-0 gap-0.5">
        <Button
          type="button"
          variant="toolbar"
          size="xs"
          aria-label="Back 5 seconds"
          title="Back 5 seconds (←)"
          disabled={!ready || Boolean(error)}
          onClick={() => skipCompareVideo(-1)}
        >
          −5s
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="xs"
          aria-label="Forward 5 seconds"
          title="Forward 5 seconds (→)"
          disabled={!ready || Boolean(error)}
          onClick={() => skipCompareVideo(1)}
        >
          +5s
        </Button>
      </div>
      <div role="group" aria-label="Compare audio source" className="flex shrink-0 gap-0.5">
        {sources.map(({ mode, label, disabled, help }) => (
          <Button
            key={mode}
            type="button"
            variant={audioMode === mode ? "lit" : "toolbar"}
            size="xs"
            aria-label={`Audio source: ${label}`}
            aria-pressed={audioMode === mode}
            title={help}
            disabled={disabled}
            onClick={() => setCompareVideoAudio(mode)}
          >
            {label}
          </Button>
        ))}
      </div>
      {issue && (
        <span
          role="status"
          className="text-muted-foreground min-w-0 truncate text-xs"
          title={issue}
        >
          {issue}
        </span>
      )}
    </>
  );
}
