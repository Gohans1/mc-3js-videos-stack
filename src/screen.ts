// @ts-nocheck
// The CRT's picture (edit.json props.screen, documented in src/props.ts): a terminal in the game's font on a blue-grey
// glow with scanlines, the typing he does on it, and the screen's light on his face and the desk
import * as THREE from "three";
import { smooth } from "./ease";
import { DESK } from "./world";

const S = 1 / 16;

export function buildScreen(font, P, EDIT) {
  const W = 288, H = 224, SC = 2; // 9 x 7 model pixels of glass, 32 canvas pixels each
  const screenCanvas = document.createElement("canvas"); screenCanvas.width = W; screenCanvas.height = H;
  const sx = screenCanvas.getContext("2d");
  const tint = font.tinted("#b9d3df");
  const keystrokes = () => {
    const T = P().screen.typing, out = [];
    for (const tr of T?.tries ?? []) {
      for (let i = 0; i < tr.text.length; i++) out.push({ t: tr.t + i / tr.cps, hand: i % 2 ? "L" : "R", ch: tr.text[i] });
      out.push({ t: tr.t + tr.text.length / tr.cps + T.enter, hand: "R", ch: "Enter" });
    }
    return out;
  };
  // the terminal at time t: the fixed lines, then each try as far as it is typed and its reply; it scrolls past 11 lines
  const screenLines = (t) => {
    const S = P().screen, T = S.typing;
    if (!T) return S.lines;
    const lines = S.lines.slice(0, -1); // the last line is the empty prompt the first try is typed on
    let typing = false;
    for (const tr of T.tries) {
      if (t < tr.t) break;
      lines.push("> " + tr.text.slice(0, Math.floor((t - tr.t) * tr.cps) + 1));
      typing = t < tr.t + tr.text.length / tr.cps + T.enter + T.wait;
      if (typing) break;
      lines.push("  " + T.reply);
    }
    if (!typing) lines.push("> ");
    return lines.slice(-11);
  };
  let drawn = null;
  const paint = (lines, cursor) => {
    const key = lines.join("|") + cursor;
    if (drawn === key) return;
    drawn = key;
    const g = sx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, "#22394a"); g.addColorStop(1, "#0b141b");
    sx.fillStyle = g; sx.fillRect(0, 0, W, H);
    let y = 10, end = 0;
    for (const line of lines) { end = font.print(sx, tint, line, 12, y, SC); y += 9 * SC; }
    if (cursor) { sx.fillStyle = "#b9d3df"; sx.fillRect(end + 2, y - 9 * SC + 14, 10, 3); }
    sx.fillStyle = "rgba(0,0,0,.22)"; for (let r = 0; r < H; r += 4) sx.fillRect(0, r, W, 2); // scanlines
    tex.needsUpdate = true;
  };
  const tex = new THREE.CanvasTexture(screenCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(9 * S, 7 * S), new THREE.MeshBasicMaterial({ map: tex }));
  glass.material.color.setScalar(1.7); // brighter than paper white: the glow blooms a little, as a CRT in a dark room does
  // the CRT faces east; its glass (model x 3.5..12.5, y 3.5..10.5, z 6.75) lands at x 0.578, z 8.22..8.78, y 1.22..1.66
  glass.position.set(0.5785 + 0.002, 1 + 7 * S, DESK.z + 0.5);
  glass.rotation.y = Math.PI / 2;
  const glow = new THREE.PointLight(0x9fc3da, 0, 4.5, 1.6); // the screen's light on his face and the desk
  glow.position.set(0.95, 1.42, DESK.z + 0.5);
  paint(P().screen.lines, true);

  return {
    glass, glow, keystrokes,
    draw: (t) => {
      const Sc = P().screen, on = t >= Sc.on;
      glass.visible = on;
      glow.intensity = on ? EDIT.light.screen : 0;
      if (on) paint(screenLines(t), Math.floor((t - Sc.on) * 1.9) % 2 === 0);
    },
    // the lamp's level lv (scene.ts flickerAt): when it drops out the screen dies with it, as on one failing circuit
    dim: (lv) => { const k = smooth(lv / 0.3); glow.intensity *= k; glass.material.color.setScalar(1.7 * (0.04 + 0.96 * k)); },
  };
}
