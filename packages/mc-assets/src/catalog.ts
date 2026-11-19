import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inflateSync, strFromU8, unzipSync } from "fflate";

export interface ZipCdEntry {
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
  zip64: boolean;
}

export interface MobClipInfo {
  name: string;
  length?: number;
  loop?: boolean;
}

export interface McAssetItem {
  kind: "block" | "item" | "mob";
  /** Placed ID or canonical item ID: block:<ns>:<id>, item:<ns>:<id>, mob:<id> */
  id: string;
  namespace: string;
  name: string;
  title: string;
  source: string;
  pack?: string;
  packTitle?: string;
  edition: "vanilla" | "modded";
  type: "vanilla" | "mod" | "resourcepack" | "gohans" | "mob";
  license?: string;
  url?: string;
  downloads?: number;
  renderable: boolean;
  brokenReason?: string;
  props?: Record<string, string[]>;
  clips?: MobClipInfo[];
  variants?: McAssetItem[];
}

export interface McPackMeta {
  file: string;
  slug: string;
  title: string;
  type: "mod" | "resourcepack";
  license?: string;
  licenseName?: string;
  url?: string;
  downloads?: number;
}

export interface McCacheData {
  version: 1;
  schemaRevision?: number;
  vanilla?: {
    fingerprint: string;
    entries: McAssetItem[];
    files: string[];
  };
  packs: Record<
    string,
    {
      fingerprint: string;
      vanillaFingerprint?: string;
      meta: McPackMeta;
      entries: McAssetItem[];
    }
  >;
}

export interface McCatalogResult {
  items: McAssetItem[];
  packs: McPackMeta[];
  vanillaFiles: Set<string>;
  stats: {
    reindexedPacks: string[];
    fromCache: boolean;
  };
}

const SKIP_TECHNICAL_BLOCKS = new Set([
  "air",
  "cave_air",
  "void_air",
  "structure_void",
  "light",
  "barrier",
  "moving_piston",
  "piston_head",
]);

const DEFAULT_GOHANS_PACK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../pack/assets/gohans",
);

const CACHE_REL = "cache/mc-catalog.v1.json";
const SCHEMA_REVISION = 4;

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

function readFileBytes(filePath: string): Uint8Array {
  const b = readFileSync(filePath);
  return new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
}

function collectJsonRelPaths(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...collectJsonRelPaths(join(dir, d.name), rel));
    else if (d.isFile() && d.name.endsWith(".json") && d.name !== "_list.json") out.push(rel);
  }
  return out;
}

/** Reads ZIP Central Directory offsets and sizes without inflating file payloads. */
export function readZipCatalog(buf: Uint8Array): Map<string, ZipCdEntry> {
  const len = buf.length;
  const minOff = Math.max(0, len - 65558);
  let eocd = -1;
  for (let i = len - 22; i >= minOff; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      const commentLen = u16(buf, i + 20);
      if (i + 22 + commentLen === len) {
        eocd = i;
        break;
      }
    }
  }
  if (eocd < 0) throw new Error("Invalid ZIP archive: EOCD not found");

  const totalEntries = u16(buf, eocd + 10);
  const cdSize = u32(buf, eocd + 12);
  const cdOffset = u32(buf, eocd + 16);
  const map = new Map<string, ZipCdEntry>();

  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // ZIP64 fallback handled lazily via full unzip when any entry needs reading.
    const full = unzipSync(buf);
    for (const [name, data] of Object.entries(full)) {
      if (name.endsWith("/")) continue;
      map.set(name, {
        name,
        method: -1,
        compSize: data.length,
        uncompSize: data.length,
        localOffset: 0,
        zip64: true,
      });
    }
    return map;
  }

  let off = cdOffset;
  const end = Math.min(len, cdOffset + cdSize);
  while (off + 46 <= end) {
    if (
      buf[off] !== 0x50 ||
      buf[off + 1] !== 0x4b ||
      buf[off + 2] !== 0x01 ||
      buf[off + 3] !== 0x02
    )
      break;
    const method = u16(buf, off + 10);
    const compSize = u32(buf, off + 20);
    const uncompSize = u32(buf, off + 24);
    const nameLen = u16(buf, off + 28);
    const extraLen = u16(buf, off + 30);
    const commentLen = u16(buf, off + 32);
    const localOffset = u32(buf, off + 42);
    const name = strFromU8(buf.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const zip64 =
      compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff;
    map.set(name, { name, method, compSize, uncompSize, localOffset, zip64 });
  }
  return map;
}

