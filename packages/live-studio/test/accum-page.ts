import { makeAccumulator } from "../render/accum";

// Pictures 64x4 averaged by render/accum.ts as a clip's sub-frames are: each one a grey level, or "ramp" (column x is grey
// 4x); test/accum.test.mjs reads back the grey of every column. "own": in a context of its own, the picture a canvas;
// "shared": in the film's own context, the picture what it just drew there
const W = 64,
  H = 4;
const picture = document.createElement("canvas");
picture.width = W;
picture.height = H;
const paint = picture.getContext("2d")!;
const film = document.createElement("canvas");
film.width = W;
film.height = H;
const gl = film.getContext("webgl2", { antialias: false })!;
const read = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
read.canvas.width = W;
read.canvas.height = H;
const accumulators = { own: makeAccumulator(W, H), shared: makeAccumulator(W, H, gl, () => {}) };
const grey = (p: number | "ramp", x: number) => (p === "ramp" ? x * 4 : p);

Object.assign(window, {
  average: (pictures: (number | "ramp")[], mode: "own" | "shared") => {
    const acc = accumulators[mode];
    acc.reset();
    for (const p of pictures) {
      if (mode === "own") {
        for (let x = 0; x < W; x++) {
          paint.fillStyle = `rgb(${grey(p, x)},${grey(p, x)},${grey(p, x)})`;
          paint.fillRect(x, 0, 1, H);
        }
        acc.add(picture);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.enable(gl.SCISSOR_TEST);
        for (let x = 0; x < W; x++) {
          gl.scissor(x, 0, 1, H);
          gl.clearColor(grey(p, x) / 255, grey(p, x) / 255, grey(p, x) / 255, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.disable(gl.SCISSOR_TEST);
        acc.add();
      }
    }
    read.drawImage(acc.resolve(), 0, 0);
    const px = read.getImageData(0, 0, W, H).data;
    return Array.from({ length: W }, (_, x) => px[(W + x) * 4]);
  },
});
