// scripts/review/sheet.py: arbitrary image-list contact sheets + --out validation
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SHEET = resolve(dirname(fileURLToPath(import.meta.url)), "../review/sheet.py");

const makeImage = (file, width, height, rgb) => {
  mkdirSync(dirname(file), { recursive: true });
  const script = [
    "import sys",
    "from PIL import Image",
    "path, w, h, r, g, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])",
    "Image.new('RGB', (w, h), (r, g, b)).save(path)",
  ].join("; ");
  const res = spawnSync(
    "python",
    [
      "-c",
      script,
      file,
      String(width),
      String(height),
      String(rgb[0]),
      String(rgb[1]),
      String(rgb[2]),
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(res.status, 0, res.stderr);
};

const inspectImage = (file) => {
  const script = [
    "import json, sys",
    "from PIL import Image",
    "im = Image.open(sys.argv[1])",
    "w, h = im.size",
    "rgb = im.convert('RGB')",
    "px = lambda nx, ny: list(rgb.getpixel((max(0, min(w-1, int(w*nx))), max(0, min(h-1, int(h*ny))))))",
    "cap = rgb.crop((8, int(h * 0.44), int(w * 0.45), int(h * 0.50)))",
    "cap_max = max(max(p) for p in cap.getdata())",
    "print(json.dumps({'format': im.format, 'w': w, 'h': h, 'tl': px(0.25, 0.22), 'tr': px(0.75, 0.22), 'bl': px(0.25, 0.72), 'br': px(0.75, 0.72), 'cap_max': cap_max}))",
  ].join("\n");
  const res = spawnSync("python", ["-c", script, file], { encoding: "utf8", timeout: 15000 });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
};

test("sheet builds a captioned contact sheet from an arbitrary image list (png/jpg/jpeg/webp)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-images-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  makeImage(join(dir, "renders/view_red_4s.png"), 320, 180, [220, 30, 30]);
  makeImage(join(dir, "renders/view_green_4s.jpg"), 320, 180, [30, 210, 40]);
  makeImage(join(dir, "renders/view_blue_4s.jpeg"), 180, 320, [30, 60, 230]);
  makeImage(join(dir, "renders/view_yellow_4s.webp"), 320, 180, [235, 220, 30]);

  const res = spawnSync(
    "python",
    [
      SHEET,
      "renders/view_red_4s.png",
      "renders/view_green_4s.jpg",
      "renders/view_blue_4s.jpeg",
      "renders/view_yellow_4s.webp",
    ],
    { cwd: dir, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /renders\/sheet_custom\.jpg/);
  assert.match(res.stdout, /view_red_4s/);
  assert.match(res.stdout, /view_yellow_4s/);

  const out = join(dir, "renders/sheet_custom.jpg");
  assert.ok(existsSync(out), "default renders/sheet_custom.jpg should be created");
  const info = inspectImage(out);
  assert.equal(info.format, "JPEG");
  assert.ok(info.w >= 1200, `expected crisp 2-col width, got ${info.w}`);
  assert.ok(info.tl[0] > 180 && info.tl[1] < 70, `expected red tile TL, got ${info.tl}`);
  assert.ok(info.tr[1] > 170 && info.tr[0] < 70, `expected green tile TR, got ${info.tr}`);
  assert.ok(info.bl[2] > 180 && info.bl[0] < 70, `expected blue tile BL, got ${info.bl}`);
  assert.ok(
    info.br[0] > 180 && info.br[1] > 180 && info.br[2] < 70,
    `expected yellow tile BR, got ${info.br}`,
  );
  assert.ok(
    info.cap_max > 160,
    `expected readable bright caption text under tile, got max=${info.cap_max}`,
  );
});

test("sheet supports single image and --out inside the film dir, and rejects path traversal with exit 2", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-images-out-"));
  const outside = mkdtempSync(join(tmpdir(), "sheet-images-outside-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  makeImage(join(dir, "renders/view_solo_1s.png"), 320, 180, [20, 190, 210]);

  const ok = spawnSync(
    "python",
    [SHEET, "renders/view_solo_1s.png", "--out", "renders/grids/solo.jpg"],
    { cwd: dir, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /renders\/grids\/solo\.jpg/);
  assert.ok(existsSync(join(dir, "renders/grids/solo.jpg")));
  assert.ok(!existsSync(join(dir, "renders/sheet_custom.jpg")));

  const okEq = spawnSync(
    "python",
    [SHEET, "renders/view_solo_1s.png", "--out=renders/grids/solo_eq.jpg"],
    { cwd: dir, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(okEq.status, 0, okEq.stdout + okEq.stderr);
  assert.ok(existsSync(join(dir, "renders/grids/solo_eq.jpg")));

  const escapePath = join(outside, "escaped.jpg");
  for (const badOut of ["../escaped.jpg", "renders/../../escaped.jpg", escapePath, "renders"]) {
    const bad = spawnSync("python", [SHEET, "renders/view_solo_1s.png", "--out", badOut], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(bad.status, 2, `expected exit 2 for --out ${badOut}: ${bad.stdout}${bad.stderr}`);
    assert.doesNotMatch(bad.stderr, /Traceback/);
  }
  assert.ok(!existsSync(escapePath), "traversal target must never be written");

  const missingVal = spawnSync("python", [SHEET, "renders/view_solo_1s.png", "--out"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(missingVal.status, 2);

  const outNoImages = spawnSync("python", [SHEET, "--out", "renders/x.jpg"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(outNoImages.status, 2);

  const outWithVideo = spawnSync(
    "python",
    [SHEET, "renders/draft_video.mp4", "1", "--out", "renders/x.jpg"],
    { cwd: dir, encoding: "utf8", timeout: 15000 },
  );
  assert.equal(outWithVideo.status, 2);
  assert.match(outWithVideo.stderr, /--out is only for image lists/);
});

test("sheet image-list mode rejects missing, unsupported, or corrupt image files cleanly without breaking zero-arg mode", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-images-err-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  makeImage(join(dir, "renders/still_1s.jpg"), 160, 90, [100, 120, 140]);
  makeImage(join(dir, "renders/view_a_1s.jpg"), 160, 90, [200, 50, 50]);
  writeFileSync(join(dir, "renders/notes.txt"), "hello");
  writeFileSync(join(dir, "renders/broken.jpg"), "not a real jpeg");

  const missing = spawnSync("python", [SHEET, "renders/missing.jpg"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /missing\.jpg/);

  const wrongExt = spawnSync("python", [SHEET, "renders/view_a_1s.jpg", "renders/notes.txt"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(wrongExt.status, 2);
  assert.match(wrongExt.stderr, /notes\.txt/);

  const corrupt = spawnSync("python", [SHEET, "renders/broken.jpg"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(corrupt.status, 2);
  assert.doesNotMatch(corrupt.stderr, /Traceback/);

  // Existing zero-arg stills mode remains completely intact
  const stills = spawnSync("python", [SHEET], { cwd: dir, encoding: "utf8", timeout: 30000 });
  assert.equal(stills.status, 0, stills.stdout + stills.stderr);
  assert.match(stills.stdout, /renders\/sheet_0\.jpg {2}1s/);

  const help = spawnSync("python", [SHEET, "--help"], { cwd: dir, encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--out/);
});
