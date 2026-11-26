import type { G } from "./toon-geom";

export interface Brow {
  y: number;
  tilt: number;
  curve: number;
  x: number;
  len: number;
  thick: number;
}
export interface Eye {
  open: number;
  low: number;
  look: [number, number];
  pupil: number;
  size: number;
  tilt: number;
  closed: number;
  shine: number;
  wet: number;
  shape: string;
}
export interface Mouth {
  x: number;
  y: number;
  width: number;
  curve: number;
  open: number;
  teeth: number;
  lower: number;
  tongue: number;
  skew: number;
  round: number;
  shape: string;
}
export type Extras = Record<string, number>;
export interface Face {
  brows: { L: Brow; R: Brow };
  eyes: { L: Eye; R: Eye };
  mouth: Mouth;
  extras: Extras;
}
export interface SideSpec {
  brow?: Partial<Brow>;
  eye?: Partial<Eye>;
}
export interface FaceSpec extends SideSpec {
  from?: string;
  mouth?: Partial<Mouth>;
  extras?: Extras;
  L?: SideSpec;
  R?: SideSpec;
}

export interface ShapeArgs {
  cx: number;
  cy: number;
  w: number;
  h: number;
  side: -1 | 1;
  eye: Eye;
  style: ToonStyle;
}
export type EyeShape = (g: G, a: ShapeArgs) => void;

export interface MouthArgs {
  cx: number;
  cy: number;
  w: number;
  h: number;
  lift: number;
  mouth: Mouth;
  style: ToonStyle;
}
export type MouthShape = (g: G, a: MouthArgs) => void;

export interface Mark {
  at: "under" | "over" | "around";
  draw: (g: G, k: number, face: Face, style: ToonStyle) => void;
}

export type Layer = (g: G, face: Face, style: ToonStyle) => void;

export interface CuteRange {
  pupil: number;
  browTilt: [number, number];
  browCurve: number;
  eyeTilt: number;
  low: number;
  mouthWidth: number;
  skew: number;
}

export interface ToonStyle {
  size: number;
  color: {
    sclera: string;
    iris: string;
    lash: string;
    brow: string;
    mouth: string;
    teeth: string;
    tongue: string;
    line: string;
    blush: string;
    tear: string;
    sweat: string;
    gloom: string;
    vein: string;
    heart: string;
    star: string;
    gem: string;
    pale: string;
    sick: string;
    bags: string;
    puff: string;
    exclaim: string;
    question: string;
    zzz: string;
    bulb: string;
    note: string;
    cloud: string;
    soul: string;
  };
  eye: {
    x: number;
    w: number;
    top: number;
    peak: number;
    bottom: number;
    r: number;
    rOut: number;
    wave: number;
    lash: number;
    hookX: number;
    hookY: number;
    iris: number;
    irisY: number;
    converge: number;
    sink: number;
    closedY: number;
    closedW: number;
    closedH: number;
    closedTilt: number;
    closedShift: number;
    closedDrop: number;
    closedSpread: number;
  };
  brow: { x: number; y: number; len: number; tilt: number; thick: number; arch: number };
  mouth: { y: number; width: number; open: number; lift: number; sag: number; line: number };
  cute: CuteRange | null;
  shapes: Record<string, EyeShape>;
  mouths: Record<string, MouthShape>;
  marks: Record<string, Mark>;
  layers: Layer[];
}
