export function textTransform(
  kind: "scale" | "rotate",
  start: { scale?: number; rotate?: number },
  anchor: readonly [number, number],
  origin: readonly [number, number],
  point: readonly [number, number],
) {
  const dx = point[0] - anchor[0],
    dy = point[1] - anchor[1];
  const ox = origin[0] - anchor[0],
    oy = origin[1] - anchor[1];
  if (kind === "scale")
    return {
      scale: Math.max(
        0.01,
        ((start.scale ?? 1) * Math.hypot(dx, dy)) / Math.max(1, Math.hypot(ox, oy)),
      ),
    };
  const angle = (start.rotate ?? 0) + ((Math.atan2(dy, dx) - Math.atan2(oy, ox)) * 180) / Math.PI;
  return { rotate: Math.round(((((angle + 180) % 360) + 360) % 360) - 180) };
}
