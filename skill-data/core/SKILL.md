---
name: core
description: Core mc-films usage guide. Read this before running any of the repo's commands. Covers the loop from an idea to an upload, the film's three clocks, the commands that are an AI's eyes and ears, the commands that cost money or cannot be taken back, and troubleshooting. Use when making, reviewing, rendering, mixing or delivering a film, or answering the creator's notes.
---

# mc-films core

Every job goes through `bun run`. At the repo root: the repo's commands (new films, the vault, tests). Inside `films/<name>`: the film's commands (studio, render, sound, notes). A command run in the wrong place says where it runs.

## Where each answer lives

Three sources, one job each. None repeats another's job:

```bash
bun run help                     # which commands exist where you stand; in a film, also the map of its files
bun run render --help            # one command: every flag and variable, examples, its cost. The only place flags are listed
bun run skills get core          # how to work: the loop, the clocks, the rules (this guide)
bun run skills get core --ref sound   # one area in depth, by reference name
```

`-h`, `--help` and a bare `help` word are the same and never run the job. `--ref` belongs to `skills get` only.

## How the CLI talks

- Every error says how to fix it. Exit 2: nothing was done (a wrong word, flag or second, a missing file, a note whose state refuses it). Exit 1: the film has something to fix.
- Output ends with a `next:` line. Run that instead of guessing.
- A command lacks something you need (a closer look, a measure, a filter)? Neither stop nor guess: do it from the raw files (`renders/`, `src/timeline/*.json`, `vault/`), with a throwaway script outside the repo if need be, then keep it: `bun run gap "<what you needed>" --did "<what you did instead>" --cmd <command>`. Gaps kept twice become commands.
- Missing data is named with the command that makes it (no video yet: `bun run render clip`).
- `check`, `at` and `voice:cues` take `--json`.
- A second is a heard second, written `65`, `1:05` or `01:05.250` as notes print them: `at`, `AT=`, `CHECK=`, `sheet` and `listen --at` read all three.
- Options in `VAR=x bun run ...` form are environment variables. In PowerShell: `$env:AT='12'; bun run render stills; Remove-Item Env:AT`.

## The three clocks

The commonest mistake is the right row at the wrong second.

| Clock             | What it is                                                            | Who uses it                                                                                          |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Heard seconds     | What the audience hears, after Speed and Freeze in `timing.json`      | Notes, `at`, render `AT` and `CHECK`, `framecheck`, `jumps`, `pace`, `sheet`, `listen`, `voice:cues` |
| Scene seconds     | The film before Speed and Freeze                                      | Rows in `cam.json`, key files, `audio.json`, `text.json`, `adjust.json`                              |
| Narration seconds | The narration as recorded; `voice.warp` turns them into scene seconds | `t` in `shots.json`, beats in `src/edit.json`                                                        |

`bun run at <heard second>` converts between them and names every file and row at that second. Run it before changing anything at a given second.

## The core loop

Inside a film:

```bash
bun run find creaky door                     # 1. Find a sound, music, mocap clip, transition, anim, font or look
bun run find creaky door --fav               #    Only the creator's starred ones (favorites/<list>.json): when told "use my favourites"
                                             # 2. Edit src/scene.ts or src/timeline/*.json
bun run check                                # 3. After every JSON edit: schema, sound names, typos, text too brief or small
AT=12,30 bun run render stills               # 4. Look at a few frames (renders/still_<s>s.jpg)
bun run sheet                                #    six to a picture; open them
CHECK=text bun run render stills             #    every line of text: inside the safe area, readable over the picture
bun run render clip                          # 5. The draft video (renders/draft_video.mp4, renders/cuts.json)
bun run framecheck                           # 6. Black, flashes, jumps, shimmer, freezes on the encoded file
bun run pace                                 #    Shot lengths, and where the picture holds still under the narration
bun run mix renders/draft_video.mp4          # 7. The soundtrack on the draft (renders/draft.mp4)
bun run listen                               # 8. Voice buried, sounds over the voice, dead air
earshot timeline renders/draft.mp4 --cues renders/cuts.json --detail low   # 9. What each sound is, hits on the cuts
```

