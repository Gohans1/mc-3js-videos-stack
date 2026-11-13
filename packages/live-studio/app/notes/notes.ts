import { EDIT, fromSource, toSource } from "film/edit";
// Notes: what's wrong where, said while watching. Nothing typed is lost: every keystroke is kept on the device, a note waits on
// the device until the server has it, × only moves a note aside with an undo, and the server writes the file atomically.
import { DURATION, SHOTS_OUT as SHOTS } from "film/scene";

import { toast } from "@/components/ui/toast";

import { applyChange, type NoteChange, noteState } from "../../src/note-state.mjs";
import { timingClock } from "../../src/timing-state.mjs";
import { frameAt } from "../../src/timing.mjs";
import { camLine } from "../camera/camline";
import { PHONE } from "../core/device";
import { shotEnd, shotIndex } from "../core/film";
import { getFile, postJson, wait } from "../core/net";
import { matcher } from "../core/search";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { get, say, set, ui } from "../core/store";
import { FPS, stamp } from "../core/time";
import { captionAt } from "../picture/captions";
import { frameSize } from "../picture/frame";
import { finalCanvas, render } from "../picture/render";
import { seek, setPlaying } from "../playback/transport";
import { tone } from "../timeline/canvas";
import { inOutAt } from "../timeline/inout";
import { wordNear } from "../timeline/timeline";
import {
  clearInk,
  drawInk,
  drawMark,
  inkHooks,
  inkMarks,
  inkSpan,
  inkTimes,
  inkWords,
  restoreInk,
} from "./ink";
import { noteSecond, resolveNoteMedia } from "./note-card-meta";
import { NOTE_FADE, pinFade } from "./pinfade";
import {
  type Compose,
  type ComposeCreate,
  isComposeDirty,
  type Mark,
  normalizeStoredCompose,
  type Note,
  type Pin,
} from "./slice";

export const noteAt = (n: Note) =>
  noteSecond(
    n,
    fromSource,
    timingClock,
    // SHOTS_OUT starts are heard seconds (film/edit's fromSource runs through Speed); noteScene wants scene seconds
    SHOTS.map((s, i) => ({ t: frameAt(timingClock, s.t), name: S.comments[i] })),
  );
const whereText = (n: Note) =>
  `${stamp(n.t)} | shot ${n.shot} (${n.shotName ?? ""})${n.pin ? ` | ${n.pin.what}` : ""}${(n.marks as Mark[] | undefined)?.length ? ` | drawn: ${inkWords(n.marks as Mark[])}` : ""}`;
const lastFixAt = (n: Note) => n.fixes?.at(-1)?.at ?? n.at;

// ---------- The notes as every frame asks for them (pins, strokes, the timeline's markers, the list following the playhead),
// worked out once each time the notes or the heard seconds change (S.timesRev): a film can gather thousands of notes
export interface Placed {
  n: Note;
  t: number;
  span: [number, number] | null;
  words: string;
}
interface Index {
  notes: Note[];
  rev: number;
  open: Placed[];
  check: Placed[]; // answered by the AI, waiting for the creator
  done: Placed[];
  drawn: Placed[];
  marks: { t: number; to?: number; done: boolean; check: boolean }[];
}
let index: Index | null = null;
const indexed = () => {
  const notes = get().notes;
  if (index?.notes === notes && index.rev === S.timesRev) return index;
  const all = notes.map((n): Placed => {
    const t = noteAt(n),
      marks = n.marks as Mark[] | undefined;
    return {
      n,
      t,
      span: marks?.length ? inkSpan(marks) : null,
      words: `${n.text} ${n.pin?.what ?? ""} ${n.shotName ?? ""} ${stamp(t)}`,
    };
  });
  const open = all.filter((p) => noteState(p.n) === "open").sort((a, b) => a.t - b.t);
  const check = all.filter((p) => noteState(p.n) === "check").sort((a, b) => a.t - b.t);
  const done = all
    .filter((p) => noteState(p.n) === "done")
    .sort((a, b) => (lastFixAt(a.n) < lastFixAt(b.n) ? 1 : -1));
  const marks = all
    .toSorted((a, b) => a.t - b.t)
    .map(({ n, t, span }) => ({
      t,
      to: span && span[1] - span[0] > 1 / FPS ? t + span[1] - span[0] : undefined,
      done: noteState(n) === "done",
      check: noteState(n) === "check",
    }));
  return (index = {
    notes,
    rev: S.timesRev,
    open,
    check,
    done,
    drawn: open.filter((p) => p.span && !p.n.freeCam),
    marks,
  });
};
export const openNotes = () => indexed().open.map((p) => p.n);
export const noteMarks = () => indexed().marks;
export const drawnNotes = () => indexed().drawn;
// CapCut's Shift+M and Alt+Shift+M (next, previous marker): the playhead to the next or previous open note
export const nextNoteTime = (t: number, d: -1 | 1) => {
  const ts = indexed().open.map((p) => p.t);
  return d > 0 ? ts.find((x) => x > t + 0.02) : ts.findLast((x) => x < t - 0.02);
};

