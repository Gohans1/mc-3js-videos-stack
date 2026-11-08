// @ts-nocheck
// CHECK=touch:<target>,<from>,<to>[,<step s>], built in for every film: does the target sink into things, or hang just off
// them, every frame (default step 1/30 s)? Every vertex and triangle middle of the target's meshes, posed (a target with no
// mesh, like mc-actor's handR grip: its own position), is measured against every other visible mesh within 15 cm with
// three-mesh-bvh: the closest point on the surface; inside when it lies behind the face there and the mesh closes around it
// (a ray going on meets the same mesh again from the back; a flat card like a cobweb or paper has no inside). Never
// measured against: the actor the target belongs to (its draw.tools.objects entry, so no self-contact), see-through
// materials (opacity under 0.5), skinned meshes as surfaces, double-sided faces as "inside".
// Real geometry, not a verdict: over a whole film it lists every limb clip a blocky walk makes (6-10 cm, the game's own do
// too), so run it on the shot or move in question. Prints the numbers and faults (src/touch.mjs), writes
//   touch_<target>_<from>-<to>.jpg  the gap to the nearest surface over time in cm (under 0: inside it)
//   touch_<target>_<from>-<to>_worst.jpg  the worst frame of each fault, the point circled
import * as THREE from "three";
import { gap, surface } from "../src/contact.mjs";
import { summarize } from "../src/touch.mjs";
import { canvas } from "./lab";
import { chart, findTarget, inside, label, labelOf, mark, targetHelp } from "./target";

const MAX_PROBES = 6000;

