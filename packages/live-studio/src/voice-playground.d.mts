import type { z } from "zod";

import type { CloneController } from "./voice-playground-clones.mjs";
import type {
  PlaygroundCreatorFavorite,
  PlaygroundCreatorProfile,
  PlaygroundDialogue,
  PlaygroundFavoriteVoiceQuery,
  PlaygroundLocalEdit,
  PlaygroundPatch,
  PlaygroundRecordingQuery,
  PlaygroundRegionEdit,
  PlaygroundResumeRegion,
  PlaygroundTemplateDraft as PlaygroundTemplateDraftSchema,
  PlaygroundTemplateFromRecording,
  PlaygroundTemplatePatch,
  PlaygroundTts,
  PlaygroundTtsBatch,
  PlaygroundVoiceChanger,
  PlaygroundVoiceProfileInput,
  PlaygroundVoiceProfilePatch,
  PlaygroundVoiceSearch,
  PlaygroundVoiceUsageQuery,
} from "./voice-playground-contract";
import type { DubbingController } from "./voice-playground-dubbing.mjs";
import type { RecordingWord } from "./voice-playground-text.mjs";
import type { VoiceController } from "./voice.mjs";

export type RegionEditInput = z.input<typeof PlaygroundRegionEdit>;
export type LocalRegionEditInput = z.input<typeof PlaygroundLocalEdit>;
export interface PlaygroundRegionInfo {
  id: string;
  title: string;
  durationSeconds: number;
  waveform: { step: number; peaks: number[] } | null;
  words: RecordingWord[];
}

export interface PlaygroundVoiceSettings {
  pitch?: number;
  vol?: number;
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
}

export interface PlaygroundModelInfo {
  provider?: PlaygroundProvider;
  model_id: string;
  name: string;
  description: string;
  can_do_text_to_speech: boolean;
  can_do_voice_conversion: boolean;
  can_use_style: boolean;
  can_use_speaker_boost: boolean;
  supports_context?: boolean;
  supports_speed?: boolean;
  supports_similarity?: boolean;
  stability_values?: number[];
  maximum_text_length_per_request?: number;
  model_rates: { character_cost_multiplier?: number };
  rateSource?: "provider";
  languages: Array<{ language_id: string; name: string }>;
}

export type PlaygroundProvider = "elevenlabs" | "minimax" | "capcut";
export type PlaygroundConnection = "genvoice" | "elevenlabs" | "google";
export type PlaygroundRecordingEngine = PlaygroundProvider | "google";

export interface PlaygroundVoiceOption {
  connection?: PlaygroundConnection;
  ownedClone?: { id: string; scope: "project" | "global" };
  dubbingVoiceId?: string;
  sourcePlatform?: string;
  emotion?: string;
  provider?: PlaygroundProvider;
  id: string;
  name: string;
  creatorId?: string;
  creatorName?: string;
  category: string;
  useCase?: string;
  gender?: string;
  age?: string;
  accent?: string;
  descriptive?: string;
  description?: string;
  previewUrl?: string;
  rate?: number;
  usage1y?: number;
  usage7d?: number;
  clones?: number;
  addedAt?: number;
  featured?: boolean;
  liveModeration?: boolean;
  verifiedLanguages?: {
    code: string;
    name?: string;
    modelId?: string;
    locale?: string;
    accent?: string;
    previewUrl?: string;
  }[];
  free?: boolean;
  language?: string;
  source?: "default" | "shared" | "film" | "custom";
}

export interface PlaygroundAccountInfo {
  id: string;
  email: string;
  name: string;
  credit_balance: number | null;
  role: string;
}

export interface PlaygroundStatus {
  connections?: Record<Exclude<PlaygroundConnection, "genvoice">, PlaygroundConnectionStatus>;
  configured: boolean;
  source: "override" | "env" | "secrets_file" | "none";
  maskedKey: string;
  apiBase: string;
  hasOverride: boolean;
  account: PlaygroundAccountInfo | null;
  error?: string;
}

export interface PlaygroundConnectionStatus {
  configured: boolean;
  maskedKey: string;
  source: "override" | "env" | "none";
  hasOverride: boolean;
  verified?: boolean;
  error?: string;
}

