import { EDIT, fromSource, toSource } from "film/edit";

import { showUndo } from "@/components/ui/toast";

import { applyChange, type NoteChange, noteState, WORD_NEAR } from "../../src/note-state.mjs";
import { timingClock } from "../../src/timing-state.mjs";
import { frameAt } from "../../src/timing.mjs";
import { camLine } from "../camera/camline";
import { PHONE } from "../core/device";
import { onDocMutated } from "../core/doc";
import { engine } from "../core/engine";
import { shotEnd, shotIndex } from "../core/film";
// Notes: what's wrong where, said while watching. Nothing typed is lost: every keystroke is kept on the device, a note waits on
// the device until the server has it, × only moves a note aside with an undo, and the server writes the file atomically.
import { DURATION, SHOTS_OUT as SHOTS } from "../core/filmMeta";
import { getFile, postJson, wait } from "../core/net";
import { matcher } from "../core/search";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { get, invalidatePictures, say, set, ui } from "../core/store";
import { FPS, stamp } from "../core/time";
import { captionAt } from "../picture/captions";
import { frameSize } from "../picture/frame";
import { seek, setPlaying } from "../playback/transport";
import { tone } from "../timeline/canvas";
import { inOutAt } from "../timeline/inout";
import { wordNear } from "../timeline/timeline";
import {
  composeExitReason,
  composeExitSnapshot,
  type ComposeOrigin,
  composeOrigin,
  originOf,
  pointOrigin,
  recordComposeExit,
  setComposeOrigin,
} from "./compose-motion";
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
import { noteNumberMap, noteSecond, resolveNoteMedia } from "./note-card-meta";
import { matchesNoteFilters, sortPlacedNotes } from "./note-views-model";
import { type ActivePinNote, activeStageNotes, type PinLike, resolvePinLayout } from "./pinfade";
import { refHooks, restoreRefs, setRefs } from "./refs";
import { nextReviewNeighborId, pickSnapshotSource, stepReviewPickId } from "./review-nav";
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
  marks: { t: number; to?: number; done: boolean; check: boolean; asking: boolean }[];
}
let index: Index | null = null;
const indexed = () => {
  const notes = get().notes;
  if (index?.notes === notes && index.rev === S.timesRev) return index;
  const all = notes.map((n): Placed => {
    const t = noteAt(n),
      marks = n.marks as Mark[] | undefined,
      num = noteNum(n.id),
      fixesText = n.fixes?.map((f) => f.what).join(" ") ?? "",
      asksText = n.asks?.map((a) => a.text).join(" ") ?? "";
    return {
      n,
      t,
      span: marks?.length ? inkSpan(marks) : null,
      words: `${num != null ? `#${num} ` : ""}${n.text} ${n.pin?.what ?? ""} shot ${n.shot} ${n.shotName ?? ""} ${stamp(t)} ${fixesText} ${asksText} ${n.learned?.what ?? ""}`,
    };
  });
  const open = all.filter((p) => noteState(p.n) === "open").sort((a, b) => a.t - b.t);
  const check = all.filter((p) => noteState(p.n) === "check").sort((a, b) => a.t - b.t);
  const done = all
    .filter((p) => noteState(p.n) === "done")
    .sort((a, b) => (lastFixAt(a.n) < lastFixAt(b.n) ? 1 : -1));
  const marks = all
    .toSorted((a, b) => a.t - b.t)
    .map(({ n, t, span }) => {
      const s = noteState(n);
      return {
        t,
        to: span && span[1] - span[0] > 1 / FPS ? t + span[1] - span[0] : undefined,
        done: s === "done",
        check: s === "check",
        asking: s === "check" && Boolean(n.fixes?.at(-1)?.ask),
      };
    });
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

// What the list shows (search, scope, shot, facets, sort): open notes to fix, check notes awaiting decision, and fixed notes folded under them.
// byTime stays in film order for the list to follow the playhead through.
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
    { noteSearch: q, noteScope: scope, noteShot: shot, noteFacets: facets, noteSort: sort } = get(),
    here = scope === "shot" ? shotIndex(S.t) : -1;
  const key = `${q}\n${scope}\n${shot ?? ""}\n${facets.join(",")}\n${sort}\n${here}`;
  if (shown?.ix === ix && shown.key === key) return shown;
  const idMatch = /^#(\d+)$/.exec(q.trim()),
    targetNum = idMatch ? Number(idMatch[1]) : null,
    hit = targetNum !== null ? null : matcher(q),
    filterOpts = {
      scope,
      currentShot: here,
      shot,
      facets,
      shotOf: (p: Placed) => shotIndex(p.t),
    },
    keep = (state: "open" | "check" | "done") => (p: Placed) =>
      matchesNoteFilters({ ...p, state }, filterOpts) &&
      (targetNum !== null ? noteNum(p.n.id) === targetNum : hit!(p.words));
  const byTime = ix.open.filter(keep("open"));
  const checkFiltered = ix.check.filter(keep("check"));
  const doneFiltered = ix.done.filter(keep("done"));
  const open = sortPlacedNotes(byTime, sort);
  const check = sort === "film" ? checkFiltered : sortPlacedNotes(checkFiltered, sort);
  const done = sort === "film" ? doneFiltered : sortPlacedNotes(doneFiltered, sort);
  return (shown = {
    ix,
    key,
    open,
    byTime,
    check,
    done,
  });
};

