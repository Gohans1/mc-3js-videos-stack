import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { classifyTitleOpener, countTitleWords, extractTrailingEmoji } from "./catalog-metrics.ts";
import { buildTranscriptFetcherPyCode, resolveEffectiveTranscriptLanguages } from "./collect.ts";
import { resolveThumbnailCandidates, shouldAttachThumbnail } from "./mine.ts";
import { parseAndValidateDossier } from "./schema.ts";
import type { RawCatalogVideo } from "./types.ts";

function runPythonTranscriptSelection(
  tracksByVideo: Record<string, Array<{ lang: string; generated: boolean; text: string }>>,
  langs: string[],
  allowFallback: boolean,
): Record<
  string,
  {
    isGenerated: boolean;
    segments: Array<{ start: number; duration: number; text: string }>;
  } | null
> {
  const pyCode = buildTranscriptFetcherPyCode();
  const harness = [
    "import json, sys, types",
    "fixtures = json.loads(sys.argv[4])",
    "class _Seg:",
    "  def __init__(self, start, duration, text):",
    "    self.start = start",
    "    self.duration = duration",
    "    self.text = text",
    "class _Fetched(list):",
    "  def __init__(self, items, is_generated):",
    "    super().__init__(items)",
    "    self.is_generated = is_generated",
    "class _Track:",
    "  def __init__(self, lang, generated, text):",
    "    self.language_code = lang",
    "    self.is_generated = generated",
    "    self._text = text",
    "  def fetch(self):",
    "    return _Fetched([_Seg(0.0, 1.5, self._text)], self.is_generated)",
    "class _Api:",
    "  def list(self, vid):",
    "    return [_Track(t['lang'], t['generated'], t['text']) for t in fixtures.get(vid, [])]",
    "mod = types.ModuleType('youtube_transcript_api')",
    "mod.YouTubeTranscriptApi = _Api",
    "errs = types.ModuleType('youtube_transcript_api._errors')",
    "errs.NoTranscriptFound = type('NoTranscriptFound', (Exception,), {})",
    "errs.TranscriptsDisabled = type('TranscriptsDisabled', (Exception,), {})",
    "errs.VideoUnavailable = type('VideoUnavailable', (Exception,), {})",
    "sys.modules['youtube_transcript_api'] = mod",
    "sys.modules['youtube_transcript_api._errors'] = errs",
    "code = sys.argv[5]",
    "sys.argv = ['fetcher.py', sys.argv[1], sys.argv[2], sys.argv[3]]",
    "exec(compile(code, '<collect>', 'exec'), {'__name__': '__main__'})",
  ].join("\n");
  const ids = Object.keys(tracksByVideo);
  const res = spawnSync(
    "uv",
    [
      "run",
      "--no-project",
      "python",
      "-I",
      "-c",
      harness,
      JSON.stringify(ids),
      JSON.stringify(langs),
      allowFallback ? "1" : "0",
      JSON.stringify(tracksByVideo),
      pyCode,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 },
  );
  expect(res.status, res.stderr).toBe(0);
  return JSON.parse(res.stdout.trim()) as Record<
    string,
    {
      isGenerated: boolean;
      segments: Array<{ start: number; duration: number; text: string }>;
    } | null
  >;
}

function makeRawVideo(id: string, detectedLanguage: string): RawCatalogVideo {
  return {
    id,
    title: "Sample Title",
    url: `https://youtube.com/watch?v=${id}`,
    playlistIndex: 0,
    views: 100_000,
    likes: 3_000,
    durationSec: 40,
    uploadDate: "20260701",
    detectedLanguage,
  };
}

