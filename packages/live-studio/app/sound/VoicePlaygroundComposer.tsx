import {
  Bookmark,
  Captions,
  ChevronDown,
  FileText,
  Loader2,
  MessagesSquare,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Wand2,
  X,
} from "lucide-react";
import { type RefObject, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { PlaygroundModelInfo } from "../../src/voice-playground.mjs";
import { Tip } from "../components/Tip";
import {
  duplicateEntryToComposer,
  generateFromComposer,
  loadMoreSharedVoices,
  resetComposerDraft,
  searchLiveSharedVoices,
  setComposerDraft,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import { PLAYGROUND_MODE_PRESENTATION } from "./voice-playground-presentation";
import {
  nextTabId,
  parseDialogueTurnNames,
  resolveModeModelId,
  snapToDiscreteValue,
  stripDialogueSpeakerBrackets,
  type UnifiedPlaygroundEntry,
} from "./voice-playground-view";
import {
  AUDIO_TAG_CATEGORIES,
  type AudioTagCategory,
  estimateGenerationCredits,
  insertAudioTagAtSelection,
  modelSupportsAudioTags,
} from "./voice-tags";
import { type VoiceTakeItem } from "./voice-view";
import { buildFilmTakeAudioOptions, parseTakeRef } from "./VoicePlaygroundAudioSource";
import {
  DialogueSpeakersPanel,
  SliderSettingRow,
  SttTranscriptionPanel,
  VoiceChangerPanel,
} from "./VoicePlaygroundSecondaryModes";
import { VoicePlaygroundVoicePicker } from "./VoicePlaygroundVoicePicker";

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

export function VoicePlaygroundComposer({
  pg,
  unifiedEntries,
  filmTakes,
  compact = false,
  modeTabRef,
}: {
  pg: VoicePlaygroundClientState;
  unifiedEntries: readonly UnifiedPlaygroundEntry[];
  filmTakes: readonly VoiceTakeItem[];
  compact?: boolean;
  modeTabRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { draft, catalog, jobs, busyAction, sharedSearch, status } = pg;
  const modePresentation = PLAYGROUND_MODE_PRESENTATION[draft.mode];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const uid = useId();

  const [tagCategory, setTagCategory] = useState<AudioTagCategory["id"]>("emotion");
  const [customTag, setCustomTag] = useState("");
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
  const [dismissedJobIds, setDismissedJobIds] = useState<string[]>([]);

  if (prevDraftVersion !== pg.draftVersion) {
    setPrevDraftVersion(pg.draftVersion);
    setUploadedAudio(null);
    setAdvancedOpen(hasAdvancedDraft);
    setMetaOpen(hasMetaDraft);
  }

  const modeModels = useMemo(() => {
    const filtered = catalog.models.filter((m) =>
      draft.mode === "voice_changer" ? m.can_do_voice_conversion : m.can_do_text_to_speech,
    );
    return filtered.length ? filtered : catalog.models;
  }, [catalog.models, draft.mode]);

  const activeModel: PlaygroundModelInfo | undefined = useMemo(
    () => modeModels.find((m) => m.model_id === draft.modelId) ?? modeModels[0],
    [modeModels, draft.modelId],
  );

  const languageOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of activeModel?.languages ?? []) {
      map.set(l.language_id, l.name);
    }
    for (const l of catalog.languages) {
      if (!map.has(l.code)) map.set(l.code, l.name);
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [activeModel, catalog.languages]);

  const savedTemplates = useMemo(
    () => unifiedEntries.filter((e) => e.isTemplate || e.favorite).slice(0, 20),
    [unifiedEntries],
  );

  const activeCategoryTags = useMemo(
    () => AUDIO_TAG_CATEGORIES.find((c) => c.id === tagCategory)?.tags ?? [],
    [tagCategory],
  );

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status !== "completed" && j.status !== "failed"),
    [jobs],
  );
  const failedJobs = useMemo(() => {
    const dismissed = new Set(dismissedJobIds);
    return jobs.filter((j) => j.status === "failed" && Boolean(j.error) && !dismissed.has(j.id));
  }, [jobs, dismissedJobIds]);

  const stsSourceTake = parseTakeRef(draft.vcSourceTakeValue);

  const filmTakeAudioOptions = useMemo(() => buildFilmTakeAudioOptions(filmTakes), [filmTakes]);

  const modelItems = useMemo(
    () => modeModels.map((m) => ({ value: m.model_id, label: m.name })),
    [modeModels],
  );
  const languageItems = useMemo(
    () => [
      { value: "__auto__", label: "Auto Detect" },
      ...languageOptions.map((l) => ({ value: l.code, label: `${l.name} (${l.code})` })),
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
        ? { modelId: resolveModeModelId(nextMode, draft.modelId, catalog.models) }
        : {}),
    });
  };

  const estimatedCredits = useMemo(() => {
    if (draft.mode === "stt" || draft.mode === "voice_changer") return 0;
    const primaryModel =
      draft.mode === "dialogue"
        ? (catalog.models.find((m) => m.model_id === draft.speakers[0]?.modelId) ?? activeModel)
        : activeModel;
    return estimateGenerationCredits(draft.text.length, primaryModel, {
      exportTranscript: draft.exportTranscript,
      variations: draft.mode === "tts" ? draft.variations : 1,
    });
  }, [
    draft.mode,
    draft.text.length,
    draft.exportTranscript,
    draft.variations,
    draft.speakers,
    catalog.models,
    activeModel,
  ]);

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
        reason: "GenVoice Dialogue requires at least 2 speakers.",
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
    const matchedTurns = parseDialogueTurnNames(draft.text).filter((n) => uniqueNames.has(n));
    if (matchedTurns.length < 2) {
      return {
        valid: false,
        reason: `Include "${trimmedNames[0]}: ..." and "${trimmedNames[1]}: ..." turns matching your speakers.`,
        canQuickFormat: Boolean(draft.text.trim()),
      };
    }
    return { valid: true, reason: "", canQuickFormat: false };
  }, [draft.mode, draft.speakers, draft.text]);

  const ttsMaxChars = activeModel?.maximum_text_length_per_request ?? 0;
  const ttsOverLimit = draft.mode === "tts" && ttsMaxChars > 0 && draft.text.length > ttsMaxChars;

  const canSubmitGeneration = useMemo(() => {
    if (busyAction === "generate" || busyAction === "stt" || seedInvalid) return false;
    if (draft.mode === "tts") {
      return !ttsOverLimit && draft.text.trim().length > 0 && draft.voiceId.trim().length > 0;
    }
    if (draft.mode === "dialogue") {
      return draft.text.trim().length > 0 && dialogueValidation.valid;
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

  const handleGenerate = () => {
    if (!canSubmitGeneration) return;
    if (draft.mode === "voice_changer") {
      void generateFromComposer({
        audioFile: draft.vcSourceKind === "upload" ? uploadedAudio : null,
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
  const nonTagDialogueSpeaker =
    draft.mode === "dialogue"
      ? draft.speakers.find((sp) => !modelSupportsAudioTags(sp.modelId))
      : undefined;

  return (
    <div className="flex min-h-full flex-col gap-3 text-sm">
      {/* Mode Switcher + Template Quick Loader */}
      <div className="flex flex-wrap items-center justify-between gap-2">
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

        <div className="flex items-center gap-1">
          {savedTemplates.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="outline" size="sm" className="max-w-44" />}
              >
                <Bookmark className="text-primary-text size-3 shrink-0" />
                <span className="truncate">Load preset…</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                <DropdownMenuGroup>
                  {savedTemplates.map((tpl) => (
                    <DropdownMenuItem key={tpl.uid} onClick={() => duplicateEntryToComposer(tpl)}>
                      <span className="truncate">
                        {tpl.isTemplate ? `★ ${tpl.templateName || tpl.title}` : tpl.title}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
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

      {/* TTS & Voice Changer Voice + Model + Language Row */}
      {(draft.mode === "tts" || draft.mode === "voice_changer") && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs font-medium">Voice</span>
            <VoicePlaygroundVoicePicker
              selectedId={draft.voiceId}
              selectedName={draft.voiceName}
              defaultVoices={catalog.defaultVoices}
              sharedSearch={sharedSearch}
              configured={status.configured}
              onSearchShared={searchLiveSharedVoices}
              onLoadMoreShared={() => void loadMoreSharedVoices()}
              onSelect={(v) => setComposerDraft({ voiceId: v.id, voiceName: v.name })}
              fullWidth
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs font-medium">Model</span>
              {activeModel && (
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {activeModel.model_rates.character_cost_multiplier}× cost ·{" "}
                  {(activeModel.maximum_text_length_per_request / 1000).toFixed(0)}k max
                </span>
              )}
            </div>
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
              <SelectTrigger className="h-8 w-full" aria-label="Select GenVoice model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modeModels.map((m) => (
                  <SelectItem key={m.model_id} value={m.model_id}>
                    <span className="flex items-center gap-2">
                      <span>{m.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {m.model_id} · {m.model_rates.character_cost_multiplier}×
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.mode !== "voice_changer" && (
            <div className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-muted-foreground text-xs font-medium">Language</span>
              <Select
                items={languageItems}
                value={draft.languageCode || "__auto__"}
                onValueChange={(v) =>
                  setComposerDraft({ languageCode: !v || v === "__auto__" ? "" : v })
                }
              >
                <SelectTrigger className="h-8 w-full" aria-label="Language code">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">Auto Detect</SelectItem>
                  {languageOptions.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.name} ({l.code})
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
          onUploadedAudioChange={setUploadedAudio}
          sourcePlaygroundId={draft.vcSourceItemId}
          onSourcePlaygroundIdChange={(id) => setComposerDraft({ vcSourceItemId: id })}
          sourceTakeValue={draft.vcSourceTakeValue}
          onSourceTakeValueChange={(val) => setComposerDraft({ vcSourceTakeValue: val })}
        />
      )}

      {/* Script / Prompt Box + Eleven v4/v3 Audio Tags Toolbar */}
      {(draft.mode === "tts" || draft.mode === "dialogue") && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={`${uid}-script`}
              className={cn("text-sm font-semibold", modePresentation.text)}
            >
              {draft.mode === "dialogue" ? "Dialogue Script & Audio Tags" : "Prompt & [Audio Tags]"}
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
            ref={textareaRef}
            rows={compact ? 3 : 4}
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
                ? "Alex: [whispers] Did you hear that?\nRiley: [gasps, panicking] Don't move!"
                : "[whispers, anxious] Keep moving before the door locks [short pause] right behind us."
            }
            className="min-h-20"
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

          {draft.mode === "tts" && !modelSupportsAudioTags(draft.modelId) && (
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
                <code className="font-mono">{nonTagDialogueSpeaker.modelId}</code>, which speaks
                bracketed tags aloud.
              </span>
            </div>
          )}

          {/* Eleven v4 / v3 Interactive Audio Tags Palette */}
          <div className="border-hairline bg-surface-subtle flex flex-col gap-1.5 rounded-lg border p-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1">
                {AUDIO_TAG_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={tagCategory === cat.id}
                    onClick={() => setTagCategory(cat.id)}
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
                <Button type="submit" variant="secondary" size="sm" disabled={!customTag.trim()}>
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
        </div>
      )}

      {/* Dynamic Voice Settings & Advanced Options */}
      {draft.mode !== "stt" && (
        <div className={cn("flex flex-col gap-2.5 rounded-lg border p-3", modePresentation.panel)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={cn("text-sm font-semibold", modePresentation.text)}>
              {draft.mode === "dialogue" ? "Output & Metadata" : "Voice Settings"}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {draft.mode !== "dialogue" && (
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
                    {draft.mode === "tts" ? "Context, Seed & Format" : "Seed & Determinism"}
                  </span>
                  <ChevronDown
                    className={cn("size-3 transition-transform", advancedOpen && "rotate-180")}
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

          {draft.mode !== "dialogue" && (
            <>
              {activeModel?.stability_values?.length ? (
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
              )}

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
                    hint="Speech rate multiplier (0.7× to 1.2×)"
                    value={draft.speed}
                    min={0.7}
                    max={1.2}
                    step={0.05}
                    formatValue={(v) => `${v.toFixed(2)}×`}
                    onChange={(v) => setComposerDraft({ speed: v })}
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
                  checked={draft.exportTranscript}
                  onCheckedChange={(v) => setComposerDraft({ exportTranscript: v })}
                />
                <label htmlFor={exportSrtId} className="cursor-pointer">
                  Export .srt Subtitles (+15% cr)
                </label>
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
                        "focus-visible:ring-ring rounded px-2 py-0.5 text-sm font-medium tabular-nums transition-colors outline-none focus-visible:ring-2",
                        draft.variations === n
                          ? "bg-card text-primary-text shadow-xs"
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

          <Collapsible open={advancedOpen && draft.mode !== "dialogue"}>
            <CollapsibleContent id={`${uid}-advanced`} variant="animated">
              <div className="border-hairline flex flex-col gap-2 border-t pt-2">
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
                      <span id={`${uid}-seed-err`} role="alert" className="text-warn-text text-xs">
                        Seed must be an integer 0–4294967295
                      </span>
                    )}
                  </div>
                  {draft.mode === "tts" && (
                    <>
                      <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground text-xs font-medium">
                          Output Format
                        </span>
                        <Select
                          items={OUTPUT_FORMAT_ITEMS}
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
                          <SelectContent>
                            {OUTPUT_FORMAT_ITEMS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
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
                          <SelectContent>
                            {TEXT_NORM_ITEMS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={metaOpen}>
            <CollapsibleContent id={`${uid}-metadata`} variant="animated">
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
        <SttTranscriptionPanel pg={pg} filmTakeOptions={filmTakeAudioOptions} />
      )}

      {/* Active Job / Error Banner + Generate Action Bar */}
      {(activeJobs.length > 0 || failedJobs.length > 0 || pg.error) && (
        <div className="flex flex-col gap-1">
          {activeJobs.map((job) => (
            <div
              key={job.id}
              className="border-primary/30 bg-tint/60 flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <span className="text-primary-text flex min-w-0 items-center gap-1.5 font-medium">
                <Loader2 className="size-3.5 flex-none animate-spin motion-reduce:animate-none" />
                <span className="truncate">
                  {job.title} ({job.status})
                </span>
              </span>
              <span className="text-primary-text font-mono text-xs tabular-nums">
                {job.progress}%
              </span>
            </div>
          ))}
          {pg.error && (
            <p
              role="alert"
              className="border-warn/40 bg-warn-bg/80 text-warn-text rounded-md border px-2.5 py-1.5 text-sm"
            >
              {pg.error}
            </p>
          )}
          {failedJobs.map((job) => (
            <div
              key={job.id}
              role="alert"
              className="border-warn/40 bg-warn-bg/80 text-warn-text flex items-start justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{job.title}:</span> {job.error}
              </span>
              <button
                type="button"
                aria-label={`Dismiss error for ${job.title}`}
                onClick={() => setDismissedJobIds((prev) => [...prev, job.id])}
                className="text-warn-text/80 hover:text-warn-text focus-visible:ring-ring flex-none rounded p-0.5 outline-none focus-visible:ring-2"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {draft.mode !== "stt" && (
        <div className="border-hairline bg-card sticky bottom-0 z-10 mt-auto flex flex-col items-stretch justify-between gap-2 border-t py-3 sm:flex-row sm:items-center">
          <div className="text-muted-foreground flex flex-col items-start gap-1 text-xs tabular-nums">
            {estimatedCredits > 0 ? (
              <span>About {estimatedCredits.toLocaleString()} credits</span>
            ) : (
              <span>{draft.mode === "voice_changer" ? "Uses voice credits" : "Ready"}</span>
            )}
            <span className="hidden text-xs sm:inline">Ctrl/Cmd + Enter to generate</span>
          </div>
          <Button
            type="button"
            size={compact ? "md" : "xl"}
            disabled={!canSubmitGeneration}
            onClick={handleGenerate}
          >
            {busyAction === "generate" ? (
              <>
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                <span>Starting…</span>
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" />
                <span>
                  {draft.mode === "dialogue"
                    ? "Generate Dialogue"
                    : draft.mode === "voice_changer"
                      ? "Convert Voice"
                      : draft.variations > 1
                        ? `Generate ${draft.variations} Takes`
                        : "Generate Voice"}
                </span>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
