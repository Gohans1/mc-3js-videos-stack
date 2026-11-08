// The creator's favorites, CapCut's star: sounds by file name, effects by id ("move:push", "fade:dip"). They are the person's,
// kept by the server for every film and device (src/favorites.mjs), so the page asks for them and shows a change at once
import { getFile, postJson } from "./net";
import { get, say, set } from "./store";

export type Favorites = { sounds: string[]; effects: string[] };
export type FavoriteKind = keyof Favorites;

export const loadFavorites = async () => { const r = await getFile("/api/favorites"); if (r.ok) set({ favorites: await r.json() }); };

// name: what the line over the picture calls it
export const toggleFavorite = async (kind: FavoriteKind, id: string, name: string) => {
  const was = get().favorites, on = !was[kind].includes(id), rest = was[kind].filter((x) => x !== id);
  set({ favorites: { ...was, [kind]: on ? [...rest, id] : rest } });
  say(on ? `${name} added to Favorites` : `${name} removed from Favorites`);
  const r = await postJson("/api/favorites", { kind, id, on }).catch(() => null);
  if (r?.ok) set({ favorites: await r.json() });
  else { say(`Couldn't save the favorite for ${name}. Try again`, 5000); loadFavorites(); }
};
