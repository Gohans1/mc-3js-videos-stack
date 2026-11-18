import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOUND = resolve(dirname(fileURLToPath(import.meta.url)), "../sound");

test("partial narration alternatives stay in the voice stem and out of SFX hits", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-partial-voice-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ["narr", "alt"])
    makeWav(join(dir, `sound/sfx/${name}.wav`), "0.2*sin(2*PI*440*t)", 1);
  writeFilm(dir, {
    audio: {
      narration: "narr",
      beds: [],
      sfx: [
        { name: "narr", at: 0, length: 0.5, gain: 0, try: ["alt"] },
        { name: "narr", at: 2, length: 0.5, gain: 0 },
      ],
    },
  });
  writeFileSync(join(dir, "choices.json"), JSON.stringify({ narr: { set: "alt" } }));
  const r = spawnSync(
    "python",
    [
      "-c",
      `import sys,pathlib,json,subprocess,array,math
sys.path.insert(0,sys.argv[1])
import listen
out=pathlib.Path('stems'); out.mkdir()
voice,rest,hits=listen.stems(out)
def rms(file):
    raw=subprocess.run(['ffmpeg','-v','error','-i',str(file),'-ss','0.1','-t','0.2','-ac','1','-f','f32le','-'],capture_output=True,check=True,timeout=20).stdout
    samples=array.array('f'); samples.frombytes(raw)
    return math.sqrt(sum(x*x for x in samples)/len(samples))
print(json.dumps({'voice':rms(voice),'rest':rms(rest),'hits':hits}))`,
      SOUND,
    ],
    { cwd: dir, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.ok(got.voice > 0.05);
  assert.ok(got.rest < 1e-5);
  assert.deepEqual(got.hits, []);
});

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

// listen's numbers are levels only: what is heard there, and whether hits land on the cuts, is earshot's to say
test("listen --at hands over the earshot timeline of the same stretch of the draft with sound", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-at-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const python = Bun.which("python");
  const focus = (env = process.env) =>
    spawnSync(
      python,
      [
        "-c",
        `import sys; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import focus; focus({"curve": [(30 + i / 10, -20, -30) for i in range(100)], "lines": [], "over": [], "buried": []}, 35.0, None, [])`,
      ],
      { cwd: dir, encoding: "utf8", env },
    );
  // a machine without earshot is told how to set it up, not handed a command that fails
  const deaf = focus({ ...process.env, PATH: dirname(process.execPath) });
  assert.equal(deaf.status, 0, deaf.stderr);
  assert.doesNotMatch(deaf.stdout, /earshot timeline/);
  assert.match(deaf.stdout, /earshot is not on PATH[^\n]*INSTALL\.md/);
  const none = focus();
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /no mixed draft; bun run mix renders\/draft_video\.mp4/);
  mkdirSync(join(dir, "renders"));
  const draft = join(dir, "renders/draft.mp4");
  const encoded = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=f=997:d=36",
    "-c:a",
    "aac",
    draft,
  ]);
  assert.equal(encoded.status, 0, String(encoded.stderr));
  const r = focus();
  assert.match(r.stdout, /earshot timeline renders\/draft\.mp4 --from 33 --to 36 --detail low/);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/edit.json"), "{}");
  utimesSync(draft, 1000, 1000);
  const stale = focus();
  assert.match(stale.stdout, /Rendered audio follow-up unavailable: .*older than src\/edit\.json/);
  assert.doesNotMatch(stale.stdout, /earshot timeline/);
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
  // only a picture render takes a mix: deliver's youtube_preview.mp4 or a mixed draft.mp4 is not one
  mkdirSync(join(dir, "renders"));
  for (const f of ["draft_video.mp4", "draft.mp4", "youtube_preview.mp4"])
    writeFileSync(join(dir, "renders", f), "x");
  const r = spawnSync("python", [join(SOUND, "mix.py"), "renders/nope.mp4"], {
    cwd: dir,
    encoding: "utf8",
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no renders\/nope\.mp4 \(the pictures here: renders\/draft_video\.mp4\)/);
});

