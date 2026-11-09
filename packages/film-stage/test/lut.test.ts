import { expect, test } from "bun:test";
import { readLUT } from "../src/lut";

test("cube domains survive loading and 3dl channel order matches cube", () => {
  const size = 5, cube: string[] = [], dl: string[] = [];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    cube.push(`${r / 4} ${g / 4} ${b / 4}`);
    dl.push(`${Math.round(b * 1023.75)} ${Math.round(g * 1023.75)} ${Math.round(r * 1023.75)}`);
  }
  const a = readLUT(`LUT_3D_SIZE 5\nDOMAIN_MIN 0.1 0.2 0.3\nDOMAIN_MAX 0.7 0.8 0.9\n${cube.join('\n')}`);
  const b = readLUT(`0 256 512 768 1024\n${dl.join('\n')}`, "3dl");
  const error = Math.max(...[...a.image.data].map((v, i) => Math.abs(v - b.image.data[i])));
  expect(error).toBeLessThanOrEqual(1 / 4096);
  expect(a.domainMin.toArray()).toEqual([.1, .2, .3]);
  expect(a.domainMax.toArray()).toEqual([.7, .8, .9]);
  a.dispose(); b.dispose();
});
