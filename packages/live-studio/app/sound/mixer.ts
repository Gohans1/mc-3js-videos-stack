// The sound lanes heard as they are edited, for a film with package.json "live-studio": { liveLanes: true }. Its sound.py then
// mixes without them, and this plays every bed and one-shot of the timeline file on the mix's clock the way the film's
// scripts/sound/mix.py builds them: a bed looped from..to, a one-shot from start for length, gains in dB, fades (envelope.ts),
// lowpass/highpass filters, and an option picked in its place at the level of the sound it stands in for. All of it goes
// through the mix's master stage: audio.drive dB into mix.py's limiter at 0.45 (brickwall.ts), with the narration summed in before it.
// A drag is heard on the next tick, nothing is remixed. The final render still comes from mix.py.
import { DURATION } from "film/scene";
import { addModule, addPlayer, audioCtx, master, STEREO, track, type Window } from "./clock";
import brickwall from "./brickwall.worklet.ts?worker&url";
import { AWAY } from "../core/device";
import { getFile } from "../core/net";
import { duckCorners, duckGain, duckWindows } from "./duck";
import { envelope, envelopePoints } from "./envelope";
import { type LaneGroup, lanePick, setLaneGroups } from "../options/options";
import type { Lanes, LibraryItem } from "./sound";
import { S } from "../core/state";
import { type ClipRef } from "./slice";
import { get, say } from "../core/store";

interface Source { lanes: () => Lanes | null; library: () => LibraryItem[]; span: (c: ClipRef) => [number, number] }
interface Clip { key: string; name: string; t0: number; t1: number; start: number; length?: number; loop: boolean; db: number; fadeIn: number; fadeOut: number; duck: number; pan: number; filters: string[] }
interface Sound { buf: AudioBuffer; mean: number }

// Silent until the limiter's module has loaded (a moment after the page opens): an offline render waits for `ready`
const stage = (ctx: BaseAudioContext, out: AudioNode) => {
  const bus = ctx.createGain(), drive = ctx.createGain();
  bus.connect(drive);
  const ready = addModule(ctx, brickwall).then(() => { drive.connect(new AudioWorkletNode(ctx, "brickwall", { ...STEREO, outputChannelCount: [2] })).connect(out); });
  return { bus, drive, ready };
};
const live = stage(audioCtx, master);

let source: Source | null = null, on = false, routed: MediaElementAudioSourceNode | null = null;
const fromMix = audioCtx.createGain();
// The mix element's own volume is applied before it reaches here, and the volume after master applies it again: undone, so it
// counts once. A soloed track silences the narration as it does every other track
const levelMix = () => { const a = S.el.audio, v = a.muted ? 0 : a.volume; fromMix.gain.value = v > 0 && !get().solo.length ? 1 / v : 0; };

// ---------- The lanes' sound files, decoded once, with ffmpeg volumedetect's mean_volume for an option's level
const sounds = new Map<string, Promise<Sound | null>>(), ready = new Map<string, Sound>();
const load = (name: string) => {
  if (!sounds.has(name)) {
    const url = `/api/sfx/${encodeURIComponent(name)}.${AWAY ? "webm" : "wav"}`; // anything but this machine gets Opus, a tenth of it
    sounds.set(name, getFile(url).then(async (r) => {
      if (!r.ok) return null;
      const buf = await audioCtx.decodeAudioData(await r.arrayBuffer());
      let sum = 0, n = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) sum += d[i] * d[i]; n += d.length; }
      const s = { buf, mean: 10 * Math.log10(sum / n || 1e-12) };
      ready.set(name, s);
      return s;
    }).catch(() => null));
  }
  return sounds.get(name)!;
};
// A file changed on disk (a new download): its old decode goes
export const forgetSounds = () => { sounds.clear(); ready.clear(); };

