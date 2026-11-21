// Persistent Chrome shader-cache slots, CHECK=seen/text/probe + INSPECT/VIEWS warnings, and single-frame CHECK=probe
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
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as THREE from "three";

import {
  collectProbeTargets,
  measureProbeTarget,
  probeCheck,
  projectBoundsToScreen,
} from "../render/probe.ts";
import { acquireChromeProfile, inspectLock, isPidAlive } from "../src/chrome-profile.mjs";
import { STUDIO } from "../src/film.mjs";
import { setTiming } from "../src/timing-state.mjs";

const RENDER = fileURLToPath(new URL("../render.mjs", import.meta.url));
const FRAMECHECK = fileURLToPath(new URL("../framecheck.mjs", import.meta.url));

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

const makeTempDir = (t, prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const makePerspectiveCamera = () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 1, 5);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
};

// ---------------- chrome-profile.mjs unit tests ----------------

test("chrome-profile acquires locked slots, allocates concurrent slots, and preserves cached files on release", (t) => {
  const root = makeTempDir(t, "chrome-profile-slots-");
  const rendersDir = join(root, "renders");

  const first = acquireChromeProfile(rendersDir);
  assert.equal(first.persistent, true);
  assert.equal(first.slot, 0);
  assert.equal(first.dir, join(rendersDir, ".chrome-cache", "slot-0"));
  assert.ok(existsSync(first.dir));
  assert.ok(first.lockPath && existsSync(first.lockPath));
  const lockData = JSON.parse(readFileSync(first.lockPath, "utf8"));
  assert.equal(lockData.pid, process.pid);
  assert.equal(typeof lockData.startedAt, "string");

  const shaderMarker = join(first.dir, "GrShaderCache.bin");
  writeFileSync(shaderMarker, "compiled-shader-blob");

  const second = acquireChromeProfile(rendersDir);
  assert.equal(second.persistent, true);
  assert.equal(second.slot, 1);
  assert.equal(second.dir, join(rendersDir, ".chrome-cache", "slot-1"));

  first.release();
  first.release(); // idempotent
  second.release();
  assert.ok(!existsSync(first.lockPath), "slot-0 lock file must be removed on release");
  assert.ok(!existsSync(second.lockPath), "slot-1 lock file must be removed on release");
  assert.equal(readFileSync(shaderMarker, "utf8"), "compiled-shader-blob");

  const reused = acquireChromeProfile(rendersDir);
  assert.equal(reused.persistent, true);
  assert.equal(reused.slot, 0);
  assert.equal(readFileSync(join(reused.dir, "GrShaderCache.bin"), "utf8"), "compiled-shader-blob");
  reused.release();
});

test("chrome-profile reclaims stale dead-PID locks", (t) => {
  const root = makeTempDir(t, "chrome-profile-stale-");
  const rendersDir = join(root, "renders");
  const cacheDir = join(rendersDir, ".chrome-cache");
  mkdirSync(cacheDir, { recursive: true });

  const staleLock = join(cacheDir, "slot-0.lock");
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
});

test("chrome-profile falls back to ephemeral tmpdir when all slots are busy, fresh is set, or rendersDir is unwritable", (t) => {
  const root = makeTempDir(t, "chrome-profile-fallback-");
  const rendersDir = join(root, "renders");

  const s0 = acquireChromeProfile(rendersDir, { maxSlots: 2 });
  const s1 = acquireChromeProfile(rendersDir, { maxSlots: 2 });
  const busy = acquireChromeProfile(rendersDir, { maxSlots: 2 });
  assert.equal(busy.persistent, false);
  assert.equal(busy.slot, null);
  assert.ok(existsSync(busy.dir));
  assert.ok(!busy.dir.startsWith(rendersDir));
  busy.release();
  assert.ok(!existsSync(busy.dir), "ephemeral fallback must be deleted on release");
  s0.release();
  s1.release();

  const fresh = acquireChromeProfile(rendersDir, { fresh: true });
  assert.equal(fresh.persistent, false);
  assert.equal(fresh.slot, null);
  assert.ok(existsSync(fresh.dir));
  assert.ok(!existsSync(join(rendersDir, ".chrome-cache", "slot-0.lock")));
  fresh.release();
  assert.ok(!existsSync(fresh.dir));

  const blockedRenders = join(root, "blocked-renders");
  writeFileSync(blockedRenders, "not-a-directory");
  const unwritable = acquireChromeProfile(blockedRenders);
  assert.equal(unwritable.persistent, false);
  assert.ok(existsSync(unwritable.dir));
  unwritable.release();
  assert.ok(!existsSync(unwritable.dir));
});

