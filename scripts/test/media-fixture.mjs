import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { after } from "node:test";

export const mediaFixture = () => {
  const generated = new Map();
  after(() => generated.clear());
  return (file, args) => {
    const key = JSON.stringify([extname(file), args]);
    const bytes = generated.get(key);
    if (bytes) return writeFileSync(file, bytes);
    const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args, file], {
      timeout: 30_000,
    });
    assert.equal(result.status, 0, String(result.stderr || result.error));
    generated.set(key, readFileSync(file));
  };
};
