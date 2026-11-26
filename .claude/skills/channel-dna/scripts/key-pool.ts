import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface GmnKeyEntry {
  label: string;
  value: string;
}

export interface GmnDeadRecord {
  reason: string;
  at: string;
}

export interface GmnKeyStat {
  ok: number;
  fail: number;
  lastUsed?: string;
  lastError?: string;
}

export interface GmnStateFile {
  cursor: number;
  dead: Record<string, GmnDeadRecord>;
  until: Record<string, number>;
  stats: Record<string, GmnKeyStat>;
  [extra: string]: unknown;
}

export interface GmnPoolSnapshot {
  dir: string;
  configPath: string;
  statePath: string;
  keys: GmnKeyEntry[];
}

export type GeminiErrorKind = "dead" | "rate" | "capacity" | "model" | "other";
export type GeminiApiPhase =
  "upload_start" | "upload_transfer" | "file_poll" | "generate" | "stream";

export interface RawGeminiErrorJson {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: Array<{ reason?: string; retryDelay?: string }>;
  };
}

export class GeminiApiHttpError extends Error {
  readonly status: number;
  readonly kind: GeminiErrorKind;
  readonly summary: string;
  readonly retryAfterMs: number;
  readonly phase: GeminiApiPhase;

  constructor(opts: {
    message: string;
    status: number;
    kind: GeminiErrorKind;
    summary: string;
    retryAfterMs?: number;
    phase: GeminiApiPhase;
  }) {
    super(opts.message);
    this.name = "GeminiApiHttpError";
    this.status = opts.status;
    this.kind = opts.kind;
    this.summary = opts.summary;
    this.retryAfterMs = opts.retryAfterMs ?? 60_000;
    this.phase = opts.phase;
  }
}

const MAX_COOLDOWN_MS = 3_600_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const inFlightByPool = new Map<string, Set<string>>();
let tmpSeq = 0;

export function resolveKeyPoolDir(override?: string): string {
  const custom = override?.trim();
  if (custom) return resolve(custom);
  const envDir = process.env.GMN_CONFIG_DIR?.trim();
  if (envDir) return resolve(envDir);
  return join(homedir(), ".config", "gmn");
}

function emptyState(): GmnStateFile {
  return { cursor: 0, dead: {}, until: {}, stats: {} };
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return fallback;
  }
}

export function loadGmnKeyPool(overrideDir?: string): GmnPoolSnapshot {
  const dir = resolveKeyPoolDir(overrideDir);
  const configPath = join(dir, "config.json");
  const statePath = join(dir, "state.json");
  const raw = readJsonFile<{ keys?: unknown }>(configPath, { keys: [] });
  const keys: GmnKeyEntry[] = [];
  if (Array.isArray(raw.keys)) {
    for (const item of raw.keys) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { label?: unknown; value?: unknown };
      const label = typeof rec.label === "string" ? rec.label.trim() : "";
      const value = typeof rec.value === "string" ? rec.value.trim() : "";
      if (label && value) keys.push({ label, value });
    }
  }
  return { dir, configPath, statePath, keys };
}

export function loadGmnState(statePath: string): GmnStateFile {
  const raw = readJsonFile<Partial<GmnStateFile>>(statePath, emptyState());
  return {
    ...raw,
    cursor: typeof raw.cursor === "number" && Number.isFinite(raw.cursor) ? raw.cursor : 0,
    dead: raw.dead && typeof raw.dead === "object" && !Array.isArray(raw.dead) ? raw.dead : {},
    until: raw.until && typeof raw.until === "object" && !Array.isArray(raw.until) ? raw.until : {},
    stats: raw.stats && typeof raw.stats === "object" && !Array.isArray(raw.stats) ? raw.stats : {},
  };
}

function writeJsonAtomicWinSafe(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${tmpSeq++}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      renameSync(tmp, filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if ((code === "EPERM" || code === "EBUSY" || code === "EACCES") && attempt < 3) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
        continue;
      }
      rmSync(tmp, { force: true });
      throw err;
    }
  }
}

export function mutateGmnState(
  statePath: string,
  updater: (state: GmnStateFile) => void,
): GmnStateFile {
  const state = loadGmnState(statePath);
  updater(state);
  writeJsonAtomicWinSafe(statePath, state);
  return state;
}

