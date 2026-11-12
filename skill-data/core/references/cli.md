# Writing a repo command

Every command babysits an AI that cannot see or hear the film. It must never leave that AI guessing.

## The contract every command keeps

| Rule                                     | How                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Arguments are checked before any work    | First line: `cliArgs(HELP, ["--json", "--shot N"], words)` from `packages/live-studio/src/cli.mjs`. `-h`, `--help` or `help` prints `HELP` and exits 0; an unknown flag, a flag missing its value or a word too many exits 2. A typo must never run the default job (a bare `voice:gen --help` once spent credits) |
| Numbers are checked                      | `numberArg(name, text, { min, max, int })` for arguments and environment variables; a wrong one exits 2 saying what it takes                                                                                                                                                                                       |
| A film's JSON is read through `jsonFile` | A broken file is named with the fix, not left to a bare parse error                                                                                                                                                                                                                                                |
| Every error says the fix                 | Name what was wrong, what it takes, and the command that helps (`did you mean bun run at 35.6?`)                                                                                                                                                                                                                   |
| Output is what the next step needs       | The finding, its heard second, the file and row that hold it; no dumps. Long lists end with where the rest is (`renders/listen.json`)                                                                                                                                                                              |
| The last line is `next:`                 | The command to run next, with real values filled in                                                                                                                                                                                                                                                                |
| Absent data names its maker              | No video: `bun run render clip`; no cuts: which command writes `renders/cuts.json`                                                                                                                                                                                                                                 |
| Costly work says so                      | Credits, minutes, downloads: in `--help`. Money is spent only with `--yes`; without it the command previews and its `next:` line carries `--yes` (Vercel's CLI guidelines). `--dry-run` previews even with `--yes`                                                                                                 |
| Exit codes mean one thing                | 0 ok, 1 something in the film to fix, 2 a wrong word and nothing done                                                                                                                                                                                                                                              |
| Flags are kebab-case                     | `--dry-run`, never `--dryRun`                                                                                                                                                                                                                                                                                      |

Python commands (`scripts/sound`, `scripts/review`) keep the same contract by hand: help first, unknown words exit 2 before work.

## Adding or changing a command

Update every place an agent looks, in the same commit:

1. The command's `HELP`: what it does, each option, an example, what to run next. It is the one full list of a command's flags; a guide shows a flag in an example, never the whole list again.
2. `package.json` `scripts`: the repo root's, or `templates/film/package.json` and every film's. A command of the other place gets a `wrong-place.mjs` stub, so running it in the wrong folder says where it runs.
3. `packages/live-studio/help.mjs` `GROUPS`: one line under its job.
4. These guides: `skill-data/core/references/*.md`, plus `skill-data/core/SKILL.md` when the core loop changes. Keep `SKILL.md` to the loop, clocks, costs, troubleshooting and its routing table; put details in a reference and add a routing row for a new one. Never put feature content in `.claude/skills/mc-films/SKILL.md`: it is a stub that only points at `bun run skills get core`.

`packages/live-studio/test/skills.test.mjs` fails when a guide names a `bun run` command no `package.json` has, or when a reference has no routing row.

## Check it

```bash
bun run fmt                                  # or: bun fmt --no-script <files>
bun run lint                                 # oxlint; warnings fail too
bun run check                                # at the root: typecheck
bun run test                                 # every package's tests
```

Then probe it blind: fresh agents that know only the command's name use it on a copy of a film (`references/film.md`) with real and hard cases, and report every place it left them guessing. Fix and probe again until nothing Critical or Required is left.
