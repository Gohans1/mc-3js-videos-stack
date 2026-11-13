// @ts-nocheck
// Words and shapes over the picture, CapCut's Text and Shapes upgraded with Cinetic's rotating typography & annotation voices:
// a title (a place, a year, a chapter) or an annotation shape (arrow, circle, box, bracket, underline), each on screen from
// `from` to `to`, placed by its anchor in the frame or a 3D world point `at`, with customizable In/Out voices (len, ease,
// stagger, tint) and open support for custom film voices.
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/host-grotesk";
import "@fontsource-variable/funnel-display";
import "@fontsource-variable/funnel-sans";
import "@fontsource-variable/mona-sans";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/geist";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/geist-mono";
import * as THREE from "three";

import { EASES, lmix } from "./camera";
import {
  fontOf,
  FONTS,
  fontsFor,
  isShapeKind,
  SHAPE_CATEGORIES,
  SHAPE_IN,
  SHAPE_OUT,
  TEXT_CATEGORIES,
  TEXT_IN,
  TEXT_OUT,
  TITLE_EASES,
} from "./titles-catalog";
import { mixColor } from "./titles-color";
import { lookOf, popCurve } from "./titles-look";
import { clamp01, counted, cubicOut, graphemes, hashInt, phaseOf, scrambled } from "./titles-text";

// The catalogue and the pure parts live in titles-*.ts (typed); this file draws them on a canvas over the picture
export * from "./titles-catalog";
export { mixColor } from "./titles-color";
export { lookOf, type Look } from "./titles-look";
export { counted, graphemes, phaseOf, scrambled, typed } from "./titles-text";

const v3 = new THREE.Vector3();
export const anchorOf = (it, camera) => {
  if (!it.at || !camera) return [it.x ?? 0.5, it.y ?? 0.5];
  v3.set(it.at[0], it.at[1], it.at[2]).project(camera);
  if (v3.z > 1) return null;
  return [(v3.x + 1) / 2 + (it.x ?? 0.5) - 0.5, (1 - v3.y) / 2 + (it.y ?? 0.5) - 0.5];
};

const lines = (it) => {
  const s = it.upper ? (it.text ?? "").toUpperCase() : (it.text ?? "");
  return s.split("\n");
};
const fontCss = (it, px) =>
  `${it.italic ? "italic " : ""}${it.bold ? 700 : it.font === "mono" ? 400 : 500} ${px}px ${fontOf(it.font)}`;
const textSeed = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const measure = (g, it, W, H, camera, cache, extra) => {
  const at = anchorOf(it, camera);
  if (!at) return null;
  const u = Math.min(W, H) / 1080,
    k = (it.scale ?? 1) * u,
    cx = at[0] * W,
    cy = at[1] * H;
  if (isShapeKind(it.kind)) {
    const customShape = extra?.shapes?.[it.kind];
    if (typeof customShape?.measure === "function") {
      const sz = customShape.measure(it, k, W, H);
      if (sz && Number.isFinite(sz.w) && Number.isFinite(sz.h)) {
        return { x0: cx - sz.w / 2, y0: cy - sz.h / 2, w: sz.w, h: sz.h, cx, cy, k };
      }
    }
    if (it.kind === "arrow" || it.kind === "underline") {
      const len = (it.size ?? (it.kind === "underline" ? 220 : 160)) * k,
        w = (it.width ?? 10) * k;
      const h = it.kind === "underline" ? w * 3.2 : w * 4.4;
      return { x0: cx - len / 2, y0: cy - h / 2, w: len, h, cx, cy, k };
    }
    const w = (it.w ?? it.size ?? 260) * k,
      h = (it.h ?? it.size ?? 170) * k;
    return { x0: cx - w / 2, y0: cy - h / 2, w, h, cx, cy, k };
  }
  const px = (it.size ?? 56) * k,
    lh = px * (it.line ?? 1.2),
    font = fontCss(it, px),
    spacing = `${(it.spacing ?? 0) * px}px`;
  const ckey = `${font}|${spacing}|${it.upper ? 1 : 0}|${it.text ?? ""}`;
  let text = cache?.get(ckey);
  if (!text) {
    const ls = lines(it),
      chars = ls.map((l) => [...l]),
      total = chars.reduce((n, cs) => n + cs.length, 0);
    g.font = font;
    g.letterSpacing = spacing;
    const tw = Math.max(1, ...ls.map((l) => g.measureText(l).width));
    text = { ls, chars, total, tw, seed: textSeed(it.text ?? ""), words: null };
    if (cache) {
      if (cache.size >= 512) cache.clear();
      cache.set(ckey, text);
    }
  }
  const pad = it.background ? px * 0.35 : 0;
  const w = text.tw + pad * 2,
    h = lh * text.ls.length + pad * 1.2,
    align = it.align ?? "center";
  const x0 = align === "left" ? cx : align === "right" ? cx - w : cx - w / 2;
  return {
    x0,
    y0: cy - h / 2,
    w,
    h,
    cx,
    cy,
    k,
    px,
    lh,
    ls: text.ls,
    chars: text.chars,
    total: text.total,
    textEntry: text,
    font,
    spacing,
    pad,
    align,
  };
};

