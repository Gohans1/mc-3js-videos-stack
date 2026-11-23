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
  const read = () => {
    const from = [file, legacy].find((f) => f && existsSync(f));
    return from
      ? Favorites.parse(JSON.parse(readFileSync(from, "utf8")))
      : { sounds: [], effects: [] };
  };
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
