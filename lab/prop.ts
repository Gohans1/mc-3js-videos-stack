// @ts-nocheck
// Lab: one build of the film, then free-camera stills of a prop from fixed spots (renders/prop_N.jpg), for judging a
// new block model up close without touching the film's cameras.
// ENTRY=lab/prop.ts AT=0 node src/render.mjs stills
import { buildScene } from "../src/scene";

const VIEWS = [
  { p: [2.6, 2.0, 8.5], l: [0.5, 1.25, 8.5], fov: 38 }, // straight on, from the chair side
  { p: [2.2, 2.3, 10.2], l: [0.5, 1.2, 8.5], fov: 40 }, // three-quarter from the door side
  { p: [6.6, 1.9, 8.6], l: [4.5, 0.4, 6.0], fov: 45 }, // the bed from its foot side
];
const post = (url, body) => fetch(url, { method: "POST", body });
window.onerror = (m) => { post("/log", "ERROR " + m); };
window.onunhandledrejection = (e) => { post("/log", "ERROR " + (e.reason?.stack ?? e.reason)); };
(async () => {
  const cfg = await (await fetch("/config")).json();
  const c = document.getElementById("gl");
  const draw = await buildScene(c, cfg.W, cfg.H, false);
  const { free } = draw.tools;
  free.on = true;
  for (const [i, v] of VIEWS.entries()) {
    free.p.set(...v.p); free.l.set(...v.l); free.fov = v.fov;
    draw(12);
    await post(`/still/prop_${i}.jpg`, await new Promise((res) => c.toBlob(res, "image/jpeg", 0.92)));
  }
  await post("/done", "");
})();
