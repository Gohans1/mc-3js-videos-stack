import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { Entry } from "../find";
import { ROOT } from "../vault.mjs";

export type OpenFilmHit = { entry: Entry; score: number };
export type OpenFilmResult = { hits: OpenFilmHit[]; categories: string[]; notes: string[] };
export type OpenFilmLookup = (
  query: string,
  pool: Entry[],
  options?: Options,
) => Promise<OpenFilmResult>;
export type SearchFetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
type Options = { cache?: string; offline?: boolean; fetch?: SearchFetch };
const CATEGORIES = new Set(["transition", "effect", "text", "sticker", "filter", "template"]);
export const openFilmCategory = (entry: Entry): string | undefined => {
  if (entry.src !== "openfilm" || typeof entry.data?.upstreamId !== "string") return;
  if (entry.kind === "sfx") return "sound";
  if (entry.kind === "bgm") return "music";
  if (entry.kind === "asset" && CATEGORIES.has(entry.cat)) return entry.cat;
};
const decode = (data: unknown): [string, number][] => {
  const found = (data as { found?: unknown } | null)?.found;
  if (
    !Array.isArray(found) ||
    found.length > 50 ||
    !found.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 2 &&
        typeof row[0] === "string" &&
        row[0].length <= 1024 &&
        typeof row[1] === "number" &&
        Number.isFinite(row[1]) &&
        Math.abs(row[1]) <= 1,
    )
  )
    throw new Error("invalid search response");
  return found as [string, number][];
};
const readResponse = async (response: Response) => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("empty search response");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 65536) throw new Error("search response exceeds 64 KB");
      chunks.push(part.value);
    }
    return decode(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally {
    await reader.cancel().catch(() => {});
  }
};

export const openFilmSearch = async (
  query: string,
  pool: Entry[],
  options: Options = {},
): Promise<OpenFilmResult> => {
  const categories = [...new Set(pool.flatMap((entry) => openFilmCategory(entry) ?? []))].sort();
  const result: OpenFilmResult = { hits: [], categories, notes: [] };
  if (!categories.length) return result;
  if (!query.trim() || Buffer.byteLength(query, "utf8") > 2048)
    return { ...result, notes: ["OpenFilm skipped: query needs 1–2048 UTF-8 bytes"] };
  const file =
    options.cache ?? resolve(ROOT, process.env.MC_FIND_CACHE || ".studio/openfilm-search.sqlite");
  const offline = options.offline ?? process.env.MC_FIND_OFFLINE === "1";
  if (offline && !existsSync(file))
    return { ...result, notes: ["OpenFilm offline: no search cache"] };
  let db: Database | undefined;
  try {
    mkdirSync(dirname(file), { recursive: true });
    db = new Database(file, { create: true });
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    if (tables.some((table) => table.name !== "search_cache"))
      throw new Error("choose a separate OpenFilm search cache database");
    db.run(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS search_cache(key TEXT PRIMARY KEY, at INTEGER NOT NULL, result TEXT NOT NULL)",
    );
    const endpoint = new URL(
      "v1/library/search",
      `${(process.env.OPENFILM_API_URL || "https://openfilm.dev").replace(/\/+$/, "")}/`,
    ).href;
    const byCategory = new Map<string, OpenFilmHit[]>();
    const problems = new Map<string, string>();
    const load = async (cat: string) => {
      try {
        const key = JSON.stringify([endpoint, query, cat, 50]);
        const saved = db!.query("SELECT at,result FROM search_cache WHERE key=?").get(key) as {
          at: number;
          result: string;
        } | null;
        let found: [string, number][];
        if (saved && Date.now() - saved.at < 86400000) found = decode(JSON.parse(saved.result));
        else {
          if (offline) throw new Error("offline cache miss");
          found = await readResponse(
            await (options.fetch ?? fetch)(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: query, cat, limit: 50 }),
              signal: AbortSignal.timeout(2500),
            }),
          );
          db!
            .query("INSERT OR REPLACE INTO search_cache VALUES (?,?,?)")
            .run(key, Date.now(), JSON.stringify({ found }));
        }
        const eligible = new Map(
          pool
            .filter((entry) => openFilmCategory(entry) === cat)
            .map((entry) => [entry.data!.upstreamId as string, entry]),
        );
        const seen = new Set<string>();
        byCategory.set(
          cat,
          found.flatMap(([id, score]) => {
            const entry = eligible.get(id);
            if (!entry || seen.has(id)) return [];
            seen.add(id);
            return [{ entry, score }];
          }),
        );
      } catch (error) {
        problems.set(cat, error instanceof Error ? error.message : "search failed");
      }
    };
    for (let i = 0; i < categories.length; i += 2)
      await Promise.all(categories.slice(i, i + 2).map(load));
    // Category scores share one embedding model; arrival order must not rank sound above music.
    result.hits = categories.flatMap((cat) => byCategory.get(cat) ?? []);
    if (categories.length > 1) result.hits.sort((a, b) => b.score - a.score);
    result.notes = categories.flatMap((cat) =>
      problems.has(cat) ? [`OpenFilm ${cat}: ${problems.get(cat)}; keyword results retained`] : [],
    );
  } catch (error) {
    result.notes.push(
      `OpenFilm unavailable: ${error instanceof Error ? error.message : "search failed"}; keyword results retained`,
    );
  } finally {
    db?.close();
  }
  return result;
};
