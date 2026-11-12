import { useSyncExternalStore } from "react";

import { Slider } from "@/components/ui/slider";

import { formatAuditionTime, type SoundKind } from "./library-view";
import { auditionProgress, auditionSnapshot, seekAudition, subscribeAudition } from "./sound";

// Subscribes solely to the auditioning Audio element so scrubbing/playing updates only the one active card
export function AuditionScrubber({
  id,
  label,
  fallbackSeconds,
  kind,
}: {
  id: string;
  label: string;
  fallbackSeconds: number;
  kind: SoundKind;
}) {
  useSyncExternalStore(subscribeAudition, auditionSnapshot);
  const { at, duration, known } = auditionProgress(fallbackSeconds);
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-2 ps-11 pe-1 pt-0.5 pb-0.5"
    >
      <div className="flex min-w-0 flex-1 items-center">
        <Slider
          appearance="scrub"
          min={0}
          max={duration}
          step={0.01}
          value={at}
          aria-label={`Seek ${label}`}
          onValueChange={(v: number | readonly number[]) =>
            seekAudition(id, typeof v === "number" ? v : v[0], fallbackSeconds)
          }
        />
      </div>
      <span className="text-tag text-muted-foreground flex-none tabular-nums">
        {formatAuditionTime(at, duration, kind, known)}
      </span>
    </div>
  );
}