// ---------- mix.py's ffmpeg filters, the two the films use: lowpass/highpass=f=..:poles=1|2[:w=Q]
const warned = new Set<string>();
const filterNode = (ctx: BaseAudioContext, spec: string): AudioNode | null => {
  const [kind, args = ""] = spec.split("="), m = Object.fromEntries(args ? spec.slice(kind.length + 1).split(":").map((kv) => kv.split("=")) : []);
  const f = Number(m.f ?? m.frequency ?? 500), poles = Number(m.p ?? m.poles ?? 2), q = Number(m.w ?? m.width ?? 0.707);
  if ((kind !== "lowpass" && kind !== "highpass") || !(f > 0) || (poles !== 1 && poles !== 2) || (m.t ?? m.width_type ?? "q") !== "q") {
    if (!warned.has(spec)) { warned.add(spec); say(`Audio filter "${spec}" can't play in the studio yet; renders still apply it`, 6000); }
    return null;
  }
  if (poles === 2) {
    // ffmpeg's two-pole filters are the RBJ cookbook ones, as Web Audio's; its Q is a plain ratio, Web Audio's lowpass Q is in dB
    const b = ctx.createBiquadFilter();
    b.type = kind; b.frequency.value = f; b.Q.value = 20 * Math.log10(q);
    return b;
  }
  const a1 = -Math.exp((-2 * Math.PI * f) / ctx.sampleRate), b0 = kind === "lowpass" ? 1 + a1 : (1 - a1) / 2; // ffmpeg's one-pole
  return ctx.createIIRFilter(kind === "lowpass" ? [b0, 0] : [b0, -b0], [1, a1]);
};

// ---------- What sounds where: mix.py's build() over the lanes, with the studio's picks (mix.py chosen/as_option) and its muted tracks;
// in the page also its soloed ones, unless `all` (the meter's render of the film as mix.py makes it)
const clips = (l: Lanes, all = false): Clip[] => {
  const out: Clip[] = [], muted = new Set((l.tracks ?? []).filter((t) => t.mute).map((t) => t.id)), solo = all ? [] : get().solo;
  const pick = (e: { name: string; gain: number; track?: string; try?: string[] }) => {
    if (e.track && muted.has(e.track)) return null;
    if (solo.length && !solo.includes(e.track ?? "")) return null;
    const p = e.try?.length ? lanePick(e.name) : null;
    if (p?.set === "off") return null;
    const name = p && [e.name, ...e.try!].includes(p.set) ? p.set : e.name, gain = p?.gain ?? 1;
    if (name === e.name && gain === 1) return { name, db: e.gain, own: true };
    const a = ready.get(e.name), b = ready.get(name);
    if (!a || !b) { load(e.name); load(name); return null; }
    return { name, db: e.gain + a.mean - b.mean + 20 * Math.log10(gain), own: name === e.name };
  };
  const narrated = l.voice !== false; // audio.json voice false: no narration in the mix yet, so mix.py ducks nothing either
  l.beds.forEach((b, i) => {
    const p = pick(b);
    if (p) out.push({ key: `beds:${i}`, name: p.name, t0: b.from, t1: b.to, start: p.own ? b.start ?? 0 : 0, length: b.to - b.from, loop: true, db: p.db, fadeIn: b.fadeIn, fadeOut: b.fadeOut, duck: narrated ? (b.duck as number | undefined) ?? 0 : 0, pan: b.pan ?? 0, filters: (b.filters as string[]) ?? [] });
  });
  l.sfx.forEach((s, i) => {
    const p = pick(s), buf = p && ready.get(p.name)?.buf;
    if (!p) return;
    if (!buf) { load(p.name); return; }
    const start = p.own ? s.start ?? 0 : 0; // an option plays from its own start
    out.push({ key: `sfx:${i}`, name: p.name, t0: s.at, t1: s.at + (s.length ?? buf.duration - start), start, length: s.length, loop: false, db: p.db, fadeIn: s.fadeIn ?? 0, fadeOut: s.fadeOut ?? 0, duck: 0, pan: s.pan ?? 0, filters: (s.filters as string[]) ?? [] });
  });
  return out;
};