const ensureWords = (g, m) => {
  if (m.textEntry.words) return m.textEntry.words;
  g.font = m.font;
  g.letterSpacing = m.spacing;
  let globalIdx = 0;
  const perLine = m.ls.map((line) => {
    const lineW = g.measureText(line).width;
    const parts = line.match(/\S+|\s+/g) ?? [];
    let prefix = "";
    const out = [];
    for (const part of parts) {
      const startX = prefix ? g.measureText(prefix).width : 0;
      prefix += part;
      if (/\S/.test(part))
        out.push({ word: part, startX, uw: g.measureText(part).width, lineW, idx: globalIdx++ });
    }
    return out;
  });
  m.textEntry.words = { perLine, count: Math.max(1, globalIdx) };
  return m.textEntry.words;
};

const ensureLetters = (g, m) => {
  if (m.textEntry.letters) return m.textEntry.letters;
  g.font = m.font;
  g.letterSpacing = m.spacing;
  let globalIdx = 0;
  const perLine = m.ls.map((line) => {
    const lineW = g.measureText(line).width;
    let prefix = "";
    const out = [];
    for (const ch of graphemes(line)) {
      const startX = prefix ? g.measureText(prefix).width : 0;
      prefix += ch;
      if (/\S/.test(ch))
        out.push({ word: ch, startX, uw: g.measureText(ch).width, lineW, idx: globalIdx++ });
    }
    return out;
  });
  m.textEntry.letters = { perLine, count: Math.max(1, globalIdx) };
  return m.textEntry.letters;
};

const unit01 = (seed, idx, salt) => (hashInt(seed | 0, idx + 1, salt) % 1024) / 1023;

