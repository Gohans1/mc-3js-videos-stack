import { EDIT, fromSource } from "film/edit";

import { mapVoice } from "../../src/timing-data.mjs";
import { clockForTimeline } from "../../src/timing-state.mjs";
import { shotEnd, shotIndex } from "../core/film";
// The ruler and the stretch around the playhead under it, drawn on canvases: shot names (with no Camera row), each sentence's
// pace, the words, actions and sounds in lanes, option ranges and notes.
// Custom canvas on purpose: the waveform is drawn through the voice edit's time warp and the rows come from edit.json, which no
// waveform or timeline library models. The studio only reads this timeline; changes are made from notes, in edit.json. The sound
// lanes under it (sound/lanes.ts) are the one part the creator edits by hand, on the same seconds as the stretch drawn here.
// Voice samples and annotations use the audio file clock; voice.warp only places narrative anchors.
import { applyEdit, DURATION, SHOTS_OUT as SHOTS } from "../core/filmMeta";
import { getFile } from "../core/net";
import { type Line, S } from "../core/state";
import { stored } from "../core/storage";
import { get, invalidatePictures, say, set, setPref } from "../core/store";
import { pad, stamp } from "../core/time";
import { seek, setPlaying } from "../playback/transport";
import { skimSound } from "../sound/skim";
import { FAST_WPM, SLOW_WPM } from "../sound/voice-view";
import { drawPlayhead, sized, tone, UI_FONT } from "./canvas";
import { boxEnd, boxMove, boxPick, boxStart } from "./rowbox";
import { LANE_H, rows, SHOTS_STRIP, WORDS_H } from "./rows";
import { invalidateShown, isElementShown, onShownResize } from "./visible";

const STILL = 6; // how long with nothing moving reads as stuck
const HOLDS = new Set(["zz", "note1", "code", "typing"]); // these say when something is shown, not that it moves

type Box =
  | { type: "beat"; id: string; x0: number; x1: number; y0: number; y1: number }
  | { type: "line" | "gap"; i: number; x0: number; x1: number; y0: number; y1: number };
let boxes: Box[] = [];
let selected: { type: "beat"; id: string } | { type: "line"; i: number } | null = null;
let stuck: [number, number][] = [];
// The beats in film order, drawn every frame: edit.json changes only on refreshTimes, so the sort is kept between them
let beatRev = -1,
  beatOrder: [string, (typeof EDIT.beats)[string]][] = [];
const orderedBeats = () => {
  if (beatRev === S.timesRev) return beatOrder;
  beatRev = S.timesRev;
  return (beatOrder = Object.entries(EDIT.beats).sort((p, q) => p[1].at - q[1].at));
};
const wordWidths = new Map<string, number>();
export const shown = () => Math.min(get().span, DURATION); // seconds the detail timeline shows
let frozenCentre: number | null = null;
// Where Alt+wheel slid the stretch (c), and the playhead then (t): it stays while the playhead stays or moves inside it, and
// goes once playing or a jump takes the playhead out of it, so the stretch follows the playhead again
let slid: { c: number; t: number } | null = null;
// What else the timelines mark, set by the parts that own it
export const marks = {
  voice: (lines: Line[]) => mapVoice(lines, clockForTimeline("voice")),
  voiceLoaded: () => {},
  notes: () => [] as { t: number; to?: number; done: boolean; check: boolean; asking?: boolean }[],
  optionRanges: () => [] as [number, number][],
  ai: () => [] as { a: number; b: number; level?: "ok" | "warn" | "fail" }[], // the seconds the AI is at (activity/activity.ts)
  lanes: () => {}, // sound/lanes.ts draws its canvas whenever these do
  cam: () => {}, // and camera/camrow.ts its own
  keys: () => {}, // and keys/keyrows.ts the key rows
  layers: () => {},
  openfilm: () => {},
  text: () => {}, // and text/textrow.ts the text tracks
};

export const paceOf = (i: number) => {
  const l = S.voice.lines[i];
  if (!l || l.words.length < 4 || l.e <= l.s) return null;
  return (l.words.length / (l.e - l.s)) * 60 * (EDIT.voice.edits[i]?.speed ?? 1);
};
// Stretches where neither the camera nor anything in frame moves
const findStuck = () => {
  const out: [number, number][] = [];
  SHOTS.forEach((s, i) => {
    if (s.pull || s.walk || s.pan) return;
    const a = s.t,
      b = shotEnd(i);
    const moves = Object.entries(EDIT.beats)
      .filter(
        ([id, m]) => m.kind === "motion" && (!HOLDS.has(id) || (id === "typing" && !s.hideMan)),
      )
      .map(([, m]) => [fromSource(m.at), fromSource(m.at + m.dur)])
      .filter(([x, y]) => y > a && x < b)
      .sort((p, q) => p[0] - q[0]);
    let from = a;
    for (const [x, y] of moves) {
      if (x - from >= STILL) out.push([from, x]);
      from = Math.max(from, y);
    }
    if (b - from >= STILL) out.push([from, b]);
  });
  return out;
};
export const wordNear = (out: number) => {
  let best = null,
    d = 1e9;
  for (const l of S.voiceOut)
    for (const w of l.words) {
      const e = Math.abs(w.s - out);
      if (e < d) {
        d = e;
        best = w;
      }
    }
  return { word: best, gap: d };
};

