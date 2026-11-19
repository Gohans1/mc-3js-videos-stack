// Lenses in millimetres, the way cinematographers choose them, for a three.js camera whose fov is the vertical angle in
// degrees. The sensor is full frame fitted to the image width (36 mm wide, Blender's default sensor and fit), so 50 mm is
// about 40 degrees across, the same as a still photographer's 50 mm. three's own setFocalLength assumes a 35 mm gauge:
// do not mix the two.
// Pros pick a lens for what it does to the space (wide: inside the room, bends it; long: flattens the subject against
// the background) and then move the camera to frame, instead of zooming to fix a composition; a set of primes keeps the
// look of a film consistent.
//   camera.fov = fovOf(50, 16 / 9);  mmOf(camera.fov, 16 / 9);  dollyZoom(3, fovOf(35, a), fovOf(85, a))

export const PAN_SECONDS = 7;
export const SENSOR = 36; // mm across the image
/** Curated prime focal lengths and cinema starting apertures for 36mm full-frame horizontal fit. */
export const PRIME_LENSES = [
  {
    id: "14mm",
    cat: "Primes",
    title: "14mm Ultra-Wide",
    tip: "Ultra-wide dramatic perspective (~72 deg V-FOV on 16:9); exaggerates speed and scale",
    mm: 14,
    fstop: 8,
  },
  {
    id: "18mm",
    cat: "Primes",
    title: "18mm Super-Wide",
    tip: "Super-wide architectural lens (~59 deg V-FOV on 16:9); sweeps environment cleanly",
    mm: 18,
    fstop: 5.6,
  },
  {
    id: "24mm",
    cat: "Primes",
    title: "24mm Wide",
    tip: "Wide establishing lens (~46 deg V-FOV on 16:9); exaggerates depth and spatial scale",
    mm: 24,
    fstop: 5.6,
  },
  {
    id: "35mm",
    cat: "Primes",
    title: "35mm Story",
    tip: "Natural documentary lens (~32 deg V-FOV on 16:9); character with environment context",
    mm: 35,
    fstop: 2.8,
  },
  {
    id: "50mm",
    cat: "Primes",
    title: "50mm Standard",
    tip: "Human-eye neutral prime (~23 deg V-FOV on 16:9); natural dialogue and two-shots",
    mm: 50,
    fstop: 2.0,
  },
  {
    id: "85mm",
    cat: "Primes",
    title: "85mm Portrait",
    tip: "Tight portrait lens (~14 deg V-FOV on 16:9); creamy background separation",
    mm: 85,
    fstop: 1.8,
  },
  {
    id: "135mm",
    cat: "Primes",
    title: "135mm Telephoto",
    tip: "Compressed telephoto (~9 deg V-FOV on 16:9); flattens background layers for drama",
    mm: 135,
    fstop: 2.0,
  },
] as const;
export const PRIMES = PRIME_LENSES.map((p) => p.mm);

const rad = Math.PI / 180;

// vertical fov (degrees) of a lens on an image of this aspect (width / height)
export const fovOf = (mm: number, aspect = 16 / 9) =>
  (2 * Math.atan(SENSOR / 2 / mm / aspect)) / rad;
export const mmOf = (fov: number, aspect = 16 / 9) =>
  SENSOR / 2 / aspect / Math.tan((fov * rad) / 2);
export const hfovOf = (fov: number, aspect = 16 / 9) =>
  (2 * Math.atan(Math.tan((fov * rad) / 2) * aspect)) / rad;
export const nearestPrime = (mm: number) =>
  PRIMES.reduce((a, b) => (Math.abs(Math.log(b / mm)) < Math.abs(Math.log(a / mm)) ? b : a));

// Distance that keeps a subject the same size on screen when the fov changes from fov0 at distance d0 to fov1 (the Vertigo
// dolly zoom: the subject holds still while the background swells or shrinks).
export const dollyZoom = (d0: number, fov0: number, fov1: number) =>
  (d0 * Math.tan((fov0 * rad) / 2)) / Math.tan((fov1 * rad) / 2);

// Distance at which something `height` metres tall fills `fill` (0..1) of the frame height.
export const distanceToFill = (height: number, fill: number, fov: number) =>
  height / (fill * 2 * Math.tan((fov * rad) / 2));

// Thin-lens blur: diameter in pixels of the blur disc of a point `dist` metres away when a `mm` lens at f/`fstop` is focused
// at `focus` metres, on an image `width` pixels wide. Under about 1 px a point reads as sharp.
export function blurPx({
  mm,
  fstop,
  focus,
  dist,
  width = 1920,
}: {
  mm: number;
  fstop: number;
  focus: number;
  dist: number;
  width?: number;
}) {
  const s = focus * 1000,
    d = dist * 1000;
  if (!(fstop > 0) || !(mm > 0) || !(d > 0)) return 0;
  const c = ((mm * mm) / (fstop * Math.max(10, s - mm))) * (Math.abs(d - s) / d);
  return (c / SENSOR) * width;
}

