import { SMALL_SOUND } from "../core/device";
// The sound lanes heard as they are edited, for a film with package.json "live-studio": { liveLanes: true }. Its sound.py then
// mixes without them, and this plays every bed and one-shot of the timeline file on the mix's clock the way the film's
// scripts/sound/mix.py builds them: a bed looped from..to, a one-shot from start for length, gains in dB, fades (envelope.ts),
// its filters (EQ and width, eq.ts), its track's volume, and an option picked in its place at the level of the sound it stands in for. All of it goes
// through the mix's master stage: audio.drive dB into mix.py's limiter at 0.45 (brickwall.ts), with the narration summed in before it.
// A drag is heard on the next tick, nothing is remixed. The final render still comes from mix.py.
import { DURATION } from "../core/filmMeta";
import { getFile } from "../core/net";
import { S, wake } from "../core/state";
import { get, say } from "../core/store";
import { type LaneGroup, lanePick, setLaneGroups } from "../options/options";
import brickwall from "./brickwall.worklet.ts?worker&url";
import {
  addModule,
  addPlayer,
  getAudio,
  getAudioCtx,
  hasAudio,
  onAudioReady,
  STEREO,
  track,
  type Window,
} from "./clock";
import { duckCorners, duckGain, duckWindows } from "./duck";
import { envelope, envelopePoints } from "./envelope";
import { coefficients, widthOf } from "./eq";
import { type GainKey, scheduleGain } from "./gain";
import {
  generateImpulseResponse,
  isPresetSpace,
  normalizeStereoIr,
  resolveClipReverb,
  type ResolvedReverb,
} from "./ir";
import { loopSources } from "./loop";
import {
  clearProcessed,
  loadProcessed,
  needsProcessing,
  processed,
  type ProcessSpec,
  processSpec,
  retainProcessed,
} from "./processed";
import { type ClipRef } from "./slice";
import type { Lanes, LibraryItem } from "./sound";
import {
  type CameraPose,
  computeSpatialParams,
  isSpatialActive,
  offsetPosition,
  type SpatialSpec,
  type Vec3,
} from "./spatial";

interface Source {
  lanes: () => Lanes | null;
  library: () => LibraryItem[];
  span: (c: ClipRef) => [number, number];
  voice: () => { s: number; e: number }[];
  camPose?: (t: number) => CameraPose;
  targetPos?: (name: string, t: number) => Vec3 | null;
}
interface Clip {
  key: string;
  name: string;
  t0: number;
  t1: number;
  start: number;
  length?: number;
  loop: boolean;
  db: number;
  gainKeys?: GainKey[];
  fadeIn: number;
  fadeOut: number;
  duck: number;
  pan: number;
  filters: string[];
  process?: ProcessSpec;
  reverb?: ResolvedReverb | null;
  spatial?: SpatialSpec;
}
interface Sound {
  buf: AudioBuffer;
  mean: number;
}

// Silent until the limiter's module has loaded (a moment after the page opens): an offline render waits for `ready`
const stage = (ctx: BaseAudioContext, out: AudioNode) => {
  const bus = ctx.createGain(),
    drive = ctx.createGain();
  bus.connect(drive);
  const ready = addModule(ctx, brickwall).then(() => {
    drive
      .connect(new AudioWorkletNode(ctx, "brickwall", { ...STEREO, outputChannelCount: [2] }))
      .connect(out);
  });
  return { bus, drive, ready };
};
let liveStage: ReturnType<typeof stage> | null = null,
  fromMix: GainNode | null = null,
  wantLive = false,
  unsubAudio: (() => void) | null = null;
const getLive = () => {
  if (!liveStage) {
    const { ctx, master } = getAudio();
    liveStage = stage(ctx, master);
    const l = source?.lanes();
    if (l) liveStage.drive.gain.value = 10 ** (Number(l.drive ?? 0) / 20);
  }
  return liveStage;
};

let source: Source | null = null,
  on = false,
  routed: MediaElementAudioSourceNode | null = null;
// The mix element's own volume is applied before it reaches here, and the volume after master applies it again: undone, so it
// counts once. A soloed track silences the narration as it does every other track
const levelMix = () => {
  if (!fromMix) return;
  const a = S.el.audio,
    v = a.muted ? 0 : a.volume;
  fromMix.gain.value = v > 0 && !get().solo.length ? 1 / v : 0;
};
const ensureRouting = () => {
  const { ctx, master } = getAudio();
  fromMix ??= ctx.createGain();
  // Through the page's own graph either way, so the meter hears the mix (meter.ts)
  if (!routed) {
    routed = ctx.createMediaElementSource(S.el.audio);
    routed.connect(fromMix);
  }
  // The mix goes through the master stage only while the lanes are summed with it; otherwise it already went through mix.py's
  fromMix.disconnect();
  fromMix.connect(wantLive ? getLive().bus : master);
  levelMix();
};

