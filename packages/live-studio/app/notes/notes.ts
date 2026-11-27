import { EDIT, fromSource, toSource } from "film/edit";

import { showUndo, toast } from "@/components/ui/toast";

import { remapOutputTime } from "../../src/layer-timing.mjs";
import { applyChange, type NoteChange, noteState, WORD_NEAR } from "../../src/note-state.mjs";
import { timingClock } from "../../src/timing-state.mjs";
import { frameAt, visibleOutputAt } from "../../src/timing.mjs";
import { activityNotice, lightNotes } from "../activity/activity";
import { playActivityChime } from "../activity/chime";
import { camLine } from "../camera/camline";
import { PHONE } from "../core/device";
import { onDocMutated } from "../core/doc";
import { engine, type FreeView } from "../core/engine";
import { shotEnd, shotIndex } from "../core/film";
import { DURATION, SHOTS_OUT as SHOTS } from "../core/filmMeta";
import { getFile, postJson } from "../core/net";
import { matcher } from "../core/search";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { get, invalidatePictures, say, set, ui } from "../core/store";
import { FPS, stamp } from "../core/time";
import { captionAt } from "../picture/captions";
import {
  activeCompareNoteSource,
  activeCompareVideo,
  checkCompareFeedbackRange,
  compareLayoutForSize,
  compareVideoDimensions,
  seekRecordedCompareTime,
  setCompareVideoMode,
  withCompareVideoSession,
} from "../picture/compare-video";
import {
  compareHitForPoint,
  composeMatchesStageSpace,
  noteMatchesStageSpace,
} from "../picture/compare-video-model";
import { readLiveFreeView } from "../picture/freecam";
import { seek, setPlaying } from "../playback/transport";
import { inOutAt } from "../timeline/inout";
import { wordNear } from "../timeline/timeline";
import {
  composeExitReason,
  composeExitSnapshot,
  type ComposeOrigin,
  composeOrigin,
  isStageAnchoredCompose,
  originOf,
  pointOrigin,
  recordComposeExit,
  setComposeOrigin,
} from "./compose-motion";
import {
  clearInk,
  drawInk,
  inkHooks,
  inkMarks,
  inkSpan,
  inkTimes,
  inkWords,
  markHits,
  restoreInk,
  setInk,
} from "./ink";
import { signalNoteAction } from "./note-action-motion";
import { noteFreeView, noteNumberMap, noteSecond, resolveNoteMedia } from "./note-card-meta";
import { matchesNoteFilters, sortPlacedNotes } from "./note-views-model";
import { momentStrip, pinCrop, snapshot } from "./pictures";
import { type ActivePinNote, activeStageNotes, type PinLike, resolvePinLayout } from "./pinfade";
import { refHooks, restoreRefs, setRefs } from "./refs";
import { nextReviewNeighborId, stepReviewPickId } from "./review-nav";
import {
  type Compose,
  type ComposeCreate,
  isComposeDirty,
  type Mark,
  normalizeStoredCompose,
  type Note,
  type Pin,
  type StageAnchor,
} from "./slice";

export const noteAt = (n: Note) =>
  noteSecond(
    n,
    fromSource,
    timingClock,
    SHOTS.map((s, i) => ({ t: frameAt(timingClock, s.t), name: S.comments[i] })),
  );
const whereText = (n: Note) => {
  const videoTag = n.compareVideo?.path ? ` | ${n.compareVideo.path.split("/").pop()}` : "";
  return `${stamp(n.t)} | shot ${n.shot} (${n.shotName ?? ""})${videoTag}${n.pin ? ` | ${n.pin.what}` : ""}${(n.marks as Mark[] | undefined)?.length ? ` | drawn: ${inkWords(n.marks as Mark[])}` : ""}`;
};
const lastFixAt = (n: Note) => n.fixes?.at(-1)?.at ?? n.at;

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
  check: Placed[];
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
      words: `${num != null ? `#${num} ` : ""}${n.text} ${n.pin?.what ?? ""} ${n.compareVideo?.path ?? ""} shot ${n.shot} ${n.shotName ?? ""} ${stamp(t)} ${fixesText} ${asksText} ${n.learned?.what ?? ""}`,
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
export const nextNoteTime = (t: number, d: -1 | 1) => {
  const ts = indexed().open.map((p) => p.t);
  return d > 0 ? ts.find((x) => x > t + 0.02) : ts.findLast((x) => x < t - 0.02);
};

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

const spread = <T>(xs: T[], n: number) =>
  xs.length <= n
    ? xs
    : Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]);
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
    playing: !!c.wasPlaying,
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
      ...(c.compareVideo
        ? (() => {
            const dims = compareVideoDimensions(c.compareVideo.path);
            return dims ? { canvas: dims } : {};
          })()
        : { canvas: [S.el.canvas.width, S.el.canvas.height] as [number, number] }),
      screen: [innerWidth, innerHeight],
    },
  };
};

interface Outgoing {
  note: Note;
  img?: string | null;
  crop?: string | null;
  strip?: string | null;
  frames?: { t: number; img: string }[];
  refs?: string[];
}
type Op = NoteChange | { remove: true } | { restore: true; text?: string };
let heldNotes: Outgoing[] | null = null,
  heldOps: Record<string, Op[]> | null = null;
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

