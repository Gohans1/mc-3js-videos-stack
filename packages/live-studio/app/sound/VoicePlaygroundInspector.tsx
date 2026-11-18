import {
  Archive,
  Bookmark,
  Captions,
  Check,
  Copy,
  CopyPlus,
  Download,
  Film,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Star,
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

import { providerForModel } from "../../src/voice-playground-providers.mjs";
import { Tip } from "../components/Tip";
import { say } from "../core/store";
import { AuditionScrubber } from "./AuditionScrubber";
import { formatSoundDuration } from "./library-view";
import { listening, listenUrl, subscribeAudition } from "./sound";
import {
  archiveFilmTake,
  copyPlaygroundToScope,
  deletePlaygroundItem,
  duplicateEntryToComposer,
  fetchPlaygroundSrt,
  getPlaygroundItemByAuditionId,
  loadRecordingArchivePolicy,
  loadMoreSharedVoices,
  openFilmRecordingEditor,
  openRecordingEditor,
  patchPlaygroundItem,
  promotePlaygroundToTake,
  recordingRemovalFocus,
  retryWithVoiceSwap,
  searchLiveSharedVoices,
  selectPlaygroundUid,
  setComposerDraft,
  setPlaygroundSubTab,
  switchPlaygroundTool,
  toggleUnifiedFavorite,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import { PLAYGROUND_MODE_PRESENTATION } from "./voice-playground-presentation";
import { quoteGeneration } from "./voice-playground-pricing";
import {
  entryToComposerDraft,
  extractDialogueSpeakerEntries,
  recordedFee,
  swapGenerationInput,
  type UnifiedPlaygroundEntry,
  voiceChangerSourceDraft,
  withComposerVoice,
  withDialogueVoice,
} from "./voice-playground-view";
import { recordingEditRecipe } from "./voice-region-view";
import { recordedCastSummary, recordedVoiceSettings } from "./voice-setting-details";
import { parsePromptSegments } from "./voice-tags";
import { type VoiceTakeItem } from "./voice-view";
import type { PickedVoice } from "./VoiceCastingRow";
import { VoiceGenerationPrice } from "./VoiceGenerationPrice";
import { VoiceDubbingMedia } from "./VoicePlaygroundResults";
import { VoicePlaygroundRights } from "./VoicePlaygroundRights";
import { SttTranscriptDetails } from "./VoicePlaygroundSecondaryModes";
import { VoicePlaygroundTemplateActions } from "./VoicePlaygroundTemplateActions";
import { VoicePlaygroundUseTake } from "./VoicePlaygroundUseTake";
import { VoicePlaygroundVoicePicker } from "./VoicePlaygroundVoicePicker";
import { VoiceRecordingCaptions } from "./VoiceRecordingCaptions";
import { VoiceRecordingEdits } from "./VoiceRecordingEdits";
import { VoiceRecordingMetadata } from "./VoiceRecordingMetadata";
import { VoicePlaybackIcon } from "./VoicePlaybackIcon";

function SwapVoicePopover({
  entry,
  pg,
  compact = false,
}: {
  entry: UnifiedPlaygroundEntry;
  pg: VoicePlaygroundClientState;
  compact?: boolean;
}) {
  const pgItem = entry.playgroundItem ?? entry.sourceRecording;
  const dialogue = entry.dialogue ?? pgItem?.dialogue;
  const speakersRecord = entry.kind === "dialogue" ? dialogue?.speakers : undefined;
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
  const [swapVoice, setSwapVoice] = useState<PickedVoice>({
    id: entry.voiceId,
    name: entry.voiceName,
    provider:
      pgItem?.provider === "google"
        ? undefined
        : (pgItem?.provider ?? providerForModel(entry.modelId)),
  });
  const isBusy = pg.busyAction === `retry:${entry.id}`;
  const swapDraft = useMemo(() => {
    const draft = entryToComposerDraft(entry);
    return draft.mode === "dialogue"
      ? {
          ...draft,
          speakers: draft.speakers.map((speaker) =>
            speaker.name === speakerKey
              ? withDialogueVoice(speaker, swapVoice, pg.catalog)
              : speaker,
          ),
        }
      : withComposerVoice(draft, swapVoice, pg.catalog);
  }, [entry, speakerKey, swapVoice, pg.catalog]);
  const swapQuote = quoteGeneration(swapDraft, pg.catalog.models);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      if (isDialogue) {
        const key = firstSpeakerKey;
        const sp = dialogue?.speakers[key];
        setSpeakerKey(key);
        setSwapVoice(
          sp
            ? {
                id: sp.voice_id,
                name: sp.voice_name || sp.voice_id,
                provider: sp.provider ?? providerForModel(sp.model_id),
              }
            : {
                id: entry.voiceId,
                name: entry.voiceName,
                provider:
                  pgItem?.provider === "google"
                    ? undefined
                    : (pgItem?.provider ?? providerForModel(entry.modelId)),
              },
        );
      } else {
        setSwapVoice({
          id: entry.voiceId,
          name: entry.voiceName,
          provider:
            pgItem?.provider === "google"
              ? undefined
              : (pgItem?.provider ?? providerForModel(entry.modelId)),
        });
      }
    }
  };

  const handleGenerateNow = () => {
    if (vcMissingSource) return;
    setOpen(false);
    if (entry.origin === "playground" && pgItem) {
      void retryWithVoiceSwap(entry.id, {
        ...swapGenerationInput(swapDraft, pg.catalog.models, isDialogue ? speakerKey : undefined),
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
            Keeps your script. Changing source selects a compatible model and its supported
            settings; the original recording stays saved.
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
                    const sp = dialogue?.speakers[nextKey];
                    if (sp)
                      setSwapVoice({
                        id: sp.voice_id,
                        name: sp.voice_name || sp.voice_id,
                        provider: sp.provider ?? providerForModel(sp.model_id),
                      });
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Speaker slot to swap" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent finalFocus>
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
            selectedProvider={swapVoice.provider}
            allowedProviders={entry.kind === "voice_changer" ? ["elevenlabs"] : undefined}
            selectedName={swapVoice.name}
            defaultVoices={pg.catalog.defaultVoices}
            sharedSearch={pg.sharedSearch}
            configured={pg.status.configured}
            onSearchShared={searchLiveSharedVoices}
            onLoadMoreShared={() => void loadMoreSharedVoices()}
            onSelect={setSwapVoice}
            fullWidth
          />
          <p className="text-muted-foreground text-xs">
            New model:{" "}
            {isDialogue
              ? swapDraft.speakers.find((speaker) => speaker.name === speakerKey)?.modelId
              : swapDraft.modelId}
          </p>
          <p className="text-muted-foreground text-xs">
            Language:{" "}
            {isDialogue
              ? swapDraft.speakers.find((speaker) => speaker.name === speakerKey)?.languageCode ||
                "Auto"
              : swapDraft.languageCode || "Auto"}
          </p>
          <VoiceGenerationPrice
            quote={swapQuote}
            mode={swapDraft.mode}
            exportTranscript={swapDraft.exportTranscript}
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
function ArchiveRetentionNotice({
  id,
  scope,
  archivedAt,
}: {
  id: string;
  scope: "project" | "global";
  archivedAt: string;
}) {
  const [policy, setPolicy] = useState<{ deleteAfter: string | null } | null>();
  useEffect(() => {
    const controller = new AbortController();
    void loadRecordingArchivePolicy(id, scope, controller.signal)
      .then(({ policy }) => {
        if (!controller.signal.aborted) setPolicy(policy);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPolicy(null);
      });
    return () => controller.abort();
  }, [id, scope, archivedAt]);
  return (
    <p role="status" className="text-muted-foreground max-w-[35ch] text-end text-xs text-pretty">
      {policy === undefined
        ? "Checking deletion policy…"
        : policy === null
          ? "Deletion policy unavailable. Restore this recording to keep it."
          : policy.deleteAfter
            ? `May be deleted on or after ${new Date(policy.deleteAfter).toLocaleDateString(undefined, { dateStyle: "medium" })}. Restore to keep it.`
            : "Protected from automatic deletion."}
    </p>
  );
}

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
  const pgItem = entry?.playgroundItem ?? entry?.sourceRecording;
  const dialogue = entry?.dialogue ?? pgItem?.dialogue;
  const safeDialogueSpeakers = useMemo(
    () => (entry?.kind === "dialogue" ? extractDialogueSpeakerEntries(dialogue?.speakers) : []),
    [entry?.kind, dialogue?.speakers],
  );
  const modelLabel = safeDialogueSpeakers.length
    ? recordedCastSummary(safeDialogueSpeakers).modelLabel
    : entry?.modelId || "\u2014";

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
  const sttTemplate = entry.kind === "stt" && entry.template ? entryToComposerDraft(entry) : null;
  const contentName =
    entry.kind === "dubbing" ? "translation" : entry.kind === "stt" ? "transcript" : "prompt";

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
    ...(entry.kind === "stt"
      ? [
          {
            label: "Original source",
            value:
              pgItem?.transcription?.sourceLabel ||
              sttTemplate?.sttSourceLabel ||
              "Choose a source when loading this template",
          },
          { label: "Model", value: "Scribe v2" },
          {
            label: sttTemplate ? "Language" : "Detected language",
            value: pgItem?.sttResult?.language_code || entry.languageCode || "Not reported",
          },
          ...Object.entries(
            pgItem?.transcription?.settings ||
              (sttTemplate
                ? Object.fromEntries(
                    Object.entries(sttTemplate).filter(
                      ([key]) => key.startsWith("stt") && !key.startsWith("sttSource"),
                    ),
                  )
                : {}),
          ).map(([key, value]) => ({
            label: key
              .replace(/^stt/, "")
              .replace(/([A-Z])/g, " $1")
              .trim()
              .replace(/^./, (letter) => letter.toUpperCase()),
            value: Array.isArray(value) ? value.join(", ") : String(value),
          })),
          {
            label: "Actual STT fee",
            value:
              typeof pgItem?.sttResult?.creditsDeducted === "number"
                ? `${pgItem.sttResult.creditsDeducted.toLocaleString()} credits`
                : sttTemplate
                  ? "No generation yet"
                  : "Not reported",
          },
        ]
      : entry.kind === "dubbing" && pgItem?.dubbing
        ? [
            { label: "Voice", value: entry.voiceName },
            { label: "Provider", value: pgItem.provider ?? "Not recorded" },
            { label: "Dubbing model", value: pgItem.dubbing.modelId, mono: true },
            { label: "Source language", value: pgItem.dubbing.sourceLanguage },
            { label: "Target language", value: pgItem.dubbing.targetLanguage },
            { label: "Dubbing voice ID", value: pgItem.dubbing.voiceId, mono: true },
            {
              label: "TTS voice ID",
              value:
                pgItem.dubbing.ttsVoiceId ||
                (pgItem.provider === "minimax" ? "Not verified" : entry.voiceId),
              mono: true,
            },
            { label: "Original source", value: pgItem.dubbing.sourceName || "Not recorded" },
            { label: "Translated subtitles", value: entry.srtFile ? "Saved" : "Not available" },
          ]
        : entry.kind === "dialogue" && dialogue
          ? [
              ...(pgItem?.connection && pgItem.connection !== "genvoice"
                ? [
                    {
                      label: "Dialogue service",
                      value: pgItem.connection === "google" ? "Google Gemini" : "ElevenLabs direct",
                    },
                  ]
                : []),
              {
                label: "Cast",
                value: `${safeDialogueSpeakers.length} speakers (${entry.voiceName})`,
              },
              { label: "Models", value: modelLabel, mono: true },
              ...(pgItem?.connection === "elevenlabs"
                ? [
                    { label: "Spoken language", value: entry.languageCode || "Auto" },
                    ...recordedVoiceSettings("elevenlabs", vs, "Not recorded").filter(
                      (row) => row.value !== "Not recorded",
                    ),
                  ]
                : []),
              { label: "Mode", value: entry.kind },
              {
                label: "Pause between turns",
                value:
                  typeof dialogue.pause_between_turns === "number"
                    ? `${dialogue.pause_between_turns.toFixed(2)}s`
                    : "Model-controlled",
                mono: true,
              },
              ...(pgItem?.connection === "google"
                ? []
                : [
                    {
                      label:
                        pgItem?.connection === "elevenlabs" ? "Word timings" : "Transcript (.srt)",
                      value: entry.exportTranscript
                        ? pgItem?.connection === "elevenlabs"
                          ? pgItem.wordTimings?.length
                            ? "Saved"
                            : "Requested · unavailable"
                          : entry.srtFile || entry.srtText
                            ? "Saved"
                            : "Requested · unavailable"
                        : "Off",
                    },
                  ]),
            ]
          : [
              ...(pgItem?.connection && pgItem.connection !== "genvoice"
                ? [
                    {
                      label: "Speech service",
                      value: pgItem.connection === "google" ? "Google Gemini" : "ElevenLabs direct",
                    },
                  ]
                : []),
              ...(pgItem?.speechStyle
                ? [{ label: "Speech direction", value: pgItem.speechStyle }]
                : []),
              { label: "Voice", value: `${entry.voiceName} (${entry.voiceId})`, mono: true },
              { label: "Model", value: entry.modelId || "—", mono: true },
              ...(entry.kind !== "voice_changer"
                ? [{ label: "Language", value: entry.languageCode || "Auto", mono: true }]
                : []),
              { label: "Mode", value: entry.kind },
              ...recordedVoiceSettings(
                pgItem?.provider ?? providerForModel(entry.modelId),
                vs,
                pgItem?.filmTakeSource ? "Not recorded" : "Default",
              ),
              ...(entry.kind !== "voice_changer"
                ? [
                    {
                      label:
                        pgItem?.connection === "elevenlabs" ? "Word timings" : "Transcript (.srt)",
                      value: entry.exportTranscript
                        ? pgItem?.connection === "elevenlabs"
                          ? "Requested"
                          : "Requested (+15%)"
                        : "Off",
                    },
                  ]
                : []),
            ]),
    {
      label: "Duration",
      value: entry.durationSeconds > 0 ? formatSoundDuration(entry.durationSeconds, "sfx") : "—",
      mono: true,
    },
  ];

  if (pgItem && !entry.template) {
    settingRows.push({
      label: entry.kind === "dubbing" ? "Dubbing cost" : "Actual fee",
      value:
        entry.kind === "dubbing"
          ? `${typeof pgItem?.dubbing?.estimatedCredits === "number" ? `${pgItem.dubbing.estimatedCredits.toLocaleString()} cr estimated / ` : ""}${typeof pgItem?.creditsDeducted === "number" ? `${pgItem.creditsDeducted.toLocaleString()} cr actual` : "Actual fee unknown"}`
          : recordedFee(pgItem),
      mono: true,
    });
  }

  if (entry.remoteTaskId) {
    settingRows.push({ label: "GenVoice Task ID", value: entry.remoteTaskId, mono: true });
  }
  if (pgItem?.providerUsage) {
    settingRows.push({
      label: "Gemini token usage",
      value: `${pgItem.providerUsage.inputTokens.toLocaleString()} input · ${pgItem.providerUsage.outputTokens.toLocaleString()} output`,
      mono: true,
    });
  }
  if (entry.createdAt) {
    settingRows.push({
      label: pgItem?.filmTakeSource ? "Saved to library" : "Created",
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
      {(isPlayground || entry.origin === "film_take") && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            Stored in{" "}
            {entry.origin === "film_take"
              ? "Project / voice/takes"
              : pgItem?.scope === "global"
                ? "Global / monorepo/voice/playground"
                : "Project / voice/playground"}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={Boolean(pg.busyAction) || !entry.audioUrl}
            onClick={() =>
              entry.origin === "film_take"
                ? void archiveFilmTake(entry, "global")
                : void copyPlaygroundToScope(entry.id)
            }
          >
            <CopyPlus />
            Save copy to {pgItem?.scope === "global" ? "Project" : "Global"}
          </Button>
        </div>
      )}
      {entry.template && (
        <VoicePlaygroundTemplateActions key={entry.id} template={entry.template} />
      )}
      {pgItem?.filmTakeSource && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Saved from Film Take {pgItem.filmTakeSource.takeId}. This recording stays unchanged. Only
          generation settings recorded with the original take are available.
        </p>
      )}
      {/* Header: Editable Title + Favorite */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isPlayground ? (
            <div className="flex items-center gap-1.5">
              <Textarea
                variant="title"
                rows={1}
                dir="auto"
                aria-label="Clip title"
                onFocus={() => setPlaygroundSubTab("inspect")}
                value={titleDraft}
                onChange={(e) => setEditingTitle(e.target.value.replace(/[\r\n]+/g, " "))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
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
            <h4 dir="auto" className="text-foreground text-base leading-tight font-semibold wrap-anywhere">
              {entry.title}
            </h4>
          )}
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className={cn("inline-flex items-center gap-1.5 font-medium", presentation.text)}>
              <span aria-hidden className={cn("size-1.5 rounded-full", presentation.dot)} />
              {presentation.label}
            </span>
            <span>
              {entry.template
                ? `${entry.template.scope === "global" ? "Global" : "Project"} template`
                : isPlayground
                  ? "Playground"
                  : `AI Take ${entry.id}`}
            </span>
            {entry.isTemplate && <span>Template: {entry.templateName || entry.title}</span>}
            <span>{modelLabel}</span>
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
      {entry.kind === "dubbing" && <VoiceDubbingMedia key={entry.uid} entry={entry} compactDownloads />}
      {entry.audioUrl && entry.kind !== "dubbing" && (
        <div className="border-hairline bg-surface-subtle flex items-center gap-2 rounded-lg border px-2.5 py-2">
          <Button
            type="button"
            variant="cover"
            size="icon-lg"
            aria-label={`${isPlaying ? "Pause" : "Play"} ${entry.title}`}
            onClick={() => listenUrl(entry.auditionId, entry.audioUrl)}
          >
            <VoicePlaybackIcon playing={isPlaying} />
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

      {entry.audioUrl && entry.kind !== "dubbing" && <VoiceRecordingCaptions entry={entry} />}
      {entry.kind !== "stt" && <VoicePlaygroundUseTake entry={entry} />}
      {entry.kind !== "stt" && (pgItem || (entry.origin === "film_take" && entry.audioUrl)) && (
        <Button
          variant="secondary"
          id="voice-playground-edit-recording"
          onClick={(event) => {
            const openerId = event.currentTarget.id;
            if (pgItem) openRecordingEditor(pgItem, { openerId });
            else openFilmRecordingEditor(entry, openerId);
          }}
        >
          <SlidersHorizontal />
          Edit a section
        </Button>
      )}
      {pgItem && entry.kind !== "stt" && (
        <VoiceRecordingEdits
          item={pgItem}
          onAdjust={
            pgItem.version?.parentId &&
            pg.items.some((item) => item.id === pgItem.version?.parentId)
              ? (openerId) => {
                  const parent = pg.items.find((item) => item.id === pgItem.version?.parentId),
                    recipe = recordingEditRecipe(pgItem);
                  if (parent && recipe)
                    openRecordingEditor(parent, {
                      initialEdit: recipe,
                      revisionOf: pgItem.title,
                      openerId,
                    });
                }
              : undefined
          }
        />
      )}
      <details
        open={entry.template ? true : undefined}
        className="border-hairline rounded-md border p-2.5"
      >
        <summary className="text-foreground focus-visible:outline-ring cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2">
          {entry.template ? "Edit recipe" : "Reuse and convert"}
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={entry.template ? "default" : "secondary"}
            onClick={() => duplicateEntryToComposer(entry)}
          >
            <CopyPlus className="size-3" />
            <span>{entry.template ? "Edit template" : "Duplicate to Editor"}</span>
          </Button>

          {pgItem && entry.kind === "dialogue" && safeDialogueSpeakers.length >= 2 && (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={Boolean(pg.busyAction)}
                  >
                    <RotateCcw className="size-3" />
                    Retry dialogue
                  </Button>
                }
              />
              <PopoverContent align="start" className="w-64">
                <div className="flex flex-col gap-2">
                  <PopoverTitle>Create another take?</PopoverTitle>
                  <p className="text-muted-foreground text-xs">
                    Uses the saved cast and settings. The provider may charge for the new take.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void retryWithVoiceSwap(pgItem.id, {}, { showJobs: true })}
                  >
                    Generate another take
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {pgItem && entry.kind === "dialogue" && safeDialogueSpeakers.length < 2 && (
            <span className="text-muted-foreground self-center text-xs">
              Saved cast unavailable for retry.
            </span>
          )}
          {pgItem?.retry?.parentId && pg.items.some((item) => item.id === pgItem.retry?.parentId) && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => selectPlaygroundUid(`pg:${pgItem.retry?.parentId}`)}
            >
              Previous take
            </Button>
          )}

          {!entry.template &&
            entry.kind !== "dubbing" &&
            entry.kind !== "stt" &&
            (!pgItem?.connection || pgItem.connection === "genvoice") && (
              <SwapVoicePopover key={entry.uid} entry={entry} pg={pg} />
            )}
          {entry.kind === "dubbing" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void duplicateEntryToComposer(entry);
              }}
            >
              Dub again with a different voice
            </Button>
          )}

          {!entry.template && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                duplicateEntryToComposer(entry);
                say("Full settings copied. Edit them, then select Save template.");
              }}
            >
              <Bookmark />
              <span>Edit as template</span>
            </Button>
          )}

          {entry.audioUrl && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setComposerDraft(voiceChangerSourceDraft(entry));
                setPlaygroundSubTab("create");
                say(`Loaded “${entry.title}” as Voice Changer source`);
              }}
            >
              <Wand2 className="size-3" />
              <span>
                {entry.kind === "stt"
                  ? "Change source voice"
                  : entry.kind === "dialogue"
                    ? "Convert with Voice Changer"
                    : "Convert this audio to another voice"}
              </span>
            </Button>
          )}

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

          {isPlayground && entry.kind !== "stt" && filmTakes.length > 0 && (
            <Popover open={promoteOpen} onOpenChange={setPromoteOpen}>
              <PopoverTrigger
                render={
                  <Button type="button" variant="secondary" size="sm">
                    <Film className="size-3" />
                    <span>Save to alternatives</span>
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
                    <SelectContent finalFocus>
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
        </div>
      </details>
      {entry.playgroundItem && <VoiceRecordingMetadata item={entry.playgroundItem} />}
      {isPlayground && (
        <div className="ms-auto flex flex-col items-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-describedby={pgItem?.archivedAt ? undefined : `${uid}-archive-policy`}
            aria-disabled={Boolean(pg.busyAction)}
            onClick={async (event) => {
              if (pg.busyAction) return;
              const focusNearby = recordingRemovalFocus(event.currentTarget);
              const updated = pgItem?.archivedAt
                ? await patchPlaygroundItem(entry.id, { archived: false })
                : await deletePlaygroundItem(entry.id);
              if (updated) focusNearby();
            }}
          >
            {pgItem?.archivedAt ? <RotateCcw /> : <Archive />}
            {pg.busyAction === `delete:${pgItem?.id}`
              ? "Moving to Archive…"
              : pgItem?.archivedAt
                ? "Restore to Recordings"
                : "Move to Archive"}
          </Button>
          {pgItem?.archivedAt ? (
            <>
              <p className="text-muted-foreground text-xs tabular-nums">
                Archived{" "}
                <time dateTime={pgItem.archivedAt}>
                  {new Date(pgItem.archivedAt).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}
                </time>
              </p>
              <ArchiveRetentionNotice
                key={pgItem.archivedAt}
                id={pgItem.id}
                scope={pgItem.scope ?? "project"}
                archivedAt={pgItem.archivedAt}
              />
            </>
          ) : (
            <p
              id={`${uid}-archive-policy`}
              className="text-muted-foreground max-w-[35ch] text-right text-xs text-pretty"
            >
                Studio may delete this recording after 30 days in Archive if it has no protected links.
            </p>
          )}
        </div>
      )}

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

      {pgItem && <VoicePlaygroundRights key={entry.uid} item={pgItem} />}
      {/* Prompt / Script with Styled Audio Tags */}
      <div className={cn("flex flex-col gap-1.5 rounded-lg border p-3", presentation.panel)}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-sm font-semibold", presentation.text)}>
            {sttTemplate
              ? "Transcription recipe"
              : entry.kind === "stt"
                ? "Transcript text"
                : entry.kind === "dubbing"
                  ? "Translated script"
                  : "Prompt & Audio Tags"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!entry.text}
            onClick={() => handleCopy(entry.text, contentName)}
          >
            {copiedField === contentName ? (
              <Check className="text-primary-text size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            <span>Copy {contentName}</span>
          </Button>
        </div>
        <p className="text-foreground text-sm/relaxed wrap-anywhere whitespace-pre-wrap select-text">
          {sttTemplate &&
            "This template retains its source and Scribe settings. Run it to create a transcript."}
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
          {entry.kind !== "stt" && entry.kind !== "dialogue" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                handleCopy(
                  entry.kind === "dubbing"
                    ? pgItem?.dubbing?.voiceId || entry.voiceId
                    : entry.voiceId,
                  "voice_id",
                )
              }
            >
              <Copy className="size-3" />
              <span>{entry.kind === "dubbing" ? "Copy Dubbing voice ID" : "Copy voice ID"}</span>
            </Button>
          )}
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

        {dialogue && safeDialogueSpeakers.length > 0 && (
          <div className="border-hairline mt-1 border-t pt-2">
            <span className="text-muted-foreground text-xs font-medium">Dialogue Speakers</span>
            <div className="mt-1 flex flex-col gap-1">
              {safeDialogueSpeakers.map((sp) => {
                const sv = sp.voice_settings;
                const provider = sp.provider ?? providerForModel(sp.model_id);
                const service = pgItem?.connection ?? entry.template?.draft.connection;
                const tuningParts = recordedVoiceSettings(provider, sv ?? {}, "Not recorded")
                  .filter((row) => row.value !== "Not recorded")
                  .map((row) => `${row.label}: ${row.value}`);
                return (
                  <div
                    key={sp.name}
                    className="bg-surface-subtle flex flex-wrap items-center justify-between gap-1 rounded px-2 py-1 text-xs"
                  >
                    <span className="text-foreground font-semibold">{sp.name}</span>
                    <span className="text-muted-foreground font-mono">
                      {sp.voice_name || sp.voice_id} ·{" "}
                      {service === "google"
                        ? "Google Gemini"
                        : service === "elevenlabs"
                          ? "ElevenLabs direct"
                          : provider === "minimax"
                            ? "MiniMax"
                            : provider === "capcut"
                              ? "CapCut"
                              : "ElevenLabs"}{" "}
                      · {sp.model_id || "eleven_v4"}
                      {sp.language_code ? ` · ${sp.language_code}` : ""}
                      {tuningParts.length ? ` · ${tuningParts.join(" · ")}` : ""}
                      {sp.speech_style ? ` · ${sp.speech_style}` : ""}
                    </span>
                    <div className="flex min-w-0 items-center gap-1">
                      <code className="text-muted-foreground min-w-0 break-all">{sp.voice_id}</code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Copy voice ID for ${sp.name}`}
                        onClick={() => void handleCopy(sp.voice_id, `${sp.name}'s voice ID`)}
                      >
                        <Copy className="size-3" />
                      </Button>
                    </div>
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
              onSendToTts={(text) => {
                switchPlaygroundTool("tts");
                setComposerDraft({ text });
                setPlaygroundSubTab("create");
              }}
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
