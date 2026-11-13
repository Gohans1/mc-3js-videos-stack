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

  // a zip remade after its copy: the stale copy is never sent
  const later = new Date(Date.now() + 60_000);
  utimesSync(zip, later, later);
  const remade = await app.request("/mc/client_assets.zip", {
    headers: { "accept-encoding": "br" },
  });
  const body = Buffer.from(await remade.arrayBuffer());
  const got = remade.headers.get("content-encoding") === "br" ? brotliDecompressSync(body) : body;
  assert.deepEqual(got, Buffer.alloc(4096, 1)); // the zip itself (squeezed as it goes), never the stale copy
});
