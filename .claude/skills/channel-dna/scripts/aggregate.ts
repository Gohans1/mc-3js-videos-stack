import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { median, writeJsonAtomic, writeTextAtomic } from "./collect.ts";
import {
  BEAT_ROLES,
  CAMERA_ANGLES,
  type CatalogFile,
  type CatalogVideo,
  CRAFT_SIGNAL_KEYS,
  type MinedVideoMeta,
  type PerformanceTier,
  SHOT_SCALES,
  type VideoTelemetry,
} from "./types.ts";

export interface MinedRecord {
  meta: MinedVideoMeta;
  telemetry: VideoTelemetry;
}

export interface CategoryBucketStat {
  key: string;
  count: number;
  pct: number;
  medianOutlier: number | null;
  winnerCount: number;
  medianCount: number;
  flopCount: number;
  winnerSharePct: number | null;
  flopSharePct: number | null;
  winnerToFlopLift: number | null;
}

export interface TierNumericSummary {
  n: number;
  medianViews: number | null;
  medianOutlier: number | null;
  durationSampleN: number;
  medianDurationSec: number | null;
  likeRateSampleN: number;
  medianLikeRate: number | null;
  wordCountSampleN: number;
  wpmSampleN: number;
  medianWordCount: number | null;
  medianWpm: number | null;
}

const pct = (part: number, total: number): number =>
  total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;

const round1 = (n: number): number => Number(n.toFixed(1));
const round2 = (n: number): number => Number(n.toFixed(2));

const normalizeTag = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

function summarizeCatalogTier(videos: CatalogVideo[]): TierNumericSummary {
  const durations = videos
    .map((v) => v.durationSec)
    .filter((x): x is number => typeof x === "number");
  const likeRates = videos.map((v) => v.likeRate).filter((x): x is number => typeof x === "number");
  const words = videos
    .map((v) => v.wordCount)
    .filter((x): x is number => typeof x === "number" && x > 0);
  const wpms = videos.map((v) => v.wpm).filter((x): x is number => typeof x === "number" && x > 0);
  return {
    n: videos.length,
    medianViews: videos.length > 0 ? Math.round(median(videos.map((v) => v.views))) : null,
    medianOutlier: videos.length > 0 ? round2(median(videos.map((v) => v.outlierRolling))) : null,
    durationSampleN: durations.length,
    medianDurationSec: durations.length > 0 ? round1(median(durations)) : null,
    likeRateSampleN: likeRates.length,
    medianLikeRate: likeRates.length > 0 ? round2(median(likeRates)) : null,
    wordCountSampleN: words.length,
    wpmSampleN: wpms.length,
    medianWordCount: words.length > 0 ? Math.round(median(words)) : null,
    medianWpm: wpms.length > 0 ? round1(median(wpms)) : null,
  };
}

