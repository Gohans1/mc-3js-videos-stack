# Evaluation and Incremental Corpus Growth Guide

Standard operating guide for future AI sessions upgrading system/learn-channel-video.md (v1 -> v2 -> v3 -> v4+), auditing synthesized Channel Soul skills, or scaling any channel corpus (for example zack-d-films from N=20 to N=60, N=100, and N=300+) without losing data or corrupting statistical denominators.

## Prompt Upgrade Protocol (learn-channel-video.md)

| Step | Mandatory Action | Gate |
| --- | --- | --- |
| 1 | Run unit tests, 2-way v3 schema enum parity, and 3-way Reusable Film & Motion Craft Taxonomy byte-parity check before and after edits | bun test ./.claude/skills/channel-dna/scripts/channel-dna.test.ts must pass 100% |
| 2 | Run controlled A/B evaluation on at least 6 stratified videos (2 Winner, 2 Median, 2 Flop) plus 2 out-of-distribution non-target-channel clips (2D vector and live-action/longform) under identical model, Extra High thinking, Media High, 24fps (or macro low-FPS on >136s), Search off | Never compare across different models or resolutions |
| 3 | Extract 30fps ground-truth contact sheets (8 frames per clip covering opening, boundaries, midpoint, twist, and ending) and inspect every sheet visually against dossier.md and telemetry.json | Hook archetype, opening_shot_sec, boundaries, shot scales, cutaways, 4-way blur, outro_hold_sec, and twist timing must match true pixels |
| 4 | Run 2–3 independent strict review subagents (unspoiled, zero hints) auditing GT accuracy, schema hygiene, deterministic aggregation math, and synthesized channel skill quality | Ship only after PASS with 0 Critical and 0 Required findings |

## 6-Axis Extraction Evaluation Rubric (30 Points Per Video)

| Axis | Evaluation Criteria | Hard Gate |
| --- | --- | --- |
| 1. Hook & Opening Precision | Accurate hook_archetype, opening_scroll_stop_state, title_hook_relation, open_loop_payoff_timing, thumbnail_* (thumbnail_archetype, thumbnail_text_relation, thumbnail_opening_payoff, thumbnail_focal_complexity, thumbnail_gaze_or_cue when non-Shorts thumbnail attached, verified via `expectThumbnail` fail-closed guard), exact opening_shot_sec matching Section 3 Row 1, verbatim opening spoken line, accurate opening visual trigger (`f0-f90` for `<=180s` micro-FPS; `00:00-00:10` visual hook & `00:00-00:30` intro confirmation for `>180s`/Macro Low-FPS), visual_medium, protagonist_format, and emotional_driver | Misclassified hook or fabricated opening quote incurs heavy penalty |
| 2. Storytelling & Retention Fidelity | story_beats (incl. climax_or_payoff) match actual narrative phases summing to 95-105%, accurate narrative_timeline, open_loop_architecture, information_reveal_mode, narrative_connector, vo_visual_relation, narration_pov, voice_delivery, true twist_at_pct aligned to twist beat onset, exact ending_type/ending_valence, and measured outro_hold_sec | Never invent a twist on a straight step-by-step explainer |
| 3. Directorial Intent Depth | Section 2 explains why each camera, edit, or audio choice serves viewer psychology (tagging explicit `[PLANT]`/`[PAYOFF]` callbacks when present) rather than repeating Section 3 visual description | Must deliver genuine intent reasoning, not shot-list echoes |
| 4. Macro Shot & Boundary Accuracy | Exact 5-state boundary enum (Opening, Hard Cut [optional `Hard Cut (<type>)`], Hidden Cut, Transition, Continuous with clean sub-beat hygiene), exact closed Scale/Angle tokens, accurate dominant `[Category]` pillar tags, and accurate camera_moves_used (incl. pass_through) verified on 30fps GT frames without false Hard Cuts on continuous whips | Section 3 boundary, scale, and angle counts must match Section 4 JSON counts |
| 5. Craft Signals & Anti-Hallucination | Accurate 27 craft_signals booleans in schema_version 3 (20 v2 signals plus has_expressive_facial_or_gesture_acting, has_fg_parallax_or_ots, has_archival_or_real_footage, has_direct_camera_address, has_unspoken_visual_subtext, has_setup_payoff_callback, has_match_cut), accurate v2/v3 universal craft fields (framing_anchor, acting_mode, set_architecture, visual_layer_format, stakes_engine, camera_motion_persistence, camera_velocity_profile, bgm_twist_behavior, bgm_ending_behavior, sfx_layers_used, time_remap_types); zero fabricated optical grit, zero guessed mm/f-stop/LUFS/BPM numbers, zero masked 1Kbps SFX claims, zero engine leaks (draw(t)/THREE.*/bpy.*) | Fabricated effects or masked SFX claims incur heavy penalty |
| 6. Schema Hygiene & Zero Truncation | Complete 4 sections, 100% strict schema.ts validation pass (schema_version: 3 for prompt v4; legacy v1/v2 remain backward-compatible), closed enums obeyed with zero coherence warnings, concise density avoiding the 65k output cap | Automated schema validation rate must hit 100% |

