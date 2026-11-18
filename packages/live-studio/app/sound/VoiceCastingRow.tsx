import { Bookmark, Check, ListPlus, Mars, Star, User, Venus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PlaygroundVoiceOption } from "../../src/voice-playground.mjs";
import { Tip } from "../components/Tip";
import { useStudio } from "../core/store";
import { useVoiceTakes } from "./voice-client";
import { VOICE_STAR_PREFIX, voiceDisplayName } from "./voice-library-view";
import {
  previewCastingVoice,
  startVoiceTemplate,
  togglePlaygroundVoiceFavorite,
  toggleSpeechComparisonVoice,
  useVoicePlaygroundSelector,
} from "./voice-playground-client";
import { activeFilmVoices, castingAuditionId } from "./voice-playground-view";
import { VoicePlaybackIcon } from "./VoicePlaybackIcon";

export type PickedVoice = Pick<
  PlaygroundVoiceOption,
  | "id"
  | "name"
  | "provider"
  | "language"
  | "dubbingVoiceId"
  | "connection"
  | "previewUrl"
  | "gender"
>;

export function VoiceOptionRow({
  voice,
  selected,
  inDraft = false,
  nowPlayingId,
  onSelect,
  comfortable = false,
}: {
  voice: PlaygroundVoiceOption;
  selected: boolean;
  inDraft?: boolean;
  nowPlayingId: string;
  onSelect: (voice: PlaygroundVoiceOption) => void;
  comfortable?: boolean;
}) {
  const [savingFavorite, setSavingFavorite] = useState(false);
  const savedVoices = useVoicePlaygroundSelector((state) => state.favoriteVoices, false);
  const takes = useVoiceTakes();
  const usage = useVoicePlaygroundSelector((state) => state.usage, false) ?? [];
  const inUse = activeFilmVoices(takes, usage).some(
    (used) =>
      used.voiceId === voice.id &&
      (used.connection ?? "genvoice") === (voice.connection ?? "genvoice") &&
      (used.provider === "google" || used.provider === (voice.provider ?? "elevenlabs")),
  );
  const legacyStars = useStudio((state) => state.favorites.effects);
  const provider = voice.provider ?? "elevenlabs";
  const connection = voice.connection ?? "genvoice";
  const legacyFavorite =
    connection === "genvoice" &&
    provider === "elevenlabs" &&
    legacyStars.includes(`${VOICE_STAR_PREFIX}${voice.id}`);
  const favorite =
    legacyFavorite ||
    (savedVoices ?? []).some(
      (v) =>
        v.id === voice.id &&
        (v.connection ?? "genvoice") === connection &&
        (v.provider ?? "elevenlabs") === provider,
    );
  const auditionId = castingAuditionId(voice);
  const inBatch = useVoicePlaygroundSelector(
    (state) =>
      (state.compareVoices ?? []).some((candidate) => castingAuditionId(candidate) === auditionId),
    false,
  );
  const isPlaying = nowPlayingId === auditionId;
  const display = voiceDisplayName(voice.name || voice.id);
  const gender = voice.gender?.toLowerCase();
  const metaParts = [
    connection === "google"
      ? "Google Gemini"
      : connection === "elevenlabs"
        ? "ElevenLabs direct"
        : provider === "elevenlabs"
          ? "ElevenLabs"
          : provider === "minimax"
            ? "MiniMax"
            : "CapCut",
    voice.age,
    voice.gender,
    voice.accent,
    voice.language,
    voice.category,
    voice.useCase,
    voice.emotion,
    voice.ownedClone ? (voice.ownedClone.scope === "global" ? "Global" : "This project") : "",
  ]
    .filter(Boolean)
    .join(" · ")
    .replaceAll("_", " ");

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors",
        comfortable && "min-h-20 gap-3 px-3 py-3",
        selected ? "bg-tint text-primary-text" : "hover:bg-raised-3",
      )}
    >
      {voice.previewUrl ? (
        <Tip label={isPlaying ? "Pause sample" : "Preview voice"}>
          <Button
            type="button"
            variant={isPlaying ? "lit" : "ghost"}
            size="icon-xs"
            aria-label={`${isPlaying ? "Pause" : "Preview"} ${display}`}
            onClick={(e) => {
              e.stopPropagation();
              previewCastingVoice(voice);
            }}
          >
            <VoicePlaybackIcon playing={isPlaying} className="size-3" />
          </Button>
        </Tip>
      ) : (
        <span className="text-muted-foreground flex size-5 flex-none items-center justify-center rounded border border-transparent">
          <User className="size-3 opacity-60" />
        </span>
      )}
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(voice)}
        className="focus-visible:ring-ring focus-visible:bg-tint/40 flex min-w-0 flex-1 flex-col rounded px-1 py-0.5 text-start outline-none focus-visible:ring-2"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {gender === "female" && (
            <Venus className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          )}
          {gender === "male" && (
            <Mars className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          )}
          <bdi className={cn("truncate font-medium", comfortable ? "text-sm" : "text-ui")}>
            {display}
          </bdi>
          {selected && <Check className="text-primary-text size-3 flex-none" aria-hidden />}
          {inDraft && (
            <span className="border-hairline-strong text-foreground shrink-0 rounded border px-1.5 text-xs">
              In draft
            </span>
          )}
          {inUse && (
            <span className="text-ok-text inline-flex shrink-0 items-center gap-1 text-xs">
              <Check className="size-3" />
              In use
            </span>
          )}
        </div>
        <span className="text-muted-foreground text-xs leading-relaxed break-words">
          {metaParts || voice.id}
        </span>
        {comfortable && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {typeof voice.usage1y === "number" &&
              `${voice.usage1y.toLocaleString()} chars in the past year · `}
            {typeof voice.rate === "number" && voice.rate > 0
              ? `Reported rate ${voice.rate}×`
              : "Voice fee unverified"}
          </span>
        )}
      </button>
      {comfortable && connection === "genvoice" && (
        <Tip label={inBatch ? "Remove from comparison" : "Add to comparison"}>
          <Button
            type="button"
            size="icon-sm"
            variant={inBatch ? "lit" : "ghost"}
            aria-label={`${inBatch ? "Remove" : "Add"} ${display} ${inBatch ? "from" : "to"} comparison`}
            aria-pressed={Boolean(inBatch)}
            onClick={() => toggleSpeechComparisonVoice(voice)}
          >
            {inBatch ? <Check /> : <ListPlus />}
          </Button>
        </Tip>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Create template with ${display}`}
        onClick={() => startVoiceTemplate({ ...voice, name: display })}
      >
        <Bookmark />
      </Button>
      <Button
        type="button"
        variant="favorite"
        size="icon-sm"
        aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${display}`}
        aria-pressed={favorite}
        aria-busy={savingFavorite}
        disabled={savingFavorite}
        onClick={async () => {
          setSavingFavorite(true);
          try {
            await togglePlaygroundVoiceFavorite(voice, !favorite);
          } finally {
            setSavingFavorite(false);
          }
        }}
      >
        <Star className={favorite ? "fill-current" : ""} />
      </Button>
    </div>
  );
}
