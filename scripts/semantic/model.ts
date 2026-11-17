import { createHash } from "node:crypto";

export const MODEL = "google/gemini-embedding-2";
export const RECIPE =
  "retrieval-v2:caption1000utf8:audio30-mp3-48k128:video30-1fps-up512:no-video-audio:image768png";
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
export type Provider = "gemini" | "openrouter";
export const configuredProvider = (
  choice = "auto",
  env: Record<string, string | undefined> = process.env,
): { provider: Provider; apiKey: string } => {
  if (!["auto", "gemini", "openrouter"].includes(choice))
    throw new Error("Choose provider auto, gemini or openrouter");
  const google = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const provider = choice === "auto" ? (google ? "gemini" : "openrouter") : (choice as Provider);
  return { provider, apiKey: (provider === "gemini" ? google : env.OPENROUTER_API_KEY) ?? "" };
};
export class EmbeddingError extends Error {
  constructor(
    public status: number,
    public retryAfterMs: number | null,
    provider: Provider,
  ) {
    super(
      `${provider} embeddings HTTP ${status}; ${status === 429 ? "quota reached; completed work is saved" : "check provider access and retry pending work"}`,
    );
    this.name = "EmbeddingError";
  }
}
const inlineData = (data: string) => {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!match) throw new Error("Media must be an inline base64 data URL");
  return { mimeType: match[1]!, data: match[2]! };
};
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
  provider = "openrouter",
  endpoint,
}: {
  apiKey: string;
  dimensions?: number;
  provider?: Provider;
  endpoint?: string;
}): Embed => {
  if (!apiKey)
    throw new Error(
      `Set ${provider === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY"} to allow embedding requests`,
    );
  if (provider !== "gemini" && provider !== "openrouter")
    throw new Error("Unknown embedding provider");
  if (![768, 1536, 3072].includes(dimensions))
    throw new Error("Dimensions must be 768, 1536 or 3072");
  return async (content, signal) => {
    const response = await fetch(
      endpoint ??
        (provider === "gemini"
          ? "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent"
          : "https://openrouter.ai/api/v1/embeddings"),
      {
        method: "POST",
        headers:
          provider === "gemini"
            ? { "x-goog-api-key": apiKey, "content-type": "application/json" }
            : { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(
          provider === "gemini"
            ? {
                model: "models/gemini-embedding-2",
                outputDimensionality: dimensions,
                content: {
                  parts: content.map((part) =>
                    part.type === "text"
                      ? { text: part.text }
                      : {
                          inlineData: inlineData(
                            part.type === "input_audio"
                              ? part.input_audio.data
                              : part.type === "input_video"
                                ? part.input_video.data
                                : part.image_url.url,
                          ),
                        },
                  ),
                },
              }
            : {
                model: MODEL,
                dimensions,
                encoding_format: "float",
                input: [{ content }],
              },
        ),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
          : AbortSignal.timeout(45000),
      },
    );
    if (!response.ok) {
      const after = response.headers.get("retry-after"),
        seconds = after === null ? NaN : Number(after);
      throw new EmbeddingError(
        response.status,
        Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null,
        provider,
      );
    }
    const result = (await response.json()) as {
      embedding?: { values?: unknown };
      usageMetadata?: Record<string, unknown>;
      data?: { embedding?: unknown; index?: number }[];
      usage?: Record<string, unknown>;
    };
    if (provider === "gemini")
      return {
        vector: normalize(result.embedding?.values, dimensions),
        usage: result.usageMetadata ?? {},
      };
    if (result.data?.length !== 1 || result.data[0]?.index !== 0)
      throw new Error("Expected one embedding result");
    return { vector: normalize(result.data[0].embedding, dimensions), usage: result.usage ?? {} };
  };
};
