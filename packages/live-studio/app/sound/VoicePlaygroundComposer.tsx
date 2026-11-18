import {
  Bookmark,
  Captions,
  ChevronDown,
  FileText,
  Headphones,
  ListPlus,
  Loader2,
  MessagesSquare,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Wand2,
} from "lucide-react";
import {
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { providerLanguageOptions } from "../../src/voice-playground-providers.mjs";
import type { PlaygroundConnection, PlaygroundModelInfo } from "../../src/voice-playground.mjs";
import { Tip } from "../components/Tip";
import { listening, subscribeAudition } from "./sound";
import {
  browseCastingVoices,
  cloneVoiceOption,
  duplicateEntryToComposer,
  generateFromComposer,
  launchReviewedSpeech,
  loadMoreSharedVoices,
  loadSpeechCatalog,
  openSpeechComparison,
  previewCastingVoice,
  resetComposerDraft,
  restorePreviousComposerDraft,
  reviewGenVoiceSpeech,
  saveUploadedVoiceSource,
  searchLiveSharedVoices,
  selectComposerVoice,
  selectSpeechConnection,
  setComposerDraft,
  setPlaygroundScope,
  setPlaygroundSubTab,
  type SpeechReview,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import { PLAYGROUND_MODE_PRESENTATION } from "./voice-playground-presentation";
import { quoteGeneration } from "./voice-playground-pricing";
import {
  castingAuditionId,
  dialogueServiceModels,
  nextTabId,
  parseDialogueTurnNames,
  resolveModeModelId,
  snapToDiscreteValue,
  stripDialogueSpeakerBrackets,
  type UnifiedPlaygroundEntry,
  visibleSpeechModel,
} from "./voice-playground-view";
import {
  AUDIO_TAG_CATEGORIES,
  type AudioTagCategory,
  composerAudioTags,
  insertAudioTagAtSelection,
} from "./voice-tags";
import { type VoiceTakeItem } from "./voice-view";
import { DialogueSpeakersPanel } from "./VoiceDialogueSpeakers";
import { VoiceGenerationPrice } from "./VoiceGenerationPrice";
import { buildFilmTakeAudioOptions, parseTakeRef } from "./VoicePlaygroundAudioSource";
import { VoicePlaygroundJobQueue } from "./VoicePlaygroundJobQueue";
import { VoicePlaygroundKeyPopover } from "./VoicePlaygroundKeyPopover";
import { VoicePlaygroundSaveTemplate } from "./VoicePlaygroundSaveTemplate";
import { SttTranscriptionPanel, VoiceChangerPanel } from "./VoicePlaygroundSecondaryModes";
import { VoicePlaygroundVoicePicker } from "./VoicePlaygroundVoicePicker";
import { SliderSettingRow } from "./VoiceSettingSlider";
import {
  VoicePaidActionConfirmation,
  VoiceSpeechConfirmation,
  voiceBillingNotice,
} from "./VoiceSpeechConfirmation";

const MODE_OPTIONS = [
  { id: "tts", label: "Text to Speech", icon: Sparkles },
  { id: "dialogue", label: "Dialogue", icon: MessagesSquare },
  { id: "voice_changer", label: "Voice Changer", icon: Wand2 },
  { id: "stt", label: "Transcribe STT", icon: Captions },
] as const;

const STABILITY_PRESETS = [
  { value: 0, label: "Creative (0.0)" },
  { value: 0.5, label: "Natural (0.5)" },
  { value: 1, label: "Robust (1.0)" },
] as const;

const OUTPUT_FORMAT_ITEMS = [
  { value: "__default__", label: "Default (MP3 44.1kHz)" },
  { value: "mp3_44100_128", label: "MP3 44.1kHz · 128kbps" },
  { value: "mp3_44100_192", label: "MP3 44.1kHz · 192kbps" },
  { value: "pcm_44100", label: "WAV (PCM 44.1kHz)" },
  { value: "pcm_24000", label: "WAV (PCM 24kHz)" },
] as const;

const TEXT_NORM_ITEMS = [
  { value: "auto", label: "Auto (default)" },
  { value: "on", label: "On (normalize numbers)" },
  { value: "off", label: "Off (literal text)" },
] as const;

const SERVICE_ITEMS = [
  { value: "genvoice", label: "GenVoice" },
  { value: "elevenlabs", label: "ElevenLabs direct" },
  { value: "google", label: "Google Gemini" },
] as const;

export function VoicePlaygroundComposer({
  pg,
  unifiedEntries,
  filmTakes,
  compact = false,
  modeTabRef,
  showModeSwitcher = true,
  showJobQueue = true,
  showSttResult = true,
}: {
  pg: VoicePlaygroundClientState;
  unifiedEntries: readonly UnifiedPlaygroundEntry[];
  filmTakes: readonly VoiceTakeItem[];
  compact?: boolean;
  modeTabRef?: RefObject<HTMLButtonElement | null>;
  showModeSwitcher?: boolean;
  showJobQueue?: boolean;
  showSttResult?: boolean;
}) {
  const { draft, jobs, busyAction, sharedSearch, status } = pg;
  const connection =
    draft.mode === "tts" || draft.mode === "dialogue"
      ? (draft.connection ?? "genvoice")
      : "genvoice";
  const google = connection === "google";
  const direct = connection !== "genvoice";
  const genVoiceSpeech = draft.mode === "tts" && !direct;
  const sceneOutputSettings = draft.mode === "dialogue" && connection === "elevenlabs";
  const showAdvanced = sceneOutputSettings || (draft.mode !== "dialogue" && !google);
  const outputFormats =
    draft.outputFormat && !OUTPUT_FORMAT_ITEMS.some(({ value }) => value === draft.outputFormat)
      ? [...OUTPUT_FORMAT_ITEMS, { value: draft.outputFormat, label: draft.outputFormat }]
      : OUTPUT_FORMAT_ITEMS;
  const serviceCatalog = direct ? pg.serviceCatalogs?.[connection] : undefined;
  const catalog = serviceCatalog ?? pg.catalog;
  const connected = direct
    ? Boolean(status.connections?.[connection]?.configured)
    : status.configured;
  useEffect(() => {
    if (connection !== "genvoice") void loadSpeechCatalog(connection);
  }, [connection]);
  const modePresentation = PLAYGROUND_MODE_PRESENTATION[draft.mode];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generateRef = useRef<HTMLButtonElement>(null);
  const reviewing = useRef(false);
  const [keyboardReview, setKeyboardReview] = useState(false);
  const [keyboardFee, setKeyboardFee] = useState(false);
  const [speechReview, setSpeechReview] = useState<SpeechReview | null>(null);
  const [reviewPaidAction, setReviewPaidAction] = useState(false);
  const [checkingQuote, setCheckingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const playing = useSyncExternalStore(subscribeAudition, listening, listening);
  const sample = draft.voicePreviewUrl
    ? {
        id: draft.voiceId,
        name: draft.voiceName,
        category: "custom",
        provider: draft.provider,
        previewUrl: draft.voicePreviewUrl,
        connection,
      }
    : [
        ...(catalog?.defaultVoices ?? []),
        ...(pg.clones?.flatMap((clone) => cloneVoiceOption(clone) ?? []) ?? []),
        ...(pg.favoriteVoices ?? []),
        ...(pg.sharedSearch?.voices ?? []),
      ].find(
        (voice) =>
          voice.id === draft.voiceId &&
          (voice.connection ?? "genvoice") === connection &&
          (!draft.provider || (voice.provider ?? "elevenlabs") === draft.provider) &&
          voice.previewUrl,
      );
  const samplePlaying = Boolean(sample && playing === castingAuditionId(sample));
  const modeTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const uid = useId();

  const [tagCategory, setTagCategory] = useState<AudioTagCategory["id"]>("emotion");
  const [tagPaletteOpen, setTagPaletteOpen] = useState(false);
  const [customTag, setCustomTag] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const hasMetaDraft = Boolean(draft.title || draft.notes);
  const hasAdvancedDraft = Boolean(
    draft.previousText ||
    draft.nextText ||
    draft.seedText ||
    draft.outputFormat ||
    draft.applyTextNormalization !== "auto",
  );
  const [metaOpen, setMetaOpen] = useState(hasMetaDraft);
  const [advancedOpen, setAdvancedOpen] = useState(hasAdvancedDraft);
  const [prevDraftVersion, setPrevDraftVersion] = useState(pg.draftVersion);
  const [uploadedAudio, setUploadedAudio] = useState<File | null>(null);

  if (prevDraftVersion !== pg.draftVersion) {
    setPrevDraftVersion(pg.draftVersion);
    setUploadedAudio(null);
    setAdvancedOpen(hasAdvancedDraft);
    setMetaOpen(hasMetaDraft);
  }

  const nativeProvider = draft.provider === "minimax" || draft.provider === "capcut";
  const modeModels = useMemo(() => {
    if (direct)
      return draft.mode === "dialogue"
        ? dialogueServiceModels(connection, serviceCatalog?.models ?? [])
        : (serviceCatalog?.models ?? []);
    const filtered = catalog.models.filter((m) =>
      draft.mode === "voice_changer"
        ? m.can_do_voice_conversion
        : m.can_do_text_to_speech &&
          (m.provider ?? "elevenlabs") === (draft.provider ?? "elevenlabs"),
    );
    return filtered.length ? filtered : catalog.models;
  }, [catalog.models, draft.mode, draft.provider, direct, serviceCatalog, connection]);

  const activeModel: PlaygroundModelInfo | undefined = useMemo(
    () => visibleSpeechModel(modeModels, draft.modelId),
    [modeModels, draft.modelId],
  );

  const languageOptions = useMemo(
    () => providerLanguageOptions(draft.provider ?? "elevenlabs", catalog, activeModel),
    [draft.provider, catalog, activeModel],
  );

  const savedTemplates = useMemo(
    () =>
      unifiedEntries
        .filter(
          (e) =>
            (e.isTemplate || e.favorite) &&
            !e.template?.archivedAt &&
            !e.playgroundItem?.archivedAt,
        )
        .slice(0, 20),
    [unifiedEntries],
  );

  const activeCategoryTags = useMemo(
    () =>
      tagSearch.trim()
        ? AUDIO_TAG_CATEGORIES.flatMap((category) => category.tags).filter((tag) =>
            `${tag.tag} ${tag.label} ${tag.hint}`
              .toLowerCase()
              .includes(tagSearch.toLowerCase().trim()),
          )
        : (AUDIO_TAG_CATEGORIES.find((c) => c.id === tagCategory)?.tags ?? []),
    [tagCategory, tagSearch],
  );

  const composerError = pg.composerError?.mode === draft.mode ? pg.composerError.message : null;

  const stsSourceTake = parseTakeRef(draft.vcSourceTakeValue);

  const filmTakeAudioOptions = useMemo(() => buildFilmTakeAudioOptions(filmTakes), [filmTakes]);

  const modelItems = useMemo(
    () => modeModels.map((m) => ({ value: m.model_id, label: m.name })),
    [modeModels],
  );
  const languageItems = useMemo(
    () => [
      { value: "__auto__", label: "Auto Detect" },
      ...languageOptions.map((l) => ({
        value: l.code,
        label: l.name === l.code ? l.name : `${l.name} (${l.code})`,
      })),
    ],
    [languageOptions],
  );

  const insertTag = (rawTag: string) => {
    const el = textareaRef.current;
    const selStart = el?.selectionStart ?? draft.text.length;
    const selEnd = el?.selectionEnd ?? draft.text.length;
    const next = insertAudioTagAtSelection(draft.text, selStart, selEnd, rawTag);
    setComposerDraft({ text: next.text });
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const handleModeSwitch = (nextMode: (typeof MODE_OPTIONS)[number]["id"]) => {
    setComposerDraft({
      mode: nextMode,
      ...(nextMode !== "stt"
        ? { modelId: resolveModeModelId(nextMode, draft.modelId, catalog.models, draft.provider) }
        : {}),
    });
  };

  const quote = useMemo(
    () =>
      quoteGeneration(
        direct
          ? {
              ...draft,
              modelId: activeModel?.model_id ?? draft.modelId,
              speakers: draft.speakers.map((sp) => ({
                ...sp,
                modelId: activeModel?.model_id ?? draft.modelId,
              })),
            }
          : draft,
        direct ? modeModels : catalog.models,
      ),
    [draft, catalog.models, direct, modeModels, activeModel],
  );

  const seedTrimmed = draft.seedText.trim();
  const seedInvalid =
    seedTrimmed.length > 0 && !(/^\d+$/.test(seedTrimmed) && Number(seedTrimmed) <= 4294967295);

  const dialogueValidation = useMemo(() => {
    if (draft.mode !== "dialogue") {
      return { valid: true, reason: "", canQuickFormat: false };
    }
    const trimmedNames = draft.speakers.map((s) => s.name.trim());
    const uniqueNames = new Set(trimmedNames.filter(Boolean));
    const hasDuplicateOrEmpty =
      trimmedNames.some(
        (n) => !n || n === "__proto__" || n === "constructor" || n === "prototype",
      ) || uniqueNames.size !== draft.speakers.length;
    if (draft.speakers.length < 2) {
      return {
        valid: false,
        reason: "Dialogue requires at least 2 speakers.",
        canQuickFormat: false,
      };
    }
    if (
      google &&
      (draft.speakers.length !== 2 || new Set(draft.speakers.map((s) => s.voiceId)).size !== 2)
    ) {
      return {
        valid: false,
        reason: "Gemini needs two speakers with different voices.",
        canQuickFormat: false,
      };
    }
    if (hasDuplicateOrEmpty) {
      return {
        valid: false,
        reason: "Each Dialogue speaker needs a unique non-empty name.",
        canQuickFormat: false,
      };
    }
    if (draft.speakers.some((s) => !s.voiceId.trim())) {
      return {
        valid: false,
        reason: "Pick a voice for every Dialogue speaker.",
        canQuickFormat: false,
      };
    }
    const matchedTurns = parseDialogueTurnNames(draft.text);
    const unknownTurn = matchedTurns.find((name) => !uniqueNames.has(name));
    if (unknownTurn) {
      return {
        valid: false,
        reason: `"${unknownTurn}" has lines in the script. Add that speaker or edit the lines.`,
        canQuickFormat: false,
      };
    }
    if (matchedTurns.length < 2) {
      return {
        valid: false,
        reason: `Include "${trimmedNames[0]}: ..." and "${trimmedNames[1]}: ..." turns matching your speakers.`,
        canQuickFormat: Boolean(draft.text.trim()),
      };
    }
    return { valid: true, reason: "", canQuickFormat: false };
  }, [draft.mode, draft.speakers, draft.text, google]);

  const ttsMaxChars = activeModel?.maximum_text_length_per_request ?? 0;
  const ttsOverLimit = draft.mode === "tts" && ttsMaxChars > 0 && draft.text.length > ttsMaxChars;
  const contextLimit =
    connection === "elevenlabs" && activeModel?.model_id === "eleven_v4" ? 100 : undefined;
  const contextInvalid =
    contextLimit !== undefined &&
    (draft.previousText.trim().length > contextLimit ||
      draft.nextText.trim().length > contextLimit);

  const canSubmitGeneration = useMemo(() => {
    if (
      busyAction === "generate" ||
      busyAction === "stt" ||
      busyAction === "source" ||
      seedInvalid ||
      contextInvalid
    )
      return false;
    if (draft.mode === "tts") {
      return (
        (!direct || connected) &&
        !ttsOverLimit &&
        draft.text.trim().length > 0 &&
        draft.voiceId.trim().length > 0
      );
    }
    if (draft.mode === "dialogue") {
      return (
        (!direct || (connected && Boolean(activeModel))) &&
        draft.text.trim().length > 0 &&
        dialogueValidation.valid
      );
    }
    if (draft.mode === "voice_changer") {
      if (!draft.voiceId.trim()) return false;
      if (draft.vcSourceKind === "upload")
        return uploadedAudio !== null || Boolean(draft.vcSourceFile);
      if (draft.vcSourceKind === "playground") return Boolean(draft.vcSourceItemId);
      return Boolean(stsSourceTake);
    }
    return false;
  }, [
    busyAction,
    activeModel,
    contextInvalid,
    connected,
    direct,
    seedInvalid,
    ttsOverLimit,
    draft.mode,
    draft.text,
    draft.voiceId,
    dialogueValidation.valid,
    draft.vcSourceKind,
    draft.vcSourceFile,
    draft.vcSourceItemId,
    uploadedAudio,
    stsSourceTake,
  ]);

  const handleGenerate = (viaKeyboard = true) => {
    if (!canSubmitGeneration || reviewPaidAction) return;
    setKeyboardReview(viaKeyboard);
    if (genVoiceSpeech) {
      if (reviewing.current || speechReview) return;
      reviewing.current = true;
      setCheckingQuote(true);
      setQuoteError("");
      void reviewGenVoiceSpeech([])
        .then(setSpeechReview)
        .catch((error: unknown) =>
          setQuoteError(
            error instanceof TypeError
              ? "Couldn't get the estimate. Reconnect to Studio, then select Generate speech again."
              : error instanceof Error
                ? error.message
                : "Couldn't get the estimate. Select Generate speech to retry.",
          ),
        )
        .finally(() => {
          reviewing.current = false;
          setCheckingQuote(false);
        });
      return;
    }
    setReviewPaidAction(true);
  };

  const confirmPaidAction = () => {
    if (!canSubmitGeneration) return;
    if (draft.mode === "voice_changer") {
      void generateFromComposer({
        audioFile: draft.vcSourceKind === "upload" && !draft.vcSourceFile ? uploadedAudio : null,
        sourceItemId: draft.vcSourceKind === "playground" ? draft.vcSourceItemId : undefined,
        sourceTakeKind: draft.vcSourceKind === "film_take" ? stsSourceTake?.kind : undefined,
        sourceTakeFile: draft.vcSourceKind === "film_take" ? stsSourceTake?.file : undefined,
      });
      return;
    }
    void generateFromComposer();
  };

  const speakerBoostId = `${uid}-speaker-boost`;
  const exportSrtId = `${uid}-export-srt`;
  const tagCapabilities = composerAudioTags(
    direct && draft.mode === "dialogue"
      ? {
          ...draft,
          speakers: draft.speakers.map((sp) => ({
            ...sp,
            modelId: activeModel?.model_id ?? draft.modelId,
          })),
        }
      : draft,
  );
  const nonTagDialogueSpeaker = draft.speakers.find(
    (speaker) => speaker.name.trim() === tagCapabilities.unsupportedSpeakers[0],
  );

  return (
    <div className={cn("flex flex-col text-sm", compact ? "gap-3" : "h-full min-h-0")}>
      <div
        onFocusCapture={(event) => event.target.scrollIntoView?.({ block: "nearest" })}
        className={cn(
          "grid min-w-0 grid-cols-1 content-start items-start gap-3",
          !compact && "min-h-0 flex-1 scroll-py-3 overflow-y-auto overscroll-contain p-3.5",
          !compact &&
            (draft.mode === "tts" || draft.mode === "dialogue") &&
            "@[80rem]/voice-workbench:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] @[80rem]/voice-workbench:[&>:not([data-composer-column])]:col-span-full",
        )}
      >
        {/* Mode Switcher + Template Quick Loader */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {showModeSwitcher && (
            <div
              role="tablist"
              aria-label="Playground generation mode"
              className="grid w-full grid-cols-2 gap-1 rounded-lg"
            >
              {MODE_OPTIONS.map(({ id, label, icon: Icon }, idx) => {
                const active = draft.mode === id;
                const presentation = PLAYGROUND_MODE_PRESENTATION[id];
                return (
                  <button
                    key={id}
                    ref={(el) => {
                      modeTabRefs.current[id] = el;
                      if (idx === 0 && modeTabRef) {
                        (modeTabRef as { current: HTMLButtonElement | null }).current = el;
                      }
                    }}
                    type="button"
                    role="tab"
                    aria-label={label}
                    tabIndex={active ? 0 : -1}
                    aria-selected={active}
                    onKeyDown={(e) => {
                      const next = nextTabId(
                        MODE_OPTIONS.map((m) => m.id),
                        draft.mode,
                        e.key,
                      );
                      if (!next) return;
                      e.preventDefault();
                      handleModeSwitch(next);
                      modeTabRefs.current[next]?.focus();
                    }}
                    onClick={() => handleModeSwitch(id)}
                    className={cn(
                      "focus-visible:ring-ring inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2 py-2 text-start text-sm font-semibold transition-colors outline-none focus-visible:ring-2",
                      active
                        ? presentation.selected
                        : cn(
                            presentation.panel,
                            "text-foreground/85 hover:bg-raised-3 hover:text-foreground",
                          ),
                    )}
                  >
                    <Icon className={cn("size-3.5 flex-none", presentation.text)} />
                    <span className="min-w-0 leading-snug">
                      {compact || id === "stt" ? presentation.shortLabel : label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1">
            <VoicePlaygroundSaveTemplate pg={pg} />
            {savedTemplates.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto min-h-6 max-w-44 text-start whitespace-normal"
                    />
                  }
                >
                  <Bookmark className="text-primary-text size-3 shrink-0" />
                  <span className="min-w-0 wrap-anywhere">Load template…</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  motion="none"
                  align="start"
                  className="max-h-64 overflow-y-auto"
                >
                  <DropdownMenuGroup>
                    {savedTemplates.map((tpl) => (
                      <DropdownMenuItem
                        key={tpl.uid}
                        className="justify-between"
                        onClick={() => duplicateEntryToComposer(tpl)}
                      >
                        <span className="truncate">
                          {tpl.isTemplate ? `★ ${tpl.templateName || tpl.title}` : tpl.title}
                        </span>
                        <span className="text-muted-foreground ms-3 shrink-0 text-xs">
                          {(tpl.template?.scope ??
                            tpl.playgroundItem?.scope ??
                            tpl.sourceRecording?.scope) === "global"
                            ? "Global"
                            : "Project"}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {pg.previousComposerDraft?.draft.mode === draft.mode && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={restorePreviousComposerDraft}
              >
                Restore previous draft
              </Button>
            )}
            {draft.mode === "tts" && pg.speechReviewBatchId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openSpeechComparison(pg.speechReviewBatchId)}
              >
                Back to comparison
              </Button>
            )}
            <Tip label="Reset composer settings to defaults">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Reset composer defaults"
                onClick={() => {
                  setUploadedAudio(null);
                  resetComposerDraft(draft.mode);
                }}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </Tip>
          </div>
        </div>

        {draft.mode === "tts" && pg.speechReviewBatchId && (
          <p className="text-reading-foreground max-w-[60ch] text-sm leading-relaxed text-pretty">
            Choose another voice for this script, or try this voice again later. Generating another
            take may cost credits.
          </p>
        )}

        {(draft.mode === "tts" || draft.mode === "dialogue") && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-48 flex-col gap-1">
              <label
                htmlFor={`${uid}-service`}
                className="text-muted-foreground text-xs font-medium"
              >
                {draft.mode === "dialogue" ? "Dialogue service" : "Speech service"}
              </label>
              <Select
                items={SERVICE_ITEMS}
                value={connection}
                onValueChange={(value) =>
                  value && selectSpeechConnection(value as PlaygroundConnection)
                }
              >
                <SelectTrigger size="readable" id={`${uid}-service`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent finalFocus>
                  <SelectGroup>
                    {SERVICE_ITEMS.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {direct && (
              <VoicePlaygroundKeyPopover
                key={connection}
                connection={connection}
                status={status}
                busyAction={busyAction}
              />
            )}
            {direct && serviceCatalog?.error && (
              <p role="status" className="text-warn-text text-xs">
                {serviceCatalog.error}
              </p>
            )}
            {direct && draft.mode === "dialogue" && (
              <Field className="w-60">
                <FieldLabel htmlFor={`${uid}-scene-model`}>Scene model</FieldLabel>
                <Select
                  items={modelItems}
                  value={activeModel?.model_id ?? null}
                  disabled={modeModels.length === 0}
                  onValueChange={(value) => value && setComposerDraft({ modelId: value })}
                >
                  <SelectTrigger size="readable" id={`${uid}-scene-model`}>
                    <SelectValue placeholder="No model available" />
                  </SelectTrigger>
                  <SelectContent finalFocus>
                    <SelectGroup>
                      {modelItems.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
            {connection === "elevenlabs" && draft.mode === "dialogue" && (
              <Field className="w-44">
                <FieldLabel htmlFor={`${uid}-scene-language`}>Spoken language</FieldLabel>
                <Select
                  items={languageItems}
                  value={
                    !draft.languageCode || draft.languageCode === "auto"
                      ? "__auto__"
                      : draft.languageCode
                  }
                  onValueChange={(value) =>
                    setComposerDraft({ languageCode: value === "__auto__" ? "" : (value ?? "") })
                  }
                >
                  <SelectTrigger size="readable" id={`${uid}-scene-language`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent finalFocus>
                    {languageItems.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {google && draft.mode === "dialogue" && (
              <p className="text-muted-foreground text-xs">
                Gemini uses two speakers. When a service has a different cast, its script and cast
                are saved together.
              </p>
            )}
            {connection === "elevenlabs" &&
              draft.mode === "dialogue" &&
              quote.rows.reduce((total, role) => total + role.characters, 0) > 2000 && (
                <p className="text-muted-foreground text-xs">
                  For reliable results, ElevenLabs recommends scenes of up to 2,000 spoken
                  characters.
                </p>
              )}
          </div>
        )}

        {/* TTS & Voice Changer Voice + Model + Language Row */}
        {(draft.mode === "tts" || draft.mode === "voice_changer") && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 @[56rem]/voice-workbench:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)]">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs font-medium">
                {draft.mode === "voice_changer" ? "Voice" : "Voice & source"}
              </span>
              <div className="flex min-w-0 items-center gap-2">
                <VoicePlaygroundVoicePicker
                  key={connection}
                  connection={connection}
                  onBrowseAll={() =>
                    browseCastingVoices({
                      mode: draft.mode === "voice_changer" ? "voice_changer" : "tts",
                    })
                  }
                  selectedId={draft.voiceId}
                  selectedName={draft.voiceName}
                  defaultVoices={
                    direct ? (serviceCatalog?.defaultVoices ?? []) : catalog.defaultVoices
                  }
                  sharedSearch={sharedSearch}
                  configured={connected}
                  onSearchShared={searchLiveSharedVoices}
                  onLoadMoreShared={() => void loadMoreSharedVoices()}
                  selectedProvider={draft.provider}
                  allowedProviders={draft.mode === "voice_changer" ? ["elevenlabs"] : undefined}
                  onSelect={selectComposerVoice}
                  fullWidth
                />
                {draft.mode === "tts" && (
                  <Button
                    type="button"
                    size="sm"
                    variant={samplePlaying ? "lit" : "secondary"}
                    className="flex-none"
                    disabled={!sample}
                    aria-pressed={samplePlaying}
                    onClick={() => sample && previewCastingVoice(sample)}
                  >
                    <Headphones />{" "}
                    {samplePlaying ? "Pause sample" : sample ? "Free sample" : "No sample"}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs font-medium">Model</span>
              <Select
                items={modelItems}
                value={activeModel?.model_id ?? draft.modelId}
                onValueChange={(v) => {
                  if (!v) return;
                  const nextM = catalog.models.find((m) => m.model_id === v);
                  const nextPatch: Partial<typeof draft> = { modelId: v };
                  if (nextM?.stability_values?.length) {
                    nextPatch.stability = snapToDiscreteValue(
                      draft.stability,
                      nextM.stability_values,
                    );
                  }
                  setComposerDraft(nextPatch);
                }}
              >
                <SelectTrigger
                  size="readable"
                  className="w-full"
                  aria-label={direct ? "Speech model" : "Select GenVoice model"}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent finalFocus>
                  {modeModels.map((m) => (
                    <SelectItem key={m.model_id} value={m.model_id}>
                      <span className="flex items-center gap-2">
                        <span>{m.name}</span>
                        <span className="text-muted-foreground font-mono text-xs">
                          {m.model_id} ·{" "}
                          {m.model_rates.character_cost_multiplier === undefined
                            ? "unverified rate"
                            : `${m.model_rates.character_cost_multiplier}×`}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeModel && (
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {activeModel.model_rates.character_cost_multiplier === undefined
                    ? "Model rate unverified"
                    : `${activeModel.model_rates.character_cost_multiplier}× model rate`}
                  {draft.mode !== "voice_changer" &&
                    (activeModel.maximum_text_length_per_request === undefined
                      ? " · Character limit not reported"
                      : ` · ${activeModel.maximum_text_length_per_request.toLocaleString()} characters max`)}
                </span>
              )}
            </div>

            {draft.mode !== "voice_changer" && !google && (
              <div className="flex flex-col gap-1 sm:col-span-2 @[56rem]/voice-workbench:col-span-1">
                <span className="text-muted-foreground text-xs font-medium">Language</span>
                <Select
                  items={languageItems}
                  value={draft.languageCode || "__auto__"}
                  onValueChange={(v) =>
                    setComposerDraft({ languageCode: !v || v === "__auto__" ? "" : v })
                  }
                >
                  <SelectTrigger size="readable" className="w-full" aria-label="Language code">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent finalFocus>
                    <SelectItem value="__auto__">Auto Detect</SelectItem>
                    {languageOptions.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.name}
                        {l.name === l.code ? "" : ` (${l.code})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Dialogue Speakers Mapping */}
        {draft.mode === "dialogue" && (
          <DialogueSpeakersPanel
            draft={draft}
            pg={pg}
            onFocusScript={() => requestAnimationFrame(() => textareaRef.current?.focus())}
          />
        )}

        {/* Voice Changer Source Input */}
        {draft.mode === "voice_changer" && (
          <VoiceChangerPanel
            pg={pg}
            filmTakeOptions={filmTakeAudioOptions}
            sourceKind={draft.vcSourceKind}
            onSourceKindChange={(next) => setComposerDraft({ vcSourceKind: next })}
            uploadedAudio={uploadedAudio}
            onUploadedAudioChange={(file) => {
              setUploadedAudio(file);
              setComposerDraft({ vcSourceFile: "" });
              if (file) void saveUploadedVoiceSource(file);
            }}
            sourcePlaygroundId={draft.vcSourceItemId}
            onSourcePlaygroundIdChange={(id) => setComposerDraft({ vcSourceItemId: id })}
            sourceTakeValue={draft.vcSourceTakeValue}
            onSourceTakeValueChange={(val) => setComposerDraft({ vcSourceTakeValue: val })}
          />
        )}

        {/* Script / Prompt Box + Eleven v4/v3 Audio Tags Toolbar */}
        {(draft.mode === "tts" || draft.mode === "dialogue") && (
          <div data-composer-column="" className="flex min-w-0 flex-col gap-1.5">
            <div
              className={cn(
                "flex items-center justify-between gap-2",
                !compact && "max-w-[60ch] text-base",
              )}
            >
              <label
                htmlFor={`${uid}-script`}
                className={cn("text-sm font-semibold", modePresentation.text)}
              >
                {draft.mode === "dialogue"
                  ? google
                    ? "Dialogue script"
                    : "Dialogue Script & Audio Tags"
                  : nativeProvider || google
                    ? "Script"
                    : "Prompt & [Audio Tags]"}
              </label>
              <span
                className={cn(
                  "font-mono text-xs tabular-nums",
                  ttsOverLimit ? "text-warn-text font-semibold" : "text-muted-foreground",
                )}
              >
                {draft.text.length.toLocaleString()}
                {draft.mode === "tts" && ttsMaxChars > 0
                  ? ` / ${ttsMaxChars.toLocaleString()}`
                  : ""}{" "}
                chars
              </span>
            </div>

            <Textarea
              id={`${uid}-script`}
              dir="auto"
              variant={compact ? "default" : "script"}
              ref={textareaRef}
              rows={compact ? 3 : 7}
              value={draft.text}
              onChange={(e) => setComposerDraft({ text: e.target.value })}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              aria-invalid={ttsOverLimit || undefined}
              aria-describedby={ttsOverLimit ? `${uid}-tts-limit-err` : undefined}
              placeholder={
                draft.mode === "dialogue"
                  ? google
                    ? "Alex: Did you hear that?\nRiley: <short pause> Don't move!"
                    : "Alex: [whispers] Did you hear that?\nRiley: [gasps, panicking] Don't move!"
                  : nativeProvider || google
                    ? "Keep moving before the door locks right behind us."
                    : "[whispers, anxious] Keep moving before the door locks [short pause] right behind us."
              }
              className={compact ? "min-h-20" : "min-h-44 max-w-[60ch]"}
            />

            {ttsOverLimit && (
              <p id={`${uid}-tts-limit-err`} role="alert" className="text-warn-text text-xs">
                Script exceeds {activeModel?.name ?? draft.modelId} limit (
                {draft.text.length.toLocaleString()} / {ttsMaxChars.toLocaleString()} chars). Split
                into chunks or switch models.
              </p>
            )}

            {draft.mode === "dialogue" && !dialogueValidation.valid && (
              <div className="border-warn/30 bg-warn-bg/60 text-warn-text flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                <span>{dialogueValidation.reason}</span>
                {dialogueValidation.canQuickFormat && draft.speakers.length >= 2 && (
                  <Button
                    type="button"
                    variant="warn"
                    size="sm"
                    onClick={() => {
                      const s1 = draft.speakers[0]!.name.trim() || "Speaker 1";
                      const s2 = draft.speakers[1]!.name.trim() || "Speaker 2";
                      const lines = stripDialogueSpeakerBrackets(draft.text)
                        .split(/\r?\n/)
                        .map((l) => l.trim())
                        .filter(Boolean);
                      const formatted =
                        lines.length >= 2
                          ? lines
                              .map((l, i) =>
                                /^[ \t]*[^:\r\n]{1,80}:/.test(l)
                                  ? l
                                  : `${i % 2 === 0 ? s1 : s2}: ${l}`,
                              )
                              .join("\n")
                          : `${s1}: ${lines[0] || "Line one."}\n${s2}: Respond here.`;
                      setComposerDraft({ text: formatted });
                    }}
                  >
                    Format as {draft.speakers[0]!.name.trim() || "Speaker 1"} /{" "}
                    {draft.speakers[1]!.name.trim() || "Speaker 2"}
                  </Button>
                )}
              </div>
            )}

            {!google && tagCapabilities.unsupportedTts && !nativeProvider && (
              <div className="border-warn/30 bg-warn-bg/60 text-warn-text flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                <span>
                  <code className="font-mono">{draft.modelId}</code> speaks bracketed tags aloud.
                  Switch to Eleven v4/v3 to perform <code className="font-mono">[tags]</code>.
                </span>
                <Button
                  type="button"
                  variant="warn"
                  size="sm"
                  onClick={() => setComposerDraft({ modelId: "eleven_v4" })}
                >
                  Use eleven_v4
                </Button>
              </div>
            )}

            {nonTagDialogueSpeaker && (
              <div className="border-warn/30 bg-warn-bg/60 text-warn-text flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                <span>
                  Speaker <span className="font-semibold">{nonTagDialogueSpeaker.name}</span> uses{" "}
                  <code className="font-mono">{nonTagDialogueSpeaker.modelId}</code>, which has no
                  verified support for ElevenLabs bracketed audio tags.
                </span>
              </div>
            )}

            {/* Eleven v4 / v3 Interactive Audio Tags Palette */}
            {!google && tagCapabilities.showPalette && (
              <Card size="sm" tone="ai">
                <Collapsible open={tagPaletteOpen} onOpenChange={setTagPaletteOpen}>
                  <CollapsibleTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full justify-between"
                      />
                    }
                  >
                    <span className="flex items-center gap-1.5">
                      <Tag className="text-ai-text size-3.5" />
                      Audio tags & emotions
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-3.5",
                        tagPaletteOpen && "rotate-180",
                      )}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="flex flex-col gap-1.5 p-2">
                      <Input
                        type="search"
                        size="sm"
                        aria-label="Search audio tag suggestions"
                        value={tagSearch}
                        onChange={(event) => setTagSearch(event.target.value)}
                        placeholder="Find an emotion or delivery style"
                      />
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        Suggestions, not a fixed list. Write any direction in [brackets]; results
                        vary by voice.
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {AUDIO_TAG_CATEGORIES.map((cat) => (
                            <button
                              key={cat.id}
                              type="button"
                              aria-pressed={tagCategory === cat.id}
                              onClick={() => {
                                setTagCategory(cat.id);
                                setTagSearch("");
                              }}
                              className={cn(
                                "focus-visible:ring-ring rounded-md px-2 py-0.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
                                tagCategory === cat.id
                                  ? "bg-tint text-primary-text"
                                  : "text-muted-foreground hover:bg-raised-3 hover:text-foreground",
                              )}
                            >
                              {cat.title}
                            </button>
                          ))}
                        </div>
                        <form
                          className="flex items-center gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!customTag.trim()) return;
                            insertTag(customTag);
                            setCustomTag("");
                          }}
                        >
                          <Input
                            size="sm"
                            value={customTag}
                            onChange={(e) => setCustomTag(e.target.value)}
                            placeholder="Custom [tag]…"
                            aria-label="Custom audio tag"
                            className="w-28"
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            disabled={!customTag.trim()}
                          >
                            <Tag className="size-2.5" />
                            <span>Insert</span>
                          </Button>
                        </form>
                      </div>

                      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto overscroll-contain pt-0.5 pb-1.5">
                        {activeCategoryTags.map((t) => (
                          <Tip key={t.tag} label={t.hint}>
                            <button
                              type="button"
                              onClick={() => insertTag(t.tag)}
                              className="border-hairline bg-card hover:border-primary/45 hover:bg-tint hover:text-primary-text studio-press text-foreground/85 focus-visible:ring-ring rounded border px-1.5 py-0.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2"
                            >
                              [{t.tag}]
                            </button>
                          </Tip>
                        ))}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            )}
            {nativeProvider && tagCapabilities.unsupportedTts && (
              <p className="text-muted-foreground text-xs">
                Bracketed ElevenLabs audio tags are unverified for this source. Use its speed and
                pitch controls; listen to a short take before generating a full scene.
              </p>
            )}
          </div>
        )}

        {/* Dynamic Voice Settings & Advanced Options */}
        {draft.mode !== "stt" && (
          <div
            data-composer-column=""
            className={cn("flex flex-col gap-2.5 rounded-lg border p-3", modePresentation.panel)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn("text-sm font-semibold", modePresentation.text)}>
                {draft.mode === "dialogue" ? "Output & Metadata" : "Voice Settings"}
              </span>
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {showAdvanced && !nativeProvider && (
                  <Button
                    type="button"
                    variant={advancedOpen ? "lit" : "ghost"}
                    size="sm"
                    aria-expanded={advancedOpen}
                    aria-controls={`${uid}-advanced`}
                    onClick={() => setAdvancedOpen((v) => !v)}
                  >
                    <SlidersHorizontal className="size-3" />
                    <span>
                      {draft.mode === "tts"
                        ? "Context, Seed & Format"
                        : sceneOutputSettings
                          ? "Seed & Format"
                          : "Seed & Determinism"}
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-3 transition-transform motion-reduce:transition-none",
                        advancedOpen && "rotate-180",
                      )}
                    />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={metaOpen}
                  aria-controls={`${uid}-metadata`}
                  onClick={() => setMetaOpen((v) => !v)}
                >
                  <FileText className="size-3" />
                  <span>Title & Notes</span>
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform motion-reduce:transition-none",
                      metaOpen && "rotate-180",
                    )}
                  />
                </Button>
              </div>
            </div>

            {google && draft.mode === "tts" && (
              <Field>
                <FieldLabel htmlFor={`${uid}-direction`}>Speech direction</FieldLabel>
                <Textarea
                  id={`${uid}-direction`}
                  rows={2}
                  maxLength={2000}
                  placeholder="Start softly, then build urgency in the last sentence"
                  value={draft.speechStyle ?? ""}
                  aria-describedby={`${uid}-direction-help`}
                  onChange={(event) => setComposerDraft({ speechStyle: event.target.value })}
                />
                <FieldDescription id={`${uid}-direction-help`}>
                  Keep the spoken words in Script. Use {"<laugh>"} or {"<short pause>"} there for
                  brief sounds.
                </FieldDescription>
              </Field>
            )}
            {draft.mode === "dialogue" && connection === "elevenlabs" && (
              <div className="grid grid-cols-2 gap-3">
                <SliderSettingRow
                  label="Scene stability"
                  value={draft.stability}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(stability) => setComposerDraft({ stability })}
                />
                {activeModel?.model_id === "eleven_v4" && (
                  <SliderSettingRow
                    label="Scene similarity"
                    value={draft.similarityBoost}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(similarityBoost) => setComposerDraft({ similarityBoost })}
                  />
                )}
              </div>
            )}
            {draft.mode !== "dialogue" && !google && (
              <>
                {!nativeProvider &&
                  (activeModel?.stability_values?.length ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-foreground/85 text-xs font-medium">
                          Stability (discrete for {activeModel.name})
                        </span>
                        <span className="text-muted-foreground font-mono text-xs tabular-nums">
                          {draft.stability.toFixed(1)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {STABILITY_PRESETS.filter((p) =>
                          activeModel.stability_values?.includes(p.value),
                        ).map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            aria-pressed={Math.abs(draft.stability - preset.value) < 0.05}
                            onClick={() => setComposerDraft({ stability: preset.value })}
                            className={cn(
                              "focus-visible:ring-ring rounded-md border px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
                              Math.abs(draft.stability - preset.value) < 0.05
                                ? "border-primary/50 bg-tint text-primary-text"
                                : "border-hairline bg-card text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <SliderSettingRow
                      label="Stability"
                      hint="Lower = more expressive emotion range; Higher = consistent pacing"
                      value={draft.stability}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => setComposerDraft({ stability: v })}
                    />
                  ))}

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {activeModel?.supports_similarity !== false && (
                    <SliderSettingRow
                      label="Similarity Boost"
                      hint="Adherence to target voice timbre"
                      value={draft.similarityBoost}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => setComposerDraft({ similarityBoost: v })}
                    />
                  )}

                  {draft.mode !== "voice_changer" && activeModel?.supports_speed === true && (
                    <SliderSettingRow
                      label="Speed"
                      hint={
                        nativeProvider
                          ? "Speech rate (0.5 to 2 times)"
                          : "Speech rate (0.7 to 1.2 times)"
                      }
                      value={draft.speed}
                      min={nativeProvider ? 0.5 : 0.7}
                      max={nativeProvider ? 2 : 1.2}
                      step={0.05}
                      formatValue={(v) => `${v.toFixed(2)}×`}
                      onChange={(v) => setComposerDraft({ speed: v })}
                    />
                  )}

                  {nativeProvider && (
                    <SliderSettingRow
                      label="Pitch"
                      formatValue={(v) => `${v} semitones`}
                      hint="Semitones; zero keeps the original pitch"
                      value={draft.pitch ?? 0}
                      min={-12}
                      max={12}
                      step={1}
                      onChange={(pitch) => setComposerDraft({ pitch })}
                    />
                  )}
                  {draft.provider === "minimax" && (
                    <SliderSettingRow
                      label="Volume"
                      hint="Source volume multiplier; high values may clip"
                      value={draft.vol ?? 1}
                      min={0.01}
                      max={10}
                      step={0.01}
                      formatValue={(v) => `${v.toFixed(2)}x`}
                      onChange={(vol) => setComposerDraft({ vol })}
                    />
                  )}
                  {activeModel?.can_use_style && (
                    <SliderSettingRow
                      label="Style Exaggeration"
                      hint="Amplifies speaker delivery style (v2 models)"
                      value={draft.style}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => setComposerDraft({ style: v })}
                    />
                  )}
                </div>
              </>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
              {draft.mode !== "dialogue" && activeModel?.can_use_speaker_boost && (
                <div className="flex items-center gap-2 text-sm">
                  <Switch
                    id={speakerBoostId}
                    size="sm"
                    checked={draft.useSpeakerBoost}
                    onCheckedChange={(v) => setComposerDraft({ useSpeakerBoost: v })}
                  />
                  <label htmlFor={speakerBoostId} className="cursor-pointer">
                    Speaker Boost
                  </label>
                </div>
              )}

              {draft.mode !== "voice_changer" && (
                <div className="flex items-center gap-2 text-sm">
                  <Switch
                    id={exportSrtId}
                    size="sm"
                    checked={!google && draft.exportTranscript}
                    disabled={google}
                    aria-describedby={google || !direct ? `${uid}-timing-help` : undefined}
                    onCheckedChange={(v) => setComposerDraft({ exportTranscript: v })}
                  />
                  <label htmlFor={exportSrtId} className="cursor-pointer">
                    {direct ? "Save word timings" : "Request SRT subtitles"}
                  </label>
                  {google && (
                    <span id={`${uid}-timing-help`} className="text-muted-foreground text-xs">
                      Use Transcribe after generation.
                    </span>
                  )}
                  {!direct && (
                    <span
                      id={`${uid}-timing-help`}
                      className="text-muted-foreground max-w-[55ch] text-xs"
                    >
                      {draft.mode === "tts" && "Adds about 15% to the model estimate. "}
                      GenVoice may return audio without subtitles.
                    </span>
                  )}
                </div>
              )}

              {draft.mode === "tts" && (
                <div className="ms-auto flex items-center gap-1.5">
                  <span className="text-muted-foreground text-xs">Takes</span>
                  <div className="bg-raised-2 inline-flex rounded-md p-0.5">
                    {[1, 2, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={draft.variations === n}
                        onClick={() => setComposerDraft({ variations: n })}
                        className={cn(
                          "focus-visible:ring-ring rounded border-b-2 border-transparent px-2 py-0.5 text-sm font-medium tabular-nums transition-colors outline-none focus-visible:ring-2",
                          draft.variations === n
                            ? "border-primary-text bg-card text-primary-text font-semibold"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {n}×
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Collapsible open={advancedOpen && showAdvanced && !nativeProvider}>
              <CollapsibleContent id={`${uid}-advanced`}>
                <div className="border-hairline flex flex-col gap-2 border-t pt-2">
                  {contextLimit && draft.mode === "tts" && (
                    <p
                      role={contextInvalid ? "alert" : undefined}
                      className={
                        contextInvalid ? "text-warn-text text-xs" : "text-muted-foreground text-xs"
                      }
                    >
                      Eleven v4 allows up to {contextLimit} characters before and after the script.
                    </p>
                  )}
                  {draft.mode === "tts" && activeModel?.supports_context !== false && (
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={`${uid}-prev-text`}
                          className="text-muted-foreground text-xs font-medium"
                        >
                          Previous Text (context stitching)
                        </label>
                        <Textarea
                          id={`${uid}-prev-text`}
                          rows={2}
                          maxLength={contextLimit}
                          value={draft.previousText}
                          onChange={(e) => setComposerDraft({ previousText: e.target.value })}
                          placeholder="Line spoken immediately before this clip…"
                          className="min-h-12"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={`${uid}-next-text`}
                          className="text-muted-foreground text-xs font-medium"
                        >
                          Next Text (prosody continuity)
                        </label>
                        <Textarea
                          id={`${uid}-next-text`}
                          rows={2}
                          maxLength={contextLimit}
                          value={draft.nextText}
                          onChange={(e) => setComposerDraft({ nextText: e.target.value })}
                          placeholder="Line spoken immediately after this clip…"
                          className="min-h-12"
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`${uid}-seed`}
                        className="text-muted-foreground text-xs font-medium"
                      >
                        Seed
                      </label>
                      <Input
                        id={`${uid}-seed`}
                        size="sm"
                        value={draft.seedText}
                        onChange={(e) => setComposerDraft({ seedText: e.target.value })}
                        placeholder="Random or 0–4294967295"
                        aria-label="Generation seed"
                        aria-invalid={seedInvalid || undefined}
                        aria-describedby={seedInvalid ? `${uid}-seed-err` : undefined}
                      />
                      {seedInvalid && (
                        <span
                          id={`${uid}-seed-err`}
                          role="alert"
                          className="text-warn-text text-xs"
                        >
                          Seed must be an integer 0–4294967295
                        </span>
                      )}
                    </div>
                    {(draft.mode === "tts" || sceneOutputSettings) && (
                      <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-xs font-medium">
                          Output Format
                        </span>
                        <Select
                          items={outputFormats}
                          value={draft.outputFormat || "__default__"}
                          onValueChange={(v) =>
                            setComposerDraft({
                              outputFormat: !v || v === "__default__" ? "" : v,
                            })
                          }
                        >
                          <SelectTrigger className="h-7 w-full" aria-label="Output format">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent finalFocus>
                            {outputFormats.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {draft.mode === "tts" && (
                      <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-xs font-medium">
                          Text Normalization
                        </span>
                        <Select
                          items={TEXT_NORM_ITEMS}
                          value={draft.applyTextNormalization}
                          onValueChange={(v) => {
                            if (v === "auto" || v === "on" || v === "off") {
                              setComposerDraft({ applyTextNormalization: v });
                            }
                          }}
                        >
                          <SelectTrigger className="h-7 w-full" aria-label="Text normalization">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent finalFocus>
                            {TEXT_NORM_ITEMS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={metaOpen}>
              <CollapsibleContent id={`${uid}-metadata`}>
                <div className="border-hairline flex flex-col gap-1.5 border-t pt-2">
                  <label
                    htmlFor={`${uid}-title`}
                    className="text-muted-foreground text-xs font-medium"
                  >
                    Experiment title (optional)
                  </label>
                  <Input
                    id={`${uid}-title`}
                    size="sm"
                    value={draft.title}
                    onChange={(e) => setComposerDraft({ title: e.target.value })}
                    placeholder="Custom title for this experiment (optional)"
                    aria-label="Experiment title"
                  />
                  <label
                    htmlFor={`${uid}-notes`}
                    className="text-muted-foreground text-xs font-medium"
                  >
                    Scene notes & acting direction
                  </label>
                  <Textarea
                    id={`${uid}-notes`}
                    rows={2}
                    value={draft.notes}
                    onChange={(e) => setComposerDraft({ notes: e.target.value })}
                    placeholder="Scene notes, acting direction, or usage note…"
                    className="min-h-12"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {/* Speech-to-Text (Scribe v2) Full Panel */}
        {draft.mode === "stt" && (
          <SttTranscriptionPanel
            pg={pg}
            filmTakeOptions={filmTakeAudioOptions}
            showResult={showSttResult}
          />
        )}

        {showJobQueue && <VoicePlaygroundJobQueue jobs={jobs} items={pg.items} />}
        {composerError && (
          <p
            role="alert"
            className="border-warn/40 bg-warn-bg/80 text-warn-text rounded-md border px-2.5 py-1.5 text-sm"
          >
            {composerError}
          </p>
        )}
      </div>
      {draft.mode !== "stt" && (
        <div
          className={cn(
            "border-hairline bg-card grid flex-none items-center gap-2 border-t py-3",
            !compact && "px-3.5 @[56rem]/voice-workbench:grid-cols-[minmax(0,1fr)_auto]",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-reading-foreground text-xs tabular-nums">
              <span className="text-foreground font-semibold">
                {genVoiceSpeech
                  ? status.account?.credit_balance != null
                    ? `${status.account.credit_balance.toLocaleString()} credits available`
                    : "Balance unavailable"
                  : voiceBillingNotice(connection)}
              </span>
              {quote.baseCredits !== null &&
                ` · About ${quote.baseCredits.toLocaleString()} ${connection === "elevenlabs" ? "ElevenLabs" : "model"} credits before voice fees`}
            </p>
            <Popover
              onOpenChange={(open, { event }) => {
                if (open) setKeyboardFee(!(event instanceof MouseEvent) || event.detail === 0);
              }}
            >
              <PopoverTrigger render={<Button type="button" size="sm" variant="outline" />}>
                Fee breakdown
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                motion={keyboardFee ? "none" : "anchored"}
                className="w-80"
              >
                <PopoverTitle>Generation fee</PopoverTitle>
                <div className="mt-2 max-h-80 overflow-y-auto">
                  <VoiceGenerationPrice
                    quote={quote}
                    connection={connection}
                    mode={draft.mode}
                    variations={draft.variations}
                    exportTranscript={draft.exportTranscript}
                  />
                </div>
              </PopoverContent>
            </Popover>

            {genVoiceSpeech && !compact && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setPlaygroundSubTab("compare")}
              >
                <ListPlus /> Compare voices
              </Button>
            )}
          </div>
          {quoteError && (
            <p role="alert" className="text-warn-text col-span-full text-sm">
              {quoteError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs @[56rem]/voice-workbench:col-start-2 @[56rem]/voice-workbench:row-start-1 @[56rem]/voice-workbench:justify-end">
            <label htmlFor={`${uid}-save-scope`}>Save new takes to</label>
            <Select
              items={[
                { value: "project", label: "Project" },
                { value: "global", label: "Global" },
              ]}
              value={pg.scope ?? "project"}
              disabled={Boolean(pg.busyAction)}
              onValueChange={(value) =>
                setPlaygroundScope(value === "global" ? "global" : "project")
              }
            >
              <SelectTrigger id={`${uid}-save-scope`} size="sm" aria-label="Save new takes to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent finalFocus>
                <SelectGroup>
                  <SelectItem value="project">This project</SelectItem>
                  <SelectItem value="global">Global · all projects</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              ref={generateRef}
              type="button"
              size={compact ? "md" : "xl"}
              className="ms-auto @[56rem]/voice-workbench:ms-2"
              disabled={!canSubmitGeneration && busyAction !== "generate"}
              aria-disabled={!canSubmitGeneration || checkingQuote}
              onClick={(event) => handleGenerate(event.detail === 0)}
            >
              {busyAction === "generate" || checkingQuote ? (
                <>
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  <span>{checkingQuote ? "Checking credits…" : "Starting…"}</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  <span>
                    {draft.mode === "dialogue"
                      ? "Generate dialogue"
                      : draft.mode === "voice_changer"
                        ? "Convert voice"
                        : draft.variations > 1
                          ? `Generate ${draft.variations} Takes`
                          : "Generate speech"}
                  </span>
                </>
              )}
            </Button>
          </div>
        </div>
      )}
      {reviewPaidAction && (
        <VoicePaidActionConfirmation
          description={voiceBillingNotice(connection)}
          action={
            draft.mode === "dialogue"
              ? "Generate dialogue"
              : draft.mode === "voice_changer"
                ? "Convert voice"
                : "Generate speech"
          }
          returnFocus={generateRef}
          motion={keyboardReview ? "none" : "default"}
          onConfirm={confirmPaidAction}
          onClose={() => setReviewPaidAction(false)}
        />
      )}
      {speechReview && (
        <VoiceSpeechConfirmation
          review={speechReview}
          models={pg.catalog.models}
          motion={keyboardReview ? "none" : "default"}
          returnFocus={generateRef}
          onConfirm={() => launchReviewedSpeech(speechReview)}
          onClose={() => setSpeechReview(null)}
        />
      )}
    </div>
  );
}
