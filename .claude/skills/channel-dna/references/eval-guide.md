# Evaluation and Incremental Corpus Growth Guide

Standard operating guide for future AI sessions upgrading system/learn-channel-video.md (v1 to v2+) or scaling any channel corpus (for example zack-d-films from N=20 to N=40, N=100, and N=300+) without losing data or corrupting statistical denominators.

## Prompt Upgrade Protocol (learn-channel-video.md)

| Step | Mandatory Action | Gate |
| --- | --- | --- |
| 1 | Run unit tests and 3-way Reusable Film & Motion Craft Taxonomy byte-parity check before and after edits | bun test ./.claude/skills/channel-dna/scripts/channel-dna.test.ts must pass 100% |
| 2 | Run controlled A/B evaluation on at least 6 stratified videos (2 Winner, 2 Median, 2 Flop) plus 2 out-of-distribution non-target-channel clips (2D vector and live-action) under identical model, Extra High thinking, Media High, 24fps, Search off | Never compare across different models or resolutions |
| 3 | Extract 30fps ground-truth contact sheets (8 frames per clip covering opening, boundaries, midpoint, twist, and ending) and inspect every sheet visually against dossier.md and telemetry.json | Hook archetype, opening_shot_sec, boundaries, shot scales, cutaways, and twist timing must match true pixels |
| 4 | Run 3 independent strict review subagents (unspoiled, zero hints) auditing GT accuracy, schema hygiene, deterministic aggregation math, and synthesized channel skill quality | Ship only after 3/3 PASS with 0 Critical and 0 Required findings |

## 6-Axis Evaluation Rubric (30 Points Per Video)

| Axis | Evaluation Criteria | Hard Gate |
| --- | --- | --- |
| 1. Hook & Opening Precision | Accurate hook_archetype, exact opening_shot_sec matching Section 3 Row 1, verbatim opening spoken line, and accurate f0-f90 visual trigger | Misclassified hook or fabricated opening quote incurs heavy penalty |
| 2. Storytelling & Retention Fidelity | story_beats match actual narrative phases summing to 95-105%, accurate narrative_connector, true twist_at_pct, and exact ending_type | Never invent a twist on a straight step-by-step explainer |
| 3. Directorial Intent Depth | Section 2 explains why each camera, edit, or audio choice serves viewer psychology rather than repeating Section 3 visual description | Must deliver genuine intent reasoning, not shot-list echoes |
| 4. Macro Shot & Boundary Accuracy | Exact 5-state boundary enum (Opening, Hard Cut, Hidden Cut, Transition, Continuous) verified on 30fps GT frames without false Hard Cuts on continuous whips | Section 3 boundary counts must match Section 4 JSON counts |
| 5. Craft Signals & Anti-Hallucination | Accurate craft_signals booleans (cutaway, blur, DOF, vignette, pre-impact silence, loop), zero fabricated optical grit, zero guessed mm numbers, zero masked 1Kbps SFX claims, zero engine leaks | Fabricated effects or masked SFX claims incur heavy penalty |
| 6. Schema Hygiene & Zero Truncation | Complete 4 sections, 100% strict schema.ts validation pass, closed enums obeyed, concise density avoiding the 65k output cap | Automated schema validation rate must hit 100% |

## Incremental Scaling Workflow (N=6 -> N=20 -> N=100 -> N=300+)

| Milestone | Commands | Skill Update Rule |
| --- | --- | --- |
| Pilot (N=6) | DNA mine --channel slug --limit 6 --tabs 2 | Visually inspect 48 ground-truth 30fps panels across all 6 clips to verify prompt and schema before scaling |
| Foundation (N=20) | DNA mine --channel slug --limit 14 --tabs 2 then DNA aggregate --channel slug | Sufficient stratified sample (Winners, Medians, Flops across core topics) to synthesize v1 of the standalone channel skill |
| Growth Waves (N=40 -> 100 -> 300+) | Re-run DNA collect if catalog snapshot exceeds 30 days, then DNA mine --limit 20, then DNA aggregate | Keep all prior videos/ folders intact, recompute stats.json deterministically, and update percentages and Lift tables in the channel skill references with explicit new N denominators |
