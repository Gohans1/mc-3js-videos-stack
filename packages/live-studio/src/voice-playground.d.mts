import type { VoiceController } from "./voice.mjs";

export interface PlaygroundVoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
}

export interface PlaygroundModelInfo {
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
  maximum_text_length_per_request: number;
  model_rates: { character_cost_multiplier: number };
  languages: Array<{ language_id: string; name: string }>;
}

export interface PlaygroundVoiceOption {
  id: string;
  name: string;
  category: string;
  useCase?: string;
  gender?: string;
  age?: string;
  accent?: string;
  descriptive?: string;
  description?: string;
  previewUrl?: string;
  rate?: number;
  free?: boolean;
  language?: string;
  source?: "default" | "shared" | "film" | "custom";
}

export interface PlaygroundAccountInfo {
  id: string;
  email: string;
  name: string;
  credit_balance: number;
  role: string;
}

export interface PlaygroundStatus {
  configured: boolean;
  source: "override" | "env" | "secrets_file" | "none";
  maskedKey: string;
  apiBase: string;
  hasOverride: boolean;
  account: PlaygroundAccountInfo | null;
  error?: string;
}

export interface PlaygroundJob {
  id: string;
  kind: "tts" | "dialogue" | "voice_changer";
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
  file_extension: string;
  content: string;
  is_base64_encoded?: boolean;
}

export interface PlaygroundSttResult {
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

export interface VoicePlaygroundItem {
  id: string;
  kind: "tts" | "dialogue" | "voice_changer";
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
    pause_between_turns: number;
    speakers: Record<
      string,
      {
        voice_id: string;
        voice_name?: string;
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
  mimeType: string;
  bytes: number;
  durationSeconds: number;
  srtFile?: string;
  srtText?: string;
  sttResult?: PlaygroundSttResult;
  remoteTaskId?: string;
  charactersUsed?: number;
  creditsDeducted?: number;
  provider: "elevenlabs";
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

export interface RemoteHistoryEntry {
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
  creditsDeducted: number;
  createdAt: string;
  audioUrl: string;
  srtUrl: string;
  importedItemId: string | null;
}

export interface PlaygroundSttInput {
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

export interface VoicePlaygroundController {
  storageDir: string;
  getStatus(opts?: { live?: boolean }): Promise<PlaygroundStatus>;
  setConfig(cfg: {
    apiKey?: string;
    apiBase?: string;
    clearOverride?: boolean;
  }): Promise<PlaygroundStatus>;
  getCatalog(opts?: { refresh?: boolean }): Promise<{
    models: PlaygroundModelInfo[];
    languages: Array<{ code: string; name: string }>;
    defaultVoices: PlaygroundVoiceOption[];
    liveSynced: boolean;
    error?: string;
  }>;
  searchSharedVoices(query?: Record<string, string | number | undefined>): Promise<{
    voices: PlaygroundVoiceOption[];
    hasMore: boolean;
  }>;
  listItems(): VoicePlaygroundItem[];
  listJobs(): PlaygroundJob[];
  getItem(id: string): VoicePlaygroundItem | null;
  startTts(input: Record<string, unknown>): Promise<{ jobs: PlaygroundJob[] }>;
  startDialogue(input: Record<string, unknown>): Promise<{ job: PlaygroundJob }>;
  startVoiceChanger(input: Record<string, unknown>): Promise<{ job: PlaygroundJob }>;
  runSpeechToText(input: PlaygroundSttInput): Promise<{
    taskId: string;
    sttResult: PlaygroundSttResult;
  }>;
  patchItem(id: string, patch: Record<string, unknown>): Promise<VoicePlaygroundItem | null>;
  deleteItem(id: string): Promise<boolean>;
  retryItem(
    id: string,
    overrides?: Record<string, unknown>,
  ): Promise<{ job?: PlaygroundJob; jobs?: PlaygroundJob[] } | null>;
  fetchRemoteHistory(opts?: {
    page?: number;
    pageSize?: number;
  }): Promise<{ items: RemoteHistoryEntry[]; hasMore: boolean; warning?: string }>;
  importRemoteTask(
    taskId: string,
    kind?: string,
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
  onEvent?: (payload: unknown) => void;
  onVoiceChanged?: () => void;
}): VoicePlaygroundController;
