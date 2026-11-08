// What this browser remembers between visits, each setting once: its store field, the localStorage key it is kept under (old
// spellings kept, so nobody loses a setting) and its default. The store starts from readPrefs; every change goes through
// setPref (core/store.ts)
import { stored } from "./storage";

export const FILM_VIEW_SIZES = ["s", "m", "l", "off"] as const;
export type FilmViewSize = (typeof FILM_VIEW_SIZES)[number];
export const FLY_SPEED = { min: 0.5, max: 20, start: 4 }; // blocks a second; Minecraft walks at 4.3, flies at 10.9

const flag = (key: string, start: boolean) => ({ key, read: (v: string | null) => (v === null ? start : v !== "off"), write: (on: boolean) => (on ? "on" : "off") });
const oneOf = <T extends string>(key: string, values: readonly T[], start: T) => ({ key, read: (v: string | null) => (values.includes(v as T) ? (v as T) : start), write: (v: T) => v });
const within = (key: string, min: number, max: number, start: number) => ({
  key,
  read: (v: string | null) => { const n = Number(v); return v !== null && n >= min && n <= max ? n : start; },
  write: (n: number) => String(n),
});

const PREFS = {
  captions: flag("captions", true),
  tryOn: flag("tryNow", true),
  guides: flag("guides", false),
  magnet: flag("timelineSnap", true),
  previewAxis: flag("previewAxis", true), // CapCut's, on as there (timeline/peek.ts)
  nightVision: flag("nightVision", false),
  scopes: flag("scopes", false), // CapCut's Color oscilloscope under the picture (picture/Oscilloscope.tsx)
  meter: flag("audioMeter", true), // the master meter beside the timeline (sound/AudioMeter.tsx)
  filmView: oneOf("filmView", FILM_VIEW_SIZES, "m"),
  flySpeed: within("flySpeed", FLY_SPEED.min, FLY_SPEED.max, FLY_SPEED.start),
};
export type Prefs = { [K in keyof typeof PREFS]: ReturnType<(typeof PREFS)[K]["read"]> };

export const readPrefs = () => Object.fromEntries(Object.entries(PREFS).map(([k, p]) => [k, p.read(stored.get(p.key))])) as Prefs;
export const savePref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => stored.set(PREFS[k].key, (PREFS[k].write as (x: Prefs[K]) => string)(v));
