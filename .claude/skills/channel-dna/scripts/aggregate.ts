import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  benjaminiHochberg,
  type CatalogBandStat,
  classifyOpeningSentence,
  classifyTitleOpener,
  computeChannelMedianWpm,
  countSharedContentWords,
  countTitleWords,
  extractTrailingEmoji,
  fisherExactTwoSided,
  iqr,
  isCorruptTranscript,
  reliabilityLabel,
  splitPunctuatedSentences,
  summarizeCatalogPackaging,
  summarizeTranscriptLinguistics,
} from "./catalog-metrics.ts";
import { median, writeJsonAtomic, writeTextAtomic } from "./collect.ts";
import { renderStatsSummaryMd } from "./render-summary.ts";
import {
  buildShotSpineSummary,
  buildWithinBucketContrasts,
  canonicalCameraMove,
  canonicalTransition,
  hasDynamicMotionTransition,
  hasEscalationBeforeExplanation,
  hasSetupLe15Pct,
  hasStackedLoop,
  isMicroFpsRecord,
  type MinedRecord,
  type WithinBucketContrast,
} from "./shot-spine.ts";
import {
  AUDIO_CRAFT_SIGNAL_KEYS,
  BEAT_ROLES,
  CAMERA_ANGLES,
  type CatalogFile,
  type CatalogVideo,
  CRAFT_SIGNAL_KEYS,
  CRAFT_SIGNAL_KEYS_V2,
  CRAFT_SIGNAL_KEYS_V3,
  CURRENT_STATS_VERSION,
  type MinedVideoMeta,
  type PerformanceTier,
  type ReliabilityLevel,
  SHOT_SCALES,
  SUBSECOND_OPTICAL_CRAFT_KEYS,
  type VideoTelemetry,
} from "./types.ts";

export {
  benjaminiHochberg,
  type CatalogBandStat,
  classifyOpeningSentence,
  classifyTitleOpener,
  countTitleWords,
  CURRENT_STATS_VERSION,
  extractTrailingEmoji,
  type MinedRecord,
  renderStatsSummaryMd,
  splitPunctuatedSentences,
  type WithinBucketContrast,
};

export interface CategoryBucketStat {
  key: string;
  count: number;
  pct: number;
  medianOutlier: number | null;
  outlierIqr: number | null;
  winnerCount: number;
  medianCount: number;
  flopCount: number;
  winnerSharePct: number | null;
  flopSharePct: number | null;
  winnerToFlopLift: number | null;
  winnerMinusFlopPp: number | null;
  pValue: number | null;
  qValue: number | null;
  reliability: ReliabilityLevel;
}

export interface TierNumericSummary {
  n: number;
  medianViews: number | null;
  medianOutlier: number | null;
  durationSampleN: number;
  medianDurationSec: number | null;
  likeRateSampleN: number;
  medianLikeRate: number | null;
  commentRateSampleN: number;
  medianCommentRate: number | null;
  commentToLikeSampleN: number;
  medianCommentToLikeRatio: number | null;
  wordCountSampleN: number;
  wpmSampleN: number;
  medianWordCount: number | null;
  medianWpm: number | null;
}

const pct = (part: number, total: number): number =>
  total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;

const round1 = (n: number): number => Number(n.toFixed(1));
const round2 = (n: number): number => Number(n.toFixed(2));
const round3 = (n: number): number => Number(n.toFixed(3));
const mean = (values: number[]): number =>
  values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

function summarizeCatalogTier(
  videos: CatalogVideo[],
  channelMedianWpm?: number | null,
): TierNumericSummary {
  const durations = videos
    .map((v) => v.durationSec)
    .filter((x): x is number => typeof x === "number");
  const likeRates = videos.map((v) => v.likeRate).filter((x): x is number => typeof x === "number");
  const commentRates = videos
    .map((v) =>
      typeof v.commentRate === "number"
        ? v.commentRate
        : typeof v.commentCount === "number" && v.views > 0
          ? Number(((v.commentCount / v.views) * 100).toFixed(3))
          : null,
    )
    .filter((x): x is number => typeof x === "number");
  const commentToLikes = videos
    .map((v) =>
      typeof v.commentToLikeRatio === "number"
        ? v.commentToLikeRatio
        : typeof v.commentCount === "number" && typeof v.likes === "number" && v.likes > 0
          ? Number(((v.commentCount / v.likes) * 100).toFixed(2))
          : null,
    )
    .filter((x): x is number => typeof x === "number");
  const cleanSpoken = videos.filter((v) => !isCorruptTranscript(v, channelMedianWpm));
  const words = cleanSpoken
    .map((v) => v.wordCount)
    .filter((x): x is number => typeof x === "number" && x > 0);
  const wpms = cleanSpoken
    .map((v) => v.wpm)
    .filter((x): x is number => typeof x === "number" && x > 0);
  return {
    n: videos.length,
    medianViews: videos.length > 0 ? Math.round(median(videos.map((v) => v.views))) : null,
    medianOutlier: videos.length > 0 ? round2(median(videos.map((v) => v.outlierRolling))) : null,
    durationSampleN: durations.length,
    medianDurationSec: durations.length > 0 ? round1(median(durations)) : null,
    likeRateSampleN: likeRates.length,
    medianLikeRate: likeRates.length > 0 ? round2(median(likeRates)) : null,
    commentRateSampleN: commentRates.length,
    medianCommentRate: commentRates.length > 0 ? round3(median(commentRates)) : null,
    commentToLikeSampleN: commentToLikes.length,
    medianCommentToLikeRatio: commentToLikes.length > 0 ? round2(median(commentToLikes)) : null,
    wordCountSampleN: words.length,
    wpmSampleN: wpms.length,
    medianWordCount: words.length > 0 ? Math.round(median(words)) : null,
    medianWpm: wpms.length > 0 ? round1(median(wpms)) : null,
  };
}

function summarizeFormatGeometry(catalog: CatalogFile, records: MinedRecord[]) {
  const dimsById = new Map<string, { w: number; h: number }>();
  const fpsById = new Map<string, number>();
  for (const v of catalog.videos) {
    if (
      typeof v.width === "number" &&
      v.width > 0 &&
      typeof v.height === "number" &&
      v.height > 0
    ) {
      dimsById.set(v.id, { w: v.width, h: v.height });
    }
    if (typeof v.sourceFps === "number" && v.sourceFps > 0) {
      fpsById.set(v.id, v.sourceFps);
    }
  }
  for (const r of records) {
    if (
      typeof r.meta.sourceWidth === "number" &&
      r.meta.sourceWidth > 0 &&
      typeof r.meta.sourceHeight === "number" &&
      r.meta.sourceHeight > 0
    ) {
      dimsById.set(r.meta.id, { w: r.meta.sourceWidth, h: r.meta.sourceHeight });
    }
    if (typeof r.meta.sourceFps === "number" && r.meta.sourceFps > 0) {
      fpsById.set(r.meta.id, r.meta.sourceFps);
    }
  }

  const aspectCounts = new Map<string, number>();
  for (const { w, h } of dimsById.values()) {
    const ratio = w / h;
    const bucket =
      ratio <= 0.65
        ? "9:16_vertical"
        : ratio >= 1.5
          ? "16:9_landscape"
          : ratio >= 0.9 && ratio <= 1.15
            ? "1:1_square"
            : ratio < 1
              ? "vertical_other"
              : "landscape_other";
    aspectCounts.set(bucket, (aspectCounts.get(bucket) ?? 0) + 1);
  }
  const aspectSampleN = dimsById.size;
  const aspectBuckets = [...aspectCounts.entries()]
    .map(([bucket, count]) => ({ bucket, count, pct: pct(count, aspectSampleN) }))
    .sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket));
  const topAspect = aspectBuckets[0];
  const dominantAspect =
    aspectSampleN === 0 ? "unknown" : topAspect && topAspect.pct >= 75 ? topAspect.bucket : "mixed";

  const fpsVals = [...fpsById.values()];
  const fpsCounts = new Map<string, number>();
  for (const f of fpsVals) {
    const bucket =
      f >= 23 && f <= 25.5
        ? "24-25fps"
        : f > 25.5 && f <= 35
          ? "30fps"
          : f >= 48 && f <= 62
            ? "50-60fps"
            : "other_fps";
    fpsCounts.set(bucket, (fpsCounts.get(bucket) ?? 0) + 1);
  }
  const fpsBuckets = [...fpsCounts.entries()]
    .map(([bucket, count]) => ({ bucket, count, pct: pct(count, fpsVals.length) }))
    .sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket));

  return {
    aspectSampleN,
    dominantAspect,
    aspectBuckets,
    fpsSampleN: fpsVals.length,
    medianNativeFps: fpsVals.length > 0 ? round1(median(fpsVals)) : null,
    fpsBuckets,
  };
}

