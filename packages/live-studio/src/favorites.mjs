// The creator's favorites, CapCut's star: sounds by file name and effects by id ("transition:dissolve", "in:pop"; kinds no
// panel stars, like mocap, as "<kind>:<id>" from bun run find --star). They belong to the person, not to a film, so they
// live in the repo's favorites/ folder, one list per file: default.json is what the studio stars and find --fav reads,
// any other <name>.json is a list the creator keeps for one kind of film (find --fav <name>, find --star <id> --fav <name>)
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as z from "zod";

export const FAVORITES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../favorites");
export const FAVORITES = join(FAVORITES_DIR, "default.json");
// where stars were kept before they moved into the repo: read until the first new star writes default.json
const LEGACY = join(
  process.env.APPDATA ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "live-studio",
  "favorites.json",
);
export const LIST_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
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
  const legacy = resolve(file) === FAVORITES ? LEGACY : undefined;
  // A file that doesn't parse throws instead of reading as empty: the next star would otherwise write over every other one
  const read = () => {
    const from = [file, legacy].find((f) => f && existsSync(f));
    return from
      ? Favorites.parse(JSON.parse(readFileSync(from, "utf8")))
      : { sounds: [], effects: [] };
  };
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

// Every list in the folder, default first, each with how many stars it holds
export const favoriteLists = (dir = FAVORITES_DIR) => {
  const open = (name = "default") => openFavorites(join(dir, `${name}.json`));
  const lists = () => {
    const names = existsSync(dir)
      ? readdirSync(dir).flatMap((f) => (f.endsWith(".json") ? [f.slice(0, -5)] : []))
      : [];
    return [...new Set(["default", ...names.filter((n) => LIST_NAME.test(n))])].map((name) => {
      const { sounds, effects } = open(name).shown();
      return { name, count: sounds.length + effects.length };
    });
  };
  return { dir, lists, open };
};
