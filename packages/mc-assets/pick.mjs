import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { LOCAL } from "../../scripts/vault.mjs";
import { cliArgs, needFilm } from "../live-studio/src/cli.mjs";
import { compactJson } from "../live-studio/src/compact-json.mjs";
import {
  collectBlockstateModels,
  collectItemDefModels,
  collectModelOverrides,
  collectVanillaBlockOverrides,
  collectVanillaItemOverrides,
  readPackCatalog,
  readZipMembers,
  zipJsonReader,
} from "./src/catalog.ts";
import { validatePickManifest } from "./src/picks-manifest.ts";

const FIXED_MTIME = new Date(2026, 0, 1, 0, 0, 0);
const PACK_METADATA = "pack.mcmeta";
const picksFingerprint = (picks) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        picks.map(({ jar, namespace, blocks = [], items = [] }) => [jar, namespace, blocks, items]),
      ),
    )
    .digest("hex");
const picksFileOf = (cwd) => join(cwd, "pack/picks.json");
const pickedZipOf = (cwd) => join(cwd, "assets/public/picked.zip");

const defaultPacksDir = () => join(LOCAL, "packs");
const defaultVanillaJar = () => join(LOCAL, "jar/client_assets.zip");

const bytesEqual = (a, b) => {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const assetPathOf = (r, kind) => {
  if (!r || r.startsWith("#") || r.startsWith("builtin/") || r.startsWith("minecraft:builtin/")) {
    return null;
  }
  const colon = r.indexOf(":");
  const space = colon >= 0 ? r.slice(0, colon) : "minecraft";
  const name = colon >= 0 ? r.slice(colon + 1) : r;
  if (space === "builtin" || !name) return null;
  return {
    space,
    path: `assets/${space}/${kind}/${name}${kind === "models" ? ".json" : ".png"}`,
  };
};

function buildPickedZip({
  cwd = process.cwd(),
  vaultDir = defaultPacksDir(),
  vanillaJar = defaultVanillaJar(),
  quiet = false,
  picksOverride,
  strictJars = [],
} = {}) {
  const outPath = pickedZipOf(cwd);
  const picks = validatePickManifest(
    picksOverride ?? JSON.parse(readFileSync(picksFileOf(cwd), "utf8")),
  );
  const files = {};
  const fileOwners = new Map();
  let vanillaJson;

  const readVanilla = (path) => {
    vanillaJson ??= existsSync(vanillaJar)
      ? zipJsonReader(readFileSync(vanillaJar))
      : () => undefined;
    return vanillaJson(path);
  };

  for (const pick of picks) {
    const { jar, namespace: ns, blocks: ids = [], items = [] } = pick;
    const bytes = readFileSync(join(vaultDir, jar));
    const entries = readPackCatalog(bytes);
    const readOverlay = zipJsonReader(bytes, entries);
    const hasOverlay = (path) => entries.has(path);
    const get = (path) => {
      if (!entries.has(path)) return undefined;
      let zipErr = null;
      const data = readZipMembers(bytes, entries, [path], {
        onError: (_name, err) => {
          zipErr = err;
        },
      }).get(path);
      if (zipErr) throw new Error(`${jar}: failed to extract ${path}: ${zipErr.message}`);
      if (!data) throw new Error(`${jar}: cannot read ${path}`);
      return data;
    };

    const takeStatus = (path) => {
      const data = get(path);
      if (!data) return "missing";
      const metaPath = `${path}.mcmeta`;
      const meta = path.endsWith(".png") ? get(metaPath) : undefined;
      if (path in files) {
        if (bytesEqual(files[path], data) && bytesEqual(files[metaPath], meta)) return "same";
        const owner = fileOwners.get(path);
        const message = `Override collision: ${path} in ${jar} keeps earlier pick from ${owner}`;
        if (strictJars.includes(jar) || strictJars.includes(owner)) {
          throw new Error(`${message}; unpick the conflicting asset before choosing this source`);
        }
        console.warn(message);
        return "kept";
      }
      files[path] = data;
      fileOwners.set(path, jar);
      if (meta) {
        files[metaPath] = meta;
        fileOwners.set(metaPath, jar);
      }
      return "added";
    };
    const take = (path) => takeStatus(path) !== "missing";

    const resolvedModels = new Map();
    const activeModels = new Set();
    const model = (r, ownerId) => {
      const by = ownerId ? ` [needed by ${ownerId}]` : "";
      const target = assetPathOf(r, "models");
      if (!target) return false;
      if (activeModels.has(target.path)) return true;
      if (resolvedModels.has(target.path)) {
        const cachedOk = resolvedModels.get(target.path);
        if (cachedOk) return true;
        if (target.space === "minecraft") return false;
        throw new Error(
          `${jar}: model missing (${target.path})${by}; restore the jar or fix pack/picks.json`,
        );
      }
      if (!entries.has(target.path)) {
        if (target.path in files) {
          resolvedModels.set(target.path, true);
          return true;
        }
        if (target.space === "minecraft") {
          resolvedModels.set(target.path, false);
          return false;
        }
        throw new Error(
          `${jar}: model missing (${target.path})${by}; restore the jar or fix pack/picks.json`,
        );
      }
      activeModels.add(target.path);
      try {
        const st = takeStatus(target.path);
        if (st === "kept") {
          resolvedModels.set(target.path, true);
          return true;
        }
        const m = JSON.parse(strFromU8(files[target.path]));
        if (m.parent) model(m.parent, ownerId);
        for (const t of Object.values(m.textures ?? {})) {
          if (typeof t === "string" && !t.startsWith("#")) {
            const tp = assetPathOf(t, "textures");
            if (!tp) continue;
            if (!take(tp.path) && tp.space !== "minecraft") {
              throw new Error(`${jar}: texture ${t} missing (${tp.path})${by}`);
            }
          }
        }
        resolvedModels.set(target.path, true);
        return true;
      } finally {
        activeModels.delete(target.path);
      }
    };

    const takeOverrides = ({ models, textures }, ownerId) => {
      for (const ref of models) model(ref, ownerId);
      for (const path of textures) take(path);
    };
    const takeRoots = (refs, ownerId) => {
      for (const ref of refs) model(ref, ownerId);
      takeOverrides(collectModelOverrides(refs, readVanilla, readOverlay, hasOverlay), ownerId);
    };

    for (const id of ids) {
      const ownerId = `block:${ns}:${id}`;
      const state = `assets/${ns}/blockstates/${id}.json`;
      const stState = takeStatus(state);
      if (stState !== "missing") {
        if (stState !== "kept") {
          takeRoots(collectBlockstateModels(JSON.parse(strFromU8(files[state]))), ownerId);
        }
        continue;
      }
      if (ns === "minecraft") {
        const overrides = collectVanillaBlockOverrides(id, readVanilla, readOverlay, hasOverlay);
        takeOverrides(overrides, ownerId);
        if (overrides.models.size || overrides.textures.size) continue;
      }
      throw new Error(`${jar}: no blockstate ${state} [needed by ${ownerId}]`);
    }

    for (const id of items) {
      const ownerId = `item:${ns}:${id}`;
      const itemDef = `assets/${ns}/items/${id}.json`;
      const stDef = takeStatus(itemDef);
      const hasDef = stDef !== "missing";
      if (stDef === "added" || stDef === "same") {
        const parsed = JSON.parse(strFromU8(files[itemDef]));
        takeRoots(collectItemDefModels(parsed), ownerId);
      }
      if (ns === "minecraft" && !hasDef) {
        const overrides = collectVanillaItemOverrides(id, readVanilla, readOverlay, hasOverlay);
        takeOverrides(overrides, ownerId);
        if (overrides.models.size || overrides.textures.size) continue;
      }
      const itemModelRef = `${ns}:item/${id}`;
      const fallbackPath = `assets/${ns}/models/item/${id}.json`;
      if (entries.has(fallbackPath)) {
        takeRoots([itemModelRef], ownerId);
      } else if (!hasDef) {
        throw new Error(
          `${jar}: model missing (${fallbackPath}) [needed by ${ownerId}]; restore the jar or fix pack/picks.json`,
        );
      }
    }
  }

  files[PACK_METADATA] = strToU8(
    JSON.stringify({
      pack: {
        pack_format: 75,
        description: "Blocks picked from the vault's mod packs (mc-assets/pick.mjs)",
      },
      mc_films_picks_sha256: picksFingerprint(picks),
    }),
  );

  const ordered = {};
  for (const path of Object.keys(files).sort()) {
    ordered[path] = [files[path], { level: 6, mtime: FIXED_MTIME }];
  }
  const bytes = zipSync(ordered);
  const kb = Math.round(bytes.length / 1e3);
  const count = (k) => picks.reduce((n, p) => n + (p[k]?.length ?? 0), 0);
  const summary = {
    outPath,
    fileCount: Object.keys(files).length,
    kb,
    blocks: count("blocks"),
    items: count("items"),
  };
  return { bytes, summary, quiet };
}

function stagePickFiles(files) {
  const staged = [];
  const discard = () => {
    for (const { temp } of staged) rmSync(temp, { force: true });
  };
  try {
    for (const [path, content] of files) {
      const target = lstatSync(path, { throwIfNoEntry: false });
      if (target && !target.isFile()) throw new Error(`Expected a regular file at ${path}`);
      if (target && !(target.mode & 0o222))
        throw new Error(`Cannot replace read-only file ${path}`);
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.new-${process.pid}`;
      staged.push({ path, temp });
      writeFileSync(temp, content);
    }
  } catch (error) {
    discard();
    throw error;
  }
  return {
    commit() {
      try {
        for (const { path, temp } of staged) renameSync(temp, path);
      } finally {
        discard();
      }
    },
    discard,
  };
}

function summarizeZip(zip) {
  if (!zip) return null;
  const { outPath, fileCount, kb, blocks, items } = zip.summary;
  if (!zip.quiet)
    console.log(`${outPath}: ${fileCount} files, ${kb} KB; ${blocks} blocks, ${items} items`);
  return zip.summary;
}

export function pickBlocks(options = {}) {
  const zip = buildPickedZip(options);
  stagePickFiles([[zip.summary.outPath, zip.bytes]]).commit();
  return summarizeZip(zip);
}

export function buildPickedZipBytes({
  picks,
  vaultDir = defaultPacksDir(),
  vanillaJar = defaultVanillaJar(),
} = {}) {
  if (!Array.isArray(picks)) throw new Error("buildPickedZipBytes requires a picks array");
  return buildPickedZip({ picksOverride: picks, vaultDir, vanillaJar, quiet: true }).bytes;
}

export function pickedZipState(cwd, picks) {
  const path = pickedZipOf(cwd);
  const exists = existsSync(path);
  if (!exists) return { path, exists, stale: picks.length > 0 };
  try {
    const contents = unzipSync(readFileSync(path), {
      filter: (entry) => entry.name === PACK_METADATA,
    });
    const metadata = JSON.parse(strFromU8(contents[PACK_METADATA]));
    return {
      path,
      exists,
      stale: metadata.mc_films_picks_sha256 !== picksFingerprint(picks),
    };
  } catch {
    return { path, exists, stale: true };
  }
}

export function readPicksJson(cwd) {
  const picksPath = picksFileOf(cwd);
  if (!existsSync(picksPath)) return [];
  return validatePickManifest(JSON.parse(readFileSync(picksPath, "utf8")));
}

function mergePickGroup(picks, { jar, namespace, blocks = [], items = [], licence, page }) {
  let entry = picks.find((p) => p.jar === jar && p.namespace === namespace);
  if (!entry) {
    entry = {
      jar,
      namespace,
      ...(licence ? { licence } : {}),
      ...(page ? { page } : {}),
      blocks: [],
    };
    picks.push(entry);
  } else {
    if (licence && !entry.licence) entry.licence = licence;
    if (page && !entry.page) entry.page = page;
  }

  const added = [];
  if (blocks.length) {
    entry.blocks ??= [];
    for (const id of blocks) {
      if (!entry.blocks.includes(id)) {
        entry.blocks.push(id);
        added.push(`block:${namespace}:${id}`);
      }
    }
  }
  if (items.length) {
    entry.items ??= [];
    for (const id of items) {
      if (!entry.items.includes(id)) {
        entry.items.push(id);
        added.push(`item:${namespace}:${id}`);
      }
    }
  }
  return added;
}

export function preparePicksBatch(
  cwd,
  groups,
  {
    vaultDir = defaultPacksDir(),
    vanillaJar = defaultVanillaJar(),
    build = true,
    quiet = false,
    strictJars = [],
  } = {},
) {
  const picks = readPicksJson(cwd);
  const added = [];
  for (const g of groups) {
    added.push(...mergePickGroup(picks, g));
  }
  return preparePickWrite(
    cwd,
    picks,
    { vaultDir, vanillaJar, build, quiet, strictJars },
    { added },
  );
}

function preparePickWrite(cwd, picks, { vaultDir, vanillaJar, build, quiet, strictJars }, result) {
  const file = picksFileOf(cwd);
  const valid = validatePickManifest(picks);
  const zip = build
    ? buildPickedZip({ cwd, vaultDir, vanillaJar, quiet, strictJars, picksOverride: valid })
    : null;
  const files = zip ? [[zip.summary.outPath, zip.bytes]] : [];
  const staged = stagePickFiles([...files, [file, `${compactJson(valid)}\n`]]);
  return {
    commit() {
      staged.commit();
      return { file, picks: valid, ...result, built: summarizeZip(zip) };
    },
    discard: staged.discard,
  };
}

export function updatePicksBatch(cwd, groups, options) {
  return preparePicksBatch(cwd, groups, options).commit();
}

export function updatePicks(
  cwd,
  {
    jar,
    namespace,
    blocks = [],
    items = [],
    licence,
    page,
    vaultDir = defaultPacksDir(),
    vanillaJar = defaultVanillaJar(),
    build = true,
    quiet = false,
  },
) {
  return updatePicksBatch(cwd, [{ jar, namespace, blocks, items, licence, page }], {
    vaultDir,
    vanillaJar,
    build,
    quiet,
  });
}

export function removePicksBatch(
  cwd,
  groups,
  {
    vaultDir = defaultPacksDir(),
    vanillaJar = defaultVanillaJar(),
    build = true,
    quiet = false,
  } = {},
) {
  let picks = readPicksJson(cwd);
  const removed = [];
  for (const { jar, namespace, blocks = [], items = [] } of groups) {
    const filter = (p, names, ids, kind) =>
      names.filter((id) => {
        if (!ids.includes(id)) return true;
        removed.push(`${kind}:${p.namespace}:${id}`);
        return false;
      });
    picks = picks.filter((p) => {
      if ((jar && p.jar !== jar) || (namespace && p.namespace !== namespace)) return true;
      if (p.blocks && blocks.length) p.blocks = filter(p, p.blocks, blocks, "block");
      if (p.items && items.length) p.items = filter(p, p.items, items, "item");
      return p.blocks?.length || p.items?.length;
    });
  }
  if (!removed.length) return { file: picksFileOf(cwd), picks, removed, built: null };
  return preparePickWrite(cwd, picks, { vaultDir, vanillaJar, build, quiet }, { removed }).commit();
}

export function removePicks(cwd, { jar, namespace, blocks, items, ...options }) {
  return removePicksBatch(cwd, [{ jar, namespace, blocks, items }], options);
}

if (import.meta.main) {
  cliArgs(
    `Builds assets/public/picked.zip from pack/picks.json and vault/packs, inside a film.
  bun ../../packages/mc-assets/pick.mjs
Each pick: {jar, namespace, blocks: [blockstate ids], items: [item ids], licence, page}; items load with
await itemModel(assets, "<ns>:<id>") from mc-assets/model (or low-level loadModel(group, assets, await resolveModelData(assets, {model: "<ns>:item/<id>", type: "item"}), {display: {}}) with assets = await prepareAssets(sources)).
Preserves namespaces, parent models, textures and animation metadata. Minecraft references come from client_assets.zip.
Keep each jar's licence and source page in pack/picks.json; this generated zip is private and ignored by Git.
Already called by bun run asset pick / bun run link <film>; no download or creative asset restriction.
next: bun run check`,
    [],
    0,
  );
  needFilm();
  try {
    pickBlocks();
  } catch (e) {
    console.error(e.message ?? e);
    process.exit(1);
  }
}
