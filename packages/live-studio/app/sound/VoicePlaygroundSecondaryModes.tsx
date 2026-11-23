import { Captions, Copy, Download, Loader2, SlidersHorizontal } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { PlaygroundSttResult } from "../../src/voice-playground.mjs";
import { say } from "../core/store";
import {
  runPlaygroundStt,
  saveUploadedSttSource,
  setComposerDraft,
  setPlaygroundScope,
  setPlaygroundSubTab,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import { groupDiarizedTranscript, resolveModeModelId } from "./voice-playground-view";
import {
  type AudioSourceKind,
  type FilmTakeAudioOption,
  parseTakeRef,
  VoicePlaygroundAudioSource,
} from "./VoicePlaygroundAudioSource";
import { SliderSettingRow } from "./VoiceSettingSlider";
import { VoicePaidActionConfirmation } from "./VoiceSpeechConfirmation";

const GRANULARITY_ITEMS = [
  { value: "word", label: "Word timestamps" },
  { value: "character", label: "Character timestamps" },
  { value: "none", label: "No timestamps" },
];

const STT_FILE_FORMAT_ITEMS = [
  { value: "other", label: "Auto / Container (other)" },
  { value: "pcm_s16le_16", label: "Raw 16kHz PCM (pcm_s16le_16)" },
];

const ENTITY_REDACTION_MODE_ITEMS = [
  { value: "enumerated_entity_type", label: "Enumerated ([PERSON_NAME_1])" },
  { value: "entity_type", label: "Type ([PERSON_NAME])" },
  { value: "redacted", label: "Literal ([redacted])" },
];

export function VoiceChangerPanel({
  pg,
  filmTakeOptions,
  sourceKind,
  onSourceKindChange,
  uploadedAudio,
  onUploadedAudioChange,
  sourcePlaygroundId,
  onSourcePlaygroundIdChange,
  sourceTakeValue,
  onSourceTakeValueChange,
}: {
  pg: VoicePlaygroundClientState;
  filmTakeOptions: readonly FilmTakeAudioOption[];
  sourceKind: AudioSourceKind;
  onSourceKindChange: (next: AudioSourceKind) => void;
  uploadedAudio: File | null;
  onUploadedAudioChange: (file: File | null) => void;
  sourcePlaygroundId: string;
  onSourcePlaygroundIdChange: (id: string) => void;
  sourceTakeValue: string;
  onSourceTakeValueChange: (val: string) => void;
}) {
  const removeNoiseId = useId();

  return (
    <div className="border-hairline bg-surface-subtle flex flex-col gap-2 rounded-lg border p-2.5">
      <VoicePlaygroundAudioSource
        tone="voice_changer"
        title="Source Audio to Transform"
        sourceKind={sourceKind}
        onSourceKindChange={onSourceKindChange}
        uploadedFile={uploadedAudio}
        onFileChange={(file) => {
          onUploadedAudioChange(file);
          if (file) setComposerDraft({ vcSourceFile: "" });
        }}
        accept="audio/*"
        uploadPlaceholder={
          pg.draft.vcSourceFile
            ? "Saved original audio (choose a file to replace)"
            : "Choose MP3, WAV, OGG, M4A, or WebM (max 50MB)…"
        }
        playgroundItems={pg.items}
        selectedItemId={sourcePlaygroundId}
        onSelectItemId={onSourcePlaygroundIdChange}
        playgroundPlaceholder="Pick a previously generated clip…"
        filmTakeOptions={filmTakeOptions}
        selectedTakeValue={sourceTakeValue}
        onSelectTakeValue={onSourceTakeValueChange}
        takePlaceholder="Pick an existing AI film take…"
        itemIcon="file"
      >
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <label htmlFor={removeNoiseId} className="text-foreground/85 cursor-pointer text-xs">
            Remove background noise
          </label>
          <Switch
            id={removeNoiseId}
            size="sm"
            checked={pg.draft.removeBackgroundNoise}
            onCheckedChange={(v) => setComposerDraft({ removeBackgroundNoise: v })}
          />
        </div>
      </VoicePlaygroundAudioSource>
    </div>
  );
}

export function SttTranscriptionPanel({
  pg,
  filmTakeOptions,
  showResult = true,
}: {
  showResult?: boolean;
  pg: VoicePlaygroundClientState;
  filmTakeOptions: readonly FilmTakeAudioOption[];
}) {
  const uid = useId();
  const [sttDraftVersion, setSttDraftVersion] = useState(pg.draftVersion);
  const [sttFile, setSttFile] = useState<File | null>(null);
  const [advancedSttOpen, setAdvancedSttOpen] = useState(false);
  const [reviewStt, setReviewStt] = useState<"default" | "none" | null>(null);
  const transcribeButton = useRef<HTMLButtonElement>(null);
  if (sttDraftVersion !== pg.draftVersion) {
    setSttDraftVersion(pg.draftVersion);
    setSttFile(null);
  }
  const sttLang = pg.draft.sttLanguageCode;
  const sttGranularity = pg.draft.sttGranularity;
  const sttDiarize = pg.draft.sttDiarize;
  const sttUseMultiChannel = pg.draft.sttUseMultiChannel;
  const sttFileFormat = pg.draft.sttFileFormat;
  const sttNumSpeakers = pg.draft.sttNumSpeakers;
  const sttThreshold = pg.draft.sttDiarizationThreshold;
  const sttTagEvents = pg.draft.sttTagEvents;
  const sttNoVerbatim = pg.draft.sttNoVerbatim;
  const sttTemp = pg.draft.sttTemperature;
  const sttSeed = pg.draft.sttSeedText;
  const sttKeyterms = pg.draft.sttKeytermsText;
  const sttEntityDetection = pg.draft.sttEntityDetectionText;
  const sttEntityRedaction = pg.draft.sttEntityRedactionText;
  const sttEntityRedactionMode = pg.draft.sttEntityRedactionMode;
  const sttExportSrt = pg.draft.sttExportSrt;
  const sttExtraFormats = pg.draft.sttExtraFormats ?? [];

  const sttDiarizeId = `${uid}-diarize`;
  const sttMultiChId = `${uid}-multichannel`;
  const sttEventsId = `${uid}-events`;
  const sttCleanId = `${uid}-clean`;
  const sttSrtId = `${uid}-srt`;
  const sttErrorId = `${uid}-stt-error`;

  const sttSourceKind = pg.draft.sttSourceKind;
  const sttItemId = pg.draft.sttSourceItemId;
  const sttTakeValue = pg.draft.sttSourceTakeValue;
  const sttSourceTake = parseTakeRef(sttTakeValue);
  const activeTranscription = pg.jobs.some(
    (job) => job.kind === "stt" && ["pending", "processing", "downloading"].includes(job.status),
  );

  const trimmedLang = sttLang.trim();
  const langInvalid = !trimmedLang || trimmedLang.toLowerCase() === "auto";

  const splitTerms = (raw: string) =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const keyterms = splitTerms(sttKeyterms);
  const entityDetection = splitTerms(sttEntityDetection);
  const entityRedaction = splitTerms(sttEntityRedaction);
  const redactionInvalid =
    entityRedaction.length > 0 &&
    !entityDetection.includes("all") &&
    entityRedaction.some((cat) => !entityDetection.includes(cat));
  const numSpkRaw = sttNumSpeakers.trim();
  const hasNumSpeakers = numSpkRaw.length > 0;
  const numSpkParsed = hasNumSpeakers ? Number(numSpkRaw) : undefined;
  const numSpkInvalid =
    hasNumSpeakers && (!Number.isInteger(numSpkParsed) || numSpkParsed! < 1 || numSpkParsed! > 32);

  const thresholdRaw = sttThreshold.trim();
  const thresholdParsed = !hasNumSpeakers && thresholdRaw ? Number(thresholdRaw) : undefined;
  const thresholdInvalid =
    sttDiarize &&
    !hasNumSpeakers &&
    thresholdRaw.length > 0 &&
    (!Number.isFinite(thresholdParsed) || thresholdParsed! < 0 || thresholdParsed! > 1.5);

  const seedRaw = sttSeed.trim();
  const seedParsed = seedRaw ? Number(seedRaw) : undefined;
  const seedInvalid =
    seedRaw.length > 0 &&
    (!Number.isInteger(seedParsed) || seedParsed! < 0 || seedParsed! > 2147483647);

  const keytermsOverCount = keyterms.length > 1000;
  const keytermsTooLong = keyterms.find((term) => term.length >= 50);
  const keytermsInvalid = keytermsOverCount || Boolean(keytermsTooLong);
  const multiChannelConflict = sttDiarize && sttUseMultiChannel;
  const sttValidationError = langInvalid
    ? "Required ISO language code (e.g. 'en', 'vi') — Scribe v2 does not support 'auto'."
    : multiChannelConflict
      ? "Diarize and Multi-channel cannot be enabled together."
      : numSpkInvalid
        ? "Speakers must be a whole number from 1 to 32."
        : thresholdInvalid
          ? "Diarization threshold must be between 0.0 and 1.5."
          : seedInvalid
            ? "STT seed must be an integer 0–2147483647."
            : keytermsOverCount
              ? `Keyterms limited to 1000 entries (${keyterms.length} entered).`
              : keytermsTooLong
                ? `Each keyterm must be under 50 characters ("${keytermsTooLong.slice(0, 20)}…").`
                : redactionInvalid
                  ? "Entity redaction categories must be listed in Entity detection (or include 'all')."
                  : null;

  const transcriptionUnavailable =
    Boolean(sttValidationError) ||
    (sttSourceKind === "upload" &&
      (!pg.draft.sttSourceFile || pg.sttSourceUpload?.status === "uploading")) ||
    (sttSourceKind === "playground" && !sttItemId) ||
    (sttSourceKind === "film_take" && !sttTakeValue);
  const handleRunStt = () => {
    if (transcriptionUnavailable || pg.busyAction === "stt") return;
    void runPlaygroundStt({
      background: true,
      sourceFile: sttSourceKind === "upload" ? pg.draft.sttSourceFile || undefined : undefined,
      itemId: sttSourceKind === "playground" ? sttItemId || undefined : undefined,
      sourceTakeKind: sttSourceKind === "film_take" ? sttSourceTake?.kind : undefined,
      sourceTakeFile: sttSourceKind === "film_take" ? sttSourceTake?.file : undefined,
      languageCode: sttLang.trim(),
      fileFormat: sttFileFormat,
      timestampsGranularity: sttGranularity,
      diarize: sttDiarize,
      useMultiChannel: sttUseMultiChannel,
      numSpeakers: numSpkParsed,
      diarizationThreshold: sttDiarize && !hasNumSpeakers ? thresholdParsed : undefined,
      tagAudioEvents: sttTagEvents,
      noVerbatim: sttNoVerbatim,
      temperature: sttTemp,
      seed: seedParsed,
      keyterms: keyterms.length ? keyterms : undefined,
      entityDetection: entityDetection.length ? entityDetection : undefined,
      entityRedaction: entityRedaction.length ? entityRedaction : undefined,
      entityRedactionMode: entityRedaction.length ? sttEntityRedactionMode : undefined,
      additionalFormats: Array.from(
        new Set([...(sttExportSrt ? ["srt"] : []), ...sttExtraFormats]),
      ),
      sourceLabel:
        sttSourceKind === "upload"
          ? sttFile?.name || pg.draft.sttSourceLabel
          : sttSourceKind === "playground"
            ? pg.items.find((x) => x.id === sttItemId)?.title
            : filmTakeOptions.find((take) => take.value === sttTakeValue)?.label,
    });
  };

  return (
    <div className="border-hairline bg-surface-subtle flex flex-col gap-2.5 rounded-lg border p-2.5">
      {sttSourceKind === "upload" && pg.draft.sttSourceFile && !sttFile && (
        <p className="text-primary-text text-sm">
          Saved original: {pg.draft.sttSourceLabel || pg.draft.sttSourceFile}. Choose another file
          to replace it.
        </p>
      )}
      <VoicePlaygroundAudioSource
        tone="stt"
        title="Speech to Text · Scribe v2"
        sourceKind={sttSourceKind}
        onSourceKindChange={(k) => setComposerDraft({ sttSourceKind: k })}
        uploadedFile={sttFile}
        onFileChange={(file) => {
          setSttFile(file);
          if (file) void saveUploadedSttSource(file);
        }}
        accept="audio/*,video/*"
        uploadPlaceholder="Pick audio or video file (max 90MB)…"
        playgroundItems={pg.items}
        selectedItemId={sttItemId}
        onSelectItemId={(id) => setComposerDraft({ sttSourceItemId: id })}
        playgroundPlaceholder="Choose a Playground clip…"
        filmTakeOptions={filmTakeOptions}
        selectedTakeValue={sttTakeValue}
        onSelectTakeValue={(val) => setComposerDraft({ sttSourceTakeValue: val })}
        takePlaceholder="Choose a Film Take…"
        itemIcon="wave"
      />
      {sttSourceKind === "upload" && pg.sttSourceUpload?.status === "uploading" && (
        <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          Saving {pg.sttSourceUpload.name} for reuse. No credits used.
        </p>
      )}
      {sttSourceKind === "upload" && pg.sttSourceUpload?.status === "failed" && (
        <div role="alert" className="text-destructive flex flex-wrap items-center gap-2 text-sm">
          <p>{pg.sttSourceUpload.error}. Choose the file again or retry its upload.</p>
          {sttFile && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void saveUploadedSttSource(sttFile)}
            >
              Retry source upload
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field className="min-w-0" data-invalid={langInvalid || undefined}>
          <FieldLabel variant="compact" htmlFor={`${uid}-language`}>
            Language code
          </FieldLabel>
          <Input
            id={`${uid}-language`}
            size="md"
            value={sttLang}
            onChange={(e) => setComposerDraft({ sttLanguageCode: e.target.value })}
            placeholder="Required ISO code (en, vi)"
            aria-label="STT Language Code"
            aria-invalid={langInvalid || undefined}
            aria-describedby={langInvalid ? sttErrorId : undefined}
          />
        </Field>
        <Field className="min-w-0">
          <FieldLabel variant="compact" htmlFor={`${uid}-timestamps`}>
            Timestamp granularity
          </FieldLabel>
          <Select
            items={GRANULARITY_ITEMS}
            value={sttGranularity}
            onValueChange={(v) =>
              v && setComposerDraft({ sttGranularity: v as "word" | "character" | "none" })
            }
          >
            <SelectTrigger
              id={`${uid}-timestamps`}
              className="h-7 w-full"
              aria-label="Timestamp granularity"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent finalFocus>
              {GRANULARITY_ITEMS.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <div className="flex items-center gap-1.5">
          <Switch
            id={sttDiarizeId}
            size="sm"
            checked={sttDiarize}
            onCheckedChange={(v) =>
              setComposerDraft(
                v ? { sttDiarize: true, sttUseMultiChannel: false } : { sttDiarize: false },
              )
            }
          />
          <label htmlFor={sttDiarizeId} className="cursor-pointer">
            Identify speakers
          </label>
        </div>
        <div className="flex items-center gap-1.5">
          <Switch
            id={sttEventsId}
            size="sm"
            checked={sttTagEvents}
            onCheckedChange={(v) => setComposerDraft({ sttTagEvents: v })}
          />
          <label htmlFor={sttEventsId} className="cursor-pointer">
            Tag audio events
          </label>
        </div>
        <div className="flex items-center gap-1.5">
          <Switch
            id={sttCleanId}
            size="sm"
            checked={sttNoVerbatim}
            onCheckedChange={(v) => setComposerDraft({ sttNoVerbatim: v })}
          />
          <label htmlFor={sttCleanId} className="cursor-pointer">
            Remove filler words
          </label>
        </div>
        <div className="flex items-center gap-1.5">
          <Switch
            id={sttSrtId}
            size="sm"
            checked={sttExportSrt}
            onCheckedChange={(v) => setComposerDraft({ sttExportSrt: v })}
          />
          <label htmlFor={sttSrtId} className="cursor-pointer">
            Export .srt
          </label>
        </div>
      </div>

      <Collapsible open={advancedSttOpen}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={advancedSttOpen}
          aria-controls={`${uid}-advanced-stt`}
          className="self-start"
          onClick={() => setAdvancedSttOpen((v) => !v)}
        >
          <SlidersHorizontal className="size-3" />
          <span>Scribe v2 options</span>
        </Button>

        <CollapsibleContent id={`${uid}-advanced-stt`} className="mt-2">
          <div className="border-hairline bg-surface-subtle flex flex-col gap-2 rounded-md border p-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Field className="min-w-0" data-invalid={numSpkInvalid || undefined}>
                <FieldLabel variant="compact" htmlFor={`${uid}-speaker-count`}>
                  Number of speakers
                </FieldLabel>
                <Input
                  id={`${uid}-speaker-count`}
                  inputMode="numeric"
                  size="sm"
                  value={sttNumSpeakers}
                  onChange={(e) => setComposerDraft({ sttNumSpeakers: e.target.value })}
                  placeholder="Speakers 1–32 (auto)"
                  aria-label="Number of speakers"
                  aria-invalid={numSpkInvalid || undefined}
                  aria-describedby={numSpkInvalid ? sttErrorId : undefined}
                />
              </Field>
              {sttDiarize && (
                <Field className="min-w-0" data-invalid={thresholdInvalid || undefined}>
                  <FieldLabel variant="compact" htmlFor={`${uid}-threshold`}>
                    Diarization threshold
                  </FieldLabel>
                  <Input
                    id={`${uid}-threshold`}
                    inputMode="decimal"
                    size="sm"
                    value={sttThreshold}
                    onChange={(e) => setComposerDraft({ sttDiarizationThreshold: e.target.value })}
                    disabled={hasNumSpeakers}
                    placeholder={
                      hasNumSpeakers
                        ? "Auto-ignored when speaker count set"
                        : "Diarize threshold (0.0-1.5)"
                    }
                    aria-label="Diarization threshold"
                    aria-invalid={thresholdInvalid || undefined}
                    aria-describedby={thresholdInvalid ? sttErrorId : undefined}
                  />
                </Field>
              )}
              <Field className="min-w-0" data-invalid={seedInvalid || undefined}>
                <FieldLabel variant="compact" htmlFor={`${uid}-seed`}>
                  STT seed
                </FieldLabel>
                <Input
                  id={`${uid}-seed`}
                  inputMode="numeric"
                  size="sm"
                  value={sttSeed}
                  onChange={(e) => setComposerDraft({ sttSeedText: e.target.value })}
                  placeholder="Seed 0–2147483647 (optional)"
                  aria-label="STT seed"
                  aria-invalid={seedInvalid || undefined}
                  aria-describedby={seedInvalid ? sttErrorId : undefined}
                />
              </Field>
              <Field className="min-w-0" data-invalid={keytermsInvalid || undefined}>
                <FieldLabel variant="compact" htmlFor={`${uid}-keyterms`}>
                  STT keyterms
                </FieldLabel>
                <Input
                  id={`${uid}-keyterms`}
                  size="sm"
                  value={sttKeyterms}
                  onChange={(e) => setComposerDraft({ sttKeytermsText: e.target.value })}
                  placeholder="Keyterms (comma-sep)"
                  aria-label="STT keyterms"
                  aria-invalid={keytermsInvalid || undefined}
                  aria-describedby={keytermsInvalid ? sttErrorId : undefined}
                />
              </Field>
            </div>
            <SliderSettingRow
              label="Transcription temperature"
              value={sttTemp}
              min={0}
              max={2}
              step={0.1}
              onChange={(v) => setComposerDraft({ sttTemperature: v })}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field className="min-w-0">
                <FieldLabel variant="compact" htmlFor={`${uid}-input-format`}>
                  Input file format
                </FieldLabel>
                <Select
                  items={STT_FILE_FORMAT_ITEMS}
                  value={sttFileFormat}
                  onValueChange={(v) => {
                    if (v === "other" || v === "pcm_s16le_16") {
                      setComposerDraft({ sttFileFormat: v });
                    }
                  }}
                >
                  <SelectTrigger
                    id={`${uid}-input-format`}
                    className="h-7 w-full"
                    aria-label="STT input file format"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent finalFocus>
                    {STT_FILE_FORMAT_ITEMS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="flex items-end pb-1">
                <div className="flex items-center gap-1.5">
                  <Switch
                    id={sttMultiChId}
                    size="sm"
                    checked={sttUseMultiChannel}
                    onCheckedChange={(v) =>
                      setComposerDraft(
                        v
                          ? { sttUseMultiChannel: true, sttDiarize: false }
                          : { sttUseMultiChannel: false },
                      )
                    }
                  />
                  <label htmlFor={sttMultiChId} className="cursor-pointer">
                    Multi-channel (up to 5ch)
                  </label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field className="min-w-0">
                <FieldLabel variant="compact" htmlFor={`${uid}-entity-detection`}>
                  Detect entities
                </FieldLabel>
                <Input
                  id={`${uid}-entity-detection`}
                  size="sm"
                  value={sttEntityDetection}
                  onChange={(e) => setComposerDraft({ sttEntityDetectionText: e.target.value })}
                  placeholder="Entity detection (all, pii…)"
                />
              </Field>
              <Field className="min-w-0" data-invalid={redactionInvalid || undefined}>
                <FieldLabel variant="compact" htmlFor={`${uid}-entity-redaction`}>
                  Redact entities
                </FieldLabel>
                <Input
                  id={`${uid}-entity-redaction`}
                  size="sm"
                  value={sttEntityRedaction}
                  onChange={(e) => setComposerDraft({ sttEntityRedactionText: e.target.value })}
                  placeholder="Entity redaction (subset)"
                  aria-invalid={redactionInvalid || undefined}
                  aria-describedby={redactionInvalid ? sttErrorId : undefined}
                />
              </Field>
              <Field className="min-w-0 sm:col-span-2">
                <FieldLabel variant="compact" htmlFor={`${uid}-redaction-mode`}>
                  Redaction format
                </FieldLabel>
                <Select
                  items={ENTITY_REDACTION_MODE_ITEMS}
                  value={sttEntityRedactionMode}
                  onValueChange={(v) => {
                    if (v === "enumerated_entity_type" || v === "entity_type" || v === "redacted") {
                      setComposerDraft({ sttEntityRedactionMode: v });
                    }
                  }}
                >
                  <SelectTrigger id={`${uid}-redaction-mode`} className="h-7 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent finalFocus>
                    {ENTITY_REDACTION_MODE_ITEMS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground me-1 text-xs font-medium">Extra exports:</span>
              {(["txt", "segmented_json", "html", "docx", "pdf"] as const).map((fmt) => {
                const active = sttExtraFormats.includes(fmt);
                return (
                  <button
                    key={fmt}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setComposerDraft({
                        sttExtraFormats: active
                          ? sttExtraFormats.filter((x) => x !== fmt)
                          : [...sttExtraFormats, fmt],
                      })
                    }
                    className={cn(
                      "border-hairline focus-visible:ring-ring rounded border px-1.5 py-0.5 font-mono text-xs transition-colors outline-none focus-visible:ring-2",
                      active
                        ? "border-primary/40 bg-tint text-primary-text"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    .{fmt}
                  </button>
                );
              })}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {sttValidationError && (
        <p id={sttErrorId} role="alert" className="text-warn-text text-xs">
          {sttValidationError}
        </p>
      )}

      <div className="border-hairline bg-surface-subtle flex flex-col gap-3 rounded-lg border p-3">
        <p className="text-warn-text text-sm font-medium">Transcription cost isn’t available yet</p>
        <p className="text-reading-foreground max-w-[59ch] text-sm leading-relaxed text-pretty">
          GenVoice may charge credits. The transcript, original source and requested settings are
          saved to your library.
        </p>
        <div className="flex items-center justify-between gap-3">
          <label className="text-foreground text-sm" htmlFor={`${uid}-stt-scope`}>
            Save transcript to
          </label>
          <Select
            items={[
              { value: "project", label: "This project" },
              { value: "global", label: "Global · all projects" },
            ]}
            value={pg.scope}
            disabled={pg.busyAction === "stt"}
            onValueChange={(value) => {
              if (value === "project" || value === "global") setPlaygroundScope(value);
            }}
          >
            <SelectTrigger id={`${uid}-stt-scope`} size="readable">
              <SelectValue />
            </SelectTrigger>
            <SelectContent finalFocus>
              <SelectItem value="project">This project</SelectItem>
              <SelectItem value="global">Global · all projects</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        ref={transcribeButton}
        type="button"
        size="xl"
        disabled={transcriptionUnavailable}
        aria-disabled={transcriptionUnavailable || pg.busyAction === "stt"}
        onClick={(event) => {
          if (!transcriptionUnavailable && pg.busyAction !== "stt") {
            setReviewStt(event.detail === 0 ? "none" : "default");
          }
        }}
      >
        {pg.busyAction === "stt" ? (
          <>
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            <span>Transcribing…</span>
          </>
        ) : (
          <>
            <Captions className="size-3.5" />
            <span>
              {activeTranscription ? "Start another transcription" : "Transcribe with Scribe v2"}
            </span>
          </>
        )}
      </Button>

      {reviewStt && (
        <VoicePaidActionConfirmation
          action="Transcribe audio"
          motion={reviewStt}
          returnFocus={transcribeButton}
          onConfirm={handleRunStt}
          onClose={() => setReviewStt(null)}
        />
      )}
      {showResult && pg.lastSttResult && (
        <SttTranscriptDetails
          result={pg.lastSttResult}
          onSendToTts={(text) => {
            setComposerDraft({
              mode: "tts",
              text,
              modelId: resolveModeModelId("tts", pg.draft.modelId, pg.catalog.models),
            });
            setPlaygroundSubTab("create");
          }}
        />
      )}
    </div>
  );
}

const triggerFormatDownload = (ext: string, content: string, isBase64?: boolean) => {
  const safeExt = ext.replace(/[^a-z0-9_-]/gi, "") || "txt";
  const payload = isBase64
    ? Uint8Array.from(atob(content), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(content);
  const blob = new Blob([payload], {
    type: isBase64 ? "application/octet-stream" : "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transcript.${safeExt}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function SttTranscriptDetails({
  result,
  onSendToTts,
}: {
  result: PlaygroundSttResult;
  onSendToTts?: (text: string) => void;
}) {
  const turns = groupDiarizedTranscript(result.words);
  const probLabel =
    typeof result.language_probability === "number" && Number.isFinite(result.language_probability)
      ? `${Math.round(result.language_probability * 100)}%`
      : null;
  const formats = [
    ...(result.additional_formats ?? []),
    ...((result.additional_formats ?? []).some((format) => format.file_extension === "txt")
      ? []
      : [{ file_extension: "txt", content: result.text }]),
  ];

  return (
    <div className="border-hairline bg-card flex flex-col gap-1.5 rounded-md border p-2 text-sm">
      <p className="text-muted-foreground text-sm tabular-nums">
        Actual STT fee:{" "}
        <span className="text-foreground font-medium">
          {typeof result.creditsDeducted === "number"
            ? `${result.creditsDeducted.toLocaleString()} credits`
            : "Not reported"}
        </span>
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-foreground flex items-center gap-1.5 font-medium">
          <span>Transcript ({result.language_code || "unknown"})</span>
          {probLabel && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {probLabel} confidence
            </span>
          )}
        </span>
        {onSendToTts && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onSendToTts(result.text)}
          >
            Send to Speech
          </Button>
        )}
      </div>

      {turns.length > 0 ? (
        <div className="bg-surface-subtle/60 flex max-h-40 flex-col gap-1 overflow-y-auto rounded p-1.5">
          {turns.map((turn, i) => (
            <div key={`${turn.speaker}-${i}`} className="leading-snug">
              <span className="text-primary-text font-mono text-xs font-medium tabular-nums">
                {turn.speaker}
                {typeof turn.start === "number" ? ` [${turn.start.toFixed(1)}s]` : ""}:
              </span>{" "}
              <span className="text-foreground/90">{turn.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-foreground/90 whitespace-pre-wrap">{result.text}</p>
      )}

      {Boolean(result.entities?.length) && (
        <section
          aria-label="Detected entities"
          className="flex max-h-32 flex-col gap-1 overflow-y-auto"
        >
          <span className="text-muted-foreground">Detected entities</span>
          {result.entities?.map((entity, i) => (
            <span key={`${entity.start_char}-${entity.end_char}-${i}`}>
              {entity.entity_type}: {entity.text}
            </span>
          ))}
        </section>
      )}

      {formats.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {formats.map((f, i) => (
            <div key={`${f.file_extension}-${i}`} className="flex items-center gap-0.5">
              {!f.is_base64_encoded && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(f.content);
                      say(`Copied .${f.file_extension}`);
                    } catch {
                      say(
                        `Could not copy .${f.file_extension}. Use the .${f.file_extension} download button instead.`,
                      );
                    }
                  }}
                >
                  <Copy className="size-3" />
                  <span>Copy .{f.file_extension}</span>
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  triggerFormatDownload(f.file_extension, f.content, f.is_base64_encoded)
                }
              >
                <Download className="size-3" />
                <span>.{f.file_extension}</span>
              </Button>
            </div>
          ))}
        </div>
      )}

      {result.srtText && (
        <pre className="bg-surface-subtle text-muted-foreground max-h-32 overflow-y-auto rounded p-1.5 font-mono text-xs">
          {result.srtText}
        </pre>
      )}
    </div>
  );
}
