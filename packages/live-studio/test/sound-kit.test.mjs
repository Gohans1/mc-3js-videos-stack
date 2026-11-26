import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { createApi } from "../src/api.mjs";
import { openFavorites } from "../src/favorites.mjs";
import {
  classifyPopularSound,
  findSimilarSounds,
  recommendCoreSounds,
} from "../src/sound-kit-similar.mjs";
import {
  KIT_CATEGORIES,
  KIT_STATUSES,
  openSoundKit,
  summarizeSoundKit,
} from "../src/sound-kit.mjs";

const withTempKit = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-"));
  const file = join(dir, "kit", "core.json");
  const kit = openSoundKit(file);
  try {
    await fn({ dir, file, kit });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const encodeVec = (values) => {
  const len = Math.hypot(...values) || 1;
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((v, i) => view.setFloat32(i * 4, v / len, true));
  return bytes;
};

const makeSemanticDb = (dir, entries, { wal = false, errors = [] } = {}) => {
  const dbPath = join(dir, "asset-search.sqlite");
  const db = new Database(dbPath, { create: true });
  if (wal) db.run("PRAGMA journal_mode=WAL;");
  db.run(
    "CREATE TABLE meta(space TEXT NOT NULL); CREATE TABLE assets(key TEXT PRIMARY KEY, inputHash TEXT NOT NULL, definition TEXT NOT NULL); CREATE TABLE jobs(asset TEXT, part INTEGER, fingerprint TEXT NOT NULL, spec TEXT NOT NULL, state TEXT NOT NULL, error TEXT, PRIMARY KEY(asset,part)); CREATE TABLE cache(key TEXT, fingerprint TEXT, vector BLOB NOT NULL, usage TEXT NOT NULL, PRIMARY KEY(key,fingerprint)); CREATE TABLE asset_errors(key TEXT PRIMARY KEY, error TEXT NOT NULL);",
  );
  for (const { key, vector } of entries) {
    db.query("INSERT INTO assets VALUES (?,?,?)").run(key, "h1", JSON.stringify({ key }));
    db.query("INSERT INTO jobs VALUES (?,0,'fp1','{}','done',NULL)").run(key);
    db.query("INSERT INTO cache VALUES (?,'fp1',?,'{}')").run(key, encodeVec(vector));
  }
  for (const key of errors) {
    db.query("INSERT INTO asset_errors VALUES (?,?)").run(key, "broken");
  }
  db.close();
  return dbPath;
};

const SAMPLE_LIBRARY = [
  {
    name: "bgm-tense-pulse",
    kind: "bgm",
    category: "tense",
    title: "Tense Synth Pulse",
    seconds: 90,
    source: "openfilm",
  },
  {
    name: "bgm-playful-pluck",
    kind: "bgm",
    category: "playful",
    title: "Playful Pluck",
    seconds: 75,
    source: "openfilm",
  },
  {
    name: "whoosh-fast-air",
    kind: "sfx",
    category: "transitions",
    title: "Fast Air Whoosh",
    seconds: 0.45,
    source: "mixkit",
    family: "whoosh-air",
  },
  {
    name: "whoosh-fast-air-2",
    kind: "sfx",
    category: "transitions",
    title: "Fast Air Whoosh 2",
    seconds: 0.48,
    source: "mixkit",
    family: "whoosh-air",
  },
  {
    name: "whoosh-soft-air",
    kind: "sfx",
    category: "transitions",
    title: "Soft Air Whoosh",
    seconds: 0.5,
    source: "mixkit",
    family: "whoosh-soft",
  },
  {
    name: "whoosh-soft-air-2",
    kind: "sfx",
    category: "transitions",
    title: "Soft Air Whoosh 2",
    seconds: 0.52,
    source: "mixkit",
    family: "whoosh-soft",
  },
  {
    name: "whoosh-heavy-spin",
    kind: "sfx",
    category: "transitions",
    title: "Heavy Spin Whoosh",
    seconds: 1.1,
    source: "sonniss",
    family: "whoosh-spin",
  },
  {
    name: "pop-crisp-ui",
    kind: "sfx",
    category: "clicks",
    title: "Crisp Bubble Pop",
    seconds: 0.18,
    source: "mixkit",
  },
  {
    name: "chime-sparkle-bell",
    kind: "sfx",
    category: "musical",
    title: "Magic Bell Sparkle",
    seconds: 0.9,
    source: "mixkit",
  },
  {
    name: "impact-sub-thud",
    kind: "sfx",
    category: "impacts",
    title: "Deep Sub Bass Thud",
    seconds: 0.8,
    source: "openfilm",
  },
  {
    name: "riser-reverse-swell",
    kind: "sfx",
    category: "transitions",
    title: "Reverse Tension Riser Swell",
    seconds: 2.4,
    source: "mixkit",
  },
  {
    name: "amb-soft-rain-bed",
    kind: "sfx",
    category: "ambience",
    title: "Soft Rain Room Ambience",
    seconds: 18,
    source: "openfilm",
  },
  {
    name: "foley-footstep-wood",
    kind: "sfx",
    category: "foley",
    title: "Wood Footstep Walk",
    seconds: 0.35,
    source: "sonniss",
  },
  {
    name: "foley-crunch-bite",
    kind: "sfx",
    category: "foley",
    title: "Crispy Cookie Bite Crunch",
    seconds: 0.4,
    source: "mixkit",
  },
  {
    name: "comedy-boing-spring",
    kind: "sfx",
    category: "comedy",
    title: "Cartoon Spring Boing",
    seconds: 0.55,
    source: "mixkit",
  },
  {
    name: "glitch-digital-zap",
    kind: "sfx",
    category: "sci-fi",
    title: "Digital Glitch Electric Zap",
    seconds: 0.4,
    source: "openfilm",
  },
  {
    name: "scifi-alien-laser",
    kind: "sfx",
    category: "sci-fi",
    title: "Alien Plasma Laser Beam",
    seconds: 1.3,
    source: "kenney",
  },
];

test("missing sound-kit file reads cleanly as empty schema with 8 popular categories", async () => {
  await withTempKit(({ kit }) => {
    assert.deepEqual(
      KIT_CATEGORIES.map((c) => c.id),
      ["bgm", "whoosh", "pop-ui", "impact", "riser", "ambience", "foley-core", "comedy-glitch"],
    );
    assert.deepEqual(KIT_STATUSES, ["inbox", "core", "pass", "ban"]);
    const state = kit.read();
    assert.equal(state.version, 1);
    assert.deepEqual(state.items, {});
    assert.deepEqual(state.abSlots, []);
    assert.deepEqual(state.decisions, []);
  });
});

test("setItem rejects prototype keys, handles Object.prototype names safely, and strips BOM", async () => {
  await withTempKit(({ file, kit }) => {
    for (const badId of ["__proto__", "constructor", "prototype", ".", "..", "-leading-dash"]) {
      assert.throws(() => kit.setItem({ id: badId, category: "whoosh", status: "core" }));
    }
    const res = kit.batchSet(
      [{ id: "toString", category: "whoosh", status: "inbox", addedBy: "ai" }],
      { skipExisting: true },
    );
    assert.equal(res.added, 1);
    assert.equal(res.skipped, 0);
    assert.equal(Object.hasOwn(res.state.items, "toString"), true);

    const raw = readFileSync(file, "utf8");
    writeFileSync(file, `\uFEFF${raw}`, "utf8");
    assert.equal(kit.read().items.toString.status, "inbox");
  });
});

test("setItem and batchSet preserve existing core/ban status when status is omitted", async () => {
  await withTempKit(({ kit }) => {
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core", note: "v1" });
    kit.setItem({ id: "whoosh-heavy-spin", category: "whoosh", status: "ban" });

    const afterSingle = kit.setItem({
      id: "whoosh-fast-air",
      category: "whoosh",
      note: "v2",
      tier: 1,
    });
    assert.equal(afterSingle.items["whoosh-fast-air"].status, "core");
    assert.equal(afterSingle.items["whoosh-fast-air"].note, "v2");
    assert.equal(afterSingle.items["whoosh-fast-air"].tier, 1);

    const afterBatch = kit.batchSet([
      { id: "whoosh-heavy-spin", category: "whoosh", note: "too noisy" },
      { id: "whoosh-soft-air", category: "whoosh" },
    ]);
    assert.equal(afterBatch.state.items["whoosh-heavy-spin"].status, "ban");
    assert.equal(afterBatch.state.items["whoosh-soft-air"].status, "inbox");
  });
});

test("recordUse is a pure no-op on disk when sound is untracked and no category is supplied", async () => {
  await withTempKit(({ file, kit }) => {
    const empty = kit.recordUse({ id: "untracked-sound" });
    assert.deepEqual(empty.items, {});
    assert.equal(existsSync(file), false);

    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core" });
    const before = readFileSync(file, "utf8");
    const next = kit.recordUse({ id: "untracked-sound" });
    assert.equal(Object.hasOwn(next.items, "untracked-sound"), false);
    assert.equal(readFileSync(file, "utf8"), before);
  });
});

test("multi-process concurrent writes preserve every update under 6x15 Windows lock contention", async () => {
  await withTempKit(async ({ dir, file, kit }) => {
    const modUrl = pathToFileURL(resolve(import.meta.dir, "../src/sound-kit.mjs")).href;
    const workerPath = join(dir, "worker.mjs");
    writeFileSync(
      workerPath,
      `import { openSoundKit } from ${JSON.stringify(modUrl)};\nconst [file, prefix] = process.argv.slice(2);\nconst kit = openSoundKit(file);\nfor (let i = 0; i < 15; i++) { kit.setItem({ id: prefix + "_" + i, category: "whoosh", status: "inbox", addedBy: "ai" }); }\n`,
    );
    const procs = [1, 2, 3, 4, 5, 6].map((n) =>
      Bun.spawn([process.execPath, workerPath, file, `w${n}`], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const results = await Promise.all(
      procs.map(async (p) => ({ code: await p.exited, err: await new Response(p.stderr).text() })),
    );
    for (const r of results) assert.equal(r.code, 0, r.err);
    const items = kit.read().items;
    assert.equal(Object.keys(items).length, 90);
  });
});

test("batchSet with skipExisting never overwrites human core or ban decisions", async () => {
  await withTempKit(({ kit }) => {
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core", addedBy: "human" });
    kit.setItem({ id: "whoosh-heavy-spin", category: "whoosh", status: "ban", addedBy: "human" });
    const res = kit.batchSet(
      [
        { id: "whoosh-fast-air", category: "whoosh", status: "inbox", addedBy: "ai" },
        { id: "whoosh-heavy-spin", category: "whoosh", status: "inbox", addedBy: "ai" },
        { id: "whoosh-soft-air", category: "whoosh", status: "inbox", addedBy: "ai" },
      ],
      { skipExisting: true },
    );
    assert.equal(res.state.items["whoosh-fast-air"].status, "core");
    assert.equal(res.state.items["whoosh-heavy-spin"].status, "ban");
    assert.equal(res.state.items["whoosh-soft-air"].status, "inbox");
    assert.equal(res.added, 1);
    assert.equal(res.skipped, 2);
  });
});

test("A/B resolve updates Bradley-Terry Elo, wins/losses, taste decisions, and recordUse increments picks", async () => {
  await withTempKit(({ kit }) => {
    kit.setAb([
      "whoosh-fast-air",
      "whoosh-soft-air",
      "whoosh-fast-air",
      "whoosh-heavy-spin",
      "pop-crisp-ui",
      "impact-sub-thud",
    ]);
    assert.equal(kit.read().abSlots.length, 4);

    const afterAb = kit.resolveAb({
      winner: "whoosh-fast-air",
      rejected: ["whoosh-soft-air", "whoosh-heavy-spin"],
      category: "whoosh",
      reason: "tighter tail, less harsh",
      banRejected: true,
    });
    assert.equal(afterAb.items["whoosh-fast-air"].status, "core");
    assert.ok(afterAb.items["whoosh-fast-air"].elo > 1500);
    assert.equal(afterAb.items["whoosh-fast-air"].wins, 1);
    assert.equal(afterAb.items["whoosh-soft-air"].status, "ban");
    assert.ok(afterAb.items["whoosh-soft-air"].elo < 1500);
    assert.equal(afterAb.items["whoosh-soft-air"].losses, 1);
    assert.equal(afterAb.decisions.length, 1);

    const afterUse = kit.recordUse({
      id: "whoosh-fast-air",
      category: "whoosh",
      rejected: ["whoosh-soft-air"],
      context: "scene 2 whip",
    });
    assert.equal(afterUse.items["whoosh-fast-air"].picks, 1);
    assert.ok(afterUse.items["whoosh-fast-air"].lastUsedAt);
    assert.equal(afterUse.decisions.length, 2);
  });
});

test("corrupt sound-kit file degrades safely on shownWithWarning() and refuses overwrite", async () => {
  await withTempKit(({ file, kit }) => {
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core" });
    writeFileSync(file, "{ broken json");
    const { state, warning } = kit.shownWithWarning();
    assert.deepEqual(state.items, {});
    assert.ok(warning && warning.includes("doesn't parse"));
    assert.throws(() => kit.setItem({ id: "pop-crisp-ui", category: "pop-ui", status: "core" }));
    assert.equal(readFileSync(file, "utf8"), "{ broken json");
  });
});

test("watch() fires on external changes and stays silent on own writes without eagerly creating dir", async () => {
  await withTempKit(async ({ file, kit }) => {
    let externalEvents = 0;
    const stop = kit.watch(() => {
      externalEvents += 1;
    });
    try {
      kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core" });
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(externalEvents, 0);

      const other = openSoundKit(file);
      other.setItem({ id: "whoosh-soft-air", category: "whoosh", status: "inbox" });
      const waitEnd = Date.now() + 1_500;
      while (externalEvents === 0 && Date.now() < waitEnd) {
        await new Promise((r) => setTimeout(r, 30));
      }
      assert.ok(externalEvents >= 1);
    } finally {
      stop();
    }
  });
});

test("classifyPopularSound maps all 8 popular categories including underscore IDs and excludes niche sounds", () => {
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[0]), "bgm");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[2]), "whoosh");
  assert.equal(classifyPopularSound({ name: "sfx_whoosh_fast", kind: "sfx" }), "whoosh");
  assert.equal(classifyPopularSound({ name: "ui_pop_01", kind: "sfx" }), "pop-ui");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[7]), "pop-ui");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[8]), "pop-ui");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[9]), "impact");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[10]), "riser");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[11]), "ambience");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[12]), "foley-core");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[13]), "foley-core");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[14]), "comedy-glitch");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[15]), "comedy-glitch");
  assert.equal(classifyPopularSound(SAMPLE_LIBRARY[16]), null);
  assert.equal(
    classifyPopularSound({
      name: "amb-dark-drone-bed",
      kind: "sfx",
      category: "ambience",
      title: "Dark Suspense Drone Room Tone",
      seconds: 24,
    }),
    "ambience",
  );
});