/** Decompresses only the requested archive paths using Central Directory byte ranges. */
export function readZipMembers(
  buf: Uint8Array,
  catalog: Map<string, ZipCdEntry>,
  wanted: Iterable<string>,
): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  let zip64Fallback: Record<string, Uint8Array> | null = null;

  for (const name of wanted) {
    const entry = catalog.get(name);
    if (!entry) continue;
    if (entry.zip64) {
      zip64Fallback ??= unzipSync(buf);
      if (zip64Fallback[name]) result.set(name, zip64Fallback[name]);
      continue;
    }
    const lh = entry.localOffset;
    if (
      lh + 30 > buf.length ||
      buf[lh] !== 0x50 ||
      buf[lh + 1] !== 0x4b ||
      buf[lh + 2] !== 0x03 ||
      buf[lh + 3] !== 0x04
    )
      continue;
    const fnameLen = u16(buf, lh + 26);
    const extraLen = u16(buf, lh + 28);
    const start = lh + 30 + fnameLen + extraLen;
    const slice = buf.subarray(start, start + entry.compSize);
    if (entry.method === 0) {
      result.set(name, slice);
    } else if (entry.method === 8) {
      try {
        result.set(name, inflateSync(slice));
      } catch {
        // Ignore corrupt compressed member so one broken model does not crash pack indexing.
      }
    }
  }
  return result;
}

const statFingerprint = (filePath: string) => {
  const s = statSync(filePath);
  return `${s.size}:${Math.trunc(s.mtimeMs)}`;
};

function parseRef(raw: string, fallbackNs: string): { ns: string; path: string } | null {
  if (!raw || raw.startsWith("#")) return null;
  const colon = raw.indexOf(":");
  const ns = colon >= 0 ? raw.slice(0, colon) : "minecraft";
  const path = colon >= 0 ? raw.slice(colon + 1) : raw;
  if (!path) return null;
  return { ns: ns || fallbackNs, path };
}

export function extractBlockstateProps(stateJson: any): Record<string, string[]> | undefined {
  const map = new Map<string, Set<string>>();
  const record = (keyStr: string) => {
    for (const part of keyStr.split(",")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (!k || !v) continue;
      let set = map.get(k);
      if (!set) {
        set = new Set<string>();
        map.set(k, set);
      }
      set.add(v);
    }
  };
  if (stateJson?.variants && typeof stateJson.variants === "object") {
    for (const k of Object.keys(stateJson.variants)) record(k);
  }
  if (Array.isArray(stateJson?.multipart)) {
    const collectWhen = (w: any) => {
      if (!w || typeof w !== "object") return;
      for (const [k, val] of Object.entries(w)) {
        if ((k === "AND" || k === "OR") && Array.isArray(val)) {
          for (const sub of val) collectWhen(sub);
        } else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
          for (const part of String(val).split("|")) record(`${k}=${part}`);
        }
      }
    };
    for (const part of stateJson.multipart) collectWhen(part?.when);
  }
  if (!map.size) return undefined;
  const out: Record<string, string[]> = {};
  for (const k of [...map.keys()].toSorted()) {
    out[k] = [...map.get(k)!].toSorted();
  }
  return out;
}

function collectBlockstateModels(stateJson: any): string[] {
  const refs: string[] = [];
  const pushGroup = (g: any) => {
    for (const entry of Array.isArray(g) ? g : [g]) {
      if (typeof entry?.model === "string") refs.push(entry.model);
    }
  };
  if (stateJson?.variants && typeof stateJson.variants === "object") {
    for (const v of Object.values(stateJson.variants)) pushGroup(v);
  }
  if (Array.isArray(stateJson?.multipart)) {
    for (const p of stateJson.multipart) if (p?.apply) pushGroup(p.apply);
  }
  return [...new Set(refs)];
}

export function collectItemDefModels(node: any, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (typeof node.model === "string") out.push(node.model);
  else if (node.model && typeof node.model === "object") collectItemDefModels(node.model, out);
  if (node.fallback) collectItemDefModels(node.fallback, out);
  // Armor trim cases reference runtime-generated sprite permutations (trims/items/*_<material>), not static PNGs.
  if (node.property === "minecraft:trim_material" && node.fallback) return out;
  if (node.on_true) collectItemDefModels(node.on_true, out);
  if (node.on_false) collectItemDefModels(node.on_false, out);
  if (Array.isArray(node.cases)) {
    for (const c of node.cases) collectItemDefModels(c?.model ?? c, out);
  }
  if (Array.isArray(node.entries)) {
    for (const e of node.entries) collectItemDefModels(e?.model ?? e, out);
  }
  if (Array.isArray(node.models)) {
    for (const m of node.models) collectItemDefModels(m, out);
  }
  return out;
}

