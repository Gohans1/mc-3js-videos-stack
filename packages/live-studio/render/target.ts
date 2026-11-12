// @ts-nocheck
// What the built-in checks (motion, seen, touch) look at and how they draw: a target by name, the label of whatever an
// object belongs to, and the time chart they all print.
//   target: "cam" (the film camera), a key of draw.tools.bones, any object's .name (mc-actor: handR, handL), or a
//   draw.tools.objects label ("Steve")

export const findTarget = ({ scene, camera, bones, objects }, name) =>
  name === "cam"
    ? camera
    : (bones?.[name] ??
      scene.getObjectByName(name) ??
      objects?.find(([, label]) => label === name)?.[0] ??
      null);

// the names a target can take, the closest to a wrong one first: case, then a letter or two off
const close = (a, b) => {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};
export const targetHelp = ({ bones, objects }, name, { camera = true } = {}) => {
  const names = [
    ...(camera ? ["cam"] : []),
    ...Object.keys(bones ?? {}),
    ...(objects ?? []).map(([, l]) => l),
  ];
  const near = names
    .filter((n) => close(name, n) <= 2)
    .sort((a, b) => close(name, a) - close(name, b));
  const why =
    !camera && name === "cam"
      ? `this check looks at an object in the frame, not the camera`
      : `no "${name}"${
          near.length
            ? `: did you mean ${near
                .slice(0, 3)
                .map((n) => `"${n}"`)
                .join(" or ")}? (names match case)`
            : ""
        }`;
  return `ERROR ${why}. Targets: ${camera ? "the camera: cam; " : ""}bones: ${Object.keys(bones ?? {}).join(", ") || "none"}; objects: ${(objects ?? []).map(([, l]) => l).join(", ") || "none"}; or any object's .name`;
};

// the draw.tools.objects label of the nearest ancestor that has one, else the object's own name
export const labelOf = (objects, o) => {
  for (let p = o; p; p = p.parent) {
    const hit = objects?.find(([x]) => x === p);
    if (hit) return hit[1];
  }
  return o.name || o.type;
};

export const inside = (root, o) => {
  for (let p = o; p; p = p.parent) if (p === root) return true;
  return false;
};

// blue (0) to red (1)
export const hue = (x) => `hsl(${Math.round(240 * (1 - Math.min(1, Math.max(0, x))))} 95% 55%)`;

export const label = (ctx, text, x, y, color = "#fff", align = "left") => {
  ctx.textAlign = align;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
};

// A W x G chart of film seconds from..to against bottom..top: grid, axis numbers, title; X(t), Y(v) place points on it
export function chart(W, G, { from, to, top, bottom = 0, title, unit = "" }) {
  const L = 64,
    R = 24,
    T = 40,
    B = 46;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = G;
  const g = canvas.getContext("2d");
  g.fillStyle = "#14161a";
  g.fillRect(0, 0, W, G);
  const X = (t) => L + ((t - from) / (to - from)) * (W - L - R),
    Y = (v) =>
      G - B - ((Math.min(top, Math.max(bottom, v)) - bottom) / (top - bottom)) * (G - T - B);
  g.font = "13px Consolas, monospace";
  g.lineWidth = 1;
  const ystep =
    [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50].find((s) => (top - bottom) / s <= 8) ??
    (top - bottom) / 5;
  for (let v = Math.ceil(bottom / ystep - 1e-9) * ystep; v <= top + 1e-9; v += ystep) {
    g.strokeStyle = "#2a2e35";
    g.beginPath();
    g.moveTo(L, Y(v));
    g.lineTo(W - R, Y(v));
    g.stroke();
    label(g, `${+v.toFixed(2)}${unit}`, L - 8, Y(v) + 4, "#9aa0a6", "right");
  }
  const span = to - from,
    tstep = span <= 3 ? 0.1 : span <= 12 ? 0.5 : span <= 60 ? 1 : 5;
  for (let k = Math.ceil(from / tstep - 1e-9), i = 0; k * tstep <= to + 1e-9 && i < 400; k++, i++) {
    const t = k * tstep,
      major = Math.abs(t / (tstep * 5) - Math.round(t / (tstep * 5))) < 1e-6;
    g.strokeStyle = major ? "#3a3f47" : "#22262c";
    g.beginPath();
    g.moveTo(X(t), T);
    g.lineTo(X(t), G - B);
    g.stroke();
    if (major) label(g, t.toFixed(tstep < 1 ? 1 : 0), X(t), G - B + 18, "#9aa0a6", "center");
  }
  g.font = "bold 16px Consolas, monospace";
  label(g, title, L, 24);
  g.font = "13px Consolas, monospace";
  label(g, "heard seconds", W - R, G - 10, "#9aa0a6", "right");
  return { canvas, g, X, Y, T, B, L, R };
}

// a vertical line across the chart with a word at its top
export const mark = (c, t, color, word, row = 0, dash = []) => {
  const { g, X, T, B } = c,
    H = g.canvas.height;
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.setLineDash(dash);
  g.beginPath();
  g.moveTo(X(t), T);
  g.lineTo(X(t), H - B);
  g.stroke();
  g.restore();
  g.font = "13px Consolas, monospace";
  if (word) label(g, word, X(t) + 4, T + 14 + row * 14, color);
};
