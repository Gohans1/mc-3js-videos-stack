// The creator's favorites, CapCut's star: sounds by file name and effects by id ("move:push", "fade:dip"). They belong to the
// person, not to a film, so they live in the user's settings folder (%APPDATA%\live-studio on Windows, ~/.config/live-studio
// elsewhere) and a star given in one film, or on the phone, is there in every other
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import * as z from "zod";

export const FAVORITES = join(
  process.env.APPDATA ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "live-studio",
  "favorites.json",
);
const Favorites = z.object({
  sounds: z.array(z.string()).default([]),
  effects: z.array(z.string()).default([]),
});
export const FavoriteChange = z.object({
  kind: z.enum(["sounds", "effects"]),
  id: z.string().min(1).max(200),
  on: z.boolean(),
});

export const openFavorites = (file = FAVORITES) => {
  // A file that doesn't parse throws instead of reading as empty: the next star would otherwise write over every other one
  const read = () =>
    existsSync(file)
      ? Favorites.parse(JSON.parse(readFileSync(file, "utf8")))
      : { sounds: [], effects: [] };
  // Read again on every change, since the studio of another film may have starred something meanwhile. Newest last
  const set = ({ kind, id, on }) => {
    const all = read(),
      rest = all[kind].filter((x) => x !== id);
    all[kind] = on ? [...rest, id] : rest;
    mkdirSync(dirname(file), { recursive: true });
    const fresh = `${file}.${process.pid}.tmp`;
    writeFileSync(fresh, JSON.stringify(all, null, 1) + "\n");
    renameSync(fresh, file);
    return all;
  };
  // What the page shows: a file that doesn't parse shows no stars and says so here, instead of failing the page's load
  const shown = () => {
    try {
      return read();
    } catch (e) {
      console.warn(
        `favorites: ${file} doesn't parse (${e.message}); no stars shown until it's fixed`,
      );
      return { sounds: [], effects: [] };
    }
  };
  return { file, read, shown, set };
};
