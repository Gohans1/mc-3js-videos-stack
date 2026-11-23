import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildStratifiedQueue,
  isSafeVideoId,
  writeJsonAtomic,
  writeTextAtomic,
} from "./collect.ts";
import { parseAndValidateDossier } from "./schema.ts";
import type {
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

export function isQuotaError(message: string): boolean {
  return /quota|rate limit|limit reached|resource exhausted|daily limit|usage limit|too many requests|\b(?:http|status|code|error)\s*[:=]?\s*429\b/i.test(
    message,
  );
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

export function selectMineTargets(
  catalog: CatalogFile,
  ck: CheckpointFile,
  corpusDir: string,
  opts: { ids?: string[]; limit: number; retryFailed?: boolean },
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

  const queuePath = join(corpusDir, "queue.json");
  const queueIds = existsSync(queuePath)
    ? ((JSON.parse(readFileSync(queuePath, "utf8")) as { queue?: string[] }).queue ?? [])
    : buildStratifiedQueue(catalog.videos, new Set());
  const seen = new Set<string>();
  for (const id of queueIds) {
    if (seen.has(id) || !isSafeVideoId(id) || !byId.has(id)) continue;
    seen.add(id);
    const prev = ck.entries[id];
    if (prev?.status === "done") continue;
    if (prev?.status === "failed" && !opts.retryFailed) continue;
    candidateIds.push(id);
    if (candidateIds.length >= opts.limit) break;
  }
  return candidateIds;
}

async function runAsyncCmd(
  cmd: string[],
  timeoutMs: number,
): Promise<{ status: number; stdout: string; stderr: string; timedOut: boolean }> {
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

export async function burnTimecode720(source: string, outPath: string): Promise<void> {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,start_time:stream_disposition=attached_pic:stream_side_data=rotation:format=start_time,duration",
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

  const tmpOut = `${outPath}.tmp.${process.pid}.${++burnSeq}.mp4`;
  const filters = [
    ...(scale < 1 ? [`scale=${outW}:${picH}:flags=lanczos`] : []),
    `pad=${outW}:${outH}:0:0:black`,
    `drawtext=${font}:text='${ptsExpr}  f%{n}':fontcolor=white:fontsize=${fontSize}:x=${margin}:y=${yExpr}`,
    `drawtext=${font}:text='REFERENCE':fontcolor=#b8b6ad:fontsize=${labelFontSize}:x=w-tw-${margin}:y=${yExpr}`,
  ];

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
        "-fps_mode",
        "passthrough",
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
      180_000,
    );
    ok = !res.timedOut && res.status === 0 && existsSync(tmpOut);
    if (ok) renameSync(tmpOut, outPath);
    else errDetail = res.timedOut ? "ffmpeg timed out" : res.stderr.trim() || `exit ${res.status}`;
  } finally {
    rmSync(tmpOut, { force: true });
  }
  if (!ok) throw new Error(`burnTimecode720 failed: ${errDetail}`);
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
  const queue = buildStratifiedQueue(catalog.videos, minedIds);
  writeJsonAtomic(join(corpusDir, "queue.json"), {
    channel: ck.channel,
    updatedAt: ck.updatedAt,
    remainingCount: queue.length,
    queue,
  });
}

function extractChatUrl(stderr: string): string | null {
  const m = stderr.match(/https:\/\/aistudio\.google\.com\/prompts\/[\w-]+/);
  return m ? m[0] : null;
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
  systemFile?: string;
  promptVersion?: string;
  ids?: string[];
  retryFailed?: boolean;
  keepTemp?: boolean;
  runVideo?: (
    vid: CatalogVideo,
    tab: string,
    attempt: number,
  ) => Promise<{ ok: boolean; markdown?: string; chatUrl?: string | null; error?: string }>;
}

export async function runMine(opts: MineOptions): Promise<{
  done: number;
  failed: number;
  quotaHalted: boolean;
  processed: string[];
}> {
  const catalogPath = join(opts.corpusDir, "catalog.json");
  if (!existsSync(catalogPath)) {
    throw new Error(`missing ${catalogPath}; run collect first`);
  }
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile;
  const byId = new Map<string, CatalogVideo>(catalog.videos.map((v) => [v.id, v]));
  const ck = loadCheckpoint(opts.corpusDir, opts.channel);

  const targets = selectMineTargets(catalog, ck, opts.corpusDir, {
    ids: opts.ids,
    limit: opts.limit,
    retryFailed: opts.retryFailed,
  });
  if (targets.length === 0) {
    console.error("[mine] No pending videos to mine.");
    return { done: 0, failed: 0, quotaHalted: false, processed: [] };
  }

  const systemFile = opts.systemFile ?? DEFAULT_SYSTEM_PROMPT;
  if (!opts.runVideo && !existsSync(systemFile)) {
    throw new Error(`system prompt file not found: ${systemFile}`);
  }
  const promptVersion = opts.promptVersion ?? "v2";
  const workerCount = Math.max(1, Math.min(2, opts.tabs, targets.length));
  const tabNames = Array.from({ length: workerCount }, (_, i) => `cdna${i + 1}`);
  const pending = [...targets];
  const processed: string[] = [];
  let done = 0;
  let failed = 0;
  let quotaExhausted = false;

  const userPrompt =
    "Analyze BOTH the visual track (reading exact timestamps and f<n> from the bottom black timecode bar) AND the attached audio stream (listening directly from 00:00 to end for voiceover cadence, BGM bed/shifts, pre-impact silence, J/L-cuts, and loud impacts) using your System Instructions. Write ALL 4 sections in crisp English and emit the strict valid Section 4 Telemetry JSON block.";

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
      let hitQuota = false;

      try {
        let tcMp4 = "";
        if (!opts.runVideo) {
          const rawMp4 = join(workTmp, `${id}.mp4`);
          tcMp4 = join(workTmp, `${id}_tc.mp4`);
          const dl = await runAsyncCmd(
            [
              "yt-dlp",
              "--no-warnings",
              "-f",
              "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
              "--merge-output-format",
              "mp4",
              "-o",
              rawMp4,
              "--",
              vid.url,
            ],
            180_000,
          );
          if (dl.timedOut || dl.status !== 0 || !existsSync(rawMp4)) {
            throw new Error(`yt-dlp download failed: ${dl.stderr.trim() || `exit ${dl.status}`}`);
          }
          await burnTimecode720(rawMp4, tcMp4);
        }

        for (let attempt = 1; attempt <= 2; attempt++) {
          if (quotaExhausted) {
            hitQuota = true;
            break;
          }
          attempts = attempt;
          let md = "";
          if (opts.runVideo) {
            const custom = await opts.runVideo(vid, tab, attempt);
            chatUrl = custom.chatUrl ?? chatUrl;
            if (!custom.ok || !custom.markdown) {
              lastErr = custom.error || "custom runner failed";
              if (isQuotaError(lastErr)) {
                hitQuota = true;
                quotaExhausted = true;
                pending.length = 0;
                break;
              }
              continue;
            }
            md = custom.markdown;
          } else {
            const outMd = join(workTmp, `dossier_a${attempt}.md`);
            const ask = await runAsyncCmd(
              [
                "bun",
                ASK_SCRIPT,
                tcMp4,
                userPrompt,
                "--tab",
                tab,
                "--model",
                opts.model,
                "--thinking",
                opts.thinking,
                "--media",
                opts.media,
                "--fps",
                String(opts.fps),
                "--tool",
                "search=off",
                "--system-file",
                systemFile,
                "--out",
                outMd,
                "--run-timeout-min",
                "15",
              ],
              1_200_000,
            );
            chatUrl = extractChatUrl(ask.stderr) ?? chatUrl;
            if (ask.timedOut || ask.status !== 0 || !existsSync(outMd)) {
              lastErr = ask.timedOut
                ? "ask.ts timed out"
                : ask.stderr
                    .split(/\r?\n/)
                    .filter((l) => /failed|error|says:|✗\s+input:/i.test(l))
                    .slice(-3)
                    .join(" | ") || `ask.ts exit ${ask.status}`;
              console.error(`[mine:${tab}] ${id} attempt ${attempt} ask failed: ${lastErr}`);
              if (isQuotaError(lastErr)) {
                hitQuota = true;
                quotaExhausted = true;
                pending.length = 0;
                break;
              }
              continue;
            }
            md = readFileSync(outMd, "utf8");
          }

          const check = parseAndValidateDossier(md);
          if (!check.valid || !check.telemetry) {
            lastErr = `schema validation failed: ${check.errors.join("; ")}`;
            mkdirSync(vidDir, { recursive: true });
            writeTextAtomic(join(vidDir, `raw-failed-a${attempt}.md`), md);
            console.error(`[mine:${tab}] ${id} attempt ${attempt} invalid schema: ${lastErr}`);
            continue;
          }

          const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1));
          const meta: MinedVideoMeta = {
            id: vid.id,
            title: vid.title,
            url: vid.url,
            views: vid.views,
            likes: vid.likes,
            durationSec: vid.durationSec ?? check.telemetry.duration_sec,
            uploadDate: vid.uploadDate,
            outlierRolling: vid.outlierRolling,
            outlierGlobal: vid.outlierGlobal,
            tier: vid.tier,
            wordCount: vid.wordCount ?? null,
            wpm: vid.wpm ?? null,
            minedAt: new Date().toISOString(),
            model: opts.model,
            thinking: opts.thinking,
            media: opts.media,
            fps: opts.fps,
            promptVersion,
            chatUrl,
            elapsedSec,
            attempts,
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
          succeeded = true;
          processed.push(id);
          console.error(
            `[mine:${tab}] OK ${id} in ${elapsedSec}s (hook=${check.telemetry.hook_archetype}, story=${check.telemetry.story_structure}, topic=${check.telemetry.topic_category}, warn=${check.warnings.length})`,
          );
          break;
        }
      } catch (err) {
        lastErr = (err as Error).message;
        if (isQuotaError(lastErr)) {
          hitQuota = true;
          quotaExhausted = true;
          pending.length = 0;
        }
      } finally {
        if (workTmp && !opts.keepTemp) rmSync(workTmp, { recursive: true, force: true });
      }

      if (!succeeded) {
        if (hitQuota) {
          saveCheckpoint(opts.corpusDir, ck, catalog);
          console.error(
            `[mine:${tab}] QUOTA HALT on ${id}: leaving unmined in queue.json for seamless resume.`,
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
    if (!opts.runVideo) {
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

  return { done, failed, quotaHalted: quotaExhausted, processed };
}
