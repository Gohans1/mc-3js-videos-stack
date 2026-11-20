import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { download } from "./download.mjs";
import { fetchSoundRaw } from "./fetch_sound_raw.mjs";
import { slimJar } from "./mc/slim_jar.mjs";
import { driveDownloadUrl, fetchVaultZip, restoreVault } from "./sound_zip.mjs";
import { toolCheck } from "./tools.mjs";
import { EXTERNAL, LOCAL, ROOT } from "./vault.mjs";

const HELP = `Fills the local vault (vault/, vault.json "root") on a new machine, from the repo root: the player rig check, mobs,
the Mixkit sound effects (fetch:sfx), the sound vault (setup:sound) and the Minecraft sounds (setup:mc-sound).
Raw sound downloads stay under externalRoot (default E:/mc_vault, or MC_VAULT_EXTERNAL); runtime files stay in vault/.
A torrent pack, hours long, is named at the end for its own run. It first names every
tool missing from PATH, and stops when one it needs is.
  bun run setup:vault
  bun run setup:vault --vault-zip <core.zip> --vault-zip <heavy.zip>   restores private archives from bun run pack:vault first (repeatable)
  bun run setup:vault --sound-zip <zip-or-link>                        restores a legacy sound archive from bun run pack:sound
Google Drive share links ("anyone with the link") work; private links explain how to download in a browser first.
Downloads have time limits and every file is verified (hashes, WAV format); a rerun reuses what is already there.
Next: bun run link to connect the vault to every film (bun run setup does all three).`;

const hashFile = (path, algorithm) =>
  createHash(algorithm).update(readFileSync(path)).digest("hex");

