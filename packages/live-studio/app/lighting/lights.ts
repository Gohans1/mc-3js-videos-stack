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

import { lightEdit } from "../activity/activity";
import { S } from "../core/state";
import { get, invalidatePictures, say, set } from "../core/store";
import { r3, SAME, stamp } from "../core/time";
import { createTimedDoc } from "../core/timed-doc";
import { seek } from "../playback/transport";

export type LightsFile = LightsDoc | LightKey[];

let keysCache: LightKey[] = [];

const emptyDoc = (): LightsDoc => ({ keys: [] });

function asDoc(data: LightsFile | null | undefined): LightsDoc {
  return data ? normalizeLightsDoc(data) : emptyDoc();
}

function writeKeys(draft: LightsFile, keys: LightKey[]) {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
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
  const { lightsRev, lightKey } = get();
  set({
    lights: data !== null,
    lightsRev: lightsRev + 1,
    ...(lightKey !== null && !keysCache[lightKey] ? { lightKey: null } : {}),
  });
};

export const lightsDoc = createTimedDoc<LightsFile>("lights", {
  label: "lighting",
  changed,
  received: () => lightEdit("light"),
  saved: (lightsSaved) => set({ lightsSaved }),
  replaced: () => {
    const idx = findLightKeyAt(S.t).exactIndex;
    set({ lightKey: idx });
  },
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

export function findLightKeyAt(t = S.t) {
  const ks = keysCache;
  let exactIndex: number | null = null;
  let prev: number | null = null;
  let next: number | null = null;

  for (let i = 0; i < ks.length; i++) {
    const dt = ks[i].t - t;
    if (Math.abs(dt) <= SAME) {
      exactIndex = i;
    } else if (dt < -SAME) {
      prev = i;
    } else if (dt > SAME && next === null) {
      next = i;
    }
  }
  const activeIndex = exactIndex ?? prev ?? (ks.length > 0 ? 0 : null);
  return { exactIndex, activeIndex, prev, next };
}

export function lightsSampleAt(t = S.t): LightsState {
  return lightsAt(lightsDoc.data, t);
}

export function goLightKey(index: number | null) {
  if (index === null || !keysCache[index]) return;
  set({ lightKey: index });
  seek(keysCache[index].t);
}

function keyFromState(t: number, state: LightsState, prev?: LightKey): LightKey {
  const clean = cloneLightsState(state);
  return {
    id: prev?.id ?? crypto.randomUUID(),
    t: r3(t),
    ...(prev?.cut ? { cut: true } : {}),
    ...(prev?.ease !== undefined ? { ease: prev.ease } : {}),
    key: clean.key,
    fill: clean.fill,
    rim: clean.rim,
    world: clean.world,
    fog: clean.fog,
    practicals: clean.practicals,
    godrays: clean.godrays,
  };
}

/** Add a lighting keyframe at `t` holding the current evaluated lighting state. */
export function addLightKeyAt(t = S.t) {
  const existing = findLightKeyAt(t);
  if (existing.exactIndex !== null) return;
  const here = lightsAt(lightsDoc.data, t);
  const time = r3(t);
  lightsDoc.edit((draft) => {
    const ks = [...asDoc(draft).keys, keyFromState(time, here)];
    writeKeys(draft, ks);
  });
  set({ lightKey: findLightKeyAt(time).exactIndex });
  say(`Added lighting key at ${stamp(time)}`);
}

/** Snapshot evaluated/edited state onto an existing keyframe or insert at `t`. */
export function mutateLightAt(
  t: number,
  mutate: (state: LightsState, key: LightKey) => void,
  keep = true,
) {
  const run = keep ? lightsDoc.edit : lightsDoc.preview;
  const nav = findLightKeyAt(t);
  const baseState = lightsAt(lightsDoc.data, t);
  const time = r3(t);

  run((draft) => {
    const ks = [...asDoc(draft).keys];
    if (nav.exactIndex !== null && ks[nav.exactIndex]) {
      const targetKey = ks[nav.exactIndex];
      const nextState = cloneLightsState(baseState);
      mutate(nextState, targetKey);
      ks[nav.exactIndex] = {
        ...targetKey,
        ...keyFromState(targetKey.t, nextState, targetKey),
      };
    } else {
      const nextState = cloneLightsState(baseState);
      const nextKey = keyFromState(time, nextState);
      mutate(nextState, nextKey);
      ks.push({ ...nextKey, ...keyFromState(time, nextState, nextKey) });
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
  set({ lightKey: null });
  say(`Deleted lighting key at ${stamp(removedT)}`);
}

/** Update an existing keyframe's values from the current evaluated state at `t`. */
export function updateLightKey(index: number | null, t = S.t) {
  if (index === null || !keysCache[index]) return;
  const here = lightsAt(lightsDoc.data, t);
  lightsDoc.edit((draft) => {
    const ks = [...asDoc(draft).keys];
    const targetKey = ks[index];
    if (!targetKey) return;
    ks[index] = {
      ...targetKey,
      ...keyFromState(targetKey.t, here, targetKey),
    };
    writeKeys(draft, ks);
  });
  say(`Updated lighting key at ${stamp(keysCache[index]?.t ?? t)}`);
}

export function applyLightPresetAt(presetId: LightPresetId, t = S.t) {
  const preset = LIGHT_PRESETS[presetId];
  if (!preset) return;
  const nav = findLightKeyAt(t);
  const time = r3(t);
  lightsDoc.edit((draft) => {
    const ks = [...asDoc(draft).keys];
    const prevKey = nav.exactIndex !== null ? ks[nav.exactIndex] : undefined;
    const presetKey: LightKey = {
      ...keyFromState(prevKey ? prevKey.t : time, preset.state, prevKey),
      preset: presetId,
    };
    if (nav.exactIndex !== null) ks[nav.exactIndex] = presetKey;
    else ks.push(presetKey);
    writeKeys(draft, ks);
  });
  say(`Applied ${preset.title} lighting preset`);
}

export function setLightCut(t: number, cut: boolean) {
  mutateLightAt(t, (_s, key) => {
    if (cut) key.cut = true;
    else delete key.cut;
  });
}

export function addPractical(kind: "point" | "spot", t = S.t) {
  const idx = (lightsSampleAt(t).practicals.length ?? 0) + 1;
  const target = asDoc(lightsDoc.data).target ?? [0, 1.5, 0];
  const next: PracticalState = {
    id: `${kind}-${Date.now().toString(36)}-${idx}`,
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
