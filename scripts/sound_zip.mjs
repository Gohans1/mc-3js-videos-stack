// One zip of every sound in the vault, each file at its vault path: a new machine (or a new project) unzips it instead of
// fetching Mixkit again and waiting hours on the Sonniss torrents. yazl writes ZIP64 by itself past 4 GB or 65,535 files.
import { spawn } from "node:child_process";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { crc32 } from "node:zlib";

import yauzl from "yauzl";
import yazl from "yazl";

const PARTS = ["sound", "sfx", "mc-sound"];
// a build's own cache (dot files) and a write cut short (*.part)
const SKIP = /(^|\/)\.|\.part(\.\w+)?$/;
// audio does not deflate: stored, it packs and unpacks at disk speed
const STORED = /\.(wav|ogg|mp3|flac|m4a)$/i;

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

// Downloads the sound zip into dir with curl, resuming a download cut short. Drive serves a private file (or one past
// its download quota) as an HTML page: that is refused with what the human does instead
export async function fetchSoundZip(link, dir) {
  const out = join(dir, "mc-films-sound.zip"),
    partial = `${out}.part`;
  mkdirSync(dir, { recursive: true });
  if (existsSync(partial) && !startsAsZip(partial)) rmSync(partial);
  const status = await new Promise((done, fail) =>
    spawn(
      process.platform === "win32" ? "curl.exe" : "curl",
      ["--fail", "--location", "--continue-at", "-", "--retry", "3", "--progress-bar"].concat(
        // a stalled transfer (under 1 KB/s for 2 minutes) stops instead of hanging; a rerun resumes it
        [
          "--speed-limit",
          "1024",
          "--speed-time",
          "120",
          "--output",
          partial,
          driveDownloadUrl(link),
        ],
      ),
      { stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
    )
      .on("error", fail)
      .on("close", done),
  );
  if (startsAsZip(partial)) {
    if (status !== 0)
      throw new Error(
        `The sound zip download stopped (curl ${status}): run the same command again to resume it`,
      );
    renameSync(partial, out);
    return out;
  }
  rmSync(partial, { force: true });
  throw new Error(
    `${link} did not give the sound zip (a private Drive file, a link past its download quota, or a wrong link): download it in a browser, then bun run setup --sound-zip <the downloaded zip>`,
  );
}

export async function packSound({ local, out, log = console.log }) {
  const zip = new yazl.ZipFile();
  let files = 0,
    bytes = 0;
  for (const part of PARTS) {
    const dir = join(local, part);
    if (!existsSync(dir)) {
      log(`${part}: not in the vault, left out of the zip`);
      continue;
    }
    for (const rel of readdirSync(dir, { recursive: true })) {
      const name = `${part}/${rel.replaceAll("\\", "/")}`,
        st = statSync(join(dir, rel));
      if (SKIP.test(name) || !st.isFile()) continue;
      zip.addFile(join(dir, rel), name, { compress: !STORED.test(name) });
      files++;
      bytes += st.size;
    }
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
  log(`${out}: ${files} sounds, ${(bytes / 2 ** 30).toFixed(2)} GB`);
  return { files, bytes };
}

const crcOf = async (file) => {
  let crc = 0;
  for await (const chunk of createReadStream(file)) crc = crc32(chunk, crc);
  return crc;
};

// A file already there with the zip's size and CRC is kept, so a stopped restore resumes where it was
export async function restoreSound({ zip, local, log = console.log }) {
  const file = await promisify(yauzl.open)(zip, { lazyEntries: true });
  let written = 0,
    kept = 0;
  await new Promise((done, fail) => {
    file.on("error", fail);
    file.on("end", done);
    file.on("entry", async (entry) => {
      try {
        if (entry.fileName.endsWith("/")) return file.readEntry();
        const top = entry.fileName.split("/")[0];
        if (!PARTS.includes(top))
          throw new Error(
            `${zip} is not a sound zip: ${entry.fileName} lies outside ${PARTS.join(", ")} (bun run pack:sound makes one)`,
          );
        const target = join(local, entry.fileName);
        if (
          existsSync(target) &&
          statSync(target).size === entry.uncompressedSize &&
          (await crcOf(target)) === entry.crc32
        ) {
          kept++;
          return file.readEntry();
        }
        mkdirSync(dirname(target), { recursive: true });
        const partial = `${target}.${process.pid}.part`;
        const stream = await promisify(file.openReadStream.bind(file))(entry);
        // yauzl does not check CRC: a damaged download must not land in the vault as a sound
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
  log(`${zip}: ${written} sounds restored, ${kept} already there`);
  return { written, kept };
}
