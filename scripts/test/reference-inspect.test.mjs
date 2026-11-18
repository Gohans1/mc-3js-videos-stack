import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { mediaFixture } from "./media-fixture.mjs";

const cli = resolve(import.meta.dirname, "../review/reference.mjs");
const media = mediaFixture();
const fixture = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "reference-inspect-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const video = join(dir, "reference with spaces.mkv");
  media(video, [
    "-f",
    "lavfi",
    "-i",
    "color=red:s=320x180:r=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=320x180:r=30:d=3",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0",
    "-c:v",
    "ffv1",
  ]);
  const run = (...args) =>
    spawnSync(process.execPath, [cli, "inspect", video, ...args], {
      cwd: dir,
      encoding: "utf8",
      timeout: 25000,
    });
  return { dir, video, run };
};
const resultOf = (r) => {
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const path = /^index: (.+)$/m.exec(r.stdout)?.[1].trim();
  assert.ok(path, r.stdout);
  return { path, data: JSON.parse(readFileSync(path, "utf8")) };
};

test("reference evidence preserves raw overlapping captions, fractional source times and pinned pictures", (t) => {
  const f = fixture(t);
  const transcript = join(f.dir, "dialogue.vtt");
  const raw =
    "WEBVTT\n\n00:00.125 --> 00:01.500\n<v Steve>Door!\n\n00:00.250 --> 00:01.000\n<v Alex>Door!\n\n00:02.100 --> 00:03.200\nDoor!\n";
  writeFileSync(transcript, raw);
  const { data } = resultOf(
    f.run(
      "--transcript",
      transcript,
      "--at",
      "0.25,0.9999995,1,1.25",
      "--frames",
      "4",
      "--find",
      "door",
    ),
  );
  assert.equal(data.complete, true);
  assert.equal(data.source.clock, "source");
  assert.equal(data.source.path, f.video);
  assert.equal(readFileSync(data.transcript.raw, "utf8"), raw);
  const words = JSON.parse(readFileSync(data.transcript.path, "utf8"));
  assert.equal(words.segments.length, 3);
  assert.deepEqual(
    words.segments.map((s) => s.start),
    [0.125, 0.25, 2.1],
  );
  assert.match(words.segments[0].text, /Steve/);
  assert.match(words.segments[1].text, /Alex/);
  assert.equal(data.transcript.matches.length, 3);
  assert.ok(data.transcript.matches.every((m) => m.commands.frames.argv.includes("inspect")));
  const followArgs = data.transcript.matches[0].commands.frames.argv;
  assert.equal(followArgs[followArgs.indexOf("--transcript") + 1], data.transcript.raw);
  assert.deepEqual(
    data.entries.filter((e) => e.reasons.includes("explicit")).map((e) => e.requestedTime),
    [0.25, 0.9999995, 1, 1.25],
  );
  assert.equal(data.entries.length, 4);
  for (const entry of data.entries) {
    assert.ok(existsSync(entry.frame));
    assert.ok(Number.isFinite(entry.sourceTime));
    assert.ok(!entry.commands.at);
  }
  const frameRgb = (entry) => [
    ...spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        entry.frame,
        "-vf",
        "scale=1:1",
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
      ],
      { timeout: 10000 },
    ).stdout.subarray(0, 3),
  ];
  assert.ok(frameRgb(data.entries.find((e) => e.requestedTime === 0.25))[0] > 220);
  assert.ok(frameRgb(data.entries.find((e) => e.requestedTime === 0.9999995))[0] > 220);
  assert.ok(frameRgb(data.entries.find((e) => e.requestedTime === 1))[2] > 220);
  assert.ok(frameRgb(data.entries.find((e) => e.requestedTime === 1.25))[2] > 220);
});