test("mix given a video that already has sound did nothing: exit 2, naming the picture-only renders", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mix-sound-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders"));
  const picture = ["-f", "lavfi", "-i", "color=c=black:s=64x64:d=1"];
  const sound = ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1"];
  const made = spawnSync("ffmpeg", [
    "-v",
    "error",
    ...picture,
    ...sound,
    join(dir, "renders/before.mp4"),
  ]);
  assert.equal(made.status, 0, String(made.stderr));
  writeFileSync(join(dir, "renders/draft_video.mp4"), "x");
  const r = spawnSync("python", [join(SOUND, "mix.py"), "renders/before.mp4"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /renders\/before\.mp4 already has sound[^\n]*renders\/draft_video\.mp4/);
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
held, taken, _, _ = fit_encoded(sys.argv[1], out, -14, encode)
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

const writeFilm = (dir, { end = 4, pkg = {}, audio, timing, edit } = {}) => {
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "renders"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "");
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify(edit ?? { end, voice: { warp: [], lines: [] } }),
  );
  writeFileSync(
    join(dir, "src/timeline/audio.json"),
    JSON.stringify(audio ?? { lufs: -14, drive: 0, voice: false, beds: [], sfx: [] }),
  );
  if (timing !== undefined) {
    writeFileSync(join(dir, "src/timeline/timing.json"), JSON.stringify(timing));
  }
};

const runListen = (cwd, args = [], env = process.env) =>
  spawnSync("python", [join(SOUND, "listen.py"), ...args], {
    cwd,
    encoding: "utf8",
    env,
  });

