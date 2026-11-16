import { describe, expect, test } from "bun:test";

import {
  countNotes,
  createPortsService,
  parseLiveHosts,
  parseNetstatListeners,
  parsePosixListeners,
  parseTailscaleServe,
  parseWindowsListeners,
  parseWorktreeList,
} from "../src/ports.mjs";

describe("parseWindowsListeners", () => {
  test("deduplicates dual-stack IPv4 and IPv6 sockets by (pid, port) and ignores non-live processes", () => {
    const raw = JSON.stringify({
      conns: [
        { LocalAddress: "127.0.0.1", LocalPort: 4325, OwningProcess: 7864 },
        { LocalAddress: "::1", LocalPort: 4325, OwningProcess: 7864 },
        { LocalAddress: "0.0.0.0", LocalPort: 4587, OwningProcess: 35556 },
        { LocalAddress: "::", LocalPort: 4587, OwningProcess: 35556 },
        { LocalAddress: "127.0.0.1", LocalPort: 4390, OwningProcess: 972 },
      ],
      procs: [
        null,
        {
          ProcessId: 7864,
          CommandLine:
            "C:\\Users\\ADMIN\\.bun\\bin\\bun.exe node_modules/live-studio/src/live.mjs 4325",
        },
        {
          ProcessId: 35556,
          CommandLine:
            '"C:\\Users\\ADMIN\\.bun\\bin\\bun.exe" C:\\Users\\ADMIN\\Desktop\\gohans-wt-voice-playground\\packages\\live-studio\\src\\live.mjs 4587 --lan',
        },
        {
          ProcessId: 32228,
          CommandLine:
            'powershell -Command "Set-Location C:\\wt; bun packages\\live-studio\\src\\live.mjs 4587"',
        },
      ],
    });

    expect(parseWindowsListeners(raw)).toEqual([
      {
        pid: 7864,
        port: 4325,
        cmdline: "C:\\Users\\ADMIN\\.bun\\bin\\bun.exe node_modules/live-studio/src/live.mjs 4325",
      },
      {
        pid: 35556,
        port: 4587,
        cmdline:
          '"C:\\Users\\ADMIN\\.bun\\bin\\bun.exe" C:\\Users\\ADMIN\\Desktop\\gohans-wt-voice-playground\\packages\\live-studio\\src\\live.mjs 4587 --lan',
      },
    ]);
  });

  test("handles PowerShell single-object output and falls back to cmdline port when socket lacks LocalPort", () => {
    const raw = JSON.stringify({
      conns: { LocalAddress: "127.0.0.1", LocalPort: 0, OwningProcess: 4200 },
      procs: { ProcessId: 4200, CommandLine: "bun ..\\src\\live.mjs 4852" },
    });

    expect(parseWindowsListeners(raw)).toEqual([
      { pid: 4200, port: 4852, cmdline: "bun ..\\src\\live.mjs 4852" },
    ]);
  });

  test("returns empty array for empty or invalid JSON", () => {
    expect(parseWindowsListeners("")).toEqual([]);
    expect(parseWindowsListeners("not-json")).toEqual([]);
  });
});

describe("parseNetstatListeners", () => {
  test("parses dual-stack Windows netstat LISTENING lines for IPv4 and IPv6", () => {
    const out = [
      "Active Connections",
      "",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    127.0.0.1:4325         0.0.0.0:0              LISTENING       7864",
      "  TCP    [::1]:4325             [::]:0                 LISTENING       7864",
      "  TCP    0.0.0.0:4599           0.0.0.0:0              LISTENING       38944",
      "  TCP    127.0.0.1:4325         127.0.0.1:59100        ESTABLISHED     7864",
    ].join("\r\n");

    expect(parseNetstatListeners(out)).toEqual([
      { port: 4325, pid: 7864 },
      { port: 4599, pid: 38944 },
    ]);
  });
});

