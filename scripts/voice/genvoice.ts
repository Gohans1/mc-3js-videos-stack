// ElevenLabs v4 & GenVoice client in Bun/TypeScript: zero external script path dependency, bounded async polling,
// prosody context stitching (previous_text / next_text + request-id chaining), character-to-word alignment, and Voice Changer (STS).
import { lookup as dnsLookup } from "node:dns/promises";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isNonGlobalIp } from "../../packages/live-studio/src/network-address";

export interface WordTiming {
  w: string;
  s: number;
  e: number;
}

export interface CharacterAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

export interface TtsOptions {
  voiceId: string;
  text: string;
  out: string;
  model?: string;
  language?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
  previousText?: string;
  nextText?: string;
  previousRequestIds?: string[];
  nextRequestIds?: string[];
  provider?: "genvoice" | "elevenlabs";
  apiKey?: string;
  apiBase?: string;
  env?: Record<string, string | undefined>;
  pollIntervalMs?: number;
  maxPollMs?: number;
  lookup?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

export interface TtsResult {
  provider: "genvoice" | "elevenlabs";
  task?: string;
  requestId?: string;
  characters?: number;
  credits?: number;
  wordsFile?: string;
}

export interface StsOptions {
  voiceId: string;
  audioPath: string;
  out: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
  removeBackgroundNoise?: boolean;
  seed?: number;
  provider?: "genvoice" | "elevenlabs";
  apiKey?: string;
  apiBase?: string;
  env?: Record<string, string | undefined>;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export const stripAudioTags = (text: string): string =>
  text
    .replace(/\[[^\]\r\n]{1,400}\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const alignmentToWords = (
  alignment: CharacterAlignment,
): { text: string; dur: number; words: WordTiming[] } => {
  const {
    characters = [],
    character_start_times_seconds: starts = [],
    character_end_times_seconds: ends = [],
  } = alignment;
  const words: WordTiming[] = [];
  let cur = "",
    wStart = -1,
    wEnd = -1;
  const flush = () => {
    if (!cur) return;
    const s = Number.isFinite(wStart) && wStart >= 0 ? wStart : 0;
    const rawE = Number.isFinite(wEnd) && wEnd >= 0 ? wEnd : s;
    words.push({ w: cur, s: r3(s), e: r3(Math.max(s, rawE)) });
    cur = "";
    wStart = -1;
    wEnd = -1;
  };
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i] ?? "";
    if (ch === "[") {
      const limit = Math.min(characters.length - 1, i + 401);
      let closeIdx = -1;
      for (let j = i + 1; j <= limit; j++) {
        const inner = characters[j] ?? "";
        if (inner === "\r" || inner === "\n") break;
        if (inner === "]") {
          closeIdx = j;
          break;
        }
      }
      if (closeIdx > i + 1) {
        flush();
        i = closeIdx;
        continue;
      }
    }
    if (!ch || /\s/.test(ch)) {
      flush();
      continue;
    }
    if (!cur) {
      const rawStart = starts[i];
      wStart =
        typeof rawStart === "number" && Number.isFinite(rawStart) && rawStart >= 0 ? rawStart : 0;
    }
    cur += ch;
    const rawEnd = ends[i];
    wEnd = typeof rawEnd === "number" && Number.isFinite(rawEnd) && rawEnd >= 0 ? rawEnd : wStart;
  }
  flush();
  const dur = r3(Math.max(...ends.filter(Number.isFinite), words.at(-1)?.e ?? 0, 0));
  return { text: words.map((w) => w.w).join(" "), dur, words };
};

export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 64;

const assertSafeAudioUrl = async (
  audioUrl: URL,
  baseProto: string,
  lookupFn?: TtsOptions["lookup"],
): Promise<boolean> => {
  const bareHost = audioUrl.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
  const isLocalHost = bareHost === "localhost" || bareHost === "127.0.0.1" || bareHost === "::1";
  const allowLocalHttp = baseProto === "http:" && audioUrl.protocol === "http:" && isLocalHost;
  if (allowLocalHttp) return true;
  if (audioUrl.protocol !== "https:") {
    throw new Error(`Refusing insecure GenVoice audio URL protocol: ${audioUrl.protocol}`);
  }
  if (!bareHost || bareHost === "localhost" || bareHost.endsWith(".localhost")) {
    throw new Error(`Refusing loopback GenVoice audio URL host: ${audioUrl.hostname}`);
  }
  if (isIP(bareHost) !== 0) {
    if (isNonGlobalIp(bareHost)) {
      throw new Error(`Refusing private or non-global GenVoice audio URL IP: ${bareHost}`);
    }
    return false;
  }
  const resolveHost = lookupFn ?? ((h: string) => dnsLookup(h, { all: true, verbatim: true }));
  const answers = await resolveHost(bareHost);
  if (!answers.length || answers.some((a) => isNonGlobalIp(a.address))) {
    throw new Error(
      `Refusing private or non-global DNS resolution for GenVoice audio URL host: ${bareHost}`,
    );
  }
  return false;
};

const readBoundedBytes = async (
  res: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> => {
  const lenHeader = res.headers.get("content-length");
  if (lenHeader !== null) {
    const declared = Number(lenHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`${label} exceeds maximum size limit (${maxBytes} bytes)`);
    }
  }
  if (!res.body) throw new Error(`${label} returned empty audio (0 bytes)`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`${label} exceeds maximum size limit (${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error(`${label} returned empty audio (0 bytes)`);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
};

let tmpSeq = 0;
const atomicWrite = (out: string, bytes: Uint8Array) => {
  const target = resolve(out),
    part = `${target}.${process.pid}.${Date.now()}.${++tmpSeq}.part`;
  mkdirSync(dirname(target), { recursive: true });
  try {
    writeFileSync(part, bytes);
    renameSync(part, target);
  } catch (err) {
    rmSync(part, { force: true });
    throw err;
  }
};

const supportsStitching = (model: string) => !model.startsWith("eleven_v3");

export const sanitizeErrorText = (msg: string, ...secrets: Array<string | undefined>): string => {
  let out = msg
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/(xi-api-key\s*[:=]\s*)[^\s,;'"}\]]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:key|api_key|token|xi-api-key)=)[^&\s]+/gi, "$1[REDACTED]");
  for (const s of secrets) {
    const trimmed = s?.trim();
    if (trimmed && trimmed.length >= 4) out = out.replaceAll(trimmed, "[REDACTED]");
  }
  return out;
};

const normalizeApiBase = (raw: string | undefined, fallback: string, label: string): string => {
  const chosen = (raw?.trim() || fallback).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(chosen);
  } catch {
    throw new Error(`Invalid ${label} URL: ${JSON.stringify(chosen)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${label} protocol: ${parsed.protocol}`);
  }
  return chosen;
};

export const resolveVoiceProvider = (
  opts: { provider?: "genvoice" | "elevenlabs"; apiKey?: string; apiBase?: string } = {},
  env: Record<string, string | undefined> = process.env,
) => {
  const elKey = env.ELEVENLABS_API_KEY?.trim();
  const gvKey = env.GENVOICE_API_KEY?.trim();
  const provider = opts.provider ?? (elKey ? "elevenlabs" : "genvoice");
  const apiKey =
    opts.apiKey !== undefined ? opts.apiKey.trim() : provider === "elevenlabs" ? elKey : gvKey;
  if (!apiKey) {
    throw new Error(
      `Missing API key: set ${provider === "elevenlabs" ? "ELEVENLABS_API_KEY" : "GENVOICE_API_KEY"} in environment`,
    );
  }
  const defaultBase =
    provider === "elevenlabs" ? "https://api.elevenlabs.io/v1" : "https://api.genvoice.pro/v1";
  const envBase = provider === "elevenlabs" ? env.ELEVENLABS_API_BASE : env.GENVOICE_API_BASE;
  const label = provider === "elevenlabs" ? "ELEVENLABS_API_BASE" : "GENVOICE_API_BASE";
  const rawBase = opts.apiBase?.trim() ? opts.apiBase : envBase;
  const apiBase = normalizeApiBase(rawBase, defaultBase, label);
  return { provider, apiKey, apiBase };
};

const VIET_RE =
  /[ăâđêôơưĂÂĐÊÔƠƯáàãíìĩóòõúùũýỳỹÁÀÃÍÌĨÓÒÕÚÙŨÝỲỸ\u1EA0-\u1EF9]|[\u0306\u0309\u031B\u0323]/u;

const fetchSafe = async (input: string | URL, init: RequestInit, secret?: string) => {
  try {
    return await fetch(input, init);
  } catch (err) {
    throw new Error(sanitizeErrorText((err as Error).message, secret));
  }
};

export const detectLanguage = (text: string): "vi" | "en" =>
  VIET_RE.test(stripAudioTags(text)) ? "vi" : "en";

export const tts = async (opts: TtsOptions): Promise<TtsResult> => {
  const resolved = resolveVoiceProvider(opts, opts.env ?? process.env);
  const apiBase = resolved.apiBase;
  const model = opts.model ?? "eleven_v4";
  const speed = opts.speed ?? 1.0;
  const stability = opts.stability ?? 0.5;
  const similarityBoost = opts.similarityBoost ?? 0.75;
  const lang = opts.language ?? detectLanguage(opts.text);

  const prev = opts.previousText ? stripAudioTags(opts.previousText) : "";
  const next = opts.nextText ? stripAudioTags(opts.nextText) : "";
  const stitch: Record<string, unknown> = {};
  if (supportsStitching(model)) {
    if (prev) stitch.previous_text = prev;
    if (next) stitch.next_text = next;
    if (resolved.provider === "elevenlabs") {
      const prevIds = (opts.previousRequestIds ?? []).filter(Boolean).slice(-3);
      const nextIds = (opts.nextRequestIds ?? []).filter(Boolean).slice(0, 3);
      if (prevIds.length) stitch.previous_request_ids = prevIds;
      if (nextIds.length) stitch.next_request_ids = nextIds;
    }
  }

  const baseBody: Record<string, unknown> = {
    text: opts.text,
    model_id: model,
    language_code: lang,
    voice_settings: { stability, similarity_boost: similarityBoost, speed },
  };

  if (resolved.provider === "elevenlabs") {
    const postEleven = (body: Record<string, unknown>) =>
      fetchSafe(
        `${apiBase}/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": resolved.apiKey, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        },
        resolved.apiKey,
      );
    let res = await postEleven({ ...baseBody, ...stitch });
    if (
      !res.ok &&
      (stitch.previous_request_ids || stitch.next_request_ids) &&
      (res.status === 400 || res.status === 404 || res.status === 422 || res.status === 500)
    ) {
      const textOnlyStitch: Record<string, unknown> = {};
      if (prev) textOnlyStitch.previous_text = prev;
      if (next) textOnlyStitch.next_text = next;
      res = await postEleven({ ...baseBody, ...textOnlyStitch });
    }
    if (!res.ok)
      throw new Error(
        sanitizeErrorText(
          `ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
          resolved.apiKey,
        ),
      );
    const requestId = res.headers.get("request-id") ?? res.headers.get("x-request-id") ?? undefined;
    const payload = (await res.json()) as {
      audio_base64?: string;
      alignment?: CharacterAlignment;
      normalized_alignment?: CharacterAlignment;
    };
    if (typeof payload?.audio_base64 !== "string" || payload.audio_base64.length === 0) {
      throw new Error("ElevenLabs TTS response missing audio_base64");
    }
    if (payload.audio_base64.length > MAX_BASE64_CHARS) {
      throw new Error(
        `ElevenLabs audio payload exceeds maximum size limit (${MAX_AUDIO_BYTES} bytes)`,
      );
    }
    const audioBytes = new Uint8Array(Buffer.from(payload.audio_base64, "base64"));
    if (audioBytes.byteLength === 0) {
      throw new Error("ElevenLabs TTS response decoded to empty audio (0 bytes)");
    }
    atomicWrite(opts.out, audioBytes);
    let wordsFile: string | undefined;
    const targetWords = `${resolve(opts.out)}.words.json`;
    const align = payload.alignment ?? payload.normalized_alignment;
    if (align?.characters?.length) {
      const info = alignmentToWords(align);
      if (info.words.length > 0) {
        wordsFile = targetWords;
        atomicWrite(wordsFile, new TextEncoder().encode(JSON.stringify(info, null, 1) + "\n"));
      } else {
        rmSync(targetWords, { force: true });
      }
    } else {
      rmSync(targetWords, { force: true });
    }
    return { provider: "elevenlabs", requestId, wordsFile };
  }

  // GenVoice async job flow with automatic fallback if proxy rejects optional stitching fields
  const postJob = (body: Record<string, unknown>) =>
    fetchSafe(
      `${apiBase}/text-to-speech/${encodeURIComponent(opts.voiceId)}`,
      {
        method: "POST",
        headers: { "xi-api-key": resolved.apiKey, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      },
      resolved.apiKey,
    );

  let res = await postJob({ ...baseBody, ...stitch });
  if ((res.status === 400 || res.status === 422) && Object.keys(stitch).length > 0) {
    res = await postJob(baseBody);
  }
  if (!res.ok)
    throw new Error(
      sanitizeErrorText(
        `GenVoice TTS create failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
        resolved.apiKey,
      ),
    );
  const created = (await res.json()) as { id?: string };
  const task = created.id;
  if (!task) throw new Error("GenVoice TTS response missing task id");

  const pollIntervalMs = opts.pollIntervalMs ?? 2500;
  const maxPollMs = opts.maxPollMs ?? 180_000;
  const deadline = Date.now() + maxPollMs;
  let job: {
    status?: string;
    error?: string;
    characters_used?: number;
    credits_deducted?: number;
    result?: { audio_url?: string };
  } | null = null;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, pollIntervalMs));
    const poll = await fetchSafe(
      `${apiBase}/history/${encodeURIComponent(task)}`,
      {
        headers: { "xi-api-key": resolved.apiKey },
        signal: AbortSignal.timeout(30_000),
      },
      resolved.apiKey,
    );
    if (!poll.ok) {
      throw new Error(
        sanitizeErrorText(`GenVoice history poll failed (${poll.status})`, resolved.apiKey),
      );
    }
    job = await poll.json();
    if (job?.status === "completed") break;
    if (job?.status === "failed" || job?.status === "error" || job?.status === "cancelled") {
      throw new Error(
        sanitizeErrorText(
          `GenVoice task ${task} ${job.status}: ${job.error ?? "unknown error"}`,
          resolved.apiKey,
        ),
      );
    }
  }
  if (job?.status !== "completed") {
    throw new Error(
      `GenVoice task ${task} timed out after ${Math.round(maxPollMs / 1000)}s (last status: ${job?.status ?? "unknown"})`,
    );
  }
  if (!job.result?.audio_url) {
    throw new Error(`GenVoice task ${task} completed without result.audio_url`);
  }
  const baseProto = new URL(apiBase).protocol;
  let audioUrl: URL;
  try {
    audioUrl = new URL(job.result.audio_url);
  } catch {
    throw new Error(`GenVoice task ${task} returned invalid audio_url`);
  }
  const allowLocalHttp = await assertSafeAudioUrl(audioUrl, baseProto, opts.lookup);
  const dl = await fetchSafe(
    audioUrl,
    {
      redirect: allowLocalHttp ? "follow" : "error",
      signal: AbortSignal.timeout(120_000),
    },
    resolved.apiKey,
  );
  if (!dl.ok) {
    throw new Error(
      sanitizeErrorText(`GenVoice audio download failed (${dl.status})`, resolved.apiKey),
    );
  }
  atomicWrite(opts.out, await readBoundedBytes(dl, MAX_AUDIO_BYTES, "GenVoice audio download"));
  rmSync(`${resolve(opts.out)}.words.json`, { force: true });
  return {
    provider: "genvoice",
    task,
    characters: job.characters_used,
    credits: job.credits_deducted,
  };
};

