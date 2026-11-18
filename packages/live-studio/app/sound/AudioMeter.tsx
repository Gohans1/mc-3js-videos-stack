// The master meter at the right of the timeline, as editors show one (CapCut, Premiere's Audio Meters): each channel's peak with
// its hold, the short-term loudness against the film's target, and a clip light per channel. Every number is the final render's,
// the loudness pass's gain added (meter.ts), so what goes red here goes red in mix.wav. Settings, View, Audio meter hides it;
// a phone never runs it
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";

import { Tip } from "../components/Tip";
import { useSmall } from "../core/device";
import { S } from "../core/state";
import { get, say, useStudio } from "../core/store";
import { stamp } from "../core/time";
import { sized, tone, UI_FONT } from "../timeline/canvas";
import { hasSounding, onAudioReady } from "./clock";
import { measureFinal, readMeter, resetLoudness, startMeter, stopMeter } from "./meter";
import { hasPreviewSounding } from "./mixer";

const FLOOR = -60,
  TOP = 0;
export const meterKeepRunning = (
  playing: boolean,
  now: number,
  activeUntil: number,
  shortTerm: number,
) => playing || hasSounding() || hasPreviewSounding() || now < activeUntil || shortTerm > FLOOR;
const SCALE = [0, -6, -12, -18, -24, -36, -48, -60];
const HOLD = 1.5,
  FALL = 20 / 1.7; // IEC TR 60268-18's digital peak meter: back 20 dB in 1.7 s; the hold mark waits 1.5 s first
const YELLOW = -12,
  RED = -1; // red from -1 dBTP, where the upload's AAC encode can clip
const fixed = (v: number) =>
  Number.isFinite(v) ? (v > -0.05 && v < 0.05 ? "0.0" : v.toFixed(1)) : "−∞";
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;

