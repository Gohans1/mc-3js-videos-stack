import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildStratifiedQueue,
  isSafeVideoId,
  resolveQueueDurationOpts,
  writeJsonAtomic,
  writeTextAtomic,
} from "./collect.ts";
import {
  estimateUnifiedVideoTokens,
  expectedVideoTokensFloor,
  type FetchLike,
  normalizeMediaLabel,
  resolveGeminiApiKey,
  runGeminiApiVideo,
  toGeminiThinkingLevel,
  UNIFIED_TOKEN_SOFT_LIMIT,
} from "./gemini-api.ts";
import { parseAndValidateDossier } from "./schema.ts";
import type {
  AudioLoudnessMetrics,
  CatalogFile,
  CatalogVideo,
  CheckpointEntry,
  CheckpointFile,
  MinedVideoMeta,
} from "./types.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const ASK_SCRIPT = join(REPO_ROOT, ".claude/skills/aistudio/scripts/ask.ts");
const STUDIO_SCRIPT = join(REPO_ROOT, ".claude/skills/aistudio/scripts/studio.ts");
const DEFAULT_SYSTEM_PROMPT = resolve(SCRIPT_DIR, "../system/learn-channel-video.md");

const MONO_FONTS = [
  "C:/Windows/Fonts/consolab.ttf",
  "C:/Windows/Fonts/consola.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/System/Library/Fonts/Menlo.ttc",
];

const escapeFilterPath = (file: string): string =>
  file.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");

const fontOption = (): string => {
  const file = MONO_FONTS.find((candidate) => existsSync(candidate));
  return file ? `fontfile='${escapeFilterPath(file)}'` : "font='monospace'";
};

let burnSeq = 0;

export interface CmdResult {
  status: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type HaltReason = "none" | "quota" | "bot_or_auth" | "media_downgrade";
export type MineBackend = "aistudio" | "gemini-api";

export function isQuotaError(message: string): boolean {
  return /quota|rate limit|limit reached|resource[_ ]exhausted|daily limit|usage limit|too many requests|\b(?:http|status|code|error)\s*[:=]?\s*429\b/i.test(
    message,
  );
}

export function isBotOrRateBlock(message: string): boolean {
  return /sign in to confirm you.?re not a bot|confirm you.?re not a bot|http error 403|\bhttp\s+(?:401|403)\b|\bunauthenticated\b|\bpermission_denied\b|api[_ ]key[_ ]invalid|api key not valid|requires gemini_api_key|gemini api auth failed|all keys in pool are disabled|no usable api key|\bipblocked\b|\bsigned out\b/i.test(
    message,
  );
}

export function isMediaDowngradeError(message: string): boolean {
  return /silently downgraded|could not be verified|VIDEO_SAMPLING_TOO_SPARSE|AUDIO_UNAVAILABLE|degraded 1fps|degraded low-fps|missing audio track/i.test(
    message,
  );
}

export function shouldHaltBatch(message: string): boolean {
  return isQuotaError(message) || isBotOrRateBlock(message) || isMediaDowngradeError(message);
}

export function classifyHaltReason(message: string): HaltReason {
  if (isQuotaError(message)) return "quota";
  if (isBotOrRateBlock(message)) return "bot_or_auth";
  if (isMediaDowngradeError(message)) return "media_downgrade";
  return "none";
}

export function isTabBusyGenerating(stderr: string): boolean {
  return /the tab is still generating in\b/i.test(stderr);
}

export function didSubmitCurrentVideo(stderr: string): boolean {
  return /✓\s+\[\d+\/\d+\]\s+run:|→\s+\[\d+\/\d+\]\s+(?:wait for answer|copy answer)/i.test(stderr);
}

export function isTerminalRunAbort(stderr: string): boolean {
  return /stopped after thoughts|stopped without an answer|the answer is empty|has no answer|ai studio says:|copied nothing|silently downgraded|could not be verified/i.test(
    stderr,
  );
}

export function formatMineOutcome(
  channel: string,
  result: {
    done: number;
    failed: number;
    quotaHalted: boolean;
    haltReason: HaltReason;
    processed: string[];
  },
  minSchema = 1,
  backend: MineBackend = "aistudio",
  retryMinSchema = minSchema,
  retrySchemaFlag: "--min-schema" | "--upgrade-below" = "--min-schema",
): { exitCode: 0 | 1; summaryLine: string; nextLine: string } {
  const exitCode: 0 | 1 = result.done === 0 && (result.failed > 0 || result.quotaHalted) ? 1 : 0;
  const summaryLine = `mined batch finished: done=${result.done}, failed=${result.failed}, quotaHalted=${result.quotaHalted}, haltReason=${result.haltReason}, ids=${result.processed.join(",") || "none"}`;
  const aggSchemaFlag = minSchema > 1 ? ` --min-schema ${minSchema}` : "";
  const mineSchemaFlag = retryMinSchema > 1 ? ` ${retrySchemaFlag} ${retryMinSchema}` : "";
  const backendFlag = backend === "gemini-api" ? " --backend gemini-api" : "";
  let nextLine = `next: bun .claude/skills/channel-dna/scripts/cli.ts aggregate --channel ${channel}${aggSchemaFlag}`;
  if (result.done === 0 && result.quotaHalted) {
    if (result.haltReason === "bot_or_auth") {
      nextLine =
        backend === "gemini-api"
          ? `next: check Gemini API auth (or YouTube --cookies-from-browser chrome), then re-run mine --channel ${channel}${backendFlag}${mineSchemaFlag}`
          : `next: authenticate YouTube (--cookies-from-browser chrome or --cookies <file>) or AI Studio (bun .claude/skills/aistudio/scripts/studio.ts chrome --show), then re-run mine --channel ${channel}${mineSchemaFlag}`;
    } else if (result.haltReason === "media_downgrade") {
      nextLine =
        backend === "gemini-api"
          ? `next: 24 FPS / High-res or audio delivery was downgraded or unverified by Gemini API; inspect model settings and re-run mine --channel ${channel}${backendFlag}${mineSchemaFlag}`
          : `next: 24 FPS / High-res or audio delivery was silently downgraded by AI Studio; wait for AI Studio fix or rerun mine --channel ${channel} --backend gemini-api${mineSchemaFlag}`;
    } else {
      nextLine = `next: wait for model quota reset (or switch --model), then re-run mine --channel ${channel}${backendFlag}${mineSchemaFlag}`;
    }
  } else if (result.done === 0 && result.failed > 0) {
    nextLine = `next: inspect raw-failed-a*.md under .claude/skills/${channel}/references/corpus/videos/ and re-run mine --channel ${channel}${backendFlag}${mineSchemaFlag} --retry-failed`;
  }
  return { exitCode, summaryLine, nextLine };
}

export function buildAskNewArgs(opts: {
  tcMp4: string;
  imagePath?: string;
  userPrompt: string;
  tab: string;
  model: string;
  thinking: string;
  media: string;
  fps: number;
  systemFile: string;
  outMd: string;
  minInTokens?: number;
}): string[] {
  const canonicalMedia = normalizeMediaLabel(opts.media);
  return [
    "bun",
    ASK_SCRIPT,
    ...(opts.imagePath ? [opts.imagePath] : []),
    opts.tcMp4,
    opts.userPrompt,
    "--tab",
    opts.tab,
    "--model",
    opts.model,
    "--thinking",
    opts.thinking,
    "--media",
    canonicalMedia,
    "--fps",
    String(opts.fps),
    "--tool",
    "search=off",
    "--system-file",
    opts.systemFile,
    ...(opts.minInTokens && opts.minInTokens > 0
      ? ["--min-in-tokens", String(opts.minInTokens)]
      : []),
    "--out",
    opts.outMd,
    "--run-timeout-min",
    "15",
  ];
}

export function summarizeAskErr(res: CmdResult): string {
  return res.timedOut
    ? "ask.ts timed out"
    : res.stderr
        .split(/\r?\n/)
        .filter((l) =>
          /failed|error|says:|✗\s+input:|quota|rate limit|signed out|not a bot|403|429/i.test(l),
        )
        .slice(-3)
        .join(" | ") || `ask.ts exit ${res.status}`;
}

export interface AskAttemptState {
  submittedOnTab: boolean;
  chatUrl: string | null;
}

export async function executeAskAttempt(
  state: AskAttemptState,
  runners: {
    runNew: () => Promise<CmdResult>;
    runCollect: () => Promise<CmdResult>;
    drainOrphan: () => Promise<CmdResult>;
    hasOutput: () => boolean;
  },
): Promise<{ ok: boolean; error?: string; ask: CmdResult }> {
  if (state.submittedOnTab) {
    const collected: CmdResult = await runners.runCollect();
    if (!collected.timedOut && collected.status === 0 && runners.hasOutput()) {
      state.chatUrl = extractChatUrl(collected.stderr) ?? state.chatUrl;
      state.submittedOnTab = false;
      return { ok: true, ask: collected };
    }
    if (!/holds no ai studio chat/i.test(collected.stderr)) {
      state.submittedOnTab =
        !isTerminalRunAbort(collected.stderr) &&
        (collected.timedOut ||
          /wait for answer failed|copy answer failed|still generating/i.test(collected.stderr));
      return { ok: false, error: summarizeAskErr(collected), ask: collected };
    }
    state.submittedOnTab = false;
  }

  state.chatUrl = null;
  let ask: CmdResult = await runners.runNew();
  if (
    (ask.timedOut || ask.status !== 0 || !runners.hasOutput()) &&
    isTabBusyGenerating(ask.stderr)
  ) {
    state.chatUrl = null;
    state.submittedOnTab = false;
    const drain: CmdResult = await runners.drainOrphan();
    if (drain.timedOut || drain.status !== 0) {
      return { ok: false, error: `orphan drain failed: ${summarizeAskErr(drain)}`, ask: drain };
    }
    state.chatUrl = null;
    ask = await runners.runNew();
  }

  if (!ask.timedOut && ask.status === 0 && runners.hasOutput()) {
    state.chatUrl = extractChatUrl(ask.stderr) ?? state.chatUrl;
    state.submittedOnTab = false;
    return { ok: true, ask };
  }

  if (didSubmitCurrentVideo(ask.stderr) && !isTerminalRunAbort(ask.stderr)) {
    state.chatUrl = extractChatUrl(ask.stderr) ?? state.chatUrl;
    state.submittedOnTab = true;
  } else {
    state.submittedOnTab = false;
  }
  return { ok: false, error: summarizeAskErr(ask), ask };
}

export function shouldRecordFailure(
  prevEntry: CheckpointEntry | undefined,
  vidDir: string,
  hitQuota: boolean,
): boolean {
  if (hitQuota) return false;
  if (
    prevEntry?.status === "done" &&
    existsSync(join(vidDir, "dossier.md")) &&
    existsSync(join(vidDir, "telemetry.json"))
  ) {
    return false;
  }
  return true;
}

function readOnDiskSchemaVersion(corpusDir: string, id: string): number {
  const telPath = join(corpusDir, "videos", id, "telemetry.json");
  if (!existsSync(telPath)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(telPath, "utf8")) as { schema_version?: unknown };
    return typeof parsed.schema_version === "number" ? parsed.schema_version : 0;
  } catch {
    return 0;
  }
}

