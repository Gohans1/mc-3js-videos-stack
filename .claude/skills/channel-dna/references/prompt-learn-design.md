# Channel DNA Extraction Prompt Design and Eval History

Canonical engineering log for system/learn-channel-video.md covering architectural rationale, controlled v1 vs v2 A/B results on 6 stratified Zack D. Films Shorts, and 2-channel out-of-distribution (OOD) verification across 2D flat-vector and live-action cinema.

## Core Design Principles

| Decision | Rationale |
| --- | --- |
| Single-pass 4-section architecture | Research on LLM pipeline decomposition (arXiv:2609.32825) shows chaining independent LLM calls drops accuracy via lossy summaries; one coherent pass captures Hook, Narrative Intent, Macro Shot Spine, and JSON Telemetry jointly while staying under 16k chars |
| 3-way byte-identical Craft Taxonomy | Reusable Film & Motion Craft Taxonomy is copied verbatim from analyze-ref-video/system/analyze-ref-video.md and compare-video/system/compare-2-video.md and locked by an automated unit test in scripts/channel-dna.test.ts |
| Closed enums plus open secret_sauce_cues | Deterministic scripts/aggregate.ts requires exact enum spellings for zero-drift cross-video percentages and cross-tabs, while secret_sauce_cues and weaknesses_or_drag preserve novel channel-specific tricks |
| Deterministic Python/TS telemetry offload | View counts, age-normalized rolling-median outlier scores, durations, and spoken WPM come from yt-dlp and youtube-transcript-api in scripts/collect.ts (0 AI tokens) so Gemini focuses 100% on observable visual, narrative, editorial, and audible craft |
| Clean AAC 128k 44.1kHz stereo re-encode in burnTimecode720 | Copying raw DASH m4a audio streams risked edit-list/PTS quirks; re-encoding audio cleanly alongside explicit active-listening rules eliminated silent fallback across parallel tabs |

## Version History and Controlled A/B Eval (v1 vs v2)

All 6 pilot videos (2 Winner, 2 Median, 2 Flop from @zackdfilms) and 2 OOD videos were evaluated under identical AI Studio parameters: model gemini-4-hydrogen, thinking Extra High, media High, 24fps, Google Search off, 720p timecode bar. Ground-truth visual verification inspected 64 total 30fps contact-sheet panels (8 frames per video across all 8 clips).

| Metric | v1 Pilot (N=6 ZDF) | v2 Pilot (N=6 ZDF) | v2 OOD (N=2 Non-ZDF) |
| --- | --- | --- | --- |
| Attempt-1 strict schema pass rate | 6/6 (100%) | 6/6 (100%) | 2/2 (100%) |
| Schema warnings | 0 | 0 | 0 |
| Truncations (65k cap) | 0/6 | 0/6 | 0/2 |
| Output length range (chars) | 10,797 - 13,819 | 10,040 - 13,993 | 12,687 - 15,863 |
| Full English compliance (0 VI lines) | 0/6 (Vietnamese prose) | 6/6 (100% English) | 2/2 (100% English) |
| Audio stream actively heard | 3/6 (cdna2 missed audio) | 6/6 (100% both tabs) | 2/2 (100% both tabs) |
| opening_shot_sec matches Section 3 Row 1 | 4/6 (summed one-takes) | 6/6 (100%, enforced in schema.ts) | 2/2 (100%) |
| Distinct hook archetypes detected across N=6 | 2 (5/6 collapsed into cold_open_action) | 5 sharp archetypes (0 collapse) | 2 distinct archetypes |
| Visual GT 30fps panel verification | 48/48 inspected | 48/48 cross-verified | 16/16 inspected |

## Per-Video v1 vs v2 Pilot Delta (@zackdfilms, N=6)

