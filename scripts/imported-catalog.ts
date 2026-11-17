import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Entry } from "./find";

export const importedEntries = (file: string): Entry[] => {
  if (!existsSync(file)) return [];
  const rows: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`Imported catalog must be an array: ${file}`);
  return rows.map((row: unknown, i) => {
    if (
      !row ||
      typeof row !== "object" ||
      !["kind", "id", "cat", "title", "about"].every(
        (k) => typeof (row as Record<string, unknown>)[k] === "string",
      )
    )
      throw new Error(`Invalid imported catalog row ${i}: ${file}`);
    const entry = row as Entry;
    if (entry.data && (typeof entry.data !== "object" || Array.isArray(entry.data)))
      throw new Error(`Invalid imported catalog row ${i} data: ${file}`);
    const data = { ...entry.data };
    if (typeof data.file === "string") data.file = resolve(dirname(file), data.file);
    if (typeof data.upstreamId === "string") {
      const folder = resolve(dirname(file), "library", data.upstreamId);
      const preview = [join(folder, "preview.mp4"), join(folder, "poster.jpg")].find(existsSync);
      if (preview) data.preview = preview;
    }
    return { ...entry, data };
  });
};
