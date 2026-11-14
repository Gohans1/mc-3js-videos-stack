// A film's frame shape: package.json "live-studio": { "ratio": "9:16" } for Shorts, 16:9 (YouTube) without it. The studio's
// page, its renders and its checks all draw at sizeOf(ratio, long side), so a film builds from the W and H it is given and
// never assumes a shape
export type Ratio = "16:9" | "9:16";
export const RATIOS: readonly Ratio[] = ["16:9", "9:16"];
export const ratioOf = (pkg: any): Ratio => pkg?.["live-studio"]?.ratio ?? "16:9";
// The [first, last] frame each render chunk draws: frame f shows second f/fps, and only frames before the end are drawn, so a
// film a hair past a chunk's end (30.01 s) has no chunk of zero frames
export const chunksOf = (duration: number, chunk: number, fps: number): [number, number][] => {
  const frames = Math.max(1, Math.floor(duration * fps + 1e-6)),
    per = chunk * fps;
  return Array.from({ length: Math.ceil(frames / per) }, (_, i) => [
    i * per,
    Math.min(frames, (i + 1) * per) - 1,
  ]);
};
export const sizeOf = (ratio: Ratio, long: number): [number, number] => {
  const short = Math.round((long * 9) / 16);
  return ratio === "9:16" ? [short, long] : [long, short];
};
