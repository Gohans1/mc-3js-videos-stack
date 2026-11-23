import { spawn } from "node:child_process";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { crc32 } from "node:zlib";

import yauzl from "yauzl";
import yazl from "yazl";

export const SOUND_DIRS = ["sound", "sfx", "openfilm", "mc-sound"];
export const CORE_DIRS = [
  "packs",
  "motion",
  "mc-sound",
  "sfx",
  "jar",
  "mcasset",
  "mcprep",
  "voices",
  "props",
];
export const CORE_FILES = ["packs_index.json", "packs_check.json", "favorites.json"];
export const HEAVY_DIRS = ["sound", "openfilm", "references"];
export const VAULT_PARTS = {
  core: { dirs: CORE_DIRS, files: CORE_FILES },
  heavy: { dirs: HEAVY_DIRS, files: [] },
  all: { dirs: [...CORE_DIRS, ...HEAVY_DIRS], files: CORE_FILES },
  sound: { dirs: SOUND_DIRS, files: [] },
};
const ALLOWED_VAULT_DIRS = new Set([...CORE_DIRS, ...HEAVY_DIRS]);
const ALLOWED_VAULT_FILES = new Set(CORE_FILES);
const ALLOWED_SOUND_DIRS = new Set(SOUND_DIRS);
const EMPTY_SET = new Set();

// Code-point comparison keeps "." before "_" so jar/client.jar always extracts before jar/client_assets.zip/.br
const codePointCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const SKIP = /(^|\/)\.|\.part(\.\w+)?$/;
const STORED = /\.(wav|ogg|mp3|flac|m4a|mp4|png|jpe?g|webp|zip|jar|br|woff2)$/i;

// A Drive share link (.../file/d/<id>/view, ...?id=<id>) as the URL of the file itself: confirm=t skips the virus-scan
// page Drive puts before anything too big to scan. Any other link is fetched as it is
export const driveDownloadUrl = (link) => {
  const id = /drive\.google\.com\/(?:file\/d\/|(?:open|uc)\?(?:.*&)?id=)([\w-]+)/.exec(link)?.[1];
  return id
    ? `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`
    : link;
};

const startsAsZip = (file) => {
  if (!existsSync(file) || statSync(file).size < 4) return false;
  const fd = openSync(file, "r"),
    head = Buffer.alloc(4);
  try {
    readSync(fd, head, 0, 4, 0);
  } finally {
    closeSync(fd);
  }
  return head.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
};

export async function fetchVaultZip(
  link,
  dir,
  { name = "mc-films-vault.zip", flag = "--vault-zip" } = {},
) {
  const out = join(dir, name),
    partial = `${out}.part`;
  mkdirSync(dir, { recursive: true });
  if (existsSync(partial) && !startsAsZip(partial)) rmSync(partial);
  const status = await new Promise((done, fail) =>
    spawn(
      process.platform === "win32" ? "curl.exe" : "curl",
      ["--fail", "--location", "--continue-at", "-", "--retry", "3", "--progress-bar"].concat([
        "--speed-limit",
        "1024",
        "--speed-time",
        "120",
        "--output",
        partial,
        driveDownloadUrl(link),
      ]),
      { stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
    )
      .on("error", fail)
      .on("close", done),
  );
  if (startsAsZip(partial)) {
    if (status !== 0)
      throw new Error(
        `The archive download stopped (curl ${status}): run the same command again to resume it`,
      );
    renameSync(partial, out);
    return out;
  }
  rmSync(partial, { force: true });
  const kind = flag === "--sound-zip" ? "sound zip" : "vault zip";
  throw new Error(
    `${link} did not give the ${kind} (a private Drive file, a link past its download quota, or a wrong link): download it in a browser, then bun run setup ${flag} <the downloaded zip>`,
  );
}

export const fetchSoundZip = (link, dir) =>
  fetchVaultZip(link, dir, { name: "mc-films-sound.zip", flag: "--sound-zip" });

function validateEntryName(
  fileName,
  { zip, allowedDirs, allowedFiles, label, hint, isDir = false },
) {
  const clean = isDir ? fileName.slice(0, -1) : fileName;
  if (
    !clean ||
    clean.includes("\0") ||
    clean.startsWith("/") ||
    /^[a-z]:/i.test(clean) ||
    clean.includes("\\")
  ) {
    throw new Error(`${zip} is not a ${label}: ${fileName} lies outside ${hint}`);
  }
  const segments = clean.split("/");
  if (segments.some((s) => !s || s === "." || s === "..")) {
    throw new Error(`${zip} is not a ${label}: ${fileName} lies outside ${hint}`);
  }
  if (isDir) {
    if (!allowedDirs.has(segments[0]))
      throw new Error(`${zip} is not a ${label}: ${fileName} lies outside ${hint}`);
    return segments[0];
  }
  if (segments.length === 1) {
    if (!allowedFiles.has(segments[0]))
      throw new Error(`${zip} is not a ${label}: ${fileName} lies outside ${hint}`);
    return segments[0];
  }
  if (!allowedDirs.has(segments[0]))
    throw new Error(`${zip} is not a ${label}: ${fileName} lies outside ${hint}`);
  return segments[0];
}

// Explicit non-following walk: Bun's recursive readdirSync traverses Windows junctions, which must never leak into zips
function walkRealFiles(dir, relPrefix = "", out = []) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    codePointCompare(a.name, b.name),
  );
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (st.isDirectory()) {
      walkRealFiles(full, rel, out);
    } else if (st.isFile()) {
      out.push({ full, rel, size: st.size });
    }
  }
  return out;
}

