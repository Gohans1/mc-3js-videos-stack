---
name: analyze-ref-video
description: Breaks down a reference video into a frame-grounded shot and craft blueprint using timecoded still batches and local audio checks. Use when asked to analyze a reference video, break down a video shot by shot, or plan a remake ("phân tích video ref", "bóc tách video mẫu").
---

# analyze-ref-video

Use timecoded stills for the visual breakdown and inspect the source audio locally. Verify cut and contact timing on the original frames before building.

## Workflow

Run external AI review when delegated.

1. Map the reference locally with `bun run reference study references/ref.mp4` or `reference inspect`. Use the cut and beat estimates to choose useful windows.
2. Use the [single-source stills recipe](../compare-video/references/stills-field-audit.md#single-source-stills) to package each reference window at 15 fps, up to 450 JPEGs per list. Use one fresh chat per list with Hydrogen High / High media and Search off. Keep the raw window reports.
3. Ask for the visual report below. Merge windows by the burned film clock, deduplicate events, and mark unreviewed gaps pending. For overload or truncation, retry shorter windows on the same model. If the daily quota runs out, save the reports and image lists for resuming pending windows after the quota recovers.
4. Verify ambiguous events on source frames with `sheet` or native frame extraction. Listen to the original audio for cue timing, sound bridges, voice, and rhythm. Use `earshot`, FFmpeg `ebur128` and `silencedetect`, and `reference study` for corroboration. Combine the verified visual and audio evidence in the final breakdown.

## Visual Breakdown Prompt

> Analyze the attached timecoded frames as one reference window. Sort by the burned timecode and cite visible evidence for every claim. Give four sections: 1. Global Craft DNA, 2. Shot & Beat Spine, 3. Craft & Blind-Spot Delta Ledger, 4. Pre-Build Traps & Local Verification Watchlist. Describe observed framing, transitions, movement, optics, lighting, staging, and effects. Bracket changes between observed frames and flag uncertain boundaries for source-frame verification. Base findings on the images supplied.

## References

| Path | Purpose |
| --- | --- |
| [Historical prompt and experiment log](references/prompt-design.md) | Verified design lessons, taxonomy and historical input comparisons |
| [Historical baseline data](references/eval-baseline.json) | Previous model and transport scores. Visual breakdown quality on the still route needs its own evaluation |
