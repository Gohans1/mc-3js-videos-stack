// @ts-nocheck
// The cell block round Steve's cell (dev note: a flat prison, the camera rising off his cell to show every cell the same):
// BLOCK.cols x BLOCK.rows identical cells laid out flat, roofless, a corridor in front of each row's doors; Steve's row is
// the block's north edge (the tunnel runs out under its outer wall). One cell (world.ts buildCell plus the props scene.ts
// passes: the CRT picture, the chair, the CCTV camera) is baked into one mesh per material and drawn with InstancedMesh,
// and every cell has its own Steve (crowd below). Every cell is lit alike: its own textures as a dim warm
// emissive (the room lamp's look), so no lamp leaks across walls; scene.ts adds the same light from above to every cell,
// his too, while the camera is over the block. Steve's own cell is the real one: only its corridor is drawn here.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createScene } from "block-model-renderer";
import { buildCell, DESK, ROOM } from "./world";

// pitch: x 8 (each cell keeps both side walls, so they stand back to back), z 10 (its 8 blocks and a 2-block corridor);
// cols/rows wide enough that the pull-back's last frame (55 m up, 62 degrees down) is cells to every edge
export const BLOCK = { px: 8, pz: 10, cols: [-13, 14], rows: [-8, 7] };
export const cellOrigin = (cx, cz) => new THREE.Vector3(cx * BLOCK.px, 0, cz * BLOCK.pz);
export const NEIGHBOUR = [1, 0]; // cell 0411, east of his: its inmate is story.ts's
const S = 1 / 16;

// What the other inmates are doing (dev note: no two alike, nobody in the same spot): each cell draws one, then a second
// of it, a spot and a heading. AT_FURNITURE: steve.ts poses tied to a place in the cell ([at, yaw, pose], Steve's cell
// coordinates). CROWD: mocap clips (scene.ts loads them), stood anywhere on the free floor; flat: lies or kneels along
// the floor, so it is laid east-west across the middle where its length fits
const AT_FURNITURE = [
  [[5.5, 0.5625, 1.3], 0, "lie"], [[2.5, 0, 1.58], 180, "type"], [[2.5, 0, 1.58], 180, "despair"], [[4.5, 0, 4.85], 0, "kick"],
  [[5.45, 0, 3.0], 90, "ear"], [[4.6, 0, 3.0], 100, "floor"], [[0.6, 0, 0.95], 180, "kneel"],
];
export const CROWD = [
  { ref: "mixamo/Standard_Jumping_Jacks_c9caceb2" }, { ref: "mixamo/Stretching_Neck_Rolling_Side_To_Side_c9c9113b" },
  { ref: "mixamo/Crying_And_Rubbing_Eyes_c9c984ee" }, { ref: "mixamo/Big_Yawn_While_Standing_c9c98361" },
  { ref: "mixamo/Standing_Around_Bored_Idle_c9c79d1f" }, { ref: "mixamo/Angry_Forward_Gesture_c9c917a2" },
  { ref: "mixamo/Buckled_Stand_And_Praying_c9c69fb6" }, { ref: "mixamo/Crouch_Looking_Around_Corner_c9cc0b63" },
  { ref: "ual1/Walk_Loop" }, { ref: "mixamo/Kneeling_In_Prayer_c9c6a211", flat: true },
  { ref: "mixamo/Basic_Push_Up_c9cac106", flat: true }, { ref: "mixamo/Reaching_Hands_Towards_Toes_4362690a", flat: true },
  { ref: "mixamo/Sleeping_Deeply_c9ccd46a", flat: true }, { ref: "mixamo/Restless_Sleeping", flat: true },
];

const subGeo = (geo, g) => {
  const out = new THREE.BufferGeometry();
  if (geo.index) {
    for (const [n, a] of Object.entries(geo.attributes)) out.setAttribute(n, a);
    out.setIndex(Array.from(geo.index.array.slice(g.start, g.start + g.count)));
    return out.toNonIndexed();
  }
  for (const [n, a] of Object.entries(geo.attributes)) out.setAttribute(n, new THREE.BufferAttribute(a.array.slice(g.start * a.itemSize, (g.start + g.count) * a.itemSize), a.itemSize, a.normalized));
  return out;
};
// a skinned mesh's posed vertices (Box3 and geometry alone keep the bind pose)
const posed = (o) => {
  const idx = o.geometry.index, g = idx ? o.geometry.toNonIndexed() : o.geometry.clone();
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { o.getVertexPosition(idx ? idx.getX(i) : i, v); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  return g;
};
// objects' meshes in world space, merged per material: [[material, geometry]]
const bake = (objects) => {
  const buckets = new Map();
  for (const root of objects) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const mats = [o.material].flat();
      const base = o.isSkinnedMesh ? posed(o) : o.geometry;
      const parts = Array.isArray(o.material) && base.groups.length
        ? base.groups.map((g) => [mats[g.materialIndex], subGeo(base, g)]) : [[mats[0], base.index ? base.toNonIndexed() : base.clone()]];
      for (const [mat, geo] of parts) {
        geo.applyMatrix4(o.matrixWorld);
        for (const n of Object.keys(geo.attributes)) if (!["position", "normal", "uv", "color"].includes(n)) geo.deleteAttribute(n);
        const k = `${mat.uuid}|${Object.keys(geo.attributes).sort().join()}`;
        if (!buckets.has(k)) buckets.set(k, { mat, geos: [] });
        buckets.get(k).geos.push(geo);
      }
    });
  }
  return [...buckets.values()].map(({ mat, geos }) => [mat, mergeGeometries(geos)]).filter(([, g]) => g);
};

