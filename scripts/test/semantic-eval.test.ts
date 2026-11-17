import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Entry } from "../find";
import { assetFromEntry, assetKey } from "../semantic/catalog";
import { evaluateSearch, parseEvalCases, retrievalMetrics } from "../semantic/evaluate";
import { hash } from "../semantic/model";
import { openIndex } from "../semantic/store";

test("retrieval metrics use ranked unique assets and all labeled relevant assets", () => {
  const metrics = retrievalMetrics(["wrong", "right", "right", "other"], ["right", "missing"]);
  expect(metrics.hit1).toBe(0);
  expect(metrics.hit5).toBe(1);
  expect(metrics.recall10).toBe(0.5);
  expect(metrics.mrr10).toBe(0.5);
  expect(metrics.ndcg10).toBeCloseTo(1 / Math.log2(3) / (1 + 1 / Math.log2(3)), 8);
});

test("evaluation validates unique cases and explicit nonempty relevance judgments", () => {
  const row = { id: "rain", query: "water", language: "en", relevant: ["rain"] };
  expect(
    parseEvalCases({ labelMethod: "Catalog labels, not blind listening", cases: [row] }).cases,
  ).toHaveLength(1);
  expect(() => parseEvalCases({ labelMethod: "labels", cases: [row, row] })).toThrow(/duplicate/i);
  expect(() =>
    parseEvalCases({ labelMethod: "labels", cases: [{ ...row, relevant: [] }] }),
  ).toThrow(/relevant/i);
  expect(() => parseEvalCases({ cases: [row] })).toThrow(/labelMethod/);
});

test("cached eval compares the actual hybrid ranking and exposes missing vectors and queries", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-eval-"));
  const index = openIndex(join(folder, "index.sqlite"));
  const entries: Entry[] = [
    { kind: "sfx", src: "fixture", id: "rain", title: "Rain", about: "rain", cat: "weather" },
    { kind: "sfx", src: "fixture", id: "wind", title: "Wind", about: "wind", cat: "weather" },
    {
      kind: "bgm",
      src: "fixture",
      id: "rain-music",
      title: "Rain music",
      about: "rain",
      cat: "music",
    },
  ];
  const key = assetKey(entries[0]!);
  const vector = Array.from({ length: 768 }, (_, i) => (i ? 0 : 1));
  try {
    for (const entry of [entries[0]!, entries[2]!]) {
      const asset = assetFromEntry(entry);
      index.stage(asset, "fixture", [{ from: 0, to: 0 }]);
      index.complete(index.pending(asset.key)[0]!, { vector, usage: {} });
    }
    index.put("?query", hash("task: search result | query: tiếng mưa"), { vector, usage: {} });
    const report = await evaluateSearch(
      index,
      entries,
      parseEvalCases({
        labelMethod: "Fixture judgments",
        cases: [
          {
            id: "cached",
            query: "tiếng mưa",
            language: "vi",
            kind: "sfx",
            source: "fixture",
            relevant: [key],
          },
          { id: "uncached", query: "wind", language: "en", relevant: [assetKey(entries[1]!)] },
          { id: "deleted", query: "gone", language: "en", relevant: ["deleted"] },
        ],
      }),
    );
    expect(report.apiRequests).toBe(0);
    expect(report.catalog.assets).toBe(3);
    expect(report.catalog.searchable).toBe(2);
    expect(report.rows[0]!.semantic?.hit1).toBe(1);
    expect(report.rows[0]!.hybrid?.hit1).toBe(1);
    expect(report.rows[0]!.lexical.hit1).toBe(0);
    expect(report.rows[0]!.top.hybrid).toEqual([key]);
    expect(report.rows[1]!.missingEmbeddings).toEqual([assetKey(entries[1]!)]);
    expect(report.rows[1]!.error).toMatch(/cached query/i);
    expect(report.rows[2]!.missingCatalog).toEqual(["deleted"]);
    expect(report.summary.hybrid.scored).toBe(1);
    expect(report.summary.hybrid.hit5AllCases).toBeCloseTo(1 / 3);
    expect(report.summary.lexical.scored).toBe(3);
    expect(report.byLanguage.vi!.hybrid.scored).toBe(1);
    expect(report.complete).toBe(false);
    expect(index.status().jobs).toEqual([{ state: "done", count: 2 }]);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("the offline eval CLI saves partial reports, rejects API opt-in and preserves existing reports", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-eval-cli-"));
  const database = join(folder, "index.sqlite"),
    output = join(folder, "report.json"),
    cases = join(folder, "cases.json");
  openIndex(database).close();
  writeFileSync(
    cases,
    JSON.stringify({
      labelMethod: "Fixture",
      cases: [{ id: "absent", language: "en", query: "rain", relevant: ["missing"] }],
    }),
  );
  const run = (...extra: string[]) =>
    Bun.spawnSync(
      [
        process.execPath,
        "--no-env-file",
        "scripts/asset-search.ts",
        "eval",
        cases,
        "--db",
        database,
        ...extra,
      ],
      {
        env: {
          ...process.env,
          GEMINI_API_KEY: "",
          GOOGLE_API_KEY: "",
          OPENROUTER_API_KEY: "",
          MC_VAULT_ROOT: join(folder, "vault"),
          MC_VAULT_EXTERNAL: join(folder, "external"),
          MC_SEMANTIC_DB: database,
          MC_SEMANTIC_QUOTA_DB: join(folder, "quota.sqlite"),
          MC_SEMANTIC_DAILY_LIMIT: "1000",
          MC_SEMANTIC_MANIFEST: "",
        },
        timeout: 10000,
      },
    );
  try {
    const report = run("--out", output);
    expect(report.exitCode).toBe(1);
    expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({
      complete: false,
      apiRequests: 0,
      cases: 1,
    });
    const saved = readFileSync(output, "utf8");
    expect(run("--out", output).exitCode).toBe(1);
    expect(readFileSync(output, "utf8")).toBe(saved);
    expect(run("--yes").exitCode).toBe(2);
    expect(existsSync(join(folder, "quota.sqlite"))).toBe(false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
