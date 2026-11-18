// What the AI is doing, as the studio's server hears it (src/activity.mjs): the latest lines, and what each one lights for a
// moment, the way a collaborator's cursor shows where they are: the notes it reads or answers, the lesson files it reads or
// writes, the seconds of the film it looks at or renders. Shown only: nothing here moves the playhead, scrolls a list, opens
// a panel or takes the focus, so the creator watching or writing a note is never pulled away. Settings turns it off
import { createStore, useStore } from "zustand";

import { activityToast, toast } from "@/components/ui/toast";

import type { ActivityEntry, ActivityState as Told, ActivitySurface } from "../../src/activity.mjs";
import { PHONE } from "../core/device";
import { onEvent } from "../core/events";
import { get as studio, studio as studioStore } from "../core/store";
import { listenForChimeActivation, playActivityChime } from "./chime";
import { anyKeyLit, LIT_MS, mergeLitKeys, pruneLitMap } from "./lit";

export { anyKeyLit, LIT_MS };
export const activityNotice = () => (PHONE || !studio().aiActivity ? toast : activityToast);
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
  surface?: ActivitySurface;
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
    kept = spans.filter((s) => s.until > now),
    entries = Object.entries(jobs),
    activeJobs = entries.filter(([, since]) => now - since < JOB_MS);
  if (nextLit !== lit || kept.length !== spans.length || activeJobs.length !== entries.length) {
    set({
      lit: nextLit,
      spans: kept.length === spans.length ? spans : kept,
      jobs: activeJobs.length === entries.length ? jobs : Object.fromEntries(activeJobs),
    });
  }
  const next = Math.min(
    ...Object.values(nextLit),
    ...kept.map((s) => s.until),
    ...activeJobs.map(([, since]) => since + JOB_MS),
  );
  clearTimeout(pruneTimer);
  if (Number.isFinite(next)) pruneTimer = window.setTimeout(prune, Math.max(50, next - now));
};

const light = (keys: string[]) => {
  if (!keys.length) return;
  set({ lit: mergeLitKeys(get().lit, keys) });
};

const noteLights = (ids: readonly string[]) =>
  ids.length ? ["tab:notes", ...ids.map((id) => `note:${id}`)] : [];

export const lightNotes = (ids: readonly string[]) => {
  if (studio().aiActivity) {
    light(noteLights(ids));
    prune();
  }
};

export const lightEdit = (
  surface: ActivitySurface,
  keys: string[] = [],
  ranges: (readonly [number, number])[] = [],
) => {
  if (!studio().aiActivity) return;
  light([`tab:${surface}`, ...[...new Set(keys)].slice(0, 40)]);
  const until = Date.now() + LIT_MS;
  if (ranges.length) {
    const fresh = ranges
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= a)
      .slice(0, 20)
      .map(([a, b]) => ({ a, b, until, surface }));
    set({ spans: [...get().spans.filter((span) => span.surface !== surface), ...fresh] });
  }
  prune();
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
      ...(a.surface ? [`tab:${a.surface}`] : []),
      ...noteLights(notes),
      ...lessons.map((p) => `lesson:${p}`),
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
    if (a.level === "fail") {
      activityNotice().add({ title: a.say, type: "error", timeout: 10_000 });
      playActivityChime();
    }
  }
  prune();
};

// The stretches of the film the AI is at, for the ruler (timeline/timeline.ts marks.ai)
export const aiSpans = () => (studio().aiActivity ? get().spans : []);

export const onActivitySpans = (draw: () => void) => {
  let queued = false;
  return activity.subscribe((current, previous) => {
    if (queued || current.spans === previous.spans) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      draw();
    });
  });
};

// The lines from before this page opened, or from while its line was down: listed, nothing lit for them but a render still
// running, which shows busy and its seconds as if heard live. The studio's list of running jobs is the truth: one that ended
// meanwhile, or died with its studio, goes
let boot = 0;
export const loadActivity = async () => {
  let got: Told;
  try {
    const map = (window as { __PREFETCH?: Record<string, Promise<Response | null>> }).__PREFETCH;
    const early = map?.["/api/activity"];
    if (early) delete map["/api/activity"];
    const r = (early ? await early : null) ?? (await fetch("/api/activity"));
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
    previous = get().spans,
    spans = previous.filter((x) => !x.job || x.job in jobs);
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
    spans: spans.length === previous.length && spans.every((span, i) => span === previous[i]) ? previous : spans,
  });
  prune();
};

export const listenActivity = () => {
  listenForChimeActivation();
  studioStore.subscribe((next, previous) => {
    if (previous.aiActivity && !next.aiActivity) {
      set({ lit: {}, spans: [] });
      prune();
    }
  });
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
