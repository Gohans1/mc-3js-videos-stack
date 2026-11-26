---
name: channel-dna
description: Reverse-engineers any YouTube channel (Shorts, midform, or longform; 3D, 2D/anime, live-action, talking-head, vlog, essay, documentary, comedy, interview, gaming, or hybrid) into a standalone 3-Zone Channel Soul AI production skill using yt-dlp catalog/packaging/WPM/heatmap/chapters/linguistics telemetry, resumable checkpointed multimodal extraction (learn-channel-video.md v4 / schema v3, backward-compatible with v1/v2; backend-agnostic across aistudio and official gemini-api), deterministic statistical aggregation (statsVersion 4: BH-FDR q-values, unbroken-take vs sub-beat shot spine, dominant craft pillar mix, continuous bridges, per-video burstiness, unbiased era quartiles, within-bucket contrasts), and interactive co-creation skill synthesis. Use when asked to learn any channel's full style or formula, mine hooks and storytelling patterns across many videos, grow an existing channel corpus incrementally, or build a channel-specific production skill (such as zack-d-films).
---

# channel-dna

Channel-, format-, language-, engine-, and backend-agnostic reverse-engineering factory for YouTube production systems: collects full-channel catalogs, overlap-cleaned timed transcripts, spoken WPM, engagement ratios, heatmaps, and chapters via `yt-dlp` and `youtube-transcript-api` (0 AI tokens), mines deep visual, optical, acting, set-architecture, linguistic, narrative, thumbnail (format-gated for non-Shorts), and audio DNA through resumable checkpointed multimodal runs (`--backend aistudio` or `--backend gemini-api`) alongside 10 Hz FFmpeg loudness/dynamics telemetry, aggregates `statsVersion: 4` statistics deterministically in code (0% hallucinated math, BH-FDR `qValue` multiple-testing control), and synthesizes an open, engine-agnostic standalone **Channel Soul** production skill at `.claude/skills/<channel-slug>/`.

## 4-Stage Pipeline

Shorthand: `DNA = bun .claude/skills/channel-dna/scripts/cli.ts`.

| Stage | Command | Output |
| --- | --- | --- |
| 1. Collect catalog & WPM (0 AI tokens) | `DNA collect --channel <slug> --url https://www.youtube.com/@<handle>/shorts --max-videos 300 --enrich 120 --transcripts 120 [--backfill-timing] [--min-duration 10 --max-duration 185]` | Writes `catalog.json` (skipping live/upcoming/members-only items, format-partitioned centered rolling-median outlier scores, canonical `/watch?v=` enrichment for dimensions/FPS/comments/thumbnail/language/chapters/heatmap, overlap-cleaned timed transcripts with `activeSpeechWpm` and `lateToEarlyWpmRatio`, stratified on `outlierRolling` instead of raw views) and balanced 40/30/30 `queue.json` (auto-defaults `--max-duration` to `185s` for `/shorts` or `3600s` for `/videos`) |
| 2. Mine deep DNA with checkpoints (`v4` / `schema_version: 3`) | `DNA mine --channel <slug> --limit 20 --tabs 2 [--backend aistudio\|gemini-api] [--fps 24 \| --auto-fps] [--with-thumbnail\|--no-thumbnail] --model gemini-4-hydrogen` | Enforces 1M unified token pre-flight budget (`~136s` at `24 fps` High; `--auto-fps` or float `--fps 0.2..24` for longform macro mode), burns 720p timecode bar while probing `hasAudioStream`, `durationSec`, `sourceFps`, `sourceWidth`/`sourceHeight`, and 10 Hz FFmpeg EBU R128 loudness/dynamics (`I`, `S_max`, `M_max`, `TP`, `PLR`, climax delta, relative drops, silence), attaches browse thumbnail automatically on non-Shorts `/videos`, defaults `--expect-schema 3` on built-in `v4` runs without forcing re-mining of older dossiers (pass `--upgrade-below 3` to upgrade legacy dossiers first), verifies video/audio tokens, rejects `INPUT_INCOMPLETE` / degraded 1fps / missing-audio disclosures / invalid schemas (1 auto-retry), halts cleanly on quota/bot/auth/`media_downgrade`, saves `videos/<id>/{dossier.md,telemetry.json,meta.json}`, cleans temp files, and updates `checkpoint.json` |
| 3. Aggregate deterministically (0% LLM math) | `DNA aggregate --channel <slug> [--min-schema 1\|2\|3]` | Writes `stats.json` (`statsVersion: 4`) and `stats-summary.md` with BH-FDR `qValue` alongside Fisher exact `pValue`, `formatGeometry`, `commentRate`/`commentToLikeRatio`, `heatmapSummary`/`chaptersSummary`, adaptive WPM & Shorts/Midform/Longform duration cliffs, `titleCharBands`, unbiased chronological `eraStability` quartiles alongside quarterly `temporalStability`, per-video spoken burstiness & anti-slop/4th-wall audits, beat-order topology, equal-weight video-level edit architecture, FPS-stratified Section 3 `shotSpine` (`editTakeDurationEnvelope` vs `shotDurationEnvelope`, `dominantCraftMix`, `transitionSpans`, `hiddenCutMechanisms`, `continuousBridgeMechanisms`), `withinBucketContrasts` (BH-FDR across all evaluated tests), `lightingByTopic`/`actingByProtagonist`/`setByTopic` cross-tabs, progressive `v2DeepDna` & `v3DeepDna`, and silent-track-filtered Winner-vs-Flop FFmpeg loudness summaries |
| 4. Synthesize or upgrade Channel Soul skill | Apply `system/synthesize-channel-skill.md` to `stats.json` + representative dossiers + `references/field-notes.md` | Generates or updates standalone 3-zone, dual-mode production skill at `.claude/skills/<slug>/` (Zone 1 Use: `SKILL.md` with Gate-to-File Progressive Loading Map, Complete Entry Router, 3 Stop-and-Wait Mode A gates, 6 department guides, synced blueprint + Asset/Cue Manifest + Audio-First Re-Timing; Zone 2 Extend: append-only `references/field-notes.md` preserved across resynthesis; Zone 3 Corpus/Eval: `references/corpus/`) |

