import { providerForModel } from "../../src/voice-playground-providers.mjs";
import type {
  PlaygroundProvider,
  PlaygroundRecordingEngine,
  PlaygroundVoiceSettings,
} from "../../src/voice-playground.mjs";

export function recordedCastSummary(
  speakers: readonly {
    name: string;
    provider?: PlaygroundProvider;
    model_id?: string;
    voice_id: string;
  }[],
) {
  const models = [...new Set(speakers.map((speaker) => speaker.model_id || "Not recorded"))];
  const providers = [
    ...new Set(
      speakers.map(
        (speaker) =>
          speaker.provider ?? (speaker.model_id ? providerForModel(speaker.model_id) : "unknown"),
      ),
    ),
  ];
  return {
    modelLabel: `${models.length > 1 ? "Mixed models \u00b7 " : ""}${models.join(", ")}`,
    sources: providers
      .map((provider) =>
        provider === "minimax"
          ? "MiniMax"
          : provider === "capcut"
            ? "CapCut"
            : provider === "elevenlabs"
              ? "ElevenLabs"
              : "Not recorded",
      )
      .join(", "),
    voices: speakers.map((speaker) => `${speaker.name}: ${speaker.voice_id}`).join("; "),
  };
}

export function recordedVoiceSettings(
  provider: PlaygroundRecordingEngine,
  settings: PlaygroundVoiceSettings,
  missing = "Default",
) {
  const number = (value: number | undefined, suffix = "") =>
    typeof value === "number" ? `${value.toFixed(2)}${suffix}` : missing;
  const row = (label: string, value: string) => ({ label, value, mono: true });
  if (provider === "google") return [];
  if (provider !== "elevenlabs")
    return [
      row("Speed", number(settings.speed, "×")),
      row("Pitch", typeof settings.pitch === "number" ? `${settings.pitch} semitones` : missing),
      ...(provider === "minimax" ? [row("Volume", number(settings.vol, "×"))] : []),
    ];
  return [
    row("Stability", number(settings.stability)),
    row("Similarity", number(settings.similarity_boost)),
    row("Style", number(settings.style)),
    row(
      "Speaker Boost",
      typeof settings.use_speaker_boost === "boolean"
        ? settings.use_speaker_boost
          ? "Enabled"
          : "Off"
        : missing,
    ),
    row("Speed", number(settings.speed, "×")),
  ];
}