| Video ID | Tier (Outlier) | v1 -> v2 Hook Archetype | v1 -> v2 Opening Shot | v1 -> v2 Audio Classification | v1 -> v2 Topic Category |
| --- | --- | --- | --- | --- | --- |
| 0BZ1C83I2R4 | winner (7.83x) | visual_pattern_interrupt -> visual_pattern_interrupt | 24.2s -> 2.0s | music_sfx_no_vo -> music_sfx_no_vo | everyday_object_secret -> everyday_object_secret |
| CRGWDiIgMZ4 | winner (4.46x) | cold_open_action -> cold_open_crisis | 3.9s -> 1.502s | continuous_bgm_plus_vo -> minimal_ambient_plus_vo | animals_nature_survival -> animals_nature_survival |
| rPWvvcttpmk | median (0.89x) | cold_open_action -> character_story_setup | 2.4s -> 2.436s | vo_only_dry (missed) -> shifting_bgm_plus_vo | pop_culture_media_tech -> pop_culture_media_tech |
| fUmofQCc_4s | median (0.85x) | cold_open_action -> shock_fact_stat | 0.9s -> 0.9s | vo_only_dry (missed) -> shifting_bgm_plus_vo | history_weird_true_story -> history_weird_true_story |
| 5puZlZQNArc | flop (0.30x) | cold_open_action -> cold_open_crisis | 3.1s -> 3.033s | continuous_bgm_plus_vo -> shifting_bgm_plus_vo | crime_disaster_accident -> crime_disaster_accident |
| lEXSVWGubLo | flop (0.24x) | cold_open_action -> imperative_how_to_step | 18.8s -> 1.468s | vo_only_dry (missed) -> continuous_bgm_plus_vo | other -> food_diy_and_hacks |

## Out-Of-Distribution Verification (Zero 3D Channel Bias)

| Video ID | Channel / Genre | Observed Telemetry Proof | Visual GT Check (8 Panels Each) |
| --- | --- | --- | --- |
| 35No369rmq0 | Kurzgesagt (2D flat-vector explainer, 78s) | lens=flat_2d_ortho, lighting=flat_2d_unlit, easing=snappy_overshoot, shallow_dof=false, motion_graphics=true, story=what_if_chain_reaction, twist=85%, audio=shifting_bgm_plus_vo | 8/8 panels match remote drop at 2.8s, red reflection arrows at 66.5s, Iceland pin at 68.85s, sunglasses punchline at 77.73s |
| Hz64WOtsT4Y | Apple Pay / Edgar Wright BTS (live-action cinema, 52s) | boundaries=39 hard_cut / 0 hidden / 0 transition / 0 continuous, easing=natural_live, cutaway=false, emissive=false, vignette=false, jl_cut=true, time_remap=true, twist=null | 8/8 panels match 1.0s opening cut, split-screen rehearsal comparison at 13.08s, stuntperson lower-thirds, and natural motion blur |

## Four Pilot v1 Defects Fixed in v2

| Defect Found in v1 | Root Cause | Permanent Fix in v2 |
| --- | --- | --- |
| opening_shot_sec inflated to full unbroken take (24.2s and 18.8s) | Prompt did not explicitly anchor opening_shot_sec to Section 3 Row 1 end | Added explicit Row 1 rule in learn-channel-video.md and automated cross-check in scripts/schema.ts (error at >=1.5s drift, warn at >=0.5s) |
| 5/6 pilot videos collapsed into cold_open_action | cold_open_action overlapped crisis, story setup, DIY commands, and fact hooks | Replaced with 10 mutually exclusive hooks with 1-line discriminators above Section 4 JSON and updated scripts/types.ts |
| 3/3 videos on cdna2 defaulted to silent/vo_only_dry | Raw DASH m4a audio copy plus no explicit active-listening directive in prompt | Re-encoded AAC 128k 44.1kHz stereo in burnTimecode720 and added active-listening directive in both learn-channel-video.md and mine.ts |
| Prose emitted in Vietnamese and food/DIY fell into other | v1 Rule 5 requested Vietnamese prose and TOPIC_CATEGORIES lacked food/DIY | Switched Rule 5 to 100% crisp English and added food_diy_and_hacks to TOPIC_CATEGORIES |

