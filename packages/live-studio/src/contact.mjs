// How far a point is from a surface, and whether it is inside a solid, for render/touch.ts (no DOM, so test/contact.test.mjs
// runs it in node). One rule for every model, never a list of block names: p is inside only if the face nearest to it has
// p behind it AND the mesh closes around p (a ray from p on through that face's back meets the same mesh again, from the
// back). A solid block, a slab or a torch closes; a flat card (grass, flowers, cobweb, paper, a one-plane pane) does not,
// so a point behind a card is only near it. Double-sided faces have no back, so they are never "inside".
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

export const REACH = 0.15; // m: gaps farther than this are not reported (inside: any depth)

const bvhs = new WeakMap();
const bvhOf = (g) => { if (!bvhs.has(g)) bvhs.set(g, new MeshBVH(g, { indirect: true })); return bvhs.get(g); }; // indirect: the film's index buffer is left as it is

// one mesh (or one instance) placed by matrix: side is its material's (BackSide: drawn from inside, so its inside is out;
// a mirrored matrix changes nothing, the normal matrix keeps normals pointing out)
export function surface(g, matrix, { side = THREE.FrontSide, label = "" } = {}) {
  if (!g.boundingBox) g.computeBoundingBox();
  return {
    g, matrix, inv: matrix.clone().invert(), box: g.boundingBox.clone().applyMatrix4(matrix).expandByScalar(REACH), label,
    two: side === THREE.DoubleSide, flip: side === THREE.BackSide,
  };
}

const v = new THREE.Vector3(), w = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), ray = new THREE.Ray();
const hit = { point: new THREE.Vector3() }, tri = new THREE.Triangle();
// the face's normal from its corners' winding, indexed geometry or not
const normalOf = (g, f, out) => {
  const pos = g.attributes.position, ix = (k) => (g.index ? g.index.getX(f * 3 + k) : f * 3 + k);
  tri.a.fromBufferAttribute(pos, ix(0)); tri.b.fromBufferAttribute(pos, ix(1)); tri.c.fromBufferAttribute(pos, ix(2));
  return tri.getNormal(out);
};

// signed gap from world point p to the nearest of the surfaces: under 0 inside a solid; { d: Infinity } when none is near
export function gap(p, list) {
  let best = { d: Infinity };
  for (const s of list) {
    if (!s.box.containsPoint(p)) continue;
    v.copy(p).applyMatrix4(s.inv);
    const r = bvhOf(s.g).closestPointToPoint(v, hit, 0, Infinity);
    if (!r) continue;
    w.copy(r.point).applyMatrix4(s.matrix);
    const dist = p.distanceTo(w);
    normalOf(s.g, r.faceIndex, n).applyMatrix3(nm.getNormalMatrix(s.matrix)).normalize();
    let d = dist;
    if (!s.two && n.dot(v.copy(p).sub(w)) * (s.flip ? -1 : 1) < 0) {
      ray.origin.copy(p).applyMatrix4(s.inv);
      ray.direction.copy(n).negate().transformDirection(s.inv);
      const far = bvhOf(s.g).raycastFirst(ray, THREE.DoubleSide);
      if (far && ray.direction.dot(far.face.normal) * (s.flip ? -1 : 1) > 0) d = -dist;
    }
    if (d > REACH) continue;
    if (d < best.d) best = { d, surface: s.label };
  }
  return best;
}
