import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../media/ocr.py", import.meta.url));
const python = (args) => spawnSync("python", args, { encoding: "utf8", timeout: 15_000 });

test("OCR sample times cover a source range and explicit source seconds stay exact", () => {
  const result = python([
    "-c",
    "import runpy,sys,json; m=runpy.run_path(sys.argv[1]); print(json.dumps([m['frame_times'](10,20,2,[],30),m['frame_times'](0,None,3,[12.5,1,12.5],30)]))",
    SCRIPT,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    [12.5, 17.5],
    [1, 12.5],
  ]);
});

test("OCR rejects impossible source times and bad options before writing evidence", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-ocr-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "test.png");
  writeFileSync(source, "not decoded for invalid arguments");
  for (const args of [
    [source, "--frames", "0"],
    [source, "--at", "nan"],
    [source, "--score", "1.1"],
    [source, "--at", "1"],
    [source, "--bogus"],
    [source, "--crop", "0,0.7,1,0.5"],
    [source, "--crop", "0,0.7,1"],
  ]) {
    const r = python([SCRIPT, ...args, "--out", join(dir, "out")]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /error:/);
    assert.equal(existsSync(join(dir, "out")), false);
  }
});

test("OCR dry run does not override a native config's score unless explicitly requested", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "image.png"),
    config = join(dir, "config.yaml");
  writeFileSync(source, "not decoded by dry run");
  writeFileSync(config, "Global:\n  text_score: 0.9\n");
  const r = python([SCRIPT, source, "--config", config, "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).scoreThreshold, null);
});

test("OCR keeps a --crop band in its plan, as fractions of the picture", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-crop-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "image.png");
  writeFileSync(source, "not decoded by dry run");
  const r = python([SCRIPT, source, "--crop", "0,0.7,1,0.2", "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).crop, [0, 0.7, 1, 0.2]);
});

test("a --crop band's offset is in the picture as shown: a phone video's rotation turns its coded size", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-rotated-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const coded = join(dir, "coded.mp4"),
    rotated = join(dir, "rotated.mp4");
  for (const args of [
    ["-f", "lavfi", "-i", "color=red:s=160x90:d=0.2", "-pix_fmt", "yuv420p", coded],
    ["-display_rotation", "90", "-i", coded, "-c", "copy", rotated],
  ]) {
    const made = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], {
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(made.status, 0, made.stderr);
  }
  const origin = (file) => {
    const r = python([
      "-c",
      "import runpy,sys,json; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['crop_origin'](sys.argv[2],[0.5,0.75,0.5,0.25])))",
      SCRIPT,
      file,
    ]);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.deepEqual(origin(coded), [80, 67]);
  assert.deepEqual(origin(rotated), [45, 120]);
});

const captionVideo = (dir) => {
  const file = join(dir, "captions.mp4");
  const made = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=gray:s=160x284:d=3:r=30,drawbox=x=20:y=220:w=120:h=20:color=white:t=fill:enable='between(t,0.5,1.5)',drawbox=x=30:y=215:w=100:h=25:color=yellow:t=fill:enable='between(t,2,2.8)'",
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  assert.equal(made.status, 0, made.stderr);
  return file;
};

test("--captions reads the band every quarter second over the span, and needs a band", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-captions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const video = captionVideo(dir);
  const r = python([
    SCRIPT,
    video,
    "--captions",
    "--crop",
    "0,0.7,1,0.2",
    "--to",
    "1",
    "--dry-run",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).times, [0.125, 0.375, 0.625, 0.875]);
  for (const args of [["--crop", "0,0.7,1,0.2", "--at", "1"], []]) {
    const bad = python([SCRIPT, video, "--captions", ...args, "--dry-run"]);
    assert.equal(bad.status, 2, bad.stderr);
    assert.match(bad.stderr, /--captions reads a --crop band/);
  }
});