function computeFramingPcts(list: MinedRecord[]) {
  const scales: Record<string, number> = Object.fromEntries(SHOT_SCALES.map((s) => [s, 0]));
  const angles: Record<string, number> = Object.fromEntries(CAMERA_ANGLES.map((a) => [a, 0]));
  for (const r of list) {
    for (const s of SHOT_SCALES)
      scales[s] = (scales[s] ?? 0) + (r.telemetry.shot_scale_counts[s] ?? 0);
    for (const a of CAMERA_ANGLES)
      angles[a] = (angles[a] ?? 0) + (r.telemetry.camera_angle_counts[a] ?? 0);
  }
  const totalScales = Object.values(scales).reduce((s, n) => s + n, 0);
  const totalAngles = Object.values(angles).reduce((s, n) => s + n, 0);
  return {
    totalShots: totalScales,
    shotScalePcts: Object.fromEntries(
      SHOT_SCALES.map((s) => [s, pct(scales[s] ?? 0, totalScales)]),
    ),
    cameraAnglePcts: Object.fromEntries(
      CAMERA_ANGLES.map((a) => [a, pct(angles[a] ?? 0, totalAngles)]),
    ),
  };
}

function computeBoundarySummary(list: MinedRecord[]) {
  const counts = { hard_cut: 0, hidden_cut: 0, transition: 0, continuous: 0 };
  for (const r of list) {
    const b = r.telemetry.boundary_counts;
    counts.hard_cut += b.hard_cut;
    counts.hidden_cut += b.hidden_cut;
    counts.transition += b.transition;
    counts.continuous += b.continuous;
  }
  const totalNonOpening =
    counts.hard_cut + counts.hidden_cut + counts.transition + counts.continuous;
  return {
    totalNonOpening,
    counts,
    pcts: {
      hard_cut: pct(counts.hard_cut, totalNonOpening),
      hidden_cut: pct(counts.hidden_cut, totalNonOpening),
      transition: pct(counts.transition, totalNonOpening),
      continuous: pct(counts.continuous, totalNonOpening),
    },
  };
}

function computeVideoLevelBoundaries(records: MinedRecord[]) {
  const winners = records.filter((r) => r.meta.tier === "winner");
  const flops = records.filter((r) => r.meta.tier === "flop");
  const keys = ["continuous", "transition", "hidden_cut", "hard_cut"] as const;

  const perKeyEntries = keys.map((k) => {
    const shareOf = (list: MinedRecord[]) => {
      const shares: number[] = [];
      for (const r of list) {
        const b = r.telemetry.boundary_counts;
        const tot = b.hard_cut + b.hidden_cut + b.transition + b.continuous;
        if (tot > 0) shares.push((b[k] / tot) * 100);
      }
      return shares.length > 0 ? round1(mean(shares)) : null;
    };
    const prevOf = (list: MinedRecord[]) =>
      list.length > 0
        ? pct(list.filter((r) => r.telemetry.boundary_counts[k] > 0).length, list.length)
        : null;
    const winCount = winners.filter((r) => r.telemetry.boundary_counts[k] > 0).length;
    const flopCount = flops.filter((r) => r.telemetry.boundary_counts[k] > 0).length;
    return {
      key: k,
      val: {
        videoPrevalencePct: pct(
          records.filter((r) => r.telemetry.boundary_counts[k] > 0).length,
          records.length,
        ),
        winnerPrevalencePct: prevOf(winners),
        flopPrevalencePct: prevOf(flops),
        meanVideoSharePct: shareOf(records),
        winnerMeanVideoSharePct: shareOf(winners),
        flopMeanVideoSharePct: shareOf(flops),
        pValue:
          winners.length > 0 && flops.length > 0
            ? fisherExactTwoSided(
                winCount,
                flopCount,
                winners.length - winCount,
                flops.length - flopCount,
              )
            : null,
        qValue: null as number | null,
      },
    };
  });
  const perKeyQ = benjaminiHochberg(perKeyEntries.map((e) => e.val.pValue));
  for (let i = 0; i < perKeyEntries.length; i++) perKeyEntries[i]!.val.qValue = perKeyQ[i] ?? null;
  const perKey = Object.fromEntries(perKeyEntries.map((e) => [e.key, e.val]));

  const archRow = (pred: (r: MinedRecord) => boolean) => {
    const count = records.filter(pred).length;
    const winCount = winners.filter(pred).length;
    const flopCount = flops.filter(pred).length;
    const winPct = winners.length > 0 ? pct(winCount, winners.length) : null;
    const flopPct = flops.length > 0 ? pct(flopCount, flops.length) : null;
    return {
      count,
      pct: pct(count, records.length),
      winnerCount: winCount,
      flopCount,
      winnerPct: winPct,
      flopPct: flopPct,
      winnerMinusFlopPp: winPct !== null && flopPct !== null ? round1(winPct - flopPct) : null,
      pValue:
        winners.length > 0 && flops.length > 0
          ? fisherExactTwoSided(
              winCount,
              flopCount,
              winners.length - winCount,
              flops.length - flopCount,
            )
          : null,
      qValue: null as number | null,
    };
  };

  const totalBounds = (r: MinedRecord) => {
    const b = r.telemetry.boundary_counts;
    return b.hard_cut + b.hidden_cut + b.transition + b.continuous;
  };
  const cutsPerMin = (r: MinedRecord) => {
    const b = r.telemetry.boundary_counts;
    const durMin = Math.max(r.telemetry.duration_sec, 1) / 60;
    return (b.hard_cut + b.hidden_cut + b.transition) / durMin;
  };
  const editArchitecture = {
    pureOneTake: archRow((r) => {
      const b = r.telemetry.boundary_counts;
      return b.hard_cut + b.hidden_cut + b.transition === 0;
    }),
    hasStyledTransition: archRow((r) => r.telemetry.boundary_counts.transition > 0),
    hasDynamicMotionTransition: archRow(hasDynamicMotionTransition),
    hardCutsMax1: archRow((r) => r.telemetry.boundary_counts.hard_cut <= 1),
    hardCutsGe2: archRow((r) => r.telemetry.boundary_counts.hard_cut >= 2),
    hardCutDominant: archRow((r) => {
      const tot = totalBounds(r);
      return tot > 0 && r.telemetry.boundary_counts.hard_cut / tot >= 0.5;
    }),
    continuousDominant: archRow((r) => {
      const tot = totalBounds(r);
      return tot > 0 && r.telemetry.boundary_counts.continuous / tot >= 0.5;
    }),
    fastCutPace: archRow((r) => cutsPerMin(r) >= 15),
    deliberateCutPace: archRow((r) => cutsPerMin(r) < 6),
  };
  const archList = Object.values(editArchitecture);
  const archQ = benjaminiHochberg(archList.map((a) => a.pValue));
  for (let i = 0; i < archList.length; i++) archList[i]!.qValue = archQ[i] ?? null;

  return { perKey, editArchitecture };
}

