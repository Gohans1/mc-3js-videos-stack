#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { CURRENT_STATS_VERSION, runAggregate } from "./aggregate.ts";
import { computeChannelMedianWpm, isCorruptTranscript } from "./catalog-metrics.ts";
import { isSafeVideoId, resolveCollectDurationBounds, runCollect } from "./collect.ts";
import { normalizeMediaLabel, toGeminiThinkingLevel } from "./gemini-api.ts";
import {
  formatMineOutcome,
  loadCheckpoint,
  type MineBackend,
  probeAudioBackfill,
  runMine,
} from "./mine.ts";
import { parseAndValidateDossier } from "./schema.ts";
import type { CatalogFile } from "./types.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");

const HELP = `Channel DNA Factory — collect, mine (resumable), validate, and deterministically aggregate any YouTube channel into a production skill.
  bun .claude/skills/channel-dna/scripts/cli.ts collect   --channel <slug> --url <http(s)-url> [--max-videos 300] [--enrich 120] [--transcripts 120] [--backfill-timing] [--min-duration 10] [--max-duration 185|3600] [--lang en,en-US,en-GB] [--cookies <file>] [--cookies-from-browser <browser>] [--corpus <dir>]
  bun .claude/skills/channel-dna/scripts/cli.ts mine      --channel <slug> [--limit 20] [--tabs 2] [--backend aistudio|gemini-api] [--model gemini-4-hydrogen] [--thinking "Extra High"] [--media High] [--fps 24] [--auto-fps] [--with-thumbnail|--no-thumbnail] [--system-file <path>] [--prompt-version v4] [--expect-schema 1|2|3] [--upgrade-below 2|3] [--min-schema 1|2|3] [--probe-audio-only] [--ids a,b] [--retry-failed] [--cookies <file>] [--cookies-from-browser <browser>] [--corpus <dir>]
  bun .claude/skills/channel-dna/scripts/cli.ts validate  <dossier.md> [--fps <n>]
  bun .claude/skills/channel-dna/scripts/cli.ts aggregate --channel <slug> [--min-schema 1|2|3] [--corpus <dir>]
  bun .claude/skills/channel-dna/scripts/cli.ts status    --channel <slug> [--corpus <dir>]
Notes: --tabs max is 2 for aistudio, 4 for gemini-api.
collect auto-defaults --max-duration to 185s for /shorts URLs and 3600s for /videos; --backfill-timing upgrades cached transcripts with overlap-cleaned timing.
mine defaults --expect-schema to 3 on built-in v4 runs without re-mining older dossiers (pass --upgrade-below 3 or --min-schema 3 to upgrade existing <3 dossiers first).
24 FPS High fits ~136s (2m16s) under the 1M token budget; pass --fps 1..4 or --auto-fps for longform clips. --probe-audio-only backfills FFmpeg loudness metrics at 0 AI tokens.
Default corpus path: .claude/skills/<slug>/references/corpus (when --ids is passed without --limit, mines all unique IDs).
Exit 0: ok (or partial batch with >=1 mined); 1: runtime/validation error or batch with 0 mined and (>=1 failed or halted); 2: usage error.`;

const usage: (msg: string) => never = (msg) => {
  console.error(`${msg}\n${HELP}`);
  process.exit(2);
};

function readStatsMinSchema(corpusDir: string): number {
  const statsPath = join(corpusDir, "stats.json");
  if (!existsSync(statsPath)) return 1;
  try {
    const st = JSON.parse(readFileSync(statsPath, "utf8")) as { deepDna?: { minSchema?: number } };
    return typeof st.deepDna?.minSchema === "number" && st.deepDna.minSchema >= 2
      ? st.deepDna.minSchema
      : 1;
  } catch {
    return 1;
  }
}

const safeParse: typeof parseArgs = (config) => {
  try {
    return parseArgs(config);
  } catch (err) {
    return usage((err as Error).message);
  }
};

const posInt = (
  flag: string,
  raw: string | undefined,
  def: number,
  min: number,
  max: number,
): number => {
  if (raw === undefined) return def;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    usage(`${flag} must be an integer between ${min} and ${max}, got ${JSON.stringify(raw)}`);
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    usage(`${flag} must be an integer between ${min} and ${max}, got ${JSON.stringify(raw)}`);
  }
  return n;
};