## Incremental Growth & Utility Commands

| Task | Command |
| --- | --- |
| Full CLI syntax & optional flags | `DNA --help` |
| Check corpus progress, `v1/v2/v3` schema split, and stale `stats.json` status | `DNA status --channel <slug>` |
| Mine next 20 unmined videos enforcing `schema_version >= 3` on new outputs without re-mining older `v2` dossiers | `DNA mine --channel <slug> --limit 20 --tabs 2 --model gemini-4-hydrogen` |
| Upgrade earlier `<3` dossiers cleanly in place before mining new videos | `DNA mine --channel <slug> --limit 20 --upgrade-below 3` |
| Backfill 10 Hz FFmpeg audio loudness & media geometry on already-mined clips (0 AI tokens) | `DNA mine --channel <slug> --probe-audio-only --limit 50` |
| Backfill overlap-cleaned `transcriptTiming` on already-cached catalog transcripts (0 AI tokens) | `DNA collect --channel <slug> --url <url> --backfill-timing --enrich 0 --transcripts 120` |
| Publish a filtered schema cohort (`v2+` or `v3`) while keeping legacy dossiers on disk | `DNA aggregate --channel <slug> --min-schema 2` |
| Pass authenticated YouTube session if anonymous `yt-dlp` hits bot-gates | `DNA mine --channel <slug> --limit 20 --cookies-from-browser chrome` (or `--cookies path/to/cookies.txt`) |
| Retry failed IDs or mine specific IDs (mines all listed IDs when `--limit` is omitted) | `DNA mine --channel <slug> --retry-failed` or `DNA mine --channel <slug> --ids id1,id2` |
| Validate one dossier against strict schema (`v1`/`v2`/`v3`, auto-reads sibling `meta.json` FPS/audio/duration) | `DNA validate <path/to/dossier.md>` |
| Run standalone fail-closed Gemini API video/image CLI (usable by `analyze-ref-video` and `compare-video`) | `bun .claude/skills/channel-dna/scripts/gemini-api.ts --help` |
| Run unit, 2-way `v3` schema parity, & 3-way Taxonomy byte-parity tests | `bun test ./.claude/skills/channel-dna/scripts/channel-dna.test.ts` |

## Non-Negotiable Engineering Laws

| Law | Why |
| --- | --- |
| Normalize performance with centered rolling median (up to 20 nearest mature same-format neighbors excluding self; `<30d` quarantined as `provisional`) and stratify collection on `outlierRolling` | Eliminates channel-growth era bias, Shorts-vs-longform distortion, video-age bias, and raw-view enrichment skew |
| Report equal-weight per-video rates alongside pooled counts, reliability (`stable >=8`, `tentative 5–7`, `directional <5`), Fisher exact `pValue`, AND Benjamini-Hochberg FDR `qValue` | Prevents 1 outlier cluster or multiple-testing noise (`p < 0.05` across 100+ probes) from masquerading as a channel-wide law |
| Never blend denominators across `catalog`, `mature`, `enriched`, `clean transcripts`, `deepDna`, `audioVerified`, `microFpsSampleN`, `schema v2+`, and `schema v3` subsamples | Every published rule states its exact sample size (`N`) and FPS tier so future AI judges statistical confidence honestly |
| Exclude `hasAudioStream: false` & `isSilentTrack` clips from audio/loudness metrics, `<10 FPS` `macro_lowfps` clips from 24fps-only optical/shot-spine metrics, and corrupt ASR from WPM/linguistics | Keeps muted tracks, low-FPS longform macro passes, and broken YouTube auto-captions from polluting clean channel baselines |
| Never ask an LLM to eyeball percentages across prose dossiers | All percentages, medians, IQRs, burstiness CVs, shot/take durations, craft pillar shares, cross-tabs, within-bucket contrasts, and Winner/Flop lifts come strictly from `scripts/aggregate.ts` |
| Keep `Reusable Film & Motion Craft Taxonomy` byte-identical with `analyze-ref-video` and `compare-video` prompts | Guarantees unified vocabulary across Copy (`analyze-ref-video`), Compare (`compare-video`), and Learn (`channel-dna`) |

