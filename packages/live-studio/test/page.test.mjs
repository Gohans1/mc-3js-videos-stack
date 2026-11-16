import assert from "node:assert/strict";
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { build as buildCn } from "cn/build";

import { openFilm, STUDIO } from "../src/film.mjs";
import { buildPage, syncCnTables } from "../src/page.mjs";

// A copy of the demo film, so saves here never touch the real one
const dir = mkdtempSync(join(tmpdir(), "studio-page-"));
cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
const scene = join(dir, "src/scene.ts"),
  original = readFileSync(scene, "utf8");
const heard = [];
let page;
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
  // A library written for Node that a film may pull in (Minecraft's nbt readers do): its require of zlib is never reached
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
  page = await buildPage(openFilm(dir, { send() {} }), {
    onChange: () => heard.push("change"),
    onError: (m) => heard.push(`error ${m}`),
  });
  await cycle();
});
after(async () => {
  await page.close();
  rmSync(dir, { recursive: true, force: true });
});

test("the film builds into the page, even with a Node library that requires a Node built-in", () => {
  assert.equal(heard.length, 0, heard.join("\n"));
  assert.match(page.html(), /src="\/_studio\/index-[\w-]+\.js"/);
  assert.ok(readdirSync(join(page.dir, "_studio")).some((f) => f.endsWith(".js")));
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
  assert.ok(
    vendorsBefore.length >= 2,
    `expected split vendor chunks, got: ${vendorsBefore.join(", ")}`,
  );
  for (const v of vendorsBefore) {
    assert.equal(existsSync(join(code, `${v}.br`)), true, `missing ${v}.br`);
    assert.equal(existsSync(join(code, `${v}.gz`)), true, `missing ${v}.gz`);
    // Age the precompressed siblings near KEEP so a rebuild that forgets to touch them would let clearOld() delete them
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
    assert.equal(existsSync(join(code, `${v}.br`)), true, `clearOld evicted active ${v}.br`);
    assert.equal(existsSync(join(code, `${v}.gz`)), true, `clearOld evicted active ${v}.gz`);
  }
});

test("syncCnTables preserves existing CRLF/formatted file without spurious rewrites and matches app/index.css", async () => {
  const cnDir = mkdtempSync(join(dir, "cn-sync-"));
  const cssPath = join(STUDIO, "app/index.css");
  const outPath = join(cnDir, "cn-tables.ts");

  // 1. Checked-in app/lib/cn-tables.ts (formatted / CRLF) must match app/index.css without rewriting
  const repoTables = readFileSync(join(STUDIO, "app/lib/cn-tables.ts"), "utf8");
  const crlf = repoTables.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
  writeFileSync(outPath, crlf);
  const beforeStat = statSync(outPath).mtimeMs;
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(await syncCnTables({ cssPath, outPath }), false);
  assert.equal(readFileSync(outPath, "utf8"), crlf);
  assert.equal(statSync(outPath).mtimeMs, beforeStat);

  // 2. When outPath is missing or stale, syncCnTables writes fresh tables from buildCn
  rmSync(outPath);
  assert.equal(await syncCnTables({ cssPath, outPath }), true);
  const refOut = join(cnDir, "ref-cn-tables.ts");
  await buildCn({ cwd: STUDIO, css: cssPath, full: true, out: refOut });
  assert.equal(
    readFileSync(outPath, "utf8"),
    readFileSync(refOut, "utf8").replaceAll("./ref-cn-tables.ts", "./cn-tables.ts"),
  );
});