const posFloat = (
  flag: string,
  raw: string | undefined,
  def: number,
  min: number,
  max: number,
): number => {
  if (raw === undefined) return def;
  const trimmed = raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    usage(`${flag} must be a number between ${min} and ${max}, got ${JSON.stringify(raw)}`);
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < min || n > max) {
    usage(`${flag} must be a number between ${min} and ${max}, got ${JSON.stringify(raw)}`);
  }
  return n;
};

const resolveCorpusDir = (channel: string, custom: string | undefined): string => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(channel)) {
    usage(`--channel must be lowercase kebab-case (a-z, 0-9, -), got "${channel}"`);
  }
  return custom ? resolve(custom) : join(REPO_ROOT, ".claude/skills", channel, "references/corpus");
};

const parseCookiesFlags = (values: {
  cookies?: string;
  "cookies-from-browser"?: string;
}): { cookiesFile?: string; cookiesFromBrowser?: string } => {
  let cookiesFile: string | undefined;
  if (values.cookies !== undefined) {
    cookiesFile = resolve(values.cookies);
    if (!existsSync(cookiesFile) || !statSync(cookiesFile).isFile()) {
      usage(`cookies file not found: ${cookiesFile}`);
    }
  }
  const cookiesFromBrowser = values["cookies-from-browser"]?.trim() || undefined;
  if (values["cookies-from-browser"] !== undefined && !cookiesFromBrowser) {
    usage("--cookies-from-browser requires a non-empty browser spec (e.g. chrome, edge, firefox)");
  }
  return { cookiesFile, cookiesFromBrowser };
};

const cmd = process.argv[2];
if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
  console.log(HELP);
  process.exit(0);
}

const rest = process.argv.slice(3);

if (cmd === "collect") {
  const { values, positionals } = safeParse({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      channel: { type: "string" },
      url: { type: "string" },
      corpus: { type: "string" },
      "max-videos": { type: "string" },
      enrich: { type: "string" },
      transcripts: { type: "string" },
      "backfill-timing": { type: "boolean" },
      "min-duration": { type: "string" },
      "max-duration": { type: "string" },
      lang: { type: "string" },
      cookies: { type: "string" },
      "cookies-from-browser": { type: "string" },
    },
  });
  if (positionals.length > 0) usage(`unexpected positional argument(s): ${positionals.join(" ")}`);
  if (!values.channel) usage("collect requires --channel <slug>");
  if (!values.url) usage("collect requires --url <youtube-url>");
  if (!/^https?:\/\//i.test(values.url)) {
    usage(`--url must start with http:// or https://, got "${values.url}"`);
  }
  const { cookiesFile, cookiesFromBrowser } = parseCookiesFlags(values);
  let languages: string[] | undefined;
  if (values.lang !== undefined) {
    languages = values.lang
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (languages.length === 0) {
      usage("--lang requires at least one non-empty language code (e.g. en,en-US)");
    }
  }
  const minDurationSec =
    values["min-duration"] !== undefined
      ? posInt("--min-duration", values["min-duration"], 10, 1, 7200)
      : undefined;
  const maxDurationSec =
    values["max-duration"] !== undefined
      ? posInt("--max-duration", values["max-duration"], 185, 1, 21600)
      : undefined;
  const corpusDir = resolveCorpusDir(values.channel, values.corpus);
  let prevCatalogMeta: Pick<CatalogFile, "sourceUrl" | "queueFilter"> | null = null;
  const existingCatalogPath = join(corpusDir, "catalog.json");
  if (existsSync(existingCatalogPath)) {
    try {
      const parsed = JSON.parse(readFileSync(existingCatalogPath, "utf8")) as CatalogFile;
      prevCatalogMeta = { sourceUrl: parsed.sourceUrl, queueFilter: parsed.queueFilter };
    } catch {}
  }
  const effectiveBounds = resolveCollectDurationBounds(
    values.url,
    { minDurationSec, maxDurationSec },
    prevCatalogMeta,
  );
  if (effectiveBounds.minDurationSec > effectiveBounds.maxDurationSec) {
    usage(
      `--min-duration (${effectiveBounds.minDurationSec}) cannot exceed --max-duration (${effectiveBounds.maxDurationSec})`,
    );
  }
  const catalog = runCollect({
    channel: values.channel,
    url: values.url,
    corpusDir,
    maxVideos: posInt("--max-videos", values["max-videos"], 300, 1, 2000),
    enrichLimit: posInt("--enrich", values.enrich, 120, 0, 1000),
    transcriptLimit: posInt("--transcripts", values.transcripts, 120, 0, 1000),
    backfillTiming: !!values["backfill-timing"],
    minDurationSec,
    maxDurationSec,
    languages,
    cookies: cookiesFile,
    cookiesFromBrowser,
  });
  console.log(
    `collected ${catalog.totalCollected} items (${catalog.matureCount} mature >=30d, ${catalog.enrichedCount} enriched, ${catalog.transcriptCount} transcripts, median views ${catalog.globalMatureMedianViews.toLocaleString("en-US")}) -> ${corpusDir}`,
  );
  console.log(
    `next: bun .claude/skills/channel-dna/scripts/cli.ts mine --channel ${values.channel} --limit 6`,
  );
  process.exit(0);
}

