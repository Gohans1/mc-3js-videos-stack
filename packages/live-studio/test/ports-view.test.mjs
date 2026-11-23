import { afterAll, afterEach, beforeAll, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import { TooltipProvider } from "../app/components/ui/tooltip.tsx";
import {
  describeWorktree,
  fetchPortsSnapshot,
  formatRelativeScanAge,
  getCachedPortsSnapshot,
  safeHttpUrl,
  setCachedPortsSnapshot,
  shouldSkipBackgroundRefresh,
  sortStudios,
  summarizeSnapshot,
} from "../app/ports/ports.ts";
import { PortsPanel } from "../app/ports/PortsPanel.tsx";
import { filmPlugin } from "../src/vite_film.mjs";

const STUDIO_DIR = resolve(import.meta.dir, "..");

const baseStudio = (over = {}) => ({
  id: "1001:4325",
  port: 4325,
  pid: 1001,
  current: false,
  film: "cell-break",
  ratio: "16:9",
  project: "C:/repo/films/cell-break",
  worktree: {
    path: "C:/repo",
    name: "gohans-wt-ports",
    branch: "feat/ports-tab",
    isMain: false,
  },
  matchConfidence: "exact",
  candidateWorktrees: [],
  localUrl: "http://localhost:4325",
  tailscale: [],
  notes: null,
  status: "ready",
  ...over,
});

describe("safeHttpUrl", () => {
  test("accepts valid http and https URLs and normalizes scheme casing", () => {
    assert.equal(safeHttpUrl("http://localhost:4325"), "http://localhost:4325");
    assert.equal(
      safeHttpUrl("  HTTPS://anphat.taild3d41b.ts.net:8447  "),
      "https://anphat.taild3d41b.ts.net:8447",
    );
    assert.equal(safeHttpUrl("HTTP://127.0.0.1:4583/studio"), "http://127.0.0.1:4583/studio");
  });

  test("rejects javascript, data, file, scheme-relative, control chars, and invalid URLs", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///C:/Windows/System32",
      "//evil.com/path",
      "/api/ports",
      "",
      "   ",
      "http://",
      "http://localhost:4325\nhttp://evil.com",
      "https://localhost:4325\x00",
      null,
      undefined,
    ]) {
      assert.equal(safeHttpUrl(bad), null, `expected null for ${String(bad)}`);
    }
  });
});

describe("formatRelativeScanAge", () => {
  test("formats relative scan age across seconds, minutes, hours, and days", () => {
    const now = 1_700_000_000_000;
    assert.equal(formatRelativeScanAge(now - 2_000, now), "Updated just now");
    assert.equal(formatRelativeScanAge(now + 5_000, now), "Updated just now");
    assert.equal(formatRelativeScanAge(now - 14_000, now), "Updated 14s ago");
    assert.equal(formatRelativeScanAge(now - 3 * 60_000, now), "Updated 3m ago");
    assert.equal(formatRelativeScanAge(now - 2 * 3_600_000, now), "Updated 2h ago");
    assert.equal(formatRelativeScanAge(now - 26 * 3_600_000, now), "Updated 1d ago");
    assert.equal(formatRelativeScanAge(Number.NaN, now), "");
  });
});

describe("sortStudios", () => {
  test("places current studio first, then sorts by ascending port and pid without mutating", () => {
    const a = baseStudio({ id: "300:4583", port: 4583, pid: 300, current: true });
    const b = baseStudio({ id: "200:4325", port: 4325, pid: 200, current: false });
    const c = baseStudio({ id: "100:4325", port: 4325, pid: 100, current: false });
    const d = baseStudio({ id: "150:4327", port: 4327, pid: 150, current: false });
    const input = [d, b, a, c];

    const sorted = sortStudios(input);

    assert.deepEqual(
      sorted.map((s) => s.id),
      ["300:4583", "100:4325", "200:4325", "150:4327"],
    );
    assert.deepEqual(
      input.map((s) => s.id),
      ["150:4327", "200:4325", "300:4583", "100:4325"],
    );
  });
});