test("retained frame and inspection commands refuse a replaced reference video", (t) => {
  const f = fixture(t);
  const transcript = join(f.dir, "speech.srt");
  writeFileSync(transcript, "1\n00:00:00,500 --> 00:00:01,500\nGate opens\n");
  const { data } = resultOf(f.run("--transcript", transcript, "--find", "Gate", "--frames", "1"));
  const replay = (argv) =>
    spawnSync(argv[0], argv.slice(1), { cwd: f.dir, encoding: "utf8", timeout: 25_000 });
  const frame = data.transcript.matches[0].commands.frames.argv;
  assert.equal(resultOf(replay(frame)).data.entries[0].transcript[0].text, "Gate opens");
  media(f.video, ["-f", "lavfi", "-i", "color=white:s=320x180:r=30:d=4", "-c:v", "ffv1"]);
  for (const argv of [frame, data.commands.inspect.argv]) {
    const replaced = replay(argv);
    assert.notEqual(replaced.status, 0, replaced.stdout + replaced.stderr);
    assert.match(replaced.stderr, /source SHA-256 mismatch/);
  }
});

test("a held frame retains the cue at requested time and only offers valid picture pins", (t) => {
  const f = fixture(t);
  const video = join(f.dir, "held.mp4");
  media(video, [
    "-itsoffset",
    "1",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x90:r=4:d=1,select='not(mod(n,2))',setpts=4*PTS",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=d=4",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
  ]);
  const transcript = join(f.dir, "speech.vtt");
  writeFileSync(
    transcript,
    "WEBVTT\n\n00:00.250 --> 00:00.750\nGate opening before picture\n\n00:00.800 --> 00:01.350\nGate overlap\n\n00:02.600 --> 00:02.900\nGate during held frame\n",
  );
  const r = spawnSync(
    process.execPath,
    [
      cli,
      "inspect",
      video,
      "--transcript",
      transcript,
      "--at",
      "2.8",
      "--frames",
      "1",
      "--find",
      "Gate",
    ],
    { cwd: f.dir, encoding: "utf8", timeout: 30_000 },
  );
  const { data } = resultOf(r);
  assert.equal(data.entries[0].sourceTime, 1);
  assert.deepEqual(
    data.entries[0].transcript.map((c) => c.text),
    ["Gate during held frame"],
  );
  const [before, overlap] = data.transcript.matches;
  assert.equal(before.commands, undefined);
  assert.match(before.visualReason, /outside the selected picture range/);
  const argv = overlap.commands.frames.argv;
  assert.equal(argv[argv.indexOf("--at") + 1], "1");
});

test("focused reference evidence keeps source offsets, raw text and previous runs", (t) => {
  const f = fixture(t);
  const transcript = join(f.dir, "speech.srt");
  writeFileSync(
    transcript,
    "1\n00:00:00,125 --> 00:00:00,500\nOutside\n\n2\n00:00:02,125 --> 00:00:02,500\nInside\n",
  );
  const first = resultOf(
    f.run(
      "--transcript",
      transcript,
      "--start",
      "2",
      "--end",
      "3",
      "--at",
      "2.25",
      "--frames",
      "3",
    ),
  );
  assert.equal(first.data.entries.find((e) => e.reasons.includes("explicit")).sourceTime, 2.233);
  assert.deepEqual(first.data.range, { start: 2, end: 3 });
  assert.equal(first.data.transcript.count, 1);
  const second = resultOf(f.run("--frames", "2"));
  assert.notEqual(first.path, second.path);
  assert.ok(existsSync(first.data.entries[0].frame));
  assert.equal(readFileSync(transcript, "utf8").includes("Outside"), true);
  assert.equal(second.data.transcript.status, "missing");
});