if (cmd === "mine") {
  const { values, positionals } = safeParse({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      channel: { type: "string" },
      corpus: { type: "string" },
      limit: { type: "string" },
      tabs: { type: "string" },
      backend: { type: "string" },
      model: { type: "string" },
      thinking: { type: "string" },
      media: { type: "string" },
      fps: { type: "string" },
      "auto-fps": { type: "boolean" },
      "with-thumbnail": { type: "boolean" },
      "no-thumbnail": { type: "boolean" },
      "system-file": { type: "string" },
      "prompt-version": { type: "string" },
      "min-schema": { type: "string" },
      "expect-schema": { type: "string" },
      "upgrade-below": { type: "string" },
      "probe-audio-only": { type: "boolean" },
      ids: { type: "string" },
      "retry-failed": { type: "boolean" },
      cookies: { type: "string" },
      "cookies-from-browser": { type: "string" },
    },
  });
  if (positionals.length > 0) usage(`unexpected positional argument(s): ${positionals.join(" ")}`);
  if (!values.channel) usage("mine requires --channel <slug>");
  if (values["with-thumbnail"] && values["no-thumbnail"]) {
    usage("--with-thumbnail and --no-thumbnail cannot be combined");
  }
  const corpusDir = resolveCorpusDir(values.channel, values.corpus);
  let ids: string[] | undefined;
  if (values.ids !== undefined) {
    ids = [
      ...new Set(
        values.ids
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0) usage("--ids requires at least one non-empty video id");
    for (const id of ids) {
      if (!isSafeVideoId(id)) usage(`invalid video id in --ids: "${id}"`);
    }
  }
  const { cookiesFile, cookiesFromBrowser } = parseCookiesFlags(values);
  const defaultLimit = ids && ids.length > 0 ? ids.length : 20;
  const limit = posInt("--limit", values.limit, defaultLimit, 1, 500);
  if (values["probe-audio-only"]) {
    const res = await probeAudioBackfill({
      channel: values.channel,
      corpusDir,
      limit,
      ids,
      cookies: cookiesFile,
      cookiesFromBrowser,
    });
    const aggMinSchema = readStatsMinSchema(corpusDir);
    const aggSchemaFlag = aggMinSchema >= 2 ? ` --min-schema ${aggMinSchema}` : "";
    console.log(
      `audio probe finished: probed=${res.probed}, failed=${res.failed}, halted=${res.halted}, haltReason=${res.haltReason}, ids=${res.processed.join(",") || "none"}`,
    );
    console.log(
      `next: bun .claude/skills/channel-dna/scripts/cli.ts aggregate --channel ${values.channel}${aggSchemaFlag}`,
    );
    process.exit(res.probed === 0 && (res.failed > 0 || res.halted) ? 1 : 0);
  }
  const rawBackend = values.backend ?? "aistudio";
  if (rawBackend !== "aistudio" && rawBackend !== "gemini-api") {
    usage(`--backend must be "aistudio" or "gemini-api", got ${JSON.stringify(rawBackend)}`);
  }
  const backend: MineBackend = rawBackend;
  let systemFile: string | undefined;
  if (values["system-file"] !== undefined) {
    systemFile = resolve(values["system-file"]);
    if (!existsSync(systemFile) || !statSync(systemFile).isFile()) {
      usage(`system prompt file not found: ${systemFile}`);
    }
  }
  const parsedMinSchema =
    values["min-schema"] !== undefined
      ? posInt("--min-schema", values["min-schema"], 1, 1, 3)
      : undefined;
  const parsedExpectSchema =
    values["expect-schema"] !== undefined
      ? posInt("--expect-schema", values["expect-schema"], 3, 1, 3)
      : undefined;
  const parsedUpgradeBelow =
    values["upgrade-below"] !== undefined
      ? posInt("--upgrade-below", values["upgrade-below"], 2, 2, 3)
      : undefined;
  const effectiveUpgradeBelow = parsedUpgradeBelow ?? parsedMinSchema;
  if (
    parsedExpectSchema !== undefined &&
    effectiveUpgradeBelow !== undefined &&
    parsedExpectSchema < effectiveUpgradeBelow
  ) {
    usage(
      `--expect-schema (${parsedExpectSchema}) cannot be lower than --upgrade-below/--min-schema (${effectiveUpgradeBelow})`,
    );
  }
  const maxTabs = backend === "gemini-api" ? 4 : 2;
  const model = (values.model ?? "gemini-4-hydrogen").trim();
  if (!model.replace(/^models\//, "")) usage("--model must be a non-empty model id");
  const defaultThinking = /^(?:models\/)?gemini-4-(?:hydrogen|neon)$/i.test(model)
    ? "Extra High"
    : "High";
  const thinking = (values.thinking ?? defaultThinking).trim();
  if (!thinking) usage("--thinking must be a non-empty thinking level");
  let media: "Default" | "Low" | "Medium" | "High";
  try {
    media = normalizeMediaLabel((values.media ?? "High").trim());
    if (backend === "gemini-api") {
      toGeminiThinkingLevel(thinking);
    }
  } catch (err) {
    usage((err as Error).message);
  }
  const withThumbnail = values["with-thumbnail"]
    ? true
    : values["no-thumbnail"]
      ? false
      : undefined;
  const result = await runMine({
    channel: values.channel,
    corpusDir,
    limit,
    tabs: posInt("--tabs", values.tabs, 2, 1, maxTabs),
    backend,
    model,
    thinking,
    media,
    fps: posFloat("--fps", values.fps, 24, 0.2, 24),
    autoFps: !!values["auto-fps"],
    withThumbnail,
    systemFile,
    promptVersion: values["prompt-version"],
    minSchema: parsedMinSchema,
    expectSchema: parsedExpectSchema,
    upgradeBelow: parsedUpgradeBelow,
    ids,
    retryFailed: !!values["retry-failed"],
    cookies: cookiesFile,
    cookiesFromBrowser,
  });
  let hintMinSchema = parsedUpgradeBelow ?? parsedMinSchema ?? 1;
  const statsPath = join(corpusDir, "stats.json");
  if (parsedMinSchema === undefined && parsedUpgradeBelow === undefined && existsSync(statsPath)) {
    try {
      const st = JSON.parse(readFileSync(statsPath, "utf8")) as {
        deepDna?: { minSchema?: number };
      };
      if (st.deepDna?.minSchema && st.deepDna.minSchema >= 2) hintMinSchema = st.deepDna.minSchema;
    } catch {}
  }
  const retryMinSchema = parsedUpgradeBelow ?? parsedMinSchema ?? 1;
  const retrySchemaFlag = parsedUpgradeBelow !== undefined ? "--upgrade-below" : "--min-schema";
  const outcome = formatMineOutcome(
    values.channel,
    result,
    hintMinSchema,
    backend,
    retryMinSchema,
    retrySchemaFlag,
  );
  console.log(outcome.summaryLine);
  console.log(outcome.nextLine);
  process.exit(outcome.exitCode);
}

if (cmd === "validate") {
  const { values, positionals } = safeParse({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      fps: { type: "string" },
    },
  });
  const file = positionals[0];
  if (!file || positionals.length !== 1) usage("validate requires <dossier.md> [--fps <n>]");
  const abs = resolve(file);
  if (!existsSync(abs) || !statSync(abs).isFile()) usage(`file not found: ${abs}`);
  let expectedFps: number | undefined =
    values.fps !== undefined ? posFloat("--fps", values.fps, 24, 0.2, 120) : undefined;
  let expectAudio: boolean | undefined;
  let expectedDurationSec: number | undefined;
  const siblingMeta = join(dirname(abs), "meta.json");
  if (existsSync(siblingMeta) && statSync(siblingMeta).isFile()) {
    try {
      const meta = JSON.parse(readFileSync(siblingMeta, "utf8")) as {
        fps?: unknown;
        sourceFps?: unknown;
        hasAudioStream?: unknown;
        durationSec?: unknown;
      };
      if (expectedFps === undefined) {
        const reqFps = typeof meta.fps === "number" && meta.fps > 0 ? meta.fps : undefined;
        const srcFps =
          typeof meta.sourceFps === "number" && meta.sourceFps > 0 ? meta.sourceFps : undefined;
        if (reqFps !== undefined && srcFps !== undefined) expectedFps = Math.min(reqFps, srcFps);
        else if (reqFps !== undefined) expectedFps = reqFps;
        else if (srcFps !== undefined) expectedFps = srcFps;
      }
      if (typeof meta.hasAudioStream === "boolean") {
        expectAudio = meta.hasAudioStream;
      }
      if (
        typeof meta.durationSec === "number" &&
        Number.isFinite(meta.durationSec) &&
        meta.durationSec > 0
      ) {
        expectedDurationSec = meta.durationSec;
      }
    } catch {}
  }
  const check = parseAndValidateDossier(readFileSync(abs, "utf8"), {
    ...(expectedFps !== undefined ? { expectedFps } : {}),
    ...(expectAudio !== undefined ? { expectAudio } : {}),
    ...(expectedDurationSec !== undefined ? { expectedDurationSec } : {}),
  });
  console.log(JSON.stringify(check, null, 2));
  process.exit(check.valid ? 0 : 1);
}

if (cmd === "aggregate") {
  const { values, positionals } = safeParse({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      channel: { type: "string" },
      corpus: { type: "string" },
      "min-schema": { type: "string" },
    },
  });
  if (positionals.length > 0) usage(`unexpected positional argument(s): ${positionals.join(" ")}`);
  if (!values.channel) usage("aggregate requires --channel <slug>");
  const corpusDir = resolveCorpusDir(values.channel, values.corpus);
  const minSchema = posInt("--min-schema", values["min-schema"], 1, 1, 3);
  const stats = runAggregate(corpusDir, minSchema);
  const provTag =
    stats.deepDna.tierCounts.provisional > 0 ? ` P:${stats.deepDna.tierCounts.provisional}` : "";
  console.log(
    `aggregated ${stats.channel}: catalog=${stats.catalogTelemetry.totalCollected} (${stats.catalogTelemetry.matureCount} mature, ${stats.catalogTelemetry.matureTranscriptCount}/${stats.catalogTelemetry.transcriptCount} WPM), deepDna=${stats.deepDna.minedCount} (W:${stats.deepDna.tierCounts.winner} M:${stats.deepDna.tierCounts.median} F:${stats.deepDna.tierCounts.flop}${provTag}) -> ${join(corpusDir, "stats.json")}`,
  );
  console.log(
    `next: inspect ${join(corpusDir, "stats-summary.md")} and synthesize channel SKILL.md`,
  );
  process.exit(0);
}

