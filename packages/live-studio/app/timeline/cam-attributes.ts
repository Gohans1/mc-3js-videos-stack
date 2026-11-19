export interface OpticsSummaryKey {
  mm?: number;
  fov?: number;
  fstop?: number;
  focus?: unknown;
  handheld?: unknown;
  bob?: number;
  roll?: number;
  wave?: number;
}

/** Readable focus target summary for copy/paste attributes. */
export const focusLabel = (f: unknown): string | null =>
  typeof f === "number"
    ? `${f}m`
    : typeof f === "string"
      ? f
      : f && typeof f === "object" && "target" in f && typeof f.target === "string"
        ? f.target
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
export function formatOpticsAttributes(k: OpticsSummaryKey): string {
  const handheld = handheldLabel(k.handheld);
  return [
    k.mm !== undefined ? `${k.mm}mm` : k.fov !== undefined ? `FOV ${k.fov}°` : "the film's lens",
    k.fstop !== undefined ? (k.fstop > 0 ? `f/${k.fstop}` : "sharp") : null,
    k.focus !== undefined ? `focus ${focusLabel(k.focus) ?? "target"}` : null,
    handheld !== null ? `handheld ${handheld}` : null,
    k.roll ? `roll ${Math.round((k.roll * 1800) / Math.PI) / 10}°` : "no roll",
    k.wave !== undefined ? `sway ${k.wave}×` : "the film's sway",
    k.bob !== undefined ? `bob ${k.bob}×` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(", ");
}
