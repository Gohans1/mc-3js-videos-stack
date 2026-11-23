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

test("packVault splits core and heavy pure assets, excludes tools and cache, and restores both onto a new machine", async (t) => {
  const { packVault, restoreVault } = await import("../sound_zip.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-vault-split-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldVault = join(root, "old/vault");
  const coreFiles = {
    "packs/modern-furniture.jar": "mod-jar-bytes",
    "packs_index.json": '{"modern-furniture.jar":{"slug":"modern-furniture"}}',
    "packs_check.json": '{"checked":true}',
    "favorites.json": '{"default":[]}',
    "motion/ual1/Walk_Loop.glb": "mocap-bytes",
    "mc-sound/mc/mobs/creeper.ogg": "ogg-bytes",
    "sfx/mixkit/mixkit-1.wav": "mixkit-bytes",
    "jar/client.jar": "client-jar",
    "jar/client_assets.zip": "slim-zip",
    "jar/client_assets.zip.br": "slim-br",
    "mcasset/1.21.11/minerender-data/manifest.json": "{}",
    "mcprep/player.glb": "rig-bytes",
    "voices/shared-en.json": "[]",
    "props/lamp.ts": "export const lamp = 1;",
  };
  const heavyFiles = {
    "sound/sfx/transitions/whoosh.wav": "whoosh-wav",
    "sound/SOURCES.json": '{"whoosh":{"source":"sonniss"}}',
    "sound/PEAKS.json": '{"whoosh":{"seconds":1}}',
    "openfilm/library/LICENSE.md": "CC0",
    "references/capcut/manifest.json": "{}",
  };
  for (const [rel, text] of Object.entries({ ...coreFiles, ...heavyFiles }))
    put(join(oldVault, rel), text);
  put(join(oldVault, "tools/media/venv/python.exe"), "huge-venv");
  put(join(oldVault, "tools/earshot-home-win/model.bin"), "huge-model");
  put(join(oldVault, "cache/mc-catalog.v1.json"), "{}");
  put(join(oldVault, "packs/.tmp-cache"), "dotfile");
  put(join(oldVault, "sound/sfx/x.wav.123.part"), "partial");

  const coreZip = join(root, "core.zip");
  const heavyZip = join(root, "heavy.zip");
  const coreRes = await packVault({ local: oldVault, out: coreZip, part: "core", log: () => {} });
  const heavyRes = await packVault({
    local: oldVault,
    out: heavyZip,
    part: "heavy",
    log: () => {},
  });
  assert.equal(coreRes.files, Object.keys(coreFiles).length);
  assert.equal(heavyRes.files, Object.keys(heavyFiles).length);

  const freshVault = join(root, "new/vault");
  const restoredCore = await restoreVault({ zip: coreZip, local: freshVault, log: () => {} });
  const restoredHeavy = await restoreVault({ zip: heavyZip, local: freshVault, log: () => {} });
  assert.equal(restoredCore.written, Object.keys(coreFiles).length);
  assert.equal(restoredCore.kept, 0);
  assert.equal(restoredCore.parts.includes("packs"), true);
  assert.equal(restoredCore.parts.includes("packs_index.json"), true);
  assert.equal(restoredCore.parts.includes("motion"), true);
  assert.equal(restoredHeavy.written, Object.keys(heavyFiles).length);
  assert.equal(restoredHeavy.parts.includes("sound"), true);
  assert.equal(restoredHeavy.parts.includes("openfilm"), true);

  for (const [rel, text] of Object.entries({ ...coreFiles, ...heavyFiles }))
    assert.equal(readFileSync(join(freshVault, rel), "utf8"), text, rel);
  assert.equal(existsSync(join(freshVault, "tools")), false);
  assert.equal(existsSync(join(freshVault, "cache")), false);
  assert.equal(existsSync(join(freshVault, "packs/.tmp-cache")), false);

  writeFileSync(join(freshVault, "packs/modern-furniture.jar"), "CORRUPTED----");
  const rerun = await restoreVault({ zip: coreZip, local: freshVault, log: () => {} });
  assert.equal(rerun.written, 1);
  assert.equal(rerun.kept, Object.keys(coreFiles).length - 1);
  assert.equal(
    readFileSync(join(freshVault, "packs/modern-furniture.jar"), "utf8"),
    "mod-jar-bytes",
  );
});

test("packVault part=all bundles core and heavy pure assets into one archive without tools or cache", async (t) => {
  const { packVault, restoreVault } = await import("../sound_zip.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-vault-all-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldVault = join(root, "old/vault");
  put(join(oldVault, "packs/a.jar"), "jar");
  put(join(oldVault, "packs_index.json"), "{}");
  put(join(oldVault, "sound/SOURCES.json"), "{}");
  put(join(oldVault, "tools/media/big.bin"), "skip-me");
  put(join(oldVault, "cache/mc-catalog.v1.json"), "skip-me");

  const out = join(root, "all.zip");
  const packed = await packVault({ local: oldVault, out, part: "all", log: () => {} });
  assert.equal(packed.files, 3);
  const freshVault = join(root, "new/vault");
  const res = await restoreVault({ zip: out, local: freshVault, log: () => {} });
  assert.equal(res.written, 3);
  assert.equal(existsSync(join(freshVault, "tools")), false);
  assert.equal(existsSync(join(freshVault, "cache")), false);
});

test("restoreVault refuses tools, cache, foreign roots, and traversal entries before writing anything", async (t) => {
  const { restoreVault } = await import("../sound_zip.mjs");
  const { strToU8, zipSync } = await import("fflate");
  const root = mkdtempSync(join(tmpdir(), "mc-vault-reject-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  for (const { label, entries } of [
    {
      label: "tools",
      entries: { "packs/ok.jar": strToU8("ok"), "tools/media/python.exe": strToU8("x") },
    },
    { label: "cache", entries: { "cache/mc-catalog.v1.json": strToU8("x") } },
    { label: "foreign", entries: { "notes/todo.txt": strToU8("x") } },
    { label: "root-unknown", entries: { "random.txt": strToU8("x") } },
    { label: "traversal", entries: { "packs/../../escape.txt": strToU8("x") } },
    {
      label: "nul-byte",
      entries: { "packs/ok.jar": strToU8("ok"), "packs/a\0b.jar": strToU8("x") },
    },
  ]) {
    const zpath = join(root, `${label}.zip`);
    writeFileSync(zpath, zipSync(entries, { level: 0 }));
    const dest = join(root, `vault-${label}`);
    await assert.rejects(
      restoreVault({ zip: zpath, local: dest, log: () => {} }),
      /not a vault archive|outside|invalid/i,
      label,
    );
    assert.equal(existsSync(dest), false, `${label} must not create vault`);
  }
});

test("pack_vault CLI validates flags and produces split core/heavy archives and JSON output", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const root = mkdtempSync(join(tmpdir(), "mc-pack-vault-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("../pack_vault.mjs", import.meta.url));
  const vault = join(root, "vault");
  const outDir = join(root, "out");
  put(join(vault, "packs/mod.jar"), "jar");
  put(join(vault, "motion/walk.glb"), "glb");
  put(join(vault, "sound/sfx/hit.wav"), "wav");
  put(join(vault, "tools/earshot/bin"), "ignored");

  const runCli = (args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      env: { ...process.env, MC_VAULT_ROOT: vault, MC_VAULT_EXTERNAL: outDir },
    });

  const help = runCli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /pack:vault/);
  assert.match(help.stdout, /--part/);

  const badPart = runCli(["--part", "bogus"]);
  assert.equal(badPart.status, 2);

  const badZipForSplit = runCli([join(outDir, "one.zip")]);
  assert.equal(badZipForSplit.status, 2);

  const split = runCli([outDir, "--json"]);
  assert.equal(split.status, 0, split.stderr);
  const parsed = JSON.parse(split.stdout);
  assert.equal(parsed.archives.length, 2);
  assert.deepEqual(
    parsed.archives.map((a) => a.part),
    ["core", "heavy"],
  );
  for (const a of parsed.archives) assert.equal(existsSync(a.out), true, a.out);
});

test("setup_vault CLI accepts --help and rejects unknown flags or missing --vault-zip paths before work", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const script = fileURLToPath(new URL("../setup_vault.mjs", import.meta.url));
  const runCli = (args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 15_000,
    });

  const help = runCli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--vault-zip/);

  const bad = runCli(["--not-a-flag"]);
  assert.equal(bad.status, 2);

  const missing = runCli(["--vault-zip", join(tmpdir(), "definitely-missing-vault-archive.zip")]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No vault archive/);
});