test("the band's change peaks on the first frame a caption pops on or off", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-captions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = python([
    "-c",
    "import runpy,sys,json; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['band_changes'](sys.argv[2],[0,0.7,1,0.2],0,3)))",
    SCRIPT,
    captionVideo(dir),
  ]);
  assert.equal(r.status, 0, r.stderr);
  const changes = JSON.parse(r.stdout);
  const peaks = changes
    .filter(([, change]) => change > 1)
    .map(([at]) => at)
    .toSorted((a, b) => a - b);
  assert.deepEqual(peaks, [0.5, 1.533, 2, 2.833]);
});

const CAPTIONS = `import runpy,sys,json
m=runpy.run_path(sys.argv[1])
box=lambda x,y,h=20:[[x,y],[x+40,y],[x+40,y+h],[x,y+h]]
word=lambda t,x,y=100,s=0.9,h=20:{"text":t,"score":s,"box":box(x,y,h)}
shown=lambda t:[word("made",60),word("He",10)] if t<0.5 else [word("madems",60),word("He",10)] if t<0.6 else [] if t<0.7 else [word("real",10,s=0.8),word("cookies",60,s=0.8)]
reads=[{"at":0.125,"text":shown(0.125)+[word("SALT",10,60,1,8)]},
 {"at":0.375,"text":[word("He mode",10,s=0.6)]},
 {"at":0.625,"text":shown(0.625)},
 {"at":0.875,"text":shown(0.875)},
 {"at":0.95,"text":[word("reall s cookies e",10,s=0.8)]}]
changes=[[0.4,1.0],[0.5,30.0],[0.6,2.0],[0.7,3.0],[0.8,25.0]]
asked=[]
def read(t):
    asked.append(t)
    return shown(t)
print(json.dumps([m["captions_from"](reads,changes,0,1),m["captions_from"](reads,changes,0,1,read),asked]))`;

test("caption reads keep the caption's line, join alike, and land each change on the first frame of the next", () => {
  const r = python(["-c", CAPTIONS, SCRIPT]);
  assert.equal(r.status, 0, r.stderr);
  const [byChange, byRead, asked] = JSON.parse(r.stdout);
  assert.deepEqual(byChange, [
    { from: 0, to: 0.5, text: "He made", score: 0.9 },
    { from: 0.8, to: 1, text: "real cookies", score: 0.8 },
  ]);
  assert.deepEqual(byRead, [
    { from: 0, to: 0.6, text: "He made", score: 0.9 },
    { from: 0.7, to: 1, text: "real cookies", score: 0.8 },
  ]);
  assert.ok(asked.every((t) => [0.4, 0.5, 0.6, 0.7, 0.8].includes(t)));
});

const STACKED = `import runpy,sys,json
m=runpy.run_path(sys.argv[1])
box=lambda x,y,h=20:[[x,y],[x+40,y],[x+40,y+h],[x,y+h]]
word=lambda t,x=10,y=100,s=0.95:{"text":t,"score":s,"box":box(x,y)}
reads=[{"at":0.125,"text":[word("first")]},
 {"at":0.375,"text":[word("HE MADE",y=88),word("REAL COOKIES",y=112)]},
 {"at":0.625,"text":[word("HE MADE",y=88),word("REAL COOKIES",y=112)]},
 {"at":0.875,"text":[word("lower",y=108),word("ZACKD",x=300,y=130)]},
 {"at":1.125,"text":[word("SECOND",s=0.79)]},
 {"at":1.375,"text":[word("SECOND",s=0.79)]},
 {"at":1.625,"text":[word("third")]},
 {"at":1.875,"text":[word("was s spicier",s=0.99)]},
 {"at":2.125,"text":[word("was spicier")]}]
print(json.dumps([c["text"] for c in m["captions_from"](reads,[],0,2.5)]))`;

test("a caption stacked in two lines, set lower, or read unsure in every frame is still a caption", () => {
  const r = python(["-c", STACKED, SCRIPT]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    "first",
    "HE MADE REAL COOKIES",
    "lower",
    "SECOND",
    "third",
    "was spicier",
  ]);
});