const describeSelection = () => {
  if (selected?.type === "beat") {
    const b = EDIT.beats[selected.id],
      out = fromSource(b.at);
    set({ selection: [b.title, `${stamp(out)}, at the word "${wordNear(out).word?.w ?? ""}"`] });
  } else if (selected?.type === "line") {
    const i = selected.i,
      l = S.voice.lines[i],
      pace = paceOf(i),
      next = S.voice.lines[i + 1];
    set({
      selection: [
        l.text,
        `${pace ? `${Math.round(pace)} words/min · ` : ""}${(next ? next.s - l.e : 0).toFixed(2)} s pause after`,
      ],
    });
  } else {
    const off = S.voice.lines.filter((_, i) => {
      const p = paceOf(i);
      return p && (p > FAST_WPM || p < SLOW_WPM);
    }).length;
    set({
      selection: [
        `${off} sentences off pace (tinted) · ${stuck.length} stretches still for over ${STILL} s (red line)`,
        `Zoom ${((EDIT.zoomRate ?? 0) * 100).toFixed(1)}% per second`,
      ],
    });
  }
};

// Every time the edit or the voice map changes: the heard seconds of everything move
export const refreshVoiceTimes = () => {
  S.voiceBase = S.voice.lines.map((l) => ({
    ...l,
    words: l.words.map((w) => ({ ...w })),
  }));
  S.voiceOut = marks.voice(S.voiceBase);
  marks.voiceLoaded();
};
export const refreshTimes = () => {
  applyEdit();
  S.timesRev++;
  refreshVoiceTimes();
  S.dirty = true;
  stuck = findStuck();
  describeSelection();
  if (S.tools) drawTimelines();
};

let waveCanvas: HTMLCanvasElement | null = null;
let waveKey = "";

const drawWave = (
  g: CanvasRenderingContext2D,
  a: number,
  b: number,
  w: number,
  y: number,
  h: number,
) => {
  const { peaks, step } = S.voice;
  if (!peaks.length || w <= 0 || h <= 0) return;
  const fill = tone("muted-foreground"),
    d = devicePixelRatio || 1,
    key = `${a}|${b}|${w}|${h}|${S.timesRev}|${peaks.length}|${fill}|${d}`;
  if (!waveCanvas) waveCanvas = document.createElement("canvas");
  if (waveKey !== key) {
    waveKey = key;
    const pw = Math.round(w * d),
      ph = Math.round(h * d);
    if (waveCanvas.width !== pw || waveCanvas.height !== ph) {
      waveCanvas.width = pw;
      waveCanvas.height = ph;
    }
    const wg = waveCanvas.getContext("2d")!;
    wg.setTransform(d, 0, 0, d, 0, 0);
    wg.clearRect(0, 0, w, h);
    wg.fillStyle = fill;
    const vc = clockForTimeline("voice"),
      span = b - a,
      maxI = peaks.length;
    let i0 = Math.floor(vc.sourceAt(a) / step);
    for (let x = 0; x < w; x++) {
      const nextRaw = Math.floor(vc.sourceAt(a + ((x + 1) / w) * span) / step),
        i1 = Math.max(i0 + 1, nextRaw);
      let p = 0;
      const hi = i1 < maxI ? i1 : maxI;
      for (let i = i0 > 0 ? i0 : 0; i < hi; i++) if (peaks[i] > p) p = peaks[i];
      if (p > 0.012) {
        const bar = (p * h) / 2;
        wg.fillRect(x, h / 2 - bar, 1, Math.max(1, bar * 2));
      }
      i0 = nextRaw;
    }
  }
  g.drawImage(waveCanvas, 0, 0, waveCanvas.width, waveCanvas.height, 0, y, w, h);
};
export const viewCentre = () => {
  const v = shown();
  if (slid && S.t !== slid.t) {
    if (Math.abs(S.t - slid.c) > v / 2) slid = null;
    else slid.t = S.t;
  }
  const c = frozenCentre ?? slid?.c ?? S.t;
  return v >= DURATION ? DURATION / 2 : Math.max(v / 2, Math.min(DURATION - v / 2, c));
};
// The playhead line runs down every row, and as in CapCut a press on it anywhere drags the playhead. While a row scrubs, the
// stretch holds still: centred on a moving playhead, the time under the pointer would run away
export const onPlayhead = (x: number, w: number, touch: boolean) => {
  const { a, v } = view();
  return Math.abs(x - ((S.t - a) / v) * w) <= (touch ? 10 : 4);
};
// The stretch shown: its first second (a) and how many seconds (v); and the second at x on a row w wide
export const view = () => {
  const v = shown();
  return { a: viewCentre() - v / 2, v };
};
export const timeAt = (x: number, w: number) => {
  const { a, v } = view();
  if (v <= 0 || w <= 0) return 0;
  return a + (x / w) * v;
};
export const holdView = (on: boolean) => {
  frozenCentre = on ? viewCentre() : null;
  S.dirty = true;
};

const fitCanvasText = (g: CanvasRenderingContext2D, text: string, maxW: number): string => {
  if (maxW <= 4 || g.measureText(text).width <= maxW) return text;
  if (g.measureText("…").width > maxW) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : "";
};

const aiSpansKey = (spans: readonly { a: number; b: number; level?: string }[]) => {
  if (!spans.length) return "";
  let key = "";
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    key += `${s.a},${s.b},${s.level ?? ""};`;
  }
  return key;
};

const optionRangesKey = (ranges: readonly [number, number][]) => {
  if (!ranges.length) return "";
  let key = "";
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]!;
    key += `${r[0]},${r[1]};`;
  }
  return key;
};