const makeWav = (file, expr, dur = 4) => {
  mkdirSync(dirname(file), { recursive: true });
  const r = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${expr}:s=48000:c=stereo:d=${dur}`,
    "-c:a",
    "pcm_s16le",
    file,
  ]);
  assert.equal(r.status, 0, String(r.stderr));
};

test("listen CLI arg validation exits 0 for help anywhere and 2 for invalid flags, seconds, or cwd before stems", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = spawnSync(
    "python",
    [
      "-c",
      `import sys; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import main
assert main(["--fresh", "--help"]) == 0
for args in (["--bogus"], ["-x"], ["--at"], ["--at", "abc"], ["--at", "-1"], ["--at", "#1"], ["--at", "1:75"], ["extra"], []):
    assert main(args) == 2, args`,
    ],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
});

test("listen honors custom live-studio.soundTimeline and exits 2 before stems when missing or --at is past end", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-custom-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFilm(dir, {
    end: 2,
    pkg: { name: "custom", "live-studio": { soundTimeline: "custom/audio.json" } },
  });
  rmSync(join(dir, "src/timeline/audio.json"));
  const missing = runListen(dir, []);
  assert.equal(missing.status, 2, missing.stderr);
  assert.match(missing.stderr, /custom\/audio\.json/);

  mkdirSync(join(dir, "custom"), { recursive: true });
  writeFileSync(
    join(dir, "custom/audio.json"),
    JSON.stringify({ lufs: -14, drive: 0, voice: false, beds: [], sfx: [] }),
  );
  const past = runListen(dir, ["--at", "9"]);
  assert.equal(past.status, 2, past.stderr);
  assert.equal(existsSync(join(dir, "renders/listen_stems")), false);

  const ok = runListen(dir, []);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(
    JSON.parse(readFileSync(join(dir, "renders/listen.json"), "utf8")).abrupt_end,
    false,
  );
});

test("listen rejects broken film JSON cleanly with file location and no traceback", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-json-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, rel] of [
    ["pkg", "package.json"],
    ["audio", "src/timeline/audio.json"],
    ["edit", "src/edit.json"],
    ["choices", "choices.json"],
    ["timing", "src/timeline/timing.json"],
  ]) {
    const f = join(dir, name);
    writeFilm(f, {
      pkg: { name: "j", "live-studio": { timingTimeline: "src/timeline/timing.json" } },
      timing: { cuts: [], speeds: [], freezes: [] },
    });
    writeFileSync(join(f, rel), "{bad");
    const r = runListen(f, []);
    assert.equal(r.status, 1, `${name}: ${r.stderr}`);
    assert.match(r.stderr, /not valid JSON/);
    assert.doesNotMatch(r.stderr, /Traceback/);
  }
});

test("listen warns and ignores corrupt cuts.json or listen_curve.json without tracebacks", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-bad-cuts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFilm(dir, { end: 1 });
  writeFileSync(join(dir, "renders/draft_video.mp4"), "picture metadata test");
  writeFileSync(join(dir, "renders/cuts.json"), "[true]");
  writeFileSync(join(dir, "renders/listen_curve.json"), "{bad");
  const badCuts = runListen(dir, []);
  assert.equal(badCuts.status, 0, badCuts.stderr);
  assert.doesNotMatch(badCuts.stderr, /Traceback/);
  assert.match(badCuts.stdout, /no renders\/cuts\.json/);
});

test("listen omits the missing-cuts notice when renders/cuts.json is validly empty []", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-empty-cuts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFilm(dir, { end: 1 });
  writeFileSync(join(dir, "renders/cuts.json"), "[]");
  writeFileSync(join(dir, "renders/draft_video.mp4"), "picture metadata test");
  utimesSync(join(dir, "renders/cuts.json"), 1000, 1000);
  const emptyCuts = runListen(dir, []);
  assert.equal(emptyCuts.status, 0, emptyCuts.stderr);
  assert.doesNotMatch(emptyCuts.stdout, /no renders\/cuts\.json/);
});

test("listen respects timing cuts, start/rate hits, and muted tracks without negative stretches", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-timing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  makeWav(join(dir, "sound/sfx/bed.wav"), "0.08*sin(2*PI*300*t)", 4);
  makeWav(join(dir, "sound/sfx/gone.wav"), "0.25*sin(2*PI*600*t)", 0.4);
  makeWav(join(dir, "sound/sfx/hit.wav"), "0.25*sin(2*PI*600*t)", 3);
  makeWav(
    join(dir, "assets/public/agent/full_voice.wav"),
    "0.1*sin(2*PI*1000*t)*between(t\\,2.0\\,3.2)",
    4,
  );
  writeFilm(dir, {
    end: 4,
    pkg: {
      name: "t",
      "live-studio": {
        soundTimeline: "src/timeline/audio.json",
        timingTimeline: "src/timeline/timing.json",
      },
    },
    timing: { cuts: [{ from: 0.4, to: 1.4 }], speeds: [], freezes: [] },
    audio: {
      lufs: -14,
      drive: 0,
      voice: true,
      tracks: [{ id: "t1" }, { id: "t_mute", mute: true }, { id: "t2" }],
      beds: [
        { name: "bed", from: 0, to: 4, gain: -10, fadeIn: 0, fadeOut: 0.2, track: "t1" },
        { name: "bed", from: 0, to: 4, gain: 0, fadeIn: 0, fadeOut: 0, track: "t_mute" },
      ],
      sfx: [
        { name: "gone", at: 0.6, gain: 0, track: "t2" },
        { name: "hit", at: 2.5, start: 1.0, rate: 2.0, gain: -20, track: "t2" },
        { name: "hit", at: 4.5, gain: 0, track: "t2" },
      ],
    },
  });

  const first = runListen(dir, []);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /beds\[0\] bed/);
  assert.doesNotMatch(first.stdout, /beds\[1\]/);
  assert.doesNotMatch(first.stdout, /-\d+\.\d{2}-/);
  const stamp = JSON.parse(readFileSync(join(dir, "renders/listen_stems/stamp.json"), "utf8"));
  assert.equal(stamp.hits.length, 1);
  assert.equal(stamp.hits[0][2], "hit");
  assert.ok(
    Math.abs(stamp.hits[0][1] - 1.0) < 1e-6,
    `expected (3-1)/2 = 1.0, got ${stamp.hits[0][1]}`,
  );
});

test("listen kept_stems ignores sound/mix.wav", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-cache-mix-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  makeWav(join(dir, "sound/sfx/hit.wav"), "0.25*sin(2*PI*600*t)", 1);
  writeFilm(dir, {
    end: 2,
    audio: {
      lufs: -14,
      drive: 0,
      voice: false,
      beds: [],
      sfx: [{ name: "hit", at: 0.2, gain: 0 }],
    },
  });

  const r1 = runListen(dir, ["--at", "0.5"]);
  assert.equal(r1.status, 0, r1.stderr);

  writeFileSync(join(dir, "sound/mix.wav"), "x");
  const r2 = runListen(dir, ["--at", "0.5"]);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stderr, /unchanged since the last listen/);
});

test("listen --fresh retains the last usable stems if a source fails to decode", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-fresh-corrupt-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wav = join(dir, "sound/sfx/hit.wav");
  makeWav(wav, "0.25*sin(2*PI*600*t)", 1.2);
  writeFilm(dir, {
    end: 2,
    audio: { voice: false, beds: [], sfx: [{ name: "hit", at: 0.2, gain: 0 }] },
  });
  const prior = runListen(dir, ["--at", "1"]);
  assert.equal(prior.status, 0, prior.stdout + prior.stderr);
  const files = ["voice.wav", "rest.wav", "stamp.json"];
  const readStems = () =>
    files.map((file) => readFileSync(join(dir, "renders/listen_stems", file)));
  const saved = readStems();
  const wave = readFileSync(wav);
  writeFileSync(wav, wave.subarray(0, Math.floor(wave.length * 0.62)));
  const failed = runListen(dir, ["--fresh", "--at", "1"]);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /corrupt input packet/);
  assert.deepEqual(readStems(), saved);
});

test("listen kept_stems invalidates when choices.json changes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-cache-choice-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  makeWav(join(dir, "sound/sfx/hit.wav"), "0.25*sin(2*PI*600*t)", 1);
  writeFilm(dir, {
    end: 2,
    audio: {
      lufs: -14,
      drive: 0,
      voice: false,
      beds: [],
      sfx: [{ name: "hit", at: 0.2, gain: 0 }],
    },
  });

  const r1 = runListen(dir, ["--at", "0.5"]);
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(
    JSON.parse(readFileSync(join(dir, "renders/listen_stems/stamp.json"), "utf8")).hits.length,
    1,
  );

  writeFileSync(join(dir, "choices.json"), JSON.stringify({ hit: { set: "off" } }));
  const r2 = runListen(dir, ["--at", "0.5"]);
  assert.equal(r2.status, 0, r2.stderr);
  assert.doesNotMatch(r2.stderr, /unchanged since the last listen/);
  assert.equal(
    JSON.parse(readFileSync(join(dir, "renders/listen_stems/stamp.json"), "utf8")).hits.length,
    0,
  );
});

test("a short SFX window reports actual peaks without inventing integrated loudness", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-short-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  makeWav(join(dir, "sound/sfx/hit.wav"), "0.25*sin(2*PI*660*t)", 0.12);
  writeFilm(dir, {
    end: 0.3,
    audio: {
      voice: false,
      beds: [],
      sfx: [{ name: "hit", at: 0.252, gain: 0 }],
    },
  });
  const focused = runListen(dir, ["--at", "0.265"]);
  assert.equal(focused.status, 0, focused.stdout + focused.stderr);
  assert.match(focused.stdout, /0-0\.3 s, 400 ms loudness window unavailable/);
  assert.match(focused.stdout, /voice silent, rest -\d+(?:\.\d+) dBTP/);
  const whole = runListen(dir, []);
  assert.equal(whole.status, 0, whole.stdout + whole.stderr);
  const report = JSON.parse(readFileSync(join(dir, "renders/listen.json"), "utf8"));
  assert.equal(report.duration, 0.3);
  assert.ok(Number.isFinite(report.shortWindow.restPeakDbtp));
});

test("listen includes sound in partial bins at both ends of the film", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-partial-bins-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  makeWav(join(dir, "sound/sfx/hit.wav"), "0.5*sin(2*PI*660*t)", 0.09);
  writeFilm(dir, {
    end: 2.05,
    audio: {
      voice: false,
      beds: [],
      sfx: [0.014, 2.016].map((at) => ({ name: "hit", at, gain: 0 })),
    },
  });
  const opening = runListen(dir, ["--at", "0.48"]);
  assert.equal(opening.status, 0, opening.stdout + opening.stderr);
  assert.match(opening.stdout, /0-0\.48  voice silent  rest\s+-\d/);
  const ending = runListen(dir, ["--at", "2.026"]);
  assert.equal(ending.status, 0, ending.stdout + ending.stderr);
  assert.match(ending.stdout, /2\.026-2\.05  voice silent  rest\s+-\d/);
  assert.doesNotMatch(ending.stdout, /2\.026-2\.526/);
});

test("listen --at clamps out-of-film bins and shorter last curves", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-bounds-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const curve = Array.from({ length: 40 }, (_, i) => [+(i * 0.1).toFixed(1), -20, -25]);
  const rWas = spawnSync(
    "python",
    [
      "-c",
      `import json, sys; sys.path.insert(0, ${JSON.stringify(SOUND)}); from listen import levels_around; print(json.dumps(levels_around(json.loads(sys.argv[1]), 5.0, json.loads(sys.argv[2]))))`,
      JSON.stringify(Array.from({ length: 80 }, (_, i) => [+(i * 0.1).toFixed(1), -20, -25])),
      JSON.stringify(curve),
    ],
    { encoding: "utf8" },
  );
  assert.equal(rWas.status, 0, rWas.stderr);
  const wasRows = JSON.parse(rWas.stdout);
  assert.ok(wasRows.filter((row) => row.from < 4).every((row) => row.was === -25));
  assert.ok(wasRows.filter((row) => row.from >= 4).every((row) => row.was === null));

  makeWav(join(dir, "sound/sfx/bed.wav"), "0.08*sin(2*PI*300*t)", 3);
  writeFilm(dir, {
    end: 3,
    audio: {
      lufs: -14,
      drive: 0,
      voice: false,
      beds: [{ name: "bed", from: 0, to: 3, gain: -12, fadeIn: 0, fadeOut: 0 }],
      sfx: [],
    },
  });
  writeFileSync(join(dir, "renders/listen_curve.json"), JSON.stringify(curve.slice(0, 10)));
  const at0 = runListen(dir, ["--at", "0"]);
  assert.equal(at0.status, 0, at0.stderr);
  assert.doesNotMatch(at0.stdout, /-0\.50-/);
  const atEnd = runListen(dir, ["--at", "3"]);
  assert.equal(atEnd.status, 0, atEnd.stderr);
  assert.doesNotMatch(atEnd.stdout, /was -120\.0/);
  assert.doesNotMatch(atEnd.stdout, /3\.00-3\.50/);
});

test("listen failed builds close build.log on Windows and end the studio job with level fail", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "listen-fail-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const events = [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      events.push(JSON.parse(body));
      res.end("{}");
    });
  });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  t.after(() => srv.close());

  writeFilm(dir, {
    end: 2,
    audio: {
      lufs: -14,
      drive: 0,
      voice: false,
      beds: [{ name: "missing_sound", from: 0, to: 2, gain: -10, fadeIn: 0, fadeOut: 0 }],
      sfx: [],
    },
  });
  const port = srv.address().port;
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(join(dir, "renders/live/studio.json"), JSON.stringify({ port }));
  const failRun = await new Promise((resolveRun, rejectRun) => {
    const child = spawn("python", [join(SOUND, "listen.py")], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", rejectRun);
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
  assert.equal(failRun.status, 1, failRun.stderr);
  assert.doesNotMatch(failRun.stderr, /Traceback|PermissionError/);
  assert.ok(
    events.length >= 2 && events.at(-1).job?.end === true && events.at(-1).level === "fail",
    `expected job fail events, got ${JSON.stringify(events)}`,
  );
});