export function reconcileWithCatalog(catalog: CatalogFile, records: MinedRecord[]): MinedRecord[] {
  const byId = new Map<string, CatalogVideo>(catalog.videos.map((v) => [v.id, v]));
  return records.map((r) => {
    const live = byId.get(r.meta.id);
    if (!live) return r;
    return {
      dossierMarkdown: r.dossierMarkdown,
      telemetry: r.telemetry,
      meta: {
        ...r.meta,
        title: live.title || r.meta.title,
        url: live.url || r.meta.url,
        views: live.views,
        likes: live.likes ?? r.meta.likes,
        durationSec: live.durationSec ?? r.meta.durationSec,
        uploadDate: live.uploadDate ?? r.meta.uploadDate,
        outlierRolling: live.outlierRolling,
        outlierGlobal: live.outlierGlobal,
        tier: live.tier,
        wordCount: live.wordCount ?? r.meta.wordCount,
        wpm: live.wpm ?? r.meta.wpm,
      },
    };
  });
}

export function buildCategoryStats(
  records: MinedRecord[],
  extractKey: (r: MinedRecord) => string,
): CategoryBucketStat[] {
  const total = records.length;
  const totalWinners = records.filter((r) => r.meta.tier === "winner").length;
  const totalFlops = records.filter((r) => r.meta.tier === "flop").length;
  const grouped = new Map<string, MinedRecord[]>();

  for (const r of records) {
    const k = extractKey(r);
    const list = grouped.get(k) ?? [];
    list.push(r);
    grouped.set(k, list);
  }

  const stats: CategoryBucketStat[] = [];
  for (const [key, list] of grouped) {
    const winnerCount = list.filter((r) => r.meta.tier === "winner").length;
    const medianCount = list.filter((r) => r.meta.tier === "median").length;
    const flopCount = list.filter((r) => r.meta.tier === "flop").length;
    const winnerSharePct = totalWinners > 0 ? pct(winnerCount, totalWinners) : null;
    const flopSharePct = totalFlops > 0 ? pct(flopCount, totalFlops) : null;
    const winnerToFlopLift =
      totalWinners > 0 && totalFlops > 0 && flopCount > 0
        ? round2(winnerCount / totalWinners / (flopCount / totalFlops))
        : null;
    const winnerMinusFlopPp =
      winnerSharePct !== null && flopSharePct !== null
        ? round1(winnerSharePct - flopSharePct)
        : null;
    const outliers = list.map((r) => r.meta.outlierRolling);
    const pValue =
      totalWinners > 0 && totalFlops > 0
        ? fisherExactTwoSided(
            winnerCount,
            flopCount,
            totalWinners - winnerCount,
            totalFlops - flopCount,
          )
        : null;
    stats.push({
      key,
      count: list.length,
      pct: pct(list.length, total),
      medianOutlier: outliers.length > 0 ? round2(median(outliers)) : null,
      outlierIqr: iqr(outliers),
      winnerCount,
      medianCount,
      flopCount,
      winnerSharePct,
      flopSharePct,
      winnerToFlopLift,
      winnerMinusFlopPp,
      pValue,
      qValue: null,
      reliability: reliabilityLabel(list.length),
    });
  }
  stats.sort(
    (a, b) =>
      b.count - a.count ||
      (b.medianOutlier ?? -1) - (a.medianOutlier ?? -1) ||
      a.key.localeCompare(b.key),
  );
  const qVals = benjaminiHochberg(stats.map((s) => s.pValue));
  for (let i = 0; i < stats.length; i++) stats[i]!.qValue = qVals[i] ?? null;
  return stats;
}

export function buildCrossTab(
  records: MinedRecord[],
  rowKey: (r: MinedRecord) => string,
  colKey: (r: MinedRecord) => string,
): Record<
  string,
  {
    n: number;
    medianOutlier: number | null;
    breakdown: Array<{
      key: string;
      count: number;
      pct: number;
      medianOutlier: number;
      winnerCount: number;
      flopCount: number;
    }>;
  }
> {
  const byRow = new Map<string, MinedRecord[]>();
  for (const r of records) {
    const rk = rowKey(r);
    const list = byRow.get(rk) ?? [];
    list.push(r);
    byRow.set(rk, list);
  }
  const out: Record<
    string,
    {
      n: number;
      medianOutlier: number | null;
      breakdown: Array<{
        key: string;
        count: number;
        pct: number;
        medianOutlier: number;
        winnerCount: number;
        flopCount: number;
      }>;
    }
  > = {};
  for (const [rk, list] of [...byRow.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )) {
    const byCol = new Map<string, MinedRecord[]>();
    for (const r of list) {
      const ck = colKey(r);
      const cList = byCol.get(ck) ?? [];
      cList.push(r);
      byCol.set(ck, cList);
    }
    const breakdown = [...byCol.entries()]
      .map(([ck, cList]) => ({
        key: ck,
        count: cList.length,
        pct: pct(cList.length, list.length),
        medianOutlier: round2(median(cList.map((r) => r.meta.outlierRolling))),
        winnerCount: cList.filter((r) => r.meta.tier === "winner").length,
        flopCount: cList.filter((r) => r.meta.tier === "flop").length,
      }))
      .sort(
        (a, b) =>
          b.count - a.count || b.medianOutlier - a.medianOutlier || a.key.localeCompare(b.key),
      );
    out[rk] = {
      n: list.length,
      medianOutlier:
        list.length > 0 ? round2(median(list.map((r) => r.meta.outlierRolling))) : null,
      breakdown,
    };
  }
  return out;
}

function buildSignalStats(keys: readonly string[], subset: MinedRecord[]) {
  const rows = keys
    .map((key) => {
      let pool = subset;
      if (AUDIO_CRAFT_SIGNAL_KEYS.has(key)) {
        pool = pool.filter((r) => r.meta.hasAudioStream !== false);
      }
      if (SUBSECOND_OPTICAL_CRAFT_KEYS.has(key)) {
        pool = pool.filter(isMicroFpsRecord);
      }
      const pWin = pool.filter((r) => r.meta.tier === "winner");
      const pFlop = pool.filter((r) => r.meta.tier === "flop");
      const hasTrue = (r: MinedRecord) =>
        (r.telemetry.craft_signals as Record<string, boolean | undefined>)[key] === true;
      const allCount = pool.filter(hasTrue).length;
      const winCount = pWin.filter(hasTrue).length;
      const flopCount = pFlop.filter(hasTrue).length;
      const winPct = pWin.length > 0 ? pct(winCount, pWin.length) : null;
      const flopPct = pFlop.length > 0 ? pct(flopCount, pFlop.length) : null;
      return {
        signal: key,
        sampleN: pool.length,
        count: allCount,
        pct: pct(allCount, pool.length),
        winnerPct: winPct,
        flopPct: flopPct,
        winnerMinusFlopPp: winPct !== null && flopPct !== null ? round1(winPct - flopPct) : null,
        pValue:
          pWin.length > 0 && pFlop.length > 0
            ? fisherExactTwoSided(
                winCount,
                flopCount,
                pWin.length - winCount,
                pFlop.length - flopCount,
              )
            : null,
        qValue: null as number | null,
        reliability: reliabilityLabel(allCount),
      };
    })
    .sort((a, b) => b.pct - a.pct || a.signal.localeCompare(b.signal));
  const qVals = benjaminiHochberg(rows.map((r) => r.pValue));
  for (let i = 0; i < rows.length; i++) rows[i]!.qValue = qVals[i] ?? null;
  return rows;
}

