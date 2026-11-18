import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { originOf } from "../../packages/live-studio/app/sound/groups.ts";
import {
  filterAndSortLibrary,
  originOptions,
  soundCardDetail,
} from "../../packages/live-studio/app/sound/library-view.ts";
import { openSound, wavInfo } from "../../packages/live-studio/src/sound.mjs";
import { buildAudio } from "../openfilm/audio.mjs";
import {
  assetEntries,
  audioEntry,
  readAssetCatalog,
  readCatalog,
  safePath,
  writeAssetCatalog,
} from "../openfilm/catalog.mjs";
import { fetchFiles } from "../openfilm/fetch.mjs";

const sound = {
  id: "audio/sfx/clean-whoosh-123abc.mp3",
  cat: "sound",
  group: "transition",
  kind: "sound",
  name: { en: "Clean whoosh" },
  tags: ["airy", "camera"],
  durationMs: 700,
};

test("imported audio keeps its source identity and tags in the native category without claiming recorded origin", () => {
  const entry = audioEntry(sound);
  assert.equal(entry.name, "of-sfx-clean-whoosh-123abc");
  assert.equal(entry.category, "transitions");
  assert.equal(entry.kind, "sfx");
  assert.equal(entry.source, "openfilm");
  assert.equal(entry.origin, "unknown");
  assert.equal(entry.license, "CC0 1.0");
  assert.match(entry.for, /airy.*camera/);
  assert.equal(audioEntry({ ...sound, id: "sounds/whoosh.m4a" }).origin, "synth");
});

test("music is kept as music, and unfamiliar upstream categories are reported instead of dropped", () => {
  assert.equal(
    audioEntry({ ...sound, id: "audio/music/track.mp3", cat: "music", group: "calm" }).category,
    "chill",
  );
  assert.throws(() => audioEntry({ ...sound, group: "new-upstream-group" }), /category/);
});

test("editable visual assets keep their format and are never advertised as native shot shaders", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfilm-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const items = [
    {
      id: "transitions/page-turn",
      cat: "transition",
      group: "film",
      kind: "page",
      src: "page-turn.html",
      name: { en: "Page turn" },
      about: "A curled page",
    },
  ];
  const entries = assetEntries(items, root);
  assert.equal(entries[0].kind, "asset");
  assert.equal(entries[0].cat, "transition");
  assert.equal(entries[0].src, "openfilm");
  assert.equal(entries[0].data.format, "openfilm-page");
  assert.equal(entries[0].secs, undefined);
  assert.match(entries[0].data.file, /page-turn.*files.*page-turn\.html$/);
});

test("catalog discovery includes every catalog and emoji, while duplicate IDs stop an ambiguous import", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfilm-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "catalogs"));
  const save = (file, items) => writeFileSync(join(root, file), JSON.stringify({ items }));
  save("index.json", [sound]);
  save("stickers.json", [{ id: "stickers/emoji/alien" }]);
  save("catalogs/extra.json", [{ id: "effects/snow" }]);
  assert.equal(readCatalog(root).length, 3);
  save("catalogs/extra.json", [sound]);
  assert.throws(() => readCatalog(root), /duplicate/i);
});

test("download destinations reject archive and bundle paths that could overwrite files outside the library", () => {
  for (const path of [
    "../outside",
    "a/../../outside",
    "C:/outside",
    "a\\outside",
    "/outside",
    "a//b",
  ])
    assert.throws(() => safePath("C:/library", path), /path/i, path);
  assert.match(safePath("C:/library", "audio/sfx/click.mp3"), /audio.*sfx.*click\.mp3$/);
});

test("a stopped import resumes completed downloads, and a damaged cached file is fetched again", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfilm-resume-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.end("original asset");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const host = `http://127.0.0.1:${server.address().port}`;
  const checkpoint = join(root, "fetch.jsonl"),
    log = () => {};
  const run = (paths) => fetchFiles({ root: join(root, "library"), paths, host, checkpoint, log });
  await run(["audio/first.txt"]);
  assert.equal(requests, 1);
  appendFileSync(checkpoint, '{"interrupted":');
  await run(["audio/first.txt", "audio/second.txt"]);
  assert.equal(requests, 2);
  writeFileSync(join(root, "library/audio/first.txt"), "damaged");
  await run(["audio/first.txt", "audio/second.txt"]);
  assert.equal(requests, 3);
  assert.equal(readFileSync(join(root, "library/audio/first.txt"), "utf8"), "original asset");
});

