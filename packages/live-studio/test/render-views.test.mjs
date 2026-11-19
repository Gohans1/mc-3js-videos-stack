// Multi-angle batch VIEWS= rendering: CLI validation and real headless Chrome WebGL verification
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

const setupValidationFilm = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-views-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const run = (args, env = {}) =>
    spawnSync("bun", [RENDER, ...args], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir, ...env },
    });
  return { dir, run };
};

test(
  "VIEWS validation rejects combining with INSPECT, bad targets, bad names, duplicates, and bad numbers before Chrome boots",
  { timeout: 60000 },
  (t) => {
    const { dir, run } = setupValidationFilm(t);

    const combined = run(["stills"], {
      INSPECT: "0,0,5,0,0,0,50",
      VIEWS: "corner:0,0,5,0,0,0,50",
    });
    assert.equal(combined.status, 2, combined.stdout + combined.stderr);
    assert.match(combined.stderr, /INSPECT.*VIEWS|VIEWS.*INSPECT/i);
    assert.doesNotMatch(combined.stdout + combined.stderr, /built in/i);

    for (const target of ["clip", "final", "all"]) {
      const wrongTarget = run([target], { VIEWS: "corner:0,0,5,0,0,0,50" });
      assert.equal(wrongTarget.status, 2, `${target}: ${wrongTarget.stderr}`);
      assert.match(wrongTarget.stderr, /VIEWS is for render stills or poster/);
    }

    const captionsTarget = run(["captions"], { VIEWS: "corner:0,0,5,0,0,0,50" });
    assert.equal(captionsTarget.status, 2, captionsTarget.stderr);
    assert.match(captionsTarget.stderr, /VIEWS/);

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
    ]) {
      const res = run(["stills"], { VIEWS: badSpec });
      assert.equal(res.status, 2, `spec ${JSON.stringify(badSpec)}: ${res.stdout}${res.stderr}`);
      assert.match(res.stderr, /VIEWS/i);
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
      const res = run(["stills"], { VIEWS: `${badName}:0,0,5,0,0,0,50` });
      assert.equal(res.status, 2, `name ${JSON.stringify(badName)}: ${res.stdout}${res.stderr}`);
      assert.match(res.stderr, /view name/i);
    }

    const dupExact = run(["stills"], {
      VIEWS: "corner:0,0,5,0,0,0,50;corner:1,0,5,0,0,0,40",
    });
    assert.equal(dupExact.status, 2, dupExact.stderr);
    assert.match(dupExact.stderr, /duplicate/i);

    const dupCase = run(["stills"], {
      VIEWS: "corner:0,0,5,0,0,0,50;Corner:1,0,5,0,0,0,40",
    });
    assert.equal(dupCase.status, 2, dupCase.stderr);
    assert.match(dupCase.stderr, /duplicate/i);

    const typo = run(["stills"], { VIEW: "corner:0,0,5,0,0,0,50" });
    assert.equal(typo.status, 2, typo.stderr);
    assert.match(typo.stderr, /did you mean VIEWS=/);

    const flag = run(["--views", "corner:0,0,5,0,0,0,50", "stills"]);
    assert.equal(flag.status, 2, flag.stderr);
    assert.match(flag.stderr, /VIEWS is an environment variable/);

    const help = run(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /VIEWS=/);

    // @json file validation errors
    const emptyAt = run(["stills"], { VIEWS: "@" });
    assert.equal(emptyAt.status, 2, emptyAt.stderr);

    const missingFile = run(["stills"], { VIEWS: "@nope.json" });
    assert.equal(missingFile.status, 2, missingFile.stderr);
    assert.match(missingFile.stderr, /nope\.json/);

    writeFileSync(join(dir, "bad.json"), "{broken");
    const badJson = run(["stills"], { VIEWS: "@bad.json" });
    assert.equal(badJson.status, 2, badJson.stderr);

    writeFileSync(join(dir, "empty.json"), "{}");
    assert.equal(run(["stills"], { VIEWS: "@empty.json" }).status, 2);

    writeFileSync(join(dir, "empty-arr.json"), "[]");
    assert.equal(run(["stills"], { VIEWS: "@empty-arr.json" }).status, 2);

    writeFileSync(
      join(dir, "dup-arr.json"),
      JSON.stringify([
        { name: "cam1", cam: [0, 0, 5, 0, 0, 0, 50] },
        { name: "cam1", cam: [1, 0, 5, 0, 0, 0, 50] },
      ]),
    );
    const dupArr = run(["stills"], { VIEWS: "@dup-arr.json" });
    assert.equal(dupArr.status, 2, dupArr.stderr);
    assert.match(dupArr.stderr, /duplicate/i);

    writeFileSync(join(dir, "bad-fov.json"), JSON.stringify({ cam1: [0, 0, 5, 0, 0, 0, 180] }));
    assert.equal(run(["stills"], { VIEWS: "@bad-fov.json" }).status, 2);

    writeFileSync(join(dir, "str-num.json"), JSON.stringify({ cam1: ["0", 0, 5, 0, 0, 0, 50] }));
    assert.equal(run(["stills"], { VIEWS: "@str-num.json" }).status, 2);
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
  const render = (args, env = {}) =>
    spawnSync("bun", [RENDER, ...args], {
      cwd: dir,
      encoding: "utf8",
      timeout: 180000,
      env: { ...process.env, LIVE_PROJECT: dir, ...env },
    });
  return { dir, sceneFile, makeScene, render };
};