if (cmd === "status") {
  const { values, positionals } = safeParse({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      channel: { type: "string" },
      corpus: { type: "string" },
    },
  });
  if (positionals.length > 0) usage(`unexpected positional argument(s): ${positionals.join(" ")}`);
  if (!values.channel) usage("status requires --channel <slug>");
  const corpusDir = resolveCorpusDir(values.channel, values.corpus);
  const catalogPath = join(corpusDir, "catalog.json");
  if (!existsSync(catalogPath)) {
    console.log(`channel ${values.channel}: no catalog yet at ${corpusDir}`);
    console.log(
      `next: bun .claude/skills/channel-dna/scripts/cli.ts collect --channel ${values.channel} --url <youtube-url>`,
    );
    process.exit(0);
  }
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile;
  const ck = loadCheckpoint(corpusDir, values.channel);
  const videosDir = join(corpusDir, "videos");
  let v1Count = 0;
  let v2Count = 0;
  let v3Count = 0;
  let audioV1 = 0;
  let audioV2 = 0;
  let audioV3 = 0;
  let audio10HzV1 = 0;
  let audio10HzV2 = 0;
  let audio10HzV3 = 0;
  if (existsSync(videosDir)) {
    for (const entry of readdirSync(videosDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(videosDir, entry.name, "meta.json");
      const telPath = join(videosDir, entry.name, "telemetry.json");
      if (!existsSync(metaPath) || !existsSync(telPath)) continue;
      try {
        const tel = JSON.parse(readFileSync(telPath, "utf8")) as { schema_version?: number };
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
          hasAudioStream?: boolean;
          audioMetrics?: {
            integratedLufs?: number | null;
            truePeakDbtp?: number | null;
            maxShortTermLufs?: number | null;
            isSilentTrack?: boolean;
          };
        };
        const am = meta.audioMetrics;
        const hasAudioMetrics = meta.hasAudioStream !== false && Boolean(am);
        const has10HzAudio =
          hasAudioMetrics &&
          typeof am?.maxShortTermLufs === "number" &&
          am.isSilentTrack !== true &&
          !(typeof am.integratedLufs === "number" && am.integratedLufs <= -69.5) &&
          am.truePeakDbtp !== null;
        if (tel.schema_version === 3) {
          v3Count++;
          if (hasAudioMetrics) audioV3++;
          if (has10HzAudio) audio10HzV3++;
        } else if (tel.schema_version === 2) {
          v2Count++;
          if (hasAudioMetrics) audioV2++;
          if (has10HzAudio) audio10HzV2++;
        } else if (tel.schema_version === 1) {
          v1Count++;
          if (hasAudioMetrics) audioV1++;
          if (has10HzAudio) audio10HzV1++;
        }
      } catch {}
    }
  }
  const matureVids = catalog.videos.filter((v) => v.isMature);
  const chanMedWpm = computeChannelMedianWpm(matureVids);
  const timedCleanVids = matureVids.filter(
    (v) =>
      Boolean(v.transcriptText && /[\p{L}\p{N}]/u.test(v.transcriptText)) &&
      !isCorruptTranscript(v, chanMedWpm) &&
      Boolean(v.transcriptTiming),
  );
  const expectedTimingN = timedCleanVids.length;
  const expectedActiveSpeechN = timedCleanVids.filter(
    (v) =>
      typeof v.transcriptTiming?.activeSpeechWpm === "number" &&
      v.transcriptTiming.activeSpeechWpm > 0,
  ).length;
  let aggSuffix = " aggregatedN=none";
  let needsAggregate = false;
  let schemaFilterFlag = "";
  const statsPath = join(corpusDir, "stats.json");
  const diskCount = v1Count + v2Count + v3Count;
  const v2PlusCount = v2Count + v3Count;
  if (existsSync(statsPath)) {
    try {
      const st = JSON.parse(readFileSync(statsPath, "utf8")) as {
        statsVersion?: number;
        catalogTelemetry?: {
          snapshotDate?: string;
          totalCollected?: number;
          matureCount?: number;
          enrichedCount?: number;
          transcriptCount?: number;
          globalMatureMedianViews?: number;
          packaging?: unknown;
          linguistics?: {
            transcriptTimingSummary?: {
              sampleN?: number;
              activeSpeechSampleN?: number;
              medianActiveSpeechWpm?: number | null;
            } | null;
          };
        };
        deepDna?: {
          minSchema?: number;
          minedCount?: number;
          v2DeepDna?: { v2Count?: number };
          v3DeepDna?: {
            v3Count?: number;
            audioLoudnessSummary?: {
              sampleN?: number;
              shortTermSampleN?: number;
              silentTracksExcludedCount?: number;
              medianMaxShortTermLufs?: number | null;
            };
          };
        };
      };
      const aggN = st.deepDna?.minedCount ?? 0;
      const aggV2 = st.deepDna?.v2DeepDna?.v2Count ?? 0;
      const aggV3 = st.deepDna?.v3DeepDna?.v3Count ?? 0;
      const minS = st.deepDna?.minSchema ?? 1;
      const expectedAggN = minS === 3 ? v3Count : minS === 2 ? v2PlusCount : diskCount;
      const expectedAudioN =
        minS === 3 ? audioV3 : minS === 2 ? audioV2 + audioV3 : audioV1 + audioV2 + audioV3;
      const expected10HzN =
        minS === 3
          ? audio10HzV3
          : minS === 2
            ? audio10HzV2 + audio10HzV3
            : audio10HzV1 + audio10HzV2 + audio10HzV3;
      const audioSummary = st.deepDna?.v3DeepDna?.audioLoudnessSummary;
      const aggAudioN =
        (audioSummary?.sampleN ?? 0) + (audioSummary?.silentTracksExcludedCount ?? 0);
      const audio10HzStale =
        typeof audioSummary?.shortTermSampleN === "number"
          ? audioSummary.shortTermSampleN !== expected10HzN
          : expected10HzN > 0 && audioSummary?.medianMaxShortTermLufs === null;
      schemaFilterFlag = minS >= 2 ? ` --min-schema ${minS}` : "";
      const ct = st.catalogTelemetry;
      const timingSummary = ct?.linguistics?.transcriptTimingSummary;
      const aggTimingN = timingSummary?.sampleN ?? 0;
      const activeSpeechStale =
        typeof timingSummary?.activeSpeechSampleN === "number"
          ? timingSummary.activeSpeechSampleN !== expectedActiveSpeechN
          : expectedActiveSpeechN > 0 && timingSummary?.medianActiveSpeechWpm === null;
      const hasCurrentStatsVersion =
        st.statsVersion === CURRENT_STATS_VERSION &&
        Boolean(ct?.packaging && st.deepDna?.v2DeepDna && st.deepDna?.v3DeepDna);
      const catalogStale =
        ct?.snapshotDate !== catalog.snapshotDate ||
        ct?.totalCollected !== catalog.totalCollected ||
        ct?.matureCount !== catalog.matureCount ||
        ct?.enrichedCount !== catalog.enrichedCount ||
        ct?.transcriptCount !== catalog.transcriptCount ||
        ct?.globalMatureMedianViews !== catalog.globalMatureMedianViews ||
        aggTimingN !== expectedTimingN ||
        activeSpeechStale;
      const expectedV2 = minS === 3 ? v3Count : v2PlusCount;
      const stale =
        !hasCurrentStatsVersion ||
        catalogStale ||
        diskCount !== ck.completedCount ||
        aggN !== expectedAggN ||
        aggV2 !== expectedV2 ||
        aggV3 !== v3Count ||
        aggAudioN !== expectedAudioN ||
        audio10HzStale;
      needsAggregate = stale;
      aggSuffix = ` aggregatedN=${aggN}${stale ? " (stale: run aggregate)" : ""}`;
    } catch {
      needsAggregate = true;
      aggSuffix = " aggregatedN=corrupt (stale: run aggregate)";
    }
  } else if (diskCount > 0) {
    needsAggregate = true;
    schemaFilterFlag = v1Count > 0 && v2PlusCount > 0 ? " --min-schema 2" : "";
  }
  const schemaSplit =
    v3Count > 0 ? `(v1=${v1Count},v2=${v2Count},v3=${v3Count})` : `(v1=${v1Count},v2=${v2Count})`;
  console.log(
    `channel=${values.channel} catalog=${catalog.totalCollected} mature=${catalog.matureCount} enriched=${catalog.enrichedCount} transcripts=${catalog.transcriptCount} minedDone=${ck.completedCount} ${schemaSplit} minedFailed=${ck.failedCount}${aggSuffix} medianViews=${catalog.globalMatureMedianViews.toLocaleString("en-US")}`,
  );
  console.log(
    needsAggregate
      ? `next: bun .claude/skills/channel-dna/scripts/cli.ts aggregate --channel ${values.channel}${schemaFilterFlag}`
      : `next: bun .claude/skills/channel-dna/scripts/cli.ts mine --channel ${values.channel} --limit 20`,
  );
  process.exit(0);
}

usage(`unknown subcommand: ${cmd}`);
