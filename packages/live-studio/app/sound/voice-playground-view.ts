import { DUBBING_MODELS } from "../../src/voice-playground-dubbing-contract";
import {
  defaultProviderModel,
  languageForProvider,
  providerForModel,
  type ProviderLanguageCatalog,
  providerLanguageOptions,
} from "../../src/voice-playground-providers.mjs";
import {
  DANGEROUS_KEYS,
  detectTextLanguage,
  parseDialogueTurnNames,
  stripDialogueSpeakerBrackets,
} from "../../src/voice-playground-text.mjs";
import type {
  PlaygroundConnection,
  PlaygroundJob,
  PlaygroundModelInfo,
  PlaygroundProvider,
  PlaygroundSttResult,
  PlaygroundTemplate,
  PlaygroundUsage,
  PlaygroundVoiceOption,
  PlaygroundVoiceSettings,
  VoicePlaygroundItem,
} from "../../src/voice-playground.mjs";
import { matcher } from "../core/search";
import type { VoiceFilters } from "./voice-library-view";
import {
  parseTakeScript,
  voiceActorTitle,
  voiceAuditionId,
  type VoiceTakeItem,
} from "./voice-view";

export { detectTextLanguage, parseDialogueTurnNames, stripDialogueSpeakerBrackets };

export type PlaygroundOrigin = "playground" | "film_take" | "template";
export type PlaygroundSourceFilter =
  "all" | "playground" | "film_take" | "templates" | "favorites" | "archive";
export type PlaygroundKindFilter = "all" | "tts" | "dialogue" | "voice_changer" | "stt" | "dubbing";
export type PlaygroundSortKey =
  | "newest"
  | "oldest"
  | "favorites"
  | "longest"
  | "shortest"
  | "voice"
  | "model"
  | "credits"
  | "rating"
  | "used"
  | "relevance";

export interface UnifiedPlaygroundEntry {
  uid: string;
  origin: PlaygroundOrigin;
  id: string;
  kind: "tts" | "dialogue" | "voice_changer" | "stt" | "dubbing";
  template?: PlaygroundTemplate;
  dialogue?: VoicePlaygroundItem["dialogue"];
  title: string;
  text: string;
  spoken: string;
  tags: string[];
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string;
  voiceSettings: PlaygroundVoiceSettings;
  exportTranscript: boolean;
  durationSeconds: number;
  charactersUsed: number;
  creditsDeducted: number;
  favorite: boolean;
  isTemplate: boolean;
  templateName?: string;
  notes?: string;
  auditionId: string;
  audioUrl: string;
  srtFile?: string;
  srtText?: string;
  remoteTaskId?: string;
  createdAt: string;
  playgroundItem?: VoicePlaygroundItem;
  sourceRecording?: VoicePlaygroundItem;
  filmTake?: VoiceTakeItem;
}

export interface PlaygroundFilterState {
  source: PlaygroundSourceFilter;
  kind: PlaygroundKindFilter;
  voiceId: string;
  modelId: string;
  tag: string;
  query: string;
  minRating?: number;
  before?: string;
  after?: string;
  originProject?: string;
  gender?: string;
  length?: "short" | "medium" | "long";
  sort: PlaygroundSortKey;
}

export const DEFAULT_PLAYGROUND_FILTERS: PlaygroundFilterState = {
  source: "all",
  kind: "all",
  voiceId: "all",
  modelId: "all",
  tag: "all",
  query: "",
  sort: "newest",
};

export interface ComposerDialogueSpeaker {
  speechStyle?: string;
  provider?: PlaygroundProvider;
  pitch?: number;
  vol?: number;
  id: string;
  name: string;
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  speed: number;
}

export const snapToDiscreteValue = (val: number, values: readonly number[]): number => {
  if (!values.length) return val;
  let best = values[0]!;
  let dist = Math.abs(val - best);
  for (const v of values) {
    const d = Math.abs(val - v);
    if (d < dist) {
      best = v;
      dist = d;
    }
  }
  return best;
};

export interface ComposerDraft {
  voicePreviewUrl?: string;
  voiceGender?: string;
  recordedSpeech?: {
    modelId: string;
    settings: PlaygroundVoiceSettings;
    normalization?: "auto" | "on" | "off";
  };
  connection?: PlaygroundConnection;
  speechStyle?: string;
  dubbing?: PlaygroundTemplate["draft"]["dubbing"];
  dubbingSourceScope?: "project" | "global";
  provider?: PlaygroundProvider;
  pitch?: number;
  vol?: number;
  templateId?: string;
  templateScope?: "project" | "global";
  mode: "tts" | "dialogue" | "voice_changer" | "stt" | "dubbing";
  title: string;
  text: string;
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  speed: number;
  previousText: string;
  sttLanguageCode: string;
  sttGranularity: "word" | "character" | "none";
  sttDiarize: boolean;
  sttNumSpeakers: string;
  sttDiarizationThreshold: string;
  sttTagEvents: boolean;
  sttNoVerbatim: boolean;
  sttExportSrt: boolean;
  sttTemperature: number;
  sttSeedText: string;
  sttFileFormat: "other" | "pcm_s16le_16";
  sttUseMultiChannel: boolean;
  sttKeytermsText: string;
  sttEntityDetectionText: string;
  sttEntityRedactionText: string;
  sttEntityRedactionMode: "enumerated_entity_type" | "entity_type" | "redacted";
  sttExtraFormats: string[];
  nextText: string;
  seedText: string;
  outputFormat: string;
  applyTextNormalization: "auto" | "on" | "off";
  exportTranscript: boolean;
  variations: number;
  removeBackgroundNoise: boolean;
  vcSourceKind: "upload" | "playground" | "film_take";
  vcSourceFile: string;
  vcSourceItemId: string;
  vcSourceTakeValue: string;
  sttSourceFile?: string;
  sttSourceLabel?: string;
  sttSourceKind: "upload" | "playground" | "film_take";
  sttSourceItemId: string;
  sttSourceTakeValue: string;
  pauseBetweenTurns: number;
  speakers: ComposerDialogueSpeaker[];
  notes: string;
  sourceTakeId?: string;
  fromTemplateId?: string;
}

export const DEFAULT_COMPOSER_DRAFT: ComposerDraft = {
  provider: "elevenlabs",
  pitch: 0,
  vol: 1,
  mode: "tts",
  title: "",
  text: "[hushed] Look closely at what changes [short pause] when you shift the delivery.",
  voiceId: "ZaZosYpkIGmSqOwAlfnk",
  voiceName: "Seff Echo",
  modelId: "eleven_v4",
  languageCode: "",
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  useSpeakerBoost: false,
  speed: 1,
  previousText: "",
  nextText: "",
  seedText: "",
  outputFormat: "",
  applyTextNormalization: "auto",
  exportTranscript: false,
  variations: 1,
  removeBackgroundNoise: true,
  vcSourceKind: "playground",
  vcSourceFile: "",
  vcSourceItemId: "",
  vcSourceTakeValue: "",
  sttSourceKind: "playground",
  sttSourceItemId: "",
  sttSourceTakeValue: "",
  sttLanguageCode: "en",
  sttGranularity: "word",
  sttDiarize: true,
  sttNumSpeakers: "",
  sttDiarizationThreshold: "0.22",
  sttTagEvents: true,
  sttNoVerbatim: false,
  sttExportSrt: true,
  sttTemperature: 0,
  sttSeedText: "",
  sttFileFormat: "other",
  sttUseMultiChannel: false,
  sttKeytermsText: "",
  sttEntityDetectionText: "",
  sttEntityRedactionText: "",
  sttEntityRedactionMode: "enumerated_entity_type",
  sttExtraFormats: [],
  pauseBetweenTurns: 0.5,
  speakers: [
    {
      id: "sp_alex",
      name: "Alex",
      voiceId: "ZaZosYpkIGmSqOwAlfnk",
      voiceName: "Seff Echo",
      modelId: "eleven_v4",
      languageCode: "",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      useSpeakerBoost: false,
      speed: 1,
    },
    {
      id: "sp_riley",
      name: "Riley",
      voiceId: "99Hm6N8psCBzc1JwEVR2",
      voiceName: "Riley",
      modelId: "eleven_v4",
      languageCode: "",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      useSpeakerBoost: false,
      speed: 1,
    },
  ],
  notes: "",
};