test(
  "VIEWS renders multiple distinct camera angles in one boot without wiping existing stills or unrelated views",
  { timeout: 180000 },
  (t) => {
    const chrome = findBrowser();
    if (!chrome) return t.skip("no Chrome binary available for live VIEWS verification");
    const { dir, sceneFile, makeScene, render } = setupRoomFilm(t, chrome);

    mkdirSync(join(dir, "renders"), { recursive: true });
    writeFileSync(join(dir, "renders/still_1s.jpg"), "keep-still");
    writeFileSync(join(dir, "renders/view_prior_1s.jpg"), "keep-prior-view");

    // 1. Inline VIEWS= across 2 camera angles x 2 timestamps in ONE Vite build + ONE Chrome boot
    const batch = render(["stills"], {
      AT: "0.5,1",
      VIEWS: "east-red:0,0,0,6,0,0,50;west.blue_1:0,0,0,-6,0,0,50",
    });
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

    // 2. VIEWS=@json (object format) + LIST=1 + COMPARE=1 preserves .prev/ and emits diff
    writeFileSync(sceneFile, makeScene("0x11dddd"));
    writeFileSync(
      join(dir, "views_obj.json"),
      JSON.stringify({
        "east-red": [0, 0, 0, 6, 0, 0, 50],
        south_green: [0, 0, 0, 0, 0, 6, 50],
      }),
    );
    const cmpRun = render(["stills"], {
      AT: "1",
      LIST: "1",
      COMPARE: "1",
      VIEWS: "@views_obj.json",
    });
    assert.equal(cmpRun.status, 0, cmpRun.stdout + cmpRun.stderr);
    assert.ok(existsSync(join(dir, "renders/.prev/view_east-red_1s.jpg")));
    assert.ok(existsSync(join(dir, "renders/compare_view_east-red_1s.png")));
    assert.match(cmpRun.stdout, /compare renders\/view_east-red_1s\.jpg: .* changed/);
    const greenPx = sampleRgb(join(dir, "renders/view_south_green_1s.jpg"));
    assert.ok(
      greenPx.rgb[1] > 170 && greenPx.rgb[0] < 70,
      `expected green wall for south_green, got ${greenPx.rgb}`,
    );

    // 3. VIEWS=@json (array format) + CROP= zooms into top-left yellow quad on -Z wall
    writeFileSync(
      join(dir, "views_arr.json"),
      JSON.stringify([{ name: "north_quad", cam: [0, 0, 0, 0, 0, -6, 60] }]),
    );
    const cropRun = render(["stills"], {
      AT: "1",
      CROP: "0,0,0.5,0.5",
      VIEWS: "@views_arr.json",
    });
    assert.equal(cropRun.status, 0, cropRun.stdout + cropRun.stderr);
    const yellowPx = sampleRgb(join(dir, "renders/view_north_quad_1s.jpg"));
    assert.ok(
      yellowPx.rgb[0] > 180 && yellowPx.rgb[1] > 180 && yellowPx.rgb[2] < 60,
      `expected yellow quad via CROP+VIEWS, got ${yellowPx.rgb}`,
    );

    // 4. Poster mode + RES=1080 + VIEWS= writes full-size lossless PNG without strip
    const posterRun = render(["poster"], {
      AT: "1",
      RES: "1080",
      SAMPLES: "1",
      VIEWS: "west_hi:0,0,0,-6,0,0,50",
    });
    assert.equal(posterRun.status, 0, posterRun.stdout + posterRun.stderr);
    const posterInfo = sampleRgb(join(dir, "renders/view_west_hi_1s.png"), 0.5, 0.5);
    assert.equal(posterInfo.codec, "png");
    assert.equal(posterInfo.w, 1920);
    assert.equal(posterInfo.h, 1080);
    assert.ok(posterInfo.rgb[2] > 180 && posterInfo.rgb[0] < 60);

    // 5. Existing single INSPECT= stays 100% backward-compatible
    const inspectRun = render(["stills"], {
      AT: "1",
      INSPECT: "0,0,0,-6,0,0,50",
    });
    assert.equal(inspectRun.status, 0, inspectRun.stdout + inspectRun.stderr);
    const inspPx = sampleRgb(join(dir, "renders/still_1s.jpg"));
    assert.ok(inspPx.rgb[2] > 180 && inspPx.rgb[0] < 60);
  },
);

test("VIEWS fails cleanly when the film exposes no draw.tools.free", { timeout: 60000 }, (t) => {
  const chrome = findBrowser();
  if (!chrome) return t.skip("no Chrome binary available for live VIEWS verification");
  const { render } = setupRoomFilm(t, chrome, { withFree: false });

  const out = render(["stills"], {
    AT: "1",
    VIEWS: "corner:0,0,5,0,0,0,50",
  });
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /ERROR VIEWS requires draw\.tools\.free/);
});
