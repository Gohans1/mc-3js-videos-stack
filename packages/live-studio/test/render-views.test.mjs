// Multi-angle batch --views rendering: pure parser unit tests, CLI validation, and real headless Chrome WebGL verification
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { STUDIO } from "../src/film.mjs";
import { parseViews } from "../src/views.mjs";

const RENDER = fileURLToPath(new URL("../render.mjs", import.meta.url));

const copyDemo = (dir) => {
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(
    resolve(STUDIO, "../film-stage"),
    join(dir, "node_modules/film-stage"),
    process.platform === "win32" ? "junction" : "dir",
  );
};

const findBrowser = () => {
  const candidates = [
    process.env.CHROME,
    process.env.MC_VAULT_ROOT &&
      join(process.env.MC_VAULT_ROOT, "tools/chrome-headless-shell/chrome-headless-shell.exe"),
    resolve(STUDIO, "../../vault/tools/chrome-headless-shell/chrome-headless-shell.exe"),
    String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
};

const sampleRgb = (imagePath, nx = 0.5, ny = 0.45) => {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", imagePath],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const [codec, wStr, hStr] = probe.stdout.trim().split(",");
  const w = Number(wStr);
  const h = Number(hStr);
  const x = Math.max(0, Math.min(w - 1, Math.floor(w * nx)));
  const y = Math.max(0, Math.min(h - 1, Math.floor(h * ny)));
  const px = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      imagePath,
      "-vf",
      `format=rgb24,crop=1:1:${x}:${y}`,
      "-f",
      "rawvideo",
      "-",
    ],
    { timeout: 10000 },
  );
  assert.equal(px.status, 0, px.stderr?.toString());
  return { codec, w, h, rgb: [px.stdout[0], px.stdout[1], px.stdout[2]] };
};

test("parseViews parses inline specs and @json object/array files and enforces view names, duplicates, and camera bounds", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "views-parse-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const maxName = `a${"b".repeat(47)}`;
  assert.deepEqual(parseViews(`a:0,1,2,3,4,5,50;${maxName}:-1,0.5,3,0,0,0,179.5;`, dir), [
    { name: "a", cam: [0, 1, 2, 3, 4, 5, 50] },
    { name: maxName, cam: [-1, 0.5, 3, 0, 0, 0, 179.5] },
  ]);

  writeFileSync(
    join(dir, "obj.json"),
    JSON.stringify({ "cam.1_wide-top": [1, 2, 3, 4, 5, 6, 45] }),
  );
  assert.deepEqual(parseViews("@obj.json", dir), [
    { name: "cam.1_wide-top", cam: [1, 2, 3, 4, 5, 6, 45] },
  ]);

  writeFileSync(
    join(dir, "arr.json"),
    JSON.stringify([{ name: "hero", cam: [0, 2, 5, 0, 1, 0, 35] }]),
  );
  assert.deepEqual(parseViews("@arr.json", dir), [{ name: "hero", cam: [0, 2, 5, 0, 1, 0, 35] }]);

  for (const badSpec of [
    "",
    "   ",
    ";",
    "corner",
    ":0,0,5,0,0,0,50",
    "corner:0,0,5,0,0,0",
    "corner:0,0,5,0,0,0,50,1",
    "corner:0,0,,0,0,0,50",
    "corner:0,0,NaN,0,0,0,50",
    "corner:0,0,Infinity,0,0,0,50",
    "corner:0,0,5,0,0,0,0",
    "corner:0,0,5,0,0,0,-10",
    "corner:0,0,5,0,0,0,180",
    "corner:0,0,5,0,0,0,220",
    "corner:0,0,5,0,0,0,50;;kitchen:1,0,5,0,0,0,50",
  ]) {
    assert.throws(() => parseViews(badSpec, dir), `expected throw for ${JSON.stringify(badSpec)}`);
  }

  for (const badName of [
    "../escape",
    "sub/view",
    "sub\\view",
    ".hidden",
    "-dash",
    "_under",
    "bad space",
    "a".repeat(49),
  ]) {
    assert.throws(() => parseViews(`${badName}:0,0,5,0,0,0,50`, dir), /invalid view name/i);
  }

  assert.throws(
    () => parseViews("corner:0,0,5,0,0,0,50;corner:1,0,5,0,0,0,40", dir),
    /duplicate view name/i,
  );
  assert.throws(
    () => parseViews("corner:0,0,5,0,0,0,50;Corner:1,0,5,0,0,0,40", dir),
    /duplicate view name/i,
  );

  assert.throws(() => parseViews("@", dir), /JSON file path/);
  assert.throws(() => parseViews("@nope.json", dir), /file not found: nope\.json/);

  writeFileSync(join(dir, "bad.json"), "{broken");
  assert.throws(() => parseViews("@bad.json", dir), /not valid JSON/);

  writeFileSync(join(dir, "empty.json"), "{}");
  assert.throws(() => parseViews("@empty.json", dir), /has no views/);

  writeFileSync(join(dir, "empty-arr.json"), "[]");
  assert.throws(() => parseViews("@empty-arr.json", dir), /has no views/);

  writeFileSync(
    join(dir, "dup-arr.json"),
    JSON.stringify([
      { name: "cam1", cam: [0, 0, 5, 0, 0, 0, 50] },
      { name: "cam1", cam: [1, 0, 5, 0, 0, 0, 50] },
    ]),
  );
  assert.throws(() => parseViews("@dup-arr.json", dir), /duplicate view name/i);

  writeFileSync(join(dir, "bad-fov.json"), JSON.stringify({ cam1: [0, 0, 5, 0, 0, 0, 180] }));
  assert.throws(() => parseViews("@bad-fov.json", dir), /fov/);

  writeFileSync(join(dir, "str-num.json"), JSON.stringify({ cam1: ["0", 0, 5, 0, 0, 0, 50] }));
  assert.throws(() => parseViews("@str-num.json", dir), /finite number/);
});

