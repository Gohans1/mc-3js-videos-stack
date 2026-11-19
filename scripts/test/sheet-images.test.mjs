// scripts/review/sheet.py: arbitrary image-list contact sheets + --out validation
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SHEET = resolve(dirname(fileURLToPath(import.meta.url)), "../review/sheet.py");

const makeImages = (specs) => {
  for (const spec of specs) mkdirSync(dirname(spec.file), { recursive: true });
  const script = [
    "import json, sys",
    "from PIL import Image",
    "for item in json.loads(sys.argv[1]):",
    "    mode = item.get('mode', 'RGB')",
    "    color = tuple(item['color'])",
    "    Image.new(mode, (item['w'], item['h']), color).save(item['file'])",
  ].join("\n");
  const res = spawnSync("python", ["-c", script, JSON.stringify(specs)], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(res.status, 0, res.stderr);
};

const inspectSheet = (file) => {
  const script = [
    "import json, sys",
    "from PIL import Image",
    "im = Image.open(sys.argv[1])",
    "w, h = im.size",
    "rgb = im.convert('RGB')",
    "px = lambda nx, ny: list(rgb.getpixel((max(0, min(w-1, int(w*nx))), max(0, min(h-1, int(h*ny))))))",
    "cap = rgb.crop((8, int(h * 0.46), int(w * 0.45), int(h * 0.495)))",
    "pixels = list(cap.getdata())",
    "bright_neutral = sum(1 for r, g, b in pixels if r > 160 and g > 160 and b > 160)",
    "dark_bg = sum(1 for r, g, b in pixels if r < 40 and g < 40 and b < 40)",
    "print(json.dumps({'format': im.format, 'w': w, 'h': h, 'tl': px(0.25, 0.22), 'tr': px(0.75, 0.22), 'bl': px(0.25, 0.72), 'br': px(0.75, 0.72), 'bright_neutral': bright_neutral, 'dark_bg': dark_bg}))",
  ].join("\n");
  const res = spawnSync("python", ["-c", script, file], { encoding: "utf8", timeout: 15000 });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
};

test(
  "sheet builds a captioned contact sheet from png/jpg/jpeg/webp including RGBA transparency",
  { timeout: 30000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "sheet-images-grid-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    makeImages([
      {
        file: join(dir, "renders/view_red_4s.png"),
        w: 320,
        h: 180,
        color: [220, 30, 30, 220],
        mode: "RGBA",
      },
      { file: join(dir, "renders/view_green_4s.jpg"), w: 320, h: 180, color: [30, 210, 40] },
      { file: join(dir, "renders/view_blue_4s.jpeg"), w: 180, h: 320, color: [30, 60, 230] },
      { file: join(dir, "renders/view_yellow_4s.webp"), w: 320, h: 180, color: [235, 220, 30] },
    ]);

    const res = spawnSync(
      "python",
      [
        SHEET,
        "renders/view_red_4s.png",
        "renders/view_green_4s.jpg",
        "renders/view_blue_4s.jpeg",
        "renders/view_yellow_4s.webp",
      ],
      { cwd: dir, encoding: "utf8", timeout: 25000 },
    );
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /renders\/sheet_custom\.jpg/);
    assert.match(res.stdout, /view_red_4s/);
    assert.match(res.stdout, /view_yellow_4s/);

    const out = join(dir, "renders/sheet_custom.jpg");
    assert.ok(existsSync(out), "default renders/sheet_custom.jpg should be created");
    const info = inspectSheet(out);
    assert.equal(info.format, "JPEG");
    assert.ok(info.w >= 1200, `expected crisp 2-col width, got ${info.w}`);
    assert.ok(info.tl[0] > 160 && info.tl[1] < 70, `expected red tile TL, got ${info.tl}`);
    assert.ok(info.tr[1] > 170 && info.tr[0] < 70, `expected green tile TR, got ${info.tr}`);
    assert.ok(info.bl[2] > 180 && info.bl[0] < 70, `expected blue tile BL, got ${info.bl}`);
    assert.ok(
      info.br[0] > 180 && info.br[1] > 180 && info.br[2] < 70,
      `expected yellow tile BR, got ${info.br}`,
    );
    // Strict caption-bar crop (below row 0 tiles) proves neutral bright glyph text on dark bar
    assert.ok(
      info.bright_neutral > 20,
      `expected >20 bright neutral caption glyph pixels, got ${info.bright_neutral}`,
    );
    assert.ok(info.dark_bg > 500, `expected dark caption backdrop, got ${info.dark_bg}`);
  },
);