test("chrome-profile treats fresh empty/corrupt lock files as live and expired ones as stale", (t) => {
  const root = makeTempDir(t, "chrome-profile-corrupt-");
  const rendersDir = join(root, "renders");
  const cacheDir = join(rendersDir, ".chrome-cache");
  mkdirSync(cacheDir, { recursive: true });

  const lockPath = join(cacheDir, "slot-0.lock");
  writeFileSync(lockPath, "{"); // half-written JSON
  const fixedNow = Date.now();
  const recent = new Date(fixedNow - 500);
  utimesSync(lockPath, recent, recent);

  assert.equal(
    inspectLock(
      lockPath,
      () => true,
      () => fixedNow,
      5000,
    ),
    "live",
  );
  const whileFresh = acquireChromeProfile(rendersDir, {
    now: () => fixedNow,
    staleGraceMs: 5000,
  });
  assert.equal(whileFresh.slot, 1, "must skip fresh corrupt lock instead of clobbering it");
  whileFresh.release();

  const old = new Date(fixedNow - 10_000);
  utimesSync(lockPath, old, old);
  assert.equal(
    inspectLock(
      lockPath,
      () => true,
      () => fixedNow,
      5000,
    ),
    "stale",
  );
  const afterExpiry = acquireChromeProfile(rendersDir, {
    now: () => fixedNow,
    staleGraceMs: 5000,
  });
  assert.equal(afterExpiry.slot, 0, "must reclaim expired corrupt lock");
  afterExpiry.release();
});

test("chrome-profile release does not unlink a lock whose token changed", (t) => {
  const root = makeTempDir(t, "chrome-profile-token-");
  const rendersDir = join(root, "renders");

  const first = acquireChromeProfile(rendersDir);
  assert.equal(first.slot, 0);
  const replacement = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: "other-owner-token",
  });
  writeFileSync(first.lockPath, replacement);

  first.release();
  assert.ok(existsSync(first.lockPath), "release must leave another owner's lock intact");
  assert.equal(JSON.parse(readFileSync(first.lockPath, "utf8")).token, "other-owner-token");
});

test("chrome-profile serializes stale-lock reclamation so contenders take distinct slots without clobbering", (t) => {
  const root = makeTempDir(t, "chrome-profile-reclaim-");
  const rendersDir = join(root, "renders");
  const cacheDir = join(rendersDir, ".chrome-cache");
  mkdirSync(cacheDir, { recursive: true });

  const slot0Lock = join(cacheDir, "slot-0.lock");
  const reclaimGuard = `${slot0Lock}.reclaim`;

  // Case A: an active fresh .reclaim guard on slot-0 forces a concurrent caller to take slot-1
  writeFileSync(
    slot0Lock,
    JSON.stringify({ pid: 99999999, startedAt: "2020-01-01T00:00:00.000Z" }),
  );
  writeFileSync(reclaimGuard, JSON.stringify({ pid: process.pid }));
  const contender = acquireChromeProfile(rendersDir);
  assert.equal(contender.slot, 1, "contender must skip slot with active reclaim guard");
  assert.ok(existsSync(slot0Lock), "contender must not unlink slot-0 lock while guard is active");
  assert.ok(existsSync(reclaimGuard), "contender must not remove active reclaim guard");
  contender.release();
  unlinkSync(reclaimGuard);

  // Case B: another process wins slot-0 right before our guard re-check -> winner keeps slot-0, we take slot-1
  let checks = 0;
  const interleaved = acquireChromeProfile(rendersDir, {
    isAlive(pid) {
      checks++;
      if (checks === 1 && pid === 99999999) {
        writeFileSync(
          slot0Lock,
          JSON.stringify({
            pid: process.pid,
            startedAt: new Date().toISOString(),
            token: "winner",
          }),
        );
        return false;
      }
      return pid === process.pid;
    },
  });
  assert.equal(
    interleaved.slot,
    1,
    "re-check inside reclaim guard must see winner and take slot-1",
  );
  assert.equal(JSON.parse(readFileSync(slot0Lock, "utf8")).token, "winner");
  assert.ok(!existsSync(reclaimGuard), "reclaim guard must be cleaned up in finally");
  interleaved.release();
  unlinkSync(slot0Lock);
});

