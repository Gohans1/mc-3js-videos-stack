import { clampFov, fovOf, MAX_FOV, MIN_FOV } from "film-kit/lens";
import type { FocusTargetSpec } from "film-stage/camera";
import type { FreeCam } from "film/scene";
import * as THREE from "three";

import { saveView as applyFreeToKeyframe } from "../camera/cam";
import {
  type HandheldSpec,
  normalizeFocusSpec,
  normalizeHandheldSpec,
} from "../camera/camera-edit";
import { cancelCameraPick } from "../camera/camera-framing";
import type { CameraPick } from "../camera/slice";
import type { FreeView } from "../core/engine";
import { S, wake } from "../core/state";
import { get, say, set, setPref } from "../core/store";
import { cameraSurfaces, EYE_HEIGHT, floorAt, walkPosition } from "./camera-collision";
import { setCompareVideoMode } from "./compare-video";
import { createFlight } from "./flight";
import type { FreeTouched } from "./slice";

export { applyFreeToKeyframe };

const touchFree = (moved = true) => {
  if (moved) S.viewMoved = true;
  S.dirty = true;
  S.finalAt = -1;
  wake("render");
};

export const flight = createFlight(() => wake("render"));
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
export const freeHistoryCounts = () => ({ back: past.length, forward: future.length });