// What the list shows (its search, Show and Sort): the notes to fix, and the fixed ones (latest fix first) folded under them.
// byTime is the same notes to fix in film order, for the list to follow the playhead through
let shown: {
  ix: Index;
  key: string;
  open: Placed[];
  byTime: Placed[];
  check: Placed[];
  done: Placed[];
} | null = null;
export const shownNotes = () => {
  const ix = indexed(),
    { noteSearch: q, noteShow: only, noteSort: sort } = get(),
    here = only === "shot" ? shotIndex(S.t) : -1;
  const key = `${q}
${only}
${sort}
${here}`;
  if (shown?.ix === ix && shown.key === key) return shown;
  const hit = matcher(q),
    keep = (p: Placed) =>
      (only === "drawn" ? !!p.span : only === "shot" ? shotIndex(p.t) === here : true) &&
      hit(p.words);
  const byTime = ix.open.filter(keep);
  const open =
    sort === "film"
      ? byTime
      : byTime.toSorted((a, b) => (a.n.at < b.n.at ? -1 : 1) * (sort === "newest" ? -1 : 1));
  return (shown = {
    ix,
    key,
    open,
    byTime,
    check: ix.check.filter(keep),
    done: ix.done.filter(keep),
  });
};

// ---------- Pictures that go with a note: the frame with the pin, the area under it unmarked, and the seconds around it
// (a press during playback lands after what was being reacted to, and a note about a cut is about those seconds)
const shownAt = (x: number) => {
  render(x);
  return S.el.canvas;
};
const snapshot = (pin: Pin | null | undefined, at: number, marks: Mark[] = []) => {
  const c = document.createElement("canvas"),
    [w, h] = frameSize(960);
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(finalCanvas() ?? shownAt(at), 0, 0, w, h);
  for (const m of marks) drawMark(g, m, at, w, h, tone("ink"));
  if (pin) {
    g.strokeStyle = tone("primary");
    g.lineWidth = 3;
    g.beginPath();
    g.arc(pin.x * w, pin.y * h, 14, 0, 7);
    g.stroke();
    g.strokeStyle = "#000";
    g.lineWidth = 1;
    g.beginPath();
    g.arc(pin.x * w, pin.y * h, 16, 0, 7);
    g.stroke();
  }
  g.font = "bold 24px Consolas,monospace";
  g.textAlign = "right";
  g.fillStyle = "rgba(0,0,0,.7)";
  g.fillRect(w - 170, 8, 162, 34);
  g.fillStyle = "#fff";
  g.fillText(stamp(at), w - 16, 33);
  return c.toDataURL("image/jpeg", 0.85);
};
const pinCrop = (pin: Pin) => {
  const from = finalCanvas() ?? S.el.canvas,
    side = Math.round(Math.min(from.width, from.height) * 0.34);
  const c = document.createElement("canvas");
  c.width = c.height = 480;
  c.getContext("2d")!.drawImage(
    from,
    pin.x * from.width - side / 2,
    pin.y * from.height - side / 2,
    side,
    side,
    0,
    0,
    480,
    480,
  );
  return c.toDataURL("image/jpeg", 0.85);
};
const spread = <T>(xs: T[], n: number) =>
  xs.length <= n
    ? xs
    : Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]);
