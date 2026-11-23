export type Ratio = "16:9" | "9:16";
export const RATIOS: readonly Ratio[] = ["16:9", "9:16"];
export const ratioOf = (pkg: any): Ratio => pkg?.["live-studio"]?.ratio ?? "16:9";
export const frameCountOf = (duration: number, fps: number) =>
  Math.max(1, Math.floor(duration * fps + 1e-6));
export const chunksOf = (duration: number, chunk: number, fps: number): [number, number][] => {
  const frames = frameCountOf(duration, fps),
    per = chunk * fps;
  return Array.from({ length: Math.ceil(frames / per) }, (_, i) => [
    i * per,
    Math.min(frames, (i + 1) * per) - 1,
  ]);
};
export const spanOf = ([from, to]: [number, number], fps: number, lastFrame = Infinity) => {
  const first = Math.round(from * fps),
    last = Math.max(first, Math.min(lastFrame, Math.round(to * fps) - 1));
  const s = (f: number) => +(f / fps).toFixed(2);
  return { first, last, file: `span_${s(first)}-${s(last + 1)}.mp4` };
};
export const sizeOf = (ratio: Ratio, long: number): [number, number] => {
  const short = Math.round((long * 9) / 16);
  return ratio === "9:16" ? [short, long] : [long, short];
};