// ---------- The lanes' sound files, decoded once, with ffmpeg volumedetect's mean_volume for an option's level
const sounds = new Map<string, Promise<Sound | null>>(),
  ready = new Map<string, Sound>();
const load = (name: string) => {
  if (!sounds.has(name)) {
    const url = `/api/sfx/${encodeURIComponent(name)}.${SMALL_SOUND ? "webm" : "wav"}`; // anything but this machine gets Opus, a tenth of it
    sounds.set(
      name,
      getFile(url)
        .then(async (r) => {
          if (!r.ok) return null;
          const buf = await getAudioCtx().decodeAudioData(await r.arrayBuffer());
          let sum = 0,
            n = 0;
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
            n += d.length;
          }
          const s = { buf, mean: 10 * Math.log10(sum / n || 1e-12) };
          ready.set(name, s);
          return s;
        })
        .catch(() => null),
    );
  }
  return sounds.get(name)!;
};
interface RawIrData {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

const irRaw = new Map<string, RawIrData | null>();
const irPromises = new Map<string, Promise<RawIrData | null>>();
const irCtxBuffers = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
let convolversByBus = new WeakMap<AudioNode, Map<string, ConvolverNode>>();

const loadCustomIr = (space: string): Promise<RawIrData | null> => {
  if (!irPromises.has(space)) {
    irPromises.set(
      space,
      getFile(`/api/sound/ir?path=${encodeURIComponent(space)}`)
        .then(async (r) => {
          if (!r.ok) {
            irRaw.set(space, null);
            return null;
          }
          const buf = await getAudioCtx().decodeAudioData(await r.arrayBuffer());
          const ch0 = buf.getChannelData(0);
          const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
          const left = new Float32Array(ch0);
          const right = new Float32Array(ch1);
          normalizeStereoIr(left, right);
          const data = { left, right, sampleRate: buf.sampleRate };
          irRaw.set(space, data);
          return data;
        })
        .catch(() => {
          irRaw.set(space, null);
          return null;
        }),
    );
  }
  return irPromises.get(space)!;
};

const irAudioBufferFor = (ctx: BaseAudioContext, space: string): AudioBuffer | null => {
  if (typeof ctx.createBuffer !== "function") return null;
  const cacheKey = `${space}@${ctx.sampleRate}`;
  let byKey = irCtxBuffers.get(ctx);
  if (byKey?.has(cacheKey)) return byKey.get(cacheKey)!;

  let raw: RawIrData | null | undefined;
  if (isPresetSpace(space)) {
    if (space === "dry") return null;
    raw = irRaw.get(cacheKey);
    if (!raw) {
      raw = generateImpulseResponse(space, ctx.sampleRate);
      irRaw.set(cacheKey, raw);
    }
  } else {
    raw = irRaw.get(space);
    if (raw === undefined) {
      void loadCustomIr(space);
      return null;
    }
    if (!raw) return null;
  }

  const audioBuf = ctx.createBuffer(2, raw.left.length, raw.sampleRate);
  audioBuf.getChannelData(0).set(raw.left);
  audioBuf.getChannelData(1).set(raw.right);
  if (!byKey) {
    byKey = new Map();
    irCtxBuffers.set(ctx, byKey);
  }
  byKey.set(cacheKey, audioBuf);
  return audioBuf;
};

const sharedConvolver = (
  ctx: BaseAudioContext,
  bus: AudioNode,
  space: string,
): ConvolverNode | null => {
  if (typeof ctx.createConvolver !== "function") return null;
  const buf = irAudioBufferFor(ctx, space);
  if (!buf) return null;
  let bySpace = convolversByBus.get(bus);
  if (!bySpace) {
    bySpace = new Map();
    convolversByBus.set(bus, bySpace);
  }
  let conv = bySpace.get(space);
  if (!conv) {
    conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = buf;
    conv.connect(bus);
    bySpace.set(space, conv);
  }
  return conv;
};

const resetBusConvolvers = (bus: AudioNode | undefined | null) => {
  if (!bus) return;
  const bySpace = convolversByBus.get(bus);
  if (!bySpace) return;
  for (const conv of bySpace.values()) {
    try {
      conv.disconnect();
    } catch {}
  }
  convolversByBus.delete(bus);
};

// A file changed on disk (a new download): its old decode goes
export const forgetSounds = () => {
  sounds.clear();
  ready.clear();
  irRaw.clear();
  irPromises.clear();
  convolversByBus = new WeakMap();
  clearProcessed();
};
// A library sound decoded, as the lanes play it (sweeten.ts reads where its moment is)
export const decoded = (name: string) => load(name).then((s) => s?.buf ?? null);
// The mix element's own sound decoded, kept until a remix changes its URL: the meter's render and the skims play it
let mixDecoded: { url: string; buf: Promise<AudioBuffer | null> } | null = null;
const mixBuffer = () => {
  const url = S.el?.audio?.currentSrc;
  if (!url) return Promise.resolve(null);
  if (mixDecoded?.url !== url)
    mixDecoded = {
      url,
      buf: getFile(url)
        .then((r) => r.arrayBuffer())
        .then((b) => getAudioCtx().decodeAudioData(b))
        .catch(() => null),
    };
  return mixDecoded.buf;
};

// ---------- mix.py's ffmpeg filters as the same difference equations (eq.ts), and extrastereo as its mid/side scale:
// L' = M + m S, R' = M - m S, so L' = (1+m)/2 L + (1-m)/2 R. A filter with no exact preview is skipped with a note
const warned = new Set<string>();
const attach = (ctx: BaseAudioContext, from: AudioNode, spec: string): AudioNode => {
  const sections = coefficients(spec, ctx.sampleRate),
    m = widthOf(spec);
  if (sections)
    return sections.reduce<AudioNode>(
      (tail, { b, a }) => tail.connect(ctx.createIIRFilter(b, a)),
      from,
    );
  if (m !== null) {
    const up = ctx.createGain(),
      split = ctx.createChannelSplitter(2),
      merge = ctx.createChannelMerger(2);
    up.channelCount = 2;
    up.channelCountMode = "explicit"; // a mono file reaches both sides, as after mix.py's aformat
    from.connect(up).connect(split);
    for (const [side, to, k] of [
      [0, 0, (1 + m) / 2],
      [0, 1, (1 - m) / 2],
      [1, 1, (1 + m) / 2],
      [1, 0, (1 - m) / 2],
    ] as const) {
      const g = ctx.createGain();
      g.gain.value = k;
      split.connect(g, side).connect(merge, 0, to);
    }
    return merge;
  }
  if (!warned.has(spec)) {
    warned.add(spec);
    say(`Audio filter "${spec}" can't play in the studio yet; renders still apply it`, 6000);
  }
  return from;
};

// ---------- What sounds where: mix.py's build() over the lanes, with the studio's picks (mix.py chosen/as_option) and its muted tracks;
// in the page also its soloed ones, unless `all` (the meter's render of the film as mix.py makes it)
const clips = (l: Lanes, all = false): Clip[] => {
  const out: Clip[] = [],
    muted = new Set((l.tracks ?? []).filter((t) => t.mute).map((t) => t.id)),
    trackDb = new Map((l.tracks ?? []).map((t) => [t.id, t.gain ?? 0])),
    trackEq = new Map(
      (l.tracks ?? []).map((t) => [t.id, (t.filters as string[] | undefined) ?? []]),
    ),
    solo = all ? [] : get().solo;
  const pick = (e: { name: string; gain: number; track?: string; try?: string[] }) => {
    if (e.track && muted.has(e.track)) return null;
    if (solo.length && !solo.includes(e.track ?? "")) return null;
    const td = trackDb.get(e.track ?? "") ?? 0;
    const p = e.try?.length ? lanePick(e.name) : null;
    if (p?.set === "off") return null;
    const name = p && [e.name, ...e.try!].includes(p.set) ? p.set : e.name,
      gain = p?.gain ?? 1;
    if (name === e.name && gain === 1) return { name, db: e.gain + td, own: true };
    const a = ready.get(e.name),
      b = ready.get(name);
    if (!a || !b) {
      load(e.name);
      load(name);
      return null;
    }
    return {
      name,
      db: e.gain + td + a.mean - b.mean + 20 * Math.log10(gain),
      own: name === e.name,
    };
  };
  const narrated = !!l.narration || l.voice !== false;
  l.beds.forEach((b, i) => {
    const p = pick(b);
    if (p)
      out.push({
        key: `beds:${i}`,
        name: p.name,
        t0: b.from,
        t1: b.to,
        start: p.own ? (b.start ?? 0) : 0,
        length: b.to - b.from,
        loop: true,
        db: p.db,
        gainKeys: b.gainKeys?.map((k) => ({ ...k, gain: k.gain + p.db - b.gain })),
        fadeIn: b.fadeIn,
        fadeOut: b.fadeOut,
        duck: narrated ? ((b.duck as number | undefined) ?? 0) : 0,
        pan: b.pan ?? 0,
        filters: [...((b.filters as string[]) ?? []), ...(trackEq.get(b.track ?? "") ?? [])],
        reverb: resolveClipReverb(b.reverb, 0.5 * (b.from + b.to), l.spaces, l.reverb),
        spatial: isSpatialActive(b.spatial) ? b.spatial : undefined,
      });
  });
  l.sfx.forEach((s, i) => {
    const p = pick(s),
      buf = p && ready.get(p.name)?.buf;
    if (!p) return;
    if (!buf) {
      load(p.name);
      return;
    }
    const start = p.own ? (s.start ?? 0) : 0; // an option plays from its own start
    const t1 = s.at + (s.length ?? (buf.duration - start) / (s.rate ?? 1));
    out.push({
      key: `sfx:${i}`,
      name: p.name,
      t0: s.at,
      t1,
      start,
      length: s.length,
      loop: false,
      db: p.db,
      gainKeys: s.gainKeys?.map((k) => ({ ...k, gain: k.gain + p.db - s.gain })),
      fadeIn: s.fadeIn ?? 0,
      fadeOut: s.fadeOut ?? 0,
      duck: 0,
      pan: s.pan ?? 0,
      filters: [...((s.filters as string[]) ?? []), ...(trackEq.get(s.track ?? "") ?? [])],
      reverb: resolveClipReverb(s.reverb, 0.5 * (s.at + t1), l.spaces, l.reverb),
      spatial: isSpatialActive(s.spatial) ? s.spatial : undefined,
    });
  });
  const audible = out.filter((c) => c.t1 > c.t0);
  for (const c of audible) {
    const [list, i] = c.key.split(":") as ["beds" | "sfx", string],
      entry = l[list][+i];
    if (needsProcessing(entry)) {
      c.process = processSpec({ ...entry, name: c.name, start: c.start }, c.t1 - c.t0, c.loop);
      c.start = 0;
      c.loop = false;
      c.length = c.t1 - c.t0;
    }
  }
  return audible;
};
const soundFor = (c: Clip) => (c.process ? processed(c.process) : ready.get(c.name));
const loadClip = (c: Clip) => (c.process ? loadProcessed(c.process) : load(c.name));
const preloadSources = (l: Lanes) => {
  const customSpaces = [
    ...(l.reverb ? [l.reverb.space] : []),
    ...(l.spaces ?? []).map((s) => s.space),
    ...l.beds.flatMap((b) => (b.reverb ? [b.reverb.space] : [])),
    ...l.sfx.flatMap((s) => (s.reverb ? [s.reverb.space] : [])),
  ].filter((sp) => sp && !isPresetSpace(sp));
  return Promise.all([
    ...[
      ...new Set(
        [...l.beds, ...l.sfx].flatMap((c) => {
          const p = c.try?.length ? lanePick(c.name)?.set : null;
          return [c.name, ...(p && p !== "off" ? [p] : [])];
        }),
      ),
    ].map(load),
    ...[...new Set(customSpaces)].map(loadCustomIr),
  ]);
};

interface Voice {
  srcs: AudioBufferSourceNode[];
  gain: GainNode;
  updateSpatial?: (tFilm: number, nowCtx: number) => void;
}
let voices: Voice[] = [];
const started = new Set<string>();
const duckWindowCache = new WeakMap<
  readonly { s: number; e: number }[],
  ReturnType<typeof duckWindows>
>();
const cachedDuckWindows = (lines: readonly { s: number; e: number }[]) => {
  let cached = duckWindowCache.get(lines);
  if (!cached) {
    cached = duckWindows(lines.map((l) => [l.s, l.e]));
    duckWindowCache.set(lines, cached);
  }
  return cached;
};
// One clip from film second at (inside it) on; w maps film seconds onto ctx's clock
const play = (
  ctx: BaseAudioContext,
  bus: AudioNode,
  c: Clip,
  s: Sound,
  at: number,
  w: Pick<Window, "speed" | "when" | "ctxAt">,
): Voice | null => {
  const u0 = at - c.t0;
  if (!c.loop && c.start + u0 >= s.buf.duration) return null;
  // mix.py's aformat makes a mono file stereo the ffmpeg way, the center at -3 dB in each side; Web Audio copies it at full level
  const head = ctx.createGain(),
    gain = ctx.createGain(),
    lin = s.buf.numberOfChannels === 1 ? Math.SQRT1_2 : 1;
  const begin = Math.round(w.when(at) * ctx.sampleRate) / ctx.sampleRate,
    ctxAt = (u: number) => w.ctxAt(c.t0 + u);
  let srcs: AudioBufferSourceNode[];
  if (c.loop) srcs = loopSources(ctx, s.buf, c.start, c.t1 - c.t0, u0, begin, ctxAt, w.speed, head);
  else {
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = w.speed;
    src.connect(head);
    src.start(begin, c.start + u0);
    src.stop(Math.max(begin, ctxAt(c.t1 - c.t0)));
    srcs = [src];
  }
  let pts = envelopePoints(u0, c.t1 - c.t0, c.fadeIn, c.fadeOut, c.length);
  if (c.duck > 0) {
    const lines = source?.voice() ?? S.voiceOut;
    const w = cachedDuckWindows(lines);
    const us = [
      ...new Set([
        ...pts.map((p) => p[0]),
        ...duckCorners(c.t0 + u0, c.t1, w).map((t) => t - c.t0),
      ]),
    ].sort((a, b) => a - b);
    pts = us.map((u) => [
      u,
      envelope(u, c.fadeIn, c.fadeOut, c.length) * duckGain(c.t0 + u, w, c.duck),
    ]);
  }
  gain.gain.setValueAtTime(lin * pts[0][1], begin);
  for (const [u, v] of pts.slice(1))
    gain.gain.linearRampToValueAtTime(lin * v, Math.max(begin, w.ctxAt(c.t0 + u)));
  let tail: AudioNode = head;
  for (const spec of c.filters) tail = attach(ctx, tail, spec);
  const volume = ctx.createGain();
  scheduleGain(volume.gain, { gain: c.db, gainKeys: c.gainKeys }, u0, c.t1 - c.t0, (u) =>
    Math.max(begin, w.ctxAt(c.t0 + u)),
  );
  tail = tail.connect(volume);
  tail = tail.connect(gain);
  if (c.pan) {
    // mix.py pan_filter: equal-power balance on the stereo signal; explicit stereo, so a mono file is made stereo first as
    // ffmpeg's aformat does (the SQRT1_2 above) rather than panned by the mono rule
    const p = ctx.createStereoPanner();
    p.channelCountMode = "explicit";
    p.channelCount = 2;
    p.pan.value = c.pan;
    tail = tail.connect(p);
  }
  let updateSpatial: Voice["updateSpatial"];
  if (
    c.spatial &&
    isSpatialActive(c.spatial) &&
    source?.camPose &&
    typeof ctx.createBiquadFilter === "function"
  ) {
    const spSpec = c.spatial;
    const sampleSpatial = (tFilm: number) => {
      const cam = source!.camPose!(tFilm);
      const rawSrc = spSpec.target
        ? (source!.targetPos?.(spSpec.target, tFilm) ?? spSpec.at ?? [0, 0, 0])
        : (spSpec.at ?? [0, 0, 0]);
      return computeSpatialParams(cam, offsetPosition(rawSrc, spSpec.offset), spSpec);
    };
    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.Q.value = Math.SQRT1_2;
    const spGain = ctx.createGain();
    const spPan = ctx.createStereoPanner();
    spPan.channelCountMode = "explicit";
    spPan.channelCount = 2;

    const init = sampleSpatial(at);
    lpf.frequency.setValueAtTime(Math.max(250, Math.min(20000, init.cutoffHz)), begin);
    spGain.gain.setValueAtTime(init.gain, begin);
    spPan.pan.setValueAtTime(init.pan, begin);

    const isOffline =
      typeof OfflineAudioContext !== "undefined" && ctx instanceof OfflineAudioContext;
    if (isOffline) {
      const step = 1 / 30;
      for (let t = at + step; t <= c.t1 + 1e-4; t += step) {
        const tt = Math.min(t, c.t1);
        const ct = Math.max(begin, w.ctxAt(tt));
        const sp = sampleSpatial(tt);
        spGain.gain.linearRampToValueAtTime(sp.gain, ct);
        spPan.pan.linearRampToValueAtTime(sp.pan, ct);
        lpf.frequency.exponentialRampToValueAtTime(Math.max(250, Math.min(20000, sp.cutoffHz)), ct);
      }
    } else {
      updateSpatial = (tFilm: number, nowCtx: number) => {
        const sp = sampleSpatial(tFilm);
        spGain.gain.setTargetAtTime(sp.gain, nowCtx, 0.015);
        spPan.pan.setTargetAtTime(sp.pan, nowCtx, 0.015);
        lpf.frequency.setTargetAtTime(Math.max(250, Math.min(20000, sp.cutoffHz)), nowCtx, 0.015);
      };
    }
    tail = tail.connect(lpf).connect(spGain).connect(spPan);
  }

  const conv = c.reverb ? sharedConvolver(ctx, bus, c.reverb.space) : null;
  if (conv && c.reverb) {
    const dryGain = ctx.createGain();
    const wetGain = ctx.createGain();
    dryGain.gain.value = 1 - c.reverb.wet;
    wetGain.gain.value = c.reverb.wet;
    tail.connect(dryGain).connect(bus);
    if (c.reverb.preDelayMs > 0 && typeof ctx.createDelay === "function") {
      const preDelay = ctx.createDelay(1.0);
      preDelay.delayTime.value = c.reverb.preDelayMs / 1000;
      tail.connect(preDelay).connect(wetGain).connect(conv);
    } else {
      tail.connect(wetGain).connect(conv);
    }
  } else {
    tail.connect(bus);
  }
  return { srcs, gain, updateSpatial };
};
const hush = (list: Voice[]) => {
  if (!list.length || !hasAudio()) return;
  const t = getAudioCtx().currentTime;
  for (const v of list) {
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, 0.004);
    for (const src of v.srcs)
      try {
        src.stop(t + 0.03);
      } catch {}
  }
};