test("chrome-profile handles ENOENT between EEXIST and inspectLock without unlinking a newly acquired lock", (t) => {
  const root = makeTempDir(t, "chrome-profile-enoent-");
  const rendersDir = join(root, "renders");
  const cacheDir = join(rendersDir, ".chrome-cache");
  mkdirSync(cacheDir, { recursive: true });
  const slot0Lock = join(cacheDir, "slot-0.lock");

  // Pure inspectLock state check: missing file returns "missing"
  assert.equal(
    inspectLock(
      slot0Lock,
      () => true,
      () => Date.now(),
      5000,
    ),
    "missing",
  );

  // Stale lock disappears right before guard re-check -> retries tryCreateLock directly without unlinking
  writeFileSync(
    slot0Lock,
    JSON.stringify({ pid: 99999999, startedAt: "2020-01-01T00:00:00.000Z" }),
  );
  let firstCall = true;
  const acquired = acquireChromeProfile(rendersDir, {
    isAlive(pid) {
      if (firstCall && pid === 99999999) {
        firstCall = false;
        unlinkSync(slot0Lock); // disappeared before re-check
        return false;
      }
      return pid === process.pid;
    },
  });
  assert.equal(acquired.persistent, true);
  assert.equal(acquired.slot, 0);
  acquired.release();
});

test("chrome-profile rejects non-positive PIDs in isPidAlive and recovers expired .reclaim guards", (t) => {
  assert.equal(isPidAlive(0), false);
  assert.equal(isPidAlive(-1), false);
  assert.equal(isPidAlive(NaN), false);
  assert.equal(isPidAlive(process.pid), true);

  const root = makeTempDir(t, "chrome-profile-expired-reclaim-");
  const rendersDir = join(root, "renders");
  const cacheDir = join(rendersDir, ".chrome-cache");
  mkdirSync(cacheDir, { recursive: true });
  const slot0Lock = join(cacheDir, "slot-0.lock");
  const reclaimGuard = `${slot0Lock}.reclaim`;

  const fixedNow = Date.now();
  const expired = new Date(fixedNow - 10_000);
  writeFileSync(
    slot0Lock,
    JSON.stringify({ pid: 99999999, startedAt: "2020-01-01T00:00:00.000Z" }),
  );
  writeFileSync(reclaimGuard, JSON.stringify({ pid: 99999999, token: "crashed-reclaimer" }));
  utimesSync(reclaimGuard, expired, expired);

  const recovered = acquireChromeProfile(rendersDir, {
    now: () => fixedNow,
    staleGraceMs: 5000,
  });
  assert.equal(recovered.persistent, true);
  assert.equal(recovered.slot, 0, "expired .reclaim guard must be claimed and slot-0 reclaimed");
  assert.ok(!existsSync(reclaimGuard), ".reclaim guard must be cleaned up after recovery");
  recovered.release();
});

// ---------------- probe.ts unit tests ----------------

test("measureProbeTarget excludes hidden descendants while still measuring a hidden root target itself", () => {
  const camera = makePerspectiveCamera();
  const group = new THREE.Group();
  const visibleChild = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial(),
  );
  const hiddenOutlier = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial(),
  );
  hiddenOutlier.position.set(100, 0, 0);
  hiddenOutlier.visible = false;
  group.add(visibleChild, hiddenOutlier);
  group.updateMatrixWorld(true);

  const measured = measureProbeTarget(group, "actor", camera);
  assert.equal(measured.visible, true);
  assert.deepEqual(measured.bounds?.min, [-1, -1, -1]);
  assert.deepEqual(measured.bounds?.max, [1, 1, 1]);
  assert.deepEqual(measured.bounds?.size, [2, 2, 2]);

  // Probing a hidden root target itself still reports its own geometry with visible: false
  const hiddenRoot = measureProbeTarget(hiddenOutlier, "outlier", camera);
  assert.equal(hiddenRoot.visible, false);
  assert.deepEqual(hiddenRoot.bounds?.min, [99, -1, -1]);
  assert.deepEqual(hiddenRoot.bounds?.max, [101, 1, 1]);
});

test("measureProbeTarget recomputes re-posed SkinnedMesh and updated InstancedMesh bounds", () => {
  const camera = makePerspectiveCamera();

  // SkinnedMesh whose boundingBox is computed at rest, then bone translates +5 along X
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const count = geo.attributes.position.count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(indices, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));

  const root = new THREE.Group();
  root.position.set(2, 0, 0);
  const bone = new THREE.Bone();
  const skinned = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  skinned.add(bone);
  root.add(skinned);
  root.updateMatrixWorld(true);
  skinned.bind(new THREE.Skeleton([bone]));
  skinned.computeBoundingBox(); // prime stale rest-pose boundingBox

  bone.position.set(5, 0, 0);
  const skinnedResult = measureProbeTarget(skinned, "rig", camera);
  assert.deepEqual(skinnedResult.bounds?.min, [6.5, -0.5, -0.5]);
  assert.deepEqual(skinnedResult.bounds?.max, [7.5, 0.5, 0.5]);

  // InstancedMesh updated after initial computeBoundingBox, then emptied (count = 0)
  const inst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    2,
  );
  inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
  inst.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1, 0, 0));
  inst.computeBoundingBox(); // prime stale boundingBox

  inst.setMatrixAt(1, new THREE.Matrix4().makeTranslation(6, 0, 0));
  const instUpdated = measureProbeTarget(inst, "cubes", camera);
  assert.deepEqual(instUpdated.bounds?.min, [-0.5, -0.5, -0.5]);
  assert.deepEqual(instUpdated.bounds?.max, [6.5, 0.5, 0.5]);

  inst.count = 0;
  const instEmpty = measureProbeTarget(inst, "cubes", camera);
  assert.equal(instEmpty.bounds, null);
});

