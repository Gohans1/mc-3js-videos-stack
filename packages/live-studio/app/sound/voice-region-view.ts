import { providerForModel } from "../../src/voice-playground-providers.mjs";
import type {
  PlaygroundVoiceOption,
  RegionEditInput,
  VoicePlaygroundItem,
} from "../../src/voice-playground.mjs";
import {
  DEFAULT_COMPOSER_DRAFT,
  voiceSettingsForModel,
  withComposerVoice,
} from "./voice-playground-view";

export function regionGenerationRecipe(
  item: VoicePlaygroundItem,
  recipe: Partial<Extract<RegionEditInput, { mode: "regenerate" }>> | null,
  voice: Pick<PlaygroundVoiceOption, "id" | "name" | "provider" | "language">,
  modelId: string,
  catalog: Parameters<typeof withComposerVoice>[2],
  languageCode?: string,
) {
  const settings = recipe?.voiceSettings ?? item.voiceSettings;
  const connection = recipe?.connection ?? item.connection ?? "genvoice";
  if (connection !== "genvoice") {
    return {
      connection,
      speechStyle: recipe?.speechStyle ?? item.speechStyle,
      voiceId: recipe?.voiceId ?? item.voiceId,
      voiceName: recipe?.voiceName ?? item.voiceName,
      modelId: recipe?.modelId ?? item.modelId,
      languageCode: recipe?.languageCode ?? item.languageCode,
      voiceSettings: settings,
      previousText: recipe?.previousText,
      nextText: recipe?.nextText,
      seed: recipe?.seed,
      outputFormat: recipe?.outputFormat ?? item.outputFormat,
      applyTextNormalization: recipe?.applyTextNormalization ?? item.applyTextNormalization,
    };
  }
  const draft = withComposerVoice(
    {
      ...DEFAULT_COMPOSER_DRAFT,
      provider: recipe?.provider ?? (item.provider === "google" ? undefined : item.provider),
      modelId,
      languageCode: languageCode ?? recipe?.languageCode ?? item.languageCode,
      speed: settings.speed ?? 1,
      pitch: settings.pitch ?? 0,
      vol: settings.vol ?? 1,
      stability: settings.stability ?? 0.5,
      similarityBoost: settings.similarity_boost ?? 0.75,
      style: settings.style ?? 0,
      useSpeakerBoost: settings.use_speaker_boost ?? false,
      seedText: recipe?.seed === undefined ? "" : String(recipe.seed),
      previousText: recipe?.previousText ?? "",
      nextText: recipe?.nextText ?? "",
      outputFormat: recipe?.outputFormat ?? "",
      applyTextNormalization: recipe?.applyTextNormalization ?? "auto",
    },
    voice,
    catalog,
  );
  return {
    connection,
    provider: draft.provider ?? providerForModel(draft.modelId),
    voiceId: draft.voiceId,
    voiceName: draft.voiceName,
    modelId: draft.modelId,
    languageCode: draft.languageCode,
    voiceSettings: voiceSettingsForModel(
      catalog.models.find((model) => model.model_id === draft.modelId),
      draft,
    ),
    seed: draft.seedText ? Number(draft.seedText) : undefined,
    previousText: draft.previousText || undefined,
    nextText: draft.nextText || undefined,
    outputFormat: draft.outputFormat || undefined,
    applyTextNormalization:
      draft.provider === "elevenlabs" ? draft.applyTextNormalization : undefined,
  };
}

export function wordRangeSelection(
  words: Array<{ w: string; s: number; e: number }>,
  first: number,
  last: number,
) {
  const selected = words.slice(Math.min(first, last), Math.max(first, last) + 1);
  if (!selected.length) return null;
  return {
    from: Math.min(...selected.map((word) => word.s)),
    to: Math.max(...selected.map((word) => word.e)),
    text: selected.map((word) => word.w).join(" "),
  };
}

export function samePhraseGeneration(a: RegionEditInput, b: RegionEditInput): boolean {
  if (a.mode !== "regenerate" || b.mode !== "regenerate") return false;
  const fields = (input: typeof a) => [
    input.replacementText,
    input.connection ?? "genvoice",
    input.speechStyle ?? "",
    input.provider ?? providerForModel(input.modelId),
    input.voiceId,
    input.modelId,
    input.voiceSettings,
    input.languageCode,
    input.seed,
    input.previousText,
    input.nextText,
    input.outputFormat,
    input.applyTextNormalization,
  ];
  return JSON.stringify(fields(a)) === JSON.stringify(fields(b));
}

export function replaceUniquePhrase(
  text: string,
  phrase: string,
  replacement: string,
): string | null {
  const at = phrase.trim() ? text.indexOf(phrase) : -1;
  if (at < 0 || text.indexOf(phrase, at + phrase.length) !== -1) return null;
  return text.slice(0, at) + replacement + text.slice(at + phrase.length);
}

export function recordingEditRecipe(item: VoicePlaygroundItem): RegionEditInput | null {
  const version = item.version;
  if (!version) return null;
  if (version.edit.mode === "local") return structuredClone(version.edit);
  const replacement = version.replacement;
  if (!replacement) return null;
  return {
    ...structuredClone(version.edit),
    connection: replacement.connection,
    speechStyle: replacement.speechStyle,
    provider: replacement.provider === "google" ? undefined : replacement.provider,
    voiceId: replacement.voiceId,
    voiceName: replacement.voiceName,
    modelId: replacement.modelId,
    voiceSettings: replacement.voiceSettings,
    languageCode: replacement.languageCode,
    seed: replacement.seed,
    previousText: replacement.previousText,
    nextText: replacement.nextText,
    outputFormat: replacement.outputFormat,
    applyTextNormalization: replacement.applyTextNormalization,
    exportTranscript: false,
  };
}

export function appliedEditRows(
  item: VoicePlaygroundItem,
): Array<{ label: string; value: string }> {
  if (!item.version) return [];
  const { edit, replacement } = item.version;
  const rows = [{ label: "Region", value: `${edit.from.toFixed(2)}–${edit.to.toFixed(2)} s` }];
  if (edit.mode === "local") rows.push({ label: "Speed", value: `${edit.rate ?? 1}×` });
  else
    rows.push(
      { label: "Fit original slot", value: edit.fitToSelection !== false ? "Yes" : "No" },
      { label: "Replacement phrase", value: edit.replacementText },
    );
  rows.push(
    { label: "Pitch", value: `${(edit.pitch ?? 0) > 0 ? "+" : ""}${edit.pitch ?? 0} semitones` },
    { label: "Volume", value: `${edit.gainDb ?? 0} dB` },
    { label: "Pause after", value: `${edit.pause ?? 0} s` },
    { label: "Join blend", value: `${edit.blendMs ?? 6} ms` },
  );
  if (replacement) {
    rows.push(
      {
        label: "Replacement voice",
        value: `${replacement.voiceName || replacement.voiceId} (${replacement.voiceId})`,
      },
      { label: "Replacement model", value: replacement.modelId },
    );
    for (const [key, value] of Object.entries(replacement.voiceSettings ?? {}))
      rows.push({ label: `Replacement ${key.replaceAll("_", " ")}`, value: String(value) });
    if (replacement.seed !== undefined)
      rows.push({ label: "Replacement seed", value: String(replacement.seed) });
    if (replacement.previousText)
      rows.push({ label: "Previous context", value: replacement.previousText });
    if (replacement.nextText) rows.push({ label: "Next context", value: replacement.nextText });
    if (replacement.outputFormat)
      rows.push({ label: "Requested output", value: replacement.outputFormat });
  }
  return rows;
}
