import { extname, resolve } from "node:path";

export const DEFAULT_MODEL = "gemini-3.8-flash-tts";
export const SPEECH_ORIGIN = "https://aistudio.google.com";
export const SPEECH_PATH = /^\/(?:u\/\d+\/)?generate-speech\/?$/;

export class InputError extends Error {}

export const speechAccountMatches = (pathname: string, account: string) =>
  pathname.startsWith(`/u/${account}/`);

export function speechUrl(model: string, account?: string) {
  if (!/^gemini-[a-z0-9.-]+-tts(?:-[a-z0-9.-]+)?$/.test(model)) {
    throw new InputError("Expected a Gemini TTS model ID.");
  }
  if (account !== undefined && !/^\d+$/.test(account)) {
    throw new InputError("--account must be a Google account slot number.");
  }
  const prefix = account === undefined ? "" : `/u/${account}`;
  return `${SPEECH_ORIGIN}${prefix}/generate-speech?model=${model}`;
}

export function voiceSampleUrl(input: string) {
  const url = URL.parse(input);
  if (
    url?.origin === "https://www.gstatic.com" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password &&
    /^\/aistudio\/voices\/samples\/[\w./-]+\.wav$/i.test(url.pathname)
  ) {
    return url.href;
  }
}

export type SpeechBlock = { text: string; style?: string; speaker?: 1 | 2 };
export type Scene = { temperature?: number; voices?: [string, string?]; blocks: SpeechBlock[] };
export type BatchTake = {
  out: string;
  blocks: SpeechBlock[];
  temperature?: number;
};
export type BatchManifest = {
  temperature?: number;
  voices?: [string, string?];
  takes: BatchTake[];
};

export function matchChoice(choices: string[], query: string): string | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  return choices.find((choice) => choice.trim().toLowerCase() === needle);
}

function validateVoicesField(voices: unknown, path: string): [string, string?] | undefined {
  if (voices === undefined) return undefined;
  if (
    !Array.isArray(voices) ||
    voices.length < 1 ||
    voices.length > 2 ||
    voices.some((voice) => typeof voice !== "string" || !voice.trim())
  ) {
    throw new InputError(`${path} must contain one or two nonempty voice names.`);
  }
  return voices.map((voice) => voice.trim()) as [string, string?];
}

function validateTemperatureField(temperature: unknown, path: string): number | undefined {
  if (temperature === undefined) return undefined;
  if (typeof temperature !== "number" || !Number.isFinite(temperature)) {
    throw new InputError(`${path} must be a finite number.`);
  }
  return temperature;
}

function validateBlocksField(blocks: unknown, path: string): SpeechBlock[] {
  if (!Array.isArray(blocks) || !blocks.length) {
    throw new InputError(`${path} must contain a speech block.`);
  }
  return blocks.map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const { text, style, speaker } = object(entry, itemPath, ["text", "style", "speaker"]);
    if (typeof text !== "string" || !text.trim()) {
      throw new InputError(`${itemPath}.text must be nonempty text.`);
    }
    if (style !== undefined && typeof style !== "string") {
      throw new InputError(`${itemPath}.style must be a string.`);
    }
    if (speaker !== undefined && speaker !== 1 && speaker !== 2) {
      throw new InputError(`${itemPath}.speaker must be 1 or 2.`);
    }
    if (speaker !== undefined && speaker !== (index % 2) + 1) {
      throw new InputError(
        `${itemPath}.speaker must be ${(index % 2) + 1}. AI Studio alternates speakers when adding blocks.`,
      );
    }
    return {
      text,
      ...(style !== undefined ? { style } : {}),
      ...(speaker !== undefined ? { speaker } : {}),
    };
  });
}

function object(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError(`${path} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new InputError(`${path}.${key} is not supported.`);
  }
  return value as Record<string, unknown>;
}

export function validateScene(value: unknown): Scene {
  const scene = object(value, "scene", ["temperature", "voices", "blocks"]);
  const temperature = validateTemperatureField(scene.temperature, "scene.temperature");
  const voices = validateVoicesField(scene.voices, "scene.voices");
  const blocks = validateBlocksField(scene.blocks, "scene.blocks");
  if (voices?.[1] && blocks.length < 2) {
    throw new InputError("Voice 2 requires at least two speech blocks.");
  }
  return {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(voices !== undefined ? { voices } : {}),
    blocks,
  };
}

export function validateBatchManifest(value: unknown): BatchManifest {
  const manifest = object(value, "manifest", ["temperature", "voices", "takes"]);
  const temperature = validateTemperatureField(manifest.temperature, "manifest.temperature");
  const voices = validateVoicesField(manifest.voices, "manifest.voices");
  if (!Array.isArray(manifest.takes) || !manifest.takes.length) {
    throw new InputError("manifest.takes must contain at least one take.");
  }
  const seenOutputs = new Set<string>();
  const takes = manifest.takes.map((entry, index) => {
    const path = `manifest.takes[${index}]`;
    const raw = object(entry, path, ["out", "text", "style", "blocks", "temperature"]);
    if (typeof raw.out !== "string" || !raw.out.trim()) {
      throw new InputError(`${path}.out must be a nonempty .wav path.`);
    }
    if (extname(raw.out).toLowerCase() !== ".wav") {
      throw new InputError(`${path}.out must end in .wav.`);
    }
    const normalizedOut = resolve(raw.out).toLowerCase();
    if (seenOutputs.has(normalizedOut)) {
      throw new InputError(`${path}.out is a duplicate output path: ${raw.out}.`);
    }
    seenOutputs.add(normalizedOut);
    const takeTemp = validateTemperatureField(raw.temperature, `${path}.temperature`);
    const hasText = raw.text !== undefined;
    const hasBlocks = raw.blocks !== undefined;
    if (hasText === hasBlocks) {
      throw new InputError(`${path} must specify either text or blocks (not both).`);
    }
    let blocks: SpeechBlock[];
    if (hasBlocks) {
      if (raw.style !== undefined) {
        throw new InputError(
          `${path}.style cannot be combined with blocks; set style on each block.`,
        );
      }
      blocks = validateBlocksField(raw.blocks, `${path}.blocks`);
    } else {
      if (typeof raw.text !== "string" || !raw.text.trim()) {
        throw new InputError(`${path}.text must be nonempty text.`);
      }
      if (raw.style !== undefined && typeof raw.style !== "string") {
        throw new InputError(`${path}.style must be a string.`);
      }
      blocks = [
        {
          text: raw.text,
          ...(raw.style !== undefined ? { style: raw.style } : {}),
        },
      ];
    }
    return {
      out: raw.out,
      blocks,
      ...(takeTemp !== undefined ? { temperature: takeTemp } : {}),
    };
  });
  if (voices?.[1] && !takes.some((take) => take.blocks.length >= 2)) {
    throw new InputError("manifest.voices[1] requires at least one take with two speech blocks.");
  }
  return {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(voices !== undefined ? { voices } : {}),
    takes,
  };
}
