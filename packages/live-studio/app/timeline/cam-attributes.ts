export interface OpticsSummaryKey {
  mm?: number;
  fov?: number;
  fstop?: number;
  focus?: unknown;
  handheld?: unknown;
  roll?: number;
  wave?: number;
  bob?: number;
}

/** Readable focus target summary for copy/paste attributes. */
export const focusLabel = (f: unknown): string | null =>
  typeof f === "number"
    ? `${f}m`
    : typeof f === "string"
      ? f
      : f && typeof f === "object" && "target" in f && typeof f.target === "string"
        ? f.target
        : f && typeof f === "object" && "point" in f
          ? ("label" in f && typeof f.label === "string" ? f.label : "Surface")
          : null;

/** Readable handheld preset summary matching `film-stage/camera`'s normalization rules. */
export const handheldLabel = (v: unknown): string | null => {
  if (v === undefined) return null;
  if (v === false) return "off";
  if (typeof v === "string") {
    const clean = v.trim();
    return !clean || /^(off|none)$/i.test(clean) ? "off" : clean;
  }
  if (v && typeof v === "object") {
    if ("mix" in v && Array.isArray(v.mix))
      return v.mix.map(handheldLabel).filter(Boolean).join(" + ");
    if (
      "amount" in v &&
      typeof (v as { amount?: unknown }).amount === "number" &&
      (v as { amount: number }).amount <= 1e-6
    ) {
      return "off";
    }
    const raw =
      "preset" in v && typeof (v as { preset?: unknown }).preset === "string"
        ? (v as { preset: string }).preset
        : "kind" in v && typeof (v as { kind?: unknown }).kind === "string"
          ? (v as { kind: string }).kind
          : undefined;
    if (raw !== undefined) {
      const clean = raw.trim();
      return !clean || /^(off|none)$/i.test(clean) ? "off" : clean;
    }
    return "THE_CLOSEUP";
  }
  return "off";
};

/** Build Paste Attributes lens & optics summary string for a camera keyframe. */
export function formatOpticsAttributes(
  k: OpticsSummaryKey,
  group?: "lens" | "dof" | "shake",
): string {
  const lens =
    k.mm !== undefined ? `${k.mm}mm` : k.fov !== undefined ? `FOV ${k.fov}°` : "the film's lens";
  const fstop = k.fstop !== undefined ? (k.fstop > 0 ? `f/${k.fstop}` : "sharp") : null;
  const focus = k.focus !== undefined ? `focus ${focusLabel(k.focus) ?? "target"}` : null;
  const label = handheldLabel(k.handheld);
  const handheld = label !== null ? `handheld ${label}` : null;
  const roll = k.roll ? `roll ${Math.round((k.roll * 1800) / Math.PI) / 10}°` : "no roll";
  const sway = k.wave !== undefined ? `sway ${k.wave}×` : "the film's sway";
  const bob = k.bob !== undefined ? `bob ${k.bob}×` : null;
  const parts =
    group === "lens"
      ? [lens]
      : group === "dof"
        ? [fstop, focus]
        : group === "shake"
          ? [handheld, sway, bob]
          : [lens, fstop, focus, handheld, roll, sway, bob];
  return parts.filter(Boolean).join(", ") || "Inherited";
}
