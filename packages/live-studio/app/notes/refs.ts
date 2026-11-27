import { showUndo } from "@/components/ui/toast";

import { stored } from "../core/storage";
import { get, say, set } from "../core/store";
import type { RefPic } from "./slice";

export const REFS_MAX = 6;
const REF_SIDE = 1600,
  QUALITY = 0.88,
  KEY = "noteDraftRefs";

export const refHooks = { changed: () => {} };
const persistRefs = (refs: readonly RefPic[]) => {
  if (!refs.length) stored.remove(KEY);
  else if (!stored.set(KEY, JSON.stringify(refs)))
    say(
      "These pictures are too big to keep through a reload: send the note before you leave",
      6000,
    );
};
const keep = (refs: RefPic[]) => {
  const cs = get().composeState;
  if (cs.status !== "create-editing") {
    if (!refs.length) persistRefs([]);
    return;
  }
  set({ composeState: { ...cs, refs } });
  refHooks.changed();
  persistRefs(refs);
};

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

export const addRefs = async (files: Iterable<File>) => {
  const pictures = [...files].filter((f) => f.type.startsWith("image/"));
  if (!pictures.length) return false;
  const cs = get().composeState;
  if (cs.status === "create-saving" || cs.status === "edit-saving") return true;
  if (cs.status !== "create-editing") {
    say("Pictures go with a new note, not an edit of an old one");
    return true;
  }
  const compose = cs.compose;
  const room = REFS_MAX - cs.refs.length;
  if (pictures.length > room) say(`${REFS_MAX} pictures at most on one note`);
  const made: RefPic[] = [];
  for (const f of pictures.slice(0, Math.max(0, room))) {
    try {
      const bmp = await createImageBitmap(f);
      const src = toJpeg(bmp, bmp.width, bmp.height);
      bmp.close();
      made.push({ id: crypto.randomUUID(), src, strokes: [], url: src });
    } catch {
      say(`Couldn’t read ${f.name || "that picture"}. Try another image.`);
    }
  }
  const nowCs = get().composeState;
  if (made.length && nowCs.status === "create-editing" && nowCs.compose === compose) {
    keep([...nowCs.refs, ...made].slice(0, REFS_MAX));
  }
  return true;
};
export const changeRef = (r: RefPic) => {
  const cs = get().composeState;
  if (cs.status !== "create-editing") return;
  keep(cs.refs.map((x) => (x.id === r.id ? r : x)));
};
export const removeRef = (id: string) => {
  const cs = get().composeState;
  if (cs.status !== "create-editing") return;
  const cur = cs.refs;
  const idx = cur.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const removed = cur[idx];
  const compose = cs.compose;
  keep(cur.filter((x) => x.id !== id));
  showUndo(
    removed.strokes.length ? "Picture & drawing removed" : "Reference picture removed",
    () => {
      const nowCs = get().composeState;
      if (nowCs.status !== "create-editing" || nowCs.compose !== compose) return;
      const now = nowCs.refs;
      if (now.some((x) => x.id === removed.id) || now.length >= REFS_MAX) return;
      const next = [...now];
      next.splice(Math.min(idx, next.length), 0, removed);
      keep(next);
    },
  );
};
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
export const restoreRefs = (): RefPic[] => {
  let raw: unknown = null;
  try {
    raw = JSON.parse(stored.get(KEY) ?? "null");
  } catch {}
  return Array.isArray(raw) ? raw.filter(isRef).slice(0, REFS_MAX) : [];
};
