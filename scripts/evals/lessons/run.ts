// Lesson routing eval for `bun run notes ID`: each case's note goes through lessonsFor (Jev) against the sample lessons in
// lessons/ (made up for this eval, not the creator's; written as the notes CLI asks, since Jev reads only the frontmatter and
// headings: a when: line, one rule per heading), and is right when every needed file is named and every other one named is
// allowed. Cases: cases/<set>.tsv, tab separated: id  lang  need  ok  note (need, ok: file names, comma
// separated, - for none; a note no lesson is about needs -). Each finished run adds a line to runs/history.jsonl.
// Measured 2026-11-14: Jev on whole files (path, frontmatter, headings) 34/40 dev, 23/25 holdout-a; on single headings
// 33-35/40, 20-21/25 (runs swing about 2); a local embedding (bekko-a8m) 16/25, rerankers lower.
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { lessonsFor } from "../../../packages/live-studio/src/lessons.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: bun run eval:lessons [--set dev|holdout-a] [--note "<what changed>"]
Scores Jev's lesson picks on scripts/evals/lessons/cases/<set>.tsv (default: every set); history in runs/history.jsonl.`);
  process.exit(0);
}
const flag = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const sets = flag("--set") ? [flag("--set")!] : ["dev", "holdout-a"];
const list = (s: string) => (s === "-" ? [] : s.split(","));
const name = (p: string) => p.replace(/^lessons\//, "").replace(/\.md$/, "");

for (const set of sets) {
  const cases = readFileSync(join(HERE, "cases", `${set}.tsv`), "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split("\t"))
    .map(([id, , need, ok, text]) => ({ id, need: list(need), ok: list(ok), text }));
  const got = await lessonsFor(cases, { dir: join(HERE, "lessons") });
  let right = 0,
    sure = 0;
  for (const c of cases) {
    const r = got.get(c.id);
    if (r?.why) {
      console.log(`  x ${c.id} Jev did not run: ${r.why}`);
      continue;
    }
    // every pick, as an AI reads them, and only Jev's sure ones (a "(maybe)" pick taken as no)
    const files = (picks: { path: string }[]) => [...new Set(picks.map((p) => name(p.path)))];
    const fits = (named: string[]) =>
      c.need.every((n) => named.includes(n)) &&
      named.every((n) => c.need.includes(n) || c.ok.includes(n));
    const all = r?.picks ?? [],
      named = files(all);
    if (fits(files(all.filter((p) => p.sure)))) sure++;
    if (fits(named)) right++;
    else
      console.log(
        `  x ${c.id} needs [${c.need}] got [${all.map((p) => `${name(p.path)}${p.sure ? "" : "?"}`)}]: ${c.text}`,
      );
  }
  console.log(`${set}: ${right}/${cases.length} right (counting only sure picks: ${sure})`);
  mkdirSync(join(HERE, "runs"), { recursive: true });
  appendFileSync(
    join(HERE, "runs/history.jsonl"),
    JSON.stringify({
      set,
      right,
      sure,
      all: cases.length,
      commit: execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(),
      at: new Date().toISOString(),
      note: flag("--note"),
    }) + "\n",
  );
}
