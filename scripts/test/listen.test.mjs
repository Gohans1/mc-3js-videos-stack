import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// ffmpeg-normalize once fell back to dynamic loudnorm on a mix whose peaks stood far over its loudness, lifting every quiet
// stretch and still leaving +0.5 dBTP after the AAC encode (AES TD1004 6a: raise linearly to the target or the peak ceiling)
test("the loudness pass raises a mix linearly to its target, or only as far as its true peaks allow, and says which lever is left", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "level-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const level = (src, target) => {
    const out = src.replace(/\.wav$/, "_out.wav");
    const r = spawnSync(
      "python",
      [
        "-c",
        `import sys, json; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import level, loudness, loudness_report
held = level(sys.argv[1], sys.argv[2], float(sys.argv[3]))
i, lra, tp = loudness(sys.argv[2])
print(json.dumps({"held": held, "i": i, "tp": tp, "report": loudness_report(sys.argv[2], float(sys.argv[3]), held)}))`,
        src,
        out,
        String(target),
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const even = join(dir, "even.wav"),
    spiky = join(dir, "spiky.wav");
  tone(even, "0.05*sin(2*PI*440*t)");
  // a quiet bed with one hit 26 dB over it: no linear gain reaches -14 LUFS under the ceiling
  tone(spiky, "0.03*sin(2*PI*440*t)+between(t\\,4\\,4.05)*0.6*sin(2*PI*900*t)");

  const plain = level(even, -14);
  assert.equal(plain.held, 0);
  assert.ok(Math.abs(plain.i + 14) < 0.3, `reached -14: ${plain.i}`);

  const hit = level(spiky, -14);
  assert.ok(hit.held > 1, `held back: ${hit.held}`);
  assert.ok(hit.tp <= -1.4, `peak under the ceiling: ${hit.tp}`);
  assert.ok(Math.abs(hit.i + 14 + hit.held) < 0.3, `short of -14 by what it says: ${hit.i}`);
  assert.match(
    hit.report.join("\n"),
    /stopped \d+\.\d dB short so its true peak stays under -1\.5 dBTP/,
  );
  assert.doesNotMatch(hit.report.join("\n"), /lufs -14 is what it plays at/);

  // the lever said as the value to write, never past the +12 bun run check warns at (a probe read "+10" as "set to 10")
  const advice = (held, drive) => {
    const r = spawnSync(
      "python",
      [
        "-c",
        `import sys; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import loudness_report; print("\\n".join(loudness_report(sys.argv[1], -14, ${held}, ${drive})))`,
        even.replace(/\.wav$/, "_out.wav"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  assert.match(advice(1.5, 0), /louder: set audio\.json drive to 5 \(now 0\)/);
  assert.match(
    advice(3.1, 9),
    /set audio\.json drive to 12 \(now 9\), the most before the hits flatten/,
  );
  // on sealed-room the narration 3 dB up bought 0.2 LU (its own limiter holds it): only drive closes the gap to the peaks
  assert.match(
    advice(2, 12),
    /louder: drive is at \+12, the most before bun run check warns the hits flatten\. Either leave it \(the upload plays 2\.0 dB under audio\.json lufs, nothing else wrong\) or raise drive past 12 and listen whether the hits still land/,
  );
  // within YouTube's 1 LU the loudness is ready: no lever to pull
  assert.doesNotMatch(advice(0.6, 0), /stopped/);
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

// a probe's copy lost one row's gain: both crashed in a Python traceback, though bun run check names the fault
test("a row that lacks what the mix reads stops mix and listen with the command that names it, no traceback", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unfit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ end: 2, voice: { warp: [], lines: [] } }),
  );
  writeFileSync(join(dir, "src/scene.ts"), "");
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify({
      beds: [{ name: "tone", from: 0, to: 1, fadeIn: 0, fadeOut: 0 }],
      sfx: [],
      voice: false,
      lufs: -14,
    }),
  );
  tone(join(dir, "sound/sfx/tone.wav"), "0.1*sin(2*PI*440*t)");
  for (const script of ["mix.py", "listen.py"]) {
    const r = spawnSync("python", [join(SOUND, script)], {
      cwd: dir,
      encoding: "utf8",
      timeout: 120000,
    });
    assert.equal(r.status, 1, `${script}: ${r.stdout}${r.stderr}`);
    assert.match(
      r.stderr,
      /src\/timeline\/audio\.json: beds\[0\] has no gain: bun run check names every fault/,
    );
    assert.doesNotMatch(r.stderr, /Traceback/);
  }
});

test("mix given a video that is not there did nothing: exit 2, naming the videos it could take", () => {
  const dir = mkdtempSync(join(tmpdir(), "mix-novideo-"));
  const r = spawnSync("python", [join(SOUND, "mix.py"), "renders/nope.mp4"], {
    cwd: dir,
    encoding: "utf8",
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no renders\/nope\.mp4 \(the videos here: none yet\)/);
});

// a mix stopped at the -1.5 dBTP ceiling still went out at -0.9 after the AAC encode (probe R7): the encoded file is measured.
// Square bursts overshoot at 96 kbps: at 900 Hz the mix is held at the ceiling, at 7 kHz it reaches -14 and still overshoots
test("a mix put on a video is measured after the AAC encode, and lowered by what the codec added when that crosses -1 dBTP", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "encoded-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const hz of [900, 7000]) {
    const raw = join(dir, `raw${hz}.wav`);
    tone(raw, `0.03*sin(2*PI*440*t)+between(t\\,4\\,4.05)*0.6*sgn(sin(2*PI*${hz}*t))`);
    const r = spawnSync(
      "python",
      [
        "-c",
        `import sys, json, subprocess; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import fit_encoded, loudness
def encode(wav):
    m = wav.replace(".wav", ".m4a")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", "96k", m], check=True)
    return m
out = sys.argv[1].replace("raw", "out")
held, taken = fit_encoded(sys.argv[1], out, -14, encode)
print(json.dumps({"taken": taken, "tp": loudness(out.replace(".wav", ".m4a"))[2]}))`,
        raw,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout);
    assert.ok(got.taken > 0, `${hz} Hz: the codec pushed the peak over -1 first: ${r.stdout}`);
    assert.ok(got.tp <= -1, `${hz} Hz: the encoded file ends at or under -1 dBTP: ${got.tp}`);
  }
});
