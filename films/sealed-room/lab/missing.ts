// @ts-nocheck
// Lab: lists every mesh whose texture is block-model-renderer's magenta/black "missing" checker, by object, so a prop
// with a wrong texture or model name is caught before a still shows it. ENTRY=lab/missing.ts AT=1 bun run render stills
import * as THREE from "three";
import { buildScene } from "../src/scene";
import { canvas, config, done, log } from "live-studio/lab";

(async () => {
  const cfg = await config();
  const draw = await buildScene(canvas(), cfg.W, cfg.H, true);
  draw(80);
  const c = document.createElement("canvas"), x = c.getContext("2d", { willReadFrequently: true });
  const bad = new Map();
  const magenta = (img) => {
    if (!img?.width) return false;
    c.width = img.width; c.height = img.height; x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 40 && d[i + 2] > 200) n++;
    return n > d.length / 4 / 8;
  };
  draw.tools.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) for (const k of ["map", "emissiveMap"]) {
      const img = m?.[k]?.image;
      if (img && magenta(img)) {
        let p = o, path = [];
        while (p) { path.push(p.name || p.type); p = p.parent; }
        const box = new THREE.Box3().setFromObject(o);
        bad.set(path.slice(0, 4).join("<") + ` ${box.min.toArray().map((n) => n.toFixed(2))}..${box.max.toArray().map((n) => n.toFixed(2))} ${o.userData.element?.name ?? ""}`, 1);
      }
    }
  });
  await log(bad.size ? [...bad.keys()].join("\n") : "no missing textures");
  await done();
})();
