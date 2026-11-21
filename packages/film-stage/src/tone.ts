import { ToneMappingMode } from "postprocessing";

// src/edit.json look.toneMapping. agx stays the default so older films keep their look; it greys saturated colour and
// rolls highlights off early (a teal reference read grey). neutral (Khronos PBR Neutral) keeps base colours, the one to
// match a reference's pixels; aces is the punchier filmic curve.
const MODES = {
  agx: ToneMappingMode.AGX,
  neutral: ToneMappingMode.NEUTRAL,
  aces: ToneMappingMode.ACES_FILMIC,
} as const;
export const TONE_MAPS = Object.keys(MODES) as (keyof typeof MODES)[];

export const toneMappingMode = (name: unknown): ToneMappingMode => {
  if (name === undefined) return MODES.agx;
  if (typeof name === "string" && Object.hasOwn(MODES, name))
    return MODES[name as keyof typeof MODES];
  throw new Error(
    `src/edit.json look.toneMapping ${JSON.stringify(name)}: one of ${TONE_MAPS.join(", ")}`,
  );
};
