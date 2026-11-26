export const CURRENT_STATS_VERSION = 4;

export const CRAFT_PILLAR_CATEGORIES = [
  "Camera, Framing & Staging",
  "Motion, Acting & Prop State",
  "Optics: Blur, DOF & Temporal",
  "Lighting, Color & Materials",
  "Transitions & Continuity",
  "VFX, Cutaways & Graphics",
  "Audio-Visual Sync & Soundscape",
  "Other",
] as const;
export type CraftPillarCategory = (typeof CRAFT_PILLAR_CATEGORIES)[number];

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
  "gaming_and_challenges",
  "lifestyle_vlog_challenge",
  "commentary_news_essay",
  "comedy_skit_parody",
  "business_finance_career",
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
  "stakes_challenge_bet",
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
  "challenge_experiment_arc",
  "listicle_ranked_countdown",
  "thesis_evidence_argument",
  "personal_journey_or_vlog",
  "comedic_bit_or_rule_of_three",
  "interview_qa_or_debate",
  "other",
] as const;
export type StoryStructure = (typeof STORY_STRUCTURES)[number];

export const NARRATIVE_CONNECTORS = [
  "but_therefore",
  "causal_chain",
  "chronological_and_then",
  "list_comparison",
  "conversational_qa_or_banter",
  "episodic_or_callback_escalation",
] as const;
export type NarrativeConnector = (typeof NARRATIVE_CONNECTORS)[number];

export const ENDING_TYPES = [
  "seamless_loop",
  "ironic_twist_punchline",
  "abrupt_fact_or_snap",
  "satisfying_resolution",
  "question_cta",
  "external_promo_cta",
  "cliffhanger_or_part_two",
  "subscribe_or_sponsor_outro",
] as const;
export type EndingType = (typeof ENDING_TYPES)[number];

