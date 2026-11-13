// @ts-nocheck
// CHECK=text[:<from>,<to>], built in for every film: can each line of on-screen text be read where it sits? render.mjs
// hands over the lines to read (cfg.text: index, heard second fully on screen, size, colour); for each, the film is drawn
// at that second with only that line, then with none, and checks/text.mjs measures the difference: its box against the
// safe area (EBU R95's, or what YouTube's player covers in a Short), and the contrast of its letters against what is just around them. Reading time and size are
// bun run check's (src/readable.mjs). Writes renders/text_<i>.jpg for every line at fault: the frame, the line's box in
// yellow (a red line would hide in red letters), the safe area dashed.
import { EDIT } from "film/edit";

import { measure, SAFE_AREA, summary, verdict } from "../checks/text.mjs";
import { canvas } from "./lab";

export const textCheck = (render, cfg) => async () => {
  const lines = cfg.text ?? [];
  if (!lines.length)
    return [
      `text: no line to read here${cfg.checks.some(([n, a]) => n === "text" && a[2] < 1e8) ? " between those seconds" : ""} (src/timeline/text.json items of kind "text" with words, and no "read": false)`,
    ];
  const { W, H, ratio } = cfg;
  const safe = SAFE_AREA[ratio] ?? SAFE_AREA["16:9"];
  const two = document.createElement("canvas");
  two.width = W;
  two.height = H;
  const g = two.getContext("2d", { willReadFrequently: true });
  const grab = (t) => {
    render(t);
    g.drawImage(canvas(), 0, 0, W, H);
    return g.getImageData(0, 0, W, H).data;
  };
  const all = EDIT.text.items,
    out = [];
  let faulty = 0;
  try {
    for (const line of lines) {
      EDIT.text.items = [all[line.i]];
      const A = grab(line.at);
      EDIT.text.items = [];
      const B = grab(line.at);
      const m = measure(A, B, W, H, line.ink, (line.px * Math.min(W, H)) / 1080);
      const v = verdict(line, m, ratio);
      out.push(...v.lines);
      if (!v.faults.length) continue;
      faulty++;
      const pic = document.createElement("canvas");
      pic.width = W;
      pic.height = H;
      const p = pic.getContext("2d");
      p.putImageData(new ImageData(new Uint8ClampedArray(A), W, H), 0, 0);
      p.lineWidth = 2;
      p.setLineDash([8, 6]);
      p.strokeStyle = "rgba(255,255,255,0.8)";
      p.strokeRect(
        W * safe.left,
        H * safe.top,
        W * (1 - safe.left - safe.right),
        H * (1 - safe.top - safe.bottom),
      );
      if (m) {
        p.setLineDash([]);
        p.strokeStyle = "#ffd60a";
        const [x0, y0, x1, y1] = m.box;
        p.strokeRect(x0 * W - 2, y0 * H - 2, (x1 - x0) * W + 4, (y1 - y0) * H + 4);
      }
      out.push({ still: `text_${line.i}.jpg`, canvas: pic });
    }
  } finally {
    EDIT.text.items = all;
  }
  out.push(...summary(lines.length, faulty));
  return out;
};