test("measureProbeTarget handles zero-scale, moved-root/sibling-bone, unbound SkinnedMesh, and BatchedMesh bounds", () => {
  const camera = makePerspectiveCamera();
  const makeSkinnedGeo = () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const count = geo.attributes.position.count;
    const indices = new Uint16Array(count * 4);
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(indices, 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
    return geo;
  };

  // 1. Zero-scale SkinnedMesh inside a group must NOT NaN-poison valid sibling geometry
  const group = new THREE.Group();
  const validCube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  validCube.position.set(1, 0, 0);
  const zeroBone = new THREE.Bone();
  const zeroSkinned = new THREE.SkinnedMesh(makeSkinnedGeo(), new THREE.MeshBasicMaterial());
  zeroSkinned.add(zeroBone);
  zeroSkinned.bind(new THREE.Skeleton([zeroBone]));
  zeroSkinned.scale.set(0, 0, 0);
  group.add(validCube, zeroSkinned);

  const groupResult = measureProbeTarget(group, "safeGroup", camera);
  assert.deepEqual(groupResult.bounds?.min, [0, -1, -1]);
  assert.deepEqual(groupResult.bounds?.max, [2, 1, 1]);

  // 2. Moved-root attached SkinnedMesh with sibling bone called directly (no 2x translation)
  const rigRoot = new THREE.Group();
  const sibBone = new THREE.Bone();
  const attached = new THREE.SkinnedMesh(makeSkinnedGeo(), new THREE.MeshBasicMaterial());
  rigRoot.add(attached, sibBone);
  rigRoot.updateMatrixWorld(true);
  attached.bind(new THREE.Skeleton([sibBone]));
  rigRoot.position.set(10, 0, 0);

  const movedResult = measureProbeTarget(attached, "moved", camera);
  assert.deepEqual(movedResult.bounds?.min, [9.5, -0.5, -0.5]);
  assert.deepEqual(movedResult.bounds?.max, [10.5, 0.5, 0.5]);

  // 3. Unbound SkinnedMesh degrades cleanly without throwing
  const unbound = new THREE.SkinnedMesh(makeSkinnedGeo(), new THREE.MeshBasicMaterial());
  const unboundResult = measureProbeTarget(unbound, "unbound", camera);
  assert.equal(unboundResult.bounds, null);

  // 4. BatchedMesh recomputes updated instance matrices and returns null when emptied
  const batched = new THREE.BatchedMesh(4, 100, 200, new THREE.MeshBasicMaterial());
  const gid = batched.addGeometry(new THREE.BoxGeometry(1, 1, 1));
  const iid = batched.addInstance(gid);
  batched.setMatrixAt(iid, new THREE.Matrix4().makeTranslation(0, 0, 0));
  batched.computeBoundingBox(); // prime stale boundingBox

  batched.setMatrixAt(iid, new THREE.Matrix4().makeTranslation(4, 2, 0));
  const batchedUpdated = measureProbeTarget(batched, "batched", camera);
  assert.deepEqual(batchedUpdated.bounds?.min, [3.5, 1.5, -0.5]);
  assert.deepEqual(batchedUpdated.bounds?.max, [4.5, 2.5, 0.5]);

  batched.deleteInstance(iid);
  const batchedEmpty = measureProbeTarget(batched, "batched", camera);
  assert.equal(batchedEmpty.bounds, null);
});

