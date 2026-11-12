// @ts-nocheck
// CHECK=seen:<target>,<from>,<to>[,<step s>], built in for every film: can the audience see the target through the film's
// own camera, every frame (default step 1/30 s)? Measured the way engines test visibility (an ID buffer): a second
// renderer draws every mesh in one flat colour per draw.tools.objects label, the target in its own, then the target alone,
// through the film's camera with its view widened 3x, so what falls outside the real frame is counted too (beyond 3x: not). Counting
// colours gives how much of the frame it fills, how much of it is behind something (and behind what), how much is cut off
// by the frame edge; the film's real frame gives how bright it is. Textures keep their cut-outs (leaves, bars, glass),
// see-through materials (opacity under 0.5) never hide anything. Prints the numbers and faults (checks/seen.mjs), writes
//   seen_<target>_<from>-<to>.jpg  the chart: frame share, hidden, cut off, brightness over time
//   seen_<target>_<from>-<to>_worst.jpg  the worst frame of each fault: green outline = seen, red = hidden, with what it is
import * as THREE from "three";

import { summarize } from "../checks/seen.mjs";
import { sizeOf } from "../src/frame.ts";
import { canvas } from "./lab";
import { chart, findTarget, inside, label, labelOf, mark, targetHelp } from "./target";

const WIDE = 3,
  TARGET = 1,
  OTHER = 4095;

