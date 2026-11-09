import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { boundsOf, hitTarget, targetsForKeys } from "../app/objects/targets.ts";

const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

test("timeline picks resolve explicit row bindings, deduplicate a character and keep multiple objects", () => {
  const targets = [
    { id: "steve", objects: [], rows: [{ edit: "steve", path: [] }] },
    { id: "chair", objects: [], rows: [{ edit: "props", path: ["chair"] }] },
    { id: "screen", objects: [], rows: [{ edit: "props", path: ["screen", "typing"] }] },
  ];
  const files = [{ edit: "steve" }, { edit: "props" }, { edit: "fx" }];
  const picks = [{ f: 0, path: ["body"], i: 1 }, { f: 0, path: ["look"], i: 2 }, { f: 1, path: ["chair"], i: 0 }, { f: 2, path: ["black"], i: 0 }];
  assert.deepEqual(targetsForKeys(targets, picks, files).map((t) => t.id), ["steve", "chair"]);
  assert.deepEqual(targetsForKeys(targets, [{ f: 1, path: ["screen", "typing", "tries"], i: 0 }], files).map((t) => t.id), ["screen"]);
  assert.deepEqual(targetsForKeys(targets, [], files), []);
});

test("selection bounds follow visible geometry only, including parent visibility and transforms", () => {
  const root = new THREE.Group(), visible = mesh(), hidden = mesh();
  hidden.position.x = 100; hidden.visible = false; root.position.x = 2; root.add(visible, hidden);
  root.updateMatrixWorld(true);
  const bounds = boundsOf([root]);
  assert.deepEqual(bounds.min.toArray(), [1.5, -0.5, -0.5]);
  assert.deepEqual(bounds.max.toArray(), [2.5, 0.5, 0.5]);
  root.visible = false;
  assert.ok(boundsOf([visible]).isEmpty());
});

test("viewport picking stops at an opaque occluder and ignores hidden ancestors", () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 5; camera.updateMatrixWorld(true);
  const chair = new THREE.Group(), part = mesh(), wall = mesh();
  chair.add(part); wall.position.z = 2; scene.add(chair, wall); scene.updateMatrixWorld(true);
  const targets = [{ id: "chair", objects: [chair], rows: [] }];
  assert.equal(hitTarget(scene, camera, targets, 0.5, 0.5), null);
  wall.visible = false;
  assert.equal(hitTarget(scene, camera, targets, 0.5, 0.5)?.id, "chair");
  chair.visible = false;
  assert.equal(hitTarget(scene, camera, targets, 0.5, 0.5), null);
});
