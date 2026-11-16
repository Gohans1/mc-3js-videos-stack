import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SoundTimeline } from "../../packages/live-studio/src/contract.ts";
import { writeVoiceMap } from "../../packages/live-studio/src/voice-map.mjs";

const REPO = resolve(import.meta.dir, "../..");
const ASSEMBLE = join(REPO, "scripts/voice/assemble.ts");

function runCli(args, cwd, envExtra = {}) {
  return spawnSync("bun", [ASSEMBLE, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...envExtra },
  });
}

function runCliAsync(args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("bun", [ASSEMBLE, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", rejectRun);
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

function makeAudio(outFile, freq = 440, dur = 1.0) {
  mkdirSync(resolve(outFile, ".."), { recursive: true });
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:duration=${dur}`,
      "-ar",
      "44100",
      "-ac",
      "1",
      outFile,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, `ffmpeg helper failed: ${r.stderr}`);
}

function writeWords(audioPath, words, dur = 1.0) {
  writeFileSync(`${audioPath}.words.json`, JSON.stringify({ dur, words }));
}

function makeFilm(name, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), `cva-${name}-`));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "export {};\n");
  writeFileSync(
    join(dir, "package.json"),
    typeof opts.pkg === "string"
      ? opts.pkg
      : JSON.stringify(opts.pkg ?? { name: `test-${name}` }, null, 2),
  );
  const edit =
    opts.edit !== undefined
      ? opts.edit
      : {
          end: opts.end ?? 5,
          voice: { lines: [], edits: {}, warp: [] },
          takes: opts.takes ?? [],
          beats: [],
        };
  writeFileSync(
    join(dir, "src/edit.json"),
    typeof edit === "string" ? edit : JSON.stringify(edit, null, 2),
  );
  if (opts.audio !== null) {
    const audio = opts.audio ?? { narration: "narration", beds: [], sfx: [] };
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      typeof audio === "string" ? audio : JSON.stringify(audio, null, 2),
    );
  }
  return dir;
}

function lastNonEmptyLine(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "";
}

test("reassembly preserves deleted bricks, individual gains and trims unless --clips", () => {
  const dir = makeFilm("keep-three", {
    takes: ["01", "02", "03"].map((id, i) => ({ id, t: i * 3 + 0.1 })),
  });
  try {
    for (const id of ["01", "02", "03"]) {
      const file = join(dir, `voice/takes/${id}.wav`);
      makeAudio(file);
      writeWords(file, [{ w: id, s: 0.1, e: 0.7 }]);
    }
    assert.equal(runCli([], dir).status, 0);
    const path = join(dir, "src/timeline/audio.json");
    const pristine = JSON.parse(readFileSync(path, "utf8"));
    const variants = [
      pristine.sfx.filter((_, i) => i !== 1),
      pristine.sfx.map((c, i) => (i === 1 ? { ...c, length: 0.3 } : c)),
      pristine.sfx.map((c, i) => (i === 1 ? { ...c, gain: -9 } : c)),
      pristine.sfx.map((c, i) => (i === 1 ? { ...c, dialogue: false } : c)),
      [],
    ];
    for (const sfx of variants) {
      writeFileSync(path, JSON.stringify({ ...pristine, sfx }));
      assert.equal(runCli([], dir).status, 0);
      assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).sfx, sfx);
    }
    assert.equal(runCli(["--clips"], dir).status, 0);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).sfx.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid audio rows fail before replacing an existing voice or writing maps", () => {
  const dir = makeFilm("bad-rows", { takes: [{ id: "01", t: 0.1 }] });
  try {
    const take = join(dir, "voice/takes/01.wav");
    makeAudio(take);
    writeWords(take, [{ w: "Hi", s: 0.1, e: 0.7 }]);
    const out = join(dir, "assets/public/agent/full_voice.wav");
    makeAudio(out, 660);
    const original = readFileSync(out);
    for (const rows of [{ sfx: [null] }, { tracks: [null] }]) {
      writeFileSync(
        join(dir, "src/timeline/audio.json"),
        JSON.stringify({ narration: "narration", beds: [], sfx: [], ...rows }),
      );
      const r = runCli([], dir);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /audio\.json/);
      assert.deepEqual(readFileSync(out), original);
      assert.equal(existsSync(join(dir, "renders/live/voice_map.json")), false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("regenerating a longer take refreshes untouched bricks against the previous assembly", () => {
  const dir = makeFilm("regrown", { takes: [{ id: "01" }, { id: "02" }] });
  try {
    for (const id of ["01", "02"]) {
      const f = join(dir, `voice/takes/${id}.wav`);
      makeAudio(f, 440, 1);
      writeWords(f, [{ w: id, s: 0.1, e: 0.7 }], 1);
    }
    assert.equal(runCli([], dir).status, 0);
    const take = join(dir, "voice/takes/01.wav");
    makeAudio(take, 440, 2);
    writeWords(take, [{ w: "01", s: 0.1, e: 1.7 }], 2);
    writeVoiceMap(dir, join(dir, "renders/live/voice_map.json"));
    const r = runCli([], dir);
    assert.equal(r.status, 0, r.stderr);
    const audio = JSON.parse(readFileSync(join(dir, "src/timeline/audio.json"), "utf8"));
    assert.equal(audio.sfx[0].length, 1.9);
    assert.equal(audio.sfx[1].start, 2.3);
    assert.equal(audio.sfx[1].at, 2.3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("regeneration keeps a moved trimmed brick on the same take, with its gain and processing edits", () => {
  const dir = makeFilm("moved-regrown", { takes: [{ id: "01" }, { id: "02" }] });
  try {
    for (const id of ["01", "02"]) {
      const f = join(dir, `voice/takes/${id}.wav`);
      makeAudio(f, id === "01" ? 440 : 660, 1);
      writeWords(f, [{ w: id, s: 0.1, e: 0.7 }], 1);
    }
    assert.equal(runCli([], dir).status, 0);
    const path = join(dir, "src/timeline/audio.json");
    const audio = JSON.parse(readFileSync(path, "utf8"));
    Object.assign(audio.sfx[1], { at: 4, start: 1.5, length: 0.3, gain: -9, dialogue: false });
    audio.sfx.splice(
      0,
      1,
      { ...audio.sfx[0], length: 0.45 },
      { ...audio.sfx[0], at: 6, start: 0.45, length: 0.45 },
    );
    writeFileSync(path, JSON.stringify(audio));
    makeAudio(join(dir, "voice/takes/01.wav"), 440, 2);
    writeWords(join(dir, "voice/takes/01.wav"), [{ w: "01", s: 0.1, e: 1.7 }], 2);
    const r = runCli([], dir);
    assert.equal(r.status, 0, r.stderr);
    const updated = JSON.parse(readFileSync(path, "utf8")).sfx;
    assert.equal(updated[1].at, 6);
    assert.equal(updated[1].length, 0.45);
    const clip = updated[2];
    assert.equal(clip.at, 4);
    assert.equal(clip.start, 2.5);
    assert.equal(clip.length, 0.3);
    assert.equal(clip.gain, -9);
    assert.equal(clip.dialogue, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("older assemblies without layout refuse changed takes before overwriting audio or edited bricks", () => {
  const dir = makeFilm("legacy-layout", { takes: [{ id: "01" }, { id: "02" }] });
  try {
    for (const id of ["01", "02"]) {
      const f = join(dir, `voice/takes/${id}.wav`);
      makeAudio(f);
      writeWords(f, [{ w: id, s: 0.1, e: 0.7 }]);
    }
    assert.equal(runCli([], dir).status, 0);
    const mapPath = join(dir, "renders/live/voice_map.json");
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    delete map.placements;
    writeFileSync(mapPath, JSON.stringify(map));
    const audioPath = join(dir, "src/timeline/audio.json");
    const audio = JSON.parse(readFileSync(audioPath, "utf8"));
    audio.sfx[1].at = 4;
    writeFileSync(audioPath, JSON.stringify(audio));
    const wav = join(dir, "assets/public/agent/full_voice.wav");
    const before = readFileSync(wav);
    const audioBefore = readFileSync(audioPath);
    makeAudio(join(dir, "voice/takes/01.wav"), 440, 2);
    writeWords(join(dir, "voice/takes/01.wav"), [{ w: "01", s: 0.1, e: 1.7 }], 2);
    const rejected = runCli([], dir);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /previous assembly layout.*--clips/i);
    assert.deepEqual(readFileSync(wav), before);
    assert.deepEqual(readFileSync(audioPath), audioBefore);
    assert.equal(runCli(["--clips"], dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI help, unknown flags, extra args, and outside-film checks exit cleanly before file access", () => {
  const broken = makeFilm("args", { edit: "{ broken", audio: "{ broken" });
  const outside = mkdtempSync(join(tmpdir(), "cva-nofilm-"));
  try {
    for (const flag of ["-h", "--help", "help"]) {
      const r = runCli([flag], broken);
      assert.equal(r.status, 0, `${flag} should exit 0`);
      assert.match(lastNonEmptyLine(r.stdout), /^next:/i);
      assert.equal(r.stderr.trim(), "");
    }
    assert.equal(runCli(["--help"], outside).status, 0);

    const bogus = runCli(["--bogus"], broken);
    assert.equal(bogus.status, 2);
    assert.match(bogus.stderr, /unknown option --bogus/i);

    const extra = runCli(["extra"], broken);
    assert.equal(extra.status, 2);
    assert.match(extra.stderr, /one word too many/i);

    const noFilm = runCli([], outside);
    assert.equal(noFilm.status, 2);
    assert.match(noFilm.stderr, /not a film/i);

    const typo = runCli([], broken, { LIVE_PROJET: broken });
    assert.equal(typo.status, 2);
    assert.match(typo.stderr, /LIVE_PROJET/i);
  } finally {
    rmSync(broken, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("validates edit.json, package.json, audio.json, and junctions upfront before writing wav/edit/voice_map/mouth", () => {
  const cases = [
    {
      name: "broken-audio",
      edit: undefined,
      audio: "{ broken",
      pkg: undefined,
      pat: /audio\.json/i,
    },
    {
      name: "bad-sfx",
      edit: undefined,
      audio: { narration: "narration", beds: [], sfx: "oops" },
      pkg: undefined,
      pat: /sfx/i,
    },
    { name: "array-edit", edit: "[]", audio: undefined, pkg: undefined, pat: /edit\.json/i },
    {
      name: "bad-end",
      edit: {
        end: "abc",
        voice: { lines: [], edits: {}, warp: [] },
        takes: [{ id: "01", text: "Hi", t: 0 }],
      },
      audio: undefined,
      pkg: undefined,
      pat: /end/i,
    },
    {
      name: "bad-soundTimeline-type",
      edit: undefined,
      audio: undefined,
      pkg: { name: "bad-st", "live-studio": { soundTimeline: 123 } },
      pat: /soundTimeline/i,
    },
    {
      name: "bad-soundSources-type",
      edit: undefined,
      audio: undefined,
      pkg: { name: "bad-ss", "live-studio": { soundSources: { narration: 123 } } },
      pat: /soundSources\.narration/i,
    },
    {
      name: "escape-soundTimeline",
      edit: undefined,
      audio: undefined,
      pkg: { name: "esc-st", "live-studio": { soundTimeline: "../outside.json" } },
      pat: /inside film directory/i,
    },
  ];

  for (const tc of cases) {
    const d = makeFilm(tc.name, {
      takes: [{ id: "01", text: "Hi", t: 0 }],
      edit: tc.edit,
      audio: tc.audio,
      pkg: tc.pkg,
    });
    try {
      makeAudio(join(d, "voice/takes/01.wav"), 440, 0.6);
      writeWords(join(d, "voice/takes/01.wav"), [{ w: "Hi", s: 0.1, e: 0.4 }], 0.6);
      const editBefore = readFileSync(join(d, "src/edit.json"), "utf8");
      const r = runCli([], d);
      assert.notEqual(r.status, 0, `${tc.name} must fail`);
      assert.match(r.stderr, tc.pat, `${tc.name} error mismatch: ${r.stderr}`);
      assert.equal(
        readFileSync(join(d, "src/edit.json"), "utf8"),
        editBefore,
        `${tc.name} must not mutate edit.json`,
      );
      assert.equal(
        existsSync(join(d, "assets/public/agent/full_voice.wav")),
        false,
        `${tc.name} must not write full_voice.wav`,
      );
      assert.equal(
        existsSync(join(d, "renders/live/voice_map.json")),
        false,
        `${tc.name} must not write voice_map.json`,
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }

  // Junctioned src/timeline must also fail before mutating edit.json or full_voice.wav
  const outside = mkdtempSync(join(tmpdir(), "cva-junc-out-"));
  const dj = makeFilm("junction", { takes: [{ id: "01", text: "Hi", t: 0 }] });
  try {
    writeFileSync(
      join(outside, "audio.json"),
      JSON.stringify({ narration: "narration", beds: [], sfx: [] }),
    );
    rmSync(join(dj, "src/timeline"), { recursive: true, force: true });
    symlinkSync(outside, join(dj, "src/timeline"), "junction");
    makeAudio(join(dj, "voice/takes/01.wav"), 440, 0.6);
    writeWords(join(dj, "voice/takes/01.wav"), [{ w: "Hi", s: 0.1, e: 0.4 }], 0.6);
    const editBefore = readFileSync(join(dj, "src/edit.json"), "utf8");
    const r = runCli([], dj);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /inside film directory/i);
    assert.equal(readFileSync(join(dj, "src/edit.json"), "utf8"), editBefore);
    assert.equal(existsSync(join(dj, "assets/public/agent/full_voice.wav")), false);
  } finally {
    rmSync(dj, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("sorts out-of-order takes chronologically, validates SoundTimeline, and rejects duplicate IDs or overlapping spoken takes", () => {
  // 1. Out-of-order takes with touching silent tail sort cleanly across lines, voice_map, and Phrase Bricks
  const dOrder = makeFilm("unordered", {
    end: 2,
    takes: [
      { id: "02", text: "Second", t: 2.0 },
      { id: "01", text: "First", t: 0.2 },
    ],
    audio: { narration: "narration", tracks: [{ id: "sfx", name: "SFX" }], beds: [], sfx: [] },
  });
  try {
    makeAudio(join(dOrder, "voice/takes/01.wav"), 440, 1.0);
    writeWords(join(dOrder, "voice/takes/01.wav"), [{ w: "First", s: 0.1, e: 0.7 }], 1.0);
    makeAudio(join(dOrder, "voice/takes/02.mp3"), 660, 0.9);
    writeWords(join(dOrder, "voice/takes/02.mp3"), [{ w: "Second", s: 0.05, e: 0.6 }], 0.9);

    const r = runCli([], dOrder);
    assert.equal(r.status, 0, r.stderr);
    const edit = JSON.parse(readFileSync(join(dOrder, "src/edit.json"), "utf8"));
    const vmap = JSON.parse(readFileSync(join(dOrder, "renders/live/voice_map.json"), "utf8"));
    const audio = JSON.parse(readFileSync(join(dOrder, "src/timeline/audio.json"), "utf8"));
    assert.ok(edit.voice.lines[0][0] < edit.voice.lines[1][0], "voice.lines must be chronological");
    assert.ok(vmap.lines[0].s < vmap.lines[1].s, "voice_map.lines must be chronological");
    assert.equal(audio.sfx.length, 2);
    assert.ok(audio.sfx[0].at < audio.sfx[1].at, "Phrase Bricks must be chronological");
    assert.equal(SoundTimeline.safeParse(audio).success, true);
  } finally {
    rmSync(dOrder, { recursive: true, force: true });
  }

  // 2. Duplicate take IDs rejected upfront
  const dDup = makeFilm("dup", {
    takes: [
      { id: "01", text: "A", t: 0 },
      { id: "01", text: "B", t: 2 },
    ],
  });
  try {
    makeAudio(join(dDup, "voice/takes/01.wav"), 440, 0.6);
    writeWords(join(dDup, "voice/takes/01.wav"), [{ w: "A", s: 0.1, e: 0.4 }], 0.6);
    const r = runCli([], dDup);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /duplicate take id.*01/i);
    assert.equal(existsSync(join(dDup, "assets/public/agent/full_voice.wav")), false);
  } finally {
    rmSync(dDup, { recursive: true, force: true });
  }

  // 3. Spoken overlap rejected upfront (takes 01 and 02 collide)
  const dOverlap = makeFilm("overlap", {
    takes: [
      { id: "01", text: "Long", t: 0.1 },
      { id: "02", text: "Colliding", t: 0.5 },
    ],
  });
  try {
    makeAudio(join(dOverlap, "voice/takes/01.wav"), 440, 2.0);
    writeWords(join(dOverlap, "voice/takes/01.wav"), [{ w: "Long", s: 0.1, e: 1.8 }], 2.0);
    makeAudio(join(dOverlap, "voice/takes/02.wav"), 550, 1.0);
    writeWords(join(dOverlap, "voice/takes/02.wav"), [{ w: "Colliding", s: 0.1, e: 0.8 }], 1.0);
    const r = runCli([], dOverlap);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /overlap/i);
    assert.match(r.stderr, /01.*02|02.*01/);
    assert.equal(existsSync(join(dOverlap, "assets/public/agent/full_voice.wav")), false);
  } finally {
    rmSync(dOverlap, { recursive: true, force: true });
  }
});

test("preserves edited, split, DSP-modified, and deleted Phrase Bricks unless --clips, repairs missing track, and clears bricks on empty takes", () => {
  // 1. Single take edited at at=0, start=0 (rate + gainKeys)
  const dSingle = makeFilm("single-edit", {
    takes: [{ id: "01", text: "Solo", t: 0 }],
    audio: {
      narration: "narration",
      beds: [],
      sfx: [
        {
          at: 0,
          start: 0,
          length: 1.0,
          name: "narration",
          gain: -2,
          rate: 1.25,
          gainKeys: [
            { t: 0, gain: -6 },
            { t: 0.4, gain: 0 },
          ],
          dialogue: true,
        },
      ],
    },
  });
  try {
    makeAudio(join(dSingle, "voice/takes/01.wav"), 440, 1.2);
    writeWords(join(dSingle, "voice/takes/01.wav"), [{ w: "Solo", s: 0.1, e: 0.9 }], 1.2);
    assert.equal(runCli([], dSingle).status, 0);
    const afterKeep = JSON.parse(readFileSync(join(dSingle, "src/timeline/audio.json"), "utf8"));
    assert.equal(afterKeep.sfx[0].rate, 1.25);
    assert.equal(afterKeep.sfx[0].gainKeys.length, 2);

    assert.equal(runCli(["--clips"], dSingle).status, 0);
    const afterForce = JSON.parse(readFileSync(join(dSingle, "src/timeline/audio.json"), "utf8"));
    assert.equal(afterForce.sfx[0].rate, undefined);
    assert.equal(afterForce.sfx[0].gainKeys, undefined);
  } finally {
    rmSync(dSingle, { recursive: true, force: true });
  }

  // 2. Multi-take split (at==start, 3 bricks for 2 takes), voiceFilter edit, deleted brick, invalid track repair, and empty takes cleanup
  const dMulti = makeFilm("multi-edit", {
    takes: [
      { id: "01", text: "One", t: 0 },
      { id: "02", text: "Two", t: 3 },
    ],
    audio: {
      narration: "narration",
      tracks: [{ id: "sfx", name: "SFX" }],
      beds: [],
      sfx: [
        { at: 0, start: 0, length: 0.9, name: "narration", gain: 0, track: "deleted_track" },
        { at: 2.9, start: 2.9, length: 0.9, name: "narration", gain: 0, track: "deleted_track" },
      ],
    },
  });
  try {
    makeAudio(join(dMulti, "voice/takes/01.wav"), 440, 1.0);
    writeWords(join(dMulti, "voice/takes/01.wav"), [{ w: "One", s: 0.1, e: 0.8 }], 1.0);
    makeAudio(join(dMulti, "voice/takes/02.wav"), 550, 1.0);
    writeWords(join(dMulti, "voice/takes/02.wav"), [{ w: "Two", s: 0.1, e: 0.8 }], 1.0);

    // Dangling track gets repaired to valid "voice" track cleanly
    assert.equal(runCli([], dMulti).status, 0);
    const repaired = JSON.parse(readFileSync(join(dMulti, "src/timeline/audio.json"), "utf8"));
    assert.equal(SoundTimeline.safeParse(repaired).success, true);
    assert.equal(repaired.sfx[0].track, "voice");

    // Split brick 1 into 2 bricks (now 3 bricks, all with at===start) -> preserved!
    const splitDoc = structuredClone(repaired);
    splitDoc.sfx.splice(
      0,
      1,
      { ...repaired.sfx[0], length: 0.45 },
      { ...repaired.sfx[0], at: 0.45, start: 0.45, length: 0.45 },
    );
    writeFileSync(join(dMulti, "src/timeline/audio.json"), JSON.stringify(splitDoc));
    assert.equal(runCli([], dMulti).status, 0);
    assert.equal(
      JSON.parse(readFileSync(join(dMulti, "src/timeline/audio.json"), "utf8")).sfx.length,
      3,
    );

    // Reset with --clips, then add voiceFilter without moving at -> preserved!
    assert.equal(runCli(["--clips"], dMulti).status, 0);
    const filteredDoc = JSON.parse(readFileSync(join(dMulti, "src/timeline/audio.json"), "utf8"));
    filteredDoc.sfx[0].voiceFilter = "telephone";
    writeFileSync(join(dMulti, "src/timeline/audio.json"), JSON.stringify(filteredDoc));
    assert.equal(runCli([], dMulti).status, 0);
    assert.equal(
      JSON.parse(readFileSync(join(dMulti, "src/timeline/audio.json"), "utf8")).sfx[0].voiceFilter,
      "telephone",
    );

    // Delete 1 brick cleanly with 2 takes -> 1 short brick kept without --clips
    const oneDel = structuredClone(repaired);
    oneDel.sfx = [repaired.sfx[0]];
    writeFileSync(join(dMulti, "src/timeline/audio.json"), JSON.stringify(oneDel));
    assert.equal(runCli([], dMulti).status, 0);
    assert.equal(
      JSON.parse(readFileSync(join(dMulti, "src/timeline/audio.json"), "utf8")).sfx.length,
      1,
    );

    // Empty takes + --clips clears stale bricks
    const edit = JSON.parse(readFileSync(join(dMulti, "src/edit.json"), "utf8"));
    edit.takes = [];
    writeFileSync(join(dMulti, "src/edit.json"), JSON.stringify(edit));
    assert.equal(runCli(["--clips"], dMulti).status, 0);
    assert.equal(
      JSON.parse(readFileSync(join(dMulti, "src/timeline/audio.json"), "utf8")).sfx.length,
      0,
    );
  } finally {
    rmSync(dMulti, { recursive: true, force: true });
  }
});

test("detects invalid/empty mouth shapes, emits accurate next: lines, notes choices.json off, and reports startJob activity", async () => {
  // 1. Corrupt .wav.mouth.json or empty cues triggers unshaped warning AND next: bun run voice:lips
  const dMouth = makeFilm("mouth-check", {
    takes: [{ id: "01", text: "Speak", t: 0.2, by: "hero" }],
  });
  try {
    makeAudio(join(dMouth, "voice/takes/01.wav"), 440, 0.7);
    writeWords(join(dMouth, "voice/takes/01.wav"), [{ w: "Speak", s: 0.1, e: 0.5 }], 0.7);
    writeFileSync(join(dMouth, "voice/takes/01.wav.mouth.json"), "{ bad");
    const future = new Date(Date.now() + 5000);
    utimesSync(join(dMouth, "voice/takes/01.wav.mouth.json"), future, future);

    const rBad = runCli([], dMouth);
    assert.equal(rBad.status, 0);
    assert.match(rBad.stdout, /without mouth shapes \(01\)/i);
    assert.match(lastNonEmptyLine(rBad.stdout), /^next:\s+bun run voice:lips\b/i);

    // Write valid cues and re-run -> mouth.json gets shifted cues, next: advances to voice:cues
    writeFileSync(
      join(dMouth, "voice/takes/01.wav.mouth.json"),
      JSON.stringify({
        tool: "Rhubarb Lip Sync",
        cues: [
          [0.1, "B"],
          [0.4, "X"],
        ],
      }),
    );
    const future2 = new Date(Date.now() + 10000);
    utimesSync(join(dMouth, "voice/takes/01.wav.mouth.json"), future2, future2);

    const rGood = runCli([], dMouth);
    assert.equal(rGood.status, 0);
    assert.doesNotMatch(rGood.stdout, /without mouth shapes/i);
    assert.match(lastNonEmptyLine(rGood.stdout), /^next:\s+bun run voice:cues\b/i);
    const mouth = JSON.parse(readFileSync(join(dMouth, "src/timeline/mouth.json"), "utf8"));
    assert.equal(mouth.takes.length, 1);
    assert.equal(mouth.takes[0].id, "01");
    assert.equal(mouth.takes[0].cues.length, 2);
  } finally {
    rmSync(dMouth, { recursive: true, force: true });
  }

  // 2. Empty takes prints next: directing to add takes + bun run voice:gen
  const dEmpty = makeFilm("empty-next", { takes: [] });
  try {
    const r = runCli([], dEmpty);
    assert.equal(r.status, 0);
    assert.match(lastNonEmptyLine(r.stdout), /^next:.*voice:gen\b/i);
  } finally {
    rmSync(dEmpty, { recursive: true, force: true });
  }

  // 3. startJob activity reporting (success + failure) + choices.json off note
  const dAct = makeFilm("activity", {
    takes: [{ id: "01", text: "Hello", t: 0 }],
    audio: { narration: "narration", beds: [], sfx: [] },
  });
  writeFileSync(join(dAct, "choices.json"), JSON.stringify({ narration: { set: "off" } }));
  const events = [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        events.push(JSON.parse(body));
      } catch {
        events.push(body);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  try {
    makeAudio(join(dAct, "voice/takes/01.wav"), 440, 0.7);
    writeWords(join(dAct, "voice/takes/01.wav"), [{ w: "Hello", s: 0.1, e: 0.5 }], 0.7);
    mkdirSync(join(dAct, "renders/live"), { recursive: true });
    writeFileSync(join(dAct, "renders/live/studio.json"), JSON.stringify({ port }));

    const r = await runCliAsync([], dAct);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /choices\.json/i);
    assert.match(lastNonEmptyLine(r.stdout), /^next:\s+bun run voice:cues\b/i);
    assert.ok(events.length >= 2, `expected start + end activity events, got ${events.length}`);
    assert.equal(events[0].job?.key, "voice:assemble");
    assert.equal(events.at(-1).job?.key, "voice:assemble");
    assert.equal(events.at(-1).job?.end, true);
    assert.equal(events.at(-1).level, "ok");

    // Failure also closes startJob with level: "fail"
    events.length = 0;
    writeFileSync(join(dAct, "src/timeline/audio.json"), "{ broken");
    const rFail = await runCliAsync([], dAct);
    assert.notEqual(rFail.status, 0);
    assert.ok(events.length >= 2, "expected start + fail end events on failure");
    assert.equal(events.at(-1).job?.key, "voice:assemble");
    assert.equal(events.at(-1).job?.end, true);
    assert.equal(events.at(-1).level, "fail");
  } finally {
    srv.close();
    rmSync(dAct, { recursive: true, force: true });
  }
});
