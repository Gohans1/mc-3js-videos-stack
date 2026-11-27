import { describe, expect, test } from "bun:test";

import * as THREE from "three";

import {
  fireQuads,
  hudFov,
  placeOnCamera,
  viewAngles,
  viewBlockingProbes,
  waterOverlay,
} from "../src/screen-effects";

const look = (x: number, y: number, z: number) => {
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
  cam.lookAt(x, y, z);
  cam.updateMatrixWorld();
  return viewAngles(cam);
};

describe("view angles in the game's convention", () => {
  test("yaw 0 faces south, 90 west, -90 east; pitch 90 looks straight down", () => {
    expect(look(0, 0, 1).yaw).toBeCloseTo(0);
    expect(look(-1, 0, 0).yaw).toBeCloseTo(90);
    expect(look(1, 0, 0).yaw).toBeCloseTo(-90);
    expect(look(0, -1, 0.0001).pitch).toBeCloseTo(90, 1);
    expect(look(0, 1, 0.0001).pitch).toBeCloseTo(-90, 1);
  });
});

describe("underwater overlay (LevelExtractor.extractPlayerState)", () => {
  test("brightness follows the light level's curve and the alpha stays at 0.1", () => {
    expect(waterOverlay({ light: 15 })).toMatchObject({ brightness: 1, alpha: 0.1 });
    expect(waterOverlay({ light: 0 }).brightness).toBe(0);
    expect(waterOverlay({ light: 7 }).brightness).toBeCloseTo(7 / 15 / (4 - (3 * 7) / 15), 6);
  });

  test("the texture slides one repeat for every 64 degrees turned or tilted", () => {
    const a = waterOverlay({ yaw: 10, pitch: 5 });
    const b = waterOverlay({ yaw: 74, pitch: 69 });
    expect(a.u - b.u).toBeCloseTo(1);
    expect(b.v - a.v).toBeCloseTo(1);
  });
});

describe("hud projection (Camera.calculateHudFov)", () => {
  test("the overlay's field of view is 70, narrowed to 6/7 in water or lava", () => {
    expect(hudFov(false)).toBe(70);
    expect(hudFov(true)).toBeCloseTo(60, 4);
  });

  test("overlays parented to a film camera land where the game's hud camera puts them", () => {
    for (const fov of [25, 50, 70, 100]) {
      const film = new THREE.PerspectiveCamera(fov, 9 / 16, 0.05, 100);
      const group = new THREE.Group();
      film.add(group);
      placeOnCamera(group, film, 60);
      film.updateMatrixWorld(true);
      const hud = new THREE.PerspectiveCamera(60, 9 / 16, 0.05, 100);
      hud.updateMatrixWorld(true);
      for (const p of [new THREE.Vector3(-1, -1, -0.5), new THREE.Vector3(0.74, 0.2, -0.41)]) {
        const viaFilm = p.clone().applyMatrix4(group.matrixWorld).project(film);
        const viaHud = p.clone().project(hud);
        expect(viaFilm.x).toBeCloseTo(viaHud.x, 5);
        expect(viaFilm.y).toBeCloseTo(viaHud.y, 5);
      }
    }
  });

  test("overlays stay in front of a far near plane", () => {
    const film = new THREE.PerspectiveCamera(70, 1, 0.6, 100);
    const group = new THREE.Group();
    placeOnCamera(group, film, 70);
    const nearest = Math.min(...fireQuads().flatMap((q) => q.map((c) => -c[2])));
    expect(nearest * group.scale.z).toBeGreaterThan(0.6);
  });
});

describe("fire overlay (ScreenEffectRenderer.submitFire)", () => {
  test("two quads rise from below the screen to 0.2 above its middle, their outer edges turned 10 degrees toward the eye", () => {
    const [right, left] = fireQuads();
    for (const q of [right!, left!]) {
      expect(Math.max(...q.map((c) => c[1]))).toBeCloseTo(0.2);
      expect(Math.min(...q.map((c) => c[1]))).toBeCloseTo(-0.8);
    }
    expect(right![1]![2]).toBeGreaterThan(right![0]![2]);
    expect(Math.min(...right!.map((c) => c[0]))).toBeGreaterThan(-0.2);
    for (const [i, j] of [
      [0, 1],
      [1, 0],
      [2, 3],
      [3, 2],
    ] as const) {
      expect(left![i]![0]).toBeCloseTo(-right![j]![0]);
      expect(left![i]![2]).toBeCloseTo(right![j]![2]);
    }
  });
});

describe("inside a block (LevelExtractor.getViewBlockingState)", () => {
  test("eight probes box the eye: 0.24 to each side for a player, 0.05 above and below", () => {
    const probes = viewBlockingProbes([10.5, 65.62, -3.5]);
    expect(probes).toHaveLength(8);
    expect(new Set(probes.map((p) => p.join())).size).toBe(8);
    for (const [x, y, z] of probes) {
      expect(Math.abs(x - 10.5)).toBeCloseTo(0.24);
      expect(Math.abs(y - 65.62)).toBeCloseTo(0.05);
      expect(Math.abs(z + 3.5)).toBeCloseTo(0.24);
    }
  });

  test("smaller or scaled bodies probe a smaller box", () => {
    const [x, y] = viewBlockingProbes([0, 0, 0], { width: 0.3, scale: 0.5 })[0]!;
    expect(Math.abs(x)).toBeCloseTo(0.12);
    expect(Math.abs(y)).toBeCloseTo(0.025);
  });
});
