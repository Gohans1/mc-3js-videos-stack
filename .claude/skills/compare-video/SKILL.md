---
name: compare-video
description: Compares a reference video (REF) against a remake render (OURS) using timecoded JPEG batches at 15 FPS for scene and full-film QA. Surfaces visual craft defects and verifies findings against original frames. Use when asked to compare two videos, review a remake scene against its reference, or iterate compare-and-fix until pass ("so sánh 2 video", "so sánh video ref", "compare video đến khi pass").
---

# compare-video

Use timecoded image batches for every AI-assisted visual comparison, from scene dailies through the final whole-film review. Use local audio checks and native-frame evidence to make fix and pass decisions.

## Review Gate & Iterative QA Loop

Run external AI review when delegated. Review each scene as soon as its render is ready.

In `mc-films`, `bun run reference compare <ref> <draft>` adds local `Look per shot` estimates after `bun run media setup camera`. Use them to locate frames for verification. Use `bun run render stills --check pops:<from>,<to>` to inspect scene movement. `bun run render final` checks the whole scene for pops and foot slides before encoding.

| Step | Action | Evidence |
| --- | --- | --- |
| 1. Render | Use physical motion blur when whips or fast moves matter. In `mc-films`, use `--samples 8` or `--samples 16`. | Versioned scene or film render |
| 2. Package | Run `bun run reference frames <ref> <render>` from the film directory. Use `--start` for a standalone scene or `--range` for a shared film-time window. Span and chunk exports auto-align. | Synced REF/OURS JPEGs with burned film clock, sampled at 15 fps and capped at 450 per list |
| 3. Review | Follow the [AI Studio recipe](references/stills-field-audit.md#recipe). Upload one list per fresh chat through `--batch --files-from` with `gemini-4-hydrogen`, `--thinking High`, `--media High`, and `--tool search=off`. State the layout and use [one scope per prompt](references/stills-field-audit.md#prompt-template) for detailed audits. Use the overview prompt for a quick scan. | Timestamped visual findings with evidence from both panels |
| 4. Check coverage | Save each report beside its list. Recover partial answers from the same chat or retry smaller windows using the same model. For a whole-film review, process all lists and merge verified findings by film time. Mark missing or failed windows and requested fields pending. | Coverage of all requested windows and fields |
| 5. Verify & triage | Check reported defects on the reviewed source frames with `sheet` or engine stills. Use a short `--fps native` export for a cut or pop. Apply creator notes and intentional style choices, then classify each finding as a verified defect, intentional adaptation, intentional override, or false positive. | Prioritized ledger of verified defects |
| 6. Fix & recheck | Re-render and review affected spans, then review the whole film in image batches for final QA. Listen to both soundtracks locally and verify sync against the picture. Use `earshot` and FFmpeg `ebur128`, `silencedetect`, dual-mono and `aphasemeter` checks where relevant. | Verified pass or escalated stall report |

Use the image evidence for visual claims. Record audio findings from the local listening and measurement pass.

## Stopping Rules

| Rule | Condition | Action |
| --- | --- | --- |
| Verified PASS | All requested windows covered, 0 verified Blockers and fewer than 2 verified Majors | Pass and stop |
| Progress | Verified defects remain and counts are dropping | Fix and review the affected spans |
| Stall | Two consecutive rounds fail to reduce the verified Blocker count, or a verified defect survives two fix attempts | Report the frame evidence and suspected cause |

## Scope & References

Use paired REF/OURS comparison for a remake with a matching reference. For original work, use the production skill's visual review against its own storyboard and craft targets.

| Path | Purpose |
| --- | --- |
| [references/stills-field-audit.md](references/stills-field-audit.md) | Current packaging, upload, recovery, and visual prompts |
| [references/prompt-design.md](references/prompt-design.md) | Historical experiments and measured still-frame results |
| [references/eval-baseline.json](references/eval-baseline.json) | Historical model and transport baselines |