test(
  "render CLI enforces --views exit-2 guards, target restrictions, typos, options before the target, and help before Chrome boots",
  { timeout: 30000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "render-views-cli-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    copyDemo(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
    const run = (args, flags = []) =>
      spawnSync("bun", [RENDER, ...args, ...flags], {
        cwd: dir,
        encoding: "utf8",
        timeout: 20000,
        env: { ...process.env, LIVE_PROJECT: dir },
      });

    const combined = run(
      ["stills"],
      ["--inspect", "0,0,5,0,0,0,50", "--views", "corner:0,0,5,0,0,0,50"],
    );
    assert.equal(combined.status, 2, combined.stdout + combined.stderr);
    assert.match(combined.stderr, /--inspect and --views cannot be used together/);
    assert.doesNotMatch(combined.stdout + combined.stderr, /built in/i);

    for (const target of ["clip", "final", "all"]) {
      const wrongTarget = run([target], ["--views", "corner:0,0,5,0,0,0,50"]);
      assert.equal(wrongTarget.status, 2, `${target}: ${wrongTarget.stderr}`);
      assert.match(wrongTarget.stderr, /--views is for render stills or poster/);
    }

    const captionsTarget = run(["captions"], ["--views", "corner:0,0,5,0,0,0,50"]);
    assert.equal(captionsTarget.status, 2, captionsTarget.stderr);
    assert.match(captionsTarget.stderr, /--views does nothing for render captions/);

    const badInline = run(["stills"], ["--views", "../evil:0,0,5,0,0,0,50"]);
    assert.equal(badInline.status, 2, badInline.stderr);
    assert.match(badInline.stderr, /--views:.*invalid view name/);

    const badJson = run(["stills"], ["--views", "@missing.json"]);
    assert.equal(badJson.status, 2, badJson.stderr);
    assert.match(badJson.stderr, /--views:.*missing\.json/);

    const typo = run(["stills", "--view", "corner:0,0,5,0,0,0,50"]);
    assert.equal(typo.status, 2, typo.stderr);
    assert.match(typo.stderr, /unknown option --view/);

    const before = run(["--views", "corner:0,0,5,0,0,0,50", "--at", "1"]);
    assert.equal(before.status, 2, before.stderr);
    assert.match(before.stderr, /which render\?/);

    const help = run(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--views "a:px/);
  },
);

const setupRoomFilm = (t, chrome, { redHex = "0xdd2222", withFree = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "render-views-gl-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ ...JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8")), end: 3 }),
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { chrome: relative(dir, chrome) } }),
  );
  const cameraModule = JSON.stringify(
    resolve(STUDIO, "../film-stage/src/camera.ts").replaceAll("\\", "/"),
  );
  const sceneFile = join(dir, "src/scene.ts");
  const makeScene = (hex, includeFree = true) => `import * as THREE from "three";
import { projectCamera } from ${cameraModule};
export const DURATION = 3, SHOTS_OUT = [{ t: 0, what: "colored-room" }];
export function buildScene(canvas, W, H) {
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101010);
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  scene.add(camera);
  const wall = (x, y, z, ry, c) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
  };
  // +X red wall, -X blue wall, +Z green wall, -Z split top-left/bottom-right quads
  wall(6, 0, 0, -Math.PI / 2, ${hex});
  wall(-6, 0, 0, Math.PI / 2, 0x1144ee);
  wall(0, 0, 6, Math.PI, 0x11dd33);
  const quad = (x, y, c) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }),
    );
    m.position.set(x, y, -6);
    scene.add(m);
  };
  quad(-4, 4, 0xeedd11);
  quad(4, -4, 0xdd22dd);

  const free = {
    on: false,
    p: new THREE.Vector3(0, 0, 0),
    l: new THREE.Vector3(0, 0, -1),
    fov: 50,
    roll: 0,
  };
  const draw = (t) => {
    if (free.on) {
      if (free.roll !== 0) throw new Error("free-cam state leaked between views: roll=" + free.roll);
      camera.fov = free.fov;
      camera.position.copy(free.p);
      camera.lookAt(free.l);
      // Mutate free.roll during draw to verify render/page.ts restores free cleanly between views
      free.roll = 42;
    } else {
      camera.fov = 50;
      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, 6);
    }
    projectCamera(camera, W, H);
    renderer.render(scene, camera);
  };
  draw.describe = (t) => [{ head: "TIME", lines: [{ text: "t=" + t.toFixed(2) }] }];
  draw.tools = ${includeFree ? "{ scene, camera, free }" : "{ scene, camera }"};
  return draw;
}`;
  writeFileSync(sceneFile, makeScene(redHex, withFree));
  const render = (args, flags = []) =>
    spawnSync("bun", [RENDER, ...args, ...flags], {
      cwd: dir,
      encoding: "utf8",
      timeout: 180000,
      env: { ...process.env, LIVE_PROJECT: dir },
    });
  return { dir, sceneFile, makeScene, render };
};

