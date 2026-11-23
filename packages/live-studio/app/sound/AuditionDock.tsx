import {
  Check,
  Copy,
  Crosshair,
  Info,
  MessageSquarePlus,
  Pause,
  Play,
  Plus,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SharedVoiceEntry } from "../../src/voice-library.mjs";
import type { PlaygroundVoiceOption } from "../../src/voice-playground.mjs";
import { Tip } from "../components/Tip";
import { type FavoriteKind, toggleFavorite } from "../core/favorites";
import { S } from "../core/state";
import { say, useStudio } from "../core/store";
import { openVoiceNote } from "../notes/notes";
import { AuditionScrubber } from "./AuditionScrubber";
import { HorizontalScrollRail } from "./HorizontalScrollRail";
import {
  catTitle,
  cleanAudioTitle,
  CONTENT_ID_NOTE,
  formatSoundDuration,
  type LibraryGroup,
  originOf,
  originTitle,
  siblingsOf,
  soundCardText,
  type SoundKind,
  sourceOf,
  sourceTitle,
} from "./library-view";
import {
  addClip,
  auditionTarget,
  kindOf,
  type LibraryItem,
  listen,
  listening,
  listenUrl,
  stopAudition,
  subscribeAudition,
} from "./sound";
import {
  focusVoiceTake,
  listenVoiceFile,
  resolveVoiceTakeTarget,
  voiceAuditionId,
} from "./voice-client";
import {
  voiceDetailLine,
  voiceDisplayName,
  voiceoverDisplayText,
  voiceTitle,
} from "./voice-library-view";
import {
  importRemoteHistoryTask,
  openCastingVoice,
  openFilmTakeRemix,
  patchPlaygroundItem,
  selectPlaygroundUid,
  setPlaygroundSubTab,
  setPlaygroundWorkbenchOpen,
  togglePlaygroundVoiceFavorite,
  useVoicePlaygroundSelector,
} from "./voice-playground-client";
import {
  isSafeAudioUrl,
  parseVoicePreviewTarget,
  playgroundAudioUrl,
} from "./voice-playground-view";
import { parseTakeScript, shortTryLabel, voiceActorTitle, type VoiceTakeItem } from "./voice-view";

interface DockOption {
  key: string;
  label: string;
  ariaLabel: string;
  selected: boolean;
  onSelect: () => void;
}

function DockOptionGroup({
  label,
  leftLabel = "Scroll options left",
  rightLabel = "Scroll options right",
  options,
  mono = false,
}: {
  label: string;
  leftLabel?: string;
  rightLabel?: string;
  options: readonly DockOption[];
  mono?: boolean;
}) {
  const optionsKey = options.map((opt) => `${opt.key}:${opt.label}`).join("\0");

  if (!options.length) return null;
  return (
    <HorizontalScrollRail
      label={label}
      leftLabel={leftLabel}
      rightLabel={rightLabel}
      edgesKey={optionsKey}
      className="gap-1"
    >
      {options.map((opt, idx) => (
        <button
          key={opt.key}
          type="button"
          role="radio"
          tabIndex={opt.selected ? 0 : -1}
          aria-checked={opt.selected}
          aria-label={opt.ariaLabel}
          onClick={opt.onSelect}
          onKeyDown={(e) => {
            const count = options.length;
            let nextIdx: number | null = null;
            if (e.key === "ArrowRight") nextIdx = (idx + 1) % count;
            else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + count) % count;
            else if (e.key === "Home") nextIdx = 0;
            else if (e.key === "End") nextIdx = count - 1;
            if (nextIdx === null) return;
            e.preventDefault();
            options[nextIdx]?.onSelect();
            const radios =
              e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
            radios?.[nextIdx]?.focus();
          }}
          className={cn(
            "focus-visible:ring-ring studio-press text-tag inline-flex h-6 flex-none items-center rounded-md border px-2 tabular-nums transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-9",
            mono && "font-mono",
            opt.selected
              ? "border-primary/45 bg-tint text-primary-text font-medium"
              : "bg-raised-3 text-foreground/80 hover:bg-raised-4 hover:text-foreground border-transparent",
          )}
        >
          {opt.label}
        </button>
      ))}
    </HorizontalScrollRail>
  );
}