type NotesFlushState =
  | { status: "idle" }
  | { status: "debouncing"; timer: ReturnType<typeof setTimeout> }
  | { status: "flushing" }
  | { status: "backoff"; timer: ReturnType<typeof setTimeout>; wake: () => void };

let flushState: NotesFlushState = { status: "idle" };
const savedForFlush = (state: NotesFlushState): "busy" | "fail" | null =>
  state.status === "idle" ? null : state.status === "backoff" ? "fail" : "busy";
const setFlushState = (next: NotesFlushState) => {
  flushState = next;
  set({ saved: savedForFlush(next) });
};
const waitBackoff = (ms: number) =>
  new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, ms);
    setFlushState({
      status: "backoff",
      timer,
      wake: () => {
        clearTimeout(timer);
        finish();
      },
    });
  });

export const flushNotes = async () => {
  if (flushState.status === "flushing") return;
  if (flushState.status === "backoff") {
    flushState.wake();
    return;
  }
  if (flushState.status === "debouncing") {
    clearTimeout(flushState.timer);
  }
  if (!unsent().length && !Object.keys(unsentOps()).length) {
    setFlushState({ status: "idle" });
    return;
  }
  setFlushState({ status: "flushing" });
  for (
    let list = unsent(), ops = Object.entries(unsentOps());
    list.length || ops.length;
    list = unsent(), ops = Object.entries(unsentOps())
  ) {
    setFlushState({ status: "flushing" });
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
        if (r.status === 409) {
          dropOp(id, op);
          const words = "again" in op ? op.again : "text" in op ? op.text : undefined;
          if (words) {
            toast.add({
              title: "Note update wasn’t sent. Copy your text before closing.",
              description: words,
              type: "error",
              timeout: 0,
            });
          } else {
            say(
              "The note changed before this update was sent. Check the latest version and try again.",
              6000,
            );
          }
          await loadNotes();
          continue;
        }
        if (!r.ok) throw new Error(String(r.status));
        dropOp(id, op);
      }
    } catch {
      await waitBackoff(3000);
    }
  }
  setFlushState({ status: "idle" });
};

const changed = (notes: Note[]) => {
  set({ notes });
  S.dirty = true;
};
const applied = (n: Note, op: NoteChange) => {
  const x = structuredClone(n),
    r = applyChange(x, op);
  return r.ok ? x : r.why;
};
let noteNumById: Record<string, number> = {};
export const noteNum = (id: string): number | null => noteNumById[id] ?? null;

const announceNoteChanges = (previous: Note[], notes: Note[]) => {
  const byId = new Map(previous.map((n) => [n.id, n]));
  const updates = notes.flatMap((note) => {
    const before = byId.get(note.id);
    if (!before) return [];
    const state = noteState(note),
      was = noteState(before);
    if (state === "done" && was !== "done")
      return [{ note, status: note.approved ? "approved" : "marked done" }];
    if (state !== "check") return [];
    const reply = note.fixes?.at(-1),
      prior = before.fixes?.at(-1);
    if (
      was === state &&
      note.fixes?.length === before.fixes?.length &&
      reply?.at === prior?.at &&
      reply?.what === prior?.what &&
      reply?.ask === prior?.ask
    )
      return [];
    return [{ note, status: reply?.ask ? "has a question" : "ready to check" }];
  });
  if (!updates.length) return;
  for (const { note } of updates) {
    signalNoteAction(note.id, noteState(note) === "done" ? "done" : "reply");
  }
  lightNotes(updates.map(({ note }) => note.id));
  if (!get().noteNotify) return;
  const notices = activityNotice();
  playActivityChime();
  if (updates.length > 1) {
    const id = notices.add({
      title: `${updates.length} notes updated`,
      type: "info",
      timeout: 8000,
      actionProps: {
        children: "Open Notes",
        onClick: () => {
          notices.close(id);
          setReview(false);
          set({ lib: "notes", side: "notes" });
        },
      },
    });
    return;
  }
  const [{ note, status }] = updates;
  const number = noteNum(note.id);
  const id = notices.add({
    title: `Note${number === null ? "" : ` #${number}`} ${status}`,
    description: note.text.trim().replace(/\s+/g, " ").slice(0, 120),
    type: noteState(note) === "done" ? "success" : "info",
    timeout: 8000,
    actionProps: {
      children: PHONE ? "View note" : "Jump to frame",
      onClick: () => {
        notices.close(id);
        const current = get().notes.find((n) => n.id === note.id);
        if (!current) return;
        const preview = S.el?.view;
        if (PHONE || get().review || (preview && !preview.getClientRects().length))
          reviewNote(current);
        else goToNote(current);
      },
    },
  });
};

let notesRequest = 0,
  appliedNotesRequest = 0;
export const loadNotes = async ({ notify = false } = {}) => {
  const request = ++notesRequest;
  const res = await getFile("/api/notes");
  if (!res.ok) throw new Error(`Couldn't load notes (HTTP ${res.status})`);
  const numHeader = res.headers.get("x-note-numbers");
  const have: Note[] = await res.json();
  if (request < appliedNotesRequest) return;
  appliedNotesRequest = request;
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
  if (notify) announceNoteChanges(mine, notes);
  if (flushState.status !== "idle") set({ saved: savedForFlush(flushState) });
};

