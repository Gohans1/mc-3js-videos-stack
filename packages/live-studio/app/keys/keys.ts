import { EDIT } from "film/edit";

import { isTimedKey, keyRows, rowAt } from "../../src/contract-keys.ts";
import { equalJson } from "../../src/merge-edits.mjs";
import { clockForTimeline } from "../../src/timing-state.mjs";
import { lightEdit } from "../activity/activity";
import { together } from "../core/doc";
import { getFile, prefetchFile } from "../core/net";
import { transitionSelection } from "../core/selection";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { get, invalidatePictures, say, set } from "../core/store";
import { pasteTargets, r3, stamp } from "../core/time";
import { createTimedDoc, type TimedDoc, type TimedProjection } from "../core/timed-doc";
import { type KeyRef } from "./slice";

export interface Key {
  t: number;
  __timing?: { source: number; output: number };
  [k: string]: unknown;
}
export interface Row {
  f: number;
  path: string[];
  id: string;
  label: string;
}
interface KeyFile {
  file: string;
  edit: string;
  requiredRows: string[][];
  doc: TimedDoc<object>;
}

export let files: KeyFile[] = [];
export let rows: Row[] = [];
export const rowId = (f: number, path: string[]) => `${f}:${path.join(".")}`;
const labelOf = (path: string[]) =>
  (path.length > 1 && path.at(-1) === "keys" ? path.slice(0, -1) : path).join(".");
const listAt = (data: unknown, path: string[]): Key[] => {
  const v = rowAt(data, path);
  return Array.isArray(v)
    ? (v as Key[])
    : v && typeof v === "object" && Number.isFinite((v as Key).t)
      ? [v as Key]
      : [];
};
export const isSingleKeyRow = (f: number, path: string[]) => {
  const v = rowAt(files[f]?.doc.data, path);
  return !!v && !Array.isArray(v) && typeof v === "object" && Number.isFinite((v as Key).t);
};
export const keysOf = (f: number, path: string[]): Key[] => listAt(files[f]?.doc.data, path);
export const keyOf = (r: KeyRef) => keysOf(r.f, r.path)[r.i];
export const sameKey = (a: KeyRef, b: KeyRef) =>
  a.f === b.f && a.i === b.i && a.path.join(".") === b.path.join(".");
export const isPicked = (r: KeyRef) => get().keyPicks.some((p) => sameKey(p, r));
export const nameOf = (k: Key) => {
  for (const f of ["do", "mood", "pose", "clip", "title", "text"])
    if (typeof k[f] === "string") return k[f] as string;
  return "";
};
export const same = (a: Key, b: Key) => {
  const { t: _, ...x } = a,
    { t: __, ...y } = b;
  return JSON.stringify(x) === JSON.stringify(y);
};

const FOLD = "keysFolded";
let folded = new Set<number>(JSON.parse(stored.get(FOLD) ?? "[]"));
export const isFolded = (f: number) => folded.has(f);
export const fold = (f: number, on: boolean) => {
  folded = new Set(folded);
  if (on) folded.add(f);
  else folded.delete(f);
  stored.set(FOLD, JSON.stringify([...folded]));
  bump();
};
export const HEAD_H = 26,
  ROW_H = 22;
export type Line = { kind: "file"; f: number; y: number } | { kind: "row"; row: Row; y: number };
export const lines = (): Line[] => {
  const out: Line[] = [];
  let y = 0;
  files.forEach((_, f) => {
    out.push({ kind: "file", f, y });
    y += HEAD_H;
    if (!folded.has(f))
      for (const row of rowsOf(f)) {
        out.push({ kind: "row", row, y });
        y += ROW_H;
      }
  });
  return out;
};
export const litRow = () => {
  const p = S.tools?.placed,
    name = get().object,
    f = p ? files.findIndex((x) => x.edit === p.key) : -1;
  return name && f >= 0 ? rowId(f, [name, "keys"]) : null;
};
export const rowsOf = (f: number) => rows.filter((r) => r.f === f);
export const labelSteps = (r: Row) =>
  (r.path.length > 1 && r.path.at(-1) === "keys" ? r.path.slice(0, -1) : r.path).slice(-2);
