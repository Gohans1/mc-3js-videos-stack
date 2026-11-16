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

import { wavInfo } from "./sound.mjs";
import { sanitizeError } from "./voice-library.mjs";
import {
  AUDIO_TAG_RE,
  DANGEROUS_KEYS,
  detectTextLanguage,
  extractAudioTags,
  parseDialogueTurnNames,
  stripDialogueSpeakerBrackets,
} from "./voice-playground-text.mjs";
import { mp3Seconds } from "./voice.mjs";

export {
  AUDIO_TAG_RE,
  DANGEROUS_KEYS,
  detectTextLanguage,
  extractAudioTags,
  parseDialogueTurnNames,
  stripDialogueSpeakerBrackets,
};

export const DEFAULT_API_BASE = "https://api.genvoice.pro/v1";
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
export const MAX_SRT_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_STT_BYTES = 90 * 1024 * 1024;
export const CATALOG_TTL_MS = 10 * 60 * 1000;
export const SAFE_MEDIA_FILE = /^[A-Za-z0-9_-]{1,120}\.(mp3|wav|ogg|m4a|webm)$/;
export const SAFE_SRT_FILE = /^[A-Za-z0-9_-]{1,120}\.srt$/;
export const SAFE_REMOTE_ID_RE = /^(?!\.\.?$)[A-Za-z0-9._-]{1,200}$/;
export const isSafeRemoteId = (value) => typeof value === "string" && SAFE_REMOTE_ID_RE.test(value);

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

const isNonGlobalIpv4 = (a, b, c) =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 0 && c === 0) ||
  (a === 192 && b === 0 && c === 2) ||
  (a === 192 && b === 168) ||
  (a === 198 && (b === 18 || b === 19)) ||
  (a === 198 && b === 51 && c === 100) ||
  (a === 203 && b === 0 && c === 113) ||
  a >= 224;

