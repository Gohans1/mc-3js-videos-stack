import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../media.mjs", import.meta.url));
const run = (args, env = {}) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, ...env },
  });

test("media discovery and tool help work without installed environments or downloads", (t) => {
  const home = mkdtempSync(join(tmpdir(), "media-cli-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const list = run(["list", "--json"], { MC_MEDIA_HOME: join(home, "empty") });
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).find((tool) => tool.id === "ocr").name, "RapidOCR");
  assert.equal(Object.hasOwn(JSON.parse(list.stdout)[0], "installed"), false);
  for (const args of [
    ["ocr", "--help"],
    ["ocr", "help"],
    ["ocr", "--help", "--minutes", "nan"],
  ]) {
    const help = run(args, { MC_MEDIA_HOME: join(home, "empty") });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Read text/);
  }
  assert.equal(existsSync(join(home, "empty")), false);
});

test("bad tool arguments fail before creating media jobs", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-invalid-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const args of [
    ["missing"],
    ["ocr", join(dir, "missing.mp4")],
    ["ocr", "--minutes", "nan"],
    ["ocr", "--out"],
  ]) {
    const result = run([...args, "--out", join(dir, "evidence")]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(existsSync(join(dir, "evidence")), false);
  }
});

test("media setup help works before selecting a tool and never creates an environment", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-setup-help-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const args of [
    ["setup", "--help"],
    ["setup", "help"],
    ["setup", "--help", "--minutes", "nan"],
  ]) {
    const result = run(args, { MC_MEDIA_HOME: join(dir, "empty") });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Optional local media tools/);
    assert.equal(existsSync(join(dir, "empty")), false);
  }
});

test("equals-style output flags cannot bypass fresh evidence folders or overwrite prior results", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-output-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = join(dir, "existing"),
    source = join(dir, "source.png"),
    out = join(dir, "evidence");
  mkdirSync(old);
  writeFileSync(join(old, "result.json"), "kept");
  writeFileSync(source, "not decoded by argument validation");
  const result = run(["ocr", source, `--out=${old}`, "--out", out], {
    MC_MEDIA_HOME: join(dir, "empty"),
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /space|instead of =/);
  assert.equal(readFileSync(join(old, "result.json"), "utf8"), "kept");
  assert.equal(existsSync(out), false);
});
