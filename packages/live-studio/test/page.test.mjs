import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { runInNewContext } from "node:vm";

import { build as buildCn } from "cn/build";

import { openFilm, STUDIO } from "../src/film.mjs";
import { buildPage, syncCnTables } from "../src/page.mjs";

const cache = join(STUDIO, ".studio");
mkdirSync(cache, { recursive: true });
const dir = mkdtempSync(join(cache, "studio-page-"));
cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
const scene = join(dir, "src/scene.ts"),
  original = readFileSync(scene, "utf8");
const heard = [];
let page, film;
const cycle = (trigger, file) =>
  new Promise((done, fail) => {
    let changed = !file,
      started = !file;
    const changedFile = (id) => {
      if (id.replaceAll("\\", "/") === file?.replaceAll("\\", "/")) changed = true;
    };
    const cleanup = () => {
      clearTimeout(timer);
      page.watcher.off("event", event);
      page.watcher.off("change", changedFile);
    };
    const event = (e) => {
      if (changed && e.code === "START") started = true;
      if (started && e.code === "END") {
        cleanup();
        done();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      fail(new Error(`Build cycle did not end for ${file ?? "initial build"}`));
    }, 20000);
    page.watcher.on("change", changedFile);
    page.watcher.on("event", event);
    trigger?.();
  });
const save = (text, file = scene) => cycle(() => writeFileSync(file, text), file);

before(async () => {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { timingTimeline: "src/timing.json" } }),
  );
  writeFileSync(join(dir, "src/timing.json"), "{}");
  mkdirSync(join(dir, "node_modules/nodeish"), { recursive: true });
  writeFileSync(
    join(dir, "node_modules/nodeish/package.json"),
    '{"name":"nodeish","main":"index.js"}',
  );
  writeFileSync(
    join(dir, "node_modules/nodeish/index.js"),
    'module.exports = { gunzip: (b) => require("zlib").gunzipSync(b) };',
  );
  writeFileSync(
    scene,
    `import { gunzip } from "nodeish";\nexport const unzip = gunzip;\n${original}`,
  );
  film = openFilm(dir, { send() {} });
  page = await buildPage(film, {
    onChange: () => heard.push("change"),
    onError: (m) => heard.push(`error ${m}`),
  });
  await cycle();
});
after(async () => {
  await page.close();
  film.stop();
  rmSync(dir, { recursive: true, force: true });
});

test("the film builds into the page, even with a Node library that requires a Node built-in", () => {
  assert.equal(heard.length, 0, heard.join("\n"));
  assert.match(page.html(), /src="\/_studio\/index-[\w-]+\.js"/);
  assert.ok(readdirSync(join(page.dir, "_studio")).some((f) => f.endsWith(".js")));
});

const serveBuild = (intercept) =>
  Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/")
        return new Response(page.html(), { headers: { "content-type": "text/html" } });
      if (!path.startsWith("/_studio/")) return new Response(null, { status: 404 });
      const name = path.split("/").at(-1);
      return (await intercept(name)) ?? new Response(Bun.file(join(page.dir, "_studio", name)));
    },
  });

test("Studio shows startup and mounts the editor while the film scene script is unavailable", async () => {
  const html = page.html();
  assert.match(html, /role="status"[^>]*>Starting Studio/);
  const assets = join(page.dir, "_studio");
  const sceneScripts = new Set(
    readdirSync(assets)
      .filter((file) => file.endsWith(".js.map"))
      .filter((file) =>
        JSON.parse(readFileSync(join(assets, file), "utf8")).sources.some((source) =>
          source.endsWith("/src/scene.ts"),
        ),
      )
      .map((file) => file.slice(0, -4)),
  );
  assert.ok(sceneScripts.size);
  const gate = Promise.withResolvers();
  let requestedScene = false;
  const server = serveBuild(async (name) => {
    if (sceneScripts.has(name)) {
      requestedScene = true;
      await gate.promise;
    }
  });
  let browser;
  try {
    browser = new Bun.WebView({ width: 1280, height: 800, backend: { type: "chrome" } });
    await browser.navigate(server.url.href);
    const deadline = Date.now() + 10000;
    let status;
    while (Date.now() < deadline) {
      status = await browser.evaluate(`document.querySelector('[data-preview-pane]') &&
        Array.from(document.querySelectorAll('[role="status"]')).map((el) => el.textContent)`);
      if (requestedScene && status?.some((s) => s.includes("Loading 3D engine"))) break;
      await Bun.sleep(50);
    }
    assert.ok(requestedScene, "the engine should start loading after the editor mounts");
    assert.ok(
      status?.some((s) => s.includes("Loading 3D engine")),
      JSON.stringify(status),
    );
    assert.equal(
      await browser.evaluate(`document.querySelector('button[aria-label="Play"]').disabled`),
      true,
    );
    await browser.press("Space");
    assert.equal(
      await browser.evaluate(
        `Boolean(document.querySelector('button[aria-label="Pause"], [role="alert"]'))`,
      ),
      false,
    );
    await browser.evaluate(`document.querySelector('button[aria-label="Add note"]').click()`);
    await browser.evaluate(`document.querySelector('textarea[aria-label="Note"]').focus()`);
    await browser.press("x");
    await browser.press("Enter");
    const draft = await browser.evaluate(`({
      text: document.querySelector('textarea[aria-label="Note"]')?.value,
      kept: document.body.textContent.includes("Save once the preview loads"),
    })`);
    assert.deepEqual(draft, { text: "x", kept: true });
  } finally {
    gate.resolve();
    browser?.close();
    server.stop(true);
  }
});