const parseIpv6Groups = (raw) => {
  let addr = raw;
  let v4Tail = null;
  if (addr.includes(".")) {
    const lastColon = addr.lastIndexOf(":");
    if (lastColon < 0) return null;
    const octs = addr
      .slice(lastColon + 1)
      .split(".")
      .map(Number);
    if (octs.length !== 4 || octs.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
      return null;
    v4Tail = [(octs[0] << 8) | octs[1], (octs[2] << 8) | octs[3]];
    addr = addr.slice(0, lastColon);
    if (addr.endsWith(":")) addr += "0";
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parseSide = (s) =>
    s ? s.split(":").map((h) => (/^[0-9a-f]{1,4}$/i.test(h) ? Number.parseInt(h, 16) : -1)) : [];
  const left = parseSide(halves[0]);
  const right = halves.length === 2 ? parseSide(halves[1]) : [];
  if (left.includes(-1) || right.includes(-1)) return null;
  const targetGroups = v4Tail ? 6 : 8;
  let groups;
  if (halves.length === 2) {
    const fill = targetGroups - left.length - right.length;
    if (fill < 1) return null;
    groups = [...left, ...Array(fill).fill(0), ...right];
  } else {
    if (left.length !== targetGroups) return null;
    groups = left;
  }
  return v4Tail ? [...groups, ...v4Tail] : groups;
};

export const isNonGlobalIp = (rawAddr) => {
  const clean = rawAddr
    .replace(/^\[|\]$/g, "")
    .split("%")[0]
    .toLowerCase();
  const ver = isIP(clean);
  if (ver === 4) {
    const [a, b, c] = clean.split(".").map(Number);
    return isNonGlobalIpv4(a, b, c);
  }
  if (ver === 6) {
    const g = parseIpv6Groups(clean);
    if (!g || g.length !== 8) return true;
    const zeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    if (zeroPrefix && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;
    if (zeroPrefix && (g[5] === 0xffff || g[5] === 0)) {
      return isNonGlobalIpv4(g[6] >> 8, g[6] & 0xff, g[7] >> 8);
    }
    if (g[0] === 0x0064 && g[1] === 0xff9b) {
      return isNonGlobalIpv4(g[6] >> 8, g[6] & 0xff, g[7] >> 8);
    }
    if (g[0] === 0x2002) {
      return isNonGlobalIpv4(g[1] >> 8, g[1] & 0xff, g[2] >> 8);
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    if ((g[0] & 0xff00) === 0xff00) return true;
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
    return false;
  }
  return true;
};

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

export const sanitizeVoiceSettings = (raw, model) => {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
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
  ext === ".wav"
    ? "audio/wav"
    : ext === ".ogg"
      ? "audio/ogg"
      : ext === ".m4a"
        ? "audio/mp4"
        : ext === ".webm"
          ? "audio/webm"
          : "audio/mpeg";

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

const sniffContainerMagic = (audioBytes) => {
  const buf = Buffer.isBuffer(audioBytes) ? audioBytes : Buffer.from(audioBytes ?? []);
  if (buf.byteLength < 4) return null;
  const h4 = buf.subarray(0, 4).toString("ascii");
  if (h4 === "RIFF") return ".wav";
  if (h4 === "OggS") return ".ogg";
  if (h4 === "fLaC") return ".flac";
  if (h4 === "FORM") return ".aiff";
  if (buf.subarray(0, 3).toString("ascii") === "ID3") return ".mp3";
  if (buf.byteLength >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp") return ".m4a";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return ".webm";
  if (hasValidMpegSync(buf)) return ".mp3";
  return null;
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

const normalizeCatalogModel = (m, fallback) => ({
  model_id: String(m.model_id ?? ""),
  name: String(m.name ?? fallback?.name ?? m.model_id ?? ""),
  description: String(m.description || fallback?.description || ""),
  can_do_text_to_speech:
    m.can_do_text_to_speech !== undefined
      ? Boolean(m.can_do_text_to_speech)
      : Boolean(fallback?.can_do_text_to_speech),
  can_do_voice_conversion:
    m.can_do_voice_conversion !== undefined
      ? Boolean(m.can_do_voice_conversion)
      : Boolean(fallback?.can_do_voice_conversion),
  can_use_style:
    m.can_use_style !== undefined ? Boolean(m.can_use_style) : Boolean(fallback?.can_use_style),
  can_use_speaker_boost:
    m.can_use_speaker_boost !== undefined
      ? Boolean(m.can_use_speaker_boost)
      : Boolean(fallback?.can_use_speaker_boost),
  supports_context:
    typeof m.supports_context === "boolean" ? m.supports_context : fallback?.supports_context,
  supports_speed:
    typeof m.supports_speed === "boolean" ? m.supports_speed : fallback?.supports_speed,
  supports_similarity:
    typeof m.supports_similarity === "boolean"
      ? m.supports_similarity
      : fallback?.supports_similarity,
  stability_values: Array.isArray(m.stability_values)
    ? m.stability_values
    : fallback?.stability_values,
  maximum_text_length_per_request: Number(
    m.maximum_text_length_per_request ?? fallback?.maximum_text_length_per_request ?? 10000,
  ),
  model_rates: {
    character_cost_multiplier:
      Number(
        m.model_rates?.character_cost_multiplier ??
          fallback?.model_rates?.character_cost_multiplier ??
          1,
      ) || 1,
  },
  languages:
    Array.isArray(m.languages) && m.languages.length ? m.languages : (fallback?.languages ?? []),
});

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
        signal: init.signal ?? AbortSignal.timeout(45_000),
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
    const account = {
      id: String(data.id ?? ""),
      email: String(data.email ?? ""),
      name: String(data.name ?? ""),
      credit_balance: Number(data.credit_balance ?? 0),
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
  ) => {
    let cur = rawUrl;
    for (let hop = 0; hop < 4; hop++) {
      await assertSafeMediaUrl(cur, apiBase, lookup);
      const res = await fetchImpl(cur, {
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
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
    let models = BUILTIN_GENVOICE_MODELS;
    let languages = BUILTIN_LANGUAGES;
    let defaultVoices = [];
    let liveSynced = false;
    let liveError = null;

    if (cfg.apiKey) {
      const [modelsRes, langsRes, voicesRes] = await Promise.allSettled([
        genvoiceRequest("/models"),
        genvoiceRequest("/languages"),
        genvoiceRequest("/default-voices?page_size=100"),
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
      if (errors.length) liveError = errors.join("; ");
    }

    const data = {
      models,
      languages,
      defaultVoices,
      liveSynced,
      ...(liveError ? { error: liveError } : {}),
    };
    if (!liveError) cachedCatalog = { fetchedAt: Date.now(), data };
    return data;
  };

  const searchSharedVoices = async (queryParams = {}) => {
    const qs = new URLSearchParams();
    const rawPageSize = Number(queryParams.pageSize ?? queryParams.page_size ?? 50);
    const pageSize = Number.isFinite(rawPageSize)
      ? Math.min(100, Math.max(1, Math.trunc(rawPageSize)))
      : 50;
    const rawPage = Number(queryParams.page ?? 0);
    const page = Number.isFinite(rawPage) ? Math.max(0, Math.trunc(rawPage)) : 0;
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
    if (typeof queryParams.useCase === "string" && queryParams.useCase.trim()) {
      qs.append("use_cases[]", queryParams.useCase.trim());
    }
    const { data } = await genvoiceRequest(`/shared-voices?${qs.toString()}`);
    const voices = Array.isArray(data.voices)
      ? data.voices.map((v) => ({
          id: String(v.voice_id ?? ""),
          name: String(v.name ?? ""),
          category: String(v.category ?? "shared").toLowerCase(),
          useCase: String(v.use_case ?? ""),
          gender: String(v.gender ?? ""),
          age: String(v.age ?? ""),
          accent: String(v.accent ?? ""),
          descriptive: String(v.descriptive ?? ""),
          description: String(v.description ?? ""),
          previewUrl: sanitizeRemoteMediaUrl(v.preview_url, resolveKeyConfig().apiBase),
          rate: Number(v.rate ?? 1) || 1,
          free: Boolean(v.free_users_allowed),
          language: String(v.language ?? ""),
          source: "shared",
        }))
      : [];
    return { voices, hasMore: Boolean(data.has_more) };
  };

  const resolveModelMeta = async (modelId) => {
    const cat = await getCatalog();
    return (
      cat.models.find((m) => m.model_id === modelId) ??
      BUILTIN_GENVOICE_MODELS.find((m) => m.model_id === modelId) ??
      BUILTIN_GENVOICE_MODELS[0]
    );
  };

  const pollGenvoiceTask = async ({ pollPath, job }) => {
    const deadline = Date.now() + maxPollMs;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const { data, cfg } = await genvoiceRequest(pollPath);
      const progress = typeof data.progress === "number" ? data.progress : job.progress;
      job.status = data.status === "completed" ? "downloading" : data.status || "processing";
      job.progress = progress;
      onEmit?.({ type: "job", job: { ...job } });
      if (data.status === "completed") return { data, cfg };
      if (data.status === "failed") {
        throw new Error(
          sanitizeError(
            data.detail_error || data.error || "GenVoice generation failed",
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