## v2 -> v3 (`schema_version: 2`) Channel Soul Upgrade Rationale

Independent dual-agent review of `v2` (`schema_version: 1`) scored channel-soul fidelity at ~72–78% because rich visual, optical, linguistic, and vocal observations stayed locked inside prose while `stats.json` saturated on coarse booleans (`uses_motion_blur: 100%`). `v3` (`schema_version: 2`) adds ~200 output tokens without touching the 3-way byte-identical `Reusable Film & Motion Craft Taxonomy` or breaking backward compatibility with `schema_version: 1` dossiers:

| Upgrade Axis | Added in `v3` (`schema_version: 2`) | High-ROI Payoff |
| --- | --- | --- |
| Medium, POV & Voice Persona | `visual_medium`, `protagonist_format`, `narration_pov`, `voice_delivery`, `caption_style`, `emotional_driver`, `outro_hold_sec` | Captures non-3D channels (talking-head, 2D, gameplay, essay) and separates calm-authoritative vs hype personas and dead-air outros |
| 4-Way Motion Blur, Optics & Look-Dev | `uses_camera_turn_blur`, `uses_translation_or_radial_blur`, `uses_object_motion_blur`, `uses_subject_tracking_blur`, `uses_rack_focus`, `shadow_quality`, `color_palette_mood`, `has_particles_or_fluid`, `has_pip_or_split_screen`, `has_diegetic_channel_branding` | Replaces ad-hoc external `eval-baseline.json` borrowing with first-class deterministic craft percentages for ANY channel |
| Camera Move Repertoire & 1Kbps-Safe Audio | `camera_moves_used`, `bgm_mood`, `sfx_density`, `has_sfx_whoosh_or_riser`, plus `hasAudioStream` ground-truth probe in `mine.ts` | Quantifies exact camera choreography and macroscopic soundscape texture while preventing silent streams from polluting audio metrics |
| Cross-Genre Taxonomy Expansion | Added `gaming_and_challenges`, `lifestyle_vlog_challenge`, `commentary_news_essay`, `comedy_skit_parody`, `business_finance_career` (`TOPIC_CATEGORIES`), `stakes_challenge_bet` (`HOOK_ARCHETYPES`), and `challenge_experiment_arc`, `listicle_ranked_countdown`, `thesis_evidence_argument` (`STORY_STRUCTURES`) | Prevents non-explainer channels from dumping into `other` |
| Sub-beat Hygiene | Explicit rule in Section 3 to start new `Continuous [NO CUT]` sub-beats only on clear scale/angle/trajectory/story pivots | Prevents sub-0.5s micro-nudges from inflating `shot_scale_counts` and `beatsPerMin` across `N=60–300` runs |

## Live `v3` (`schema_version: 2`) Pilot Verification (`N=6` Stratified `@zackdfilms`)

Re-ran the exact same 6 stratified pilot clips (`0BZ1C83I2R4`, `CRGWDiIgMZ4`, `rPWvvcttpmk`, `fUmofQCc_4s`, `5puZlZQNArc`, `lEXSVWGubLo`) under identical AI Studio parameters (`gemini-4-hydrogen`, `Extra High`, `High`, `24fps`, Search off, 720p timecode bar) to benchmark `v3` directly against `v2`:

