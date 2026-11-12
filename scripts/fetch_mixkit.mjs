import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { download, validWav } from "./download.mjs";
import { LOCAL, ROOT } from "./vault.mjs";

const HELP = `Downloads the Mixkit sound effects listed in scripts/sfx-catalogue.json into the local vault's sfx/mixkit/ (8 at a time,
each checked as WAV; a file already there and valid is kept). From the repo root:
  bun run fetch:sfx
A sound that fails is named at the end: run it again to retry those. Then bun run setup:sound files them by category.`;
cliArgs(HELP, [], 0);

const catalog = JSON.parse(readFileSync(join(ROOT, "scripts/sfx-catalogue.json"), "utf8"));
const out = join(LOCAL, "sfx/mixkit");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "catalogue.json"), JSON.stringify(catalog, null, 2));
const queue = [...catalog.sounds];
const failures = [];
let downloaded = 0;
async function worker() {
  for (let sound; (sound = queue.shift());) {
    try {
      if (!/^[a-z0-9-]+$/.test(sound.id)) throw new Error(`Invalid sound id: ${sound.id}`);
      if (await download(sound.file_url, join(out, `${sound.id}.wav`), validWav)) downloaded++;
    } catch (error) {
      failures.push(sound.id);
      console.error(`${sound.id}: ${error.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
if (failures.length)
  throw new Error(
    `${failures.length} sounds unavailable: ${failures.join(", ")}. Run fetch:sfx again to retry.`,
  );
console.log(`${catalog.sounds.length} WAVs verified in ${out}; ${downloaded} downloaded.`);
