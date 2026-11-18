import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";

import { unzipSync } from "fflate";

import { download } from "../download.mjs";
import { ARCHIVE_SHA256, HOST, PIN, readCatalog, safePath } from "./catalog.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file, fallback) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;

function validBytes(file, path) {
  if (!existsSync(file)) return false;
  const bytes = readFileSync(file);
  if (!bytes.length) return false;
  if (extname(path) === ".json") {
    try {
      JSON.parse(bytes.toString("utf8"));
    } catch {
      return false;
    }
  }
  if (extname(path) === ".png" && bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    return false;
  if (/\.jpe?g$/i.test(path) && bytes.subarray(0, 2).toString("hex") !== "ffd8") return false;
  if (
    /\.(mp3|m4a|mp4)$/i.test(path) &&
    (bytes.length < 44 || bytes.subarray(0, 32).toString().includes("<html"))
  )
    return false;
  return true;
}

export async function fetchFiles({
  root,
  paths,
  checkpoint,
  host = HOST,
  deadline = Date.now() + 3600_000,
  log = console.log,
}) {
  mkdirSync(dirname(checkpoint), { recursive: true });
  const kept = new Map();
  if (existsSync(checkpoint)) {
    const lines = readFileSync(checkpoint, "utf8").trimEnd().split("\n");
    for (const [i, line] of lines.entries()) {
      try {
        const row = JSON.parse(line);
        kept.set(row.path, row);
      } catch {
        if (i < lines.length - 1) throw new Error(`Invalid checkpoint ${checkpoint}:${i + 1}`);
        writeFileSync(checkpoint, lines.slice(0, i).join("\n") + (i ? "\n" : ""));
      }
    }
  }
  const unique = [...new Set(paths)],
    failed = [];
  let next = 0,
    done = 0,
    fetched = 0,
    last = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      while (next < unique.length && Date.now() < deadline) {
        const path = unique[next++];
        try {
          const target = safePath(root, path),
            was = kept.get(path);
          const valid = (file) =>
            validBytes(file, path) && (!was || digest(readFileSync(file)) === was.sha256);
          if (
            await download(
              `${host}/${path.split("/").map(encodeURIComponent).join("/")}`,
              target,
              valid,
            )
          )
            fetched++;
          const bytes = readFileSync(target);
          if (!was)
            appendFileSync(
              checkpoint,
              JSON.stringify({ path, bytes: bytes.length, sha256: digest(bytes) }) + "\n",
            );
          done++;
        } catch (e) {
          failed.push({ path, error: e.message });
          log(`OpenFilm download failed: ${path}: ${e.message}`);
        }
        if (Date.now() - last > 5000) {
          last = Date.now();
          log(
            `OpenFilm files: ${done}/${unique.length}, ${fetched} downloaded, ${failed.length} failed`,
          );
        }
      }
    }),
  );
  for (const path of unique.slice(next))
    failed.push({ path, error: "Run time limit reached; run again to resume" });
  if (failed.length) {
    writeFileSync(`${checkpoint}.failed.json`, JSON.stringify(failed, null, 2) + "\n");
    throw new Error(
      `${failed.length} OpenFilm files unfinished; ${checkpoint}.failed.json; run again to resume`,
    );
  }
  log(`OpenFilm files: ${done}/${unique.length}, ${fetched} downloaded`);
  rmSync(`${checkpoint}.failed.json`, { force: true });
  return { count: done, fetched };
}

export async function fetchOpenFilm({
  home,
  deadline = Date.now() + 3600_000,
  log = console.log,
} = {}) {
  const archive = join(home, "upstream.zip"),
    library = join(home, "library");
  await download(
    `https://codeload.github.com/openfilm/openfilm/zip/${PIN}`,
    archive,
    (file) => existsSync(file) && digest(readFileSync(file)) === ARCHIVE_SHA256,
  );
  const prefix = `openfilm-${PIN}/packages/openfilm/library/`;
  const files = unzipSync(readFileSync(archive), {
    filter: (entry) => entry.name.startsWith(prefix) && !entry.name.endsWith("/"),
  });
  for (const [name, bytes] of Object.entries(files)) {
    const file = safePath(library, name.slice(prefix.length));
    if (existsSync(file) && digest(readFileSync(file)) === digest(bytes)) continue;
    if (existsSync(file))
      throw new Error(
        `Locally changed upstream asset: ${file}; preserve it before restoring the pinned source`,
      );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  const items = readCatalog(library),
    checkpoint = join(home, "fetch.jsonl");
  const emoji = items.filter((x) => x.id.startsWith("stickers/emoji/"));
  const paths = [
    ...items.filter((x) => x.id.startsWith("audio/")).map((x) => x.id),
    ...items.flatMap((x) => (x.cover ? [x.cover] : [])),
    ...items.flatMap((x) => (x.music ? [x.music] : [])),
    ...emoji.map((x) => `${x.id}/files.json`),
    ...items.filter((x) => x.kind === "group").map((x) => `examples/${x.id}.mp4`),
  ];
  log(
    `OpenFilm ${PIN}: ${items.length} catalog entries, ${Object.keys(files).length} source files`,
  );
  await fetchFiles({ root: library, paths, checkpoint, deadline, log });
  const members = emoji.flatMap((x) => {
    const files = read(safePath(library, `${x.id}/files.json`));
    if (!Array.isArray(files)) throw new Error(`Invalid bundle: ${x.id}`);
    return files.map((name) => {
      safePath(library, name);
      return `${x.id}/${name}`;
    });
  });
  await fetchFiles({ root: library, paths: members, checkpoint, deadline, log });
  writeFileSync(
    join(home, "source.json"),
    JSON.stringify(
      {
        repo: "openfilm/openfilm",
        commit: PIN,
        archiveSha256: ARCHIVE_SHA256,
        sourceFiles: Object.keys(files).length,
        sourceHashes: Object.fromEntries(
          Object.entries(files).map(([path, bytes]) => [path.slice(prefix.length), digest(bytes)]),
        ),
        downloadedFiles: new Set([...paths, ...members]).size,
      },
      null,
      2,
    ) + "\n",
  );
  return { library, items };
}
