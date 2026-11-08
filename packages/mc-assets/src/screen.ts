// @ts-nocheck
// The picture on the props' computer (gohans:computer*, facing east): a terminal in the game's font on a blue-grey glow with
// scanlines, the typing done on it, and the screen's light on the face in front of it and the desk.
//   buildScreen(font, { at, keys, power, facing?, phosphor? })  at: the computer's block [x, y, z]; facing: its blockstate
//   facing (default east); phosphor: "blue" (default), "green", "red" or "amber", the text, glass and light colour; keys(): {on, lines,
//   typing?, clock?} (a film's props.json screen: on, the second it lights; lines, the terminal text, the last one the empty
//   prompt, "{clock}" in a line a countdown mm:ss; clock {at, from}: from seconds left at film second at, held at 00:00;
//   typing {tries: [{t, text, cps}], enter, wait, reply}); power(): the glow's intensity. dim(lv) follows a failing lamp's level.
import * as THREE from "three";
import { smooth } from "mc-actor/ease";

const S = 1 / 16;

const PHOSPHOR = {
  blue: { ink: "#b9d3df", mid: "#22394a", edge: "#0b141b", light: 0x9fc3da },
  green: { ink: "#7dff8a", mid: "#0f3315", edge: "#040d06", light: 0x7fe08f },
  red: { ink: "#ff6a5a", mid: "#3d0d0b", edge: "#120303", light: 0xff4a3a },
  amber: { ink: "#ffc65a", mid: "#3a2808", edge: "#110b02", light: 0xffb84a },
};
// which way each blockstate facing turns the computer: its screen's outward direction in x, z
const DIR = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] };
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function buildScreen(font, { at, keys, power, facing = "east", phosphor = "blue" }) {
  const C = PHOSPHOR[phosphor], [dx, dz] = DIR[facing];
  const W = 288, H = 224, SC = 2; // 9 x 7 model pixels of glass, 32 canvas pixels each
  const screenCanvas = document.createElement("canvas"); screenCanvas.width = W; screenCanvas.height = H;
  const sx = screenCanvas.getContext("2d");
  const tint = font.tinted(C.ink);
  const keystrokes = () => {
    const T = keys().typing, out = [];
    for (const tr of T?.tries ?? []) {
      for (let i = 0; i < tr.text.length; i++) out.push({ t: tr.t + i / tr.cps, hand: i % 2 ? "L" : "R", ch: tr.text[i] });
      out.push({ t: tr.t + tr.text.length / tr.cps + T.enter, hand: "R", ch: "Enter" });
    }
    return out;
  };
  // the terminal at time t: the fixed lines, then each try as far as it is typed and its reply; it scrolls past 11 lines
  const screenLines = (t) => {
    const Sc = keys(), T = Sc.typing;
    const clock = Sc.clock ? mmss(Math.max(0, Sc.clock.from - Math.max(0, t - Sc.clock.at))) : "";
    const fixed = Sc.lines.map((l) => l.replace("{clock}", clock));
    if (!T) return fixed;
    const lines = fixed.slice(0, -1); // the last line is the empty prompt the first try is typed on
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
    g.addColorStop(0, C.mid); g.addColorStop(1, C.edge);
    sx.fillStyle = g; sx.fillRect(0, 0, W, H);
    let y = 10, end = 0;
    for (const line of lines) { end = font.print(sx, tint, line, 12, y, SC); y += 9 * SC; }
    if (cursor) { sx.fillStyle = C.ink; sx.fillRect(end + 2, y - 9 * SC + 14, 10, 3); }
    sx.fillStyle = "rgba(0,0,0,.22)"; for (let r = 0; r < H; r += 4) sx.fillRect(0, r, W, 2); // scanlines
    tex.needsUpdate = true;
  };
  const tex = new THREE.CanvasTexture(screenCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(9 * S, 7 * S), new THREE.MeshBasicMaterial({ map: tex }));
  glass.material.color.setScalar(1.7); // brighter than paper white: the glow blooms a little, as a CRT in a dark room does
  // the glass (model x 3.5..12.5, y 3.5..10.5, z 6.75, the model facing north) sits 0.078 out from the block's middle
  // along its facing, 7/16 up
  glass.position.set(at[0] + 0.5 + 0.0805 * dx, at[1] + 7 * S, at[2] + 0.5 + 0.0805 * dz);
  glass.rotation.y = Math.atan2(dx, dz);
  const glow = new THREE.PointLight(C.light, 0, 4.5, 1.6); // the screen's light on his face and the desk
  glow.position.set(at[0] + 0.5 + 0.45 * dx, at[1] + 0.42, at[2] + 0.5 + 0.45 * dz);
  paint(screenLines(0), true);

  return {
    glass, glow, keystrokes,
    draw: (t) => {
      const Sc = keys(), on = t >= Sc.on;
      glass.visible = on;
      glow.intensity = on ? power() : 0;
      if (on) paint(screenLines(t), Math.floor((t - Sc.on) * 1.9) % 2 === 0);
    },
    // a lamp's level lv (0..1): when it drops out the screen dies with it, as on one failing circuit
    dim: (lv) => { const k = smooth(lv / 0.3); glow.intensity *= k; glass.material.color.setScalar(1.7 * (0.04 + 0.96 * k)); },
  };
}
