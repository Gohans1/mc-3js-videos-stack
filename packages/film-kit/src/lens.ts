// Lenses in millimetres, the way cinematographers choose them, for a three.js camera whose fov is the vertical angle in
// degrees. The sensor is full frame fitted to the image width (36 mm wide, Blender's default sensor and fit), so 50 mm is
// about 40 degrees across, the same as a still photographer's 50 mm. three's own setFocalLength assumes a 35 mm gauge:
// do not mix the two.
// Pros pick a lens for what it does to the space (wide: inside the room, bends it; long: flattens the subject against
// the background) and then move the camera to frame, instead of zooming to fix a composition; a set of primes keeps the
// look of a film consistent.
//   camera.fov = fovOf(50, 16 / 9);  mmOf(camera.fov, 16 / 9);  dollyZoom(3, fovOf(35, a), fovOf(85, a))

export const SENSOR = 36; // mm across the image
export const PRIMES = [14, 18, 24, 35, 50, 85, 135];

const rad = Math.PI / 180;

// vertical fov (degrees) of a lens on an image of this aspect (width / height)
export const fovOf = (mm: number, aspect = 16 / 9) => (2 * Math.atan(SENSOR / 2 / mm / aspect)) / rad;
export const mmOf = (fov: number, aspect = 16 / 9) => SENSOR / 2 / aspect / Math.tan((fov * rad) / 2);
export const hfovOf = (fov: number, aspect = 16 / 9) => (2 * Math.atan(Math.tan((fov * rad) / 2) * aspect)) / rad;
export const nearestPrime = (mm: number) => PRIMES.reduce((a, b) => (Math.abs(Math.log(b / mm)) < Math.abs(Math.log(a / mm)) ? b : a));

// Distance that keeps a subject the same size on screen when the fov changes from fov0 at distance d0 to fov1 (the Vertigo
// dolly zoom: the subject holds still while the background swells or shrinks).
export const dollyZoom = (d0: number, fov0: number, fov1: number) => (d0 * Math.tan((fov0 * rad) / 2)) / Math.tan((fov1 * rad) / 2);

// Distance at which something `height` metres tall fills `fill` (0..1) of the frame height.
export const distanceToFill = (height: number, fill: number, fov: number) => height / (fill * 2 * Math.tan((fov * rad) / 2));

// Thin-lens blur: diameter in pixels of the blur disc of a point `dist` metres away when a `mm` lens at f/`fstop` is focused
// at `focus` metres, on an image `width` pixels wide. Under about 1 px a point reads as sharp.
export function blurPx({ mm, fstop, focus, dist, width = 1920 }: { mm: number; fstop: number; focus: number; dist: number; width?: number }) {
  const s = focus * 1000, d = dist * 1000;
  const c = ((mm * mm) / (fstop * (s - mm))) * (Math.abs(d - s) / d);
  return (c / SENSOR) * width;
}