function buildMultiLabelStats(records: MinedRecord[], extractTags: (r: MinedRecord) => string[]) {
  const winners = records.filter((r) => r.meta.tier === "winner");
  const flops = records.filter((r) => r.meta.tier === "flop");
  const counts = new Map<string, { count: number; winnerCount: number; flopCount: number }>();
  for (const r of records) {
    const unique = new Set(extractTags(r).filter(Boolean));
    for (const tag of unique) {
      const cur = counts.get(tag) ?? { count: 0, winnerCount: 0, flopCount: 0 };
      cur.count++;
      if (r.meta.tier === "winner") cur.winnerCount++;
      if (r.meta.tier === "flop") cur.flopCount++;
      counts.set(tag, cur);
    }
  }
  const rows = [...counts.entries()]
    .map(([key, v]) => {
      const winPct = winners.length > 0 ? pct(v.winnerCount, winners.length) : null;
      const flopPct = flops.length > 0 ? pct(v.flopCount, flops.length) : null;
      return {
        key,
        videos: v.count,
        videoPct: pct(v.count, records.length),
        winnerPct: winPct,
        flopPct: flopPct,
        winnerMinusFlopPp: winPct !== null && flopPct !== null ? round1(winPct - flopPct) : null,
        pValue:
          winners.length > 0 && flops.length > 0
            ? fisherExactTwoSided(
                v.winnerCount,
                v.flopCount,
                winners.length - v.winnerCount,
                flops.length - v.flopCount,
              )
            : null,
        qValue: null as number | null,
        reliability: reliabilityLabel(v.count) as ReliabilityLevel,
      };
    })
    .sort((a, b) => b.videos - a.videos || a.key.localeCompare(b.key));
  const qVals = benjaminiHochberg(rows.map((r) => r.pValue));
  for (let i = 0; i < rows.length; i++) rows[i]!.qValue = qVals[i] ?? null;
  return rows;
}

function buildRehookGeometry(list: MinedRecord[]) {
  const firsts: number[] = [];
  const gaps: number[] = [];
  const maxSpans: number[] = [];
  for (const r of list) {
    const pts = [...r.telemetry.rehook_timestamps_sec]
      .filter((t) => t > 0 && t < r.telemetry.duration_sec)
      .sort((a, b) => a - b);
    if (pts.length === 0) continue;
    firsts.push(pts[0]!);
    for (let i = 1; i < pts.length; i++) gaps.push(pts[i]! - pts[i - 1]!);
    const spans = [pts[0]!];
    for (let i = 1; i < pts.length; i++) spans.push(pts[i]! - pts[i - 1]!);
    spans.push(Math.max(0, r.telemetry.duration_sec - pts[pts.length - 1]!));
    maxSpans.push(Math.max(...spans));
  }
  return {
    sampleN: firsts.length,
    medianFirstRehookSec: firsts.length > 0 ? round1(median(firsts)) : null,
    medianInterRehookGapSec: gaps.length > 0 ? round1(median(gaps)) : null,
    medianMaxUnrehookedSpanSec: maxSpans.length > 0 ? round1(median(maxSpans)) : null,
  };
}

