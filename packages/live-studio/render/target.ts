// @ts-nocheck

export const pairOf = (entry) => (Array.isArray(entry) ? entry : entry ? [entry, entry.name ?? ""] : [null, ""]);

const findBoneOn = (node, seg) => {
  const map = node?.userData?.bones;
  if (!map || typeof map !== "object") return null;
  if (map[seg]) return map[seg];
  const lower = seg.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === lower && v) return v;
  }
  return null;
};

const findChildByNameInsensitive = (parent, lower) => {
  let hit = null;
  const walk = (node) => {
    for (const child of node?.children ?? []) {
      if (hit) return;
      if (child.name?.toLowerCase() === lower) {
        hit = child;
        return;
      }
      walk(child);
    }
  };
  walk(parent);
  return hit;
};

const findChild = (parent, seg) => {
  if (!parent) return null;
  for (const child of parent.children ?? []) {
    const hit = child.getObjectByName?.(seg) ?? (child.name === seg ? child : null);
    if (hit) return hit;
  }
  const own = parent.children?.length ? null : (parent.getObjectByName?.(seg) ?? null);
  if (own) return own;
  return findBoneOn(parent, seg) ?? findChildByNameInsensitive(parent, seg.toLowerCase());
};

export const findTarget = ({ scene, camera, bones, objects } = {}, name) => {
  if (name === "cam") return camera;
  const pairs = (objects ?? []).map(pairOf).filter(([obj]) => obj);
  const direct =
    bones?.[name] ??
    scene?.getObjectByName?.(name) ??
    pairs.find(([, label]) => label === name)?.[0] ??
    null;
  if (direct || !name?.includes(".")) return direct;

  const parts = name.split(".");
  if (parts.some((seg) => !seg)) return null;
  const fromRoot = (rootLength) => {
    const prefix = parts.slice(0, rootLength).join(".");
    let cur =
      bones?.[prefix] ??
      pairs.find(([, label]) => label === prefix)?.[0] ??
      scene?.getObjectByName?.(prefix) ??
      null;
    const rest = parts.slice(rootLength);
    for (const seg of rest) {
      if (!cur) break;
      const next = findChild(cur, seg);
      if (next) cur = next;
      else if (rest.length === 1 && bones?.[seg] && inside(cur, bones[seg])) cur = bones[seg];
      else cur = null;
    }
    return cur;
  };
  const legacy = fromRoot(1);
  if (legacy) return legacy;
  for (let length = parts.length - 1; length >= 2; length--) {
    const target = fromRoot(length);
    if (target) return target;
  }
  return null;
};

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
const dotNames = (bones, objects) => {
  const out = [];
  const walk = (node, prefix) => {
    for (const child of node?.children ?? []) {
      const next = child.name ? `${prefix}.${child.name}` : prefix;
      if (child.name) out.push(next);
      walk(child, next);
    }
  };
  for (const entry of objects ?? []) {
    const [obj, label] = pairOf(entry);
    if (!obj || !label) continue;
    for (const [bName, bObj] of Object.entries(bones ?? {})) {
      if (inside(obj, bObj)) out.push(`${label}.${bName}`);
    }
    for (const bName of Object.keys(obj.userData?.bones ?? {})) {
      out.push(`${label}.${bName}`);
    }
    walk(obj, label);
  }
  return out;
};

export const targetHelp = ({ bones, objects } = {}, name, { camera = true } = {}) => {
  const pairs = (objects ?? []).map(pairOf).filter(([obj]) => obj);
  const names = [
    ...new Set([
      ...(camera ? ["cam"] : []),
      ...Object.keys(bones ?? {}),
      ...pairs.map(([, l]) => l).filter(Boolean),
      ...(name?.includes(".") ? dotNames(bones, pairs) : []),
    ]),
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
  return `ERROR ${why}. Targets: ${camera ? "the camera: cam; " : ""}bones: ${Object.keys(bones ?? {}).join(", ") || "none"}; objects: ${pairs.map(([, l]) => l).filter(Boolean).join(", ") || "none"}; or any object's .name`;
};

export const labelOf = (objects, o) => {
  const pairs = (objects ?? []).map(pairOf).filter(([obj]) => obj);
  for (let p = o; p; p = p.parent) {
    const hit = pairs.find(([x]) => x === p);
    if (hit) return hit[1];
  }
  return o.name || o.type;
};

export const inside = (root, o) => {
  for (let p = o; p; p = p.parent) if (p === root) return true;
  return false;
};

export const hue = (x) => `hsl(${Math.round(240 * (1 - Math.min(1, Math.max(0, x))))} 95% 55%)`;

export const label = (ctx, text, x, y, color = "#fff", align = "left") => {
  ctx.textAlign = align;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
};

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