test("an opening transcript match can replay the first printable time of delayed picture", (t) => {
  const f = fixture(t);
  const video = join(f.dir, "late-picture.mp4");
  media(video, [
    "-f",
    "lavfi",
    "-i",
    "color=red:s=320x180:r=25:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=444:sample_rate=48000:d=2",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-output_ts_offset",
    "5",
  ]);
  const transcript = join(f.dir, "opening.srt");
  writeFileSync(transcript, "1\n00:00:00,000 --> 00:00:00,700\nOpening cue\n");
  const { data } = resultOf(
    spawnSync(
      process.execPath,
      [
        cli,
        "inspect",
        video,
        "--transcript",
        transcript,
        "--find",
        "opening",
        "--detail",
        "transcript",
      ],
      { cwd: f.dir, encoding: "utf8", timeout: 25_000 },
    ),
  );
  assert.equal(data.visual.status, "skipped");
  assert.deepEqual(data.entries, []);
  const [bun, ...args] = data.transcript.matches[0].commands.frames.argv;
  const { data: reopened } = resultOf(
    spawnSync(bun, args, {
      cwd: f.dir,
      encoding: "utf8",
      timeout: 25_000,
    }),
  );
  assert.equal(reopened.entries[0].requestedTime, 0.021333);
  assert.ok(Math.abs(reopened.entries[0].sourceTime - 0.021333) < 0.000001);
  assert.equal(reopened.entries[0].transcript[0].text, "Opening cue");
  const sheet = resolve(import.meta.dirname, "../review/sheet.py");
  const frame = resultOf(
    spawnSync("python", [sheet, video, "frames", "0.021333"], {
      cwd: f.dir,
      encoding: "utf8",
      timeout: 25_000,
    }),
  ).data;
  assert.ok(Math.abs(frame.entries[0].sourceTime - 0.021333) < 0.000001);
});

test("the printed end of delayed picture is a valid range end", (t) => {
  const f = fixture(t);
  const video = join(f.dir, "shifted-picture.mp4");
  media(video, [
    "-f",
    "lavfi",
    "-i",
    "color=green:s=320x180:r=24:d=3",
    "-f",
    "lavfi",
    "-i",
    "sine=f=444:r=48000:d=3",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-output_ts_offset",
    "20",
  ]);
  const { data } = resultOf(
    spawnSync(
      process.execPath,
      [cli, "inspect", video, "--start", "0.021333", "--end", "3.021333", "--frames", "1"],
      { cwd: f.dir, encoding: "utf8", timeout: 25_000 },
    ),
  );
  assert.equal(data.range.end, 3.021333);
  const sheet = resolve(import.meta.dirname, "../review/sheet.py");
  const frames = resultOf(
    spawnSync("python", [sheet, video, "overview", "0.021333-3.021333/1"], {
      cwd: f.dir,
      encoding: "utf8",
      timeout: 25_000,
    }),
  ).data;
  assert.equal(frames.source.pictureTo, 3.021333);
});

test("overview searches the audio tail but samples only times with picture", (t) => {
  const f = fixture(t);
  const video = join(f.dir, "long-audio.mp4");
  media(video, [
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=320x180:r=25:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=f=444:r=48000:d=3",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
  ]);
  const transcript = join(f.dir, "tail.srt");
  writeFileSync(transcript, "1\n00:00:02,100 --> 00:00:02,800\nAfter picture\n");
  const run = (...args) =>
    resultOf(
      spawnSync(
        process.execPath,
        [
          cli,
          "inspect",
          video,
          "--transcript",
          transcript,
          "--find",
          "picture",
          "--frames",
          "2",
          ...args,
        ],
        { cwd: f.dir, encoding: "utf8", timeout: 25_000 },
      ),
    ).data;
  const whole = run();
  assert.equal(whole.range.end, 3);
  assert.equal(whole.source.pictureTo, 2);
  assert.equal(whole.transcript.matches[0].text, "After picture");
  assert.equal(whole.transcript.matches[0].commands, undefined);
  assert.ok(whole.entries.every((e) => e.requestedTime < 2));
  const [picturePin, audioPin] = run("--at", "0.5", "--at", "2.5,0.5").entries;
  assert.equal(picturePin.sourceTime, 0.48);
  assert.ok(existsSync(picturePin.frame));
  assert.equal(audioPin.requestedTime, 2.5);
  assert.equal(audioPin.frame, undefined);
  assert.match(audioPin.visualReason, /no picture/);
  assert.equal(audioPin.transcript[0].text, "After picture");
  const crossing = run("--start", "1.8", "--end", "2.6");
  assert.deepEqual(crossing.visual.range, { start: 1.8, end: 2 });
  assert.equal(crossing.transcript.status, "available");
  const tail = run("--start", "2.1", "--end", "2.8");
  assert.equal(tail.visual.status, "empty-range");
  assert.deepEqual(tail.entries, []);
  assert.equal(tail.transcript.status, "available");
});

