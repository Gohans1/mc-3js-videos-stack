// @ts-nocheck
import * as THREE from "three";

import { clamp01, smooth } from "./ease";

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const ONE = v(1, 1, 1),
  UP = v(0, 1, 0);
const toMat = (o) => new THREE.Matrix4().compose(o.p, o.q, ONE);
const fromMat = (mat) => {
  const o = { p: v(0, 0, 0), q: new THREE.Quaternion() };
  mat.decompose(o.p, o.q, v(0, 0, 0));
  return o;
};
const mixPose = (a, b, k) =>
  k <= 0 ? a : { p: a.p.clone().lerp(b.p, k), q: a.q.clone().slerp(b.q, k) };

export function makeCarry({ sheetMid, sheetSize, folderMid, folderSize, floorY }) {
  const scratch = new THREE.Object3D();
  const flatAt = (o, x, y, z, yaw) => {
    o.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
    o.position.set(x, y, z).sub(sheetMid.clone().applyQuaternion(o.quaternion));
  };
  const fly = (from, f, u) => {
    const e = clamp01(u);
    const down = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(f.flat ? 0 : -Math.PI / 2, f.yaw, 0, "YXZ"),
    );
    const land = v(f.land[0], floorY + (f.layer % 8) * 0.0012, f.land[1]).sub(
      f.mid.clone().applyQuaternion(down),
    );
    const pos = from.p.clone().lerp(land, e);
    pos.y += f.h * 4 * e * (1 - e);
    const rot = from.q.clone().slerp(down, smooth(e));
    if (e < 1)
      rot.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          v(0.3, 1, 0.5).normalize(),
          f.spin * Math.sin(Math.PI * e),
        ),
      );
    return { p: pos, q: rot };
  };

  let live = { t: NaN, g: null },
    handAtFn = null;
  const gripsOf = (hR, hL, head) => {
    hR.updateWorldMatrix(true, false);
    hL.updateWorldMatrix(true, false);
    return {
      R: hR.matrixWorld.clone(),
      L: hL.matrixWorld.clone(),
      eyes: head.getWorldPosition(v(0, 0, 0)).add(v(0, 0.2, 0)),
    };
  };
  const grips = (tt) => (tt === live.t ? live.g : handAtFn(tt, gripsOf));
  const HANG = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(v(0, 0, -1), v(1, 0, 0), v(0, -1, 0)),
  );
  const shapeOf = (kind, mode, g, hand, slot, yaw) => {
    const H = g[hand],
      at = v(0, 0, 0).setFromMatrixPosition(H),
      page = kind === "page";
    if (mode === "hang") {
      const local = v(0.005 * slot, -(sheetSize.z / 2 - 0.02), 0).sub(
        sheetMid.clone().applyQuaternion(HANG),
      );
      return fromMat(H.clone().multiply(new THREE.Matrix4().compose(local, HANG, ONE)));
    }
    if (mode === "flat") {
      flatAt(scratch, at.x, at.y - 0.012 - 0.003 * slot, at.z, yaw);
      return { p: scratch.position.clone(), q: scratch.quaternion.clone() };
    }
    const n = g.eyes.clone().sub(at).normalize(),
      up = UP.clone().addScaledVector(n, -n.y).normalize();
    const rot = new THREE.Quaternion();
    if (page) {
      const zAx = up.clone().negate();
      rot.setFromRotationMatrix(new THREE.Matrix4().makeBasis(n.clone().cross(zAx), n, zAx));
    } else rot.setFromRotationMatrix(new THREE.Matrix4().makeBasis(up.clone().cross(n), up, n));
    const half = page ? sheetSize.z / 2 : folderSize.y / 2,
      mid = page ? sheetMid : folderMid;
    const centre = at
      .clone()
      .addScaledVector(up, half - 0.03)
      .addScaledVector(n, 0.012 + 0.004 * slot);
    return { p: centre.sub(mid.clone().applyQuaternion(rot)), q: rot };
  };
  const poseIn = (S, i, tt) => {
    const s = S[i];
    if (s.at) return s.at(tt);
    if (s.fly) return fly(poseIn(S, i - 1, s.t), s.fly, (tt - s.t) / s.fly.dur);
    if (s.lay) return mixPose(poseIn(S, i - 1, s.t), s.lay, smooth((tt - s.t) / 0.3));
    const g0 = grips(s.t),
      g = grips(tt);
    const rel = g0[s.hand]
      .clone()
      .invert()
      .multiply(toMat(poseIn(S, i - 1, s.t)));
    let pose = fromMat(g[s.hand].clone().multiply(rel));
    for (const [tm, mode] of s.modes ?? [])
      if (tt > tm)
        pose = mixPose(
          pose,
          shapeOf(s.kind, mode, g, s.hand, s.slot ?? 0, s.yaw ?? 0),
          smooth((tt - tm) / 0.35),
        );
    return pose;
  };
  const show = (o, S, t) => {
    let i = -1;
    S.forEach((s, k) => {
      if (t >= s.t) i = k;
    });
    if (i < 0) return;
    const at = poseIn(S, i, t);
    o.position.copy(at.p);
    o.quaternion.copy(at.q);
    o.visible = true;
  };
  const frame = (t, handR, handL, head, handAt) => {
    handAtFn = handAt;
    live = { t, g: gripsOf(handR, handL, head) };
  };
  return { flatAt, poseIn, show, frame };
}