const HANDLE = `import runpy,sys,json
m=runpy.run_path(sys.argv[1])
box=lambda y,h:[[10,y],[400,y],[400,y+h],[10,y+h]]
handle={"text":"@creator","score":0.99,"box":box(1600,30)}
said=["he made","real cookies","with more","sugar now","then salt","and pepper","it was","so good"]
reads=[{"at":0.125+0.25*i,"text":[handle]+([{"text":said[i//2],"score":0.95,"box":box(1400,100)}] if i%2==0 else [])}
 for i in range(16)]
print(json.dumps([c["text"] for c in m["captions_from"](reads,[],0,4)]))`;

test("text shown in every frame (a handle, a title) is not taken for the caption", () => {
  const r = python(["-c", HANDLE, SCRIPT]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    "he made",
    "real cookies",
    "with more",
    "sugar now",
    "then salt",
    "and pepper",
    "it was",
    "so good",
  ]);
});

test("extract_span_frames aligns extracted frames to frame_times midpoints and read_frame fallback overwrites with -y", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-ocr-batch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const video = join(dir, "quad.mp4");
  const make = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:d=0.5:r=20",
      "-f",
      "lavfi",
      "-i",
      "color=c=lime:s=64x64:d=0.5:r=20",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x64:d=0.5:r=20",
      "-f",
      "lavfi",
      "-i",
      "color=c=yellow:s=64x64:d=0.5:r=20",
      "-filter_complex",
      "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(make.status, 0, make.stderr);
  const fullDir = join(dir, "full");
  const subDir = join(dir, "sub");
  const r = python([
    "-c",
    [
      "import runpy, sys, json",
      "from pathlib import Path",
      "from PIL import Image",
      "def label(path):",
      "    r, g, b = Image.open(path).convert('RGB').getpixel((32, 32))",
      "    if r > 180 and g > 180 and b < 80: return 'yellow'",
      "    if r > 180 and g < 80: return 'red'",
      "    if g > 180 and r < 80: return 'green'",
      "    if b > 180 and r < 80: return 'blue'",
      "    return f'{r},{g},{b}'",
      "m = runpy.run_path(sys.argv[1])",
      "p1 = Path(sys.argv[3]); p1.mkdir(parents=True, exist_ok=True)",
      "t1 = m['frame_times'](0.0, 2.0, 4, [], 2.0)",
      "m1 = m['extract_span_frames'](Path(sys.argv[2]), p1, 0.0, 2.0, t1)",
      "p2 = Path(sys.argv[4]); p2.mkdir(parents=True, exist_ok=True)",
      "t2 = m['frame_times'](0.5, 2.0, 3, [], 2.0)",
      "m2 = m['extract_span_frames'](Path(sys.argv[2]), p2, 0.5, 2.0, t2)",
      "stale = p2 / 'overwrite.png'; stale.write_bytes(b'corrupt')",
      "m['extract_single_frame'](Path(sys.argv[2]), stale, 0.25)",
      "print(json.dumps({'full': [label(m1[i]) for i in range(4)], 'sub': [label(m2[i]) for i in range(3)], 'overwritten': label(stale)}))",
    ].join("\n"),
    SCRIPT,
    video,
    fullDir,
    subDir,
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    full: ["red", "green", "blue", "yellow"],
    sub: ["green", "blue", "yellow"],
    overwritten: "red",
  });
});