// Per word or letter look for the staggered voices: offsets in em, rotation in degrees
const unitLook = (lk, u, wp, seed, baseInk) => {
  const look = { ox: 0, oy: 0, rot: 0, sc: 1, alpha: 1, fill: null };
  const mode = lk.wordMode;
  if (mode === "wordRise") {
    look.alpha = 0.65 + 0.35 * Math.min(1, wp * 2.5);
    look.oy = (1 - EASES.snapOut(wp)) * 0.42;
  } else if (mode === "staggerWords") {
    look.alpha = EASES.glideOut(wp);
  } else if (mode === "wordDropOut") {
    look.alpha = wp;
    look.oy = -(1 - wp) * 0.2;
  } else if (mode === "inkIn" || mode === "letterReveal") {
    const we = mode === "inkIn" ? EASES.snapOut(wp) : cubicOut(wp);
    if (mode === "inkIn") look.alpha = 0.5 + 0.5 * we;
    else {
      look.alpha = Math.min(1, wp * 3);
      look.ox = (1 - we) * 0.35;
      look.oy = (1 - we) * 0.5;
      look.rot = (1 - we) * 20;
      look.sc = lmix(0.4, 1, we);
    }
    if (lk.tint) {
      const cool = clamp01((wp - 0.18) / 0.82);
      look.fill = cool >= 0.999 ? baseInk : mixColor(lk.tint, baseInk, cool);
    }
  } else if (mode === "wordBuild") {
    look.alpha = Math.min(1, wp * 4);
    look.oy = (1 - EASES.snapOut(wp)) * 0.25;
  } else if (mode === "assemble") {
    const we = EASES.snapOut(wp);
    look.ox = (unit01(seed, u.idx, 11) - 0.5) * 3 * (1 - we);
    look.oy = (unit01(seed, u.idx, 12) - 0.5) * 2.4 * (1 - we) - Math.sin(Math.PI * wp) * 0.35;
    look.rot = (unit01(seed, u.idx, 13) - 0.5) * 80 * (1 - we);
    look.sc = popCurve(we);
    look.alpha = Math.min(1, wp * 4);
  } else if (mode === "wordBounce") {
    const dir = u.idx % 2 ? -1 : 1;
    look.oy = dir * 1.4 * Math.exp(-4 * wp) * Math.cos(3 * Math.PI * wp) * (1 - wp);
    look.alpha = Math.min(1, wp * 5);
  } else if (mode === "letterHide") {
    look.alpha = clamp01(wp * 3);
  } else if (mode === "shatter") {
    const f = 1 - wp,
      spin = (unit01(seed, u.idx, 21) < 0.5 ? -1 : 1) * (40 + 50 * unit01(seed, u.idx, 22));
    look.rot = spin * cubicOut(f);
    look.ox = (unit01(seed, u.idx, 23) - 0.5) * 1.2 * f;
    look.oy = f * f * 1.4;
    look.alpha = clamp01(1 - f * f);
  }
  return look;
};

const clipRect = (g, x, y, w, h) => {
  if (!g.clip) return;
  g.beginPath();
  if (g.rect) g.rect(x, y, Math.max(0, w), Math.max(0, h));
  else g.roundRect(x, y, Math.max(0, w), Math.max(0, h), 0);
  g.clip();
};

const paintRun = (g, it, m, s, x, y, fill) => {
  if (it.shadow !== false) {
    g.shadowColor = "rgba(0,0,0,0.55)";
    g.shadowBlur = m.px * 0.25;
    g.shadowOffsetY = m.px * 0.04;
  }
  if (it.stroke) {
    g.lineJoin = "round";
    g.strokeStyle = it.stroke.color ?? "#000000";
    g.lineWidth = (it.stroke.width ?? 6) * m.k;
    g.strokeText(s, x, y);
    g.shadowColor = "transparent";
  }
  g.fillStyle = fill;
  g.fillText(s, x, y);
  g.shadowColor = "transparent";
};

