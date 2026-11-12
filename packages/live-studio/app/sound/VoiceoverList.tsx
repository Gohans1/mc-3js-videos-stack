import { Crosshair, Pause, Play, Scissors } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { useStudio } from "../core/store";
import { AuditionScrubber } from "./AuditionScrubber";
import { formatSoundDuration, type NavGroupId, type NavSection } from "./library-view";
import { listening } from "./sound";
import {
  findUnsplitNarrationRef,
  focusVoiceTake,
  listenVoiceFile,
  promoteVoiceTry,
  resolveVoiceTakeTarget,
  splitNarrationIntoBricks,
  voiceAuditionId,
} from "./voice-client";
import { parseTakeScript, shortTryLabel, voiceActorTitle, type VoiceTakeItem } from "./voice-view";

const PAGE = 60;

export function VoiceoverList({
  takes,
  totalTakes,
  query,
  side,
  elsewhere,
  onToggleGroup,
}: {
  takes: readonly VoiceTakeItem[];
  totalTakes: number;
  query: string;
  side: boolean;
  elsewhere: readonly NavSection[];
  onToggleGroup: (group: NavGroupId) => void;
}) {
  useStudio((s) => s.soundRev);
  useStudio((s) => s.timingRev);
  const [limit, setLimit] = useState(PAGE);
  const [prevQuery, setPrevQuery] = useState(query);
  const [promoting, setPromoting] = useState<string | null>(null);
  if (prevQuery !== query) {
    setPrevQuery(query);
    if (limit !== PAGE) setLimit(PAGE);
  }
  const now = listening();
  const unsplit = findUnsplitNarrationRef();
  const visible = takes.slice(0, limit);
  const more = takes.length - visible.length;
  const typed = query.trim() !== "";

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
    <ul
      className={cn(
        "flex flex-col gap-1.5",
        side && "scroll-fade min-h-0 flex-1 overflow-y-auto px-3 pb-3",
      )}
    >
      {unsplit && !typed && (
        <li className="border-border bg-card flex items-center justify-between gap-2 rounded-md border px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-xs font-medium">Full narration stem</p>
            <p className="text-tag text-muted-foreground truncate">
              Split into {unsplit.count} phrase clips
            </p>
          </div>
          <Button
            variant="secondary"
            className="flex-none"
            onClick={() => splitNarrationIntoBricks(unsplit.ref)}
          >
            <Scissors />
            <span>Split ({unsplit.count})</span>
          </Button>
        </li>
      )}

      {visible.map((take) => {
        const { tags, spoken } = parseTakeScript(take.text);
        const actor = voiceActorTitle(take.voice);
        const takeAudioId = take.file ? voiceAuditionId("takes", take.file) : "";
        const isTakePlaying = Boolean(takeAudioId && now === takeAudioId);
        const activeTryFile = take.tries.find((f) => now === voiceAuditionId("try", f)) ?? null;
        const activeScrubId = isTakePlaying
          ? takeAudioId
          : activeTryFile
            ? voiceAuditionId("try", activeTryFile)
            : null;
        const jumpTarget = resolveVoiceTakeTarget(take);
        const canJump = jumpTarget !== null;

        return (
          <li
            key={take.id}
            className="bg-card hover:bg-raised-3/70 flex flex-col gap-1.5 rounded-md px-2 py-1.5 transition-colors duration-150"
          >
            <div className="flex min-h-9 items-start gap-2.5">
              <Tip
                label={
                  !take.file
                    ? "Take audio not generated yet"
                    : isTakePlaying
                      ? "Pause take"
                      : "Preview take"
                }
              >
                <Button
                  variant="cover"
                  size="cover"
                  disabled={!take.file}
                  aria-pressed={isTakePlaying}
                  aria-label={`${isTakePlaying ? "Stop" : "Preview"} take ${take.id}`}
                  onClick={() => take.file && listenVoiceFile("takes", take.file)}
                  className="mt-0.5 flex-none"
                >
                  {isTakePlaying ? (
                    <Pause className="fill-current" />
                  ) : (
                    <Play className="fill-current" />
                  )}
                </Button>
              </Tip>

              <button
                type="button"
                onClick={() => focusVoiceTake(take)}
                title={take.text}
                className="focus-visible:ring-ring flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-start outline-none focus-visible:ring-2"
              >
                <span className="text-ui text-foreground line-clamp-2 leading-snug">
                  <span className="text-tag text-primary me-1.5 font-mono tabular-nums">
                    {take.id}
                  </span>
                  {spoken || take.text}
                </span>
                <span className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <span className="truncate">{actor}</span>
                    <span aria-hidden className="flex-none">
                      ·
                    </span>
                    <span className="flex-none whitespace-nowrap tabular-nums">
                      {take.file ? formatSoundDuration(take.seconds, "sfx") : "Unrendered"}
                    </span>
                  </span>
                  {tags.map((tag) => (
                    <Badge key={tag} variant="tag" className="max-w-44">
                      <span className="truncate">{tag}</span>
                    </Badge>
                  ))}
                </span>
              </button>

              {canJump && (
                <Tip label="Select phrase on timeline">
                  <Button
                    variant="card-action"
                    size="icon-sm"
                    aria-label={`Jump to take ${take.id} on timeline`}
                    onClick={() => focusVoiceTake(take)}
                    className="mt-0.5 flex-none pointer-coarse:size-9"
                  >
                    <Crosshair />
                  </Button>
                </Tip>
              )}
            </div>

            {take.tries.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 ps-11">
                <span className="text-tag text-muted-foreground pe-0.5">Alts:</span>
                {take.tries.map((tryFile) => {
                  const tryId = voiceAuditionId("try", tryFile);
                  const isTryPlaying = now === tryId;
                  const label = shortTryLabel(take.id, tryFile);
                  const busy = promoting === `${take.id}:${tryFile}`;
                  return (
                    <span
                      key={tryFile}
                      className="bg-raised-3 inline-flex items-center gap-0.5 rounded-md p-0.5"
                    >
                      <button
                        type="button"
                        aria-pressed={isTryPlaying}
                        aria-label={`${isTryPlaying ? "Stop" : "Preview"} ${label} for take ${take.id}`}
                        onClick={() => listenVoiceFile("try", tryFile)}
                        className={cn(
                          "text-tag hover:bg-raised-4 focus-visible:ring-ring inline-flex h-5 items-center gap-1 rounded-sm px-1.5 transition-colors outline-none focus-visible:ring-2",
                          isTryPlaying ? "text-primary" : "text-foreground",
                        )}
                      >
                        {isTryPlaying ? (
                          <Pause className="size-2.5 fill-current" />
                        ) : (
                          <Play className="size-2.5 fill-current" />
                        )}
                        <span>{label}</span>
                      </button>
                      <button
                        type="button"
                        disabled={promoting !== null}
                        aria-label={`Use ${label} as active take ${take.id}`}
                        onClick={() => handleUseTry(take.id, tryFile)}
                        className="text-tag text-primary hover:bg-tint focus-visible:ring-ring inline-flex h-5 items-center rounded-sm px-1.5 font-medium transition-colors outline-none focus-visible:ring-2 disabled:opacity-50"
                      >
                        {busy ? "…" : "Use"}
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {activeScrubId && (
              <AuditionScrubber
                id={activeScrubId}
                label={
                  isTakePlaying
                    ? `Take ${take.id}`
                    : `Take ${take.id} · ${shortTryLabel(take.id, activeTryFile!)}`
                }
                fallbackSeconds={isTakePlaying ? take.seconds : 0}
                kind="sfx"
              />
            )}
          </li>
        );
      })}

      {more > 0 && (
        <li className="pt-1">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 w-full"
            onClick={() => setLimit((n) => n + PAGE)}
          >
            Show more ({more} remaining of {takes.length})
          </Button>
        </li>
      )}

      {!takes.length && (
        <li className="bg-card text-ui text-muted-foreground flex flex-col items-start gap-2 rounded-md p-3">
          <p>
            {totalTakes === 0
              ? "No voiceover takes in src/edit.json yet. Add takes[] and run bun ../../scripts/voice/gen.ts (or bun run voice:gen)."
              : `No voiceover takes match "${query.trim()}".`}
          </p>
          {elsewhere.map((sec) => (
            <Button
              key={sec.id}
              variant="secondary"
              size="sm"
              className="h-7"
              onClick={() => onToggleGroup(sec.id)}
            >
              {sec.count} in {sec.title}
            </Button>
          ))}
        </li>
      )}
    </ul>
  );
}