export const dialogueCastForConnection = (
  speakers: readonly ComposerDialogueSpeaker[],
  connection: PlaygroundConnection,
): ComposerDialogueSpeaker[] =>
  speakers.map((speaker, index) => {
    const voiceId = connection === "google" ? (["Kore", "Puck"][index] ?? "") : "";
    return { ...speaker, provider: undefined, voiceId, voiceName: voiceId, speechStyle: "" };
  });

export function templateToComposerDraft(template: PlaygroundTemplate): ComposerDraft {
  const raw = structuredClone(template.draft);
  const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : "";
  const provider =
    raw.mode === "dubbing"
      ? (raw.dubbing?.provider ?? "minimax")
      : (raw.provider ?? providerForModel(modelId));
  const voiceId =
    raw.mode === "dubbing"
      ? raw.dubbing?.ttsVoiceId || (provider === "minimax" ? "" : (raw.dubbing?.voiceId ?? ""))
      : typeof raw.voiceId === "string"
        ? raw.voiceId
        : raw.connection === "google"
          ? "Kore"
          : raw.connection !== "elevenlabs" && provider === "elevenlabs"
            ? DEFAULT_COMPOSER_DRAFT.voiceId
            : "";
  return {
    ...structuredClone(DEFAULT_COMPOSER_DRAFT),
    ...raw,
    dubbingSourceScope: raw.mode === "dubbing" ? template.scope : undefined,
    provider,
    modelId:
      raw.mode === "dubbing"
        ? DUBBING_MODELS[provider]
        : modelId ||
          (raw.connection === "google" ? "gemini-3.8-flash-tts" : defaultProviderModel(provider)),
    voiceId,
    voiceName:
      raw.mode === "dubbing" && raw.dubbing?.voiceName
        ? raw.dubbing.voiceName
        : typeof raw.voiceName === "string" && raw.voiceName
          ? raw.voiceName
          : voiceId === DEFAULT_COMPOSER_DRAFT.voiceId
            ? DEFAULT_COMPOSER_DRAFT.voiceName
            : voiceId,
    languageCode:
      raw.mode === "dubbing"
        ? (raw.dubbing?.targetLanguage ?? "vi")
        : typeof raw.languageCode === "string"
          ? raw.languageCode
          : provider === "minimax"
            ? "English"
            : "en",
    speakers: (
      raw.speakers ??
      (raw.connection && raw.connection !== "genvoice" && raw.mode === "dialogue"
        ? dialogueCastForConnection(DEFAULT_COMPOSER_DRAFT.speakers, raw.connection)
        : DEFAULT_COMPOSER_DRAFT.speakers)
    ).map((speaker) => {
      const provider = speaker.provider ?? providerForModel(speaker.modelId);
      return {
        ...DEFAULT_COMPOSER_DRAFT.speakers[0]!,
        ...speaker,
        provider,
        voiceName: speaker.voiceName || speaker.voiceId,
        languageCode: speaker.languageCode ?? (provider === "minimax" ? "English" : "en"),
      };
    }),
    templateId: template.id,
    fromTemplateId: template.id,
    templateScope: template.scope,
  };
}

const templateVoiceSettings = (
  draft: ComposerDialogueSpeaker | ComposerDraft,
): PlaygroundVoiceSettings => ({
  stability: draft.stability,
  similarity_boost: draft.similarityBoost,
  style: draft.style,
  use_speaker_boost: draft.useSpeakerBoost,
  speed: draft.speed,
  pitch: draft.pitch,
  vol: draft.vol,
});

export function withDialogueVoice(
  speaker: ComposerDialogueSpeaker,
  voice: Pick<PlaygroundVoiceOption, "id" | "name" | "provider" | "language">,
  catalog: ProviderLanguageCatalog & { models: readonly PlaygroundModelInfo[] },
): ComposerDialogueSpeaker {
  const selected = withComposerVoice(
    {
      ...DEFAULT_COMPOSER_DRAFT,
      ...speaker,
      mode: "tts",
      languageCode: speaker.languageCode || voice.language || "",
    },
    voice,
    catalog,
  );
  return {
    ...speaker,
    provider: selected.provider,
    voiceId: selected.voiceId,
    voiceName: selected.voiceName,
    modelId: selected.modelId,
    languageCode: speaker.languageCode || voice.language ? selected.languageCode : "",
    speed: selected.speed,
    stability: selected.stability,
  };
}

export function withComposerVoice(
  draft: ComposerDraft,
  voice: Pick<PlaygroundVoiceOption, "id" | "name" | "provider" | "language" | "connection">,
  catalog: ProviderLanguageCatalog & { models: readonly PlaygroundModelInfo[] },
): ComposerDraft {
  const connection = voice.connection ?? "genvoice";
  if (connection !== "genvoice" && draft.mode === "tts") {
    return {
      ...draft,
      connection,
      provider: connection === "elevenlabs" ? "elevenlabs" : undefined,
      voiceId: voice.id,
      voiceName: voice.name,
    };
  }
  const provider = voice.provider ?? "elevenlabs";
  if (draft.mode === "voice_changer" && provider !== "elevenlabs")
    throw new Error("Voice Changer uses ElevenLabs voices. Choose Speech for MiniMax or CapCut.");
  const models = catalog.models.filter(
    (model) =>
      (model.provider ?? providerForModel(model.model_id)) === provider &&
      (draft.mode === "voice_changer"
        ? model.can_do_voice_conversion
        : model.can_do_text_to_speech),
  );
  const model =
    models.find((candidate) => candidate.model_id === draft.modelId) ??
    models.find((candidate) => candidate.model_id === defaultProviderModel(provider)) ??
    models[0];
  const languages = providerLanguageOptions(provider, catalog, model);
  const language = languageForProvider(provider, draft.languageCode || voice.language || "en", [
    ...languages,
    ...catalog.languages,
  ]);
  const voiceLanguage = languageForProvider(provider, voice.language || "en", [
    ...languages,
    ...catalog.languages,
  ]);
  return {
    ...draft,
    provider,
    voiceId: voice.id,
    voiceName: voice.name,
    modelId:
      model?.model_id ||
      (draft.mode === "voice_changer"
        ? "eleven_multilingual_sts_v2"
        : defaultProviderModel(provider)),
    languageCode:
      provider === "elevenlabs" || languages.some((option) => option.code === language)
        ? language
        : (languages.find((option) => option.code === voiceLanguage)?.code ??
          languages.find((option) => option.code === "en" || option.code === "English")?.code ??
          languages[0]?.code ??
          ""),
    speed: Math.min(
      provider === "elevenlabs" ? 1.2 : 2,
      Math.max(provider === "elevenlabs" ? 0.7 : 0.5, draft.speed),
    ),
    stability: model?.stability_values?.length
      ? snapToDiscreteValue(draft.stability, model.stability_values)
      : draft.stability,
    ...(provider !== "elevenlabs"
      ? {
          previousText: "",
          nextText: "",
          seedText: "",
          outputFormat: "",
          applyTextNormalization: "auto" as const,
        }
      : {}),
  };
}

