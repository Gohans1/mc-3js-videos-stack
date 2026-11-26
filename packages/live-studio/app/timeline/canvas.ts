export const UI_FONT = "system-ui,Segoe UI,Roboto,sans-serif";
export const REACH = 7;
export const keyReach = (touch: boolean) => (touch ? REACH * 2 : REACH);

const TONES = [
  "background",
  "foreground",
  "muted-foreground",
  "label",
  "primary",
  "backdrop",
  "card",
  "tint",
  "track",
  "track-head",
  "main-track",
  "grid",
  "ruler-text",
  "ruler-tick",
  "ruler-dot",
  "playhead",
  "pick",
  "clip-video",
  "clip-video-tag",
  "clip-text",
  "clip-text-tag",
  "clip-adjust",
  "clip-audio",
  "clip-audio-tag",
  "clip-wave",
  "clip-voice",
  "clip-voice-tag",
  "clip-voice-wave",
  "clip-bgm",
  "clip-bgm-tag",
  "clip-bgm-wave",
  "clip-riser",
  "clip-riser-tag",
  "clip-riser-wave",
  "clip-pop",
  "clip-pop-tag",
  "clip-pop-wave",
  "clip-impact",
  "clip-impact-tag",
  "clip-impact-wave",
  "clip-ambience",
  "clip-ambience-tag",
  "clip-ambience-wave",
  "clip-custom",
  "clip-custom-tag",
  "clip-custom-wave",
  "clip-label",
  "in-out",
  "ai",
  "warn",
  "destructive",
  "slider",
  "ink",
  "ink-saved",
  "clip-video-hover",
  "clip-video-text",
  "clip-shape",
  "clip-shape-tag",
  "shot-now",
  "stuck",
  "pace",
  "pace-fast",
  "pace-slow",
  "pace-pick",
  "beat-move",
  "beat-snap",
  "beat-hold",
  "beat-sound",
  "note-done",
  "key-hold",
  "level-near",
  "level-over",
  "ok",
  "raised-2",
  "raised-3",
  "stage",
  "picture",
  "scrim",
  "scrim-strong",
  "hairline-strong",
  "clip-hover",
  "anim-shade",
  "anim-light",
  "fade-shade",
  "gain-curve",
] as const;
export type Tone = (typeof TONES)[number];
let tones: Record<Tone, string> | null = null;
export const tone = (k: Tone) => {
  if (!tones) {
    const css = getComputedStyle(document.documentElement),
      read = Object.fromEntries(
        TONES.map((n) => [n, css.getPropertyValue(`--${n}`).trim()]),
      ) as Record<Tone, string>;
    if (!read.background) return "#100F0F";
    tones = read;
  }
  return tones[k];
};
export const drawPlayhead = (g: CanvasRenderingContext2D, x: number, h: number) => {
  g.fillStyle = tone("playhead");
  g.fillRect(x - 0.75, 0, 1.5, h);
};

interface CanvasBox {
  w: number;
  h: number;
  d: number;
  sh: string;
  g: CanvasRenderingContext2D;
  stale: boolean;
}
const canvasBoxes = new WeakMap<HTMLCanvasElement, CanvasBox>();
const canvasRo =
  typeof ResizeObserver !== "undefined"
    ? new ResizeObserver((entries) => {
        for (const e of entries) {
          const box = canvasBoxes.get(e.target as HTMLCanvasElement);
          if (box) box.stale = true;
        }
      })
    : null;

export const sized = (c: HTMLCanvasElement) => {
  const d = devicePixelRatio || 1;
  const sh = c.style.height;
  let entry = canvasBoxes.get(c);
  if (!entry) {
    const r = c.getBoundingClientRect();
    entry = {
      w: r.width,
      h: r.height,
      d,
      sh,
      g: c.getContext("2d")!,
      stale: false,
    };
    canvasBoxes.set(c, entry);
    canvasRo?.observe(c);
  } else if (
    !canvasRo ||
    entry.stale ||
    entry.sh !== sh ||
    entry.d !== d ||
    entry.w === 0 ||
    entry.h === 0
  ) {
    const r = c.getBoundingClientRect();
    entry.w = r.width;
    entry.h = r.height;
    entry.d = d;
    entry.sh = sh;
    entry.stale = false;
  }
  const pw = Math.round(entry.w * d),
    ph = Math.round(entry.h * d);
  if (c.width !== pw || c.height !== ph) {
    c.width = pw;
    c.height = ph;
  }
  entry.g.setTransform(d, 0, 0, d, 0, 0);
  return { g: entry.g, w: entry.w, h: entry.h };
};
