export const NOTE_FADE = 3;

export const pinFade = (at: number, t: number, rate = 1) => {
  const d = t - at,
    span = NOTE_FADE * rate;
  return d < -0.05 || d > span ? 0 : Math.min(1, 1 - d / span);
};

export const spanFade = (sp: [number, number] | null, t: number, rate = 1) =>
  !sp
    ? 0
    : t >= sp[0] && t <= sp[1]
      ? 1
      : Math.max(pinFade(sp[0], t, rate), pinFade(sp[1], t, rate));

export interface PinLike {
  x: number;
  y: number;
  what: string;
}

export interface StageOpenNoteLike {
  n: {
    id: string;
    text: string;
    pin?: PinLike | null;
    marks?: unknown[] | null;
    freeCam?: boolean;
  };
  t: number;
}

export interface ActivePinNote {
  id: string;
  pin: PinLike;
  text: string;
  fade: number;
}

export interface ActiveFrameNote {
  id: string;
  text: string;
  fade: number;
}

const firstAtOrAfter = (list: ReadonlyArray<{ t: number }>, t: number) => {
  let lo = 0,
    hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m].t < t) lo = m + 1;
    else hi = m;
  }
  return lo;
};

export const activeStageNotes = (
  open: ReadonlyArray<StageOpenNoteLike>,
  t: number,
  rate = 1,
): { pins: ActivePinNote[]; frame: ActiveFrameNote[] } => {
  if (!open.length) return { pins: [], frame: [] };
  const pins: ActivePinNote[] = [];
  const frame: ActiveFrameNote[] = [];
  for (
    let i = firstAtOrAfter(open, t - NOTE_FADE * rate);
    i < open.length && open[i].t <= t + 0.05;
    i++
  ) {
    const { n, t: nt } = open[i];
    if (n.freeCam) continue;
    const fade = pinFade(nt, t, rate);
    if (fade <= 0) continue;
    if (n.pin) pins.push({ id: n.id, pin: n.pin, text: n.text, fade });
    else if (!(Array.isArray(n.marks) && n.marks.length > 0) && n.text.trim())
      frame.push({ id: n.id, text: n.text, fade });
  }
  return { pins, frame };
};

export interface PinLayoutInput {
  x: number;
  y: number;
  labelWidth: number;
  labelHeight: number;
  dotRadius?: number;
}

export interface PinLayoutItem {
  dotDx: number;
  dotDy: number;
  labelX: number;
  labelY: number;
  up: boolean;
}

const DOT_OFFSETS: readonly [number, number][] = [
  [0, 0],
  [14, 0],
  [-14, 0],
  [0, 14],
  [0, -14],
  [14, 14],
  [-14, 14],
  [14, -14],
  [-14, -14],
  [28, 0],
  [-28, 0],
  [0, 28],
  [0, -28],
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const rectOverlapArea = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) => {
  const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return ox > 0 && oy > 0 ? ox * oy : 0;
};

const findFreeDot = (
  baseX: number,
  baseY: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  placedDots: ReadonlyArray<[number, number]>,
): [number, number] => {
  for (const [ox, oy] of DOT_OFFSETS) {
    const tx = clamp(baseX + ox, minX, maxX);
    const ty = clamp(baseY + oy, minY, maxY);
    if (placedDots.every(([px0, py0]) => Math.hypot(tx - px0, ty - py0) >= 13)) return [tx, ty];
  }
  for (let radius = 28; radius <= 84; radius += 14) {
    for (let step = 0; step < 8; step++) {
      const angle = (step * Math.PI) / 4;
      const tx = clamp(baseX + Math.round(Math.cos(angle) * radius), minX, maxX);
      const ty = clamp(baseY + Math.round(Math.sin(angle) * radius), minY, maxY);
      if (placedDots.every(([px0, py0]) => Math.hypot(tx - px0, ty - py0) >= 13)) return [tx, ty];
    }
  }
  return [clamp(baseX, minX, maxX), clamp(baseY, minY, maxY)];
};

