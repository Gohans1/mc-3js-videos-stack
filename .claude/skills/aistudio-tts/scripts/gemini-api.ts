import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { StepError } from "../../aistudio/scripts/lib";
import {
  classifyGeminiError,
  extractGeminiErrorReason,
  GeminiApiHttpError,
  type GeminiApiPhase,
  type GeminiErrorKind,
  getInFlightLabels,
  loadGmnKeyPool,
  loadGmnState,
  type RawGeminiErrorJson,
  recordKeyFailure,
  recordKeySuccess,
  rotationOrder,
} from "../../channel-dna/scripts/key-pool";
import { inspectWav, requireWav, saveNewFile } from "./audio";
import {
  assertAllowedModel,
  type BatchManifest,
  DEFAULT_MODEL,
  InputError,
  type Scene,
} from "./input";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
const MAX_AUDIO_BASE64_CHARS = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 64;
const MAX_COOLDOWN_MS = 3_600_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_CAPACITY_RETRY_MS = 2_000;
const SECRET_KEY_RE = /\b(?:AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9._-]{20,})/g;

function redactSecrets(text: string): string {
  return text.replace(SECRET_KEY_RE, "[redacted-api-key]");
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface InteractionsPayload {
  model: string;
  store: false;
  input: Array<{
    type: "user_input";
    content: Array<{
      type: "text";
      text: string;
      annotations?: Array<{
        type: "speech_metadata";
        speaker?: string;
        style?: string;
      }>;
    }>;
  }>;
  response_format: { type: "audio" };
  generation_config: {
    temperature?: number;
    speech_config:
      Array<{ voice: string }> | { speakers: Array<{ speaker: string; voice: string }> };
  };
}

export interface GeminiApiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GeminiApiRequestOptions {
  model?: string;
  apiKey?: string;
  keyPoolDir?: string;
  rounds?: number;
  timeoutMs?: number;
  deadlineMs?: number;
  switchDelayMs?: number;
  roundWaitCapMs?: number;
  fetchImpl?: FetchLike;
}

export interface GeminiApiSpeakOptions extends GeminiApiRequestOptions {
  out: string;
  force?: boolean;
}

export interface GeminiApiTakeResult {
  path: string;
  bytes: number;
  duration: number;
  model: string;
  keyLabel: string | null;
  usage?: GeminiApiUsage;
}

export interface GeminiApiVoiceRecord {
  id: string;
  name: string;
  type: string;
  language?: string;
  region?: string;
  accent?: string;
  gender?: string;
  pitch?: string;
  persona?: string;
  context?: string;
  description?: string;
}

export interface GeminiApiVoiceListOptions extends GeminiApiRequestOptions {
  search?: string;
  language?: string;
  gender?: string;
  pitch?: string;
  accent?: string;
  useCase?: string;
  pageSize?: number;
  pageToken?: string;
}

interface RawInteractionsError {
  error?: {
    code?: number | string;
    status?: string;
    message?: string;
    details?: Array<{ reason?: string; retryDelay?: string }>;
  };
}

function toRawGeminiErrorJson(parsed: RawInteractionsError | null): RawGeminiErrorJson | null {
  if (!parsed?.error) return null;
  return {
    error: {
      ...(typeof parsed.error.code === "number" ? { code: parsed.error.code } : {}),
      ...(parsed.error.status !== undefined ? { status: parsed.error.status } : {}),
      ...(parsed.error.message !== undefined ? { message: parsed.error.message } : {}),
      ...(parsed.error.details !== undefined ? { details: parsed.error.details } : {}),
    },
  };
}

export function buildInteractionsPayload(scene: Scene, model = DEFAULT_MODEL): InteractionsPayload {
  const safeModel = assertAllowedModel(model);
  if (
    scene.temperature !== undefined &&
    (!Number.isFinite(scene.temperature) || scene.temperature < 0 || scene.temperature > 2)
  ) {
    throw new InputError(
      `scene.temperature must be between 0 and 2 for the Gemini API backend (got ${scene.temperature}).`,
    );
  }
  const voice1 = scene.voices?.[0]?.trim();
  const voice2 = scene.voices?.[1]?.trim();
  if (!voice1) {
    throw new InputError(
      "Gemini API backend requires at least one voice in scene.voices (or manifest.voices).",
    );
  }
  if (scene.blocks.length >= 2 && !voice2) {
    throw new InputError(
      'Gemini API backend requires voices[1] for multi-block scenes (repeat the same voice ["Voice", "Voice"] for single-narrator multi-block).',
    );
  }

  const isTwoSpeaker =
    scene.blocks.length >= 2 && Boolean(voice2) && voice1.toLowerCase() !== voice2!.toLowerCase();

  const content = scene.blocks.map((block, index) => {
    const trimmedStyle = block.style?.trim();
    if (isTwoSpeaker) {
      const speakerSlot = (block.speaker ?? (index % 2) + 1) as 1 | 2;
      return {
        type: "text" as const,
        text: block.text,
        annotations: [
          {
            type: "speech_metadata" as const,
            speaker: `Speaker ${speakerSlot}`,
            ...(trimmedStyle ? { style: trimmedStyle } : {}),
          },
        ],
      };
    }
    return {
      type: "text" as const,
      text: block.text,
      ...(trimmedStyle
        ? { annotations: [{ type: "speech_metadata" as const, style: trimmedStyle }] }
        : {}),
    };
  });

  return {
    model: safeModel,
    store: false,
    input: [{ type: "user_input", content }],
    response_format: { type: "audio" },
    generation_config: {
      ...(scene.temperature !== undefined ? { temperature: scene.temperature } : {}),
      speech_config: isTwoSpeaker
        ? {
            speakers: [
              { speaker: "Speaker 1", voice: voice1 },
              { speaker: "Speaker 2", voice: voice2! },
            ],
          }
        : [{ voice: voice1 }],
    },
  };
}

export function decodeInteractionsAudio(json: unknown): {
  bytes: Buffer;
  duration: number;
  usage?: GeminiApiUsage;
} {
  if (!json || typeof json !== "object") {
    throw new StepError("Gemini API returned an invalid JSON payload.");
  }
  const record = json as {
    status?: unknown;
    steps?: unknown;
    usage?: {
      total_input_tokens?: unknown;
      total_output_tokens?: unknown;
      total_tokens?: unknown;
    };
  };
  if (typeof record.status === "string" && record.status !== "completed") {
    throw new StepError(
      `Gemini API interaction ended with status "${record.status}" instead of "completed".`,
    );
  }
  if (record.steps !== undefined && !Array.isArray(record.steps)) {
    throw new StepError("Gemini API returned an invalid steps payload.");
  }
  let audioData: string | undefined;
  for (const step of (record.steps as Array<{ type?: unknown; content?: unknown }>) ?? []) {
    if (!step || typeof step !== "object" || step.type !== "model_output") continue;
    if (!Array.isArray(step.content)) continue;
    for (const part of step.content as Array<{ type?: unknown; data?: unknown }>) {
      if (part?.type === "audio" && typeof part.data === "string" && part.data.length > 0) {
        audioData = part.data;
      }
    }
  }
  if (!audioData) {
    throw new StepError("Gemini API response contained no audio output.");
  }
  if (audioData.length > MAX_AUDIO_BASE64_CHARS) {
    throw new StepError("Gemini API returned oversized audio output.");
  }
  const raw = Buffer.from(audioData, "base64");
  const bytes = requireWav(raw);
  const { duration } = inspectWav(bytes);

  const inputTokens = record.usage?.total_input_tokens;
  const outputTokens = record.usage?.total_output_tokens;
  const totalTokens = record.usage?.total_tokens;
  const usage =
    typeof inputTokens === "number" &&
    Number.isSafeInteger(inputTokens) &&
    inputTokens >= 0 &&
    typeof outputTokens === "number" &&
    Number.isSafeInteger(outputTokens) &&
    outputTokens >= 0
      ? {
          inputTokens,
          outputTokens,
          totalTokens:
            typeof totalTokens === "number" && Number.isSafeInteger(totalTokens) && totalTokens >= 0
              ? totalTokens
              : inputTokens + outputTokens,
        }
      : undefined;

  return { bytes, duration, ...(usage ? { usage } : {}) };
}

export function parseInteractionsRetryAfterMs(
  headers: Headers | null,
  parsed: RawInteractionsError | null,
  fallbackText: string,
  defaultMs = DEFAULT_COOLDOWN_MS,
): number {
  const rawHeader = headers?.get("retry-after")?.trim();
  if (rawHeader) {
    if (/^\d+(?:\.\d+)?$/.test(rawHeader)) {
      const sec = Number(rawHeader);
      if (Number.isFinite(sec) && sec > 0) {
        return Math.min(Math.max(1_000, Math.round(sec * 1_000)), MAX_COOLDOWN_MS);
      }
    } else {
      const ts = Date.parse(rawHeader);
      if (Number.isFinite(ts) && ts > Date.now()) {
        return Math.min(Math.max(1_000, ts - Date.now()), MAX_COOLDOWN_MS);
      }
    }
  }
  const retryDetail = parsed?.error?.details?.find(
    (d) => typeof d.retryDelay === "string" && d.retryDelay.trim(),
  );
  if (retryDetail?.retryDelay) {
    const detailMatch = /^(\d+(?:\.\d+)?)s$/i.exec(retryDetail.retryDelay.trim());
    if (detailMatch) {
      const ms = Math.round(Number(detailMatch[1]) * 1_000);
      if (Number.isFinite(ms) && ms > 0) {
        return Math.min(Math.max(1_000, ms), MAX_COOLDOWN_MS);
      }
    }
  }
  const msg = parsed?.error?.message ?? fallbackText;
  const match = /(?:retry|try again)\s+in\s+(\d+(?:\.\d+)?)\s*(?:s|sec(?:ond)?s?)\b/i.exec(msg);
  if (match) {
    const ms = Math.round(Number(match[1]) * 1_000);
    if (Number.isFinite(ms) && ms > 0) {
      return Math.min(Math.max(1_000, ms), MAX_COOLDOWN_MS);
    }
  }
  return defaultMs;
}

function classifyInteractionsError(
  status: number,
  parsed: RawInteractionsError | null,
  reason: string,
  phase: GeminiApiPhase,
): GeminiErrorKind {
  const code = typeof parsed?.error?.code === "string" ? parsed.error.code.toLowerCase() : "";
  if (code === "too_many_requests") return "rate";
  if (code === "permission_denied" || code === "unauthenticated") return "dead";
  if (code === "not_found" && phase === "generate") return "model";
  return classifyGeminiError(status, reason, phase);
}

async function readApiHttpError(
  res: Response,
  prefix: string,
  phase: GeminiApiPhase,
): Promise<GeminiApiHttpError> {
  let summary = `HTTP ${res.status} ${res.statusText}`.trim();
  let parsed: RawInteractionsError | null = null;
  let reason = "";
  let rawText = "";
  try {
    rawText = await res.text();
    try {
      parsed = JSON.parse(rawText) as RawInteractionsError;
      const err = parsed.error;
      if (err?.message) {
        const tag =
          typeof err.status === "string" && err.status
            ? ` ${err.status}`
            : typeof err.code === "string" && err.code
              ? ` ${err.code}`
              : "";
        summary = `HTTP ${res.status}${tag}: ${err.message}`;
      } else {
        summary = `HTTP ${res.status}: ${rawText.slice(0, 300).trim() || res.statusText}`;
      }
      reason = extractGeminiErrorReason(toRawGeminiErrorJson(parsed));
    } catch {
      summary = `HTTP ${res.status}: ${rawText.slice(0, 300).trim() || res.statusText}`;
      reason = rawText.slice(0, 300).trim();
    }
  } catch {}
  const safeSummary = redactSecrets(summary);
  const kind = classifyInteractionsError(res.status, parsed, reason || summary, phase);
  const defaultRetryMs = kind === "capacity" ? DEFAULT_CAPACITY_RETRY_MS : DEFAULT_COOLDOWN_MS;
  return new GeminiApiHttpError({
    message: `${prefix}: ${safeSummary}`,
    status: res.status,
    kind,
    summary: safeSummary,
    retryAfterMs: parseInteractionsRetryAfterMs(res.headers, parsed, rawText, defaultRetryMs),
    phase,
  });
}

function networkError(err: unknown, phase: GeminiApiPhase): GeminiApiHttpError {
  const message = redactSecrets(err instanceof Error ? err.message : String(err));
  return new GeminiApiHttpError({
    message: `Gemini API network error: ${message}`,
    status: 0,
    kind: "capacity",
    summary: `net ${message.replace(/\s+/g, " ").slice(0, 160)}`,
    retryAfterMs: 5_000,
    phase,
  });
}

async function executeWithKeyPool<T>(
  opts: GeminiApiRequestOptions,
  phase: GeminiApiPhase,
  runWithKey: (ctx: { apiKey: string; keyLabel: string | null; signal: AbortSignal }) => Promise<T>,
): Promise<{ data: T; keyLabel: string | null }> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const rounds =
    typeof opts.rounds === "number" && Number.isFinite(opts.rounds)
      ? Math.max(1, Math.trunc(opts.rounds))
      : 2;
  const switchDelayMs = opts.switchDelayMs ?? 150;
  const roundWaitCapMs = opts.roundWaitCapMs ?? 65_000;
  const deadlineMs = opts.deadlineMs ?? Math.max(timeoutMs * 2, 600_000);
  const stopAt = Date.now() + deadlineMs;
  const makeSignal = () =>
    AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, Math.max(1, stopAt - Date.now()))));
  const pause = async (ms: number) => {
    const remaining = Math.min(ms, stopAt - Date.now());
    if (remaining > 0) await Bun.sleep(remaining);
  };

  const explicit = opts.apiKey?.trim();
  const hasExplicitPoolDir = opts.keyPoolDir !== undefined;
  const explicitPoolDir = opts.keyPoolDir?.trim();
  if (!explicit && hasExplicitPoolDir && !explicitPoolDir) {
    throw new StepError(
      "Gemini API auth failed: --key-pool-dir must be a nonempty directory path.",
    );
  }
  const pool = explicit ? null : loadGmnKeyPool(explicitPoolDir);
  if (!explicit && hasExplicitPoolDir && (!pool || pool.keys.length === 0)) {
    throw new StepError(
      `Gemini API auth failed: no usable keys found in --key-pool-dir (${pool?.configPath ?? explicitPoolDir}).`,
    );
  }
  if (explicit || !pool || pool.keys.length === 0) {
    const singleKey =
      explicit ||
      [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY]
        .map((v) => v?.trim() ?? "")
        .find(Boolean);
    if (!singleKey) {
      throw new StepError(
        "Gemini API auth failed: no usable API key configured (add keys to ~/.config/gmn/config.json or set GEMINI_API_KEY).",
      );
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < rounds; attempt++) {
      try {
        const data = await runWithKey({ apiKey: singleKey, keyLabel: null, signal: makeSignal() });
        return { data, keyLabel: null };
      } catch (err) {
        lastError = err;
        if (
          !(err instanceof GeminiApiHttpError) ||
          (err.kind !== "rate" && err.kind !== "capacity") ||
          attempt + 1 >= rounds
        ) {
          throw err instanceof GeminiApiHttpError ? new StepError(err.message) : err;
        }
        if (err.kind === "rate" && err.retryAfterMs > roundWaitCapMs) {
          throw new StepError(err.message);
        }
        const waitMs = Math.min(err.retryAfterMs, roundWaitCapMs);
        if (Date.now() + waitMs >= stopAt) throw new StepError(err.message);
        console.error(`[gemini-api-tts] ${err.summary}; retrying in ${Math.ceil(waitMs / 1000)}s`);
        await pause(waitMs);
      }
    }
    throw lastError instanceof Error ? new StepError(lastError.message) : lastError;
  }

  const inFlight = getInFlightLabels(pool.statePath);
  const failures: Array<{
    label: string;
    kind: Exclude<GeminiErrorKind, "other">;
    summary: string;
  }> = [];
  let outOfTime = false;

  for (let round = 0; round < rounds; round++) {
    let attempted = 0;
    let sawOtherThanModel = false;
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
        const data = await runWithKey({
          apiKey: nextKey.value,
          keyLabel: nextKey.label,
          signal: makeSignal(),
        });
        recordKeySuccess(pool.statePath, pool.keys, nextKey.label);
        return { data, keyLabel: nextKey.label };
      } catch (err) {
        if (Date.now() >= stopAt) {
          outOfTime = true;
          break;
        }
        if (!(err instanceof GeminiApiHttpError)) {
          throw err;
        }
        if (err.kind === "other") {
          throw new StepError(err.message);
        }
        recordKeyFailure(pool.statePath, nextKey.label, err.kind, err.summary, err.retryAfterMs);
        failures.push({ label: nextKey.label, kind: err.kind, summary: err.summary });
        if (err.kind === "dead") {
          console.error(
            `[gemini-api-tts] key "${nextKey.label}" disabled permanently: ${err.summary}`,
          );
        } else if (err.kind === "rate") {
          console.error(
            `[gemini-api-tts] key "${nextKey.label}" rate limited; cooling down ${Math.round(err.retryAfterMs / 1000)}s, switching key`,
          );
        } else {
          console.error(`[gemini-api-tts] key "${nextKey.label}" -> ${err.summary}; switching key`);
        }
        if (err.kind !== "model") sawOtherThanModel = true;
        if ((err.kind === "rate" || err.kind === "capacity") && switchDelayMs > 0) {
          await pause(switchDelayMs);
        }
      } finally {
        inFlight.delete(nextKey.label);
      }
    }

    if (outOfTime) break;
    const state = loadGmnState(pool.statePath);
    const alive = pool.keys.filter((k) => !state.dead[k.label]);
    if (alive.length === 0) {
      const labels = pool.keys.map((k) => k.label).join(", ");
      throw new StepError(`Gemini API auth failed: all keys in pool are disabled (${labels})`);
    }
    if (attempted > 0 && !sawOtherThanModel) break;
    if (round + 1 < rounds) {
      const now = Date.now();
      const soonest = Math.min(...alive.map((k) => state.until[k.label] ?? 0));
      const neededMs = soonest > now ? soonest - now + 200 : 2_000;
      if (soonest > now && neededMs > roundWaitCapMs) break;
      if (Date.now() + neededMs >= stopAt) {
        if (soonest <= now) outOfTime = true;
        break;
      }
      console.error(
        `[gemini-api-tts] all alive keys busy; waiting ${Math.ceil(neededMs / 1000)}s for next round (${round + 2}/${rounds})`,
      );
      await pause(neededMs);
    }
  }

  if (outOfTime) {
    throw new StepError(`Gemini API unavailable: request deadline reached during ${phase}.`);
  }
  const finalState = loadGmnState(pool.statePath);
  const aliveRemaining = pool.keys.filter((k) => !finalState.dead[k.label]);
  const activeFailures = failures.filter((f) => f.kind !== "dead");
  const tail = (rows: typeof failures) =>
    rows
      .slice(-6)
      .map((f) => `${f.label}: ${f.summary}`)
      .join("; ");

  if (aliveRemaining.length === 0) {
    throw new StepError(
      `Gemini API auth failed: all keys in pool are disabled (${tail(failures)})`,
    );
  }
  const now = Date.now();
  const allAliveCooling = aliveRemaining.every((k) => (finalState.until[k.label] ?? 0) > now);
  if (
    allAliveCooling ||
    (activeFailures.length > 0 && activeFailures.every((f) => f.kind === "rate"))
  ) {
    const soonest = Math.min(...aliveRemaining.map((k) => finalState.until[k.label] ?? 0));
    const waitSec = soonest > now ? Math.max(1, Math.ceil((soonest - now) / 1000)) : 0;
    const waitNote = waitSec > 0 ? ` (next key frees in ~${waitSec}s)` : "";
    const detail = activeFailures.length ? `: ${tail(activeFailures)}` : "";
    throw new StepError(
      `Gemini API rate limit: every alive key is cooling down or throttled${waitNote}${detail}`,
    );
  }
  throw new StepError(`Gemini API unavailable: every alive key failed: ${tail(activeFailures)}`);
}