const activeWordMark = (t: number, a: number, b: number) => {
  if (!rows.voice) return "";
  let mark = "";
  for (let li = 0; li < S.voiceOut.length; li++) {
    const l = S.voiceOut[li]!;
    if (l.e < a || l.s > b || l.e < t || l.s > t) continue;
    for (let wi = 0; wi < l.words.length; wi++) {
      const word = l.words[wi]!;
      if (t >= word.s && t <= word.e) mark += `${li}:${wi};`;
    }
  }
  return mark;
};

let detailBgCanvas: HTMLCanvasElement | null = null;
let dcPw = -1,
  dcPh = -1,
  dcA = Number.NaN,
  dcV = Number.NaN,
  dcShotsH = -1,
  dcVoiceH = -1,
  dcActionH = -1,
  dcCurShot = -2,
  dcTimesRev = -1,
  dcVoiceLen = -1,
  dcPeaksLen = -1,
  dcVoiceReady = false,
  dcShotsRev = -1,
  dcSoundRev = -1;
let dcTheme = "",
  dcWordMark = "",
  dcSelType = "",
  dcSelVal: string | number = "",
  dcOptGroup = "",
  dcOptKey = "",
  dcAiKey = "";
let dcVoiceOut: unknown = null,
  dcEdits: unknown = null,
  dcComments: unknown = null,
  dcNotes: unknown = null;

