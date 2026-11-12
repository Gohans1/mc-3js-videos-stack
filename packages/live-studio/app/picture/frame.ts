// The film's frame shape (src/frame.mjs: package.json "live-studio".ratio, 16:9 or 9:16) and name, asked for before the scene is
// built. Every size the page draws the picture at comes from frameSize; CSS reads --frame (index.css) for boxes that follow it
import { type Ratio, sizeOf } from "../../src/frame.ts";
import { getFile, postJson } from "../core/net";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { reloadNow } from "../playback/transport";

export const loadFilm = async () => {
  const r = await getFile("/api/film.json");
  const { name = "film", ratio = "16:9" }: { name?: string; ratio?: Ratio } = r.ok
    ? await r.json()
    : {};
  S.film = name;
  document.title = `${name} · Studio`; // two films open side by side tell their tabs apart
  set({ ratio });
  document.documentElement.style.setProperty("--frame", ratio.replace(":", " / "));
};
// [width, height] with the long side this long
export const frameSize = (long: number) => sizeOf(get().ratio, long);

// The film takes the new shape (its package.json); this page reloads at this second to build the scene at it, and other open
// pages are told the film changed (start.ts "film")
export const setRatio = async (ratio: Ratio) => {
  if (ratio === get().ratio) return;
  const r = await postJson("/api/film", { ratio }).catch(() => null);
  if (!r?.ok) {
    say("Couldn't change the aspect ratio: the studio didn't answer");
    return;
  }
  reloadNow();
};