export type PlaygroundTtsRequest = z.input<typeof PlaygroundTts>;
export type PlaygroundTtsBatchInput = z.input<typeof PlaygroundTtsBatch>;
export interface PlaygroundTtsQuote {
  balanceCredits: number | null;
  modelEstimateCredits: number | null;
  totalCredits: number | null;
  rows: {
    provider: PlaygroundProvider;
    modelId: string;
    voiceId: string;
    voiceName: string;
    characters: number;
    takes: number;
    modelEstimateCredits: number | null;
    modelRateSource: "provider" | "built-in" | null;
    totalCredits: number | null;
  }[];
}
export interface PlaygroundTtsRecipe {
  version: 1;
  requested: PlaygroundTtsRequest;
  effective: { path: string; body: Record<string, unknown> };
}
export interface PlaygroundBatchEntry {
  id: string;
  index: number;
  variationIndex: number;
  label?: string;
}
export type GenVoiceCreditSource = "acknowledgement" | "processing" | "history";
export type VoiceCreatorProfile = z.infer<typeof PlaygroundCreatorProfile> & { favorite: boolean };
export interface PlaygroundJob {
  batch?: PlaygroundBatchEntry;
  generationRecipe?: PlaygroundTtsRecipe;
  creditsDeducted?: number;
  creditsSource?: GenVoiceCreditSource;
  connection?: PlaygroundConnection;
  scope?: "project" | "global";
  dialogueRecipe?: z.input<typeof PlaygroundDialogue>;
  dialogueParentId?: string;
  regionEdit?: { itemId: string; input: RegionEditInput; replacementItemId?: string };
  sourceFile?: string;
  sourceLabel?: string;
  parentJobId?: string;
  finishedAt?: string;
  id: string;
  kind: "tts" | "dialogue" | "voice_changer" | "region_edit" | "stt";
  result?: { taskId: string; sttResult: PlaygroundSttResult; item?: VoicePlaygroundItem };
  status: string;
  progress: number;
  title: string;
  voiceId: string;
  voiceName: string;
  modelId: string;
  remoteTaskId?: string;
  itemId?: string;
  error?: string;
  createdAt: string;
}

export interface PlaygroundSttFormatOutput {
  requested_format?: string;
  file_extension: string;
  content: string;
  is_base64_encoded?: boolean;
}

export interface PlaygroundSttResult {
  creditsDeducted?: number;
  text: string;
  language_code: string;
  language_probability?: number;
  entities?: Array<{ text: string; entity_type: string; start_char: number; end_char: number }>;
  words: Array<{
    text?: string;
    start?: number;
    end?: number;
    speaker_id?: string;
    type?: string;
  }>;
  srtText?: string;
  additional_formats?: PlaygroundSttFormatOutput[];
  createdAt: string;
}

export interface PlaygroundUsage {
  connection?: PlaygroundConnection;
  voices?: Array<{
    voiceId: string;
    voiceName: string;
    provider: PlaygroundRecordingEngine;
    connection?: PlaygroundConnection;
  }>;
  itemId: string;
  takeId: string;
  scope: "project" | "global";
  voiceId: string;
  provider: PlaygroundRecordingEngine;
}

