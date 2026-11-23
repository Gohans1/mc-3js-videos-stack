import assert from "node:assert/strict";
import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { createApi } from "../src/api.mjs";

const filmAt = (dir) =>
  createApi(
    { PUBLIC: dir, openRead: (f, o) => createReadStream(f, o) },
    { page: { dir }, events: new Set() },
  );

test("critical film fetches are preloaded before the app module with matching anonymous CORS", async () => {
  const app = createApi(
    { PUBLIC: ".", NAME: "test", ratio: () => "9:16", preloads: () => ["/mc/client_assets.zip"] },
    {
      page: {
        html: () => '<html><head><script type="module" src="/app.js"></script></head></html>',
        dir: ".",
      },
      events: new Set(),
    },
  );
  const response = await app.request("/");
  const text = await response.text();
  const link = text.match(/<link\b[^>]*href="\/mc\/client_assets.zip"[^>]*>/)?.[0];
  assert.ok(link);
  for (const attr of [
    'rel="preload"',
    'as="fetch"',
    'crossorigin="anonymous"',
    'fetchpriority="low"',
  ])
    assert.ok(link.includes(attr));
  assert.ok(text.indexOf('<link rel="preload"') < text.indexOf('<script type="module"'));
});

test("a preload URL remains an escaped attribute in the built page", async () => {
  const app = createApi(
    {
      PUBLIC: ".",
      NAME: "test",
      ratio: () => "9:16",
      preloads: () => ['asset.zip"><script>alert(1)</script>'],
    },
    { page: { html: () => "<html><head></head></html>", dir: "." }, events: new Set() },
  );
  const text = await (await app.request("/")).text();
  assert.ok(text.includes("asset.zip&quot;&gt;&lt;script&gt;"));
  assert.ok(!text.includes("<script>alert(1)</script>"));
});

test("a film file with a brotli copy beside it goes out as that copy to a browser that reads brotli", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-film-files-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "mc"));
  const zip = join(dir, "mc/client_assets.zip");
  writeFileSync(zip, Buffer.alloc(4096, 1));
  writeFileSync(`${zip}.br`, "squeezed ahead of time");
  const app = filmAt(dir);

  const br = await app.request("/mc/client_assets.zip", {
    headers: { "accept-encoding": "gzip, br" },
  });
  assert.equal(br.status, 200);
  assert.equal(br.headers.get("content-encoding"), "br");
  assert.equal(br.headers.get("vary"), "accept-encoding");
  assert.equal(await br.text(), "squeezed ahead of time");

  const plain = await app.request("/mc/client_assets.zip", {
    headers: { "accept-encoding": "identity" },
  });
  assert.equal(plain.headers.get("content-encoding"), null);
  assert.equal((await plain.arrayBuffer()).byteLength, 4096);

  const later = new Date(Date.now() + 60_000);
  utimesSync(zip, later, later);
  const remade = await app.request("/mc/client_assets.zip", {
    headers: { "accept-encoding": "br" },
  });
  const body = Buffer.from(await remade.arrayBuffer());
  const got = remade.headers.get("content-encoding") === "br" ? brotliDecompressSync(body) : body;
  assert.deepEqual(got, Buffer.alloc(4096, 1));
});

test("preloads use the asset version from the same boot metadata and discard stale tags", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-preload-version-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "mc"));
  const path = join(dir, "mc/client_assets.zip");
  writeFileSync(path, new Uint8Array(20));
  const app = createApi(
    {
      PUBLIC: dir,
      openRead: (f, o) => createReadStream(f, o),
      ratio: () => "9:16",
      preloads: () => ["mc/client_assets.zip"],
    },
    {
      page: {
        dir,
        html: () => '<html><head><script type="module" src="/app.js"></script></head></html>',
      },
      events: new Set(),
    },
  );
  const asset = await app.request("/mc/client_assets.zip");
  const tag = asset.headers.get("etag").replaceAll('"', "");
  await asset.arrayBuffer();
  const text = await (await app.request("/")).text();
  assert.ok(text.includes(`href="mc/client_assets.zip?v=${tag}"`));
  writeFileSync(path, new Uint8Array(21));
  const changed = await (await app.request("/")).text();
  assert.match(changed, /href="mc\/client_assets.zip\?v=21-/);
  assert.ok(!changed.includes(`href="mc/client_assets.zip?v=${tag}"`));
});

test("preloads preserve query and fragment markers like the browser's versioned fetch", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "studio-preload-query-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "asset.zip"), new Uint8Array(20));
  const hrefs = ["asset.zip?", "asset.zip#", "asset.zip?custom=1", "asset.zip#part"];
  const app = createApi(
    {
      PUBLIC: dir,
      openRead: (f, o) => createReadStream(f, o),
      ratio: () => "9:16",
      preloads: () => hrefs,
    },
    { page: { dir, html: () => "<html><head></head></html>" }, events: new Set() },
  );
  await (await app.request("/asset.zip")).arrayBuffer();
  const text = await (await app.request("/")).text();
  for (const href of hrefs) assert.ok(text.includes(`href="${href}"`), href);
});