const drawText = (g, it, m, lk) => {
  const { px, lh, chars, total, pad, align } = m;
  const effSpacing = `${((it.spacing ?? 0) + lk.tracking) * px}px`;
  const baseInk = it.color ?? "#FFFFFF";
  const baseFill =
    lk.tint && lk.tintMix > 0.001 ? mixColor(lk.tint, baseInk, 1 - lk.tintMix) : baseInk;
  const baseAlpha = g.globalAlpha;

  if (lk.clip?.kind === "wipe") {
    const padX = px * 0.4;
    clipRect(g, m.x0 - padX, m.y0 - px, (m.w + padX * 2) * lk.clip.p, m.h + px * 2);
  } else if (lk.clip?.kind === "centre") {
    const fullW = m.w + px * 0.8,
      openW = fullW * lk.clip.p;
    clipRect(g, m.cx - openW / 2, m.y0 - px, openW, m.h + px * 2);
  }

  g.font = m.font;
  g.letterSpacing = effSpacing;
  g.textBaseline = "middle";
  if (it.background) {
    const bg = it.background;
    g.globalAlpha = baseAlpha * (bg.opacity ?? 0.6);
    g.fillStyle = bg.color ?? "#000000";
    g.beginPath();
    g.roundRect(m.x0, m.y0, m.w, m.h, px * 0.18);
    g.fill();
    g.globalAlpha = baseAlpha;
  }

  const lineClip = lk.clip?.kind === "line";
  const lineDy = lineClip ? lk.dy * px : 0;

  if (lk.wordMode && lk.wordPhase < 0.999) {
    const { perLine, count } = lk.unit === "letter" ? ensureLetters(g, m) : ensureWords(g, m);
    g.textAlign = "left";
    g.letterSpacing = effSpacing;
    const stag = clamp01(lk.stagger) * 0.72;
    const windowSpan = Math.max(0.18, 1 - stag);
    const phaseOfUnit = (u) =>
      clamp01((lk.wordPhase - (count > 1 ? u.idx / (count - 1) : 0) * stag) / windowSpan);
    perLine.forEach((ws, lineIdx) => {
      const maskTop = m.y0 + pad * 0.6 + lh * lineIdx;
      const yBase = maskTop + lh * 0.5 + lineDy;
      const lineW = ws[0]?.lineW ?? 0;
      let shift = 0;
      if (lk.wordMode === "wordBuild" && align !== "left") {
        // Cinetic word-build: the line re-centres on what has arrived so far, snapping as each word lands
        let shown = 0,
          prevEnd = 0;
        for (const u of ws) {
          const end = u.startX + u.uw;
          shown += (end - prevEnd) * EASES.snapOut(phaseOfUnit(u));
          prevEnd = end;
        }
        shift = (lineW - shown) * (align === "right" ? 1 : 0.5);
      }
      if (lineClip) {
        g.save();
        clipRect(g, m.x0 - px * 2, maskTop, m.w + px * 4, lh * 1.08);
      }
      const startOrigin =
        (align === "left"
          ? m.x0 + pad
          : align === "right"
            ? m.x0 + m.w - pad - lineW
            : m.x0 + m.w / 2 - lineW / 2) + shift;
      for (const u of ws) {
        const wp = phaseOfUnit(u);
        if (wp <= 0.001) continue;
        const look = unitLook(lk, u, wp, m.textEntry.seed, baseInk);
        const x = startOrigin + u.startX + look.ox * px,
          y = yBase + look.oy * px;
        g.globalAlpha = baseAlpha * look.alpha;
        if (look.rot || look.sc !== 1) {
          g.save();
          g.translate(x + u.uw / 2, y);
          g.rotate((look.rot * Math.PI) / 180);
          g.scale(look.sc, look.sc);
          paintRun(g, it, m, u.word, -u.uw / 2, 0, look.fill ?? baseFill);
          g.restore();
        } else paintRun(g, it, m, u.word, x, y, look.fill ?? baseFill);
      }
      if (lineClip) g.restore();
    });
    g.globalAlpha = baseAlpha;
    return;
  }

  g.textAlign = align;
  const tx = align === "left" ? m.x0 + pad : align === "right" ? m.x0 + m.w - pad : m.x0 + m.w / 2;
  let left = Math.round(total * lk.show);
  chars.forEach((cs, i) => {
    const take = Math.min(cs.length, Math.max(0, left));
    left = Math.max(0, left - cs.length);
    if (!take) return;
    let s = take === cs.length ? m.ls[i] : cs.slice(0, take).join("");
    if (lk.count !== null) s = counted(s, lk.count);
    if (lk.scramble !== null && lk.scramble < 0.999)
      s = scrambled(s, lk.scramble, m.textEntry.seed + i * 97);
    if (lk.caret && left === 0 && take <= cs.length) s += "▍";
    const maskTop = m.y0 + pad * 0.6 + lh * i;
    const yBase = maskTop + lh * 0.5 + lineDy;
    const splitDir = m.ls.length > 1 ? (i % 2 === 0 ? -1 : 1) : 1;
    const xLine = tx + lk.splitX * splitDir * px * 1.2;

    let lineFill = baseFill;
    if (lk.sweepAt >= 0 && lk.sweepAt < 0.995 && lk.tint) {
      const band = Math.max(
        0,
        1 - Math.abs(lk.sweepAt - (i + 0.5) / Math.max(1, m.ls.length)) * 2.4,
      );
      if (band > 0.01) lineFill = mixColor(baseInk, lk.tint, band * (1 - lk.sweepAt * 0.5));
    }
    if (lineClip) {
      g.save();
      clipRect(g, m.x0 - px * 2, maskTop, m.w + px * 4, lh * 1.08);
    }
    const hopFont = lk.fontHop === null ? null : fontHopped(it, lk.fontHop);
    if (lk.count !== null || it.in?.fx === "counter") {
      // Canvas has no tabular-nums, so each digit gets the widest digit's cell and a count never jitters the line's width
      const cell = Math.max(..."0123456789".split("").map((d) => g.measureText(d).width));
      const chars = graphemes(s),
        widths = chars.map((ch) => (/\d/.test(ch) ? cell : g.measureText(ch).width));
      const total = widths.reduce((a, b) => a + b, 0);
      let x = align === "left" ? xLine : align === "right" ? xLine - total : xLine - total / 2;
      g.textAlign = "center";
      chars.forEach((ch, k) => {
        paintRun(g, it, m, ch, x + widths[k] / 2, yBase, lineFill);
        x += widths[k];
      });
      g.textAlign = align;
    } else if (hopFont) {
      // A hopped face is squeezed to the line's own width so the layout never moves
      const own = g.measureText(s).width;
      g.font = fontCss({ ...it, font: hopFont }, px);
      const hopped = Math.max(1, g.measureText(s).width);
      g.save();
      g.translate(xLine, 0);
      g.scale(own / hopped, 1);
      paintRun(g, it, m, s, 0, yBase, lineFill);
      g.restore();
      g.font = m.font;
    } else paintRun(g, it, m, s, xLine, yBase, lineFill);
    if (lineClip) g.restore();
  });
};

