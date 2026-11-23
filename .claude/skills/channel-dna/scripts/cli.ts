#!/usr/bin/env bun
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { runAggregate } from "./aggregate.ts";
import { isSafeVideoId, runCollect } from "./collect.ts";
import { loadCheckpoint, runMine } from "./mine.ts";
import { parseAndValidateDossier } from "./schema.ts";
import type { CatalogFile } from "./types.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");

const HELP = `Channel DNA Factory — collect, mine (resumable), validate, and deterministically aggregate any YouTube channel into a production skill.
  bun .claude/skills/channel-dna/scripts/cli.ts collect   --channel <slug> --url <http(s)-url> [--max-videos 300] [--enrich 120] [--transcripts 120] [--lang en,en-US,en-GB] [--corpus <dir>]
  bun .claude/skills/channel-dna/scripts/cli.ts mine      --channel <slug> [--limit 20] [--tabs 2] [--model gemini-4-hydrogen] [--thinking "Extra High"] [--media High] [--fps 24] [--system-file <path>] [--prompt-version v2] [--ids a,b] [--retry-failed] [--corpus <dir>]
  bun .claude/skills/channel-dna/scripts/cli.ts validate  <dossier.md>
  bun .claude/skills/channel-dna/scripts/cli.ts aggregate --channel <slug> [--corpus <dir>]
  bun .claude/skills/channel-dna/scripts/cli.ts status    --channel <slug> [--corpus <dir>]
Default corpus path: .claude/skills/<slug>/references/corpus (when --ids is passed without --limit, mines all unique IDs).
Exit 0: ok (or partial batch with >=1 mined); 1: runtime/validation error or batch with 0 mined and >=1 failed; 2: usage error.`;

const usage: (msg: string) => never = (msg) => {
  console.error(`${msg}\n${HELP}`);
  process.exit(2);
};

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

const resolveCorpusDir = (channel: string, custom: string | undefined): string => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(channel)) {
    usage(`--channel must be lowercase kebab-case (a-z, 0-9, -), got "${channel}"`);
  }
  return custom ? resolve(custom) : join(REPO_ROOT, ".claude/skills", channel, "references/corpus");
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
      lang: { type: "string" },
    },
  });
  if (positionals.length > 0) usage(`unexpected positional argument(s): ${positionals.join(" ")}`);
  if (!values.channel) usage("collect requires --channel <slug>");
  if (!values.url) usage("collect requires --url <youtube-url>");
  if (!/^https?:\/\//i.test(values.url)) {
    usage(`--url must start with http:// or https://, got "${values.url}"`);
  }
  const languages = values.lang
    ? values.lang
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const corpusDir = resolveCorpusDir(values.channel, values.corpus);
  const catalog = runCollect({
    channel: values.channel,
    url: values.url,
    corpusDir,
    maxVideos: posInt("--max-videos", values["max-videos"], 300, 1, 2000),
    enrichLimit: posInt("--enrich", values.enrich, 120, 0, 1000),
    transcriptLimit: posInt("--transcripts", values.transcripts, 120, 0, 1000),
    languages,
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
      model: { type: "string" },
      thinking: { type: "string" },
      media: { type: "string" },
      fps: { type: "string" },
      "system-file": { type: "string" },
      "prompt-version": { type: "string" },
      ids: { type: "string" },
      "retry-failed": { type: "boolean" },
    },
  });
  if (positionals.length > 0) usage(`unexpected positional argument(s): ${positionals.join(" ")}`);
  if (!values.channel) usage("mine requires --channel <slug>");
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
  let systemFile: string | undefined;
  if (values["system-file"] !== undefined) {
    systemFile = resolve(values["system-file"]);
    if (!existsSync(systemFile) || !statSync(systemFile).isFile()) {
      usage(`system prompt file not found: ${systemFile}`);
    }
  }
  const defaultLimit = ids && ids.length > 0 ? ids.length : 20;
  const result = await runMine({
    channel: values.channel,
    corpusDir,
    limit: posInt("--limit", values.limit, defaultLimit, 1, 500),
    tabs: posInt("--tabs", values.tabs, 2, 1, 2),
    model: values.model ?? "gemini-4-hydrogen",
    thinking: values.thinking ?? "Extra High",
    media: values.media ?? "High",
    fps: posInt("--fps", values.fps, 24, 1, 24),
    systemFile,
    promptVersion: values["prompt-version"],
    ids,
    retryFailed: !!values["retry-failed"],
  });
  console.log(
    `mined batch finished: done=${result.done}, failed=${result.failed}, quotaHalted=${result.quotaHalted}, ids=${result.processed.join(",") || "none"}`,
  );
  console.log(
    `next: bun .claude/skills/channel-dna/scripts/cli.ts aggregate --channel ${values.channel}`,
  );
  process.exit(result.failed > 0 && result.done === 0 ? 1 : 0);
}

if (cmd === "validate") {
  const file = rest[0];
  if (!file || rest.length !== 1) usage("validate requires <dossier.md>");
  const abs = resolve(file);
  if (!existsSync(abs) || !statSync(abs).isFile()) usage(`file not found: ${abs}`);
  const check = parseAndValidateDossier(readFileSync(abs, "utf8"));
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
    },
  });
  if (positionals.length > 0) usage(`unexpected positional argument(s): ${positionals.join(" ")}`);
  if (!values.channel) usage("aggregate requires --channel <slug>");
  const corpusDir = resolveCorpusDir(values.channel, values.corpus);
  const stats = runAggregate(corpusDir);
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
  console.log(
    `channel=${values.channel} catalog=${catalog.totalCollected} mature=${catalog.matureCount} enriched=${catalog.enrichedCount} transcripts=${catalog.transcriptCount} minedDone=${ck.completedCount} minedFailed=${ck.failedCount} medianViews=${catalog.globalMatureMedianViews.toLocaleString("en-US")}`,
  );
  console.log(
    `next: bun .claude/skills/channel-dna/scripts/cli.ts mine --channel ${values.channel} --limit 20`,
  );
  process.exit(0);
}

usage(`unknown subcommand: ${cmd}`);