test("findSimilarSounds refreshes on WAL updates, excludes asset_errors & duplicate families, and guards NaN limit", async () => {
  await withTempKit(({ dir }) => {
    const dbPath = makeSemanticDb(
      dir,
      [
        { key: JSON.stringify(["sfx", "mixkit", "whoosh-fast-air"]), vector: [1, 0, 0, 0] },
        { key: JSON.stringify(["sfx", "mixkit", "whoosh-soft-air"]), vector: [0.95, 0.3, 0, 0] },
        { key: JSON.stringify(["sfx", "mixkit", "whoosh-soft-air-2"]), vector: [0.96, 0.28, 0, 0] },
        { key: JSON.stringify(["sfx", "sonniss", "whoosh-heavy-spin"]), vector: [0.9, 0.4, 0, 0] },
      ],
      { wal: true, errors: [JSON.stringify(["sfx", "sonniss", "whoosh-heavy-spin"])] },
    );

    const first = findSimilarSounds("whoosh-fast-air", SAMPLE_LIBRARY, {
      semanticDb: dbPath,
      limit: Number("abc"),
    });
    assert.equal(first.mode, "vector");
    assert.equal(first.hits.length, 1);
    assert.ok(!first.hits.some((h) => h.name === "whoosh-heavy-spin"));
    assert.ok(!first.hits.some((h) => h.name === "whoosh-fast-air-2"));

    const db = new Database(dbPath);
    const keyPop = JSON.stringify(["sfx", "mixkit", "pop-crisp-ui"]);
    db.query("INSERT INTO assets VALUES (?,?,?)").run(
      keyPop,
      "h1",
      JSON.stringify({ key: keyPop }),
    );
    db.query("INSERT INTO jobs VALUES (?,0,'fp1','{}','done',NULL)").run(keyPop);
    db.query("INSERT INTO cache VALUES (?,'fp1',?,'{}')").run(keyPop, encodeVec([0.7, 0.7, 0, 0]));
    db.close();

    const afterWal = findSimilarSounds("whoosh-fast-air", SAMPLE_LIBRARY, {
      semanticDb: dbPath,
      limit: 5,
    });
    assert.equal(afterWal.mode, "vector");
    assert.ok(afterWal.hits.some((h) => h.name === "pop-crisp-ui"));

    const bgmRes = findSimilarSounds("bgm-tense-pulse", SAMPLE_LIBRARY, {
      semanticDb: dbPath,
      limit: 5,
    });
    assert.equal(bgmRes.mode, "metadata");
    assert.ok(bgmRes.hits.every((h) => h.kind === "bgm"));
  });
});

