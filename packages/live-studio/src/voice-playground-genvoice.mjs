// GenVoice (ElevenLabs v4 wrapper) HTTP client, built-in model/language catalogs,
// key resolution/masking, SSRF-safe media downloads, and audio parameter validators.
import { lookup as dnsLookup } from "node:dns/promises";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

import { isNonGlobalIp } from "./network-address.ts";
import { wavInfo } from "./sound.mjs";
import { sanitizeError } from "./voice-library.mjs";
import {
  CAPCUT_TONES,
  FALLBACK_PROVIDER_LANGUAGES,
  languageForProvider,
  PROVIDER_IDS,
  providerForModel,
} from "./voice-playground-providers.mjs";
import {
  AUDIO_TAG_RE,
  DANGEROUS_KEYS,
  detectTextLanguage,
  extractAudioTags,
  genVoiceTaskChargeSource,
  isFailedGenVoiceTask,
  parseDialogueTurnNames,
  SAFE_MEDIA_FILE,
  SAFE_REMOTE_ID_RE,
  stripDialogueSpeakerBrackets,
} from "./voice-playground-text.mjs";
import { mp3Seconds } from "./voice.mjs";

export { isNonGlobalIp } from "./network-address.ts";

export {
  AUDIO_TAG_RE,
  DANGEROUS_KEYS,
  detectTextLanguage,
  extractAudioTags,
  parseDialogueTurnNames,
  SAFE_MEDIA_FILE,
  SAFE_REMOTE_ID_RE,
  stripDialogueSpeakerBrackets,
};

export const DEFAULT_API_BASE = "https://api.genvoice.pro/v1";
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
export const MAX_SRT_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_STT_BYTES = 90 * 1024 * 1024;
export const CATALOG_TTL_MS = 10 * 60 * 1000;
export const SAFE_SRT_FILE = /^[A-Za-z0-9_-]{1,120}\.srt$/;
export const isSafeRemoteId = (value) => typeof value === "string" && SAFE_REMOTE_ID_RE.test(value);

export const assertGenVoiceTaskIdentity = (data, expectedId) => {
  if (
    [data.id, data.task_id].some(
      (id) =>
        id !== undefined &&
        id !== null &&
        id !== "" &&
        (!["string", "number"].includes(typeof id) || String(id) !== String(expectedId)),
    )
  )
    throw Object.assign(new Error("GenVoice returned a different task ID"), { status: 502 });
};

let tmpSeq = 0;
export const nextTmp = () => `${process.pid}.${Date.now()}.${++tmpSeq}`;

export const inside = (root, file) => {
  const r = relative(root, file);
  return Boolean(r) && !r.startsWith("..") && !isAbsolute(r);
};

export const writeAtomic = (target, content, opts) => {
  const resolved = resolve(target);
  const part = `${resolved}.${nextTmp()}.part`;
  mkdirSync(dirname(resolved), { recursive: true });
  try {
    writeFileSync(part, content, opts);
    renameSync(part, resolved);
  } catch (err) {
    rmSync(part, { force: true });
    throw err;
  }
};

export const maskApiKey = (key) => {
  const k = typeof key === "string" ? key.trim() : "";
  if (!k) return "";
  if (k.length <= 8) return "••••••••";
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
};