addPlayer({
  reset: () => {
    started.clear();
    voices = [];
    if (hasAudio()) resetBusConvolvers(getLive().bus);
  },
  tick: (w) => {
    if (routed) levelMix(); // the mix plays through the graph whether or not the lanes do
    const l = on && source?.lanes();
    if (!l) return;
    const ctx = getAudioCtx(),
      live = getLive();
    for (const c of clips(l)) {
      if (started.has(c.key) || !(c.t0 < w.until && w.now < c.t1)) continue;
      const s = soundFor(c);
      if (!s) {
        loadClip(c);
        continue;
      }
      const v = play(ctx, live.bus, c, s, Math.max(w.now, c.t0), w);
      started.add(c.key);
      if (v) {
        v.srcs.forEach(track);
        voices.push(v);
        v.srcs.at(-1)!.addEventListener("ended", () => {
          voices = voices.filter((x) => x !== v);
        });
      }
    }
    for (const v of voices) v.updateSpatial?.(w.now, ctx.currentTime);
    window.__lanes = { sounding: voices.length, at: +w.now.toFixed(3), plans };
  },
});

// A lane edit or a pick: what is sounding fades out in a few ms and the next tick starts it again as it now is. While a
// clip is being dragged that waits until the hand rests a moment
let replanTimer = 0,
  plans = 0;
