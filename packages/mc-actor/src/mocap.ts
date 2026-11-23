// @ts-nocheck
import * as THREE from "three";

import { updaterTo } from "./matrices";

const ROLES = [
  "hips",
  "waist",
  "neck",
  ...["shoulder", "elbow", "wrist", "hip", "knee", "ankle", "toe"].flatMap((r) => [
    r + "L",
    r + "R",
  ]),
];
const D = 180 / Math.PI;
const SOFT = Math.sin(20 / D);

// A glTF skeleton posed by its own mixer. names: role -> bone name (GLTFLoader drops "." and ":")
export const UAL = {
  hips: "DEF-hips",
  waist: "DEF-spine002",
  neck: "DEF-neck",
  head: "DEF-head",
  shoulderL: "DEF-upper_armL",
  elbowL: "DEF-forearmL",
  wristL: "DEF-handL",
  shoulderR: "DEF-upper_armR",
  elbowR: "DEF-forearmR",
  wristR: "DEF-handR",
  hipL: "DEF-thighL",
  kneeL: "DEF-shinL",
  ankleL: "DEF-footL",
  toeL: "DEF-toeL",
  hipR: "DEF-thighR",
  kneeR: "DEF-shinR",
  ankleR: "DEF-footR",
  toeR: "DEF-toeR",
};
export const UE = {
  hips: "pelvis",
  waist: "spine_02",
  neck: "neck_01",
  head: "Head",
  shoulderL: "upperarm_l",
  elbowL: "lowerarm_l",
  wristL: "hand_l",
  shoulderR: "upperarm_r",
  elbowR: "lowerarm_r",
  wristR: "hand_r",
  hipL: "thigh_l",
  kneeL: "calf_l",
  ankleL: "foot_l",
  toeL: "ball_l",
  hipR: "thigh_r",
  kneeR: "calf_r",
  ankleR: "foot_r",
  toeR: "ball_r",
};
// Mixamo FBX (FBXLoader drops the ":" of "mixamorig:")
export const MIXAMO = {
  hips: "mixamorigHips",
  waist: "mixamorigSpine1",
  neck: "mixamorigNeck",
  head: "mixamorigHead",
  shoulderL: "mixamorigLeftArm",
  elbowL: "mixamorigLeftForeArm",
  wristL: "mixamorigLeftHand",
  shoulderR: "mixamorigRightArm",
  elbowR: "mixamorigRightForeArm",
  wristR: "mixamorigRightHand",
  hipL: "mixamorigLeftUpLeg",
  kneeL: "mixamorigLeftLeg",
  ankleL: "mixamorigLeftFoot",
  toeL: "mixamorigLeftToeBase",
  hipR: "mixamorigRightUpLeg",
  kneeR: "mixamorigRightLeg",
  ankleR: "mixamorigRightFoot",
  toeR: "mixamorigRightToeBase",
};
export function skeletonSource(root, names) {
  const bone = {};
  root.traverse((o) => {
    bone[o.name] = bone[o.name] ?? o;
  });
  for (const r of [...ROLES, "head"])
    if (!bone[names[r]]) throw new Error(`mocap source has no ${r} (${names[r]})`);
  root.updateMatrixWorld(true);
  const update = updaterTo(
    root,
    [...ROLES, "head"].map((r) => bone[names[r]]),
  );
  const headRest = bone[names.head].getWorldQuaternion(new THREE.Quaternion()).invert();
  const p = new THREE.Vector3(),
    s = new THREE.Vector3();
  const quatNow = (r, out = new THREE.Quaternion()) => {
    bone[names[r]].matrixWorld.decompose(p, out, s);
    return out;
  };
  return {
    update,
    at: (r, out = new THREE.Vector3()) => bone[names[r]].getWorldPosition(out),
    head: () => bone[names.head].getWorldQuaternion(new THREE.Quaternion()).multiply(headRest),
    quat: (r, out = new THREE.Quaternion()) => bone[names[r]].getWorldQuaternion(out),
    atNow: (r, out = new THREE.Vector3()) => out.setFromMatrixPosition(bone[names[r]].matrixWorld),
    headNow: () => quatNow("head").multiply(headRest),
    quatNow,
  };
}

export function bodyBoxes(player) {
  const keyOf = new Map(Object.entries(player.bones).map(([k, b]) => [b, k]));
  const box = {},
    v = new THREE.Vector3();
  player.rig.traverse((o) => {
    if (!o.isSkinnedMesh || /Layer2/.test(o.name)) return;
    const g = o.geometry,
      si = g.attributes.skinIndex,
      sw = g.attributes.skinWeight;
    for (let i = 0; i < g.attributes.position.count; i++) {
      let w = 0,
        bi = 0;
      for (let j = 0; j < 4; j++)
        if (sw.getComponent(i, j) > w) {
          w = sw.getComponent(i, j);
          bi = si.getComponent(i, j);
        }
      let bone = o.skeleton.bones[bi];
      while (bone && !keyOf.has(bone)) bone = bone.parent;
      if (!bone) continue;
      o.getVertexPosition(i, v);
      o.localToWorld(v);
      (box[keyOf.get(bone)] ??= new THREE.Box3()).expandByPoint(v);
    }
  });
  const rest = Object.fromEntries(
    Object.keys(box).map((k) => [k, player.bones[k].matrixWorld.clone()]),
  );
  return { box, rest };
}

const C = new THREE.Vector3(),
  Hh = new THREE.Vector3(),
  q = new THREE.Vector3(),
  mx = new THREE.Vector3();