test("recommendCoreSounds ranks only human-approved core sounds by Elo, query, Rocchio taste, and MMR diversity", async () => {
  await withTempKit(({ dir, kit }) => {
    const dbPath = makeSemanticDb(dir, [
      { key: JSON.stringify(["sfx", "mixkit", "whoosh-fast-air"]), vector: [1, 0, 0, 0] },
      { key: JSON.stringify(["sfx", "mixkit", "whoosh-fast-air-2"]), vector: [0.99, 0.05, 0, 0] },
      { key: JSON.stringify(["sfx", "mixkit", "whoosh-soft-air"]), vector: [0.4, 0.9, 0, 0] },
      { key: JSON.stringify(["sfx", "sonniss", "whoosh-heavy-spin"]), vector: [0, 0, 1, 0] },
    ]);
    kit.setItem({
      id: "whoosh-fast-air",
      category: "whoosh",
      status: "core",
      tags: ["short", "air"],
      tier: 1,
    });
    kit.setItem({
      id: "whoosh-fast-air-2",
      category: "whoosh",
      status: "core",
      tags: ["short", "air"],
    });
    kit.setItem({
      id: "whoosh-soft-air",
      category: "whoosh",
      status: "core",
      tags: ["soft", "air"],
    });
    kit.setItem({ id: "whoosh-heavy-spin", category: "whoosh", status: "ban" });
    kit.resolveAb({
      winner: "whoosh-fast-air",
      rejected: ["whoosh-heavy-spin"],
      category: "whoosh",
      banRejected: true,
    });

    const rec = recommendCoreSounds(kit.read(), SAMPLE_LIBRARY, {
      category: "whoosh",
      query: "short air",
      topN: 2,
      semanticDb: dbPath,
    });
    assert.equal(rec.mode, "hybrid-vector-mmr");
    assert.equal(rec.picks.length, 2);
    assert.equal(rec.picks[0].id, "whoosh-fast-air");
    assert.equal(rec.picks[1].id, "whoosh-soft-air");
    assert.ok(!rec.picks.some((p) => p.id === "whoosh-heavy-spin"));
  });
});

