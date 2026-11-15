// Virtualized English ElevenLabs v4 voice browser: instant sample previewing,
// favorites sync, Copy ID, Compose Note handoff, and background sync controls.
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  MessageSquarePlus,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { SharedVoiceEntry } from "../../src/voice-library.mjs";
import { FavoriteStar } from "../components/FavoriteStar";
import { EmptyCard } from "../components/inspector";
import { Tip } from "../components/Tip";
import { VirtualList } from "../components/VirtualList";
import { say } from "../core/store";
import { openVoiceNote, originOf } from "../notes/notes";
import { AuditionScrubber } from "./AuditionScrubber";
import { listening, listenUrl, subscribeAudition } from "./sound";
import {
  loadVoiceLibrary,
  syncVoiceLibraryNow,
  type VoiceLibraryClientState,
} from "./voice-library-client";
import {
  DEFAULT_VOICE_FILTERS,
  formatCompactCount,
  hasActiveVoiceFilters,
  voiceDetailLine,
  type VoiceFilters,
  voiceStarId,
  voiceTitle,
} from "./voice-library-view";

const VoiceCard = memo(function VoiceCard({
  voice,
  isPlaying,
  isExpanded,
  inFilm,
  onToggleExpand,
}: {
  voice: SharedVoiceEntry;
  isPlaying: boolean;
  isExpanded: boolean;
  inFilm: boolean;
  onToggleExpand: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const auditionId = `gv:${voice.id}`;
  const detail = voiceDetailLine(voice);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(voice.id);
      setCopied(true);
      say(`Copied voice ID for ${voice.name}`);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1400);
    } catch {
      say(`Voice ID: ${voice.id}`);
    }
  };

  return (
    <div className="group bg-card hover:bg-raised-3/70 flex flex-col gap-1 rounded-md px-2 py-1.5 transition-colors duration-150 select-none">
      <div className="flex min-h-9 items-center gap-2">
        <Tip label={isPlaying ? "Pause preview" : "Preview voice sample"}>
          <Button
            variant="cover"
            size="cover"
            disabled={!voice.previewUrl}
            onClick={() => {
              if (voice.previewUrl) listenUrl(auditionId, voice.previewUrl);
            }}
            aria-label={isPlaying ? `Pause ${voice.name}` : `Preview ${voice.name}`}
            aria-pressed={isPlaying}
          >
            {isPlaying ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </Button>
        </Tip>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                "text-ui text-foreground min-w-0 flex-1",
                isExpanded ? "leading-snug" : "truncate",
              )}
              title={voice.name}
            >
              {voice.name}
            </span>
            <FavoriteStar kind="effects" id={voiceStarId(voice.id)} name={voice.name} onCard />
          </div>
          <div className="flex items-center justify-between gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {voice.v4 && (
                <Badge variant="synth" className="flex-none">
                  v4
                </Badge>
              )}
              {voice.rate > 1 && (
                <Badge
                  variant="claim"
                  className="flex-none"
                  title={`Consumes ${voice.rate}× credits per character`}
                >
                  {voice.rate}×
                </Badge>
              )}
              {inFilm && (
                <Badge variant="voice" className="flex-none" title="Used in current film narration">
                  In film
                </Badge>
              )}
              {detail && (
                <span className="text-muted-foreground text-tag min-w-0 truncate leading-tight">
                  {detail}
                </span>
              )}
            </div>

            <div className="flex flex-none items-center gap-0.5">
              <Tip label={copied ? "Copied ID" : `Copy voice ID (${voice.id})`}>
                <Button
                  variant="card-action"
                  size="icon-sm"
                  className="size-6 pointer-coarse:size-9 [&_svg]:size-3.5"
                  aria-label={`Copy voice ID for ${voice.name}`}
                  onClick={() => void copyId()}
                >
                  {copied ? <Check className="text-primary-text" /> : <Copy />}
                </Button>
              </Tip>
              <Tip label="Add voice to a new film note">
                <Button
                  variant="card-action"
                  size="icon-sm"
                  className="size-6 pointer-coarse:size-9 [&_svg]:size-3.5"
                  aria-label={`Use ${voice.name} in note`}
                  onClick={(e) => openVoiceNote(voice.name, voice.id, originOf(e.currentTarget))}
                >
                  <MessageSquarePlus />
                </Button>
              </Tip>
              <Tip label={isExpanded ? "Hide details" : "Show description & stats"}>
                <Button
                  variant="card-action"
                  size="icon-sm"
                  className="size-6 pointer-coarse:size-9 [&_svg]:size-3.5"
                  aria-label={
                    isExpanded ? `Hide ${voice.name} details` : `Show ${voice.name} details`
                  }
                  aria-expanded={isExpanded}
                  onClick={() => onToggleExpand(voice.id)}
                >
                  {isExpanded ? <ChevronUp /> : <ChevronDown />}
                </Button>
              </Tip>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="border-border/50 text-muted-foreground text-tag mt-0.5 flex flex-col gap-1 border-t ps-11 pt-1.5">
          {voice.description && (
            <p className="text-foreground/90 leading-snug select-text">{voice.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 tabular-nums">
            <span className="text-tag font-mono select-all">{voice.id}</span>
            <span>{voiceTitle(voice.category)}</span>
            {voice.clones > 0 && <span>{formatCompactCount(voice.clones)} clones</span>}
            <span>{formatCompactCount(voice.usage1y)} chars/yr</span>
            {voice.likes > 0 && <span>{formatCompactCount(voice.likes)} likes</span>}
            <span>{voice.free ? "Free tier OK" : "Paid tier"}</span>
          </div>
        </div>
      )}

      {isPlaying && (
        <AuditionScrubber id={auditionId} label={voice.name} fallbackSeconds={0} kind="sfx" />
      )}
    </div>
  );
});