export const voiceSettingsForModel = (
  model: PlaygroundModelInfo | undefined,
  raw: {
    stability: number;
    similarityBoost: number;
    style: number;
    useSpeakerBoost: boolean;
    speed: number;
    pitch?: number;
    vol?: number;
  },
): PlaygroundVoiceSettings => {
  const provider = model?.provider ?? providerForModel(model?.model_id);
  if (provider !== "elevenlabs")
    return {
      speed: Math.min(2, Math.max(0.5, raw.speed ?? 1)),
      pitch: Math.round(Math.min(12, Math.max(-12, raw.pitch ?? 0))),
      ...(provider === "minimax" ? { vol: Math.min(10, Math.max(0.01, raw.vol ?? 1)) } : {}),
    };
  const rawStability = Math.min(1, Math.max(0, Number(raw.stability ?? 0.5)));
  const stability =
    Array.isArray(model?.stability_values) && model.stability_values.length
      ? snapToDiscreteValue(rawStability, model.stability_values)
      : rawStability;
  const out: PlaygroundVoiceSettings = { stability: +stability.toFixed(3) };
  if (model?.supports_similarity !== false) out.similarity_boost = raw.similarityBoost;
  if (model?.can_use_style === true) out.style = raw.style;
  if (model?.can_use_speaker_boost === true) out.use_speaker_boost = raw.useSpeakerBoost;
  if (model?.supports_speed === true) {
    out.speed = +Math.min(1.2, Math.max(0.7, Number(raw.speed ?? 1))).toFixed(3);
  }
  return out;
};

export interface PlaygroundFacetOption {
  id: string;
  label: string;
  count: number;
}

