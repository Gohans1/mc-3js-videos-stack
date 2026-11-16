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

test("GET / drops cached ?v= boot tags when film-local SFX overrides change resolved path or source .wav", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "studio-sfx-tag-evict-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const vaultWav = join(tmp, "vault-hit.wav");
  const localWav = join(tmp, "local-hit.wav");
  const smallWebm = join(tmp, "hit.webm");
  writeFileSync(vaultWav, Buffer.from("RIFFvault000"));
  writeFileSync(localWav, Buffer.from("RIFFlocalOverride000"));
  writeFileSync(smallWebm, Buffer.from("webm-small-v1"));

  let currentWav = vaultWav;
  const app = createApi(
    {
      NAME: "tag-test",
      ratio: () => "16:9",
      sound: {
        read: () => ({ version: "v1", data: { beds: [], sfx: [] } }),
        fileOf: (name) => (name === "hit" ? currentWav : null),
      },
      smallSfx: async (name) => (name === "hit" ? smallWebm : null),
      openRead: (file, range) => createReadStream(file, range),
      PUBLIC: tmp,
    },
    {
      page: {
        dir: tmp,
        html: () => "<!doctype html><html><head></head><body></body></html>",
      },
      events: new Set(),
      build: () => "b1",
    },
  );

  const extractTags = async () => {
    const res = await app.request("/");
    assert.equal(res.status, 200);
    const html = await res.text();
    const match = html.match(/window\.__STUDIO_BOOT=(\{.*?\});/);
    assert.ok(match, "expected __STUDIO_BOOT in GET / response");
    return JSON.parse(match[1]).tags;
  };

  assert.equal((await app.request("/api/sfx/hit.wav")).status, 200);
  assert.equal((await app.request("/api/sfx/hit.webm")).status, 200);
  const tagsBefore = await extractTags();
  assert.ok(tagsBefore["/api/sfx/hit.wav"]);
  assert.ok(tagsBefore["/api/sfx/hit.webm"]);

  // Switch fileOf("hit") to a film-local override: both .wav and .webm boot tags must be evicted
  currentWav = localWav;
  const tagsAfterPathChange = await extractTags();
  assert.equal(tagsAfterPathChange["/api/sfx/hit.wav"], undefined);
  assert.equal(tagsAfterPathChange["/api/sfx/hit.webm"], undefined);

  // Re-prime .webm tag, then mutate localWav size/mtime without touching smallWebm -> .webm tag must evict
  assert.equal((await app.request("/api/sfx/hit.webm")).status, 200);
  assert.ok((await extractTags())["/api/sfx/hit.webm"]);
  writeFileSync(localWav, Buffer.from("RIFFlocalOverrideModifiedSize0000"));
  assert.equal((await extractTags())["/api/sfx/hit.webm"], undefined);
});

test("GET /api/sound?used=1 returns only referenced sounds and ?library=1 returns full library with 304", async () => {
  let libraryCalls = 0;
  const fullLibrary = [
    { name: "bed_a", seconds: 5, title: "Bed A", source: "mixkit", kind: "bed", origin: "real" },
    {
      name: "sfx_used",
      seconds: 0.5,
      title: "Used",
      source: "mixkit",
      kind: "sfx",
      origin: "real",
    },
    { name: "sfx_try", seconds: 0.5, title: "Try", source: "mixkit", kind: "sfx", origin: "real" },
    {
      name: "sfx_unused",
      seconds: 0.5,
      title: "Unused",
      source: "mixkit",
      kind: "sfx",
      origin: "real",
    },
  ];
  const app = createApi(
    {
      sound: {
        read: () => ({
          version: "v2",
          data: {
            beds: [{ name: "bed_a", from: 0, to: 4, gain: 0 }],
            sfx: [{ name: "sfx_used", at: 1, gain: 0, try: ["sfx_try"] }],
          },
        }),
        library: () => {
          libraryCalls++;
          return fullLibrary;
        },
        fileOf: () => null,
      },
      liveLanes: () => false,
      PUBLIC: ".",
    },
    { page: { dir: "." }, events: new Set() },
  );

  const usedRes = await app.request("/api/sound?used=1");
  assert.equal(usedRes.status, 200);
  const usedBody = await usedRes.json();
  assert.deepEqual(
    usedBody.library.map((x) => x.name),
    ["bed_a", "sfx_used", "sfx_try"],
  );
  assert.equal(usedBody.version, "v2");

  const libRes = await app.request("/api/sound?library=1");
  assert.equal(libRes.status, 200);
  const libEtag = libRes.headers.get("etag");
  assert.ok(libEtag);
  const libBody = await libRes.json();
  assert.equal(libBody.library.length, 4);
  assert.equal(libraryCalls, 2);

  assert.equal(
    (await app.request("/api/sound?library=1", { headers: { "if-none-match": libEtag } })).status,
    304,
  );
});

test("GET / evicts /api/mix_small.webm ?v= boot tag when film.MIX changes without a sound.json version bump", async (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "studio-mix-small-tag-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const mixWav = join(tmp, "mix.wav");
  const mixSmall = join(tmp, "mix_small.webm");
  writeFileSync(mixWav, Buffer.from("RIFFmix-v1"));
  writeFileSync(mixSmall, Buffer.from("webm-small-v1"));

  let smallCalls = 0;
  const app = createApi(
    {
      NAME: "mix-tag-test",
      ratio: () => "16:9",
      MIX: mixWav,
      MIX_SMALL: mixSmall,
      sound: {
        read: () => ({ version: "same-ver", data: { beds: [], sfx: [] } }),
        fileOf: () => null,
      },
      smallMix: async () => {
        smallCalls++;
      },
      openRead: (file, range) => createReadStream(file, range),
      PUBLIC: tmp,
    },
    {
      page: {
        dir: tmp,
        html: () => "<!doctype html><html><head></head><body></body></html>",
      },
      events: new Set(),
      build: () => "b1",
    },
  );

  const extractTags = async () => {
    const res = await app.request("/");
    assert.equal(res.status, 200);
    const match = (await res.text()).match(/window\.__STUDIO_BOOT=(\{.*?\});/);
    return JSON.parse(match[1]).tags;
  };

  const first = await app.request("/api/mix_small.webm");
  assert.equal(first.status, 200);
  assert.equal(smallCalls, 1);
  assert.ok((await extractTags())["/api/mix_small.webm"]);

  // Mutate mix.wav (e.g. voice render or remix without sound.json version change) while mix_small.webm hasn't rebuilt yet
  writeFileSync(mixWav, Buffer.from("RIFFmix-v2-different-audio-length"));
  assert.equal((await extractTags())["/api/mix_small.webm"], undefined);
});
