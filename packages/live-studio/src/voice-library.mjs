import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_GENVOICE_BASE = "https://api.genvoice.pro/v1";
const DEFAULT_ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const PAGE_SIZE = 100;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_PAGES = 500;
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_DESC_CHARS = 500;

let tmpSeq = 0;

const norm = (value) =>
  typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
    : "";

const nonNegInt = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;

const positiveRate = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;

const safeHttpsUrl = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) return "";
  try {
    const parsed = new URL(raw.trim());
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
};

const clampDescription = (raw) => {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length > MAX_DESC_CHARS ? `${s.slice(0, MAX_DESC_CHARS - 1)}…` : s;
};

const isValidCachedEntry = (entry) => {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.id !== "string" || !entry.id.trim()) return false;
  if (typeof entry.name !== "string" || !entry.name.trim()) return false;
  if (safeHttpsUrl(entry.previewUrl) !== entry.previewUrl) return false;
  return (
    typeof entry.category === "string" &&
    typeof entry.useCase === "string" &&
    typeof entry.gender === "string" &&
    typeof entry.age === "string" &&
    typeof entry.accent === "string" &&
    typeof entry.descriptive === "string" &&
    typeof entry.description === "string" &&
    typeof entry.v4 === "boolean" &&
    typeof entry.v4Post === "boolean" &&
    typeof entry.v4Turbo === "boolean" &&
    typeof entry.v4Fast === "boolean" &&
    typeof entry.rate === "number" &&
    Number.isFinite(entry.rate) &&
    entry.rate > 0 &&
    typeof entry.free === "boolean" &&
    typeof entry.usage1y === "number" &&
    typeof entry.usage7d === "number" &&
    typeof entry.clones === "number" &&
    typeof entry.likes === "number" &&
    typeof entry.featured === "boolean" &&
    typeof entry.addedAt === "number"
  );
};

const normalizeCachedEntry = (entry) => {
  const v4Post = Boolean(entry.v4Post);
  const v4Turbo = Boolean(entry.v4Turbo);
  const v4Fast = Boolean(entry.v4Fast);
  return {
    id: entry.id.trim(),
    name: entry.name.trim(),
    ...(typeof entry.creatorId === "string" ? { creatorId: entry.creatorId } : {}),
    category: norm(entry.category) || "other",
    useCase: norm(entry.useCase) || "other",
    gender: norm(entry.gender),
    age: norm(entry.age),
    accent: norm(entry.accent),
    descriptive: norm(entry.descriptive),
    description: clampDescription(entry.description),
    previewUrl: safeHttpsUrl(entry.previewUrl),
    v4: Boolean(entry.v4 || v4Post || v4Turbo || v4Fast),
    v4Post,
    v4Turbo,
    v4Fast,
    rate: positiveRate(entry.rate),
    free: Boolean(entry.free),
    usage1y: nonNegInt(entry.usage1y),
    usage7d: nonNegInt(entry.usage7d),
    clones: nonNegInt(entry.clones),
    likes: nonNegInt(entry.likes),
    featured: Boolean(entry.featured),
    addedAt: nonNegInt(entry.addedAt),
  };
};