export interface PlaygroundFacets {
  voices: PlaygroundFacetOption[];
  models: PlaygroundFacetOption[];
  tags: PlaygroundFacetOption[];
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const visibleSpeechModel = (models: readonly PlaygroundModelInfo[], modelId: string) =>
  models.find((model) => model.model_id === modelId) ?? models[0];

export const dialogueServiceModels = (
  connection: PlaygroundConnection,
  models: readonly PlaygroundModelInfo[],
) =>
  connection === "elevenlabs"
    ? models.filter((model) => model.model_id === "eleven_v4" || model.model_id === "eleven_v3")
    : models;

export const activeFilmVoices = (
  takes: readonly Pick<VoiceTakeItem, "id" | "file" | "voice">[],
  usage: readonly PlaygroundUsage[],
): Array<{
  voiceId: string;
  provider: PlaygroundUsage["provider"];
  voiceName?: string;
  connection?: PlaygroundConnection;
}> => {
  const result = new Map<
    string,
    {
      voiceId: string;
      provider: PlaygroundUsage["provider"];
      voiceName?: string;
      connection?: PlaygroundConnection;
    }
  >();
  for (const take of takes) {
    if (!take.file) continue;
    const record = usage.find((record) => record.takeId === take.id);
    const voices =
      record?.voices ??
      (record
        ? [record]
        : take.voice
          ? [{ voiceId: take.voice, provider: "elevenlabs" as const }]
          : []);
    for (const voice of voices)
      if (voice.voiceId)
        result.set(
          `${"connection" in voice ? (voice.connection ?? "genvoice") : "genvoice"}:${voice.provider}:${voice.voiceId}`,
          voice,
        );
  }
  return [...result.values()];
};

export const playgroundAuditionId = (id: string) => `pg:${id}`;

export function topLevelPlaygroundJobs(jobs: readonly PlaygroundJob[]) {
  const edits = new Set(jobs.filter((job) => job.kind === "region_edit").map((job) => job.id));
  return jobs.filter((job) => !job.parentJobId || !edits.has(job.parentJobId));
}

export const castingAuditionId = (
  voice: Pick<PlaygroundVoiceOption, "id" | "provider" | "connection">,
) =>
  voice.connection && voice.connection !== "genvoice"
    ? `gv:${voice.connection}:${voice.id}`
    : voice.provider && voice.provider !== "elevenlabs"
      ? `gv:${voice.provider}:${voice.id}`
      : `gv:${voice.id}`;

export function parseVoicePreviewTarget(
  target: string,
): { provider: PlaygroundProvider; id: string; connection?: PlaygroundConnection } | null {
  if (!target.startsWith("gv:")) return null;
  const value = target.slice(3);
  for (const connection of ["elevenlabs", "google"] as const) {
    if (value.startsWith(`${connection}:`)) {
      return { provider: "elevenlabs", connection, id: value.slice(connection.length + 1) };
    }
  }
  for (const provider of ["minimax", "capcut"] as const)
    if (value.startsWith(`${provider}:`)) return { provider, id: value.slice(provider.length + 1) };
  return { provider: "elevenlabs", id: value };
}

export const playgroundAudioUrl = (audioFile: string, scope?: "project" | "global") =>
  `/api/voice/playground/audio/${encodeURIComponent(audioFile)}${scope === "global" ? "?scope=global" : ""}`;

export function recordedFee(
  item:
    | Pick<VoicePlaygroundItem, "actualCost" | "creditsDeducted" | "creditsSource" | "version">
    | undefined,
): string {
  if (item?.actualCost) return `${item.actualCost.amount.toLocaleString()} ElevenLabs credits`;
  if (item?.version?.edit.mode === "local") return "No provider charge";
  return typeof item?.creditsDeducted === "number"
    ? `${item.creditsDeducted.toLocaleString()} credits${item.creditsSource === "processing" || item.creditsSource === "acknowledgement" ? " reported · awaiting final" : ""}`
    : "Unknown fee";
}

export const buildUnifiedEntries = (
  playgroundItems: readonly VoicePlaygroundItem[],
  filmTakes: readonly VoiceTakeItem[],
  starredUids: ReadonlySet<string>,
  templates: readonly PlaygroundTemplate[] = [],
): UnifiedPlaygroundEntry[] => {
  const entries: UnifiedPlaygroundEntry[] = [];

  for (const item of playgroundItems) {
    const parsed = parseTakeScript(item.text || "");
    const tags = item.tags?.length ? item.tags : parsed.tags;
    entries.push({
      uid: `pg:${item.id}`,
      origin: "playground",
      id: item.id,
      kind: item.kind,
      title: item.title || parsed.spoken || item.id,
      text: item.text || "",
      spoken: parsed.spoken || item.text || "",
      tags,
      voiceId: item.voiceId,
      voiceName:
        item.voiceName && item.voiceName !== item.voiceId
          ? item.voiceName
          : item.connection && item.connection !== "genvoice"
            ? item.voiceId
            : voiceActorTitle(item.voiceId),
      modelId: item.modelId || "Unknown model",
      languageCode: item.languageCode || "",
      voiceSettings: item.voiceSettings ?? {},
      exportTranscript: Boolean(item.exportTranscript),
      durationSeconds: item.durationSeconds ?? 0,
      charactersUsed: item.charactersUsed ?? item.text?.length ?? 0,
      creditsDeducted: item.creditsDeducted ?? 0,
      favorite: Boolean(item.favorite),
      isTemplate: Boolean(item.isTemplate),
      templateName: item.templateName,
      notes: item.notes,
      auditionId: playgroundAuditionId(item.id),
      audioUrl: item.audioFile ? playgroundAudioUrl(item.audioFile, item.scope) : "",
      srtFile: item.srtFile,
      srtText: item.srtText,
      remoteTaskId: item.remoteTaskId,
      createdAt: item.createdAt || "",
      playgroundItem: item,
      dialogue: item.dialogue,
    });
  }

  for (const take of filmTakes) {
    const uid = `take:${take.id}`;
    const saved = entries.find(
      (entry) =>
        entry.origin === "playground" &&
        entry.id === take.playgroundItemId &&
        (entry.playgroundItem?.scope ?? "project") === (take.playgroundScope ?? "project"),
    );
    if (saved) {
      entries.push({
        ...saved,
        sourceRecording: saved.playgroundItem,
        playgroundItem: undefined,
        uid,
        id: take.id,
        origin: "film_take",
        title: `Take ${take.id}: ${saved.spoken}`,
        favorite: starredUids.has(uid),
        isTemplate: false,
        auditionId: take.file ? voiceAuditionId("takes", take.file) : "",
        audioUrl: take.file ? `/api/voice/audio/takes/${encodeURIComponent(take.file)}` : "",
        durationSeconds: take.seconds ?? saved.durationSeconds,
        filmTake: take,
      });
      continue;
    }
    const parsed = parseTakeScript(take.text || "");
    const vId = take.voice || "ZaZosYpkIGmSqOwAlfnk";
    const spoken = parsed.spoken || take.text || "";
    const voiceSettings: PlaygroundVoiceSettings = {
      ...(typeof take.stability === "number" ? { stability: take.stability } : { stability: 0.5 }),
      ...(typeof take.speed === "number" ? { speed: take.speed } : { speed: 1 }),
    };
    entries.push({
      uid,
      origin: "film_take",
      id: take.id,
      kind: "tts",
      title: `Take ${take.id}: ${spoken}`,
      text: take.text || "",
      spoken,
      tags: parsed.tags,
      voiceId: vId,
      voiceName: voiceActorTitle(vId),
      modelId: take.model || "eleven_v4",
      languageCode: "",
      voiceSettings,
      exportTranscript: false,
      durationSeconds: take.seconds ?? 0,
      charactersUsed: (take.text || "").length,
      creditsDeducted: 0,
      favorite: starredUids.has(uid),
      isTemplate: false,
      notes: take.guide ? `Guide: ${take.guide}` : undefined,
      auditionId: take.file ? voiceAuditionId("takes", take.file) : "",
      audioUrl: take.file ? `/api/voice/audio/takes/${encodeURIComponent(take.file)}` : "",
      createdAt: "",
      filmTake: take,
    });
  }

  for (const template of templates) {
    const draft = templateToComposerDraft(template);
    const primary = draft.mode === "dialogue" ? draft.speakers[0] : undefined;
    const directDialogue =
      draft.mode === "dialogue" && draft.connection && draft.connection !== "genvoice";
    entries.push({
      uid: `preset:${template.id}`,
      origin: "template",
      id: template.id,
      kind: draft.mode,
      title: template.title,
      text: draft.mode === "stt" ? "" : draft.text,
      spoken:
        draft.mode === "stt"
          ? draft.sttSourceLabel || "Choose a transcription source"
          : parseTakeScript(draft.text).spoken,
      tags: draft.mode === "stt" ? [] : parseTakeScript(draft.text).tags,
      voiceId: draft.mode === "stt" ? "" : (primary?.voiceId ?? draft.voiceId),
      voiceName:
        draft.mode === "stt"
          ? "Scribe v2"
          : draft.mode === "dialogue"
            ? draft.speakers.map((speaker) => `${speaker.name} (${speaker.voiceName})`).join(" / ")
            : draft.voiceName,
      modelId:
        draft.mode === "stt"
          ? "scribe_v2"
          : directDialogue
            ? draft.modelId
            : (primary?.modelId ?? draft.modelId),
      languageCode:
        draft.mode === "stt"
          ? draft.sttLanguageCode
          : directDialogue
            ? draft.languageCode
            : (primary?.languageCode ?? draft.languageCode),
      voiceSettings: draft.mode === "stt" ? {} : templateVoiceSettings(draft),
      ...(draft.mode === "dialogue"
        ? {
            dialogue: {
              ...(draft.connection && draft.connection !== "genvoice"
                ? {}
                : { pause_between_turns: draft.pauseBetweenTurns }),
              speakers: Object.fromEntries(
                draft.speakers.map((speaker) => [
                  speaker.name,
                  {
                    provider: speaker.provider,
                    voice_id: speaker.voiceId,
                    voice_name: speaker.voiceName,
                    ...(speaker.speechStyle ? { speech_style: speaker.speechStyle } : {}),
                    model_id: directDialogue ? draft.modelId : speaker.modelId,
                    language_code: directDialogue ? draft.languageCode : speaker.languageCode,
                    ...(!directDialogue ? { voice_settings: templateVoiceSettings(speaker) } : {}),
                  },
                ]),
              ),
            },
          }
        : {}),
      exportTranscript: draft.exportTranscript,
      durationSeconds: 0,
      charactersUsed: 0,
      creditsDeducted: 0,
      favorite: template.favorite,
      isTemplate: true,
      auditionId: "",
      audioUrl: "",
      createdAt: template.createdAt,
      template,
    });
  }
  return entries;
};

export const uniqueCastingGroups = (groups: readonly (readonly PlaygroundVoiceOption[])[]) => {
  const seen = new Set<string>();
  return groups.map((group) =>
    group.filter((voice) => {
      const key = castingAuditionId(voice);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
};

export const savedFavoriteEntries = (entries: readonly UnifiedPlaygroundEntry[], query: string) => {
  const term = query.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      entry.favorite &&
      (!term ||
        [entry.title, entry.spoken, entry.voiceName, entry.modelId, entry.notes, ...entry.tags]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(term)),
  );
};

export const extractPlaygroundFacets = (
  entries: readonly UnifiedPlaygroundEntry[],
): PlaygroundFacets => {
  const voiceMap = new Map<string, { label: string; count: number }>();
  const modelMap = new Map<string, number>();
  const tagMap = new Map<string, number>();

  for (const e of entries) {
    if (e.voiceId) {
      const cur = voiceMap.get(e.voiceId);
      if (cur) cur.count++;
      else voiceMap.set(e.voiceId, { label: e.voiceName || e.voiceId, count: 1 });
    }
    if (e.modelId) {
      modelMap.set(e.modelId, (modelMap.get(e.modelId) ?? 0) + 1);
    }
    for (const t of e.tags) {
      tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
    }
  }

  return {
    voices: [...voiceMap.entries()]
      .map(([id, v]) => ({ id, label: v.label, count: v.count }))
      .sort((a, b) => COLLATOR.compare(a.label, b.label)),
    models: [...modelMap.entries()]
      .map(([id, count]) => ({ id, label: id, count }))
      .sort((a, b) => b.count - a.count || COLLATOR.compare(a.id, b.id)),
    tags: [...tagMap.entries()]
      .map(([id, count]) => ({ id, label: id, count }))
      .sort((a, b) => b.count - a.count || COLLATOR.compare(a.id, b.id)),
  };
};

export const filterAndSortEntries = (
  entries: readonly UnifiedPlaygroundEntry[],
  filters: PlaygroundFilterState,
  useCount?: ReadonlyMap<string, number>,
): UnifiedPlaygroundEntry[] => {
  const hit = matcher(filters.query);
  const filtered = entries.filter((e) => {
    const archived = Boolean(e.playgroundItem?.archivedAt || e.template?.archivedAt);
    if (archived !== (filters.source === "archive")) return false;
    if (filters.source === "playground" && e.origin !== "playground") return false;
    if (filters.source === "film_take" && e.origin !== "film_take") return false;
    if (filters.source === "templates" && !e.isTemplate) return false;
    if (filters.source === "favorites" && !e.favorite) return false;
    if (filters.kind !== "all" && e.kind !== filters.kind) return false;
    if (filters.voiceId !== "all" && e.voiceId !== filters.voiceId) return false;
    if (filters.modelId !== "all" && e.modelId !== filters.modelId) return false;
    if (filters.tag !== "all" && !e.tags.includes(filters.tag)) return false;
    if (
      filters.minRating &&
      (e.playgroundItem?.rating ?? e.template?.rating ?? 0) < filters.minRating
    )
      return false;
    if (filters.after && (!e.createdAt || e.createdAt.slice(0, 10) < filters.after)) return false;
    if (filters.before && (!e.createdAt || e.createdAt.slice(0, 10) > filters.before)) return false;
    if (filters.originProject && e.playgroundItem?.originProject !== filters.originProject)
      return false;
    if (filters.gender && e.playgroundItem?.voiceGender?.toLowerCase() !== filters.gender)
      return false;
    if (filters.length === "short" && !(e.durationSeconds > 0 && e.durationSeconds <= 10))
      return false;
    if (filters.length === "medium" && !(e.durationSeconds > 10 && e.durationSeconds < 30))
      return false;
    if (filters.length === "long" && e.durationSeconds < 30) return false;
    if (filters.query.trim()) {
      const hay = [
        e.id,
        e.title,
        e.text,
        e.voiceName,
        e.voiceId,
        e.modelId,
        e.templateName ?? "",
        e.notes ?? "",
        e.playgroundItem?.description ?? "",
        e.tags.join(" "),
      ].join(" ");
      if (!hit(hay)) return false;
    }
    return true;
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    switch (filters.sort) {
      case "oldest":
        return (a.createdAt || "9999").localeCompare(b.createdAt || "9999");
      case "favorites":
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      case "longest":
        return b.durationSeconds - a.durationSeconds;
      case "shortest":
        return a.durationSeconds - b.durationSeconds;
      case "voice":
        return COLLATOR.compare(a.voiceName, b.voiceName);
      case "model":
        return COLLATOR.compare(a.modelId, b.modelId);
      case "credits":
        return b.creditsDeducted - a.creditsDeducted;
      case "used":
        return (useCount?.get(b.id) ?? 0) - (useCount?.get(a.id) ?? 0);
      case "rating":
        return (
          (b.playgroundItem?.rating ?? b.template?.rating ?? 0) -
          (a.playgroundItem?.rating ?? a.template?.rating ?? 0)
        );
      case "newest":
      default:
        if (a.origin !== b.origin) return a.origin === "playground" ? -1 : 1;
        if (a.origin === "playground") return (b.createdAt || "").localeCompare(a.createdAt || "");
        return COLLATOR.compare(a.id, b.id);
    }
  });
  return sorted;
};

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

export const nextTabId = <T extends string>(
  tabs: readonly T[],
  current: string,
  key: string,
): T | null => {
  if (!tabs.length) return null;
  const idx = tabs.findIndex((tab) => tab === current);
  const base = idx >= 0 ? idx : 0;
  if (key === "ArrowRight") return tabs[(base + 1) % tabs.length]!;
  if (key === "ArrowLeft") return tabs[(base - 1 + tabs.length) % tabs.length]!;
  if (key === "Home") return tabs[0]!;
  if (key === "End") return tabs[tabs.length - 1]!;
  return null;
};

export const composeFilmTakeRemixPreset = (
  take: VoiceTakeItem,
  source?: VoicePlaygroundItem,
): Partial<ComposerDraft> =>
  source
    ? {
        ...entryToComposerDraft(buildUnifiedEntries([source], [], new Set())[0]!),
        title: `Take ${take.id} remix`,
        sourceTakeId: take.id,
      }
    : {
        mode: "tts",
        provider: providerForModel(take.model),
        title: `Take ${take.id} remix`,
        text: take.text,
        voiceId: take.voice || "ZaZosYpkIGmSqOwAlfnk",
        voiceName: voiceActorTitle(take.voice),
        modelId: take.model || "eleven_v4",
        languageCode: languageForProvider(
          providerForModel(take.model),
          detectTextLanguage(take.text || ""),
          [
            { code: "en", name: "English" },
            { code: "vi", name: "Vietnamese" },
          ],
        ),
        stability: take.stability ?? 0.5,
        speed: take.speed ?? 1,
        sourceTakeId: take.id,
      };

export interface SafeDialogueSpeakerEntry {
  speech_style?: string;
  provider?: PlaygroundProvider;
  name: string;
  voice_id: string;
  voice_name?: string;
  model_id?: string;
  language_code?: string;
  voice_settings?: PlaygroundVoiceSettings;
}

export const extractDialogueSpeakerEntries = (raw: unknown): SafeDialogueSpeakerEntry[] => {
  if (!isPlainRecord(raw)) return [];
  const out: SafeDialogueSpeakerEntry[] = [];
  for (const [rawName, sp] of Object.entries(raw)) {
    const name = rawName.trim();
    if (!name || DANGEROUS_KEYS.has(name) || !isPlainRecord(sp)) continue;
    const voiceId = typeof sp.voice_id === "string" ? sp.voice_id.trim() : "";
    if (!voiceId) continue;
    const rawSettings = isPlainRecord(sp.voice_settings) ? sp.voice_settings : {};
    const numOpt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    out.push({
      name,
      provider:
        sp.provider === "minimax" || sp.provider === "capcut"
          ? sp.provider
          : providerForModel(typeof sp.model_id === "string" ? sp.model_id : ""),
      voice_id: voiceId,
      ...(typeof sp.speech_style === "string" && sp.speech_style.trim()
        ? { speech_style: sp.speech_style }
        : {}),
      ...(typeof sp.voice_name === "string" && sp.voice_name.trim()
        ? { voice_name: sp.voice_name.trim() }
        : {}),
      ...(typeof sp.model_id === "string" && sp.model_id.trim()
        ? { model_id: sp.model_id.trim() }
        : {}),
      ...(typeof sp.language_code === "string" && sp.language_code.trim()
        ? { language_code: sp.language_code.trim() }
        : {}),
      voice_settings: {
        stability: numOpt(rawSettings.stability),
        similarity_boost: numOpt(rawSettings.similarity_boost),
        style: numOpt(rawSettings.style),
        use_speaker_boost:
          typeof rawSettings.use_speaker_boost === "boolean"
            ? rawSettings.use_speaker_boost
            : undefined,
        speed: numOpt(rawSettings.speed),
        pitch: numOpt(rawSettings.pitch),
        vol: numOpt(rawSettings.vol),
      },
    });
  }
  return out;
};

const composerDialogueSpeaker = (
  speaker: SafeDialogueSpeakerEntry,
  index: number,
): ComposerDialogueSpeaker => {
  const settings = speaker.voice_settings ?? {};
  return {
    id: `sp_${index}_${speaker.name}`,
    provider: speaker.provider,
    pitch: settings.pitch ?? 0,
    vol: settings.vol ?? 1,
    name: speaker.name,
    voiceId: speaker.voice_id,
    voiceName: speaker.voice_name || speaker.voice_id,
    speechStyle: speaker.speech_style,
    modelId: speaker.model_id || "eleven_v4",
    languageCode: speaker.language_code || "",
    stability: settings.stability ?? 0.5,
    similarityBoost: settings.similarity_boost ?? 0.75,
    style: settings.style ?? 0,
    useSpeakerBoost: Boolean(settings.use_speaker_boost),
    speed: settings.speed ?? 1,
  };
};

export const speechJobToDraft = (job: PlaygroundJob): ComposerDraft | null => {
  const recipe = job.kind === "tts" ? job.generationRecipe : undefined;
  if (!recipe) return null;
  const {
    requested,
    effective: { body },
  } = recipe;
  const settings = (body.voice_settings ?? {}) as PlaygroundVoiceSettings;
  const modelId = typeof body.model_id === "string" ? body.model_id : job.modelId;
  const normalization = body.apply_text_normalization;
  const applyTextNormalization =
    normalization === "auto" || normalization === "on" || normalization === "off"
      ? normalization
      : undefined;
  return {
    ...structuredClone(DEFAULT_COMPOSER_DRAFT),
    connection: "genvoice",
    provider: requested.provider ?? providerForModel(modelId),
    text: requested.text,
    title: requested.name ?? job.title,
    notes: requested.notes ?? "",
    voiceId: requested.voiceId,
    voiceName: requested.voiceName || job.voiceName || requested.voiceId,
    voiceGender: requested.voiceGender,
    voicePreviewUrl: requested.voicePreviewUrl,
    modelId,
    languageCode: typeof body.language_code === "string" ? body.language_code : "",
    previousText: typeof body.previous_text === "string" ? body.previous_text : "",
    nextText: typeof body.next_text === "string" ? body.next_text : "",
    seedText: typeof body.seed === "number" ? String(body.seed) : "",
    outputFormat: typeof body.output_format === "string" ? body.output_format : "",
    exportTranscript: Boolean(body.export_transcript),
    applyTextNormalization: applyTextNormalization ?? "auto",
    stability: settings.stability ?? 0.5,
    similarityBoost: settings.similarity_boost ?? 0.75,
    style: settings.style ?? 0,
    useSpeakerBoost: Boolean(settings.use_speaker_boost),
    speed: settings.speed ?? 1,
    pitch: settings.pitch ?? 0,
    vol: settings.vol ?? 1,
    sourceTakeId: requested.sourceTakeId,
    fromTemplateId: requested.fromTemplateId,
    recordedSpeech: { modelId, settings, normalization: applyTextNormalization },
  };
};

export const dialogueJobToDraft = (job: PlaygroundJob): ComposerDraft | null => {
  const recipe = job.dialogueRecipe;
  if (!recipe) return null;
  const defaults = structuredClone(DEFAULT_COMPOSER_DRAFT);
  return {
    ...defaults,
    mode: "dialogue",
    connection: recipe.connection ?? "genvoice",
    title: job.title,
    text: recipe.text,
    fromTemplateId: recipe.fromTemplateId,
    modelId: recipe.modelId ?? job.modelId,
    languageCode: recipe.languageCode ?? "",
    notes: recipe.notes ?? "",
    stability: recipe.voiceSettings?.stability ?? defaults.stability,
    similarityBoost: recipe.voiceSettings?.similarity_boost ?? defaults.similarityBoost,
    seedText: recipe.seed?.toString() ?? "",
    outputFormat: recipe.outputFormat ?? "",
    exportTranscript: Boolean(recipe.exportTranscript),
    pauseBetweenTurns: recipe.pause_between_turns ?? defaults.pauseBetweenTurns,
    speakers: extractDialogueSpeakerEntries(recipe.speakers).map(composerDialogueSpeaker),
  };
};

export const entryToComposerDraft = (
  entry: UnifiedPlaygroundEntry,
  overrideVoice?: { id: string; name: string; speakerKey?: string },
): ComposerDraft => {
  if (entry.template) return templateToComposerDraft(entry.template);
  const vs = entry.voiceSettings ?? {};
  const pgItem = entry.playgroundItem ?? entry.sourceRecording;
  if (entry.kind === "stt") {
    const settings = pgItem?.transcription?.settings;
    return {
      ...structuredClone(DEFAULT_COMPOSER_DRAFT),
      mode: "stt",
      title: entry.title,
      text: entry.text,
      notes: entry.notes || "",
      modelId: "scribe_v2",
      sttSourceKind: entry.audioUrl ? "playground" : "upload",
      sttSourceItemId: entry.audioUrl ? entry.id : "",
      sttLanguageCode: settings?.languageCode || entry.languageCode || "en",
      sttGranularity: settings?.timestampsGranularity || "word",
      sttDiarize: settings?.diarize ?? true,
      sttNumSpeakers: settings?.numSpeakers?.toString() || "",
      sttDiarizationThreshold: settings?.diarizationThreshold?.toString() || "",
      sttTagEvents: settings?.tagAudioEvents ?? true,
      sttNoVerbatim: settings?.noVerbatim ?? false,
      sttTemperature: settings?.temperature ?? 0,
      sttSeedText: settings?.seed?.toString() || "",
      sttFileFormat: "other",
      sttUseMultiChannel: settings?.useMultiChannel ?? false,
      sttKeytermsText: settings?.keyterms?.join(", ") || "",
      sttEntityDetectionText: settings?.entityDetection?.join(", ") || "",
      sttEntityRedactionText: settings?.entityRedaction?.join(", ") || "",
      sttEntityRedactionMode: settings?.entityRedactionMode || "redacted",
      sttExportSrt: settings?.additionalFormats?.includes("srt") ?? true,
      sttExtraFormats: (settings?.additionalFormats ?? []).filter(
        (format): format is "txt" | "segmented_json" | "html" | "docx" | "pdf" =>
          ["txt", "segmented_json", "html", "docx", "pdf"].includes(format),
      ),
    };
  }
  if (entry.kind === "dubbing") {
    const saved = pgItem?.dubbing,
      provider =
        pgItem?.provider === "google"
          ? "elevenlabs"
          : (pgItem?.provider ?? providerForModel(entry.modelId));
    return {
      ...structuredClone(DEFAULT_COMPOSER_DRAFT),
      mode: "dubbing",
      dubbingSourceScope: pgItem?.scope ?? "project",
      provider,
      title: entry.title,
      text: entry.text,
      voiceId: entry.voiceId,
      voiceName: entry.voiceName,
      modelId: DUBBING_MODELS[provider],
      languageCode: saved?.targetLanguage || entry.languageCode,
      notes: entry.notes ?? "",
      ...(saved
        ? {
            dubbing: {
              provider,
              sourceLanguage: saved.sourceLanguage,
              targetLanguage: saved.targetLanguage,
              voiceId: saved.voiceId,
              ttsVoiceId: saved.ttsVoiceId,
              voiceName: entry.voiceName,
              voiceLanguage: saved.targetLanguage,
            } as ComposerDraft["dubbing"],
          }
        : {}),
    };
  }
  const dlg = entry.dialogue ?? pgItem?.dialogue;
  const validSpeakers = extractDialogueSpeakerEntries(dlg?.speakers).map((speaker, index) => {
    const draft = composerDialogueSpeaker(speaker, index);
    if (
      overrideVoice &&
      (overrideVoice.speakerKey ? draft.name === overrideVoice.speakerKey : index === 0)
    )
      return { ...draft, voiceId: overrideVoice.id, voiceName: overrideVoice.name };
    return draft;
  });
  const speakers: ComposerDialogueSpeaker[] =
    validSpeakers.length > 0 ? validSpeakers : DEFAULT_COMPOSER_DRAFT.speakers;

  const vc = pgItem?.voiceChanger;
  const vcTakeVal =
    vc?.sourceTakeKind && vc?.sourceTakeFile ? `${vc.sourceTakeKind}:${vc.sourceTakeFile}` : "";

  return {
    mode:
      entry.kind === "dialogue"
        ? "dialogue"
        : entry.kind === "voice_changer"
          ? "voice_changer"
          : "tts",
    connection: pgItem?.connection,
    speechStyle: pgItem?.speechStyle,
    ...(entry.kind === "tts" && pgItem?.generationRecipe
      ? {
          recordedSpeech: {
            modelId: entry.modelId,
            settings: { ...vs },
            normalization: pgItem.applyTextNormalization,
          },
        }
      : {}),
    provider:
      pgItem?.provider === "google"
        ? undefined
        : (pgItem?.provider ?? providerForModel(entry.modelId)),
    title: overrideVoice
      ? `${entry.templateName || entry.title} (${overrideVoice.name})`
      : entry.title,
    text: entry.text,
    voiceId: overrideVoice?.id ?? validSpeakers[0]?.voiceId ?? entry.voiceId,
    voiceGender: overrideVoice ? undefined : pgItem?.voiceGender,
    voicePreviewUrl: overrideVoice ? undefined : pgItem?.voicePreviewUrl,
    voiceName: overrideVoice?.name ?? validSpeakers[0]?.voiceName ?? entry.voiceName,
    modelId: entry.modelId || "eleven_v4",
    languageCode: entry.languageCode || (entry.kind === "dialogue" ? "en" : ""),
    stability: vs.stability ?? 0.5,
    similarityBoost: vs.similarity_boost ?? 0.75,
    style: vs.style ?? 0,
    useSpeakerBoost: Boolean(vs.use_speaker_boost),
    speed: vs.speed ?? 1,
    pitch: vs.pitch ?? 0,
    vol: vs.vol ?? 1,
    previousText: pgItem?.previousText ?? "",
    nextText: pgItem?.nextText ?? "",
    seedText: typeof pgItem?.seed === "number" ? String(pgItem.seed) : "",
    outputFormat: pgItem?.outputFormat ?? "",
    applyTextNormalization: pgItem?.applyTextNormalization ?? "auto",
    exportTranscript: entry.exportTranscript,
    variations: 1,
    removeBackgroundNoise: vc?.remove_background_noise ?? true,
    vcSourceKind: vc?.sourceFile ? "upload" : vcTakeVal ? "film_take" : "playground",
    vcSourceFile: vc?.sourceFile ?? "",
    vcSourceItemId:
      entry.kind === "voice_changer"
        ? (vc?.sourceItemId ?? "")
        : entry.origin === "playground"
          ? entry.id
          : "",
    vcSourceTakeValue:
      vcTakeVal ||
      (entry.origin === "film_take" && entry.filmTake?.file ? `takes:${entry.filmTake.file}` : ""),
    sttSourceKind: entry.origin === "film_take" ? "film_take" : "playground",
    sttSourceItemId: entry.origin === "playground" ? entry.id : "",
    sttSourceTakeValue:
      entry.origin === "film_take" && entry.filmTake?.file ? `takes:${entry.filmTake.file}` : "",
    sttLanguageCode: entry.languageCode || DEFAULT_COMPOSER_DRAFT.sttLanguageCode,
    sttGranularity: DEFAULT_COMPOSER_DRAFT.sttGranularity,
    sttDiarize: DEFAULT_COMPOSER_DRAFT.sttDiarize,
    sttNumSpeakers: DEFAULT_COMPOSER_DRAFT.sttNumSpeakers,
    sttDiarizationThreshold: DEFAULT_COMPOSER_DRAFT.sttDiarizationThreshold,
    sttTagEvents: DEFAULT_COMPOSER_DRAFT.sttTagEvents,
    sttNoVerbatim: DEFAULT_COMPOSER_DRAFT.sttNoVerbatim,
    sttExportSrt: DEFAULT_COMPOSER_DRAFT.sttExportSrt,
    sttTemperature: DEFAULT_COMPOSER_DRAFT.sttTemperature,
    sttSeedText: DEFAULT_COMPOSER_DRAFT.sttSeedText,
    sttFileFormat: DEFAULT_COMPOSER_DRAFT.sttFileFormat,
    sttUseMultiChannel: DEFAULT_COMPOSER_DRAFT.sttUseMultiChannel,
    sttKeytermsText: DEFAULT_COMPOSER_DRAFT.sttKeytermsText,
    sttEntityDetectionText: DEFAULT_COMPOSER_DRAFT.sttEntityDetectionText,
    sttEntityRedactionText: DEFAULT_COMPOSER_DRAFT.sttEntityRedactionText,
    sttEntityRedactionMode: DEFAULT_COMPOSER_DRAFT.sttEntityRedactionMode,
    sttExtraFormats: DEFAULT_COMPOSER_DRAFT.sttExtraFormats,
    pauseBetweenTurns: dlg?.pause_between_turns ?? 0.5,
    speakers,
    notes: entry.notes ?? "",
    sourceTakeId: entry.origin === "film_take" ? entry.id : entry.playgroundItem?.sourceTakeId,
    fromTemplateId:
      entry.origin === "playground" ? (pgItem?.fromTemplateId ?? entry.id) : undefined,
  };
};

export const isSafeAudioUrl = (raw: string): boolean => {
  if (!raw) return false;
  if (raw.startsWith("/")) return !raw.startsWith("//");
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1"))
    );
  } catch {
    return false;
  }
};

export const resolveModeModelId = (
  mode: ComposerDraft["mode"],
  currentModelId: string,
  models: ReadonlyArray<PlaygroundModelInfo>,
  provider?: PlaygroundProvider,
): string => {
  if (mode === "dubbing") return DUBBING_MODELS[provider ?? providerForModel(currentModelId)];
  if (mode === "voice_changer") {
    const validVc = models.length
      ? models.some((m) => m.model_id === currentModelId && m.can_do_voice_conversion)
      : currentModelId.includes("_sts_");
    if (validVc) return currentModelId;
    return models.find((m) => m.can_do_voice_conversion)?.model_id ?? "eleven_multilingual_sts_v2";
  }
  const choices = provider
    ? models.filter((model) => (model.provider ?? providerForModel(model.model_id)) === provider)
    : models;
  const validTts = models.length
    ? choices.some((model) => model.model_id === currentModelId && model.can_do_text_to_speech)
    : Boolean(
        currentModelId &&
        !currentModelId.includes("_sts_") &&
        (!provider || providerForModel(currentModelId) === provider),
      );
  if (validTts) return currentModelId;
  const fallback = defaultProviderModel(provider ?? "elevenlabs");
  return (
    choices.find((model) => model.model_id === fallback && model.can_do_text_to_speech)?.model_id ??
    choices.find((model) => model.can_do_text_to_speech)?.model_id ??
    fallback
  );
};

export interface DiarizedTurn {
  speaker: string;
  start?: number;
  text: string;
}

export const groupDiarizedTranscript = (
  words: PlaygroundSttResult["words"] | undefined,
): DiarizedTurn[] => {
  if (!Array.isArray(words) || !words.length) return [];
  if (!words.some((w) => typeof w?.speaker_id === "string" && w.speaker_id.trim())) return [];
  const turns: DiarizedTurn[] = [];
  for (const w of words) {
    const piece = String(w?.text ?? "");
    if (!piece) continue;
    const isSpacing = w?.type === "spacing" || /^\s+$/.test(piece);
    const speaker = w?.speaker_id?.trim() || turns[turns.length - 1]?.speaker || "speaker_0";
    const last = turns[turns.length - 1];
    if (isSpacing) {
      if (last && !/\s$/.test(last.text)) last.text += " ";
      continue;
    }
    if (last && last.speaker === speaker) {
      if (last.text && !/\s$/.test(last.text) && !/^\s/.test(piece)) last.text += " ";
      last.text += piece;
    } else {
      turns.push({
        speaker,
        ...(typeof w?.start === "number" && Number.isFinite(w.start) ? { start: w.start } : {}),
        text: piece.trimStart(),
      });
    }
  }
  return turns.map((t) => ({ ...t, text: t.text.trim() })).filter((t) => Boolean(t.text));
};

export function filterSavedCastingVoices(
  voices: readonly PlaygroundVoiceOption[] = [],
  query: string,
  filters: VoiceFilters,
  displayedCatalogIds?: ReadonlySet<string>,
  cloudFacets?: { language?: string; useCase?: string },
) {
  const hit = matcher(query);
  const facet = (value: string) => value.trim().toLowerCase().replace(/[ -]+/g, "_");
  const language = (value: string) => value.trim().toLowerCase().replaceAll("_", "-");
  const wantedLanguage = language(cloudFacets?.language ?? "");
  const wantedRole = facet(cloudFacets?.useCase ?? "").replaceAll("_and_", "_");
  return voices.filter((voice) => {
    if ((voice.provider ?? "elevenlabs") === "elevenlabs" && displayedCatalogIds?.has(voice.id))
      return false;
    if (
      wantedLanguage &&
      ![
        voice.language,
        ...(voice.verifiedLanguages ?? []).flatMap(({ code, locale }) => [code, locale]),
      ].some((value) => {
        const code = language(value ?? "");
        return code === wantedLanguage || code.startsWith(wantedLanguage + "-");
      })
    )
      return false;
    if (wantedRole && facet(voice.useCase ?? "").replaceAll("_and_", "_") !== wantedRole)
      return false;
    if (
      query.trim() &&
      !hit(
        [
          voice.name,
          voice.id,
          voice.age,
          voice.gender,
          voice.accent,
          voice.language,
          voice.useCase,
          voice.category,
          voice.descriptive,
          voice.description,
          voice.provider,
        ]
          .filter(Boolean)
          .join(" "),
      )
    )
      return false;
    return (["gender", "age", "accent", "category", "descriptive"] as const).every(
      (field) => filters[field] === "all" || facet(voice[field] ?? "") === facet(filters[field]),
    );
  });
}

export function filterProviderCastingVoices(
  voices: readonly PlaygroundVoiceOption[],
  provider: PlaygroundProvider,
  query: string,
  filters: Partial<
    Record<"language" | "gender" | "age" | "accent" | "emotion" | "useCase", string>
  >,
) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[ _-]+/g, " ")
      .trim();
  return voices.filter(
    (voice) =>
      (voice.provider ?? "elevenlabs") === provider &&
      (!query.trim() ||
        normalize(
          [voice.name, voice.id, voice.descriptive, voice.description].filter(Boolean).join(" "),
        ).includes(normalize(query))) &&
      Object.entries(filters).every(
        ([key, value]) =>
          !value ||
          (key === "useCase" || key === "age"
            ? value
                .split(",")
                .map((choice) => choice.trim())
                .filter(Boolean)
                .some((choice) =>
                  key === "useCase"
                    ? normalize(voice.useCase ?? "").includes(normalize(choice))
                    : normalize(voice.age ?? "") === normalize(choice),
                )
            : normalize(voice[key as keyof typeof filters] ?? "") === normalize(value)),
      ),
  );
}

