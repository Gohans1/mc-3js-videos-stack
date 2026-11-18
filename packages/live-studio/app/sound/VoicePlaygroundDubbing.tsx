import {
  ArrowLeftRight,
  Check,
  FileAudio,
  FolderOpen,
  Languages,
  Loader2,
  Pause,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import {
  DUBBING_MODELS,
  DUBBING_TARGET_LANGUAGES,
  DubbingInput,
} from "../../src/voice-playground-dubbing-contract";
import type { DubbingJob, DubbingSource } from "../../src/voice-playground-dubbing.mjs";
import { S } from "../core/state";
import { say } from "../core/store";
import { playNativeAudition, releaseNativeAudition } from "./sound";
import {
  acceptDubbingJob,
  dubbingPost,
  dubbingRequest,
  type DubbingScope,
  stageDubbingUpload,
} from "./voice-dubbing-client";
import {
  archiveFilmTake,
  browseCastingVoices,
  getPlaygroundSnapshot,
  loadMoreSharedVoices,
  searchLiveSharedVoices,
  setComposerDraft,
  setPlaygroundScope,
  setPlaygroundSubTab,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import type { ComposerDraft, UnifiedPlaygroundEntry } from "./voice-playground-view";
import type { PickedVoice } from "./VoiceCastingRow";
import { recordingSourceOptions } from "./VoicePlaygroundAudioSource";
import { VoicePlaygroundSaveTemplate } from "./VoicePlaygroundSaveTemplate";
import { VoicePlaygroundVoicePicker } from "./VoicePlaygroundVoicePicker";

type Settings = NonNullable<ComposerDraft["dubbing"]>;
type SavedSource = { scope: DubbingScope; source: DubbingSource };
type Operation = "idle" | "uploading" | "copying" | "quoting" | "submitting";
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const languageOptions = [...new Set(["en", "vi", ...DUBBING_TARGET_LANGUAGES, "mi", "tl"])].map(
  (value) => ({ value, label: languageNames.of(value) || value }),
);
const targetOptions = languageOptions.filter((option) =>
  DUBBING_TARGET_LANGUAGES.includes(option.value),
);
const jsonKey = (input: Settings) =>
  JSON.stringify([
    input.sourceId,
    input.sourceLanguage,
    input.targetLanguage,
    input.provider,
    input.voiceId,
    input.voiceLanguage,
  ]);

function DubbingLanguage({
  id,
  label,
  value,
  target,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  target?: boolean;
  onChange: (value: string) => void;
}) {
  const items = target ? targetOptions : languageOptions;
  return (
    <Field>
      <FieldLabel variant="form" htmlFor={id}>
        {label}
      </FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(value) => {
          if (value) onChange(value);
        }}
      >
        <SelectTrigger size="readable" id={id} className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent finalFocus>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

export function VoicePlaygroundDubbing({
  pg,
  entries,
}: {
  pg: VoicePlaygroundClientState;
  entries: readonly UnifiedPlaygroundEntry[];
}) {
  const errorRef = useRef<HTMLDivElement>(null);
  const id = useId(),
    fileInput = useRef<HTMLInputElement>(null),
    uploadController = useRef<AbortController | null>(null),
    preview = useRef<HTMLMediaElement | null>(null);
  const attachPreview = useCallback((node: HTMLMediaElement | null) => {
    if (preview.current && preview.current !== node) releaseNativeAudition(preview.current);
    preview.current = node;
  }, []);
  const [source, setSource] = useState<SavedSource | null>(null),
    [receipt, setReceipt] = useState<SavedSource | null>(null),
    [operation, setOperation] = useState<Operation>("idle"),
    [sourceTab, setSourceTab] = useState("upload"),
    [replacingSource, setReplacingSource] = useState(false),
    [recordingUid, setRecordingUid] = useState("");
  const [error, setError] = useState(""),
    [quote, setQuote] = useState<DubbingJob | null>(null),
    [quotedKey, setQuotedKey] = useState(""),
    [consent, setConsent] = useState(false),
    [startedAt, setStartedAt] = useState(0),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [error]);

  const settings: Settings = {
    sourceLanguage: "en",
    targetLanguage: "vi",
    provider: pg.draft.provider ?? "elevenlabs",
    voiceId: pg.draft.voiceId,
    voiceName: pg.draft.voiceName,
    ...pg.draft.dubbing,
  };
  const scope = pg.scope ?? "project",
    receiptKey = `voice-playground:dubbing-upload:${globalThis.location?.origin ?? "studio"}:${S.film}:${scope}`;
  const busy = operation !== "idle",
    quoteValid = quote?.phase === "prepared" && quotedKey === jsonKey(settings);
  const sourcePrepared = source?.source.phase === "prepared";
  const recordingOptions = recordingSourceOptions(
    entries
      .filter((entry) => entry.audioUrl)
      .map((entry) => ({
        id: entry.uid,
        title: entry.title,
        voiceName: entry.voiceName,
        durationSeconds: entry.durationSeconds,
        scope: entry.playgroundItem?.scope ?? entry.sourceRecording?.scope,
      })),
  );
  const selectedRecording = entries.find((entry) => entry.uid === recordingUid);
  const updateSettings = (patch: Partial<Settings>) => {
    setComposerDraft({ dubbing: { ...settings, ...patch } });
    setQuote(null);
    setConsent(false);
    setError("");
  };
  const remember = (saved: SavedSource) => {
    setReceipt(saved);
    try {
      localStorage.setItem(receiptKey, JSON.stringify(saved));
    } catch {
      setError(
        `Source is saved on the server. Browser recovery storage is unavailable; keep source ID ${saved.source.id}.`,
      );
    }
  };
  const ready = (saved: SavedSource) => {
    setSource(saved);
    setReplacingSource(false);
    remember(saved);
    const current = getPlaygroundSnapshot().draft;
    setComposerDraft({
      dubbing: { ...settings, ...current.dubbing, sourceId: saved.source.id },
      dubbingSourceScope: saved.scope,
    });
    setQuote(null);
    setConsent(false);
  };
  useEffect(() => {
    if (operation !== "uploading" && operation !== "copying") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [operation]);
  useEffect(
    () => () => {
      uploadController.current?.abort();
    },
    [],
  );
  const sourceId = pg.draft.dubbing?.sourceId,
    requestedScope = pg.draft.dubbingSourceScope ?? pg.draft.templateScope ?? scope;
  useEffect(() => {
    const controller = new AbortController();
    let saved: SavedSource | null = null;
    try {
      const raw = localStorage.getItem(receiptKey);
      if (raw) saved = JSON.parse(raw);
    } catch {}
    const requestedId = sourceId || saved?.source?.id,
      sourceScope = sourceId ? requestedScope : (saved?.scope ?? requestedScope);
    if (requestedId)
      void dubbingRequest<{ source: DubbingSource }>(
        `sources/${encodeURIComponent(requestedId)}`,
        sourceScope,
        { signal: controller.signal },
      )
        .then(({ source: found }) => {
          const value = { source: found, scope: sourceScope };
          setReceipt(value);
          if (found.phase === "prepared") {
            setSource(value);
            if (!sourceId)
              setComposerDraft((draft) => ({
                ...draft,
                dubbing: {
                  sourceLanguage: "en",
                  targetLanguage: "vi",
                  provider: draft.provider,
                  voiceId: draft.voiceId,
                  ...draft.dubbing,
                  sourceId: found.id,
                },
                dubbingSourceScope: sourceScope,
              }));
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : "Choose the original file again.");
        });
    return () => controller.abort();
  }, [sourceId, requestedScope, receiptKey]);
  const upload = async (file: File) => {
    const controller = new AbortController();
    uploadController.current = controller;
    setOperation("uploading");
    setError("");
    setStartedAt(Date.now());
    setNow(Date.now());
    setQuote(null);
    setConsent(false);
    const same =
      receipt?.scope === scope &&
      receipt.source.filename === file.name &&
      receipt.source.bytes === file.size &&
      receipt.source.lastModified === file.lastModified;
    try {
      const staged = await stageDubbingUpload(file, scope, {
        sourceId: same ? receipt.source.id : undefined,
        signal: controller.signal,
        onProgress: (source) => remember({ source, scope }),
      });
      ready({ source: staged, scope });
    } catch (cause) {
      setError(
        controller.signal.aborted
          ? "Upload paused. Choose the same original file to continue from its saved parts."
          : cause instanceof TypeError
            ? "Couldn't reach Studio. Reconnect and choose the same file to resume the upload."
            : cause instanceof Error
              ? cause.message
              : "Upload interrupted. Choose the same original file to resume.",
      );
    } finally {
      setOperation("idle");
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const reuse = async (asset: "audio" | "source") => {
    if (!selectedRecording) return;
    setOperation("copying");
    setError("");
    setStartedAt(Date.now());
    setNow(Date.now());
    try {
      const item =
        selectedRecording.playgroundItem ??
        selectedRecording.sourceRecording ??
        (await archiveFilmTake(selectedRecording, scope));
      if (!item) throw Error("Save this film take as a recording before using it as a source.");
      const sourceScope = item.scope ?? "project",
        { source } = await dubbingPost<{ source: DubbingSource }>("sources", sourceScope, {
          itemId: item.id,
          asset,
        });
      ready({ source, scope: sourceScope });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to reuse the saved recording");
    } finally {
      setOperation("idle");
    }
  };
  const chooseVoice = (voice: PickedVoice) => {
    const provider = voice.provider ?? "elevenlabs",
      nativeId = provider === "minimax" ? voice.dubbingVoiceId : voice.id;
    if (!nativeId) {
      setError(
        "This MiniMax voice has no verified Dubbing identity. Choose another catalog voice, or enter its native Dubbing ID in Advanced.",
      );
      return;
    }
    const voiceLanguage =
      voice.language === "Vietnamese" ? "vi" : voice.language === "English" ? "en" : voice.language;
    const next = {
      ...settings,
      provider,
      voiceId: nativeId,
      voiceName: voice.name,
      voiceLanguage,
      ...(provider === "minimax" ? { ttsVoiceId: voice.id } : { ttsVoiceId: undefined }),
    };
    setComposerDraft({
      dubbing: next,
      provider,
      voiceId: voice.id,
      voiceName: voice.name,
      modelId: DUBBING_MODELS[provider],
    });
    setQuote(null);
    setConsent(false);
    setError("");
  };
  const prepare = async () => {
    if (busy || !source || source.source.phase !== "prepared") return;
    setError("");
    setConsent(false);
    setOperation("quoting");
    try {
      let sourceId = source.source.id;
      if (source.scope !== scope) {
        const copied = await dubbingPost<{ source: DubbingSource }>("sources", scope, {
          sourceId,
          sourceScope: source.scope,
        });
        sourceId = copied.source.id;
        ready({ source: copied.source, scope });
      }
      const input = { ...settings, sourceId },
        parsed = DubbingInput.safeParse(input);
      if (!parsed.success)
        throw Error(
          parsed.error.issues[0]?.message || "Check the source, languages and target voice.",
        );
      const { job } = await dubbingPost<{ job: DubbingJob }>("", scope, parsed.data);
      setComposerDraft({ dubbing: input, dubbingSourceScope: scope });
      acceptDubbingJob(job);
      setQuote(job);
      setQuotedKey(jsonKey(input));
    } catch (cause) {
      setQuote(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to prepare a quote. Check the source and voice.",
      );
    } finally {
      setOperation("idle");
    }
  };
  const submit = async () => {
    if (!quote || !quoteValid || !consent || busy) return;
    setOperation("submitting");
    setError("");
    try {
      const { job } = await dubbingPost<{ job: DubbingJob }>(
        `${encodeURIComponent(quote.id)}/submit`,
        scope,
      );
      acceptDubbingJob(job);
      setQuote(null);
      setConsent(false);
      say("Dubbing started. Its source and progress are saved; you can keep working.");
    } catch (cause) {
      setQuote(null);
      setConsent(false);
      setError(
        `${cause instanceof Error ? cause.message : "Submission response unconfirmed"} Open Jobs and check this saved attempt before starting another paid request.`,
      );
    } finally {
      setOperation("idle");
    }
  };
  const staged = source?.source,
    checkingSource = Boolean(sourceId && !staged && !receipt && !error),
    showSourcePicker = !checkingSource && (!staged || replacingSource),
    uploading = receipt?.source,
    progress = uploading
      ? Math.min(uploading.bytes, uploading.uploaded.length * uploading.chunkSize)
      : 0;
  const originalUrl = staged
    ? `/api/voice/playground/dubbing/sources/${encodeURIComponent(staged.id)}/file?scope=${source.scope}`
    : "";
  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <div className="min-h-0 flex-1 scroll-pb-6 overflow-y-auto overscroll-contain p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground max-w-prose">
            Keep your original. Create another language version without replacing earlier
            recordings.
          </p>
          <VoicePlaygroundSaveTemplate pg={pg} />
        </div>
        <fieldset
          disabled={operation === "quoting" || operation === "submitting"}
          className="min-w-0"
        >
          <FieldGroup>
            <Field>
              <FieldLabel variant="form">Original audio or video</FieldLabel>
              {staged && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="done">
                      <Check />
                      Source ready
                    </Badge>
                    <span className="text-foreground break-words">{staged.filename}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {staged.durationSeconds?.toFixed(2)}s ·{" "}
                      {source.scope === "global" ? "Global" : "Project"}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-disabled={busy}
                      aria-expanded={replacingSource}
                      aria-controls={replacingSource ? `${id}-replacement-source` : undefined}
                      onClick={() => {
                        if (!busy) setReplacingSource((value) => !value);
                      }}
                    >
                      {replacingSource ? "Cancel replacement" : "Replace source"}
                    </Button>
                  </div>
                  {staged.hasVideo ? (
                    <video
                      ref={attachPreview}
                      src={originalUrl}
                      controls
                      preload="metadata"
                      aria-label="Original Dubbing source video"
                      onPlay={(event) => playNativeAudition(event.currentTarget)}
                      className="bg-backdrop aspect-video max-h-64 w-full rounded-lg"
                    />
                  ) : (
                    <audio
                      ref={attachPreview}
                      src={originalUrl}
                      controls
                      preload="metadata"
                      aria-label="Original Dubbing source audio"
                      onPlay={(event) => playNativeAudition(event.currentTarget)}
                      className="w-full"
                    />
                  )}
                </div>
              )}
              {checkingSource && (
                <p role="status" className="text-muted-foreground text-sm">
                  Checking saved source…
                </p>
              )}
              {showSourcePicker && (
                <div id={`${id}-replacement-source`} className="flex flex-col gap-3">
                  {staged && <p className="text-muted-foreground text-sm">Choose a replacement source.</p>}
                  <ToggleGroup
                    variant="pick"
                    size="lg"
                    value={[sourceTab]}
                    aria-label={staged ? "Replacement source type" : "Dubbing source type"}
                    onValueChange={(values) => {
                      if (!values[0]) return;
                      setSourceTab(values[0]);
                      setError("");
                    }}
                  >
                    <ToggleGroupItem value="upload">
                      <Upload />
                      Upload file
                    </ToggleGroupItem>
                    <ToggleGroupItem value="recording">
                      <FolderOpen />
                      Saved recording
                    </ToggleGroupItem>
                  </ToggleGroup>
                  {sourceTab === "upload" ? (
                    <div className="border-hairline bg-surface-subtle flex flex-col gap-3 rounded-lg border p-4">
                      <Input
                        ref={fileInput}
                        type="file"
                        id={`${id}-file`}
                        aria-label="Upload original Dubbing source"
                        accept=".mp3,.wav,.aac,.m4a,.mp4,.mov"
                        disabled={busy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void upload(file);
                        }}
                      />
                      <FieldDescription className="max-w-[59ch]">
                        MP3, WAV, AAC, M4A, MP4 or MOV · up to 2 GB and 2.5 hours. Uploading and
                        measuring are free.
                      </FieldDescription>
                      {receipt && receipt.source.phase !== "prepared" && (
                        <p className="text-muted-foreground text-sm">
                          Saved upload: {receipt.source.filename}. Choose the same file to resume.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <Select
                        items={recordingOptions}
                        value={recordingUid || null}
                        onValueChange={(value) => {
                          setRecordingUid(value ?? "");
                          setError("");
                        }}
                      >
                        <SelectTrigger
                          size="readable"
                          className="h-9 w-full"
                          aria-label="Recording to dub"
                        >
                          <SelectValue placeholder="Choose a Project or Global recording…" />
                        </SelectTrigger>
                        <SelectContent finalFocus>
                          <SelectGroup>
                            {recordingOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant={sourcePrepared ? "secondary" : "default"}
                          disabled={!selectedRecording || busy}
                          onClick={() => void reuse("audio")}
                        >
                          Use recording audio · free
                        </Button>
                        {(selectedRecording?.playgroundItem ?? selectedRecording?.sourceRecording)
                          ?.dubbing?.sourceFile && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void reuse("source")}
                          >
                            Use its original source
                          </Button>
                        )}
                      </div>
                      {!recordingOptions.length && (
                        <FieldDescription>
                          Create or archive a recording first, or upload the original file.
                        </FieldDescription>
                      )}
                    </div>
                  )}
                </div>
              )}
              {operation === "uploading" && (
                <div role="status" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span>Saving upload · {Math.floor((now - startedAt) / 1000)}s</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => uploadController.current?.abort()}
                    >
                      <Pause />
                      Pause upload
                    </Button>
                  </div>
                  <progress
                    className="accent-primary h-2 w-full"
                    max={uploading?.bytes ?? 1}
                    value={progress}
                    aria-label="Original source upload progress"
                  />
                  <span className="text-muted-foreground tabular-nums">
                    {(progress / 1024 ** 2).toFixed(1)} /{" "}
                    {((uploading?.bytes ?? 0) / 1024 ** 2).toFixed(1)} MB saved
                  </span>
                </div>
              )}
              {operation === "copying" && (
                <p role="status" className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                  Copying the saved source · {Math.floor((now - startedAt) / 1000)}s
                </p>
              )}
            </Field>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
              <DubbingLanguage
                id={`${id}-source-language`}
                label="Source language"
                value={settings.sourceLanguage}
                onChange={(sourceLanguage) => updateSettings({ sourceLanguage })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Swap source and target languages"
                onClick={() =>
                  updateSettings({
                    sourceLanguage: settings.targetLanguage,
                    targetLanguage: settings.sourceLanguage,
                  })
                }
              >
                <ArrowLeftRight />
              </Button>
              <DubbingLanguage
                id={`${id}-target-language`}
                label="Dub into"
                target
                value={settings.targetLanguage}
                onChange={(targetLanguage) => updateSettings({ targetLanguage })}
              />
            </div>
            <Field>
              <FieldLabel variant="form">Target voice</FieldLabel>
              <VoicePlaygroundVoicePicker
                onBrowseAll={() => browseCastingVoices({ mode: "dubbing" })}
                selectedId={settings.ttsVoiceId || settings.voiceId}
                selectedName={settings.voiceName || settings.voiceId}
                selectedProvider={settings.provider}
                defaultVoices={pg.catalog.defaultVoices}
                sharedSearch={pg.sharedSearch}
                configured={pg.status.configured}
                onSearchShared={searchLiveSharedVoices}
                onLoadMoreShared={() => void loadMoreSharedVoices()}
                onSelect={chooseVoice}
                fullWidth
              />
              <FieldDescription>
                {settings.provider === "minimax"
                  ? "MiniMax"
                  : settings.provider === "capcut"
                    ? "CapCut"
                    : "ElevenLabs"}{" "}
                · {DUBBING_MODELS[settings.provider ?? "minimax"]}. CapCut voices must match the
                target language.
              </FieldDescription>
            </Field>
            <details className="border-hairline rounded-lg border p-3">
              <summary className="text-foreground focus-visible:outline-ring cursor-pointer rounded text-sm font-medium focus-visible:outline-2">
                Advanced · native voice identity
              </summary>
              <FieldGroup className="mt-4">
                <Field>
                  <FieldLabel variant="form" htmlFor={`${id}-native-id`}>
                    Dubbing voice ID
                  </FieldLabel>
                  <Input
                    id={`${id}-native-id`}
                    value={settings.voiceId}
                    onChange={(event) => updateSettings({ voiceId: event.target.value })}
                  />
                  <FieldDescription>
                    MiniMax uses its native uniq_id or clone UUID here. Its numeric TTS voice ID is
                    different.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </details>
          </FieldGroup>
        </fieldset>
        {error && (
          <Alert ref={errorRef} tabIndex={-1} variant="warn" role="alert" className="mt-5">
            <AlertTitle>Check this before continuing</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <footer className="border-hairline bg-card flex flex-none flex-col gap-3 border-t px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Field orientation="horizontal" className="w-auto">
            <FieldLabel variant="form" htmlFor={`${id}-destination`}>
              Save new Dubbing to
            </FieldLabel>
            <Select
              value={scope}
              items={[
                { value: "project", label: S.film || "This project" },
                { value: "global", label: "Global · every project" },
              ]}
              disabled={busy}
              onValueChange={(value) => {
                if (value === "project" || value === "global") {
                  setPlaygroundScope(value);
                  setQuote(null);
                  setConsent(false);
                }
              }}
            >
              <SelectTrigger size="readable" id={`${id}-destination`} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent finalFocus>
                <SelectGroup>
                  <SelectItem value="project">{S.film || "This project"}</SelectItem>
                  <SelectItem value="global">Global · every project</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Button
            variant="secondary"
            disabled={busy || !sourcePrepared}
            onClick={() => void prepare()}
          >
            {operation === "quoting" ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" />
            ) : (
              <FileAudio />
            )}
            Prepare quote · free
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            50 credits per source second · charged on submission
          </p>
          <p className="text-foreground text-lg font-semibold tabular-nums">
            {quoteValid && typeof quote?.estimatedCredits === "number"
              ? `${quote.estimatedCredits.toLocaleString()} credits`
              : operation === "copying" || operation === "uploading"
                ? "Preparing the source for a quote…"
                : operation === "quoting"
                  ? "Preparing quote…"
                  : sourcePrepared
                    ? "Prepare a quote"
                    : "Add a source to get a quote"}
          </p>
        </div>
        <Field orientation="horizontal">
          <Checkbox
            id={`${id}-consent`}
            checked={consent}
            disabled={!quoteValid || busy}
            onCheckedChange={(value) => setConsent(value === true)}
          />
          <FieldLabel htmlFor={`${id}-consent`} variant="row">
            <span className="tabular-nums">
              {quoteValid && typeof quote?.estimatedCredits === "number"
                ? `I approve the estimated charge of ${quote.estimatedCredits.toLocaleString()} credits.`
                : "Prepare a quote to review and approve its cost."}
            </span>
          </FieldLabel>
        </Field>
        <div className="flex items-center gap-3">
          <Button
            size="xl"
            className="min-w-48 flex-1"
            disabled={!pg.status.configured || busy || !quoteValid || !consent}
            onClick={() => void submit()}
          >
            {operation === "submitting" ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Languages />
            )}
            {operation === "submitting" ? "Starting Dubbing…" : "Generate Dubbing"}
          </Button>
          <Button variant="ghost" onClick={() => setPlaygroundSubTab("jobs")}>
            View Jobs
          </Button>
        </div>
        {!pg.status.configured && (
          <p className="text-warn-text text-sm">
            Connect GenVoice from the sidebar to generate. Local source preparation remains free.
          </p>
        )}
      </footer>
    </div>
  );
}
