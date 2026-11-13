import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { unzipSync } from "fflate";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { download } from "./download.mjs";
import { EXTERNAL, ROOT } from "./vault.mjs";

const HELP = `Downloads the raw sound packs listed in scripts/sound-raw.json and unpacks each into
<externalRoot>/sound-raw/<source>/<pack>/ (vault.json, default E:/mc_vault). Every zip is checked against its pinned
sha256; a pack already unpacked is kept, so a rerun downloads nothing. From the repo root:
  bun run fetch:sound-raw
A pack its site hands only to a browser is named at the end with its page: download it there and run this again
(it is taken from Downloads or sound-raw/inbox). Adding a pack = adding its line to scripts/sound-raw.json.`;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const MARK = ".pack.json";
const isMacMeta = (name) => name.split("/").some((p) => p === "__MACOSX" || p.startsWith("._"));

// Unpacks into a sibling folder first, so a failed pack never leaves half its files behind
function unpack(zip, dir) {
  const files = unzipSync(zip, { filter: (f) => !isMacMeta(f.name) && !f.name.endsWith("/") });
  const part = `${dir}.${process.pid}.part`;
  rmSync(part, { recursive: true, force: true });
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const to = resolve(part, name);
      if (!to.startsWith(resolve(part) + sep))
        throw new Error(`${name} would land outside the pack's folder`);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, bytes);
    }
    rmSync(dir, { recursive: true, force: true });
    renameSync(part, dir);
  } finally {
    rmSync(part, { recursive: true, force: true });
  }
  return Object.keys(files).length;
}

// A browser may save "kenney_impact-sounds (1).zip": any zip starting with the expected name counts
const findByHand = (dirs, name) => {
  const stem = name.replace(/\.zip$/i, "").toLowerCase();
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const hit = readdirSync(d)
      .filter((f) => f.toLowerCase().startsWith(stem) && f.toLowerCase().endsWith(".zip"))
      .sort()[0];
    if (hit) return join(d, hit);
  }
  return null;
};

export async function fetchSoundRaw({
  root = ROOT,
  external = EXTERNAL,
  downloads = join(homedir(), "Downloads"),
  log = console.log,
} = {}) {
  const { sources } = JSON.parse(readFileSync(join(root, "scripts/sound-raw.json"), "utf8"));
  const raw = join(external, "sound-raw"),
    inbox = join(raw, "inbox");
  const result = { unpacked: [], kept: [], waiting: [], failed: [] };
  for (const [source, { packs }] of Object.entries(sources)) {
    for (const p of packs) {
      const dir = join(raw, source, p.id),
        zip = join(raw, source, ".zips", `${p.id}.zip`),
        mark = join(dir, MARK);
      try {
        if (
          existsSync(mark) &&
          (!p.sha256 || JSON.parse(readFileSync(mark, "utf8")).sha256 === p.sha256)
        ) {
          result.kept.push(p.id);
          continue;
        }
        if (p.file) {
          await download(p.file, zip, async (f) => sha256(readFileSync(f)) === p.sha256);
        } else {
          const found = findByHand([inbox, downloads], p.byHand);
          if (!found) {
            result.waiting.push(
              `${p.title}: open ${p.page}, press Download, leave ${p.byHand} in Downloads or ${inbox}`,
            );
            continue;
          }
          mkdirSync(dirname(zip), { recursive: true });
          copyFileSync(found, zip);
        }
        const bytes = readFileSync(zip);
        const files = unpack(bytes, dir);
        writeFileSync(
          mark,
          JSON.stringify({ sha256: sha256(bytes), files, from: p.file ?? p.page }, null, 2) + "\n",
        );
        result.unpacked.push(p.id);
        log(`${source}/${p.id}: ${files} files`);
      } catch (e) {
        log(`${source}/${p.id}: ${e.message}`);
        result.failed.push(p.id);
      }
    }
  }
  return result;
}

if (import.meta.main) {
  cliArgs(HELP, [], 0);
  if (!existsSync(EXTERNAL)) {
    console.error(
      `${EXTERNAL} is not there: mount it, or set vault.json "externalRoot" (or MC_VAULT_EXTERNAL) to a drive with room`,
    );
    process.exit(1);
  }
  const r = await fetchSoundRaw();
  console.log(
    `Sound packs in ${join(EXTERNAL, "sound-raw")}: ${r.unpacked.length} unpacked, ${r.kept.length} already there.`,
  );
  for (const w of r.waiting) console.log(`Waiting for you: ${w}`);
  if (r.failed.length) {
    console.error(
      `${r.failed.length} failed: ${r.failed.join(", ")}. Run bun run fetch:sound-raw again.`,
    );
    process.exit(1);
  }
}
