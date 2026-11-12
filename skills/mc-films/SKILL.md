---
name: mc-films
description: CLI for making Minecraft films in Three.js in the mc-films monorepo (bun run at the repo root and in films/<name>). Use when making, editing, reviewing, rendering or delivering a film; placing shots, camera moves, transitions, narration, sound effects or music; answering the creator's notes; finding what plays at a second; measuring a buried voice, a popping frame or YouTube banding; or adding a command to the repo's CLI. Triggers include "make a film", "fix this shot", "render a draft", "mix the sound", "generate the voice", "answer the notes", "what is at 35s", "is it ready for YouTube", "add a CLI command". Read it before running any of this repo's commands.
allowed-tools: Bash(bun run:*)
---

# mc-films

Minecraft films built in Three.js and driven entirely by `bun run`: the repo's commands at the root, a film's commands in `films/<name>`.

## Start here

This file is a discovery stub, not the usage guide. Before running any `bun run` command, load the actual workflow content from the CLI:

```bash
bun run skills get core             # start here: the loop, the three clocks, costly commands, troubleshooting
```

The core guide ends with a table of references to load for each area (`bun run skills get core --ref sound`). Use `bun run skills get core --full` only when you need every reference at once; it is several times larger.

The CLI serves guides that match the code checked out next to them. This stub cannot follow the code, which is why it only points at `skills get core`.

## Also

```bash
bun run skills                      # every guide, one line each
bun run help                        # every command where you stand; each takes --help
```

The creator's taste and filmmaking rules (voices, sound sources, how to review) live in the `gohans-3js-videos-skills` skill (`.claude/skills/gohans-3js-videos-skills/SKILL.md`).
