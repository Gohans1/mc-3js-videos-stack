import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildLitePage,
  computeLiteSignature,
  ensureLitePage,
  LITE_ASSETS,
  readCachedLitePage,
} from "../src/lite-page.mjs";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const makeFixtureRoot = () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-lite-page-"));
  tempDirs.push(dir);
  const root = join(dir, "entry");
  const outDir = join(dir, "out");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><html><head><title>Lite</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
  );
  writeFileSync(
    join(root, "main.tsx"),
    `export const message = ${JSON.stringify("hello-lite-".repeat(160))};\ndocument.getElementById("root")!.textContent = message;\n`,
  );
  return { dir, root, outDir };
};

describe("lite-page standalone cached build", () => {
  test("builds once with precompressed _lite assets, caches warm starts, and rebuilds when sources change", async () => {
    const { root, outDir } = makeFixtureRoot();

    const sig1 = computeLiteSignature({ root });
    const first = await buildLitePage({ root, outDir });
    expect(first.cached).toBe(false);
    expect(first.dir).toBe(outDir);
    expect(first.error()).toBeNull();
    expect(first.html()).toMatch(new RegExp(`/${LITE_ASSETS}/index-[\\w-]+\\.js`));
    expect(existsSync(join(outDir, ".build-sig.json"))).toBe(true);

    const assetsDir = join(outDir, LITE_ASSETS);
    const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
    expect(jsFiles.length).toBeGreaterThan(0);
    expect(existsSync(join(assetsDir, `${jsFiles[0]}.br`))).toBe(true);
    expect(existsSync(join(assetsDir, `${jsFiles[0]}.gz`))).toBe(true);

    const t0 = performance.now();
    const second = await buildLitePage({ root, outDir });
    const warmMs = performance.now() - t0;
    expect(second.cached).toBe(true);
    expect(second.html()).toBe(first.html());
    expect(warmMs).toBeLessThan(200);

    writeFileSync(
      join(root, "main.tsx"),
      `export const message = ${JSON.stringify("updated-lite-".repeat(160))};\ndocument.getElementById("root")!.textContent = message;\n`,
    );
    const sig2 = computeLiteSignature({ root });
    expect(sig2).not.toBe(sig1);

    const third = await buildLitePage({ root, outDir });
    expect(third.cached).toBe(false);
    expect(third.html()).not.toBe(first.html());
  }, 60000);

  test("readCachedLitePage returns null before build and ensureLitePage builds in an isolated child process", async () => {
    const { root, outDir } = makeFixtureRoot();

    expect(readCachedLitePage({ root, outDir })).toBeNull();

    const first = await ensureLitePage({ root, outDir });
    expect(first.cached).toBe(false);
    expect(first.dir).toBe(outDir);
    expect(first.html()).toMatch(new RegExp(`/${LITE_ASSETS}/index-[\\w-]+\\.js`));
    expect(existsSync(join(outDir, ".build-sig.json"))).toBe(true);

    const cached = readCachedLitePage({ root, outDir });
    expect(cached).not.toBeNull();
    expect(cached!.cached).toBe(true);
    expect(cached!.html()).toBe(first.html());

    const t0 = performance.now();
    const second = await ensureLitePage({ root, outDir });
    const warmMs = performance.now() - t0;
    expect(second.cached).toBe(true);
    expect(second.html()).toBe(first.html());
    expect(warmMs).toBeLessThan(150);
  }, 60000);
});