export const replan = () => {
  if (!on) return;
  clearTimeout(replanTimer);
  replanTimer = window.setTimeout(() => {
    hush(voices);
    voices = [];
    started.clear();
    plans++;
    const l = source?.lanes();
    if (l) {
      if (liveStage) liveStage.drive.gain.value = 10 ** (Number(l.drive ?? 0) / 20);
      setLaneGroups(groups(l));
      retainProcessed(clips(l, true).flatMap((c) => (c.process ? [c.process] : [])));
    }
  }, 60);
};

// ---------- Options on the lanes (a "try" list), as option groups: picked like any other, played by this
const auditioning: Voice[] = [];
const previewSrcs = new Set<AudioScheduledSourceNode>();
export const hasPreviewSounding = () => previewSrcs.size > 0;
const trackPreview = (srcs: readonly AudioScheduledSourceNode[]) => {
  if (!srcs.length) return;
  for (const s of srcs) {
    previewSrcs.add(s);
    s.addEventListener(
      "ended",
      () => {
        previewSrcs.delete(s);
      },
      { once: true },
    );
  }
  wake("audio");
};
const audition = async (name: string) => {
  const l = source?.lanes();
  if (!l) return;
  const all = clips(l).filter((c) => {
    const [list, i] = c.key.split(":") as ["beds" | "sfx", string];
    return l[list][+i].name === name;
  });
  if (!all.length) return;
  const c = all.reduce((p, q) => (Math.abs(q.t0 - S.t) < Math.abs(p.t0 - S.t) ? q : p));
  const s = await loadClip(c);
  if (!s) return;
  hush(auditioning.splice(0));
  const ctx = getAudioCtx(),
    from = Math.min(Math.max(S.t, c.t0), Math.max(c.t0, c.t1 - 2.5)),
    to = Math.min(c.t1, from + 2.5),
    t0 = ctx.currentTime + 0.02;
  const w = {
    speed: 1,
    ctxAt: (t: number) => t0 + t - from,
    when: (t: number) => Math.max(t0, t0 + t - from),
  };
  const v = play(ctx, getLive().bus, { ...c, t1: to }, s, from, w);
  if (!v) return;
  v.gain.gain.setTargetAtTime(0, w.ctxAt(to) - 0.08, 0.02);
  auditioning.push(v);
  trackPreview(v.srcs);
};
const groups = (l: Lanes): Record<string, LaneGroup> => {
  const lib = new Map(source!.library().map((x) => [x.name, x]));
  const out: Record<string, LaneGroup> = {};
  for (const [list, kind] of [
    ["beds", "bed"],
    ["sfx", "sfx"],
  ] as const) {
    l[list].forEach((e, i) => {
      if (!e.try?.length) return;
      // mix.py groups a sound by name and takes the first entry's options
      out[e.name] ??= {
        title: `${e.name.replace(/_/g, " ")} (${kind})`,
        options: [e.name, ...e.try].map((id) => ({
          id,
          title: lib.get(id)?.title ?? id,
          source: lib.get(id)?.url ?? "",
        })),
        spans: [],
        audition: () => {
          audition(e.name);
        },
      };
      out[e.name].spans.push(source!.span({ list, i }));
    });
  }
  return out;
};

