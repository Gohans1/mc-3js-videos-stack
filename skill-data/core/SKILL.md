---
name: core
description: Discover mc-films commands, build and verify films, understand the three clocks and costs, and load focused workflow references. Read before using the repo CLI.
---

# mc-films

The CLI and live studio are starting tools for creating, previewing and receiving feedback. Write custom Three.js code, tools or checks whenever useful; keep `draw(t)` able to reproduce any time independently.

## The core loop

Run repo commands at the root and film commands in `films/<name>`:

```bash
bun run studio --detach             # 1. live preview + timeline + notes (--status / --stop)
bun run find <words>                # 2. discover sounds, mocap, 2D presets & 3D assets (--kind object)
bun run check                       # 3. validate timelines/assets after any JSON edit
AT=12,30 bun run render stills      # 4. render stills and inspect the printed images
bun run render clip                 # 5. draft video; then bun run mix renders/draft_video.mp4
bun run notes                       # 6. read creator notes; answer with bun run note done
```

`VAR=x bun run ...` uses POSIX/Bun Shell syntax. In PowerShell use `$env:AT='12,30'; bun run render stills; Remove-Item Env:AT`.

## Load more when you need it

Load one topic on demand with `bun run skills get core --ref <topic>` (repeat `--ref` for more, or `--full` for everything at once):

| Core reference                | When needed                                                    |
| ----------------------------- | -------------------------------------------------------------- |
| references/film.md            | New films, file maps, vault and isolated test films            |
| references/contract.md        | Scene hooks, effects, custom HTML, open schemas and extensions |
| references/review.md          | Picture/text/pacing checks, frame order and reference videos   |
| references/render.md          | Rendering, cache, output configuration and encode checks       |
| references/sound.md           | Sound selection, mixing, levels and earshot                    |
| references/voice.md           | Takes, generation, alignment, lip sync and assembly            |
| references/voice-providers.md | Provider setup, capabilities, and verification status          |
| references/notes.md           | Feedback, note states and lessons                              |
| references/cli.md             | CLI changes and keeping discovery, help and guides aligned     |

Separate repo skills and docs (open directly; `skills get` does not serve them):

- `bun run skills path earshot` or `bun run skills path real-sound` — open `SKILL.md` in the returned directory.
- `.claude/skills/gohans-3js-videos-skills/SKILL.md` — creator taste and filmmaking rules.
- `INSTALL.md` — machine setup, vault, tools and licenses; `docs/research/media-tools.md` — media tool research and verification notes.

## Find the right information

| Need                                                     | Read                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Commands grouped by job; a film also prints its file map | bun run help                                                                  |
| Where a command runs                                     | bun run help <command>                                                        |
| All catalog IDs, including direct maintenance tools      | bun run help --json; bun run help direct for a text list                      |
| One command's arguments, flags, effects and cost         | bun run help <id> --json; its executable's --help is authoritative            |
| Current syntax and runnable examples                     | bun run <command> --help; direct tools: bun run help <id>                     |
| Structured guide discovery or content                    | Add --json to skills list, get or path; success output is a single JSON value |

Maintained repo entry points print help before work with `-h`, `--help` or a leading `help`; package scripts and separate CLIs follow their own help conventions.

## Choose steps for the current task

Use the steps that serve the current scene or change. Measurements and presets support creative choices; they do not dictate pacing, pictures or sound.