interface Voice { src: AudioBufferSourceNode; gain: GainNode }
let voices: Voice[] = [];
const started = new Set<string>();
// One clip from film second at (inside it) on; w maps film seconds onto ctx's clock
const play = (ctx: BaseAudioContext, bus: AudioNode, c: Clip, s: Sound, at: number, w: Pick<Window, "speed" | "when" | "ctxAt">): Voice | null => {
  const u0 = at - c.t0, offset = c.loop ? (c.start + u0) % s.buf.duration : c.start + u0;
  if (!c.loop && offset >= s.buf.duration) return null;
  // mix.py's aformat makes a mono file stereo the ffmpeg way, the center at -3 dB in each side; Web Audio copies it at full level
  const src = ctx.createBufferSource(), gain = ctx.createGain(), lin = 10 ** (c.db / 20) * (s.buf.numberOfChannels === 1 ? Math.SQRT1_2 : 1), begin = w.when(at);
  src.buffer = s.buf; src.loop = c.loop; src.playbackRate.value = w.speed;
  let pts = envelopePoints(u0, c.t1 - c.t0, c.fadeIn, c.fadeOut, c.length);
  if (c.duck > 0) {
    const w = duckWindows(S.voiceOut.map((l) => [l.s, l.e]));
    const us = [...new Set([...pts.map((p) => p[0]), ...duckCorners(c.t0 + u0, c.t1, w).map((t) => t - c.t0)])].sort((a, b) => a - b);
    pts = us.map((u) => [u, envelope(u, c.fadeIn, c.fadeOut, c.length) * duckGain(c.t0 + u, w, c.duck)]);
  }
  gain.gain.setValueAtTime(lin * pts[0][1], begin);
  for (const [u, v] of pts.slice(1)) gain.gain.linearRampToValueAtTime(lin * v, Math.max(begin, w.ctxAt(c.t0 + u)));
  let tail: AudioNode = src;
  for (const spec of c.filters) { const f = filterNode(ctx, spec); if (f) tail = tail.connect(f); }
  tail = tail.connect(gain);
  if (c.pan) {
    // mix.py pan_filter: equal-power balance on the stereo signal; explicit stereo, so a mono file is made stereo first as
    // ffmpeg's aformat does (the SQRT1_2 above) rather than panned by the mono rule
    const p = ctx.createStereoPanner();
    p.channelCountMode = "explicit"; p.channelCount = 2; p.pan.value = c.pan;
    tail = tail.connect(p);
  }
  tail.connect(bus);
  src.start(begin, offset);
  src.stop(Math.max(begin, w.ctxAt(c.t1)));
  return { src, gain };
};
const hush = (list: Voice[]) => {
  const t = audioCtx.currentTime;
  for (const v of list) { v.gain.gain.cancelScheduledValues(t); v.gain.gain.setTargetAtTime(0, t, 0.004); try { v.src.stop(t + 0.03); } catch {} }
};

addPlayer({
  reset: () => { started.clear(); voices = []; },
  tick: (w) => {
    if (routed) levelMix(); // the mix plays through the graph whether or not the lanes do
    const l = on && source?.lanes();
    if (!l) return;
    for (const c of clips(l)) {
      if (started.has(c.key) || !(c.t0 < w.until && w.now < c.t1)) continue;
      const s = ready.get(c.name);
      if (!s) { load(c.name); continue; }
      const v = play(audioCtx, live.bus, c, s, Math.max(w.now, c.t0), w);
      started.add(c.key);
      if (v) { track(v.src); voices.push(v); v.src.addEventListener("ended", () => { voices = voices.filter((x) => x !== v); }); }
    }
    window.__lanes = { sounding: voices.length, at: +w.now.toFixed(3), plans };
  },
});

// A lane edit or a pick: what is sounding fades out in a few ms and the next tick starts it again as it now is. While a
// clip is being dragged that waits until the hand rests a moment
let replanTimer = 0, plans = 0;
export const replan = () => {
  if (!on) return;
  clearTimeout(replanTimer);
  replanTimer = window.setTimeout(() => {
    hush(voices); voices = []; started.clear(); plans++;
    const l = source?.lanes();
    if (l) { live.drive.gain.value = 10 ** (Number(l.drive ?? 0) / 20); setLaneGroups(groups(l)); }
  }, 60);
};

// ---------- Options on the lanes (a "try" list), as option groups: picked like any other, played by this
const auditioning: Voice[] = [];
const audition = async (name: string) => {
  const l = source?.lanes();
  if (!l) return;
  const all = clips(l).filter((c) => { const [list, i] = c.key.split(":") as ["beds" | "sfx", string]; return l[list][+i].name === name; });
  if (!all.length) return;
  const c = all.reduce((p, q) => (Math.abs(q.t0 - S.t) < Math.abs(p.t0 - S.t) ? q : p));
  const s = await load(c.name);
  if (!s) return;
  hush(auditioning.splice(0));
  const from = Math.min(Math.max(S.t, c.t0), Math.max(c.t0, c.t1 - 2.5)), to = Math.min(c.t1, from + 2.5), t0 = audioCtx.currentTime + 0.02;
  const w = { speed: 1, ctxAt: (t: number) => t0 + t - from, when: (t: number) => Math.max(t0, t0 + t - from) };
  const v = play(audioCtx, live.bus, { ...c, t1: to }, s, from, w);
  if (!v) return;
  v.gain.gain.setTargetAtTime(0, w.ctxAt(to) - 0.08, 0.02);
  auditioning.push(v);
};
const groups = (l: Lanes): Record<string, LaneGroup> => {
  const lib = new Map(source!.library().map((x) => [x.name, x]));
  const out: Record<string, LaneGroup> = {};
  for (const [list, kind] of [["beds", "bed"], ["sfx", "sfx"]] as const) {
    l[list].forEach((e, i) => {
      if (!e.try?.length) return;
      // mix.py groups a sound by name and takes the first entry's options
      out[e.name] ??= { title: `${e.name.replace(/_/g, " ")} (${kind})`, options: [e.name, ...e.try].map((id) => ({ id, title: lib.get(id)?.title ?? id, source: lib.get(id)?.url ?? "" })), spans: [], audition: () => { audition(e.name); } };
      out[e.name].spans.push(source!.span({ list, i }));
    });
  }
  return out;
};

