import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { strToU8, zipSync } from "fflate";

import { fetchSoundRaw } from "../fetch_sound_raw.mjs";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

async function fixture(t, zips, packs) {
  const root = mkdtempSync(join(tmpdir(), "sound-raw-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    const zip = zips[req.url.slice(1)];
    if (!zip) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.end(zip);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}/`;
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "downloads"));
  writeFileSync(
    join(root, "scripts/sound-raw.json"),
    JSON.stringify({
      sources: {
        kenney: {
          licence: "CC0 1.0",
          packs: packs.map((p) => (p.file ? { ...p, file: base + p.file } : p)),
        },
      },
    }),
  );
  const external = join(root, "ext");
  return {
    external,
    raw: join(external, "sound-raw"),
    downloads: join(root, "downloads"),
    requests: () => requests,
    fetch: () =>
      fetchSoundRaw({ root, external, downloads: join(root, "downloads"), log: () => {} }),
  };
}

test("each pack is unpacked from its pinned zip without the Mac metadata, and a second run downloads nothing", async (t) => {
  const zip = zipSync({
    "Audio/click.ogg": strToU8("ogg"),
    "__MACOSX/Audio/._click.ogg": strToU8("mac"),
    "License.txt": strToU8("CC0"),
  });
  const f = await fixture(t, { "ui.zip": zip }, [
    { id: "ui", title: "UI", file: "ui.zip", sha256: sha256(zip) },
  ]);
  const first = await f.fetch();
  assert.deepEqual(first.failed, []);
  assert.equal(readFileSync(join(f.raw, "kenney/ui/Audio/click.ogg"), "utf8"), "ogg");
  assert.equal(existsSync(join(f.raw, "kenney/ui/__MACOSX")), false);
  const asked = f.requests();
  await f.fetch();
  assert.equal(f.requests(), asked);
});

test("a zip that differs from its pinned sha256 is refused and nothing is unpacked", async (t) => {
  const zip = zipSync({ "a.ogg": strToU8("x") });
  const f = await fixture(t, { "a.zip": zip }, [
    { id: "a", title: "A", file: "a.zip", sha256: "0".repeat(64) },
  ]);
  const result = await f.fetch();
  assert.deepEqual(result.failed, ["a"]);
  assert.equal(existsSync(join(f.raw, "kenney/a")), false);
});

test("an entry that climbs out of its pack folder is refused", async (t) => {
  const zip = zipSync({ "../../escape.ogg": strToU8("x") });
  const f = await fixture(t, { "bad.zip": zip }, [
    { id: "bad", title: "Bad", file: "bad.zip", sha256: sha256(zip) },
  ]);
  const result = await f.fetch();
  assert.deepEqual(result.failed, ["bad"]);
  assert.equal(existsSync(join(f.raw, "escape.ogg")), false);
  assert.equal(existsSync(join(f.external, "escape.ogg")), false);
});

test("a pack the site only hands to a browser waits for its zip, then is taken from Downloads", async (t) => {
  const f = await fixture(t, {}, [
    {
      id: "impact-sounds",
      title: "Impact Sounds",
      page: "https://kenney.nl/assets/impact-sounds",
      byHand: "kenney_impact-sounds.zip",
    },
  ]);
  const before = await f.fetch();
  assert.equal(before.waiting.length, 1);
  assert.match(before.waiting[0], /kenney\.nl\/assets\/impact-sounds/);
  writeFileSync(
    join(f.downloads, "kenney_impact-sounds.zip"),
    zipSync({ "Audio/impactGlass_heavy_000.ogg": strToU8("ogg") }),
  );
  const after = await f.fetch();
  assert.deepEqual(after.waiting, []);
  assert.equal(
    existsSync(join(f.raw, "kenney/impact-sounds/Audio/impactGlass_heavy_000.ogg")),
    true,
  );
});
