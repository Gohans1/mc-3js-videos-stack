import { easeOf } from "film-stage/camera";
import * as THREE from "three";

export interface PlacedKey {
  t: number;
  at: number[];
  rot?: number[];
  scale?: number;
  visible?: boolean;
  ease?: string | [number, number, number, number];
  clip?: string;
  rate?: number;
}

export interface Pose {
  at: THREE.Vector3;
  q: THREE.Quaternion;
  scale: number;
  visible: boolean;
}

const RAD = Math.PI / 180;
const ZERO_ROT = [0, 0, 0];
const vB = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const qB = new THREE.Quaternion();
const walkPose: Pose = {
  at: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  scale: 1,
  visible: true,
};

const keyAt = (keys: PlacedKey[], t: number) => {
  let i = 0;
  while (i < keys.length - 1 && t >= keys[i + 1].t) i++;
  return i;
};
const smooth = (x: number) => x * x * (3 - 2 * x);
const setQuat = (q: THREE.Quaternion, rot = ZERO_ROT) =>
  q.setFromEuler(euler.set(rot[0] * RAD, rot[1] * RAD, rot[2] * RAD, "YXZ"));

// Where a list of keys puts the object at t: position, turn, size, shown. Passing `out` reuses its vectors in hot 60fps loops
export const poseAt = (keys: PlacedKey[], t: number, out?: Pose): Pose => {
  const i = keyAt(keys, t),
    a = keys[i],
    b = keys[Math.min(i + 1, keys.length - 1)];
  const x = b === a || t <= a.t ? 0 : t >= b.t ? 1 : (t - a.t) / (b.t - a.t);
  const u = (b.ease === undefined ? smooth : easeOf(b.ease as Parameters<typeof easeOf>[0]))(x);
  const p = out ?? { at: new THREE.Vector3(), q: new THREE.Quaternion(), scale: 1, visible: true };
  p.at.set(a.at[0], a.at[1], a.at[2]).lerp(vB.set(b.at[0], b.at[1], b.at[2]), u);
  setQuat(p.q, a.rot).slerp(setQuat(qB, b.rot), u);
  p.scale = THREE.MathUtils.lerp(a.scale ?? 1, b.scale ?? 1, u);
  let visible = true;
  for (const k of keys) if (k.t <= t && k.visible !== undefined) visible = k.visible;
  if (t < keys[0].t && keys[0].visible !== undefined) visible = keys[0].visible;
  p.visible = visible;
  return p;
};

// The clip running at t and the second it started: the last key at or before t that names one; else the object's own, from its first key
export const clipAt = (o: { clip?: string; rate?: number; keys: PlacedKey[] }, t: number) => {
  let k: PlacedKey | null = null;
  for (const x of o.keys) if (x.t <= t && x.clip !== undefined) k = x;
  return k
    ? { clip: k.clip, from: k.t, rate: k.rate ?? o.rate ?? 1 }
    : { clip: o.clip, from: o.keys[0].t, rate: o.rate ?? 1 };
};

// Metres travelled along the keys up to t, for a walk clip
export const travelled = (keys: PlacedKey[], t: number, curAt?: THREE.Vector3) => {
  let d = 0;
  for (let i = 0; i < keys.length - 1 && keys[i].t < t; i++) {
    const a = keys[i].at;
    if (t >= keys[i + 1].t) {
      const b = keys[i + 1].at;
      d += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    } else {
      const b = curAt ?? poseAt(keys, t, walkPose).at;
      d += Math.hypot(b.x - a[0], b.y - a[1], b.z - a[2]);
    }
  }
  return d;
};