function buildBeatSequences(records: MinedRecord[]) {
  const map = new Map<string, MinedRecord[]>();
  for (const r of records) {
    const compressed: string[] = [];
    for (const b of r.telemetry.story_beats) {
      if (compressed[compressed.length - 1] !== b.role) compressed.push(b.role);
    }
    if (compressed.length === 0) continue;
    const seq = compressed.join(" -> ");
    const list = map.get(seq) ?? [];
    list.push(r);
    map.set(seq, list);
  }
  return [...map.entries()]
    .map(([sequence, list]) => ({
      sequence,
      count: list.length,
      pct: pct(list.length, records.length),
      winnerCount: list.filter((r) => r.meta.tier === "winner").length,
      flopCount: list.filter((r) => r.meta.tier === "flop").length,
      medianOutlier: round2(median(list.map((r) => r.meta.outlierRolling))),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.medianOutlier - a.medianOutlier ||
        a.sequence.localeCompare(b.sequence),
    )
    .slice(0, 8);
}

function summarizeLoudnessSubset(list: MinedRecord[]) {
  const numVals = (
    fn: (m: NonNullable<MinedVideoMeta["audioMetrics"]>) => number | null | undefined,
  ) =>
    list
      .map((r) => (r.meta.audioMetrics ? fn(r.meta.audioMetrics) : null))
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const lufsVals = numVals((m) => m.integratedLufs);
  const lraVals = numVals((m) => m.loudnessRangeLu);
  const tpVals = numVals((m) => m.truePeakDbtp);
  const sMaxVals = numVals((m) => m.maxShortTermLufs);
  const mMaxVals = numVals((m) => m.maxMomentaryLufs);
  const plrVals = numVals((m) => m.plrDb);
  const climaxVals = numVals((m) => m.climaxLoudnessDeltaLu);
  const dropVals = numVals((m) => m.relativeDropCount);
  const silCountVals = list.map((r) => r.meta.audioMetrics?.silenceCount ?? 0);
  const silSecVals = list.map((r) => r.meta.audioMetrics?.totalSilenceSec ?? 0);
  return {
    sampleN: list.length,
    shortTermSampleN: sMaxVals.length,
    medianIntegratedLufs: lufsVals.length > 0 ? round1(median(lufsVals)) : null,
    medianLoudnessRangeLu: lraVals.length > 0 ? round1(median(lraVals)) : null,
    medianTruePeakDbtp: tpVals.length > 0 ? round1(median(tpVals)) : null,
    medianMaxShortTermLufs: sMaxVals.length > 0 ? round1(median(sMaxVals)) : null,
    medianMaxMomentaryLufs: mMaxVals.length > 0 ? round1(median(mMaxVals)) : null,
    medianPlrDb: plrVals.length > 0 ? round1(median(plrVals)) : null,
    medianClimaxLoudnessDeltaLu: climaxVals.length > 0 ? round2(median(climaxVals)) : null,
    medianRelativeDropCount: dropVals.length > 0 ? round1(median(dropVals)) : null,
    medianSilenceCount: silCountVals.length > 0 ? round1(median(silCountVals)) : null,
    medianTotalSilenceSec: silSecVals.length > 0 ? round2(median(silSecVals)) : null,
  };
}

function buildV2DeepDna(records: MinedRecord[]) {
  const v2Records = records.filter((r) => r.telemetry.schema_version >= 2);
  const v2Winners = v2Records.filter((r) => r.meta.tier === "winner");
  const v2Flops = v2Records.filter((r) => r.meta.tier === "flop");
  const v2AudioRecords = v2Records.filter((r) => r.meta.hasAudioStream !== false);

  const outroHoldVals = (list: MinedRecord[]) =>
    list
      .map((r) => r.telemetry.outro_hold_sec)
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const v2OutroAll = outroHoldVals(v2Records);
  const v2OutroWin = outroHoldVals(v2Winners);
  const v2OutroFlop = outroHoldVals(v2Flops);

  const cameraMoves = buildMultiLabelStats(v2Records, (r) =>
    (r.telemetry.camera_moves_used ?? []).map(canonicalCameraMove),
  ).map((row) => ({
    move: row.key,
    videos: row.videos,
    videoPct: row.videoPct,
    winnerPct: row.winnerPct,
    flopPct: row.flopPct,
    winnerMinusFlopPp: row.winnerMinusFlopPp,
    pValue: row.pValue,
    qValue: row.qValue,
    reliability: row.reliability,
  }));

  return {
    v2Count: v2Records.length,
    v2AudioVerifiedCount: v2AudioRecords.length,
    v2MicroFpsCount: v2Records.filter(isMicroFpsRecord).length,
    medianOutroHoldSec: v2OutroAll.length > 0 ? round2(median(v2OutroAll)) : null,
    winnerMedianOutroHoldSec: v2OutroWin.length > 0 ? round2(median(v2OutroWin)) : null,
    flopMedianOutroHoldSec: v2OutroFlop.length > 0 ? round2(median(v2OutroFlop)) : null,
    distributions: {
      visualMedium: buildCategoryStats(v2Records, (r) => r.telemetry.visual_medium || "unknown"),
      protagonistFormat: buildCategoryStats(
        v2Records,
        (r) => r.telemetry.protagonist_format || "unknown",
      ),
      narrationPov: buildCategoryStats(
        v2AudioRecords,
        (r) => r.telemetry.narration_pov || "unknown",
      ),
      voiceDelivery: buildCategoryStats(
        v2AudioRecords,
        (r) => r.telemetry.voice_delivery || "unknown",
      ),
      captionStyle: buildCategoryStats(v2Records, (r) => r.telemetry.caption_style || "unknown"),
      emotionalDriver: buildCategoryStats(
        v2Records,
        (r) => r.telemetry.emotional_driver || "unknown",
      ),
      shadowQuality: buildCategoryStats(v2Records, (r) => r.telemetry.shadow_quality || "unknown"),
      colorPaletteMood: buildCategoryStats(
        v2Records,
        (r) => r.telemetry.color_palette_mood || "unknown",
      ),
      bgmMood: buildCategoryStats(v2AudioRecords, (r) => r.telemetry.bgm_mood || "unknown"),
      sfxDensity: buildCategoryStats(v2AudioRecords, (r) => r.telemetry.sfx_density || "unknown"),
    },
    cameraMoves,
    v2CraftSignals: buildSignalStats(CRAFT_SIGNAL_KEYS_V2, v2Records),
  };
}

function buildV3DeepDna(records: MinedRecord[]) {
  const v3Records = records.filter((r) => r.telemetry.schema_version >= 3);
  const v3AudioRecords = v3Records.filter((r) => r.meta.hasAudioStream !== false);
  const v3MicroRecords = v3Records.filter(isMicroFpsRecord);
  const v3WithThumbnail = v3Records.filter(
    (r) =>
      r.telemetry.thumbnail_archetype &&
      r.telemetry.thumbnail_archetype !== "not_applicable_shorts_feed" &&
      r.telemetry.thumbnail_archetype !== "no_thumbnail_provided",
  );

  const rawMeasuredAudio = records.filter(
    (r) => r.meta.hasAudioStream !== false && Boolean(r.meta.audioMetrics),
  );
  const isSilentMeasured = (r: MinedRecord) => {
    const m = r.meta.audioMetrics!;
    return (
      m.isSilentTrack === true ||
      (typeof m.integratedLufs === "number" && m.integratedLufs <= -69.5) ||
      m.truePeakDbtp === null
    );
  };
  const measuredAudio = rawMeasuredAudio.filter((r) => !isSilentMeasured(r));
  const silentTracksExcludedCount = rawMeasuredAudio.length - measuredAudio.length;
  const measuredWin = measuredAudio.filter((r) => r.meta.tier === "winner");
  const measuredFlop = measuredAudio.filter((r) => r.meta.tier === "flop");

  return {
    v3Count: v3Records.length,
    v3AudioVerifiedCount: v3AudioRecords.length,
    v3MicroFpsCount: v3MicroRecords.length,
    v3ThumbnailVerifiedCount: v3WithThumbnail.length,
    distributions: {
      actingMode: buildCategoryStats(v3Records, (r) => r.telemetry.acting_mode || "unknown"),
      setArchitecture: buildCategoryStats(
        v3Records,
        (r) => r.telemetry.set_architecture || "unknown",
      ),
      visualLayerFormat: buildCategoryStats(
        v3Records,
        (r) => r.telemetry.visual_layer_format || "unknown",
      ),
      stakesEngine: buildCategoryStats(v3Records, (r) => r.telemetry.stakes_engine || "unknown"),
      cameraMotionPersistence: buildCategoryStats(
        v3Records,
        (r) => r.telemetry.camera_motion_persistence || "unknown",
      ),
      cameraVelocityProfile: buildCategoryStats(
        v3Records,
        (r) => r.telemetry.camera_velocity_profile || "unknown",
      ),
      framingAnchor: buildCategoryStats(v3Records, (r) => r.telemetry.framing_anchor || "unknown"),
      bgmTwistBehavior: buildCategoryStats(
        v3AudioRecords,
        (r) => r.telemetry.bgm_twist_behavior || "unknown",
      ),
      bgmEndingBehavior: buildCategoryStats(
        v3AudioRecords,
        (r) => r.telemetry.bgm_ending_behavior || "unknown",
      ),
      endingValence: buildCategoryStats(v3Records, (r) => r.telemetry.ending_valence || "unknown"),
      titleHookRelation: buildCategoryStats(
        v3Records,
        (r) => r.telemetry.title_hook_relation || "unknown",
      ),
      openingScrollStopState: buildCategoryStats(
        v3Records,
        (r) => r.telemetry.opening_scroll_stop_state || "unknown",
      ),
      openLoopPayoffTiming: buildCategoryStats(
        v3Records,
        (r) => r.telemetry.open_loop_payoff_timing || "unknown",
      ),
      voVisualRelation: buildCategoryStats(
        v3AudioRecords,
        (r) => r.telemetry.vo_visual_relation || "unknown",
      ),
      narrativeTimeline: buildCategoryStats(
        v3Records,
        (r) => r.telemetry.narrative_timeline || "unknown",
      ),
      openLoopArchitecture: buildCategoryStats(
        v3Records,
        (r) => r.telemetry.open_loop_architecture || "unknown",
      ),
      informationRevealMode: buildCategoryStats(
        v3Records,
        (r) => r.telemetry.information_reveal_mode || "unknown",
      ),
      thumbnailArchetype: buildCategoryStats(
        v3WithThumbnail,
        (r) => r.telemetry.thumbnail_archetype || "unknown",
      ),
      thumbnailTextRelation: buildCategoryStats(
        v3WithThumbnail,
        (r) => r.telemetry.thumbnail_text_relation || "unknown",
      ),
      thumbnailOpeningPayoff: buildCategoryStats(
        v3WithThumbnail,
        (r) => r.telemetry.thumbnail_opening_payoff || "unknown",
      ),
      thumbnailFocalComplexity: buildCategoryStats(
        v3WithThumbnail,
        (r) => r.telemetry.thumbnail_focal_complexity || "unknown",
      ),
      thumbnailGazeOrCue: buildCategoryStats(
        v3WithThumbnail,
        (r) => r.telemetry.thumbnail_gaze_or_cue || "unknown",
      ),
    },
    sfxLayersUsed: buildMultiLabelStats(v3AudioRecords, (r) => r.telemetry.sfx_layers_used ?? []),
    timeRemapTypes: buildMultiLabelStats(v3MicroRecords, (r) => r.telemetry.time_remap_types ?? []),
    v3CraftSignals: buildSignalStats(CRAFT_SIGNAL_KEYS_V3, v3Records),
    audioLoudnessSummary: {
      ...summarizeLoudnessSubset(measuredAudio),
      silentTracksExcludedCount,
      byTier: {
        winner: summarizeLoudnessSubset(measuredWin),
        flop: summarizeLoudnessSubset(measuredFlop),
      },
    },
  };
}

export function aggregateCorpus(catalog: CatalogFile, rawRecords: MinedRecord[], minSchema = 1) {
  const records = reconcileWithCatalog(
    catalog,
    rawRecords.filter(({ telemetry }) => telemetry.schema_version >= minSchema),
  );
  const matureCatalog = catalog.videos.filter((v) => v.isMature);
  const channelMedianWpm = computeChannelMedianWpm(matureCatalog);
  const catalogById = new Map<string, CatalogVideo>(catalog.videos.map((v) => [v.id, v]));
  const matureEnrichedCount = matureCatalog.filter(
    (v) => v.durationSec !== null && v.uploadDate !== null,
  ).length;
  const matureTranscriptCount = matureCatalog.filter(
    (v) => typeof v.wpm === "number" && v.wpm > 0,
  ).length;
  const catalogTelemetry = {
    snapshotDate: catalog.snapshotDate,
    totalCollected: catalog.totalCollected,
    matureCount: matureCatalog.length,
    enrichedCount: catalog.enrichedCount,
    matureEnrichedCount,
    transcriptCount: catalog.transcriptCount,
    matureTranscriptCount,
    globalMatureMedianViews: catalog.globalMatureMedianViews,
    formatGeometry: summarizeFormatGeometry(catalog, records),
    overallMature: summarizeCatalogTier(matureCatalog, channelMedianWpm),
    byTier: {
      winner: summarizeCatalogTier(
        matureCatalog.filter((v) => v.tier === "winner"),
        channelMedianWpm,
      ),
      median: summarizeCatalogTier(
        matureCatalog.filter((v) => v.tier === "median"),
        channelMedianWpm,
      ),
      flop: summarizeCatalogTier(
        matureCatalog.filter((v) => v.tier === "flop"),
        channelMedianWpm,
      ),
    },
    packaging: summarizeCatalogPackaging(matureCatalog),
    linguistics: summarizeTranscriptLinguistics(matureCatalog),
  };

  const total = records.length;
  const winners = records.filter((r) => r.meta.tier === "winner");
  const medians = records.filter((r) => r.meta.tier === "median");
  const flops = records.filter((r) => r.meta.tier === "flop");
  const audioRecords = records.filter((r) => r.meta.hasAudioStream !== false);
  const microFpsRecords = records.filter(isMicroFpsRecord);
  const macroLowFpsCount = total - microFpsRecords.length;
  const editRecords = microFpsRecords.length > 0 ? microFpsRecords : records;
  const editFpsMode: "micro_24fps" | "macro_lowfps" =
    microFpsRecords.length > 0 ? "micro_24fps" : "macro_lowfps";
  const editWinners = editRecords.filter((r) => r.meta.tier === "winner");
  const editFlops = editRecords.filter((r) => r.meta.tier === "flop");
  const v2PlusRecords = records.filter((r) => r.telemetry.schema_version >= 2);
  const v2PlusAudioRecords = v2PlusRecords.filter((r) => r.meta.hasAudioStream !== false);
  const v3Records = records.filter((r) => r.telemetry.schema_version >= 3);

  const cutsPerMinAll: number[] = [];
  const cutsPerMinWinners: number[] = [];
  const cutsPerMinFlops: number[] = [];
  const beatsPerMinAll: number[] = [];
  const beatsPerMinWinners: number[] = [];
  const beatsPerMinFlops: number[] = [];
  const avgShotSecAll: number[] = [];
  const avgShotSecWinners: number[] = [];
  const avgShotSecFlops: number[] = [];

  for (const r of editRecords) {
    const b = r.telemetry.boundary_counts;
    const durMin = Math.max(r.telemetry.duration_sec / 60, 0.05);
    const editCuts = b.hard_cut + b.hidden_cut + b.transition;
    const cpm = editCuts / durMin;
    const bpm = (editCuts + b.continuous) / durMin;
    const shotCount = Object.values(r.telemetry.shot_scale_counts).reduce((s, n) => s + n, 0);
    const avgShot = shotCount > 0 ? r.telemetry.duration_sec / shotCount : r.telemetry.duration_sec;

    cutsPerMinAll.push(cpm);
    beatsPerMinAll.push(bpm);
    avgShotSecAll.push(avgShot);
    if (r.meta.tier === "winner") {
      cutsPerMinWinners.push(cpm);
      beatsPerMinWinners.push(bpm);
      avgShotSecWinners.push(avgShot);
    }
    if (r.meta.tier === "flop") {
      cutsPerMinFlops.push(cpm);
      beatsPerMinFlops.push(bpm);
      avgShotSecFlops.push(avgShot);
    }
  }

  const transitionTypes = buildMultiLabelStats(editRecords, (r) =>
    r.telemetry.boundary_counts.transition > 0
      ? r.telemetry.transition_types.map(canonicalTransition)
      : [],
  ).map((row) => ({
    type: row.key,
    videos: row.videos,
    videoPct: row.videoPct,
    winnerPct: row.winnerPct,
    flopPct: row.flopPct,
    winnerMinusFlopPp: row.winnerMinusFlopPp,
    pValue: row.pValue,
    qValue: row.qValue,
    reliability: row.reliability,
  }));

  const boundaryAll = computeBoundarySummary(editRecords);
  const boundaryWinner = computeBoundarySummary(editWinners);
  const boundaryFlop = computeBoundarySummary(editFlops);
  const videoLevelBoundaries = computeVideoLevelBoundaries(editRecords);
  const framingOverall = computeFramingPcts(editRecords);
  const framingWinner = computeFramingPcts(editWinners);
  const framingFlop = computeFramingPcts(editFlops);

  const beatBudgets = BEAT_ROLES.map((role) => {
    const roleVals = (list: MinedRecord[]) => {
      const vals: number[] = [];
      for (const r of list) {
        const rolePct = r.telemetry.story_beats
          .filter((b) => b.role === role)
          .reduce((sum, b) => sum + b.pct_runtime, 0);
        if (rolePct > 0) vals.push(rolePct);
      }
      return vals;
    };
    const vals = roleVals(records);
    const wVals = roleVals(winners);
    const fVals = roleVals(flops);
    return {
      role,
      presentInVideos: vals.length,
      presencePct: pct(vals.length, total),
      medianPctWhenPresent: vals.length > 0 ? round1(median(vals)) : 0,
      winnerPresencePct: winners.length > 0 ? pct(wVals.length, winners.length) : null,
      flopPresencePct: flops.length > 0 ? pct(fVals.length, flops.length) : null,
      winnerMedianPctWhenPresent: wVals.length > 0 ? round1(median(wVals)) : null,
      flopMedianPctWhenPresent: fVals.length > 0 ? round1(median(fVals)) : null,
    };
  }).filter((b) => b.presentInVideos > 0);

  const hasLateTwist = (r: MinedRecord) =>
    typeof r.telemetry.twist_at_pct === "number" && r.telemetry.twist_at_pct >= 65;

  const tierShareWithP = (pred: (r: MinedRecord) => boolean) => {
    const allC = records.filter(pred).length;
    const winC = winners.filter(pred).length;
    const flopC = flops.filter(pred).length;
    return {
      overall: pct(allC, total),
      winner: winners.length > 0 ? pct(winC, winners.length) : null,
      flop: flops.length > 0 ? pct(flopC, flops.length) : null,
      pValue:
        winners.length > 0 && flops.length > 0
          ? fisherExactTwoSided(winC, flopC, winners.length - winC, flops.length - flopC)
          : null,
      qValue: null as number | null,
    };
  };

  const voicedWithOpening = records.filter(
    (r) =>
      r.meta.hasAudioStream !== false &&
      typeof r.telemetry.opening_spoken_line === "string" &&
      r.telemetry.opening_spoken_line.trim().length > 0 &&
      r.meta.title.trim().length > 0,
  );
  const voicedW = voicedWithOpening.filter((r) => r.meta.tier === "winner");
  const voicedF = voicedWithOpening.filter((r) => r.meta.tier === "flop");
  const isAnchored = (r: MinedRecord) =>
    countSharedContentWords(r.meta.title, r.telemetry.opening_spoken_line ?? "") >= 1;
  const ancAll = voicedWithOpening.filter(isAnchored).length;
  const ancW = voicedW.filter(isAnchored).length;
  const ancF = voicedF.filter(isAnchored).length;

  const storyDynamics = {
    stackedLoopSharePct: tierShareWithP(hasStackedLoop),
    lateTwist65Pct: tierShareWithP(hasLateTwist),
    setupLe15Pct: tierShareWithP(hasSetupLe15Pct),
    escalationBeforeExplanationPct: tierShareWithP(hasEscalationBeforeExplanation),
    beatSequences: buildBeatSequences(records),
    rehookGeometry: {
      overall: buildRehookGeometry(records),
      winner: buildRehookGeometry(winners),
      flop: buildRehookGeometry(flops),
    },
    openingLineAnchor: {
      sampleN: voicedWithOpening.length,
      anchoredPct: voicedWithOpening.length > 0 ? pct(ancAll, voicedWithOpening.length) : null,
      winnerAnchoredPct: voicedW.length > 0 ? pct(ancW, voicedW.length) : null,
      flopAnchoredPct: voicedF.length > 0 ? pct(ancF, voicedF.length) : null,
      pValue:
        voicedW.length > 0 && voicedF.length > 0
          ? fisherExactTwoSided(ancW, ancF, voicedW.length - ancW, voicedF.length - ancF)
          : null,
      qValue: null as number | null,
    },
  };
  const sdTests = [
    storyDynamics.stackedLoopSharePct,
    storyDynamics.lateTwist65Pct,
    storyDynamics.setupLe15Pct,
    storyDynamics.escalationBeforeExplanationPct,
    storyDynamics.openingLineAnchor,
  ];
  const sdQ = benjaminiHochberg(sdTests.map((t) => t.pValue));
  for (let i = 0; i < sdTests.length; i++) sdTests[i]!.qValue = sdQ[i] ?? null;

  const craftSignals = buildSignalStats(CRAFT_SIGNAL_KEYS, records);
  const v2DeepDna = buildV2DeepDna(records);
  const v3DeepDna = buildV3DeepDna(records);
  const shotSpine = buildShotSpineSummary(records);
  const contrastRes = buildWithinBucketContrasts(records);

  const twistAll = records
    .map((r) => r.telemetry.twist_at_pct)
    .filter((x): x is number => typeof x === "number");
  const twistWin = winners
    .map((r) => r.telemetry.twist_at_pct)
    .filter((x): x is number => typeof x === "number");
  const twistFlop = flops
    .map((r) => r.telemetry.twist_at_pct)
    .filter((x): x is number => typeof x === "number");

  const tierMetric = (list: MinedRecord[]) => {
    const wpms = list
      .filter((r) => {
        if (typeof r.meta.wpm !== "number" || r.meta.wpm <= 0) return false;
        const cat = catalogById.get(r.meta.id);
        return !isCorruptTranscript(
          cat ?? {
            transcriptText: null,
            wordCount: r.meta.wordCount,
            wpm: r.meta.wpm,
            durationSec: r.meta.durationSec,
            transcriptTiming: null,
          },
          channelMedianWpm,
        );
      })
      .map((r) => r.meta.wpm!);
    const rehookIntervals = list.map(
      (r) => r.telemetry.duration_sec / (r.telemetry.rehook_timestamps_sec.length + 1),
    );
    return {
      n: list.length,
      medianOutlierRolling:
        list.length > 0 ? round2(median(list.map((r) => r.meta.outlierRolling))) : null,
      medianDurationSec:
        list.length > 0 ? round1(median(list.map((r) => r.telemetry.duration_sec))) : null,
      medianOpeningShotSec:
        list.length > 0 ? round2(median(list.map((r) => r.telemetry.opening_shot_sec))) : null,
      medianRehookCount:
        list.length > 0
          ? round1(median(list.map((r) => r.telemetry.rehook_timestamps_sec.length)))
          : null,
      medianRehookIntervalSec: rehookIntervals.length > 0 ? round1(median(rehookIntervals)) : null,
      twistPresencePct:
        list.length > 0
          ? pct(list.filter((r) => r.telemetry.twist_at_pct !== null).length, list.length)
          : null,
      wpmSampleN: wpms.length,
      medianWpm: wpms.length > 0 ? round1(median(wpms)) : null,
    };
  };

  const exemplars = [...records]
    .sort(
      (a, b) => b.meta.outlierRolling - a.meta.outlierRolling || a.meta.id.localeCompare(b.meta.id),
    )
    .map((r) => ({
      id: r.meta.id,
      title: r.meta.title,
      tier: r.meta.tier as PerformanceTier,
      views: r.meta.views,
      outlierRolling: r.meta.outlierRolling,
      durationSec: r.telemetry.duration_sec,
      wpm: r.meta.wpm,
      topic: r.telemetry.topic_category,
      topicSublabel: r.telemetry.topic_sublabel,
      hook: r.telemetry.hook_archetype,
      openingShotSec: r.telemetry.opening_shot_sec,
      openingLine: r.telemetry.opening_spoken_line,
      hookVisualTrigger: r.telemetry.hook_visual_trigger,
      emotionalDriver: r.telemetry.emotional_driver ?? null,
      narrationPov: r.meta.hasAudioStream === false ? null : (r.telemetry.narration_pov ?? null),
      voiceDelivery: r.meta.hasAudioStream === false ? null : (r.telemetry.voice_delivery ?? null),
      outroHoldSec: r.telemetry.outro_hold_sec ?? null,
      story: r.telemetry.story_structure,
      connector: r.telemetry.narrative_connector,
      ending: r.telemetry.ending_type,
      twistAtPct: r.telemetry.twist_at_pct,
      scriptTemplate: r.telemetry.reusable_script_template,
      secretSauce: r.telemetry.secret_sauce_cues,
      weaknesses: r.telemetry.weaknesses_or_drag,
    }));

  return {
    statsVersion: CURRENT_STATS_VERSION,
    channel: catalog.channel,
    generatedAt: new Date().toISOString(),
    catalogTelemetry,
    deepDna: {
      minSchema,
      minedCount: total,
      audioVerifiedCount: audioRecords.length,
      microFpsSampleN: microFpsRecords.length,
      macroLowFpsCount,
      editSampleN: editRecords.length,
      editFpsMode,
      editMacroExcludedCount: total - editRecords.length,
      tierCounts: {
        winner: winners.length,
        median: medians.length,
        flop: flops.length,
        provisional: records.filter((r) => r.meta.tier === "provisional").length,
      },
      pacingAndTiming: {
        overall: tierMetric(records),
        winner: tierMetric(winners),
        median: tierMetric(medians),
        flop: tierMetric(flops),
        medianTwistAtPct: twistAll.length > 0 ? round1(median(twistAll)) : null,
        winnerMedianTwistAtPct: twistWin.length > 0 ? round1(median(twistWin)) : null,
        flopMedianTwistAtPct: twistFlop.length > 0 ? round1(median(twistFlop)) : null,
        medianEditCutsPerMin: cutsPerMinAll.length > 0 ? round1(median(cutsPerMinAll)) : null,
        winnerMedianEditCutsPerMin:
          cutsPerMinWinners.length > 0 ? round1(median(cutsPerMinWinners)) : null,
        flopMedianEditCutsPerMin:
          cutsPerMinFlops.length > 0 ? round1(median(cutsPerMinFlops)) : null,
        medianTotalBeatsPerMin: beatsPerMinAll.length > 0 ? round1(median(beatsPerMinAll)) : null,
        winnerMedianTotalBeatsPerMin:
          beatsPerMinWinners.length > 0 ? round1(median(beatsPerMinWinners)) : null,
        flopMedianTotalBeatsPerMin:
          beatsPerMinFlops.length > 0 ? round1(median(beatsPerMinFlops)) : null,
        medianAvgShotSec: avgShotSecAll.length > 0 ? round2(median(avgShotSecAll)) : null,
        winnerMedianAvgShotSec:
          avgShotSecWinners.length > 0 ? round2(median(avgShotSecWinners)) : null,
        flopMedianAvgShotSec: avgShotSecFlops.length > 0 ? round2(median(avgShotSecFlops)) : null,
      },
      distributions: {
        topicCategory: buildCategoryStats(records, (r) => r.telemetry.topic_category),
        hookArchetype: buildCategoryStats(records, (r) => r.telemetry.hook_archetype),
        storyStructure: buildCategoryStats(records, (r) => r.telemetry.story_structure),
        narrativeConnector: buildCategoryStats(records, (r) => r.telemetry.narrative_connector),
        endingType: buildCategoryStats(records, (r) => r.telemetry.ending_type),
        cameraEnergy: buildCategoryStats(records, (r) => r.telemetry.camera_energy),
        dominantLensFeel: buildCategoryStats(records, (r) => r.telemetry.dominant_lens_feel),
        lightingStyle: buildCategoryStats(records, (r) => r.telemetry.lighting_style),
        easingEnergy: buildCategoryStats(records, (r) => r.telemetry.easing_energy),
        audioBedStyle: buildCategoryStats(audioRecords, (r) => r.telemetry.audio_bed_style),
      },
      crossTabs: {
        hookByTopic: buildCrossTab(
          records,
          (r) => r.telemetry.topic_category,
          (r) => r.telemetry.hook_archetype,
        ),
        storyByTopic: buildCrossTab(
          records,
          (r) => r.telemetry.topic_category,
          (r) => r.telemetry.story_structure,
        ),
        endingByTopic: buildCrossTab(
          records,
          (r) => r.telemetry.topic_category,
          (r) => r.telemetry.ending_type,
        ),
        lightingByTopic: buildCrossTab(
          records,
          (r) => r.telemetry.topic_category,
          (r) => r.telemetry.lighting_style,
        ),
        bgmByEmotion: buildCrossTab(
          v2PlusAudioRecords,
          (r) => r.telemetry.emotional_driver || "unknown",
          (r) => r.telemetry.bgm_mood || "unknown",
        ),
        bgmByTopic: buildCrossTab(
          v2PlusAudioRecords,
          (r) => r.telemetry.topic_category,
          (r) => r.telemetry.bgm_mood || "unknown",
        ),
        storyByProtagonist: buildCrossTab(
          v2PlusRecords,
          (r) => r.telemetry.protagonist_format || "unknown",
          (r) => r.telemetry.story_structure,
        ),
        actingByProtagonist: buildCrossTab(
          v3Records,
          (r) => r.telemetry.protagonist_format || "unknown",
          (r) => r.telemetry.acting_mode || "unknown",
        ),
        setByTopic: buildCrossTab(
          v3Records,
          (r) => r.telemetry.topic_category,
          (r) => r.telemetry.set_architecture || "unknown",
        ),
      },
      beatBudgets,
      storyDynamics,
      boundaries: {
        totalNonOpening: boundaryAll.totalNonOpening,
        counts: boundaryAll.counts,
        pcts: boundaryAll.pcts,
        byTier: {
          winner: boundaryWinner,
          flop: boundaryFlop,
        },
        videoLevel: videoLevelBoundaries.perKey,
        editArchitecture: videoLevelBoundaries.editArchitecture,
        transitionTypes,
      },
      framing: {
        totalShots: framingOverall.totalShots,
        shotScalePcts: framingOverall.shotScalePcts,
        cameraAnglePcts: framingOverall.cameraAnglePcts,
        byTier: {
          winner: framingWinner,
          flop: framingFlop,
        },
      },
      shotSpine,
      withinBucketContrasts: contrastRes.contrasts,
      withinBucketTestsEvaluated: contrastRes.totalTestsEvaluated,
      craftSignals,
      v2DeepDna,
      v3DeepDna,
      exemplars,
    },
  };
}

export function runAggregate(corpusDir: string, minSchema = 1): ReturnType<typeof aggregateCorpus> {
  const catalogPath = join(corpusDir, "catalog.json");
  if (!existsSync(catalogPath)) {
    throw new Error(`missing ${catalogPath}; run collect first`);
  }
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogFile;
  const videosDir = join(corpusDir, "videos");
  const records: MinedRecord[] = [];
  if (existsSync(videosDir)) {
    for (const entry of readdirSync(videosDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(videosDir, entry.name, "meta.json");
      const telPath = join(videosDir, entry.name, "telemetry.json");
      const dossierPath = join(videosDir, entry.name, "dossier.md");
      if (!existsSync(metaPath) || !existsSync(telPath)) continue;
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as MinedVideoMeta;
      const telemetry = JSON.parse(readFileSync(telPath, "utf8")) as VideoTelemetry;
      const dossierMarkdown = existsSync(dossierPath)
        ? readFileSync(dossierPath, "utf8")
        : undefined;
      records.push({ meta, telemetry, dossierMarkdown });
    }
  }
  const stats = aggregateCorpus(catalog, records, minSchema);
  writeJsonAtomic(join(corpusDir, "stats.json"), stats);
  writeTextAtomic(join(corpusDir, "stats-summary.md"), renderStatsSummaryMd(stats));
  return stats;
}
