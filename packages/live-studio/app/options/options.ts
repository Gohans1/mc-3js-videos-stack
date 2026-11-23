import { EDIT, fromSource } from "film/edit";
import type { Variant } from "film/scene";

import { SMALL_SOUND } from "../core/device";
import { getFile, postJson } from "../core/net";
import { S } from "../core/state";
import { stored } from "../core/storage";
import { get, invalidatePictures, say, set } from "../core/store";
import { FPS } from "../core/time";
import { filmFeatures } from "../picture/frame";
import {
  addPlayer,
  getAudio,
  getAudioCtx,
  hasAudio,
  restart,
  resumeAudio,
  track,
  type Window,
} from "../sound/clock";
import { type ChipView, type GroupView } from "./slice";

interface SoundOption {
  id: string;
  title: string;
  files?: string[];
  source?: string;
  buffers?: AudioBuffer[];
  loading?: Promise<void>;
  level?: number;
  scale?: number;
  plain?: boolean;
  off?: boolean;
}
interface Cue {
  at: number;
  pick: number;
  rate: number;
  gain: number;
}
interface Group {
  title: string;
  kind?: "stem" | "picture" | "lane";
  from?: number;
  to?: number;
  cues?: Cue[];
  variant?: Variant;
  options: SoundOption[];
  chosen: { set: string; gain?: number } | null;
  spans?: [number, number][];
  audition?: () => void;
}
export interface LaneGroup {
  title: string;
  options: SoundOption[];
  spans: [number, number][];
  audition: () => void;
}
interface Pick {
  set: string;
  gain: number;
}

const OFF: SoundOption = { id: "off", title: "Off", off: true };
const letter = (i: number) => String.fromCharCode(65 + i);
export const optionLabel = (o: { off?: boolean }, i: number) => (o.off ? OFF.title : letter(i));

let trials: Record<string, Group> = {},
  fromFiles: Record<string, Group> = {},
  lanes: Record<string, LaneGroup> = {},
  chosen: Record<string, Pick> = {};
const picked: Record<string, Pick> = JSON.parse(stored.get("picked", sessionStorage) ?? "{}");
let stems: Record<string, AudioBufferSourceNode | null> = {};

const pickOf = (name: string): Pick =>
  picked[name] ?? {
    set: trials[name].chosen?.set ?? trials[name].options[0].id,
    gain: trials[name].chosen?.gain ?? 1,
  };
export const lanePick = (name: string): Pick | null => (trials[name] ? pickOf(name) : null);
const optionOf = (name: string) =>
  trials[name].options.find((o) => o.id === pickOf(name).set) ?? trials[name].options[0];
const chosenOf = (name: string) => trials[name].chosen?.set ?? trials[name].options[0].id;
export const rangesOf = (name: string): [number, number][] => {
  const g = trials[name];
  if (g.kind === "picture") return g.variant!.ranges;
  if (g.kind === "stem") return [[g.from!, g.to!]];
  if (g.kind === "lane") return g.spans!;
  return (g.cues ?? []).map((c) => {
    const o = fromSource(c.at);
    return [o, o];
  });
};

const loadOption = (o: SoundOption) =>
  o.files
    ? (o.loading ??= Promise.all(
        o.files.map(async (f) =>
          getAudioCtx().decodeAudioData(await (await getFile(f)).arrayBuffer()),
        ),
      ).then((b) => {
        o.buffers = b;
      }))
    : Promise.resolve();