function DockFavoriteButton({ kind, id, name }: { kind: FavoriteKind; id: string; name: string }) {
  const on = useStudio((s) => s.favorites[kind].includes(id));
  return (
    <Tip label={on ? "Remove from Favorites" : "Add to Favorites"}>
      <Button
        variant="favorite"
        size="icon-sm"
        aria-label={`Favorite ${name}`}
        aria-pressed={on}
        className="flex-none pointer-coarse:size-9"
        onClick={() => toggleFavorite(kind, id, name)}
      >
        <Star className={cn(on && "fill-current")} />
      </Button>
    </Tip>
  );
}

function DockFrame({
  playLabel,
  playAriaLabel,
  isPlaying,
  onTogglePlay,
  title,
  subtitle,
  actions,
  options,
  scrubber,
  sticky = false,
  onStop,
}: {
  playLabel: string;
  playAriaLabel: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  title: ReactNode;
  subtitle: ReactNode;
  actions: ReactNode;
  options?: ReactNode;
  scrubber: ReactNode;
  sticky?: boolean;
  onStop: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Active audio preview"
      className={cn(
        "border-border bg-card animate-in fade-in-0 slide-in-from-bottom-1 @container flex flex-none flex-col gap-1.5 border-t px-3 py-2 duration-150 ease-out motion-reduce:animate-none",
        sticky && "sticky bottom-0 z-10",
      )}
    >
      <div className="flex items-center gap-2">
        <Tip label={playLabel}>
          <Button
            variant="cover"
            size="icon-lg"
            className="pointer-coarse:size-10"
            aria-pressed={isPlaying}
            aria-label={playAriaLabel}
            onClick={onTogglePlay}
          >
            {isPlaying ? (
              <Pause className="fill-current" />
            ) : (
              <Play className="translate-x-[0.5px] fill-current" />
            )}
          </Button>
        </Tip>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-ui text-foreground truncate leading-tight font-medium">
            {title}
          </span>
          <span className="text-tag text-foreground/75 truncate leading-none tabular-nums">
            {subtitle}
          </span>
        </div>
        <Tip label="Stop preview">
          <Button
            variant="tool"
            size="icon-sm"
            className="pointer-coarse:size-9"
            aria-label="Stop preview"
            onClick={onStop}
          >
            <X />
          </Button>
        </Tip>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      {options}
      {scrubber}
    </div>
  );
}

const playgroundVoiceAsShared = (v: PlaygroundVoiceOption): SharedVoiceEntry => ({
  id: v.id,
  name: v.name,
  category: v.category || "shared",
  useCase: v.useCase ?? "",
  gender: v.gender ?? "",
  age: v.age ?? "",
  accent: v.accent ?? "",
  descriptive: v.descriptive ?? "",
  description: v.description ?? "",
  previewUrl: v.previewUrl ?? "",
  v4: true,
  v4Post: false,
  v4Turbo: false,
  v4Fast: false,
  rate: v.rate ?? 1,
  free: v.free ?? false,
  usage1y: 0,
  usage7d: 0,
  clones: 0,
  likes: 0,
  featured: false,
  addedAt: 0,
});

function NativeVoiceFavorite({ voice }: { voice: PlaygroundVoiceOption }) {
  const favorite = useVoicePlaygroundSelector(
    (state) =>
      state.favoriteVoices.some(
        (saved) =>
          saved.id === voice.id &&
          (saved.provider ?? "elevenlabs") === (voice.provider ?? "elevenlabs") &&
          (saved.connection ?? "genvoice") === (voice.connection ?? "genvoice"),
      ),
    false,
  );
  const [saving, setSaving] = useState(false);
  return (
    <Button
      variant="favorite"
      size="icon-sm"
      aria-label={`Favorite ${voice.name}`}
      aria-pressed={favorite}
      aria-busy={saving}
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        try {
          await togglePlaygroundVoiceFavorite(voice, !favorite);
        } finally {
          setSaving(false);
        }
      }}
    >
      <Star className={favorite ? "fill-current" : ""} />
    </Button>
  );
}