export async function renderGeminiApiSpeech(
  scene: Scene,
  opts: GeminiApiRequestOptions = {},
): Promise<{
  bytes: Buffer;
  duration: number;
  model: string;
  keyLabel: string | null;
  usage?: GeminiApiUsage;
}> {
  const model = assertAllowedModel(opts.model ?? DEFAULT_MODEL);
  const payload = buildInteractionsPayload(scene, model);
  const fetchFn = opts.fetchImpl ?? fetch;
  const { data, keyLabel } = await executeWithKeyPool(
    opts,
    "generate",
    async ({ apiKey, signal }) => {
      let res: Response;
      try {
        res = await fetchFn(`${GEMINI_API_BASE}/interactions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(payload),
          redirect: "error",
          signal,
        });
      } catch (err) {
        throw networkError(err, "generate");
      }
      if (!res.ok) {
        throw await readApiHttpError(res, "Gemini TTS API failed", "generate");
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch (err) {
        throw networkError(err, "generate");
      }
      return decodeInteractionsAudio(json);
    },
  );
  return { ...data, model, keyLabel };
}

export async function speakGeminiApi(
  scene: Scene,
  opts: GeminiApiSpeakOptions,
): Promise<GeminiApiTakeResult> {
  const force = Boolean(opts.force);
  const destination = resolve(opts.out);
  if (!force && existsSync(destination)) {
    throw new InputError(
      `Output already exists: ${opts.out}. Use a new take path or pass --force.`,
    );
  }
  const rendered = await renderGeminiApiSpeech(scene, opts);
  const path = await saveNewFile(destination, rendered.bytes, force);
  return {
    path,
    bytes: rendered.bytes.length,
    duration: rendered.duration,
    model: rendered.model,
    keyLabel: rendered.keyLabel,
    ...(rendered.usage ? { usage: rendered.usage } : {}),
  };
}

export async function batchGeminiApi(
  manifest: BatchManifest,
  opts: GeminiApiRequestOptions & { force?: boolean } = {},
): Promise<{ model: string; takes: Array<{ index: number } & GeminiApiTakeResult> }> {
  const model = assertAllowedModel(opts.model ?? DEFAULT_MODEL);
  const force = Boolean(opts.force);
  const scenes: Array<{ out: string; scene: Scene }> = manifest.takes.map((take) => {
    const destination = resolve(take.out);
    if (!force && existsSync(destination)) {
      throw new InputError(
        `Output already exists: ${take.out}. Use new take paths or pass --force.`,
      );
    }
    const temperature = take.temperature ?? manifest.temperature;
    const scene: Scene = {
      ...(temperature !== undefined ? { temperature } : {}),
      ...(manifest.voices ? { voices: manifest.voices } : {}),
      blocks: take.blocks,
    };
    buildInteractionsPayload(scene, model);
    return { out: take.out, scene };
  });

  const takes: Array<{ index: number } & GeminiApiTakeResult> = [];
  for (const [idx, item] of scenes.entries()) {
    const saved = await speakGeminiApi(item.scene, { ...opts, model, out: item.out, force });
    takes.push({ index: idx + 1, ...saved });
    const usageNote = saved.usage
      ? `, ${saved.usage.inputTokens} in / ${saved.usage.outputTokens} out tok`
      : "";
    console.error(
      `  [take ${idx + 1}/${scenes.length}] ${saved.path} (${saved.duration.toFixed(2)} s, key=${saved.keyLabel ?? "env"}${usageNote})`,
    );
  }
  return { model, takes };
}

export async function listGeminiApiVoices(opts: GeminiApiVoiceListOptions = {}): Promise<{
  voices: GeminiApiVoiceRecord[];
  nextPageToken?: string;
  hasMore: boolean;
  keyLabel: string | null;
}> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const pageSize =
    typeof opts.pageSize === "number" && Number.isFinite(opts.pageSize)
      ? Math.min(100, Math.max(1, Math.trunc(opts.pageSize)))
      : 50;
  const params = new URLSearchParams({
    page_size: String(pageSize),
  });
  const map: Record<string, string | undefined> = {
    search: opts.search,
    language_code: opts.language,
    gender: opts.gender,
    pitch: opts.pitch,
    accent: opts.accent,
    context: opts.useCase,
    page_token: opts.pageToken,
  };
  for (const [key, value] of Object.entries(map)) {
    const trimmed = value?.trim();
    if (trimmed) params.set(key, trimmed);
  }

  const { data, keyLabel } = await executeWithKeyPool(
    opts,
    "generate",
    async ({ apiKey, signal }) => {
      let res: Response;
      try {
        res = await fetchFn(`${GEMINI_API_BASE}/voices?${params}`, {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-goog-api-key": apiKey,
          },
          redirect: "error",
          signal,
        });
      } catch (err) {
        throw networkError(err, "generate");
      }
      if (!res.ok) {
        throw await readApiHttpError(res, "Gemini Voices API failed", "generate");
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch (err) {
        throw networkError(err, "generate");
      }
      if (!json || typeof json !== "object") {
        throw new StepError("Gemini Voices API returned an invalid response payload.");
      }
      const payload = json as { voices?: unknown; next_page_token?: unknown };
      if (payload.voices !== undefined && !Array.isArray(payload.voices)) {
        throw new StepError("Gemini Voices API returned an invalid voices list.");
      }
      return payload as {
        voices?: Array<Record<string, unknown>>;
        next_page_token?: unknown;
      };
    },
  );

  const voices: GeminiApiVoiceRecord[] = (data.voices ?? [])
    .filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object"))
    .map((v) => {
      const id = typeof v.id === "string" ? v.id : "";
      const name = typeof v.display_name === "string" && v.display_name ? v.display_name : id;
      const context = Array.isArray(v.context)
        ? v.context.filter((c): c is string => typeof c === "string").join(", ")
        : typeof v.context === "string"
          ? v.context
          : undefined;
      return {
        id,
        name,
        type: typeof v.type === "string" ? v.type : "prebuilt",
        ...(typeof v.language_code === "string" ? { language: v.language_code } : {}),
        ...(typeof v.region_code === "string" ? { region: v.region_code } : {}),
        ...(typeof v.accent === "string" ? { accent: v.accent } : {}),
        ...(typeof v.gender === "string" ? { gender: v.gender } : {}),
        ...(typeof v.pitch === "string" ? { pitch: v.pitch } : {}),
        ...(typeof v.persona === "string" ? { persona: v.persona } : {}),
        ...(context ? { context } : {}),
        ...(typeof v.description === "string" ? { description: v.description } : {}),
      };
    })
    .filter((v) => Boolean(v.id));

  const nextPageToken =
    typeof data.next_page_token === "string" && data.next_page_token
      ? data.next_page_token
      : undefined;
  return {
    voices,
    ...(nextPageToken ? { nextPageToken } : {}),
    hasMore: Boolean(nextPageToken),
    keyLabel,
  };
}
