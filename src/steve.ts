// @ts-nocheck
// Steve's performance as a function of film time, from edit.json `steve`:
//   moves [{t, at, yaw, pose, walk?, via?, do}]  where he is and the body pose he holds from t on. Between two keys the
//     pose blends and the body shifts (smoothstep) over soles that stay planted (src/feet.ts steps them when it drifts
//     too far); with walk: true on the later key he walks there (gait phased from the distance walked, every footfall
//     planted). Keep a non-walk shift small (a weight shift, half a step): anything longer is a walk. via: a pose that
//     peaks halfway through the blend (rising from a seat).
//   hands [{t, R?, L?}]  a world point or a prop anchor name (src/props.ts) for the end of that hand, or null for the
//     pose's own arm. Targets glide between keys; the arm IK (player.ts armTo) bends the elbow to reach them.
//   look [{t, at}]  where he turns his head: a point, an anchor, or null for the pose's own head.
//   face [{t, mood}]  MOODS name or one of FACES below, blended over half a second.
//   read [[from, to]]  eyes run along lines of text: left to right, a quick sweep back, next line.
// Every key holds until the next. Same t, same frame: nothing here remembers a previous frame.
import * as THREE from "three";
import { clamp01, smooth } from "./ease";
import { GESTURES, MOODS, PX, addPose, arm, gaitOf, leg, walkPose } from "./player";
import { CHAIR } from "./world";

const D = Math.PI / 180;