function defaultRun(root) {
  return (script, argv, timeout) => {
    const result = spawnSync("bun", [join(root, script), ...argv], {
      cwd: root,
      stdio: "inherit",
      timeout,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`bun failed (${result.status}): ${script} ${argv.join(" ")}`.trim());
  };
}

async function defaultPrepareBase({ root, local, run, log }) {
  const assets = JSON.parse(readFileSync(join(root, "scripts/vault-assets.json"), "utf8"));
  const sourceRig = join(root, assets.player.file);
  if (!existsSync(sourceRig) || hashFile(sourceRig, "sha256") !== assets.player.sha256)
    throw new Error(
      `Missing or changed vendored rig: ${sourceRig}. Restore this file from the repository.`,
    );
  log(
    `Light assets: ${local}. Downloads have time limits; verified files are reused on the next run.`,
  );
  await download(
    assets.minecraft.url,
    join(local, "jar/client.jar"),
    (path) => hashFile(path, "sha1") === assets.minecraft.sha1,
  );
  slimJar({ mcDir: join(local, "jar") });
  const rig = join(local, "mcprep/player.glb");
  mkdirSync(dirname(rig), { recursive: true });
  if (existsSync(rig) && hashFile(rig, "sha256") !== assets.player.sha256)
    throw new Error(
      `Custom rig at ${rig}; preserve it separately before installing the pinned rig.`,
    );
  if (!existsSync(rig)) copyFileSync(sourceRig, rig);
  copyFileSync(
    join(dirname(sourceRig), "CREDITS_CC_BY.txt"),
    join(local, "mcprep/CREDITS_CC_BY.txt"),
  );
  run("packages/mc-assets/mobs.ts", [assets.mobs], 600_000);
  run("scripts/fetch_mixkit.mjs", [], 600_000);
  return assets;
}

export async function setupVault({
  argv = process.argv.slice(2),
  root = ROOT,
  local = LOCAL,
  external = EXTERNAL,
  toolsCheck = toolCheck,
  prepareBase,
  runScript,
  runFetchSoundRaw = () => fetchSoundRaw({ torrents: false }),
  fetchZip = fetchVaultZip,
  log = console.log,
} = {}) {
  const args = cliArgs(HELP, ["--vault-zip FILE", "--sound-zip FILE"], 0, argv);
  // Archive paths or URLs passed on each machine and never written into the (public) repo
  const zipArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--vault-zip" || args[i] === "--sound-zip") {
      zipArgs.push({ flag: args[i], value: args[i + 1] });
      i++;
    }
  }
  const waiting = [];
  const tools = toolsCheck();
  waiting.push(...tools.later.map((t) => `install ${t}`));
  if (tools.stop.length) {
    throw new Error(
      `Install these first, then run bun run setup:vault again:\n  ${tools.stop.join("\n  ")}`,
    );
  }

  for (const { value } of zipArgs) {
    if (/^https?:\/\//i.test(value)) continue;
    const resolved = resolve(value);
    const st = statSync(resolved, { throwIfNoEntry: false });
    if (!st) throw new Error(`No vault archive at ${resolved}`);
    if (!st.isFile()) throw new Error(`Vault archive path is not a file: ${resolved}`);
  }

  const restoredParts = new Set();
  for (const { flag, value } of zipArgs) {
    const isLink = /^https?:\/\//i.test(value);
    const urlHash = isLink
      ? createHash("sha256").update(driveDownloadUrl(value)).digest("hex").slice(0, 12)
      : null;
    const zip = isLink
      ? await fetchZip(value, local, {
          name: `mc-films-archive-${urlHash}.zip`,
          flag,
        })
      : resolve(value);
    try {
      const restored = await restoreVault({
        zip,
        local,
        soundOnly: flag === "--sound-zip",
        log,
      });
      for (const p of restored.parts) restoredParts.add(p);
    } finally {
      // a downloaded zip has done its job (or failed validation): never leave orphan GBs in vault/
      if (isLink) rmSync(zip, { force: true });
    }
  }

  const run = defaultRun(root);
  const invokeScript = runScript ?? ((name, timeout) => run(`scripts/${name}`, [], timeout));
  const assets = prepareBase
    ? await prepareBase({ root, local, run, log })
    : await defaultPrepareBase({ root, local, run, log });

  const hasSoundComplete =
    restoredParts.has("sound") &&
    existsSync(join(local, "sound/SOURCES.json")) &&
    existsSync(join(local, "sound/PEAKS.json"));
  const hasSoundPartial = restoredParts.has("sound");
  const hasMcSound =
    restoredParts.has("mc-sound") && existsSync(join(local, "mc-sound/SOURCES.json"));

  // Archives already holding vault/sound skip raw packs (and skip WAV/peaks rebuild when SOURCES + PEAKS are intact)
  if (hasSoundComplete) {
    log(
      "Sound vault restored from archive (skipping raw sound packs and rebuild; run bun run setup:sound only to add new packs).",
    );
  } else if (hasSoundPartial) {
    log(
      "Raw sound packs skipped: the archive holds vault/sound (rebuilding missing sound metadata/peaks).",
    );
    invokeScript("build_sound_vault.mjs");
  } else {
    if (existsSync(external)) {
      const raw = await runFetchSoundRaw();
      if (raw.failed.length)
        throw new Error(
          `Raw sound packs failed: ${raw.failed.join(", ")}. Run bun run setup:vault again.`,
        );
      waiting.push(...raw.waiting);
    } else {
      waiting.push(
        `raw sound packs (Kenney/Sonniss): create ${external} or set MC_VAULT_EXTERNAL, then bun run fetch:sound-raw (or restore with --vault-zip)`,
      );
    }
    // No time limit: a first build decodes every raw pack (long on a hard disk) and a stopped one resumes where it was
    invokeScript("build_sound_vault.mjs");
  }

  // Archives holding mc-sound skip downloading every Modrinth pack (~600 MB) again
  if (hasMcSound) {
    log("Minecraft sound vault restored from archive (skipping Modrinth sound downloads).");
  } else {
    invokeScript("build_mc_sound_vault.mjs", 900_000);
  }

  if (assets?.minecraft?.version) {
    log(
      `Light assets verified: Minecraft ${assets.minecraft.version}, mobs ${assets.mobs}, player rig and curated sound vault.`,
    );
  }
  log(
    "Runtime assets stay in the local vault; only raw downloads and backups use externalRoot. Run bun run link to prepare film copies.",
  );
  for (const w of waiting) log(`Waiting for you: ${w}`);
  return { restoredParts: [...restoredParts], waiting };
}

if (import.meta.main) {
  try {
    await setupVault();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
