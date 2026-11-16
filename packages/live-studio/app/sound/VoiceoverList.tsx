import { ChevronDown, MicOff, Pause, Play, Scissors, SearchX } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { useStudio } from "../core/store";
import { formatSoundDuration, type NavGroupId, type NavSection } from "./library-view";
import { auditionTarget, listening, subscribeAudition } from "./sound";
import {
  findUnsplitNarrationRef,
  focusVoiceTake,
  listenVoiceFile,
  promoteVoiceTry,
  splitNarrationIntoBricks,
  voiceAuditionId,
} from "./voice-client";
import { voiceoverDisplayText } from "./voice-library-view";
import {
  parseTakeScript,
  shortTryLabel,
  subscribeVoiceNames,
  voiceActorTitle,
  voiceNamesSnapshot,
  type VoiceTakeItem,
} from "./voice-view";

const PAGE = 60;

export function VoiceoverList({
  takes,
  totalTakes,
  query,
  side,
  elsewhere,
  onToggleGroup,
  onClearQuery,
}: {
  takes: readonly VoiceTakeItem[];
  totalTakes: number;
  query: string;
  side: boolean;
  elsewhere: readonly NavSection[];
  onToggleGroup: (group: NavGroupId) => void;
  onClearQuery?: () => void;
}) {
  useStudio((s) => s.soundRev);
  useStudio((s) => s.timingRev);
  useSyncExternalStore(subscribeVoiceNames, voiceNamesSnapshot, voiceNamesSnapshot);
  const [limit, setLimit] = useState(PAGE);
  const [prevQuery, setPrevQuery] = useState(query);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [openAltTakeId, setOpenAltTakeId] = useState<string | null>(null);
  if (prevQuery !== query) {
    setPrevQuery(query);
    if (limit !== PAGE) setLimit(PAGE);
  }
  const now = useSyncExternalStore(subscribeAudition, listening, listening);
  const targetNow = useSyncExternalStore(subscribeAudition, auditionTarget, auditionTarget);
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
    <div className={cn("flex flex-col", side && "min-h-0 flex-1")}>
      {takes.length === 0 ? (
        <div
          className={cn(
            "flex items-center justify-center px-3 py-6",
            side && "min-h-0 flex-1 overflow-y-auto",
          )}
        >
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">{totalTakes === 0 ? <MicOff /> : <SearchX />}</EmptyMedia>
              <EmptyTitle>
                {totalTakes === 0 ? "No voiceover takes yet" : "No matching takes"}
              </EmptyTitle>
              <EmptyDescription>
                <span className="text-foreground/75">
                  {totalTakes === 0
                    ? "Generate voiceover takes for this film to audition phrases here."
                    : `No results for "${query.trim()}". Try another keyword or switch categories.`}
                </span>
              </EmptyDescription>
            </EmptyHeader>
            {(typed || elsewhere.length > 0) && (
              <EmptyContent>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {typed && onClearQuery && (
                    <Button variant="secondary" size="sm" onClick={onClearQuery}>
                      Clear search
                    </Button>
                  )}
                  {elsewhere.map((sec) => (
                    <Button
                      key={sec.id}
                      variant="secondary"
                      size="sm"
                      onClick={() => onToggleGroup(sec.id)}
                    >
                      {sec.count.toLocaleString()} in {sec.title}
                    </Button>
                  ))}
                </div>
              </EmptyContent>
            )}
          </Empty>
        </div>
      ) : (
        <ul
          className={cn(
            "grid auto-rows-max grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] content-start items-stretch gap-2",
            side && "scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3",
          )}
        >
          {unsplit && !typed && (
            <li className="border-border bg-card/85 col-span-full flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-xs font-medium">Full narration stem</p>
                <p className="text-tag text-foreground/70 truncate">
                  Split into {unsplit.count} phrase clips
                </p>
              </div>
              <Button
                variant="secondary"
                className="flex-none pointer-coarse:min-h-9"
                onClick={() => splitNarrationIntoBricks(unsplit.ref)}
              >
                <Scissors />
                <span>Split ({unsplit.count})</span>
              </Button>
            </li>
          )}

          {visible.map((take) => {
            const { tags, spoken } = parseTakeScript(take.text);
            const parsedTags = tags.flatMap((t) =>
              t
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            );
            const displaySpoken = voiceoverDisplayText(spoken || take.text);
            const cleanTitle = parsedTags.length
              ? `${displaySpoken} (${parsedTags.join(", ")})`
              : displaySpoken;
            const actor = voiceActorTitle(take.voice);
            const takeAudioId = take.file ? voiceAuditionId("takes", take.file) : "";
            const isTakePlaying = Boolean(takeAudioId && now === takeAudioId);
            const activeTryFile =
              take.tries.find((f) => targetNow === voiceAuditionId("try", f)) ?? null;
            const isTargetTake = Boolean(takeAudioId && targetNow === takeAudioId);
            const isPlaying =
              isTakePlaying ||
              Boolean(activeTryFile && now === voiceAuditionId("try", activeTryFile));
            const isActive = isTargetTake || Boolean(activeTryFile);
            const altsOpen = openAltTakeId === take.id;

            return (
              <li
                key={take.id}
                className={cn(
                  "group flex min-w-0 flex-col gap-1.5 rounded-lg border px-2.5 py-2 transition-colors duration-150 motion-reduce:transition-none",
                  isPlaying
                    ? "border-primary/75 bg-raised-3"
                    : isActive
                      ? "border-primary/45 bg-raised-3"
                      : "bg-card/85 hover:border-raised-4/50 hover:bg-raised-3 focus-within:border-raised-4/60 focus-within:bg-raised-3 border-border",
                )}
              >
                <div className="flex min-h-9 min-w-0 flex-1 items-stretch gap-2.5">
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
                      aria-label={`${isTakePlaying ? "Pause" : "Preview"} take ${take.id}`}
                      onClick={() => take.file && listenVoiceFile("takes", take.file)}
                      className="mt-0.5 flex-none"
                    >
                      {isTakePlaying ? (
                        <Pause className="fill-current" />
                      ) : (
                        <Play className="translate-x-[0.5px] fill-current" />
                      )}
                    </Button>
                  </Tip>

                  <button
                    type="button"
                    onClick={() => focusVoiceTake(take)}
                    title={cleanTitle}
                    className="focus-visible:ring-ring flex min-w-0 flex-1 flex-col justify-between gap-1 rounded-sm text-start outline-none focus-visible:ring-2"
                  >
                    <span className="text-ui text-foreground line-clamp-2 leading-snug">
                      <span className="text-tag text-primary-text me-1.5 font-mono tabular-nums">
                        {take.id}
                      </span>
                      {displaySpoken}
                    </span>
                    <span className="text-foreground/70 text-tag mt-auto flex min-w-0 items-center gap-1 leading-tight">
                      <span className="truncate">{actor}</span>
                      <span aria-hidden className="flex-none">
                        ·
                      </span>
                      <span className="flex-none whitespace-nowrap tabular-nums">
                        {take.file ? formatSoundDuration(take.seconds, "sfx") : "Unrendered"}
                      </span>
                    </span>
                  </button>
                </div>

                {(parsedTags.length > 0 || take.tries.length > 0) && (
                  <div className="flex min-h-6 items-center justify-between gap-1.5 ps-11.5">
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                      {parsedTags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="tag" className="max-w-36 flex-none">
                          <span className="truncate">{tag}</span>
                        </Badge>
                      ))}
                      {parsedTags.length > 3 && (
                        <Tip label={parsedTags.slice(3).join(", ")}>
                          <span className="text-tag text-foreground/70 flex-none tabular-nums">
                            +{parsedTags.length - 3}
                          </span>
                        </Tip>
                      )}
                    </div>

                    {take.tries.length > 0 && (
                      <Popover
                        open={altsOpen}
                        onOpenChange={(next) => setOpenAltTakeId(next ? take.id : null)}
                      >
                        <Tooltip open={altsOpen ? false : undefined}>
                          <TooltipTrigger
                            render={
                              <PopoverTrigger
                                render={
                                  <button
                                    type="button"
                                    aria-label={`${take.tries.length} alts for take ${take.id}`}
                                    className={cn(
                                      "focus-visible:ring-ring studio-press inline-flex h-6 flex-none items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-9 [&_svg]:pointer-events-none [&_svg]:shrink-0",
                                      activeTryFile || altsOpen
                                        ? "border-primary/45 bg-tint text-primary-text hover:bg-tint-hover"
                                        : "border-border/60 bg-raised-3 text-foreground/85 hover:bg-raised-4 hover:text-foreground",
                                    )}
                                  />
                                }
                              >
                                <span className="tabular-nums">
                                  {take.tries.length} {take.tries.length === 1 ? "alt" : "alts"}
                                </span>
                                <ChevronDown className="size-3" />
                              </PopoverTrigger>
                            }
                          />
                          <TooltipContent>
                            {`Browse ${take.tries.length} alternative takes`}
                          </TooltipContent>
                        </Tooltip>
                        <PopoverContent
                          align="end"
                          variant="flush"
                          className="w-[min(17rem,calc(100vw-1.5rem))] max-w-(--available-width)"
                        >
                          <div className="bg-backdrop flex flex-col gap-1.5 rounded-lg p-2.5 shadow-(--shadow-float)">
                            <p className="text-tag text-foreground/70 font-medium">
                              Take {take.id} alternatives
                            </p>
                            <div className="flex flex-col gap-1">
                              {take.tries.map((tryFile) => {
                                const tryId = voiceAuditionId("try", tryFile);
                                const isTryPlaying = now === tryId;
                                const label = shortTryLabel(take.id, tryFile);
                                const busy = promoting === `${take.id}:${tryFile}`;
                                return (
                                  <div
                                    key={tryFile}
                                    className="bg-raised-3/70 flex items-center justify-between gap-1.5 rounded-md px-1.5 py-1"
                                  >
                                    <button
                                      type="button"
                                      aria-pressed={isTryPlaying}
                                      aria-label={`${isTryPlaying ? "Pause" : "Preview"} ${label} for take ${take.id}`}
                                      onClick={() => listenVoiceFile("try", tryFile)}
                                      className={cn(
                                        "text-tag hover:bg-raised-4 focus-visible:ring-ring studio-press inline-flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 text-start transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-9",
                                        isTryPlaying
                                          ? "text-primary-text font-medium"
                                          : "text-foreground",
                                      )}
                                    >
                                      {isTryPlaying ? (
                                        <Pause className="size-3 flex-none fill-current" />
                                      ) : (
                                        <Play className="size-3 flex-none translate-x-[0.5px] fill-current" />
                                      )}
                                      <span className="truncate">{label}</span>
                                    </button>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      disabled={promoting !== null}
                                      className="h-6 flex-none pointer-coarse:min-h-9"
                                      aria-label={`Use ${label} as active take ${take.id}`}
                                      onClick={() => handleUseTry(take.id, tryFile)}
                                    >
                                      {busy ? "…" : "Use"}
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                )}
              </li>
            );
          })}

          {more > 0 && (
            <li className="col-span-full pt-1">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 w-full pointer-coarse:min-h-9"
                onClick={() => setLimit((n) => n + PAGE)}
              >
                <span className="truncate tabular-nums">
                  Show more ({more.toLocaleString()} remaining of {takes.length.toLocaleString()})
                </span>
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
