export type Box = [number, number, number, number];
export const INSET = { action: 0.035, graphics: 0.05 };

export const safe = (width: number, height: number, kind: keyof typeof INSET = "graphics"): Box => {
  const x = width * INSET[kind],
    y = height * INSET[kind];
  return [x, y, width - x, height - y];
};

export const inSafe = (
  box: Box,
  width: number,
  height: number,
  kind: keyof typeof INSET = "graphics",
) => {
  const [x0, y0, x1, y1] = safe(width, height, kind);
  return box[0] >= x0 && box[1] >= y0 && box[2] <= x1 && box[3] <= y1;
};
