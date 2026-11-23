# Channel DNA Extraction Prompt Design and Eval History

Canonical engineering log for system/learn-channel-video.md covering architectural rationale, controlled v1 vs v2 A/B results on 6 stratified Zack D. Films Shorts, and 2-channel out-of-distribution (OOD) verification across 2D flat-vector and live-action cinema.

## Core Design Principles

| Decision | Rationale |
| --- | --- |
| Single-pass 4-section architecture | Research on LLM pipeline decomposition (arXiv:2609.32825) shows chaining independent LLM calls drops accuracy via lossy summaries; one coherent pass captures Hook, Narrative Intent, Macro Shot Spine, and JSON Telemetry jointly while staying under 16k chars |
| 3-way byte-identical Craft Taxonomy | Reusable Film & Motion Craft Taxonomy is copied verbatim from aistudio/system/analyze-ref-video.md and compare-2-video.md and locked by an automated unit test in scripts/channel-dna.test.ts |
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