export function AuditionDock({
  libraryItems,
  voices,
  voiceTakes,
  expandedGroup,
  variantCursor,
  copiedId,
  sticky = false,
  onSelectVariant,
  onAdvanceVariant,
  onCopyVoiceId,
  onClearExpanded,
}: {
  libraryItems: readonly LibraryItem[];
  voices: readonly SharedVoiceEntry[];
  voiceTakes: readonly VoiceTakeItem[];
  expandedGroup: LibraryGroup | null;
  variantCursor: Readonly<Record<string, number>>;
  copiedId: string | null;
  sticky?: boolean;
  onSelectVariant: (groupKey: string, index: number) => void;
  onAdvanceVariant: (groupKey: string, nextIndex: number) => void;
  onCopyVoiceId: (voice: SharedVoiceEntry) => void;
  onClearExpanded: () => void;
}) {
  const now = useSyncExternalStore(subscribeAudition, listening, listening);
  const targetNow = useSyncExternalStore(subscribeAudition, auditionTarget, auditionTarget);
  const activeTarget = targetNow || now;
  const isPlaygroundTarget = activeTarget.startsWith("pg:");
  const pgId = isPlaygroundTarget ? activeTarget.slice(3) : "";
  const pgItem = useVoicePlaygroundSelector(
    (s) => (pgId ? (s.items.find((x) => x.id === pgId) ?? null) : null),
    isPlaygroundTarget,
  );
  const isRemotePgTarget = activeTarget.startsWith("pg-remote:");
  const pgRemoteId = isRemotePgTarget ? activeTarget.slice(10) : "";
  const pgRemoteEntry = useVoicePlaygroundSelector(
    (s) => (pgRemoteId ? (s.remoteHistory.items.find((x) => x.id === pgRemoteId) ?? null) : null),
    isRemotePgTarget,
  );
  const pgRemoteBusy = useVoicePlaygroundSelector(
    (s) => (isRemotePgTarget ? s.busyAction === `import:${pgRemoteId}` : false),
    isRemotePgTarget,
  );
  const gvTarget = parseVoicePreviewTarget(activeTarget);
  const gvId = gvTarget?.id ?? "",
    gvProvider = gvTarget?.provider ?? "elevenlabs";
  const gvConnection = gvTarget?.connection ?? "genvoice";
  const gvCatalogMissing = Boolean(
    gvId &&
    (gvConnection !== "genvoice" ||
      gvProvider !== "elevenlabs" ||
      !voices.some((v) => v.id === gvId)),
  );
  const pgPreviewVoice = useVoicePlaygroundSelector(
    (s) =>
      gvId
        ? ([
            s.previewVoice,
            ...s.favoriteVoices,
            ...s.catalog.defaultVoices,
            ...s.sharedSearch.voices,
          ].find(
            (v) =>
              v?.id === gvId &&
              (v.connection ?? "genvoice") === gvConnection &&
              (v.provider ?? "elevenlabs") === gvProvider,
          ) ?? null)
        : null,
    gvCatalogMissing,
  );
  const [soundInfoOpen, setSoundInfoOpen] = useState(false);
  const soundInfoRef = useRef<HTMLDivElement>(null);
  const [copiedAssetId, setCopiedAssetId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const stopAll = () => {
    setSoundInfoOpen(false);
    stopAudition();
    onClearExpanded();
  };

  const handleCopyAssetId = (assetId: string) => {
    const write = navigator.clipboard?.writeText(assetId);
    if (!write) {
      say(`Sound ID: ${assetId}`);
      return;
    }
    void write.then(
      () => {
        setCopiedAssetId(assetId);
        say(`Copied sound ID ${assetId}`);
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          setCopiedAssetId((cur) => (cur === assetId ? null : cur));
          copyTimerRef.current = null;
        }, 1400);
      },
      () => {
        say(`Sound ID: ${assetId}`);
      },
    );
  };

  if (activeTarget.startsWith("gv:")) {
    const catalogVoice =
      gvConnection === "genvoice" && gvProvider === "elevenlabs"
        ? voices.find((v) => v.id === gvId)
        : undefined;
    const voice = catalogVoice ?? (pgPreviewVoice ? playgroundVoiceAsShared(pgPreviewVoice) : null);
    if (!voice) return null;
    const isPlaying = now === activeTarget;
    const displayName = voiceDisplayName(voice.name);
    const service =
      gvConnection === "google"
        ? "Google Gemini"
        : gvConnection === "elevenlabs"
          ? "ElevenLabs direct"
          : gvProvider === "minimax"
            ? "MiniMax"
            : gvProvider === "capcut"
              ? "CapCut"
              : "ElevenLabs";
    const isCopied = copiedId === voice.id;
    return (
      <DockFrame
        sticky={sticky}
        playLabel={isPlaying ? "Pause preview" : "Resume preview"}
        playAriaLabel={`${isPlaying ? "Pause" : "Resume"} ${displayName}`}
        isPlaying={isPlaying}
        onTogglePlay={() => {
          if (voice.previewUrl) listenUrl(activeTarget, voice.previewUrl);
        }}
        title={displayName}
        subtitle={[
          service,
          voiceDetailLine(voice) || pgPreviewVoice?.language || voiceTitle(voice.category),
        ].join(" · ")}
        actions={
          <>
            {gvProvider === "elevenlabs" && gvConnection === "genvoice" ? (
              <DockFavoriteButton kind="effects" id={`voice:${voice.id}`} name={displayName} />
            ) : pgPreviewVoice ? (
              <NativeVoiceFavorite voice={pgPreviewVoice} />
            ) : null}
            <Tip label={isCopied ? "Copied ID" : "Copy voice ID"}>
              <Button
                variant="secondary"
                size="sm"
                className="flex-none pointer-coarse:min-h-9"
                aria-label={`Copy voice ID for ${displayName}`}
                onClick={() => onCopyVoiceId(voice)}
              >
                {isCopied ? (
                  <Check className="text-primary-text size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                <span className="@max-[360px]:sr-only">{isCopied ? "Copied" : "Copy ID"}</span>
              </Button>
            </Tip>
            <Tip label="Open voice in Voice Playground">
              <Button
                variant="secondary"
                size="sm"
                className="flex-none pointer-coarse:min-h-9"
                aria-label={`Open ${displayName} in Playground`}
                onClick={() =>
                  openCastingVoice(
                    pgPreviewVoice ?? {
                      id: voice.id,
                      name: displayName,
                      provider: "elevenlabs",
                      category: voice.category,
                    },
                  )
                }
              >
                <Sparkles className="size-3" />
                <span className="@max-[360px]:sr-only">Playground</span>
              </Button>
            </Tip>
            <Tip label="Add voice to a new film note">
              <Button
                variant="secondary"
                size="sm"
                className="flex-none pointer-coarse:min-h-9"
                aria-label={`Use ${displayName} in note`}
                onClick={() =>
                  openVoiceNote(
                    gvProvider === "elevenlabs" && gvConnection === "genvoice"
                      ? displayName
                      : `${service} / ${displayName}`,
                    voice.id,
                  )
                }
              >
                <MessageSquarePlus className="size-3" />
                <span className="@max-[360px]:sr-only">Use in note</span>
              </Button>
            </Tip>
          </>
        }
        scrubber={
          <AuditionScrubber
            id={activeTarget}
            label={displayName}
            fallbackSeconds={0}
            kind="sfx"
            flush
          />
        }
        onStop={stopAll}
      />
    );
  }

  if (isPlaygroundTarget) {
    const item = pgItem;
    if (!item) return null;
    const isPlaying = now === activeTarget;
    return (
      <DockFrame
        sticky={sticky}
        playLabel={isPlaying ? "Pause clip" : "Resume clip"}
        playAriaLabel={`${isPlaying ? "Pause" : "Resume"} ${item.title}`}
        isPlaying={isPlaying}
        onTogglePlay={() => {
          if (item.audioFile)
            listenUrl(activeTarget, playgroundAudioUrl(item.audioFile, item.scope));
        }}
        title={item.title}
        subtitle={`${item.voiceName} · ${item.modelId} · ${formatSoundDuration(item.durationSeconds, "sfx")}`}
        actions={
          <>
            <Tip label={item.favorite ? "Unstar clip" : "Star clip"}>
              <Button
                variant="favorite"
                size="icon-lg"
                className="pointer-coarse:size-10"
                aria-pressed={item.favorite}
                aria-label={`Favorite ${item.title}`}
                onClick={() => void patchPlaygroundItem(item.id, { favorite: !item.favorite })}
              >
                <Star className={cn(item.favorite && "fill-current")} />
              </Button>
            </Tip>
            <Tip label="Inspect full settings & duplicate in Workbench">
              <Button
                variant="secondary"
                size="sm"
                className="flex-none pointer-coarse:min-h-9"
                onClick={() => {
                  selectPlaygroundUid(activeTarget);
                  setPlaygroundSubTab("inspect");
                  setPlaygroundWorkbenchOpen(true);
                }}
              >
                <Sparkles className="size-3" />
                <span className="@max-[360px]:sr-only">Workbench</span>
              </Button>
            </Tip>
          </>
        }
        scrubber={
          <AuditionScrubber
            id={activeTarget}
            label={item.title}
            fallbackSeconds={item.durationSeconds}
            kind="sfx"
            flush
          />
        }
        onStop={stopAll}
      />
    );
  }

  if (isRemotePgTarget) {
    const r = pgRemoteEntry;
    if (!r) return null;
    const isPlaying = now === activeTarget;
    const safePreviewUrl = isSafeAudioUrl(r.audioUrl) ? r.audioUrl : "";
    const label = r.title || r.text || `Cloud clip ${r.id}`;
    const canArchive =
      !pgRemoteBusy && !r.importedItemId && r.status === "completed" && Boolean(safePreviewUrl);
    return (
      <DockFrame
        sticky={sticky}
        playLabel={isPlaying ? "Pause clip" : "Resume clip"}
        playAriaLabel={`${isPlaying ? "Pause" : "Resume"} ${label}`}
        isPlaying={isPlaying}
        onTogglePlay={() => {
          if (safePreviewUrl) listenUrl(activeTarget, safePreviewUrl);
        }}
        title={label}
        subtitle={`${r.voiceName || r.voiceId || "Voice"} · ${r.modelId || r.kind} · Cloud 24h`}
        actions={
          <>
            <Button
              variant={r.importedItemId ? "lit" : "secondary"}
              size="sm"
              className="flex-none pointer-coarse:min-h-9"
              disabled={!canArchive}
              onClick={() => void importRemoteHistoryTask(r.id, r.kind)}
            >
              {pgRemoteBusy
                ? "Saving…"
                : r.importedItemId
                  ? "Saved ✓"
                  : r.status !== "completed"
                    ? r.status
                    : "Archive"}
            </Button>
            <Tip label={r.importedItemId ? "Inspect archived clip" : "Open Cloud 24h history"}>
              <Button
                variant="secondary"
                size="sm"
                className="flex-none pointer-coarse:min-h-9"
                onClick={() => {
                  if (r.importedItemId) {
                    selectPlaygroundUid(`pg:${r.importedItemId}`);
                    setPlaygroundSubTab("inspect");
                  } else {
                    setPlaygroundSubTab("remote");
                  }
                  setPlaygroundWorkbenchOpen(true);
                }}
              >
                <Sparkles className="size-3" />
                <span className="@max-[360px]:sr-only">Workbench</span>
              </Button>
            </Tip>
          </>
        }
        scrubber={
          <AuditionScrubber id={activeTarget} label={label} fallbackSeconds={0} kind="sfx" flush />
        }
        onStop={stopAll}
      />
    );
  }

  if (activeTarget.startsWith("voice:")) {
    let takeEntry: {
      take: VoiceTakeItem;
      scrubId: string;
      activeTryFile: string | null;
      isPlaying: boolean;
    } | null = null;
    for (const t of voiceTakes) {
      const takeAudioId = t.file ? voiceAuditionId("takes", t.file) : "";
      if (takeAudioId && activeTarget === takeAudioId) {
        takeEntry = {
          take: t,
          scrubId: takeAudioId,
          activeTryFile: null,
          isPlaying: now === takeAudioId,
        };
        break;
      }
      const tryFile = t.tries.find((f) => activeTarget === voiceAuditionId("try", f)) ?? null;
      if (tryFile) {
        const tryAudioId = voiceAuditionId("try", tryFile);
        takeEntry = {
          take: t,
          scrubId: tryAudioId,
          activeTryFile: tryFile,
          isPlaying: now === tryAudioId,
        };
        break;
      }
    }
    if (!takeEntry) return null;

    const { take, scrubId, activeTryFile, isPlaying } = takeEntry;
    const spoken = voiceoverDisplayText(parseTakeScript(take.text).spoken || take.text);
    const options: DockOption[] =
      take.tries.length > 0
        ? [
            ...(take.file
              ? [
                  {
                    key: take.file,
                    label: "Main",
                    ariaLabel: `Main take for ${take.id}`,
                    selected: !activeTryFile,
                    onSelect: () => {
                      if (take.file) listenVoiceFile("takes", take.file);
                    },
                  },
                ]
              : []),
            ...take.tries.map((tryFile, i) => {
              const label = shortTryLabel(take.id, tryFile, take.alternatives);
              return {
                key: tryFile,
                label,
                ariaLabel: `Alternative ${i + 1}: ${label}`,
                selected: activeTryFile === tryFile,
                onSelect: () => listenVoiceFile("try", tryFile),
              };
            }),
          ]
        : [];

    return (
      <DockFrame
        sticky={sticky}
        playLabel={isPlaying ? "Pause take" : "Resume take"}
        playAriaLabel={`${isPlaying ? "Pause" : "Resume"} take ${take.id}`}
        isPlaying={isPlaying}
        onTogglePlay={() => {
          if (activeTryFile) listenVoiceFile("try", activeTryFile);
          else if (take.file) listenVoiceFile("takes", take.file);
        }}
        title={
          <>
            <span className="text-tag text-primary-text me-1.5 font-mono tabular-nums">
              {take.id}
            </span>
            {spoken}
          </>
        }
        subtitle={
          <>
            {voiceActorTitle(take.voice)}
            {activeTryFile
              ? ` · Alt: ${shortTryLabel(take.id, activeTryFile, take.alternatives)}`
              : ` · ${take.file ? formatSoundDuration(take.seconds, "sfx") : "Unrendered"}`}
          </>
        }
        actions={
          <>
            {resolveVoiceTakeTarget(take) !== null && (
              <Tip label="Select phrase on timeline">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-none pointer-coarse:min-h-9"
                  aria-label={`Jump to take ${take.id} on timeline`}
                  onClick={() => focusVoiceTake(take)}
                >
                  <Crosshair className="size-3" />
                  <span className="@max-[360px]:sr-only">Jump</span>
                </Button>
              </Tip>
            )}
            <Tip label="Remix take in GenVoice Playground">
              <Button
                variant="secondary"
                size="sm"
                className="flex-none pointer-coarse:min-h-9"
                aria-label={`Remix take ${take.id} in Playground`}
                onClick={() => void openFilmTakeRemix(take)}
              >
                <Sparkles className="size-3" />
                <span className="@max-[360px]:sr-only">Remix</span>
              </Button>
            </Tip>
          </>
        }
        options={
          options.length > 0 && (
            <DockOptionGroup
              label={`Take ${take.id} alternatives`}
              leftLabel="Scroll takes left"
              rightLabel="Scroll takes right"
              options={options}
            />
          )
        }
        scrubber={
          <AuditionScrubber
            id={scrubId}
            label={
              activeTryFile
                ? `Take ${take.id} · ${shortTryLabel(take.id, activeTryFile, take.alternatives)}`
                : `Take ${take.id}`
            }
            fallbackSeconds={activeTryFile ? 0 : take.seconds}
            kind="sfx"
            flush
          />
        }
        onStop={stopAll}
      />
    );
  }

  let group: LibraryGroup | null = null;
  if (activeTarget) {
    if (expandedGroup?.variants.some((v) => v.name === activeTarget)) {
      group = expandedGroup;
    } else {
      const hit = libraryItems.find((x) => x.name === activeTarget);
      if (hit) {
        const variants = siblingsOf(libraryItems, hit);
        const list = variants.length ? variants : [hit];
        group = { key: hit.family || hit.name, primary: list[0], variants: list };
      }
    }
  } else {
    group = expandedGroup;
  }
  if (!group) return null;

  const targetIdx = activeTarget ? group.variants.findIndex((v) => v.name === activeTarget) : -1;
  const playingIdx = now ? group.variants.findIndex((v) => v.name === now) : -1;
  const curIdx =
    targetIdx >= 0 ? targetIdx : (variantCursor[group.key] ?? 0) % group.variants.length;
  const activeItem = group.variants[curIdx];
  const activeKind: SoundKind = kindOf(activeItem);
  const isPlaying = playingIdx >= 0;
  const isPausedTarget = !isPlaying && activeTarget === activeItem.name;
  const {
    title: rawTitle,
    subtitle,
    duration,
  } = soundCardText(activeItem, activeKind, {
    showCategory: true,
    showSource: true,
    showVariant: group.variants.length === 1,
  });
  const dockedTitle = cleanAudioTitle(rawTitle, { mc: activeItem.kind === "mc" });
  const starId = activeItem.name;
  const variantNum = activeItem.variant ?? curIdx + 1;
  const options: DockOption[] =
    group.variants.length > 1
      ? group.variants.map((v, idx) => ({
          key: v.name,
          label: `#${v.variant ?? idx + 1}`,
          ariaLabel: `Variation ${v.variant ?? idx + 1}`,
          selected: v.name === activeItem.name,
          onSelect: () => {
            onSelectVariant(group.key, idx);
            if (activeTarget !== v.name || !isPlaying) listen(v.name);
          },
        }))
      : [];

  const soundSrc = sourceTitle(sourceOf(activeItem));
  const soundOrigin = originTitle(originOf(activeItem));
  const soundCategory = activeItem.category ? catTitle(activeItem.category) : null;
  const popoverBaseTitle = activeItem.title?.trim()
    ? cleanAudioTitle(activeItem.title.trim(), { mc: activeItem.kind === "mc" })
    : dockedTitle;
  const variantTag = `#${variantNum}`;
  const hasDistinctTitles = new Set(group.variants.map((v) => v.title?.trim() ?? "")).size > 1;
  const hasVariantSuffix =
    popoverBaseTitle.endsWith(variantTag) ||
    (hasDistinctTitles && new RegExp(`(?:^|\\s|·)\\s*0*${variantNum}$`).test(popoverBaseTitle));
  const popoverTitle =
    group.variants.length > 1 && !hasVariantSuffix
      ? `${popoverBaseTitle} ${variantTag}`
      : popoverBaseTitle;
  const soundDetailButton = (
    <PopoverTrigger
      render={
        <button
          type="button"
          aria-label={`Details for ${popoverTitle}`}
          className={cn(
            "focus-visible:ring-ring studio-press inline-flex size-6 flex-none items-center justify-center rounded-md border transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:size-9 [&_svg]:pointer-events-none [&_svg]:size-3.5",
            soundInfoOpen
              ? "border-primary/50 bg-tint text-primary-text"
              : "text-foreground/70 hover:bg-raised-3 hover:text-foreground border-transparent bg-transparent",
          )}
        />
      }
    >
      <Info />
    </PopoverTrigger>
  );

  return (
    <DockFrame
      sticky={sticky}
      playLabel={isPlaying ? "Pause preview" : isPausedTarget ? "Resume preview" : "Preview audio"}
      playAriaLabel={`${isPlaying ? "Pause" : isPausedTarget ? "Resume" : "Preview"} ${dockedTitle}`}
      isPlaying={isPlaying}
      onTogglePlay={() => listen(activeItem.name)}
      title={dockedTitle}
      subtitle={subtitle ? `${subtitle} · ${duration}` : duration}
      actions={
        <>
          <DockFavoriteButton kind="sounds" id={starId} name={dockedTitle} />
          <Popover open={soundInfoOpen} onOpenChange={setSoundInfoOpen}>
            <Tooltip open={soundInfoOpen ? false : undefined}>
              <TooltipTrigger render={soundDetailButton} />
              <TooltipContent>License & sound details</TooltipContent>
            </Tooltip>
            <PopoverContent
              align="end"
              side="top"
              variant="flush"
              initialFocus={soundInfoRef}
              className="w-[min(18.5rem,calc(100vw-1.5rem))] max-w-(--available-width)"
            >
              <div
                ref={soundInfoRef}
                tabIndex={-1}
                className="bg-backdrop flex flex-col gap-2 rounded-lg p-2.5 shadow-(--shadow-float) outline-none"
              >
                <div className="min-w-0">
                  <p className="text-ui text-foreground leading-snug font-medium">{popoverTitle}</p>
                  <p className="text-tag text-foreground/70 mt-0.5 leading-snug">
                    {[soundCategory, soundOrigin, soundSrc, activeItem.license]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {activeItem.for && (
                  <p className="text-tag text-foreground/85 leading-relaxed">{activeItem.for}</p>
                )}
                {activeItem.contentId && (
                  <div className="flex items-start gap-1.5">
                    <Badge variant="claim" className="flex-none">
                      Content ID
                    </Badge>
                    <p className="text-tag text-foreground/75 leading-snug">{CONTENT_ID_NOTE}</p>
                  </div>
                )}
                <div className="border-border/50 flex items-center justify-between gap-2 border-t pt-2">
                  <button
                    type="button"
                    onClick={() => handleCopyAssetId(activeItem.name)}
                    aria-label={`Copy sound ID ${activeItem.name}`}
                    className="bg-backdrop hover:bg-raised-3 text-tag text-foreground/85 focus-visible:ring-ring studio-press inline-flex h-6 min-w-0 items-center gap-1.5 rounded px-2 font-mono transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-9"
                  >
                    <span className="truncate">{activeItem.name}</span>
                    {copiedAssetId === activeItem.name ? (
                      <Check className="text-primary-text size-3 flex-none" />
                    ) : (
                      <Copy className="text-foreground/70 size-3 flex-none" />
                    )}
                  </button>
                  <span className="text-tag text-foreground/70 flex-none tabular-nums">
                    {duration}
                  </span>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Tip
            label={
              group.variants.length > 1
                ? `Add variation #${variantNum} to track`
                : `Add ${dockedTitle} to track`
            }
          >
            <Button
              variant="secondary"
              size="sm"
              className="flex-none pointer-coarse:min-h-9"
              aria-label={`Add ${dockedTitle} to track`}
              onClick={() => {
                addClip(activeItem.name, S.t);
                if (group.variants.length > 1) {
                  onAdvanceVariant(group.key, (curIdx + 1) % group.variants.length);
                }
              }}
            >
              <Plus className="size-3" />
              <span className="@max-[360px]:sr-only">Add</span>
            </Button>
          </Tip>
        </>
      }
      options={
        options.length > 0 && (
          <DockOptionGroup
            label={`${dockedTitle} variations`}
            leftLabel="Scroll variations left"
            rightLabel="Scroll variations right"
            options={options}
            mono
          />
        )
      }
      scrubber={
        <AuditionScrubber
          id={activeItem.name}
          label={dockedTitle}
          fallbackSeconds={activeItem.seconds}
          kind={activeKind}
          flush
        />
      }
      onStop={stopAll}
    />
  );
}