const STRIP = [-2, -1, 0, 1];
const momentStrip = (at: number) => {
  const [w, h] = frameSize(400),
    c = document.createElement("canvas");
  c.width = w * STRIP.length;
  c.height = h;
  const g = c.getContext("2d")!;
  g.font = "bold 20px Consolas,monospace";
  STRIP.forEach((d, i) => {
    const x = Math.min(Math.max(0, at + d), DURATION - 0.02);
    g.drawImage(shownAt(x), i * w, 0, w, h);
    g.fillStyle = "rgba(0,0,0,.7)";
    g.fillRect(i * w + 4, 4, 128, 28);
    g.fillStyle = d === 0 ? tone("primary") : "#fff";
    g.fillText(stamp(x), i * w + 8, 25);
    g.fillStyle = "#000";
    g.fillRect(i * w, 0, 2, h);
  });
  return c.toDataURL("image/jpeg", 0.8);
};
// Everything around the moment, as the film stood when the note was written
const noteContext = (c: ComposeCreate) => {
  const { voiceOut } = S,
    audio = S.el.audio;
  const near = (from: number, to: number, within: number) =>
    c.t >= from - within && c.t <= to + within;
  const here = voiceOut.findIndex((l) => c.t >= l.s && c.t <= l.e + 0.35);
  const after = voiceOut.findIndex((l) => l.s > c.t);
  const before =
    here >= 0 ? here - 1 : after > 0 ? after - 1 : after < 0 ? voiceOut.length - 1 : -1;
  const next = here >= 0 ? here + 1 : after;
  const all = voiceOut.flatMap((l) => l.words);
  const word = wordNear(c.t).word,
    wi = word ? all.indexOf(word) : -1;
  const beats = Object.entries(EDIT.beats)
    .map(([id, b]) => ({
      id,
      title: b.title,
      kind: b.kind,
      at: +fromSource(b.at).toFixed(3),
      dur: b.dur,
      sounds: b.sounds,
    }))
    .filter((b) => near(b.at, b.at + (b.dur ?? 0), 1.5));
  return {
    playing: !!c.wasPlaying, // pressed during playback: what it's about may be a moment earlier
    rate: audio.playbackRate,
    muted: audio.muted || undefined,
    volume: audio.volume !== 1 ? audio.volume : undefined,
    shot: {
      from: +SHOTS[c.shot].t.toFixed(3),
      to: +shotEnd(c.shot).toFixed(3),
      into: +(c.t - SHOTS[c.shot].t).toFixed(3),
    },
    voice: {
      word: word?.w,
      wordAt: word ? +word.s.toFixed(3) : undefined,
      around:
        wi >= 0
          ? all
              .slice(Math.max(0, wi - 4), wi + 5)
              .map((w) => w.w)
              .join(" ")
          : undefined,
      line: voiceOut[here]?.text,
      before: voiceOut[before]?.text,
      next: voiceOut[next]?.text,
      silence: here < 0 || undefined,
    },
    beats,
    view: {
      phone: PHONE,
      canvas: [S.el.canvas.width, S.el.canvas.height],
      screen: [innerWidth, innerHeight],
    },
  };
};

// ---------- Kept on the device until the server has it: a bad line delays a note, it never eats one
interface Outgoing {
  note: Note;
  img?: string | null;
  crop?: string | null;
  strip?: string | null;
  frames?: { t: number; img: string }[];
}
// What the page asks of a note, in the order asked: every one is sent, so an Approve and a Remember a moment apart both arrive
type Op = NoteChange | { remove: true } | { restore: true; text?: string };
let heldNotes: Outgoing[] | null = null,
  heldOps: Record<string, Op[]> | null = null;
