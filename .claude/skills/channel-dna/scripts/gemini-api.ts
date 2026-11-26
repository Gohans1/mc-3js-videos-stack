#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  expectedVideoTokensFloor,
  pictureDurationInRange,
  probeVideoMeta,
  toGeminiMediaResolution,
} from "../../../../scripts/review/gemini-video-input.ts";

import {
  classifyGeminiError,
  extractGeminiErrorReason,
  GeminiApiHttpError,
  type GeminiApiPhase,
  type GeminiErrorKind,
  getInFlightLabels,
  loadGmnKeyPool,
  loadGmnState,
  parseRetryAfterMs,
  pickUsablePoolKey,
  type RawGeminiErrorJson,
  recordKeyFailure,
  recordKeySuccess,
  rotationOrder,
} from "./key-pool.ts";

export { expectedVideoTokensFloor, probeVideoMeta, toGeminiMediaResolution };

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
export const UNIFIED_TOKEN_SOFT_LIMIT = 1_000_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GeminiApiVideoRequest {
  videoPath?: string;
  videoPaths?: string[];
  videoDurationsSec?: number[];
  videoStartsSec?: number[];
  imagePath?: string;
  durationSec: number;
  sourceFps?: number;
  expectAudio?: boolean;
  startOffsetSec?: number;
  endOffsetSec?: number;
  mediaProcessing?: "STATIC" | "AGENTIC";
  stream?: boolean;
  systemPrompt: string;
  userPrompt: string;
  model: string;
  thinking: string;
  media: string;
  fps: number;
  apiKey?: string;
  keyPoolDir?: string;
  rounds?: number;
  deadlineMs?: number;
  switchDelayMs?: number;
  roundDelaysMs?: number[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  retryBaseMs?: number;
  fetchImpl?: FetchLike;
}

export interface GeminiApiVideoResult {
  markdown: string;
  finishReason: string | null;
  promptTokens: number | null;
  videoTokens: number | null;
  audioTokens: number | null;
  outputTokens: number | null;
  keyLabel?: string | null;
}

export function resolveGeminiApiKey(explicit?: string, opts?: { keyPoolDir?: string }): string {
  const direct = explicit?.trim();
  if (direct) return direct;
  const pool = loadGmnKeyPool(opts?.keyPoolDir);
  if (pool.keys.length > 0) {
    const state = loadGmnState(pool.statePath);
    const usable = pickUsablePoolKey(pool, state);
    if (usable) return usable.value;
    const labels = pool.keys.map((k) => k.label).join(", ");
    throw new Error(`Gemini API auth failed: all keys in pool are disabled (${labels})`);
  }
  const envKey = [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]
    .map((v) => v?.trim() ?? "")
    .find(Boolean);
  if (!envKey) {
    throw new Error("Gemini API auth failed: no usable API key configured");
  }
  return envKey;
}

export function toGeminiThinkingLevel(
  level: string,
): "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" | "XHIGH" {
  const norm = level
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (norm === "minimal") return "MINIMAL";
  if (norm === "low") return "LOW";
  if (norm === "medium") return "MEDIUM";
  if (norm === "high") return "HIGH";
  if (norm === "extrahigh" || norm === "xhigh") return "XHIGH";
  throw new Error(
    `unsupported Gemini thinking level "${level}" (expected Minimal, Low, Medium, High, or Extra High)`,
  );
}

export function normalizeMediaLabel(media: string): "Default" | "Low" | "Medium" | "High" {
  const level = toGeminiMediaResolution(media);
  if (level === "MEDIA_RESOLUTION_LOW") return "Low";
  if (level === "MEDIA_RESOLUTION_MEDIUM") return "Medium";
  if (level === "MEDIA_RESOLUTION_HIGH") return "High";
  return "Default";
}

export function estimateUnifiedVideoTokens(opts: {
  durationSec: number;
  fps: number;
  media: string;
  sourceFps?: number;
  videoCount?: number;
}): {
  estimatedTokens: number;
  effectiveFps: number;
  suggestedFps: number | null;
} {
  const count = Math.max(1, opts.videoCount ?? 1);
  const effectiveFps =
    opts.sourceFps !== undefined && Number.isFinite(opts.sourceFps) && opts.sourceFps > 0
      ? Math.min(opts.fps, opts.sourceFps)
      : opts.fps;
  const tokPerFrame = toGeminiMediaResolution(opts.media) === "MEDIA_RESOLUTION_HIGH" ? 280 : 70;
  const videoAndAudio = count * opts.durationSec * (effectiveFps * tokPerFrame + 32);
  const estimatedTokens = Math.round(videoAndAudio + 75_000);
  let suggestedFps: number | null = null;
  if (estimatedTokens > UNIFIED_TOKEN_SOFT_LIMIT && opts.durationSec > 0) {
    const budgetForVideo = UNIFIED_TOKEN_SOFT_LIMIT - 75_000 - count * opts.durationSec * 32;
    const maxFps =
      budgetForVideo > 0 ? budgetForVideo / (count * opts.durationSec * tokPerFrame) : 0;
    const floored = Math.floor(maxFps * 10) / 10;
    suggestedFps = floored >= 0.2 ? Number(Math.min(24, floored).toFixed(1)) : null;
  }
  return { estimatedTokens, effectiveFps, suggestedFps };
}

export function verifyGeminiApiVideoTokens(opts: {
  durationSec: number;
  sourceFps?: number;
  fps: number;
  media: string;
  expectAudio?: boolean;
  hasModalityDetails?: boolean;
  promptTokens: number | null;
  videoTokens: number | null;
  audioTokens?: number | null;
}): string | null {
  if (
    opts.expectAudio === true &&
    opts.hasModalityDetails === true &&
    opts.audioTokens !== null &&
    opts.audioTokens !== undefined &&
    opts.audioTokens <= 0
  ) {
    return "video sampling silently downgraded by Gemini API: source clip has audio, but API billed 0 AUDIO tokens";
  }
  const floor = expectedVideoTokensFloor(opts.durationSec, opts.fps, opts.media, opts.sourceFps);
  if (floor === 0) return null;
  const measured =
    opts.hasModalityDetails === true
      ? (opts.videoTokens ?? 0)
      : (opts.videoTokens ?? opts.promptTokens);
  if (measured === null) {
    return `video sampling could not be verified by Gemini API: usageMetadata missing token counts (expected >= ${floor.toLocaleString("en-US")} tokens)`;
  }
  if (measured < floor) {
    const effectiveFps =
      opts.sourceFps !== undefined && Number.isFinite(opts.sourceFps) && opts.sourceFps > 0
        ? Math.min(opts.fps, opts.sourceFps)
        : opts.fps;
    const tokPerFrame = toGeminiMediaResolution(opts.media) === "MEDIA_RESOLUTION_HIGH" ? 280 : 70;
    const nominal = Math.round(opts.durationSec * effectiveFps * tokPerFrame);
    const meter =
      opts.hasModalityDetails === true || opts.videoTokens !== null ? "VIDEO" : "prompt";
    return `video sampling silently downgraded by Gemini API: expected ~${nominal.toLocaleString("en-US")} tokens (${opts.durationSec.toFixed(1)}s @ ${effectiveFps} fps, ${opts.media}), but API billed only ${measured.toLocaleString("en-US")} ${meter} tokens`;
  }
  return null;
}

interface RawGeminiChunk {
  error?: {
    message?: string;
    status?: string;
    code?: number;
    details?: Array<{ reason?: string; retryDelay?: string }>;
  };
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  };
}