| Metric | `v2` Pilot (`N=6` ZDF) | `v3` Pilot (`N=6` ZDF) |
| --- | --- | --- |
| Attempt-1 strict schema pass rate | 6/6 (`schema_version: 1`) | 6/6 (`schema_version: 2`, 100%) |
| Schema warnings | 0 | 0 |
| Truncations (65k cap) | 0/6 | 0/6 |
| Output length range (chars) | 10,040 - 13,993 | 8,727 - 12,710 |
| Full English compliance | 6/6 (100%) | 6/6 (100%) |
| Audio stream verified (`hasAudioStream: true`) | 6/6 | 6/6 (100%) |
| Canonical `camera_moves_used` hygiene (zero drifted tokens) | n/a (`v1`) | 6/6 (100% canonical) |
| 4-way motion-blur separation (non-saturated) | n/a (`v1`) | Verified: `lEXSVWGubLo` object-only `[F,F,T,F]`, `rPWvvcttpmk`/`5puZlZQNArc` `subject_tracking=true`, others `false` |
| `outro_hold_sec` range | n/a (`v1`) | `0.5s - 2.1s` |
| 30fps GT visual spot-check (`0BZ1C83I2R4`, `rPWvvcttpmk`, 16 panels) | verified | 16/16 panels confirmed (`"25% ZACK D. FILMS"` phone ring branding, hamster object blur, sharp car + tracking-blurred track, `"ZACK D. FILMS"` finish arch, PiP thought bubble, `phrase_chunked_static` vs `none` captions) |

## v3 -> v4 (`schema_version: 3`, `statsVersion: 4`) Universal Any-Channel & Statistical Rigor Upgrade

Four successive 7-domain SOTA audits (Hook/Packaging, Story/Scriptcraft, Camera/Editing, Animation/Look-Dev/VFX, Audio/Voice, Showrunner Co-Creation UX, and Pipeline/Stats/Prompt Craft) uncovered structural blind spots across all 7 domains. `v4` (`schema_version: 3`, `statsVersion: 4`) upgrades the extraction prompt, standalone Gemini API CLI, deterministic aggregator (`shot-spine.ts` + `catalog-metrics.ts` + `aggregate.ts`), and synthesizer while keeping `schema_version: 1` and `2` dossiers 100% backward-compatible and keeping the 3-way `Reusable Film & Motion Craft Taxonomy` byte-identical:

