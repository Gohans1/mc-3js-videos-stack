import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { download } from "./download.mjs";
import { slimJar } from "./mc/slim_jar.mjs";
import { EXTERNAL, LOCAL, ROOT } from "./vault.mjs";

const HELP = `Fills the local vault (vault/, vault.json "root") on a new machine, from the repo root: the player rig check, mobs,
the Mixkit sound effects (fetch:sfx), the sound vault (setup:sound) and, when the heavy external vault exists
(vault.json "externalRoot", default E:/mc_vault, or MC_VAULT_EXTERNAL), the Minecraft sounds (setup:mc-sound).
  bun run setup:vault
Downloads have time limits and every file is verified (hashes, WAV format); a rerun reuses what is already there.
Next: bun run link to connect the vault to every film.`;
cliArgs(HELP, [], 0);

const assets = JSON.parse(readFileSync(join(ROOT, "scripts/vault-assets.json"), "utf8"));
const hash = (path, algorithm) => createHash(algorithm).update(readFileSync(path)).digest("hex");
const sourceRig = join(ROOT, assets.player.file);
if (!existsSync(sourceRig) || hash(sourceRig, "sha256") !== assets.player.sha256)
  throw new Error(
    `Missing or changed vendored rig: ${sourceRig}. Restore this file from the repository.`,
  );
const run = (command, args, timeout) => {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    timeout,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}): ${args.join(" ")}`);
};
console.log(
  `Light assets: ${LOCAL}. Downloads have time limits; verified files are reused on the next run.`,
);
await download(
  assets.minecraft.url,
  join(LOCAL, "jar/client.jar"),
  (path) => hash(path, "sha1") === assets.minecraft.sha1,
);
slimJar({ mcDir: join(LOCAL, "jar") });
const rig = join(LOCAL, "mcprep/player.glb");
mkdirSync(dirname(rig), { recursive: true });
if (existsSync(rig) && hash(rig, "sha256") !== assets.player.sha256)
  throw new Error(`Custom rig at ${rig}; preserve it separately before installing the pinned rig.`);
if (!existsSync(rig)) copyFileSync(sourceRig, rig);
copyFileSync(
  join(dirname(sourceRig), "CREDITS_CC_BY.txt"),
  join(LOCAL, "mcprep/CREDITS_CC_BY.txt"),
);
run("bun", [join(ROOT, "packages/mc-assets/mobs.ts"), assets.mobs], 600_000);
run("bun", [join(ROOT, "scripts/fetch_mixkit.mjs")], 600_000);
run("bun", [join(ROOT, "scripts/build_sound_vault.mjs")], 600_000);
if (existsSync(EXTERNAL)) run("bun", [join(ROOT, "scripts/build_mc_sound_vault.mjs")], 900_000);
console.log(
  `Light assets verified: Minecraft ${assets.minecraft.version}, mobs ${assets.mobs}, player rig and curated sound vault.`,
);
console.log(
  existsSync(EXTERNAL)
    ? "External Minecraft sound vault verified. Run bun run link to verify and connect all heavy assets."
    : "Heavy motion, mod packs, tools and mc-sound stay in the external vault (run bun run setup:mc-sound once mounted, then bun run link).",
);
