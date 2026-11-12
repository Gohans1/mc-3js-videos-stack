// Formats src/timeline/*.json with the studio's 140-column compact JSON layout (Bun counterpart to timeline_fmt.py):
//   bun ../../scripts/timeline_fmt.ts           rewrites every src/timeline/*.json in the current film folder
//   import { dump, load, save } from ".../scripts/timeline_fmt.ts"
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compactJson as dump } from "../packages/live-studio/src/timeline_file.mjs";

export { dump };

export const load = (name: string, dir = join(process.cwd(), "src/timeline")) =>
  JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));

export const save = (name: string, data: unknown, dir = join(process.cwd(), "src/timeline")) => {
  writeFileSync(join(dir, `${name}.json`), `${dump(data)}\n`, "utf8");
};

if (import.meta.main) {
  const dir = join(process.cwd(), "src/timeline");
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const stem = name.slice(0, -5);
    save(stem, load(stem, dir), dir);
    const lines = readFileSync(join(dir, name), "utf8").split("\n").length - 1;
    console.log(name, lines, "lines");
  }
}
