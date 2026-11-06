// @ts-nocheck
// A silverfish, built box by box from the game's
// own model (SilverfishModel: seven body segments and three fuzz layers, 64 x 32 texture from client.jar) and wiggled the
// way the game wiggles it (setupAnim: each segment swings and sways more the further it is from the third).
//   keys {scale, path: [{t, at: [x, y, z], hop?}]} (a film's props.json silverfish)  hidden before the first key and after the last; between keys it slides, hop lifts it in an arc of that height. It faces where it is going.
import * as THREE from "three";

const SIZES = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]];
const TEXS = [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]];
const TW = 64, TH = 32;

// A Minecraft model box (w, h, d pixels, texture corner u, v) as a BoxGeometry with the game's UV layout. BoxGeometry
// faces run +x, -x, +y, -y, +z, -z; the model's front is -z
function mcBox(w, h, d, u, v) {
  const g = new THREE.BoxGeometry(w / 16, h / 16, d / 16);
  const rects = [
    [u + d + w, v + d, u + 2 * d + w, v + d + h], // +x
    [u, v + d, u + d, v + d + h], // -x
    [u + d, v, u + d + w, v + d], // top
    [u + d + w, v, u + d + 2 * w, v + d], // bottom
    [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h], // +z, back
    [u + d, v + d, u + d + w, v + d + h], // -z, front
  ];
  const uv = g.attributes.uv;
  rects.forEach(([x0, y0, x1, y1], f) => {
    const q = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    q.forEach(([x, y], k) => uv.setXY(f * 4 + k, x / TW, 1 - y / TH));
  });
  return g;
}

export async function buildSilverfish(png) {
  const tex = await new THREE.TextureLoader().loadAsync(png);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const zs = [];
  let z = -3.5;
  const segs = SIZES.map(([w, h, d], i) => {
    zs.push(z);
    const m = new THREE.Mesh(mcBox(w, h, d, ...TEXS[i]), mat);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, z / 16);
    m.position.y = h / 32; // stands on the ground: the game hangs each box from 24 - h
    pivot.add(m);
    body.add(pivot);
    if (i < SIZES.length - 1) z += (d + SIZES[i + 1][2]) * 0.5;
    return pivot;
  });
  // the fuzz: [texture u, v, w, h, d, the segment it rides, its z offset]
  const fuzz = [[20, 0, 10, 8, 3, 2, 0], [20, 11, 6, 4, 3, 4, 0], [20, 18, 6, 5, 2, 1, -0.5]].map(([u, v, w, h, d, seg, dz]) => {
    const m = new THREE.Mesh(mcBox(w, h, d, u, v), mat);
    m.position.set(0, h / 32, dz / 16);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, zs[seg] / 16);
    pivot.add(m);
    body.add(pivot);
    return [pivot, seg];
  });
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });

  const keyAt = (keys, t) => { let i = 0; while (i < keys.length - 1 && t >= keys[i + 1].t) i++; return i; };
  const where = (path, t) => {
    const i = keyAt(path, t), a = path[i], b = path[Math.min(i + 1, path.length - 1)];
    const x = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    const p = new THREE.Vector3(...a.at).lerp(new THREE.Vector3(...b.at), x);
    p.y += (b.hop ?? 0) * 4 * x * (1 - x);
    return p;
  };
  const draw = (S, t) => {
    const path = S?.path;
    g.visible = !!path?.length && t >= path[0].t && t < path[path.length - 1].t;
    if (!g.visible) return;
    g.scale.setScalar(S.scale ?? 1);
    const p = where(path, t), ahead = where(path, t + 0.04);
    g.position.copy(p);
    const dx = ahead.x - p.x, dz = ahead.z - p.z;
    if (dx * dx + dz * dz > 1e-8) g.rotation.y = Math.atan2(-dx, -dz);
    // setupAnim, ageInTicks = t * 20; it scurries twice as fast as it idles
    const speed = Math.hypot(dx, dz) / 0.04, a = t * 20 * (speed > 0.2 ? 2 : 1);
    segs.forEach((s, i) => {
      const ph = a * 0.9 + i * 0.15 * Math.PI;
      s.rotation.y = Math.cos(ph) * Math.PI * 0.05 * (1 + Math.abs(i - 2));
      s.position.x = (Math.sin(ph) * Math.PI * 0.2 * Math.abs(i - 2)) / 16;
    });
    for (const [f, seg] of fuzz) { f.rotation.y = segs[seg].rotation.y; f.position.x = segs[seg].position.x; }
  };
  return { g, draw, where };
}
