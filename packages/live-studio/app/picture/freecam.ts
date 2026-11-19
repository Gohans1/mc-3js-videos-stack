// The free camera: looking around the scene without changing the film. Held like a camera: turning stays where you stand,
// because orbiting a target leaves these small rooms at once. It flies like Minecraft's creative flight (flight.ts)
import { clampFov } from "film-kit/lens";
import * as THREE from "three";

import type { FreeView } from "../core/engine";
import { S, wake } from "../core/state";
import { get, say, set, setPref } from "../core/store";
import { cameraSurfaces, EYE_HEIGHT, floorAt, walkPosition } from "./camera-collision";
import { createFlight } from "./flight";

export const flight = createFlight(() => wake("render"));
// One frame's flying, by the time that passed since the last
export const fly = (dt: number) => {
  if (S.tools?.free.on && !get().freeLocked) {
    const d = flight.step(dt, get().flySpeed);
    if (d) flyCam(...d);
  } else flight.clear(true);
};
const camDir = new THREE.Vector3(),
  camRight = new THREE.Vector3(),
  camUp = new THREE.Vector3(),
  sph = new THREE.Spherical();
let orbitPivot: THREE.Vector3 | null = null;
type View = {
  p: THREE.Vector3;
  l: THREE.Vector3;
  fov: number;
  pivot: THREE.Vector3 | null;
  navigation: "fly" | "walk";
};
const past: View[] = [];
const future: View[] = [];
const view = (): View => {
  const f = S.tools!.free;
  return {
    p: f.p.clone(),
    l: f.l.clone(),
    fov: f.fov,
    pivot: orbitPivot?.clone() ?? null,
    navigation: get().freeNavigation,
  };
};
const sameView = (a: View, b: View) =>
  a.p.equals(b.p) &&
  a.l.equals(b.l) &&
  a.fov === b.fov &&
  a.navigation === b.navigation &&
  (a.pivot ? !!b.pivot && a.pivot.equals(b.pivot) : !b.pivot);
export const rememberFreeView = () => {
  if (!S.tools?.free.on || get().freeLocked) return;
  const now = view();
  if (past.at(-1) && sameView(past.at(-1)!, now)) return;
  past.push(now);
  if (past.length > 32) past.shift();
  future.length = 0;
};
export const restoreFreeView = (direction: -1 | 1) => {
  const f = S.tools?.free;
  if (!f?.on || get().freeLocked) return;
  const from = direction < 0 ? past : future;
  const to = direction < 0 ? future : past;
  const now = view();
  let target = from.pop();
  while (target && sameView(target, now)) target = from.pop();
  if (!target) return;
  to.push(now);
  f.p.copy(target.p);
  f.l.copy(target.l);
  f.fov = target.fov;
  orbitPivot = target.pivot;
  flight.clear(true);
  walkTime = -Infinity;
  set({ freeNavigation: target.navigation, freeFov: target.fov });
  S.viewMoved = true;
  S.finalAt = -1;
};

export const setOrbitPivot = (point: [number, number, number]) => {
  if (!S.tools?.free.on || get().freeLocked) return;
  rememberFreeView();
  orbitPivot = new THREE.Vector3(...point);
  say("Orbit pivot set. Shift-drag to orbit");
};
export const orbitFree = (dx: number, dy: number) => {
  const f = S.tools?.free;
  if (!f?.on || get().freeLocked) return;
  const pivot = orbitPivot ?? f.l;
  const from = f.p.clone().sub(pivot);
  if (!from.lengthSq()) return;
  if (get().freeNavigation === "walk") setFreeNavigation("fly");
  turnAbout(pivot, f.p, dx, dy);
  if (orbitPivot) {
    const to = f.p.clone().sub(pivot);
    const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    f.l.sub(pivot).applyQuaternion(q).add(pivot);
  }
  S.finalAt = -1;
};
export const setFreeLock = (locked: boolean) => {
  flight.clear(true);
  set({ freeLocked: locked });
  S.dirty = true;
};
export const setFreeLook = (on: boolean) => {
  const f = S.tools?.free;
  if (!f || f.previewEffects === undefined) return;
  f.previewEffects = on;
  setPref("freeLook", on);
  S.dirty = true;
  S.finalAt = -1;
};
let walkGeometry: ReturnType<typeof cameraSurfaces> = [];
let walkTime = -Infinity;
const surfacesForWalk = () => {
  if (walkTime !== S.t) {
    walkGeometry = cameraSurfaces();
    walkTime = S.t;
  }
  return walkGeometry;
};
export const setFreeNavigation = (mode: "fly" | "walk") => {
  const f = S.tools?.free;
  if (!f?.on || get().freeLocked || mode === get().freeNavigation) return;
  if (mode === "walk") {
    walkTime = -Infinity;
    const y = floorAt(f.p, surfacesForWalk(), 20, EYE_HEIGHT + 0.3);
    if (y === null) return say("Move above a visible floor to start walking");
    rememberFreeView();
    f.l.y += y - f.p.y;
    f.p.y = y;
    S.viewMoved = true;
  } else rememberFreeView();
  flight.clear(true);
  set({ freeNavigation: mode });
  S.finalAt = -1;
};
export const axisView = (axis: "top" | "front" | "side") => {
  const f = S.tools?.free;
  if (!f?.on || get().freeLocked) return;
  rememberFreeView();
  if (get().freeNavigation === "walk") setFreeNavigation("fly");
  const pivot = (orbitPivot ?? f.l).clone();
  const distance = Math.max(0.5, f.p.distanceTo(pivot));
  const direction =
    axis === "top"
      ? new THREE.Vector3(0, 1, 1e-5)
      : axis === "front"
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(1, 0, 0);
  f.p.copy(pivot).addScaledVector(direction.normalize(), distance);
  f.l.copy(pivot);
  S.viewMoved = true;
  S.finalAt = -1;
};