export function selectMineTargets(
  catalog: CatalogFile,
  ck: CheckpointFile,
  corpusDir: string,
  opts: {
    ids?: string[];
    limit: number;
    retryFailed?: boolean;
    minSchema?: number;
    upgradeBelow?: number;
  },
): string[] {
  const byId = new Map<string, CatalogVideo>(catalog.videos.map((v) => [v.id, v]));
  const candidateIds: string[] = [];
  if (opts.ids && opts.ids.length > 0) {
    const seen = new Set<string>();
    for (const rawId of opts.ids) {
      const id = rawId.trim();
      if (!id || seen.has(id)) continue;
      if (!isSafeVideoId(id)) throw new Error(`invalid video id "${id}"`);
      if (!byId.has(id)) throw new Error(`video id ${id} not found in catalog.json`);
      seen.add(id);
      candidateIds.push(id);
    }
    return candidateIds.slice(0, opts.limit);
  }

  const upgradeBelow = opts.upgradeBelow ?? opts.minSchema ?? 1;
  const queuePath = join(corpusDir, "queue.json");
  const parsedQueue = existsSync(queuePath)
    ? (JSON.parse(readFileSync(queuePath, "utf8")) as {
        queue?: string[];
        minDurationSec?: number;
        maxDurationSec?: number;
      })
    : null;
  const queueDurationOpts = resolveQueueDurationOpts(catalog, parsedQueue);
  const baseQueue = parsedQueue
    ? (parsedQueue.queue ?? [])
    : buildStratifiedQueue(catalog.videos, new Set(), queueDurationOpts);
  const upgradeIds =
    upgradeBelow > 1
      ? buildStratifiedQueue(catalog.videos, new Set(), queueDurationOpts).filter(
          (id) =>
            ck.entries[id]?.status === "done" &&
            readOnDiskSchemaVersion(corpusDir, id) < upgradeBelow,
        )
      : [];
  const queueIds = [...upgradeIds, ...baseQueue];
  const seen = new Set<string>();
  for (const id of queueIds) {
    if (seen.has(id) || !isSafeVideoId(id) || !byId.has(id)) continue;
    seen.add(id);
    const prev = ck.entries[id];
    if (prev?.status === "done" && readOnDiskSchemaVersion(corpusDir, id) >= upgradeBelow) continue;
    if (prev?.status === "failed" && !opts.retryFailed) continue;
    candidateIds.push(id);
    if (candidateIds.length >= opts.limit) break;
  }
  return candidateIds;
}