test("overview uses audio packet ends when MPEG-TS and shifted Matroska durations disagree", (t) => {
  const f = fixture(t);
  const transcript = join(f.dir, "tail-and-outside.srt");
  writeFileSync(
    transcript,
    "1\n00:00:04,830 --> 00:00:04,900\nTail words\n\n2\n00:00:10,000 --> 00:00:10,500\nOutside words\n",
  );
  for (const { name, extra } of [
    { name: "broadcast.ts", extra: ["-mpegts_flags", "+resend_headers"] },
    { name: "shifted.mkv", extra: ["-output_ts_offset", "13"] },
  ]) {
    const video = join(f.dir, name);
    media(video, [
      "-f",
      "lavfi",
      "-i",
      "color=red:s=192x108:r=24000/1001:d=3",
      "-f",
      "lavfi",
      "-i",
      "sine=f=440:r=48000:d=4.9",
      "-c:v",
      "libx264",
      "-bf",
      "2",
      "-c:a",
      "aac",
      ...extra,
    ]);
    const { data } = resultOf(
      spawnSync(
        process.execPath,
        [cli, "inspect", video, "--transcript", transcript, "--find", "words", "--frames", "1"],
        { cwd: f.dir, encoding: "utf8", timeout: 25_000 },
      ),
    );
    assert.ok(data.source.duration >= 4.9 && data.source.duration < 5.2);
    assert.deepEqual(
      data.transcript.matches.map((m) => m.text),
      ["Tail words"],
    );
    assert.equal(data.transcript.matches[0].commands, undefined);
  }
});

test("transcript-only local inspection needs no media decoder or speech model", (t) => {
  const f = fixture(t);
  const transcript = join(f.dir, "speech.json");
  writeFileSync(
    transcript,
    JSON.stringify({ segments: [{ start: 0.125, end: 1.5, text: "look here" }] }),
  );
  const r = spawnSync(
    process.execPath,
    [cli, "inspect", f.video, "--detail", "transcript", "--transcript", transcript],
    {
      cwd: f.dir,
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        PATH: process.env.PATH.split(";")
          .filter((p) => !/scoop.*shims/i.test(p))
          .join(";"),
      },
    },
  );
  const { data } = resultOf(r);
  assert.equal(data.visual.status, "skipped");
  assert.equal(data.entries.length, 0);
  assert.equal(data.transcript.status, "available");
});

test("invalid inspection controls never create runs or discard explicit pins", (t) => {
  const f = fixture(t);
  for (const args of [
    ["--at", "0.1,0.2,0.3", "--frames", "2"],
    ["--start", "3", "--end", "2"],
    ["--at", "4.5"],
    ["--transcript", "missing.vtt"],
    ["--frames", "0"],
    ["--minutes=1"],
    ["--start", "bad"],
    ["--detail", "nope"],
  ]) {
    const r = f.run(...args);
    assert.equal(r.status, 2, args.join(" ") + r.stdout + r.stderr);
  }
  assert.deepEqual(readdirSync(f.dir), ["reference with spaces.mkv"]);
});

test("a narrow scene window still detects the cut after its first displayed frame", (t) => {
  const f = fixture(t);
  const { data } = resultOf(f.run("--scenes", "--start", "0.99", "--end", "1.8", "--frames", "4"));
  const cut = data.entries.find((e) => e.reasons.includes("scene-estimate"));
  assert.equal(cut?.sourceTime, 1);
  assert.ok(data.entries.every((e) => e.requestedTime >= 0.99 && e.requestedTime < 1.8));
});

