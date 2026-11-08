// Film time as the studio edits it. Pure, so node's tests can load it (device.ts reads the browser as it loads)
export const FPS = 30;
export const SAME = 0.5 / FPS; // two times closer than this are one frame
export const r3 = (x: number) => Math.round(x * 1000) / 1000; // a millisecond, what the timeline files keep

// CapCut's magnet for a time dragged on the timeline: within SNAP_PX of one of pts it lands on the nearest, else it stays where
// the pointer put it (on a whole frame for frame keys). off: Shift held or the magnet turned off
export const SNAP_PX = 7;
export const snapTo = (s: number, pts: number[], perPx: number, off: boolean, frame = false) => {
  if (off) return s;
  let best = frame ? Math.round(s * FPS) / FPS : s, d = SNAP_PX * perPx;
  for (const p of pts) { const e = Math.abs(p - s); if (e < d) { d = e; best = p; } }
  return best;
};
// Where a clip of length len carried to from lands: by whichever end is in reach of a mark, the nearer when both are
export const snapSpan = (from: number, len: number, pts: number[], perPx: number, off: boolean) => {
  const gap = (s: number) => (off ? Infinity : Math.min(Infinity, ...pts.map((p) => Math.abs(p - s)).filter((d) => d < SNAP_PX * perPx)));
  const g0 = gap(from), g1 = gap(from + len);
  return g0 === Infinity && g1 === Infinity ? from : g0 <= g1 ? snapTo(from, pts, perPx, off) : snapTo(from + len, pts, perPx, off) - len;
};

// Times as people read them: 01:05.250 on the clock, 1:05.3 in a list
export const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const stamp = (x: number) => { const ms = Math.round(x * 1000); return `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`; };
export const clockText = (x: number) => `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, "0")}`;
export const rangeText = ([a, b]: [number, number]) => (b - a < 0.05 ? clockText(a) : `${clockText(a)}–${clockText(b)}`);