const fontHopped = (it, hop) => {
  const own = Math.max(
    0,
    FONTS.findIndex((f) => f.id === it.font),
  );
  const next = FONTS[(own + hop) % FONTS.length];
  return next.id === FONTS[own].id ? null : next.id;
};

const drawShape = (g, it, m, lk, extra) => {
  const w = (it.width ?? 10) * m.k;
  const baseInk = it.color ?? "#E5484D";
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle =
    lk.tint && lk.tintMix > 0.001 ? mixColor(lk.tint, baseInk, 1 - lk.tintMix) : baseInk;
  g.lineWidth = w;
  g.shadowColor = "rgba(0,0,0,0.5)";
  g.shadowBlur = w * 1.2;
  if (lk.clip?.kind === "wipe")
    clipRect(g, m.x0 - w * 2, m.y0 - w * 2, (m.w + w * 4) * lk.clip.p, m.h + w * 4);

  const customShape = extra?.shapes?.[it.kind];
  const customDraw = typeof customShape === "function" ? customShape : customShape?.draw;
  if (typeof customDraw === "function") {
    customDraw(g, it, m, lk);
    g.shadowColor = "transparent";
    return;
  }

  if (it.kind === "circle") {
    g.beginPath();
    const a0 = -Math.PI / 2,
      sweep = Math.PI * 2.08 * lk.show;
    g.ellipse(m.cx, m.cy, m.w / 2, m.h / 2, 0, a0, a0 + sweep);
    g.stroke();
  } else if (it.kind === "bracket") {
    const armX = Math.min(m.w * 0.28, 48 * m.k) * lk.show,
      armY = Math.min(m.h * 0.34, 48 * m.k) * lk.show;
    const x0 = m.x0,
      y0 = m.y0,
      x1 = x0 + m.w,
      y1 = y0 + m.h;
    if (armX > 0.2) {
      g.beginPath();
      g.moveTo(x0, y0 + armY);
      g.lineTo(x0, y0);
      g.lineTo(x0 + armX, y0);
      g.moveTo(x1 - armX, y0);
      g.lineTo(x1, y0);
      g.lineTo(x1, y0 + armY);
      g.moveTo(x0, y1 - armY);
      g.lineTo(x0, y1);
      g.lineTo(x0 + armX, y1);
      g.moveTo(x1 - armX, y1);
      g.lineTo(x1, y1);
      g.lineTo(x1, y1 - armY);
      g.stroke();
    }
  } else if (it.kind === "underline") {
    const x0 = m.x0,
      span = m.w * lk.show,
      x1 = x0 + span,
      arch = w * 0.55;
    if (span > 0.5) {
      g.beginPath();
      g.moveTo(x0, m.cy + arch * 0.35);
      if (g.quadraticCurveTo)
        g.quadraticCurveTo(x0 + span * 0.5, m.cy - arch, x1, m.cy + arch * 0.2);
      else g.lineTo(x1, m.cy);
      g.stroke();
    }
  } else if (it.kind === "arrow") {
    g.beginPath();
    const x0 = m.x0,
      x1 = m.x0 + m.w,
      head = Math.min(m.w * 0.35, w * 4),
      shaft = x0 + (x1 - x0) * Math.min(1, lk.show / 0.8);
    g.moveTo(x0, m.cy);
    g.lineTo(shaft, m.cy);
    g.stroke();
    const hp = Math.max(0, (lk.show - 0.8) / 0.2);
    if (hp > 0) {
      g.beginPath();
      g.moveTo(x1 - head * hp, m.cy - head * 0.7 * hp);
      g.lineTo(x1, m.cy);
      g.lineTo(x1 - head * hp, m.cy + head * 0.7 * hp);
      g.stroke();
    }
  } else {
    // Built-in "box" and clean perimeter fallback for any unregistered custom shape kind
    const x0 = m.x0,
      y0 = m.y0,
      x1 = x0 + m.w,
      y1 = y0 + m.h;
    const segs = [
      [x0, y0, x1, y0, m.w],
      [x1, y0, x1, y1, m.h],
      [x1, y1, x0, y1, m.w],
      [x0, y1, x0, y0, m.h],
    ];
    let rem = (m.w * 2 + m.h * 2) * lk.show;
    g.beginPath();
    for (const [ax, ay, bx, by, len] of segs) {
      if (rem <= 0) break;
      const f = Math.min(1, rem / Math.max(1e-4, len));
      g.moveTo(ax, ay);
      g.lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
      rem -= len;
    }
    g.stroke();
  }
  g.shadowColor = "transparent";
};

