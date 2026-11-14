export declare const videoStart: (video: string) => {
  start: number;
  kind: "chunk" | "span" | null;
  final: boolean;
  span?: [number, number];
};
export declare const probeVideo: (
  file: string,
) => { width: number; height: number; fps: number } | null;
