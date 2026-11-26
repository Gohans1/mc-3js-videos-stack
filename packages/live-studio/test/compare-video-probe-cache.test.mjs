import { expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const childProcess = await import("node:child_process");
const execFile = () => {};
let probes = 0;
execFile[promisify.custom] = async () => {
  probes++;
  return {
    stdout: JSON.stringify({ streams: [{ codec_type: "video", width: 320, height: 180 }] }),
  };
};
mock.module("node:child_process", () => ({ ...childProcess, execFile }));
const { probeCompareVideo } = await import("../src/compare-videos.mjs");

test("concurrent metadata requests share a probe for the same video revision", async () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-probe-cache-"));
  try {
    const path = "renders/draft.mp4";
    mkdirSync(join(dir, "renders"));
    writeFileSync(join(dir, path), "first revision");

    const results = await Promise.all(
      Array.from({ length: 4 }, () => probeCompareVideo(dir, path)),
    );

    expect(results).toEqual(Array(4).fill(expect.objectContaining({ ok: true, path, width: 320 })));
    expect(probes).toBe(1);
    await probeCompareVideo(dir, path);
    expect(probes).toBe(1);

    writeFileSync(join(dir, path), "second video revision");
    await probeCompareVideo(dir, path);
    expect(probes).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