export function getInFlightLabels(statePath: string): Set<string> {
  let set = inFlightByPool.get(statePath);
  if (!set) {
    set = new Set<string>();
    inFlightByPool.set(statePath, set);
  }
  return set;
}

export function rotationOrder(
  keys: readonly GmnKeyEntry[],
  cursor: number,
  inFlight?: ReadonlySet<string>,
): GmnKeyEntry[] {
  if (keys.length === 0) return [];
  const start = ((cursor % keys.length) + keys.length) % keys.length;
  const ordered = [...keys.slice(start), ...keys.slice(0, start)];
  if (!inFlight || inFlight.size === 0) return ordered;
  const idle: GmnKeyEntry[] = [];
  const busy: GmnKeyEntry[] = [];
  for (const key of ordered) {
    if (inFlight.has(key.label)) busy.push(key);
    else idle.push(key);
  }
  return [...idle, ...busy];
}

export function recordKeySuccess(
  statePath: string,
  keys: readonly GmnKeyEntry[],
  label: string,
): void {
  const keyIndex = keys.findIndex((k) => k.label === label);
  mutateGmnState(statePath, (state) => {
    const stat = (state.stats[label] ??= { ok: 0, fail: 0 });
    stat.ok++;
    stat.lastUsed = new Date().toISOString();
    if (keyIndex >= 0 && keys.length > 0) {
      state.cursor = (keyIndex + 1) % keys.length;
    }
  });
}

export function recordKeyFailure(
  statePath: string,
  label: string,
  kind: Exclude<GeminiErrorKind, "other">,
  summary: string,
  cooldownMs = DEFAULT_COOLDOWN_MS,
): void {
  const iso = new Date().toISOString();
  mutateGmnState(statePath, (state) => {
    const stat = (state.stats[label] ??= { ok: 0, fail: 0 });
    stat.fail++;
    stat.lastError = summary;
    stat.lastUsed = iso;
    if (kind === "dead") {
      state.dead[label] = { reason: summary, at: iso };
    } else if (kind === "rate") {
      state.until[label] = Date.now() + Math.min(Math.max(1_000, cooldownMs), MAX_COOLDOWN_MS);
    }
  });
}

export function extractGeminiErrorReason(parsed: RawGeminiErrorJson | null): string {
  const err = parsed?.error;
  const detail = err?.details?.find((d) => d.reason || d.retryDelay);
  return `${err?.status ?? ""} ${err?.message ?? ""} ${detail?.reason ?? ""}`.trim();
}

export function parseRetryAfterMs(
  headers: Headers | null,
  parsed: RawGeminiErrorJson | null,
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
  const retryDetail = parsed?.error?.details?.find((d) => typeof d.retryDelay === "string");
  const match = /^(\d+(?:\.\d+)?)s$/i.exec(retryDetail?.retryDelay?.trim() ?? "");
  if (match) {
    const ms = Math.round(Number(match[1]) * 1_000);
    if (Number.isFinite(ms) && ms > 0) {
      return Math.min(Math.max(1_000, ms), MAX_COOLDOWN_MS);
    }
  }
  return DEFAULT_COOLDOWN_MS;
}

export function classifyGeminiError(
  status: number,
  reasonText: string,
  phase: GeminiApiPhase,
): GeminiErrorKind {
  if (status === 401 || status === 403) return "dead";
  if (status === 400 && /API_KEY_INVALID|API key not valid|expired/i.test(reasonText))
    return "dead";
  if (status === 429) return "rate";
  if (status === 0 || status === 500 || status === 502 || status === 503 || status === 504) {
    return "capacity";
  }
  if (status === 404 && (phase === "generate" || phase === "stream")) return "model";
  return "other";
}

export function pickUsablePoolKey(pool: GmnPoolSnapshot, state: GmnStateFile): GmnKeyEntry | null {
  const now = Date.now();
  const ordered = rotationOrder(pool.keys, state.cursor, getInFlightLabels(pool.statePath));
  const ready = ordered.find((k) => !state.dead[k.label] && (state.until[k.label] ?? 0) <= now);
  if (ready) return ready;
  return ordered.find((k) => !state.dead[k.label]) ?? null;
}
