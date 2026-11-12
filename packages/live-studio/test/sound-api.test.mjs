import assert from "node:assert/strict";
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { createApi } from "../src/api.mjs";

test("a deleted sound returns a readable error to analysis and processing controls", async () => {
  const app = createApi(
    { sound: { fileOf: () => null }, PUBLIC: "." },
    { page: { dir: "." }, events: {} },
  );
  for (const job of ["beats", "process"]) {
    const response = await app.request(`/api/sound/${job}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "deleted", start: 0, duration: 12, loop: false }),
    });
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /sound file is unavailable/i);
  }
});

test("sfx routes stream .ogg files with audio/ogg content-type across both .wav and .ogg URLs", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "studio-sfx-ogg-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const oggFile = join(tmp, "mc-step-stone-1.ogg");
  const payload = Buffer.from("OggS\0\x02test-vorbis-stream");
  writeFileSync(oggFile, payload);

  const app = createApi(
    {
      sound: {
        fileOf: (name) => (name === "mc-step-stone-1" ? oggFile : null),
        peaks: (name) => (name === "mc-step-stone-1" ? { step: 0.02, peaks: [0.25, 0.75] } : null),
      },
      openRead: (file, range) => createReadStream(file, range),
      PUBLIC: tmp,
    },
    { page: { dir: tmp }, events: new Set() },
  );

  for (const ext of ["wav", "ogg"]) {
    const res = await app.request(`/api/sfx/mc-step-stone-1.${ext}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/ogg");
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), payload);

    const rangeRes = await app.request(`/api/sfx/mc-step-stone-1.${ext}`, {
      headers: { range: "bytes=0-7" },
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get("content-type"), "audio/ogg");
    assert.equal(rangeRes.headers.get("content-range"), `bytes 0-7/${payload.length}`);
    assert.deepEqual(Buffer.from(await rangeRes.arrayBuffer()), payload.subarray(0, 8));
  }

  const peaksRes = await app.request("/api/sfx/mc-step-stone-1/peaks");
  assert.equal(peaksRes.status, 200);
  assert.deepEqual(await peaksRes.json(), { step: 0.02, peaks: [0.25, 0.75] });
  assert.equal((await app.request("/api/sfx/missing-sound/peaks")).status, 404);
});

test("GET /api/sound compresses large library payloads with Brotli, supports If-None-Match 304, and omits library on ?lanes=1", async () => {
  let libraryCalls = 0;
  const bigLibrary = Array.from({ length: 200 }, (_, i) => ({
    name: `sfx-item-${i}`,
    seconds: 1.25,
    title: `Sound Effect Item ${i}`,
    source: "mixkit",
    kind: "sfx",
    origin: "real",
  }));
  const app = createApi(
    {
      sound: {
        read: () => ({ version: "v1", data: { beds: [], sfx: [] } }),
        library: () => {
          libraryCalls++;
          return bigLibrary;
        },
        fileOf: (n) => (n === "tap" ? "tap.wav" : null),
      },
      liveLanes: () => true,
      measureSound: async () => ({ loudness: -14, peak: -1 }),
      PUBLIC: ".",
    },
    { page: { dir: "." }, events: new Set() },
  );

  const fullRes = await app.request("/api/sound", {
    headers: { "accept-encoding": "br, gzip" },
  });
  assert.equal(fullRes.status, 200);
  assert.equal(fullRes.headers.get("content-encoding"), "br");
  const etag = fullRes.headers.get("etag");
  assert.ok(etag);
  const decoded = JSON.parse(
    brotliDecompressSync(Buffer.from(await fullRes.arrayBuffer())).toString("utf8"),
  );
  assert.equal(decoded.library.length, 200);
  assert.equal(decoded.live, true);
  assert.equal(libraryCalls, 1);

  const cachedRes = await app.request("/api/sound", {
    headers: { "if-none-match": etag, "accept-encoding": "br" },
  });
  assert.equal(cachedRes.status, 304);

  const callsBeforeLanes = libraryCalls;
  const lanesRes = await app.request("/api/sound?lanes=1");
  assert.equal(lanesRes.status, 200);
  const lanesBody = await lanesRes.json();
  assert.equal(lanesBody.library, undefined);
  assert.equal(lanesBody.live, true);
  assert.equal(lanesBody.version, "v1");
  assert.equal(libraryCalls, callsBeforeLanes, "?lanes=1 must skip film.sound.library()");

  // POST /api/sound/measure must also verify clip.try candidates exist via fileOf
  const badTryRes = await app.request("/api/sound/measure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      list: "sfx",
      i: 0,
      data: { beds: [], sfx: [{ at: 0, name: "tap", gain: 0, try: ["missing_alt"] }] },
    }),
  });
  assert.equal(badTryRes.status, 404);
});