test("collectProbeTargets disambiguates duplicate bone names and handles case-insensitive, dot-path, and missing filters", () => {
  const scene = new THREE.Scene();
  const steve = new THREE.Group();
  const steveHead = new THREE.Bone();
  steveHead.name = "Head";
  steve.add(steveHead);

  const alex = new THREE.Group();
  const alexHead = new THREE.Bone();
  alexHead.name = "Head";
  alex.add(alexHead);

  // Two unparented bones with the same .name disambiguated by tools.bones key
  const looseA = new THREE.Bone();
  looseA.name = "Grip";
  const looseB = new THREE.Bone();
  looseB.name = "Grip";
  scene.add(steve, alex, looseA, looseB);

  const tools = {
    scene,
    objects: [
      [steve, "Steve"],
      [alex, "Alex"],
    ],
    bones: { gripLeft: looseA, gripRight: looseB },
  };

  // Colliding matched names disambiguate via objectLabels ancestor
  const bothHeads = collectProbeTargets(tools, "head");
  assert.deepEqual(
    bothHeads.map((x) => x.name),
    ["Steve.Head", "Alex.Head"],
  );

  // Single dot-path match keeps clean base name without collision
  const onlyAlex = collectProbeTargets(tools, "ALEX.head");
  assert.deepEqual(
    onlyAlex.map((x) => x.name),
    ["Head"],
  );
  assert.equal(onlyAlex[0].obj, alexHead);

  // Colliding loose bones disambiguate via unique boneNames key
  const bothGrips = collectProbeTargets(tools, "grip");
  assert.deepEqual(
    bothGrips.map((x) => x.name),
    ["gripLeft", "gripRight"],
  );

  // Same-owner sibling name collisions fall back to owner.parentName.name
  const leftArm = new THREE.Group();
  leftArm.name = "leftArm";
  const leftJoint = new THREE.Bone();
  leftJoint.name = "Joint";
  leftArm.add(leftJoint);
  const rightArm = new THREE.Group();
  rightArm.name = "rightArm";
  const rightJoint = new THREE.Bone();
  rightJoint.name = "Joint";
  rightArm.add(rightJoint);
  steve.add(leftArm, rightArm);
  const sameOwnerJoints = collectProbeTargets(tools, "joint");
  assert.deepEqual(
    sameOwnerJoints.map((x) => x.name),
    ["Steve.leftArm.Joint", "Steve.rightArm.Joint"],
  );

  // Missing filter returns empty list cleanly
  assert.deepEqual(collectProbeTargets(tools, "does_not_exist"), []);
});

test("projectBoundsToScreen handles perspective, near-plane straddling, offscreen, behind, orthographic, and beyond-far targets", () => {
  const camera = makePerspectiveCamera();

  const frontBox = new THREE.Box3(new THREE.Vector3(-1, 0.5, -0.5), new THREE.Vector3(1, 1.5, 0.5));
  const front = projectBoundsToScreen(frontBox, new THREE.Vector3(0, 1, 0), camera);
  assert.equal(front.inView, true);
  assert.equal(front.behind, undefined);
  assert.ok(Math.abs((front.x0 + front.x1) / 2 - 0.5) < 0.01);
  assert.ok(Math.abs((front.y0 + front.y1) / 2 - 0.5) < 0.01);

  // Floor straddling near plane clips cleanly instead of flipping behind-camera corners to y0=0
  const floorBox = new THREE.Box3(new THREE.Vector3(-10, -0.1, -10), new THREE.Vector3(10, 0, 10));
  const floor = projectBoundsToScreen(floorBox, new THREE.Vector3(0, 0, 0), camera);
  assert.equal(floor.inView, true);
  assert.ok(
    floor.y0 > 0.45 && floor.y1 === 1,
    `expected lower half screen rect, got ${JSON.stringify(floor)}`,
  );
  assert.equal(floor.x0, 0);
  assert.equal(floor.x1, 1);
  assert.equal(
    floor.past,
    undefined,
    "a box the near plane cuts reaches past every edge unbounded",
  );

  const rightBox = new THREE.Box3(new THREE.Vector3(20, 0.5, -1), new THREE.Vector3(21, 1.5, 0));
  const right = projectBoundsToScreen(rightBox, new THREE.Vector3(20.5, 1, -0.5), camera);
  assert.equal(right.inView, false);
  assert.equal(right.behind, undefined);

  const backBox = new THREE.Box3(new THREE.Vector3(-1, 0.5, 8), new THREE.Vector3(1, 1.5, 10));
  const back = projectBoundsToScreen(backBox, new THREE.Vector3(0, 1, 9), camera);
  assert.equal(back.inView, false);
  assert.equal(back.behind, true);

  const backPt = projectBoundsToScreen(null, new THREE.Vector3(0, 1, 9), camera);
  assert.equal(backPt.inView, false);
  assert.equal(backPt.behind, true);

  // Beyond far plane (camera far = 100 from z = 5 -> z < -95 is beyond far plane)
  const farBox = new THREE.Box3(new THREE.Vector3(-1, 0.5, -120), new THREE.Vector3(1, 1.5, -110));
  const far = projectBoundsToScreen(farBox, new THREE.Vector3(0, 1, -115), camera);
  assert.equal(far.inView, false);
  assert.equal(far.behind, undefined);

  // OrthographicCamera projection
  const ortho = new THREE.OrthographicCamera(-4, 4, 2, -2, 0.1, 20);
  ortho.position.set(0, 0, 5);
  ortho.lookAt(0, 0, 0);
  ortho.updateMatrixWorld(true);
  ortho.updateProjectionMatrix();
  const orthoBox = new THREE.Box3(new THREE.Vector3(-2, -1, -0.5), new THREE.Vector3(2, 1, 0.5));
  const orthoScreen = projectBoundsToScreen(orthoBox, new THREE.Vector3(0, 0, 0), ortho);
  assert.equal(orthoScreen.inView, true);
  assert.deepEqual(
    [orthoScreen.x0, orthoScreen.y0, orthoScreen.x1, orthoScreen.y1],
    [0.25, 0.25, 0.75, 0.75],
  );
  assert.equal(orthoScreen.past, undefined);
});