// ---------- A skim (timeline/peek.ts): the next len seconds from film second t, everything as playback sounds there, each
// one cutting the last off, as audio scrubbing in an editor does
let skim: { out: GainNode; srcs: AudioScheduledSourceNode[] } | null = null,
  skims = 0;
const endSkim = (at: number) => {
  if (!skim) return;
  skim.out.gain.cancelScheduledValues(at);
  skim.out.gain.setTargetAtTime(0, at, 0.003);
  for (const s of skim.srcs) {
    try {
      s.stop(at + 0.02);
    } catch {}
  }
  skim = null;
};
export const playSlice = async (t: number, len: number) => {
  const mine = ++skims,
    mix = await mixBuffer();
  if (mine !== skims) return;
  const { ctx, master } = getAudio(),
    t0 = ctx.currentTime + 0.01,
    end = t0 + len,
    out = ctx.createGain(),
    srcs: AudioScheduledSourceNode[] = [];
  endSkim(t0);
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(1, t0 + 0.004);
  out.gain.setValueAtTime(1, end - 0.012);
  out.gain.linearRampToValueAtTime(0, end);
  out.connect(on ? getLive().bus : master);
  if (mix && !get().solo.length && t < mix.duration) {
    const s = ctx.createBufferSource();
    s.buffer = mix;
    s.connect(out);
    s.start(t0, t);
    srcs.push(s);
  }
  const l = on && source?.lanes();
  if (l) {
    const w = {
      speed: 1,
      ctxAt: (x: number) => t0 + x - t,
      when: (x: number) => Math.max(t0, t0 + x - t),
    };
    for (const c of clips(l)) {
      if (!(c.t0 <= t && t < c.t1)) continue;
      const s = soundFor(c);
      if (!s) {
        loadClip(c);
        continue;
      }
      const v = play(ctx, out, c, s, t, w);
      if (v) srcs.push(...v.srcs);
    }
  }
  for (const s of srcs) s.stop(end); // the last stop called is the one kept
  skim = { out, srcs };
  trackPreview(srcs);
};

