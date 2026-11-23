# Corpus Lineage, Eval Audit Log, and Resume Guide (`zack-d-films`)

Living telemetry ledger for `.claude/skills/zack-d-films/`. Every file in `references/corpus/` is generated deterministically by `.claude/skills/channel-dna/scripts/cli.ts` (`collect`, `mine`, `aggregate`) and `mc-friendly-cohort.json`. Note: `stats-summary.md` is a raw machine-generated audit snapshot for re-aggregation and verification; when producing a new video, read `SKILL.md` and the synthesized department guides (`references/*.md`) instead to avoid redundant context.

## 1. Snapshot Progression (`Wave 1 N=6 -> Wave 2 N=17`)

| Milestone | Date | Catalog Collected | Mature (`>=30d`) | MC-Friendly Mature (`Top 250` floor) | Enriched Meta (Mature / Total) | Transcripts WPM (Mature / Total) | Deep DNA Mined (`W / M / F`) | Attempt-1 Valid / Zero Warnings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wave 1 Pilot (`v2`) | `2026-11-22` | `300` | `156` | — | `64 / 100` | `51 / 85` | `N=6` (`2 / 2 / 2`) | `6/6` (`100%`) / `0` warnings |
| Wave 2 MC-Friendly (`v2`) | `2026-11-22` | **`1,000`** | **`855`** (`10.0M` median) | **`734`** (`85.8%`; Top 250 `>=13.0M`, Top 300 `>=11.0M`) | **`316 / 352`** (`270` MC-friendly) | **`51 / 85`** (`43` MC-friendly) | **`N=17`** (`7 / 6 / 4`) | **`17/17` (`100%`) / `0` warnings** |
| Supplementary Visual Craft Benchmark | `2026-11-22` | — | — | — | — | — | `N=60` (`eval-baseline.json`) | `696` 30fps GT panels (`98.9%–99.4%` critic accuracy) |

## 2. Complete `N=17` Mined Video Roster (`17/17` Valid, `0` Errors, `0` Warnings)

All 17 dossiers were mined via `gemini-4-hydrogen` (`Thinking: Extra High`, `Media: High`, `FPS: 24`, `Search: off`, `promptVersion: v2`) on 720p CRF 22 timecode-burned clips (`16/17` aurally verified with AAC 44.1kHz stereo audio; `SGgYDfeHYXA` analyzed frame-sampled with burnt-in captions and no attached audio stream per its dossier calibration disclosure):

| # | Video ID | Tier | Outlier | Views | Dur | Hook | Structure | Hard Cuts | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0BZ1C83I2R4` | `winner` | `7.83x` | `78.3M` | `24.2s` | `visual_pattern_interrupt` | `mechanism_step_by_step` | `0` | Wave 1; miniature worker inside wall outlet parody (MC-friendly) |
| 2 | `SGgYDfeHYXA` | `winner` | `7.76x` | `72.2M` | `73.2s` | `hypothetical_premise` | `what_if_chain_reaction` | `0` | Wave 2; 1st-person POV unconscious pilots survival (audio unverified: no stream) |
| 3 | `7i6ok0llYUc` | `winner` | `5.94x` | `58.5M` | `36.9s` | `character_story_setup` | `problem_solution_irony` | `0` | Wave 2; classroom balloon happiness experiment |
| 4 | `320fjAdEboQ` | `winner` | `5.19x` | `50.4M` | `37.5s` | `hypothetical_premise` | `what_if_chain_reaction` | `0` | Wave 2; yard desire-path erosion into war trench |
| 5 | `UgP7_6_i1J4` | `winner` | `4.92x` | `45.3M` | `35.5s` | `hypothetical_premise` | `problem_solution_irony` | `1` | Wave 2; Disney Castle forced perspective trick |
| 6 | `CRGWDiIgMZ4` | `winner` | `4.46x` | `62.5M` | `27.6s` | `cold_open_crisis` | `mechanism_step_by_step` | `0` | Wave 1; cookiecutter shark ocean survival (`162.9 WPM`) |
| 7 | `OXRzmyOMKVw` | `winner` | `3.44x` | `45.2M` | `58.2s` | `imperative_how_to_step` | `mechanism_step_by_step` | `0` | Wave 2; hide-and-seek social strategy (`157.2 WPM`) |
| 8 | `Uzo10EjKC6w` | `median` | `1.39x` | `12.6M` | `53.9s` | `character_story_setup` | `chronological_escalation_twist` | `0` | Wave 2; loyal dog guarding grave true story |
| 9 | `epP7TB8n3ZU` | `median` | `1.33x` | `14.2M` | `27.9s` | `character_story_setup` | `chronological_escalation_twist` | `0` | Wave 2; Sharpie uniform prison escape (`177.9 WPM`) |
| 10 | `tFbYLBxBB00` | `median` | `1.05x` | `10.4M` | `47.8s` | `hypothetical_premise` | `what_if_chain_reaction` | `0` | Wave 2; eating too many bananas radiation threshold |
| 11 | `rPWvvcttpmk` | `median` | `0.89x` | `13.6M` | `55.1s` | `character_story_setup` | `chronological_escalation_twist` | `0` | Wave 1; racing dead dad's ghost car (`153.8 WPM`) |
| 12 | `fUmofQCc_4s` | `median` | `0.85x` | `11.9M` | `38.6s` | `shock_fact_stat` | `problem_solution_irony` | `2` | Wave 1; Phoebus lightbulb cartel (`152.3 WPM`) |
| 13 | `HF1K91wSTTc` | `median` | `0.79x` | `9.1M` | `30.4s` | `visual_pattern_interrupt` | `problem_solution_irony` | `0` | Wave 2; Navy harbor sea lion clamp (`172.0 WPM`) |
| 14 | `LjHDUQ7Htvk` | `flop` | `0.35x` | `2.8M` | `49.0s` | `hypothetical_premise` | `what_if_chain_reaction` | `16` | Wave 2; rewind device promo (`16` hard cuts, missing emoji, `3s` dead CTA card) |
| 15 | `QXEr924US38` | `flop` | `0.33x` | `2.3M` | `37.2s` | `visual_pattern_interrupt` | `mechanism_step_by_step` | `6` | Wave 2; gambling psychology negative control (brief skull dopamine cutaway, `snappy_overshoot`) |
| 16 | `5puZlZQNArc` | `flop` | `0.30x` | `4.2M` | `36.9s` | `cold_open_crisis` | `chronological_escalation_twist` | `0` | Wave 1; thin-ice rescue (`178.4 WPM`, linear safe ending) |
| 17 | `lEXSVWGubLo` | `flop` | `0.24x` | `4.4M` | `25.5s` | `imperative_how_to_step` | `mechanism_step_by_step` | `0` | Wave 1; Big Mac sushi push pop (`186.9 WPM`, dry DIY steps) |

