// The sound lanes' part of the page state (core/store.ts)
import type { Loudness } from "./meter";
// A clip on the sound lanes (sound.ts): which list in the film's timeline file, and its place there
export interface ClipRef {
  list: "beds" | "sfx";
  i: number;
}

export interface SoundSlice {
  sound: boolean; // the film names its sound lanes (package.json "live-studio".soundTimeline)
  clip: ClipRef | null; // the one clip the panel shows; null when none or several are picked
  clips: ClipRef[]; // every clip picked on the lanes (a click, Shift/Ctrl+click, or a box dragged round them)
  soundSaved: "busy" | "fail" | null;
  soundRev: number; // bumped on every change to the lanes, for the parts of the page that show them
  soundLit: readonly string[] | null; // the library sound (or variation family) under the pointer: its clips stand out on the lanes
  liveLanes: boolean; // the page plays the lanes itself (mixer.ts), so a track can be soloed
  voiceClips: boolean;
  solo: string[]; // the tracks soloed: only they sound, the narration too goes quiet. This page only, never saved or rendered
  meter: boolean; // the master meter shown (a setting, core/prefs.ts)
  loudness: Loudness | null; // what the final render's loudness pass does to the whole film (meter.ts); null until measured
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
