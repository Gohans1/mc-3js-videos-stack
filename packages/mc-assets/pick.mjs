// Cherry-picks blocks from vetted mod packs in vault/packs into the film's assets/public/picked.zip (Bun counterpart to pick.py).
// Can be imported as pickBlocks({ cwd, vaultDir }) or run directly inside a film folder: bun ../../packages/mc-assets/pick.mjs
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const DEFAULT_VAULT = resolve(dirname(fileURLToPath(import.meta.url)), "../../vault/packs");
const FIXED_MTIME = new Date(2026, 0, 1, 0, 0, 0);

const ref = (ns, r, kind) => {
  const colon = r.indexOf(":");
  const space = colon >= 0 ? r.slice(0, colon) : "minecraft";
  const name = colon >= 0 ? r.slice(colon + 1) : r;
  if (space === "minecraft") return null;
  return `assets/${space}/${kind}/${name}${kind === "models" ? ".json" : ".png"}`;
};

export function pickBlocks({ cwd = process.cwd(), vaultDir = DEFAULT_VAULT } = {}) {
  const picksPath = join(cwd, "pack/picks.json");
  const outPath = join(cwd, "assets/public/picked.zip");
  const picks = JSON.parse(readFileSync(picksPath, "utf8"));
  const files = {};

  for (const pick of picks) {
    const { jar, namespace: ns, blocks: ids } = pick;
    const entries = unzipSync(readFileSync(join(vaultDir, jar)), {
      filter: (f) => f.name.startsWith("assets/") && !f.name.endsWith("/"),
    });

    const take = (path) => {
      if (path in files) return true;
      if (!(path in entries)) return false;
      files[path] = entries[path];
      if (path.endsWith(".png") && `${path}.mcmeta` in entries) {
        files[`${path}.mcmeta`] = entries[`${path}.mcmeta`];
      }
      return true;
    };

    const model = (path) => {
      if (!path || path in files || !take(path)) return;
      const m = JSON.parse(strFromU8(files[path]));
      if (m.parent) model(ref(ns, m.parent, "models"));
      for (const t of Object.values(m.textures ?? {})) {
        if (typeof t === "string" && !t.startsWith("#")) {
          const tp = ref(ns, t, "textures");
          if (tp && !take(tp)) throw new Error(`${jar}: texture ${t} missing (${tp})`);
        }
      }
    };

    for (const id of ids) {
      const state = `assets/${ns}/blockstates/${id}.json`;
      if (!take(state)) throw new Error(`${jar}: no blockstate ${state}`);
      const s = JSON.parse(strFromU8(files[state]));
      const groups = [
        ...Object.values(s.variants ?? {}),
        ...(s.multipart ?? []).map((p) => p.apply),
      ];
      for (const v of groups) {
        for (const one of Array.isArray(v) ? v : [v]) {
          model(ref(ns, one.model, "models"));
        }
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
  const totalBlocks = picks.reduce((n, p) => n + p.blocks.length, 0);
  console.log(`${outPath}: ${Object.keys(files).length} files, ${kb} KB; ${totalBlocks} blocks`);
}

if (import.meta.main) {
  try {
    pickBlocks();
  } catch (e) {
    console.error(e.message ?? e);
    process.exit(1);
  }
}
