// The free camera: looking around the scene without changing the film. Held like a camera: turning stays where you stand,
// because orbiting a target leaves these small rooms at once. It flies like Minecraft's creative flight (flight.ts)
import * as THREE from "three";

import type { FreeView } from "../core/engine";
import { S, wake } from "../core/state";
import { get, say, set } from "../core/store";
import { createFlight } from "./flight";

export const flight = createFlight(() => wake("render"));
// One frame's flying, by the time that passed since the last
export const fly = (dt: number) => {
  if (S.tools?.free.on) {
    const d = flight.step(dt, get().flySpeed);
    if (d) flyCam(...d);
  } else flight.clear();
};
const camDir = new THREE.Vector3(),
  camRight = new THREE.Vector3(),
  camUp = new THREE.Vector3(),
  sph = new THREE.Spherical();
export const turnAbout = (centre: THREE.Vector3, moving: THREE.Vector3, dx: number, dy: number) => {
  camDir.copy(moving).sub(centre);
  sph.setFromVector3(camDir);
  sph.theta += dx;
  sph.phi = Math.max(0.03, Math.min(Math.PI - 0.03, sph.phi + dy));
  camDir.setFromSpherical(sph);
  moving.copy(centre).add(camDir);
};
export const moveCam = (forward: number, right: number, up: number) => {
  const f = S.tools!.free;
  camDir.copy(f.l).sub(f.p).normalize();
  camRight.crossVectors(camDir, THREE.Object3D.DEFAULT_UP).normalize();
  camUp.crossVectors(camRight, camDir);
  const d = new THREE.Vector3()
    .addScaledVector(camDir, forward)
    .addScaledVector(camRight, right)
    .addScaledVector(camUp, up);
  f.p.add(d);
  f.l.add(d);
  S.viewMoved = true;
};
// The flying keys' move (picture/flight.ts), Minecraft's: forward and right level with the floor whatever the pitch, up straight up
export const flyCam = (forward: number, right: number, up: number) => {
  const f = S.tools!.free;
  camDir.copy(f.l).sub(f.p).setY(0).normalize();
  camRight.crossVectors(camDir, THREE.Object3D.DEFAULT_UP);
  const d = new THREE.Vector3()
    .addScaledVector(camDir, forward)
    .addScaledVector(camRight, right)
    .addScaledVector(THREE.Object3D.DEFAULT_UP, up);
  f.p.add(d);
  f.l.add(d);
  S.viewMoved = true;
};
// The first free camera after a page load starts at the film's home spot (tools.home), so a reload never leaves the
// creator wherever the playhead happened to be; later ones start from the shot's own camera, and so does one a drag on the
// picture turns on (here), which must turn the view seen
export const FREE_LENS_DEFAULTS = { fov: 60, roll: 0, wave: 0 } as const;

let customFreeFov = false;

export const defaultFreeFov = () =>
  S.tools?.home?.fov ?? S.tools?.camera?.fov ?? FREE_LENS_DEFAULTS.fov;

export const setFreeFov = (fov: number, resetCustom = false) => {
  const v = Math.round(Math.max(10, Math.min(120, fov)) * 10) / 10;
  customFreeFov = !resetCustom;
  const f = S.tools?.free;
  if (f) f.fov = v;
  set({ freeFov: v });
  S.viewMoved = true;
  wake("render");
};

export const resetFreeFov = () => setFreeFov(defaultFreeFov(), true);

export const setFreeRoll = (rad: number) => {
  const maxRad = Math.PI / 4;
  const v = Math.round(Math.max(-maxRad, Math.min(maxRad, rad)) * 1e4) / 1e4;
  const f = S.tools?.free;
  if (f) f.roll = v;
  set({ freeRoll: v });
  S.viewMoved = true;
  wake("render");
};

export const setFreeWave = (wave: number) => {
  const v = Math.round(Math.max(0, Math.min(3, wave)) * 100) / 100;
  const f = S.tools?.free;
  if (f) f.wave = v;
  set({ freeWave: v });
  S.viewMoved = true;
  wake("render");
};

let homed = false;
export const setFree = (on: boolean, here = false) => {
  const tools = S.tools;
  if (!tools) return;
  const f = tools.free,
    home = !homed && !here && tools.home;
  if (on && home) {
    f.p.set(...home.p);
    f.l.set(...home.l);
    f.fov = customFreeFov ? get().freeFov : (home.fov ?? tools.camera.fov);
  } else if (on) {
    f.p.copy(tools.camera.position);
    f.l.copy(tools.look);
    f.fov = customFreeFov ? get().freeFov : tools.camera.fov;
  }
  f.roll ??= get().freeRoll;
  f.wave ??= get().freeWave;
  if (on) homed = true;
  f.on = on;
  set({ free: on, freeFov: f.fov, freeRoll: f.roll ?? 0, freeWave: f.wave ?? 0 });
  S.dirty = true;
};

export const flyFree = (view: FreeView) => {
  const tools = S.tools;
  if (!tools) return;
  const f = tools.free;
  f.p.set(view.p[0], view.p[1], view.p[2]);
  f.l.set(view.l[0], view.l[1], view.l[2]);
  const fov =
    typeof view.fov === "number" && Number.isFinite(view.fov)
      ? Math.round(Math.max(10, Math.min(120, view.fov)) * 10) / 10
      : f.fov || defaultFreeFov();
  const maxRad = Math.PI / 4;
  const roll =
    typeof view.roll === "number" && Number.isFinite(view.roll)
      ? Math.round(Math.max(-maxRad, Math.min(maxRad, view.roll)) * 1e4) / 1e4
      : 0;
  const wave =
    typeof view.wave === "number" && Number.isFinite(view.wave)
      ? Math.round(Math.max(0, Math.min(3, view.wave)) * 100) / 100
      : 0;
  f.fov = fov;
  f.roll = roll;
  f.wave = wave;
  homed = true;
  f.on = true;
  set({ free: true, freeFov: fov, freeRoll: roll, freeWave: wave });
  S.viewMoved = true;
  S.dirty = true;
};

export const setFov = (d: number) => {
  const f = S.tools?.free;
  if (!f?.on) return;
  setFreeFov(f.fov + d);
  say(`FOV ${f.fov}°`);
};