export const sts = async (
  opts: StsOptions,
): Promise<{ provider: "elevenlabs"; requestId?: string }> => {
  const env = opts.env ?? process.env;
  const elKey = env.ELEVENLABS_API_KEY?.trim();
  const provider = opts.provider ?? (elKey ? "elevenlabs" : "genvoice");
  if (provider !== "elevenlabs") {
    throw new Error(
      "Speech-to-Speech (Voice Changer) requires ELEVENLABS_API_KEY (api.genvoice.pro/v1 returns 405 on /speech-to-speech)",
    );
  }
  const { apiKey, apiBase } = resolveVoiceProvider({ ...opts, provider: "elevenlabs" }, env);

  const guideSize = statSync(opts.audioPath).size;
  if (guideSize === 0) {
    throw new Error("Guide audio file is empty (0 bytes)");
  }
  if (guideSize > MAX_AUDIO_BYTES) {
    throw new Error(`Guide audio file exceeds maximum size limit (${MAX_AUDIO_BYTES} bytes)`);
  }
  const form = new FormData();
  const audioBytes = new Uint8Array(readFileSync(opts.audioPath));
  form.append("audio", new Blob([audioBytes]), basename(opts.audioPath));
  form.append("model_id", opts.model ?? "eleven_multilingual_sts_v2");
  form.append(
    "voice_settings",
    JSON.stringify({
      stability: opts.stability ?? 0.5,
      similarity_boost: opts.similarityBoost ?? 0.75,
    }),
  );
  form.append("remove_background_noise", String(opts.removeBackgroundNoise ?? false));
  if (opts.seed !== undefined) form.append("seed", String(opts.seed));

  const res = await fetchSafe(
    `${apiBase}/speech-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(120_000),
    },
    apiKey,
  );
  if (!res.ok)
    throw new Error(
      sanitizeErrorText(
        `ElevenLabs STS failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
        apiKey,
      ),
    );
  const requestId = res.headers.get("request-id") ?? res.headers.get("x-request-id") ?? undefined;
  atomicWrite(opts.out, await readBoundedBytes(res, MAX_AUDIO_BYTES, "ElevenLabs STS download"));
  rmSync(`${resolve(opts.out)}.words.json`, { force: true });
  return { provider: "elevenlabs", requestId };
};