// A queue spoilt on the device (cut short by a full disk, edited by hand) must not stop every later note from sending
const readQueue = <T>(key: string, empty: T): T => {
  try {
    return JSON.parse(stored.get(key) ?? "null") ?? empty;
  } catch {
    return empty;
  }
};
const unsent = (): Outgoing[] => heldNotes ?? readQueue("unsentNotes", []);
export const noteMedia = (n: Note) => resolveNoteMedia(n, unsent());
const keepUnsent = (list: Outgoing[]) => {
  // Storage full: the words matter more than the pictures, the main picture more than the extras. No storage at all: they wait in this page
  for (const slim of [
    (x: Outgoing) => x,
    (x: Outgoing) => ({ note: x.note, img: x.img, frames: x.frames }),
    (x: Outgoing) => ({ note: x.note, img: x.img }),
    (x: Outgoing) => ({ note: x.note }),
  ]) {
    if (stored.set("unsentNotes", JSON.stringify(list.map(slim)))) {
      heldNotes = null;
      return;
    }
  }
  heldNotes = list;
};
// A page from before kept one change per note, not a list
const unsentOps = (): Record<string, Op[]> =>
  heldOps ??
  Object.fromEntries(
    Object.entries(readQueue<Record<string, Op | Op[]>>("unsentEdits", {})).map(([id, o]) => [
      id,
      Array.isArray(o) ? o : [o],
    ]),
  );
const keepOps = (all: Record<string, Op[]>) => {
  heldOps = stored.set("unsentEdits", JSON.stringify(all)) ? null : all;
};
const queueOp = (id: string, op: Op) => {
  const all = unsentOps(),
    list = all[id] ?? [],
    last = list.at(-1);
  // new words for a note replace words not sent yet
  keepOps({
    ...all,
    [id]: last && "text" in last && "text" in op ? [...list.slice(0, -1), op] : [...list, op],
  });
};
const dropOp = (id: string, op: Op) => {
  const now = unsentOps(),
    rest = (now[id] ?? []).filter((x, i) => i > 0 || JSON.stringify(x) !== JSON.stringify(op));
  if (rest.length) now[id] = rest;
  else delete now[id];
  keepOps(now);
};

let flushing = false;
export const flushNotes = async () => {
  if (flushing) return;
  flushing = true;
  for (
    let list = unsent(), ops = Object.entries(unsentOps());
    list.length || ops.length;
    list = unsent(), ops = Object.entries(unsentOps())
  ) {
    set({ saved: "busy" });
    try {
      if (list.length) {
        const item = list[0];
        const r = await postJson("/api/notes", item);
        if (!r.ok) throw new Error(String(r.status));
        keepUnsent(unsent().filter((x) => x.note.id !== item.note.id));
        if (item.img || item.crop) {
          set({
            notes: get().notes.map((x) =>
              x.id === item.note.id
                ? {
                    ...x,
                    ...(item.img ? { img: `notes/img/${x.id}.jpg` } : {}),
                    ...(item.crop ? { crop: `notes/img/${x.id}_crop.jpg` } : {}),
                  }
                : x,
            ),
          });
        }
      } else {
        const [id, [op]] = ops[0];
        const r = await postJson(`/api/notes/${id}`, op);
        // 409: the note moved on meanwhile (the AI answered it, it was deleted): sending it again would never land
        if (r.status === 409) {
          dropOp(id, op);
          say(`Not sent: ${await r.text()}`);
          await loadNotes();
          continue;
        }
        if (!r.ok) throw new Error(String(r.status));
        dropOp(id, op);
      }
    } catch {
      set({ saved: "fail" });
      await wait(3000);
    }
  }
  flushing = false;
  set({ saved: null });
};

const changed = (notes: Note[]) => {
  set({ notes });
  S.dirty = true;
};
// The note with a change applied, as the server will have it (note-state.mjs), or the reason it can't happen now
const applied = (n: Note, op: NoteChange) => {
  const x = structuredClone(n),
    r = applyChange(x, op);
  return r.ok ? x : r.why;
};
export const loadNotes = async () => {
  const have: Note[] = await (await getFile("/api/notes")).json();
  const ops = unsentOps(),
    mine = get().notes;
  const gone = (id: string) => {
    const l = ops[id] ?? [];
    return l.findLastIndex((o) => "remove" in o) > l.findLastIndex((o) => "restore" in o);
  };
  const back = mine.filter(
    (n) => ops[n.id]?.some((o) => "restore" in o) && !have.some((h) => h.id === n.id),
  );
  const notes = [
    ...have,
    ...unsent()
      .map((x) => x.note)
      .filter((n) => !have.some((h) => h.id === n.id)),
    ...back,
  ]
    .filter((n) => !gone(n.id))
    .map((n) =>
      (ops[n.id] ?? []).reduce<Note>((x, o) => {
        if ("remove" in o || "restore" in o) return x;
        const y = applied(x, o);
        return typeof y === "string" ? x : y;
      }, n),
    );
  changed(notes);
  if (flushing) set({ saved: "busy" });
};