const playHit = (name: string, cue: Cue, when: number, speed: number) => {
  const o = optionOf(name),
    buf = o.buffers?.[cue.pick % o.buffers.length];
  if (o.off) return;
  if (!buf) {
    loadOption(o);
    return;
  }
  const { ctx, master } = getAudio(),
    src = ctx.createBufferSource(),
    g = ctx.createGain();
  src.buffer = buf;
  src.playbackRate.value = (o.plain ? 1 : cue.rate) * speed;
  g.gain.value = (o.level ?? 1) * (o.scale ?? 1) * (o.plain ? 1 : cue.gain) * pickOf(name).gain;
  src.connect(g).connect(master);
  src.start(when);
  track(src);
  const audio = S.el.audio;
  window.__hits = {
    n: (window.__hits?.n ?? 0) + 1,
    set: o.id,
    at: cue.at,
    late: +(cue.at - (audio.currentTime + (when - ctx.currentTime) * audio.playbackRate)).toFixed(
      4,
    ),
  };
};
const playStem = (name: string, when: number, offset: number, speed: number, length?: number) => {
  const o = optionOf(name),
    buf = o.buffers?.[0];
  if (o.off) return null;
  if (!buf) {
    loadOption(o);
    return null;
  }
  const { ctx, master } = getAudio(),
    src = ctx.createBufferSource(),
    g = ctx.createGain(),
    v = pickOf(name).gain;
  src.buffer = buf;
  src.playbackRate.value = speed;
  g.gain.value = v;
  if (length) {
    g.gain.setValueAtTime(v, when + length - 0.08);
    g.gain.linearRampToValueAtTime(0, when + length);
  }
  src.connect(g).connect(master);
  if (length) src.start(when, offset, length);
  else src.start(when, offset);
  track(src);
  window.__stems = { ...window.__stems, [name]: { set: o.id, offset: +offset.toFixed(3) } };
  return src;
};
const soundFiles: Record<string, { buf: AudioBuffer; scale: number }> = {};
let soundsJob: Promise<void> | null = null;
export const ensureBeatSounds = () => (soundsJob ??= loadSounds());
export const loadSounds = async () => {
  const names = new Set(Object.values(EDIT.beats).flatMap((b) => b.sounds.map((s) => s[1])));
  if (!names.size) return;
  const ctx = getAudioCtx();
  await Promise.all(
    [...names].map(async (n) => {
      if (soundFiles[n]) return;
      const small = SMALL_SOUND ? await getFile(`/lite/agent/sfx2/${n}.webm`) : null;
      const buf = await ctx.decodeAudioData(
        await (small?.ok ? small : await getFile(`/agent/sfx2/${n}.wav`)).arrayBuffer(),
      );
      let peak = 1e-6;
      for (const v of buf.getChannelData(0)) if (Math.abs(v) > peak) peak = Math.abs(v);
      soundFiles[n] = { buf, scale: 0.9 / peak };
    }),
  );
};
const playSound = (name: string, v: number, when: number, speed: number) => {
  const f = soundFiles[name];
  if (!f) {
    void ensureBeatSounds();
    return;
  }
  const { ctx, master } = getAudio(),
    src = ctx.createBufferSource(),
    g = ctx.createGain();
  src.buffer = f.buf;
  src.playbackRate.value = speed;
  g.gain.value = v * f.scale;
  src.connect(g).connect(master);
  src.start(when);
  track(src);
  window.__sounds = (window.__sounds ?? 0) + 1;
};

addPlayer({
  reset: () => {
    stems = {};
  },
  tick: ({ now, speed, until, due, when }: Window) => {
    for (const name in trials) {
      const g = trials[name];
      if (g.cues) {
        for (const c of g.cues) {
          const at = Math.round(fromSource(c.at) * FPS) / FPS;
          if (due(at)) playHit(name, c, when(at), speed);
        }
      } else if (g.kind === "stem" && !stems[name] && g.from! < until && now < g.to!) {
        const at = Math.max(now, g.from!);
        stems[name] = playStem(name, when(at), at - g.from!, speed);
      }
    }
    for (const b of Object.values(EDIT.beats))
      for (const [off, name, v] of b.sounds) {
        const at = Math.round(fromSource(b.at + off) * FPS) / FPS;
        if (due(at)) playSound(name, v, when(at), speed);
      }
  },
});

const publish = () => {
  const groups: GroupView[] = Object.keys(trials).map((name) => {
    const g = trials[name],
      p = pickOf(name);
    return {
      name,
      title: g.title,
      picture: g.kind === "picture",
      options: g.options.map((o) => ({ id: o.id, title: o.title, source: o.source, off: o.off })),
      chosen: chosenOf(name),
      pick: p.set,
      gain: p.gain,
      ranges: rangesOf(name),
    };
  });
  const { groupName } = get();
  set({
    groups,
    groupName: groupName && trials[groupName] ? groupName : (groups[0]?.name ?? null),
  });
  chipKey = "";
  S.dirty = true;
};
const SOON = 2,
  LATE = 0.5;
let chipKey = "";
export const followChips = () => {
  const { tryOn } = get();
  if (!tryOn) {
    if (chipKey === "[]") return;
    chipKey = "[]";
    set({ chips: [] });
    return;
  }
  const near: ChipView[] = Object.keys(trials).flatMap((name) => {
    const r = rangesOf(name).find(([a, b]) => b >= S.t - LATE && a <= S.t + SOON);
    return r ? [{ name, range: r }] : [];
  });
  const key = near.length ? JSON.stringify(near) : "[]";
  if (key === chipKey) return;
  chipKey = key;
  set({ chips: near });
};
export const optionRanges = () => {
  const { groupName } = get();
  return groupName && trials[groupName] ? rangesOf(groupName) : [];
};