// Body poses by name, at local time s since the key. Arms here are where they hang when no hand target is set
export const POSES = {
  lie: () => GESTURES.sleep(),
  // propped up on his hands: the back rises, the legs stay flat on the mattress (hips turn up as the thighs turn down)
  push: () => addPose({ root: { rx: -48, y: -(12 * PX - 2 * PX) }, head: [-12, 0, 0], chest: [6, 0, 0] }, leg("L", 42, 2, 0), leg("R", 42, 2, 0)),
  sitBed: (s) => addPose({ root: { y: -(12 * PX - 2 * PX) }, body: [10, 0, 0], head: [6, 0, 0], chest: [1.5 * Math.sin(s * 1.6), 0, 0] }, leg("L", 90, 3, 0), leg("R", 90, 3, 0), arm("L", 8, 14, 0, 12), arm("R", 8, 14, 0, 12)),
  // perched on the bed's edge: the mattress (9 px) is higher than his shin (6 px), so the thighs slope down to the floor
  sitEdge: (s) => addPose({ root: { y: -0.04 }, body: [14, 0, 0], head: [10, 0, 0], chest: [1.5 * Math.sin(s * 1.6), 0, 0] }, leg("L", 34, 5, 34), leg("R", 34, 5, 34), arm("L", 16, 8, 0, 20), arm("R", 16, 8, 0, 20)),
  rise: () => ({ body: [24, 0, 0], chest: [10, 0, 0], head: [-14, 0, 0] }),
  stand: (s) => addPose(arm("L", 0, 5 + 1.2 * Math.sin(s * 1.3), 0, 6), arm("R", 0, 5 + 1.2 * Math.sin(s * 1.3 + 1), 0, 6), { chest: [-1.5 * Math.sin(s * 1.7), 0, 0] }),
  // standing close at the door, leaning a little in to it
  feel: (s) => addPose(POSES.stand(s), { body: [5, 0, 0], head: [4, 0, 0] }),
  // on the chair (world.ts CHAIR.seat): the thighs rest on the seat (hips half a leg's width above it), sloping a little to
  // the knees, shins straight down. A player's leg is 12 px against a real man's ~16, so on a real chair his feet hang a
  // hand's width off the floor, as in every Minecraft film
  seat: (s) => addPose({ root: { y: CHAIR.seat + 2 * PX - 12 * PX }, chest: [1.5 * Math.sin(s * 1.6), 0, 0] }, leg("L", 84, 4, 84), leg("R", 84, 4, 84)),
  chair: (s) => addPose(POSES.seat(s), arm("L", 40, 6, 0, 40), arm("R", 40, 6, 0, 40)),
  // reading sits back at ease, the back on the backrest; straining over the code only leans a few degrees in (the dev:
  // anything more reads as cowering at the desk)
  read: (s) => addPose(POSES.chair(s), { body: [1, 0, 0], chest: [1.5 * Math.sin(s * 1.6), 0, 0] }),
  strain: (s) => addPose(POSES.chair(s), { body: [5, 0, 0], chest: [4 + 1.2 * Math.sin(s * 2.4), 0, 0] }),
  // slumped back after giving up: the chest falls back, hands drop to the thighs; one long breath out at the start
  // (on the seat alone: its arms are its own, hanging limp; body and chest lean back 16 degrees, so they swing 16 forward)
  slump: (s) => addPose(POSES.seat(s), { body: [-10, 0, 0], chest: [-6 - 5 * Math.exp(-s * 1.5) * Math.sin(Math.min(s, 1.2) * 2.6), 0, 0], head: [-6, 0, 0] }, arm("L", 16, 7, 0, 4), arm("R", 16, 7, 0, 4)),
  // on both knees in front of the drawer, shins flat on the floor behind him (hips 8 px up); lean is how far over it he
  // bends. A player's arm reaches 10 px from the shoulder, so the drawer's back takes a deep bend
  kneel: (s, lean = 0) => addPose(leg("L", 0, 3, 90), leg("R", 0, 3, 90), { root: { y: -4 * PX }, body: [lean, 0, 0], chest: [lean * 0.2 + 1.2 * Math.sin(s * 1.7), 0, 0] }),
  reach: (s) => POSES.kneel(s, 50),
  pull: (s) => POSES.kneel(s, 18),
  hold: (s) => POSES.kneel(s, 10),
  // the dig (edit.json props.files): bent in over the drawer for the next folder, upright on his knees to read it, then a
  // half turn of the chest to the side the folder is thrown to (his right: tossR), so it leaves the hand away from his body
  digReach: (s) => POSES.kneel(s, 42),
  digRead: (s) => addPose(POSES.kneel(s, 4), { head: [4, 0, 0] }),
  tossR: (s) => addPose(POSES.kneel(s, 8), { chest: [0, -24, 0], body: [0, -10, 0] }),
  tossL: (s) => addPose(POSES.kneel(s, 8), { chest: [0, 24, 0], body: [0, 10, 0] }),
  // the frenzy at the end: bent over the drawer, both hands flinging, the chest rocking with each throw
  frenzy: (s) => addPose(POSES.kneel(s, 40), { chest: [3 * Math.sin(s * 9.4), 6 * Math.sin(s * 4.7), 0] }),
  // scene 6 (1:10-1:44): curious on the chair, the recoil when the silverfish bursts out, sitting on the floor panting,
  // picking pages off the floor, reading them leant on the desk
  lean: (s) => addPose(POSES.chair(s), { body: [14, 0, 0], head: [8, 0, 0] }),
  // twisted round in the seat towards the cabinet on his left, so the head never turns past the shoulder
  slumpTurn: (s) => addPose(POSES.slump(s), { body: [0, 32, 0], chest: [0, 18, 0] }),
  leanTurn: (s) => addPose(POSES.lean(s), { body: [0, 32, 0], chest: [0, 16, 0] }),
  // bent to a low drawer standing, knees a little bent (hips 6 cm down: thighs 25 degrees on, shins 20 back), back bent well over
  stoop: (s) => addPose({ root: { y: -0.057 }, body: [52, 0, 0], chest: [6 + 1.2 * Math.sin(s * 1.7), 0, 0], head: [-22, 0, 0] }, leg("L", 25, 2, 45), leg("R", 25, 2, 45)),
  // the jolt back when the silverfish bursts out: straightens up and away, hands thrown up before his face
  // the kick at the door: the right knee drawn up, then the leg driven out straight, leaning back against it
  kickWind: (s) => addPose(POSES.stand(s), leg("R", 78, 3, 100), { body: [-5, 0, 0], head: [6, 0, 0] }),
  kick: (s) => addPose(POSES.stand(s), leg("R", 58, 3, 4), { body: [-15, 0, 0], head: [10, 0, 0] }),
  gasp: (s) => addPose(POSES.stand(s), arm("L", 75, 30, 0, 80), arm("R", 75, 30, 0, 80), { body: [-14, 0, 0], head: [-16, 0, 0] }),
  // on the floor, leaning back on his hands, knees up (thighs 35 degrees up, shins down to the stone); the breaths come
  // fast and slow down (rate 1.6 Hz falling to ~0.9 over four seconds)
  floor: (s) => {
    const ph = 2 * Math.PI * (1.6 * s - 0.09 * Math.min(s, 4) ** 2);
    return addPose({ root: { y: -(12 * PX - 2 * PX) }, body: [-26, 0, 0], chest: [-3 + 5 * Math.sin(ph), 0, 0], head: [6 + 3 * Math.sin(ph + 0.6), 0, 0] },
      leg("L", 125, 8, 101), leg("R", 125, 8, 101), arm("L", -50, 12, 0, 0), arm("R", -50, 12, 0, 0));
  },
  // sat up off his hands, still on the floor, knees up, arms free to take the pages lying round him; floorReach leans over
  // his knees for one further off
  floorUp: (s) => addPose({ root: { y: -(12 * PX - 2 * PX) }, body: [8, 0, 0], chest: [2 + 2 * Math.sin(s * 5), 0, 0] }, leg("L", 125, 8, 101), leg("R", 125, 8, 101), arm("L", 20, 10, 0, 20), arm("R", 20, 10, 0, 20)),
  floorReach: (s) => addPose(POSES.floorUp(s), { body: [22, 0, 0], head: [-8, 0, 0] }),
  desk: (s) => addPose(POSES.stand(s), { body: [16, 0, 0], head: [18, 0, 0] }),
  // standing tall to read what he holds up: here it is, let's see
  readUp: (s) => addPose(POSES.stand(s), { body: [4, 0, 0], chest: [-3, 0, 0] }),
  // the fling: the whole body swings to his left after the pages (body and chest turn the same way, leaning into it)
  fling: (s) => addPose(POSES.stand(s), { body: [14, 26, 0], chest: [4, 16, 0] }),
  // stood still after it, breathing hard: the chest heaves
  pant: (s) => addPose(POSES.stand(s), { body: [6, 0, 0], chest: [-2 + 3 * Math.sin(s * 6.5), 0, 0] }),
  // down on one knee (the dev: never flat on the floor to look into a cabinet): right knee and shin on the stone, left foot
  // planted ahead (thigh 70 degrees forward, shin straight down to the floor from the 8 px kneeling hip); lean bends him over it
  oneKnee: (s, lean = 0) => addPose(leg("R", 0, 3, 90), leg("L", 70, 3, 70), { root: { y: -4 * PX }, body: [lean, 0, 0], chest: [lean * 0.15 + 1.2 * Math.sin(s * 1.7), 0, 0] }),
  // up on one knee on the way to his feet
  kneelUp: (s) => POSES.oneKnee(s, 20),
  // the yank: bent to the drawer's pull on one knee, then thrown back against it
  kneelPull: (s) => POSES.oneKnee(s, 45),
  kneelBack: (s) => POSES.oneKnee(s, 12),
  // bent to the empty slot, the head lifted against the lean so he looks into its mouth rather than at the floor
  peekIn: (s) => addPose(POSES.oneKnee(s, 57), { head: [-18, 0, 0] }),
  reachIn: (s) => addPose(POSES.oneKnee(s, 60), { head: [-22, 0, 0] }),
  // upright on one knee, the scrap held before his face
  readNote: (s) => addPose(POSES.oneKnee(s, 4), { head: [16, 0, 0] }),
};

