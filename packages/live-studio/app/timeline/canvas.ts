// What every timeline canvas draws and answers the pointer with (the ruler and the stretch in timeline.ts, sound/lanes.ts,
// camera/camrow.ts, keys/keyrows.ts, text/textrow.ts), kept once so the rows look and behave alike
export const UI_FONT = "system-ui,Segoe UI,Roboto,sans-serif";
// How near a key the pointer must come to take it, in CSS pixels: a finger is less exact than a mouse
export const REACH = 7;
export const keyReach = (touch: boolean) => (touch ? REACH * 2 : REACH);

// The canvases' colours are index.css's tokens of the same names, so one place sets the page's and the rows' alike. Read once
// the page has its styles: before that a token reads empty and is asked for again
const TONES = [
  "background", "foreground", "muted-foreground", "label", "primary", "backdrop", "card", "tint", "track", "track-head", "main-track", "grid",
  "ruler-text", "ruler-tick", "ruler-dot", "playhead", "pick", "clip-video", "clip-video-tag", "clip-text", "clip-text-tag",
  "clip-audio", "clip-audio-tag", "clip-wave", "clip-label", "in-out", "warn", "destructive", "slider", "ink", "ink-saved",
] as const;
export type Tone = (typeof TONES)[number];
let tones: Record<Tone, string> | null = null;
export const tone = (k: Tone) => {
  if (!tones) {
    const css = getComputedStyle(document.documentElement), read = Object.fromEntries(TONES.map((n) => [n, css.getPropertyValue(`--${n}`).trim()])) as Record<Tone, string>;
    if (!read.background) return "#000";
    tones = read;
  }
  return tones[k];
};
// The playhead down a row: CapCut's half-white line, grey on an empty row and tinted over a clip, with no edge of its own
export const drawPlayhead = (g: CanvasRenderingContext2D, x: number, h: number) => { g.fillStyle = tone("playhead"); g.fillRect(x - 0.75, 0, 1.5, h); };

// The canvas sized to its box in CSS pixels and drawn sharp at the screen's pixel ratio
export const sized = (c: HTMLCanvasElement) => {
  const r = c.getBoundingClientRect(), d = devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
  const g = c.getContext("2d")!;
  g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w: r.width, h: r.height };
};