## Backend-Agnostic Runner Contract

This skill owns the **mining pipeline, system prompts, strict schema validator, deterministic aggregator, and corpus layout** — never a single vendor UI. `scripts/mine.ts` supports both `--backend aistudio` (default, `.claude/skills/aistudio/scripts/ask.ts`) and `--backend gemini-api` (official File API + streaming SSE `:streamGenerateContent?alt=sse` via `scripts/gemini-api.ts`); plugging in Vertex AI or another multimodal CLI replaces only the transport invocation in `scripts/mine.ts`:

| Input / Output | Contract |
| --- | --- |
| `files` | `[<id>_timecode.mp4]` (720p timecode strip + clean AAC stereo audio) + optional browse thumbnail image on non-Shorts `/videos` |
| `systemFile` | `.claude/skills/channel-dna/system/learn-channel-video.md` (`v4` emitting `schema_version: 3`; `schema.ts` and `aggregate.ts` remain 100% backward-compatible with `v1` and `v2`) |
| `prompt` | Video title header + active-listening, thumbnail-mode, macro-lowFPS (if applicable), and expected-FPS directive |
| `model` & `thinking` | Frontier multimodal video model (`gemini-4-hydrogen` / equivalent) with Extra High reasoning; web search / grounding **OFF** |
| `mediaResolution` & `fps` | High resolution at `24 fps` for `<= 136s` (`micro_24fps`); float `0.2..6 fps` (`--auto-fps`) or windowed `--start`/`--end` slices for `> 136s` (`macro_lowfps`) |
| Return value | Raw UTF-8 markdown (`dossier.md` passing `scripts/schema.ts`) plus optional runner `chatUrl`/job provenance |

## Format Scope & Long-Form Guidance (`> 136s`)

- **Collection & Aggregation (Shorts, Midform & Longform):** `collect.ts`, `catalog-metrics.ts`, and `aggregate.ts` automatically adapt to Shorts (`<=90s`), Midform (`91–300s`), and Longform (`>300s`) channels (aspect-ratio-aware format partitioning, adaptive duration & WPM bands, language-gated English openers, conditional emoji/thumbnail/heatmap/chapters tables, and `--min-duration`/`--max-duration`).
- **24 FPS Single-Pass Mining Ceiling (`~136s` / `2m 16s`):** At `24 fps` High resolution (`~280 tok/frame + 32 tok/s audio = 6,752 tok/s` plus `~75k` system/prompt overhead), a single pass reaches the `1,000,000`-token context window at **`~136s` (`2m 16s`)**. `mine.ts` enforces this budget pre-flight before downloading/uploading; for `> 136s` clips, pass `--auto-fps` (or float `--fps 1..4` / `--media Medium`, tagging `miningMode: "macro_lowfps"` so sub-second optical metrics stay unpolluted) or slice windows via `gemini-api.ts --start/--end`.

## Reference Index & 3-Zone Ownership (1 Level Deep From SKILL.md)

| Zone | Path | Purpose |
| --- | --- | --- |
| Use (this skill) | `SKILL.md` | Day-to-day CLI workflow to collect catalogs, mine incremental checkpointed batches, backfill audio/timing, validate, and aggregate any YouTube channel |
| Prompt Engine (dev/extend) | [system/learn-channel-video.md](system/learn-channel-video.md) | `v4` universal extraction prompt for Title/Thumbnail-Hook alignment, Storytelling, Staging, Camera, Optics, Acting, Soundscape, Macro Shot Spine, and `schema_version: 3` Telemetry JSON (`27` craft signals) |
| Prompt Engine (dev/extend) | [system/synthesize-channel-skill.md](system/synthesize-channel-skill.md) | Dual-mode 3-zone Channel Soul synthesis prompt with Gate-to-File Progressive Loading, 3 Stop-and-Wait Co-Creation Gates, Beat Sync Contract, Asset/Cue Manifest, Audio-First Re-Timing, Style-Transfer Matrix, and append-only `field-notes.md` preservation |
| Dev & Maintenance | [references/architecture.md](references/architecture.md) | Factory architecture (`statsVersion: 4`), source modules (`shot-spine.ts`, standalone `gemini-api.ts`), corpus contracts, transport backends, 10 Hz FFmpeg loudness, and atomic checkpointing |
| Dev & Prompt History | [references/prompt-learn-design.md](references/prompt-learn-design.md) | Prompt engineering design, v1 -> v2 -> v3 -> v4 evolution, 30fps GT pilot evaluation, and OOD verification |
| Eval & Scaling | [references/eval-guide.md](references/eval-guide.md) | 6-axis 30-point rubric, Stage 4 Synthesized Skill Acceptance Check, independent review gate protocol, and incremental scaling guide (`N=20 -> 60 -> 100+`) |