export const changeNote = (id: string, op: NoteChange, said?: string) => {
  const was = get().notes.find((x) => x.id === id);
  if (!was) return false;
  const n = applied(was, op);
  if (typeof n === "string") {
    say(n);
    return false;
  }
  const motionKind =
    "approve" in op
      ? "approve"
      : "done" in op
        ? op.done
          ? "done"
          : "reopen"
        : "again" in op
          ? "reply"
          : null;
  if (motionKind) signalNoteAction(id, motionKind);
  changed(get().notes.map((x) => (x.id === id ? n : x)));
  queueOp(id, op);
  flushNotes();
  if (said) say(said);
  return true;
};

const editNote = (id: string, words: string) => {
  const was = get().notes.find((x) => x.id === id);
  if (!was || !words || words === was.text) return;
  const n = applied(was, { text: words });
  if (typeof n === "string") return;
  if (noteState(was) !== noteState(n) && noteState(n) === "open") signalNoteAction(id, "reopen");
  changed(get().notes.map((x) => (x.id === id ? n : x)));
  queueOp(id, { text: words });
  if (flushState.status === "flushing" || flushState.status === "backoff") return;
  if (flushState.status === "debouncing") clearTimeout(flushState.timer);
  const timer = setTimeout(() => {
    if (flushState.status === "debouncing" && flushState.timer === timer) {
      void flushNotes();
    }
  }, 400);
  setFlushState({ status: "debouncing", timer });
};

