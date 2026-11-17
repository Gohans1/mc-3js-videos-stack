import { createHash } from "node:crypto";

export const MODEL = "google/gemini-embedding-2";
export const RECIPE =
  "retrieval-v1:caption1000utf8:audio179-mp3-48k128:video30-1fps-up512:no-video-audio:image768png";
export const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const documentText = (title: string, text: string, media: boolean) =>
  Buffer.from(media ? `${title}. ${text}` : `title: ${title} | text: ${text}`)
    .subarray(0, 1000)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
export type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: "mp3" } }
  | { type: "input_video"; input_video: { data: string } };
export type Embedding = { vector: number[]; usage: Record<string, unknown> };
export type Embed = (parts: Part[], signal?: AbortSignal) => Promise<Embedding>;
export const normalize = (value: unknown, dimensions: number): number[] => {
  if (!Array.isArray(value) || value.length !== dimensions)
    throw new Error("Wrong embedding dimensions");
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n)))
    throw new Error("Embedding must contain finite numbers");
  const length = Math.hypot(...value);
  if (!length || !Number.isFinite(length)) throw new Error("Embedding has zero or invalid length");
  return value.map((n) => n / length);
};
export const createEmbedder = ({
  apiKey,
  dimensions = 768,
  endpoint = "https://openrouter.ai/api/v1/embeddings",
}: {
  apiKey: string;
  dimensions?: number;
  endpoint?: string;
}): Embed => {
  if (!apiKey) throw new Error("Set OPENROUTER_API_KEY to allow embedding requests");
  if (![768, 1536, 3072].includes(dimensions))
    throw new Error("Dimensions must be 768, 1536 or 3072");
  return async (content, signal) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        dimensions,
        encoding_format: "float",
        input: [{ content }],
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
        : AbortSignal.timeout(45000),
    });
    if (!response.ok)
      throw new Error(`OpenRouter embeddings HTTP ${response.status}; retry pending work later`);
    const result = (await response.json()) as {
      data?: { embedding?: unknown; index?: number }[];
      usage?: Record<string, unknown>;
    };
    if (result.data?.length !== 1 || result.data[0]?.index !== 0)
      throw new Error("Expected one embedding result");
    return { vector: normalize(result.data[0].embedding, dimensions), usage: result.usage ?? {} };
  };
};
