import {
  cloneLightsState,
  DEFAULT_LIGHTS,
  LIGHT_PRESETS,
  type LightKey,
  type LightPresetId,
  lightsAt,
  type LightsDoc,
  type LightsState,
  normalizeLightsDoc,
  type PracticalState,
} from "film-stage/lights-meta";
import { EDIT } from "film/edit";

import { clockForTimeline } from "../../src/timing-state.mjs";
import { frameAt, segmentAt, visibleOutputAt } from "../../src/timing.mjs";
import { lightEdit } from "../activity/activity";
import { S } from "../core/state";
import { get, invalidatePictures, say, set } from "../core/store";
import { r3, SAME, stamp } from "../core/time";
import { createTimedDoc } from "../core/timed-doc";
import { seek } from "../playback/transport";

export type LightsFile = LightsDoc | LightKey[];

type ProjectedLightKey = LightKey & { __timing?: { source: number; output: number } };

let keysCache: ProjectedLightKey[] = [];

const emptyDoc = (): LightsDoc => ({ keys: [] });

function asDoc(data: LightsFile | null | undefined): LightsDoc {
  return data ? normalizeLightsDoc(data) : emptyDoc();
}

function writeKeys(draft: LightsFile, keys: LightKey[]) {
  const sorted = [...keys].sort((a, b) => a.t - b.t || Number(!!a.cut) - Number(!!b.cut));
  if (Array.isArray(draft)) {
    draft.splice(0, draft.length, ...sorted);
  } else {
    draft.keys = sorted;
  }
}

const changed = () => {
  const data = lightsDoc.data;
  keysCache = asDoc(data).keys;
  (EDIT as Record<string, unknown>).lights = structuredClone(lightsDoc.source ?? emptyDoc());
  S.dirty = true;
  S.finalAt = -1;
  invalidatePictures();
  const { lightsRev } = get();
  set({
    lights: data !== null,
    lightsRev: lightsRev + 1,
  });
};

export const lightsDoc = createTimedDoc<LightsFile>("lights", {
  label: "lighting",
  changed,
  received: () => lightEdit("light"),
  saved: (lightsSaved) => set({ lightsSaved }),
});

export const { edit, preview, snapshot, restore } = lightsDoc;

export const loadLights = async () => {
  const ok = !!(await lightsDoc.load());
  set({ lights: ok });
};

export const lightKeys = (): LightKey[] => keysCache;

export const lightsDocAdapter = {
  snapshot,
  restore,
};

const heldLightSourceAt = (t: number): number | null => {
  const clock = clockForTimeline("lights");
  const segment = segmentAt(clock, t);
  return segment?.kind === "freeze" && !segment.blank ? frameAt(clock, t) : null;
};

export function editTimeAt(t = S.t): number {
  const clock = clockForTimeline("lights");
  const source = heldLightSourceAt(t);
  if (source === null) return t;
  return visibleOutputAt(clock, source) ?? t;
}

export function findLightKeyAt(t = S.t) {
  const time = editTimeAt(t);
  const heldSource = heldLightSourceAt(t);
  const ks = keysCache;
  let exactIndex: number | null = null;
  let prev: number | null = null;
  let next: number | null = null;

  for (let i = 0; i < ks.length; i++) {
    const dt = ks[i].t - time;
    if (heldSource !== null) {
      const source = ks[i].__timing?.source ?? ks[i].t;
      if (
        Math.abs(source - heldSource) < 1e-6 &&
        (exactIndex === null || ks[i].cut || !ks[exactIndex].cut)
      ) {
        exactIndex = i;
      }
    } else if (Math.abs(dt) <= SAME) {
      exactIndex = i;
    }
    if (dt < -SAME) {
      prev = i;
    } else if (dt > SAME && next === null) {
      next = i;
    }
  }
  const activeIndex = exactIndex ?? prev ?? (ks.length > 0 ? 0 : null);
  return { exactIndex, activeIndex, prev, next };
}

export function lightsSampleAt(t = S.t): LightsState {
  const source = lightsDoc.source;
  if (source) return lightsAt(source, frameAt(clockForTimeline("lights"), t));
  return lightsAt(lightsDoc.data, t);
}

export function goLightKey(index: number | null) {
  if (index === null || !keysCache[index]) return;
  seek(keysCache[index].t);
}

function keyFromState(
  t: number,
  state: LightsState,
  prev?: LightKey,
  clearPreset = false,
): LightKey {
  const clean = cloneLightsState(state);
  const docTarget = asDoc(lightsDoc.data).target;
  const sameDocTarget =
    !!docTarget &&
    !!clean.target &&
    clean.target[0] === docTarget[0] &&
    clean.target[1] === docTarget[1] &&
    clean.target[2] === docTarget[2];
  const keepTarget = !!clean.target && (prev?.target !== undefined || !sameDocTarget);
  const out: LightKey = {
    ...prev,
    id: prev?.id ?? crypto.randomUUID(),
    t: prev?.t ?? r3(t),
    ...(keepTarget ? { target: clean.target } : {}),
    key: clean.key,
    fill: clean.fill,
    rim: clean.rim,
    world: clean.world,
    fog: clean.fog,
    practicals: clean.practicals,
    godrays: clean.godrays,
  };
  if (!keepTarget) delete out.target;
  if (clearPreset) delete out.preset;
  return out;
}

function newLightKeyAt(t: number, state: LightsState, clearPreset = false): ProjectedLightKey {
  const key: ProjectedLightKey = keyFromState(editTimeAt(t), state, undefined, clearPreset);
  const source = heldLightSourceAt(t);
  if (source !== null) key.__timing = { source, output: key.t };
  return key;
}