test("recommendCoreSounds handles empty mode, null/empty duration bounds, duration filter, recent cooldown, refSound, and hyphenated tags", async () => {
  await withTempKit(({ dir, kit }) => {
    const missingDb = join(dir, "missing.sqlite");
    const emptyRes = recommendCoreSounds(kit.read(), SAMPLE_LIBRARY, {
      category: "whoosh",
      semanticDb: missingDb,
    });
    assert.equal(emptyRes.mode, "empty");
    assert.equal(emptyRes.picks.length, 0);

    const dbPath = makeSemanticDb(dir, [
      { key: JSON.stringify(["sfx", "mixkit", "whoosh-fast-air"]), vector: [1, 0, 0, 0] },
      { key: JSON.stringify(["sfx", "sonniss", "whoosh-heavy-spin"]), vector: [0, 1, 0, 0] },
      { key: JSON.stringify(["sfx", "custom", "unlisted-anchor"]), vector: [0, 1, 0, 0] },
    ]);
    kit.setItem({
      id: "whoosh-fast-air",
      category: "whoosh",
      status: "core",
      tags: ["soft-hit"],
    });
    kit.setItem({
      id: "whoosh-heavy-spin",
      category: "whoosh",
      status: "core",
      tags: ["heavy"],
    });
    kit.setItem({
      id: "amb-soft-rain-bed",
      category: "ambience",
      status: "core",
      tags: ["room-tone"],
    });

    const withNullBounds = recommendCoreSounds(kit.read(), SAMPLE_LIBRARY, {
      category: "whoosh",
      durMin: null,
      durMax: "",
      semanticDb: missingDb,
    });
    assert.equal(withNullBounds.picks.length, 2);

    const durFiltered = recommendCoreSounds(kit.read(), SAMPLE_LIBRARY, {
      category: "whoosh",
      durMin: 0.9,
      durMax: 1.5,
      semanticDb: missingDb,
    });
    assert.deepEqual(
      durFiltered.picks.map((p) => p.id),
      ["whoosh-heavy-spin"],
    );

    const cooledDown = recommendCoreSounds(kit.read(), SAMPLE_LIBRARY, {
      category: "whoosh",
      recentIds: ["whoosh-fast-air"],
      semanticDb: missingDb,
    });
    assert.equal(cooledDown.picks[0].id, "whoosh-heavy-spin");
    assert.ok(cooledDown.picks[1].why.includes("recently used (-)"));

    const refAnchored = recommendCoreSounds(kit.read(), SAMPLE_LIBRARY, {
      category: "whoosh",
      refSound: "unlisted-anchor",
      semanticDb: dbPath,
    });
    assert.equal(refAnchored.picks[0].id, "whoosh-heavy-spin");

    const hyphenTag = recommendCoreSounds(kit.read(), SAMPLE_LIBRARY, {
      category: "ambience",
      query: "room-tone",
      semanticDb: missingDb,
    });
    assert.ok(hyphenTag.picks[0].why.some((w) => w.startsWith("tag match")));
  });
});

