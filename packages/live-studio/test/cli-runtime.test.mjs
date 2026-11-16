import { afterEach, describe, expect, test } from "bun:test";
import {
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
import { fileURLToPath } from "node:url";

import { createApi } from "../src/api.mjs";
import {
  createCliRunner,
  readEnvStatus,
  scanCliContext,
  sliceUtf8ToByteLimit,
} from "../src/cli-runner.ts";
import { openCliTemplates } from "../src/cli-templates.ts";
import { openFavorites } from "../src/favorites.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const dirs = [];
const cleanups = [];

const tempDir = (prefix = "cli-runtime-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (cleanups.length) {
    try {
      cleanups.pop()();
    } catch {
      /* ignore teardown error */
    }
  }
  while (dirs.length) {
    rmSync(dirs.pop(), { recursive: true, force: true });
  }
});

function makeApiHarness(filmDir, { repoRoot, probeStudioPort, templatesFile, bashBin } = {}) {
  const events = new Set();
  const send = () => {};
  const film = {
    PROJECT: filmDir,
    PUBLIC: join(filmDir, "public"),
    ASSETS: join(filmDir, "assets"),
    LITE: join(filmDir, "lite"),
    WORK: join(filmDir, "renders/live"),
    RENDERS: join(filmDir, "renders"),
    EDIT: join(filmDir, "src/edit.json"),
    VOICE_MAP: join(filmDir, "src/voice_map.json"),
    favoritesDir: join(filmDir, "favorites"),
    sound: null,
    voice: null,
    lessonFiles: null,
    grades: null,
    readChoices: () => ({}),
    choose: () => {},
    shotComments: () => [],
    trials: () => null,
    notes: {
      list: () => [],
      read: () => [],
      add: () => ({}),
      edit: () => ({}),
      remove: () => ({}),
      restore: () => ({}),
      flush: () => {},
    },
    readEdit: () => ({}),
    timeline: () => ({}),
    openRead: () => {
      throw new Error("unused");
    },
  };
  const page = {
    dir: filmDir,
    html: () => "<html><head></head><body></body></html>",
    error: () => null,
  };
  const lessons = {
    list: () => [],
    read: () => ({ error: "none" }),
    write: () => ({ error: "none" }),
    create: () => ({ error: "none" }),
  };
  const favorites = openFavorites(join(filmDir, "favorites", "default.json"));
  const cliContextOpts = {
    ...(repoRoot ? { repoRoot } : {}),
    ...(probeStudioPort ? { probeStudioPort } : {}),
    ...(bashBin ? { bashBin } : {}),
  };
  const cliRunner = createCliRunner(film, cliContextOpts);
  cleanups.push(() => cliRunner.stopActive());
  const cliTemplates = openCliTemplates(templatesFile ?? join(filmDir, "cli-templates.json"));
  const api = createApi(film, {
    page,
    events,
    send,
    lessons,
    favorites,
    cliRunner,
    cliTemplates,
    cliContextOpts,
  });
  return { api, cliRunner, cliTemplates };
}

function makeFixtureRepo() {
  const root = tempDir("cli-repo-");
  const filmDir = join(root, "films", "test-film");
  mkdirSync(join(filmDir, "renders/live"), { recursive: true });
  mkdirSync(join(filmDir, "renders"), { recursive: true });
  mkdirSync(join(filmDir, "src"), { recursive: true });
  mkdirSync(join(root, "skills"), { recursive: true });
  mkdirSync(join(root, "favorites"), { recursive: true });
  mkdirSync(join(root, "packages", "live-studio"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "packages", "live-studio", "init.mjs"),
    'console.log("stub-init " + JSON.stringify(process.argv.slice(2)));\n',
  );
  writeFileSync(
    join(root, "scripts", "timeline_fmt.ts"),
    'console.log("timeline-cwd=" + process.cwd());\n',
  );
  writeFileSync(
    join(root, "emit_render.mjs"),
    [
      'if (process.env.LAB_VIEW === "mb-overflow") {',
      '  process.stdout.write("a" + "😀".repeat(600000));',
      "} else {",
      '  console.log("render-entry=" + (process.env.ENTRY ?? ""));',
      "}",
    ].join("\n"),
  );

  writeFileSync(join(filmDir, "renders/draft_video.mp4"), "stub");
  writeFileSync(join(filmDir, "src/edit.json"), JSON.stringify({ scenes: [] }));
  writeFileSync(
    join(root, "emit_ansi.mjs"),
    [
      'process.stdout.write("\\x1b[31mANSI-OUT\\x1b[0m " + JSON.stringify(process.argv.slice(2)) + "\\n");',
      'process.stderr.write("STDERR-LINE\\n");',
      "process.exit(2);",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "long_tree.mjs"),
    [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      "const pidFile = process.argv[2];",
      'const gc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });',
      'writeFileSync(pidFile, String(gc.pid), "utf8");',
      'process.stdout.write("READY\\n");',
      "setInterval(() => {}, 1000);",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture-repo",
      scripts: {
        "new-film": 'bun -e "process.exit(0)"',
        find: `bun ${JSON.stringify(join(root, "emit_ansi.mjs"))}`,
        test: `bun ${JSON.stringify(join(root, "long_tree.mjs"))}`,
        help: "bun -e \"console.log('fixture-help')\"",
      },
    }),
  );
  writeFileSync(
    join(filmDir, "package.json"),
    JSON.stringify({
      name: "test-film",
      scripts: {
        at: `bun ${JSON.stringify(join(root, "emit_ansi.mjs"))}`,
        render: `bun ${JSON.stringify(join(root, "emit_render.mjs"))}`,
      },
    }),
  );

  return { root, filmDir };
}