// One change to a note from the page: shown now, sent in order. Says why not when the note can't take it now
export const changeNote = (id: string, op: NoteChange, said?: string) => {
  const was = get().notes.find((x) => x.id === id);
  if (!was) return false;
  const n = applied(was, op);
  if (typeof n === "string") {
    say(n);
    return false;
  }
  changed(get().notes.map((x) => (x.id === id ? n : x)));
  queueOp(id, op);
  flushNotes();
  if (said) say(said);
  return true;
};

let editSend = 0;
const editNote = (id: string, words: string) => {
  const was = get().notes.find((x) => x.id === id);
  if (!was || !words || words === was.text) return;
  const n = applied(was, { text: words });
  if (typeof n === "string") return;
  changed(get().notes.map((x) => (x.id === id ? n : x)));
  queueOp(id, { text: words });
  set({ saved: "busy" });
  clearTimeout(editSend);
  editSend = window.setTimeout(flushNotes, 400);
};
const showUndo = (title: string, undo: () => void) => {
  const id = toast.add({
    title,
    timeout: 10000,
    actionProps: {
      children: "Undo",
      onClick: () => {
        toast.close(id);
        undo();
      },
    },
  });
};

// ---------- Writing a note
// What's being typed is on the device from the first letter: a reload or a killed tab brings it back
export const setDraft = (words: string) => {
  set({ draft: words });
  drawPins(); // the words show on the picture as they are typed
  drawInk(drawnNotes);
  const { compose } = get();
  if (isComposeDirty(compose, words, inkMarks.length > 0))
    stored.set("noteDraft", JSON.stringify({ compose, words }));
  else stored.remove("noteDraft");
};
// focus false: opened by a stroke, so a phone's keyboard stays down until the creator taps the box to say something
const openBox = (compose: Compose, words = "", focus = true) => {
  set({ compose, settingsOpen: false, side: "notes" });
  setDraft(words);
  drawPins();
  if (focus) ui.focusNote();
};
export const openNote = (pin: Pin | null, focus = true) => {
  const { compose, draft } = get();
  if (compose?.kind === "edit") {
    ui.focusNote();
    return;
  } // an old note's box stays on that note until Save or Cancel
  const wasPlaying = compose ? compose.wasPlaying : S.playing;
  // Words already written belong to the note they were written for: a new place starts a new note. On the same frame a click just moves the pin
  if (compose && draft.trim() && Math.abs(S.t - compose.t) > 0.01 && !inkMarks.length) {
    set({ compose: { ...compose, resume: false } });
    saveNote();
  }
  if (S.playing) setPlaying(false);
  render(S.t);
  const i = shotIndex(S.t);
  openBox(
    {
      kind: "create",
      t: S.t,
      shot: i,
      shotName: S.comments[i] ?? "",
      pin,
      resume: !!wasPlaying,
      wasPlaying,
      spoken: captionAt(S.t) ?? undefined,
    },
    get().draft,
    focus,
  );
};
// A drawing tool's first stroke opens the note it belongs to; later strokes, at any second, join it
export const ensureNote = () => {
  if (!get().compose) openNote(null, false);
};
inkHooks.changed = () => setDraft(get().draft);
export const restoreDraft = () => {
  restoreInk();
  let raw: { compose?: unknown; words?: string } | null = null;
  try {
    raw = JSON.parse(stored.get("noteDraft") ?? "null");
  } catch {}
  const compose = normalizeStoredCompose(raw?.compose),
    words = typeof raw?.words === "string" ? raw.words : "";
  if (!compose || !isComposeDirty(compose, words, inkMarks.length > 0)) {
    clearInk();
    return;
  }
  seek(compose.t);
  openBox(compose, words);
};
// An old note opens in the same box, with its words. Nothing is overwritten until Xong
export const editOldNote = (n: Note) => {
  const { compose, draft } = get();
  if (compose?.kind === "edit" && compose.id === n.id) {
    ui.focusNote();
    return;
  }
  const wasPlaying = compose ? compose.resume : S.playing;
  const at = noteAt(n);
  if (compose && isComposeDirty(compose, draft, inkMarks.length > 0)) {
    set({ compose: { ...compose, resume: false } });
    saveNote();
  } else if (compose) closeNote();
  if (S.playing) setPlaying(false);
  openBox(
    {
      kind: "edit",
      id: n.id,
      time: stamp(at),
      original: n.text,
      t: at,
      shot: n.shot,
      shotName: n.shotName ?? "",
      pin: null,
      resume: wasPlaying,
    },
    n.text,
  );
};
export const closeNote = () => {
  const resume = get().compose?.resume;
  set({ compose: null });
  clearInk();
  setDraft("");
  ui.blurNote();
  drawPins();
  if (resume) setPlaying(true);
};
// Cancel asks nothing: the words stay one press away in case it was a slip
export const cancelNote = () => {
  const { compose: was, draft: words } = get();
  if (!was) return;
  const strokes = inkMarks.slice();
  const lost = isComposeDirty(was, words, strokes.length > 0);
  closeNote();
  if (lost)
    showUndo(was.kind === "edit" ? `Edit at ${was.time} discarded` : "Note discarded", () => {
      if (get().compose) {
        set({ compose: { ...get().compose!, resume: false } });
        saveNote();
      }
      if (S.playing) setPlaying(false);
      if (was.kind === "create") seek(was.t);
      inkMarks.push(...strokes);
      openBox({ ...was, resume: false }, words);
    });
};
export const saveNote = () => {
  const { compose, draft, notes } = get();
  const body = draft.trim();
  if (!compose) return;
  if (compose.kind === "edit") {
    const { id, original: before, time: at } = compose,
      was = notes.find((x) => x.id === id);
    if (!body || body === before.trim()) {
      closeNote();
      return;
    } // emptied gets its words back: × is what removes a note
    if (was) editNote(id, body);
    else {
      queueOp(id, { restore: true, text: body });
      flushNotes();
    } // removed elsewhere meanwhile: these words still count
    closeNote();
    showUndo(`Note at ${at} updated`, () => editNote(id, before));
    return;
  }
  const strokes = inkMarks.slice();
  if (!body && !strokes.length) {
    closeNote();
    return;
  }
  const tools = S.tools!;
  const sp = inkSpan(strokes);
  const n: Note = {
    id: Date.now().toString(36),
    at: new Date().toISOString(),
    t: +compose.t.toFixed(3),
    time: stamp(compose.t),
    frame: Math.round(compose.t * FPS),
    shot: compose.shot,
    shotName: compose.shotName,
    srcT: +toSource(compose.t).toFixed(3),
    scene: +frameAt(timingClock, compose.t).toFixed(3),
    spoken: compose.spoken,
    pin: compose.pin,
    cam: camLine(),
    freeCam: tools.free.on || undefined,
    finalLook: get().final || undefined,
    context: noteContext(compose),
    text: body,
    done: false,
    marks: strokes.length ? strokes : undefined,
    range: strokes.length ? (sp && sp[1] - sp[0] > 1 / FPS ? sp : undefined) : inOutAt(compose.t),
  };
  // The note's own frame in its picture, even if the film has moved on since. No picture is no reason to lose the words
  let img: string | null = null,
    crop: string | null = null,
    strip: string | null = null,
    frames: { t: number; img: string }[] = [];
  try {
    strip = momentStrip(compose.t);
  } catch {}
  // A drawing over several seconds: one picture per second it was drawn at, with what was drawn there and the rest faint. Past
  // 8 of them: the first, the last and 6 evenly between, so a long path still shows where it starts and ends
  if (strokes.length)
    try {
      frames = spread(inkTimes(strokes), 8).map((t) => ({
        t: +t.toFixed(3),
        img: snapshot(null, t, strokes),
      }));
    } catch {}
  try {
    render(compose.t);
    img = snapshot(n.pin, compose.t, strokes);
    if (n.pin) crop = pinCrop(n.pin);
  } catch {}
  render(S.t);
  S.dirty = true;
  changed([...notes, n]);
  keepUnsent([...unsent(), { note: n, img, crop, strip, frames }]);
  flushNotes();
  closeNote();
};

