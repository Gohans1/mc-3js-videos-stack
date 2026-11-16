import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

const STUDIO = join(import.meta.dir, "..");
const studioRequire = createRequire(join(STUDIO, "package.json"));
const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function installDomGlobals() {
  const keys = [
    "window",
    "document",
    "addEventListener",
    "removeEventListener",
    "Audio",
    "AudioWorkletNode",
    "sessionStorage",
    "localStorage",
    "location",
    "matchMedia",
    "innerWidth",
    "innerHeight",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "__STUDIO_BOOT",
  ];
  const prev = new Map(keys.map((k) => [k, [k in globalThis, globalThis[k]]]));
  const storage = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => void m.set(k, String(v)),
      removeItem: (k) => void m.delete(k),
    };
  };
  globalThis.window = globalThis;
  globalThis.addEventListener = globalThis.addEventListener ?? (() => {});
  globalThis.removeEventListener = globalThis.removeEventListener ?? (() => {});
  globalThis.Audio = class {
    src = "";
    preload = "";
    addEventListener() {}
    removeEventListener() {}
    pause() {}
    play() {
      return Promise.resolve();
    }
  };
  globalThis.AudioWorkletNode = class {};
  globalThis.document = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
    createElement: () => ({ canPlayType: () => "probably", style: {} }),
    querySelector: () => null,
    documentElement: { style: { setProperty() {} } },
  };
  globalThis.sessionStorage = storage();
  globalThis.localStorage = storage();
  globalThis.location = new URL("http://localhost:4173/");
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.innerWidth = 1440;
  globalThis.innerHeight = 900;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.__STUDIO_BOOT = { features: {}, tags: {}, small: false };
  return () => {
    for (const [k, [had, val]] of prev) {
      if (had) globalThis[k] = val;
      else delete globalThis[k];
    }
  };
}

async function loadUiBundle() {
  const dir = mkdtempSync(join(tmpdir(), "studio-slider-bundle-"));
  tmpDirs.push(dir);
  const entry = join(dir, "entry.ts");
  writeFileSync(
    entry,
    [
      `export * as React from ${JSON.stringify(studioRequire.resolve("react"))};`,
      `export { renderToStaticMarkup } from ${JSON.stringify(studioRequire.resolve("react-dom/server"))};`,
      `export * as slider from ${JSON.stringify(join(STUDIO, "app/components/Slider.tsx"))};`,
      `export * as ownPanel from ${JSON.stringify(join(STUDIO, "app/own/OwnPanel.tsx"))};`,
      `export * as store from ${JSON.stringify(join(STUDIO, "app/core/store.ts"))};`,
    ].join("\n"),
  );
  const buildScript = join(dir, "build.mjs");
  writeFileSync(
    buildScript,
    `const plugin = {
  name: "studio-ui-test-stubs",
  setup(build) {
    build.onResolve({ filter: /\\?(?:worker&url|url)$/ }, (args) => ({
      path: args.path,
      namespace: "url-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "url-stub" }, () => ({
      contents: "export default 'blob:stub';",
      loader: "js",
    }));
    build.onResolve({ filter: /^film\\/(edit|scene)$/ }, (args) => ({
      path: args.path,
      namespace: "film-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "film-stub" }, () => ({
      contents: "export const EDIT = { end: 10 }; export const SHOTS_OUT = []; export const fromSource = () => []; export const toSource = (x) => x; export const buildScene = () => ({}); export const SCENES = {};",
      loader: "js",
    }));
  },
};
const out = await Bun.build({
  entrypoints: [${JSON.stringify(entry)}],
  outdir: ${JSON.stringify(dir)},
  format: "esm",
  target: "browser",
  plugins: [plugin],
});
if (!out.success) {
  console.error(out.logs.map((l) => l.message).join("\\n"));
  process.exit(1);
}
`,
  );
  const res = spawnSync(process.execPath, [buildScript], { cwd: STUDIO, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || `build exited ${res.status}`);
  }
  return await import(pathToFileURL(join(dir, "entry.js")).href);
}