describe("R11b regressions: title ReDoS, transcript language priority, schema guard, thumbnail URL hygiene", () => {
  test("title decoration regexes stay linear-time on adversarial repeated hashtags", () => {
    const leadingAdversarial = `${"#a".repeat(40)} X`;
    const midAdversarial = `Title ${"#a".repeat(40)} X`;
    const t0 = performance.now();
    expect(extractTrailingEmoji(leadingAdversarial)).toBe("NONE");
    expect(countTitleWords(leadingAdversarial)).toBe(1);
    expect(classifyTitleOpener(leadingAdversarial)).toBe("Other");
    expect(extractTrailingEmoji(midAdversarial)).toBe("NONE");
    expect(countTitleWords(midAdversarial)).toBe(42);
    const elapsedMs = performance.now() - t0;
    expect(elapsedMs).toBeLessThan(50);

    expect(extractTrailingEmoji("Why Bridges Snap 😱 #shorts #viral")).toBe("😱");
    expect(countTitleWords("[NEW] Why Bridges Snap 😱 #shorts#viral")).toBe(3);
    expect(classifyTitleOpener("#shorts#viral Why Bridges Snap")).toBe("Why ...");
  });

  test("buildTranscriptFetcherPyCode groups by base language so regional variants beat English fallback", () => {
    const out = runPythonTranscriptSelection(
      {
        zhRegional: [
          { lang: "en", generated: false, text: "english-fallback" },
          { lang: "zh-Hans", generated: false, text: "chinese-hans" },
        ],
        zhExactWins: [
          { lang: "zh-Hans", generated: false, text: "chinese-hans" },
          { lang: "zh-TW", generated: false, text: "chinese-tw" },
          { lang: "en", generated: false, text: "english-fallback" },
        ],
        manualBeatsAuto: [
          { lang: "zh-Hans", generated: true, text: "auto-hans" },
          { lang: "zh-Hans", generated: false, text: "manual-hans" },
        ],
      },
      ["zh-CN", "zh-TW", "zh", "en", "en-US", "en-GB"],
      true,
    );

    expect(out.zhRegional?.segments[0]?.text).toBe("chinese-hans");
    expect(out.zhExactWins?.segments[0]?.text).toBe("chinese-tw");
    expect(out.manualBeatsAuto?.segments[0]?.text).toBe("manual-hans");
    expect(out.manualBeatsAuto?.isGenerated).toBe(false);

    const fbOn = runPythonTranscriptSelection(
      { koOnly: [{ lang: "ko", generated: false, text: "korean-native" }] },
      ["ja", "en"],
      true,
    );
    expect(fbOn.koOnly?.segments[0]?.text).toBe("korean-native");

    const fbOff = runPythonTranscriptSelection(
      { koOnly: [{ lang: "ko", generated: false, text: "korean-native" }] },
      ["ja", "en"],
      false,
    );
    expect(fbOff.koOnly).toBeNull();
  }, 30_000);

  test("resolveEffectiveTranscriptLanguages tallies regional variants under their shared base language", () => {
    const zhSplit = [
      makeRawVideo("z1", "zh-CN"),
      makeRawVideo("z2", "zh-Hans"),
      makeRawVideo("z3", "zh-CN"),
      makeRawVideo("z4", "zh-Hans"),
    ];
    expect(resolveEffectiveTranscriptLanguages(undefined, zhSplit)).toEqual([
      "zh-CN",
      "zh",
      "en",
      "en-US",
      "en-GB",
    ]);

    const esSplit = [
      makeRawVideo("e1", "es-ES"),
      makeRawVideo("e2", "es-419"),
      makeRawVideo("e3", "es-MX"),
      makeRawVideo("e4", "es-419"),
    ];
    expect(resolveEffectiveTranscriptLanguages(undefined, esSplit)).toEqual([
      "es-419",
      "es",
      "en",
      "en-US",
      "en-GB",
    ]);
  });

  test("schema.ts suppresses redundant bgm_mood=none coherence warnings when twist/ending enums are invalid", () => {
    const telemetry = {
      schema_version: 3,
      duration_sec: 35,
      hook_archetype: "visual_pattern_interrupt",
      opening_shot_sec: 2.0,
      opening_spoken_line: "If you drop this gear, it locks.",
      opening_visual_trigger: "Gear jams in frame 0.",
      story_structure: "mechanism_step_by_step",
      topic_category: "explainer_how_it_works",
      visual_medium: "3d_stylized_cgi",
      protagonist_format: "third_person_characters",
      narration_pov: "second_person_you",
      voice_delivery: "calm_matter_of_fact",
      caption_style: "phrase_chunked_static",
      emotional_driver: "curiosity_wonder",
      outro_hold_sec: 0.7,
      narrative_connector: "but_therefore",
      story_beats: [
        { role: "hook", start_sec: 0, pct_runtime: 15 },
        { role: "explanation_value", start_sec: 5.2, pct_runtime: 70 },
        { role: "resolution", start_sec: 29.7, pct_runtime: 15 },
      ],
      twist_at_pct: null,
      rehook_timestamps_sec: [12, 22],
      ending_type: "consequence_impact",
      ending_valence: "neutral_clinical",
      title_hook_relation: "visual_confirm_cold_open",
      opening_scroll_stop_state: "mid_action_anomaly",
      open_loop_payoff_timing: "late_payoff",
      vo_visual_relation: "complementary_explain",
      narrative_timeline: "linear_chronological",
      open_loop_architecture: "single_central_loop",
      information_reveal_mode: "progressive_withhold_reveal",
      thumbnail_archetype: "not_applicable_shorts_feed",
      thumbnail_text_relation: "not_applicable",
      thumbnail_opening_payoff: "not_applicable",
      thumbnail_focal_complexity: "not_applicable",
      thumbnail_gaze_or_cue: "not_applicable",
      dominant_lens: "wide",
      lighting_style: "clean_soft_studio",
      shadow_quality: "soft_diffuse",
      color_palette_mood: "clean_bright_saturated",
      easing_signature: "smooth_damped",
      acting_mode: "procedural_subtle_idle",
      set_architecture: "bounded_full_world",
      visual_layer_format: "single_full_frame",
      stakes_engine: "curiosity_mystery",
      camera_motion_persistence: "always_drifting_floating",
      camera_velocity_profile: "smooth_eased_damped",
      framing_anchor: "center_locked",
      camera_moves_used: ["push_in"],
      boundary_counts: {
        hard_cut: 0,
        hidden_cut: 0,
        transition: 0,
        continuous: 1,
      },
      transition_types: [],
      shot_scale_counts: { ECU: 0, CU: 0, MCU: 1, M: 1, W: 0, INSERT: 0 },
      angle_counts: { eye: 2, low: 0, high: 0, top_down: 0, dutch: 0 },
      audio_bed_style: "vo_only_dry",
      bgm_mood: "none",
      bgm_twist_behavior: "invalid_twist_enum",
      bgm_ending_behavior: "invalid_ending_enum",
      sfx_density: "none",
      sfx_layers_used: ["none"],
      time_remap_types: ["none"],
      craft_signals: {
        uses_motion_blur: false,
        uses_camera_turn_blur: false,
        uses_translation_or_radial_blur: false,
        uses_object_motion_blur: false,
        uses_subject_tracking_blur: false,
        uses_shallow_dof: false,
        uses_rack_focus: false,
        uses_cutaway_or_xray: false,
        uses_emissive_flash: false,
        uses_backdrop_vignette: false,
        uses_motion_graphics_overlay: false,
        has_particles_or_fluid: false,
        has_pip_or_split_screen: false,
        has_diegetic_channel_branding: false,
        has_sfx_whoosh_or_riser: false,
        has_pre_impact_silence: false,
        has_jl_cut: false,
        has_time_remap_or_hit_stop: false,
        has_seamless_loop: false,
        has_fourth_wall_break: false,
        has_expressive_facial_or_gesture_acting: false,
        has_fg_parallax_or_ots: false,
        has_archival_or_real_footage: false,
        has_direct_camera_address: false,
        has_unspoken_visual_subtext: false,
        has_setup_payoff_callback: false,
        has_match_cut: false,
      },
      secret_sauce_cues: ["clean setup"],
      weaknesses_or_drag: [],
    };
    const md = [
      "### 1. Hook & Packaging",
      "Strong opener.",
      "### 2. Directorial Intent",
      "Direct explanation.",
      "### 3. Macro Shot Spine",
      "| # | Time (s) | Boundary | Scale / Angle | Dominant Craft Pillar | Visual & Motion Notes |",
      "| --- | --- | --- | --- | --- | --- |",
      "| 1 | 0.0-2.0 | Opening | M / eye | [Camera, Framing & Staging] | Push in. |",
      "| 2 | 2.0-35.0 | Continuous [NO CUT] | MCU / eye | [Camera, Framing & Staging] | Hold on gear. |",
      "### 4. Telemetry JSON",
      "```json",
      JSON.stringify(telemetry, null, 2),
      "```",
    ].join("\n");

    const res = parseAndValidateDossier(md, { expectAudio: true, expectedFps: 24 });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("bgm_twist_behavior"))).toBe(true);
    expect(res.errors.some((e) => e.includes("bgm_ending_behavior"))).toBe(true);
    expect(res.warnings.some((w) => w.includes("bgm_mood is none"))).toBe(false);
  });

  test("thumbnail helpers trim whitespace and enforce https only", () => {
    expect(
      shouldAttachThumbnail({
        id: "bad-id!",
        url: "https://youtube.com/watch?v=x",
        thumbnailUrl: "  https://i.ytimg.com/vi/abc12345678/maxresdefault.jpg  ",
        width: 1920,
        height: 1080,
        durationSec: 600,
      }),
    ).toBe(true);

    expect(
      shouldAttachThumbnail({
        id: "bad-id!",
        url: "https://youtube.com/watch?v=x",
        thumbnailUrl: "http://i.ytimg.com/vi/abc12345678/maxresdefault.jpg",
        width: 1920,
        height: 1080,
        durationSec: 600,
      }),
    ).toBe(false);

    expect(
      resolveThumbnailCandidates({
        id: "bad-id!",
        thumbnailUrl: "http://i.ytimg.com/vi/abc12345678/maxresdefault.jpg",
      }),
    ).toEqual([]);

    expect(
      resolveThumbnailCandidates({
        id: "bad-id!",
        thumbnailUrl: "  https://i.ytimg.com/vi/abc12345678/maxresdefault.jpg ",
      }),
    ).toEqual(["https://i.ytimg.com/vi/abc12345678/maxresdefault.jpg"]);
  });
});
