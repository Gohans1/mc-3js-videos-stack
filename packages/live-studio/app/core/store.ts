// The page state React draws from: one Zustand store made of each feature's slice (zustand's slices pattern), so a feature's
// fields and types live in its own folder (camera/slice.ts, notes/slice.ts…). The engine writes it; React reads it. What
// changes every frame (the clock, captions, the timelines, the film camera corner) is drawn straight into its element instead
import { useEffect } from "react";
import { createStore, useStore } from "zustand";

import type { GradeLibrary } from "../camera/adjust";
import { type CameraSlice, cameraSlice } from "../camera/slice";
import { type KeysSlice, keysSlice } from "../keys/slice";
import { type LightsSlice, lightsSlice } from "../lighting/slice";
import { createNoteFocusRegistry } from "../notes/compose-motion";
import { type NotesSlice, notesSlice } from "../notes/slice";
import { type ObjectsSlice, objectsSlice } from "../objects/slice";
import { type OptionsSlice, optionsSlice } from "../options/slice";
import { type PictureSlice, pictureSlice } from "../picture/slice";
import { type PlaybackSlice, playbackSlice } from "../playback/slice";
import { type SoundSlice, soundSlice } from "../sound/slice";
import { type TextSlice, textSlice } from "../text/slice";
import { type TimelineSlice, timelineSlice } from "../timeline/slice";
import type { EaseTemplate } from "./ease";
import type { Favorites } from "./favorites";
import { type Prefs, readPrefs, savePref } from "./prefs";
import { S } from "./state";

export type ModalKind =
  | "paste"
  | "linkage"
  | "savePreset"
  | "adjustLibrary"
  | "refSketch"
  | "noteRefs"
  | "reviewImage"
  | "phoneDownload"
  | "voicePlayground"
  | "voiceRegion"
  | "cliConfirm"
  | "cliReset"
  | "cliHelp"
  | "cliTemplate"
  | null;

interface PageSlice {
  ready: boolean;
  metaRev: number;
  newBuild: boolean; // the film's code changed since this page loaded
  hasVideo: boolean;
  downloading: boolean;
  loading: string;
  error: string | null;
  status: string;
  settingsOpen: boolean;
  modal: ModalKind;
  contract: string[];
  shot: string;
  perf: string;
  side:
    | "notes"
    | "sound"
    | "voiceChanger"
    | "audioSpeed"
    | "objects"
    | "cam"
    | "light"
    | "speed"
    | "anim"
    | "adjust"
    | "transition"
    | "keys"
    | "text"
    | "textAnim"
    | "film"
    | "lessons"
    | "ports"
    | "cli"
    | "openfilm";
  lib:
    | "openfilm"
    | "notes"
    | "sound"
    | "objects"
    | "text"
    | "transition"
    | "adjust"
    | "film"
    | "lessons"
    | "ports"
    | "cli"; // on a wide screen: the left column's tab (side then picks the right column's)
  filmKind: string | null; // the Film tab's open kind (own-work.ts group id, "now" for On screen); null: its first
  favorites: Favorites; // core/favorites.ts
  easeTemplates: EaseTemplate[]; // core/ease.ts
  gradeLibrary: GradeLibrary;
  aiActivity: boolean; // what the AI is doing shown as it works (a setting, core/prefs.ts; activity/activity.ts)
  noteNotify: boolean;
  activityChime: boolean;
  autoConnectEase: boolean;
  manualConfirm: boolean;
  pictureRev: number;
}
export type StudioState = PageSlice &
  PlaybackSlice &
  PictureSlice &
  NotesSlice &
  OptionsSlice &
  SoundSlice &
  CameraSlice &
  LightsSlice &
  KeysSlice &
  ObjectsSlice &
  TextSlice &
  TimelineSlice;

export const studio = createStore<StudioState>(() => ({
  ready: false,
  metaRev: 0,
  newBuild: false,
  hasVideo: false,
  downloading: false,
  loading: "Loading 3D engine…",
  error: null,
  status: "",
  settingsOpen: false,
  modal: null,
  contract: [],
  shot: "",
  perf: "",
  side: "notes",
  lib: "notes",
  filmKind: null,
  favorites: { sounds: [], effects: [] },
  easeTemplates: [],
  gradeLibrary: { luts: [], presets: [] },
  pictureRev: 0,
  ...playbackSlice,
  ...pictureSlice,
  ...notesSlice,
  ...optionsSlice,
  ...soundSlice,
  ...cameraSlice,
  ...lightsSlice,
  ...keysSlice,
  ...objectsSlice,
  ...textSlice,
  ...timelineSlice,
  ...readPrefs(),
}));

export const useStudio = <T>(pick: (s: StudioState) => T) => useStore(studio, pick);
export const set = studio.setState;
export const get = studio.getState;

/** Sync open state of note/review dialogs with store.modal so studio hotkeys stay blocked while open. */
export function useDialogModal(kind: Exclude<ModalKind, null>, open: boolean) {
  useEffect(() => {
    if (open) set({ modal: kind });
    else if (get().modal === kind) set({ modal: null });
    return () => {
      if (get().modal === kind) set({ modal: null });
    };
  }, [kind, open]);
}

// A setting this browser keeps (core/prefs.ts): shown at once, remembered for the next visit
export const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
  set({ [k]: v } as Partial<StudioState>);
  savePref(k, v);
  S.dirty = true;
};

// Whether a timeline drag skips snapping: the toolbar's magnet off, or Shift held
export const noSnap = (e: { shiftKey: boolean }) => e.shiftKey || !studio.getState().magnet;

// The box over the picture, kept until closed: what broke and where, as the old page showed it
export const showError = (e: unknown) =>
  set({ error: e instanceof Error ? (e.stack ?? e.message) : String(e) });

let statusTimer = 0;
// A line over the picture that says what just happened, gone after a few seconds
export const say = (words: string, hold = 3000) => {
  set({ status: words });
  clearTimeout(statusTimer);
  if (hold) statusTimer = window.setTimeout(() => set({ status: "" }), hold);
};

export const invalidatePictures = () => set((s) => ({ pictureRev: s.pictureRev + 1 }));

export const noteFocus = createNoteFocusRegistry();

// What the engine asks of the page's own elements. A phone only raises its keyboard for a focus made inside the tap itself,
// so the note box is focused synchronously from the engine, not from a React effect after the next render
export const ui = {
  focusNote: () => noteFocus.focus(),
  blurNote: () => noteFocus.blur(),
  cancelNoteFocus: () => noteFocus.clearPending(),
};
