import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const put = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

test("OpenFilm source, licenses and native audio travel together and source paths rebase after ZIP restore", async (t) => {
  const { packSound, restoreSound } = await import("../sound_zip.mjs");
  const { readAssetCatalog, writeAssetCatalog } = await import("../openfilm/catalog.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-openfilm-zip-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = { local: join(root, "old/vault"), external: join(root, "old/ext") };
  const fresh = { local: join(root, "new/vault"), external: join(root, "new/ext") };
  const html = "<html>editable transition</html>",
    id = "transitions/wipe";
  put(join(old.local, "openfilm/library", id, "files/wipe.html"), html);
  put(join(old.local, "openfilm/library/LICENSE.md"), "CC0; Fluent Emoji Microsoft MIT notice");
  put(join(old.local, "sound/sfx/transitions/of-sfx-whoosh.wav"), "native audio bytes");
  put(
    join(old.local, "sound/SOURCES.json"),
    '{"of-sfx-whoosh":{"source":"openfilm","category":"transitions"}}',
  );
  writeAssetCatalog(
    [
      {
        id,
        kind: "page",
        cat: "transition",
        group: "wipe",
        src: "wipe.html",
        name: { en: "Wipe" },
      },
    ],
    join(old.local, "openfilm/library"),
  );
  const zip = join(root, "private-assets.zip");
  assert.equal((await packSound({ ...old, out: zip, log: () => {} })).files, 5);
  await restoreSound({ zip, ...fresh, log: () => {} });
  const [entry] = readAssetCatalog(join(fresh.local, "openfilm"));
  assert.equal(entry.data.file, join(fresh.local, "openfilm/library", id, "files/wipe.html"));
  assert.equal(readFileSync(entry.data.file, "utf8"), html);
  assert.match(
    readFileSync(join(fresh.local, "openfilm/library/LICENSE.md"), "utf8"),
    /Microsoft MIT/,
  );
  assert.equal(
    readFileSync(join(fresh.local, "sound/sfx/transitions/of-sfx-whoosh.wav"), "utf8"),
    "native audio bytes",
  );
  assert.equal(
    JSON.parse(readFileSync(join(fresh.local, "sound/SOURCES.json")))["of-sfx-whoosh"].category,
    "transitions",
  );
  assert.deepEqual(await restoreSound({ zip, ...fresh, log: () => {} }), { written: 0, kept: 5 });
});

test("the sound zip holds every sound of the vault at its vault path and restores onto a new machine as it was", async (t) => {
  const { packSound, restoreSound } = await import("../sound_zip.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-sound-zip-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = { local: join(root, "old/vault"), external: join(root, "old/ext") };
  const sounds = {
    "sound/sfx/comedy/mixkit-472.wav": "trombone",
    "sound/bgm/chill/bgm-limit-70.wav": "music",
    "sound/SOURCES.json": "{}",
    "sfx/mixkit/mixkit-472.wav": "trombone",
    "mc-sound/mc/mob/zombie/say1.ogg": "zombie",
  };
  for (const [rel, text] of Object.entries(sounds)) put(join(old.local, rel), text);
  // a build's cache and a download cut short are not sounds
  put(join(old.local, "sfx/mixkit/.sort-cache.json"), "{}");
  put(join(old.local, "sound/sfx/comedy/mixkit-9.wav.123.part.wav"), "half");

  const zip = join(root, "mc-films-sound.zip");
  const packed = await packSound({ ...old, out: zip, log: () => {} });
  assert.equal(packed.files, 5);
  assert.equal(existsSync(old.external), false);

  const fresh = { local: join(root, "new/vault"), external: join(root, "new/ext") };
  await restoreSound({ zip, ...fresh, log: () => {} });
  for (const [rel, text] of Object.entries(sounds))
    assert.equal(readFileSync(join(fresh.local, rel), "utf8"), text, rel);
  assert.equal(existsSync(fresh.external), false);
  assert.equal(existsSync(join(fresh.local, "sfx/mixkit/.sort-cache.json")), false);
  assert.equal(existsSync(join(fresh.local, "sound/sfx/comedy/mixkit-9.wav.123.part.wav")), false);

  // a rerun keeps what came out whole and writes again a file that changed (same size, other bytes)
  writeFileSync(join(fresh.local, "sound/sfx/comedy/mixkit-472.wav"), "tromboNE");
  assert.deepEqual(await restoreSound({ zip, ...fresh, log: () => {} }), {
    written: 1,
    kept: 4,
  });
  assert.equal(
    readFileSync(join(fresh.local, "sound/sfx/comedy/mixkit-472.wav"), "utf8"),
    "trombone",
  );
});

test("a zip that is not the vault's sounds is refused before a file is written", async (t) => {
  const { restoreSound } = await import("../sound_zip.mjs");
  const yazl = (await import("yazl")).default;
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const root = mkdtempSync(join(tmpdir(), "mc-sound-zip-foreign-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from("x"), "notes/todo.txt");
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(join(root, "other.zip")));
  await assert.rejects(
    restoreSound({
      zip: join(root, "other.zip"),
      local: join(root, "vault"),
      external: join(root, "ext"),
      log: () => {},
    }),
    /not a sound zip: notes\/todo\.txt/,
  );
  assert.equal(existsSync(join(root, "vault")), false);
});

test("a Google Drive share link is fetched as the zip itself; a link Drive will not serve says to download it by hand", async (t) => {
  const { fetchSoundZip, driveDownloadUrl } = await import("../sound_zip.mjs");
  const { createServer } = await import("node:http");
  assert.equal(
    driveDownloadUrl("https://drive.google.com/file/d/1AbC-d_9/view?usp=sharing"),
    "https://drive.usercontent.google.com/download?id=1AbC-d_9&export=download&confirm=t",
  );
  const root = mkdtempSync(join(tmpdir(), "mc-sound-zip-link-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // a private file: Drive answers with its sign-in page, not the zip
  let body = "<!DOCTYPE html><title>Google Drive - Sign in</title>";
  const server = createServer((_req, res) => res.end(body));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const link = `http://127.0.0.1:${server.address().port}/sound.zip`;
  await assert.rejects(
    fetchSoundZip(link, root),
    /download it in a browser.*bun run setup --sound-zip <the downloaded zip>/s,
  );
  assert.deepEqual(readdirSync(root), []);
  body = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(16)]);
  const zip = await fetchSoundZip(link, root);
  assert.deepEqual(readFileSync(zip), body);
});

test("a sound damaged inside the zip (a bad download) stops the restore instead of landing in the vault", async (t) => {
  const { packSound, restoreSound } = await import("../sound_zip.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-sound-zip-bad-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(join(root, "old/vault/sound/sfx/comedy/mixkit-472.wav"), "trombone");
  const zip = join(root, "sound.zip");
  await packSound({
    local: join(root, "old/vault"),
    external: join(root, "old/ext"),
    out: zip,
    log: () => {},
  });
  const bytes = readFileSync(zip);
  bytes[bytes.indexOf("trombone")] = "T".charCodeAt(0);
  writeFileSync(zip, bytes);
  await assert.rejects(
    restoreSound({
      zip,
      local: join(root, "new/vault"),
      external: join(root, "new/ext"),
      log: () => {},
    }),
    /sound\/sfx\/comedy\/mixkit-472\.wav is damaged in .*download it again/,
  );
  assert.equal(existsSync(join(root, "new/vault/sound/sfx/comedy/mixkit-472.wav")), false);
});
