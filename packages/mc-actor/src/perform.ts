// @ts-nocheck
import { arcInto } from "film-kit/arc";
import { reachK } from "film-kit/reach";
import { easeOf } from "film-stage/camera";
import * as THREE from "three";

import { clamp01, smooth, walkEase } from "./ease";
import { checkFaces, checkMoves, checkTargets } from "./keys";
import { slerpPose } from "./mocap";
import { addPose, gaitOf, MOODS, walkPose } from "./player";

const D = Math.PI / 180;
const MOOD_FIELDS = Object.keys(MOODS.neutral);
const arcPivot = [0, 0, 0],
  arcA = [0, 0, 0],
  arcB = [0, 0, 0],
  arcOut = [0, 0, 0];

const mixMood = (a, b, k) => {
  const ok = 1 - k;
  const out = {};
  for (let i = 0; i < MOOD_FIELDS.length; i++) {
    const f = MOOD_FIELDS[i];
    out[f] = (a[f] ?? 0) * ok + (b[f] ?? 0) * k;
  }
  return out;
};

const mixPose = (a, b, k) => {
  const root = {},
    ok = 1 - k;
  const ar = a.root,
    br = b.root;
  if (ar) for (const r in ar) root[r] = (ar[r] ?? 0) * ok + (br?.[r] ?? 0) * k;
  if (br) for (const r in br) if (!ar || !(r in ar)) root[r] = (br[r] ?? 0) * k;
  const out = { root };
  for (const j in a) {
    if (j === "root") continue;
    const x = a[j],
      y = b[j];
    out[j] = y
      ? [x[0] * ok + y[0] * k, x[1] * ok + y[1] * k, x[2] * ok + y[2] * k]
      : [x[0] * ok, x[1] * ok, x[2] * ok];
  }
  for (const j in b) {
    if (j === "root" || j in a) continue;
    const y = b[j];
    out[j] = [y[0] * k, y[1] * k, y[2] * k];
  }
  return out;
};
const keyAt = (keys, t) => {
  let lo = 0,
    hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t >= keys[mid].t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};
const yawLerp = (a, b, k) => a + (((b - a + 540) % 360) - 180) * k;

const paths = new WeakMap();
const pathOf = (moves) => {
  if (paths.has(moves)) return paths.get(moves);
  const cum = [0];
  for (let i = 1; i < moves.length; i++) {
    const [a, b] = [moves[i - 1], moves[i]];
    cum.push(
      cum[i - 1] +
        (b.walk ? Math.hypot(b.at[0] - a.at[0], b.at[2] - a.at[2]) : 0) +
        (b.walk ? 0 : Math.abs(yawLerp(a.yaw, b.yaw, 1) - a.yaw) * D * 0.22),
    );
  }
  paths.set(moves, cum);
  return cum;
};