// Faces the moods table lacks: brows stay thin lines and never drop over the eyes
export const FACES = {
  uneasy: { y: 0.15, tilt: 14, open: 0.9, squint: 0, pupil: 0.95, smile: -0.25 },
  tense: { y: 0.1, tilt: 18, open: 0.95, squint: 0.1, pupil: 0.9, smile: -0.45 },
  strained: { y: 0, tilt: -12, open: 0.85, squint: 0.35, pupil: 0.95, smile: -0.5 },
  spent: { y: 0, tilt: 10, open: 0.55, squint: 0.1, pupil: 1, smile: -0.35 },
  bored: { y: -0.05, tilt: 4, open: 0.6, squint: 0.1, pupil: 1, smile: -0.2 },
  restless: { y: 0, tilt: -10, open: 0.9, squint: 0.25, pupil: 1, smile: -0.55 },
  // furious at ACCESS DENIED: brows pulled in but still above the eyes
  seething: { y: 0.05, tilt: -14, open: 0.95, squint: 0.2, pupil: 0.9, smile: -0.7 },
  // back from the locked door: more put out than afraid
  annoyed: { y: 0, tilt: -6, open: 0.85, squint: 0.15, pupil: 1, smile: -0.3 },
  // at the desk with the pages: here it is, read it fast. Brows up, eyes wide, the start of a smile
  eager: { y: 0.3, tilt: 6, open: 1, squint: 0, pupil: 0.85, smile: 0.3 },
  struck: { y: 0.4, tilt: 10, open: 1, squint: 0, pupil: 0.7, smile: -0.1 },
  // the drawer opens: is there anything good in here? Brows up, eyes wide; then the pages are worthless
  curious: { y: 0.3, tilt: 4, open: 1, squint: 0, pupil: 0.85, smile: 0.1 },
  unimpressed: { y: -0.1, tilt: 6, open: 0.55, squint: 0.15, pupil: 1, smile: -0.4 },
};
const moodOf = (n) => FACES[n] ?? MOODS[n] ?? MOODS.neutral;
const mixMood = (a, b, k) => Object.fromEntries(Object.keys(MOODS.neutral).map((f) => [f, THREE.MathUtils.lerp(a[f] ?? 0, b[f] ?? 0, k)]));

