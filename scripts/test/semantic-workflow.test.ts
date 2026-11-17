import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { openBudget } from "../semantic/budget";
import { type Asset, openIndex } from "../semantic/store";

const vector = Array.from({ length: 768 }, (_, i) => (i ? 0 : 1));
const environment = (folder: string) => ({
  ...process.env,
  GEMINI_API_KEY: "",
  GOOGLE_API_KEY: "",
  OPENROUTER_API_KEY: "",
  MC_VAULT_ROOT: join(folder, "vault"),
  MC_VAULT_EXTERNAL: join(folder, "external"),
  MC_SEMANTIC_DB: join(folder, "vectors.sqlite"),
  MC_SEMANTIC_MANIFEST: join(folder, "assets.json"),
  MC_SEMANTIC_QUOTA_DB: join(folder, "requests.sqlite"),
  MC_SEMANTIC_DAILY_LIMIT: "1000",
});
const cli = (folder: string, ...args: string[]) =>
  Bun.spawnSync([process.execPath, "--no-env-file", "scripts/asset-search.ts", ...args], {
    env: environment(folder),
    timeout: 10000,
  });

test("a configured manifest and durable index are used by preview without creating data files", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-config-"));
  try {
    writeFileSync(
      join(folder, "assets.json"),
      JSON.stringify([{ key: "rain", title: "Rain", text: "rain" }]),
    );
    const preview = cli(folder, "build");
    expect(preview.exitCode, preview.stderr.toString()).toBe(0);
    const result = JSON.parse(preview.stdout.toString());
    expect(result.assets).toBe(1);
    expect(result.db).toBe(join(folder, "vectors.sqlite"));
    expect(existsSync(join(folder, "vectors.sqlite"))).toBe(false);
    expect(existsSync(join(folder, "requests.sqlite"))).toBe(false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a missing configured manifest is an error instead of silently embedding the unrestricted catalog", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-config-missing-"));
  try {
    const preview = cli(folder, "plan");
    expect(preview.exitCode).toBe(1);
    expect(preview.stderr.toString()).toContain("assets.json");
    expect(existsSync(join(folder, "vectors.sqlite"))).toBe(false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("status measures the configured catalog instead of treating staged assets as the entire corpus", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-coverage-"));
  const assets: Asset[] = ["complete", "pending", "partial", "changed", "failed", "unindexed"].map(
    (key) => ({ key, title: key, text: key }),
  );
  const index = openIndex(join(folder, "vectors.sqlite"));
  try {
    writeFileSync(join(folder, "assets.json"), JSON.stringify(assets));
    index.stage(assets[0]!, "text", [{ from: 0, to: 0 }]);
    index.complete(index.pending("complete")[0]!, { vector, usage: {} });
    index.stage(assets[1]!, "text", [{ from: 0, to: 0 }]);
    index.stage(assets[2]!, "text", [
      { from: 0, to: 30 },
      { from: 30, to: 60 },
    ]);
    index.complete(index.pending("partial")[0]!, { vector, usage: {} });
    index.stage({ ...assets[3]!, text: "old caption" }, "text", [{ from: 0, to: 0 }]);
    index.complete(index.pending("changed")[0]!, { vector, usage: {} });
    index.assetFailed("failed", "missing source");
    index.stage({ key: "retained", title: "Retained", text: "not in current catalog" }, "text", [
      { from: 0, to: 0 },
    ]);
    index.complete(index.pending("retained")[0]!, { vector, usage: {} });
    const status = cli(folder, "status");
    expect(status.exitCode, status.stderr.toString()).toBe(0);
    expect(JSON.parse(status.stdout.toString()).coverage).toEqual({
      catalog: 6,
      complete: 1,
      pending: 1,
      partial: 1,
      changed: 1,
      failed: 1,
      unindexed: 1,
      retainedOutsideCatalog: 1,
      mediaHashesChecked: false,
    });
    expect(existsSync(join(folder, "requests.sqlite"))).toBe(false);
  } finally {
    index.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("build, resume and cached queries share one durable request budget across database overrides", async () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-ready-"));
  const env = {
    ...environment(folder),
    GEMINI_API_KEY: "offline-fixture",
    MC_SEMANTIC_DAILY_LIMIT: "3",
  };
  let calls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      calls++;
      const input = await request.json();
      const axis = input.content.parts[0].text.includes("Wind") ? 1 : 0;
      return Response.json({
        embedding: { values: Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0)) },
      });
    },
  });
  const preload = join(folder, "network.mjs");
  writeFileSync(
    preload,
    `const original=globalThis.fetch;globalThis.fetch=(url,options)=>{if(!String(url).startsWith('https://generativelanguage.googleapis.com/'))throw new Error('Unexpected external request');return original(${JSON.stringify(String(server.url))},options)};`,
  );
  const execute = async (args: string[], overrides: Record<string, string> = {}) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--preload",
        preload,
        fileURLToPath(new URL("../asset-search.ts", import.meta.url)),
        ...args,
      ],
      { env: { ...env, ...overrides }, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exit };
  };
  try {
    writeFileSync(
      env.MC_SEMANTIC_MANIFEST,
      JSON.stringify([
        { key: "rain", title: "Rain", text: "steady rain" },
        { key: "wind", title: "Wind", text: "cave wind" },
      ]),
    );
    const first = await execute(["build", "--yes", "--max-requests", "1"]);
    expect(first.exit, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout).stopped).toBe("request-limit");
    const resumed = await execute(["build", "--yes", "--max-requests", "1"]);
    expect(resumed.exit, resumed.stderr).toBe(0);
    expect(JSON.parse(resumed.stdout).requests).toBe(1);
    const query = await execute(["query", "rain", "--yes"]);
    expect(query.exit, query.stderr).toBe(0);
    expect(JSON.parse(query.stdout)[0].key).toBe("rain");
    const cached = await execute(["query", "rain"], { GEMINI_API_KEY: "" });
    expect(cached.exit, cached.stderr).toBe(0);
    expect(JSON.parse(cached.stdout)[0].key).toBe("rain");
    expect(calls).toBe(3);
    const blocked = await execute(["build", "--yes", "--db", join(folder, "other.sqlite")], {
      GEMINI_API_KEY: "another-offline-credential",
    });
    expect(JSON.parse(blocked.stdout).stopped).toBe("daily-limit");
    expect(JSON.parse(blocked.stdout).requests).toBe(0);
    const status = await execute(["status"]);
    expect(JSON.parse(status.stdout).budget).toMatchObject({ used: 3, remaining: 0, limit: 3 });
    const backupFile = join(folder, "saved.sqlite");
    const backup = await execute(["backup", backupFile]);
    expect(backup.exit, backup.stderr).toBe(0);
    expect(JSON.parse(backup.stdout).budgetBackup).toBe(`${backupFile}.requests.sqlite`);
    const savedBudget = openBudget(`${backupFile}.requests.sqlite`, 3);
    try {
      expect(savedBudget.status().used).toBe(3);
    } finally {
      savedBudget.close();
    }
    expect(calls).toBe(3);
  } finally {
    server.stop(true);
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a vector override cannot overwrite the shared quota ledger", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-path-guard-"));
  try {
    writeFileSync(join(folder, "assets.json"), "[]");
    const result = cli(folder, "plan", "--db", join(folder, "requests.sqlite"));
    expect(result.exitCode).toBe(2);
    expect(existsSync(join(folder, "requests.sqlite"))).toBe(false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("invalid shared budget configuration is a usage error without data writes", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-invalid-config-"));
  try {
    const result = Bun.spawnSync(
      [process.execPath, "--no-env-file", "scripts/asset-search.ts", "plan"],
      {
        env: { ...environment(folder), MC_SEMANTIC_DAILY_LIMIT: "0" },
        timeout: 5000,
      },
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("MC_SEMANTIC_DAILY_LIMIT");
    expect(existsSync(join(folder, "requests.sqlite"))).toBe(false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("film commands inherit root dotenv defaults while explicit environment and Bun env flags keep precedence", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-film-env-"));
  const film = join(folder, "film");
  mkdirSync(join(folder, "scripts/semantic"), { recursive: true });
  mkdirSync(film);
  copyFileSync(
    fileURLToPath(new URL("../vault.mjs", import.meta.url)),
    join(folder, "scripts/vault.mjs"),
  );
  copyFileSync(
    fileURLToPath(new URL("../semantic/settings.ts", import.meta.url)),
    join(folder, "scripts/semantic/settings.ts"),
  );
  writeFileSync(
    join(folder, "vault.json"),
    JSON.stringify({ root: "vault", externalRoot: "external" }),
  );
  writeFileSync(join(folder, ".env"), "MC_VAULT_ROOT=base-vault\n");
  writeFileSync(
    join(folder, ".env.local"),
    "MC_VAULT_ROOT=shared-vault\nMC_SEMANTIC_DB=.state/vectors.sqlite\nMC_SEMANTIC_QUOTA_DB=.state/requests.sqlite\nMC_SEMANTIC_MANIFEST=.state/assets.json\nMC_SEMANTIC_DAILY_LIMIT=42\nGEMINI_API_KEY=fixture-root\n",
  );
  const probe = join(folder, "probe.mjs");
  writeFileSync(
    probe,
    "import{LOCAL}from'./scripts/vault.mjs';import{semanticSettings}from'./scripts/semantic/settings.ts';console.log(JSON.stringify({vault:LOCAL,...semanticSettings(),rootKeyLoaded:process.env.GEMINI_API_KEY==='fixture-root'}));",
  );
  const env = { ...process.env, NODE_ENV: "development" };
  for (const name of [
    "MC_VAULT_ROOT",
    "MC_VAULT_EXTERNAL",
    "MC_SEMANTIC_DB",
    "MC_SEMANTIC_MANIFEST",
    "MC_SEMANTIC_QUOTA_DB",
    "MC_SEMANTIC_DAILY_LIMIT",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENROUTER_API_KEY",
  ])
    delete env[name];
  const inspect = (flags: string[] = [], overrides: Record<string, string> = {}) => {
    const child = Bun.spawnSync([process.execPath, ...flags, probe], {
      cwd: film,
      env: { ...env, ...overrides },
      timeout: 5000,
    });
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    return JSON.parse(child.stdout.toString());
  };
  try {
    expect(inspect()).toMatchObject({
      vault: join(folder, "shared-vault"),
      db: join(folder, ".state/vectors.sqlite"),
      quotaDb: join(folder, ".state/requests.sqlite"),
      manifest: join(folder, ".state/assets.json"),
      dailyLimit: 42,
      rootKeyLoaded: true,
    });
    expect(
      inspect([], { MC_VAULT_ROOT: "caller-vault", GEMINI_API_KEY: "fixture-caller" }),
    ).toMatchObject({ vault: join(folder, "caller-vault"), rootKeyLoaded: false });
    expect(inspect(["--no-env-file"])).toMatchObject({
      vault: join(folder, "vault"),
      dailyLimit: 1000,
      rootKeyLoaded: false,
    });
    const profile = join(folder, "isolated.env");
    writeFileSync(profile, "GEMINI_API_KEY=fixture-profile\n");
    expect(inspect([`--env-file=${profile}`])).toMatchObject({
      vault: join(folder, "vault"),
      rootKeyLoaded: false,
    });
    expect(inspect([], { NODE_ENV: "test" })).toMatchObject({
      vault: join(folder, "base-vault"),
      rootKeyLoaded: false,
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
