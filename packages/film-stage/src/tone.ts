import { ToneMappingMode } from "postprocessing";

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