export const seenCheck = (render, cfg) => {
  const [W2, H2] = sizeOf(cfg.ratio, 960),
    FW = W2 / WIDE,
    FH = H2 / WIDE,
    X0 = (W2 - FW) / 2,
    Y0 = (H2 - FH) / 2; // the real frame: FW x FH at X0, Y0
  let gl2, rt, buf, small;
  const idMats = new Map(),
    hide = new THREE.MeshBasicMaterial({ visible: false });
  const idMat = (src, id) => {
    if (!src || src.visible === false) return hide;
    const key = `${src.uuid}:${id}`;
    if (!idMats.has(key)) {
      const see = src.transparent && (src.opacity ?? 1) < 0.5;
      const m = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(
          (id & 255) / 255,
          (id >> 8) / 255,
          0,
          THREE.LinearSRGBColorSpace,
        ),
        map: src.map ?? null,
        alphaMap: src.alphaMap ?? null,
        opacity: src.opacity ?? 1,
        alphaTest: src.alphaTest || (src.transparent ? 0.5 : 0),
        side: src.side ?? THREE.FrontSide,
        toneMapped: false,
        fog: false,
      });
      // the texture and vertex colours only for their alpha: every pixel of a mesh is exactly its ID
      m.onBeforeCompile = (s) => {
        s.fragmentShader = s.fragmentShader.replace(
          "#include <color_fragment>",
          "#include <color_fragment>\n\tdiffuseColor.rgb = diffuse;",
        );
      };
      m.customProgramCacheKey = () => "seen-id";
      idMats.set(key, see ? hide : m);
    }
    return idMats.get(key);
  };

  // two ID passes through the widened camera: everything (target = TARGET), then the target alone
  const passes = (tools, obj) => {
    const { scene, camera, objects } = tools;
    if (!gl2) {
      gl2 = new THREE.WebGLRenderer({ antialias: false });
      rt = new THREE.WebGLRenderTarget(W2, H2, { depthBuffer: true });
      buf = [new Uint8Array(W2 * H2 * 4), new Uint8Array(W2 * H2 * 4)];
    }
    // a parentless copy placed where the film camera is in the world (the renderer recomputes a parentless camera's matrix)
    const wide = new THREE.PerspectiveCamera().copy(camera, false);
    camera.matrixWorld.decompose(wide.position, wide.quaternion, wide.scale);
    wide.fov = (2 * Math.atan(WIDE * Math.tan((camera.fov * Math.PI) / 360)) * 180) / Math.PI;
    wide.updateProjectionMatrix();
    const ids = new Map((objects ?? []).map(([, l], i) => [l, i + 2])),
      names = new Map([...ids].map(([l, i]) => [i, l]));
    const meshes = [],
      off = [],
      keep = { bg: scene.background, fog: scene.fog, over: scene.overrideMaterial };
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = null;
    scene.traverseVisible((o) => {
      if (o.isMesh)
        meshes.push([
          o,
          inside(obj, o) ? TARGET : (ids.get(labelOf(objects, o)) ?? OTHER),
          o.material,
        ]);
      else if (o.isSprite || o.isPoints || o.isLine) {
        off.push(o);
        o.visible = false;
      }
    });
    gl2.setRenderTarget(rt);
    gl2.setClearColor(0x000000, 1);
    for (const [k, alone] of [
      [0, false],
      [1, true],
    ]) {
      for (const [o, id, m0] of meshes) {
        const mat = (m) => (alone && id !== TARGET ? hide : idMat(m, id));
        o.material = Array.isArray(m0) ? m0.map(mat) : mat(m0);
      }
      gl2.clear();
      gl2.render(scene, wide);
      gl2.readRenderTargetPixels(rt, 0, 0, W2, H2, buf[k]);
      for (const [o, , m0] of meshes) o.material = m0;
    }
    gl2.setRenderTarget(null);
    for (const o of off) o.visible = true;
    Object.assign(scene, { background: keep.bg, fog: keep.fog, overrideMaterial: keep.over });
    return { all: buf[0], alone: buf[1], names };
  };

  // one frame: render(t) poses the film and draws its real frame, then the ID passes measure the target
  const measureAt = (t, obj) => {
    render(t);
    const gl = canvas();
    if (!small) {
      small = document.createElement("canvas");
      small.width = FW;
      small.height = FH;
    }
    const sc = small.getContext("2d", { willReadFrequently: true });
    sc.drawImage(gl, 0, 0, small.width, small.height);
    const rgb = sc.getImageData(0, 0, small.width, small.height).data;
    const { all, alone, names } = passes(render.tools, obj);
    const id = (b, i) => b[i * 4] + (b[i * 4 + 1] << 8);
    let A = 0,
      Ac = 0,
      V = 0,
      lum = 0,
      flum = 0;
    const by = {};
    for (let y = 0; y < H2; y++)
      for (let x = 0; x < W2; x++) {
        const i = y * W2 + x,
          mid = x >= X0 && x < X0 + FW && y >= Y0 && y < Y0 + FH;
        if (id(alone, i) === TARGET) {
          A++;
          if (mid) Ac++;
        }
        if (!mid) continue;
        // render targets are read bottom row first, the 2D canvas top row first
        const j = (Y0 + FH - 1 - y) * FW + (x - X0),
          l = (0.2126 * rgb[j * 4] + 0.7152 * rgb[j * 4 + 1] + 0.0722 * rgb[j * 4 + 2]) / 255;
        flum += l;
        const here = id(all, i);
        if (here === TARGET) {
          V++;
          lum += l;
        } else if (id(alone, i) === TARGET) {
          const who = names.get(here) ?? (here === OTHER ? "other" : "?");
          by[who] = (by[who] ?? 0) + 1;
        }
      }
    for (const k in by) by[k] /= Ac || 1;
    const px = FW * FH;
    return {
      t,
      share: V / px,
      hidden: Ac ? 1 - V / Ac : 0,
      by,
      cut: A ? 1 - Ac / A : 0,
      luma: V ? lum / V : 0,
      frameLuma: flum / px,
      alone: A,
      masks: { all, alone },
    };
  };

  return async (target, from, to, step = 1 / 30) => {
    if (typeof target !== "string" || !(to > from) || !(step > 0))
      return ["ERROR usage: CHECK=seen:<target>,<from s>,<to s>[,<step s>]"];
    const obj = findTarget(render.tools, target);
    if (!obj || target === "cam") return [targetHelp(render.tools, target, { camera: false })];
    if (!render.tools.camera.isPerspectiveCamera)
      return ["ERROR seen: the film camera is not a PerspectiveCamera"];
    const frames = [];
    for (let i = 0, n = Math.round((to - from) / step); i <= n; i++) {
      const fr = measureAt(from + i * step, obj);
      delete fr.masks;
      frames.push(fr);
    }
    const { lines, worst } = summarize(target, frames);
    const tag = `seen_${target}_${from}-${to}`,
      gl = canvas();

    const c = chart(gl.width, 420, {
      from,
      to,
      top: 1,
      title: `${target}: frame share x2 (white), hidden (red), cut off (orange), brightness x2 (yellow)`,
    });
    const line = (key, color, k = 1) => {
      c.g.strokeStyle = color;
      c.g.lineWidth = 2.5;
      c.g.beginPath();
      frames.forEach((x, i) =>
        (i ? c.g.lineTo : c.g.moveTo).call(c.g, c.X(x.t), c.Y(Math.min(1, x[key] * k))),
      );
      c.g.stroke();
    };
    line("share", "#ffffff", 2);
    line("hidden", "#ff4d4d");
    line("cut", "#ff9f1a");
    line("luma", "#ffd84d", 2);
    worst.forEach((w, i) => mark(c, w.t, "#9aa0a6", w.kind, i % 3, [3, 3]));
    lines.push({ still: `${tag}.jpg`, canvas: c.canvas });

    // the worst frames, 2 across: the film's frame, the target outlined green where seen, tinted red where hidden
    if (worst.length) {
      const shown = worst.slice(0, 6),
        TW = gl.width / 2,
        TH = gl.height / 2;
      const sheet = document.createElement("canvas");
      sheet.width = TW * Math.min(2, shown.length);
      sheet.height = TH * Math.ceil(shown.length / 2);
      const s = sheet.getContext("2d");
      const tint = document.createElement("canvas");
      tint.width = FW;
      tint.height = FH;
      const tc = tint.getContext("2d"),
        img = tc.createImageData(tint.width, tint.height);
      shown.forEach((w, k) => {
        const { masks } = measureAt(w.t, obj),
          x0 = (k % 2) * TW,
          y0 = Math.floor(k / 2) * TH;
        s.drawImage(gl, x0, y0, TW, TH);
        const at = (b, x, y) => {
          const i = ((Y0 + FH - 1 - y) * W2 + (x + X0)) * 4;
          return b[i] === TARGET && b[i + 1] === 0;
        };
        for (let y = 0; y < FH; y++)
          for (let x = 0; x < FW; x++) {
            const seen = at(masks.all, x, y),
              edge =
                seen &&
                [
                  [1, 0],
                  [-1, 0],
                  [0, 1],
                  [0, -1],
                ].some(
                  ([dx, dy]) =>
                    !at(
                      masks.all,
                      Math.min(FW - 1, Math.max(0, x + dx)),
                      Math.min(FH - 1, Math.max(0, y + dy)),
                    ),
                );
            img.data.set(
              edge
                ? [40, 255, 90, 255]
                : !seen && at(masks.alone, x, y)
                  ? [255, 40, 40, 120]
                  : [0, 0, 0, 0],
              (y * FW + x) * 4,
            );
          }
        tc.putImageData(img, 0, 0);
        s.drawImage(tint, x0, y0, TW, TH);
        s.font = "bold 16px Consolas, monospace";
        label(s, `${w.kind} ${w.t.toFixed(2)}: ${w.say}`, x0 + 10, y0 + 24, "#fff");
        s.strokeStyle = "#000";
        s.lineWidth = 2;
        s.strokeRect(x0, y0, TW, TH);
      });
      lines.push({ still: `${tag}_worst.jpg`, canvas: sheet });
    }
    return lines;
  };
};
