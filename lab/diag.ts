// @ts-nocheck
// Lab: one build of the film; prints where Steve's bones are at a moment, for placing him and the camera by numbers.
// ENTRY=lab/diag.ts node src/render.mjs stills
import * as THREE from "three";
import { buildScene } from "../src/scene";

const post = (url, body) => fetch(url, { method: "POST", body });
window.onerror = (m) => { post("/log", "ERROR " + m); };
window.onunhandledrejection = (e) => { post("/log", "ERROR " + (e.reason?.stack ?? e.reason)); };
(async () => {
  const cfg = await (await fetch("/config")).json();
  const draw = await buildScene(document.getElementById("gl"), cfg.W, cfg.H, true);
  draw(4);
  const v = new THREE.Vector3(), out = [];
  for (const [k, b] of Object.entries(draw.tools.bones)) { b.getWorldPosition(v); out.push(`${k} ${v.toArray().map((n) => n.toFixed(2)).join(",")}`); }
  const box = new THREE.Box3().setFromObject(draw.tools.rig);
  out.push(`box ${box.min.toArray().map((n) => n.toFixed(2))} .. ${box.max.toArray().map((n) => n.toFixed(2))}`);
  out.push(`camera ${draw.tools.camera.position.toArray().map((n) => n.toFixed(2))}`);
  await post("/log", out.join(" | "));
  await post("/done", "");
})();
