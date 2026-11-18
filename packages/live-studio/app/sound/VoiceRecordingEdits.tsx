import { Scissors, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { VoicePlaygroundItem } from "../../src/voice-playground.mjs";
import { appliedEditRows } from "./voice-region-view";

export function VoiceRecordingEdits({
  item,
  compact = false,
  onAdjust,
}: {
  item: VoicePlaygroundItem;
  compact?: boolean;
  onAdjust?: (openerId: string) => void;
}) {
  if (!item.version) return null;
  const rows = appliedEditRows(item),
    regenerated = item.version.edit.mode === "regenerate";
  const summary = rows.filter((row) =>
    ["Region", "Speed", "Pitch", "Volume", "Pause after"].includes(row.label),
  );
  return (
    <section
      aria-label="Applied section edit"
      className={cn(
        "flex min-w-0 flex-col gap-2",
        !compact && "border-primary/25 bg-tint rounded-lg border p-3",
      )}
    >
      <h4 className="text-primary-text flex items-center gap-1.5 text-sm font-semibold">
        {regenerated ? <Sparkles className="size-3.5" /> : <Scissors className="size-3.5" />}
        {regenerated ? "Applied phrase replacement" : "Applied local edit"}
      </h4>
      <p className="text-foreground text-xs leading-relaxed break-words">
        {summary.map((row) => `${row.label}: ${row.value}`).join(" · ")}
      </p>
      {regenerated && (
        <p className="text-foreground text-xs leading-relaxed break-words">
          “{item.version.edit.mode === "regenerate" ? item.version.edit.replacementText : ""}” ·{" "}
          {item.version.replacement?.voiceName || item.version.replacement?.voiceId} ·{" "}
          {item.version.replacement?.modelId}
        </p>
      )}
      <details>
        <summary className="text-muted-foreground focus-visible:outline-ring cursor-pointer rounded text-xs focus-visible:outline-2">
          Full applied settings
        </summary>
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground break-words">{row.label}</dt>
              <dd className="text-foreground min-w-0 break-words whitespace-pre-wrap">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </details>
      {item.version.historyGaps && (
        <p className="text-warn-text text-xs leading-relaxed">
          An earlier version was deleted. This recording and the remaining history are kept.
        </p>
      )}
      {onAdjust && (
        <Button
          id="voice-playground-adjust-recording"
          variant="secondary"
          size="sm"
          onClick={(event) => onAdjust(event.currentTarget.id)}
        >
          Adjust these edits
        </Button>
      )}
    </section>
  );
}