async function runAsyncCmd(cmd: string[], timeoutMs: number): Promise<CmdResult> {
  const proc = Bun.spawn(cmd, {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {}
  }, timeoutMs);
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { status, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

function parseFpsFraction(raw?: string): number {
  if (!raw) return 0;
  const parts = raw.split("/");
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    const fps = Number.isFinite(num) && Number.isFinite(den) && den > 0 ? num / den : 0;
    return fps > 0 && fps <= 240 ? fps : 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 240 ? n : 0;
}

const medianNum = (arr: number[]): number | null => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export function parseAudioLoudnessStderr(
  stderr: string,
  durationSec?: number | null,
): AudioLoudnessMetrics | null {
  const summaryIdx = stderr.lastIndexOf("Summary:");
  if (summaryIdx < 0) return null;
  const body = stderr.slice(0, summaryIdx);
  const tail = stderr.slice(summaryIdx);
  const iMatch = tail.match(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/i);
  const lraMatch = tail.match(/\bLRA:\s*(-?\d+(?:\.\d+)?)\s*LU/i);
  const peakMatch = tail.match(/\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/i);
  const silMatches = [...stderr.matchAll(/silence_duration:\s*(\d+(?:\.\d+)?)/gi)];
  const totalSilenceSec = Number(
    silMatches.reduce((sum, m) => sum + Number(m[1] ?? 0), 0).toFixed(2),
  );
  const integratedLufs = iMatch ? Number(iMatch[1]) : null;
  const loudnessRangeLu = lraMatch ? Number(lraMatch[1]) : null;
  const truePeakDbtp = peakMatch ? Number(peakMatch[1]) : null;
  if (integratedLufs === null && loudnessRangeLu === null && truePeakDbtp === null) return null;
  const isSilentTrack =
    (integratedLufs !== null && integratedLufs <= -69.5) || truePeakDbtp === null;

  const samples: Array<{ t: number; m: number | null; s: number | null }> = [];
  for (const line of body.split(/\r?\n/)) {
    const tm = /\bt:\s*(\d+(?:\.\d+)?)\b/.exec(line);
    if (!tm) continue;
    const t = Number(tm[1]);
    if (!Number.isFinite(t)) continue;
    const mm = /\bM:\s*(-?\d+(?:\.\d+)?)\b/.exec(line);
    const sm = /\bS:\s*(-?\d+(?:\.\d+)?)\b/.exec(line);
    const mVal = mm ? Number(mm[1]) : null;
    const sVal = sm ? Number(sm[1]) : null;
    samples.push({
      t,
      m: mVal !== null && Number.isFinite(mVal) && mVal > -70 ? mVal : null,
      s: sVal !== null && Number.isFinite(sVal) && sVal > -70 ? sVal : null,
    });
  }
  const mVals = samples.map((x) => x.m).filter((x): x is number => x !== null);
  const sVals = samples.map((x) => x.s).filter((x): x is number => x !== null);
  const maxMomentaryLufs = mVals.length > 0 ? Number(Math.max(...mVals).toFixed(1)) : null;
  const maxShortTermLufs = sVals.length > 0 ? Number(Math.max(...sVals).toFixed(1)) : null;
  const plrDb =
    !isSilentTrack && truePeakDbtp !== null && integratedLufs !== null
      ? Number((truePeakDbtp - integratedLufs).toFixed(1))
      : null;

  const totalDur =
    durationSec && durationSec > 0
      ? durationSec
      : samples.length > 0
        ? Math.max(...samples.map((x) => x.t))
        : 0;
  let climaxLoudnessDeltaLu: number | null = null;
  let relativeDropCount: number | null = null;
  if (!isSilentTrack && samples.length >= 10 && totalDur >= 6 && integratedLufs !== null) {
    const midM = samples
      .filter((x) => x.m !== null && x.t >= totalDur * 0.25 && x.t <= totalDur * 0.75)
      .map((x) => x.m!);
    const lateEnd = Math.max(totalDur * 0.75 + 0.5, totalDur - 1.0);
    const lateM = samples
      .filter((x) => x.m !== null && x.t > totalDur * 0.75 && x.t <= lateEnd)
      .map((x) => x.m!);
    const medMid = medianNum(midM);
    const medLate = medianNum(lateM);
    if (medMid !== null && medLate !== null) {
      climaxLoudnessDeltaLu = Number((medLate - medMid).toFixed(2));
    }
    const dropThreshold = integratedLufs - 12;
    let drops = 0;
    let runStart: number | null = null;
    let lastSampleT = 0;
    for (const x of samples) {
      if (x.t > lastSampleT) lastSampleT = x.t;
      if (x.t < 0.5 || x.t > totalDur - 1.2) {
        if (runStart !== null && Math.min(x.t, totalDur - 1.2) - runStart >= 0.2 - 1e-6) drops++;
        runStart = null;
        continue;
      }
      const isDropped = x.m === null || x.m <= dropThreshold;
      if (isDropped) {
        if (runStart === null) runStart = x.t;
      } else {
        if (runStart !== null && x.t - runStart >= 0.2 - 1e-6) drops++;
        runStart = null;
      }
    }
    if (runStart !== null && Math.min(lastSampleT, totalDur - 1.2) - runStart >= 0.2 - 1e-6) {
      drops++;
    }
    relativeDropCount = drops;
  }

  return {
    integratedLufs,
    loudnessRangeLu,
    truePeakDbtp,
    maxShortTermLufs,
    maxMomentaryLufs,
    plrDb,
    climaxLoudnessDeltaLu,
    relativeDropCount,
    isSilentTrack,
    silenceCount: silMatches.length,
    totalSilenceSec,
  };
}

async function measureAudioLoudness(
  source: string,
  durationSec?: number | null,
): Promise<AudioLoudnessMetrics | null> {
  const timeoutMs =
    durationSec && durationSec > 0
      ? Math.max(60_000, Math.min(300_000, Math.round(durationSec * 150)))
      : 60_000;
  try {
    const res = await runAsyncCmd(
      [
        "ffmpeg",
        "-nostdin",
        "-v",
        "info",
        "-i",
        source,
        "-vn",
        "-af",
        "ebur128=peak=true,silencedetect=n=-40dB:d=0.15",
        "-f",
        "null",
        "-",
      ],
      timeoutMs,
    );
    if (res.timedOut || res.status !== 0) return null;
    return parseAudioLoudnessStderr(res.stderr, durationSec);
  } catch {
    return null;
  }
}

export async function burnTimecode720(
  source: string,
  outPath: string,
  opts?: { macroOutputFps?: number },
): Promise<{
  hasAudioStream: boolean;
  durationSec: number;
  sourceFps: number;
  encodedFps: number;
  hasFrameCounter: boolean;
  sourceWidth: number;
  sourceHeight: number;
  audioMetrics: AudioLoudnessMetrics | null;
}> {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,start_time,avg_frame_rate,r_frame_rate:stream_disposition=attached_pic:stream_side_data=rotation:format=start_time,duration",
      "-of",
      "json",
      source,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 60_000 },
  );
  if (probe.status !== 0) {
    throw new Error(`ffprobe failed on ${source}: ${(probe.stderr || "").trim()}`);
  }
  const info = JSON.parse(probe.stdout) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      start_time?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      disposition?: { attached_pic?: number };
      side_data_list?: Array<{ rotation?: number }>;
    }>;
    format?: { start_time?: string; duration?: string };
  };
  const video = info.streams?.find(
    (s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1,
  );
  const audio = info.streams?.find((s) => s.codec_type === "audio");
  if (!video?.width || !video?.height) {
    throw new Error(`no video stream in ${source}`);
  }
  const rotation = Number(
    video.side_data_list?.find((x) => x?.rotation !== undefined)?.rotation ?? 0,
  );
  const rotated = Math.abs(rotation) % 180 === 90;
  const dispW = rotated ? video.height : video.width;
  const dispH = rotated ? video.width : video.height;
  const minSide = Math.min(dispW, dispH);
  const scale = minSide > 720 ? 720 / minSide : 1;
  const outW = 2 * Math.ceil((dispW * scale) / 2);
  const picH = 2 * Math.ceil((dispH * scale) / 2);
  const barH = Math.max(28, 2 * Math.round(picH * 0.028));
  const outH = picH + barH;
  const margin = Math.max(8, Math.round(outW * 0.02));
  const fontSize = Math.max(
    10,
    Math.min(Math.round(barH * 0.62), Math.floor((outW - 2 * margin) / 24)),
  );
  const labelFontSize = Math.max(8, Math.round(fontSize * 0.8));
  const origin = Number(video.start_time ?? info.format?.start_time ?? 0);
  const ptsExpr =
    Number.isFinite(origin) && Math.abs(origin) > 1e-6
      ? `%{pts\\:hms\\:${(-origin).toFixed(6)}}`
      : "%{pts\\:hms}";
  const font = fontOption();
  const yExpr = `h-${barH}+(${barH}-text_h)/2`;

  const rawDuration = Number(info.format?.duration ?? 0);
  const durationSec = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
  const sourceFps =
    parseFpsFraction(video.avg_frame_rate) || parseFpsFraction(video.r_frame_rate) || 0;
  const requestedMacroFps =
    typeof opts?.macroOutputFps === "number" &&
    Number.isFinite(opts.macroOutputFps) &&
    opts.macroOutputFps >= 0.5 &&
    opts.macroOutputFps <= 24
      ? opts.macroOutputFps
      : null;
  const macroFps =
    requestedMacroFps !== null && (sourceFps <= 0 || requestedMacroFps < sourceFps)
      ? requestedMacroFps
      : null;
  const tmpOut = `${outPath}.tmp.${process.pid}.${++burnSeq}.mp4`;
  const timeText = macroFps !== null ? ptsExpr : `${ptsExpr}  f%{n}`;
  const filters = [
    ...(macroFps !== null ? [`fps=${macroFps}`] : []),
    ...(scale < 1 ? [`scale=${outW}:${picH}:flags=lanczos`] : []),
    `pad=${outW}:${outH}:0:0:black`,
    `drawtext=${font}:text='${timeText}':fontcolor=white:fontsize=${fontSize}:x=${margin}:y=${yExpr}`,
    `drawtext=${font}:text='REFERENCE':fontcolor=#b8b6ad:fontsize=${labelFontSize}:x=w-tw-${margin}:y=${yExpr}`,
  ];
  const encodeTimeoutMs =
    durationSec > 0 ? Math.max(180_000, Math.min(600_000, Math.round(durationSec * 250))) : 180_000;

  let ok = false;
  let errDetail = "";
  try {
    const res = await runAsyncCmd(
      [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-i",
        source,
        "-map",
        "0:V:0",
        "-map",
        "0:a:0?",
        "-vf",
        filters.join(","),
        ...(macroFps === null ? ["-fps_mode", "passthrough"] : []),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        ...(audio ? ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"] : []),
        tmpOut,
      ],
      encodeTimeoutMs,
    );
    ok = !res.timedOut && res.status === 0 && existsSync(tmpOut);
    if (ok) renameSync(tmpOut, outPath);
    else errDetail = res.timedOut ? "ffmpeg timed out" : res.stderr.trim() || `exit ${res.status}`;
  } finally {
    rmSync(tmpOut, { force: true });
  }
  if (!ok) throw new Error(`burnTimecode720 failed: ${errDetail}`);
  const hasAudioStream = Boolean(audio);
  const audioMetrics = hasAudioStream ? await measureAudioLoudness(source, durationSec) : null;
  if (!hasAudioStream) {
    console.error(
      `[mine] WARNING ${outPath}: no audio stream detected; audio metrics will be excluded from verified denominators.`,
    );
  }
  return {
    hasAudioStream,
    durationSec,
    sourceFps,
    encodedFps: macroFps ?? sourceFps,
    hasFrameCounter: macroFps === null,
    sourceWidth: dispW,
    sourceHeight: dispH,
    audioMetrics,
  };
}

export function loadCheckpoint(corpusDir: string, channel: string): CheckpointFile {
  const ckPath = join(corpusDir, "checkpoint.json");
  if (existsSync(ckPath)) {
    return JSON.parse(readFileSync(ckPath, "utf8")) as CheckpointFile;
  }
  return {
    channel,
    updatedAt: new Date().toISOString(),
    completedCount: 0,
    failedCount: 0,
    entries: {},
  };
}

export function saveCheckpoint(corpusDir: string, ck: CheckpointFile, catalog: CatalogFile): void {
  const entries = Object.values(ck.entries);
  ck.completedCount = entries.filter((e) => e.status === "done").length;
  ck.failedCount = entries.filter((e) => e.status === "failed").length;
  ck.updatedAt = new Date().toISOString();
  writeJsonAtomic(join(corpusDir, "checkpoint.json"), ck);

  const minedIds = new Set(
    Object.entries(ck.entries)
      .filter(([, e]) => e.status === "done")
      .map(([id]) => id),
  );
  const queuePath = join(corpusDir, "queue.json");
  let existingQueueMeta: { minDurationSec?: number; maxDurationSec?: number } | null = null;
  if (existsSync(queuePath)) {
    try {
      existingQueueMeta = JSON.parse(readFileSync(queuePath, "utf8")) as {
        minDurationSec?: number;
        maxDurationSec?: number;
      };
    } catch {}
  }
  const queueDurationOpts = resolveQueueDurationOpts(catalog, existingQueueMeta);
  const queue = buildStratifiedQueue(catalog.videos, minedIds, queueDurationOpts);
  writeJsonAtomic(queuePath, {
    channel: ck.channel,
    updatedAt: ck.updatedAt,
    minDurationSec: queueDurationOpts.minDurationSec,
    maxDurationSec: queueDurationOpts.maxDurationSec,
    remainingCount: queue.length,
    queue,
  });
}

export function extractChatUrl(stderr: string): string | null {
  const m = stderr.match(/https:\/\/aistudio\.google\.com\/prompts\/[\w-]{10,}/);
  return m ? m[0] : null;
}

export function shouldAttachThumbnail(
  vid: Pick<CatalogVideo, "url" | "thumbnailUrl" | "width" | "height" | "durationSec"> & {
    id?: string;
  },
  opts?: {
    withThumbnail?: boolean;
    sourceWidth?: number | null;
    sourceHeight?: number | null;
    durationSec?: number;
  },
): boolean {
  const hasExplicitUrl = Boolean(
    typeof vid.thumbnailUrl === "string" && /^https:\/\//i.test(vid.thumbnailUrl.trim()),
  );
  const hasFallbackId = Boolean(vid.id && isSafeVideoId(vid.id));
  if (!hasExplicitUrl && !hasFallbackId) return false;
  if (opts?.withThumbnail === true) return true;
  if (opts?.withThumbnail === false) return false;
  if (/\/shorts\//i.test(vid.url)) return false;
  const w = opts?.sourceWidth ?? vid.width ?? 0;
  const h = opts?.sourceHeight ?? vid.height ?? 0;
  const dur = opts?.durationSec ?? vid.durationSec ?? 0;
  if (w > 0 && h > 0 && h > w && dur <= 185) return false;
  return true;
}

export function resolveThumbnailCandidates(
  vid: Pick<CatalogVideo, "thumbnailUrl"> & { id?: string },
): string[] {
  const urls: string[] = [];
  if (typeof vid.thumbnailUrl === "string" && /^https:\/\//i.test(vid.thumbnailUrl.trim())) {
    urls.push(vid.thumbnailUrl.trim());
  }
  if (vid.id && isSafeVideoId(vid.id)) {
    for (const variant of ["maxresdefault.jpg", "sddefault.jpg", "hqdefault.jpg"]) {
      const candidate = `https://i.ytimg.com/vi/${vid.id}/${variant}`;
      if (!urls.includes(candidate)) urls.push(candidate);
    }
  }
  return urls;
}

export function resolveMiningFps(opts: {
  requestedFps: number;
  durationSec: number;
  media: string;
  sourceFps?: number;
  autoFps?: boolean;
}): {
  ok: boolean;
  fps: number;
  effectiveFps: number;
  estimatedTokens: number;
  autoScaled: boolean;
  suggestedFps: number | null;
  error?: string;
} {
  const est = estimateUnifiedVideoTokens({
    durationSec: opts.durationSec,
    fps: opts.requestedFps,
    media: opts.media,
    sourceFps: opts.sourceFps,
  });
  if (est.estimatedTokens <= UNIFIED_TOKEN_SOFT_LIMIT) {
    return {
      ok: true,
      fps: opts.requestedFps,
      effectiveFps: est.effectiveFps,
      estimatedTokens: est.estimatedTokens,
      autoScaled: false,
      suggestedFps: null,
    };
  }
  if (opts.autoFps && est.suggestedFps !== null) {
    const scaledFps = Math.min(opts.requestedFps, est.suggestedFps);
    const reEst = estimateUnifiedVideoTokens({
      durationSec: opts.durationSec,
      fps: scaledFps,
      media: opts.media,
      sourceFps: opts.sourceFps,
    });
    if (reEst.estimatedTokens <= UNIFIED_TOKEN_SOFT_LIMIT) {
      return {
        ok: true,
        fps: scaledFps,
        effectiveFps: reEst.effectiveFps,
        estimatedTokens: reEst.estimatedTokens,
        autoScaled: true,
        suggestedFps: scaledFps,
      };
    }
  }
  const hint =
    est.suggestedFps !== null
      ? `rerun with --fps ${est.suggestedFps} (or --auto-fps) --retry-failed or --media Medium`
      : "clip the video with --start/--end or lower --media Low";
  return {
    ok: false,
    fps: opts.requestedFps,
    effectiveFps: est.effectiveFps,
    estimatedTokens: est.estimatedTokens,
    autoScaled: false,
    suggestedFps: est.suggestedFps,
    error: `estimated ~${est.estimatedTokens.toLocaleString("en-US")} video+audio tokens for ${Math.round(opts.durationSec)}s at ${Number(est.effectiveFps.toFixed(2))} FPS (${opts.media}) exceeds ${UNIFIED_TOKEN_SOFT_LIMIT.toLocaleString("en-US")} context budget; ${hint}`,
  };
}

const ALLOWED_THUMBNAIL_HOST_RE =
  /(?:^|\.)(?:ytimg\.com|ggpht\.com|googleusercontent\.com|youtube\.com)$/i;

function isAllowedThumbnailUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && ALLOWED_THUMBNAIL_HOST_RE.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function downloadThumbnail(
  url: string,
  outBase: string,
  fetchImpl?: FetchLike,
): Promise<string | null> {
  if (!isAllowedThumbnailUrl(url)) return null;
  const fetcher: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    let currentUrl = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= 3; hop++) {
      res = await fetcher(currentUrl, { signal: controller.signal, redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || hop === 3) return null;
        const nextUrl = new URL(loc, currentUrl).toString();
        if (!isAllowedThumbnailUrl(nextUrl)) return null;
        currentUrl = nextUrl;
        continue;
      }
      break;
    }
    if (!res || !res.ok) return null;
    if (res.url && !isAllowedThumbnailUrl(res.url)) return null;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct && !ct.startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 10_000_000) return null;
    const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpg";
    const outPath = `${outBase}${ext}`;
    writeFileSync(outPath, buf);
    return outPath;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadThumbnailWithFallback(
  urls: string[],
  outBase: string,
  fetchImpl?: FetchLike,
): Promise<string | null> {
  for (const url of urls) {
    const saved = await downloadThumbnail(url, outBase, fetchImpl);
    if (saved) return saved;
  }
  return null;
}

export interface MineOptions {
  channel: string;
  corpusDir: string;
  limit: number;
  tabs: number;
  model: string;
  thinking: string;
  media: string;
  fps: number;
  backend?: MineBackend;
  apiKey?: string;
  keyPoolDir?: string;
  fetchImpl?: FetchLike;
  prepareMedia?: (
    vid: CatalogVideo,
    workTmp: string,
  ) => Promise<{
    tcMp4: string;
    hasAudioStream: boolean;
    durationSec: number;
    sourceFps: number;
    sourceWidth?: number;
    sourceHeight?: number;
    audioMetrics?: AudioLoudnessMetrics | null;
  }>;
  systemFile?: string;
  promptVersion?: string;
  ids?: string[];
  retryFailed?: boolean;
  minSchema?: number;
  expectSchema?: number;
  upgradeBelow?: number;
  withThumbnail?: boolean;
  autoFps?: boolean;
  cookies?: string;
  cookiesFromBrowser?: string;
  keepTemp?: boolean;
  runVideo?: (
    vid: CatalogVideo,
    tab: string,
    attempt: number,
  ) => Promise<{
    ok: boolean;
    markdown?: string;
    chatUrl?: string | null;
    hasAudioStream?: boolean;
    error?: string;
  }>;
}

export async function runMine(opts: MineOptions): Promise<{
  done: number;
  failed: number;
  quotaHalted: boolean;
  haltReason: HaltReason;
  processed: string[];
}> {
  const catalogPath = join(opts.corpusDir, "catalog.json");
  if (!existsSync(catalogPath)) {
    throw new Error(`missing ${catalogPath}; run collect first`);
  }
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile;
  const byId = new Map<string, CatalogVideo>(catalog.videos.map((v) => [v.id, v]));
  const ck = loadCheckpoint(opts.corpusDir, opts.channel);

  const upgradeBelow = opts.upgradeBelow ?? opts.minSchema ?? 1;
  const requiredSchema =
    opts.expectSchema ?? opts.upgradeBelow ?? opts.minSchema ?? (!opts.systemFile ? 3 : 1);
  if (requiredSchema < upgradeBelow) {
    throw new Error(
      `expectSchema (${requiredSchema}) cannot be lower than upgradeBelow (${upgradeBelow})`,
    );
  }
  const targets = selectMineTargets(catalog, ck, opts.corpusDir, {
    ids: opts.ids,
    limit: opts.limit,
    retryFailed: opts.retryFailed,
    upgradeBelow,
  });
  if (targets.length === 0) {
    console.error("[mine] No pending videos to mine.");
    return { done: 0, failed: 0, quotaHalted: false, haltReason: "none", processed: [] };
  }

  const backend: MineBackend = opts.backend ?? "aistudio";
  const systemFile = opts.systemFile ?? DEFAULT_SYSTEM_PROMPT;
  if (!opts.runVideo && !existsSync(systemFile)) {
    throw new Error(`system prompt file not found: ${systemFile}`);
  }
  const canonicalMedia = opts.runVideo ? opts.media : normalizeMediaLabel(opts.media);
  if (!opts.runVideo && backend === "gemini-api") {
    resolveGeminiApiKey(opts.apiKey, { keyPoolDir: opts.keyPoolDir });
    toGeminiThinkingLevel(opts.thinking);
  }
  const systemPromptText =
    !opts.runVideo && backend === "gemini-api" ? readFileSync(systemFile, "utf8") : "";
  const promptVersion = opts.promptVersion ?? "v4";
  const maxWorkers = backend === "gemini-api" ? 4 : 2;
  const workerCount = Math.max(1, Math.min(maxWorkers, opts.tabs, targets.length));
  const tabNames = Array.from({ length: workerCount }, (_, i) => `cdna${i + 1}`);
  const pending = [...targets];
  const processed: string[] = [];
  let done = 0;
  let failed = 0;
  let quotaExhausted = false;
  let haltReason: HaltReason = "none";
  let consecutiveLongAudioFails = 0;
  let inFlight = 0;

  const runWorker = async (tab: string) => {
    while (pending.length > 0 && !quotaExhausted) {
      const id = pending.shift();
      if (!id) break;
      const vid = byId.get(id)!;
      const vidDir = join(opts.corpusDir, "videos", id);
      const workTmp = opts.runVideo ? "" : mkdtempSync(join(tmpdir(), `cdna-${id}-`));
      const t0 = Date.now();
      console.error(
        `[mine:${tab}] Start ${id} (${vid.tier}, ${vid.outlierRolling}x, ${vid.durationSec ?? "?"}s): ${vid.title}`,
      );

      let lastErr = "";
      let chatUrl: string | null = null;
      let attempts = 0;
      let succeeded = false;
      let hitHalt = false;
      let hasAudioStream = true;
      let burnedDurationSec = vid.durationSec ?? 0;
      let burnedSourceFps = vid.sourceFps ?? 0;
      let burnedEncodedFps = vid.sourceFps ?? 0;
      let burnedHasFrameCounter = true;
      let burnedSourceWidth = vid.width ?? null;
      let burnedSourceHeight = vid.height ?? null;
      let burnedAudioMetrics: AudioLoudnessMetrics | null = null;
      const askState: AskAttemptState = { submittedOnTab: false, chatUrl: null };

      inFlight++;
      try {
        let preMacroFps: number | undefined;
        if (!opts.runVideo && burnedDurationSec > 0) {
          const preCheck = resolveMiningFps({
            requestedFps: opts.fps,
            durationSec: burnedDurationSec,
            media: canonicalMedia,
            sourceFps: burnedSourceFps > 0 ? burnedSourceFps : undefined,
            autoFps: opts.autoFps,
          });
          if (!preCheck.ok) {
            throw new Error(preCheck.error ?? "video exceeds 1M token budget");
          }
          if (preCheck.effectiveFps < 10 || burnedDurationSec > 180) {
            preMacroFps = Math.max(1, Math.ceil(preCheck.effectiveFps));
          }
        } else if (!opts.runVideo && opts.fps < 10) {
          preMacroFps = Math.max(1, Math.ceil(opts.fps));
        }

        let tcMp4 = "";
        if (!opts.runVideo) {
          if (opts.prepareMedia) {
            const prepared = await opts.prepareMedia(vid, workTmp);
            tcMp4 = prepared.tcMp4;
            hasAudioStream = prepared.hasAudioStream;
            if (prepared.durationSec > 0) burnedDurationSec = prepared.durationSec;
            if (prepared.sourceFps > 0) {
              burnedSourceFps = prepared.sourceFps;
              burnedEncodedFps = prepared.sourceFps;
            }
            if (prepared.sourceWidth) burnedSourceWidth = prepared.sourceWidth;
            if (prepared.sourceHeight) burnedSourceHeight = prepared.sourceHeight;
            if (prepared.audioMetrics !== undefined) burnedAudioMetrics = prepared.audioMetrics;
          } else {
            const rawMp4 = join(workTmp, `${id}.mp4`);
            tcMp4 = join(workTmp, `${id}_tc.mp4`);
            const dlFormat =
              preMacroFps !== undefined
                ? "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b"
                : "bv*[width<=1920][height<=1920][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b";
            const dlTimeoutMs =
              burnedDurationSec > 0
                ? Math.max(180_000, Math.min(600_000, Math.round(burnedDurationSec * 250)))
                : 180_000;
            const dl = await runAsyncCmd(
              [
                "yt-dlp",
                "--no-warnings",
                ...(opts.cookies ? ["--cookies", opts.cookies] : []),
                ...(opts.cookiesFromBrowser
                  ? ["--cookies-from-browser", opts.cookiesFromBrowser]
                  : []),
                "-f",
                dlFormat,
                "--merge-output-format",
                "mp4",
                "-o",
                rawMp4,
                "--",
                vid.url,
              ],
              dlTimeoutMs,
            );
            if (dl.timedOut || dl.status !== 0 || !existsSync(rawMp4)) {
              throw new Error(`yt-dlp download failed: ${dl.stderr.trim() || `exit ${dl.status}`}`);
            }
            const burned = await burnTimecode720(
              rawMp4,
              tcMp4,
              preMacroFps !== undefined ? { macroOutputFps: preMacroFps } : undefined,
            );
            hasAudioStream = burned.hasAudioStream;
            if (burned.durationSec > 0) burnedDurationSec = burned.durationSec;
            if (burned.sourceFps > 0) burnedSourceFps = burned.sourceFps;
            if (burned.encodedFps > 0) burnedEncodedFps = burned.encodedFps;
            burnedHasFrameCounter = burned.hasFrameCounter;
            burnedSourceWidth = burned.sourceWidth;
            burnedSourceHeight = burned.sourceHeight;
            burnedAudioMetrics = burned.audioMetrics;
          }
        }

        const effectiveSourceCap =
          burnedEncodedFps > 0 ? burnedEncodedFps : burnedSourceFps > 0 ? burnedSourceFps : 0;
        let videoRequestedFps = opts.fps;
        let effectiveFps =
          effectiveSourceCap > 0 ? Math.min(opts.fps, effectiveSourceCap) : opts.fps;
        if (!opts.runVideo && burnedDurationSec > 0) {
          const fpsCheck = resolveMiningFps({
            requestedFps: opts.fps,
            durationSec: burnedDurationSec,
            media: canonicalMedia,
            sourceFps: effectiveSourceCap > 0 ? effectiveSourceCap : undefined,
            autoFps: opts.autoFps,
          });
          if (!fpsCheck.ok) {
            throw new Error(fpsCheck.error ?? "video exceeds 1M token budget");
          }
          videoRequestedFps = fpsCheck.fps;
          effectiveFps = fpsCheck.effectiveFps;
          if (fpsCheck.autoScaled) {
            console.error(
              `[mine:${tab}] ${id} auto-scaled sampling FPS to ${videoRequestedFps} (~${fpsCheck.estimatedTokens.toLocaleString("en-US")} tokens for ${Math.round(burnedDurationSec)}s).`,
            );
          }
        }

        const miningMode: "micro_24fps" | "macro_lowfps" =
          effectiveFps < 10 || burnedDurationSec > 180 ? "macro_lowfps" : "micro_24fps";

        let thumbPath: string | null = null;
        const isShortsClip =
          /\/shorts\//i.test(vid.url) ||
          (burnedSourceWidth !== null &&
            burnedSourceHeight !== null &&
            burnedSourceHeight > burnedSourceWidth &&
            burnedDurationSec <= 185);
        if (
          !opts.runVideo &&
          shouldAttachThumbnail(vid, {
            withThumbnail: opts.withThumbnail,
            sourceWidth: burnedSourceWidth,
            sourceHeight: burnedSourceHeight,
            durationSec: burnedDurationSec,
          })
        ) {
          thumbPath = await downloadThumbnailWithFallback(
            resolveThumbnailCandidates(vid),
            join(workTmp, `${id}_thumb`),
            opts.fetchImpl,
          );
          if (!thumbPath) {
            console.error(
              `[mine:${tab}] ${id} thumbnail fetch skipped/failed; continuing without thumbnail.`,
            );
          }
        }

        const audioInstruction = hasAudioStream
          ? "The attached MP4 has an audio track. Listen directly for VO, BGM, silence, J/L-cuts, and impacts. If you cannot access the audio track, reply only: INPUT_INCOMPLETE: AUDIO_UNAVAILABLE"
          : "The source has no audio track. Disclose this and mark audio telemetry as silent, unvoiced, or none as appropriate, with audio-only craft flags false.";
        const thumbInstruction = thumbPath
          ? "The attached still image is the video's YouTube browse thumbnail. Evaluate thumbnail_archetype, thumbnail_text_relation, thumbnail_opening_payoff, thumbnail_focal_complexity, and thumbnail_gaze_or_cue directly from the image and opening frames."
          : isShortsClip
            ? 'Shorts feed clip (no browse thumbnail attached): set thumbnail_archetype="not_applicable_shorts_feed", thumbnail_text_relation="not_applicable", thumbnail_opening_payoff="not_applicable", thumbnail_focal_complexity="not_applicable", thumbnail_gaze_or_cue="not_applicable".'
            : 'No browse thumbnail attached: set thumbnail_archetype="no_thumbnail_provided", thumbnail_text_relation="not_applicable", thumbnail_opening_payoff="not_applicable", thumbnail_focal_complexity="not_applicable", thumbnail_gaze_or_cue="not_applicable".';
        const macroInstruction =
          miningMode === "macro_lowfps"
            ? "Macro Low-FPS Mode (<10 FPS or >180s): do NOT fabricate sub-second motion-blur, rack-focus, or frame-exact transition counts; mark unobservable sub-second optical craft_signals false and focus Section 3 on major scene/chapter shifts."
            : null;
        const safeTitle = vid.title.replace(/[\r\n]+/g, " ").trim();
        const titleLine = safeTitle ? `Video Title (metadata only): ${safeTitle}` : null;
        const timestampInstruction = burnedHasFrameCounter
          ? `Analyze the video using the on-screen timestamps and f<n> values. Expected sampling: ${Number(effectiveFps.toFixed(2))} FPS. If you can observe only sparse stills at a much lower cadence than requested, reply only: INPUT_INCOMPLETE: VIDEO_SAMPLING_TOO_SPARSE`
          : `Analyze the video using the on-screen MM:SS.mmm timestamps (no frame counter in Macro Low-FPS mode). Expected sampling: ${Number(effectiveFps.toFixed(2))} FPS. If you can observe only sparse stills at a much lower cadence than requested, reply only: INPUT_INCOMPLETE: VIDEO_SAMPLING_TOO_SPARSE`;
        const userPrompt = [
          ...(titleLine ? [titleLine] : []),
          timestampInstruction,
          audioInstruction,
          thumbInstruction,
          ...(macroInstruction ? [macroInstruction] : []),
          "Write all four sections in crisp English with valid Section 4 Telemetry JSON.",
        ].join("\n");

        for (let attempt = 1; attempt <= 2; attempt++) {
          if (quotaExhausted) {
            hitHalt = true;
            break;
          }
          attempts = attempt;
          let md = "";
          if (opts.runVideo) {
            const custom = await opts.runVideo(vid, tab, attempt);
            chatUrl = custom.chatUrl ?? null;
            if (typeof custom.hasAudioStream === "boolean") hasAudioStream = custom.hasAudioStream;
            if (!custom.ok || !custom.markdown) {
              lastErr = custom.error || "custom runner failed";
              if (shouldHaltBatch(lastErr)) {
                hitHalt = true;
                quotaExhausted = true;
                haltReason = classifyHaltReason(lastErr);
                pending.length = 0;
                break;
              }
              continue;
            }
            md = custom.markdown;
          } else if (backend === "gemini-api") {
            try {
              const apiRes = await runGeminiApiVideo({
                videoPath: tcMp4,
                imagePath: thumbPath ?? undefined,
                durationSec: burnedDurationSec,
                sourceFps: effectiveSourceCap > 0 ? effectiveSourceCap : undefined,
                expectAudio: hasAudioStream,
                systemPrompt: systemPromptText,
                userPrompt,
                model: opts.model,
                thinking: opts.thinking,
                media: canonicalMedia,
                fps: Math.max(0.2, Math.min(videoRequestedFps, effectiveFps)),
                apiKey: opts.apiKey,
                keyPoolDir: opts.keyPoolDir,
                fetchImpl: opts.fetchImpl,
              });
              chatUrl = null;
              md = apiRes.markdown;
              console.error(
                `[mine:${tab}] ${id} gemini-api usage: prompt=${apiRes.promptTokens ?? "?"} video=${apiRes.videoTokens ?? "?"} audio=${apiRes.audioTokens ?? "?"} out=${apiRes.outputTokens ?? "?"}`,
              );
            } catch (apiErr) {
              lastErr = (apiErr as Error).message;
              console.error(`[mine:${tab}] ${id} attempt ${attempt} gemini-api failed: ${lastErr}`);
              if (shouldHaltBatch(lastErr)) {
                hitHalt = true;
                quotaExhausted = true;
                haltReason = classifyHaltReason(lastErr);
                pending.length = 0;
                break;
              }
              continue;
            }
          } else {
            const outMd = join(workTmp, `dossier_a${attempt}.md`);
            const collectFloor = expectedVideoTokensFloor(
              burnedDurationSec,
              videoRequestedFps,
              canonicalMedia,
              effectiveSourceCap > 0 ? effectiveSourceCap : undefined,
            );
            const runAskNew = () =>
              runAsyncCmd(
                buildAskNewArgs({
                  tcMp4,
                  imagePath: thumbPath ?? undefined,
                  userPrompt,
                  tab,
                  model: opts.model,
                  thinking: opts.thinking,
                  media: canonicalMedia,
                  fps: Math.max(0.2, Math.min(videoRequestedFps, effectiveFps)),
                  systemFile,
                  outMd,
                  minInTokens: collectFloor,
                }),
                1_200_000,
              );
            const runCollectTab = (targetOut: string, enforceFloor: boolean) =>
              runAsyncCmd(
                [
                  "bun",
                  ASK_SCRIPT,
                  "--tab",
                  tab,
                  "--collect",
                  ...(enforceFloor && collectFloor > 0
                    ? ["--min-in-tokens", String(collectFloor)]
                    : []),
                  "--out",
                  targetOut,
                  "--run-timeout-min",
                  "12",
                ],
                840_000,
              );

            const res = await executeAskAttempt(askState, {
              runNew: runAskNew,
              runCollect: () => runCollectTab(outMd, true),
              drainOrphan: async () => {
                const orphanMd = join(workTmp, `orphan_a${attempt}.md`);
                console.error(
                  `[mine:${tab}] Draining leftover generation on ${tab} before ${id}...`,
                );
                try {
                  return await runCollectTab(orphanMd, false);
                } finally {
                  rmSync(orphanMd, { force: true });
                }
              },
              hasOutput: () => existsSync(outMd),
            });
            chatUrl = askState.chatUrl;
            if (!res.ok) {
              lastErr = res.error ?? "ask.ts failed";
              console.error(`[mine:${tab}] ${id} attempt ${attempt} ask failed: ${lastErr}`);
              const haltSignal = `${lastErr}\n${res.ask.stderr}`;
              if (shouldHaltBatch(haltSignal)) {
                hitHalt = true;
                quotaExhausted = true;
                haltReason = classifyHaltReason(haltSignal);
                pending.length = 0;
                break;
              }
              continue;
            }
            md = readFileSync(outMd, "utf8");
          }

          const check = parseAndValidateDossier(md, {
            expectAudio: hasAudioStream,
            expectThumbnail: !opts.runVideo ? Boolean(thumbPath) : undefined,
            expectedFps: effectiveFps,
            expectedDurationSec:
              !opts.runVideo && burnedDurationSec > 0 ? burnedDurationSec : undefined,
          });
          if (!check.valid || !check.telemetry) {
            lastErr = `schema validation failed: ${check.errors.join("; ")}`;
            mkdirSync(vidDir, { recursive: true });
            writeTextAtomic(join(vidDir, `raw-failed-a${attempt}.md`), md);
            console.error(`[mine:${tab}] ${id} attempt ${attempt} invalid schema: ${lastErr}`);
            if (attempt === 2 && isMediaDowngradeError(lastErr)) {
              const isolatedAudioOnly =
                /\bAUDIO_UNAVAILABLE\b/.test(lastErr) &&
                !/VIDEO_SAMPLING_TOO_SPARSE|silently downgraded|could not be verified|degraded/i.test(
                  lastErr,
                );
              if (
                isolatedAudioOnly &&
                burnedDurationSec >= 45 &&
                (pending.length > 0 || inFlight > 1) &&
                consecutiveLongAudioFails < 1
              ) {
                consecutiveLongAudioFails++;
                console.error(
                  `[mine:${tab}] ${id} (>=45s) hit isolated AUDIO_UNAVAILABLE; marking clip failed and continuing batch (will halt if next clip also fails).`,
                );
                break;
              }
              hitHalt = true;
              quotaExhausted = true;
              haltReason = "media_downgrade";
              pending.length = 0;
              break;
            }
            continue;
          }
          if (check.telemetry.schema_version < requiredSchema) {
            lastErr = `schema validation failed: expected schema_version >= ${requiredSchema}, got ${check.telemetry.schema_version}`;
            mkdirSync(vidDir, { recursive: true });
            writeTextAtomic(join(vidDir, `raw-failed-a${attempt}.md`), md);
            console.error(`[mine:${tab}] ${id} attempt ${attempt} underschema: ${lastErr}`);
            continue;
          }

          const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1));
          const meta: MinedVideoMeta = {
            id: vid.id,
            title: vid.title,
            url: vid.url,
            views: vid.views,
            likes: vid.likes,
            durationSec:
              vid.durationSec ??
              (burnedDurationSec > 0 ? burnedDurationSec : check.telemetry.duration_sec),
            uploadDate: vid.uploadDate,
            outlierRolling: vid.outlierRolling,
            outlierGlobal: vid.outlierGlobal,
            tier: vid.tier,
            wordCount: vid.wordCount ?? null,
            wpm: vid.wpm ?? null,
            minedAt: new Date().toISOString(),
            model: opts.model,
            thinking: opts.thinking,
            media: canonicalMedia,
            fps: Number(effectiveFps.toFixed(2)),
            promptVersion,
            chatUrl,
            elapsedSec,
            attempts,
            hasAudioStream,
            miningMode,
            ...(burnedSourceFps > 0 ? { sourceFps: Number(burnedSourceFps.toFixed(2)) } : {}),
            ...(burnedSourceWidth ? { sourceWidth: burnedSourceWidth } : {}),
            ...(burnedSourceHeight ? { sourceHeight: burnedSourceHeight } : {}),
            ...(burnedAudioMetrics ? { audioMetrics: burnedAudioMetrics } : {}),
            warnings: check.warnings,
          };

          mkdirSync(vidDir, { recursive: true });
          rmSync(join(vidDir, "raw-failed-a1.md"), { force: true });
          rmSync(join(vidDir, "raw-failed-a2.md"), { force: true });
          writeTextAtomic(join(vidDir, "dossier.md"), md);
          writeJsonAtomic(join(vidDir, "telemetry.json"), check.telemetry);
          writeJsonAtomic(join(vidDir, "meta.json"), meta);
          ck.entries[id] = { status: "done", updatedAt: meta.minedAt, chatUrl, attempts };
          saveCheckpoint(opts.corpusDir, ck, catalog);
          done++;
          consecutiveLongAudioFails = 0;
          succeeded = true;
          processed.push(id);
          console.error(
            `[mine:${tab}] OK ${id} in ${elapsedSec}s (mode=${miningMode}, hook=${check.telemetry.hook_archetype}, story=${check.telemetry.story_structure}, topic=${check.telemetry.topic_category}, warn=${check.warnings.length})`,
          );
          break;
        }
      } catch (err) {
        lastErr = (err as Error).message;
        if (shouldHaltBatch(lastErr)) {
          hitHalt = true;
          quotaExhausted = true;
          haltReason = classifyHaltReason(lastErr);
          pending.length = 0;
        }
      } finally {
        inFlight--;
        if (workTmp && !opts.keepTemp) rmSync(workTmp, { recursive: true, force: true });
      }

      if (!succeeded) {
        if (hitHalt) {
          saveCheckpoint(opts.corpusDir, ck, catalog);
          console.error(
            `[mine:${tab}] BATCH HALT (${haltReason}) on ${id}: leaving unmined in queue.json for seamless resume.`,
          );
          break;
        }
        if (shouldRecordFailure(ck.entries[id], vidDir, false)) {
          ck.entries[id] = {
            status: "failed",
            updatedAt: new Date().toISOString(),
            chatUrl,
            attempts,
            error: lastErr || "unknown failure",
          };
          saveCheckpoint(opts.corpusDir, ck, catalog);
        }
        failed++;
        processed.push(id);
        console.error(`[mine:${tab}] FAIL ${id}: ${lastErr}`);
      }
    }
  };

  try {
    await Promise.all(tabNames.map((t) => runWorker(t)));
  } finally {
    if (!opts.runVideo && backend === "aistudio") {
      for (const tab of tabNames) {
        spawnSync("bun", [STUDIO_SCRIPT, "tab", "close", tab], {
          cwd: REPO_ROOT,
          encoding: "utf8",
          windowsHide: true,
          timeout: 15_000,
        });
      }
    }
  }

  return { done, failed, quotaHalted: quotaExhausted, haltReason, processed };
}