const paintDetail = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: number,
  v: number,
  t: number,
  curShot: number,
) => {
  const b = a + v;
  const X = (s: number) => ((s - a) / v) * w;
  const { shots: SH, voiceY: VY, actionY: AY } = rows,
    VH = rows.voice - WORDS_H; // VH: the wave's height, the words go under it
  g.fillStyle = tone("track");
  g.fillRect(0, 0, w, h);
  g.font = `12px ${UI_FONT}`;
  g.textBaseline = "middle";
  const named = SH > SHOTS_STRIP; // no Camera row: the shots' names are here
  SHOTS.forEach((s, i) => {
    const e = shotEnd(i);
    if (e < a || s.t > b) return;
    const x0 = Math.max(0, X(s.t)),
      x1 = Math.min(w, X(e));
    if (named) {
      g.fillStyle = i === curShot ? tone("shot-now") : i % 2 ? tone("card") : tone("main-track");
      g.fillRect(x0, 0, x1 - x0 - 1, SH);
      const maxShotW = Math.max(0, x1 - x0 - 7);
      if (maxShotW >= 12) {
        const shotText = fitCanvasText(g, `${i} ${S.comments[i] ?? ""}`.trimEnd(), maxShotW);
        if (shotText) {
          g.fillStyle = tone("foreground");
          g.fillText(shotText, x0 + 4, SH / 2);
        }
      }
    }
    g.fillStyle = tone("grid");
    g.fillRect(X(s.t), SH, 1, h - SH);
  });
  boxes = [];
  g.fillStyle = tone("stuck");
  for (const [x, y] of stuck) if (y > a && x < b) g.fillRect(X(x), SH - 2, X(y) - X(x), 3);
  // Voice: each sentence's pace behind the wave
  if (rows.voice)
    S.voiceOut.forEach((l, i) => {
      const n = S.voiceOut[i + 1];
      if (n && n.s > a && l.e < b && X(n.s) - X(l.e) > 4)
        boxes.push({ type: "gap", i, x0: X(l.e), x1: X(n.s), y0: VY, y1: VY + VH });
      if (l.e < a || l.s > b) return;
      const pace = paceOf(i),
        on = selected?.type === "line" && selected.i === i;
      g.fillStyle = tone(
        on
          ? "pace-pick"
          : pace && pace > FAST_WPM
            ? "pace-fast"
            : pace && pace < SLOW_WPM
              ? "pace-slow"
              : "pace",
      );
      g.fillRect(X(l.s), VY, X(l.e) - X(l.s), VH);
      boxes.push({ type: "line", i, x0: X(l.s), x1: X(l.e), y0: VY, y1: VY + VH });
      if (EDIT.voice.edits[i]) {
        g.fillStyle = tone("primary");
        g.fillRect(X(l.s), VY, X(l.e) - X(l.s), 2);
      }
    });
  if (rows.voice) drawWave(g, a, b, w, VY, VH);
  // Actions and sounds, in lanes so they don't cover each other; as many lanes as the Action row's height holds, 3 to 2
  const count = Math.max(2, Math.floor(rows.action / LANE_H)),
    moves = Math.max(1, Math.round(count * 0.6));
  const lanes: Record<string, number[]> = {
    motion: Array(moves).fill(-1e9),
    sound: Array(Math.max(1, count - moves)).fill(-1e9),
  };
  const BASE: Record<string, number> = { motion: AY, sound: AY + moves * LANE_H };
  g.font = `11px ${UI_FONT}`;
  for (const [id, m] of orderedBeats()) {
    const o0 = fromSource(m.at),
      o1 = fromSource(m.at + m.dur);
    if (o1 < a || o0 > b) continue;
    const row = lanes[m.kind],
      x0 = X(o0),
      x1 = Math.max(x0 + 10, X(o1));
    let lane = row.findIndex((end) => x0 >= end + 2);
    if (lane < 0) lane = 0;
    const label = HOLDS.has(id) ? x0 + 6 : x1;
    row[lane] = Math.max(x1, x0 + (m.title.length * 5.6 + 8));
    const y = BASE[m.kind] + lane * LANE_H,
      on = selected?.type === "beat" && selected.id === id;
    g.fillStyle = tone(
      m.kind === "sound"
        ? "beat-sound"
        : HOLDS.has(id)
          ? "beat-hold"
          : m.curve === "snap"
            ? "beat-snap"
            : "beat-move",
    );
    g.fillRect(x0, y, x1 - x0, 13);
    if (on) {
      g.strokeStyle = tone("pick");
      g.lineWidth = 2;
      g.strokeRect(x0 + 1, y + 1, x1 - x0 - 2, 11);
    }
    const labelSpan = Math.max(0, Math.min(w - x0 - 2, x1 - x0 - 4));
    if (labelSpan >= 10) {
      const beatLabel = fitCanvasText(g, m.title, labelSpan);
      if (beatLabel) {
        g.fillStyle = tone("foreground");
        g.fillText(beatLabel, x0 + 3, y + 7);
      }
    }
    g.fillStyle = tone("primary");
    for (const [off] of m.sounds)
      if (m.kind === "motion") g.fillRect(X(fromSource(m.at + off)), y + 10, 2, 3);
    boxes.unshift({ type: "beat", id, x0, x1: Math.min(x1, label + 60), y0: y, y1: y + 13 });
  }
  g.fillStyle = tone("warn");
  for (const [s0, s1] of marks.optionRanges())
    if (s1 >= a && s0 <= b) g.fillRect(X(s0), h - 5, Math.max(1, X(s1) - X(s0)), 4);
  // Words, as many as fit
  g.font = `12px ${UI_FONT}`;
  let right = -1;
  for (const l of rows.voice ? S.voiceOut : []) {
    if (l.e < a || l.s > b) continue;
    for (const word of l.words) {
      const x = X(word.s);
      if (x < -40 || x > w || x <= right + 3) continue;
      let wd = wordWidths.get(word.w);
      if (wd === undefined) {
        wd = g.measureText(word.w).width;
        wordWidths.set(word.w, wd);
      }
      g.fillStyle = t >= word.s && t <= word.e ? tone("primary") : tone("foreground");
      g.fillText(word.w, x, VY + VH + 11);
      right = x + wd;
    }
  }
  if (rows.voice && !S.voice.lines.length) {
    const hintX = Math.max(8, X(0) + 6);
    const rawHint = !S.voiceReady
      ? "Reading the voice track…"
      : w < 340
        ? "No voice track"
        : "No assembled voice track yet";
    const hintLabel = fitCanvasText(g, rawHint, Math.max(0, w - hintX - 4));
    if (hintLabel) {
      const hintW = g.measureText(hintLabel).width;
      g.fillStyle = tone("track");
      g.fillRect(hintX - 3, VY + VH + 4, hintW + 6, 14);
      g.fillStyle = tone("muted-foreground");
      g.fillText(hintLabel, hintX, VY + VH + 11);
    }
  }
  // Notes: a marker each, their lines faint so many of them don't drown the playhead; a done note keeps only a dim marker, and
  // open/check/asking notes draw hairline stems down the rows in their status tone.
  // Markers under 2 px apart are drawn once and touching lines as one, so thousands of notes stay a few hundred shapes for the
  // GPU (which, drawing every one, held a 3000-note film to 23 fps). marks.notes() comes in film order
  const open = new Path2D(),
    done = new Path2D(),
    check = new Path2D(),
    ask = new Path2D(),
    openRuns: [number, number][] = [],
    checkRuns: [number, number][] = [],
    askRuns: [number, number][] = [];
  let lastOpen = -1e9,
    lastDone = -1e9,
    lastCheck = -1e9,
    lastAsk = -1e9;
  for (const n of marks.notes()) {
    if ((n.to ?? n.t) < a || n.t > b) continue;
    const x = X(n.t);
    const isAsk = !!n.asking;
    if (n.to && !n.done) {
      g.fillStyle = tone(isAsk ? "ai" : n.check ? "warn" : "primary");
      g.fillRect(x, SH + 1, Math.max(2, X(n.to) - x), 3); // a drawn note that spans moments
    }
    const prevX = isAsk ? lastAsk : n.check ? lastCheck : n.done ? lastDone : lastOpen;
    if (x - prevX >= 2) {
      const head = isAsk ? ask : n.check ? check : n.done ? done : open;
      head.moveTo(x - 5, SH + 1);
      head.lineTo(x + 5, SH + 1);
      head.lineTo(x, SH + 10);
      if (isAsk) lastAsk = x;
      else if (n.check) lastCheck = x;
      else if (n.done) lastDone = x;
      else lastOpen = x;
    }
    if (n.done) continue;
    const targetRuns = isAsk ? askRuns : n.check ? checkRuns : openRuns;
    const px = Math.floor(x),
      run = targetRuns.at(-1);
    if (run && px <= run[1] + 1) run[1] = Math.max(run[1], px);
    else targetRuns.push([px, px]);
  }
  g.fillStyle = tone("note-done");
  g.fill(done);
  g.fillStyle = tone("primary");
  g.fill(open);
  g.fillStyle = tone("warn");
  g.fill(check);
  g.fillStyle = tone("ai");
  g.fill(ask);
  g.globalAlpha = 0.4;
  g.fillStyle = tone("primary");
  for (const [x0, x1] of openRuns) g.fillRect(x0, SH + 10, x1 - x0 + 1, h - SH - 10);
  g.globalAlpha = 0.35;
  g.fillStyle = tone("warn");
  for (const [x0, x1] of checkRuns) g.fillRect(x0, SH + 10, x1 - x0 + 1, h - SH - 10);
  g.fillStyle = tone("ai");
  for (const [x0, x1] of askRuns) g.fillRect(x0, SH + 10, x1 - x0 + 1, h - SH - 10);
  g.globalAlpha = 1;
  g.fillStyle = tone("background");
  g.fillRect(0, AY - 1, w, 1);
  g.fillRect(0, h - 1, w, 1);
  drawAi(g, X, a, b, h, 0.12);
};