describe("describeWorktree & summarizeSnapshot", () => {
  test("describes exact, detached, inferred, ambiguous, and unknown worktrees", () => {
    assert.deepEqual(describeWorktree(baseStudio()), {
      kind: "matched",
      branch: "feat/ports-tab",
      worktreeName: "gohans-wt-ports",
      path: "C:/repo",
      isMain: false,
      inferred: false,
    });

    const detached = baseStudio({
      matchConfidence: "inferred",
      worktree: { path: "C:/main", name: "gohans-monorepo-3js-mc", branch: null, isMain: true },
    });
    assert.deepEqual(describeWorktree(detached), {
      kind: "matched",
      branch: "detached HEAD",
      worktreeName: "gohans-monorepo-3js-mc",
      path: "C:/main",
      isMain: true,
      inferred: true,
    });

    const ambiguous = baseStudio({
      worktree: null,
      matchConfidence: "ambiguous",
      candidateWorktrees: [
        { path: "C:/wt1", name: "wt-1", branch: "feat/a", isMain: false },
        { path: "C:/wt2", name: "wt-2", branch: null, isMain: true },
      ],
    });
    assert.deepEqual(describeWorktree(ambiguous), {
      kind: "ambiguous",
      candidates: [
        { name: "wt-1", branch: "feat/a", path: "C:/wt1" },
        { name: "wt-2", branch: "detached", path: "C:/wt2" },
      ],
    });

    const unknown = baseStudio({
      worktree: null,
      matchConfidence: "unknown",
      candidateWorktrees: [],
    });
    assert.deepEqual(describeWorktree(unknown), { kind: "unknown" });
  });

  test("summarizes studio and worktree counts with proper singular and plural", () => {
    const one = summarizeSnapshot({
      scannedAt: 1,
      currentPort: 4325,
      studios: [baseStudio()],
      tailscale: { available: true, error: null, unmatched: [] },
      worktrees: [{ path: "C:/repo", name: "repo", branch: "master", isMain: true }],
      warnings: [],
    });
    assert.equal(one.label, "1 studio · 1 worktree");

    const many = summarizeSnapshot({
      scannedAt: 1,
      currentPort: 4325,
      studios: [baseStudio(), baseStudio({ id: "2:4327", port: 4327 })],
      tailscale: { available: true, error: null, unmatched: [] },
      worktrees: [
        { path: "C:/repo", name: "repo", branch: "master", isMain: true },
        { path: "C:/wt", name: "wt", branch: "feat/ports", isMain: false },
        { path: "C:/wt2", name: "wt2", branch: "feat/b", isMain: false },
      ],
      warnings: [],
    });
    assert.equal(many.label, "2 studios · 3 worktrees");
  });
});

describe("fetchPortsSnapshot", () => {
  test("requests /api/ports or /api/ports?refresh=1 with no-store and validates payload", async () => {
    const calls = [];
    const sample = {
      scannedAt: 1_700_000_000_000,
      currentPort: 4325,
      studios: [baseStudio({ current: true })],
      tailscale: { available: true, error: null, unmatched: [] },
      worktrees: [],
      warnings: [],
    };

    const fetcher = async (url, init) => {
      calls.push({ url, init });
      return Response.json(sample);
    };

    const first = await fetchPortsSnapshot({ fetcher });
    assert.equal(calls[0].url, "/api/ports");
    assert.equal(calls[0].init?.cache, "no-store");
    assert.equal(first.studios.length, 1);

    await fetchPortsSnapshot({ refresh: true, fetcher });
    assert.equal(calls[1].url, "/api/ports?refresh=1");

    await assert.rejects(
      () =>
        fetchPortsSnapshot({
          fetcher: async () => Response.json({ error: "scan failed" }, { status: 500 }),
        }),
      /scan failed/,
    );
  });
});

