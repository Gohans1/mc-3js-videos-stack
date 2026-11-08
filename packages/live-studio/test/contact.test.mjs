// The inside rule on the shapes Minecraft models are made of, none of them named: solids close, cards never do
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { gap, surface } from "../checks/contact.mjs";

const at = (g, x, y, z) => g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
const box = (w, h, d, x = 0, y = 0, z = 0) => at(new THREE.BoxGeometry(w, h, d).toNonIndexed(), x, y, z);
const card = (w, h, x = 0, y = 0, z = 0, turn = 0) => at(new THREE.PlaneGeometry(w, h).toNonIndexed().rotateY(turn), x, y, z);
const near = (g, p, opts) => gap(new THREE.Vector3(...p), [surface(g, new THREE.Matrix4(), opts)]).d;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} vs ${b}`);

test("a solid block: 5 cm in is -5 cm, 5 cm out is +5 cm", () => {
  close(near(box(1, 1, 1), [0, 0.45, 0]), -0.05);
  close(near(box(1, 1, 1), [0, 0.55, 0]), 0.05);
});

test("a thin closed box (torch, pane, slab) still has an inside", () => {
  close(near(box(0.125, 0.625, 0.125), [0, 0.2, 0.03]), -0.0325);
});

test("a single card (flower face, paper): behind it is only near it", () => {
  close(near(card(1, 1), [0, 0, -0.05]), 0.05);
  close(near(card(1, 1), [0, 0, 0.05]), 0.05);
});

test("crossed cards (grass, flowers, cobweb, saplings): never inside, from any side", () => {
  const x = mergeGeometries([card(1, 1, 0, 0, 0, Math.PI / 4), card(1, 1, 0, 0, 0, -Math.PI / 4), card(1, 1, 0, 0, 0, (3 * Math.PI) / 4), card(1, 1, 0, 0, 0, (-3 * Math.PI) / 4)]);
  for (const p of [[0.1, 0, 0], [-0.1, 0.2, 0], [0, -0.3, 0.1], [0.05, 0.1, -0.12]]) assert.ok(near(x, p) >= 0, `${p}`);
});

test("one merged room: behind a card standing in it is not inside, a hand in its wall is", () => {
  const T = 0.2, S = 3; // 3 m room, 20 cm solid walls, all one mesh as block renderers merge it, a cobweb card inside
  const room = mergeGeometries([
    box(S, T, S, 0, -T / 2, 0), box(S, T, S, 0, S + T / 2, 0),
    box(T, S, S, -S / 2 - T / 2, S / 2, 0), box(T, S, S, S / 2 + T / 2, S / 2, 0),
    box(S, S, T, 0, S / 2, -S / 2 - T / 2), box(S, S, T, 0, S / 2, S / 2 + T / 2),
    card(1, 1, 1, 2.5, 1, Math.PI / 4), card(1, 1, 1, 2.5, 1, (-3 * Math.PI) / 4),
  ]);
  for (const p of [[0.9, 2.5, 0.8], [0.6, 1.8, 0.5], [0, 1.6, 0]]) assert.ok(near(room, p) >= 0 || !Number.isFinite(near(room, p)), `${p} behind the card`);
  close(near(room, [S / 2 + 0.05, 1.5, 0]), -0.05);
  close(near(room, [0, -0.03, 0]), -0.03);
});

test("double-sided faces have no back, so never an inside", () => {
  assert.ok(near(box(1, 1, 1), [0, 0.45, 0], { side: THREE.DoubleSide }) > 0);
});

test("a mirrored placement keeps inside inside", () => {
  const g = box(1, 1, 1);
  const d = gap(new THREE.Vector3(0, 0.45, 0), [surface(g, new THREE.Matrix4().makeScale(-1, 1, 1))]).d;
  close(d, -0.05);
});