function roundedBox(p, b, r, out) {
  b.getCenter(C);
  b.getSize(Hh).multiplyScalar(0.5);
  q.copy(p).sub(C);
  const sx = Math.sign(q.x) || 1,
    sy = Math.sign(q.y) || 1,
    sz = Math.sign(q.z) || 1;
  q.set(Math.abs(q.x) - Hh.x, Math.abs(q.y) - Hh.y, Math.abs(q.z) - Hh.z);
  mx.set(Math.max(q.x, 0), Math.max(q.y, 0), Math.max(q.z, 0));
  const outside = mx.length();
  if (outside > 1e-6) {
    out.set(mx.x * sx, mx.y * sy, mx.z * sz).divideScalar(outside);
    return outside - r;
  }
  const m = Math.max(q.x, q.y, q.z);
  out.set(
    m === q.x ? sx : 0,
    m === q.y && m !== q.x ? sy : 0,
    m === q.z && m !== q.x && m !== q.y ? sz : 0,
  );
  return m - r;
}

const PXM = 1.875 / 32;
const HAND = 2 * PXM;
const LEG_R = 1.9 * PXM;
const HEAD_TURN = 90 / D;
const TRAPPED = 0.12;
const JUMP = 0.3;
const SETTLE = 8;
const FIX_SPEED = 1;
const HEAD_SPEED = Math.PI;
const TWIST_SPEED = 2 * Math.PI;
const DEAD = 0.03;
const HAND_REACH = 0.1;
const CARRY = (sl, hl) =>
  THREE.MathUtils.smoothstep(sl - hl, 0.03, 0.35) * (1 - THREE.MathUtils.smoothstep(hl, 0.1, 0.3));
const REACH = {
  hips: 0.12,
  waist: 0.12,
  neck: 0.08,
  shoulderL: 0.07,
  shoulderR: 0.07,
  elbowL: 0.05,
  elbowR: 0.05,
  hipL: 0.1,
  hipR: 0.1,
  kneeL: 0.06,
  kneeR: 0.06,
  ankleL: 0.1,
  ankleR: 0.1,
  toeL: 0.035,
  toeR: 0.035,
};

const HALF_RAD = Math.PI / 360;
const slerpYXZDeg = (ax, ay, az, bx, by, bz, k) => {
  let qax, qay, qaz, qaw;
  if (ax === 0 && ay === 0 && az === 0) {
    qax = 0;
    qay = 0;
    qaz = 0;
    qaw = 1;
  } else {
    const x1 = ax * HALF_RAD,
      y1 = ay * HALF_RAD,
      z1 = az * HALF_RAD;
    const c1 = Math.cos(x1),
      c2 = Math.cos(y1),
      c3 = Math.cos(z1);
    const s1 = Math.sin(x1),
      s2 = Math.sin(y1),
      s3 = Math.sin(z1);
    qax = s1 * c2 * c3 + c1 * s2 * s3;
    qay = c1 * s2 * c3 - s1 * c2 * s3;
    qaz = c1 * c2 * s3 - s1 * s2 * c3;
    qaw = c1 * c2 * c3 + s1 * s2 * s3;
  }
  let rx = qax,
    ry = qay,
    rz = qaz,
    rw = qaw;
  if (k !== 0) {
    let qbx, qby, qbz, qbw;
    if (bx === 0 && by === 0 && bz === 0) {
      qbx = 0;
      qby = 0;
      qbz = 0;
      qbw = 1;
    } else {
      const x2 = bx * HALF_RAD,
        y2 = by * HALF_RAD,
        z2 = bz * HALF_RAD;
      const c1 = Math.cos(x2),
        c2 = Math.cos(y2),
        c3 = Math.cos(z2);
      const s1 = Math.sin(x2),
        s2 = Math.sin(y2),
        s3 = Math.sin(z2);
      qbx = s1 * c2 * c3 + c1 * s2 * s3;
      qby = c1 * s2 * c3 - s1 * c2 * s3;
      qbz = c1 * c2 * s3 - s1 * s2 * c3;
      qbw = c1 * c2 * c3 + s1 * s2 * s3;
    }
    if (k === 1) {
      rx = qbx;
      ry = qby;
      rz = qbz;
      rw = qbw;
    } else {
      let cosHalf = rw * qbw + rx * qbx + ry * qby + rz * qbz;
      if (cosHalf < 0) {
        qbx = -qbx;
        qby = -qby;
        qbz = -qbz;
        qbw = -qbw;
        cosHalf = -cosHalf;
      }
      if (cosHalf < 1.0) {
        const sqrSin = 1.0 - cosHalf * cosHalf;
        if (sqrSin <= Number.EPSILON) {
          const s = 1 - k;
          rw = s * rw + k * qbw;
          rx = s * rx + k * qbx;
          ry = s * ry + k * qby;
          rz = s * rz + k * qbz;
          const invLen = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw);
          rx *= invLen;
          ry *= invLen;
          rz *= invLen;
          rw *= invLen;
        } else {
          const sinHalf = Math.sqrt(sqrSin);
          const halfTheta = Math.atan2(sinHalf, cosHalf);
          const ra = Math.sin((1 - k) * halfTheta) / sinHalf;
          const rb = Math.sin(k * halfTheta) / sinHalf;
          rw = rw * ra + qbw * rb;
          rx = rx * ra + qbx * rb;
          ry = ry * ra + qby * rb;
          rz = rz * ra + qbz * rb;
        }
      }
    }
  }
  const x2 = rx + rx,
    y2 = ry + ry,
    z2 = rz + rz;
  const xx = rx * x2,
    xy = rx * y2,
    xz = rx * z2;
  const yy = ry * y2,
    yz = ry * z2,
    zz = rz * z2;
  const wx = rw * x2,
    wy = rw * y2,
    wz = rw * z2;
  const m23 = yz - wx;
  const clamped = m23 < -1 ? -1 : m23 > 1 ? 1 : m23;
  const ex = Math.asin(-clamped);
  let ey, ez;
  if (Math.abs(m23) < 0.9999999) {
    ey = Math.atan2(xz + wy, 1 - (xx + yy));
    ez = Math.atan2(xy + wz, 1 - (xx + zz));
  } else {
    ey = Math.atan2(-(xz - wy), 1 - (yy + zz));
    ez = 0;
  }
  return [ex * D, ey * D, ez * D];
};
export function slerpPose(a, b, k) {
  const out = {};
  for (const j in a) {
    if (j === "root") continue;
    const va = a[j],
      vb = b[j];
    out[j] = slerpYXZDeg(
      va[0] ?? 0,
      va[1] ?? 0,
      va[2] ?? 0,
      vb ? (vb[0] ?? 0) : 0,
      vb ? (vb[1] ?? 0) : 0,
      vb ? (vb[2] ?? 0) : 0,
      k,
    );
  }
  for (const j in b) {
    if (j === "root" || j in a) continue;
    const vb = b[j];
    out[j] = slerpYXZDeg(0, 0, 0, vb[0] ?? 0, vb[1] ?? 0, vb[2] ?? 0, k);
  }
  const ra = a.root,
    rb = b.root;
  const rr = slerpYXZDeg(
    ra?.rx ?? 0,
    ra?.ry ?? 0,
    ra?.rz ?? 0,
    rb?.rx ?? 0,
    rb?.ry ?? 0,
    rb?.rz ?? 0,
    k,
  );
  const ax = ra?.x ?? 0,
    ay = ra?.y ?? 0,
    az = ra?.z ?? 0;
  out.root = {
    rx: rr[0],
    ry: rr[1],
    rz: rr[2],
    x: ax + ((rb?.x ?? 0) - ax) * k,
    y: ay + ((rb?.y ?? 0) - ay) * k,
    z: az + ((rb?.z ?? 0) - az) * k,
  };
  return out;
}