export const sanitizeError = (err, secret = "") => {
  let msg = err instanceof Error ? err.message : String(err ?? "Sync failed");
  if (secret) msg = msg.split(secret).join("[redacted]");
  msg = msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
  msg = msg.replace(/("?xi-api-key"?[:=\s]+"?)[A-Za-z0-9._-]+/gi, "$1[redacted]");
  return msg.slice(0, 300);
};

export const defaultVoiceCacheFile = (project) => {
  const start = project ? resolve(project) : fileURLToPath(new URL("../../..", import.meta.url));
  for (let dir = start, prev = ""; dir !== prev; prev = dir, dir = dirname(dir)) {
    const vf = join(dir, "vault.json");
    if (!existsSync(vf)) continue;
    try {
      const cfg = JSON.parse(readFileSync(vf, "utf8"));
      const root = resolve(dir, typeof cfg?.root === "string" ? cfg.root : "vault");
      return join(root, "voices", "shared-en.json");
    } catch {
      return join(dir, "vault", "voices", "shared-en.json");
    }
  }
  const fallbackRoot = fileURLToPath(new URL("../../..", import.meta.url));
  return join(fallbackRoot, "vault", "voices", "shared-en.json");
};

const isEnglishTag = (value) => {
  const l = norm(value);
  return l === "en" || l.startsWith("en_");
};

export const normalizeSharedVoice = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.voice_id === "string" ? raw.voice_id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !name) return null;
  const languageTag = norm(raw.language) || norm(raw.locale);
  if (!isEnglishTag(languageTag)) return null;

  const verified = Array.isArray(raw.verified_languages) ? raw.verified_languages : [];
  let v4 = false;
  let v4Post = false;
  let v4Turbo = false;
  let v4Fast = false;
  let v4Preview = "";
  for (const entry of verified) {
    if (!entry || typeof entry !== "object") continue;
    if (!isEnglishTag(entry.language)) continue;
    const model = typeof entry.model_id === "string" ? entry.model_id.trim().toLowerCase() : "";
    if (!model.startsWith("eleven_v4")) continue;
    v4 = true;
    if (model === "eleven_v4_post_trained") v4Post = true;
    else if (model === "eleven_v4_turbo") v4Turbo = true;
    else if (model === "eleven_v4_fast") v4Fast = true;
    if (!v4Preview) v4Preview = safeHttpsUrl(entry.preview_url);
  }

  return {
    id,
    name,
    ...(typeof raw.public_owner_id === "string" ? { creatorId: raw.public_owner_id } : {}),
    category: norm(raw.category) || "other",
    useCase: norm(raw.use_case) || "other",
    gender: norm(raw.gender),
    age: norm(raw.age),
    accent: norm(raw.accent),
    descriptive: norm(raw.descriptive),
    description: clampDescription(raw.description),
    previewUrl: safeHttpsUrl(raw.preview_url) || v4Preview,
    v4,
    v4Post,
    v4Turbo,
    v4Fast,
    rate: positiveRate(raw.rate),
    free: Boolean(raw.free_users_allowed),
    usage1y: nonNegInt(raw.usage_character_count_1y),
    usage7d: nonNegInt(raw.usage_character_count_7d),
    clones: nonNegInt(raw.cloned_by_count),
    likes: nonNegInt(raw.liked_by_count),
    featured: Boolean(raw.featured),
    addedAt: nonNegInt(raw.date_unix),
  };
};

