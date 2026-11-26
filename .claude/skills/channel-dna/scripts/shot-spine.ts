import {
  benjaminiHochberg,
  fisherExactTwoSided,
  iqr,
  mannWhitneyTwoSided,
  percentile,
  reliabilityLabel,
} from "./catalog-metrics.ts";
import { median } from "./collect.ts";
import { parseSection3Shots } from "./schema.ts";
import {
  CRAFT_PILLAR_CATEGORIES,
  type MinedVideoMeta,
  type ReliabilityLevel,
  type VideoTelemetry,
} from "./types.ts";

export interface MinedRecord {
  meta: MinedVideoMeta;
  telemetry: VideoTelemetry;
  dossierMarkdown?: string;
}

export interface WithinBucketContrast {
  dimension: "topic_category" | "story_structure" | "hook_archetype";
  bucket: string;
  winnerN: number;
  flopN: number;
  feature: string;
  winnerCount: number;
  flopCount: number;
  winnerPct: number;
  flopPct: number;
  deltaPp: number;
  pValue: number | null;
  qValue: number | null;
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

const TRANSITION_ALIASES: Record<string, string> = {
  vertical_push: "push_up",
  dissolve: "cross_dissolve",
  fade_dissolve: "cross_dissolve",
};

const CAMERA_MOVE_ALIASES: Record<string, string> = {
  dolly_in: "push_in",
  zoom_in: "push_in",
  dolly_out: "pull_back",
  zoom_out: "pull_back",
  orbit: "orbit_arc",
  arc: "orbit_arc",
  whip: "whip_pan",
  crane: "crane_boom",
  pedestal: "crane_boom",
  static: "static_locked",
  locked: "static_locked",
  handheld: "handheld_follow",
  fly_through: "pass_through",
  push_through: "pass_through",
  dolly_through: "pass_through",
  camera_through: "pass_through",
};

export const canonicalTransition = (raw: string): string => {
  const norm = normalizeTag(raw);
  return TRANSITION_ALIASES[norm] ?? norm;
};

export const canonicalCameraMove = (raw: string): string => {
  const norm = normalizeTag(raw);
  if (/^(?:pass|fly|push|dolly|camera)_through(?:_|$)/.test(norm)) return "pass_through";
  return CAMERA_MOVE_ALIASES[norm] ?? norm;
};

export const isMicroFpsRecord = (r: MinedRecord): boolean =>
  r.meta.miningMode !== "macro_lowfps" &&
  (typeof r.meta.fps !== "number" || r.meta.fps <= 0 || r.meta.fps >= 10);

const PASSIVE_DISSOLVE_TRANSITIONS = new Set([
  "cross_dissolve",
  "dissolve",
  "dip_to_black",
  "dip_to_white",
  "fade",
  "fade_to_black",
  "fade_to_white",
  "none",
]);

export function hasDynamicMotionTransition(r: MinedRecord): boolean {
  if (r.telemetry.boundary_counts.transition <= 0) return false;
  for (const raw of r.telemetry.transition_types) {
    const t = canonicalTransition(raw);
    if (t && !PASSIVE_DISSOLVE_TRANSITIONS.has(t)) return true;
  }
  return false;
}

export function classifyHiddenCutMechanism(detail: string): string {
  const d = detail.toLowerCase();
  if (/roll|spin|barrel|rotate/.test(d)) return "roll_spin";
  if (/whip|pan|tilt|swish/.test(d)) return "whip_pan_smear";
  if (/zoom|dive|crash|push|pull|radial|pass[_ -]?through|fly[_ -]?through/.test(d))
    return "radial_zoom_dive";
  if (
    /occlu[ds]|wipe|pass[_ -]?by|black|dark|water|jacket|wall|door|foreground|fg|hand|body/.test(d)
  )
    return "fg_or_env_occlusion";
  if (/smear/.test(d)) return "whip_pan_smear";
  return "other";
}

export function classifyContinuousBridgeMechanism(detail: string): string {
  const d = detail.toLowerCase();
  if (!d) return "unspecified_continuous";
  if (/slow[_ -]?mo|time[_ -]?remap|rewind|reverse|timelapse|freeze|hit[_ -]?stop/.test(d))
    return "time_remap_bridge";
  if (
    /(?:pass|fly|push|pull|dolly|camera)[_ -]?through|fly[_ -]?in|fly[_ -]?out|\bthrough\b|x-?ray|cutaway|morph|peel|translucent|ghost|inside/.test(
      d,
    )
  )
    return "pass_through_or_xray";
  if (
    /whip|snap[_ -]?pan|swish|fast[_ -]?pan|tilt[_ -]?to|tilt[_ -]?up|tilt[_ -]?down|pan[_ -]?to|\btilt\b/.test(
      d,
    )
  )
    return "whip_or_snap_pan";
  if (/orbit|arc|circle|wrap|pivot|swing|around/.test(d)) return "orbit_or_arc";
  if (
    /push[_ -]?in|pull[_ -]?back|\bpush\b|\bpull\b|dolly|zoom|crash[_ -]?in|dive|retreat|reframe|tighten|widen/.test(
      d,
    )
  )
    return "push_in_or_pull_back";
  if (
    /track|follow|glide|lateral|truck|slide|chase|crane|boom|pedestal|rise|descend|ascend|drop|lower|climb|swoop|fly[_ -]?past|\bpov\b|walk[_ -]?in|pan/.test(
      d,
    )
  )
    return "tracking_or_follow";
  if (/roll|spin|barrel|rotate|rack[_ -]?focus|focus[_ -]?shift/.test(d))
    return "roll_or_focus_shift";
  if (
    /static|locked|hold|held|settle|foreground|pass[_ -]?by|\bots\b|insert|collision|impact|action|staging|subject|beat|state|enter|exit|hand|face|prop|motion|reveal/.test(
      d,
    )
  )
    return "staging_or_action_beat";
  return "other";
}

export function classifyHardCutMechanism(detail: string): string {
  const cleaned = detail
    .replace(/\bf\d+\s*(?:->|→|-|–)\s*f\d+\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?f\b/gi, "")
    .replace(/^[\s,;:/-]+|[\s,;:/-]+$/g, "")
    .trim()
    .toLowerCase();
  if (!cleaned) return "unspecified";
  if (/b[_ -]?roll|cutaway|archival|footage|insert[_ -]?shot|stock/.test(cleaned))
    return "broll_cutaway";
  if (/jump[_ -]?cut|punch[_ -]?in|punch[_ -]?out|axial|micro[_ -]?cut/.test(cleaned))
    return "jump_cut_or_punch_in";
  if (/match[_ -]?cut|graphic[_ -]?match|action[_ -]?match|motion[_ -]?match/.test(cleaned))
    return "match_cut";
  if (/graphic|title[_ -]?card|text[_ -]?card|slide|diagram|screen|ui/.test(cleaned))
    return "graphic_or_text_card";
  if (
    /angle|reverse|shot[_ -]?reverse|ots|scale|close[_ -]?up|wide|reaction|speaker|camera[_ -]?switch/.test(
      cleaned,
    )
  )
    return "angle_or_scale_cut";
  if (
    /scene|location|time[_ -]?jump|chapter|set[_ -]?change|new[_ -]?scene|flashback/.test(cleaned)
  )
    return "scene_or_location_change";
  return "other";
}

const SCALE_INDEX = new Map<string, number>([
  ["EW", 0],
  ["W", 1],
  ["M", 2],
  ["MCU", 3],
  ["CU", 4],
  ["ECU", 5],
  ["INSERT", 5],
]);

export function hasSetupLe15Pct(r: MinedRecord): boolean {
  const setupPct = r.telemetry.story_beats
    .filter((b) => b.role === "setup")
    .reduce((sum, b) => sum + b.pct_runtime, 0);
  return setupPct <= 15;
}

export function hasEscalationBeforeExplanation(r: MinedRecord): boolean {
  const firstEsc = r.telemetry.story_beats.find((b) => b.role === "escalation");
  if (!firstEsc) return false;
  const firstExp = r.telemetry.story_beats.find((b) => b.role === "explanation_value");
  if (!firstExp) return true;
  return firstEsc.start_sec < firstExp.start_sec;
}

export function hasStackedLoop(r: MinedRecord): boolean {
  const esc = r.telemetry.story_beats.filter((b) => b.role === "escalation").length;
  const tw = r.telemetry.story_beats.filter((b) => b.role === "twist").length;
  return esc >= 2 || tw >= 2;
}

export function buildWithinBucketContrasts(records: MinedRecord[]): {
  contrasts: WithinBucketContrast[];
  totalTestsEvaluated: number;
} {
  let totalTestsEvaluated = 0;

  const dims: Array<{
    dimension: WithinBucketContrast["dimension"];
    keyOf: (r: MinedRecord) => string;
  }> = [
    { dimension: "topic_category", keyOf: (r) => r.telemetry.topic_category },
    { dimension: "story_structure", keyOf: (r) => r.telemetry.story_structure },
    { dimension: "hook_archetype", keyOf: (r) => r.telemetry.hook_archetype },
  ];

  const observedTransitionCounts = new Map<string, number>();
  for (const r of records) {
    if (r.telemetry.boundary_counts.transition <= 0) continue;
    for (const tr of new Set(
      r.telemetry.transition_types.map(canonicalTransition).filter(Boolean),
    )) {
      observedTransitionCounts.set(tr, (observedTransitionCounts.get(tr) ?? 0) + 1);
    }
  }
  const dynamicTransitionProbes: Array<{
    feature: string;
    audioOnly?: boolean;
    v2Only?: boolean;
    pred: (r: MinedRecord) => boolean;
  }> = [...observedTransitionCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([tr]) => ({
      feature: `transition:${tr}`,
      pred: (r: MinedRecord) =>
        r.telemetry.boundary_counts.transition > 0 &&
        r.telemetry.transition_types.some((raw) => canonicalTransition(raw) === tr),
    }));

  const probes: Array<{
    feature: string;
    audioOnly?: boolean;
    v2Only?: boolean;
    pred: (r: MinedRecord) => boolean;
  }> = [
    {
      feature: "edit:pure_one_take",
      pred: (r) => {
        const b = r.telemetry.boundary_counts;
        return b.hard_cut + b.hidden_cut + b.transition === 0;
      },
    },
    {
      feature: "edit:has_styled_transition",
      pred: (r) => r.telemetry.boundary_counts.transition > 0,
    },
    {
      feature: "edit:has_dynamic_motion_transition",
      pred: hasDynamicMotionTransition,
    },
    ...dynamicTransitionProbes,
    {
      feature: "edit:hard_cuts_max_1",
      pred: (r) => r.telemetry.boundary_counts.hard_cut <= 1,
    },
    {
      feature: "story:setup_le_15pct",
      pred: hasSetupLe15Pct,
    },
    {
      feature: "story:escalation_before_explanation",
      pred: hasEscalationBeforeExplanation,
    },
    {
      feature: "story:stacked_loop",
      pred: hasStackedLoop,
    },
    {
      feature: "story:late_twist_ge_65pct",
      pred: (r) => typeof r.telemetry.twist_at_pct === "number" && r.telemetry.twist_at_pct >= 65,
    },
    {
      feature: "story:has_twist",
      pred: (r) => r.telemetry.twist_at_pct !== null,
    },
    {
      feature: "craft:uses_backdrop_vignette",
      pred: (r) => r.telemetry.craft_signals.uses_backdrop_vignette === true,
    },
    {
      feature: "craft:has_cutaway_or_xray",
      pred: (r) => r.telemetry.craft_signals.has_cutaway_or_xray === true,
    },
    {
      feature: "craft:has_particles_or_fluid",
      v2Only: true,
      pred: (r) => r.telemetry.craft_signals.has_particles_or_fluid === true,
    },
    {
      feature: "craft:uses_shallow_dof",
      pred: (r) => r.telemetry.craft_signals.uses_shallow_dof === true,
    },
    {
      feature: "craft:has_emissive_highlight_pulse",
      pred: (r) => r.telemetry.craft_signals.has_emissive_highlight_pulse === true,
    },
    {
      feature: "craft:has_diegetic_text_or_labels",
      pred: (r) => r.telemetry.craft_signals.has_diegetic_text_or_labels === true,
    },
    {
      feature: "craft:has_pre_impact_silence",
      audioOnly: true,
      pred: (r) => r.telemetry.craft_signals.has_pre_impact_silence === true,
    },
    {
      feature: "lighting:dramatic_low_key",
      pred: (r) => r.telemetry.lighting_style === "dramatic_low_key",
    },
    {
      feature: "lighting:clean_studio_soft",
      pred: (r) => r.telemetry.lighting_style === "clean_studio_soft",
    },
    {
      feature: "shadows:soft_diffuse",
      v2Only: true,
      pred: (r) => r.telemetry.shadow_quality === "soft_diffuse",
    },
    {
      feature: "palette:clean_bright_saturated",
      v2Only: true,
      pred: (r) => r.telemetry.color_palette_mood === "clean_bright_saturated",
    },
    {
      feature: "palette:dark_high_contrast",
      v2Only: true,
      pred: (r) => r.telemetry.color_palette_mood === "dark_high_contrast",
    },
    {
      feature: "easing:snappy_overshoot",
      pred: (r) => r.telemetry.easing_energy === "snappy_overshoot",
    },
    {
      feature: "protagonist:faceless_objects_diagrams",
      v2Only: true,
      pred: (r) => r.telemetry.protagonist_format === "faceless_objects_diagrams",
    },
    {
      feature: "protagonist:third_person_characters",
      v2Only: true,
      pred: (r) => r.telemetry.protagonist_format === "third_person_characters",
    },
  ];

  const allEvaluatedP: Array<number | null> = [];
  const keptIndices: Array<{ evalIdx: number; row: Omit<WithinBucketContrast, "qValue"> }> = [];

  for (const { dimension, keyOf } of dims) {
    const groups = new Map<string, MinedRecord[]>();
    for (const r of records) {
      const k = keyOf(r);
      const list = groups.get(k) ?? [];
      list.push(r);
      groups.set(k, list);
    }
    for (const [bucket, list] of groups) {
      const wBase = list.filter((r) => r.meta.tier === "winner");
      const fBase = list.filter((r) => r.meta.tier === "flop");
      if (wBase.length < 3 || fBase.length < 3) continue;
      const bucketHits: Array<{ evalIdx: number; row: Omit<WithinBucketContrast, "qValue"> }> = [];
      for (const probe of probes) {
        const wPool = wBase.filter(
          (r) =>
            (!probe.audioOnly || r.meta.hasAudioStream !== false) &&
            (!probe.v2Only || r.telemetry.schema_version >= 2),
        );
        const fPool = fBase.filter(
          (r) =>
            (!probe.audioOnly || r.meta.hasAudioStream !== false) &&
            (!probe.v2Only || r.telemetry.schema_version >= 2),
        );
        if (wPool.length < 3 || fPool.length < 3) continue;
        const wc = wPool.filter(probe.pred).length;
        const fc = fPool.filter(probe.pred).length;
        const pVal = fisherExactTwoSided(wc, fc, wPool.length - wc, fPool.length - fc);
        const evalIdx = allEvaluatedP.length;
        allEvaluatedP.push(pVal);
        totalTestsEvaluated++;
        const wp = pct(wc, wPool.length);
        const fp = pct(fc, fPool.length);
        const deltaPp = round1(wp - fp);
        if (Math.abs(deltaPp) < 20) continue;
        bucketHits.push({
          evalIdx,
          row: {
            dimension,
            bucket,
            winnerN: wPool.length,
            flopN: fPool.length,
            feature: probe.feature,
            winnerCount: wc,
            flopCount: fc,
            winnerPct: wp,
            flopPct: fp,
            deltaPp,
            pValue: pVal,
          },
        });
      }
      bucketHits.sort(
        (a, b) =>
          (a.row.pValue ?? 1) - (b.row.pValue ?? 1) ||
          Math.abs(b.row.deltaPp) - Math.abs(a.row.deltaPp) ||
          a.row.feature.localeCompare(b.row.feature),
      );
      keptIndices.push(...bucketHits.slice(0, 6));
    }
  }

  const allQ = benjaminiHochberg(allEvaluatedP, totalTestsEvaluated);
  const contrasts: WithinBucketContrast[] = keptIndices.map(({ evalIdx, row }) => ({
    ...row,
    qValue: allQ[evalIdx] ?? null,
  }));
  contrasts.sort(
    (a, b) =>
      (a.pValue ?? 1) - (b.pValue ?? 1) ||
      Math.abs(b.deltaPp) - Math.abs(a.deltaPp) ||
      a.bucket.localeCompare(b.bucket),
  );
  return { contrasts, totalTestsEvaluated };
}

function summarizeDurationEnvelope(vals: number[]) {
  if (vals.length === 0) return null;
  const p10 = round2(percentile(vals, 0.1)!);
  const p90 = round2(percentile(vals, 0.9)!);
  return {
    n: vals.length,
    p10,
    p25: round2(percentile(vals, 0.25)!),
    p50: round2(percentile(vals, 0.5)!),
    p75: round2(percentile(vals, 0.75)!),
    p90,
    p90ToP10Ratio: p10 > 0 ? round2(p90 / p10) : null,
  };
}

function topShareList(values: string[]) {
  if (values.length === 0) return [];
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, pct: pct(count, values.length) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function buildShotSpineSummary(records: MinedRecord[]) {
  const allWithMd = records.filter((r) => Boolean(r.dossierMarkdown && r.dossierMarkdown.trim()));
  const microWithMd = allWithMd.filter(isMicroFpsRecord);
  const macroLowFpsExcludedCount = allWithMd.length - microWithMd.length;
  const useMacroFallback = microWithMd.length === 0 && allWithMd.length > 0;
  const withMd = useMacroFallback ? allWithMd : microWithMd;

  const allDurs: number[] = [];
  const winDurs: number[] = [];
  const flopDurs: number[] = [];
  const takeDursAll: number[] = [];
  const takeDursWin: number[] = [];
  const takeDursFlop: number[] = [];
  const confCounts = { High: 0, Med: 0, Low: 0 };
  const byBeatRole = new Map<string, number[]>();
  const lateToMidAll: number[] = [];
  const lateToMidWin: number[] = [];
  const lateToMidFlop: number[] = [];
  const maxContStreakAll: number[] = [];
  const maxContStreakWin: number[] = [];
  const maxContStreakFlop: number[] = [];

  const pillarCounts = new Map<
    string,
    {
      all: number;
      winner: number;
      flop: number;
      byBeat: Map<string, number>;
      videoSharesAll: number[];
      videoSharesWin: number[];
      videoSharesFlop: number[];
      presentVideos: number;
    }
  >();
  for (const cat of CRAFT_PILLAR_CATEGORIES) {
    pillarCounts.set(cat, {
      all: 0,
      winner: 0,
      flop: 0,
      byBeat: new Map(),
      videoSharesAll: [],
      videoSharesWin: [],
      videoSharesFlop: [],
      presentVideos: 0,
    });
  }
  let pillarTaggedAll = 0;
  let pillarTaggedWin = 0;
  let pillarTaggedFlop = 0;
  let pillarVideoCount = 0;
  const beatPillarTotals = new Map<string, number>();

  const transMap = new Map<
    string,
    {
      frames: number[];
      secs: number[];
      videoIds: Set<string>;
      beatAligned: number;
      totalInstances: number;
    }
  >();
  const hiddenMap = new Map<string, { instances: number; videoIds: Set<string> }>();
  const contBridgeMap = new Map<
    string,
    {
      instances: number;
      videoIds: Set<string>;
      winVideoIds: Set<string>;
      flopVideoIds: Set<string>;
    }
  >();
  const hardCutMap = new Map<
    string,
    {
      instances: number;
      videoIds: Set<string>;
      winVideoIds: Set<string>;
      flopVideoIds: Set<string>;
    }
  >();

  const openScaleAll: string[] = [];
  const openScaleWin: string[] = [];
  const openScaleFlop: string[] = [];
  const openAngleAll: string[] = [];
  const openAngleWin: string[] = [];
  const openAngleFlop: string[] = [];
  const closeScaleAll: string[] = [];
  const closeScaleWin: string[] = [];
  const closeScaleFlop: string[] = [];
  const closeAngleAll: string[] = [];
  const closeAngleWin: string[] = [];
  const closeAngleFlop: string[] = [];

  let wideTightAll = 0;
  let wideTightWin = 0;
  let wideTightFlop = 0;
  let bigJumpAll = 0;
  let bigJumpWin = 0;
  let bigJumpFlop = 0;
  let parsedVideoCount = 0;
  let parsedWinCount = 0;
  let parsedFlopCount = 0;
  let totalShots = 0;

  for (const r of withMd) {
    const { shots, inferredFps } = parseSection3Shots(r.dossierMarkdown!);
    if (shots.length === 0) continue;
    parsedVideoCount++;
    const isW = r.meta.tier === "winner";
    const isF = r.meta.tier === "flop";
    if (isW) parsedWinCount++;
    if (isF) parsedFlopCount++;
    totalShots += shots.length;

    const beatBoundaries = r.telemetry.story_beats.flatMap((b) => [b.start_sec, b.end_sec]);
    const fps = r.meta.sourceFps && r.meta.sourceFps > 0 ? r.meta.sourceFps : inferredFps;

    const vidMidDurs: number[] = [];
    const vidLateDurs: number[] = [];
    const dur = Math.max(r.telemetry.duration_sec, 1);

    let hasWide = false;
    let hasTight = false;
    let hasBigJump = false;
    let curStreak = 0;
    let maxStreak = 0;
    let curTakeDur = 0;
    let vidTaggedShots = 0;
    const vidPillarCounts = new Map<string, number>();

    const flushTake = () => {
      if (curTakeDur > 0) {
        const rounded = round2(curTakeDur);
        takeDursAll.push(rounded);
        if (isW) takeDursWin.push(rounded);
        if (isF) takeDursFlop.push(rounded);
      }
      curTakeDur = 0;
    };

    for (let i = 0; i < shots.length; i++) {
      const sh = shots[i]!;
      if (sh.confidence) confCounts[sh.confidence]++;
      if (sh.scale === "EW" || sh.scale === "W") hasWide = true;
      if (sh.scale === "CU" || sh.scale === "ECU" || sh.scale === "INSERT") hasTight = true;

      if (i > 0 && sh.scale && shots[i - 1]!.scale) {
        const prevIdx = SCALE_INDEX.get(shots[i - 1]!.scale!);
        const curIdx = SCALE_INDEX.get(sh.scale);
        if (prevIdx !== undefined && curIdx !== undefined && Math.abs(curIdx - prevIdx) >= 3) {
          hasBigJump = true;
        }
      }

      const isContinuousShot = sh.boundaryKind === "opening" || sh.boundaryKind === "continuous";
      if (!isContinuousShot) {
        flushTake();
        curStreak = 0;
      }

      let matchedBeatRole: string | null = null;
      if (sh.durationSec !== null && sh.durationSec > 0) {
        allDurs.push(sh.durationSec);
        if (isW) winDurs.push(sh.durationSec);
        if (isF) flopDurs.push(sh.durationSec);
        curTakeDur += sh.durationSec;

        curStreak = isContinuousShot ? curStreak + sh.durationSec : sh.durationSec;
        if (curStreak > maxStreak) maxStreak = curStreak;

        const midSec = sh.startSec !== null ? sh.startSec + sh.durationSec / 2 : null;
        if (midSec !== null) {
          const frac = midSec / dur;
          if (frac >= 0.33 && frac < 0.67) vidMidDurs.push(sh.durationSec);
          else if (frac >= 0.67) vidLateDurs.push(sh.durationSec);
          const matchingBeat = r.telemetry.story_beats.find(
            (b) => midSec >= b.start_sec && midSec <= b.end_sec + 0.05,
          );
          if (matchingBeat) {
            matchedBeatRole = matchingBeat.role;
            const list = byBeatRole.get(matchingBeat.role) ?? [];
            list.push(sh.durationSec);
            byBeatRole.set(matchingBeat.role, list);
          }
        }
      }

      if (sh.dominantCategory) {
        const entry = pillarCounts.get(sh.dominantCategory);
        if (entry) {
          entry.all++;
          pillarTaggedAll++;
          vidTaggedShots++;
          vidPillarCounts.set(
            sh.dominantCategory,
            (vidPillarCounts.get(sh.dominantCategory) ?? 0) + 1,
          );
          if (isW) {
            entry.winner++;
            pillarTaggedWin++;
          }
          if (isF) {
            entry.flop++;
            pillarTaggedFlop++;
          }
          if (matchedBeatRole) {
            entry.byBeat.set(matchedBeatRole, (entry.byBeat.get(matchedBeatRole) ?? 0) + 1);
            beatPillarTotals.set(matchedBeatRole, (beatPillarTotals.get(matchedBeatRole) ?? 0) + 1);
          }
        }
      }

      if (sh.boundaryKind === "transition") {
        const tType = canonicalTransition(sh.transitionType || "") || "other";
        const entry = transMap.get(tType) ?? {
          frames: [],
          secs: [],
          videoIds: new Set<string>(),
          beatAligned: 0,
          totalInstances: 0,
        };
        entry.totalInstances++;
        entry.videoIds.add(r.meta.id);
        if (!useMacroFallback && sh.transitionFrames !== null) {
          entry.frames.push(sh.transitionFrames);
          entry.secs.push(Number((sh.transitionFrames / fps).toFixed(3)));
        }
        if (
          sh.startSec !== null &&
          beatBoundaries.some((bt) => Math.abs(bt - sh.startSec!) <= 0.75)
        ) {
          entry.beatAligned++;
        }
        transMap.set(tType, entry);
      } else if (sh.boundaryKind === "hidden_cut") {
        const mech = classifyHiddenCutMechanism(sh.boundaryDetail);
        const entry = hiddenMap.get(mech) ?? { instances: 0, videoIds: new Set<string>() };
        entry.instances++;
        entry.videoIds.add(r.meta.id);
        hiddenMap.set(mech, entry);
      } else if (sh.boundaryKind === "continuous") {
        const mech = classifyContinuousBridgeMechanism(sh.boundaryDetail);
        const entry = contBridgeMap.get(mech) ?? {
          instances: 0,
          videoIds: new Set<string>(),
          winVideoIds: new Set<string>(),
          flopVideoIds: new Set<string>(),
        };
        entry.instances++;
        entry.videoIds.add(r.meta.id);
        if (isW) entry.winVideoIds.add(r.meta.id);
        if (isF) entry.flopVideoIds.add(r.meta.id);
        contBridgeMap.set(mech, entry);
      } else if (sh.boundaryKind === "hard_cut") {
        const mech = classifyHardCutMechanism(sh.boundaryDetail);
        const entry = hardCutMap.get(mech) ?? {
          instances: 0,
          videoIds: new Set<string>(),
          winVideoIds: new Set<string>(),
          flopVideoIds: new Set<string>(),
        };
        entry.instances++;
        entry.videoIds.add(r.meta.id);
        if (isW) entry.winVideoIds.add(r.meta.id);
        if (isF) entry.flopVideoIds.add(r.meta.id);
        hardCutMap.set(mech, entry);
      }
    }
    flushTake();
    if (vidTaggedShots > 0) {
      pillarVideoCount++;
      for (const [cat, entry] of pillarCounts) {
        const cnt = vidPillarCounts.get(cat) ?? 0;
        const share = (cnt / vidTaggedShots) * 100;
        entry.videoSharesAll.push(share);
        if (isW) entry.videoSharesWin.push(share);
        if (isF) entry.videoSharesFlop.push(share);
        if (cnt > 0) entry.presentVideos++;
      }
    }

    if (maxStreak > 0) {
      maxContStreakAll.push(maxStreak);
      if (isW) maxContStreakWin.push(maxStreak);
      if (isF) maxContStreakFlop.push(maxStreak);
    }
    if (vidMidDurs.length > 0 && vidLateDurs.length > 0) {
      const ratio = median(vidLateDurs) / Math.max(median(vidMidDurs), 0.1);
      lateToMidAll.push(ratio);
      if (isW) lateToMidWin.push(ratio);
      if (isF) lateToMidFlop.push(ratio);
    }
    if (hasWide && hasTight) {
      wideTightAll++;
      if (isW) wideTightWin++;
      if (isF) wideTightFlop++;
    }
    if (hasBigJump) {
      bigJumpAll++;
      if (isW) bigJumpWin++;
      if (isF) bigJumpFlop++;
    }

    const first = shots[0]!;
    const last = shots[shots.length - 1]!;
    if (first.scale) {
      openScaleAll.push(first.scale);
      if (isW) openScaleWin.push(first.scale);
      if (isF) openScaleFlop.push(first.scale);
    }
    if (first.angle) {
      openAngleAll.push(first.angle);
      if (isW) openAngleWin.push(first.angle);
      if (isF) openAngleFlop.push(first.angle);
    }
    if (last.scale) {
      closeScaleAll.push(last.scale);
      if (isW) closeScaleWin.push(last.scale);
      if (isF) closeScaleFlop.push(last.scale);
    }
    if (last.angle) {
      closeAngleAll.push(last.angle);
      if (isW) closeAngleWin.push(last.angle);
      if (isF) closeAngleFlop.push(last.angle);
    }
  }

  const mean = (arr: number[]) =>
    arr.length > 0 ? round1(arr.reduce((s, x) => s + x, 0) / arr.length) : null;
  const rawPillars = [...pillarCounts.entries()]
    .filter(([, v]) => v.all > 0)
    .map(([category, v]) => {
      const winPct = pillarTaggedWin > 0 ? pct(v.winner, pillarTaggedWin) : null;
      const flopPct = pillarTaggedFlop > 0 ? pct(v.flop, pillarTaggedFlop) : null;
      const meanVideoSharePct = mean(v.videoSharesAll);
      const winnerMeanVideoSharePct = mean(v.videoSharesWin);
      const flopMeanVideoSharePct = mean(v.videoSharesFlop);
      return {
        category,
        shots: v.all,
        pct: pct(v.all, pillarTaggedAll),
        winnerPct: winPct,
        flopPct: flopPct,
        winnerMinusFlopPp:
          winnerMeanVideoSharePct !== null && flopMeanVideoSharePct !== null
            ? round1(winnerMeanVideoSharePct - flopMeanVideoSharePct)
            : winPct !== null && flopPct !== null
              ? round1(winPct - flopPct)
              : null,
        meanVideoSharePct,
        winnerMeanVideoSharePct,
        flopMeanVideoSharePct,
        videoPrevalencePct: pillarVideoCount > 0 ? pct(v.presentVideos, pillarVideoCount) : null,
        pValue:
          v.videoSharesWin.length > 0 && v.videoSharesFlop.length > 0
            ? mannWhitneyTwoSided(v.videoSharesWin, v.videoSharesFlop)
            : null,
        qValue: null as number | null,
      };
    })
    .sort((a, b) => b.shots - a.shots || a.category.localeCompare(b.category));
  const pillarQ = benjaminiHochberg(rawPillars.map((p) => p.pValue));
  for (let i = 0; i < rawPillars.length; i++) rawPillars[i]!.qValue = pillarQ[i] ?? null;

  const pillarsByBeatRole: Record<
    string,
    Array<{ category: string; shots: number; pct: number }>
  > = {};
  for (const [role, beatTotal] of beatPillarTotals) {
    pillarsByBeatRole[role] = [...pillarCounts.entries()]
      .map(([category, v]) => ({
        category,
        shots: v.byBeat.get(role) ?? 0,
        pct: pct(v.byBeat.get(role) ?? 0, beatTotal),
      }))
      .filter((x) => x.shots > 0)
      .sort((a, b) => b.shots - a.shots || a.category.localeCompare(b.category))
      .slice(0, 3);
  }

  return {
    parsedVideoCount,
    macroLowFpsExcludedCount,
    fpsMode: (useMacroFallback ? "macro_lowfps" : "micro_24fps") as "micro_24fps" | "macro_lowfps",
    totalShots,
    confidenceCounts: confCounts,
    shotDurationEnvelope: {
      overall: summarizeDurationEnvelope(allDurs),
      winner: summarizeDurationEnvelope(winDurs),
      flop: summarizeDurationEnvelope(flopDurs),
      byBeatRoleMedianSec: Object.fromEntries(
        [...byBeatRole.entries()].map(([role, durs]) => [
          role,
          { n: durs.length, medianSec: round2(median(durs)) },
        ]),
      ),
      lateToMidPacingRatio: {
        overall: lateToMidAll.length > 0 ? round2(median(lateToMidAll)) : null,
        winner: lateToMidWin.length > 0 ? round2(median(lateToMidWin)) : null,
        flop: lateToMidFlop.length > 0 ? round2(median(lateToMidFlop)) : null,
      },
    },
    editTakeDurationEnvelope: {
      overall: summarizeDurationEnvelope(takeDursAll),
      winner: summarizeDurationEnvelope(takeDursWin),
      flop: summarizeDurationEnvelope(takeDursFlop),
    },
    dominantCraftMix: {
      taggedShots: pillarTaggedAll,
      categories: rawPillars,
      byBeatRole: pillarsByBeatRole,
    },
    transitionSpans: [...transMap.entries()]
      .map(([type, v]) => ({
        type,
        instances: v.totalInstances,
        videos: v.videoIds.size,
        medianFrames: v.frames.length > 0 ? round1(median(v.frames)) : null,
        iqrFrames: iqr(v.frames),
        medianSec: v.secs.length > 0 ? round2(median(v.secs)) : null,
        beatAlignmentPct: pct(v.beatAligned, v.totalInstances),
        reliability: reliabilityLabel(v.totalInstances) as ReliabilityLevel,
      }))
      .sort((a, b) => b.instances - a.instances || a.type.localeCompare(b.type)),
    hiddenCutMechanisms: [...hiddenMap.entries()]
      .map(([mechanism, v]) => ({
        mechanism,
        instances: v.instances,
        videos: v.videoIds.size,
        videoPct: pct(v.videoIds.size, parsedVideoCount),
      }))
      .sort((a, b) => b.instances - a.instances || a.mechanism.localeCompare(b.mechanism)),
    continuousBridgeMechanisms: [...contBridgeMap.entries()]
      .map(([mechanism, v]) => ({
        mechanism,
        instances: v.instances,
        videos: v.videoIds.size,
        videoPct: pct(v.videoIds.size, parsedVideoCount),
        winnerVideoPct: parsedWinCount > 0 ? pct(v.winVideoIds.size, parsedWinCount) : null,
        flopVideoPct: parsedFlopCount > 0 ? pct(v.flopVideoIds.size, parsedFlopCount) : null,
      }))
      .sort((a, b) => b.instances - a.instances || a.mechanism.localeCompare(b.mechanism)),
    hardCutMechanisms: [...hardCutMap.entries()]
      .map(([mechanism, v]) => ({
        mechanism,
        instances: v.instances,
        videos: v.videoIds.size,
        videoPct: pct(v.videoIds.size, parsedVideoCount),
        winnerVideoPct: parsedWinCount > 0 ? pct(v.winVideoIds.size, parsedWinCount) : null,
        flopVideoPct: parsedFlopCount > 0 ? pct(v.flopVideoIds.size, parsedFlopCount) : null,
      }))
      .sort((a, b) => b.instances - a.instances || a.mechanism.localeCompare(b.mechanism)),
    openingVsClosing: {
      openingScale: {
        overall: topShareList(openScaleAll),
        winner: topShareList(openScaleWin),
        flop: topShareList(openScaleFlop),
      },
      openingAngle: {
        overall: topShareList(openAngleAll),
        winner: topShareList(openAngleWin),
        flop: topShareList(openAngleFlop),
      },
      closingScale: {
        overall: topShareList(closeScaleAll),
        winner: topShareList(closeScaleWin),
        flop: topShareList(closeScaleFlop),
      },
      closingAngle: {
        overall: topShareList(closeAngleAll),
        winner: topShareList(closeAngleWin),
        flop: topShareList(closeAngleFlop),
      },
    },
    scaleDynamics: {
      wideAndTightSpanPct: {
        overall: parsedVideoCount > 0 ? pct(wideTightAll, parsedVideoCount) : null,
        winner: parsedWinCount > 0 ? pct(wideTightWin, parsedWinCount) : null,
        flop: parsedFlopCount > 0 ? pct(wideTightFlop, parsedFlopCount) : null,
      },
      bigScaleJumpVideoPct: {
        overall: parsedVideoCount > 0 ? pct(bigJumpAll, parsedVideoCount) : null,
        winner: parsedWinCount > 0 ? pct(bigJumpWin, parsedWinCount) : null,
        flop: parsedFlopCount > 0 ? pct(bigJumpFlop, parsedFlopCount) : null,
      },
      medianMaxContinuousStreakSec: {
        overall: maxContStreakAll.length > 0 ? round1(median(maxContStreakAll)) : null,
        winner: maxContStreakWin.length > 0 ? round1(median(maxContStreakWin)) : null,
        flop: maxContStreakFlop.length > 0 ? round1(median(maxContStreakFlop)) : null,
      },
    },
  };
}
