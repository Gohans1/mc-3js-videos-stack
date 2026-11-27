import {
  ArrowLeft,
  Check,
  Clock3,
  History,
  Loader2,
  RotateCcw,
  Scissors,
  Sparkles,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { PlaygroundRegionEdit } from "../../src/voice-playground-contract";
import {
  defaultProviderModel,
  providerForModel,
  providerLanguageOptions,
} from "../../src/voice-playground-providers.mjs";
import { recordingRootId } from "../../src/voice-playground-text.mjs";
import type {
  PlaygroundRegionInfo,
  RegionEditInput,
  VoicePlaygroundItem,
} from "../../src/voice-playground.mjs";
import { S } from "../core/state";
import { useDialogModal } from "../core/store";
import {
  auditionProgress,
  auditionSnapshot,
  auditionTarget,
  listening,
  listenUrl,
  stopAudition,
  subscribeAudition,
} from "./sound";
import {
  closeRecordingEditor,
  inspectFilmRecordingRegion,
  inspectRecordingRegion,
  loadMoreSharedVoices,
  loadRecordingVersions,
  previewRecordingRegion,
  resumeRecordingVersion,
  saveRecordingVersion,
  searchLiveSharedVoices,
  useVoicePlaygroundSelector,
  type VoicePlaygroundClientState,
} from "./voice-playground-client";
import { quoteGeneration } from "./voice-playground-pricing";
import { buildUnifiedEntries } from "./voice-playground-view";
import {
  recordingEditRecipe,
  regionGenerationRecipe,
  replaceUniquePhrase,
  samePhraseGeneration,
  wordRangeSelection,
} from "./voice-region-view";
import type { PickedVoice } from "./VoiceCastingRow";
import { VoicePlaygroundJobQueue } from "./VoicePlaygroundJobQueue";
import { VoicePlaygroundUseTake } from "./VoicePlaygroundUseTake";
import { VoicePlaygroundVoicePicker } from "./VoicePlaygroundVoicePicker";
import { VoiceRecordingEdits } from "./VoiceRecordingEdits";
import {
  RegionNumberField as NumberField,
  RegionWaveform as Waveform,
} from "./VoiceRegionControls";
import { VoicePaidActionConfirmation, voiceBillingNotice } from "./VoiceSpeechConfirmation";
import { VoicePlaybackIcon } from "./VoicePlaybackIcon";

type EditorTarget = Omit<NonNullable<VoicePlaygroundClientState["regionEditor"]>, "returnToWorkbench">;

type Operation =
  | { status: "idle"; error: string }
  | { status: "previewing"; startedAt: number; abort: AbortController }
  | { status: "submitting"; startedAt: number }
  | {
      status: "waiting";
      startedAt: number | null;
      jobId: string;
      input: RegionEditInput;
      replacementItemId?: string;
    };
type WordSelection =
  | { mode: "word"; lastIndex: number | null }
  | { mode: "range"; startIndex: number | null };
type Loaded =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; info: PlaygroundRegionInfo; history: VoicePlaygroundItem[] };

type SectionDraft = {
  mode: "local" | "regenerate";
  selection: number[];
  wordSelection: WordSelection;
  rate: number;
  pitch: number;
  gainDb: number;
  pause: number;
  replacementText: string;
  fullText: string;
  fit: boolean;
  voice: PickedVoice;
  modelId: string;
  languageCode: string;
  name: string;
  reviewedScript: string | null;
};

const sectionDrafts = new Map<string, SectionDraft>();