function readJsonMembers(
  buf: Uint8Array,
  catalog: Map<string, ZipCdEntry>,
  paths: string[],
): Map<string, { data?: any; invalidJson?: boolean }> {
  const raw = readZipMembers(buf, catalog, paths);
  const parsed = new Map<string, { data?: any; invalidJson?: boolean }>();
  for (const [p, bytes] of raw) {
    try {
      parsed.set(p, { data: JSON.parse(strFromU8(bytes)) });
    } catch {
      parsed.set(p, { invalidJson: true });
    }
  }
  return parsed;
}

interface InspectEnv {
  buf: Uint8Array;
  catalog: Map<string, ZipCdEntry>;
  vanillaFiles?: Set<string>;
  isVanilla: boolean;
  jsonCache: Map<string, { data?: any; invalidJson?: boolean }>;
  geoOrObjByNs: Map<string, boolean>;
}

function loadModelJson(
  env: InspectEnv,
  path: string,
): { data?: any; invalidJson?: boolean } | null {
  if (!env.catalog.has(path)) return null;
  if (!env.jsonCache.has(path)) {
    const loaded = readJsonMembers(env.buf, env.catalog, [path]);
    env.jsonCache.set(path, loaded.get(path) ?? { invalidJson: true });
  }
  return env.jsonCache.get(path) ?? null;
}

function checkModelChain(
  env: InspectEnv,
  rawRef: string,
  ns: string,
  seen = new Set<string>(),
): string | null {
  if (rawRef.startsWith("builtin/") || rawRef.startsWith("minecraft:builtin/")) return null;
  const parsed = parseRef(rawRef, ns);
  if (!parsed) return `invalid model ref "${rawRef}"`;
  if (parsed.ns === "builtin") return null;
  if (parsed.path.endsWith(".obj") || parsed.path.endsWith(".geo")) {
    return `unsupported model format "${rawRef}"`;
  }

  const mPath = `assets/${parsed.ns}/models/${parsed.path}.json`;
  if (seen.has(mPath)) return `cyclic parent in ${mPath}`;
  seen.add(mPath);

  if (!env.catalog.has(mPath)) {
    if (!env.isVanilla && parsed.ns === "minecraft") {
      if (!env.vanillaFiles || env.vanillaFiles.has(mPath)) return null;
      return `missing vanilla parent ${rawRef}`;
    }
    if (env.geoOrObjByNs.get(parsed.ns)) return `uses .geo.json/.obj or missing model ${rawRef}`;
    return `missing model ${rawRef} (${mPath})`;
  }

  const loaded = loadModelJson(env, mPath);
  if (!loaded || loaded.invalidJson || !loaded.data || typeof loaded.data !== "object") {
    return `invalid model JSON ${mPath}`;
  }
  const m = loaded.data;
  if (typeof m.loader === "string" && !m.loader.startsWith("minecraft:")) {
    return `custom loader ${m.loader}`;
  }
  if (typeof m.parent === "string") {
    const err = checkModelChain(env, m.parent, parsed.ns, seen);
    if (err) return err;
  }
  if (m.textures && typeof m.textures === "object") {
    for (const texRaw of Object.values(m.textures)) {
      if (typeof texRaw !== "string" || texRaw.startsWith("#")) continue;
      const tParsed = parseRef(texRaw, parsed.ns);
      if (!tParsed) continue;
      const tPath = `assets/${tParsed.ns}/textures/${tParsed.path}.png`;
      if (env.catalog.has(tPath)) continue;
      if (!env.isVanilla && tParsed.ns === "minecraft") {
        if (!env.vanillaFiles || env.vanillaFiles.has(tPath)) continue;
        return `missing vanilla texture ${texRaw}`;
      }
      return `missing texture ${texRaw} (${tPath})`;
    }
  }
  return null;
}

