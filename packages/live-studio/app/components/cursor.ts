// Cursors drawn from a lucide icon (ISC), white over a black outline so they show on every row and on any picture.
// x y: the hotspot, the pixel of the icon a click lands on
const of = (icon: string, x: number, y: number, fallback: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#000" stroke-width="4">${icon}</g><g stroke="#fff" stroke-width="2">${icon}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
};
// scissors: split mode over the timeline (blade.ts)
export const BLADE_CURSOR = of(`<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>`, 12, 12, "crosshair");
// message-square-plus: a click on the picture pins a note, at the bubble's tail (Figma's and Frame.io's comment cursor)
export const NOTE_CURSOR = of(`<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 8v6"/><path d="M9 11h6"/>`, 2, 22, "crosshair");