/** Add a lighting keyframe at `t` holding the current evaluated lighting state. */
export function addLightKeyAt(t = S.t) {
  if (findLightKeyAt(t).exactIndex !== null) return;
  const key = newLightKeyAt(t, lightsSampleAt(t));
  lightsDoc.edit((draft) => {
    writeKeys(draft, [...asDoc(draft).keys, key]);
  });
  say(`Added lighting key at ${stamp(key.t)}`);
}

/** Snapshot evaluated/edited state onto an existing keyframe or insert at `t`. */
export function mutateLightAt(
  t: number,
  mutate: (state: LightsState, key: LightKey) => void,
  keep = true,
  clearPreset = true,
) {
  const run = keep ? lightsDoc.edit : lightsDoc.preview;
  const nav = findLightKeyAt(t);
  const baseState = lightsSampleAt(t);

  run((draft) => {
    const ks = [...asDoc(draft).keys];
    if (nav.exactIndex !== null && ks[nav.exactIndex]) {
      const targetKey = { ...ks[nav.exactIndex] };
      const nextState = cloneLightsState(baseState);
      mutate(nextState, targetKey);
      ks[nav.exactIndex] = keyFromState(targetKey.t, nextState, targetKey, clearPreset);
    } else {
      const nextState = cloneLightsState(baseState);
      const nextKey = newLightKeyAt(t, nextState, clearPreset);
      mutate(nextState, nextKey);
      ks.push(keyFromState(nextKey.t, nextState, nextKey, clearPreset));
    }
    writeKeys(draft, ks);
  });
}

export function removeLightKeyAt(index: number | null) {
  if (index === null || !keysCache[index]) return;
  const removedT = keysCache[index].t;
  lightsDoc.edit((draft) => {
    const ks = [...asDoc(draft).keys];
    ks.splice(index, 1);
    writeKeys(draft, ks);
  });
  say(`Deleted lighting key at ${stamp(removedT)}`);
}

/** Update an existing keyframe's values from the current evaluated state at `t`. */
export function updateLightKey(index: number | null, t = S.t) {
  if (index === null || !keysCache[index]) return;
  const here = lightsSampleAt(t);
  lightsDoc.edit((draft) => {
    const ks = [...asDoc(draft).keys];
    const targetKey = ks[index];
    if (!targetKey) return;
    ks[index] = keyFromState(targetKey.t, here, targetKey, true);
    writeKeys(draft, ks);
  });
  say(`Updated lighting key at ${stamp(keysCache[index]?.t ?? t)}`);
}

export function applyLightPresetAt(presetId: LightPresetId, t = S.t) {
  const preset = LIGHT_PRESETS[presetId];
  if (!preset) return;
  const nav = findLightKeyAt(t);
  const existing = lightsSampleAt(t);
  const mergedState: LightsState = {
    ...cloneLightsState(preset.state),
    practicals: structuredClone(existing.practicals),
    ...(existing.target ? { target: [...existing.target] } : {}),
  };
  lightsDoc.edit((draft) => {
    const ks = [...asDoc(draft).keys];
    const prevKey = nav.exactIndex !== null ? ks[nav.exactIndex] : undefined;
    const presetKey: LightKey = {
      ...(prevKey ? keyFromState(prevKey.t, mergedState, prevKey) : newLightKeyAt(t, mergedState)),
      preset: presetId,
    };
    if (nav.exactIndex !== null) ks[nav.exactIndex] = presetKey;
    else ks.push(presetKey);
    writeKeys(draft, ks);
  });
  say(`Applied ${preset.title} lighting preset`);
}

export function setLightCut(t: number, cut: boolean) {
  mutateLightAt(
    t,
    (_s, key) => {
      if (cut) key.cut = true;
      else delete key.cut;
    },
    true,
    false,
  );
}

export function addPractical(kind: "point" | "spot", t = S.t) {
  const sample = lightsSampleAt(t);
  const idx = (sample.practicals.length ?? 0) + 1;
  const target = sample.target ?? asDoc(lightsDoc.data).target ?? [0, 1.5, 0];
  const next: PracticalState = {
    id: `${kind}-${crypto.randomUUID().slice(0, 8)}`,
    name: `${kind === "spot" ? "Spot" : "Point"} ${idx}`,
    kind,
    at: [r3(target[0] + 1), r3(target[1] + 1.5), r3(target[2] + 1)],
    ...(kind === "spot"
      ? {
          target: [r3(target[0]), r3(target[1]), r3(target[2])] as [number, number, number],
          angle: 42,
          penumbra: 0.4,
        }
      : {}),
    color: "#ffd099",
    intensity: 4,
    distance: 10,
    decay: 2,
    flicker: false,
  };
  mutateLightAt(t, (s) => {
    s.practicals.push(next);
  });
}

export function removePractical(id: string, t = S.t) {
  mutateLightAt(t, (s) => {
    s.practicals = s.practicals.filter((p) => p.id !== id);
  });
}

export function resetLightSection(section: keyof Omit<LightsState, "target">, t = S.t) {
  mutateLightAt(t, (s) => {
    if (section === "practicals") s.practicals = [];
    else if (section === "key") s.key = { ...DEFAULT_LIGHTS.key };
    else if (section === "fill") s.fill = { ...DEFAULT_LIGHTS.fill };
    else if (section === "rim") s.rim = { ...DEFAULT_LIGHTS.rim };
    else if (section === "world") s.world = { ...DEFAULT_LIGHTS.world };
    else if (section === "fog") s.fog = { ...DEFAULT_LIGHTS.fog };
    else if (section === "godrays") s.godrays = { ...DEFAULT_LIGHTS.godrays };
  });
}
