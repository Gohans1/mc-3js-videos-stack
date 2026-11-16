// What the AI is doing, as the studio's server hears it (src/activity.mjs): the latest lines, and what each one lights for a
// moment, the way a collaborator's cursor shows where they are: the notes it reads or answers, the lesson files it reads or
// writes, the seconds of the film it looks at or renders. Shown only: nothing here moves the playhead, scrolls a list, opens
// a panel or takes the focus, so the creator watching or writing a note is never pulled away. Settings turns it off
import { createStore, useStore } from "zustand";

import type { ActivityEntry, ActivityState as Told } from "../../src/activity.mjs";
import { onEvent } from "../core/events";
import { S } from "../core/state";
import { get as studio } from "../core/store";
import { anyKeyLit, LIT_MS, mergeLitKeys, pruneLitMap } from "./lit";

export { anyKeyLit, LIT_MS };
export const IDLE_MS = 90e3; // and the AI shows as idle after this long without a word
const JOB_MS = 3600e3; // a render the studio never said ended stops showing busy after render's own hour
const KEEP = 40; // lines listed, as the server keeps

export type Seen = ActivityEntry & { seen: number }; // seen: when this page heard it, by this device's clock
// job: a running command's own seconds, lit until it ends; from: the command whose line lit it, so its next run clears
// what the last one found
type Span = {
  a: number;
  b: number;
  until: number;
  job?: string;
  from?: string;
  level?: ActivityEntry["level"];
};
interface ActivityState {
  items: Seen[]; // oldest first
  lit: Record<string, number>; // "note:<id>", "lesson:<path>", "tab:notes", "tab:lessons": until when
  spans: Span[]; // heard seconds lit on the ruler; a running render's until it ends
  jobs: Record<string, number>; // long commands running (render), since when
}
export const activity = createStore<ActivityState>(() => ({
  items: [],
  lit: {},
  spans: [],
  jobs: {},
}));
const get = activity.getState,
  set = activity.setState;
export const useActivity = <T>(pick: (s: ActivityState) => T) => useStore(activity, pick);
export const useLit = (key: string) => useActivity((s) => key in s.lit);
export const useLitAny = (keys: readonly string[]) => useActivity((s) => anyKeyLit(s.lit, keys, 0));

// Whether the AI is at work now: a word lately, or a render still running
export const busy = (s: ActivityState, now: number) =>
  Object.keys(s.jobs).length > 0 || now - (s.items.at(-1)?.seen ?? -Infinity) < IDLE_MS;

// What has gone dark by now goes, and the next to go is waited for
let pruneTimer = 0;
const prune = () => {
  const now = Date.now(),
    { lit, spans, jobs } = get();
  const nextLit = pruneLitMap(lit, now),
    kept = spans.filter((s) => s.until > now);
  set({
    lit: nextLit,
    spans: kept,
    jobs: Object.fromEntries(Object.entries(jobs).filter(([, since]) => now - since < JOB_MS)),
  });
  if (kept.length !== spans.length) S.dirty = true; // the ruler draws the spans
  const next = Math.min(...Object.values(nextLit), ...kept.map((s) => s.until));
  clearTimeout(pruneTimer);
  if (Number.isFinite(next)) pruneTimer = window.setTimeout(prune, Math.max(50, next - now));
};

// Lit afresh: a key still lit goes dark for a frame first, so its glow starts over
const light = (keys: string[]) => {
  if (!keys.length) return;
  const on = () => {
    set({ lit: mergeLitKeys(get().lit, keys) });
    prune();
  };
  const { lit } = get();
  if (!keys.some((k) => k in lit)) return on();
  set({ lit: Object.fromEntries(Object.entries(lit).filter(([k]) => !keys.includes(k))) });
  requestAnimationFrame(on);
};

const hear = (a: ActivityEntry) => {
  const now = Date.now(),
    job = a.job;
  const s = get();
  if (a.id <= (s.items.at(-1)?.id ?? 0)) return; // listed already by loadActivity, read as this line was on its way
  set({
    items: [...s.items, { ...a, seen: now }].slice(-KEEP),
    jobs: !job
      ? s.jobs
      : job.end
        ? Object.fromEntries(Object.entries(s.jobs).filter(([k]) => k !== job.key))
        : { ...s.jobs, [job.key]: now },
    // a render's seconds stay lit while it runs, and fade like the rest once it ends; a command run again clears what its
    // last run found
    spans: !job
      ? s.spans
      : job.end
        ? s.spans.map((x) => (x.job === job.key ? { ...x, until: now + LIT_MS } : x))
        : s.spans.filter((x) => x.from !== job.key),
  });
  if (studio().aiActivity) {
    const notes = a.notes ?? [],
      lessons = a.lessons ?? [];
    light([
      ...notes.map((id) => `note:${id}`),
      ...lessons.map((p) => `lesson:${p}`),
      ...(notes.length ? ["tab:notes"] : []),
      ...(lessons.length ? ["tab:lessons"] : []),
    ]);
    const running = job && !job.end ? job.key : undefined,
      level = a.level,
      found = level === "warn" || level === "fail", // stays lit while the AI is at work on it
      lit: Span[] = (a.marks ?? []).map((m) => ({
        a: m.at,
        b: m.to ?? m.at,
        until: now + (found ? IDLE_MS : LIT_MS),
        from: job?.key,
        level,
      }));
    if (a.at !== undefined)
      lit.push({
        a: a.at,
        b: a.to ?? a.at,
        until: now + (running ? JOB_MS : LIT_MS),
        job: running,
        from: job?.key,
        level,
      });
    if (lit.length) set({ spans: [...get().spans, ...lit] });
  }
  S.dirty = true;
  prune();
};

// The stretches of the film the AI is at, for the ruler (timeline/timeline.ts marks.ai)
export const aiSpans = () => (studio().aiActivity ? get().spans : []);

// The lines from before this page opened, or from while its line was down: listed, nothing lit for them but a render still
// running, which shows busy and its seconds as if heard live. The studio's list of running jobs is the truth: one that ended
// meanwhile, or died with its studio, goes
let boot = 0;
export const loadActivity = async () => {
  let got: Told;
  try {
    const r = await fetch("/api/activity");
    if (!r.ok) return;
    got = await r.json();
  } catch {
    return;
  }
  const skew = Date.now() - got.now, // the studio's clock to this device's
    seen = (a: ActivityEntry): Seen => ({ ...a, seen: a.when + skew }),
    same = got.boot === boot,
    mine = get().items,
    last = mine.at(-1)?.id ?? 0;
  boot = got.boot;
  const jobs = Object.fromEntries(got.running.map((a) => [a.job!.key, a.when + skew])),
    spans = get().spans.filter((x) => !x.job || x.job in jobs);
  if (studio().aiActivity)
    for (const a of got.running)
      if (a.at !== undefined && !spans.some((x) => x.job === a.job!.key))
        spans.push({
          a: a.at,
          b: a.to ?? a.at,
          until: a.when + skew + JOB_MS,
          job: a.job!.key,
          from: a.job!.key,
        });
  set({
    items: same
      ? [...mine, ...got.lines.filter((a) => a.id > last).map(seen)].slice(-KEEP)
      : got.lines.map(seen),
    jobs,
    spans,
  });
  S.dirty = true;
  prune();
};

export const listenActivity = () => {
  onEvent("activity", (data) => {
    let a: ActivityEntry;
    try {
      a = JSON.parse(data);
    } catch {
      return;
    }
    hear(a);
  });
  void loadActivity();
};