const onScreen = (g, list, t, W, H, camera, tracks, timeAt, cache, extra) => {
  const out = [];
  (list ?? []).forEach((it, i) => {
    const ph = phaseOf(it, timeAt ? timeAt(it) : t);
    if (!ph || it.hidden || tracks?.[it.track ?? 0]?.hidden) return;
    const m = measure(g, it, W, H, camera, cache, extra);
    if (m) out.push({ it, i, ph, m });
  });
  return out.sort((a, b) => (a.it.track ?? 0) - (b.it.track ?? 0) || a.i - b.i);
};

const KNOWN_SLOT_KEYS = new Set(["fx", "len", "ease", "stagger", "tint", "hold"]);
// What the drawer reads on an item; any other field is the film's own (the studio's Film tab lists those)
export const TEXT_ITEM_KEYS = [
  "id",
  "kind",
  "text",
  "from",
  "to",
  "track",
  "hidden",
  "x",
  "y",
  "x2",
  "y2",
  "dx",
  "dy",
  "target",
  "upper",
  "font",
  "bold",
  "italic",
  "size",
  "line",
  "spacing",
  "align",
  "color",
  "opacity",
  "scale",
  "rotate",
  "w",
  "h",
  "width",
  "shadow",
  "stroke",
  "background",
  "in",
  "out",
];
const KNOWN_ITEM_KEYS = new Set(TEXT_ITEM_KEYS);