function indexArchive(
  filePath: string,
  meta: McPackMeta,
  isVanilla: boolean,
  vanillaFiles?: Set<string>,
): { entries: McAssetItem[]; files: string[] } {
  const buf = readFileBytes(filePath);
  const catalog = readZipCatalog(buf);
  const files = [...catalog.keys()];

  const geoOrObjByNs = new Map<string, boolean>();
  const blockstates: { ns: string; id: string; path: string }[] = [];
  const itemDefs: { ns: string; id: string; path: string }[] = [];
  const blockModelsDirect: { ns: string; id: string; path: string }[] = [];
  const itemModelsDirect: { ns: string; id: string; path: string }[] = [];

  for (const name of files) {
    const mGeo = /^assets\/([^/]+)\/.*\.(?:geo\.json|obj)$/i.exec(name);
    if (mGeo) geoOrObjByNs.set(mGeo[1]!, true);

    const mBs = /^assets\/([^/]+)\/blockstates\/(.+)\.json$/.exec(name);
    if (mBs) {
      blockstates.push({ ns: mBs[1]!, id: mBs[2]!, path: name });
      continue;
    }
    const mItemDef = /^assets\/([^/]+)\/items\/(.+)\.json$/.exec(name);
    if (mItemDef) {
      itemDefs.push({ ns: mItemDef[1]!, id: mItemDef[2]!, path: name });
      continue;
    }
    const mBlockM = /^assets\/([^/]+)\/models\/block\/(.+)\.json$/.exec(name);
    if (mBlockM) {
      blockModelsDirect.push({ ns: mBlockM[1]!, id: mBlockM[2]!, path: name });
      continue;
    }
    const mItemM = /^assets\/([^/]+)\/models\/item\/(.+)\.json$/.exec(name);
    if (mItemM) {
      itemModelsDirect.push({ ns: mItemM[1]!, id: mItemM[2]!, path: name });
    }
  }

  // Batch read top-level JSON metadata + all model JSONs once to avoid per-file unzip loops.
  const modelJsonPaths = files.filter((f) => /^assets\/[^/]+\/models\/.+\.json$/.test(f));
  const jsonCache = readJsonMembers(buf, catalog, [
    ...blockstates.map((b) => b.path),
    ...itemDefs.map((it) => it.path),
    ...modelJsonPaths,
  ]);
  const env: InspectEnv = {
    buf,
    catalog,
    vanillaFiles,
    isVanilla,
    jsonCache,
    geoOrObjByNs,
  };

  const entries: McAssetItem[] = [];
  const seenBlocks = new Set<string>();
  const seenItems = new Set<string>();

  for (const b of blockstates) {
    if (b.id.startsWith("_")) continue;
    if (isVanilla && SKIP_TECHNICAL_BLOCKS.has(b.id)) continue;
    const key = `${b.ns}:${b.id}`;
    seenBlocks.add(key);
    const state = jsonCache.get(b.path);
    let brokenReason: string | undefined;
    let props: Record<string, string[]> | undefined;
    if (!state || state.invalidJson || !state.data || typeof state.data !== "object") {
      brokenReason = `invalid blockstate JSON ${b.path}`;
    } else {
      props = extractBlockstateProps(state.data);
      const refs = collectBlockstateModels(state.data);
      if (!refs.length) {
        brokenReason = "empty blockstate";
      } else {
        for (const r of refs) {
          const err = checkModelChain(env, r, b.ns);
          if (err) {
            brokenReason = err;
            break;
          }
        }
      }
    }
    entries.push({
      kind: "block",
      id: `block:${key}`,
      namespace: b.ns,
      name: b.id,
      title: b.id.replaceAll("_", " "),
      source: isVanilla ? "minecraft" : meta.slug,
      ...(isVanilla ? {} : { pack: meta.file, packTitle: meta.title }),
      edition: isVanilla ? "vanilla" : "modded",
      type: isVanilla ? "vanilla" : meta.type,
      license: isVanilla ? "minecraft" : meta.license,
      url: meta.url,
      downloads: meta.downloads,
      renderable: !brokenReason,
      ...(brokenReason ? { brokenReason } : {}),
      ...(props ? { props } : {}),
    });
  }

  // Resource-pack minecraft: model-only block overrides (when pack overrides model/texture without blockstate JSON)
  if (!isVanilla && meta.type === "resourcepack") {
    for (const bm of blockModelsDirect) {
      if (bm.ns !== "minecraft" || bm.id.startsWith("_")) continue;
      const key = `${bm.ns}:${bm.id}`;
      if (seenBlocks.has(key)) continue;
      if (SKIP_TECHNICAL_BLOCKS.has(bm.id)) continue;
      if (vanillaFiles?.size && !vanillaFiles.has(`assets/minecraft/blockstates/${bm.id}.json`)) {
        // Only surface model-only overrides that map cleanly to a real block when vanilla exists, or top-level override
        continue;
      }
      seenBlocks.add(key);
      const err = checkModelChain(env, `${bm.ns}:block/${bm.id}`, bm.ns);
      entries.push({
        kind: "block",
        id: `block:${key}`,
        namespace: bm.ns,
        name: bm.id,
        title: bm.id.replaceAll("_", " "),
        source: meta.slug,
        pack: meta.file,
        packTitle: meta.title,
        edition: "modded",
        type: meta.type,
        license: meta.license,
        url: meta.url,
        downloads: meta.downloads,
        renderable: !err,
        ...(err ? { brokenReason: err } : {}),
      });
    }
  }

  // 1.21.4+ items/<id>.json definitions first, then fallback models/item/<id>.json
  for (const it of itemDefs) {
    if (it.id.startsWith("_")) continue;
    const key = `${it.ns}:${it.id}`;
    seenItems.add(key);
    const def = jsonCache.get(it.path);
    let brokenReason: string | undefined;
    if (!def || def.invalidJson || !def.data || typeof def.data !== "object") {
      brokenReason = `invalid item JSON ${it.path}`;
    } else {
      const refs = [...new Set(collectItemDefModels(def.data))];
      if (!refs.length) {
        // Fallback: check matching models/item/<id>.json if special item renderer omits model string
        if (catalog.has(`assets/${it.ns}/models/item/${it.id}.json`)) {
          brokenReason = checkModelChain(env, `${it.ns}:item/${it.id}`, it.ns) ?? undefined;
        } else {
          brokenReason = "special item renderer (no static model)";
        }
      } else {
        for (const r of refs) {
          const err = checkModelChain(env, r, it.ns);
          if (err) {
            brokenReason = err;
            break;
          }
        }
      }
    }
    entries.push({
      kind: "item",
      id: `item:${key}`,
      namespace: it.ns,
      name: it.id,
      title: it.id.replaceAll("_", " "),
      source: isVanilla ? "minecraft" : meta.slug,
      ...(isVanilla ? {} : { pack: meta.file, packTitle: meta.title }),
      edition: isVanilla ? "vanilla" : "modded",
      type: isVanilla ? "vanilla" : meta.type,
      license: isVanilla ? "minecraft" : meta.license,
      url: meta.url,
      downloads: meta.downloads,
      renderable: !brokenReason,
      ...(brokenReason ? { brokenReason } : {}),
    });
  }

  for (const im of itemModelsDirect) {
    if (im.id.startsWith("_")) continue;
    const key = `${im.ns}:${im.id}`;
    if (seenItems.has(key)) continue;
    if (im.ns === "minecraft" && im.id === "generated") continue;
    seenItems.add(key);
    const err = checkModelChain(env, `${im.ns}:item/${im.id}`, im.ns);
    entries.push({
      kind: "item",
      id: `item:${key}`,
      namespace: im.ns,
      name: im.id,
      title: im.id.replaceAll("_", " "),
      source: isVanilla ? "minecraft" : meta.slug,
      ...(isVanilla ? {} : { pack: meta.file, packTitle: meta.title }),
      edition: isVanilla ? "vanilla" : "modded",
      type: isVanilla ? "vanilla" : meta.type,
      license: isVanilla ? "minecraft" : meta.license,
      url: meta.url,
      downloads: meta.downloads,
      renderable: !err,
      ...(err ? { brokenReason: err } : {}),
    });
  }

  return { entries, files };
}

