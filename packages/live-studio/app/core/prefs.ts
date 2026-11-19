import { LINKAGE_DEFAULTS, LINKAGE_KINDS, type LinkageSettings } from "../../src/linkage.mjs";
import { NOTE_VIEWS } from "../notes/note-views-model";
import { GHOST_OPACITY, GUIDE_MODES } from "../picture/director-eye";
// What this browser remembers between visits, each setting once: its store field, the localStorage key it is kept under (old
// spellings kept, so nobody loses a setting) and its default. The store starts from readPrefs; every change goes through
// setPref (core/store.ts)
import { stored } from "./storage";

export const FILM_VIEW_SIZES = ["s", "m", "l", "off"] as const;
export type FilmViewSize = (typeof FILM_VIEW_SIZES)[number];
export const FLY_SPEED = { min: 0.5, max: 20, start: 4 }; // blocks a second; Minecraft walks at 4.3, flies at 10.9

const flag = (key: string, start: boolean) => ({
  key,
  read: (v: string | null) => (v === null ? start : v !== "off"),
  write: (on: boolean) => (on ? "on" : "off"),
});
const oneOf = <T extends string>(key: string, values: readonly T[], start: T) => ({
  key,
  read: (v: string | null) => (values.includes(v as T) ? (v as T) : start),
  write: (v: T) => v,
});
const within = (key: string, min: number, max: number, start: number) => ({
  key,
  read: (v: string | null) => {
    const n = Number(v);
    return v !== null && n >= min && n <= max ? n : start;
  },
  write: (n: number) => String(n),
});

const PREFS = {
  captions: flag("captions", true),
  tryOn: flag("tryNow", true),
  guides: flag("guides", false),
  guideMode: oneOf("guideMode", GUIDE_MODES, "thirds"),
  guideSafe: flag("guideSafe", true),
  ghostOpacity: within("ghostOpacity", GHOST_OPACITY.min, GHOST_OPACITY.max, GHOST_OPACITY.default),
  magnet: flag("timelineSnap", true),
  linkage: flag("timelineLinkage", true),
  linkageKinds: {
    key: "timelineLinkageKinds",
    read: (v: string | null): LinkageSettings => {
      let saved: Partial<LinkageSettings> = {};
      try {
        saved = v ? JSON.parse(v) : {};
      } catch {}
      return Object.fromEntries(
        LINKAGE_KINDS.map((k) => [
          k,
          typeof saved?.[k] === "boolean" ? saved[k] : LINKAGE_DEFAULTS[k],
        ]),
      ) as LinkageSettings;
    },
    write: JSON.stringify,
  },
  mainMagnet: flag("mainTrackMagnet", true),
  previewAxis: flag("previewAxis", true), // CapCut's, on as there (timeline/peek.ts)
  previewAudio: flag("previewAudio", false), // the preview axis plays the sound under the pointer too (Shift+S; timeline/peek.ts)
  nightVision: flag("nightVision", false),
  scopes: flag("scopes", false), // CapCut's Color oscilloscope under the picture (picture/Oscilloscope.tsx)
  meter: flag("audioMeter", true), // the master meter beside the timeline (sound/AudioMeter.tsx)
  aiActivity: flag("aiActivity", true), // what the AI is doing, lit as it works (activity/activity.ts)
  noteNotify: flag("noteNotify", true), // toast + chime when AI finishes resolving a note
  activityChime: flag("activityChime", true), // ting sound on resolved notes and activity errors
  autoConnectEase: flag("autoConnectEase", true), // keeps camera speed continuous across keyframes in a shot
  manualConfirm: flag("manualConfirm", true), // hold timeline/camera/setting edits in preview until confirmed
  filmView: oneOf("filmView", FILM_VIEW_SIZES, "s"),
  filmViewWidth: {
    key: "filmViewWidth",
    read: (v: string | null) => {
      if (v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 88 && n <= 1600 ? Math.round(n) : null;
    },
    write: (v: number | null) => (v === null ? "" : String(Math.round(v))),
  },
  flySpeed: within("flySpeed", FLY_SPEED.min, FLY_SPEED.max, FLY_SPEED.start),
  noteView: oneOf("noteView", NOTE_VIEWS, "cards"),
};
export type Prefs = { [K in keyof typeof PREFS]: ReturnType<(typeof PREFS)[K]["read"]> };

export const readPrefs = () => {
  let empty = false;
  try {
    empty = typeof localStorage !== "undefined" && localStorage.length === 0;
  } catch {
    empty = true;
  }
  const out = {} as Record<string, unknown>;
  for (const [k, p] of Object.entries(PREFS)) out[k] = p.read(empty ? null : stored.get(p.key));
  return out as Prefs;
};
export const savePref = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
  stored.set(PREFS[k].key, (PREFS[k].write as (x: Prefs[K]) => string)(v));
