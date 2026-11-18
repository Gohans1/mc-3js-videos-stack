import type { PlaygroundModelInfo, PlaygroundProvider } from "./voice-playground.mjs";
export const PROVIDER_IDS: readonly ["elevenlabs", "minimax", "capcut"];
export function providerForModel(id?: string): PlaygroundProvider;
export function defaultProviderModel(provider: PlaygroundProvider): string;
export function languageForProvider(
  provider: PlaygroundProvider,
  language: string,
  languages: readonly { code: string; name: string }[],
): string;

export interface ProviderLanguageCatalog {
  languages: readonly { code: string; name: string }[];
  providerLanguages?: Partial<
    Record<PlaygroundProvider, readonly { code: string; name: string }[]>
  >;
}
export const FALLBACK_PROVIDER_LANGUAGES: Record<
  "minimax" | "capcut",
  Array<{ code: string; name: string }>
>;
export function providerLanguageOptions(
  provider: PlaygroundProvider,
  catalog: ProviderLanguageCatalog,
  model?: PlaygroundModelInfo,
): Array<{ code: string; name: string }>;

export const CAPCUT_TONES: readonly string[];
export function resolveProviderLanguage(
  provider: PlaygroundProvider,
  language: string,
  catalog: ProviderLanguageCatalog,
  model?: PlaygroundModelInfo,
): string;