test(
  "sheet supports single image, --out/--out= (.jpg/.png/.webp), and disambiguates duplicate stems",
  { timeout: 30000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "sheet-images-out-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    makeImages([
      { file: join(dir, "renders/a/shot.png"), w: 320, h: 180, color: [20, 190, 210] },
      { file: join(dir, "renders/b/shot.png"), w: 320, h: 180, color: [210, 90, 20] },
    ]);

    const jpgOut = spawnSync(
      "python",
      [SHEET, "renders/a/shot.png", "--out", "renders/grids/solo.jpg"],
      { cwd: dir, encoding: "utf8", timeout: 20000 },
    );
    assert.equal(jpgOut.status, 0, jpgOut.stdout + jpgOut.stderr);
    assert.match(jpgOut.stdout, /renders\/grids\/solo\.jpg/);
    assert.ok(existsSync(join(dir, "renders/grids/solo.jpg")));
    assert.ok(!existsSync(join(dir, "renders/sheet_custom.jpg")));

    const pngOut = spawnSync(
      "python",
      [SHEET, "renders/a/shot.png", "renders/b/shot.png", "--out=renders/grids/pair.png"],
      { cwd: dir, encoding: "utf8", timeout: 20000 },
    );
    assert.equal(pngOut.status, 0, pngOut.stdout + pngOut.stderr);
    assert.match(pngOut.stdout, /a\/shot/);
    assert.match(pngOut.stdout, /b\/shot/);
    assert.ok(existsSync(join(dir, "renders/grids/pair.png")));

    const webpOut = spawnSync(
      "python",
      [SHEET, "renders/a/shot.png", "--out", "renders/grids/solo.webp"],
      { cwd: dir, encoding: "utf8", timeout: 20000 },
    );
    assert.equal(webpOut.status, 0, webpOut.stdout + webpOut.stderr);
    assert.ok(existsSync(join(dir, "renders/grids/solo.webp")));
  },
);

test(
  "sheet rejects --out path traversal, outside paths, directories, and unwritable file parents without traceback",
  { timeout: 30000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "sheet-images-sec-"));
    const outside = mkdtempSync(join(tmpdir(), "sheet-images-outside-"));
    t.after(() => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    });

    makeImages([
      { file: join(dir, "renders/view_solo_1s.png"), w: 160, h: 90, color: [20, 190, 210] },
    ]);

    const escapePath = join(outside, "escaped.jpg");
    for (const badOut of ["../escaped.jpg", "renders/../../escaped.jpg", escapePath, "renders"]) {
      const bad = spawnSync("python", [SHEET, "renders/view_solo_1s.png", "--out", badOut], {
        cwd: dir,
        encoding: "utf8",
        timeout: 15000,
      });
      assert.equal(
        bad.status,
        2,
        `expected exit 2 for --out ${badOut}: ${bad.stdout}${bad.stderr}`,
      );
      assert.doesNotMatch(bad.stderr, /Traceback/);
    }
    assert.ok(!existsSync(escapePath), "traversal target must never be written");

    // Existing file used as parent directory should exit cleanly with no Python traceback
    const badParent = spawnSync(
      "python",
      [SHEET, "renders/view_solo_1s.png", "--out", "renders/view_solo_1s.png/sub.jpg"],
      { cwd: dir, encoding: "utf8", timeout: 15000 },
    );
    assert.notEqual(badParent.status, 0);
    assert.doesNotMatch(badParent.stderr, /Traceback/);
    assert.match(badParent.stderr, /could not write|invalid --out/i);
  },
);

test(
  "sheet rejects malformed --out flags and using --out outside image-list mode",
  { timeout: 30000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "sheet-images-flags-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    makeImages([
      { file: join(dir, "renders/view_solo_1s.png"), w: 160, h: 90, color: [20, 190, 210] },
    ]);

    for (const argv of [
      ["renders/view_solo_1s.png", "--out"],
      ["renders/view_solo_1s.png", "--out="],
      ["renders/view_solo_1s.png", "--out", "renders/a.jpg", "--out", "renders/b.jpg"],
      ["renders/view_solo_1s.png", "--out", "renders/out.txt"],
      ["--out", "renders/x.jpg"],
      ["renders/draft_video.mp4", "1", "--out", "renders/x.jpg"],
    ]) {
      const res = spawnSync("python", [SHEET, ...argv], {
        cwd: dir,
        encoding: "utf8",
        timeout: 15000,
      });
      assert.equal(
        res.status,
        2,
        `expected exit 2 for ${argv.join(" ")}: ${res.stdout}${res.stderr}`,
      );
      assert.doesNotMatch(res.stderr, /Traceback/);
    }
  },
);

test(
  "sheet image-list mode rejects missing, unsupported, or corrupt image files cleanly without breaking zero-arg mode",
  { timeout: 30000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "sheet-images-err-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    makeImages([
      { file: join(dir, "renders/still_1s.jpg"), w: 160, h: 90, color: [100, 120, 140] },
      { file: join(dir, "renders/view_a_1s.jpg"), w: 160, h: 90, color: [200, 50, 50] },
    ]);
    writeFileSync(join(dir, "renders/notes.txt"), "hello");
    writeFileSync(join(dir, "renders/broken.jpg"), "not a real jpeg");

    const missing = spawnSync("python", [SHEET, "renders/missing.jpg"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /missing\.jpg/);

    const wrongExt = spawnSync("python", [SHEET, "renders/view_a_1s.jpg", "renders/notes.txt"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(wrongExt.status, 2);
    assert.match(wrongExt.stderr, /notes\.txt/);

    const corrupt = spawnSync("python", [SHEET, "renders/broken.jpg"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(corrupt.status, 2);
    assert.doesNotMatch(corrupt.stderr, /Traceback/);

    // Existing zero-arg stills mode remains completely intact
    const stills = spawnSync("python", [SHEET], { cwd: dir, encoding: "utf8", timeout: 25000 });
    assert.equal(stills.status, 0, stills.stdout + stills.stderr);
    assert.match(stills.stdout, /renders\/sheet_0\.jpg {2}1s/);

    const help = spawnSync("python", [SHEET, "--help"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--out/);
  },
);
