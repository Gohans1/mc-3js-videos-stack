import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { CORE_DIRS, CORE_FILES, HEAVY_DIRS, packVault } from "./sound_zip.mjs";
import { EXTERNAL, LOCAL } from "./vault.mjs";

const PARTS = new Set(["split", "core", "heavy", "all"]);

const HELP = `Packs pure static vault assets into private ZIP64 archives (excluding vault/tools/ and vault/cache/) for fast new-machine setup.

Usage (from the repo root):
  bun run pack:vault                          writes TWO split archives into externalRoot (or vault):
                                                mc-films-vault-core-<date>.zip   (${[...CORE_DIRS, ...CORE_FILES].join(", ")})
                                                mc-films-vault-heavy-<date>.zip  (${HEAVY_DIRS.join(", ")})
  bun run pack:vault D:/backup                writes both split archives into directory D:/backup
  bun run pack:vault --part core [out]        writes only the light core archive (~1.2 GB, easy to re-pack after adding mods)
  bun run pack:vault --part heavy [out]       writes only the heavy archive (~13.8 GB: sound, openfilm, references)
  bun run pack:vault --part all [out]         writes one single archive of all pure assets (still excludes tools/ and cache/)

Options:
  --part <split|core|heavy|all>               which archive set to build (default: split)
  --json                                      print one JSON summary to stdout; progress goes to stderr

Restore on a new machine:
  bun run setup --vault-zip <core.zip> --vault-zip <heavy.zip>

Keep these archives private: they contain Sonniss and Mojang assets that cannot be redistributed.
Local Python venvs and AI checkpoints in vault/tools/ are intentionally excluded; install tools cleanly on the new machine (INSTALL.md).`;

const argv = cliArgs(HELP, ["--part NAME", "--json"], 1);
let json = false;
let part = null;
let outArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") {
    json = true;
  } else if (a === "--part") {
    if (part !== null) {
      console.error("--part may only be given once (--help for everything)");
      process.exit(2);
    }
    part = argv[++i];
  } else {
    outArg = a;
  }
}
part ??= "split";
if (!PARTS.has(part)) {
  console.error(
    `unknown --part ${JSON.stringify(part)}: expected split, core, heavy, or all (--help for everything)`,
  );
  process.exit(2);
}

const isZipPath = Boolean(outArg && /\.zip$/i.test(outArg));
const resolvedOut = outArg ? resolve(outArg) : null;
const existingOut = resolvedOut ? statSync(resolvedOut, { throwIfNoEntry: false }) : null;
if (part === "split" && outArg) {
  if (isZipPath || (existingOut && !existingOut.isDirectory())) {
    console.error(
      `split mode writes two archives (core and heavy): pass a directory instead of ${outArg}, or pass --part core|heavy|all`,
    );
    process.exit(2);
  }
} else if (outArg) {
  if (isZipPath && existingOut?.isDirectory()) {
    console.error(`output path ${outArg} is an existing directory, not a .zip file`);
    process.exit(2);
  }
  if (!isZipPath && existingOut && !existingOut.isDirectory()) {
    console.error(
      `output path ${outArg} is an existing file: pass a directory or a .zip path with --part ${part}`,
    );
    process.exit(2);
  }
}

const date = new Date().toISOString().slice(0, 10);
const defaultDir = existsSync(EXTERNAL) ? EXTERNAL : LOCAL;
const log = json ? (...a) => console.error(...a) : console.log;

const targetPathFor = (name) => {
  const filename = `mc-films-vault-${name}-${date}.zip`;
  if (!resolvedOut) return resolve(join(defaultDir, filename));
  if (part === "split" || !isZipPath) return join(resolvedOut, filename);
  return resolvedOut;
};

const formatCliPath = (p) => {
  const normalized = p.startsWith("\\\\") ? p : p.replaceAll("\\", "/");
  return /\s/.test(normalized) ? `"${normalized}"` : normalized;
};

const targets = part === "split" ? ["core", "heavy"] : [part];
const archives = [];
for (const name of targets) {
  const out = targetPathFor(name);
  try {
    archives.push(await packVault({ local: LOCAL, out, part: name, log }));
  } catch (err) {
    if (part === "split" && /No matching vault assets found/.test(err?.message ?? "")) {
      log(`${name}: skipped (no matching files in ${LOCAL})`);
      continue;
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (!archives.length) {
  console.error(`No matching vault assets found in ${LOCAL}.`);
  process.exit(1);
}

const next = `bun run setup ${archives.map((a) => `--vault-zip ${formatCliPath(a.out)}`).join(" ")}`;
if (json) {
  console.log(JSON.stringify({ archives, next }));
} else {
  console.log(`next: ${next}`);
}