export function makePerformance({ poses, faces = {}, standing = ["stand"] }) {
  const moodOf = (n) => faces[n] ?? MOODS[n] ?? MOODS.neutral;
  const standSet = new Set(standing);
  const seen = new WeakMap();
  const once = (keys, tag, fn) => {
    const s = seen.get(keys) ?? new Set();
    if (!s.has(tag)) {
      fn();
      s.add(tag);
      seen.set(keys, s);
    }
  };

  const poseOf = (key, s, clips) => {
    let pose;
    if (key.clip) {
      const c = clips[key.clip];
      if (!c) throw new Error(`mocap clip ${key.clip} is not loaded`);
      const x = (key.from ?? 0) + s * (key.rate ?? 1);
      pose = c.at(key.loop ? THREE.MathUtils.euclideanModulo(x, c.duration) : x);
    } else pose = poses[key.pose](s);
    return key.add ? addPose(pose, key.add) : pose;
  };
  const progress = (a, b, t) => {
    if (b === a || b.t <= a.t) return 0;
    const w = a.clip ? Math.min(a.blend ?? 0.4, b.t - a.t) : b.t - a.t;
    return clamp01((t - (b.t - w)) / w);
  };
  const travel = (key, x, duration) =>
    key.ease === undefined ? (key.walk ? walkEase(x, duration) : smooth(x)) : easeOf(key.ease)(x);

  function bodyAt(moves, t, clips?: Record<string, any> | null) {
    once(moves, clips ? "clips" : "moves", () => checkMoves(moves, poses, clips ?? null));
    clips ??= {};
    const i = keyAt(moves, t),
      a = moves[i],
      b = moves[Math.min(i + 1, moves.length - 1)];
    const x = progress(a, b, t);
    const cum = pathOf(moves);
    const k = travel(b, x, b.t - a.t),
      phase = b.ease === undefined ? x : k;
    const ok = 1 - k;
    const at = [a.at[0] * ok + b.at[0] * k, a.at[1] * ok + b.at[1] * k, a.at[2] * ok + b.at[2] * k];
    const yaw = yawLerp(a.yaw, b.yaw, b.walk ? smooth(phase / 0.25) : k);
    const sa = t - a.t,
      sb = Math.max(0, t - b.t);
    const w = b.walk ? smooth((phase - 0.8) / 0.2) : k;
    let pose;
    if (b === a) pose = poseOf(a, sa, clips);
    else if (a.clip || b.clip) {
      const pa = poseOf(a, sa, clips),
        pb = poseOf(b, sb, clips);
      pose = slerpPose(pa, pb, w);
      const ca = Math.cos((a.yaw - yaw) * D),
        sa0 = Math.sin((a.yaw - yaw) * D),
        cb = Math.cos((b.yaw - yaw) * D),
        sb0 = Math.sin((b.yaw - yaw) * D);
      const ax0 = pa.root?.x ?? 0,
        az0 = pa.root?.z ?? 0,
        bx0 = pb.root?.x ?? 0,
        bz0 = pb.root?.z ?? 0;
      pose.root.x = (1 - w) * (ax0 * ca + az0 * sa0) + w * (bx0 * cb + bz0 * sb0);
      pose.root.z = (1 - w) * (az0 * ca - ax0 * sa0) + w * (bz0 * cb - bx0 * sb0);
    } else pose = mixPose(poseOf(a, sa, clips), poseOf(b, sb, clips), w);
    if (b.via && b !== a)
      pose = addPose(pose, mixPose({}, poses[b.via](sa), Math.sin(Math.PI * phase)));
    const d = cum[i] + (cum[Math.min(i + 1, cum.length - 1)] - cum[i]) * k;
    const t2 = t + 0.05;
    const j = i + 1 >= moves.length || t2 < moves[i + 1].t ? i : keyAt(moves, t2),
      p = moves[j],
      q = moves[Math.min(j + 1, moves.length - 1)];
    const d2 =
      cum[j] +
      (cum[Math.min(j + 1, cum.length - 1)] - cum[j]) * travel(q, progress(p, q, t2), q.t - p.t);
    const speed = (d2 - d) / 0.05;
    const walking = (standSet.has(a.pose) && standSet.has(b.pose)) || b.walk;
    if (walking) pose = addPose(pose, walkPose(d, speed));
    const moving = b !== a && t < b.t && (!a.clip || x > 0);
    return {
      at,
      yaw,
      pose,
      key: i,
      act: moving ? b : a,
      moving,
      speed,
      gait: walking ? gaitOf(d, speed) : null,
    };
  }

  const targetKeys = new WeakMap();
  const filteredKeys = (keys, field) => {
    let byField = targetKeys.get(keys);
    if (!byField) targetKeys.set(keys, (byField = new Map()));
    let ks = byField.get(field);
    if (!ks) byField.set(field, (ks = keys.filter((k) => field in k)));
    return ks;
  };

  function targetAt(keys, field, t, anchor, { pivot = null } = {}) {
    once(keys, "targets", () => checkTargets(keys, field === "at" ? "look" : "hands"));
    const ks = filteredKeys(keys, field);
    if (!ks.length) return null;
    const i = keyAt(ks, t),
      a = ks[i],
      b = ks[Math.min(i + 1, ks.length - 1)];
    const pa = a[field] == null ? null : anchor(a[field], t),
      pb = b[field] == null ? null : anchor(b[field], t);
    const x =
      b.t <= a.t
        ? 0
        : pivot && pa && pb
          ? reachK(t, a.t, b.t, { dist: pa.distanceTo(pb) })
          : smooth((t - a.t) / (b.t - a.t));
    if (t < a.t) return null;
    if (pa && pb) {
      if (!pivot) return { p: pa.clone().lerp(pb, x), w: 1 };
      arcPivot[0] = pivot.x;
      arcPivot[1] = pivot.y;
      arcPivot[2] = pivot.z;
      arcA[0] = pa.x;
      arcA[1] = pa.y;
      arcA[2] = pa.z;
      arcB[0] = pb.x;
      arcB[1] = pb.y;
      arcB[2] = pb.z;
      arcInto(arcOut, arcPivot, arcA, arcB, x);
      return { p: new THREE.Vector3(arcOut[0], arcOut[1], arcOut[2]), w: 1 };
    }
    if (pa) return { p: pa, w: 1 - x };
    if (pb) return { p: pb, w: x };
    return null;
  }

  function moodAt(keys, t) {
    once(keys, "faces", () => checkFaces(keys, { ...MOODS, ...faces }));
    const i = keyAt(keys, t),
      a = keys[i];
    const prev = i > 0 ? moodOf(keys[i - 1].mood) : moodOf(a.mood);
    return mixMood(prev, moodOf(a.mood), t < a.t ? 0 : smooth((t - a.t) / 0.5));
  }

  function readLook(ranges, t) {
    for (const [from, to] of ranges ?? [])
      if (t >= from && t < to) {
        const s = t - from,
          line = Math.floor(s / 1.6),
          u = (s % 1.6) / 1.6;
        const x =
          u < 0.85
            ? -0.8 + (Math.floor((u / 0.85) * 6) / 5) * 1.6
            : 0.8 - smooth((u - 0.85) / 0.15) * 1.6;
        return [x, -0.15 - (line % 4) * 0.08];
      }
    return null;
  }

  function blinkAt(t, from) {
    if (t < from) return 0;
    let at = from + 1.5,
      n = 0;
    while (at < t - 0.2) {
      n++;
      at += 2.5 + ((3 * (((Math.sin(n * 12.9898) * 43758.5453) % 1) + 1)) % 1);
    }
    const u = (t - at) / 0.16;
    return u >= 0 && u <= 1 ? Math.sin(u * Math.PI) : 0;
  }

  return { bodyAt, targetAt, moodAt, readLook, blinkAt };
}
