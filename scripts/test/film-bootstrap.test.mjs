import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const put = (root, file, value) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value));
};
const run = (root, file, args = []) =>
  spawnSync(process.execPath, [join(root, file), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, MC_VAULT_EXTERNAL: join(root, "external") },
  });
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "film-bootstrap-"));
  for (const file of [
    "scripts/new_film.ts",
    "scripts/setup.mjs",
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
  ])
    put(root, file, readFileSync(join(ROOT, file), "utf8"));
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
  });
  for (const file of ["src/scene.ts", "src/edit.ts", "sound.py", ".gitignore"])
    put(root, `templates/film/${file}`, "");
  put(root, "templates/film/src/edit.json", {});
  put(root, "templates/film/pack/picks.json", []);
  return root;
};

test("init help and rejected arguments leave an existing project untouched", () => {
  const root = fixture();
  try {
    put(root, "project/package.json", { name: "kept", scripts: { studio: "custom" } });
    const before = readFileSync(join(root, "project/package.json"), "utf8");
    for (const flag of ["--help", "-h", "help", "--typo"]) {
      const r = run(
        root,
        "packages/live-studio/init.mjs",
        flag === "help" ? [flag, "project"] : ["project", flag],
      );
      expect(r.status, r.stderr).toBe(flag === "--typo" ? 2 : 0);
      expect(readFileSync(join(root, "project/package.json"), "utf8")).toBe(before);
      expect(existsSync(join(root, "project/src"))).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("init previews a new project without creating it and preserves an existing project's custom files on rerun", () => {
  const root = fixture();
  try {
    for (const flag of ["--dry-run", "--dry"]) {
      const r = run(root, "packages/live-studio/init.mjs", ["project", flag]);
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(join(root, "project"))).toBe(false);
    }
    put(root, "films/test/package.json", {
      name: "test",
      dependencies: { "live-studio": "workspace:*" },
      scripts: { studio: "custom" },
    });
    put(root, "films/test/src/scene.ts", "custom scene");
    for (let i = 0; i < 2; i++) {
      const r = run(root, "packages/live-studio/init.mjs", ["films/test"]);
      expect(r.status, r.stderr).toBe(0);
      expect(json(join(root, "films/test/package.json")).scripts.studio).toBe("custom");
      expect(readFileSync(join(root, "films/test/src/scene.ts"), "utf8")).toBe("custom scene");
      expect(realpathSync(join(root, "films/test/node_modules/live-studio"))).toBe(
        realpathSync(join(root, "packages/live-studio")),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("init reports a failed install and never claims the project is ready", () => {
  const root = fixture();
  try {
    put(root, "films/test/package.json", {
      name: "test",
      dependencies: { "live-studio": "workspace:*", "not-a-workspace": "workspace:*" },
    });
    const r = run(root, "packages/live-studio/init.mjs", ["films/test"]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("done:");
    expect(r.stderr).toContain("next:");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("new-film rejects a duplicate port and automatic overflow before copying", () => {
  const root = fixture();
  try {
    put(root, "films/old/package.json", {
      name: "old",
      scripts: { studio: "bun node_modules/live-studio/src/live.mjs 65535" },
    });
    for (const args of [["fresh", "65535"], ["fresh"]]) {
      const r = run(root, "scripts/new_film.ts", args);
      expect(r.status, r.stderr).toBe(2);
      expect(existsSync(join(root, "films/fresh"))).toBe(false);
      expect(r.stderr).toContain("port");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("new-film rejects existing workspace package names before copying", () => {
  const root = fixture();
  try {
    put(root, "films/old/package.json", { name: "different-name" });
    put(root, "package.json", {
      name: "fixture-root",
      private: true,
      workspaces: ["packages/*", "films/*"],
    });
    for (const name of ["live-studio", "different-name", "fixture-root"]) {
      const r = run(root, "scripts/new_film.ts", [name]);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toContain("workspace");
      expect(existsSync(join(root, "films", name))).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("new-film checks the vault before copying; link checks all asset targets before changing links", () => {
  const root = fixture();
  try {
    rmSync(join(root, "vault/jar"), { recursive: true });
    const created = run(root, "scripts/new_film.ts", ["fresh"]);
    expect(created.status).toBe(1);
    expect(existsSync(join(root, "films/fresh"))).toBe(false);
    put(root, "films/test/package.json", { name: "test" });
    const linked = run(root, "scripts/link.ts", ["test"]);
    expect(linked.status).toBe(1);
    expect(linked.stderr).toContain("setup:vault");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("new-film installs workspace dependencies, builds picks, and link is repeatable", () => {
  const root = fixture();
  try {
    const r = run(root, "scripts/new_film.ts", ["fresh", "47920"]);
    expect(r.status, r.stderr).toBe(0);
    const film = join(root, "films/fresh");
    expect(json(join(film, "package.json")).scripts.studio).toContain("47920");
    expect(realpathSync(join(film, "assets/public/mc"))).not.toBe(
      realpathSync(join(root, "vault/jar")),
    );
    expect(existsSync(join(film, "assets/public/picked.zip"))).toBe(true);
    expect(realpathSync(join(film, "node_modules/live-studio"))).toBe(
      realpathSync(join(root, "packages/live-studio")),
    );
    expect(r.stdout).toMatch(/next:.*films\/fresh.*studio/);
    const linked = run(root, "scripts/link.ts", ["fresh"]);
    expect(linked.status, linked.stderr).toBe(0);
    const pkg = readFileSync(join(film, "package.json"), "utf8");
    expect(run(root, "scripts/new_film.ts", ["fresh"]).status).toBe(1);
    expect(readFileSync(join(film, "package.json"), "utf8")).toBe(pkg);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty asset folders do not count as a prepared vault", () => {
  const root = fixture();
  try {
    const config = json(join(root, "vault.json"));
    put(root, "vault.json", { ...config, requiredFiles: ["jar/client_assets.zip"] });
    for (const [file, args] of [
      ["scripts/new_film.ts", ["fresh"]],
      ["scripts/link.ts", []],
    ]) {
      const r = run(root, file, args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("client_assets.zip");
      expect(r.stderr).toContain("setup:vault");
    }
    expect(existsSync(join(root, "films/fresh"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup returns failure when local assets are missing, then succeeds after restore", () => {
  const root = fixture();
  try {
    // Downloads are replaced at the network boundary; install and link still run for real.
    put(root, "scripts/setup_vault.mjs", "console.log('fixture vault prepared');");
    rmSync(join(root, "vault/packs"), { recursive: true });
    const missing = run(root, "scripts/setup.mjs");
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain("next:");
    mkdirSync(join(root, "vault/packs"), { recursive: true });
    const ready = run(root, "scripts/setup.mjs");
    expect(ready.status, ready.stderr).toBe(0);
    expect(existsSync(join(root, "vault/packs"))).toBe(true);
    expect(ready.stdout).toContain("next:");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup forwards repeatable --vault-zip arguments and completes without requiring vault/tools", () => {
  const root = fixture();
  try {
    put(root, "vault.json", {
      root: "./vault",
      requiredDirectories: ["motion", "packs", "mc-sound"],
      film_links: { mc: "jar" },
    });
    rmSync(join(root, "vault/packs"), { recursive: true });
    put(
      root,
      "scripts/setup_vault.mjs",
      `import { mkdirSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync("vault/received-args.json", JSON.stringify(args));
for (const d of ["motion", "packs", "mc-sound"]) mkdirSync("vault/" + d, { recursive: true });`,
    );
    const r = run(root, "scripts/setup.mjs", [
      "--vault-zip",
      "D:/core.zip",
      "--vault-zip",
      "D:/heavy.zip",
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(json(join(root, "vault/received-args.json"))).toEqual([
      "--vault-zip",
      "D:/core.zip",
      "--vault-zip",
      "D:/heavy.zip",
    ]);
    expect(existsSync(join(root, "vault/tools"))).toBe(false);
    expect(r.stdout).toContain("Setup complete.");
    const repoVault = json(join(ROOT, "vault.json"));
    expect(repoVault.requiredDirectories).not.toContain("tools");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
