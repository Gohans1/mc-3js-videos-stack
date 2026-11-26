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
  const { temperature, voices, blocks } = scene;
  if (
    temperature !== undefined &&
    (typeof temperature !== "number" || !Number.isFinite(temperature))
  ) {
    throw new InputError("scene.temperature must be a finite number.");
  }
  if (
    voices !== undefined &&
    (!Array.isArray(voices) ||
      voices.length < 1 ||
      voices.length > 2 ||
      voices.some((voice) => typeof voice !== "string" || !voice.trim()))
  ) {
    throw new InputError("scene.voices must contain one or two nonempty voice names.");
  }
  if (!Array.isArray(blocks) || !blocks.length)
    throw new InputError("scene.blocks must contain a speech block.");
  for (const [index, value] of blocks.entries()) {
    const path = `scene.blocks[${index}]`;
    const { text, style, speaker } = object(value, path, ["text", "style", "speaker"]);
    if (typeof text !== "string" || !text.trim())
      throw new InputError(`${path}.text must be nonempty text.`);
    if (style !== undefined && typeof style !== "string")
      throw new InputError(`${path}.style must be a string.`);
    if (speaker !== undefined && speaker !== 1 && speaker !== 2) {
      throw new InputError(`${path}.speaker must be 1 or 2.`);
    }
  }
  return scene as Scene;
}