test("Slider scientific-notation precision, mini appearance, pointer/Escape cancellation, FullscreenTransport, and OwnPanel metaRev subscription", async () => {
  const restore = installDomGlobals();
  try {
    const { React, renderToStaticMarkup, slider, ownPanel, store } = await loadUiBundle();

    // 1. Scientific notation steps (e.g. 1e-7) must quantize cleanly
    assert.equal(slider.stepDecimals(1e-7), 7);
    assert.equal(slider.stepDecimals(2.5e-4), 5);
    assert.equal(slider.quantize(3e-7, 0, 1, 1e-7), 3e-7);
    assert.equal(slider.quantize(5e-6, 1e-6, 1e-5, 2e-6), 5e-6);

    // 2. appearance="mini" uses size-2 thumb (halfThumb=4), h-0.5 track, and keeps range fill (no adjust-slider)
    const miniHtml = renderToStaticMarkup(
      React.createElement(slider.Slider, {
        "aria-label": "Mini",
        appearance: "mini",
        min: 0,
        max: 100,
        value: 0,
      }),
    );
    assert.match(miniHtml, /h-0\.5/);
    assert.match(miniHtml, /size-2(?!\.5)/);
    assert.match(miniHtml, /min-h-2\.5/);
    assert.match(miniHtml, /data-slot="slider-range"/);
    assert.equal(miniHtml.includes("adjust-slider"), false);
    assert.match(miniHtml, /--thumb-pos:calc\(0% \+ 4px\)/);

    // 3. FullscreenTransport uses appearance="mini" without overrides
    const fsSrc = readFileSync(join(STUDIO, "app/shell/FullscreenTransport.tsx"), "utf8");
    assert.match(fsSrc, /appearance="mini"/);
    assert.equal(fsSrc.includes("[&_[data-slot="), false);

    // 4. Drag lifecycle: stationary click, pointercancel, lostpointercapture, and Escape+pointerup never emit spurious commits
    assert.equal(typeof slider.createSliderDrag, "function");
    const makeTarget = () => {
      let captured = null;
      return {
        el: {
          setPointerCapture(id) {
            captured = id;
          },
          hasPointerCapture(id) {
            return captured === id;
          },
          releasePointerCapture(id) {
            if (captured === id) captured = null;
          },
        },
        isCaptured: () => captured !== null,
      };
    };

    // 4a. Stationary click (value unchanged) -> no commit
    {
      const commits = [];
      let val = 10;
      const d = slider.createSliderDrag({
        getCurrent: () => val,
        onCommit: (v) => commits.push(v),
      });
      const t = makeTarget();
      assert.equal(d.start(t.el, 1, 10), false);
      d.end(t.el, 1);
      assert.deepEqual(commits, []);
      assert.equal(t.isCaptured(), false);
    }

    // 4b. Click at different track position -> changes value on down, commits once on up
    {
      const commits = [];
      let val = 10;
      const d = slider.createSliderDrag({
        getCurrent: () => val,
        onCommit: (v) => commits.push(v),
      });
      const t = makeTarget();
      assert.equal(d.start(t.el, 1, 42), true);
      val = 42;
      d.end(t.el, 1);
      assert.deepEqual(commits, [42]);
    }

    // 4c. Drag + pointercancel / lostpointercapture -> does not commit
    for (const kind of ["cancel", "lostcapture"]) {
      const commits = [];
      let val = 10;
      const d = slider.createSliderDrag({
        getCurrent: () => val,
        onCommit: (v) => commits.push(v),
      });
      const t = makeTarget();
      d.start(t.el, 2, 10);
      assert.equal(d.move(35), true);
      val = 35;
      if (kind === "lostcapture") t.el.releasePointerCapture(2);
      d.cancel(t.el, 2);
      d.end(t.el, 2);
      assert.deepEqual(commits, []);
      assert.equal(t.isCaptured(), false);
    }

    // 4d. Drag + Escape + delayed pointerup -> Escape cancels active drag so pointerup does not commit
    {
      const commits = [];
      let val = 10;
      const d = slider.createSliderDrag({
        getCurrent: () => val,
        onCommit: (v) => commits.push(v),
      });
      const t = makeTarget();
      d.start(t.el, 3, 10);
      assert.equal(d.move(75), true);
      val = 75;
      assert.equal(d.cancel(t.el, 3), true);
      assert.equal(t.isCaptured(), false);
      d.end(t.el, 3);
      assert.deepEqual(commits, []);
    }

    // 5. OwnPanel must subscribe to metaRev so late metadata refreshes (SHOTS_OUT/BUILTINS) re-render it
    const accessed = new Set();
    const origGetInitial = store.studio.getInitialState;
    const origGetState = store.studio.getState;
    const wrap = (orig) => () => {
      const s = orig();
      return new Proxy(s, {
        get(target, prop, recv) {
          accessed.add(String(prop));
          return Reflect.get(target, prop, recv);
        },
      });
    };
    store.studio.getInitialState = wrap(origGetInitial);
    store.studio.getState = wrap(origGetState);
    try {
      renderToStaticMarkup(React.createElement(ownPanel.OwnPanel));
    } finally {
      store.studio.getInitialState = origGetInitial;
      store.studio.getState = origGetState;
    }
    assert.equal(accessed.has("metaRev"), true, "OwnPanel must read/subscribe to metaRev");
  } finally {
    restore();
  }
});
