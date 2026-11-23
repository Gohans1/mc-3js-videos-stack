import { expect, test } from "bun:test";

import * as THREE from "three";

import { createHighlight, pulseEnvelope } from "../src/highlight";

test("pulseEnvelope returns smooth trapezoid weights and guards invalid or short spans", () => {
  expect(pulseEnvelope(0.9, 1, 2)).toBe(0);
  expect(pulseEnvelope(1.0, 1, 2)).toBe(0);
  expect(pulseEnvelope(2.0, 1, 2)).toBe(0);
  expect(pulseEnvelope(1.5, 1, 2, 0.1, 0.1)).toBe(1);
  expect(pulseEnvelope(1.05, 1, 2, 0.1, 0.1)).toBeCloseTo(0.5, 6);
  expect(pulseEnvelope(1.95, 1, 2, 0.1, 0.1)).toBeCloseTo(0.5, 6);
  expect(pulseEnvelope(1.05, 1, 1.1, 0.2, 0.2)).toBeCloseTo(1, 6);
  expect(pulseEnvelope(1.0, 1, 2, 0, 0)).toBe(1);
  expect(pulseEnvelope(Number.NaN, 1, 2)).toBe(0);
  expect(pulseEnvelope(1.5, 2, 1)).toBe(0);
});

test("createHighlight isolates cloned materials from external siblings and restores exact baseline on backward scrub", () => {
  const shared = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x112233,
    emissiveIntensity: 0.4,
  });
  const sibling = new THREE.Mesh(new THREE.BoxGeometry(), shared);
  const hero = new THREE.Mesh(new THREE.BoxGeometry(), shared);
  const root = new THREE.Group();
  root.add(hero);

  const hl = createHighlight(root, { color: 0xff0000, intensity: 1.4 });
  expect(hl.count).toBe(1);
  expect(hero.material).not.toBe(shared);
  expect(sibling.material).toBe(shared);

  hl.set(1);
  const cloned = hero.material as THREE.MeshStandardMaterial;
  expect(cloned.emissive.getHex()).toBe(0xff0000);
  expect(cloned.emissiveIntensity).toBeCloseTo(1.4, 6);
  expect(shared.emissive.getHex()).toBe(0x112233);
  expect(shared.emissiveIntensity).toBeCloseTo(0.4, 6);

  hl.set(0);
  expect(cloned.emissive.getHex()).toBe(0x112233);
  expect(cloned.emissiveIntensity).toBeCloseTo(0.4, 6);

  hl.set(Number.NaN);
  expect(cloned.emissive.getHex()).toBe(0x112233);
  hl.dispose();
  shared.dispose();
});

test("createHighlight handles multi-material arrays, skips non-emissive materials, and evaluates multi-color spans", () => {
  const std = new THREE.MeshStandardMaterial({ emissive: 0x000000, emissiveIntensity: 1 });
  const basic = new THREE.MeshBasicMaterial({ color: 0x224466 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [std, basic]);
  const root = new THREE.Group();
  root.add(mesh);

  const hl = createHighlight(root);
  expect(hl.count).toBe(1);
  const mats = mesh.material as THREE.Material[];
  expect(mats[0]).not.toBe(std);
  expect(mats[1]).toBe(basic);

  const spans = [
    { start: 1, end: 2, rampIn: 0.1, rampOut: 0.1, color: 0x00ff00, intensity: 1.2 },
    { start: 3, end: 4, rampIn: 0.1, rampOut: 0.1, color: 0x0088ff, intensity: 0.7 },
  ];
  expect(hl.apply(1.5, spans)).toBe(1);
  expect((mats[0] as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x00ff00);
  expect((mats[0] as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(1.2, 6);

  expect(hl.apply(3.5, spans)).toBe(1);
  expect((mats[0] as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x0088ff);
  expect((mats[0] as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(0.7, 6);

  expect(hl.apply(2.5, spans)).toBe(0);
  expect((mats[0] as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x000000);
  expect((mats[0] as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(1, 6);

  hl.dispose();
  std.dispose();
  basic.dispose();
});
