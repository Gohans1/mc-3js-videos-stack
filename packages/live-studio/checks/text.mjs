// Where one line of on-screen text sits and how it reads over the picture, from two frames render/text.ts draws at the same
// second: the film with only that line (A) and with no text (B), RGBA rows top first. Whatever differs is the line (its
// letters, stroke, shadow, background box), so a line anchored to a world point or animated by a film's own voice is
// measured as drawn.
//   measure(A, B, w, h, ink, glyphPx) -> { box: [x0, y0, x1, y1] in frame fractions, contrast } or null when nothing drew
//   verdict({ i, text, at, px }, measured, ratio) -> { lines, faults }
// The letters are the changed pixels within reach of the item's colour; the contrast is WCAG's ratio between that colour
// and the ring just around the letters (what an edge is read against: a stroke or a shadow is in it, the sky behind is
// too), its worst tenth. Thresholds: WCAG 1.4.3, 4.5:1 for text and 3:1 for large text, taken here as BBC's subtitle size
// (6.25% of the frame's short side, 67.5 px at 1080) and up. The safe area: EBU R95's graphics-safe area, 5% in from
// every edge; a Short's is what YouTube's player covers, as Google's Shorts ad guidance gives it (top 10%, bottom 25%,
// right 10%; it names no left margin, so EBU's 5% stays). Google draws it in a template image, not in text, and
// re-lays the Shorts player now and then: recheck those numbers when its buttons move.

export const SAFE_AREA = {
  "16:9": { left: 0.05, right: 0.05, top: 0.05, bottom: 0.05 },
  "9:16": { left: 0.05, right: 0.1, top: 0.1, bottom: 0.25 },
};
export const NEED = 4.5;
export const NEED_LARGE = 3;
export const LARGE_PX = 67.5;
const CHANGED = 16; // of 255, on any channel: an encode-free render differs by nothing where the text is not
const INK = 64; // RGB distance from the item's colour still counted as its letters (antialiasing, a shadow under them)

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (r, g, b) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
const hex = (s) => {
  const m = /^#?([\da-f]{6})$/i.exec(s ?? "");
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [n >> 16, (n >> 8) & 255, n & 255];
};

export function measure(A, B, w, h, ink, glyphPx) {
  const changed = new Uint8Array(w * h);
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        j = i * 4;
      if (
        Math.max(
          Math.abs(A[j] - B[j]),
          Math.abs(A[j + 1] - B[j + 1]),
          Math.abs(A[j + 2] - B[j + 2]),
        ) > CHANGED
      ) {
        changed[i] = 1;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  if (x1 < 0) return null;
  const [r, g, b] = hex(ink),
    inkL = lum(r, g, b);
  // distance (in whole pixels, a square reach) from the nearest letter pixel, up to R
  const R = Math.max(3, Math.round(glyphPx * 0.15));
  const ax = Math.max(0, x0 - R),
    bx = Math.min(w - 1, x1 + R),
    ay = Math.max(0, y0 - R),
    by = Math.min(h - 1, y1 + R);
  const far = 255,
    dist = new Uint8Array(w * h).fill(far);
  let letters = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x,
        j = i * 4;
      if (changed[i] && Math.hypot(A[j] - r, A[j + 1] - g, A[j + 2] - b) < INK) {
        dist[i] = 0;
        letters++;
      }
    }
  const box = [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h];
  if (!letters) return { box, contrast: null };
  for (let d = 1; d <= R; d++)
    for (let y = ay; y <= by; y++)
      for (let x = ax; x <= bx; x++) {
        const i = y * w + x;
        if (dist[i] !== far) continue;
        for (let dy = -1; dy <= 1 && dist[i] === far; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy,
              xx = x + dx;
            if (yy >= 0 && yy < h && xx >= 0 && xx < w && dist[yy * w + xx] === d - 1) {
              dist[i] = d;
              break;
            }
          }
      }
  // the first pixel out is the letters' own antialiasing: the ring starts past it
  const ratios = [];
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) {
      const i = y * w + x;
      if (dist[i] < 2 || dist[i] > R) continue;
      const L = lum(A[i * 4], A[i * 4 + 1], A[i * 4 + 2]);
      ratios.push((Math.max(L, inkL) + 0.05) / (Math.min(L, inkL) + 0.05));
    }
  if (!ratios.length) return { box, contrast: null };
  ratios.sort((p, q) => p - q);
  return { box, contrast: ratios[Math.floor(ratios.length * 0.1)] };
}

const pc = (x) => `${(x * 100).toFixed(1)}%`;
export function verdict({ i, text, at, px }, m, ratio = "16:9") {
  const name = `items[${i}] "${text}" at ${at.toFixed(2)}`;
  if (!m)
    return {
      faults: ["NONE"],
      lines: [
        `  NONE ${name}: drew nothing there (a hidden track, or the film draws its text its own way): AT=${at.toFixed(2)} bun run render stills`,
      ],
    };
  const faults = [],
    lines = [];
  const [x0, y0, x1, y1] = m.box;
  const safe = SAFE_AREA[ratio] ?? SAFE_AREA["16:9"];
  const edges = [
    ["left", x0],
    ["right", 1 - x1],
    ["top", y0],
    ["bottom", 1 - y1],
  ].filter(([e, d]) => d < safe[e] - 1e-9);
  if (edges.length) {
    faults.push("OUTSIDE");
    lines.push(
      `  OUTSIDE ${name}: ${edges.map(([e, d]) => `${pc(d)} from the ${e} edge`).join(", ")}; ${
        ratio === "9:16"
          ? `in a Short, text stays ${pc(safe.right)} from the right (YouTube's like and share buttons), ${pc(safe.bottom)} from the bottom (title, channel, sound), ${pc(safe.top)} from the top (search bar) and ${pc(safe.left)} from the left`
          : `text stays ${pc(safe.left)} in from every edge (EBU R95's graphics-safe area)`
      }: ${
        x1 - x0 > 1 - safe.left - safe.right
          ? `it is wider than the safe area, so no x fits it: break it with "\\n" or a smaller size`
          : "move its x or y"
      }`,
    );
  }
  const need = px >= LARGE_PX ? NEED_LARGE : NEED;
  if (m.contrast === null)
    lines.push(
      `  ${name}: its letters are not its "color" (a tint or a gradient), so its contrast is yours to judge in the picture`,
    );
  else if (m.contrast < need) {
    faults.push("LOW");
    lines.push(
      `  LOW ${name}: contrast ${m.contrast.toFixed(1)}:1 around its letters (the worst tenth); text this size needs ${need}:1 (WCAG 1.4.3): a stroke ("stroke": {"width": 6}), a background ("background": {"opacity": 0.6}), a darker grade behind it, or move it`,
    );
  }
  if (!faults.length)
    lines.push(
      `  ${name}: inside the safe area${m.contrast === null ? "" : `, contrast ${m.contrast.toFixed(1)}:1`}`,
    );
  return { faults, lines };
}

export const summary = (n, faulty) => [
  `text: ${n} line${n === 1 ? "" : "s"} read over the picture, ${faulty} at fault${faulty ? " (renders/text_<i>.jpg: the line boxed in yellow, the safe area dashed)" : ""}`,
  ...(faulty
    ? [
        `  decor not meant to be read (a sign in the world, a glitch) takes "read": false and is never judged`,
      ]
    : []),
  `next: ${faulty ? "fix each in src/timeline/text.json, then CHECK=text bun run render stills again" : "bun run check for reading time and size"}`,
];
