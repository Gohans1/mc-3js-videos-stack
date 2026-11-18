import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const PIN = "b353d10e756b6d37eff27384175ba117e9921adf";
export const ARCHIVE_SHA256 = "6273afc926b8f39d81e13215e551064a92a3650958bce661f4688ae522f69295";
export const HOST = "https://assets.openfilm.dev/library";
export const LICENCE_URL = `https://github.com/openfilm/openfilm/blob/${PIN}/packages/openfilm/library/LICENSE.md`;

export function safePath(root, path) {
  if (
    typeof path !== "string" ||
    !/^[\w.-]+(?:\/[\w.-]+)*$/.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(`Invalid library path: ${path}`);
  const file = resolve(root, path),
    back = relative(resolve(root), file);
  if (!back || isAbsolute(back) || back === ".." || back.startsWith(`..${sep}`))
    throw new Error(`Library path leaves its root: ${path}`);
  return file;
}

export function readCatalog(root) {
  const files = [
    "index.json",
    "audio.json",
    "stickers.json",
    ...(existsSync(join(root, "catalogs"))
      ? readdirSync(join(root, "catalogs"))
          .filter((f) => f.endsWith(".json"))
          .sort()
          .map((f) => `catalogs/${f}`)
      : []),
  ];
  const items = [],
    ids = new Set();
  for (const name of files) {
    if (!existsSync(join(root, name))) continue;
    const catalog = JSON.parse(readFileSync(join(root, name), "utf8"));
    if (!Array.isArray(catalog.items)) throw new Error(`No items in ${name}`);
    for (const item of catalog.items) {
      safePath(root, item.id);
      if (ids.has(item.id)) throw new Error(`Duplicate OpenFilm id: ${item.id}`);
      ids.add(item.id);
      items.push(item);
    }
  }
  return items;
}

const SOUND_CATEGORY = {
  ambience: "ambience",
  foley: "foley",
  ui: "clicks",
  stings: "musical",
  transition: "transitions",
  tech: "sci-fi",
  nature: "nature",
  impact: "impacts",
  people: "voices",
  cartoon: "comedy",
  vehicles: "vehicles",
  animals: "creatures",
};
const MUSIC_CATEGORY = {
  calm: "chill",
  warm: "warm",
  tense: "tense",
  electronic: "electronic",
  cinematic: "cinematic",
  playful: "playful",
  corporate: "corporate",
  emotional: "emotional",
  lofi: "lofi",
  upbeat: "upbeat",
  festive: "festive",
};

export function audioEntry(item) {
  const kind = item.cat === "music" ? "bgm" : "sfx";
  const category = (kind === "bgm" ? MUSIC_CATEGORY : SOUND_CATEGORY)[item.group];
  if (!category) throw new Error(`Unmapped OpenFilm audio category: ${item.group} (${item.id})`);
  const stem = basename(item.id).replace(/\.[^.]+$/, "");
  const name = `of-${kind}-${stem}`;
  if (!/^[\w.-]+$/.test(name)) throw new Error(`Invalid audio id: ${item.id}`);
  return {
    name,
    title: item.name.en,
    kind,
    category,
    source: "openfilm",
    origin: item.id.startsWith("sounds/") ? "synth" : "unknown",
    license: "CC0 1.0",
    licenseUrl: LICENCE_URL,
    url: item.id.startsWith("audio/")
      ? `${HOST}/${item.id}`
      : `https://github.com/openfilm/openfilm/blob/${PIN}/packages/openfilm/library/${item.id}`,
    for: [item.about, item.group, ...(item.tags ?? [])].filter(Boolean).join("; "),
    upstreamId: item.id,
    upstreamCommit: PIN,
    ...(item.bpm && { bpm: item.bpm }),
    ...(item.energy && { energy: item.energy }),
    ...(item.loop !== undefined && { loop: item.loop }),
  };
}

function assetEntry(item, file) {
  return {
    kind: "asset",
    id: `of-${item.id.replace(/[/.]/g, "-")}`,
    cat: item.cat,
    title: item.name.en,
    about: [item.about, item.group, ...(item.tags ?? [])].filter(Boolean).join("; "),
    src: "openfilm",
    secs: item.durationMs === undefined ? undefined : item.durationMs / 1000,
    data: {
      file,
      format: `openfilm-${item.kind}`,
      upstreamId: item.id,
      upstreamCommit: PIN,
      license: item.id.startsWith("stickers/emoji/") ? "MIT (Fluent Emoji)" : "CC0 1.0",
      url: LICENCE_URL,
      group: item.group,
      definition: item,
    },
  };
}

export function assetEntries(items, root) {
  return items
    .filter((item) => !["sound", "music"].includes(item.cat))
    .map((item) => {
      const file =
        item.kind === "page"
          ? safePath(root, `${item.id}/files/${item.src}`)
          : safePath(root, `_definitions/${item.id}.json`);
      return assetEntry(item, file);
    });
}

export function writeAssetCatalog(items, root) {
  const entries = assetEntries(items, resolve(root));
  for (const entry of entries) {
    if (entry.data.definition.kind === "page") continue;
    const text = JSON.stringify(entry.data.definition, null, 2) + "\n";
    if (existsSync(entry.data.file)) {
      if (readFileSync(entry.data.file, "utf8") !== text)
        throw new Error(
          `Locally changed source definition: ${entry.data.file}; preserve it before restoring the pinned source`,
        );
      continue;
    }
    mkdirSync(dirname(entry.data.file), { recursive: true });
    writeFileSync(entry.data.file, text);
  }
  const home = resolve(root, "..");
  const stored = entries.map((entry) => ({
    ...entry,
    data: { ...entry.data, file: relative(home, entry.data.file).replaceAll("\\", "/") },
  }));
  writeFileSync(join(home, "assets.json"), JSON.stringify(stored, null, 2) + "\n");
  return entries;
}

export function readAssetCatalog(home) {
  const file = join(home, "assets.json");
  return existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8")).map((entry) => {
        const source = safePath(home, entry.data.file);
        if (
          entry.data.format?.startsWith("openfilm-") &&
          entry.data.format !== "openfilm-page" &&
          existsSync(source)
        ) {
          const item = JSON.parse(readFileSync(source, "utf8"));
          if (item.id !== entry.data.upstreamId)
            throw new Error(
              `Definition ID differs from its catalog entry: ${entry.data.upstreamId}`,
            );
          return assetEntry(item, source);
        }
        return { ...entry, data: { ...entry.data, file: source } };
      })
    : [];
}