// One body pose into another: a joint (or root field) one pose leaves out is at rest (0) there. blendPose in player.ts
// is an overlay instead (it leaves joints alone that the second pose lacks), which is what hand and head aims need
const mixPose = (a, b, k) => {
  const out = { root: {} };
  for (const r of new Set([...Object.keys(a.root ?? {}), ...Object.keys(b.root ?? {})])) out.root[r] = THREE.MathUtils.lerp(a.root?.[r] ?? 0, b.root?.[r] ?? 0, k);
  for (const j of new Set([...Object.keys(a), ...Object.keys(b)])) if (j !== "root") {
    const x = a[j] ?? [0, 0, 0], y = b[j] ?? [0, 0, 0];
    out[j] = x.map((v, i) => THREE.MathUtils.lerp(v, y[i], k));
  }
  return out;
};
const keyAt = (keys, t) => { let i = 0; while (i < keys.length - 1 && t >= keys[i + 1].t) i++; return i; };
const yawLerp = (a, b, k) => a + (((b - a + 540) % 360) - 180) * k;

// Distances along the walked path at every move key, computed once per edit (the studio swaps EDIT.steve on save)
const paths = new WeakMap();
const pathOf = (moves) => {
  if (paths.has(moves)) return paths.get(moves);
  const cum = [0];
  for (let i = 1; i < moves.length; i++) {
    const [a, b] = [moves[i - 1], moves[i]];
    cum.push(cum[i - 1] + (b.walk ? Math.hypot(b.at[0] - a.at[0], b.at[2] - a.at[2]) : 0) + (b.walk ? 0 : Math.abs(yawLerp(a.yaw, b.yaw, 1) - a.yaw) * D * 0.22));
  }
  paths.set(moves, cum);
  return cum;
};
// a walk speeds up over its first half metre and slows into its last: mostly constant pace
const walkEase = (x) => x * x * (3 - 2 * x) * 0.5 + x * 0.5;

