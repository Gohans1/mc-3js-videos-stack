import { describe, expect, it } from "bun:test";

import * as THREE from "three";

import {
  createParticleEmitter,
  createParticleField,
  EMITTER_PRESETS,
  PARTICLE_PRESETS,
  type EmitterPresetName,
  type ParticlePresetName,
} from "../src/particles";

const matrixBasisLength = (mat: THREE.Matrix4): number => {
  const e = mat.elements;
  return (
    Math.hypot(e[0], e[1], e[2]) +
    Math.hypot(e[4], e[5], e[6]) +
    Math.hypot(e[8], e[9], e[10])
  );
};

describe("PARTICLE_PRESETS and createParticleField", () => {
  it("exposes all 8 atmospheric particle presets", () => {
    const expected: ParticlePresetName[] = [
      "rain",
      "snow",
      "dust-motes",
      "embers",
      "bubbles",
      "marine-snow",
      "smoke-steam",
      "sand-ash",
    ];
    expect(Object.keys(PARTICLE_PRESETS).sort()).toEqual([...expected].sort());
  });

  it("throws a helpful error for unknown or prototype particle preset names", () => {
    expect(() => createParticleField({ preset: "confetti" as ParticlePresetName })).toThrow(
      /Unknown particle preset/,
    );
    expect(() => createParticleField({ preset: "toString" as ParticlePresetName })).toThrow(
      /Unknown particle preset/,
    );
  });

  it("creates a single InstancedMesh with procedural DataTexture and no DOM canvas requirement", () => {
    const steam = createParticleField({
      preset: "smoke-steam",
      count: 40,
      seed: 17,
      textureSize: 32,
    });

    expect(steam.mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(steam.mesh.count).toBe(40);
    expect(steam.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(steam.material.transparent).toBe(true);
    expect(steam.material.depthWrite).toBe(false);
    expect(steam.material.map).toBeInstanceOf(THREE.DataTexture);

    const data = (steam.material.map as THREE.DataTexture).image.data as Uint8Array;
    expect(data.length).toBe(32 * 32 * 4);
    expect(data[3]).toBe(0);

    let maxAlpha = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > maxAlpha) maxAlpha = data[i];
    }
    expect(maxAlpha).toBeGreaterThan(0);

    steam.dispose();
  });

  it("generates centered non-empty alpha across all 5 sprite kinds with opaque chunk center and transparent corners", () => {
    const cases: {
      name: string;
      handle: { material: THREE.MeshBasicMaterial; dispose: () => void };
      expectOpaqueCenter?: boolean;
    }[] = [
      { name: "soft", handle: createParticleField({ preset: "snow", count: 4, textureSize: 32 }) },
      {
        name: "puff",
        handle: createParticleField({ preset: "smoke-steam", count: 4, textureSize: 32 }),
      },
      {
        name: "streak",
        handle: createParticleField({ preset: "rain", count: 4, textureSize: 32 }),
      },
      {
        name: "ring",
        handle: createParticleField({ preset: "bubbles", count: 4, textureSize: 32 }),
      },
      {
        name: "chunk",
        handle: createParticleEmitter({ preset: "confetti", count: 4, textureSize: 32 }),
        expectOpaqueCenter: true,
      },
    ];

    for (const c of cases) {
      const tex = c.handle.material.map as THREE.DataTexture;
      const data = tex.image.data as Uint8Array;
      const size = 32;
      const centerAlpha = data[((size / 2) * size + size / 2) * 4 + 3];
      const cornerAlpha = data[3];
      expect(cornerAlpha, `${c.name} corner alpha`).toBe(0);
      if (c.expectOpaqueCenter) {
        expect(centerAlpha, `${c.name} center alpha`).toBe(255);
      } else {
        expect(centerAlpha, `${c.name} center alpha`).toBeGreaterThan(0);
      }
      c.handle.dispose();
    }
  });

  it("evaluates particle transforms deterministically and seek-independently at any t", () => {
    const a = createParticleField({ preset: "snow", count: 24, seed: 9, textureSize: 16 });
    const b = createParticleField({ preset: "snow", count: 24, seed: 9, textureSize: 16 });

    a.update(5);
    const snapshotAt5 = Array.from(a.mesh.instanceMatrix.array);

    a.update(123.4);
    expect(Array.from(a.mesh.instanceMatrix.array)).not.toEqual(snapshotAt5);

    a.update(5);
    expect(Array.from(a.mesh.instanceMatrix.array)).toEqual(snapshotAt5);

    b.update(5);
    expect(Array.from(b.mesh.instanceMatrix.array)).toEqual(snapshotAt5);

    a.update(Number.NaN);
    expect(a.mesh.instanceMatrix.array.every((v) => Number.isFinite(v))).toBe(true);

    a.dispose();
    b.dispose();
  });

  it("wraps particles around parented camera world position and hides particles inside nearHideRadius", () => {
    const field = createParticleField({
      preset: "rain",
      count: 64,
      bounds: [10, 10, 10],
      nearHideRadius: 2.0,
      seed: 3,
      textureSize: 16,
    });

    const rig = new THREE.Group();
    const cam = new THREE.PerspectiveCamera();
    rig.position.set(100, 20, -50);
    rig.add(cam);
    field.follow(cam);
    field.update(2.5);

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const camWorld = new THREE.Vector3(100, 20, -50);

    let hiddenCount = 0;
    let visibleCount = 0;

    for (let i = 0; i < field.mesh.count; i++) {
      field.mesh.getMatrixAt(i, m);
      pos.set(m.elements[12], m.elements[13], m.elements[14]);
      expect(Math.abs(pos.x - 100)).toBeLessThanOrEqual(5.001);
      expect(Math.abs(pos.y - 20)).toBeLessThanOrEqual(5.001);
      expect(Math.abs(pos.z + 50)).toBeLessThanOrEqual(5.001);

      const dist = pos.distanceTo(camWorld);
      if (dist < 2.0) {
        expect(matrixBasisLength(m)).toBe(0);
        hiddenCount++;
      } else {
        expect(matrixBasisLength(m)).toBeGreaterThan(0);
        visibleCount++;
      }
    }

    expect(visibleCount).toBeGreaterThan(0);
    expect(hiddenCount).toBeGreaterThan(0);

    const tightCamField = createParticleField({
      preset: "dust-motes",
      count: 12,
      bounds: [0.4, 0.4, 0.4],
      nearHideRadius: 1.0,
      seed: 1,
      textureSize: 16,
    });
    tightCamField.update(0, cam);
    for (let i = 0; i < tightCamField.mesh.count; i++) {
      tightCamField.mesh.getMatrixAt(i, m);
      expect(matrixBasisLength(m)).toBe(0);
    }

    field.dispose();
    tightCamField.dispose();
  });

  it("updates instanceMatrix synchronously inside follow(cam) and keeps origin-anchored fields fixed", () => {
    const field = createParticleField({
      preset: "snow",
      count: 16,
      bounds: [10, 10, 10],
      seed: 5,
      textureSize: 16,
    });
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(40, 15, -30);

    field.follow(cam);
    const m = new THREE.Matrix4();
    for (let i = 0; i < field.mesh.count; i++) {
      field.mesh.getMatrixAt(i, m);
      expect(Math.abs(m.elements[12] - 40)).toBeLessThanOrEqual(5.001);
      expect(Math.abs(m.elements[13] - 15)).toBeLessThanOrEqual(5.001);
      expect(Math.abs(m.elements[14] + 30)).toBeLessThanOrEqual(5.001);
    }
    field.dispose();

    const anchored = createParticleField({
      preset: "dust-motes",
      count: 16,
      bounds: [8, 8, 8],
      origin: [50, 10, -20],
      nearHideRadius: 0.35,
      seed: 8,
      textureSize: 16,
    });
    anchored.follow(cam);
    anchored.update(1.0);
    for (let i = 0; i < anchored.mesh.count; i++) {
      anchored.mesh.getMatrixAt(i, m);
      expect(Math.abs(m.elements[12] - 50)).toBeLessThanOrEqual(4.001);
      expect(Math.abs(m.elements[13] - 10)).toBeLessThanOrEqual(4.001);
      expect(Math.abs(m.elements[14] + 20)).toBeLessThanOrEqual(4.001);
    }
    anchored.dispose();
  });

  it("scales active count and opacity via setIntensity and handles zero/negative/NaN safely", () => {
    const field = createParticleField({ preset: "embers", count: 50, textureSize: 16 });
    const baseOpacity = field.material.opacity;

    field.setIntensity(0.5);
    expect(field.mesh.count).toBe(25);
    expect(field.material.opacity).toBeCloseTo(baseOpacity * 0.5, 6);
    expect(field.mesh.visible).toBe(true);

    field.setIntensity(0);
    expect(field.mesh.count).toBe(0);
    expect(field.mesh.visible).toBe(false);

    field.setIntensity(1);
    expect(field.mesh.count).toBe(50);
    expect(field.material.opacity).toBeCloseTo(baseOpacity, 6);
    expect(field.mesh.visible).toBe(true);

    field.setIntensity(-3);
    expect(field.mesh.count).toBe(0);

    field.setIntensity(Number.NaN);
    expect(field.mesh.count).toBe(0);

    field.dispose();
  });

  it("removes from parent and disposes InstancedMesh, geometry, material, and DataTexture idempotently", () => {
    const parent = new THREE.Group();
    const field = createParticleField({ preset: "bubbles", count: 16, textureSize: 16 });
    parent.add(field.mesh);
    const tex = field.material.map!;

    let meshDisposed = 0;
    let geoDisposed = 0;
    let matDisposed = 0;
    let texDisposed = 0;

    field.mesh.addEventListener("dispose", () => {
      meshDisposed++;
    });
    field.mesh.geometry.addEventListener("dispose", () => {
      geoDisposed++;
    });
    field.material.addEventListener("dispose", () => {
      matDisposed++;
    });
    tex.addEventListener("dispose", () => {
      texDisposed++;
    });

    field.dispose();
    field.dispose();

    expect(field.mesh.parent).toBeNull();
    expect(meshDisposed).toBe(1);
    expect(geoDisposed).toBe(1);
    expect(matDisposed).toBe(1);
    expect(texDisposed).toBe(1);
  });
});

