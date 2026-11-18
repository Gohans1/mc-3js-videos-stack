export const AUDIO_TAG_RE: RegExp;
export function estimateSpeechModelCredits(
  characters: number,
  rate: number | undefined,
  takes: number,
  subtitles: boolean,
): number | null;
export const DANGEROUS_KEYS: Set<string>;
export const SAFE_MEDIA_FILE: RegExp;
export const SAFE_REMOTE_ID_RE: RegExp;
export function isUnverifiedCloudSpeech(item: {
  kind: string;
  remoteTaskId?: string;
  connection?: string;
  version?: unknown;
  generationRecipe?: unknown;
  cloudRecipeUnverified?: boolean;
}): boolean;
export function recordingRootId(item: {
  id: string;
  version?: { rootId: string };
  retry?: { rootId: string };
}): string;
export function recordingAudioFiles(item: {
  audioFile?: string;
  replacedAudioFiles?: string[];
}): string[];
export function hasUnverifiedZeroCharge(item: object | null | undefined): boolean;
export function hasProvisionalGenVoiceCharge(item: { creditsSource?: string } | null): boolean;
export function isFailedGenVoiceTask(status: unknown): boolean;
export function genVoiceTaskChargeSource(status: unknown): "processing" | "history";
export function withChargeEvidence<T extends object | null | undefined>(
  item: T,
): T extends object
  ? | T
    | (Omit<T, "creditsDeducted"> & {
        legacyCreditsDeducted: 0;
        creditsDeducted: undefined;
      })
  : T;
export interface RecordingWord {
  w: string;
  s: number;
  e: number;
  speakerId?: string;
}
export function recordingWords(item: {
  wordTimings?: RecordingWord[];
  sttResult?: {
    words?: Array<{ text?: string; start?: number; end?: number; speaker_id?: string }>;
  };
}): RecordingWord[];
export function stripDialogueSpeakerBrackets(text: string): string;
export function detectTextLanguage(text: string): "vi" | "en";
export function parseDialogueTurnNames(text: string): string[];
export function extractAudioTags(text: string): string[];