const makeTestApi = ({ dir, kit, sent }) => {
  const fav = openFavorites(join(dir, "favorites.json"));
  const fakeFilm = {
    NAME: "test-film",
    PROJECT: dir,
    WORK: dir,
    PUBLIC: dir,
    ratio: () => "9:16",
    readChoices: () => ({}),
    shotComments: () => ({}),
    contract: () => ({}),
    pageSays: () => {},
    sound: {
      read: () => ({ version: 1, data: { beds: [], sfx: [] } }),
      library: () => SAMPLE_LIBRARY,
    },
    liveLanes: () => true,
  };
  return createApi(fakeFilm, {
    page: () => "",
    events: new Set(),
    send: (ev, data) => sent.push([ev, data]),
    favorites: fav,
    soundKit: kit,
    soundKitSemanticDb: join(dir, "missing.sqlite"),
  });
};

test("Live Studio API item CRUD preserves status on partial update and deletes cleanly", async () => {
  await withTempKit(async ({ dir, kit }) => {
    const sent = [];
    const api = makeTestApi({ dir, kit, sent });

    const g0 = await api.request("/api/sound-kit");
    assert.equal(g0.status, 200);
    assert.equal((await g0.json()).categories.length, 8);

    const p1 = await api.request("/api/sound-kit/item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "whoosh-fast-air", category: "whoosh", status: "core" }),
    });
    assert.equal(p1.status, 200);
    assert.equal((await p1.json()).items["whoosh-fast-air"].status, "core");

    const p2 = await api.request("/api/sound-kit/item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "whoosh-fast-air", category: "whoosh", note: "clean whip" }),
    });
    assert.equal(p2.status, 200);
    const p2Body = await p2.json();
    assert.equal(p2Body.items["whoosh-fast-air"].status, "core");
    assert.equal(p2Body.items["whoosh-fast-air"].note, "clean whip");

    const delOk = await api.request("/api/sound-kit/item/whoosh-fast-air", { method: "DELETE" });
    assert.equal(delOk.status, 200);
    assert.equal(Object.hasOwn((await delOk.json()).items, "whoosh-fast-air"), false);

    const delBad = await api.request("/api/sound-kit/item/__proto__", { method: "DELETE" });
    assert.equal(delBad.status, 400);
    assert.ok(sent.some(([ev]) => ev === "sound-kit"));
  });
});

