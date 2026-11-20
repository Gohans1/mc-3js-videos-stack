// Persistent Chrome shader-cache slots, CHECK=seen/text + INSPECT/VIEWS warning, and single-frame CHECK=probe
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

import * as THREE from "three";

import { projectBoundsToScreen } from "../render/probe.ts";
import { acquireChromeProfile } from "../src/chrome-profile.mjs";
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

const setupProbeFilm = (t, chrome) => {
  const dir = mkdtempSync(join(tmpdir(), "render-probe-gl-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ ...JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8")), end: 5 }),
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { chrome: relative(dir, chrome) } }),
  );
  const sceneFile = join(dir, "src/scene.ts");
  writeFileSync(
    sceneFile,
    `import * as THREE from "three";
export const DURATION = 5, SHOTS_OUT = [{ t: 0, what: "probe-stage" }];
export function buildScene(canvas, W, H) {
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202020);
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  scene.add(camera);

  // Dish box centered at (0, 1, 0), size 2 x 1 x 0.5 -> min [-1, 0.5, -0.25], max [1, 1.5, 0.25]
  const dish = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xdd4422 }),
  );
  dish.name = "dish_mesh";
  dish.position.set(0, 1, 0);
  scene.add(dish);

  // Actor group with a rotated pure Bone ("head") that has no geometry
  const elon = new THREE.Group();
  elon.name = "elon_root";
  elon.position.set(2, 0, 0);
  const head = new THREE.Bone();
  head.name = "head";
  head.position.set(0, 1.6, 0);
  head.rotation.x = Math.PI / 2; // local +Y -> world +Z, local +Z -> world -Y
  elon.add(head);
  scene.add(elon);

  // Hidden group containing a visible child mesh (effective visibility must be false)
  const hiddenParent = new THREE.Group();
  hiddenParent.visible = false;
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x22dd44 }),
  );
  ghost.name = "ghost_box";
  ghost.position.set(-2, 1, 0);
  hiddenParent.add(ghost);
  scene.add(hiddenParent);

  // Box behind the film camera (film camera sits at (0, 1, 5) looking toward (0, 1, 0))
  const behindBox = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x2244dd }),
  );
  behindBox.name = "behind_box";
  behindBox.position.set(0, 1, 10);
  scene.add(behindBox);

  // Extra named node not in draw.tools.objects (reachable via filter / *)
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.4),
    new THREE.MeshBasicMaterial({ color: 0xeecc22 }),
  );
  marker.name = "extra_marker";
  marker.position.set(-1.5, 0.2, 1);
  scene.add(marker);

  const free = {
    on: false,
    p: new THREE.Vector3(0, 1, 5),
    l: new THREE.Vector3(0, 1, 0),
    fov: 50,
  };
  const look = new THREE.Vector3(0, 1, 0);
  const draw = (t) => {
    // Move dish along +X slightly with t so probe proves draw(t) actually ran at t
    dish.position.set(t * 0.5, 1, 0);
    if (free.on) {
      camera.fov = free.fov;
      camera.position.copy(free.p);
      camera.lookAt(free.l);
    } else {
      camera.fov = 50;
      camera.position.set(0, 1, 5);
      camera.lookAt(look);
    }
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  draw.tools = {
    scene,
    camera,
    free,
    look,
    bones: { elonHead: head },
    objects: [
      [dish, "dish"],
      [elon, "elon"],
      [ghost, "ghost"],
      [behindBox, "behindBox"],
    ],
  };
  return draw;
}`,
  );
  const render = (args, env = {}) =>
    spawnSync("bun", [RENDER, ...args], {
      cwd: dir,
      encoding: "utf8",
      timeout: 180000,
      env: { ...process.env, LIVE_PROJECT: dir, ...env },
    });
  return { dir, render };
};

