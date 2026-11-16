import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { download } from "./download.mjs";
import { fetchSoundRaw } from "./fetch_sound_raw.mjs";
import { slimJar } from "./mc/slim_jar.mjs";
import { fetchSoundZip, restoreSound } from "./sound_zip.mjs";
import { toolCheck } from "./tools.mjs";
import { EXTERNAL, LOCAL, ROOT } from "./vault.mjs";

const HELP = `Fills the local vault (vault/, vault.json "root") on a new machine, from the repo root: the player rig check, mobs,
the Mixkit sound effects (fetch:sfx), the sound vault (setup:sound) and the Minecraft sounds (setup:mc-sound).
Raw sound downloads stay under externalRoot (default E:/mc_vault, or MC_VAULT_EXTERNAL); runtime files stay in vault/.
A torrent pack, hours long, is named at the end for its own run. It first names every
tool missing from PATH, and stops when one it needs is.
  bun run setup:vault
  bun run setup:vault --sound-zip <zip>   restores every sound from bun run pack:sound's zip first, instead of the raw packs
  bun run setup:vault --sound-zip <link>  the same zip from a link (a Google Drive share link works when it is shared
                                          with anyone who has the link; a private one says to download it by hand)
Downloads have time limits and every file is verified (hashes, WAV format); a rerun reuses what is already there.
Next: bun run link to connect the vault to every film (bun run setup does all three).`;
const args = cliArgs(HELP, ["--sound-zip FILE"], 0);
// the zip, or a link to it; a link is passed here on each machine and never written into the (public) repo
const soundZip = args.includes("--sound-zip") ? args[args.indexOf("--sound-zip") + 1] : null;
const soundLink = soundZip && /^https?:\/\//i.test(soundZip);
const waiting = [];
const tools = toolCheck();
waiting.push(...tools.later.map((t) => `install ${t}`));
if (tools.stop.length) {
  console.error(
    `Install these first, then run bun run setup:vault again:\n  ${tools.stop.join("\n  ")}`,
  );
  process.exit(1);
}
if (soundZip) {
  if (!soundLink && !existsSync(soundZip)) throw new Error(`No sound zip at ${resolve(soundZip)}`);
  const zip = soundLink ? await fetchSoundZip(soundZip, LOCAL) : resolve(soundZip);
  await restoreSound({ zip, local: LOCAL });
  // a downloaded zip has done its job: its sounds are in the vault now
  if (soundLink) rmSync(zip);
}

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
// The raw zip packs are downloaded before the sound vault is built, which files them into its categories; a torrent
// pack takes hours, so it is only named here, for its own run of fetch:sound-raw. A sound zip holds their sounds already
if (soundZip)
  console.log(
    "Raw sound packs skipped: the sound zip holds their sounds (bun run fetch:sound-raw only to cut them again)",
  );
else if (existsSync(EXTERNAL)) {
  const raw = await fetchSoundRaw({ torrents: false });
  if (raw.failed.length)
    throw new Error(
      `Raw sound packs failed: ${raw.failed.join(", ")}. Run bun run setup:vault again.`,
    );
  waiting.push(...raw.waiting);
}
// No time limit: a first build decodes every raw pack (long on a hard disk) and a stopped one resumes where it was
run("bun", [join(ROOT, "scripts/build_sound_vault.mjs")]);
// The sound zip holds mc-sound whole; building it again would download every Modrinth pack (~600 MB) for nothing
if (!soundZip) run("bun", [join(ROOT, "scripts/build_mc_sound_vault.mjs")], 900_000);
console.log(
  `Light assets verified: Minecraft ${assets.minecraft.version}, mobs ${assets.mobs}, player rig and curated sound vault.`,
);
console.log(
  "Runtime assets stay in the local vault; only raw downloads and backups use externalRoot. Run bun run link to prepare film copies.",
);
for (const w of waiting) console.log(`Waiting for you: ${w}`);
