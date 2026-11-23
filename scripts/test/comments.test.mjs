import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildCliInvocation } from "../../packages/live-studio/src/cli-catalog.ts";
import { applyStrips, groupProseBlocks, isAllowedComment } from "../lint/comment-rules.mjs";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const COMMENTS_CLI = join(REPO_ROOT, "scripts/comments.mjs");
const NO_COMMENTS_PLUGIN = join(REPO_ROOT, "scripts/lint/oxlint-no-comments.mjs");
const OXLINT_CLI = join(REPO_ROOT, "node_modules/oxlint/dist/cli.js");

const runCli = (args, cwd = REPO_ROOT, env = {}) =>
  spawnSync(process.execPath, [COMMENTS_CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30000,
  });

const runOxlint = (configPath, targets, env = {}) =>
  spawnSync(process.execPath, [OXLINT_CLI, "-c", configPath, ...targets], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30000,
  });

describe("comment-rules classification", () => {
  test("allows standard compiler, linter, coverage and bundler directives", () => {
    const allowed = [
      { type: "Shebang", value: "/usr/bin/env bun" },
      { type: "Line", value: " @ts-nocheck" },
      { type: "Line", value: " @ts-expect-error deliberate type mismatch" },
      { type: "Line", value: '/ <reference types="vite/client" />' },
      { type: "Line", value: " oxlint-disable-next-line no-undef" },
      { type: "Line", value: " eslint-disable-next-line react-hooks/exhaustive-deps" },
      { type: "Block", value: " @vite-ignore " },
      { type: "Block", value: " v8 ignore next " },
      { type: "Line", value: " prettier-ignore" },
      { type: "Line", value: "#region helpers" },
      { type: "Line", value: "#endregion" },
    ];
    for (const comment of allowed) {
      expect(isAllowedComment(comment, "src/file.ts")).toBe(true);
    }
    expect(isAllowedComment({ type: "Line", value: " Region bounds calculation" }, "a.ts")).toBe(
      false,
    );
    expect(isAllowedComment({ type: "Line", value: " region of interest" }, "a.ts")).toBe(false);
    expect(isAllowedComment({ type: "Line", value: " endregion note" }, "a.ts")).toBe(false);

    const rejectedBypasses = [
      { type: "Line", value: " oxlint-disable-fake smuggled prose" },
      { type: "Line", value: " oxlint-enable-next-line smuggled prose" },
      { type: "Line", value: " eslint-enable-line smuggled prose" },
      { type: "Line", value: " @TS-EXPECT-ERROR smuggled uppercase" },
      { type: "Line", value: " OXLINT-DISABLE-NEXT-LINE smuggled uppercase" },
      { type: "Line", value: " #region-fake smuggled prose" },
      { type: "Line", value: " @vite-ignore-fake smuggled prose" },
      { type: "Line", value: " prettier-ignore-foo smuggled prose" },
      { type: "Line", value: " biome-ignore-foo smuggled prose" },
      { type: "Line", value: " v8 ignore-fake smuggled prose" },
      { type: "Block", value: " @ts-nocheck " },
      { type: "Block", value: ' / <reference types="vite/client" /> ' },
      { type: "Block", value: " #region helpers " },
    ];
    for (const comment of rejectedBypasses) {
      expect(isAllowedComment(comment, "src/file.ts")).toBe(false);
    }
  });

  test("allows type-only JSDoc in plain JS/MJS but bans prose JSDoc, malformed braces, and TS JSDoc", () => {
    const typeOnly = { type: "Block", value: "* @type {string[]} " };
    const multiTag = {
      type: "Block",
      value: "*\n * @param {number} a\n * @returns {boolean}\n ",
    };
    const proseJsdoc = {
      type: "Block",
      value: "* Computes value.\n * @param {number} a\n ",
    };
    const unclosedBrace = {
      type: "Block",
      value: "* @type {string\n * smuggled prose\n ",
    };
    const extraCloseBrace = {
      type: "Block",
      value: "* @type {string} } ",
    };
    expect(isAllowedComment(typeOnly, "scripts/foo.mjs")).toBe(true);
    expect(isAllowedComment(multiTag, "scripts/foo.js")).toBe(true);
    expect(isAllowedComment(typeOnly, "scripts/foo.ts")).toBe(false);
    expect(isAllowedComment(proseJsdoc, "scripts/foo.mjs")).toBe(false);
    expect(isAllowedComment(unclosedBrace, "scripts/foo.mjs")).toBe(false);
    expect(isAllowedComment(extraCloseBrace, "scripts/foo.mjs")).toBe(false);
    expect(isAllowedComment({ type: "Line", value: " just a prose comment" }, "a.ts")).toBe(false);
  });
});