export const normalizeApiBase = (raw) => {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return DEFAULT_API_BASE;
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error("Invalid API base URL");
  }
  if (u.username || u.password) {
    throw new Error("API base URL must not contain embedded credentials");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopback)) {
    throw new Error("API base URL must use https:// (http:// is allowed only for localhost)");
  }
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.origin}${path === "" ? "/v1" : path}`;
};

export const assertSafeApiBase = async (rawBase, lookupFn) => {
  const normalized = normalizeApiBase(rawBase);
  let u;
  try {
    u = new URL(normalized);
  } catch {
    throw Object.assign(new Error("Invalid API base URL"), { status: 400 });
  }
  const host = u.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLoopback) return normalized;
  if (
    !host ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw Object.assign(new Error(`Refusing private or internal API base host: ${u.hostname}`), {
      status: 400,
    });
  }
  if (isIP(host) !== 0) {
    if (isNonGlobalIp(host)) {
      throw Object.assign(new Error(`Refusing non-global API base IP: ${host}`), { status: 400 });
    }
    return normalized;
  }
  const resolveHost = lookupFn ?? ((h) => dnsLookup(h, { all: true, verbatim: true }));
  let answers = [];
  try {
    answers = await resolveHost(host);
  } catch {
    answers = [];
  }
  if (!answers.length || answers.some((a) => isNonGlobalIp(a.address))) {
    throw Object.assign(new Error(`Refusing non-global DNS target for API base: ${host}`), {
      status: 400,
    });
  }
  return normalized;
};

export const parseEnvFile = (filePath) => {
  if (!filePath || !existsSync(filePath)) return {};
  try {
    if (lstatSync(filePath).isSymbolicLink()) return {};
    const out = {};
    for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const body = line.startsWith("export ") ? line.slice(7).trim() : line;
      const eq = body.indexOf("=");
      if (eq <= 0) continue;
      const key = body.slice(0, eq).trim();
      let val = body.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && val) out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
};

// Built-in GenVoice ElevenLabs model metadata matching GET /v1/models capability flags
export const BUILTIN_GENVOICE_MODELS = [
  {
    model_id: "eleven_v4",
    name: "Eleven v4",
    description: "Flagship expressive ElevenLabs v4 model with nuanced [audio tags] direction.",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: false,
    can_use_speaker_boost: false,
    supports_context: true,
    supports_speed: false,
    supports_similarity: true,
    maximum_text_length_per_request: 10000,
    model_rates: { character_cost_multiplier: 1 },
    languages: [],
  },
  {
    model_id: "eleven_v4_turbo",
    name: "Eleven v4 Turbo",
    description: "Low-latency Eleven v4 variant supporting [audio tags] at 0.5x credit rate.",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: false,
    can_use_speaker_boost: false,
    supports_context: true,
    supports_speed: false,
    supports_similarity: true,
    maximum_text_length_per_request: 10000,
    model_rates: { character_cost_multiplier: 0.5 },
    languages: [],
  },
  {
    model_id: "eleven_v3",
    name: "Eleven v3",
    description: "Expressive v3 model with discrete stability presets and [audio tags].",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: false,
    can_use_speaker_boost: false,
    supports_context: false,
    supports_speed: true,
    supports_similarity: false,
    stability_values: [0, 0.5, 1],
    maximum_text_length_per_request: 5000,
    model_rates: { character_cost_multiplier: 1 },
    languages: [],
  },
  {
    model_id: "eleven_v3_conversational",
    name: "Eleven v3 Conversational",
    description: "Low-latency conversational v3 with similarity & speaker boost at 0.5x cost.",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: false,
    can_use_speaker_boost: true,
    supports_context: false,
    supports_speed: true,
    supports_similarity: true,
    maximum_text_length_per_request: 5000,
    model_rates: { character_cost_multiplier: 0.5 },
    languages: [],
  },
  {
    model_id: "eleven_multilingual_v2",
    name: "Eleven Multilingual v2",
    description: "Stable rich multilingual narrator model with style & speaker boost sliders.",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: true,
    can_use_speaker_boost: true,
    supports_context: true,
    supports_speed: true,
    supports_similarity: true,
    maximum_text_length_per_request: 10000,
    model_rates: { character_cost_multiplier: 1 },
    languages: [],
  },
  {
    model_id: "eleven_storytel_v2",
    name: "Eleven Multilingual v2 (Storytel)",
    description: "Storytel-tuned Multilingual v2 variant with style & speaker boost.",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: true,
    can_use_speaker_boost: true,
    supports_context: true,
    supports_speed: true,
    supports_similarity: true,
    maximum_text_length_per_request: 10000,
    model_rates: { character_cost_multiplier: 1 },
    languages: [],
  },
  {
    model_id: "eleven_flash_v2_5",
    name: "Eleven Flash v2.5",
    description: "Ultra-fast 32-language model (0.5x rate, up to 40,000 chars).",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: false,
    can_use_speaker_boost: false,
    supports_speed: true,
    supports_similarity: true,
    maximum_text_length_per_request: 40000,
    model_rates: { character_cost_multiplier: 0.5 },
    languages: [],
  },
  {
    model_id: "eleven_turbo_v2_5",
    name: "Eleven Turbo v2.5",
    description: "Balanced low-latency 32-language model at 0.5x rate.",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: false,
    can_use_speaker_boost: false,
    supports_speed: true,
    supports_similarity: true,
    maximum_text_length_per_request: 40000,
    model_rates: { character_cost_multiplier: 0.5 },
    languages: [],
  },
  {
    model_id: "eleven_turbo_v2",
    name: "Eleven Turbo v2",
    description: "Fast English-only v2 model at 0.5x rate.",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: false,
    can_use_speaker_boost: false,
    supports_speed: true,
    supports_similarity: true,
    maximum_text_length_per_request: 30000,
    model_rates: { character_cost_multiplier: 0.5 },
    languages: [{ language_id: "en", name: "English" }],
  },
  {
    model_id: "eleven_flash_v2",
    name: "Eleven Flash v2",
    description: "Lowest-latency English-only v2 model at 0.5x rate.",
    can_do_text_to_speech: true,
    can_do_voice_conversion: false,
    can_use_style: false,
    can_use_speaker_boost: false,
    supports_speed: true,
    supports_similarity: true,
    maximum_text_length_per_request: 30000,
    model_rates: { character_cost_multiplier: 0.5 },
    languages: [{ language_id: "en", name: "English" }],
  },
  {
    model_id: "eleven_multilingual_sts_v2",
    name: "Eleven Multilingual STS v2",
    description: "Voice Changer model preserving cadence & emotion across languages.",
    can_do_text_to_speech: false,
    can_do_voice_conversion: true,
    can_use_style: true,
    can_use_speaker_boost: true,
    supports_speed: false,
    supports_similarity: true,
    maximum_text_length_per_request: 10000,
    model_rates: { character_cost_multiplier: 1 },
    languages: [],
  },
  {
    model_id: "eleven_english_sts_v2",
    name: "Eleven English STS v2",
    description: "English-focused speech-to-speech Voice Changer model.",
    can_do_text_to_speech: false,
    can_do_voice_conversion: true,
    can_use_style: true,
    can_use_speaker_boost: true,
    supports_speed: false,
    supports_similarity: true,
    maximum_text_length_per_request: 10000,
    model_rates: { character_cost_multiplier: 1 },
    languages: [{ language_id: "en", name: "English" }],
  },
];

export const BUILTIN_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "vi", name: "Vietnamese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "ru", name: "Russian" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "th", name: "Thai" },
];

export const assertSafeMediaUrl = async (rawUrl, apiBase, lookupFn) => {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Invalid media URL returned by GenVoice");
  }
  const baseUrl = new URL(apiBase);
  const host = u.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (
    baseUrl.protocol === "http:" &&
    u.protocol === "http:" &&
    isLoopback &&
    u.host === baseUrl.host
  )
    return;
  if (u.protocol !== "https:") {
    throw new Error(`Refusing insecure GenVoice media URL protocol: ${u.protocol}`);
  }
  if (!host || isLoopback || host.endsWith(".localhost")) {
    throw new Error(`Refusing local GenVoice media URL host: ${u.hostname}`);
  }
  if (isIP(host) !== 0) {
    if (isNonGlobalIp(host)) throw new Error(`Refusing non-global GenVoice media IP: ${host}`);
    return;
  }
  const resolveHost = lookupFn ?? ((h) => dnsLookup(h, { all: true, verbatim: true }));
  const answers = await resolveHost(host);
  if (!answers.length || answers.some((a) => isNonGlobalIp(a.address))) {
    throw new Error(`Refusing non-global DNS target for media URL: ${host}`);
  }
};

export const readBoundedBytes = async (res, maxBytes, label) => {
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`${label} exceeds size limit (${maxBytes} bytes)`);
    }
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`${label} exceeds size limit (${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
};

export const audioDurationFromFile = (filePath) => {
  try {
    const ext = extname(filePath).toLowerCase();
    const { size } = statSync(filePath);
    if (ext === ".mp3") return +mp3Seconds(filePath, size).toFixed(3);
    if (ext === ".wav") {
      const info = wavInfo(filePath);
      return info?.seconds ? +info.seconds.toFixed(3) : 0;
    }
    return 0;
  } catch {
    return 0;
  }
};

export const clampNum = (v, min, max) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;

export const sanitizeVoiceSettings = (
  raw,
  model,
  provider = model?.provider ?? providerForModel(model?.model_id),
) => {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  if (provider !== "elevenlabs") {
    const speed = clampNum(src.speed, 0.5, 2),
      pitch = clampNum(src.pitch, -12, 12),
      vol = clampNum(src.vol, 0.01, 10);
    if (speed !== undefined) out.speed = +speed.toFixed(3);
    if (pitch !== undefined) out.pitch = Math.round(pitch);
    if (provider === "minimax" && vol !== undefined) out.vol = +vol.toFixed(3);
    return out;
  }
  const stability = clampNum(src.stability, 0, 1);
  if (stability !== undefined) {
    if (Array.isArray(model?.stability_values) && model.stability_values.length) {
      let best = model.stability_values[0];
      let bestDist = Math.abs(best - stability);
      for (const candidate of model.stability_values) {
        const d = Math.abs(candidate - stability);
        if (d < bestDist) {
          best = candidate;
          bestDist = d;
        }
      }
      out.stability = best;
    } else {
      out.stability = +stability.toFixed(3);
    }
  }
  if (model?.supports_similarity !== false) {
    const sim = clampNum(src.similarity_boost, 0, 1);
    if (sim !== undefined) out.similarity_boost = +sim.toFixed(3);
  }
  if (model?.can_use_style === true) {
    const style = clampNum(src.style, 0, 1);
    if (style !== undefined) out.style = +style.toFixed(3);
  }
  if (model?.can_use_speaker_boost === true && typeof src.use_speaker_boost === "boolean") {
    out.use_speaker_boost = src.use_speaker_boost;
  }
  if (model?.supports_speed === true) {
    const speed = clampNum(src.speed, 0.7, 1.2);
    if (speed !== undefined) out.speed = +speed.toFixed(3);
  }
  return out;
};

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export const audioMimeForExt = (ext) =>
  ({
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    ".opus": "audio/ogg",
    ".avi": "video/x-msvideo",
  })[ext] || "audio/mpeg";

export const wrapPcm16ToWav = (pcmBytes, sampleRate = 44100) => {
  const buf = Buffer.isBuffer(pcmBytes) ? pcmBytes : Buffer.from(pcmBytes);
  if (buf.byteLength >= 4 && buf.subarray(0, 4).toString("ascii") === "RIFF") return buf;
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.trunc(sampleRate) : 44100;
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0);
  hdr.writeUInt32LE(36 + buf.byteLength, 4);
  hdr.write("WAVE", 8);
  hdr.write("fmt ", 12);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(rate, 24);
  hdr.writeUInt32LE(rate * 2, 28);
  hdr.writeUInt16LE(2, 32);
  hdr.writeUInt16LE(16, 34);
  hdr.write("data", 36);
  hdr.writeUInt32LE(buf.byteLength, 40);
  return Buffer.concat([hdr, buf]);
};

