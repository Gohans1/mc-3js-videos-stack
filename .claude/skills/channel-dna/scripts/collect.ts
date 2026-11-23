import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { CatalogFile, CatalogVideo, PerformanceTier, RawCatalogVideo } from "./types.ts";

export const SAFE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeVideoId(id: string): boolean {
  return SAFE_VIDEO_ID_RE.test(id);
}

let atomicSeq = 0;

export function writeTextAtomic(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${++atomicSeq}`;
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, filePath);
  } finally {
    rmSync(tmpPath, { force: true });
  }
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  writeTextAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function parseUploadDateDaysAgo(
  uploadDate: string | null,
  snapshotDate: string,
): number | null {
  if (!uploadDate || !/^\d{8}$/.test(uploadDate)) return null;
  const y = Number(uploadDate.slice(0, 4));
  const m = Number(uploadDate.slice(4, 6)) - 1;
  const d = Number(uploadDate.slice(6, 8));
  const upMs = Date.UTC(y, m, d);
  const snapMs = Date.parse(`${snapshotDate}T00:00:00Z`);
  if (!Number.isFinite(upMs) || !Number.isFinite(snapMs)) return null;
  return Math.max(0, Math.round((snapMs - upMs) / 86_400_000));
}

export function expectedAgeFraction(ageDays: number): number {
  if (ageDays >= 30) return 1;
  return Math.min(1, Math.max(0.1, (Math.max(1, ageDays) / 30) ** 0.55));
}

export function inferMaturityBounds(
  rawVideos: RawCatalogVideo[],
  snapshotDate: string,
): { maxYoungIdx: number | null; minMatureIdx: number | null } {
  const live = rawVideos.filter((v) => !v.offFeed);
  let maxYoungIdx: number | null = null;
  for (const v of live) {
    const age = parseUploadDateDaysAgo(v.uploadDate, snapshotDate);
    if (age !== null && age < 30) {
      if (maxYoungIdx === null || v.playlistIndex > maxYoungIdx) maxYoungIdx = v.playlistIndex;
    }
  }
  let minMatureIdx: number | null = null;
  for (const v of live) {
    const age = parseUploadDateDaysAgo(v.uploadDate, snapshotDate);
    if (age === null || age < 30) continue;
    if (maxYoungIdx !== null && v.playlistIndex <= maxYoungIdx) continue;
    if (maxYoungIdx === null && v.playlistIndex < 3 && live.length > 6) continue;
    if (minMatureIdx === null || v.playlistIndex < minMatureIdx) minMatureIdx = v.playlistIndex;
  }
  return { maxYoungIdx, minMatureIdx };
}

export function isVideoMature(
  v: Pick<RawCatalogVideo, "playlistIndex" | "uploadDate" | "offFeed">,
  snapshotDate: string,
  bounds: { maxYoungIdx: number | null; minMatureIdx: number | null },
): { ageDays: number | null; isMature: boolean } {
  const ageDays = parseUploadDateDaysAgo(v.uploadDate, snapshotDate);
  if (ageDays !== null) {
    return { ageDays, isMature: ageDays >= 30 };
  }
  if (v.offFeed) {
    return { ageDays: null, isMature: false };
  }
  if (bounds.maxYoungIdx !== null && v.playlistIndex <= bounds.maxYoungIdx) {
    return { ageDays: null, isMature: false };
  }
  if (bounds.minMatureIdx !== null) {
    return { ageDays: null, isMature: v.playlistIndex >= bounds.minMatureIdx };
  }
  if (bounds.maxYoungIdx !== null) {
    return { ageDays: null, isMature: false };
  }
  return { ageDays: null, isMature: v.playlistIndex >= 30 };
}

export function cleanTranscriptText(raw: string): {
  text: string;
  wordCount: number;
  openingSentence: string | null;
} {
  const cleaned = raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/>>+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { text: "", wordCount: 0, openingSentence: null };
  const words = cleaned.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const sentMatch = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  const openingSentence = sentMatch
    ? sentMatch[1]!.trim()
    : words.slice(0, 18).join(" ").trim() || null;
  return { text: cleaned, wordCount: words.length, openingSentence };
}

export function computeWpm(
  wordCount: number | null | undefined,
  durationSec: number | null | undefined,
): number | null {
  if (!wordCount || !durationSec || durationSec <= 0) return null;
  return Number((wordCount / (durationSec / 60)).toFixed(1));
}

export function mergeCatalogEntry(
  prev: RawCatalogVideo | undefined,
  fresh: {
    id: string;
    title?: string;
    url?: string;
    webpage_url?: string;
    view_count?: number;
    duration?: number;
    upload_date?: string;
  },
  fallbackUrl: string,
  playlistIndex: number,
): RawCatalogVideo {
  const resolvedUrl = fresh.webpage_url?.startsWith("http")
    ? fresh.webpage_url
    : fresh.url?.startsWith("http")
      ? fresh.url
      : prev?.url || fallbackUrl;
  const freshViews =
    typeof fresh.view_count === "number" &&
    Number.isFinite(fresh.view_count) &&
    fresh.view_count > 0
      ? fresh.view_count
      : 0;
  const mergedViews = Math.max(prev?.views ?? 0, freshViews);
  return {
    id: fresh.id,
    title: fresh.title || prev?.title || "",
    url: resolvedUrl,
    playlistIndex,
    views: mergedViews,
    likes: prev?.likes ?? null,
    durationSec: prev?.durationSec ?? (typeof fresh.duration === "number" ? fresh.duration : null),
    uploadDate:
      prev?.uploadDate ?? (typeof fresh.upload_date === "string" ? fresh.upload_date : null),
    enrichedMature: prev?.enrichedMature ?? null,
    offFeed: false,
    transcriptText: prev?.transcriptText ?? null,
    wordCount: prev?.wordCount ?? null,
    wpm: prev?.wpm ?? null,
    openingTranscriptLine: prev?.openingTranscriptLine ?? null,
  };
}

export function computeOutlierScores(
  rawVideos: RawCatalogVideo[],
  snapshotDate: string,
): { videos: CatalogVideo[]; globalMatureMedianViews: number; matureCount: number } {
  const allHaveDates = rawVideos.every((v) => Boolean(v.uploadDate));
  const ordered = [...rawVideos].sort((a, b) => {
    if (allHaveDates && a.uploadDate !== b.uploadDate) {
      return a.uploadDate!.localeCompare(b.uploadDate!);
    }
    return b.playlistIndex - a.playlistIndex || a.id.localeCompare(b.id);
  });

  const bounds = inferMaturityBounds(ordered, snapshotDate);
  const meta = ordered.map((v) => {
    const { ageDays, isMature } = isVideoMature(v, snapshotDate, bounds);
    const normViews = ageDays !== null ? v.views / expectedAgeFraction(ageDays) : v.views;
    return { v, ageDays, isMature, normViews };
  });

  const matureIndices = meta.map((m, idx) => (m.isMature ? idx : -1)).filter((idx) => idx >= 0);
  const allMatureViews = matureIndices.map((idx) => meta[idx]!.v.views);
  const globalMatureMedianViews = Math.round(median(allMatureViews));

  const scored: CatalogVideo[] = meta.map((item, idx) => {
    const peerViews: number[] = [];
    for (let offset = 1; offset <= 15 && peerViews.length < 20; offset++) {
      for (const neighborIdx of [idx - offset, idx + offset]) {
        if (neighborIdx < 0 || neighborIdx >= meta.length) continue;
        const n = meta[neighborIdx]!;
        if (n.isMature) peerViews.push(n.v.views);
        if (peerViews.length >= 20) break;
      }
    }
    const otherMature = matureIndices.filter((j) => j !== idx).map((j) => meta[j]!.v.views);
    let rollingPeers: number[];
    if (item.isMature) {
      rollingPeers = peerViews.length > 0 ? peerViews : otherMature;
    } else if (peerViews.length >= 5) {
      rollingPeers = peerViews;
    } else if (allMatureViews.length > 0) {
      rollingPeers = allMatureViews;
    } else {
      rollingPeers = meta
        .filter((n, j) => j !== idx && Math.abs(j - idx) <= 10 && n.ageDays !== null)
        .map((n) => n.normViews);
    }

    const frac = item.ageDays !== null ? expectedAgeFraction(item.ageDays) : 1;
    const rollingPeerMedian =
      rollingPeers.length > 0 ? median(rollingPeers) : globalMatureMedianViews;
    const outlierRolling =
      rollingPeerMedian > 0
        ? Number((item.v.views / Math.max(rollingPeerMedian * frac, 1)).toFixed(2))
        : item.v.views > 0
          ? 1
          : 0;

    const otherDatedNorm =
      otherMature.length === 0 && globalMatureMedianViews === 0
        ? meta.filter((n, j) => j !== idx && n.ageDays !== null).map((n) => n.normViews)
        : [];
    const globalPeerMedian =
      otherMature.length > 0
        ? median(otherMature)
        : globalMatureMedianViews > 0
          ? globalMatureMedianViews
          : otherDatedNorm.length > 0
            ? median(otherDatedNorm)
            : 0;
    const outlierGlobal =
      globalPeerMedian > 0
        ? Number((item.v.views / Math.max(globalPeerMedian * frac, 1)).toFixed(2))
        : item.v.views > 0
          ? 1
          : 0;
    const likeRate =
      item.v.likes !== null && item.v.views > 0
        ? Number(((item.v.likes / item.v.views) * 100).toFixed(2))
        : null;

    return {
      ...item.v,
      ageDays: item.ageDays,
      isMature: item.isMature,
      likeRate,
      outlierRolling,
      outlierGlobal,
      tier: item.isMature ? "median" : "provisional",
    };
  });

  const matureScored = scored
    .filter((v) => v.isMature)
    .sort((a, b) => b.outlierRolling - a.outlierRolling || a.id.localeCompare(b.id));
  const band = matureScored.length >= 3 ? Math.max(1, Math.floor(matureScored.length * 0.2)) : 0;
  const winnerIds = new Set(matureScored.slice(0, band).map((v) => v.id));
  const flopIds = new Set(
    band > 0 ? matureScored.slice(matureScored.length - band).map((v) => v.id) : [],
  );

  for (const v of scored) {
    if (!v.isMature) {
      v.tier = "provisional";
    } else if (winnerIds.has(v.id)) {
      v.tier = "winner";
    } else if (flopIds.has(v.id)) {
      v.tier = "flop";
    } else {
      v.tier = "median";
    }
  }

  scored.sort((a, b) => a.playlistIndex - b.playlistIndex || a.id.localeCompare(b.id));
  return {
    videos: scored,
    globalMatureMedianViews,
    matureCount: matureScored.length,
  };
}

export function buildStratifiedQueue(videos: CatalogVideo[], minedIds: Set<string>): string[] {
  const eligible = videos.filter(
    (v) =>
      !minedIds.has(v.id) &&
      v.isMature &&
      v.durationSec !== null &&
      v.durationSec >= 10 &&
      v.durationSec <= 185,
  );
  const winners = eligible
    .filter((v) => v.tier === "winner")
    .sort((a, b) => b.outlierRolling - a.outlierRolling || a.id.localeCompare(b.id));
  const medians = eligible
    .filter((v) => v.tier === "median")
    .sort(
      (a, b) =>
        Math.abs(a.outlierRolling - 1) - Math.abs(b.outlierRolling - 1) || a.id.localeCompare(b.id),
    );
  const flops = eligible
    .filter((v) => v.tier === "flop")
    .sort((a, b) => a.outlierRolling - b.outlierRolling || a.id.localeCompare(b.id));

  const pattern: PerformanceTier[] = [
    "winner",
    "flop",
    "median",
    "winner",
    "median",
    "flop",
    "winner",
    "median",
    "flop",
    "winner",
  ];
  const buckets: Record<"winner" | "median" | "flop", CatalogVideo[]> = {
    winner: [...winners],
    median: [...medians],
    flop: [...flops],
  };

  const out: string[] = [];
  let cursor = 0;
  while (buckets.winner.length || buckets.median.length || buckets.flop.length) {
    const want = pattern[cursor % pattern.length] as "winner" | "median" | "flop";
    cursor++;
    const pick =
      buckets[want].shift() ??
      buckets.winner.shift() ??
      buckets.median.shift() ??
      buckets.flop.shift();
    if (pick) out.push(pick.id);
  }
  return out;
}

export const MATURITY_PROBE_INDICES = [3, 15, 30, 60, 120, 180] as const;

export function selectProbeTargets(videos: RawCatalogVideo[]): RawCatalogVideo[] {
  const out: RawCatalogVideo[] = [];
  for (const probeIdx of MATURITY_PROBE_INDICES) {
    const candidate = videos.find(
      (v) =>
        !v.offFeed &&
        v.playlistIndex === probeIdx &&
        (v.durationSec === null || v.uploadDate === null),
    );
    if (candidate) out.push(candidate);
  }
  return out;
}

export function selectEnrichmentTargets(
  videos: RawCatalogVideo[],
  limit: number,
  snapshotDate = new Date().toISOString().slice(0, 10),
): RawCatalogVideo[] {
  if (limit <= 0) return [];
  const bounds = inferMaturityBounds(videos, snapshotDate);
  const needsRefresh = videos.filter((v) => {
    if (v.offFeed) return false;
    if (v.durationSec === null || v.uploadDate === null) return true;
    const age = parseUploadDateDaysAgo(v.uploadDate, snapshotDate);
    return v.enrichedMature === false && age !== null && age >= 30;
  });
  if (needsRefresh.length <= limit) return needsRefresh;

  const picked = new Map<string, RawCatalogVideo>();
  const newlyMatured = needsRefresh.filter((v) => v.enrichedMature === false);
  for (const v of newlyMatured) {
    if (picked.size >= limit) break;
    picked.set(v.id, v);
  }

  const matureCandidates = needsRefresh.filter(
    (v) => !picked.has(v.id) && isVideoMature(v, snapshotDate, bounds).isMature,
  );
  const pool =
    matureCandidates.length >= limit - picked.size
      ? matureCandidates
      : needsRefresh.filter((v) => !picked.has(v.id));

  if (bounds.maxYoungIdx === null && bounds.minMatureIdx === null && videos.length > 20) {
    for (const candidate of selectProbeTargets(needsRefresh)) {
      if (picked.size < limit) picked.set(candidate.id, candidate);
    }
  }

  const remaining = limit - picked.size;
  const byViewsDesc = [...pool].sort((a, b) => b.views - a.views || a.id.localeCompare(b.id));
  const byViewsAsc = [...pool].sort((a, b) => a.views - b.views || a.id.localeCompare(b.id));
  const topQuota = Math.floor(remaining * 0.35);
  const botQuota = Math.floor(remaining * 0.35);

  let topAdded = 0;
  for (const v of byViewsDesc) {
    if (topAdded >= topQuota || picked.size >= limit) break;
    if (!picked.has(v.id)) {
      picked.set(v.id, v);
      topAdded++;
    }
  }
  let botAdded = 0;
  for (const v of byViewsAsc) {
    if (botAdded >= botQuota || picked.size >= limit) break;
    if (!picked.has(v.id)) {
      picked.set(v.id, v);
      botAdded++;
    }
  }
  const step = Math.max(1, Math.floor(pool.length / Math.max(1, limit - picked.size)));
  for (let i = 0; i < pool.length && picked.size < limit; i += step) {
    const v = pool[i]!;
    if (!picked.has(v.id)) picked.set(v.id, v);
  }
  for (const v of pool) {
    if (picked.size >= limit) break;
    if (!picked.has(v.id)) picked.set(v.id, v);
  }
  return [...picked.values()];
}

export function selectTranscriptTargets(
  videos: RawCatalogVideo[],
  limit: number,
  snapshotDate: string,
): RawCatalogVideo[] {
  if (limit <= 0) return [];
  const candidates = videos.filter(
    (v) =>
      !v.offFeed && v.durationSec !== null && v.uploadDate !== null && v.transcriptText == null,
  );
  const mature = candidates.filter((v) => {
    const age = parseUploadDateDaysAgo(v.uploadDate, snapshotDate);
    return age !== null && age >= 30;
  });
  const young = candidates.filter((v) => {
    const age = parseUploadDateDaysAgo(v.uploadDate, snapshotDate);
    return age === null || age < 30;
  });
  return [...mature, ...young].slice(0, limit);
}

function fetchBatchTranscripts(ids: string[], languages: string[]): Record<string, string | null> {
  if (ids.length === 0) return {};
  const pyCode = [
    "import json, sys",
    "from youtube_transcript_api import YouTubeTranscriptApi",
    "from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled, VideoUnavailable",
    "api = YouTubeTranscriptApi()",
    "langs = json.loads(sys.argv[2])",
    "out = {}",
    "errs = {}",
    "for vid in json.loads(sys.argv[1]):",
    "  try:",
    "    t = api.fetch(vid, languages=langs)",
    "    out[vid] = ' '.join(s.text for s in t)",
    "  except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable):",
    "    out[vid] = None",
    "  except Exception as exc:",
    "    name = type(exc).__name__",
    "    errs[name] = errs.get(name, 0) + 1",
    "if errs:",
    "  sys.stderr.write('transient transcript errors: ' + json.dumps(errs) + '\\n')",
    "print(json.dumps(out))",
  ].join("\n");
  const res = spawnSync(
    "uv",
    [
      "run",
      "--no-project",
      "--with",
      "youtube-transcript-api",
      "python",
      "-I",
      "-c",
      pyCode,
      JSON.stringify(ids),
      JSON.stringify(languages),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 },
  );
  if (res.status !== 0 || !res.stdout.trim()) {
    console.error(
      `[collect] transcript batch skipped (uv exit ${res.status}): ${(res.stderr || "").trim().slice(0, 200)}`,
    );
    return {};
  }
  if ((res.stderr || "").includes("transient transcript errors:")) {
    console.error(`[collect] ${(res.stderr || "").trim().slice(0, 200)}`);
  }
  try {
    return JSON.parse(res.stdout.trim()) as Record<string, string | null>;
  } catch {
    return {};
  }
}

export interface CollectOptions {
  channel: string;
  url: string;
  corpusDir: string;
  maxVideos: number;
  enrichLimit: number;
  transcriptLimit: number;
  languages?: string[];
}

export function runCollect(opts: CollectOptions): CatalogFile {
  const catalogPath = join(opts.corpusDir, "catalog.json");
  const queuePath = join(opts.corpusDir, "queue.json");
  const checkpointPath = join(opts.corpusDir, "checkpoint.json");
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const languages =
    opts.languages && opts.languages.length > 0 ? opts.languages : ["en", "en-US", "en-GB"];

  const existingById = new Map<string, RawCatalogVideo>();
  if (existsSync(catalogPath)) {
    const prev = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile;
    for (const v of prev.videos ?? []) {
      const prevAge = parseUploadDateDaysAgo(v.uploadDate, prev.snapshotDate || snapshotDate);
      existingById.set(v.id, {
        ...v,
        enrichedMature:
          v.enrichedMature ?? (v.uploadDate !== null && prevAge !== null ? prevAge >= 30 : null),
      });
    }
  }

  console.error(`[collect] Fetching up to ${opts.maxVideos} items from ${opts.url} ...`);
  const flat = spawnSync(
    "yt-dlp",
    [
      "--no-warnings",
      "--flat-playlist",
      "--playlist-end",
      String(opts.maxVideos),
      "-J",
      "--",
      opts.url,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 180_000, maxBuffer: 50 * 1024 * 1024 },
  );
  if (flat.status !== 0 || !flat.stdout.trim()) {
    throw new Error(
      `yt-dlp flat-playlist failed: ${(flat.stderr || flat.error?.message || "").trim()}`,
    );
  }
  const flatJson = JSON.parse(flat.stdout) as {
    entries?: Array<{
      id?: string;
      url?: string;
      webpage_url?: string;
      title?: string;
      view_count?: number;
      duration?: number;
      upload_date?: string;
    }>;
  };

  const isShortsSource = /\/shorts\/?(\?|$)/i.test(opts.url);
  const merged: RawCatalogVideo[] = [];
  const seen = new Set<string>();
  const entries = flatJson.entries ?? [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e?.id || !isSafeVideoId(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    const fallbackUrl = isShortsSource
      ? `https://www.youtube.com/shorts/${e.id}`
      : `https://www.youtube.com/watch?v=${e.id}`;
    merged.push(
      mergeCatalogEntry(existingById.get(e.id), { ...e, id: e.id }, fallbackUrl, merged.length),
    );
  }
  for (const [id, prev] of existingById) {
    if (!seen.has(id) && isSafeVideoId(id)) {
      merged.push({ ...prev, playlistIndex: merged.length, offFeed: true });
    }
  }
  console.error(
    `[collect] Catalog has ${merged.length} unique items (${existingById.size} carried over).`,
  );

  const saveSnapshot = () => {
    const scored = computeOutlierScores(merged, snapshotDate);
    const catalog: CatalogFile = {
      channel: opts.channel,
      sourceUrl: opts.url,
      snapshotDate,
      totalCollected: scored.videos.length,
      matureCount: scored.matureCount,
      enrichedCount: scored.videos.filter((v) => v.durationSec !== null && v.uploadDate !== null)
        .length,
      transcriptCount: scored.videos.filter((v) => typeof v.wpm === "number").length,
      globalMatureMedianViews: scored.globalMatureMedianViews,
      videos: scored.videos,
    };
    writeJsonAtomic(catalogPath, catalog);
    const minedIds = new Set<string>();
    if (existsSync(checkpointPath)) {
      const ck = JSON.parse(readFileSync(checkpointPath, "utf8")) as {
        entries?: Record<string, { status: string }>;
      };
      for (const [id, entry] of Object.entries(ck.entries ?? {})) {
        if (entry.status === "done") minedIds.add(id);
      }
    }
    const queue = buildStratifiedQueue(scored.videos, minedIds);
    writeJsonAtomic(queuePath, {
      channel: opts.channel,
      updatedAt: new Date().toISOString(),
      remainingCount: queue.length,
      queue,
    });
    return catalog;
  };

  saveSnapshot();

  const enrichTargets = (targets: RawCatalogVideo[], label: string) => {
    if (targets.length === 0) return;
    console.error(`[collect] Enriching ${label} (${targets.length} items) ...`);
    const infoDir = mkdtempSync(join(tmpdir(), "cdna-info-"));
    try {
      const batchSize = 10;
      for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize);
        const dl = spawnSync(
          "yt-dlp",
          [
            "--no-warnings",
            "--ignore-errors",
            "--skip-download",
            "--write-info-json",
            "-o",
            join(infoDir, "%(id)s.%(ext)s"),
            "--",
            ...batch.map((v) => v.url),
          ],
          { encoding: "utf8", windowsHide: true, timeout: 180_000 },
        );
        if (dl.status !== 0 && dl.stderr.trim()) {
          console.error(`[collect] enrich batch warning: ${dl.stderr.trim().slice(0, 200)}`);
        }
        for (const target of batch) {
          const infoFile = join(infoDir, `${target.id}.info.json`);
          if (!existsSync(infoFile)) continue;
          try {
            const info = JSON.parse(readFileSync(infoFile, "utf8")) as {
              title?: string;
              view_count?: number;
              like_count?: number;
              duration?: number;
              upload_date?: string;
            };
            if (info.title) target.title = info.title;
            if (
              typeof info.view_count === "number" &&
              Number.isFinite(info.view_count) &&
              info.view_count > 0
            )
              target.views = info.view_count;
            if (typeof info.like_count === "number") target.likes = info.like_count;
            if (typeof info.duration === "number") target.durationSec = info.duration;
            if (typeof info.upload_date === "string") {
              target.uploadDate = info.upload_date;
              const age = parseUploadDateDaysAgo(info.upload_date, snapshotDate);
              target.enrichedMature = age !== null ? age >= 30 : null;
            }
          } catch {}
        }
        saveSnapshot();
        console.error(
          `[collect] Enriched ${label} ${Math.min(i + batchSize, targets.length)}/${targets.length}`,
        );
      }
    } finally {
      rmSync(infoDir, { recursive: true, force: true });
    }
  };

  let remainingEnrich = opts.enrichLimit;
  const initBounds = inferMaturityBounds(merged, snapshotDate);
  if (
    initBounds.maxYoungIdx === null &&
    initBounds.minMatureIdx === null &&
    remainingEnrich > MATURITY_PROBE_INDICES.length &&
    merged.length > 20
  ) {
    const probes = selectProbeTargets(merged);
    if (probes.length > 0) {
      enrichTargets(probes, "maturity probes");
      remainingEnrich = Math.max(0, remainingEnrich - probes.length);
    }
  }
  const toEnrich = selectEnrichmentTargets(merged, remainingEnrich, snapshotDate);
  enrichTargets(toEnrich, "stratified metadata");

  const enrichedNoTranscript = selectTranscriptTargets(merged, opts.transcriptLimit, snapshotDate);
  if (enrichedNoTranscript.length > 0) {
    console.error(
      `[collect] Fetching transcripts/WPM (${languages.join(",")}) for ${enrichedNoTranscript.length} items (mature first) ...`,
    );
    const batchSize = 15;
    for (let i = 0; i < enrichedNoTranscript.length; i += batchSize) {
      const batch = enrichedNoTranscript.slice(i, i + batchSize);
      const map = fetchBatchTranscripts(
        batch.map((v) => v.id),
        languages,
      );
      for (const target of batch) {
        if (!Object.hasOwn(map, target.id)) continue;
        const raw = map[target.id];
        if (typeof raw === "string" && raw.trim()) {
          const parsed = cleanTranscriptText(raw);
          target.transcriptText = parsed.text;
          target.wordCount = parsed.wordCount;
          target.wpm = computeWpm(parsed.wordCount, target.durationSec);
          target.openingTranscriptLine = parsed.openingSentence;
        } else {
          target.transcriptText = "";
          target.wordCount = 0;
          target.wpm = null;
          target.openingTranscriptLine = null;
        }
      }
      saveSnapshot();
      console.error(
        `[collect] Transcripts ${Math.min(i + batchSize, enrichedNoTranscript.length)}/${enrichedNoTranscript.length}`,
      );
    }
  }

  return saveSnapshot();
}
