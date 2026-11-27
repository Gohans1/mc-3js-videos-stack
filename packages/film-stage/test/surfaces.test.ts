import { describe, expect, it } from "bun:test";

import * as THREE from "three";

import {
  createCausticsPlane,
  createFlame,
  createHazeLayer,
  createPhysicalMaterial,
  createVolumetricBeam,
  createWaterSurface,
  createWetGround,
  createXRayMaterial,
  FLAME_PRESETS,
  MATERIAL_PRESET_IDS,
  MATERIAL_PRESETS,
  WATER_PRESETS,
  XRAY_PRESETS,
  type FlamePresetName,
  type MaterialPresetName,
  type WaterPresetName,
  type XRayPresetName,
} from "../src/surfaces";

describe("WATER_PRESETS and createWaterSurface", () => {
  it("exposes all 8 water presets with distinct defaults", () => {
    const names: WaterPresetName[] = [
      "ocean",
      "lake",
      "pool",
      "dark-sea",
      "tropical",
      "river",
      "lava",
      "toxic",
    ];
    expect(Object.keys(WATER_PRESETS).sort()).toEqual([...names].sort());
    expect(WATER_PRESETS.ocean.color).not.toBe(WATER_PRESETS.pool.color);
    expect(WATER_PRESETS["dark-sea"].normalStrength).toBeGreaterThan(
      WATER_PRESETS.lake.normalStrength,
    );
    expect(WATER_PRESETS.lava.emissive).toBeDefined();
    expect(WATER_PRESETS.toxic.emissive).toBeDefined();
  });

  it("creates a horizontal MeshPhysicalMaterial water plane applying preset and overrides", () => {
    const water = createWaterSurface({
      preset: "pool",
      size: [20, 10],
      color: "#1199aa",
      roughness: 0.12,
      clearcoat: 0.85,
      envMapIntensity: 1.5,
      waveScale: 0.5,
      y: -0.25,
    });

    expect(water.mesh).toBeInstanceOf(THREE.Mesh);
    expect(water.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(water.mesh.material).toBe(water.material);
    expect(water.mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
    expect(water.mesh.position.y).toBeCloseTo(-0.25, 6);
    expect(water.mesh.receiveShadow).toBe(true);
    expect(water.material.color.getHex()).toBe(0x1199aa);
    expect(water.material.roughness).toBeCloseTo(0.12, 6);
    expect(water.material.clearcoat).toBeCloseTo(0.85, 6);
    expect(water.material.envMapIntensity).toBeCloseTo(1.5, 6);
    expect(water.material.normalMap?.repeat.x).toBeCloseTo(10, 6);
    expect(water.material.normalMap?.repeat.y).toBeCloseTo(5, 6);

    water.dispose();
  });

  it("supports emissive magma/toxic glow, translucent opacity, and doubleSide underwater view", () => {
    const lava = createWaterSurface({ preset: "lava", textureSize: 16 });
    expect(lava.material.emissiveIntensity).toBeGreaterThan(1);
    expect(lava.material.emissive.getHex()).not.toBe(0x000000);

    const underwater = createWaterSurface({
      preset: "tropical",
      opacity: 0.72,
      doubleSide: true,
      textureSize: 16,
    });
    expect(underwater.material.transparent).toBe(true);
    expect(underwater.material.opacity).toBeCloseTo(0.72, 6);
    expect(underwater.material.depthWrite).toBe(false);
    expect(underwater.material.side).toBe(THREE.DoubleSide);

    const ocean = createWaterSurface({ preset: "ocean", textureSize: 16 });
    expect(ocean.material.depthWrite).toBe(true);

    const forcedDepth = createWaterSurface({
      preset: "tropical",
      depthWrite: true,
      textureSize: 16,
    });
    expect(forcedDepth.material.depthWrite).toBe(true);

    lava.dispose();
    underwater.dispose();
    ocean.dispose();
    forcedDepth.dispose();
  });

  it("throws a helpful error for unknown or prototype water preset names", () => {
    expect(() => createWaterSurface({ preset: "swamp" as WaterPresetName })).toThrow(
      /Unknown water preset/,
    );
    expect(() => createWaterSurface({ preset: "toString" as WaterPresetName })).toThrow(
      /Unknown water preset/,
    );
  });

  it("generates deterministic seamless DataTexture normal maps with independent clearcoat layer", () => {
    const a = createWaterSurface({ preset: "ocean", textureSize: 32 });
    const b = createWaterSurface({ preset: "ocean", textureSize: 32 });

    const texA = a.material.normalMap as THREE.DataTexture;
    const texB = b.material.normalMap as THREE.DataTexture;
    const coatA = a.material.clearcoatNormalMap as THREE.DataTexture;

    expect(texA).toBeInstanceOf(THREE.DataTexture);
    expect(coatA).toBeInstanceOf(THREE.DataTexture);
    expect(coatA).not.toBe(texA);
    expect(texA.wrapS).toBe(THREE.RepeatWrapping);
    expect(texA.wrapT).toBe(THREE.RepeatWrapping);
    expect(texA.colorSpace).toBe(THREE.NoColorSpace);

    const dataA = texA.image.data as Uint8Array;
    const dataB = texB.image.data as Uint8Array;
    expect(dataA.length).toBe(32 * 32 * 4);
    expect(Array.from(dataA)).toEqual(Array.from(dataB));

    let minR = 255;
    let maxR = 0;
    for (let i = 0; i < dataA.length; i += 4) {
      if (dataA[i] < minR) minR = dataA[i];
      if (dataA[i] > maxR) maxR = dataA[i];
      expect(dataA[i + 3]).toBe(255);
    }
    expect(maxR - minR).toBeGreaterThan(20);

    a.dispose();
    b.dispose();
  });

  it("updates UV offsets deterministically and seek-independently across forward and backward scrubs", () => {
    const water = createWaterSurface({ preset: "ocean", flowSpeed: [0.02, 0.05], textureSize: 16 });
    const normal = water.material.normalMap!;
    const coat = water.material.clearcoatNormalMap!;

    water.update(5);
    const nx1 = normal.offset.x;
    const ny1 = normal.offset.y;
    const cx1 = coat.offset.x;
    const cy1 = coat.offset.y;

    expect(nx1).toBeCloseTo(0.1, 6);
    expect(ny1).toBeCloseTo(0.25, 6);
    expect(cx1).not.toBeCloseTo(nx1, 3);

    water.update(99.5);
    water.update(5);

    expect(normal.offset.x).toBeCloseTo(nx1, 9);
    expect(normal.offset.y).toBeCloseTo(ny1, 9);
    expect(coat.offset.x).toBeCloseTo(cx1, 9);
    expect(coat.offset.y).toBeCloseTo(cy1, 9);

    water.update(Number.NaN);
    expect(Number.isFinite(normal.offset.x)).toBe(true);
    expect(Number.isFinite(coat.offset.x)).toBe(true);

    water.dispose();
  });

  it("disposes geometry, material, and both normal textures idempotently", () => {
    const water = createWaterSurface({ textureSize: 16 });
    let geoDisposed = 0;
    let matDisposed = 0;
    let normalDisposed = 0;
    let coatDisposed = 0;

    water.mesh.geometry.addEventListener("dispose", () => {
      geoDisposed++;
    });
    water.material.addEventListener("dispose", () => {
      matDisposed++;
    });
    water.material.normalMap!.addEventListener("dispose", () => {
      normalDisposed++;
    });
    water.material.clearcoatNormalMap!.addEventListener("dispose", () => {
      coatDisposed++;
    });

    water.dispose();
    water.dispose();

    expect(geoDisposed).toBe(1);
    expect(matDisposed).toBe(1);
    expect(normalDisposed).toBe(1);
    expect(coatDisposed).toBe(1);
  });
});

describe("createWetGround", () => {
  it("builds a transparent horizontal HalfFloat Reflector with linear HDR shader", () => {
    const wet = createWetGround({
      width: 30,
      depth: 50,
      strength: 0.65,
      smear: 0.04,
      tint: "#ddeeff",
      res: 256,
      puddleScale: 1.2,
      puddleThreshold: 0.4,
    });

    const mat = wet.mesh.material as THREE.ShaderMaterial;
    const rt = wet.mesh.getRenderTarget();

    expect(wet.mesh.isReflector).toBe(true);
    expect(wet.mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
    expect(wet.mesh.position.y).toBeCloseTo(0.002, 6);
    expect(wet.mesh.receiveShadow).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(rt.width).toBe(256);
    expect(rt.height).toBe(256);
    expect(rt.texture.type).toBe(THREE.HalfFloatType);

    expect(mat.uniforms.strength.value).toBeCloseTo(0.65, 6);
    expect(mat.uniforms.smear.value).toBeCloseTo(0.04, 6);
    expect(mat.uniforms.puddleScale.value).toBeCloseTo(1.2, 6);
    expect(mat.uniforms.puddleThreshold.value).toBeCloseTo(0.4, 6);
    expect((mat.uniforms.color.value as THREE.Color).getHex()).toBe(0xddeeff);

    expect(mat.fragmentShader).not.toContain("#include <tonemapping_fragment>");
    expect(mat.fragmentShader).not.toContain("#include <colorspace_fragment>");
    expect(wet.mesh.userData.treatAsOpaque).toBe(true);

    wet.dispose();
  });

  it("updates strength and smear uniforms and clamps invalid values", () => {
    const wet = createWetGround({ res: 64, strength: 0.5, smear: 0.03 });
    const mat = wet.mesh.material as THREE.ShaderMaterial;

    wet.setStrength(0.8);
    wet.setSmear(0.06);
    expect(mat.uniforms.strength.value).toBeCloseTo(0.8, 6);
    expect(mat.uniforms.smear.value).toBeCloseTo(0.06, 6);

    wet.setStrength(-2);
    wet.setSmear(-1);
    expect(mat.uniforms.strength.value).toBe(0);
    expect(mat.uniforms.smear.value).toBe(0);

    wet.setStrength(Number.NaN);
    wet.setSmear(Number.POSITIVE_INFINITY);
    expect(mat.uniforms.strength.value).toBe(0);
    expect(mat.uniforms.smear.value).toBe(0);

    wet.dispose();
  });

  it("disposes renderTarget, material, and geometry idempotently", () => {
    const wet = createWetGround({ res: 64 });
    const mat = wet.mesh.material as THREE.ShaderMaterial;
    const rt = wet.mesh.getRenderTarget();

    let rtDisposed = 0;
    let matDisposed = 0;
    let geoDisposed = 0;

    rt.addEventListener("dispose", () => {
      rtDisposed++;
    });
    mat.addEventListener("dispose", () => {
      matDisposed++;
    });
    wet.mesh.geometry.addEventListener("dispose", () => {
      geoDisposed++;
    });

    wet.dispose();
    wet.dispose();

    expect(rtDisposed).toBe(1);
    expect(matDisposed).toBe(1);
    expect(geoDisposed).toBe(1);
  });
});

describe("createHazeLayer", () => {
  it("generates deterministic FBM wisp DataTextures and layered double-sided transparent planes", () => {
    const a = createHazeLayer({ count: 12, layers: 2, seed: 42, textureSize: 32, variants: 2 });
    const b = createHazeLayer({ count: 12, layers: 2, seed: 42, textureSize: 32, variants: 2 });
    const c = createHazeLayer({ count: 12, layers: 2, seed: 99, textureSize: 32, variants: 2 });

    expect(a.group.children.length).toBe(24);

    const meshA = a.group.children[0] as THREE.Mesh;
    const meshB = b.group.children[0] as THREE.Mesh;
    const matA = meshA.material as THREE.MeshBasicMaterial;
    const matB = meshB.material as THREE.MeshBasicMaterial;
    const matC = (c.group.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;

    expect(matA.transparent).toBe(true);
    expect(matA.depthWrite).toBe(false);
    expect(matA.side).toBe(THREE.DoubleSide);
    expect(matA.map).toBeInstanceOf(THREE.DataTexture);

    expect(meshA.position.toArray()).toEqual(meshB.position.toArray());
    expect(meshA.scale.toArray()).toEqual(meshB.scale.toArray());

    const dataA = (matA.map as THREE.DataTexture).image.data as Uint8Array;
    const dataB = (matB.map as THREE.DataTexture).image.data as Uint8Array;
    const dataC = (matC.map as THREE.DataTexture).image.data as Uint8Array;

    expect(Array.from(dataA)).toEqual(Array.from(dataB));
    expect(Array.from(dataA)).not.toEqual(Array.from(dataC));
    expect(dataA[3]).toBe(0);

    let maxAlpha = 0;
    for (let i = 3; i < dataA.length; i += 4) {
      if (dataA[i] > maxAlpha) maxAlpha = dataA[i];
    }
    expect(maxAlpha).toBeGreaterThan(0);

    a.dispose();
    b.dispose();
    c.dispose();
  });

  it("snaps group position in whole span increments around camera and optional origin", () => {
    const haze = createHazeLayer({ span: 1000, count: 4, textureSize: 16, variants: 1, y: 12 });
    const cam = new THREE.PerspectiveCamera();

    cam.position.set(400, 50, -400);
    haze.follow(cam);
    expect(haze.group.position.x).toBe(0);
    expect(haze.group.position.y).toBe(12);
    expect(haze.group.position.z).toBe(0);

    cam.position.set(1400, 50, -1600);
    haze.follow(cam);
    expect(haze.group.position.x).toBe(1000);
    expect(haze.group.position.y).toBe(12);
    expect(haze.group.position.z).toBe(-2000);

    cam.position.set(1120, 50, 150);
    haze.follow(cam, [100, 200]);
    expect(haze.group.position.x).toBe(1100);
    expect(haze.group.position.y).toBe(12);
    expect(haze.group.position.z).toBe(200);

    haze.follow(cam, [100, 35, 200]);
    expect(haze.group.position.y).toBe(35);

    const rig = new THREE.Group();
    const childCam = new THREE.PerspectiveCamera();
    rig.position.set(1400, 0, -1600);
    childCam.position.set(0, 50, 0);
    rig.add(childCam);
    haze.follow(childCam);
    expect(haze.group.position.x).toBe(1000);
    expect(haze.group.position.z).toBe(-2000);

    const parent = new THREE.Group();
    parent.add(haze.group);
    haze.dispose();
    expect(haze.group.parent).toBeNull();
  });

  it("updates opacity across all wisp materials and clamps to [0, 1]", () => {
    const haze = createHazeLayer({ count: 6, textureSize: 16, variants: 3, opacity: 0.4 });
    const mats = new Set<THREE.MeshBasicMaterial>(
      haze.group.children.map((child) => (child as THREE.Mesh).material as THREE.MeshBasicMaterial),
    );

    haze.setOpacity(0.75);
    for (const mat of mats) expect(mat.opacity).toBeCloseTo(0.75, 6);

    haze.setOpacity(2.5);
    for (const mat of mats) expect(mat.opacity).toBe(1);

    haze.setOpacity(-0.3);
    for (const mat of mats) expect(mat.opacity).toBe(0);

    haze.dispose();
  });

  it("disposes shared geometry, materials, and textures idempotently and clears group", () => {
    const haze = createHazeLayer({ count: 6, textureSize: 16, variants: 2 });
    const firstMesh = haze.group.children[0] as THREE.Mesh;
    const sharedGeo = firstMesh.geometry;
    const uniqueMats = new Set<THREE.MeshBasicMaterial>(
      haze.group.children.map((child) => (child as THREE.Mesh).material as THREE.MeshBasicMaterial),
    );
    const uniqueTexs = new Set<THREE.Texture>(
      [...uniqueMats].map((m) => m.map).filter((t): t is THREE.Texture => t !== null),
    );

    let geoDisposed = 0;
    let matDisposed = 0;
    let texDisposed = 0;

    sharedGeo.addEventListener("dispose", () => {
      geoDisposed++;
    });
    for (const mat of uniqueMats) {
      mat.addEventListener("dispose", () => {
        matDisposed++;
      });
    }
    for (const tex of uniqueTexs) {
      tex.addEventListener("dispose", () => {
        texDisposed++;
      });
    }

    haze.dispose();
    haze.dispose();

    expect(geoDisposed).toBe(1);
    expect(matDisposed).toBe(uniqueMats.size);
    expect(texDisposed).toBe(uniqueTexs.size);
    expect(haze.group.children.length).toBe(0);
  });
});

describe("MATERIAL_PRESETS and createPhysicalMaterial", () => {
  it("exposes all 29 r187 physical material presets", () => {
    const expected: MaterialPresetName[] = [
      "matte-plaster",
      "polished-steel",
      "brushed-metal",
      "clear-glass",
      "frosted-glass",
      "car-paint",
      "fabric",
      "wet-surface",
      "concrete",
      "asphalt",
      "raw-wood",
      "polished-wood",
      "ceramic",
      "matte-plastic",
      "glossy-plastic",
      "rubber",
      "leather",
      "chrome",
      "gold",
      "brass",
      "rusted-metal",
      "skin-organic",
      "wet-organic",
      "ice",
      "snow",
      "foliage",
      "tinted-glass",
      "emissive-neon",
      "emissive-screen",
    ];
    expect(Object.keys(MATERIAL_PRESETS).sort()).toEqual([...expected].sort());
  });

  it("applies Three.js r187 PBR properties including EON diffuseRoughness, anisotropy, sheen, and glass flags", () => {
    const plaster = createPhysicalMaterial("matte-plaster");
    expect(plaster).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(plaster.roughness).toBeCloseTo(0.92, 6);
    expect(plaster.diffuseRoughness).toBeCloseTo(0.85, 6);
    expect(plaster.metalness).toBe(0);

    const brushed = createPhysicalMaterial("brushed-metal");
    expect(brushed.metalness).toBeCloseTo(0.9, 6);
    expect(brushed.roughness).toBeCloseTo(0.34, 6);
    expect(brushed.anisotropy).toBeCloseTo(0.5, 6);

    const glass = createPhysicalMaterial("clear-glass");
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect(glass.ior).toBeCloseTo(1.5, 6);
    expect(glass.clearcoat).toBe(1);

    const fabric = createPhysicalMaterial("fabric");
    expect(fabric.sheen).toBeCloseTo(0.75, 6);
    expect(fabric.sheenRoughness).toBeCloseTo(0.7, 6);
    expect(fabric.diffuseRoughness).toBeCloseTo(0.5, 6);

    const concrete = createPhysicalMaterial("concrete");
    expect(concrete.diffuseRoughness).toBeGreaterThan(0.7);

    const neon = createPhysicalMaterial("emissive-neon");
    expect(neon.emissiveIntensity).toBeGreaterThan(2);

    const ice = createPhysicalMaterial("ice");
    expect(ice.ior).toBeCloseTo(1.31, 2);
    expect(ice.transparent).toBe(true);
    expect(ice.depthWrite).toBe(false);

    plaster.dispose();
    brushed.dispose();
    glass.dispose();
    fabric.dispose();
    concrete.dispose();
    neon.dispose();
    ice.dispose();
  });

  it("merges user overrides without mutating MATERIAL_PRESETS", () => {
    const beforeRoughness = MATERIAL_PRESETS["polished-steel"].roughness;
    const mat = createPhysicalMaterial("polished-steel", {
      color: "#ccaa44",
      roughness: 0.22,
    });

    expect(mat.color.getHex()).toBe(0xccaa44);
    expect(mat.roughness).toBeCloseTo(0.22, 6);
    expect(mat.metalness).toBeCloseTo(0.96, 6);
    expect(MATERIAL_PRESETS["polished-steel"].roughness).toBe(beforeRoughness);

    mat.dispose();
  });

  it("ensures every material preset with sheen > 0 defines a non-black sheenColor", () => {
    let sheenPresetCount = 0;
    for (const id of MATERIAL_PRESET_IDS) {
      const mat = createPhysicalMaterial(id);
      if (mat.sheen > 0) {
        sheenPresetCount++;
        expect(mat.sheenColor.getHex(), `${id} sheenColor`).not.toBe(0);
      }
      mat.dispose();
    }
    expect(sheenPresetCount).toBeGreaterThanOrEqual(5);
  });

  it("throws a helpful error for unknown or prototype material preset names", () => {
    expect(() => createPhysicalMaterial("unobtanium" as MaterialPresetName)).toThrow(
      /Unknown material preset/,
    );
    expect(() => createPhysicalMaterial("constructor" as MaterialPresetName)).toThrow(
      /Unknown material preset/,
    );
  });
});

describe("XRAY_PRESETS and createXRayMaterial", () => {
  it("exposes all 5 X-ray and cutaway presets", () => {
    const expected: XRayPresetName[] = [
      "xray-cyan",
      "xray-amber",
      "xray-red",
      "hologram-green",
      "ghost-shell",
    ];
    expect(Object.keys(XRAY_PRESETS).sort()).toEqual([...expected].sort());
  });

  it("builds a linear-HDR Fresnel ShaderMaterial with clipping plane support and seek-independent pulse", () => {
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.5);
    const mat = createXRayMaterial({
      preset: "xray-cyan",
      clippingPlanes: [plane],
      pulse: 0.4,
    });

    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.clipping).toBe(true);
    expect(mat.clippingPlanes).toEqual([plane]);
    expect(mat.vertexShader).toContain("#include <skinning_vertex>");
    expect(mat.fragmentShader).toContain("#include <clipping_planes_fragment>");
    expect(mat.fragmentShader).not.toContain("#include <tonemapping_fragment>");
    expect(mat.fragmentShader).not.toContain("#include <colorspace_fragment>");

    expect(mat.uniforms.uPulse.value).toBeCloseTo(0.4, 6);
    mat.update(5);
    const t1 = mat.uniforms.uTime.value as number;
    mat.update(42);
    mat.update(5);
    expect(mat.uniforms.uTime.value).toBe(t1);

    mat.setPulse(0.8);
    expect(mat.uniforms.uPulse.value).toBeCloseTo(0.8, 6);

    let disposed = 0;
    mat.addEventListener("dispose", () => {
      disposed++;
    });
    mat.dispose();
    expect(disposed).toBe(1);

    const ghost = createXRayMaterial({ preset: "ghost-shell", doubleSide: false });
    expect(ghost.blending).toBe(THREE.NormalBlending);
    expect(ghost.side).toBe(THREE.FrontSide);
    ghost.dispose();
  });

  it("throws a helpful error for unknown or prototype X-ray preset names", () => {
    expect(() => createXRayMaterial({ preset: "thermal" as XRayPresetName })).toThrow(
      /Unknown xray preset/,
    );
    expect(() => createXRayMaterial({ preset: "toString" as XRayPresetName })).toThrow(
      /Unknown xray preset/,
    );
  });
});

describe("createVolumetricBeam", () => {
  it("builds an additive N8AO-safe linear-HDR Fresnel cone beam with setIntensity and idempotent dispose", () => {
    const beam = createVolumetricBeam({
      length: 12,
      topRadius: 0.2,
      bottomRadius: 3.5,
      color: "#fff2cc",
      intensity: 1.4,
      opacity: 0.35,
    });

    expect(beam.mesh).toBeInstanceOf(THREE.Mesh);
    expect(beam.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(beam.material.transparent).toBe(true);
    expect(beam.material.depthWrite).toBe(false);
    expect(beam.material.blending).toBe(THREE.AdditiveBlending);
    expect(beam.material.fragmentShader).not.toContain("#include <tonemapping_fragment>");
    expect(beam.material.fragmentShader).not.toContain("#include <colorspace_fragment>");
    expect(beam.material.uniforms.uIntensity.value).toBeCloseTo(1.4, 6);

    beam.setIntensity(2.2);
    expect(beam.material.uniforms.uIntensity.value).toBeCloseTo(2.2, 6);
    beam.setIntensity(-1);
    expect(beam.material.uniforms.uIntensity.value).toBe(0);

    const parent = new THREE.Group();
    parent.add(beam.mesh);
    let geoDisposed = 0;
    let matDisposed = 0;
    beam.mesh.geometry.addEventListener("dispose", () => {
      geoDisposed++;
    });
    beam.material.addEventListener("dispose", () => {
      matDisposed++;
    });

    beam.dispose();
    beam.dispose();

    expect(beam.mesh.parent).toBeNull();
    expect(geoDisposed).toBe(1);
    expect(matDisposed).toBe(1);
  });
});

describe("createCausticsPlane", () => {
  it("builds an additive N8AO-safe linear-HDR caustic projection plane with seek-independent update and idempotent dispose", () => {
    const caustics = createCausticsPlane({
      size: [30, 20],
      color: "#7be8ff",
      intensity: 0.85,
      scale: 8,
      speed: 1.2,
      y: 0.05,
    });

    expect(caustics.mesh).toBeInstanceOf(THREE.Mesh);
    expect(caustics.mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
    expect(caustics.mesh.position.y).toBeCloseTo(0.05, 6);
    expect(caustics.mesh.userData.treatAsOpaque).toBe(true);
    expect(caustics.material.transparent).toBe(true);
    expect(caustics.material.depthWrite).toBe(false);
    expect(caustics.material.blending).toBe(THREE.AdditiveBlending);
    expect(caustics.material.fragmentShader).not.toContain("#include <tonemapping_fragment>");
    expect(caustics.material.fragmentShader).not.toContain("#include <colorspace_fragment>");

    caustics.update(5);
    const t1 = caustics.material.uniforms.uTime.value as number;
    caustics.update(18.5);
    caustics.update(5);
    expect(caustics.material.uniforms.uTime.value).toBe(t1);

    caustics.setIntensity(0.4);
    expect(caustics.material.uniforms.uIntensity.value).toBeCloseTo(0.4, 6);

    const parent = new THREE.Group();
    parent.add(caustics.mesh);
    let geoDisposed = 0;
    let matDisposed = 0;
    caustics.mesh.geometry.addEventListener("dispose", () => {
      geoDisposed++;
    });
    caustics.material.addEventListener("dispose", () => {
      matDisposed++;
    });

    caustics.dispose();
    caustics.dispose();

    expect(caustics.mesh.parent).toBeNull();
    expect(geoDisposed).toBe(1);
    expect(matDisposed).toBe(1);
  });
});

describe("FLAME_PRESETS and createFlame", () => {
  it("exposes all 6 procedural flame presets", () => {
    const expected: FlamePresetName[] = [
      "torch",
      "campfire",
      "candle",
      "burner",
      "thruster",
      "wildfire",
    ];
    expect(Object.keys(FLAME_PRESETS).sort()).toEqual([...expected].sort());
  });

  it("builds an additive N8AO-safe linear-HDR crossed-quad flame with seek-independent update, setIntensity, and idempotent dispose", () => {
    const flame = createFlame({ preset: "campfire", height: 2.0, width: 1.5, intensity: 3.0 });

    expect(flame.mesh).toBeInstanceOf(THREE.Mesh);
    expect(flame.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(flame.material.transparent).toBe(true);
    expect(flame.material.depthWrite).toBe(false);
    expect(flame.material.blending).toBe(THREE.AdditiveBlending);
    expect(flame.material.fragmentShader).not.toContain("#include <tonemapping_fragment>");
    expect(flame.material.fragmentShader).not.toContain("#include <colorspace_fragment>");

    flame.update(2.5);
    const t1 = flame.material.uniforms.uTime.value as number;
    flame.update(19.2);
    flame.update(2.5);
    expect(flame.material.uniforms.uTime.value).toBe(t1);

    flame.setIntensity(1.2);
    expect(flame.material.uniforms.uIntensity.value).toBeCloseTo(1.2, 6);
    flame.setIntensity(-4);
    expect(flame.material.uniforms.uIntensity.value).toBe(0);

    const parent = new THREE.Group();
    parent.add(flame.mesh);
    let geoDisposed = 0;
    let matDisposed = 0;
    flame.mesh.geometry.addEventListener("dispose", () => {
      geoDisposed++;
    });
    flame.material.addEventListener("dispose", () => {
      matDisposed++;
    });

    flame.dispose();
    flame.dispose();

    expect(flame.mesh.parent).toBeNull();
    expect(geoDisposed).toBe(1);
    expect(matDisposed).toBe(1);
  });

  it("throws a helpful error for unknown or prototype flame preset names", () => {
    expect(() => createFlame({ preset: "plasma" as FlamePresetName })).toThrow(
      /Unknown flame preset/,
    );
    expect(() => createFlame({ preset: "toString" as FlamePresetName })).toThrow(
      /Unknown flame preset/,
    );
  });
});