test(
  "--views renders multiple distinct camera angles in one boot without wiping existing stills or unrelated views",
  { timeout: 180000 },
  (t) => {
    const chrome = findBrowser();
    if (!chrome) return t.skip("no Chrome binary available for live --views verification");
    const { dir, sceneFile, makeScene, render } = setupRoomFilm(t, chrome);

    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(join(dir, "renders/still_1s.jpg"), "keep-still");
    writeFileSync(join(dir, "renders/view_prior_1s.jpg"), "keep-prior-view");

    // 1. Inline --views across 2 camera angles x 2 timestamps in ONE Vite build + ONE Chrome boot
    const batch = render(
      ["stills"],
      ["--at", "0.5,1", "--views", "east-red:0,0,0,6,0,0,50;west.blue_1:0,0,0,-6,0,0,50"],
    );
    assert.equal(batch.status, 0, batch.stdout + batch.stderr);
    assert.equal((batch.stdout.match(/^built in /gm) ?? []).length, 1, "single Vite build");
    assert.equal((batch.stdout.match(/^scene built in /gm) ?? []).length, 1, "single scene build");

    const expectedFiles = [
      "renders/view_east-red_0.5s.jpg",
      "renders/view_east-red_1s.jpg",
      "renders/view_west.blue_1_0.5s.jpg",
      "renders/view_west.blue_1_1s.jpg",
    ];
    for (const rel of expectedFiles) {
      assert.ok(existsSync(join(dir, rel)), `missing ${rel}`);
    }

    const redPx = sampleRgb(join(dir, "renders/view_east-red_1s.jpg"));
    assert.equal(redPx.codec, "mjpeg");
    assert.ok(
      redPx.rgb[0] > 180 && redPx.rgb[1] < 60 && redPx.rgb[2] < 60,
      `expected red wall for east-red, got ${redPx.rgb}`,
    );

    const bluePx = sampleRgb(join(dir, "renders/view_west.blue_1_1s.jpg"));
    assert.ok(
      bluePx.rgb[2] > 180 && bluePx.rgb[0] < 60 && bluePx.rgb[1] < 100,
      `expected blue wall for west.blue_1, got ${bluePx.rgb}`,
    );

    assert.equal(readFileSync(join(dir, "renders/still_1s.jpg"), "utf8"), "keep-still");
    assert.equal(readFileSync(join(dir, "renders/view_prior_1s.jpg"), "utf8"), "keep-prior-view");

    // 2. --views @json (object format) + --list + --compare preserves .prev/ and emits diff
    writeFileSync(sceneFile, makeScene("0x11dddd"));
    writeFileSync(
      join(dir, "views_obj.json"),
      JSON.stringify({
        "east-red": [0, 0, 0, 6, 0, 0, 50],
        south_green: [0, 0, 0, 0, 0, 6, 50],
      }),
    );
    const cmpRun = render(
      ["stills"],
      ["--at", "1", "--list", "--compare", "--views", "@views_obj.json"],
    );
    assert.equal(cmpRun.status, 0, cmpRun.stdout + cmpRun.stderr);
    assert.ok(existsSync(join(dir, "renders/.prev/view_east-red_1s.jpg")));
    assert.ok(existsSync(join(dir, "renders/compare_view_east-red_1s.png")));
    assert.match(cmpRun.stdout, /compare renders\/view_east-red_1s\.jpg: .* changed/);
    const greenPx = sampleRgb(join(dir, "renders/view_south_green_1s.jpg"));
    assert.ok(
      greenPx.rgb[1] > 170 && greenPx.rgb[0] < 70,
      `expected green wall for south_green, got ${greenPx.rgb}`,
    );

    // 3. --views @json (array format) + --crop zooms into top-left yellow quad on -Z wall
    writeFileSync(
      join(dir, "views_arr.json"),
      JSON.stringify([{ name: "north_quad", cam: [0, 0, 0, 0, 0, -6, 60] }]),
    );
    const cropRun = render(
      ["stills"],
      ["--at", "1", "--crop", "0,0,0.5,0.5", "--views", "@views_arr.json"],
    );
    assert.equal(cropRun.status, 0, cropRun.stdout + cropRun.stderr);
    const yellowPx = sampleRgb(join(dir, "renders/view_north_quad_1s.jpg"));
    assert.ok(
      yellowPx.rgb[0] > 180 && yellowPx.rgb[1] > 180 && yellowPx.rgb[2] < 60,
      `expected yellow quad via --crop+--views, got ${yellowPx.rgb}`,
    );

    // 4. Poster mode + --res 1080 + --views writes full-size lossless PNG without strip
    const posterRun = render(
      ["poster"],
      ["--at", "1", "--res", "1080", "--samples", "1", "--views", "west_hi:0,0,0,-6,0,0,50"],
    );
    assert.equal(posterRun.status, 0, posterRun.stdout + posterRun.stderr);
    const posterInfo = sampleRgb(join(dir, "renders/view_west_hi_1s.png"), 0.5, 0.5);
    assert.equal(posterInfo.codec, "png");
    assert.equal(posterInfo.w, 1920);
    assert.equal(posterInfo.h, 1080);
    assert.ok(posterInfo.rgb[2] > 180 && posterInfo.rgb[0] < 60);

    // 5. A single --inspect camera still renders
    const inspectRun = render(["stills"], ["--at", "1", "--inspect", "0,0,0,-6,0,0,50"]);
    assert.equal(inspectRun.status, 0, inspectRun.stdout + inspectRun.stderr);
    const inspPx = sampleRgb(join(dir, "renders/still_1s.jpg"));
    assert.ok(inspPx.rgb[2] > 180 && inspPx.rgb[0] < 60);
  },
);

test("--views fails cleanly when the film exposes no draw.tools.free", { timeout: 60000 }, (t) => {
  const chrome = findBrowser();
  if (!chrome) return t.skip("no Chrome binary available for live --views verification");
  const { render } = setupRoomFilm(t, chrome, { withFree: false });

  const out = render(["stills"], ["--at", "1", "--views", "corner:0,0,5,0,0,0,50"]);
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /ERROR --views requires draw\.tools\.free/);
});
