import { mapTimeline } from "../../src/timing-data.mjs";
import { clockForTimeline } from "../../src/timing-state.mjs";
import type { TimingClock } from "../../src/timing.mjs";
import { createDoc, type Doc, type Hooks } from "./doc";

export interface TimedDoc<T> extends Doc<T> {
  readonly source: T | null;
  refresh: () => void;
  sourceSnapshot: () => string;
  restoreSource: (snap: string) => void;
  editSource: (change: (d: T) => void) => void;
  edit: (change: (d: T) => void, inputClock?: TimingClock) => void;
  preview: (change: (d: T) => void, inputClock?: TimingClock) => void;
}
const refreshers = new Set<() => void>();
export const refreshTimedDocs = () => {
  for (const refresh of refreshers) refresh();
};

// History and disk keep source coordinates. Only the editable view is projected, so changing speed cannot bake motion keys.
export const createTimedDoc = <T extends object>(
  name: string,
  hooks: Hooks<T>,
  durations: () => Record<string, number> = () => ({}),
): TimedDoc<T> => {
  let view: T | null = null;
  const changed = () => {
    view = mapTimeline(name, source.data, clockForTimeline(name), false, null, durations());
    hooks.changed();
  };
  const source = createDoc<T>(name, { ...hooks, changed });
  const changeSource = (change: (d: T) => void, inputClock?: TimingClock) => (data: T) => {
    const clock = clockForTimeline(name);
    const basis = inputClock ?? clock;
    const next = mapTimeline(name, data, basis, false, null, durations());
    change(next);
    const raw = mapTimeline(name, next, clock, true, data, durations(), basis);
    if (Array.isArray(data) && Array.isArray(raw)) data.splice(0, data.length, ...raw);
    else {
      for (const k of Object.keys(data)) delete (data as Record<string, unknown>)[k];
      Object.assign(data, raw);
    }
  };
  const refresh = () => {
    if (source.data !== null) changed();
  };
  refreshers.add(refresh);
  return {
    get data() {
      return view;
    },
    get source() {
      return source.data;
    },
    load: source.load,
    refresh,
    sourceSnapshot: source.snapshot,
    restoreSource: source.restore,
    editSource: (change) => source.edit(change),
    edit: (change, inputClock) => source.edit(changeSource(change, inputClock)),
    preview: (change, inputClock) => source.preview(changeSource(change, inputClock)),
    snapshot: () => JSON.stringify(view),
    restore: (snap) =>
      source.restore(
        JSON.stringify(
          mapTimeline(
            name,
            JSON.parse(snap),
            clockForTimeline(name),
            true,
            source.data,
            durations(),
          ),
        ),
      ),
  };
};