test("OCR --snap-fps snaps caption timestamps to frame grid and --text-out writes preset text.json", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-ocr-snap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const video = captionVideo(dir);
  const textOut = join(dir, "src/timeline/text.json");

  const dry = python([
    SCRIPT,
    video,
    "--captions",
    "--crop",
    "0,0.7,1,0.17",
    "--snap-fps",
    "30",
    "--text-out",
    textOut,
    "--dry-run",
  ]);
  assert.equal(dry.status, 0, dry.stderr);
  const plan = JSON.parse(dry.stdout);
  assert.equal(plan.snapFps, 30);
  assert.equal(plan.closeGap, 0.07);
  assert.equal(plan.preset, "zack-d-films");
  assert.equal(plan.textOut, textOut);

  const dryZero = python([
    SCRIPT,
    video,
    "--captions",
    "--crop",
    "0,0.7,1,0.17",
    "--snap-fps",
    "30",
    "--close-gap",
    "0",
    "--dry-run",
  ]);
  assert.equal(dryZero.status, 0, dryZero.stderr);
  assert.equal(JSON.parse(dryZero.stdout).closeGap, 0);

  const dryPlain = python([SCRIPT, video, "--captions", "--crop", "0,0.7,1,0.17", "--dry-run"]);
  assert.equal(dryPlain.status, 0, dryPlain.stderr);
  assert.equal(JSON.parse(dryPlain.stdout).closeGap, 0);

  for (const bad of [
    [video, "--snap-fps", "30"],
    [video, "--captions", "--crop", "0,0.7,1,0.17", "--snap-fps", "0"],
    [video, "--close-gap", "0.05"],
    [video, "--captions", "--crop", "0,0.7,1,0.17", "--close-gap", "-0.1"],
    [video, "--text-out", textOut],
  ]) {
    const r = python([SCRIPT, ...bad, "--dry-run"]);
    assert.equal(r.status, 2, r.stderr);
  }

  const snapRun = python([
    "-c",
    [
      "import runpy, sys, json",
      "from pathlib import Path",
      "m = runpy.run_path(sys.argv[1])",
      "caps = [{'from': 0.01, 'to': 0.012, 'text': 'tiny', 'score': 0.9}, {'from': 0.04, 'to': 0.51, 'text': 'it was strange', 'score': 0.99}, {'from': 0.54, 'to': 1.0, 'text': 'under the bed', 'score': 0.99}, {'from': 1.25, 'to': 1.8, 'text': 'after pause', 'score': 0.99}]",
      "snapped = m['close_caption_gaps'](m['snap_captions'](caps, 30), 0.07)",
      "out = Path(sys.argv[2])",
      "out_plain = Path(sys.argv[3])",
      "m['write_text_timeline'](out, snapped, 'zack-d-films')",
      "m['write_text_timeline'](out_plain, snapped, '')",
      "print(json.dumps({'snapped': snapped, 'doc': json.loads(out.read_text(encoding='utf-8')), 'plain': json.loads(out_plain.read_text(encoding='utf-8'))}))",
    ].join("\n"),
    SCRIPT,
    textOut,
    join(dir, "plain.json"),
  ]);
  assert.equal(snapRun.status, 0, snapRun.stderr);
  const res = JSON.parse(snapRun.stdout);
  assert.equal(res.snapped.length, 3);
  assert.equal(Math.round(res.snapped[0].from * 30), 1);
  assert.equal(res.snapped[0].to, res.snapped[1].from);
  assert.ok(res.snapped[2].from - res.snapped[1].to > 0.2);
  assert.deepEqual(res.doc, {
    preset: "zack-d-films",
    items: [
      { from: res.snapped[0].from, to: res.snapped[0].to, text: "it was strange" },
      { from: res.snapped[1].from, to: res.snapped[1].to, text: "under the bed" },
      { from: res.snapped[2].from, to: res.snapped[2].to, text: "after pause" },
    ],
  });
  assert.deepEqual(res.plain, {
    items: [
      { kind: "text", from: res.snapped[0].from, to: res.snapped[0].to, text: "it was strange" },
      { kind: "text", from: res.snapped[1].from, to: res.snapped[1].to, text: "under the bed" },
      { kind: "text", from: res.snapped[2].from, to: res.snapped[2].to, text: "after pause" },
    ],
  });
});