const drawDetail = () => {
  const c = S.el.detail,
    { g, w, h } = sized(c);
  if (!c.width || w <= 0 || h <= 0) return;
  const { a, v } = view();
  if (v <= 0) return;
  const t = S.t,
    pw = c.width,
    ph = c.height,
    d = devicePixelRatio || 1,
    theme = tone("track"),
    curShot = rows.shots > SHOTS_STRIP ? shotIndex(t) : -1,
    wordMark = activeWordMark(t, a, a + v),
    st = get(),
    notesRef = marks.notes(),
    optGroup = st.groupName ?? "",
    optKey = optionRangesKey(marks.optionRanges()),
    aiKey = aiSpansKey(marks.ai()),
    selType = selected?.type ?? "",
    selVal = selected?.type === "beat" ? selected.id : selected?.type === "line" ? selected.i : "";

  if (
    !detailBgCanvas ||
    dcPw !== pw ||
    dcPh !== ph ||
    dcA !== a ||
    dcV !== v ||
    dcShotsH !== rows.shots ||
    dcVoiceH !== rows.voice ||
    dcActionH !== rows.action ||
    dcTheme !== theme ||
    dcCurShot !== curShot ||
    dcWordMark !== wordMark ||
    dcTimesRev !== S.timesRev ||
    dcVoiceOut !== S.voiceOut ||
    dcVoiceLen !== S.voice.lines.length ||
    dcPeaksLen !== S.voice.peaks.length ||
    dcVoiceReady !== S.voiceReady ||
    dcEdits !== EDIT.voice.edits ||
    dcComments !== S.comments ||
    dcShotsRev !== st.shotsRev ||
    dcSoundRev !== st.soundRev ||
    dcSelType !== selType ||
    dcSelVal !== selVal ||
    dcNotes !== notesRef ||
    dcOptGroup !== optGroup ||
    dcOptKey !== optKey ||
    dcAiKey !== aiKey
  ) {
    if (!detailBgCanvas) detailBgCanvas = document.createElement("canvas");
    if (detailBgCanvas.width !== pw || detailBgCanvas.height !== ph) {
      detailBgCanvas.width = pw;
      detailBgCanvas.height = ph;
    }
    const dg = detailBgCanvas.getContext("2d");
    if (!dg) {
      paintDetail(g, w, h, a, v, t, curShot);
      return;
    }
    dcPw = pw;
    dcPh = ph;
    dcA = a;
    dcV = v;
    dcShotsH = rows.shots;
    dcVoiceH = rows.voice;
    dcActionH = rows.action;
    dcTheme = theme;
    dcCurShot = curShot;
    dcWordMark = wordMark;
    dcTimesRev = S.timesRev;
    dcVoiceOut = S.voiceOut;
    dcVoiceLen = S.voice.lines.length;
    dcPeaksLen = S.voice.peaks.length;
    dcVoiceReady = S.voiceReady;
    dcEdits = EDIT.voice.edits;
    dcComments = S.comments;
    dcShotsRev = st.shotsRev;
    dcSoundRev = st.soundRev;
    dcSelType = selType;
    dcSelVal = selVal;
    dcNotes = notesRef;
    dcOptGroup = optGroup;
    dcOptKey = optKey;
    dcAiKey = aiKey;
    dg.setTransform(d, 0, 0, d, 0, 0);
    paintDetail(dg, w, h, a, v, t, curShot);
  }
  g.drawImage(detailBgCanvas, 0, 0, pw, ph, 0, 0, w, h);
};
// Where the AI is in the film (activity/activity.ts): its violet over the seconds it looks at or renders, what a check of its
// found in the check's colour; faint down the rows and stronger on the ruler. Under the playhead, which stays the creator's
const drawAi = (
  g: CanvasRenderingContext2D,
  X: (s: number) => number,
  a: number,
  b: number,
  h: number,
  alpha: number,
) => {
  for (const s of marks.ai()) {
    if (s.b < a || s.a > b) continue;
    const x0 = X(s.a),
      x1 = Math.max(x0 + 2, X(s.b));
    g.fillStyle = tone(s.level === "fail" ? "destructive" : s.level === "warn" ? "warn" : "ai");
    g.globalAlpha = alpha;
    g.fillRect(x0, 0, x1 - x0, h);
    g.globalAlpha = 1;
    g.fillRect(x0, 0, 2, h);
  }
  g.globalAlpha = 1;
};

const rulerLabels = new Map<number, string>();
const rulerLabel = (s: number) => {
  let label = rulerLabels.get(s);
  if (!label) {
    label = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    rulerLabels.set(s, label);
  }
  return label;
};