describe("comment-rules block grouping and safe stripping", () => {
  test("groups consecutive standalone line comments and removes them cleanly", () => {
    const source = "const a = 1;\n// line one\n// line two\nconst b = 2;\n";
    const c1Start = source.indexOf("// line one");
    const c1End = c1Start + "// line one".length;
    const c2Start = source.indexOf("// line two");
    const c2End = c2Start + "// line two".length;
    const blocks = groupProseBlocks(
      source,
      [
        { type: "Line", value: " line one", start: c1Start, end: c1End },
        { type: "Line", value: " line two", start: c2Start, end: c2End },
      ],
      "sample.ts",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].line).toBe(2);
    expect(blocks[0].end).toBe(3);
    expect(blocks[0].tokens).toBe(2);
    expect(blocks[0].shedLines).toBe(2);
    expect(blocks[0].trailing).toBe(false);

    const out = applyStrips(source, blocks);
    expect(out).toBe("const a = 1;\nconst b = 2;\n");
  });

  test("preserves code on trailing comments and separates adjacent identifier tokens", () => {
    const source = "const x = 1; // trailing\r\nfunction f() { return/*gap*/x; }\r\n";
    const tStart = source.indexOf("// trailing");
    const tEnd = tStart + "// trailing".length;
    const bStart = source.indexOf("/*gap*/");
    const bEnd = bStart + "/*gap*/".length;
    const blocks = groupProseBlocks(
      source,
      [
        { type: "Line", value: " trailing", start: tStart, end: tEnd },
        { type: "Block", value: "gap", start: bStart, end: bEnd },
      ],
      "sample.ts",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].trailing).toBe(true);
    expect(blocks[0].shedLines).toBe(0);

    const out = applyStrips(source, blocks);
    expect(out).toBe("const x = 1;\r\nfunction f() { return x; }\r\n");
  });

  test("strips standalone JSX comment expression containers without touching object literals", () => {
    const source =
      "export const C = () => {\n  const obj = { /* keep braces */ };\n  return (\n    <div>\n      {/* banner */}\n      <span>hi</span>\n    </div>\n  );\n};\n";
    const objCommentStart = source.indexOf("/* keep braces */");
    const objCommentEnd = objCommentStart + "/* keep braces */".length;
    const jsxWrapStart = source.indexOf("{/* banner */}");
    const jsxWrapEnd = jsxWrapStart + "{/* banner */}".length;
    const jsxCommentStart = source.indexOf("/* banner */");
    const jsxCommentEnd = jsxCommentStart + "/* banner */".length;

    const blocks = groupProseBlocks(
      source,
      [
        { type: "Block", value: " keep braces ", start: objCommentStart, end: objCommentEnd },
        { type: "Block", value: " banner ", start: jsxCommentStart, end: jsxCommentEnd },
      ],
      "sample.tsx",
      [[jsxWrapStart, jsxWrapEnd]],
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].jsxWrapped).toBe(false);
    expect(blocks[1].jsxWrapped).toBe(true);
    expect(blocks[1].shedLines).toBe(1);

    const out = applyStrips(source, blocks);
    expect(out).toBe(
      "export const C = () => {\n  const obj = {  };\n  return (\n    <div>\n      <span>hi</span>\n    </div>\n  );\n};\n",
    );
  });

  test("preserves ASI line terminator when stripping multiline inline block comments", () => {
    const source = "export function f() {\n  return /*\n  explanation\n  */ 42;\n}\n";
    const cStart = source.indexOf("/*");
    const cEnd = source.indexOf("*/") + 2;
    const blocks = groupProseBlocks(
      source,
      [{ type: "Block", value: "\n  explanation\n  ", start: cStart, end: cEnd }],
      "asi.ts",
    );
    const out = applyStrips(source, blocks);
    expect(out).toBe("export function f() {\n  return \n 42;\n}\n");
  });

  test("preserves file trailing newline when removing an EOF standalone comment", () => {
    const withNewline = "export const a = 1;\n// eof comment\n";
    const wStart = withNewline.indexOf("// eof comment");
    const wBlocks = groupProseBlocks(
      withNewline,
      [
        {
          type: "Line",
          value: " eof comment",
          start: wStart,
          end: wStart + "// eof comment".length,
        },
      ],
      "eof.ts",
    );
    expect(applyStrips(withNewline, wBlocks)).toBe("export const a = 1;\n");

    const withoutNewline = "export const a = 1;\n// eof comment";
    const woStart = withoutNewline.indexOf("// eof comment");
    const woBlocks = groupProseBlocks(
      withoutNewline,
      [{ type: "Line", value: " eof comment", start: woStart, end: withoutNewline.length }],
      "eof.ts",
    );
    expect(applyStrips(withoutNewline, woBlocks)).toBe("export const a = 1;");
  });

  test("inserts spaces between mergeable operators and numeric dot tokens", () => {
    const source =
      "const a = x +/*c1*/+ y;\nconst b = cond ?/*c2*/.5 : 1;\nconst c = 1/*c3*/.toString();\n";
    const comments = ["/*c1*/", "/*c2*/", "/*c3*/"].map((raw) => {
      const start = source.indexOf(raw);
      return { type: "Block", value: raw.slice(2, -2), start, end: start + raw.length };
    });
    const blocks = groupProseBlocks(source, comments, "ops.ts");
    expect(applyStrips(source, blocks)).toBe(
      "const a = x + + y;\nconst b = cond ? .5 : 1;\nconst c = 1 .toString();\n",
    );
  });
});