const apiGet = async (path: string, params: Record<string, string> = {}) => {
  const { apiKey, apiBase } = resolveVoiceProvider({});
  const url = new URL(`${apiBase}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchSafe(
    url,
    {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    },
    apiKey,
  );
  if (!res.ok)
    throw new Error(sanitizeErrorText(`GET ${url.pathname} failed (${res.status})`, apiKey));
  return res.json();
};

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "voices") {
    const data = (await apiGet("shared-voices", { search: rest[0] ?? "", page_size: "20" })) as {
      voices?: Record<string, unknown>[];
    };
    for (const v of data.voices ?? [])
      console.log(
        v.voice_id,
        "|",
        v.name,
        "|",
        v.accent,
        v.age,
        v.use_case,
        "|",
        typeof v.description === "string" ? v.description.slice(0, 80) : "",
      );
  } else if (cmd === "models") {
    for (const m of (await apiGet("models")) as Record<string, unknown>[])
      console.log(m.model_id, "|", m.name, m.can_do_voice_conversion ? "(STS)" : "");
  } else if (cmd === "credits") {
    console.log(JSON.stringify(await apiGet("user"), null, 2).slice(0, 800));
  } else if (cmd === "tts") {
    const [voiceId, textFile, out, model, speed, stability] = rest;
    if (!voiceId || !textFile || !out) {
      console.error(
        "usage: bun scripts/voice/genvoice.ts tts <voiceId> <textFile> <out> [model] [speed] [stability]",
      );
      process.exit(2);
    }
    const text = readFileSync(textFile, "utf8").trim();
    console.log(
      await tts({
        voiceId,
        text,
        out,
        model: model || "eleven_v4",
        speed: speed ? Number(speed) : 1.0,
        stability: stability ? Number(stability) : 0.5,
      }),
    );
  } else if (cmd === "sts") {
    const [voiceId, audioPath, out, model] = rest;
    if (!voiceId || !audioPath || !out) {
      console.error("usage: bun scripts/voice/genvoice.ts sts <voiceId> <audioPath> <out> [model]");
      process.exit(2);
    }
    console.log(
      await sts({ voiceId, audioPath, out, model: model || "eleven_multilingual_sts_v2" }),
    );
  } else {
    console.error("usage: bun scripts/voice/genvoice.ts <voices|models|credits|tts|sts> ...");
    process.exit(2);
  }
}
