import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPickedZipBytes, readPicksJson } from "../../mc-assets/pick.mjs";
import {
  loadMcAssetsCatalog,
  matchesMcPackSource,
  readPackCatalog,
} from "../../mc-assets/src/catalog.ts";
import { AssetUsageError, resolvedVaultRoot } from "./placed-lane.mjs";

function readPickedEntriesSet(project) {
  const zipPath = join(project, "assets/public/picked.zip");
  if (!existsSync(zipPath)) return null;
  try {
    return readPackCatalog(readFileSync(zipPath));
  } catch {
    return null;
  }
}

function isEntryInPickedZip(entries, kind, ns, path) {
  if (!entries) return false;
  if (kind === "block") return entries.has(`assets/${ns}/blockstates/${path}.json`);
  if (entries.has(`assets/${ns}/items/${path}.json`)) return true;
  if (entries.has(`assets/${ns}/models/item/${path}.json`)) return true;
  return path.includes("/") && entries.has(`assets/${ns}/models/${path}.json`);
}

function groupCandidatesToPicks(candidates) {
  const groups = new Map();
  for (const c of candidates) {
    const key = `${c.jar}\0${c.ns}`;
    let group = groups.get(key);
    if (!group) {
      group = { jar: c.jar, namespace: c.ns, blocks: [], items: [] };
      groups.set(key, group);
    }
    const list = c.kind === "block" ? group.blocks : group.items;
    if (!list.includes(c.name)) list.push(c.name);
  }
  return [...groups.values()].map((g) => ({
    jar: g.jar,
    namespace: g.namespace,
    ...(g.blocks.length ? { blocks: g.blocks } : {}),
    ...(g.items.length ? { items: g.items } : {}),
  }));
}

/**
 * Resolves any unpicked (or --source-specified) modpack blocks/items read-only from vault/packs
 * into an ephemeral temporary ZIP so `bun run asset preview` can visually inspect candidates
 * before committing to `pack/picks.json` or mutating `assets/public/picked.zip`.
 */
