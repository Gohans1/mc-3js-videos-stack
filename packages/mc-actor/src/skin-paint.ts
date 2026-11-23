// @ts-nocheck

export const BOX = {
  head: [0, 0, 8, 8, 8],
  hat: [32, 0, 8, 8, 8],
  body: [16, 16, 8, 12, 4],
  jacket: [16, 32, 8, 12, 4],
  armR: [40, 16, 4, 12, 4],
  sleeveR: [40, 32, 4, 12, 4],
  armL: [32, 48, 4, 12, 4],
  sleeveL: [48, 48, 4, 12, 4],
  legR: [0, 16, 4, 12, 4],
  pantR: [0, 32, 4, 12, 4],
  legL: [16, 48, 4, 12, 4],
  pantL: [0, 48, 4, 12, 4],
};
export const facesOf = ([ox, oy, w, h, d]) => ({
  top: [ox + d, oy, w, d],
  bottom: [ox + d + w, oy, w, d],
  right: [ox, oy + d, d, h],
  front: [ox + d, oy + d, w, h],
  left: [ox + d + w, oy + d, d, h],
  back: [ox + 2 * d + w, oy + d, w, h],
});

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const shade = (c, k) =>
  "#" +
  rgb(c)
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v * k)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

export const paint = (sk, part, fn, grain = 0.015) => {
  for (const [side, [ox, oy, w, h]] of Object.entries(facesOf(BOX[part])))
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const fx = side === "right" ? w - 1 - x : x;
        const c = fn(side, x, y, w, h, fx);
        if (!c) continue;
        const n = (((ox + x) * 7 + (oy + y) * 13) % 5) - 2;
        sk.g.fillStyle = shade(c, 1 + n * grain);
        sk.g.fillRect((ox + x) * sk.k, (oy + y) * sk.k, sk.k, sk.k);
      }
};

export const torso = (ctx, color, front = () => null) =>
  paint(ctx, "body", (side, x, y) => (side === "front" ? (front(x, y) ?? color) : color));
export const arms = (ctx, sleeve, len, eraSkin) => {
  const skin = ctx.tone?.skin ?? eraSkin;
  for (const part of ["armR", "armL"])
    paint(ctx, part, (side, x, y) => {
      if (side === "top") return sleeve;
      if (side === "bottom") return shade(skin, 0.85);
      return y < len ? (y === len - 1 && len < 10 ? shade(sleeve, 0.85) : sleeve) : skin;
    });
};
export const legs = (ctx, o) => {
  for (const part of ["legR", "legL"])
    paint(ctx, part, (side, x, y) => {
      if (side === "top") return o.pants;
      if (side === "bottom") return o.sole;
      if (y >= 10) return y === 11 && o.soleEdge ? o.soleEdge : o.shoe;
      if (o.shorts) return y < o.shorts ? o.pants : y < 7 ? (ctx.tone?.skin ?? o.skin) : o.socks;
      if (o.knee && (y === 5 || y === 6) && side === "front") return o.knee;
      return y === 9 ? shade(o.pants, 0.85) : o.pants;
    });
};
export const jacket = (ctx, o) => {
  const lapel = o.lapel ?? shade(o.color, 1.25);
  paint(
    ctx,
    "jacket",
    (side, x, y) => {
      if (side === "bottom") return null;
      if (side === "top") return x >= 2 && x <= 5 && y >= 1 && y <= 2 ? null : o.color;
      if (side === "back")
        return o.back?.(x, y) ?? (o.hood && y <= 2 ? shade(o.color, 1.15) : o.color);
      if (side !== "front") return o.color;
      if (o.style === "open") {
        if (x === 1 || x === 6) return y <= 4 ? lapel : (o.edge ?? o.color);
        return x === 0 || x === 7 ? o.color : null;
      }
      const open = (y <= 1 && x >= 2 && x <= 5) || (y <= 4 && x >= 3 && x <= 4);
      if (open) return null;
      if ((x === 2 || x === 5) && y <= 4) return lapel;
      if (o.badge && x === 5 && y === 3) return o.badge;
      if (x === 3 && y === 7) return shade(o.color, 0.6);
      return o.color;
    },
    o.gloss ?? 0.015,
  );
  for (const part of ["sleeveR", "sleeveL"])
    paint(
      ctx,
      part,
      (side, x, y) => {
        if (side === "bottom") return null;
        if (side === "top") return o.color;
        return y < 10 ? (y === 9 ? shade(o.color, 0.82) : o.color) : null;
      },
      o.gloss ?? 0.015,
    );
};
export const tie =
  (color, stripe, from = 1) =>
  (x, y) => {
    if (x < 3 || x > 4 || y < from || y > 8) return null;
    if (y === from) return shade(color, 0.8);
    return stripe && y % 2 ? stripe : color;
  };
export const belt = (front) => (x, y) =>
  y === 11 ? (x === 3 || x === 4 ? "#c9c9c4" : "#26211d") : front(x, y);
