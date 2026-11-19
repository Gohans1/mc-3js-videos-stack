import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

import {
  detectTailscaleHost,
  parseNewFilmArgs,
  parseTailscaleDnsName,
  validateRatio,
} from "../new_film.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const put = (root, file, value) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value));
};

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "new-film-ratio-"));
  for (const file of [
    "scripts/new_film.ts",
    "scripts/link.ts",
    "scripts/vault.mjs",
    "packages/live-studio/init.mjs",
    "packages/live-studio/src/cli.mjs",
    "packages/live-studio/src/compact-json.mjs",
    "packages/live-studio/src/edit-protection.mjs",
    "packages/live-studio/src/merge-edits.mjs",
    "packages/mc-assets/pick.mjs",
    "packages/mc-assets/src/catalog.ts",
    "packages/mc-assets/src/picks-manifest.ts",
  ]) {
    const src = join(ROOT, file);
    if (existsSync(src)) put(root, file, readFileSync(src, "utf8"));
  }
  cpSync(join(ROOT, "packages/live-studio/demo"), join(root, "packages/live-studio/demo"), {
    recursive: true,
  });
  put(root, "package.json", { private: true, workspaces: ["packages/*", "films/*"] });
  put(root, "packages/live-studio/package.json", { name: "live-studio", type: "module" });
  symlinkSync(
    join(ROOT, "packages/mc-assets/node_modules"),
    join(root, "packages/mc-assets/node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  put(root, "vault.json", {
    root: "./vault",
    requiredDirectories: ["packs"],
    film_links: { mc: "jar" },
  });
  mkdirSync(join(root, "vault/jar"), { recursive: true });
  mkdirSync(join(root, "vault/packs"), { recursive: true });
  mkdirSync(join(root, "films"), { recursive: true });
  put(root, "templates/film/package.json", {
    name: "__NAME__",
    type: "module",
    dependencies: { "live-studio": "workspace:*" },
    scripts: { studio: "bun node_modules/live-studio/src/live.mjs __PORT__" },
    "live-studio": { camTimeline: "src/timeline/cam.json", liveLanes: true },
  });
  for (const file of ["src/scene.ts", "src/edit.ts", "sound.py", ".gitignore"]) {
    put(root, `templates/film/${file}`, "");
  }
  put(root, "templates/film/src/edit.json", {});
  put(root, "templates/film/pack/picks.json", []);
  return root;
}

function makeFakeTailscaleBin(dir, payloadJson, exitCode = 0) {
  const binDir = join(dir, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    const jsonFile = join(binDir, "ts-status.json");
    writeFileSync(jsonFile, payloadJson);
    const cmd = join(binDir, "tailscale.cmd");
    writeFileSync(
      cmd,
      exitCode === 0
        ? `@echo off\r\ntype "${jsonFile}"\r\nexit /b 0\r\n`
        : `@echo off\r\nexit /b ${exitCode}\r\n`,
    );
  } else {
    const sh = join(binDir, "tailscale");
    writeFileSync(
      sh,
      exitCode === 0
        ? `#!/bin/sh\nprintf '%s' ${JSON.stringify(payloadJson)}\n`
        : `#!/bin/sh\nexit ${exitCode}\n`,
    );
    chmodSync(sh, 0o755);
  }
  return binDir;
}

function runNewFilm(root, args, extraEnv = {}) {
  const env = { ...process.env, MC_VAULT_EXTERNAL: join(root, "external"), ...extraEnv };
  delete env.MC_VAULT_ROOT;
  return spawnSync(process.execPath, [join(root, "scripts/new_film.ts"), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
    env,
  });
}