async function packArchive({
  local,
  out,
  dirs,
  rootFiles = [],
  allowEmpty = false,
  log = console.log,
}) {
  const zip = new yazl.ZipFile();
  let files = 0,
    bytes = 0;
  const parts = new Set();

  const resolvedOut = resolve(out);
  for (const dirName of dirs) {
    const dir = join(local, dirName);
    const dirStat = lstatSync(dir, { throwIfNoEntry: false });
    if (!dirStat) {
      log(`${dirName}: not in the vault, left out of the zip`);
      continue;
    }
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      log(`${dirName}: skipped (not a real directory)`);
      continue;
    }
    for (const { full, rel, size } of walkRealFiles(dir)) {
      const name = `${dirName}/${rel}`;
      if (SKIP.test(name) || resolve(full) === resolvedOut) continue;
      zip.addFile(full, name, { compress: !STORED.test(name) });
      files++;
      bytes += size;
      parts.add(dirName);
    }
  }

  for (const fileName of rootFiles) {
    const full = join(local, fileName);
    const st = lstatSync(full, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink() || !st.isFile()) continue;
    zip.addFile(full, fileName, { compress: !STORED.test(fileName) });
    files++;
    bytes += st.size;
    parts.add(fileName);
  }

  if (!files && !allowEmpty) {
    throw new Error(`No matching vault assets found in ${local} to pack into ${out}`);
  }

  zip.end();
  mkdirSync(dirname(out), { recursive: true });
  const partial = `${out}.${process.pid}.part`;
  try {
    await pipeline(zip.outputStream, createWriteStream(partial));
    renameSync(partial, out);
  } finally {
    rmSync(partial, { force: true });
  }
  log(`${out}: ${files} files, ${(bytes / 2 ** 30).toFixed(2)} GB`);
  return { files, bytes, parts: [...parts].sort(codePointCompare) };
}

export async function packVault({ local, out, part = "all", log = console.log }) {
  const spec = VAULT_PARTS[part];
  if (!spec) {
    throw new Error(
      `Unknown vault archive part "${part}" (expected: ${Object.keys(VAULT_PARTS).join(", ")})`,
    );
  }
  const res = await packArchive({
    local,
    out,
    dirs: spec.dirs,
    rootFiles: spec.files,
    allowEmpty: false,
    log,
  });
  return { part, out, ...res };
}

export async function packSound({ local, out, log = console.log }) {
  const { files, bytes } = await packArchive({
    local,
    out,
    dirs: SOUND_DIRS,
    rootFiles: [],
    allowEmpty: true,
    log,
  });
  return { files, bytes };
}

const crcOf = async (file) => {
  let crc = 0;
  for await (const chunk of createReadStream(file)) crc = crc32(chunk, crc);
  return crc;
};

async function validateZipEntries({ zip, allowedDirs, allowedFiles, label, hint }) {
  const file = await promisify(yauzl.open)(zip, { lazyEntries: true });
  await new Promise((done, fail) => {
    file.on("error", fail);
    file.on("end", done);
    file.on("entry", (entry) => {
      try {
        validateEntryName(entry.fileName, {
          zip,
          allowedDirs,
          allowedFiles,
          label,
          hint,
          isDir: entry.fileName.endsWith("/"),
        });
        file.readEntry();
      } catch (e) {
        file.close();
        fail(e);
      }
    });
    file.readEntry();
  });
}