// ---------- On and off, from the server's word (GET /api/sound live)
export const setLive = (live_: boolean, src: Source) => {
  source = src;
  wantLive = live_;
  if (!unsubAudio) {
    unsubAudio = onAudioReady(() => {
      ensureRouting();
    });
  } else if (hasAudio()) {
    ensureRouting();
  }
  if (live_ !== on) {
    on = live_;
    if (!on) {
      hush(voices);
      voices = [];
      started.clear();
      if (hasAudio()) resetBusConvolvers(getLive().bus);
      setLaneGroups({});
    }
  }
  levelMix();
  const l = src.lanes();
  if (on && l) {
    for (const c of clips(l)) loadClip(c);
    replan();
  }
};

// The lanes from..to as heard here, rendered offline: RMS per half second and the peak, to set against mix.py's own render
window.__lanesRender = async (from: number, to: number) => {
  const l = source?.lanes();
  if (!l) return null;
  await preloadSources(l);
  const all = clips(l),
    loaded = await Promise.all(all.map(loadClip));
  if (loaded.some((s) => !s)) return null;
  const rate = 48000,
    ctx = new OfflineAudioContext(2, Math.ceil((to - from) * rate), rate),
    st = stage(ctx, ctx.destination);
  st.drive.gain.value = 10 ** (Number(l.drive ?? 0) / 20);
  await st.ready;
  const w = {
    speed: 1,
    ctxAt: (t: number) => t - from,
    when: (t: number) => Math.max(0, t - from),
  };
  all.forEach((c, i) => {
    const s = loaded[i];
    if (s && c.t1 > from && c.t0 < to) play(ctx, st.bus, c, s, Math.max(from, c.t0), w);
  });
  const out = await ctx.startRendering(),
    hop = rate / 2,
    rms: number[] = [];
  let peak = 0;
  for (let i = 0; i < out.length; i += hop) {
    let sum = 0,
      n = 0;
    for (let c = 0; c < 2; c++) {
      const d = out.getChannelData(c);
      for (let k = i; k < Math.min(out.length, i + hop); k++) {
        sum += d[k] * d[k];
        n++;
        peak = Math.max(peak, Math.abs(d[k]));
      }
    }
    rms.push(+(10 * Math.log10(sum / n || 1e-12)).toFixed(2));
  }
  return { rms, peak: +peak.toFixed(4) };
};