export const resolvePinLayout = (
  items: ReadonlyArray<PinLayoutInput>,
  boxWidth: number,
  boxHeight: number,
): PinLayoutItem[] => {
  if (boxWidth <= 0 || boxHeight <= 0) {
    return items.map((item) => {
      const py = Number.isFinite(item.y) ? clamp(item.y, 0.03, 0.97) : 0.06;
      return { dotDx: 0, dotDy: 0, labelX: 0, labelY: 0, up: py > 0.88 };
    });
  }

  const placedDots: [number, number][] = [];
  const dotRects: ({ left: number; top: number; right: number; bottom: number } | null)[] = [];
  const placedLabels: { left: number; top: number; right: number; bottom: number }[] = [];
  const pad = 4;

  const dots = items.map((item) => {
    const px = Number.isFinite(item.x) ? clamp(item.x, 0.02, 0.98) : 0.04;
    const py = Number.isFinite(item.y) ? clamp(item.y, 0.03, 0.97) : 0.06;
    const dotR = item.dotRadius ?? 8;
    const baseX = px * boxWidth;
    const baseY = py * boxHeight;
    const minX = Math.min(dotR, boxWidth / 2);
    const maxX = Math.max(minX, boxWidth - dotR);
    const minY = Math.min(dotR, boxHeight / 2);
    const maxY = Math.max(minY, boxHeight - dotR);
    const [cx, cy] = findFreeDot(baseX, baseY, minX, maxX, minY, maxY, placedDots);
    placedDots.push([cx, cy]);
    const dotDx = Math.round(cx - baseX);
    const dotDy = Math.round(cy - baseY);
    const renderedCx = baseX + dotDx;
    const renderedCy = baseY + dotDy;
    dotRects.push(
      dotR > 0
        ? {
            left: renderedCx - dotR - 2,
            top: renderedCy - dotR - 2,
            right: renderedCx + dotR + 2,
            bottom: renderedCy + dotR + 2,
          }
        : null,
    );
    return {
      py,
      dotR,
      lw: item.labelWidth,
      lh: item.labelHeight,
      dotDx,
      dotDy,
      renderedCx,
      renderedCy,
    };
  });

  return dots.map(({ py, dotR, lw, lh, dotDx, dotDy, renderedCx, renderedCy }, idx) => {
    if (lw <= 0 || lh <= 0) {
      return { dotDx, dotDy, labelX: 0, labelY: 0, up: py > 0.88 };
    }

    const left = clamp(renderedCx - lw / 2, pad, Math.max(pad, boxWidth - pad - lw));
    const maxTop = Math.max(pad, boxHeight - pad - lh);
    const belowRaw = renderedCy + dotR + 6;
    const aboveRaw = renderedCy - dotR - 6 - lh;
    const preferUp = py > 0.88 || (belowRaw > maxTop && aboveRaw >= pad);
    const primary = clamp(preferUp ? aboveRaw : belowRaw, pad, maxTop);
    const oppositeRaw = preferUp ? belowRaw : aboveRaw;

    const step = lh + 4;
    const maxSteps = Math.max(8, Math.ceil((maxTop - pad) / step));
    const candidates: number[] = [primary];
    if (oppositeRaw >= pad && oppositeRaw <= maxTop) {
      candidates.push(oppositeRaw);
    }
    for (let k = 1; k <= maxSteps; k++) {
      candidates.push(clamp(primary + (preferUp ? -k : k) * step, pad, maxTop));
      candidates.push(clamp(primary + (preferUp ? k : -k) * step, pad, maxTop));
    }

    let bestTop = primary;
    let bestArea = Infinity;
    const seen = new Set<number>();
    for (const cand of candidates) {
      const rounded = Math.round(cand);
      if (seen.has(rounded)) continue;
      seen.add(rounded);
      const rect = { left, top: rounded, right: left + lw, bottom: rounded + lh };
      let area = 0;
      for (const r of placedLabels) area += rectOverlapArea(rect, r);
      for (let j = 0; j < dotRects.length; j++) {
        const dr = dotRects[j];
        if (j !== idx && dr) area += rectOverlapArea(rect, dr);
      }
      if (area === 0) {
        bestTop = rounded;
        break;
      }
      if (area < bestArea) {
        bestArea = area;
        bestTop = rounded;
      }
    }

    const minDx = Math.ceil(pad - renderedCx);
    const maxDx = Math.floor(Math.max(pad, boxWidth - pad - lw) - renderedCx);
    const minDy = Math.ceil(pad - renderedCy);
    const maxDy = Math.floor(maxTop - renderedCy);
    const labelX = clamp(Math.round(left - renderedCx), minDx, Math.max(minDx, maxDx));
    const labelY = clamp(Math.round(bestTop - renderedCy), minDy, Math.max(minDy, maxDy));
    placedLabels.push({
      left: renderedCx + labelX,
      top: renderedCy + labelY,
      right: renderedCx + labelX + lw,
      bottom: renderedCy + labelY + lh,
    });
    return {
      dotDx,
      dotDy,
      labelX,
      labelY,
      up: renderedCy + labelY + lh / 2 < renderedCy,
    };
  });
};