export interface PlaygroundRights {
  status: "unverified" | "user_confirmed";
  evidenceUrl?: string;
  notes?: string;
  checkedAt?: string;
}
export interface PlaygroundTemplate {
  id: string;
  scope: "project" | "global";
  title: string;
  draft: z.input<typeof PlaygroundTemplateDraftSchema> & Record<string, unknown>;
  favorite: boolean;
  description?: string;
  tags?: string[];
  rating?: number | null;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VoicePlaygroundItem {
  legacyCreditsDeducted?: number;
  creditsReported?: boolean;
  batch?: PlaygroundBatchEntry;
  generationRecipe?: PlaygroundTtsRecipe;
  connection?: PlaygroundConnection;
  originProject?: string;
  creatorId?: string;
  description?: string;
  voiceGender?: string;
  voicePreviewUrl?: string;
  rating?: number | null;
  color?: string | null;
  archivedAt?: string;
  speechStyle?: string;
  providerRequestId?: string;
  actualCost?: { unit: "elevenlabs_credits"; amount: number };
  providerUsage?: { inputTokens: number; outputTokens: number };
  dubbing?: {
    jobId: string;
    taskId: string;
    sourceFile?: string;
    sourceName?: string;
    sourceLanguage: string;
    targetLanguage: string;
    voiceId: string;
    ttsVoiceId?: string;
    modelId: string;
    resultFile?: string;
    estimatedCredits?: number;
    sourceUrl?: string;
    createdAt: string;
  };
  wordTimings?: RecordingWord[];
  retry?: { rootId: string; parentId?: string };
  version?: {
    rootId: string;
    parentId?: string;
    historyGaps?: {
      root?: { id: string; scope: "project" | "global" };
      parent?: { id: string; scope: "project" | "global" };
    };
    edit: RegionEditInput;
    regionSeconds: number;
    fitRate?: number;
    baseCredits?: number;
    sourceRemoteTaskId?: string;
    replacement?: Pick<
      VoicePlaygroundItem,
      | "id"
      | "text"
      | "voiceId"
      | "voiceName"
      | "modelId"
      | "voiceSettings"
      | "provider"
      | "connection"
      | "speechStyle"
      | "remoteTaskId"
      | "creditsDeducted"
      | "seed"
      | "languageCode"
      | "previousText"
      | "nextText"
      | "outputFormat"
      | "applyTextNormalization"
    >;
  };
  filmTakeSource?: { takeId: string; project: string; archivedAt: string };
  voicesUsed?: PlaygroundUsage["voices"];
  rights?: PlaygroundRights;
  scope?: "project" | "global";
  id: string;
  kind: "tts" | "dialogue" | "voice_changer" | "dubbing" | "stt";
  title: string;
  text: string;
  tags: string[];
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string;
  voiceSettings: PlaygroundVoiceSettings;
  previousText?: string;
  nextText?: string;
  seed?: number;
  outputFormat?: string;
  applyTextNormalization?: "auto" | "on" | "off";
  exportTranscript: boolean;
  dialogue?: {
    pause_between_turns?: number;
    speakers: Record<
      string,
      {
        provider?: PlaygroundProvider;
        voice_id: string;
        voice_name?: string;
        speech_style?: string;
        model_id: string;
        language_code?: string;
        voice_settings?: PlaygroundVoiceSettings;
      }
    >;
  };
  voiceChanger?: {
    sourceLabel: string;
    sourceItemId?: string;
    sourceFile?: string;
    sourceTakeKind?: "takes" | "try";
    sourceTakeFile?: string;
    remove_background_noise: boolean;
  };
  audioFile: string;
  replacedAudioFiles?: string[];
  mimeType: string;
  bytes: number;
  durationSeconds: number;
  srtFile?: string;
  srtText?: string;
  sttResult?: PlaygroundSttResult;
  transcription?: {
    sourceLabel: string;
    settings: Pick<
      PlaygroundSttInput,
      | "languageCode"
      | "fileFormat"
      | "timestampsGranularity"
      | "diarize"
      | "numSpeakers"
      | "diarizationThreshold"
      | "tagAudioEvents"
      | "noVerbatim"
      | "temperature"
      | "seed"
      | "useMultiChannel"
      | "keyterms"
      | "entityDetection"
      | "entityRedaction"
      | "entityRedactionMode"
      | "additionalFormats"
    >;
  };
  remoteTaskId?: string;
  charactersUsed?: number;
  creditsDeducted?: number;
  creditsSource?: GenVoiceCreditSource;
  provider: PlaygroundRecordingEngine;
  favorite: boolean;
  isTemplate: boolean;
  templateName?: string;
  notes?: string;
  fallbackNote?: string;
  sourceTakeId?: string;
  fromTemplateId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaygroundVoiceProfile {
  id: string;
  scope: "project" | "global";
  voice: PlaygroundVoiceOption;
  alias?: string;
  description?: string;
  color?: string | null;
  rating?: number | null;
  tags?: string[];
  rights?: PlaygroundRights;
  originProject?: string;
  archivedAt?: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteHistoryEntry {
  provider?: PlaygroundProvider;
  id: string;
  kind: "tts" | "dialogue" | "voice_changer";
  status: string;
  text: string;
  title: string;
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string;
  voiceSettings: PlaygroundVoiceSettings;
  exportTranscript: boolean;
  charactersUsed: number;
  creditsDeducted?: number;
  createdAt: string;
  audioUrl: string;
  srtUrl: string;
  importedItemId: string | null;
}

export interface PlaygroundSttInput {
  sourceLabel?: string;
  sourceFile?: string;
  itemId?: string;
  sourceItemId?: string;
  sourceTakeKind?: "takes" | "try";
  sourceTakeFile?: string;
  languageCode?: string;
  timestampsGranularity?: "none" | "word" | "character";
  diarize?: boolean;
  numSpeakers?: number;
  diarizationThreshold?: number;
  tagAudioEvents?: boolean;
  noVerbatim?: boolean;
  temperature?: number;
  seed?: number;
  fileFormat?: "pcm_s16le_16" | "other";
  useMultiChannel?: boolean;
  keyterms?: string[];
  entityDetection?: string[];
  entityRedaction?: string[];
  entityRedactionMode?: "redacted" | "entity_type" | "enumerated_entity_type";
  additionalFormats?: string[];
  [key: string]: unknown;
}

export interface VoicePlaygroundController extends CloneController, DubbingController {
  getTemplate(id: string): PlaygroundTemplate | null;
  downloadVoicePreview(input: {
    previewUrl: string;
  }): Promise<{ bytes: Uint8Array; mimeType: string }>;
  patchTemplate(
    id: string,
    patch: z.input<typeof PlaygroundTemplatePatch>,
  ): Promise<PlaygroundTemplate | null>;
  patchTemplates(
    ids: string[],
    patch: Omit<z.input<typeof PlaygroundTemplatePatch>, "draft">,
  ): {
    updated: PlaygroundTemplate[];
    missing: string[];
  };
  saveTemplateFromRecording(
    id: string,
    metadata: z.input<typeof PlaygroundTemplateFromRecording>,
  ): Promise<PlaygroundTemplate>;
  templateRecipe(
    id: string,
  ): { scope?: "project" | "global" } & (
    | { command: "generate tts"; input: z.output<typeof PlaygroundTts> }
    | { command: "generate dialogue"; input: z.output<typeof PlaygroundDialogue> }
    | { command: "generate voice-changer"; input: z.output<typeof PlaygroundVoiceChanger> }
  );
  listVoiceProfiles(input?: { includeGlobal?: boolean }): PlaygroundVoiceProfile[];
  getVoiceProfile(id: string): PlaygroundVoiceProfile | null;
  saveVoiceProfile(input: z.input<typeof PlaygroundVoiceProfileInput>): PlaygroundVoiceProfile;
  patchVoiceProfile(
    id: string,
    patch: z.input<typeof PlaygroundVoiceProfilePatch>,
  ): PlaygroundVoiceProfile;
  copyVoiceProfile(id: string, scope: "project" | "global"): PlaygroundVoiceProfile;
  patchItems(
    ids: string[],
    patch: z.input<typeof PlaygroundPatch>,
  ): Promise<{ items: VoicePlaygroundItem[]; missing: string[] }>;
  recordingArchivePolicy(id: string): { deleteAfter: string | null } | null;
  previewExpiredRecordings(): {
    retentionDays: number;
    eligible: { id: string; title: string; archivedAt: string }[];
    protected: number;
  };
  purgeExpiredRecordings(
    ids: string[],
  ): Promise<{ purged: string[]; failed: { id: string; reason: string }[] }>;
  inspectRegion(id: string): Promise<PlaygroundRegionInfo>;
  inspectFilmRegion(
    takeId: string,
  ): Promise<{ info: PlaygroundRegionInfo; items: VoicePlaygroundItem[] }>;
  previewFilmRegion(
    takeId: string,
    input: LocalRegionEditInput,
    sourceId: string,
  ): Promise<{ bytes: Uint8Array; durationSeconds: number; regionSeconds: number }>;
  startFilmRegionEdit(
    takeId: string,
    input: RegionEditInput,
    sourceId: string,
  ): Promise<{ job: PlaygroundJob }>;
  previewRegion(
    id: string,
    input: LocalRegionEditInput,
  ): Promise<{ bytes: Uint8Array; durationSeconds: number; regionSeconds: number }>;
  listVersions(id: string): VoicePlaygroundItem[];
  startRegionEdit(id: string, input: RegionEditInput): Promise<{ job: PlaygroundJob }>;
  waitForJob(id: string): Promise<VoicePlaygroundItem>;
  resumeRegionEdit(
    id: string,
    input: z.input<typeof PlaygroundResumeRegion>,
  ): Promise<{ job: PlaygroundJob }>;
  applyToFilm(input: {
    itemId: string;
    takeId: string;
  }): Promise<{ ok: true; tryFile: string; usage: PlaygroundUsage[] }>;
  rememberAlternative(record: {
    takeId: string;
    file: string;
    itemId: string;
    scope: "project" | "global";
    title: string;
    audioHash: string;
  }): void;
  archiveFilmTake(
    takeId: string,
    opts?: { voiceName?: string; name?: string },
  ): Promise<VoicePlaygroundItem>;
  scope: "project" | "global";
  forScope(scope: "project" | "global"): VoicePlaygroundController;
  copyToScope(id: string, scope: "project" | "global"): Promise<VoicePlaygroundItem>;
  saveSource(input: { bytes: Uint8Array; name: string }): {
    sourceFile: string;
    sourceLabel: string;
  };
  filmVoiceSnapshot(): ReturnType<VoiceController["read"]> | undefined;
  listUsage(): PlaygroundUsage[];
  recordUsage(input: {
    itemId: string;
    takeId: string;
    tryFile: string;
  }): Promise<PlaygroundUsage[]>;
  listTemplates(opts?: { includeGlobal?: boolean }): PlaygroundTemplate[];
  saveTemplate(input: {
    id?: string;
    title?: string;
    draft?: Record<string, unknown>;
    favorite?: boolean;
  }): Promise<PlaygroundTemplate>;
  deleteTemplate(id: string): Promise<boolean>;
  copyTemplateToScope(id: string, scope: "project" | "global"): Promise<PlaygroundTemplate>;
  listTakeFavorites(): string[];
  setTakeFavorite(uid: string, favorite: boolean): Promise<string[]>;
  listVoiceFavorites(): PlaygroundVoiceOption[];
  listCreatorProfiles(): VoiceCreatorProfile[];
  listCreatorFavorites(): VoiceCreatorProfile[];
  setCreatorFavorite(input: z.input<typeof PlaygroundCreatorFavorite>): VoiceCreatorProfile[];
  saveCreatorProfile(input: z.input<typeof PlaygroundCreatorProfile>): VoiceCreatorProfile;
  findFavoriteVoices(input: z.input<typeof PlaygroundFavoriteVoiceQuery>): {
    voices: Array<PlaygroundVoiceOption & { rating?: number }>;
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  };
  setVoiceFavorite(
    voice: PlaygroundVoiceOption,
    favorite: boolean,
  ): Promise<PlaygroundVoiceOption[]>;
  close(): void;
  storageDir: string;
  hasArchiveIndex(): boolean;
  getStatus(opts?: {
    live?: boolean;
    connection?: PlaygroundConnection;
  }): Promise<PlaygroundStatus>;
  setConfig(cfg: {
    connection?: PlaygroundConnection;
    apiKey?: string;
    apiBase?: string;
    clearOverride?: boolean;
  }): Promise<PlaygroundStatus>;
  getCatalog(opts?: { refresh?: boolean; connection?: PlaygroundConnection }): Promise<{
    models: PlaygroundModelInfo[];
    languages: Array<{ code: string; name: string }>;
    providerLanguages?: Partial<Record<PlaygroundProvider, Array<{ code: string; name: string }>>>;
    defaultVoices: PlaygroundVoiceOption[];
    liveSynced: boolean;
    error?: string;
  }>;
  searchSharedVoices(query?: Record<string, string | number | undefined>): Promise<{
    voices: PlaygroundVoiceOption[];
    hasMore: boolean;
    nextPageToken?: string;
  }>;
  searchCastingVoices(query?: z.input<typeof PlaygroundVoiceSearch>): Promise<{
    voices: PlaygroundVoiceOption[];
    hasMore: boolean;
    nextPage?: number | null;
    nextPageToken?: string;
    pagesScanned?: number;
    total?: number;
  }>;
  listItems(opts?: {
    includeGlobal?: boolean;
    includeArchived?: boolean;
    archived?: boolean;
  }): VoicePlaygroundItem[];
  findRecordings(query: z.input<typeof PlaygroundRecordingQuery>): {
    items: VoicePlaygroundItem[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  };
  rankVoiceUsage(query: z.input<typeof PlaygroundVoiceUsageQuery>): {
    voices: {
      voiceId: string;
      voiceName: string;
      provider: PlaygroundProvider;
      recordings: number;
      inFilm: number;
      takeIds: string[];
    }[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  };
  listJobs(opts?: { includeGlobal?: boolean }): PlaygroundJob[];
  getItem(id: string): VoicePlaygroundItem | null;
  startTts(
    input: Record<string, unknown>,
    options?: { runId?: string; signal?: AbortSignal; deadline?: number },
  ): Promise<{ jobs: PlaygroundJob[] }>;
  quoteTtsBatch(input: PlaygroundTtsBatchInput): Promise<PlaygroundTtsQuote>;
  startTtsBatch(
    input: PlaygroundTtsBatchInput,
    options?: { runId?: string; signal?: AbortSignal; deadline?: number },
  ): Promise<{ batchId: string; jobs: PlaygroundJob[] }>;
  getSpeechRun(id: string): { id: string; batchId?: string; jobs: PlaygroundJob[] } | null;
  getSpeechReceipt(id: string): {
    jobId: string;
    remoteTaskId: string;
    itemId?: string;
    creditsDeducted?: number;
    creditsSource?: GenVoiceCreditSource;
    batch?: PlaygroundBatchEntry;
    generationRecipe?: PlaygroundTtsRecipe;
  } | null;
  startDialogue(input: Record<string, unknown>): Promise<{ job: PlaygroundJob }>;
  startVoiceChanger(input: Record<string, unknown>): Promise<{ job: PlaygroundJob }>;
  runSpeechToText(input: PlaygroundSttInput): Promise<{
    item: VoicePlaygroundItem;
    taskId: string;
    sttResult: PlaygroundSttResult;
  }>;
  startSpeechToText(input: PlaygroundSttInput): { job: PlaygroundJob };
  resumeSpeechToText(input: PlaygroundSttInput & { taskId: string }): {
    job: PlaygroundJob;
  };
  patchItem(id: string, patch: Record<string, unknown>): Promise<VoicePlaygroundItem | null>;
  deleteItem(id: string): Promise<boolean>;
  retryItem(
    id: string,
    overrides?: Record<string, unknown>,
    options?: { runId?: string; signal?: AbortSignal; deadline?: number },
  ): Promise<{ job?: PlaygroundJob; jobs?: PlaygroundJob[] } | null>;
  fetchRemoteHistory(opts?: {
    page?: number;
    pageSize?: number;
    kind?: "all" | "tts" | "voice_changer";
  }): Promise<{ items: RemoteHistoryEntry[]; hasMore: boolean; warning?: string }>;
  importRemoteTask(
    taskId: string,
    kind?: string,
    recovery?: {
      dialogueRecipe?: z.input<typeof PlaygroundDialogue>;
      dialogueParentId?: string;
    },
    options?: { signal?: AbortSignal },
  ): Promise<{ item: VoicePlaygroundItem; alreadyImported: boolean }>;
  promoteToFilmTake(input: {
    itemId: string;
    takeId: string;
  }): Promise<{ ok?: true; takeId?: string; tryFile?: string; error?: string; status?: number }>;
  audioFile(file: string): string | null;
  srtFile(file: string): string | null;
  waitForAllJobs(): Promise<PromiseSettledResult<unknown>[]>;
}

export const BUILTIN_GENVOICE_MODELS: PlaygroundModelInfo[];
export const BUILTIN_LANGUAGES: Array<{ code: string; name: string }>;
export function extractAudioTags(text: string): string[];
export function detectTextLanguage(text: string): "vi" | "en";
export function stripDialogueSpeakerBrackets(text: string): string;
export function parseDialogueTurnNames(text: string): string[];
export function maskApiKey(key: string): string;
export function normalizeApiBase(raw: string): string;
export function assertSafeApiBase(
  raw: string,
  lookup?: (host: string) => Promise<Array<{ address: string; family: number }>>,
): Promise<string>;
export function openVoicePlayground(opts?: {
  scope?: "project" | "global";
  globalDir?: string;
  dir?: string;
  project?: string;
  configFile?: string;
  secretsFile?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  lookup?: (host: string) => Promise<Array<{ address: string; family: number }>>;
  pollIntervalMs?: number;
  maxPollMs?: number;
  voice?: VoiceController | null;
  audioFavorites?: import("./favorites.mjs").FavoriteFile;
  cachedVoices?: () => import("./voice-library.mjs").SharedVoiceEntry[];
  onAudioFavoritesChanged?: () => void;
  onEvent?: (payload: unknown) => void;
  onVoiceChanged?: () => void;
}): VoicePlaygroundController;
