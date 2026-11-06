// Copied 2026-11-06 from the film's src/mocap.ts (work in progress in another session there): a snapshot, never a link.
// @ts-nocheck
// Human motion (a clip library: Quaternius UAL1/UAL2, Mixamo) onto Steve, as the film's own pose ({joint: [x, y, z]}
// degrees in his frame, root metres), so it goes through setPose and feet.ts like any hand-made pose; blend it with slerpPose
// below, not player.ts blendPose (angle by angle: two turns far apart blend the long way round, 170 degrees off).
// The source and the MCprep rig share no rest pose (a T-pose human with a curved spine against a straight box body with
// arms hanging down), so copying joint rotations or turns from rest is wrong: an idle human came out hunched 21 degrees.
// Instead everything is aimed from where the source's joints are: the hips and chest take the frame of the spine and of
// the hip and shoulder lines; every arm and leg points where the source limb points and folds as a hinge (the rig's lower bones bend one way only), the way game retargeters
// solve two-bone limbs: an elbow folds in the source's elbow plane, a knee in the plane of the source's foot, so the box leg
// never rolls away from where the foot points.
// A source is { at(role, out): world position, head(): world turn of the head }, roles below. Both face +z, left on +x, the floor at y = 0.
import * as THREE from "three";

const ROLES = ["hips", "waist", "neck", ...["shoulder", "elbow", "wrist", "hip", "knee", "ankle", "toe"].flatMap((r) => [r + "L", r + "R"])];
const D = 180 / Math.PI;
const SOFT = Math.sin(20 / D); // below this much elbow bend the hinge plane is noise: its twist fades out

// A glTF skeleton posed by its own mixer. names: role -> bone name (GLTFLoader drops "." and ":")
export const UAL = {
  hips: "DEF-hips", waist: "DEF-spine002", neck: "DEF-neck", head: "DEF-head",
  shoulderL: "DEF-upper_armL", elbowL: "DEF-forearmL", wristL: "DEF-handL", shoulderR: "DEF-upper_armR", elbowR: "DEF-forearmR", wristR: "DEF-handR",
  hipL: "DEF-thighL", kneeL: "DEF-shinL", ankleL: "DEF-footL", toeL: "DEF-toeL", hipR: "DEF-thighR", kneeR: "DEF-shinR", ankleR: "DEF-footR", toeR: "DEF-toeR",
};
// Unreal mannequin names: UAL2's GLB (and UAL1's Unreal-Godot GLB)
export const UE = {
  hips: "pelvis", waist: "spine_02", neck: "neck_01", head: "Head",
  shoulderL: "upperarm_l", elbowL: "lowerarm_l", wristL: "hand_l", shoulderR: "upperarm_r", elbowR: "lowerarm_r", wristR: "hand_r",
  hipL: "thigh_l", kneeL: "calf_l", ankleL: "foot_l", toeL: "ball_l", hipR: "thigh_r", kneeR: "calf_r", ankleR: "foot_r", toeR: "ball_r",
};
// Mixamo FBX (FBXLoader drops the ":" of "mixamorig:")
export const MIXAMO = {
  hips: "mixamorigHips", waist: "mixamorigSpine1", neck: "mixamorigNeck", head: "mixamorigHead",
  shoulderL: "mixamorigLeftArm", elbowL: "mixamorigLeftForeArm", wristL: "mixamorigLeftHand", shoulderR: "mixamorigRightArm", elbowR: "mixamorigRightForeArm", wristR: "mixamorigRightHand",
  hipL: "mixamorigLeftUpLeg", kneeL: "mixamorigLeftLeg", ankleL: "mixamorigLeftFoot", toeL: "mixamorigLeftToeBase", hipR: "mixamorigRightUpLeg", kneeR: "mixamorigRightLeg", ankleR: "mixamorigRightFoot", toeR: "mixamorigRightToeBase",
};
// The head copies its turn from the skeleton's rest, which stands upright
export function skeletonSource(root, names) {
  const bone = {};
  root.traverse((o) => { bone[o.name] = bone[o.name] ?? o; });
  for (const r of [...ROLES, "head"]) if (!bone[names[r]]) throw new Error(`mocap source has no ${r} (${names[r]})`);
  root.updateMatrixWorld(true);
  const headRest = bone[names.head].getWorldQuaternion(new THREE.Quaternion()).invert();
  return {
    update: () => root.updateMatrixWorld(true),
    at: (r, out = new THREE.Vector3()) => bone[names[r]].getWorldPosition(out),
    head: () => bone[names.head].getWorldQuaternion(new THREE.Quaternion()).multiply(headRest),
    quat: (r, out = new THREE.Quaternion()) => bone[names[r]].getWorldQuaternion(out),
  };
}

// Steve's body as boxes, one per joint, axis-aligned in the rest world (the rig's vertices at rest, each to the joint that
// weighs most on it), plus each joint's rest matrix: a point now maps into the rest world by rest * now^-1, rigid in metres
// even though the rig's parents are scaled
function bodyBoxes(player) {
  const keyOf = new Map(Object.entries(player.bones).map(([k, b]) => [b, k]));
  const box = {}, v = new THREE.Vector3();
  player.rig.traverse((o) => {
    if (!o.isSkinnedMesh || /Layer2/.test(o.name)) return;
    const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    for (let i = 0; i < g.attributes.position.count; i++) {
      let w = 0, bi = 0;
      for (let j = 0; j < 4; j++) if (sw.getComponent(i, j) > w) { w = sw.getComponent(i, j); bi = si.getComponent(i, j); }
      let bone = o.skeleton.bones[bi];
      while (bone && !keyOf.has(bone)) bone = bone.parent;
      if (!bone) continue;
      o.getVertexPosition(i, v);
      o.localToWorld(v);
      (box[keyOf.get(bone)] ??= new THREE.Box3()).expandByPoint(v);
    }
  });
  const rest = Object.fromEntries(Object.keys(box).map((k) => [k, player.bones[k].matrixWorld.clone()]));
  return { box, rest };
}