## 3. Verification & Transparent Block Log

- **Visual 30fps Ground-Truth Verification:**
  - Wave 1 (`6/6` ZDF = `48` GT panels) + OOD (`2/2` = `16` GT panels) visually inspected directly frame-by-frame (`64/64` panels confirmed against dossier timestamps, boundaries, and craft claims; see `.claude/skills/channel-dna/references/prompt-learn-design.md`).
  - Supplementary `N=60` ZDF visual craft benchmark: `696` GT panels verified at `98.9%–99.4%` blind critic accuracy (`.claude/skills/analyze-ref-video/references/eval-baseline.json`).
  - Wave 2 (`11/11` completed dossiers): `11/11` passed `parseAndValidateDossier` on Attempt 1 with `0` errors and `0` warnings (including strict Section-3-to-JSON boundary, scale, angle, and `opening_shot_sec` cross-checks).
- **Audio Calibration Disclosure (`16/17` Aurally Verified):**
  - `SGgYDfeHYXA` (Winner) was mined on a frame-sampled input with burnt-in captions and no attached audio stream (`videos/SGgYDfeHYXA/dossier.md` lines 6 & 52). Its `audio_bed_style: "vo_only_dry"`, `has_pre_impact_silence: false`, and `has_jl_cut: false` fields are unverified calibration fallbacks; all audio claims in `references/audio-voice-and-pacing.md` explicitly cite the `16/17` (`6/7` Winners) aurally verified subsample.
- **Wave-2 Checkpointed Failures (`3` items logged cleanly in `checkpoint.json` for later `--retry-failed`):**
  1. `NdKRD1j9juE` (*He Drifted At Sea For 133 Days*): AI Studio `"Copy as markdown"` returned empty on attempts 1 & 2.
  2. `KBfPDWqZ28I` (*They Stole A Shark Using A Baby Stroller*) and `vhxGX3kQMXQ` (*Could A Giant Magnet Move An Asteroid?*): YouTube anonymous `yt-dlp` download hit `"Sign in to confirm you're not a bot"` after `12` consecutive Wave-2 downloads across both tabs (`11` mined successfully + `NdKRD1j9juE` downloaded prior to its empty copy); mining respected the anti-bot gate cleanly without bypassing it.
- **Transcript Rate Limit Note:** During the `N=1,000` catalog expansion (`collect --transcripts 250`), YouTube's transcript endpoint returned `IpBlocked` on new requests; `collect.ts` logged the transient error cleanly and preserved all `85` previously cached transcripts (`51` mature, `43` MC-friendly) without overwriting any record.

## 4. Exact Commands to Resume & Scale (`N=17 -> 40 -> 100 -> 300+`)

Run all commands from the repo root. Checkpointing (`checkpoint.json`) and atomic writes guarantee zero data loss across multi-day runs:

```powershell
# 1. Check live progress (completed, failed, mature counts, median views)
bun .claude/skills/channel-dna/scripts/cli.ts status --channel zack-d-films

# 2. Refresh catalog, newly matured metadata, and retry missing transcripts (when IP cooldown clears)
bun .claude/skills/channel-dna/scripts/cli.ts collect --channel zack-d-films --url https://www.youtube.com/@zackdfilms/shorts --max-videos 1000 --enrich 250 --transcripts 250

# 3. Mine the next 20 stratified videos from queue.json across 2 parallel AI Studio tabs
bun .claude/skills/channel-dna/scripts/cli.ts mine --channel zack-d-films --limit 20 --tabs 2 --model gemini-4-hydrogen --thinking "Extra High" --media High --fps 24 --prompt-version v2

# 4. Retry previously failed IDs (optional)
bun .claude/skills/channel-dna/scripts/cli.ts mine --channel zack-d-films --limit 10 --retry-failed

# 5. Deterministically recompute stats.json + stats-summary.md (zero LLM math)
bun .claude/skills/channel-dna/scripts/cli.ts aggregate --channel zack-d-films
```

After scaling to `N=40` or `N=100`, re-run `aggregate` and update the numeric tables across `SKILL.md` and `references/*.md` using `.claude/skills/channel-dna/system/synthesize-channel-skill.md` so every statistic remains 100% synchronized with `references/corpus/stats.json`.
