// The page state React draws from: one Zustand store made of each feature's slice (zustand's slices pattern), so a feature's
// fields and types live in its own folder (camera/slice.ts, notes/slice.ts…). The engine writes it; React reads it. What
// changes every frame (the clock, captions, the timelines, the film camera corner) is drawn straight into its element instead
import { createStore, useStore } from "zustand";
import { type CameraSlice, cameraSlice } from "../camera/slice";
import type { GradeLibrary } from "../camera/adjust";
import { type KeysSlice, keysSlice } from "../keys/slice";
import { type NotesSlice, notesSlice } from "../notes/slice";
import { type ObjectsSlice, objectsSlice } from "../objects/slice";
import { type OptionsSlice, optionsSlice } from "../options/slice";
import { type PictureSlice, pictureSlice } from "../picture/slice";
import { type PlaybackSlice, playbackSlice } from "../playback/slice";
import { type SoundSlice, soundSlice } from "../sound/slice";
import { type TextSlice, textSlice } from "../text/slice";
import { type TimelineSlice, timelineSlice } from "../timeline/slice";
import type { Favorites } from "./favorites";
import { type Prefs, readPrefs, savePref } from "./prefs";
import { S } from "./state";

interface PageSlice {
  ready: boolean;
  newBuild: boolean; // the film's code changed since this page loaded
  loading: string;
  error: string | null;
  status: string;
  settingsOpen: boolean;
  contract: string[];
  shot: string;
  perf: string;
  side: "notes" | "sound" | "objects" | "cam" | "speed" | "anim" | "adjust" | "transition" | "keys" | "text" | "textAnim";
  lib: "notes" | "sound" | "objects" | "text" | "transition" | "adjust"; // on a wide screen: the left column's tab (side then picks the right column's)
  favorites: Favorites; // core/favorites.ts
  gradeLibrary: GradeLibrary;
}
export type StudioState = PageSlice & PlaybackSlice & PictureSlice & NotesSlice & OptionsSlice & SoundSlice & CameraSlice & KeysSlice & ObjectsSlice & TextSlice & TimelineSlice;

export const studio = createStore<StudioState>(() => ({
  ready: false, newBuild: false, loading: "Loading the scene…", error: null, status: "", settingsOpen: false, contract: [], shot: "", perf: "", side: "notes", lib: "notes", favorites: { sounds: [], effects: [] }, gradeLibrary: { luts: [], presets: [] },
  ...playbackSlice, ...pictureSlice, ...notesSlice, ...optionsSlice, ...soundSlice, ...cameraSlice, ...keysSlice, ...objectsSlice, ...textSlice, ...timelineSlice,
  ...readPrefs(),
}));

export const useStudio = <T,>(pick: (s: StudioState) => T) => useStore(studio, pick);
export const set = studio.setState;
export const get = studio.getState;

// A setting this browser keeps (core/prefs.ts): shown at once, remembered for the next visit
export const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
  set({ [k]: v } as Partial<StudioState>);
  savePref(k, v);
  S.dirty = true;
};

// Whether a timeline drag skips snapping: the toolbar's magnet off, or Shift held
export const noSnap = (e: { shiftKey: boolean }) => e.shiftKey || !studio.getState().magnet;

// The box over the picture, kept until closed: what broke and where, as the old page showed it
export const showError = (e: unknown) => set({ error: e instanceof Error ? (e.stack ?? e.message) : String(e) });

let statusTimer = 0;
// A line over the picture that says what just happened, gone after a few seconds
export const say = (words: string, hold = 3000) => {
  set({ status: words });
  clearTimeout(statusTimer);
  if (hold) statusTimer = window.setTimeout(() => set({ status: "" }), hold);
};

// What the engine asks of the page's own elements. A phone only raises its keyboard for a focus made inside the tap itself,
// so the note box is focused synchronously from the engine, not from a React effect after the next render
export const ui = { focusNote: () => {}, blurNote: () => {} };
