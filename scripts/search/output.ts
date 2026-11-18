import type { Entry } from "../find";
import { assetFile, assetKey } from "../semantic/catalog";
import type { OpenFilmResult } from "./openfilm";

export const displayAbout = (about: string) => {
  const seen = new Set<string>();
  return about
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const key = part.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("; ");
};

export const dualSearchOutput = (
  query: string,
  keyword: Entry[],
  semantic: OpenFilmResult,
  options: {
    limit: number;
    offset?: number;
    nextPage?: string;
    json: boolean;
    notes: string[];
    foreign: boolean;
    line: (entry: Entry) => string;
    where: (entries: Entry[]) => string[];
  },
) => {
  const offset = options.offset ?? 0;
  const words = keyword.slice(offset, offset + options.limit),
    hits = semantic.hits.slice(offset, offset + options.limit);
  const wordKeys = new Set(words.map(assetKey));
  const notes = [
    ...options.notes,
    ...semantic.notes,
    ...(options.foreign
      ? ["BM25 searches English only; translate to include Minecraft and other local-only assets."]
      : []),
  ];
  const summary = (entry: Entry, rank: number) => {
    const { data, ...fields } = entry;
    return {
      key: assetKey(entry),
      rank,
      ...fields,
      about: displayAbout(entry.about),
      file: assetFile(entry) || undefined,
      license: typeof data?.license === "string" ? data.license : undefined,
    };
  };
  if (options.json)
    return JSON.stringify(
      {
        schemaVersion: 2,
        mode: semantic.categories.length
          ? semantic.notes.length && !hits.length
            ? "keyword-fallback"
            : "dual"
          : "keyword",
        query,
        notes,
        keyword: {
          scope: "filtered catalog",
          total: keyword.length,
          results: words.map((entry, i) => summary(entry, offset + i + 1)),
        },
        semantic: {
          scope: "openfilm",
          categories: semantic.categories,
          scoreMeaning: "similarity, not confidence; listen/view before choosing",
          results: hits.map(({ entry, score }, i) => ({
            ...(wordKeys.has(assetKey(entry))
              ? { key: assetKey(entry), rank: offset + i + 1 }
              : summary(entry, offset + i + 1)),
            similarity: score,
            alsoKeyword: wordKeys.has(assetKey(entry)),
          })),
        },
      },
      null,
      2,
    );
  return [
    `BM25 — catalog keywords: ${words.length ? `entries ${offset + 1}-${offset + words.length}` : `0 entries at offset ${offset}`} of ${keyword.length} matches`,
    ...(words.length
      ? words.map(options.line)
      : ["No keyword matches; this does not establish that the asset is absent."]),
    "",
    `OpenFilm semantic — ${hits.length} nearest candidates; similarity is not confidence`,
    ...hits.map(
      ({ entry }) => options.line(entry) + (wordKeys.has(assetKey(entry)) ? "  (also BM25)" : ""),
    ),
    ...(!hits.length
      ? [
          semantic.categories.length
            ? "No semantic candidates available for these filters."
            : "No OpenFilm assets within these filters; service not called.",
        ]
      : []),
    ...options.where([...words, ...hits.map((hit) => hit.entry)]),
    ...notes.map((note) => `note: ${note}`),
    ...(options.nextPage && Math.max(keyword.length, semantic.hits.length) > offset + options.limit
      ? [`next page: ${options.nextPage}`]
      : []),
    "next: bun run find --show <id> for file, license, settings and usage. Listen/view before choosing; --offline reads saved searches without network.",
  ].join("\n");
};
