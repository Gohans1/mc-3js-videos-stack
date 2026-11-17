import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { cliArgs, numberArg } from "../../../packages/live-studio/src/cli.mjs";
import { favoriteLists } from "../../../packages/live-studio/src/favorites.mjs";
import {
  allEntries,
  defaultSearchEntry,
  type Entry,
  keywordSearch,
  kindFilter,
  run,
} from "../../find";
import { type OpenFilmLookup, openFilmSearch, type SearchFetch } from "../../search/openfilm";
import { assetKey } from "../../semantic/catalog";
import { parseEvalCases, retrievalMetrics } from "../../semantic/evaluate";
import { ROOT } from "../../vault.mjs";

const HELP = `Usage: bun run eval:find --mode dual [--live] [--out report.json] [--max-seconds 600] [--max-requests 1000]
Checks the real find CLI's independent BM25/OpenFilm blocks; never calls Jev or embedding providers.
Defaults to cached-only searches. --live permits bounded OpenFilm text queries, saved after each response.
Uses existing 400-target known-item and 28-query scene-pilot judgments, folded to current catalog families.
Reports each branch at 10, combined exposure across two blocks (up to 24 slots), keyword order retention,
filter leakage, missing targets/cache, latency and kind/language groups. Metadata labels are not listening judgments.
--out preserves completed reports; incomplete reports resume using their .jsonl checkpoint and the same catalog/cases;
failed or uncached rows retry. Each run stops within --max-seconds (1–3600); --max-requests is 1–5000.
Cache: MC_FIND_CACHE or .studio/openfilm-search.sqlite. Catalog: MC_VAULT_ROOT/MC_VAULT_EXTERNAL.
--plan prints corpus/case counts without queries or writes. Reports and cache remain local; no asset uploads.`;
type Case = ReturnType<typeof parseEvalCases>["cases"][number];
type SearchRow = { key: string; src?: string };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const evaluateDualCase = async (item: Case, entries: Entry[], lookup: OpenFilmLookup) => {
  const pool = entries.filter(defaultSearchEntry);
  const eligible = item.kind ? pool.filter(kindFilter([item.kind], pool).test) : pool;
  const expected = keywordSearch(eligible, item.query, item.kind ? [item.kind] : undefined)
    .matches.slice(0, 12)
    .map(assetKey);
  const start = performance.now();
  const result = JSON.parse(
    await run(
      [item.query, "--json", "-n", "12", ...(item.kind ? ["--kind", item.kind] : [])],
      entries,
      async () => {
        throw new Error("Jev must not run in dual evaluation");
      },
      undefined,
      favoriteLists(join(ROOT, ".studio/evals/no-favorites")),
      lookup,
    ),
  );
  const keyword = result.keyword.results.map((entry: SearchRow) => entry.key) as string[];
  const semantic = result.semantic.results.map((entry: SearchRow) => entry.key) as string[];
  const allowed = new Set(eligible.map(assetKey));
  const union = new Set([...keyword, ...semantic]);
  return {
    ...item,
    milliseconds: performance.now() - start,
    notes: result.notes as string[],
    missingCatalog: item.relevant.filter((key) => !allowed.has(key)),
    keywordUnchanged: JSON.stringify(keyword) === JSON.stringify(expected),
    leaked: [...keyword, ...semantic].filter((key) => !allowed.has(key)),
    keyword: retrievalMetrics(keyword, item.relevant),
    semantic: retrievalMetrics(semantic, item.relevant),
    unionHit: item.relevant.some((key) => union.has(key)),
    newCandidates: semantic.filter((key) => !keyword.includes(key)).length,
    top: { keyword, semantic },
  };
};
type Row = Awaited<ReturnType<typeof evaluateDualCase>>;
export const validateContinuation = (previous: unknown, fingerprint: string) => {
  const saved = previous as { complete?: unknown; fingerprint?: unknown } | null;
  if (saved?.complete !== false)
    throw new Error("Existing report is complete or unrecognized; choose a new --out");
  if (saved.fingerprint !== fingerprint)
    throw new Error("Report catalog/cases changed; choose a different --out");
};
export const readCheckpoint = (file: string, fingerprint: string): Row[] => {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const end = text.lastIndexOf("\n") + 1;
  if (!end) throw new Error("Incomplete checkpoint header; choose a new --out");
  const lines = text.slice(0, end).trimEnd().split("\n");
  if (JSON.parse(lines[0]!).fingerprint !== fingerprint)
    throw new Error("Checkpoint catalog/cases changed; choose a new --out");
  const rows = lines.slice(1).map((line) => JSON.parse(line) as Row);
  if (end < text.length) truncateSync(file, Buffer.byteLength(text.slice(0, end), "utf8"));
  return rows;
};
const summarize = (rows: Row[]) => {
  const average = (fn: (row: Row) => number) =>
    rows.length ? rows.reduce((sum, row) => sum + fn(row), 0) / rows.length : null;
  const times = rows.map((row) => row.milliseconds).sort((a, b) => a - b);
  const branch = (name: "keyword" | "semantic") =>
    Object.fromEntries(
      ["hit1", "hit5", "hit10", "mrr10", "recall10", "ndcg10"].map((key) => [
        key,
        average((row) => row[name][key as keyof Row["keyword"]]),
      ]),
    );
  return {
    cases: rows.length,
    uniqueTargets: new Set(rows.flatMap((row) => row.relevant)).size,
    keywordUnchanged: rows.filter((row) => row.keywordUnchanged).length,
    filterLeaks: rows.reduce((sum, row) => sum + row.leaked.length, 0),
    unavailable: rows.filter((row) => row.notes.some((note) => note.startsWith("OpenFilm"))).length,
    missingTargets: rows.filter((row) => row.missingCatalog.length).length,
    keyword: branch("keyword"),
    semantic: branch("semantic"),
    unionHit: average((row) => Number(row.unionHit)),
    meanNewCandidates: average((row) => row.newCandidates),
    latencyMs: {
      p50: times[Math.ceil(times.length * 0.5) - 1] ?? null,
      p95: times[Math.ceil(times.length * 0.95) - 1] ?? null,
    },
  };
};

