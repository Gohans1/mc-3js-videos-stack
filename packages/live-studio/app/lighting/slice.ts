import type { SaveState } from "../core/doc";

export interface LightsSlice {
  lights: boolean;
  lightsRev: number;
  lightsSaved: SaveState;
}

export const lightsSlice: LightsSlice = {
  lights: false,
  lightsRev: 0,
  lightsSaved: null,
};