function readPacksIndex(vaultRoot: string): Record<string, any> {
  const file = join(vaultRoot, "packs_index.json");
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function packMetaOf(file: string, rawIndex: Record<string, any>): McPackMeta {
  const info = rawIndex[file];
  const baseSlug = file.replace(/\.(jar|zip)$/i, "");
  return {
    file,
    slug: (typeof info?.slug === "string" && info.slug) || baseSlug,
    title: (typeof info?.title === "string" && info.title) || baseSlug.replaceAll("-", " "),
    type:
      info?.type === "resourcepack" || file.toLowerCase().endsWith(".zip") ? "resourcepack" : "mod",
    license: typeof info?.license?.id === "string" ? info.license.id : undefined,
    licenseName: typeof info?.license?.name === "string" ? info.license.name : undefined,
    url: typeof info?.url === "string" ? info.url : undefined,
    downloads: typeof info?.downloads === "number" ? info.downloads : undefined,
  };
}

export function scanGohansPack(gohansPackDir = DEFAULT_GOHANS_PACK): McAssetItem[] {
  const bsDir = join(gohansPackDir, "blockstates");
  if (!existsSync(bsDir)) return [];
  const out: McAssetItem[] = [];
  for (const name of readdirSync(bsDir).toSorted()) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    let props: Record<string, string[]> | undefined;
    try {
      const state = JSON.parse(readFileSync(join(bsDir, name), "utf8"));
      props = extractBlockstateProps(state);
    } catch {}
    out.push({
      kind: "block",
      id: `block:gohans:${id}`,
      namespace: "gohans",
      name: id,
      title: id.replaceAll("_", " "),
      source: "gohans",
      edition: "modded",
      type: "gohans",
      license: "repo",
      renderable: true,
      ...(props ? { props } : {}),
    });
  }
  return out;
}