test("packVault ignores nested junctions and restoreVault refuses destination junctions, directory collisions, symlinks, and tools/ dir headers", async (t) => {
  const { packVault, restoreVault } = await import("../sound_zip.mjs");
  const { symlinkSync } = await import("node:fs");
  const { zipSync } = await import("fflate");
  const root = mkdtempSync(join(tmpdir(), "mc-vault-safety-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const outside = join(root, "outside-secret");
  put(join(outside, "leak.txt"), "top-secret");
  const oldVault = join(root, "old/vault");
  put(join(oldVault, "packs/ok.jar"), "ok");
  put(join(oldVault, "motion"), "not-a-directory");
  symlinkSync(
    outside,
    join(oldVault, "packs/sublink"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const coreZip = join(root, "core.zip");
  const packed = await packVault({ local: oldVault, out: coreZip, part: "core", log: () => {} });
  assert.equal(packed.files, 1);

  const victimVault = join(root, "victim/vault");
  const escapeTarget = join(root, "escape-target");
  mkdirSync(victimVault, { recursive: true });
  mkdirSync(escapeTarget, { recursive: true });
  symlinkSync(
    escapeTarget,
    join(victimVault, "packs"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    restoreVault({ zip: coreZip, local: victimVault, log: () => {} }),
    /symlink|junction|real directory/i,
  );
  assert.equal(existsSync(join(escapeTarget, "ok.jar")), false);

  const emptyEntryZip = join(root, "empty-file.zip");
  writeFileSync(emptyEntryZip, zipSync({ "packs/collide.jar": new Uint8Array(0) }, { level: 0 }));
  const dirCollisionVault = join(root, "dir-collision/vault");
  mkdirSync(join(dirCollisionVault, "packs/collide.jar"), { recursive: true });
  await assert.rejects(
    restoreVault({ zip: emptyEntryZip, local: dirCollisionVault, log: () => {} }),
    /directory|refus/i,
  );

  const toolsDirZip = join(root, "tools-dir.zip");
  writeFileSync(toolsDirZip, zipSync({ "tools/": new Uint8Array(0) }, { level: 0 }));
  const toolsDest = join(root, "tools-dir/vault");
  await assert.rejects(
    restoreVault({ zip: toolsDirZip, local: toolsDest, log: () => {} }),
    /not a vault archive/i,
  );
  assert.equal(existsSync(toolsDest), false);
});

test("packVault extracts jar/client.jar before jar/client_assets.zip and .br so slimJar stays fresh", async (t) => {
  const { packVault } = await import("../sound_zip.mjs");
  const yauzl = (await import("yauzl")).default;
  const { promisify } = await import("node:util");
  const root = mkdtempSync(join(tmpdir(), "mc-vault-order-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = join(root, "vault");
  put(join(vault, "jar/client.jar"), "jar");
  put(join(vault, "jar/client_assets.zip"), "zip");
  put(join(vault, "jar/client_assets.zip.br"), "br");
  const out = join(root, "core.zip");
  await packVault({ local: vault, out, part: "core", log: () => {} });

  const order = [];
  const zf = await promisify(yauzl.open)(out, { lazyEntries: true });
  await new Promise((done, fail) => {
    zf.on("error", fail);
    zf.on("end", done);
    zf.on("entry", (e) => {
      order.push(e.fileName);
      zf.readEntry();
    });
    zf.readEntry();
  });
  assert.deepEqual(order, ["jar/client.jar", "jar/client_assets.zip", "jar/client_assets.zip.br"]);
});

test("pack_vault CLI handles non-existent directories, single-part zips, duplicate --part, empty halves, and clean next paths", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const root = mkdtempSync(join(tmpdir(), "mc-pack-vault-modes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("../pack_vault.mjs", import.meta.url));
  const vault = join(root, "vault");
  put(join(vault, "packs/mod.jar"), "jar");
  put(join(vault, "sound/sfx/hit.wav"), "wav");

  const runCli = (args, vaultDir = vault) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      env: { ...process.env, MC_VAULT_ROOT: vaultDir, MC_VAULT_EXTERNAL: join(root, "ext") },
    });

  assert.equal(runCli(["--part", "core", "--part", "bogus"]).status, 2);
  assert.equal(runCli(["--part", "core", "--part", "heavy"]).status, 2);

  const existingFile = join(root, "existing.txt");
  put(existingFile, "keep");
  assert.equal(runCli([existingFile]).status, 2);
  assert.equal(runCli(["--part", "core", existingFile]).status, 2);
  assert.equal(readFileSync(existingFile, "utf8"), "keep");

  const freshDir = join(root, "new-backup-dir");
  const coreRun = runCli(["--part", "core", `${freshDir}/`, "--json"]);
  assert.equal(coreRun.status, 0, coreRun.stderr);
  const coreJson = JSON.parse(coreRun.stdout);
  assert.match(
    coreJson.archives[0].out,
    /new-backup-dir[\\/]mc-films-vault-core-\d{4}-\d{2}-\d{2}\.zip$/,
  );
  assert.equal(coreJson.archives[0].files, 1);
  assert.equal(coreJson.next.includes("\\\\"), false);

  const heavyRun = runCli(["--part", "heavy", freshDir, "--json"]);
  assert.equal(heavyRun.status, 0, heavyRun.stderr);
  const heavyJson = JSON.parse(heavyRun.stdout);
  assert.equal(existsSync(coreJson.archives[0].out), true);
  assert.equal(existsSync(heavyJson.archives[0].out), true);

  const exactZip = join(root, "custom-all.zip");
  const allRun = runCli(["--part", "all", exactZip, "--json"]);
  assert.equal(allRun.status, 0, allRun.stderr);
  assert.equal(JSON.parse(allRun.stdout).archives[0].files, 2);
  assert.equal(existsSync(exactZip), true);

  const coreOnlyVault = join(root, "core-only-vault");
  put(join(coreOnlyVault, "packs/only.jar"), "jar");
  const halfRun = runCli([join(root, "half-out"), "--json"], coreOnlyVault);
  assert.equal(halfRun.status, 0, halfRun.stderr);
  assert.deepEqual(
    JSON.parse(halfRun.stdout).archives.map((a) => a.part),
    ["core"],
  );
  const emptyVault = join(root, "empty-vault");
  mkdirSync(emptyVault, { recursive: true });
  assert.equal(runCli([join(root, "empty-out")], emptyVault).status, 1);
});

test("setupVault restores repeatable archives, enforces --sound-zip scope, skips completed builds, and warns on missing externalRoot", async (t) => {
  const { packVault } = await import("../sound_zip.mjs");
  const { setupVault } = await import("../setup_vault.mjs");
  const root = mkdtempSync(join(tmpdir(), "mc-setup-vault-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const srcVault = join(root, "src/vault");
  put(join(srcVault, "packs/mod.jar"), "jar");
  put(join(srcVault, "packs_index.json"), "{}");
  put(join(srcVault, "motion/walk.glb"), "glb");
  put(join(srcVault, "mc-sound/SOURCES.json"), "{}");
  put(join(srcVault, "mc-sound/mc/mobs/hit.ogg"), "ogg");
  put(join(srcVault, "sound/SOURCES.json"), "{}");
  put(join(srcVault, "sound/PEAKS.json"), "{}");
  put(join(srcVault, "sound/sfx/a.wav"), "wav");
  put(join(srcVault, "openfilm/library/LICENSE.md"), "CC0");

  const coreZip = join(root, "core.zip");
  const heavyZip = join(root, "heavy.zip");
  await packVault({ local: srcVault, out: coreZip, part: "core", log: () => {} });
  await packVault({ local: srcVault, out: heavyZip, part: "heavy", log: () => {} });

  const partialSoundVault = join(root, "partial-sound/vault");
  put(join(partialSoundVault, "sound/SOURCES.json"), "{}");
  put(join(partialSoundVault, "sound/sfx/a.wav"), "wav");
  const partialSoundZip = join(root, "partial-sound.zip");
  await packVault({ local: partialSoundVault, out: partialSoundZip, part: "heavy", log: () => {} });

  const makeDeps = (local, external) => {
    const calls = [];
    const logs = [];
    return {
      calls,
      logs,
      opts: {
        local,
        external,
        toolsCheck: () => ({ stop: [], later: [] }),
        prepareBase: async () => calls.push("base"),
        runScript: (name) => calls.push(name),
        runFetchSoundRaw: async () => {
          calls.push("fetchSoundRaw");
          return { failed: [], waiting: [] };
        },
        log: (msg) => logs.push(msg),
      },
    };
  };

  {
    const local = join(root, "case1/vault");
    const { calls, opts } = makeDeps(local, join(root, "nonexistent-ext"));
    await setupVault({
      argv: ["--vault-zip", coreZip, "--vault-zip", heavyZip],
      ...opts,
    });
    assert.equal(existsSync(join(local, "packs/mod.jar")), true);
    assert.equal(existsSync(join(local, "sound/PEAKS.json")), true);
    assert.equal(calls.includes("fetchSoundRaw"), false);
    assert.equal(calls.includes("build_sound_vault.mjs"), false);
    assert.equal(calls.includes("build_mc_sound_vault.mjs"), false);
  }

  {
    const local = join(root, "case2/vault");
    const { calls, opts } = makeDeps(local, join(root, "nonexistent-ext"));
    await setupVault({ argv: ["--vault-zip", partialSoundZip], ...opts });
    assert.equal(calls.includes("fetchSoundRaw"), false);
    assert.equal(calls.includes("build_sound_vault.mjs"), true);
    assert.equal(calls.includes("build_mc_sound_vault.mjs"), true);
  }

  {
    const local = join(root, "case3a/vault");
    const { opts } = makeDeps(local, join(root, "nonexistent-ext"));
    await assert.rejects(
      setupVault({ argv: ["--sound-zip", coreZip], ...opts }),
      /not a sound zip/i,
    );
    const localB = join(root, "case3b/vault");
    const depB = makeDeps(localB, join(root, "nonexistent-ext"));
    await setupVault({ argv: ["--sound-zip", partialSoundZip], ...depB.opts });
    assert.equal(depB.calls.includes("build_mc_sound_vault.mjs"), true);
  }

  {
    const local = join(root, "case4/vault");
    const { calls, opts } = makeDeps(local, join(root, "nonexistent-ext"));
    await assert.rejects(
      setupVault({ argv: ["--vault-zip", root], ...opts }),
      /not a file|No vault archive/i,
    );
    assert.deepEqual(calls, []);
  }

  {
    const local = join(root, "case5/vault");
    const { calls, logs, opts } = makeDeps(local, join(root, "does-not-exist-ext"));
    await setupVault({ argv: [], ...opts });
    assert.equal(calls.includes("fetchSoundRaw"), false);
    assert.equal(calls.includes("build_sound_vault.mjs"), true);
    assert.equal(
      logs.some((l) => /Waiting for you:.*raw sound packs.*MC_VAULT_EXTERNAL/i.test(l)),
      true,
    );
  }

  {
    const local = join(root, "case6/vault");
    const runFetch = async (urls, zipSource = [coreZip, heavyZip]) => {
      const names = [];
      const temps = [];
      const { opts } = makeDeps(local, join(root, "nonexistent-ext"));
      await setupVault({
        argv: urls.flatMap((u) => ["--vault-zip", u]),
        ...opts,
        fetchZip: async (_link, _dir, { name }) => {
          const i = names.length;
          names.push(name);
          const copy = join(root, `tmp-${Date.now()}-${i}-${name}`);
          writeFileSync(copy, readFileSync(zipSource[i]));
          temps.push(copy);
          return copy;
        },
      });
      for (const f of temps) assert.equal(existsSync(f), false, `temp zip ${f} must be cleaned up`);
      return names;
    };
    const first = await runFetch([
      "https://drive.google.com/file/d/AbCdEf123/view",
      "https://example.com/other.zip",
    ]);
    const reversed = await runFetch(
      ["https://example.com/other.zip", "https://drive.google.com/uc?id=AbCdEf123"],
      [heavyZip, coreZip],
    );
    assert.equal(first[0], reversed[1], "equivalent Drive links must share the same hash filename");
    assert.equal(first[1], reversed[0], "reversed order must preserve each URL's hash filename");

    let orphan = "";
    const badOpts = makeDeps(join(root, "case6-bad/vault"), join(root, "nonexistent-ext")).opts;
    await assert.rejects(
      setupVault({
        argv: ["--sound-zip", "https://example.com/not-sound.zip"],
        ...badOpts,
        fetchZip: async (_link, _dir, { name }) => {
          orphan = join(root, `orphan-${name}`);
          writeFileSync(orphan, readFileSync(coreZip));
          return orphan;
        },
      }),
      /not a sound zip/i,
    );
    assert.equal(existsSync(orphan), false, "failed remote restore must not orphan temp zip");
  }
});
