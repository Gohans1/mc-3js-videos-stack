import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOUND = resolve(dirname(fileURLToPath(import.meta.url)), "../sound");

const tone = (file, expr) => {
  const r = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${expr}:s=48000:d=8`,
    file,
  ]);
  assert.equal(r.status, 0, String(r.stderr));
};

test("the mix's loudness is judged the way YouTube plays it: turned down when loud, never up when quiet, peaks kept under -1 dBTP", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "loud-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const report = (file, target) => {
    const r = spawnSync(
      "python",
      [
        "-c",
        `import sys; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import loudness_report; print("\\n".join(loudness_report(sys.argv[1], float(sys.argv[2]))))`,
        file,
        String(target),
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const loud = join(dir, "loud.wav"),
    quiet = join(dir, "quiet.wav");
  tone(loud, "0.95*sin(2*PI*1000*t)");
  tone(quiet, "0.02*sin(2*PI*1000*t)");
  const hot = report(loud, -14);
  assert.match(
    hot,
    /-?\d+\.\d LUFS integrated, true peak -?\d+\.\d dBTP, loudness range \d+\.\d LU/,
  );
  assert.match(hot, /YouTube turns it down/);
  assert.match(hot, /true peak over -1 dBTP/);
  assert.match(hot, /LU over audio\.json lufs \(-14\)/);
  const soft = report(quiet, -14);
  assert.match(soft, /never turns it up/);
  assert.doesNotMatch(soft, /true peak over/);
});

test("listen flags a sound effect that barely rises over the bed it lands on, and not one that cuts through", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const voice = join(dir, "voice.wav"),
    rest = join(dir, "rest.wav");
  tone(voice, "0");
  // a steady bed; a thud at 2 s about as loud as it, a slam at 5 s far over it
  tone(
    rest,
    "0.05*sin(2*PI*200*t)+0.04*sin(2*PI*90*t)*between(t\\,2\\,2.5)+0.6*sin(2*PI*90*t)*between(t\\,5\\,5.5)",
  );
  const r = spawnSync(
    "python",
    [
      "-c",
      `import json, sys; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import analyse; print(json.dumps(analyse(sys.argv[1], sys.argv[2], [], [(2.0, 0.5, "thud"), (5.0, 0.5, "slam")])))`,
      voice,
      rest,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepEqual(
    got.buried.map((b) => b.name),
    ["thud"],
  );
  assert.ok(got.buried[0].rise < 6);
});

test("listen --at shows the levels around one second, half a second at a time, next to the last listen's", () => {
  // the rest steps down 10 dB at 35 s; the last listen had it level at -10 throughout
  const curve = Array.from({ length: 500 }, (_, i) => {
    const t = +(i * 0.1).toFixed(1);
    return [t, -20, t < 35 ? -10 : -20];
  });
  const last = curve.map(([t]) => [t, -20, -10]);
  const r = spawnSync(
    "python",
    [
      "-c",
      `import json, sys; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import levels_around; print(json.dumps(levels_around(json.loads(sys.argv[1]), 35.0, json.loads(sys.argv[2]))))`,
      JSON.stringify(curve),
      JSON.stringify(last),
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.deepEqual(
    rows.map((x) => x.from),
    [33, 33.5, 34, 34.5, 35, 35.5, 36, 36.5],
  );
  const before = rows.find((x) => x.from === 34),
    after = rows.find((x) => x.from === 35.5);
  assert.deepEqual([before.voice, before.rest, before.margin, before.was], [-20, -10, -10, -10]);
  assert.deepEqual([after.voice, after.rest, after.margin, after.was], [-20, -20, 0, -10]);
});

test("listen hears a line the bed drowns and a line it leaves clear, and the jump at a cut", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const voice = join(dir, "voice.wav"),
    rest = join(dir, "rest.wav");
  // the narration speaks 1-3 s and 5-7 s; the bed whispers under the first line and matches the second
  tone(voice, "0.1*sin(2*PI*1000*t)*(between(t\\,1\\,3)+between(t\\,5\\,7))");
  tone(rest, "0.001*sin(2*PI*300*t)+0.1*sin(2*PI*300*t)*between(t\\,5\\,7)");
  const r = spawnSync(
    "python",
    [
      "-c",
      `import json, sys; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import analyse; print(json.dumps(analyse(sys.argv[1], sys.argv[2], [5.0])))`,
      voice,
      rest,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepEqual(
    got.lines.map((l) => [Math.round(l.from), Math.round(l.to), l.verdict]),
    [
      [1, 3, "clear"],
      [5, 7, "lost"],
    ],
  );
  assert.equal(got.jumps.length, 1);
  assert.ok(got.jumps[0].change > 6);
});

test("a stretch louder than the narration says whether the voice was speaking under it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const voice = join(dir, "voice.wav"),
    rest = join(dir, "rest.wav");
  // the narration speaks 1-3 s; the rest swells over its level at 2 s, under it, and again at 5-6 s, with nothing said
  tone(voice, "0.05*sin(2*PI*1000*t)*between(t\\,1\\,3)");
  tone(rest, "0.5*sin(2*PI*300*t)*(between(t\\,2\\,2.6)+between(t\\,5\\,6))");
  const r = spawnSync(
    "python",
    [
      "-c",
      `import json, sys; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import analyse; print(json.dumps(analyse(sys.argv[1], sys.argv[2])))`,
      voice,
      rest,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  const over = JSON.parse(r.stdout).over;
  assert.deepEqual(
    over.map((x) => [Math.round(x.to), x.speaking]),
    [
      [3, true],
      [6, false],
    ],
  );
});

test("a sound that cancels itself when a phone plays the mix in one speaker is named with its seconds, a wide one is not", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const voice = join(dir, "voice.wav"),
    rest = join(dir, "rest.wav");
  // the narration sits in the middle 1-3 s; the bed is wide all along (each side its own), and 4-6 s one side is the other upside down
  tone(voice, "0.1*sin(2*PI*1000*t)*between(t\\,1\\,3)|0.1*sin(2*PI*1000*t)*between(t\\,1\\,3)");
  tone(
    rest,
    "0.05*sin(2*PI*300*t)+0.1*sin(2*PI*500*t)*between(t\\,4\\,6)|0.05*sin(2*PI*310*t)-0.1*sin(2*PI*500*t)*between(t\\,4\\,6)",
  );
  const r = spawnSync(
    "python",
    [
      "-c",
      `import json, sys; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import mono; print(json.dumps(mono(sys.argv[1], sys.argv[2])))`,
      voice,
      rest,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.deepEqual(
    got.stretches.map((s) => [s.stem, Math.round(s.from), Math.round(s.to)]),
    [["rest", 4, 6]],
  );
  assert.ok(got.stretches[0].loss > 6);
  assert.ok(Math.abs(got.voice) < 0.5, `the voice keeps its level: ${got.voice}`);
});
