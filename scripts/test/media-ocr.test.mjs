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
