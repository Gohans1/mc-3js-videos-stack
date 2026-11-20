import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_PREVIEW_OUT,
  DEFAULT_PREVIEW_SIZE,
  MAX_PREVIEW_ITEMS,
  normalizePreviewEntry,
  parsePreviewResultFromLog,
  PREVIEW_JSON_PREFIX,
  validatePreviewLimit,
  validatePreviewOut,
  validatePreviewSize,
} from "./asset-preview-pure.mjs";

export {
  DEFAULT_PREVIEW_OUT,
  DEFAULT_PREVIEW_SIZE,
  MAX_PREVIEW_ITEMS,
  normalizePreviewEntry,
  parsePreviewResultFromLog,
  PREVIEW_JSON_PREFIX,
  validatePreviewLimit,
  validatePreviewOut,
  validatePreviewSize,
};

export class PreviewDataError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreviewDataError";
  }
}

export function readPickedPreviewEntries(projectDir, kindFilter) {
  const picksPath = join(projectDir, "pack", "picks.json");
  if (!existsSync(picksPath)) {
    throw new Error(
      "pack/picks.json not found; pass explicit block:/item: IDs (e.g. bun run asset preview block:minecraft:oak_stairs --film ...) or pick assets first",
    );
  }
  let rows;
  try {
    rows = JSON.parse(readFileSync(picksPath, "utf8"));
  } catch (err) {
    throw new PreviewDataError(
      `Cannot read pack/picks.json: ${err instanceof Error ? err.message : err}`,
    );
  }
  if (!Array.isArray(rows)) {
    throw new PreviewDataError("pack/picks.json must be a JSON array");
  }
  const seen = new Set();
  const entries = [];
  const push = (kind, ns, itemId) => {
    const entry = normalizePreviewEntry(`${kind}:${ns}:${itemId}`, kind);
    if (seen.has(entry.label)) return;
    seen.add(entry.label);
    entries.push(entry);
  };
  for (const [idx, row] of rows.entries()) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.namespace !== "string" ||
      !row.namespace.trim()
    ) {
      throw new PreviewDataError(
        `pack/picks.json entry ${idx + 1}: expected a non-empty namespace`,
      );
    }
    const ns = row.namespace.trim();
    if (kindFilter !== "item" && row.blocks !== undefined) {
      if (!Array.isArray(row.blocks)) {
        throw new PreviewDataError(`pack/picks.json entry ${idx + 1}: blocks must be an array`);
      }
      for (const b of row.blocks) {
        if (typeof b !== "string" || !b.trim()) {
          throw new PreviewDataError(`pack/picks.json entry ${idx + 1}: invalid block ID`);
        }
        try {
          push("block", ns, b.trim());
        } catch (err) {
          throw new PreviewDataError(
            `pack/picks.json entry ${idx + 1}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }
    if (kindFilter !== "block" && row.items !== undefined) {
      if (!Array.isArray(row.items)) {
        throw new PreviewDataError(`pack/picks.json entry ${idx + 1}: items must be an array`);
      }
      for (const it of row.items) {
        if (typeof it !== "string" || !it.trim()) {
          throw new PreviewDataError(`pack/picks.json entry ${idx + 1}: invalid item ID`);
        }
        try {
          push("item", ns, it.trim());
        } catch (err) {
          throw new PreviewDataError(
            `pack/picks.json entry ${idx + 1}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }
  }
  if (!entries.length) {
    throw new Error(
      `pack/picks.json has no picked ${kindFilter ? `${kindFilter}s` : "blocks or items"}; pass explicit block:/item: IDs or run bun run asset pick first`,
    );
  }
  return entries;
}

export function resolvePreviewSpec({
  projectDir,
  rawIds = [],
  kind,
  out,
  size,
  noScale = false,
  limit,
}) {
  const kindLower =
    kind !== undefined && kind !== null ? String(kind).trim().toLowerCase() : undefined;
  if (kindLower !== undefined && kindLower !== "block" && kindLower !== "item") {
    throw new Error(`asset preview --kind accepts block or item, got ${JSON.stringify(kind)}`);
  }
  const validatedOut = validatePreviewOut(out);
  const validatedSize = validatePreviewSize(size);
  const validatedLimit = validatePreviewLimit(limit);

  const tokens = rawIds
    .flatMap((token) => String(token).split(","))
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawIds.length > 0 && tokens.length === 0) {
    throw new Error("preview received empty asset IDs; pass valid block:/item: IDs or omit IDs");
  }

  let allItems;
  let source;
  if (tokens.length > 0) {
    source = "args";
    const seen = new Set();
    allItems = [];
    for (const token of tokens) {
      const entry = normalizePreviewEntry(token, kindLower);
      if (seen.has(entry.label)) continue;
      seen.add(entry.label);
      allItems.push(entry);
    }
  } else {
    source = "picks";
    allItems = readPickedPreviewEntries(projectDir, kindLower);
  }

  const items = allItems.slice(0, validatedLimit);
  return {
    source,
    items,
    totalAvailable: allItems.length,
    truncated: Math.max(0, allItems.length - items.length),
    out: validatedOut,
    size: validatedSize,
    showScale: !noScale,
  };
}
