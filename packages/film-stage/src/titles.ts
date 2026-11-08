// @ts-nocheck
// Words and shapes over the picture, CapCut's Text and Shapes: a title (a place, a year, a chapter), an arrow or a circle drawn
// round something, each on screen from `from` to `to` (the seconds draw(t) gets), placed by its anchor in the frame, with an In
// and an Out animation. The film keeps them in a file the studio edits (package.json "live-studio".textTimeline, {items: [...]})
// and calls the drawer last in draw, after the fade, so a title can sit on black; drafts and the final video carry them as the
// studio shows them. Sizes are pixels of a 1080-pixel short side, so a 9:16 film keeps the same proportions.
// An item with `at` [x, y, z] follows that world point through the film's camera (CapCut's Tracking, without the tracking).
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import * as THREE from "three";

// Three families (OFL, Fontsource): a clean sans for most titles, a typewriter mono for a documentary's place and time, a serif
// for a chapter card
export const FONTS = [
  { id: "sans", title: "Inter", css: "'Inter Variable', sans-serif" },
  { id: "mono", title: "Plex Mono", css: "'IBM Plex Mono', monospace" },
  { id: "serif", title: "Source Serif", css: "'Source Serif 4 Variable', serif" },
];
const fontOf = (id) => (FONTS.find((f) => f.id === id) ?? FONTS[0]).css;

// What the studio's Animation tab lists for each kind: id (stored as fx), title, len (the default seconds)
export const TEXT_IN = [
  { id: "fade", title: "Fade in", len: 0.5 },
  { id: "type", title: "Typewriter", len: 1 },
  { id: "up", title: "Slide up", len: 0.5 },
  { id: "zoom", title: "Zoom in", len: 0.5 },
  { id: "blur", title: "Blur", len: 0.6 },
];
export const TEXT_OUT = [
  { id: "fade", title: "Fade out", len: 0.5 },
  { id: "type", title: "Typewriter", len: 0.6 },
  { id: "down", title: "Slide down", len: 0.5 },
  { id: "zoom", title: "Zoom out", len: 0.5 },
  { id: "blur", title: "Blur", len: 0.6 },
];
export const SHAPE_IN = [
  { id: "draw", title: "Draw on", len: 0.5 },
  { id: "fade", title: "Fade in", len: 0.4 },
  { id: "zoom", title: "Zoom in", len: 0.4 },
];
export const SHAPE_OUT = [
  { id: "fade", title: "Fade out", len: 0.4 },
  { id: "zoom", title: "Zoom out", len: 0.4 },
];
export const KINDS = ["text", "arrow", "circle"];

// How far into its In (0 to 1, 1 once it is in) and how far from the end of its Out (1 until the Out starts, 0 at the end); null
// when the item is not on screen at t. An In and an Out longer than the item share it, each keeping its own share
export const phaseOf = (it, t) => {
  if (!(t >= it.from && t < it.to)) return null;
  const span = it.to - it.from, a = it.in?.fx ? it.in.len ?? 0.5 : 0, b = it.out?.fx ? it.out.len ?? 0.5 : 0, k = a + b > span ? span / (a + b) : 1;
  const inLen = a * k, outLen = b * k;
  return { in: inLen > 0 ? Math.min(1, (t - it.from) / inLen) : 1, out: outLen > 0 ? Math.min(1, (it.to - t) / outLen) : 1 };
};
// The characters a typewriter shows at p (0 to 1), never splitting a character made of two code units
export const typed = (text, p) => { const cs = [...text]; return cs.slice(0, Math.round(cs.length * Math.max(0, Math.min(1, p)))).join(""); };
const ease = (p) => 1 - (1 - p) ** 3; // ease-out cubic: arrives fast, settles

// The look of the moment: opacity, offset (in font sizes), scale, blur (px of 1080) and how much of the text or stroke shows
const look = (it, ph) => {
  const out = { alpha: 1, dy: 0, scale: 1, blur: 0, show: 1 };
  const apply = (fx, p) => {
    const e = ease(p);
    if (fx === "fade") out.alpha *= e;
    else if (fx === "type") out.show = Math.min(out.show, p);
    else if (fx === "draw") out.show = Math.min(out.show, e);
    else if (fx === "up" || fx === "down") { out.alpha *= e; out.dy += (1 - e) * 0.6; } // up comes from below, down leaves below
    else if (fx === "zoom") { out.alpha *= e; out.scale *= 0.8 + 0.2 * e; }
    else if (fx === "blur") { out.alpha *= e; out.blur += (1 - e) * 12; }
  };
  if (it.in?.fx) apply(it.in.fx, ph.in);
  if (it.out?.fx) apply(it.out.fx, ph.out);
  return out;
};

