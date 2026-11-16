import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { packSound } from "./sound_zip.mjs";
import { EXTERNAL, LOCAL } from "./vault.mjs";

const HELP = `Packs every sound of the vault into one zip, each file at its vault path: sound/ (sfx by category, bgm by mood,
SOURCES.json, PEAKS.json), sfx/ (the Mixkit, BGM and Freesound downloads) and mc-sound/ (the Minecraft sounds). From the
repo root:
  bun run pack:sound                 into the external vault, named mc-films-sound-<date>.zip
  bun run pack:sound D:/sound.zip    there
A new machine restores it with bun run setup --sound-zip <zip>. Keep it private: the Sonniss licence forbids passing its
sounds on, and Mojang's sounds are not ours to share.`;
const [out] = cliArgs(HELP, [], 1);
const where = existsSync(EXTERNAL) ? EXTERNAL : LOCAL;
await packSound({
  local: LOCAL,
  out: resolve(out ?? join(where, `mc-films-sound-${new Date().toISOString().slice(0, 10)}.zip`)),
});