export function reconcileWithCatalog(catalog: CatalogFile, records: MinedRecord[]): MinedRecord[] {
  const byId = new Map<string, CatalogVideo>(catalog.videos.map((v) => [v.id, v]));
  return records.map((r) => {
    const live = byId.get(r.meta.id);
    if (!live) return r;
    return {
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
    stats.push({
      key,
      count: list.length,
      pct: pct(list.length, total),
      medianOutlier:
        list.length > 0 ? round2(median(list.map((r) => r.meta.outlierRolling))) : null,
      winnerCount,
      medianCount,
      flopCount,
      winnerSharePct,
      flopSharePct,
      winnerToFlopLift,
    });
  }
  stats.sort(
    (a, b) =>
      b.count - a.count ||
      (b.medianOutlier ?? -1) - (a.medianOutlier ?? -1) ||
      a.key.localeCompare(b.key),
  );
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
    breakdown: Array<{ key: string; count: number; pct: number; medianOutlier: number }>;
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
      breakdown: Array<{ key: string; count: number; pct: number; medianOutlier: number }>;
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

export function aggregateCorpus(catalog: CatalogFile, rawRecords: MinedRecord[]) {
  const records = reconcileWithCatalog(catalog, rawRecords);
  const matureCatalog = catalog.videos.filter((v) => v.isMature);
  const matureEnrichedCount = matureCatalog.filter((v) => v.uploadDate !== null).length;
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
    overallMature: summarizeCatalogTier(matureCatalog),
    byTier: {
      winner: summarizeCatalogTier(matureCatalog.filter((v) => v.tier === "winner")),
      median: summarizeCatalogTier(matureCatalog.filter((v) => v.tier === "median")),
      flop: summarizeCatalogTier(matureCatalog.filter((v) => v.tier === "flop")),
    },
  };

  const total = records.length;
  const winners = records.filter((r) => r.meta.tier === "winner");
  const medians = records.filter((r) => r.meta.tier === "median");
  const flops = records.filter((r) => r.meta.tier === "flop");

  const pooledBoundaries = { hard_cut: 0, hidden_cut: 0, transition: 0, continuous: 0 };
  const transitionVideoCounts = new Map<
    string,
    { count: number; winnerCount: number; flopCount: number }
  >();
  const pooledScales: Record<string, number> = Object.fromEntries(SHOT_SCALES.map((s) => [s, 0]));
  const pooledAngles: Record<string, number> = Object.fromEntries(CAMERA_ANGLES.map((a) => [a, 0]));
  const cutsPerMinAll: number[] = [];
  const cutsPerMinWinners: number[] = [];
  const cutsPerMinFlops: number[] = [];
  const beatsPerMinAll: number[] = [];

  for (const r of records) {
    const b = r.telemetry.boundary_counts;
    pooledBoundaries.hard_cut += b.hard_cut;
    pooledBoundaries.hidden_cut += b.hidden_cut;
    pooledBoundaries.transition += b.transition;
    pooledBoundaries.continuous += b.continuous;

    const durMin = Math.max(r.telemetry.duration_sec / 60, 0.05);
    const editCuts = b.hard_cut + b.hidden_cut + b.transition;
    const cpm = editCuts / durMin;
    const bpm = (editCuts + b.continuous) / durMin;
    cutsPerMinAll.push(cpm);
    beatsPerMinAll.push(bpm);
    if (r.meta.tier === "winner") cutsPerMinWinners.push(cpm);
    if (r.meta.tier === "flop") cutsPerMinFlops.push(cpm);

    const uniqueTrans =
      b.transition > 0
        ? new Set(r.telemetry.transition_types.map(normalizeTag).filter(Boolean))
        : new Set<string>();
    for (const tr of uniqueTrans) {
      const cur = transitionVideoCounts.get(tr) ?? { count: 0, winnerCount: 0, flopCount: 0 };
      cur.count++;
      if (r.meta.tier === "winner") cur.winnerCount++;
      if (r.meta.tier === "flop") cur.flopCount++;
      transitionVideoCounts.set(tr, cur);
    }
    for (const s of SHOT_SCALES)
      pooledScales[s] = (pooledScales[s] ?? 0) + (r.telemetry.shot_scale_counts[s] ?? 0);
    for (const a of CAMERA_ANGLES)
      pooledAngles[a] = (pooledAngles[a] ?? 0) + (r.telemetry.camera_angle_counts[a] ?? 0);
  }

  const totalBoundaries =
    pooledBoundaries.hard_cut +
    pooledBoundaries.hidden_cut +
    pooledBoundaries.transition +
    pooledBoundaries.continuous;
  const totalScales = Object.values(pooledScales).reduce((s, n) => s + n, 0);
  const totalAngles = Object.values(pooledAngles).reduce((s, n) => s + n, 0);

  const beatBudgets = BEAT_ROLES.map((role) => {
    const vals: number[] = [];
    for (const r of records) {
      const rolePct = r.telemetry.story_beats
        .filter((b) => b.role === role)
        .reduce((sum, b) => sum + b.pct_runtime, 0);
      if (rolePct > 0) vals.push(rolePct);
    }
    return {
      role,
      presentInVideos: vals.length,
      presencePct: pct(vals.length, total),
      medianPctWhenPresent: vals.length > 0 ? round1(median(vals)) : 0,
    };
  }).filter((b) => b.presentInVideos > 0);

  const craftSignals = CRAFT_SIGNAL_KEYS.map((key) => {
    const allCount = records.filter((r) => r.telemetry.craft_signals[key]).length;
    const winCount = winners.filter((r) => r.telemetry.craft_signals[key]).length;
    const flopCount = flops.filter((r) => r.telemetry.craft_signals[key]).length;
    const winPct = winners.length > 0 ? pct(winCount, winners.length) : null;
    const flopPct = flops.length > 0 ? pct(flopCount, flops.length) : null;
    return {
      signal: key,
      count: allCount,
      pct: pct(allCount, total),
      winnerPct: winPct,
      flopPct: flopPct,
      winnerMinusFlopPp: winPct !== null && flopPct !== null ? round1(winPct - flopPct) : null,
    };
  }).sort((a, b) => b.pct - a.pct || a.signal.localeCompare(b.signal));

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
      .map((r) => r.meta.wpm)
      .filter((x): x is number => typeof x === "number" && x > 0);
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
      story: r.telemetry.story_structure,
      connector: r.telemetry.narrative_connector,
      ending: r.telemetry.ending_type,
      twistAtPct: r.telemetry.twist_at_pct,
      scriptTemplate: r.telemetry.reusable_script_template,
      secretSauce: r.telemetry.secret_sauce_cues,
      weaknesses: r.telemetry.weaknesses_or_drag,
    }));

  return {
    channel: catalog.channel,
    generatedAt: new Date().toISOString(),
    catalogTelemetry,
    deepDna: {
      minedCount: total,
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
        medianEditCutsPerMin: total > 0 ? round1(median(cutsPerMinAll)) : null,
        winnerMedianEditCutsPerMin:
          cutsPerMinWinners.length > 0 ? round1(median(cutsPerMinWinners)) : null,
        flopMedianEditCutsPerMin:
          cutsPerMinFlops.length > 0 ? round1(median(cutsPerMinFlops)) : null,
        medianTotalBeatsPerMin: total > 0 ? round1(median(beatsPerMinAll)) : null,
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
        audioBedStyle: buildCategoryStats(records, (r) => r.telemetry.audio_bed_style),
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
      },
      beatBudgets,
      boundaries: {
        totalNonOpening: totalBoundaries,
        counts: pooledBoundaries,
        pcts: {
          hard_cut: pct(pooledBoundaries.hard_cut, totalBoundaries),
          hidden_cut: pct(pooledBoundaries.hidden_cut, totalBoundaries),
          transition: pct(pooledBoundaries.transition, totalBoundaries),
          continuous: pct(pooledBoundaries.continuous, totalBoundaries),
        },
        transitionTypes: [...transitionVideoCounts.entries()]
          .map(([type, v]) => ({
            type,
            videos: v.count,
            videoPct: pct(v.count, total),
            winnerPct: winners.length > 0 ? pct(v.winnerCount, winners.length) : null,
            flopPct: flops.length > 0 ? pct(v.flopCount, flops.length) : null,
          }))
          .sort((a, b) => b.videos - a.videos || a.type.localeCompare(b.type)),
      },
      framing: {
        totalShots: totalScales,
        shotScalePcts: Object.fromEntries(
          SHOT_SCALES.map((s) => [s, pct(pooledScales[s] ?? 0, totalScales)]),
        ),
        cameraAnglePcts: Object.fromEntries(
          CAMERA_ANGLES.map((a) => [a, pct(pooledAngles[a] ?? 0, totalAngles)]),
        ),
      },
      craftSignals,
      exemplars,
    },
  };
}

