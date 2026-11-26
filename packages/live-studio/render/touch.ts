// @ts-nocheck
import * as THREE from "three";

import { gap, surface } from "../checks/contact.mjs";
import { summarize } from "../checks/touch.mjs";
import { canvas } from "./lab";
import { chart, findTarget, inside, label, labelOf, mark, targetHelp } from "./target";

const MAX_PROBES = 6000;
const WHOLE_STEP = 0.1;

export const touchCheck = (render) => {
  const draw = render.renderFrame?.bind(render) ?? render;
  const surfaces = (scene, owner, objects) => {
    const out = [];
    scene.updateMatrixWorld(true);
    scene.traverseVisible((o) => {
      if (!o.isMesh || o.isSkinnedMesh || inside(owner, o) || !o.geometry?.attributes?.position)
        return;
      const mats = [o.material].flat();
      if (mats.every((m) => !m || m.visible === false || (m.transparent && (m.opacity ?? 1) < 0.5)))
        return;
      const g = o.geometry,
        side = mats.some((m) => m?.side === THREE.DoubleSide)
          ? THREE.DoubleSide
          : mats.every((m) => m?.side === THREE.BackSide)
            ? THREE.BackSide
            : THREE.FrontSide;
      if (!g.boundingBox) g.computeBoundingBox();
      let lab = labelOf(objects, o);
      if (lab === o.type) {
        for (let p = o.parent; p && lab === o.type; p = p.parent) if (p.name) lab = p.name;
        if (lab === o.type)
          lab = `an unnamed mesh at (${g.boundingBox
            .getCenter(new THREE.Vector3())
            .applyMatrix4(o.matrixWorld)
            .toArray()
            .map((x) => x.toFixed(2))
            .join(", ")})`;
      }
      const add = (matrix) => out.push(surface(g, matrix, { side, label: lab }));
      if (o.isInstancedMesh) {
        const im = new THREE.Matrix4();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, im);
          add(o.matrixWorld.clone().multiply(im));
        }
      } else add(o.matrixWorld.clone());
    });
    return out;
  };

  const probes = (obj, partOf) => {
    const out = [];
    obj.updateMatrixWorld(true);
    obj.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position,
        idx = o.geometry.index,
        part = partOf(o);
      const si = o.isSkinnedMesh && o.geometry.attributes.skinIndex,
        sw = si && o.geometry.attributes.skinWeight;
      const partAt = (i) => {
        if (!si) return part;
        let k = 0;
        for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, k)) k = j;
        return partOf(o.skeleton.bones[si.getComponent(i, k)]);
      };
      const at = (i) =>
        (o.isSkinnedMesh
          ? o.getVertexPosition(i, new THREE.Vector3())
          : new THREE.Vector3().fromBufferAttribute(pos, i)
        ).applyMatrix4(o.matrixWorld);
      for (let i = 0; i < pos.count; i++) out.push([at(i), partAt(i)]);
      const tris = idx ? idx.count / 3 : pos.count / 3;
      for (let k = 0; k < tris; k++) {
        const ids = [0, 1, 2].map((j) => (idx ? idx.getX(k * 3 + j) : k * 3 + j)),
          [a, b, c] = ids.map(at);
        out.push([a.add(b).add(c).divideScalar(3), partAt(ids[0])]);
      }
    });
    if (!out.length) out.push([obj.getWorldPosition(new THREE.Vector3()), obj.name || "point"]);
    if (out.length <= MAX_PROBES) return out;
    const stride = Math.ceil(out.length / MAX_PROBES);
    return out.filter((_, i) => i % stride === 0);
  };

  const worldVisible = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const ownerOf = (obj, objects) => {
    for (let p = obj; p; p = p.parent) if (objects?.some(([o]) => o === p)) return p;
    return obj;
  };
  const partsOf = (owner, bones, fallback) => {
    const boneName = new Map(Object.entries(bones ?? {}).map(([k, b]) => [b, k]));
    return (o) => {
      for (let p = o; p && p !== owner.parent; p = p.parent) {
        if (boneName.has(p)) return boneName.get(p);
        if (p.isBone && p.name) return p.name;
      }
      for (let p = o.parent; p && p !== owner.parent; p = p.parent) if (p.name) return p.name;
      return fallback;
    };
  };
  const onScreen = (camera, obj) => {
    camera.updateMatrixWorld();
    const view = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    return view.intersectsBox(new THREE.Box3().setFromObject(obj));
  };
  const frameOf = ({ scene, camera, objects }, { obj, owner, partOf, name }, t, step, last) => {
    const here = obj.getWorldPosition(new THREE.Vector3());
    const speed = last ? here.distanceTo(last) / step : 0;
    if (!worldVisible(obj))
      return [
        {
          t,
          d: Infinity,
          part: name,
          surface: "-",
          p: [0, 0, 0],
          speed,
          inFrame: false,
          shown: false,
        },
        here,
      ];
    const list = surfaces(scene, owner, objects);
    let best = { d: Infinity, part: name, surface: "-", p: [0, 0, 0] };
    for (const [p, part] of probes(obj, partOf)) {
      const g = gap(p, list);
      if (g.d < best.d) best = { ...g, part, p: p.toArray() };
    }
    const q = new THREE.Vector3(...best.p).project(camera);
    return [
      {
        t,
        ...best,
        speed,
        inFrame: q.z < 1 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1,
        shown: onScreen(camera, obj),
      },
      here,
    ];
  };
  const sample = async (tools, who, from, to, step) => {
    const frames = who.map(() => []),
      last = who.map(() => null);
    for (let i = 0, k = Math.floor((to - from) / step + 1e-9); i <= k; i++) {
      const t = Math.min(to, from + i * step);
      await draw(t);
      who.forEach((w, n) => {
        const [frame, here] = frameOf(tools, w, t, step, last[n]);
        frames[n].push(frame);
        last[n] = here;
      });
    }
    return frames;
  };
  const worstSheet = async (camera, worst) => {
    const gl = canvas(),
      shown = worst.slice(0, 6),
      TW = gl.width / 2,
      TH = gl.height / 2;
    const sheet = document.createElement("canvas");
    sheet.width = TW * Math.min(2, shown.length);
    sheet.height = TH * Math.ceil(shown.length / 2);
    const s = sheet.getContext("2d");
    for (const [k, x] of shown.entries()) {
      await draw(x.t);
      const x0 = (k % 2) * TW,
        y0 = Math.floor(k / 2) * TH;
      s.drawImage(gl, x0, y0, TW, TH);
      const q = new THREE.Vector3(...x.p).project(camera);
      if (q.z < 1) {
        s.strokeStyle = x.kind === "SINK" ? "#ff3030" : "#ffd84d";
        s.lineWidth = 3;
        s.beginPath();
        s.arc(x0 + ((q.x + 1) / 2) * TW, y0 + ((1 - q.y) / 2) * TH, 14, 0, 7);
        s.stroke();
      }
      s.font = "bold 16px Consolas, monospace";
      label(
        s,
        `${x.kind} ${x.t.toFixed(2)}: ${x.say}${q.z < 1 ? "" : " (behind the camera)"}`,
        x0 + 10,
        y0 + 24,
      );
      s.strokeStyle = "#000";
      s.lineWidth = 2;
      s.strokeRect(x0, y0, TW, TH);
    }
    return sheet;
  };

  const everyActor = async (tools, from, to) => {
    const { scene, camera, objects, bones } = tools;
    const actors = [];
    scene.traverse((o) => {
      if (o.soleNow) actors.push(o);
    });
    if (!actors.length)
      return [
        "ERROR --check touch without a target scans every actor (makePlayer from mc-actor); this film has none: --check touch:<target>,<from s>,<to s>",
      ];
    const who = actors.map((obj, n) => {
      const name = labelOf(objects, obj) === obj.type ? `actor ${n + 1}` : labelOf(objects, obj);
      const owner = ownerOf(obj, objects);
      return { obj, owner, name, partOf: partsOf(owner, bones, name) };
    });
    const frames = await sample(tools, who, from, to, WHOLE_STEP);
    const lines = [
      `touch ${from}-${to} s every ${WHOLE_STEP} s on ${who.length} actor${who.length === 1 ? "" : "s"} (${who.map((w) => w.name).join(", ")}); one in question: --check touch:<target>,<from s>,<to s> at 30 fps`,
    ];
    const worst = [],
      unseen = [];
    who.forEach((w, n) => {
      if (frames[n].every((x) => !x.shown)) return unseen.push(w.name);
      const r = summarize(w.name, frames[n]);
      lines.push(...r.lines);
      worst.push(...r.worst);
    });
    if (unseen.length)
      lines.push(`  off screen or hidden the whole span, not judged: ${unseen.join(", ")}`);
    if (worst.length) {
      worst.sort((a, b) => (a.kind === b.kind ? a.t - b.t : a.kind === "SINK" ? -1 : 1));
      lines.push({
        still: `touch_actors_${from}-${to}_worst.jpg`,
        canvas: await worstSheet(camera, worst),
      });
    }
    return lines;
  };

  return async (target, from, to, step = 1 / 30) => {
    if (typeof target !== "string" || !(to > from) || !(step > 0))
      return [
        "ERROR usage: --check touch:<target>,<from s>,<to s>, or --check touch:<from s>,<to s> for every actor",
      ];
    const tools = render.tools ?? {};
    if (!tools.scene || !tools.camera)
      return ["ERROR --check touch requires draw.tools.scene and draw.tools.camera on the film"];
    if (target === "") return everyActor(tools, from, to);
    const { camera, objects, bones } = tools;
    const obj = findTarget(tools, target);
    if (!obj || target === "cam") return [targetHelp(tools, target, { camera: false })];
    const owner = ownerOf(obj, objects);
    const [frames] = await sample(
      tools,
      [{ obj, owner, name: target, partOf: partsOf(owner, bones, target) }],
      from,
      to,
      step,
    );
    const { lines, worst } = summarize(target, frames);

    const tag = `touch_${target}_${from}-${to}`,
      gl = canvas();

    const c = chart(gl.width, 420, {
      from,
      to,
      top: 10,
      bottom: -10,
      unit: " cm",
      title: `${target}: gap to the nearest surface (cm; under 0 = inside; green = touching, red = sunk in)`,
    });
    c.g.fillStyle = "rgba(60,220,110,.15)";
    c.g.fillRect(c.L, c.Y(1), c.canvas.width - c.L - c.R, c.Y(-3) - c.Y(1));
    c.g.fillStyle = "rgba(255,60,60,.15)";
    c.g.fillRect(c.L, c.Y(-3), c.canvas.width - c.L - c.R, c.Y(-10) - c.Y(-3));
    c.g.strokeStyle = "#ffffff";
    c.g.lineWidth = 2.5;
    let pen = false;
    c.g.beginPath();
    for (const x of frames) {
      if (!Number.isFinite(x.d)) {
        pen = false;
        continue;
      }
      (pen ? c.g.lineTo : c.g.moveTo).call(c.g, c.X(x.t), c.Y(x.d * 100));
      pen = true;
    }
    c.g.stroke();
    worst.forEach((x, i) =>
      mark(c, x.t, x.kind === "SINK" ? "#ff4d4d" : "#ffd84d", x.kind, i % 3, [3, 3]),
    );
    lines.push({ still: `${tag}.jpg`, canvas: c.canvas });
    if (worst.length)
      lines.push({ still: `${tag}_worst.jpg`, canvas: await worstSheet(camera, worst) });
    return lines;
  };
};
