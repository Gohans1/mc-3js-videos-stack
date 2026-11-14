// Pictures pasted into the note being written (a reference, a screenshot of what it should look like): pasted, dropped or
// picked in the note box, kept on the device with the draft, sent with the note as JPEGs (src/notes.mjs saves them as refs)
import { stored } from "../core/storage";
import { get, say, set } from "../core/store";
import type { RefPic } from "./slice";

// api.mjs NoteIn takes 6; 1600 px keeps a screenshot's small text readable and six of them inside the page's storage
export const REFS_MAX = 6;
const REF_SIDE = 1600,
  QUALITY = 0.88,
  KEY = "noteDraftRefs";

export const refHooks = { changed: () => {} }; // notes.ts: the note being written is kept on the device with its pictures
const keep = (refs: RefPic[]) => {
  set({ refs });
  refHooks.changed();
  if (!refs.length) stored.remove(KEY);
  else if (!stored.set(KEY, JSON.stringify(refs)))
    say(
      "These pictures are too big to keep through a reload: send the note before you leave",
      6000,
    );
};

// Every picture becomes a JPEG on white (a PNG's see-through parts would turn black)
export const toJpeg = (source: CanvasImageSource, w: number, h: number) => {
  const k = Math.min(1, REF_SIDE / Math.max(w, h)),
    c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", QUALITY);
};

// Says whether any of them was a picture, so a paste of words still pastes the words
export const addRefs = async (files: Iterable<File>) => {
  const pictures = [...files].filter((f) => f.type.startsWith("image/"));
  if (!pictures.length) return false;
  const compose = get().compose;
  if (compose?.kind !== "create") {
    say("Pictures go with a new note, not an edit of an old one");
    return true;
  }
  const room = REFS_MAX - get().refs.length;
  if (pictures.length > room) say(`${REFS_MAX} pictures at most on one note`);
  const made: RefPic[] = [];
  for (const f of pictures.slice(0, Math.max(0, room))) {
    try {
      const bmp = await createImageBitmap(f);
      const src = toJpeg(bmp, bmp.width, bmp.height);
      bmp.close();
      made.push({ id: crypto.randomUUID(), src, strokes: [], url: src });
    } catch {
      say(`Couldn't read ${f.name || "that picture"}`);
    }
  }
  if (made.length && get().compose === compose) keep([...get().refs, ...made]);
  return true;
};
export const changeRef = (r: RefPic) => keep(get().refs.map((x) => (x.id === r.id ? r : x)));
export const removeRef = (id: string) => keep(get().refs.filter((x) => x.id !== id));
export const setRefs = keep;

const isRef = (r: unknown): r is RefPic => {
  const x = r as RefPic;
  return (
    !!x &&
    typeof x.id === "string" &&
    typeof x.src === "string" &&
    typeof x.url === "string" &&
    x.url.startsWith("data:image/jpeg;base64,/9j/") &&
    Array.isArray(x.strokes)
  );
};
export const restoreRefs = () => {
  let raw: unknown = null;
  try {
    raw = JSON.parse(stored.get(KEY) ?? "null");
  } catch {}
  set({ refs: Array.isArray(raw) ? raw.filter(isRef).slice(0, REFS_MAX) : [] });
};
