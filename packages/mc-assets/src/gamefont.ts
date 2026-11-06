// @ts-nocheck
// The game's own font (textures/font/ascii.png from the film's mcasset/ link: 16 x 16 glyphs in 8 px cells, each glyph as
// wide as its own pixels plus one) for everything a film prints on a canvas: the computer's terminal (screen.ts), the
// pages, the scrap and the folder labels (ink.ts)
export async function loadFont() {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "mcasset/1.21.11/assets/minecraft/textures/font/ascii.png"; });
  const fc = document.createElement("canvas"); fc.width = fc.height = 128;
  const fx = fc.getContext("2d", { willReadFrequently: true }); fx.drawImage(img, 0, 0);
  const fpx = fx.getImageData(0, 0, 128, 128).data;
  // a glyph's advance in font pixels, measured from its rightmost lit column
  const width = (c) => { if (c === 32) return 4; const gx = (c % 16) * 8, gy = Math.floor(c / 16) * 8; for (let x = 7; x >= 0; x--) for (let y = 0; y < 8; y++) if (fpx[((gy + y) * 128 + gx + x) * 4 + 3] > 0) return x + 2; return 0; };
  // the whole glyph sheet in one ink colour, to draw from
  const tinted = (color) => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); x.drawImage(img, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, 128, 128); return c; };
  const lineW = (str) => [...str].reduce((w, ch) => w + width(ch.charCodeAt(0)), 0);
  // str onto canvas context g at (x, y), sc canvas pixels per font pixel; returns where the next character would go
  const print = (g, ink, str, x, y, sc) => { for (const ch of str) { const c = ch.charCodeAt(0); g.drawImage(ink, (c % 16) * 8, Math.floor(c / 16) * 8, 8, 8, x, y, 8 * sc, 8 * sc); x += width(c) * sc; } return x; };
  return { width, tinted, lineW, print };
}