export function parseGeminiSseStream(rawSse: string): {
  markdown: string;
  finishReason: string | null;
  blockReason: string | null;
  usageMetadata?: RawGeminiChunk["usageMetadata"];
} {
  const textChunks: string[] = [];
  let finishReason: string | null = null;
  let blockReason: string | null = null;
  let usageMetadata: RawGeminiChunk["usageMetadata"];
  const lines = rawSse.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    const chunk = JSON.parse(payload) as RawGeminiChunk;
    if (chunk.error?.message) {
      const status = typeof chunk.error.code === "number" ? chunk.error.code : 500;
      const codePart = chunk.error.code ? `HTTP ${chunk.error.code}` : "SSE";
      const statusPart = chunk.error.status ? ` ${chunk.error.status}` : "";
      const summary = `${codePart}${statusPart}: ${chunk.error.message}`;
      const rawErr: RawGeminiErrorJson = { error: chunk.error };
      const reason = extractGeminiErrorReason(rawErr) || chunk.error.message;
      throw new GeminiApiHttpError({
        message: `Gemini API stream error (${codePart}${statusPart}): ${chunk.error.message}`,
        status,
        kind: classifyGeminiError(status, reason, "stream"),
        summary,
        retryAfterMs: parseRetryAfterMs(null, rawErr),
        phase: "stream",
      });
    }
    if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
    const cand = chunk.candidates?.[0];
    if (cand?.finishReason) finishReason = cand.finishReason;
    for (const part of cand?.content?.parts ?? []) {
      if (!part.thought && typeof part.text === "string") {
        textChunks.push(part.text);
      }
    }
  }
  return { markdown: textChunks.join("").trim(), finishReason, blockReason, usageMetadata };
}

async function readHttpError(
  res: Response,
  prefix: string,
  phase: GeminiApiPhase,
): Promise<GeminiApiHttpError> {
  let summary = `HTTP ${res.status} ${res.statusText}`.trim();
  let parsed: RawGeminiErrorJson | null = null;
  let reason = "";
  try {
    const txt = await res.text();
    try {
      parsed = JSON.parse(txt) as RawGeminiErrorJson;
      if (parsed.error?.message) {
        summary = `HTTP ${res.status}${parsed.error.status ? ` ${parsed.error.status}` : ""}: ${parsed.error.message}`;
      } else {
        summary = `HTTP ${res.status}: ${txt.slice(0, 300).trim() || res.statusText}`;
      }
      reason = extractGeminiErrorReason(parsed);
    } catch {
      summary = `HTTP ${res.status}: ${txt.slice(0, 300).trim() || res.statusText}`;
      reason = txt.slice(0, 300).trim();
    }
  } catch {}
  return new GeminiApiHttpError({
    message: `${prefix}: ${summary}`,
    status: res.status,
    kind: classifyGeminiError(res.status, reason || summary, phase),
    summary,
    retryAfterMs: parseRetryAfterMs(res.headers, parsed),
    phase,
  });
}