export const setDraft = (words: string) => {
  set({ draft: words });
  drawPins();
  drawInk(drawnNotes);
  const { compose } = get();
  if (isComposeDirty(compose, words, more()))
    stored.set("noteDraft", JSON.stringify({ compose, words }));
  else stored.remove("noteDraft");
};
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
  if (isStageAnchoredCompose(compose, PHONE)) {
    set({ compose, settingsOpen: false });
  } else {
    set({ compose, settingsOpen: false, side: "notes", lib: "notes" });
  }
  setDraft(words);
  drawPins();
  if (focus) ui.focusNote();
  else ui.cancelNoteFocus();
};
export const openNote = async (
  pin: Pin | null,
  focus = true,
  origin?: ComposeOrigin,
  anchor?: StageAnchor,
) => {
  if (noteSaveState.status === "saving") await noteSaveState.promise;
  const { compose, draft } = get();
  if (compose?.kind === "edit") {
    ui.focusNote();
    return;
  }
  if (get().compareVideoMode && (!activeCompareVideo() || get().compareVideo.status === "error")) {
    say("Load a compare video or switch to Live 3D (V) before adding a note", 3500);
    return;
  }
  if (!checkCompareFeedbackRange()) return;
  const wasPlaying = compose ? compose.wasPlaying : S.playing;
  const { compareVideoMode, compareVideo } = get();
  const compareVideoPath = compareVideo.status === "none" ? null : compareVideo.path;
  const spaceMismatch = Boolean(
    compose && !composeMatchesStageSpace(compose, compareVideoMode, compareVideoPath),
  );
  if (
    compose &&
    (spaceMismatch || (draft.trim() && Math.abs(S.t - compose.t) > 0.01 && !inkMarks.length))
  ) {
    if (isComposeDirty(compose, draft, more())) {
      set({ compose: { ...compose, resume: false } });
      await saveNote();
      if (get().compose) return;
    } else {
      set({ compose: { ...compose, resume: false } });
      closeNote("cancel", { keepInk: true });
    }
  }
  if (S.playing) setPlaying(false);
  const compareSource = get().compareVideoMode ? activeCompareNoteSource() : null;
  if (!get().compareVideoMode) void engine.render(S.t);
  const i = shotIndex(S.t);
  const resolvedAnchor = anchor ?? (pin ? { x: pin.x, y: pin.y } : undefined);
  openBox(
    {
      kind: "create",
      t: S.t,
      shot: i,
      shotName: S.comments[i] ?? "",
      pin,
      ...(resolvedAnchor ? { anchor: resolvedAnchor } : {}),
      ...(compareSource ? { compareVideo: compareSource } : {}),
      resume: !!wasPlaying,
      wasPlaying,
      spoken: captionAt(S.t) ?? undefined,
    },
    get().draft,
    focus,
    origin,
  );
};
export const setComposeAnchor = (anchor: StageAnchor) => {
  const { compose } = get();
  if (!compose || compose.kind !== "create") return;
  if (compose.anchor?.x === anchor.x && compose.anchor?.y === anchor.y) return;
  const next = { ...compose, anchor };
  const orig = composeOrigin(compose);
  if (orig) setComposeOrigin(next, orig);
  set({ compose: next });
};
export const mergeVoiceNoteDraft = (draft: string, voiceName: string, voiceId: string): string => {
  const line = `Use voice: ${voiceName} (${voiceId})`;
  const cur = draft.trim();
  if (!cur) return line;
  return cur.split(/[\s()]+/).includes(voiceId) ? draft : `${cur}\n${line}`;
};
export const openVoiceNote = async (voiceName: string, voiceId: string, origin?: ComposeOrigin) => {
  if (get().compose?.kind === "edit") {
    set({ settingsOpen: false, side: "notes", lib: "notes" });
    ui.focusNote();
    say("Save or cancel the note edit before adding a voice to a new note");
    return;
  }
  await openNote(null, true, origin);
  if (get().compose?.kind !== "create") return;
  const next = mergeVoiceNoteDraft(get().draft, voiceName, voiceId);
  if (next !== get().draft) setDraft(next);
};
export const ensureNote = (origin?: ComposeOrigin, anchor?: StageAnchor) => {
  const { compose, compareVideoMode, compareVideo, draft, refs } = get();
  const compareVideoPath = compareVideo.status === "none" ? null : compareVideo.path;
  if (!compose) {
    void openNote(null, false, origin, anchor);
    return;
  }
  if (
    compose.kind === "create" &&
    !compose.pin &&
    !inkMarks.length &&
    !draft.trim() &&
    !refs.length &&
    !composeMatchesStageSpace(compose, compareVideoMode, compareVideoPath)
  ) {
    const compareSource = compareVideoMode ? activeCompareNoteSource() : null;
    const i = shotIndex(S.t);
    const next: Compose = {
      ...compose,
      t: S.t,
      shot: i,
      shotName: S.comments[i] ?? "",
      spoken: captionAt(S.t) ?? undefined,
      ...(anchor ? { anchor } : {}),
      compareVideo: compareSource ?? undefined,
    };
    const orig = origin ?? composeOrigin(compose);
    if (orig) setComposeOrigin(next, orig);
    set({ compose: next });
  }
};
inkHooks.changed = () => setDraft(get().draft);
inkHooks.anchor = (anchor) => setComposeAnchor(anchor);
inkHooks.cancelEmpty = () => {
  const { compose, draft, refs } = get();
  if (
    compose?.kind === "create" &&
    !compose.pin &&
    !draft.trim() &&
    !refs.length &&
    !inkMarks.length
  )
    closeNote("cancel", { keepInk: true });
};
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
  if (compose.kind === "create" && compose.compareVideo?.path) {
    setCompareVideoMode(true, compose.compareVideo.path);
    seekRecordedCompareTime(compose.compareVideo.path, compose.t);
  } else {
    if (compose.kind === "create" && get().compareVideoMode) setCompareVideoMode(false);
    seek(compose.t);
  }
  openBox(compose, words);
};
export const editOldNote = async (n: Note, origin?: ComposeOrigin) => {
  if (noteSaveState.status === "saving") await noteSaveState.promise;
  const { compose, draft } = get();
  if (compose?.kind === "edit" && compose.id === n.id) {
    ui.focusNote();
    return;
  }
  const wasPlaying = compose ? compose.resume : S.playing;
  const at = noteAt(n);
  if (compose && isComposeDirty(compose, draft, more())) {
    set({ compose: { ...compose, resume: false } });
    await saveNote();
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
export const closeNote = (
  reason: "save" | "cancel" = "cancel",
  opts: { keepInk?: boolean } = {},
) => {
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
  if (!opts.keepInk && get().ink) setInk(null);
  setRefs([]);
  setDraft("");
  ui.blurNote();
  drawPins();
  restoreComposeFocus();
  if (resume) setPlaying(true);
};
export const cancelNote = () => {
  if (get().noteSaving) return;
  const { compose: was, draft: words } = get();
  if (!was) return;
  const strokes = inkMarks.slice(),
    refs = get().refs;
  const lost = isComposeDirty(was, words, strokes.length > 0 || refs.length > 0);
  closeNote();
  if (lost)
    showUndo(was.kind === "edit" ? `Edit at ${was.time} discarded` : "Note discarded", async () => {
      if (get().compose) {
        set({ compose: { ...get().compose!, resume: false } });
        await saveNote();
      }
      if (S.playing) setPlaying(false);
      if (was.kind === "create" && was.compareVideo?.path) {
        setCompareVideoMode(true, was.compareVideo.path);
      } else if (was.kind === "create" && get().compareVideoMode) {
        setCompareVideoMode(false);
      }
      if (was.kind === "create") {
        if (was.compareVideo?.path) seekRecordedCompareTime(was.compareVideo.path, was.t);
        else seek(was.t);
      }
      inkMarks.push(...strokes);
      setRefs(refs);
      openBox({ ...was, resume: false }, words);
    });
};
const saveNoteNow = async () => {
  const { compose, draft, notes } = get();
  const body = draft.trim();
  if (!compose) return;
  if (compose.kind === "edit") {
    const { id, original: before, time: at } = compose,
      was = notes.find((x) => x.id === id);
    if (!body || body === before.trim()) {
      closeNote();
      return;
    }
    if (was) editNote(id, body);
    else {
      queueOp(id, { restore: true, text: body });
      flushNotes();
    }
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
  const tools = S.tools;
  const rawCompareSource = compose.compareVideo ?? undefined;
  const compareDims = rawCompareSource ? compareVideoDimensions(rawCompareSource.path) : null;
  if (!tools && !rawCompareSource) {
    say("Your note draft is kept. Save once the preview loads.");
    return;
  }
  const sp = inkSpan(strokes);
  let noteMarks: Mark[] = strokes.map((m) => ({
    ...m,
    pts: m.pts.slice(),
    ...(m.ts ? { ts: m.ts.slice() } : {}),
    ...(m.hits ? { hits: m.hits.slice() } : {}),
  }));
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
    ...(rawCompareSource ? { compareVideo: rawCompareSource } : { cam: camLine() }),
    freeCam: rawCompareSource ? undefined : tools?.free.on || undefined,
    finalLook: rawCompareSource ? undefined : get().final || undefined,
    ...(get().newBuild ? { staleBuild: true } : {}),
    context: noteContext(compose),
    text: body,
    done: false,
    marks: noteMarks.length ? noteMarks : undefined,
    range: strokes.length ? (sp && sp[1] - sp[0] > 1 / FPS ? sp : undefined) : inOutAt(compose.t),
  };
  let appliedCompareLayout = rawCompareSource?.layout ?? null;
  const applyCompareLayout = (nextLayout: NonNullable<Note["compareVideo"]>["layout"]) => {
    if (!n.compareVideo || nextLayout === appliedCompareLayout) return;
    const category = n.compareVideo.category;
    n.compareVideo = { ...n.compareVideo, layout: nextLayout };
    if (n.pin) {
      n.pin = {
        ...n.pin,
        ...compareHitForPoint(n.pin.x, n.pin.y, category, nextLayout),
      };
    }
    if (noteMarks.length) {
      const look = (x: number, y: number) => compareHitForPoint(x, y, category, nextLayout);
      noteMarks = noteMarks.map((m) => {
        const copy: Mark = { ...m, pts: m.pts.slice(), ...(m.ts ? { ts: m.ts.slice() } : {}) };
        if (copy.kind === "path") copy.hits = copy.pts.map(([x, y]) => look(x, y));
        else markHits(copy, { look, plane: () => null });
        return copy;
      });
      n.marks = noteMarks;
    }
    appliedCompareLayout = nextLayout;
  };
  if (rawCompareSource && compareDims) {
    applyCompareLayout(compareLayoutForSize(rawCompareSource, compareDims[0], compareDims[1]));
  }
  const compareTarget = n.compareVideo ?? null;
  let img: string | null = null,
    crop: string | null = null,
    strip: string | null = null,
    frames: { t: number; img: string }[] = [];
  const captureAll = async (
    target: typeof compareTarget | Parameters<Parameters<typeof withCompareVideoSession>[1]>[0],
  ) => {
    try {
      strip = await momentStrip(compose.t, target);
    } catch {}
    if (noteMarks.length)
      try {
        for (const t of spread(inkTimes(noteMarks), 8)) {
          const frameImg = await snapshot(null, t, noteMarks, true, target);
          if (frameImg) frames.push({ t: +t.toFixed(3), img: frameImg });
        }
      } catch {}
    try {
      img = await snapshot(n.pin, compose.t, noteMarks, true, target);
      if (n.pin) crop = await pinCrop(n.pin, compose.t, target);
    } catch {}
  };
  if (compareTarget) {
    await withCompareVideoSession(compareTarget, async (session) => {
      if (session.dimensions && n.compareVideo) {
        applyCompareLayout(
          compareLayoutForSize(n.compareVideo, session.dimensions[0], session.dimensions[1]),
        );
        const ctx = n.context as { view?: { canvas?: [number, number] } } | undefined;
        if (ctx?.view) ctx.view.canvas = session.dimensions;
      }
      await captureAll(session);
    });
  } else {
    await captureAll(null);
  }
  if (!get().compareVideoMode && S.render) await engine.render(S.t);
  S.dirty = true;
  signalNoteAction(n.id, "save");
  changed([...get().notes, n]);
  keepUnsent([
    ...unsent(),
    { note: n, img, crop, strip, frames, ...(refs.length ? { refs } : {}) },
  ]);
  flushNotes();
  closeNote("save");
};

type NoteSaveState =
  | { status: "idle" }
  | { status: "saving"; promise: Promise<void> };

let noteSaveState: NoteSaveState = { status: "idle" };
export const saveNote = () => {
  if (noteSaveState.status === "saving") return noteSaveState.promise;
  if (!get().compose) return Promise.resolve();
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  noteSaveState = { status: "saving", promise };
  set({ noteSaving: true });
  void saveNoteNow()
    .catch(() => {
      toast.add({
        title: "Couldn’t save the note",
        description: "Try saving it again.",
        type: "error",
      });
    })
    .finally(() => {
      noteSaveState = { status: "idle" };
      set({ noteSaving: false });
      resolve();
    });
  return promise;
};

export const removeNote = (n: Note) => {
  const waiting = unsent().find((x) => x.note.id === n.id);
  if (waiting) keepUnsent(unsent().filter((x) => x.note.id !== n.id));
  signalNoteAction(n.id, "delete");
  changed(get().notes.filter((x) => x.id !== n.id));
  queueOp(n.id, { remove: true });
  flushNotes();
  const existing = get().compose;
  if (existing?.kind === "edit" && existing.id === n.id) closeNote();
  showUndo(`Note at ${n.time} deleted`, () => {
    signalNoteAction(n.id, "restore");
    changed([...get().notes, n]);
    queueOp(n.id, { restore: true, text: n.text });
    if (waiting) keepUnsent([...unsent(), waiting]);
    flushNotes();
  });
};
export const reopenNote = (n: Note) =>
  changeNote(n.id, { done: false }, `Note at ${stamp(noteAt(n))} moved back to To fix`);
export const approveNote = (n: Note) =>
  changeNote(n.id, { approve: true }, `Approved: note at ${stamp(noteAt(n))}`);
export const setReplyDraft = (id: string, words: string) => {
  const replyDrafts = new Map(get().replyDrafts);
  if (words) replyDrafts.set(id, words);
  else replyDrafts.delete(id);
  set({ replyDrafts });
};

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
const sameFreeView = (a: FreeView | undefined, b: FreeView | undefined) => {
  if (!a || !b) return false;
  const near = (x: number, y: number) => Math.abs(x - y) <= 1e-3;
  return (
    a.p.every((v, idx) => near(v, b.p[idx] ?? Number.NaN)) &&
    a.l.every((v, idx) => near(v, b.l[idx] ?? Number.NaN)) &&
    (b.fov === undefined || near(a.fov ?? b.fov, b.fov)) &&
    near(a.roll ?? 0, b.roll ?? 0) &&
    near(a.wave ?? 0, b.wave ?? 0) &&
    near(a.bob ?? 0, b.bob ?? 0) &&
    near(a.fstop ?? 0, b.fstop ?? 0) &&
    JSON.stringify(a.focus ?? null) === JSON.stringify(b.focus ?? null) &&
    JSON.stringify(a.handheld ?? false) === JSON.stringify(b.handheld ?? false)
  );
};

export type NoteJumpMode = "auto" | "before" | "after";

export const goToNote = (n: Note, newVisit = !get().review, mode: NoteJumpMode = "auto") => {
  const media = noteMedia(n);
  const hasAfterTarget = media.afterCam !== null || media.afterTime !== null;
  const useAfter =
    mode === "after" || (mode === "auto" && noteState(n) !== "open" && hasAfterTarget);
  const at = useAfter && media.afterTime !== null ? media.afterTime : noteAt(n);
  if (!Number.isFinite(at) || at < 0 || at > DURATION) {
    say("This note is outside the current preview");
    return;
  }
  const wasView = readLiveFreeView();
  const wasFree = wasView !== undefined;
  const curCompareVideo = get().compareVideo;
  const wasCompare = {
    on: get().compareVideoMode,
    path: curCompareVideo.status === "none" ? null : curCompareVideo.path,
  };
  const wantsFree = useAfter && media.afterCam !== null ? true : Boolean(n.freeCam);
  const targetView =
    useAfter && media.afterCam !== null ? media.afterCam : n.freeCam ? noteFreeView(n) : null;
  const willChangeTime = Math.abs(S.t - at) >= 0.5 / FPS;
  const willChangeCam = wantsFree
    ? !wasFree || (targetView !== null && !sameFreeView(wasView, targetView))
    : wasFree;
  const willChangeCompare = wantsFree && wasCompare.on;
  if (
    !PHONE &&
    (newVisit || !get().noteReturn) &&
    (willChangeTime || willChangeCam || willChangeCompare)
  ) {
    set({
      noteReturn: {
        at: S.t,
        clock: timingClock,
        ...(wasFree ? { free: true, view: wasView } : { free: false }),
        compareVideo: wasCompare,
      },
    });
  }
  if (S.playing) setPlaying(false);
  if (wantsFree) {
    if (targetView) engine.flyFree(targetView);
    else if (!wasFree) engine.setFree(true, true);
  } else if (wasFree) {
    engine.setFree(false);
  }
  seek(at);
};

const noteReturnTime = ({ clock, at }: NonNullable<ReturnType<typeof get>["noteReturn"]>) => {
  if (clock === timingClock) return at;
  const placement = clock.placements?.find((item) => item.from <= at && at < item.to);
  const moved = placement && timingClock.placements?.find((item) => item.id === placement.id);
  if (placement?.kind === "clip" && moved?.kind === "clip") {
    const segments = timingClock.segments.filter((s) => s.from >= moved.from && s.to <= moved.to);
    return visibleOutputAt({ ...timingClock, segments }, clock.sourceAt(at)) ?? moved.from;
  }
  if (placement?.kind === "gap" && moved?.kind === "gap")
    return (
      moved.from +
      ((at - placement.from) / (placement.to - placement.from)) * (moved.to - moved.from)
    );
  return remapOutputTime(clock, timingClock, at);
};

export const returnFromNote = () => {
  const position = get().noteReturn;
  if (!position) return;
  set({ noteReturn: null });
  if (S.playing) setPlaying(false);
  if (position.compareVideo) {
    setCompareVideoMode(position.compareVideo.on, position.compareVideo.path ?? undefined);
  } else if (get().compareVideoMode) {
    setCompareVideoMode(false);
  }
  if (position.free) {
    if (position.view) engine.flyFree(position.view);
    else if (!(S.tools?.free.on ?? get().free)) engine.setFree(true, true);
  } else if (position.free === false && (S.tools?.free.on ?? get().free)) {
    engine.setFree(false);
  }
  if (position.compareVideo?.on && position.compareVideo.path) {
    seekRecordedCompareTime(position.compareVideo.path, position.at);
  } else seek(noteReturnTime(position));
  setReview(false);
};
export const openNoteInCompareVideo = (n: Note) => {
  if (!n.compareVideo) return;
  const at = n.t;
  const inReview = get().review;
  const wasView = readLiveFreeView();
  const wasFree = Boolean(S.tools?.free.on ?? get().free);
  const curCompare = get().compareVideo;
  const wasCompare = {
    on: get().compareVideoMode,
    path: curCompare.status === "none" ? null : curCompare.path,
  };
  const willChange =
    !wasCompare.on ||
    wasCompare.path !== n.compareVideo.path ||
    (Number.isFinite(at) && Math.abs(S.t - at) > 0.01);
  if (!PHONE && (!inReview || !get().noteReturn) && willChange) {
    set({
      noteReturn: {
        at: S.t,
        clock: timingClock,
        ...(wasFree ? { free: true, view: wasView } : { free: false }),
        compareVideo: wasCompare,
      },
    });
  }
  if (inReview) setReview(false);
  if (S.playing) setPlaying(false);
  setCompareVideoMode(true, n.compareVideo.path);
  seekRecordedCompareTime(n.compareVideo.path, at);
};
export const playNote = (n: Note) => {
  seek(Math.max(0, noteAt(n) - 2));
  setPlaying(true);
};
let nowPicturesRev = -1;
const nowPictures = new Map<string, { key: string; url: string }>();
let nowPictureQueue: Promise<unknown> = Promise.resolve();
onDocMutated(invalidatePictures);
export const nowPicture = (n: Note): Promise<string | null> => {
  const run = nowPictureQueue.then(async () => {
    const rev = get().pictureRev;
    if (nowPicturesRev !== rev) {
      nowPictures.clear();
      nowPicturesRev = rev;
    }
    const marks = (n.marks as Mark[] | undefined) ?? [];
    if (n.compareVideo) {
      const s = get();
      const item = activeCompareVideo();
      const target = activeCompareNoteSource();
      if (
        !s.compareVideoMode ||
        s.compareVideo.status === "error" ||
        !item ||
        !target ||
        !noteMatchesStageSpace(n, s.compareVideoMode, target)
      )
        return null;
      const at = target.path === n.compareVideo.path ? n.t : noteAt(n);
      const key = JSON.stringify([
        at,
        n.pin ?? null,
        marks,
        "compare",
        item.path,
        item.size,
        item.mtimeMs,
      ]);
      const cached = nowPictures.get(n.id);
      if (!cached || cached.key !== key) {
        const url = await snapshot(n.pin, at, marks, false, target).catch(() => null);
        if (get().pictureRev !== rev) return null;
        if (url !== null) nowPictures.set(n.id, { key, url });
      }
      return nowPictures.get(n.id)?.url ?? null;
    }
    if (!S.render) return null;
    const at = noteAt(n);
    const wantFree = Boolean(n.freeCam);
    const wantView = wantFree ? noteFreeView(n) : null;
    const liveView = readLiveFreeView();
    const matchesLiveView = wantFree
      ? Boolean(liveView && (!wantView || sameFreeView(liveView, wantView)))
      : !S.tools?.free.on;
    const finalOn = Boolean(get().final);
    const key = JSON.stringify([at, n.pin ?? null, marks, wantFree, wantView, finalOn]);
    const cached = nowPictures.get(n.id);
    if (!cached || cached.key !== key) {
      const f = S.tools?.free;
      const saved =
        f && !matchesLiveView && (!wantFree || wantView !== null)
          ? {
              on: f.on,
              px: f.p.x,
              py: f.p.y,
              pz: f.p.z,
              lx: f.l.x,
              ly: f.l.y,
              lz: f.l.z,
              fov: f.fov,
              roll: f.roll ?? 0,
              wave: f.wave ?? 0,
              bob: f.bob ?? 0,
              fstop: f.fstop ?? 0,
              focus: f.focus !== undefined ? structuredClone(f.focus) : undefined,
              handheld: f.handheld !== undefined ? structuredClone(f.handheld) : undefined,
            }
          : null;
      let url: string | null = null;
      try {
        if (f && saved) {
          if (wantFree && wantView) {
            f.on = true;
            f.p.set(wantView.p[0], wantView.p[1], wantView.p[2]);
            f.l.set(wantView.l[0], wantView.l[1], wantView.l[2]);
            if (wantView.fov !== undefined) f.fov = wantView.fov;
            f.roll = wantView.roll ?? 0;
            f.wave = wantView.wave ?? 0;
            f.bob = wantView.bob ?? 0;
            f.fstop = wantView.fstop ?? 0;
            f.focus = wantView.focus !== undefined ? structuredClone(wantView.focus) : undefined;
            f.handheld =
              wantView.handheld !== undefined ? structuredClone(wantView.handheld) : false;
          } else {
            f.on = false;
          }
        }
        url = await snapshot(n.pin, at, marks, matchesLiveView);
      } catch {
      } finally {
        if (f && saved) {
          f.on = saved.on;
          f.p.set(saved.px, saved.py, saved.pz);
          f.l.set(saved.lx, saved.ly, saved.lz);
          f.fov = saved.fov;
          f.roll = saved.roll;
          f.wave = saved.wave;
          f.bob = saved.bob;
          f.fstop = saved.fstop;
          f.focus = saved.focus;
          f.handheld = saved.handheld;
        }
        try {
          await engine.render(S.t);
        } catch {}
        S.dirty = true;
      }
      if (get().pictureRev !== rev) return null;
      if (url !== null) nowPictures.set(n.id, { key, url });
    }
    return nowPictures.get(n.id)?.url ?? null;
  });
  nowPictureQueue = run.catch(() => {});
  return run;
};

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
  const state = tab === "asking" ? "check" : tab;
  const matchesTab = ({ n }: Placed) =>
    state !== "check" || Boolean(n.fixes?.at(-1)?.ask) === (tab === "asking");
  const group = shownNotes()[state];
  const visible = state === "check" ? group.filter(matchesTab) : group;
  const targetId = get().reviewTarget;
  if (!targetId || visible.some(({ n }) => n.id === targetId)) return visible;
  const target = indexed()[state].find((row) => row.n.id === targetId && matchesTab(row));
  return target ? [target, ...visible] : visible;
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
  const current = list[idx];
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
      set({ review: false, reviewTarget: null });
      restoreReviewFocus();
    }
    return;
  }
  const opening = !get().review;
  if (opening) {
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
  if (get().compose) cancelNote();
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
  if (first) goToNote(first, opening);
  if (pickId) focusReviewRow(pickId);
};
export const reviewNote = (n: Note, opener?: Element | null) => {
  const st = noteState(n);
  set({
    reviewTarget: n.id,
    reviewPick: n.id,
    reviewTab: st === "check" && n.fixes?.at(-1)?.ask ? "asking" : st,
  });
  setReview(true, opener, n.id);
};
export const copyNoteLink = async (note: Note) => {
  const url = new URL(location.pathname, location.origin);
  url.hash = new URLSearchParams({ note: note.id }).toString();
  try {
    await navigator.clipboard.writeText(url.href);
    say("Note link copied");
  } catch {
    say("Could not copy the note link");
  }
};

