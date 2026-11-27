import type {
  CompareVideoCatalog,
  CompareVideoCategory,
  CompareVideoItem,
  CompareVideoLayout,
  CompareVideoMeta,
  NoteCompareSource,
} from "../../src/compare-video-meta.ts";

export type {
  CompareVideoCatalog,
  CompareVideoCategory,
  CompareVideoItem,
  CompareVideoLayout,
  CompareVideoMeta,
  NoteCompareSource,
};

export interface LiteShot {
  t: number;
  name: string;
}

export interface LiteFilmMeta {
  name: string;
  ratio: string;
  project?: string;
  port?: number;
  lite?: boolean;
  duration: number;
  shots: LiteShot[];
}

export interface LiteBootData {
  film?: Partial<LiteFilmMeta>;
}

export interface Pin {
  x: number;
  y: number;
  what: string;
  world?: number[];
}

export interface Fix {
  what: string;
  checkpoint?: string;
  at: string;
  ask?: boolean;
  after?: string;
  noAfterReason?: string;
  t?: number;
  cam?: {
    p: number[];
    l: number[];
    fov?: number;
    roll?: number;
    wave?: number;
  };
}

export type NoteState = "open" | "check" | "done";
export type NoteStatusFilter = "all" | NoteState | "asking";

export interface Remember {
  scope: "film" | "all";
  at: string;
}

export type InkKind = "pen" | "arrow" | "box" | "path";

export interface Hit {
  what: string;
  world?: number[];
}

export interface Mark {
  kind: InkKind;
  t: number;
  pts: [number, number][];
  ts?: number[];
  hits?: Hit[];
  keyPts?: [number, number][];
}

export interface Note {
  id: string;
  at: string;
  t: number;
  time: string;
  frame: number;
  shot: number;
  shotName?: string;
  srcT?: number;
  text: string;
  done: boolean;
  pin?: Pin | null;
  freeCam?: boolean;
  compareVideo?: NoteCompareSource;
  staleBuild?: boolean;
  img?: string;
  crop?: string;
  strip?: string;
  frames?: { t: number; img: string }[];
  refs?: string[];
  marks?: Mark[];
  range?: [number, number];
  fixes?: Fix[];
  state?: NoteState;
  asks?: { text: string; at: string }[];
  edits?: { at?: string; was: string }[];
  approved?: string;
  remember?: Remember;
  learned?: { what: string; scope: Remember["scope"]; at: string };
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RefPic {
  id: string;
  url: string;
}

export interface ComposeCreate {
  kind: "create";
  t: number;
  shot: number;
  shotName: string;
  pin: Pin | null;
  resume: boolean;
  wasPlaying: boolean;
  autoFocus?: boolean;
  compareVideo?: NoteCompareSource;
}

export interface ComposeEdit {
  kind: "edit";
  id: string;
  time: string;
  original: string;
  t: number;
  shot: number;
  shotName: string;
  pin: null;
  resume: boolean;
}

export type Compose = ComposeCreate | ComposeEdit;

export type NoteChange =
  | { text: string }
  | { done: boolean }
  | { approve: true }
  | { again: string }
  | { remember: "film" | "all" | null };

export type NoteOp = NoteChange | { remove: true } | { restore: true; text?: string };

export interface OutgoingNote {
  note: Note;
  img?: string | null;
  crop?: string | null;
  strip?: string | null;
  frames?: { t: number; img: string }[];
  refs?: string[];
}

export interface ScrubberMark {
  t: number;
  to?: number;
  done: boolean;
  check: boolean;
  asking: boolean;
}
