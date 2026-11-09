// What the studio imports from a film (docs/film-contract.md). Vite resolves film/* to the film's src/ (src/vite_film.mjs);
// src/contract.mjs checks the same shapes at run time, since a film is plain code the studio did not write.
declare module "film/scene" {
  import type * as THREE from "three";

  export interface Shot { t: number; [key: string]: unknown }
  export interface FreeCam { on: boolean; p: THREE.Vector3; l: THREE.Vector3; fov: number }
  export interface Tools {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    look: THREE.Vector3;
    free: FreeCam;
    home?: { p: [number, number, number]; l: [number, number, number]; fov?: number }; // where the first free camera after a reload starts
    objects?: [THREE.Object3D, string][];
    materials?: [THREE.Material, string][];
    rig?: THREE.Object3D;
    bones?: Record<string, THREE.Object3D>;
    zoomOf?: (shot: number) => number;
    smoother?: (u: number) => number;
    head?: THREE.Vector3;
    CELL?: number;
    placed?: Placed;
    titles?: Titles;
  }
  // film-stage/titles.ts makeTitles: draws text.json's items over the frame, and tells the studio where each one is
  export interface TitleFx { id: string; title: string; len: number }
  export interface Titles {
    (list: unknown[], t: number, camera?: THREE.Camera, tracks?: Record<string, { hidden?: boolean }>): void;
    boxes(list: unknown[], t: number, camera?: THREE.Camera, tracks?: Record<string, { hidden?: boolean }>): { i: number; box: [number, number, number, number] }[];
    fonts: { id: string; title: string; css: string }[];
    anims: { text: { in: TitleFx[]; out: TitleFx[] }; shape: { in: TitleFx[]; out: TitleFx[] } };
  }
  // mc-assets/placed.ts: objects dropped in from the Objects library, stored in the keyFiles entry whose EDIT key is `key`
  export interface Placed {
    key: string;
    root: THREE.Object3D;
    hold: string | null;
    sync(): Promise<void>;
    draw(t: number): void;
    objectOf(name: string): THREE.Object3D | null;
    nameOf(o: THREE.Object3D): string | null;
    clipsOf(name: string): string[];
    // The clip running at t and the second it started (the key naming it; the first key for the object's own)
    clipAt(name: string, t: number): { clip?: string; from: number; rate: number } | null;
    // A point per frame (fps, default 30) from its first key to its last, and one per key, in world space
    pathOf(name: string, fps?: number): { frames: THREE.Vector3[]; keys: THREE.Vector3[] };
    catalog(): Promise<{ what: string; kind: "block" | "mob" | "custom"; title: string }[]>;
    icon(what: string, size?: number): Promise<string | null>;
  }
  export interface ReviewSection { head: string; lines: { text: string; fresh?: boolean }[] }
  export interface Variant {
    id: string;
    title: string;
    options: { id: string; title: string }[];
    set(id: string): void;
    pick: { id: string; title: string };
    ranges: [number, number][];
    off?: boolean; // set("off") hides it: the studio adds an Off chip
  }
  // film-stage/animate.ts ANIMS: what a shot's "anim" {in, out, combo} may name (fx: id), for the studio's Animation tab
  export interface AnimFx { id: string; title: string; cat: string; tip: string; len?: number; black?: boolean }
  export interface Draw {
    (t: number): void;
    tools: Tools;
    describe?: (t: number) => ReviewSection[];
    checks?: Record<string, (...args: number[]) => string | string[]>; // CHECK=name:args in a draft render (render.mjs)
    variants?: Variant[];
    eases?: Record<string, (x: number) => number>; // the camera keys' named eases (film-stage EASES), for the camera row
    anims?: { in: AnimFx[]; out: AnimFx[]; combo: AnimFx[] };
    transitions?: readonly { id: string; title: string; tip: string }[];
    adjustments?: { prepare: (grades: unknown[]) => Promise<void> };
  }
  export const SHOTS: Shot[];
  export const SHOTS_OUT: Shot[];
  export let DURATION: number;
  export function applyEdit(): void;
  export function buildScene(canvas: HTMLCanvasElement, w: number, h: number, draft: boolean): Promise<Draw>;
}

declare module "film/edit" {
  export interface Beat { title: string; at: number; dur: number; kind: "motion" | "sound"; sounds: [number, string, number][]; curve?: string }
  export interface Edit {
    voice: { edits: Record<string, { speed?: number } | undefined>; warp: [number, number][] };
    beats: Record<string, Beat>;
    zoomRate?: number;
    [key: string]: unknown;
  }
  export const EDIT: Edit;
  export function setEdit(data: unknown): void;
  export function toSource(out: number): number;
  export function fromSource(src: number): number;
}

interface Window {
  __assets?: string;
  __live?: { t: number; shot: number; drawMs: number };
  __editor?: unknown;
  __hits?: { n: number; set: string; at: number; late: number };
  __stems?: Record<string, { set: string; offset: number }>;
  __sounds?: number;
  __lanes?: { sounding: number; at: number; plans: number };
  __lanesRender?: (from: number, to: number) => Promise<{ rms: number[]; peak: number } | null>;
  __readyAt?: number;
}