export function stagePreviewPackOverlay(project, items, { source } = {}) {
  if (source !== undefined && (typeof source !== "string" || !source.trim())) {
    throw new AssetUsageError("--source must be a non-empty pack slug, jar, or source name", 2);
  }
  const sourceTrim = source?.trim() || undefined;
  const sourceLower = sourceTrim?.toLowerCase();
  const pickedEntries = sourceTrim ? null : readPickedEntriesSet(project);

  const needed = [];
  for (const item of items) {
    const colon = item.id.indexOf(":");
    const ns = colon >= 0 ? item.id.slice(0, colon) : "minecraft";
    const path = colon >= 0 ? item.id.slice(colon + 1) : item.id;
    if (ns === "gohans") {
      if (sourceLower && sourceLower !== "gohans") {
        throw new AssetUsageError(
          `Built-in ${item.id} is bundled in mc-assets/pack, not --source ${JSON.stringify(sourceTrim)}`,
          2,
        );
      }
      continue;
    }
    if (ns === "minecraft") {
      if (!sourceTrim || sourceLower === "minecraft") continue;
      needed.push({ item, ns, path });
      continue;
    }
    if (!sourceTrim && isEntryInPickedZip(pickedEntries, item.kind, ns, path)) continue;
    needed.push({ item, ns, path });
  }
  if (!needed.length) return { zipPath: null, staged: [], stagingErrors: [] };

  const vaultRoot = resolvedVaultRoot();
  const packsDir = join(vaultRoot, "packs");
  if (!existsSync(packsDir)) {
    if (sourceTrim) {
      throw new AssetUsageError(
        `Vault packs folder not found (${packsDir}); run bun run setup before previewing --source ${JSON.stringify(sourceTrim)}`,
        2,
      );
    }
    return { zipPath: null, staged: [], stagingErrors: [] };
  }

  let manifestPicks = [];
  if (!sourceTrim) {
    try {
      manifestPicks = readPicksJson(project);
    } catch {
      manifestPicks = [];
    }
  }
  const pinnedJarFor = (kind, ns, path) => {
    const field = kind === "block" ? "blocks" : "items";
    const hit = manifestPicks.find(
      (p) => p.namespace === ns && Array.isArray(p[field]) && p[field].includes(path),
    );
    return hit?.jar ?? null;
  };

  let cat = null;
  const getCatalog = () => (cat ??= loadMcAssetsCatalog({ vaultRoot, quiet: true }));
  const candidates = [];

  for (const { item, ns, path } of needed) {
    const lookupName = item.kind === "item" && path.startsWith("item/") ? path.slice(5) : path;
    const pinnedJar = !sourceTrim ? pinnedJarFor(item.kind, ns, lookupName) : null;
    if (pinnedJar && existsSync(join(packsDir, pinnedJar))) {
      candidates.push({
        jar: pinnedJar,
        ns,
        kind: item.kind,
        name: lookupName,
        label: item.label,
      });
      continue;
    }
    const catalog = getCatalog();
    const rawMatches = catalog.items.filter(
      (x) =>
        x.kind === item.kind &&
        x.namespace === ns &&
        x.name === lookupName &&
        x.type !== "vanilla" &&
        Boolean(x.pack) &&
        (!sourceTrim || matchesMcPackSource(sourceTrim, x.pack, x.source)),
    );
    const byPack = [...new Map(rawMatches.map((m) => [m.pack, m])).values()];
    if (byPack.length > 1) {
      throw new AssetUsageError(
        `Ambiguous ${item.label} across packs (${byPack.map((m) => m.pack).join(", ")}); pass --source <pack> to preview one`,
        2,
      );
    }
    if (byPack.length === 0) {
      if (sourceTrim) {
        throw new AssetUsageError(
          `No ${item.kind} "${ns}:${path}" found in --source ${JSON.stringify(sourceTrim)}`,
          2,
        );
      }
      continue;
    }
    candidates.push({
      jar: byPack[0].pack,
      ns,
      kind: item.kind,
      name: lookupName,
      label: item.label,
    });
  }

  if (!candidates.length) return { zipPath: null, staged: [], stagingErrors: [] };

  const vanillaJar = join(vaultRoot, "jar/client_assets.zip");
  let bytes = null;
  let validCandidates = candidates;
  const stagingErrors = [];

  try {
    bytes = buildPickedZipBytes({
      picks: groupCandidatesToPicks(candidates),
      vaultDir: packsDir,
      vanillaJar,
    });
  } catch (batchErr) {
    // Isolate broken vault assets so valid siblings in the same batch still render cleanly
    validCandidates = [];
    if (candidates.length === 1) {
      const c = candidates[0];
      stagingErrors.push({
        id: c.label,
        pack: c.jar,
        error: batchErr instanceof Error ? batchErr.message : String(batchErr),
      });
    } else {
      let singleBytes = null;
      for (const c of candidates) {
        try {
          singleBytes = buildPickedZipBytes({
            picks: groupCandidatesToPicks([c]),
            vaultDir: packsDir,
            vanillaJar,
          });
          validCandidates.push(c);
        } catch (err) {
          stagingErrors.push({
            id: c.label,
            pack: c.jar,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (validCandidates.length === 1) {
        bytes = singleBytes;
      } else if (validCandidates.length > 1) {
        bytes = buildPickedZipBytes({
          picks: groupCandidatesToPicks(validCandidates),
          vaultDir: packsDir,
          vanillaJar,
        });
      }
    }
  }

  if (!bytes) {
    return { zipPath: null, staged: [], stagingErrors };
  }
  const zipPath = join(tmpdir(), `mc-preview-overlay-${process.pid}-${randomUUID()}.zip`);
  writeFileSync(zipPath, bytes, { mode: 0o600, flag: "wx" });
  return {
    zipPath,
    staged: validCandidates.map((c) => ({ id: c.label, pack: c.jar })),
    stagingErrors,
  };
}