export function AudioMeter() {
  const small = useSmall(),
    on = useStudio((s) => s.meter) && !small,
    live = useStudio((s) => s.liveLanes),
    loudness = useStudio((s) => s.loudness);
  const canvas = useRef<HTMLCanvasElement>(null),
    short = useRef<HTMLSpanElement>(null),
    whole = useRef<HTMLSpanElement>(null);
  const clipped = useRef<[number | null, number | null]>([null, null]); // film second each channel first went over 0 dBFS
  const pokeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!on) return;
    void startMeter();
    measureFinal();
    const C = {
      ok: tone("ok"),
      warn: tone("warn"),
      red: tone("destructive"),
      loud: tone("primary"),
      track: tone("raised-2"),
      text: tone("muted-foreground"),
      mark: tone("foreground"),
    };
    const shown = [FLOOR, FLOOR],
      held = [FLOOR, FLOOR],
      heldAt = [0, 0];
    let raf = 0,
      last = performance.now(),
      wasPlaying = false,
      activeUntil = 0,
      sizeDirty = true,
      boxG: CanvasRenderingContext2D | null = null,
      boxW = 0,
      boxH = 0,
      boxDpr = 0,
      bgCanvas: HTMLCanvasElement | null = null,
      bgW = 0,
      bgH = 0,
      bgDpr = 0,
      lastShortText = "",
      lastWholeText = "",
      drawnTarget = NaN,
      drawnClip0 = false,
      drawnClip1 = false,
      drawnSh0 = NaN,
      drawnSh1 = NaN,
      drawnHl0 = NaN,
      drawnHl1 = NaN,
      drawnSt = NaN;
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const wakeMeter = () => {
      activeUntil = Math.max(activeUntil, performance.now() + 250);
      last = performance.now();
      schedule();
    };
    pokeRef.current = () => {
      drawnSh0 = NaN;
      schedule();
    };
    const drawStaticBg = (w: number, h: number, dpr: number) => {
      if (!bgCanvas) bgCanvas = document.createElement("canvas");
      const pw = Math.round(w * dpr),
        ph = Math.round(h * dpr);
      if (bgCanvas.width !== pw || bgCanvas.height !== ph) {
        bgCanvas.width = pw;
        bgCanvas.height = ph;
      }
      const bg = bgCanvas.getContext("2d");
      if (!bg) return;
      bg.setTransform(dpr, 0, 0, dpr, 0, 0);
      bg.clearRect(0, 0, w, h);
      const led = 6,
        y0 = led + 4,
        y1 = h - 2,
        bar = 5,
        gap = 2,
        lx = 1,
        span = TOP - FLOOR,
        height = y1 - y0;
      const y = (d: number) => y0 + ((TOP - Math.max(FLOOR, Math.min(TOP, d))) / span) * height;
      bg.fillStyle = C.track;
      bg.fillRect(lx, y0, bar, height);
      bg.fillRect(lx + bar + gap, y0, bar, height);
      bg.fillRect(lx + 2 * (bar + gap) + 2, y0, bar, height);
      bg.font = `10px ${UI_FONT}`;
      bg.textAlign = "right";
      bg.textBaseline = "middle";
      bg.fillStyle = C.text;
      for (const d of SCALE) {
        bg.fillText(String(Math.abs(d)), w - 1, Math.min(y1 - 4, Math.max(y0 + 4, y(d))));
      }
      bgW = w;
      bgH = h;
      bgDpr = dpr;
    };
    const frame = () => {
      raf = 0;
      const now = performance.now(),
        dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (S.playing && !wasPlaying) resetLoudness();
      wasPlaying = S.playing;
      const r = readMeter(get().loudness?.gain ?? 0);
      let keepRunning = meterKeepRunning(S.playing, now, activeUntil, r.shortTerm);
      for (let c = 0; c < 2; c++) {
        const p = r.peak[c];
        shown[c] = Math.max(p, shown[c] - FALL * dt, FLOOR);
        if (p >= held[c]) {
          held[c] = p;
          heldAt[c] = now;
        } else if (now - heldAt[c] > HOLD * 1000) held[c] = Math.max(shown[c], held[c] - FALL * dt);
        if (p > FLOOR || shown[c] > FLOOR || held[c] > FLOOR) keepRunning = true;
        if (p >= 0 && clipped.current[c] === null) {
          if (clipped.current[1 - c] === null)
            say(
              `The sound clips at ${stamp(S.t)} in the final render: lower the sounds there, or "drive" in audio.json`,
              6000,
            );
          clipped.current[c] = S.t;
        }
      }
      if (short.current) {
        const txt = fixed(r.shortTerm);
        if (txt !== lastShortText) {
          lastShortText = txt;
          short.current.textContent = txt;
        }
      }
      if (whole.current) {
        const txt = fixed(r.integrated);
        if (txt !== lastWholeText) {
          lastWholeText = txt;
          whole.current.textContent = txt;
        }
      }

      try {
        const el = canvas.current;
        if (!el) return;
        if (sizeDirty) {
          if (!el.offsetParent) return;
          const s = sized(el);
          boxG = s.g;
          boxW = s.w;
          boxH = s.h;
          boxDpr = devicePixelRatio || 1;
          sizeDirty = false;
          drawnSh0 = NaN;
        }
        if (!boxG || boxW <= 0 || boxH <= 0) return;
        const g = boxG,
          w = boxW,
          h = boxH,
          dpr = boxDpr,
          led = 6,
          y0 = led + 4,
          y1 = h - 2,
          span = TOP - FLOOR,
          height = y1 - y0,
          target = get().loudness?.target ?? -14,
          clip0 = clipped.current[0] !== null,
          clip1 = clipped.current[1] !== null,
          qScale = height / span,
          sh0 = shown[0] > FLOOR ? Math.round((shown[0] - FLOOR) * qScale * 2) : -1,
          sh1 = shown[1] > FLOOR ? Math.round((shown[1] - FLOOR) * qScale * 2) : -1,
          hl0 = held[0] > FLOOR ? Math.round((held[0] - FLOOR) * qScale * 2) : -1,
          hl1 = held[1] > FLOOR ? Math.round((held[1] - FLOOR) * qScale * 2) : -1,
          st = r.shortTerm > FLOOR ? Math.round((r.shortTerm - FLOOR) * qScale * 2) : -1;
        if (
          sh0 === drawnSh0 &&
          sh1 === drawnSh1 &&
          hl0 === drawnHl0 &&
          hl1 === drawnHl1 &&
          st === drawnSt &&
          clip0 === drawnClip0 &&
          clip1 === drawnClip1 &&
          target === drawnTarget &&
          w === bgW &&
          h === bgH &&
          dpr === bgDpr
        )
          return;
        drawnSh0 = sh0;
        drawnSh1 = sh1;
        drawnHl0 = hl0;
        drawnHl1 = hl1;
        drawnSt = st;
        drawnClip0 = clip0;
        drawnClip1 = clip1;
        drawnTarget = target;
        if (w !== bgW || h !== bgH || dpr !== bgDpr) drawStaticBg(w, h, dpr);

        const y = (d: number) => y0 + ((TOP - Math.max(FLOOR, Math.min(TOP, d))) / span) * height;
        g.clearRect(0, 0, w, h);
        if (bgCanvas) g.drawImage(bgCanvas, 0, 0, w, h);
        const bar = 5,
          gap = 2,
          lx = 1,
          x0 = lx,
          x1 = lx + bar + gap,
          x2 = lx + 2 * (bar + gap) + 2;
        const yFloor = y(FLOOR),
          yYellow = y(YELLOW),
          yRed = y(RED);
        // The two peaks, coloured by the zone they reach
        for (let c = 0; c < 2; c++) {
          const x = c === 0 ? x0 : x1,
            v = shown[c];
          if (v > FLOOR) {
            const topYellow = y(Math.min(v, YELLOW));
            g.fillStyle = C.ok;
            g.fillRect(x, topYellow, bar, yFloor - topYellow);
            if (v > YELLOW) {
              const topRed = y(Math.min(v, RED));
              g.fillStyle = C.warn;
              g.fillRect(x, topRed, bar, yYellow - topRed);
              if (v > RED) {
                const topClip = y(Math.min(v, TOP));
                g.fillStyle = C.red;
                g.fillRect(x, topClip, bar, yRed - topClip);
              }
            }
          }
          if (held[c] > FLOOR) {
            g.fillStyle = held[c] >= RED ? C.red : C.mark;
            g.fillRect(x, Math.round(y(held[c])), bar, 1);
          }
          g.fillStyle = (c === 0 ? clip0 : clip1) ? C.red : C.track;
          g.fillRect(x, 0, bar, led);
        }
        // The short-term loudness beside them, with the film's target across it
        if (r.shortTerm > FLOOR) {
          const ySt = y(r.shortTerm);
          g.fillStyle = C.loud;
          g.fillRect(x2, ySt, bar, y1 - ySt);
        }
        g.fillStyle = C.mark;
        g.fillRect(x2 - 2, Math.round(y(target)), bar + 4, 1);
      } finally {
        if (keepRunning) schedule();
      }
    };
    const offPlay = S.watch("playing", () => {
      if (S.playing) wakeMeter();
    });
    const offAudio = S.watch("audio", wakeMeter);
    const offReady = onAudioReady(() => wakeMeter());
    const el = canvas.current;
    const parent = el?.parentElement;
    const ro =
      el || parent
        ? new ResizeObserver(() => {
            sizeDirty = true;
            schedule();
          })
        : null;
    if (ro && el) ro.observe(el);
    if (ro && parent) ro.observe(parent);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      pokeRef.current = null;
      offPlay();
      offAudio();
      offReady();
      ro?.disconnect();
      stopMeter();
    };
  }, [on]);

  useEffect(() => {
    pokeRef.current?.();
  }, [loudness]);

  if (!on) return null;
  // more than YouTube's 1 LU short: the same line bun run mix prints, so the creator and the AI see one lever
  const under = loudness && loudness.held > 1;
  const about = loudness
    ? `The final render moves the whole film by ${signed(loudness.gain)} dB, from ${loudness.before.toFixed(1)} to ${(loudness.before + loudness.gain).toFixed(1)} LUFS, and these numbers already include that. ${under ? `That is ${loudness.held.toFixed(1)} dB short of ${loudness.target}: more would push its loudest peak over −1.5 dBTP. Louder: raise "drive" in audio.json (bun run mix names the value); its limiter takes the peaks and each dB buys a third to a half of one, and past +12 the hits flatten.` : `Its loudest peak is then ${signed(loudness.truePeak)} dBTP.`}`
    : live
      ? "Measuring the film's loudness…"
      : "The page plays this film's last mix, before the final loudness pass, so these are the page's levels, not the video's.";
  const clear = () => {
    clipped.current = [null, null];
    pokeRef.current?.();
  };
  return (
    <div className="text-tag text-muted-foreground col-start-3 row-span-2 row-start-2 ms-2 grid w-16 grid-rows-[auto_minmax(0,1fr)_auto] gap-1 leading-none tabular-nums">
      <Tip
        side="left"
        label={
          <span className="block max-w-64 leading-normal">
            Short-term loudness (3 s), in LUFS. Target {loudness?.target ?? -14}. {about}
          </span>
        }
      >
        <span
          tabIndex={0}
          className="text-foreground focus-visible:ring-ring flex items-center justify-between gap-0.5 rounded-sm px-0.5 py-0.5 outline-none focus-visible:ring-2"
        >
          <span ref={short}>−∞</span>
          {under && (
            <TriangleAlert
              aria-label="Quieter than the target: its peaks stop the loudness pass"
              className="text-warn-text ms-auto size-3 flex-none"
            />
          )}
          <span className="text-muted-foreground">S</span>
        </span>
      </Tip>
      <div className="relative min-h-0">
        <canvas
          ref={canvas}
          role="img"
          aria-label="Master meter: left and right peaks, short-term loudness and the target line"
          className="absolute inset-0 block size-full"
        />
        <Tip
          side="left"
          label="Clip lights: red once a channel has gone over 0 dB in the final render. Click to clear"
        >
          <button
            type="button"
            aria-label="Clear the clip lights"
            onClick={clear}
            className="focus-visible:ring-ring absolute top-0 left-0 h-2.5 w-4.5 cursor-pointer rounded-xs focus-visible:ring-2"
          />
        </Tip>
      </div>
      <Tip side="left" label="Integrated loudness since Play was last pressed, in LUFS">
        <span
          tabIndex={0}
          className="focus-visible:ring-ring flex items-center justify-between gap-0.5 rounded-sm px-0.5 py-0.5 outline-none focus-visible:ring-2"
        >
          <span ref={whole} className="text-foreground">
            −∞
          </span>
          <span>I</span>
        </span>
      </Tip>
    </div>
  );
}