const fmtPct = (v: number | null): string => (v === null ? "-" : `${v}%`);
const fmtOutlier = (v: number | null): string => (v === null ? "-" : `${v}x`);
const fmtValN = (v: number | null, n: number): string => (v === null ? `- (${n})` : `${v} (${n})`);

export function renderStatsSummaryMd(stats: ReturnType<typeof aggregateCorpus>): string {
  const c = stats.catalogTelemetry;
  const d = stats.deepDna;
  const p = d.pacingAndTiming;
  const bucketRows = (list: CategoryBucketStat[]) =>
    list.map(
      (b) =>
        `| ${b.key} | ${b.count} | ${b.pct}% | ${fmtOutlier(b.medianOutlier)} | ${fmtPct(b.winnerSharePct)} | ${fmtPct(b.flopSharePct)} | ${b.winnerToFlopLift ?? "-"} |`,
    );
  const crossRows = (
    tab: Record<
      string,
      {
        n: number;
        medianOutlier: number | null;
        breakdown: Array<{ key: string; count: number; pct: number; medianOutlier: number }>;
      }
    >,
  ) =>
    Object.entries(tab).map(([topic, info]) => {
      const top = info.breakdown
        .slice(0, 3)
        .map((x) => `${x.key} ${x.count}/${info.n} (${x.pct}%, ${x.medianOutlier}x)`)
        .join("; ");
      return `| ${topic} | ${info.n} | ${fmtOutlier(info.medianOutlier)} | ${top || "-"} |`;
    });

  const provSuffix =
    d.tierCounts.provisional > 0 ? `, ${d.tierCounts.provisional} Provisional` : "";

  const lines: string[] = [
    `# Channel DNA Statistics: ${stats.channel}`,
    "",
    `Catalog snapshot ${c.snapshotDate}: ${c.totalCollected} items collected (${c.matureCount} mature >= 30 days, ${c.matureEnrichedCount} mature / ${c.enrichedCount} total enriched metadata, ${c.matureTranscriptCount} mature / ${c.transcriptCount} total spoken transcripts/WPM, global mature median ${c.globalMatureMedianViews.toLocaleString("en-US")} views). Deep visual and narrative DNA sample: N=${d.minedCount} (${d.tierCounts.winner} Winner, ${d.tierCounts.median} Median, ${d.tierCounts.flop} Flop${provSuffix}).`,
    "",
    "## Full-Catalog Winners vs Flops (yt-dlp + transcripts, explicit subsample N)",
    "",
    "| Tier | Count | Median Views | Rolling Outlier | Duration s (N) | WPM (N) | Word Count (N) | Like Rate % (N) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(["winner", "median", "flop"] as const).map((t) => {
      const s = c.byTier[t];
      return `| ${t} | ${s.n} | ${s.medianViews !== null ? s.medianViews.toLocaleString("en-US") : "-"} | ${fmtOutlier(s.medianOutlier)} | ${fmtValN(s.medianDurationSec, s.durationSampleN)} | ${fmtValN(s.medianWpm, s.wpmSampleN)} | ${fmtValN(s.medianWordCount, s.wordCountSampleN)} | ${fmtValN(s.medianLikeRate, s.likeRateSampleN)} |`;
    }),
    "",
    `## Deep DNA Pacing and Timing by Tier (N=${d.minedCount})`,
    "",
    "| Tier | N | Median Outlier | Duration (s) | Opening Shot (s) | Re-hooks | Twist Present | WPM (N) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(["overall", "winner", "median", "flop"] as const).map((t) => {
      const m = p[t];
      return `| ${t} | ${m.n} | ${fmtOutlier(m.medianOutlierRolling)} | ${m.medianDurationSec ?? "-"} | ${m.medianOpeningShotSec ?? "-"} | ${m.medianRehookCount ?? "-"} | ${fmtPct(m.twistPresencePct)} | ${fmtValN(m.medianWpm, m.wpmSampleN)} |`;
    }),
    "",
    `Median twist placement: ${fmtPct(p.medianTwistAtPct)} (Winner ${fmtPct(p.winnerMedianTwistAtPct)}, Flop ${fmtPct(p.flopMedianTwistAtPct)}). Median edit cuts/min: ${p.medianEditCutsPerMin ?? "-"} (Winner ${p.winnerMedianEditCutsPerMin ?? "-"}, Flop ${p.flopMedianEditCutsPerMin ?? "-"}), total camera beats/min: ${p.medianTotalBeatsPerMin ?? "-"}.`,
    "",
    `## Topic Category Distribution (N=${d.minedCount} deep DNA)`,
    "",
    "| Topic | Videos | Share (%) | Median Outlier | Winner (%) | Flop (%) | Lift W/F |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...bucketRows(d.distributions.topicCategory),
    "",
    `## Hook Archetype Distribution (N=${d.minedCount} deep DNA)`,
    "",
    "| Hook | Videos | Share (%) | Median Outlier | Winner (%) | Flop (%) | Lift W/F |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...bucketRows(d.distributions.hookArchetype),
    "",
    `## Storytelling Structure Distribution (N=${d.minedCount} deep DNA)`,
    "",
    "| Structure | Videos | Share (%) | Median Outlier | Winner (%) | Flop (%) | Lift W/F |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...bucketRows(d.distributions.storyStructure),
    "",
    `## Hook x Topic and Story x Topic Cross-Tabs (N=${d.minedCount} deep DNA)`,
    "",
    "| Topic | N | Median Outlier | Dominant Hook Archetypes |",
    "| --- | --- | --- | --- |",
    ...crossRows(d.crossTabs.hookByTopic),
    "",
    "| Topic | N | Median Outlier | Dominant Story Structures |",
    "| --- | --- | --- | --- |",
    ...crossRows(d.crossTabs.storyByTopic),
    "",
    `## Story Beat Runtime Budgets (N=${d.minedCount} deep DNA)`,
    "",
    "| Beat Role | Videos Present | Presence (%) | Median Runtime When Present (%) |",
    "| --- | --- | --- | --- |",
    ...d.beatBudgets.map(
      (b) =>
        `| ${b.role} | ${b.presentInVideos} | ${b.presencePct}% | ${b.medianPctWhenPresent}% |`,
    ),
    "",
    `## Narrative Connectors and Ending Types (N=${d.minedCount} deep DNA)`,
    "",
    "| Dimension / Value | Videos | Share (%) | Median Outlier | Winner (%) | Flop (%) | Lift W/F |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...d.distributions.narrativeConnector.map(
      (b) =>
        `| connector:${b.key} | ${b.count} | ${b.pct}% | ${fmtOutlier(b.medianOutlier)} | ${fmtPct(b.winnerSharePct)} | ${fmtPct(b.flopSharePct)} | ${b.winnerToFlopLift ?? "-"} |`,
    ),
    ...d.distributions.endingType.map(
      (b) =>
        `| ending:${b.key} | ${b.count} | ${b.pct}% | ${fmtOutlier(b.medianOutlier)} | ${fmtPct(b.winnerSharePct)} | ${fmtPct(b.flopSharePct)} | ${b.winnerToFlopLift ?? "-"} |`,
    ),
    "",
    `## Boundary and Editing Ratios (${d.boundaries.totalNonOpening} non-opening boundaries across N=${d.minedCount})`,
    "",
    "| Boundary Type | Count | Share (%) |",
    "| --- | --- | --- |",
    `| Continuous [NO CUT] | ${d.boundaries.counts.continuous} | ${d.boundaries.pcts.continuous}% |`,
    `| Transition | ${d.boundaries.counts.transition} | ${d.boundaries.pcts.transition}% |`,
    `| Hidden Cut | ${d.boundaries.counts.hidden_cut} | ${d.boundaries.pcts.hidden_cut}% |`,
    `| Hard Cut | ${d.boundaries.counts.hard_cut} | ${d.boundaries.pcts.hard_cut}% |`,
    "",
    `## Transition Types Used Across Videos (N=${d.minedCount})`,
    "",
    "| Transition | Videos | Video Share (%) | Winner (%) | Flop (%) |",
    "| --- | --- | --- | --- | --- |",
    ...(d.boundaries.transitionTypes.length > 0
      ? d.boundaries.transitionTypes.map(
          (t) =>
            `| ${t.type} | ${t.videos} | ${t.videoPct}% | ${fmtPct(t.winnerPct)} | ${fmtPct(t.flopPct)} |`,
        )
      : ["| none | 0 | 0% | - | - |"]),
    "",
    `## Framing Ratios (${d.framing.totalShots} shots across N=${d.minedCount})`,
    "",
    "| Scale | Share (%) | Angle | Share (%) |",
    "| --- | --- | --- | --- |",
    ...Array.from({ length: Math.max(SHOT_SCALES.length, CAMERA_ANGLES.length) }, (_, idx) => {
      const s = SHOT_SCALES[idx];
      const a = CAMERA_ANGLES[idx];
      return `| ${s ?? "-"} | ${s ? `${d.framing.shotScalePcts[s] ?? 0}%` : "-"} | ${a ?? "-"} | ${a ? `${d.framing.cameraAnglePcts[a] ?? 0}%` : "-"} |`;
    }),
    "",
    `## Camera, Lighting, Easing, and Audio Profiles (N=${d.minedCount})`,
    "",
    "| Dimension / Value | Videos | Share (%) | Median Outlier | Winner (%) | Flop (%) | Lift W/F |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...d.distributions.cameraEnergy.map(
      (b) =>
        `| camera:${b.key} | ${b.count} | ${b.pct}% | ${fmtOutlier(b.medianOutlier)} | ${fmtPct(b.winnerSharePct)} | ${fmtPct(b.flopSharePct)} | ${b.winnerToFlopLift ?? "-"} |`,
    ),
    ...d.distributions.dominantLensFeel.map(
      (b) =>
        `| lens:${b.key} | ${b.count} | ${b.pct}% | ${fmtOutlier(b.medianOutlier)} | ${fmtPct(b.winnerSharePct)} | ${fmtPct(b.flopSharePct)} | ${b.winnerToFlopLift ?? "-"} |`,
    ),
    ...d.distributions.lightingStyle.map(
      (b) =>
        `| lighting:${b.key} | ${b.count} | ${b.pct}% | ${fmtOutlier(b.medianOutlier)} | ${fmtPct(b.winnerSharePct)} | ${fmtPct(b.flopSharePct)} | ${b.winnerToFlopLift ?? "-"} |`,
    ),
    ...d.distributions.easingEnergy.map(
      (b) =>
        `| easing:${b.key} | ${b.count} | ${b.pct}% | ${fmtOutlier(b.medianOutlier)} | ${fmtPct(b.winnerSharePct)} | ${fmtPct(b.flopSharePct)} | ${b.winnerToFlopLift ?? "-"} |`,
    ),
    ...d.distributions.audioBedStyle.map(
      (b) =>
        `| audio:${b.key} | ${b.count} | ${b.pct}% | ${fmtOutlier(b.medianOutlier)} | ${fmtPct(b.winnerSharePct)} | ${fmtPct(b.flopSharePct)} | ${b.winnerToFlopLift ?? "-"} |`,
    ),
    "",
    `## Visual, Optical, and Audio Craft Signals (N=${d.minedCount})`,
    "",
    "| Signal | Videos | Share (%) | Winner (%) | Flop (%) | Delta W-F (pp) |",
    "| --- | --- | --- | --- | --- | --- |",
    ...d.craftSignals.map(
      (s) =>
        `| ${s.signal} | ${s.count} | ${s.pct}% | ${fmtPct(s.winnerPct)} | ${fmtPct(s.flopPct)} | ${s.winnerMinusFlopPp ?? "-"} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

export function runAggregate(corpusDir: string): ReturnType<typeof aggregateCorpus> {
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
      if (!existsSync(metaPath) || !existsSync(telPath)) continue;
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as MinedVideoMeta;
      const telemetry = JSON.parse(readFileSync(telPath, "utf8")) as VideoTelemetry;
      records.push({ meta, telemetry });
    }
  }
  const stats = aggregateCorpus(catalog, records);
  writeJsonAtomic(join(corpusDir, "stats.json"), stats);
  writeTextAtomic(join(corpusDir, "stats-summary.md"), renderStatsSummaryMd(stats));
  return stats;
}