// Where he is, which way he faces and the body pose at time t (no hand targets, no head aim yet)
export function bodyAt(moves, t) {
  const i = keyAt(moves, t), a = moves[i], b = moves[Math.min(i + 1, moves.length - 1)];
  const span = b.t - a.t, x = span > 0 ? clamp01((t - a.t) / span) : 0;
  const cum = pathOf(moves);
  const k = b.walk ? walkEase(x) : smooth(x);
  const at = a.at.map((v, j) => THREE.MathUtils.lerp(v, b.at[j], k));
  const yaw = yawLerp(a.yaw, b.yaw, b.walk ? smooth(x / 0.25) : k);
  const sa = t - a.t, sb = Math.max(0, t - b.t);
  let pose = b === a ? POSES[a.pose](sa) : mixPose(POSES[a.pose](sa), POSES[b.pose](sb), b.walk ? smooth((x - 0.8) / 0.2) : k);
  if (b.via && b !== a) pose = addPose(pose, mixPose({}, POSES[b.via](sa), Math.sin(Math.PI * x)));
  // steps: walking, or shuffling round on the spot while turning; the gait fades in and out with the speed
  const dist = (tt) => {
    const j = keyAt(moves, tt), p = moves[j], q = moves[Math.min(j + 1, moves.length - 1)];
    const xx = q.t > p.t ? clamp01((tt - p.t) / (q.t - p.t)) : 0;
    return cum[j] + (cum[Math.min(j + 1, cum.length - 1)] - cum[j]) * (q.walk ? walkEase(xx) : smooth(xx));
  };
  const d = dist(t), speed = (dist(t + 0.05) - d) / 0.05;
  const standing = (n) => ["stand", "feel"].includes(n);
  const walking = standing(a.pose) && standing(b.pose) || b.walk;
  if (walking) pose = addPose(pose, walkPose(d, speed));
  return { at, yaw, pose, key: i, act: b !== a && t < b.t ? b : a, moving: b !== a && t < b.t, speed, gait: walking ? gaitOf(d, speed) : null };
}

// The target of one hand or the head between keys: null blends back to the pose's own arm
export function targetAt(keys, field, t, anchor) {
  const ks = keys.filter((k) => field in k);
  if (!ks.length) return null;
  const i = keyAt(ks, t), a = ks[i], b = ks[Math.min(i + 1, ks.length - 1)];
  const x = b.t > a.t ? smooth((t - a.t) / (b.t - a.t)) : 0;
  const pa = a[field] == null ? null : anchor(a[field], t), pb = b[field] == null ? null : anchor(b[field], t);
  if (t < a.t) return null;
  if (pa && pb) return { p: pa.clone().lerp(pb, x), w: 1 };
  if (pa) return { p: pa, w: 1 - x };
  if (pb) return { p: pb, w: x };
  return null;
}

export function moodAt(keys, t) {
  const i = keyAt(keys, t), a = keys[i];
  const prev = i > 0 ? moodOf(keys[i - 1].mood) : moodOf(a.mood);
  return mixMood(prev, moodOf(a.mood), t < a.t ? 0 : smooth((t - a.t) / 0.5));
}

// Reading: the eyes cross a line in 1.3 s with small jumps (saccades), snap back, drop a line; held still 0.25 s per jump
export function readLook(ranges, t) {
  for (const [from, to] of ranges ?? []) if (t >= from && t < to) {
    const s = t - from, line = Math.floor(s / 1.6), u = (s % 1.6) / 1.6;
    const x = u < 0.85 ? -0.8 + Math.floor((u / 0.85) * 6) / 5 * 1.6 : 0.8 - smooth((u - 0.85) / 0.15) * 1.6;
    return [x, -0.15 - (line % 4) * 0.08];
  }
  return null;
}

// Blinks every 2.5 to 5.5 s (seeded by the blink's own index), 0.16 s each, so any frame knows if it falls in one
export function blinkAt(t, from) {
  if (t < from) return 0;
  let at = from + 1.5, n = 0;
  while (at < t - 0.2) { n++; at += 2.5 + 3 * ((Math.sin(n * 12.9898) * 43758.5453) % 1 + 1) % 1; }
  const u = (t - at) / 0.16;
  return u >= 0 && u <= 1 ? Math.sin(u * Math.PI) : 0;
}