`listen` measures levels; `earshot` (a CLI of its own: `references/sound.md` says which call for what) hears what a sound is. Never say how something sounds, or that a sound fits, without one of them behind it. Never call something done before you have looked at the new frames and listened. The creator reviews in the studio (`bun run studio`, then open the link it prints) and leaves notes; [the notes loop](#common-tasks) answers them.

## Common tasks

### Fix what plays at one second

```bash
bun run at 35.6                              # shot, transition, camera keys, word, sounds, text, moving keys, notes
                                             # edit the row it names, then look again:
AT=35.6 bun run render stills
```

### Answer the creator's notes

```bash
bun run notes                                # the open notes, #1 first
bun run notes 3                              # one in full: where they tapped, words, pictures
bun run at '#3'                              # where that note is heard now
bun run note done 3 "what changed"           # only after you saw the fix; the creator approves or reopens
bun run note ask 3 "your question"           # when unsure what they want
```

### Re-render one stretch

```bash
CHUNKS=3 bun run render clip                 # only chunk 3 (1:30-2:00); every other chunk is kept
```

### Deliver

Only when the creator asks for the final:

```bash
bun run render final                         # 1440p, motion blur, YouTube's H.264; minutes per 30 s chunk
bun run mix renders/final_video.mp4          # renders/final.mp4, the file to upload
bun run deliver                              # each FIX line names its fix; exit 0 is ready
bun run deliver --youtube 9-15               # how those seconds look after YouTube's own re-encode
```

## Costly or one-way

| Command                        | Cost                                     | Do this                                                                               |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `bun run voice:gen --yes`      | Voice credits, by the character          | Run it bare first (a preview); regenerate only the takes to fix (`ID`, or `--try ID`) |
| `bun run find --jev`           | Under $0.01 a search                     | Words first; they are free and offline                                                |
| `bun run render final`         | Minutes per 30 s, loud GPU               | Only when the creator asks; `CHUNKS=` re-renders one stretch                          |
| `bun run deliver --youtube`    | About 3x the film's length               | Name the seconds: `--youtube 9-15`                                                    |
| `bun run note done`            | The creator reviews what you call fixed  | Only after you have seen the fix                                                      |
| `notes/notes.jsonl`            | The creator's notes                      | Never edit by hand; only through `bun run note`                                       |
| Trying commands on a real film | Can change the creator's notes and files | Try on a copy of the film (`references/film.md`), delete it after                     |

## Troubleshooting

| You see                                       | Do                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `STALE` from `framecheck`, `sheet` or `jumps` | The video predates `src/`: `bun run render clip` again                                                                    |
| `check` names a missing sound                 | It lists the nearest names; `bun run find <words>` searches the vault, `bun run sfx:get` fetches the film's pinned sounds |
| A command says it runs elsewhere              | It belongs to the repo root or to a film: `cd` where it says                                                              |
| A note's second moved after a Speed edit      | Notes keep the second they were written at; `bun run at '#N'` gives where it is heard now                                 |
| `listen` misses a vault sound you changed     | `bun run listen --fresh`                                                                                                  |
| `CHECK` has no such target                    | It suggests the nearest names and lists the targets; names match case                                                     |
| `earshot` not found, or it fails              | `earshot doctor` names what is missing; setting it up: `INSTALL.md`                                                       |

## Load more when you need it

Load one reference without the rest by passing its path, file name, or stem to `--ref`:

```bash
bun run skills get core --ref sound
bun run skills get core --ref references/review.md --ref notes
```

`bun run skills get core --full` prints every reference at once, several times the size of this guide.

| Load                     | When you need                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `references/film.md`     | A new film, which file holds what, the vault, trying a command on a copy of a film                       |
| `references/contract.md` | Writing `scene.ts`: what the studio needs from a film, the hooks on `draw`, the open schemas             |
| `references/review.md`   | The eyes: `at`, stills, sheets, `CHECK=motion/seen/touch/text`, `framecheck`, `jumps`, `pace`, `deliver` |
| `references/render.md`   | Rendering fast, re-rendering one stretch, the GPU, YouTube's spec, banding after its re-encode           |
| `references/sound.md`    | Placing sounds and music, gains, the mix, `listen` and its targets, earshot's calls                      |
| `references/voice.md`    | Narration: takes, generating, assembling, word seconds, reading pace                                     |
| `references/notes.md`    | The creator's notes: states, answering, remembering a rule                                               |
| `references/cli.md`      | Writing or changing a repo command, and keeping these guides in step with it                             |

A new machine, the vault and licences are in `INSTALL.md` at the repo root, a file to open rather than a `--ref`.
