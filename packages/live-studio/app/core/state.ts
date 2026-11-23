import type { Draw, Tools } from "film/scene";

import { stored } from "./storage";

export interface Word {
  w: string;
  s: number;
  e: number;
}
export interface Line {
  text: string;
  s: number;
  e: number;
  words: Word[];
  pieces?: Word[][];
}
export interface VoiceMap {
  placements?: Array<{ id: string; start: number; spokenEnd?: number; naturalEnd: number }>;
  step: number;
  peaks: number[];
  lines: Line[];
}

export interface Elements {
  view: HTMLElement;
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  final: HTMLCanvasElement;
  inspection: HTMLCanvasElement;
  shutter: HTMLCanvasElement;
  horizon: HTMLElement;
  minimap: HTMLCanvasElement;
  audio: HTMLAudioElement;
  clock: HTMLElement;
  hud: HTMLElement;
  caption: HTMLElement;
  pins: HTMLElement;
  chips: HTMLElement;
  ink: HTMLCanvasElement;
  filmview: HTMLCanvasElement;
  ruler: HTMLCanvasElement;
  detail: HTMLCanvasElement;
  lanes: HTMLCanvasElement;
  camrow: HTMLCanvasElement;
  keyrows: HTMLCanvasElement;
  textrow: HTMLCanvasElement;
  textsel: HTMLElement;
  timeline: HTMLElement;
  ai: HTMLElement;
  playhead: HTMLElement;
  rowbox: HTMLElement;
  peek: HTMLElement;
  snap: HTMLElement;
  scopes: HTMLElement;
  parade: HTMLCanvasElement;
  wave: HTMLCanvasElement;
  vector: HTMLCanvasElement;
}
export type Bind = <K extends keyof Elements>(key: K) => (node: Elements[K] | null) => void;

type WakeEvent = "render" | "time" | "playing" | "rendered" | "audio";
const subs: Record<WakeEvent, Set<() => void>> = {
  render: new Set(),
  time: new Set(),
  playing: new Set(),
  rendered: new Set(),
  audio: new Set(),
};
export const wake = (kind: WakeEvent) => {
  for (const fn of subs[kind]) fn();
};
export const onWake = (kind: WakeEvent, fn: () => void) => {
  subs[kind].add(fn);
  return () => {
    subs[kind].delete(fn);
  };
};

let _t = Math.max(0, Number(stored.get("t", sessionStorage)) || 0);
let _playing = false;
let _dirty = true;
let _viewMoved = false;

export const S = {
  el: null as unknown as Elements,
  film: "",
  get t() {
    return _t;
  },
  set t(v: number) {
    if (v === _t) return;
    _t = v;
    wake("time");
  },
  get playing() {
    return _playing;
  },
  set playing(v: boolean) {
    if (v === _playing) return;
    _playing = v;
    if (v) wake("render");
    wake("playing");
  },
  get dirty() {
    return _dirty;
  },
  set dirty(v: boolean) {
    _dirty = v;
    if (v) wake("render");
  },
  get viewMoved() {
    return _viewMoved;
  },
  set viewMoved(v: boolean) {
    _viewMoved = v;
    if (v) wake("render");
  },
  watch: onWake,
  render: null as Draw | null,
  tools: null as Tools | null,
  finalRender: null as Draw | null,
  finalAt: -1,
  comments: [] as string[],
  voice: { step: 0.04, peaks: [], lines: [] } as VoiceMap,
  voiceReady: false,
  voiceOut: [] as Line[],
  voiceBase: [] as Line[],
  clockStart: 0,
  dragging: null as { resume: boolean } | null,
  failedFile: "",
  timesRev: 0,
};
