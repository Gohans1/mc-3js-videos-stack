# channel-dna Factory Architecture

Canonical engineering reference for the channel-dna source modules, corpus storage layout, strict JSON schema contracts, and atomic zero-data-loss checkpointing. Every command runs through scripts/cli.ts via bun from the repository root.

## Source Modules

| Path | Responsibility |
| --- | --- |
| scripts/types.ts | Single source of truth for all closed enums (Topic, Hook, Story, Connector, Ending, Beat, Shot Scale, Camera Angle, Camera Energy, Lens Feel, Lighting, Easing, Audio Bed, Craft Signals) and corpus TypeScript interfaces |
| scripts/schema.ts | Validates 4-section completeness, catches truncation, blocks engine/CLI leaks, cross-checks Section 3 boundary counts, per-key shot scales and camera angles, and Row 1 Opening end timestamp against Section 4 JSON, warns on transition_types drift, and enforces every closed enum and numeric range |
| scripts/collect.ts | Scrapes channel catalogs via yt-dlp, infers empirical 30-day maturity cutoffs from live-feed uploadDate anchors (immune to pinned old videos and off-feed carry-overs), probes maturity boundaries before bulk enrichment, refreshes views monotonically across 30-day re-collects, computes centered rolling-median outlier multipliers (up to 20 mature peers within ±15 excluding self), fetches mature-first transcripts and Unicode spoken WPM via youtube-transcript-api, and builds balanced 40/30/30 Winner/Median/Flop queues |
| scripts/mine.ts | Runs resumable parallel AI Studio extraction across up to 2 off-screen Chrome windows (cdna1, cdna2), burns atomic 720p timecode bars with clean AAC 128k 44.1kHz stereo audio re-encoding, validates output via schema.ts with 1 automatic retry, halts the full batch immediately on quota errors without marking blocked items failed, cleans stale raw-failed files on success, writes all per-video JSON and Markdown artifacts atomically, deletes temporary mp4 files in finally, and closes worker tabs cleanly |
| scripts/aggregate.ts | Computes 100% deterministic statistics (zero LLM math) while reconciling mined meta.json against current catalog.json: full-catalog WPM/duration/like-rate tables with explicit subsample denominators, exact distributions, Hook x Topic and Story x Topic cross-tabs, pooled boundary and shot-scale ratios, craft signal percentages, unrounded Top 20% Winner vs Bottom 20% Flop Lift, and atomic stats-summary.md output |
| scripts/cli.ts | Unified CLI exposing collect, mine, validate, aggregate, and status with strict flag parsing, exit code 2 on usage errors, and next: guidance |
| scripts/channel-dna.test.ts | Mutation-resistant TDD suite covering 3-way Taxonomy byte parity, schema error detection, rolling-median outlier math, transcript/WPM cleaning, stratified queuing, aggregation math, and CLI exit contracts |

## Per-Channel Corpus Storage Layout

Every channel stores its raw catalog, checkpoints, validated dossiers, and aggregated stats inside its own skill directory at .claude/skills/<channel-slug>/references/corpus/ so future AI sessions immediately see exact sample counts and resume state.

| File or Folder | Contents |
| --- | --- |
| catalog.json | Timestamped channel Shorts snapshot with views, likes, durationSec, uploadDate, wordCount, wpm, outlierRolling, outlierGlobal, and performance tier |
| queue.json | Unmined video IDs interleaved across Winner, Flop, and Median tiers so every --limit N batch stays balanced |
| checkpoint.json | Per-video done or failed status, AI Studio chatUrl, attempt count, and failure reason, written atomically after every video |
| videos/<id>/dossier.md | Complete 4-section Markdown analysis produced by Gemini that passed schema.ts validation |
| videos/<id>/telemetry.json | Parsed and validated structured telemetry JSON extracted from Section 4 of dossier.md |
| videos/<id>/meta.json | Combined performance metadata (views, outlier scores, tier, WPM) and run provenance (model, thinking, fps, promptVersion, chatUrl, elapsedSec) |
| stats.json | Full machine-readable deterministic statistics emitted by scripts/aggregate.ts |
| stats-summary.md | Concise human-and-AI statistical overview with explicit sample denominators per data layer |

## Multi-Day Checkpointing and Data Safety

| Failure Mode | Protection Mechanism |
| --- | --- |
| Interruption mid-collection | Writes catalog.json atomically (.tmp then rename) after every 10 enriched metadata items or 15 transcripts; re-running skips already-fetched records |
| AI Studio daily quota exhaustion mid-mining | Commits checkpoint.json after each completed video, halts all workers immediately on quota errors without marking the quota-blocked video failed, and closes worker Chrome tabs cleanly; resuming with mine --limit N continues seamlessly from that exact unmined ID |
| Truncated or malformed Gemini JSON | Saves raw failed output to videos/<id>/raw-failed-a1.md, retries once automatically, and only marks a video done when parseAndValidateDossier returns valid = true |
| Disk bloat from downloaded clips | Stores temporary downloads and 720p timecode renders inside per-video %TEMP%\cdna-<id>-* folders deleted unconditionally inside finally |