describe("mc-comments/no-comments oxlint plugin ratchet", () => {
  test("bans new comments, allows up to ceiling, fails above ceiling and fails when stale", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-lint-"));
    try {
      const cleanFile = join(dir, "clean.ts");
      const newCommentFile = join(dir, "new-comment.ts");
      const ratchetedFile = join(dir, "ratcheted.ts");
      const ratchetPath = join(dir, "ratchet.json");
      const cfgPath = join(dir, ".oxlintrc.json");

      writeFileSync(cleanFile, "// @ts-nocheck\nexport const ok = 1;\n");
      writeFileSync(newCommentFile, "// prose comment\nexport const bad = 1;\n");
      writeFileSync(ratchetedFile, "// old one\n// old two\nexport const legacy = 1;\n");
      writeFileSync(
        ratchetPath,
        JSON.stringify({ version: 1, files: { "ratcheted.ts": 2 } }, null, 2),
      );
      writeFileSync(
        cfgPath,
        JSON.stringify({
          jsPlugins: [NO_COMMENTS_PLUGIN.replaceAll("\\", "/")],
          rules: { "mc-comments/no-comments": "error" },
        }),
      );

      const env = { MC_COMMENTS_RATCHET: ratchetPath, MC_COMMENTS_ROOT: dir };

      const okRes = runOxlint(cfgPath, [cleanFile, ratchetedFile], env);
      expect(okRes.status, okRes.stdout + okRes.stderr).toBe(0);

      const newFail = runOxlint(cfgPath, [newCommentFile], env);
      expect(newFail.status).not.toBe(0);
      expect(newFail.stdout + newFail.stderr).toContain("no-comments");

      writeFileSync(
        ratchetedFile,
        "// old one\n// old two\n// added three\nexport const legacy = 1;\n",
      );
      const overFail = runOxlint(cfgPath, [ratchetedFile], env);
      expect(overFail.status).not.toBe(0);
      expect(overFail.stdout + overFail.stderr).toContain("ratchet ceiling is 2");

      writeFileSync(ratchetedFile, "// old one\nexport const legacy = 1;\n");
      const staleFail = runOxlint(cfgPath, [ratchetedFile], env);
      expect(staleFail.status).not.toBe(0);
      expect(staleFail.stdout + staleFail.stderr).toContain("dropped from 2 to 1");

      writeFileSync(ratchetedFile, "export const legacy = 1;\n");
      const zeroStaleFail = runOxlint(cfgPath, [ratchetedFile], env);
      expect(zeroStaleFail.status).not.toBe(0);
      expect(zeroStaleFail.stdout + zeroStaleFail.stderr).toContain("dropped from 2 to 0");

      const bypassFile = join(dir, "bypass.ts");
      writeFileSync(
        bypassFile,
        [
          "// oxlint-disable-fake smuggled",
          "// oxlint-enable-next-line smuggled",
          "// @TS-EXPECT-ERROR smuggled",
          "// #region-fake smuggled",
          "/* @ts-nocheck */",
          "export const v = 1;",
          "",
        ].join("\n"),
      );
      const bypassFail = runOxlint(cfgPath, [bypassFile], env);
      expect(bypassFail.status).not.toBe(0);
      expect(bypassFail.stdout + bypassFail.stderr).toContain("mc-comments(no-comments)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails closed on malformed ratchet schema and rejects string ceilings", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-schema-"));
    try {
      const sampleFile = join(dir, "sample.ts");
      const ratchetPath = join(dir, "ratchet.json");
      const cfgPath = join(dir, ".oxlintrc.json");

      writeFileSync(sampleFile, "// single prose comment\nexport const x = 1;\n");
      writeFileSync(
        cfgPath,
        JSON.stringify({
          jsPlugins: [NO_COMMENTS_PLUGIN.replaceAll("\\", "/")],
          rules: { "mc-comments/no-comments": "error" },
        }),
      );
      const env = { MC_COMMENTS_RATCHET: ratchetPath, MC_COMMENTS_ROOT: dir };

      writeFileSync(ratchetPath, JSON.stringify({ version: 1, files: null }));
      const badSchema = runOxlint(cfgPath, [sampleFile], env);
      expect(badSchema.status).not.toBe(0);

      writeFileSync(ratchetPath, JSON.stringify({ version: 1, files: { "sample.ts": "1" } }));
      const strCeiling = runOxlint(cfgPath, [sampleFile], env);
      expect(strCeiling.status).not.toBe(0);
      expect(strCeiling.stdout + strCeiling.stderr).toContain("Comments are banned");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("comments CLI", () => {
  test("help exits 0 and bad usage exits 2", () => {
    expect(runCli(["--help"]).status).toBe(0);
    expect(runCli(["--unknown"]).status).toBe(2);
    expect(runCli(["bogus-subcommand"]).status).toBe(2);
  });

  test("list, strip with token-stream verification, and ratchet tightening work end-to-end", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-cli-"));
    try {
      const aPath = join(dir, "a.ts");
      const bPath = join(dir, "b.tsx");
      const ratchetPath = join(dir, "ratchet.json");
      const doomedPath = join(dir, "doomed.jsonl");

      writeFileSync(
        aPath,
        "// @ts-nocheck\n// tautology line 1\n// tautology line 2\nexport type Pair = [number, string];\nexport const v = 1; // inline\n",
      );
      writeFileSync(
        bPath,
        "export const View = () => (\n  <div>\n    {/* heading */}\n    <span>a</span>\n  </div>\n);\n",
      );

      const env = { MC_COMMENTS_RATCHET: ratchetPath, MC_COMMENTS_ROOT: dir };

      const initRes = runCli(["ratchet", "--init", "a.ts", "b.tsx"], dir, env);
      expect(initRes.status, initRes.stderr).toBe(0);
      expect(JSON.parse(readFileSync(ratchetPath, "utf8")).files).toEqual({
        "a.ts": 3,
        "b.tsx": 1,
      });

      const listRes = runCli(["list", "a.ts", "b.tsx"], dir, env);
      expect(listRes.status, listRes.stderr).toBe(0);
      const blocks = listRes.stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      expect(blocks).toHaveLength(3);
      expect(blocks[0]).toMatchObject({ file: "a.ts", line: 2, end: 3, tokens: 2, shedLines: 2 });
      expect(blocks[1]).toMatchObject({ file: "a.ts", line: 5, end: 5, tokens: 1, trailing: true });
      expect(blocks[2]).toMatchObject({ file: "b.tsx", line: 3, end: 3, tokens: 1, shedLines: 1 });

      writeFileSync(
        doomedPath,
        [blocks[0], blocks[2]]
          .map((b) => JSON.stringify({ file: b.file, line: b.line, text: b.text }))
          .join("\n") + "\n",
      );
      const stripRes = runCli(["strip", doomedPath], dir, env);
      expect(stripRes.status, stripRes.stderr).toBe(0);
      expect(stripRes.stdout).toContain("stripped 2");
      expect(stripRes.stdout).toContain("skipped 0");

      expect(readFileSync(aPath, "utf8")).toBe(
        "// @ts-nocheck\nexport type Pair = [number, string];\nexport const v = 1; // inline\n",
      );
      expect(readFileSync(bPath, "utf8")).toBe(
        "export const View = () => (\n  <div>\n    <span>a</span>\n  </div>\n);\n",
      );

      const tightenRes = runCli(["ratchet", "a.ts", "b.tsx"], dir, env);
      expect(tightenRes.status, tightenRes.stderr).toBe(0);
      expect(JSON.parse(readFileSync(ratchetPath, "utf8")).files).toEqual({ "a.ts": 1 });

      writeFileSync(aPath, "// @ts-nocheck\n// snuck back in\nexport const v = 1; // inline\n");
      const growRes = runCli(["ratchet", "a.ts", "b.tsx"], dir, env);
      expect(growRes.status).not.toBe(0);
      expect(JSON.parse(readFileSync(ratchetPath, "utf8")).files).toEqual({ "a.ts": 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  test("strip skips stale line mismatch and rejects mutations that change code tokens", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-guard-"));
    try {
      const staleFile = join(dir, "stale.ts");
      const jsxJoinFile = join(dir, "jsx-join.tsx");
      const doomedPath = join(dir, "doomed.jsonl");
      const env = { MC_COMMENTS_ROOT: dir };

      writeFileSync(staleFile, "// actual comment\nexport const a = 1;\n");
      writeFileSync(jsxJoinFile, "export const X = () => <div>foo{/* sep */}bar</div>;\n");

      writeFileSync(
        doomedPath,
        [
          JSON.stringify({ file: "stale.ts", line: 1, text: "// different text" }),
          JSON.stringify({ file: "jsx-join.tsx", line: 1, text: "/* sep */" }),
        ].join("\n") + "\n",
      );

      const stripRes = runCli(["strip", doomedPath], dir, env);
      expect(stripRes.status, stripRes.stderr).toBe(0);
      expect(stripRes.stdout).toContain("skipped 1");
      expect(stripRes.stdout).toContain("rejected 1");
      expect(readFileSync(staleFile, "utf8")).toBe("// actual comment\nexport const a = 1;\n");
      expect(readFileSync(jsxJoinFile, "utf8")).toBe(
        "export const X = () => <div>foo{/* sep */}bar</div>;\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("strip handles multiple comments on the same line and scoped ratchet preserves other files", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-multi-"));
    try {
      const f1 = join(dir, "one.ts");
      const f2 = join(dir, "two.ts");
      const ratchetPath = join(dir, "ratchet.json");
      const doomedPath = join(dir, "doomed.jsonl");
      const env = { MC_COMMENTS_RATCHET: ratchetPath, MC_COMMENTS_ROOT: dir };

      writeFileSync(f1, "export const x = /* left */ 1; // right\n");
      writeFileSync(f2, "// keep untouched\nexport const y = 2;\n");

      expect(runCli(["ratchet", "--init", "one.ts", "two.ts"], dir, env).status).toBe(0);
      writeFileSync(
        doomedPath,
        [
          JSON.stringify({ file: "one.ts", line: 1, text: "/* left */" }),
          JSON.stringify({ file: "one.ts", line: 1, text: "// right" }),
        ].join("\n") + "\n",
      );
      const stripRes = runCli(["strip", doomedPath], dir, env);
      expect(stripRes.status, stripRes.stderr).toBe(0);
      expect(stripRes.stdout).toContain("stripped 2");
      expect(readFileSync(f1, "utf8")).toBe("export const x =  1;\n");

      const scopedRatchet = runCli(["ratchet", "one.ts"], dir, env);
      expect(scopedRatchet.status, scopedRatchet.stderr).toBe(0);
      expect(JSON.parse(readFileSync(ratchetPath, "utf8")).files).toEqual({ "two.ts": 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("live repo comment ratchet matches current tracked files", () => {
    const checkRes = runCli(["ratchet", "--check"], REPO_ROOT);
    expect(checkRes.status, `${checkRes.stdout}\n${checkRes.stderr}`).toBe(0);
    expect(checkRes.stdout).toContain("ratchet ok:");
  });

  test("nested packages/live-studio/.oxlintrc.json enforces mc-comments/no-comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-studio-lint-"));
    try {
      const target = join(dir, "sample.tsx");
      const ratchetPath = join(dir, "ratchet.json");
      writeFileSync(target, "// forbidden comment\nexport const App = () => <div />;\n");
      writeFileSync(ratchetPath, JSON.stringify({ version: 1, files: {} }));

      const res = spawnSync(
        process.execPath,
        [OXLINT_CLI, "-c", join(REPO_ROOT, "packages/live-studio/.oxlintrc.json"), target],
        {
          cwd: join(REPO_ROOT, "packages/live-studio"),
          env: { ...process.env, MC_COMMENTS_RATCHET: ratchetPath, MC_COMMENTS_ROOT: dir },
          encoding: "utf8",
          timeout: 30000,
        },
      );
      expect(res.status).not.toBe(0);
      expect(res.stdout + res.stderr).toContain("mc-comments(no-comments)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignorePatterns exclude demo, test/fixtures, films, and vault across list, stats, and ratchet", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-ignore-"));
    try {
      mkdirSync(join(dir, "packages/a/src"), { recursive: true });
      mkdirSync(join(dir, "packages/a/demo/src"), { recursive: true });
      mkdirSync(join(dir, "packages/a/test/fixtures"), { recursive: true });
      mkdirSync(join(dir, "films/myfilm"), { recursive: true });
      mkdirSync(join(dir, "vault/sub"), { recursive: true });

      writeFileSync(join(dir, "packages/a/src/keep.ts"), "// tracked\nexport const k = 1;\n");
      writeFileSync(
        join(dir, "packages/a/demo/src/d.ts"),
        "// ignored demo\nexport const d = 1;\n",
      );
      writeFileSync(
        join(dir, "packages/a/test/fixtures/f.ts"),
        "// ignored fixture\nexport const f = 1;\n",
      );
      writeFileSync(join(dir, "films/myfilm/m.ts"), "// ignored film\nexport const m = 1;\n");
      writeFileSync(join(dir, "vault/sub/v.ts"), "// ignored vault\nexport const v = 1;\n");

      const ratchetPath = join(dir, "ratchet.json");
      const env = { MC_COMMENTS_RATCHET: ratchetPath, MC_COMMENTS_ROOT: dir };

      const listRes = runCli(["list", "packages", "films", "vault"], dir, env);
      expect(listRes.status, listRes.stderr).toBe(0);
      const listed = listRes.stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      expect(listed.map((r) => r.file)).toEqual(["packages/a/src/keep.ts"]);

      const initRes = runCli(["ratchet", "--init", "packages", "films", "vault"], dir, env);
      expect(initRes.status, initRes.stderr).toBe(0);
      expect(JSON.parse(readFileSync(ratchetPath, "utf8")).files).toEqual({
        "packages/a/src/keep.ts": 1,
      });

      const statsRes = runCli(["stats", "--json", "packages", "films", "vault"], dir, env);
      expect(statsRes.status, statsRes.stderr).toBe(0);
      expect(JSON.parse(statsRes.stdout).jsTs.files).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ratchet fails closed on syntax errors and rejects invalid ratchet ceilings", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-failclosed-"));
    try {
      const good = join(dir, "good.ts");
      const broken = join(dir, "broken.ts");
      const ratchetPath = join(dir, "ratchet.json");
      const env = { MC_COMMENTS_RATCHET: ratchetPath, MC_COMMENTS_ROOT: dir };

      writeFileSync(good, "// one\nexport const g = 1;\n");
      writeFileSync(broken, "// a\n// b\nexport const b = 2;\n");
      expect(runCli(["ratchet", "--init", "good.ts", "broken.ts"], dir, env).status).toBe(0);

      writeFileSync(broken, "// a\n// b\nexport const b = (;\n");
      const brokenRes = runCli(["ratchet", "good.ts", "broken.ts"], dir, env);
      expect(brokenRes.status).not.toBe(0);
      expect(JSON.parse(readFileSync(ratchetPath, "utf8")).files).toEqual({
        "broken.ts": 2,
        "good.ts": 1,
      });

      writeFileSync(broken, "// a\n// b\nexport const b = 2;\n");
      writeFileSync(ratchetPath, JSON.stringify({ version: 1, files: { "good.ts": "oops" } }));
      const invalidRes = runCli(["ratchet", "broken.ts"], dir, env);
      expect(invalidRes.status).not.toBe(0);

      writeFileSync(ratchetPath, JSON.stringify({ version: 1, files: null }));
      const nullFilesRes = runCli(["ratchet", "--check", "good.ts"], dir, env);
      expect(nullFilesRes.status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("strip preserves ASI semantics, rejects path traversal, rejects prefix matches, and honors --dry-run", () => {
    const parent = mkdtempSync(join(tmpdir(), "mc-comments-sec-"));
    try {
      const root = join(parent, "repo");
      mkdirSync(root, { recursive: true });
      const outside = join(parent, "outside.ts");
      const asiFile = join(root, "asi.ts");
      const exactFile = join(root, "exact.ts");
      const doomedPath = join(root, "doomed.jsonl");
      const env = { MC_COMMENTS_ROOT: root };

      writeFileSync(outside, "// secret\nexport const s = 1;\n");
      writeFileSync(asiFile, "export function f() {\n  return /*\n  note\n  */ 42;\n}\n");
      writeFileSync(exactFile, "// IMPORTANT KEEP\nexport const x = 1;\n");

      writeFileSync(doomedPath, `${JSON.stringify({ file: "../outside.ts", line: 1 })}\n`);
      const travRes = runCli(["strip", doomedPath], root, env);
      expect(travRes.status).toBe(2);
      expect(readFileSync(outside, "utf8")).toContain("// secret");

      writeFileSync(doomedPath, `${JSON.stringify({ file: outside, line: 1 })}\n`);
      const absRes = runCli(["strip", doomedPath], root, env);
      expect(absRes.status).toBe(2);
      expect(readFileSync(outside, "utf8")).toContain("// secret");

      writeFileSync(doomedPath, `${JSON.stringify({ file: "C:exact.ts", line: 1 })}\n`);
      const driveRes = runCli(["strip", doomedPath], root, env);
      expect(driveRes.status).toBe(2);

      writeFileSync(doomedPath, `${JSON.stringify({ file: "exact.ts", line: 0 })}\n`);
      expect(runCli(["strip", doomedPath], root, env).status).toBe(2);
      writeFileSync(doomedPath, `${JSON.stringify({ file: "exact.ts", line: 1.5 })}\n`);
      expect(runCli(["strip", doomedPath], root, env).status).toBe(2);

      const readme = join(root, "README.md");
      writeFileSync(readme, "# Title\n");
      writeFileSync(doomedPath, `${JSON.stringify({ file: "README.md", line: 1 })}\n`);
      const nonJsRes = runCli(["strip", doomedPath], root, env);
      expect(nonJsRes.status, nonJsRes.stderr).toBe(0);
      expect(nonJsRes.stdout).toContain("skipped 1");

      writeFileSync(doomedPath, `${JSON.stringify({ file: "exact.ts", line: 1, text: "//" })}\n`);
      const prefixRes = runCli(["strip", doomedPath], root, env);
      expect(prefixRes.status, prefixRes.stderr).toBe(0);
      expect(prefixRes.stdout).toContain("skipped 1");
      expect(readFileSync(exactFile, "utf8")).toContain("// IMPORTANT KEEP");

      const listAsi = runCli(["list", "asi.ts"], root, env);
      expect(listAsi.status, listAsi.stderr).toBe(0);
      writeFileSync(doomedPath, listAsi.stdout);

      const dryRes = runCli(["strip", "--dry-run", doomedPath], root, env);
      expect(dryRes.status, dryRes.stderr).toBe(0);
      expect(dryRes.stdout).toContain("[dry-run] stripped 1");
      expect(readFileSync(asiFile, "utf8")).toContain("note");

      const realRes = runCli(["strip", doomedPath], root, env);
      expect(realRes.status, realRes.stderr).toBe(0);
      expect(realRes.stdout).toContain("stripped 1 blocks in 1 files, skipped 0, rejected 0");
      const strippedAsi = readFileSync(asiFile, "utf8");
      expect(strippedAsi).toBe("export function f() {\n  return \n 42;\n}\n");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("strip handles JSX sibling directives, multi-comment containers, and JSX line comments safely", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-jsx-"));
    try {
      const f = join(dir, "view.tsx");
      const doomedPath = join(dir, "doomed.jsonl");
      const env = { MC_COMMENTS_ROOT: dir };

      writeFileSync(
        f,
        [
          "export const View = () => (",
          "  <div>",
          "    {/* oxlint-disable-next-line */ /* prose */}",
          "    {/* one */ /* two */}",
          "    {",
          "      // jsx line comment",
          "    }",
          "    <span>ok</span>",
          "  </div>",
          ");",
          "",
        ].join("\n"),
      );

      const listRes = runCli(["list", "view.tsx"], dir, env);
      expect(listRes.status, listRes.stderr).toBe(0);
      const blocks = listRes.stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => JSON.parse(l));
      expect(blocks).toHaveLength(3);
      expect(blocks[0].text).toBe("/* prose */");
      expect(blocks[1].tokens).toBe(2);
      expect(blocks[1].shedLines).toBe(1);
      expect(blocks[2].text).toBe("// jsx line comment");

      writeFileSync(doomedPath, listRes.stdout);
      const stripRes = runCli(["strip", doomedPath], dir, env);
      expect(stripRes.status, stripRes.stderr).toBe(0);
      expect(stripRes.stdout).toContain("stripped 3 blocks in 1 files, skipped 0, rejected 0");

      const after = readFileSync(f, "utf8");
      expect(after).toContain("{/* oxlint-disable-next-line */ }");
      expect(after).not.toContain("/* prose */");
      expect(after).not.toContain("/* one */");
      expect(after).not.toContain("jsx line comment");
      expect(after).toContain("<span>ok</span>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stats works on Python-only and CSS-only targets without miscounting CSS strings or inline comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-pycss-"));
    try {
      writeFileSync(join(dir, "tool.py"), "#!/usr/bin/env python\n# prose\nx = 1\n");
      writeFileSync(
        join(dir, "style.css"),
        '/* header */\n.a { content: "/* not a comment */"; color: red; /* inline */ }\n',
      );
      const env = { MC_COMMENTS_ROOT: dir };

      const pyRes = runCli(["stats", "--json", "tool.py"], dir, env);
      expect(pyRes.status, pyRes.stderr).toBe(0);
      const pyJson = JSON.parse(pyRes.stdout);
      expect(pyJson.pyCss.tokens).toBe(1);
      expect(pyJson.pyCss.shedLines).toBe(1);

      const cssRes = runCli(["stats", "--json", "style.css"], dir, env);
      expect(cssRes.status, cssRes.stderr).toBe(0);
      const cssJson = JSON.parse(cssRes.stdout);
      expect(cssJson.pyCss.tokens).toBe(2);
      expect(cssJson.pyCss.shedLines).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("strip supports ambient .d.ts declaration files", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-dts-"));
    try {
      const dts = join(dir, "types.d.ts");
      const doomedPath = join(dir, "doomed.jsonl");
      const env = { MC_COMMENTS_ROOT: dir };

      writeFileSync(
        dts,
        "// ambient comment\nexport const foo: string;\nexport function bar(x: number): void;\n",
      );

      const listRes = runCli(["list", "types.d.ts"], dir, env);
      expect(listRes.status, listRes.stderr).toBe(0);
      writeFileSync(doomedPath, listRes.stdout);

      const stripRes = runCli(["strip", doomedPath], dir, env);
      expect(stripRes.status, stripRes.stderr).toBe(0);
      expect(stripRes.stdout).toContain("stripped 1 blocks in 1 files, skipped 0, rejected 0");
      expect(readFileSync(dts, "utf8")).toBe(
        "export const foo: string;\nexport function bar(x: number): void;\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("strip aligns offsets and preserves UTF-8 BOM on BOM-prefixed files", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-bom-"));
    try {
      const bomFile = join(dir, "bom.mjs");
      const doomedPath = join(dir, "doomed.jsonl");
      const env = { MC_COMMENTS_ROOT: dir };

      writeFileSync(
        bomFile,
        "\uFEFF// top comment\nexport const a = 1; // trailing\n// bottom comment\n",
      );

      const listRes = runCli(["list", "bom.mjs"], dir, env);
      expect(listRes.status, listRes.stderr).toBe(0);
      writeFileSync(doomedPath, listRes.stdout);

      const stripRes = runCli(["strip", doomedPath], dir, env);
      expect(stripRes.status, stripRes.stderr).toBe(0);
      expect(stripRes.stdout).toContain("stripped 3 blocks in 1 files, skipped 0, rejected 0");
      expect(readFileSync(bomFile, "utf8")).toBe("\uFEFFexport const a = 1;\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("list --out writes UTF-8 JSONL without BOM and creates missing parent directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-out-"));
    try {
      const src = join(dir, "sample.ts");
      const outRel = "nested/out/comments.jsonl";
      const outAbs = join(dir, outRel);
      const env = { MC_COMMENTS_ROOT: dir };

      writeFileSync(src, "// hello\nexport const v = 1;\n");

      const res = runCli(["list", "--out", outRel, "sample.ts"], dir, env);
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toContain(`wrote 1 blocks to ${outRel}`);

      const rawBytes = readFileSync(outAbs);
      expect(rawBytes[0]).not.toBe(0xff);
      expect(rawBytes[0]).not.toBe(0xfe);
      expect(rawBytes[0]).not.toBe(0xef);
      const rows = rawBytes
        .toString("utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ file: "sample.ts", line: 1, text: "// hello" });

      const emptyOut = runCli(["list", "--out", "", "sample.ts"], dir, env);
      expect(emptyOut.status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("strip refuses symlinked directories escaping the workspace root", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-sym-in-"));
    const outside = mkdtempSync(join(tmpdir(), "mc-comments-sym-out-"));
    try {
      const outsideFile = join(outside, "escape.ts");
      const original = "// outside comment\nexport const keep = 1;\n";
      writeFileSync(outsideFile, original);

      const linkDir = join(dir, "linked");
      symlinkSync(outside, linkDir, process.platform === "win32" ? "junction" : "dir");

      const doomedPath = join(dir, "doomed.jsonl");
      writeFileSync(
        doomedPath,
        `${JSON.stringify({ file: "linked/escape.ts", line: 1, text: "// outside comment" })}\n`,
      );

      const res = runCli(["strip", doomedPath], dir, { MC_COMMENTS_ROOT: dir });
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("symlink resolving outside workspace");
      expect(readFileSync(outsideFile, "utf8")).toBe(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("list, strip, and ratchet support Python and CSS with directive preservation and fail-closed syntax checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-comments-pycss-"));
    try {
      const pyFile = join(dir, "app.py");
      const cssFile = join(dir, "style.css");
      const ratchetPath = join(dir, "ratchet.json");
      const doomedPath = join(dir, "doomed.jsonl");
      const env = { MC_COMMENTS_RATCHET: ratchetPath, MC_COMMENTS_ROOT: dir };

      writeFileSync(
        pyFile,
        [
          "#!/usr/bin/env python3",
          "# type: ignore",
          "# prose one",
          "# prose two",
          'label = "# inside string"',
          "x = 1  # inline prose",
          "y = 2  # noqa: E501",
          "",
        ].join("\n"),
      );
      writeFileSync(
        cssFile,
        ["/* banner */", '.box { content: "/* keep */"; color: red; /* inline */ }', ""].join("\n"),
      );

      const initRes = runCli(["ratchet", "--init", "app.py", "style.css"], dir, env);
      expect(initRes.status, initRes.stderr).toBe(0);
      expect(JSON.parse(readFileSync(ratchetPath, "utf8")).files).toEqual({
        "app.py": 3,
        "style.css": 2,
      });

      const listRes = runCli(["list", "app.py", "style.css"], dir, env);
      expect(listRes.status, listRes.stderr).toBe(0);
      const rows = listRes.stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      expect(rows).toHaveLength(4);
      expect(rows[0]).toMatchObject({ file: "app.py", line: 3, end: 4, tokens: 2 });
      expect(rows[1]).toMatchObject({ file: "app.py", line: 6, tokens: 1, trailing: true });
      expect(rows[2]).toMatchObject({ file: "style.css", line: 1, tokens: 1 });
      expect(rows[3]).toMatchObject({ file: "style.css", line: 2, tokens: 1, trailing: true });

      writeFileSync(doomedPath, listRes.stdout);
      const stripRes = runCli(["strip", doomedPath], dir, env);
      expect(stripRes.status, stripRes.stderr).toBe(0);
      expect(stripRes.stdout).toContain("stripped 4 blocks in 2 files, skipped 0, rejected 0");

      expect(readFileSync(pyFile, "utf8")).toBe(
        [
          "#!/usr/bin/env python3",
          "# type: ignore",
          'label = "# inside string"',
          "x = 1",
          "y = 2  # noqa: E501",
          "",
        ].join("\n"),
      );
      expect(readFileSync(cssFile, "utf8")).toBe('.box { content: "/* keep */"; color: red; }\n');

      expect(runCli(["ratchet", "--check", "app.py", "style.css"], dir, env).status).not.toBe(0);
      const tightenRes = runCli(["ratchet", "app.py", "style.css"], dir, env);
      expect(tightenRes.status, tightenRes.stderr).toBe(0);
      expect(JSON.parse(readFileSync(ratchetPath, "utf8")).files).toEqual({});

      writeFileSync(pyFile, "def broken(:\n");
      expect(runCli(["ratchet", "--check", "app.py"], dir, env).status).not.toBe(0);

      writeFileSync(cssFile, "/* unclosed\n.a { color: red; }\n");
      expect(runCli(["ratchet", "--check", "style.css"], dir, env).status).not.toBe(0);

      writeFileSync(cssFile, '.a { content: "unclosed string; /* c */ }\n');
      expect(runCli(["ratchet", "--check", "style.css"], dir, env).status).not.toBe(0);

      writeFileSync(pyFile, "x = 1\n");
      writeFileSync(
        cssFile,
        [
          ".foo/*c*/.bar { color: red; }",
          "a/*c*/:hover { color: blue; }",
          ".col1/*c*/.active { border: 1px/*c*/solid red; margin: 1/*c*/.5em; }",
          "  /* lead */ .lead { width: 10%/*c*/20%; }",
          "@media screen and/*c*/(min-width: 1px) { .a\\'b { /* real */ background: url(https://example.com/a/*keep*/b.png); } }",
          "",
        ].join("\n"),
      );
      const cssEdgeList = runCli(["list", ".", "style.css"], dir, env);
      expect(cssEdgeList.status, cssEdgeList.stderr).toBe(0);
      const cssEdgeBlocks = cssEdgeList.stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => JSON.parse(l));
      expect(cssEdgeBlocks.every((b) => b.kind === "block")).toBe(true);
      expect(cssEdgeBlocks).toHaveLength(9);
      writeFileSync(doomedPath, cssEdgeList.stdout);
      const cssEdgeStrip = runCli(["strip", doomedPath], dir, env);
      expect(cssEdgeStrip.status, cssEdgeStrip.stderr).toBe(0);
      expect(readFileSync(cssFile, "utf8")).toBe(
        [
          ".foo.bar { color: red; }",
          "a:hover { color: blue; }",
          ".col1.active { border: 1px solid red; margin: 1 .5em; }",
          "  .lead { width: 10% 20%; }",
          "@media screen and (min-width: 1px) { .a\\'b { background: url(https://example.com/a/*keep*/b.png); } }",
          "",
        ].join("\n"),
      );

      writeFileSync(pyFile, "# py prose\nx = 1\n");
      const pyOverlap = runCli(["list", ".", "app.py"], dir, env);
      expect(pyOverlap.status, pyOverlap.stderr).toBe(0);
      const pyOverlapBlocks = pyOverlap.stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => JSON.parse(l));
      expect(pyOverlapBlocks).toHaveLength(1);
      expect(pyOverlapBlocks[0].kind).toBe("line");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cli-catalog splits multi-path comments args and adjusts effect dynamically", () => {
    const ctx = {
      project: "root",
      filmDir: REPO_ROOT,
      repoRoot: REPO_ROOT,
      envPresent: [],
      shell: "powershell",
    };

    const listInv = buildCliInvocation(
      {
        commandId: "comments",
        subcommandPath: ["list"],
        args: { paths: "packages/film-kit packages/mc-actor" },
        flags: {},
        targetFilm: "root",
      },
      ctx,
    );
    expect(listInv.argvTokens).toEqual(["list", "packages/film-kit", "packages/mc-actor"]);
    expect(listInv.meta.effect).toBe("read");

    const listOutInv = buildCliInvocation(
      {
        commandId: "comments",
        subcommandPath: ["list"],
        args: { paths: "packages/film-kit" },
        flags: { "--out": "verdicts-input.jsonl" },
        targetFilm: "root",
      },
      ctx,
    );
    expect(listOutInv.argvTokens).toEqual([
      "list",
      "packages/film-kit",
      "--out",
      "verdicts-input.jsonl",
    ]);
    expect(listOutInv.meta.effect).toBe("write");

    const dryInv = buildCliInvocation(
      {
        commandId: "comments",
        subcommandPath: ["strip"],
        args: { jsonl: "doomed.jsonl" },
        flags: { "--dry-run": true },
        targetFilm: "root",
      },
      ctx,
    );
    expect(dryInv.meta.effect).toBe("read");

    const checkInv = buildCliInvocation(
      {
        commandId: "comments",
        subcommandPath: ["ratchet"],
        args: { paths: "packages/film-kit packages/mc-actor" },
        flags: { "--check": true },
        targetFilm: "root",
      },
      ctx,
    );
    expect(checkInv.argvTokens).toEqual([
      "ratchet",
      "packages/film-kit",
      "packages/mc-actor",
      "--check",
    ]);
    expect(checkInv.meta.effect).toBe("read");

    const initInv = buildCliInvocation(
      {
        commandId: "comments",
        subcommandPath: ["ratchet"],
        args: {},
        flags: { "--init": true },
        targetFilm: "root",
      },
      ctx,
    );
    expect(initInv.meta.effect).toBe("write");
    expect(initInv.requiresConfirm).toBe(true);
  });
});