export const clearNoteFilters = () =>
  set({ noteSearch: "", noteStatus: "all", noteScope: "all", noteShot: null, noteFacets: [] });

// ---------- Pictures that go with a note: the frame with the pin, the area under it unmarked, and the seconds around it
// (a press during playback lands after what was being reacted to, and a note about a cut is about those seconds)
const shownAt = (x: number) => {
  engine.render(x);
  return S.el.canvas;
};
const snapshotSource = (at: number): HTMLCanvasElement | null => {
  const finalEl = engine.finalCanvas();
  const source = pickSnapshotSource({
    at,
    playhead: S.t,
    finalAt: S.finalAt,
    hasFinal: !!finalEl,
    hasRender: !!S.render,
  });
  if (!source) return null;
  return source === "final" ? finalEl! : shownAt(at);
};
const snapshot = (pin: Pin | null | undefined, at: number, marks: Mark[] = []) => {
  const from = snapshotSource(at);
  if (!from) return null;
  const c = document.createElement("canvas"),
    [w, h] = frameSize(960);
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(from, 0, 0, w, h);
  for (const m of marks) drawMark(g, m, at, w, h, tone("ink"));
  if (pin) {
    g.strokeStyle = tone("primary");
    g.lineWidth = 3;
    g.beginPath();
    g.arc(pin.x * w, pin.y * h, 14, 0, 7);
    g.stroke();
    g.strokeStyle = tone("stage");
    g.lineWidth = 1;
    g.beginPath();
    g.arc(pin.x * w, pin.y * h, 16, 0, 7);
    g.stroke();
  }
  return c.toDataURL("image/jpeg", 0.85);
};
const pinCrop = (pin: Pin, at: number) => {
  const from = snapshotSource(at) ?? S.el.canvas,
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
    g.fillStyle = tone("scrim-strong");
    g.fillRect(i * w + 4, 4, 128, 28);
    g.fillStyle = d === 0 ? tone("primary") : tone("picture");
    g.fillText(stamp(x), i * w + 8, 25);
    g.fillStyle = tone("stage");
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
  const close = wordNear(c.t),
    word = close.gap <= WORD_NEAR ? close.word : null,
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
  refs?: string[];
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
  // Storage full: the words matter more than the pictures, the creator's own pictures more than the film's, the main picture
  // more than the extras. No storage at all: they wait in this page
  for (const slim of [
    (x: Outgoing) => x,
    (x: Outgoing) => ({ note: x.note, refs: x.refs, img: x.img, frames: x.frames }),
    (x: Outgoing) => ({ note: x.note, refs: x.refs, img: x.img }),
    (x: Outgoing) => ({ note: x.note, refs: x.refs }),
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
        if (item.img || item.crop || item.refs?.length) {
          set({
            notes: get().notes.map((x) =>
              x.id === item.note.id
                ? {
                    ...x,
                    ...(item.img ? { img: `notes/img/${x.id}.jpg` } : {}),
                    ...(item.crop ? { crop: `notes/img/${x.id}_crop.jpg` } : {}),
                    ...(item.refs?.length
                      ? { refs: item.refs.map((_, i) => `notes/img/${x.id}_r${i}.jpg`) }
                      : {}),
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
let noteNumById: Record<string, number> = {};
export const noteNum = (id: string): number | null => noteNumById[id] ?? null;

export const loadNotes = async () => {
  const res = await getFile("/api/notes");
  const numHeader = res.headers.get("x-note-numbers");
  const have: Note[] = await res.json();
  noteNumById = noteNumberMap(have, numHeader);
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

// ---------- Writing a note
// What's being typed is on the device from the first letter: a reload or a killed tab brings it back
export const setDraft = (words: string) => {
  set({ draft: words });
  drawPins(); // the words show on the picture as they are typed
  drawInk(drawnNotes);
  const { compose } = get();
  if (isComposeDirty(compose, words, more()))
    stored.set("noteDraft", JSON.stringify({ compose, words }));
  else stored.remove("noteDraft");
};
// What a note holds besides its words: strokes on the film, pictures pasted in
const more = () => inkMarks.length > 0 || get().refs.length > 0;
export {
  type ComposeOrigin,
  composeExitReason,
  composeExitSnapshot,
  composeOrigin,
  originOf,
  pointOrigin,
};

let composeReturnEl: HTMLElement | null = null;
let composeReturnNoteId: string | null = null;

const restoreComposeFocus = () => {
  const el = composeReturnEl;
  const noteId = composeReturnNoteId;
  composeReturnEl = null;
  composeReturnNoteId = null;
  if (!el && !noteId) return;
  const run = () => {
    if (get().compose || get().review || typeof document === "undefined") return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    if (el?.isConnected && !el.closest("[hidden],[inert]")) {
      el.focus({ preventScroll: true });
      return;
    }
    const notesPanel = document.querySelector<HTMLElement>("[aria-label='Notes']");
    if (!notesPanel) return;
    const byId = noteId
      ? notesPanel.querySelector<HTMLElement>(
          `[data-note="${CSS.escape(noteId)}"] button[aria-label^="Edit note"], [data-note="${CSS.escape(noteId)}"] button:not([disabled])`,
        )
      : null;
    (byId ?? notesPanel.querySelector<HTMLElement>("button[aria-label='New note']"))?.focus({
      preventScroll: true,
    });
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else run();
};

// focus false: opened by a stroke, so a phone's keyboard stays down until the creator taps the box to say something
const openBox = (compose: Compose, words = "", focus = true, origin?: ComposeOrigin) => {
  if (origin) setComposeOrigin(compose, origin);
  if (!get().compose && typeof document !== "undefined") {
    const active = document.activeElement;
    const inNotes =
      active instanceof HTMLElement && !!active.closest("[aria-label='Notes'], [data-review-row]");
    composeReturnEl = inNotes ? active : null;
    composeReturnNoteId =
      compose.kind === "edit"
        ? compose.id
        : inNotes
          ? (active.closest<HTMLElement>("[data-note]")?.dataset.note ?? null)
          : null;
  }
  set({ compose, settingsOpen: false, side: "notes", lib: "notes" });
  setDraft(words);
  drawPins();
  if (focus) ui.focusNote();
  else ui.cancelNoteFocus();
};
export const openNote = (pin: Pin | null, focus = true, origin?: ComposeOrigin) => {
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
  engine.render(S.t);
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
    origin,
  );
};
export const mergeVoiceNoteDraft = (draft: string, voiceName: string, voiceId: string): string => {
  const line = `Use voice: ${voiceName} (${voiceId})`;
  const cur = draft.trim();
  if (!cur) return line;
  return cur.split(/[\s()]+/).includes(voiceId) ? draft : `${cur}\n${line}`;
};
export const openVoiceNote = (voiceName: string, voiceId: string, origin?: ComposeOrigin) => {
  if (get().compose?.kind === "edit") {
    set({ settingsOpen: false, side: "notes", lib: "notes" });
    ui.focusNote();
    say("Save or cancel the note edit before adding a voice to a new note");
    return;
  }
  openNote(null, true, origin);
  const next = mergeVoiceNoteDraft(get().draft, voiceName, voiceId);
  if (next !== get().draft) setDraft(next);
};
// A drawing tool's first stroke opens the note it belongs to; later strokes, at any second, join it
export const ensureNote = (origin?: ComposeOrigin) => {
  if (!get().compose) openNote(null, false, origin);
};
inkHooks.changed = () => setDraft(get().draft);
refHooks.changed = () => setDraft(get().draft);
export const restoreDraft = () => {
  restoreInk();
  restoreRefs();
  let raw: { compose?: unknown; words?: string } | null = null;
  try {
    raw = JSON.parse(stored.get("noteDraft") ?? "null");
  } catch {}
  const compose = normalizeStoredCompose(raw?.compose),
    words = typeof raw?.words === "string" ? raw.words : "";
  if (!compose || !isComposeDirty(compose, words, more())) {
    clearInk();
    setRefs([]);
    return;
  }
  seek(compose.t);
  openBox(compose, words);
};
// An old note opens in the same box, with its words. Nothing is overwritten until Xong
export const editOldNote = (n: Note, origin?: ComposeOrigin) => {
  const { compose, draft } = get();
  if (compose?.kind === "edit" && compose.id === n.id) {
    ui.focusNote();
    return;
  }
  const wasPlaying = compose ? compose.resume : S.playing;
  const at = noteAt(n);
  if (compose && isComposeDirty(compose, draft, more())) {
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
    true,
    origin,
  );
};
export const closeNote = (reason: "save" | "cancel" = "cancel") => {
  const current = get().compose;
  if (current) {
    recordComposeExit(current, reason, {
      draft: get().draft,
      drawn: get().inkSaid,
      refs: get().refs,
    });
  }
  const resume = current?.resume;
  set({ compose: null });
  clearInk();
  setRefs([]);
  setDraft("");
  ui.blurNote();
  drawPins();
  restoreComposeFocus();
  if (resume) setPlaying(true);
};
// Cancel asks nothing: the words stay one press away in case it was a slip
export const cancelNote = () => {
  const { compose: was, draft: words } = get();
  if (!was) return;
  const strokes = inkMarks.slice(),
    refs = get().refs;
  const lost = isComposeDirty(was, words, strokes.length > 0 || refs.length > 0);
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
      setRefs(refs);
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
    closeNote("save");
    showUndo(`Note at ${at} updated`, () => editNote(id, before));
    return;
  }
  const strokes = inkMarks.slice(),
    refs = get().refs.map((r) => r.url);
  if (!body && !strokes.length && !refs.length) {
    closeNote("cancel");
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
      frames = spread(inkTimes(strokes), 8).flatMap((t) => {
        const frameImg = snapshot(null, t, strokes);
        return frameImg ? [{ t: +t.toFixed(3), img: frameImg }] : [];
      });
    } catch {}
  try {
    engine.render(compose.t);
    img = snapshot(n.pin, compose.t, strokes);
    if (n.pin) crop = pinCrop(n.pin, compose.t);
  } catch {}
  engine.render(S.t);
  S.dirty = true;
  changed([...notes, n]);
  keepUnsent([
    ...unsent(),
    { note: n, img, crop, strip, frames, ...(refs.length ? { refs } : {}) },
  ]);
  flushNotes();
  closeNote("save");
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
// against that picture. Cleared on doc edits, undo/redo, and entering Review mode; never caches before S.render is ready.
let nowPicturesRev = -1;
const nowPictures = new Map<string, { key: string; url: string }>();
onDocMutated(invalidatePictures);
export const nowPicture = (n: Note) => {
  if (!S.render) return null;
  const rev = get().pictureRev;
  if (nowPicturesRev !== rev) {
    nowPictures.clear();
    nowPicturesRev = rev;
  }
  const at = noteAt(n),
    marks = (n.marks as Mark[] | undefined) ?? [];
  const key = JSON.stringify([at, n.pin ?? null, marks]);
  const cached = nowPictures.get(n.id);
  if (!cached || cached.key !== key) {
    let url: string | null = null;
    try {
      url = snapshot(n.pin, at, marks);
      engine.render(S.t);
      S.dirty = true;
    } catch {}
    if (url !== null) nowPictures.set(n.id, { key, url });
  }
  return nowPictures.get(n.id)?.url ?? null;
};

// ---------- The Review room (ReviewRoom.tsx): the notes alone beside the picture
export const focusReviewRow = (id: string | null) => {
  if (!id || typeof document === "undefined") return;
  const tryFocus = (retries: number) => {
    const el = document.querySelector<HTMLElement>(`[data-review-row="${CSS.escape(id)}"]`);
    if (el) el.focus({ preventScroll: true });
    else if (retries > 0) requestAnimationFrame(() => tryFocus(retries - 1));
  };
  requestAnimationFrame(() => tryFocus(2));
};

export const reviewList = (tab: "open" | "check" | "asking" | "done") => {
  const groups = shownNotes();
  if (tab === "check") return groups.check.filter((x) => !x.n.fixes?.at(-1)?.ask);
  if (tab === "asking") return groups.check.filter((x) => Boolean(x.n.fixes?.at(-1)?.ask));
  return groups[tab];
};

export const stepReview = (delta: -1 | 1) => {
  const { review, reviewTab, reviewPick } = get();
  if (!review) return false;
  const list = reviewList(reviewTab);
  const nextId = stepReviewPickId(
    list.map((x) => x.n.id),
    reviewPick,
    delta,
  );
  const to = nextId ? list.find((x) => x.n.id === nextId) : undefined;
  if (!to) return false;
  set({ reviewPick: to.n.id });
  goToNote(to.n);
  focusReviewRow(to.n.id);
  return true;
};

export const approveReviewCurrent = () => {
  const { review, reviewTab, reviewPick } = get();
  if (!review) return false;
  const list = reviewList(reviewTab);
  if (!list.length) return false;
  const idx = reviewPick ? list.findIndex((x) => x.n.id === reviewPick) : 0;
  const current = list[Math.max(0, idx)];
  if (!current || noteState(current.n) !== "check" || current.n.fixes?.at(-1)?.ask) return false;
  const nextId = nextReviewNeighborId(
    list.map((x) => x.n.id),
    current.n.id,
  );
  if (!approveNote(current.n)) return false;
  const to = nextId ? list.find((x) => x.n.id === nextId) : undefined;
  set({ reviewPick: to?.n.id ?? null });
  if (to) {
    goToNote(to.n);
    focusReviewRow(to.n.id);
  }
  return true;
};

let reviewReturnEl: HTMLElement | null = null;
let reviewReturnNoteId: string | null = null;

const restoreReviewFocus = () => {
  const el = reviewReturnEl;
  const noteId = reviewReturnNoteId;
  reviewReturnEl = null;
  reviewReturnNoteId = null;
  const run = () => {
    if (get().review || typeof document === "undefined") return;
    if (el?.isConnected && !el.closest("[hidden],[inert]")) {
      el.focus({ preventScroll: true });
      return;
    }
    const notesPanel = document.querySelector<HTMLElement>("[aria-label='Notes']");
    if (!notesPanel) return;
    const byId = noteId
      ? notesPanel.querySelector<HTMLElement>(
          `[data-note="${CSS.escape(noteId)}"] button[aria-label^="Review note"], [data-note="${CSS.escape(noteId)}"] button:not([disabled])`,
        )
      : null;
    const fallback = notesPanel.querySelector<HTMLElement>("button[aria-label^='Review room']");
    (byId ?? fallback)?.focus({ preventScroll: true });
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else run();
};

export const setReview = (on: boolean, opener?: Element | null, noteId?: string) => {
  if (!on) {
    if (get().review) {
      set({ review: false });
      restoreReviewFocus();
    }
    return;
  }
  if (!get().review) {
    const active = opener ?? (typeof document !== "undefined" ? document.activeElement : null);
    reviewReturnEl =
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement
        ? active
        : null;
    reviewReturnNoteId =
      noteId ??
      (active instanceof HTMLElement
        ? (active.closest<HTMLElement>("[data-note]")?.dataset.note ?? null)
        : null);
  }
  invalidatePictures();
  if (get().compose) cancelNote(); // its words stay one press away, as any cancel
  const { reviewPick, reviewTab } = get();
  const readyCheck = reviewList("check"),
    asking = reviewList("asking"),
    open = reviewList("open");
  const curList = reviewList(reviewTab);
  const keep = Boolean(reviewPick && curList.some((x) => x.n.id === reviewPick));
  const tab = keep
    ? reviewTab
    : readyCheck.length
      ? "check"
      : asking.length
        ? "asking"
        : open.length
          ? "open"
          : reviewTab;
  const targetList = reviewList(tab);
  const pickId = keep ? reviewPick : (targetList[0]?.n.id ?? null);
  set({ review: true, reviewTab: tab, reviewPick: pickId });
  const first = pickId ? get().notes.find((x) => x.id === pickId) : undefined;
  if (first) goToNote(first); // the picture opens on the note the room opens on
  if (pickId) focusReviewRow(pickId);
};
// The Review room opened on one note, in its own tab
export const reviewNote = (n: Note, opener?: Element | null) => {
  const st = noteState(n);
  set({
    reviewPick: n.id,
    reviewTab: st === "check" && n.fixes?.at(-1)?.ask ? "asking" : st,
  });
  setReview(true, opener, n.id);
};
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
// The pinned and whole-frame notes on the picture now: those from the last few seconds (pinfade.ts), fading
const EMPTY_STAGE_NOTES = {
  pins: [] as ActivePinNote[],
  frame: [] as { id: string; text: string; fade: number }[],
};
const stageNotesHere = () => {
  if (S.tools?.free.on) return EMPTY_STAGE_NOTES;
  const open = indexed().open;
  if (!open.length) return EMPTY_STAGE_NOTES;
  return activeStageNotes(open, S.t, get().rate);
};

addEventListener("online", flushNotes);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) flushNotes();
});

// ---------- The pins on the picture: saved notes on their frame, fading as the film plays on, and the one being written. Each
// keeps its element from frame to frame, only its fade changing; the one being written stays on top
const pinEls = new Map<string, HTMLDivElement>();
const frameEls = new Map<string, HTMLDivElement>();
let frameStackEl: HTMLDivElement | null = null;
let lastPinLayoutSig = "";
export const pinWordsUp = (y: number) => y > 0.88; // PinTools keeps clear of them
export const drawPins = () => {
  const box = S.el?.pins;
  if (!box) return;
  const own = get().compose?.pin,
    { pins: here, frame: frameNotes } = stageNotesHere();
  if (!here.length && !frameNotes.length && !own) {
    lastPinLayoutSig = "";
    if (pinEls.size) {
      for (const d of pinEls.values()) d.remove();
      pinEls.clear();
    }
    if (frameEls.size) {
      for (const d of frameEls.values()) d.remove();
      frameEls.clear();
    }
    if (frameStackEl) {
      frameStackEl.remove();
      frameStackEl = null;
    }
    return;
  }

  // Whole-frame notes (no pin and no drawn ink) render in a vertical stack so simultaneous notes never occlude one another
  if (frameNotes.length) {
    if (!frameStackEl || frameStackEl.parentElement !== box) {
      frameStackEl = document.createElement("div");
      frameStackEl.className = "pin-stack";
      box.append(frameStackEl);
    }
    const nowFrame = new Set<string>();
    for (const f of frameNotes) {
      const key = `${f.id}|${f.text}`;
      nowFrame.add(key);
      let el = frameEls.get(key);
      if (!el) {
        el = document.createElement("div");
        el.className = "pin-frame";
        const dot = document.createElement("span");
        dot.className = "pin-frame-dot";
        const span = document.createElement("span");
        span.textContent = f.text;
        el.append(dot, span);
        frameEls.set(key, el);
        frameStackEl.append(el);
      }
      const fade = f.fade < 1 ? String(f.fade) : "";
      if (el.style.opacity !== fade) el.style.opacity = fade;
    }
    for (const [key, el] of frameEls)
      if (!nowFrame.has(key)) {
        el.remove();
        frameEls.delete(key);
      }
  } else if (frameEls.size || frameStackEl) {
    for (const d of frameEls.values()) d.remove();
    frameEls.clear();
    frameStackEl?.remove();
    frameStackEl = null;
  }

  const want: (Omit<ActivePinNote, "pin"> & { pin: PinLike; saved: boolean })[] = here.map((p) => ({
    ...p,
    saved: true,
  }));
  if (own)
    want.push({ id: "", pin: own, text: get().draft.trim() || own.what, fade: 1, saved: false });

  const now = new Set<string>();
  const items: {
    key: string;
    d: HTMLDivElement;
    p: (typeof want)[number];
    px: number;
    py: number;
    words: HTMLElement | null;
  }[] = [];

  for (const p of want) {
    const px = Number.isFinite(p.pin.x) ? Math.max(0.02, Math.min(0.98, p.pin.x)) : 0.04;
    const py = Number.isFinite(p.pin.y) ? Math.max(0.03, Math.min(0.97, p.pin.y)) : 0.06;
    const key = `${p.id}|${px}|${py}|${p.text}`;
    now.add(key);
    let d = pinEls.get(key);
    // A note shows its words, the one being written what was tapped until words come; each stays inside the picture's edges
    if (!d) {
      d = document.createElement("div");
      d.className = p.saved ? "pin saved" : "pin";
      d.style.left = `${px * 100}%`;
      d.style.top = `${py * 100}%`;
      if (p.text) {
        const i = document.createElement("i");
        i.textContent = p.text;
        if (pinWordsUp(py)) i.className = "up";
        d.append(i);
      }
      pinEls.set(key, d);
      box.append(d);
    }
    const fade = p.fade < 1 ? String(p.fade) : "";
    if (d.style.opacity !== fade) d.style.opacity = fade;
    if (!p.saved && d !== box.lastChild) box.append(d);
    items.push({ key, d, p, px, py, words: d.firstElementChild as HTMLElement | null });
  }
  for (const [key, d] of pinEls)
    if (!now.has(key)) {
      d.remove();
      pinEls.delete(key);
    }

  if (!items.length) {
    lastPinLayoutSig = "";
    return;
  }
  const bw = box.clientWidth;
  const bh = box.clientHeight;
  const sig = `${bw}x${bh}|${items.map((it) => it.key).join("\n")}`;
  if (bw > 0 && bh > 0 && sig !== lastPinLayoutSig) {
    lastPinLayoutSig = sig;
    const layout = resolvePinLayout(
      items.map(({ p, px, py, words }) => ({
        x: px,
        y: py,
        labelWidth: words?.offsetWidth ?? 0,
        labelHeight: words?.offsetHeight ?? 0,
        dotRadius: p.saved ? 8 : 11,
      })),
      bw,
      bh,
    );
    items.forEach(({ d, words }, idx) => {
      const l = layout[idx];
      const dotT = l.dotDx || l.dotDy ? `${l.dotDx}px ${l.dotDy}px` : "";
      if (d.style.translate !== dotT) d.style.translate = dotT;
      if (words) {
        words.classList.remove("up");
        words.style.top = "50%";
        words.style.bottom = "auto";
        const wordT = `${l.labelX}px ${l.labelY}px`;
        if (words.style.translate !== wordT) words.style.translate = wordT;
      }
    });
  }
};