test("rejects hidden spending flags before spawning a command", async () => {
  const { root, filmDir } = makeFixtureRepo();
  const { api, cliRunner } = makeApiHarness(filmDir, {
    repoRoot: root,
    probeStudioPort: async () => false,
  });
  const res = await api.fetch(
    new Request("http://localhost/api/cli/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "voice:gen",
        targetFilm: "test-film",
        args: { ids: ["--yes"] },
      }),
    }),
  );
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe("INVALID_ARGS");
  expect(cliRunner.getRuns().active).toBeNull();
  expect(cliRunner.getRuns().last).toBeNull();
});

function parseSseText(raw) {
  const events = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    if (!block.trim() || block.trim().startsWith(":")) continue;
    let event = "message";
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) events.push({ event, data: JSON.parse(dataLines.join("\n")) });
  }
  return events;
}

describe("cli-templates atomic persistence & integrity", () => {
  test("creates, updates, enforces limits, and refuses to overwrite corrupt files", () => {
    const dir = tempDir();
    const file = join(dir, "cli-templates.json");
    const store = openCliTemplates(file);

    expect(store.list()).toEqual([]);

    const created = store.upsert({
      name: "Quick Stills",
      commandId: "render",
      args: { target: "stills" },
      env: { AT: "12,24" },
      targetFilm: "active",
      pinned: true,
    });
    expect(created.template.id).toBeTruthy();
    expect(created.templates).toHaveLength(1);
    expect(existsSync(file)).toBe(true);

    const updated = store.upsert({
      id: created.template.id,
      name: "Quick Stills v2",
      commandId: "render",
      args: { target: "stills" },
      env: { AT: "12,24,36" },
      targetFilm: "active",
    });
    expect(updated.template.createdAt).toBe(created.template.createdAt);
    expect(updated.template.pinned).toBe(true);
    expect(updated.templates).toHaveLength(1);

    expect(() => store.upsert({ name: "Bad", commandId: "not-a-cmd" })).toThrow(
      "Unknown CLI command",
    );

    expect(store.remove("missing-id").removed).toBe(false);
    const removed = store.remove(created.template.id);
    expect(removed.removed).toBe(true);
    expect(removed.templates).toEqual([]);

    // 100-template cap
    for (let i = 0; i < 100; i++) {
      store.upsert({ name: `Tpl ${i}`, commandId: "help" });
    }
    expect(() => store.upsert({ name: "Overflow", commandId: "help" })).toThrow(
      "Template limit reached",
    );

    // Corrupt file protection: list() returns [], upsert/remove refuse to overwrite
    const corrupt = "{not json!!!";
    writeFileSync(file, corrupt, "utf8");
    expect(store.list()).toEqual([]);
    expect(() => store.upsert({ name: "X", commandId: "help" })).toThrow("refusing to overwrite");
    expect(() => store.remove("anything")).toThrow("refusing to overwrite");
    expect(readFileSync(file, "utf8")).toBe(corrupt);
  });
});