describe("new_film helpers", () => {
  test("parseNewFilmArgs extracts positional name/port, --ratio in any order, and flags duplicates", () => {
    expect(parseNewFilmArgs(["short-one", "--ratio", "9:16"])).toEqual({
      name: "short-one",
      portArg: undefined,
      ratio: "9:16",
    });
    expect(parseNewFilmArgs(["--ratio", "9:16", "short-one", "47920"])).toEqual({
      name: "short-one",
      portArg: "47920",
      ratio: "9:16",
    });
    expect(parseNewFilmArgs(["wide-one", "47921", "--ratio", "16:9"])).toEqual({
      name: "wide-one",
      portArg: "47921",
      ratio: "16:9",
    });
    expect(parseNewFilmArgs(["plain-one"])).toEqual({
      name: "plain-one",
      portArg: undefined,
      ratio: undefined,
    });
    expect(parseNewFilmArgs(["dup", "--ratio", "4:3", "--ratio", "9:16"])).toEqual({
      name: "dup",
      portArg: undefined,
      ratio: "9:16",
      duplicateRatio: true,
    });
  });

  test("validateRatio accepts only 16:9 and 9:16 matching contract.ts", () => {
    expect(validateRatio("16:9")).toBe("16:9");
    expect(validateRatio("9:16")).toBe("9:16");
    expect(validateRatio("4:3")).toBeNull();
    expect(validateRatio("1:1")).toBeNull();
    expect(validateRatio("")).toBeNull();
  });

  test("parseTailscaleDnsName normalizes Self.DNSName and rejects unsafe hostnames or invalid payloads", () => {
    expect(
      parseTailscaleDnsName(JSON.stringify({ Self: { DNSName: "Studio-PC.tail123.ts.net." } })),
    ).toBe("studio-pc.tail123.ts.net");
    expect(parseTailscaleDnsName(JSON.stringify({ Self: { DNSName: "my-box.ts.net" } }))).toBe(
      "my-box.ts.net",
    );
    for (const bad of ["   ", "foo/bar", "a;rm", ".leading.ts.net", "bad..host", "host\nline2"]) {
      expect(parseTailscaleDnsName(JSON.stringify({ Self: { DNSName: bad } }))).toBeNull();
    }
    expect(parseTailscaleDnsName(JSON.stringify({ Self: {} }))).toBeNull();
    expect(parseTailscaleDnsName("{not json")).toBeNull();
  });

  test("detectTailscaleHost enforces 3s timeout and returns null on missing or failing CLI", () => {
    let seenTimeout = 0;
    const host = detectTailscaleHost((cmd, args, opts) => {
      expect(cmd).toBe("tailscale");
      expect(args).toEqual(["status", "--json"]);
      seenTimeout = opts.timeout;
      return {
        status: 0,
        stdout: JSON.stringify({ Self: { DNSName: "gohans-pc.tail99.ts.net." } }),
      };
    });
    expect(seenTimeout).toBe(3000);
    expect(host).toBe("gohans-pc.tail99.ts.net");

    expect(
      detectTailscaleHost(() => ({ status: 1, stdout: "", error: new Error("ENOENT") })),
    ).toBeNull();
    expect(detectTailscaleHost(() => ({ status: 1, stdout: "" }))).toBeNull();
  });
});

describe("new_film CLI --ratio and .live_hosts seeding", () => {
  test("--help documents --ratio and invalid or duplicate --ratio exits 2 before copying", () => {
    const root = makeFixture();
    try {
      const help = runNewFilm(root, ["--help"]);
      expect(help.status, help.stderr).toBe(0);
      expect(help.stdout).toContain("--ratio");

      const bad = runNewFilm(root, ["bad-ratio", "--ratio", "4:3"]);
      expect(bad.status).toBe(2);
      expect(bad.stderr).toContain("--ratio");
      expect(existsSync(join(root, "films/bad-ratio"))).toBe(false);

      const dup = runNewFilm(root, ["dup-ratio", "--ratio", "4:3", "--ratio", "9:16"]);
      expect(dup.status).toBe(2);
      expect(dup.stderr).toContain("--ratio");
      expect(existsSync(join(root, "films/dup-ratio"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("--ratio 9:16 writes live-studio.ratio while preserving existing keys, and seeds .live_hosts via Tailscale fallback when films/ is empty", () => {
    const root = makeFixture();
    try {
      const fakeBin = makeFakeTailscaleBin(
        root,
        JSON.stringify({ Self: { DNSName: "Gohans-Box.tailabc.ts.net." } }),
      );
      const r = runNewFilm(root, ["short-vid", "47925", "--ratio", "9:16"], {
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      });
      expect(r.status, r.stderr).toBe(0);
      const pkg = json(join(root, "films/short-vid/package.json"));
      expect(pkg["live-studio"].ratio).toBe("9:16");
      expect(pkg["live-studio"].camTimeline).toBe("src/timeline/cam.json");
      expect(pkg["live-studio"].liveLanes).toBe(true);
      expect(readFileSync(join(root, "films/short-vid/.live_hosts"), "utf8").trim()).toBe(
        "gohans-box.tailabc.ts.net",
      );

      // A second film prefers copying .live_hosts from existing films over Tailscale
      writeFileSync(join(root, "films/short-vid/.live_hosts"), "custom.tail.ts.net\n");
      const r2 = runNewFilm(root, ["--ratio", "16:9", "wide-vid", "47926"], {
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      });
      expect(r2.status, r2.stderr).toBe(0);
      expect(json(join(root, "films/wide-vid/package.json"))["live-studio"].ratio).toBe("16:9");
      expect(readFileSync(join(root, "films/wide-vid/.live_hosts"), "utf8").trim()).toBe(
        "custom.tail.ts.net",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("silently skips .live_hosts when films/ is empty and tailscale fails", () => {
    const root = makeFixture();
    try {
      const failBin = makeFakeTailscaleBin(root, "", 1);
      const r = runNewFilm(root, ["no-ts", "47930"], {
        PATH: `${failBin}${delimiter}${process.env.PATH ?? ""}`,
      });
      expect(r.status, r.stderr).toBe(0);
      expect(json(join(root, "films/no-ts/package.json"))["live-studio"].ratio).toBeUndefined();
      expect(existsSync(join(root, "films/no-ts/.live_hosts"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