// Where an item's anchor is in the frame (0 to 1 each way): its own x, y, or its world point through the camera, plus x, y as
// an offset; null when that point is behind the camera
const v3 = new THREE.Vector3();
export const anchorOf = (it, camera) => {
  if (!it.at || !camera) return [it.x ?? 0.5, it.y ?? 0.5];
  v3.set(it.at[0], it.at[1], it.at[2]).project(camera);
  if (v3.z > 1) return null;
  return [(v3.x + 1) / 2 + (it.x ?? 0.5) - 0.5, (1 - v3.y) / 2 + (it.y ?? 0.5) - 0.5];
};

const lines = (it) => { const s = it.upper ? (it.text ?? "").toUpperCase() : it.text ?? ""; return s.split("\n"); };
const fontCss = (it, px) => `${it.italic ? "italic " : ""}${it.bold ? 700 : it.font === "mono" ? 400 : 500} ${px}px ${fontOf(it.font)}`;

// The item's box in frame pixels before its animation, rotation aside: x0, y0, w, h, and the anchor cx, cy it hangs from
const measure = (g, it, W, H, camera) => {
  const at = anchorOf(it, camera);
  if (!at) return null;
  const u = Math.min(W, H) / 1080, k = (it.scale ?? 1) * u, cx = at[0] * W, cy = at[1] * H;
  if (it.kind === "arrow") { const len = (it.size ?? 160) * k, w = (it.width ?? 10) * k; return { x0: cx - len / 2, y0: cy - w * 2.2, w: len, h: w * 4.4, cx, cy, k }; }
  if (it.kind === "circle") { const w = (it.w ?? 260) * k, h = (it.h ?? 170) * k; return { x0: cx - w / 2, y0: cy - h / 2, w, h, cx, cy, k }; }
  const px = (it.size ?? 56) * k, lh = px * (it.line ?? 1.2), ls = lines(it);
  g.font = fontCss(it, px);
  g.letterSpacing = `${(it.spacing ?? 0) * px}px`;
  const tw = Math.max(1, ...ls.map((l) => g.measureText(l).width)), pad = it.background ? px * 0.35 : 0;
  const w = tw + pad * 2, h = lh * ls.length + pad * 1.2, align = it.align ?? "center";
  const x0 = align === "left" ? cx : align === "right" ? cx - w : cx - w / 2;
  return { x0, y0: cy - h / 2, w, h, cx, cy, k, px, lh, ls, pad, align };
};

const drawText = (g, it, m, lk) => {
  const { px, lh, ls, pad, align } = m;
  g.font = fontCss(it, px);
  g.letterSpacing = `${(it.spacing ?? 0) * px}px`;
  g.textBaseline = "middle";
  g.textAlign = align;
  if (it.background) {
    const bg = it.background;
    g.globalAlpha = lk.alpha * (bg.opacity ?? 0.6);
    g.fillStyle = bg.color ?? "#000000";
    g.beginPath(); g.roundRect(m.x0, m.y0, m.w, m.h, px * 0.18); g.fill();
    g.globalAlpha = lk.alpha;
  }
  const tx = align === "left" ? m.x0 + pad : align === "right" ? m.x0 + m.w - pad : m.x0 + m.w / 2;
  // A typewriter shows the text a character at a time across all its lines
  const total = ls.reduce((n, l) => n + [...l].length, 0);
  let left = Math.round(total * lk.show);
  ls.forEach((l, i) => {
    const s = typed(l, left / Math.max(1, [...l].length));
    left = Math.max(0, left - [...l].length);
    if (!s) return;
    const y = m.y0 + pad * 0.6 + lh * (i + 0.5);
    if (it.shadow !== false) { g.shadowColor = "rgba(0,0,0,0.55)"; g.shadowBlur = px * 0.25; g.shadowOffsetY = px * 0.04; }
    if (it.stroke) { g.lineJoin = "round"; g.strokeStyle = it.stroke.color ?? "#000000"; g.lineWidth = (it.stroke.width ?? 6) * m.k; g.strokeText(s, tx, y); g.shadowColor = "transparent"; }
    g.fillStyle = it.color ?? "#FFFFFF";
    g.fillText(s, tx, y);
    g.shadowColor = "transparent";
  });
};