test("Live Studio API supports batch, ab tray resolve, use no-op guard, similar, and recommend params", async () => {
  await withTempKit(async ({ dir, file, kit }) => {
    const sent = [];
    const api = makeTestApi({ dir, kit, sent });

    const noopUse = await api.request("/api/sound-kit/use", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "untracked-one" }),
    });
    assert.equal(noopUse.status, 200);
    assert.equal(sent.length, 0);
    assert.equal(existsSync(file), false);

    const b1 = await api.request("/api/sound-kit/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          { id: "whoosh-fast-air", category: "whoosh", status: "core", tags: ["short"] },
          { id: "whoosh-soft-air", category: "whoosh", status: "inbox" },
        ],
        skipExisting: true,
      }),
    });
    assert.equal(b1.status, 200);
    assert.equal((await b1.json()).added, 2);

    const abRes = await api.request("/api/sound-kit/ab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slots: ["whoosh-fast-air", "whoosh-soft-air"],
        resolve: {
          winner: "whoosh-fast-air",
          rejected: ["whoosh-soft-air"],
          category: "whoosh",
          reason: "punchy",
          clearTray: true,
        },
      }),
    });
    assert.equal(abRes.status, 200);
    const abBody = await abRes.json();
    assert.deepEqual(abBody.abSlots, []);
    assert.equal(abBody.items["whoosh-fast-air"].wins, 1);

    const useRes = await api.request("/api/sound-kit/use", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "whoosh-fast-air",
        category: "whoosh",
        rejected: ["whoosh-soft-air"],
      }),
    });
    assert.equal(useRes.status, 200);
    assert.equal((await useRes.json()).items["whoosh-fast-air"].picks, 1);

    const simEx = await api.request(
      "/api/sound-kit/similar?name=whoosh-soft-air&excludeCore=1&limit=",
    );
    assert.equal(simEx.status, 200);
    assert.ok(!(await simEx.json()).hits.some((h) => h.name === "whoosh-fast-air"));

    assert.equal((await api.request("/api/sound-kit/similar?name=__proto__")).status, 400);
    assert.equal((await api.request("/api/sound-kit/recommend?category=bogus")).status, 400);
    assert.equal((await api.request("/api/sound-kit/recommend?ref=__proto__")).status, 400);

    const recRes = await api.request(
      "/api/sound-kit/recommend?category=whoosh&q=short&top=3&durMin=0.1&durMax=0.8&recent=whoosh-soft-air&ref=whoosh-fast-air",
    );
    assert.equal(recRes.status, 200);
    assert.equal((await recRes.json()).picks[0].id, "whoosh-fast-air");
  });
});

test("Live Studio API returns sanitized warning on corrupt core.json and 409 on mutating routes", async () => {
  await withTempKit(async ({ dir, file, kit }) => {
    const sent = [];
    const api = makeTestApi({ dir, kit, sent });
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core" });
    writeFileSync(file, "{ broken");

    const corruptGet = await api.request("/api/sound-kit");
    assert.equal(corruptGet.status, 200);
    const getBody = await corruptGet.json();
    assert.ok(getBody.warning && getBody.warning.includes("doesn't parse"));
    assert.equal(getBody.warning.includes(dir), false);

    const corruptPost = await api.request("/api/sound-kit/item", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "pop-crisp-ui", category: "pop-ui", status: "core" }),
    });
    assert.equal(corruptPost.status, 409);

    const corruptDel = await api.request("/api/sound-kit/item/whoosh-fast-air", {
      method: "DELETE",
    });
    assert.equal(corruptDel.status, 409);
  });
});

test("recommendCoreSounds excludes missing-library or zero-second core items when durMin/durMax is set", async () => {
  await withTempKit(({ dir, kit }) => {
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core" });
    kit.setItem({ id: "ghost-sound-not-in-lib", category: "whoosh", status: "core" });
    const res = recommendCoreSounds(kit.read(), SAMPLE_LIBRARY, {
      category: "whoosh",
      durMin: 1.0,
      durMax: 2.0,
      semanticDb: join(dir, "missing.sqlite"),
    });
    assert.deepEqual(res.picks, []);
  });
});

test("removeItems prunes deleted ids from abSlots and avoids creating a file when absent", async () => {
  await withTempKit(({ file, kit }) => {
    kit.removeItem("never-existed");
    assert.equal(existsSync(file), false);

    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core" });
    kit.setAb(["whoosh-fast-air", "whoosh-soft-air"]);
    const after = kit.removeItem("whoosh-fast-air");
    assert.equal(Object.hasOwn(after.items, "whoosh-fast-air"), false);
    assert.deepEqual(after.abSlots, ["whoosh-soft-air"]);
  });
});

test("recordUse promotes inbox items to core and bumps rejected updatedAt", async () => {
  await withTempKit(async ({ kit }) => {
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "inbox" });
    kit.setItem({ id: "whoosh-soft-air", category: "whoosh", status: "inbox" });
    const beforeRejAt = kit.read().items["whoosh-soft-air"].updatedAt;
    await new Promise((r) => setTimeout(r, 15));
    const after = kit.recordUse({
      id: "whoosh-fast-air",
      category: "ambience",
      rejected: ["whoosh-soft-air"],
    });
    assert.equal(after.items["whoosh-fast-air"].status, "core");
    assert.equal(after.items["whoosh-fast-air"].category, "whoosh");
    assert.ok(after.items["whoosh-soft-air"].updatedAt > beforeRejAt);
    assert.equal(
      after.items["whoosh-soft-air"].updatedAt,
      after.items["whoosh-fast-air"].updatedAt,
    );
  });
});

