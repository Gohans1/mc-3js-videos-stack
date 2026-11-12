// ElevenLabs v4 & GenVoice client in Bun/TypeScript: zero external script path dependency, bounded async polling,
// prosody context stitching (previous_text / next_text + request-id chaining), character-to-word alignment, and Voice Changer (STS).
import { lookup as dnsLookup } from "node:dns/promises";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
    words.push({ w: cur, s: r3(wStart), e: r3(wEnd) });
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
    if (!cur) wStart = starts[i] ?? 0;
    cur += ch;
    wEnd = ends[i] ?? wStart;
  }
  flush();
  const dur = ends.length
    ? r3(Math.max(...ends.filter(Number.isFinite), 0))
    : (words.at(-1)?.e ?? 0);
  return { text: words.map((w) => w.w).join(" "), dur, words };
};

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 64;

const isNonGlobalIpv4 = (a: number, b: number, c: number): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 0 && (c === 0 || c === 2)) ||
  (a === 192 && b === 168) ||
  (a === 198 && (b === 18 || b === 19)) ||
  (a === 198 && b === 51 && c === 100) ||
  (a === 203 && b === 0 && c === 113) ||
  a >= 224;

const parseIpv6Groups = (raw: string): number[] | null => {
  let addr = raw;
  let v4Tail: number[] | null = null;
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
  const parseSide = (s: string) =>
    s ? s.split(":").map((h) => (/^[0-9a-f]{1,4}$/i.test(h) ? Number.parseInt(h, 16) : -1)) : [];
  const left = parseSide(halves[0]);
  const right = halves.length === 2 ? parseSide(halves[1]) : [];
  if (left.includes(-1) || right.includes(-1)) return null;
  const targetGroups = v4Tail ? 6 : 8;
  let groups: number[];
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

const isNonGlobalIp = (rawAddr: string): boolean => {
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
  if (!res.body) return new Uint8Array(0);
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
  writeFileSync(part, bytes);
  renameSync(part, target);
};

const supportsStitching = (model: string) => !model.startsWith("eleven_v3");

const resolveProvider = (
  opts: { provider?: "genvoice" | "elevenlabs"; apiKey?: string },
  env = process.env,
) => {
  const provider = opts.provider ?? (env.ELEVENLABS_API_KEY ? "elevenlabs" : "genvoice");
  const apiKey =
    opts.apiKey ?? (provider === "elevenlabs" ? env.ELEVENLABS_API_KEY : env.GENVOICE_API_KEY);
  if (!apiKey) {
    throw new Error(
      `Missing API key: set ${provider === "elevenlabs" ? "ELEVENLABS_API_KEY" : "GENVOICE_API_KEY"} in environment`,
    );
  }
  const apiBase = (
    provider === "elevenlabs"
      ? (env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io/v1")
      : (env.GENVOICE_API_BASE ?? "https://api.genvoice.pro/v1")
  ).replace(/\/+$/, "");
  return { provider, apiKey, apiBase };
};

const VIET_RE =
  /[ăâđêôơưĂÂĐÊÔƠƯáàãíìĩóòõúùũýỳỹÁÀÃÍÌĨÓÒÕÚÙŨÝỲỸ\u1EA0-\u1EF9]|[\u0306\u0309\u031B\u0323]/u;

export const detectLanguage = (text: string): "vi" | "en" =>
  VIET_RE.test(stripAudioTags(text)) ? "vi" : "en";

export const tts = async (opts: TtsOptions): Promise<TtsResult> => {
  const resolved = resolveProvider(opts, opts.env ?? process.env);
  const apiBase = (opts.apiBase ?? resolved.apiBase).replace(/\/+$/, "");
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
      fetch(
        `${apiBase}/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": resolved.apiKey, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
        },
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
      throw new Error(`ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const requestId = res.headers.get("request-id") ?? res.headers.get("x-request-id") ?? undefined;
    const payload = (await res.json()) as {
      audio_base64: string;
      alignment?: CharacterAlignment;
      normalized_alignment?: CharacterAlignment;
    };
    if (payload.audio_base64.length > MAX_BASE64_CHARS) {
      throw new Error(
        `ElevenLabs audio payload exceeds maximum size limit (${MAX_AUDIO_BYTES} bytes)`,
      );
    }
    atomicWrite(opts.out, new Uint8Array(Buffer.from(payload.audio_base64, "base64")));
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
    fetch(`${apiBase}/text-to-speech/${encodeURIComponent(opts.voiceId)}`, {
      method: "POST",
      headers: { "xi-api-key": resolved.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

  let res = await postJob({ ...baseBody, ...stitch });
  if ((res.status === 400 || res.status === 422) && Object.keys(stitch).length > 0) {
    res = await postJob(baseBody);
  }
  if (!res.ok)
    throw new Error(
      `GenVoice TTS create failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
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
    const poll = await fetch(`${apiBase}/history/${encodeURIComponent(task)}`, {
      headers: { "xi-api-key": resolved.apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!poll.ok) throw new Error(`GenVoice history poll failed (${poll.status})`);
    job = await poll.json();
    if (job?.status === "completed") break;
    if (job?.status === "failed")
      throw new Error(`GenVoice task ${task} failed: ${job.error ?? "unknown error"}`);
  }
  if (job?.status !== "completed" || !job.result?.audio_url) {
    throw new Error(
      `GenVoice task ${task} timed out after ${Math.round(maxPollMs / 1000)}s (last status: ${job?.status ?? "unknown"})`,
    );
  }
  const baseProto = new URL(apiBase).protocol;
  const audioUrl = new URL(job.result.audio_url);
  const allowLocalHttp = await assertSafeAudioUrl(audioUrl, baseProto, opts.lookup);
  const dl = await fetch(audioUrl, {
    redirect: allowLocalHttp ? "follow" : "error",
    signal: AbortSignal.timeout(120_000),
  });
  if (!dl.ok) throw new Error(`GenVoice audio download failed (${dl.status})`);
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
  const provider = opts.provider ?? (env.ELEVENLABS_API_KEY ? "elevenlabs" : "genvoice");
  if (provider !== "elevenlabs") {
    throw new Error(
      "Speech-to-Speech (Voice Changer) requires ELEVENLABS_API_KEY (api.genvoice.pro/v1 returns 405 on /speech-to-speech)",
    );
  }
  const apiKey = opts.apiKey ?? env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY for Speech-to-Speech (Voice Changer)");
  const apiBase = (
    opts.apiBase ??
    env.ELEVENLABS_API_BASE ??
    "https://api.elevenlabs.io/v1"
  ).replace(/\/+$/, "");

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

  const res = await fetch(
    `${apiBase}/speech-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok)
    throw new Error(`ElevenLabs STS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const requestId = res.headers.get("request-id") ?? undefined;
  atomicWrite(opts.out, await readBoundedBytes(res, MAX_AUDIO_BYTES, "ElevenLabs STS download"));
  rmSync(`${resolve(opts.out)}.words.json`, { force: true });
  return { provider: "elevenlabs", requestId };
};

const apiGet = async (path: string, params: Record<string, string> = {}) => {
  const { apiKey, apiBase } = resolveProvider({});
  const url = new URL(`${apiBase}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GET ${url.pathname} failed (${res.status})`);
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