| Upgrade Axis | Added in `v4` (`schema_version: 3`) & `statsVersion: 4` | High-ROI Payoff |
| --- | --- | --- |
| Universal Any-Channel Coverage (`24` `v3` Fields + `7` `v3` Signals + Additive Enums) | `acting_mode`, `set_architecture`, `visual_layer_format`, `stakes_engine`, `camera_motion_persistence`, `camera_velocity_profile`, `framing_anchor` (aspect-agnostic for both 9:16 and 16:9), `bgm_twist_behavior`, `bgm_ending_behavior`, `ending_valence`, `title_hook_relation` (splitting `visual_confirm_cold_open` vs `spoken_and_visual_mirror`), `opening_scroll_stop_state`, `open_loop_payoff_timing`, `vo_visual_relation`, `narrative_timeline`, `open_loop_architecture`, `information_reveal_mode`, format-gated non-Shorts `thumbnail_archetype`/`thumbnail_text_relation`/`thumbnail_opening_payoff`/`thumbnail_focal_complexity`/`thumbnail_gaze_or_cue` (strictly denominated on `v3WithThumbnail`, guarded fail-closed via `expectThumbnail` with flat-playlist capture & YouTube CDN fallback), longform `>180s` `0–10s`/`0–30s` opening hook window & Macro Low-FPS `uses_motion_blur` suppression, `sfx_layers_used`, `time_remap_types`; `27` total `craft_signals` (adding `has_unspoken_visual_subtext`, `has_setup_payoff_callback` with `[PLANT]`/`[PAYOFF]`, `has_match_cut`); optional `Hard Cut (<type>)` + `hardCutMechanisms`; plus additive `BEAT_ROLES` (`climax_or_payoff`), `STORY_STRUCTURES` (vlog/comedy/interview), `NARRATIVE_CONNECTORS` (banter/callback), `VOICE_DELIVERIES` (`whispered_intimate`), `AUDIO_BED_STYLES` (`foley_ambient_no_vo`), and `pass_through` camera move | Opens `channel-dna` cleanly to Shorts, midform, longform, vlogs, podcasts, comedy sketches, interviews, live-action essays, gaming, 2D/anime, CJK/Hindi/Arabic/multilingual, and 3D channels without engine or genre lock-in |
| Statistical Rigor & Zero-Token Deep Mining (`statsVersion: 4`) | Benjamini-Hochberg FDR `qValue` across all logical test families (incl. `storyDynamics`, `titleModifiers` with `question_mark`/`concrete_number`, universal 9-row `editArchitecture`, and pre-filter across `totalTestsEvaluated` in `withinBucketContrasts`), cluster-valid equal-weight per-video Mann-Whitney U (`mannWhitneyTwoSided`) on `dominantCraftMix`, `outlierRolling`-stratified URL- & aspect-ratio-aware collection (rejecting root channel tabs via `assertNotRootChannelEntries`), canonical BCP-47 tag casing (`zh-Hans`, `pt-BR`) + `api.list(vid)` native-track fallback, unbiased `uploadDate`-sorted full-catalog `eraStability` quartiles, `medianTitleDisplayUnits` + display-unit `titleCharBands` (`CJK/emoji=2`) + `isNonSpaceTitles` word-band suppression + leading badge stripping + Unicode/Arabic (`؟`) title modifiers, `formatGeometry`, `commentRate`/`commentToLikeRatio`, `heatmapSummary`/`chaptersSummary`, overlap-cleaned/SRV3-deduped `transcriptTiming` (`activeSpeechWpm`, `activeSpeechSampleN` status check, active-span `lateToEarlyWpmRatio`, `captionTailSec`), `hasReliableSentencePunctuation` auto-caption guard + Hindi `\p{M}`/`।` & Arabic `؟` token/sentence support, per-video spoken burstiness (`CV`, min..max, adj jump) & universal exclamation/echo + EN bare-pronoun / positional animate `midScriptPovShiftVideoPct` / modal & anti-slop/4th-wall audits, beat-order topology, FPS-stratified edit pacing/boundaries/framing (`editSampleN`/`editFpsMode`), `editTakeDurationEnvelope` vs sub-beat `shotDurationEnvelope`, fixed `/occlu[ds]/` hidden-cut regex, tightened `continuousBridgeMechanisms` (incl. `time_remap_bridge`), 10 Hz FFmpeg `ebur128` dynamics (`S_max`, `M_max`, `PLR`, climax delta, interior drops, `isSilentTrack` filter, `shortTermSampleN` status staleness check) + `--probe-audio-only` backfill, and FPS-stratified `macro_lowfps` downsampling (`macroOutputFps`, post-burn `encodedFps` clamping, 720p cap, duration-scaled timeouts, `finishReason !== "STOP"` SSE fail-closed guard) | Surfaces newly verified structural laws (`N=62` `@zackdfilms`: `card_flip q=0.025`, `push_up q=0.029`, `faceless_objects_diagrams q=0.019`, `Transitions & Continuity` MW-U `p=0.002 / q=0.017`, `55-64s q=0.011`, `25-34s q=0.014`, `fg_or_env_occlusion 16.1% / other 0%`, `continuousBridgeMechanisms` `other` collapsed `41.9% -> 3.2%`, unbroken take `5.46s W` vs sub-beat `2.23s W`, Winner burstiness `CV=0.36`, true positional `mid-script POV shifts 4.1%`, `0%` exclamations & 4th-wall leaks, `60%` S1/Title closing echo, `34%` bare-pronoun openers, flat `10M->11M` unbiased era quartiles) at 0 AI tokens |
| Verification Status | Verified via full automated TDD suite in `scripts/channel-dna.test.ts` (including strict 2-way `v3` enum parity + 3-way Taxonomy byte-parity) and live `statsVersion: 4` re-aggregation on `N=855` mature catalog / `N=62` `v2` `@zackdfilms` dossiers (`945` parsed shots, `945/945` tagged craft pillars); a live `N=6` + `2 OOD` `v4` (`schema_version: 3`) mining pilot is queued for the next live mining wave | Zero unverified live-pilot claims; existing `v2` corpora upgrade cleanly without losing a single dossier |
