// bun run gap: what an agent needed and no command gave, with what it did instead. The commands only know what their
// authors thought of; a gap kept here is how the next one gets built (the creator, or an AI, reads bun run gap)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GAPS = fileURLToPath(new URL("./gaps.jsonl", import.meta.url));

const HELP = `Keep a missing capability (a view, a measure, a filter, a fact) and what you tried. Built-ins do not limit the film:
use custom code or tools as needed. If blocked, --did "stopped: <why>" records that too; do not invent a successful workaround.
  bun run gap "<what you needed, in words>" --did "<what you did instead>" [--cmd <the command that lacked it>]
  bun run gap      historical reports, grouped by command and count, newest first in each group
e.g. bun run gap "zoom into one region of a still" --did "cropped renders/still_12s.jpg with ffmpeg" --cmd render
Runs at the root or in a film. Appends to scripts/gaps.jsonl in this checkout (tracked by git; commit/sync separately).
In a film folder its name is kept too. Reports may already be resolved: verify current code before adding a command.`;

type Gap = { at: string; need: string; did: string; cmd?: string; film?: string };

export class GapError extends Error {}

const read = (file: string): { gaps: Gap[]; separator: string } => {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const gaps = text.split("\n").flatMap((line, i) => {
    if (!line.trim()) return [];
    let row: Gap;
    try {
      row = JSON.parse(line);
      if (
        !row ||
        ![row.at, row.need, row.did].every((v) => typeof v === "string" && v.trim()) ||
        ![row.cmd, row.film].every((v) => v === undefined || typeof v === "string")
      )
        throw new Error("expected at, need, did strings and optional cmd, film strings");
    } catch {
      throw new GapError(
        `${file}, line ${i + 1}: invalid gap record; fix that JSONL row before retrying (nothing appended)`,
      );
    }
    return [row];
  });
  return { gaps, separator: text && !text.endsWith("\n") ? "\n" : "" };
};

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
    "Historical reports, not verified open issues; counts are reports per command, not repeated needs. Check current help/code first.",
    "next: bun run help   reuse or extend existing tools when useful; custom code is always an option",
  ].join("\n");
};

export function gap(argv: string[], file = GAPS, film?: string): string {
  const words: string[] = [],
    set: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--did" || a === "--cmd") {
      const v = argv[++i];
      if (!v?.trim() || v.startsWith("--"))
        throw new GapError(`${a} needs a value (bun run gap --help)`);
      if (Object.hasOwn(set, a))
        throw new GapError(`${a} was given twice; give it once (bun run gap --help)`);
      set[a] = v.trim();
    } else if (a.startsWith("-"))
      throw new GapError(`unknown option ${a}: gap takes --did and --cmd (bun run gap --help)`);
    else words.push(a);
  }
  if (!words.length && !Object.keys(set).length) return report(read(file).gaps);
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
  const { gaps, separator } = read(file);
  appendFileSync(file, `${separator}${JSON.stringify(row)}\n`);
  const all = [...gaps, row],
    same = row.cmd ? all.filter((g) => g.cmd === row.cmd).length : 0;
  return `noted: ${all.length} gap${all.length > 1 ? "s" : ""} so far${row.cmd ? `, ${same} about ${row.cmd}` : ""} (scripts/gaps.jsonl).\nnext: bun run gap   historical reports; verify current capabilities before adding tools`;
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
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(err instanceof GapError ? 2 : 1);
  }
}
