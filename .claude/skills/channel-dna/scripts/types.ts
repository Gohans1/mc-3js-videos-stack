export const TOPIC_CATEGORIES = [
  "explainer_how_it_works",
  "history_weird_true_story",
  "science_physics_mechanics",
  "anatomy_health_body",
  "everyday_object_secret",
  "hypothetical_what_if",
  "animals_nature_survival",
  "crime_disaster_accident",
  "pop_culture_media_tech",
  "myth_vs_reality",
  "food_diy_and_hacks",
  "other",
] as const;
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

export const HOOK_ARCHETYPES = [
  "visual_pattern_interrupt",
  "cold_open_crisis",
  "character_story_setup",
  "imperative_how_to_step",
  "shock_fact_stat",
  "myth_bust",
  "mystery_question",
  "hypothetical_premise",
  "dramatic_reveal_first",
  "other",
] as const;
export type HookArchetype = (typeof HOOK_ARCHETYPES)[number];

export const STORY_STRUCTURES = [
  "mechanism_step_by_step",
  "chronological_escalation_twist",
  "myth_setup_truth_reveal",
  "problem_solution_irony",
  "what_if_chain_reaction",
  "mystery_clue_payoff",
  "comparison_contrast",
  "other",
] as const;
export type StoryStructure = (typeof STORY_STRUCTURES)[number];

export const NARRATIVE_CONNECTORS = [
  "but_therefore",
  "causal_chain",
  "chronological_and_then",
  "list_comparison",
] as const;
export type NarrativeConnector = (typeof NARRATIVE_CONNECTORS)[number];

export const ENDING_TYPES = [
  "seamless_loop",
  "ironic_twist_punchline",
  "abrupt_fact_or_snap",
  "satisfying_resolution",
  "question_cta",
] as const;
export type EndingType = (typeof ENDING_TYPES)[number];

export const BEAT_ROLES = [
  "hook",
  "setup",
  "escalation",
  "explanation_value",
  "visual_proof",
  "twist",
  "resolution",
  "loop_bridge",
  "cta",
] as const;
export type BeatRole = (typeof BEAT_ROLES)[number];

export const SHOT_SCALES = ["EW", "W", "M", "MCU", "CU", "ECU", "INSERT"] as const;
export type ShotScale = (typeof SHOT_SCALES)[number];

export const CAMERA_ANGLES = ["aerial", "overhead", "high", "eye", "low", "ground"] as const;
export type CameraAngle = (typeof CAMERA_ANGLES)[number];

export const CAMERA_ENERGIES = [
  "locked_static",
  "smooth_damped_continuous",
  "snappy_whip_kinetic",
  "handheld_organic",
  "mixed",
] as const;
export type CameraEnergy = (typeof CAMERA_ENERGIES)[number];

export const LENS_FEELS = [
  "ultra_wide",
  "wide",
  "normal",
  "telephoto",
  "macro",
  "flat_2d_ortho",
  "mixed",
] as const;
export type LensFeel = (typeof LENS_FEELS)[number];

export const LIGHTING_STYLES = [
  "clean_studio_soft",
  "clean_studio_hard",
  "dramatic_low_key",
  "warm_cinematic",
  "flat_2d_unlit",
  "natural_daylight",
  "mixed",
] as const;
export type LightingStyle = (typeof LIGHTING_STYLES)[number];

export const EASING_ENERGIES = [
  "snappy_overshoot",
  "smooth_damped",
  "linear_mechanical",
  "stepped_cartoon",
  "natural_live",
] as const;
export type EasingEnergy = (typeof EASING_ENERGIES)[number];

export const AUDIO_BED_STYLES = [
  "continuous_bgm_plus_vo",
  "shifting_bgm_plus_vo",
  "minimal_ambient_plus_vo",
  "vo_only_dry",
  "music_sfx_no_vo",
  "silent",
] as const;
export type AudioBedStyle = (typeof AUDIO_BED_STYLES)[number];