describe("parsePosixListeners", () => {
  test("parses and deduplicates lsof and ss sockets matched to live.mjs processes", () => {
    const psOut = [
      "  101 /usr/local/bin/bun node_modules/live-studio/src/live.mjs 4325",
      "  202 /usr/local/bin/bun /repo/packages/live-studio/src/live.mjs 4583",
      "  303 node server.ts",
    ].join("\n");
    const lsofOut = [
      "p101",
      "cbun",
      "n127.0.0.1:4325",
      "n[::1]:4325",
      "p303",
      "cnode",
      "n127.0.0.1:4390",
    ].join("\n");
    expect(parsePosixListeners(lsofOut, psOut, "lsof")).toEqual([
      {
        pid: 101,
        port: 4325,
        cmdline: "/usr/local/bin/bun node_modules/live-studio/src/live.mjs 4325",
      },
    ]);

    const ssOut = [
      'LISTEN 0 128 127.0.0.1:4583 0.0.0.0:* users:(("bun",pid=202,fd=12))',
      'LISTEN 0 128 [::1]:4583 [::]:* users:(("bun",pid=202,fd=13))',
    ].join("\n");
    expect(parsePosixListeners(ssOut, psOut, "ss")).toEqual([
      {
        pid: 202,
        port: 4583,
        cmdline: "/usr/local/bin/bun /repo/packages/live-studio/src/live.mjs 4583",
      },
    ]);
  });
});

describe("parseWorktreeList", () => {
  test("parses main, linked, and detached worktrees with normalized paths", () => {
    const porcelain = [
      "worktree C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc",
      "HEAD 9e276d92552683502d416d51a660682f1e4e8eae",
      "branch refs/heads/master",
      "",
      "worktree C:\\Users\\ADMIN\\Desktop\\gohans-wt-ports\\",
      "HEAD 2fe0b1ff9323864db7c5ec56850a802668b2378d",
      "branch refs/heads/feat/ports-tab",
      "",
      "worktree C:/Users/ADMIN/Desktop/gohans-wt-detached",
      "HEAD 1111111111111111111111111111111111111111",
      "detached",
      "",
    ].join("\n");

    expect(parseWorktreeList(porcelain)).toEqual([
      {
        path: "C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc",
        name: "gohans-monorepo-3js-mc",
        branch: "master",
        isMain: true,
      },
      {
        path: "C:/Users/ADMIN/Desktop/gohans-wt-ports",
        name: "gohans-wt-ports",
        branch: "feat/ports-tab",
        isMain: false,
      },
      {
        path: "C:/Users/ADMIN/Desktop/gohans-wt-detached",
        name: "gohans-wt-detached",
        branch: null,
        isMain: false,
      },
    ]);
  });
});

describe("parseTailscaleServe", () => {
  test("extracts https/http serve routes targeting localhost or 127.0.0.1 ports", () => {
    const raw = JSON.stringify({
      TCP: {
        443: { HTTPS: true },
        8447: { HTTPS: true },
        8451: { HTTP: true },
      },
      Web: {
        "Anphat.taild3d41b.ts.net:443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } },
        },
        "anphat.taild3d41b.ts.net:8447": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:4325/" } },
        },
        "anphat.taild3d41b.ts.net:8451": {
          Handlers: { "/": { Proxy: "http://localhost:4327" } },
        },
        "ignored.ts.net:9000": {
          Handlers: { "/": { Proxy: "http://192.168.1.50:4325" } },
        },
      },
    });

    expect(parseTailscaleServe(raw)).toEqual([
      {
        url: "https://anphat.taild3d41b.ts.net",
        host: "anphat.taild3d41b.ts.net",
        targetPort: 3773,
      },
      {
        url: "https://anphat.taild3d41b.ts.net:8447",
        host: "anphat.taild3d41b.ts.net",
        targetPort: 4325,
      },
      {
        url: "http://anphat.taild3d41b.ts.net:8451",
        host: "anphat.taild3d41b.ts.net",
        targetPort: 4327,
      },
    ]);
  });

  test("returns empty array when no Web config is present", () => {
    expect(parseTailscaleServe("{}")).toEqual([]);
  });
});