export const turnAbout = (centre: THREE.Vector3, moving: THREE.Vector3, dx: number, dy: number) => {
  camDir.copy(moving).sub(centre);
  sph.setFromVector3(camDir);
  sph.theta += dx;
  sph.phi = Math.max(0.03, Math.min(Math.PI - 0.03, sph.phi + dy));
  camDir.setFromSpherical(sph);
  moving.copy(centre).add(camDir);
  S.finalAt = -1;
};
export const moveCam = (forward: number, right: number, up: number) => {
  if (get().freeLocked) return;
  if (get().freeNavigation === "walk") return flyCam(forward, right, 0);
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
  S.finalAt = -1;
};
// The flying keys' move (picture/flight.ts), Minecraft's: forward and right level with the floor whatever the pitch, up straight up
export const flyCam = (forward: number, right: number, up: number) => {
  if (get().freeLocked) return;
  const f = S.tools!.free;
  camDir.copy(f.l).sub(f.p).setY(0).normalize();
  camRight.crossVectors(camDir, THREE.Object3D.DEFAULT_UP);
  const d = new THREE.Vector3()
    .addScaledVector(camDir, forward)
    .addScaledVector(camRight, right)
    .addScaledVector(THREE.Object3D.DEFAULT_UP, up);
  if (get().freeNavigation === "walk") d.copy(walkPosition(f.p, d, surfacesForWalk()).sub(f.p));
  f.p.add(d);
  f.l.add(d);
  S.viewMoved = true;
  S.finalAt = -1;
};
// The first free camera after a page load starts at the film's home spot (tools.home), so a reload never leaves the
// creator wherever the playhead happened to be; later ones start from the shot's own camera, and so does one a drag on the
// picture turns on (here), which must turn the view seen
export const FREE_LENS_DEFAULTS = { fov: 60, roll: 0, wave: 0 } as const;

let customFreeFov = false;
let enteredFreeFov: number | null = null;

export const defaultFreeFov = () =>
  S.tools?.home?.fov ??
  enteredFreeFov ??
  (S.tools?.free.on ? undefined : S.tools?.camera?.fov) ??
  FREE_LENS_DEFAULTS.fov;

export const setFreeFov = (fov: number, resetCustom = false) => {
  const v = Math.round(clampFov(fov) * 10) / 10;
  customFreeFov = !resetCustom;
  const f = S.tools?.free;
  if (f) f.fov = v;
  set({ freeFov: v });
  S.viewMoved = true;
  S.finalAt = -1;
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
  S.finalAt = -1;
  wake("render");
};

export const setFreeWave = (wave: number) => {
  const v = Math.round(Math.max(0, Math.min(3, wave)) * 100) / 100;
  const f = S.tools?.free;
  if (f) f.wave = v;
  set({ freeWave: v });
  S.viewMoved = true;
  S.finalAt = -1;
  wake("render");
};

let homed = false;
export const setFree = (on: boolean, here = false) => {
  const tools = S.tools;
  if (!tools) return;
  const f = tools.free,
    home = !homed && !here && tools.home;
  const preserve = on && homed && get().freeLocked;
  if (on && !f.on) {
    enteredFreeFov = tools.home?.fov ?? tools.cameraSample?.()?.fov ?? tools.camera.fov;
  } else if (!on) {
    enteredFreeFov = null;
  }
  if (on && home && !preserve) {
    f.p.set(...home.p);
    f.l.set(...home.l);
    f.fov = customFreeFov ? get().freeFov : (home.fov ?? tools.camera.fov);
  } else if (on && !preserve) {
    f.p.copy(tools.camera.position);
    f.l.copy(tools.look);
    f.fov = customFreeFov ? get().freeFov : tools.camera.fov;
  }
  if (on) {
    homed = true;
    if (!preserve) orbitPivot = null;
    if (f.previewEffects !== undefined) f.previewEffects = get().freeLook;
    if (!preserve && get().freeNavigation === "walk") set({ freeNavigation: "fly" });
  }
  f.roll ??= get().freeRoll;
  f.wave ??= get().freeWave;
  f.on = on;
  set({ free: on, freeFov: f.fov, freeRoll: f.roll ?? 0, freeWave: f.wave ?? 0 });
  S.dirty = true;
  S.finalAt = -1;
};

export const flyFree = (view: FreeView) => {
  const tools = S.tools;
  if (!tools) return;
  const f = tools.free;
  if (!f.on) enteredFreeFov = tools.home?.fov ?? tools.cameraSample?.()?.fov ?? tools.camera.fov;
  f.p.set(view.p[0], view.p[1], view.p[2]);
  f.l.set(view.l[0], view.l[1], view.l[2]);
  const fov =
    typeof view.fov === "number" && Number.isFinite(view.fov)
      ? Math.round(clampFov(view.fov) * 10) / 10
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
  orbitPivot = null;
  if (f.previewEffects !== undefined) f.previewEffects = get().freeLook;
  if (get().freeNavigation === "walk") set({ freeNavigation: "fly" });
  homed = true;
  f.on = true;
  set({ free: true, freeFov: fov, freeRoll: roll, freeWave: wave });
  S.viewMoved = true;
  S.dirty = true;
  S.finalAt = -1;
};

export const setFov = (d: number) => {
  const f = S.tools?.free;
  if (!f?.on || get().freeLocked) return;
  rememberFreeView();
  setFreeFov(f.fov + d);
  say(`FOV ${f.fov}°`);
};
