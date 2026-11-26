import {
  clamp01,
  dropPath,
  type G,
  heartPath,
  inkShape,
  inkStroke,
  type P,
  quad,
  ribbon,
  roundRect,
  starPath,
  twinklePath,
} from "./toon-geom";
import type { EyeShape, Face, Mark, MouthShape, ToonStyle } from "./toon-types";

export const SHAPES: Record<string, EyeShape> = {
  heart: (g, { cx, cy, w, style }) => {
    const s = w * 0.36;
    heartPath(g, cx, cy + s * 0.15, s);
    g.fillStyle = style.color.heart;
    g.fill();
    g.beginPath();
    g.ellipse(cx - s * 0.45, cy - s * 0.2, s * 0.16, s * 0.24, -0.6, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.fill();
  },
  star: (g, { cx, cy, w, style }) => {
    starPath(g, cx, cy, w * 0.4);
    g.fillStyle = style.color.star;
    g.fill();
    g.lineJoin = "round";
    g.lineWidth = 0.07;
    g.strokeStyle = style.color.lash;
    g.stroke();
  },
  gem: (g, { cx, cy, w, style }) => {
    const s = w * 0.36,
      girdle = cy - s * 0.35,
      crown = cy - s * 0.8;
    inkShape(
      g,
      () => {
        g.beginPath();
        g.moveTo(cx - s, girdle);
        g.lineTo(cx - s * 0.55, crown);
        g.lineTo(cx + s * 0.55, crown);
        g.lineTo(cx + s, girdle);
        g.lineTo(cx, cy + s);
        g.closePath();
      },
      style.color.gem,
      style.color.lash,
      0.12,
    );
    g.beginPath();
    g.moveTo(cx - s, girdle);
    g.lineTo(cx + s, girdle);
    g.strokeStyle = "rgba(255,255,255,0.7)";
    g.lineWidth = 0.06;
    g.stroke();
    g.beginPath();
    g.moveTo(cx - s * 0.48, crown + 0.08);
    g.lineTo(cx - s * 0.1, crown + 0.08);
    g.lineTo(cx - s * 0.62, girdle - 0.04);
    g.closePath();
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.fill();
  },
  spiral: (g, { cx, cy, w, side, style }) => {
    const pts: P[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60,
        a = side * t * Math.PI * 5;
      pts.push([cx + Math.cos(a) * t * w * 0.38, cy + Math.sin(a) * t * w * 0.38]);
    }
    g.fillStyle = style.color.lash;
    ribbon(g, pts, style.eye.lash * 0.75, 0.7);
  },
  x: (g, { cx, cy, w, style }) => {
    const s = w * 0.3;
    g.fillStyle = style.color.lash;
    ribbon(g, [[cx - s, cy - s], [cx, cy], [cx + s, cy + s]], style.eye.lash * 1.1, 0.8);
    ribbon(g, [[cx + s, cy - s], [cx, cy], [cx - s, cy + s]], style.eye.lash * 1.1, 0.8);
  },
  wince: (g, { cx, cy, w, h, side, style }) => {
    const tip = cx - side * w * 0.28,
      back = cx + side * w * 0.3;
    g.fillStyle = style.color.lash;
    ribbon(g, [[back, cy - h * 0.42], [tip, cy], [back, cy + h * 0.42]], style.eye.lash * 1.1, 0.7);
  },
  dot: (g, { cx, cy, style }) => {
    g.beginPath();
    g.ellipse(cx, cy, 0.3, 0.42, 0, 0, Math.PI * 2);
    g.fillStyle = style.color.lash;
    g.fill();
  },
};

export const MOUTHS: Record<string, MouthShape> = {
  pout: (g, { cx, cy, mouth, style }) => {
    const s = 0.42 * (0.6 + 0.8 * mouth.width);
    g.fillStyle = style.color.line;
    ribbon(
      g,
      [
        ...quad([cx - 0.3 * s, cy - s], [cx + s, cy - 1.05 * s], [cx + 0.05 * s, cy]),
        ...quad([cx + 0.05 * s, cy], [cx + s, cy + 1.05 * s], [cx - 0.3 * s, cy + s]).slice(1),
      ],
      style.mouth.line * 1.4,
      0.8,
    );
  },
  cat: (g, { cx, cy, w, mouth, style }) => {
    const s = w * 0.32,
      tip = mouth.skew * 0.15;
    g.fillStyle = style.color.line;
    ribbon(
      g,
      [
        ...quad([cx - s, cy - 0.3 * s + tip], [cx - 0.5 * s, cy + 0.9 * s], [cx, cy - 0.05 * s]),
        ...quad([cx, cy - 0.05 * s], [cx + 0.5 * s, cy + 0.9 * s], [cx + s, cy - 0.3 * s - tip]).slice(1),
      ],
      style.mouth.line * 1.2,
      0.6,
    );
  },
  wavy: (g, { cx, cy, w, lift, style }) => {
    const pts: P[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40,
        u = 2 * t - 1;
      pts.push([cx - w / 2 + w * t, cy + 0.1 * Math.sin(t * Math.PI * 4) - lift * (u * u - 0.5)]);
    }
    g.fillStyle = style.color.line;
    ribbon(g, pts, style.mouth.line, 0.55);
  },
  grit: (g, { cx, cy, w, h, lift, style }) => {
    const hh = Math.max(0.44, h),
      top = cy - hh / 2 - lift * 0.3;
    roundRect(g, cx - w / 2, top, w, hh, hh * 0.4);
    g.fillStyle = style.color.teeth;
    g.fill();
    g.lineWidth = style.mouth.line;
    g.strokeStyle = style.color.line;
    g.stroke();
    g.beginPath();
    g.moveTo(cx - w / 2, top + hh / 2);
    g.lineTo(cx + w / 2, top + hh / 2);
    for (const x of [-w / 6, w / 6]) {
      g.moveTo(cx + x, top);
      g.lineTo(cx + x, top + hh);
    }
    g.lineWidth = style.mouth.line * 0.7;
    g.stroke();
  },
  bleh: (g, { cx, cy, w, lift, mouth, style }) => {
    const a: P = [cx - w / 2, cy - lift],
      c: P = [cx, cy + lift],
      b: P = [cx + w / 2, cy - lift];
    const u = 0.62 + mouth.skew * 0.3,
      tx = a[0] + w * u,
      ty = (1 - u) ** 2 * a[1] + 2 * u * (1 - u) * c[1] + u * u * b[1];
    g.beginPath();
    g.ellipse(tx, ty, 0.42, 0.62, 0, 0, Math.PI);
    g.fillStyle = style.color.tongue;
    g.fill();
    g.lineWidth = style.mouth.line * 0.7;
    g.strokeStyle = style.color.line;
    g.stroke();
    g.beginPath();
    g.moveTo(tx, ty + 0.06);
    g.lineTo(tx, ty + 0.36);
    g.stroke();
    g.fillStyle = style.color.line;
    ribbon(g, quad(a, c, b, 18), style.mouth.line, 0.55);
  },
};

const pop = (g: G, k: number) => {
  g.globalAlpha *= clamp01(k * 3);
  return 0.55 + 0.45 * clamp01(k);
};

const puffs = (g: G, S: ToonStyle, circles: [number, number, number][], edge = 0.18) => {
  for (const pass of [0, 1])
    for (const [x, y, r] of circles) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      if (pass) {
        g.fillStyle = S.color.puff;
        g.fill();
      } else {
        g.lineWidth = edge;
        g.strokeStyle = S.color.lash;
        g.stroke();
      }
    }
};

