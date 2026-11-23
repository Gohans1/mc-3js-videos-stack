import type { SaveState } from "../core/doc";

export interface KeyRef {
  f: number;
  path: string[];
  i: number;
}

export interface KeysSlice {
  keyFiles: string[] | null;
  keyPicks: KeyRef[];
  keysSaved: SaveState;
  keysRev: number;
}
export const keysSlice: KeysSlice = { keyFiles: null, keyPicks: [], keysSaved: null, keysRev: 0 };