// Signed distance (metres) from p to a box grown by r with rounded edges (the box swept by a ball of radius r), and the
// way out: continuous everywhere outside the box itself
const C = new THREE.Vector3(), Hh = new THREE.Vector3(), q = new THREE.Vector3(), mx = new THREE.Vector3();
function roundedBox(p, b, r, out) {
  b.getCenter(C); b.getSize(Hh).multiplyScalar(0.5);
  q.copy(p).sub(C);
  const sx = Math.sign(q.x) || 1, sy = Math.sign(q.y) || 1, sz = Math.sign(q.z) || 1;
  q.set(Math.abs(q.x) - Hh.x, Math.abs(q.y) - Hh.y, Math.abs(q.z) - Hh.z);
  mx.set(Math.max(q.x, 0), Math.max(q.y, 0), Math.max(q.z, 0));
  const outside = mx.length();
  if (outside > 1e-6) {
    out.set(mx.x * sx, mx.y * sy, mx.z * sz).divideScalar(outside);
    return outside - r;
  }
  // inside the box: out through the nearest face (it flips to another face where the point crosses the box's diagonal:
  // pose() holds the hand's push back there)
  const m = Math.max(q.x, q.y, q.z);
  out.set(m === q.x ? sx : 0, m === q.y && m !== q.x ? sy : 0, m === q.z && m !== q.x && m !== q.y ? sz : 0);
  return m - r;
}

const PXM = 1.875 / 32; // one skin pixel, metres
const HAND = 2 * PXM; // half the arm's width: the hand is a ball this big around the middle of the arm box's end
const LEG_R = 1.9 * PXM; // a leg as a capsule, a hair under half its width so legs side by side at rest just touch
const HEAD_TURN = 90 / D; // the most the head turns to keep out of the floor
const TRAPPED = 0.12; // a hand deeper than this in his body or the floor is let be (see pose())
const JUMP = 0.3; // m (Steve's scale) the source's hips may move in a frame before it counts as a cut, see pose()
const SETTLE = 8; // passes at most, see pose()
const FIX_SPEED = 1; // m/s, see pose()
const HEAD_SPEED = Math.PI; // rad/s, see pose()
const TWIST_SPEED = 2 * Math.PI; // rad/s, see limb()
const DEAD = 0.03; // the source counts as touching the floor below this much (its body's height is only estimated)
// how far the source's body reaches past each joint, as a share of its leg (hip to ankle): its lowest point is estimated
// from these, the source being a skeleton. Body and legs only, the same parts as his (see lowest)
const REACH = { hips: 0.12, waist: 0.12, neck: 0.08, shoulderL: 0.07, shoulderR: 0.07, elbowL: 0.05, elbowR: 0.05, hipL: 0.1, hipR: 0.1, kneeL: 0.06, kneeR: 0.06, ankleL: 0.1, ankleR: 0.1, toeL: 0.035, toeR: 0.035 };

// b over a by weight k, each joint's turn (and the root's) as a quaternion slerp, root place by lerp. A joint one pose
// leaves out is at rest there
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), ea = new THREE.Euler();
const qOf = (a, out) => out.setFromEuler(ea.set((a[0] ?? 0) / D, (a[1] ?? 0) / D, (a[2] ?? 0) / D, "YXZ"));
const degOf = (q) => { ea.setFromQuaternion(q, "YXZ"); return [ea.x * D, ea.y * D, ea.z * D]; };
export function slerpPose(a, b, k) {
  const out = {};
  for (const j of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (j === "root") continue;
    out[j] = degOf(qOf(a[j] ?? [], qa).slerp(qOf(b[j] ?? [], qb), k));
  }
  const ra = a.root ?? {}, rb = b.root ?? {};
  const [rx, ry, rz] = degOf(qOf([ra.rx, ra.ry, ra.rz], qa).slerp(qOf([rb.rx, rb.ry, rb.rz], qb), k));
  out.root = { rx, ry, rz };
  for (const r of ["x", "y", "z"]) out.root[r] = THREE.MathUtils.lerp(ra[r] ?? 0, rb[r] ?? 0, k);
  return out;
}

// A clip baked in played order at fps (rt: a retargeter; setTime(t): poses the source at clip time t, e.g. a mixer's),
// read back by at(t): a pure function of time, neighbouring frames slerped
export function bakeClip(rt, setTime, duration, fps = 60) {
  const n = Math.max(1, Math.ceil(duration * fps)), frames = [];
  for (let i = 0; i <= n; i++) {
    setTime(Math.min(duration - 1e-4, i / fps));
    frames.push(rt.pose(i ? 1 / fps : 0));
  }
  const at = (t) => {
    const x = THREE.MathUtils.clamp(t * fps, 0, n), i = Math.min(Math.floor(x), n - 1);
    return slerpPose(frames[i], frames[i + 1], x - i);
  };
  return { frames, fps, at };
}

