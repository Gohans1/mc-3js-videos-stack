export interface OpticsReadout {
  shot: number;
  shotName?: string;
  mm: number;
  fov: number;
  fstop?: number;
  focusM?: number;
  focusTarget?: string;
  handheld?: string;
  look?: string;
  impulse?: string;
}

const trimNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1))));

/** Formats live camera optics, focus, shake, look, and hit telemetry into one viewfinder strip line. */
export function formatOpticsHud(o?: OpticsReadout): string {
  if (!o) return "";
  const parts = [`Shot ${o.shot}`];
  const name = o.shotName?.trim();
  if (name) parts.push(name);
  if (o.mm > 0) parts.push(`${trimNum(o.mm)}mm`);
  if (o.fstop && o.fstop > 0) parts.push(`f/${trimNum(o.fstop)}`);
  const focus = o.focusM && o.focusM > 0 ? `${o.focusM.toFixed(1)}m` : "";
  const rawTarget = o.focusTarget?.trim() ?? "";
  const target = rawTarget === focus || /^\d+(?:\.\d+)?m$/.test(rawTarget) ? "" : rawTarget;
  if (focus && target) parts.push(`${focus} ${target}`);
  else if (focus) parts.push(focus);
  else if (target) parts.push(`focus ${target}`);
  const hh = o.handheld?.trim();
  if (hh && hh.toLowerCase() !== "off" && hh.toLowerCase() !== "none") parts.push(`HH: ${hh}`);
  const look = o.look?.trim();
  if (look) parts.push(`look: ${look}`);
  const impulse = o.impulse?.trim();
  if (impulse) parts.push(impulse.toUpperCase());
  return parts.join(" · ");
}