test("a missing stylesheet leaves the startup error readable", async () => {
  const server = serveBuild((name) =>
    name.endsWith(".css") ? new Response(null, { status: 503 }) : null,
  );
  let browser;
  try {
    browser = new Bun.WebView({ width: 1280, height: 800, backend: { type: "chrome" } });
    await browser.navigate(server.url.href);
    const deadline = Date.now() + 10000;
    let error;
    while (!error && Date.now() < deadline) {
      error = await browser.evaluate(`(() => {
        const box = document.querySelector('#root + pre');
        return box && {text: box.textContent, color: getComputedStyle(box).color};
      })()`);
      if (!error) await Bun.sleep(50);
    }
    assert.match(error?.text ?? "", /Couldn't load the studio/);
    assert.equal(error?.color, "rgb(206, 205, 195)");
  } finally {
    browser?.close();
    server.stop(true);
  }
});

const VENDOR_BUDGET_TEST = "the initial UI vendor code fits a 240 KiB Brotli budget";
test(VENDOR_BUDGET_TEST, () => {
  if (process.env.NODE_ENV !== "production") {
    const result = spawnSync(
      process.execPath,
      ["test", "--timeout", "20000", import.meta.filename, "-t", VENDOR_BUDGET_TEST],
      {
        env: { ...process.env, NODE_ENV: "production" },
        encoding: "utf8",
        timeout: 25000,
      },
    );
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    return;
  }
  const html = page.html();
  const loaders = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((s) => s.includes("matchMedia"));
  assert.ok(loaders.length > 0);
  for (const phone of [false, true]) {
    const links = new Set([...html.matchAll(/href="(\/[^"<>]+\.js)"/g)].map((m) => m[1]));
    for (const script of loaders)
      runInNewContext(script, {
        matchMedia: () => ({ matches: phone }),
        document: {
          createElement: () => ({}),
          head: { appendChild: (link) => links.add(link.href) },
        },
      });
    const paths = [...links].filter((p) => /^\/_studio\/(?:vendor-ui[-~]|vendor-react-)/.test(p));
    assert.ok(paths.length > 0);
    const bytes = paths.reduce((sum, path) => {
      const file = join(page.dir, path);
      return sum + statSync(existsSync(`${file}.br`) ? `${file}.br` : file).size;
    }, 0);
    assert.ok(
      bytes <= 240 * 1024,
      `${phone ? "phone" : "desktop"} UI vendor: ${bytes} bytes Brotli`,
    );
  }
});

test("a saved comment builds the same page and reloads nothing", async () => {
  const before = page.html();
  await save(`${readFileSync(scene, "utf8")}\n// a thought\n`);
  assert.equal(page.html(), before);
  assert.deepEqual(heard, []);
});

test("a broken save keeps the last page and says why; fixing it reloads", async () => {
  const good = readFileSync(scene, "utf8"),
    before = page.html();
  await save(`${good}\nexport const broken = ;\n`);
  assert.equal(page.html(), before);
  assert.equal(heard.length, 1);
  assert.match(heard[0], /^error /);
  assert.match(heard[0], /scene\.ts/);
  assert.equal(
    heard[0].includes("\x1b"),
    false,
    "the page shows this as text: no terminal colour codes",
  );
  await save(good);
  assert.deepEqual(heard.slice(1), ["change"]);
  heard.length = 0;
});

test("a real change to the film's code reloads the page", async () => {
  const before = page.html();
  await save(`${readFileSync(scene, "utf8")}\nexport const added = "new";\n`);
  assert.notEqual(page.html(), before);
  assert.deepEqual(heard, ["change"]);
});

test("a rebuild keeps the last build's files for pages still loading it, and clears out old ones", async () => {
  const code = join(page.dir, "_studio"),
    last = readdirSync(code);
  const stale = join(code, "index-gone.js"),
    longAgo = new Date(Date.now() - 2 * 3600e3);
  writeFileSync(stale, "");
  utimesSync(stale, longAgo, longAgo);
  await save(`${readFileSync(scene, "utf8")}\nexport const again = "newer";\n`);
  assert.deepEqual(
    last.filter((f) => !existsSync(join(code, f))),
    [],
  );
  assert.equal(existsSync(stale), false);
});

test("a changed edit.json is a new page, offered like code: the next reload has it", async () => {
  heard.length = 0;
  const edit = join(dir, "src/edit.json"),
    before = page.html();
  await save(
    JSON.stringify({ ...JSON.parse(readFileSync(edit, "utf8")), added: 1 }, null, 1),
    edit,
  );
  assert.notEqual(page.html(), before);
  assert.deepEqual(heard, ["change"]);
});

test("vendor chunks stay cached across film edits with fresh .br and .gz siblings", async () => {
  const code = join(page.dir, "_studio");
  const vendorsBefore = readdirSync(code)
    .filter((f) => /^vendor-.*\.js$/.test(f))
    .sort();
  const original = new Map(vendorsBefore.map((v) => [v, readFileSync(join(code, v))]));
  assert.ok(
    vendorsBefore.length >= 2,
    `expected split vendor chunks, got: ${vendorsBefore.join(", ")}`,
  );
  for (const v of vendorsBefore) {
    if (statSync(join(code, v)).size < 1024) continue;
    assert.equal(existsSync(join(code, `${v}.br`)), true, `missing ${v}.br`);
    assert.equal(existsSync(join(code, `${v}.gz`)), true, `missing ${v}.gz`);
    const old = new Date(Date.now() - 3700e3);
    utimesSync(join(code, `${v}.br`), old, old);
    utimesSync(join(code, `${v}.gz`), old, old);
  }
  await save(`${readFileSync(scene, "utf8")}\nexport const cacheCheck = 42;\n`);
  const vendorsAfter = readdirSync(code)
    .filter((f) => /^vendor-.*\.js$/.test(f))
    .sort();
  assert.deepEqual(vendorsAfter, vendorsBefore);
  for (const v of vendorsAfter) {
    assert.deepEqual(readFileSync(join(code, v)), original.get(v));
    if (statSync(join(code, v)).size < 1024) continue;
    assert.equal(existsSync(join(code, `${v}.br`)), true, `clearOld evicted active ${v}.br`);
    assert.equal(existsSync(join(code, `${v}.gz`)), true, `clearOld evicted active ${v}.gz`);
  }
});

test("syncCnTables preserves existing CRLF/formatted file without spurious rewrites and matches app/index.css", async () => {
  const cnDir = mkdtempSync(join(dir, "cn-sync-"));
  const cssPath = join(STUDIO, "app/index.css");
  const outPath = join(cnDir, "cn-tables.ts");

  const repoTables = readFileSync(join(STUDIO, "app/lib/cn-tables.ts"), "utf8");
  const crlf = repoTables.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
  writeFileSync(outPath, crlf);
  const beforeStat = statSync(outPath).mtimeMs;
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(await syncCnTables({ cssPath, outPath }), false);
  assert.equal(readFileSync(outPath, "utf8"), crlf);
  assert.equal(statSync(outPath).mtimeMs, beforeStat);

  rmSync(outPath);
  assert.equal(await syncCnTables({ cssPath, outPath }), true);
  const refOut = join(cnDir, "ref-cn-tables.ts");
  await buildCn({ cwd: STUDIO, css: cssPath, full: true, out: refOut });
  assert.equal(
    readFileSync(outPath, "utf8"),
    readFileSync(refOut, "utf8").replaceAll("./ref-cn-tables.ts", "./cn-tables.ts"),
  );
});