const vein = (g: G, x: number, y: number, s: number, S: ToonStyle, w = 0.16) => {
  g.save();
  g.translate(x, y);
  g.fillStyle = S.color.vein;
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 2);
    ribbon(g, quad([0.18 * s, -0.75 * s], [0.18 * s, -0.18 * s], [0.75 * s, -0.18 * s], 8), w, 0.6);
  }
  g.restore();
};

const around = (draw: Mark["draw"]): Mark => ({
  at: "around",
  draw: (g, k, face, S) => {
    g.save();
    draw(g, k, face, S);
    g.restore();
  },
});

const mouthCorner = (face: Face, S: ToonStyle): P => {
  const m = face.mouth,
    M = S.mouth;
  return [4 + m.x + M.width * m.width * 0.3, M.y - m.y - m.curve * M.lift * 0.6 + Math.max(0, m.open) * M.open * 0.4];
};

export const MARKS: Record<string, Mark> = {
  gloom: {
    at: "under",
    draw: (g, k, _f, S) => {
      g.save();
      g.globalAlpha *= clamp01(k);
      for (const lx of [2.3, 3.5, 4.5, 5.7]) {
        const grad = g.createLinearGradient(0, 0, 0, 2.6);
        grad.addColorStop(0, S.color.gloom);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(lx - 0.09, 0, 0.18, 2.6 * clamp01(k));
      }
      g.restore();
    },
  },
  pale: {
    at: "under",
    draw: (g, k, _f, S) => {
      g.save();
      g.globalAlpha *= 0.55 * clamp01(k);
      const grad = g.createLinearGradient(0, 0, 0, 4.6);
      grad.addColorStop(0, S.color.pale);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 8, 4.6);
      g.restore();
    },
  },
  sick: {
    at: "under",
    draw: (g, k, _f, S) => {
      g.save();
      g.globalAlpha *= 0.5 * clamp01(k);
      const grad = g.createLinearGradient(0, 0, 0, 5.8);
      grad.addColorStop(0, S.color.sick);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 8, 5.8);
      g.restore();
    },
  },
  blush: {
    at: "under",
    draw: (g, k, _f, S) => {
      for (const side of [-1, 1]) {
        const x = 4 + side * 2.1,
          y = S.eye.bottom + 0.35;
        g.save();
        g.globalAlpha *= 0.65 * clamp01(k);
        g.translate(x, y);
        g.scale(1, 0.42);
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, 0.9);
        grad.addColorStop(0, S.color.blush);
        grad.addColorStop(1, "rgba(255,120,140,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, 0.9, 0, Math.PI * 2);
        g.fill();
        g.restore();
        if (k <= 0.5) continue;
        g.save();
        g.globalAlpha *= 0.7 * clamp01((k - 0.5) * 2);
        g.strokeStyle = S.color.vein;
        g.lineWidth = 0.07;
        g.lineCap = "round";
        g.beginPath();
        for (const i of [-1, 0, 1]) {
          g.moveTo(x + i * 0.3 - 0.08, y + 0.17);
          g.lineTo(x + i * 0.3 + 0.08, y - 0.17);
        }
        g.stroke();
        g.restore();
      }
    },
  },
  "puffed-cheeks": {
    at: "over",
    draw: (g, k, _f, S) => {
      g.save();
      g.globalAlpha *= 0.55 * clamp01(k);
      g.fillStyle = S.color.brow;
      const y = S.eye.bottom + 0.42;
      for (const side of [-1, 1]) {
        const x = 4 + side * 2.6;
        ribbon(g, quad([x + side * 0.05, y], [x + side * 0.91, y + 0.54], [x - side * 0.16, y + 1.02]), 0.09, 0.75);
      }
      g.restore();
    },
  },
  bags: {
    at: "over",
    draw: (g, k, _f, S) => {
      g.save();
      g.globalAlpha *= 0.75 * clamp01(k);
      g.fillStyle = S.color.bags;
      for (const side of [-1, 1]) {
        const x = 4 + side * S.eye.x,
          y = S.eye.bottom + 0.24;
        ribbon(g, quad([x - 0.55, y - 0.05], [x, y + 0.16], [x + 0.55, y - 0.05], 12), 0.1, 0.4);
      }
      g.restore();
    },
  },
  tears: {
    at: "over",
    draw: (g, k, _f, S) => {
      const E = S.eye,
        w = 0.34 * Math.max(1, k);
      g.save();
      g.globalAlpha *= 0.85;
      g.fillStyle = S.color.tear;
      for (const side of [-1, 1]) {
        const tx = 4 + side * (E.x + E.w * 0.18);
        roundRect(g, tx - w / 2, E.bottom - 0.15, w, 2.8 * clamp01(k), w / 2);
        g.fill();
      }
      g.restore();
    },
  },
  sweat: {
    at: "over",
    draw: (g, k, _f, S) => {
      const s = 0.55 * clamp01(k) + 0.2;
      dropPath(g, 7.05, 2.1, s);
      g.fillStyle = S.color.sweat;
      g.fill();
      g.beginPath();
      g.ellipse(7.05 - 0.22 * s, 2.1 + 0.25 * s, 0.12 * s, 0.22 * s, 0.3, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,0.8)";
      g.fill();
    },
  },
  vein: {
    at: "over",
    draw: (g, k, _f, S) => vein(g, 6.6, 1.25, 0.6 * clamp01(k), S),
  },
  drool: {
    at: "over",
    draw: (g, k, face, S) => {
      const [x, y] = mouthCorner(face, S),
        len = 0.75 * clamp01(k);
      g.save();
      g.globalAlpha *= 0.9;
      g.fillStyle = S.color.tear;
      roundRect(g, x - 0.09, y - 0.05, 0.18, len, 0.09);
      g.fill();
      dropPath(g, x, y + len + 0.05, 0.24);
      g.fill();
      g.restore();
    },
  },
  question: around((g, k, _f, S) => {
    const s = 1.15 * pop(g, k);
    g.translate(10.1, -0.3);
    g.rotate(0.18);
    inkStroke(
      g,
      () => {
        g.beginPath();
        g.arc(0, -0.55 * s, 0.5 * s, 0.95 * Math.PI, 2.35 * Math.PI);
        g.quadraticCurveTo(0, 0.02 * s, 0, 0.32 * s);
      },
      0.34 * s,
      S.color.question,
      S.color.lash,
    );
    inkShape(g, () => {
      g.beginPath();
      g.arc(0, 0.82 * s, 0.2 * s, 0, Math.PI * 2);
    }, S.color.question, S.color.lash);
  }),
  exclaim: around((g, k, _f, S) => {
    const s = 1.15 * pop(g, k);
    g.translate(8.7, -1.0);
    g.rotate(-0.15);
    inkShape(g, () => {
      g.beginPath();
      g.moveTo(-0.27 * s, -0.95 * s);
      g.quadraticCurveTo(0, -1.35 * s, 0.27 * s, -0.95 * s);
      g.lineTo(0.13 * s, 0.28 * s);
      g.quadraticCurveTo(0, 0.42 * s, -0.13 * s, 0.28 * s);
      g.closePath();
    }, S.color.exclaim, S.color.lash);
    inkShape(g, () => {
      g.beginPath();
      g.arc(0, 0.8 * s, 0.2 * s, 0, Math.PI * 2);
    }, S.color.exclaim, S.color.lash);
  }),
  zzz: around((g, k, _f, S) => {
    const s = pop(g, k);
    for (const [x, y, z] of [
      [9.0, 1.5, 0.7],
      [10.1, 0.1, 0.95],
      [11.1, -1.6, 1.2],
    ] as const)
      inkStroke(
        g,
        () => {
          const h = 0.45 * z * s;
          g.beginPath();
          g.moveTo(x - h, y - h);
          g.lineTo(x + h, y - h);
          g.lineTo(x - h, y + h);
          g.lineTo(x + h, y + h);
        },
        0.2 * z * s,
        S.color.zzz,
        S.color.lash,
      );
  }),
  steam: around((g, k, _f, S) => {
    const s = pop(g, k);
    for (const side of [-1, 1]) {
      const x = 4 + side * 5.5,
        y = 1.2;
      puffs(
        g,
        S,
        [
          [x, y, 0.55 * s],
          [x + side * 0.5 * s, y - 0.4 * s, 0.45 * s],
          [x - side * 0.45 * s, y - 0.3 * s, 0.4 * s],
          [x + side * 0.15 * s, y - 0.8 * s, 0.38 * s],
        ],
      );
    }
  }),
  hearts: around((g, k, _f, S) => {
    const s = pop(g, k);
    for (const [x, y, r] of [
      [9.7, 1.3, 0.55],
      [10.9, -0.4, 0.42],
      [9.3, -1.4, 0.34],
    ] as const)
      inkShape(g, () => heartPath(g, x, y, r * s), S.color.heart, S.color.lash, 0.16);
  }),
  notes: around((g, k, _f, S) => {
    const s = pop(g, k);
    g.fillStyle = S.color.note;
    g.strokeStyle = S.color.note;
    g.lineCap = "round";
    g.lineWidth = 0.13 * s;
    const head = (x: number, y: number) => {
      g.beginPath();
      g.ellipse(x, y, 0.33 * s, 0.24 * s, -0.4, 0, Math.PI * 2);
      g.fill();
    };
    g.save();
    g.translate(9.3, 1.6);
    head(0, 0);
    g.beginPath();
    g.moveTo(0.29 * s, -0.05 * s);
    g.lineTo(0.29 * s, -1.15 * s);
    g.quadraticCurveTo(0.8 * s, -0.85 * s, 0.62 * s, -0.42 * s);
    g.stroke();
    g.restore();
    g.translate(10.3, -0.5);
    head(0, 0);
    head(0.8 * s, -0.2 * s);
    g.beginPath();
    g.moveTo(0.29 * s, -0.05 * s);
    g.lineTo(0.29 * s, -1.1 * s);
    g.moveTo(1.09 * s, -0.25 * s);
    g.lineTo(1.09 * s, -1.3 * s);
    g.stroke();
    g.beginPath();
    g.moveTo(0.29 * s - 0.065 * s, -1.1 * s);
    g.lineTo(1.09 * s + 0.065 * s, -1.3 * s);
    g.lineTo(1.09 * s + 0.065 * s, -1.0 * s);
    g.lineTo(0.29 * s - 0.065 * s, -0.8 * s);
    g.closePath();
    g.fill();
  }),
  idea: around((g, k, _f, S) => {
    const s = pop(g, k);
    g.translate(4, -2.4);
    g.strokeStyle = S.color.bulb;
    g.lineWidth = 0.16 * s;
    g.lineCap = "round";
    g.beginPath();
    for (const a of [-150, -115, -90, -65, -30]) {
      const r = (a * Math.PI) / 180;
      g.moveTo(Math.cos(r) * 1.15 * s, Math.sin(r) * 1.15 * s);
      g.lineTo(Math.cos(r) * 1.55 * s, Math.sin(r) * 1.55 * s);
    }
    g.stroke();
    inkShape(g, () => {
      g.beginPath();
      roundRect(g, -0.36 * s, 0.55 * s, 0.72 * s, 0.55 * s, 0.12 * s);
    }, "#b9bfcc", S.color.lash, 0.16);
    inkShape(g, () => {
      g.beginPath();
      g.arc(0, 0, 0.8 * s, 0, Math.PI * 2);
    }, S.color.bulb, S.color.lash, 0.18);
    g.beginPath();
    g.arc(-0.12 * s, -0.12 * s, 0.42 * s, Math.PI * 1.05, Math.PI * 1.55);
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 0.13 * s;
    g.stroke();
  }),
  lines: around((g, k, _f, S) => {
    const s = pop(g, k);
    g.strokeStyle = S.color.lash;
    g.lineWidth = 0.16;
    g.lineCap = "round";
    g.beginPath();
    for (const side of [-1, 1]) {
      const x = 4 + side * 4.7,
        y = 1;
      for (const a of [-10, 20, 50]) {
        const r = (a * Math.PI) / 180,
          dx = side * Math.cos(r),
          dy = -Math.sin(r);
        g.moveTo(x + dx * 0.3 * s, y + dy * 0.3 * s);
        g.lineTo(x + dx * 1.15 * s, y + dy * 1.15 * s);
      }
    }
    g.stroke();
  }),
  anger: around((g, k, _f, S) => {
    const s = pop(g, k);
    vein(g, 10.4, -1.3, 1.2 * s, S, 0.24 * s);
  }),
  panic: around((g, k, _f, S) => {
    const s = pop(g, k);
    for (const [x, y] of [
      [-1.4, 3.1],
      [-1.0, 0.9],
      [9.4, 3.1],
      [9.0, 0.9],
    ] as const) {
      const dx = 4 - x,
        dy = 3.5 - y,
        len = Math.hypot(dx, dy);
      inkShape(g, () => dropPath(g, x, y, 0.42 * s, Math.atan2(dx / len, -dy / len)), S.color.sweat, S.color.lash, 0.12);
    }
  }),
  dots: around((g, k, _f, S) => {
    const s = pop(g, k);
    g.fillStyle = S.color.lash;
    for (const x of [8.9, 9.75, 10.6]) {
      g.beginPath();
      g.arc(x, -0.5, 0.2 * s, 0, Math.PI * 2);
      g.fill();
    }
  }),
  sparkles: around((g, k, _f, S) => {
    const s = pop(g, k);
    for (const [x, y, r] of [
      [-1.5, 1.4, 0.8],
      [9.6, 1.9, 0.6],
      [10.5, -1.0, 0.9],
      [-0.7, -1.5, 0.55],
    ] as const)
      inkShape(g, () => twinklePath(g, x, y, r * s), S.color.star, S.color.lash, 0.12);
  }),
  cloud: around((g, k, _f, S) => {
    const s = pop(g, k);
    g.translate(4, -2.6);
    g.strokeStyle = S.color.tear;
    g.lineWidth = 0.13;
    g.lineCap = "round";
    g.beginPath();
    for (const x of [-1.1, -0.1, 0.9]) {
      g.moveTo(x * s, 0.95 * s);
      g.lineTo((x - 0.15) * s, 1.45 * s);
    }
    g.stroke();
    const circles: [number, number, number][] = [
      [-1.2, 0.2, 0.75],
      [-0.3, -0.25, 0.95],
      [0.8, -0.05, 0.85],
      [1.6, 0.3, 0.6],
      [0.2, 0.4, 0.8],
    ];
    puffs(
      g,
      { ...S, color: { ...S.color, puff: S.color.cloud } },
      circles.map(([x, y, r]) => [x * s, y * s, r * s]),
    );
  }),
  soul: around((g, k, _f, S) => {
    const s = pop(g, k);
    g.translate(-1.9, 2.1);
    g.scale(s, s);
    g.globalAlpha *= 0.9;
    inkShape(
      g,
      () => {
        g.beginPath();
        g.moveTo(-0.7, 0);
        g.arc(0, 0, 0.7, Math.PI, 0);
        g.bezierCurveTo(0.7, 0.7, 1.1, 1.0, 1.5, 1.5);
        g.bezierCurveTo(0.8, 1.25, 0.2, 1.1, -0.2, 0.9);
        g.bezierCurveTo(-0.6, 0.75, -0.7, 0.4, -0.7, 0);
      },
      S.color.soul,
      S.color.lash,
      0.14,
    );
    g.fillStyle = S.color.lash;
    for (const [x, y, r] of [
      [-0.25, -0.05, 0.08],
      [0.2, -0.05, 0.08],
      [-0.02, 0.25, 0.07],
    ] as const) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }),
  stars: around((g, k, _f, S) => {
    const s = pop(g, k);
    for (const a of [200, 270, 340]) {
      const r = (a * Math.PI) / 180;
      inkShape(g, () => starPath(g, 4 + 4.3 * Math.cos(r), -0.7 + Math.sin(r), 0.42 * s), S.color.star, S.color.lash, 0.12);
    }
  }),
  heartbreak: around((g, k, _f, S) => {
    const s = 0.8 * pop(g, k);
    g.translate(10, 0.8);
    const crack: P[] = [
      [0, -0.45 * s],
      [-0.12 * s, -0.15 * s],
      [0.12 * s, 0.1 * s],
      [-0.08 * s, 0.4 * s],
      [0, 0.95 * s],
    ];
    for (const side of [-1, 1]) {
      g.save();
      g.beginPath();
      g.moveTo(side * 2 * s, -2 * s);
      for (const p of crack) g.lineTo(...p);
      g.lineTo(side * 2 * s, 2 * s);
      g.closePath();
      g.clip();
      g.translate(side * 0.22 * s, 0.08 * s);
      g.rotate(side * 0.22);
      inkShape(g, () => heartPath(g, 0, 0, s), S.color.heart, S.color.lash, 0.16);
      g.restore();
    }
    g.beginPath();
    g.moveTo(...crack[0]!);
    for (const p of crack) g.lineTo(...p);
    g.lineWidth = 0.1;
    g.lineJoin = "round";
    g.strokeStyle = S.color.lash;
    g.stroke();
  }),
  thought: around((g, k, _f, S) => {
    const s = pop(g, k);
    puffs(
      g,
      S,
      [
        [8.95, 0.6, 0.18 * s],
        [9.45, -0.1, 0.28 * s],
        [9.4, -1.3, 0.48 * s],
        [9.95, -2.05, 0.52 * s],
        [10.65, -1.75, 0.55 * s],
        [10.45, -1.1, 0.5 * s],
        [9.95, -1.45, 0.6 * s],
      ],
      0.14,
    );
  }),
  shiver: around((g, k, _f, S) => {
    const s = pop(g, k);
    g.strokeStyle = S.color.lash;
    g.lineWidth = 0.12;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    for (const side of [-1, 1])
      for (const [out, top] of [
        [4.9, 2.2],
        [5.5, 3.3],
      ] as const)
        for (let i = 0; i <= 6; i++) {
          const x = 4 + side * out + (i % 2 ? 0.14 : -0.14) * s,
            y = top + i * 0.28 * s;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
    g.stroke();
  }),
  sigh: around((g, k, _f, S) => {
    const s = pop(g, k);
    puffs(
      g,
      S,
      [
        [-1.5, 6.0, 0.62 * s],
        [-1.5 - 0.7 * s, 5.8, 0.48 * s],
        [-1.5 - 1.25 * s, 6.1, 0.34 * s],
      ],
      0.16,
    );
  }),
};
