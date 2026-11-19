// Cherry-picks blocks & items from vetted packs in vault/packs into assets/public/picked.zip.
// Can be imported ({ pickBlocks, updatePicks, removePicks }) or run inside a film: bun ../../packages/mc-assets/pick.mjs
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { LOCAL } from "../../scripts/vault.mjs";
import { cliArgs, needFilm } from "../live-studio/src/cli.mjs";
import { compactJson } from "../live-studio/src/timeline_file.mjs";
import { collectItemDefModels } from "./src/catalog.ts";

const FIXED_MTIME = new Date(2026, 0, 1, 0, 0, 0);

const defaultPacksDir = () => join(LOCAL, "packs");
const defaultVanillaJar = () => join(LOCAL, "jar/client_assets.zip");

const bytesEqual = (a, b) => {
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

/** Builds `assets/public/picked.zip` from `pack/picks.json` (or `picksOverride`) and the prepared vault packs. */
export function pickBlocks({
  cwd = process.cwd(),
  vaultDir = defaultPacksDir(),
  vanillaJar = defaultVanillaJar(),
  quiet = false,
  picksOverride,
} = {}) {
  const picksPath = join(cwd, "pack/picks.json");
  const outPath = join(cwd, "assets/public/picked.zip");
  const picks = picksOverride ?? JSON.parse(readFileSync(picksPath, "utf8"));
  const files = {};
  const fileOwners = new Map();
  let vanillaEntries = null;

  const getVanilla = () => {
    if (vanillaEntries !== null) return vanillaEntries;
    vanillaEntries = existsSync(vanillaJar)
      ? unzipSync(readFileSync(vanillaJar), {
          filter: (f) =>
            f.name.startsWith("assets/minecraft/blockstates/") && f.name.endsWith(".json"),
        })
      : {};
    return vanillaEntries;
  };

  for (const pick of picks) {
    const { jar, namespace: ns, blocks: ids = [], items = [] } = pick;
    const entries = unzipSync(readFileSync(join(vaultDir, jar)), {
      filter: (f) => f.name.startsWith("assets/") && !f.name.endsWith("/"),
    });

    const takeStatus = (path) => {
      if (!(path in entries)) return "missing";
      if (path in files) {
        if (bytesEqual(files[path], entries[path])) return "same";
        console.warn(
          `Override collision: ${path} in ${jar} keeps earlier pick from ${fileOwners.get(path)}`,
        );
        return "kept";
      }
      files[path] = entries[path];
      fileOwners.set(path, jar);
      if (path.endsWith(".png") && `${path}.mcmeta` in entries) {
        files[`${path}.mcmeta`] = entries[`${path}.mcmeta`];
        fileOwners.set(`${path}.mcmeta`, jar);
      }
      return "added";
    };
    const take = (path) => takeStatus(path) !== "missing";

    const resolvedModels = new Map();
    const activeModels = new Set();
    const model = (r, { optionalMissingMinecraft = true } = {}) => {
      const target = assetPathOf(r, "models");
      if (!target) return false;
      if (activeModels.has(target.path)) return true;
      if (resolvedModels.has(target.path)) {
        const cachedOk = resolvedModels.get(target.path);
        if (cachedOk) return true;
        if (target.space === "minecraft" && optionalMissingMinecraft) return false;
        throw new Error(
          `${jar}: model missing (${target.path}); restore the jar or fix pack/picks.json`,
        );
      }
      if (!(target.path in entries)) {
        if (target.path in files) {
          resolvedModels.set(target.path, true);
          return true;
        }
        if (target.space === "minecraft" && optionalMissingMinecraft) {
          resolvedModels.set(target.path, false);
          return false;
        }
        throw new Error(
          `${jar}: model missing (${target.path}); restore the jar or fix pack/picks.json`,
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
        if (m.parent) model(m.parent, { optionalMissingMinecraft: true });
        for (const t of Object.values(m.textures ?? {})) {
          if (typeof t === "string" && !t.startsWith("#")) {
            const tp = assetPathOf(t, "textures");
            if (!tp) continue;
            if (!take(tp.path) && tp.space !== "minecraft") {
              throw new Error(`${jar}: texture ${t} missing (${tp.path})`);
            }
          }
        }
        resolvedModels.set(target.path, true);
        return true;
      } finally {
        activeModels.delete(target.path);
      }
    };

    const blockstateModels = (s, optionalMissing) => {
      const groups = [
        ...Object.values(s.variants ?? {}),
        ...(s.multipart ?? []).map((p) => p.apply),
      ];
      for (const v of groups) {
        for (const one of Array.isArray(v) ? v : [v]) {
          if (one?.model) model(one.model, { optionalMissingMinecraft: optionalMissing });
        }
      }
    };

    for (const id of ids) {
      const state = `assets/${ns}/blockstates/${id}.json`;
      const stState = takeStatus(state);
      if (stState !== "missing") {
        if (stState !== "kept") {
          blockstateModels(JSON.parse(strFromU8(files[state])), true);
        }
        continue;
      }
      if (ns === "minecraft") {
        let matched = false;
        const vState = getVanilla()[state];
        if (vState) {
          const parsed = JSON.parse(strFromU8(vState));
          const groups = [
            ...Object.values(parsed.variants ?? {}),
            ...(parsed.multipart ?? []).map((p) => p.apply),
          ];
          for (const v of groups) {
            for (const one of Array.isArray(v) ? v : [v]) {
              if (one?.model && model(one.model, { optionalMissingMinecraft: true })) {
                matched = true;
              }
            }
          }
        }
        if (model(`minecraft:block/${id}`, { optionalMissingMinecraft: true })) matched = true;
        if (matched) continue;
      }
      throw new Error(`${jar}: no blockstate ${state}`);
    }

    for (const id of items) {
      const itemDef = `assets/${ns}/items/${id}.json`;
      const stDef = takeStatus(itemDef);
      const hasDef = stDef !== "missing";
      if (stDef === "added" || stDef === "same") {
        const parsed = JSON.parse(strFromU8(files[itemDef]));
        for (const ref of collectItemDefModels(parsed)) {
          model(ref, { optionalMissingMinecraft: true });
        }
      }
      const itemModelRef = `${ns}:item/${id}`;
      const fallbackPath = `assets/${ns}/models/item/${id}.json`;
      if (fallbackPath in entries) {
        model(itemModelRef, { optionalMissingMinecraft: true });
      } else if (!hasDef) {
        throw new Error(
          `${jar}: model missing (${fallbackPath}); restore the jar or fix pack/picks.json`,
        );
      }
    }
  }

  files["pack.mcmeta"] = strToU8(
    JSON.stringify({
      pack: {
        pack_format: 75,
        description: "Blocks picked from the vault's mod packs (mc-assets/pick.mjs)",
      },
    }),
  );

  const ordered = {};
  for (const path of Object.keys(files).sort()) {
    ordered[path] = [files[path], { level: 6, mtime: FIXED_MTIME }];
  }
  mkdirSync(dirname(outPath), { recursive: true });
  const tmp = `${outPath}.new`;
  writeFileSync(tmp, zipSync(ordered));
  renameSync(tmp, outPath);
  const kb = Math.round(statSync(outPath).size / 1e3);
  const count = (k) => picks.reduce((n, p) => n + (p[k]?.length ?? 0), 0);
  const summary = {
    outPath,
    fileCount: Object.keys(files).length,
    kb,
    blocks: count("blocks"),
    items: count("items"),
  };
  if (!quiet) {
    console.log(
      `${outPath}: ${summary.fileCount} files, ${summary.kb} KB; ${summary.blocks} blocks, ${summary.items} items`,
    );
  }
  return summary;
}

function writePicksJson(picksPath, picks) {
  mkdirSync(dirname(picksPath), { recursive: true });
  const tmp = `${picksPath}.new-${process.pid}`;
  writeFileSync(tmp, `${compactJson(picks)}\n`);
  renameSync(tmp, picksPath);
}

export function readPicksJson(cwd) {
  const picksPath = join(cwd, "pack/picks.json");
  if (!existsSync(picksPath)) return [];
  const raw = JSON.parse(readFileSync(picksPath, "utf8"));
  if (!Array.isArray(raw)) throw new Error("pack/picks.json must be a JSON array");
  return raw;
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

/** Validates/builds `picked.zip` before atomically committing multiple pack picks into `pack/picks.json`. */
export function updatePicksBatch(
  cwd,
  groups,
  {
    vaultDir = defaultPacksDir(),
    vanillaJar = defaultVanillaJar(),
    build = true,
    quiet = false,
  } = {},
) {
  const picksPath = join(cwd, "pack/picks.json");
  const picks = readPicksJson(cwd).map((p) => structuredClone(p));
  const added = [];
  for (const g of groups) {
    added.push(...mergePickGroup(picks, g));
  }
  const zipSummary = build
    ? pickBlocks({ cwd, vaultDir, vanillaJar, quiet, picksOverride: picks })
    : null;
  writePicksJson(picksPath, picks);
  return { file: picksPath, picks, added, built: zipSummary };
}

/** Atomically merges picked blocks/items into `pack/picks.json` and rebuilds `picked.zip` unless `build === false`. */
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

/** Removes blocks/items from `pack/picks.json`, prunes empty pack entries, and rebuilds `picked.zip` unless `build === false`. */
export function removePicks(
  cwd,
  {
    jar,
    namespace,
    blocks = [],
    items = [],
    vaultDir = defaultPacksDir(),
    vanillaJar = defaultVanillaJar(),
    build = true,
    quiet = false,
  },
) {
  const picksPath = join(cwd, "pack/picks.json");
  const current = readPicksJson(cwd).map((p) => structuredClone(p));
  const blockSet = new Set(blocks);
  const itemSet = new Set(items);
  const removed = [];

  const next = [];
  for (const p of current) {
    const matchPack = (!jar || p.jar === jar) && (!namespace || p.namespace === namespace);
    if (!matchPack) {
      next.push(p);
      continue;
    }
    if (Array.isArray(p.blocks) && blockSet.size) {
      p.blocks = p.blocks.filter((id) => {
        if (!blockSet.has(id)) return true;
        removed.push(`block:${p.namespace}:${id}`);
        return false;
      });
    }
    if (Array.isArray(p.items) && itemSet.size) {
      p.items = p.items.filter((id) => {
        if (!itemSet.has(id)) return true;
        removed.push(`item:${p.namespace}:${id}`);
        return false;
      });
    }
    if ((p.blocks?.length ?? 0) > 0 || (p.items?.length ?? 0) > 0) {
      next.push(p);
    }
  }

  const zipSummary = build
    ? pickBlocks({ cwd, vaultDir, vanillaJar, quiet, picksOverride: next })
    : null;
  writePicksJson(picksPath, next);
  return { file: picksPath, picks: next, removed, built: zipSummary };
}

if (import.meta.main) {
  cliArgs(
    `Builds assets/public/picked.zip from pack/picks.json and vault/packs, inside a film.
  bun ../../packages/mc-assets/pick.mjs
Each pick: {jar, namespace, blocks: [blockstate ids], items: [item ids], licence, page}; items load with
block-model-renderer's loadModel(group, assets, await resolveModelData(assets, {model: "<ns>:item/<id>", type: "item"}), {display: {}}) (assets = await prepareAssets(sources); parseItemDefinition(assets, "<ns>:<id>") for 1.21.4+ defs).
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
