import { expect, test } from "bun:test";

import { SKIN_UV } from "../src/player";
import { BOX, paint, torso } from "../src/skin-paint";

// films each carried a copy of this painter; it now lives beside the player whose UVs it paints
const recorder = (k: number) => {
  const cells = new Map<string, string>();
  const g = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      expect([w, h]).toEqual([k, k]);
      cells.set(`${x / k},${y / k}`, this.fillStyle);
    },
  };
  return { sk: { g, k }, cells };
};

test("paint walks every face of a box at the skin's scale and leaves null pixels unpainted", () => {
  const { sk, cells } = recorder(2);
  paint(sk, "armR", (side: string, x: number) => (side === "front" && x === 0 ? null : "#808080"));
  const [fx, fy, fw, fh] = SKIN_UV.armR.front;
  expect(cells.has(`${fx},${fy}`)).toBe(false);
  expect(cells.has(`${fx + 1},${fy}`)).toBe(true);
  const [, , w, h, d] = BOX.armR;
  expect(cells.size).toBe(2 * (w * h + d * h + w * d) - fh);
  expect(fw).toBe(w);
});

test("torso draws front(x, y) over the body's front only", () => {
  const { sk, cells } = recorder(1);
  torso(sk, "#204060", (x: number, y: number) => (x === 3 && y === 2 ? "#ffffff" : null));
  const [fx, fy] = SKIN_UV.body.front;
  const [bx, by] = SKIN_UV.body.back;
  const bright = (c: string | undefined) => parseInt(c!.slice(1, 3), 16) > 200;
  expect(bright(cells.get(`${fx + 3},${fy + 2}`))).toBe(true);
  expect(bright(cells.get(`${bx + 3},${by + 2}`))).toBe(false);
});
