import { type Ratio, sizeOf } from "../../src/frame.ts";
import { bootData, type FilmFeatures } from "../core/boot";
import { getFile, postJson } from "../core/net";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { reloadNow } from "../playback/transport";

const ALL_FEATURES: FilmFeatures = {
  cam: true,
  lights: true,
  shots: true,
  text: true,
  adjustment: true,
  timing: true,
  keys: true,
  sound: true,
  voice: true,
  voiceMap: true,
  trials: true,
  choices: true,
  mix: true,
};
let cachedFeatures: FilmFeatures = bootData()?.film?.has ?? ALL_FEATURES;
let usedBootFilm = false;

export const filmFeatures = (): FilmFeatures => cachedFeatures;

const applyFilmMeta = (data: {
  name?: string;
  ratio?: string;
  video?: boolean;
  has?: FilmFeatures;
}) => {
  const name = data.name ?? "film";
  const ratio = (data.ratio as Ratio | undefined) ?? "16:9";
  const video = Boolean(data.video);
  if (data.has) cachedFeatures = data.has;
  S.film = name;
  document.title = `${name} · Studio`;
  set({ ratio, hasVideo: video });
  document.documentElement.style.setProperty("--frame", ratio.replace(":", " / "));
};

export const loadFilm = async () => {
  const inline = !usedBootFilm ? bootData()?.film : undefined;
  if (inline?.name && inline.ratio) {
    usedBootFilm = true;
    applyFilmMeta(inline);
    return;
  }
  const r = await getFile("/api/film.json");
  applyFilmMeta(r.ok ? await r.json() : {});
};
export const frameSize = (long: number) => sizeOf(get().ratio, long);

export const setRatio = async (ratio: Ratio) => {
  if (ratio === get().ratio) return;
  const r = await postJson("/api/film", { ratio }).catch(() => null);
  if (!r?.ok) {
    say("Couldn't change the aspect ratio: the studio didn't answer");
    return;
  }
  reloadNow();
};
