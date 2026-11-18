// @ts-nocheck
import { arcInto } from "film-kit/arc";
import { reachK } from "film-kit/reach";
import { easeOf } from "film-stage/camera";
// An actor's performance as a function of film time, from keys (a film's src/timeline/steve.json), with the film's own
// body poses and faces: makePerformance({ poses, faces, standing }) -> { bodyAt, targetAt, moodAt, readLook, blinkAt }.
//   moves [{t, at, yaw, pose, walk?, via?, do}]  where he is and the body pose he holds from t on. Between two keys the
//     pose blends and the body shifts (smoothstep) over soles that stay planted (feet.ts steps them when it drifts
//     too far); with walk: true on the later key he walks there (gait phased from the distance walked, every footfall
//     planted). Keep a non-walk shift small (a weight shift, half a step): anything longer is a walk. via: a pose that
//     peaks halfway through the blend (rising from a seat).
//     ease on the incoming key replaces that blend's curve (film-stage EASES or four Bezier handles); omitted keeps
//     smoothstep/walkEase. It also phases gait distance, but does not retime a mocap clip's source playback.
//     clip: "<lib>/<clip>" instead of pose plays a mocap clip (clips.ts) from the key on, its first frame's hips at
//     `at`; from: seconds into the clip to start at, rate: its speed, loop: true repeats it (in-place clips only: each lap
//     starts back at `at`), else it holds its last frame. It plays at full weight until `blend` seconds (default 0.4)
//     before the next key, then crossfades into it. Its hips travel inside the pose, so the next key's at goes where the
//     clip leaves him (at + its end offset turned by yaw: a film's lab/clip.ts prints it) or he slides back over the crossfade.
//     add: {joint: [x, y, z]} on any key adds those degrees on top of its pose (a head tilt on a clip, say; angle by
//     angle, so keep it small on a joint turned past 90). A walk key can't follow a clip: key a pose where it leaves him.
//   hands [{t, R?, L?}]  a world point or a prop anchor name (the film's props) for the end of that hand, or null for the
//     pose's own arm. Targets glide between keys; the arm IK (player.ts armTo) bends the elbow to reach them. Given the
//     shoulder (targetAt's opts.pivot), a hand moves like a person's (film-kit): at its own Fitts pace with one speed bell
//     and a small corrective end (reach.ts), on an arc round the shoulder instead of a straight slide (arc.ts).
//   look [{t, at}]  where he turns his head: a point, an anchor, or null for the pose's own head.
//   face [{t, mood}]  a MOODS name (player.ts) or one of the film's faces, blended over half a second.
//   read [[from, to]]  eyes run along lines of text: left to right, a quick sweep back, next line.
// Every key holds until the next. Same t, same frame: nothing here remembers a previous frame.
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

// One body pose into another: a joint (or root field) one pose leaves out is at rest (0) there. blendPose in player.ts
// is an overlay instead (it leaves joints alone that the second pose lacks), which is what hand and head aims need
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

// Distances along the walked path at every move key, computed once per moves array
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

// poses: {name: (s) => pose}, the body poses keys name; faces: {name: mood}, faces MOODS lacks; standing: the pose names
// he can walk between without a walk key (he shuffles round on the spot while turning)
export function makePerformance({ poses, faces = {}, standing = ["stand"] }) {
  const moodOf = (n) => faces[n] ?? MOODS[n] ?? MOODS.neutral;
  const standSet = new Set(standing);
  // each list of keys is checked whole the first time it is read (keys.ts); the studio hands over a fresh copy on every edit
  const seen = new WeakMap();
  const once = (keys, tag, fn) => {
    const s = seen.get(keys) ?? new Set();
    if (!s.has(tag)) {
      fn();
      s.add(tag);
      seen.set(keys, s);
    }
  };

  // A key's body pose s seconds after it; clips: loadClips' result
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
  // How far from key a to key b at t (0..1): a hand-made pose blends over the whole span, a clip plays on and crossfades
  // only over the span's last `blend` seconds, as game engines crossfade clips
  const progress = (a, b, t) => {
    if (b === a || b.t <= a.t) return 0;
    const w = a.clip ? Math.min(a.blend ?? 0.4, b.t - a.t) : b.t - a.t;
    return clamp01((t - (b.t - w)) / w);
  };
  const travel = (key, x, duration) =>
    key.ease === undefined ? (key.walk ? walkEase(x, duration) : smooth(x)) : easeOf(key.ease)(x);

  // Where he is, which way he faces and the body pose at time t (no hand targets, no head aim yet)
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
    const w = b.walk ? smooth((phase - 0.8) / 0.2) : k; // a walk keeps its own body until its last fifth
    let pose;
    if (b === a) pose = poseOf(a, sa, clips);
    else if (a.clip || b.clip) {
      // mocap turns are measured, not authored angle by angle: they blend as turns (an Euler lerp of two can swing the long
      // way). Each side's hips are where its own key's place and yaw put them, blended in the world: turned into the yaw
      // between, a clip that walks and turns would swing them sideways and back over the crossfade
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
    // steps: walking, or shuffling round on the spot while turning; the gait fades in and out with the speed
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

  // The target of one hand or the head between keys: null blends back to the pose's own arm. opts.pivot: the shoulder in
  // the world at t (a THREE.Vector3), for hands; without it the target glides straight on a smoothstep (a head's look)
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

  // Reading: the eyes cross a line in 1.3 s with small jumps (saccades), snap back, drop a line; held still 0.25 s per jump
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

  // Blinks every 2.5 to 5.5 s (seeded by the blink's own index), 0.16 s each, so any frame knows if it falls in one
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
