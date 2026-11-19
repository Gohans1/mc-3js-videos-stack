import type { SaveState } from "../core/doc";

export interface LightsSlice {
  lights: boolean;
  lightsRev: number;
  lightKey: number | null;
  lightsSaved: SaveState;
}

export const lightsSlice: LightsSlice = {
  lights: false,
  lightsRev: 0,
  lightKey: null,
  lightsSaved: null,
};
