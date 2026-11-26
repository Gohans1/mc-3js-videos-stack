import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateCorpus,
  buildCategoryStats,
  classifyOpeningSentence,
  classifyTitleOpener,
  countTitleWords,
  CURRENT_STATS_VERSION,
  extractTrailingEmoji,
  type MinedRecord,
  reconcileWithCatalog,
  renderStatsSummaryMd,
  runAggregate,
  splitPunctuatedSentences,
} from "./aggregate.ts";
import {
  benjaminiHochberg,
  classifyEmojiValence,
  computeChannelMedianWpm,
  countSharedContentWords,
  countTitleChars,
  countTitleDisplayUnits,
  fisherExactTwoSided,
  isCorruptTranscript,
  isEnglishTextSample,
  mannWhitneyTwoSided,
  summarizeCatalogPackaging,
  summarizeTranscriptLinguistics,
} from "./catalog-metrics.ts";
import {
  assertNotRootChannelEntries,
  buildStratifiedQueue,
  buildTranscriptFetcherPyCode,
  canonicalizeBcp47Tag,
  cleanTranscriptText,
  computeOutlierScores,
  computeTranscriptTimingFromSegments,
  computeWpm,
  expectedAgeFraction,
  extractChapterMetrics,
  extractFlatThumbnailUrl,
  extractHeatmapMetrics,
  hasReliableSentencePunctuation,
  inferMaturityBounds,
  isNonVodEntry,
  isVideoMature,
  mergeCatalogEntry,
  resolveCollectDurationBounds,
  resolveEffectiveTranscriptLanguages,
  resolveQueueDurationOpts,
  segmentWords,
  selectEnrichmentTargets,
  selectTranscriptTargets,
  writeJsonAtomic,
} from "./collect.ts";
import {
  estimateUnifiedVideoTokens,
  expectedVideoTokensFloor,
  normalizeMediaLabel,
  parseGeminiSseStream,
  resolveGeminiApiKey,
  runGeminiApiVideo,
  toGeminiMediaResolution,
  toGeminiThinkingLevel,
  verifyGeminiApiVideoTokens,
} from "./gemini-api.ts";
import {
  buildAskNewArgs,
  burnTimecode720,
  classifyHaltReason,
  didSubmitCurrentVideo,
  downloadThumbnailWithFallback,
  executeAskAttempt,
  extractChatUrl,
  formatMineOutcome,
  isBotOrRateBlock,
  isMediaDowngradeError,
  isQuotaError,
  isTabBusyGenerating,
  isTerminalRunAbort,
  loadCheckpoint,
  parseAudioLoudnessStderr,
  probeAudioBackfill,
  resolveMiningFps,
  resolveThumbnailCandidates,
  runMine,
  saveCheckpoint,
  selectMineTargets,
  shouldAttachThumbnail,
  shouldHaltBatch,
  shouldRecordFailure,
} from "./mine.ts";
import {
  extractJsonBlock,
  parseAndValidateDossier,
  parseDominantCategoryCell,
  parseSection3Shots,
  parseTimeSpanEndSec,
} from "./schema.ts";
import { classifyContinuousBridgeMechanism, classifyHardCutMechanism } from "./shot-spine.ts";
import {
  ACTING_MODES,
  AUDIO_BED_STYLES,
  BEAT_ROLES,
  BGM_ENDING_BEHAVIORS,
  BGM_MOODS,
  BGM_TWIST_BEHAVIORS,
  CAMERA_ANGLES,
  CAMERA_ENERGIES,
  CAMERA_MOTION_PERSISTENCES,
  CAMERA_VELOCITY_PROFILES,
  CAPTION_STYLES,
  type CatalogFile,
  COLOR_PALETTE_MOODS,
  CRAFT_PILLAR_CATEGORIES,
  CRAFT_SIGNAL_KEYS,
  CRAFT_SIGNAL_KEYS_V2,
  CRAFT_SIGNAL_KEYS_V3,
  EASING_ENERGIES,
  EMOTIONAL_DRIVERS,
  ENDING_TYPES,
  ENDING_VALENCES,
  FRAMING_ANCHORS,
  HOOK_ARCHETYPES,
  INFORMATION_REVEAL_MODES,
  LENS_FEELS,
  LIGHTING_STYLES,
  NARRATION_POVS,
  NARRATIVE_CONNECTORS,
  NARRATIVE_TIMELINES,
  OPEN_LOOP_ARCHITECTURES,
  OPEN_LOOP_PAYOFF_TIMINGS,
  OPENING_SCROLL_STOP_STATES,
  PROTAGONIST_FORMATS,
  type RawCatalogVideo,
  SET_ARCHITECTURES,
  SFX_DENSITIES,
  SFX_LAYER_TYPES,
  SHADOW_QUALITIES,
  SHOT_SCALES,
  STAKES_ENGINES,
  STORY_STRUCTURES,
  THUMBNAIL_ARCHETYPES,
  THUMBNAIL_FOCAL_COMPLEXITIES,
  THUMBNAIL_GAZE_OR_CUES,
  THUMBNAIL_OPENING_PAYOFFS,
  THUMBNAIL_TEXT_RELATIONS,
  TIME_REMAP_TYPES,
  TITLE_HOOK_RELATIONS,
  TOPIC_CATEGORIES,
  type VideoTelemetry,
  VISUAL_LAYER_FORMATS,
  VISUAL_MEDIUMS,
  VO_VISUAL_RELATIONS,
  VOICE_DELIVERIES,
} from "./types.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const CLI_PATH = join(SCRIPT_DIR, "cli.ts");

function makeSampleTelemetry(overrides: Partial<VideoTelemetry> = {}): VideoTelemetry {
  return {
    schema_version: 1,
    duration_sec: 40,
    topic_category: "explainer_how_it_works",
    topic_sublabel: "industrial_food_design",
    hook_archetype: "visual_pattern_interrupt",
    opening_shot_sec: 3.2,
    opening_spoken_line: "Ever wonder why chips never make you full?",
    hook_visual_trigger: "Camera dives into a glowing snack bowl",
    story_structure: "mechanism_step_by_step",
    narrative_connector: "but_therefore",
    ending_type: "ironic_twist_punchline",
    twist_at_pct: 78,
    rehook_timestamps_sec: [10.5, 22.0, 31.2],
    story_beats: [
      { role: "hook", start_sec: 0, end_sec: 4, pct_runtime: 10 },
      { role: "setup", start_sec: 4, end_sec: 12, pct_runtime: 20 },
      { role: "explanation_value", start_sec: 12, end_sec: 28, pct_runtime: 40 },
      { role: "twist", start_sec: 28, end_sec: 36, pct_runtime: 20 },
      { role: "resolution", start_sec: 36, end_sec: 40, pct_runtime: 10 },
    ],
    boundary_counts: { hard_cut: 0, hidden_cut: 1, transition: 1, continuous: 2 },
    transition_types: ["card_flip"],
    shot_scale_counts: { EW: 0, W: 1, M: 2, MCU: 1, CU: 1, ECU: 0, INSERT: 0 },
    camera_angle_counts: { aerial: 0, overhead: 0, high: 1, eye: 3, low: 1, ground: 0 },
    camera_energy: "smooth_damped_continuous",
    dominant_lens_feel: "normal",
    lighting_style: "clean_studio_soft",
    easing_energy: "snappy_overshoot",
    audio_bed_style: "continuous_bgm_plus_vo",
    craft_signals: {
      has_cutaway_or_xray: true,
      has_diegetic_text_or_labels: true,
      has_motion_graphics_or_arrows: false,
      has_emissive_highlight_pulse: true,
      has_pre_impact_silence: true,
      has_jl_cut: false,
      has_time_remap_or_hit_stop: false,
      has_seamless_loop: false,
      uses_motion_blur: true,
      uses_shallow_dof: true,
      uses_backdrop_vignette: true,
    },
    reusable_script_template:
      "[MUNDANE HABIT] feels harmless, BUT [HIDDEN MECHANISM] -> TWIST [IRONY]",
    secret_sauce_cues: ["camera dives through cutaway wall without cutting"],
    weaknesses_or_drag: [],
    ...overrides,
  };
}

function makeSampleDossier(telemetry: VideoTelemetry, sec3RowsOverride?: string[]): string {
  const sec3Rows = sec3RowsOverride ?? [
    "| S01 | 00:00.000-00:03.200 (f0-f96) | Opening | M / eye | Damped push-in `[Camera, Framing & Staging]` | High |",
    "| S02a | 00:03.233-00:12.000 (f97-f360) | Continuous [NO CUT] (dolly dive) | CU / eye | Cutaway fly-in `[VFX, Cutaways & Graphics]` | High |",
    "| S02b | 00:12.033-00:22.000 (f361-f660) | Continuous [NO CUT] (orbit) | MCU / high | Soft studio shadows `[Lighting, Color & Materials]` | High |",
    "| S03 | 00:22.033-00:31.000 (f661-f930) | Hidden Cut (whip right) | W / low | Whip swap into lab `[Transitions & Continuity]` | High |",
    "| S04 | 00:31.033-00:40.000 (f931-f1200) | Transition (card_flip, f931-f940) | M / eye | Card flip to twist reveal `[Transitions & Continuity]` | High |",
  ];
  return [
    "### 1. Hook, Packaging & Channel DNA Summary",
    "- **Topic & Premise:** Explainer on snack engineering.",
    "- **Hook Anatomy (0-3s):** Visual pattern interrupt with fast dive.",
    "",
    "### 2. Narrative Arc, Retention Beats & Directorial Intent",
    "| Beat | Time & Frames | Pct | Narrative & Script Function | Directorial Intent |",
    "| --- | --- | --- | --- | --- |",
    "| hook | 00:00.000-00:04.000 (f0-f120) | 10% | Opens mid-action | Smooth push pulls viewer into object |",
    "",
    "### 3. Macro Shot, Boundary & Craft Pattern Spine",
    "| ID | Time & Frames | Boundary | Scale / Angle | Camera, Motion & Dominant Craft [Category] | Conf |",
    "| --- | --- | --- | --- | --- | --- |",
    ...sec3Rows,
    "",
    "### 4. Structured Telemetry JSON",
    "```json",
    JSON.stringify(telemetry, null, 2),
    "```",
  ].join("\n");
}

function makeCatalog(raw: RawCatalogVideo[], snapshotDate = "2026-11-23"): CatalogFile {
  const scored = computeOutlierScores(raw, snapshotDate);
  return {
    channel: "demo-ch",
    sourceUrl: "https://www.youtube.com/@demo/shorts",
    snapshotDate,
    totalCollected: scored.videos.length,
    matureCount: scored.matureCount,
    enrichedCount: scored.videos.filter((v) => v.durationSec !== null && v.uploadDate !== null)
      .length,
    transcriptCount: scored.videos.filter((v) => typeof v.wpm === "number").length,
    globalMatureMedianViews: scored.globalMatureMedianViews,
    videos: scored.videos,
  };
}

function makeRecord(
  id: string,
  tier: "winner" | "median" | "flop" | "provisional",
  outlier: number,
  tel: VideoTelemetry,
  wpm: number | null = tier === "winner" ? 155 : 180,
): MinedRecord {
  return {
    meta: {
      id,
      title: id,
      url: `https://www.youtube.com/shorts/${id}`,
      views: tier === "winner" ? 40_000_000 : 3_000_000,
      likes: 100_000,
      durationSec: tel.duration_sec,
      uploadDate: tier === "provisional" ? "20261120" : "20260701",
      outlierRolling: outlier,
      outlierGlobal: outlier,
      tier,
      wordCount: wpm ? Math.round((wpm * tel.duration_sec) / 60) : null,
      wpm,
      minedAt: "2026-11-23T00:00:00Z",
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      promptVersion: "v2",
      chatUrl: null,
      elapsedSec: 120,
      attempts: 1,
      warnings: [],
    },
    telemetry: tel,
  };
}

test("Reusable Film & Motion Craft Taxonomy is byte-identical across analyze-ref, compare-2, and learn-channel prompts", () => {
  const grab = (relPath: string) => {
    const text = readFileSync(join(REPO_ROOT, relPath), "utf8");
    const start = text.indexOf("## Reusable Film & Motion Craft Taxonomy");
    const end = text.indexOf("\n---", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
  };
  const refTax = grab(".claude/skills/analyze-ref-video/system/analyze-ref-video.md");
  const cmpTax = grab(".claude/skills/compare-video/system/compare-2-video.md");
  const lrnTax = grab(".claude/skills/channel-dna/system/learn-channel-video.md");
  expect(lrnTax).toBe(refTax);
  expect(lrnTax).toBe(cmpTax);
});

test("aistudio stays a pure transport skill while analyze-ref-video and compare-video own their prompts and evals", () => {
  expect(existsSync(join(REPO_ROOT, ".claude/skills/aistudio/system"))).toBe(false);
  expect(existsSync(join(REPO_ROOT, ".claude/skills/aistudio/references/prompts"))).toBe(false);
  expect(existsSync(join(REPO_ROOT, ".claude/skills/aistudio/references/browser"))).toBe(false);
  for (const rel of [
    ".claude/skills/aistudio/SKILL.md",
    ".claude/skills/aistudio/references/development.md",
    ".claude/skills/aistudio/references/ui-changes.md",
    ".claude/skills/analyze-ref-video/SKILL.md",
    ".claude/skills/analyze-ref-video/system/analyze-ref-video.md",
    ".claude/skills/analyze-ref-video/references/prompt-design.md",
    ".claude/skills/analyze-ref-video/references/eval-guide.md",
    ".claude/skills/analyze-ref-video/references/eval-baseline.json",
    ".claude/skills/compare-video/SKILL.md",
    ".claude/skills/compare-video/system/compare-2-video.md",
    ".claude/skills/compare-video/references/prompt-design.md",
    ".claude/skills/compare-video/references/eval-guide.md",
    ".claude/skills/compare-video/references/eval-baseline.json",
  ]) {
    expect(existsSync(join(REPO_ROOT, rel)), `missing ${rel}`).toBe(true);
  }
});

test("split eval-baseline.json files preserve full analyze-ref and compare-video benchmark records", () => {
  const refBase = JSON.parse(
    readFileSync(
      join(REPO_ROOT, ".claude/skills/analyze-ref-video/references/eval-baseline.json"),
      "utf8",
    ),
  );
  expect(refBase.shippedPrompt.file).toBe(
    ".claude/skills/analyze-ref-video/system/analyze-ref-video.md",
  );
  expect(refBase.comparePromptEval).toBeUndefined();
  expect(refBase.corpusZackDFilms60.length).toBe(60);
  expect(refBase.corpusOOD2.length).toBe(2);
  const cmpBase = JSON.parse(
    readFileSync(
      join(REPO_ROOT, ".claude/skills/compare-video/references/eval-baseline.json"),
      "utf8",
    ),
  );
  expect(cmpBase.comparePromptEval.shippedPrompt.file).toBe(
    ".claude/skills/compare-video/system/compare-2-video.md",
  );
  expect(Object.keys(cmpBase.comparePromptEval.arms).length).toBe(10);
});

test("decoupled workflow SKILL.md files contain no stray ASCII control bytes", () => {
  for (const skillMd of [
    ".claude/skills/aistudio/SKILL.md",
    ".claude/skills/analyze-ref-video/SKILL.md",
    ".claude/skills/compare-video/SKILL.md",
    ".claude/skills/channel-dna/SKILL.md",
  ]) {
    const text = readFileSync(join(REPO_ROOT, skillMd), "utf8");
    let hasControl = false;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (
        (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
      ) {
        hasControl = true;
        break;
      }
    }
    expect(hasControl, `control char in ${skillMd}`).toBe(false);
  }
});

test("parseAndValidateDossier accepts valid schema_version 1 (prompt v2) 4-section dossier with zero warnings", () => {
  const ok = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        hook_archetype: "imperative_how_to_step",
        topic_category: "food_diy_and_hacks",
      }),
    ),
  );
  expect(ok.valid, ok.errors.join("; ")).toBe(true);
  expect(ok.errors).toEqual([]);
  expect(ok.warnings).toEqual([]);
  expect(ok.sec3TotalRows).toBe(5);
  expect(ok.sec3BoundaryCounts).toEqual({
    hard_cut: 0,
    hidden_cut: 1,
    transition: 1,
    continuous: 2,
  });
});

test("parseAndValidateDossier rejects missing sections, truncation, malformed JSON, and engine leaks", () => {
  const validMd = makeSampleDossier(makeSampleTelemetry());
  expect(parseAndValidateDossier("### 1. Only one section").valid).toBe(false);
  expect(parseAndValidateDossier(validMd.slice(0, validMd.lastIndexOf("```"))).valid).toBe(false);
  expect(parseAndValidateDossier(validMd.replace('"schema_version": 1,', "{bad")).valid).toBe(
    false,
  );
  const leak = parseAndValidateDossier(`${validMd}\nNote: render via draw(t) and THREE.Mesh`);
  expect(leak.valid).toBe(false);
  expect(leak.errors.some((e) => e.includes("engine/CLI leak"))).toBe(true);
});

test("parseAndValidateDossier rejects empty Section 3, duplicate or late Opening rows, and invalid boundary enums", () => {
  const tel = makeSampleTelemetry();
  expect(
    parseAndValidateDossier(makeSampleDossier(tel, [])).errors.some((e) => e.includes("0 rows")),
  ).toBe(true);

  const twoOpenings = parseAndValidateDossier(
    makeSampleDossier(tel, [
      "| S01 | 00:00.000-00:03.200 | Opening | M / eye | A | High |",
      "| S02 | 00:03.200-00:06.000 | Opening | M / eye | B | High |",
    ]),
  );
  expect(twoOpenings.errors.some((e) => e.includes("exactly 1 Opening"))).toBe(true);

  const lateOpening = parseAndValidateDossier(
    makeSampleDossier(tel, [
      "| S01 | 00:00.000-00:03.200 | Hard Cut | M / eye | A | High |",
      "| S02 | 00:03.200-00:06.000 | Opening | M / eye | B | High |",
    ]),
  );
  expect(lateOpening.errors.some((e) => e.includes("must be Row 1"))).toBe(true);

  const badBoundary = parseAndValidateDossier(
    makeSampleDossier(tel, [
      "| S01 | 00:00.000-00:03.200 | Opening | M / eye | A | High |",
      "| S02 | 00:03.200-00:06.000 | Jump Swipe | M / eye | B | High |",
    ]),
  );
  expect(badBoundary.errors.some((e) => e.includes("invalid boundary"))).toBe(true);
});

test("parseAndValidateDossier rejects invalid Section 3 Scale / Angle tokens instead of silently bypassing per-key cross-checks", () => {
  const poisoned = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        boundary_counts: { hard_cut: 3, hidden_cut: 0, transition: 0, continuous: 0 },
        transition_types: [],
        shot_scale_counts: { EW: 0, W: 0, M: 0, MCU: 0, CU: 0, ECU: 4, INSERT: 0 },
        camera_angle_counts: { aerial: 4, overhead: 0, high: 0, eye: 0, low: 0, ground: 0 },
      }),
      [
        "| S01 | 00:00.000-00:03.200 | Opening | INVALID_SCALE / eye-level | A | High |",
        "| S02 | 00:03.200-00:12.000 | Hard Cut | M / eye | B | High |",
        "| S03 | 00:12.000-00:25.000 | Hard Cut | M / eye | C | High |",
        "| S04 | 00:25.000-00:40.000 | Hard Cut | M / eye | D | High |",
      ],
    ),
  );
  expect(poisoned.valid).toBe(false);
  expect(poisoned.errors.some((e) => e.includes("invalid shot scale"))).toBe(true);
  expect(poisoned.errors.some((e) => e.includes("invalid camera angle"))).toBe(true);
});

test("parseAndValidateDossier enforces opening_shot_sec bounds (duration cap, warn >=0.5s, error >=1.5s) and retired hooks", () => {
  const overDur = parseAndValidateDossier(
    makeSampleDossier(makeSampleTelemetry({ opening_shot_sec: 45 })),
  );
  expect(overDur.valid).toBe(false);
  expect(overDur.errors.some((e) => e.includes("exceeds duration_sec"))).toBe(true);

  const errDrift = parseAndValidateDossier(
    makeSampleDossier(makeSampleTelemetry({ opening_shot_sec: 24.2 })),
  );
  expect(errDrift.valid).toBe(false);
  expect(errDrift.errors.some((e) => e.includes("opening_shot_sec"))).toBe(true);

  const warnDrift = parseAndValidateDossier(
    makeSampleDossier(makeSampleTelemetry({ opening_shot_sec: 3.9 })),
  );
  expect(warnDrift.valid).toBe(true);
  expect(warnDrift.warnings.some((w) => w.includes("opening_shot_sec"))).toBe(true);

  const retired = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        hook_archetype: "cold_open_action" as VideoTelemetry["hook_archetype"],
      }),
    ),
  );
  expect(retired.valid).toBe(false);
  expect(retired.errors.some((e) => e.includes("invalid hook_archetype"))).toBe(true);
});

test("parseAndValidateDossier enforces diff=1 warn vs diff>=2 error on boundary, scale, and angle counts", () => {
  const warnB = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        boundary_counts: { hard_cut: 1, hidden_cut: 1, transition: 1, continuous: 2 },
      }),
    ),
  );
  expect(warnB.valid).toBe(true);
  expect(warnB.warnings.some((w) => w.includes("boundary_counts.hard_cut"))).toBe(true);

  const errB = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        boundary_counts: { hard_cut: 2, hidden_cut: 1, transition: 1, continuous: 2 },
      }),
    ),
  );
  expect(errB.valid).toBe(false);
  expect(errB.errors.some((e) => e.includes("boundary_counts.hard_cut"))).toBe(true);

  const swapScale = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        shot_scale_counts: { EW: 2, W: 1, M: 0, MCU: 1, CU: 1, ECU: 0, INSERT: 0 },
      }),
    ),
  );
  expect(swapScale.valid).toBe(false);
  expect(swapScale.errors.some((e) => e.includes("shot_scale_counts.EW"))).toBe(true);

  const swapAngle = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        camera_angle_counts: { aerial: 2, overhead: 0, high: 1, eye: 1, low: 1, ground: 0 },
      }),
    ),
  );
  expect(swapAngle.valid).toBe(false);
  expect(swapAngle.errors.some((e) => e.includes("camera_angle_counts.aerial"))).toBe(true);
});

test("parseAndValidateDossier enforces story_beats pct_runtime sum, start_sec >= 0, craft_signals booleans, and stale transition_types warning", () => {
  const rowsNoTrans = [
    "| S01 | 00:00.000-00:03.200 (f0-f96) | Opening | M / eye | A | High |",
    "| S02a | 00:03.233-00:12.000 (f97-f360) | Continuous [NO CUT] (dolly) | CU / eye | B | High |",
    "| S02b | 00:12.033-00:22.000 (f361-f660) | Continuous [NO CUT] (orbit) | MCU / high | C | High |",
    "| S03 | 00:22.033-00:31.000 (f661-f930) | Hidden Cut (whip) | W / low | D | High |",
    "| S04 | 00:31.033-00:40.000 (f931-f1200) | Hard Cut | M / eye | E | High |",
  ];
  const stale = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        boundary_counts: { hard_cut: 1, hidden_cut: 1, transition: 0, continuous: 2 },
        transition_types: ["card_flip"],
      }),
      rowsNoTrans,
    ),
  );
  expect(stale.valid).toBe(true);
  expect(stale.warnings.length).toBe(1);
  expect(stale.warnings[0]).toContain("transition_types");

  const badPctSum = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        story_beats: [{ role: "hook", start_sec: 0, end_sec: 4, pct_runtime: 45 }],
      }),
    ),
  );
  expect(badPctSum.valid).toBe(false);
  expect(badPctSum.errors.some((e) => e.includes("outside 90..110"))).toBe(true);

  const negStart = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        story_beats: [{ role: "hook", start_sec: -1, end_sec: 40, pct_runtime: 100 }],
      }),
    ),
  );
  expect(negStart.valid).toBe(false);

  const badCraft = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        craft_signals: {
          ...makeSampleTelemetry().craft_signals,
          has_cutaway_or_xray: "yes" as unknown as boolean,
        },
      }),
    ),
  );
  expect(badCraft.valid).toBe(false);
  expect(badCraft.errors.some((e) => e.includes("craft_signals.has_cutaway_or_xray"))).toBe(true);
});

test("parseTimeSpanEndSec extracts the end of the primary span and rejects single timestamps", () => {
  expect(parseTimeSpanEndSec("00:00.000–00:03.200 (f0–f96)")).toBe(3.2);
  expect(parseTimeSpanEndSec("00:00.000-00:01.535 (note ref 00:10.000)")).toBe(1.535);
  expect(parseTimeSpanEndSec("00:01:05.500–00:01:12.250")).toBe(72.25);
  expect(parseTimeSpanEndSec("00:00.000")).toBeNull();
  expect(parseTimeSpanEndSec("no timestamp")).toBeNull();
});

test("expectedAgeFraction scales smoothly under 30 days and clamps to 1.0 at >=30 days", () => {
  expect(expectedAgeFraction(1)).toBeCloseTo((1 / 30) ** 0.55, 5);
  expect(expectedAgeFraction(15)).toBeCloseTo(0.5 ** 0.55, 5);
  expect(expectedAgeFraction(30)).toBe(1);
  expect(expectedAgeFraction(90)).toBe(1);
});

test("inferMaturityBounds and computeOutlierScores adapt to high-frequency, slow, and exact 29d vs 30d boundaries", () => {
  const highFreq: RawCatalogVideo[] = Array.from({ length: 60 }, (_, i) => ({
    id: `hf${i}`,
    title: `HF ${i}`,
    url: `https://www.youtube.com/shorts/hf${i}`,
    playlistIndex: i,
    views: 10_000_000,
    likes: i === 10 || i === 45 || i === 46 ? 300_000 : null,
    durationSec: i === 10 || i === 45 || i === 46 ? 35 : null,
    uploadDate: i === 10 ? "20261118" : i === 45 ? "20261025" : i === 46 ? "20261024" : null,
  }));
  expect(inferMaturityBounds(highFreq, "2026-11-23")).toEqual({
    maxYoungIdx: 45,
    minMatureIdx: 46,
  });
  const scoredHf = computeOutlierScores(highFreq, "2026-11-23");
  expect(scoredHf.matureCount).toBe(14);
  const hfById = new Map(scoredHf.videos.map((v) => [v.id, v]));
  expect(hfById.get("hf45")!.isMature).toBe(false);
  expect(hfById.get("hf46")!.isMature).toBe(true);

  const youngOnlyAnchor: RawCatalogVideo[] = Array.from({ length: 45 }, (_, i) => ({
    id: `yo${i}`,
    title: `YO ${i}`,
    url: `https://www.youtube.com/shorts/yo${i}`,
    playlistIndex: i,
    views: 5_000_000,
    likes: null,
    durationSec: i === 10 ? 30 : null,
    uploadDate: i === 10 ? "20261115" : null,
  }));
  expect(computeOutlierScores(youngOnlyAnchor, "2026-11-23").matureCount).toBe(0);

  const slowChannel: RawCatalogVideo[] = Array.from({ length: 12 }, (_, i) => ({
    id: `sl${i}`,
    title: `Slow ${i}`,
    url: `https://www.youtube.com/shorts/sl${i}`,
    playlistIndex: i,
    views: 2_000_000,
    likes: i <= 2 ? 100_000 : null,
    durationSec: i <= 2 ? 50 : null,
    uploadDate: i === 0 ? "20261115" : i === 2 ? "20260915" : null,
  }));
  const slowById = new Map(
    computeOutlierScores(slowChannel, "2026-11-23").videos.map((v) => [v.id, v]),
  );
  expect(slowById.get("sl1")!.isMature).toBe(false);
  expect(slowById.get("sl2")!.isMature).toBe(true);
  expect(slowById.get("sl8")!.isMature).toBe(true);
});

test("inferMaturityBounds ignores pinned old videos at idx=0 and off-feed deleted young carry-overs", () => {
  const pinnedFeed: RawCatalogVideo[] = Array.from({ length: 100 }, (_, i) => ({
    id: `p${i}`,
    title: `P${i}`,
    url: `https://www.youtube.com/shorts/p${i}`,
    playlistIndex: i,
    views: 10_000_000,
    likes: null,
    durationSec: i === 0 || i === 60 ? 35 : null,
    uploadDate: i === 0 ? "20250601" : i === 60 ? "20261101" : null,
  }));
  expect(inferMaturityBounds(pinnedFeed, "2026-11-23")).toEqual({
    maxYoungIdx: 60,
    minMatureIdx: null,
  });
  const pinnedScored = computeOutlierScores(pinnedFeed, "2026-11-23");
  expect(pinnedScored.matureCount).toBe(1);

  const carryOverFeed: RawCatalogVideo[] = Array.from({ length: 50 }, (_, i) => ({
    id: `c${i}`,
    title: `C${i}`,
    url: `https://www.youtube.com/shorts/c${i}`,
    playlistIndex: i,
    views: 10_000_000,
    likes: null,
    durationSec: i === 10 || i === 12 ? 35 : null,
    uploadDate: i === 10 ? "20261110" : i === 12 ? "20261015" : null,
  }));
  carryOverFeed.push({
    id: "deletedYoung",
    title: "Deleted Young",
    url: "https://www.youtube.com/shorts/deletedYoung",
    playlistIndex: 50,
    views: 2_000_000,
    likes: null,
    durationSec: 30,
    uploadDate: "20261120",
    offFeed: true,
  });
  expect(inferMaturityBounds(carryOverFeed, "2026-11-23")).toEqual({
    maxYoungIdx: 10,
    minMatureIdx: 12,
  });
  expect(computeOutlierScores(carryOverFeed, "2026-11-23").matureCount).toBe(38);
});

test("computeOutlierScores prevents mature peer contamination, double-discounting, 1-video explosion, and self-inclusion", () => {
  const solo = computeOutlierScores(
    [
      {
        id: "only1",
        title: "Solo",
        url: "https://www.youtube.com/shorts/only1",
        playlistIndex: 35,
        views: 5_000_000,
        likes: 200_000,
        durationSec: 40,
        uploadDate: "20260701",
      },
    ],
    "2026-11-23",
  );
  expect(solo.videos[0]!.outlierRolling).toBe(1);
  expect(solo.videos[0]!.outlierGlobal).toBe(1);

  const mixed: RawCatalogVideo[] = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `y${i}`,
      title: `Y${i}`,
      url: `https://www.youtube.com/shorts/y${i}`,
      playlistIndex: i,
      views: i === 0 ? 2_000_000 : 50_000,
      likes: null,
      durationSec: i === 0 ? 35 : null,
      uploadDate: i === 0 ? "20261122" : null,
    })),
    ...[12_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000].map((views, j) => ({
      id: `m${j}`,
      title: `M${j}`,
      url: `https://www.youtube.com/shorts/m${j}`,
      playlistIndex: 10 + j,
      views,
      likes: 400_000,
      durationSec: 40,
      uploadDate: `2026080${5 - j}`,
    })),
  ];
  const scored = computeOutlierScores(mixed, "2026-11-23");
  const byId = new Map(scored.videos.map((v) => [v.id, v]));
  expect(byId.get("m0")!.outlierRolling).toBe(1.2);
  expect(byId.get("m0")!.outlierGlobal).toBe(1.2);
  expect(byId.get("m1")!.outlierRolling).toBe(1);
  expect(byId.get("y0")!.outlierRolling).toBeCloseTo(1.3, 1);
});

test("mergeCatalogEntry updates views monotonically and selectEnrichmentTargets probes fresh channels and refreshes newly matured items", () => {
  const prev: RawCatalogVideo = {
    id: "v1",
    title: "Old",
    url: "https://www.youtube.com/shorts/v1",
    playlistIndex: 5,
    views: 2_800_000,
    likes: 90_000,
    durationSec: 32,
    uploadDate: "20261015",
    enrichedMature: false,
    transcriptText: null,
  };
  const merged = mergeCatalogEntry(
    prev,
    { id: "v1", title: "Updated", view_count: 18_000_000 },
    prev.url,
    12,
  );
  expect(merged.views).toBe(18_000_000);
  expect(merged.offFeed).toBe(false);

  const freshBulk: RawCatalogVideo[] = Array.from({ length: 200 }, (_, i) => ({
    id: `f${i}`,
    title: `F${i}`,
    url: `https://www.youtube.com/shorts/f${i}`,
    playlistIndex: i,
    views: 5_000_000,
    likes: null,
    durationSec: null,
    uploadDate: null,
  }));
  const freshPicks = selectEnrichmentTargets(freshBulk, 15, "2026-11-23").map(
    (v) => v.playlistIndex,
  );
  expect(freshPicks).toContain(3);
  expect(freshPicks).toContain(180);

  const txTargets = selectTranscriptTargets(
    [
      {
        ...prev,
        id: "youngTx",
        uploadDate: "20261120",
        durationSec: 30,
        transcriptText: undefined,
      },
      { ...prev, id: "doneEmpty", uploadDate: "20260901", durationSec: 30, transcriptText: "" },
      {
        ...prev,
        id: "matureTx",
        uploadDate: "20260901",
        durationSec: 30,
        transcriptText: undefined,
      },
    ],
    2,
    "2026-11-23",
  );
  expect(txTargets.map((v) => v.id)).toEqual(["matureTx", "youngTx"]);
});

test("buildStratifiedQueue excludes <10s and >185s videos and interleaves 40/30/30 Winner/Median/Flop pattern", () => {
  const raw: RawCatalogVideo[] = Array.from({ length: 20 }, (_, i) => ({
    id: `v${String(i).padStart(2, "0")}`,
    title: `V${i}`,
    url: `https://www.youtube.com/shorts/v${i}`,
    playlistIndex: 40 - i,
    views: (i + 1) * 1_000_000,
    likes: 50_000,
    durationSec: i === 0 ? 8 : i === 19 ? 200 : i === 18 ? 180 : 35,
    uploadDate: `202607${String(1 + i).padStart(2, "0")}`,
  }));
  const scored = computeOutlierScores(raw, "2026-11-23");
  const byId = new Map(scored.videos.map((v) => [v.id, v]));
  const queue = buildStratifiedQueue(scored.videos, new Set());
  expect(queue).not.toContain("v00");
  expect(queue).not.toContain("v19");
  expect(queue).toContain("v18");
  expect(queue.slice(0, 6).map((id) => byId.get(id)!.tier)).toEqual([
    "winner",
    "flop",
    "median",
    "winner",
    "median",
    "flop",
  ]);
});

test("cleanTranscriptText strips sound tags, supports Unicode words, and computes WPM", () => {
  const en = cleanTranscriptText(
    "  >> [music] The elephant was shot in the head, and it survived! (applause) Then he walked 5 miles. ",
  );
  expect(en.wordCount).toBe(15);
  expect(en.openingSentence).toBe("The elephant was shot in the head, and it survived!");
  expect(cleanTranscriptText("Bonjour le monde café.").wordCount).toBe(4);
  expect(computeWpm(90, 30)).toBe(180);
  expect(computeWpm(0, 30)).toBeNull();
});

test("runMine retries schema failures once, cleans raw-failed-a1.md on success, and handles persistent failures with retryFailed", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-retry-test-"));
  try {
    const raw: RawCatalogVideo[] = ["a1", "a2", "a3"].map((id, i) => ({
      id,
      title: id,
      url: `https://www.youtube.com/shorts/${id}`,
      playlistIndex: 10 - i,
      views: (i + 1) * 5_000_000,
      likes: 100_000,
      durationSec: 35,
      uploadDate: `2026080${i + 1}`,
    }));
    const catalog = makeCatalog(raw);
    writeJsonAtomic(join(tmp, "catalog.json"), catalog);
    const ck = loadCheckpoint(tmp, "demo-ch");
    saveCheckpoint(tmp, ck, catalog);

    const res = await runMine({
      channel: "demo-ch",
      corpusDir: tmp,
      limit: 2,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      minSchema: 1,
      ids: ["a3", "a1"],
      runVideo: async (vid, _tab, attempt) => {
        if (vid.id === "a3") {
          return attempt === 1
            ? { ok: true, markdown: "### 1. Truncated" }
            : { ok: true, markdown: makeSampleDossier(makeSampleTelemetry()) };
        }
        return { ok: false, error: "transient parse error" };
      },
    });
    expect(res.done).toBe(1);
    expect(res.failed).toBe(1);
    expect(existsSync(join(tmp, "videos", "a3", "raw-failed-a1.md"))).toBe(false);
    expect(existsSync(join(tmp, "videos", "a3", "dossier.md"))).toBe(true);

    const ckAfter = loadCheckpoint(tmp, "demo-ch");
    expect(ckAfter.entries.a3?.status).toBe("done");
    expect(ckAfter.entries.a1?.status).toBe("failed");
    expect(selectMineTargets(catalog, ckAfter, tmp, { limit: 10 })).not.toContain("a1");
    expect(selectMineTargets(catalog, ckAfter, tmp, { limit: 10, retryFailed: true })).toContain(
      "a1",
    );

    expect(shouldRecordFailure(ckAfter.entries.a3, join(tmp, "videos", "a3"), false)).toBe(false);
    const remineFail = await runMine({
      channel: "demo-ch",
      corpusDir: tmp,
      limit: 1,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      ids: ["a3"],
      runVideo: async () => ({ ok: false, error: "network drop" }),
    });
    expect(remineFail.failed).toBe(1);
    expect(loadCheckpoint(tmp, "demo-ch").entries.a3?.status).toBe("done");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("runMine halts parallel workers on quota errors without poisoning failed entries and deduplicates --ids", async () => {
  expect(isQuotaError("You've reached your daily limit")).toBe(true);
  expect(isQuotaError("HTTP 429 too many requests")).toBe(true);
  expect(isQuotaError("schema validation failed")).toBe(false);

  const tmp = mkdtempSync(join(tmpdir(), "cdna-quota-test-"));
  try {
    const raw: RawCatalogVideo[] = ["a1", "a2", "a3", "a4"].map((id, i) => ({
      id,
      title: id,
      url: `https://www.youtube.com/shorts/${id}`,
      playlistIndex: 10 - i,
      views: (i + 1) * 5_000_000,
      likes: 100_000,
      durationSec: 35,
      uploadDate: `2026080${i + 1}`,
    }));
    const catalog = makeCatalog(raw);
    writeJsonAtomic(join(tmp, "catalog.json"), catalog);
    const ck = loadCheckpoint(tmp, "demo-ch");
    saveCheckpoint(tmp, ck, catalog);
    expect(selectMineTargets(catalog, ck, tmp, { ids: ["a1", "a1", "a2"], limit: 10 })).toEqual([
      "a1",
      "a2",
    ]);

    const res = await runMine({
      channel: "demo-ch",
      corpusDir: tmp,
      limit: 4,
      tabs: 2,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      minSchema: 1,
      ids: ["a4", "a3", "a2", "a1"],
      runVideo: async (vid) => {
        if (vid.id === "a4") {
          return { ok: true, markdown: makeSampleDossier(makeSampleTelemetry()) };
        }
        await Bun.sleep(10);
        return { ok: false, error: "AI Studio daily limit reached" };
      },
    });
    expect(res.quotaHalted).toBe(true);
    expect(res.failed).toBe(0);
    const reloaded = loadCheckpoint(tmp, "demo-ch");
    expect(reloaded.failedCount).toBe(0);
    expect(reloaded.entries.a4?.status).toBe("done");
    expect(reloaded.entries.a3).toBeUndefined();
    expect(reloaded.entries.a1).toBeUndefined();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("buildCategoryStats computes exact unrounded winnerToFlopLift without pre-rounding drift", () => {
  const recs: MinedRecord[] = [
    makeRecord("w1", "winner", 3, makeSampleTelemetry({ hook_archetype: "shock_fact_stat" })),
    makeRecord("w2", "winner", 3, makeSampleTelemetry({ hook_archetype: "mystery_question" })),
    makeRecord("w3", "winner", 3, makeSampleTelemetry({ hook_archetype: "mystery_question" })),
    makeRecord("f1", "flop", 0.3, makeSampleTelemetry({ hook_archetype: "shock_fact_stat" })),
    makeRecord("f2", "flop", 0.3, makeSampleTelemetry({ hook_archetype: "shock_fact_stat" })),
    ...Array.from({ length: 5 }, (_, i) =>
      makeRecord(`f${i + 3}`, "flop", 0.3, makeSampleTelemetry({ hook_archetype: "myth_bust" })),
    ),
  ];
  const stat = buildCategoryStats(recs, (r) => r.telemetry.hook_archetype).find(
    (b) => b.key === "shock_fact_stat",
  )!;
  expect(stat.winnerToFlopLift).toBe(1.17);
});

test("aggregateCorpus reconciles stale meta, excludes provisional videos from mature catalog stats, deduplicates transitions, and surfaces provisional header count", () => {
  const catalog = makeCatalog([
    {
      id: "prov1",
      title: "Young 1",
      url: "https://www.youtube.com/shorts/prov1",
      playlistIndex: 0,
      views: 1_000_000,
      likes: 10_000,
      durationSec: 30,
      uploadDate: "20261120",
      wordCount: 90,
      wpm: 180,
    },
    {
      id: "w1",
      title: "Winner 1",
      url: "https://www.youtube.com/shorts/w1",
      playlistIndex: 35,
      views: 40_000_000,
      likes: 2_000_000,
      durationSec: 40,
      uploadDate: "20260701",
      wordCount: 100,
      wpm: 150,
    },
    {
      id: "w2",
      title: "Winner 2",
      url: "https://www.youtube.com/shorts/w2",
      playlistIndex: 34,
      views: 35_000_000,
      likes: 1_750_000,
      durationSec: 40,
      uploadDate: "20260702",
      wordCount: null,
      wpm: null,
    },
    {
      id: "mid1",
      title: "Mid 1",
      url: "https://www.youtube.com/shorts/mid1",
      playlistIndex: 33,
      views: 10_000_000,
      likes: 400_000,
      durationSec: 40,
      uploadDate: "20260703",
      wordCount: 110,
      wpm: 165,
    },
    {
      id: "f1",
      title: "Flop 1",
      url: "https://www.youtube.com/shorts/f1",
      playlistIndex: 32,
      views: 3_000_000,
      likes: 90_000,
      durationSec: 40,
      uploadDate: "20260704",
      wordCount: 120,
      wpm: 180,
    },
    {
      id: "f2",
      title: "Flop 2",
      url: "https://www.youtube.com/shorts/f2",
      playlistIndex: 31,
      views: 2_500_000,
      likes: 75_000,
      durationSec: 40,
      uploadDate: "20260705",
      wordCount: 124,
      wpm: 186,
    },
  ]);

  const staleW1 = makeRecord(
    "w1",
    "flop",
    0.1,
    makeSampleTelemetry({
      transition_types: ["Card-Flip", "card_flip"],
      story_beats: [
        { role: "hook", start_sec: 0, end_sec: 4, pct_runtime: 10 },
        { role: "explanation_value", start_sec: 4, end_sec: 16, pct_runtime: 30 },
        { role: "explanation_value", start_sec: 16, end_sec: 40, pct_runtime: 60 },
      ],
    }),
    999,
  );
  const recF2 = makeRecord(
    "f2",
    "flop",
    0.25,
    makeSampleTelemetry({
      boundary_counts: { hard_cut: 1, hidden_cut: 1, transition: 0, continuous: 2 },
      transition_types: ["stale_wipe"],
      twist_at_pct: null,
    }),
    186,
  );
  const recProv = makeRecord("prov1", "provisional", 1.0, makeSampleTelemetry(), 180);

  const stats = aggregateCorpus(catalog, [staleW1, recF2, recProv]);
  expect(stats.catalogTelemetry.matureCount).toBe(5);
  expect(stats.catalogTelemetry.matureTranscriptCount).toBe(4);
  expect(stats.catalogTelemetry.transcriptCount).toBe(5);
  expect(stats.deepDna.tierCounts.winner).toBe(1);
  expect(stats.deepDna.tierCounts.provisional).toBe(1);
  expect(stats.deepDna.pacingAndTiming.winner.medianWpm).toBe(150);
  expect(stats.deepDna.boundaries.transitionTypes).toHaveLength(1);
  expect(stats.deepDna.boundaries.transitionTypes[0]!.type).toBe("card_flip");
  expect(stats.deepDna.boundaries.transitionTypes[0]!.videos).toBe(2);
  expect(stats.deepDna.boundaries.transitionTypes.some((t) => t.type === "stale_wipe")).toBe(false);

  const md = renderStatsSummaryMd(stats);
  expect(md).toContain("4 mature / 5 total");
  expect(md).toContain("1 Provisional");
  expect(md).not.toMatch(/\*\*|`/);
});

test("runAggregate reads corpus videos from disk, reconciles with catalog, and writes stats files atomically", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-agg-test-"));
  try {
    const catalog = makeCatalog([
      {
        id: "w1",
        title: "Winner 1",
        url: "https://www.youtube.com/shorts/w1",
        playlistIndex: 35,
        views: 30_000_000,
        likes: 1_500_000,
        durationSec: 40,
        uploadDate: "20260701",
        wordCount: 100,
        wpm: 150,
      },
      {
        id: "m1",
        title: "Mid 1",
        url: "https://www.youtube.com/shorts/m1",
        playlistIndex: 34,
        views: 10_000_000,
        likes: 400_000,
        durationSec: 40,
        uploadDate: "20260702",
      },
      {
        id: "f1",
        title: "Flop 1",
        url: "https://www.youtube.com/shorts/f1",
        playlistIndex: 33,
        views: 2_000_000,
        likes: 60_000,
        durationSec: 40,
        uploadDate: "20260703",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), catalog);
    const vDir = join(tmp, "videos", "w1");
    mkdirSync(vDir, { recursive: true });
    const rec = makeRecord("w1", "median", 1.0, makeSampleTelemetry(), null);
    writeJsonAtomic(join(vDir, "meta.json"), rec.meta);
    writeJsonAtomic(join(vDir, "telemetry.json"), rec.telemetry);

    const stats = runAggregate(tmp);
    expect(stats.deepDna.tierCounts.winner).toBe(1);
    expect(stats.deepDna.pacingAndTiming.winner.medianWpm).toBe(150);
    expect(existsSync(join(tmp, "stats.json"))).toBe(true);
    expect(readFileSync(join(tmp, "stats-summary.md"), "utf8")).toContain("150 (1)");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("burnTimecode720 scales to 720p short-edge, burns timecode bar, re-encodes AAC stereo, and leaves zero temp files", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-burn-test-"));
  try {
    const src = join(tmp, "src.mp4");
    const out = join(tmp, "out_tc.mp4");
    const gen = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=1080x1920:r=30:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100:duration=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        src,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    );
    expect(gen.status, gen.stderr).toBe(0);

    const audioRes = await burnTimecode720(src, out);
    expect(audioRes.hasAudioStream).toBe(true);
    expect(audioRes.durationSec).toBeCloseTo(1, 1);
    expect(audioRes.sourceFps).toBeCloseTo(30, 1);
    expect(audioRes.audioMetrics).not.toBeNull();
    expect(Number.isFinite(audioRes.audioMetrics?.integratedLufs)).toBe(true);
    expect(Number.isFinite(audioRes.audioMetrics?.truePeakDbtp)).toBe(true);
    expect(existsSync(out)).toBe(true);
    expect(readdirSync(tmp).filter((f) => f.includes(".tmp."))).toEqual([]);

    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name,width,height,sample_rate,channels",
        "-of",
        "json",
        out,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    );
    expect(probe.status).toBe(0);
    const info = JSON.parse(probe.stdout) as {
      streams: Array<{
        codec_type: string;
        codec_name: string;
        width?: number;
        height?: number;
        sample_rate?: string;
        channels?: number;
      }>;
    };
    const v = info.streams.find((s) => s.codec_type === "video")!;
    const a = info.streams.find((s) => s.codec_type === "audio")!;
    expect(v.width).toBe(720);
    expect(v.height).toBeGreaterThan(1280);
    expect(a.codec_name).toBe("aac");
    expect(a.sample_rate).toBe("44100");
    expect(a.channels).toBe(2);

    const silentSrc = join(tmp, "silent.mp4");
    const silentOut = join(tmp, "silent_tc.mp4");
    const genSilent = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=720x1280:r=30:d=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        silentSrc,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    );
    expect(genSilent.status, genSilent.stderr).toBe(0);
    const silentRes = await burnTimecode720(silentSrc, silentOut);
    expect(silentRes.hasAudioStream).toBe(false);
    expect(silentRes.audioMetrics).toBeNull();
    expect(silentRes.durationSec).toBeCloseTo(1, 1);
    expect(existsSync(silentOut)).toBe(true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);

test("cli rejects bad flags, empty --ids, missing --system-file, bad --url, and directory validate with exit 2", async () => {
  const help = spawnSync("bun", [CLI_PATH, "--help"], { encoding: "utf8" });
  expect(help.status).toBe(0);
  expect(help.stdout).toContain("--system-file");
  expect(help.stdout).toContain("--lang");
  expect(help.stdout).toContain("--min-schema");
  expect(help.stdout).toContain("--cookies");

  const tmp = mkdtempSync(join(tmpdir(), "cdna-cli-bad-"));
  try {
    const cases: string[][] = [
      ["bogus"],
      ["collect", "--typo"],
      ["collect", "--channel", "demo", "--url", "--exec=evil"],
      ["collect", "--channel", "demo", "--url", "https://youtube.com/@demo", "--lang", ""],
      ["collect", "--channel", "demo", "--url", "https://youtube.com/@demo", "--lang", " , "],
      [
        "collect",
        "--channel",
        "demo",
        "--url",
        "https://youtube.com/@demo",
        "--cookies",
        join(tmp, "no.txt"),
      ],
      [
        "collect",
        "--channel",
        "demo",
        "--url",
        "https://youtube.com/@demo",
        "--cookies-from-browser",
        "  ",
      ],
      ["mine", "--channel", "demo", "--ids", "../escape"],
      ["mine", "--channel", "demo", "--ids", ""],
      ["mine", "--channel", "demo", "--ids", " , "],
      ["mine", "--channel", "demo", "--system-file", join(tmp, "missing.md")],
      ["mine", "--channel", "demo", "--min-schema", "4"],
      ["mine", "--channel", "demo", "--cookies", join(tmp, "no.txt")],
      ["mine", "--channel", "demo", "--cookies-from-browser", ""],
      ["status", "--channel", "Bad Name"],
      ["validate", tmp],
    ];
    const results = await Promise.all(
      cases.map(async (args) => {
        const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
          stdout: "ignore",
          stderr: "ignore",
        });
        return { args, status: await proc.exited };
      }),
    );
    for (const r of results) {
      expect(r.status, r.args.join(" ")).toBe(2);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 25_000);

test("cli validate, status, and aggregate succeed on valid corpus artifacts", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-cli-ok-"));
  try {
    const good = join(tmp, "good.md");
    const bad = join(tmp, "bad.md");
    writeFileSync(good, makeSampleDossier(makeSampleTelemetry()), "utf8");
    writeFileSync(bad, "### 1. Incomplete", "utf8");
    expect(spawnSync("bun", [CLI_PATH, "validate", good], { encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("bun", [CLI_PATH, "validate", bad], { encoding: "utf8" }).status).toBe(1);

    const statusEmpty = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "demo-ch", "--corpus", tmp],
      { encoding: "utf8" },
    );
    expect(statusEmpty.status).toBe(0);
    expect(statusEmpty.stdout).toContain("no catalog yet");

    writeJsonAtomic(
      join(tmp, "catalog.json"),
      makeCatalog([
        {
          id: "x1",
          title: "X1",
          url: "https://www.youtube.com/shorts/x1",
          playlistIndex: 35,
          views: 10_000_000,
          likes: 300_000,
          durationSec: 30,
          uploadDate: "20260701",
        },
      ]),
    );
    expect(
      spawnSync("bun", [CLI_PATH, "status", "--channel", "demo-ch", "--corpus", tmp], {
        encoding: "utf8",
      }).stdout,
    ).toContain("catalog=1");
    expect(
      spawnSync("bun", [CLI_PATH, "aggregate", "--channel", "demo-ch", "--corpus", tmp], {
        encoding: "utf8",
      }).stdout,
    ).toContain("aggregated demo-ch");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);

test("parseAndValidateDossier flags total boundary_counts sum mismatch and empty transition_types when transitions > 0", () => {
  const sumErr = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        boundary_counts: { hard_cut: 1, hidden_cut: 2, transition: 1, continuous: 2 },
      }),
    ),
  );
  expect(sumErr.valid).toBe(false);
  expect(sumErr.errors.some((e) => e.includes("boundary_counts sum"))).toBe(true);

  const missingTypes = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleTelemetry({
        boundary_counts: { hard_cut: 0, hidden_cut: 1, transition: 1, continuous: 2 },
        transition_types: [],
      }),
    ),
  );
  expect(missingTypes.valid).toBe(true);
  expect(missingTypes.warnings.some((w) => w.includes("transition_types is empty"))).toBe(true);
});

test("inferMaturityBounds ignores pinned old idx=0 when maxYoungIdx is null and keeps unenriched offFeed carry-overs provisional", () => {
  const pinnedNoYoung: RawCatalogVideo[] = Array.from({ length: 20 }, (_, i) => ({
    id: `pn${i}`,
    title: `PN${i}`,
    url: `https://www.youtube.com/shorts/pn${i}`,
    playlistIndex: i,
    views: 5_000_000,
    likes: null,
    durationSec: i === 0 || i === 15 ? 35 : null,
    uploadDate: i === 0 ? "20250101" : i === 15 ? "20260901" : null,
  }));
  expect(inferMaturityBounds(pinnedNoYoung, "2026-11-23")).toEqual({
    maxYoungIdx: null,
    minMatureIdx: 15,
  });

  const bounds = { maxYoungIdx: 5, minMatureIdx: 6 };
  expect(
    isVideoMature({ playlistIndex: 50, uploadDate: null, offFeed: true }, "2026-11-23", bounds),
  ).toEqual({ ageDays: null, isMature: false });

  const withUnenrichedOffFeed: RawCatalogVideo[] = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `live${i}`,
      title: `Live${i}`,
      url: `https://www.youtube.com/shorts/live${i}`,
      playlistIndex: i,
      views: 10_000_000,
      likes: null,
      durationSec: 35,
      uploadDate: i < 5 ? "20261115" : "20260801",
    })),
    {
      id: "offGhost",
      title: "Ghost",
      url: "https://www.youtube.com/shorts/offGhost",
      playlistIndex: 10,
      views: 500_000,
      likes: null,
      durationSec: null,
      uploadDate: null,
      offFeed: true,
    },
  ];
  const scored = computeOutlierScores(withUnenrichedOffFeed, "2026-11-23");
  const ghost = scored.videos.find((v) => v.id === "offGhost")!;
  expect(ghost.isMature).toBe(false);
  expect(ghost.tier).toBe("provisional");
});

test("computeOutlierScores avoids self-discount inflation on solo young video and all-young channels", () => {
  const soloYoung = computeOutlierScores(
    [
      {
        id: "sy1",
        title: "Solo Young",
        url: "https://www.youtube.com/shorts/sy1",
        playlistIndex: 0,
        views: 1_000_000,
        likes: null,
        durationSec: 30,
        uploadDate: "20261122",
      },
    ],
    "2026-11-23",
  );
  expect(soloYoung.matureCount).toBe(0);
  expect(soloYoung.videos[0]!.outlierRolling).toBe(1);
  expect(soloYoung.videos[0]!.outlierGlobal).toBe(1);

  const allYoung: RawCatalogVideo[] = Array.from({ length: 10 }, (_, i) => ({
    id: `ay${i}`,
    title: `AY${i}`,
    url: `https://www.youtube.com/shorts/ay${i}`,
    playlistIndex: i,
    views: i === 0 ? 5_000_000 : i === 9 ? 200_000 : 1_000_000,
    likes: null,
    durationSec: 30,
    uploadDate: "20261122",
  }));
  const scoredYoung = computeOutlierScores(allYoung, "2026-11-23");
  const byId = new Map(scoredYoung.videos.map((v) => [v.id, v]));
  expect(byId.get("ay0")!.outlierGlobal).toBe(5);
  expect(byId.get("ay5")!.outlierGlobal).toBe(1);
  expect(byId.get("ay9")!.outlierGlobal).toBe(0.2);
});

test("mergeCatalogEntry preserves prior views when incoming view_count is lower or missing", () => {
  const prev: RawCatalogVideo = {
    id: "v1",
    title: "Existing",
    url: "https://www.youtube.com/shorts/v1",
    playlistIndex: 2,
    views: 12_000_000,
    likes: 400_000,
    durationSec: 35,
    uploadDate: "20260901",
  };
  expect(mergeCatalogEntry(prev, { id: "v1", view_count: 8_000_000 }, prev.url, 3).views).toBe(
    12_000_000,
  );
  expect(mergeCatalogEntry(prev, { id: "v1" }, prev.url, 3).views).toBe(12_000_000);
});

test("selectEnrichmentTargets prioritizes newly matured items and excludes enrichedMature, young, and offFeed videos", () => {
  const pool: RawCatalogVideo[] = [
    {
      id: "alreadyMature",
      title: "Already Mature",
      url: "https://www.youtube.com/shorts/alreadyMature",
      playlistIndex: 10,
      views: 10_000_000,
      likes: 100_000,
      durationSec: 35,
      uploadDate: "20260801",
      enrichedMature: true,
    },
    {
      id: "stillYoung",
      title: "Still Young",
      url: "https://www.youtube.com/shorts/stillYoung",
      playlistIndex: 1,
      views: 5_000_000,
      likes: 50_000,
      durationSec: 35,
      uploadDate: "20261118",
      enrichedMature: false,
    },
    {
      id: "offFeedMatured",
      title: "Off Feed",
      url: "https://www.youtube.com/shorts/offFeedMatured",
      playlistIndex: 20,
      views: 2_000_000,
      likes: 20_000,
      durationSec: 35,
      uploadDate: "20261010",
      enrichedMature: false,
      offFeed: true,
    },
    {
      id: "newlyMatured",
      title: "Newly Matured",
      url: "https://www.youtube.com/shorts/newlyMatured",
      playlistIndex: 12,
      views: 8_000_000,
      likes: 80_000,
      durationSec: 35,
      uploadDate: "20261015",
      enrichedMature: false,
    },
    {
      id: "unenrichedLive",
      title: "Unenriched",
      url: "https://www.youtube.com/shorts/unenrichedLive",
      playlistIndex: 15,
      views: 9_000_000,
      likes: null,
      durationSec: null,
      uploadDate: null,
    },
    {
      id: "unenrichedOff",
      title: "Unenriched Off",
      url: "https://www.youtube.com/shorts/unenrichedOff",
      playlistIndex: 25,
      views: 9_000_000,
      likes: null,
      durationSec: null,
      uploadDate: null,
      offFeed: true,
    },
  ];
  const picks = selectEnrichmentTargets(pool, 10, "2026-11-23").map((v) => v.id);
  expect(picks).toEqual(["newlyMatured", "unenrichedLive"]);

  const txPicks = selectTranscriptTargets(pool, 10, "2026-11-23").map((v) => v.id);
  expect(txPicks).not.toContain("offFeedMatured");
  expect(txPicks).not.toContain("unenrichedOff");
});

test("isQuotaError rejects bare 429 numbers, selectMineTargets deduplicates queue.json, and quota halt creates no empty video dirs", async () => {
  expect(isQuotaError("video_429 failed parse")).toBe(false);
  expect(isQuotaError("timecode 00:04.429 mismatch")).toBe(false);
  expect(isQuotaError("status: 429")).toBe(true);

  const tmp = mkdtempSync(join(tmpdir(), "cdna-dedup-q-"));
  try {
    const catalog = makeCatalog([
      {
        id: "q1",
        title: "Q1",
        url: "https://www.youtube.com/shorts/q1",
        playlistIndex: 10,
        views: 10_000_000,
        likes: 100_000,
        durationSec: 35,
        uploadDate: "20260801",
      },
      {
        id: "q2",
        title: "Q2",
        url: "https://www.youtube.com/shorts/q2",
        playlistIndex: 9,
        views: 5_000_000,
        likes: 50_000,
        durationSec: 35,
        uploadDate: "20260802",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), catalog);
    writeJsonAtomic(join(tmp, "queue.json"), { queue: ["q1", "q1", "q2", "q2"] });
    const ck = loadCheckpoint(tmp, "demo-ch");
    expect(selectMineTargets(catalog, ck, tmp, { limit: 10 })).toEqual(["q1", "q2"]);

    const res = await runMine({
      channel: "demo-ch",
      corpusDir: tmp,
      limit: 2,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      runVideo: async () => ({ ok: false, error: "HTTP 429 rate limit" }),
    });
    expect(res.quotaHalted).toBe(true);
    expect(existsSync(join(tmp, "videos", "q1"))).toBe(false);
    expect(existsSync(join(tmp, "videos", "q2"))).toBe(false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("aggregateCorpus computes beatBudgets, crossTabs, likes fallback, matureEnrichedCount, and omits -% on null twist", () => {
  const catalog = makeCatalog([
    {
      id: "w1",
      title: "W1",
      url: "https://www.youtube.com/shorts/w1",
      playlistIndex: 35,
      views: 30_000_000,
      likes: null,
      durationSec: 40,
      uploadDate: "20260701",
      wordCount: 100,
      wpm: 150,
    },
    {
      id: "m1",
      title: "M1",
      url: "https://www.youtube.com/shorts/m1",
      playlistIndex: 34,
      views: 10_000_000,
      likes: 400_000,
      durationSec: 40,
      uploadDate: "20260702",
    },
    {
      id: "f1",
      title: "F1",
      url: "https://www.youtube.com/shorts/f1",
      playlistIndex: 33,
      views: 2_000_000,
      likes: 60_000,
      durationSec: 40,
      uploadDate: "20260703",
    },
    {
      id: "y1",
      title: "Y1",
      url: "https://www.youtube.com/shorts/y1",
      playlistIndex: 0,
      views: 1_000_000,
      likes: 20_000,
      durationSec: 30,
      uploadDate: "20261121",
    },
  ]);

  const r1 = makeRecord(
    "w1",
    "winner",
    3.0,
    makeSampleTelemetry({
      topic_category: "explainer_how_it_works",
      hook_archetype: "shock_fact_stat",
      story_structure: "mechanism_step_by_step",
      ending_type: "ironic_twist_punchline",
      twist_at_pct: null,
      story_beats: [
        { role: "hook", start_sec: 0, end_sec: 4, pct_runtime: 10 },
        { role: "explanation_value", start_sec: 4, end_sec: 16, pct_runtime: 30 },
        { role: "explanation_value", start_sec: 16, end_sec: 40, pct_runtime: 60 },
      ],
    }),
  );
  const r2 = makeRecord(
    "m1",
    "median",
    1.0,
    makeSampleTelemetry({
      topic_category: "explainer_how_it_works",
      hook_archetype: "mystery_question",
      story_structure: "chronological_escalation_twist",
      ending_type: "question_cta",
      twist_at_pct: null,
      story_beats: [
        { role: "hook", start_sec: 0, end_sec: 4, pct_runtime: 10 },
        { role: "explanation_value", start_sec: 4, end_sec: 24, pct_runtime: 50 },
        { role: "resolution", start_sec: 24, end_sec: 40, pct_runtime: 40 },
      ],
    }),
  );
  const r3 = makeRecord(
    "f1",
    "flop",
    0.2,
    makeSampleTelemetry({
      topic_category: "animals_nature_survival",
      hook_archetype: "shock_fact_stat",
      story_structure: "mechanism_step_by_step",
      ending_type: "abrupt_fact_or_snap",
      twist_at_pct: null,
    }),
  );

  expect(reconcileWithCatalog(catalog, [r1])[0]!.meta.likes).toBe(100_000);
  const stats = aggregateCorpus(catalog, [r1, r2, r3]);
  expect(stats.catalogTelemetry.matureEnrichedCount).toBe(3);
  expect(stats.catalogTelemetry.enrichedCount).toBe(4);

  const expBudget = stats.deepDna.beatBudgets.find((b) => b.role === "explanation_value")!;
  expect(expBudget.presentInVideos).toBe(3);
  expect(expBudget.medianPctWhenPresent).toBe(50);

  const explHooks = stats.deepDna.crossTabs.hookByTopic.explainer_how_it_works!;
  expect(explHooks.n).toBe(2);
  expect(explHooks.breakdown[0]!.key).toBe("shock_fact_stat");
  expect(explHooks.breakdown[0]!.pct).toBe(50);
  expect(stats.deepDna.crossTabs.storyByTopic.animals_nature_survival!.n).toBe(1);
  expect(stats.deepDna.crossTabs.endingByTopic.explainer_how_it_works!.breakdown).toHaveLength(2);

  const md = renderStatsSummaryMd(stats);
  expect(md).toContain("3 mature / 4 total enriched metadata");
  expect(md).not.toContain("-%");
});

test("cli rejects blank, whitespace, scientific, and hex integer flags with exit 2", () => {
  for (const args of [
    [
      "collect",
      "--channel",
      "demo",
      "--url",
      "https://www.youtube.com/@demo/shorts",
      "--enrich",
      "",
    ],
    [
      "collect",
      "--channel",
      "demo",
      "--url",
      "https://www.youtube.com/@demo/shorts",
      "--transcripts",
      "   ",
    ],
    ["mine", "--channel", "demo", "--limit", "1e1"],
    ["mine", "--channel", "demo", "--fps", "0x10"],
  ]) {
    const r = spawnSync("bun", [CLI_PATH, ...args], { encoding: "utf8" });
    expect(r.status, args.join(" ")).toBe(2);
  }
}, 20_000);

function makeSampleV2Telemetry(overrides: Partial<VideoTelemetry> = {}): VideoTelemetry {
  return {
    ...makeSampleTelemetry(),
    schema_version: 2,
    visual_medium: "3d_stylized_cgi",
    protagonist_format: "third_person_characters",
    narration_pov: "second_person_you",
    voice_delivery: "calm_matter_of_fact",
    caption_style: "word_by_word_kinetic",
    emotional_driver: "curiosity_mystery",
    bgm_mood: "tense_pulse_synth",
    sfx_density: "moderate_punctuated",
    shadow_quality: "soft_diffuse",
    color_palette_mood: "clean_bright_saturated",
    outro_hold_sec: 0.4,
    camera_moves_used: ["push_in", "orbit_arc", "whip_pan"],
    craft_signals: {
      ...makeSampleTelemetry().craft_signals,
      uses_camera_turn_blur: true,
      uses_translation_or_radial_blur: true,
      uses_object_motion_blur: false,
      uses_subject_tracking_blur: false,
      uses_rack_focus: true,
      has_particles_or_fluid: true,
      has_pip_or_split_screen: false,
      has_diegetic_channel_branding: true,
      has_sfx_whoosh_or_riser: true,
    },
    ...overrides,
  };
}

test("parseAndValidateDossier validates schema_version 2 fields, coherence warnings, negative outro_hold_sec, and locked_static", () => {
  const okV2 = parseAndValidateDossier(makeSampleDossier(makeSampleV2Telemetry()));
  expect(okV2.valid, okV2.errors.join("; ")).toBe(true);
  expect(okV2.warnings).toEqual([]);

  const badEnum = parseAndValidateDossier(
    makeSampleDossier(makeSampleV2Telemetry({ visual_medium: "invalid_medium" as never })),
  );
  expect(badEnum.valid).toBe(false);
  expect(badEnum.errors.some((e) => e.includes("invalid visual_medium"))).toBe(true);

  const badOutroHi = parseAndValidateDossier(
    makeSampleDossier(makeSampleV2Telemetry({ outro_hold_sec: 99 })),
  );
  expect(badOutroHi.valid).toBe(false);
  const badOutroNeg = parseAndValidateDossier(
    makeSampleDossier(makeSampleV2Telemetry({ outro_hold_sec: -0.5 })),
  );
  expect(badOutroNeg.valid).toBe(false);

  const missingV2Craft = makeSampleV2Telemetry();
  delete missingV2Craft.craft_signals.uses_subject_tracking_blur;
  const badCraft = parseAndValidateDossier(makeSampleDossier(missingV2Craft));
  expect(badCraft.valid).toBe(false);
  expect(badCraft.errors.some((e) => e.includes("uses_subject_tracking_blur"))).toBe(true);

  const emptyMovesWarn = parseAndValidateDossier(
    makeSampleDossier(makeSampleV2Telemetry({ camera_moves_used: [] })),
  );
  expect(emptyMovesWarn.valid).toBe(true);
  expect(emptyMovesWarn.warnings.some((w) => w.includes("camera_moves_used is empty"))).toBe(true);

  const lockedStaticOk = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({ camera_energy: "locked_static", camera_moves_used: [] }),
    ),
  );
  expect(lockedStaticOk.valid).toBe(true);
  expect(lockedStaticOk.warnings).toEqual([]);

  const blurIncoherent = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({
        craft_signals: {
          ...makeSampleV2Telemetry().craft_signals,
          uses_motion_blur: false,
          uses_camera_turn_blur: true,
        },
      }),
    ),
  );
  expect(blurIncoherent.valid).toBe(true);
  expect(blurIncoherent.warnings.some((w) => w.includes("uses_motion_blur is false"))).toBe(true);

  const silentIncoherent = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({
        audio_bed_style: "silent",
        bgm_mood: "tense_pulse_synth",
        sfx_density: "sparse_grounded",
      }),
    ),
  );
  expect(silentIncoherent.valid).toBe(true);
  expect(silentIncoherent.warnings.some((w) => w.includes("bgm_mood"))).toBe(true);
  expect(silentIncoherent.warnings.some((w) => w.includes("sfx_density"))).toBe(true);
});

test("executeAskAttempt prevents cross-video corruption across orphan drains and pre-run vs post-run failures", async () => {
  expect(extractChatUrl("open https://aistudio.google.com/prompts/new_chat")).toBeNull();
  expect(extractChatUrl("url: https://aistudio.google.com/prompts/1AbCdEfGhIjKlMnOp")).toBe(
    "https://aistudio.google.com/prompts/1AbCdEfGhIjKlMnOp",
  );
  expect(
    isTabBusyGenerating("✗ [4/15] open new chat: the tab is still generating in a saved chat"),
  ).toBe(true);
  expect(didSubmitCurrentVideo("→ [8/15] attach file failed")).toBe(false);
  expect(didSubmitCurrentVideo("✓ [11/15] run: 120ms\n→ [12/15] wait for answer")).toBe(true);

  const okRes = (stderr: string) => ({ status: 0, stdout: "", stderr, timedOut: false });
  const failRes = (stderr: string, timedOut = false) => ({
    status: 1,
    stdout: "",
    stderr,
    timedOut,
  });

  let runNewCount = 0;
  let drainCount = 0;
  let wroteOut = false;
  const stateSavedOrphan = {
    submittedOnTab: false,
    chatUrl: "https://aistudio.google.com/prompts/OLD_ORPHAN_URL_999" as string | null,
  };
  const r1 = await executeAskAttempt(stateSavedOrphan, {
    runNew: async () => {
      runNewCount++;
      if (runNewCount === 1) {
        return failRes(
          "✗ [4/15] open new chat: the tab is still generating in https://aistudio.google.com/prompts/OLD_ORPHAN_URL_999",
        );
      }
      wroteOut = true;
      return okRes("✓ [15/15] done https://aistudio.google.com/prompts/CURRENT_VIDEO_URL_123");
    },
    runCollect: async () => {
      throw new Error("should not collect on attempt 1");
    },
    drainOrphan: async () => {
      drainCount++;
      return okRes("drained https://aistudio.google.com/prompts/OLD_ORPHAN_URL_999");
    },
    hasOutput: () => wroteOut,
  });
  expect(r1.ok).toBe(true);
  expect(drainCount).toBe(1);
  expect(runNewCount).toBe(2);
  expect(stateSavedOrphan.submittedOnTab).toBe(false);
  expect(stateSavedOrphan.chatUrl).toBe(
    "https://aistudio.google.com/prompts/CURRENT_VIDEO_URL_123",
  );

  let collectCalled = false;
  const stateDrainFail = { submittedOnTab: false, chatUrl: null as string | null };
  const r2 = await executeAskAttempt(stateDrainFail, {
    runNew: async () =>
      failRes("✗ [4/15] open new chat: the tab is still generating in an unsaved chat"),
    runCollect: async () => {
      collectCalled = true;
      return okRes("");
    },
    drainOrphan: async () => failRes("wait for answer failed", true),
    hasOutput: () => false,
  });
  expect(r2.ok).toBe(false);
  expect(stateDrainFail.submittedOnTab).toBe(false);
  expect(stateDrainFail.chatUrl).toBeNull();
  expect(collectCalled).toBe(false);

  const statePreRun = { submittedOnTab: false, chatUrl: null as string | null };
  const r3 = await executeAskAttempt(statePreRun, {
    runNew: async () => failRes("→ [7/15] upload clip timed out", true),
    runCollect: async () => okRes(""),
    drainOrphan: async () => okRes(""),
    hasOutput: () => false,
  });
  expect(r3.ok).toBe(false);
  expect(statePreRun.submittedOnTab).toBe(false);

  let postRunOut = false;
  const statePostRun = { submittedOnTab: false, chatUrl: null as string | null };
  const r4a = await executeAskAttempt(statePostRun, {
    runNew: async () => failRes("✓ [11/15] run: 90ms\n→ [12/15] wait for answer", true),
    runCollect: async () => okRes(""),
    drainOrphan: async () => okRes(""),
    hasOutput: () => postRunOut,
  });
  expect(r4a.ok).toBe(false);
  expect(statePostRun.submittedOnTab).toBe(true);
  const r4b = await executeAskAttempt(statePostRun, {
    runNew: async () => {
      throw new Error("attempt 2 must collect in-flight answer, not call runNew");
    },
    runCollect: async () => {
      postRunOut = true;
      return okRes("✓ saved https://aistudio.google.com/prompts/RECOVERED_URL_777");
    },
    drainOrphan: async () => okRes(""),
    hasOutput: () => postRunOut,
  });
  expect(r4b.ok).toBe(true);
  expect(statePostRun.submittedOnTab).toBe(false);
  expect(statePostRun.chatUrl).toBe("https://aistudio.google.com/prompts/RECOVERED_URL_777");
});

test("runMine rejects v1 under --min-schema 2, upgrades on retry, and halts cleanly on bot-gate or signed-out", async () => {
  expect(isBotOrRateBlock("ERROR: [youtube] id: Sign in to confirm you're not a bot.")).toBe(true);
  expect(isBotOrRateBlock("HTTP Error 403: Forbidden")).toBe(true);
  expect(isBotOrRateBlock("AI Studio says: signed out, please log in")).toBe(true);
  expect(classifyHaltReason("HTTP 429 rate limit")).toBe("quota");
  expect(classifyHaltReason("signed out")).toBe("bot_or_auth");
  expect(classifyHaltReason("transient parse error")).toBe("none");
  expect(shouldHaltBatch("transient parse error")).toBe(false);

  const tmp = mkdtempSync(join(tmpdir(), "cdna-v2-upgrade-"));
  try {
    const catalog = makeCatalog([
      {
        id: "old1",
        title: "Old V1 Video 😱",
        url: "https://www.youtube.com/shorts/old1",
        playlistIndex: 10,
        views: 40_000_000,
        likes: 1_000_000,
        durationSec: 40,
        uploadDate: "20260701",
      },
      {
        id: "new2",
        title: "Already V2 Video 🤯",
        url: "https://www.youtube.com/shorts/new2",
        playlistIndex: 11,
        views: 30_000_000,
        likes: 800_000,
        durationSec: 40,
        uploadDate: "20260702",
      },
      {
        id: "bot3",
        title: "Pending Video 🤔",
        url: "https://www.youtube.com/shorts/bot3",
        playlistIndex: 12,
        views: 4_000_000,
        likes: 100_000,
        durationSec: 30,
        uploadDate: "20260703",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), catalog);
    writeJsonAtomic(join(tmp, "videos", "old1", "telemetry.json"), makeSampleTelemetry());
    writeJsonAtomic(join(tmp, "videos", "new2", "telemetry.json"), makeSampleV2Telemetry());
    const ck = loadCheckpoint(tmp, "demo-ch");
    ck.entries.old1 = {
      status: "done",
      updatedAt: "2026-11-22T00:00:00Z",
      chatUrl: null,
      attempts: 1,
    };
    ck.entries.new2 = {
      status: "done",
      updatedAt: "2026-11-23T00:00:00Z",
      chatUrl: null,
      attempts: 1,
    };
    saveCheckpoint(tmp, ck, catalog);

    expect(selectMineTargets(catalog, ck, tmp, { limit: 10, minSchema: 2 })).toEqual([
      "old1",
      "bot3",
    ]);

    let old1Attempts = 0;
    const res = await runMine({
      channel: "demo-ch",
      corpusDir: tmp,
      limit: 2,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      minSchema: 2,
      runVideo: async (vid, _tab, attempt) => {
        if (vid.id === "old1") {
          old1Attempts = attempt;
          return attempt === 1
            ? { ok: true, markdown: makeSampleDossier(makeSampleTelemetry()) }
            : { ok: true, markdown: makeSampleDossier(makeSampleV2Telemetry()) };
        }
        return { ok: false, error: "AI Studio browser is signed out" };
      },
    });
    expect(old1Attempts).toBe(2);
    expect(res.done).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.quotaHalted).toBe(true);
    expect(res.haltReason).toBe("bot_or_auth");
    const ckAfter = loadCheckpoint(tmp, "demo-ch");
    expect(ckAfter.entries.bot3).toBeUndefined();
    const upgradedTel = JSON.parse(
      readFileSync(join(tmp, "videos", "old1", "telemetry.json"), "utf8"),
    ) as VideoTelemetry;
    expect(upgradedTel.schema_version).toBe(2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("catalog packaging & linguistics guard emoji modifiers, opener fallback, decimals, unpunctuated ASR, and non-English pronouns", () => {
  expect(extractTrailingEmoji("Why Bridges Shake 😱")).toBe("😱");
  expect(extractTrailingEmoji("Great 👍🏽")).toBe("👍🏽");
  expect(extractTrailingEmoji("No Emoji Title")).toBe("NONE");
  expect(countTitleWords("Great 👍🏽")).toBe(1);
  expect(classifyTitleOpener("How To Fix A Lock 🤔")).toBe("How To ...");
  expect(classifyTitleOpener("Could A Magnet Move Mars? 🤯")).toBe("Can/Could/Would ...");
  expect(classifyOpeningSentence("If your eyes blink too fast, muscles tire.")).toBe(
    "hypothetical_if_you",
  );
  expect(classifyOpeningSentence("Never touch this lever.")).toBe("warning_prohibition");
  expect(classifyOpeningSentence("I tried sleeping on nails.")).toBe("first_person_i_we");
  expect(classifyOpeningSentence("Did you know sharks never sleep?")).toBe("cliche_did_you_know");

  expect(splitPunctuatedSentences("Dr. Smith spent 3.5 million dollars. It worked!")).toEqual([
    "Dr. Smith spent 3.5 million dollars.",
    "It worked!",
  ]);

  const asrOnlyCatalog = makeCatalog([
    {
      id: "asrOnly",
      title: "Unpunctuated Auto ASR Title",
      url: "https://www.youtube.com/shorts/asrOnly",
      playlistIndex: 35,
      views: 10_000_000,
      likes: 200_000,
      durationSec: 40,
      uploadDate: "20260702",
      transcriptText:
        "this is an unpunctuated youtube automatic speech recognition transcript that runs on and on without any sentence ending marks at all so we should not count it as one forty word sentence",
      wordCount: 31,
      wpm: 150,
      openingTranscriptLine: null,
    },
  ]);
  const asrStats = aggregateCorpus(asrOnlyCatalog, []);
  expect(asrStats.catalogTelemetry.linguistics.sampleN).toBe(1);
  expect(asrStats.catalogTelemetry.linguistics.punctuatedSampleN).toBe(0);
  expect(asrStats.catalogTelemetry.linguistics.medianWordsPerSentence).toBeNull();

  const catalog = makeCatalog([
    {
      id: "en1",
      title: "Could A Bridge Fall? 😱",
      url: "https://www.youtube.com/shorts/en1",
      playlistIndex: 35,
      views: 50_000_000,
      likes: 1_500_000,
      durationSec: 40,
      uploadDate: "20260701",
      transcriptText: "If your bridge bends 3.5 meters, stop! Why does steel snap?",
      wordCount: 100,
      wpm: 150,
      openingTranscriptLine: null,
    },
    {
      id: "asr1",
      title: "Unpunctuated Auto ASR Title",
      url: "https://www.youtube.com/shorts/asr1",
      playlistIndex: 34,
      views: 10_000_000,
      likes: 200_000,
      durationSec: 60,
      uploadDate: "20260702",
      transcriptText:
        "when the water hits the hot pan it turns into vapor right away and floats across the surface without touching metal",
      wordCount: 22,
      wpm: 150,
      openingTranscriptLine: null,
    },
    {
      id: "vi1",
      title: "Khong Co Dai Tu Tieng Anh",
      url: "https://www.youtube.com/shorts/vi1",
      playlistIndex: 33,
      views: 2_000_000,
      likes: 50_000,
      durationSec: 22,
      uploadDate: "20260703",
      transcriptText: "Mot cau tieng Viet ngan gon. Hai cau tiep theo.",
      wordCount: 10,
      wpm: 205,
      openingTranscriptLine: null,
    },
  ]);

  const stats = aggregateCorpus(catalog, []);
  expect(stats.catalogTelemetry.packaging.durationSampleN).toBe(3);
  expect(stats.catalogTelemetry.packaging.durationBaseWinnerPct).toBe(33.3);
  expect(stats.catalogTelemetry.packaging.durationBands.some((b) => b.band === "55-64s")).toBe(
    true,
  );
  expect(stats.catalogTelemetry.packaging.wpmBands.some((b) => b.band === "200+")).toBe(true);
  expect(stats.catalogTelemetry.linguistics.sampleN).toBe(3);
  expect(stats.catalogTelemetry.linguistics.punctuatedSampleN).toBe(2);
  expect(
    stats.catalogTelemetry.linguistics.openingSentencePatterns.find(
      (b) => b.band === "hypothetical_if_you",
    )?.n,
  ).toBe(1);
  expect(
    stats.catalogTelemetry.linguistics.openingSentencePatterns.find((b) => b.band === "question"),
  ).toBeUndefined();

  const nonEnCatalog = makeCatalog([
    {
      id: "viOnly",
      title: "Tieng Viet",
      url: "https://www.youtube.com/shorts/viOnly",
      playlistIndex: 35,
      views: 10_000_000,
      likes: 100_000,
      durationSec: 30,
      uploadDate: "20260701",
      transcriptText: "Mot cau tieng Viet ngan gon. Hai cau tiep theo.",
      wordCount: 10,
      wpm: 150,
      openingTranscriptLine: null,
    },
  ]);
  expect(
    aggregateCorpus(nonEnCatalog, []).catalogTelemetry.linguistics.pronounProfilePct,
  ).toBeNull();
});

test("aggregateCorpus guards v2 audio distributions, normalizes aliases, splits boundaries by tier, and formats Win Rate vs Winner Share", () => {
  const catalog = makeCatalog([
    {
      id: "w1",
      title: "Bridge Secret 😱",
      url: "https://www.youtube.com/shorts/w1",
      playlistIndex: 35,
      views: 50_000_000,
      likes: 1_500_000,
      durationSec: 40,
      uploadDate: "20260701",
      transcriptText: "If you cross this bridge, it shakes. It bends fast.",
      wordCount: 100,
      wpm: 150,
      openingTranscriptLine: "If you cross this bridge, it shakes.",
    },
    {
      id: "w2",
      title: "Silent Winner 🤨",
      url: "https://www.youtube.com/shorts/w2",
      playlistIndex: 34,
      views: 45_000_000,
      likes: 1_200_000,
      durationSec: 60,
      uploadDate: "20260702",
    },
    {
      id: "f1",
      title: "Slow Flop",
      url: "https://www.youtube.com/shorts/f1",
      playlistIndex: 33,
      views: 1_500_000,
      likes: 40_000,
      durationSec: 20,
      uploadDate: "20260705",
    },
  ]);

  const recW1 = makeRecord(
    "w1",
    "winner",
    5.0,
    makeSampleV2Telemetry({
      transition_types: ["vertical_push"],
      camera_moves_used: ["dolly_in", "whip_pan"],
    }),
    150,
  );
  const recW2NoAudio = makeRecord(
    "w2",
    "winner",
    4.5,
    makeSampleV2Telemetry({
      audio_bed_style: "vo_only_dry",
      voice_delivery: "energetic_hype",
      bgm_mood: "upbeat_electronic_pop",
      sfx_density: "dense_kinetic_whoosh_pop",
      craft_signals: {
        ...makeSampleV2Telemetry().craft_signals,
        has_sfx_whoosh_or_riser: true,
        has_jl_cut: true,
      },
    }),
    150,
  );
  recW2NoAudio.meta.hasAudioStream = false;
  const recF1 = makeRecord(
    "f1",
    "flop",
    0.2,
    makeSampleV2Telemetry({
      outro_hold_sec: 3.0,
      story_structure: "chronological_escalation_twist",
      transition_types: ["card_flip"],
      camera_moves_used: ["static"],
      audio_bed_style: "shifting_bgm_plus_vo",
      boundary_counts: { hard_cut: 3, hidden_cut: 0, transition: 1, continuous: 0 },
      craft_signals: {
        ...makeSampleV2Telemetry().craft_signals,
        has_sfx_whoosh_or_riser: false,
        uses_rack_focus: false,
      },
    }),
    192,
  );

  const stats = aggregateCorpus(catalog, [recW1, recW2NoAudio, recF1]);
  expect(stats.deepDna.audioVerifiedCount).toBe(2);
  expect(stats.deepDna.v2DeepDna.v2Count).toBe(3);
  expect(stats.deepDna.v2DeepDna.v2AudioVerifiedCount).toBe(2);
  expect(stats.deepDna.distributions.audioBedStyle.some((b) => b.key === "vo_only_dry")).toBe(
    false,
  );
  expect(
    stats.deepDna.v2DeepDna.distributions.voiceDelivery.some((b) => b.key === "energetic_hype"),
  ).toBe(false);
  expect(
    stats.deepDna.v2DeepDna.distributions.bgmMood.some((b) => b.key === "upbeat_electronic_pop"),
  ).toBe(false);
  expect(
    stats.deepDna.v2DeepDna.distributions.sfxDensity.some(
      (b) => b.key === "dense_kinetic_whoosh_pop",
    ),
  ).toBe(false);
  expect(
    stats.deepDna.v2DeepDna.v2CraftSignals.find((s) => s.signal === "has_sfx_whoosh_or_riser")!.pct,
  ).toBe(50);

  expect(
    stats.deepDna.boundaries.transitionTypes.some(
      (t) => t.type === "push_up" && t.winnerMinusFlopPp === 100,
    ),
  ).toBe(true);
  expect(stats.deepDna.v2DeepDna.cameraMoves.some((m) => m.move === "push_in")).toBe(true);
  expect(stats.deepDna.v2DeepDna.cameraMoves.some((m) => m.move === "static_locked")).toBe(true);
  expect(stats.deepDna.boundaries.byTier.winner.pcts.continuous).toBe(50);
  expect(stats.deepDna.boundaries.byTier.flop.pcts.hard_cut).toBe(75);
  expect(stats.deepDna.v2DeepDna.winnerMedianOutroHoldSec).toBe(0.4);
  expect(stats.deepDna.v2DeepDna.flopMedianOutroHoldSec).toBe(3.0);

  const md = renderStatsSummaryMd(stats);
  expect(md).toContain("Win Rate (%)");
  expect(md).toContain("subsample base:");
  expect(md).toContain("Winner Share (%)");
  expect(md).toContain("Delta W-F (pp)");
  expect(md).toContain("pov:*, voice:*, bgm:*, sfx:* use Audio Verified N=2");
  expect(md).not.toMatch(/\*\*|`/);
  expect(md).not.toContain("-%");

  const winnerOnlyMd = renderStatsSummaryMd(aggregateCorpus(catalog, [recW1]));
  expect(winnerOnlyMd).toContain("| M | 40% | 40% | - |");
  expect(winnerOnlyMd).not.toMatch(/(?:^|\s|\()-s\b/);
});

test("cli status requires meta.json + telemetry.json and flags legacy or catalog-drifted stats.json as stale", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-cli-stale-"));
  try {
    const catalog = makeCatalog([
      {
        id: "x1",
        title: "X1 😱",
        url: "https://www.youtube.com/shorts/x1",
        playlistIndex: 35,
        views: 10_000_000,
        likes: 300_000,
        durationSec: 35,
        uploadDate: "20260701",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), catalog);
    writeJsonAtomic(join(tmp, "videos", "x1", "telemetry.json"), makeSampleV2Telemetry());
    writeJsonAtomic(
      join(tmp, "videos", "x1", "meta.json"),
      makeRecord("x1", "winner", 2, makeSampleV2Telemetry()).meta,
    );
    writeJsonAtomic(join(tmp, "videos", "orphan", "telemetry.json"), makeSampleV2Telemetry());
    const ck = loadCheckpoint(tmp, "demo-ch");
    ck.entries.x1 = {
      status: "done",
      updatedAt: "2026-11-23T00:00:00Z",
      chatUrl: null,
      attempts: 1,
    };
    saveCheckpoint(tmp, ck, catalog);
    writeJsonAtomic(join(tmp, "stats.json"), {
      deepDna: { minedCount: 1 },
    });

    const stLegacy = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "demo-ch", "--corpus", tmp],
      { encoding: "utf8" },
    );
    expect(stLegacy.status).toBe(0);
    expect(stLegacy.stdout).toContain("(v1=0,v2=1)");
    expect(stLegacy.stdout).toContain("aggregatedN=1 (stale: run aggregate)");

    runAggregate(tmp);
    const stFresh = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "demo-ch", "--corpus", tmp],
      { encoding: "utf8" },
    );
    expect(stFresh.status).toBe(0);
    expect(stFresh.stdout).not.toContain("stale");

    writeJsonAtomic(join(tmp, "catalog.json"), {
      ...catalog,
      transcriptCount: catalog.transcriptCount + 1,
    });
    const stCatalogDrift = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "demo-ch", "--corpus", tmp],
      { encoding: "utf8" },
    );
    expect(stCatalogDrift.status).toBe(0);
    expect(stCatalogDrift.stdout).toContain("(stale: run aggregate)");
    expect(stCatalogDrift.stdout).toContain(
      "next: bun .claude/skills/channel-dna/scripts/cli.ts aggregate",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);

test("aggregate can publish a schema v2 cohort without removing legacy dossiers or marking the report stale", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-cli-v2-report-"));
  try {
    const catalog = makeCatalog(
      ["legacy", "current"].map((id, playlistIndex) => ({
        id,
        title: id,
        url: `https://www.youtube.com/shorts/${id}`,
        playlistIndex,
        views: 10_000_000,
        likes: null,
        durationSec: 35,
        uploadDate: "20260701",
      })),
    );
    writeJsonAtomic(join(tmp, "catalog.json"), catalog);
    const ck = loadCheckpoint(tmp, "demo-ch");
    for (const record of [
      makeRecord("legacy", "winner", 2, makeSampleTelemetry()),
      makeRecord("current", "median", 1, makeSampleV2Telemetry()),
    ]) {
      const id = record.meta.id;
      writeJsonAtomic(join(tmp, "videos", id, "meta.json"), record.meta);
      writeJsonAtomic(join(tmp, "videos", id, "telemetry.json"), record.telemetry);
      ck.entries[id] = {
        status: "done",
        updatedAt: record.meta.minedAt,
        chatUrl: null,
        attempts: 1,
      };
    }
    saveCheckpoint(tmp, ck, catalog);
    const cli = (command: string, ...flags: string[]) =>
      spawnSync("bun", [CLI_PATH, command, "--channel", "demo-ch", "--corpus", tmp, ...flags], {
        encoding: "utf8",
      });

    const filtered = cli("aggregate", "--min-schema", "2");
    expect(filtered.status, filtered.stderr).toBe(0);
    const stats = JSON.parse(readFileSync(join(tmp, "stats.json"), "utf8"));
    expect(stats.catalogTelemetry.totalCollected).toBe(2);
    expect(stats.deepDna).toMatchObject({ minSchema: 2, minedCount: 1, v2DeepDna: { v2Count: 1 } });
    const freshStatus = cli("status");
    expect(freshStatus.stdout).toContain("(v1=1,v2=1)");
    expect(freshStatus.stdout).not.toContain("stale");
    writeJsonAtomic(join(tmp, "catalog.json"), { ...catalog, snapshotDate: "2026-11-24" });
    expect(cli("status").stdout).toContain("aggregate --channel demo-ch --min-schema 2");
    expect(cli("aggregate").stdout).toContain("deepDna=2");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);

test("a model-reported media delivery failure or degraded 1fps/no-audio disclosure cannot pass as a complete dossier", () => {
  const dossier = makeSampleDossier(makeSampleV2Telemetry());
  const degraded = parseAndValidateDossier(
    `INPUT_INCOMPLETE: VIDEO_SAMPLING_TOO_SPARSE\n\n${dossier}`,
  );
  expect(degraded.valid).toBe(false);
  expect(degraded.errors).toEqual(["incomplete media input: VIDEO_SAMPLING_TOO_SPARSE"]);

  const prose1fps = parseAndValidateDossier(
    `*Calibration note: Only 1fps sampled visual frames were provided.*\n\n${dossier}`,
    { expectedFps: 24 },
  );
  expect(prose1fps.valid).toBe(false);
  expect(prose1fps.errors.some((e) => e.includes("degraded 1fps"))).toBe(true);

  const sampledAt1fps = parseAndValidateDossier(
    `*(Note: 30fps native sampled at 1fps in the visual strip.)*\n\n${dossier}`,
    { expectedFps: 24 },
  );
  expect(sampledAt1fps.valid).toBe(false);
  expect(sampledAt1fps.errors.some((e) => e.includes("degraded 1fps"))).toBe(true);

  const proseNoAudio = parseAndValidateDossier(
    `*Calibration note: No attached audio stream was provided.*\n\n${dossier}`,
    { expectAudio: true, expectedFps: 24 },
  );
  expect(proseNoAudio.valid).toBe(false);
  expect(proseNoAudio.errors.some((e) => e.includes("missing audio track"))).toBe(true);

  const trulySilentAllowed = parseAndValidateDossier(
    `*Calibration note: No attached audio stream was provided.*\n\n${dossier}`,
    { expectAudio: false, expectedFps: 24 },
  );
  expect(trulySilentAllowed.valid).toBe(true);
});

test("learn-channel-video.md stays in strict 2-way enum parity with types.ts including Section 3 Scale/Angle tokens", () => {
  const prompt = readFileSync(
    join(REPO_ROOT, ".claude/skills/channel-dna/system/learn-channel-video.md"),
    "utf8",
  );
  const jsonMatch = prompt.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  expect(jsonMatch).not.toBeNull();
  const tpl = JSON.parse(jsonMatch![1]!) as Record<string, unknown>;
  const splitPipe = (field: string): string[] => {
    const raw = tpl[field];
    return typeof raw === "string"
      ? raw
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  };

  const enumFields: Array<[string, readonly string[]]> = [
    ["visual_medium", VISUAL_MEDIUMS],
    ["protagonist_format", PROTAGONIST_FORMATS],
    ["set_architecture", SET_ARCHITECTURES],
    ["visual_layer_format", VISUAL_LAYER_FORMATS],
    ["topic_category", TOPIC_CATEGORIES],
    ["emotional_driver", EMOTIONAL_DRIVERS],
    ["stakes_engine", STAKES_ENGINES],
    ["title_hook_relation", TITLE_HOOK_RELATIONS],
    ["opening_scroll_stop_state", OPENING_SCROLL_STOP_STATES],
    ["open_loop_payoff_timing", OPEN_LOOP_PAYOFF_TIMINGS],
    ["vo_visual_relation", VO_VISUAL_RELATIONS],
    ["narrative_timeline", NARRATIVE_TIMELINES],
    ["open_loop_architecture", OPEN_LOOP_ARCHITECTURES],
    ["information_reveal_mode", INFORMATION_REVEAL_MODES],
    ["thumbnail_archetype", THUMBNAIL_ARCHETYPES],
    ["thumbnail_text_relation", THUMBNAIL_TEXT_RELATIONS],
    ["thumbnail_opening_payoff", THUMBNAIL_OPENING_PAYOFFS],
    ["thumbnail_focal_complexity", THUMBNAIL_FOCAL_COMPLEXITIES],
    ["thumbnail_gaze_or_cue", THUMBNAIL_GAZE_OR_CUES],
    ["hook_archetype", HOOK_ARCHETYPES],
    ["narration_pov", NARRATION_POVS],
    ["voice_delivery", VOICE_DELIVERIES],
    ["caption_style", CAPTION_STYLES],
    ["story_structure", STORY_STRUCTURES],
    ["narrative_connector", NARRATIVE_CONNECTORS],
    ["ending_type", ENDING_TYPES],
    ["ending_valence", ENDING_VALENCES],
    ["camera_energy", CAMERA_ENERGIES],
    ["camera_motion_persistence", CAMERA_MOTION_PERSISTENCES],
    ["camera_velocity_profile", CAMERA_VELOCITY_PROFILES],
    ["framing_anchor", FRAMING_ANCHORS],
    ["dominant_lens_feel", LENS_FEELS],
    ["lighting_style", LIGHTING_STYLES],
    ["shadow_quality", SHADOW_QUALITIES],
    ["color_palette_mood", COLOR_PALETTE_MOODS],
    ["easing_energy", EASING_ENERGIES],
    ["acting_mode", ACTING_MODES],
    ["audio_bed_style", AUDIO_BED_STYLES],
    ["bgm_mood", BGM_MOODS],
    ["bgm_twist_behavior", BGM_TWIST_BEHAVIORS],
    ["bgm_ending_behavior", BGM_ENDING_BEHAVIORS],
    ["sfx_density", SFX_DENSITIES],
  ];
  for (const [field, expected] of enumFields) {
    expect(splitPipe(field), `2-way enum mismatch for ${field}`).toEqual([...expected]);
  }
  expect(Object.keys(tpl.shot_scale_counts as Record<string, unknown>)).toEqual([...SHOT_SCALES]);
  expect(Object.keys(tpl.camera_angle_counts as Record<string, unknown>)).toEqual([
    ...CAMERA_ANGLES,
  ]);
  expect(Object.keys(tpl.craft_signals as Record<string, unknown>)).toEqual([
    ...CRAFT_SIGNAL_KEYS,
    ...CRAFT_SIGNAL_KEYS_V2,
    ...CRAFT_SIGNAL_KEYS_V3,
  ]);

  const sec2 = prompt.slice(prompt.indexOf("### 2."), prompt.indexOf("### 3."));
  for (const role of BEAT_ROLES) {
    expect(sec2, `Section 2 missing beat role ${role}`).toContain(`\`${role}\``);
  }
  const sec3 = prompt.slice(prompt.indexOf("### 3."), prompt.indexOf("### 4."));
  for (const scale of SHOT_SCALES) {
    expect(sec3, `Section 3 missing scale token ${scale}`).toContain(scale);
  }
  for (const angle of CAMERA_ANGLES) {
    expect(sec3, `Section 3 missing angle token ${angle}`).toContain(angle);
  }
  const sec4PreJson = prompt.slice(prompt.indexOf("### 4."), prompt.indexOf("```json"));
  const discHooks = [...sec4PreJson.matchAll(/^- `([a-z0-9_]+)`: /gm)].map((m) => m[1]!);
  expect(discHooks).toEqual([...HOOK_ARCHETYPES]);

  const extractDiscLineTokens = (field: string): string[] => {
    const line = sec4PreJson.split(/\r?\n/).find((l) => l.includes(`**\`${field}\`:**`)) ?? "";
    const toks = [...line.matchAll(/`(?:\[")?([a-z0-9_]+)(?:"\])?`/g)]
      .map((m) => m[1]!)
      .filter((t) => t !== field);
    return toks;
  };
  expect(extractDiscLineTokens("sfx_layers_used").sort()).toEqual([...SFX_LAYER_TYPES].sort());
  expect(extractDiscLineTokens("time_remap_types").sort()).toEqual([...TIME_REMAP_TYPES].sort());
  expect(Array.isArray(tpl.sfx_layers_used)).toBe(true);
  expect(Array.isArray(tpl.time_remap_types)).toBe(true);

  const taxStart = prompt.indexOf("## Reusable Film & Motion Craft Taxonomy");
  const taxEnd = prompt.indexOf("## Output Structure");
  const taxSlice = prompt.slice(taxStart, taxEnd);
  const taxCategories = [...taxSlice.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]!);
  expect([...taxCategories].sort((a, b) => a.localeCompare(b))).toEqual(
    [...CRAFT_PILLAR_CATEGORIES].sort((a, b) => a.localeCompare(b)),
  );
  for (const cat of CRAFT_PILLAR_CATEGORIES) {
    expect(parseDominantCategoryCell(`Observed craft beat [${cat}]`)).toBe(cat);
  }
  expect(parseDominantCategoryCell("Legacy [UI, Captions & Readability]")).toBeNull();
});

test("schema.ts v2 coherence checks test blur, audio, loop, and rehook mismatches independently", () => {
  const blurAllOff = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({
        craft_signals: {
          ...makeSampleV2Telemetry().craft_signals,
          uses_motion_blur: true,
          uses_camera_turn_blur: false,
          uses_translation_or_radial_blur: false,
          uses_object_motion_blur: false,
          uses_subject_tracking_blur: false,
        },
      }),
    ),
  );
  expect(blurAllOff.valid).toBe(true);
  expect(blurAllOff.warnings.some((w) => w.includes("all 4 granular blur flags are false"))).toBe(
    true,
  );

  const silentBgmOnly = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({
        audio_bed_style: "silent",
        bgm_mood: "tense_pulse_synth",
        sfx_density: "none",
        voice_delivery: "unvoiced",
        opening_spoken_line: null,
      }),
    ),
  );
  expect(silentBgmOnly.warnings.some((w) => w.includes("bgm_mood"))).toBe(true);
  expect(silentBgmOnly.warnings.some((w) => w.includes("sfx_density"))).toBe(false);

  const silentSfxOnly = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({
        audio_bed_style: "silent",
        bgm_mood: "none",
        sfx_density: "sparse_grounded",
        voice_delivery: "unvoiced",
        opening_spoken_line: null,
      }),
    ),
  );
  expect(silentSfxOnly.warnings.some((w) => w.includes("sfx_density"))).toBe(true);
  expect(silentSfxOnly.warnings.some((w) => w.includes("bgm_mood"))).toBe(false);

  const noVoMismatch = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({
        audio_bed_style: "music_sfx_no_vo",
        voice_delivery: "calm_matter_of_fact",
        opening_spoken_line: null,
      }),
    ),
  );
  expect(noVoMismatch.warnings.some((w) => w.includes("music_sfx_no_vo"))).toBe(true);

  const dryBgmMismatch = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({
        audio_bed_style: "vo_only_dry",
        bgm_mood: "tense_pulse_synth",
      }),
    ),
  );
  expect(dryBgmMismatch.warnings.some((w) => w.includes("vo_only_dry"))).toBe(true);

  const loopMismatch = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({
        ending_type: "seamless_loop",
        craft_signals: { ...makeSampleV2Telemetry().craft_signals, has_seamless_loop: false },
      }),
    ),
  );
  expect(loopMismatch.warnings.some((w) => w.includes("has_seamless_loop"))).toBe(true);

  const lateRehook = parseAndValidateDossier(
    makeSampleDossier(makeSampleV2Telemetry({ rehook_timestamps_sec: [10, 45] })),
  );
  expect(lateRehook.warnings.some((w) => w.includes("exceeds duration_sec"))).toBe(true);
});

test("executeAskAttempt clears stale chatUrl on fresh runNew and does not collect terminal post-run aborts", async () => {
  expect(isTerminalRunAbort("stopped after Thoughts with no answer text")).toBe(true);
  expect(isTerminalRunAbort("AI Studio says: An internal error has occurred")).toBe(true);
  expect(isTerminalRunAbort('"Copy as markdown" of turn -1 copied nothing')).toBe(true);
  expect(isTerminalRunAbort("→ [12/15] wait for answer")).toBe(false);

  const okRes = (stderr: string) => ({ status: 0, stdout: "", stderr, timedOut: false });
  const failRes = (stderr: string, timedOut = false) => ({
    status: 1,
    stdout: "",
    stderr,
    timedOut,
  });

  const retryState = {
    submittedOnTab: false,
    chatUrl: "https://aistudio.google.com/prompts/STALE_ATTEMPT1_URL_999" as string | null,
  };
  const retryRes = await executeAskAttempt(retryState, {
    runNew: async () => okRes("✓ [15/15] done (unsaved chat)"),
    runCollect: async () => {
      throw new Error("should not call runCollect");
    },
    drainOrphan: async () => okRes(""),
    hasOutput: () => true,
  });
  expect(retryRes.ok).toBe(true);
  expect(retryState.chatUrl).toBeNull();

  let newCalls = 0;
  let collectCalls = 0;
  const abortState = { submittedOnTab: false, chatUrl: null as string | null };
  const abortA1 = await executeAskAttempt(abortState, {
    runNew: async () => {
      newCalls++;
      return failRes(
        "✓ [11/15] run: 90ms\n✗ [12/15] wait for answer: stopped after Thoughts with no answer text",
      );
    },
    runCollect: async () => {
      collectCalls++;
      return okRes("");
    },
    drainOrphan: async () => okRes(""),
    hasOutput: () => false,
  });
  expect(abortA1.ok).toBe(false);
  expect(abortState.submittedOnTab).toBe(false);
  const abortA2 = await executeAskAttempt(abortState, {
    runNew: async () => {
      newCalls++;
      return okRes("✓ saved https://aistudio.google.com/prompts/FRESH_ATTEMPT2_URL_555");
    },
    runCollect: async () => {
      collectCalls++;
      return okRes("");
    },
    drainOrphan: async () => okRes(""),
    hasOutput: () => true,
  });
  expect(abortA2.ok).toBe(true);
  expect(newCalls).toBe(2);
  expect(collectCalls).toBe(0);
  expect(abortState.chatUrl).toBe("https://aistudio.google.com/prompts/FRESH_ATTEMPT2_URL_555");

  const collectAbortState = { submittedOnTab: true, chatUrl: null as string | null };
  const cRes = await executeAskAttempt(collectAbortState, {
    runNew: async () => okRes(""),
    runCollect: async () => failRes("the last prompt in this chat has no answer"),
    drainOrphan: async () => okRes(""),
    hasOutput: () => false,
  });
  expect(cRes.ok).toBe(false);
  expect(collectAbortState.submittedOnTab).toBe(false);
});

test("formatMineOutcome exits 1 on 0-mined halt with recovery guidance and 0 on partial batches", () => {
  const bot0 = formatMineOutcome("zack-d-films", {
    done: 0,
    failed: 0,
    quotaHalted: true,
    haltReason: "bot_or_auth",
    processed: [],
  });
  expect(bot0.exitCode).toBe(1);
  expect(bot0.nextLine).toContain("--cookies-from-browser");
  expect(bot0.nextLine).not.toContain("aggregate");

  const quota0 = formatMineOutcome("zack-d-films", {
    done: 0,
    failed: 0,
    quotaHalted: true,
    haltReason: "quota",
    processed: [],
  });
  expect(quota0.exitCode).toBe(1);
  expect(quota0.nextLine).toContain("quota");

  const partial = formatMineOutcome("zack-d-films", {
    done: 1,
    failed: 0,
    quotaHalted: true,
    haltReason: "bot_or_auth",
    processed: ["v1"],
  });
  expect(partial.exitCode).toBe(0);
  expect(partial.nextLine).toContain("aggregate --channel zack-d-films");

  const fail0 = formatMineOutcome("zack-d-films", {
    done: 0,
    failed: 2,
    quotaHalted: false,
    haltReason: "none",
    processed: ["v1", "v2"],
  });
  expect(fail0.exitCode).toBe(1);
  expect(fail0.nextLine).toContain("--retry-failed");
});

test("runMine preserves existing v1 done status on failed --min-schema 2 upgrade and propagates runVideo hasAudioStream", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-lossless-v2-"));
  try {
    const catalog = makeCatalog([
      {
        id: "keep1",
        title: "Keep V1 😱",
        url: "https://www.youtube.com/shorts/keep1",
        playlistIndex: 10,
        views: 20_000_000,
        likes: 500_000,
        durationSec: 40,
        uploadDate: "20260701",
      },
      {
        id: "mute2",
        title: "Silent Clip",
        url: "https://www.youtube.com/shorts/mute2",
        playlistIndex: 11,
        views: 15_000_000,
        likes: 300_000,
        durationSec: 40,
        uploadDate: "20260702",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), catalog);
    writeJsonAtomic(join(tmp, "videos", "keep1", "telemetry.json"), makeSampleTelemetry());
    writeFileSync(
      join(tmp, "videos", "keep1", "dossier.md"),
      makeSampleDossier(makeSampleTelemetry()),
      "utf8",
    );
    const ck = loadCheckpoint(tmp, "demo-ch");
    ck.entries.keep1 = {
      status: "done",
      updatedAt: "2026-11-22T00:00:00Z",
      chatUrl: null,
      attempts: 1,
    };
    saveCheckpoint(tmp, ck, catalog);

    const res = await runMine({
      channel: "demo-ch",
      corpusDir: tmp,
      limit: 2,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      minSchema: 2,
      runVideo: async (vid) => {
        if (vid.id === "keep1") {
          return { ok: true, markdown: makeSampleDossier(makeSampleTelemetry()) };
        }
        return {
          ok: true,
          markdown: makeSampleDossier(makeSampleV2Telemetry()),
          hasAudioStream: false,
        };
      },
    });
    expect(res.done).toBe(1);
    expect(res.failed).toBe(1);
    expect(loadCheckpoint(tmp, "demo-ch").entries.keep1?.status).toBe("done");
    const preservedTel = JSON.parse(
      readFileSync(join(tmp, "videos", "keep1", "telemetry.json"), "utf8"),
    ) as VideoTelemetry;
    expect(preservedTel.schema_version).toBe(1);
    const muteMeta = JSON.parse(
      readFileSync(join(tmp, "videos", "mute2", "meta.json"), "utf8"),
    ) as { hasAudioStream: boolean };
    expect(muteMeta.hasAudioStream).toBe(false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("extractTrailingEmoji and cleanTranscriptText handle trailing tags, flags, keycaps, and abbreviations", () => {
  expect(extractTrailingEmoji("The Bathroom Mode 😏 (Patent Pending)")).toBe("😏");
  expect(extractTrailingEmoji("The Effort Paradox 🤔 (explained)")).toBe("🤔");
  expect(extractTrailingEmoji("Crazy Trick 😱 #shorts #viral")).toBe("😱");
  expect(extractTrailingEmoji("What Happened 😨 [Part 2]")).toBe("😨");
  expect(extractTrailingEmoji("Made in 🇺🇸")).toBe("🇺🇸");
  expect(countTitleWords("Made in 🇺🇸")).toBe(2);
  expect(extractTrailingEmoji("Top 1️⃣")).toBe("1️⃣");
  expect(extractTrailingEmoji("What If You Could Undo Anything?")).toBe("NONE");

  expect(
    cleanTranscriptText("Dr. Smith spent 3.5 million dollars. It worked!").openingSentence,
  ).toBe("Dr. Smith spent 3.5 million dollars.");
  expect(
    cleanTranscriptText("In the U.S. a bridge collapsed. Nobody survived.").openingSentence,
  ).toBe("In the U.S. a bridge collapsed.");
  expect(classifyOpeningSentence("You rip off your clothes in seconds.")).toBe(
    "second_person_direct",
  );
  expect(classifyOpeningSentence("It swung down onto the roof.")).toBe("direct_story_or_fact");
});

test("aggregateCorpus computes exact pacing formulas, English linguistics, titleSummary splits, narrationPov audio guard, and exemplars", () => {
  const catalog = makeCatalog([
    {
      id: "w1",
      title: "Why 3 Bridges Shake? 😱 (explained)",
      url: "https://www.youtube.com/shorts/w1",
      playlistIndex: 35,
      views: 50_000_000,
      likes: 1_500_000,
      durationSec: 40,
      uploadDate: "20260701",
      transcriptText: "You feel it shake. He ran fast. I watched.",
      wordCount: 9,
      wpm: 150,
      openingTranscriptLine: "You feel it shake.",
    },
    {
      id: "m1",
      title: "Simple Title One",
      url: "https://www.youtube.com/shorts/m1",
      playlistIndex: 34,
      views: 10_000_000,
      likes: 200_000,
      durationSec: 40,
      uploadDate: "20260702",
    },
    {
      id: "m2",
      title: "Simple Title Two",
      url: "https://www.youtube.com/shorts/m2",
      playlistIndex: 33,
      views: 10_000_000,
      likes: 200_000,
      durationSec: 40,
      uploadDate: "20260703",
    },
    {
      id: "m3",
      title: "Simple Title Three",
      url: "https://www.youtube.com/shorts/m3",
      playlistIndex: 32,
      views: 10_000_000,
      likes: 200_000,
      durationSec: 40,
      uploadDate: "20260704",
    },
    {
      id: "f1",
      title: "Plain Unmarked Flop Title",
      url: "https://www.youtube.com/shorts/f1",
      playlistIndex: 31,
      views: 1_000_000,
      likes: 20_000,
      durationSec: 40,
      uploadDate: "20260705",
      transcriptText: "They walked slowly down the long concrete hall until night fell.",
      wordCount: 11,
      wpm: 190,
      openingTranscriptLine: "They walked slowly down the long concrete hall until night fell.",
    },
  ]);

  const w1Rec = makeRecord(
    "w1",
    "winner",
    5.0,
    makeSampleV2Telemetry({
      duration_sec: 40,
      rehook_timestamps_sec: [10, 20, 30],
      boundary_counts: { hard_cut: 1, hidden_cut: 1, transition: 2, continuous: 4 },
      shot_scale_counts: { EW: 0, W: 2, M: 4, MCU: 2, CU: 2, ECU: 0, INSERT: 0 },
      narration_pov: "second_person_you",
    }),
    150,
  );
  const f1Silent = makeRecord(
    "f1",
    "flop",
    0.2,
    makeSampleV2Telemetry({
      duration_sec: 40,
      rehook_timestamps_sec: [20],
      boundary_counts: { hard_cut: 2, hidden_cut: 0, transition: 0, continuous: 0 },
      shot_scale_counts: { EW: 0, W: 2, M: 2, MCU: 0, CU: 0, ECU: 0, INSERT: 0 },
      narration_pov: "unvoiced",
    }),
    190,
  );
  f1Silent.meta.hasAudioStream = false;

  const stats = aggregateCorpus(catalog, [w1Rec, f1Silent]);
  expect(stats.catalogTelemetry.packaging.titleSummary.medianTitleWords).toBe(3);
  expect(stats.catalogTelemetry.packaging.titleSummary.winnerTrailingEmojiPct).toBe(100);
  expect(stats.catalogTelemetry.packaging.titleSummary.flopTrailingEmojiPct).toBe(0);
  expect(stats.catalogTelemetry.packaging.titleSummary.questionTitlePct).toBe(20);
  expect(stats.catalogTelemetry.packaging.titleSummary.winnerQuestionTitlePct).toBe(100);
  expect(stats.catalogTelemetry.packaging.titleSummary.flopQuestionTitlePct).toBe(0);
  expect(stats.catalogTelemetry.packaging.titleSummary.numberTitlePct).toBe(20);

  expect(stats.catalogTelemetry.linguistics.punctuatedSampleN).toBe(2);
  expect(stats.catalogTelemetry.linguistics.medianWordsPerSentence).toBe(3.5);
  expect(stats.catalogTelemetry.linguistics.shortPunchySentencePct).toBe(75);
  expect(stats.catalogTelemetry.linguistics.pronounProfilePct).toEqual({
    secondPersonYou: 25,
    thirdPersonStory: 50,
    firstPersonIWe: 25,
  });

  expect(stats.deepDna.pacingAndTiming.winnerMedianEditCutsPerMin).toBe(6);
  expect(stats.deepDna.pacingAndTiming.winnerMedianTotalBeatsPerMin).toBe(12);
  expect(stats.deepDna.pacingAndTiming.winnerMedianAvgShotSec).toBe(4);
  expect(stats.deepDna.pacingAndTiming.winner.medianRehookCount).toBe(3);
  expect(stats.deepDna.pacingAndTiming.winner.medianRehookIntervalSec).toBe(10);
  expect(stats.deepDna.pacingAndTiming.flopMedianEditCutsPerMin).toBe(3);
  expect(stats.deepDna.pacingAndTiming.flopMedianAvgShotSec).toBe(10);

  expect(stats.deepDna.v2DeepDna.distributions.narrationPov.some((b) => b.key === "unvoiced")).toBe(
    false,
  );
  expect(stats.deepDna.exemplars[0]!.hookVisualTrigger).toBe(
    "Camera dives into a glowing snack bowl",
  );
  expect(stats.deepDna.exemplars[1]!.narrationPov).toBeNull();
});

test("runMine enforces schema_version 3 by default on custom runVideo and halts cleanly when runVideo throws bot-gate", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-default-v2-"));
  try {
    const catalog = makeCatalog([
      {
        id: "def1",
        title: "Default V2 Check 😱",
        url: "https://www.youtube.com/shorts/def1",
        playlistIndex: 10,
        views: 20_000_000,
        likes: 500_000,
        durationSec: 40,
        uploadDate: "20260701",
      },
      {
        id: "throw2",
        title: "Bot Gate Throw 😱",
        url: "https://www.youtube.com/shorts/throw2",
        playlistIndex: 11,
        views: 15_000_000,
        likes: 300_000,
        durationSec: 40,
        uploadDate: "20260702",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), catalog);
    saveCheckpoint(tmp, loadCheckpoint(tmp, "demo-ch"), catalog);

    let def1Attempts = 0;
    const res = await runMine({
      channel: "demo-ch",
      corpusDir: tmp,
      limit: 2,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      ids: ["def1", "throw2"],
      runVideo: async (vid, _tab, attempt) => {
        if (vid.id === "def1") {
          def1Attempts = attempt;
          return attempt === 1
            ? { ok: true, markdown: makeSampleDossier(makeSampleV2Telemetry()) }
            : { ok: true, markdown: makeSampleDossier(makeSampleV3Telemetry()) };
        }
        throw new Error("yt-dlp download failed: HTTP Error 403: Forbidden");
      },
    });
    expect(def1Attempts).toBe(2);
    expect(res.done).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.quotaHalted).toBe(true);
    expect(res.haltReason).toBe("bot_or_auth");
    expect(loadCheckpoint(tmp, "demo-ch").entries.throw2).toBeUndefined();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("schema.ts narration_pov/bgm/silent-craft warnings, runCollect timeout state, and extended title openers", async () => {
  const silentPov = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({
        audio_bed_style: "silent",
        bgm_mood: "none",
        sfx_density: "none",
        voice_delivery: "unvoiced",
        narration_pov: "second_person_you",
        opening_spoken_line: null,
        craft_signals: {
          ...makeSampleV2Telemetry().craft_signals,
          has_sfx_whoosh_or_riser: true,
        },
      }),
    ),
  );
  expect(silentPov.warnings.some((w) => w.includes("narration_pov"))).toBe(true);
  expect(silentPov.warnings.some((w) => w.includes("audio craft signal"))).toBe(true);

  const voicedNoBgm = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV2Telemetry({
        audio_bed_style: "continuous_bgm_plus_vo",
        bgm_mood: "none",
        narration_pov: "unvoiced",
      }),
    ),
  );
  expect(voicedNoBgm.warnings.some((w) => w.includes("expects BGM"))).toBe(true);
  expect(voicedNoBgm.warnings.some((w) => w.includes("expects voice while narration_pov"))).toBe(
    true,
  );

  const timeoutState = { submittedOnTab: true, chatUrl: null as string | null };
  const tRes = await executeAskAttempt(timeoutState, {
    runNew: async () => ({ status: 0, stdout: "", stderr: "", timedOut: false }),
    runCollect: async () => ({ status: 1, stdout: "", stderr: "wait timed out", timedOut: true }),
    drainOrphan: async () => ({ status: 0, stdout: "", stderr: "", timedOut: false }),
    hasOutput: () => false,
  });
  expect(tRes.ok).toBe(false);
  expect(timeoutState.submittedOnTab).toBe(true);

  expect(classifyTitleOpener("His Nose Was Filled With Live Maggots 😱")).toBe(
    "He/She/They/This ...",
  );
  expect(classifyTitleOpener("Does Running Like Naruto Make You Faster? 🤔")).toBe(
    "Does/Is/Was ...",
  );
  expect(classifyTitleOpener("When Your Father Dies 😢")).toBe("When/Where/Who ...");

  let restartNewCalls = 0;
  let restartHasOut = false;
  const restartState = {
    submittedOnTab: true,
    chatUrl: "https://aistudio.google.com/prompts/LOST_PRE_CRASH_URL_123" as string | null,
  };
  const restartRes = await executeAskAttempt(restartState, {
    runNew: async () => {
      restartNewCalls++;
      restartHasOut = true;
      return {
        status: 0,
        stdout: "",
        stderr: "✓ saved https://aistudio.google.com/prompts/RECOVERED_AFTER_RESTART_999",
        timedOut: false,
      };
    },
    runCollect: async () => ({
      status: 1,
      stdout: "",
      stderr:
        "✗ [4/7] open chat failed: the open tab holds no AI Studio chat (at https://aistudio.google.com/library)",
      timedOut: false,
    }),
    drainOrphan: async () => ({ status: 0, stdout: "", stderr: "", timedOut: false }),
    hasOutput: () => restartHasOut,
  });
  expect(restartRes.ok).toBe(true);
  expect(restartNewCalls).toBe(1);
  expect(restartState.submittedOnTab).toBe(false);
  expect(restartState.chatUrl).toBe(
    "https://aistudio.google.com/prompts/RECOVERED_AFTER_RESTART_999",
  );
});

test("schema.ts catches markdown-wrapped INPUT_INCOMPLETE, Section 3/4 degraded disclosures, and wide non-transition Boundary sampling brackets", () => {
  const baseV2 = makeSampleV2Telemetry();
  const wrapped =
    "**INPUT_INCOMPLETE: VIDEO_SAMPLING_TOO_SPARSE** (received 1fps stills)\n\n" +
    makeSampleDossier(baseV2);
  expect(parseAndValidateDossier(wrapped, { expectAudio: true, expectedFps: 24 }).valid).toBe(
    false,
  );
  expect(
    parseAndValidateDossier("`INPUT_INCOMPLETE: AUDIO_UNAVAILABLE`", { expectAudio: true }).valid,
  ).toBe(false);

  const sec3NoteMd = makeSampleDossier(baseV2).replace(
    "### 3. Macro Shot, Boundary & Craft Pattern Spine",
    "### 3. Macro Shot, Boundary & Craft Pattern Spine\n*(Note: subsampled at 1 fps; audio stream was not provided.)*",
  );
  const sec3Fps = parseAndValidateDossier(sec3NoteMd, { expectAudio: false, expectedFps: 24 });
  expect(sec3Fps.valid).toBe(false);
  expect(sec3Fps.errors.some((e) => /degraded 1fps/i.test(e))).toBe(true);

  const sec4AudioOnly = makeSampleDossier(
    makeSampleV2Telemetry({ weaknesses_or_drag: ["No attached audio track in clip"] }),
  );
  expect(parseAndValidateDossier(sec4AudioOnly, { expectAudio: true, expectedFps: 24 }).valid).toBe(
    false,
  );
  expect(
    parseAndValidateDossier(sec4AudioOnly, { expectAudio: false, expectedFps: 24 }).valid,
  ).toBe(true);

  const wideBracketRows = [
    "| S01 | 00:00.000–00:02.000 (f0–f60) | Opening | M / eye | Opening shot `[Camera, Framing & Staging]` | High |",
    "| S02 | 00:02.000–00:12.000 (f60–f360) | Hard Cut (f54→f84) | M / eye | Bracketed 30f gap `[Transitions & Continuity]` | Med |",
    "| S03 | 00:12.000–00:25.000 (f360–f750) | Hidden Cut (smear, f344→f374) | CU / high | Second 30f gap `[Transitions & Continuity]` | Med |",
    "| S04 | 00:25.000–00:40.000 (f750–f1200) | Transition (cross_dissolve, f750–f775) | W / eye | Legit dissolve `[Transitions & Continuity]` | High |",
  ];
  const bracketTel = makeSampleV2Telemetry({
    boundary_counts: { hard_cut: 1, hidden_cut: 1, transition: 1, continuous: 0 },
    shot_scale_counts: { EW: 0, W: 1, M: 2, MCU: 0, CU: 1, ECU: 0, INSERT: 0 },
    camera_angle_counts: { aerial: 0, overhead: 0, high: 1, eye: 3, low: 0, ground: 0 },
  });
  const bracketMd = makeSampleDossier(bracketTel, wideBracketRows);
  const bracketRes = parseAndValidateDossier(bracketMd, { expectAudio: true, expectedFps: 24 });
  expect(bracketRes.valid).toBe(false);
  expect(bracketRes.errors.some((e) => /degraded low-FPS/i.test(e))).toBe(true);
  expect(parseAndValidateDossier(bracketMd, { expectAudio: true, expectedFps: 1 }).valid).toBe(
    true,
  );

  const legitTransitionsRows = [
    "| S01 | 00:00.000–00:02.000 (f0–f60) | Opening | M / eye | Opening shot `[Camera, Framing & Staging]` | High |",
    "| S02 | 00:02.000–00:20.000 (f60–f600) | Transition (cross_dissolve, f60→f85) | M / eye | Dissolve 1 `[Transitions & Continuity]` | High |",
    "| S03 | 00:20.000–00:40.000 (f600–f1200) | Transition (cross_dissolve, f600→f625) | W / eye | Dissolve 2 `[Transitions & Continuity]` | High |",
  ];
  const transTel = makeSampleV2Telemetry({
    boundary_counts: { hard_cut: 0, hidden_cut: 0, transition: 2, continuous: 0 },
    shot_scale_counts: { EW: 0, W: 1, M: 2, MCU: 0, CU: 0, ECU: 0, INSERT: 0 },
    camera_angle_counts: { aerial: 0, overhead: 0, high: 0, eye: 3, low: 0, ground: 0 },
  });
  expect(
    parseAndValidateDossier(makeSampleDossier(transTel, legitTransitionsRows), {
      expectAudio: true,
      expectedFps: 24,
    }).valid,
  ).toBe(true);
});

test("mine.ts treats stopped-without-answer, empty-answer, and silent-downgrade as terminal aborts and preserves --min-schema in outcome hints", async () => {
  expect(
    isTerminalRunAbort(
      "✗ [12/14] wait for answer failed: the run stopped without an answer; AI Studio shows no message",
    ),
  ).toBe(true);
  expect(
    isTerminalRunAbort("✗ [13/14] copy answer failed: the answer is empty; AI Studio alerts: none"),
  ).toBe(true);
  expect(
    isTerminalRunAbort(
      "✗ [12/14] verify video delivery failed: video sampling silently downgraded by AI Studio",
    ),
  ).toBe(true);
  expect(isMediaDowngradeError("video sampling silently downgraded by AI Studio")).toBe(true);
  expect(classifyHaltReason("video sampling silently downgraded by AI Studio")).toBe(
    "media_downgrade",
  );
  expect(shouldHaltBatch("video sampling silently downgraded by AI Studio")).toBe(true);

  let collectCalls = 0;
  let newCalls = 0;
  const state = { submittedOnTab: false, chatUrl: null as string | null };
  const a1 = await executeAskAttempt(state, {
    runNew: async () => {
      newCalls++;
      return {
        status: 1,
        stdout: "",
        stderr:
          "✓ [11/15] run: generating in https://aistudio.google.com/prompts/DEAD_TURN_12345\n✗ [12/15] wait for answer failed: the run stopped without an answer; AI Studio shows no message",
        timedOut: false,
      };
    },
    runCollect: async () => {
      collectCalls++;
      return { status: 1, stdout: "", stderr: "should not collect dead turn", timedOut: false };
    },
    drainOrphan: async () => ({ status: 0, stdout: "", stderr: "", timedOut: false }),
    hasOutput: () => false,
  });
  expect(a1.ok).toBe(false);
  expect(state.submittedOnTab).toBe(false);

  const a2 = await executeAskAttempt(state, {
    runNew: async () => {
      newCalls++;
      return {
        status: 1,
        stdout: "",
        stderr:
          "✓ [11/15] run: generating\n✗ [13/15] copy answer failed: the answer is empty; AI Studio alerts: none",
        timedOut: false,
      };
    },
    runCollect: async () => {
      collectCalls++;
      return { status: 1, stdout: "", stderr: "should not collect empty turn", timedOut: false };
    },
    drainOrphan: async () => ({ status: 0, stdout: "", stderr: "", timedOut: false }),
    hasOutput: () => false,
  });
  expect(a2.ok).toBe(false);
  expect(state.submittedOnTab).toBe(false);
  expect(newCalls).toBe(2);
  expect(collectCalls).toBe(0);

  const okV2 = formatMineOutcome(
    "zack-d-films",
    { done: 2, failed: 0, quotaHalted: false, haltReason: "none", processed: ["a", "b"] },
    2,
  );
  expect(okV2.exitCode).toBe(0);
  expect(okV2.nextLine).toContain("aggregate --channel zack-d-films --min-schema 2");

  const haltedDowngrade = formatMineOutcome(
    "zack-d-films",
    { done: 0, failed: 0, quotaHalted: true, haltReason: "media_downgrade", processed: [] },
    2,
  );
  expect(haltedDowngrade.exitCode).toBe(1);
  expect(haltedDowngrade.nextLine).toContain("--backend gemini-api");
});

test("runMine wires expectAudio/expectedFps into schema validation, halts cleanly on media_downgrade, and CLI validates --backend and status hints", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cdna-r5-mine-"));
  try {
    const raw: RawCatalogVideo[] = [
      {
        id: "aud1",
        title: "Audio Clip 😱",
        url: "https://youtube.com/shorts/aud1",
        views: 30_000_000,
        likes: 900_000,
        durationSec: 40,
        uploadDate: "20260901",
        playlistIndex: 0,
      },
      {
        id: "sil2",
        title: "Silent Clip 🤔",
        url: "https://youtube.com/shorts/sil2",
        views: 10_000_000,
        likes: 300_000,
        durationSec: 40,
        uploadDate: "20260902",
        playlistIndex: 1,
      },
      {
        id: "fps3",
        title: "Sparse Clip 😨",
        url: "https://youtube.com/shorts/fps3",
        views: 5_000_000,
        likes: 150_000,
        durationSec: 40,
        uploadDate: "20260903",
        playlistIndex: 2,
      },
      {
        id: "rem4",
        title: "Queued Clip 😮",
        url: "https://youtube.com/shorts/rem4",
        views: 2_000_000,
        likes: 60_000,
        durationSec: 40,
        uploadDate: "20260904",
        playlistIndex: 3,
      },
    ];
    writeJsonAtomic(join(dir, "catalog.json"), makeCatalog(raw));
    const goodMd = makeSampleDossier(makeSampleV3Telemetry());
    const missingAudioMd = goodMd.replace(
      /^### 1\..*$/m,
      "$&\n*(Note: no attached audio stream provided.)*",
    );
    expect(missingAudioMd).toContain("no attached audio stream provided");
    const seenIds: string[] = [];

    const res = await runMine({
      channel: "r5-test",
      corpusDir: dir,
      limit: 4,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      ids: ["aud1", "sil2", "fps3", "rem4"],
      runVideo: async (vid, _tab, attempt) => {
        seenIds.push(`${vid.id}:a${attempt}`);
        if (vid.id === "aud1") {
          return {
            ok: true,
            markdown: attempt === 1 ? missingAudioMd : goodMd,
            hasAudioStream: true,
          };
        }
        if (vid.id === "sil2") {
          return { ok: true, markdown: missingAudioMd, hasAudioStream: false };
        }
        return {
          ok: true,
          markdown: "INPUT_INCOMPLETE: VIDEO_SAMPLING_TOO_SPARSE",
          hasAudioStream: true,
        };
      },
    });

    expect(res.done).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.quotaHalted).toBe(true);
    expect(res.haltReason).toBe("media_downgrade");
    expect(seenIds).toEqual(["aud1:a1", "aud1:a2", "sil2:a1", "fps3:a1", "fps3:a2"]);
    expect(existsSync(join(dir, "videos", "aud1", "dossier.md"))).toBe(true);
    expect(existsSync(join(dir, "videos", "aud1", "raw-failed-a1.md"))).toBe(false);
    expect(existsSync(join(dir, "videos", "sil2", "dossier.md"))).toBe(true);
    expect(existsSync(join(dir, "videos", "fps3", "dossier.md"))).toBe(false);
    expect(existsSync(join(dir, "videos", "fps3", "telemetry.json"))).toBe(false);
    expect(existsSync(join(dir, "videos", "fps3", "raw-failed-a1.md"))).toBe(true);
    expect(existsSync(join(dir, "videos", "fps3", "raw-failed-a2.md"))).toBe(true);
    const ck = loadCheckpoint(dir, "r5-test");
    expect(ck.entries.fps3).toBeUndefined();
    expect(ck.entries.rem4).toBeUndefined();

    const badBackend = spawnSync(
      "bun",
      [CLI_PATH, "mine", "--channel", "r5-test", "--backend", "bogus", "--corpus", dir],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(badBackend.status).toBe(2);

    const statusNoStats = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "r5-test", "--corpus", dir],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(statusNoStats.status).toBe(0);
    expect(statusNoStats.stdout).toContain("aggregatedN=none");
    expect(statusNoStats.stdout).toContain(
      "next: bun .claude/skills/channel-dna/scripts/cli.ts aggregate --channel r5-test",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

test("gemini-api.ts uploads via File API, sends 24fps High XHIGH generateContent, verifies video tokens, strips thoughts, and always deletes remote file", async () => {
  expect(toGeminiThinkingLevel("Extra High")).toBe("XHIGH");
  expect(toGeminiThinkingLevel("Low")).toBe("LOW");
  expect(toGeminiMediaResolution("High")).toBe("MEDIA_RESOLUTION_HIGH");
  expect(toGeminiMediaResolution("Low")).toBe("MEDIA_RESOLUTION_LOW");
  expect(expectedVideoTokensFloor(30, 24, "High")).toBe(Math.floor(30 * 24 * 280 * 0.45));
  expect(
    verifyGeminiApiVideoTokens({
      durationSec: 30,
      fps: 24,
      media: "High",
      promptTokens: 205_000,
      videoTokens: 201_600,
    }),
  ).toBeNull();
  expect(
    verifyGeminiApiVideoTokens({
      durationSec: 30,
      fps: 24,
      media: "High",
      promptTokens: 9_500,
      videoTokens: 2_100,
    }),
  ).toContain("silently downgraded");

  const tmp = mkdtempSync(join(tmpdir(), "cdna-gapi-"));
  const mp4 = join(tmp, "clip.mp4");
  writeFileSync(mp4, "fake-mp4-bytes");
  try {
    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    }> = [];
    let pollCount = 0;
    const makeMockFetch =
      (billedVideoTokens: number) => async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({
          url,
          method: init?.method ?? "GET",
          headers,
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        if (url.endsWith("/upload/v1beta/files")) {
          return new Response("", {
            status: 200,
            headers: {
              "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/session-1",
            },
          });
        }
        if (url === "https://generativelanguage.googleapis.com/upload/session-1") {
          return new Response(
            JSON.stringify({
              file: {
                name: "files/abc123",
                uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
                state: "PROCESSING",
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/v1beta/files/abc123") && (init?.method ?? "GET") === "GET") {
          pollCount++;
          return new Response(
            JSON.stringify({
              name: "files/abc123",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
              state: pollCount >= 2 ? "ACTIVE" : "PROCESSING",
            }),
            { status: 200 },
          );
        }
        if (url.includes(":generateContent")) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: {
                    parts: [
                      { text: "internal reasoning", thought: true },
                      { text: "### 1. Answer\nClean output" },
                    ],
                  },
                },
              ],
              usageMetadata: {
                promptTokenCount: billedVideoTokens + 2000,
                candidatesTokenCount: 500,
                promptTokensDetails: [
                  { modality: "VIDEO", tokenCount: billedVideoTokens },
                  { modality: "AUDIO", tokenCount: 750 },
                ],
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/v1beta/files/abc123") && init?.method === "DELETE") {
          return new Response("{}", { status: 200 });
        }
        return new Response("not found", { status: 404 });
      };

    const okRes = await runGeminiApiVideo({
      videoPath: mp4,
      durationSec: 30,
      systemPrompt: "SYS",
      userPrompt: "USR",
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      apiKey: "test-key-secret",
      pollIntervalMs: 1,
      fetchImpl: makeMockFetch(201_600),
    });
    expect(okRes.markdown).toBe("### 1. Answer\nClean output");
    expect(okRes.videoTokens).toBe(201_600);
    expect(okRes.audioTokens).toBe(750);
    expect(calls.every((c) => !c.url.includes("test-key-secret"))).toBe(true);
    const genCall = calls.find((c) => c.url.includes(":generateContent"))!;
    const genBody = JSON.parse(genCall.body!);
    expect(genBody.contents[0].parts[0].videoMetadata).toEqual({ fps: 24 });
    expect(genBody.contents[0].parts[0].mediaProcessing).toBe("STATIC");
    expect(genBody.contents[0].parts[0].mediaResolution).toEqual({
      level: "MEDIA_RESOLUTION_HIGH",
    });
    expect(genBody.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "XHIGH" });
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/v1beta/files/abc123"))).toBe(
      true,
    );

    calls.length = 0;
    pollCount = 0;
    await expect(
      runGeminiApiVideo({
        videoPath: mp4,
        durationSec: 30,
        systemPrompt: "SYS",
        userPrompt: "USR",
        model: "gemini-4-hydrogen",
        thinking: "Extra High",
        media: "High",
        fps: 24,
        apiKey: "test-key-secret",
        pollIntervalMs: 1,
        fetchImpl: makeMockFetch(2_100),
      }),
    ).rejects.toThrow(/silently downgraded/i);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/v1beta/files/abc123"))).toBe(
      true,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("schema.ts catches fenced/line-2+ INPUT_INCOMPLETE and copula audio disclosures while passing normal 24fps and single-bracket rows", () => {
  const baseV2 = makeSampleV2Telemetry();
  const goodMd = makeSampleDossier(baseV2);
  expect(
    parseAndValidateDossier("```\nINPUT_INCOMPLETE: VIDEO_SAMPLING_TOO_SPARSE\n```", {
      expectedFps: 24,
    }).errors[0],
  ).toContain("VIDEO_SAMPLING_TOO_SPARSE");
  expect(
    parseAndValidateDossier("> INPUT_INCOMPLETE: AUDIO_UNAVAILABLE", { expectAudio: true })
      .errors[0],
  ).toContain("AUDIO_UNAVAILABLE");
  expect(
    parseAndValidateDossier(
      `${goodMd.slice(0, 20)}\nINPUT_INCOMPLETE: VIDEO_SAMPLING_TOO_SPARSE\n${goodMd.slice(20)}`,
      { expectedFps: 24 },
    ).valid,
  ).toBe(false);

  const copulaAudio = goodMd.replace(
    /^### 1\..*$/m,
    "$&\n*(Audio stream is unavailable; video downsampled to 1fps.)*",
  );
  expect(parseAndValidateDossier(copulaAudio, { expectAudio: true, expectedFps: 1 }).valid).toBe(
    false,
  );
  expect(parseAndValidateDossier(copulaAudio, { expectAudio: false, expectedFps: 1 }).valid).toBe(
    true,
  );
  expect(parseAndValidateDossier(copulaAudio, { expectAudio: false, expectedFps: 24 }).valid).toBe(
    false,
  );

  const normal24fpsRows = [
    "| S01 | 00:00.000–00:02.000 (f0–f60) | Opening | M / eye | Opening `[Camera, Framing & Staging]` | High |",
    "| S02 | 00:02.000–00:15.000 (f60–f450) | Hard Cut (f59→f61) | M / eye | Normal 24fps 2f bracket `[Transitions & Continuity]` | High |",
    "| S03 | 00:15.000–00:28.000 (f450–f840) | Hidden Cut (smear, f449→f452) | CU / high | Normal 3f bracket `[Transitions & Continuity]` | High |",
    "| S04 | 00:28.000–00:40.000 (f840–f1200) | Hard Cut (f820→f840) | W / eye | Single wide bracket allowed `[Transitions & Continuity]` | Med |",
  ];
  const normalTel = makeSampleV2Telemetry({
    boundary_counts: { hard_cut: 2, hidden_cut: 1, transition: 0, continuous: 0 },
    transition_types: [],
    shot_scale_counts: { EW: 0, W: 1, M: 2, MCU: 0, CU: 1, ECU: 0, INSERT: 0 },
    camera_angle_counts: { aerial: 0, overhead: 0, high: 1, eye: 3, low: 0, ground: 0 },
  });
  expect(
    parseAndValidateDossier(makeSampleDossier(normalTel, normal24fpsRows), {
      expectAudio: true,
      expectedFps: 24,
    }).valid,
  ).toBe(true);
});

test("gemini-api.ts validates enums, clamps sourceFps, enforces audio/prompt token checks, and always deletes remote file on API errors", async () => {
  expect(toGeminiThinkingLevel("Minimal")).toBe("MINIMAL");
  expect(() => toGeminiThinkingLevel("UltraTurbo")).toThrow(/unsupported Gemini thinking level/i);
  expect(toGeminiMediaResolution("Medium")).toBe("MEDIA_RESOLUTION_MEDIUM");
  expect(toGeminiMediaResolution("Default")).toBe("MEDIA_RESOLUTION_UNSPECIFIED");
  expect(() => toGeminiMediaResolution("4K")).toThrow(/unsupported Gemini media resolution/i);

  expect(expectedVideoTokensFloor(30, 24, "High", 12)).toBe(Math.floor(30 * 12 * 280 * 0.45));
  expect(
    verifyGeminiApiVideoTokens({
      durationSec: 30,
      fps: 24,
      media: "High",
      promptTokens: 205_000,
      videoTokens: null,
    }),
  ).toBeNull();
  expect(
    verifyGeminiApiVideoTokens({
      durationSec: 30,
      fps: 24,
      media: "High",
      promptTokens: null,
      videoTokens: null,
    }),
  ).toContain("could not be verified");
  expect(
    verifyGeminiApiVideoTokens({
      durationSec: 30,
      fps: 24,
      media: "High",
      expectAudio: true,
      hasModalityDetails: true,
      promptTokens: 205_000,
      videoTokens: 201_600,
      audioTokens: 0,
    }),
  ).toContain("0 AUDIO tokens");
  expect(
    verifyGeminiApiVideoTokens({
      durationSec: 2,
      fps: 24,
      media: "High",
      expectAudio: true,
      hasModalityDetails: true,
      promptTokens: 13_334,
      videoTokens: 13_172,
      audioTokens: null,
    }),
  ).toBeNull();

  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const emptyPool = mkdtempSync(join(tmpdir(), "cdna-empty-pool-"));
  try {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = "fallback-google-key";
    expect(resolveGeminiApiKey(undefined, { keyPoolDir: emptyPool })).toBe("fallback-google-key");
    delete process.env.GOOGLE_API_KEY;
    expect(() => resolveGeminiApiKey(undefined, { keyPoolDir: emptyPool })).toThrow(
      /no usable API key/i,
    );
  } finally {
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
    rmSync(emptyPool, { recursive: true, force: true });
  }

  const tmp = mkdtempSync(join(tmpdir(), "cdna-gapi-err-"));
  const mp4 = join(tmp, "clip.mp4");
  writeFileSync(mp4, "fake-mp4-bytes");
  try {
    const scenarios: Array<{
      name: string;
      statusState?: string;
      genResp?: () => Response;
      expectErr: RegExp;
    }> = [
      { name: "poll-failed", statusState: "FAILED", expectErr: /processing failed.*bad codec/i },
      {
        name: "blocked",
        genResp: () =>
          new Response(JSON.stringify({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }), {
            status: 200,
          }),
        expectErr: /blocked request: PROHIBITED_CONTENT/i,
      },
      {
        name: "thought-only",
        genResp: () =>
          new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "MAX_TOKENS",
                  content: { parts: [{ text: "thinking", thought: true }] },
                },
              ],
            }),
            { status: 200 },
          ),
        expectErr: /response truncated \(finishReason=MAX_TOKENS\)/i,
      },
      {
        name: "http-403",
        genResp: () =>
          new Response(
            JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "API key invalid" } }),
            { status: 403 },
          ),
        expectErr: /HTTP 403 PERMISSION_DENIED/i,
      },
    ];

    for (const sc of scenarios) {
      let deleted = false;
      let sawCleanModelUrl = false;
      const mockFetch = async (url: string, init?: RequestInit) => {
        if (url.endsWith("/upload/v1beta/files")) {
          return new Response("", {
            status: 200,
            headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/s2" },
          });
        }
        if (url === "https://generativelanguage.googleapis.com/upload/s2") {
          return new Response(
            JSON.stringify({
              file: { name: "files/f99", uri: "https://example/f99", state: "PROCESSING" },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/v1beta/files/f99") && (init?.method ?? "GET") === "GET") {
          return new Response(
            JSON.stringify({
              name: "files/f99",
              uri: "https://example/f99",
              state: sc.statusState ?? "ACTIVE",
              ...(sc.statusState === "FAILED" ? { error: { message: "bad codec" } } : {}),
            }),
            { status: 200 },
          );
        }
        if (url.includes(":generateContent")) {
          sawCleanModelUrl = url.includes("/v1beta/models/gemini-4-hydrogen:generateContent");
          return sc.genResp!();
        }
        if (url.endsWith("/v1beta/files/f99") && init?.method === "DELETE") {
          deleted = true;
          return new Response("{}", { status: 200 });
        }
        return new Response("not found", { status: 404 });
      };

      await expect(
        runGeminiApiVideo({
          videoPath: mp4,
          durationSec: 30,
          systemPrompt: "",
          userPrompt: "USR",
          model: "models/gemini-4-hydrogen",
          thinking: "High",
          media: "High",
          fps: 24,
          apiKey: "k",
          pollIntervalMs: 1,
          fetchImpl: mockFetch,
        }),
      ).rejects.toThrow(sc.expectErr);
      expect(deleted).toBe(true);
      if (sc.genResp) expect(sawCleanModelUrl).toBe(true);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("runMine exercises real gemini-api backend upfront auth guard, 403 halt, clean 24fps save, persistent AUDIO_UNAVAILABLE halt, and CLI --tabs/status checks", async () => {
  expect(isBotOrRateBlock("Gemini API generateContent failed: HTTP 403 PERMISSION_DENIED")).toBe(
    true,
  );
  expect(isBotOrRateBlock("HTTP 401 UNAUTHENTICATED: API key not valid")).toBe(true);
  expect(isMediaDowngradeError("incomplete media input: AUDIO_UNAVAILABLE")).toBe(true);
  expect(
    formatMineOutcome(
      "zack-d-films",
      { done: 0, failed: 0, quotaHalted: true, haltReason: "bot_or_auth", processed: [] },
      2,
      "gemini-api",
    ).nextLine,
  ).toContain("check Gemini API auth");
  expect(
    formatMineOutcome(
      "zack-d-films",
      { done: 0, failed: 0, quotaHalted: true, haltReason: "media_downgrade", processed: [] },
      2,
      "gemini-api",
    ).nextLine,
  ).not.toContain("wait for AI Studio fix");

  const dir = mkdtempSync(join(tmpdir(), "cdna-gapi-mine-"));
  const mp4 = join(dir, "sample.mp4");
  writeFileSync(mp4, "fake-mp4-bytes");
  try {
    const raw: RawCatalogVideo[] = [
      {
        id: "g1",
        title: "Vid 1 😱",
        url: "https://youtube.com/shorts/g1",
        views: 30_000_000,
        likes: 900_000,
        durationSec: 40,
        uploadDate: "20260901",
        playlistIndex: 0,
      },
      {
        id: "g2",
        title: "Vid 2 🤔",
        url: "https://youtube.com/shorts/g2",
        views: 10_000_000,
        likes: 300_000,
        durationSec: 40,
        uploadDate: "20260902",
        playlistIndex: 1,
      },
    ];
    writeJsonAtomic(join(dir, "catalog.json"), makeCatalog(raw));

    const prevG = process.env.GEMINI_API_KEY;
    const prevGoog = process.env.GOOGLE_API_KEY;
    let prepCalls = 0;
    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      await expect(
        runMine({
          channel: "gapi-test",
          corpusDir: dir,
          limit: 2,
          tabs: 1,
          backend: "gemini-api",
          keyPoolDir: join(dir, "empty-pool"),
          model: "gemini-4-hydrogen",
          thinking: "Extra High",
          media: "High",
          fps: 24,
          prepareMedia: async () => {
            prepCalls++;
            return { tcMp4: mp4, hasAudioStream: true, durationSec: 40, sourceFps: 30 };
          },
        }),
      ).rejects.toThrow(/no usable API key/i);
      expect(prepCalls).toBe(0);
    } finally {
      if (prevG === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevG;
      if (prevGoog === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = prevGoog;
    }

    const authHaltRes = await runMine({
      channel: "gapi-test",
      corpusDir: dir,
      limit: 2,
      tabs: 1,
      backend: "gemini-api",
      apiKey: "bad-key",
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      prepareMedia: async () => ({
        tcMp4: mp4,
        hasAudioStream: true,
        durationSec: 40,
        sourceFps: 30,
      }),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "bad key" } }),
          {
            status: 403,
          },
        ),
    });
    expect(authHaltRes.done).toBe(0);
    expect(authHaltRes.failed).toBe(0);
    expect(authHaltRes.quotaHalted).toBe(true);
    expect(authHaltRes.haltReason).toBe("bot_or_auth");
    expect(loadCheckpoint(dir, "gapi-test").failedCount).toBe(0);

    const goodMd = makeSampleDossier(makeSampleV3Telemetry());
    const okGapiRes = await runMine({
      channel: "gapi-test",
      corpusDir: dir,
      limit: 1,
      tabs: 1,
      backend: "gemini-api",
      apiKey: "good-key",
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      ids: ["g1"],
      prepareMedia: async () => ({
        tcMp4: mp4,
        hasAudioStream: true,
        durationSec: 40,
        sourceFps: 30,
      }),
      fetchImpl: async (url, init) => {
        if (url.endsWith("/upload/v1beta/files")) {
          return new Response("", {
            status: 200,
            headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/ok" },
          });
        }
        if (url === "https://generativelanguage.googleapis.com/upload/ok") {
          return new Response(
            JSON.stringify({
              file: { name: "files/ok1", uri: "https://example/ok1", state: "ACTIVE" },
            }),
            { status: 200 },
          );
        }
        if (url.includes(":generateContent")) {
          return new Response(
            JSON.stringify({
              candidates: [{ finishReason: "STOP", content: { parts: [{ text: goodMd }] } }],
              usageMetadata: {
                promptTokenCount: 270_000,
                candidatesTokenCount: 1500,
                promptTokensDetails: [
                  { modality: "VIDEO", tokenCount: 268_800 },
                  { modality: "AUDIO", tokenCount: 1000 },
                ],
              },
            }),
            { status: 200 },
          );
        }
        if (init?.method === "DELETE") return new Response("{}", { status: 200 });
        return new Response("not found", { status: 404 });
      },
    });
    expect(okGapiRes.done).toBe(1);
    expect(okGapiRes.failed).toBe(0);
    expect(existsSync(join(dir, "videos", "g1", "dossier.md"))).toBe(true);

    const audioHalt = await runMine({
      channel: "gapi-test",
      corpusDir: dir,
      limit: 1,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      ids: ["g2"],
      runVideo: async () => ({
        ok: true,
        markdown: "INPUT_INCOMPLETE: AUDIO_UNAVAILABLE",
        hasAudioStream: true,
      }),
    });
    expect(audioHalt.done).toBe(0);
    expect(audioHalt.failed).toBe(0);
    expect(audioHalt.quotaHalted).toBe(true);
    expect(audioHalt.haltReason).toBe("media_downgrade");

    const aiTabs3 = spawnSync(
      "bun",
      [
        CLI_PATH,
        "mine",
        "--channel",
        "gapi-test",
        "--backend",
        "aistudio",
        "--tabs",
        "3",
        "--corpus",
        dir,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(aiTabs3.status).toBe(2);

    const gapiTabs5 = spawnSync(
      "bun",
      [
        CLI_PATH,
        "mine",
        "--channel",
        "gapi-test",
        "--backend",
        "gemini-api",
        "--tabs",
        "5",
        "--corpus",
        dir,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(gapiTabs5.status).toBe(2);

    const badThinking = spawnSync(
      "bun",
      [
        CLI_PATH,
        "mine",
        "--channel",
        "gapi-test",
        "--backend",
        "gemini-api",
        "--thinking",
        "bogus",
        "--corpus",
        dir,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(badThinking.status).toBe(2);

    const v1Dir = join(dir, "videos", "g2");
    mkdirSync(v1Dir, { recursive: true });
    writeJsonAtomic(join(v1Dir, "telemetry.json"), makeSampleTelemetry({ schema_version: 1 }));
    writeJsonAtomic(join(v1Dir, "meta.json"), { id: "g2" });
    const mixedStatus = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "gapi-test", "--corpus", dir],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(mixedStatus.status).toBe(0);
    expect(mixedStatus.stdout).toContain("aggregate --channel gapi-test --min-schema 2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

test("parseAndValidateDossier catches split-markdown INPUT_INCOMPLETE sentinels", () => {
  for (const sample of [
    "**INPUT_INCOMPLETE:** VIDEO_SAMPLING_TOO_SPARSE",
    "**INPUT_INCOMPLETE**: VIDEO_SAMPLING_TOO_SPARSE",
  ]) {
    const res = parseAndValidateDossier(sample, { expectedFps: 24 });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("VIDEO_SAMPLING_TOO_SPARSE"))).toBe(true);
  }

  const backtickCode = parseAndValidateDossier("INPUT_INCOMPLETE: `AUDIO_UNAVAILABLE`", {
    expectAudio: true,
  });
  expect(backtickCode.valid).toBe(false);
  expect(backtickCode.errors.some((e) => e.includes("AUDIO_UNAVAILABLE"))).toBe(true);
});

test("verifyGeminiApiVideoTokens rejects zero VIDEO modality entries even when promptTokens exceed floor", () => {
  const err = verifyGeminiApiVideoTokens({
    durationSec: 10,
    fps: 10,
    media: "Low",
    expectAudio: true,
    hasModalityDetails: true,
    promptTokens: 5_500,
    videoTokens: null,
    audioTokens: 1_000,
  });
  expect(err).not.toBeNull();
  expect(err!).toContain("0 VIDEO tokens");

  const noDetailsFallback = verifyGeminiApiVideoTokens({
    durationSec: 10,
    fps: 10,
    media: "Low",
    expectAudio: false,
    hasModalityDetails: false,
    promptTokens: 5_500,
    videoTokens: null,
    audioTokens: null,
  });
  expect(noDetailsFallback).toBeNull();
});

test("runGeminiApiVideo rejects non-HTTPS upload URLs and deletes files that finalize as FAILED", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-gapi-err-"));
  try {
    const fakeMp4 = join(tmp, "sample.mp4");
    writeFileSync(fakeMp4, "0000", "utf8");

    for (const badUploadUrl of ["http://insecure.example/upload", "https://evil.example/upload"]) {
      await expect(
        runGeminiApiVideo({
          videoPath: fakeMp4,
          durationSec: 10,
          systemPrompt: "sys",
          userPrompt: "usr",
          model: "gemini-4-hydrogen",
          thinking: "Extra High",
          media: "High",
          fps: 24,
          apiKey: "test-key",
          pollIntervalMs: 1,
          fetchImpl: async () =>
            new Response("", {
              status: 200,
              headers: { "x-goog-upload-url": badUploadUrl },
            }),
        }),
      ).rejects.toThrow(/https googleapis x-goog-upload-url/i);
    }

    const methods: string[] = [];
    await expect(
      runGeminiApiVideo({
        videoPath: fakeMp4,
        durationSec: 10,
        systemPrompt: "sys",
        userPrompt: "usr",
        model: "gemini-4-hydrogen",
        thinking: "Extra High",
        media: "High",
        fps: 24,
        apiKey: "test-key",
        pollIntervalMs: 1,
        fetchImpl: async (url, init) => {
          methods.push(`${init?.method ?? "GET"} ${url}`);
          if (url.endsWith("/upload/v1beta/files")) {
            return new Response("", {
              status: 200,
              headers: {
                "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/resumable",
              },
            });
          }
          if (url === "https://generativelanguage.googleapis.com/upload/resumable") {
            return new Response(
              JSON.stringify({
                file: {
                  name: "files/failed-1",
                  state: "FAILED",
                  error: { message: "corrupt mp4 container" },
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (init?.method === "DELETE") {
            return new Response("{}", { status: 200 });
          }
          throw new Error(`unexpected request: ${url}`);
        },
      }),
    ).rejects.toThrow(/corrupt mp4 container/i);
    expect(
      methods.some(
        (m) => m === "DELETE https://generativelanguage.googleapis.com/v1beta/files/failed-1",
      ),
    ).toBe(true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("cli mine rejects invalid --media on aistudio, empty --model/--thinking, and isQuotaError matches RESOURCE_EXHAUSTED", () => {
  expect(
    isQuotaError("Gemini API generateContent failed: HTTP 429 RESOURCE_EXHAUSTED: limit"),
  ).toBe(true);
  const badCases: string[][] = [
    ["mine", "--channel", "demo", "--backend", "aistudio", "--media", "Hig"],
    ["mine", "--channel", "demo", "--model", "   "],
    ["mine", "--channel", "demo", "--thinking", ""],
  ];
  for (const args of badCases) {
    const res = spawnSync("bun", [CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(res.status).toBe(2);
  }
}, 20_000);

test("parseAndValidateDossier catches underscore-wrapped INPUT_INCOMPLETE sentinels without matching identifier prefixes", () => {
  const validDossier = makeSampleDossier(makeSampleTelemetry());
  for (const sample of [
    "_INPUT_INCOMPLETE: VIDEO_SAMPLING_TOO_SPARSE_",
    "_INPUT_INCOMPLETE_: VIDEO_SAMPLING_TOO_SPARSE",
    "INPUT_INCOMPLETE: _AUDIO_UNAVAILABLE_",
    "__INPUT_INCOMPLETE__: __AUDIO_UNAVAILABLE__",
    "**INPUT_INCOMPLETE:** **VIDEO_SAMPLING_TOO_SPARSE**",
    "`INPUT_INCOMPLETE:` `AUDIO_UNAVAILABLE`",
    `_INPUT_INCOMPLETE: VIDEO_SAMPLING_TOO_SPARSE_\n\n${validDossier}`,
  ]) {
    const res = parseAndValidateDossier(sample, { expectedFps: 24, expectAudio: true });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.startsWith("incomplete media input:"))).toBe(true);
  }

  const nonSentinelPrefix = parseAndValidateDossier(
    `FOO_INPUT_INCOMPLETE: AUDIO_UNAVAILABLE\n\n${validDossier}`,
    { expectedFps: 24, expectAudio: true },
  );
  expect(nonSentinelPrefix.errors.some((e) => e.startsWith("incomplete media input:"))).toBe(false);
});

test("normalizeMediaLabel canonicalizes case/unspecified and buildAskNewArgs wires canonical --media and --min-in-tokens", () => {
  expect(normalizeMediaLabel("high")).toBe("High");
  expect(normalizeMediaLabel("LOW")).toBe("Low");
  expect(normalizeMediaLabel("medium")).toBe("Medium");
  expect(normalizeMediaLabel("unspecified")).toBe("Default");

  const args = buildAskNewArgs({
    tcMp4: "/tmp/clip_tc.mp4",
    userPrompt: "Analyze",
    tab: "cdna1",
    model: "gemini-4-hydrogen",
    thinking: "Extra High",
    media: "high",
    fps: 24,
    systemFile: "/tmp/sys.md",
    outMd: "/tmp/out.md",
    minInTokens: 90_720,
  });
  expect(args[args.indexOf("--media") + 1]).toBe("High");
  expect(args[args.indexOf("--min-in-tokens") + 1]).toBe("90720");

  const argsNoFloor = buildAskNewArgs({
    tcMp4: "/tmp/clip_tc.mp4",
    userPrompt: "Analyze",
    tab: "cdna1",
    model: "gemini-4-hydrogen",
    thinking: "Extra High",
    media: "unspecified",
    fps: 24,
    systemFile: "/tmp/sys.md",
    outMd: "/tmp/out.md",
    minInTokens: 0,
  });
  expect(argsNoFloor[argsNoFloor.indexOf("--media") + 1]).toBe("Default");
  expect(argsNoFloor.includes("--min-in-tokens")).toBe(false);
});

test("resolveGeminiApiKey falls back across blank GEMINI_API_KEY and formatMineOutcome preserves backend and schema flags on halts", () => {
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const emptyPool = mkdtempSync(join(tmpdir(), "cdna-blank-pool-"));
  try {
    process.env.GEMINI_API_KEY = "   ";
    process.env.GOOGLE_API_KEY = "fallback-google-key";
    expect(resolveGeminiApiKey(undefined, { keyPoolDir: emptyPool })).toBe("fallback-google-key");
  } finally {
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
    rmSync(emptyPool, { recursive: true, force: true });
  }

  const quotaOutcome = formatMineOutcome(
    "demo",
    { done: 0, failed: 0, quotaHalted: true, haltReason: "quota", processed: [] },
    2,
    "gemini-api",
  );
  expect(quotaOutcome.exitCode).toBe(1);
  expect(quotaOutcome.nextLine).toContain("--backend gemini-api");
  expect(quotaOutcome.nextLine).toContain("--min-schema 2");
  expect(expectedVideoTokensFloor(10, Number.NaN, "High")).toBe(0);
});

test("runMine clamps effectiveFps from sourceFps so genuinely low-fps source clips do not falsely trigger 24fps bracket rejection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cdna-lowfps-src-"));
  const mp4 = join(dir, "lowfps.mp4");
  writeFileSync(mp4, "fake-mp4-bytes", "utf8");
  try {
    const raw: RawCatalogVideo[] = [
      {
        id: "lf1",
        title: "Low FPS Animation 😱",
        url: "https://youtube.com/shorts/lf1",
        views: 20_000_000,
        likes: 500_000,
        durationSec: 40,
        uploadDate: "20260901",
        playlistIndex: 0,
      },
    ];
    writeJsonAtomic(join(dir, "catalog.json"), makeCatalog(raw));
    const wideBracketDossier = makeSampleDossier(makeSampleV3Telemetry()).replace(
      /Continuous \[NO CUT\]/g,
      "Continuous [NO CUT] (f14->f44)",
    );
    expect(
      parseAndValidateDossier(wideBracketDossier, { expectedFps: 24, expectAudio: true }).valid,
    ).toBe(false);

    let capturedPrompt = "";
    let capturedVideoMetaFps: number | undefined;
    const res = await runMine({
      channel: "lowfps-test",
      corpusDir: dir,
      limit: 1,
      tabs: 1,
      backend: "gemini-api",
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      apiKey: "test-key",
      prepareMedia: async () => ({
        tcMp4: mp4,
        hasAudioStream: true,
        durationSec: 40,
        sourceFps: 6,
      }),
      fetchImpl: async (url, init) => {
        if (url.endsWith("/upload/v1beta/files")) {
          return new Response("", {
            status: 200,
            headers: {
              "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/lf1",
            },
          });
        }
        if (url === "https://generativelanguage.googleapis.com/upload/lf1") {
          return new Response(
            JSON.stringify({
              file: {
                name: "files/lf1",
                uri: "https://generativelanguage.googleapis.com/v1beta/files/lf1",
                state: "ACTIVE",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes(":generateContent")) {
          const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
            contents?: Array<{
              parts?: Array<{ text?: string; videoMetadata?: { fps?: number } }>;
            }>;
          };
          capturedVideoMetaFps = body.contents?.[0]?.parts?.[0]?.videoMetadata?.fps;
          capturedPrompt = body.contents?.[0]?.parts?.[1]?.text ?? "";
          return new Response(
            JSON.stringify({
              candidates: [
                { finishReason: "STOP", content: { parts: [{ text: wideBracketDossier }] } },
              ],
              usageMetadata: {
                promptTokenCount: 68_000,
                candidatesTokenCount: 1_200,
                promptTokensDetails: [
                  { modality: "VIDEO", tokenCount: 67_200 },
                  { modality: "AUDIO", tokenCount: 1_000 },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (init?.method === "DELETE") {
          return new Response("{}", { status: 200 });
        }
        throw new Error(`unexpected request: ${url}`);
      },
    });
    expect(res.done).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.haltReason).toBe("none");
    expect(capturedVideoMetaFps).toBe(6);
    expect(capturedPrompt).toContain("Expected sampling: 6 FPS.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runGeminiApiVideo retries transient 503 UNAVAILABLE without re-uploading the File API resource", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-gapi-503-"));
  const mp4 = join(tmp, "clip.mp4");
  writeFileSync(mp4, "0000", "utf8");
  try {
    let uploads = 0;
    let genCalls = 0;
    let deleted = false;
    const res = await runGeminiApiVideo({
      videoPath: mp4,
      durationSec: 2,
      sourceFps: 24,
      expectAudio: true,
      systemPrompt: "",
      userPrompt: "describe",
      model: "gemini-4-hydrogen",
      thinking: "Low",
      media: "High",
      fps: 24,
      apiKey: "test-key",
      pollIntervalMs: 1,
      retryBaseMs: 1,
      fetchImpl: async (url, init) => {
        if (url.endsWith("/upload/v1beta/files")) {
          uploads++;
          return new Response("", {
            status: 200,
            headers: {
              "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/r503",
            },
          });
        }
        if (url === "https://generativelanguage.googleapis.com/upload/r503") {
          return new Response(
            JSON.stringify({
              file: {
                name: "files/r503",
                uri: "https://generativelanguage.googleapis.com/v1beta/files/r503",
                state: "ACTIVE",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes(":generateContent")) {
          genCalls++;
          if (genCalls === 1) {
            return new Response(
              JSON.stringify({ error: { status: "UNAVAILABLE", message: "high demand" } }),
              { status: 503 },
            );
          }
          return new Response(
            JSON.stringify({
              candidates: [{ finishReason: "STOP", content: { parts: [{ text: "2s ok" }] } }],
              usageMetadata: {
                promptTokenCount: 13_334,
                candidatesTokenCount: 12,
                promptTokensDetails: [
                  { modality: "TEXT", tokenCount: 162 },
                  { modality: "VIDEO", tokenCount: 13_172 },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (init?.method === "DELETE") {
          deleted = true;
          return new Response("{}", { status: 200 });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    expect(res.markdown).toBe("2s ok");
    expect(res.videoTokens).toBe(13_172);
    expect(uploads).toBe(1);
    expect(genCalls).toBe(2);
    expect(deleted).toBe(true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function makeSampleV3Telemetry(overrides: Partial<VideoTelemetry> = {}): VideoTelemetry {
  return {
    ...makeSampleV2Telemetry(),
    schema_version: 3,
    acting_mode: "subtle_realistic",
    set_architecture: "full_bounded_environment",
    visual_layer_format: "single_full_frame",
    stakes_engine: "curiosity_or_intellectual_mystery",
    camera_motion_persistence: "continuous_drifting",
    camera_velocity_profile: "smooth_ease_in_out",
    framing_anchor: "upper_third_head_or_subject",
    bgm_twist_behavior: "drop_or_cut_to_silence",
    bgm_ending_behavior: "clean_fade_or_tail",
    ending_valence: "ironic_or_comedic",
    title_hook_relation: "spoken_and_visual_mirror",
    opening_scroll_stop_state: "visual_anomaly_or_reveal",
    open_loop_payoff_timing: "late_climax_final_quarter",
    vo_visual_relation: "causal_or_context_complement",
    narrative_timeline: "linear_forward",
    open_loop_architecture: "escalating_chain_stakes",
    information_reveal_mode: "progressive_withhold_reveal",
    thumbnail_archetype: "not_applicable_shorts_feed",
    thumbnail_text_relation: "not_applicable",
    thumbnail_opening_payoff: "not_applicable",
    thumbnail_focal_complexity: "not_applicable",
    thumbnail_gaze_or_cue: "not_applicable",
    sfx_layers_used: ["whoosh_or_transition", "diegetic_foley_or_ambience"],
    time_remap_types: ["none"],
    craft_signals: {
      ...makeSampleV2Telemetry().craft_signals,
      has_expressive_facial_or_gesture_acting: true,
      has_fg_parallax_or_ots: false,
      has_archival_or_real_footage: false,
      has_direct_camera_address: false,
      has_unspoken_visual_subtext: false,
      has_setup_payoff_callback: true,
      has_match_cut: false,
    },
    ...overrides,
  };
}

test("countTitleWords strips parenthetical tags, isCorruptTranscript filters broken ASR, fisherExactTwoSided matches exact probability, and adaptive durationBands handle longform", () => {
  expect(countTitleWords("The Bathroom Mode 😏 (Patent Pending)")).toBe(3);
  expect(countTitleWords("Crazy Trick 😱 [Part 2] #shorts")).toBe(2);
  expect(classifyEmojiValence("😱")).toBe("high_arousal_shock");
  expect(classifyEmojiValence("🤔")).toBe("curiosity_skeptic");
  expect(classifyEmojiValence("NONE")).toBe("none");
  expect(
    countSharedContentWords("Why Bridges Collapse 😱", "If a steel bridge bends, it fails."),
  ).toBe(1);
  expect(countSharedContentWords("Why Bridges Collapse 😱", "Imagine walking down a street.")).toBe(
    0,
  );

  expect(
    isCorruptTranscript({
      transcriptText: "it sliced his feet. But from his side,",
      wordCount: 31,
      wpm: 43.3,
      durationSec: 43,
    }),
  ).toBe(true);
  expect(
    isCorruptTranscript({
      transcriptText: "You feel it shake. He ran fast.",
      wordCount: 7,
      wpm: 150,
      durationSec: 40,
    }),
  ).toBe(false);

  expect(fisherExactTwoSided(8, 0, 2, 10)).toBeCloseTo(0.0007, 4);
  expect(fisherExactTwoSided(5, 5, 5, 5)).toBe(1);

  const longformCatalog = makeCatalog([
    {
      id: "lf1",
      title: "How Airplanes Really Fly: Deep Dive",
      url: "https://www.youtube.com/watch?v=lf1",
      playlistIndex: 5,
      views: 5_000_000,
      likes: 200_000,
      durationSec: 900,
      uploadDate: "20260701",
      transcriptText:
        "You see, lift happens when wings bend airflow downward, creating pressure change. But most textbooks get this wrong.",
      wordCount: 2100,
      wpm: 140,
    },
    {
      id: "lf2",
      title: "Why Trains Stay On Tracks",
      url: "https://www.youtube.com/watch?v=lf2",
      playlistIndex: 4,
      views: 1_500_000,
      likes: 60_000,
      durationSec: 420,
      uploadDate: "20260702",
      transcriptText:
        "Conical wheels self-center automatically as the train turns. So derailments stay rare.",
      wordCount: 1100,
      wpm: 157,
    },
    {
      id: "lf3",
      title: "Broken Caption Essay",
      url: "https://www.youtube.com/watch?v=lf3",
      playlistIndex: 3,
      views: 400_000,
      likes: 10_000,
      durationSec: 700,
      uploadDate: "20260703",
      transcriptText: "corrupt stub ending,",
      wordCount: 25,
      wpm: 40,
    },
  ]);

  const stats = aggregateCorpus(longformCatalog, []);
  expect(stats.catalogTelemetry.packaging.durationFormatMode).toBe("longform");
  expect(stats.catalogTelemetry.packaging.durationBands.some((b) => b.band === "10-19m")).toBe(
    true,
  );
  expect(stats.catalogTelemetry.packaging.excludedCorruptWpmCount).toBe(1);
  expect(stats.catalogTelemetry.packaging.wpmSampleN).toBe(2);
  expect(stats.catalogTelemetry.linguistics.excludedCorruptCount).toBe(1);
  expect(stats.catalogTelemetry.linguistics.pronounProfilePct).toBeNull();
  expect(stats.catalogTelemetry.linguistics.englishProfile?.flashbackRewindMarkerPct).toBe(50);
  expect(stats.catalogTelemetry.linguistics.englishProfile?.participleConsequenceVideoPct).toBe(50);
  expect(stats.catalogTelemetry.linguistics.englishProfile?.formalTransitionVideoPct).toBe(0);

  const md = renderStatsSummaryMd(stats);
  expect(md).toContain("Trailing emoji tables omitted (<5% prevalence on this channel).");
  expect(md).not.toMatch(/\*\*|`/);
});

test("parseSection3Shots, shotSpine, videoLevel boundaries, withinBucketContrasts, and Flop digest guard cluster bias and empty weaknesses", () => {
  const catalog = makeCatalog([
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `w${i}`,
      title: `Bridge Secret ${i} 😱`,
      url: `https://www.youtube.com/shorts/w${i}`,
      playlistIndex: 20 - i,
      views: 40_000_000 - i * 1_000_000,
      likes: 100_000,
      durationSec: 40,
      uploadDate: `2026070${i + 1}`,
    })),
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `m${i}`,
      title: `Bridge Mid ${i}`,
      url: `https://www.youtube.com/shorts/m${i}`,
      playlistIndex: 17 - i,
      views: 10_000_000,
      likes: 50_000,
      durationSec: 40,
      uploadDate: `202607${String(i + 4).padStart(2, "0")}`,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `f${i}`,
      title: `Bridge Plain ${i}`,
      url: `https://www.youtube.com/shorts/f${i}`,
      playlistIndex: 8 - i,
      views: 1_000_000 + i * 100_000,
      likes: 10_000,
      durationSec: 40,
      uploadDate: `202607${String(i + 15).padStart(2, "0")}`,
    })),
  ]);

  const winDossierRows = [
    "| S01 | 00:00.000-00:04.000 (f0-f120) | Opening | M / eye | Opens on bridge `[Camera, Framing & Staging]` | High |",
    "| S02 | 00:04.000-00:18.000 (f120-f540) | Continuous [NO CUT] (dolly) | W / high | Pulls wide `[Camera, Framing & Staging]` | High |",
    "| S03 | 00:18.000-00:28.000 (f540-f840) | Transition (card_flip, f540-f546) | CU / eye | Card flip `[Transitions & Continuity]` | High |",
    "| S04 | 00:28.000-00:34.000 (f840-f1020) | Hidden Cut (whip-pan smear) | ECU / low | Whip swap `[Transitions & Continuity]` | High |",
    "| S05 | 00:34.000-00:40.000 (f1020-f1200) | Transition (push_up, f1020-f1028) | MCU / eye | Reaction close `[Transitions & Continuity]` | High |",
  ];
  const winTel = makeSampleV2Telemetry({
    topic_category: "explainer_how_it_works",
    boundary_counts: { hard_cut: 0, hidden_cut: 1, transition: 2, continuous: 1 },
    transition_types: ["card_flip", "push_up"],
    shot_scale_counts: { EW: 0, W: 1, M: 1, MCU: 1, CU: 1, ECU: 1, INSERT: 0 },
    camera_angle_counts: { aerial: 0, overhead: 0, high: 1, eye: 3, low: 1, ground: 0 },
  });
  const winMd = makeSampleDossier(winTel, winDossierRows);
  const parsedWin = parseSection3Shots(winMd);
  expect(parsedWin.inferredFps).toBe(30);
  expect(parsedWin.shots).toHaveLength(5);
  expect(parsedWin.shots[2]!.transitionType).toBe("card_flip");
  expect(parsedWin.shots[2]!.transitionFrames).toBe(6);

  const flopClusterTel = makeSampleV2Telemetry({
    topic_category: "explainer_how_it_works",
    boundary_counts: { hard_cut: 16, hidden_cut: 0, transition: 0, continuous: 0 },
    transition_types: [],
    weaknesses_or_drag: [],
    secret_sauce_cues: ["positive cue that must never appear as flop drag"],
  });
  const flopOneTakeTel = makeSampleV2Telemetry({
    topic_category: "explainer_how_it_works",
    boundary_counts: { hard_cut: 0, hidden_cut: 0, transition: 0, continuous: 4 },
    transition_types: [],
    weaknesses_or_drag: ["slow static middle"],
  });

  const records: MinedRecord[] = [
    { ...makeRecord("w0", "winner", 4.0, winTel), dossierMarkdown: winMd },
    { ...makeRecord("w1", "winner", 3.5, winTel), dossierMarkdown: winMd },
    { ...makeRecord("w2", "winner", 3.0, winTel), dossierMarkdown: winMd },
    makeRecord("f0", "flop", 0.2, flopClusterTel),
    makeRecord("f1", "flop", 0.3, flopOneTakeTel),
    makeRecord("f2", "flop", 0.4, flopOneTakeTel),
  ];

  const stats = aggregateCorpus(catalog, records);
  expect(stats.statsVersion).toBe(CURRENT_STATS_VERSION);
  expect(stats.deepDna.boundaries.videoLevel.hard_cut!.flopPrevalencePct).toBe(33.3);
  expect(stats.deepDna.boundaries.editArchitecture.hardCutsMax1.winnerPct).toBe(100);
  expect(
    stats.deepDna.boundaries.editArchitecture.hasDynamicMotionTransition.winnerMinusFlopPp,
  ).toBe(100);
  expect(stats.deepDna.shotSpine.parsedVideoCount).toBe(3);
  expect(stats.deepDna.shotSpine.transitionSpans[0]!.medianFrames).toBe(6);
  expect(stats.deepDna.shotSpine.transitionSpans[0]!.medianSec).toBe(0.2);
  expect(stats.deepDna.shotSpine.hiddenCutMechanisms[0]!.mechanism).toBe("whip_pan_smear");
  expect(stats.deepDna.shotSpine.openingVsClosing.closingScale.winner[0]!.key).toBe("MCU");
  expect(
    stats.deepDna.withinBucketContrasts.some((c) => c.feature === "transition:card_flip"),
  ).toBe(true);

  const md = renderStatsSummaryMd(stats);
  expect(md).toContain("Drag: none logged (see dossier)");
  expect(md).not.toContain("positive cue that must never appear as flop drag");
  expect(md).toContain("Section 3 Shot Spine, Transition Spans & Pacing Curve");
  expect(md).toContain("Within-Bucket Winner vs Flop Contrasts");
  expect(md).not.toMatch(/\*\*|`/);
});

test("schema_version 3 validates extended fields, coherence warnings, v3DeepDna aggregation, and parseAudioLoudnessStderr", () => {
  const okV3 = parseAndValidateDossier(makeSampleDossier(makeSampleV3Telemetry()));
  expect(okV3.valid, okV3.errors.join("; ")).toBe(true);
  expect(okV3.warnings).toEqual([]);

  const badV3 = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV3Telemetry({ acting_mode: "bogus" as never, sfx_layers_used: [] }),
    ),
  );
  expect(badV3.valid).toBe(false);
  expect(badV3.errors.some((e) => e.includes("invalid acting_mode"))).toBe(true);
  expect(badV3.errors.some((e) => e.includes("sfx_layers_used"))).toBe(true);

  const warnV3 = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV3Telemetry({
        time_remap_types: ["slow_motion"],
        craft_signals: {
          ...makeSampleV3Telemetry().craft_signals,
          has_time_remap_or_hit_stop: false,
        },
      }),
    ),
  );
  expect(warnV3.valid).toBe(true);
  expect(warnV3.warnings.some((w) => w.includes("time_remap_types"))).toBe(true);

  const loudness = parseAudioLoudnessStderr(
    "[silencedetect @ 0x1] silence_duration: 0.45\n[silencedetect @ 0x1] silence_duration: 0.55\nSummary:\n  Integrated loudness:\n    I:         -13.8 LUFS\n  Loudness range:\n    LRA:         4.6 LU\n  True peak:\n    Peak:       -0.8 dBFS\n",
  );
  expect(loudness).toEqual({
    integratedLufs: -13.8,
    loudnessRangeLu: 4.6,
    truePeakDbtp: -0.8,
    maxShortTermLufs: null,
    maxMomentaryLufs: null,
    plrDb: 13,
    climaxLoudnessDeltaLu: null,
    relativeDropCount: null,
    isSilentTrack: false,
    silenceCount: 2,
    totalSilenceSec: 1,
  });

  const cat = makeCatalog([
    {
      id: "v3a",
      title: "V3 Winner 😱",
      url: "https://www.youtube.com/shorts/v3a",
      playlistIndex: 10,
      views: 30_000_000,
      likes: 1_000_000,
      durationSec: 40,
      uploadDate: "20260701",
    },
  ]);
  const rec = makeRecord("v3a", "winner", 3.2, makeSampleV3Telemetry());
  rec.meta.audioMetrics = loudness;
  const stats = aggregateCorpus(cat, [rec]);
  expect(stats.deepDna.v2DeepDna.v2Count).toBe(1);
  expect(stats.deepDna.v3DeepDna.v3Count).toBe(1);
  expect(stats.deepDna.v3DeepDna.audioLoudnessSummary.medianIntegratedLufs).toBe(-13.8);
  expect(renderStatsSummaryMd(stats)).toContain("V3 Extended Craft Profiles");
});

test("selectTranscriptTargets prioritizes mined/queued mature IDs, computeOutlierScores partitions mixed formats, and runMine tolerates single isolated >=45s AUDIO_UNAVAILABLE", async () => {
  const pool: RawCatalogVideo[] = [
    {
      id: "young1",
      title: "Young",
      url: "https://youtube.com/shorts/young1",
      playlistIndex: 0,
      views: 9_000_000,
      likes: null,
      durationSec: 35,
      uploadDate: "20261120",
    },
    {
      id: "matA",
      title: "Mat A",
      url: "https://youtube.com/shorts/matA",
      playlistIndex: 20,
      views: 2_000_000,
      likes: null,
      durationSec: 35,
      uploadDate: "20260801",
    },
    {
      id: "matMined",
      title: "Mat Mined",
      url: "https://youtube.com/shorts/matMined",
      playlistIndex: 21,
      views: 1_000_000,
      likes: null,
      durationSec: 35,
      uploadDate: "20260802",
    },
  ];
  const prio = selectTranscriptTargets(pool, 2, "2026-11-23", {
    priorityIds: ["matMined"],
    matureOnly: true,
  });
  expect(prio.map((v) => v.id)).toEqual(["matMined", "matA"]);

  const mixedFmt: RawCatalogVideo[] = [
    ...[10_000_000, 10_000_000, 10_000_000, 20_000_000].map((views, i) => ({
      id: `s${i}`,
      title: `Short ${i}`,
      url: `https://youtube.com/shorts/s${i}`,
      playlistIndex: i,
      views,
      likes: null,
      durationSec: 40,
      uploadDate: `2026080${i + 1}`,
    })),
    ...[1_000_000, 1_000_000, 1_000_000, 2_000_000].map((views, i) => ({
      id: `l${i}`,
      title: `Long ${i}`,
      url: `https://youtube.com/watch?v=l${i}`,
      playlistIndex: i + 4,
      views,
      likes: null,
      durationSec: 900,
      uploadDate: `2026080${i + 5}`,
    })),
  ];
  const scoredMixed = computeOutlierScores(mixedFmt, "2026-11-23");
  const byId = new Map(scoredMixed.videos.map((v) => [v.id, v]));
  expect(byId.get("l3")!.outlierRolling).toBe(2);
  expect(byId.get("s3")!.outlierRolling).toBe(2);
  expect(
    buildStratifiedQueue(scoredMixed.videos, new Set(), {
      minDurationSec: 300,
      maxDurationSec: 1800,
    }),
  ).toHaveLength(4);

  const tmp = mkdtempSync(join(tmpdir(), "cdna-long-aud-"));
  try {
    const cat = makeCatalog([
      {
        id: "longBad1",
        title: "Long Bad 1",
        url: "https://youtube.com/shorts/longBad1",
        playlistIndex: 10,
        views: 20_000_000,
        likes: 400_000,
        durationSec: 55,
        uploadDate: "20260801",
      },
      {
        id: "longGood2",
        title: "Long Good 2",
        url: "https://youtube.com/shorts/longGood2",
        playlistIndex: 11,
        views: 18_000_000,
        likes: 350_000,
        durationSec: 52,
        uploadDate: "20260802",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    const res = await runMine({
      channel: "demo-ch",
      corpusDir: tmp,
      limit: 2,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      ids: ["longBad1", "longGood2"],
      runVideo: async (vid) =>
        vid.id === "longBad1"
          ? { ok: true, markdown: "INPUT_INCOMPLETE: AUDIO_UNAVAILABLE", hasAudioStream: true }
          : {
              ok: true,
              markdown: makeSampleDossier(makeSampleV3Telemetry()),
              hasAudioStream: true,
            },
    });
    expect(res.done).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.quotaHalted).toBe(false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("longform saveCheckpoint and selectMineTargets preserve >185s queues and support --min-schema 3 upgrades", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-longform-queue-"));
  try {
    const videos: RawCatalogVideo[] = Array.from({ length: 6 }, (_, i) => ({
      id: `lf_vid_${i}`,
      title: `Longform Essay ${i}`,
      url: `https://www.youtube.com/watch?v=lf_vid_${i}`,
      playlistIndex: i,
      views: 1_000_000 + i * 250_000,
      likes: 40_000,
      durationSec: 720 + i * 60,
      uploadDate: `2026070${i + 1}`,
    }));
    const cat: CatalogFile = {
      ...makeCatalog(videos),
      sourceUrl: "https://www.youtube.com/@essay/videos",
      queueFilter: { minDurationSec: 10, maxDurationSec: 3600 },
    };
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    expect(resolveQueueDurationOpts({ sourceUrl: cat.sourceUrl })).toEqual({
      minDurationSec: 10,
      maxDurationSec: 3600,
    });
    expect(resolveQueueDurationOpts({ sourceUrl: "https://www.youtube.com/@sh/shorts" })).toEqual({
      minDurationSec: 10,
      maxDurationSec: 185,
    });

    const firstPass = await runMine({
      channel: "essay",
      corpusDir: tmp,
      limit: 1,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      minSchema: 2,
      runVideo: async () => ({
        ok: true,
        markdown: makeSampleDossier(makeSampleV2Telemetry({ duration_sec: 720 })),
        hasAudioStream: true,
      }),
    });
    expect(firstPass.done).toBe(1);

    const queueAfter = JSON.parse(readFileSync(join(tmp, "queue.json"), "utf8")) as {
      remainingCount: number;
      minDurationSec: number;
      maxDurationSec: number;
      queue: string[];
    };
    expect(queueAfter.remainingCount).toBe(5);
    expect(queueAfter.maxDurationSec).toBe(3600);
    expect(queueAfter.queue).toHaveLength(5);

    const ck = loadCheckpoint(tmp, "essay");
    const upgradeTargets = selectMineTargets(cat, ck, tmp, { limit: 6, minSchema: 3 });
    expect(upgradeTargets).toHaveLength(6);
    const doneId = Object.keys(ck.entries).find((id) => ck.entries[id]?.status === "done")!;
    expect(upgradeTargets[0]).toBe(doneId);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("computeOutlierScores keeps sparse interleaved longform videos isolated from Shorts peers", () => {
  const mixed: RawCatalogVideo[] = [];
  let longCount = 0;
  for (let i = 0; i < 55; i++) {
    const isLong = i % 11 === 5;
    if (isLong) {
      const idx = longCount++;
      mixed.push({
        id: `long_${idx}`,
        title: `Long Video ${idx}`,
        url: `https://www.youtube.com/watch?v=long_${idx}`,
        playlistIndex: i,
        views: idx === 4 ? 1_000_000 : 500_000,
        likes: null,
        durationSec: 900,
        uploadDate: `202607${String((i % 25) + 1).padStart(2, "0")}`,
      });
    } else {
      mixed.push({
        id: `short_${i}`,
        title: `Short Video ${i}`,
        url: `https://www.youtube.com/shorts/short_${i}`,
        playlistIndex: i,
        views: 10_000_000,
        likes: null,
        durationSec: 40,
        uploadDate: `202607${String((i % 25) + 1).padStart(2, "0")}`,
      });
    }
  }
  const scored = computeOutlierScores(mixed, "2026-11-23");
  const byId = new Map(scored.videos.map((v) => [v.id, v]));
  expect(byId.get("long_4")!.outlierRolling).toBe(2);
  expect(byId.get("long_0")!.outlierRolling).toBe(1);
  expect(byId.get("long_4")!.tier).toBe("winner");
});

test("isCorruptTranscript retains clean sparse-narration channels while excluding truncated stubs across catalog and deepDna", () => {
  const docVideos: RawCatalogVideo[] = [
    {
      id: "doc1",
      title: "Calm Forest Camp",
      url: "https://www.youtube.com/watch?v=doc1",
      playlistIndex: 1,
      views: 3_000_000,
      likes: 100_000,
      durationSec: 300,
      uploadDate: "20260701",
      transcriptText: "We set up camp before dusk. The fire warmed our hands quickly.",
      wordCount: 275,
      wpm: 55,
    },
    {
      id: "doc2",
      title: "Morning Coffee Trail",
      url: "https://www.youtube.com/watch?v=doc2",
      playlistIndex: 2,
      views: 1_500_000,
      likes: 50_000,
      durationSec: 300,
      uploadDate: "20260702",
      transcriptText: "Snow fell quietly all night. Then the sun cleared the ridge.",
      wordCount: 260,
      wpm: 52,
    },
    {
      id: "doc3",
      title: "River Crossing",
      url: "https://www.youtube.com/watch?v=doc3",
      playlistIndex: 3,
      views: 800_000,
      likes: 20_000,
      durationSec: 300,
      uploadDate: "20260703",
      transcriptText: "Cold water slowed our boots. Still we reached the far bank.",
      wordCount: 290,
      wpm: 58,
    },
    {
      id: "docStub",
      title: "Broken Stub",
      url: "https://www.youtube.com/watch?v=docStub",
      playlistIndex: 4,
      views: 500_000,
      likes: 10_000,
      durationSec: 300,
      uploadDate: "20260704",
      transcriptText: "We started walking along the muddy river path, but then,",
      wordCount: 10,
      wpm: 45,
    },
  ];
  const docCat = makeCatalog(docVideos);
  const docMedian = computeChannelMedianWpm(docCat.videos);
  expect(docMedian).toBe(55);
  expect(isCorruptTranscript(docCat.videos[0]!, docMedian)).toBe(false);
  expect(isCorruptTranscript(docCat.videos[3]!, docMedian)).toBe(true);
  expect(
    isCorruptTranscript(
      { transcriptText: "Fast channel drop.", wordCount: 25, wpm: 45, durationSec: 40 },
      160,
    ),
  ).toBe(true);

  const recs = docCat.videos.map((v) => ({
    ...makeRecord(v.id, v.tier, v.outlierRolling, makeSampleV2Telemetry({ duration_sec: 300 })),
    meta: {
      ...makeRecord(v.id, v.tier, v.outlierRolling, makeSampleV2Telemetry()).meta,
      wpm: v.wpm ?? null,
    },
  }));
  const stats = aggregateCorpus(docCat, recs);
  expect(stats.catalogTelemetry.packaging.wpmSampleN).toBe(3);
  expect(stats.catalogTelemetry.packaging.excludedCorruptWpmCount).toBe(1);
  expect(stats.deepDna.pacingAndTiming.overall.wpmSampleN).toBe(3);
  expect(stats.deepDna.pacingAndTiming.overall.medianWpm).toBe(55);
});

test("buildWithinBucketContrasts isolates v2-only probes on mixed v1+v2 corpora and buildShotSpineSummary excludes empty Section 3 dossiers", () => {
  const cat = makeCatalog([
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `mw${i}`,
      title: `Mix Win ${i}`,
      url: `https://youtube.com/shorts/mw${i}`,
      playlistIndex: 20 - i,
      views: 40_000_000,
      likes: 100_000,
      durationSec: 40,
      uploadDate: `2026070${i + 1}`,
    })),
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `mm${i}`,
      title: `Mix Mid ${i}`,
      url: `https://youtube.com/shorts/mm${i}`,
      playlistIndex: 17 - i,
      views: 10_000_000,
      likes: 50_000,
      durationSec: 40,
      uploadDate: `202607${String(i + 4).padStart(2, "0")}`,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `mf${i}`,
      title: `Mix Flop ${i}`,
      url: `https://youtube.com/shorts/mf${i}`,
      playlistIndex: 8 - i,
      views: 1_000_000,
      likes: 10_000,
      durationSec: 40,
      uploadDate: `202607${String(i + 15).padStart(2, "0")}`,
    })),
  ]);

  const v1Win = makeSampleTelemetry({ topic_category: "explainer_how_it_works" });
  const v2Win = makeSampleV2Telemetry({
    topic_category: "explainer_how_it_works",
    protagonist_format: "third_person_characters",
  });
  const v2Flop = makeSampleV2Telemetry({
    topic_category: "explainer_how_it_works",
    protagonist_format: "faceless_objects_diagrams",
  });
  const validMd = makeSampleDossier(v2Win);
  const emptySec3Md = "### 1. Hook\nNone\n### 3. Macro Shot & Cut Spine\nNo table\n";

  const records: MinedRecord[] = [
    { ...makeRecord("mw0", "winner", 4, v1Win), dossierMarkdown: emptySec3Md },
    { ...makeRecord("mw1", "winner", 4, v2Win), dossierMarkdown: validMd },
    { ...makeRecord("mw2", "winner", 4, v2Win), dossierMarkdown: validMd },
    { ...makeRecord("mf0", "flop", 0.2, v2Flop), dossierMarkdown: validMd },
    { ...makeRecord("mf1", "flop", 0.2, v2Flop), dossierMarkdown: validMd },
    { ...makeRecord("mf2", "flop", 0.2, v2Flop), dossierMarkdown: validMd },
  ];

  const stats = aggregateCorpus(cat, records, 1);
  expect(stats.deepDna.shotSpine.parsedVideoCount).toBe(5);
  expect(
    stats.deepDna.withinBucketContrasts.some((c) => c.feature.startsWith("protagonist:")),
  ).toBe(false);
});

test("runMine halts on second consecutive >=45s AUDIO_UNAVAILABLE and parseAudioLoudnessStderr rejects missing Summary", async () => {
  expect(
    parseAudioLoudnessStderr(
      "[Parsed_ebur128_0 @ 0x1] t: 0.1  M: -120.7 S: -120.7  I: -70.0 LUFS  LRA: 0.0 LU\n",
    ),
  ).toBeNull();

  const tmp = mkdtempSync(join(tmpdir(), "cdna-consec-aud-"));
  try {
    const cat = makeCatalog([
      {
        id: "conBad1",
        title: "Con Bad 1",
        url: "https://youtube.com/shorts/conBad1",
        playlistIndex: 10,
        views: 20_000_000,
        likes: 400_000,
        durationSec: 55,
        uploadDate: "20260801",
      },
      {
        id: "conBad2",
        title: "Con Bad 2",
        url: "https://youtube.com/shorts/conBad2",
        playlistIndex: 11,
        views: 19_000_000,
        likes: 350_000,
        durationSec: 52,
        uploadDate: "20260802",
      },
      {
        id: "conSkip3",
        title: "Con Skip 3",
        url: "https://youtube.com/shorts/conSkip3",
        playlistIndex: 12,
        views: 18_000_000,
        likes: 300_000,
        durationSec: 50,
        uploadDate: "20260803",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    const seen: string[] = [];
    const res = await runMine({
      channel: "demo-consec",
      corpusDir: tmp,
      limit: 3,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      ids: ["conBad1", "conBad2", "conSkip3"],
      runVideo: async (vid) => {
        seen.push(vid.id);
        return { ok: true, markdown: "INPUT_INCOMPLETE: AUDIO_UNAVAILABLE", hasAudioStream: true };
      },
    });
    expect(res.quotaHalted).toBe(true);
    expect(res.haltReason).toBe("media_downgrade");
    expect(seen).not.toContain("conSkip3");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("schema.ts emits bidirectional v3 BGM, SFX, and mixed-none coherence warnings", () => {
  const res = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV3Telemetry({
        bgm_mood: "tense_pulse_synth",
        bgm_twist_behavior: "no_bgm",
        bgm_ending_behavior: "no_bgm",
        sfx_density: "none",
        sfx_layers_used: ["none", "whoosh_or_transition"],
        time_remap_types: ["none", "slow_motion"],
      }),
    ),
  );
  expect(res.valid).toBe(true);
  expect(res.warnings.some((w) => w.includes("bgm_twist_behavior is no_bgm"))).toBe(true);
  expect(res.warnings.some((w) => w.includes("bgm_ending_behavior is no_bgm"))).toBe(true);
  expect(res.warnings.some((w) => w.includes("sfx_layers_used mixes none"))).toBe(true);
  expect(res.warnings.some((w) => w.includes("sfx_density is none"))).toBe(true);
  expect(res.warnings.some((w) => w.includes("time_remap_types mixes none"))).toBe(true);
});

test("runGeminiApiVideo rejects invalid and dot-segment fileName metadata before poll or delete", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-gapi-fname-"));
  const mp4 = join(tmp, "clip.mp4");
  writeFileSync(mp4, new Uint8Array(64).fill(1));
  try {
    for (const badName of ["../evil/path", "files/..", "files/."]) {
      const calledUrls: string[] = [];
      await expect(
        runGeminiApiVideo({
          videoPath: mp4,
          systemPrompt: "sys",
          userPrompt: "usr",
          model: "gemini-4-hydrogen",
          thinking: "Extra High",
          media: "High",
          fps: 24,
          durationSec: 30,
          expectAudio: false,
          apiKey: "test-key",
          fetchImpl: async (url) => {
            calledUrls.push(String(url));
            if (calledUrls.length === 1) {
              return new Response("", {
                status: 200,
                headers: {
                  "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/resumable",
                },
              });
            }
            return new Response(
              JSON.stringify({
                file: { name: badName, uri: "https://files.example/1", state: "ACTIVE" },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          },
        }),
      ).rejects.toThrow("incomplete or invalid file metadata");
      expect(calledUrls).toHaveLength(2);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("cli validates --min-duration/--max-duration bounds, --min-schema 3 aggregate, and v3 status staleness", () => {
  const badDur = spawnSync(
    "bun",
    [
      CLI_PATH,
      "collect",
      "--channel",
      "demo",
      "--url",
      "https://www.youtube.com/@demo/videos",
      "--min-duration",
      "300",
      "--max-duration",
      "60",
    ],
    { encoding: "utf8" },
  );
  expect(badDur.status).toBe(2);
  expect(badDur.stderr).toContain("--min-duration (300) cannot exceed --max-duration (60)");

  const tmp = mkdtempSync(join(tmpdir(), "cdna-cli-v3-"));
  try {
    const cat = makeCatalog([
      {
        id: "v3ok1",
        title: "V3 Clip 1",
        url: "https://youtube.com/shorts/v3ok1",
        playlistIndex: 1,
        views: 20_000_000,
        likes: 500_000,
        durationSec: 40,
        uploadDate: "20260701",
      },
      {
        id: "v2old",
        title: "V2 Clip 2",
        url: "https://youtube.com/shorts/v2old",
        playlistIndex: 2,
        views: 10_000_000,
        likes: 200_000,
        durationSec: 40,
        uploadDate: "20260702",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    writeJsonAtomic(join(tmp, "checkpoint.json"), {
      channel: "demo",
      updatedAt: "2026-11-24T00:00:00Z",
      completedCount: 2,
      failedCount: 0,
      entries: {
        v3ok1: { status: "done", updatedAt: "2026-11-24T00:00:00Z", chatUrl: null, attempts: 1 },
        v2old: { status: "done", updatedAt: "2026-11-24T00:00:00Z", chatUrl: null, attempts: 1 },
      },
    });
    const v3Dir = join(tmp, "videos", "v3ok1");
    const v2Dir = join(tmp, "videos", "v2old");
    mkdirSync(v3Dir, { recursive: true });
    mkdirSync(v2Dir, { recursive: true });
    const v3Tel = makeSampleV3Telemetry();
    const v2Tel = makeSampleV2Telemetry();
    writeJsonAtomic(join(v3Dir, "telemetry.json"), v3Tel);
    writeJsonAtomic(join(v3Dir, "meta.json"), makeRecord("v3ok1", "winner", 2, v3Tel).meta);
    writeFileSync(join(v3Dir, "dossier.md"), makeSampleDossier(v3Tel), "utf8");
    writeJsonAtomic(join(v2Dir, "telemetry.json"), v2Tel);
    writeJsonAtomic(join(v2Dir, "meta.json"), makeRecord("v2old", "median", 1, v2Tel).meta);
    writeFileSync(join(v2Dir, "dossier.md"), makeSampleDossier(v2Tel), "utf8");

    const agg = spawnSync(
      "bun",
      [CLI_PATH, "aggregate", "--channel", "demo", "--corpus", tmp, "--min-schema", "3"],
      { encoding: "utf8" },
    );
    expect(agg.status, agg.stderr).toBe(0);
    const statsJson = JSON.parse(readFileSync(join(tmp, "stats.json"), "utf8")) as {
      deepDna: { minSchema: number; minedCount: number; v3DeepDna: { v3Count: number } };
    };
    expect(statsJson.deepDna.minSchema).toBe(3);
    expect(statsJson.deepDna.minedCount).toBe(1);
    expect(statsJson.deepDna.v3DeepDna.v3Count).toBe(1);

    const stClean = spawnSync("bun", [CLI_PATH, "status", "--channel", "demo", "--corpus", tmp], {
      encoding: "utf8",
    });
    expect(stClean.status, stClean.stderr).toBe(0);
    expect(stClean.stdout).toContain("v1=0,v2=1,v3=1");
    expect(stClean.stdout).not.toContain("stale");

    writeJsonAtomic(join(v2Dir, "telemetry.json"), v3Tel);
    const stStale = spawnSync("bun", [CLI_PATH, "status", "--channel", "demo", "--corpus", tmp], {
      encoding: "utf8",
    });
    expect(stStale.status, stStale.stderr).toBe(0);
    expect(stStale.stdout).toContain("v1=0,v2=0,v3=2");
    expect(stStale.stdout).toContain("stale");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);

test("parseSection3Shots snaps nearest standard FPS (25fps and 27.86fps), parses prefix confidence, and strips comma-less frame spans", () => {
  const palMd = makeSampleDossier(makeSampleV2Telemetry(), [
    "| S01 | 00:00.000-00:10.000 (f0-f250) | Opening | M / eye | Open `[Camera, Framing & Staging]` | High (clean) |",
    "| S02 | 00:10.000-00:40.000 (f250-f1000) | Transition (card_flip f250-f255) | CU / eye | Flip `[Transitions & Continuity]` | Med (whip blur) |",
  ]);
  const pal = parseSection3Shots(palMd);
  expect(pal.inferredFps).toBe(25);
  expect(pal.shots[0]!.confidence).toBe("High");
  expect(pal.shots[1]!.confidence).toBe("Med");
  expect(pal.shots[1]!.transitionType).toBe("card_flip");
  expect(pal.shots[1]!.transitionFrames).toBe(5);

  const near30Md = makeSampleDossier(makeSampleV2Telemetry(), [
    "| S01 | 00:00.000-00:30.364 (f0-f846) | Opening | M / eye | Open `[Camera, Framing & Staging]` | High |",
  ]);
  expect(parseSection3Shots(near30Md).inferredFps).toBe(30);
});

test("cli rejects single-sided inverted --min-duration or --max-duration bounds and collect preserves saved queueFilter", () => {
  const shortsMinTooHigh = spawnSync(
    "bun",
    [
      CLI_PATH,
      "collect",
      "--channel",
      "demo",
      "--url",
      "https://www.youtube.com/@demo/shorts",
      "--min-duration",
      "200",
    ],
    { encoding: "utf8" },
  );
  expect(shortsMinTooHigh.status).toBe(2);
  expect(shortsMinTooHigh.stderr).toContain(
    "--min-duration (200) cannot exceed --max-duration (185)",
  );

  const videosMaxTooLow = spawnSync(
    "bun",
    [
      CLI_PATH,
      "collect",
      "--channel",
      "demo",
      "--url",
      "https://www.youtube.com/@demo/videos",
      "--max-duration",
      "5",
    ],
    { encoding: "utf8" },
  );
  expect(videosMaxTooLow.status).toBe(2);
  expect(videosMaxTooLow.stderr).toContain("--min-duration (10) cannot exceed --max-duration (5)");

  expect(
    resolveCollectDurationBounds(
      "https://www.youtube.com/@demo/videos",
      {},
      {
        sourceUrl: "https://www.youtube.com/@demo/videos",
        queueFilter: { minDurationSec: 120, maxDurationSec: 900 },
      },
    ),
  ).toEqual({ minDurationSec: 120, maxDurationSec: 900 });
}, 20_000);

test("non-English Latin-script channels emit null English/pronoun profiles and ALL-CAPS titles are not misclassified as title_case", () => {
  const esCat = makeCatalog([
    {
      id: "es1",
      title: "POR QUE ESTE PUENTE SE ROMPIO",
      url: "https://www.youtube.com/shorts/es1",
      playlistIndex: 1,
      views: 3_000_000,
      likes: 100_000,
      durationSec: 40,
      uploadDate: "20260701",
      transcriptText:
        "Cuando me di cuenta de lo que pasaba, he visto una cosa muy rara en la plaza.",
      wordCount: 95,
      wpm: 142,
    },
    {
      id: "es2",
      title: "COMO FUNCIONA UN RELOJ ANTIGUO",
      url: "https://www.youtube.com/shorts/es2",
      playlistIndex: 2,
      views: 1_500_000,
      likes: 50_000,
      durationSec: 40,
      uploadDate: "20260702",
      transcriptText: "Il me regarde et comprend tout de suite pourquoi le pont tombe sans bruit.",
      wordCount: 98,
      wpm: 147,
    },
    {
      id: "es3",
      title: "What Makes GTA 6 Cities Different",
      url: "https://www.youtube.com/shorts/es3",
      playlistIndex: 3,
      views: 800_000,
      likes: 20_000,
      durationSec: 40,
      uploadDate: "20260703",
      transcriptText: "Siempre me preguntaron por que la torre cambia cada verano.",
      wordCount: 92,
      wpm: 138,
    },
  ]);

  const stats = aggregateCorpus(esCat, []);
  expect(stats.catalogTelemetry.linguistics.englishProfile).toBeNull();
  expect(stats.catalogTelemetry.linguistics.pronounProfilePct).toBeNull();
  const titleCaseMod = stats.catalogTelemetry.packaging.titleModifiers.find(
    (m) => m.modifier === "title_case",
  );
  expect(titleCaseMod?.n).toBe(1);
});

test("parallel --tabs 2 isolated >=45s AUDIO_UNAVAILABLE does not halt active sibling worker", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-tabs2-aud-"));
  try {
    const cat = makeCatalog([
      {
        id: "parBad1",
        title: "Parallel Bad 1",
        url: "https://youtube.com/shorts/parBad1",
        playlistIndex: 10,
        views: 20_000_000,
        likes: 400_000,
        durationSec: 55,
        uploadDate: "20260801",
      },
      {
        id: "parGood2",
        title: "Parallel Good 2",
        url: "https://youtube.com/shorts/parGood2",
        playlistIndex: 11,
        views: 18_000_000,
        likes: 350_000,
        durationSec: 52,
        uploadDate: "20260802",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    const res = await runMine({
      channel: "demo-tabs2",
      corpusDir: tmp,
      limit: 2,
      tabs: 2,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      ids: ["parBad1", "parGood2"],
      runVideo: async (vid) => {
        if (vid.id === "parGood2") {
          await Bun.sleep(25);
          return {
            ok: true,
            markdown: makeSampleDossier(makeSampleV3Telemetry()),
            hasAudioStream: true,
          };
        }
        return { ok: true, markdown: "INPUT_INCOMPLETE: AUDIO_UNAVAILABLE", hasAudioStream: true };
      },
    });
    expect(res.done).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.quotaHalted).toBe(false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("midform durationBands, transcriptTimingSummary, temporalStability, and v3 silent audio exclusion aggregate and render cleanly", () => {
  const midCat = makeCatalog([
    {
      id: "mf1",
      title: "Midform Deep Dive One",
      url: "https://www.youtube.com/watch?v=mf1",
      playlistIndex: 1,
      views: 4_000_000,
      likes: 120_000,
      durationSec: 180,
      uploadDate: "20260415",
      transcriptText: "When you inspect this bridge, you see how the cables hold weight.",
      wordCount: 420,
      wpm: 140,
      transcriptTiming: {
        firstSpokenSec: 0.4,
        lastSpokenEndSec: 178.5,
        speakingCoveragePct: 86.5,
        maxGapSec: 2.1,
        silenceGapCount: 3,
      },
    },
    {
      id: "mf2",
      title: "Midform Deep Dive Two",
      url: "https://www.youtube.com/watch?v=mf2",
      playlistIndex: 2,
      views: 2_000_000,
      likes: 60_000,
      durationSec: 240,
      uploadDate: "20260720",
      transcriptText: "Because steel expands in summer, their joints slide back and forth.",
      wordCount: 560,
      wpm: 140,
      transcriptTiming: {
        firstSpokenSec: 0.6,
        lastSpokenEndSec: 238.0,
        speakingCoveragePct: 82.0,
        maxGapSec: 1.9,
        silenceGapCount: 2,
      },
    },
  ]);

  const audioRec = makeRecord("mf1", "winner", 2, makeSampleV3Telemetry());
  const silentRec = makeRecord(
    "mf2",
    "flop",
    0.5,
    makeSampleV3Telemetry({
      audio_bed_style: "silent",
      bgm_mood: "none",
      bgm_twist_behavior: "no_bgm",
      bgm_ending_behavior: "no_bgm",
      sfx_density: "none",
      sfx_layers_used: ["none"],
    }),
  );
  silentRec.meta.hasAudioStream = false;

  const stats = aggregateCorpus(midCat, [audioRec, silentRec], 3);
  expect(stats.catalogTelemetry.packaging.durationFormatMode).toBe("midform");
  expect(stats.catalogTelemetry.packaging.temporalStability).toHaveLength(2);
  expect(stats.catalogTelemetry.linguistics.transcriptTimingSummary?.sampleN).toBe(2);
  expect(stats.deepDna.v3DeepDna.v3Count).toBe(2);
  expect(stats.deepDna.v3DeepDna.v3AudioVerifiedCount).toBe(1);

  const md = renderStatsSummaryMd(stats);
  expect(md).toContain("## V3 Extended Craft Profiles (N=2 schema v3; Audio N=1; Thumbnails N=0)");
  expect(md).toContain("Timed caption cadence (N=2,");
  expect(md).toContain("## Temporal Format Stability");
  expect(md).toContain("Dated enriched mature subsample by quarter");
});

test("shotSpine computes exact lateToMidPacingRatio, wideAndTightSpan, bigScaleJump, cut-reset maxContinuousStreak, byBeatRoleMedianSec, and beatAlignmentPct", () => {
  const cat = makeCatalog([
    {
      id: "sp1",
      title: "Bridge Spine Test",
      url: "https://youtube.com/shorts/sp1",
      playlistIndex: 1,
      views: 25_000_000,
      likes: 500_000,
      durationSec: 40,
      uploadDate: "20260701",
    },
  ]);
  const tel = makeSampleV2Telemetry({
    duration_sec: 40,
    story_beats: [
      { role: "hook", start_sec: 0, end_sec: 4, pct_runtime: 10 },
      { role: "setup", start_sec: 4, end_sec: 14, pct_runtime: 25 },
      { role: "explanation_value", start_sec: 14, end_sec: 26, pct_runtime: 30 },
      { role: "twist", start_sec: 26, end_sec: 34, pct_runtime: 20 },
      { role: "resolution", start_sec: 34, end_sec: 40, pct_runtime: 15 },
    ],
    boundary_counts: { hard_cut: 1, hidden_cut: 0, transition: 1, continuous: 2 },
    transition_types: ["card_flip"],
    shot_scale_counts: { EW: 0, W: 2, M: 1, MCU: 1, CU: 1, ECU: 0, INSERT: 0 },
    camera_angle_counts: { aerial: 0, overhead: 0, high: 1, eye: 4, low: 0, ground: 0 },
  });
  const md = makeSampleDossier(tel, [
    "| S01 | 00:00.000-00:04.000 (f0-f120) | Opening | W / eye | Hook wide `[Camera, Framing & Staging]` | High |",
    "| S02 | 00:04.000-00:14.000 (f120-f420) | Continuous [NO CUT] (push_in) | M / eye | Setup mid `[Camera, Framing & Staging]` | High |",
    "| S03 | 00:14.000-00:26.000 (f420-f780) | Transition (card_flip, f420-f426) | CU / eye | Explain tight `[Transitions & Continuity]` | High |",
    "| S04 | 00:26.000-00:34.000 (f780-f1020) | Continuous [NO CUT] (pull_back) | W / high | Twist wide `[Camera, Framing & Staging]` | High |",
    "| S05 | 00:34.000-00:40.000 (f1020-f1200) | Hard Cut | MCU / eye | Resolve close `[Transitions & Continuity]` | High |",
  ]);
  const stats = aggregateCorpus(cat, [
    { ...makeRecord("sp1", "winner", 2.5, tel), dossierMarkdown: md },
  ]);
  const spine = stats.deepDna.shotSpine;
  expect(spine.shotDurationEnvelope.lateToMidPacingRatio.overall).toBe(0.58);
  expect(spine.scaleDynamics.wideAndTightSpanPct.overall).toBe(100);
  expect(spine.scaleDynamics.bigScaleJumpVideoPct.overall).toBe(100);
  expect(spine.scaleDynamics.medianMaxContinuousStreakSec.overall).toBe(20);
  expect(spine.shotDurationEnvelope.byBeatRoleMedianSec.hook?.medianSec).toBe(4);
  expect(spine.shotDurationEnvelope.byBeatRoleMedianSec.twist?.medianSec).toBe(8);
  expect(spine.shotDurationEnvelope.byBeatRoleMedianSec.resolution?.medianSec).toBe(6);
  expect(spine.transitionSpans[0]?.beatAlignmentPct).toBe(100);
});

test("storyDynamics computes exact rehookGeometry, stackedLoopSharePct, lateTwist65Pct, and openingLineAnchor", () => {
  const cat = makeCatalog([
    {
      id: "sd1",
      title: "Why Bridges Collapse 😱",
      url: "https://youtube.com/shorts/sd1",
      playlistIndex: 1,
      views: 30_000_000,
      likes: 600_000,
      durationSec: 40,
      uploadDate: "20260701",
    },
    {
      id: "sd2",
      title: "How Clocks Keep Time 🤔",
      url: "https://youtube.com/shorts/sd2",
      playlistIndex: 2,
      views: 5_000_000,
      likes: 80_000,
      durationSec: 40,
      uploadDate: "20260702",
    },
  ]);
  const telA = makeSampleV2Telemetry({
    duration_sec: 40,
    opening_spoken_line: "Steel bridges bend when wind matches rhythm.",
    twist_at_pct: 70,
    rehook_timestamps_sec: [10, 18, 28],
    story_beats: [
      { role: "hook", start_sec: 0, end_sec: 4, pct_runtime: 10 },
      { role: "escalation", start_sec: 4, end_sec: 16, pct_runtime: 30 },
      { role: "escalation", start_sec: 16, end_sec: 28, pct_runtime: 30 },
      { role: "twist", start_sec: 28, end_sec: 36, pct_runtime: 20 },
      { role: "resolution", start_sec: 36, end_sec: 40, pct_runtime: 10 },
    ],
  });
  const telB = makeSampleV2Telemetry({
    duration_sec: 40,
    opening_spoken_line: "Imagine walking down a quiet street.",
    twist_at_pct: 50,
    rehook_timestamps_sec: [12],
    story_beats: [
      { role: "hook", start_sec: 0, end_sec: 4, pct_runtime: 10 },
      { role: "escalation", start_sec: 4, end_sec: 20, pct_runtime: 40 },
      { role: "twist", start_sec: 20, end_sec: 32, pct_runtime: 30 },
      { role: "resolution", start_sec: 32, end_sec: 40, pct_runtime: 20 },
    ],
  });
  const statsSingle = aggregateCorpus(cat, [makeRecord("sd1", "winner", 3, telA)]);
  expect(statsSingle.deepDna.storyDynamics.rehookGeometry.overall.medianFirstRehookSec).toBe(10);
  expect(statsSingle.deepDna.storyDynamics.rehookGeometry.overall.medianInterRehookGapSec).toBe(9);
  expect(statsSingle.deepDna.storyDynamics.rehookGeometry.overall.medianMaxUnrehookedSpanSec).toBe(
    12,
  );

  const statsBoth = aggregateCorpus(cat, [
    makeRecord("sd1", "winner", 3, telA),
    makeRecord("sd2", "flop", 0.3, telB),
  ]);
  expect(statsBoth.deepDna.storyDynamics.stackedLoopSharePct.overall).toBe(50);
  expect(statsBoth.deepDna.storyDynamics.lateTwist65Pct.overall).toBe(50);
  expect(statsBoth.deepDna.storyDynamics.openingLineAnchor.sampleN).toBe(2);
  expect(statsBoth.deepDna.storyDynamics.openingLineAnchor.anchoredPct).toBe(50);
});

test("linguistics computes exact perVideoMedianShortSentPct, shortClosingPct, FK grade, simpleWordPct, and spoken starters", () => {
  const cat = makeCatalog([
    {
      id: "lg1",
      title: "Short Lines Video",
      url: "https://youtube.com/shorts/lg1",
      playlistIndex: 1,
      views: 20_000_000,
      likes: 400_000,
      durationSec: 40,
      uploadDate: "20260701",
      transcriptText: "But the old bridge shook fast. Now it falls.",
      wordCount: 95,
      wpm: 142.5,
    },
    {
      id: "lg2",
      title: "Flowing Lines Video",
      url: "https://youtube.com/shorts/lg2",
      playlistIndex: 2,
      views: 10_000_000,
      likes: 200_000,
      durationSec: 40,
      uploadDate: "20260702",
      transcriptText:
        "When a heavy truck crosses this long metal bridge, the cables stretch down slowly and pull the beams tight. So the tower bends back before snapping completely apart.",
      wordCount: 105,
      wpm: 157.5,
    },
  ]);
  const ling = aggregateCorpus(cat, []).catalogTelemetry.linguistics;
  expect(ling.perVideoMedianShortSentPct).toBe(50);
  expect(ling.shortClosingPct).toBe(50);
  expect(ling.englishProfile).not.toBeNull();
  expect(ling.englishProfile!.medianFkGrade).toBeGreaterThan(0);
  expect(ling.englishProfile!.simpleWordPct).toBeGreaterThan(80);
  expect(ling.englishProfile!.spokenStarterSentPct).toBe(75);
  expect(ling.englishProfile!.topSpokenStarters.map((s) => s.word).sort()).toEqual([
    "but",
    "now",
    "so",
  ]);
});

test("v3DeepDna aggregates sfxLayersUsed, timeRemapTypes, all 7 v3CraftSignals, and V2 BGM/Story cross-tabs with silent exclusion", () => {
  const cat = makeCatalog([
    {
      id: "vx1",
      title: "Audio V3 One",
      url: "https://youtube.com/shorts/vx1",
      playlistIndex: 1,
      views: 30_000_000,
      likes: 600_000,
      durationSec: 40,
      uploadDate: "20260701",
    },
    {
      id: "vx2",
      title: "Silent V3 Two",
      url: "https://youtube.com/shorts/vx2",
      playlistIndex: 2,
      views: 5_000_000,
      likes: 50_000,
      durationSec: 40,
      uploadDate: "20260702",
    },
  ]);
  const baseV3 = makeSampleV3Telemetry();
  const rAudio = makeRecord(
    "vx1",
    "winner",
    3,
    makeSampleV3Telemetry({
      emotional_driver: "visceral_shock_danger",
      topic_category: "animals_nature_survival",
      bgm_mood: "tense_pulse_synth",
      protagonist_format: "third_person_characters",
      story_structure: "mechanism_step_by_step",
      sfx_layers_used: ["whoosh_or_transition", "whoosh_or_transition", "hard_impact_or_hit"],
      time_remap_types: ["slow_motion", "rewind_or_replay"],
      craft_signals: {
        ...baseV3.craft_signals,
        has_expressive_facial_or_gesture_acting: true,
        has_fg_parallax_or_ots: true,
        has_archival_or_real_footage: false,
        has_direct_camera_address: false,
        has_unspoken_visual_subtext: true,
        has_setup_payoff_callback: true,
        has_match_cut: false,
      },
    }),
  );
  const rSilent = makeRecord(
    "vx2",
    "flop",
    0.3,
    makeSampleV3Telemetry({
      audio_bed_style: "silent",
      bgm_mood: "none",
      bgm_twist_behavior: "no_bgm",
      bgm_ending_behavior: "no_bgm",
      sfx_density: "none",
      sfx_layers_used: ["none"],
      time_remap_types: ["none"],
      protagonist_format: "faceless_objects_diagrams",
      story_structure: "comparison_contrast",
      craft_signals: {
        ...baseV3.craft_signals,
        has_expressive_facial_or_gesture_acting: false,
        has_fg_parallax_or_ots: false,
        has_archival_or_real_footage: true,
        has_direct_camera_address: true,
        has_unspoken_visual_subtext: false,
        has_setup_payoff_callback: false,
        has_match_cut: true,
      },
    }),
  );
  rSilent.meta.hasAudioStream = false;

  const stats = aggregateCorpus(cat, [rAudio, rSilent], 3);
  expect(stats.deepDna.v3DeepDna.v3AudioVerifiedCount).toBe(1);
  expect(stats.deepDna.v3DeepDna.sfxLayersUsed.map((x) => `${x.key}:${x.videos}`).sort()).toEqual([
    "hard_impact_or_hit:1",
    "whoosh_or_transition:1",
  ]);
  expect(stats.deepDna.v3DeepDna.timeRemapTypes.map((x) => `${x.key}:${x.videos}`).sort()).toEqual([
    "none:1",
    "rewind_or_replay:1",
    "slow_motion:1",
  ]);
  const v3SigMap = new Map(stats.deepDna.v3DeepDna.v3CraftSignals.map((s) => [s.signal, s.pct]));
  expect(stats.deepDna.v3DeepDna.v3CraftSignals).toHaveLength(7);
  expect(v3SigMap.get("has_expressive_facial_or_gesture_acting")).toBe(50);
  expect(v3SigMap.get("has_fg_parallax_or_ots")).toBe(50);
  expect(v3SigMap.get("has_archival_or_real_footage")).toBe(50);
  expect(v3SigMap.get("has_direct_camera_address")).toBe(50);
  expect(v3SigMap.get("has_unspoken_visual_subtext")).toBe(50);
  expect(v3SigMap.get("has_setup_payoff_callback")).toBe(50);
  expect(v3SigMap.get("has_match_cut")).toBe(50);
  expect(stats.deepDna.crossTabs.bgmByEmotion.visceral_shock_danger?.breakdown[0]?.key).toBe(
    "tense_pulse_synth",
  );
  expect(stats.deepDna.crossTabs.bgmByTopic.animals_nature_survival?.breakdown[0]?.key).toBe(
    "tense_pulse_synth",
  );
  expect(Object.keys(stats.deepDna.crossTabs.storyByProtagonist).sort()).toEqual([
    "faceless_objects_diagrams",
    "third_person_characters",
  ]);
});

test("CJK transcripts segment cleanly without false corrupt drop and computeTranscriptTimingFromSegments strips sound-tag segments", () => {
  const jaText =
    "橋が揺れる理由を知っていますか？強い風が吹くと、構造が共振を始めます。するとケーブルに大きな負荷がかかり、最終的に崩落してしまうのです。";
  const cleaned = cleanTranscriptText(jaText);
  expect(cleaned.wordCount).toBeGreaterThanOrEqual(20);
  expect(cleaned.openingSentence).toBe("橋が揺れる理由を知っていますか？");
  const jaWpm = computeWpm(cleaned.wordCount, 40)!;
  expect(jaWpm).toBeGreaterThanOrEqual(30);
  expect(segmentWords(jaText).length).toBe(cleaned.wordCount);
  expect(
    countSharedContentWords("なぜ橋は崩れるのか 😱", cleaned.openingSentence!),
  ).toBeGreaterThanOrEqual(1);

  const jaCat = makeCatalog([
    {
      id: "ja1",
      title: "なぜ橋は崩れるのか 😱",
      url: "https://youtube.com/shorts/ja1",
      playlistIndex: 1,
      views: 5_000_000,
      likes: 100_000,
      durationSec: 40,
      uploadDate: "20260701",
      transcriptText: cleaned.text,
      wordCount: cleaned.wordCount,
      wpm: jaWpm,
    },
  ]);
  const jaStats = aggregateCorpus(jaCat, []);
  expect(jaStats.catalogTelemetry.packaging.excludedCorruptWpmCount).toBe(0);
  expect(jaStats.catalogTelemetry.linguistics.punctuatedSampleN).toBe(1);
  expect(jaStats.catalogTelemetry.linguistics.englishProfile).toBeNull();
  expect(jaStats.catalogTelemetry.linguistics.pronounProfilePct).toBeNull();

  const timed = computeTranscriptTimingFromSegments(
    [
      { start: 0, duration: 4.5, text: "[Music]" },
      { start: 4.5, duration: 2.0, text: "Steel bends first." },
      { start: 6.5, duration: 1.0, text: "(Applause)" },
      { start: 7.5, duration: 2.5, text: "Then bolts snap." },
    ],
    20,
  );
  expect(timed).not.toBeNull();
  expect(timed!.timing.firstSpokenSec).toBe(4.5);
  expect(timed!.timing.lastSpokenEndSec).toBe(10);
  expect(timed!.timing.speakingCoveragePct).toBe(22.5);
  expect(timed!.timing.maxGapSec).toBe(1);
  expect(timed!.timing.silenceGapCount).toBe(1);
  expect(
    computeTranscriptTimingFromSegments([{ start: 0, duration: 5, text: "[Music]" }], 10),
  ).toBeNull();
});

test("title tag-before-emoji stripping, FE0F-free emoji valence, missing v3 craft signal error, and reverse v3 coherence warnings", () => {
  expect(countTitleWords("The Bathroom Mode (Patent Pending) 😏")).toBe(3);
  expect(
    countSharedContentWords("The Bathroom Mode (Patent Pending) 😏", "Patent pending fails."),
  ).toBe(0);
  expect(classifyEmojiValence("❤")).toBe("wholesome_relief");
  expect(classifyEmojiValence("☠")).toBe("high_arousal_shock");

  const missingV3Signal = makeSampleV3Telemetry();
  delete (missingV3Signal.craft_signals as Record<string, unknown>).has_direct_camera_address;
  const badMissing = parseAndValidateDossier(makeSampleDossier(missingV3Signal));
  expect(badMissing.valid).toBe(false);
  expect(badMissing.errors.some((e) => e.includes("has_direct_camera_address"))).toBe(true);

  const revWarn = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV3Telemetry({
        bgm_mood: "none",
        bgm_twist_behavior: "swell_or_riser_escalation",
        bgm_ending_behavior: "hard_cutoff_or_button",
        sfx_density: "moderate_punctuated",
        sfx_layers_used: ["none"],
        time_remap_types: ["none"],
        craft_signals: {
          ...makeSampleV3Telemetry().craft_signals,
          has_time_remap_or_hit_stop: true,
        },
      }),
    ),
  );
  expect(revWarn.valid).toBe(true);
  expect(
    revWarn.warnings.some((w) => w.includes("bgm_mood is none while bgm_twist_behavior")),
  ).toBe(true);
  expect(
    revWarn.warnings.some((w) => w.includes("bgm_mood is none while bgm_ending_behavior")),
  ).toBe(true);
  expect(revWarn.warnings.some((w) => w.includes("sfx_density is moderate_punctuated"))).toBe(true);
  expect(revWarn.warnings.some((w) => w.includes("has_time_remap_or_hit_stop is true"))).toBe(true);

  const silentWarn = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV3Telemetry({
        audio_bed_style: "silent",
        bgm_mood: "none",
        bgm_twist_behavior: "no_bgm",
        bgm_ending_behavior: "no_bgm",
        sfx_density: "none",
        sfx_layers_used: ["whoosh_or_transition"],
      }),
    ),
  );
  expect(silentWarn.valid).toBe(true);
  expect(silentWarn.warnings.some((w) => w.includes("audio_bed_style is silent"))).toBe(true);
});

test("music-note and symbol-only caption segments are stripped from transcript timing and excluded from linguistics denominators", () => {
  const withIntroMusic = computeTranscriptTimingFromSegments(
    [
      { start: 0, duration: 4, text: "♪" },
      { start: 4, duration: 2, text: "♫ When the bridge bends." },
      { start: 6, duration: 1.5, text: "♪ ♪" },
    ],
    20,
  );
  expect(withIntroMusic).not.toBeNull();
  expect(withIntroMusic!.timing.firstSpokenSec).toBe(4);
  expect(withIntroMusic!.timing.speakingCoveragePct).toBe(10);
  expect(withIntroMusic!.text).toBe("When the bridge bends.");

  expect(computeTranscriptTimingFromSegments([{ start: 0, duration: 24.5, text: "♪" }], 24.5)).toBe(
    null,
  );
  expect(cleanTranscriptText("♪ ♫ ...")).toEqual({
    text: "",
    wordCount: 0,
    openingSentence: null,
  });

  const cat = makeCatalog([
    {
      id: "music1",
      title: "Pure Music Short",
      url: "https://youtube.com/shorts/music1",
      playlistIndex: 0,
      views: 10_000_000,
      likes: 200_000,
      durationSec: 24,
      uploadDate: "20260701",
      transcriptText: "♪ ♪",
      openingTranscriptLine: "♪",
      wordCount: 0,
      wpm: null,
      transcriptTiming: {
        firstSpokenSec: 0,
        lastSpokenEndSec: 24,
        speakingCoveragePct: 100,
        maxGapSec: 0,
        silenceGapCount: 0,
      },
    },
    {
      id: "spoken1",
      title: "Bridge Bending Explained",
      url: "https://youtube.com/shorts/spoken1",
      playlistIndex: 1,
      views: 30_000_000,
      likes: 900_000,
      durationSec: 30,
      uploadDate: "20260702",
      transcriptText:
        "When the bridge bends under heavy wind, steel cables pull back harder. That keeps the deck steady until the storm fades.",
      wordCount: 22,
      wpm: 160,
      transcriptTiming: {
        firstSpokenSec: 0.4,
        lastSpokenEndSec: 25.9,
        speakingCoveragePct: 85,
        maxGapSec: 0.2,
        silenceGapCount: 0,
      },
    },
  ]);
  const ling = summarizeTranscriptLinguistics(cat.videos);
  expect(ling.sampleN).toBe(1);
  expect(ling.openingSampleN).toBe(1);
  expect(ling.transcriptTimingSummary!.sampleN).toBe(1);
  expect(ling.transcriptTimingSummary!.medianSpeakingCoveragePct).toBe(85);
});

test("fullwidth CJK punctuation, Japanese particle filtering, and tag-before-emoji titleModifiers behave cleanly", () => {
  expect(classifyOpeningSentence("橋が揺れる理由を知っていますか？")).toBe("question");
  expect(
    isCorruptTranscript({
      transcriptText: "橋が揺れる理由を知っていますか、",
      wordCount: 8,
      wpm: 80,
      durationSec: 30,
    }),
  ).toBe(true);
  expect(countSharedContentWords("猫の秘密", "犬の話です。")).toBe(0);
  expect(countSharedContentWords("なぜ橋は崩れるのか 😱", "まったく別の話ですか？")).toBe(0);
  expect(countSharedContentWords("なぜ橋は崩れるのか", "この橋は強風で揺れます。")).toBe(1);
  expect(countSharedContentWords("다리 비밀", "이 다리 튼튼함")).toBe(1);

  const cat = makeCatalog([
    {
      id: "cjk1",
      title: "なぜ橋は崩れるのか？😱",
      url: "https://youtube.com/shorts/cjk1",
      playlistIndex: 0,
      views: 25_000_000,
      likes: 700_000,
      durationSec: 35,
      uploadDate: "20260701",
    },
    {
      id: "cjk2",
      title: "衝撃の実験！",
      url: "https://youtube.com/shorts/cjk2",
      playlistIndex: 1,
      views: 15_000_000,
      likes: 400_000,
      durationSec: 35,
      uploadDate: "20260702",
    },
    {
      id: "tag1",
      title: "Why It Works (SHORTS) 😱",
      url: "https://youtube.com/shorts/tag1",
      playlistIndex: 2,
      views: 12_000_000,
      likes: 300_000,
      durationSec: 35,
      uploadDate: "20260703",
    },
  ]);
  const cm = summarizeCatalogPackaging(cat.videos);
  expect(cm.titleSummary.questionTitlePct).toBeCloseTo(33.3, 1);
  expect(cm.titleModifiers.find((m) => m.modifier === "exclamation_mark")?.n).toBe(1);
  expect(cm.titleModifiers.find((m) => m.modifier === "all_caps_emphasis_word")).toBeUndefined();

  const plCat = makeCatalog([
    {
      id: "pl1",
      title: "Dlaczego mosty i drogi pękają",
      url: "https://youtube.com/shorts/pl1",
      playlistIndex: 0,
      views: 10_000_000,
      likes: 200_000,
      durationSec: 35,
      uploadDate: "20260701",
    },
    {
      id: "pl2",
      title: "Jak woda i stal reagują",
      url: "https://youtube.com/shorts/pl2",
      playlistIndex: 1,
      views: 8_000_000,
      likes: 150_000,
      durationSec: 35,
      uploadDate: "20260702",
    },
  ]);
  const plCm = summarizeCatalogPackaging(plCat.videos);
  expect(plCm.titleModifiers.find((m) => m.modifier === "first_person_i_we")).toBeUndefined();
});

test("cli validate honors --fps and sibling meta.json, parseSection3Shots handles nested parens, invalid v3 enums skip coherence noise, and hidden-cut + transcript overflow branches hold", () => {
  const nestedMd = makeSampleDossier(makeSampleV3Telemetry(), [
    "| S01 | 00:00.000-00:10.000 (f0-f240) | Opening | W / eye | Open `[Camera, Framing & Staging]` | High |",
    "| S02 | 00:10.000-00:20.000 (f240-f480) | Transition (card_flip (3D), f240-f246) | M / eye | Flip `[Transitions & Continuity]` | High |",
    "| S03 | 00:20.000-00:40.000 (f480-f960) | Continuous (push) | CU / eye | Push `[Camera, Framing & Staging]` | High |",
  ]);
  const parsedNested = parseSection3Shots(nestedMd);
  expect(parsedNested.shots[1]!.transitionType).toBe("card_flip (3D)");
  expect(parsedNested.shots[1]!.transitionFrames).toBe(6);

  const badEnumTel = makeSampleV3Telemetry({
    bgm_twist_behavior: "no_bgm",
    bgm_ending_behavior: "no_bgm",
    sfx_layers_used: ["none"],
  }) as unknown as Record<string, unknown>;
  badEnumTel.bgm_mood = "bogus_bgm";
  badEnumTel.sfx_density = "bogus_sfx";
  const badEnumRes = parseAndValidateDossier(
    makeSampleDossier(badEnumTel as unknown as VideoTelemetry),
  );
  expect(badEnumRes.valid).toBe(false);
  expect(badEnumRes.warnings.some((w) => w.includes("bogus_bgm"))).toBe(false);
  expect(badEnumRes.warnings.some((w) => w.includes("bogus_sfx"))).toBe(false);

  const lowFpsDossier = makeSampleDossier(
    makeSampleV3Telemetry({
      opening_shot_sec: 15,
      boundary_counts: {
        hard_cut: 0,
        hidden_cut: 0,
        transition: 0,
        continuous: 2,
      },
      transition_types: [],
      shot_scale_counts: { EW: 0, W: 1, M: 1, MCU: 0, CU: 1, ECU: 0, INSERT: 0 },
      camera_angle_counts: { eye: 3, high: 0, low: 0, overhead: 0, ground: 0, aerial: 0 },
    }),
    [
      "| S01 | 00:00.000-00:15.000 (f0-f60) | Opening | W / eye | Open `[Camera, Framing & Staging]` | Med |",
      "| S02 | 00:15.000-00:30.000 (f60-f120) | Continuous [NO CUT] (pan f60->f80) | M / eye | Pan `[Camera, Framing & Staging]` | Med |",
      "| S03 | 00:30.000-00:40.000 (f120-f160) | Continuous [NO CUT] (push f120->f145) | CU / eye | Push `[Camera, Framing & Staging]` | High |",
    ],
  );
  const tmp = mkdtempSync(join(tmpdir(), "cdna-val-fps-"));
  try {
    const dPath = join(tmp, "dossier.md");
    writeFileSync(dPath, lowFpsDossier, "utf8");
    const valDef = spawnSync("bun", [CLI_PATH, "validate", dPath], { encoding: "utf8" });
    expect(valDef.status, valDef.stdout).toBe(1);
    expect(valDef.stdout).toContain("sampling brackets");
    const valFps4 = spawnSync("bun", [CLI_PATH, "validate", dPath, "--fps", "4"], {
      encoding: "utf8",
    });
    expect(valFps4.status, valFps4.stdout || valFps4.stderr).toBe(0);
    writeJsonAtomic(join(tmp, "meta.json"), { fps: 4, hasAudioStream: true });
    const valMeta = spawnSync("bun", [CLI_PATH, "validate", dPath], { encoding: "utf8" });
    expect(valMeta.status, valMeta.stdout || valMeta.stderr).toBe(0);
    writeJsonAtomic(join(tmp, "meta.json"), { fps: 24, sourceFps: 4, hasAudioStream: true });
    const valClamped = spawnSync("bun", [CLI_PATH, "validate", dPath], { encoding: "utf8" });
    expect(valClamped.status, valClamped.stdout || valClamped.stderr).toBe(0);
    writeJsonAtomic(join(tmp, "meta.json"), { sourceFps: 4, hasAudioStream: true });
    const valSourceOnly = spawnSync("bun", [CLI_PATH, "validate", dPath], { encoding: "utf8" });
    expect(valSourceOnly.status, valSourceOnly.stdout || valSourceOnly.stderr).toBe(0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const manyRaw: RawCatalogVideo[] = Array.from({ length: 20 }, (_, i) => ({
    id: `ov${String(i).padStart(2, "0")}`,
    title: `Video ${i}`,
    url: `https://youtube.com/shorts/ov${i}`,
    playlistIndex: i,
    views: (i + 1) * 1_000_000,
    likes: 10_000,
    durationSec: 40,
    uploadDate: "20260701",
  }));
  const overflowPicks = selectTranscriptTargets(manyRaw, 6, "2026-11-24", {
    priorityIds: ["ov10"],
  });
  expect(overflowPicks.length).toBe(6);
  expect(overflowPicks[0]!.id).toBe("ov10");
  expect(overflowPicks.some((v) => v.id === "ov19")).toBe(true);
  expect(overflowPicks.some((v) => v.id === "ov00")).toBe(true);

  const hcTel = makeSampleV3Telemetry({
    opening_shot_sec: 6,
    boundary_counts: { hard_cut: 0, hidden_cut: 5, transition: 0, continuous: 0 },
    transition_types: [],
    shot_scale_counts: { EW: 0, W: 2, M: 2, MCU: 0, CU: 2, ECU: 0, INSERT: 0 },
    camera_angle_counts: { eye: 6, high: 0, low: 0, overhead: 0, ground: 0, aerial: 0 },
  });
  const hcMd = makeSampleDossier(hcTel, [
    "| S01 | 00:00.000-00:06.000 (f0-f144) | Opening | W / eye | Open `[Camera, Framing & Staging]` | High |",
    "| S02 | 00:06.000-00:12.000 (f144-f288) | Hidden Cut (barrel roll) | W / eye | Roll `[Transitions & Continuity]` | High |",
    "| S03 | 00:12.000-00:18.000 (f288-f432) | Hidden Cut (whip pan) | M / eye | Whip `[Transitions & Continuity]` | High |",
    "| S04 | 00:18.000-00:24.000 (f432-f576) | Hidden Cut (zoom dive) | M / eye | Dive `[Transitions & Continuity]` | High |",
    "| S05 | 00:24.000-00:32.000 (f576-f768) | Hidden Cut (door occlusion) | CU / eye | Door `[Transitions & Continuity]` | High |",
    "| S06 | 00:32.000-00:40.000 (f768-f960) | Hidden Cut (match geometry) | CU / eye | Match `[Transitions & Continuity]` | High |",
  ]);
  const hcCat = makeCatalog([
    {
      id: "hc1",
      title: "Hidden Cut Mix",
      url: "https://youtube.com/shorts/hc1",
      playlistIndex: 0,
      views: 20_000_000,
      likes: 500_000,
      durationSec: 40,
      uploadDate: "20260701",
    },
  ]);
  const hcStats = aggregateCorpus(
    hcCat,
    [{ ...makeRecord("hc1", "winner", 2, hcTel), dossierMarkdown: hcMd }],
    2,
  );
  const hcMechs = Object.fromEntries(
    hcStats.deepDna.shotSpine.hiddenCutMechanisms.map((m) => [m.mechanism, m.instances]),
  );
  expect(hcMechs).toEqual({
    roll_spin: 1,
    whip_pan_smear: 1,
    radial_zoom_dive: 1,
    fg_or_env_occlusion: 1,
    other: 1,
  });
}, 20_000);

test("benjaminiHochberg, countTitleChars, isEnglishTextSample, Action -ing opener, per-video burstiness, and 5-zero anti-slop detectors hold", () => {
  const qBase = benjaminiHochberg([0.001, 0.04, 0.03, null, 0.5]);
  expect(qBase).toEqual([0.004, 0.0533, 0.0533, null, 0.5]);
  const qPreFiltered = benjaminiHochberg([0.004, 0.02], 10);
  expect(qPreFiltered).toEqual([0.04, 0.1]);

  expect(countTitleChars("Hello 🇺🇸")).toBe(7);
  expect(countTitleChars("Hello 🇺🇸 (Part 2) #shorts")).toBe(24);
  expect(classifyTitleOpener("🔥 Building A Rocket 🚀")).toBe("Action -ing ...");
  expect(classifyTitleOpener("What Makes It Work 😮")).toBe("What ...");
  expect(isEnglishTextSample(["This is a clean English story about the sea."])).toBe(true);
  expect(isEnglishTextSample(["Cách làm bánh mì nóng giòn tại nhà rất ngon."])).toBe(false);

  const cleanText =
    "If you drop one steel coin, gravity pulls fast. But when air pushes back harder against its flat wide rim, the tumbling coin drifts off course sideways. Because spin locks the edge.";
  const slopText =
    "Welcome back to my channel as we delve into a secret. From above, the camera path shows every brick clearly. Always remember to stay curious my friends.";
  const cat = makeCatalog([
    {
      id: "b1",
      title: "Why Coins Spin 😮",
      url: "https://youtube.com/shorts/b1",
      playlistIndex: 0,
      views: 25_000_000,
      likes: 600_000,
      durationSec: 36,
      uploadDate: "20260701",
      transcriptText: cleanText,
      wordCount: cleanText.split(/\s+/).length,
      wpm: 155,
    },
    {
      id: "b2",
      title: "Coin Tutorial 🤔",
      url: "https://youtube.com/shorts/b2",
      playlistIndex: 1,
      views: 4_000_000,
      likes: 150_000,
      durationSec: 36,
      uploadDate: "20260702",
      transcriptText: slopText,
      wordCount: slopText.split(/\s+/).length,
      wpm: 150,
    },
  ]);
  const ling = summarizeTranscriptLinguistics(cat.videos);
  expect(ling.burstiness?.sampleN).toBe(2);
  expect((ling.burstiness?.medianPerVideoSentLenCv ?? 0) > 0.25).toBe(true);
  expect((ling.burstiness?.medianPerVideoMaxMinRatio ?? 0) >= 1.5).toBe(true);
  expect(ling.englishProfile?.aiSlopBuzzwordVideoPct).toBe(50);
  expect(ling.englishProfile?.ytFillerIntroVideoPct).toBe(50);
  expect(ling.englishProfile?.moralizingEndingVideoPct).toBe(50);
  expect(ling.englishProfile?.metaDirectorialLeakPct).toBe(50);
});

test("collect.ts Wave 2: overlap-cleaned SRV3 transcript timing, heatmap/chapters, aspect-ratio bucketing, non-VOD filter, and stale transcript recovery", () => {
  const timed = computeTranscriptTimingFromSegments(
    [
      { start: 0.2, duration: 3.5, text: "If you drop this coin" },
      { start: 2.2, duration: 3.8, text: "gravity pulls it down fast" },
      { start: 2.2, duration: 3.8, text: "gravity pulls it down fast" },
      { start: 6.2, duration: 2.2, text: "air pushes back on the rim" },
      { start: 8.8, duration: 1.2, text: "then it hits the floor hard right away" },
    ],
    12,
    true,
  );
  expect(timed).not.toBeNull();
  expect(timed!.timing.isGenerated).toBe(true);
  expect(timed!.timing.firstSpokenSec).toBe(0.2);
  expect(timed!.timing.speakingCoveragePct).toBeLessThanOrEqual(100);
  expect(timed!.timing.activeSpeechWpm).not.toBeNull();
  expect(timed!.timing.lateToEarlyWpmRatio).not.toBeNull();
  expect(timed!.timing.captionTailSec).toBe(2);
  expect(timed!.text.match(/gravity pulls/g)?.length).toBe(1);

  const heat = extractHeatmapMetrics(
    Array.from({ length: 20 }, (_, i) => ({
      start_time: i * 5,
      end_time: (i + 1) * 5,
      value: i === 14 ? 1.0 : i < 3 ? 0.5 : 0.4,
    })),
    100,
  );
  expect(heat?.heatmapPeakPct).toBe(72.5);
  expect(heat?.heatmapEarly).toBe(0.475);
  expect(heat?.heatmapTailLift).toBe(0.89);

  const chap = extractChapterMetrics([
    { start_time: 0, end_time: 30, title: "Intro" },
    { start_time: 30, end_time: 90, title: "Body" },
    { start_time: 90, end_time: 150, title: "Payoff" },
  ]);
  expect(chap).toEqual({ chaptersCount: 3, firstChapterEndSec: 30, medianChapterSec: 60 });

  expect(isNonVodEntry({ live_status: "is_upcoming" })).toBe(true);
  expect(isNonVodEntry({ is_live: true })).toBe(true);
  expect(isNonVodEntry({ availability: "subscriber_only" })).toBe(true);
  expect(isNonVodEntry({ live_status: "not_live", availability: "public" })).toBe(false);

  const mixedAspect: RawCatalogVideo[] = [
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `vshort${i}`,
      title: `Vertical ${i}`,
      url: `https://www.youtube.com/watch?v=vshort${i}`,
      playlistIndex: i,
      views: i === 0 ? 50_000_000 : 10_000_000,
      likes: 100_000,
      durationSec: 170,
      width: 720,
      height: 1280,
      uploadDate: `2026070${i + 1}`,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `hvid${i}`,
      title: `Horizontal ${i}`,
      url: `https://www.youtube.com/watch?v=hvid${i}`,
      playlistIndex: i + 4,
      views: i === 0 ? 500_000 : 100_000,
      likes: 5_000,
      durationSec: 50,
      width: 1920,
      height: 1080,
      uploadDate: `2026071${i + 1}`,
    })),
  ];
  const scored = computeOutlierScores(mixedAspect, "2026-11-24");
  const h0 = scored.videos.find((v) => v.id === "hvid0")!;
  expect(h0.outlierRolling).toBeGreaterThan(3);

  const staleTargets = selectTranscriptTargets(
    [
      {
        id: "t1",
        title: "Stale Retry",
        url: "https://youtube.com/shorts/t1",
        playlistIndex: 0,
        views: 10_000_000,
        likes: 100_000,
        durationSec: 40,
        uploadDate: "20260701",
        transcriptText: "",
        transcriptLangsTried: ["en"],
      },
      {
        id: "t2",
        title: "Needs Timing",
        url: "https://youtube.com/shorts/t2",
        playlistIndex: 1,
        views: 10_000_000,
        likes: 100_000,
        durationSec: 40,
        uploadDate: "20260702",
        transcriptText: "Already has text but lacks timing.",
        wordCount: 6,
      },
    ],
    2,
    "2026-11-24",
    { requestedLanguages: ["ja"], backfillTiming: true },
  );
  expect(staleTargets.map((v) => v.id).sort()).toEqual(["t1", "t2"]);
});

test("gemini-api.ts & mine.ts Wave 2: thumbnail gate, 1M token auto-fps, 10Hz loudness, SSE streaming + MAX_TOKENS, decoupled schema, and 0-token audio backfill", async () => {
  expect(
    shouldAttachThumbnail({
      url: "https://www.youtube.com/shorts/s1",
      thumbnailUrl: "https://i.ytimg.com/vi/s1/hqdefault.jpg",
      width: 720,
      height: 1280,
      durationSec: 40,
    }),
  ).toBe(false);
  expect(
    shouldAttachThumbnail({
      url: "https://www.youtube.com/watch?v=w1",
      thumbnailUrl: "https://i.ytimg.com/vi/w1/hqdefault.jpg",
      width: 1920,
      height: 1080,
      durationSec: 480,
    }),
  ).toBe(true);

  const est200 = estimateUnifiedVideoTokens({ durationSec: 200, fps: 24, media: "High" });
  expect(est200.estimatedTokens).toBeGreaterThan(1_000_000);
  const blockedFps = resolveMiningFps({ requestedFps: 24, durationSec: 200, media: "High" });
  expect(blockedFps.ok).toBe(false);
  const scaledFps = resolveMiningFps({
    requestedFps: 24,
    durationSec: 200,
    media: "High",
    autoFps: true,
  });
  expect(scaledFps.ok).toBe(true);
  expect(scaledFps.autoScaled).toBe(true);
  expect(scaledFps.estimatedTokens).toBeLessThanOrEqual(1_000_000);

  const stderr10Hz = [
    "[Parsed_ebur128_0 @ 0x1] t: 2.0     TARGET:-23 LUFS    M: -17.0 S: -16.0     I: -16.0 LUFS       LRA:   2.0 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 6.0     TARGET:-23 LUFS    M: -16.0 S: -16.0     I: -15.8 LUFS       LRA:   2.5 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 12.0    TARGET:-23 LUFS    M: -15.0 S: -15.0     I: -15.5 LUFS       LRA:   3.0 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 15.0    TARGET:-23 LUFS    M: -15.0 S: -15.0     I: -15.5 LUFS       LRA:   3.0 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 18.0    TARGET:-23 LUFS    M: -15.0 S: -15.0     I: -15.5 LUFS       LRA:   3.0 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 22.0    TARGET:-23 LUFS    M: -15.0 S: -15.0     I: -15.5 LUFS       LRA:   3.0 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 25.0    TARGET:-23 LUFS    M: -28.0 S: -24.0     I: -16.0 LUFS       LRA:   4.0 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 25.5    TARGET:-23 LUFS    M: -28.0 S: -24.0     I: -16.0 LUFS       LRA:   4.0 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 28.0    TARGET:-23 LUFS    M: -15.0 S: -15.0     I: -15.2 LUFS       LRA:   4.1 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 32.0    TARGET:-23 LUFS    M: -11.5 S: -12.5     I: -14.5 LUFS       LRA:   4.4 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 35.0    TARGET:-23 LUFS    M: -11.5 S: -12.0     I: -14.2 LUFS       LRA:   4.5 LU",
    "[Parsed_ebur128_0 @ 0x1] t: 38.0    TARGET:-23 LUFS    M: -10.5 S: -12.0     I: -14.2 LUFS       LRA:   4.5 LU",
    "[silencedetect @ 0x2] silence_duration: 0.25",
    "Summary:",
    "  Integrated loudness:",
    "    I:         -14.2 LUFS",
    "  Loudness range:",
    "    LRA:         4.5 LU",
    "  True peak:",
    "    Peak:       -1.1 dBFS",
  ].join("\n");
  const parsed10 = parseAudioLoudnessStderr(stderr10Hz, 40)!;
  expect(parsed10.maxMomentaryLufs).toBe(-10.5);
  expect(parsed10.maxShortTermLufs).toBe(-12);
  expect(parsed10.plrDb).toBe(13.1);
  expect(parsed10.climaxLoudnessDeltaLu).toBe(3.5);
  expect(parsed10.relativeDropCount).toBe(1);
  expect(parsed10.isSilentTrack).toBe(false);

  const silentTrack = parseAudioLoudnessStderr(
    "Summary:\n  Integrated loudness:\n    I:         -70.0 LUFS\n  Loudness range:\n    LRA:         0.0 LU\n  True peak:\n    Peak:      -70.0 dBFS\n",
  )!;
  expect(silentTrack.isSilentTrack).toBe(true);

  const sseRaw = [
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "thought", thought: true }, { text: "Part A " }] } }] })}`,
    "",
    `data: ${JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Part B" }] } }], usageMetadata: { promptTokenCount: 14_000, candidatesTokenCount: 40, promptTokensDetails: [{ modality: "VIDEO", tokenCount: 13_172 }] } })}`,
    "",
  ].join("\n");
  const sseParsed = parseGeminiSseStream(sseRaw);
  expect(sseParsed.markdown).toBe("Part A Part B");
  expect(sseParsed.finishReason).toBe("STOP");
  expect(sseParsed.usageMetadata?.promptTokenCount).toBe(14_000);

  const tmp = mkdtempSync(join(tmpdir(), "cdna-w2-gapi-"));
  const mp4A = join(tmp, "a.mp4");
  const mp4B = join(tmp, "b.mp4");
  const img = join(tmp, "thumb.jpg");
  writeFileSync(mp4A, "aaaa");
  writeFileSync(mp4B, "bbbb");
  writeFileSync(img, "jpg-bytes");
  try {
    let uploadIdx = 0;
    const deletedNames: string[] = [];
    let capturedBody: Record<string, unknown> = {};
    let sawStreamUrl = false;
    const streamRes = await runGeminiApiVideo({
      videoPaths: [mp4A, mp4B],
      imagePath: img,
      startOffsetSec: 2,
      endOffsetSec: 12,
      durationSec: 2,
      sourceFps: 24,
      expectAudio: true,
      systemPrompt: "SYS",
      userPrompt: "COMPARE",
      model: "gemini-4-hydrogen",
      thinking: "High",
      media: "High",
      fps: 24,
      apiKey: "test-key",
      stream: true,
      pollIntervalMs: 1,
      fetchImpl: async (url, init) => {
        if (url.endsWith("/upload/v1beta/files")) {
          uploadIdx++;
          return new Response("", {
            status: 200,
            headers: {
              "x-goog-upload-url": `https://generativelanguage.googleapis.com/u/${uploadIdx}`,
            },
          });
        }
        if (url.startsWith("https://generativelanguage.googleapis.com/u/")) {
          const n = url.endsWith("/1") ? "f1" : "f2";
          return new Response(
            JSON.stringify({
              file: { name: `files/${n}`, uri: `https://example/${n}`, state: "ACTIVE" },
            }),
            { status: 200 },
          );
        }
        if (url.includes(":streamGenerateContent?alt=sse")) {
          sawStreamUrl = true;
          capturedBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
          return new Response(
            `data: ${JSON.stringify({
              candidates: [{ finishReason: "STOP", content: { parts: [{ text: "streamed ok" }] } }],
              usageMetadata: {
                promptTokenCount: 136_000,
                candidatesTokenCount: 20,
                promptTokensDetails: [{ modality: "VIDEO", tokenCount: 134_400 }],
              },
            })}\n\n`,
            { status: 200 },
          );
        }
        if (init?.method === "DELETE") {
          deletedNames.push(url);
          return new Response("{}", { status: 200 });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    expect(sawStreamUrl).toBe(true);
    expect(streamRes.markdown).toBe("streamed ok");
    expect(deletedNames).toHaveLength(2);
    const parts = (capturedBody.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]!
      .parts;
    expect(parts).toHaveLength(4);
    expect(parts[0]!.inlineData).toBeDefined();
    expect(parts[1]!.videoMetadata).toEqual({ fps: 24, startOffset: "2s", endOffset: "12s" });

    const cat = makeCatalog([
      {
        id: "oldv2",
        title: "Old V2",
        url: "https://youtube.com/shorts/oldv2",
        playlistIndex: 0,
        views: 20_000_000,
        likes: 500_000,
        durationSec: 40,
        uploadDate: "20260701",
      },
      {
        id: "newv3",
        title: "New V3",
        url: "https://youtube.com/shorts/newv3",
        playlistIndex: 1,
        views: 15_000_000,
        likes: 400_000,
        durationSec: 40,
        uploadDate: "20260702",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    writeJsonAtomic(join(tmp, "videos", "oldv2", "telemetry.json"), makeSampleV2Telemetry());
    writeJsonAtomic(
      join(tmp, "videos", "oldv2", "meta.json"),
      makeRecord("oldv2", "winner", 2, makeSampleV2Telemetry()).meta,
    );
    const ck = loadCheckpoint(tmp, "w2");
    ck.entries.oldv2 = {
      status: "done",
      updatedAt: "2026-11-24T00:00:00Z",
      chatUrl: null,
      attempts: 1,
    };
    saveCheckpoint(tmp, ck, cat);

    const seenMine: string[] = [];
    const decRes = await runMine({
      channel: "w2",
      corpusDir: tmp,
      limit: 5,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      expectSchema: 3,
      upgradeBelow: 1,
      runVideo: async (vid) => {
        seenMine.push(vid.id);
        return { ok: true, markdown: makeSampleDossier(makeSampleV3Telemetry()) };
      },
    });
    expect(seenMine).toEqual(["newv3"]);
    expect(decRes.done).toBe(1);

    const bf = await probeAudioBackfill({
      channel: "w2",
      corpusDir: tmp,
      limit: 5,
      probeVideo: async () => ({ hasAudioStream: true, audioMetrics: parsed10 }),
    });
    expect(bf.probed).toBe(2);
    expect(bf.failed).toBe(0);
    const updatedMeta = JSON.parse(readFileSync(join(tmp, "videos", "oldv2", "meta.json"), "utf8"));
    expect(updatedMeta.audioMetrics.maxShortTermLufs).toBe(-12);
    const bfSecond = await probeAudioBackfill({
      channel: "w2",
      corpusDir: tmp,
      limit: 5,
      probeVideo: async () => ({ hasAudioStream: true, audioMetrics: parsed10 }),
    });
    expect(bfSecond.probed).toBe(0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("schema.ts, shot-spine.ts, aggregate.ts & render-summary.ts Wave 2: bpy guard, expectedDurationSec, Domain 2/4 coherence, unbroken takes, craft pillars, occlusion fix, macro FPS stratification, eraStability, silent loudness filter, and clean summary", () => {
  const bpyLeak = parseAndValidateDossier(
    makeSampleDossier(makeSampleV3Telemetry()).replace(
      "### 1.",
      "### 1.\nUse bpy.ops.mesh.primitive",
    ),
  );
  expect(bpyLeak.valid).toBe(false);
  expect(bpyLeak.errors.some((e) => e.includes("engine/CLI leak"))).toBe(true);

  const durMismatch = parseAndValidateDossier(makeSampleDossier(makeSampleV3Telemetry()), {
    expectedDurationSec: 90,
  });
  expect(durMismatch.valid).toBe(false);
  expect(durMismatch.errors.some((e) => e.includes("duration_sec"))).toBe(true);

  const d24Warn = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV3Telemetry({
        twist_at_pct: 75,
        story_beats: [
          { role: "hook", start_sec: 0, end_sec: 5, pct_runtime: 12.5 },
          { role: "setup", start_sec: 5, end_sec: 15, pct_runtime: 25 },
          { role: "escalation", start_sec: 15, end_sec: 30, pct_runtime: 37.5 },
          { role: "resolution", start_sec: 30, end_sec: 40, pct_runtime: 25 },
        ],
        vo_visual_relation: "unvoiced_visual_led",
        lighting_style: "flat_2d_unlit",
        shadow_quality: "crisp_hard",
      }),
    ),
  );
  expect(d24Warn.warnings.some((w) => w.includes("twist_at_pct"))).toBe(true);
  expect(d24Warn.warnings.some((w) => w.includes("unvoiced_visual_led"))).toBe(true);
  expect(d24Warn.warnings.some((w) => w.includes("flat_2d_unlit"))).toBe(true);

  const rawCat: RawCatalogVideo[] = Array.from({ length: 16 }, (_, i) => ({
    id: `w2v${i}`,
    title: `What Makes Signal ${i} Work 😮`,
    url: `https://youtube.com/shorts/w2v${i}`,
    playlistIndex: i,
    views: i < 4 ? 30_000_000 : i >= 12 ? 3_000_000 : 10_000_000,
    likes: 300_000,
    commentCount: i < 4 ? 6_000 : 1_500,
    durationSec: 40,
    uploadDate: `202607${String(i + 1).padStart(2, "0")}`,
  }));
  const cat = makeCatalog(rawCat);
  const microMd = makeSampleDossier(
    makeSampleV3Telemetry({
      boundary_counts: { hard_cut: 0, hidden_cut: 1, transition: 0, continuous: 3 },
      transition_types: [],
      camera_moves_used: ["push_in", "pass_through_window"],
      shot_scale_counts: { EW: 0, W: 2, M: 2, MCU: 0, CU: 1, ECU: 0, INSERT: 0 },
      camera_angle_counts: { eye: 5, high: 0, low: 0, overhead: 0, ground: 0, aerial: 0 },
    }),
    [
      "| S01 | 00:00.000-00:08.000 (f0-f192) | Opening | W / eye | Open `[Camera, Framing & Staging]` | High |",
      "| S02 | 00:08.000-00:16.000 (f192-f384) | Continuous [NO CUT] (push_in through wall) | M / eye | Wall pass `[Transitions & Continuity]` | High |",
      "| S03 | 00:16.000-00:24.000 (f384-f576) | Continuous [NO CUT] (orbit arc) | M / eye | Orbit `[Camera, Framing & Staging]` | High |",
      "| S04 | 00:24.000-00:32.000 (f576-f768) | Hidden Cut (occluded by pillar) | W / eye | Pillar wipe `[Transitions & Continuity]` | High |",
      "| S05 | 00:32.000-00:40.000 (f768-f960) | Continuous [NO CUT] (pull_back) | CU / eye | Pull `[Optics: Blur, DOF & Temporal]` | High |",
    ],
  );
  const microTel = makeSampleV3Telemetry({
    boundary_counts: { hard_cut: 0, hidden_cut: 1, transition: 0, continuous: 3 },
    transition_types: [],
    camera_moves_used: ["push_in", "pass_through_window"],
    shot_scale_counts: { EW: 0, W: 2, M: 2, MCU: 0, CU: 1, ECU: 0, INSERT: 0 },
    camera_angle_counts: { eye: 5, high: 0, low: 0, overhead: 0, ground: 0, aerial: 0 },
  });
  const microRec: MinedRecord = {
    ...makeRecord("w2v0", "winner", 3, microTel),
    dossierMarkdown: microMd,
  };
  microRec.meta.miningMode = "micro_24fps";
  microRec.meta.audioMetrics = {
    integratedLufs: -14.0,
    loudnessRangeLu: 4.2,
    truePeakDbtp: -1.0,
    maxShortTermLufs: -11.5,
    maxMomentaryLufs: -10.0,
    plrDb: 13.0,
    climaxLoudnessDeltaLu: 2.5,
    relativeDropCount: 1,
    isSilentTrack: false,
    silenceCount: 0,
    totalSilenceSec: 0,
  };
  const macroRec: MinedRecord = {
    ...makeRecord(
      "w2v12",
      "flop",
      0.3,
      makeSampleV3Telemetry({ time_remap_types: ["speed_ramp_or_timelapse"] }),
    ),
    dossierMarkdown: makeSampleDossier(
      makeSampleV3Telemetry({ time_remap_types: ["speed_ramp_or_timelapse"] }),
    ),
  };
  macroRec.meta.fps = 2;
  macroRec.meta.miningMode = "macro_lowfps";
  macroRec.meta.audioMetrics = {
    integratedLufs: -70.0,
    loudnessRangeLu: 0,
    truePeakDbtp: -70.0,
    maxShortTermLufs: -70.0,
    maxMomentaryLufs: -70.0,
    plrDb: 0,
    climaxLoudnessDeltaLu: null,
    relativeDropCount: 0,
    isSilentTrack: true,
    silenceCount: 1,
    totalSilenceSec: 40,
  };

  const stats = aggregateCorpus(cat, [microRec, macroRec], 2);
  expect(stats.statsVersion).toBe(4);
  expect(stats.catalogTelemetry.packaging.eraStability).toHaveLength(4);
  expect(stats.catalogTelemetry.byTier.winner.medianCommentRate).toBe(0.02);
  expect(stats.deepDna.microFpsSampleN).toBe(1);
  expect(stats.deepDna.v3DeepDna.v3MicroFpsCount).toBe(1);
  expect(stats.deepDna.craftSignals.find((s) => s.signal === "uses_motion_blur")?.sampleN).toBe(1);
  expect(stats.deepDna.v2DeepDna.cameraMoves.some((m) => m.move === "pass_through")).toBe(true);
  expect(stats.deepDna.shotSpine.editTakeDurationEnvelope.overall?.n).toBe(2);
  expect(stats.deepDna.shotSpine.editTakeDurationEnvelope.overall?.p50).toBe(20);
  expect(stats.deepDna.shotSpine.hiddenCutMechanisms[0]?.mechanism).toBe("fg_or_env_occlusion");
  expect(stats.deepDna.shotSpine.dominantCraftMix.taggedShots).toBe(5);
  expect(stats.deepDna.shotSpine.dominantCraftMix.categories.length).toBeGreaterThanOrEqual(3);
  expect(stats.deepDna.shotSpine.continuousBridgeMechanisms.length).toBeGreaterThanOrEqual(2);
  expect(stats.deepDna.v3DeepDna.audioLoudnessSummary.sampleN).toBe(1);
  expect(stats.deepDna.v3DeepDna.audioLoudnessSummary.silentTracksExcludedCount).toBe(1);
  expect(stats.deepDna.v3DeepDna.audioLoudnessSummary.byTier.winner.medianIntegratedLufs).toBe(-14);
  expect(stats.deepDna.v3DeepDna.audioLoudnessSummary.byTier.flop.medianIntegratedLufs).toBeNull();

  const summary = renderStatsSummaryMd(stats);
  expect(summary).toContain("Unbroken editorial take duration");
  expect(summary).toContain("Dominant Craft Pillar Mix");
  expect(summary).toContain("Continuous [NO CUT] Bridge Mechanism");
  expect(summary).not.toContain("**");
  expect(summary).not.toContain("`");
});

test("commentRate uses percent uniformly across collect.ts and aggregate.ts fallback", () => {
  const scored = computeOutlierScores(
    [
      {
        id: "cr1",
        title: "Percent Check",
        url: "https://youtube.com/shorts/cr1",
        playlistIndex: 0,
        views: 1_000_000,
        likes: 20_000,
        commentCount: 1_000,
        durationSec: 40,
        uploadDate: "20260701",
      },
    ],
    "2026-11-24",
  );
  expect(scored.videos[0]!.commentRate).toBe(0.1);
  const catWithPrecomputed: CatalogFile = {
    channel: "cr-test",
    sourceUrl: "https://youtube.com/@cr-test",
    snapshotDate: "2026-11-24",
    totalCollected: 1,
    matureCount: 1,
    enrichedCount: 1,
    transcriptCount: 0,
    globalMatureMedianViews: 1_000_000,
    videos: scored.videos,
  };
  const catFallback: CatalogFile = {
    ...catWithPrecomputed,
    videos: [{ ...scored.videos[0]!, commentRate: null }],
  };
  const sPre = aggregateCorpus(catWithPrecomputed, [], 1);
  const sFall = aggregateCorpus(catFallback, [], 1);
  expect(sPre.catalogTelemetry.byTier.median.medianCommentRate).toBe(0.1);
  expect(sFall.catalogTelemetry.byTier.median.medianCommentRate).toBe(0.1);
});

test("auto-generated captions emit null silenceGapCount/medianSilenceGapCount and drop/clamp post-duration cues", () => {
  const gen = computeTranscriptTimingFromSegments(
    [
      { start: 0.2, duration: 3.0, text: "First clause here" },
      { start: 5.0, duration: 3.0, text: "Second clause after gap" },
      { start: 40.5, duration: 2.0, text: "Trailing cue past end" },
    ],
    40,
    true,
  )!;
  expect(gen.timing.silenceGapCount).toBeNull();
  expect(gen.timing.maxGapSec).toBeNull();
  expect(gen.timing.lastSpokenEndSec).toBe(8);
  const clamped = computeTranscriptTimingFromSegments(
    [
      { start: 0.2, duration: 3.0, text: "First clause here" },
      { start: 38.5, duration: 4.0, text: "Overflowing tail cue" },
    ],
    40,
    true,
  )!;
  expect(clamped.timing.lastSpokenEndSec).toBe(40);
  const cat = makeCatalog([
    {
      id: "ag1",
      title: "Auto Caption Clip",
      url: "https://youtube.com/shorts/ag1",
      playlistIndex: 0,
      views: 10_000_000,
      likes: 200_000,
      durationSec: 40,
      uploadDate: "20260701",
      transcriptText: "First clause here. Second clause after gap. Trailing cue past end.",
      wordCount: 11,
      wpm: 150,
      transcriptTiming: gen.timing,
    },
  ]);
  const ling = summarizeTranscriptLinguistics(cat.videos);
  expect(ling.transcriptTimingSummary?.medianSilenceGapCount).toBeNull();
  expect(ling.transcriptTimingSummary?.medianMaxGapSec).toBeNull();
});

test("mixed v1+v2 micro-FPS isolates v2MicroFpsCount, labels heatmap (end/mid), and buckets 12fps as other_fps", () => {
  const cat = makeCatalog([
    {
      id: "mv1",
      title: "Legacy V1",
      url: "https://youtube.com/shorts/mv1",
      playlistIndex: 0,
      views: 12_000_000,
      likes: 200_000,
      durationSec: 40,
      uploadDate: "20260701",
      sourceFps: 12,
      heatmapPeakPct: 70,
      heatmapEarly: 0.5,
      heatmapEnd: 0.4,
      heatmapTailLift: 0.89,
    },
    {
      id: "mv2",
      title: "Current V2",
      url: "https://youtube.com/shorts/mv2",
      playlistIndex: 1,
      views: 15_000_000,
      likes: 250_000,
      durationSec: 40,
      uploadDate: "20260702",
      sourceFps: 24,
    },
  ]);
  const r1 = makeRecord("mv1", "median", 1, makeSampleTelemetry());
  const r2 = makeRecord("mv2", "winner", 1.5, makeSampleV2Telemetry());
  r1.meta.fps = 24;
  r2.meta.fps = 24;
  const stats = aggregateCorpus(cat, [r1, r2], 1);
  expect(stats.deepDna.microFpsSampleN).toBe(2);
  expect(stats.deepDna.v2DeepDna.v2MicroFpsCount).toBe(1);
  expect(
    stats.catalogTelemetry.formatGeometry.fpsBuckets.some((b) => b.bucket === "other_fps"),
  ).toBe(true);
  const md = renderStatsSummaryMd(stats);
  expect(md).toContain("## V2 Granular Craft Signals (N=1; Audio N=1; Micro-FPS N=1)");
  expect(md).toContain("tail lift (end/mid)");
});

test("gemini-api.ts enforces 2-video sliced floor, start-only non-double-subtraction, AGENTIC mode, SSE MAX_TOKENS/error, and CLI exit 2", async () => {
  expect(() =>
    parseGeminiSseStream(
      `data: ${JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "overloaded" } })}\n\n`,
    ),
  ).toThrow(/\(HTTP 503 UNAVAILABLE\): overloaded/);

  const tmp = mkdtempSync(join(tmpdir(), "cdna-r9-gapi-"));
  const mp4A = join(tmp, "a.mp4");
  const mp4B = join(tmp, "b.mp4");
  writeFileSync(mp4A, "aaaa");
  writeFileSync(mp4B, "bbbb");
  const makeMock = (
    handler: (url: string, body: Record<string, unknown>) => Response,
  ): ((input: string, init?: RequestInit) => Promise<Response>) => {
    let idx = 0;
    return async (url, init) => {
      if (url.endsWith("/upload/v1beta/files")) {
        idx++;
        return new Response("", {
          status: 200,
          headers: { "x-goog-upload-url": `https://generativelanguage.googleapis.com/u/${idx}` },
        });
      }
      if (url.startsWith("https://generativelanguage.googleapis.com/u/")) {
        const tag = url.split("/").pop();
        return new Response(
          JSON.stringify({
            file: { name: `files/r9_${tag}`, uri: `https://example/${tag}`, state: "ACTIVE" },
          }),
          { status: 200 },
        );
      }
      if (url.includes("GenerateContent") || url.includes("generateContent")) {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        return handler(url, body);
      }
      if (init?.method === "DELETE") return new Response("{}", { status: 200 });
      throw new Error(`unexpected ${url}`);
    };
  };
  try {
    await expect(
      runGeminiApiVideo({
        videoPaths: [mp4A, mp4B],
        videoDurationsSec: [30, 30],
        durationSec: 60,
        startOffsetSec: 2,
        endOffsetSec: 12,
        sourceFps: 24,
        expectAudio: false,
        systemPrompt: "SYS",
        userPrompt: "CMP",
        model: "gemini-4-hydrogen",
        thinking: "High",
        media: "High",
        fps: 24,
        apiKey: "k",
        stream: true,
        pollIntervalMs: 1,
        fetchImpl: makeMock(
          () =>
            new Response(
              `data: ${JSON.stringify({
                candidates: [{ finishReason: "STOP", content: { parts: [{ text: "ok" }] } }],
                usageMetadata: {
                  promptTokenCount: 51_000,
                  candidatesTokenCount: 10,
                  promptTokensDetails: [{ modality: "VIDEO", tokenCount: 50_000 }],
                },
              })}\n\n`,
              { status: 200 },
            ),
        ),
      }),
    ).rejects.toThrow(/expected ~134,400 tokens \(20\.0s/);

    await expect(
      runGeminiApiVideo({
        videoPaths: [mp4A],
        videoDurationsSec: [30],
        durationSec: 30,
        startOffsetSec: 15,
        sourceFps: 24,
        expectAudio: false,
        systemPrompt: "SYS",
        userPrompt: "SLICE",
        model: "gemini-4-hydrogen",
        thinking: "High",
        media: "High",
        fps: 24,
        apiKey: "k",
        stream: true,
        pollIntervalMs: 1,
        fetchImpl: makeMock(
          () =>
            new Response(
              `data: ${JSON.stringify({
                candidates: [{ finishReason: "STOP", content: { parts: [{ text: "ok" }] } }],
                usageMetadata: {
                  promptTokenCount: 3_000,
                  candidatesTokenCount: 10,
                  promptTokensDetails: [{ modality: "VIDEO", tokenCount: 2_000 }],
                },
              })}\n\n`,
              { status: 200 },
            ),
        ),
      }),
    ).rejects.toThrow(/expected ~100,800 tokens \(15\.0s/);

    await expect(
      runGeminiApiVideo({
        videoPaths: [mp4A],
        durationSec: 2,
        sourceFps: 24,
        expectAudio: false,
        systemPrompt: "SYS",
        userPrompt: "TRUNC",
        model: "gemini-4-hydrogen",
        thinking: "High",
        media: "High",
        fps: 24,
        apiKey: "k",
        stream: true,
        pollIntervalMs: 1,
        fetchImpl: makeMock(
          () =>
            new Response(
              `data: ${JSON.stringify({
                candidates: [
                  { finishReason: "MAX_TOKENS", content: { parts: [{ text: "partial" }] } },
                ],
                usageMetadata: {
                  promptTokenCount: 14_000,
                  candidatesTokenCount: 65_536,
                  promptTokensDetails: [{ modality: "VIDEO", tokenCount: 13_440 }],
                },
              })}\n\n`,
              { status: 200 },
            ),
        ),
      }),
    ).rejects.toThrow(/response truncated \(finishReason=MAX_TOKENS\)/);

    let agenticPart: Record<string, unknown> = {};
    const agenticRes = await runGeminiApiVideo({
      videoPaths: [mp4A],
      durationSec: 600,
      sourceFps: 24,
      expectAudio: false,
      mediaProcessing: "AGENTIC",
      systemPrompt: "SYS",
      userPrompt: "LONG",
      model: "gemini-4-hydrogen",
      thinking: "High",
      media: "High",
      fps: 24,
      apiKey: "k",
      stream: true,
      pollIntervalMs: 1,
      fetchImpl: makeMock((_u, body) => {
        agenticPart = (body.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]!
          .parts[0]!;
        return new Response(
          `data: ${JSON.stringify({
            candidates: [{ finishReason: "STOP", content: { parts: [{ text: "agentic ok" }] } }],
            usageMetadata: {
              promptTokenCount: 18_000,
              candidatesTokenCount: 30,
              promptTokensDetails: [{ modality: "VIDEO", tokenCount: 15_000 }],
            },
          })}\n\n`,
          { status: 200 },
        );
      }),
    });
    expect(agenticRes.markdown).toBe("agentic ok");
    expect(agenticPart.mediaProcessing).toBe("AGENTIC");
    expect(agenticPart.videoMetadata).toBeUndefined();

    const gCli = join(SCRIPT_DIR, "gemini-api.ts");
    const badMedia = spawnSync(
      "bun",
      [gCli, "--video", mp4A, "--media", "bogus", "--prompt", "hi"],
      {
        encoding: "utf8",
      },
    );
    expect(badMedia.status).toBe(2);
    const badAgentic = spawnSync(
      "bun",
      [gCli, "--video", mp4A, "--processing", "AGENTIC", "--fps", "24", "--prompt", "hi"],
      { encoding: "utf8" },
    );
    expect(badAgentic.status).toBe(2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("mine.ts enforces upgradeBelow with custom systemFile and preserves --upgrade-below in retry hints", async () => {
  const hint = formatMineOutcome(
    "demo",
    { done: 0, failed: 0, quotaHalted: true, haltReason: "quota", processed: [] },
    3,
    "gemini-api",
    3,
    "--upgrade-below",
  );
  expect(hint.nextLine).toContain("--upgrade-below 3");

  const tmp = mkdtempSync(join(tmpdir(), "cdna-r9-up-"));
  try {
    const sysPath = join(tmp, "custom.md");
    writeFileSync(sysPath, "Custom prompt", "utf8");
    const cat = makeCatalog([
      {
        id: "up1",
        title: "Upgrade Check",
        url: "https://youtube.com/shorts/up1",
        playlistIndex: 0,
        views: 10_000_000,
        likes: 200_000,
        durationSec: 40,
        uploadDate: "20260701",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    let attempts = 0;
    const res = await runMine({
      channel: "r9-up",
      corpusDir: tmp,
      limit: 1,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "High",
      media: "High",
      fps: 24,
      systemFile: sysPath,
      upgradeBelow: 3,
      runVideo: async (_v, _t, attempt) => {
        attempts = attempt;
        return {
          ok: true,
          markdown: makeSampleDossier(
            attempt === 1 ? makeSampleV2Telemetry() : makeSampleV3Telemetry(),
          ),
        };
      },
    });
    expect(attempts).toBe(2);
    expect(res.done).toBe(1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("collect.ts drops post-duration manual caption cues before gap math and decodes HTML entities", () => {
  const timed = computeTranscriptTimingFromSegments(
    [
      { start: 0, duration: 4, text: "rock &amp; roll &quot;hit&quot; it&#39;s live" },
      { start: 5, duration: 5, text: "second clean sentence ends at ten" },
      { start: 35, duration: 3, text: "post duration stray subtitle" },
    ],
    20,
    false,
  );
  expect(timed).not.toBeNull();
  expect(timed!.text).toContain('rock & roll "hit" it\'s live');
  expect(timed!.text).not.toContain("amp");
  expect(timed!.text).not.toContain("stray");
  expect(timed!.timing.lastSpokenEndSec).toBe(10);
  expect(timed!.timing.maxGapSec).toBe(1);
  expect(timed!.timing.silenceGapCount).toBe(1);
  expect(timed!.timing.captionTailSec).toBe(10);
  expect(timed!.timing.activeSpeechWpm).toBe(66);
});

test("probeAudioBackfill marks failure when ffmpeg loudness probe returns null on an audio stream", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-r9b-probe-"));
  try {
    const cat = makeCatalog([
      {
        id: "audfail1",
        title: "Probe Fail",
        url: "https://youtube.com/shorts/audfail1",
        playlistIndex: 0,
        views: 15_000_000,
        likes: 300_000,
        durationSec: 30,
        uploadDate: "20260701",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    const vidDir = join(tmp, "videos", "audfail1");
    mkdirSync(vidDir, { recursive: true });
    writeJsonAtomic(join(vidDir, "telemetry.json"), makeSampleV2Telemetry());
    const initialMeta = {
      ...makeRecord("audfail1", "winner", 2, makeSampleV2Telemetry()).meta,
      sourceWidth: 1080,
      sourceHeight: 1920,
      sourceFps: 30,
    };
    writeJsonAtomic(join(vidDir, "meta.json"), initialMeta);
    const res = await probeAudioBackfill({
      channel: "r9b-probe",
      corpusDir: tmp,
      limit: 5,
      probeVideo: async () => ({
        durationSec: 30,
        hasAudioStream: true,
        sourceWidth: 1080,
        sourceHeight: 1920,
        sourceFps: 30,
        audioMetrics: null,
      }),
    });
    expect(res.probed).toBe(0);
    expect(res.failed).toBe(1);
    const saved = JSON.parse(readFileSync(join(vidDir, "meta.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(saved.audioMetrics).toBeUndefined();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("schema precedence and CLI validation guard upgradeBelow vs minSchema/expectSchema and empty model prefix", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-r9b-schema-"));
  try {
    const cat = makeCatalog([
      {
        id: "sc1",
        title: "Schema Prec",
        url: "https://youtube.com/shorts/sc1",
        playlistIndex: 0,
        views: 10_000_000,
        likes: 200_000,
        durationSec: 40,
        uploadDate: "20260701",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    let attempts = 0;
    const res = await runMine({
      channel: "r9b-sc",
      corpusDir: tmp,
      limit: 1,
      tabs: 1,
      model: "gemini-4-hydrogen",
      thinking: "High",
      media: "High",
      fps: 24,
      minSchema: 2,
      upgradeBelow: 3,
      runVideo: async (_v, _t, attempt) => {
        attempts = attempt;
        return {
          ok: true,
          markdown: makeSampleDossier(
            attempt === 1 ? makeSampleV2Telemetry() : makeSampleV3Telemetry(),
          ),
        };
      },
    });
    expect(attempts).toBe(2);
    expect(res.done).toBe(1);

    await expect(
      runMine({
        channel: "r9b-sc",
        corpusDir: tmp,
        limit: 1,
        tabs: 1,
        model: "gemini-4-hydrogen",
        thinking: "High",
        media: "High",
        fps: 24,
        expectSchema: 2,
        upgradeBelow: 3,
      }),
    ).rejects.toThrow("cannot be lower than");

    const badConflict = spawnSync(
      "bun",
      [CLI_PATH, "mine", "--channel", "demo", "--expect-schema", "2", "--upgrade-below", "3"],
      { encoding: "utf8" },
    );
    expect(badConflict.status).toBe(2);
    expect(badConflict.stderr).toContain("cannot be lower than");

    const badCliModel = spawnSync(
      "bun",
      [CLI_PATH, "mine", "--channel", "demo", "--model", "models/"],
      { encoding: "utf8" },
    );
    expect(badCliModel.status).toBe(2);
    expect(badCliModel.stderr).toContain("--model");

    const dummyVid = join(tmp, "dummy.mp4");
    writeFileSync(dummyVid, "0", "utf8");
    const gCli = join(SCRIPT_DIR, "gemini-api.ts");
    const badGemModel = spawnSync(
      "bun",
      [gCli, "--video", dummyVid, "--model", "models/", "--prompt", "hi"],
      { encoding: "utf8" },
    );
    expect(badGemModel.status).toBe(2);
    expect(badGemModel.stderr).toContain("--model cannot be empty");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 25_000);

test("cli status flags audio, 10Hz upgrade, and transcriptTiming staleness and clears after aggregate", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-r9b-status-"));
  try {
    const cat = makeCatalog([
      {
        id: "st1",
        title: "Status Audio Staleness",
        url: "https://youtube.com/shorts/st1",
        playlistIndex: 0,
        views: 15_000_000,
        likes: 300_000,
        durationSec: 40,
        uploadDate: "20260701",
        transcriptText: "A steady bridge holds weight cleanly until tension snaps the main beam.",
        wordCount: 12,
        wpm: 150,
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    const vidDir = join(tmp, "videos", "st1");
    mkdirSync(vidDir, { recursive: true });
    writeJsonAtomic(join(vidDir, "telemetry.json"), makeSampleV2Telemetry());
    writeFileSync(join(vidDir, "dossier.md"), makeSampleDossier(makeSampleV2Telemetry()), "utf8");
    const baseMeta = makeRecord("st1", "winner", 2, makeSampleV2Telemetry()).meta;
    writeJsonAtomic(join(vidDir, "meta.json"), baseMeta);
    const ck = loadCheckpoint(tmp, "r9b-st");
    ck.entries.st1 = {
      status: "done",
      chatUrl: null,
      attempts: 1,
      updatedAt: "2026-11-24T00:00:00.000Z",
    };
    saveCheckpoint(tmp, ck, cat);
    runAggregate(tmp, 2);
    const freshOut = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "r9b-st", "--corpus", tmp],
      {
        encoding: "utf8",
      },
    );
    expect(freshOut.status).toBe(0);
    expect(freshOut.stdout).not.toContain("stale");

    writeJsonAtomic(join(vidDir, "meta.json"), {
      ...baseMeta,
      audioMetrics: {
        integratedLufs: -14.2,
        loudnessRangeLu: 6.1,
        truePeakDbtp: -1.1,
        silenceCount: 0,
        totalSilenceSec: 0,
        isSilentTrack: false,
      },
    });
    const staleOut = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "r9b-st", "--corpus", tmp],
      {
        encoding: "utf8",
      },
    );
    expect(staleOut.status).toBe(0);
    expect(staleOut.stdout).toContain("stale: run aggregate");
    expect(staleOut.stdout).toContain("--min-schema 2");

    runAggregate(tmp, 2);
    const clearOut = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "r9b-st", "--corpus", tmp],
      {
        encoding: "utf8",
      },
    );
    expect(clearOut.status).toBe(0);
    expect(clearOut.stdout).not.toContain("stale");

    writeJsonAtomic(join(vidDir, "meta.json"), {
      ...baseMeta,
      audioMetrics: {
        integratedLufs: -14.2,
        loudnessRangeLu: 6.1,
        truePeakDbtp: -1.1,
        maxShortTermLufs: -11.8,
        plrDb: 13.1,
        silenceCount: 0,
        totalSilenceSec: 0,
        isSilentTrack: false,
      },
    });
    const stale10Hz = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "r9b-st", "--corpus", tmp],
      { encoding: "utf8" },
    );
    expect(stale10Hz.status).toBe(0);
    expect(stale10Hz.stdout).toContain("stale: run aggregate");

    runAggregate(tmp, 2);
    const catTimed = {
      ...cat,
      videos: cat.videos.map((v) => ({
        ...v,
        transcriptTiming: {
          firstSpokenSec: 0.2,
          lastSpokenEndSec: 39.2,
          spokenSec: 39,
          speakingCoveragePct: 97.5,
          maxGapSec: 0.2,
          silenceGapCount: 0,
          activeSpeechWpm: 150,
          lateToEarlyWpmRatio: 1.0,
          captionTailSec: 0.8,
          isGenerated: false,
        },
      })),
    };
    writeJsonAtomic(join(tmp, "catalog.json"), catTimed);
    const staleTiming = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "r9b-st", "--corpus", tmp],
      { encoding: "utf8" },
    );
    expect(staleTiming.status).toBe(0);
    expect(staleTiming.stdout).toContain("stale: run aggregate");

    runAggregate(tmp, 2);
    const finalClear = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "r9b-st", "--corpus", tmp],
      { encoding: "utf8" },
    );
    expect(finalClear.status).toBe(0);
    expect(finalClear.stdout).not.toContain("stale");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 25_000);

test("R9c hardening: ultra-long suggestedFps returns null, auto-caption maxGapSec excluded, and dated eraStability ignores pinned order", () => {
  const ultra = estimateUnifiedVideoTokens({ durationSec: 15_000, fps: 1, media: "High" });
  expect(ultra.suggestedFps).toBeNull();
  const res = resolveMiningFps({
    requestedFps: 1,
    durationSec: 15_000,
    media: "High",
    autoFps: true,
  });
  expect(res.ok).toBe(false);
  expect(res.suggestedFps).toBeNull();
  expect(res.error).toContain("--start/--end");

  const datedVideos = Array.from({ length: 16 }, (_, i) => ({
    id: `ed${i}`,
    title: `Dated Clip ${i}`,
    url: `https://youtube.com/shorts/ed${i}`,
    playlistIndex: i === 0 ? 0 : 16 - i,
    views: i === 0 ? 100_000 : 1_000_000 + i * 50_000,
    likes: 10_000,
    durationSec: 40,
    uploadDate: `202601${String(i + 1).padStart(2, "0")}`,
    transcriptText: "A short test line that plays clearly from start to end.",
    wordCount: 11,
    wpm: 150,
    transcriptTiming: {
      firstSpokenSec: 0.1,
      lastSpokenEndSec: 39,
      spokenSec: 38.9,
      speakingCoveragePct: 97.2,
      maxGapSec: 2.5,
      silenceGapCount: 2,
      activeSpeechWpm: 150,
      lateToEarlyWpmRatio: 1.0,
      captionTailSec: 1.0,
      isGenerated: true,
    },
  }));
  const datedCat = makeCatalog(datedVideos);
  const pkg = summarizeCatalogPackaging(datedCat.videos);
  expect(pkg.eraStability[0]?.medianViews).toBeLessThan(pkg.eraStability[3]!.medianViews);
  const ling = summarizeTranscriptLinguistics(datedCat.videos);
  expect(ling.transcriptTimingSummary?.medianMaxGapSec).toBeNull();
  expect(ling.transcriptTimingSummary?.medianSilenceGapCount).toBeNull();
});

test("v3 thumbnailArchetype uses v3WithThumbnail denominator and schema warns on thumbnail complexity/gaze mismatch", () => {
  const badMismatch = parseAndValidateDossier(
    makeSampleDossier(
      makeSampleV3Telemetry({
        thumbnail_archetype: "not_applicable_shorts_feed",
        thumbnail_focal_complexity: "single_hero_clean",
        thumbnail_gaze_or_cue: "face_direct_to_camera",
      }),
    ),
  );
  expect(badMismatch.valid).toBe(true);
  expect(badMismatch.warnings.some((w) => w.includes("thumbnail_focal_complexity"))).toBe(true);
  expect(badMismatch.warnings.some((w) => w.includes("thumbnail_gaze_or_cue"))).toBe(true);

  const cat = makeCatalog([
    {
      id: "th1",
      title: "Shorts Clip",
      url: "https://youtube.com/shorts/th1",
      playlistIndex: 0,
      views: 20_000_000,
      likes: 400_000,
      durationSec: 40,
      uploadDate: "20260701",
    },
    {
      id: "th2",
      title: "Longform Clip",
      url: "https://youtube.com/watch?v=th2",
      playlistIndex: 1,
      views: 10_000_000,
      likes: 200_000,
      durationSec: 600,
      uploadDate: "20260702",
    },
  ]);
  const rShort = makeRecord("th1", "winner", 2, makeSampleV3Telemetry());
  const rThumb = makeRecord(
    "th2",
    "flop",
    0.5,
    makeSampleV3Telemetry({
      thumbnail_archetype: "expressive_face_closeup",
      thumbnail_text_relation: "complementary_contrast_or_stakes",
      thumbnail_opening_payoff: "instant_visual_confirm_0_10s",
      thumbnail_focal_complexity: "single_hero_clean",
      thumbnail_gaze_or_cue: "face_gazing_at_focal",
      information_reveal_mode: "dramatic_irony_audience_knows",
    }),
  );
  const stats = aggregateCorpus(cat, [rShort, rThumb], 3);
  expect(stats.deepDna.v3DeepDna.v3ThumbnailVerifiedCount).toBe(1);
  expect(stats.deepDna.v3DeepDna.distributions.thumbnailArchetype.map((x) => x.key)).toEqual([
    "expressive_face_closeup",
  ]);
  expect(stats.deepDna.v3DeepDna.distributions.thumbnailFocalComplexity[0]?.key).toBe(
    "single_hero_clean",
  );
  expect(stats.deepDna.v3DeepDna.distributions.thumbnailGazeOrCue[0]?.key).toBe(
    "face_gazing_at_focal",
  );
  expect(
    stats.deepDna.v3DeepDna.distributions.informationRevealMode.map((x) => x.key).sort(),
  ).toEqual(["dramatic_irony_audience_knows", "progressive_withhold_reveal"]);

  const shortsOnly = aggregateCorpus(cat, [rShort], 3);
  const md = renderStatsSummaryMd(shortsOnly);
  expect(md).not.toContain("thumb_arch:");
  expect(md).toContain("info_reveal:progressive_withhold_reveal");
});

test("catalog-metrics handles CJK brackets, pipes, Unicode ALL-CAPS, display-unit truncation, and number/question modifiers", () => {
  expect(countTitleDisplayUnits("Why Bridges Collapse")).toBe(20);
  expect(countTitleDisplayUnits("【衝撃】絶対に知ってはいけない日本の秘密を徹底解説する動画")).toBe(
    58,
  );
  const cat = makeCatalog([
    {
      id: "u1",
      title: "【衝撃】秘密の実験 3つの理由？ | 完全解説",
      url: "https://youtube.com/watch?v=u1",
      playlistIndex: 0,
      views: 30_000_000,
      likes: 600_000,
      durationSec: 600,
      uploadDate: "20260701",
    },
    {
      id: "u2",
      title: "SỐC KHÔNG THỂ TIN ĐƯỢC: 5 Sự Thật?",
      url: "https://youtube.com/watch?v=u2",
      playlistIndex: 1,
      views: 25_000_000,
      likes: 500_000,
      durationSec: 600,
      uploadDate: "20260702",
    },
    {
      id: "u3",
      title: "INCREÍBLE truco en casa",
      url: "https://youtube.com/watch?v=u3",
      playlistIndex: 2,
      views: 5_000_000,
      likes: 50_000,
      durationSec: 600,
      uploadDate: "20260703",
    },
  ]);
  const pkg = summarizeCatalogPackaging(cat.videos);
  const mods = new Map(pkg.titleModifiers.map((m) => [m.modifier, m]));
  expect(mods.get("parenthetical_or_bracket_tag")?.n).toBe(1);
  expect(mods.get("two_part_colon_or_dash")?.n).toBe(2);
  expect(mods.get("all_caps_emphasis_word")?.n).toBe(2);
  expect(mods.get("question_mark")?.n).toBe(2);
  expect(mods.get("concrete_number")?.n).toBe(2);
  expect(pkg.titleCharBands.find((b) => b.band === "36-50 units")?.n).toBeGreaterThanOrEqual(1);
});

test("catalog-metrics computes universal exclamation/echo and English anaphora/POV-shift/modal stylistics", () => {
  const enCat = makeCatalog([
    {
      id: "st_e1",
      title: "Why Bridge Cables Snap",
      url: "https://youtube.com/shorts/st_e1",
      playlistIndex: 0,
      views: 40_000_000,
      likes: 800_000,
      durationSec: 40,
      uploadDate: "20260701",
      transcriptText:
        "He pulled the loose steel cable until the bridge bent sideways. His hands shook as he braced the frame. If you stepped onto your lane, the cable would snap instantly. You would feel the bridge drop under your feet.",
      wordCount: 40,
      wpm: 150,
    },
    {
      id: "st_e2",
      title: "Strange Trap Door",
      url: "https://youtube.com/shorts/st_e2",
      playlistIndex: 1,
      views: 4_000_000,
      likes: 40_000,
      durationSec: 40,
      uploadDate: "20260702",
      transcriptText:
        "Watch this crazy trick! Every single hinge drops flat! When you press the pins, they slide back fast. Your latch holds them tight against your palm.",
      wordCount: 26,
      wpm: 150,
    },
  ]);
  const enLing = summarizeTranscriptLinguistics(enCat.videos);
  expect(enLing.exclamationVideoPct).toBe(50);
  expect(enLing.openingClosingEchoPct).toBe(50);
  expect(enLing.titleClosingEchoPct).toBe(50);
  expect(enLing.englishProfile?.barePronounOpenerPct).toBe(50);
  expect(enLing.englishProfile?.midScriptPovShiftVideoPct).toBe(50);
  expect(enLing.englishProfile?.hypotheticalModalVideoPct).toBe(50);

  const cjkCat = makeCatalog([
    {
      id: "st_j1",
      title: "橋のケーブルの秘密",
      url: "https://youtube.com/shorts/st_j1",
      playlistIndex: 0,
      views: 20_000_000,
      likes: 400_000,
      durationSec: 40,
      uploadDate: "20260701",
      transcriptText: "橋のケーブルが急に伸びた！最後にそのケーブルが切れた。",
      wordCount: 18,
      wpm: 150,
    },
  ]);
  const cjkLing = summarizeTranscriptLinguistics(cjkCat.videos);
  expect(cjkLing.isEnglishCorpus).toBe(false);
  expect(cjkLing.exclamationVideoPct).toBe(100);
  expect(cjkLing.openingClosingEchoPct).toBe(100);
  expect(cjkLing.titleClosingEchoPct).toBe(100);
});

test("shot-spine classifies hard-cut mechanisms, tightens continuous bridges, and computes universal editArchitecture", () => {
  expect(classifyHardCutMechanism("f1597→f1599")).toBe("unspecified");
  expect(classifyHardCutMechanism("broll_cutaway")).toBe("broll_cutaway");
  expect(classifyHardCutMechanism("jump_cut")).toBe("jump_cut_or_punch_in");
  expect(classifyHardCutMechanism("punch_in")).toBe("jump_cut_or_punch_in");
  expect(classifyHardCutMechanism("match_cut")).toBe("match_cut");
  expect(classifyHardCutMechanism("angle_switch")).toBe("angle_or_scale_cut");
  expect(classifyHardCutMechanism("scene_change")).toBe("scene_or_location_change");
  expect(classifyHardCutMechanism("graphic_card")).toBe("graphic_or_text_card");

  expect(classifyContinuousBridgeMechanism("window fly-in")).toBe("pass_through_or_xray");
  expect(classifyContinuousBridgeMechanism("pull-through windshield")).toBe("pass_through_or_xray");
  expect(classifyContinuousBridgeMechanism("rewind time-remap")).toBe("time_remap_bridge");
  expect(classifyContinuousBridgeMechanism("slow-mo impact & hat float")).toBe("time_remap_bridge");
  expect(classifyContinuousBridgeMechanism("forward push")).toBe("push_in_or_pull_back");
  expect(classifyContinuousBridgeMechanism("tilt & charge")).toBe("whip_or_snap_pan");
  expect(classifyContinuousBridgeMechanism("drop to puddle")).toBe("tracking_or_follow");
  expect(classifyContinuousBridgeMechanism("camera settle")).toBe("staging_or_action_beat");

  const cat = makeCatalog([
    {
      id: "hc1",
      title: "Essay Cutaway",
      url: "https://youtube.com/watch?v=hc1",
      playlistIndex: 0,
      views: 30_000_000,
      likes: 600_000,
      durationSec: 20,
      uploadDate: "20260701",
    },
  ]);
  const tel = makeSampleV2Telemetry({
    duration_sec: 20,
    boundary_counts: { hard_cut: 6, hidden_cut: 0, transition: 0, continuous: 1 },
    shot_scale_counts: { EW: 0, W: 1, M: 5, MCU: 1, CU: 1, ECU: 0, INSERT: 0 },
    camera_angle_counts: { aerial: 0, overhead: 0, high: 0, eye: 8, low: 0, ground: 0 },
  });
  const md = [
    "### 1. Hook, Packaging & Channel Soul Summary",
    "- Test",
    "### 2. Narrative Arc, Retention Beats & Directorial Intent",
    "| Beat | Time & Frames | Pct | Narrative & Script Function | Directorial Intent |",
    "| --- | --- | --- | --- | --- |",
    "| hook | 00:00.000-00:20.000 (f0-f600) | 100% | Test | Test |",
    "### 3. Macro Shot, Boundary & Craft Pattern Spine",
    "| ID | Time & Frames | Boundary | Scale / Angle | Camera, Motion & Dominant Craft `[Category]` | Conf |",
    "| --- | --- | --- | --- | --- | --- |",
    "| S01 | 00:00.000-00:02.500 (f0-f75) | Opening | M / eye | Host talking `[Camera, Framing & Staging]` | High |",
    "| S02 | 00:02.500-00:05.000 (f75-f150) | Hard Cut (broll_cutaway) | W / eye | B-roll `[VFX, Cutaways & Graphics]` | High |",
    "| S03 | 00:05.000-00:07.500 (f150-f225) | Hard Cut (jump_cut) | M / eye | Jump cut `[Transitions & Continuity]` | High |",
    "| S04 | 00:07.500-00:10.000 (f225-f300) | Hard Cut (punch_in) | MCU / eye | Punch in `[Camera, Framing & Staging]` | High |",
    "| S05 | 00:10.000-00:12.500 (f300-f375) | Hard Cut (match_cut) | CU / eye | Match cut `[Transitions & Continuity]` | High |",
    "| S06 | 00:12.500-00:15.000 (f375-f450) | Hard Cut (angle_switch) | M / eye | Reverse `[Camera, Framing & Staging]` | High |",
    "| S07 | 00:15.000-00:17.500 (f450-f525) | Hard Cut (graphic_card) | M / eye | Chart `[VFX, Cutaways & Graphics]` | High |",
    "| S08 | 00:17.500-00:20.000 (f525-f600) | Continuous [NO CUT] (window fly-in) | M / eye | Fly in `[Camera, Framing & Staging]` | High |",
    "### 4. Structured Telemetry JSON",
    "```json",
    JSON.stringify(tel),
    "```",
  ].join("\n");
  const rec = { ...makeRecord("hc1", "winner", 2, tel), dossierMarkdown: md };
  const stats = aggregateCorpus(cat, [rec], 2);
  expect(stats.deepDna.boundaries.editArchitecture.hardCutDominant.pct).toBe(100);
  expect(stats.deepDna.boundaries.editArchitecture.fastCutPace.pct).toBe(100);
  expect(stats.deepDna.shotSpine.hardCutMechanisms.map((h) => h.mechanism).sort()).toEqual([
    "angle_or_scale_cut",
    "broll_cutaway",
    "graphic_or_text_card",
    "jump_cut_or_punch_in",
    "match_cut",
  ]);
  expect(renderStatsSummaryMd(stats)).toContain("| Hard Cut Mechanism |");
});

test("lateToEarlyWpmRatio uses active spoken span rather than raw intro/outro duration", () => {
  const steadyWithSilentOutro = computeTranscriptTimingFromSegments(
    [
      { start: 0, duration: 4, text: "one two three four five six" },
      { start: 4, duration: 4, text: "one two three four five six" },
      { start: 8, duration: 4, text: "one two three four five six" },
      { start: 12, duration: 4, text: "one two three four five six" },
      { start: 16, duration: 4, text: "one two three four five six" },
      { start: 20, duration: 4, text: "one two three four five six" },
    ],
    34,
    false,
  )!;
  expect(steadyWithSilentOutro.timing.lateToEarlyWpmRatio).toBe(1);

  const steadyWithSilentIntro = computeTranscriptTimingFromSegments(
    [
      { start: 5, duration: 4, text: "one two three four five six" },
      { start: 9, duration: 4, text: "one two three four five six" },
      { start: 13, duration: 4, text: "one two three four five six" },
      { start: 17, duration: 4, text: "one two three four five six" },
      { start: 21, duration: 4, text: "one two three four five six" },
      { start: 25, duration: 4, text: "one two three four five six" },
    ],
    30,
    false,
  )!;
  expect(steadyWithSilentIntro.timing.lateToEarlyWpmRatio).toBe(1);

  const lateAccel = computeTranscriptTimingFromSegments(
    [
      { start: 0, duration: 6, text: "slow start four words" },
      { start: 6, duration: 6, text: "steady mid six words right here" },
      { start: 12, duration: 6, text: "rapid climax bursts out ten fast words right at finish" },
      { start: 18, duration: 6, text: "second rapid climax bursts out ten more words right now" },
    ],
    30,
    false,
  )!;
  expect(lateAccel.timing.lateToEarlyWpmRatio!).toBeGreaterThan(1.5);
});

test("computeOutlierScores prevents enrichment-split tier flips on /videos, handles 30 young uploads, and rejects root channel tabs", () => {
  const rawVideos: RawCatalogVideo[] = Array.from({ length: 60 }, (_, i) => ({
    id: `hv${String(i).padStart(2, "0")}`,
    title: `Horizontal Clip ${i}`,
    url: `https://www.youtube.com/watch?v=hv${String(i).padStart(2, "0")}`,
    playlistIndex: i,
    views: i < 20 ? 1_000_000 : 1_000_000 + (i % 5) * 200_000,
    likes: null,
    durationSec: 120,
    uploadDate: i < 30 ? "20261115" : "20260701",
    enrichedMature: i < 30 ? false : true,
    width: null,
    height: null,
    wordCount: null,
    wpm: null,
    transcriptText: null,
  }));
  const baseline = computeOutlierScores(
    rawVideos,
    "2026-11-24",
    "https://www.youtube.com/@demo/videos",
  );
  const partialEnriched = rawVideos.map((v, i) =>
    i >= 30 && i % 2 === 0 ? { ...v, width: 1920, height: 1080 } : v,
  );
  const afterEnrich = computeOutlierScores(
    partialEnriched,
    "2026-11-24",
    "https://www.youtube.com/@demo/videos",
  );
  const baseById = new Map(baseline.videos.map((v) => [v.id, v]));
  for (const v of afterEnrich.videos) {
    const prev = baseById.get(v.id)!;
    expect(v.tier).toBe(prev.tier);
    expect(v.outlierRolling).toBe(prev.outlierRolling);
  }
  const youngTop = afterEnrich.videos.find((v) => v.id === "hv00")!;
  expect(youngTop.outlierRolling).toBeGreaterThan(0);

  expect(() =>
    assertNotRootChannelEntries(
      [{ _type: "playlist", id: "UC12345678901234567890" }],
      "https://www.youtube.com/@demo",
    ),
  ).toThrow("/videos or /shorts");
});

test("mannWhitneyTwoSided guards dominantCraftMix against single-video shot clustering and storyDynamics computes BH-FDR qValue", () => {
  expect(mannWhitneyTwoSided([10, 12, 14, 16, 18], [1, 2, 3, 4, 5])).toBeLessThan(0.02);
  expect(mannWhitneyTwoSided([5, 5, 5], [5, 5, 5])).toBe(1);

  const mkDossierWithAvShots = (avCount: number, totalRows: number) => {
    const rows = Array.from({ length: totalRows }, (_, i) => {
      const cat = i < avCount ? "Audio-Visual Sync & Soundscape" : "Camera, Framing & Staging";
      const bd = i === 0 ? "Opening" : "Continuous [NO CUT] (push_in)";
      return `| S${String(i + 1).padStart(2, "0")} | 00:${String(i).padStart(2, "0")}.000-00:${String(i + 1).padStart(2, "0")}.000 (f${i * 30}-f${(i + 1) * 30}) | ${bd} | M / eye | Shot ${i} \`[${cat}]\` | High |`;
    });
    const tel = makeSampleV2Telemetry({
      duration_sec: totalRows,
      boundary_counts: { hard_cut: 0, hidden_cut: 0, transition: 0, continuous: totalRows - 1 },
      shot_scale_counts: { EW: 0, W: 0, M: totalRows, MCU: 0, CU: 0, ECU: 0, INSERT: 0 },
      camera_angle_counts: { aerial: 0, overhead: 0, high: 0, eye: totalRows, low: 0, ground: 0 },
    });
    return {
      tel,
      md: [
        "### 1. Hook, Packaging & Channel Soul Summary",
        "- Test",
        "### 2. Narrative Arc, Retention Beats & Directorial Intent",
        "| Beat | Time & Frames | Pct | Narrative & Script Function | Directorial Intent |",
        "| --- | --- | --- | --- | --- |",
        `| hook | 00:00.000-00:${String(totalRows).padStart(2, "0")}.000 (f0-f${totalRows * 30}) | 100% | Test | Test |`,
        "### 3. Macro Shot, Boundary & Craft Pattern Spine",
        "| ID | Time & Frames | Boundary | Scale / Angle | Camera, Motion & Dominant Craft `[Category]` | Conf |",
        "| --- | --- | --- | --- | --- | --- |",
        ...rows,
        "### 4. Structured Telemetry JSON",
        "```json",
        JSON.stringify(tel),
        "```",
      ].join("\n"),
    };
  };

  const vids = Array.from({ length: 12 }, (_, i) => ({
    id: `cl${i}`,
    title: `Bridge Cable Cluster ${i}`,
    url: `https://youtube.com/shorts/cl${i}`,
    playlistIndex: i,
    views: i < 6 ? 30_000_000 - i * 1_000_000 : 3_000_000 - i * 100_000,
    likes: 100_000,
    durationSec: 20,
    uploadDate: "20260701",
  }));
  const cat = makeCatalog(vids);
  const recs = vids.map((v, i) => {
    const isFlopBurst = i === 11;
    const { tel, md } = mkDossierWithAvShots(isFlopBurst ? 15 : 0, 20);
    if (i < 3) {
      tel.story_beats = [
        { role: "hook", start_sec: 0, end_sec: 4, pct_runtime: 20 },
        { role: "escalation", start_sec: 4, end_sec: 10, pct_runtime: 30 },
        { role: "escalation", start_sec: 10, end_sec: 16, pct_runtime: 30 },
        { role: "twist", start_sec: 16, end_sec: 20, pct_runtime: 20 },
      ];
      tel.opening_spoken_line = "This bridge cable bends first.";
    } else {
      tel.opening_spoken_line = "Something strange happens here.";
    }
    return {
      ...makeRecord(v.id, i < 6 ? "winner" : "flop", i < 6 ? 2.5 : 0.3, tel),
      dossierMarkdown: md,
    };
  });
  const stats = aggregateCorpus(cat, recs, 2);
  const avPillar = stats.deepDna.shotSpine.dominantCraftMix.categories.find(
    (c) => c.category === "Audio-Visual Sync & Soundscape",
  )!;
  expect(avPillar.pValue).toBeGreaterThan(0.3);
  expect(avPillar.videoPrevalencePct).toBe(8.3);
  expect(stats.deepDna.storyDynamics.stackedLoopSharePct.qValue).not.toBeNull();
  expect(stats.deepDna.storyDynamics.openingLineAnchor.qValue).not.toBeNull();
  expect(stats.deepDna.storyDynamics.stackedLoopSharePct.qValue!).toBeGreaterThanOrEqual(
    stats.deepDna.storyDynamics.stackedLoopSharePct.pValue!,
  );
});

test("burnTimecode720 macroOutputFps downsamples encode cleanly while preserving native sourceFps", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-macro-burn-"));
  try {
    const src = join(tmp, "src30.mp4");
    const out = join(tmp, "out2fps.mp4");
    const gen = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x180:d=2:r=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        src,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    expect(gen.status).toBe(0);
    const burned = await burnTimecode720(src, out, { macroOutputFps: 2 });
    expect(burned.hasAudioStream).toBe(true);
    expect(burned.sourceFps).toBeCloseTo(30, 0);
    expect(burned.encodedFps).toBe(2);
    expect(burned.hasFrameCounter).toBe(false);
    expect(burned.durationSec).toBeGreaterThanOrEqual(1.8);
    const probeOut = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=avg_frame_rate,codec_type", "-of", "json", out],
      { encoding: "utf8", windowsHide: true },
    );
    const parsedOut = JSON.parse(probeOut.stdout) as {
      streams?: Array<{ codec_type?: string; avg_frame_rate?: string }>;
    };
    const vOut = parsedOut.streams?.find((s) => s.codec_type === "video");
    const [n, d] = (vOut?.avg_frame_rate ?? "0/1").split("/").map(Number);
    expect(n! / d!).toBeLessThanOrEqual(2.5);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 25_000);

test("gemini-api fails closed on dropped SSE finishReason, abnormal finishReason, zero-duration STATIC, and out-of-range --start", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-gem-fc-"));
  try {
    const fakeMp4 = join(tmp, "clip.mp4");
    writeFileSync(fakeMp4, "not-a-valid-mp4-container", "utf8");
    const makeStreamMock = (sseBody: string) =>
      (async (url: string) => {
        if (url.includes("/upload/v1beta/files")) {
          return new Response(null, {
            status: 200,
            headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/ok" },
          });
        }
        if (url.endsWith("/upload/ok")) {
          return new Response(
            JSON.stringify({
              file: {
                name: "files/fc1",
                uri: "https://generativelanguage.googleapis.com/v1beta/files/fc1",
                state: "ACTIVE",
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes(":streamGenerateContent")) {
          return new Response(sseBody, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

    const droppedSse = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "half" }] } }] })}\n\n`;
    await expect(
      runGeminiApiVideo({
        videoPath: fakeMp4,
        durationSec: 2,
        expectAudio: false,
        systemPrompt: "sys",
        userPrompt: "hi",
        model: "gemini-4-hydrogen",
        thinking: "High",
        media: "High",
        fps: 24,
        stream: true,
        apiKey: "test-key",
        fetchImpl: makeStreamMock(droppedSse),
      }),
    ).rejects.toThrow("missing_stream_terminator");

    const otherSse = `data: ${JSON.stringify({ candidates: [{ finishReason: "OTHER", content: { parts: [{ text: "partial" }] } }] })}\n\n`;
    await expect(
      runGeminiApiVideo({
        videoPath: fakeMp4,
        durationSec: 2,
        expectAudio: false,
        systemPrompt: "sys",
        userPrompt: "hi",
        model: "gemini-4-hydrogen",
        thinking: "High",
        media: "High",
        fps: 24,
        stream: true,
        apiKey: "test-key",
        fetchImpl: makeStreamMock(otherSse),
      }),
    ).rejects.toThrow("finishReason=OTHER");

    const gCli = join(SCRIPT_DIR, "gemini-api.ts");
    const unreadable = spawnSync("bun", [gCli, "--video", fakeMp4, "--prompt", "hi"], {
      encoding: "utf8",
    });
    expect(unreadable.status).toBe(1);
    expect(unreadable.stderr).toContain("ffprobe failed");

    const validMp4 = join(tmp, "valid2s.mp4");
    spawnSync(
      "ffmpeg",
      ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=2:r=10", validMp4],
      { windowsHide: true },
    );
    const badStart = spawnSync(
      "bun",
      [gCli, "--video", validMp4, "--start", "5", "--prompt", "hi"],
      { encoding: "utf8" },
    );
    expect(badStart.status).toBe(2);
    expect(badStart.stderr).toContain("--start");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 25_000);

test("cli status detects partial legacy-to-10Hz audioMetrics upgrade via shortTermSampleN", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-part10hz-"));
  try {
    const cat = makeCatalog([
      {
        id: "p1",
        title: "Part One",
        url: "https://youtube.com/shorts/p1",
        playlistIndex: 0,
        views: 20_000_000,
        likes: 400_000,
        durationSec: 40,
        uploadDate: "20260701",
      },
      {
        id: "p2",
        title: "Part Two",
        url: "https://youtube.com/shorts/p2",
        playlistIndex: 1,
        views: 15_000_000,
        likes: 300_000,
        durationSec: 40,
        uploadDate: "20260702",
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), cat);
    const ck = loadCheckpoint(tmp, "part10");
    for (const [idx, id] of (["p1", "p2"] as const).entries()) {
      const vd = join(tmp, "videos", id);
      mkdirSync(vd, { recursive: true });
      writeJsonAtomic(join(vd, "telemetry.json"), makeSampleV2Telemetry());
      writeFileSync(join(vd, "dossier.md"), makeSampleDossier(makeSampleV2Telemetry()), "utf8");
      const base = makeRecord(id, "winner", 2, makeSampleV2Telemetry()).meta;
      writeJsonAtomic(join(vd, "meta.json"), {
        ...base,
        audioMetrics:
          idx === 0
            ? {
                integratedLufs: -14,
                loudnessRangeLu: 6,
                truePeakDbtp: -1.2,
                maxShortTermLufs: -12,
                silenceCount: 0,
                totalSilenceSec: 0,
                isSilentTrack: false,
              }
            : {
                integratedLufs: -14.5,
                loudnessRangeLu: 5.5,
                truePeakDbtp: -1.1,
                silenceCount: 0,
                totalSilenceSec: 0,
                isSilentTrack: false,
              },
      });
      ck.entries[id] = {
        status: "done",
        chatUrl: null,
        attempts: 1,
        updatedAt: "2026-11-24T00:00:00.000Z",
      };
    }
    saveCheckpoint(tmp, ck, cat);
    runAggregate(tmp, 2);
    const before = spawnSync("bun", [CLI_PATH, "status", "--channel", "part10", "--corpus", tmp], {
      encoding: "utf8",
    });
    expect(before.stdout).not.toContain("stale");

    const base2 = makeRecord("p2", "winner", 2, makeSampleV2Telemetry()).meta;
    writeJsonAtomic(join(tmp, "videos", "p2", "meta.json"), {
      ...base2,
      audioMetrics: {
        integratedLufs: -14.5,
        loudnessRangeLu: 5.5,
        truePeakDbtp: -1.1,
        maxShortTermLufs: -11.5,
        silenceCount: 0,
        totalSilenceSec: 0,
        isSilentTrack: false,
      },
    });
    const afterUpgrade = spawnSync(
      "bun",
      [CLI_PATH, "status", "--channel", "part10", "--corpus", tmp],
      { encoding: "utf8" },
    );
    expect(afterUpgrade.stdout).toContain("stale: run aggregate");
    runAggregate(tmp, 2);
    const cleared = spawnSync("bun", [CLI_PATH, "status", "--channel", "part10", "--corpus", tmp], {
      encoding: "utf8",
    });
    expect(cleared.stdout).not.toContain("stale");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 25_000);

test("burnTimecode720 never upsamples native low-FPS video when macroOutputFps >= sourceFps", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-lowfps-noupsample-"));
  try {
    const src = join(tmp, "src6.mp4");
    const out = join(tmp, "out6.mp4");
    const gen = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=green:s=320x180:d=2:r=6",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        src,
      ],
      { encoding: "utf8" },
    );
    expect(gen.status).toBe(0);
    const burned = await burnTimecode720(src, out, { macroOutputFps: 24 });
    expect(burned.sourceFps).toBeGreaterThan(5);
    expect(burned.sourceFps).toBeLessThan(7);
    expect(burned.encodedFps).toBeCloseTo(burned.sourceFps, 1);
    expect(burned.hasFrameCounter).toBe(true);
    const probeOut = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=avg_frame_rate,codec_type", "-of", "json", out],
      { encoding: "utf8", windowsHide: true },
    );
    const parsedOut = JSON.parse(probeOut.stdout) as {
      streams?: Array<{ codec_type?: string; avg_frame_rate?: string }>;
    };
    const vOut = parsedOut.streams?.find((s) => s.codec_type === "video");
    const [n, d] = (vOut?.avg_frame_rate ?? "0/1").split("/").map(Number);
    const outFps = n! / d!;
    expect(outFps).toBeGreaterThan(5);
    expect(outFps).toBeLessThan(7);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 25_000);

test("R10 edge-case guards: partial transcriptTiming backfill, multi-twist coherence, thumbnail set guard, and unspaced fullwidth pipe", () => {
  const legacyTimingVideo: RawCatalogVideo = {
    id: "lt1",
    title: "タイトル｜解説",
    url: "https://youtube.com/shorts/lt1",
    views: 100_000,
    likes: 3_000,
    durationSec: 40,
    uploadDate: "20260701",
    playlistIndex: 0,
    transcriptText: "hello world test script",
    transcriptTiming: {
      firstSpokenSec: 0.2,
      lastSpokenEndSec: 38.5,
      speakingCoveragePct: 95,
      silenceGapCount: 1,
      maxGapSec: 0.9,
      isGenerated: false,
    },
  };
  const targets = selectTranscriptTargets([legacyTimingVideo], 10, "2026-11-24", {
    backfillTiming: true,
  });
  expect(targets.map((v) => v.id)).toEqual(["lt1"]);

  const multiTwistTel: VideoTelemetry = {
    ...makeSampleV3Telemetry(),
    duration_sec: 40,
    twist_at_pct: 75,
    story_beats: [
      { role: "hook", start_sec: 0, end_sec: 4, pct_runtime: 10 },
      { role: "twist", start_sec: 12, end_sec: 16, pct_runtime: 10 },
      { role: "escalation", start_sec: 16, end_sec: 30, pct_runtime: 35 },
      { role: "twist", start_sec: 30, end_sec: 36, pct_runtime: 15 },
      { role: "resolution", start_sec: 36, end_sec: 40, pct_runtime: 30 },
    ],
  };
  const multiTwistRes = parseAndValidateDossier(makeSampleDossier(multiTwistTel));
  expect(multiTwistRes.valid).toBe(true);
  expect(multiTwistRes.warnings.some((w) => w.includes("twist_at_pct"))).toBe(false);

  const badThumbTel = {
    ...makeSampleV3Telemetry(),
    thumbnail_archetype: "not_applicable_shorts_feed" as const,
    thumbnail_gaze_or_cue: "bogus_enum_value",
  } as unknown as VideoTelemetry;
  const badThumbRes = parseAndValidateDossier(makeSampleDossier(badThumbTel));
  expect(badThumbRes.valid).toBe(false);
  expect(badThumbRes.warnings.some((w) => w.includes("thumbnail_gaze_or_cue"))).toBe(false);

  const pkgCat = makeCatalog([legacyTimingVideo]);
  const pkg = summarizeCatalogPackaging(pkgCat.videos);
  const twoPart = pkg.titleModifiers.find((m) => m.modifier === "two_part_colon_or_dash");
  expect(twoPart?.n).toBe(1);
});

test("Wave 4 Domain 1: flat-playlist thumbnail extraction, YouTube CDN fallback, and expectThumbnail fail-closed guard", async () => {
  expect(
    extractFlatThumbnailUrl({
      thumbnails: [
        { url: "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg", width: 480, height: 360 },
        { url: "https://i.ytimg.com/vi/abc12345678/maxresdefault.jpg", width: 1280, height: 720 },
      ],
    }),
  ).toBe("https://i.ytimg.com/vi/abc12345678/maxresdefault.jpg");

  const mergedEntry = mergeCatalogEntry(
    undefined,
    {
      id: "abc12345678",
      title: "Why Bridges Sway",
      duration: 600,
      thumbnails: [
        { url: "https://i.ytimg.com/vi/abc12345678/sddefault.jpg", width: 640, height: 480 },
      ],
    },
    "https://www.youtube.com/watch?v=abc12345678",
    0,
  );
  expect(mergedEntry.thumbnailUrl).toBe("https://i.ytimg.com/vi/abc12345678/sddefault.jpg");

  expect(
    shouldAttachThumbnail({
      id: "abc12345678",
      url: "https://www.youtube.com/watch?v=abc12345678",
      thumbnailUrl: null,
      width: 1920,
      height: 1080,
      durationSec: 600,
    }),
  ).toBe(true);
  expect(
    shouldAttachThumbnail(
      {
        id: "shrt1234567",
        url: "https://www.youtube.com/shorts/shrt1234567",
        thumbnailUrl: null,
        width: 720,
        height: 1280,
        durationSec: 40,
      },
      { withThumbnail: true },
    ),
  ).toBe(true);
  expect(
    shouldAttachThumbnail({
      url: "https://www.youtube.com/watch?v=abc12345678",
      thumbnailUrl: null,
      width: 1920,
      height: 1080,
      durationSec: 600,
    }),
  ).toBe(false);

  const cands = resolveThumbnailCandidates({ id: "abc12345678", thumbnailUrl: null });
  expect(cands).toEqual([
    "https://i.ytimg.com/vi/abc12345678/maxresdefault.jpg",
    "https://i.ytimg.com/vi/abc12345678/sddefault.jpg",
    "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg",
  ]);

  const tmp = mkdtempSync(join(tmpdir(), "cdna-thumb-fb-"));
  try {
    const requested: string[] = [];
    const saved = await downloadThumbnailWithFallback(cands, join(tmp, "thumb"), async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("maxresdefault.jpg")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });
    expect(requested).toEqual([
      "https://i.ytimg.com/vi/abc12345678/maxresdefault.jpg",
      "https://i.ytimg.com/vi/abc12345678/sddefault.jpg",
    ]);
    expect(saved).toBe(join(tmp, "thumb.jpg"));
    expect(existsSync(saved!)).toBe(true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const shortsTel = makeSampleV3Telemetry();
  const missThumbCheck = parseAndValidateDossier(makeSampleDossier(shortsTel), {
    expectThumbnail: true,
  });
  expect(missThumbCheck.valid).toBe(false);
  expect(missThumbCheck.errors.some((e) => e.includes("thumbnail image was attached"))).toBe(true);

  const concreteThumbTel: VideoTelemetry = {
    ...shortsTel,
    thumbnail_archetype: "object_or_anomaly_hero",
    thumbnail_text_relation: "complementary_contrast_or_stakes",
    thumbnail_opening_payoff: "instant_visual_confirm_0_10s",
    thumbnail_focal_complexity: "two_to_three_balanced",
    thumbnail_gaze_or_cue: "clean_scene_no_face",
  };
  const ghostThumbCheck = parseAndValidateDossier(makeSampleDossier(concreteThumbTel), {
    expectThumbnail: false,
  });
  expect(ghostThumbCheck.valid).toBe(false);
  expect(ghostThumbCheck.errors.some((e) => e.includes("no thumbnail image was attached"))).toBe(
    true,
  );
  expect(
    parseAndValidateDossier(makeSampleDossier(concreteThumbTel), { expectThumbnail: true }).valid,
  ).toBe(true);
});

test("Wave 4 Domains 1 & 7: CJK display-unit consistency, non-space word-band suppression, leading badge stripping, and emoji=2 width", () => {
  expect(countTitleDisplayUnits("Why Bridges Collapse 😮")).toBe(23);
  expect(countTitleWords("【衝撃】秘密の実験")).toBeGreaterThanOrEqual(2);
  expect(countTitleWords("「本当の話」")).toBeGreaterThanOrEqual(2);
  expect(extractTrailingEmoji("秘密の実験😱！")).toBe("😱");
  expect(classifyTitleOpener("[NEW] Why Bridges Collapse")).toBe("Why ...");

  const jpCat = makeCatalog([
    {
      id: "jp1",
      title: "【衝撃】絶対に知ってはいけない日本の秘密😱！",
      url: "https://youtube.com/watch?v=jp1",
      playlistIndex: 0,
      views: 30_000_000,
      likes: 600_000,
      durationSec: 400,
      uploadDate: "20260701",
    },
    {
      id: "jp2",
      title: "「本当の話」誰も知らない工場の裏側",
      url: "https://youtube.com/watch?v=jp2",
      playlistIndex: 1,
      views: 5_000_000,
      likes: 80_000,
      durationSec: 400,
      uploadDate: "20260702",
    },
  ]);
  const pkg = summarizeCatalogPackaging(jpCat.videos);
  expect(pkg.isNonSpaceTitles).toBe(true);
  expect(pkg.titleWordBands).toEqual([]);
  expect(pkg.titleSummary.medianTitleDisplayUnits).toBeGreaterThan(
    pkg.titleSummary.medianTitleChars!,
  );
  expect(pkg.titleCharBands.every((b) => b.band.endsWith("units"))).toBe(true);

  const agg = aggregateCorpus(jpCat, []);
  const md = renderStatsSummaryMd(agg);
  expect(md).toContain("median display units (CJK/emoji=2)");
  expect(md).toContain("| Title Display-Unit Band (CJK/emoji=2) |");
  expect(md).not.toContain("| Title Word Band |");
});

test("Wave 4 Domains 2 & 7: auto-caption punctuation guard, Hindi/Arabic/NFD tokens, positional POV shift, and BCP-47 fallback", () => {
  const chunk = "the steel engine pushes the rod and the piston turns fast";
  const unpunctuatedBlob = `${Array.from({ length: 12 }, () => chunk).join(" ")}? ${Array.from({ length: 12 }, () => chunk).join(" ")}`;
  const blobSents = splitPunctuatedSentences(unpunctuatedBlob);
  expect(hasReliableSentencePunctuation(blobSents, 264, true)).toBe(false);
  const cleanedBlob = cleanTranscriptText(unpunctuatedBlob, true);
  expect(segmentWords(cleanedBlob.openingSentence!).length).toBeLessThanOrEqual(18);

  const abbrevSents = splitPunctuatedSentences(
    "Dr. Smith from U.S.A. tested e.g. steel beams at 10 ft. height. Then he stopped.",
  );
  expect(abbrevSents.length).toBe(2);

  expect(splitPunctuatedSentences("क्यों पुल हिलते हैं। यह हवा के कारण होता है।").length).toBe(2);
  expect(countSharedContentWords("क्यों पुल हिलते हैं", "यह पुल हवा में हिलते हैं।")).toBe(2);
  expect(
    countSharedContentWords("NFD cầu treo".normalize("NFD"), "chiếc cầu treo".normalize("NFC")),
  ).toBe(2);
  expect(classifyOpeningSentence("لماذا تنهار الجسور؟")).toBe("question");

  const longUnpunctCat = makeCatalog([
    {
      id: "asr1",
      title: "Engine Breakdown",
      url: "https://youtube.com/watch?v=asr1",
      playlistIndex: 0,
      views: 20_000_000,
      likes: 400_000,
      durationSec: 120,
      uploadDate: "20260701",
      transcriptText: unpunctuatedBlob,
      openingTranscriptLine: unpunctuatedBlob.slice(0, 800),
      wordCount: 240,
      wpm: 120,
      transcriptTiming: {
        firstSpokenSec: 0.2,
        lastSpokenEndSec: 118,
        speakingCoveragePct: 95,
        maxGapSec: null,
        silenceGapCount: null,
        isGenerated: true,
        activeSpeechWpm: 122,
        lateToEarlyWpmRatio: 1.0,
        captionTailSec: 2.0,
      },
    },
    {
      id: "inanim2",
      title: "Why Fries Crisp Up",
      url: "https://youtube.com/shorts/inanim2",
      playlistIndex: 1,
      views: 30_000_000,
      likes: 600_000,
      durationSec: 40,
      uploadDate: "20260702",
      transcriptText:
        "If you drop fries in hot oil, they bubble fast. Your pan heats them through in seconds. Then you lift them onto your towel. They lock in your crunch immediately.",
      wordCount: 31,
      wpm: 150,
    },
  ]);
  const ling = summarizeTranscriptLinguistics(longUnpunctCat.videos);
  expect(ling.punctuatedSampleN).toBe(1);
  expect(ling.englishProfile?.midScriptPovShiftVideoPct).toBe(0);

  expect(canonicalizeBcp47Tag("zh-hans")).toBe("zh-Hans");
  expect(canonicalizeBcp47Tag("pt_br")).toBe("pt-BR");
  expect(
    resolveEffectiveTranscriptLanguages(undefined, [
      {
        id: "c1",
        title: "a",
        url: "https://youtube.com/watch?v=c1",
        playlistIndex: 0,
        views: 1,
        likes: null,
        durationSec: 40,
        uploadDate: null,
        detectedLanguage: "zh-hans",
      },
      {
        id: "c2",
        title: "b",
        url: "https://youtube.com/watch?v=c2",
        playlistIndex: 1,
        views: 1,
        likes: null,
        durationSec: 40,
        uploadDate: null,
        detectedLanguage: "zh-Hans",
      },
      {
        id: "c3",
        title: "c",
        url: "https://youtube.com/watch?v=c3",
        playlistIndex: 2,
        views: 1,
        likes: null,
        durationSec: 40,
        uploadDate: null,
        detectedLanguage: "zh-Hans",
      },
    ]),
  ).toEqual(["zh-Hans", "zh", "en", "en-US", "en-GB"]);

  const pyCode = buildTranscriptFetcherPyCode();
  expect(pyCode).toContain("api.list(vid)");
  expect(pyCode).toContain("allow_fallback");
  const pyCheck = spawnSync(
    "uv",
    [
      "run",
      "--no-project",
      "python",
      "-I",
      "-c",
      "import sys; compile(sys.argv[1], '<transcript_fetcher>', 'exec'); print('OK')",
      pyCode,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15_000 },
  );
  expect(pyCheck.status).toBe(0);
  expect(pyCheck.stdout.trim()).toBe("OK");
});

test("Wave 4 Domains 5 & 7: FPS-stratified edit metrics, zero-denominator dashes, 10Hz float tolerance, indented JSON fence, and activeSpeechSampleN status", () => {
  expect(extractJsonBlock('```json\n{"ok":true}\n  ```')).toBe('{"ok":true}');

  const stderr10Hz = [
    "[Parsed_ebur128_0 @ 0x1] t: 0.6     TARGET:-23 LUFS    M: -14.0 S: -14.0",
    "[Parsed_ebur128_0 @ 0x1] t: 3.0     TARGET:-23 LUFS    M: -14.0 S: -14.0",
    "[Parsed_ebur128_0 @ 0x1] t: 5.0     TARGET:-23 LUFS    M: -14.0 S: -14.0",
    "[Parsed_ebur128_0 @ 0x1] t: 7.0     TARGET:-23 LUFS    M: -14.0 S: -14.0",
    "[Parsed_ebur128_0 @ 0x1] t: 9.0     TARGET:-23 LUFS    M: -14.0 S: -14.0",
    "[Parsed_ebur128_0 @ 0x1] t: 10.1    TARGET:-23 LUFS    M: -30.0 S: -16.0",
    "[Parsed_ebur128_0 @ 0x1] t: 10.2    TARGET:-23 LUFS    M: -31.0 S: -17.0",
    "[Parsed_ebur128_0 @ 0x1] t: 10.3    TARGET:-23 LUFS    M: -14.0 S: -14.5",
    "[Parsed_ebur128_0 @ 0x1] t: 15.0    TARGET:-23 LUFS    M: -14.0 S: -14.0",
    "[Parsed_ebur128_0 @ 0x1] t: 18.0    TARGET:-23 LUFS    M: -14.0 S: -14.0",
    "[Parsed_ebur128_0 @ 0x1] t: 21.0    TARGET:-23 LUFS    M: -14.0 S: -14.0",
    "[Parsed_ebur128_0 @ 0x1] t: 25.0    TARGET:-23 LUFS    M: -14.0 S: -14.0",
    "Summary:",
    "  Integrated loudness:",
    "    I:         -14.0 LUFS",
    "    Threshold: -24.0 LUFS",
    "  Loudness range:",
    "    LRA:         3.0 LU",
    "  True peak:",
    "    Peak:       -1.5 dBFS",
  ].join("\n");
  const loud = parseAudioLoudnessStderr(stderr10Hz, 25);
  expect(loud?.relativeDropCount).toBe(1);

  const cat = makeCatalog([
    {
      id: "mic1",
      title: "Micro Short",
      url: "https://youtube.com/shorts/mic1",
      playlistIndex: 0,
      views: 40_000_000,
      likes: 800_000,
      durationSec: 30,
      uploadDate: "20260701",
    },
    {
      id: "mac2",
      title: "Macro Essay",
      url: "https://youtube.com/watch?v=mac2",
      playlistIndex: 1,
      views: 4_000_000,
      likes: 40_000,
      durationSec: 600,
      uploadDate: "20260702",
    },
  ]);
  const microRec: MinedRecord = {
    meta: {
      id: "mic1",
      title: "Micro Short",
      url: "https://youtube.com/shorts/mic1",
      views: 40_000_000,
      likes: 800_000,
      durationSec: 30,
      uploadDate: "20260701",
      outlierRolling: 2.0,
      outlierGlobal: 2.0,
      tier: "winner",
      wordCount: 70,
      wpm: 140,
      minedAt: "2026-11-24T00:00:00Z",
      model: "gemini-4-hydrogen",
      thinking: "XHIGH",
      media: "High",
      fps: 24,
      promptVersion: "v4",
      chatUrl: null,
      elapsedSec: 10,
      attempts: 1,
      hasAudioStream: true,
      miningMode: "micro_24fps",
      warnings: [],
    },
    telemetry: {
      ...makeSampleV3Telemetry(),
      duration_sec: 30,
      boundary_counts: { hard_cut: 6, hidden_cut: 0, transition: 0, continuous: 0 },
    },
  };
  const macroRec: MinedRecord = {
    meta: {
      ...microRec.meta,
      id: "mac2",
      title: "Macro Essay",
      url: "https://youtube.com/watch?v=mac2",
      durationSec: 600,
      tier: "flop",
      outlierRolling: 0.4,
      outlierGlobal: 0.4,
      fps: 2,
      hasAudioStream: false,
      miningMode: "macro_lowfps",
    },
    telemetry: {
      ...makeSampleV3Telemetry(),
      duration_sec: 600,
      boundary_counts: { hard_cut: 2, hidden_cut: 0, transition: 0, continuous: 0 },
    },
  };

  const mixedAgg = aggregateCorpus(cat, [microRec, macroRec]);
  expect(mixedAgg.deepDna.editFpsMode).toBe("micro_24fps");
  expect(mixedAgg.deepDna.editSampleN).toBe(1);
  expect(mixedAgg.deepDna.editMacroExcludedCount).toBe(1);
  expect(mixedAgg.deepDna.pacingAndTiming.medianEditCutsPerMin).toBe(12);
  const mixedMd = renderStatsSummaryMd(mixedAgg);
  expect(mixedMd).toContain("N=1 micro_24fps; excluded 1 macro_lowfps");

  const macroOnlyAgg = aggregateCorpus(cat, [macroRec]);
  expect(macroOnlyAgg.deepDna.editFpsMode).toBe("macro_lowfps");
  expect(macroOnlyAgg.deepDna.editSampleN).toBe(1);
  const macroOnlyMd = renderStatsSummaryMd(macroOnlyAgg);
  expect(macroOnlyMd).toContain("macro_lowfps scene/chapter-level");
  expect(macroOnlyMd).toContain("| has_pre_impact_silence | 0 | 0 (directional) | - |");
  expect(macroOnlyMd).toContain("| uses_motion_blur | 0 | 0 (directional) | - |");

  const tmp = mkdtempSync(join(tmpdir(), "cdna-actwpm-status-"));
  try {
    const timedCat = makeCatalog([
      {
        id: "tw1",
        title: "Timed Clip 1",
        url: "https://youtube.com/shorts/tw1",
        playlistIndex: 0,
        views: 20_000_000,
        likes: 400_000,
        durationSec: 40,
        uploadDate: "20260701",
        transcriptText: "He tested the steel latch before pulling it open.",
        wordCount: 9,
        wpm: 135,
        transcriptTiming: {
          firstSpokenSec: 0.2,
          lastSpokenEndSec: 38.0,
          speakingCoveragePct: 95,
          maxGapSec: 0.3,
          silenceGapCount: 0,
          isGenerated: false,
          activeSpeechWpm: 145,
          lateToEarlyWpmRatio: 1.0,
          captionTailSec: 2.0,
        },
      },
      {
        id: "tw2",
        title: "Timed Clip 2",
        url: "https://youtube.com/shorts/tw2",
        playlistIndex: 1,
        views: 18_000_000,
        likes: 350_000,
        durationSec: 40,
        uploadDate: "20260702",
        transcriptText: "She checked the steel lock before opening the gate.",
        wordCount: 9,
        wpm: 135,
        transcriptTiming: {
          firstSpokenSec: 0.2,
          lastSpokenEndSec: 38.0,
          speakingCoveragePct: 95,
          maxGapSec: 0.3,
          silenceGapCount: 0,
          isGenerated: false,
        },
      },
    ]);
    writeJsonAtomic(join(tmp, "catalog.json"), timedCat);
    runAggregate(tmp, 1);
    const before = spawnSync("bun", [CLI_PATH, "status", "--channel", "actwpm", "--corpus", tmp], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(before.stdout).not.toContain("stale");

    timedCat.videos[1]!.transcriptTiming = {
      ...timedCat.videos[1]!.transcriptTiming!,
      activeSpeechWpm: 148,
    };
    writeJsonAtomic(join(tmp, "catalog.json"), timedCat);
    const stale = spawnSync("bun", [CLI_PATH, "status", "--channel", "actwpm", "--corpus", tmp], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(stale.stdout).toContain("stale: run aggregate");
    runAggregate(tmp, 1);
    const after = spawnSync("bun", [CLI_PATH, "status", "--channel", "actwpm", "--corpus", tmp], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(after.stdout).not.toContain("stale");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 25_000);

test("gemini-api key pool takes precedence over env vars, rotates round-robin cursor, and persists gmn-compatible state.json", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-pool-rr-"));
  const poolDir = join(tmp, "gmn");
  const mp4 = join(tmp, "clip.mp4");
  mkdirSync(poolDir, { recursive: true });
  writeFileSync(mp4, "fake-mp4");
  writeJsonAtomic(join(poolDir, "config.json"), {
    model: "gemini-3.5-flash",
    keys: [
      { label: "acct-a", value: "AIzaSy-secret-alpha-000000000000000001" },
      { label: "acct-b", value: "AIzaSy-secret-beta-0000000000000000002" },
      { label: "acct-c", value: "AQ.secret-gamma-0000000000000000000003" },
    ],
  });
  writeJsonAtomic(join(poolDir, "state.json"), {
    cursor: 1,
    dead: {},
    until: {},
    stats: { "acct-a": { ok: 4, fail: 0, lastUsed: "2026-11-24T00:00:00.000Z" } },
  });

  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevGmnDir = process.env.GMN_CONFIG_DIR;
  try {
    process.env.GEMINI_API_KEY = "env-should-be-ignored-when-pool-has-keys";
    process.env.GOOGLE_API_KEY = "google-env-should-be-ignored";
    process.env.GMN_CONFIG_DIR = poolDir;

    expect(resolveGeminiApiKey()).toBe("AIzaSy-secret-beta-0000000000000000002");

    const usedKeys: string[] = [];
    const okFetch = async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.endsWith("/upload/v1beta/files")) {
        usedKeys.push(headers["x-goog-api-key"] ?? "");
        return new Response("", {
          status: 200,
          headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/rr" },
        });
      }
      if (url === "https://generativelanguage.googleapis.com/upload/rr") {
        return new Response(
          JSON.stringify({
            file: { name: "files/rr1", uri: "https://example/rr1", state: "ACTIVE" },
          }),
          { status: 200 },
        );
      }
      if (url.includes(":generateContent")) {
        return new Response(
          JSON.stringify({
            candidates: [{ finishReason: "STOP", content: { parts: [{ text: "ok reply" }] } }],
            usageMetadata: {
              promptTokenCount: 14_000,
              candidatesTokenCount: 20,
              promptTokensDetails: [{ modality: "VIDEO", tokenCount: 13_440 }],
            },
          }),
          { status: 200 },
        );
      }
      if (init?.method === "DELETE") return new Response("{}", { status: 200 });
      return new Response("not found", { status: 404 });
    };

    const first = await runGeminiApiVideo({
      videoPath: mp4,
      durationSec: 2,
      sourceFps: 24,
      systemPrompt: "",
      userPrompt: "go",
      model: "gemini-4-hydrogen",
      thinking: "High",
      media: "High",
      fps: 24,
      pollIntervalMs: 1,
      fetchImpl: okFetch,
    });
    expect(first.markdown).toBe("ok reply");
    expect(first.keyLabel).toBe("acct-b");
    expect(usedKeys).toEqual(["AIzaSy-secret-beta-0000000000000000002"]);

    const second = await runGeminiApiVideo({
      videoPath: mp4,
      durationSec: 2,
      sourceFps: 24,
      systemPrompt: "",
      userPrompt: "go",
      model: "gemini-4-hydrogen",
      thinking: "High",
      media: "High",
      fps: 24,
      pollIntervalMs: 1,
      fetchImpl: okFetch,
    });
    expect(second.keyLabel).toBe("acct-c");
    expect(usedKeys).toEqual([
      "AIzaSy-secret-beta-0000000000000000002",
      "AQ.secret-gamma-0000000000000000000003",
    ]);

    const savedState = JSON.parse(readFileSync(join(poolDir, "state.json"), "utf8")) as {
      cursor: number;
      dead: Record<string, unknown>;
      until: Record<string, number>;
      stats: Record<string, { ok: number; fail: number; lastUsed?: string }>;
    };
    expect(savedState.cursor).toBe(0);
    expect(savedState.stats["acct-a"]?.ok).toBe(4);
    expect(savedState.stats["acct-b"]?.ok).toBe(1);
    expect(savedState.stats["acct-c"]?.ok).toBe(1);
    expect(typeof savedState.stats["acct-c"]?.lastUsed).toBe("string");
  } finally {
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
    if (prevGmnDir === undefined) delete process.env.GMN_CONFIG_DIR;
    else process.env.GMN_CONFIG_DIR = prevGmnDir;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("gemini-api rotates keys on 403/401/400-invalid (marks dead), 429 (sets cooldown), 503/SSE-503 (switches key), and deletes each key's own uploaded file", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-pool-rot-"));
  const poolDir = join(tmp, "gmn");
  const mp4 = join(tmp, "clip.mp4");
  mkdirSync(poolDir, { recursive: true });
  writeFileSync(mp4, "fake-mp4");
  const k1 = "AIzaSy-dead-key-000000000000000000000001";
  const k2 = "AIzaSy-rate-key-000000000000000000000002";
  const k3 = "AIzaSy-busy-key-000000000000000000000003";
  const k4 = "AIzaSy-good-key-000000000000000000000004";
  writeJsonAtomic(join(poolDir, "config.json"), {
    keys: [
      { label: "k-dead", value: k1 },
      { label: "k-rate", value: k2 },
      { label: "k-busy", value: k3 },
      { label: "k-good", value: k4 },
    ],
  });

  try {
    const deletedByKey: Array<{ file: string; key: string }> = [];
    let uploadSeq = 0;
    const fileOwner = new Map<string, string>();
    const res = await runGeminiApiVideo({
      videoPath: mp4,
      durationSec: 2,
      sourceFps: 24,
      systemPrompt: "",
      userPrompt: "go",
      model: "gemini-4-hydrogen",
      thinking: "High",
      media: "High",
      fps: 24,
      stream: true,
      keyPoolDir: poolDir,
      pollIntervalMs: 1,
      switchDelayMs: 0,
      roundDelaysMs: [0],
      fetchImpl: async (url, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const apiKey = headers["x-goog-api-key"] ?? "";
        if (url.endsWith("/upload/v1beta/files")) {
          if (apiKey === k1) {
            return new Response(
              JSON.stringify({
                error: { status: "PERMISSION_DENIED", message: "API key revoked" },
              }),
              { status: 403 },
            );
          }
          uploadSeq++;
          fileOwner.set(`u${uploadSeq}`, apiKey);
          return new Response("", {
            status: 200,
            headers: {
              "x-goog-upload-url": `https://generativelanguage.googleapis.com/upload/u${uploadSeq}`,
            },
          });
        }
        if (url.startsWith("https://generativelanguage.googleapis.com/upload/u")) {
          const id = url.slice(url.lastIndexOf("/") + 1);
          return new Response(
            JSON.stringify({
              file: { name: `files/${id}`, uri: `https://example/${id}`, state: "ACTIVE" },
            }),
            { status: 200 },
          );
        }
        if (url.includes(":streamGenerateContent")) {
          if (apiKey === k2) {
            return new Response(
              JSON.stringify({
                error: {
                  status: "RESOURCE_EXHAUSTED",
                  message: "Quota exceeded",
                  details: [{ retryDelay: "42s" }],
                },
              }),
              { status: 429 },
            );
          }
          if (apiKey === k3) {
            return new Response(
              `data: ${JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "high demand" } })}\n\n`,
              { status: 200 },
            );
          }
          return new Response(
            `data: ${JSON.stringify({
              candidates: [{ finishReason: "STOP", content: { parts: [{ text: "survived" }] } }],
              usageMetadata: {
                promptTokenCount: 14_000,
                candidatesTokenCount: 10,
                promptTokensDetails: [{ modality: "VIDEO", tokenCount: 13_440 }],
              },
            })}\n\n`,
            { status: 200 },
          );
        }
        if (init?.method === "DELETE") {
          const name = url.slice(url.indexOf("files/"));
          deletedByKey.push({ file: name, key: apiKey });
          return new Response("{}", { status: 200 });
        }
        return new Response("not found", { status: 404 });
      },
    });

    expect(res.markdown).toBe("survived");
    expect(res.keyLabel).toBe("k-good");
    expect(deletedByKey).toEqual([
      { file: "files/u1", key: k2 },
      { file: "files/u2", key: k3 },
      { file: "files/u3", key: k4 },
    ]);

    const state = JSON.parse(readFileSync(join(poolDir, "state.json"), "utf8")) as {
      cursor: number;
      dead: Record<string, { reason: string; at: string }>;
      until: Record<string, number>;
      stats: Record<string, { ok: number; fail: number; lastError?: string }>;
    };
    expect(state.dead["k-dead"]?.reason).toContain("403");
    expect(state.dead["k-dead"]?.reason).not.toContain(k1);
    expect(state.dead["k-rate"]).toBeUndefined();
    expect(state.until["k-rate"]).toBeGreaterThan(Date.now() + 20_000);
    expect(state.dead["k-busy"]).toBeUndefined();
    expect(state.until["k-busy"]).toBeUndefined();
    expect(state.stats["k-busy"]?.fail).toBe(1);
    expect(state.stats["k-good"]?.ok).toBe(1);
    expect(state.cursor).toBe(0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("persistent generation overload stops before trying every key or uploading more copies", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-overload-"));
  const mp4 = join(tmp, "clip.mp4");
  writeFileSync(mp4, "fake-mp4");
  const keys = Array.from({ length: 9 }, (_, i) => ({
    label: `project-${i}`,
    value: `test-credential-not-a-real-key-${i}`,
  }));
  writeJsonAtomic(join(tmp, "config.json"), { keys });
  let uploaded = 0;
  let deleted = 0;
  let requested = 0;
  try {
    await expect(
      runGeminiApiVideo({
        videoPath: mp4,
        durationSec: 2,
        systemPrompt: "",
        userPrompt: "compare",
        model: "gemini-4-hydrogen",
        thinking: "High",
        media: "High",
        fps: 24,
        keyPoolDir: tmp,
        stream: true,
        switchDelayMs: 0,
        roundDelaysMs: [0],
        retryBaseMs: 0,
        fetchImpl: async (url, init) => {
          if (init?.method === "DELETE") {
            deleted++;
            return new Response("{}");
          }
          if (url.endsWith("/upload/v1beta/files")) {
            return new Response("", {
              headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/test" },
            });
          }
          if (url.endsWith("/upload/test")) {
            uploaded++;
            return Response.json({ file: { name: `files/test${uploaded}`, uri: "https://example.test/file", state: "ACTIVE" } });
          }
          requested++;
          const error = { code: 503, status: "UNAVAILABLE", message: "The model is overloaded" };
          return requested % 2 === 0
            ? new Response(`data: ${JSON.stringify({ error })}\n\n`)
            : Response.json({ error }, { status: 503 });
        },
      }),
    ).rejects.toThrow(/Gemini API unavailable.*gemini-4-hydrogen.*5.*retry later/i);
    expect(requested).toBe(5);
    expect(uploaded).toBe(5);
    expect(deleted).toBe(5);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test.each(["body timeout", "request deadline"])("Gemini capacity handling honors %s", async (scenario) => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-capacity-"));
  const mp4 = join(tmp, "clip.mp4");
  writeFileSync(mp4, "fake-mp4");
  writeJsonAtomic(join(tmp, "config.json"), {
    keys: ["one", "two"].map((label) => ({ label, value: `test-key-${label}` })),
  });
  let requests = 0;
  let deleted = 0;
  try {
    const isDeadline = scenario === "request deadline";
    const run = runGeminiApiVideo({
      videoPath: mp4, durationSec: 2, systemPrompt: "", userPrompt: "compare",
      model: "gemini-4-hydrogen", thinking: "High", media: "High", fps: 24,
      keyPoolDir: tmp, switchDelayMs: 0, deadlineMs: isDeadline ? 100 : 10_000,
      fetchImpl: async (url, init) => {
        if (init?.method === "DELETE") {
          deleted++;
          expect(init.signal?.aborted).toBe(false);
          return new Response("{}");
        }
        if (url.endsWith("/upload/v1beta/files")) {
          return new Response("", { headers: {
            "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/test",
          } });
        }
        if (url.endsWith("/upload/test")) {
          return Response.json({ file: { name: "files/test", uri: "https://example.test/file", state: "ACTIVE" } });
        }
        requests++;
        if (isDeadline) {
          await Bun.sleep(160);
          init?.signal?.throwIfAborted();
        } else if (requests === 1) {
          return new Response(new ReadableStream({
            start(controller) { controller.error(new DOMException("read stalled", "TimeoutError")); },
          }));
        }
        return Response.json({
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: "review ready" }] } }],
          usageMetadata: { promptTokenCount: 14_000, promptTokensDetails: [{ modality: "VIDEO", tokenCount: 13_440 }] },
        });
      },
    });
    if (isDeadline) {
      await expect(run).rejects.toThrow(/deadline/);
      expect(requests).toBe(1);
      expect(deleted).toBe(1);
    } else {
      expect((await run).markdown).toBe("review ready");
      expect(requests).toBe(2);
      expect(deleted).toBe(2);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("gemini-api fails fast on non-key errors (400 bad payload, MAX_TOKENS) without rotating or penalizing keys", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-pool-fastfail-"));
  const poolDir = join(tmp, "gmn");
  const mp4 = join(tmp, "clip.mp4");
  mkdirSync(poolDir, { recursive: true });
  writeFileSync(mp4, "fake-mp4");
  writeJsonAtomic(join(poolDir, "config.json"), {
    keys: [
      { label: "k1", value: "AIzaSy-fastfail-key-00000000000000000001" },
      { label: "k2", value: "AIzaSy-fastfail-key-00000000000000000002" },
    ],
  });

  try {
    const seenKeys: string[] = [];
    await expect(
      runGeminiApiVideo({
        videoPath: mp4,
        durationSec: 2,
        sourceFps: 24,
        systemPrompt: "",
        userPrompt: "go",
        model: "gemini-4-hydrogen",
        thinking: "High",
        media: "High",
        fps: 24,
        keyPoolDir: poolDir,
        pollIntervalMs: 1,
        switchDelayMs: 0,
        fetchImpl: async (url, init) => {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          if (url.endsWith("/upload/v1beta/files")) {
            seenKeys.push(headers["x-goog-api-key"] ?? "");
            return new Response("", {
              status: 200,
              headers: {
                "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/ff",
              },
            });
          }
          if (url === "https://generativelanguage.googleapis.com/upload/ff") {
            return new Response(
              JSON.stringify({
                file: { name: "files/ff1", uri: "https://example/ff1", state: "ACTIVE" },
              }),
              { status: 200 },
            );
          }
          if (url.includes(":generateContent")) {
            return new Response(
              JSON.stringify({
                error: { status: "INVALID_ARGUMENT", message: "Request payload too large" },
              }),
              { status: 400 },
            );
          }
          if (init?.method === "DELETE") return new Response("{}", { status: 200 });
          return new Response("not found", { status: 404 });
        },
      }),
    ).rejects.toThrow(/INVALID_ARGUMENT/);

    expect(seenKeys).toEqual(["AIzaSy-fastfail-key-00000000000000000001"]);
    expect(existsSync(join(poolDir, "state.json"))).toBe(false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("gemini-api marks 401 and 400 API_KEY_INVALID dead, rotates 404 model errors in one round without marking dead, and merges concurrent state.json edits", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-pool-edge-"));
  const poolDir = join(tmp, "gmn");
  const mp4 = join(tmp, "clip.mp4");
  mkdirSync(poolDir, { recursive: true });
  writeFileSync(mp4, "fake-mp4");
  const k401 = "AIzaSy-unauth-key-0000000000000000000001";
  const k400 = "AIzaSy-invalid-key-000000000000000000002";
  const k404 = "AIzaSy-nomodel-key-000000000000000000003";
  const kOk = "AIzaSy-healthy-key-000000000000000000004";
  writeJsonAtomic(join(poolDir, "config.json"), {
    keys: [
      { label: "k401", value: k401 },
      { label: "k400", value: k400 },
      { label: "k404", value: k404 },
      { label: "kOk", value: kOk },
    ],
  });

  try {
    const res = await runGeminiApiVideo({
      videoPath: mp4,
      durationSec: 2,
      sourceFps: 24,
      systemPrompt: "",
      userPrompt: "go",
      model: "gemini-4-hydrogen",
      thinking: "High",
      media: "High",
      fps: 24,
      keyPoolDir: poolDir,
      pollIntervalMs: 1,
      switchDelayMs: 0,
      roundDelaysMs: [0],
      fetchImpl: async (url, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const apiKey = headers["x-goog-api-key"] ?? "";
        if (url.endsWith("/upload/v1beta/files")) {
          if (apiKey === k401) {
            return new Response(
              JSON.stringify({ error: { status: "UNAUTHENTICATED", message: "Missing auth" } }),
              { status: 401 },
            );
          }
          if (apiKey === k400) {
            return new Response(
              JSON.stringify({
                error: {
                  status: "INVALID_ARGUMENT",
                  message: "API key not valid. Please pass a valid API key.",
                  details: [{ reason: "API_KEY_INVALID" }],
                },
              }),
              { status: 400 },
            );
          }
          return new Response("", {
            status: 200,
            headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/e1" },
          });
        }
        if (url === "https://generativelanguage.googleapis.com/upload/e1") {
          return new Response(
            JSON.stringify({
              file: { name: "files/e1", uri: "https://example/e1", state: "ACTIVE" },
            }),
            { status: 200 },
          );
        }
        if (url.includes(":generateContent")) {
          if (apiKey === k404) {
            return new Response(
              JSON.stringify({ error: { status: "NOT_FOUND", message: "model not found" } }),
              { status: 404 },
            );
          }
          const current = JSON.parse(readFileSync(join(poolDir, "state.json"), "utf8")) as {
            cursor: number;
            dead: Record<string, unknown>;
            until: Record<string, number>;
            stats: Record<string, { ok: number; fail: number }>;
          };
          current.stats["external-peer"] = { ok: 7, fail: 0 };
          writeJsonAtomic(join(poolDir, "state.json"), current);
          return new Response(
            JSON.stringify({
              candidates: [{ finishReason: "STOP", content: { parts: [{ text: "edge ok" }] } }],
              usageMetadata: {
                promptTokenCount: 14_000,
                candidatesTokenCount: 15,
                promptTokensDetails: [{ modality: "VIDEO", tokenCount: 13_440 }],
              },
            }),
            { status: 200 },
          );
        }
        if (init?.method === "DELETE") return new Response("{}", { status: 200 });
        return new Response("not found", { status: 404 });
      },
    });
    expect(res.markdown).toBe("edge ok");
    expect(res.keyLabel).toBe("kOk");
    const st = JSON.parse(readFileSync(join(poolDir, "state.json"), "utf8")) as {
      dead: Record<string, { reason: string }>;
      stats: Record<string, { ok: number; fail: number }>;
    };
    expect(st.dead.k401).toBeDefined();
    expect(st.dead.k400).toBeDefined();
    expect(st.dead.k404).toBeUndefined();
    expect(st.stats.k404?.fail).toBe(1);
    expect(st.stats["external-peer"]?.ok).toBe(7);

    let gen404Calls = 0;
    await expect(
      runGeminiApiVideo({
        videoPath: mp4,
        durationSec: 2,
        sourceFps: 24,
        systemPrompt: "",
        userPrompt: "go",
        model: "gemini-nonexistent",
        thinking: "High",
        media: "High",
        fps: 24,
        keyPoolDir: poolDir,
        rounds: 3,
        pollIntervalMs: 1,
        switchDelayMs: 0,
        roundDelaysMs: [0],
        fetchImpl: async (url, init) => {
          if (url.endsWith("/upload/v1beta/files")) {
            return new Response("", {
              status: 200,
              headers: {
                "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/m404",
              },
            });
          }
          if (url === "https://generativelanguage.googleapis.com/upload/m404") {
            return new Response(
              JSON.stringify({
                file: { name: "files/m404", uri: "https://example/m404", state: "ACTIVE" },
              }),
              { status: 200 },
            );
          }
          if (url.includes(":generateContent")) {
            gen404Calls++;
            return new Response(
              JSON.stringify({ error: { status: "NOT_FOUND", message: "model not found" } }),
              { status: 404 },
            );
          }
          if (init?.method === "DELETE") return new Response("{}", { status: 200 });
          return new Response("not found", { status: 404 });
        },
      }),
    ).rejects.toThrow(/404|NOT_FOUND/i);
    expect(gen404Calls).toBe(2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("gemini-api pool exhaustion maps cleanly to mine.ts haltReason (quota vs bot_or_auth vs 503 outage) and parallel tabs pick distinct keys", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cdna-pool-mine-"));
  const poolDir = join(tmp, "gmn");
  const corpusDir = join(tmp, "corpus");
  const mp4 = join(tmp, "sample.mp4");
  mkdirSync(poolDir, { recursive: true });
  mkdirSync(corpusDir, { recursive: true });
  writeFileSync(mp4, "fake-mp4");
  const kA = "AIzaSy-par-key-a-00000000000000000000001";
  const kB = "AIzaSy-par-key-b-00000000000000000000002";
  writeJsonAtomic(join(poolDir, "config.json"), {
    keys: [
      { label: "par-a", value: kA },
      { label: "par-b", value: kB },
    ],
  });
  writeJsonAtomic(
    join(corpusDir, "catalog.json"),
    makeCatalog([
      {
        id: "p1",
        title: "Parallel 1 😱",
        url: "https://youtube.com/shorts/p1",
        views: 25_000_000,
        likes: 800_000,
        durationSec: 40,
        uploadDate: "20260901",
        playlistIndex: 0,
      },
      {
        id: "p2",
        title: "Parallel 2 🤔",
        url: "https://youtube.com/shorts/p2",
        views: 12_000_000,
        likes: 400_000,
        durationSec: 40,
        uploadDate: "20260902",
        playlistIndex: 1,
      },
    ]),
  );

  try {
    const goodMd = makeSampleDossier(makeSampleV3Telemetry());
    const activeStarts: string[] = [];
    let releaseGate!: () => void;
    const bothStarted = new Promise<void>((res) => {
      releaseGate = res;
    });
    const parRes = await runMine({
      channel: "pool-par",
      corpusDir,
      limit: 2,
      tabs: 2,
      backend: "gemini-api",
      keyPoolDir: poolDir,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      prepareMedia: async () => ({
        tcMp4: mp4,
        hasAudioStream: true,
        durationSec: 40,
        sourceFps: 30,
      }),
      fetchImpl: async (url, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const apiKey = headers["x-goog-api-key"] ?? "";
        if (url.endsWith("/upload/v1beta/files")) {
          activeStarts.push(apiKey);
          if (activeStarts.length === 2) releaseGate();
          await Promise.race([bothStarted, Bun.sleep(500)]);
          return new Response("", {
            status: 200,
            headers: {
              "x-goog-upload-url": `https://generativelanguage.googleapis.com/upload/${apiKey === kA ? "a" : "b"}`,
            },
          });
        }
        if (url.startsWith("https://generativelanguage.googleapis.com/upload/")) {
          const suffix = url.endsWith("/a") ? "a" : "b";
          return new Response(
            JSON.stringify({
              file: { name: `files/${suffix}`, uri: `https://example/${suffix}`, state: "ACTIVE" },
            }),
            { status: 200 },
          );
        }
        if (url.includes(":generateContent")) {
          return new Response(
            JSON.stringify({
              candidates: [{ finishReason: "STOP", content: { parts: [{ text: goodMd }] } }],
              usageMetadata: {
                promptTokenCount: 270_000,
                candidatesTokenCount: 1500,
                promptTokensDetails: [
                  { modality: "VIDEO", tokenCount: 268_800 },
                  { modality: "AUDIO", tokenCount: 1000 },
                ],
              },
            }),
            { status: 200 },
          );
        }
        if (init?.method === "DELETE") return new Response("{}", { status: 200 });
        return new Response("not found", { status: 404 });
      },
    });
    expect(parRes.done).toBe(2);
    expect(new Set(activeStarts).size).toBe(2);

    writeJsonAtomic(join(poolDir, "state.json"), {
      cursor: 0,
      dead: {},
      until: { "par-a": Date.now() + 60_000, "par-b": Date.now() + 60_000 },
      stats: {},
    });
    const coolCorpus = join(tmp, "corpus-cool");
    mkdirSync(coolCorpus, { recursive: true });
    writeJsonAtomic(
      join(coolCorpus, "catalog.json"),
      makeCatalog([
        {
          id: "c1",
          title: "Cool 1 😱",
          url: "https://youtube.com/shorts/c1",
          views: 25_000_000,
          likes: 800_000,
          durationSec: 40,
          uploadDate: "20260901",
          playlistIndex: 0,
        },
      ]),
    );
    const coolHalt = await runMine({
      channel: "pool-cool",
      corpusDir: coolCorpus,
      limit: 1,
      tabs: 1,
      backend: "gemini-api",
      keyPoolDir: poolDir,
      model: "gemini-4-hydrogen",
      thinking: "Extra High",
      media: "High",
      fps: 24,
      prepareMedia: async () => ({
        tcMp4: mp4,
        hasAudioStream: true,
        durationSec: 40,
        sourceFps: 30,
      }),
      fetchImpl: async () => new Response("should not be called", { status: 500 }),
    });
    expect(coolHalt.done).toBe(0);
    expect(coolHalt.quotaHalted).toBe(true);
    expect(coolHalt.haltReason).toBe("quota");

    writeJsonAtomic(join(poolDir, "state.json"), {
      cursor: 0,
      dead: {
        "par-a": { reason: "403", at: "2026-11-25T00:00:00.000Z" },
        "par-b": { reason: "403", at: "2026-11-25T00:00:00.000Z" },
      },
      until: {},
      stats: {},
    });
    let prepWhenAllDead = 0;
    await expect(
      runMine({
        channel: "pool-dead",
        corpusDir: coolCorpus,
        limit: 1,
        tabs: 1,
        backend: "gemini-api",
        keyPoolDir: poolDir,
        model: "gemini-4-hydrogen",
        thinking: "Extra High",
        media: "High",
        fps: 24,
        prepareMedia: async () => {
          prepWhenAllDead++;
          return { tcMp4: mp4, hasAudioStream: true, durationSec: 40, sourceFps: 30 };
        },
      }),
    ).rejects.toThrow(/all keys.*disabled/i);
    expect(prepWhenAllDead).toBe(0);

    writeJsonAtomic(join(poolDir, "state.json"), {
      cursor: 0,
      dead: {},
      until: {},
      stats: {},
    });
    let mixedErr = "";
    try {
      await runGeminiApiVideo({
        videoPath: mp4,
        durationSec: 2,
        sourceFps: 24,
        systemPrompt: "",
        userPrompt: "go",
        model: "gemini-4-hydrogen",
        thinking: "High",
        media: "High",
        fps: 24,
        keyPoolDir: poolDir,
        rounds: 1,
        switchDelayMs: 0,
        roundDelaysMs: [0],
        fetchImpl: async (_url, init) => {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          if (headers["x-goog-api-key"] === kA) {
            return new Response(
              JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "revoked" } }),
              { status: 403 },
            );
          }
          return new Response(
            JSON.stringify({ error: { status: "UNAVAILABLE", message: "high demand" } }),
            { status: 503 },
          );
        },
      });
    } catch (e) {
      mixedErr = (e as Error).message;
    }
    expect(mixedErr.length).toBeGreaterThan(0);
    expect(classifyHaltReason(mixedErr)).toBe("none");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("channel-dna CLI help and skill docs omit API key env var instructions", () => {
  const gapiHelp = spawnSync("bun", [resolve(SCRIPT_DIR, "gemini-api.ts"), "--help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  const cliHelp = spawnSync("bun", [CLI_PATH, "--help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  expect(gapiHelp.status).toBe(0);
  expect(cliHelp.status).toBe(0);
  for (const text of [
    gapiHelp.stdout,
    cliHelp.stdout,
    readFileSync(resolve(REPO_ROOT, ".claude/skills/channel-dna/SKILL.md"), "utf8"),
    readFileSync(resolve(REPO_ROOT, ".claude/skills/analyze-ref-video/SKILL.md"), "utf8"),
    readFileSync(resolve(REPO_ROOT, ".claude/skills/compare-video/SKILL.md"), "utf8"),
    formatMineOutcome(
      "demo",
      { done: 0, failed: 0, quotaHalted: true, haltReason: "bot_or_auth", processed: [] },
      2,
      "gemini-api",
    ).nextLine,
  ]) {
    expect(text).not.toMatch(/GEMINI_API_KEY|GOOGLE_API_KEY/);
  }
});