// ---------- On and off, from the server's word (GET /api/sound live)
export const setLive = (live_: boolean, src: Source) => {
  source = src;
  // Through the page's own graph either way, so the meter hears the mix (meter.ts)
  if (!routed) { routed = audioCtx.createMediaElementSource(S.el.audio); routed.connect(fromMix); }
  // The mix goes through the master stage only while the lanes are summed with it; otherwise it already went through mix.py's
  fromMix.disconnect();
  fromMix.connect(live_ ? live.bus : master);
  if (live_ !== on) { on = live_; if (!on) { hush(voices); voices = []; started.clear(); setLaneGroups({}); } }
  levelMix();
  const l = src.lanes();
  if (on && l) { for (const c of clips(l)) load(c.name); replan(); }
};

// The lanes from..to as heard here, rendered offline: RMS per half second and the peak, to set against mix.py's own render
window.__lanesRender = async (from: number, to: number) => {
  const l = source?.lanes();
  if (!l) return null;
  await Promise.all(clips(l).map((c) => load(c.name)));
  const rate = 48000, ctx = new OfflineAudioContext(2, Math.ceil((to - from) * rate), rate), st = stage(ctx, ctx.destination);
  st.drive.gain.value = 10 ** (Number(l.drive ?? 0) / 20);
  await st.ready;
  const w = { speed: 1, ctxAt: (t: number) => t - from, when: (t: number) => Math.max(0, t - from) };
  for (const c of clips(l)) { const s = ready.get(c.name); if (s && c.t1 > from && c.t0 < to) play(ctx, st.bus, c, s, Math.max(from, c.t0), w); }
  const out = await ctx.startRendering(), hop = rate / 2, rms: number[] = [];
  let peak = 0;
  for (let i = 0; i < out.length; i += hop) {
    let sum = 0, n = 0;
    for (let c = 0; c < 2; c++) { const d = out.getChannelData(c); for (let k = i; k < Math.min(out.length, i + hop); k++) { sum += d[k] * d[k]; n++; peak = Math.max(peak, Math.abs(d[k])); } }
    rms.push(+(10 * Math.log10(sum / n || 1e-12)).toFixed(2));
  }
  return { rms, peak: +peak.toFixed(4) };
};

// The film's whole sound as mix.py builds it before its loudness pass (narration, beds and one-shots into the drive and the
// limiter; every track but the muted ones, soloed or not), rendered offline into the node `into` makes: the meter measures the
// gain that pass will add (meter.ts). Gives the lanes it built from, or null when the page doesn't play the lanes, so it can't
// build the film's sound itself
export const renderFilm = async (into: (ctx: OfflineAudioContext) => Promise<AudioNode>): Promise<Lanes | null> => {
  const l = source?.lanes(), url = S.el.audio?.currentSrc;
  if (!on || !l) return null;
  const all = clips(l, true);
  const [voice] = await Promise.all([
    url ? getFile(url).then((r) => r.arrayBuffer()).then((b) => audioCtx.decodeAudioData(b)).catch(() => null) : null,
    ...all.map((c) => load(c.name)),
  ]);
  // One channel out: the measuring node hears the stereo sum, and the rendered buffer nobody reads stays half the size
  const rate = 48000, ctx = new OfflineAudioContext(1, Math.ceil(DURATION * rate), rate), st = stage(ctx, await into(ctx));
  st.drive.gain.value = 10 ** (Number(l.drive ?? 0) / 20);
  await st.ready;
  if (voice) { const v = ctx.createBufferSource(); v.buffer = voice; v.connect(st.bus); v.start(0); }
  const w = { speed: 1, ctxAt: (t: number) => t, when: (t: number) => Math.max(0, t) };
  for (const c of all) { const s = ready.get(c.name); if (s) play(ctx, st.bus, c, s, Math.max(0, c.t0), w); }
  await ctx.startRendering();
  return l;
};