export const resolveProviderConfig = (opts = {}, env = process.env) => {
  const explicitGenvoice =
    opts.provider === "genvoice" ||
    (typeof opts.apiBase === "string" && opts.apiBase.includes("genvoice"));
  const explicitEleven =
    opts.provider === "elevenlabs" ||
    (typeof opts.apiBase === "string" && opts.apiBase.includes("elevenlabs"));
  const hasElevenEnv = Boolean(
    typeof env.ELEVENLABS_API_KEY === "string" && env.ELEVENLABS_API_KEY.trim(),
  );
  const provider =
    opts.provider ??
    (explicitGenvoice
      ? "genvoice"
      : explicitEleven
        ? "elevenlabs"
        : opts.apiKey
          ? "genvoice"
          : hasElevenEnv
            ? "elevenlabs"
            : "genvoice");

  const apiKey = (
    opts.apiKey ??
    (provider === "elevenlabs" ? env.ELEVENLABS_API_KEY : env.GENVOICE_API_KEY) ??
    ""
  ).trim();
  const baseRaw =
    opts.apiBase ??
    (provider === "elevenlabs"
      ? (env.ELEVENLABS_API_BASE ?? DEFAULT_ELEVENLABS_BASE)
      : (env.GENVOICE_API_BASE ?? DEFAULT_GENVOICE_BASE));
  const apiBase = String(baseRaw).replace(/\/+$/, "");

  const headers = { "xi-api-key": apiKey, accept: "application/json" };

  return { provider, apiKey, apiBase, headers };
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const jitter = (ms) => (ms <= 10 ? ms : Math.round(ms * (0.85 + Math.random() * 0.3)));

const retryDelay = (res, attempt, baseMs) => {
  const header = res?.headers?.get?.("retry-after");
  if (header !== null && header !== undefined && header.trim()) {
    const sec = Number(header);
    if (Number.isFinite(sec) && sec >= 0) {
      return jitter(Math.min(15_000, Math.round(sec * 1000)));
    }
    const at = Date.parse(header);
    if (Number.isFinite(at)) {
      return jitter(Math.min(15_000, Math.max(0, at - Date.now())));
    }
  }
  return jitter(Math.min(10_000, baseMs * 2 ** attempt));
};

const fetchSharedPage = async ({
  page,
  apiBase,
  apiKey,
  headers,
  fetchImpl,
  timeoutMs,
  maxRetries,
  retryDelayMs,
}) => {
  const url = `${apiBase}/shared-voices?page_size=${PAGE_SIZE}&page=${page}&language=en`;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep(jitter(Math.min(10_000, retryDelayMs * 2 ** attempt)));
        continue;
      }
      throw new Error(
        `Shared voices request failed on page ${page}: ${sanitizeError(err, apiKey)}`,
      );
    }

    const bodyText = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < maxRetries) {
      await sleep(retryDelay(res, attempt, retryDelayMs));
      continue;
    }
    const err = new Error(
      `Shared voices API ${res.status} on page ${page}: ${sanitizeError(bodyText || res.statusText, apiKey)}`,
    );
    err.status = res.status;
    throw err;
  }
  throw new Error(`Shared voices exhausted retries on page ${page}`);
};

const writeJsonAtomic = (file, value) => {
  const target = resolve(file);
  const part = `${target}.${process.pid}.${Date.now()}.${++tmpSeq}.part`;
  mkdirSync(dirname(target), { recursive: true });
  try {
    writeFileSync(part, JSON.stringify(value));
    renameSync(part, target);
  } catch (err) {
    rmSync(part, { force: true });
    throw err;
  }
};

