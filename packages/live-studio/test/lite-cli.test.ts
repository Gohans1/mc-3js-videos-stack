import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultLitePort, isLiteProcessCmdline } from "../src/lite.mjs";

const LITE_BIN = join(import.meta.dir, "../src/lite.mjs");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const makeTempDir = (prefix = "studio-lite-cli-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });

const makeLiteFilmFixture = (studioPort = 4330) => {
  const dir = makeTempDir();
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "export const DURATION = 5;\n");
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 5 }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "lite-cli-film",
      scripts: {
        studio: `bun node_modules/live-studio/src/live.mjs ${studioPort}`,
        "studio:lite": "bun node_modules/live-studio/src/lite.mjs",
      },
      "live-studio": { ratio: "9:16" },
    }),
  );
  return dir;
};

describe("lite CLI helpers", () => {
  test("defaultLitePort offsets film studio port by +1000 and falls back to 5321", () => {
    const withStudio = makeLiteFilmFixture(4330);
    expect(defaultLitePort(withStudio)).toBe(5330);

    const highPort = makeLiteFilmFixture(65000);
    expect(defaultLitePort(highPort)).toBe(5321);

    const noStudio = makeTempDir();
    writeFileSync(join(noStudio, "package.json"), JSON.stringify({ name: "plain" }));
    expect(defaultLitePort(noStudio)).toBe(5321);
  });

  test("isLiteProcessCmdline matches bun lite.mjs on expected port and rejects live.mjs or other flags", () => {
    expect(isLiteProcessCmdline("bun.exe packages/live-studio/src/lite.mjs 5330", 5330)).toBe(true);
    expect(
      isLiteProcessCmdline(["bun", "node_modules/live-studio/src/lite.mjs", "5330", "--lan"], 5330),
    ).toBe(true);
    expect(isLiteProcessCmdline("bun node_modules/live-studio/src/lite.mjs", 5330)).toBe(true);
    expect(
      isLiteProcessCmdline(["bun", "node_modules/live-studio/src/lite.mjs", "--lan"], 5330),
    ).toBe(true);
    expect(isLiteProcessCmdline("bun packages/live-studio/src/lite.mjs 5330", 5331)).toBe(false);
    expect(isLiteProcessCmdline("bun packages/live-studio/src/live.mjs 5330", 5330)).toBe(false);
    expect(isLiteProcessCmdline("node packages/live-studio/src/lite.mjs 5330", 5330)).toBe(false);
    expect(isLiteProcessCmdline("bun packages/live-studio/src/lite.mjs 5330 --detach", 5330)).toBe(
      false,
    );
  });
});

describe("lite CLI argument handling and detached lifecycle", () => {
  test("prints help on --help and help without starting a server", () => {
    for (const args of [["--help"], ["help"], ["5555", "help"]]) {
      const r = spawnSync(process.execPath, [LITE_BIN, ...args], {
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("studio:lite");
    }
  }, 20_000);

  test("rejects conflicting flags, invalid ports, and non-film directories", () => {
    const film = makeLiteFilmFixture();
    for (const args of [
      ["--detach", "--stop"],
      ["--status", "--lan"],
      ["--stop", "--lan"],
      ["--port", "5330"],
      ["999"],
      ["5330", "5331"],
    ]) {
      const r = spawnSync(process.execPath, [LITE_BIN, ...args], {
        cwd: film,
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(r.status).toBe(2);
    }

    const notFilm = makeTempDir();
    const missing = spawnSync(process.execPath, [LITE_BIN, "--status"], {
      cwd: notFilm,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(missing.status).toBe(1);
  }, 20_000);

  test("starts detached on a custom port, tracks studio-lite.json separately, enforces host/origin security, reports status, and stops cleanly", async () => {
    const film = makeLiteFilmFixture(4330);
    const port = await getFreePort();
    const fixtureEntry = makeTempDir("lite-entry-");
    const fixtureOut = makeTempDir("lite-out-");
    writeFileSync(
      join(fixtureEntry, "index.html"),
      '<!doctype html><html><head><title>Lite</title></head><body><div id="root">ok</div><script type="module" src="./main.ts"></script></body></html>',
    );
    writeFileSync(join(fixtureEntry, "main.ts"), 'console.log("ok");\n');

    const env = {
      ...process.env,
      LIVE_PROJECT: film,
      LIVE_LITE_ROOT: fixtureEntry,
      LIVE_LITE_OUT: fixtureOut,
    };

    try {
      const start = spawnSync(process.execPath, [LITE_BIN, String(port), "--detach"], {
        cwd: film,
        env,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(start.status, start.stderr || start.stdout).toBe(0);
      expect(start.stdout).toContain(`http://localhost:${port}`);

      const infoFile = join(film, "renders/live/studio-lite.json");
      const fullStudioFile = join(film, "renders/live/studio.json");
      expect(existsSync(infoFile)).toBe(true);
      expect(existsSync(fullStudioFile)).toBe(false);
      const info = JSON.parse(readFileSync(infoFile, "utf8"));
      expect(info.port).toBe(port);
      expect(info.mode).toBe("lite");
      expect(Number.isInteger(info.pid)).toBe(true);

      const metaRes = await fetch(`http://127.0.0.1:${port}/api/film.json`);
      expect(metaRes.status).toBe(200);
      expect(metaRes.headers.get("x-content-type-options")).toBe("nosniff");
      expect(metaRes.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(metaRes.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
      const meta = await metaRes.json();
      expect(meta.lite).toBe(true);
      expect(meta.port).toBe(port);

      const crossSite = await fetch(`http://127.0.0.1:${port}/api/notes`, {
        headers: { "sec-fetch-site": "cross-site" },
      });
      expect(crossSite.status).toBe(403);

      const status = spawnSync(process.execPath, [LITE_BIN, "--status"], {
        cwd: film,
        env,
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(status.status, status.stderr).toBe(0);
      expect(status.stdout).toContain(`http://localhost:${port}`);
      expect(status.stdout).toContain(`pid: ${info.pid}`);

      const duplicateFg = spawnSync(process.execPath, [LITE_BIN, String(port)], {
        cwd: film,
        env,
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(duplicateFg.status).toBe(1);
      expect(duplicateFg.stderr).toContain(`already runs at http://localhost:${port}`);
      expect(duplicateFg.stderr).not.toContain("EADDRINUSE");

      const stop = spawnSync(process.execPath, [LITE_BIN, "--stop"], {
        cwd: film,
        env,
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(stop.status, stop.stderr).toBe(0);
      expect(existsSync(infoFile)).toBe(false);

      const afterStop = spawnSync(process.execPath, [LITE_BIN, "--status"], {
        cwd: film,
        env,
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(afterStop.status).toBe(1);
    } finally {
      spawnSync(process.execPath, [LITE_BIN, "--stop"], {
        cwd: film,
        env,
        encoding: "utf8",
        timeout: 10_000,
      });
    }
  }, 60_000);
});