function readMobListRecursive(dir: string, prefix = "", seenDirs = new Set<string>()): string[] {
  const real = resolve(dir);
  if (seenDirs.has(real)) return [];
  seenDirs.add(real);
  const listFile = join(dir, "_list.json");
  if (!existsSync(listFile)) {
    return collectJsonRelPaths(dir, prefix);
  }
  try {
    const parsed = JSON.parse(readFileSync(listFile, "utf8"));
    const out: string[] = [];
    if (Array.isArray(parsed?.files)) {
      for (const f of parsed.files) {
        if (typeof f === "string" && f.endsWith(".json")) {
          out.push(prefix ? `${prefix}/${f}` : f);
        }
      }
    }
    if (Array.isArray(parsed?.directories)) {
      for (const d of parsed.directories) {
        if (
          typeof d !== "string" ||
          !d ||
          d.includes("..") ||
          d.includes("/") ||
          d.includes("\\")
        ) {
          continue;
        }
        const subDir = join(dir, d);
        if (existsSync(subDir)) {
          out.push(...readMobListRecursive(subDir, prefix ? `${prefix}/${d}` : d, seenDirs));
        }
      }
    }
    if (out.length) return out;
  } catch {}
  return collectJsonRelPaths(dir, prefix);
}

export function scanVaultMobs(vaultRoot: string): McAssetItem[] {
  const base = join(vaultRoot, "mcasset/1.21.11");
  const modelsDir = join(base, "entity-models/minecraft");
  if (!existsSync(modelsDir)) return [];

  const files = readMobListRecursive(modelsDir);

  const animDir = join(base, "entity-models/animations/minecraft");
  return files
    .filter((f) => typeof f === "string" && f.endsWith(".json"))
    .map((f) => {
      const rel = f.replaceAll("\\", "/").slice(0, -5);
      let clips: MobClipInfo[] = [];
      const animPath = join(animDir, `${rel}.json`);
      if (existsSync(animPath)) {
        try {
          const raw = JSON.parse(readFileSync(animPath, "utf8"));
          if (raw?.animations && typeof raw.animations === "object") {
            clips = Object.entries(raw.animations).map(([name, c]: [string, any]) => ({
              name,
              ...(typeof c?.length === "number" ? { length: +c.length.toFixed(2) } : {}),
              ...(typeof c?.loop === "boolean" ? { loop: c.loop } : {}),
            }));
          }
        } catch {}
      }
      return {
        kind: "mob" as const,
        id: `mob:${rel}`,
        namespace: "minecraft",
        name: rel,
        title: rel.replaceAll("/", " ").replaceAll("_", " "),
        source: "minecraft",
        edition: "vanilla" as const,
        type: "mob" as const,
        license: "minecraft",
        renderable: true,
        ...(clips.length ? { clips } : {}),
      };
    });
}

export function loadWarmMcCache(vaultRoot: string): McCacheData | null {
  const file = join(vaultRoot, CACHE_REL);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (
      parsed?.version === 1 &&
      parsed?.schemaRevision === SCHEMA_REVISION &&
      parsed?.packs &&
      typeof parsed.packs === "object"
    ) {
      return parsed as McCacheData;
    }
  } catch {}
  return null;
}