// The seconds over every row, as CapCut 9.7's ruler measured off the dev's screenshot: a dark line along its top, the ticks
// hanging from just under it (long at each label, short between, dimmer still), the seconds dim beside each long one so the
// clips under them lead. It stays put while the rows under it scroll, and carries the playhead's head
const drawRuler = () => {
  const c = S.el.ruler,
    { g, w, h } = sized(c);
  if (!c.width || w <= 0 || h <= 0) return;
  const { a, v } = view();
  if (v <= 0) return;
  const b = a + v,
    scale = w / v,
    X = (s: number) => (s - a) * scale;
  g.fillStyle = tone("background");
  g.fillRect(0, 0, w, h);
  g.fillStyle = tone("backdrop");
  g.fillRect(0, 0, w, 1);
  // Room for each label whatever the screen; ten short ticks to a label when they stand apart, as CapCut's, else five
  const tick = [1, 2, 5, 10, 30, 60].find((n) => n * scale >= 72) ?? 60,
    apart = tick * scale,
    minor = tick / (apart >= 150 ? 10 : 5);
  g.fillStyle = tone("ruler-dot");
  for (let s = Math.max(0, Math.ceil(a / minor) * minor); s <= b; s += minor)
    g.fillRect(Math.round((s - a) * scale), 4, 1, 6);
  g.font = `11px ${UI_FONT}`;
  g.textBaseline = "middle";
  const playheadX = X(S.t);
  const tickColor = tone("ruler-tick"),
    textColor = tone("ruler-text");
  for (let s = Math.max(0, Math.ceil(a / tick) * tick); s <= b; s += tick) {
    const x = Math.round((s - a) * scale);
    g.fillStyle = tickColor;
    g.fillRect(x, 4, 1, 11);
    const label = rulerLabel(s);
    const lw = g.measureText(label).width;
    let lx = x + 4;
    if (s === 0 && Math.abs(playheadX - x) <= 6) lx = Math.max(lx, Math.round(playheadX) + 8);
    if (lx + lw > w - 2 || (lx < playheadX + 6 && lx + lw > playheadX - 6)) continue;
    g.fillStyle = textColor;
    g.fillText(label, lx, 10);
  }
  drawAi(g, X, a, b, h, 0.3);
  drawInOut(g, X, w, h);
  const t = X(S.t);
  drawPlayhead(g, t, h);
  // CapCut's handle: a hollow white shield from the top edge down, the ruler showing through it
  g.beginPath();
  g.moveTo(t - 4.5, 1.5);
  g.lineTo(t + 4.5, 1.5);
  g.lineTo(t + 4.5, 9);
  g.quadraticCurveTo(t + 4.5, 11.5, t, 14);
  g.quadraticCurveTo(t - 4.5, 11.5, t - 4.5, 9);
  g.closePath();
  g.fillStyle = tone("background");
  g.fill();
  g.strokeStyle = tone("pick");
  g.lineWidth = 1.5;
  g.lineJoin = "round";
  g.stroke();
};
// CapCut's In to Out stretch (inout.ts): the film outside it dimmed, its ends bracketed in blue
const drawInOut = (g: CanvasRenderingContext2D, X: (s: number) => number, w: number, h: number) => {
  const r = get().inOut;
  if (!r) return;
  const x0 = Math.max(-2, X(r[0])),
    x1 = Math.min(w + 2, X(r[1]));
  g.fillStyle = tone("scrim");
  if (x0 > 0) g.fillRect(0, 0, x0, h);
  if (x1 < w) g.fillRect(x1, 0, w - x1, h);
  g.fillStyle = tone("in-out");
  g.fillRect(x0, 0, Math.max(1, x1 - x0), 2);
  g.fillRect(x0, 0, 2, h);
  g.fillRect(x1 - 2, 0, 2, h);
};

// One playhead down every track below the ruler, bridging row gaps and empty bottom space (CapCut style)
let playheadDetail: HTMLElement | null = null;
let playheadScroller: HTMLElement | null = null;
let playheadLine: HTMLElement | null = null;
let playheadTop = "";
let playheadHeight = "";
let playheadWidth = "";
let playheadTranslate = "";

let rectCache = new WeakMap<Element, DOMRect>();
const rectObserved = new WeakSet<Element>();
let rectScroller: HTMLElement | null = null;
let scrollerClientH = -1;
const observeScrollerRows = (scroller: HTMLElement) => {
  if (!rectRo) return;
  for (const ch of scroller.children) {
    if (ch === S.el?.rowbox || rectObserved.has(ch)) continue;
    rectObserved.add(ch);
    rectRo.observe(ch);
  }
};
export const invalidateRects = () => {
  rectCache = new WeakMap();
  scrollerClientH = -1;
  invalidateShown();
  if (rectScroller?.isConnected) observeScrollerRows(rectScroller);
};
const rectRo = typeof ResizeObserver !== "undefined" ? new ResizeObserver(invalidateRects) : null;
if (typeof window !== "undefined") {
  window.addEventListener("resize", invalidateRects, { passive: true });
}
const getCachedRect = (el: Element): DOMRect => {
  if (!rectRo) return el.getBoundingClientRect();
  let r = rectCache.get(el);
  if (!r) {
    if (!rectObserved.has(el)) {
      rectObserved.add(el);
      rectRo.observe(el);
      if (document.documentElement && !rectObserved.has(document.documentElement)) {
        rectObserved.add(document.documentElement);
        rectRo.observe(document.documentElement);
      }
    }
    r = el.getBoundingClientRect();
    rectCache.set(el, r);
  }
  return r;
};
const getScrollerHeight = (scroller: HTMLElement): number => {
  if (!rectRo) return scroller.clientHeight;
  if (scrollerClientH < 0) scrollerClientH = scroller.clientHeight;
  return scrollerClientH;
};

