import { type Entry, isForeign, rank } from "../find";
import { assetKey } from "./catalog";
import { fuseRanks, searchIndex } from "./search";
import type { Index } from "./store";

type EvalCase = {
  id: string;
  query: string;
  language: string;
  relevant: string[];
  kind?: string;
  source?: string;
  group?: string;
};
export const parseEvalCases = (input: unknown): { labelMethod: string; cases: EvalCase[] } => {
  if (!input || typeof input !== "object") throw new Error("Expected an evaluation object");
  const data = input as Record<string, unknown>;
  if (typeof data.labelMethod !== "string" || !data.labelMethod.trim())
    throw new Error("Evaluation needs an explicit labelMethod");
  if (!Array.isArray(data.cases) || !data.cases.length || data.cases.length > 2000)
    throw new Error("Evaluation needs 1–2000 cases");
  const ids = new Set<string>();
  const cases = data.cases.map((value: unknown, i): EvalCase => {
    if (!value || typeof value !== "object") throw new Error(`Invalid evaluation case ${i}`);
    const row = value as Record<string, unknown>;
    for (const field of ["id", "query", "language"])
      if (typeof row[field] !== "string" || !row[field].trim())
        throw new Error(`Case ${i} needs ${field}`);
    if (Buffer.byteLength(row.query as string, "utf8") > 2048)
      throw new Error(`Case ${i} query exceeds 2048 UTF-8 bytes`);
    for (const field of ["kind", "source", "group"])
      if (row[field] !== undefined && (typeof row[field] !== "string" || !row[field].trim()))
        throw new Error(`Case ${i} has invalid ${field}`);
    if (
      !Array.isArray(row.relevant) ||
      !row.relevant.length ||
      !row.relevant.every((key: unknown) => typeof key === "string" && key.length > 0)
    )
      throw new Error(`Case ${i} needs relevant asset keys`);
    if (ids.has(row.id as string)) throw new Error(`Duplicate case id: ${row.id}`);
    ids.add(row.id as string);
    return {
      id: row.id as string,
      query: row.query as string,
      language: row.language as string,
      relevant: [...new Set(row.relevant as string[])],
      ...(row.kind !== undefined && { kind: row.kind as string }),
      ...(row.source !== undefined && { source: row.source as string }),
      ...(row.group !== undefined && { group: row.group as string }),
    };
  });
  return { labelMethod: data.labelMethod, cases };
};
export const retrievalMetrics = (ranked: string[], relevant: string[]) => {
  const top = [...new Set(ranked)].slice(0, 10),
    gold = new Set(relevant);
  const rank = top.findIndex((key) => gold.has(key));
  const dcg = top.reduce((sum, key, i) => sum + (gold.has(key) ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = Array.from(
    { length: Math.min(10, gold.size) },
    (_, i) => 1 / Math.log2(i + 2),
  ).reduce((a, b) => a + b, 0);
  return {
    hit1: Number(rank === 0),
    hit5: Number(rank >= 0 && rank < 5),
    hit10: Number(rank >= 0),
    mrr10: rank < 0 ? 0 : 1 / (rank + 1),
    recall10: top.filter((key) => gold.has(key)).length / gold.size,
    ndcg10: dcg / ideal,
  };
};
type Metrics = ReturnType<typeof retrievalMetrics>;
const MODES = ["lexical", "semantic", "hybrid"] as const;
type Mode = (typeof MODES)[number];
type Row = EvalCase & {
  missingCatalog: string[];
  missingEmbeddings: string[];
  lexical: Metrics;
  semantic?: Metrics;
  hybrid?: Metrics;
  error?: string;
  top: Record<Mode, string[]>;
  milliseconds: { lexical: number; semantic: number | null; hybrid: number | null };
};
const summarize = (rows: Row[]) => {
  const modeSummary = (mode: Mode) => {
    const scores = rows.flatMap((row) => (row[mode] ? [row[mode]!] : []));
    const timings = rows
      .map((row) => row.milliseconds[mode])
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
    return {
      scored: scores.length,
      unscored: rows.length - scores.length,
      hit5AllCases: scores.reduce((sum, row) => sum + row.hit5, 0) / rows.length,
      ...Object.fromEntries(
        ["hit1", "hit5", "hit10", "mrr10", "recall10", "ndcg10"].map((key) => [
          key,
          scores.length
            ? scores.reduce((sum, row) => sum + row[key as keyof Metrics], 0) / scores.length
            : null,
        ]),
      ),
      latencyMs: {
        p50: timings.length ? timings[Math.ceil(timings.length * 0.5) - 1] : null,
        p95: timings.length ? timings[Math.ceil(timings.length * 0.95) - 1] : null,
      },
    };
  };
  return {
    lexical: modeSummary("lexical"),
    semantic: modeSummary("semantic"),
    hybrid: modeSummary("hybrid"),
  };
};

export const evaluateSearch = async (
  index: Index,
  entries: Entry[],
  set: ReturnType<typeof parseEvalCases>,
) => {
  const ready = new Set(index.ready()),
    all = new Set(entries.map(assetKey));
  const rows: Row[] = [];
  for (const item of set.cases) {
    const pool = entries.filter(
      (entry) =>
        (!item.kind || entry.kind === item.kind) && (!item.source || entry.src === item.source),
    );
    const eligible = new Set(pool.map(assetKey));
    const start = performance.now();
    const lexical = isForeign(item.query) ? [] : rank(pool, item.query, { n: 100 }).map(assetKey);
    const lexicalMs = performance.now() - start;
    const row: Row = {
      ...item,
      missingCatalog: item.relevant.filter((key) => !eligible.has(key)),
      missingEmbeddings: item.relevant.filter((key) => eligible.has(key) && !ready.has(key)),
      lexical: retrievalMetrics(lexical, item.relevant),
      top: { lexical: lexical.slice(0, 10), semantic: [], hybrid: [] },
      milliseconds: { lexical: lexicalMs, semantic: null, hybrid: null },
    };
    try {
      const semStart = performance.now();
      const semantic = (await searchIndex(index, item.query, eligible, { allowApi: false })).map(
        (hit) => hit.key,
      );
      const semanticMs = performance.now() - semStart;
      const fusionStart = performance.now();
      const hybrid = fuseRanks(lexical, semantic);
      row.milliseconds.semantic = semanticMs;
      row.milliseconds.hybrid = lexicalMs + semanticMs + performance.now() - fusionStart;
      row.semantic = retrievalMetrics(semantic, item.relevant);
      row.hybrid = retrievalMetrics(hybrid, item.relevant);
      row.top.semantic = semantic.slice(0, 10);
      row.top.hybrid = hybrid.slice(0, 10);
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
    }
    rows.push(row);
  }
  return {
    labelMethod: set.labelMethod,
    apiRequests: 0,
    index: index.status().space,
    catalog: {
      assets: entries.length,
      searchable: [...ready].filter((key) => all.has(key)).length,
    },
    cases: rows.length,
    uniqueTargets: new Set(set.cases.flatMap((row) => row.relevant)).size,
    complete: rows.every(
      (row) => !row.error && !row.missingCatalog.length && !row.missingEmbeddings.length,
    ),
    summary: summarize(rows),
    byLanguage: Object.fromEntries(
      [...new Set(rows.map((row) => row.language))].map((language) => [
        language,
        summarize(rows.filter((row) => row.language === language)),
      ]),
    ),
    byGroup: Object.fromEntries(
      [...new Set(rows.map((row) => row.group ?? "ungrouped"))].map((group) => [
        group,
        summarize(rows.filter((row) => (row.group ?? "ungrouped") === group)),
      ]),
    ),
    notes: [
      "Cached queries only; no external requests. Latency excludes query embedding and catalog loading.",
      "Metrics use supplied judgments only; unlabelled alternatives may also be relevant.",
      "Scored-only metrics exclude missing query caches; hit5AllCases includes those misses. Complete is data readiness, not a quality pass.",
      "Repeated languages/queries for the same target are correlated; target count is not a confidence interval or a blind relevance judgment.",
    ],
    rows,
  };
};
