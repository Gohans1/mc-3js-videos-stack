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

import type {
  CatalogFile,
  CatalogVideo,
  PerformanceTier,
  RawCatalogVideo,
  TranscriptTiming,
} from "./types.ts";

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

const NON_SPACE_SCRIPT_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

const COLLECT_WORD_SEGMENTER =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

export function segmentWords(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (COLLECT_WORD_SEGMENTER && NON_SPACE_SCRIPT_RE.test(trimmed)) {
    const out: string[] = [];
    for (const seg of COLLECT_WORD_SEGMENTER.segment(trimmed)) {
      if (seg.isWordLike && /[\p{L}\p{N}]/u.test(seg.segment)) {
        out.push(seg.segment);
      }
    }
    return out;
  }
  return trimmed.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

export function splitPunctuatedSentences(raw: string): string[] {
  const txt = raw.trim();
  if (!txt) return [];
  const protectedAbbrev = txt.replace(
    /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|Inc|No|Co|Ltd|Mt|ft|lb|etc|e\.g|i\.e|U\.S\.A|U\.S|U\.K|A\.M|P\.M|Ph\.D|a\.k\.a)\./gi,
    (m) => m.replaceAll(".", "\u0000"),
  );
  return protectedAbbrev
    .split(/(?<=[.!?])(?:\s+|$)|(?<=[。！？।॥؟])\s*/)
    .map((s) => s.replaceAll("\u0000", ".").trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

export function hasReliableSentencePunctuation(
  sents: string[],
  totalWords: number,
  isGenerated: boolean | null = null,
): boolean {
  if (sents.length === 0 || totalWords <= 0) return false;
  if (sents.length === 1) {
    return /[.!?。！？।॥؟]$/.test(sents[0]!) && totalWords <= 25;
  }
  const maxSentWords = Math.max(...sents.map((s) => segmentWords(s).length));
  const avgWordsPerSent = totalWords / sents.length;
  const maxAvg = isGenerated === true ? 45 : 55;
  return avgWordsPerSent <= maxAvg && maxSentWords <= 120;
}

export function cleanTranscriptText(
  raw: string,
  isGenerated: boolean | null = null,
): {
  text: string;
  wordCount: number;
  openingSentence: string | null;
} {
  const cleaned = raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/>>+/g, " ")
    .replace(/[♪♫]+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { text: "", wordCount: 0, openingSentence: null };
  const words = segmentWords(cleaned);
  if (words.length === 0) return { text: "", wordCount: 0, openingSentence: null };
  const sents = splitPunctuatedSentences(cleaned);
  const openingSentence =
    hasReliableSentencePunctuation(sents, words.length, isGenerated) &&
    segmentWords(sents[0]!).length <= 45
      ? sents[0]!
      : words
          .slice(0, 18)
          .join(NON_SPACE_SCRIPT_RE.test(cleaned) ? "" : " ")
          .trim() || null;
  return { text: cleaned, wordCount: words.length, openingSentence };
}

export function computeTranscriptTimingFromSegments(
  rawSegments: Array<{ start: number; duration: number; text: string }>,
  durationSec: number | null,
  isGenerated: boolean | null = null,
): { text: string; timing: TranscriptTiming } | null {
  const cleaned = rawSegments
    .map((s) => ({
      start: Math.max(0, Number(s.start) || 0),
      duration: Math.max(0, Number(s.duration) || 0),
      text: String(s.text ?? "")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/\[[^\]]*\]|\([^)]*\)|>>+|[♪♫]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((s) => /[\p{L}\p{N}]/u.test(s.text))
    .sort((a, b) => a.start - b.start);
  const clampMax = durationSec && durationSec > 0 ? durationSec : Infinity;
  const spokenSegs: typeof cleaned = [];
  for (const seg of cleaned) {
    if (seg.start >= clampMax) continue;
    const prev = spokenSegs[spokenSegs.length - 1];
    if (
      prev &&
      prev.text.toLowerCase() === seg.text.toLowerCase() &&
      Math.abs(seg.start - prev.start) <= 1.5
    ) {
      prev.duration = Math.max(prev.duration, seg.start + seg.duration - prev.start);
      continue;
    }
    spokenSegs.push({ ...seg });
  }
  if (spokenSegs.length === 0) return null;
  const intervals: Array<[number, number]> = [];
  for (let i = 0; i < spokenSegs.length; i++) {
    const seg = spokenSegs[i]!;
    const nextStart = i + 1 < spokenSegs.length ? spokenSegs[i + 1]!.start : Infinity;
    const start = seg.start;
    const rawEnd = seg.start + seg.duration;
    const end = Math.max(start, Math.min(rawEnd, nextStart, clampMax));
    intervals.push([start, end]);
  }
  const firstSpokenSec = Number(intervals[0]![0].toFixed(2));
  const lastSpokenEndSec = Number(Math.max(...intervals.map(([, e]) => e)).toFixed(2));
  const merged: Array<[number, number]> = [];
  for (const [st, en] of intervals) {
    if (merged.length > 0 && st <= merged[merged.length - 1]![1]) {
      merged[merged.length - 1]![1] = Math.max(merged[merged.length - 1]![1], en);
    } else {
      merged.push([st, en]);
    }
  }
  const spokenSec = Number(merged.reduce((sum, [s, e]) => sum + (e - s), 0).toFixed(2));
  const gaps: number[] = [];
  for (let i = 1; i < merged.length; i++) {
    const g = merged[i]![0] - merged[i - 1]![1];
    if (g > 0) gaps.push(Number(g.toFixed(2)));
  }
  const maxGapSec =
    isGenerated === true ? null : gaps.length > 0 ? Number(Math.max(...gaps).toFixed(2)) : 0;
  const silenceGapCount = isGenerated === true ? null : gaps.filter((g) => g >= 0.35).length;
  const speakingCoveragePct =
    durationSec && durationSec > 0
      ? Number(Math.min(100, (spokenSec / durationSec) * 100).toFixed(1))
      : null;
  const joinedText = spokenSegs.map((s) => s.text).join(" ");
  const totalWords = segmentWords(joinedText).length;
  const activeSpan = lastSpokenEndSec - firstSpokenSec;
  const activeSpeechWpm =
    totalWords > 0 && activeSpan >= 3 ? Number((totalWords / (activeSpan / 60)).toFixed(1)) : null;
  let lateToEarlyWpmRatio: number | null = null;
  if (activeSpan >= 9 && spokenSegs.length >= 4) {
    const earlyCut = firstSpokenSec + activeSpan / 3;
    const lateCut = firstSpokenSec + (activeSpan * 2) / 3;
    let earlyWords = 0;
    let lateWords = 0;
    for (let i = 0; i < spokenSegs.length; i++) {
      const wc = segmentWords(spokenSegs[i]!.text).length;
      const [st, en] = intervals[i]!;
      const mid = (st + en) / 2;
      if (mid < earlyCut) earlyWords += wc;
      else if (mid >= lateCut) lateWords += wc;
    }
    if (earlyWords >= 4 && lateWords >= 2) {
      lateToEarlyWpmRatio = Number((lateWords / earlyWords).toFixed(2));
    }
  }
  const captionTailSec =
    durationSec && durationSec > 0
      ? Number(Math.max(0, durationSec - lastSpokenEndSec).toFixed(2))
      : null;
  return {
    text: joinedText,
    timing: {
      firstSpokenSec,
      lastSpokenEndSec,
      speakingCoveragePct,
      maxGapSec,
      silenceGapCount,
      isGenerated,
      activeSpeechWpm,
      lateToEarlyWpmRatio,
      captionTailSec,
    },
  };
}

export function extractHeatmapMetrics(
  heatmap: unknown,
  durationSec: number | null,
): {
  heatmapPeakPct: number | null;
  heatmapTailLift: number | null;
  heatmapMean: number | null;
  heatmapEarly: number | null;
  heatmapEnd: number | null;
} | null {
  if (!Array.isArray(heatmap) || heatmap.length < 10) return null;
  const bins: Array<{ start: number; end: number; value: number }> = [];
  for (const raw of heatmap) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { start_time?: unknown; end_time?: unknown; value?: unknown };
    const st = Number(r.start_time);
    const en = Number(r.end_time);
    const val = Number(r.value);
    if (Number.isFinite(st) && Number.isFinite(en) && Number.isFinite(val) && en >= st) {
      bins.push({ start: st, end: en, value: Math.max(0, val) });
    }
  }
  if (bins.length < 10) return null;
  const totalDur =
    durationSec && durationSec > 0 ? durationSec : Math.max(...bins.map((b) => b.end));
  if (!Number.isFinite(totalDur) || totalDur <= 0) return null;
  const mean = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const allVals = bins.map((b) => b.value);
  const earlyVals: number[] = [];
  const midVals: number[] = [];
  const endVals: number[] = [];
  let bestPeakVal = -1;
  let bestPeakPct: number | null = null;
  for (const b of bins) {
    const midPct = ((b.start + b.end) / 2 / totalDur) * 100;
    if (midPct < 20) earlyVals.push(b.value);
    else if (midPct <= 80) midVals.push(b.value);
    else endVals.push(b.value);
    if (midPct >= 5 && b.value > bestPeakVal) {
      bestPeakVal = b.value;
      bestPeakPct = Number(Math.min(100, midPct).toFixed(1));
    }
  }
  const hmMean = mean(allVals);
  const hmEarly = mean(earlyVals);
  const hmMid = mean(midVals);
  const hmEnd = mean(endVals);
  return {
    heatmapPeakPct: bestPeakPct,
    heatmapTailLift:
      hmEnd !== null && hmMid !== null && hmMid > 0.001 ? Number((hmEnd / hmMid).toFixed(2)) : null,
    heatmapMean: hmMean !== null ? Number(hmMean.toFixed(3)) : null,
    heatmapEarly: hmEarly !== null ? Number(hmEarly.toFixed(3)) : null,
    heatmapEnd: hmEnd !== null ? Number(hmEnd.toFixed(3)) : null,
  };
}

export function extractChapterMetrics(chapters: unknown): {
  chaptersCount: number;
  firstChapterEndSec: number | null;
  medianChapterSec: number | null;
} | null {
  if (!Array.isArray(chapters) || chapters.length < 2) return null;
  const spans: Array<{ start: number; end: number }> = [];
  for (const raw of chapters) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { start_time?: unknown; end_time?: unknown };
    const st = Number(r.start_time);
    const en = Number(r.end_time);
    if (Number.isFinite(st) && Number.isFinite(en) && en > st) {
      spans.push({ start: st, end: en });
    }
  }
  if (spans.length < 2) return null;
  spans.sort((a, b) => a.start - b.start);
  const durs = spans.map((s) => s.end - s.start);
  return {
    chaptersCount: spans.length,
    firstChapterEndSec: Number(spans[0]!.end.toFixed(1)),
    medianChapterSec: Number(median(durs).toFixed(1)),
  };
}

export function computeWpm(
  wordCount: number | null | undefined,
  durationSec: number | null | undefined,
): number | null {
  if (!wordCount || !durationSec || durationSec <= 0) return null;
  return Number((wordCount / (durationSec / 60)).toFixed(1));
}

export function extractFlatThumbnailUrl(entry: {
  thumbnail?: string;
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
}): string | null {
  if (Array.isArray(entry.thumbnails) && entry.thumbnails.length > 0) {
    const valid = entry.thumbnails
      .map((t, idx) => ({
        url: typeof t?.url === "string" ? t.url.trim() : "",
        area:
          typeof t?.width === "number" &&
          typeof t?.height === "number" &&
          t.width > 0 &&
          t.height > 0
            ? t.width * t.height
            : 0,
        idx,
      }))
      .filter((t) => /^https?:\/\//i.test(t.url))
      .sort((a, b) => b.area - a.area || b.idx - a.idx);
    if (valid.length > 0) return valid[0]!.url;
  }
  if (typeof entry.thumbnail === "string" && /^https?:\/\//i.test(entry.thumbnail.trim())) {
    return entry.thumbnail.trim();
  }
  return null;
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
    thumbnail?: string;
    thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
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
    commentCount: prev?.commentCount ?? null,
    width: prev?.width ?? null,
    height: prev?.height ?? null,
    sourceFps: prev?.sourceFps ?? null,
    thumbnailUrl: prev?.thumbnailUrl ?? extractFlatThumbnailUrl(fresh),
    detectedLanguage: prev?.detectedLanguage ?? null,
    chaptersCount: prev?.chaptersCount ?? null,
    firstChapterEndSec: prev?.firstChapterEndSec ?? null,
    medianChapterSec: prev?.medianChapterSec ?? null,
    heatmapPeakPct: prev?.heatmapPeakPct ?? null,
    heatmapTailLift: prev?.heatmapTailLift ?? null,
    heatmapMean: prev?.heatmapMean ?? null,
    heatmapEarly: prev?.heatmapEarly ?? null,
    heatmapEnd: prev?.heatmapEnd ?? null,
    enrichedMature: prev?.enrichedMature ?? null,
    offFeed: false,
    transcriptText: prev?.transcriptText ?? null,
    transcriptLangsTried: prev?.transcriptLangsTried,
    wordCount: prev?.wordCount ?? null,
    wpm: prev?.wpm ?? null,
    openingTranscriptLine: prev?.openingTranscriptLine ?? null,
    transcriptTiming: prev?.transcriptTiming ?? null,
  };
}

const formatBucketOf = (
  v: RawCatalogVideo,
  mode: "shorts_feed" | "videos_feed" | "dims" | "url_only" | "duration_only",
): "short" | "long" | "unknown" => {
  if (mode === "shorts_feed") return "short";
  if (/\/shorts\//i.test(v.url)) return "short";
  if (mode === "videos_feed") {
    if (
      typeof v.width === "number" &&
      typeof v.height === "number" &&
      v.width > 0 &&
      v.height > 0 &&
      v.height > v.width &&
      (typeof v.durationSec !== "number" || v.durationSec <= 185)
    ) {
      return "short";
    }
    return "long";
  }
  if (mode === "url_only") return "long";
  if (mode === "dims") {
    if (
      typeof v.width === "number" &&
      typeof v.height === "number" &&
      v.width > 0 &&
      v.height > 0
    ) {
      return v.height > v.width ? "short" : "long";
    }
  }
  if (typeof v.durationSec !== "number" || v.durationSec <= 0) return "unknown";
  return v.durationSec <= 185 ? "short" : "long";
};

export function computeOutlierScores(
  rawVideos: RawCatalogVideo[],
  snapshotDate: string,
  sourceUrl?: string,
): { videos: CatalogVideo[]; globalMatureMedianViews: number; matureCount: number } {
  const allHaveDates = rawVideos.every((v) => Boolean(v.uploadDate));
  const ordered = [...rawVideos].sort((a, b) => {
    if (allHaveDates && a.uploadDate !== b.uploadDate) {
      return a.uploadDate!.localeCompare(b.uploadDate!);
    }
    return b.playlistIndex - a.playlistIndex || a.id.localeCompare(b.id);
  });

  const bounds = inferMaturityBounds(ordered, snapshotDate);
  const maturityMeta = ordered.map((v) => {
    const { ageDays, isMature } = isVideoMature(v, snapshotDate, bounds);
    const normViews = ageDays !== null ? v.views / expectedAgeFraction(ageDays) : v.views;
    return { v, ageDays, isMature, normViews };
  });
  const matureOnly = maturityMeta.filter((m) => m.isMature);
  let bucketMode: "shorts_feed" | "videos_feed" | "dims" | "url_only" | "duration_only";
  if (sourceUrl && /\/shorts\/?(?:\?|$)/i.test(sourceUrl)) {
    bucketMode = "shorts_feed";
  } else if (sourceUrl && /\/videos\/?(?:\?|$)/i.test(sourceUrl)) {
    bucketMode = "videos_feed";
  } else {
    const dimCount = matureOnly.filter(
      (m) =>
        typeof m.v.width === "number" &&
        typeof m.v.height === "number" &&
        m.v.width > 0 &&
        m.v.height > 0,
    ).length;
    const shortUrlCount = matureOnly.filter((m) => /\/shorts\//i.test(m.v.url)).length;
    const nonShortUrlCount = matureOnly.length - shortUrlCount;
    if (matureOnly.length > 0 && dimCount / matureOnly.length >= 0.9) {
      bucketMode = "dims";
    } else if (shortUrlCount >= 3 && nonShortUrlCount >= 3) {
      bucketMode = "url_only";
    } else {
      bucketMode = "duration_only";
    }
  }
  const meta = maturityMeta.map((m) => ({ ...m, fmt: formatBucketOf(m.v, bucketMode) }));

  const matureIndices = meta.map((m, idx) => (m.isMature ? idx : -1)).filter((idx) => idx >= 0);
  const matureShortCount = matureIndices.filter((i) => meta[i]!.fmt === "short").length;
  const matureLongCount = matureIndices.filter((i) => meta[i]!.fmt === "long").length;
  const partitionByFormat =
    bucketMode !== "shorts_feed" && matureShortCount >= 3 && matureLongCount >= 3;
  const allMatureViews = matureIndices.map((idx) => meta[idx]!.v.views);
  const globalMatureMedianViews = Math.round(median(allMatureViews));

  const scored: CatalogVideo[] = meta.map((item, idx) => {
    const sameFmtOnly = partitionByFormat && item.fmt !== "unknown";
    const collectPeers = (matchFmt: boolean): number[] => {
      const peers: number[] = [];
      const maxOffset = meta.length - 1;
      for (let offset = 1; offset <= maxOffset && peers.length < 20; offset++) {
        for (const neighborIdx of [idx - offset, idx + offset]) {
          if (neighborIdx < 0 || neighborIdx >= meta.length) continue;
          const n = meta[neighborIdx]!;
          if (!n.isMature) continue;
          if (matchFmt && n.fmt !== item.fmt) continue;
          peers.push(n.v.views);
          if (peers.length >= 20) break;
        }
      }
      return peers;
    };
    const otherSameFmtMature = sameFmtOnly
      ? matureIndices
          .filter((j) => j !== idx && meta[j]!.fmt === item.fmt)
          .map((j) => meta[j]!.v.views)
      : [];
    const fmtPeers = sameFmtOnly ? collectPeers(true) : [];
    const peerViews = sameFmtOnly && fmtPeers.length >= 2 ? fmtPeers : collectPeers(false);
    const otherMature =
      otherSameFmtMature.length >= 2
        ? otherSameFmtMature
        : matureIndices.filter((j) => j !== idx).map((j) => meta[j]!.v.views);
    let rollingPeers: number[];
    if (item.isMature) {
      rollingPeers = peerViews.length > 0 ? peerViews : otherMature;
    } else if (sameFmtOnly && fmtPeers.length >= 3) {
      rollingPeers = fmtPeers;
    } else if (!sameFmtOnly && peerViews.length >= 5) {
      rollingPeers = peerViews;
    } else if (otherSameFmtMature.length >= 3) {
      rollingPeers = otherSameFmtMature;
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
    const commentRate =
      typeof item.v.commentCount === "number" && item.v.views > 0
        ? Number(((item.v.commentCount / item.v.views) * 100).toFixed(3))
        : null;
    const commentToLikeRatio =
      typeof item.v.commentCount === "number" &&
      typeof item.v.likes === "number" &&
      item.v.likes > 0
        ? Number(((item.v.commentCount / item.v.likes) * 100).toFixed(2))
        : null;

    return {
      ...item.v,
      ageDays: item.ageDays,
      isMature: item.isMature,
      likeRate,
      commentRate,
      commentToLikeRatio,
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

export function resolveQueueDurationOpts(
  catalog: Pick<CatalogFile, "sourceUrl" | "queueFilter">,
  queueMeta?: { minDurationSec?: number; maxDurationSec?: number } | null,
): { minDurationSec: number; maxDurationSec: number } {
  const isShortsSource = /\/shorts\/?(\?|$)/i.test(catalog.sourceUrl ?? "");
  const fallbackMax = isShortsSource ? 185 : 3600;
  const minDurationSec =
    typeof catalog.queueFilter?.minDurationSec === "number"
      ? catalog.queueFilter.minDurationSec
      : typeof queueMeta?.minDurationSec === "number"
        ? queueMeta.minDurationSec
        : 10;
  const maxDurationSec =
    typeof catalog.queueFilter?.maxDurationSec === "number"
      ? catalog.queueFilter.maxDurationSec
      : typeof queueMeta?.maxDurationSec === "number"
        ? queueMeta.maxDurationSec
        : fallbackMax;
  return { minDurationSec, maxDurationSec };
}

export function buildStratifiedQueue(
  videos: CatalogVideo[],
  minedIds: Set<string>,
  opts: { minDurationSec?: number; maxDurationSec?: number } = {},
): string[] {
  const minDurationSec = opts.minDurationSec ?? 10;
  const maxDurationSec = opts.maxDurationSec ?? 185;
  const eligible = videos.filter(
    (v) =>
      !minedIds.has(v.id) &&
      v.isMature &&
      v.durationSec !== null &&
      v.durationSec >= minDurationSec &&
      v.durationSec <= maxDurationSec,
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
  sourceUrl?: string,
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
  const outlierById = new Map(
    computeOutlierScores(videos, snapshotDate, sourceUrl).videos.map((v) => [
      v.id,
      v.outlierRolling,
    ]),
  );
  const rankScore = (v: RawCatalogVideo) => outlierById.get(v.id) ?? 1;
  const byPerfDesc = [...pool].sort(
    (a, b) => rankScore(b) - rankScore(a) || b.views - a.views || a.id.localeCompare(b.id),
  );
  const byPerfAsc = [...pool].sort(
    (a, b) => rankScore(a) - rankScore(b) || a.views - b.views || a.id.localeCompare(b.id),
  );
  const topQuota = Math.floor(remaining * 0.35);
  const botQuota = Math.floor(remaining * 0.35);

  let topAdded = 0;
  for (const v of byPerfDesc) {
    if (topAdded >= topQuota || picked.size >= limit) break;
    if (!picked.has(v.id)) {
      picked.set(v.id, v);
      topAdded++;
    }
  }
  let botAdded = 0;
  for (const v of byPerfAsc) {
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
  opts: {
    priorityIds?: string[];
    matureOnly?: boolean;
    requestedLanguages?: string[];
    backfillTiming?: boolean;
    sourceUrl?: string;
  } = {},
): RawCatalogVideo[] {
  if (limit <= 0) return [];
  const reqLangs = (opts.requestedLanguages ?? [])
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  const candidates = videos.filter((v) => {
    if (v.offFeed || v.durationSec === null || v.uploadDate === null) return false;
    if (v.transcriptText == null) return true;
    if (v.transcriptText === "") {
      if (reqLangs.length === 0) return false;
      const tried = new Set((v.transcriptLangsTried ?? []).map((l) => l.trim().toLowerCase()));
      return reqLangs.some((l) => !tried.has(l));
    }
    return (
      opts.backfillTiming === true &&
      (v.transcriptTiming == null || v.transcriptTiming.activeSpeechWpm === undefined)
    );
  });
  const mature = candidates.filter((v) => {
    const age = parseUploadDateDaysAgo(v.uploadDate, snapshotDate);
    return age !== null && age >= 30;
  });
  const young = candidates.filter((v) => {
    const age = parseUploadDateDaysAgo(v.uploadDate, snapshotDate);
    return age === null || age < 30;
  });

  const picked = new Map<string, RawCatalogVideo>();
  if (opts.priorityIds && opts.priorityIds.length > 0) {
    const matureById = new Map(mature.map((v) => [v.id, v]));
    for (const id of opts.priorityIds) {
      if (picked.size >= limit) break;
      const hit = matureById.get(id);
      if (hit && !picked.has(hit.id)) picked.set(hit.id, hit);
    }
  }

  const remainingMature = mature.filter((v) => !picked.has(v.id));
  const remSlots = limit - picked.size;
  if (remainingMature.length <= remSlots) {
    for (const v of remainingMature) picked.set(v.id, v);
  } else if (remSlots > 0) {
    const outlierById = new Map(
      computeOutlierScores(videos, snapshotDate, opts.sourceUrl).videos.map((v) => [
        v.id,
        v.outlierRolling,
      ]),
    );
    const rankScore = (v: RawCatalogVideo) => outlierById.get(v.id) ?? 1;
    const byPerfDesc = [...remainingMature].sort(
      (a, b) => rankScore(b) - rankScore(a) || b.views - a.views || a.id.localeCompare(b.id),
    );
    const byPerfAsc = [...remainingMature].sort(
      (a, b) => rankScore(a) - rankScore(b) || a.views - b.views || a.id.localeCompare(b.id),
    );
    const topQuota = Math.floor(remSlots * 0.35);
    const botQuota = Math.floor(remSlots * 0.35);
    let topAdded = 0;
    for (const v of byPerfDesc) {
      if (topAdded >= topQuota || picked.size >= limit) break;
      if (!picked.has(v.id)) {
        picked.set(v.id, v);
        topAdded++;
      }
    }
    let botAdded = 0;
    for (const v of byPerfAsc) {
      if (botAdded >= botQuota || picked.size >= limit) break;
      if (!picked.has(v.id)) {
        picked.set(v.id, v);
        botAdded++;
      }
    }
    const step = Math.max(1, Math.floor(remainingMature.length / Math.max(1, limit - picked.size)));
    for (let i = 0; i < remainingMature.length && picked.size < limit; i += step) {
      const v = remainingMature[i]!;
      if (!picked.has(v.id)) picked.set(v.id, v);
    }
    for (const v of remainingMature) {
      if (picked.size >= limit) break;
      if (!picked.has(v.id)) picked.set(v.id, v);
    }
  }

  if (opts.matureOnly !== true) {
    for (const v of young) {
      if (picked.size >= limit) break;
      if (!picked.has(v.id)) picked.set(v.id, v);
    }
  }
  return [...picked.values()].slice(0, limit);
}

interface RawTranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

interface FetchedTranscriptPayload {
  isGenerated: boolean;
  segments: RawTranscriptSegment[];
}

export function buildTranscriptFetcherPyCode(): string {
  return [
    "import json, sys",
    "from youtube_transcript_api import YouTubeTranscriptApi",
    "from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled, VideoUnavailable",
    "api = YouTubeTranscriptApi()",
    "langs = json.loads(sys.argv[2])",
    "allow_fallback = sys.argv[3] == '1'",
    "out = {}",
    "errs = {}",
    "for vid in json.loads(sys.argv[1]):",
    "  try:",
    "    all_tracks = list(api.list(vid))",
    "    ordered = [t for t in all_tracks if not t.is_generated] + [t for t in all_tracks if t.is_generated]",
    "    groups = []",
    "    seen_bases = {}",
    "    for want in langs:",
    "      wl = want.lower()",
    "      base = wl.split('-')[0]",
    "      if base not in seen_bases:",
    "        seen_bases[base] = len(groups)",
    "        groups.append((base, []))",
    "      groups[seen_bases[base]][1].append(wl)",
    "    chosen = None",
    "    for base, tags in groups:",
    "      for wl in tags:",
    "        for t in ordered:",
    "          if t.language_code.lower() == wl:",
    "            chosen = t",
    "            break",
    "        if chosen is not None:",
    "          break",
    "      if chosen is not None:",
    "        break",
    "      for t in ordered:",
    "        tc = t.language_code.lower()",
    "        if tc == base or tc.startswith(base + '-'):",
    "          chosen = t",
    "          break",
    "      if chosen is not None:",
    "        break",
    "    if chosen is None and allow_fallback and ordered:",
    "      chosen = ordered[0]",
    "    if chosen is None:",
    "      out[vid] = None",
    "      continue",
    "    fetched = chosen.fetch()",
    "    is_gen = bool(getattr(fetched, 'is_generated', chosen.is_generated))",
    "    segs = [{'start': float(s.start), 'duration': float(s.duration), 'text': s.text} for s in fetched]",
    "    out[vid] = {'isGenerated': is_gen, 'segments': segs} if segs else None",
    "  except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable):",
    "    out[vid] = None",
    "  except Exception as exc:",
    "    name = type(exc).__name__",
    "    errs[name] = errs.get(name, 0) + 1",
    "if errs:",
    "  sys.stderr.write('transient transcript errors: ' + json.dumps(errs) + '\\n')",
    "print(json.dumps(out))",
  ].join("\n");
}

function fetchBatchTranscripts(
  ids: string[],
  languages: string[],
  allowNativeFallback = true,
): Record<string, FetchedTranscriptPayload | null> {
  if (ids.length === 0) return {};
  const pyCode = buildTranscriptFetcherPyCode();
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
      allowNativeFallback ? "1" : "0",
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
    return JSON.parse(res.stdout.trim()) as Record<string, FetchedTranscriptPayload | null>;
  } catch {
    return {};
  }
}

export function isNonVodEntry(entry: {
  live_status?: string | null;
  is_live?: boolean | null;
  was_live?: boolean | null;
  availability?: string | null;
}): boolean {
  if (entry.is_live === true) return true;
  const ls = (entry.live_status ?? "").toLowerCase();
  if (ls === "is_live" || ls === "is_upcoming") return true;
  const av = (entry.availability ?? "").toLowerCase();
  if (av === "subscriber_only" || av === "private" || av === "needs_auth") return true;
  return false;
}

export function canonicalizeBcp47Tag(tag: string): string {
  const parts = tag.trim().split(/[-_]+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .map((part, idx) => {
      if (idx === 0) return part.toLowerCase();
      if (part.length === 4) return part[0]!.toUpperCase() + part.slice(1).toLowerCase();
      if (part.length === 2) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join("-");
}

export function resolveEffectiveTranscriptLanguages(
  explicitLanguages: string[] | undefined,
  videos: RawCatalogVideo[],
): string[] {
  if (explicitLanguages && explicitLanguages.length > 0) return explicitLanguages;
  const byBase = new Map<
    string,
    { total: number; variants: Map<string, { count: number; canonical: string }> }
  >();
  let total = 0;
  for (const v of videos) {
    const lang = v.detectedLanguage?.trim();
    if (!lang) continue;
    const canonical = canonicalizeBcp47Tag(lang);
    if (!canonical) continue;
    const base = canonical.split("-")[0]!.toLowerCase();
    const key = canonical.toLowerCase();
    let group = byBase.get(base);
    if (!group) {
      group = { total: 0, variants: new Map() };
      byBase.set(base, group);
    }
    group.total++;
    const prev = group.variants.get(key);
    group.variants.set(key, { count: (prev?.count ?? 0) + 1, canonical });
    total++;
  }
  if (total >= 3) {
    const topBase = [...byBase.entries()].sort((a, b) => b[1].total - a[1].total)[0];
    if (topBase && topBase[1].total / total >= 0.6 && topBase[0] !== "en") {
      const topVariant = [...topBase[1].variants.values()].sort((a, b) => b.count - a.count)[0];
      const canonical = topVariant?.canonical ?? topBase[0];
      const shortCode = topBase[0];
      return [...new Set([canonical, shortCode, "en", "en-US", "en-GB"])];
    }
  }
  return ["en", "en-US", "en-GB"];
}

export interface CollectOptions {
  channel: string;
  url: string;
  corpusDir: string;
  maxVideos: number;
  enrichLimit: number;
  transcriptLimit: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  languages?: string[];
  backfillTiming?: boolean;
  cookies?: string;
  cookiesFromBrowser?: string;
}

export function resolveCollectDurationBounds(
  url: string,
  opts: { minDurationSec?: number; maxDurationSec?: number },
  prevCatalog?: Pick<CatalogFile, "sourceUrl" | "queueFilter"> | null,
): { minDurationSec: number; maxDurationSec: number } {
  const isShortsSource = /\/shorts\/?(\?|$)/i.test(url);
  const reusePrev = prevCatalog && prevCatalog.sourceUrl === url ? prevCatalog.queueFilter : null;
  const minDurationSec = opts.minDurationSec ?? reusePrev?.minDurationSec ?? 10;
  const maxDurationSec =
    opts.maxDurationSec ?? reusePrev?.maxDurationSec ?? (isShortsSource ? 185 : 3600);
  return { minDurationSec, maxDurationSec };
}

export function assertNotRootChannelEntries(
  entries: Array<{ _type?: string; entries?: unknown[]; id?: string; url?: string }>,
  sourceUrl: string,
): void {
  if (entries.length === 0) return;
  const hasNestedPlaylists = entries.every(
    (e) =>
      e._type === "playlist" ||
      Array.isArray(e.entries) ||
      (typeof e.id === "string" && /^UC[A-Za-z0-9_-]{18,}$/.test(e.id)),
  );
  if (hasNestedPlaylists) {
    throw new Error(
      `URL returned channel tabs instead of videos (${sourceUrl}); pass an explicit /videos or /shorts tab URL`,
    );
  }
}

export function runCollect(opts: CollectOptions): CatalogFile {
  const catalogPath = join(opts.corpusDir, "catalog.json");
  const queuePath = join(opts.corpusDir, "queue.json");
  const checkpointPath = join(opts.corpusDir, "checkpoint.json");
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const cookieArgs = [
    ...(opts.cookies ? ["--cookies", opts.cookies] : []),
    ...(opts.cookiesFromBrowser ? ["--cookies-from-browser", opts.cookiesFromBrowser] : []),
  ];

  const existingById = new Map<string, RawCatalogVideo>();
  let prevCatalogMeta: Pick<CatalogFile, "sourceUrl" | "queueFilter"> | null = null;
  if (existsSync(catalogPath)) {
    const prev = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile;
    prevCatalogMeta = { sourceUrl: prev.sourceUrl, queueFilter: prev.queueFilter };
    for (const v of prev.videos ?? []) {
      const prevAge = parseUploadDateDaysAgo(v.uploadDate, prev.snapshotDate || snapshotDate);
      existingById.set(v.id, {
        ...v,
        enrichedMature:
          v.enrichedMature ?? (v.uploadDate !== null && prevAge !== null ? prevAge >= 30 : null),
      });
    }
  }

  const isShortsSource = /\/shorts\/?(\?|$)/i.test(opts.url);
  const queueDurationOpts = resolveCollectDurationBounds(opts.url, opts, prevCatalogMeta);
  if (queueDurationOpts.minDurationSec > queueDurationOpts.maxDurationSec) {
    throw new Error(
      `--min-duration (${queueDurationOpts.minDurationSec}) cannot exceed --max-duration (${queueDurationOpts.maxDurationSec})`,
    );
  }

  console.error(`[collect] Fetching up to ${opts.maxVideos} items from ${opts.url} ...`);
  const flat = spawnSync(
    "yt-dlp",
    [
      "--no-warnings",
      ...cookieArgs,
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
      _type?: string;
      entries?: unknown[];
      id?: string;
      url?: string;
      webpage_url?: string;
      title?: string;
      view_count?: number;
      duration?: number;
      upload_date?: string;
      thumbnail?: string;
      thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
      live_status?: string;
      is_live?: boolean;
      availability?: string;
    }>;
  };

  const merged: RawCatalogVideo[] = [];
  const seen = new Set<string>();
  const entries = flatJson.entries ?? [];
  assertNotRootChannelEntries(entries, opts.url);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e?.id || e._type === "playlist" || Array.isArray(e.entries)) continue;
    if (!isSafeVideoId(e.id) || seen.has(e.id) || isNonVodEntry(e)) continue;
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

  const loadMinedIds = (): Set<string> => {
    const minedIds = new Set<string>();
    if (existsSync(checkpointPath)) {
      const ck = JSON.parse(readFileSync(checkpointPath, "utf8")) as {
        entries?: Record<string, { status: string }>;
      };
      for (const [id, entry] of Object.entries(ck.entries ?? {})) {
        if (entry.status === "done") minedIds.add(id);
      }
    }
    return minedIds;
  };

  const saveSnapshot = () => {
    const scored = computeOutlierScores(merged, snapshotDate, opts.url);
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
      queueFilter: queueDurationOpts,
      videos: scored.videos,
    };
    writeJsonAtomic(catalogPath, catalog);
    const minedIds = loadMinedIds();
    const queue = buildStratifiedQueue(scored.videos, minedIds, queueDurationOpts);
    writeJsonAtomic(queuePath, {
      channel: opts.channel,
      updatedAt: new Date().toISOString(),
      minDurationSec: queueDurationOpts.minDurationSec,
      maxDurationSec: queueDurationOpts.maxDurationSec,
      remainingCount: queue.length,
      queue,
    });
    return { catalog, queue, minedIds };
  };

  saveSnapshot();

  const enrichTargets = (targets: RawCatalogVideo[], label: string): boolean => {
    if (targets.length === 0) return false;
    let botHalted = false;
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
            ...cookieArgs,
            "--ignore-errors",
            "--skip-download",
            "--write-info-json",
            "-o",
            join(infoDir, "%(id)s.%(ext)s"),
            "--",
            ...batch.map((v) => `https://www.youtube.com/watch?v=${v.id}`),
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
              comment_count?: number;
              duration?: number;
              upload_date?: string;
              width?: number;
              height?: number;
              fps?: number;
              thumbnail?: string;
              language?: string;
              live_status?: string;
              is_live?: boolean;
              availability?: string;
              chapters?: unknown;
              heatmap?: unknown;
            };
            if (isNonVodEntry(info)) {
              target.offFeed = true;
              continue;
            }
            if (info.title) target.title = info.title;
            if (
              typeof info.view_count === "number" &&
              Number.isFinite(info.view_count) &&
              info.view_count > 0
            )
              target.views = Math.max(target.views, info.view_count);
            if (typeof info.like_count === "number") target.likes = info.like_count;
            if (typeof info.comment_count === "number") target.commentCount = info.comment_count;
            if (typeof info.duration === "number") target.durationSec = info.duration;
            if (typeof info.width === "number" && info.width > 0) target.width = info.width;
            if (typeof info.height === "number" && info.height > 0) target.height = info.height;
            if (typeof info.fps === "number" && info.fps > 0) target.sourceFps = info.fps;
            if (typeof info.thumbnail === "string" && /^https?:\/\//i.test(info.thumbnail)) {
              target.thumbnailUrl = info.thumbnail;
            }
            if (typeof info.language === "string" && info.language.trim()) {
              target.detectedLanguage = info.language.trim();
            }
            const chap = extractChapterMetrics(info.chapters);
            if (chap) {
              target.chaptersCount = chap.chaptersCount;
              target.firstChapterEndSec = chap.firstChapterEndSec;
              target.medianChapterSec = chap.medianChapterSec;
            }
            const hm = extractHeatmapMetrics(info.heatmap, target.durationSec);
            if (hm) {
              target.heatmapPeakPct = hm.heatmapPeakPct;
              target.heatmapTailLift = hm.heatmapTailLift;
              target.heatmapMean = hm.heatmapMean;
              target.heatmapEarly = hm.heatmapEarly;
              target.heatmapEnd = hm.heatmapEnd;
            }
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
        if (
          /sign in to confirm you.?re not a bot|confirm you.?re not a bot|http error 403|\bipblocked\b/i.test(
            dl.stderr,
          )
        ) {
          console.error(
            `[collect] HALTING enrichment (${label}): YouTube bot-gate/403 detected. Re-run with --cookies-from-browser chrome or --cookies <file> to resume cleanly.`,
          );
          botHalted = true;
          break;
        }
      }
    } finally {
      rmSync(infoDir, { recursive: true, force: true });
    }
    return botHalted;
  };

  let remainingEnrich = opts.enrichLimit;
  let probesHalted = false;
  const initBounds = inferMaturityBounds(merged, snapshotDate);
  if (
    initBounds.maxYoungIdx === null &&
    initBounds.minMatureIdx === null &&
    remainingEnrich > MATURITY_PROBE_INDICES.length &&
    merged.length > 20
  ) {
    const probes = selectProbeTargets(merged);
    if (probes.length > 0) {
      probesHalted = enrichTargets(probes, "maturity probes");
      remainingEnrich = Math.max(0, remainingEnrich - probes.length);
    }
  }
  if (!probesHalted) {
    const toEnrich = selectEnrichmentTargets(merged, remainingEnrich, snapshotDate, opts.url);
    enrichTargets(toEnrich, "stratified metadata");
  }

  const snapAfterEnrich = saveSnapshot();
  const languages = resolveEffectiveTranscriptLanguages(opts.languages, merged);
  const priorityIds = [...snapAfterEnrich.minedIds, ...snapAfterEnrich.queue];
  const transcriptOpts = {
    priorityIds,
    requestedLanguages: languages,
    backfillTiming: opts.backfillTiming === true,
    sourceUrl: opts.url,
  };
  const hasMatureTranscriptWork =
    selectTranscriptTargets(merged, 1, snapshotDate, {
      ...transcriptOpts,
      matureOnly: true,
    }).length > 0;
  const enrichedNoTranscript = selectTranscriptTargets(merged, opts.transcriptLimit, snapshotDate, {
    ...transcriptOpts,
    matureOnly: hasMatureTranscriptWork,
  });
  if (enrichedNoTranscript.length > 0) {
    console.error(
      `[collect] Fetching transcripts/WPM (${languages.join(",")}) for ${enrichedNoTranscript.length} items (mined/queued mature first) ...`,
    );
    const allowNativeFallback = !(opts.languages && opts.languages.length > 0);
    const batchSize = 15;
    for (let i = 0; i < enrichedNoTranscript.length; i += batchSize) {
      const batch = enrichedNoTranscript.slice(i, i + batchSize);
      const map = fetchBatchTranscripts(
        batch.map((v) => v.id),
        languages,
        allowNativeFallback,
      );
      for (const target of batch) {
        if (!Object.hasOwn(map, target.id)) continue;
        target.transcriptLangsTried = [
          ...new Set([...(target.transcriptLangsTried ?? []), ...languages]),
        ];
        const payload = map[target.id];
        const timed =
          payload && Array.isArray(payload.segments) && payload.segments.length > 0
            ? computeTranscriptTimingFromSegments(
                payload.segments,
                target.durationSec,
                payload.isGenerated,
              )
            : null;
        const parsed =
          timed && timed.text
            ? cleanTranscriptText(timed.text, payload?.isGenerated ?? null)
            : null;
        if (timed && parsed && parsed.wordCount > 0) {
          target.transcriptText = parsed.text;
          target.wordCount = parsed.wordCount;
          target.wpm = computeWpm(parsed.wordCount, target.durationSec);
          target.openingTranscriptLine = parsed.openingSentence;
          target.transcriptTiming = timed.timing;
        } else if (!target.transcriptText) {
          target.transcriptText = "";
          target.wordCount = 0;
          target.wpm = null;
          target.openingTranscriptLine = null;
          target.transcriptTiming = null;
        }
      }
      saveSnapshot();
      console.error(
        `[collect] Transcripts ${Math.min(i + batchSize, enrichedNoTranscript.length)}/${enrichedNoTranscript.length}`,
      );
    }
  }

  return saveSnapshot().catalog;
}