function RegionEditorBody({
  item,
  filmSource,
  initialEdit,
  revisionOf,
  failedJobId,
  onSelect,
}: EditorTarget & { onSelect: (target: EditorTarget) => void }) {
  const id = useId();
  const draftKey = JSON.stringify([
    S.film,
    item.scope ?? "project",
    item.id,
    item.audioFile,
    initialEdit,
    revisionOf,
    failedJobId,
  ]);
  const [reopenedDraft] = useState(() => sectionDrafts.get(draftKey));
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [operation, setOperation] = useState<Operation>(
    failedJobId && initialEdit
      ? { status: "waiting", startedAt: null, jobId: failedJobId, input: initialEdit }
      : { status: "idle", error: "" },
  );
  const error = operation.status === "idle" ? operation.error : "";
  const startedAt = operation.status === "idle" ? null : operation.startedAt;
  const [reviewPhrase, setReviewPhrase] = useState<"default" | "none" | null>(null);
  const [reviewedScript, setReviewedScript] = useState<string | null>(
    reopenedDraft?.reviewedScript ?? null,
  );
  const saveButton = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"local" | "regenerate">(
    reopenedDraft?.mode ?? initialEdit?.mode ?? "local",
  );
  const [selection, setSelection] = useState(
    reopenedDraft?.selection ??
      (initialEdit ? [initialEdit.from, initialEdit.to] : [0, Math.min(item.durationSeconds || 1, 1)]),
  );
  const [wordSelection, setWordSelection] = useState<WordSelection>(
    reopenedDraft?.wordSelection ?? { mode: "word", lastIndex: null },
  );
  const [rate, setRate] = useState(
      reopenedDraft?.rate ?? (initialEdit?.mode === "local" ? (initialEdit.rate ?? 1) : 1),
    ),
    [pitch, setPitch] = useState(reopenedDraft?.pitch ?? initialEdit?.pitch ?? 0),
    [gainDb, setGainDb] = useState(reopenedDraft?.gainDb ?? initialEdit?.gainDb ?? 0),
    [pause, setPause] = useState(reopenedDraft?.pause ?? initialEdit?.pause ?? 0);
  const recipe = initialEdit?.mode === "regenerate" ? initialEdit : null;
  const [replacementText, setReplacementText] = useState(
      reopenedDraft?.replacementText ?? recipe?.replacementText ?? "",
    ),
    [fullText, setFullText] = useState(reopenedDraft?.fullText ?? recipe?.fullText ?? item.text),
    [fit, setFit] = useState(reopenedDraft?.fit ?? (recipe?.fitToSelection !== false));
  const [voice, setVoice] = useState<PickedVoice>(
    reopenedDraft?.voice ?? {
      provider: recipe?.provider ?? (item.provider === "google" ? undefined : item.provider),
      language: recipe?.languageCode ?? item.languageCode,
      id: recipe?.voiceId ?? item.voiceId,
      name: recipe?.voiceName ?? item.voiceName,
    },
  );
  const [modelId, setModelId] = useState(
    reopenedDraft?.modelId ??
      recipe?.modelId ??
      (item.kind === "voice_changer" ? "eleven_v4" : item.modelId || "eleven_v4"),
  );
  const [languageCode, setLanguageCode] = useState(
    reopenedDraft?.languageCode ?? recipe?.languageCode ?? item.languageCode,
  );
  const [name, setName] = useState(
    reopenedDraft?.name ??
      `${revisionOf || item.title} · ${revisionOf ? "revised" : "edited"}`.slice(0, 120),
  );
  const [now, setNow] = useState(Date.now);
  const [preview, setPreview] = useState<{
    url: string;
    key: string;
    duration: number;
    region: number;
  } | null>(null);
  const previewRef = useRef(preview),
    operationRef = useRef(operation);
  const resultRef = useRef<HTMLElement>(null);
  const pg = useVoicePlaygroundSelector((state) => state);
  useSyncExternalStore(subscribeAudition, auditionSnapshot, auditionSnapshot);
  const info = loaded.status === "ready" ? loaded.info : null;
  const from = selection[0]!,
    to = selection[1]!;
  const replacementRecipe = regionGenerationRecipe(
    item,
    recipe,
    voice,
    modelId,
    pg.catalog,
    languageCode,
  );
  const replacementConnected =
    replacementRecipe.connection === "genvoice"
      ? pg.status.configured
      : pg.status.connections?.[replacementRecipe.connection]?.configured;
  const replacementLanguages = providerLanguageOptions(
    replacementRecipe.provider ?? "elevenlabs",
    pg.catalog,
    pg.catalog.models.find((model) => model.model_id === replacementRecipe.modelId),
  );
  const input: RegionEditInput =
    mode === "local"
      ? { mode, from, to, rate, pitch, gainDb, pause, blendMs: initialEdit?.blendMs ?? 6, name }
      : {
          mode,
          from,
          to,
          pitch,
          gainDb,
          pause,
          blendMs: initialEdit?.blendMs ?? 6,
          name,
          replacementText,
          fullText,
          fitToSelection: fit,
          ...replacementRecipe,
        };
  const key = JSON.stringify({ mode, from, to, rate, pitch, gainDb, pause });
  const activePreview = preview?.key === key ? preview : null;
  const job =
    operation.status === "waiting"
      ? pg.jobs.find((candidate) => candidate.id === operation.jobId)
      : undefined;
  const saved =
    job?.status === "completed"
      ? pg.items.find((candidate) => candidate.id === job.itemId)
      : undefined;
  useLayoutEffect(() => {
    if (operation.status === "waiting" && job?.status !== "failed") {
      sectionDrafts.delete(draftKey);
      return;
    }
    sectionDrafts.set(draftKey, {
      mode, selection, wordSelection, rate, pitch, gainDb, pause, replacementText,
      fullText, fit, voice, modelId, languageCode, name, reviewedScript,
    });
  }, [
    draftKey, operation.status, job?.status, mode, selection, wordSelection, rate,
    pitch, gainDb, pause, replacementText, fullText, fit, voice, modelId, languageCode, name,
    reviewedScript,
  ]);
  const replacementId =
    operation.status === "waiting"
      ? (operation.replacementItemId ??
        job?.regionEdit?.replacementItemId ??
        pg.jobs.find(
          (candidate) =>
            candidate.parentJobId === operation.jobId && candidate.status === "completed",
        )?.itemId)
      : undefined;
  const reusablePhrase =
    job?.status === "failed" &&
    operation.status === "waiting" &&
    replacementId &&
    pg.items.some((candidate) => candidate.id === replacementId) &&
    samePhraseGeneration(operation.input, input)
      ? replacementId
      : undefined;
  const busy =
    operation.status === "previewing" ||
    operation.status === "submitting" ||
    (operation.status === "waiting" && !saved && job?.status !== "failed");
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const affectedWords = info?.words.filter((word) => word.s < to && word.e > from) ?? [];
  const selectedPhrase = affectedWords
    .filter((word) => word.s >= from && word.e <= to)
    .map((word) => word.w)
    .join(" ");
  const updatedScript = affectedWords.every((word) => word.s >= from && word.e <= to)
    ? replaceUniquePhrase(item.text, selectedPhrase, replacementText)
    : null;
  const scriptReviewKey = useMemo(
    () => JSON.stringify([from, to, replacementText, fullText]),
    [from, to, replacementText, fullText],
  );
  const needsScriptReview = mode === "regenerate" && updatedScript?.trim() !== fullText.trim();
  const scriptConfirmed = reviewedScript === scriptReviewKey;
  const validSelection = Boolean(info && from >= 0 && to > from && to <= info.durationSeconds);
  const valid = Boolean(
    info &&
    PlaygroundRegionEdit.safeParse(input).success &&
    to <= info.durationSeconds &&
    (mode === "local" ||
      (replacementText.trim() &&
        fullText.trim() &&
        voice.id &&
        (!fit || pause < to - from) &&
        (!needsScriptReview || scriptConfirmed))),
  );
  const cannotSave =
    !saved && (!valid || (mode === "regenerate" && !replacementConnected && !reusablePhrase));
  const quote = quoteGeneration(
    { mode: "tts", text: replacementText, modelId: replacementRecipe.modelId },
    pg.catalog.models,
  );
  const regionModels =
    replacementRecipe.connection === "genvoice"
      ? pg.catalog.models
      : pg.serviceCatalogs?.[replacementRecipe.connection]?.catalog?.models;
  const regionModelName =
    regionModels?.find((model) => model.model_id === replacementRecipe.modelId)?.name ??
    replacementRecipe.modelId;
  const regionEstimate =
    replacementRecipe.connection === "genvoice" && quote.baseCredits !== null
      ? `${quote.baseCredits.toLocaleString()} model credits estimated. `
      : "";
  const rootId = filmSource && info ? info.id : recordingRootId(item);
  const history = useMemo(
    () =>
      Array.from(
        new Map(
          [
            ...(loaded.status === "ready" ? loaded.history : []),
            ...pg.items.filter((candidate) => recordingRootId(candidate) === rootId),
          ].map((candidate) => [candidate.id, candidate]),
        ).values(),
      ).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [loaded, pg.items, rootId],
  );
  useEffect(() => {
    let cancelled = false;
    const region = filmSource
      ? inspectFilmRecordingRegion(filmSource.takeId).then(({ info, items }) => [info, items] as const)
      : Promise.all([inspectRecordingRegion(item), loadRecordingVersions(item)]);
    void region
      .then(([info, history]) => {
        if (cancelled) return;
        setLoaded({ status: "ready", info, history });
        if (!initialEdit && !reopenedDraft) setSelection([0, Math.min(info.durationSeconds, 1)]);
      })
      .catch((error) => {
        if (!cancelled) setLoaded({ status: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [item, initialEdit, filmSource, reopenedDraft]);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);
  useEffect(() => {
    operationRef.current = operation;
  }, [operation]);
  useEffect(() => {
    if (auditionTarget().startsWith("region:preview:")) stopAudition();
  }, [key]);
  useEffect(
    () => () => {
      if (operationRef.current.status === "previewing") operationRef.current.abort.abort();
      if (auditionTarget().startsWith("region:")) stopAudition();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    },
    [],
  );
  const audioUrl =
    filmSource?.audioUrl ??
    `/api/voice/playground/audio/${encodeURIComponent(item.audioFile)}?scope=${item.scope ?? "project"}`;
  const editSource = filmSource && info ? { takeId: filmSource.takeId, sourceId: info.id } : undefined;
  const originalId = `region:original:${item.id}:${from}:${to}`;
  const previewId = `region:preview:${item.id}`;
  const heardAt = auditionProgress(info?.durationSeconds ?? item.durationSeconds).at;
  const playhead =
    auditionTarget() === originalId
      ? heardAt
      : auditionTarget() === previewId && activePreview
        ? Math.max(from, Math.min(to, from + (heardAt - from) * rate))
        : undefined;
  const changeSelection = (next: number[]) => {
    if (auditionTarget().startsWith("region:")) stopAudition();
    setSelection(next);
  };
  const preparePreview = async (eventTime: number) => {
    if (!valid || busy || mode !== "local") return;
    const abort = new AbortController();
    const previewOp: Operation = {
      status: "previewing",
      startedAt: performance.timeOrigin + eventTime,
      abort,
    };
    operationRef.current = previewOp;
    setOperation(previewOp);
    const timeout = setTimeout(() => abort.abort(), 180000);
    let nextError = "";
    try {
      const result = await previewRecordingRegion(item, input, abort.signal, editSource);
      if (abort.signal.aborted) return;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
      const next = {
        url: URL.createObjectURL(result.blob),
        key,
        duration: result.durationSeconds,
        region: result.regionSeconds,
      };
      setPreview(next);
      listenUrl(previewId, next.url, { from, to: Math.min(next.duration, from + next.region) });
    } catch (cause) {
      if (!abort.signal.aborted)
        nextError = cause instanceof Error ? cause.message : "Preview failed; try again";
      else nextError = "Preview stopped. Try a shorter recording.";
    } finally {
      clearTimeout(timeout);
      setOperation({ status: "idle", error: nextError });
    }
  };
  const save = async (eventTime: number) => {
    if (!valid || busy) return;
    const started = performance.timeOrigin + eventTime;
    setOperation({ status: "submitting", startedAt: started });
    stopAudition();
    try {
      const savedSourceId = filmSource && job?.regionEdit?.itemId;
      const original = savedSourceId ? { ...item, id: savedSourceId } : item;
      const queued = reusablePhrase
        ? await resumeRecordingVersion(original, input, reusablePhrase)
        : await saveRecordingVersion(item, input, editSource);
      sectionDrafts.delete(draftKey);
      setOperation({
        status: "waiting",
        startedAt: started,
        jobId: queued.id,
        input,
        replacementItemId: reusablePhrase,
      });
    } catch (cause) {
      setOperation({
        status: "idle",
        error: cause instanceof Error ? cause.message : "Could not save; try again",
      });
    }
  };
  const entry = saved ? buildUnifiedEntries([saved], [], new Set())[0] : undefined;
  return (
    <>
      <div
        role="region"
        aria-label="Section editing controls"
        tabIndex={0}
        className="focus-visible:ring-ring min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset sm:p-6"
      >
        {loaded.status === "loading" && (
          <p role="status" className="text-muted-foreground flex items-center gap-2 py-8">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            Loading waveform and versions…
          </p>
        )}
        {loaded.status === "error" && (
          <p role="alert" className="text-destructive-text">
            {loaded.message}
          </p>
        )}
        {info && (
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="flex min-w-0 flex-col gap-5">
              {revisionOf && !saved && (
                <p className="border-primary/25 bg-tint text-foreground rounded-lg border p-3 text-sm leading-relaxed">
                  Adjusting the settings from “{revisionOf}” on its original source. Saving keeps
                  both versions.
                </p>
              )}
              <VoiceRecordingEdits item={item} />
              {!saved && (
                <>
                  <section
                    aria-label="Choose a section"
                    className="border-hairline flex flex-col gap-3 rounded-xl border p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-foreground flex items-center gap-2 text-base leading-tight font-semibold">
                        <Scissors className="text-primary-text size-4" />
                        1. Choose a section
                      </h3>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {(to - from).toFixed(2)}s selected / {info.durationSeconds.toFixed(2)}s
                      </span>
                    </div>
                    <Waveform info={info} from={from} to={to} playhead={playhead} />
                    {playhead !== undefined && (
                      <p aria-hidden="true" className="text-muted-foreground text-xs tabular-nums">
                        {listening() ? "Playing" : "Paused"} · {playhead.toFixed(2)}s in the
                        original recording
                      </p>
                    )}
                    <Slider
                      aria-label="Selected audio section"
                      thumbLabels={["Section start", "Section end"]}
                      value={selection}
                      min={0}
                      max={info.durationSeconds}
                      step={0.01}
                      minStepsBetweenValues={1}
                      appearance="accent"
                      onValueChange={(value) => changeSelection(value as number[])}
                      disabled={busy}
                    />
                    <div className="grid w-full max-w-lg grid-cols-2 gap-3">
                      <NumberField
                        label="Start"
                        unit="seconds"
                        value={from}
                        min={0}
                        max={to - 0.01}
                        onChange={(value) =>
                          changeSelection([Math.max(0, Math.min(to - 0.01, value)), to])
                        }
                        disabled={busy}
                      />
                      <NumberField
                        label="End"
                        unit="seconds"
                        value={to}
                        min={from + 0.01}
                        max={info.durationSeconds}
                        onChange={(value) =>
                          changeSelection([
                            from,
                            Math.min(info.durationSeconds, Math.max(from + 0.01, value)),
                          ])
                        }
                        disabled={busy}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => listenUrl(originalId, audioUrl, { from, to })}
                        disabled={!validSelection || busy}
                      >
                        <VoicePlaybackIcon playing={listening() === originalId} className="size-3.5" />
                        Listen to original section
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => changeSelection([0, info.durationSeconds])}
                        disabled={busy}
                      >
                        Whole recording
                      </Button>
                    </div>
                    {info.words.length ? (
                      <details open>
                        <summary className="text-primary-text focus-visible:outline-ring cursor-pointer rounded text-sm font-medium focus-visible:outline-2">
                          Select words to edit ({info.words.length})
                        </summary>
                        <div
                          role="group"
                          aria-label="Word selection mode"
                          className="mt-3 flex flex-wrap gap-2"
                        >
                          <Button
                            size="sm"
                            variant={wordSelection.mode === "word" ? "lit" : "secondary"}
                            aria-pressed={wordSelection.mode === "word"}
                            disabled={busy}
                            onClick={() => setWordSelection({ mode: "word", lastIndex: null })}
                          >
                            One word
                          </Button>
                          <Button
                            size="sm"
                            variant={wordSelection.mode === "range" ? "lit" : "secondary"}
                            aria-pressed={wordSelection.mode === "range"}
                            disabled={busy}
                            onClick={() => setWordSelection({ mode: "range", startIndex: null })}
                          >
                            Word range
                          </Button>
                        </div>
                        <p role="status" className="text-muted-foreground mt-2 text-xs">
                          {wordSelection.mode === "range"
                            ? wordSelection.startIndex === null
                              ? "Select the first word, then the last word."
                              : "Now select the last word of the phrase."
                            : "Click a word to select its recorded timing."}
                        </p>
                        <div className="mt-2 flex max-h-36 flex-wrap gap-1 overflow-y-auto">
                          {info.words.map((word, index) => (
                            <Button
                              key={index}
                              size="sm"
                              variant={word.s >= from && word.e <= to ? "lit" : "ghost"}
                              disabled={busy}
                              aria-pressed={word.s >= from && word.e <= to}
                              onClick={(event) => {
                                const anchor =
                                  wordSelection.mode === "range"
                                    ? wordSelection.startIndex
                                    : event.shiftKey
                                      ? wordSelection.lastIndex
                                      : null;
                                const span = wordRangeSelection(
                                  info.words,
                                  anchor !== null ? anchor : index,
                                  index,
                                );
                                if (!span) return;
                                changeSelection([
                                  span.from,
                                  Math.min(info.durationSeconds, span.to),
                                ]);
                                setReplacementText(span.text);
                                setWordSelection(
                                  wordSelection.mode === "range"
                                    ? {
                                        mode: "range",
                                        startIndex: wordSelection.startIndex !== null ? null : index,
                                      }
                                    : { mode: "word", lastIndex: index },
                                );
                              }}
                            >
                              {word.w}
                            </Button>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <p className="text-reading-foreground max-w-[59ch] text-xs leading-relaxed text-pretty">
                        No word alignment recorded. Use the waveform and seconds; the app will not
                        guess where a word starts.
                      </p>
                    )}
                  </section>
                  {activePreview && (
                    <p role="status" className="text-ok-text text-sm">
                      Preview ready · {activePreview.duration.toFixed(2)}s total · selected section{" "}
                      {activePreview.region.toFixed(2)}s. Use Play edited section below to compare.
                    </p>
                  )}
                  <section className="@container/region-settings flex flex-col gap-3" aria-label="Edit settings">
                    <h3 className="text-foreground text-base leading-tight font-semibold">
                      2. Adjust the selected section
                    </h3>
                    <ToggleGroup
                      variant="pick"
                      size="lg"
                      value={[mode]}
                      aria-label="Editing method"
                      onValueChange={([value]) => {
                        if (value === "local" || value === "regenerate") setMode(value);
                      }}
                    >
                      <ToggleGroupItem value="local" disabled={busy}>
                        <Scissors />
                        Local edit · free
                      </ToggleGroupItem>
                      <ToggleGroupItem value="regenerate" disabled={busy}>
                        <Sparkles />
                        Regenerate phrase
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <p className="text-reading-foreground max-w-[59ch] text-sm leading-relaxed text-pretty">
                      {mode === "local"
                        ? "Keep the performance. Change timing, pitch or volume without spending GenVoice credits."
                        : "Generate a replacement phrase and save a new version. Listen to the saved version before replacing a film line."}
                    </p>
                    {mode === "regenerate" && (
                      <>
                        <div className="grid min-w-0 items-start gap-4 @[40rem]/region-settings:grid-cols-2">
                          <div className="flex min-w-0 flex-col gap-3">
                            <Field>
                              <FieldLabel htmlFor={`${id}-phrase`}>Replacement phrase</FieldLabel>
                              <Textarea
                                id={`${id}-phrase`}
                                dir="auto"
                                variant="script"
                                className="max-w-[60ch]"
                                value={replacementText}
                                onChange={(event) => setReplacementText(event.target.value)}
                                disabled={busy}
                                placeholder="The words to read again; audio tags are supported."
                                maxLength={40000}
                              />
                            </Field>
                            {selectedPhrase && (
                              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                                <span>Selected words: {selectedPhrase}</span>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy || !replacementText.trim() || updatedScript === null}
                                  onClick={() => {
                                    if (updatedScript !== null) setFullText(updatedScript);
                                  }}
                                >
                                  Update full script
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="flex min-w-0 flex-col gap-3">
                            <Field>
                              <FieldLabel htmlFor={`${id}-script`}>
                                Full script after replacement
                              </FieldLabel>
                              <Textarea
                                id={`${id}-script`}
                                dir="auto"
                                variant="script"
                                className="max-w-[60ch]"
                                value={fullText}
                                onChange={(event) => setFullText(event.target.value)}
                                disabled={busy}
                                maxLength={40000}
                              />
                              <p className="text-reading-foreground max-w-[59ch] text-xs leading-relaxed text-pretty">
                                This is the script saved with the new audio. Transcribe the new version
                                to get updated word timing and subtitles.
                              </p>
                            </Field>
                            {needsScriptReview && (
                              <Field className="max-w-[59ch]">
                                <Field orientation="horizontal">
                                  <Checkbox
                                    id={`${id}-script-confirmed`}
                                    checked={scriptConfirmed}
                                    disabled={busy || !replacementText.trim() || !fullText.trim()}
                                    onCheckedChange={(confirmed) =>
                                      setReviewedScript(confirmed === true ? scriptReviewKey : null)
                                    }
                                  />
                                  <FieldLabel htmlFor={`${id}-script-confirmed`} variant="form">
                                    I checked the full script against the replacement phrase
                                  </FieldLabel>
                                </Field>
                                <p className="text-reading-foreground text-xs leading-relaxed text-pretty">
                                  Update the script to include the replacement phrase. Keep the same
                                  script if you’re having the same words read again.
                                </p>
                              </Field>
                            )}
                          </div>
                        </div>
                        {replacementRecipe.connection !== "genvoice" ? (
                          <p className="text-muted-foreground text-xs">
                            This phrase uses the saved{" "}
                            {replacementRecipe.connection === "google"
                              ? "Google Gemini"
                              : "ElevenLabs"}{" "}
                            voice and model.
                          </p>
                        ) : (
                          <>
                            <VoicePlaygroundVoicePicker
                              selectedId={voice.id}
                              selectedName={voice.name}
                              defaultVoices={pg.catalog.defaultVoices}
                              sharedSearch={pg.sharedSearch}
                              configured={pg.status.configured}
                              fullWidth
                              onSearchShared={(query) => void searchLiveSharedVoices(query)}
                              onLoadMoreShared={() => void loadMoreSharedVoices()}
                              selectedProvider={voice.provider}
                              onSelect={(selected) => {
                                setVoice(selected);
                                if (
                                  (voice.provider ?? "elevenlabs") !==
                                  (selected.provider ?? "elevenlabs")
                                )
                                  setModelId(
                                    defaultProviderModel(selected.provider ?? "elevenlabs"),
                                  );
                              }}
                            />
                            <Field>
                              <FieldLabel htmlFor={`${id}-model`}>Replacement model</FieldLabel>
                              <Select
                                items={pg.catalog.models
                                  .filter(
                                    (model) =>
                                      model.can_do_text_to_speech &&
                                      (model.provider ?? providerForModel(model.model_id)) ===
                                        (voice.provider ?? "elevenlabs"),
                                  )
                                  .map((model) => ({ value: model.model_id, label: model.name }))}
                                value={replacementRecipe.modelId}
                                onValueChange={(value) => setModelId(value || "eleven_v4")}
                                disabled={busy}
                              >
                                <SelectTrigger id={`${id}-model`} className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent finalFocus>
                                  <SelectGroup>
                                    {pg.catalog.models
                                      .filter(
                                        (model) =>
                                          model.can_do_text_to_speech &&
                                          (model.provider ?? providerForModel(model.model_id)) ===
                                            (voice.provider ?? "elevenlabs"),
                                      )
                                      .map((model) => (
                                        <SelectItem key={model.model_id} value={model.model_id}>
                                          {model.name}
                                        </SelectItem>
                                      ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${id}-language`}>
                                Replacement language
                              </FieldLabel>
                              <Select
                                items={replacementLanguages.map((language) => ({
                                  value: language.code,
                                  label: language.name,
                                }))}
                                value={replacementRecipe.languageCode}
                                onValueChange={(language) => language && setLanguageCode(language)}
                                disabled={busy}
                              >
                                <SelectTrigger id={`${id}-language`} className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent finalFocus>
                                  {replacementLanguages.map((language) => (
                                    <SelectItem key={language.code} value={language.code}>
                                      {language.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </Field>
                          </>
                        )}
                        <label
                          htmlFor={`${id}-fit`}
                          className="text-foreground flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            id={`${id}-fit`}
                            checked={fit}
                            onCheckedChange={setFit}
                            disabled={busy}
                          />
                          Fit the phrase into the original time slot
                        </label>
                      </>
                    )}
                    <div className="grid w-full max-w-3xl grid-cols-2 gap-3 xl:grid-cols-4">
                      {mode === "local" && (
                        <NumberField
                          label="Speed"
                          unit="× · pitch preserved"
                          min={0.25}
                          max={4}
                          step={0.05}
                          value={rate}
                          onChange={setRate}
                          disabled={busy}
                        />
                      )}
                      <NumberField
                        label="Pitch"
                        hint="Lower or higher voice"
                        unit="semitones"
                        value={pitch}
                        min={-24}
                        max={24}
                        step={1}
                        onChange={setPitch}
                        disabled={busy}
                      />
                      <NumberField
                        label="Volume"
                        hint="Quieter or louder"
                        unit="dB"
                        value={gainDb}
                        min={-30}
                        max={12}
                        step={1}
                        onChange={setGainDb}
                        disabled={busy}
                      />
                      <NumberField
                        label="Pause after section"
                        unit="seconds"
                        value={pause}
                        min={0}
                        max={5}
                        step={0.05}
                        onChange={setPause}
                        disabled={busy}
                      />
                    </div>
                    <p className="text-reading-foreground max-w-[59ch] text-xs leading-relaxed text-pretty">
                      {(initialEdit?.blendMs ?? 6) > 0
                        ? `A ${initialEdit?.blendMs ?? 6} ms blend smooths the join inside your selection.`
                        : "No blend is applied at the join."}{" "}
                      Outside audio stays unchanged; if the section changes length, following audio
                      moves with it.
                    </p>
                    <Field>
                      <FieldLabel htmlFor={`${id}-name`}>Version name</FieldLabel>
                      <Input
                        id={`${id}-name`}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        maxLength={120}
                        disabled={busy}
                      />
                    </Field>
                  </section>
                </>
              )}
              {(error || job?.error) && (
                <p
                  role="alert"
                  className="text-destructive-text bg-destructive/10 rounded-md p-3 text-sm"
                >
                  <span className="block">{error || job?.error}</span>
                  {job?.status === "failed" && !reusablePhrase && mode === "regenerate" && (
                    <span className="mt-1 block">
                      The edit was not saved. Choose another voice or try again later. A new
                      generation may cost credits.
                    </span>
                  )}
                </p>
              )}
              {reusablePhrase && !saved && (
                <p className="text-primary-text bg-tint rounded-lg p-3 text-sm leading-relaxed">
                  Your generated phrase is already saved. Adjust the selection, turn off fitting or
                  change the local edits, then finish for free.
                </p>
              )}
              {job && busy && <VoicePlaygroundJobQueue jobs={[job]} items={pg.items} />}
              {saved && (
                <section
                  ref={resultRef}
                  tabIndex={-1}
                  role="status"
                  className="border-ok-text/30 bg-ok/10 flex flex-col gap-3 rounded-xl border p-4"
                >
                  <h3 className="text-ok-text flex items-center gap-2 font-semibold">
                    <Check className="size-4" />
                    Version saved · original kept
                  </h3>
                  <p className="text-foreground text-sm break-words">
                    {saved.title} · {saved.durationSeconds.toFixed(2)}s ·{" "}
                    {saved.creditsDeducted === undefined
                      ? "Actual fee not reported"
                      : `${saved.creditsDeducted} credits`}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      listenUrl(
                        `region:saved:${saved.id}`,
                        `/api/voice/playground/audio/${encodeURIComponent(saved.audioFile)}?scope=${saved.scope ?? "project"}`,
                      )
                    }
                  >
                    <VoicePlaybackIcon playing={listening() === `region:saved:${saved.id}`} className="size-3.5" />
                    {listening() === `region:saved:${saved.id}`
                      ? "Pause saved version"
                      : "Listen to saved version"}
                  </Button>
                  {entry && <VoicePlaygroundUseTake entry={entry} secondary />}
                  <VoiceRecordingEdits item={saved} compact />
                  <Button variant="secondary" onClick={() => onSelect({ item: saved })}>
                    Edit this version
                  </Button>
                </section>
              )}
            </div>
            <aside
              aria-label="Version history"
              className="border-hairline bg-surface-subtle flex h-fit min-w-0 flex-col gap-3 rounded-xl border p-4 lg:sticky lg:top-0"
            >
              <h3 className="text-foreground flex items-center gap-2 text-base leading-tight font-semibold">
                <History className="text-primary-text size-4" />
                Version history
              </h3>
              <p className="text-reading-foreground max-w-[59ch] text-xs leading-relaxed text-pretty">
                Every save keeps its parent. Open any version to listen or use it in the film; no
                overwrite is needed to restore it.
              </p>
              {history.map((version, index) => (
                <div
                  key={version.id}
                  className={cn(
                    "border-hairline flex min-w-0 flex-col gap-2 rounded-lg border p-3",
                    version.id === item.id && "border-primary/40 bg-tint",
                  )}
                >
                  <p className="text-foreground text-sm font-medium break-words">
                    {version.retry && !version.version
                      ? "New take · "
                      : index === 0 && !version.version
                        ? "Original · "
                        : ""}
                    {version.title}
                  </p>
                  <span className="text-muted-foreground flex items-center gap-1 text-xs tabular-nums">
                    <Clock3 className="size-3" />
                    {version.durationSeconds.toFixed(2)}s ·{" "}
                    {version.scope === "global" ? "Global" : "Project"}
                    {version.id === item.id && " · Editing"}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        listenUrl(
                          `region:history:${version.id}`,
                          `/api/voice/playground/audio/${encodeURIComponent(version.audioFile)}?scope=${version.scope ?? "project"}`,
                        )
                      }
                    >
                      <VoicePlaybackIcon playing={listening() === `region:history:${version.id}`} className="size-3.5" />
                      {listening() === `region:history:${version.id}` ? "Pause" : "Listen"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || version.id === item.id}
                      onClick={() => onSelect({ item: version })}
                    >
                      <RotateCcw />
                      Open
                    </Button>
                  </div>
                  <VoiceRecordingEdits
                    item={version}
                    compact
                    onAdjust={
                      !busy &&
                      version.version?.parentId &&
                      history.some((candidate) => candidate.id === version.version?.parentId)
                        ? () => {
                            const parent = history.find(
                                (candidate) => candidate.id === version.version?.parentId,
                              ),
                              edit = recordingEditRecipe(version);
                            if (parent && edit)
                              onSelect({
                                item: parent,
                                initialEdit: edit,
                                revisionOf: version.title,
                              });
                          }
                        : undefined
                    }
                  />
                  {version.id === item.id && (
                    <VoicePlaygroundUseTake
                      secondary
                      entry={buildUnifiedEntries([version], [], new Set())[0]!}
                    />
                  )}
                </div>
              ))}
            </aside>
          </div>
        )}
      </div>
      <footer className="border-hairline bg-surface-subtle flex flex-none flex-wrap items-center justify-between gap-3 border-t p-3 sm:px-6">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-reading-foreground max-w-[59ch] text-xs leading-relaxed text-pretty tabular-nums">
            {saved
              ? saved.creditsDeducted === undefined
                ? "Saved · actual fee not reported"
                : `Saved · actual fee ${saved.creditsDeducted} credits`
              : reusablePhrase
                ? "Finish with the saved phrase · no extra credits"
                : mode === "local"
                  ? "Free local processing · original kept"
                  : `Total fee: unknown · model baseline ${quote.baseCredits ?? "unknown"} credits for ${replacementText.trim().length} characters. Voice surcharge unverified.`}
          </p>
          {!saved && !busy && needsScriptReview && !scriptConfirmed && replacementText.trim() && (
            <p className="text-warn-text text-xs">Confirm the full script before reviewing the cost.</p>
          )}
          {busy && (
            <p role="status" className="text-primary-text text-xs">
              <span>
                {operation.status === "previewing"
                  ? "Preparing local preview"
                  : job?.status === "downloading"
                    ? "Saving audio"
                    : mode === "local"
                      ? "Processing local edit"
                      : "Generating replacement phrase"}
                {job && job.progress > 0 ? ` · ${job.progress}%` : "…"}
              </span>
              {startedAt !== null && (
                <span aria-hidden="true" className="ml-2 tabular-nums">
                  {Math.max(0, Math.floor((now - startedAt) / 1000))}s elapsed
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {mode === "local" && !saved && (
            <Button
              variant="secondary"
              disabled={!valid || Boolean(saved)}
              aria-disabled={!valid || busy || Boolean(saved)}
              onClick={(event) => {
                if (busy || !valid || saved) return;
                if (activePreview) {
                  listenUrl(previewId, activePreview.url, {
                    from,
                    to: Math.min(activePreview.duration, from + activePreview.region),
                  });
                } else void preparePreview(event.timeStamp);
              }}
            >
              {operation.status === "previewing" ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              ) : (
                <VoicePlaybackIcon playing={listening() === previewId} className="size-3.5" />
              )}
              {operation.status === "previewing"
                ? "Preparing preview…"
                : activePreview
                  ? listening() === previewId
                    ? "Pause edited section"
                    : "Play edited section"
                  : "Preview edit · free"}
            </Button>
          )}
          <Button
            ref={saveButton}
            size="xl"
            disabled={cannotSave}
            aria-disabled={cannotSave || busy}
            onClick={(event) => {
              if (cannotSave || busy) return;
              if (saved) {
                resultRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
                resultRef.current?.focus({ preventScroll: true });
              } else if (mode === "regenerate" && !reusablePhrase) {
                setReviewPhrase(event.detail === 0 ? "none" : "default");
              } else void save(event.timeStamp);
            }}
          >
            {busy ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" />
            ) : saved ? (
              <Check />
            ) : mode === "local" ? (
              <Scissors />
            ) : (
              <Sparkles />
            )}
            {busy && operation.status !== "previewing"
              ? mode === "local"
                ? "Saving version…"
                : "Generating phrase…"
              : saved
                ? "Review saved version"
                : reusablePhrase
                  ? "Finish saved phrase · free"
                  : mode === "local"
                    ? "Save new version · free"
                    : "Review phrase cost"}
          </Button>
        </div>
      </footer>
      {reviewPhrase && (
        <VoicePaidActionConfirmation
          action="Generate phrase and save version"
          motion={reviewPhrase}
          description={`${voice.name || voice.id} · ${regionModelName} · ${item.scope === "global" ? "Global" : "This project"}. ${regionEstimate}${voiceBillingNotice(replacementRecipe.connection)} The original recording will be kept.`}
          returnFocus={saveButton}
          onConfirm={(event) => void save(event.timeStamp)}
          onClose={() => setReviewPhrase(null)}
        />
      )}
    </>
  );
}

export function VoiceRegionEditorSurface({
  request,
  closeLabel = "Back to recording",
}: {
  request: EditorTarget;
  closeLabel?: string;
}) {
  const [current, setCurrent] = useState<EditorTarget>(request);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => heading.current?.focus({ preventScroll: true }), []);
  return (
    <section
      aria-label="Recording section editor"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <header className="border-hairline flex flex-none flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0">
          <h3
            ref={heading}
            tabIndex={-1}
            className="text-foreground focus-visible:ring-ring rounded-sm text-lg leading-tight font-semibold wrap-anywhere outline-none focus-visible:ring-2"
          >
            {current.item.title}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {current.item.scope === "global" ? "Global" : "This project"} · Save changes as a new
            version. The original is kept.
          </p>
        </div>
        <Button variant="secondary" onClick={closeRecordingEditor}>
          <ArrowLeft className="rtl:rotate-180" />
          {request.failedJobId ? "Back to Jobs" : closeLabel}
        </Button>
      </header>
      <RegionEditorBody
        key={`${current.item.id}:${current.revisionOf ?? ""}`}
        {...current}
        onSelect={setCurrent}
      />
    </section>
  );
}

export function VoiceRegionEditor() {
  const request = useVoicePlaygroundSelector((state) => state.regionEditor, false);
  const standalone = Boolean(request && !request.returnToWorkbench);
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (standalone) {
      opener.current = request?.openerId ? document.getElementById(request.openerId) : null;
    }
  }, [standalone, request?.openerId]);
  useDialogModal("voiceRegion", standalone);
  return (
    <Dialog
      open={standalone}
      onOpenChange={(open) => {
        if (!open) closeRecordingEditor();
      }}
    >
      <DialogContent
        variant="workbench"
        showCloseButton={false}
        finalFocus={() => (opener.current?.isConnected ? opener.current : true)}
        data-voice-playground
        className="flex h-[min(54rem,94dvh)] max-w-[calc(100%-1rem)] flex-col overflow-hidden sm:max-w-5xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Edit a recording</DialogTitle>
          <DialogDescription>Adjust a section and save a new version.</DialogDescription>
        </DialogHeader>
        {standalone && request && (
          <VoiceRegionEditorSurface
            key={`${request.item.id}:${request.revisionOf ?? ""}`}
            request={request}
            closeLabel="Back to timeline"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