export const followNoteLinks = () => {
  const open = () => {
    const url = new URL(location.href);
    const params = new URLSearchParams(url.hash.slice(1));
    const id = params.get("note");
    if (id === null) return;
    params.delete("note");
    url.hash = params.toString();
    history.replaceState(history.state, "", url);
    const note = get().notes.find((n) => n.id === id);
    if (!note) {
      say("This note is no longer available in this film");
      return;
    }
    if (!get().compose && !S.playing) {
      reviewNote(note);
      return;
    }
    const notices = activityNotice();
    const toastId = notices.add({
      title: "Linked note ready to open",
      timeout: 8000,
      actionProps: {
        children: "Open Review",
        onClick: () => {
          notices.close(toastId);
          const current = get().notes.find((n) => n.id === id);
          if (current) reviewNote(current);
        },
      },
    });
  };
  addEventListener("hashchange", open);
  open();
};

export const copyAll = () => {
  navigator.clipboard?.writeText(
    openNotes()
      .map((n) => `${whereText(n)}: ${n.text}`)
      .join("\n"),
  );
  say("Copied");
};
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
export const followNotes = () => {
  const list = shownNotes().byTime,
    i = firstFrom(list, S.t),
    a = list[i - 1],
    b = list[i];
  const near = (!b || (a && S.t - a.t <= b.t - S.t) ? a : b)?.n.id ?? null;
  if (near !== get().nearNote) set({ nearNote: near });
};
const EMPTY_STAGE_NOTES = {
  pins: [] as ActivePinNote[],
  frame: [] as { id: string; text: string; fade: number }[],
};
let compareStageNotes: { open: Placed[]; path: string; placed: Placed[] } | null = null;
const notesAtCompareSourceTime = (open: Placed[], path: string): Placed[] => {
  if (compareStageNotes?.open === open && compareStageNotes.path === path) {
    return compareStageNotes.placed;
  }
  const placed = open
    .map((p) => (p.n.compareVideo?.path === path ? { ...p, t: p.n.t } : p))
    .sort((a, b) => a.t - b.t);
  compareStageNotes = { open, path, placed };
  return placed;
};
const stageNotesHere = () => {
  if (S.tools?.free.on) return EMPTY_STAGE_NOTES;
  const open = indexed().open;
  if (!open.length) return EMPTY_STAGE_NOTES;
  const { rate, compareVideoMode } = get();
  const source = activeCompareNoteSource();
  const placed = source ? notesAtCompareSourceTime(open, source.path) : open;
  return activeStageNotes(placed, S.t, rate, (note) =>
    noteMatchesStageSpace(note, compareVideoMode, source),
  );
};

addEventListener("online", flushNotes);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) flushNotes();
});

const pinEls = new Map<string, HTMLDivElement>();
const frameEls = new Map<string, HTMLDivElement>();
let frameStackEl: HTMLDivElement | null = null;
let lastPinLayoutSig = "";
export const pinWordsUp = (y: number) => y > 0.88;
export const drawPins = () => {
  const box = S.el?.pins;
  if (!box) return;
  const { compose, compareVideoMode, compareVideo } = get();
  const compareVideoPath = compareVideo.status === "none" ? null : compareVideo.path;
  const own =
    compose?.pin &&
    (compose.kind !== "create" ||
      composeMatchesStageSpace(compose, compareVideoMode, compareVideoPath))
      ? compose.pin
      : null;
  const { pins: here, frame: frameNotes } = stageNotesHere();
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