// hiding a head past the top edge took 3 wrong-way tries when the rect stopped at 0: how far past each edge is said
test("projectBoundsToScreen says how far past each edge, in frames, a cut-off box reaches", () => {
  const ortho = new THREE.OrthographicCamera(-4, 4, 2, -2, 0.1, 20);
  ortho.position.set(0, 0, 5);
  ortho.lookAt(0, 0, 0);
  ortho.updateMatrixWorld(true);
  ortho.updateProjectionMatrix();
  const head = projectBoundsToScreen(
    new THREE.Box3(new THREE.Vector3(3, 1, -0.5), new THREE.Vector3(5, 2.5, 0.5)),
    new THREE.Vector3(4, 1.75, 0),
    ortho,
  );
  assert.equal(head.inView, true);
  assert.equal(head.y0, 0);
  assert.deepEqual(head.past, { top: 0.125, right: 0.125 });
});

test("probeCheck restores tools.free on success and error, and maps sceneT under non-identity timing", async () => {
  const scene = new THREE.Scene();
  const camera = makePerspectiveCamera();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  scene.add(box);
  const free = {
    on: false,
    p: new THREE.Vector3(1, 2, 3),
    l: new THREE.Vector3(4, 5, 6),
    fov: 55,
    roll: 12,
  };
  const posted = [];
  const postStub = async (url, body) => {
    posted.push({ url, report: JSON.parse(body) });
  };

  setTiming({ speeds: [{ from: 0, to: 4, rate: 2 }], freezes: [{ at: 2, duration: 1 }] }, 4);
  try {
    // 1. Normal run with INSPECT mutating free.roll during draw -> restores all fields cleanly
    const renderOk = Object.assign(
      () => {
        assert.equal(free.on, true);
        assert.equal(free.fov, 40);
        free.roll = 99;
      },
      { tools: { scene, camera, free, objects: [[box, "box"]] } },
    );
    // At heard t=0.5 under 2x speed (0..4 -> heard 0..2), sceneT = 1.0
    await probeCheck(renderOk, { inspect: [0, 1, 8, 0, 1, 0, 40] }, postStub)("box", 0.5);
    assert.equal(free.on, false);
    assert.equal(free.fov, 55);
    assert.equal(free.roll, 12);
    assert.deepEqual(free.p.toArray(), [1, 2, 3]);
    assert.deepEqual(free.l.toArray(), [4, 5, 6]);
    assert.equal(posted[0].url, "/still/probe_0.5s.json");
    assert.equal(posted[0].report.t, 0.5);
    assert.equal(posted[0].report.sceneT, 1);

    // 2. Thrown draw(t) still restores free cleanly via finally
    const renderFail = Object.assign(
      () => {
        free.roll = -77;
        throw new Error("boom");
      },
      { tools: { scene, camera, free, objects: [[box, "box"]] } },
    );
    await assert.rejects(
      () => probeCheck(renderFail, { inspect: [0, 1, 8, 0, 1, 0, 40] }, postStub)("box", 0.5),
      /boom/,
    );
    assert.equal(free.on, false);
    assert.equal(free.fov, 55);
    assert.equal(free.roll, 12);
    assert.deepEqual(free.p.toArray(), [1, 2, 3]);
    assert.deepEqual(free.l.toArray(), [4, 5, 6]);
  } finally {
    setTiming({}, 0);
  }
});

// a soft target is a focus question: where the lens focused and how blurred each target is, in a 1920-wide frame's px
test("probeCheck says where the lens focuses and how blurred each target is", async () => {
  const scene = new THREE.Scene();
  const camera = makePerspectiveCamera();
  const near = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
  near.position.set(0, 1, 3);
  const far = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
  far.position.set(0, 1, 0);
  scene.add(near, far);
  const optics = { mm: 50, fstop: 2, focusM: 2, focusTarget: "near" };
  const objects = [
    [near, "near"],
    [far, "far"],
  ];
  const probe = (tools) =>
    probeCheck(
      Object.assign(() => {}, { tools }),
      {},
      async () => {},
    )("*", 1);
  const lines = await probe({ scene, camera, optics, objects });
  assert.match(lines[0], / focus 2\.00 m on near, f\/2, 50 mm /);
  // the focus distance is the near box's: it is sharp; 5 m off, the far box blurs by blurPx's circle of confusion
  assert.match(
    lines.find((l) => l.startsWith("  near")),
    / blur 0\.0 px/,
  );
  assert.match(
    lines.find((l) => l.startsWith("  far")),
    / blur 20\.5 px/,
  );
  // with no aperture the lens is all sharp, and nothing is said of focus
  const pinhole = await probe({ scene, camera, optics: { ...optics, fstop: 0 }, objects });
  assert.doesNotMatch(pinhole.join("\n"), /focus|blur/);
});

