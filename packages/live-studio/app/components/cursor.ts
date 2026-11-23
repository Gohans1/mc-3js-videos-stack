const of = (icon: string, x: number, y: number, fallback: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#100F0F" stroke-width="4">${icon}</g><g stroke="#FFFCF0" stroke-width="2">${icon}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
};
export const BLADE_CURSOR = of(
  `<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>`,
  12,
  12,
  "crosshair",
);