// src: a source as above, at its rest or first frame; player: makePlayer's result, used once for the rig's rest.
// Returns { pose(dt): Steve's pose for the source's current frame (floor / own: false skip the fixes below; dt: seconds since
// the previous call when frames are played in order, as a bake does, 0 for a frame on its own), measure(): how far Steve, posed as pose() says at the
// origin, is from the source }. pose() poses the player on the way (at the origin, his group's place kept): set your own
// pose after it.
// Its speed limits remember the last frame, so never call pose() from draw(t): bake the clip with bakeClip below and read
// its at(t), which is the same pose for the same t in any order; a source hips jump past JUMP (a cut, loop or seek)
// starts the memory afresh. To make a pose your own (a hand on the door, a turned head), change at(t)'s result or
// slerpPose another over it: the fixes below don't run again on your change, so keep your hands out of his head yourself.
// Lock its feet only with a leg IK that keeps the pose's own knee plane (player.ts legTo does): one that folds every knee
// straight back unfolds a kneel or crossed legs. A film plays clips through src/clips.ts, which bakes them.
// After the limbs are aimed, two things the box body needs that the human doesn't, both continuous in time:
//  - the floor: his lowest point goes where the source's lowest point is (scaled), so a body sitting, lying or kneeling on
//    the floor sits on it instead of hanging above it (the hip path alone can't: his thick box limbs and big head put his
//    contact points elsewhere than a human's) or sinking into it;
//  - his own body: a hand that would end inside his head (twice a human's), body or legs stops on their surface, the arm
//    re-solved as two bones in the plane of its own elbow, so a hand on the face rests on the face. Untouched otherwise.
export function retargeter(src, player, { floor = true, own = true } = {}) {
  const atOrigin = (fn) => {
    const p0 = player.g.position.clone(), q0 = player.g.quaternion.clone();
    player.g.position.set(0, 0, 0); player.g.quaternion.identity();
    try { return fn(); } finally { player.g.position.copy(p0); player.g.quaternion.copy(q0); }
  };
  src.update();
  const hip0 = src.at("hips");
  const srcLeg = src.at("hipL").distanceTo(src.at("kneeL")) + src.at("kneeL").distanceTo(src.at("ankleL"));
  const k = player.legReach / srcLeg; // the source's moves scaled to Steve's shorter legs
  // everything below reads the source's rest from the pose it is in now: it must stand upright with its limbs square to
  // +z (a T- or A-pose facing +z), so build the source before any mixer has moved it
  const along = (a, c) => Math.abs(src.at(c).sub(src.at(a)).normalize().z);
  if (src.at("neck").y - hip0.y < 0.3 * srcLeg || ["L", "R"].some((sd) => along(`shoulder${sd}`, `elbow${sd}`) > 0.7 || along(`hip${sd}`, `knee${sd}`) > 0.7))
    throw new Error("mocap source is not at an upright rest facing +z: build it before its mixer runs");

  // Steve at rest: each limb hangs straight down its upper bone
  const b = player.bones, pos = (x) => x.getWorldPosition(new THREE.Vector3());
  const a0 = {}, chestRest = new THREE.Quaternion(), headRestQ = new THREE.Quaternion(), rootRestQ = new THREE.Quaternion(), body = atOrigin(() => {
    player.setPose({});
    player.g.updateMatrixWorld(true);
    for (const sd of ["L", "R"]) {
      a0[`ua${sd}`] = pos(b[`la${sd}`]).sub(pos(b[`ua${sd}`])).normalize();
      a0[`ul${sd}`] = pos(b[`ll${sd}`]).sub(pos(b[`ul${sd}`])).normalize();
    }
    chestRest.copy(b.chest.getWorldQuaternion(new THREE.Quaternion())).invert();
    headRestQ.copy(b.head.getWorldQuaternion(new THREE.Quaternion())).invert();
    rootRestQ.copy(b.root.getWorldQuaternion(new THREE.Quaternion())).invert();
    return bodyBoxes(player);
  });
  const handRest = Object.fromEntries(["L", "R"].map((sd) => {
    const bx = body.box[`la${sd}`];
    return [sd, new THREE.Vector3((bx.min.x + bx.max.x) / 2, bx.min.y + HAND, (bx.min.z + bx.max.z) / 2)];
  }));
  const OBSTACLES = ["head", "body", "chest", "ulL", "ulR", "llL", "llR"].filter((x) => body.box[x]);
  // the middle of each shin box's bottom end, a leg's radius up: the far end of the leg as a capsule
  const footRest = Object.fromEntries(["L", "R"].map((sd) => {
    const bx = body.box[`ll${sd}`];
    return [sd, new THREE.Vector3((bx.min.x + bx.max.x) / 2, bx.min.y + LEG_R, (bx.min.z + bx.max.z) / 2)];
  }));

  // A turn as the rig's YXZ degrees. Every turn has two ([x, y, z] and [180 - x, y + 180, z + 180]), each up to a whole
  // turn; played in order, a joint keeps the pair and the whole turns nearest its last frame (angles may pass 180), or a
  // turn passing x = 90 (an arm straight forward, a body lying flat) swaps y and z by 180, a spin crosses 180 to -180, and
  // anything reading the angles in between (a resampled bake) spins the joint the long way round
  const e = new THREE.Euler(), eulerNow = {};
  let eulerWas = {};
  const wrap180 = (x) => THREE.MathUtils.euclideanModulo(x + 180, 360) - 180;
  const deg = (q, key) => {
    e.setFromQuaternion(q, "YXZ");
    let out = [e.x * D, e.y * D, e.z * D];
    const was = key && eulerWas[key];
    if (was) {
      const alt = [wrap180(180 - out[0]), wrap180(out[1] + 180), wrap180(out[2] + 180)];
      const cost = (c) => c.reduce((sum, x, i) => sum + Math.abs(wrap180(x - was[i])), 0);
      if (cost(alt) < cost(out)) out = alt;
      out = out.map((x, i) => was[i] + wrap180(x - was[i]));
    }
    if (key) eulerNow[key] = out;
    return out;
  };
  const d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), v = new THREE.Vector3(), perp = new THREE.Vector3(), b0 = new THREE.Vector3();
  const S = new THREE.Quaternion(), T = new THREE.Quaternion(), Pi = new THREE.Quaternion();
  const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3(), M = new THREE.Matrix4(), M2 = new THREE.Matrix4();
  // the world turn whose up is `up` and whose left (+x) is `side`
  const frame = (up, side) => {
    by.copy(up).normalize();
    bx.copy(side).addScaledVector(by, -side.dot(by)).normalize();
    bz.crossVectors(bx, by);
    return new THREE.Quaternion().setFromRotationMatrix(M.makeBasis(bx, by, bz));
  };
  const between = (r1, r2) => src.at(r2).sub(src.at(r1));

  // The twist of a limb (where its hinge folds) is a choice of the box's roll about its own bone. Bent, the source's own
  // hinge plane fixes it. Nearly straight, that plane is noise, and the roll comes from the source's upper bone itself: its
  // rest fold (forward for an elbow, back for a knee, both square to the bone in a T-pose) turned as the bone turns since
  // its rest, so the roll is continuous where the plane is not (an arm straightening and bending again flipped 70 degrees
  // in a frame). Bent past 40 degrees the two planes agree within ~5 (Mixamo, lab "hinge gap"); the foot's direction
  // does not (kneeling, it points back: the knee folded the wrong way round)
  const restQ = Object.fromEntries(["shoulderL", "shoulderR", "hipL", "hipR"].map((r) => [r, src.quat(r).invert()]));
  const hinge = (r, fold) => new THREE.Vector3(0, 0, fold).applyQuaternion(restQ[r]).applyQuaternion(src.quat(r));
  const wrap = (x) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
  const c = new THREE.Vector3(), hv = new THREE.Vector3();
  // the roll that turns the rest fold b0 onto x about a (x in the upper bone's rest frame); null if x lies along a
  const phiOf = (x, a) => {
    x.addScaledVector(a, -x.dot(a));
    return x.lengthSq() < 1e-8 ? null : Math.atan2(c.crossVectors(b0, x).dot(a), b0.dot(x));
  };
  const gap = {}, twistNow = {};
  let twistWas = {}, frameDt = 0;
  // upper key, lower key, the upper and lower bones' world directions, the source's hinge (world, see hinge), the foot's
  // (legs only), the parent's turn, +1 bends forward (elbow) / -1 back (knee); fixed: the limb re-aimed by a fix below.
  // A fix's twist is held to last frame's final one (what was shown), the source's own to last frame's own (held to the
  // final one, the next frame's own solve started from a turn a fix had made, and a held frame drifted 23 degrees over 4
  // frames; a fix held to last frame's fix only had none to keep to where a fix began, and an arm spun 60 in a frame)
  const limb = (pose, u, l, w1, w2, hw, P, fold, fixed = false) => {
    Pi.copy(P).invert();
    d1.copy(w1).applyQuaternion(Pi).normalize();
    d2.copy(w2).applyQuaternion(Pi).normalize();
    const a = a0[u];
    S.setFromUnitVectors(a, d1);
    T.copy(S).invert();
    v.copy(d2).applyQuaternion(T); // the lower bone in the upper bone's rest frame
    const bend = Math.acos(THREE.MathUtils.clamp(v.dot(a), -1, 1));
    perp.copy(v).addScaledVector(a, -v.dot(a));
    const n = perp.length();
    b0.set(0, 0, fold).addScaledVector(a, -fold * a.z).normalize(); // the rest fold, square to the bone
    const straight = phiOf(hv.copy(hw).applyQuaternion(Pi).applyQuaternion(T), a) ?? 0;
    const own = n > 1e-6 ? phiOf(perp, a) : straight;
    if (bend > 40 / D) gap[u] = Math.abs(wrap(own - straight)) * D;
    // played in order, the plane leaves the bone's no faster than TWIST_SPEED: a mocap elbow is no clean hinge, and its
    // plane can swing 47 degrees round the upper arm in a frame (the whole box arm spun with it)
    // (n shrinks again past 90 degrees of bend, and a knee folded flat is the most bent of all)
    let off = wrap(own - straight) * THREE.MathUtils.smoothstep(bend > Math.PI / 2 ? 1 : n, 0, SOFT);
    const key = fixed ? u + "+" : u; // u+: last frame's final twist
    if (frameDt > 0 && key in twistWas) off = twistWas[key] + THREE.MathUtils.clamp(wrap(off - twistWas[key]), -TWIST_SPEED * frameDt, TWIST_SPEED * frameDt);
    twistNow[key] = off;
    if (!fixed) twistNow[u + "+"] = off;
    const phi = straight + off;
    T.setFromAxisAngle(a, phi);
    S.multiply(T);
    pose[u] = deg(S, u);
    pose[l] = [-fold * bend * D, 0, 0];
  };

  // Steve's lowest point now (of the given joints' boxes), and the source's (estimated). The floor fix counts his body, legs
  // and upper arms, not forearms or head: with his long arms and short legs a hand sweeping the floor would lift the whole
  // body off it, and his head,
  // twice a human's, lifted a body lying face down 20 cm whenever the source raised its head (both meet the floor on their
  // own: headUp, pushOut)
  const corner = new THREE.Vector3(), lowPoint = new THREE.Vector3();
  const ARMS = { L: ["uaL", "laL"], R: ["uaR", "laR"] };
  const TRUNK = Object.keys(body.box).filter((x) => x !== "head" && !/^la/.test(x));
  let lowestPart = "";
  const lowest = (keys = TRUNK) => {
    let y = Infinity;
    for (const key of keys) {
      const bxx = body.box[key];
      M.copy(b[key].matrixWorld).multiply(M2.copy(body.rest[key]).invert());
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? bxx.max.x : bxx.min.x, i & 2 ? bxx.max.y : bxx.min.y, i & 4 ? bxx.max.z : bxx.min.z).applyMatrix4(M);
        if (corner.y < y) { y = corner.y; lowestPart = key; lowPoint.copy(corner); }
      }
    }
    return y;
  };
  const srcLowest = () => Math.min(...Object.entries(REACH).map(([r, f]) => src.at(r).y - f * srcLeg));
  // a world point into joint `key`'s rest world, and back
  const toRest = (key, p) => p.applyMatrix4(M.copy(body.rest[key]).multiply(M2.copy(b[key].matrixWorld).invert()));
  const fromRest = (key, p) => p.applyMatrix4(M.copy(b[key].matrixWorld).multiply(M2.copy(body.rest[key]).invert()));
  const handAt = (sd, out) => fromRest(`la${sd}`, out.copy(handRest[sd]));
  const footAt = (sd, out) => fromRest(`ll${sd}`, out.copy(footRest[sd]));
  // the closest points of segments a0-a1 and b0-b1: [s, t] along each (0..1)
  const ab = new THREE.Vector3(), cd = new THREE.Vector3(), ac = new THREE.Vector3();
  const closest = (a0, a1, b0, b1) => {
    ab.subVectors(a1, a0); cd.subVectors(b1, b0); ac.subVectors(a0, b0);
    const A = ab.dot(ab), B = ab.dot(cd), Cc = cd.dot(cd), Dd = ab.dot(ac), E = cd.dot(ac), den = A * Cc - B * B;
    let s = den > 1e-9 ? THREE.MathUtils.clamp((B * E - Cc * Dd) / den, 0, 1) : 0;
    let t = THREE.MathUtils.clamp((B * s + E) / Cc, 0, 1);
    s = THREE.MathUtils.clamp((B * t - Dd) / A, 0, 1);
    return [s, t];
  };
  const grad = new THREE.Vector3(), lp = new THREE.Vector3();
  // the hand moved out of every obstacle, and above the floor unless floor is false (a few passes: out of one can be into
  // another); returns how deep it was
  const pushOut = (p, floor = true) => {
    let deepest = 0;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const key of OBSTACLES) {
        toRest(key, lp.copy(p));
        const dist = roundedBox(lp, body.box[key], HAND, grad);
        if (dist < 0) {
          deepest = Math.max(deepest, -dist);
          lp.addScaledVector(grad, -dist + 1e-4);
          fromRest(key, p.copy(lp));
          moved = true;
        }
      }
      if (floor && p.y < HAND) { deepest = Math.max(deepest, HAND - p.y); p.y = HAND; moved = true; }
      if (!moved) break;
    }
    return deepest;
  };

  const fix = { L: new THREE.Vector3(), R: new THREE.Vector3() }, last = { L: null, R: null }, lastHand = { L: null, R: null }, lastHead = { fix: null, src: null }, legSide = {}, legLast = { L: null, R: null }, mx2 = new THREE.Vector3();
  let Qchest = new THREE.Quaternion();
  const sh = new THREE.Vector3(), el = new THREE.Vector3(), hd = new THREE.Vector3(), tg = new THREE.Vector3(), u = new THREE.Vector3(), pole = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), qc = new THREE.Quaternion(), hR = new THREE.Vector3(), tR = new THREE.Vector3();
  let elbowWas = {};
  const elbowNow = {};
  const solveFrame = (dt) => atOrigin(() => {
    for (const x in gap) delete gap[x];
    src.update();
    frameDt = dt;
    twistWas = dt > 0 ? { ...twistNow } : {};
    eulerWas = dt > 0 ? { ...eulerNow } : {};
    elbowWas = dt > 0 ? { ...elbowNow } : {};
    const Qroot = frame(between("hips", "waist"), between("hipR", "hipL"));
    Qchest = frame(between("waist", "neck"), between("shoulderR", "shoulderL"));
    const Qhead = src.head();
    const rel = (parent, q) => new THREE.Quaternion().copy(parent).invert().multiply(q);
    const [rx, ry, rz] = deg(Qroot, "root");
    const h = src.at("hips").sub(hip0).multiplyScalar(k);
    const p = {
      root: { x: h.x, y: h.y, z: h.z, rx, ry, rz },
      chest: deg(rel(Qroot, Qchest), "chest"), head: deg(rel(Qchest, Qhead), "head"),
    };
    for (const sd of ["L", "R"]) {
      limb(p, `ua${sd}`, `la${sd}`, between(`shoulder${sd}`, `elbow${sd}`), between(`elbow${sd}`, `wrist${sd}`), hinge(`shoulder${sd}`, 1), Qchest, 1);
      limb(p, `ul${sd}`, `ll${sd}`, between(`hip${sd}`, `knee${sd}`), between(`knee${sd}`, `ankle${sd}`), hinge(`hip${sd}`, -1), Qroot, -1);
    }
    const place = () => { player.setPose(p); player.g.updateMatrixWorld(true); };
    // his legs out of each other and of his body: box legs are thicker than a human's, so knees together, legs crossed
    // or a thigh pressed to the chest ran one box through the other
    if (own) {
      place();
      const L = {}, sideNow = {};
      for (const sd of ["L", "R"]) {
        const H = pos(b[`ul${sd}`]), K = pos(b[`ll${sd}`]), F = footAt(sd, new THREE.Vector3());
        L[sd] = { H, K, F, K0: K.clone(), F0: F.clone(), l1: H.distanceTo(K), l2: K.distanceTo(F), moved: false };
      }
      const pa = new THREE.Vector3(), pb = new THREE.Vector3(), nrm = new THREE.Vector3();
      // moves the point at s along a leg's segment (thigh: hip fixed, so the knee turns it; shin: knee and foot share it)
      const shift = (leg, shin, s, by) => {
        if (shin) { leg.K.addScaledVector(by, 1 - s); leg.F.addScaledVector(by, s); }
        else { leg.K.addScaledVector(by, 1 / Math.max(s, 0.3)); leg.F.addScaledVector(by, 1 / Math.max(s, 0.3)); }
        leg.moved = true;
      };
      for (let pass = 0; pass < 3; pass++) {
        let hit = false;
        for (const [sl, sr] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
          const a0 = sl ? L.L.K : L.L.H, a1 = sl ? L.L.F : L.L.K, c0 = sr ? L.R.K : L.R.H, c1 = sr ? L.R.F : L.R.K;
          const [s1, t1] = closest(a0, a1, c0, c1);
          pa.lerpVectors(a0, a1, s1); pb.lerpVectors(c0, c1, t1);
          const dd = pa.distanceTo(pb);
          if (dd >= 2 * LEG_R) continue;
          nrm.subVectors(pa, pb);
          if (nrm.lengthSq() < 1e-10) nrm.set(1, 0, 0).applyQuaternion(Qroot); else nrm.normalize();
          // played in order, a pair stays on the side it met on: legs that pass through each other in the source flipped
          // the push to the far side the moment their middles crossed (a knee 25 cm in a frame)
          const pair = `${sl}${sr}`;
          let need = 2 * LEG_R - dd;
          if (dt > 0 && legSide[pair] && nrm.dot(legSide[pair]) < 0) { nrm.negate(); need = 2 * LEG_R + dd; }
          (sideNow[pair] ??= new THREE.Vector3()).copy(nrm);
          // the leg on top takes the push: a leg crossed over the other rests on it rather than pressing it into the floor
          const wl = 0.5 + 0.5 * nrm.y;
          shift(L.L, sl, s1, v.copy(nrm).multiplyScalar(need * wl));
          shift(L.R, sr, t1, v.copy(nrm).multiplyScalar(-need * (1 - wl)));
          hit = true;
        }
        // knees and feet out of his body
        for (const sd of ["L", "R"]) for (const key of ["K", "F"]) {
          const at = L[sd][key];
          for (const box of ["body", "chest"]) {
            if (!body.box[box]) continue;
            toRest(box, lp.copy(at));
            const dist = roundedBox(lp, body.box[box], LEG_R, grad);
            if (dist >= 0) continue;
            lp.addScaledVector(grad, -dist);
            fromRest(box, lp);
            v.subVectors(lp, at);
            if (key === "K") { at.add(v); L[sd].F.add(v); } else at.add(v);
            L[sd].moved = hit = true;
          }
        }
        // back to their own lengths
        for (const sd of ["L", "R"]) {
          const g = L[sd];
          g.K.sub(g.H).setLength(g.l1).add(g.H);
          g.F.sub(g.K).setLength(g.l2).add(g.K);
        }
        if (!hit) break;
      }
      for (const x in legSide) delete legSide[x];
      Object.assign(legSide, sideNow);
      // played in order, the knee's and foot's corrections change no faster than FIX_SPEED plus their own move (as the hand's),
      // both measured in his body's frame so a run's own speed doesn't count as room to jump
      for (const sd of ["L", "R"]) {
        const g = L[sd], was = legLast[sd];
        for (const x of ["H", "K", "F", "K0", "F0"]) toRest("body", g[x]);
        if (dt > 0 && was) {
          for (const [key, k0] of [["K", "K0"], ["F", "F0"]]) {
            const off = mx2.copy(g[key]).sub(g[k0]), step = off.sub(was[key]), max = FIX_SPEED * dt + g[k0].distanceTo(was[k0]);
            if (step.length() > max) { g[key].copy(g[k0]).add(was[key]).add(step.setLength(max)); g.moved = true; }
          }
          g.K.sub(g.H).setLength(g.l1).add(g.H);
          g.F.sub(g.K).setLength(g.l2).add(g.K);
        }
        legLast[sd] = { K: g.K.clone().sub(g.K0), F: g.F.clone().sub(g.F0), K0: g.K0.clone(), F0: g.F0.clone() };
        for (const x of ["H", "K", "F"]) fromRest("body", g[x]);
      }
      for (const sd of ["L", "R"]) if (L[sd].moved) limb(p, `ul${sd}`, `ll${sd}`, d1.copy(L[sd].K).sub(L[sd].H), d2.copy(L[sd].F).sub(L[sd].K), hinge(`hip${sd}`, -1), Qroot, -1, true);
    }
    // the floor
    place();
    // only near the floor: off it (a jump, a ladder) the scaled hip path alone is the source's own move, and which of his
    // feet is lowest there can change at another moment than the source's (a step up a ladder bumped him 4 cm)
    const sl = srcLowest(), near = 1 - THREE.MathUtils.smoothstep(sl, 0.1, 0.3);
    if (floor) p.root.y += near * (k * Math.max(0, sl - DEAD) - lowest());
    if (floor) {
      // the head out of the floor: turned about the neck, away from it, at most HEAD_TURN, less the more his chest hangs
      // upside down (on his head in a roll no turn gets it out, and the corner it chased flipped side to side 118 degrees a
      // frame; the head's own upside down is no sign of that: a body lying face down with its chin tucked has it too, and
      // stood on its head 37 cm up); any rest lifts the body
      let Qh = Qhead.clone();
      const cap = HEAD_TURN * (1 - THREE.MathUtils.smoothstep(-v.set(0, 1, 0).applyQuaternion(Qchest).y, 0.5, 0.85));
      for (let pass = 0, turned = 0; pass < 3; pass++) {
        place();
        if (lowest(["head"]) >= 0) break;
        b.head.getWorldPosition(sh);
        u.copy(lowPoint).sub(sh);
        const ry = u.y, A = Math.hypot(u.x, u.z);
        if (A < 1e-4) break;
        pole.set(u.x, 0, u.z).cross(by.set(0, 1, 0)).normalize(); // turning about this lifts the corner
        const Rm = Math.hypot(A, ry), want = THREE.MathUtils.clamp(-sh.y / Rm, -1, 1);
        const th = Math.min(Math.asin(want) - Math.atan2(ry, A), cap - turned);
        if (th <= 1e-5) break;
        turned += th;
        Qh = new THREE.Quaternion().setFromAxisAngle(pole, th).multiply(Qh);
        p.head = deg(rel(Qchest, Qh), "head");
      }
      // played in order, the turn changes no faster than HEAD_SPEED plus the source head's own turn
      const fixQ = Qh.clone().multiply(T.copy(Qhead).invert());
      if (dt > 0 && lastHead.fix) {
        const max = HEAD_SPEED * dt + Qhead.angleTo(lastHead.src), ang = fixQ.angleTo(lastHead.fix);
        if (ang > max) {
          const want = fixQ.clone();
          fixQ.copy(lastHead.fix).slerp(want, max / ang);
          Qh.copy(fixQ).multiply(Qhead);
          p.head = deg(rel(Qchest, Qh), "head");
        }
      }
      lastHead.fix = fixQ; lastHead.src = Qhead.clone();
      place();
      // (held back, the rest lifts the body at once: a lift held back too let the head 26 cm into the floor in a tackle)
      p.root.y += Math.max(0, -lowest(["head"]));
    }
    // his own body
    place();
    for (const sd of own || floor ? ["L", "R"] : []) {
      handAt(sd, hd);
      tg.copy(hd);
      const depth = own ? pushOut(tg, false) : 0; // the floor comes after, see below
      // a hand far inside is one with no room at all (under his cheek on the floor, where his head is twice a human's):
      // pushing it out of one surface drives it into the other and the arm flips, so it is left where the source has it
      tg.lerp(hd, THREE.MathUtils.smoothstep(depth, TRAPPED, TRAPPED + 0.1));
      b[`ua${sd}`].getWorldPosition(sh); b[`la${sd}`].getWorldPosition(el);
      const L1 = sh.distanceTo(el), L2 = el.distanceTo(hd);
      // the elbow folds in the plane it has, and a straight arm in the one its upper bone's roll gives (see hinge): a
      // fixed fallback flipped a straight arm meeting the floor 95 degrees in a frame. The pole is where the elbow goes,
      // the opposite side of the shoulder-hand line from where the forearm folds
      u.copy(hd).sub(sh).normalize();
      pole.copy(el).sub(sh).addScaledVector(u, -u.dot(pole));
      pole.addScaledVector(hinge(`shoulder${sd}`, 1), -0.3 * L1 * (1 - THREE.MathUtils.smoothstep(pole.length() / L1, 0.05, 0.3)));
      const solve = () => {
        const dist = THREE.MathUtils.clamp(tg.distanceTo(sh), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
        u.copy(tg).sub(sh).normalize();
        v.copy(pole).addScaledVector(u, -pole.dot(u));
        const clear = v.length() / Math.max(pole.length(), 1e-6);
        if (v.lengthSq() < 1e-8) { v.copy(hinge(`shoulder${sd}`, 1)).negate(); v.addScaledVector(u, -v.dot(u)); }
        v.normalize();
        // a hand lifted off the floor can land on the line the pole points along, where the elbow's side is undecided and
        // flipped 150 degrees in a frame (a fall planting a hand): played in order, the elbow then keeps last frame's side
        const w = 1 - THREE.MathUtils.smoothstep(clear, 0.15, 0.4);
        if (w > 0 && elbowWas[sd]) {
          e2.copy(elbowWas[sd]).applyQuaternion(b.chest.getWorldQuaternion(qc));
          e2.addScaledVector(u, -e2.dot(u));
          if (e2.lengthSq() > 1e-6) v.lerp(e2.normalize(), w).normalize();
        }
        const cosA = THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
        el.copy(sh).addScaledVector(u, L1 * cosA).addScaledVector(v, L1 * Math.sqrt(1 - cosA * cosA));
        limb(p, `ua${sd}`, `la${sd}`, d1.copy(el).sub(sh), d2.copy(tg).sub(el), hinge(`shoulder${sd}`, 1), Qchest, 1, true);
        place();
      };
      // played in order (dt > 0), the hand's push out of his body follows the hand's own move along last frame's push (a
      // hand going into a surface is pushed back as fast as it goes), and changes no faster than FIX_SPEED otherwise: the
      // way out flips to another face as a fast hand passes the box's diagonal or through his head (a bow drawn to a
      // human's cheek is 17 cm inside his), and the arm snapped straight for a frame; allowing the hand's whole move let a
      // fast hand flip freely (in his chest's frame, as the legs')
      const hdR = toRest("chest", hR.copy(hd)), off = fix[sd].copy(toRest("chest", tR.copy(tg))).sub(hdR);
      if (dt > 0 && last[sd]) {
        // last frame's push, along its own way: grown at once to this frame's push along it (something pressing in, the
        // hand or his head turning onto it: held to the hand's move alone, a hand on the chin went 13 cm into a turning
        // head); else carried by the hand's move along it, never past zero (a hand leaving is not pulled back in) nor past
        // last frame's push (a hand going on into a surface it has already left is free: a diving hand stayed 28 cm off)
        const n = e1.copy(last[sd].lengthSq() > 1e-6 ? last[sd] : off);
        if (n.lengthSq() > 1e-10) n.normalize();
        const was = last[sd].length(), now = off.dot(n), carried = was - mx2.copy(hdR).sub(lastHand[sd]).dot(n);
        const follow = n.multiplyScalar(now >= was ? now : THREE.MathUtils.clamp(carried, Math.max(0, now), was));
        const step = mx2.copy(off).sub(follow), max = FIX_SPEED * dt;
        if (step.length() > max) {
          off.copy(follow).add(step.setLength(max));
          fromRest("chest", tg.copy(hdR).add(off));
        }
      }
      (last[sd] ??= new THREE.Vector3()).copy(off);
      (lastHand[sd] ??= new THREE.Vector3()).copy(hdR);
      // then the floor, never held back nor remembered (a body turning fast in a fall moves the floor through his chest's
      // frame: a held-back lift let the hand 20 cm into it, and a lift remembered with the push came back held and was
      // lifted again, the arm swinging 50 degrees in a frame); twice: the box's own corners can still dip under the floor
      // once the hand's middle is above it
      if (off.lengthSq() > 1e-12 || (floor && lowest(ARMS[sd]) < 0)) {
        solve();
        for (let pass = 0; floor && pass < 2; pass++) {
          const under = -lowest(ARMS[sd]);
          if (under <= 1e-3) break;
          tg.y += under;
          solve();
        }
      }
      // the elbow's side of the shoulder-hand line, in his chest's frame, for the next frame (see solve)
      b[`la${sd}`].getWorldPosition(el);
      handAt(sd, e1);
      u.copy(e1).sub(sh).normalize();
      e2.copy(el).sub(sh);
      e2.addScaledVector(u, -e2.dot(u));
      elbowNow[sd] = e2.lengthSq() > 1e-6 ? e2.normalize().applyQuaternion(b.chest.getWorldQuaternion(qc).invert()).clone() : null;
    }
    return p;
  });
  // A frame with no last frame (the first, or a cut, loop or seek: the source's hips jump, and what the last frame left is
  // stale) starts the memories afresh, then is solved again as if held until it stops changing: what a frame's memories
  // decide (which side legs crossed through each other stay on, the corrections held back) settled over 3-4 frames on
  // camera (a knee 54 to 77 degrees on a held frame)
  let hipsWas = null;
  const same = (a, c) => Object.keys(c).every((j) => j === "root"
    ? ["x", "y", "z", "rx", "ry", "rz"].every((r) => Math.abs((a.root[r] ?? 0) - (c.root[r] ?? 0)) < (r.length === 1 ? 1e-4 : 0.01))
    : c[j].every((x, i) => Math.abs(x - a[j][i]) < 0.01));
  const pose = (dt = 0) => {
    src.update();
    const hipsNow = src.at("hips").multiplyScalar(k);
    const fresh = !(dt > 0) || (hipsWas && hipsWas.distanceTo(hipsNow) > JUMP);
    hipsWas = hipsNow;
    if (!fresh) return solveFrame(dt);
    let p = solveFrame(0);
    for (let i = 0; i < SETTLE; i++) {
      const next = solveFrame(1);
      if (same(p, next)) return next;
      p = next;
    }
    return p;
  };

  // Call with the player posed by pose() at the origin and matrices updated
  const ang = (a, c) => Math.acos(THREE.MathUtils.clamp(a.clone().normalize().dot(c.clone().normalize()), -1, 1)) * D;
  const measure = () => {
    const dir = {};
    for (const sd of ["L", "R"]) {
      const S0 = pos(b[`ua${sd}`]), E0 = pos(b[`la${sd}`]), H0 = handAt(sd, new THREE.Vector3());
      dir[`upper arm ${sd}`] = ang(E0.clone().sub(S0), between(`shoulder${sd}`, `elbow${sd}`));
      dir[`forearm ${sd}`] = ang(H0.clone().sub(E0), between(`elbow${sd}`, `wrist${sd}`));
      const K = pos(b[`ul${sd}`]), N = pos(b[`ll${sd}`]), F = player.soleAt(sd, new THREE.Vector3());
      dir[`thigh ${sd}`] = ang(N.clone().sub(K), between(`hip${sd}`, `knee${sd}`));
      dir[`shin ${sd}`] = ang(F.clone().sub(N), between(`knee${sd}`, `ankle${sd}`));
    }
    const fwd = (key, restQ) => new THREE.Vector3(0, 0, 1).applyQuaternion(b[key].getWorldQuaternion(new THREE.Quaternion()).multiply(restQ));
    dir["head facing"] = ang(fwd("head", headRestQ), new THREE.Vector3(0, 0, 1).applyQuaternion(src.head()));
    dir["hips facing"] = ang(fwd("root", rootRestQ), new THREE.Vector3(0, 0, 1).applyQuaternion(frame(between("hips", "waist"), between("hipR", "hipL"))));
    dir["chest"] = ang(new THREE.Vector3(0, 1, 0).applyQuaternion(b.chest.getWorldQuaternion(new THREE.Quaternion()).multiply(chestRest)), between("waist", "neck"));
    const low = lowest(), sl = srcLowest(), want = k * Math.max(0, sl - DEAD), near = 1 - THREE.MathUtils.smoothstep(sl, 0.1, 0.3);
    const inside = {};
    for (const sd of ["L", "R"]) inside[`hand ${sd} in head/body/legs/floor`] = pushOut(handAt(sd, new THREE.Vector3()));
    const part = lowestPart;
    return { gap: { ...gap }, dir, low, part, armLow: Math.min(lowest(ARMS.L), lowest(ARMS.R)), headLow: lowest(["head"]), float: near * (low - want), inside, srcLow: srcLowest() };
  };
  // how deep a world point (a ball of radius r) is in any of the given joints' boxes (posed as now), for checks
  const depth = (p, keys, r) => Math.max(0, ...keys.filter((x) => body.box[x]).map((x) => -roundedBox(toRest(x, lp.copy(p)), body.box[x], r, grad)));
  return { pose, measure, depth, k, hand: (sd) => handAt(sd, new THREE.Vector3()) };
}
