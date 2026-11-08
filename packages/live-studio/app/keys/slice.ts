// The key rows' part of the page state (core/store.ts)
// A key on the key rows (keys.ts): which key file, the row's path in it, and the key's place in that row
export interface KeyRef { f: number; path: string[]; i: number }

export interface KeysSlice {
  keyFiles: string[] | null; // the film's key files (package.json "live-studio".keyFiles): the key rows and tab show. null: not loaded yet
  keyPicks: KeyRef[];
  keysSaved: "busy" | "fail" | null;
  keysRev: number;
}
export const keysSlice: KeysSlice = { keyFiles: null, keyPicks: [], keysSaved: null, keysRev: 0 };