export const rememberFreeView = () => {
  if (!S.tools?.free.on || get().freeLocked) return;
  const now = view();
  if (past.at(-1) && sameView(past.at(-1)!, now)) return;
  past.push(now);
  if (past.length > 32) past.shift();
  future.length = 0;
  set({ freeHistoryRev: get().freeHistoryRev + 1 });
};
export const restoreFreeView = (direction: -1 | 1) => {
  const f = S.tools?.free;
  if (!f?.on || get().freeLocked) return;
  const from = direction < 0 ? past : future;
  const to = direction < 0 ? future : past;
  const now = view();
  let target = from.pop();
  while (target && sameView(target, now)) target = from.pop();
  if (!target) {
    set({ freeHistoryRev: get().freeHistoryRev + 1 });
    return;
  }
  to.push(now);
  f.p.copy(target.p);
  f.l.copy(target.l);
  f.fov = target.fov;
  orbitPivot = target.pivot;
  flight.clear(true);
  walkTime = -Infinity;
  set({
    freeNavigation: target.navigation,
    freeFov: target.fov,
    freePoseRev: get().freePoseRev + 1,
    freeHistoryRev: get().freeHistoryRev + 1,
  });
  touchFree(true);
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
  touchFree(true);
};
export const setFreeLock = (locked: boolean) => {
  flight.clear(true);
  set({ freeLocked: locked });
  touchFree(false);
};
export const setFreeLook = (on: boolean) => {
  const f = S.tools?.free;
  if (!f || f.previewEffects === undefined) return;
  f.previewEffects = on;
  setPref("freeLook", on);
  touchFree(false);
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
  set({ freeNavigation: mode, freePoseRev: get().freePoseRev + 1 });
  touchFree(false);
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
  set({ freePoseRev: get().freePoseRev + 1 });
  touchFree(true);
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
export const FREE_LENS_DEFAULTS = {
  fov: 60,
  roll: 0,
  wave: 0,
  bob: 0,
  fstop: 0,
  focus: undefined as FocusTargetSpec | undefined,
  handheld: false as HandheldSpec,
} as const;

let customFreeFov = false;
let enteredFreeFov: number | null = null;
let homed = false;

export const isCustomFreeFov = () => customFreeFov;

export type FreeTouchedSnapshot = {
  customFreeFov: boolean;
  freeTouched: FreeTouched;
};

export const getFreeTouchedSnapshot = (): FreeTouchedSnapshot => ({
  customFreeFov,
  freeTouched: { ...get().freeTouched },
});

export const restoreFreeTouchedState = (snap: Partial<FreeTouchedSnapshot>) => {
  if (typeof snap.customFreeFov === "boolean") customFreeFov = snap.customFreeFov;
  if (snap.freeTouched && typeof snap.freeTouched === "object")
    set({ freeTouched: { ...snap.freeTouched } });
};

export const defaultFreeFov = () => {
  const raw =
    enteredFreeFov ??
    (!homed ? S.tools?.home?.fov : undefined) ??
    S.tools?.cameraSample?.()?.fov ??
    (!S.tools?.free.on ? S.tools?.camera?.fov : undefined) ??
    FREE_LENS_DEFAULTS.fov;
  return Math.round(clampFov(raw) * 10) / 10;
};

export const ensureFreeActive = () => {
  if (!S.tools?.free.on) setFree(true);
};

export const setFreeFov = (fov: number, resetCustom = false) => {
  const v = Math.round(clampFov(fov) * 10) / 10;
  customFreeFov = !resetCustom;
  const f = S.tools?.free;
  if (f) f.fov = v;
  set({ freeFov: v });
  touchFree(true);
};

export const resetFreeFov = () => setFreeFov(defaultFreeFov(), true);

export const setFreeMm = (mm: number) => {
  const aspect = S.tools?.camera?.aspect || 16 / 9;
  const fov = fovOf(mm, aspect);
  if (!(fov >= MIN_FOV && fov <= MAX_FOV))
    return say("Enter a positive focal length that gives a usable field of view");
  setFreeFov(fov);
};

export const setFreeRoll = (rad: number) => {
  const maxRad = Math.PI;
  const v = Math.round(Math.max(-maxRad, Math.min(maxRad, rad)) * 1e4) / 1e4;
  const f = S.tools?.free;
  if (f) f.roll = v;
  set({ freeRoll: v, freeTouched: { ...get().freeTouched, roll: true } });
  touchFree(true);
};

export const setFreeWave = (wave: number) => {
  const v = Math.round(Math.max(0, Math.min(3, wave)) * 100) / 100;
  const f = S.tools?.free;
  if (f) f.wave = v;
  set({ freeWave: v, freeTouched: { ...get().freeTouched, wave: true } });
  touchFree(true);
};

export const setFreeBob = (bob: number) => {
  const v = Math.round(Math.max(0, Math.min(3, bob)) * 100) / 100;
  const f = S.tools?.free;
  if (f) f.bob = v;
  set({ freeBob: v, freeTouched: { ...get().freeTouched, bob: true } });
  touchFree(true);
};

export const setFreeFstop = (fstop: number) => {
  const v = Math.max(0, Math.round(fstop * 1000) / 1000);
  const f = S.tools?.free;
  if (f) f.fstop = v;
  set({ freeFstop: v, freeTouched: { ...get().freeTouched, fstop: true } });
  touchFree(true);
};

export const setFreeFocus = (focus: FocusTargetSpec | undefined) => {
  const normalized = normalizeFocusSpec(focus) as FocusTargetSpec | undefined;
  const f = S.tools?.free;
  if (f) f.focus = normalized;
  set({ freeFocus: normalized, freeTouched: { ...get().freeTouched, focus: true } });
  touchFree(true);
};

export const setFreeHandheld = (handheld: HandheldSpec | undefined) => {
  const normalized = normalizeHandheldSpec(handheld) ?? false;
  const f = S.tools?.free;
  if (f) f.handheld = normalized;
  set({ freeHandheld: normalized, freeTouched: { ...get().freeTouched, handheld: true } });
  touchFree(true);
};

export const setFreePoseCoordinate = (field: "p" | "l", axis: 0 | 1 | 2, value: number) => {
  const f = S.tools?.free;
  if (!f) return;
  if (!f.on) setFree(true);
  else rememberFreeView();
  f[field].setComponent(axis, Math.round(value * 1000) / 1000);
  set({ freePoseRev: get().freePoseRev + 1 });
  touchFree(true);
};

export const startFreePick = (field: "l" = "l") => {
  ensureFreeActive();
  set({ cameraPick: { field, target: "free", t: S.t }, pickFocus: null });
  say("Click a surface to aim the free camera. Esc cancels");
};

export const applyFreeCameraPick = (
  pick: CameraPick,
  hit: { what: string; world?: [number, number, number] },
) => {
  if (get().cameraPick !== pick) return;
  if (!hit.world) return say("Click a visible surface or press Esc to cancel");
  const f = S.tools?.free;
  if (!f) return cancelCameraPick();
  if (pick.field === "l") {
    rememberFreeView();
    f.l.set(...hit.world);
    set({ freePoseRev: get().freePoseRev + 1 });
    touchFree(true);
    say("Aim updated");
  }
  cancelCameraPick();
};

export const resetFreeDof = () => {
  const f = S.tools?.free;
  if (f) {
    f.fstop = FREE_LENS_DEFAULTS.fstop;
    f.focus = FREE_LENS_DEFAULTS.focus;
  }
  const { fstop: _fs, focus: _fc, ...rest } = get().freeTouched;
  set({
    freeFstop: FREE_LENS_DEFAULTS.fstop,
    freeFocus: FREE_LENS_DEFAULTS.focus,
    freeTouched: rest,
  });
  touchFree(true);
};

export const resetFreeFeel = () => {
  const f = S.tools?.free;
  if (f) {
    f.wave = FREE_LENS_DEFAULTS.wave;
    f.bob = FREE_LENS_DEFAULTS.bob;
    f.handheld = FREE_LENS_DEFAULTS.handheld;
  }
  const { wave: _w, bob: _b, handheld: _h, ...rest } = get().freeTouched;
  set({
    freeWave: FREE_LENS_DEFAULTS.wave,
    freeBob: FREE_LENS_DEFAULTS.bob,
    freeHandheld: FREE_LENS_DEFAULTS.handheld,
    freeTouched: rest,
  });
  touchFree(true);
};

export const resetFreeLensAll = () => {
  customFreeFov = false;
  const defFov = defaultFreeFov();
  const f = S.tools?.free;
  if (f) {
    f.fov = defFov;
    f.roll = FREE_LENS_DEFAULTS.roll;
    f.wave = FREE_LENS_DEFAULTS.wave;
    f.bob = FREE_LENS_DEFAULTS.bob;
    f.fstop = FREE_LENS_DEFAULTS.fstop;
    f.focus = FREE_LENS_DEFAULTS.focus;
    f.handheld = FREE_LENS_DEFAULTS.handheld;
  }
  set({
    freeFov: defFov,
    freeRoll: FREE_LENS_DEFAULTS.roll,
    freeWave: FREE_LENS_DEFAULTS.wave,
    freeBob: FREE_LENS_DEFAULTS.bob,
    freeFstop: FREE_LENS_DEFAULTS.fstop,
    freeFocus: FREE_LENS_DEFAULTS.focus,
    freeHandheld: FREE_LENS_DEFAULTS.handheld,
    freeTouched: {},
  });
  touchFree(true);
};

export const setFree = (on: boolean, here = false) => {
  const tools = S.tools;
  if (!tools) return;
  if (on && get().compareVideoMode) setCompareVideoMode(false);
  const f = tools.free,
    home = !homed && !here && tools.home;
  const preserve = on && homed && get().freeLocked;
  const filmFov = tools.cameraSample?.()?.fov ?? tools.camera.fov;
  if (on && !f.on) {
    enteredFreeFov = (home ? tools.home?.fov : undefined) ?? filmFov;
  } else if (!on) {
    if (get().pickFocus === "free") set({ pickFocus: null });
    if (get().cameraPick?.target === "free") cancelCameraPick();
    if (!tools.cameraSample && enteredFreeFov !== null && tools.camera)
      tools.camera.fov = enteredFreeFov;
    enteredFreeFov = null;
  }
  if (on && home && !preserve) {
    f.p.set(...home.p);
    f.l.set(...home.l);
    f.fov = customFreeFov ? get().freeFov : (home.fov ?? filmFov);
  } else if (on && !preserve) {
    f.p.copy(tools.camera.position);
    f.l.copy(tools.look);
    f.fov = customFreeFov ? get().freeFov : filmFov;
  }
  if (on) {
    homed = true;
    if (!preserve) orbitPivot = null;
    if (f.previewEffects !== undefined) f.previewEffects = get().freeLook;
    if (!preserve && get().freeNavigation === "walk") set({ freeNavigation: "fly" });
  }
  f.roll ??= get().freeRoll;
  f.wave ??= get().freeWave;
  f.bob ??= get().freeBob;
  f.fstop ??= get().freeFstop;
  if (f.focus === undefined && get().freeFocus !== undefined)
    f.focus = structuredClone(get().freeFocus);
  if (f.handheld === undefined && get().freeHandheld !== undefined)
    f.handheld = structuredClone(get().freeHandheld);
  f.on = on;
  set({
    free: on,
    freeFov: f.fov,
    freeRoll: f.roll ?? 0,
    freeWave: f.wave ?? 0,
    freeBob: f.bob ?? 0,
    freeFstop: f.fstop ?? 0,
    freeFocus: (f.focus as FocusTargetSpec | undefined) ?? undefined,
    freeHandheld: f.handheld ?? false,
    freePoseRev: get().freePoseRev + 1,
    freeHistoryRev: get().freeHistoryRev + 1,
    ...(on && !preserve ? { freeTouched: {} } : {}),
  });
  touchFree(false);
};

export const readFreeView = (f: FreeCam | undefined): FreeView | null => {
  if (!f?.on) return null;
  return {
    p: f.p.toArray(),
    l: f.l.toArray(),
    fov: f.fov,
    roll: f.roll ?? 0,
    wave: f.wave ?? 0,
    bob: f.bob ?? 0,
    fstop: f.fstop ?? 0,
    ...(f.focus !== undefined ? { focus: structuredClone(f.focus) } : {}),
    handheld: f.handheld !== undefined ? structuredClone(f.handheld) : false,
    previewEffects: f.previewEffects,
  };
};

export const readLiveFreeView = (): FreeView | undefined => {
  const view = readFreeView(S.tools?.free);
  if (!view) return undefined;
  const { p, l, previewEffects: _, ...lens } = view;
  const round = ([x, y, z]: FreeView["p"]) =>
    [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)] as const;
  return { p: round(p), l: round(l), ...lens };
};