describe("PortsPanel read-only rendering and URL safety", () => {
  test("renders studio cards, notes badges, Tailscale statuses, unmatched routes, and strips unsafe URLs", () => {
    const snapshot = {
      scannedAt: Date.now() - 10_000,
      currentPort: 4325,
      studios: [
        baseStudio({
          id: "1:4325",
          port: 4325,
          current: true,
          film: "cell-break",
          notes: { open: 2, check: 1, done: 4, total: 7 },
          tailscale: [
            {
              url: "https://anphat.taild3d41b.ts.net:8447",
              host: "anphat.taild3d41b.ts.net",
              targetPort: 4325,
              allowed: true,
            },
            {
              url: "https://rogue.taild3d41b.ts.net:8448",
              host: "rogue.taild3d41b.ts.net",
              targetPort: 4325,
              allowed: false,
            },
          ],
        }),
        baseStudio({
          id: "2:4583",
          port: 4583,
          current: false,
          film: null,
          status: "unreachable",
          worktree: null,
          matchConfidence: "unknown",
          candidateWorktrees: [],
          localUrl: "javascript:alert(1)",
          tailscale: [],
        }),
      ],
      tailscale: {
        available: true,
        error: null,
        unmatched: [
          {
            url: "https://other.taild3d41b.ts.net:9000",
            host: "other.taild3d41b.ts.net",
            targetPort: 9000,
          },
        ],
      },
      worktrees: [
        { path: "C:/repo", name: "gohans-wt-ports", branch: "feat/ports-tab", isMain: false },
      ],
      warnings: ["Port 4999 timed out"],
    };

    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(PortsPanel, { initialSnapshot: snapshot }),
      ),
    );

    assert.match(html, /cell-break/);
    assert.match(html, /:4325/);
    assert.match(html, /This studio/);
    assert.match(html, /feat\/ports-tab/);
    assert.match(html, /gohans-wt-ports/);
    assert.match(html, /2 open/);
    assert.match(html, /1 check/);
    assert.match(html, /4 done/);
    assert.match(html, /https:\/\/anphat\.taild3d41b\.ts\.net:8447/);
    assert.match(html, /Host not allowed. Ask AI to enable this link for this film./);
    assert.match(html, /Unknown film/);
    assert.match(html, /Worktree unknown/);
    assert.match(html, /No Tailscale route/);
    assert.match(html, /Other Tailscale routes \(1\)/);
    assert.match(html, /Port 4999 timed out/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    const localLink = html.match(/<a\b[^>]*href="http:\/\/localhost:4325"[^>]*>[\s\S]*?<\/a>/)?.[0];
    assert.ok(localLink, "studio URL must remain a native link");
    assert.match(localLink, />http:\/\/localhost:4325</, "the URL itself opens the studio");

    assert.equal(html.includes("javascript:"), false, "must never render javascript: URLs");
    assert.equal(
      />\s*(Kill|Stop|Start|Restart)\s*</i.test(html),
      false,
      "must stay strictly read-only",
    );
  });

  test("renders Empty state when zero active studios exist", () => {
    const emptySnapshot = {
      scannedAt: Date.now(),
      currentPort: null,
      studios: [],
      tailscale: { available: false, error: "tailscale not running", unmatched: [] },
      worktrees: [],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(PortsPanel, { initialSnapshot: emptySnapshot }),
      ),
    );
    assert.match(html, /No active studios found/);
    assert.match(html, /tailscale not running/);
  });

  test("suppresses false empty state when warnings explain why zero studios loaded", () => {
    const warnedSnapshot = {
      scannedAt: Date.now(),
      currentPort: null,
      studios: [],
      tailscale: { available: true, error: null, unmatched: [] },
      worktrees: [],
      warnings: ["Windows process lookup timed out."],
    };
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(PortsPanel, { initialSnapshot: warnedSnapshot }),
      ),
    );
    assert.match(html, /Could not list studio ports/);
    assert.match(html, /Check the scan warnings below and retry/);
    assert.doesNotMatch(html, /No active studios found/);
  });

  test("renders distinct unmatched Tailscale target ports sharing a public URL without collision", () => {
    const snapshot = {
      scannedAt: Date.now(),
      currentPort: null,
      studios: [baseStudio()],
      tailscale: {
        available: true,
        error: null,
        unmatched: [
          { host: "box.ts.net", url: "https://box.ts.net", targetPort: 4401 },
          { host: "box.ts.net", url: "https://box.ts.net", targetPort: 4402 },
        ],
      },
      worktrees: [],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(PortsPanel, { initialSnapshot: snapshot }),
      ),
    );
    assert.match(html, /Other Tailscale routes \(2\)/);
  });

  test("shouldSkipBackgroundRefresh and in-memory snapshot cache behave cleanly", () => {
    setCachedPortsSnapshot(null);
    assert.equal(getCachedPortsSnapshot(), null);
    assert.equal(shouldSkipBackgroundRefresh({ visibilityState: "hidden", inFlight: null }), true);
    assert.equal(
      shouldSkipBackgroundRefresh({ visibilityState: "visible", inFlight: "force" }),
      true,
    );
    assert.equal(
      shouldSkipBackgroundRefresh({ visibilityState: "visible", inFlight: "auto" }),
      true,
    );
    assert.equal(
      shouldSkipBackgroundRefresh({ visibilityState: "visible", inFlight: null }),
      false,
    );

    const sample = {
      scannedAt: Date.now(),
      currentPort: 4325,
      studios: [baseStudio()],
      tailscale: { available: true, error: null, unmatched: [] },
      worktrees: [],
      warnings: [],
    };
    setCachedPortsSnapshot(sample);
    assert.equal(getCachedPortsSnapshot(), sample);

    const cachedHtml = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(PortsPanel)),
    );
    assert.match(cachedHtml, /cell-break/);
    assert.doesNotMatch(cachedHtml, /Scanning active studios/);
    setCachedPortsSnapshot(null);
  });
});