test("a narrow scene scan preserves the luminance-change history before its range", (t) => {
  const f = fixture(t);
  media(f.video, [
    "-f",
    "lavfi",
    "-i",
    "nullsrc=s=160x90:r=25:d=1.52,geq=lum='16+64*(3-abs(mod(N,6)-3))':cb=128:cr=128",
    "-c:v",
    "ffv1",
  ]);
  const full = resultOf(f.run("--scenes", "--start", "0", "--end", "1.48", "--frames", "8")).data;
  const narrow = resultOf(f.run("--scenes", "--start", "0.69", "--end", "1", "--frames", "8")).data;
  const estimates = (data) => data.entries.filter((e) => e.reasons.includes("scene-estimate"));
  assert.ok(estimates(full).length);
  assert.deepEqual(
    estimates(full).filter((e) => e.requestedTime >= 0.69 && e.requestedTime < 1),
    [],
  );
  assert.deepEqual(estimates(narrow), []);
});

test("scene anchors supplement coverage instead of hiding the quiet tail", (t) => {
  const f = fixture(t);
  media(f.video, [
    "-f",
    "lavfi",
    "-i",
    "color=black:s=128x72:r=30:d=4,drawbox=color=white:t=fill:enable='lt(t,1)*mod(floor(t*10),2)'",
    "-c:v",
    "ffv1",
  ]);
  const { data } = resultOf(f.run("--scenes", "--frames", "16", "--at", "0.25"));
  assert.ok(
    data.entries.some(
      (e) =>
        e.reasons.includes("scene-estimate") && e.requestedTime >= 0.1 && e.requestedTime < 1.1,
    ),
  );
  assert.ok(data.entries.some((e) => e.reasons.includes("coverage") && e.requestedTime > 3));
  assert.ok(data.entries.some((e) => e.reasons.includes("explicit") && e.requestedTime === 0.25));
  assert.equal(data.entries.length, 16);
  assert.equal(data.visual.deduplicated, false);
});

test("a failed decoder keeps imported speech and marks only visual evidence unavailable", (t) => {
  const f = fixture(t);
  writeFileSync(f.video, "not a video");
  const captions = join(f.dir, "speech.json");
  writeFileSync(captions, JSON.stringify([{ start: 0.125, end: 1.5, text: "survives" }]));
  const r = f.run("--transcript", captions);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const index = /^index: (.+)$/m.exec(r.stdout)?.[1].trim();
  assert.ok(index, r.stdout);
  const data = JSON.parse(readFileSync(index, "utf8"));
  assert.equal(data.complete, false);
  assert.equal(data.visual.status, "failed");
  assert.equal(data.transcript.status, "available");
  assert.equal(JSON.parse(readFileSync(data.transcript.path, "utf8")).segments[0].text, "survives");
});

