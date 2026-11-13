// bun run gap: what an agent needed and no command gave, with what it did instead. The commands only know what their
// authors thought of; a gap kept here is how the next one gets built (the creator, or an AI, reads bun run gap)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { ROOT } from "./vault.mjs";

export const GAPS = join(ROOT, "scripts/gaps.jsonl");

const HELP = `A command lacked something you needed (a view, a measure, a filter, a fact)? Do the job another way first: from
the raw files (renders/, src/timeline/*.json, vault/), with a throwaway script outside the repo if need be. Then keep it:
  bun run gap "<what you needed, in words>" --did "<what you did instead>" [--cmd <the command that lacked it>]
  bun run gap      every gap kept, the commands asked of most first
e.g. bun run gap "zoom into one region of a still" --did "cropped renders/still_12s.jpg with ffmpeg" --cmd render
Kept in scripts/gaps.jsonl (in git, for every machine); run from a film folder, the film's name is kept too.`;

type Gap = { at: string; need: string; did: string; cmd?: string; film?: string };

export class GapError extends Error {}

const read = (file: string): Gap[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Gap)
    : [];

const report = (gaps: Gap[]) => {
  if (!gaps.length)
    return 'no gaps yet. When a command lacks something: bun run gap "<what you needed>" --did "<what you did instead>"';
  const by = new Map<string, Gap[]>();
  for (const g of gaps.toReversed())
    by.set(g.cmd ?? "(no command named)", [...(by.get(g.cmd ?? "(no command named)") ?? []), g]);
  return [
    `${gaps.length} gap${gaps.length > 1 ? "s" : ""}, by the command they were missing from:`,
    ...[...by]
      .toSorted((a, b) => b[1].length - a[1].length)
      .flatMap(([cmd, gs]) => [
        `${cmd} ${gs.length}:`,
        ...gs.map(
          (g) => `  ${g.need} (did: ${g.did}${g.film ? `; ${g.film}` : ""}; ${g.at.slice(0, 10)})`,
        ),
      ]),
    "next: a need kept twice is worth a command or a flag; build it where the command lives (bun run <cmd> --help names it)",
  ].join("\n");
};

export function gap(argv: string[], file = GAPS, film?: string): string {
  const words: string[] = [],
    set: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--did" || a === "--cmd") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new GapError(`${a} needs a value (bun run gap --help)`);
      set[a] = v;
    } else if (a.startsWith("-"))
      throw new GapError(`unknown option ${a}: gap takes --did and --cmd (bun run gap --help)`);
    else words.push(a);
  }
  if (!words.length && !Object.keys(set).length) return report(read(file));
  const need = words.join(" ").trim();
  if (!need)
    throw new GapError(
      'say what you needed, in words: bun run gap "<what you needed>" --did "<what you did instead>"',
    );
  if (!set["--did"])
    throw new GapError(
      `add --did "<what you did instead>" (or "stopped: <why>"): the next agent learns the way round, and the creator what to build`,
    );
  const row: Gap = {
    at: new Date().toISOString(),
    need,
    did: set["--did"],
    ...(set["--cmd"] && { cmd: set["--cmd"].replace(/^bun run /, "") }),
    ...(film && { film }),
  };
  appendFileSync(file, `${JSON.stringify(row)}\n`);
  const all = read(file),
    same = row.cmd ? all.filter((g) => g.cmd === row.cmd).length : 0;
  return `noted: ${all.length} gap${all.length > 1 ? "s" : ""} so far${row.cmd ? `, ${same} about ${row.cmd}` : ""} (scripts/gaps.jsonl). Carry on with what you did; every gap kept: bun run gap`;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.some((a) => a === "-h" || a === "--help") || argv[0] === "help") {
    console.log(HELP);
    process.exit(0);
  }
  const cwd = process.cwd();
  try {
    console.log(gap(argv, GAPS, existsSync(join(cwd, "src/scene.ts")) ? basename(cwd) : undefined));
  } catch (err) {
    if (!(err instanceof GapError)) throw err;
    console.error(err.message);
    process.exit(2);
  }
}