const syncPlayhead = () => {
  const line = S.el?.playhead;
  if (!line) return;
  if (playheadLine !== line) {
    playheadLine = line;
    playheadTop = "";
    playheadHeight = "";
    playheadWidth = "";
    playheadTranslate = "";
  }
  const { timeline, ruler, detail } = S.el;
  if (detail && (playheadDetail !== detail || !playheadScroller?.isConnected)) {
    playheadDetail = detail;
    playheadScroller = detail.closest<HTMLElement>("[data-tracks-scroll]");
    if (playheadScroller && rectScroller !== playheadScroller) {
      rectScroller = playheadScroller;
      playheadScroller.addEventListener("scroll", invalidateRects, { passive: true });
      observeScrollerRows(playheadScroller);
    }
    invalidateRects();
  }
  const scroller = detail ? playheadScroller : null;
  const { a, v } = view();
  if (!timeline || !ruler || !scroller || v <= 0 || !isElementShown(detail)) {
    if (!line.hidden) line.hidden = true;
    return;
  }
  const dr = getCachedRect(detail),
    sr = getCachedRect(scroller),
    top = Math.max(getCachedRect(ruler).bottom, sr.top),
    height = Math.max(0, sr.top + getScrollerHeight(scroller) - top),
    cx = ((S.t - a) / v) * dr.width,
    x0 = Math.max(0, cx - 0.75),
    x1 = Math.min(dr.width, cx + 0.75);
  if (dr.width <= 0 || height <= 0 || x1 <= x0) {
    if (!line.hidden) line.hidden = true;
    return;
  }
  const box = getCachedRect(timeline),
    nextTop = `${top - box.top}px`,
    nextHeight = `${height}px`,
    nextWidth = `${x1 - x0}px`,
    nextTranslate = `${dr.left + x0 - box.left}px`;
  if (playheadTop !== nextTop) {
    line.style.top = nextTop;
    playheadTop = nextTop;
  }
  if (playheadHeight !== nextHeight) {
    line.style.height = nextHeight;
    playheadHeight = nextHeight;
  }
  if (playheadWidth !== nextWidth) {
    line.style.width = nextWidth;
    playheadWidth = nextWidth;
  }
  if (playheadTranslate !== nextTranslate) {
    line.style.translate = nextTranslate;
    playheadTranslate = nextTranslate;
  }
  if (line.hidden) line.hidden = false;
};
export const drawTimelineActivity = () => {
  if (!S.el?.detail) return; // no timeline in this layout (a phone's, PhoneApp)
  drawRuler();
  drawDetail();
};

export const drawTimelines = () => {
  if (!S.el?.detail) return;
  drawTimelineActivity();
  marks.layers();
  marks.openfilm();
  marks.text();
  marks.cam();
  marks.keys();
  marks.lanes();
  syncPlayhead();
};
// Shows s seconds (6 at the closest, the whole film at the farthest), as CapCut's zoom slider; zoomSpan scales what is shown
export const ZOOM_MIN = 6;
export const zoomTo = (s: number) => {
  const span = Math.max(ZOOM_MIN, Math.min(DURATION, s));
  set({ span });
  stored.set("span", String(span), sessionStorage);
  drawTimelines();
};
export const zoomSpan = (k: number) => zoomTo(shown() * k);
export const zoomToFit = () => zoomTo(DURATION); // the whole film
// Auto snapping (S, or the toolbar): drags stick to the playhead, words, cuts and edges
export const toggleMagnet = () => {
  const on = !get().magnet;
  setPref("magnet", on);
  say(on ? "Auto snapping on" : "Auto snapping off");
};
// The wheel over any timeline row, as CapCut's: plain scrolls the rows up and down (the browser's own scroll), Ctrl+wheel zooms,
// Alt+wheel slides the stretch along the film without moving the playhead (Shift+wheel too, as in Premiere, and a sideways swipe)
export const timelineWheel = (e: WheelEvent) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    zoomSpan(e.deltaY > 0 ? 1.2 : 1 / 1.2);
    return;
  }
  const side =
    e.altKey || e.shiftKey
      ? e.deltaY || e.deltaX
      : Math.abs(e.deltaX) > Math.abs(e.deltaY)
        ? e.deltaX
        : 0;
  if (!side) return;
  e.preventDefault();
  const v = shown(),
    w = S.el.detail.clientWidth || 1,
    px = side * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? w : 1);
  if (v >= DURATION) return;
  slid = { c: Math.max(v / 2, Math.min(DURATION - v / 2, viewCentre() + (px / w) * v)), t: S.t };
  drawTimelines();
};

const boxAt = (e: PointerEvent) => {
  const r = getCachedRect(S.el.detail),
    x = e.clientX - r.left,
    y = e.clientY - r.top;
  // A fingertip covers more than these thin rows: take what's nearest within reach, and keep a cut's edge easy to catch
  const reach = e.pointerType === "touch" ? 9 : 0;
  let best: Box | null = null,
    d = 1e9;
  for (const b of boxes) {
    const dx = Math.max(b.x0 - reach - x, 0, x - b.x1 - reach),
      dy = Math.max(b.y0 - reach - y, 0, y - b.y1 - reach);
    if (dx || dy) continue;
    const e2 = Math.abs(y - (b.y0 + b.y1) / 2) + (b.type === "line" || b.type === "gap" ? 20 : 0);
    if (e2 < d) {
      d = e2;
      best = b;
    }
  }
  return best;
};