const drawShape = (g, it, m, lk) => {
  const w = (it.width ?? 10) * m.k;
  g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = it.color ?? "#E5484D"; g.lineWidth = w;
  g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = w * 1.2;
  g.beginPath();
  if (it.kind === "circle") {
    // Starts at the top and goes round clockwise, a little past the start as a hand would
    const a0 = -Math.PI / 2, sweep = Math.PI * 2.08 * lk.show;
    g.ellipse(m.cx, m.cy, m.w / 2, m.h / 2, 0, a0, a0 + sweep);
    g.stroke();
  } else {
    // Points along +x before its rotation: the shaft from the tail, the head once the shaft is drawn
    const x0 = m.x0, x1 = m.x0 + m.w, head = Math.min(m.w * 0.35, w * 4), shaft = x0 + (x1 - x0) * Math.min(1, lk.show / 0.8);
    g.moveTo(x0, m.cy); g.lineTo(shaft, m.cy); g.stroke();
    const hp = Math.max(0, (lk.show - 0.8) / 0.2);
    if (hp > 0) { g.beginPath(); g.moveTo(x1 - head * hp, m.cy - head * 0.7 * hp); g.lineTo(x1, m.cy); g.lineTo(x1 - head * hp, m.cy + head * 0.7 * hp); g.stroke(); }
  }
  g.shadowColor = "transparent";
};

// The items on screen at t, in drawing order (a higher track over a lower one, as CapCut's tracks are), with their boxes
const onScreen = (g, list, t, W, H, camera) => {
  const out = [];
  (list ?? []).forEach((it, i) => {
    const ph = phaseOf(it, t);
    if (!ph || it.hidden) return;
    const m = measure(g, it, W, H, camera);
    if (m) out.push({ it, i, ph, m });
  });
  return out.sort((a, b) => (a.it.track ?? 0) - (b.it.track ?? 0) || a.i - b.i);
};

// Draws them onto the frame the renderer just drew. Call last in draw (after the fade); skip while the free camera is on. The
// drawer also gives the studio each item's box at t (in 0 to 1 of the frame) to pick and drag it on the picture
export function makeTitles(renderer, W, H) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat), scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  quad.frustumCulled = false;
  scene.add(quad);
  let last = "";
  // The faces load before the first frame is drawn (a draft's first frame and a final's are the same as the studio's); a family
  // a title never used loads in the background the first time it is needed
  const ready = Promise.all(FONTS.flatMap((f) => [400, 700].map((w) => document.fonts.load(`${w} 40px ${f.css}`, "AÀaà0")))).catch(() => {});
  const draw = (list, t, camera) => {
    const now = onScreen(g, list, t, W, H, camera);
    if (!now.length) { last = ""; return; }
    const key = JSON.stringify(now.map(({ it, ph, m }) => [it, ph, m.cx, m.cy]));
    if (key !== last) {
      last = key;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      for (const { it, ph, m } of now) {
        const lk = look(it, ph);
        if (lk.alpha <= 0.001) continue;
        g.save();
        g.globalAlpha = lk.alpha * (it.opacity ?? 1);
        g.filter = lk.blur > 0.05 ? `blur(${lk.blur * m.k}px)` : "none";
        g.translate(m.cx, m.cy + lk.dy * (m.px ?? m.h));
        g.rotate(((it.rotate ?? 0) * Math.PI) / 180);
        g.scale(lk.scale, lk.scale);
        g.translate(-m.cx, -m.cy);
        if (it.kind === "arrow" || it.kind === "circle") drawShape(g, it, m, lk); else drawText(g, it, m, lk);
        g.restore();
      }
      tex.needsUpdate = true;
    }
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(scene, cam);
    renderer.autoClear = auto;
  };
  draw.ready = ready;
  // What the studio's Text tab lists: the families and each kind's In and Out
  draw.fonts = FONTS;
  draw.anims = { text: { in: TEXT_IN, out: TEXT_OUT }, shape: { in: SHAPE_IN, out: SHAPE_OUT } };
  // Each item on screen at t: its place in the list and its box (x0, y0, x1, y1 in 0 to 1 of the frame), top-most last
  draw.boxes = (list, t, camera) => onScreen(g, list, t, W, H, camera).map(({ i, m }) => ({ i, box: [m.x0 / W, m.y0 / H, (m.x0 + m.w) / W, (m.y0 + m.h) / H] }));
  return draw;
}
