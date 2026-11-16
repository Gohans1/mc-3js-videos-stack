import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SYNC_TS = join(ROOT, "scripts/voice/sync.ts");

const temps = [];
const makeTemp = (prefix = "setup-voices-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop(), { recursive: true, force: true });
  }
});

const runSync = async (args, cwd, envExtra = {}) => {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  for (const [k, v] of Object.entries(envExtra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const proc = Bun.spawn([process.execPath, SYNC_TS, ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { status, stdout, stderr };
};

const rawVoice = (id, name, language = "en", v4 = true) => ({
  voice_id: id,
  name,
  language,
  category: "professional",
  use_case: "narrative_story",
  verified_languages: v4 ? [{ language, model_id: "eleven_v4" }] : [],
});

describe("setup:voices CLI (scripts/voice/sync.ts)", () => {
  test("prints help with Next: and exits 0 before checking film cwd, broken vault.json, or missing keys", async () => {
    const dir = makeTemp();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/scene.ts"), "export {};\n");
    writeFileSync(join(dir, "vault.json"), "{broken");

    for (const flag of ["--help", "-h", "help"]) {
      const r = await runSync([flag], dir, { GENVOICE_API_KEY: "", ELEVENLABS_API_KEY: "" });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Sync all English voices");
      expect(r.stdout).toContain("ELEVENLABS_API_KEY");
      expect(r.stdout).toContain("GENVOICE_API_KEY");
      expect(r.stdout).toMatch(/^Next:\s+/m);
      expect(r.stderr).toBe("");
    }
  });

  test("rejects unknown flags and extra positional args with exit 2 before doing work", async () => {
    const dir = makeTemp();
    for (const bad of [["--bogus"], ["--yes"], ["extra"]]) {
      const r = await runSync(bad, dir, { GENVOICE_API_KEY: "", ELEVENLABS_API_KEY: "" });
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("--help");
    }
  });

  test("stops with exit 2 when run directly inside a film directory (src/scene.ts present)", async () => {
    const dir = makeTemp();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/scene.ts"), "export {};\n");

    const r = await runSync([], dir, { GENVOICE_API_KEY: "gv_unused" });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("whole repo, not one film");
    expect(r.stderr).toContain("bun run setup:voices");
  });

  test("fails cleanly without stack trace when API keys are missing or whitespace", async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, "vault.json"), JSON.stringify({ root: "./vault" }));

    const r = await runSync([], dir, { GENVOICE_API_KEY: "   ", ELEVENLABS_API_KEY: "" });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/API key/i);
    expect(r.stderr).not.toContain("at <anonymous>");
    expect(r.stderr.trim().split(/\r?\n/).at(-1)).toMatch(/^next:\s+/);
  });

  test("rejects invalid API base URLs with exit 2 before syncing", async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, "vault.json"), JSON.stringify({ root: "./vault" }));

    const r = await runSync([], dir, {
      GENVOICE_API_KEY: "gv_test",
      ELEVENLABS_API_KEY: "",
      GENVOICE_API_BASE: "not-a-url",
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("GENVOICE_API_BASE");
    expect(r.stderr.trim().split(/\r?\n/).at(-1)).toMatch(/^next:\s+/);
  });

  test("reports malformed vault.json instead of silently writing elsewhere", async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, "vault.json"), "{not-valid-json");

    const r = await runSync([], dir, { GENVOICE_API_KEY: "gv_test", ELEVENLABS_API_KEY: "" });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("vault.json");
    expect(r.stderr).not.toContain("at <anonymous>");
    expect(r.stderr.trim().split(/\r?\n/).at(-1)).toMatch(/^next:\s+/);
  });

  test("fails fast without stack trace when cacheFile path is unwritable", async () => {
    const dir = makeTemp();
    mkdirSync(join(dir, "vault"), { recursive: true });
    writeFileSync(join(dir, "vault.json"), JSON.stringify({ root: "./vault" }));
    writeFileSync(join(dir, "vault/voices"), "file-blocking-dir");

    let hitServer = false;
    const server = Bun.serve({
      port: 0,
      fetch() {
        hitServer = true;
        return Response.json({ has_more: false, voices: [] });
      },
    });
    try {
      const r = await runSync([], dir, {
        GENVOICE_API_KEY: "gv_test",
        ELEVENLABS_API_KEY: "",
        GENVOICE_API_BASE: `http://127.0.0.1:${server.port}/v1`,
      });
      expect(r.status).toBe(1);
      expect(hitServer).toBe(false);
      expect(r.stderr).toContain("shared-en.json");
      expect(r.stderr).not.toContain("at writeJsonAtomic");
      expect(r.stderr.trim().split(/\r?\n/).at(-1)).toMatch(/^next:\s+/);
    } finally {
      server.stop(true);
    }
  });

  test("syncs paginated English voices against mock server, writes cache atomically, and ends with next:", async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, "vault.json"), JSON.stringify({ root: "./custom-vault" }));

    const seenAuth = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        seenAuth.push(req.headers.get("xi-api-key") ?? "");
        const p = Number(new URL(req.url).searchParams.get("page") ?? "0");
        if (p === 0) {
          return Response.json({
            has_more: true,
            voices: [rawVoice("en_1", "Alpha", "en", true), rawVoice("fr_1", "French", "fr", true)],
          });
        }
        if (p === 1) {
          return Response.json({
            has_more: false,
            voices: [rawVoice("en_2", "Beta", "en", false)],
          });
        }
        return new Response("Page out of range", { status: 404 });
      },
    });
    try {
      const r = await runSync([], dir, {
        GENVOICE_API_KEY: "gv_ok_key",
        ELEVENLABS_API_KEY: "",
        GENVOICE_API_BASE: `http://127.0.0.1:${server.port}/v1`,
      });
      expect(r.status).toBe(0);
      expect(seenAuth[0]).toBe("gv_ok_key");
      const lines = r.stdout.trim().split(/\r?\n/);
      expect(lines.some((l) => l.includes("Done in "))).toBe(true);
      expect(lines.at(-1)).toMatch(/^next:\s+/);

      const cacheFile = join(dir, "custom-vault/voices/shared-en.json");
      expect(existsSync(cacheFile)).toBe(true);
      const saved = JSON.parse(readFileSync(cacheFile, "utf8"));
      expect(saved.source).toBe("genvoice");
      expect(saved.totalScanned).toBe(3);
      expect(saved.totalEnglish).toBe(2);
      expect(saved.totalEnglishV4).toBe(1);
      expect(saved.truncated).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("prefers ELEVENLABS_API_KEY over GENVOICE_API_KEY and ignores whitespace ELEVENLABS_API_KEY", async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, "vault.json"), JSON.stringify({ root: "./vault" }));
    const dead = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const deadPort = dead.port;
    dead.stop(true);

    const seen = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push(req.headers.get("xi-api-key") ?? "");
        return Response.json({
          has_more: false,
          voices: [rawVoice("el_1", "Eleven Voice", "en", true)],
        });
      },
    });
    try {
      const r1 = await runSync([], dir, {
        GENVOICE_API_KEY: "gv_ignored",
        ELEVENLABS_API_KEY: "el_preferred",
        GENVOICE_API_BASE: `http://127.0.0.1:${deadPort}/v1`,
        ELEVENLABS_API_BASE: `http://127.0.0.1:${server.port}/v1`,
      });
      expect(r1.status).toBe(0);
      expect(seen).toEqual(["el_preferred"]);
      const saved1 = JSON.parse(readFileSync(join(dir, "vault/voices/shared-en.json"), "utf8"));
      expect(saved1.source).toBe("elevenlabs");
      expect(saved1.voices.map((v) => v.id)).toEqual(["el_1"]);

      const r2 = await runSync([], dir, {
        GENVOICE_API_KEY: "gv_fallback",
        ELEVENLABS_API_KEY: "   ",
        GENVOICE_API_BASE: `http://127.0.0.1:${server.port}/v1`,
        ELEVENLABS_API_BASE: `http://127.0.0.1:${deadPort}/v1`,
      });
      expect(r2.status).toBe(0);
      expect(seen).toEqual(["el_preferred", "gv_fallback"]);
      const saved2 = JSON.parse(readFileSync(join(dir, "vault/voices/shared-en.json"), "utf8"));
      expect(saved2.source).toBe("genvoice");
    } finally {
      server.stop(true);
    }
  });

  test("redacts echoed secret on HTTP 401 and exits 1 cleanly without stack trace", async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, "vault.json"), JSON.stringify({ root: "./vault" }));

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(`Rejected token ${req.headers.get("xi-api-key") ?? ""}`, {
          status: 401,
        });
      },
    });
    try {
      const r = await runSync([], dir, {
        GENVOICE_API_KEY: "gv_super_secret_token",
        ELEVENLABS_API_KEY: "",
        GENVOICE_API_BASE: `http://127.0.0.1:${server.port}/v1`,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("401");
      expect(r.stderr).toContain("[redacted]");
      expect(r.stderr).toContain("GENVOICE_API_KEY");
      expect(r.stderr).not.toContain("gv_super_secret_token");
      expect(r.stderr).not.toContain("at <anonymous>");
      expect(r.stderr.trim().split(/\r?\n/).at(-1)).toMatch(/^next:\s+/);
    } finally {
      server.stop(true);
    }
  });

  test("handles connection refused network error cleanly without stack trace", async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, "vault.json"), JSON.stringify({ root: "./vault" }));
    const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const deadPort = probe.port;
    probe.stop(true);

    const r = await runSync([], dir, {
      GENVOICE_API_KEY: "gv_net_err",
      ELEVENLABS_API_KEY: "",
      GENVOICE_API_BASE: `http://127.0.0.1:${deadPort}/v1`,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Voice sync failed/i);
    expect(r.stderr).not.toContain("gv_net_err");
    expect(r.stderr).not.toContain("at <anonymous>");
    expect(r.stderr.trim().split(/\r?\n/).at(-1)).toMatch(/^next:\s+/);
  });

  test("exits 1 with actionable message and next: when sync is truncated", async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, "vault.json"), JSON.stringify({ root: "./vault" }));

    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          has_more: true,
          voices: [rawVoice("loop_1", "Looping Voice", "en", true)],
        });
      },
    });
    try {
      const r = await runSync([], dir, {
        GENVOICE_API_KEY: "gv_loop",
        ELEVENLABS_API_KEY: "",
        GENVOICE_API_BASE: `http://127.0.0.1:${server.port}/v1`,
      });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("Done in ");
      expect(r.stderr).toMatch(/stopped early|truncated/i);
      expect(r.stderr.trim().split(/\r?\n/).at(-1)).toMatch(/^next:\s+/);

      const saved = JSON.parse(readFileSync(join(dir, "vault/voices/shared-en.json"), "utf8"));
      expect(saved.truncated).toBe(true);
      expect(saved.totalEnglish).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("preserves env-selected provider and apiKey when API base URL names the other provider", async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, "vault.json"), JSON.stringify({ root: "./vault" }));

    const hits = [];
    let rejectNext = false;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const key = req.headers.get("xi-api-key") ?? "";
        const path = new URL(req.url).pathname;
        hits.push({ path, key });
        if (rejectNext) {
          return new Response(`Rejected ${key}`, { status: 401 });
        }
        return Response.json({
          has_more: false,
          voices: [rawVoice("p_1", "Proxy Voice", "en", true)],
        });
      },
    });
    try {
      const r1 = await runSync([], dir, {
        ELEVENLABS_API_KEY: "el_secret_1",
        GENVOICE_API_KEY: "",
        ELEVENLABS_API_BASE: `http://127.0.0.1:${server.port}/genvoice-proxy/v1`,
      });
      expect(r1.status).toBe(0);
      const saved1 = JSON.parse(readFileSync(join(dir, "vault/voices/shared-en.json"), "utf8"));
      expect(saved1.source).toBe("elevenlabs");

      const r2 = await runSync([], dir, {
        ELEVENLABS_API_KEY: "el_secret_2",
        GENVOICE_API_KEY: "gv_other_2",
        ELEVENLABS_API_BASE: `http://127.0.0.1:${server.port}/genvoice-proxy/v1`,
      });
      expect(r2.status).toBe(0);
      const saved2 = JSON.parse(readFileSync(join(dir, "vault/voices/shared-en.json"), "utf8"));
      expect(saved2.source).toBe("elevenlabs");

      const r3 = await runSync([], dir, {
        ELEVENLABS_API_KEY: "",
        GENVOICE_API_KEY: "gv_secret_3",
        GENVOICE_API_BASE: `http://127.0.0.1:${server.port}/elevenlabs-proxy/v1`,
      });
      expect(r3.status).toBe(0);
      const saved3 = JSON.parse(readFileSync(join(dir, "vault/voices/shared-en.json"), "utf8"));
      expect(saved3.source).toBe("genvoice");

      expect(hits).toEqual([
        { path: "/genvoice-proxy/v1/shared-voices", key: "el_secret_1" },
        { path: "/genvoice-proxy/v1/shared-voices", key: "el_secret_2" },
        { path: "/elevenlabs-proxy/v1/shared-voices", key: "gv_secret_3" },
      ]);

      rejectNext = true;
      const r4 = await runSync([], dir, {
        ELEVENLABS_API_KEY: "el_secret_401",
        GENVOICE_API_KEY: "gv_other_401",
        ELEVENLABS_API_BASE: `http://127.0.0.1:${server.port}/genvoice-proxy/v1`,
      });
      expect(r4.status).toBe(1);
      expect(r4.stderr).toContain("[redacted]");
      expect(r4.stderr).toContain("ELEVENLABS_API_KEY");
      expect(r4.stderr).not.toContain("el_secret_401");
      expect(r4.stderr).not.toContain("gv_other_401");
    } finally {
      server.stop(true);
    }
  });

  test("fails fast before hitting server when existing shared-en.json is read-only", async () => {
    const dir = makeTemp();
    writeFileSync(join(dir, "vault.json"), JSON.stringify({ root: "./vault" }));
    const voicesDir = join(dir, "vault/voices");
    mkdirSync(voicesDir, { recursive: true });
    const cacheFile = join(voicesDir, "shared-en.json");
    writeFileSync(cacheFile, "{}");
    chmodSync(cacheFile, 0o444);

    let hitServer = false;
    const server = Bun.serve({
      port: 0,
      fetch() {
        hitServer = true;
        return Response.json({ has_more: false, voices: [] });
      },
    });
    try {
      const r = await runSync([], dir, {
        GENVOICE_API_KEY: "gv_test",
        ELEVENLABS_API_KEY: "",
        GENVOICE_API_BASE: `http://127.0.0.1:${server.port}/v1`,
      });
      expect(r.status).toBe(1);
      expect(hitServer).toBe(false);
      expect(r.stderr).toContain("shared-en.json");
      expect(r.stderr).not.toContain("at <anonymous>");
      expect(r.stderr.trim().split(/\r?\n/).at(-1)).toMatch(/^next:\s+/);
    } finally {
      chmodSync(cacheFile, 0o666);
      server.stop(true);
    }
  });
});
