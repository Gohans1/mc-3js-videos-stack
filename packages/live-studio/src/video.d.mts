export declare const videoStart: (video: string) => {
  start: number;
  kind: "chunk" | "span" | null;
  final: boolean;
  span?: [number, number];
};
export declare const filmVideo: (
  root: string,
  video: string,
) => (ReturnType<typeof videoStart> & { mixed: boolean }) | null;
export type RenderCuts =
  | { status: "bound" | "legacy"; times: number[]; file: string }
  | { status: "unavailable" | "missing" | "invalid"; reason: string };
export declare const renderCuts: (root: string, video: string) => RenderCuts;
export declare const probeVideo: (
  file: string,
) => { width: number; height: number; fps: number; origin?: number } | null;