const getVoiceKey = (v: SharedVoiceEntry) => v.id;

export function VoiceLibraryPane({
  library,
  voices,
  leaf,
  query,
  filters,
  onChangeFilters,
  onClearQuery,
  filmVoiceIds,
  side = true,
}: {
  library: VoiceLibraryClientState;
  voices: readonly SharedVoiceEntry[];
  leaf: string;
  query: string;
  filters: VoiceFilters;
  onChangeFilters: (next: VoiceFilters) => void;
  onClearQuery: () => void;
  filmVoiceIds: ReadonlySet<string>;
  side?: boolean;
}) {
  // Subscribe to playing voice ID string rather than 80ms auditionRev ticks so virtualized rows never re-render during playback
  const now = useSyncExternalStore(subscribeAudition, listening);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [prevLeaf, setPrevLeaf] = useState(leaf);
  if (prevLeaf !== leaf) {
    setPrevLeaf(leaf);
    if (expandedId !== null) setExpandedId(null);
  }
  const toggleExpand = useCallback(
    (id: string) => setExpandedId((cur) => (cur === id ? null : id)),
    [],
  );

  const stickyKeys = useMemo(() => {
    const keys: string[] = [];
    if (now.startsWith("gv:")) keys.push(now.slice(3));
    if (expandedId) keys.push(expandedId);
    return keys;
  }, [now, expandedId]);

  const statusBar = (
    <div className="text-tag flex items-center justify-between gap-2 pb-1.5">
      <span
        className="text-muted-foreground min-w-0 truncate"
        title={
          library.truncated
            ? "Sync reached its page cap before scanning the full remote catalog."
            : undefined
        }
      >
        {library.status === "syncing"
          ? `Syncing English voices… page ${library.pagesLoaded} (${library.totalEnglishV4.toLocaleString()} v4 / ${library.totalEnglish.toLocaleString()} EN)`
          : library.syncedAt
            ? `${library.totalEnglishV4.toLocaleString()} v4 · ${library.totalEnglish.toLocaleString()} English${library.truncated ? " (capped)" : ""}`
            : !library.loaded && library.error
              ? "Could not load voice library"
              : library.hasKey
                ? "Ready to sync English voices"
                : "Set GENVOICE_API_KEY or ELEVENLABS_API_KEY to sync"}
      </span>
      <Tip label="Sync English voice catalog">
        <Button
          variant="quiet"
          size="xs"
          disabled={library.status === "syncing"}
          onClick={() => void syncVoiceLibraryNow()}
          aria-label="Sync voices"
        >
          <RefreshCw
            aria-hidden
            className={cn("size-3", library.status === "syncing" && "animate-spin")}
          />
          <span>{library.status === "syncing" ? "Syncing" : "Sync"}</span>
        </Button>
      </Tip>
    </div>
  );

  if (!voices.length) {
    const busy =
      library.loading || library.status === "syncing" || (!library.loaded && !library.error);
    const loadFailed = !library.loaded && Boolean(library.error);
    return (
      <div className={cn("flex flex-col gap-2", side && "min-h-0 flex-1 px-3 pb-3")}>
        {statusBar}
        {library.error && (
          <p
            role="alert"
            className="text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5 text-xs"
          >
            {library.error}
          </p>
        )}
        <EmptyCard
          title={
            busy
              ? "Loading English voices"
              : loadFailed
                ? "Could not load voice library"
                : !library.voices.length
                  ? library.syncedAt
                    ? "No English voices in catalog"
                    : "Voice library not synced yet"
                  : leaf === "fav" && !query.trim()
                    ? "No favorite voices yet"
                    : "No matching voices"
          }
        >
          {busy ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {library.status === "syncing"
                ? `Downloading English voice library (page ${library.pagesLoaded}, found ${library.totalEnglishV4.toLocaleString()} ElevenLabs v4 voices so far)…`
                : "Loading cached ElevenLabs v4 English voice library…"}
            </p>
          ) : loadFailed ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Failed to fetch the voice library from the studio server.
              </p>
              <Button variant="secondary" size="sm" onClick={() => void loadVoiceLibrary(true)}>
                Retry
              </Button>
            </div>
          ) : !library.voices.length ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-muted-foreground text-xs leading-relaxed">
                {library.syncedAt
                  ? "Sync completed with 0 English voices in this catalog."
                  : library.hasKey
                    ? "No local English voice cache yet. Click Sync below to download the remote voice library."
                    : "Set GENVOICE_API_KEY or ELEVENLABS_API_KEY in your environment (or run bun run setup:voices) to sync all English ElevenLabs v4 voices."}
              </p>
              {library.hasKey && (
                <Button variant="secondary" size="sm" onClick={() => void syncVoiceLibraryNow()}>
                  Sync English voices now
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-muted-foreground text-xs leading-relaxed">
                {query.trim()
                  ? `No voices match "${query.trim()}".`
                  : leaf === "fav"
                    ? "No favorite voices yet. Click the star on any voice to save it here."
                    : "No voices match the selected filters."}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {query.trim() && (
                  <Button variant="secondary" size="sm" onClick={onClearQuery}>
                    Clear search
                  </Button>
                )}
                {hasActiveVoiceFilters(filters) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onChangeFilters(DEFAULT_VOICE_FILTERS)}
                  >
                    Reset filters
                  </Button>
                )}
                {filters.v4Mode !== "all" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onChangeFilters({ ...filters, v4Mode: "all" })}
                  >
                    Include non-v4 English voices
                  </Button>
                )}
              </div>
            </div>
          )}
        </EmptyCard>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col",
        side ? "min-h-0 flex-1 px-3 pb-3" : "h-[min(70vh,28rem)] min-h-64",
      )}
    >
      {statusBar}
      {library.error && (
        <p
          role="alert"
          className="text-destructive bg-destructive/10 mb-1.5 rounded-md px-2.5 py-1 text-xs"
        >
          {library.error}
        </p>
      )}
      <VirtualList
        items={voices}
        getKey={getVoiceKey}
        estimateSize={58}
        gap={6}
        overscan={8}
        role="list"
        ariaLabel="Shared English voice library"
        stickyKeys={stickyKeys}
        data-arrow-scroll
        renderItem={(voice) => (
          <VoiceCard
            voice={voice}
            isPlaying={now === `gv:${voice.id}`}
            isExpanded={expandedId === voice.id}
            inFilm={filmVoiceIds.has(voice.id)}
            onToggleExpand={toggleExpand}
          />
        )}
      />
    </div>
  );
}

export default VoiceLibraryPane;