export const removeNote = (n: Note) => {
  const waiting = unsent().find((x) => x.note.id === n.id);
  if (waiting) keepUnsent(unsent().filter((x) => x.note.id !== n.id));
  changed(get().notes.filter((x) => x.id !== n.id));
  queueOp(n.id, { remove: true });
  flushNotes();
  const existing = get().compose;
  if (existing?.kind === "edit" && existing.id === n.id) closeNote();
  showUndo(`Note at ${n.time} deleted`, () => {
    changed([...get().notes, n]);
    queueOp(n.id, { restore: true, text: n.text });
    if (waiting) keepUnsent([...unsent(), waiting]);
    flushNotes();
  });
};
// History is a record: the way back is "Reopen"
export const reopenNote = (n: Note) =>
  changeNote(n.id, { done: false }, `Note at ${stamp(noteAt(n))} moved back to To fix`);
// The creator's side of the AI's answer (note-state.mjs): approve a fix, or send words back and the note is the AI's again
export const approveNote = (n: Note) =>
  changeNote(n.id, { approve: true }, `Approved: note at ${stamp(noteAt(n))}`);
export const answerNote = (n: Note, words: string) =>
  changeNote(n.id, { again: words }, `Back to the AI with your words: note at ${stamp(noteAt(n))}`);