// ---------------- render CLI validation tests ----------------

test(
  "render CLI validates CHECK=probe syntax, RENDER_FRESH_CACHE flag/typos, and help before Chrome boots",
  { timeout: 30000 },
  (t) => {
    const dir = makeTempDir(t, "render-probe-cli-");
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

    const flagForm = run(["--render_fresh_cache=1", "stills"]);
    assert.equal(flagForm.status, 2, flagForm.stdout + flagForm.stderr);
    assert.match(flagForm.stderr, /RENDER_FRESH_CACHE is an environment variable/);

    const hyphenFlag = run(["--render-fresh-cache=1", "stills"]);
    assert.equal(hyphenFlag.status, 2, hyphenFlag.stdout + hyphenFlag.stderr);
    assert.match(hyphenFlag.stderr, /RENDER_FRESH_CACHE is an environment variable/);

    const envTypo = run(["stills"], { RENDER_FRESH_CACH: "1" });
    assert.equal(envTypo.status, 2, envTypo.stdout + envTypo.stderr);
    assert.match(envTypo.stderr, /did you mean RENDER_FRESH_CACHE=1/);

    const help = run(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /CHECK=probe/);
    assert.match(help.stdout, /RENDER_FRESH_CACHE/);
  },
);

test("framecheck missing-video scan skips dot-directories like .chrome-cache and .prev", (t) => {
  const dir = makeTempDir(t, "framecheck-dotdir-");
  copyDemo(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  mkdirSync(join(dir, "renders/.chrome-cache/slot-0"), { recursive: true });
  mkdirSync(join(dir, "renders/.prev"), { recursive: true });
  mkdirSync(join(dir, "renders/chunks"), { recursive: true });
  writeFileSync(join(dir, "renders/.chrome-cache/slot-0/cache.mp4"), "ignored");
  writeFileSync(join(dir, "renders/.prev/old.mp4"), "ignored");
  writeFileSync(join(dir, "renders/chunks/c00.mp4"), "listed");

  const out = spawnSync("bun", [FRAMECHECK, "renders/missing.mp4"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, LIVE_PROJECT: dir },
  });
  assert.equal(out.status, 2, out.stdout + out.stderr);
  assert.match(out.stderr, /renders\/chunks\/c00\.mp4/);
  assert.doesNotMatch(out.stderr, /\.chrome-cache|\.prev/);
});

// ---------------- Live headless Chrome verification ----------------