export const SHOT_SIZES = {
  ECU: 0.75,
  CU: 0.55,
  MCU: 0.38,
  MS: 0.25,
  WS: 0.14,
  EWS: 0.08,
} as const;
export type ShotSize = keyof typeof SHOT_SIZES;

/** Camera distance (metres) placing a subject `height` m tall at `size` frame fill. */
export function shotSize(
  size: ShotSize | number,
  {
    height = 1.8,
    mm,
    fov,
    aspect = 16 / 9,
  }: { height?: number; mm?: number; fov?: number; aspect?: number } = {},
): number {
  const fill = typeof size === "number" ? size : SHOT_SIZES[size];
  if (typeof fill !== "number" || !Number.isFinite(fill) || fill <= 0) {
    throw new RangeError(
      `shotSize: invalid size "${String(size)}" (expected ${Object.keys(SHOT_SIZES).join(", ")} or a positive fill ratio)`,
    );
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError(`shotSize: "height" must be > 0 (got ${String(height)})`);
  }
  return distanceToFill(height, fill, fov ?? fovOf(mm ?? 50, aspect));
}

export type FrameOpts = {
  size?: ShotSize | number;
  height?: number;
  mm?: number;
  aspect?: number;
  yaw?: number;
  pitch?: number;
  headroom?: number;
  thirdX?: number;
};

/** Pure-t framing helper returning camera position, look target, vertical fov, and mm. */
export function frameSubject(
  target: readonly [number, number, number],
  {
    size = "MCU",
    height = 1.8,
    mm = 50,
    aspect = 16 / 9,
    yaw = 0,
    pitch = 0,
    headroom = 0,
    thirdX = 0,
  }: FrameOpts = {},
): { p: [number, number, number]; l: [number, number, number]; fov: number; mm: number } {
  const fov = fovOf(mm, aspect);
  const d = shotSize(size, { height, fov, aspect });
  const ry = yaw * rad,
    rp = pitch * rad;
  const dirX = Math.sin(ry) * Math.cos(rp),
    dirY = Math.sin(rp),
    dirZ = Math.cos(ry) * Math.cos(rp);
  const p: [number, number, number] = [
    target[0] + dirX * d,
    target[1] + dirY * d,
    target[2] + dirZ * d,
  ];
  const tanV = Math.tan((fov * rad) / 2),
    tanH = tanV * aspect;
  const wantX = thirdX * tanH,
    wantY = -2 * headroom * tanV;
  let lx = target[0],
    ly = target[1],
    lz = target[2];
  const dx = target[0] - p[0],
    dy = target[1] - p[1],
    dz = target[2] - p[2];
  for (let i = 0; i < 4; i++) {
    let fx = lx - p[0],
      fy = ly - p[1],
      fz = lz - p[2];
    const fLen = Math.hypot(fx, fy, fz) || 1;
    fx /= fLen;
    fy /= fLen;
    fz /= fLen;
    let rx = -fz,
      rz = fx;
    const rLen = Math.hypot(rx, rz);
    if (rLen < 1e-6) {
      rx = 1;
      rz = 0;
    } else {
      rx /= rLen;
      rz /= rLen;
    }
    const ux = -rz * fy,
      uy = rz * fx - rx * fz,
      uz = rx * fy;
    const z = dx * fx + dy * fy + dz * fz;
    const errX = dx * rx + dz * rz - wantX * z;
    const errY = dx * ux + dy * uy + dz * uz - wantY * z;
    lx += rx * errX + ux * errY;
    ly += uy * errY;
    lz += rz * errX + uz * errY;
  }
  const l: [number, number, number] = [lx, ly, lz];
  return { p, l, fov, mm };
}

/** Map full-frame mm + aperture f-stop to postprocessing DepthOfFieldEffect parameters. */
export function dofParams({
  mm,
  fstop,
  focus,
  widthPx,
  heightPx,
}: {
  mm: number;
  fstop: number;
  focus: number;
  widthPx?: number;
  heightPx?: number;
}): { focusDistance: number; focusRange: number; bokehScale: number } {
  const focusDistance = Math.max(0.05, focus);
  if (!(fstop > 0) || !Number.isFinite(fstop))
    return { focusDistance, focusRange: 0, bokehScale: 0 };
  const s = focusDistance * 1000;
  const cocInfMm = (mm * mm) / (fstop * Math.max(10, s - mm));
  const pxInf = (cocInfMm / SENSOR) * 1920;
  const targetPx = Math.min(14, pxInf * 0.72);
  const rawRange =
    pxInf > targetPx + 1e-4 ? (focusDistance * targetPx) / (pxInf - targetPx) : focusDistance;
  const focusRange = Math.min(25, Math.max(0.15, rawRange));
  // SENSOR=36 fits horizontally, so pixel bokeh radius scales with horizontal render width (not height).
  const width = widthPx ?? (heightPx !== undefined ? heightPx * (16 / 9) : 1920);
  const bokehScale = Math.max(0, Math.min(8, pxInf / 6) * (width / 1920));
  return { focusDistance, focusRange, bokehScale };
}