const extraFieldsKey = (obj, known) => {
  if (!obj || typeof obj !== "object") return "";
  let extra = "";
  for (const k of Object.keys(obj)) {
    if (known.has(k)) continue;
    const v = obj[k];
    if (typeof v === "function") continue;
    extra += `;${k}=${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`;
  }
  return extra;
};

const slotKey = (cfg) => {
  if (!cfg) return "";
  const ease = Array.isArray(cfg.ease) ? cfg.ease.join(",") : (cfg.ease ?? "");
  return `${cfg.fx ?? ""}:${cfg.len ?? ""}:${ease}:${cfg.stagger ?? ""}:${cfg.tint ?? ""}:${cfg.hold ?? ""}${extraFieldsKey(cfg, KNOWN_SLOT_KEYS)}`;
};

const visualKey = (now) => {
  let k = "";
  for (let n = 0; n < now.length; n++) {
    const { it, ph, m } = now[n],
      st = it.stroke,
      bg = it.background;
    k += `${it.kind ?? "text"}|${it.text ?? ""}|${it.upper ? 1 : 0}|${it.font ?? ""}|${it.bold ? 1 : 0}|${it.italic ? 1 : 0}|${it.size ?? ""}|${it.line ?? ""}|${it.spacing ?? ""}|${it.align ?? ""}|${it.color ?? ""}|${it.opacity ?? ""}|${it.scale ?? ""}|${it.rotate ?? ""}|${it.w ?? ""}|${it.h ?? ""}|${it.width ?? ""}|${it.shadow ?? ""}|${st?.color ?? ""}|${st?.width ?? ""}|${bg ? `${bg.color ?? ""}:${bg.opacity ?? ""}` : ""}|${slotKey(it.in)}|${slotKey(it.out)}|${ph.in}|${ph.out}|${m.cx}|${m.cy}|${m.w}|${m.h}|${extraFieldsKey(it, KNOWN_ITEM_KEYS)}\n`;
  }
  return k;
};

const mergeVoices = (base, extra) => {
  if (!extra?.length) return base;
  const seen = new Set(extra.map((v) => v.id));
  return [...base.filter((v) => !seen.has(v.id)), ...extra];
};