const CONTAINER_CT_TOKENS = [
  "mpeg",
  "mp3",
  "wav",
  "wave",
  "ogg",
  "opus",
  "webm",
  "mp4",
  "m4a",
  "flac",
  "aac",
  "aiff",
];
const CONTAINER_EXTS = new Set([
  ".mp3",
  ".wav",
  ".ogg",
  ".opus",
  ".webm",
  ".m4a",
  ".mp4",
  ".flac",
  ".aac",
  ".aiff",
]);

const hasValidMpegSync = (buf) => {
  if (buf.byteLength < 4 || buf[0] !== 0xff || (buf[1] & 0xe0) !== 0xe0) return false;
  const version = (buf[1] >> 3) & 0x03;
  const layer = (buf[1] >> 1) & 0x03;
  if (layer === 0) return (buf[1] & 0xf6) === 0xf0; // ADTS AAC sync
  const bitrateIdx = (buf[2] >> 4) & 0x0f;
  const sampleRateIdx = (buf[2] >> 2) & 0x03;
  return version !== 1 && bitrateIdx !== 0 && bitrateIdx !== 0x0f && sampleRateIdx !== 3;
};

export const sniffContainerMagic = (audioBytes) => {
  const buf = Buffer.isBuffer(audioBytes) ? audioBytes : Buffer.from(audioBytes ?? []);
  if (buf.byteLength < 4) return null;
  const h4 = buf.subarray(0, 4).toString("ascii");
  if (h4 === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WAVE") return ".wav";
  if (h4 === "OggS") return ".ogg";
  if (h4 === "fLaC") return ".flac";
  if (h4 === "FORM") return ".aiff";
  if (buf.subarray(0, 3).toString("ascii") === "ID3") return ".mp3";
  if (buf.byteLength >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp") return ".m4a";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return ".webm";
  if (hasValidMpegSync(buf)) return ".mp3";
  return null;
};

export const containerHasAudio = async (extension, bytes, signal) => {
  if (!extension) return false;
  const probe = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-protocol_whitelist",
      "pipe",
      "-select_streams",
      "a",
      "-count_packets",
      "-show_entries",
      "stream=nb_read_packets",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      "pipe:0",
    ],
    {
      stdin: bytes,
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      signal,
    },
  );
  const [code, streams] = await Promise.all([probe.exited, new Response(probe.stdout).text()]);
  return code === 0 && streams.split(/\r?\n/).some((count) => Number(count) > 0);
};

