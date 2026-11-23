import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectItemDefModels,
  type McAssetItem,
  readPackCatalog,
  zipJsonReader,
} from "./catalog.ts";
import { type ModelBounds, modelBounds, type ModelJsonLike } from "./model-bounds.ts";
import { isMcPackFilename } from "./picks-manifest.ts";

const DEFAULT_GOHANS_PACK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../pack/assets/gohans",
);

interface BlockstateApplyLike {
  model: string;
  x?: number;
  y?: number;
  z?: number;
}

const readFileBytes = (filePath: string): Uint8Array => {
  const b = readFileSync(filePath);
  return new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
};

const firstApplyEntries = (raw: unknown): BlockstateApplyLike[] => {
  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (!entry || typeof entry !== "object") return [];
  const rec = entry as Record<string, unknown>;
  if (typeof rec.model !== "string" || !rec.model) return [];
  return [
    {
      model: rec.model,
      ...(typeof rec.x === "number" ? { x: rec.x } : {}),
      ...(typeof rec.y === "number" ? { y: rec.y } : {}),
      ...(typeof rec.z === "number" ? { z: rec.z } : {}),
    },
  ];
};

const unionBounds = (list: ModelBounds[]): ModelBounds | null => {
  if (!list.length) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of list) {
    for (let i = 0; i < 3; i += 1) {
      if (b.min[i]! < min[i]!) min[i] = b.min[i]!;
      if (b.max[i]! > max[i]!) max[i] = b.max[i]!;
    }
  }
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
};

export function resolveMcAssetBounds(
  item: Pick<McAssetItem, "kind" | "namespace" | "name" | "pack">,
  options?: { vaultRoot?: string; gohansPackDir?: string },
): ModelBounds | null {
  if (item.kind !== "block" && item.kind !== "item") return null;
  if (
    !item.namespace ||
    !item.name ||
    item.namespace.includes("..") ||
    item.namespace.includes("/") ||
    item.namespace.includes("\\") ||
    item.name.includes("..") ||
    item.name.includes("\\")
  )
    return null;
  if (item.pack && !isMcPackFilename(item.pack)) return null;

  const vaultRoot = options?.vaultRoot;
  const gohansDir = options?.gohansPackDir ?? DEFAULT_GOHANS_PACK;
  const zipReaders = new Map<string, ((path: string) => unknown) | null>();

  const readFromZip = (zipAbs: string, relPath: string): unknown => {
    let reader = zipReaders.get(zipAbs);
    if (reader === undefined) {
      if (!existsSync(zipAbs)) {
        reader = null;
      } else {
        try {
          const buf = readFileBytes(zipAbs);
          reader = zipJsonReader(buf, readPackCatalog(buf));
        } catch {
          reader = null;
        }
      }
      zipReaders.set(zipAbs, reader);
    }
    return reader ? reader(relPath) : undefined;
  };

  const packZipAbs = vaultRoot && item.pack ? join(vaultRoot, "packs", item.pack) : null;
  const vanillaZipAbs = vaultRoot ? join(vaultRoot, "jar/client_assets.zip") : null;

  const readJson = (relPath: string): unknown => {
    if (!relPath || relPath.includes("..") || relPath.includes("\\") || relPath.startsWith("/"))
      return null;
    if (packZipAbs) {
      const hit = readFromZip(packZipAbs, relPath);
      if (hit !== undefined) return hit;
    }
    if (relPath.startsWith("assets/gohans/")) {
      const sub = relPath.slice("assets/gohans/".length);
      const abs = join(gohansDir, sub);
      if (existsSync(abs)) {
        try {
          return JSON.parse(readFileSync(abs, "utf8"));
        } catch {
          return null;
        }
      }
    }
    if (vanillaZipAbs) {
      const hit = readFromZip(vanillaZipAbs, relPath);
      if (hit !== undefined) return hit;
    }
    return null;
  };

  const resolveModel = (path: string): ModelJsonLike | null => {
    const raw = readJson(path);
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as ModelJsonLike) : null;
  };

  if (item.kind === "block") {
    const state = readJson(`assets/${item.namespace}/blockstates/${item.name}.json`) as Record<
      string,
      unknown
    > | null;
    const parts: BlockstateApplyLike[] = [];
    if (state?.variants && typeof state.variants === "object" && !Array.isArray(state.variants)) {
      const variants = state.variants as Record<string, unknown>;
      const chosen = Object.hasOwn(variants, "")
        ? variants[""]
        : variants[Object.keys(variants)[0] ?? ""];
      parts.push(...firstApplyEntries(chosen));
    } else if (Array.isArray(state?.multipart)) {
      const mp = state.multipart as { when?: unknown; apply?: unknown }[];
      const unconditional = mp.filter((p) => !p?.when);
      const chosenParts = unconditional.length ? unconditional : mp.slice(0, 1);
      for (const p of chosenParts) parts.push(...firstApplyEntries(p?.apply));
    } else {
      parts.push({ model: `${item.namespace}:block/${item.name}` });
    }
    const boxes: ModelBounds[] = [];
    for (const part of parts) {
      const b = modelBounds(resolveModel, part.model, {
        x: part.x,
        y: part.y,
        z: part.z,
      });
      if (b) boxes.push(b);
    }
    return unionBounds(boxes);
  }

  const def = readJson(`assets/${item.namespace}/items/${item.name}.json`);
  const candidates = [...new Set(collectItemDefModels(def))];
  if (!candidates.length) candidates.push(`${item.namespace}:item/${item.name}`);
  for (const ref of candidates) {
    const b = modelBounds(resolveModel, ref);
    if (b) return b;
  }
  return null;
}
