import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("library requires explicit native storage/root and rejects invalid limits before creating a job", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "library-input-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, "foley.toml"),
    out = join(dir, "jobs");
  for (const [content, message, limit] of [
    ["", /library/, "20"],
    ['[library]\nroot="."', /storage/, "20"],
    [`[library]\nroot=${JSON.stringify(dir)}\n[storage]\ndata_dir=""`, /nonempty paths/, "20"],
    [
      `[library]\nroot=${JSON.stringify(dir)}\n[storage]\ndata_dir=${JSON.stringify(dir + "-cache")}`,
      /limit.*positive/,
      "0",
    ],
  ]) {
    writeFileSync(config, content);
    const r = spawnSync(
      "python",
      [
        resolve("scripts/media/library.py"),
        "index",
        "--config",
        config,
        "--limit",
        limit,
        "--out",
        out,
        "--dry-run",
      ],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, message);
    assert.equal(existsSync(out), false);
  }
  writeFileSync(
    config,
    `[library]\nroot=${JSON.stringify(dir)}\n[storage]\ndata_dir=${JSON.stringify(dir + "-cache")}\n`,
  );
  const valid = spawnSync(
    "python",
    [resolve("scripts/media/library.py"), "status", "--config", config, "--out", out, "--dry-run"],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).storage, dir + "-cache");
  assert.equal(existsSync(out), false);
});
