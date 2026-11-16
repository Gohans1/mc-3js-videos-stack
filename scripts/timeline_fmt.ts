// Formats src/timeline/*.json with the studio's 140-column compact JSON layout (Bun counterpart to timeline_fmt.py):
//   bun ../../scripts/timeline_fmt.ts           rewrites every src/timeline/*.json in the current film folder
//   import { dump, load, save } from ".../scripts/timeline_fmt.ts"
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cliArgs, jsonFile } from "../packages/live-studio/src/cli.mjs";
import { compactJson as dump } from "../packages/live-studio/src/timeline_file.mjs";

export { dump };

export const load = (name: string, dir = join(process.cwd(), "src/timeline")) =>
  jsonFile(join(dir, `${name}.json`));

export const save = (name: string, data: unknown, dir = join(process.cwd(), "src/timeline")) => {
  writeFileSync(join(dir, `${name}.json`), `${dump(data)}\n`, "utf8");
};

if (import.meta.main) {
  cliArgs(
    `Formats every src/timeline/*.json in the current film with the studio's compact layout.
  bun ../../scripts/timeline_fmt.ts
Formatting is optional; it imposes no schema or creative limits. All JSON is parsed before any file is changed.
next: bun run check`,
    [],
    0,
  );
  const dir = join(process.cwd(), "src/timeline");
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const data = files.map((name) => load(name.slice(0, -5), dir));
    for (const [i, name] of files.entries()) {
      const stem = name.slice(0, -5);
      save(stem, data[i], dir);
      const lines = readFileSync(join(dir, name), "utf8").split("\n").length - 1;
      console.log(name, lines, "lines");
    }
    console.log("next: bun run check");
  } catch (e) {
    console.error(
      `${e instanceof Error ? e.message : String(e)}: fix the named JSON file, or cd films/<name> first`,
    );
    process.exit(2);
  }
}