async function safeFetch(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  phase: GeminiApiPhase,
): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (err) {
    if (err instanceof GeminiApiHttpError) throw err;
    throw networkError(err, phase);
  }
}

function networkError(err: unknown, phase: GeminiApiPhase): GeminiApiHttpError {
  const message = err instanceof Error ? err.message : String(err);
  return new GeminiApiHttpError({
    message,
    status: 0,
    kind: "capacity",
    summary: `net ${message.replace(/\s+/g, " ").slice(0, 160)}`,
    phase,
  });
}

async function readResponseBody(res: Response, phase: GeminiApiPhase): Promise<string> {
  try {
    return await res.text();
  } catch (err) {
    throw networkError(err, phase);
  }
}

function requestSignal(timeoutMs: number, stopAt = Infinity): AbortSignal {
  return AbortSignal.timeout(Math.min(timeoutMs, Math.max(0, stopAt - Date.now())));
}

function inferImageMimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function validateUploadUrl(uploadUrl: string | null): string {
  let validUploadUrl = false;
  if (uploadUrl) {
    try {
      const parsedUpload = new URL(uploadUrl);
      validUploadUrl =
        parsedUpload.protocol === "https:" &&
        (parsedUpload.hostname === "generativelanguage.googleapis.com" ||
          parsedUpload.hostname.endsWith(".googleapis.com"));
    } catch {}
  }
  if (!uploadUrl || !validUploadUrl) {
    throw new Error(
      "Gemini File API upload start response missing valid https googleapis x-goog-upload-url",
    );
  }
  return uploadUrl;
}

