import type { Shot } from "film/scene";

import { S } from "./state";
import { get, set } from "./store";

export type FilmShot = Shot;

export interface FilmMetaSource {
  readonly DURATION: number;
  readonly SHOTS: FilmShot[];
  readonly SHOTS_OUT: FilmShot[];
  applyEdit: () => void;
}

export type ShotList = FilmShot[];

export let DURATION = 0;
export const SHOTS: ShotList = [];
export const SHOTS_OUT: ShotList = [];

let source: FilmMetaSource | null = null;

export const syncFilmMeta = () => {
  if (!source) return;
  DURATION = source.DURATION;
  SHOTS.splice(0, SHOTS.length, ...source.SHOTS);
  SHOTS_OUT.splice(0, SHOTS_OUT.length, ...source.SHOTS_OUT);
  if (DURATION > 0) S.t = Math.max(0, Math.min(S.t, Math.max(0, DURATION - 0.01)));
  set({ metaRev: get().metaRev + 1 });
};

export const setFilmSource = (mod: FilmMetaSource) => {
  source = mod;
  if (mod.DURATION > 0) syncFilmMeta();
};

export const applyEdit = () => {
  if (!source) return;
  source.applyEdit();
  syncFilmMeta();
};