test("chrome-profile acquires locked slots, allocates concurrent slots, reclaims stale dead-PID locks, preserves cache files, and handles ephemeral fallbacks", (t) => {
  const root = mkdtempSync(join(tmpdir(), "chrome-profile-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rendersDir = join(root, "renders");

  // 1. Acquires slot-0 persistently with { pid, startedAt } lock file
  const first = acquireChromeProfile(rendersDir);
  assert.equal(first.persistent, true);
  assert.equal(first.slot, 0);
  assert.equal(first.dir, join(rendersDir, ".chrome-cache", "slot-0"));
  assert.ok(existsSync(first.dir));
  assert.ok(first.lockPath && existsSync(first.lockPath));
  const lockData = JSON.parse(readFileSync(first.lockPath, "utf8"));
  assert.equal(lockData.pid, process.pid);
  assert.equal(typeof lockData.startedAt, "string");

  // Simulate Chrome writing a shader cache artifact into slot-0
  const shaderMarker = join(first.dir, "GrShaderCache.bin");
  writeFileSync(shaderMarker, "compiled-shader-blob");

  // 2. Concurrent acquisition while slot-0 is held gets slot-1
  const second = acquireChromeProfile(rendersDir);
  assert.equal(second.persistent, true);
  assert.equal(second.slot, 1);
  assert.equal(second.dir, join(rendersDir, ".chrome-cache", "slot-1"));

  // 3. All slots busy falls back to an ephemeral tmpdir profile deleted on release
  const fallback = acquireChromeProfile(rendersDir, { maxSlots: 2 });
  assert.equal(fallback.persistent, false);
  assert.equal(fallback.slot, null);
  assert.ok(existsSync(fallback.dir));
  assert.ok(!fallback.dir.startsWith(rendersDir));
  fallback.release();
  assert.ok(!existsSync(fallback.dir), "ephemeral fallback profile must be deleted on release");

  // 4. Release removes slot lock files while preserving cached shader files on disk
  first.release();
  first.release(); // idempotent
  second.release();
  assert.ok(!existsSync(first.lockPath), "slot-0 lock file must be removed on release");
  assert.ok(!existsSync(second.lockPath), "slot-1 lock file must be removed on release");
  assert.equal(
    readFileSync(shaderMarker, "utf8"),
    "compiled-shader-blob",
    "cached shader files must survive slot release",
  );

  // 5. Re-acquiring reuses slot-0 and sees the preserved shader cache
  const reused = acquireChromeProfile(rendersDir);
  assert.equal(reused.persistent, true);
  assert.equal(reused.slot, 0);
  assert.equal(readFileSync(join(reused.dir, "GrShaderCache.bin"), "utf8"), "compiled-shader-blob");
  reused.release();

  // 6. Stale dead-PID lock on slot-0 is reclaimed cleanly
  const staleLock = join(rendersDir, ".chrome-cache", "slot-0.lock");
  writeFileSync(
    staleLock,
    JSON.stringify({ pid: 99999999, startedAt: "2020-01-01T00:00:00.000Z" }),
  );
  const reclaimed = acquireChromeProfile(rendersDir);
  assert.equal(reclaimed.persistent, true);
  assert.equal(reclaimed.slot, 0);
  assert.equal(JSON.parse(readFileSync(staleLock, "utf8")).pid, process.pid);
  reclaimed.release();
  assert.ok(!existsSync(staleLock));

  // 7. fresh: true (RENDER_FRESH_CACHE=1) skips persistent slots and deletes temp dir on release
  const fresh = acquireChromeProfile(rendersDir, { fresh: true });
  assert.equal(fresh.persistent, false);
  assert.equal(fresh.slot, null);
  assert.ok(existsSync(fresh.dir));
  assert.ok(!existsSync(staleLock), "fresh mode must not lock persistent slots");
  fresh.release();
  assert.ok(!existsSync(fresh.dir), "fresh profile must be deleted on release");

  // 8. Unwritable renders path (blocked by a regular file) falls back cleanly to ephemeral profile
  const blockedRenders = join(root, "blocked-renders");
  writeFileSync(blockedRenders, "not-a-directory");
  const unwritable = acquireChromeProfile(blockedRenders);
  assert.equal(unwritable.persistent, false);
  assert.ok(existsSync(unwritable.dir));
  unwritable.release();
  assert.ok(!existsSync(unwritable.dir));
});

test(
  "render CLI validates CHECK=probe syntax and RENDER_FRESH_CACHE before Chrome boots",
  { timeout: 30000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "render-probe-cli-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    copyDemo(dir);
    const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
    writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 5 }));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
    const run = (args, env = {}) =>
      spawnSync("bun", [RENDER, ...args], {
        cwd: dir,
        encoding: "utf8",
        timeout: 20000,
        env: { ...process.env, LIVE_PROJECT: dir, ...env },
      });

    for (const badCheck of [
      "probe",
      "probe:",
      "probe:notatime",
      "probe:-1",
      "probe:,2",
      "probe:   ,2",
      "probe:|,2",
      "probe:dish|,2",
      "probe:|dish,2",
      "probe:dish||head,2",
      "probe:dish,notatime",
      "probe:dish,",
      "probe:dish,1,2",
      "probe:dish,99",
    ]) {
      const out = run(["stills"], { CHECK: badCheck });
      assert.equal(
        out.status,
        2,
        `expected exit 2 for CHECK=${badCheck}: ${out.stdout + out.stderr}`,
      );
      assert.doesNotMatch(out.stdout + out.stderr, /built in/i);
    }

    const badCacheFlag = run(["stills"], { RENDER_FRESH_CACHE: "maybe" });
    assert.equal(badCacheFlag.status, 2, badCacheFlag.stdout + badCacheFlag.stderr);
    assert.match(badCacheFlag.stderr, /RENDER_FRESH_CACHE/);

    const help = run(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /CHECK=probe/);
    assert.match(help.stdout, /RENDER_FRESH_CACHE/);
  },
);