export const touchCheck = (render) => {
  const surfaces = (scene, owner, objects) => {
    const out = [];
    scene.updateMatrixWorld(true);
    scene.traverseVisible((o) => {
      if (!o.isMesh || o.isSkinnedMesh || inside(owner, o) || !o.geometry?.attributes?.position) return;
      const mats = [o.material].flat();
      if (mats.every((m) => !m || m.visible === false || (m.transparent && (m.opacity ?? 1) < 0.5))) return;
      const g = o.geometry, side = mats.some((m) => m?.side === THREE.DoubleSide) ? THREE.DoubleSide : mats.every((m) => m?.side === THREE.BackSide) ? THREE.BackSide : THREE.FrontSide;
      if (!g.boundingBox) g.computeBoundingBox();
      let lab = labelOf(objects, o);
      if (lab === o.type) { // no label and no name: a parent's name, else where it is, so it can be found
        for (let p = o.parent; p && lab === o.type; p = p.parent) if (p.name) lab = p.name;
        if (lab === o.type) lab = `an unnamed mesh at (${g.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(o.matrixWorld).toArray().map((x) => x.toFixed(2)).join(", ")})`;
      }
      const add = (matrix) => out.push(surface(g, matrix, { side, label: lab }));
      if (o.isInstancedMesh) { const im = new THREE.Matrix4(); for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); add(o.matrixWorld.clone().multiply(im)); } }
      else add(o.matrixWorld.clone());
    });
    return out;
  };

  // the target's posed vertices and triangle middles, in world space, each with the part it belongs to
  const probes = (obj, partOf) => {
    const out = [];
    obj.updateMatrixWorld(true);
    obj.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index, part = partOf(o);
      // a skinned vertex belongs to the bone that pulls it hardest
      const si = o.isSkinnedMesh && o.geometry.attributes.skinIndex, sw = si && o.geometry.attributes.skinWeight;
      const partAt = (i) => { if (!si) return part; let k = 0; for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, k)) k = j; return partOf(o.skeleton.bones[si.getComponent(i, k)]); };
      const at = (i) => (o.isSkinnedMesh ? o.getVertexPosition(i, new THREE.Vector3()) : new THREE.Vector3().fromBufferAttribute(pos, i)).applyMatrix4(o.matrixWorld);
      for (let i = 0; i < pos.count; i++) out.push([at(i), partAt(i)]);
      const tris = idx ? idx.count / 3 : pos.count / 3;
      for (let k = 0; k < tris; k++) {
        const ids = [0, 1, 2].map((j) => (idx ? idx.getX(k * 3 + j) : k * 3 + j)), [a, b, c] = ids.map(at);
        out.push([a.add(b).add(c).divideScalar(3), partAt(ids[0])]);
      }
    });
    if (!out.length) out.push([obj.getWorldPosition(new THREE.Vector3()), obj.name || "point"]); // a bare point (mc-actor's handR grip)
    if (out.length <= MAX_PROBES) return out;
    const stride = Math.ceil(out.length / MAX_PROBES);
    return out.filter((_, i) => i % stride === 0);
  };

  return async (target, from, to, step = 1 / 30) => {
    if (typeof target !== "string" || !(to > from) || !(step > 0)) return ["ERROR usage: CHECK=touch:<target>,<from s>,<to s>[,<step s>]"];
    const tools = render.tools, { scene, camera, objects, bones } = tools;
    const obj = findTarget(tools, target);
    if (!obj || target === "cam") return [targetHelp(tools, target)];
    let owner = obj; // the nearest draw.tools.objects entry around the target: the actor, never a surface for itself
    for (let p = obj; p; p = p.parent) if (objects?.some(([o]) => o === p)) { owner = p; break; }
    const boneName = new Map(Object.entries(bones ?? {}).map(([k, b]) => [b, k]));
    const partOf = (o) => {
      for (let p = o; p && p !== owner.parent; p = p.parent) if (boneName.has(p)) return boneName.get(p);
      for (let p = o.parent; p && p !== owner.parent; p = p.parent) if (p.name) return p.name;
      return target;
    };

    const frames = [], last = new THREE.Vector3(), here = new THREE.Vector3();
    for (let i = 0, k = Math.round((to - from) / step); i <= k; i++) {
      const t = from + i * step;
      render(t);
      const list = surfaces(scene, owner, objects);
      let best = { d: Infinity, part: target, surface: "-", p: [0, 0, 0] };
      for (const [p, part] of probes(obj, partOf)) { const g = gap(p, list); if (g.d < best.d) best = { ...g, part, p: p.toArray() }; }
      obj.getWorldPosition(here);
      const q = new THREE.Vector3(...best.p).project(camera); // the film camera of this frame
      frames.push({ t, ...best, speed: i ? here.distanceTo(last) / step : 0, inFrame: q.z < 1 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 });
      last.copy(here);
    }
    const { lines, worst } = summarize(target, frames);

    const tag = `touch_${target}_${from}-${to}`, gl = canvas();

    const c = chart(gl.width, 420, { from, to, top: 10, bottom: -10, unit: " cm", title: `${target}: gap to the nearest surface (cm; under 0 = inside; green = touching, red = sunk in)` });
    c.g.fillStyle = "rgba(60,220,110,.15)"; c.g.fillRect(c.L, c.Y(1), c.canvas.width - c.L - c.R, c.Y(-3) - c.Y(1));
    c.g.fillStyle = "rgba(255,60,60,.15)"; c.g.fillRect(c.L, c.Y(-3), c.canvas.width - c.L - c.R, c.Y(-10) - c.Y(-3));
    c.g.strokeStyle = "#ffffff"; c.g.lineWidth = 2.5;
    let pen = false;
    c.g.beginPath();
    for (const x of frames) {
      if (!Number.isFinite(x.d)) { pen = false; continue; }
      (pen ? c.g.lineTo : c.g.moveTo).call(c.g, c.X(x.t), c.Y(x.d * 100)); pen = true;
    }
    c.g.stroke();
    worst.forEach((x, i) => mark(c, x.t, x.kind === "SINK" ? "#ff4d4d" : "#ffd84d", x.kind, i % 3, [3, 3]));
    lines.push({ still: `${tag}.jpg`, canvas: c.canvas });

    if (worst.length) {
      const shown = worst.slice(0, 6), TW = gl.width / 2, TH = gl.height / 2;
      const sheet = document.createElement("canvas");
      sheet.width = TW * Math.min(2, shown.length); sheet.height = TH * Math.ceil(shown.length / 2);
      const s = sheet.getContext("2d");
      shown.forEach((x, k) => {
        render(x.t);
        const x0 = (k % 2) * TW, y0 = Math.floor(k / 2) * TH;
        s.drawImage(gl, x0, y0, TW, TH);
        const q = new THREE.Vector3(...x.p).project(camera);
        if (q.z < 1) {
          s.strokeStyle = x.kind === "SINK" ? "#ff3030" : "#ffd84d"; s.lineWidth = 3;
          s.beginPath(); s.arc(x0 + ((q.x + 1) / 2) * TW, y0 + ((1 - q.y) / 2) * TH, 14, 0, 7); s.stroke();
        }
        s.font = "bold 16px Consolas, monospace";
        label(s, `${x.kind} ${x.t.toFixed(2)}: ${x.say}${q.z < 1 ? "" : " (behind the camera)"}`, x0 + 10, y0 + 24);
        s.strokeStyle = "#000"; s.lineWidth = 2; s.strokeRect(x0, y0, TW, TH);
      });
      lines.push({ still: `${tag}_worst.jpg`, canvas: sheet });
    }
    return lines;
  };
};