## Stage 4 Synthesized Skill Acceptance Check (5-Row Gate)

Run this deterministic acceptance check on every newly synthesized or updated `.claude/skills/<channel-slug>/` skill before declaring Stage 4 complete:

| Check | Verification Method | Pass Condition |
| --- | --- | --- |
| 1. Math & Denominator Integrity | Cross-check every quoted percentage, median, IQR, burstiness CV, Fisher `p`, BH-FDR `q`, and band rate in Zone 1 files against `references/corpus/stats.json` / `stats-summary.md` | 0 invented numbers, 0 blended denominators, `eraStability` vs enriched quarterly skew disclosed |
| 2. Progressive Disclosure & Links | Verify `SKILL.md` line count, Gate-to-File Progressive Loading Map, Complete Entry Router, live-read rule for `references/field-notes.md`, and every relative markdown link/anchor | `SKILL.md` < 250 lines; 0 broken links or missing anchors; 1-level-deep reference layout |
| 3. Open Core & Verified Adapter | Confirm core guides stay 100% engine-agnostic (no engine APIs outside isolated optional adapters) and verify every local adapter symbol/CLI flag against repo code / `CAPABILITIES.md` | 0 leaked engine APIs in core files; 100% verified adapter exports and flags |
| 4. Worked Blueprint & Stage A Audit | Programmatically count words, sentences, per-video CV, beat `%` sum, calculated WPM, zero 4th-wall/redundancy leaks, `Pre-VO Projections` label, **Clean-Read VO / TTS Block**, 6-row Asset/Cue Manifest bound to `[Word/Event Anchor]`, and `VO Cue & [Sync Anchor]` table in `references/examples/*.md` | 100% measurable Stage A (`A1–A9`) PASS with zero arithmetic drift |
| 5. Zone-2 Preservation & Original QA Routing | Confirm every prior `references/field-notes.md` entry is preserved verbatim and post-render original-video QA routes to the 3-Step Original-Video Stage B Protocol (never misusing `compare-video`) | 0 lost field notes; clean separation between original-video QA and 1:1 remake `compare-video` |

## Incremental Scaling Workflow (N=6 -> N=20 -> N=100 -> N=300+)

| Milestone | Commands | Skill Update Rule |
| --- | --- | --- |
| Pilot (N=6) | DNA mine --channel slug --limit 6 --tabs 2 | Visually inspect 48 ground-truth 30fps panels across all 6 clips to verify prompt and schema before scaling |
| Foundation (N=20) | DNA mine --channel slug --limit 14 --tabs 2 then DNA aggregate --channel slug | Sufficient stratified sample (Winners, Medians, Flops across core topics) to synthesize v1 of the standalone channel skill |
| Growth Waves (N=40 -> 60 -> 100 -> 300+) | Re-run DNA collect if catalog snapshot exceeds 30 days (add `--backfill-timing` for cached transcripts), run `DNA mine --channel slug --probe-audio-only` for 0-token FFmpeg loudness backfill, mine new clips (`DNA mine --channel slug --limit 20`, or `--upgrade-below 3` to upgrade legacy dossiers first), then `DNA aggregate --channel slug --min-schema 2` (or `3`) | Keep all prior videos/ folders intact, recompute stats.json deterministically (statsVersion 4), preserve `references/field-notes.md` verbatim, and update Zone 1 guides passing the 5-row Stage 4 Acceptance Check |