export function bakeClip(rt, setTime, duration, fps = 60) {
  const n = Math.max(1, Math.ceil(duration * fps)),
    frames = [];
  for (let i = 0; i <= n; i++) {
    setTime(Math.min(duration - 1e-4, i / fps));
    frames.push(rt.pose(i ? 1 / fps : 0));
  }
  return { frames, fps, at: framesAt(frames, fps) };
}

export function framesAt(frames, fps) {
  const n = frames.length - 1;
  return (t) => {
    const x = THREE.MathUtils.clamp(t * fps, 0, n),
      i = Math.min(Math.floor(x), n - 1);
    return slerpPose(frames[i], frames[i + 1], x - i);
  };
}

const playerBoxes = new WeakMap();

export function retargeter(src, player, { floor = true, own = true } = {}) {
  let bonesVer = 0;
  const atOrigin = (fn) => {
    bonesVer++;
    const parent0 = player.g.parent,
      p0 = player.g.position.clone(),
      q0 = player.g.quaternion.clone(),
      s0 = player.g.scale.clone(),
      rs0 = player.rig?.scale.clone();
    player.g.parent = null;
    player.g.position.set(0, 0, 0);
    player.g.quaternion.identity();
    player.g.scale.set(1, 1, 1);
    player.rig?.scale.set(1, 1, 1);
    try {
      return fn();
    } finally {
      player.g.parent = parent0;
      player.g.position.copy(p0);
      player.g.quaternion.copy(q0);
      player.g.scale.copy(s0);
      if (rs0) player.rig.scale.copy(rs0);
    }
  };
  src.update();
  const hip0 = src.atNow("hips");
  const srcLeg =
    src.atNow("hipL").distanceTo(src.atNow("kneeL")) +
    src.atNow("kneeL").distanceTo(src.atNow("ankleL"));
  const k = (player.restLegReach ?? player.legReach) / srcLeg;
  const along = (a, c) => Math.abs(src.atNow(c).sub(src.atNow(a)).normalize().z);
  if (
    src.atNow("neck").y - hip0.y < 0.3 * srcLeg ||
    ["L", "R"].some(
      (sd) => along(`shoulder${sd}`, `elbow${sd}`) > 0.7 || along(`hip${sd}`, `knee${sd}`) > 0.7,
    )
  )
    throw new Error(
      "mocap source is not at an upright rest facing +z: build it before its mixer runs",
    );

  const b = player.bones,
    pos = (x) => new THREE.Vector3().setFromMatrixPosition(x.matrixWorld),
    wp = new THREE.Vector3(),
    ws = new THREE.Vector3(),
    worldQ = (x, out) => {
      x.matrixWorld.decompose(wp, out, ws);
      return out;
    };
  const a0 = {},
    chestRest = new THREE.Quaternion(),
    headRestQ = new THREE.Quaternion(),
    rootRestQ = new THREE.Quaternion(),
    body = atOrigin(() => {
      player.setPose({});
      player.g.updateMatrixWorld(true);
      for (const sd of ["L", "R"]) {
        a0[`ua${sd}`] = pos(b[`la${sd}`])
          .sub(pos(b[`ua${sd}`]))
          .normalize();
        a0[`ul${sd}`] = pos(b[`ll${sd}`])
          .sub(pos(b[`ul${sd}`]))
          .normalize();
      }
      chestRest.copy(b.chest.getWorldQuaternion(new THREE.Quaternion())).invert();
      headRestQ.copy(b.head.getWorldQuaternion(new THREE.Quaternion())).invert();
      rootRestQ.copy(b.root.getWorldQuaternion(new THREE.Quaternion())).invert();
      return (
        playerBoxes.get(player) ?? ((bx) => (playerBoxes.set(player, bx), bx))(bodyBoxes(player))
      );
    });
  const handRest = Object.fromEntries(
    ["L", "R"].map((sd) => {
      const bx = body.box[`la${sd}`];
      return [
        sd,
        new THREE.Vector3((bx.min.x + bx.max.x) / 2, bx.min.y + HAND, (bx.min.z + bx.max.z) / 2),
      ];
    }),
  );
  const OBSTACLES = ["head", "body", "chest", "ulL", "ulR", "llL", "llR"].filter(
    (x) => body.box[x],
  );
  const footRest = Object.fromEntries(
    ["L", "R"].map((sd) => {
      const bx = body.box[`ll${sd}`];
      return [
        sd,
        new THREE.Vector3((bx.min.x + bx.max.x) / 2, bx.min.y + LEG_R, (bx.min.z + bx.max.z) / 2),
      ];
    }),
  );

  const e = new THREE.Euler(),
    eulerNow = {};
  let eulerWas = {};
  const wrap180 = (x) => THREE.MathUtils.euclideanModulo(x + 180, 360) - 180;
  const deg = (q, key) => {
    e.setFromQuaternion(q, "YXZ");
    let x = e.x * D,
      y = e.y * D,
      z = e.z * D;
    const was = key && eulerWas[key];
    if (was) {
      const w0 = was[0],
        w1 = was[1],
        w2 = was[2];
      const ax = wrap180(180 - x),
        ay = wrap180(y + 180),
        az = wrap180(z + 180);
      const cOut =
        Math.abs(wrap180(x - w0)) + Math.abs(wrap180(y - w1)) + Math.abs(wrap180(z - w2));
      const cAlt =
        Math.abs(wrap180(ax - w0)) + Math.abs(wrap180(ay - w1)) + Math.abs(wrap180(az - w2));
      if (cAlt < cOut) {
        x = ax;
        y = ay;
        z = az;
      }
      x = w0 + wrap180(x - w0);
      y = w1 + wrap180(y - w1);
      z = w2 + wrap180(z - w2);
    }
    const out = [x, y, z];
    if (key) eulerNow[key] = out;
    return out;
  };
  const d1 = new THREE.Vector3(),
    d2 = new THREE.Vector3(),
    v = new THREE.Vector3(),
    perp = new THREE.Vector3(),
    b0 = new THREE.Vector3();
  const S = new THREE.Quaternion(),
    T = new THREE.Quaternion(),
    Pi = new THREE.Quaternion();
  const bx = new THREE.Vector3(),
    by = new THREE.Vector3(),
    bz = new THREE.Vector3(),
    M = new THREE.Matrix4(),
    M2 = new THREE.Matrix4();
  const frame = (up, side) => {
    by.copy(up).normalize();
    bx.copy(side).addScaledVector(by, -side.dot(by)).normalize();
    bz.crossVectors(bx, by);
    return new THREE.Quaternion().setFromRotationMatrix(M.makeBasis(bx, by, bz));
  };
  const between = (r1, r2) => src.atNow(r2).sub(src.atNow(r1));

  const restQ = Object.fromEntries(
    ["shoulderL", "shoulderR", "hipL", "hipR"].map((r) => [r, src.quatNow(r).invert()]),
  );
  const hinge = (r, fold) =>
    new THREE.Vector3(0, 0, fold).applyQuaternion(restQ[r]).applyQuaternion(src.quatNow(r));
  const wrap = (x) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
  const c = new THREE.Vector3(),
    hv = new THREE.Vector3();
  const phiOf = (x, a) => {
    x.addScaledVector(a, -x.dot(a));
    return x.lengthSq() < 1e-8 ? null : Math.atan2(c.crossVectors(b0, x).dot(a), b0.dot(x));
  };
  const gap = {},
    twistNow = {};
  let twistWas = {},
    frameDt = 0;
  const limb = (pose, u, l, w1, w2, hw, P, fold, fixed = false) => {
    Pi.copy(P).invert();
    d1.copy(w1).applyQuaternion(Pi).normalize();
    d2.copy(w2).applyQuaternion(Pi).normalize();
    const a = a0[u];
    S.setFromUnitVectors(a, d1);
    T.copy(S).invert();
    v.copy(d2).applyQuaternion(T);
    const bend = Math.acos(THREE.MathUtils.clamp(v.dot(a), -1, 1));
    perp.copy(v).addScaledVector(a, -v.dot(a));
    const n = perp.length();
    b0.set(0, 0, fold)
      .addScaledVector(a, -fold * a.z)
      .normalize();
    const straight = phiOf(hv.copy(hw).applyQuaternion(Pi).applyQuaternion(T), a) ?? 0;
    const own = n > 1e-6 ? phiOf(perp, a) : straight;
    if (bend > 40 / D) gap[u] = Math.abs(wrap(own - straight)) * D;
    // played in order, the plane leaves the bone's no faster than TWIST_SPEED: a mocap elbow is no clean hinge, and its
    // plane can swing 47 degrees round the upper arm in a frame (the whole box arm spun with it)
    // (n shrinks again past 90 degrees of bend, and a knee folded flat is the most bent of all)
    let off =
      wrap(own - straight) * THREE.MathUtils.smoothstep(bend > Math.PI / 2 ? 1 : n, 0, SOFT);
    const key = fixed ? u + "+" : u;
    if (frameDt > 0 && key in twistWas)
      off =
        twistWas[key] +
        THREE.MathUtils.clamp(
          wrap(off - twistWas[key]),
          -TWIST_SPEED * frameDt,
          TWIST_SPEED * frameDt,
        );
    twistNow[key] = off;
    if (!fixed) twistNow[u + "+"] = off;
    const phi = straight + off;
    T.setFromAxisAngle(a, phi);
    S.multiply(T);
    pose[u] = deg(S, u);
    pose[l] = [-fold * bend * D, 0, 0];
  };

  const corner = new THREE.Vector3(),
    lowPoint = new THREE.Vector3();
  const ARMS = { L: ["uaL", "laL"], R: ["uaR", "laR"] };
  const TRUNK = Object.keys(body.box).filter((x) => x !== "head" && !x.startsWith("la"));
  const restInv = Object.fromEntries(
    Object.entries(body.rest).map(([key, m]) => [key, m.clone().invert()]),
  );
  let lowestPart = "";
  const lowest = (keys = TRUNK) => {
    let y = Infinity;
    for (const key of keys) {
      const bxx = body.box[key];
      M.copy(b[key].matrixWorld).multiply(restInv[key]);
      for (let i = 0; i < 8; i++) {
        corner
          .set(
            i & 1 ? bxx.max.x : bxx.min.x,
            i & 2 ? bxx.max.y : bxx.min.y,
            i & 4 ? bxx.max.z : bxx.min.z,
          )
          .applyMatrix4(M);
        if (corner.y < y) {
          y = corner.y;
          lowestPart = key;
          lowPoint.copy(corner);
        }
      }
    }
    return y;
  };
  const srcLowest = () =>
    Math.min(...Object.entries(REACH).map(([r, f]) => src.atNow(r).y - f * srcLeg));
  const srcHandLow = () =>
    Math.min(src.atNow("wristL").y, src.atNow("wristR").y) - HAND_REACH * srcLeg;
  const toMats = {},
    fromMats = {};
  const toMat = (key) => {
    let entry = toMats[key];
    if (!entry) entry = toMats[key] = { ver: -1, m: new THREE.Matrix4() };
    if (entry.ver !== bonesVer) {
      entry.ver = bonesVer;
      entry.m.copy(body.rest[key]).multiply(M2.copy(b[key].matrixWorld).invert());
    }
    return entry.m;
  };
  const fromMat = (key) => {
    let entry = fromMats[key];
    if (!entry) entry = fromMats[key] = { ver: -1, m: new THREE.Matrix4() };
    if (entry.ver !== bonesVer) {
      entry.ver = bonesVer;
      entry.m.copy(b[key].matrixWorld).multiply(restInv[key]);
    }
    return entry.m;
  };
  const toRest = (key, p) => p.applyMatrix4(toMat(key));
  const fromRest = (key, p) => p.applyMatrix4(fromMat(key));
  const handAt = (sd, out) => fromRest(`la${sd}`, out.copy(handRest[sd]));
  const footAt = (sd, out) => fromRest(`ll${sd}`, out.copy(footRest[sd]));
  const ab = new THREE.Vector3(),
    cd = new THREE.Vector3(),
    ac = new THREE.Vector3();
  const closest = (a0, a1, b0, b1) => {
    ab.subVectors(a1, a0);
    cd.subVectors(b1, b0);
    ac.subVectors(a0, b0);
    const A = ab.dot(ab),
      B = ab.dot(cd),
      Cc = cd.dot(cd),
      Dd = ab.dot(ac),
      E = cd.dot(ac),
      den = A * Cc - B * B;
    let s = den > 1e-9 ? THREE.MathUtils.clamp((B * E - Cc * Dd) / den, 0, 1) : 0;
    let t = THREE.MathUtils.clamp((B * s + E) / Cc, 0, 1);
    s = THREE.MathUtils.clamp((B * t - Dd) / A, 0, 1);
    return [s, t];
  };
  const grad = new THREE.Vector3(),
    lp = new THREE.Vector3();
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
      if (floor && p.y < HAND) {
        deepest = Math.max(deepest, HAND - p.y);
        p.y = HAND;
        moved = true;
      }
      if (!moved) break;
    }
    return deepest;
  };

  const fix = { L: new THREE.Vector3(), R: new THREE.Vector3() },
    last = { L: null, R: null },
    lastHand = { L: null, R: null },
    lastHead = { fix: null, src: null },
    legSide = {},
    legLast = { L: null, R: null },
    mx2 = new THREE.Vector3();
  let Qchest = new THREE.Quaternion();
  const sh = new THREE.Vector3(),
    el = new THREE.Vector3(),
    hd = new THREE.Vector3(),
    tg = new THREE.Vector3(),
    u = new THREE.Vector3(),
    pole = new THREE.Vector3(),
    e1 = new THREE.Vector3(),
    e2 = new THREE.Vector3(),
    qc = new THREE.Quaternion(),
    hR = new THREE.Vector3(),
    tR = new THREE.Vector3();
  let elbowWas = {};
  const elbowNow = {};
  const solveFrame = (dt) =>
    atOrigin(() => {
      for (const x in gap) delete gap[x];
      frameDt = dt;
      twistWas = dt > 0 ? { ...twistNow } : {};
      eulerWas = dt > 0 ? { ...eulerNow } : {};
      elbowWas = dt > 0 ? { ...elbowNow } : {};
      const Qroot = frame(between("hips", "waist"), between("hipR", "hipL"));
      Qchest = frame(between("waist", "neck"), between("shoulderR", "shoulderL"));
      const Qhead = src.headNow();
      const rel = (parent, q) => new THREE.Quaternion().copy(parent).invert().multiply(q);
      const [rx, ry, rz] = deg(Qroot, "root");
      const h = src.atNow("hips").sub(hip0).multiplyScalar(k);
      const p = {
        root: { x: h.x, y: h.y, z: h.z, rx, ry, rz },
        chest: deg(rel(Qroot, Qchest), "chest"),
        head: deg(rel(Qchest, Qhead), "head"),
      };
      for (const sd of ["L", "R"]) {
        limb(
          p,
          `ua${sd}`,
          `la${sd}`,
          between(`shoulder${sd}`, `elbow${sd}`),
          between(`elbow${sd}`, `wrist${sd}`),
          hinge(`shoulder${sd}`, 1),
          Qchest,
          1,
        );
        limb(
          p,
          `ul${sd}`,
          `ll${sd}`,
          between(`hip${sd}`, `knee${sd}`),
          between(`knee${sd}`, `ankle${sd}`),
          hinge(`hip${sd}`, -1),
          Qroot,
          -1,
        );
      }
      let placed = null;
      const samePlaced = () => {
        if (!placed) return false;
        let i = 0;
        for (const k in p) {
          const a = p[k];
          if (k === "root") {
            if (
              placed[i++] !== k ||
              placed[i++] !== a.x ||
              placed[i++] !== a.y ||
              placed[i++] !== a.z ||
              placed[i++] !== a.rx ||
              placed[i++] !== a.ry ||
              placed[i++] !== a.rz
            )
              return false;
          } else if (
            placed[i++] !== k ||
            placed[i++] !== a[0] ||
            placed[i++] !== a[1] ||
            placed[i++] !== a[2]
          )
            return false;
        }
        return i === placed.length;
      };
      const place = () => {
        if (samePlaced()) return;
        const next = [];
        for (const k in p) {
          const a = p[k];
          if (k === "root") next.push(k, a.x, a.y, a.z, a.rx, a.ry, a.rz);
          else next.push(k, a[0], a[1], a[2]);
        }
        placed = next;
        player.setPose(p);
        player.updateBones();
        bonesVer++;
      };
      if (own) {
        place();
        const L = {},
          sideNow = {};
        for (const sd of ["L", "R"]) {
          const H = pos(b[`ul${sd}`]),
            K = pos(b[`ll${sd}`]),
            F = footAt(sd, new THREE.Vector3());
          L[sd] = {
            H,
            K,
            F,
            K0: K.clone(),
            F0: F.clone(),
            l1: H.distanceTo(K),
            l2: K.distanceTo(F),
            moved: false,
          };
        }
        const pa = new THREE.Vector3(),
          pb = new THREE.Vector3(),
          nrm = new THREE.Vector3();
        const shift = (leg, shin, s, by) => {
          if (shin) {
            leg.K.addScaledVector(by, 1 - s);
            leg.F.addScaledVector(by, s);
          } else {
            leg.K.addScaledVector(by, 1 / Math.max(s, 0.3));
            leg.F.addScaledVector(by, 1 / Math.max(s, 0.3));
          }
          leg.moved = true;
        };
        for (let pass = 0; pass < 3; pass++) {
          let hit = false;
          for (const [sl, sr] of [
            [0, 0],
            [0, 1],
            [1, 0],
            [1, 1],
          ]) {
            const a0 = sl ? L.L.K : L.L.H,
              a1 = sl ? L.L.F : L.L.K,
              c0 = sr ? L.R.K : L.R.H,
              c1 = sr ? L.R.F : L.R.K;
            const [s1, t1] = closest(a0, a1, c0, c1);
            pa.lerpVectors(a0, a1, s1);
            pb.lerpVectors(c0, c1, t1);
            const dd = pa.distanceTo(pb);
            if (dd >= 2 * LEG_R) continue;
            nrm.subVectors(pa, pb);
            if (nrm.lengthSq() < 1e-10) nrm.set(1, 0, 0).applyQuaternion(Qroot);
            else nrm.normalize();
            // played in order, a pair stays on the side it met on: legs that pass through each other in the source flipped
            // the push to the far side the moment their middles crossed (a knee 25 cm in a frame)
            const pair = `${sl}${sr}`;
            let need = 2 * LEG_R - dd;
            if (dt > 0 && legSide[pair] && nrm.dot(legSide[pair]) < 0) {
              nrm.negate();
              need = 2 * LEG_R + dd;
            }
            (sideNow[pair] ??= new THREE.Vector3()).copy(nrm);
            const wl = 0.5 + 0.5 * nrm.y;
            shift(L.L, sl, s1, v.copy(nrm).multiplyScalar(need * wl));
            shift(L.R, sr, t1, v.copy(nrm).multiplyScalar(-need * (1 - wl)));
            hit = true;
          }
          for (const sd of ["L", "R"])
            for (const key of ["K", "F"]) {
              const at = L[sd][key];
              for (const box of ["body", "chest"]) {
                if (!body.box[box]) continue;
                toRest(box, lp.copy(at));
                const dist = roundedBox(lp, body.box[box], LEG_R, grad);
                if (dist >= 0) continue;
                lp.addScaledVector(grad, -dist);
                fromRest(box, lp);
                v.subVectors(lp, at);
                if (key === "K") {
                  at.add(v);
                  L[sd].F.add(v);
                } else at.add(v);
                L[sd].moved = hit = true;
              }
            }
          for (const sd of ["L", "R"]) {
            const g = L[sd];
            g.K.sub(g.H).setLength(g.l1).add(g.H);
            g.F.sub(g.K).setLength(g.l2).add(g.K);
          }
          if (!hit) break;
        }
        for (const x in legSide) delete legSide[x];
        Object.assign(legSide, sideNow);
        for (const sd of ["L", "R"]) {
          const g = L[sd],
            was = legLast[sd];
          for (const x of ["H", "K", "F", "K0", "F0"]) toRest("body", g[x]);
          if (dt > 0 && was) {
            for (const [key, k0] of [
              ["K", "K0"],
              ["F", "F0"],
            ]) {
              const off = mx2.copy(g[key]).sub(g[k0]),
                step = off.sub(was[key]),
                max = FIX_SPEED * dt + g[k0].distanceTo(was[k0]);
              if (step.length() > max) {
                g[key].copy(g[k0]).add(was[key]).add(step.setLength(max));
                g.moved = true;
              }
            }
            g.K.sub(g.H).setLength(g.l1).add(g.H);
            g.F.sub(g.K).setLength(g.l2).add(g.K);
          }
          legLast[sd] = {
            K: g.K.clone().sub(g.K0),
            F: g.F.clone().sub(g.F0),
            K0: g.K0.clone(),
            F0: g.F0.clone(),
          };
          for (const x of ["H", "K", "F"]) fromRest("body", g[x]);
        }
        for (const sd of ["L", "R"])
          if (L[sd].moved)
            limb(
              p,
              `ul${sd}`,
              `ll${sd}`,
              d1.copy(L[sd].K).sub(L[sd].H),
              d2.copy(L[sd].F).sub(L[sd].K),
              hinge(`hip${sd}`, -1),
              Qroot,
              -1,
              true,
            );
      }
      place();
      const sl = srcLowest(),
        near = 1 - THREE.MathUtils.smoothstep(sl, 0.1, 0.3);
      if (floor) p.root.y += near * (k * Math.max(0, sl - DEAD) - lowest());
      const hl = srcHandLow(),
        carry = CARRY(sl, hl);
      if (floor && carry > 0) {
        place();
        p.root.y += carry * Math.max(0, k * Math.max(0, hl - DEAD) - lowest(["laL", "laR"]));
      }
      if (floor) {
        let Qh = Qhead.clone();
        const cap =
          HEAD_TURN *
          (1 - THREE.MathUtils.smoothstep(-v.set(0, 1, 0).applyQuaternion(Qchest).y, 0.5, 0.85));
        for (let pass = 0, turned = 0; pass < 3; pass++) {
          place();
          if (lowest(["head"]) >= 0) break;
          sh.setFromMatrixPosition(b.head.matrixWorld);
          u.copy(lowPoint).sub(sh);
          const ry = u.y,
            A = Math.hypot(u.x, u.z);
          if (A < 1e-4) break;
          pole
            .set(u.x, 0, u.z)
            .cross(by.set(0, 1, 0))
            .normalize();
          const Rm = Math.hypot(A, ry),
            want = THREE.MathUtils.clamp(-sh.y / Rm, -1, 1);
          const th = Math.min(Math.asin(want) - Math.atan2(ry, A), cap - turned);
          if (th <= 1e-5) break;
          turned += th;
          Qh = new THREE.Quaternion().setFromAxisAngle(pole, th).multiply(Qh);
          p.head = deg(rel(Qchest, Qh), "head");
        }
        const fixQ = Qh.clone().multiply(T.copy(Qhead).invert());
        if (dt > 0 && lastHead.fix) {
          const max = HEAD_SPEED * dt + Qhead.angleTo(lastHead.src),
            ang = fixQ.angleTo(lastHead.fix);
          if (ang > max) {
            const want = fixQ.clone();
            fixQ.copy(lastHead.fix).slerp(want, max / ang);
            Qh.copy(fixQ).multiply(Qhead);
            p.head = deg(rel(Qchest, Qh), "head");
          }
        }
        lastHead.fix = fixQ;
        lastHead.src = Qhead.clone();
        place();
        // (held back, the rest lifts the body at once: a lift held back too let the head 26 cm into the floor in a tackle)
        p.root.y += Math.max(0, -lowest(["head"]));
      }
      place();
      for (const sd of own || floor ? ["L", "R"] : []) {
        handAt(sd, hd);
        tg.copy(hd);
        const depth = own ? pushOut(tg, false) : 0;
        tg.lerp(hd, THREE.MathUtils.smoothstep(depth, TRAPPED, TRAPPED + 0.1));
        sh.setFromMatrixPosition(b[`ua${sd}`].matrixWorld);
        el.setFromMatrixPosition(b[`la${sd}`].matrixWorld);
        const L1 = sh.distanceTo(el),
          L2 = el.distanceTo(hd);
        // the elbow folds in the plane it has, and a straight arm in the one its upper bone's roll gives (see hinge): a
        // fixed fallback flipped a straight arm meeting the floor 95 degrees in a frame. The pole is where the elbow goes,
        // the opposite side of the shoulder-hand line from where the forearm folds
        u.copy(hd).sub(sh).normalize();
        pole.copy(el).sub(sh).addScaledVector(u, -u.dot(pole));
        pole.addScaledVector(
          hinge(`shoulder${sd}`, 1),
          -0.3 * L1 * (1 - THREE.MathUtils.smoothstep(pole.length() / L1, 0.05, 0.3)),
        );
        const solve = () => {
          const dist = THREE.MathUtils.clamp(
            tg.distanceTo(sh),
            Math.abs(L1 - L2) + 1e-4,
            L1 + L2 - 1e-4,
          );
          u.copy(tg).sub(sh).normalize();
          v.copy(pole).addScaledVector(u, -pole.dot(u));
          const clear = v.length() / Math.max(pole.length(), 1e-6);
          if (v.lengthSq() < 1e-8) {
            v.copy(hinge(`shoulder${sd}`, 1)).negate();
            v.addScaledVector(u, -v.dot(u));
          }
          v.normalize();
          // a hand lifted off the floor can land on the line the pole points along, where the elbow's side is undecided and
          // flipped 150 degrees in a frame (a fall planting a hand): played in order, the elbow then keeps last frame's side
          const w = 1 - THREE.MathUtils.smoothstep(clear, 0.15, 0.4);
          if (w > 0 && elbowWas[sd]) {
            e2.copy(elbowWas[sd]).applyQuaternion(worldQ(b.chest, qc));
            e2.addScaledVector(u, -e2.dot(u));
            if (e2.lengthSq() > 1e-6) v.lerp(e2.normalize(), w).normalize();
          }
          const cosA = THREE.MathUtils.clamp(
            (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist),
            -1,
            1,
          );
          el.copy(sh)
            .addScaledVector(u, L1 * cosA)
            .addScaledVector(v, L1 * Math.sqrt(1 - cosA * cosA));
          limb(
            p,
            `ua${sd}`,
            `la${sd}`,
            d1.copy(el).sub(sh),
            d2.copy(tg).sub(el),
            hinge(`shoulder${sd}`, 1),
            Qchest,
            1,
            true,
          );
          place();
        };
        const hdR = toRest("chest", hR.copy(hd)),
          off = fix[sd].copy(toRest("chest", tR.copy(tg))).sub(hdR);
        if (dt > 0 && last[sd]) {
          const n = e1.copy(last[sd].lengthSq() > 1e-6 ? last[sd] : off);
          if (n.lengthSq() > 1e-10) n.normalize();
          const was = last[sd].length(),
            now = off.dot(n),
            carried = was - mx2.copy(hdR).sub(lastHand[sd]).dot(n);
          const follow = n.multiplyScalar(
            now >= was ? now : THREE.MathUtils.clamp(carried, Math.max(0, now), was),
          );
          const step = mx2.copy(off).sub(follow),
            max = FIX_SPEED * dt;
          if (step.length() > max) {
            off.copy(follow).add(step.setLength(max));
            fromRest("chest", tg.copy(hdR).add(off));
          }
        }
        (last[sd] ??= new THREE.Vector3()).copy(off);
        (lastHand[sd] ??= new THREE.Vector3()).copy(hdR);
        if (off.lengthSq() > 1e-12 || (floor && lowest(ARMS[sd]) < 0)) {
          solve();
          for (let pass = 0; floor && pass < 2; pass++) {
            const under = -lowest(ARMS[sd]);
            if (under <= 1e-3) break;
            tg.y += under;
            solve();
          }
        }
        el.setFromMatrixPosition(b[`la${sd}`].matrixWorld);
        handAt(sd, e1);
        u.copy(e1).sub(sh).normalize();
        e2.copy(el).sub(sh);
        e2.addScaledVector(u, -e2.dot(u));
        elbowNow[sd] =
          e2.lengthSq() > 1e-6
            ? e2.normalize().applyQuaternion(worldQ(b.chest, qc).invert()).clone()
            : null;
      }
      return p;
    });
  let hipsWas = null;
  const same = (a, c) =>
    Object.keys(c).every((j) =>
      j === "root"
        ? ["x", "y", "z", "rx", "ry", "rz"].every(
            (r) => Math.abs((a.root[r] ?? 0) - (c.root[r] ?? 0)) < (r.length === 1 ? 1e-4 : 0.01),
          )
        : c[j].every((x, i) => Math.abs(x - a[j][i]) < 0.01),
    );
  const pose = (dt = 0) => {
    src.update();
    const hipsNow = src.atNow("hips").multiplyScalar(k);
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

  const ang = (a, c) =>
    Math.acos(THREE.MathUtils.clamp(a.clone().normalize().dot(c.clone().normalize()), -1, 1)) * D;
  const measure = () => {
    bonesVer++;
    src.update();
    const dir = {};
    for (const sd of ["L", "R"]) {
      const S0 = pos(b[`ua${sd}`]),
        E0 = pos(b[`la${sd}`]),
        H0 = handAt(sd, new THREE.Vector3());
      dir[`upper arm ${sd}`] = ang(E0.clone().sub(S0), between(`shoulder${sd}`, `elbow${sd}`));
      dir[`forearm ${sd}`] = ang(H0.clone().sub(E0), between(`elbow${sd}`, `wrist${sd}`));
      const K = pos(b[`ul${sd}`]),
        N = pos(b[`ll${sd}`]),
        F = player.soleAt(sd, new THREE.Vector3());
      dir[`thigh ${sd}`] = ang(N.clone().sub(K), between(`hip${sd}`, `knee${sd}`));
      dir[`shin ${sd}`] = ang(F.clone().sub(N), between(`knee${sd}`, `ankle${sd}`));
    }
    const fwd = (key, restQ) =>
      new THREE.Vector3(0, 0, 1).applyQuaternion(
        b[key].getWorldQuaternion(new THREE.Quaternion()).multiply(restQ),
      );
    dir["head facing"] = ang(
      fwd("head", headRestQ),
      new THREE.Vector3(0, 0, 1).applyQuaternion(src.headNow()),
    );
    dir["hips facing"] = ang(
      fwd("root", rootRestQ),
      new THREE.Vector3(0, 0, 1).applyQuaternion(
        frame(between("hips", "waist"), between("hipR", "hipL")),
      ),
    );
    dir["chest"] = ang(
      new THREE.Vector3(0, 1, 0).applyQuaternion(
        b.chest.getWorldQuaternion(new THREE.Quaternion()).multiply(chestRest),
      ),
      between("waist", "neck"),
    );
    const low = lowest(),
      sl = srcLowest(),
      want = k * Math.max(0, sl - DEAD);
    const near = (1 - THREE.MathUtils.smoothstep(sl, 0.1, 0.3)) * (1 - CARRY(sl, srcHandLow()));
    const inside = {};
    for (const sd of ["L", "R"])
      inside[`hand ${sd} in head/body/legs/floor`] = pushOut(handAt(sd, new THREE.Vector3()));
    const part = lowestPart;
    return {
      gap: { ...gap },
      dir,
      low,
      part,
      armLow: Math.min(lowest(ARMS.L), lowest(ARMS.R)),
      headLow: lowest(["head"]),
      float: near * (low - want),
      inside,
      srcLow: srcLowest(),
    };
  };
  const depth = (p, keys, r) => {
    bonesVer++;
    return Math.max(
      0,
      ...keys
        .filter((x) => body.box[x])
        .map((x) => -roundedBox(toRest(x, lp.copy(p)), body.box[x], r, grad)),
    );
  };
  return {
    pose,
    measure,
    depth,
    k,
    hand: (sd) => {
      bonesVer++;
      return handAt(sd, new THREE.Vector3());
    },
  };
}