export const runDualEval = async (argv: string[]) => {
  const args = cliArgs(
    HELP,
    ["--mode NAME", "--live", "--out PATH", "--max-seconds N", "--max-requests N", "--plan"],
    0,
    argv,
  ) as string[];
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const maxSeconds = numberArg("--max-seconds", flag("--max-seconds") ?? "600", {
    min: 1,
    max: 3600,
  });
  const maxRequests = numberArg("--max-requests", flag("--max-requests") ?? "1000", {
    min: 1,
    max: 5000,
    int: true,
  });
  const entries = allEntries(true),
    unfolded = allEntries(false);
  const aliases = new Map(entries.map((entry) => [assetKey(entry), assetKey(entry)]));
  for (const entry of entries)
    for (const take of Array.isArray(entry.data?.takes) ? entry.data.takes : [])
      if (typeof take === "string") aliases.set(assetKey({ ...entry, id: take }), assetKey(entry));
  const catalog = new Map(unfolded.map((entry) => [assetKey(entry), entry]));
  const sets = ["known-item.json", "scenes-pilot.json"].map((name) =>
    parseEvalCases(JSON.parse(readFileSync(join(ROOT, "scripts/evals/semantic", name), "utf8"))),
  );
  const cases: Case[] = sets.flatMap((set, i) =>
    set.cases.map((item) => {
      const target = catalog.get(item.relevant[0]!);
      const kind =
        target && ["mc", "sfx", "bgm"].includes(target.kind)
          ? "sound"
          : target?.kind === "asset"
            ? `asset/${target.cat}`
            : (target?.kind ?? item.kind);
      return {
        ...item,
        source: undefined,
        kind,
        group: `${i ? "scene-pilot" : "known-item"}/${target?.kind ?? "missing"}`,
        relevant: [...new Set(item.relevant.map((key) => aliases.get(key) ?? key))],
      };
    }),
  );
  const fingerprint = hash([entries, cases]);
  const plan = {
    fingerprint,
    catalog: { folded: entries.length, unfolded: unfolded.length },
    cases: cases.length,
    labelMethods: sets.map((set) => set.labelMethod),
    uniqueTargets: new Set(cases.flatMap((item) => item.relevant)).size,
  };
  if (args.includes("--plan")) {
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  const out = resolve(flag("--out") ?? join(ROOT, `.studio/evals/dual-${Date.now()}.json`));
  if (existsSync(out)) validateContinuation(JSON.parse(readFileSync(out, "utf8")), fingerprint);
  mkdirSync(dirname(out), { recursive: true });
  const checkpoint = `${out}.jsonl`;
  const saved = readCheckpoint(checkpoint, fingerprint);
  if (!existsSync(checkpoint)) appendFileSync(checkpoint, `${JSON.stringify({ fingerprint })}\n`);
  const done = new Map<string, Row>(saved.map((row) => [row.id, row]));
  const resumedCases = done.size;
  let requests = 0;
  const started = Date.now();
  const budgetedFetch: SearchFetch = async (input, init) => {
    if (requests >= maxRequests || Date.now() - started >= maxSeconds * 1000)
      throw new Error("evaluation request/time limit reached");
    requests++;
    return fetch(input, init);
  };
  const lookup: OpenFilmLookup = (query, pool) =>
    openFilmSearch(query, pool, { offline: !args.includes("--live"), fetch: budgetedFetch });
  for (const item of cases) {
    const previous = done.get(item.id);
    if (previous && !previous.notes.some((note) => note.startsWith("OpenFilm"))) continue;
    if (Date.now() - started >= maxSeconds * 1000) break;
    const row = await evaluateDualCase(item, entries, lookup);
    appendFileSync(checkpoint, `${JSON.stringify(row)}\n`);
    done.set(item.id, row);
    if (done.size % 25 === 0)
      console.error(
        `dual eval: ${done.size}/${cases.length}; ${requests} OpenFilm requests; progress saved`,
      );
  }
  const rows = cases.flatMap((item) => done.get(item.id) ?? []);
  const complete =
    rows.length === cases.length &&
    rows.every(
      (row) => !row.missingCatalog.length && !row.notes.some((note) => note.startsWith("OpenFilm")),
    );
  const grouped = (key: "group" | "language") =>
    Object.fromEntries(
      [...new Set(rows.map((row) => row[key]))].map((value) => [
        value ?? "unknown",
        summarize(rows.filter((row) => row[key] === value)),
      ]),
    );
  const report = {
    ...plan,
    at: new Date().toISOString(),
    complete,
    lookup: args.includes("--live") ? "live-or-cache" : "cache-only",
    requestsThisRun: requests,
    resumedCases,
    jevRequests: 0,
    embeddingRequests: 0,
    summary: summarize(rows),
    byGroup: grouped("group"),
    byLanguage: grouped("language"),
    notes: [
      "Catalog-label diagnostics, not blind listening/viewing relevance. Unjudged alternatives can be valid.",
      "Two independent blocks have up to 12 slots each; union exposure uses up to 24, not a fused top12 ranking.",
      "Scene language pairs and family variants are correlated; unique targets are not independent scene judgments.",
      "Keyword retention is an exact per-case comparison against the same shared keyword pipeline; semantic never reorders it.",
    ],
    rows,
  };
  const temporary = `${out}.${process.pid}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  renameSync(temporary, out);
  console.log(
    JSON.stringify(
      { report: out, checkpoint, complete, requestsThisRun: requests, summary: report.summary },
      null,
      2,
    ),
  );
  return complete ? 0 : 1;
};