export const syncVoiceCatalog = async (opts = {}) => {
  const env = opts.env ?? process.env;
  const { provider, apiKey, apiBase, headers } = resolveProviderConfig(opts, env);
  if (!apiKey) {
    throw new Error(
      `Missing API key: set ${provider === "elevenlabs" ? "ELEVENLABS_API_KEY" : "GENVOICE_API_KEY"}`,
    );
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const concurrency = Math.max(
    1,
    Math.min(12, Math.trunc(opts.concurrency ?? DEFAULT_CONCURRENCY)),
  );
  const maxPages = Math.max(1, Math.trunc(opts.maxPages ?? DEFAULT_MAX_PAGES));
  const timeoutMs = Math.max(1000, Math.trunc(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const maxRetries = Math.max(0, Math.trunc(opts.maxRetries ?? 4));
  const retryDelayMs = Math.max(1, Math.trunc(opts.retryDelayMs ?? 400));
  const cacheFile = resolve(opts.cacheFile ?? defaultVoiceCacheFile(opts.project));

  const seenIds = new Set();
  const voices = [];
  let totalScanned = 0;
  let totalEnglishV4 = 0;
  let pagesLoaded = 0;
  let truncatedByLoop = false;

  const ingestPage = (data) => {
    const rawList = Array.isArray(data?.voices) ? data.voices : [];
    pagesLoaded++;
    totalScanned += rawList.length;
    let addedUniqueIds = 0;
    for (const raw of rawList) {
      const id = typeof raw?.voice_id === "string" ? raw.voice_id.trim() : "";
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      addedUniqueIds++;
      const normalized = normalizeSharedVoice(raw);
      if (!normalized) continue;
      voices.push(normalized);
      if (normalized.v4) totalEnglishV4++;
    }
    if (rawList.length > 0 && addedUniqueIds === 0) {
      truncatedByLoop = true;
      return false;
    }
    return rawList.length > 0 && data?.has_more !== false;
  };

  const reportProgress = () => {
    opts.onProgress?.({
      pagesLoaded,
      totalScanned,
      totalEnglish: voices.length,
      totalEnglishV4,
    });
  };

  const reqOpts = { apiBase, apiKey, headers, fetchImpl, timeoutMs, maxRetries, retryDelayMs };
  const firstPage = await fetchSharedPage({ page: 0, ...reqOpts });
  let shouldContinue = ingestPage(firstPage);
  reportProgress();

  for (let nextPage = 1; shouldContinue && nextPage < maxPages;) {
    const end = Math.min(maxPages, nextPage + concurrency);
    const pageNums = [];
    for (let p = nextPage; p < end; p++) pageNums.push(p);
    const settled = await Promise.allSettled(
      pageNums.map((page) => fetchSharedPage({ page, ...reqOpts })),
    );
    let saw404 = false;
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        if (outcome.reason?.status === 404) {
          saw404 = true;
          shouldContinue = false;
          continue;
        }
        throw outcome.reason;
      }
      if (saw404) continue;
      shouldContinue = ingestPage(outcome.value);
      if (!shouldContinue) break;
    }
    reportProgress();
    nextPage = end;
  }

  const catalog = {
    version: 1,
    syncedAt: new Date().toISOString(),
    totalScanned,
    totalEnglish: voices.length,
    totalEnglishV4,
    truncated: Boolean(shouldContinue || truncatedByLoop),
    source: provider,
    voices,
  };
  writeJsonAtomic(cacheFile, catalog);
  return catalog;
};

const EMPTY_CATALOG = {
  version: 1,
  syncedAt: null,
  totalScanned: 0,
  totalEnglish: 0,
  totalEnglishV4: 0,
  truncated: false,
  source: null,
  voices: [],
};

export const openVoiceLibrary = (opts = {}) => {
  const env = opts.env ?? process.env;
  const cacheFile = resolve(opts.cacheFile ?? defaultVoiceCacheFile(opts.project));
  const autoSync = opts.autoSync ?? true;
  let diskCache = null;
  let activeSync = null;
  let status = "idle";
  let pagesLoaded = 0;
  let liveScanned = 0;
  let liveEnglish = 0;
  let liveEnglishV4 = 0;
  let lastError = null;
  let warmAttempted = false;
  let payloadMemo = null;

  const hasKey = () => Boolean(resolveProviderConfig(opts, env).apiKey);

  const readDisk = () => {
    try {
      if (!existsSync(cacheFile)) {
        diskCache = null;
        return null;
      }
      const st = statSync(cacheFile);
      if (diskCache && diskCache.mtimeMs === st.mtimeMs && diskCache.size === st.size) {
        return diskCache.catalog;
      }
      const parsed = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (
        !parsed ||
        (parsed.version !== undefined && parsed.version !== 1) ||
        !Array.isArray(parsed.voices)
      ) {
        diskCache = null;
        return null;
      }
      let voices = parsed.voices;
      for (let i = 0; i < parsed.voices.length; i++) {
        if (!isValidCachedEntry(parsed.voices[i])) {
          voices = parsed.voices
            .filter(
              (v) =>
                v &&
                typeof v === "object" &&
                typeof v.id === "string" &&
                v.id.trim() &&
                typeof v.name === "string" &&
                v.name.trim(),
            )
            .map(normalizeCachedEntry);
          break;
        }
      }
      const droppedRows = voices.length !== parsed.voices.length;
      const catalog = {
        version: 1,
        syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : null,
        totalScanned: nonNegInt(parsed.totalScanned),
        totalEnglish: droppedRows ? voices.length : nonNegInt(parsed.totalEnglish) || voices.length,
        totalEnglishV4:
          !droppedRows && parsed.totalEnglishV4 !== undefined
            ? nonNegInt(parsed.totalEnglishV4)
            : voices.reduce((n, v) => n + (v.v4 ? 1 : 0), 0),
        truncated: Boolean(parsed.truncated),
        source: typeof parsed.source === "string" ? parsed.source : null,
        voices,
      };
      diskCache = { mtimeMs: st.mtimeMs, size: st.size, catalog };
      return catalog;
    } catch {
      diskCache = null;
      return null;
    }
  };

  const state = () => {
    const disk = readDisk();
    const syncing = Boolean(activeSync || status === "syncing");
    const effectiveStatus = syncing ? "syncing" : disk ? "ready" : lastError ? "error" : "idle";
    return {
      status: effectiveStatus,
      syncedAt: disk?.syncedAt ?? null,
      totalScanned: syncing ? liveScanned : (disk?.totalScanned ?? 0),
      totalEnglish: syncing ? liveEnglish : (disk?.totalEnglish ?? 0),
      totalEnglishV4: syncing ? liveEnglishV4 : (disk?.totalEnglishV4 ?? 0),
      truncated: syncing ? false : Boolean(disk?.truncated),
      pagesLoaded: syncing ? pagesLoaded : 0,
      hasKey: hasKey(),
      error: lastError,
    };
  };

  const emit = () => {
    opts.onEvent?.(state());
  };

  const sync = () => {
    if (activeSync) return activeSync;
    status = "syncing";
    lastError = null;
    pagesLoaded = 0;
    liveScanned = 0;
    liveEnglish = 0;
    liveEnglishV4 = 0;

    let lastProgressEmit = 0;
    activeSync = syncVoiceCatalog({
      ...opts,
      env,
      cacheFile,
      onProgress: (p) => {
        pagesLoaded = p.pagesLoaded;
        liveScanned = p.totalScanned;
        liveEnglish = p.totalEnglish;
        liveEnglishV4 = p.totalEnglishV4;
        const now = Date.now();
        if (now - lastProgressEmit >= 400) {
          lastProgressEmit = now;
          emit();
        }
      },
    })
      .then((catalog) => {
        activeSync = null;
        status = "ready";
        lastError = null;
        warmAttempted = false;
        diskCache = null;
        payloadMemo = null;
        readDisk();
        emit();
        return catalog;
      })
      .catch((err) => {
        activeSync = null;
        status = "error";
        const { apiKey } = resolveProviderConfig(opts, env);
        lastError = sanitizeError(err, apiKey);
        payloadMemo = null;
        emit();
        throw err;
      });
    emit();
    return activeSync;
  };

  const ensureWarm = () => {
    const disk = readDisk();
    if (disk) return false;
    if (!autoSync || activeSync || warmAttempted || status === "error" || !hasKey()) return false;
    warmAttempted = true;
    sync().catch(() => {});
    return true;
  };

  const waitForSync = () =>
    activeSync ? activeSync : Promise.resolve(readDisk() ?? EMPTY_CATALOG);

  const payloadJson = () => {
    const disk = readDisk() ?? EMPTY_CATALOG;
    const s = state();
    const key = [
      s.status,
      s.syncedAt ?? "",
      diskCache?.mtimeMs ?? 0,
      diskCache?.size ?? 0,
      s.pagesLoaded,
      s.totalScanned,
      s.totalEnglish,
      s.totalEnglishV4,
      s.truncated ? 1 : 0,
      s.hasKey ? 1 : 0,
      s.error ?? "",
    ].join("|");
    if (payloadMemo?.key === key) return payloadMemo.json;
    const json = JSON.stringify({ ...s, voices: disk.voices });
    payloadMemo = { key, json };
    return json;
  };

  return {
    cacheFile,
    voices: () => readDisk()?.voices ?? EMPTY_CATALOG.voices,
    state,
    hasKey,
    ensureWarm,
    sync,
    waitForSync,
    payloadJson,
  };
};
