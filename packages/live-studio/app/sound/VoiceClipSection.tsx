import { Pause, Play, Scissors } from "lucide-react";
import { memo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Section } from "../components/inspector";
import { useStudio } from "../core/store";
import { AuditionScrubber } from "./AuditionScrubber";
import type { ClipRef } from "./slice";
import { clipOf, listening, type OneShot } from "./sound";
import {
  canSplitClipIntoBricks,
  currentClipVoiceSummary,
  listenVoiceFile,
  promoteVoiceTry,
  splitNarrationIntoBricks,
  useVoiceTakes,
  voiceAuditionId,
} from "./voice-client";
import { FAST_WPM, MIN_PACE_WORDS, shortTryLabel, SLOW_WPM } from "./voice-view";

export const VoiceClipSection = memo(function VoiceClipSection({ clip }: { clip: ClipRef }) {
  useStudio((s) => s.soundRev);
  useStudio((s) => s.timingRev);
  useVoiceTakes();
  const [promoting, setPromoting] = useState<string | null>(null);

  const c = clipOf(clip);
  if (!c || clip.list !== "sfx") return null;

  const summary = currentClipVoiceSummary(c as OneShot);
  const splitCount = canSplitClipIntoBricks(clip);
  const now = listening();
  const singleTake = summary.matches.length === 1 ? summary.matches[0].take : null;
  const offPace =
    summary.wpm !== null &&
    summary.wordCount >= MIN_PACE_WORDS &&
    (summary.wpm < SLOW_WPM || summary.wpm > FAST_WPM);

  const handleUseTry = async (takeId: string, tryFile: string) => {
    const key = `${takeId}:${tryFile}`;
    if (promoting) return;
    setPromoting(key);
    try {
      await promoteVoiceTry(takeId, tryFile);
    } finally {
      setPromoting(null);
    }
  };

  return (
    <Section
      title="Script"
      right={
        summary.wpm !== null ? (
          <span
            className={cn("text-tag tabular-nums", offPace ? "text-warn" : "text-muted-foreground")}
            title="Spoken words per minute inside this clip"
          >
            {summary.wpm} WPM
          </span>
        ) : undefined
      }
    >
      {summary.matches.length > 0 ? (
        <div className="flex flex-col gap-2">
          {summary.matches.slice(0, 4).map((m, idx) => (
            <div
              key={m.id ?? idx}
              className="bg-input/70 flex flex-col gap-1 rounded-md px-2.5 py-2"
            >
              <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                {m.id && (
                  <span className="text-tag text-primary font-mono tabular-nums">{m.id}</span>
                )}
                <span>{m.voiceTitle}</span>
                {m.tags.map((tag) => (
                  <Badge key={tag} variant="tag" className="max-w-44">
                    <span className="truncate">{tag}</span>
                  </Badge>
                ))}
              </div>
              <p className="text-ui text-foreground leading-snug">{m.spoken}</p>
            </div>
          ))}
          {summary.matches.length > 4 && (
            <p className="text-muted-foreground text-xs">
              +{summary.matches.length - 4} more voiceover takes in this clip
            </p>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          No aligned spoken words fall inside this slice.
        </p>
      )}

      {splitCount >= 2 && (
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => splitNarrationIntoBricks(clip)}
        >
          <Scissors />
          <span>Split into {splitCount} phrase bricks</span>
        </Button>
      )}

      {singleTake &&
        singleTake.tries.length > 0 &&
        (() => {
          const activeTry = singleTake.tries.find((f) => now === voiceAuditionId("try", f)) ?? null;
          return (
            <div className="flex flex-col gap-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground pe-0.5 text-xs">Try takes:</span>
                {singleTake.tries.map((tryFile) => {
                  const tryId = voiceAuditionId("try", tryFile);
                  const isPlaying = now === tryId;
                  const label = shortTryLabel(singleTake.id, tryFile);
                  const busy = promoting === `${singleTake.id}:${tryFile}`;
                  return (
                    <span
                      key={tryFile}
                      className="bg-raised-3 inline-flex items-center gap-0.5 rounded-md p-0.5"
                    >
                      <button
                        type="button"
                        aria-pressed={isPlaying}
                        aria-label={`${isPlaying ? "Stop" : "Preview"} ${label}`}
                        onClick={() => listenVoiceFile("try", tryFile)}
                        className={cn(
                          "hover:bg-raised-4 focus-visible:ring-ring inline-flex h-6 items-center gap-1 rounded-sm px-2 text-xs transition-colors outline-none focus-visible:ring-2",
                          isPlaying ? "text-primary" : "text-foreground",
                        )}
                      >
                        {isPlaying ? (
                          <Pause className="size-3 fill-current" />
                        ) : (
                          <Play className="size-3 fill-current" />
                        )}
                        <span>{label}</span>
                      </button>
                      <button
                        type="button"
                        disabled={promoting !== null}
                        aria-label={`Use ${label} for take ${singleTake.id}`}
                        onClick={() => handleUseTry(singleTake.id, tryFile)}
                        className="text-primary hover:bg-tint focus-visible:ring-ring inline-flex h-6 items-center rounded-sm px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 disabled:opacity-50"
                      >
                        {busy ? "…" : "Use"}
                      </button>
                    </span>
                  );
                })}
              </div>
              {activeTry && (
                <AuditionScrubber
                  id={voiceAuditionId("try", activeTry)}
                  label={`${singleTake.id} ${shortTryLabel(singleTake.id, activeTry)}`}
                  fallbackSeconds={0}
                  kind="sfx"
                />
              )}
            </div>
          );
        })()}
    </Section>
  );
});