export const fileTitle = (f: number) => {
  if (files[f]?.edit === S.tools?.placed?.key) return "Objects";
  const base = (files[f]?.file.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  return base
    .split(/[-_.\s]+|(?<=[a-z])(?=[A-Z])/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
};
export const linesHeight = () => {
  const l = lines(),
    last = l[l.length - 1];
  return last ? last.y + (last.kind === "file" ? HEAD_H : ROW_H) : 0;
};

const bump = () => {
  S.dirty = true;
  set({ keysRev: get().keysRev + 1 });
};
const push = (f: number) => {
  const x = files[f];
  (EDIT as Record<string, unknown>)[x.edit] = structuredClone(x.doc.source);
  S.finalAt = -1;
  S.dirty = true;
  const placed = S.tools?.placed;
  if (placed?.key === x.edit)
    placed.sync().then(() => {
      S.finalAt = -1;
      S.dirty = true;
      set({ keysRev: get().keysRev + 1 });
      invalidatePictures();
    });
};
let held = false,
  idle = 0;
const pending = new Set<number>();
const flush = () => {
  clearTimeout(idle);
  for (const f of pending) push(f);
  pending.clear();
};
export const hold = (on: boolean) => {
  held = on;
  if (!on) flush();
};
const changed = (f: number, previous?: TimedProjection<object>) => {
  if (held) {
    pending.add(f);
    clearTimeout(idle);
    idle = window.setTimeout(flush, 250);
  } else push(f);
  rows = files.flatMap((y, g) =>
    y.doc.data
      ? keyRows(y.doc.data).map((path: string[]) => ({
          f: g,
          path,
          id: rowId(g, path),
          label: labelOf(path),
        }))
      : [],
  );
  const picks = get().keyPicks;
  const clock = clockForTimeline(`keys/${f}`);
  const live = picks.flatMap((pick) => {
    if (!previous || pick.f !== f) return keyOf(pick) ? [pick] : [];
    const before = listAt(previous.data, pick.path);
    const key = before[pick.i];
    if (!key) return [];
    const source = key.__timing?.source ?? previous.clock.sourceAt(key.t, "after");
    const sameSource = (candidate: Key, basis: typeof clock) =>
      Math.abs((candidate.__timing?.source ?? basis.sourceAt(candidate.t, "after")) - source) <
      1e-7;
    const occurrence = before
      .slice(0, pick.i)
      .filter((candidate) => sameSource(candidate, previous.clock)).length;
    const matchingIndices = keysOf(f, pick.path).flatMap((candidate, i) =>
      sameSource(candidate, clock) ? [i] : [],
    );
    const i = matchingIndices[occurrence];
    return i === undefined ? [] : [{ ...pick, i }];
  });
  if (live.length !== picks.length || live.some((pick, i) => pick.i !== picks[i].i))
    set({ keyPicks: live });
  bump();
};

const lengths = (d: unknown) =>
  d
    ? keyRows(d)
        .map((p: string[]) => `${p.join(".")}:${listAt(d, p).length}`)
        .join()
    : "";
const replaced = (f: number, was: unknown) => {
  const picks = get().keyPicks;
  if (picks.some((p) => p.f === f) && lengths(was) !== lengths(files[f].doc.data))
    set({ keyPicks: picks.filter((p) => p.f !== f) });
};
let initFiles: Promise<void> | null = null,
  filesLoaded = false;
const ensureFiles = () => {
  if (filesLoaded) return Promise.resolve();
  return (initFiles ??= (async () => {
    const r = await getFile("/api/keys");
    const list: { file: string; edit: string; requiredRows: string[][] }[] = r.ok
      ? await r.json()
      : [];
    files = list.map((x, f) => ({
      ...x,
      doc: createTimedDoc<object>(`keys/${f}`, {
        label: x.file.split("/").pop()!,
        changed: (previous) => changed(f, previous),
        received: (before, after) => {
          if (!get().aiActivity) return;
          const changed = rowsOf(f).filter(
            (row) => !equalJson(rowAt(before, row.path), rowAt(after, row.path)),
          );
          lightEdit("keys", [`keys-file:${f}`, ...changed.map((row) => `keys-row:${row.id}`)]);
          if (x.edit !== S.tools?.placed?.key) return;
          const oldObjects = before as Record<string, unknown>;
          const newObjects = after as Record<string, unknown>;
          const names = Object.keys(newObjects).filter(
            (name) => !equalJson(oldObjects[name], newObjects[name]),
          );
          lightEdit(
            "objects",
            names.map((name) => `object:${name}`),
          );
        },
        saved: (keysSaved) => set({ keysSaved }),
        replaced: (was) => replaced(f, was),
      }),
    }));
    if (r.ok) filesLoaded = true;
  })().finally(() => {
    initFiles = null;
  }));
};
export const prepareKeys = async () => {
  await ensureFiles();
  for (let f = 0; f < files.length; f++) prefetchFile(`/api/keys/${f}`);
};
export const loadKeys = async (which?: number) => {
  if (which !== undefined) {
    await files[which]?.doc.load();
    return;
  }
  await ensureFiles();
  await Promise.all(files.map((x) => x.doc.load()));
  set({ keyFiles: files.map((x) => x.file) });
};

export const pickKeys = (refs: KeyRef[]) => {
  const p = S.tools?.placed,
    pf = p ? files.findIndex((x) => x.edit === p.key) : -1;
  const own =
    refs.length > 0 &&
    refs.every(
      (r) =>
        r.f === pf && r.path.length === 2 && r.path[1] === "keys" && r.path[0] === refs[0].path[0],
    );
  set(
    transitionSelection(
      { kind: "keys", refs, ownObject: own ? refs[0].path[0] : null },
      get().side,
    ),
  );
  S.dirty = true;
};

const editRefs = (refs: KeyRef[], change: (r: KeyRef, ks: Key[]) => void) =>
  together(() => {
    for (const f of new Set(refs.map((r) => r.f)))
      files[f].doc.edit((data) => {
        for (const r of refs.filter((x) => x.f === f)) change(r, listAt(data, r.path));
      });
  });
export const room = (refs: KeyRef[]): [number, number] => {
  let lo = -Infinity,
    hi = Infinity;
  for (const r of refs) {
    const ks = keysOf(r.f, r.path),
      t = ks[r.i].t;
    lo = Math.max(lo, -t);
    for (let j = r.i - 1; j >= 0; j--)
      if (!refs.some((p) => sameKey(p, { ...r, i: j }))) {
        lo = Math.max(lo, ks[j].t - t);
        break;
      }
    for (let j = r.i + 1; j < ks.length; j++)
      if (!refs.some((p) => sameKey(p, { ...r, i: j }))) {
        hi = Math.min(hi, ks[j].t - t);
        break;
      }
  }
  return [lo, hi];
};
export const shift = (refs: KeyRef[], d: number, change = editRefs) => {
  const [lo, hi] = room(refs),
    by = Math.max(lo, Math.min(hi, d));
  change(refs, (r, ks) => {
    ks[r.i].t = r3(ks[r.i].t + by);
  });
  return by;
};
export const preview = (refs: KeyRef[], change: (r: KeyRef, ks: Key[]) => void) => {
  for (const f of new Set(refs.map((r) => r.f)))
    files[f].doc.preview((data) => {
      for (const r of refs.filter((x) => x.f === f)) change(r, listAt(data, r.path));
    });
};
export type CopiedKey = { f: number; path: string[]; k: Key };
export const pasteKeys = (items: CopiedKey[], d: number) => {
  const live = items
    .filter(({ f, path }) => {
      const row = rowAt(files[f]?.doc.data, path);
      return Array.isArray(row) && row.every(isTimedKey);
    })
    .map(({ f, path, k }) => {
      const { __timing: _, ...fields } = structuredClone(k);
      return { f, path, k: { ...fields, t: r3(Math.max(0, k.t + d)) } };
    });
  if (!live.length) {
    say("Nothing pasted: the copied keyframe tracks are unavailable");
    return;
  }
  together(() => {
    for (const f of new Set(live.map((x) => x.f)))
      files[f].doc.edit((data) => {
        const batches = new Map<Key[], Key[]>();
        for (const { path, k } of live.filter((x) => x.f === f)) {
          const existing = rowAt(data, path) as Key[];
          const incoming = batches.get(existing) ?? [];
          incoming.push(k);
          batches.set(existing, incoming);
        }
        for (const [existing, incoming] of batches) {
          const targets = pasteTargets(existing, incoming);
          targets.forEach((i, j) => {
            if (i >= 0) existing[i] = incoming[j];
            else existing.push(incoming[j]);
          });
          existing.sort((a, b) => a.t - b.t);
        }
      });
  });
  const selected = new Set<Key>();
  pickKeys(
    live.flatMap(({ f, path, k }) => {
      const row = keysOf(f, path);
      const i = row.findIndex((key) => Math.abs(key.t - k.t) < 1e-6 && !selected.has(key));
      if (i < 0) return [];
      selected.add(row[i]);
      return [{ f, path, i }];
    }),
  );
  say(`${live.length} key${live.length > 1 ? "s" : ""} pasted at ${stamp(S.t)}`);
};
export const snapshot = () => files.map((x) => x.doc.snapshot());
export const restore = (snaps: string[]) => snaps.forEach((s, f) => files[f].doc.restore(s));
export const editKeys = editRefs;

export const setField = (r: KeyRef, field: string, v: unknown) =>
  editRefs([r], (x, ks) => {
    if (v === undefined) delete ks[x.i][field];
    else ks[x.i][field] = v;
  });
export const removeKeys = (refs: KeyRef[]) => {
  if (!refs.length) return;
  const keep = rows.filter(
    (row) =>
      (isSingleKeyRow(row.f, row.path) ||
        (files[row.f].edit === "placed" && row.path.length === 2 && row.path[1] === "keys") ||
        files[row.f].requiredRows.some((path) => path.join(".") === row.path.join("."))) &&
      keysOf(row.f, row.path).every((_, i) => refs.some((r) => sameKey(r, { ...row, i }))),
  );
  const removed = refs.filter((r) => !keep.some((row) => sameKey(r, { ...row, i: 0 })));
  const message = keep.length ? `Kept the base key in ${keep.map((r) => r.label).join(", ")}` : "";
  if (!removed.length) {
    say(message);
    return;
  }
  editRefs(
    [...removed].sort((a, b) => b.i - a.i),
    (r, ks) => {
      ks.splice(r.i, 1);
    },
  );
  pickKeys([]);
  say(
    `${removed.length === 1 ? "Keyframe" : `${removed.length} keyframes`} deleted. ${message ? `${message}. ` : ""}Ctrl+Z to undo`,
  );
};
export const addKeyAt = (f: number, path: string[], t: number) => {
  if (isSingleKeyRow(f, path)) {
    say(`${path.join(".")} is a single event: drag or edit its time instead`);
    return;
  }
  const ks = keysOf(f, path),
    at = ks.findIndex((k) => k.t > t),
    from = ks[(at < 0 ? ks.length : at) - 1] ?? ks[0];
  if (!from) return;
  const i = at < 0 ? ks.length : at;
  editRefs([{ f, path, i }], (_, list) => {
    list.splice(i, 0, { ...structuredClone(from), t: r3(t) });
  });
  pickKeys([{ f, path, i }]);
  say(`Keyframe added to ${path.join(".")} at ${stamp(t)}, copied from the one before`);
};