// Scrubbing, as in CapCut: a press on the ruler seeks there and drags; on the rows below (detail) only the playhead line itself
// drags, a click on a word or a beat picks what the panel describes, a click on empty space puts the playhead there and a mouse
// drag draws the box over the rows (rowbox.ts). A touch drag scrubs from anywhere, a fingertip being too wide for the line. The
// stretch below holds still while it drags
export const attachTimeline = () => {
  const { ruler, detail } = S.el,
    scroller = detail.closest<HTMLElement>("[data-tracks-scroll]");
  const scrub = (
    c: HTMLElement,
    toTime: (e: PointerEvent) => number,
    grab: (e: PointerEvent) => boolean = () => true,
    active: (e: PointerEvent) => boolean = () => true,
  ) => {
    let press: { x: number; y: number } | null = null; // a touch that has not moved yet
    let own = false;
    const start = (e: PointerEvent) => {
      S.dragging = { resume: S.playing };
      if (S.playing) setPlaying(false);
      frozenCentre = viewCentre();
      seek(toTime(e));
      skimSound(S.t);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !active(e)) return;
      own = true;
      c.setPointerCapture(e.pointerId);
      if (grab(e)) start(e);
      else if (e.pointerType === "touch") press = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      if (!own) return;
      own = false;
      press = null;
      if (!S.dragging) return;
      const r = S.dragging.resume;
      S.dragging = null;
      frozenCentre = null;
      S.dirty = true;
      if (r) setPlaying(true);
    };
    // A move with the button already up ends the drag too: a let-go never heard would otherwise scrub on a mere hover
    const move = (e: PointerEvent) => {
      if (own) {
        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= 4) {
          press = null;
          start(e);
          return;
        }
        if (!S.dragging) return;
        if (!(e.buttons & 1)) up();
        else {
          seek(toTime(e));
          skimSound(S.t);
        }
        return;
      }
      if (!S.dragging && e.pointerType === "mouse" && !e.buttons)
        c.style.cursor = active(e) && grab(e) ? "ew-resize" : "";
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) c.addEventListener(t, up);
  };
  let onThing = false; // the press was on a word or a beat, which it picks: its release is no click on empty space
  detail.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    invalidateRects();
    const b = boxAt(e);
    onThing = !!b;
    selected =
      b?.type === "beat"
        ? { type: "beat", id: b.id }
        : b && (b.type === "line" || b.type === "gap")
          ? { type: "line", i: b.i }
          : null;
    describeSelection();
    const r = getCachedRect(detail);
    if (e.pointerType !== "touch" && !onPlayhead(e.clientX - r.left, r.width, false))
      boxStart(e, e.shiftKey || e.ctrlKey || e.metaKey);
  });
  detail.addEventListener("pointermove", boxMove);
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"])
    detail.addEventListener(t, (e) => boxEnd(onThing ? undefined : (e as PointerEvent)));
  boxPick.seek = (x) => {
    const r = getCachedRect(detail);
    if (r.width) seek(Math.max(0, Math.min(DURATION, timeAt(x - r.left, r.width))));
  };
  const local = (c: HTMLCanvasElement, e: PointerEvent) => {
    const r = getCachedRect(c);
    return { x: e.clientX - r.left, w: r.width };
  };
  scrub(ruler, (e) => {
    const { x, w } = local(ruler, e);
    return timeAt(x, w);
  });
  scrub(
    detail,
    (e) => {
      const { x, w } = local(detail, e);
      return timeAt(x, w);
    },
    (e) => {
      const { x, w } = local(detail, e);
      return onPlayhead(x, w, e.pointerType === "touch");
    },
  );
  for (const c of [ruler, detail]) c.addEventListener("wheel", timelineWheel, { passive: false });
  if (scroller) {
    const gapHit = (e: PointerEvent) => {
      if (
        !scroller.contains(e.target as Node) ||
        (e.target as Element).closest("button, input, canvas, [role=separator]")
      )
        return null;
      const r = getCachedRect(detail);
      return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right
        ? { x: e.clientX - r.left, w: r.width }
        : null;
    };
    let gapBox = false;
    scrub(
      scroller,
      (e) => {
        const { x, w } = local(detail, e);
        return timeAt(x, w);
      },
      (e) => {
        const hit = gapHit(e);
        return !!hit && onPlayhead(hit.x, hit.w, e.pointerType === "touch");
      },
      (e) => {
        const hit = gapHit(e);
        return !!hit && (e.pointerType !== "touch" || onPlayhead(hit.x, hit.w, true));
      },
    );
    scroller.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !scroller.contains(e.target as Node)) return;
      if ((e.target as Element).closest("button, input, canvas, [role=separator]")) return;
      const hit = gapHit(e);
      if (!hit) {
        boxPick.clear();
        return;
      }
      if (e.pointerType !== "touch" && !onPlayhead(hit.x, hit.w, false)) {
        gapBox = true;
        boxStart(e, e.shiftKey || e.ctrlKey || e.metaKey);
      }
    });
    scroller.addEventListener("pointermove", (e) => {
      if (gapBox) boxMove(e);
    });
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"])
      scroller.addEventListener(t, (e) => {
        if (!gapBox) return;
        gapBox = false;
        boxEnd(e.type === "pointerup" ? (e as PointerEvent) : undefined);
      });
  }
  invalidateRects();
  const ro = new ResizeObserver(() => {
    invalidateRects();
    drawTimelines();
  });
  ro.observe(S.el.timeline);
  if (scroller) {
    ro.observe(scroller);
    observeScrollerRows(scroller);
  }
  if (S.el.detail) onShownResize(S.el.detail, drawTimelines);
  window.__editor ??= {
    boxes: () => boxes,
    seek,
    duration: () => DURATION,
    clear: () => {
      selected = null;
      describeSelection();
    },
    words: () => S.voice.lines.flatMap((l) => l.words.map((w) => w.s)),
  };
};

// The voice lines and their words, which the timeline lays out and the captions read
export const loadVoice = async () => {
  const r = await getFile("/api/voice_map.json").catch(() => null);
  S.voiceReady = true;
  if (r?.ok) {
    S.voice = await r.json();
    refreshTimes();
    invalidatePictures();
  } else S.dirty = true;
};
