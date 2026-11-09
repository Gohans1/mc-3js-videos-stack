// The engine's own state, read and written every frame by its parts. Not React state: nothing here re-renders anything.
import type { Draw, Tools } from "film/scene";
import { DURATION } from "film/scene";
import { stored } from "./storage";

export interface Word { w: string; s: number; e: number }
export interface Line { text: string; s: number; e: number; words: Word[]; pieces?: Word[][] }
export interface VoiceMap { step: number; peaks: number[]; lines: Line[] }

// The page's elements the engine draws into, handed over by the React components that own them
export interface Elements {
  view: HTMLElement; stage: HTMLElement; canvas: HTMLCanvasElement; final: HTMLCanvasElement; audio: HTMLAudioElement;
  clock: HTMLElement; caption: HTMLElement; pins: HTMLElement; chips: HTMLElement; ink: HTMLCanvasElement;
  filmview: HTMLCanvasElement; ruler: HTMLCanvasElement; detail: HTMLCanvasElement; lanes: HTMLCanvasElement; camrow: HTMLCanvasElement; keyrows: HTMLCanvasElement; textrow: HTMLCanvasElement; textsel: HTMLElement; timeline: HTMLElement; rowbox: HTMLElement; peek: HTMLElement; snap: HTMLElement;
  scopes: HTMLElement; parade: HTMLCanvasElement; wave: HTMLCanvasElement; vector: HTMLCanvasElement;
}
// How a component hands its element over: ref={bind("canvas")}
export type Bind = <K extends keyof Elements>(key: K) => (node: Elements[K] | null) => void;

export const S = {
  el: null as unknown as Elements,
  film: "", // its name (package.json), from picture/frame.ts loadFilm
  t: Math.min(Number(stored.get("t", sessionStorage)) || 0, DURATION - 0.01),
  playing: false,
  dirty: true,
  viewMoved: false, // only the free camera moved since the last frame: the film camera's picture stays (picture/filmcam.ts)
  render: null as Draw | null,
  tools: null as Tools | null,
  finalRender: null as Draw | null,
  finalAt: -1,
  comments: [] as string[],
  voice: { step: 0.04, peaks: [], lines: [] } as VoiceMap,
  voiceOut: [] as Line[],
  clockStart: 0,
  dragging: null as { resume: boolean } | null,
  failedFile: "",
  timesRev: 0, // bumped whenever the heard seconds move (timeline.ts refreshTimes): what was worked out from them is stale
};