const setupProbeFilm = (t, chrome) => {
  const dir = makeTempDir(t, "render-probe-gl-");
  copyDemo(dir);
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ ...JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8")), end: 5 }),
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { chrome: relative(dir, chrome) } }),
  );
  writeFileSync(
    join(dir, "src/scene.ts"),
    `import * as THREE from "three";
export const DURATION = 5, SHOTS_OUT = [{ t: 0, what: "probe-stage" }];
export function buildScene(canvas, W, H) {
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202020);
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  scene.add(camera);

  const dish = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xdd4422 }),
  );
  dish.name = "dish_mesh";
  dish.position.set(0, 1, 0);
  scene.add(dish);

  const elon = new THREE.Group();
  elon.name = "elon_root";
  elon.position.set(2, 0, 0);
  const head = new THREE.Bone();
  head.name = "head";
  head.position.set(0, 1.6, 0);
  head.rotation.x = Math.PI / 2;
  elon.add(head);
  scene.add(elon);

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

  const behindBox = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x2244dd }),
  );
  behindBox.name = "behind_box";
  behindBox.position.set(0, 1, 10);
  scene.add(behindBox);

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

test(
  "CHECK=probe runs live in headless Chrome, honors INSPECT and restores free, preserves .chrome-cache, and warns on CHECK+INSPECT/VIEWS",
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
    assert.equal(byName.dish.visible, true);
    assert.deepEqual(byName.dish.worldPos, [1, 1, 0]);
    assert.deepEqual(byName.dish.bounds.min, [0, 0.5, -0.25]);
    assert.deepEqual(byName.dish.bounds.max, [2, 1.5, 0.25]);
    assert.deepEqual(byName.dish.bounds.size, [2, 1, 0.5]);
    assert.ok(Math.abs(byName.dish.cameraDist - Math.hypot(1, 0, 5)) < 0.01);
    assert.equal(byName.dish.screen.inView, true);
    assert.equal(byName.ghost.visible, false);
    assert.equal(byName.behindBox.screen.inView, false);
    assert.equal(byName.behindBox.screen.behind, true);

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
    assert.doesNotMatch(inspectRun.stderr, /ignores INSPECT\/VIEWS/);

    const reportInsp = JSON.parse(readFileSync(join(dir, "renders/probe_2s.json"), "utf8"));
    assert.equal(reportInsp.camera.mode, "inspect");
    assert.deepEqual(reportInsp.camera.p, [1, 1, 9]);
    assert.deepEqual(reportInsp.camera.l, [1, 1, 0]);
    assert.equal(reportInsp.camera.fov, 40);
    const inspByName = Object.fromEntries(reportInsp.targets.map((x) => [x.name, x]));
    assert.deepEqual(Object.keys(inspByName).sort(), ["dish", "head"]);
    assert.ok(Math.abs(inspByName.dish.cameraDist - 9) < 0.01);
    assert.ok(Math.abs((inspByName.dish.screen.x0 + inspByName.dish.screen.x1) / 2 - 0.5) < 0.02);
    assert.deepEqual(inspByName.head.worldPos, [2, 1.6, 0]);
    assert.equal(inspByName.head.bounds, null);
    assert.deepEqual(inspByName.head.axes.y, [0, 0, 1]);
    assert.deepEqual(inspByName.head.axes.z, [0, -1, 0]);

    // 3. Backwards INSPECT probe followed by CHECK=seen in the SAME boot proves probe restores free
    const chainedRun = render(["stills"], {
      INSPECT: "0,1,5,0,1,10,50", // faces +Z away from dish
      CHECK: "probe:dish,2;seen:dish,2,2.1",
    });
    assert.equal(chainedRun.status, 0, chainedRun.stdout + chainedRun.stderr);
    assert.match(
      chainedRun.stderr,
      /warning: CHECK=seen measures the film's own camera and ignores INSPECT\/VIEWS/,
    );
    const chainedProbe = JSON.parse(readFileSync(join(dir, "renders/probe_2s.json"), "utf8"));
    assert.equal(chainedProbe.targets[0].screen.behind, true, "probe saw dish behind INSPECT cam");
    assert.doesNotMatch(
      chainedRun.stdout,
      /OUT OF FRAME|0\.0% of the frame/,
      "seen ran after probe with free restored to film camera and saw dish in frame",
    );

    // 4. Wildcard CHECK=probe:*,1 discovers named scene nodes outside draw.tools.objects
    const wildRun = render(["stills"], { CHECK: "probe:*,1" });
    assert.equal(wildRun.status, 0, wildRun.stdout + wildRun.stderr);
    const reportWild = JSON.parse(readFileSync(join(dir, "renders/probe_1s.json"), "utf8"));
    const wildNames = reportWild.targets.map((x) => x.name);
    assert.ok(wildNames.includes("extra_marker"), `expected extra_marker in ${wildNames}`);
    assert.ok(wildNames.includes("head"), `expected head bone in ${wildNames}`);

    // 5. Stills render cleans old stills without touching .chrome-cache
    const stillRun = render(["stills"], { AT: "1" });
    assert.equal(stillRun.status, 0, stillRun.stdout + stillRun.stderr);
    assert.equal(readFileSync(join(slot0Dir, "keep-cache.marker"), "utf8"), "persisted");

    // 6. CHECK=text and CHECK=probe with VIEWS= emit explicit stderr warnings
    const viewsWarn = render(["stills"], {
      VIEWS: "front:0,1,8,0,1,0,50",
      CHECK: "text:0,1;probe:dish,1",
    });
    assert.equal(viewsWarn.status, 0, viewsWarn.stdout + viewsWarn.stderr);
    assert.match(
      viewsWarn.stderr,
      /warning: CHECK=text measures the film's own camera and ignores INSPECT\/VIEWS/,
    );
    assert.match(viewsWarn.stderr, /warning: CHECK=probe uses the film's own camera under VIEWS/);

    // 7. RENDER_FRESH_CACHE=1 bypasses renders/.chrome-cache cleanly
    rmSync(join(dir, "renders/.chrome-cache"), { recursive: true, force: true });
    const freshRun = render(["stills"], {
      RENDER_FRESH_CACHE: "1",
      CHECK: "probe:dish,1",
    });
    assert.equal(freshRun.status, 0, freshRun.stdout + freshRun.stderr);
    assert.ok(!existsSync(join(dir, "renders/.chrome-cache")));
  },
);