export const CRAFT_SIGNAL_KEYS = [
  "has_cutaway_or_xray",
  "has_diegetic_text_or_labels",
  "has_motion_graphics_or_arrows",
  "has_emissive_highlight_pulse",
  "has_pre_impact_silence",
  "has_jl_cut",
  "has_time_remap_or_hit_stop",
  "has_seamless_loop",
  "uses_motion_blur",
  "uses_shallow_dof",
  "uses_backdrop_vignette",
] as const;
export type CraftSignalKey = (typeof CRAFT_SIGNAL_KEYS)[number];

export type PerformanceTier = "winner" | "median" | "flop" | "provisional";

export interface RawCatalogVideo {
  id: string;
  title: string;
  url: string;
  playlistIndex: number;
  views: number;
  likes: number | null;
  durationSec: number | null;
  uploadDate: string | null;
  enrichedMature?: boolean | null;
  offFeed?: boolean;
  transcriptText?: string | null;
  wordCount?: number | null;
  wpm?: number | null;
  openingTranscriptLine?: string | null;
}

export interface CatalogVideo extends RawCatalogVideo {
  ageDays: number | null;
  isMature: boolean;
  likeRate: number | null;
  outlierRolling: number;
  outlierGlobal: number;
  tier: PerformanceTier;
}

export interface CatalogFile {
  channel: string;
  sourceUrl: string;
  snapshotDate: string;
  totalCollected: number;
  matureCount: number;
  enrichedCount: number;
  transcriptCount: number;
  globalMatureMedianViews: number;
  videos: CatalogVideo[];
}

export interface StoryBeat {
  role: BeatRole;
  start_sec: number;
  end_sec: number;
  pct_runtime: number;
}

export interface BoundaryCounts {
  hard_cut: number;
  hidden_cut: number;
  transition: number;
  continuous: number;
}

export interface VideoTelemetry {
  schema_version: 1;
  duration_sec: number;
  topic_category: TopicCategory;
  topic_sublabel: string;
  hook_archetype: HookArchetype;
  opening_shot_sec: number;
  opening_spoken_line: string | null;
  hook_visual_trigger: string;
  story_structure: StoryStructure;
  narrative_connector: NarrativeConnector;
  ending_type: EndingType;
  twist_at_pct: number | null;
  rehook_timestamps_sec: number[];
  story_beats: StoryBeat[];
  boundary_counts: BoundaryCounts;
  transition_types: string[];
  shot_scale_counts: Record<ShotScale, number>;
  camera_angle_counts: Record<CameraAngle, number>;
  camera_energy: CameraEnergy;
  dominant_lens_feel: LensFeel;
  lighting_style: LightingStyle;
  easing_energy: EasingEnergy;
  audio_bed_style: AudioBedStyle;
  craft_signals: Record<CraftSignalKey, boolean>;
  reusable_script_template: string;
  secret_sauce_cues: string[];
  weaknesses_or_drag: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sectionsFound: number;
  sec3TotalRows: number;
  sec3BoundaryCounts: BoundaryCounts;
  telemetry: VideoTelemetry | null;
}

export interface MinedVideoMeta {
  id: string;
  title: string;
  url: string;
  views: number;
  likes: number | null;
  durationSec: number;
  uploadDate: string | null;
  outlierRolling: number;
  outlierGlobal: number;
  tier: PerformanceTier;
  wordCount: number | null;
  wpm: number | null;
  minedAt: string;
  model: string;
  thinking: string;
  media: string;
  fps: number;
  promptVersion: string;
  chatUrl: string | null;
  elapsedSec: number;
  attempts: number;
  warnings: string[];
}

export interface CheckpointEntry {
  status: "done" | "failed";
  updatedAt: string;
  chatUrl: string | null;
  attempts: number;
  error?: string;
}

export interface CheckpointFile {
  channel: string;
  updatedAt: string;
  completedCount: number;
  failedCount: number;
  entries: Record<string, CheckpointEntry>;
}
