// Types for the page, which sizes its canvases the way the server and the renders do (frame.mjs)
export type Ratio = "16:9" | "9:16";
export const RATIOS: readonly Ratio[];
export const ratioOf: (pkg: unknown) => Ratio;
export const sizeOf: (ratio: Ratio, long: number) => [number, number];