export const rememberNote = (n: Note, scope: "film" | "all" | null) =>
  changeNote(
    n.id,
    { remember: scope },
    scope
      ? `The AI will keep what this note teaches, for ${scope === "all" ? "every film" : "this film"}`
      : "No longer to remember",
  );
export const goToNote = (n: Note) => {
  if (S.playing) setPlaying(false);
  seek(noteAt(n));
};
// From two seconds before the note, playing, to see the moment come and go
export const playNote = (n: Note) => {
  seek(Math.max(0, noteAt(n) - 2));
  setPlaying(true);
};
// The film as it is now at a note's moment, drawn as the note's own picture was (its pin, its strokes): what the creator compares
// against that picture. Kept until the page reloads, which every change to the film's code or edit does (main.tsx)
const nowPictures = new Map<string, string | null>();
export const nowPicture = (n: Note) => {
  if (!nowPictures.has(n.id)) {
    let url: string | null = null;
    try {
      url = snapshot(n.pin, noteAt(n), (n.marks as Mark[] | undefined) ?? []);
    } catch {}
    render(S.t);
    S.dirty = true;
    nowPictures.set(n.id, url);
  }
  return nowPictures.get(n.id) ?? null;
};

// ---------- The Review room (ReviewRoom.tsx): the notes alone beside the picture
export const setReview = (on: boolean) => {
  if (!on) {
    set({ review: false });
    return;
  }
  if (get().compose) cancelNote(); // its words stay one press away, as any cancel
  const ix = indexed(),
    { reviewPick, reviewTab } = get();
  const keep = reviewPick && get().notes.some((x) => x.id === reviewPick);
  const tab = keep ? reviewTab : ix.check.length ? "check" : ix.open.length ? "open" : reviewTab;
  set({ review: true, reviewTab: tab, reviewPick: keep ? reviewPick : null });
  const first = keep ? get().notes.find((x) => x.id === reviewPick) : shownNotes()[tab][0]?.n;
  if (first) goToNote(first); // the picture opens on the note the room opens on
};
// The Review room opened on one note, in its own tab
export const reviewNote = (n: Note) => {
  set({ reviewPick: n.id, reviewTab: noteState(n) });
  setReview(true);
};
export const reviewList = (tab: "open" | "check" | "done") => shownNotes()[tab];
export const copyAll = () => {
  navigator.clipboard?.writeText(
    openNotes()
      .map((n) => `${whereText(n)}: ${n.text}`)
      .join("\n"),
  );
  say("Copied");
};
// The first of these notes (in film order) at or after second t
const firstFrom = (list: Placed[], t: number) => {
  let lo = 0,
    hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m].t < t) lo = m + 1;
    else hi = m;
  }
  return lo;
};
// The note nearest the playhead among those the list shows, for it to keep in view
export const followNotes = () => {
  const list = shownNotes().byTime,
    i = firstFrom(list, S.t),
    a = list[i - 1],
    b = list[i];
  const near = (!b || (a && S.t - a.t <= b.t - S.t) ? a : b)?.n.id ?? null;
  if (near !== get().nearNote) set({ nearNote: near });
};
// The pinned notes on the picture now: those from the last few seconds (pinfade.ts), fading
const EMPTY_PINS: { id: string; pin: Pin; text: string; fade: number }[] = [];
const pinsHere = () => {
  if (S.tools?.free.on) return EMPTY_PINS;
  const open = indexed().open;
  if (!open.length) return EMPTY_PINS;
  const rate = get().rate;
  let here: { id: string; pin: Pin; text: string; fade: number }[] | null = null;
  for (
    let i = firstFrom(open, S.t - NOTE_FADE * rate);
    i < open.length && open[i].t <= S.t + 0.05;
    i++
  ) {
    const { n, t } = open[i],
      fade = n.pin && !n.freeCam ? pinFade(t, S.t, rate) : 0;
    if (fade > 0) (here ??= []).push({ id: n.id, pin: n.pin!, text: n.text, fade });
  }
  return here ?? EMPTY_PINS;
};