// The film's whole sound as mix.py builds it before its loudness pass (narration, beds and one-shots into the drive and the
// limiter; every track but the muted ones, soloed or not), rendered offline into the node `into` makes: the meter measures the
// gain that pass will add (meter.ts). Gives the lanes it built from, or null when the page doesn't play the lanes, so it can't
// build the film's sound itself
export const renderFilm = async (
  into: (ctx: OfflineAudioContext) => Promise<AudioNode>,
): Promise<Lanes | null> => {
  const l = source?.lanes();
  if (!on || !l) return null;
  await preloadSources(l);
  const all = clips(l, true);
  const [voice, loaded] = await Promise.all([mixBuffer(), Promise.all(all.map(loadClip))]);
  if (loaded.some((s) => !s)) return null;
  // One channel out: the measuring node hears the stereo sum, and the rendered buffer nobody reads stays half the size
  const rate = 48000,
    ctx = new OfflineAudioContext(1, Math.ceil(DURATION * rate), rate),
    st = stage(ctx, await into(ctx));
  st.drive.gain.value = 10 ** (Number(l.drive ?? 0) / 20);
  await st.ready;
  if (voice) {
    const v = ctx.createBufferSource();
    v.buffer = voice;
    v.connect(st.bus);
    v.start(0);
  }
  const w = { speed: 1, ctxAt: (t: number) => t, when: (t: number) => Math.max(0, t) };
  all.forEach((c, i) => {
    const s = loaded[i];
    if (s) play(ctx, st.bus, c, s, Math.max(0, c.t0), w);
  });
  await ctx.startRendering();
  return l;
};