describe("parseLiveHosts", () => {
  test("matches film.mjs whitespace tokenization and lowercasing literally", () => {
    const text = `
      Anphat.taild3d41b.ts.net
      PHONE.taild3d41b.ts.net   tablet.taild3d41b.ts.net
    `;
    expect(parseLiveHosts(text)).toEqual([
      "anphat.taild3d41b.ts.net",
      "phone.taild3d41b.ts.net",
      "tablet.taild3d41b.ts.net",
    ]);
    // Must mirror film.mjs split(/\s+/) without stripping # so UI badges never disagree with live.mjs 403 checks.
    expect(parseLiveHosts("# disabled-in-future\nanphat.taild3d41b.ts.net")).toEqual([
      "#",
      "disabled-in-future",
      "anphat.taild3d41b.ts.net",
    ]);
  });
});

describe("countNotes", () => {
  test("counts open, check, done states matching noteState semantics and skips removed notes", () => {
    const notes = [
      { id: "n1", text: "a", state: "open" },
      { id: "n2", text: "b", state: "check", fixes: [{ what: "done" }] },
      { id: "n3", text: "c", state: "check", fixes: [{ what: "which?", ask: true }] },
      { id: "n4", text: "d", state: "done", done: true },
      { id: "n5", text: "legacy done", done: true },
      { id: "n6", text: "legacy open", done: false },
      { id: "n7", text: "removed", state: "open", removed: true },
      { id: "n8", text: "deleted", state: "open", deleted: true },
    ];

    expect(countNotes(notes)).toEqual({ open: 2, check: 2, done: 2, total: 6 });
    expect(countNotes(null)).toBeNull();
  });
});