describe("store & Side.tsx Ports tab navigation integration", () => {
  const savedGlobals = new Map();
  let server;
  let tempDir;
  let storeMod;
  let sideMod;
  let tooltipMod;

  const installDomGlobals = () => {
    for (const k of [
      "localStorage",
      "sessionStorage",
      "location",
      "matchMedia",
      "EventSource",
      "AudioContext",
      "AudioWorkletNode",
      "GainNode",
      "Audio",
      "document",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "addEventListener",
      "removeEventListener",
      "window",
    ]) {
      savedGlobals.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
    }
    const memStorage = () => {
      const m = new Map();
      return {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        clear: () => m.clear(),
      };
    };
    const mm = () => ({
      matches: false,
      media: "",
      addEventListener() {},
      removeEventListener() {},
    });
    class StubEventSource {
      static CLOSED = 2;
      readyState = 0;
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    const stubNode = () => ({
      gain: { value: 1 },
      fftSize: 2048,
      connect() {
        return this;
      },
    });
    class StubAudioContext {
      currentTime = 0;
      destination = {};
      audioWorklet = { addModule: async () => {} };
      createGain = stubNode;
      createChannelSplitter = stubNode;
      createAnalyser = stubNode;
    }
    class StubGainNode {
      gain = { value: 1 };
      connect() {
        return this;
      }
    }
    class StubAudioWorkletNode {
      port = { postMessage() {}, onmessage: null };
      parameters = new Map();
      connect() {
        return this;
      }
    }
    class StubAudio {
      volume = 1;
      muted = false;
      playbackRate = 1;
      currentTime = 0;
      duration = 0;
      paused = true;
      src = "";
      addEventListener() {}
      removeEventListener() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
    }
    const stubDoc = {
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        canPlayType: () => "",
        getContext: () => ({
          font: "",
          measureText: () => ({ width: 0 }),
          isPointInPath: () => false,
        }),
        style: {},
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
      }),
      addEventListener() {},
      removeEventListener() {},
      documentElement: { style: { setProperty() {} } },
    };
    const loc = { search: "", pathname: "/", origin: "http://localhost" };
    Object.assign(globalThis, {
      localStorage: memStorage(),
      sessionStorage: memStorage(),
      location: loc,
      matchMedia: mm,
      EventSource: StubEventSource,
      AudioContext: StubAudioContext,
      AudioWorkletNode: StubAudioWorkletNode,
      GainNode: StubGainNode,
      Audio: StubAudio,
      document: stubDoc,
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      window: Object.assign(globalThis, {
        location: loc,
        document: stubDoc,
        matchMedia: mm,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  };

  const restoreDomGlobals = () => {
    for (const [k, desc] of savedGlobals.entries()) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete globalThis[k];
    }
  };

  beforeAll(async () => {
    installDomGlobals();
    try {
      tempDir = mkdtempSync(join(tmpdir(), "studio-ports-ui-ssr-"));
      const src = join(tempDir, "src");
      mkdirSync(src, { recursive: true });
      writeFileSync(
        join(src, "scene.ts"),
        'export const SHOTS = [{ t: 0, name: "Intro" }], SHOTS_OUT = SHOTS, DURATION = 10; export const applyEdit = () => {}; export const buildScene = async () => Object.assign(() => ({}), { tools: {} });',
      );
      writeFileSync(
        join(src, "edit.ts"),
        "export const EDIT = {}; export const fromSource = (t) => t; export const toSource = (t) => t;",
      );
      const loudnessWorklet = {
        find: /^loudness-worklet\/worklet(?=\?|$)/,
        replacement: join(
          dirname(createRequire(join(STUDIO_DIR, "package.json")).resolve("loudness-worklet")),
          "loudness.worklet.js",
        ),
      };
      server = await createServer({
        configFile: false,
        logLevel: "silent",
        root: join(STUDIO_DIR, "app"),
        plugins: [react(), filmPlugin({ SRC: src, threeFrom: STUDIO_DIR })],
        resolve: {
          alias: [{ find: "@", replacement: join(STUDIO_DIR, "app") }, loudnessWorklet],
        },
        server: { middlewareMode: true, hmr: false },
      });
      [storeMod, sideMod, tooltipMod] = await Promise.all([
        server.ssrLoadModule("/core/store.ts"),
        server.ssrLoadModule("/shell/Side.tsx"),
        server.ssrLoadModule("/components/ui/tooltip.tsx"),
      ]);
    } catch (err) {
      await server?.close();
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      restoreDomGlobals();
      throw err;
    }
  }, 60_000);

  afterEach(() => {
    setCachedPortsSnapshot(null);
    if (storeMod) storeMod.set({ side: "notes", lib: "notes" });
  });

  afterAll(async () => {
    await server?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    restoreDomGlobals();
  }, 30_000);

  test("store keeps side and lib aligned for ports and film core tabs", () => {
    storeMod.set({ side: "ports" });
    assert.equal(storeMod.get().side, "ports");
    assert.equal(storeMod.get().lib, "ports");

    storeMod.set({ lib: "notes" });
    assert.equal(storeMod.get().lib, "notes");
    assert.equal(storeMod.get().side, "notes");

    storeMod.set({ lib: "ports" });
    assert.equal(storeMod.get().side, "ports");

    storeMod.set({ side: "film" });
    assert.equal(storeMod.get().lib, "film");
  });

  test("Library and narrow Side both expose the Ports tab after Film and render PortsPanel lazily when selected", async () => {
    const withStoreState = async (patch, renderFn) => {
      const origGetInitialState = storeMod.studio.getInitialState;
      storeMod.studio.getInitialState = storeMod.get;
      try {
        storeMod.set(patch);
        return await renderFn();
      } finally {
        storeMod.studio.getInitialState = origGetInitialState;
        storeMod.set({ lib: "notes", side: "notes" });
      }
    };
    const renderStream = async (node) => {
      const stream = await renderToReadableStream(node);
      await stream.allReady;
      return await new Response(stream).text();
    };

    const defaultLibHtml = await withStoreState({ lib: "notes", side: "notes" }, () =>
      renderToStaticMarkup(
        createElement(tooltipMod.TooltipProvider, { delay: 0 }, createElement(sideMod.Library)),
      ),
    );
    assert.match(defaultLibHtml, /Film[\s\S]*Ports/);
    assert.doesNotMatch(defaultLibHtml, /aria-label="Active studio ports"/);

    const libHtml = await withStoreState({ lib: "ports", side: "ports" }, () =>
      renderStream(
        createElement(tooltipMod.TooltipProvider, { delay: 0 }, createElement(sideMod.Library)),
      ),
    );
    assert.match(libHtml, /Film[\s\S]*Ports/);
    assert.match(libHtml, /aria-label="Active studio ports"/);
    assert.match(libHtml, /Scanning active studios/);

    const sideHtml = await withStoreState({ lib: "ports", side: "ports" }, () =>
      renderStream(
        createElement(
          tooltipMod.TooltipProvider,
          { delay: 0 },
          createElement(sideMod.Side, { wide: false }),
        ),
      ),
    );
    assert.match(sideHtml, /Film[\s\S]*Ports/);
    assert.match(sideHtml, /aria-label="Active studio ports"/);
    assert.match(sideHtml, /Scanning active studios/);
  });
});
