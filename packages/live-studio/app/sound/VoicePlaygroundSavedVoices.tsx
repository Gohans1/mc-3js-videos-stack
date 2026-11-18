import { Bookmark, Star } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { listening, listenUrl, subscribeAudition } from "./sound";
import type { VoiceFilters } from "./voice-library-view";
import {
  openCastingVoice,
  selectPlaygroundUid,
  setPlaygroundSubTab,
  setPlaygroundWorkbenchOpen,
  toggleUnifiedFavorite,
  useVoicePlaygroundSelector,
} from "./voice-playground-client";
import { filterSavedCastingVoices, type UnifiedPlaygroundEntry } from "./voice-playground-view";
import { VoiceOptionRow } from "./VoicePlaygroundVoicePicker";
import { VoicePlaybackIcon } from "./VoicePlaybackIcon";

export function VoicePlaygroundSavedVoices({
  query,
  filters,
  displayedCatalogIds,
  entries = [],
}: {
  query: string;
  filters: VoiceFilters;
  displayedCatalogIds: ReadonlySet<string>;
  entries?: readonly UnifiedPlaygroundEntry[];
}) {
  const favorites = useVoicePlaygroundSelector((state) => state.favoriteVoices);
  const playing = useSyncExternalStore(subscribeAudition, listening, listening);
  const visible = filterSavedCastingVoices(favorites, query, filters, displayedCatalogIds);
  if (!visible.length && !entries.length) return null;
  return (
    <section
      aria-label="Saved favorites"
      className="bg-surface-subtle border-hairline mx-3 mt-2 flex max-h-72 flex-none flex-col gap-1 overflow-y-auto overscroll-contain rounded-lg border p-2"
    >
      {entries.length > 0 && (
        <>
          <h3 className="text-foreground px-1.5 text-sm font-semibold">Saved takes & templates</h3>
          <p className="text-muted-foreground px-1.5 text-xs">
            This project and Global. Open a take to compare, edit or use it in the film.
          </p>
          {entries.map((entry) => (
            <div
              key={entry.uid}
              className="border-hairline bg-card flex items-start gap-2 rounded-md border p-2"
            >
              {entry.audioUrl ? (
                <Button
                  type="button"
                  size="icon"
                  variant="cover"
                  aria-label={`${playing === entry.auditionId ? "Pause" : "Play"} ${entry.title}`}
                  onClick={() => listenUrl(entry.auditionId, entry.audioUrl)}
                >
                  <VoicePlaybackIcon playing={playing === entry.auditionId} className="size-3.5" />
                </Button>
              ) : (
                <Bookmark aria-hidden className="text-ai-text mt-1 size-4 flex-none" />
              )}
              <button
                type="button"
                className="focus-visible:ring-ring min-w-0 flex-1 rounded text-start outline-none focus-visible:ring-2"
                aria-label={`Open ${entry.title}`}
                onClick={() => {
                  selectPlaygroundUid(entry.uid);
                  setPlaygroundSubTab("inspect");
                  setPlaygroundWorkbenchOpen(true);
                }}
              >
                <span className="text-foreground block text-sm font-semibold break-words">
                  {entry.title}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {entry.template ? "Template" : "Recording"} ·{" "}
                  {(entry.template?.scope ?? entry.playgroundItem?.scope) === "global"
                    ? "Global"
                    : "Project"}{" "}
                  · {entry.voiceName}
                </span>
              </button>
              <Button
                type="button"
                size="icon-xs"
                variant="favorite"
                aria-label={`Favorite ${entry.title}`}
                aria-pressed={entry.favorite}
                onClick={() => void toggleUnifiedFavorite(entry)}
              >
                <Star className={cn("size-3.5", entry.favorite && "fill-current")} />
              </Button>
            </div>
          ))}
        </>
      )}
      {visible.length > 0 && (
        <h3 className="text-foreground px-1.5 pt-1 text-sm font-semibold">Saved casting voices</h3>
      )}
      {visible.map((voice) => (
        <VoiceOptionRow
          key={`${voice.provider ?? "elevenlabs"}:${voice.id}`}
          voice={voice}
          selected={false}
          nowPlayingId={playing}
          onSelect={openCastingVoice}
        />
      ))}
    </section>
  );
}
