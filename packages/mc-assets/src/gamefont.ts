// @ts-nocheck
export async function loadFont() {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = "mcasset/1.21.11/assets/minecraft/textures/font/ascii.png";
  });
  const fc = document.createElement("canvas");
  fc.width = fc.height = 128;
  const fx = fc.getContext("2d", { willReadFrequently: true });
  fx.drawImage(img, 0, 0);
  const fpx = fx.getImageData(0, 0, 128, 128).data;
  const width = (c) => {
    if (c === 32) return 4;
    const gx = (c % 16) * 8,
      gy = Math.floor(c / 16) * 8;
    for (let x = 7; x >= 0; x--)
      for (let y = 0; y < 8; y++) if (fpx[((gy + y) * 128 + gx + x) * 4 + 3] > 0) return x + 2;
    return 0;
  };
  const tinted = (color) => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = "source-in";
    x.fillStyle = color;
    x.fillRect(0, 0, 128, 128);
    return c;
  };
  const lineW = (str) => [...str].reduce((w, ch) => w + width(ch.charCodeAt(0)), 0);
  const print = (g, ink, str, x, y, sc) => {
    for (const ch of str) {
      const c = ch.charCodeAt(0);
      g.drawImage(ink, (c % 16) * 8, Math.floor(c / 16) * 8, 8, 8, x, y, 8 * sc, 8 * sc);
      x += width(c) * sc;
    }
    return x;
  };
  return { width, tinted, lineW, print };
}
