---
name: channel-dna
description: Reverse-engineers any YouTube Shorts channel into a complete standalone AI production skill using yt-dlp catalog/WPM telemetry, resumable checkpointed Gemini AI Studio extraction (learn-channel-video.md), deterministic statistical aggregation (Top 20% Winners vs Bottom 20% Flops), and structured skill synthesis. Use when asked to learn a channel's full style or formula, mine hooks and storytelling patterns across many videos, grow an existing channel corpus incrementally, or build a channel-specific production skill (such as zack-d-films).
---

# channel-dna

Channel-agnostic reverse-engineering factory for YouTube Shorts production systems: collects full-channel catalogs and spoken WPM via yt-dlp and youtube-transcript-api (0 AI tokens), mines deep visual/narrative DNA through resumable checkpointed Gemini AI Studio runs, aggregates exact percentages and Winner-vs-Flop lift deterministically in code (0% hallucinated math), and synthesizes a standalone production skill at `.claude/skills/<channel-slug>/`.

## 4-Stage Pipeline

Shorthand: `DNA = bun .claude/skills/channel-dna/scripts/cli.ts`.

| Stage | Command | Output |
| --- | --- | --- |
| 1. Collect catalog & WPM (0 AI tokens) | `DNA collect --channel <slug> --url https://www.youtube.com/@<handle>/shorts --max-videos 300 --enrich 120 --transcripts 120` | Writes `catalog.json` (age-normalized centered rolling-median outlier scores + real spoken WPM) and balanced `queue.json` (40% Winner / 30% Median / 30% Flop) |
| 2. Mine deep DNA with checkpoints | `DNA mine --channel <slug> --limit 20 --tabs 2 --model gemini-4-hydrogen` | Downloads temp clip, burns 720p timecode bar, runs `aistudio/scripts/ask.ts` with `system/learn-channel-video.md`, validates strict JSON schema (1 auto-retry), saves `videos/<id>/{dossier.md,telemetry.json,meta.json}`, cleans temp video, updates `checkpoint.json` |
| 3. Aggregate deterministically (0% LLM math) | `DNA aggregate --channel <slug>` | Writes `stats.json` and `stats-summary.md` with exact Hook, Story, Topic, Ending, Boundary, Transition, Shot Scale, Camera Angle, and Craft Signal percentages, Hook x Topic and Story x Topic matrices, and Top 20% Winner vs Bottom 20% Flop Lift |
| 4. Synthesize or upgrade channel skill | Apply `system/synthesize-channel-skill.md` to `stats.json` + representative dossiers | Generates or updates standalone production skill at `.claude/skills/<slug>/` (`SKILL.md` + modular department `references/` + worked production blueprint) |

## Incremental Growth & Utility Commands

| Task | Command |
| --- | --- |
| Full CLI syntax & optional flags (`--corpus`, `--lang`, `--thinking`, `--media`, `--fps`, `--system-file`, `--prompt-version`) | `DNA --help` |
| Check current corpus progress | `DNA status --channel <slug>` |
| Mine next 20 videos across days (skips completed IDs) | `DNA mine --channel <slug> --limit 20 --tabs 2 --model gemini-4-hydrogen` |
| Retry previously failed video IDs | `DNA mine --channel <slug> --limit 10 --retry-failed` |
| Mine specific video IDs (mines all listed IDs when `--limit` is omitted) | `DNA mine --channel <slug> --ids id1,id2` |
| Validate one dossier against strict schema | `DNA validate <path/to/dossier.md>` |
| Run unit & Taxonomy parity tests | `bun test ./.claude/skills/channel-dna/scripts/channel-dna.test.ts` |

## Non-Negotiable Engineering Laws

| Law | Why |
| --- | --- |
| Normalize performance with centered rolling median (up to 20 mature same-format neighbors within ±15 excluding self; videos <30 days old quarantined as `provisional`) | Eliminates channel-growth era bias, video-age bias, and single-breakout mean distortion |
| Never blend denominators across `catalog` (`N=300`), `transcripts/WPM` (`N=85+`), and `deepDna` (`N=20+`) | Every published rule states its exact sample size so future AI judges statistical confidence honestly |
| Never ask an LLM to eyeball percentages across dozens of prose dossiers | All percentages, medians, cross-tabs, and Winner/Flop lifts come strictly from `scripts/aggregate.ts` |
| Keep `Reusable Film & Motion Craft Taxonomy` byte-identical with `aistudio` prompts | Guarantees unified vocabulary across Copy (`analyze-ref-video`), Compare (`compare-2-video`), and Learn (`learn-channel-video`) |

## Reference Index (1 Level Deep From SKILL.md)

| Path | Purpose |
| --- | --- |
| [system/learn-channel-video.md](system/learn-channel-video.md) | Single-pass extraction prompt for Hook, Storytelling, Directorial Intent, Macro Shot Spine, and Telemetry JSON |
| [system/synthesize-channel-skill.md](system/synthesize-channel-skill.md) | Synthesis prompt turning `stats.json` and representative dossiers into a standalone channel production skill |
| [references/architecture.md](references/architecture.md) | Factory architecture, corpus file contracts, and atomic zero-data-loss checkpointing |
| [references/prompt-learn-design.md](references/prompt-learn-design.md) | Prompt engineering design, 30fps GT pilot evaluation, OOD verification, and version history |
| [references/eval-guide.md](references/eval-guide.md) | 6-axis 30-point rubric, 3-reviewer gate protocol, and incremental scaling guide (`N=20 -> 40 -> 100+`) |