async function uploadAndAwaitFile(opts: {
  filePath: string;
  apiKey: string;
  fetchFn: FetchLike;
  pollIntervalMs: number;
  uploadedNames: string[];
  stopAt?: number;
}): Promise<{ fileName: string; fileUri: string }> {
  const file = Bun.file(opts.filePath);
  const byteLength = file.size;
  const displayName = basename(opts.filePath);
  const startRes = await safeFetch(
    opts.fetchFn,
    `${GEMINI_API_BASE}/upload/v1beta/files`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": opts.apiKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(byteLength),
        "X-Goog-Upload-Header-Content-Type": "video/mp4",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { displayName } }),
      signal: requestSignal(60_000, opts.stopAt),
    },
    "upload_start",
  );
  if (!startRes.ok) {
    throw await readHttpError(startRes, "Gemini File API upload start failed", "upload_start");
  }
  const uploadUrl = validateUploadUrl(startRes.headers.get("x-goog-upload-url"));
  const uploadRes = await safeFetch(
    opts.fetchFn,
    uploadUrl,
    {
      method: "POST",
      headers: {
        "Content-Length": String(byteLength),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: file,
      signal: requestSignal(180_000, opts.stopAt),
    },
    "upload_transfer",
  );
  if (!uploadRes.ok) {
    throw await readHttpError(
      uploadRes,
      "Gemini File API upload transfer failed",
      "upload_transfer",
    );
  }
  const uploadJson = JSON.parse(await readResponseBody(uploadRes, "upload_transfer")) as {
    file?: {
      name?: string;
      uri?: string;
      mimeType?: string;
      state?: string;
      error?: { message?: string };
    };
  };
  const fileName = uploadJson.file?.name;
  let fileUri = uploadJson.file?.uri;
  let state = uploadJson.file?.state ?? "PROCESSING";
  let fileErrorMsg = uploadJson.file?.error?.message ?? "";
  if (
    !fileName ||
    !/^files\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(fileName) ||
    fileName.includes("..")
  ) {
    throw new Error("Gemini File API upload returned incomplete or invalid file metadata");
  }
  opts.uploadedNames.push(fileName);

  const pollDeadline = Math.min(Date.now() + 180_000, opts.stopAt ?? Infinity);
  while (state !== "ACTIVE") {
    if (state === "FAILED") {
      throw new Error(
        `Gemini File API processing failed for ${displayName}${fileErrorMsg ? `: ${fileErrorMsg}` : ""}`,
      );
    }
    const remaining = pollDeadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Gemini File API processing timed out for ${displayName}`);
    }
    await Bun.sleep(Math.min(opts.pollIntervalMs, remaining));
    const statusRes = await safeFetch(
      opts.fetchFn,
      `${GEMINI_API_BASE}/v1beta/${fileName}`,
      {
        method: "GET",
        headers: { "x-goog-api-key": opts.apiKey },
        signal: requestSignal(30_000, pollDeadline),
      },
      "file_poll",
    );
    if (!statusRes.ok) {
      throw await readHttpError(statusRes, "Gemini File API status poll failed", "file_poll");
    }
    const statusJson = JSON.parse(await readResponseBody(statusRes, "file_poll")) as {
      uri?: string;
      state?: string;
      error?: { message?: string };
      file?: { uri?: string; state?: string; error?: { message?: string } };
    };
    state = statusJson.state ?? statusJson.file?.state ?? "PROCESSING";
    fileUri = statusJson.uri ?? statusJson.file?.uri ?? fileUri;
    fileErrorMsg = statusJson.error?.message ?? statusJson.file?.error?.message ?? "";
  }
  if (!fileUri) {
    throw new Error("Gemini File API upload returned no file URI");
  }
  return { fileName, fileUri };
}

export async function runGeminiApiVideo(req: GeminiApiVideoRequest): Promise<GeminiApiVideoResult> {
  const thinkingLevel = toGeminiThinkingLevel(req.thinking);
  const mediaLevel = toGeminiMediaResolution(req.media);
  const modelId = req.model.trim().replace(/^models\//, "");
  if (!modelId) {
    throw new Error("runGeminiApiVideo requires a non-empty model id");
  }
  const fetchFn: FetchLike = req.fetchImpl ?? ((url, init) => fetch(url, init));
  const useStream = req.stream ?? req.fetchImpl === undefined;
  const timeoutMs = req.timeoutMs ?? 900_000;
  const pollIntervalMs = req.pollIntervalMs ?? 2_000;
  const retryBaseMs = req.retryBaseMs ?? 3_000;
  const mediaProcessing = req.mediaProcessing ?? "STATIC";
  const videoPaths =
    req.videoPaths && req.videoPaths.length > 0
      ? req.videoPaths
      : req.videoPath
        ? [req.videoPath]
        : [];
  if (videoPaths.length === 0 || videoPaths.length > 2) {
    throw new Error("runGeminiApiVideo requires 1 or 2 video paths");
  }
  if (
    req.startOffsetSec !== undefined &&
    req.endOffsetSec !== undefined &&
    req.endOffsetSec <= req.startOffsetSec
  ) {
    throw new Error("endOffsetSec must exceed startOffsetSec");
  }

  const imagePart: Record<string, unknown> | null = req.imagePath
    ? {
        inlineData: {
          mimeType: inferImageMimeType(req.imagePath),
          data: Buffer.from(await Bun.file(req.imagePath).arrayBuffer()).toString("base64"),
        },
      }
    : null;
  const videoMetadata: Record<string, unknown> = { fps: req.fps };
  if (req.startOffsetSec !== undefined && req.startOffsetSec > 0) {
    videoMetadata.startOffset = `${Number(req.startOffsetSec.toFixed(2))}s`;
  }
  if (req.endOffsetSec !== undefined && req.endOffsetSec > 0) {
    videoMetadata.endOffset = `${Number(req.endOffsetSec.toFixed(2))}s`;
  }
  const endpoint = useStream
    ? `${GEMINI_API_BASE}/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`
    : `${GEMINI_API_BASE}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;

  const executeWithKey = async (attemptOpts: {
    apiKey: string;
    keyLabel: string | null;
    retryTransientSameKey: boolean;
    stopAt?: number;
  }): Promise<GeminiApiVideoResult> => {
    const uploadedNames: string[] = [];
    try {
      const parts: Array<Record<string, unknown>> = [];
      if (imagePart) parts.push(imagePart);
      for (const vPath of videoPaths) {
        const { fileUri } = await uploadAndAwaitFile({
          filePath: vPath,
          apiKey: attemptOpts.apiKey,
          fetchFn,
          pollIntervalMs,
          uploadedNames,
          stopAt: attemptOpts.stopAt,
        });
        const part: Record<string, unknown> = {
          fileData: { mimeType: "video/mp4", fileUri },
          mediaProcessing,
          mediaResolution: { level: mediaLevel },
        };
        if (mediaProcessing === "STATIC") {
          part.videoMetadata = videoMetadata;
        }
        parts.push(part);
      }
      parts.push({ text: req.userPrompt });

      const requestBody: Record<string, unknown> = {
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 65_536,
          thinkingConfig: { thinkingLevel },
        },
      };
      if (req.systemPrompt.trim()) {
        requestBody.systemInstruction = { parts: [{ text: req.systemPrompt }] };
      }

      const maxSameKeyAttempts = attemptOpts.retryTransientSameKey ? 3 : 1;
      let genRes: Response | null = null;
      for (let attempt = 1; attempt <= maxSameKeyAttempts; attempt++) {
        genRes = await safeFetch(
          fetchFn,
          endpoint,
          {
            method: "POST",
            headers: {
              "x-goog-api-key": attemptOpts.apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: requestSignal(timeoutMs, attemptOpts.stopAt),
          },
          "generate",
        );
        if (
          genRes.ok ||
          ![500, 502, 503, 504].includes(genRes.status) ||
          attempt === maxSameKeyAttempts
        ) {
          break;
        }
        await genRes.body?.cancel().catch(() => {});
        await Bun.sleep(retryBaseMs * attempt);
      }
      if (!genRes) {
        throw new GeminiApiHttpError({
          message: "Gemini API generateContent failed: no response",
          status: 0,
          kind: "capacity",
          summary: "net no response",
          phase: "generate",
        });
      }
      if (!genRes.ok) {
        throw await readHttpError(genRes, "Gemini API generateContent failed", "generate");
      }

      let markdown = "";
      let finishReason: string | null = null;
      let blockReason: string | null = null;
      let usageMetadata: RawGeminiChunk["usageMetadata"];
      const responseBody = await readResponseBody(genRes, useStream ? "stream" : "generate");
      if (useStream) {
        const parsed = parseGeminiSseStream(responseBody);
        markdown = parsed.markdown;
        finishReason = parsed.finishReason;
        blockReason = parsed.blockReason;
        usageMetadata = parsed.usageMetadata;
      } else {
        const genJson = JSON.parse(responseBody) as RawGeminiChunk;
        blockReason = genJson.promptFeedback?.blockReason ?? null;
        const candidate = genJson.candidates?.[0];
        finishReason = candidate?.finishReason ?? null;
        const respParts = candidate?.content?.parts ?? [];
        markdown = respParts
          .filter((p) => !p.thought && typeof p.text === "string")
          .map((p) => p.text)
          .join("")
          .trim();
        usageMetadata = genJson.usageMetadata;
      }

      if (blockReason) {
        throw new Error(`Gemini API blocked request: ${blockReason}`);
      }
      if (finishReason === "MAX_TOKENS") {
        throw new Error("Gemini API response truncated (finishReason=MAX_TOKENS)");
      }
      if (
        finishReason &&
        ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(finishReason)
      ) {
        throw new Error(`Gemini API blocked response (finishReason=${finishReason})`);
      }
      if (finishReason !== "STOP") {
        throw new Error(
          `Gemini API incomplete or abnormal termination (finishReason=${finishReason ?? "missing_stream_terminator"})`,
        );
      }
      if (!markdown) {
        throw new Error(
          `Gemini API returned empty answer (finishReason=${finishReason ?? "unknown"})`,
        );
      }

      const promptTokens =
        typeof usageMetadata?.promptTokenCount === "number" ? usageMetadata.promptTokenCount : null;
      const outputTokens =
        typeof usageMetadata?.candidatesTokenCount === "number"
          ? usageMetadata.candidatesTokenCount
          : null;
      const details = usageMetadata?.promptTokensDetails ?? [];
      const videoEntries = details.filter(
        (d) => d.modality === "VIDEO" && typeof d.tokenCount === "number",
      );
      const audioEntries = details.filter(
        (d) => d.modality === "AUDIO" && typeof d.tokenCount === "number",
      );
      const videoTokens =
        videoEntries.length > 0
          ? videoEntries.reduce((sum, d) => sum + (d.tokenCount ?? 0), 0)
          : null;
      const audioTokens =
        audioEntries.length > 0
          ? audioEntries.reduce((sum, d) => sum + (d.tokenCount ?? 0), 0)
          : null;

      if (mediaProcessing === "STATIC") {
        const slicedDur =
          req.endOffsetSec !== undefined || req.startOffsetSec !== undefined
            ? videoPaths.reduce((sum, _, idx) => {
                const start = req.startOffsetSec ?? 0;
                const perVideoDur =
                  req.videoDurationsSec?.[idx] !== undefined && req.videoDurationsSec[idx]! > 0
                    ? req.videoDurationsSec[idx]!
                    : req.durationSec / videoPaths.length;
                const hasDuration =
                  (req.videoDurationsSec?.[idx] ?? 0) > 0 || (videoPaths.length === 1 && perVideoDur > 0);
                const duration =
                  !hasDuration && req.endOffsetSec !== undefined
                    ? req.endOffsetSec - start
                    : pictureDurationInRange(
                        { startSec: req.videoStartsSec?.[idx], durationSec: perVideoDur },
                        start,
                        req.endOffsetSec,
                      );
                return sum + Math.max(0.5, duration);
              }, 0)
            : req.durationSec;
        const downgradeErr = verifyGeminiApiVideoTokens({
          durationSec: slicedDur,
          sourceFps: req.sourceFps,
          fps: req.fps,
          media: req.media,
          expectAudio: req.expectAudio,
          hasModalityDetails: details.length > 0,
          promptTokens,
          videoTokens,
          audioTokens,
        });
        if (downgradeErr) {
          throw new Error(downgradeErr);
        }
      }

      if (attemptOpts.stopAt !== undefined && Date.now() >= attemptOpts.stopAt) {
        throw new Error(`Gemini API unavailable: request deadline reached for ${modelId}`);
      }
      return {
        markdown,
        finishReason,
        promptTokens,
        videoTokens,
        audioTokens,
        outputTokens,
        keyLabel: attemptOpts.keyLabel,
      };
    } finally {
      for (const fileName of uploadedNames) {
        try {
          await fetchFn(`${GEMINI_API_BASE}/v1beta/${fileName}`, {
            method: "DELETE",
            headers: { "x-goog-api-key": attemptOpts.apiKey },
            signal: AbortSignal.timeout(15_000),
          });
        } catch {}
      }
    }
  };

  if (req.apiKey?.trim()) {
    return executeWithKey({
      apiKey: req.apiKey.trim(),
      keyLabel: null,
      retryTransientSameKey: true,
    });
  }

  const pool = loadGmnKeyPool(req.keyPoolDir);
  if (pool.keys.length === 0) {
    const fallbackKey = resolveGeminiApiKey(undefined, { keyPoolDir: req.keyPoolDir });
    return executeWithKey({
      apiKey: fallbackKey,
      keyLabel: null,
      retryTransientSameKey: true,
    });
  }

  const rounds = Math.max(1, req.rounds ?? 2);
  const roundDelays = req.roundDelaysMs ?? [2_000, 5_000, 9_000, 15_000];
  const switchDelayMs = req.switchDelayMs ?? 150;
  const deadlineMs = req.deadlineMs ?? Math.max(timeoutMs * 2, 1_800_000);
  const stopAt = Date.now() + deadlineMs;
  const pause = async (ms: number) => {
    const remaining = Math.min(ms, stopAt - Date.now());
    if (remaining > 0) await Bun.sleep(remaining);
  };
  const inFlight = getInFlightLabels(pool.statePath);
  const failures: Array<{
    label: string;
    kind: Exclude<GeminiErrorKind, "other">;
    summary: string;
  }> = [];
  let outOfTime = false;
  const maxOverloadResponses = 5;
  let overloadResponses = 0;

  for (let round = 0; round < rounds; round++) {
    if (round > 0) {
      const wait = roundDelays[Math.min(round - 1, roundDelays.length - 1)] ?? 2_000;
      await pause(wait);
    }
    let attempted = 0;
    let sawOtherThan404 = false;
    const triedThisRound = new Set<string>();

    while (true) {
      const state = loadGmnState(pool.statePath);
      const now = Date.now();
      const nextKey = rotationOrder(pool.keys, state.cursor, inFlight).find(
        (k) =>
          !triedThisRound.has(k.label) &&
          !state.dead[k.label] &&
          (state.until[k.label] ?? 0) <= now,
      );
      if (!nextKey) break;
      if (Date.now() >= stopAt) {
        outOfTime = true;
        break;
      }
      triedThisRound.add(nextKey.label);
      attempted++;
      inFlight.add(nextKey.label);
      try {
        const result = await executeWithKey({
          apiKey: nextKey.value,
          keyLabel: nextKey.label,
          retryTransientSameKey: false,
          stopAt,
        });
        recordKeySuccess(pool.statePath, pool.keys, nextKey.label);
        return result;
      } catch (err) {
        if (Date.now() >= stopAt) {
          outOfTime = true;
          break;
        }
        if (!(err instanceof GeminiApiHttpError) || err.kind === "other") {
          throw err;
        }
        recordKeyFailure(pool.statePath, nextKey.label, err.kind, err.summary, err.retryAfterMs);
        failures.push({ label: nextKey.label, kind: err.kind, summary: err.summary });
        if (err.kind === "dead") {
          console.error(`[gemini-api] key "${nextKey.label}" disabled permanently: ${err.summary}`);
        } else if (err.kind === "rate") {
          console.error(
            `[gemini-api] key "${nextKey.label}" rate limited; cooling down ${Math.round(err.retryAfterMs / 1000)}s, switching key`,
          );
        } else if (err.kind === "capacity") {
          if (err.status === 503 && (err.phase === "generate" || err.phase === "stream")) {
            overloadResponses++;
            if (overloadResponses >= maxOverloadResponses) {
              throw new Error(
                `Gemini API unavailable: ${req.model} returned ${overloadResponses} generation HTTP 503 responses. Retry later with the same media and model.`,
                { cause: err },
              );
            }
            console.error(
              `[gemini-api] ${req.model} overload ${overloadResponses}/${maxOverloadResponses}; retrying after backoff`,
            );
            await pause(retryBaseMs * overloadResponses);
          } else {
            console.error(`[gemini-api] key "${nextKey.label}" -> ${err.summary}; switching key`);
          }
        } else {
          console.error(`[gemini-api] key "${nextKey.label}" -> ${err.summary}; trying next key`);
        }
        if (err.kind !== "model") sawOtherThan404 = true;
        if ((err.kind === "rate" || err.kind === "capacity") && switchDelayMs > 0) {
          await pause(switchDelayMs);
        }
      } finally {
        inFlight.delete(nextKey.label);
      }
    }

    if (outOfTime) break;
    if (attempted === 0) {
      const state = loadGmnState(pool.statePath);
      const alive = pool.keys.filter((k) => !state.dead[k.label]);
      if (alive.length === 0) {
        const labels = pool.keys.map((k) => k.label).join(", ");
        throw new Error(`Gemini API auth failed: all keys in pool are disabled (${labels})`);
      }
      const now = Date.now();
      const soonest = Math.min(
        ...alive.map((k) => state.until[k.label] ?? 0).filter((t) => t > now),
      );
      const waitSec = Number.isFinite(soonest)
        ? Math.max(1, Math.ceil((soonest - now) / 1000))
        : 60;
      throw new Error(
        `Gemini API rate limit: all keys are cooling down or disabled; next key frees in ~${waitSec}s`,
      );
    }

    if (!sawOtherThan404 || outOfTime) break;
  }

  if (outOfTime) throw new Error(`Gemini API unavailable: request deadline reached for ${modelId}`);
  const finalState = loadGmnState(pool.statePath);
  const aliveRemaining = pool.keys.filter((k) => !finalState.dead[k.label]);
  const activeFailures = failures.filter((f) => f.kind !== "dead");
  const tail = (rows: typeof failures) =>
    rows
      .slice(-6)
      .map((f) => `${f.label}: ${f.summary}`)
      .join("; ");

  if (aliveRemaining.length === 0) {
    throw new Error(`Gemini API auth failed: all keys in pool are disabled (${tail(failures)})`);
  }
  const allAliveCooling = aliveRemaining.every(
    (k) => (finalState.until[k.label] ?? 0) > Date.now(),
  );
  if (
    allAliveCooling ||
    (activeFailures.length > 0 && activeFailures.every((f) => f.kind === "rate"))
  ) {
    throw new Error(`Gemini API rate limit: every alive key failed (${tail(activeFailures)})`);
  }
  const disabledCount = pool.keys.length - aliveRemaining.length;
  const disabledNote = disabledCount > 0 ? ` (${disabledCount} key(s) disabled)` : "";
  throw new Error(
    `Gemini API unavailable: every alive key failed${disabledNote}: ${tail(activeFailures)}`,
  );
}

const CLI_HELP = `Gemini API Multimodal Video CLI (fail-closed 24 FPS + streaming SSE + File API cleanup)
  bun .claude/skills/channel-dna/scripts/gemini-api.ts --video <mp4> [--video <mp4>] [--image <jpg|png|webp>] [--start <sec>] [--end <sec>] [--fps 24] [--media High] [--thinking "Extra High"] [--model gemini-4-hydrogen] [--processing STATIC|AGENTIC] [--timeout <min>] [--system-file <path>] (--prompt <text> | --prompt-file <path>) [--out <md>]
Notes: Validates 45% billed video-token floor, audio tokens, and MAX_TOKENS truncation.
--timeout caps each request, the whole SSE stream included (default 15 min); Extra High thinking on ~110 s at 24 FPS can need 30-45.
Stops a key-pool run after five generation HTTP 503s. Retry later with the same input and model.
Exit 2 on usage error.`;

if (import.meta.main) {
  const cliUsage: (msg: string) => never = (msg) => {
    console.error(`${msg}\n${CLI_HELP}`);
    process.exit(2);
  };
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    console.log(CLI_HELP);
    process.exit(0);
  }
  let parsedArgs: ReturnType<typeof parseArgs>;
  try {
    parsedArgs = parseArgs({
      args: rawArgs,
      allowPositionals: false,
      strict: true,
      options: {
        video: { type: "string", multiple: true },
        image: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        fps: { type: "string" },
        media: { type: "string" },
        thinking: { type: "string" },
        model: { type: "string" },
        processing: { type: "string" },
        timeout: { type: "string" },
        "system-file": { type: "string" },
        prompt: { type: "string" },
        "prompt-file": { type: "string" },
        out: { type: "string" },
      },
    });
  } catch (err) {
    cliUsage((err as Error).message);
  }
  const values = parsedArgs!.values;
  const rawVideos = (values.video as string[] | undefined) ?? [];
  if (rawVideos.length < 1 || rawVideos.length > 2) {
    cliUsage("--video requires 1 or 2 MP4 file paths");
  }
  const videoPaths = rawVideos.map((p) => {
    const abs = resolve(p);
    if (!existsSync(abs) || !statSync(abs).isFile()) cliUsage(`video file not found: ${abs}`);
    return abs;
  });
  let imagePath: string | undefined;
  if (typeof values.image === "string") {
    imagePath = resolve(values.image);
    if (!existsSync(imagePath) || !statSync(imagePath).isFile()) {
      cliUsage(`image file not found: ${imagePath}`);
    }
  }
  const parsePosFloat = (flag: string, raw: unknown, def?: number, min = 0, max = 86_400) => {
    if (raw === undefined) return def;
    if (typeof raw !== "string") cliUsage(`${flag} must be a finite number`);
    const s = raw.trim();
    if (!/^\d+(?:\.\d+)?$/.test(s)) cliUsage(`${flag} must be a finite number`);
    const n = Number(s);
    if (!Number.isFinite(n) || n < min || n > max) {
      cliUsage(`${flag} must be between ${min} and ${max}`);
    }
    return n;
  };
  const fps = parsePosFloat("--fps", values.fps, 24, 0.2, 24)!;
  const timeoutMin = parsePosFloat("--timeout", values.timeout, 15, 1, 120)!;
  const startOffsetSec = parsePosFloat("--start", values.start, undefined, 0, 86_400);
  const endOffsetSec = parsePosFloat("--end", values.end, undefined, 0.1, 86_400);
  if (
    startOffsetSec !== undefined &&
    endOffsetSec !== undefined &&
    endOffsetSec <= startOffsetSec
  ) {
    cliUsage("--end must exceed --start");
  }
  let media: string;
  try {
    media = normalizeMediaLabel(typeof values.media === "string" ? values.media : "High");
  } catch (err) {
    cliUsage((err as Error).message);
  }
  const model = typeof values.model === "string" ? values.model.trim() : "gemini-4-hydrogen";
  if (!model.replace(/^models\//, "")) cliUsage("--model cannot be empty");
  const defaultThinking = /^(?:models\/)?gemini-4-(?:hydrogen|neon)$/i.test(model)
    ? "Extra High"
    : "High";
  const thinking = typeof values.thinking === "string" ? values.thinking.trim() : defaultThinking;
  try {
    toGeminiThinkingLevel(thinking);
  } catch (err) {
    cliUsage((err as Error).message);
  }
  const procRaw = (typeof values.processing === "string" ? values.processing : "STATIC")
    .trim()
    .toUpperCase();
  const mediaProcessing: "STATIC" | "AGENTIC" =
    procRaw === "AGENTIC"
      ? "AGENTIC"
      : procRaw === "STATIC"
        ? "STATIC"
        : (cliUsage("--processing must be STATIC or AGENTIC"), "STATIC");
  if (
    mediaProcessing === "AGENTIC" &&
    (values.fps !== undefined || values.start !== undefined || values.end !== undefined)
  ) {
    cliUsage("--processing AGENTIC cannot be combined with explicit --fps, --start, or --end");
  }
  let systemPrompt = "";
  if (typeof values["system-file"] === "string") {
    const abs = resolve(values["system-file"]);
    if (!existsSync(abs) || !statSync(abs).isFile()) cliUsage(`system file not found: ${abs}`);
    systemPrompt = readFileSync(abs, "utf8");
  }
  let userPrompt = "";
  if (typeof values["prompt-file"] === "string") {
    const abs = resolve(values["prompt-file"]);
    if (!existsSync(abs) || !statSync(abs).isFile()) cliUsage(`prompt file not found: ${abs}`);
    userPrompt = readFileSync(abs, "utf8").trim();
  } else if (typeof values.prompt === "string") {
    userPrompt = values.prompt.trim();
  }
  if (!userPrompt) cliUsage("provide --prompt <text> or --prompt-file <path>");

  const probes = videoPaths.map((p) => probeVideoMeta(p));
  const totalDurationSec = probes.reduce((s, p) => s + p.durationSec, 0);
  const videoDurationsSec = probes.map((p) => p.durationSec);
  const videoStartsSec = probes.map((p) => p.startSec);
  const minSourceFps = probes.reduce(
    (m, p) => (p.sourceFps > 0 ? Math.min(m, p.sourceFps) : m),
    Infinity,
  );
  if (mediaProcessing === "STATIC") {
    const missingDur = probes.some((p) => p.durationSec <= 0);
    if (missingDur && (startOffsetSec === undefined || endOffsetSec === undefined)) {
      console.error(
        "ffprobe failed to read video duration; cannot enforce STATIC 1M-token budget or 45% video-token floor without readable duration or explicit --start and --end.",
      );
      process.exit(1);
    }
    if (startOffsetSec !== undefined) {
      for (const p of probes) {
        if (p.durationSec > 0 && startOffsetSec >= p.startSec + p.durationSec) {
          cliUsage(
            `--start (${startOffsetSec}s) must be before the last video timestamp (${(p.startSec + p.durationSec).toFixed(2)}s)`,
          );
        }
      }
    }
    const slicedTotalDur =
      endOffsetSec !== undefined || startOffsetSec !== undefined
        ? probes.reduce((sum, p) => {
            const duration = p.durationSec > 0
              ? pictureDurationInRange(p, startOffsetSec, endOffsetSec)
              : (endOffsetSec ?? 0) - (startOffsetSec ?? 0);
            if (duration <= 0) cliUsage("The requested window contains no source video");
            return sum + Math.max(0.5, duration);
          }, 0)
        : totalDurationSec;
    const est = estimateUnifiedVideoTokens({
      durationSec: slicedTotalDur / videoPaths.length,
      fps,
      media,
      sourceFps: Number.isFinite(minSourceFps) ? minSourceFps : undefined,
      videoCount: videoPaths.length,
    });
    if (est.estimatedTokens > UNIFIED_TOKEN_SOFT_LIMIT) {
      const retryHint =
        est.suggestedFps !== null
          ? `retry with --fps ${est.suggestedFps} or --media Medium or --start/--end slice.`
          : "slice the video with --start/--end or lower --media Low.";
      console.error(
        `Estimated unified tokens (${est.estimatedTokens.toLocaleString("en-US")}) exceeds 1M limit; ${retryHint}`,
      );
      process.exit(1);
    }
  }
  runGeminiApiVideo({
    videoPaths,
    videoDurationsSec,
    videoStartsSec,
    imagePath,
    durationSec: totalDurationSec,
    sourceFps: Number.isFinite(minSourceFps) ? minSourceFps : undefined,
    expectAudio: probes.some((p) => p.hasAudioStream),
    startOffsetSec,
    endOffsetSec,
    mediaProcessing,
    stream: true,
    timeoutMs: timeoutMin * 60_000,
    systemPrompt,
    userPrompt,
    model,
    thinking,
    media,
    fps,
  })
    .then((res) => {
      if (typeof values.out === "string" && values.out.trim()) {
        const outPath = resolve(values.out);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, res.markdown, "utf8");
      } else {
        console.log(res.markdown);
      }
      console.error(
        `[gemini-api] ok finish=${res.finishReason ?? "unknown"} prompt=${res.promptTokens ?? "?"} video=${res.videoTokens ?? "?"} audio=${res.audioTokens ?? "?"} out=${res.outputTokens ?? "?"}`,
      );
    })
    .catch((err) => {
      console.error(`[gemini-api] error: ${(err as Error).message}`);
      process.exit(1);
    });
}
