import type { SaveState } from "../core/doc";
import type { Loudness } from "./meter";
export interface ClipRef {
  list: "beds" | "sfx";
  i: number;
}

export interface SoundSlice {
  sound: boolean;
  clip: ClipRef | null;
  clips: ClipRef[];
  soundSaved: SaveState;
  soundRev: number;
  soundLit: readonly string[] | null;
  liveLanes: boolean;
  voiceClips: boolean;
  solo: string[];
  meter: boolean;
  loudness: Loudness | null;
}
export const soundSlice: Omit<SoundSlice, "meter"> = {
  sound: false,
  clip: null,
  clips: [],
  soundSaved: null,
  soundRev: 0,
  soundLit: null,
  liveLanes: false,
  voiceClips: false,
  solo: [],
  loudness: null,
};