export const BEAT_ROLES = [
  "hook",
  "setup",
  "escalation",
  "explanation_value",
  "visual_proof",
  "twist",
  "climax_or_payoff",
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
  "foley_ambient_no_vo",
  "dialogue_or_interview_driven",
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

export const CRAFT_SIGNAL_KEYS_V2 = [
  "uses_camera_turn_blur",
  "uses_translation_or_radial_blur",
  "uses_object_motion_blur",
  "uses_subject_tracking_blur",
  "uses_rack_focus",
  "has_particles_or_fluid",
  "has_pip_or_split_screen",
  "has_diegetic_channel_branding",
  "has_sfx_whoosh_or_riser",
] as const;
export type CraftSignalV2Key = (typeof CRAFT_SIGNAL_KEYS_V2)[number];

export const CRAFT_SIGNAL_KEYS_V3 = [
  "has_expressive_facial_or_gesture_acting",
  "has_fg_parallax_or_ots",
  "has_archival_or_real_footage",
  "has_direct_camera_address",
  "has_unspoken_visual_subtext",
  "has_setup_payoff_callback",
  "has_match_cut",
] as const;
export type CraftSignalV3Key = (typeof CRAFT_SIGNAL_KEYS_V3)[number];

export const AUDIO_CRAFT_SIGNAL_KEYS = new Set<string>([
  "has_pre_impact_silence",
  "has_jl_cut",
  "has_sfx_whoosh_or_riser",
]);

export const SUBSECOND_OPTICAL_CRAFT_KEYS = new Set<string>([
  "uses_motion_blur",
  "uses_camera_turn_blur",
  "uses_translation_or_radial_blur",
  "uses_object_motion_blur",
  "uses_subject_tracking_blur",
  "uses_rack_focus",
  "has_time_remap_or_hit_stop",
]);

export const VISUAL_MEDIUMS = [
  "3d_stylized_cgi",
  "3d_photoreal_cgi",
  "2d_vector_motion",
  "2d_handdrawn_anime",
  "live_action_talking_head",
  "live_action_cinematic",
  "gameplay_machinima",
  "screen_recording_ui",
  "mixed_hybrid",
] as const;
export type VisualMedium = (typeof VISUAL_MEDIUMS)[number];

export const PROTAGONIST_FORMATS = [
  "third_person_characters",
  "first_person_pov",
  "on_camera_host",
  "faceless_objects_diagrams",
  "duo_or_ensemble",
  "none",
] as const;
export type ProtagonistFormat = (typeof PROTAGONIST_FORMATS)[number];

export const NARRATION_POVS = [
  "second_person_you",
  "third_person_story",
  "first_person_i_we",
  "omniscient_explainer",
  "character_dialogue",
  "unvoiced",
] as const;
export type NarrationPov = (typeof NARRATION_POVS)[number];

export const VOICE_DELIVERIES = [
  "calm_matter_of_fact",
  "urgent_suspenseful",
  "energetic_hype",
  "deadpan_ironic",
  "warm_conversational",
  "dramatic_cinematic",
  "character_acted",
  "whispered_intimate",
  "unvoiced",
] as const;
export type VoiceDelivery = (typeof VOICE_DELIVERIES)[number];

export const CAPTION_STYLES = [
  "word_by_word_kinetic",
  "phrase_chunked_kinetic",
  "phrase_chunked_static",
  "standard_subtitles",
  "minimal_callout_only",
  "none",
] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const EMOTIONAL_DRIVERS = [
  "curiosity_mystery",
  "visceral_shock_danger",
  "irony_schadenfreude",
  "awe_wonder",
  "empathy_wholesome",
  "social_tension_game",
  "humor_absurdity",
  "motivation_aspiration",
] as const;
export type EmotionalDriver = (typeof EMOTIONAL_DRIVERS)[number];

export const BGM_MOODS = [
  "tense_pulse_synth",
  "playful_quirky",
  "dark_ominous_drone",
  "epic_cinematic",
  "emotional_piano_strings",
  "upbeat_electronic_pop",
  "electronic_hype_or_phonk",
  "lofi_ambient",
  "mixed_shifting",
  "none",
] as const;
export type BgmMood = (typeof BGM_MOODS)[number];

export const SFX_DENSITIES = [
  "sparse_grounded",
  "moderate_punctuated",
  "dense_kinetic_whoosh_pop",
  "none",
] as const;
export type SfxDensity = (typeof SFX_DENSITIES)[number];

export const SHADOW_QUALITIES = ["soft_diffuse", "crisp_hard", "flat_unlit", "mixed"] as const;
export type ShadowQuality = (typeof SHADOW_QUALITIES)[number];

export const COLOR_PALETTE_MOODS = [
  "clean_bright_saturated",
  "warm_cinematic",
  "cool_moody_teal",
  "dark_high_contrast",
  "pastel_flat",
  "mixed",
] as const;
export type ColorPaletteMood = (typeof COLOR_PALETTE_MOODS)[number];

export const ACTING_MODES = [
  "subtle_realistic",
  "stylized_expressive",
  "talking_head_presenter",
  "deadpan_comedic",
  "minimal_or_puppet",
  "no_character_acting",
] as const;
export type ActingMode = (typeof ACTING_MODES)[number];

export const SET_ARCHITECTURES = [
  "full_bounded_environment",
  "real_world_location",
  "studio_or_desk_set",
  "floating_stage_or_backdrop",
  "screen_or_ui_canvas",
  "mixed_real_and_graphics",
] as const;
export type SetArchitecture = (typeof SET_ARCHITECTURES)[number];

export const VISUAL_LAYER_FORMATS = [
  "single_full_frame",
  "split_screen_or_pip",
  "inset_broll_or_graphics_overlay",
  "screen_recording_with_facecam",
  "mixed_layers",
] as const;
export type VisualLayerFormat = (typeof VISUAL_LAYER_FORMATS)[number];

export const STAKES_ENGINES = [
  "bodily_or_visceral_hazard",
  "survival_or_challenge_risk",
  "curiosity_or_intellectual_mystery",
  "financial_or_status_stakes",
  "social_awkwardness_or_drama",
  "humor_or_absurdity",
  "practical_utility_or_gain",
  "aesthetic_or_craft_awe",
] as const;
export type StakesEngine = (typeof STAKES_ENGINES)[number];

export const CAMERA_MOTION_PERSISTENCES = [
  "static_locked",
  "intermittent_motivated",
  "continuous_drifting",
  "handheld_or_vlog_organic",
  "screen_pan_zoom_keyframed",
] as const;
export type CameraMotionPersistence = (typeof CAMERA_MOTION_PERSISTENCES)[number];

export const CAMERA_VELOCITY_PROFILES = [
  "static_or_locked",
  "linear_constant",
  "smooth_ease_in_out",
  "whip_snap_decel",
  "handheld_irregular",
] as const;
export type CameraVelocityProfile = (typeof CAMERA_VELOCITY_PROFILES)[number];

export const FRAMING_ANCHORS = [
  "upper_third_head_or_subject",
  "center_band_subject",
  "rule_of_thirds_off_center",
  "lower_third_tabletop",
  "split_or_multi_subject_stage",
  "full_frame_balanced",
] as const;
export type FramingAnchor = (typeof FRAMING_ANCHORS)[number];

export const BGM_TWIST_BEHAVIORS = [
  "no_bgm",
  "steady_unchanged",
  "drop_or_cut_to_silence",
  "track_or_mood_switch",
  "swell_or_riser_escalation",
] as const;
export type BgmTwistBehavior = (typeof BGM_TWIST_BEHAVIORS)[number];

export const BGM_ENDING_BEHAVIORS = [
  "no_bgm",
  "hard_cutoff_or_button",
  "clean_fade_or_tail",
  "seamless_loop_bridge",
  "outro_stinger_or_bed",
] as const;
export type BgmEndingBehavior = (typeof BGM_ENDING_BEHAVIORS)[number];

export const ENDING_VALENCES = [
  "dark_or_unsettling",
  "ironic_or_comedic",
  "awe_or_insight_satisfying",
  "heartwarming_or_wholesome",
  "neutral_informational",
  "unresolved_cliffhanger",
] as const;
export type EndingValence = (typeof ENDING_VALENCES)[number];

export const TITLE_HOOK_RELATIONS = [
  "no_title_provided",
  "visual_confirm_cold_open",
  "spoken_and_visual_mirror",
  "curiosity_gap_extension",
  "premise_setup_before_twist",
  "deliberate_subversion",
] as const;
export type TitleHookRelation = (typeof TITLE_HOOK_RELATIONS)[number];

export const OPENING_SCROLL_STOP_STATES = [
  "mid_action_or_crisis",
  "visual_anomaly_or_reveal",
  "static_setup_or_talking_head",
  "text_or_title_card",
  "slow_fade_or_logo_intro",
] as const;
export type OpeningScrollStopState = (typeof OPENING_SCROLL_STOP_STATES)[number];

export const OPEN_LOOP_PAYOFF_TIMINGS = [
  "no_open_loop",
  "immediate_first_third",
  "mid_video",
  "late_climax_final_quarter",
  "unresolved_cliffhanger",
] as const;
export type OpenLoopPayoffTiming = (typeof OPEN_LOOP_PAYOFF_TIMINGS)[number];

export const VO_VISUAL_RELATIONS = [
  "literal_play_by_play",
  "causal_or_context_complement",
  "ironic_or_deadpan_contrast",
  "dialogue_or_presenter_led",
  "unvoiced_visual_led",
] as const;
export type VoVisualRelation = (typeof VO_VISUAL_RELATIONS)[number];

export const NARRATIVE_TIMELINES = [
  "linear_forward",
  "cold_open_then_rewind",
  "modular_chapters_or_anthology",
  "parallel_or_intercut",
  "thematic_non_linear",
] as const;
export type NarrativeTimeline = (typeof NARRATIVE_TIMELINES)[number];

export const OPEN_LOOP_ARCHITECTURES = [
  "single_central_mystery",
  "escalating_chain_stakes",
  "nested_mini_loops",
  "sequential_step_payoffs",
] as const;
export type OpenLoopArchitecture = (typeof OPEN_LOOP_ARCHITECTURES)[number];

export const INFORMATION_REVEAL_MODES = [
  "transparent_process",
  "progressive_withhold_reveal",
  "dramatic_irony_audience_knows",
  "red_herring_misdirection",
  "escalating_constraint_or_rule_of_three",
] as const;
export type InformationRevealMode = (typeof INFORMATION_REVEAL_MODES)[number];

export const THUMBNAIL_ARCHETYPES = [
  "not_applicable_shorts_feed",
  "no_thumbnail_provided",
  "expressive_face_closeup",
  "action_or_before_after",
  "object_or_anomaly_hero",
  "diagram_chart_or_ui",
  "text_heavy_graphic",
  "multi_element_collage",
  "scene_still_minimal",
] as const;
export type ThumbnailArchetype = (typeof THUMBNAIL_ARCHETYPES)[number];

export const THUMBNAIL_TEXT_RELATIONS = [
  "not_applicable",
  "no_text_visual_only",
  "complementary_contrast_or_stakes",
  "direct_title_echo",
  "single_label_or_number",
] as const;
export type ThumbnailTextRelation = (typeof THUMBNAIL_TEXT_RELATIONS)[number];

export const THUMBNAIL_OPENING_PAYOFFS = [
  "not_applicable",
  "instant_visual_confirm_0_10s",
  "confirmed_in_intro_10_30s",
  "delayed_payoff_after_30s",
  "unfulfilled_or_clickbait",
] as const;
export type ThumbnailOpeningPayoff = (typeof THUMBNAIL_OPENING_PAYOFFS)[number];

export const THUMBNAIL_FOCAL_COMPLEXITIES = [
  "not_applicable",
  "single_hero_clean",
  "two_to_three_balanced",
  "four_plus_busy_collage",
] as const;
export type ThumbnailFocalComplexity = (typeof THUMBNAIL_FOCAL_COMPLEXITIES)[number];

export const THUMBNAIL_GAZE_OR_CUES = [
  "not_applicable",
  "face_direct_to_camera",
  "face_gazing_at_focal",
  "pointer_arrow_or_highlight",
  "clean_scene_no_face",
] as const;
export type ThumbnailGazeOrCue = (typeof THUMBNAIL_GAZE_OR_CUES)[number];

export const SFX_LAYER_TYPES = [
  "whoosh_or_transition",
  "hard_impact_or_hit",
  "diegetic_foley_or_ambience",
  "mechanical_or_ui_click",
  "visceral_squish_or_crunch",
  "riser_or_stinger",
  "comic_boing_or_pop",
  "none",
] as const;
export type SfxLayerType = (typeof SFX_LAYER_TYPES)[number];

export const TIME_REMAP_TYPES = [
  "none",
  "slow_motion",
  "speed_ramp_or_timelapse",
  "freeze_or_hit_stop",
  "rewind_or_replay",
] as const;
export type TimeRemapType = (typeof TIME_REMAP_TYPES)[number];

export type PerformanceTier = "winner" | "median" | "flop" | "provisional";
export type ReliabilityLevel = "stable" | "tentative" | "directional";

export interface TranscriptTiming {
  firstSpokenSec: number | null;
  lastSpokenEndSec: number | null;
  speakingCoveragePct: number | null;
  maxGapSec: number | null;
  silenceGapCount: number | null;
  isGenerated?: boolean | null;
  activeSpeechWpm?: number | null;
  lateToEarlyWpmRatio?: number | null;
  captionTailSec?: number | null;
}

export interface AudioLoudnessMetrics {
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbtp: number | null;
  maxShortTermLufs?: number | null;
  maxMomentaryLufs?: number | null;
  plrDb?: number | null;
  climaxLoudnessDeltaLu?: number | null;
  relativeDropCount?: number | null;
  isSilentTrack?: boolean;
  silenceCount: number;
  totalSilenceSec: number;
}

export interface RawCatalogVideo {
  id: string;
  title: string;
  url: string;
  playlistIndex: number;
  views: number;
  likes: number | null;
  durationSec: number | null;
  uploadDate: string | null;
  commentCount?: number | null;
  width?: number | null;
  height?: number | null;
  sourceFps?: number | null;
  thumbnailUrl?: string | null;
  detectedLanguage?: string | null;
  chaptersCount?: number | null;
  firstChapterEndSec?: number | null;
  medianChapterSec?: number | null;
  heatmapPeakPct?: number | null;
  heatmapTailLift?: number | null;
  heatmapMean?: number | null;
  heatmapEarly?: number | null;
  heatmapEnd?: number | null;
  enrichedMature?: boolean | null;
  offFeed?: boolean;
  transcriptText?: string | null;
  transcriptLangsTried?: string[];
  wordCount?: number | null;
  wpm?: number | null;
  openingTranscriptLine?: string | null;
  transcriptTiming?: TranscriptTiming | null;
}

export interface CatalogVideo extends RawCatalogVideo {
  ageDays: number | null;
  isMature: boolean;
  likeRate: number | null;
  commentRate?: number | null;
  commentToLikeRatio?: number | null;
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
  queueFilter?: { minDurationSec: number; maxDurationSec: number };
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
  schema_version: 1 | 2 | 3;
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
  craft_signals: Record<CraftSignalKey, boolean> &
    Partial<Record<CraftSignalV2Key, boolean>> &
    Partial<Record<CraftSignalV3Key, boolean>>;
  reusable_script_template: string;
  secret_sauce_cues: string[];
  weaknesses_or_drag: string[];
  visual_medium?: VisualMedium;
  protagonist_format?: ProtagonistFormat;
  narration_pov?: NarrationPov;
  voice_delivery?: VoiceDelivery;
  caption_style?: CaptionStyle;
  emotional_driver?: EmotionalDriver;
  bgm_mood?: BgmMood;
  sfx_density?: SfxDensity;
  shadow_quality?: ShadowQuality;
  color_palette_mood?: ColorPaletteMood;
  outro_hold_sec?: number;
  camera_moves_used?: string[];
  acting_mode?: ActingMode;
  set_architecture?: SetArchitecture;
  visual_layer_format?: VisualLayerFormat;
  stakes_engine?: StakesEngine;
  camera_motion_persistence?: CameraMotionPersistence;
  camera_velocity_profile?: CameraVelocityProfile;
  framing_anchor?: FramingAnchor;
  bgm_twist_behavior?: BgmTwistBehavior;
  bgm_ending_behavior?: BgmEndingBehavior;
  ending_valence?: EndingValence;
  title_hook_relation?: TitleHookRelation;
  opening_scroll_stop_state?: OpeningScrollStopState;
  open_loop_payoff_timing?: OpenLoopPayoffTiming;
  vo_visual_relation?: VoVisualRelation;
  narrative_timeline?: NarrativeTimeline;
  open_loop_architecture?: OpenLoopArchitecture;
  information_reveal_mode?: InformationRevealMode;
  thumbnail_archetype?: ThumbnailArchetype;
  thumbnail_text_relation?: ThumbnailTextRelation;
  thumbnail_opening_payoff?: ThumbnailOpeningPayoff;
  thumbnail_focal_complexity?: ThumbnailFocalComplexity;
  thumbnail_gaze_or_cue?: ThumbnailGazeOrCue;
  sfx_layers_used?: SfxLayerType[];
  time_remap_types?: TimeRemapType[];
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
  hasAudioStream?: boolean;
  miningMode?: "micro_24fps" | "macro_lowfps";
  sourceFps?: number | null;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  audioMetrics?: AudioLoudnessMetrics | null;
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
