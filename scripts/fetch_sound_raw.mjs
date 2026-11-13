import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { unzipSync } from "fflate";

import { cliArgs } from "../packages/live-studio/src/cli.mjs";
import { download } from "./download.mjs";
import { readTorrent, torrentPaths } from "./torrent.mjs";
import { EXTERNAL, ROOT } from "./vault.mjs";

const HELP = `Downloads the raw sound packs listed in scripts/sound-raw.json into <externalRoot>/sound-raw/<source>/<pack>/
(vault.json, default E:/mc_vault). Every zip is checked against its pinned sha256 and unpacked; a torrent pack is
checked against its pinned info hash and downloaded by aria2c (scoop install aria2), every file under a name Windows
accepts. A pack already there is kept, so a rerun downloads nothing. From the repo root:
  bun run fetch:sound-raw
A pack its site hands only to a browser (a zip, or a .torrent behind a bot check) is named at the end with its page:
download it there and run this again (it is taken from Downloads or sound-raw/inbox). Torrents run for hours: stop any
time, the next run resumes. Adding a pack = adding its line to scripts/sound-raw.json.`;

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

// A browser may save "kenney_impact-sounds (1).zip": any file starting with the expected name, same extension, counts
const findByHand = (dirs, name) => {
  const ext = name.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? "";
  const stem = name.slice(0, name.length - ext.length).toLowerCase();
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const hit = readdirSync(d)
      .filter((f) => f.toLowerCase().startsWith(stem) && f.toLowerCase().endsWith(ext))
      .sort()[0];
    if (hit) return join(d, hit);
  }
  return null;
};

const ARIA2 = [
  "--continue=true",
  "--seed-time=0",
  "--file-allocation=none",
  "--summary-interval=60",
  "--console-log-level=warn",
];
const aria2 = (input, log) =>
  new Promise((done) => {
    // Its live progress line redraws every second: into a log file, only the 60 s summary
    const readout = process.stdout.isTTY ? [] : ["--show-console-readout=false"];
    const child = spawn("aria2c", [`--input-file=${input}`, ...ARIA2, ...readout], {
      stdio: "inherit",
    });
    child.on("error", (e) => {
      log(
        `aria2c could not start (${e.message}): install it (scoop install aria2, brew install aria2, apt install aria2)`,
      );
      done(1);
    });
    child.on("close", done);
  });

// Windows' classic path limit is 260; the rest is left for the pack's own folder
const PATH_MAX = 240;

export async function fetchSoundRaw({
  root = ROOT,
  external = EXTERNAL,
  downloads = join(homedir(), "Downloads"),
  log = console.log,
  torrentClient = aria2,
} = {}) {
  const { sources } = JSON.parse(readFileSync(join(root, "scripts/sound-raw.json"), "utf8"));
  const raw = join(external, "sound-raw"),
    inbox = join(raw, "inbox");
  const result = { unpacked: [], kept: [], waiting: [], failed: [] };
  const torrents = [];
  for (const [source, { packs }] of Object.entries(sources)) {
    for (const p of packs) {
      const dir = join(raw, source, p.id),
        zip = join(raw, source, ".zips", `${p.id}.zip`),
        mark = join(dir, MARK);
      try {
        const pinned = p.btih ?? p.sha256;
        if (existsSync(mark) && (!pinned || pinnedIn(mark) === pinned)) {
          result.kept.push(p.id);
          continue;
        }
        if (p.torrent) {
          const found = findByHand([inbox, downloads], p.torrent);
          if (!found) {
            result.waiting.push(
              `${p.title}: open ${p.page}, press its official torrent link, leave ${p.torrent} in Downloads or ${inbox}`,
            );
            continue;
          }
          const torrent = readTorrent(readFileSync(found));
          if (torrent.btih !== p.btih)
            throw new Error(`${found} is torrent ${torrent.btih}, not the pinned ${p.btih}`);
          const file = join(raw, source, ".torrents", `${p.id}.torrent`);
          mkdirSync(dirname(file), { recursive: true });
          copyFileSync(found, file);
          const plan = torrentPaths(torrent, PATH_MAX - resolve(dir).length - 1);
          torrents.push({ p, dir, file, plan, mark });
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
  if (torrents.length) await fetchTorrents(torrents, { log, torrentClient, result });
  return result;
}

const pinnedIn = (mark) => {
  const m = JSON.parse(readFileSync(mark, "utf8"));
  return m.btih ?? m.sha256;
};

// One aria2 run per torrent pack, two at a time, each file written to its planned name (index-out); a pack is marked
// the moment its run ends, so setup:sound files it while the rest download. A pack is done when every file has its
// full length and aria2 left no control file (.aria2) for it, which it keeps until the last piece checks
const AT_ONCE = 2;
async function fetchTorrents(torrents, { log, torrentClient, result }) {
  log(
    `Downloading ${torrents.length} torrent packs with aria2c, ${AT_ONCE} at a time (stop any time; a rerun resumes)`,
  );
  let next = 0;
  const one = async () => {
    while (next < torrents.length)
      await fetchTorrent(torrents[next++], { log, torrentClient, result });
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, torrents.length) }, one));
}

async function fetchTorrent({ p, dir, file, plan, mark }, { log, torrentClient, result }) {
  const input = file.replace(/\.torrent$/, ".aria2.txt");
  writeFileSync(
    input,
    [file, `  dir=${dir}`, ...plan.map((f) => `  index-out=${f.index}=${f.path}`)].join("\n") +
      "\n",
  );
  await torrentClient(input, log);
  const missing = plan.filter((f) => {
    const at = join(dir, f.path);
    return !existsSync(at) || statSync(at).size !== f.length;
  }).length;
  const unfinished = existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".aria2"));
  if (missing || unfinished) {
    log(`${p.id}: ${missing || "some"} of ${plan.length} files not finished yet`);
    result.failed.push(p.id);
    return;
  }
  writeFileSync(
    mark,
    JSON.stringify({ btih: p.btih, files: plan.length, from: p.page }, null, 2) + "\n",
  );
  result.unpacked.push(p.id);
  log(`${p.id}: ${plan.length} files`);
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
