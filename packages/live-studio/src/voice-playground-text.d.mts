export const AUDIO_TAG_RE: RegExp;
export const DANGEROUS_KEYS: Set<string>;
export function stripDialogueSpeakerBrackets(text: string): string;
export function detectTextLanguage(text: string): "vi" | "en";
export function parseDialogueTurnNames(text: string): string[];
export function extractAudioTags(text: string): string[];