describe("createPortsService", () => {
  const worktreesPorcelain = [
    "worktree C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc",
    "HEAD aaa",
    "branch refs/heads/master",
    "",
    "worktree C:/Users/ADMIN/Desktop/gohans-wt-ports",
    "HEAD bbb",
    "branch refs/heads/feat/ports-tab",
    "",
    "worktree C:/Users/ADMIN/Desktop/gohans-wt-project-lessons",
    "HEAD ccc",
    "branch refs/heads/feat/project-lessons",
    "",
    "worktree C:/Users/ADMIN/Desktop/gohans-wt-voice-playground",
    "HEAD ddd",
    "branch refs/heads/feat/voice-playground",
    "",
  ].join("\n");

  const tailscaleJson = JSON.stringify({
    TCP: {
      443: { HTTPS: true },
      8447: { HTTPS: true },
      8448: { HTTPS: true },
      8451: { HTTPS: true },
    },
    Web: {
      "anphat.taild3d41b.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4390" } } },
      "anphat.taild3d41b.ts.net:8447": { Handlers: { "/": { Proxy: "http://127.0.0.1:4325" } } },
      "anphat.taild3d41b.ts.net:8448": { Handlers: { "/": { Proxy: "http://127.0.0.1:4583" } } },
      "anphat.taild3d41b.ts.net:8451": { Handlers: { "/": { Proxy: "http://127.0.0.1:4327" } } },
    },
  });

  const makeHarness = (overrides = {}) => {
    let clock = 10_000;
    const files = {
      "C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc/films/cell-break/package.json": JSON.stringify(
        { name: "cell-break" },
      ),
      "C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc/films/cell-break/renders/live/studio.json":
        JSON.stringify({ port: 4325 }),
      "C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc/films/rapier-wall-demo/package.json":
        JSON.stringify({ name: "rapier-wall-demo" }),
      "C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc/films/rapier-wall-demo/renders/live/studio.json":
        JSON.stringify({ port: 4327 }),
      "C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc/films/rapier-wall-demo/.live_hosts":
        "anphat.taild3d41b.ts.net\n",
      "C:/Users/ADMIN/Desktop/gohans-wt-project-lessons/films/cell-break/package.json":
        JSON.stringify({ name: "cell-break" }),
      "C:/Users/ADMIN/Desktop/gohans-wt-project-lessons/films/cell-break/renders/live/studio.json":
        JSON.stringify({ port: 4325 }),
      "C:/Users/ADMIN/Desktop/gohans-wt-ports/films/sealed-room/package.json": JSON.stringify({
        name: "sealed-room",
      }),
      "C:/Users/ADMIN/Desktop/gohans-wt-voice-playground/films/custom-dir/package.json":
        JSON.stringify({ name: "pg-custom" }),
      ...overrides.files,
    };

    const dirs = {
      "C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc/films": ["cell-break", "rapier-wall-demo"],
      "C:/Users/ADMIN/Desktop/gohans-wt-ports/films": ["sealed-room"],
      "C:/Users/ADMIN/Desktop/gohans-wt-project-lessons/films": ["cell-break"],
      "C:/Users/ADMIN/Desktop/gohans-wt-voice-playground/films": ["custom-dir"],
      ...overrides.dirs,
    };

    const listenersJson = JSON.stringify(
      overrides.listeners ?? {
        conns: [
          { LocalAddress: "127.0.0.1", LocalPort: 4325, OwningProcess: 101 },
          { LocalAddress: "::1", LocalPort: 4325, OwningProcess: 101 },
          { LocalAddress: "127.0.0.1", LocalPort: 4327, OwningProcess: 102 },
          { LocalAddress: "127.0.0.1", LocalPort: 4583, OwningProcess: 103 },
          { LocalAddress: "127.0.0.1", LocalPort: 4600, OwningProcess: 104 },
        ],
        procs: [
          { ProcessId: 101, CommandLine: "bun node_modules/live-studio/src/live.mjs 4325" },
          { ProcessId: 102, CommandLine: "bun node_modules/live-studio/src/live.mjs 4327" },
          {
            ProcessId: 103,
            CommandLine:
              '"bun.exe" C:\\Users\\ADMIN\\Desktop\\gohans-wt-voice-playground\\packages\\live-studio\\src\\live.mjs 4583',
          },
          {
            ProcessId: 104,
            CommandLine: "bun node_modules/live-studio/src/live.mjs 4600",
          },
        ],
      },
    );

    const probes = {
      "http://127.0.0.1:4325/api/film.json": {
        ok: true,
        status: 200,
        data: { name: "cell-break", ratio: "16:9" },
      },
      "http://127.0.0.1:4325/api/notes": {
        ok: true,
        status: 200,
        data: [{ id: "1", text: "a", state: "open" }],
      },
      "http://127.0.0.1:4327/api/film.json": {
        ok: true,
        status: 200,
        data: { name: "rapier-wall-demo", ratio: "9:16" },
      },
      "http://127.0.0.1:4327/api/notes": {
        ok: true,
        status: 200,
        data: [
          { id: "1", text: "a", state: "check" },
          { id: "2", text: "b", state: "done" },
        ],
      },
      "http://127.0.0.1:4583/api/film.json": {
        ok: true,
        status: 200,
        data: { name: "pg-custom", ratio: "16:9" },
      },
      "http://127.0.0.1:4583/api/notes": { ok: true, status: 200, data: [] },
      "http://127.0.0.1:4600/api/film.json": {
        ok: true,
        status: 200,
        data: {
          name: "sealed-room",
          ratio: "16:9",
          project: "C:\\Users\\ADMIN\\Desktop\\gohans-wt-ports\\films\\sealed-room",
        },
      },
      "http://127.0.0.1:4600/api/notes": { ok: false, status: 500, data: null },
      ...overrides.probes,
    };

    const calls = { commands: [], fetches: [] };
    const service = createPortsService({
      repoRoot: "C:/Users/ADMIN/Desktop/gohans-wt-ports",
      platform: "win32",
      now: () => clock,
      runCommand: async (cmd, args) => {
        calls.commands.push([cmd, ...args]);
        if (cmd === "git") return { ok: true, code: 0, stdout: worktreesPorcelain, stderr: "" };
        if (cmd === "tailscale") {
          if (overrides.tailscaleError) {
            return { ok: false, code: 1, stdout: "", stderr: overrides.tailscaleError };
          }
          return { ok: true, code: 0, stdout: tailscaleJson, stderr: "" };
        }
        return { ok: true, code: 0, stdout: listenersJson, stderr: "" };
      },
      fetchJson: async (url) => {
        calls.fetches.push(url);
        const res = probes[url];
        if (res instanceof Error) throw res;
        return res ?? { ok: false, status: 404, data: null };
      },
      readText: (p) => {
        const key = p.replaceAll("\\", "/");
        if (overrides.readErrors?.[key]) throw overrides.readErrors[key];
        return key in files ? files[key] : null;
      },
      readdir: (p) => {
        const key = p.replaceAll("\\", "/");
        return dirs[key] ?? null;
      },
    });

    return { service, calls, advance: (ms) => (clock += ms) };
  };

  test("attributes exact, inferred (with package.json name fallback), and ambiguous worktrees cleanly and sorts current first", async () => {
    const { service } = makeHarness();
    const snap = await service.getSnapshot({ currentPort: 4600 });

    expect(snap.scannedAt).toBe(10_000);
    expect(snap.currentPort).toBe(4600);
    expect(snap.worktrees).toHaveLength(4);
    expect(snap.tailscale.available).toBe(true);
    expect(snap.tailscale.error).toBeNull();
    expect(snap.tailscale.unmatched).toEqual([
      {
        url: "https://anphat.taild3d41b.ts.net",
        host: "anphat.taild3d41b.ts.net",
        targetPort: 4390,
      },
    ]);

    // Sorted: current (4600) first, then ascending port: 4325, 4327, 4583
    expect(snap.studios.map((s) => s.port)).toEqual([4600, 4325, 4327, 4583]);

    const [s4600, s4325, s4327, s4583] = snap.studios;

    // Priority 1 (exact via /api/film.json project)
    expect(s4600.current).toBe(true);
    expect(s4600.matchConfidence).toBe("exact");
    expect(s4600.worktree?.name).toBe("gohans-wt-ports");
    expect(s4600.project).toBe("C:/Users/ADMIN/Desktop/gohans-wt-ports/films/sealed-room");
    expect(s4600.notes).toBeNull();
    expect(s4600.status).toBe("ready");

    // Priority 3 (ambiguous across two worktrees -> worktree MUST be null, allowed MUST be null)
    expect(s4325.matchConfidence).toBe("ambiguous");
    expect(s4325.worktree).toBeNull();
    expect(s4325.project).toBeNull();
    expect(s4325.candidateWorktrees.map((w) => w.name)).toEqual([
      "gohans-monorepo-3js-mc",
      "gohans-wt-project-lessons",
    ]);
    expect(s4325.notes).toEqual({ open: 1, check: 0, done: 0, total: 1 });
    expect(s4325.tailscale).toEqual([
      {
        url: "https://anphat.taild3d41b.ts.net:8447",
        host: "anphat.taild3d41b.ts.net",
        targetPort: 4325,
        allowed: null,
      },
    ]);

    // Priority 3 (unique studio.json match -> inferred, .live_hosts allowed true)
    expect(s4327.matchConfidence).toBe("inferred");
    expect(s4327.worktree?.name).toBe("gohans-monorepo-3js-mc");
    expect(s4327.project).toBe(
      "C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc/films/rapier-wall-demo",
    );
    expect(s4327.notes).toEqual({ open: 0, check: 1, done: 1, total: 2 });
    expect(s4327.tailscale).toEqual([
      {
        url: "https://anphat.taild3d41b.ts.net:8451",
        host: "anphat.taild3d41b.ts.net",
        targetPort: 4327,
        allowed: true,
      },
    ]);

    // Priority 2 (exact via cmdline worktree + package.json name fallback "pg-custom" in "custom-dir")
    expect(s4583.matchConfidence).toBe("exact");
    expect(s4583.worktree?.name).toBe("gohans-wt-voice-playground");
    expect(s4583.project).toBe(
      "C:/Users/ADMIN/Desktop/gohans-wt-voice-playground/films/custom-dir",
    );
    expect(s4583.notes).toEqual({ open: 0, check: 0, done: 0, total: 0 });
  });

  test("marks Tailscale allowed:false when .live_hosts is missing for known project, and null when unreadable", async () => {
    const { service } = makeHarness({
      files: {
        "C:/Users/ADMIN/Desktop/gohans-monorepo-3js-mc/films/rapier-wall-demo/.live_hosts":
          undefined,
        "C:/Users/ADMIN/Desktop/gohans-wt-ports/films/sealed-room/.live_hosts": "other.ts.net\n",
      },
      readErrors: {
        "C:/Users/ADMIN/Desktop/gohans-wt-voice-playground/films/custom-dir/.live_hosts":
          Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
      },
      listeners: {
        conns: [
          { LocalAddress: "127.0.0.1", LocalPort: 4327, OwningProcess: 102 },
          { LocalAddress: "127.0.0.1", LocalPort: 4583, OwningProcess: 103 },
        ],
        procs: [
          { ProcessId: 102, CommandLine: "bun node_modules/live-studio/src/live.mjs 4327" },
          {
            ProcessId: 103,
            CommandLine:
              "bun C:/Users/ADMIN/Desktop/gohans-wt-voice-playground/packages/live-studio/src/live.mjs 4583",
          },
        ],
      },
    });

    const snap = await service.getSnapshot({ currentPort: null });
    const s4327 = snap.studios.find((s) => s.port === 4327);
    const s4583 = snap.studios.find((s) => s.port === 4583);
    expect(s4327?.tailscale[0]?.allowed).toBe(false);
    expect(s4583?.tailscale[0]?.allowed).toBeNull();
  });

  test("preserves external project path and reports command failures in warnings", async () => {
    const service = createPortsService({
      repoRoot: "C:/Users/ADMIN/Desktop/gohans-wt-ports",
      platform: "win32",
      runCommand: async (cmd) => {
        if (cmd === "git") return { ok: false, code: 128, stdout: "", stderr: "git error" };
        if (cmd === "tailscale") return { ok: false, code: 1, stdout: "", stderr: "offline" };
        return {
          ok: true,
          code: 0,
          stdout: JSON.stringify({
            conns: [{ LocalAddress: "127.0.0.1", LocalPort: 4825, OwningProcess: 50 }],
            procs: [{ ProcessId: 50, CommandLine: "bun src/live.mjs 4825" }],
          }),
          stderr: "",
        };
      },
      fetchJson: async (url) => {
        if (url.endsWith("/api/film.json")) {
          return {
            ok: true,
            status: 200,
            data: { name: "demo", ratio: "16:9", project: "C:\\Temp\\demo" },
          };
        }
        return { ok: true, status: 200, data: [] };
      },
      readText: () => null,
      readdir: () => null,
    });

    const snap = await service.getSnapshot({ currentPort: null });
    expect(snap.warnings).toEqual(["Git worktree scan failed: git error"]);
    expect(snap.studios[0]?.project).toBe("C:/Temp/demo");
    expect(snap.studios[0]?.matchConfidence).toBe("unknown");
    expect(snap.studios[0]?.worktree).toBeNull();
  });

  test("marks unreachable, HTTP error, and unknown studios without failing snapshot", async () => {
    const { service } = makeHarness({
      tailscaleError: "tailscale daemon not running",
      listeners: {
        conns: [
          { LocalAddress: "127.0.0.1", LocalPort: 4991, OwningProcess: 201 },
          { LocalAddress: "127.0.0.1", LocalPort: 4992, OwningProcess: 202 },
          { LocalAddress: "127.0.0.1", LocalPort: 4993, OwningProcess: 203 },
        ],
        procs: [
          { ProcessId: 201, CommandLine: "bun node_modules/live-studio/src/live.mjs 4991" },
          { ProcessId: 202, CommandLine: "bun node_modules/live-studio/src/live.mjs 4992" },
          {
            ProcessId: 203,
            CommandLine:
              "bun C:/Users/ADMIN/Desktop/gohans-wt-ports/packages/live-studio/src/live.mjs 4993",
          },
        ],
      },
      probes: {
        "http://127.0.0.1:4991/api/film.json": new Error("connect ECONNREFUSED"),
        "http://127.0.0.1:4992/api/film.json": { ok: false, status: 503, data: null },
        "http://127.0.0.1:4993/api/film.json": new Error("The operation timed out"),
      },
    });

    const snap = await service.getSnapshot({ currentPort: null });
    expect(snap.tailscale).toEqual({
      available: false,
      error: "tailscale daemon not running",
      unmatched: [],
    });

    const [s4991, s4992, s4993] = snap.studios;
    expect(s4991.status).toBe("unreachable");
    expect(s4991.matchConfidence).toBe("unknown");
    expect(s4992.status).toBe("error");
    expect(s4992.matchConfidence).toBe("unknown");
    // Priority 2 with failed probe -> cmdline worktree matched, inferred (since film name unknown)
    expect(s4993.status).toBe("unreachable");
    expect(s4993.matchConfidence).toBe("inferred");
    expect(s4993.worktree?.name).toBe("gohans-wt-ports");
  });

  test("coalesces concurrent getSnapshot calls, caches for 2000ms, and refreshes on forceRefresh", async () => {
    const { service, calls, advance } = makeHarness();

    const [a, b] = await Promise.all([
      service.getSnapshot({ currentPort: 4325 }),
      service.getSnapshot({ currentPort: 4327 }),
    ]);
    expect(calls.commands).toHaveLength(4); // netstat + powershell + git + tailscale
    expect(a.studios[0].port).toBe(4325);
    expect(a.studios[0].current).toBe(true);
    expect(b.studios[0].port).toBe(4327);
    expect(b.studios[0].current).toBe(true);

    // Within 2000ms -> uses cache
    advance(1500);
    const c = await service.getSnapshot({ currentPort: 4600 });
    expect(calls.commands).toHaveLength(4);
    expect(c.studios[0].port).toBe(4600);

    // forceRefresh -> bypasses cache
    await service.getSnapshot({ currentPort: 4600, forceRefresh: true });
    expect(calls.commands).toHaveLength(8);

    // After 2000ms -> expires cache
    advance(2001);
    await service.getSnapshot({ currentPort: null });
    expect(calls.commands).toHaveLength(12);
  });

  test("splits Windows netstat + PowerShell procs cleanly, falls back to selfPort on PowerShell timeout, and distinguishes Tailscale timeout", async () => {
    const service = createPortsService({
      repoRoot: "C:/Users/ADMIN/Desktop/gohans-wt-ports",
      platform: "win32",
      selfPort: 4599,
      runCommand: async (cmd) => {
        if (cmd === "netstat") {
          return {
            ok: true,
            code: 0,
            stdout: [
              "  TCP    127.0.0.1:4599         0.0.0.0:0              LISTENING       8888",
              "  TCP    [::1]:4599             [::]:0                 LISTENING       8888",
            ].join("\r\n"),
            stderr: "",
          };
        }
        if (cmd === "powershell.exe") {
          return { ok: false, code: -1, stdout: "", stderr: "", timedOut: true };
        }
        if (cmd === "git") {
          return {
            ok: true,
            code: 0,
            stdout: [
              "worktree C:/Users/ADMIN/Desktop/gohans-wt-ports",
              "HEAD abc",
              "branch refs/heads/feat/ports-tab",
              "",
            ].join("\n"),
            stderr: "",
          };
        }
        if (cmd === "tailscale") {
          return { ok: false, code: -1, stdout: "", stderr: "", timedOut: true };
        }
        return { ok: false, code: 1, stdout: "", stderr: "unexpected" };
      },
      fetchJson: async (url) => {
        if (url === "http://127.0.0.1:4599/api/film.json") {
          return {
            ok: true,
            status: 200,
            data: {
              name: "cell-break",
              ratio: "16:9",
              project: "C:\\Users\\ADMIN\\Desktop\\gohans-wt-ports\\films\\cell-break",
            },
          };
        }
        if (url === "http://127.0.0.1:4599/api/notes") {
          return { ok: true, status: 200, data: [] };
        }
        return { ok: false, status: 404, data: null };
      },
      readText: () => null,
      readdir: () => null,
    });

    const snap = await service.getSnapshot({ currentPort: 4599 });
    expect(snap.warnings).toEqual(["Listener process scan timed out (showing active studio only)"]);
    expect(snap.tailscale).toEqual({
      available: false,
      error: "Tailscale status timed out",
      unmatched: [],
    });
    expect(snap.studios).toHaveLength(1);
    expect(snap.studios[0]).toMatchObject({
      port: 4599,
      pid: 8888,
      current: true,
      film: "cell-break",
      matchConfidence: "exact",
      status: "ready",
    });
  });

  test("marks Priority 2 cmdline worktree without resolved film directory as inferred instead of exact", async () => {
    const service = createPortsService({
      repoRoot: "C:/Users/ADMIN/Desktop/gohans-wt-ports",
      platform: "win32",
      runCommand: async (cmd) => {
        if (cmd === "netstat") {
          return {
            ok: true,
            code: 0,
            stdout:
              "  TCP    127.0.0.1:4661         0.0.0.0:0              LISTENING       7001\r\n",
            stderr: "",
          };
        }
        if (cmd === "powershell.exe") {
          return {
            ok: true,
            code: 0,
            stdout: JSON.stringify({
              procs: [
                {
                  ProcessId: 7001,
                  CommandLine:
                    "bun C:\\Users\\ADMIN\\Desktop\\gohans-wt-ports\\packages\\live-studio\\src\\live.mjs 4661",
                },
              ],
            }),
            stderr: "",
          };
        }
        if (cmd === "git") return { ok: true, code: 0, stdout: worktreesPorcelain, stderr: "" };
        return { ok: true, code: 0, stdout: "{}", stderr: "" };
      },
      fetchJson: async (url) =>
        url.endsWith("/api/film.json")
          ? { ok: true, status: 200, data: { name: "demo", ratio: "16:9" } }
          : { ok: true, status: 200, data: [] },
      readText: () => null,
      readdir: () => null,
    });

    const snap = await service.getSnapshot({ currentPort: 4661 });
    expect(snap.studios[0]?.worktree?.name).toBe("gohans-wt-ports");
    expect(snap.studios[0]?.project).toBeNull();
    expect(snap.studios[0]?.matchConfidence).toBe("inferred");
  });

  test("falls back from lsof to ss on POSIX and joins concurrent forced refresh from background callers", async () => {
    let releaseForced;
    const forcedGate = new Promise((r) => {
      releaseForced = r;
    });
    let scanCount = 0;

    const service = createPortsService({
      repoRoot: "/repo",
      platform: "linux",
      runCommand: async (cmd) => {
        if (cmd === "lsof") return { ok: false, code: 1, stdout: "", stderr: "lsof missing" };
        if (cmd === "ss") {
          scanCount++;
          if (scanCount === 2) await forcedGate;
          return {
            ok: true,
            code: 0,
            stdout: 'LISTEN 0 128 127.0.0.1:4325 0.0.0.0:* users:(("bun",pid=55,fd=9))\n',
            stderr: "",
          };
        }
        if (cmd === "ps") {
          return {
            ok: true,
            code: 0,
            stdout: "  55 bun /repo/packages/live-studio/src/live.mjs 4325\n",
            stderr: "",
          };
        }
        if (cmd === "git") {
          return {
            ok: true,
            code: 0,
            stdout: "worktree /repo\nHEAD 111\nbranch refs/heads/master\n\n",
            stderr: "",
          };
        }
        return { ok: true, code: 0, stdout: "bad-json", stderr: "" };
      },
      fetchJson: async (url) =>
        url.endsWith("/api/film.json")
          ? {
              ok: true,
              status: 200,
              data: { name: "demo", ratio: "16:9", project: "/repo/films/demo" },
            }
          : { ok: true, status: 200, data: [] },
      readText: () => null,
      readdir: () => null,
    });

    const first = await service.getSnapshot({ currentPort: 4325 });
    expect(first.tailscale).toEqual({
      available: false,
      error: "Invalid JSON from tailscale serve status",
      unmatched: [],
    });
    expect(first.studios[0]?.port).toBe(4325);

    const forcedP = service.getSnapshot({ currentPort: 4325, forceRefresh: true });
    const bgP = service.getSnapshot({ currentPort: 4325, forceRefresh: false });
    releaseForced();
    const [forcedRes, bgRes] = await Promise.all([forcedP, bgP]);
    expect(scanCount).toBe(2);
    expect(bgRes).toEqual(forcedRes);
  });
});