export const flyFree = (view: FreeView) => {
  const tools = S.tools;
  if (!tools) return;
  if (get().compareVideoMode) setCompareVideoMode(false);
  const f = tools.free;
  if (!f.on)
    enteredFreeFov =
      (!homed ? tools.home?.fov : undefined) ?? tools.cameraSample?.()?.fov ?? tools.camera.fov;
  f.p.set(view.p[0], view.p[1], view.p[2]);
  f.l.set(view.l[0], view.l[1], view.l[2]);
  const fov =
    typeof view.fov === "number" && Number.isFinite(view.fov)
      ? Math.round(clampFov(view.fov) * 10) / 10
      : f.fov || defaultFreeFov();
  const maxRad = Math.PI;
  const roll =
    typeof view.roll === "number" && Number.isFinite(view.roll)
      ? Math.round(Math.max(-maxRad, Math.min(maxRad, view.roll)) * 1e4) / 1e4
      : 0;
  const wave =
    typeof view.wave === "number" && Number.isFinite(view.wave)
      ? Math.round(Math.max(0, Math.min(3, view.wave)) * 100) / 100
      : 0;
  const bob =
    typeof view.bob === "number" && Number.isFinite(view.bob)
      ? Math.round(Math.max(0, Math.min(3, view.bob)) * 100) / 100
      : 0;
  const fstop =
    typeof view.fstop === "number" && Number.isFinite(view.fstop)
      ? Math.max(0, Math.round(view.fstop * 1000) / 1000)
      : 0;
  const focus = normalizeFocusSpec(view.focus) as FocusTargetSpec | undefined;
  const handheld = normalizeHandheldSpec(view.handheld as HandheldSpec | undefined) ?? false;
  f.fov = fov;
  f.roll = roll;
  f.wave = wave;
  f.bob = bob;
  f.fstop = fstop;
  f.focus = focus;
  f.handheld = handheld;
  orbitPivot = null;
  if (f.previewEffects !== undefined) f.previewEffects = view.previewEffects ?? get().freeLook;
  if (get().freeNavigation === "walk") set({ freeNavigation: "fly" });
  homed = true;
  f.on = true;
  set({
    free: true,
    freeFov: fov,
    freeRoll: roll,
    freeWave: wave,
    freeBob: bob,
    freeFstop: fstop,
    freeFocus: focus,
    freeHandheld: handheld,
    ...(f.previewEffects !== undefined && { freeLook: f.previewEffects }),
    freePoseRev: get().freePoseRev + 1,
    freeHistoryRev: get().freeHistoryRev + 1,
  });
  touchFree(true);
};

export const setFov = (d: number) => {
  const f = S.tools?.free;
  if (!f?.on || get().freeLocked) return;
  rememberFreeView();
  setFreeFov(f.fov + d);
  say(`FOV ${f.fov}°`);
};
