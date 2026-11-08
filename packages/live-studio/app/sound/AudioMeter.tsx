// The master meter at the right of the timeline, as editors show one (CapCut, Premiere's Audio Meters): each channel's peak with
// its hold, the short-term loudness against the film's target, and a clip light per channel. Every number is the final render's,
// the loudness pass's gain added (meter.ts), so what goes red here goes red in mix.wav. Settings, View, Audio meter hides it;
// a phone never runs it
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { useSmall } from "../core/device";
import { S } from "../core/state";
import { get, say, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { Tip } from "../components/Tip";
import { sized } from "../timeline/canvas";
import { measureFinal, readMeter, resetLoudness, startMeter, stopMeter } from "./meter";

const FLOOR = -60, TOP = 0;
const SCALE = [0, -6, -12, -18, -24, -36, -48, -60];
const HOLD = 1.5, FALL = 20 / 1.7; // IEC TR 60268-18's digital peak meter: back 20 dB in 1.7 s; the hold mark waits 1.5 s first
const YELLOW = -12, RED = -1; // red from -1 dBTP, where mix.py's loudness pass stops being linear
const fixed = (v: number) => (Number.isFinite(v) ? (v > -0.05 && v < 0.05 ? "0.0" : v.toFixed(1)) : "−∞");
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;

export function AudioMeter() {
  const small = useSmall(), on = useStudio((s) => s.meter) && !small, live = useStudio((s) => s.liveLanes), loudness = useStudio((s) => s.loudness);
  const canvas = useRef<HTMLCanvasElement>(null), short = useRef<HTMLSpanElement>(null), whole = useRef<HTMLSpanElement>(null);
  const clipped = useRef<[number | null, number | null]>([null, null]); // film second each channel first went over 0 dBFS

  useEffect(() => {
    if (!on) return;
    void startMeter();
    measureFinal();
    const css = getComputedStyle(document.documentElement), color = (n: string) => css.getPropertyValue(n).trim();
    const C = { ok: color("--ok"), warn: color("--warn"), red: color("--destructive"), loud: color("--primary"), track: color("--raised-2"), text: color("--muted-foreground"), mark: color("--foreground") };
    const shown = [FLOOR, FLOOR], held = [FLOOR, FLOOR], heldAt = [0, 0];
    let raf = 0, last = performance.now(), wasPlaying = false;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (S.playing && !wasPlaying) resetLoudness();
      wasPlaying = S.playing;
      const r = readMeter(get().loudness?.gain ?? 0);
      r.peak.forEach((p, c) => {
        shown[c] = Math.max(p, shown[c] - FALL * dt, FLOOR);
        if (p >= held[c]) { held[c] = p; heldAt[c] = now; } else if (now - heldAt[c] > HOLD * 1000) held[c] = Math.max(shown[c], held[c] - FALL * dt);
        if (p >= 0 && clipped.current[c] === null) {
          if (clipped.current[1 - c] === null) say(`The sound clips at ${stamp(S.t)} in the final render: lower the sounds there, or "drive" in audio.json`, 6000);
          clipped.current[c] = S.t;
        }
      });
      if (short.current) short.current.textContent = fixed(r.shortTerm);
      if (whole.current) whole.current.textContent = fixed(r.integrated);

      const el = canvas.current;
      if (!el || !el.offsetParent) return;
      const { g, w, h } = sized(el), led = 6, y0 = led + 4, y1 = h - 2;
      const y = (d: number) => y0 + ((TOP - Math.max(FLOOR, Math.min(TOP, d))) / (TOP - FLOOR)) * (y1 - y0);
      g.clearRect(0, 0, w, h);
      const bar = 5, gap = 2, lx = 1, bars = [lx, lx + bar + gap, lx + 2 * (bar + gap) + 2];
      // The two peaks, coloured by the zone they reach
      for (let c = 0; c < 2; c++) {
        const x = bars[c];
        g.fillStyle = C.track; g.fillRect(x, y0, bar, y1 - y0);
        for (const [from, to, col] of [[FLOOR, YELLOW, C.ok], [YELLOW, RED, C.warn], [RED, TOP, C.red]] as const) {
          if (shown[c] <= from) break;
          g.fillStyle = col; g.fillRect(x, y(Math.min(shown[c], to)), bar, y(from) - y(Math.min(shown[c], to)));
        }
        if (held[c] > FLOOR) { g.fillStyle = held[c] >= RED ? C.red : C.mark; g.fillRect(x, Math.round(y(held[c])), bar, 1); }
        g.fillStyle = clipped.current[c] !== null ? C.red : C.track; g.fillRect(x, 0, bar, led);
      }
      // The short-term loudness beside them, with the film's target across it
      const x = bars[2], target = get().loudness?.target ?? -14;
      g.fillStyle = C.track; g.fillRect(x, y0, bar, y1 - y0);
      if (r.shortTerm > FLOOR) { g.fillStyle = C.loud; g.fillRect(x, y(r.shortTerm), bar, y1 - y(r.shortTerm)); }
      g.fillStyle = C.mark; g.fillRect(x - 2, Math.round(y(target)), bar + 4, 1);
      // The scale
      g.font = "10px system-ui,Segoe UI,Roboto,sans-serif"; g.textAlign = "right"; g.textBaseline = "middle"; g.fillStyle = C.text;
      for (const d of SCALE) g.fillText(String(Math.abs(d)), w - 1, Math.min(y1 - 4, Math.max(y0 + 4, y(d))));
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); stopMeter(); };
  }, [on]);

  if (!on) return null;
  const over = loudness && loudness.truePeak > -1;
  // The highest target the pass can reach and stay even, a little under, as this measure and ffmpeg's differ by about 0.2 dB
  const highest = loudness && Math.floor((loudness.target - loudness.truePeak - 1 - 0.3) * 10) / 10;
  const about = loudness
    ? `The final render moves the whole film by ${signed(loudness.gain)} dB, from ${loudness.before.toFixed(1)} to ${loudness.target} LUFS, and these numbers already include that. ${over ? `After it the loudest peak is ${signed(loudness.truePeak)} dBTP, over −1: the loudness pass can't stay even and squeezes the whole film. Set "lufs" in audio.json to ${highest} or lower, or lower "drive".` : `Its loudest peak is then ${signed(loudness.truePeak)} dBTP, under −1.`}`
    : live ? "Measuring the film's loudness…" : "The page plays this film's last mix, before the final loudness pass, so these are the page's levels, not the video's.";
  const clear = () => { clipped.current = [null, null]; };
  return (
    <div className="col-start-3 row-span-2 row-start-2 ms-2 grid w-16 grid-rows-[auto_minmax(0,1fr)_auto] gap-1 text-[11px] leading-none text-muted-foreground tabular-nums">
      <Tip side="left" label={<span className="block max-w-64 leading-normal">Short-term loudness (3 s), in LUFS. Target {loudness?.target ?? -14}. {about}</span>}>
        <span tabIndex={0} className="flex items-center justify-between gap-0.5 rounded-sm px-0.5 py-0.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span ref={short}>−∞</span>
          {over && <TriangleAlert aria-label="Peaks over −1 dBTP after the loudness pass" className="ms-auto size-3 flex-none text-warn" />}
          <span className="text-muted-foreground">S</span>
        </span>
      </Tip>
      <div className="relative min-h-0">
        <canvas ref={canvas} role="img" aria-label="Master meter: left and right peaks, short-term loudness and the target line" className="absolute inset-0 block size-full" />
        <Tip side="left" label="Clip lights: red once a channel has gone over 0 dB in the final render. Click to clear">
          <button type="button" aria-label="Clear the clip lights" onClick={clear} className="absolute top-0 left-0 h-2.5 w-4.5 cursor-pointer rounded-xs focus-visible:ring-2 focus-visible:ring-ring" />
        </Tip>
      </div>
      <Tip side="left" label="Integrated loudness since Play was last pressed, in LUFS">
        <span tabIndex={0} className="flex items-center justify-between gap-0.5 rounded-sm px-0.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span ref={whole} className="text-foreground">−∞</span>
          <span>I</span>
        </span>
      </Tip>
    </div>
  );
}