test("caption language selection respects source language and refuses ambiguous dubbed tracks", () => {
  const code = `import json, sys
sys.path.insert(0, sys.argv[1])
from reference_source import caption_track
track = [{"ext": "vtt"}]
cases = [
 {"language": "en", "automatic_captions": {"ar-orig": track, "en-orig": track}},
 {"automatic_captions": {"ar-orig": track, "en-orig": track}},
 {"language": "en", "subtitles": {"en": track}, "automatic_captions": {"en-orig": track}},
]
print(json.dumps([caption_track(c) for c in cases] + [caption_track(cases[0], "fr")]))`;
  const r = spawnSync("python", ["-c", code, resolve(import.meta.dirname, "../review")], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(r.status, 0, r.stderr);
  const results = JSON.parse(r.stdout);
  assert.equal(results[0][0], "en-orig");
  assert.equal(results[1][0], null);
  assert.equal(results[2][0], "en");
  assert.equal(results[2][1].provenance, "manual");
  assert.equal(results[3][0], null);
});

const remoteFixture = (t, partial = false) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, "speech.vtt"), "WEBVTT\n\n00:00.125 --> 00:01.500\nNative caption\n");
  writeFileSync(
    join(f.dir, "index.html"),
    '<html><title>Reference fixture</title><video src="clip.mp4"><track kind="subtitles" src="speech.vtt" srclang="en" label="English"></video></html>',
  );
  if (!partial)
    media(join(f.dir, "clip.mp4"), [
      "-f",
      "lavfi",
      "-i",
      "color=red:s=128x72:r=10:d=2",
      "-pix_fmt",
      "yuv420p",
    ]);
  const code = `import functools, http.server, json, subprocess, sys, threading
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[2])
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
 url = "http://127.0.0.1:%s/index.html" % server.server_port
 args = [sys.argv[3], sys.argv[1], "inspect", url, "--language", "en", "--minutes", "0.3"]
 args += ["--frames", "2"] if sys.argv[4] == "partial" else ["--detail", "transcript", "--find", "Native"]
 r = subprocess.run(args, cwd=sys.argv[2], capture_output=True, text=True, encoding="utf8", timeout=25)
 print(json.dumps({"status": r.returncode, "stdout": r.stdout, "stderr": r.stderr}))
finally:
 server.shutdown()
 server.server_close()`;
  const r = spawnSync(
    "python",
    ["-c", code, cli, f.dir, process.execPath, partial ? "partial" : "captions"],
    { encoding: "utf8", timeout: 28000 },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("URL caption-only inspection keeps refinable search results without downloading video", (t) => {
  const { data } = resultOf(remoteFixture(t));
  assert.equal(data.transcript.provenance, "manual");
  assert.equal(data.transcript.language, "en");
  assert.equal(data.transcript.count, 1);
  assert.equal(data.visual.status, "skipped");
  assert.equal(data.source.path, null);
  assert.equal(data.entries.length, 0);
  assert.equal(JSON.parse(readFileSync(data.transcript.path, "utf8")).segments[0].start, 0.125);
  assert.ok(data.commands.inspect.argv.includes(data.source.input));
  assert.ok(data.commands.inspect.argv.includes(data.transcript.raw));
  const command = data.transcript.matches[0].commands.inspect;
  assert.ok(command.argv.includes(data.source.input));
  assert.ok(command.argv.includes(data.transcript.raw));
  assert.ok(command.argv.includes("--at"));
});

test("failed URL media keeps real native captions and its acquisition checkpoint", (t) => {
  const r = remoteFixture(t, true);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const index = /^index: (.+)$/m.exec(r.stdout)?.[1].trim();
  const data = JSON.parse(readFileSync(index, "utf8"));
  assert.equal(data.complete, false);
  assert.equal(data.transcript.status, "available");
  assert.equal(data.visual.status, "failed");
  assert.ok(existsSync(data.transcript.raw));
  assert.ok(existsSync(data.acquisition));
});

test("short video requests near EOF return its last real frame and usable root follow-ups", (t) => {
  const f = fixture(t);
  const video = join(f.dir, "short.mp4");
  media(video, ["-f", "lavfi", "-i", "color=red:s=128x72:r=30:d=0.2", "-pix_fmt", "yuv420p"]);
  const first = resultOf(
    spawnSync(process.execPath, [cli, "inspect", video, "--out", join(f.dir, "evidence")], {
      cwd: f.dir,
      encoding: "utf8",
      timeout: 20000,
    }),
  );
  assert.equal(first.data.entries.length, 16);
  assert.equal(first.data.complete, true);
  const pin = resultOf(
    spawnSync(
      process.execPath,
      [cli, "inspect", video, "--at", "0.199", "--frames", "1", "--out", join(f.dir, "evidence")],
      { cwd: f.dir, encoding: "utf8", timeout: 10000 },
    ),
  );
  assert.equal(pin.data.entries[0].requestedTime, 0.199);
  assert.ok(pin.data.entries[0].sourceTime <= 0.199);
  assert.ok(pin.data.entries[0].sourceTime >= 0.16);
  const command = pin.data.entries[0].commands.frames;
  const follow = spawnSync(command.argv[0], command.argv.slice(1), {
    cwd: resolve(import.meta.dirname, "../.."),
    env: { ...process.env, ...command.env },
    encoding: "utf8",
    timeout: 10000,
  });
  const next = resultOf(follow);
  assert.ok(Math.abs(next.data.entries[0].sourceTime - pin.data.entries[0].sourceTime) < 0.001);
});

test("reference chunk follow-ups preserve source time without borrowing the film narration", (t) => {
  const f = fixture(t);
  const put = (file, value) => {
    mkdirSync(dirname(join(f.dir, file)), { recursive: true });
    writeFileSync(join(f.dir, file), typeof value === "string" ? value : JSON.stringify(value));
  };
  const chunk = join(f.dir, "renders/chunks/c02.mp4");
  mkdirSync(dirname(chunk), { recursive: true });
  media(chunk, ["-f", "lavfi", "-i", "color=blue:s=128x72:r=30:d=2", "-pix_fmt", "yuv420p"]);
  put("package.json", {
    "live-studio": {
      soundTimeline: "src/timeline/audio.json",
      soundVault: false,
      sfx: "sound/sfx",
    },
  });
  put("src/scene.ts", "export const scene = {};\n");
  put("src/edit.json", { end: 62 });
  put("src/timeline/audio.json", {
    narration: "narr",
    beds: [],
    tracks: [{ id: "voice" }],
    sfx: [{ name: "narr", at: 0, length: 62, track: "voice" }],
  });
  put("renders/cuts.json", [30, 60]);
  put("renders/live/voice_map.json", {
    lines: [
      { text: "first", s: 0, e: 2, words: [{ w: "first", s: 0, e: 2 }] },
      { text: "later", s: 60, e: 62, words: [{ w: "later", s: 60, e: 62 }] },
    ],
  });
  mkdirSync(join(f.dir, "sound/sfx"), { recursive: true });
  media(join(f.dir, "sound/sfx/narr.wav"), ["-f", "lavfi", "-i", "sine=duration=62"]);
  const fresh = new Date(Date.now() + 2000);
  utimesSync(chunk, fresh, fresh);
  const ordinary = resultOf(
    spawnSync(
      "python",
      [resolve(import.meta.dirname, "../review/sheet.py"), chunk, "frames", "60.5"],
      { cwd: f.dir, encoding: "utf8", timeout: 10000 },
    ),
  );
  assert.equal(ordinary.data.entries[0].narration.text, "later");
  assert.equal(ordinary.data.entries[0].shot, 2);
  const inspected = resultOf(
    spawnSync(process.execPath, [cli, "inspect", chunk, "--at", "0.5", "--frames", "1"], {
      cwd: f.dir,
      encoding: "utf8",
      timeout: 10000,
    }),
  );
  const command = inspected.data.entries[0].commands.frames;
  const followed = resultOf(
    spawnSync(command.argv[0], command.argv.slice(1), {
      cwd: f.dir,
      env: { ...process.env, ...command.env },
      encoding: "utf8",
      timeout: 10000,
    }),
  );
  assert.equal(followed.data.entries[0].sourceTime, 0.5);
  assert.equal(followed.data.entries[0].narration, undefined);
  assert.equal(followed.data.entries[0].shot, undefined);
  assert.equal(followed.data.entries[0].commands.at, undefined);
});

test("literal percent and Unicode output folders retain native frames and overview paths", (t) => {
  const f = fixture(t);
  const out = join(f.dir, "ký tự 100% và %03d");
  const first = resultOf(f.run("--at", "0.5,1.5", "--frames", "2", "--out", out));
  for (const entry of first.data.entries) {
    assert.ok(existsSync(entry.frame));
    assert.ok(existsSync(entry.sheet));
    assert.ok(entry.frame.startsWith(out));
    assert.ok(entry.sheet.startsWith(out));
  }
  const second = resultOf(f.run("--frames", "1", "--out", out));
  assert.notEqual(first.path, second.path);
  assert.ok(existsSync(first.data.entries[0].sheet));
  const literalPattern = resultOf(f.run("--frames", "1", "--out", join(f.dir, "chỉ %03d")));
  assert.ok(existsSync(literalPattern.data.entries[0].frame));
  const sheetRoot = join(f.dir, "sheet có %03d");
  mkdirSync(sheetRoot);
  const sheet = spawnSync(
    "python",
    [resolve(import.meta.dirname, "../review/sheet.py"), f.video, "overview", "0-2/2"],
    { cwd: sheetRoot, encoding: "utf8", timeout: 10000 },
  );
  const ordinary = resultOf(sheet);
  assert.equal(ordinary.data.complete, true);
  assert.ok(existsSync(ordinary.data.entries[0].sheet));
});
