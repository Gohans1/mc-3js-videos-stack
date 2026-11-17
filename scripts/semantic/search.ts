import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Entry } from "../find";
import { ROOT } from "../vault.mjs";
import { assetKey } from "./catalog";
import { createEmbedder, type Embed, hash } from "./model";
import { type Index, openIndex } from "./store";

export const DEFAULT_INDEX = join(ROOT, ".studio", "asset-search.sqlite");
export const fuseRanks = (lexical: string[], semantic: string[], limit = 100): string[] => {
  const scores = new Map<string, number>();
  for (const list of [lexical, semantic])
    [...new Set(list)]
      .slice(0, 100)
      .forEach((key, i) => scores.set(key, (scores.get(key) ?? 0) + 1 / (60 + i + 1)));
  return [...scores]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
};
export const searchIndex = async (
  index: Index,
  query: string,
  eligible: Set<string>,
  options: {
    allowApi: boolean;
    embed?: Embed;
    limit?: number;
  },
) => {
  if (!query.trim() || Buffer.byteLength(query, "utf8") > 2048)
    throw new Error("Search query must be 1-2048 UTF-8 bytes");
  if (!index.ready().some((key) => eligible.has(key)))
    throw new Error(
      "No completed eligible embeddings; prepare selected assets with assets:semantic first",
    );
  const text = `task: search result | query: ${query.trim()}`,
    fingerprint = hash(text);
  let embedded = index.cached("?query", fingerprint);
  if (!embedded) {
    if (!options.allowApi || !options.embed)
      throw new Error(
        "No cached query; --semantic --yes permits a paid OpenRouter query embedding",
      );
    embedded = await options.embed([{ type: "text", text }]);
    index.put("?query", fingerprint, embedded);
  }
  return index.search(embedded.vector, eligible, options.limit ?? 100);
};
export const hybridSearch = async (
  query: string,
  pool: Entry[],
  lexical: Entry[],
  options: {
    allowApi: boolean;
    file?: string;
    dimensions?: number;
    limit?: number;
  },
) => {
  const file = options.file ?? DEFAULT_INDEX;
  if (!existsSync(file))
    throw new Error(
      "No semantic index yet; assets:semantic plan previews preparation without requests",
    );
  const index = openIndex(file, options.dimensions ?? 768);
  try {
    const byKey = new Map(pool.map((entry) => [assetKey(entry), entry]));
    const hits = await searchIndex(index, query, new Set(byKey.keys()), {
      allowApi: options.allowApi,
      ...(options.allowApi && {
        embed: (parts, signal) =>
          createEmbedder({
            apiKey: process.env.OPENROUTER_API_KEY ?? "",
            dimensions: options.dimensions ?? 768,
          })(parts, signal),
      }),
    });
    return fuseRanks(
      lexical.map(assetKey),
      hits.map((hit) => hit.key),
      options.limit,
    ).flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : []));
  } finally {
    index.close();
  }
};