addEventListener("online", flushNotes);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) flushNotes();
});

// ---------- The pins on the picture: saved notes on their frame, fading as the film plays on, and the one being written. Each
// keeps its element from frame to frame, only its fade changing; the one being written stays on top
const pinEls = new Map<string, HTMLDivElement>();
export const pinWordsUp = (y: number) => y > 0.88; // PinTools keeps clear of them
export const drawPins = () => {
  const box = S.el?.pins;
  if (!box) return;
  const own = get().compose?.pin,
    here = pinsHere();
  if (!here.length && !own) {
    if (!pinEls.size) return;
    for (const d of pinEls.values()) d.remove();
    pinEls.clear();
    return;
  }
  const want = here.map((p) => ({ ...p, saved: true }));
  if (own)
    want.push({ id: "", pin: own, text: get().draft.trim() || own.what, fade: 1, saved: false });
  const now = new Set<string>();
  for (const p of want) {
    const key = `${p.id}|${p.pin.x}|${p.pin.y}|${p.text}`;
    now.add(key);
    let d = pinEls.get(key);
    // A note shows its words, the one being written what was tapped until words come; each stays inside the picture's edges
    if (!d) {
      d = document.createElement("div");
      d.className = p.saved ? "pin saved" : "pin";
      d.style.left = `${p.pin.x * 100}%`;
      d.style.top = `${p.pin.y * 100}%`;
      if (p.text) {
        const i = document.createElement("i");
        i.textContent = p.text;
        if (pinWordsUp(p.pin.y)) i.className = "up";
        d.append(i);
      }
      pinEls.set(key, d);
      box.append(d);
    }
    const words = d.firstElementChild as HTMLElement | null,
      bw = box.clientWidth;
    if (words && bw && d.dataset.w !== String(bw)) {
      d.dataset.w = String(bw);
      const x = p.pin.x * bw,
        lw = words.offsetWidth;
      words.style.translate = `${Math.max(4 - x, Math.min(bw - 4 - lw - x, -lw / 2))}px 0`;
    }
    const fade = p.fade < 1 ? String(p.fade) : "";
    if (d.style.opacity !== fade) d.style.opacity = fade;
    if (!p.saved && d !== box.lastChild) box.append(d);
  }
  for (const [key, d] of pinEls)
    if (!now.has(key)) {
      d.remove();
      pinEls.delete(key);
    }
};
