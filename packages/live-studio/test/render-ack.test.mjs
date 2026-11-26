import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const render = fileURLToPath(new URL("../render.mjs", import.meta.url));
const chrome = fileURLToPath(
  new URL("../../../vault/tools/chrome-headless-shell/chrome-headless-shell.exe", import.meta.url),
);

test("render reports a refused still upload as a failure in headless Chrome", (t) => {
  if (!existsSync(chrome)) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  const dir = mkdtempSync(join(tmpdir(), "render-ack-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "renders/blocked.jpg"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": { chrome } }));
  writeFileSync(join(dir, "src/edit.json"), '{"end":1}');
  writeFileSync(join(dir, "src/edit.ts"), 'export { EDIT } from "live-studio/edit";');
  writeFileSync(
    join(dir, "src/scene.ts"),
    `export const DURATION = 1;
export const SHOTS_OUT = [{ t: 0 }];
export function buildScene() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  return Object.assign(() => {}, { checks: { ack: () => ({ still: "blocked.jpg", canvas }) } });
}`,
  );

  const result = spawnSync("bun", [render, "stills", "--check", "ack", "--fresh-cache"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, LIVE_PROJECT: dir },
  });

  assert.ifError(result.error);
  const said = result.stdout + result.stderr;
  assert.equal(result.status, 1, said);
  assert.match(said, /ERROR .*POST \/still\/blocked\.jpg: HTTP 500/);
  assert.doesNotMatch(said, /wrote renders\/blocked\.jpg/);
});

test("a partial chunk write leaves the previous render intact", (t) => {
  if (!existsSync(chrome)) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  const dir = mkdtempSync(join(tmpdir(), "render-chunk-ack-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const chunkDir = join(dir, "renders/chunks");
  const chunk = join(chunkDir, "c00.mp4");
  mkdirSync(chunkDir, { recursive: true });
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "lab"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": { chrome } }));
  writeFileSync(join(dir, "src/edit.json"), '{"end":1}');
  writeFileSync(join(dir, "src/edit.ts"), 'export { EDIT } from "live-studio/edit";');
  writeFileSync(join(dir, "src/scene.ts"), "export const DURATION = 1;");
  writeFileSync(
    join(dir, "lab/chunk.ts"),
    'import { done, post } from "live-studio/lab"; await post("/chunk/0", "replacement"); await done(1);',
  );
  writeFileSync(chunk, "previous complete chunk");
  const preload = join(dir, "partial-write.mjs");
  writeFileSync(
    preload,
    `import * as fs from "node:fs";
import { mock } from "bun:test";
const write = fs.writeFileSync;
mock.module("node:fs", () => ({
  ...fs,
  writeFileSync(file, data, ...options) {
    if (typeof file === "string" && file.startsWith(${JSON.stringify(chunk)})) {
      write(file, data.subarray(0, 2), ...options);
      throw Object.assign(new Error("Injected disk full"), { code: "ENOSPC" });
    }
    return write(file, data, ...options);
  }
}));`,
  );
  const result = spawnSync(
    "bun",
    [
      "--preload",
      preload,
      render,
      "clip",
      "--entry",
      "lab/chunk.ts",
      "--chunks",
      "0",
      "--fresh-cache",
    ],
    { cwd: dir, encoding: "utf8", timeout: 15000, env: { ...process.env, LIVE_PROJECT: dir } },
  );

  assert.ifError(result.error);
  const said = result.stdout + result.stderr;
  assert.equal(result.status, 1, said);
  assert.match(said, /ERROR .*POST \/chunk\/0: HTTP 500/);
  assert.equal(readFileSync(chunk, "utf8"), "previous complete chunk");
  assert.deepEqual(readdirSync(chunkDir), ["c00.mp4"]);
});
