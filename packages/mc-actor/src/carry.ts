// @ts-nocheck
// How a loose thing (a page, a folder) moves through its story: lying somewhere, taken into a hand and held a certain way,
// put down, thrown. a film's props code writes each item's story as a list of states (poseIn below); this works out where the
// item is at any film time from Steve's hands alone, so nothing teleports into his fingers or out of them.
// A pose here is {p: Vector3, q: Quaternion}: the item's holder in world space.
import * as THREE from "three";
import { clamp01, smooth } from "./ease";

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const ONE = v(1, 1, 1), UP = v(0, 1, 0);
const toMat = (o) => new THREE.Matrix4().compose(o.p, o.q, ONE);
const fromMat = (mat) => { const o = { p: v(0, 0, 0), q: new THREE.Quaternion() }; mat.decompose(o.p, o.q, v(0, 0, 0)); return o; };
const mixPose = (a, b, k) => (k <= 0 ? a : { p: a.p.clone().lerp(b.p, k), q: a.q.clone().slerp(b.q, k) });

// sheetMid/folderMid: the middle of the model's bottom face (a sheet) and of its body (a folder), in its own frame;
// sheetSize/folderSize its extents; floorY the height things land at
export function makeCarry({ sheetMid, sheetSize, folderMid, folderSize, floorY }) {
  const scratch = new THREE.Object3D();
  // lying flat, its middle at (x, y, z), turned yaw
  const flatAt = (o, x, y, z, yaw) => { o.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ")); o.position.set(x, y, z).sub(sheetMid.clone().applyQuaternion(o.quaternion)); };
  // a throw: from a pose to lying at f.land [x, z] turned f.yaw (f.flat: a page face up; else a folder on its side), its
  // f.mid on the spot, up in an arc of height f.h, tumbling as it goes; f.layer lifts it a hair so things landing on one
  // spot don't flicker through each other
  const fly = (from, f, u) => {
    const e = clamp01(u);
    const down = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.flat ? 0 : -Math.PI / 2, f.yaw, 0, "YXZ"));
    const land = v(f.land[0], floorY + (f.layer % 8) * 0.0012, f.land[1]).sub(f.mid.clone().applyQuaternion(down));
    const pos = from.p.clone().lerp(land, e);
    pos.y += f.h * 4 * e * (1 - e);
    const rot = from.q.clone().slerp(down, smooth(e));
    if (e < 1) rot.multiply(new THREE.Quaternion().setFromAxisAngle(v(0.3, 1, 0.5).normalize(), f.spin * Math.sin(Math.PI * e)));
    return { p: pos, q: rot };
  };

  // grips(tt): his two hands' grip groups (world matrices) and his eyes at film time tt. frame() sets the live ones for
  // the frame being drawn; any other moment comes from scene.ts handAt, which poses Steve at tt (cached per edit)
  let live = { t: NaN, g: null }, handAtFn = null;
  const gripsOf = (hR, hL, head) => {
    hR.updateWorldMatrix(true, false); hL.updateWorldMatrix(true, false);
    return { R: hR.matrixWorld.clone(), L: hL.matrixWorld.clone(), eyes: head.getWorldPosition(v(0, 0, 0)).add(v(0, 0.2, 0)) };
  };
  const grips = (tt) => (tt === live.t ? live.g : handAtFn(tt, gripsOf));
  // How a held thing sits, by mode:
  //   "hang"  a page pinched at its top edge, hanging from the hand in the plane of his side, so it clears his leg
  //   "flat"  a page lying level under the hand, about to be put down
  //   "face"  held up square to his eyes, pinched at its bottom edge, print upright: how anyone holds a page to read it
  // slot stacks several pages in one hand a few millimetres apart
  const HANG = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(v(0, 0, -1), v(1, 0, 0), v(0, -1, 0)));
  const shapeOf = (kind, mode, g, hand, slot, yaw) => {
    const H = g[hand], at = v(0, 0, 0).setFromMatrixPosition(H), page = kind === "page";
    if (mode === "hang") {
      const local = v(0.005 * slot, -(sheetSize.z / 2 - 0.02), 0).sub(sheetMid.clone().applyQuaternion(HANG));
      return fromMat(H.clone().multiply(new THREE.Matrix4().compose(local, HANG, ONE)));
    }
    if (mode === "flat") { flatAt(scratch, at.x, at.y - 0.012 - 0.003 * slot, at.z, yaw); return { p: scratch.position.clone(), q: scratch.quaternion.clone() }; }
    // the page's printed face is its model +y with the print's top towards -z; a folder's label is on its +z side
    const n = g.eyes.clone().sub(at).normalize(), up = UP.clone().addScaledVector(n, -n.y).normalize();
    const rot = new THREE.Quaternion();
    if (page) { const zAx = up.clone().negate(); rot.setFromRotationMatrix(new THREE.Matrix4().makeBasis(n.clone().cross(zAx), n, zAx)); }
    else rot.setFromRotationMatrix(new THREE.Matrix4().makeBasis(up.clone().cross(n), up, n));
    const half = page ? sheetSize.z / 2 : folderSize.y / 2, mid = page ? sheetMid : folderMid;
    const centre = at.clone().addScaledVector(up, half - 0.03).addScaledVector(n, 0.012 + 0.004 * slot);
    return { p: centre.sub(mid.clone().applyQuaternion(rot)), q: rot };
  };
  // An item's story is a list of states, each holding from its t: {at(tt)} lying where it lies; {fly} thrown from wherever
  // the state before left it; {lay} put down out of the hand onto a fixed pose over 0.3 s; {hand, kind, modes} in that hand.
  // Taking it freezes its pose relative to the hand at that moment, so it leaves the floor (desk, drawer) from exactly where
  // it lay and never jumps into the fingers; modes [[t, mode]] then turn it into a way of holding it, each over 0.35 s
  const poseIn = (S, i, tt) => {
    const s = S[i];
    if (s.at) return s.at(tt);
    if (s.fly) return fly(poseIn(S, i - 1, s.t), s.fly, (tt - s.t) / s.fly.dur);
    if (s.lay) return mixPose(poseIn(S, i - 1, s.t), s.lay, smooth((tt - s.t) / 0.3));
    const g0 = grips(s.t), g = grips(tt);
    const rel = g0[s.hand].clone().invert().multiply(toMat(poseIn(S, i - 1, s.t)));
    let pose = fromMat(g[s.hand].clone().multiply(rel));
    for (const [tm, mode] of s.modes ?? []) if (tt > tm) pose = mixPose(pose, shapeOf(s.kind, mode, g, s.hand, s.slot ?? 0, s.yaw ?? 0), smooth((tt - tm) / 0.35));
    return pose;
  };
  // puts o where its story S has it at t (hidden until its first state)
  const show = (o, S, t) => {
    let i = -1;
    S.forEach((s, k) => { if (t >= s.t) i = k; });
    if (i < 0) return;
    const at = poseIn(S, i, t);
    o.position.copy(at.p);
    o.quaternion.copy(at.q);
    o.visible = true;
  };
  // every frame, before any show(): his live grips at t, and scene.ts handAt(tt, fn) for any other moment
  const frame = (t, handR, handL, head, handAt) => { handAtFn = handAt; live = { t, g: gripsOf(handR, handL, head) }; };
  return { flatAt, poseIn, show, frame };
}