// Render stereo [from, to] audio segment for direct in-browser low-res MP4 clip export.
export const renderAudioSpan = async (from: number, to: number): Promise<AudioBuffer | null> => {
  const dur = Math.max(0, to - from);
  if (dur <= 1e-3) return null;
  const rate = 48000,
    frames = Math.max(1, Math.round(dur * rate)),
    voice = await mixBuffer(),
    l = source?.lanes();
  if (on && l) {
    await preloadSources(l);
    const all = clips(l),
      loaded = await Promise.all(all.map(loadClip));
    if (!loaded.some((s) => !s)) {
      const ctx = new OfflineAudioContext(2, frames, rate),
        st = stage(ctx, ctx.destination);
      st.drive.gain.value = 10 ** (Number(l.drive ?? 0) / 20);
      await st.ready;
      if (voice && from < voice.duration) {
        const v = ctx.createBufferSource();
        v.buffer = voice;
        v.connect(st.bus);
        v.start(0, Math.max(0, from), Math.min(dur, voice.duration - Math.max(0, from)));
      }
      const w = {
        speed: 1,
        ctxAt: (t: number) => t - from,
        when: (t: number) => Math.max(0, t - from),
      };
      all.forEach((c, i) => {
        const s = loaded[i];
        if (s && c.t1 > from && c.t0 < to) play(ctx, st.bus, c, s, Math.max(from, c.t0), w);
      });
      return ctx.startRendering();
    }
  }
  if (!voice) return null;
  const startSample = Math.max(0, Math.floor(from * voice.sampleRate)),
    sampleCount = Math.max(1, Math.round(dur * voice.sampleRate)),
    out = new AudioBuffer({
      numberOfChannels: 2,
      length: sampleCount,
      sampleRate: voice.sampleRate,
    }),
    chCount = Math.min(2, voice.numberOfChannels);
  for (let ch = 0; ch < 2; ch++) {
    const src = voice.getChannelData(Math.min(ch, chCount - 1));
    const dst = out.getChannelData(ch);
    const available = Math.min(sampleCount, Math.max(0, src.length - startSample));
    if (available > 0) dst.set(src.subarray(startSample, startSample + available));
  }
  return out;
};