// props: the scene objects every cell has that are not blocks (in Steve's cell's coordinates); actor: an extra Steve
// (scene.ts makeActor) posed for each cell and baked; clips: CROWD loaded (mc-actor loadClips); crtId: the computer look
// the studio has picked
export async function buildCellBlock({ sources, scene, props, actor, clips, crtId }) {
  const cells = [];
  for (let cz = BLOCK.rows[0]; cz <= BLOCK.rows[1]; cz++) for (let cx = BLOCK.cols[0]; cx <= BLOCK.cols[1]; cx++) cells.push([cx, cz]);
  const own = cells.findIndex(([cx, cz]) => !cx && !cz); // Steve's: only its corridor, unless draw's `self` (his cell red)
  const n = cells.length, group = new THREE.Group(), M = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const mats = [], ims = [], mine = [];
  const selfLit = (mat) => {
    const m = mat.clone();
    if (m.emissive) { m.emissiveMap = m.map; m.userData.base = m.color.clone(); mats.push(m); }
    return m;
  };
  // ofOwn: the copy in his cell too, shown only while draw's `self` asks
  const instance = (baked, keep, ofOwn = false) => baked.map(([mat, geo]) => {
    const im = new THREE.InstancedMesh(geo, selfLit(mat), n);
    cells.forEach(([cx, cz], i) => im.setMatrixAt(i, keep(i) ? M.makeTranslation(cellOrigin(cx, cz)) : zero));
    im.frustumCulled = false;
    im.receiveShadow = true;
    group.add(im);
    ims.push(im);
    if (ofOwn) mine.push(im);
    return im;
  });
  const seat = (g) => { g.scale.setScalar(S); g.position.set(0.5, 0.5, 0.5); return g; }; // like the room: a block spans x..x+1
  const built = async (blocks, extra, keep, ofOwn) => {
    const g = seat((await createScene(sources, blocks, { lighting: "scene", animate: false })).group);
    scene.add(g);
    instance(bake([g, ...extra]), keep, ofOwn);
    g.removeFromParent();
  };
  await built([...buildCell(), { id: `gohans:${crtId}`, pos: [DESK.crt, 1, DESK.z], properties: { facing: "south" } }], props.map((o) => o.clone()), (i) => i !== own, true);
  // its own pass: createScene keeps one block per position, so the keyboard sharing the CRT's would drop the CRT
  await built([{ id: `gohans:${crtId}_keys`, pos: [DESK.crt, 1, DESK.z], properties: { facing: "south" } }], [], (i) => i !== own, true);
  // the corridor along each row's doors
  await built(Array.from({ length: (ROOM.x1 + 3) * 2 }, (_, i) => ({ id: "polished_deepslate", pos: [-1 + (i >> 1), -1, ROOM.z1 + 2 + (i & 1)] })), [], () => true);

  // the inmates (no two alike): VARIANTS bodies baked once (a furniture pose in its place, or a clip frame at the
  // origin), each drawn instanced; a clip body gets its own spot and heading in every cell through its instance matrix.
  // His own cell's (shown with `self`) and the neighbour's (hidden while story.ts has him) are instances set apart
  const neighbour = cells.findIndex(([cx, cz]) => cx === NEIGHBOUR[0] && cz === NEIGHBOUR[1]);
  const r = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  const VARIANTS = 48, OWN_VARIANT = 1; // AT_FURNITURE[1]: at his desk, typing, as he is when the block goes red
  const spec = (v) => v < AT_FURNITURE.length ? { furniture: AT_FURNITURE[v] } : { crowd: CROWD[v % CROWD.length], s: r(v, 4) };
  const pick = cells.map((_, i) => i === own ? OWN_VARIANT : Math.floor(r(i, 1) * VARIANTS));
  // no two neighbours alike: west and north neighbours differ
  const cols = BLOCK.cols[1] - BLOCK.cols[0] + 1;
  cells.forEach((_, i) => { while (i !== own && (pick[i] === pick[i - 1] || pick[i] === pick[i - cols])) pick[i] = (pick[i] + 7) % VARIANTS; });
  const placeOf = (i, v) => {
    const sp = spec(v), o = cellOrigin(...cells[i]);
    if (sp.furniture) return M.makeTranslation(o);
    const c = sp.crowd, at = c.flat ? [2.6 + r(i, 5), 0, 3.0 + r(i, 6) * 0.8] : [1.4 + r(i, 5) * 3.0, 0, 2.4 + r(i, 6) * 2.2];
    const yaw = (c.flat ? (r(i, 7) < 0.5 ? 90 : 270) + (r(i, 8) - 0.5) * 30 : r(i, 7) * 360) * THREE.MathUtils.DEG2RAD;
    return M.makeRotationY(yaw).setPosition(o.add(new THREE.Vector3(...at)));
  };
  const theirs = [], hers = [];
  for (let v = 0; v < VARIANTS; v++) {
    const users = cells.map((_, i) => i).filter((i) => pick[i] === v);
    if (!users.length) continue;
    const sp = spec(v);
    if (sp.furniture) { const [at, yaw, pose] = sp.furniture; actor.place(new THREE.Vector3(...at), yaw, pose); }
    else { const clip = clips[sp.crowd.ref]; actor.play(new THREE.Vector3(0, 0, 0), 0, clip.at(sp.s * clip.duration)); }
    for (const [mat, geo] of bake([actor.g])) {
      const im = new THREE.InstancedMesh(geo, selfLit(mat), users.length);
      users.forEach((i, j) => {
        im.setMatrixAt(j, i === own ? zero : placeOf(i, v));
        if (i === neighbour) theirs.push([im, j, placeOf(i, v).clone()]);
        if (i === own) hers.push([im, j, placeOf(i, v).clone()]);
      });
      im.frustumCulled = false; im.receiveShadow = true;
      group.add(im); ims.push(im);
    }
  }
  actor.g.removeFromParent();

  // each cell's CCTV light: a hot red dot that blinks out of step with the others, and all at once at story.red
  const dots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
  dots.frustumCulled = false;
  group.add(dots);
  let ledAt = null, out = null, selfWas = false;
  scene.add(group);
  scene.fog = new THREE.FogExp2(0x05070b, 0.0062);

  const rnd = (i) => { const x = Math.sin(i * 91.7) * 43758.5; return x - Math.floor(x); };
  const WARM = new THREE.Color(0.5, 0.44, 0.36), RED = new THREE.Color(1.0, 0.1, 0.06), col = new THREE.Color();
  // inside: the camera is in Steve's own cell (nothing here can be seen); near: it is in 0411, which scene.ts lights
  // with a copy of his cell's lights, so the glow goes and the cells cast shadows; led: where his camera's red light is;
  // red: film second the block flips red (null: never); away: the neighbour's inmate is out (story.ts has him);
  // self: his own cell drawn here too (scene.ts then shows only this group, so his cell goes red with the rest)
  const draw = (t, { inside, near, led, red, away, self = false }) => {
    group.visible = !inside;
    if (inside) return;
    // red comes up in one steady second, no blinking (dev note)
    const k = red == null || t < red ? 0 : THREE.MathUtils.smoothstep(t - red, 0, 1);
    for (const m of mats) {
      m.emissive.copy(WARM).multiplyScalar(0.2 * (1 - k)).add(col.copy(RED).multiplyScalar(0.35 * k)).multiplyScalar(near ? 0 : 1);
      m.color.copy(m.userData.base).multiplyScalar(1 - 0.85 * k); // red: the light from above dims away, or it greys the red out
    }
    for (const im of ims) im.castShadow = !!near;
    if (!ledAt?.equals(led)) {
      ledAt = led.clone();
      cells.forEach((c, i) => dots.setMatrixAt(i, i === own ? zero : M.makeTranslation(cellOrigin(...c).add(led))));
      dots.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < n; i++) {
      const blink = k ? 1 : (t + rnd(i + 7) * 3) % 3 < 0.35 ? 1 : 0.15;
      dots.setColorAt(i, col.copy(RED).multiplyScalar(4 * blink));
    }
    dots.instanceColor.needsUpdate = true;
    if (self !== selfWas) {
      selfWas = self;
      for (const im of mine) { im.setMatrixAt(own, self ? M.makeTranslation(cellOrigin(0, 0)) : zero); im.instanceMatrix.needsUpdate = true; }
      for (const [im, j, m] of hers) { im.setMatrixAt(j, self ? m : zero); im.instanceMatrix.needsUpdate = true; }
    }
    if (away !== out) {
      out = away;
      for (const [im, j, m] of theirs) { im.setMatrixAt(j, away ? zero : m); im.instanceMatrix.needsUpdate = true; }
    }
  };
  return { group, draw };
}