describe("EMITTER_PRESETS and createParticleEmitter", () => {
  it("exposes all 7 ballistic emitter presets", () => {
    const expected: EmitterPresetName[] = [
      "sparks",
      "dust-puff",
      "splash",
      "stream",
      "steam-jet",
      "debris",
      "confetti",
    ];
    expect(Object.keys(EMITTER_PRESETS).sort()).toEqual([...expected].sort());
  });

  it("throws a helpful error for unknown or prototype emitter preset names", () => {
    expect(() => createParticleEmitter({ preset: "fireworks" as EmitterPresetName })).toThrow(
      /Unknown emitter preset/,
    );
    expect(() => createParticleEmitter({ preset: "constructor" as EmitterPresetName })).toThrow(
      /Unknown emitter preset/,
    );
  });

  it("scales additive emitter intensity linearly via material.opacity without mutating instanceColor", () => {
    const a = createParticleEmitter({
      preset: "sparks",
      triggerAt: 0,
      lifetime: 1.0,
      count: 16,
      seed: 11,
      textureSize: 16,
    });
    const b = createParticleEmitter({
      preset: "sparks",
      triggerAt: 0,
      lifetime: 1.0,
      count: 16,
      seed: 11,
      textureSize: 16,
    });

    expect(a.mesh.instanceColor).not.toBeNull();
    const baseOpacity = a.material.opacity;

    a.setIntensity(0.5);
    a.update(0.35);

    b.update(0.35);
    b.setIntensity(0.5);

    expect(a.material.opacity).toBeCloseTo(baseOpacity * 0.5, 6);
    expect(b.material.opacity).toBeCloseTo(baseOpacity * 0.5, 6);
    expect(Array.from(a.mesh.instanceColor!.array)).toEqual(Array.from(b.mesh.instanceColor!.array));

    a.dispose();
    b.dispose();
  });

  it("uses crossed-quad geometry only on velocityAligned emitters, single quads on puffs, and supports confetti tint", () => {
    const sparks = createParticleEmitter({ preset: "sparks", count: 8, textureSize: 16 });
    const confetti = createParticleEmitter({
      preset: "confetti",
      count: 8,
      color: "#ff88aa",
      emissiveGain: 1,
      textureSize: 16,
    });

    expect(sparks.mesh.geometry.index!.count).toBe(12);
    expect(confetti.mesh.geometry.index!.count).toBe(6);
    expect(confetti.material.color.getHex()).toBe(0xff88aa);

    const puff = createParticleEmitter({
      preset: "dust-puff",
      triggerAt: 0,
      lifetime: 2.0,
      count: 8,
      seed: 4,
      textureSize: 16,
    });
    expect(puff.mesh.geometry.index!.count).toBe(6);

    const cam = new THREE.PerspectiveCamera();
    cam.position.set(10, 4, 8);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);

    puff.update(0.4, cam);

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const camZ = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion).normalize();
    const instZ = new THREE.Vector3();

    let checked = 0;
    for (let i = 0; i < puff.mesh.count; i++) {
      puff.mesh.getMatrixAt(i, m);
      if (matrixBasisLength(m) === 0) continue;
      m.decompose(pos, quat, scale);
      instZ.set(0, 0, 1).applyQuaternion(quat).normalize();
      expect(Math.abs(instZ.dot(camZ))).toBeCloseTo(1, 4);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);

    sparks.dispose();
    confetti.dispose();
    puff.dispose();
  });

  it("supports prewarm: false stream mode and matches closed-form damped-drag ballistic kinematics", () => {
    const stream = createParticleEmitter({
      preset: "steam-jet",
      mode: "stream",
      triggerAt: 2.0,
      prewarm: false,
      lifetime: 2.0,
      count: 20,
      seed: 9,
      textureSize: 16,
    });

    const m = new THREE.Matrix4();
    const countActive = (mesh: THREE.InstancedMesh): number => {
      let n = 0;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        if (matrixBasisLength(m) > 0) n++;
      }
      return n;
    };

    stream.update(1.9);
    expect(countActive(stream.mesh)).toBe(0);
    stream.update(2.25);
    const early = countActive(stream.mesh);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(20);
    stream.update(3.5);
    expect(countActive(stream.mesh)).toBeGreaterThan(early);
    stream.dispose();

    const drag = 2.0;
    const gravity = -10.0;
    const speed = 8.0;
    const origin: [number, number, number] = [3, 4, -2];
    const ballistic = createParticleEmitter({
      preset: "debris",
      mode: "burst",
      triggerAt: 0,
      origin,
      direction: [0, 1, 0],
      spread: 0,
      speed,
      gravity,
      drag,
      lifetime: 4.0,
      count: 1,
      seed: 1,
      textureSize: 16,
    });

    const t1 = 0.5;
    const t2 = 1.0;
    ballistic.update(t1);
    ballistic.mesh.getMatrixAt(0, m);
    const y1 = m.elements[13];
    const x1 = m.elements[12];
    const z1 = m.elements[14];
    expect(x1).toBeCloseTo(origin[0], 5);
    expect(z1).toBeCloseTo(origin[2], 5);

    ballistic.update(t2);
    ballistic.mesh.getMatrixAt(0, m);
    const y2 = m.elements[13];

    const yAt = (age: number): number => {
      const e = Math.exp(-drag * age);
      const a = (1 - e) / drag;
      const b = (age - a) / drag;
      return origin[1] + speed * a + gravity * b;
    };
    let bestDelay = 0;
    let bestErr = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 400; step++) {
      const delay = (step / 400) * 0.32;
      const err = Math.abs(yAt(t1 - delay) - y1);
      if (err < bestErr) {
        bestErr = err;
        bestDelay = delay;
      }
    }
    expect(bestErr).toBeLessThan(0.01);
    expect(y2).toBeCloseTo(yAt(t2 - bestDelay), 2);
    ballistic.dispose();

    const zeroDrag = createParticleEmitter({
      preset: "debris",
      mode: "burst",
      triggerAt: 0,
      origin: [1, 2, 3],
      direction: [0, 1, 0],
      spread: 0,
      speed: 10,
      gravity: -10,
      drag: 0,
      lifetime: 4.0,
      count: 1,
      seed: 1,
      textureSize: 16,
    });
    zeroDrag.update(0.6);
    zeroDrag.mesh.getMatrixAt(0, m);
    const zy1 = m.elements[13];
    zeroDrag.update(1.2);
    zeroDrag.mesh.getMatrixAt(0, m);
    const zy2 = m.elements[13];
    const zeroDragY = (age: number) => 2 + 10 * age - 5 * age * age;
    let bestZeroDelay = 0;
    let bestZeroErr = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 400; step++) {
      const d = (step / 400) * 0.32;
      const err = Math.abs(zeroDragY(0.6 - d) - zy1);
      if (err < bestZeroErr) {
        bestZeroErr = err;
        bestZeroDelay = d;
      }
    }
    expect(bestZeroErr).toBeLessThan(0.01);
    expect(zy2).toBeCloseTo(zeroDragY(1.2 - bestZeroDelay), 2);
    zeroDrag.dispose();

    const multiCycle = createParticleEmitter({
      preset: "stream",
      mode: "stream",
      triggerAt: 0,
      prewarm: true,
      lifetime: 1.0,
      count: 12,
      seed: 15,
      textureSize: 16,
    });
    multiCycle.update(0.4);
    const cycle0 = Array.from(multiCycle.mesh.instanceMatrix.array);
    multiCycle.update(3.4);
    const cycle3 = Array.from(multiCycle.mesh.instanceMatrix.array);
    expect(cycle3).not.toEqual(cycle0);
    multiCycle.update(0.4);
    expect(Array.from(multiCycle.mesh.instanceMatrix.array)).toEqual(cycle0);
    multiCycle.update(3.4);
    expect(Array.from(multiCycle.mesh.instanceMatrix.array)).toEqual(cycle3);
    multiCycle.dispose();
  });

  it("evaluates burst mode strictly inactive before triggerAt and after triggerAt + lifetime, and seek-independently inside", () => {
    const emitter = createParticleEmitter({
      preset: "sparks",
      mode: "burst",
      triggerAt: 2.0,
      lifetime: 1.0,
      count: 32,
      origin: [1, 2, 3],
      seed: 7,
      textureSize: 16,
    });

    const m = new THREE.Matrix4();
    const countActive = (): number => {
      let active = 0;
      for (let i = 0; i < emitter.mesh.count; i++) {
        emitter.mesh.getMatrixAt(i, m);
        if (matrixBasisLength(m) > 0) active++;
      }
      return active;
    };

    emitter.update(1.5);
    expect(countActive()).toBe(0);

    emitter.update(2.5);
    expect(countActive()).toBeGreaterThan(0);
    const snapAt25 = Array.from(emitter.mesh.instanceMatrix.array);

    emitter.update(3.5);
    expect(countActive()).toBe(0);

    emitter.update(2.5);
    expect(Array.from(emitter.mesh.instanceMatrix.array)).toEqual(snapAt25);

    emitter.dispose();
  });

  it("supports multi-trigger bursts, continuous stream mode, setOrigin, and setIntensity", () => {
    const multi = createParticleEmitter({
      preset: "splash",
      mode: "burst",
      triggerAt: [1.0, 4.0],
      lifetime: 0.8,
      count: 20,
      seed: 5,
      textureSize: 16,
    });

    const m = new THREE.Matrix4();
    const hasAnyActive = (mesh: THREE.InstancedMesh): boolean => {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        if (matrixBasisLength(m) > 0) return true;
      }
      return false;
    };

    multi.update(0.5);
    expect(hasAnyActive(multi.mesh)).toBe(false);
    multi.update(1.3);
    expect(hasAnyActive(multi.mesh)).toBe(true);
    multi.update(2.5);
    expect(hasAnyActive(multi.mesh)).toBe(false);
    multi.update(4.3);
    expect(hasAnyActive(multi.mesh)).toBe(true);
    multi.dispose();

    const stream = createParticleEmitter({
      preset: "steam-jet",
      count: 24,
      origin: [0, 0, 0],
      seed: 12,
      textureSize: 16,
    });
    stream.update(2.5);
    const beforeOrigin = Array.from(stream.mesh.instanceMatrix.array);
    stream.setOrigin([10, 5, -4]);
    stream.update(2.5);
    expect(Array.from(stream.mesh.instanceMatrix.array)).not.toEqual(beforeOrigin);

    stream.setIntensity(0);
    expect(stream.mesh.count).toBe(0);
    expect(stream.mesh.visible).toBe(false);
    stream.setIntensity(0.5);
    expect(stream.mesh.count).toBe(12);
    expect(stream.mesh.visible).toBe(true);

    stream.dispose();

    const lowIntensityStream = createParticleEmitter({
      preset: "stream",
      mode: "stream",
      prewarm: true,
      origin: [0, 0, 0],
      direction: [0, 1, 0],
      spread: 0,
      speed: 10,
      gravity: 0,
      drag: 0,
      lifetime: 1.0,
      count: 40,
      seed: 13,
      textureSize: 16,
    });
    lowIntensityStream.setIntensity(0.25);
    expect(lowIntensityStream.mesh.count).toBe(10);
    for (const sampleT of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      lowIntensityStream.update(sampleT);
      let activeNow = 0;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < lowIntensityStream.mesh.count; i++) {
        lowIntensityStream.mesh.getMatrixAt(i, m);
        if (matrixBasisLength(m) > 0) {
          activeNow++;
          const y = m.elements[13];
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      expect(activeNow, `active at t=${sampleT}`).toBeGreaterThan(0);
      expect(maxY - minY, `spatial span at t=${sampleT}`).toBeGreaterThan(4.0);
    }
    lowIntensityStream.dispose();
  });

  it("removes from parent and disposes emitter mesh, geometry, material, and texture idempotently", () => {
    const parent = new THREE.Group();
    const emitter = createParticleEmitter({ preset: "confetti", count: 16, textureSize: 16 });
    parent.add(emitter.mesh);
    const tex = emitter.material.map!;

    let meshDisposed = 0;
    let geoDisposed = 0;
    let matDisposed = 0;
    let texDisposed = 0;

    emitter.mesh.addEventListener("dispose", () => {
      meshDisposed++;
    });
    emitter.mesh.geometry.addEventListener("dispose", () => {
      geoDisposed++;
    });
    emitter.material.addEventListener("dispose", () => {
      matDisposed++;
    });
    tex.addEventListener("dispose", () => {
      texDisposed++;
    });

    emitter.dispose();
    emitter.dispose();

    expect(emitter.mesh.parent).toBeNull();
    expect(meshDisposed).toBe(1);
    expect(geoDisposed).toBe(1);
    expect(matDisposed).toBe(1);
    expect(texDisposed).toBe(1);
  });
});