/** Returns true only when bytes look like headerless PCM rather than a self-describing container. */
export const isRawHeaderlessPcm = (audioBytes, url, contentType) => {
  const buf = Buffer.isBuffer(audioBytes) ? audioBytes : Buffer.from(audioBytes ?? []);
  if (buf.byteLength === 0) return false;
  const ct = String(contentType ?? "").toLowerCase();
  const explicitRawPcm = ct.includes("audio/pcm") || ct.includes("audio/l16") || ct.includes("pcm");
  const magic = sniffContainerMagic(buf);
  if (magic && !(magic === ".mp3" && explicitRawPcm)) return false;
  if (CONTAINER_CT_TOKENS.some((t) => ct.includes(t))) return false;
  if (!explicitRawPcm && url) {
    try {
      const pExt = extname(new URL(url).pathname).toLowerCase();
      if (CONTAINER_EXTS.has(pExt)) return false;
    } catch {
      /* ignore invalid URL */
    }
  }
  return true;
};

export const extFromDownload = (url, contentType, audioBytes) => {
  const magic = audioBytes ? sniffContainerMagic(audioBytes) : null;
  if (magic && [".mp3", ".wav", ".ogg", ".m4a", ".webm"].includes(magic)) return magic;
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("mpeg") || ct.includes("mp3")) return ".mp3";
  if (ct.includes("wav")) return ".wav";
  if (ct.includes("ogg")) return ".ogg";
  if (ct.includes("webm")) return ".webm";
  if (ct.includes("mp4") || ct.includes("m4a")) return ".m4a";
  try {
    const pExt = extname(new URL(url).pathname).toLowerCase();
    if ([".mp3", ".wav", ".ogg", ".m4a", ".webm"].includes(pExt)) return pExt;
  } catch {
    /* fallback to mp3 */
  }
  return ".mp3";
};

export const summarizeTitle = (text, fallback) => {
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim().slice(0, 100);
  const plain = stripDialogueSpeakerBrackets(text)
    .replace(AUDIO_TAG_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "Untitled voice";
  return plain.length > 64 ? `${plain.slice(0, 61)}…` : plain;
};

export const sanitizeRemoteMediaUrl = (rawUrl, apiBase = DEFAULT_API_BASE) => {
  const raw = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:") return parsed.toString();
    const base = new URL(normalizeApiBase(apiBase));
    if (
      base.protocol === "http:" &&
      parsed.protocol === "http:" &&
      parsed.host === base.host &&
      (base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "::1")
    ) {
      return parsed.toString();
    }
    return "";
  } catch {
    return "";
  }
};

const PROVIDER_MODELS = [
  { model_id: "speech-2.8-hd", name: "MiniMax Speech 2.8 HD", credit_ratio: 1 },
  { model_id: "speech-2.8-turbo", name: "MiniMax Speech 2.8 Turbo", credit_ratio: 0.6 },
  {
    model_id: "capcut",
    name: "CapCut",
    credit_ratio: 0,
    languages: ["en", "vi", "zh", "id", "es", "pt", "ja", "th"],
  },
];
const catalogCreditRate = (value) => {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return;
  const rate = Number(value);
  if (Number.isFinite(rate) && rate >= 0) return rate;
};
const normalizeCatalogModel = (m, fallback) => {
  const provider = m.provider || providerForModel(m.model_id);
  const native = provider !== "elevenlabs";
  const providerRate =
    catalogCreditRate(m.model_rates?.character_cost_multiplier) ??
    catalogCreditRate(m.credit_ratio);
  const rate =
    providerRate ??
    catalogCreditRate(fallback?.model_rates?.character_cost_multiplier) ??
    catalogCreditRate(fallback?.credit_ratio);
  return {
    model_id: String(m.model_id ?? ""),
    provider,
    name: String(m.name ?? fallback?.name ?? m.model_id ?? ""),
    description: String(m.description || fallback?.description || ""),
    can_do_text_to_speech:
      m.can_do_text_to_speech !== undefined
        ? Boolean(m.can_do_text_to_speech)
        : native || Boolean(fallback?.can_do_text_to_speech),
    can_do_voice_conversion: Boolean(
      m.can_do_voice_conversion ?? fallback?.can_do_voice_conversion,
    ),
    can_use_style: Boolean(m.can_use_style ?? fallback?.can_use_style),
    can_use_speaker_boost: Boolean(m.can_use_speaker_boost ?? fallback?.can_use_speaker_boost),
    supports_context: native ? false : (m.supports_context ?? fallback?.supports_context),
    supports_speed: native || (m.supports_speed ?? fallback?.supports_speed),
    supports_similarity: native ? false : (m.supports_similarity ?? fallback?.supports_similarity),
    stability_values: Array.isArray(m.stability_values)
      ? m.stability_values
      : fallback?.stability_values,
    maximum_text_length_per_request:
      m.maximum_text_length_per_request ?? fallback?.maximum_text_length_per_request,
    model_rates: rate === undefined ? {} : { character_cost_multiplier: rate },
    ...(m !== fallback && providerRate !== undefined ? { rateSource: "provider" } : {}),
    languages: (Array.isArray(m.languages) && m.languages.length
      ? m.languages
      : (fallback?.languages ?? [])
    ).map((language) =>
      typeof language === "string"
        ? {
            language_id: language,
            name: BUILTIN_LANGUAGES.find((entry) => entry.code === language)?.name || language,
          }
        : language,
    ),
  };
};

/**
 * Stateful GenVoice HTTP client handling API key resolution, catalog caching, shared voice search, and task polling.
 */