test(
  "CHECK=probe runs live in headless Chrome, reports exact worldPos/Box3/axes/screen/INSPECT, preserves .chrome-cache, and CHECK=seen/text warns on INSPECT/VIEWS",
  { timeout: 180000 },
  (t) => {
    const chrome = findBrowser();
    if (!chrome) return t.skip("no Chrome binary available for live CHECK=probe verification");
    const { dir, render } = setupProbeFilm(t, chrome);

    // 1. Unfiltered CHECK=probe:2 probes all draw.tools.objects at t=2 with film camera
    const allRun = render(["stills"], { CHECK: "probe:2" });
    assert.equal(allRun.status, 0, allRun.stdout + allRun.stderr);
    assert.doesNotMatch(allRun.stderr, /ignores INSPECT\/VIEWS/);
    assert.match(allRun.stdout, /wrote renders\/probe_2s\.json/);

    const reportAll = JSON.parse(readFileSync(join(dir, "renders/probe_2s.json"), "utf8"));
    assert.equal(reportAll.t, 2);
    assert.equal(reportAll.sceneT, 2);
    assert.equal(reportAll.camera.mode, "film");
    assert.deepEqual(reportAll.camera.p, [0, 1, 5]);
    assert.deepEqual(reportAll.camera.l, [0, 1, 0]);
    assert.equal(reportAll.camera.fov, 50);

    const byName = Object.fromEntries(reportAll.targets.map((x) => [x.name, x]));
    assert.deepEqual(Object.keys(byName).sort(), ["behindBox", "dish", "elon", "ghost"]);

    // Dish moved to x = 2 * 0.5 = 1, y = 1, z = 0, box size [2, 1, 0.5]
    assert.equal(byName.dish.visible, true);
    assert.deepEqual(byName.dish.worldPos, [1, 1, 0]);
    assert.deepEqual(byName.dish.bounds.min, [0, 0.5, -0.25]);
    assert.deepEqual(byName.dish.bounds.max, [2, 1.5, 0.25]);
    assert.deepEqual(byName.dish.bounds.size, [2, 1, 0.5]);
    assert.ok(Math.abs(byName.dish.cameraDist - Math.hypot(1, 0, 5)) < 0.01);
    assert.equal(byName.dish.screen.inView, true);
    assert.ok(
      byName.dish.screen.x0 >= 0.45 && byName.dish.screen.x0 <= 0.55,
      `x0=${byName.dish.screen.x0}`,
    );
    assert.ok(byName.dish.screen.x1 > byName.dish.screen.x0 && byName.dish.screen.x1 <= 1);
    assert.ok(byName.dish.screen.y0 >= 0 && byName.dish.screen.y0 < 0.5);
    assert.ok(byName.dish.screen.y1 > 0.5 && byName.dish.screen.y1 <= 1);

    // Hidden parent makes ghost effectively invisible
    assert.equal(byName.ghost.visible, false);

    // behindBox sits at (0, 1, 10) behind camera at (0, 1, 5) looking at (0, 1, 0)
    assert.equal(byName.behindBox.visible, true);
    assert.equal(byName.behindBox.screen.inView, false);
    assert.equal(byName.behindBox.screen.behind, true);

    // Persistent Chrome cache slot-0 exists and its lock was cleanly released on exit
    const slot0Dir = join(dir, "renders/.chrome-cache/slot-0");
    const slot0Lock = join(dir, "renders/.chrome-cache/slot-0.lock");
    assert.ok(existsSync(slot0Dir), "persistent slot-0 directory should exist after render");
    assert.ok(!existsSync(slot0Lock), "slot-0 lock should be released after render");
    writeFileSync(join(slot0Dir, "keep-cache.marker"), "persisted");

    // 2. Filtered CHECK=probe:dish|elon.head,2 + INSPECT= honors Free Cam and reports bone axes
    const inspectRun = render(["stills"], {
      INSPECT: "1,1,9,1,1,0,40",
      CHECK: "probe:dish|elon.head,2",
    });
    assert.equal(inspectRun.status, 0, inspectRun.stdout + inspectRun.stderr);
    assert.doesNotMatch(
      inspectRun.stderr,
      /ignores INSPECT\/VIEWS/,
      "CHECK=probe honors INSPECT and must not warn",
    );

    const reportInsp = JSON.parse(readFileSync(join(dir, "renders/probe_2s.json"), "utf8"));
    assert.equal(reportInsp.camera.mode, "inspect");
    assert.deepEqual(reportInsp.camera.p, [1, 1, 9]);
    assert.deepEqual(reportInsp.camera.l, [1, 1, 0]);
    assert.equal(reportInsp.camera.fov, 40);

    const inspByName = Object.fromEntries(reportInsp.targets.map((x) => [x.name, x]));
    assert.deepEqual(Object.keys(inspByName).sort(), ["dish", "head"]);

    // Dish centered directly ahead of INSPECT camera at distance 9m -> symmetric around x=0.5, y=0.5
    assert.ok(Math.abs(inspByName.dish.cameraDist - 9) < 0.01);
    assert.ok(
      Math.abs((inspByName.dish.screen.x0 + inspByName.dish.screen.x1) / 2 - 0.5) < 0.02,
      `expected centered dish under INSPECT, got ${JSON.stringify(inspByName.dish.screen)}`,
    );

    // Pure bone head has worldPos [2, 1.6, 0], bounds === null, and rotated +Y/+Z world axes
    assert.deepEqual(inspByName.head.worldPos, [2, 1.6, 0]);
    assert.equal(inspByName.head.bounds, null);
    assert.deepEqual(inspByName.head.axes.y, [0, 0, 1]);
    assert.deepEqual(inspByName.head.axes.z, [0, -1, 0]);
    assert.equal(inspByName.head.screen.inView, true);

    // 3. Wildcard CHECK=probe:*,1 discovers named scene nodes outside draw.tools.objects
    const wildRun = render(["stills"], { CHECK: "probe:*,1" });
    assert.equal(wildRun.status, 0, wildRun.stdout + wildRun.stderr);
    const reportWild = JSON.parse(readFileSync(join(dir, "renders/probe_1s.json"), "utf8"));
    const wildNames = reportWild.targets.map((x) => x.name);
    assert.ok(wildNames.includes("extra_marker"), `expected extra_marker in ${wildNames}`);
    assert.ok(wildNames.includes("head"), `expected head bone in ${wildNames}`);

    // 4. Stills render cleans old stills WITHOUT touching .chrome-cache
    const stillRun = render(["stills"], { AT: "1" });
    assert.equal(stillRun.status, 0, stillRun.stdout + stillRun.stderr);
    assert.equal(
      readFileSync(join(slot0Dir, "keep-cache.marker"), "utf8"),
      "persisted",
      "rendering stills must never delete .chrome-cache",
    );

    // 5. CHECK=seen + INSPECT= emits explicit stderr warning before rendering
    const seenWarn = render(["stills"], {
      INSPECT: "0,1,8,0,1,0,50",
      CHECK: "seen:dish,1,1.1",
    });
    assert.equal(seenWarn.status, 0, seenWarn.stdout + seenWarn.stderr);
    assert.match(
      seenWarn.stderr,
      /warning: CHECK=seen measures the film's own camera and ignores INSPECT\/VIEWS/,
    );

    // 6. CHECK=text + VIEWS= emits explicit stderr warning before rendering
    const textWarn = render(["stills"], {
      VIEWS: "front:0,1,8,0,1,0,50",
      CHECK: "text:0,1",
    });
    assert.equal(textWarn.status, 0, textWarn.stdout + textWarn.stderr);
    assert.match(
      textWarn.stderr,
      /warning: CHECK=text measures the film's own camera and ignores INSPECT\/VIEWS/,
    );

    // 7. RENDER_FRESH_CACHE=1 runs cleanly without locking or recreating persistent .chrome-cache
    rmSync(join(dir, "renders/.chrome-cache"), { recursive: true, force: true });
    const freshRun = render(["stills"], {
      RENDER_FRESH_CACHE: "1",
      CHECK: "probe:dish,1",
    });
    assert.equal(freshRun.status, 0, freshRun.stdout + freshRun.stderr);
    assert.ok(
      !existsSync(join(dir, "renders/.chrome-cache")),
      "RENDER_FRESH_CACHE=1 must bypass renders/.chrome-cache",
    );
  },
);