test("recommendCoreSounds applies distinct-family vector cosine MMR and Rocchio ban repulsion", async () => {
  await withTempKit(({ dir, kit }) => {
    const lib = [
      { name: "w-anchor", kind: "sfx", category: "transitions", seconds: 0.5, family: "fam-a" },
      { name: "w-clone", kind: "sfx", category: "transitions", seconds: 0.5, family: "fam-b" },
      { name: "w-diverse", kind: "sfx", category: "transitions", seconds: 0.5, family: "fam-c" },
      { name: "w-banned", kind: "sfx", category: "transitions", seconds: 0.5, family: "fam-d" },
    ];
    const dbPath = makeSemanticDb(dir, [
      { key: JSON.stringify(["sfx", "mixkit", "w-anchor"]), vector: [1, 0, 0, 0] },
      { key: JSON.stringify(["sfx", "mixkit", "w-clone"]), vector: [0.99, 0.05, 0, 0] },
      { key: JSON.stringify(["sfx", "mixkit", "w-diverse"]), vector: [0.7, 0.7, 0, 0] },
      { key: JSON.stringify(["sfx", "mixkit", "w-banned"]), vector: [0, 0, 1, 0] },
    ]);
    kit.setItem({ id: "w-anchor", category: "whoosh", status: "core", tier: 1 });
    kit.setItem({ id: "w-clone", category: "whoosh", status: "core" });
    kit.setItem({ id: "w-diverse", category: "whoosh", status: "core" });
    kit.setItem({ id: "w-banned", category: "whoosh", status: "ban" });
    const rec = recommendCoreSounds(kit.read(), lib, {
      category: "whoosh",
      topN: 2,
      semanticDb: dbPath,
    });
    assert.equal(rec.picks[0].id, "w-anchor");
    assert.equal(rec.picks[1].id, "w-diverse");
  });
});

test("corrupt schema with mismatched item key and id throws SoundKitCorruptError", async () => {
  await withTempKit(({ file, kit }) => {
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core" });
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    parsed.items["other-key"] = parsed.items["whoosh-fast-air"];
    writeFileSync(file, JSON.stringify(parsed));
    assert.throws(() => kit.read(), /mismatched/);
  });
});

test("Live Studio API rejects empty ab payload and invalid durMin/durMax query params with 400", async () => {
  await withTempKit(async ({ dir, file, kit }) => {
    const sent = [];
    const api = makeTestApi({ dir, kit, sent });

    const emptyAb = await api.request("/api/sound-kit/ab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(emptyAb.status, 400);
    assert.equal(existsSync(file), false);

    const noopDel = await api.request("/api/sound-kit/item/never-existed", { method: "DELETE" });
    assert.equal(noopDel.status, 200);
    assert.equal(sent.length, 0);
    assert.equal(existsSync(file), false);

    assert.equal((await api.request("/api/sound-kit/recommend?durMin=abc")).status, 400);
    assert.equal((await api.request("/api/sound-kit/recommend?durMax=-1")).status, 400);
    assert.equal((await api.request("/api/sound-kit/recommend?durMin=2&durMax=1")).status, 400);
    assert.equal((await api.request("/api/sound-kit/recommend?top=0")).status, 400);
    assert.equal(
      (await api.request("/api/sound-kit/similar?name=whoosh-fast-air&limit=0")).status,
      400,
    );
  });
});

test("banning a slotted sound prunes it from abSlots via setItem, batchSet, and resolveAb", async () => {
  await withTempKit(({ kit }) => {
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "inbox" });
    kit.setAb(["whoosh-fast-air", "whoosh-soft-air"]);
    const next = kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "ban" });
    assert.deepEqual(next.abSlots, ["whoosh-soft-air"]);

    kit.setAb(["whoosh-soft-air", "whoosh-heavy-spin", "whoosh-gentle-swoosh"]);
    const afterResolve = kit.resolveAb({
      winner: "whoosh-soft-air",
      rejected: ["whoosh-heavy-spin"],
      category: "whoosh",
      banRejected: true,
      clearTray: false,
    });
    assert.equal(afterResolve.items["whoosh-heavy-spin"].status, "ban");
    assert.deepEqual(afterResolve.abSlots, ["whoosh-soft-air", "whoosh-gentle-swoosh"]);

    const afterBatchSkip = kit.batchSet(
      [{ id: "whoosh-soft-air", category: "whoosh", status: "ban" }],
      { skipExisting: true },
    );
    assert.deepEqual(afterBatchSkip.state.abSlots, ["whoosh-soft-air", "whoosh-gentle-swoosh"]);

    const afterBatchBan = kit.batchSet([
      { id: "whoosh-gentle-swoosh", category: "whoosh", status: "ban" },
      { id: "whoosh-soft-air", category: "whoosh", status: "ban" },
      { id: "whoosh-soft-air", category: "whoosh", status: "core" },
    ]);
    assert.equal(afterBatchBan.state.items["whoosh-gentle-swoosh"].status, "ban");
    assert.equal(afterBatchBan.state.items["whoosh-soft-air"].status, "core");
    assert.deepEqual(afterBatchBan.state.abSlots, ["whoosh-soft-air"]);
  });
});

