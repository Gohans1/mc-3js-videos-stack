import { existsSync } from "node:fs";

import type { Entry } from "../find";
import { openBudget } from "./budget";
import { assetKey } from "./catalog";
import { configuredProvider, createEmbedder, type Embed, hash } from "./model";
import { semanticSettings } from "./settings";
import { type Index, openIndex } from "./store";

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
      throw new Error("No cached query; --semantic --yes permits an external query embedding");
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
    provider?: string;
    limit?: number;
  },
) => {
  const settings = semanticSettings();
  const file = options.file ?? settings.db;
  if (!existsSync(file))
    throw new Error(
      "No semantic index yet; assets:semantic plan previews preparation without requests",
    );
  const index = openIndex(file, options.dimensions ?? 768);
  let budget: ReturnType<typeof openBudget> | undefined;
  try {
    const byKey = new Map(pool.map((entry) => [assetKey(entry), entry]));
    const hits = await searchIndex(index, query, new Set(byKey.keys()), {
      allowApi: options.allowApi,
      ...(options.allowApi && {
        embed: (parts, signal) =>
          createEmbedder({
            ...configuredProvider(options.provider),
            dimensions: options.dimensions ?? 768,
            beforeRequest: () => {
              budget ??= openBudget(settings.quotaDb, settings.dailyLimit);
              budget.reserve();
            },
          })(parts, signal),
      }),
    });
    const semanticByKey = new Map(hits.map((hit) => [hit.key, hit]));
    return fuseRanks(
      lexical.map(assetKey),
      hits.map((hit) => hit.key),
      options.limit,
    ).flatMap((key) => {
      const entry = byKey.get(key);
      if (!entry) return [];
      const hit = semanticByKey.get(key);
      if (!hit) return [entry];
      const result: Entry = {
        ...entry,
        semantic: {
          score: hit.score,
          part: hit.part,
          input: index.get(key)?.asset.media?.kind ?? "text",
          ...(hit.segment && { segment: hit.segment }),
        },
      };
      return [result];
    });
  } finally {
    budget?.close();
    index.close();
  }
};
