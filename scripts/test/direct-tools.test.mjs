import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const run = (exe, file, args, cwd) =>
  spawnSync(exe, [join(ROOT, file), ...args], { cwd, encoding: "utf8", timeout: 30_000 });

test("maintenance help and argument errors stop before downloads or output writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-help-"));
  try {
    const preload = join(dir, "no-network.mjs");
    writeFileSync(
      preload,
      'globalThis.fetch = () => { throw new Error("Unexpected network access"); };',
    );
    for (const [exe, file] of [
      ["bun", "packages/mc-assets/mobs.ts"],
      ["bun", "scripts/mc/slim_jar.mjs"],
      ["bun", "packages/live-studio/src/stale.mjs"],
      ["python", "scripts/compute_mc_peaks.py"],
      ["python", "scripts/render_earshot_bank.py"],
    ]) {
      for (const [arg, status] of [
        ["--help", 0],
        ["--hlep", 2],
      ]) {
        const result = spawnSync(
          exe,
          [...(exe === "bun" ? ["--preload", preload] : []), join(ROOT, file), arg],
          { cwd: dir, encoding: "utf8", timeout: 10000 },
        );
        expect(result.status, `${file} ${arg}: ${result.stderr}`).toBe(status);
        if (status === 0) expect(result.stdout).toMatch(/usage|bun |python /i);
      }
    }
    expect(readdirSync(dir)).toEqual(["no-network.mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 25000);

test("asset picking refuses a missing parent model and keeps the existing ZIP", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const { pickBlocks } = await import("../../packages/mc-assets/pick.mjs");
  const dir = mkdtempSync(join(tmpdir(), "pick-incomplete-"));
  try {
    mkdirSync(join(dir, "pack"));
    mkdirSync(join(dir, "assets/public"), { recursive: true });
    writeFileSync(join(dir, "assets/public/picked.zip"), "existing cache");
    writeFileSync(
      join(dir, "pack/picks.json"),
      JSON.stringify([{ jar: "test.jar", namespace: "decor", blocks: ["lamp"] }]),
    );
    writeFileSync(
      join(dir, "test.jar"),
      zipSync({
        "assets/decor/blockstates/lamp.json": strToU8(
          '{"variants":{"":{"model":"decor:block/lamp"}}}',
        ),
        "assets/decor/models/block/lamp.json": strToU8('{"parent":"decor:block/missing"}'),
      }),
    );
    expect(() => pickBlocks({ cwd: dir, vaultDir: dir })).toThrow(
      /model missing.*decor\/models\/block\/missing/,
    );
    expect(readFileSync(join(dir, "assets/public/picked.zip"), "utf8")).toBe("existing cache");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [exe, file] of [
  ["bun", "scripts/evals/load/compare.mjs"],
  ["bun", "scripts/evals/load/frame.mjs"],
  ["bun", "scripts/timeline_fmt.ts"],
  ["python", "scripts/timeline_fmt.py"],
  ["bun", "packages/mc-assets/pick.mjs"],
  ["python", "packages/mc-assets/pick.py"],
  ["bun", "packages/mc-assets/vendor.mjs"],
  ["python", "packages/clip-catalog/catalog_check.py"],
  ["python", "packages/clip-catalog/sheet_clip.py"],
  ["python", "packages/clip-catalog/batch.py"],
  ["python", "packages/clip-catalog/catalog_review.py"],
  ["python", "packages/clip-catalog/catalog_eval.py"],
  ["python", "packages/clip-catalog/sweep_report.py"],
]) {
  test(`${file}: help and typos never rewrite a film`, () => {
    const dir = mkdtempSync(join(tmpdir(), "direct-help-"));
    try {
      mkdirSync(join(dir, "src/timeline"), { recursive: true });
      const timeline = join(dir, "src/timeline/cam.json");
      writeFileSync(timeline, '[   { "t": 0 }   ]');
      const before = readFileSync(timeline, "utf8");
      const help = run(exe, file, ["--help"], dir);
      expect(help.status, help.stderr).toBe(0);
      expect(help.stdout).toMatch(/usage|bun |python /i);
      expect(readFileSync(timeline, "utf8")).toBe(before);
      const typo = run(exe, file, ["--hlep"], dir);
      expect(typo.status, typo.stderr).toBe(2);
      expect(readFileSync(timeline, "utf8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 65_000);
}

for (const [exe, file] of [
  ["bun", "scripts/timeline_fmt.ts"],
  ["python", "scripts/timeline_fmt.py"],
]) {
  test(`${file}: malformed later timeline leaves earlier files untouched`, () => {
    const dir = mkdtempSync(join(tmpdir(), "direct-format-"));
    try {
      mkdirSync(join(dir, "src/timeline"), { recursive: true });
      writeFileSync(join(dir, "src/timeline/a.json"), "[ 1,  2 ]");
      writeFileSync(join(dir, "src/timeline/z.json"), "{broken");
      const result = run(exe, file, [], dir);
      expect(result.status).not.toBe(0);
      expect(readFileSync(join(dir, "src/timeline/a.json"), "utf8")).toBe("[ 1,  2 ]");
      expect(result.stderr).toContain("z.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("catalogue maintenance uses isolated data and real bounded subprocesses", () => {
  const result = spawnSync("python", [join(ROOT, "packages/clip-catalog/test_tools.py")], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 65_000);
