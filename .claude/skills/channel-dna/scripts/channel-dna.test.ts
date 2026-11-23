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
  type MinedRecord,
  reconcileWithCatalog,
  renderStatsSummaryMd,
  runAggregate,
} from "./aggregate.ts";
import {
  buildStratifiedQueue,
  cleanTranscriptText,
  computeOutlierScores,
  computeWpm,
  expectedAgeFraction,
  inferMaturityBounds,
  isVideoMature,
  mergeCatalogEntry,
  selectEnrichmentTargets,
  selectTranscriptTargets,
  writeJsonAtomic,
} from "./collect.ts";
import {
  burnTimecode720,
  isQuotaError,
  loadCheckpoint,
  runMine,
  saveCheckpoint,
  selectMineTargets,
  shouldRecordFailure,
} from "./mine.ts";
import { parseAndValidateDossier, parseTimeSpanEndSec } from "./schema.ts";
import type { CatalogFile, RawCatalogVideo, VideoTelemetry } from "./types.ts";

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
  const refTax = grab(".claude/skills/aistudio/system/analyze-ref-video.md");
  const cmpTax = grab(".claude/skills/aistudio/system/compare-2-video.md");
  const lrnTax = grab(".claude/skills/channel-dna/system/learn-channel-video.md");
  expect(lrnTax).toBe(refTax);
  expect(lrnTax).toBe(cmpTax);
});

test("parseAndValidateDossier accepts valid v2 4-section dossier with zero warnings", () => {
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

    await burnTimecode720(src, out);
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
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("cli rejects bad flags, empty --ids, missing --system-file, bad --url, and directory validate with exit 2", () => {
  const help = spawnSync("bun", [CLI_PATH, "--help"], { encoding: "utf8" });
  expect(help.status).toBe(0);
  expect(help.stdout).toContain("--system-file");
  expect(help.stdout).toContain("--lang");

  const tmp = mkdtempSync(join(tmpdir(), "cdna-cli-bad-"));
  try {
    for (const args of [
      ["bogus"],
      ["collect", "--typo"],
      ["collect", "--channel", "demo", "--url", "--exec=evil"],
      ["mine", "--channel", "demo", "--ids", "../escape"],
      ["mine", "--channel", "demo", "--ids", ""],
      ["mine", "--channel", "demo", "--ids", " , "],
      ["mine", "--channel", "demo", "--system-file", join(tmp, "missing.md")],
      ["status", "--channel", "Bad Name"],
      ["validate", tmp],
    ]) {
      const r = spawnSync("bun", [CLI_PATH, ...args], { encoding: "utf8" });
      expect(r.status, args.join(" ")).toBe(2);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

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
});

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
});