test("native import creates playable PCM audio, preserves other sources and resumes without rewriting completed WAVs", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfilm-audio-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const library = join(root, "library"),
    vaultSound = join(root, "sound");
  mkdirSync(join(library, "audio/sfx"), { recursive: true });
  mkdirSync(vaultSound);
  const input = join(library, sound.id);
  const fixture = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=sgn(sin(2*PI*1234*t)):s=22050:d=0.15",
      "-y",
      input,
    ],
    { timeout: 30000 },
  );
  assert.equal(fixture.status, 0, fixture.stderr?.toString());
  writeFileSync(
    join(vaultSound, "SOURCES.json"),
    JSON.stringify({ existing: { title: "Keep me" } }),
  );
  const opts = { library, vaultSound, items: [sound], log: () => {} };
  const first = await buildAudio(opts);
  assert.equal(first.converted, 1);
  const file = join(vaultSound, "sfx/transitions/of-sfx-clean-whoosh-123abc.wav");
  const info = wavInfo(file);
  assert.equal(info.tag, 1);
  assert.equal(info.bits, 16);
  assert.equal(info.rate, 48000);
  assert.ok(info.seconds > 0.1);
  const sources = JSON.parse(readFileSync(join(vaultSound, "SOURCES.json")));
  assert.equal(sources.existing.title, "Keep me");
  assert.equal(sources["of-sfx-clean-whoosh-123abc"].source, "openfilm");
  copyFileSync(file, `${file}.4321.part.wav`);
  const studio = openSound(root, {
    soundTimeline: "audio.json",
    soundVault: "sound",
    sfx: "film-sfx",
  });
  assert.equal(
    studio.library().find((x) => x.name === "of-sfx-clean-whoosh-123abc").origin,
    "unknown",
  );
  assert.ok(
    studio.library().every((x) => !x.name.includes(".part")),
    "An in-progress conversion must never appear as a playable library sound",
  );
  const peaks = JSON.parse(readFileSync(join(vaultSound, "PEAKS.json")));
  assert.ok(peaks["of-sfx-clean-whoosh-123abc"].peaks.length > 0);
  assert.ok(
    Math.max(...peaks["of-sfx-clean-whoosh-123abc"].peaks) <= 0.893,
    "Peak must stay at -1 dBFS after resampling",
  );
  assert.equal((await buildAudio(opts)).converted, 0);
  const hot = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      input,
      "-af",
      "volume=30dB",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      file,
    ],
    { timeout: 30000 },
  );
  assert.equal(hot.status, 0, hot.stderr?.toString());
  await buildAudio(opts);
  const repaired = JSON.parse(readFileSync(join(vaultSound, "PEAKS.json")));
  assert.ok(
    repaired["of-sfx-clean-whoosh-123abc"].peaks.every((x) => x <= 0.893),
    "Resume must repair an over-level WAV in the target sample rate",
  );
});

test("unverified audio provenance has its own filter and never appears as a studio recording", () => {
  const item = {
    name: "of-sfx-test",
    source: "openfilm",
    origin: "unknown",
    kind: "sfx",
    seconds: 1,
    category: "transitions",
  };
  assert.equal(originOf(item), "unknown");
  assert.match(soundCardDetail(item), /Unverified origin/);
  assert.equal(originOptions([item]).find((x) => x.id === "unknown").count, 1);
  const view = (origin) =>
    filterAndSortLibrary({
      items: [item],
      favs: [],
      nav: { group: "sfx", leaf: "all" },
      origin,
      source: "all",
      query: "",
      kindOf: (x) => x.kind,
    });
  assert.equal(view("real").shown.length, 0);
  assert.equal(view("unknown").shown.length, 1);
});

test("JSON-only visual presets have an existing editable definition and a source catalog", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfilm-definitions-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const item = {
    id: "motions/in-fade",
    cat: "effect",
    kind: "motion",
    group: "clip-in",
    name: { en: "Fade in" },
    motion: { in: { body: "from { opacity: 0 }" } },
  };
  const library = join(root, "library");
  mkdirSync(library);
  const entries = writeAssetCatalog([item], library);
  assert.ok(existsSync(entries[0].data.file));
  assert.deepEqual(JSON.parse(readFileSync(entries[0].data.file)), item);
  const stored = JSON.parse(readFileSync(join(root, "assets.json")))[0];
  assert.equal(stored.id, entries[0].id);
  assert.equal(stored.data.file, "library/_definitions/motions/in-fade.json");
  assert.equal(readAssetCatalog(root)[0].data.file, entries[0].data.file);
  writeFileSync(entries[0].data.file, JSON.stringify({ ...item, custom: true }));
  assert.throws(() => writeAssetCatalog([item], library), /changed|modified/i);
  assert.equal(JSON.parse(readFileSync(entries[0].data.file)).custom, true);
});

test("find discovery reflects edited preset names and groups without rebuilding the imported catalog", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openfilm-edited-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const item = {
    id: "motions/in-fade",
    cat: "effect",
    kind: "motion",
    group: "clip-in",
    name: { en: "Fade in" },
  };
  const library = join(root, "library");
  mkdirSync(library);
  const [entry] = writeAssetCatalog([item], library);
  writeFileSync(
    entry.data.file,
    JSON.stringify({ ...item, group: "custom", name: { en: "Soft entrance" }, tags: ["gentle"] }),
  );
  const [current] = readAssetCatalog(root);
  assert.equal(current.id, entry.id);
  assert.equal(current.title, "Soft entrance");
  assert.equal(current.data.group, "custom");
  assert.match(current.about, /gentle/);
});