test("projectBoundsToScreen handles centered boxes, near-plane straddling boxes, offscreen boxes, and behind-camera targets", () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 1, 5);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  // Box centered in front of camera
  const frontBox = new THREE.Box3(new THREE.Vector3(-1, 0.5, -0.5), new THREE.Vector3(1, 1.5, 0.5));
  const front = projectBoundsToScreen(frontBox, new THREE.Vector3(0, 1, 0), camera);
  assert.equal(front.inView, true);
  assert.equal(front.behind, undefined);
  assert.ok(Math.abs((front.x0 + front.x1) / 2 - 0.5) < 0.01);
  assert.ok(Math.abs((front.y0 + front.y1) / 2 - 0.5) < 0.01);

  // Large floor straddling behind and in front of the camera (must clip cleanly against near plane, never flip to y0=0)
  const floorBox = new THREE.Box3(new THREE.Vector3(-10, -0.1, -10), new THREE.Vector3(10, 0, 10));
  const floor = projectBoundsToScreen(floorBox, new THREE.Vector3(0, 0, 0), camera);
  assert.equal(floor.inView, true);
  assert.ok(
    floor.y0 > 0.45 && floor.y1 === 1,
    `expected lower half screen rect, got ${JSON.stringify(floor)}`,
  );
  assert.equal(floor.x0, 0);
  assert.equal(floor.x1, 1);

  // Box offscreen to the right (still in front of camera)
  const rightBox = new THREE.Box3(new THREE.Vector3(20, 0.5, -1), new THREE.Vector3(21, 1.5, 0));
  const right = projectBoundsToScreen(rightBox, new THREE.Vector3(20.5, 1, -0.5), camera);
  assert.equal(right.inView, false);
  assert.equal(right.behind, undefined);

  // Box completely behind camera
  const backBox = new THREE.Box3(new THREE.Vector3(-1, 0.5, 8), new THREE.Vector3(1, 1.5, 10));
  const back = projectBoundsToScreen(backBox, new THREE.Vector3(0, 1, 9), camera);
  assert.equal(back.inView, false);
  assert.equal(back.behind, true);

  // Pure point (bone) behind camera
  const backPt = projectBoundsToScreen(null, new THREE.Vector3(0, 1, 9), camera);
  assert.equal(backPt.inView, false);
  assert.equal(backPt.behind, true);
});