function assertRealDirectoryChain(base, entryName) {
  const baseStat = lstatSync(base, { throwIfNoEntry: false });
  if (baseStat && (baseStat.isSymbolicLink() || !baseStat.isDirectory())) {
    throw new Error(`Refusing to restore into symlink/junction or non-directory: ${base}`);
  }
  const segments = entryName.split("/");
  let cur = base;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = join(cur, segments[i]);
    const st = lstatSync(cur, { throwIfNoEntry: false });
    if (!st) break;
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new Error(
        `Refusing to restore through symlink/junction or non-directory ancestor: ${cur}`,
      );
    }
  }
}

async function restoreArchive({ zip, local, allowedDirs, allowedFiles, label, hint, log }) {
  await validateZipEntries({ zip, allowedDirs, allowedFiles, label, hint });

  const base = resolve(local);
  const basePrefix = base.endsWith(sep) ? base : base + sep;
  const file = await promisify(yauzl.open)(zip, { lazyEntries: true });
  let written = 0,
    kept = 0;
  const parts = new Set();

  await new Promise((done, fail) => {
    file.on("error", fail);
    file.on("end", done);
    file.on("entry", async (entry) => {
      try {
        if (entry.fileName.endsWith("/")) return file.readEntry();
        const top = validateEntryName(entry.fileName, {
          zip,
          allowedDirs,
          allowedFiles,
          label,
          hint,
        });
        parts.add(top);
        const target = resolve(base, entry.fileName);
        if (!target.startsWith(basePrefix)) {
          throw new Error(`${zip} is not a ${label}: ${entry.fileName} lies outside ${hint}`);
        }
        assertRealDirectoryChain(base, entry.fileName);
        const existing = lstatSync(target, { throwIfNoEntry: false });
        if (existing) {
          if (existing.isSymbolicLink()) {
            throw new Error(
              `Refusing to overwrite symlink/junction ${target} with archive file ${entry.fileName}`,
            );
          }
          if (existing.isDirectory()) {
            throw new Error(
              `Refusing to overwrite directory ${target} with archive file ${entry.fileName}`,
            );
          }
          if (
            existing.isFile() &&
            existing.size === entry.uncompressedSize &&
            (await crcOf(target)) === entry.crc32
          ) {
            kept++;
            return file.readEntry();
          }
        }
        mkdirSync(dirname(target), { recursive: true });
        const partial = `${target}.${process.pid}.part`;
        const stream = await promisify(file.openReadStream.bind(file))(entry);
        // yauzl does not check CRC: a damaged download must not land in the vault
        let crc = 0;
        try {
          await pipeline(
            stream,
            async function* (chunks) {
              for await (const chunk of chunks) {
                crc = crc32(chunk, crc);
                yield chunk;
              }
            },
            createWriteStream(partial),
          );
          if (crc !== entry.crc32)
            throw new Error(
              `${entry.fileName} is damaged in ${zip} (a download cut short or changed): download it again`,
            );
          renameSync(partial, target);
        } finally {
          rmSync(partial, { force: true });
        }
        written++;
        file.readEntry();
      } catch (e) {
        file.close();
        fail(e);
      }
    });
    file.readEntry();
  });
  log(`${zip}: ${written} files restored, ${kept} already there`);
  return { written, kept, parts: [...parts].sort(codePointCompare) };
}

export async function restoreVault({ zip, local, soundOnly = false, log = console.log }) {
  return restoreArchive({
    zip,
    local,
    allowedDirs: soundOnly ? ALLOWED_SOUND_DIRS : ALLOWED_VAULT_DIRS,
    allowedFiles: soundOnly ? EMPTY_SET : ALLOWED_VAULT_FILES,
    label: soundOnly ? "sound zip" : "vault archive",
    hint: soundOnly
      ? `${SOUND_DIRS.join(", ")} (bun run pack:sound makes one)`
      : "allowed vault asset paths (tools and cache are excluded; bun run pack:vault makes one)",
    log,
  });
}

export async function restoreSound({ zip, local, log = console.log }) {
  const { written, kept } = await restoreVault({ zip, local, soundOnly: true, log });
  return { written, kept };
}
