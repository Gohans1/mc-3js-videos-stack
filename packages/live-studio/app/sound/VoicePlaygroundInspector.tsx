import {
  Bookmark,
  Captions,
  Check,
  Copy,
  CopyPlus,
  Download,
  Film,
  Pause,
  Play,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { Tip } from "../components/Tip";
import { say } from "../core/store";
import { AuditionScrubber } from "./AuditionScrubber";
import { formatSoundDuration } from "./library-view";
import { listening, listenUrl, subscribeAudition } from "./sound";
import {
  deletePlaygroundItem,
  duplicateEntryToComposer,
  fetchPlaygroundSrt,
  getPlaygroundItemByAuditionId,
  loadMoreSharedVoices,
  patchPlaygroundItem,
  promotePlaygroundToTake,
  retryWithVoiceSwap,
  searchLiveSharedVoices,
  setComposerDraft,
  setPlaygroundSubTab,
  toggleUnifiedFavorite,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import { PLAYGROUND_MODE_PRESENTATION } from "./voice-playground-presentation";
import {
  entryToComposerDraft,
  extractDialogueSpeakerEntries,
  type UnifiedPlaygroundEntry,
} from "./voice-playground-view";
import { parsePromptSegments } from "./voice-tags";
import { type VoiceTakeItem } from "./voice-view";
import { SttTranscriptDetails } from "./VoicePlaygroundSecondaryModes";
import { VoicePlaygroundVoicePicker } from "./VoicePlaygroundVoicePicker";

function SwapVoicePopover({
  entry,
  pg,
  compact = false,
}: {
  entry: UnifiedPlaygroundEntry;
  pg: VoicePlaygroundClientState;
  compact?: boolean;
}) {
  const pgItem = entry.playgroundItem;
  const speakersRecord = entry.kind === "dialogue" ? pgItem?.dialogue?.speakers : undefined;
  const dialogueSpeakers = useMemo(
    () => extractDialogueSpeakerEntries(speakersRecord),
    [speakersRecord],
  );
  const isDialogue = dialogueSpeakers.length > 0;
  const firstSpeakerKey = dialogueSpeakers[0]?.name ?? "";
  const speakerItems = useMemo(
    () =>
      dialogueSpeakers.map((sp) => ({
        value: sp.name,
        label: `${sp.name} (${sp.voice_name || sp.voice_id})`,
      })),
    [dialogueSpeakers],
  );

  const vcMissingSource =
    entry.kind === "voice_changer" &&
    !(
      pgItem?.voiceChanger?.sourceFile ||
      pgItem?.voiceChanger?.sourceItemId ||
      (pgItem?.voiceChanger?.sourceTakeKind && pgItem?.voiceChanger?.sourceTakeFile)
    );

  const [open, setOpen] = useState(false);
  const [speakerKey, setSpeakerKey] = useState(firstSpeakerKey);
  const [swapVoice, setSwapVoice] = useState({ id: entry.voiceId, name: entry.voiceName });
  const isBusy = pg.busyAction === `retry:${entry.id}`;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      if (isDialogue) {
        const key = firstSpeakerKey;
        const sp = pgItem?.dialogue?.speakers[key];
        setSpeakerKey(key);
        setSwapVoice(
          sp
            ? { id: sp.voice_id, name: sp.voice_name || sp.voice_id }
            : { id: entry.voiceId, name: entry.voiceName },
        );
      } else {
        setSwapVoice({ id: entry.voiceId, name: entry.voiceName });
      }
    }
  };

  const handleGenerateNow = () => {
    if (vcMissingSource) return;
    setOpen(false);
    if (entry.origin === "playground" && pgItem) {
      void retryWithVoiceSwap(entry.id, {
        voiceId: swapVoice.id,
        voiceName: swapVoice.name,
        ...(isDialogue && speakerKey ? { speakerKey } : {}),
        name: `${entry.templateName || entry.title} · ${swapVoice.name}`,
      });
      return;
    }
    duplicateEntryToComposer(entry, {
      overrideVoice: {
        ...swapVoice,
        ...(isDialogue && speakerKey ? { speakerKey } : {}),
      },
      switchToCreate: true,
    });
    setPlaygroundSubTab("create");
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isBusy}
            aria-label={`Swap voice from ${entry.voiceName}`}
          />
        }
      >
        <Shuffle className="size-3" />
        <span>{compact ? "Swap" : "Swap Voice"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" variant="flush" className="w-72">
        <div className="flex flex-col gap-2 p-2.5">
          <PopoverTitle>Swap Voice on “{entry.templateName || entry.title}”</PopoverTitle>
          <p className="text-muted-foreground text-xs">
            Keeps the exact prompt, audio tags, model, and sliders — only swaps the speaker voice.
          </p>
          {isDialogue && (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs font-medium">Speaker Slot</span>
              {speakerItems.length > 1 ? (
                <Select
                  items={speakerItems}
                  value={speakerKey}
                  onValueChange={(nextKey) => {
                    if (!nextKey) return;
                    setSpeakerKey(nextKey);
                    const sp = pgItem?.dialogue?.speakers[nextKey];
                    if (sp) setSwapVoice({ id: sp.voice_id, name: sp.voice_name || sp.voice_id });
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Speaker slot to swap" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {speakerItems.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm">{firstSpeakerKey}</span>
              )}
            </div>
          )}
          <VoicePlaygroundVoicePicker
            selectedId={swapVoice.id}
            selectedName={swapVoice.name}
            defaultVoices={pg.catalog.defaultVoices}
            sharedSearch={pg.sharedSearch}
            configured={pg.status.configured}
            onSearchShared={searchLiveSharedVoices}
            onLoadMoreShared={() => void loadMoreSharedVoices()}
            onSelect={setSwapVoice}
            fullWidth
          />
          {vcMissingSource && (
            <p className="text-warn-text text-xs">
              Original Voice Changer source audio is unavailable on this clip — use Edit in Composer
              and pick a source.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {entry.origin === "playground" && (
              <Button
                type="button"
                size="sm"
                disabled={isBusy || vcMissingSource}
                onClick={handleGenerateNow}
              >
                <Sparkles className="size-3" />
                <span>{isBusy ? "Starting…" : "Generate Now"}</span>
              </Button>
            )}
            <Button
              type="button"
              variant={entry.origin === "playground" ? "secondary" : "default"}
              size="sm"
              onClick={() => {
                setOpen(false);
                duplicateEntryToComposer(entry, {
                  overrideVoice: {
                    ...swapVoice,
                    ...(isDialogue && speakerKey ? { speakerKey } : {}),
                  },
                  switchToCreate: true,
                });
                setPlaygroundSubTab("create");
              }}
            >
              <CopyPlus className="size-3" />
              <span>Edit in Composer</span>
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Parameter inspector, audio scrubber, remix/template/promote controls, and SRT viewer for a voice clip.
 */
export function VoicePlaygroundInspector({
  entry,
  pg,
  filmTakes,
}: {
  entry: UnifiedPlaygroundEntry | null;
  pg: VoicePlaygroundClientState;
  filmTakes: readonly VoiceTakeItem[];
}) {
  const uid = useId();
  const templateInputId = `${uid}-template-name`;
  const notesInputId = `${uid}-item-notes`;
  const nowPlaying = useSyncExternalStore(subscribeAudition, listening, listening);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState<string | null>(null);
  const [promoteTakeId, setPromoteTakeId] = useState(filmTakes[0]?.id ?? "");
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [prevEntryId, setPrevEntryId] = useState(entry?.id ?? "");
  if (prevEntryId !== (entry?.id ?? "")) {
    setPrevEntryId(entry?.id ?? "");
    setPromoteOpen(false);
  }
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMetadataRef = useRef<{
    id: string;
    patch: Parameters<typeof patchPlaygroundItem>[1];
  } | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      const pending = pendingMetadataRef.current;
      if (pending && getPlaygroundItemByAuditionId(`pg:${pending.id}`)) {
        void patchPlaygroundItem(pending.id, pending.patch);
      }
    },
    [],
  );

  const takeItems = useMemo(
    () => filmTakes.map((t) => ({ value: t.id, label: `Take ${t.id}: ${t.text.slice(0, 32)}` })),
    [filmTakes],
  );

  const effectivePromoteTakeId = filmTakes.some((t) => t.id === promoteTakeId)
    ? promoteTakeId
    : (filmTakes[0]?.id ?? "");
  const titleDraft = editingTitle ?? entry?.title ?? "";
  const notesDraft = editingNotes ?? entry?.notes ?? "";
  const templateNameDraft = editingTemplateName ?? (entry?.templateName || entry?.title || "");
  const isPlayground = entry?.origin === "playground" && Boolean(entry?.playgroundItem);
  const pgItem = entry?.playgroundItem;
  const safeDialogueSpeakers = useMemo(
    () =>
      entry?.kind === "dialogue" ? extractDialogueSpeakerEntries(pgItem?.dialogue?.speakers) : [],
    [entry?.kind, pgItem?.dialogue?.speakers],
  );

  useLayoutEffect(() => {
    const patch: Parameters<typeof patchPlaygroundItem>[1] = {};
    if (entry?.playgroundItem) {
      if (editingTitle !== null && editingTitle.trim() && editingTitle.trim() !== entry.title) {
        patch.title = editingTitle.trim();
      }
      if (editingNotes !== null && editingNotes !== (entry.notes ?? "")) patch.notes = editingNotes;
      if (
        entry.isTemplate &&
        editingTemplateName?.trim() &&
        editingTemplateName.trim() !== entry.templateName
      ) {
        patch.templateName = editingTemplateName.trim();
      }
    }
    pendingMetadataRef.current =
      entry && Object.keys(patch).length ? { id: entry.id, patch } : null;
  }, [entry, editingTitle, editingNotes, editingTemplateName]);

  if (!entry) {
    return (
      <div className="text-muted-foreground flex h-full min-h-48 flex-col items-center justify-center gap-2 p-4 text-center text-sm">
        <SlidersHorizontal className="size-5 opacity-60" />
        <p className="text-foreground font-medium">No voice clip selected</p>
        <p className="max-w-64">
          Pick any generated Playground clip or AI Film Take to inspect every setting, duplicate it,
          or swap voices.
        </p>
      </div>
    );
  }

  const isPlaying = Boolean(entry.auditionId && nowPlaying === entry.auditionId);
  const vs = entry.voiceSettings ?? {};
  const promptSegments = parsePromptSegments(entry.text);
  const presentation = PLAYGROUND_MODE_PRESENTATION[entry.kind];

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      say("Could not copy. Select the visible text and copy it manually.");
      return;
    }
    setCopiedField(label);
    say(`Copied ${label}`);
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      setCopiedField(null);
      copyTimerRef.current = null;
    }, 1200);
  };

  const settingRows: Array<{ label: string; value: string; mono?: boolean }> = [
    ...(entry.kind === "dialogue" && pgItem?.dialogue
      ? [
          {
            label: "Cast",
            value: `${safeDialogueSpeakers.length} speakers (${entry.voiceName})`,
          },
          { label: "Model", value: entry.modelId || "Multi-model", mono: true },
          { label: "Mode", value: entry.kind },
          {
            label: "Pause between turns",
            value: `${pgItem.dialogue.pause_between_turns.toFixed(2)}s`,
            mono: true,
          },
          {
            label: "Transcript (.srt)",
            value: entry.exportTranscript ? "Requested (+15%)" : "Off",
          },
        ]
      : [
          { label: "Voice", value: `${entry.voiceName} (${entry.voiceId})`, mono: true },
          { label: "Model", value: entry.modelId || "—", mono: true },
          ...(entry.kind !== "voice_changer"
            ? [{ label: "Language", value: entry.languageCode || "Auto", mono: true }]
            : []),
          { label: "Mode", value: entry.kind },
          {
            label: "Stability",
            value: typeof vs.stability === "number" ? vs.stability.toFixed(2) : "Default",
            mono: true,
          },
          {
            label: "Similarity",
            value:
              typeof vs.similarity_boost === "number" ? vs.similarity_boost.toFixed(2) : "Default",
            mono: true,
          },
          {
            label: "Style",
            value: typeof vs.style === "number" ? vs.style.toFixed(2) : "—",
            mono: true,
          },
          {
            label: "Speaker Boost",
            value:
              typeof vs.use_speaker_boost === "boolean"
                ? vs.use_speaker_boost
                  ? "Enabled"
                  : "Off"
                : "—",
          },
          {
            label: "Speed",
            value: typeof vs.speed === "number" ? `${vs.speed.toFixed(2)}×` : "Default",
            mono: true,
          },
          ...(entry.kind !== "voice_changer"
            ? [
                {
                  label: "Transcript (.srt)",
                  value: entry.exportTranscript ? "Requested (+15%)" : "Off",
                },
              ]
            : []),
        ]),
    {
      label: "Duration",
      value: entry.durationSeconds > 0 ? formatSoundDuration(entry.durationSeconds, "sfx") : "—",
      mono: true,
    },
    {
      label: "Characters / Credits",
      value: `${entry.charactersUsed.toLocaleString()} ch / ${entry.creditsDeducted.toLocaleString()} cr`,
      mono: true,
    },
  ];

  if (entry.remoteTaskId) {
    settingRows.push({ label: "GenVoice Task ID", value: entry.remoteTaskId, mono: true });
  }
  if (entry.createdAt) {
    settingRows.push({
      label: "Created",
      value: new Date(entry.createdAt).toLocaleString(),
      mono: true,
    });
  }
  if (pgItem?.sourceTakeId) {
    settingRows.push({ label: "Source Film Take", value: pgItem.sourceTakeId, mono: true });
  }
  if (pgItem?.fromTemplateId) {
    settingRows.push({ label: "From Template", value: pgItem.fromTemplateId, mono: true });
  }
  if (typeof pgItem?.seed === "number") {
    settingRows.push({ label: "Seed", value: String(pgItem.seed), mono: true });
  }
  if (pgItem?.outputFormat) {
    settingRows.push({ label: "Output Format", value: pgItem.outputFormat, mono: true });
  }
  if (pgItem?.applyTextNormalization) {
    settingRows.push({ label: "Text Normalization", value: pgItem.applyTextNormalization });
  }
  if (pgItem?.previousText) {
    settingRows.push({ label: "Previous Text", value: pgItem.previousText });
  }
  if (pgItem?.nextText) {
    settingRows.push({ label: "Next Text", value: pgItem.nextText });
  }
  if (pgItem?.voiceChanger) {
    settingRows.push({
      label: "VC Source",
      value: pgItem.voiceChanger.sourceLabel || pgItem.voiceChanger.sourceItemId || "Upload",
    });
    settingRows.push({
      label: "Remove Noise",
      value: pgItem.voiceChanger.remove_background_noise ? "On" : "Off",
    });
  }
  if (pgItem?.fallbackNote) {
    settingRows.push({ label: "Fallback", value: pgItem.fallbackNote });
  }

  return (
    <div role="region" aria-label="Voice clip inspector" className="flex flex-col gap-3">
      {/* Header: Editable Title + Favorite */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isPlayground ? (
            <div className="flex items-center gap-1.5">
              <Input
                size="heading"
                variant="title"
                aria-label="Clip title"
                onFocus={() => setPlaygroundSubTab("inspect")}
                value={titleDraft}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={() => {
                  const trimmed = titleDraft.trim();
                  if (trimmed && trimmed !== entry.title) {
                    void patchPlaygroundItem(entry.id, { title: trimmed }).then((saved) => {
                      if (
                        saved &&
                        (!pendingMetadataRef.current?.patch.title ||
                          pendingMetadataRef.current.patch.title === trimmed)
                      )
                        setEditingTitle(null);
                    });
                  } else {
                    setEditingTitle(null);
                  }
                }}
              />
            </div>
          ) : (
            <h4 className="text-foreground text-base font-semibold">{entry.title}</h4>
          )}
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className={cn("inline-flex items-center gap-1.5 font-medium", presentation.text)}>
              <span aria-hidden className={cn("size-1.5 rounded-full", presentation.dot)} />
              {presentation.label}
            </span>
            <span>{isPlayground ? "Playground" : `AI Take ${entry.id}`}</span>
            {entry.isTemplate && <span>Template: {entry.templateName || entry.title}</span>}
            <span>{entry.modelId}</span>
          </div>
        </div>

        <Tip label={entry.favorite ? "Remove from Starred" : "Star this voice clip"}>
          <Button
            type="button"
            variant="favorite"
            size="icon"
            aria-pressed={entry.favorite}
            aria-label={`Favorite ${entry.title}`}
            onClick={() => void toggleUnifiedFavorite(entry)}
          >
            <Star className={cn("size-4", entry.favorite && "fill-current")} />
          </Button>
        </Tip>
      </div>

      {/* Inline Audio Player & Scrubber */}
      {entry.audioUrl && (
        <div className="border-hairline bg-surface-subtle flex items-center gap-2 rounded-lg border px-2.5 py-2">
          <Button
            type="button"
            variant="cover"
            size="icon-lg"
            aria-label={`${isPlaying ? "Pause" : "Play"} ${entry.title}`}
            onClick={() => listenUrl(entry.auditionId, entry.audioUrl)}
          >
            {isPlaying ? (
              <Pause className="size-4 fill-current" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
          </Button>
          <div className="min-w-0 flex-1">
            <AuditionScrubber
              id={entry.auditionId}
              label={entry.title}
              fallbackSeconds={entry.durationSeconds}
              kind="sfx"
              flush
            />
          </div>
          <Tip label="Download audio file">
            <a
              href={entry.audioUrl}
              download={pgItem?.audioFile || `${entry.id}.mp3`}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2 pointer-coarse:size-9"
              aria-label="Download audio"
            >
              <Download className="size-3.5" />
            </a>
          </Tip>
        </div>
      )}

      {/* Primary Remix Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="sm" onClick={() => duplicateEntryToComposer(entry)}>
          <CopyPlus className="size-3" />
          <span>Duplicate to Editor</span>
        </Button>

        <SwapVoicePopover key={entry.uid} entry={entry} pg={pg} />

        {isPlayground && pgItem && (
          <Button
            type="button"
            variant={pgItem.isTemplate ? "lit" : "secondary"}
            size="sm"
            onClick={() =>
              void patchPlaygroundItem(entry.id, {
                isTemplate: !pgItem.isTemplate,
                templateName: pgItem.isTemplate ? "" : templateNameDraft.trim() || entry.title,
              })
            }
          >
            <Bookmark className="size-3" />
            <span>{pgItem.isTemplate ? "Template ✓" : "Save Template"}</span>
          </Button>
        )}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            const { voiceId, voiceName } = entryToComposerDraft(entry);
            setComposerDraft({
              mode: "voice_changer",
              modelId: "eleven_multilingual_sts_v2",
              voiceId,
              voiceName,
              vcSourceKind: isPlayground ? "playground" : "film_take",
              vcSourceItemId: isPlayground ? entry.id : "",
              vcSourceTakeValue:
                !isPlayground && entry.filmTake?.file ? `takes:${entry.filmTake.file}` : "",
              title: `${entry.title} (VC)`,
            });
            setPlaygroundSubTab("create");
            say(`Loaded “${entry.title}” as Voice Changer source`);
          }}
        >
          <Wand2 className="size-3" />
          <span>Change Voice</span>
        </Button>

        {(isPlayground || Boolean(entry.filmTake?.file)) && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setComposerDraft({
                mode: "stt",
                sttSourceKind: isPlayground ? "playground" : "film_take",
                sttSourceItemId: isPlayground ? entry.id : "",
                sttSourceTakeValue:
                  !isPlayground && entry.filmTake?.file ? `takes:${entry.filmTake.file}` : "",
              });
              setPlaygroundSubTab("create");
              say(`Loaded “${entry.title}” into Transcribe (Scribe v2)`);
            }}
          >
            <Captions className="size-3" />
            <span>Transcribe</span>
          </Button>
        )}

        {isPlayground && filmTakes.length > 0 && (
          <Popover open={promoteOpen} onOpenChange={setPromoteOpen}>
            <PopoverTrigger
              render={
                <Button type="button" variant="secondary" size="sm">
                  <Film className="size-3" />
                  <span>Use in Film</span>
                </Button>
              }
            />
            <PopoverContent align="start" variant="flush" className="w-64">
              <div className="flex flex-col gap-2 p-2.5">
                <PopoverTitle>Promote to Film Voiceover Take</PopoverTitle>
                <p className="text-muted-foreground text-xs">
                  Adds this Playground audio as an alternative try on a film take.
                </p>
                <Select
                  items={takeItems}
                  value={effectivePromoteTakeId}
                  onValueChange={(v) => setPromoteTakeId(v ?? "")}
                >
                  <SelectTrigger size="sm" aria-label="Target film take ID">
                    <SelectValue placeholder="Choose take ID…" />
                  </SelectTrigger>
                  <SelectContent>
                    {filmTakes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        Take {t.id}: {t.text.slice(0, 32)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  disabled={!effectivePromoteTakeId || pg.busyAction === `promote:${entry.id}`}
                  onClick={async () => {
                    if (await promotePlaygroundToTake(entry.id, effectivePromoteTakeId)) {
                      setPromoteOpen(false);
                    }
                  }}
                >
                  Copy to Take {effectivePromoteTakeId}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}

        {isPlayground && (
          <span className="ms-auto flex items-center gap-1">
            {confirmDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pg.busyAction === `delete:${entry.id}`}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            )}
            <Button
              type="button"
              variant="remove"
              size="sm"
              disabled={pg.busyAction === `delete:${entry.id}`}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                void deletePlaygroundItem(entry.id);
              }}
            >
              <Trash2 className="size-3" />
              <span>
                {pg.busyAction === `delete:${entry.id}`
                  ? "Deleting…"
                  : confirmDelete
                    ? "Confirm Delete"
                    : "Delete"}
              </span>
            </Button>
          </span>
        )}
      </div>

      {/* Template Name Editor when flagged as reusable preset */}
      {isPlayground && pgItem?.isTemplate && (
        <div className="border-hairline bg-surface-subtle flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
          <label
            htmlFor={templateInputId}
            className="text-muted-foreground flex-none text-xs font-medium"
          >
            Template label
          </label>
          <Input
            id={templateInputId}
            size="sm"
            value={templateNameDraft}
            onFocus={() => setPlaygroundSubTab("inspect")}
            onChange={(e) => setEditingTemplateName(e.target.value)}
            onBlur={() => {
              const trimmed = templateNameDraft.trim();
              if (trimmed && trimmed !== pgItem.templateName) {
                void patchPlaygroundItem(entry.id, { templateName: trimmed }).then((saved) => {
                  if (
                    saved &&
                    (!pendingMetadataRef.current?.patch.templateName ||
                      pendingMetadataRef.current.patch.templateName === trimmed)
                  )
                    setEditingTemplateName(null);
                });
              } else {
                setEditingTemplateName(null);
              }
            }}
            placeholder="Reusable preset name…"
          />
        </div>
      )}

      {/* Prompt / Script with Styled Audio Tags */}
      <div className={cn("flex flex-col gap-1.5 rounded-lg border p-3", presentation.panel)}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-sm font-semibold", presentation.text)}>
            Prompt & Audio Tags
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleCopy(entry.text, "prompt")}
          >
            {copiedField === "prompt" ? (
              <Check className="text-primary-text size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            <span>Copy Prompt</span>
          </Button>
        </div>
        <p className="text-foreground text-sm/relaxed whitespace-pre-wrap select-text">
          {promptSegments.map((seg, i) =>
            seg.kind === "tag" ? (
              <span
                key={i}
                className="bg-tint text-primary-text mx-0.5 inline-block rounded px-1 py-0.5 font-mono text-xs font-medium"
              >
                [{seg.value}]
              </span>
            ) : (
              <span key={i}>{seg.value}</span>
            ),
          )}
        </p>
      </div>

      {/* Complete Recorded Parameters Grid */}
      <div className="border-hairline bg-card flex flex-col gap-1.5 rounded-lg border p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground text-sm font-semibold">All Recorded Parameters</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              handleCopy(
                entry.voiceId,
                entry.kind === "dialogue" ? "Speaker 1 voice_id" : "voice_id",
              )
            }
          >
            <Copy className="size-3" />
            <span>{entry.kind === "dialogue" ? "Copy Speaker 1 ID" : "Copy voice_id"}</span>
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm select-text">
          {settingRows.map((row) => (
            <div key={row.label} className="border-hairline/50 flex min-w-0 flex-col border-b pb-1">
              <dt className="text-muted-foreground text-xs">{row.label}</dt>
              <dd
                className={cn(
                  "text-foreground font-medium wrap-break-word",
                  row.mono && "font-mono tabular-nums",
                )}
                title={row.value}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        {entry.kind === "voice_changer" &&
          pgItem?.voiceChanger?.sourceFile &&
          !pgItem?.voiceChanger?.sourceItemId &&
          !pgItem?.voiceChanger?.sourceTakeFile && (
            <p className="text-muted-foreground text-xs">
              Archived upload (<code className="font-mono">{pgItem.voiceChanger.sourceLabel}</code>)
              stays available for Retry, Swap Voice, and Duplicate to Editor.
            </p>
          )}

        {pgItem?.dialogue && safeDialogueSpeakers.length > 0 && (
          <div className="border-hairline mt-1 border-t pt-2">
            <span className="text-muted-foreground text-xs font-medium">
              Dialogue Speakers (pause {pgItem.dialogue.pause_between_turns}s)
            </span>
            <div className="mt-1 flex flex-col gap-1">
              {safeDialogueSpeakers.map((sp) => {
                const sv = sp.voice_settings;
                const tuningParts: string[] = [];
                if (typeof sv?.stability === "number")
                  tuningParts.push(`stab ${sv.stability.toFixed(2)}`);
                if (typeof sv?.similarity_boost === "number")
                  tuningParts.push(`sim ${sv.similarity_boost.toFixed(2)}`);
                if (typeof sv?.style === "number") tuningParts.push(`style ${sv.style.toFixed(2)}`);
                if (typeof sv?.speed === "number") tuningParts.push(`spd ${sv.speed.toFixed(2)}×`);
                if (typeof sv?.use_speaker_boost === "boolean")
                  tuningParts.push(`boost ${sv.use_speaker_boost ? "on" : "off"}`);
                return (
                  <div
                    key={sp.name}
                    className="bg-surface-subtle flex flex-wrap items-center justify-between gap-1 rounded px-2 py-1 text-xs"
                  >
                    <span className="text-foreground font-semibold">{sp.name}</span>
                    <span className="text-muted-foreground font-mono">
                      {sp.voice_name || sp.voice_id} · {sp.model_id || "eleven_v4"}
                      {sp.language_code ? ` · ${sp.language_code}` : ""}
                      {tuningParts.length ? ` · ${tuningParts.join(" · ")}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Transcript / .srt Viewer */}
      {(entry.srtFile || entry.srtText || pgItem?.sttResult) && (
        <div className="border-hairline bg-surface-subtle flex flex-col gap-1.5 rounded-lg border p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground text-xs font-semibold">
              Transcript / Subtitles (.srt)
            </span>
            <div className="flex items-center gap-1">
              {entry.srtFile && !entry.srtText && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void fetchPlaygroundSrt(entry.id, entry.srtFile!)}
                >
                  Load .srt
                </Button>
              )}
              {entry.srtText && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(entry.srtText!, "SRT")}
                >
                  <Copy className="size-3" />
                  <span>Copy SRT</span>
                </Button>
              )}
            </div>
          </div>
          {pgItem?.sttResult ? (
            <SttTranscriptDetails
              result={{
                ...pgItem.sttResult,
                srtText: pgItem.sttResult.srtText ?? entry.srtText,
              }}
            />
          ) : entry.srtText ? (
            <pre className="bg-card text-foreground/85 max-h-36 overflow-y-auto rounded p-2 font-mono text-xs whitespace-pre-wrap">
              {entry.srtText}
            </pre>
          ) : (
            <p className="text-muted-foreground text-xs">
              SRT archived at <code className="font-mono">{entry.srtFile}</code>
            </p>
          )}
        </div>
      )}

      {/* Notes */}
      {isPlayground && (
        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground text-xs font-medium" htmlFor={notesInputId}>
            Notes & Acting Direction
          </label>
          <Textarea
            id={notesInputId}
            rows={2}
            value={notesDraft}
            onFocus={() => setPlaygroundSubTab("inspect")}
            onChange={(e) => setEditingNotes(e.target.value)}
            onBlur={() => {
              if (notesDraft !== (entry.notes ?? "")) {
                void patchPlaygroundItem(entry.id, { notes: notesDraft }).then((saved) => {
                  if (
                    saved &&
                    (pendingMetadataRef.current?.patch.notes === undefined ||
                      pendingMetadataRef.current.patch.notes === notesDraft)
                  )
                    setEditingNotes(null);
                });
              } else {
                setEditingNotes(null);
              }
            }}
            placeholder="Write delivery notes, scene context, or why this take worked…"
          />
        </div>
      )}
    </div>
  );
}
