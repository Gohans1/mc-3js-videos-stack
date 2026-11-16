import { useSyncExternalStore } from "react";

import { Slider } from "@/components/Slider";
import { cn } from "@/lib/utils";

import { formatAuditionTime, type SoundKind } from "./library-view";
import {
  auditionProgress,
  auditionSnapshot,
  auditionTarget,
  seekAudition,
  subscribeAudition,
} from "./sound";

// Subscribes solely to the auditioning Audio element so scrubbing/playing updates only the one active card
export function AuditionScrubber({
  id,
  label,
  fallbackSeconds,
  kind,
  flush = false,
  className,
}: {
  id: string;
  label: string;
  fallbackSeconds: number;
  kind: SoundKind;
  flush?: boolean;
  className?: string;
}) {
  useSyncExternalStore(subscribeAudition, auditionSnapshot, auditionSnapshot);
  const isCurrent = auditionTarget() === id;
  const { at, duration, known } = isCurrent
    ? auditionProgress(fallbackSeconds)
    : { at: 0, duration: Math.max(0.01, fallbackSeconds), known: fallbackSeconds > 0 };
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "flex items-center gap-2 pt-0.5 pb-0.5",
        flush ? "px-0.5" : "ps-11 pe-1",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center">
        <Slider
          appearance="scrub"
          min={0}
          max={duration}
          step={0.01}
          value={at}
          disabled={!known}
          aria-label={`Seek ${label}`}
          onValueChange={(v: number | readonly number[]) =>
            seekAudition(id, typeof v === "number" ? v : v[0], fallbackSeconds)
          }
        />
      </div>
      <span className="text-tag text-foreground/75 flex-none tabular-nums">
        {formatAuditionTime(at, duration, kind, known)}
      </span>
    </div>
  );
}
