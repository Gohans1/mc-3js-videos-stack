import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { wavInfo } from "../../packages/live-studio/src/sound.mjs";
import { audioEntry, PIN, readAssetCatalog, readCatalog, safePath } from "./catalog.mjs";

const load = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
export function verifyImport({ home, vaultSound, log = console.log }) {
  const library = join(home, "library"),
    items = readCatalog(library),
    assets = readAssetCatalog(home);
  const missing = [],
    categories = {},
    sound = items.filter((x) => ["sound", "music"].includes(x.cat));
  const expectedDownloads = new Set(),
    checkedDownloads = new Set();
  const need = (file) => {
    if (!existsSync(file) || !statSync(file).size) {
      missing.push(file);
      return false;
    }
    return true;
  };
  const published = (path) => {
    expectedDownloads.add(path);
    return need(safePath(library, path));
  };
  const visual = items.filter((x) => !["sound", "music"].includes(x.cat));
  const upstream = load(join(home, "source.json"));
  if (upstream.commit !== PIN || !Object.keys(upstream.sourceHashes ?? {}).length)
    missing.push("Missing pinned source inventory: run bun run fetch:openfilm");
  for (const [path, sha256] of Object.entries(upstream.sourceHashes ?? {})) {
    const file = safePath(library, path);
    if (need(file) && createHash("sha256").update(readFileSync(file)).digest("hex") !== sha256)
      missing.push(`Changed upstream source: ${path}`);
  }
  if (!items.length) missing.push("No upstream catalog: run bun run fetch:openfilm");
  if (
    assets.length !== visual.length ||
    new Set(assets.map((x) => x.data.upstreamId)).size !== visual.length
  )
    missing.push(`Visual catalog coverage: ${assets.length}/${visual.length}`);
  const byId = new Map(assets.map((x) => [x.data.upstreamId, x]));
  for (const item of visual) {
    const entry = byId.get(item.id);
    if (!entry) missing.push(`Visual entry: ${item.id}`);
    else need(entry.data.file);
    categories[item.cat] = (categories[item.cat] ?? 0) + 1;
  }
  const sources = load(join(vaultSound, "SOURCES.json")),
    peaks = load(join(vaultSound, "PEAKS.json"));
  for (const item of sound) {
    const meta = audioEntry(item),
      file = join(vaultSound, meta.kind, meta.category, `${meta.name}.wav`);
    if (item.id.startsWith("audio/")) published(item.id);
    else need(safePath(library, item.id));
    if (!need(file)) continue;
    const info = wavInfo(file),
      stat = statSync(file),
      source = sources[meta.name],
      wave = peaks[meta.name];
    if (
      !info ||
      info.tag !== 1 ||
      info.bits !== 16 ||
      info.rate !== 48000 ||
      info.channels !== 2 ||
      info.seconds <= 0
    )
      missing.push(`Invalid PCM WAV: ${file}`);
    if (info && stat.size < info.seconds * info.rate * info.channels * 2)
      missing.push(`Truncated WAV: ${file}`);
    if (
      !source ||
      ["kind", "category", "source", "origin", "license", "upstreamId", "upstreamCommit"].some(
        (key) => source[key] !== meta[key],
      )
    )
      missing.push(`Wrong source/category/provenance: ${meta.name}`);
    if (
      !wave?.peaks?.length ||
      wave.size !== stat.size ||
      wave.mtimeMs !== Math.round(stat.mtimeMs)
    )
      missing.push(`Missing/stale waveform: ${meta.name}`);
    if (wave?.peaks?.some((x) => x > 0.893)) missing.push(`WAV peak exceeds -1 dBFS: ${meta.name}`);
    categories[item.cat] = (categories[item.cat] ?? 0) + 1;
  }
  const checkpoint = join(home, "fetch.jsonl");
  let downloadedFiles = 0;
  if (existsSync(checkpoint))
    for (const line of readFileSync(checkpoint, "utf8").trim().split("\n").filter(Boolean)) {
      const row = JSON.parse(line),
        file = safePath(library, row.path);
      if (need(file)) {
        const bytes = readFileSync(file);
        if (
          bytes.length !== row.bytes ||
          createHash("sha256").update(bytes).digest("hex") !== row.sha256
        )
          missing.push(`Damaged downloaded asset: ${row.path}`);
      }
      checkedDownloads.add(row.path);
    }
  for (const item of items.filter((x) => x.id.startsWith("stickers/emoji/"))) {
    const file = safePath(library, `${item.id}/files.json`);
    if (published(`${item.id}/files.json`))
      for (const member of JSON.parse(readFileSync(file, "utf8")))
        published(`${item.id}/${member}`);
  }
  for (const item of items) {
    if (item.cover) published(item.cover);
    if (item.music) published(item.music);
    if (item.kind === "group") published(`examples/${item.id}.mp4`);
  }
  downloadedFiles = checkedDownloads.size;
  const unchecked = [...expectedDownloads].filter((path) => !checkedDownloads.has(path));
  if (unchecked.length)
    missing.push(
      `Incomplete download checksum coverage: ${expectedDownloads.size - unchecked.length}/${expectedDownloads.size}; missing ${unchecked.slice(0, 5).join(", ")}`,
    );
  if (upstream.downloadedFiles !== expectedDownloads.size)
    missing.push(
      `Download checksum inventory disagrees with catalog: ${upstream.downloadedFiles}/${expectedDownloads.size}`,
    );
  if (missing.length)
    throw new Error(
      `${missing.length} OpenFilm verification problems:\n${missing.slice(0, 20).join("\n")}\nRun bun run fetch:openfilm to resume or repair.`,
    );
  const report = {
    commit: PIN,
    entries: items.length,
    nativeAudio: sound.length,
    editableAssets: assets.length,
    downloadedFiles,
    sourceFiles: Object.keys(upstream.sourceHashes ?? {}).length,
    categories,
  };
  writeFileSync(join(home, "verified.json"), JSON.stringify(report, null, 2) + "\n");
  log(
    `OpenFilm verified: ${items.length} entries; ${sound.length} native WAVs; ${assets.length} editable assets; ${downloadedFiles} downloaded files checked`,
  );
  return report;
}
