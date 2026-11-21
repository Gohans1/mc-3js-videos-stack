---
name: mc-films
description: CLI for making Minecraft films in Three.js and analyzing reference videos/media in the mc-films monorepo (bun run at the repo root and in films/<name>). Use when making, editing, reviewing, rendering or delivering a film; finding or placing 3D blocks, items, mobs or custom props, picking mod/resource-pack assets, placing shots, camera moves, transitions, narration, sound effects or music; studying, breaking down or remaking reference videos (frames, captions, cuts, whip pans, audio stems, beats, sound localization, OCR, point/object tracking, matchmoving a shot's camera, FFmpeg finishing/QC); answering the creator's notes; finding what plays at a second; measuring a buried voice, a popping frame or YouTube banding; or adding a command to the repo's CLI. Triggers include "make a film", "find block/item/mob/prop", "fix this shot", "render a draft", "mix the sound", "generate the voice", "answer the notes", "what is at 35s", "is it ready for YouTube", "analyze a video", "separate stems", "detect cuts or beats", "read text or track objects in video", "match the reference's camera", "add a CLI command". Read it before running any of this repo's commands.
allowed-tools: Bash(bun run:*)
---

# mc-films

Minecraft films built in Three.js and driven entirely by `bun run`: the repo's commands at the root, a film's commands in `films/<name>`.

## Start here

This file is a discovery stub, not the usage guide. Before running any `bun run` command, load the actual workflow content from the CLI:

```bash
bun run skills get core             # start here: the loop, the three clocks, costly commands, troubleshooting
```

The core guide routes to focused references near the top (`bun run skills get core --ref sound`). Use `bun run skills get core --full` only when you need every reference at once; it is several times larger.

The CLI serves guides that match the code checked out next to them. This stub cannot follow the code, which is why it only points at `skills get core`.

## Also

```bash
bun run skills                      # every guide, one line each
bun run help                        # commands grouped by job; --json for all catalog IDs
```

The creator's taste and filmmaking rules (voices, sound sources, how to review) live in the `gohans-3js-videos-skills` skill (`.claude/skills/gohans-3js-videos-skills/SKILL.md`).
