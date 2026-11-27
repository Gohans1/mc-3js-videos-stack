import { expect, spyOn, test } from "bun:test";

import * as THREE from "three";

import { createHighlight, createOutlineHighlight, pulseEnvelope } from "../src/highlight";

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

test("createOutlineHighlight preserves original mesh materials, toggles visibility via set(), supports outline and rim modes, and disposes overlays without touching source geometry", () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x336699 });
  const mesh = new THREE.Mesh(geo, mat);
  const skipped = new THREE.Mesh(geo, mat);
  skipped.name = "skip-me";
  const root = new THREE.Group();
  root.add(mesh, skipped);

  const geoDisposeSpy = spyOn(geo, "dispose");
  const outline = createOutlineHighlight(root, {
    mode: "outline",
    color: "#ffaa00",
    thickness: 0.04,
    intensity: 2.0,
    include: (m) => m.name !== "skip-me",
  });

  expect(mesh.material).toBe(mat);
  expect(skipped.material).toBe(mat);
  expect(mesh.children).toHaveLength(1);
  expect(skipped.children).toHaveLength(0);
  const overlay = mesh.children[0] as THREE.Mesh;
  expect(overlay.visible).toBe(false);
  const overlayMat = overlay.material as THREE.ShaderMaterial;
  expect(overlayMat.side).toBe(THREE.BackSide);
  expect(overlayMat.transparent).toBe(true);
  expect(overlayMat.depthWrite).toBe(false);
  expect(overlayMat.polygonOffset).toBe(false);
  expect(overlayMat.fragmentShader).not.toContain("#include <tonemapping_fragment>");
  expect(overlayMat.fragmentShader).not.toContain("#include <colorspace_fragment>");

  outline.set(0.3);
  expect(overlay.visible).toBe(true);
  expect((overlayMat.uniforms.uLevel as { value: number }).value).toBeCloseTo(0.3, 6);
  outline.set(1);
  expect(overlay.visible).toBe(true);
  outline.setColor("#00ffaa");
  expect((overlayMat.uniforms.uColor as { value: THREE.Color }).value.getHexString()).toBe(
    "00ffaa",
  );
  outline.set(0);
  expect(overlay.visible).toBe(false);

  const spans = [{ start: 1, end: 2, rampIn: 0.1, rampOut: 0.1, color: "#ff3366", intensity: 2.4 }];
  expect(outline.apply(1.5, spans)).toBe(1);
  expect(overlay.visible).toBe(true);
  expect((overlayMat.uniforms.uColor as { value: THREE.Color }).value.getHexString()).toBe(
    "ff3366",
  );
  expect((overlayMat.uniforms.uIntensity as { value: number }).value).toBeCloseTo(2.4, 6);
  expect(outline.apply(2.5, spans)).toBe(0);
  expect(overlay.visible).toBe(false);
  expect((overlayMat.uniforms.uIntensity as { value: number }).value).toBeCloseTo(2.0, 6);

  outline.apply(1.5, spans);
  outline.set(0.5);
  expect((overlayMat.uniforms.uIntensity as { value: number }).value).toBeCloseTo(2.0, 6);
  expect((overlayMat.uniforms.uColor as { value: THREE.Color }).value.getHexString()).toBe(
    "00ffaa",
  );
  expect(outline.apply(1.5, [{ start: 1, end: 2, rampIn: 0.1, rampOut: 0.1 }])).toBe(1);
  expect((overlayMat.uniforms.uColor as { value: THREE.Color }).value.getHexString()).toBe(
    "00ffaa",
  );
  outline.set(0.5, "#112233", 3.2);
  expect((overlayMat.uniforms.uIntensity as { value: number }).value).toBeCloseTo(3.2, 6);
  expect((overlayMat.uniforms.uColor as { value: THREE.Color }).value.getHexString()).toBe(
    "112233",
  );

  outline.dispose();
  outline.dispose();
  expect(mesh.children).toHaveLength(0);
  expect(mesh.material).toBe(mat);
  expect(geoDisposeSpy).not.toHaveBeenCalled();

  const rim = createOutlineHighlight(root, { mode: "rim", color: "#44ddff", intensity: 1.8 });
  expect(mesh.children).toHaveLength(1);
  const rimOverlay = mesh.children[0] as THREE.Mesh;
  const rimMat = rimOverlay.material as THREE.ShaderMaterial;
  expect(rimMat.blending).toBe(THREE.AdditiveBlending);
  expect(rimMat.transparent).toBe(true);
  expect(rimMat.depthWrite).toBe(false);
  expect(rimMat.polygonOffset).toBe(true);
  expect(rimMat.polygonOffsetFactor).toBe(-1);
  expect(rimMat.polygonOffsetUnits).toBe(-1);
  expect(rimMat.fragmentShader).not.toContain("#include <tonemapping_fragment>");
  expect(rimMat.fragmentShader).not.toContain("#include <colorspace_fragment>");
  rim.set(0.75);
  expect(rimOverlay.visible).toBe(true);
  rim.dispose();
  expect(mesh.children).toHaveLength(0);

  const instanced = new THREE.InstancedMesh(geo, mat, 4);
  const instRoot = new THREE.Group();
  instRoot.add(instanced);
  const instHl = createOutlineHighlight(instRoot);
  expect(instHl.count).toBe(0);
  expect(instanced.children).toHaveLength(0);
  instHl.dispose();
  instanced.dispose();

  geo.dispose();
  mat.dispose();
});

test("createOutlineHighlight binds SkinnedMesh overlays to the same skeleton non-destructively", () => {
  const geo = new THREE.BoxGeometry(1, 2, 1);
  const count = geo.attributes.position.count;
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));

  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  const mat = new THREE.MeshStandardMaterial({ color: 0xdddddd });
  const skinned = new THREE.SkinnedMesh(geo, mat);
  skinned.add(bone);
  skinned.bind(skeleton);

  const root = new THREE.Group();
  root.add(skinned);

  const hl = createOutlineHighlight(root, { mode: "outline", color: 0x00ffff });
  expect(skinned.material).toBe(mat);
  const overlay = skinned.children.find((c) => c instanceof THREE.SkinnedMesh) as
    THREE.SkinnedMesh | undefined;
  expect(overlay).toBeDefined();
  if (!overlay) throw new Error("expected skinned overlay");
  expect(overlay.skeleton).toBe(skeleton);
  expect((overlay.material as THREE.ShaderMaterial).vertexShader).toContain(
    "#include <skinning_vertex>",
  );

  hl.set(1);
  expect(overlay.visible).toBe(true);
  hl.dispose();
  expect(skinned.children.some((c) => c instanceof THREE.SkinnedMesh)).toBe(false);

  geo.dispose();
  mat.dispose();
});