export function voiceChangerSourceDraft(entry: UnifiedPlaygroundEntry): Partial<ComposerDraft> {
  const native =
    (entry.playgroundItem?.provider ?? providerForModel(entry.modelId)) !== "elevenlabs";
  return {
    mode: "voice_changer",
    provider: "elevenlabs",
    modelId: "eleven_multilingual_sts_v2",
    voiceId: native ? "" : entry.voiceId,
    voiceName: native ? "" : entry.voiceName,
    vcSourceKind: entry.origin === "playground" ? "playground" : "film_take",
    vcSourceItemId: entry.origin === "playground" ? entry.id : "",
    vcSourceTakeValue:
      entry.origin === "film_take" && entry.filmTake?.file ? `takes:${entry.filmTake.file}` : "",
    title: `${entry.title} (VC)`,
  };
}

export function swapGenerationInput(
  draft: ComposerDraft,
  models: readonly PlaygroundModelInfo[],
  speakerKey?: string,
) {
  const target =
    draft.mode === "dialogue"
      ? draft.speakers.find((speaker) => speaker.name === speakerKey)
      : draft;
  if (!target) throw new Error("Choose a Dialogue role to swap");
  return {
    provider: target.provider ?? providerForModel(target.modelId),
    voiceId: target.voiceId,
    voiceName: target.voiceName,
    modelId: target.modelId,
    languageCode: target.languageCode,
    voiceSettings: voiceSettingsForModel(
      models.find((model) => model.model_id === target.modelId),
      target,
    ),
    ...(draft.mode === "dialogue" ? { speakerKey } : {}),
  };
}
