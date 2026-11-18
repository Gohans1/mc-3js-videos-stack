import { estimateSpeechModelCredits } from "../../src/voice-playground-text.mjs";
import type { PlaygroundConnection, PlaygroundModelInfo } from "../../src/voice-playground.mjs";

interface QuoteSpeaker {
  name: string;
  voiceId?: string;
  voiceName?: string;
  modelId: string;
}
interface QuoteInput {
  connection?: PlaygroundConnection;
  mode: string;
  text: string;
  modelId?: string;
  voiceId?: string;
  voiceName?: string;
  variations?: number;
  exportTranscript?: boolean;
  speakers?: QuoteSpeaker[];
  voiceRate?: number;
}
export interface GenerationQuote {
  baseCredits: number | null;
  totalCredits: number | null;
  rows: Array<{
    label: string;
    characters: number;
    modelId: string;
    voiceName: string;
    baseCredits: number | null;
  }>;
}
export function quoteGeneration(
  input: QuoteInput,
  models: readonly Pick<PlaygroundModelInfo, "model_id" | "model_rates">[],
): GenerationQuote {
  if (input.mode !== "tts" && input.mode !== "dialogue")
    return { baseCredits: null, totalCredits: null, rows: [] };
  const counts = new Map<string, number>();
  if (input.mode === "dialogue") {
    let speaker = "";
    for (const line of input.text.split(/\r?\n/)) {
      const turn = line.match(/^\s*\[?([^\]:]+)\]?\s*:\s*(.*)$/);
      if (turn) {
        speaker = turn[1]!.trim();
        counts.set(speaker, (counts.get(speaker) ?? 0) + turn[2]!.trim().length);
      } else if (speaker) counts.set(speaker, (counts.get(speaker) ?? 0) + line.trim().length);
    }
  }
  const speakers =
    input.mode === "dialogue"
      ? (input.speakers ?? [])
      : [
          {
            name: input.voiceName || "Voice",
            voiceName: input.voiceName,
            modelId: input.modelId || "",
          },
        ];
  const copies = input.mode === "tts" ? Math.min(3, Math.max(1, input.variations ?? 1)) : 1;
  const rows = speakers.map((speaker) => {
    const characters =
      input.mode === "dialogue" ? (counts.get(speaker.name) ?? 0) : input.text.trim().length;
    const rate = models.find((m) => m.model_id === speaker.modelId)?.model_rates
      ?.character_cost_multiplier;
    const baseCredits = estimateSpeechModelCredits(
      characters,
      rate,
      copies,
      input.mode === "tts" &&
        Boolean(input.exportTranscript) &&
        (!input.connection || input.connection === "genvoice"),
    );
    return {
      label: speaker.name,
      characters,
      modelId: speaker.modelId,
      voiceName: speaker.voiceName || speaker.name,
      baseCredits,
    };
  });
  const unknownSpeaker =
    input.mode === "dialogue" &&
    [...counts.keys()].some((name) => !speakers.some((s) => s.name === name));
  const baseCredits =
    rows.length && !unknownSpeaker && rows.every((row) => row.baseCredits !== null)
      ? rows.reduce((sum, row) => sum + row.baseCredits!, 0)
      : null;
  return { baseCredits, totalCredits: null, rows };
}
