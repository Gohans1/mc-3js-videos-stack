import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import {
  boundsOf,
  hitTarget,
  inferTargetTransform,
  targetsForKeys,
} from "../app/objects/targets.ts";
import { findTarget, targetHelp } from "../render/target.ts";

const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

test("timeline picks resolve explicit row bindings, deduplicate a character and keep multiple objects", () => {
  const targets = [
    { id: "steve", objects: [], rows: [{ edit: "steve", path: [] }] },
    { id: "chair", objects: [], rows: [{ edit: "props", path: ["chair"] }] },
    { id: "screen", objects: [], rows: [{ edit: "props", path: ["screen", "typing"] }] },
  ];
  const files = [{ edit: "steve" }, { edit: "props" }, { edit: "fx" }];
  const picks = [
    { f: 0, path: ["body"], i: 1 },
    { f: 0, path: ["look"], i: 2 },
    { f: 1, path: ["chair"], i: 0 },
    { f: 2, path: ["black"], i: 0 },
  ];
  assert.deepEqual(
    targetsForKeys(targets, picks, files).map((t) => t.id),
    ["steve", "chair"],
  );
  assert.deepEqual(
    targetsForKeys(targets, [{ f: 1, path: ["screen", "typing", "tries"], i: 0 }], files).map(
      (t) => t.id,
    ),
    ["screen"],
  );
  assert.deepEqual(targetsForKeys(targets, [], files), []);
});

test("selection bounds follow visible geometry only, including parent visibility and transforms", () => {
  const root = new THREE.Group(),
    visible = mesh(),
    hidden = mesh();
  hidden.position.x = 100;
  hidden.visible = false;
  root.position.x = 2;
  root.add(visible, hidden);
  root.updateMatrixWorld(true);
  const bounds = boundsOf([root]);
  assert.deepEqual(bounds.min.toArray(), [1.5, -0.5, -0.5]);
  assert.deepEqual(bounds.max.toArray(), [2.5, 0.5, 0.5]);
  root.visible = false;
  assert.ok(boundsOf([visible]).isEmpty());
});

test("viewport picking stops at an opaque occluder and ignores hidden ancestors", () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld(true);
  const chair = new THREE.Group(),
    part = mesh(),
    wall = mesh();
  chair.add(part);
  wall.position.z = 2;
  scene.add(chair, wall);
  scene.updateMatrixWorld(true);
  const targets = [{ id: "chair", objects: [chair], rows: [] }];
  assert.equal(hitTarget(scene, camera, targets, 0.5, 0.5), null);
  wall.visible = false;
  assert.equal(hitTarget(scene, camera, targets, 0.5, 0.5)?.id, "chair");
  chair.visible = false;
  assert.equal(hitTarget(scene, camera, targets, 0.5, 0.5), null);
});

test("inferTargetTransform auto-enables 3D gizmo axes only for standard key fields without polluting custom props", () => {
  const row = { edit: "props", path: ["silverfish", "path"] };
  const pathKey = { t: 68.217, at: [1.3, 0.42, 9.5], hop: 0.2 };
  const moveOnly = inferTargetTransform(row, pathKey);
  assert.ok(moveOnly);
  assert.deepEqual(moveOnly.axes, { translate: [true, true, true] });
  assert.deepEqual(moveOnly.read(pathKey), { at: [1.3, 0.42, 9.5], rot: [0, 0, 0], scale: 1 });
  moveOnly.write(pathKey, { at: [2, 0.5, 10], rot: [10, 45, 0], scale: 2 });
  assert.deepEqual(pathKey, { t: 68.217, at: [2, 0.5, 10], hop: 0.2 });

  const yawKey = { t: 75.85, at: [0.6, 1, 9.6], yaw: 90 };
  const withYaw = inferTargetTransform({ edit: "props", path: ["desk"] }, yawKey);
  assert.deepEqual(withYaw.axes, { translate: [true, true, true], rotate: [false, true, false] });
  withYaw.write(yawKey, { at: [1, 1, 9], rot: [15, -30, 5], scale: 3 });
  assert.deepEqual(yawKey, { t: 75.85, at: [1, 1, 9], yaw: -30 });

  const fullKey = { t: 0, at: [5, 1.375, 7.3125], rot: [0, 0, 0], scale: 1 };
  const full = inferTargetTransform({ edit: "props", path: ["bed"] }, fullKey);
  assert.deepEqual(full.axes, {
    translate: [true, true, true],
    rotate: [true, true, true],
    scale: [true, true, true],
  });
  full.write(fullKey, { at: [4, 1, 7], rot: [0, 90, 0], scale: 1.5 });
  assert.deepEqual(fullKey, { t: 0, at: [4, 1, 7], rot: [0, 90, 0], scale: 1.5 });

  assert.equal(
    inferTargetTransform({ edit: "props", path: ["drawer"] }, { t: 0, open: 0 }),
    undefined,
  );
  assert.equal(
    inferTargetTransform({ edit: "props", path: ["scrap"] }, { t: 10, at: [0.82, 9.47] }),
    undefined,
  );
});

test("findTarget resolves Actor.bone dot paths scoped to that actor and targetHelp suggests near dot targets", () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  const steve = new THREE.Group(),
    alex = new THREE.Group(),
    desk = new THREE.Group();
  const steveHead = new THREE.Object3D(),
    drawer = new THREE.Group(),
    handle = new THREE.Object3D();
  steveHead.name = "HeadJoint";
  drawer.name = "drawer";
  handle.name = "handle";
  steve.add(steveHead);
  drawer.add(handle);
  desk.add(drawer);
  scene.add(steve, alex, desk);

  const tools = {
    scene,
    camera,
    objects: [
      [steve, "Steve"],
      [alex, "Alex"],
      [desk, "desk"],
    ],
    bones: { head: steveHead },
  };

  assert.equal(findTarget(tools, "Steve"), steve);
  assert.equal(findTarget(tools, "Steve.head"), steveHead);
  assert.equal(findTarget(tools, "desk.drawer.handle"), handle);
  assert.equal(findTarget(tools, "Alex.head"), null);

  const help = targetHelp(tools, "Steve.hed");
  assert.match(help, /did you mean "Steve\.head"/);
});

test("findTarget tolerates bare Object3D entries and resolves per-actor userData.bones and case-insensitive child names", () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  const lead = new THREE.Group();
  lead.name = "lead";
  const leadHead = new THREE.Bone();
  leadHead.name = "Head";
  lead.add(leadHead);

  const cop = new THREE.Group();
  cop.name = "cop";
  const copHead = new THREE.Bone();
  copHead.name = "Head";
  const copHandR = new THREE.Group();
  copHandR.name = "handR";
  cop.add(copHead, copHandR);
  cop.userData.bones = { head: copHead, handR: copHandR };

  const bareProp = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  bareProp.name = "lamp";
  scene.add(lead, cop, bareProp);

  const tools = {
    scene,
    camera,
    objects: [[lead, "lead"], [cop, "cop"], bareProp],
    bones: { head: leadHead },
  };

  assert.equal(findTarget(tools, "lamp"), bareProp);
  assert.equal(findTarget(tools, "cop.head"), copHead);
  assert.equal(findTarget(tools, "cop.handR"), copHandR);
  assert.equal(findTarget(tools, "cop.HEAD"), copHead);
  assert.match(targetHelp(tools, "lmp"), /"lamp"/);
});