test("pass status summarizes cleanly, survives skipExisting, keeps abSlots, promotes on recordUse, and stays non-core/non-banned", async () => {
  await withTempKit(async ({ dir, kit }) => {
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core" });
    kit.setItem({ id: "whoosh-soft-air", category: "whoosh", status: "pass" });
    kit.setItem({ id: "whoosh-heavy-spin", category: "whoosh", status: "ban" });
    kit.setAb(["whoosh-fast-air", "whoosh-soft-air"]);

    const summary = summarizeSoundKit(kit.read());
    assert.deepEqual(summary.totals, { inbox: 0, core: 1, pass: 1, ban: 1, total: 3 });
    assert.deepEqual(summary.byCategory.whoosh, { inbox: 0, core: 1, pass: 1, ban: 1, total: 3 });

    const rePass = kit.setItem({ id: "whoosh-soft-air", category: "whoosh", status: "pass" });
    assert.deepEqual(rePass.abSlots, ["whoosh-fast-air", "whoosh-soft-air"]);

    const skipRes = kit.batchSet(
      [{ id: "whoosh-soft-air", category: "whoosh", status: "inbox", addedBy: "ai" }],
      { skipExisting: true },
    );
    assert.equal(skipRes.skipped, 1);
    assert.equal(skipRes.state.items["whoosh-soft-air"].status, "pass");

    const rec = recommendCoreSounds(kit.read(), SAMPLE_LIBRARY, {
      category: "whoosh",
      topN: 5,
      semanticDb: join(dir, "missing.sqlite"),
    });
    assert.deepEqual(
      rec.picks.map((p) => p.id),
      ["whoosh-fast-air"],
    );

    const api = makeTestApi({ dir, kit, sent: [] });
    const simRes = await api.request("/api/sound-kit/similar?name=whoosh-fast-air&limit=10");
    assert.equal(simRes.status, 200);
    const simHits = (await simRes.json()).hits.map((h) => h.name);
    assert.ok(simHits.includes("whoosh-soft-air"));
    assert.ok(!simHits.includes("whoosh-heavy-spin"));

    const used = kit.recordUse({ id: "whoosh-soft-air" });
    assert.equal(used.items["whoosh-soft-air"].status, "core");
    assert.equal(used.items["whoosh-soft-air"].picks, 1);
  });
});

test("classifyPopularSound ignores generic Sonniss boilerplate in for-descriptions when primary title is explicit", () => {
  assert.equal(
    classifyPopularSound({
      name: "son-15-seq1-15-whoosh-1-96-hk1",
      title: "Seq1.15 whoosh #1 96",
      for: "a whoosh, riser or transition",
      category: "transitions",
      kind: "sfx",
    }),
    "whoosh",
  );
  assert.equal(
    classifyPopularSound({
      name: "son-16-eating-apple-bite-enjoying-chewing-breath-semi-close-take-1",
      title: "Eating apple, bite, enjoying, chewing, breath, semi close",
      for: "a human voice: shout, scream or breath",
      category: "voices",
      kind: "sfx",
    }),
    "foley-core",
  );
  assert.equal(
    classifyPopularSound({
      name: "of-sfx-rising-cork-pops-570fa4",
      title: "Rising cork pops",
      for: "ui; uplifting; pop; trailer; riser; bubble-pop",
      category: "clicks",
      kind: "sfx",
    }),
    "pop-ui",
  );
  assert.equal(
    classifyPopularSound({
      name: "son-19-ceramic-bowl-clink-take-2",
      title: "Ceramic bowl clink take 2",
      for: "a musical hit, note or tension tone",
      category: "musical",
      kind: "sfx",
    }),
    "foley-core",
  );
});

test("restoreSnapshot and POST /api/sound-kit/restore atomically round-trip Elo, stats, abSlots, and decisions", async () => {
  await withTempKit(async ({ dir, kit }) => {
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "inbox" });
    kit.setItem({ id: "whoosh-soft-air", category: "whoosh", status: "inbox" });
    kit.setAb(["whoosh-fast-air", "whoosh-soft-air"]);
    const beforeResolve = structuredClone(kit.read());

    const afterResolve = kit.resolveAb({
      winner: "whoosh-fast-air",
      rejected: ["whoosh-soft-air"],
      category: "whoosh",
      reason: "punchy",
    });
    assert.ok(afterResolve.items["whoosh-fast-air"].elo > 1500);
    assert.equal(afterResolve.items["whoosh-fast-air"].wins, 1);
    assert.equal(afterResolve.items["whoosh-soft-air"].losses, 1);
    assert.equal(afterResolve.decisions.length, 1);

    const api = makeTestApi({ dir, kit, sent: [] });
    const badRes = await api.request("/api/sound-kit/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: { "whoosh-fast-air": afterResolve.items["whoosh-soft-air"] },
      }),
    });
    assert.equal(badRes.status, 400);

    const undoRes = await api.request("/api/sound-kit/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: {
          "whoosh-fast-air": beforeResolve.items["whoosh-fast-air"],
          "whoosh-soft-air": beforeResolve.items["whoosh-soft-air"],
        },
        abSlots: beforeResolve.abSlots,
        decisions: beforeResolve.decisions,
      }),
    });
    assert.equal(undoRes.status, 200);
    const undone = await undoRes.json();
    assert.equal(undone.items["whoosh-fast-air"].elo, 1500);
    assert.equal(undone.items["whoosh-fast-air"].wins, 0);
    assert.equal(undone.items["whoosh-soft-air"].losses, 0);
    assert.equal(undone.decisions.length, 0);

    kit.setAb(["whoosh-fast-air", "whoosh-soft-air"]);
    const bannedRestored = kit.restoreSnapshot({
      items: {
        "whoosh-fast-air": { ...undone.items["whoosh-fast-air"], status: "ban" },
      },
    });
    assert.deepEqual(bannedRestored.abSlots, ["whoosh-soft-air"]);
  });
});