| Task                            | Command or file                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find assets and presets         | bun run find <words> searches sounds, mocap and 2D presets (+ OpenFilm); add --kind object (or block, item, mob, prop) for 3D MC assets; --json, --offline supported                                                                                                      |
| Keep an edit direction          | Film → Versions, or bun run history --film films/<name> --help                                                                                                                                                                                                            |
| Discover, pick and place assets | bun run find --kind transition\|object; --show <id> inspects recipes/properties/clips; preview 3D picks/blocks/items beside a 1.875m Steve scale figure with bun run asset preview; place, pick/unpick or copy Global props with bun run asset --help; see --ref contract |
| Build a custom scene or effect  | src/scene.ts; bun run skills get core --ref contract                                                                                                                                                                                                                      |
| Edit data                       | Timeline files named by the film's package.json; run bun run check after editing                                                                                                                                                                                          |
| Inspect one heard second        | bun run at 35.6; AT=35.6 bun run render stills; open the printed image                                                                                                                                                                                                    |
| Inspect motion                  | SPAN=40,44 bun run render clip; open the video                                                                                                                                                                                                                            |
| Inspect multiple frames         | bun run sheet                                                                                                                                                                                                                                                             |
| Detect reference cuts/fades     | bun run scenes clip.mp4; optional CPU, JSON/CSV/images in source-file seconds                                                                                                                                                                                             |
| Read text in reference frames   | bun run media ocr clip.mp4 --at 5,10; text boxes, scores, frames and source timestamps                                                                                                                                                                                    |
| Local media tools               | bun run media --help / media list / media doctor — local audio stems/beats/locate/VAD/denoise, OCR/vision/tracking, OTIO, QC and FFmpeg; see --ref sound and --ref review                                                                                                 |
| Discover media and NLE tools    | Run bun run media ffmpeg list, then schema cut for the native parser. Pass native arguments after --. Use bun run media qc --contract to find optional checks.                                                                                                            |
| Choose a review check           | Run bun run skills get core --ref review to choose evidence for picture, sound, pacing, dialogue, or motion.                                                                                                                                                              |
| Inspect a render                | Run bun run framecheck --json to save visual findings and evidence. Use bun run sheet FILE frames TIMES to extract frames at specific timestamps.                                                                                                                         |
| Check arbitrary seeking         | CHECK=order bun run render stills; optional sampled comparison of two capture orders                                                                                                                                                                                      |
| Study a reference video         | bun run reference inspect <video-or-URL> for frames, captions and search; study/compare for timing; pair with scenes, media and earshot; see --ref review                                                                                                                 |
| Select, place and edit sound    | bun run skills get core --ref sound; find discovers, asset edits, earshot evaluates sound                                                                                                                                                                                 |
| Attach sound to the draft       | bun run mix renders/draft_video.mp4; creates renders/draft.mp4                                                                                                                                                                                                            |
| Measure audio levels            | bun run listen; level measurements cannot identify a sound or decide whether it fits                                                                                                                                                                                      |
| Hear and evaluate sound         | earshot is a separate CLI; see --ref sound                                                                                                                                                                                                                                |
| Receive feedback                | bun run studio --detach (background; --status / --stop); open the link and read bun run notes                                                                                                                                                                             |

## The three clocks

| Clock                                  | Used by                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Film seconds, after Speed and Freeze   | notes, at, AT, CHECK, pace, listen, voice:cues, and asset. Sheet and framecheck use file seconds for external footage. Read the result clock before passing a timestamp to at. |
| Scene seconds, before Speed and Freeze | cam.json, key files, audio.json, text.json, adjust.json                                                                                                                        |
| Narration seconds, before voice.warp   | t in shots.json and beats in edit.json                                                                                                                                         |

bun run at <heard-second> converts clocks and names the active files and rows. Time accepts 65, 1:05 or 01:05.250; shots count from 0.

## Answer feedback and deliver

| Task                             | Action                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read and locate a note           | bun run notes; bun run notes 3; bun run at '#3'                                                                                                                                      |
| Report a verified fix            | Capture proof first, then bun run note done 3 "what changed" --after <imgPath> [--cam ... --t ...] (or --no-after "<reason>" when non-visual); custom After framing allowed if moved |
| Ask about a note                 | bun run note ask 3 "your question"                                                                                                                                                   |
| Keep a requested lesson          | bun run skills get core --ref notes                                                                                                                                                  |
| Produce the final when requested | bun run render final; bun run mix renders/final_video.mp4; bun run deliver                                                                                                           |

Never edit notes/notes.jsonl by hand. The final is renders/final.mp4; passing technical checks does not replace viewing/listening or mean it was uploaded.

## Costs and side effects

| Operation                                          | Check                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| voice:gen --yes                                    | Spends credits; omit --yes to preview, regenerate only the takes being changed              |
| find <words>                                       | May send query text to OpenFilm; --offline avoids network and failures keep keyword matches |
| assets:semantic build --yes, find --semantic --yes | Sends media/query to Gemini or explicitly OpenRouter; plan and cached queries stay offline  |
| find --jev                                         | External requests use quota or money; start with offline words when appropriate             |
| render final, deliver --youtube                    | Can take time; read --help and bound the interval being inspected                           |
| Testing commands that write                        | Use an isolated test film; see --ref film                                                   |
| Failed commands                                    | Read the error and inspect completed output; a nonzero exit does not prove nothing changed  |

Exit 0 means the command completed; 1 usually indicates a job/data failure, and 2 a usage/precondition error. A next: line suggests a useful follow-up, not a mandatory step.

## Missing capability or failure

| Situation                                 | Continue with                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| CLI lacks a capability                    | Use suitable code/tools, then bun run gap "<need>" --did "<outcome>" --cmd <command>   |
| Still blocked                             | Record --did "stopped: <why>"; never invent a successful workaround                    |
| Reading bun run gap                       | Historical reports may already be resolved; check current code before adding a command |
| Need a schema or hook                     | bun run skills get core --ref contract; packages/live-studio/src/contract.ts           |
| STALE                                     | Inputs are newer than the video; rerender the video being inspected                    |
| Vault audio changed but listen uses cache | bun run listen --fresh                                                                 |
| Wrong directory                           | Move to the root or films/<name> as the error says                                     |
| earshot unavailable                       | earshot doctor; read INSTALL.md                                                        |

Gap reporting does not gate creativity or automatically justify another command. Logs belong to the current checkout; commit and synchronize them separately when sharing is needed.