/** Loads built-in gohans blocks plus cached/fresh vault vanilla jar, packs, and mobs. */
export function loadMcAssetsCatalog(options?: {
  vaultRoot?: string;
  gohansPackDir?: string;
  quiet?: boolean;
}): McCatalogResult {
  const vaultRoot = options?.vaultRoot;
  const gohansItems = scanGohansPack(options?.gohansPackDir ?? DEFAULT_GOHANS_PACK);
  if (!vaultRoot || !existsSync(vaultRoot)) {
    return {
      items: gohansItems,
      packs: [],
      vanillaFiles: new Set(),
      stats: { reindexedPacks: [], fromCache: false },
    };
  }

  const cacheFile = join(vaultRoot, CACHE_REL);
  const existing = loadWarmMcCache(vaultRoot);
  const nextCache: McCacheData = {
    version: 1,
    schemaRevision: SCHEMA_REVISION,
    ...(existing?.vanilla ? { vanilla: existing.vanilla } : {}),
    packs: {},
  };
  let cacheDirty = false;
  const reindexedPacks: string[] = [];

  // 1) Vanilla jar first so pack validator knows vanilla model/texture refs.
  const jarPath = join(vaultRoot, "jar/client_assets.zip");
  const vanillaFp = existsSync(jarPath) ? statFingerprint(jarPath) : "";
  let vanillaEntries: McAssetItem[] = [];
  let vanillaFiles = new Set<string>();
  if (existsSync(jarPath)) {
    const fp = vanillaFp;
    if (existing?.vanilla?.fingerprint === fp) {
      vanillaEntries = existing.vanilla.entries;
      vanillaFiles = new Set(existing.vanilla.files);
    } else {
      if (!options?.quiet) {
        process.stderr.write("Indexing Minecraft client_assets.zip (first run or updated)...\n");
      }
      try {
        const res = indexArchive(
          jarPath,
          { file: "client_assets.zip", slug: "minecraft", title: "Minecraft Vanilla", type: "mod" },
          true,
        );
        vanillaEntries = res.entries;
        vanillaFiles = new Set(res.files);
        nextCache.vanilla = { fingerprint: fp, entries: res.entries, files: res.files };
        cacheDirty = true;
      } catch (err) {
        if (!options?.quiet) {
          process.stderr.write(
            `Warning: skipping corrupt client_assets.zip (${err instanceof Error ? err.message : String(err)})\n`,
          );
        }
      }
    }
  } else if (existing?.vanilla) {
    delete nextCache.vanilla;
    cacheDirty = true;
  }

  // 2) Packs directory: per-file fingerprint + packs_index.json metadata + vanilla jar cache.
  const packsDir = join(vaultRoot, "packs");
  const packIndex = readPacksIndex(vaultRoot);
  const packMetas: McPackMeta[] = [];
  const packItems: McAssetItem[] = [];
  const sameMeta = (a: McPackMeta, b: McPackMeta) =>
    a.slug === b.slug &&
    a.title === b.title &&
    a.type === b.type &&
    a.license === b.license &&
    a.licenseName === b.licenseName &&
    a.url === b.url &&
    a.downloads === b.downloads;

  if (existsSync(packsDir)) {
    const packFiles = readdirSync(packsDir)
      .filter((f) => /\.(jar|zip)$/i.test(f))
      .toSorted();
    const coldCount = packFiles.filter((f) => {
      const fp = statFingerprint(join(packsDir, f));
      const c = existing?.packs?.[f];
      const meta = packMetaOf(f, packIndex);
      return (
        !c ||
        c.fingerprint !== fp ||
        (c.vanillaFingerprint ?? "") !== vanillaFp ||
        c.meta.type !== meta.type
      );
    }).length;
    if (coldCount > 0 && !options?.quiet) {
      process.stderr.write(
        `Indexing ${coldCount} Minecraft pack${coldCount > 1 ? "s" : ""} into ${CACHE_REL}...\n`,
      );
    }
    for (const file of packFiles) {
      const abs = join(packsDir, file);
      const fp = statFingerprint(abs);
      const cached = existing?.packs?.[file];
      const meta = packMetaOf(file, packIndex);
      if (
        cached &&
        cached.fingerprint === fp &&
        (cached.vanillaFingerprint ?? "") === vanillaFp &&
        cached.meta.type === meta.type
      ) {
        if (sameMeta(cached.meta, meta)) {
          nextCache.packs[file] = cached;
          packMetas.push(cached.meta);
          packItems.push(...cached.entries);
        } else {
          // Refresh pack index metadata (slug/title/license/url/downloads) without decompressing archive
          const refreshedEntries = cached.entries.map((it) => ({
            ...it,
            source: meta.slug,
            packTitle: meta.title,
            license: meta.license,
            url: meta.url,
            downloads: meta.downloads,
          }));
          nextCache.packs[file] = {
            fingerprint: fp,
            vanillaFingerprint: vanillaFp,
            meta,
            entries: refreshedEntries,
          };
          packMetas.push(meta);
          packItems.push(...refreshedEntries);
          cacheDirty = true;
        }
      } else {
        try {
          const res = indexArchive(abs, meta, false, vanillaFiles);
          nextCache.packs[file] = {
            fingerprint: fp,
            vanillaFingerprint: vanillaFp,
            meta,
            entries: res.entries,
          };
          packMetas.push(meta);
          packItems.push(...res.entries);
          reindexedPacks.push(file);
          cacheDirty = true;
        } catch (err) {
          if (!options?.quiet) {
            process.stderr.write(
              `Warning: skipping corrupt pack "${file}" (${err instanceof Error ? err.message : String(err)})\n`,
            );
          }
        }
      }
    }
    if (existing && Object.keys(existing.packs).some((k) => !(k in nextCache.packs))) {
      cacheDirty = true;
    }
  } else if (existing && Object.keys(existing.packs).length > 0) {
    cacheDirty = true;
  }

  if (cacheDirty && (nextCache.vanilla || Object.keys(nextCache.packs).length > 0 || existing)) {
    mkdirSync(dirname(cacheFile), { recursive: true });
    const tmp = `${cacheFile}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(nextCache));
    renameSync(tmp, cacheFile);
  }

  const mobs = scanVaultMobs(vaultRoot);
  return {
    items: [...gohansItems, ...vanillaEntries, ...packItems, ...mobs],
    packs: packMetas,
    vanillaFiles,
    stats: { reindexedPacks, fromCache: reindexedPacks.length === 0 && !cacheDirty },
  };
}

const VARIANT_PREFIX =
  /^(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|bamboo|crimson|warped|pale_oak|white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black|stone|cobblestone|andesite|diorite|granite|deepslate|tuff|iron|gold|copper|exposed_copper|weathered_copper|oxidized_copper|waxed_copper|diamond|netherite|emerald|wooden|nether_brick|red_nether_brick|sandstone|red_sandstone|prismarine|purpur|quartz)_(.+)$/;
const VARIANT_SUFFIX =
  /_(?:white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black|\d+|v\d+|mk\d+)$/;

/** Normalizes wood/color/tier prefixes & suffixes so related variants fold into one line after filtering. */
export function variantStem(name: string): string {
  let s = name.toLowerCase();
  const pm = VARIANT_PREFIX.exec(s);
  if (pm?.[1]) s = pm[1];
  const sm = VARIANT_SUFFIX.exec(s);
  if (sm && sm.index > 1) s = s.slice(0, sm.index);
  return s;
}

/** Folds matching variant rows by pack + namespace + kind + normalized stem while keeping filter matches first. */
export function foldObjectVariants<
  T extends Pick<McAssetItem, "kind" | "id" | "pack" | "source" | "title"> & {
    namespace?: string;
    name?: string;
  },
>(rows: T[]): (T & { variants?: T[] })[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (row.kind === "mob") {
      groups.set(`mob:${row.id}`, [row]);
      continue;
    }
    const parts = row.id.split(":");
    const ns = row.namespace ?? parts[1] ?? "";
    const name = row.name ?? parts.slice(2).join(":");
    const stem = variantStem(name);
    const key = `${row.kind}|${row.pack ?? row.source}|${ns}|${stem}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const out: (T & { variants?: T[] })[] = [];
  for (const list of groups.values()) {
    const head = list[0]!;
    out.push(list.length > 1 ? { ...head, variants: list } : head);
  }
  return out;
}

/** Quickly inspects a single blockstate in a jar or client_assets.zip without scanning all packs. */
export function inspectBlockstateInZip(
  zipPath: string,
  blockstateRelPath: string,
): {
  exists: boolean;
  invalidZip?: boolean;
  props?: Record<string, string[]>;
} {
  if (!existsSync(zipPath)) return { exists: false };
  try {
    const buf = readFileBytes(zipPath);
    const cd = readZipCatalog(buf);
    if (!cd.has(blockstateRelPath)) return { exists: false };
    const raw = readZipMembers(buf, cd, [blockstateRelPath]).get(blockstateRelPath);
    if (!raw) return { exists: true };
    try {
      return { exists: true, props: extractBlockstateProps(JSON.parse(strFromU8(raw))) };
    } catch {
      return { exists: true };
    }
  } catch {
    return { exists: false, invalidZip: true };
  }
}
