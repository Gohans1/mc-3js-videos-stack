// @ts-nocheck
// Lab: one build of the film; prints where Steve's joints, hands and the props are at moments, for placing Steve, the
// camera and the props by numbers. AT=40,58 ENTRY=lab/diag.ts node src/render.mjs stills
import * as THREE from "three";
import { buildScene } from "../src/scene";

const post = (url, body) => fetch(url, { method: "POST", body });
window.onerror = (m) => { post("/log", "ERROR " + m); };
window.onunhandledrejection = (e) => { post("/log", "ERROR " + (e.reason?.stack ?? e.reason)); };
const f = (v) => v.toArray().map((n) => n.toFixed(2)).join(",");
(async () => {
  const cfg = await (await fetch("/config")).json();
  const draw = await buildScene(document.getElementById("gl"), cfg.W, cfg.H, true);
  const { bones, objects } = draw.tools;
  const v = new THREE.Vector3();
  for (const s of cfg.stills) {
    const t = s.frame / 30;
    draw(t);
    const out = [`t=${t.toFixed(2)}`];
    for (const k of ["root", "head", "uaR", "laR", "uaL"]) out.push(`${k} ${f(bones[k].getWorldPosition(v))}`);
    // the eyes (the face's two white planes) and where the face points, for cameras placed off his line of sight
    const whites = [];
    bones.head.traverse((o) => { if (o.isMesh && o.geometry.type === "PlaneGeometry" && o.material.color?.getHexString() === "f4f4f4") whites.push(o); });
    if (whites.length === 2) {
      const mid = whites[0].getWorldPosition(new THREE.Vector3()).add(whites[1].getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
      out.push(`eyes ${f(mid)} facing ${f(new THREE.Vector3(0, 0, 1).transformDirection(whites[0].matrixWorld))}`);
    }
    out.push(`camera ${f(draw.tools.camera.position)}`);
    for (const [o, name] of objects.slice(2)) out.push(`${name.split(" (")[0]} ${f(new THREE.Box3().setFromObject(o).min)}..${f(new THREE.Box3().setFromObject(o).max)}`);
    await post("/log", out.join(" | "));
  }
  await post("/done", "");
})();
