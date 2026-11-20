// A known camera for matchmove tests: where survey points of a set land in a W x H frame, so a solve can be checked
export const W = 640,
  H = 360,
  FPS = 30;

// a pinhole camera at c looking at l, no roll, vertical fov in degrees: OpenCV's axes (x right, y down, z ahead)
export const project = (c, l, fov, X) => {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const unit = (a) => a.map((v) => v / Math.hypot(...a));
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const f = unit(sub(l, c));
  const right = unit(cross(f, [0, 1, 0]));
  const up = cross(right, f);
  const d = sub(X, c);
  const [x, y, z] = [dot(d, right), -dot(d, up), dot(d, f)];
  const focal = H / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
  return [W / 2 + (focal * x) / z, H / 2 + (focal * y) / z];
};

// survey points of a set: a table's corners and things on it, not all in one plane
export const POINTS = [
  [0, 0.8, 0],
  [1.2, 0.8, 0],
  [1.2, 0.8, 0.6],
  [0, 0.8, 0.6],
  [0.3, 1.1, 0.2],
  [0.9, 1.25, 0.4],
  [0.6, 0, 0.3],
];
export const cameraAt = (frame) => ({ c: [0.6 + 0.02 * frame, 1.6, -2.5], l: [0.6, 0.9, 0.3] });

// a shot file over frames 0..12 of a 40-degree camera dollying right, with every point keyed at the given frames
export const tableShot = (frames = [0, 3, 6, 9, 12]) => ({
  name: "table",
  from: 0,
  to: 12 / FPS,
  fov: null,
  cut: true,
  points: POINTS.map((xyz, n) => ({
    name: `p${n}`,
    xyz,
    track: false,
    uv: Object.fromEntries(
      frames.map((f) => [String(f / FPS), project(cameraAt(f).c, cameraAt(f).l, 40, xyz)]),
    ),
  })),
});

export const testVideo = [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  `testsrc2=s=${W}x${H}:r=${FPS}:d=1`,
  "-c:v",
  "ffv1",
];