export interface AudioProbeBackfillOptions {
  channel: string;
  corpusDir: string;
  limit: number;
  ids?: string[];
  force?: boolean;
  cookies?: string;
  cookiesFromBrowser?: string;
  keepTemp?: boolean;
  probeVideo?: (
    vid: CatalogVideo,
    meta: MinedVideoMeta,
    workTmp: string,
  ) => Promise<{
    hasAudioStream: boolean;
    durationSec?: number;
    sourceFps?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    audioMetrics: AudioLoudnessMetrics | null;
  }>;
}

export async function probeAudioBackfill(opts: AudioProbeBackfillOptions): Promise<{
  probed: number;
  failed: number;
  halted: boolean;
  haltReason: HaltReason;
  processed: string[];
}> {
  const catalogPath = join(opts.corpusDir, "catalog.json");
  if (!existsSync(catalogPath)) {
    throw new Error(`missing ${catalogPath}; run collect first`);
  }
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile;
  const byId = new Map<string, CatalogVideo>(catalog.videos.map((v) => [v.id, v]));
  const videosDir = join(opts.corpusDir, "videos");
  if (!existsSync(videosDir)) {
    return { probed: 0, failed: 0, halted: false, haltReason: "none", processed: [] };
  }

  const candidateIds: string[] = [];
  if (opts.ids && opts.ids.length > 0) {
    for (const rawId of opts.ids) {
      const id = rawId.trim();
      if (!id || !isSafeVideoId(id)) throw new Error(`invalid video id "${id}"`);
      if (!existsSync(join(videosDir, id, "meta.json"))) continue;
      if (!candidateIds.includes(id)) candidateIds.push(id);
      if (candidateIds.length >= opts.limit) break;
    }
  } else {
    for (const entry of readdirSync(videosDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isSafeVideoId(entry.name)) continue;
      const metaPath = join(videosDir, entry.name, "meta.json");
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as MinedVideoMeta;
        const needsProbe =
          opts.force ||
          (meta.hasAudioStream !== false &&
            (!meta.audioMetrics || meta.audioMetrics.maxShortTermLufs === undefined));
        if (needsProbe) candidateIds.push(entry.name);
      } catch {}
      if (candidateIds.length >= opts.limit) break;
    }
  }

  let probed = 0;
  let failed = 0;
  let halted = false;
  let haltReason: HaltReason = "none";
  const processed: string[] = [];

  for (const id of candidateIds) {
    const metaPath = join(videosDir, id, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as MinedVideoMeta;
    const vid = byId.get(id) ?? {
      id,
      title: meta.title,
      url: meta.url,
      playlistIndex: 0,
      views: meta.views,
      likes: meta.likes,
      durationSec: meta.durationSec,
      uploadDate: meta.uploadDate,
      ageDays: null,
      isMature: true,
      likeRate: null,
      outlierRolling: meta.outlierRolling,
      outlierGlobal: meta.outlierGlobal,
      tier: meta.tier,
    };
    const workTmp = opts.probeVideo ? "" : mkdtempSync(join(tmpdir(), `cdna-audio-${id}-`));
    try {
      let probedRes: {
        hasAudioStream: boolean;
        durationSec?: number;
        sourceFps?: number;
        sourceWidth?: number;
        sourceHeight?: number;
        audioMetrics: AudioLoudnessMetrics | null;
      };
      if (opts.probeVideo) {
        probedRes = await opts.probeVideo(vid, meta, workTmp);
      } else {
        const needGeometry = !meta.sourceWidth || !meta.sourceHeight || !meta.sourceFps;
        const outMedia = join(workTmp, `${id}.m4a`);
        const dlTimeoutMs =
          meta.durationSec > 0
            ? Math.max(180_000, Math.min(600_000, Math.round(meta.durationSec * 250)))
            : 180_000;
        const dl = await runAsyncCmd(
          [
            "yt-dlp",
            "--no-warnings",
            ...(opts.cookies ? ["--cookies", opts.cookies] : []),
            ...(opts.cookiesFromBrowser ? ["--cookies-from-browser", opts.cookiesFromBrowser] : []),
            "-f",
            needGeometry
              ? "bv*[width<=1280][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b"
              : "ba[ext=m4a]/ba/b",
            ...(needGeometry ? ["--merge-output-format", "mp4"] : []),
            "-o",
            needGeometry ? join(workTmp, `${id}.mp4`) : outMedia,
            "--",
            vid.url,
          ],
          dlTimeoutMs,
        );
        const mediaPath = needGeometry ? join(workTmp, `${id}.mp4`) : outMedia;
        if (dl.timedOut || dl.status !== 0 || !existsSync(mediaPath)) {
          throw new Error(
            `yt-dlp audio probe download failed: ${dl.stderr.trim() || `exit ${dl.status}`}`,
          );
        }
        const probe = spawnSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,width,height,avg_frame_rate,r_frame_rate:stream_disposition=attached_pic:stream_side_data=rotation:format=duration",
            "-of",
            "json",
            mediaPath,
          ],
          { encoding: "utf8", windowsHide: true, timeout: 60_000 },
        );
        if (probe.status !== 0) {
          throw new Error(`ffprobe failed on ${mediaPath}: ${(probe.stderr || "").trim()}`);
        }
        const info = JSON.parse(probe.stdout) as {
          streams?: Array<{
            codec_type?: string;
            width?: number;
            height?: number;
            avg_frame_rate?: string;
            r_frame_rate?: string;
            disposition?: { attached_pic?: number };
            side_data_list?: Array<{ rotation?: number }>;
          }>;
          format?: { duration?: string };
        };
        const video = info.streams?.find(
          (s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1,
        );
        const audio = info.streams?.find((s) => s.codec_type === "audio");
        const rawDur = Number(info.format?.duration ?? meta.durationSec ?? 0);
        const durationSec = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : meta.durationSec;
        const rot = Number(
          video?.side_data_list?.find((x) => x?.rotation !== undefined)?.rotation ?? 0,
        );
        const rotated = Math.abs(rot) % 180 === 90;
        const sourceWidth =
          video?.width && video?.height ? (rotated ? video.height : video.width) : undefined;
        const sourceHeight =
          video?.width && video?.height ? (rotated ? video.width : video.height) : undefined;
        const sourceFps = video
          ? parseFpsFraction(video.avg_frame_rate) ||
            parseFpsFraction(video.r_frame_rate) ||
            undefined
          : undefined;
        const hasAudioStream = Boolean(audio);
        const audioMetrics = hasAudioStream
          ? await measureAudioLoudness(mediaPath, durationSec)
          : null;
        probedRes = {
          hasAudioStream,
          durationSec,
          sourceFps,
          sourceWidth,
          sourceHeight,
          audioMetrics,
        };
      }

      if (probedRes.hasAudioStream && !probedRes.audioMetrics) {
        throw new Error("ffmpeg loudness probe returned no metrics");
      }

      const updated: MinedVideoMeta = {
        ...meta,
        hasAudioStream: probedRes.hasAudioStream,
        ...(probedRes.sourceFps && !meta.sourceFps
          ? { sourceFps: Number(probedRes.sourceFps.toFixed(2)) }
          : {}),
        ...(probedRes.sourceWidth && !meta.sourceWidth
          ? { sourceWidth: probedRes.sourceWidth }
          : {}),
        ...(probedRes.sourceHeight && !meta.sourceHeight
          ? { sourceHeight: probedRes.sourceHeight }
          : {}),
        ...(probedRes.audioMetrics ? { audioMetrics: probedRes.audioMetrics } : {}),
      };
      writeJsonAtomic(metaPath, updated);
      probed++;
      processed.push(id);
      console.error(
        `[probe-audio] OK ${id}: I=${probedRes.audioMetrics?.integratedLufs ?? "-"} LUFS, S_max=${probedRes.audioMetrics?.maxShortTermLufs ?? "-"} LUFS, PLR=${probedRes.audioMetrics?.plrDb ?? "-"} dB`,
      );
    } catch (err) {
      const msg = (err as Error).message;
      if (shouldHaltBatch(msg)) {
        halted = true;
        haltReason = classifyHaltReason(msg);
        console.error(`[probe-audio] HALT (${haltReason}) on ${id}: ${msg}`);
        break;
      }
      failed++;
      processed.push(id);
      console.error(`[probe-audio] FAIL ${id}: ${msg}`);
    } finally {
      if (workTmp && !opts.keepTemp) rmSync(workTmp, { recursive: true, force: true });
    }
  }

  return { probed, failed, halted, haltReason, processed };
}