const setPicked = (name: string, change: Partial<Pick>) => {
  picked[name] = { ...pickOf(name), ...change };
  stored.set("picked", JSON.stringify(picked), sessionStorage);
  const g = trials[name];
  if (g.kind === "picture") {
    g.variant!.set(pickOf(name).set);
    S.finalAt = -1;
    S.dirty = true;
    invalidatePictures();
  } else restart();
  publish();
};
export const choose = (name: string, i: number) => {
  const g = trials[name],
    o = g?.options[i];
  if (!o) return;
  resumeAudio();
  setPicked(name, { set: o.id });
  say(o.off ? `${g.title}: off` : `${g.title}: ${letter(i)} ${o.title}`);
  if (g.kind === "picture" || o.off) return;
  if (g.kind === "lane") {
    if (!S.playing) g.audition?.();
    return;
  }
  loadOption(o).then(() => {
    if (S.playing) return;
    const ctx = getAudioCtx();
    if (g.cues?.length)
      playHit(name, g.cues[Math.floor(Math.random() * g.cues.length)], ctx.currentTime, 1);
    else if (g.kind === "stem") {
      const len = Math.min(2.5, g.to! - g.from!);
      playStem(
        name,
        ctx.currentTime,
        Math.min(Math.max(0, S.t - g.from!), g.to! - g.from! - len),
        1,
        len,
      );
    }
  });
};
export const chooseInGroup = (i: number) => {
  const { groupName } = get();
  if (groupName) choose(groupName, i);
};
export const setGain = (name: string, gain: number) => setPicked(name, { gain });
export const pinPick = async (name: string) => {
  const p = pickOf(name),
    r = await postJson("/api/choose", { group: name, ...p }).catch(() => null);
  if (!r?.ok) {
    say("Not saved: the studio isn't responding. Click Use again once it's running", 6000);
    return;
  }
  trials[name].chosen = p;
  publish();
  say(`${trials[name].title}: using ${optionOf(name).title} from the next render`);
};
export const whereNext = (name: string) => {
  const r = rangesOf(name);
  if (!r.length) return null;
  return Math.max(0, (r.find(([a]) => a > S.t + 0.7) ?? r[0])[0] - 0.6);
};
const merge = () => {
  const lane = Object.fromEntries(
    Object.entries(lanes).map(([name, g]): [string, Group] => [
      name,
      { ...g, kind: "lane", options: [...g.options, { ...OFF }], chosen: chosen[name] ?? null },
    ]),
  );
  trials = { ...fromFiles, ...lane };
  publish();
};
export const warmTrialAudio = () =>
  Promise.all(Object.keys(trials).map((name) => loadOption(optionOf(name))));
export const loadTrials = async (initial = false) => {
  const has = filmFeatures();
  const [r, c] = await Promise.all([
    !initial || has.trials ? getFile("/api/trials.json") : Promise.resolve(null),
    !initial || has.choices ? getFile("/api/choices.json") : Promise.resolve(null),
  ]);
  chosen = c?.ok ? await c.json() : {};
  const sounds: Record<string, Group> = r?.ok ? await r.json() : {};
  const looks: Record<string, Group> = Object.fromEntries(
    (S.render?.variants ?? []).map((v) => [
      v.id,
      {
        title: v.title,
        kind: "picture",
        variant: v,
        options: v.off ? [...v.options, OFF] : v.options,
        chosen: chosen[v.id] ?? null,
      },
    ]),
  );
  for (const g of Object.values(sounds)) g.options.push({ ...OFF });
  for (const name in sounds) sounds[name].chosen = chosen[name] ?? null;
  fromFiles = { ...looks, ...sounds };
  merge();
  restart();
  for (const name in looks) looks[name].variant!.set(pickOf(name).set);
  if (S.playing || hasAudio()) await warmTrialAudio();
};
export const setLaneGroups = (groups: Record<string, LaneGroup>) => {
  if (JSON.stringify(groups) === JSON.stringify(lanes)) {
    lanes = groups;
    for (const n in groups) if (trials[n]) trials[n].audition = groups[n].audition;
    return;
  }
  lanes = groups;
  merge();
};
export const groupTitle = (name: string) => trials[name]?.title ?? name;