export const openGenvoiceClient = ({
  fetchImpl,
  env,
  lookupFn,
  secretsFile,
  configFile,
  pollIntervalMs,
  maxPollMs,
  onEmit,
}) => {
  let cachedCatalog = null;
  let cachedAccount = null;

  const readOverrideConfig = () => {
    if (!existsSync(configFile)) return {};
    try {
      if (lstatSync(configFile).isSymbolicLink()) return {};
      const parsed = JSON.parse(readFileSync(configFile, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  const resolveKeyConfig = (override = readOverrideConfig()) => {
    const secretEnv = parseEnvFile(secretsFile);

    const overrideKey = typeof override.apiKey === "string" ? override.apiKey.trim() : "";
    const envKey = typeof env.GENVOICE_API_KEY === "string" ? env.GENVOICE_API_KEY.trim() : "";
    const fileKey =
      typeof secretEnv.GENVOICE_API_KEY === "string" ? secretEnv.GENVOICE_API_KEY.trim() : "";

    let apiKey = "";
    let source = "none";
    if (overrideKey) {
      apiKey = overrideKey;
      source = "override";
    } else if (envKey) {
      apiKey = envKey;
      source = "env";
    } else if (fileKey) {
      apiKey = fileKey;
      source = "secrets_file";
    }

    let apiBase = DEFAULT_API_BASE;
    for (const candidate of [
      secretEnv.GENVOICE_API_BASE,
      env.GENVOICE_API_BASE,
      override.apiBase,
    ]) {
      if (typeof candidate === "string" && candidate.trim()) {
        try {
          apiBase = normalizeApiBase(candidate);
        } catch {
          /* ignore invalid persisted candidate */
        }
      }
    }

    return {
      apiKey,
      apiBase,
      source,
      hasOverride: Boolean(overrideKey || override.apiBase),
    };
  };

  const genvoiceRequest = async (path, init = {}, overrideCfg = null) => {
    const cfg = overrideCfg ?? resolveKeyConfig();
    if (!cfg.apiKey) {
      const err = new Error(
        "Missing GenVoice API key. Configure GENVOICE_API_KEY or set it in Playground Key settings.",
      );
      err.status = 400;
      throw err;
    }
    const target = `${cfg.apiBase}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = {
      ...(init.headers && typeof init.headers === "object" && !(init.headers instanceof Headers)
        ? init.headers
        : init.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : {}),
      "xi-api-key": cfg.apiKey,
      accept: "application/json",
    };
    if (init.body && !(init.body instanceof FormData) && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
    let res;
    try {
      res = await fetchImpl(target, {
        ...init,
        headers,
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(45_000)])
          : AbortSignal.timeout(45_000),
      });
    } catch (err) {
      const wrapped = new Error(`GenVoice request failed: ${sanitizeError(err, cfg.apiKey)}`);
      wrapped.status = 502;
      throw wrapped;
    }
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const rawText = await res.text().catch(() => "");
    if (!ct.includes("application/json")) {
      const preview = sanitizeError(rawText.slice(0, 120), cfg.apiKey);
      const err = new Error(
        `GenVoice returned non-JSON (${ct || "unknown"}, HTTP ${res.status}) for ${path}: ${preview || "unsupported endpoint"}`,
      );
      err.status = res.ok ? 502 : res.status;
      throw err;
    }
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      const err = new Error(`Invalid JSON returned by GenVoice for ${path}`);
      err.status = 502;
      throw err;
    }
    if (!res.ok) {
      const msg =
        data?.detail?.message ??
        data?.detail ??
        data?.error ??
        data?.message ??
        `GenVoice API HTTP ${res.status}`;
      const err = new Error(sanitizeError(String(msg), cfg.apiKey));
      err.status = res.status;
      throw err;
    }
    return { data, cfg };
  };

  const fetchAccount = async (overrideCfg = null) => {
    const cfg = overrideCfg ?? resolveKeyConfig();
    if (!cfg.apiKey) {
      if (!overrideCfg) cachedAccount = null;
      return null;
    }
    const { data } = await genvoiceRequest("/auth/me", {}, overrideCfg);
    const rawBalance = data.credit_balance;
    const balance =
      typeof rawBalance === "number" || (typeof rawBalance === "string" && rawBalance.trim())
        ? Number(rawBalance)
        : NaN;
    const account = {
      id: String(data.id ?? ""),
      email: String(data.email ?? ""),
      name: String(data.name ?? ""),
      credit_balance: Number.isFinite(balance) && balance >= 0 ? balance : null,
      role: String(data.role ?? ""),
    };
    if (!overrideCfg) cachedAccount = account;
    return account;
  };

  const getStatus = async ({ live = false } = {}) => {
    const cfg = resolveKeyConfig();
    let account = cachedAccount;
    let error = null;
    if (live && cfg.apiKey) {
      try {
        account = await fetchAccount();
      } catch (err) {
        error = err.message;
      }
    }
    return {
      configured: Boolean(cfg.apiKey),
      source: cfg.source,
      maskedKey: maskApiKey(cfg.apiKey),
      apiBase: cfg.apiBase,
      hasOverride: cfg.hasOverride,
      account,
      ...(error ? { error } : {}),
    };
  };

  const setConfig = async ({ apiKey, apiBase, clearOverride = false } = {}) => {
    const cur = readOverrideConfig();
    const next = { ...cur };
    if (clearOverride) {
      delete next.apiKey;
      delete next.apiBase;
    } else {
      const incomingBase = typeof apiBase === "string" ? apiBase.trim() : "";
      const incomingKey = typeof apiKey === "string" ? apiKey.trim() : "";
      if (typeof apiBase === "string") {
        if (!incomingBase) {
          delete next.apiBase;
        } else {
          const safeBase = await assertSafeApiBase(incomingBase, lookupFn);
          if (safeBase !== DEFAULT_API_BASE && !incomingKey) {
            throw Object.assign(
              new Error(
                "Enter an explicit API key when setting a custom API base URL so stored keys are never sent to another host.",
              ),
              { status: 400 },
            );
          }
          next.apiBase = safeBase;
        }
      }
      if (typeof apiKey === "string") {
        if (!incomingKey) delete next.apiKey;
        else {
          if (!/^[!-~]{1,512}$/.test(incomingKey)) {
            throw Object.assign(
              new Error(
                "API key must contain only visible ASCII characters (no spaces or control chars)",
              ),
              { status: 400 },
            );
          }
          next.apiKey = incomingKey;
        }
      }
      if (next.apiBase && next.apiBase !== DEFAULT_API_BASE && !next.apiKey) {
        throw Object.assign(
          new Error(
            "A custom API base URL requires an explicit override API key and cannot fall back to env or secrets files.",
          ),
          { status: 400 },
        );
      }
    }
    const candidateCfg = resolveKeyConfig(next);
    let verifiedAccount = null;
    const validatingOverride =
      !clearOverride &&
      ((typeof apiKey === "string" && Boolean(apiKey.trim())) ||
        (typeof apiBase === "string" && Boolean(apiBase.trim())));
    if (validatingOverride) {
      if (!candidateCfg.apiKey) {
        throw Object.assign(
          new Error("Enter a GenVoice API key or configure GENVOICE_API_KEY before saving."),
          { status: 400 },
        );
      }
      try {
        verifiedAccount = await fetchAccount(candidateCfg);
      } catch (err) {
        throw Object.assign(
          new Error(
            `Could not verify GenVoice API key: ${sanitizeError(err, candidateCfg.apiKey)}`,
          ),
          { status: err?.status === 401 || err?.status === 403 ? err.status : 400 },
        );
      }
    }
    if (!Object.keys(next).length) {
      rmSync(configFile, { force: true });
    } else {
      writeAtomic(configFile, JSON.stringify(next, null, 2), { mode: 0o600 });
    }
    cachedCatalog = null;
    cachedAccount = verifiedAccount;
    const status = await getStatus({
      live: Boolean(resolveKeyConfig().apiKey) && !verifiedAccount,
    });
    onEmit?.({ type: "status", status });
    return status;
  };

  const downloadMediaWithRedirects = async (
    rawUrl,
    maxBytes,
    label,
    apiBase,
    lookup = lookupFn,
    signal,
  ) => {
    let cur = rawUrl;
    for (let hop = 0; hop < 4; hop++) {
      await assertSafeMediaUrl(cur, apiBase, lookup);
      signal?.throwIfAborted();
      const res = await fetchImpl(cur, {
        redirect: "manual",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
          : AbortSignal.timeout(60_000),
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) throw new Error(`${label} redirect missing location`);
        cur = new URL(loc, cur).toString();
        continue;
      }
      if (!res.ok) {
        throw new Error(`${label} download failed (HTTP ${res.status})`);
      }
      const bytes = await readBoundedBytes(res, maxBytes, label);
      return { bytes, url: cur, contentType: res.headers.get("content-type") ?? "" };
    }
    throw new Error(`${label} exceeded redirect limit`);
  };

  const getCatalog = async ({ refresh = false } = {}) => {
    const cfg = resolveKeyConfig();
    if (!refresh && cachedCatalog && Date.now() - cachedCatalog.fetchedAt < CATALOG_TTL_MS) {
      return cachedCatalog.data;
    }
    let models = [...BUILTIN_GENVOICE_MODELS, ...PROVIDER_MODELS].map((model) =>
      normalizeCatalogModel(model, model),
    );
    let languages = BUILTIN_LANGUAGES;
    const providerLanguages = { ...FALLBACK_PROVIDER_LANGUAGES, elevenlabs: languages };
    let defaultVoices = [];
    let liveSynced = false;
    let liveError = null;

    if (cfg.apiKey) {
      const [modelsRes, langsRes, voicesRes, minimaxRes, capcutRes, miniLangRes, capLangRes] =
        await Promise.allSettled([
          genvoiceRequest("/models"),
          genvoiceRequest("/languages"),
          genvoiceRequest("/default-voices?page_size=100"),
          genvoiceRequest("/models?provider=minimax"),
          genvoiceRequest("/models?provider=capcut"),
          genvoiceRequest("/languages?provider=minimax"),
          genvoiceRequest("/languages?provider=capcut"),
        ]);
      const errors = [];
      if (modelsRes.status === "fulfilled" && Array.isArray(modelsRes.value.data)) {
        const builtinById = new Map(BUILTIN_GENVOICE_MODELS.map((b) => [b.model_id, b]));
        const nextModels = modelsRes.value.data
          .map((m) => normalizeCatalogModel(m, builtinById.get(m?.model_id)))
          .filter((m) => m.model_id);
        if (nextModels.length) {
          models = [
            ...nextModels,
            ...BUILTIN_GENVOICE_MODELS.filter(
              (b) => !nextModels.some((m) => m.model_id === b.model_id),
            ),
          ];
          liveSynced = true;
        }
      } else if (modelsRes.status === "rejected") {
        errors.push(modelsRes.reason?.message || "Models sync failed");
      }
      if (langsRes.status === "fulfilled" && Array.isArray(langsRes.value.data)) {
        const nextLangs = langsRes.value.data
          .filter((l) => l && typeof l.code === "string" && typeof l.name === "string")
          .map((l) => ({ code: l.code, name: l.name }));
        if (nextLangs.length) languages = nextLangs;
      } else if (langsRes.status === "rejected") {
        errors.push(langsRes.reason?.message || "Languages sync failed");
      }
      if (voicesRes.status === "fulfilled" && Array.isArray(voicesRes.value.data?.voices)) {
        defaultVoices = voicesRes.value.data.voices
          .filter((v) => v && typeof v.voice_id === "string")
          .map((v) => {
            const lang = v.language ?? v.labels?.language;
            return {
              id: v.voice_id,
              provider: "elevenlabs",
              name: String(v.name ?? v.voice_id),
              category: String(v.category ?? "premade").toLowerCase(),
              description: String(v.description ?? ""),
              previewUrl: sanitizeRemoteMediaUrl(v.preview_url, cfg.apiBase),
              gender: String(v.gender ?? v.labels?.gender ?? ""),
              age: String(v.age ?? v.labels?.age ?? ""),
              accent: String(v.accent ?? v.labels?.accent ?? ""),
              useCase: String(v.use_case ?? v.labels?.use_case ?? ""),
              descriptive: String(v.descriptive ?? v.labels?.descriptive ?? ""),
              ...(typeof lang === "string" && lang.trim() ? { language: lang.trim() } : {}),
              source: "default",
            };
          });
      } else if (voicesRes.status === "rejected") {
        errors.push(voicesRes.reason?.message || "Voices sync failed");
      }
      for (const { result, provider } of [
        { result: minimaxRes, provider: "minimax" },
        { result: capcutRes, provider: "capcut" },
      ]) {
        if (result.status === "fulfilled" && Array.isArray(result.value.data)) {
          const incoming = result.value.data
            .filter((model) => providerForModel(model.model_id) === provider)
            .map((model) =>
              normalizeCatalogModel(
                { ...model, provider },
                PROVIDER_MODELS.find((entry) => entry.model_id === model.model_id),
              ),
            );
          const byId = new Map(models.map((model) => [model.model_id, model]));
          for (const model of incoming) byId.set(model.model_id, model);
          models = [...byId.values()];
        } else if (result.status === "rejected")
          errors.push(result.reason?.message || `${provider} models unavailable`);
      }
      providerLanguages.elevenlabs = languages;
      for (const { provider, result } of [
        { provider: "minimax", result: miniLangRes },
        { provider: "capcut", result: capLangRes },
      ]) {
        if (result.status === "fulfilled" && Array.isArray(result.value.data)) {
          const entries = result.value.data.filter(
            (language) =>
              language && typeof language.code === "string" && typeof language.name === "string",
          );
          if (entries.length)
            providerLanguages[provider] = entries.map((language) => ({
              ...language,
              code: provider === "minimax" ? language.name : language.code,
            }));
        } else if (result.status === "rejected")
          errors.push(result.reason?.message || `${provider} languages unavailable`);
      }
      for (const fallback of PROVIDER_MODELS)
        if (!models.some((model) => model.model_id === fallback.model_id))
          models.push(normalizeCatalogModel(fallback, fallback));
      if (errors.length) liveError = errors.join("; ");
    }

    const data = {
      models,
      languages,
      providerLanguages,
      defaultVoices,
      liveSynced,
      ...(liveError ? { error: liveError } : {}),
    };
    if (!liveError) cachedCatalog = { fetchedAt: Date.now(), data };
    return data;
  };

  const searchSharedVoices = async (queryParams = {}) => {
    const provider = queryParams.provider ?? "elevenlabs";
    if (!PROVIDER_IDS.includes(provider))
      throw Object.assign(new Error("Choose elevenlabs, minimax or capcut"), { status: 400 });
    const qs = new URLSearchParams();
    const rawPageSize = Number(queryParams.pageSize ?? queryParams.page_size ?? 50);
    const pageSize = Number.isFinite(rawPageSize)
      ? Math.min(100, Math.max(1, Math.trunc(rawPageSize)))
      : 50;
    const rawPage = Number(queryParams.page ?? 0);
    const page = Number.isFinite(rawPage) ? Math.max(0, Math.trunc(rawPage)) : 0;
    const useCases = String(queryParams.useCases ?? queryParams.useCase ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (provider !== "elevenlabs") {
      qs.set("page_size", String(pageSize));
      qs.set("page", String(page + 1));
      for (const key of [
        "search",
        "gender",
        "age",
        "accent",
        ...(provider === "capcut" ? ["emotion"] : []),
      ])
        if (typeof queryParams[key] === "string" && queryParams[key].trim())
          qs.set(key, queryParams[key].trim());
      if (queryParams.language)
        qs.set(
          "language",
          languageForProvider(provider, String(queryParams.language), BUILTIN_LANGUAGES),
        );
      if (provider === "minimax" && useCases.length) qs.set("use_cases", useCases.join(","));
      const { data } = await genvoiceRequest(`/${provider}/system-voices?${qs}`);
      const voices = (Array.isArray(data.voice_list) ? data.voice_list : [])
        .filter((voice) => voice && typeof voice.voice_id === "string")
        .map((voice) => {
          const tags = (
            Array.isArray(voice.tag_list)
              ? voice.tag_list
              : Array.isArray(voice.tags)
                ? voice.tags
                : []
          ).filter((tag) => typeof tag === "string");
          const language = String(voice.language || (provider === "minimax" ? tags[0] : "") || "");
          const gender = String(
            voice.gender ||
              tags.find((tag) => /^(male|female|non[- ]?binary|gender diversity)$/i.test(tag)) ||
              "",
          );
          const age = String(
            voice.age ||
              tags.find((tag) =>
                /^(young|youth|middle[- ]?aged|children?|elderly|old|baby|teenager)$/i.test(tag),
              ) ||
              "",
          );
          const accent = String(
            voice.accent ||
              (provider === "capcut"
                ? CAPCUT_TONES.find((tone) =>
                    tags.some((tag) => tag.trim().toLowerCase() === tone.toLowerCase()),
                  )
                : tags.find(
                    (tag) =>
                      tag !== language &&
                      /^(?:[a-z]{2}[- ]|US |Standard$|British$|American$|Australian$|Indian$)/i.test(
                        tag,
                      ),
                  )) ||
              "",
          );
          const emotion = String(
            voice.emotion ||
              tags.find((tag) =>
                /^(excited|plain|pleasure|shy|proud|admire|angery|angry|sad|disgust|flattery|fear|embarrassing|confused)$/i.test(
                  tag,
                ),
              ) ||
              "",
          );
          const useCase = String(
            voice.use_case ||
              (provider === "minimax"
                ? tags
                    .filter((tag) => ![language, gender, age, accent, emotion].includes(tag))
                    .join(" · ")
                : ""),
          );
          return {
            id: voice.voice_id,
            name: String(voice.voice_name || voice.name || voice.voice_id),
            provider,
            category: "system",
            language,
            gender,
            age,
            accent,
            emotion,
            useCase,
            descriptive: tags.join(" · "),
            description: String(voice.description || ""),
            previewUrl: sanitizeRemoteMediaUrl(
              voice.sample_audio || voice.preview_url,
              resolveKeyConfig().apiBase,
            ),
            source: "shared",
            ...(typeof voice.uniq_id === "string" ? { dubbingVoiceId: voice.uniq_id } : {}),
            ...(typeof voice.platform === "string" ? { sourcePlatform: voice.platform } : {}),
          };
        });
      return {
        voices,
        hasMore: data.has_more === true,
        ...(Number.isFinite(data.total) ? { total: data.total } : {}),
      };
    }
    qs.set("page_size", String(pageSize));
    qs.set("page", String(page));
    for (const k of ["search", "category", "gender", "age", "accent", "sort"]) {
      const val = queryParams[k];
      if (typeof val === "string" && val.trim()) qs.set(k, val.trim());
    }
    const reqLang =
      queryParams.requiredLanguages ?? queryParams.required_languages ?? queryParams.language;
    if (typeof reqLang === "string" && reqLang.trim()) {
      qs.set("required_languages", reqLang.trim());
    }
    for (const useCase of useCases) qs.append("use_cases[]", useCase);
    const { data } = await genvoiceRequest(`/shared-voices?${qs.toString()}`);
    const preview = (url) => sanitizeRemoteMediaUrl(url, resolveKeyConfig().apiBase);
    const voices = Array.isArray(data.voices)
      ? data.voices
          .filter((voice) => isSafeRemoteId(voice?.voice_id))
          .map((v) => {
            const verifiedLanguages = Array.isArray(v.verified_languages)
              ? v.verified_languages.flatMap((entry) => {
                  const code = entry?.language_id || entry?.language_code || entry?.locale;
                  if (typeof code !== "string" || !code) return [];
                  return [
                    {
                      code,
                      name: typeof entry.language === "string" ? entry.language : undefined,
                      modelId: typeof entry.model_id === "string" ? entry.model_id : undefined,
                      locale: typeof entry.locale === "string" ? entry.locale : undefined,
                      accent: typeof entry.accent === "string" ? entry.accent : undefined,
                      previewUrl: preview(entry.preview_url),
                    },
                  ];
                })
              : [];
            const metrics = Object.fromEntries(
              Object.entries({
                usage1y: v.usage_character_count_1y,
                usage7d: v.usage_character_count_7d,
                clones: v.cloned_by_count,
                addedAt: v.date_unix,
              }).filter(([, value]) => Number.isInteger(value) && value >= 0),
            );
            return {
              id: String(v.voice_id ?? ""),
              name: String(v.name ?? ""),
              ...(isSafeRemoteId(v.public_owner_id) ? { creatorId: v.public_owner_id } : {}),
              provider: "elevenlabs",
              category: String(v.category ?? "shared").toLowerCase(),
              useCase: String(v.use_case ?? ""),
              gender: String(v.gender ?? ""),
              age: String(v.age ?? ""),
              accent: String(v.accent ?? ""),
              descriptive: String(v.descriptive ?? ""),
              description: String(v.description ?? ""),
              previewUrl:
                preview(v.preview_url) ||
                verifiedLanguages.find(({ previewUrl }) => previewUrl)?.previewUrl ||
                "",
              ...(verifiedLanguages.length ? { verifiedLanguages } : {}),
              ...metrics,
              ...(typeof v.featured === "boolean" ? { featured: v.featured } : {}),
              ...(typeof v.live_moderation_enabled === "boolean"
                ? { liveModeration: v.live_moderation_enabled }
                : {}),
              ...(typeof v.rate === "number" && Number.isFinite(v.rate) && v.rate >= 0
                ? { rate: v.rate }
                : {}),
              ...(typeof v.free_users_allowed === "boolean" ? { free: v.free_users_allowed } : {}),
              language: String(v.language ?? ""),
              source: "shared",
            };
          })
      : [];
    return {
      voices,
      hasMore: Boolean(data.has_more),
      ...(typeof data.last_sort_id === "string" ? { pageToken: data.last_sort_id } : {}),
    };
  };

  const resolveModelMeta = async (modelId, catalog) => {
    const cat = catalog ?? (await getCatalog());
    return (
      cat.models.find((m) => m.model_id === modelId) ??
      BUILTIN_GENVOICE_MODELS.find((m) => m.model_id === modelId) ??
      BUILTIN_GENVOICE_MODELS[0]
    );
  };

  const pollGenvoiceTask = async ({ pollPath, job, onCharge }) => {
    const deadline = Date.now() + maxPollMs;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const { data, cfg } = await genvoiceRequest(pollPath);
      assertGenVoiceTaskIdentity(data, job.remoteTaskId);
      const progress = typeof data.progress === "number" ? data.progress : job.progress;
      job.status = data.status === "completed" ? "downloading" : data.status || "processing";
      job.progress = progress;
      if (Number.isFinite(data.credits_deducted) && data.credits_deducted >= 0) {
        job.creditsDeducted = data.credits_deducted;
        job.creditsSource = genVoiceTaskChargeSource(data.status);
        onCharge?.(job);
      }
      onEmit?.({ type: "job", job: { ...job } });
      if (data.status === "completed") return { data, cfg };
      if (isFailedGenVoiceTask(data.status)) {
        throw new Error(
          sanitizeError(
            data.detail_error || data.error || `GenVoice generation ${data.status}`,
            cfg.apiKey,
          ),
        );
      }
    }
    throw new Error(`GenVoice task ${job.remoteTaskId || job.id} timed out`);
  };

  return {
    resolveKeyConfig,
    genvoiceRequest,
    fetchAccount,
    getStatus,
    setConfig,
    getCatalog,
    searchSharedVoices,
    resolveModelMeta,
    downloadMediaWithRedirects,
    pollGenvoiceTask,
  };
};