describe("/api/cli routes, security & process runtime", () => {
  test("GET /api/cli/catalog exposes context, booleans-only envStatus, and never leaks secrets", async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "TOP_SECRET_VALUE_MUST_NOT_LEAK";
    cleanups.push(() => {
      if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevKey;
    });

    const { root, filmDir } = makeFixtureRepo();
    const { api } = makeApiHarness(filmDir, { repoRoot: root, probeStudioPort: async () => false });
    const res = await api.fetch(new Request("http://localhost/api/cli/catalog"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("TOP_SECRET_VALUE_MUST_NOT_LEAK");

    const data = JSON.parse(text);
    expect(data.context.activeFilm).toBe("test-film");
    expect(data.context.isDemo).toBe(false);
    expect(data.context.envStatus.GEMINI_API_KEY).toBe(true);
    for (const v of Object.values(data.context.envStatus)) {
      expect(typeof v).toBe("boolean");
    }
    expect(data.context.choices.renders).toContain("renders/draft_video.mp4");
    expect(data.context.choices.filmDirs).toContain("films/test-film");

    // Demo context when filmDir is outside repo films/
    const demoDir = tempDir("demo-outside-");
    const demoCtx = await scanCliContext(
      { PROJECT: demoDir },
      { repoRoot: root, probeStudioPort: async () => false },
    );
    expect(demoCtx.isDemo).toBe(true);
    expect(demoCtx.activeFilm).toBeNull();
  });

  test("rejects unknown commands, traversal paths, disallowed env, null bytes, guards, confirms & bad JSON", async () => {
    const { root, filmDir } = makeFixtureRepo();
    const { api } = makeApiHarness(filmDir, { repoRoot: root, probeStudioPort: async () => false });

    const postRun = (body) =>
      api.fetch(
        new Request("http://localhost/api/cli/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      );

    expect((await postRun("{bad")).status).toBe(400);

    const unknown = await postRun({ commandId: "does-not-exist" });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).code).toBe("UNKNOWN_COMMAND");

    const badFilm = await postRun({ commandId: "at", targetFilm: "../escape" });
    expect(badFilm.status).toBe(400);
    expect((await badFilm.json()).code).toBe("INVALID_ARGS");

    const badEntry = await postRun({
      commandId: "render",
      args: { target: "stills" },
      env: { ENTRY: "../../etc/passwd" },
    });
    expect(badEntry.status).toBe(400);
    expect((await badEntry.json()).code).toBe("INVALID_ARGS");

    const badEnv = await postRun({
      commandId: "find",
      env: { NODE_OPTIONS: "--require=/tmp/evil.js" },
    });
    expect(badEnv.status).toBe(400);
    expect((await badEnv.json()).code).toBe("INVALID_ARGS");

    const nullByte = await postRun({ commandId: "find", args: { words: "a\0b" } });
    expect(nullByte.status).toBe(400);
    expect((await nullByte.json()).code).toBe("INVALID_ARGS");

    const guarded = await postRun({ commandId: "studio" });
    expect(guarded.status).toBe(400);
    expect((await guarded.json()).code).toBe("GUARDED");

    for (const badTools of ["false", "0"]) {
      const mcpGuarded = await postRun({
        commandId: "earshot",
        subcommandPath: ["mcp"],
        flags: { "--tools": badTools },
      });
      expect(mcpGuarded.status).toBe(400);
      expect((await mcpGuarded.json()).code).toBe("GUARDED");
    }

    const unconfirmed = await postRun({
      commandId: "render",
      args: { target: "final" },
      confirmed: false,
    });
    expect(unconfirmed.status).toBe(400);
    const unconfJson = await unconfirmed.json();
    expect(unconfJson.code).toBe("CONFIRM_REQUIRED");
    expect(unconfJson.confirmMessage).toBeTruthy();

    const noHelp = await postRun({ commandId: "mc:slim-jar", mode: "help" });
    expect(noHelp.status).toBe(400);
    expect((await noHelp.json()).code).toBe("NO_HELP");

    expect(
      (await api.fetch(new Request("http://localhost/api/cli/runs/missing/stream"))).status,
    ).toBe(404);
    expect(
      (
        await api.fetch(
          new Request("http://localhost/api/cli/runs/missing/stop", { method: "POST" }),
        )
      ).status,
    ).toBe(404);
  });

  test("template CRUD HTTP endpoints match API contract", async () => {
    const { root, filmDir } = makeFixtureRepo();
    const { api } = makeApiHarness(filmDir, { repoRoot: root, probeStudioPort: async () => false });

    const r0 = await api.fetch(new Request("http://localhost/api/cli/templates"));
    expect(r0.status).toBe(200);
    expect(await r0.json()).toEqual({ templates: [], warning: null });

    const r1 = await api.fetch(
      new Request("http://localhost/api/cli/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Find SFX", commandId: "find", flags: { "--kind": "sfx" } }),
      }),
    );
    expect(r1.status).toBe(200);
    const created = await r1.json();
    expect(created.template.name).toBe("Find SFX");
    expect(created.templates).toHaveLength(1);

    const rDel = await api.fetch(
      new Request(`http://localhost/api/cli/templates/${created.template.id}`, {
        method: "DELETE",
      }),
    );
    expect(rDel.status).toBe(200);
    expect(await rDel.json()).toEqual({ ok: true, templates: [] });

    const rDelMissing = await api.fetch(
      new Request("http://localhost/api/cli/templates/missing", { method: "DELETE" }),
    );
    expect(rDelMissing.status).toBe(404);

    const rTooLong = await api.fetch(
      new Request("http://localhost/api/cli/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "N".repeat(81), commandId: "find" }),
      }),
    );
    expect(rTooLong.status).toBe(400);
    const tooLongJson = await rTooLong.json();
    expect(typeof tooLongJson.error).toBe("string");
    expect(tooLongJson.error).toContain("80");
  });

  test("streams ANSI-stripped stdout/stderr, preserves exit code 2, and replays SSE by afterSeq", async () => {
    const { root, filmDir } = makeFixtureRepo();
    const { api } = makeApiHarness(filmDir, { repoRoot: root, probeStudioPort: async () => false });

    const startRes = await api.fetch(
      new Request("http://localhost/api/cli/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "find",
          targetFilm: "root",
          args: { words: "door creak" },
        }),
      }),
    );
    expect(startRes.status).toBe(202);
    const started = await startRes.json();
    expect(started.runId).toBeTruthy();

    const streamRes = await api.fetch(
      new Request(`http://localhost/api/cli/runs/${started.runId}/stream`),
    );
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("cache-control")).toBe("no-store");
    const events = parseSseText(await streamRes.text());

    const chunks = events.filter((e) => e.event === "chunk").map((e) => e.data);
    const done = events.find((e) => e.event === "done")?.data;
    expect(done).toBeDefined();
    expect(done.status).toBe("done");
    expect(done.exitCode).toBe(2);

    const joinedOut = chunks
      .filter((c) => c.stream === "stdout")
      .map((c) => c.chunk)
      .join("");
    const joinedErr = chunks
      .filter((c) => c.stream === "stderr")
      .map((c) => c.chunk)
      .join("");
    expect(joinedOut).toContain('ANSI-OUT ["door","creak"]');
    expect(joinedOut).not.toContain("\u001b[");
    expect(joinedErr).toContain("STDERR-LINE");

    // Reconnect replay from first chunk seq skips earlier chunks cleanly
    const firstSeq = chunks[0].seq;
    const replayRes = await api.fetch(
      new Request(`http://localhost/api/cli/runs/${started.runId}/stream?afterSeq=${firstSeq}`),
    );
    const replayEvents = parseSseText(await replayRes.text());
    const replayChunks = replayEvents.filter((e) => e.event === "chunk").map((e) => e.data);
    expect(replayChunks.every((c) => c.seq > firstSeq)).toBe(true);
    expect(replayEvents.some((e) => e.event === "done")).toBe(true);
  });

  test("enforces 409 BUSY while active and kills process tree on /stop", async () => {
    const { root, filmDir } = makeFixtureRepo();
    const { api } = makeApiHarness(filmDir, { repoRoot: root, probeStudioPort: async () => false });
    const pidFile = join(root, "grandchild.pid");

    const startRes = await api.fetch(
      new Request("http://localhost/api/cli/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "test", args: { filter: pidFile } }),
      }),
    );
    expect(startRes.status).toBe(202);
    const { runId } = await startRes.json();

    const streamRes = await api.fetch(new Request(`http://localhost/api/cli/runs/${runId}/stream`));
    const reader = streamRes.body.getReader();
    const dec = new TextDecoder();
    let collected = "";
    while (!collected.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      collected += dec.decode(value, { stream: true });
    }
    expect(collected).toContain("READY");

    const busyRes = await api.fetch(
      new Request("http://localhost/api/cli/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "find" }),
      }),
    );
    expect(busyRes.status).toBe(409);
    const busyBody = await busyRes.json();
    expect(busyBody.code).toBe("BUSY");
    expect(busyBody.activeRunId).toBe(runId);

    const runsRes = await api.fetch(new Request("http://localhost/api/cli/runs"));
    const runsBody = await runsRes.json();
    expect(runsBody.active?.runId).toBe(runId);

    const stopRes = await api.fetch(
      new Request(`http://localhost/api/cli/runs/${runId}/stop`, { method: "POST" }),
    );
    expect(stopRes.status).toBe(200);
    expect((await stopRes.json()).ok).toBe(true);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      collected += dec.decode(value, { stream: true });
    }
    const events = parseSseText(collected);
    const doneEv = events.find((e) => e.event === "done")?.data;
    expect(doneEv?.status).toBe("stopped");

    // Verify grandchild PID is gone as well
    const gcPid = Number(readFileSync(pidFile, "utf8").trim());
    expect(Number.isInteger(gcPid) && gcPid > 0).toBe(true);
    let alive = true;
    for (let i = 0; i < 20; i++) {
      try {
        process.kill(gcPid, 0);
      } catch {
        alive = false;
        break;
      }
      await Bun.sleep(50);
    }
    expect(alive).toBe(false);
  });

  test("executes real repo `bun run help` end-to-end through createApi", async () => {
    const { api } = makeApiHarness(join(REPO_ROOT, "films", "cell-break"), {
      repoRoot: REPO_ROOT,
      probeStudioPort: async () => false,
    });
    const res = await api.fetch(
      new Request("http://localhost/api/cli/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "help", targetFilm: "root" }),
      }),
    );
    expect(res.status).toBe(202);
    const { runId } = await res.json();
    const sse = parseSseText(
      await (await api.fetch(new Request(`http://localhost/api/cli/runs/${runId}/stream`))).text(),
    );
    const done = sse.find((e) => e.event === "done")?.data;
    const out = sse
      .filter((e) => e.event === "chunk")
      .map((e) => e.data.chunk)
      .join("");
    expect(done?.status).toBe("done");
    expect(done?.exitCode).toBe(0);
    expect(out).toContain("bun run");
  });

  test("enforces studio:init path containment (including symlinks) and eval:load --film validation", async () => {
    const { root, filmDir } = makeFixtureRepo();
    const outsideDir = tempDir("cli-outside-");
    symlinkSync(outsideDir, join(root, "films", "escape-link"), "junction");

    const { api } = makeApiHarness(filmDir, { repoRoot: root });
    const postRun = (body) =>
      api.fetch(
        new Request("http://localhost/api/cli/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );

    for (const badProject of [
      "../outside",
      "/tmp/evil",
      "C:\\tmp\\evil",
      ".",
      "..",
      "films",
      "packages/live-studio",
      "films/escape-link",
      "films/escape-link/nested",
    ]) {
      const res = await postRun({
        commandId: "studio:init",
        mode: "execute",
        args: { project: badProject },
        flags: { "--dry": true },
        confirmed: true,
      });
      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.code).toBe("INVALID_ARGS");
    }

    for (const goodProject of ["films/test-film", "films/brand-new"]) {
      const res = await postRun({
        commandId: "studio:init",
        mode: "execute",
        args: { project: goodProject },
        flags: { "--dry": true },
        confirmed: true,
      });
      expect(res.status).toBe(202);
      const started = await res.json();
      const streamRes = await api.fetch(
        new Request(`http://localhost/api/cli/runs/${started.runId}/stream`),
      );
      expect(streamRes.status).toBe(200);
      const events = parseSseText(await streamRes.text());
      const done = events.find((e) => e.event === "done")?.data;
      const out = events
        .filter((e) => e.event === "chunk")
        .map((e) => e.data.chunk)
        .join("");
      expect(done?.status).toBe("done");
      expect(done?.exitCode).toBe(0);
      expect(out).toContain(goodProject);
    }

    for (const badFilm of ["../evil", "missing-film", "escape-link"]) {
      const res = await postRun({
        commandId: "eval:load",
        mode: "execute",
        flags: { "--film": badFilm },
      });
      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.code).toBe("INVALID_ARGS");
    }
  });

  test("readEnvStatus detects bare token keys and KEY=val while ignoring empty/comment/other keys", () => {
    const fakeHome = tempDir("cli-home-");
    const secretsDir = join(fakeHome, ".secrets");
    mkdirSync(secretsDir, { recursive: true });

    const prev = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      OPENCODE_API_KEY: process.env.OPENCODE_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    };
    cleanups.push(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.OPENCODE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    // Blank + comment + empty value + wrong key => false
    writeFileSync(
      join(secretsDir, "opencode_zen.env"),
      "\n# sk-comment-ignored\nOPENCODE_API_KEY=\nOTHER_KEY=secret\n",
    );
    writeFileSync(join(secretsDir, "openrouter.env"), "# comment\nexport OPENROUTER_API_KEY=   \n");
    expect(readEnvStatus().OPENCODE_API_KEY).toBe(false);
    expect(readEnvStatus().OPENROUTER_API_KEY).toBe(false);

    // Bare single-token key supported by packages/clip-catalog/jev.py
    writeFileSync(join(secretsDir, "opencode_zen.env"), "# comment\n\nsk-zen-bare-token-123\n");
    writeFileSync(join(secretsDir, "openrouter.env"), "export OPENROUTER_API_KEY=sk-or-export-1\n");
    expect(readEnvStatus().OPENCODE_API_KEY).toBe(true);
    expect(readEnvStatus().OPENROUTER_API_KEY).toBe(true);

    // Standard KEY=val
    writeFileSync(join(secretsDir, "opencode_zen.env"), "OPENCODE_API_KEY=sk-zen-kv\n");
    expect(readEnvStatus().OPENCODE_API_KEY).toBe(true);
  });

  test("enforces ENTRY symlink/drive/empty containment inside resolvedCwd and runs film-cwd bun-file from repoRoot", async () => {
    const { root, filmDir } = makeFixtureRepo();
    const outsideDir = tempDir("cli-entry-outside-");
    symlinkSync(outsideDir, join(filmDir, "escape-link"), "junction");
    symlinkSync(join(outsideDir, "missing-dir"), join(filmDir, "broken-link"), "junction");

    const { api } = makeApiHarness(filmDir, { repoRoot: root });
    const postRun = (body) =>
      api.fetch(
        new Request("http://localhost/api/cli/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );

    for (const badEntry of [
      "",
      "   ",
      ".",
      "C:prop.ts",
      "C:\\prop.ts",
      "/etc/passwd",
      "../other.ts",
      "escape-link/prop.ts",
      "escape-link/nested/prop.ts",
      "broken-link/prop.ts",
    ]) {
      const res = await postRun({
        commandId: "render",
        args: { target: "stills" },
        env: { ENTRY: badEntry },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_ARGS");
    }

    const okRender = await postRun({
      commandId: "render",
      args: { target: "stills" },
      env: { ENTRY: "lab/custom.ts" },
    });
    expect(okRender.status).toBe(202);
    const renderRun = await okRender.json();
    const renderEvents = parseSseText(
      await (
        await api.fetch(new Request(`http://localhost/api/cli/runs/${renderRun.runId}/stream`))
      ).text(),
    );
    expect(renderEvents.find((e) => e.event === "done")?.data.exitCode).toBe(0);
    expect(
      renderEvents
        .filter((e) => e.event === "chunk")
        .map((e) => e.data.chunk)
        .join(""),
    ).toContain("render-entry=lab/custom.ts");

    // Film-cwd bun-file displays ../../ prefix while spawning repoRoot/scripts/timeline_fmt.ts inside filmDir
    const okFmt = await postRun({ commandId: "timeline:fmt" });
    expect(okFmt.status).toBe(202);
    const fmtRun = await okFmt.json();
    expect(fmtRun.displayCommand).toBe("bun ../../scripts/timeline_fmt.ts");
    const fmtEvents = parseSseText(
      await (
        await api.fetch(new Request(`http://localhost/api/cli/runs/${fmtRun.runId}/stream`))
      ).text(),
    );
    expect(fmtEvents.find((e) => e.event === "done")?.data.exitCode).toBe(0);
    const fmtOut = fmtEvents
      .filter((e) => e.event === "chunk")
      .map((e) => e.data.chunk)
      .join("");
    expect(fmtOut).toContain(`timeline-cwd=${realpathSync(filmDir)}`);
  });

  test("truncates multibyte UTF-8 stdout strictly within 2 MB without splitting surrogate pairs", async () => {
    // Unit boundary checks for sliceUtf8ToByteLimit across 1, 3, and 4-byte code points
    expect(sliceUtf8ToByteLimit("a😀b😀", 0)).toBe("");
    expect(sliceUtf8ToByteLimit("a😀b😀", 1)).toBe("a");
    expect(sliceUtf8ToByteLimit("a😀b😀", 4)).toBe("a");
    expect(sliceUtf8ToByteLimit("a😀b😀", 5)).toBe("a😀");
    expect(sliceUtf8ToByteLimit("a😀b😀", 6)).toBe("a😀b");
    expect(sliceUtf8ToByteLimit("a😀b😀", 9)).toBe("a😀b");
    expect(sliceUtf8ToByteLimit("a😀b😀", 10)).toBe("a😀b😀");
    expect(sliceUtf8ToByteLimit("你好世界", 5)).toBe("你");

    const { root, filmDir } = makeFixtureRepo();
    const { api } = makeApiHarness(filmDir, { repoRoot: root });

    const startRes = await api.fetch(
      new Request("http://localhost/api/cli/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "render",
          args: { target: "stills" },
          env: { LAB_VIEW: "mb-overflow" },
        }),
      }),
    );
    expect(startRes.status).toBe(202);
    const started = await startRes.json();

    const streamRes = await api.fetch(
      new Request(`http://localhost/api/cli/runs/${started.runId}/stream`),
    );
    expect(streamRes.status).toBe(200);
    const events = parseSseText(await streamRes.text());
    const done = events.find((e) => e.event === "done")?.data;
    expect(done?.truncated).toBe(true);

    const chunks = events.filter((e) => e.event === "chunk").map((e) => e.data);
    const contentText = chunks
      .filter((c) => !c.chunk.includes("[live-studio] Output truncated"))
      .map((c) => c.chunk)
      .join("");
    expect(Buffer.byteLength(contentText, "utf8")).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(contentText).not.toContain("\uFFFD");
    expect(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(contentText),
    ).toBe(false);
  });

  test("prevents TOCTOU concurrent run spawns during async scanCliContext and surfaces corrupt templates warning on GET", async () => {
    const { root, filmDir } = makeFixtureRepo();
    const corruptFile = join(filmDir, "corrupt-templates.json");
    writeFileSync(corruptFile, "{broken json", "utf8");

    const { api } = makeApiHarness(filmDir, {
      repoRoot: root,
      templatesFile: corruptFile,
      probeStudioPort: async () => {
        await Bun.sleep(60);
        return false;
      },
    });

    const tRes = await api.fetch(new Request("http://localhost/api/cli/templates"));
    expect(tRes.status).toBe(200);
    const tBody = await tRes.json();
    expect(tBody.templates).toEqual([]);
    expect(tBody.warning).toContain("Malformed cli-templates.json");
    expect(readFileSync(corruptFile, "utf8")).toBe("{broken json");

    const fireRun = () =>
      api.fetch(
        new Request("http://localhost/api/cli/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: "help" }),
        }),
      );

    const [resA, resB] = await Promise.all([fireRun(), fireRun()]);
    expect([resA.status, resB.status].toSorted((a, b) => a - b)).toEqual([202, 409]);
    const winnerRes = resA.status === 202 ? resA : resB;
    const loserRes = resA.status === 409 ? resA : resB;
    expect((await loserRes.json()).code).toBe("BUSY");

    const winner = await winnerRes.json();
    const stream = await api.fetch(
      new Request(`http://localhost/api/cli/runs/${winner.runId}/stream`),
    );
    expect(stream.status).toBe(200);
    await stream.text();
  });

  test("rejects targetFilm 'root' on film-only commands while running dual-mode commands at repo root", async () => {
    const { root, filmDir } = makeFixtureRepo();
    const { api } = makeApiHarness(filmDir, { repoRoot: root });

    const atRoot = await api.fetch(
      new Request("http://localhost/api/cli/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "at",
          args: { secondOrNote: "12" },
          targetFilm: "root",
        }),
      }),
    );
    expect(atRoot.status).toBe(400);
    expect((await atRoot.json()).code).toBe("INVALID_ARGS");

    const findRoot = await api.fetch(
      new Request("http://localhost/api/cli/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "find",
          args: { words: "door" },
          targetFilm: "root",
        }),
      }),
    );
    expect(findRoot.status).toBe(202);
    const run = await findRoot.json();
    expect(run.cwd).toBe(".");
    expect(run.targetFilm).toBeNull();
    const stream = await api.fetch(
      new Request(`http://localhost/api/cli/runs/${run.runId}/stream`),
    );
    expect(stream.status).toBe(200);
    await stream.text();
  });

  test("supports bash-file runner validation, forward-slash script args on win32, and bashBin execution", async () => {
    const { root, filmDir } = makeFixtureRepo();
    const { api: missingApi } = makeApiHarness(filmDir, { repoRoot: root, bashBin: "python" });
    const missingRes = await missingApi.fetch(
      new Request("http://localhost/api/cli/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "catalog:tag-sh" }),
      }),
    );
    expect(missingRes.status).toBe(404);
    expect((await missingRes.json()).code).toBe("UNKNOWN_COMMAND");

    // Symlink escaping repoRoot must be rejected
    const outsideDir = tempDir("cli-bash-outside-");
    writeFileSync(join(outsideDir, "catalog.sh"), 'print("escape")\n');
    symlinkSync(outsideDir, join(root, "packages", "clip-catalog"), "junction");
    const escapeRes = await missingApi.fetch(
      new Request("http://localhost/api/cli/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "catalog:tag-sh" }),
      }),
    );
    expect(escapeRes.status).toBe(404);
    expect((await escapeRes.json()).code).toBe("UNKNOWN_COMMAND");

    // Replace escaped junction with contained fixture script and test bashBin mock execution
    rmSync(join(root, "packages", "clip-catalog"), { recursive: true, force: true });
    mkdirSync(join(root, "packages", "clip-catalog"), { recursive: true });
    writeFileSync(
      join(root, "packages", "clip-catalog", "catalog.sh"),
      'import os, sys\nprint("MOCK-BASH-SCRIPT=" + sys.argv[0])\nprint("MOCK-BASH-ARGS=" + ",".join(sys.argv[1:]))\nprint("MOCK-BASH-CWD=" + os.getcwd())\n',
    );
    const { api } = makeApiHarness(filmDir, { repoRoot: root, bashBin: "python" });
    const startRes = await api.fetch(
      new Request("http://localhost/api/cli/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "catalog:tag-sh",
          args: { libs: "mixamo ual1" },
        }),
      }),
    );
    expect(startRes.status).toBe(202);
    const run = await startRes.json();
    expect(run.displayCommand).toBe("bash ../../packages/clip-catalog/catalog.sh mixamo ual1");
    expect(run.cwd).toBe("films/test-film");
    const sse = parseSseText(
      await (
        await api.fetch(new Request(`http://localhost/api/cli/runs/${run.runId}/stream`))
      ).text(),
    );
    expect(sse.find((e) => e.event === "done")?.data.exitCode).toBe(0);
    const out = sse
      .filter((e) => e.event === "chunk")
      .map((e) => e.data.chunk)
      .join("");
    expect(out).toContain("MOCK-BASH-ARGS=mixamo,ual1");
    expect(out).toContain("packages/clip-catalog/catalog.sh");
    if (process.platform === "win32") {
      expect(out).not.toContain("packages\\clip-catalog\\catalog.sh");
    }
    expect(out).toContain(`MOCK-BASH-CWD=${realpathSync(filmDir)}`);

    if (process.platform !== "win32" || existsSync("C:\\Program Files\\Git\\bin\\bash.exe")) {
      writeFileSync(
        join(root, "packages", "clip-catalog", "catalog.sh"),
        'printf \'REAL-BASH=%s|%s\\n\' "$0" "$*"\n',
      );
      const { api: defaultBashApi } = makeApiHarness(filmDir, { repoRoot: root });
      const realStart = await defaultBashApi.fetch(
        new Request("http://localhost/api/cli/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: "catalog:tag-sh", args: { libs: "mixamo" } }),
        }),
      );
      expect(realStart.status).toBe(202);
      const realRun = await realStart.json();
      const realSse = parseSseText(
        await (
          await defaultBashApi.fetch(
            new Request(`http://localhost/api/cli/runs/${realRun.runId}/stream`),
          )
        ).text(),
      );
      expect(realSse.find((e) => e.event === "done")?.data.exitCode).toBe(0);
      const realOut = realSse
        .filter((e) => e.event === "chunk")
        .map((e) => e.data.chunk)
        .join("");
      expect(realOut).toContain("REAL-BASH=");
      expect(realOut).toContain("packages/clip-catalog/catalog.sh|mixamo");
    }
  });

  test("strips inherited LIVE_PROJECT so child CLIs resolve targetFilm from authoritative cwd", async () => {
    const { root, filmDir } = makeFixtureRepo();
    const otherFilm = join(root, "films", "other-film");
    mkdirSync(join(otherFilm, "renders/live"), { recursive: true });
    writeFileSync(
      join(root, "check_env_cwd.mjs"),
      'console.log("LIVE_PROJECT=" + String(process.env.LIVE_PROJECT) + "|CWD=" + process.cwd());\n',
    );
    writeFileSync(
      join(otherFilm, "package.json"),
      JSON.stringify({
        name: "other-film",
        scripts: { check: `bun ${JSON.stringify(join(root, "check_env_cwd.mjs"))}` },
      }),
    );

    const prevLiveProject = process.env.LIVE_PROJECT;
    process.env.LIVE_PROJECT = filmDir;
    try {
      const { api } = makeApiHarness(filmDir, { repoRoot: root });
      const startRes = await api.fetch(
        new Request("http://localhost/api/cli/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commandId: "check", targetFilm: "other-film" }),
        }),
      );
      expect(startRes.status).toBe(202);
      const run = await startRes.json();
      const sse = parseSseText(
        await (
          await api.fetch(new Request(`http://localhost/api/cli/runs/${run.runId}/stream`))
        ).text(),
      );
      expect(sse.find((e) => e.event === "done")?.data.exitCode).toBe(0);
      const out = sse
        .filter((e) => e.event === "chunk")
        .map((e) => e.data.chunk)
        .join("");
      expect(out).toContain("LIVE_PROJECT=undefined");
      expect(out).toContain(`CWD=${realpathSync(otherFilm)}`);
    } finally {
      if (prevLiveProject === undefined) delete process.env.LIVE_PROJECT;
      else process.env.LIVE_PROJECT = prevLiveProject;
    }
  });
});
