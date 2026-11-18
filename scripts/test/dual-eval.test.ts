import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateDualCase, readCheckpoint, validateContinuation } from "../evals/find/dual";
import type { Entry } from "../find";
import { assetKey } from "../semantic/catalog";

test("dual evaluation measures each branch and verifies keyword retention through the real CLI", async () => {
  const mc: Entry = {
    kind: "mc",
    src: "minecraft",
    id: "stone",
    title: "Stone step",
    cat: "blocks",
    about: "",
  };
  const of: Entry = {
    kind: "sfx",
    src: "openfilm",
    id: "footstep",
    title: "Footsteps",
    cat: "foley",
    about: "",
    data: { upstreamId: "audio/step" },
  };
  const result = await evaluateDualCase(
    {
      id: "step",
      query: "stone",
      language: "en",
      kind: "sound",
      group: "mc",
      relevant: [assetKey(mc)],
    },
    [mc, of],
    async () => ({ hits: [{ entry: of, score: 0.8 }], categories: ["sound"], notes: [] }),
  );
  expect(result.keywordUnchanged).toBe(true);
  expect(result.keyword.hit1).toBe(1);
  expect(result.semantic.hit1).toBe(0);
  expect(result.unionHit).toBe(true);
  expect(result.newCandidates).toBe(1);
});

test("dual evaluation retains entry-owned kind words and folds ranked sound families", async () => {
  const entries: Entry[] = [
    { id: "a", kind: "sfx", cat: "nature", title: "sound sound sound rain", about: "rain" },
    { id: "b", kind: "sfx", cat: "nature", title: "rain rain", about: "rain" },
    { id: "plain", kind: "bgm", cat: "warm", title: "Warm piano", about: "" },
    { id: "score", kind: "bgm", cat: "warm", title: "Warm score", about: "" },
    ...[1, 2].map((variant) => ({
      id: `door-${variant}`,
      kind: "sfx",
      cat: "foley",
      title: "Door slam",
      about: "",
      data: { family: "door", variant },
    })),
  ];
  for (const [query, kind, ids] of [
    ["sound rain", "sfx", ["a", "b"]],
    ["sound", "sfx", ["a"]],
    ["warm score", "bgm", ["score", "plain"]],
    ["door slam", "sfx", ["door-1"]],
  ] as const) {
    const expected = ids.map((id) => assetKey(entries.find((entry) => entry.id === id)!));
    const result = await evaluateDualCase(
      { id: query, query, kind, language: "en", group: "fixture", relevant: expected },
      entries,
      async () => ({ hits: [], categories: [], notes: [] }),
    );
    expect(result.top.keyword, query).toEqual(expected);
    expect(result.keywordUnchanged, query).toBe(true);
  }
});

test("a stopped evaluation retains complete checkpoint rows and repairs only its unfinished tail", () => {
  const folder = mkdtempSync(join(tmpdir(), "dual-checkpoint-")),
    file = join(folder, "rows.jsonl");
  const header = JSON.stringify({ fingerprint: "catalog" });
  const row = JSON.stringify({ id: "done", query: "tiếng mưa" });
  try {
    writeFileSync(file, `${header}\n${row}\n{"id":"interrupted`);
    expect(readCheckpoint(file, "catalog")).toEqual([{ id: "done", query: "tiếng mưa" }]);
    expect(readFileSync(file, "utf8")).toBe(`${header}\n${row}\n`);
    expect(() => readCheckpoint(file, "other-catalog")).toThrow(/changed/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("only a partial report from the same corpus may be continued", () => {
  expect(() =>
    validateContinuation({ complete: false, fingerprint: "same" }, "same"),
  ).not.toThrow();
  expect(() => validateContinuation({ complete: true, fingerprint: "same" }, "same")).toThrow(
    /complete|existing/i,
  );
  expect(() => validateContinuation({ complete: false, fingerprint: "old" }, "same")).toThrow(
    /changed|different/i,
  );
});

test("legacy words evaluation ignores cached semantic candidates and prevents remote requests", () => {
  const root = mkdtempSync(join(tmpdir(), "words-eval-"));
  const folder = join(root, "scripts/evals/find");
  try {
    mkdirSync(join(folder, "cases"), { recursive: true });
    copyFileSync(new URL("../evals/find/run.ts", import.meta.url), join(folder, "run.ts"));
    writeFileSync(
      join(folder, "cases/probe.tsv"),
      "probe\tsfx\ten\tname\tutterlygibberish\tNONE\n",
    );
    writeFileSync(
      join(root, "scripts/find.ts"),
      `
import {run} from ${JSON.stringify(new URL("../find.ts", import.meta.url).href)};
import {favoriteLists} from ${JSON.stringify(new URL("../../packages/live-studio/src/favorites.mjs", import.meta.url).href)};
import {writeFileSync} from "node:fs";
const entry = {id:"remote-only",kind:"sfx",cat:"foley",title:"Wind",about:"",src:"openfilm",data:{upstreamId:"remote-only"}};
console.log(await run(process.argv.slice(2), [entry], async()=>{throw new Error("No Jev")}, undefined,
  favoriteLists(${JSON.stringify(join(root, "favorites"))}), async (_query, _pool, options)=>{
    writeFileSync(${JSON.stringify(join(root, "lookup.json"))}, JSON.stringify({offline:options?.offline}));
    return {hits:[{entry,score:0.7}],categories:["sound"],notes:[]};
  }));
`,
    );
    const result = spawnSync(
      process.execPath,
      [join(folder, "run.ts"), "--mode", "words", "--set", "probe"],
      {
        cwd: root,
        env: {
          ...process.env,
          BUN_OPTIONS: "--no-env-file",
          MC_VAULT_ROOT: join(root, "vault"),
          MC_VAULT_EXTERNAL: join(root, "vault"),
          MC_FIND_OFFLINE: "0",
        },
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const row = JSON.parse(readFileSync(join(folder, "runs/probe.words.jsonl"), "utf8"));
    expect(row.hits).toEqual([]);
    expect(row.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "lookup.json"), "utf8"))).toEqual({ offline: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