export function makeTitles(renderer, W, H, extra) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat),
    scene = new THREE.Scene(),
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  quad.frustumCulled = false;
  scene.add(quad);
  let last = "";
  const textCache = new Map();
  const onFontsLoaded = () => {
    textCache.clear();
    last = "";
  };
  document.fonts?.addEventListener?.("loadingdone", onFontsLoaded);
  const ready = Promise.all(
    fontsFor(extra?.items).flatMap((f) =>
      [400, 700].map((w) => document.fonts.load(`${w} 40px ${f.css}`, "AÀaà0")),
    ),
  ).catch(() => {});

  const draw = (list, t, camera, tracks, timeAt) => {
    const now = onScreen(g, list, t, W, H, camera, tracks, timeAt, textCache, extra);
    if (!now.length) {
      last = "";
      return;
    }
    const key = visualKey(now);
    if (key !== last) {
      last = key;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      for (const { it, ph, m } of now) {
        const lk = lookOf(it, ph, extra);
        if (lk.alpha <= 0.001) continue;
        const unit = m.px ?? m.h;
        const dyPx = lk.clip?.kind === "line" ? 0 : lk.dy * unit;
        // Echo stamps: older positions trail behind the jump, fading with age; k = 0 is the live copy
        for (let k = lk.echo; k >= 0; k--) {
          const age = k ? 0.6 * (1 - (k - 1) / lk.echo) * lk.echoFade : 1;
          if (age <= 0.001) continue;
          g.save();
          g.globalAlpha = lk.alpha * (it.opacity ?? 1) * age;
          g.filter = lk.blur > 0.05 ? `blur(${lk.blur * m.k}px)` : "none";
          g.translate(m.cx + (lk.dx - k * lk.echoGap) * unit, m.cy + dyPx);
          g.rotate((((it.rotate ?? 0) + lk.rot) * Math.PI) / 180);
          g.scale(lk.scaleX, lk.scaleY);
          g.translate(-m.cx, -m.cy);
          if (isShapeKind(it.kind)) drawShape(g, it, m, lk, extra);
          else drawText(g, it, m, lk);
          g.restore();
        }
      }
      tex.needsUpdate = true;
    }
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(scene, cam);
    renderer.autoClear = auto;
  };

  draw.ready = ready;
  draw.fonts = FONTS;
  draw.categories = { text: TEXT_CATEGORIES, shape: SHAPE_CATEGORIES };
  draw.eases = [
    ...TITLE_EASES,
    ...Object.keys(extra?.eases ?? {}).filter((k) => !TITLE_EASES.includes(k)),
  ];
  draw.shapes = Object.entries(extra?.shapes ?? {}).map(([id, def]) => ({
    id,
    title: typeof def === "object" && def?.title ? def.title : id[0].toUpperCase() + id.slice(1),
    tip: typeof def === "object" ? def?.tip : undefined,
  }));
  draw.anims = {
    text: {
      in: mergeVoices(TEXT_IN, extra?.text?.in),
      out: mergeVoices(TEXT_OUT, extra?.text?.out),
    },
    shape: {
      in: mergeVoices(SHAPE_IN, extra?.shape?.in),
      out: mergeVoices(SHAPE_OUT, extra?.shape?.out),
    },
  };
  draw.boxes = (list, t, camera, tracks, timeAt) =>
    onScreen(g, list, t, W, H, camera, tracks, timeAt, textCache, extra).flatMap(
      ({ i, it, ph, m }) => {
        const lk = lookOf(it, ph, extra);
        if (lk.alpha * (it.opacity ?? 1) <= 0.001 || lk.show <= 0) return [];
        const unit = m.px ?? m.h;
        const tx = lk.dx * unit,
          ty = lk.clip?.kind === "line" ? 0 : lk.dy * unit;
        const rad = (((it.rotate ?? 0) + lk.rot) * Math.PI) / 180,
          c = Math.cos(rad),
          s = Math.sin(rad);
        const corners = [
          [m.x0, m.y0],
          [m.x0 + m.w, m.y0],
          [m.x0 + m.w, m.y0 + m.h],
          [m.x0, m.y0 + m.h],
        ].map(([x, y]) => {
          const px = (x - m.cx) * lk.scaleX,
            py = (y - m.cy) * lk.scaleY;
          return [(px * c - py * s + m.cx + tx) / W, (px * s + py * c + m.cy + ty) / H];
        });
        const xs = corners.map((p) => p[0]),
          ys = corners.map((p) => p[1]);
        return [
          { i, corners, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] },
        ];
      },
    );
  draw.disposeTitles = () => {
    document.fonts?.removeEventListener?.("loadingdone", onFontsLoaded);
    quad.geometry.dispose();
    mat.dispose();
    tex.dispose();
    textCache.clear();
  };
  return draw;
}
