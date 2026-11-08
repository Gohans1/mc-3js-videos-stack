// What every timeline canvas draws and answers the pointer with (the stretch and the overview in timeline.ts, sound/lanes.ts,
// camera/camrow.ts, keys/keyrows.ts), kept once so the rows look and behave alike
export const UI_FONT = "system-ui,Segoe UI,Roboto,sans-serif";
export const PICK = "#FFFCF0"; // what is picked, on every row: outlined white, as CapCut outlines a picked clip
// How near a key the pointer must come to take it, in CSS pixels: a finger is less exact than a mouse
export const REACH = 7;
export const keyReach = (touch: boolean) => (touch ? REACH * 2 : REACH);

// The canvas sized to its box in CSS pixels and drawn sharp at the screen's pixel ratio
export const sized = (c: HTMLCanvasElement) => {
  const r = c.getBoundingClientRect(), d = devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
  const g = c.getContext("2d")!;
  g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w: r.width, h: r.height };
};
