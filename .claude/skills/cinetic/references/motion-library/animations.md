# Animations

How things move: entrances, exits, type builds, swaps, morphs, counters, cascades, physics and loops. Each
entry gives the job the move does, its numbers (in seconds and in frames), named presets, what makes it rich or cheap,
and deterministic TypeScript recipes that are pure functions of the frame (no state, no `Math.random`).

**Units.** Durations are given in seconds and in frames at 30 fps; author in seconds (`sf(s, fps)`) and never copy a
frame count across frame rates. Per-frame tables are authored at a stated rate and played with `tbl(f, f0, values,
srcFps, fps)`. A decay given "per frame" is per 30 fps frame: at 60 fps use the square root of the ratio, at 24 fps the
ratio to the power 1.25. Stepped animation keeps its step in source frames (on twos at 30 fps = a new pose every
66.7 ms = every 4th frame at 60). px are at 1920 x 1080.

---

## Ten laws (read before picking an entry)

1. **Snap, then settle.** Most moves start at full speed and spend the rest braking: about a third of all moves peak
   in their first 12 %.
2. **Harmonic `spring()` cannot snap** (it starts at zero velocity). Use springs for weighted landings, and a bezier
   snap or a per-frame table for text and settles.
3. **Short.** Entrances 0.3-0.6 s, fades 0.25 s, scale or rotate pops 0.07-0.2 s.
4. **Exits accelerate and are cut at peak speed;** the next shot enters moving the same way.
5. **Overshoot only on object landings** (3-12 %). Text and camera settle clean.
6. **Cascades are fast:** 1-3 f for groups of four or more, 4-7 f for the words of a statement.
7. **Colour is motion:** arrivals are tinted and drain to ink in 3-9 f.
8. **Motion blur in proportion to speed** (0.5 x the per-frame displacement), only while fast.
9. **Every hold still moves** (a drift tail, a shimmer) but never bobs.
10. **Stepped time (on twos) for digital content only,** never for the camera or the hero.

Directions balance: enter from the bottom first, then the top, then the sides; exits mirror that.
Cascades run left-to-right and right-to-left about equally (follow the motion), top to bottom for lists.

## The curve palette

House cubic-beziers (control points x1, y1, x2, y2) and what they are for.

| token        | bezier                 | shape                | use                                                 |
| ------------ | ---------------------- | -------------------- | --------------------------------------------------- |
| `land`       | 0.2, 0.8, 0.3, 1       | ease-out             | the default landing for UI, dots, staircase settles |
| `expoOut`    | 0.16, 1, 0.3, 1        | strong ease-out      | arrivals, slides, wordmark slides                   |
| `glide`      | 0.1, 0.7, 0.3, 1       | strong ease-out      | long glides, slow lockups                           |
| `rise`       | 0.16, 0.84, 0.3, 1     | strong ease-out      | word rises                                          |
| `wordIn`     | 0.13, 0.68, 0.15, 0.93 | strong ease-out      | the canonical word entry                            |
| `outQuint`   | 0.22, 1, 0.36, 1       | strong ease-out      | settle after a cut-like pop                         |
| `circOut`    | 0, 0.37, 0.15, 0.9     | strong ease-out      | a photo settling 1.09 -> 1.00                       |
| `snap`       | 0, 1, 0.45, 1          | snap                 | append-recentre (69 % of the move on frame 1 of 8)  |
| `popSnap`    | 0.01, 0.88, 0.61, 1.16 | snap + 3 % overshoot | avatar pops                                         |
| `backOut`    | 0.35, 1.15, 0.9, 1     | small overshoot      | object landings                                     |
| `anticipate` | 0, -0.21, 0.158, 1.007 | pre-move + land      | a landing with a tiny wind-up                       |
| `sCurve`     | 0.45, 0, 0.55, 1       | in-out               | camera-like transfers                               |
| `sCurveHard` | 0.65, 0, 0.35, 1       | in-out               | decisive transfers                                  |
| `material`   | 0.4, 0, 0.2, 1         | in-out               | stroke draws, scale 1 -> 1.75                       |
| `pushPull`   | 0.45, 0, 0.25, 1       | in-out               | pull-backs, card stages                             |
| `sine`       | 0.35, 0, 0.7, 1        | in-out               | slow zoom-ins                                       |
| `exit`       | 0.55, 0, 1, 0.45       | strong ease-in       | ease-in pans and exits                              |
| `exitSoft`   | 0.55, 0, 0.9, 0.45     | ease-in              | shrink exits                                        |
| `sink`       | 0.6, 0, 0.9, 0.5       | ease-in              | sinks, lockup exits                                 |

House springs (`Spr` configs), with overshoot and settle time.

| token         | config           | damping ratio | overshoot | settles (24 / 30 / 60 fps) | use                          |
| ------------- | ---------------- | ------------- | --------- | -------------------------- | ---------------------------- |
| `landing`     | m 1, k 180, d 16 | 0.60          | 9.6 %     | 12 / 14 / 28 f             | object landings              |
| `landingFirm` | m 1, k 180, d 18 | 0.67          | 5.8 %     | 12 / 15 / 30 f             | firmer landings              |
| `zoomSettle`  | m 1, k 120, d 18 | 0.82          | 1.1 %     | 14 / 17 / 33 f             | a list arriving zoomed x1.17 |
| `cardSettle`  | m 1, k 140, d 20 | 0.85          | 0.7 %     | 9 / 12 / 23 f              | a card 1.10 -> 1.00          |
| `glide`       | m 1, k 90, d 20  | 1.05          | 0         | 19 / 24 / 47 f             | a slow shift, no overshoot   |
| `riseFirm`    | m 1, k 210, d 26 | 0.90          | 0.2 %     | 9 / 11 / 22 f              | a word rise alternative      |
| `bounce`      | m 1, k 260, d 16 | 0.50          | 16.5 %    | 14 / 17 / 33 f             | playful drops                |
| `bounceHard`  | m 1, k 300, d 14 | 0.40          | 24.9 %    | 16 / 20 / 40 f             | heaps, balls                 |
| `tumble`      | m 1, k 180, d 12 | 0.45          | 20.7 %    | 16 / 20 / 40 f             | a logo tile tumbling in      |

Scale pops are about four times stiffer than moves (damping ratio about 0.66 at about 5 Hz). When a move must show
most of its travel on the first frame, use `snap` or a table, never a spring.

## Shared kit (`motion.ts`)

Every implementation below imports this file. It holds the curve and spring tokens, `sf()` (seconds to frames),
`tw()` (a tween with a bezier), `tbl()` (a per-frame table at any rate), `snapRem()` (a first-frame-heavy decay) and a
directional smear.

```ts
import { Easing, interpolate, interpolateColors, random, spring } from "./lib/anim";
export type Bz = readonly [
    number,
    number,
    number,
    number
];
/** House curve palette (the curve table above). */
export const CURVE = {
    snap: [0, 1, 0.45, 1], // Recentre table (69 % of the move in frame 1 of 8 @30)
    land: [0.2, 0.8, 0.3, 1], // the default ease-out
    expoOut: [0.16, 1, 0.3, 1], // rises, re-centres, slides
    glide: [0.1, 0.7, 0.3, 1], // card stages, slides
    rise: [0.16, 0.84, 0.3, 1], // word rise
    wordIn: [0.13, 0.68, 0.15, 0.93], // Canonical word entry (the word-rise table)
    outQuint: [0.22, 1, 0.36, 1], // Settle after a cut-like pop
    circOut: [0, 0.37, 0.15, 0.9], // Photo settling zoom 1.09 -> 1.00
    popSnap: [0.01, 0.88, 0.61, 1.16], // Avatar pop (one 3 % overshoot)
    backOut: [0.35, 1.15, 0.9, 1], // Small overshoot landing
    sCurve: [0.45, 0, 0.55, 1],
    sCurveHard: [0.65, 0, 0.35, 1],
    material: [0.4, 0, 0.2, 1], // stroke draws, scale 1 -> 1.75
    pushPull: [0.45, 0, 0.25, 1], // Pull-back, card stage 2
    sine: [0.35, 0, 0.7, 1], // Slow zoom-in (sineInOut)
    exit: [0.55, 0, 1, 0.45], // Ease-in pans and exits
    exitSoft: [0.55, 0, 0.9, 0.45], // Shrink, exit (0.55,0,0.9,0.4)
    sink: [0.6, 0, 0.9, 0.5], // Sink, lockup exit (0.6,0,1,0.6)
    anticipate: [0, -0.21, 0.158, 1.007], // Landing with a tiny pre-move
} as const satisfies Record<string, Bz>;
export const ez = (c: Bz) => Easing.bezier(c[0], c[1], c[2], c[3]);
export const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** One tween. f0 and dur in frames of the composition. */
export const tw = (f: number, f0: number, dur: number, a: number, b: number, c: Bz = CURVE.land) => dur <= 0 ? (f >= f0 ? b : a) : interpolate(f, [f0, f0 + dur], [a, b], { ...CL, easing: ez(c) });
/** Author in seconds; convert once. 24/30/60 fps all work. */
export const sf = (s: number, fps: number) => Math.max(1, Math.round(s * fps));
/** A per-frame table authored at srcFps, played at any fps (a table beats a curve when both exist). */
export const tbl = (f: number, f0: number, vals: readonly number[], srcFps: number, fps: number) => {
    const t = ((f - f0) * srcFps) / fps;
    if (t <= 0)
        return vals[0];
    if (t >= vals.length - 1)
        return vals[vals.length - 1];
    const i = Math.floor(t);
    return vals[i] + (vals[i + 1] - vals[i]) * (t - i);
};
/** Snap-and-settle without a curve: share `first` of the move on the first 30-fps frame, then geometric decay q per frame. */
export const snapRem = (f: number, f0: number, fps: number, first = 0.69, q = 0.48) => {
    const t = ((f - f0) * 30) / fps;
    if (t <= 0)
        return 1;
    if (t < 1)
        return 1 - first * t;
    const r = (1 - first) * Math.pow(q, t - 1);
    return r < 0.002 ? 0 : r;
};
/** House spring presets (damping ratio, overshoot and settle frames in the spring table above). */
export const SPRING = {
    landing: { mass: 1, stiffness: 180, damping: 16 }, // 9.6 % overshoot, settles 14 f @30
    landingFirm: { mass: 1, stiffness: 180, damping: 18 }, // 5.8 %, 15 f @30
    zoomSettle: { mass: 1, stiffness: 120, damping: 18 }, // List zoomed x1.17: 1.1 %, 17 f @30
    cardSettle: { mass: 1, stiffness: 140, damping: 20 }, // Card 1.10 -> 1.00: 0.7 %, 12 f @30
    glide: { mass: 1, stiffness: 90, damping: 20 }, // No overshoot, 24 f @30
    riseFirm: { mass: 1, stiffness: 210, damping: 26 }, // Word rise alternative: 0.2 %, 11 f @30
    bounce: { mass: 1, stiffness: 260, damping: 16 }, // 16.5 %
    bounceHard: { mass: 1, stiffness: 300, damping: 14 }, // 24.9 %
    tumble: { mass: 1, stiffness: 180, damping: 12 }, // Logo tile: 20.7 %
    click: { mass: 0.6, stiffness: 300, damping: 18 }, // Button press: 5.8 %, 9 f @30
} as const;
export const sp = (f: number, f0: number, fps: number, cfg: {
    mass: number;
    stiffness: number;
    damping: number;
}) => spring({ frame: f - f0, fps, config: cfg });
/** Rank order for staggers. */
export type Order = "ltr" | "rtl" | "center" | "edges" | "random";
export const ranks = (n: number, mode: Order = "ltr", seed = "stagger"): number[] => {
    const idx = [...Array(n).keys()];
    let o = idx;
    if (mode === "rtl")
        o = [...idx].reverse();
    if (mode === "center")
        o = [...idx].sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
    if (mode === "edges")
        o = [...idx].sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
    if (mode === "random")
        o = [...idx].sort((a, b) => random(seed + a) - random(seed + b));
    const r = new Array(n).fill(0);
    o.forEach((i, k) => (r[i] = k));
    return r;
};
/** Stepped clock: animate on twos or threes (digital content only). */
export const stepped = (f: number, every = 2) => Math.floor(f / every) * every;
/** Velocity of any pure position function, in px per frame. */
export const vel = (fn: (f: number) => number, f: number) => fn(f) - fn(f - 1);
/** Directional smear. Cheap: one SVG Gaussian per element. */
export const Smear: (props: {
    id: string;
    sx?: number;
    sy?: number;
    children: unknown;
}) => unknown = ({ id, sx = 0, sy = 0, children }) => {
    const on = Math.abs(sx) > 0.3 || Math.abs(sy) > 0.3;
    return ([on && ({
            kind: "vector",
            width: 0,
            height: 0,
            style: { position: "absolute" },
            "aria-hidden": true,
            children: {
                kind: "filter",
                id: id,
                x: "-60%",
                y: "-60%",
                width: "220%",
                height: "220%",
                children: { kind: "feGaussianBlur", stdDeviation: `${Math.abs(sx)} ${Math.abs(sy)}` }
            }
        }), { kind: "layer", style: { filter: on ? `url(#${id})` : undefined }, children: children }]);
};
/** Colour over a path of stops (arrival tints, heat ramps). */
export const colourPath = (f: number, f0: number, stops: readonly string[], framesPerStop: number) => interpolateColors(f, stops.map((_, i) => f0 + i * framesPerStop), [...stops]);
```

## Index

| #   | slug                  | animation                                           | family            |
| --- | --------------------- | --------------------------------------------------- | ----------------- |
| 1   | `snap-settle`         | snap-and-settle, the first-frame-heavy ease         | timing            |
| 2   | `word-build-recentre` | word build with a re-centring line                  | type              |
| 3   | `word-rise`           | canonical word entrance: rise, contrast ramp, smear | type              |
| 4   | `arrival-tint`        | born in an accent or heat ramp, drains to ink       | type, colour      |
| 5   | `grow-push`           | make-room insert: an object pushes the words apart  | type, object      |
| 6   | `whip-exit-match`     | accelerating exit cut at peak speed, matched entry  | exit, transition  |
| 7   | `pop-overshoot`       | pop with one overshoot                              | entrance          |
| 8   | `decode`              | decode, scramble, anagram resolve                   | type              |
| 9   | `spring-land-zoom`    | arrives zoomed or offset, settles with a spring     | entrance          |
| 10  | `stagger-cascade`     | stagger cascades, 1-7 frames                        | stagger           |
| 11  | `stroke-draw`         | path draw-on, trim, erase, connectors               | path              |
| 12  | `letter-reveal`       | per-letter wordmark reveal                          | type, logo        |
| 13  | `morph-container`     | container morph between roles                       | morph             |
| 14  | `swap-drum`           | slot drum, baseline flip-up, word swap              | swap              |
| 15  | `mask-reveal`         | line-mask rise, soft-mask slide, clip-slot exit     | reveal            |
| 16  | `counter-cut`         | counter on cut digits, decelerating                 | counter           |
| 17  | `tracking-snap`       | tracking snap and letter-spacing spring             | type              |
| 18  | `blur-resolve`        | focus-pull entrance                                 | entrance          |
| 19  | `smear-arrival`       | smear arrival with halving offsets                  | entrance, physics |
| 20  | `snap-growth`         | spring-loaded snap growth and wind-up               | transform         |
| 21  | `exit-shrink-rise`    | accelerating exits: shrink, rise, vanish            | exit              |
| 22  | `punch-in`            | punch-in, snap zoom, re-punch                       | transform, camera |
| 23  | `gravity-squash`      | gravity drop, bounce, squash and stretch            | physics           |
| 24  | `pendulum`            | damped swing                                        | physics, acting   |
| 25  | `word-bounce-alt`     | word spring bounce, alternating sides               | type, physics     |
| 26  | `arc-flight`          | arc flight with separate x / y / scale / rotation   | move              |
| 27  | `fly-from-lens`       | fly-in from the lens                                | entrance, 3D      |
| 28  | `flip3d`              | 3D flip-up, swing-in, tilt to flat                  | entrance, 3D      |
| 29  | `grow-from-dot`       | grow from a dot or a line                           | entrance          |
| 30  | `radial-cascade`      | distance-staggered field                            | stagger           |
| 31  | `front-sweep`         | colour or fill front through text                   | type, colour      |
| 32  | `shimmer`             | shimmer loop, loading dots, indicator pulse         | loop              |
| 33  | `orbit`               | orbit ring, follow-the-leader, travelling wave      | loop, path        |
| 34  | `on-twos`             | stepped clock on twos or threes                     | timing            |
| 35  | `font-cycle`          | font and colour cycle hops                          | type              |
| 36  | `split-assemble`      | one into many, many into one                        | morph, stagger    |
| 37  | `collapse-to-icon`    | the icon eats the line                              | exit, morph       |
| 38  | `drift-tail`          | the purposeful never-still hold                     | timing            |
| 39  | `echo-swarm`          | jump-echo stamps and z-swarm copies                 | motion            |

---

## Entries

### 1. Snap-and-settle (first-frame-heavy ease) · `snap-settle`

Family: timing.

**Job.** Every change feels decided and immediate, like an editor cutting on the action: the eye registers the new
state on the first frame, and the braking tail gives it weight and calm. It is what makes a re-centre, a list step or a
snap zoom read as designed instead of animated.

**Numbers.**

- First frame: 40-80 % of the move (often a cut-on), then a geometric braking tail.
- First-frame share by use: 0.38-0.40 for a lockup slide, 0.63-0.70 for a line re-centre, 0.80 for a snap zoom, 0.90
  for a status line pushing up.
- Settle tail: 2 f (status push), 6 f (line step), 8 f (re-centre), 15 f, up to 20 f at 24 fps (lockup). No overshoot.
- Curve: `snap` (0, 1, 0.45, 1) or the decay `snapRem(first, q = 0.48)`; `outQuint` after a true cut-on.

**Presets.**

- _Append re-centre._ Per-frame share of the move 0, 0.69, 0.85, 0.93, 0.97, 0.99, 1.0 (8 f at 30 fps).
- _Line step._ 60-70 % of the step in one frame, the rest over about 6 frames.
- _Lockup slide_ (24 fps). 40 % of a 498 px slide on frame 1, then 874, 676, 564, 508, 474, 448, 428, 414, 402, 394,
  388, 382, 380, 378, 376 px over 15 frames.
- _Make-room jump._ Words jump apart 59-73 % in one frame; the new word cuts on in the gap.
- _Snap zoom._ A 2-frame log-scale zoom with about 80 % on the first frame.
- _Ticker jump._ About 200 px on the first frame, an expo-out tail of 6-8 f.
- _Status push._ A status line pushes up 44 px, then 4 px, then 1 px.

**Rich.** The first frame already shows the new state (60-70 %), so the cut and the motion are one event; the tail is
long and quiet (6-15 f), decaying geometrically, never overshooting; it lands on a beat or a hit and the tail runs
under the next word.

**Cheap.** A symmetric ease-in-out on the same move (it reads as animated); a spring from rest (the first frame shows
almost nothing); snapping 100 % with no tail (a glitch) or a tail with a bounce.

```ts
import { CURVE, sf, snapRem, tw } from "./motion";
/** Move a value from a to b with a snap. settleS 0.27 s = 8 f @30, 6 f @24, 16 f @60. */
export const snapTo = (f: number, f0: number, a: number, b: number, fps: number, settleS = 0.27) => tw(f, f0, sf(settleS, fps), a, b, CURVE.snap);
/** Same with an explicit first-frame share (0.4, 0.69, 0.8 snap zoom). */
export const snapShare = (f: number, f0: number, a: number, b: number, fps: number, first = 0.69) => b + (a - b) * snapRem(f, f0, fps, first);
// Example: a status line pushes up by 44 px when a new row cuts on.
export const StatusPush: (props: {
    atS: number;
    children: unknown;
}) => unknown = ({ atS, children, }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const y = snapShare(f, sf(atS, fps), 44, 0, fps, 0.9);
    return { kind: "layer", style: { transform: `translateY(${y}px)` }, children: children };
};
```

### 2. Word build with a re-centring line · `word-build-recentre`

Family: type. Starter: pure recipe (`lib/moves.ts` math).

**Job.** Type with life: the sentence is spoken visually at the speed of the voice, and the line breathing outward on
every word tells the viewer where to look without a single decorative element. It is the backbone of voice- or
beat-driven captions.

**Numbers.**

- Word cadence: 2 f (fast), 4-7 f (statements), 6-9 f (captions), 10-12 f (slow, each word tinted); follow the voice's
  syllables or the beat.
- Re-centre: a snap of 6-8 f, or a slow glide (an ease-out sampled every 6 f, 42 f at 60 fps).
- The first frame of a word: cut on in ink, at 40 % opacity (full on the next step), tinted, or the canonical rise
  (`word-rise`).
- Extras: the whole line scaling 0.95 -> 1.0 during the build; a block shrinking 0.4 % per frame; a drift left before
  the exit.

**Presets.**

- _Caption build._ Each word cuts on in ink; the line re-centres in 4 frames (for example 902 -> 888 -> 885 -> 884 ->
  883 px left edge); the next word 8 f later.
- _Tinted build._ One word every 10-12 f, each tinted on arrival then ink; small blinking indicator squares; an
  expo glide re-centre.
- _Statement build._ Words 2-5 f apart with the canonical rise of about 55 px; the line's left edge steps 60-70 % on the
  word's first frame.
- _Symbols to words._ Two frames of symbols, two more, then the words of the line, the line re-centring every time; the
  last word arrives with an icon.
- _Slow build_ (60 fps). Each new word first at 40 % opacity, full on the next step; the block re-centres with a 6-frame
  ease-out sampled every 6 frames.
- _Scale-in build._ The first word cuts on, the second 2 f later, and the whole line re-centres while scaling 0.95 ->
  1.0 over about 20 f.

**Rich.** The step is a snap (most of it on the word's first frame) and its tail runs while the next word arrives; words
exactly centred at every rest, with spaces taken from the real font; the build follows the voice or the beat, and
the last word holds longer.

**Cheap.** A fixed left-aligned line that grows right and then jumps to centre at the end; every word fading in on a
constant timer regardless of rhythm; re-centring with an ease-in-out over 20 frames (the line swims).

```ts
import { measureText } from "./lib/measure";
import { CURVE, sf, tw } from "./motion";
import { wordIn } from "./word"; // the word-rise entry
const FONT = {
    fontFamily: "Inter",
    fontSize: 86,
    fontWeight: "600" as const,
    letterSpacing: "-0.02em",
};
type W = {
    text: string;
    atS: number;
};
export const WordBuild: (props: {
    words: W[];
    y?: number;
    recentreS?: number;
}) => unknown = ({ words, y = 540, recentreS = 0.27, }) => {
    const f = frame;
    const { fps, width } = filmDefaults();
    const space = measureText({ text: " ", ...FONT }).width;
    const w = words.map((x) => measureText({ text: x.text, ...FONT }).width);
    const lineW = (k: number) => w.slice(0, k).reduce((s, v) => s + v, 0) + space * Math.max(0, k - 1);
    const st = words.map((x) => sf(x.atS, fps));
    const k = st.filter((s) => f >= s).length;
    if (k === 0)
        return null;
    // target left edge for k words, plus the not-yet-settled half-width of every appended word
    let left = (width - lineW(k)) / 2;
    for (let i = 1; i < k; i++) {
        const half = (lineW(i + 1) - lineW(i)) / 2;
        left += half * (1 - tw(f, st[i], sf(recentreS, fps), 0, 1, CURVE.snap));
    }
    let x = left;
    return ([words.slice(0, k).map((wd, i) => {
            const e = wordIn(f, st[i], fps, 0.45 * 0.53 * FONT.fontSize); // rise = 0.45 x-height (x-height ~0.53 em)
            const el = ({
                kind: "layer",
                key: i,
                style: {
                    position: "absolute",
                    left: x,
                    top: y - FONT.fontSize * 0.6,
                    ...FONT,
                    opacity: e.opacity,
                    transform: `translateY(${e.dy}px)`,
                    filter: e.sy > 0.3 ? `blur(${e.sy * 0.5}px)` : undefined,
                    whiteSpace: "pre",
                },
                children: wd.text
            });
            x += w[i] + space;
            return el;
        })]);
};
```

### 3. Canonical word entrance (rise + contrast ramp + vertical smear) · `word-rise`

Family: type. Starter: pure recipe (`lib/moves.ts` math).

**Job.** The default way a spoken word lands. Each word gets a tiny physical arrival (weight from below) without
stealing attention from the sentence; repeated through a film it becomes the film's voice.

**Numbers.**

- The word appears in its final slot, starts below its baseline by about half an x-height and rises decelerating.
- Rise: 20-55 px (0.45 x the x-height, or 0.75 x the cap height); 4 f (crisp) to 15-16 f; half the rise done by frame
  1-2.
- First-frame opacity 0.3-0.7; full by frame 2-3.
- Smear: vertical 6 -> 3 -> 0 px at 1920 on the first three frames, or 2 px blur on the first frame.
- Stagger: 4 f headlines, 5 f short lines, 7 f statements.

**Presets.**

- _Voice word._ Rise 0.45 x the x-height: +40, +32, +24, +20, +16, +14, +12 px ... settling over 15 f; opacity 0.7 on
  frame 1; smear 6, 3, 0 px.
- _Statement word._ Rise 0.75 x the cap height (48 px at a 63 px cap): dy per frame 48, 32, 22, 17, 13, 11, 9, 8, 7, 6,
  5, 5, 4, 3, 2, 1, 0; opacity 0.34 on frame 1 (`wordIn`).
- _Short rise_ (24 fps). dy 52, 35, 25, 18, 13, 9, 6, 3, 2, 0 (or `riseFirm`).
- _Rise and darken._ Rise 30 px in 4 frames (the last word slower, 3 more), opacity 0.3 -> 1, grey to black or
  translucent to white; words 3 f apart.
- _Staircase settle._ Later words start lower and rise to the baseline on `land` while the line drifts left.

**Rich.** Most of the rise on frames 1-2, the last 20 % creeping in over 10 frames; frame 1 already reads (0.6-0.7 ink)
and is smeared vertically, not faded from zero; the rise scales with the type size, so big and small type feel the same
weight.

**Cheap.** Opacity 0 -> 1 over 15 frames plus a linear 40 px slide (a slide-deck fly-in); the same rise for every element
(cards, icons, words) instead of words only; a bounce at the end.

```ts
// word.ts
import { sf, tbl } from "./motion";
/** Word-rise tables @30 (from the first visible frame). */
export const RISE_TABLE = [
    1, 0.667, 0.458, 0.354, 0.271, 0.229, 0.188, 0.167, 0.146, 0.125, 0.104, 0.104, 0.083, 0.063,
    0.042, 0.021, 0,
];
export const INK_TABLE = [
    0.34, 0.56, 0.69, 0.77, 0.82, 0.85, 0.89, 0.91, 0.93, 0.94, 0.95, 0.97, 0.98, 1,
];
export const SMEAR_TABLE = [6, 3, 0]; // px at 1920 for a 40 px rise
export const wordIn = (f: number, f0: number, fps: number, risePx: number, firstInk = 0.6) => {
    if (f < f0)
        return { visible: false, dy: risePx, opacity: 0, sy: 0 };
    const dy = risePx * tbl(f, f0, RISE_TABLE, 30, fps);
    const ink = tbl(f, f0, INK_TABLE, 30, fps); // 0.34 .. 1
    const opacity = firstInk + (1 - firstInk) * ((ink - 0.34) / 0.66);
    const sy = tbl(f, f0, SMEAR_TABLE, 30, fps) * (risePx / 40);
    return { visible: true, dy, opacity, sy };
};
import { Smear } from "./motion";
export const Word: (props: {
    id: string;
    text: string;
    atS: number;
    risePx: number;
    style?: Record<string, string | number | undefined>;
}) => unknown = ({ id, text, atS, risePx, style }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const e = wordIn(f, sf(atS, fps), fps, risePx);
    if (!e.visible)
        return null;
    return ({ kind: "layer", style: { display: "inline-block", transform: `translateY(${e.dy}px)`, opacity: e.opacity }, children: Smear({
            id: `w-${id}`,
            sy: e.sy,
            children: { kind: "layer", style: style, children: text }
        }) });
};
```

### 4. Arrival tint: born in an accent or a heat ramp, drains to ink · `arrival-tint`

Family: type, colour. See also `effects.md` `colour-front-sweep`.

**Job.** Colour as motion: it marks the newest information without moving anything, and the decay makes the screen
settle back to calm. It also carries the brand accent into otherwise monochrome type.

**Numbers.**

- Hold: 0 f (typing, heat), 2-3 f (a landing word), or until the word ends.
- Drain: 3-6 f (typed characters), 6 f linear, 7 f (heat table), about 8 f (verbs), 12 f.
- Palette: one brand accent, or a heat ramp gold -> red-orange -> plum -> ink; on dark grounds the rest ink is white.
- Scope: a character (typing), a word (a build), a letter front (a wordmark), an object (a multiply tint).

**Presets.**

- _Heat in._ Seven frames of a five-stop gradient sliding left with the dark end on the right (the table is in
  `effects.md` `colour-front-sweep`).
- _Button heat._ Gold for 3 f, red-orange 1 f, magenta `#A33A64` 2 f, ink by frame 7, then grey out.
- _Typing head._ About 1.4 characters per frame; new characters pink-red `#E8434B`, black after 3-6 frames; a 2 px
  lead marker in the same pink follows.
- _Accent landing._ The word slides in from the right 30-60 px on an expo-out in 3-4 f with a smear on frame 1; the
  accent holds 2-3 f, then drains linearly to `#111111` over 6 f.
- _Word settle._ New words blue, settling to ink 3-9 f after the word ends; the lead indicator pulses 10 on / 10 off.
- _Icon colour._ Each verb cuts on in the colour of its icon and drains to black over about 8 frames.

**Rich.** One accent only, from the brand; a quick drain (0.3 s or less) so the screen is calm by the next word; the
tint travelling as a front (letters left to right, heat sliding left) instead of switching all at once; the accent
staying on one keyword.

**Cheap.** Rainbow or multi-hue tints with no system; permanent coloured keywords everywhere; a fade from transparent
instead of from colour.

```ts
import { interpolateColors } from "./lib/anim";
import { sf } from "./motion";
/** Accent hold then drain to ink. */
export const tintIn = (f: number, f0: number, fps: number, accent: string, ink: string, holdS = 0.083, drainS = 0.2) => {
    const h = f0 + sf(holdS, fps);
    return interpolateColors(f, [f0, h, h + sf(drainS, fps)], [accent, accent, ink]);
};
/** Heat_in: 7 frames @30, a 5-stop gradient across the word, dark end right, sliding left. */
export const HEAT_IN = [
    ["transparent", "transparent", "#F8D794", "#EEA653", "#CC6E56"],
    ["transparent", "#F8DA99", "#F1AA55", "#CB715D", "#80374C"],
    ["#F6C16B", "#E18650", "#A14756", "#461A2B", "#110509"],
    ["#D77B54", "#8E3D50", "#2E111B", "#030102", "#000000"],
    ["#AA5258", "#521F34", "#0F080B", "#000000", "#000000"],
    ["#6D2C43", "#1E0A12", "#000000", "#000000", "#000000"],
    ["#000000", "#000000", "#000000", "#000000", "#000000"],
];
export const HeatWord: (props: {
    text: string;
    atS: number;
    style?: Record<string, string | number | undefined>;
}) => unknown = ({ text, atS, style, }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const i = Math.floor(((f - sf(atS, fps)) * 30) / fps); // stepped per 30-fps frame
    if (i < 0)
        return null;
    const row = HEAT_IN[Math.min(i, 6)];
    return ({ kind: "layer", style: {
            ...style,
            backgroundImage: `linear-gradient(90deg, ${row.join(", ")})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
        }, children: text });
};
/** Typing head colour: a character typed at frame tc is pink-red, black after 3-6 f. */
export const charInk = (f: number, tc: number, fps: number) => tintIn(f, tc, fps, "#E8434B", "#0F0F0F", 0.033, 0.13);
```

### 5. Make-room insert: an object grows between words and pushes them apart · `grow-push`

Family: type, object. Starter: pure recipe (`lib/moves.ts` math).

**Job.** The picture enters the sentence: the product (an avatar, an app icon, a photo) takes its place in the claim.
One of the strongest type moments, and it makes the object the subject of the line.

**Numbers.**

- Gap opening: a 1-frame snap of 59-73 %, or a glide of 7-32 f.
- Object entrance: a pop 0.2 -> 1.03 -> 1.0 in 7 f, a cut-on at the peak of the slide, or scaleX 0 -> 1.
- Object size: the cap height to 1.6 x the cap (a 92 px avatar beside 78 px type).
- The type never changes size; the line stays centred; the object may then carry a zoom-through.

**Presets.**

- _Avatar push._ An avatar or porthole grows between two words and pushes them apart; only the lines move.
- _Rise, settle, slide_ (60 fps). The text rises 27 px on an ease-out over 16 f, settles 2 px back over 12 f, then
  slides 66 px left over 32 f to make room, and the avatar pops (0.2 -> 1.03 -> 1.0 in 14 f).
- _Snap apart._ Two words snap apart in one frame and an icon pops into the gap with an overshoot.
- _Version tag._ The wordmark slides left (753, 749, 744, 735, 723, 708, 694 px over 7 f); the version tag cuts on at
  the peak of the slide and the lockup settles.
- _Photo chip._ An inline photo chip expands faster than the line, pushing the words apart, then carries a zoom-through
  into the next scene.

**Rich.** The object is the real thing (the avatar, the official app icon, a real photo), sized to the type; the gap
opens first and the object arrives at the peak of the opening, so it feels pushed in; the whole line stays optically
centred.

**Cheap.** Fading an icon in on top of a static gap; scaling the whole line down to make room; a generic emoji or a
drawn stand-in for a real brand mark (official logos only).

```ts
import { measureText } from "./lib/measure";
import { CURVE, sf, tw } from "./motion";
const FONT = { fontFamily: "Inter", fontSize: 78, fontWeight: "600" as const };
/** left + right words around a slot that opens to `slotW` at atS; the object pops in after `objDelayS`. */
export const GrowPush: (props: {
    left: string;
    right: string;
    src: string;
    atS: number;
    slotW?: number;
    objDelayS?: number;
}) => unknown = ({ left, right, src, atS, slotW = 110, objDelayS = 0.1 }) => {
    const f = frame;
    const { fps, width, height } = filmDefaults();
    const f0 = sf(atS, fps);
    const wl = measureText({ text: left, ...FONT }).width;
    const wr = measureText({ text: right, ...FONT }).width;
    const gap = 24;
    const open = tw(f, f0, sf(0.53, fps), 0, slotW, [0.3, 0, 0.2, 1]); // Make-room curve
    const total = wl + gap + open + gap + wr;
    const x0 = (width - total) / 2;
    const fo = f0 + sf(objDelayS, fps);
    const s = f < fo ? 0 : tw(f, fo, sf(0.233, fps), 0.2, 1, CURVE.popSnap); // 0.2 -> 1.03 -> 1.0
    const o = tw(f, fo, sf(0.067, fps), 0, 1, CURVE.land);
    const y = height / 2;
    return ([{ kind: "layer", style: { position: "absolute", left: x0, top: y - 47, ...FONT }, children: left }, { kind: "plate", src: src, style: {
                position: "absolute",
                left: x0 + wl + gap + open / 2 - slotW / 2,
                top: y - slotW / 2 - 6,
                width: slotW,
                height: slotW,
                cornerRadius: "50%",
                objectFit: "cover",
                opacity: o,
                transform: `scale(${s})`,
            } }, { kind: "layer", style: { position: "absolute", left: x0 + wl + gap + open + gap, top: y - 47, ...FONT }, children: right }]);
};
```

### 6. Accelerating exit cut at peak speed + velocity-matched entry · `whip-exit-match`

Family: exit, transition. See also `transitions.md` `velocity-cut` and `camera-type.md` whips.

**Job.** Scene changes flow: the energy of one shot is handed to the next, so a hard cut reads as one continuous gesture.
It also gives the film its pulse.

**Numbers.**

- Speed growth: x2 per frame, or an expo-in to 75-170 px per frame, or 40 -> 180 px per frame in 5 f.
- Exit 5-15 f; the cut on the frame of maximum speed.
- Entry: the same direction, an expo-out from the exit's peak speed, 6-20 f.
- Blur: motion blur 10-40 px on the last frames of a layer exit, 60-120 px for camera whips.

**Presets.**

- _Doubling whip._ The velocity doubles every frame, the cut lands at peak, the next scene enters moving and brakes.
- _Expo whip._ The exit accelerates on an expo-in to 75-170 px per frame, hard cut, the next shot arrives moving the same
  way and decelerates on an expo-out.
- _Whip reveal._ A quad-in whip pan with motion blur reveals white space; the next line arrives with the whip and
  decelerates.
- _Match rise._ A line accelerates up into a hard cut; the logo continues the upward motion and decelerates into place.
- _Page exit._ The page moves up 40, 60, 90, 130, 180 px per frame with vertical motion blur 10-40 px.
- _Soft exit._ `cubic-bezier(0.55, 0, 0.9, 0.4)`: top y 462, 458, 454, 450, 442, 434, 422, 408, 392, 372, then the cut.

**Rich.** The cut on the frame of maximum speed, with blur in proportion; the incoming element moving in the same
direction at the same speed, then braking on a beat; the sound (whoosh tail, hit) split across the cut.

**Cheap.** A slow fade out then fade in; an exit that eases out (decelerating out of frame); an entry from a different
direction than the exit.

```ts
import { CURVE, ez, sf, Smear } from "./motion";
/** Displacement after an exit that started at f0 with v0 px/f, speed x ratio per 30-fps frame. */
export const whipOut = (f: number, f0: number, fps: number, v0 = 4, ratio = 2) => {
    const n = Math.max(0, ((f - f0) * 30) / fps);
    return (v0 * (Math.pow(ratio, n) - 1)) / (ratio - 1); // sum of v0, v0*r, v0*r^2 ... over n frames
};
/** Entry that starts at speed vIn px/f (30-fps frames) and brakes with expoOut (initial slope 1/0.16). */
export const whipIn = (f: number, f0: number, fps: number, vIn: number, durS = 0.4) => {
    const d = sf(durS, fps);
    const dist = (vIn * ((d * 30) / fps)) / 6.25; // so the entry's first-frame speed equals vIn
    const p = Math.min(1, Math.max(0, (f - f0) / d));
    return -dist * (1 - ez(CURVE.expoOut)(p)); // negative = still upstream
};
export const WhipPair: (props: {
    cutS: number;
    exitFrames?: number;
    A: unknown;
    B: unknown;
}) => unknown = ({ cutS, exitFrames = 6, A, B }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const fc = sf(cutS, fps);
    const fx = fc - Math.round((exitFrames * fps) / 30);
    const peak = 4 * Math.pow(2, exitFrames - 1); // speed on the last frame before the cut (v0 = 4)
    if (f < fc) {
        const y = -whipOut(f, fx, fps);
        const v = y - -whipOut(f - 1, fx, fps);
        return ({ kind: "layer", style: { transform: `translateY(${y}px)` }, children: Smear({
                id: "wa",
                sy: 0.5 * Math.abs(v),
                children: A
            }) });
    }
    const y = -whipIn(f, fc, fps, peak); // B comes up from below, braking
    const v = y - -whipIn(f - 1, fc, fps, peak);
    return ({ kind: "layer", style: { transform: `translateY(${y}px)` }, children: Smear({
            id: "wb",
            sy: 0.5 * Math.abs(v),
            children: B
        }) });
};
```

### 7. Pop with one overshoot (scale-in) · `pop-overshoot`

Family: entrance. Starter: pure recipe (`lib/moves.ts` math).

**Job.** Small objects get a physical arrival and a beat: each pop is a percussion hit the sound can land on. Use it for
the things the story counts (steps done, apps connected, people joining).

**Numbers.**

- From scale: 0.2 (avatar), 0.35 (callout), 0.69 (panel), 0.9 (slab), 0.92 (child elements), or a 1.07 cut-on oversize.
- Overshoot: 0 (callout, panel), 3 %, 10 %, 12 % (a step dot).
- Duration: 3 f (dot), 5 f (widget), 6 f, 10-12 f (callout, panel); 7 f for an avatar.
- Opacity full within 2-4 frames; never a slow fade.

**Presets.**

- _Avatar pop_ (60 fps). Scale 0.2 -> 0.7 -> 0.95 -> 1.03 -> 1.0 over 14 frames, one overshoot; opacity in 4 frames
  (`popSnap`).
- _Step dot._ An empty ring becomes a filled dot with a pop 1.0 -> 1.12 -> 1.0 in 3 f.
- _Widget cut-on._ Cut on at 107 %, settle to 100 % in 5 f; widgets 4 f apart.
- _Popover from its tail._ Scale 0.35 at 0, 0.9 at 3 f, 1.0 at 10 f, opacity over 4 f, no overshoot; out in reverse on
  an ease-in in 7 f.
- _Modal._ A sheet scales 0.9 -> 1 with a small overshoot over a dimmed screen.
- _Pop-outs._ Small glass objects pop out above a device with a 10 % overshoot.

**Rich.** Stiff (in within 2-3 frames, one small overshoot, settled by about 0.25 s) and synced to a click or a pluck;
scaled about the right anchor (the anchor of a callout, the centre of an icon); only the counted objects pop, text never.

**Cheap.** Elastic multi-bounce easings with two or three wobbles; a slow 0 -> 1 scale over a second; every element on
screen popping.

```ts
import { spring } from "./lib/anim";
import { CURVE, sf, tbl, tw } from "./motion";
export type PopKind = "avatar" | "dot" | "widget" | "callout" | "child";
const POP: Record<PopKind, (f: number, f0: number, fps: number) => number> = {
    avatar: (f, f0, fps) => tw(f, f0, sf(0.233, fps), 0.2, 1, CURVE.popSnap),
    dot: (f, f0, fps) => tbl(f, f0, [1.0, 1.06, 1.12, 1.0], 30, fps), // Step dot
    widget: (f, f0, fps) => tw(f, f0, sf(0.167, fps), 1.07, 1, CURVE.expoOut), // Cut-on 107 %
    callout: (f, f0, fps) => tbl(f, f0, [0.35, 0.57, 0.78, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99, 1.0, 1.0], 30, fps),
    child: (f, f0, fps) => tw(f, f0, sf(0.2, fps), 0.92, 1, CURVE.land),
};
export const Pop: (props: {
    atS: number;
    kind?: PopKind;
    origin?: string;
    children: unknown;
}) => unknown = ({ atS, kind = "avatar", origin = "50% 50%", children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    if (f < f0)
        return null;
    const s = POP[kind](f, f0, fps);
    const o = kind === "widget" ? 1 : tw(f, f0, sf(0.1, fps), 0, 1, CURVE.land);
    return ({ kind: "layer", style: { transform: `scale(${s})`, transformOrigin: origin, opacity: o }, children: children });
};
```

### 8. Decode, scramble, anagram resolve · `decode`

Family: type. Starter: pure recipe (`lib/moves.ts` math).

**Job.** It says computation, AI, data without a literal robot or circuit: the words are generated in front of you. Also
a strong transition into and out of a title.

**Numbers.**

- Glyph change every frame, or every 2-3 f.
- Lock order: seeded random, left to right, or a front following a sweep front.
- Duration: a 2-3 f label flash, 10 f, 16-17 f (decode in), 17 f (scramble out).
- Extras: about 30 % of unlocked cells blank, a glow per glyph, a colour cycle, mixed sizes, a 1.27 -> 1.0 shrink.
- Cells keep the final advance width, so the line never jitters.

**Presets.**

- _Seeded decode._ Per-cell random glyphs changing every frame until each cell locks in a seeded order; about 30 % of
  unlocked cells blank; final advance widths kept.
- _Front decode with glow._ The title decodes with a glow per glyph and small rising dashes; hold 7 f; then an ease-in
  drift out.
- _Scramble out._ Letters turn into symbols left to right, one or two every 2 frames, over 17 f.
- _Mixed-size scramble._ Letters cut off and random glyphs cut on in place at mixed sizes, over a coloured line.
- _Label flash._ A label shows random glyphs for 2-3 f, then the real text.
- _Anagram resolve._ Steps every 2-3 f, random capitals, a colour per frame, a shrink 1.27 -> 1.0, the words stepping
  toward the centre.

**Rich.** Final advance widths kept, so the word never shifts; locked letters crisp, unlocked ones dimmer or glowing; a
seeded order mostly in reading direction; a charset that matches the font and the product (code symbols for developer
tools, digits for data).

**Cheap.** `Math.random()` per render (the flicker differs on every render); monospace jitter that changes the line
width every frame; decoding every heading in the film.

```ts
import { measureText } from "./lib/measure";
import { random } from "./lib/anim";
import { sf, stepped } from "./motion";
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?*<>:;~/\\$%{}[]^_|";
export const Decode: (props: {
    text: string;
    atS: number;
    durS?: number;
    seed?: string;
    every?: number;
    font: {
        fontFamily: string;
        fontSize: number;
        fontWeight?: string;
    };
}) => unknown = ({ text, atS, durS = 0.55, seed = "dec", every = 1, font }) => {
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    const f = stepped(frame, every);
    if (f < f0)
        return null;
    const d = sf(durS, fps);
    const chars = [...text];
    return ({ kind: "layer", style: { ...font, whiteSpace: "pre" }, children: chars.map((c, i) => {
            // lock time: mostly left to right (60 %) plus seeded scatter (40 %)
            const lock = f0 +
                Math.round(d * (0.6 * (i / Math.max(1, chars.length - 1)) + 0.4 * random(`${seed}-l${i}`)));
            const w = measureText({ text: c === " " ? " " : c, ...font }).width;
            let g = c;
            let op = 1;
            if (f < lock && c !== " ") {
                const r = random(`${seed}-${i}-${Math.floor(f / every)}`);
                g = r < 0.3 ? " " : CHARSET[Math.floor(random(`${seed}-g${i}-${f}`) * CHARSET.length)];
                op = 0.75;
            }
            return ({
                kind: "layer",
                key: i,
                style: { display: "inline-block", width: w, textAlign: "center", opacity: op },
                children: g
            });
        }) });
};
```

### 9. Arrives zoomed or offset, settles with a spring (cut in motion) · `spring-land-zoom`

Family: entrance, transform. Starter: `fx/SnapZoom`.

**Job.** The new scene starts in motion, so the cut feels like a landing rather than a slide change; the settle gives
weight and then stillness for reading.

**Numbers.**

- Start scale 1.07-1.29 (shrink to rest) or 0.81-0.90 (grow to rest), or an offset of 50-90 px with a smear.
- Spring: `glide` (no overshoot), `zoomSettle` (1 %), `cardSettle` (0.7 %), `landing` / `landingFirm` (6-10 %).
- Settle 12-25 f.
- Extras: a whole-stage blur 28 -> 0 px on a landing; a smear on the first frame of a slide.

**Presets.**

- _Zoomed list._ Cut in motion to a list on a warm-grey ground, zoomed x1.17, settling with `zoomSettle` into a centred
  column of cards.
- _Quote card._ Arrives at 1.10 and settles to 1.0 with `cardSettle`.
- _Dialog._ Left edge 200 px (smeared 90 px), 270, 290, 296, 292, 289, 287, 286 (`landing`).
- _Slow shift._ x -42, -60, -73, -82, -90, -98, -105, -110, -115, -118, -120, -122, -123 px (`glide`, no overshoot) while
  the scale eases 1.000 -> 0.986.
- _Curtain landing._ An ease-out on `land` with a 4-8 px overshoot that settles 2 frames later (`landing`).
- _Stage landing._ Whole-stage blur 28, 30, 28, 18, 12, 7, 2.5, 0 px over 8 f while the scale settles 1.010, 1.005,
  1.001, 1.000.

**Rich.** The first frame already big or moving (cut in motion); a firm, short settle; blur or smear on the first frames
only; everything inside the card rigid (no secondary wobble of children).

**Cheap.** A card that fades in at 1.0 and then nothing moves; a soft, long spring with several oscillations; zooming in
from small at the start of every scene.

```ts
import { spring } from "./lib/anim";
import { sf, Smear, SPRING } from "./motion";
export const LandZoom: (props: {
    atS: number;
    from?: number;
    dx?: number;
    cfg?: keyof typeof SPRING;
    children: unknown;
}) => unknown = ({ atS, from = 1.17, dx = 0, cfg = "zoomSettle", children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    if (f < f0)
        return null;
    const p = (g: number) => spring({ frame: g - f0, fps, config: SPRING[cfg] });
    const s = from + (1 - from) * p(f);
    const x = dx * (1 - p(f));
    const v = dx * (p(f) - p(f - 1));
    return ({ kind: "layer", style: { transform: `translateX(${x}px) scale(${s})` }, children: Smear({
            id: `lz${f0}`,
            sx: 0.5 * Math.abs(v),
            children: children
        }) });
};
```

### 10. Stagger cascades (reading order or motion order, 1-7 frames) · `stagger-cascade`

Family: stagger. Starter: pure recipe (`lib/moves.ts` math).

**Job.** A block becomes a rhythm the eye can follow, and one gesture introduces many objects. The interval is the tempo
of the scene.

**Numbers.**

- Interval: 1 f (cards, cells), 2 f (child elements), 3-4 f (links, headlines), 5-7 f (statement words), 8 f (a deal).
- Member duration 5-10 f; the whole cascade 0.5 s or less (a cascade of four or more members runs 1-5 f
  apart).
- Order: left to right and right to left about equally (follow the motion), top to bottom for lists, by distance for
  fields (`radial-cascade`).
- Per-member move: a pop, a rise, a 5 f fade, a colour flip.

**Presets.**

- _Statement words._ 7 f apart for statement cards, 5 f for stacks and short lines, 4 f for headlines.
- _child elements._ Inner UI pops left to right 2 f apart (hero text, pill, label, three cards, a figure).
- _Light-up._ Elements light left to right one per frame; a right column top to bottom 2 f apart; a vertical fade mask
  on the left column.
- _Second line._ Three words 4 f apart with the canonical rise.
- _Tinted placeholders._ Reading order, one card per frame, each fading in over 5 frames through a muted tint.
- _Colour flip._ Tiles flip to true colour, each over 8-10 frames, 2-3 f apart.

**Rich.** Fast intervals for many items (1-3 f) so the cascade reads as one gesture; an order that follows the motion
or the story (the item that matters lands last, on the beat); a short, stiff entrance per member while the group
re-centres or the camera moves with it.

**Cheap.** A slow 10-15 f stagger on everything; a random order with no direction; every element of every scene
staggered.

```ts
import { CURVE, Order, ranks, sf, tw } from "./motion";
/** Wrap children; each child gets its start = atS + rank * eachS. Entrance: rise + fade (or pass a render prop). */
export const Cascade: (props: {
    atS: number;
    eachS?: number;
    order?: Order;
    rise?: number;
    durS?: number;
    children: unknown[];
}) => unknown = ({ atS, eachS = 0.067, order = "ltr", rise = 24, durS = 0.2, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const r = ranks(children.length, order, "cascade");
    return ([children.map((c, i) => {
            const f0 = sf(atS + r[i] * eachS, fps);
            if (f < f0)
                return ({
                    kind: "layer",
                    key: i,
                    style: { opacity: 0 },
                    children: c
                }); // keep layout
            const y = tw(f, f0, sf(durS, fps), rise, 0, CURVE.snap);
            const o = tw(f, f0, sf(durS * 0.6, fps), 0.3, 1, CURVE.land);
            return ({
                kind: "layer",
                key: i,
                style: { transform: `translateY(${y}px)`, opacity: o },
                children: c
            });
        })]);
};
```

### 11. Path draw-on, trim, erase and chained connectors · `stroke-draw`

Family: path. Starter: pure recipe (`lib/moves.ts` math).

**Job.** It shows a relationship or a gesture being made: things connect, a mark is signed, a ring confirms. Drawing the
logo from its own stroke makes the mark the hero of the end card.

**Numbers.**

- Draw time: 4-6 f (guide lines), 7 f (two letters), 11 f (a logo), 14-20 f (connectors, a signature, a ring).
- Curve: `material` (0.4, 0, 0.2, 1); an ease-out for connectors (a fast start).
- Stagger about 3 f between connectors.
- Stroke: 1-1.5 px UI lines, 5-6 px signatures, 14-75 px markers.

**Presets.**

- _Logo draw while scaling._ A trim-path draw-on in 11 f while the mark scales 2.5x -> 1 and moves to the centre; then
  a slow 12 % shrink to the end.
- _Signature._ A white cursive path draws on over 16-20 frames on a card, stroke 5-6 px.
- _Confirm ring._ A white ring draws round and closes on the result.
- _Hand letters._ Two letters drawn with `material`: the loop first, then the tail.
- _Line fan._ 7 + 7 S-curves converging into the edges of an icon, a gradient stroke from the brand blue to a pale tint,
  6 px at the tile thinning to 4 px.
- _Wire reveal._ Each wire revealed from its source toward its target over 20 frames (dash offset or a growing clip).
- _Dashed links._ 1.5 px links (dash 7, gap 6) between node centres, behind the nodes, each drawing from its start node
  over 20 frames, 3 frames apart.
- _Draw and erase._ A stroke draws, then retracts from its start in 2-9 f.

**Rich.** The draw follows the natural stroke order (loop first, tail last) with a fast start; dashed lines drawn through
a solid mask (the dashes do not crawl); something else moving at the same time (a scale-in, a camera push) and a fill or
pop landing at the end.

**Cheap.** Drawing a rectangle outline around a card; a linear draw at constant speed for everything; stroking the
outlines of a font that was never stroke-based.

```ts
import { evolvePath } from "./lib/svg";
import { CURVE, sf, tw } from "./motion";
/** Draw-on (and optional erase from the start). For dashed strokes the solid draw is used as a mask. */
export const Draw: (props: {
    d: string;
    atS: number;
    durS?: number;
    eraseAtS?: number;
    eraseS?: number;
    stroke?: string;
    width?: number;
    dash?: [
        number,
        number
    ];
}) => unknown = ({ d, atS, durS = 0.4, eraseAtS, eraseS = 0.1, stroke = "#fff", width = 2, dash }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const p = tw(f, sf(atS, fps), sf(durS, fps), 0, 1, CURVE.material);
    const e = eraseAtS === undefined ? 0 : tw(f, sf(eraseAtS, fps), sf(eraseS, fps), 0, 1, CURVE.exitSoft);
    if (p <= 0)
        return null;
    const draw = evolvePath(p, d);
    const id = `m${Math.abs(d.length * 31 + Math.round(atS * 100))}`;
    return ({
        kind: "vector",
        style: { position: "absolute", inset: 0, overflow: "visible" },
        width: "100%",
        height: "100%",
        children: [{ kind: "defs", children: {
                    kind: "mask",
                    id: id,
                    maskUnits: "userSpaceOnUse",
                    children: {
                        kind: "path",
                        d: d,
                        fill: "none",
                        stroke: "#fff",
                        strokeWidth: width + 4,
                        strokeLinecap: "round",
                        strokeDasharray: draw.strokeDasharray,
                        strokeDashoffset: draw.strokeDashoffset
                    }
                } }, {
                kind: "path",
                d: d,
                pathLength: 1,
                fill: "none",
                stroke: stroke,
                strokeWidth: width,
                strokeLinecap: "round",
                mask: `url(#${id})`,
                strokeDasharray: dash ? `${dash[0] / 1000} ${dash[1] / 1000}` : `${1 - e} ${1}`,
                strokeDashoffset: dash ? 0 : -e
            }]
    });
};
```

### 12. Per-letter wordmark reveal (fade, tumble, glide or cut-on) · `letter-reveal`

Family: type, logo. Starter: pure recipe (`lib/moves.ts` math).

**Job.** The brand name arrives with authorship: letter-level motion is the most crafted thing a film can show in its last
seconds, and it lands the name on the music.

**Numbers.**

- Stagger: 1 f, 1.4 f, 2 f, 3.5 f between letters; the whole reveal under 0.6 s.
- Per-letter move: a fade of 2-4 f; a glide of 60 px in 9 f; a tumble (scale 0.4, rotation 20 degrees, offset 40 / 60 px)
  in 7 f; a cut-on.
- Whole-word move: scale 1.12 -> 1.0, a lockup slide of 90 px, a settle.
- Colour: each letter arrives tinted (lavender -> blue, red -> black, orange -> black).

**Presets.**

- _Fade build._ Letters fade in left to right one per 1.4 f (each 3-4 f, lavender to blue) while the word scales 1.12 ->
  1.0 on an ease-out.
- _Spring tumble._ Per letter over 7 frames: scale 0.4 -> 1, rotation 20 -> 0 degrees, offset (+40, +60) -> 0, colour
  from the accent to ink; 3.5 f apart.
- _Swing in._ Each glyph from an offset of (-60, -75) px with a 35-degree rotation and scale 0.5, overshoot to 1.04, 6 f,
  1 f apart.
- _Cut-on letters._ Letters cut on at full opacity (no fade, no slide of their own) on a 1-2 f rhythm while the lockup
  slides 90 px decelerating.
- _Glyph glide._ Per glyph a 9-frame ease-out cubic from +60 px to its slot, opacity 0 -> 0.85 -> 1 in 2-3 f.
- _Typed logotype._ Two frames per letter, each fading in over 2 frames, the word left-aligned while typing and then
  settling to centre.

**Rich.** Each letter with its own small arc (offset, rotation, colour, blur) while the word as a whole settles; a
stagger of 1-3.5 f; the official logotype (an SVG with letter paths), not a font approximation.

**Cheap.** Uniform letter fades of 4 frames or more each (a typewriter in slow motion); bouncing letters; splitting a
raster logo into fake letters.

```ts
import { interpolateColors } from "./lib/anim";
import { CURVE, sf, tw } from "./motion";
export type LetterStyle = "fade" | "tumble" | "glide" | "cut";
export const Letters: (props: {
    text: string;
    atS: number;
    eachS?: number;
    kind?: LetterStyle;
    from?: string;
    to?: string;
    style?: Record<string, string | number | undefined>;
}) => unknown = ({ text, atS, eachS = 1.4 / 30, kind = "fade", from = "#B9BDE6", to = "#2433B8", style }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    const wordScale = kind === "fade" ? tw(f, f0, sf(2, fps), 1.12, 1, CURVE.expoOut) : 1;
    return ({ kind: "layer", style: {
            display: "inline-block",
            transform: `scale(${wordScale})`,
            whiteSpace: "pre",
            ...style,
        }, children: [...text].map((c, i) => {
            const fs = f0 + Math.round(i * eachS * fps);
            if (f < fs)
                return ({
                    kind: "layer",
                    key: i,
                    style: { opacity: 0 },
                    children: c
                });
            let tr = "", op = 1, blur = 0, col = to;
            if (kind === "fade") {
                op = tw(f, fs, sf(0.12, fps), 0, 1, CURVE.land);
                col = interpolateColors(f, [fs, fs + sf(0.2, fps)], [from, to]);
            }
            if (kind === "tumble") {
                // 7 f
                const p = tw(f, fs, sf(0.233, fps), 0, 1, CURVE.expoOut);
                tr = `translate(${40 * (1 - p)}px, ${60 * (1 - p)}px) rotate(${20 * (1 - p)}deg) scale(${0.4 + 0.6 * p})`;
                blur = 6 * (1 - p);
                col = interpolateColors(p, [0, 1], ["#F94415", "#020102"]);
            }
            if (kind === "glide") {
                const p = tw(f, fs, sf(0.3, fps), 0, 1, [0.33, 1, 0.68, 1]);
                tr = `translateX(${60 * (1 - p)}px)`;
                op = Math.min(1, p * 3);
            } // EaseOutCubic
            return ({
                kind: "layer",
                key: i,
                style: {
                    display: "inline-block",
                    transform: tr,
                    opacity: op,
                    color: col,
                    filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
                },
                children: c
            });
        }) });
};
```

### 13. Shape morph: emblem to slab, slab to bar, badge to word · `morph-container`

Family: morph. Starter: pure recipe (`lib/moves.ts` math).

**Job.** Continuity of meaning: the thing you clicked becomes the result, the indicator becomes the answer. One object
that transforms replaces a cut, and reads as product intelligence.

**Numbers.**

- Duration: 3 f fill + 4 f shrink, an 8 f spring, or 20-50 f in several stages.
- Curves: a spring for growth (icon to pill), a cubic-in for a collapse (pill to cell), an ease-in for growth to the full
  frame.
- Radius: keep the corner radius proportional to the short side (a pill is h / 2; a 36 px cell has a 6 px radius).
- Contents cross-fade inside the clip, or a white front sweeps them in.

**Presets.**

- _Icon to pill._ The app icon springs into a pill over 8 f; the words of the label follow 6-12 f apart; tiles pop with
  them.
- _Pill to cell._ The fill turns to the accent in 3 f, then the pill shrinks to a 36 x 36 cell (radius 6) at its centre in
  4 f on a cubic-in.
- _Indicator to card._ The typing pill turns blue, stretches right, and a white front sweeps it into a card while the
  text streams in behind.
- _Card to label bar._ A card condenses into a gradient label bar (a wipe, a slab, a spring flight, a type-on).
- _Card to bubble._ A hidden cut into a 2.1x view with +10.5 % scale.
- _Cell to card._ A table cell recolours, becomes a bar, and grows on an ease-in into a full-frame card that hosts the
  logo.

**Rich.** One object with continuous geometry (width, height, radius, colour) and its content clipped inside; a collapse
that accelerates and a growth that springs, with a sound on the change; the morph explains cause and effect.

**Cheap.** Cross-fading two unrelated cards; scaling a card uniformly (the radius and the text scale with it); morphing
for decoration with no meaning.

```ts
import { interpolateColors, spring } from "./lib/anim";
import { CURVE, sf, SPRING, tw } from "./motion";
type Box = {
    w: number;
    h: number;
    r: number;
    bg: string;
};
/** Morph box A -> B at atS. mode 'spring' for growth, 'collapse' (cubicIn) for shrink. Children: [contentA, contentB]. */
export const Morph: (props: {
    a: Box;
    b: Box;
    atS: number;
    durS?: number;
    mode?: "spring" | "collapse";
    children: [
        unknown,
        unknown
    ];
}) => unknown = ({ a, b, atS, durS = 0.27, mode = "spring", children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    const p = mode === "spring"
        ? spring({ frame: f - f0, fps, config: SPRING.landing })
        : tw(f, f0, sf(durS, fps), 0, 1, [0.55, 0, 0.9, 0.45]);
    const lerp = (x: number, y: number) => x + (y - x) * p;
    const pc = Math.min(1, Math.max(0, p));
    return ({ kind: "layer", style: {
            position: "relative",
            width: lerp(a.w, b.w),
            height: lerp(a.h, b.h),
            cornerRadius: lerp(a.r, b.r),
            background: interpolateColors(pc, [0, 1], [a.bg, b.bg]),
            overflow: "hidden",
            display: "grid",
            placeItems: "center",
        }, children: [{ kind: "layer", style: { gridArea: "1/1", opacity: 1 - Math.min(1, pc * 2) }, children: children[0] }, { kind: "layer", style: { gridArea: "1/1", opacity: Math.max(0, pc * 2 - 1) }, children: children[1] }] });
};
```

### 14. Slot drum, baseline flip-up and word swap · `swap-drum`

Family: swap. Starter: pure recipe (`lib/moves.ts` math).

**Job.** Breadth in one sentence: the claim stays, the variable changes. The drum motion makes it playful and physical;
hard swaps on beats make it rhythmic.

**Numbers.**

- Drum exit: accelerating up, cut at peak (a box top 299 -> 94 px in 4 f).
- Drum entry: from below at about 50 px per frame, braking over 9-15 f.
- Flip-up: rotateX 70 -> 0 degrees about the baseline + a 40 px rise + grey -> ink, 8 f.
- A heat ramp before a swap: 9 f in gold or plum.
- Hard swaps on beats, 6-10 f apart, or 24 f apart.

**Presets.**

- _Baseline flip._ Every word arrives by flipping up about its baseline (rotateX about 70 -> 0, pivot at the baseline, so
  the glyphs grow from a flat line), rising 40 px and turning from grey to ink over 8 f.
- _Tile drum._ The old picture goes up and out (box top 299, 281, 254, 206, 94, cut); the new one enters from below
  (top 532) and brakes 480, 456, 437, 424, 416, 408, 408.
- _Inline chip roll._ A chip inside the line rolls vertically to its next value in 8 f.
- _Beat swap._ The word cuts to the next on the beat, 24 f apart, then the line turns into the logo.
- _Swap while zooming._ A label's text changes while the view zooms 1.0 -> 1.047 -> 1.197 -> 1.301 over 4 f; quick
  instant swaps 6-10 f apart.
- _Redaction hop._ A box hops from word to word, swapping the line under it.
- _Icon swap._ White line icons cut-swap on a tilted translucent disc.

**Rich.** The exit accelerates and is cut at peak, the entry brakes (the drum has mass); the slot keeps its width or the
line re-centres with a snap; each new value arrives with the same micro-move so the rhythm is clear.

**Cheap.** Cross-fading words in place; swaps with no change in timing (metronomic); different fonts or sizes per swap
without a reason.

```ts
import { interpolateColors } from "./lib/anim";
import { CURVE, sf, tw } from "./motion";
/** Vertical drum: values[i] is shown from atS[i]; exit accelerates up (cut at peak), entry brakes from below. */
export const Drum: (props: {
    values: unknown[];
    atS: number[];
    h?: number;
}) => unknown = ({ values, atS, h = 120, }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const st = atS.map((s) => sf(s, fps));
    const i = Math.max(0, st.filter((s) => f >= s).length - 1);
    const exitF = sf(0.13, fps);
    const next = st[i + 1];
    let y = tw(f, st[i], sf(0.33, fps), h * 1.1, 0, CURVE.expoOut); // enter from below, brake
    if (next !== undefined && f >= next - exitF)
        y = -tw(f, next - exitF, exitF, 0, h * 1.6, CURVE.exit); // accelerate out
    return ({ kind: "layer", style: { height: h, overflow: "hidden" }, children: { kind: "layer", style: { transform: `translateY(${y}px)` }, children: values[i] } });
};
/** Baseline flip-up: rotateX 70 -> 0 about the baseline, rise 40 px, grey -> ink, 8 f. */
export const FlipUp: (props: {
    atS: number;
    children: unknown;
}) => unknown = ({ atS, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    if (f < f0)
        return null;
    const p = tw(f, f0, sf(0.27, fps), 0, 1, CURVE.expoOut);
    return ({ kind: "layer", style: { display: "inline-block", perspective: 600 }, children: { kind: "layer", style: {
                display: "inline-block",
                transformOrigin: "50% 85%",
                transform: `translateY(${40 * (1 - p)}px) rotateX(${70 * (1 - p)}deg)`,
                color: interpolateColors(p, [0, 1], ["#7F7F7F", "#010101"]),
            }, children: children } });
};
```

### 15. Line-mask rise, soft-mask slide and clip-slot exit · `mask-reveal`

Family: reveal. Starter: pure recipe (`lib/moves.ts` math). See also `effects.md` `soft-mask-reveal`.

**Job.** Editorial precision: the reveal edge belongs to the layout (a line, a panel divider, a card side), so the motion
feels designed into the page. Clip exits leave no ghosts.

**Numbers.**

- Mask edge: hard (a line mask, a clip slot) or soft 60-250 px (a text wash, a slide mask).
- Travel: a line-mask rise of about 95 px in 16 f; a slide of 154 px in 10 f; a wipe of about 100 px per frame.
- The content moves on an expo-out; the mask moves linearly or with the content.
- Direction: up (line masks), left to right (reading), right to left (a wash), under a fixed edge (exits).

**Presets.**

- _Page rise._ A full-bleed slide rises like a page in two ease-out stages; a small kicker rises into place in 5 f, then
  the title.
- _Slide and soft mask._ A word slides left 154 px (expo-out) while a 250 px soft mask reveals it left to right.
- _Text wash._ Text revealed right to left twice: a pale accent ghost, then the ink, 60 px soft edge.
- _Stream reveal._ A soft left-to-right wipe for paragraphs at about 100 px per frame.
- _Clip-slot exit._ A card slides right under a fixed clip edge and disappears in 6 f (no fade).
- _Slot reveal._ Text clipped to one side of a moving edge while it slides out; panels are windows onto full-size
  content.

**Rich.** The mask edge is a real layout edge; the content moves inside the mask while the mask stays or moves slower (two
speeds); soft edges wide (60-250 px) for washes, hard for editorial line masks.

**Cheap.** A full-frame linear wipe over unrelated content; text fading in behind a mask that never moves; masks with
visible feather artefacts or banding.

```ts
import { CURVE, sf, tw } from "./motion";
/** Line mask: the line rises from below a fixed edge (only the part above the edge shows). */
export const LineMaskRise: (props: {
    atS: number;
    rise?: number;
    durS?: number;
    children: unknown;
}) => unknown = ({ atS, rise = 95, durS = 0.53, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const y = tw(f, sf(atS, fps), sf(durS, fps), rise, 0, CURVE.expoOut);
    return ({ kind: "layer", style: { overflow: "hidden", paddingBottom: "0.12em" }, children: { kind: "layer", style: { transform: `translateY(${y}px)` }, children: children } });
};
/** Slide + soft linear mask: word slides left 154 px, a 250 px soft mask edge reveals it left to right. */
export const SlideMask: (props: {
    atS: number;
    durS?: number;
    slide?: number;
    soft?: number;
    width: number;
    children: unknown;
}) => unknown = ({ atS, durS = 0.42, slide = 154, soft = 250, width, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const p = tw(f, sf(atS, fps), sf(durS, fps), 0, 1, CURVE.expoOut);
    const edge = -soft + (width + 2 * soft) * p; // mask front position in px of the word box
    const m = `linear-gradient(90deg, #000 ${edge - soft}px, transparent ${edge}px)`;
    return ({ kind: "layer", style: { transform: `translateX(${slide * (1 - p)}px)`, WebkitMaskImage: m, maskImage: m }, children: children });
};
/** Clip-slot exit: content slides under a fixed edge (overflow hidden on the parent) and is gone, no fade. */
export const ClipExit: (props: {
    atS: number;
    dx?: number;
    durS?: number;
    children: unknown;
}) => unknown = ({ atS, dx = 600, durS = 0.2, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const x = tw(f, sf(atS, fps), sf(durS, fps), 0, dx, CURVE.exit);
    return ({ kind: "layer", style: { overflow: "hidden" }, children: { kind: "layer", style: { transform: `translateX(${x}px)` }, children: children } });
};
```

### 16. Counter on cut digits, decelerating (no rolling digits) · `counter-cut`

Family: counter. Starter: pure recipe (`lib/moves.ts` math).

**Job.** Proof and scale: a big number lands with momentum. Cut digits read cleaner than slot rolls, and the deceleration
makes the final number feel settled and true.

**Numbers.**

- Steps: every frame, every 3-4 f, or irregular 2-15 f.
- Profile: decelerating, the last value lingering (the second-to-last value holds 3 f before the final), or linear.
- Duration: 10 f, 34 f, 45 f.
- Tabular figures; the suffix (M, %) never moves; the card or the camera moves under the number.

**Presets.**

- _Per-frame count._ One value per frame, digits cut: 78, 79, 80, 81, 82, 83, 83, 84, 84, 84, 85 (the 84 lingers).
- _Stepped count._ A large light serif in the accent: 79 for 4 f, 82 for 3 f, 84 for 3 f, then 85 holding; a small label
  under it.
- _Rate drift._ A rate climbing 5.32 % -> 5.48 -> 5.56 -> 5.65 -> 5.73 % over 45 f in irregular steps.
- _Table count._ Prices count up linearly inside a table after a list-to-table morph.
- _Push count._ Cost cards count up during a push-in.

**Rich.** Tabular figures, a fixed suffix, cut steps that brake; the final value landing on a beat and holding; something
else moving (a card rising, the camera pushing); plausible numbers with the right precision.

**Cheap.** Rolling odometer digits with motion blur; a linear count over 2 seconds to a round number; proportional
figures that make the number jitter in width.

```ts
import { CURVE, sf, stepped, tw } from "./motion";
/** Cut-digit counter: value = round(from + (to - from) * ease), updated every `every` frames (1 = every frame, 3 = stepped). */
export const Counter: (props: {
    from: number;
    to: number;
    atS: number;
    durS?: number;
    every?: number;
    decimals?: number;
    suffix?: string;
    style?: Record<string, string | number | undefined>;
}) => unknown = ({ from, to, atS, durS = 0.33, every = 1, decimals = 0, suffix = "", style }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const fq = stepped(f, every);
    const p = tw(fq, sf(atS, fps), sf(durS, fps), 0, 1, CURVE.land); // decelerating steps
    const v = from + (to - from) * p;
    const txt = v.toFixed(decimals);
    return ({ kind: "layer", style: { fontVariantNumeric: "tabular-nums", whiteSpace: "pre", ...style }, children: [txt, { kind: "layer", children: suffix }] });
};
```

### 17. Tracking snap and letter-spacing spring · `tracking-snap`

Family: type. Starter: pure recipe (`lib/moves.ts` math).

**Job.** A typographic breath: the word condenses into focus, which reads as precision and confidence. Overlapping
letters springing open read as energy and launch.

**Numbers.**

- From: overlapping (-40 % width) or 1.2-1.4x wider.
- Duration: a 1-3 f snap, or a 23 f spring (at 60 fps) with a long tail.
- Anchor: the inner edge (a pair of words) or the centre.
- Extra: ghost copies while the letters overlap.

**Presets.**

- _Tracking snap_ (24 fps). The ink width snaps from extreme tracking to normal in 1-3 frames (712 -> 822 -> 849 ->
  854 px; a wide word 726 -> 570 px).
- _Letter-spacing spring_ (60 fps). Spacing springs open from overlapping letters with two ghost copies at 30 %, each word
  anchored at its inner edge.
- _Fly into a line._ Letters fly into one line from a wave over 4 f and settle with wide spacing.

**Rich.** Letter-spacing animates (real tracking), not a scaleX of the word; a snap (most of it in one frame) or a spring
with a long soft tail; anchored so the word does not drift.

**Cheap.** scaleX on the word (the glyphs distort); a slow tracking crawl over seconds; applied to every title.

```ts
import { spring } from "./lib/anim";
import { CURVE, sf, tw } from "./motion";
/** letter-spacing from `fromEm` to `toEm`; mode 'snap' or 'spring'. */
export const TrackIn: (props: {
    atS: number;
    fromEm?: number;
    toEm?: number;
    mode?: "snap" | "spring";
    anchor?: "left" | "center" | "right";
    children: string;
    style?: Record<string, string | number | undefined>;
}) => unknown = ({ atS, fromEm = 0.35, toEm = -0.02, mode = "snap", anchor = "center", children, style }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    const p = mode === "snap"
        ? tw(f, f0, sf(0.12, fps), 0, 1, CURVE.snap)
        : spring({ frame: f - f0, fps, config: { mass: 1, stiffness: 120, damping: 22 } });
    const ls = fromEm + (toEm - fromEm) * p;
    return ({ kind: "layer", style: {
            textAlign: anchor,
            letterSpacing: `${ls}em`,
            marginRight: anchor === "center" ? `${-ls}em` : undefined,
            ...style,
        }, children: children });
};
```

### 18. Focus-pull entrance (blur + slight oversize resolving to sharp) · `blur-resolve`

Family: entrance. Starter: pure recipe (`lib/moves.ts` math), `fx/RackFocus`. See also `effects.md` `focus-pull-in`.

**Job.** A rack focus in type: it imitates a lens, so flat type gains depth and the moment of focus becomes the beat. Good
for the first word of a film or a reveal after a transition.

**Numbers.**

- Blur 6-8 px (words), 12-20 px (titles), 28-30 px (a whole stage).
- Duration 3-6 f (words), 5-8 f (titles), 20 f (fly-ins).
- Scale 1.09 -> 1.0, or 0.67 -> 1, or none.
- Curve: a near-linear blur decay, or a quint-in (it holds blurred, then snaps sharp).
- Combined with: a 0.35 start opacity, a 20 px slide, the accent colour.

**Presets.**

- _Hero word._ Blur 14, 10, 7, 4, 2, 0 px with scale 1.09 for five frames, then 1.06, 1.035, 1.0.
- _Letters left to right._ The letters of a word appear left to right over 8 f while the word sharpens and brightens.
- _Accent blur-in._ Sigma 6-7 in the accent, sharp in 4-6 f, then ink.
- _Small and soft._ The first frame blurred about 6 px at scale 0.67; the blur clears 5, 3, 1.5, 0 px on `land`.
- _Quint pull._ 8, 8, 7, 5, 2, 0 px.

**Rich.** Blur and a 6-9 % scale change together about a meaningful anchor (the baseline); short (5-8 f) so it reads as
focus, not a fade; the left side sharper first on titles.

**Cheap.** A one-second blur fade on every element; blur without a scale or opacity change (it looks like a rendering
bug); huge blur radii on big layers (slow to render, muddy).

```ts
import { sf, tbl } from "./motion";
/** Focus pull @30: blur table 14,10,7,4,2,0 px; scale 1.09 (5 f) then 1.06, 1.035, 1.0. Scale tables with blurPx. */
export const FocusIn: (props: {
    atS: number;
    blurPx?: number;
    origin?: string;
    children: unknown;
}) => unknown = ({ atS, blurPx = 14, origin = "0% 85%", children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    if (f < f0)
        return null;
    const b = tbl(f, f0, [14, 10, 7, 4, 2, 0], 30, fps) * (blurPx / 14);
    const s = tbl(f, f0, [1.09, 1.09, 1.09, 1.09, 1.09, 1.06, 1.035, 1.0], 30, fps);
    return ({ kind: "layer", style: {
            filter: b > 0.2 ? `blur(${b}px)` : undefined,
            transform: `scale(${s})`,
            transformOrigin: origin,
        }, children: children });
};
```

### 19. Smear arrival (motion smear on the first frames, halving offsets) · `smear-arrival`

Family: entrance, physics. See also `effects.md` `motion-blur`.

**Job.** Speed you can see: smear is how a camera records fast motion, so a word that whips in with a smear feels filmed
rather than tweened. It also hides the jump of a cut-on.

**Numbers.**

- Smear length 0.5 x the per-frame displacement (40 px on a 106 px jump).
- 1-3 frames smeared; offsets halve each frame (decay q 0.5).
- Method: a directional Gaussian (cheap) or a 5-sample ghost stack (a deliberate look).

**Presets.**

- _Smear slide-in._ Expo-out; smear = displacement x 0.5; a word arriving from the right 30-60 px in 3-4 f.
- _Word whip._ The word cuts on sharp at +171 px; the next tick jumps to +65 px with a 40 px horizontal smear for 3
  frames, then the offsets halve on a stepped clock.
- _Voice rise._ Vertical smear 6, 3, 0 px on the first frames of every word rise.
- _Accumulated ghosts._ Five samples per frame with a 180-degree shutter: stacked ghost copies on the fastest frames.

**Rich.** Smear only along the motion vector and only while fast; zero at rest; length in proportion to speed; on the
first frame of a cut-on arrival, where the jump is largest.

**Cheap.** A uniform Gaussian blur (not directional); a constant blur during the whole move; fake speed lines on UI.

```ts
import { sf, Smear } from "./motion";
/** Word whip: offset table halving after the first jump, smear = 0.5 x displacement. Offsets at 30 fps. */
const WHIP = [171, 65, 32, 16, 8, 4, 2, 1, 0];
export const WhipIn: (props: {
    id: string;
    atS: number;
    scale?: number;
    children: unknown;
}) => unknown = ({ id, atS, scale = 1, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    if (f < f0)
        return null;
    const off = (g: number) => {
        const t = ((g - f0) * 30) / fps;
        if (t <= 0)
            return WHIP[0] * scale;
        const i = Math.min(WHIP.length - 2, Math.floor(t));
        return (WHIP[i] + (WHIP[i + 1] - WHIP[i]) * (t - i)) * scale;
    };
    const x = off(f);
    const v = f === f0 ? 0 : x - off(f - 1);
    return ({ kind: "layer", style: { transform: `translateX(${x}px)` }, children: Smear({
            id: id,
            sx: 0.5 * Math.abs(v),
            children: children
        }) });
};
```

### 20. Spring-loaded snap growth (creep, one-frame jump, brake) and wind-up · `snap-growth`

Family: transform, anticipation.

**Job.** Drama in a tiny object: the creep builds tension, the jump releases it on the beat. A tile, a container or a
logo feels loaded, like a spring let go. Anticipation made of timing, not of a bounce.

**Numbers.**

- Creep: 3-4 px per frame for 5 f, or slow-then-fast over 5 f.
- Jump: 55 % of the growth in one frame (106 of 196 px), or +260 px in 2 f.
- Brake: 10 f, or `landingFirm` (a 4-frame settle).
- Wind-up: 3-5 % against the move over 2-3 f, then the move.

**Presets.**

- _Tile growth after a click._ 3-4 px per frame of creep for 5 frames, one 106 px jump in one frame, then 10 frames of
  braking (width 282 -> 478 px).
- _Split and burst._ A slow-then-fast split over 5 f, a burst of +260 px width in 2 frames, an overshoot, and an 8 px
  settle inward over 6 f; dead holds of 3-4 frames between phases.
- _Column squash._ A column of rows peaks at 312 px, holds 2 f, squashes 5 % as anticipation, then squashes steadily to
  283 px and 217 px while each row slides sideways.

**Rich.** The jump lands on a sound accent; the creep barely visible; a dead hold of 3-4 frames between phases; only one
hero object does it.

**Cheap.** A big cartoon squash on UI; a bouncy overshoot instead of a jump; every object winding up.

```ts
import { sf } from "./motion";
/** Creep -> jump -> brake as a function of frame; returns 0..1 progress. Times in 30-fps frames, scaled to fps. */
export const loadedSnap = (f: number, f0: number, fps: number, creepF = 5, creepShare = 0.08, jumpShare = 0.55, brakeF = 10) => {
    const t = ((f - f0) * 30) / fps;
    if (t <= 0)
        return 0;
    if (t <= creepF)
        return creepShare * (t / creepF); // 3-4 px/f creep
    if (t <= creepF + 1)
        return creepShare + jumpShare * (t - creepF); // one-frame jump
    const u = Math.min(1, (t - creepF - 1) / brakeF);
    const rest = 1 - creepShare - jumpShare;
    return creepShare + jumpShare + rest * (1 - Math.pow(1 - u, 3)); // brake (cubic out)
};
```

### 21. Accelerating exits: shrink, rise-and-vanish, words vanish from the end · `exit-shrink-rise`

Family: exit. Starter: pure recipe (`lib/moves.ts` math).

**Job.** It clears the stage with energy and hands off to the next shot; an accelerating exit says "next" far more
clearly than a fade-out, and leaves no dead frames.

**Numbers.**

- Shrink: about -15 % about the line centre over 15-20 f on an ease-in, cut at the end; no fade (or a 3-5 f fade at the
  very end).
- Rise and vanish: the line rises 58 px in 7 f, accelerating (4, 4, 8, 8, 10, 12, 12 px per frame).
- A quiet caption may fade linearly on twos over about 23 f.
- Curves: `exitSoft` (0.55, 0, 0.9, 0.45), `sink` (0.6, 0, 0.9, 0.5).

**Presets.**

- _Accelerating shrink._ Scale down about the line centre by 15 % over 15 f, no fade; the line's edges move in faster and
  faster until the cut.
- _Rise and vanish._ All words rise and vanish while the mark stays: line top 484, 480, 476, 468, 460, 450, 438, 426 px;
  the mark slides into the space they leave.
- _Vanish from the end._ While the line slides right, its words disappear from the last word backwards.
- _Ease-in shrink_ on `exitSoft`; _sink_ on `sink` (a line dropping 537, 485, 414, 316, 164 px, gone).
- _Caption fade on twos._ Opacity 1.0, then 0.85, 0.65, 0.45, 0.3, 0.2, 0.08 stepping every 2 frames.

**Rich.** The exit accelerates into the cut, so the cut is the end of the motion; no fade, or a very short one at the end;
what stays (the mark, the key word) holds still while the rest leaves.

**Cheap.** Fading everything out over 20 frames; decelerating exits; exits that finish early and leave empty frames before
the cut.

```ts
import { CURVE, sf, tw } from "./motion";
/** Shrink about the centre to 0.85 over 0.5-0.67 s, ease-in, optional 3-5 f fade at the end; cut at endS. */
export const ExitShrink: (props: {
    endS: number;
    durS?: number;
    to?: number;
    fadeF?: number;
    children: unknown;
}) => unknown = ({ endS, durS = 0.5, to = 0.85, fadeF = 0, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const fe = sf(endS, fps);
    if (f >= fe)
        return null; // the cut
    const s = tw(f, fe - sf(durS, fps), sf(durS, fps), 1, to, CURVE.exitSoft);
    const o = fadeF
        ? tw(f, fe - Math.round((fadeF * fps) / 30), Math.round((fadeF * fps) / 30), 1, 0, CURVE.exit)
        : 1;
    return { kind: "layer", style: { transform: `scale(${s})`, opacity: o }, children: children };
};
```

### 22. Punch-in, snap zoom and re-punch · `punch-in`

Family: transform, camera. Starter: `fx/SnapZoom`. See also `camera-type.md`.

**Job.** Emphasis like a drum hit: the viewer is pulled to the detail that matters (the focal point, the number, the trigger)
instantly. Also the cheapest way to make a 2D scene feel cut by a camera operator.

**Numbers.**

- Punch: x1.13-x1.5 on a single frame; x2.5 for a close-up; x7.9 for a snap zoom over 2 f.
- Blur after the punch: 6, 4, 2, 0 px (scaled with the punch); none for a snap zoom.
- After: a hold, a decaying pull-back (15-45 f), or a slow creep.
- Montage: re-punch +10-20 % at each swap, the segments accelerating.
- Large zooms interpolate in log-scale (an equal ratio per frame).

**Presets.**

- _Punch with blur._ Cut to scale 1.347 about the centre with blur 6, 4, 2, 0 px over 4 frames; a second punch x1.126
  with blur 3, 1.5, 0.
- _Snap zoom._ x5.8 then x1.364 more on the next frame (x7.9 in total), centred on the focal anchor, no blur; out again with
  x0.215 then x0.522.
- _Re-punch montage._ The card shrinks slowly inside each segment and re-punches +10-20 % at each swap; segment lengths
  accelerate.
- _Punch and decay._ Cut to a 2.5x close-up, then a decaying pull-back.
- _Accelerating push._ Scale 1.0, 1.02, 1.067, 1.143, 1.248, 1.379, 1.529 over 10 f (24 fps).
- _Beat pulses._ A camera pan in pulses: a fast push peaking on a beat, a long soft settle.

**Rich.** The punch on the beat, centred on the detail that matters (not the frame centre by default); a 2-3 frame blur
decay in proportion to the jump; log-scale interpolation for large zooms.

**Cheap.** A slow digital zoom on a flat screenshot with visible pixels; punching in on nothing in particular; linear-scale
zooms (they visibly accelerate at the end).

```ts
import { sf, snapRem, tbl } from "./motion";
/** Punch: scale cut at atS to `to` about `origin`, blur table 6,4,2,0 px (scaled by the punch size). */
export const Punch: (props: {
    atS: number;
    from?: number;
    to?: number;
    origin?: string;
    children: unknown;
}) => unknown = ({ atS, from = 1, to = 1.347, origin = "50% 50%", children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    const s = f < f0 ? from : to;
    const k = Math.abs(Math.log(to / from)) / Math.log(1.347);
    const b = f < f0 ? 0 : tbl(f, f0, [6, 4, 2, 0], 30, fps) * k;
    return ({ kind: "layer", style: {
            transform: `scale(${s})`,
            transformOrigin: origin,
            filter: b > 0.2 ? `blur(${b}px)` : undefined,
        }, children: children });
};
/** Snap zoom: log-scale, ~80 % of the zoom (in log space) on the first frame. */
export const snapZoom = (f: number, f0: number, fps: number, from: number, to: number) => Math.exp(Math.log(to) + (Math.log(from) - Math.log(to)) * snapRem(f, f0, fps, 0.8, 0.3));
```

### 23. Gravity drop, bounce, squash and stretch · `gravity-squash`

Family: physics.

**Job.** Weight and play: real physics in a UI world makes the product feel tangible and the film confident. A heap of
logo pills says "everything you use, in one place" with humour.

**Numbers.**

- Gravity: `y = y0 + 0.5 g t^2`, with g chosen so a 540 px fall takes 10-14 f (g about 9,700 px/s^2 for 12 f).
- Bounce: restitution 0.3-0.45, one or two bounces.
- Squash 8-15 % on contact for 2 f, stretch 5-8 % on the rebound, volume kept (sx = 1 / sy).
- Heap: stagger 1-2 f, rotation +/-25 degrees (seeded), settling with `landing`.

**Presets.**

- _Block drop._ A 3D block falls tumbling, squashes on landing and stretches past rest.
- _Dot to ball._ A pen dot inflates into a white ball (expo-out), falls with gravity, bounces once, and the impact floods
  the frame with light (see `effects.md` `flash-frame`).
- _Pill heap._ Logo pills rise, then fall and heap under gravity.
- _Curtain spheres._ Two dark glass spheres enter from the left and right edges, stop with a gap around the hero, and
  squash 4-8 px on the stop (`landing`).
- _Letters fall._ Each glyph rotates about its centre to -90 / -40 degrees while spreading, ease-out in 6 f.

**Rich.** True parabolic timing (an accelerating fall, a decelerating rise); squash only on contact frames; volume
preserved; rotation continuing through the bounce; the impact is a story beat (a flash, a cut, a sound).

**Cheap.** A bounce easing on a UI card; squash without contact (wobbly jelly); many bounces.

```ts
import { sf } from "./motion";
/** Ball/object drop with restitution e and squash on contact. Closed form, deterministic. */
export const drop = (f: number, f0: number, fps: number, h = 540, fallS = 0.4, e = 0.4, bounces = 2) => {
    const g = (2 * h) / (fallS * fallS);
    let t = (f - f0) / fps;
    if (t < 0)
        return { y: -h, sx: 1, sy: 1 };
    let v = Math.sqrt(2 * g * h);
    if (t < fallS) {
        const y = -h + 0.5 * g * t * t;
        const st = 1 + Math.min(0.08, (g * t) / 40000); // slight stretch while falling
        return { y, sx: 1 / st, sy: st };
    }
    t -= fallS;
    for (let b = 0; b < bounces; b++) {
        v *= e;
        const T = (2 * v) / g;
        if (t < 2 / fps) {
            const k = 1 - 0.12 * (1 - (t * fps) / 2);
            return { y: 0, sx: 1 / k, sy: k };
        } // 2-frame squash
        if (t < T)
            return { y: -(v * t - 0.5 * g * t * t), sx: 1, sy: 1 };
        t -= T;
    }
    return { y: 0, sx: 1, sy: 1 };
};
export const Dropper: (props: {
    atS: number;
    children: unknown;
}) => unknown = ({ atS, children, }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const d = drop(f, sf(atS, fps), fps);
    return ({ kind: "layer", style: {
            transform: `translateY(${d.y}px) scale(${d.sx}, ${d.sy})`,
            transformOrigin: "50% 100%",
        }, children: children });
};
```

### 24. Damped pendulum swing · `pendulum`

Family: physics, acting. Starter: pure recipe (`lib/moves.ts` math).

**Job.** Secondary action: the thing being dragged has mass, so the drag-and-drop reads as a physical act by a person.
One of the clearest craft signals in a 3D motion film.

**Numbers.**

- Swing about the grab point: -55 degrees held while accelerating, then +32, -11, 0 (a decay of about 0.35 per half
  period); a half period of 5-7 f.
- Lift scale 1.25 while carried; 1.08 -> 1.0 on the drop.
- A moving pointer or actor tilts +14 to +28 degrees toward its velocity and returns at rest.

**Presets.**

- _Dragged document._ The grab point travels an ease-out arc (60 px per frame, then 25, 14, 10, then 6 or less) while the
  document swings -55 -> +32 -> -11 -> 0 degrees and scales from its lifted 1.25 back to 1.0 when dropped.
- _Actor faces travel._ During fast moves the arrow rotates so its tip points along the velocity, and returns at rest.
- _Decaying roll._ A roll of -2.4 degrees per frame decaying to -0.1 on `cubic-bezier(0.664, 1.135, 0.841, 0.886)`.

**Rich.** The swing lags the motion (it is driven by the acceleration of the grab point); a lift scale while carried and a
drop scale: two states; small, decaying, exactly one overshoot after the stop.

**Cheap.** A constant wobble; rotating the actor arbitrarily; a swing on objects that are not hanging.

```ts
/** Pendulum angle (deg) for an object hanging from a point that stops at fStop: lag angle while moving, then damped swing. */
export const swing = (f: number, fStop: number, fps: number, lagDeg = -55, periodS = 0.6, decay = 0.45) => {
    if (f < fStop)
        return lagDeg; // held back while the grab point accelerates
    const t = (f - fStop) / fps;
    const w = (2 * Math.PI) / periodS;
    const zeta = -Math.log(decay) / Math.PI; // amplitude ratio per half period -> damping ratio
    return lagDeg * Math.exp(-zeta * w * t) * Math.cos(w * Math.sqrt(1 - zeta * zeta) * t);
};
// Swing data @30: zero crossings 14 f and 26 f after the grab, peaks +32 (21 f) and -11 (28 f): amplitude ratio 0.58 then 0.34 per half period
// the second half period shorter (stiffening); a good single fit is lagDeg -55, periodS 0.6, decay 0.45.
/** Pointer / actor tilt toward velocity: clamp(vx * 0.15, -28, 28) deg, spring back when vx -> 0. */
export const faceTravel = (vx: number) => Math.max(-28, Math.min(28, vx * 0.15));
```

### 25. Word spring bounce, alternating from below and above · `word-bounce-alt`

Family: type, physics.

**Job.** A playful, musical line: the alternation makes rhythm visible and suits a brand with humour. The single overshoot
keeps it crisp.

**Numbers.** Drop 110-250 px; one overshoot of about -28 / +32 px (11-25 %); settled 4-8 f after entry; `bounce` (m 1, k
260, d 16) or `bounceHard`. A four-frame landing is very stiff (about k 2400, d 58 at 25 fps).

**Presets.**

- _Panning line._ An object and four short words form one line that pans left over a sky photo; each word lands on the
  baseline from below or above in turn, with one overshoot, settled 6-8 frames after its entry.
- _Pixel resolve._ A word appears for one frame as a coarse bitmap in the accent (cells 14.5-16 px), then crisp, warm to
  white, with vertical spring offsets 120, 40, 37, -19, -19, 11, 0 px.

**Rich.** Stiff: settled in 4-8 frames with one overshoot; alternating directions give the rhythm; the line keeps panning;
it matches a playful brand voice.

**Cheap.** Soft springs with several oscillations; every word from the same side; using it on a serious enterprise film.

```ts
import { spring } from "./lib/anim";
import { sf, SPRING } from "./motion";
export const BounceWords: (props: {
    words: string[];
    atS: number;
    eachS?: number;
    drop?: number;
    gap?: number;
    style?: Record<string, string | number | undefined>;
}) => unknown = ({ words, atS, eachS = 0.16, drop = 250, gap = 24, style }) => {
    const f = frame;
    const { fps } = filmDefaults();
    return ({ kind: "layer", style: { display: "flex", gap, ...style }, children: words.map((w, i) => {
            const f0 = sf(atS + i * eachS, fps);
            if (f < f0)
                return ({
                    kind: "layer",
                    key: i,
                    style: { opacity: 0 },
                    children: w
                });
            const p = spring({ frame: f - f0, fps, config: SPRING.bounce });
            const dir = i % 2 === 0 ? 1 : -1; // alternate from below / above
            return ({
                kind: "layer",
                key: i,
                style: { display: "inline-block", transform: `translateY(${dir * drop * (1 - p)}px)` },
                children: w
            });
        }) });
};
```

### 26. Arc flight with separate x / y / scale / rotation curves · `arc-flight`

Family: move. Starter: pure recipe (`lib/moves.ts` math).

**Job.** Cause and effect across the layout: the selected item goes where it belongs (into the cart, the selection row,
the button). The arc makes it a throw, not a translation.

**Numbers.**

- x on a fast ease-out (0.187, 0.876, 0.421, 0.986); y on a slower curve or an ease-in-out so the path bows.
- Scale up 5-15 % mid-flight, then down into the slot; rotation 10-20 degrees leaning into the turn, back to 0 on landing.
- 10-20 f.

**Presets.**

- _Button flight._ A call-to-action flies on an arc with its own x, y, scale and rotation curves, carried on a spline,
  then clicked.
- _Avatar to slot._ The selected avatar flies to the selection row while the page scrolls under it.
- _Downward arc._ An object flies in on a downward arc (y 531 -> 935) on `cubic-bezier(0.1, 0.7, 0.2, 1)`.
- _Drag arc._ A dragged item travels an ease-out arc (60, 25, 14, 10 px per frame, then 6 or less); pair it with
  `pendulum`.

**Rich.** Independent curves per axis (the path bows), plus a little scale and lean; it lands in a slot that reacts (a pop,
a count, a colour); a physical trigger or actor causes it.

**Cheap.** A straight-line translation with one ease; flying for no reason; spinning objects during flight.

```ts
import { CURVE, sf, tw } from "./motion";
export const ArcFly: (props: {
    from: [
        number,
        number
    ];
    to: [
        number,
        number
    ];
    atS: number;
    durS?: number;
    lift?: number;
    lean?: number;
    children: unknown;
}) => unknown = ({ from, to, atS, durS = 0.5, lift = 0.12, lean = 14, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps), d = sf(durS, fps);
    const px = tw(f, f0, d, 0, 1, [0.187, 0.876, 0.421, 0.986]); // X
    const py = tw(f, f0, d, 0, 1, CURVE.sCurve); // y lags -> the path bows
    const mid = Math.sin(Math.PI * tw(f, f0, d, 0, 1, CURVE.sCurve));
    const x = from[0] + (to[0] - from[0]) * px, y = from[1] + (to[1] - from[1]) * py;
    return ({ kind: "layer", style: {
            position: "absolute",
            left: x,
            top: y,
            transform: `translate(-50%,-50%) scale(${1 + lift * mid}) rotate(${lean * mid * Math.sign(to[0] - from[0])}deg)`,
        }, children: children });
};
```

### 27. Fly-in from the lens (huge and soft, shrinking into its slot) · `fly-from-lens`

Family: entrance, 3D. Starter: `fx/FloatDepth`.

**Job.** Depth without a 3D scene: the object comes from the viewer into the world. Strong for the first appearance of a
hero item (a photo, a card, a sphere, a title).

**Numbers.**

- Start scale 1.29x to 3-5x, cut by the frame edge, off-centre.
- Start look: blur 12-30 px, opacity 0.3-0.6.
- Shrink exponentially (log-scale, an equal ratio per frame) over 15-24 f, decelerating, with focus resolving together.
- Yaw 10-25 degrees on the plane, flattening as it lands.

**Presets.**

- _Photo from the lens._ The photo arrives enormous, very soft and transparent, as if just in front of the lens, and
  shrinks into the next slot of the layout.
- _Yawed line._ The line flies back from the lens on a yawed plane with blur 12 -> 0 px in 20 f, then shrinks x0.67 in
  24 f with a colour sweep.
- _Hero from the foreground._ A sphere enters huge from the lower-left foreground, cut by the frame, and shrinks
  exponentially along its path.
- _Receding page._ A website page in 3D enters 1.29x large and recedes while sliding in.
- _Rush in._ A rush toward the camera that zooms through into the next scene.

**Rich.** A log-scale shrink with focus resolving at the same time; it starts cut by the frame edge, off-centre, and lands
in a layout slot; a slight perspective that flattens on landing.

**Cheap.** A linear scale from 3x to 1x in the frame centre; no blur, so the huge first frames look like a pixelated
texture; every card flying from the lens.

```ts
import { CURVE, sf, tw } from "./motion";
export const FromLens: (props: {
    atS: number;
    durS?: number;
    from?: number;
    dx?: number;
    dy?: number;
    yaw?: number;
    children: unknown;
}) => unknown = ({ atS, durS = 0.6, from = 3.5, dx = -500, dy = 300, yaw = 18, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    if (f < f0)
        return null;
    const p = tw(f, f0, sf(durS, fps), 0, 1, CURVE.expoOut);
    const s = Math.exp(Math.log(from) * (1 - p)); // log-scale shrink
    const blur = 18 * (1 - p);
    return ({ kind: "layer", style: { perspective: 1400 }, children: { kind: "layer", style: {
                transform: `translate(${dx * (1 - p)}px, ${dy * (1 - p)}px) rotateY(${yaw * (1 - p)}deg) scale(${s})`,
                opacity: 0.45 + 0.55 * p,
                filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
            }, children: children } });
};
```

### 28. 3D flip-up, swing-in and tilt to flat · `flip3d`

Family: entrance, 3D. Starter: pure recipe (`lib/moves.ts` math).

**Job.** UI planes gain thickness and a hinge, so the screen becomes an object world. A tilt is only ever a designed 3D
move that ends face-on; a card never rests diagonally.

**Numbers.**

- Start angle 52-90 degrees (edge-on) -> 0; 8-10 f.
- Pivot: the baseline or bottom edge (flip-up), a side edge (swing), the centre (turn).
- Perspective 600-1400 px (CSS) or a real camera.
- Curve (0.2, 0.9, 0.3, 1.05): fast, with a tiny overshoot past flat.

**Presets.**

- _Baseline flip-up word._ rotateX about 70 -> 0 with the pivot at the baseline, rising about 40 px, grey to ink, about
  8 f (see `swap-drum`).
- _Tilt to flat._ Each arrival takes 10 frames from tilt to flat on `cubic-bezier(0.2, 0.9, 0.3, 1.05)`.
- _Stage slab flip-up._ The slab flips up, the headline reveals, a press, a gradient sweep behind the text; pills then drop into
  a chip row with a small 3D tumble.
- _Window swing._ A calendar window swings in about its side edge.
- _Pixel object turn._ An extruded pixel bitmap rotates about y from edge-on to face-on (front face a photo texture,
  sides a dark accent) in 10 frames, ease-out.
- _Tilt away._ rotateX 0 -> 52 degrees (perspective 900) with a roll and a blur, as an exit.

**Rich.** Real perspective with a sensible pivot; the plane ends exactly face-on; thickness or a rim light on the edge
while it turns; fast, with a tiny overshoot past flat.

**Cheap.** Cards resting at an angle; orthographic flips (no perspective) that look like scaleX; slow one-second flips.

```ts
import { sf, tw } from "./motion";
export const TiltIn: (props: {
    atS: number;
    axis?: "X" | "Y";
    from?: number;
    origin?: string;
    durS?: number;
    children: unknown;
}) => unknown = ({ atS, axis = "X", from = 70, origin = "50% 100%", durS = 0.33, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const f0 = sf(atS, fps);
    if (f < f0)
        return null;
    const a = tw(f, f0, sf(durS, fps), from, 0, [0.2, 0.9, 0.3, 1.05]);
    return ({ kind: "layer", style: { perspective: 1000 }, children: { kind: "layer", style: {
                transform: `rotate${axis}(${a}deg)`,
                transformOrigin: origin,
                backfaceVisibility: "hidden",
            }, children: children } });
};
```

### 29. Grow from a dot or a line · `grow-from-dot`

Family: entrance, transform. Starter: pure recipe (`lib/moves.ts` math).

**Job.** Creation from nothing (an idea becoming a thing), with honest geometry: everything grows from where it is
anchored.

**Numbers.**

- From 0 width (scaleX), a 6 px dot, or the pill size.
- 5-7 f (bars, markers), 10-15 f (a pill opening on twos).
- Anchor: the centre (pushing both sides) or an edge (a bar from the frame edge).
- Extras: a rim flash on docking; stepped growth on twos for digital content.

**Presets.**

- _Pill opens._ scaleX 0 -> 1 about the centre, pushing the neighbours apart; opacity steps 0, 0.45, 0.45, 0.62, 0.62,
  0.8, 0.84, 0.9, 0.97 on twos.
- _Bar docks._ A striped progress bar shoots in from the left edge (expo-out, 6-7 frames) and docks into a sphere, which
  becomes its round head, with a white rim flash.
- _Pillar._ An emissive strip grows up from the bottom edge and widens (see `effects.md` `light-geometry`).
- _Waveform._ Bars appear one per 2 frames beside a microphone; the group re-centres, the microphone leaves, the bars
  scroll and zoom to fill the frame.
- _Markers._ Each marker grows from the pill size to rest in 5 f on `cubic-bezier(0.0, -0.091, 0.173, 0.799)`.
- _Progressive load._ A picture starts as a 6 px dot, each size held 2 frames.

**Rich.** Growth from the true anchor with the neighbours reacting; a fast arrival (expo-out 6-7 f) with a small event at
the end (a dock flash, a sound); stepped growth when the content is digital.

**Cheap.** Scaling from the centre of the screen; a uniform scale of a pill (radius and text scale too); a slow grow over a
second.

```ts
import { CURVE, sf, stepped, tw } from "./motion";
/** Pill that opens with real width (not scaleX on text) from 0 to w, anchored at the centre, optionally on twos. */
export const OpenPill: (props: {
    atS: number;
    w: number;
    h: number;
    durS?: number;
    twos?: boolean;
    children?: unknown;
}) => unknown = ({ atS, w, h, durS = 0.47, twos = true, children }) => {
    const raw = frame;
    const { fps } = filmDefaults();
    const f = twos ? stepped(raw, 2) : raw;
    const p = tw(f, sf(atS, fps), sf(durS, fps), 0, 1, CURVE.expoOut);
    return ({ kind: "layer", style: {
            width: Math.max(h, w * p),
            height: h,
            cornerRadius: h / 2,
            overflow: "hidden",
            display: "grid",
            placeItems: "center",
            opacity: Math.min(1, p * 2),
        }, children: { kind: "layer", style: { opacity: p > 0.6 ? 1 : 0 }, children: children } });
};
```

### 30. Distance-staggered field (radial, diamond or diagonal cells) · `radial-cascade`

Family: stagger, reveal. Starter: pure recipe (`lib/moves.ts` math). See also `effects.md` `pixel-mosaic`.

**Job.** One gesture that touches every part of the frame: a picture materialises from the product, a field of tiles
answers a click. Digital and organic at once.

**Numbers.**

- Spread 12-14 f across the field; each cell 20-22 f.
- Metric: euclidean (radial), manhattan (diamond), x + y (diagonal).
- Cells from 22-24 px blocks up to a coarse grid; on twos for pixel looks.

**Presets.**

- _Radial field._ Cell start = 12 x (distance to the centre / max distance) frames after the field starts; each cell 22 f
  on `cubic-bezier(0.407, 0.074, 0.367, 1.055)` (a tiny overshoot); the exit mirrors it 44 f later.
- _Diamond rings._ A photo revealed through square cells in diamond rings from a centre; run it in reverse to dissolve.
- _Stair wipe._ Grey 24 px blocks from the top-left, on twos, with a ragged front and a tinted fringe.
- _Diagonal materialise._ Cells resolve along x + y.
- _Mosaic ring iris._ 22 px blocks in five accent tiers, feather 30 px.
- _Radial fly-out._ Tiles fly out from a centre with distance-based delays.

**Rich.** A meaningful seed point (the clicked button, the product); each cell with its own short ease (a tiny overshoot)
and some jitter; a ragged, slightly random front instead of a perfect circle.

**Cheap.** A perfect radial gradient wipe; cells popping in at random with no wave; huge numbers of DOM nodes (use a canvas
above about 400 cells).

```ts
import { random } from "./lib/anim";
import { sf, tw } from "./motion";
/** Cells revealed by distance from a seed. For > 400 cells draw the same math into a <canvas>. */
export const Field: (props: {
    cols: number;
    rows: number;
    cell: number;
    seed: [
        number,
        number
    ];
    atS: number;
    spreadS?: number;
    cellS?: number;
    metric?: "radial" | "diamond" | "diagonal";
    render: (c: number, r: number, p: number) => unknown;
}) => unknown = ({ cols, rows, cell, seed, atS, spreadS = 0.4, cellS = 0.73, metric = "radial", render }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const dist = (c: number, r: number) => metric === "radial"
        ? Math.hypot(c - seed[0], r - seed[1])
        : metric === "diamond"
            ? Math.abs(c - seed[0]) + Math.abs(r - seed[1])
            : c + r;
    let dmax = 1;
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            dmax = Math.max(dmax, dist(c, r));
    const out: unknown[] = [];
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
            const jitter = (random(`cell-${c}-${r}`) - 0.5) * 0.05;
            const start = atS + spreadS * (dist(c, r) / dmax) + jitter;
            const p = tw(f, sf(start, fps), sf(cellS, fps), 0, 1, [0.407, 0.074, 0.367, 1.055]);
            out.push({
                kind: "layer",
                key: `${c}-${r}`,
                style: { position: "absolute", left: c * cell, top: r * cell, width: cell, height: cell },
                children: render(c, r, p)
            });
        }
    return [out];
};
```

### 31. Colour or fill front through text · `front-sweep`

Family: type, colour. See also `effects.md` `colour-front-sweep`.

**Job.** It directs reading and marks emphasis with motion that never moves the type, and keeps a static headline alive
during a hold.

**Numbers.** 5 f, 8 f, 22-36 f; the front 0.3-0.8 word widths wide, soft; left to right mostly, right to left for
draining; colours accent -> ink, black -> white, or one brand gradient.

**Presets.**

- _Born blue._ Words are born blue and a front settles them to ink; the accent word stays blue; a giant word (cap about
  444 px) sweeps blue -> black over 8 f.
- _Black to white fill._ A left-to-right sweeping gradient over 5 frames.
- _Wide title gradient._ One wide horizontal gradient translated left to right: a reveal edge, then coral, pink, magenta,
  orange, peach, cream, white.
- _Outline then fill._ The outline writes on, then the fill sweeps.
- _Behind the text._ A gradient sweeps behind the text; on a glass serif wordmark a clipped light sweep follows.
- _Palette ink._ An eight-stop ink sweep that drains right to left.

**Rich.** A soft front (not a hard wipe), fast (5-8 f) on short words; colour logic from the brand (accent -> ink); the type
never moves, only the colour travels.

**Cheap.** Rainbow gradients across every title; a hard-edged wipe that looks like a progress bar; constant looping sweeps
on static text.

```ts
import { CURVE, sf, tw } from "./motion";
/** Front sweep from colour A to colour B across the text (background-clip: text). soft = front width in % of the word. */
export const Sweep: (props: {
    atS: number;
    durS?: number;
    a: string;
    b: string;
    soft?: number;
    rtl?: boolean;
    children: unknown;
    style?: Record<string, string | number | undefined>;
}) => unknown = ({ atS, durS = 0.27, a, b, soft = 40, rtl = false, children, style }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const p = tw(f, sf(atS, fps), sf(durS, fps), -soft, 100 + soft, CURVE.sCurve);
    const dir = rtl ? "270deg" : "90deg";
    return ({ kind: "layer", style: {
            ...style,
            backgroundImage: `linear-gradient(${dir}, ${b} ${p - soft / 2}%, ${a} ${p + soft / 2}%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
        }, children: children });
};
```

### 32. Shimmer loop and pulse dots · `shimmer`

Family: loop. See also `effects.md` `status-shimmer`.

**Job.** "Working, thinking, live" with the smallest possible motion; it keeps holds alive without bobbing.

**Numbers.**

- Band 40-70 px, soft edges, darker or lighter than the text, or the accent; about 12 px per frame; a pass takes 8-30 f.
- Period: an 8 f sweep every 16 f, 18 f, 20 f, 30 f.
- Dots: one dot every 4 f, a 12 f loop. Pulse marker: 10 f on / 10 f off at 30 fps.
- Contrast: 10-25 % ink difference.

**Presets.**

- _Dark band._ A darker 70 px band sweeps left to right through grey text at about 12 px per frame, loop 30 f.
- _Highlight pass._ A grey highlight band sweeps a status word left to right, about 20 frames per pass.
- _Accent loading._ An accent band (60 px, soft edges) passes through the header word in about 8 frames, repeating every
  16 f, while the agent works.
- _Gap._ A 40 px gap travelling left to right, period 18 f.
- _Dots._ One dot, two, three, every 4 f, looping every 12 f.
- _Pulse marker._ 10 on / 10 off when idle; blinking selection squares while a line builds.

**Rich.** The band clipped to the text only, soft, at a constant speed with a gap between passes; tied to a real state
(thinking, loading) that ends with a result; subtle contrast.

**Cheap.** A white glare sweeping across whole cards; shimmer on static marketing copy; fast high-contrast flashing.

```ts
/** Shimmer band through text: band px wide, pass in passF frames, period periodF frames (30-fps units). */
export const Shimmer: (props: {
    base: string;
    band: string;
    bandPx?: number;
    passF?: number;
    periodF?: number;
    textW: number;
    children: unknown;
    style?: Record<string, string | number | undefined>;
}) => unknown = ({ base, band, bandPx = 60, passF = 8, periodF = 16, textW, children, style }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const t = ((f * 30) / fps) % periodF;
    const x = t < passF ? -bandPx + ((textW + 2 * bandPx) * t) / passF : -9999;
    return ({ kind: "layer", style: {
            ...style,
            backgroundImage: `linear-gradient(90deg, ${base} ${x - bandPx / 2}px, ${band} ${x}px, ${base} ${x + bandPx / 2}px)`,
            backgroundSize: `${textW}px 100%`,
            backgroundRepeat: "no-repeat",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
        }, children: children });
};
export const dots = (f: number, fps: number) => ".".repeat(1 + (Math.floor((f * 30) / fps / 4) % 3)); // 4 f per dot, 12 f loop
```

### 33. Orbit ring, follow-the-leader curl, travelling wave · `orbit`

Family: loop, path. Starter: `fx/Orbit`.

**Job.** Relationship and ecosystem: everything revolves around the product. A curl into a ring and an implosion is a
strong "everything converges" beat.

**Numbers.**

- A tilted ellipse: the x radius 2-3x the y radius; depth from the angle (scale 0.7-1.15, back items blurred).
- One revolution in 3-6 s; a curl spins faster, then implodes in about 10 f.
- A travelling wave: a phase delay of 2-3 f per card, one pass.

**Presets.**

- _Orbiting glass tiles._ App logos on frosted tiles orbiting a glass dome; front tiles move right, back tiles left; depth
  of field by depth (see `effects.md` `dof-ladder`).
- _Orbiting spheres._ Glass spheres with avatars grow from an impact and orbit each other clockwise.
- _Follow the leader._ A stream of items curls into a ring, the ring spins counter-clockwise, implodes, and a collage
  appears.
- _Chips into orbit._ Signal chips type on with chained connectors and swing into an orbit ring.
- _Light ring._ Additive elliptical arcs streaming around a centre (see `effects.md` `light-trails`).
- _Deck wave._ A fanned 12-card deck carries a sine travelling from front to back once (an event, not an idle bob).

**Rich.** Depth-sorted, with scale and blur by depth and real assets on the tiles; the orbit has a start and an end (a curl
in, an implosion, a settle into a lockup); an ellipse in perspective, not a flat circle.

**Cheap.** A flat circle of icons spinning at constant speed with no depth; an endless orbit with no event; idle sine
bobbing of cards.

```ts
import { sf } from "./motion";
/** Items on a tilted ellipse; depth -> scale, blur, z-order. revS = seconds per revolution (sign = direction). */
export const Orbit: (props: {
    items: unknown[];
    cx: number;
    cy: number;
    rx?: number;
    ry?: number;
    revS?: number;
    atS?: number;
}) => unknown = ({ items, cx, cy, rx = 520, ry = 170, revS = 5, atS = 0 }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const t = Math.max(0, f - sf(atS, fps)) / fps;
    return ([items.map((it, i) => {
            const a = (2 * Math.PI * i) / items.length + (2 * Math.PI * t) / revS;
            const depth = (Math.sin(a) + 1) / 2; // 0 back .. 1 front
            const s = 0.7 + 0.45 * depth;
            return ({
                kind: "layer",
                key: i,
                style: {
                    position: "absolute",
                    left: cx + rx * Math.cos(a),
                    top: cy + ry * Math.sin(a),
                    zIndex: Math.round(depth * 100),
                    transform: `translate(-50%,-50%) scale(${s})`,
                    filter: depth < 0.4 ? `blur(${(0.4 - depth) * 15}px)` : undefined,
                    opacity: 0.55 + 0.45 * depth,
                },
                children: it
            });
        })]);
};
```

### 34. Stepped clock on twos or threes · `on-twos`

Family: timing. Starter: pure recipe (`lib/moves.ts` math).

**Job.** A deliberate graphic texture: stepped motion reads as digital, hand-made or retro and separates interface time
from camera time. It makes typing and counting feel mechanical and precise.

**Numbers.**

- Step 2 f (the default), 3 f (for typing), or source-rate repeats (20 fps material on a 25 fps timeline).
- Scope: UI content, type, pixel art, grain; never the camera or a 3D hero.
- Keep the step in source frames: on twos at 30 fps = every 4th frame at 60.
- A film may be up to about half stepped (a pixel or editorial look) or step only a few layers.

**Presets.**

- _Caption on twos._ Opacity steps every 2 frames.
- _Text clock on twos._ A whole text layer advances only on every second frame.
- _Pixel squares._ A grey flash and three glowing pixel squares on twos.
- _Stair wipe_ and _progressive load_ on twos (see `radial-cascade`, `grow-from-dot`).
- _Repeated frames._ Material authored at a lower rate, with exact repeats on its listed frames.
- _Grain on twos._ Noise re-seeded every second frame.
- _Cel animation._ A 23-cel pixel animation at one cel per frame.

**Rich.** Stepping consistent within a layer and contrasting with smooth camera motion; used where it means digital
(typing, pixels, data); grain and noise re-seeded on twos.

**Cheap.** A low frame rate as a whole-film accident; a stepped camera (judder); mixing twos and ones at random on the same
object.

```ts
import { stepped } from "./motion";
/** Wrap a subtree so its frame clock advances on twos (in 30-fps source frames, whatever the comp fps). */
export const OnTwos: (props: {
    every?: number;
    children: (f: number) => unknown;
}) => unknown = ({ every = 2, children, }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const src = Math.floor((f * 30) / fps); // 30-fps source frame
    const held = (stepped(src, every) * fps) / 30; // back to comp frames
    return [children(held)];
};
```

### 35. Font and colour cycle hops · `font-cycle`

Family: type.

**Job.** Creative range (design tools, fonts, styles) inside one word, and an arrival with a crackle of energy that never
moves the layout.

**Numbers.** Hard swaps every 2-8 f (house 3 f); 3-5 faces or colours, ending on the brand face and ink; optionally a
zoom of +3-6 % per step.

**Presets.**

- _Zooming cycle_ (24 fps). Steps every 3 f with zoom 1.032, 1.065, 1.13, 1.19, 1.26.
- _Pixel to serif to regular._ The new word enters in a pixel face (blue), then an italic serif, then the regular face;
  hard swaps every 2-8 frames.
- _Hover swap._ Letters near the sweep point switch to a jittery hand-drawn italic in the accent; the run grows then recedes
  over 7 frames.
- _Colour cycle write-on._ A right-to-left letter reveal, each letter cycling peach -> mint -> cyan -> violet -> black.
- _Version ink._ A version number's ink cycles through two accents before resting.

**Rich.** Hard swaps on a rhythm, few styles, ending on the brand face; the layout keeps its width; a sound tick per swap.

**Cheap.** Random fonts flickering for a second; swaps that change the line width every frame; using it on words that carry
no idea of variety.

```ts
import { sf } from "./motion";
export const FontCycle: (props: {
    text: string;
    atS: number;
    faces: Record<string, string | number | undefined>[];
    everyF?: number;
    zoomPerStep?: number;
}) => unknown = ({ text, atS, faces, everyF = 3, zoomPerStep = 0 }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const k = Math.floor(((f - sf(atS, fps)) * 30) / fps / everyF);
    if (k < 0)
        return null;
    const i = Math.min(k, faces.length - 1);
    return ({ kind: "layer", style: { display: "inline-block", transform: `scale(${1 + zoomPerStep * i})`, ...faces[i] }, children: text });
};
```

### 36. Split and assemble: one into many, many into one · `split-assemble`

Family: morph, stagger. Starter: pure recipe (`lib/moves.ts` math).

**Job.** A product structure (one input, many outputs; many tools, one platform) explained in a single physical gesture;
also a classic logo build.

**Numbers.**

- Split: 1 -> 3 with a diagonal cascade 2-5 f apart, then growth into cards.
- Assemble: hops (arcs) of 6-10 f each, staggered, landing with a pop.
- The whole build 0.5-1.5 s; replacements left to right, one item every 2-4 f, the row re-centred.

**Presets.**

- _Pill split._ One voice pill splits into three, they cascade diagonally over 16 f and widen into list cards with text.
- _Squares to logo._ On white, four squares hop and assemble the logo.
- _Cards to letters._ A row of product cards is replaced left to right by the letters of the brand word; the row stays
  centred.
- _Point to solid._ A dot becomes a line, a triangle, a wireframe, then glass.
- _Cube to mark._ A cube becomes four cubes, a lattice, then the logo mark (with the split, burst, spring and wind-up of
  `snap-growth`).
- _Ticks converge._ Small ticks converge into the logo.
- _Pixel dissolve._ Chips break into a few pixels, reduce to two 25 px squares, which grow into a pixel word.

**Rich.** Each part keeps its identity through the move (no cross-fades); timing in phases (split, travel, land, hold); it
ends in the real logo or the real UI.

**Cheap.** Exploding particles that fade into the logo; pieces flying in from random directions at once; builds longer than
2 s.

```ts
import { spring } from "./lib/anim";
import { sf, SPRING } from "./motion";
type Pt = [
    number,
    number
];
/** Parts travel from `from[i]` to `to[i]` on hops (arc height h), staggered eachS, landing with a firm spring. */
export const Assemble: (props: {
    parts: unknown[];
    from: Pt[];
    to: Pt[];
    atS: number;
    eachS?: number;
    h?: number;
}) => unknown = ({ parts, from, to, atS, eachS = 0.1, h = 120 }) => {
    const f = frame;
    const { fps } = filmDefaults();
    return ([parts.map((p, i) => {
            const k = spring({ frame: f - sf(atS + i * eachS, fps), fps, config: SPRING.landingFirm });
            const x = from[i][0] + (to[i][0] - from[i][0]) * k;
            const y = from[i][1] + (to[i][1] - from[i][1]) * k - h * Math.sin(Math.PI * Math.min(1, k));
            return ({
                kind: "layer",
                key: i,
                style: { position: "absolute", left: x, top: y, transform: "translate(-50%,-50%)" },
                children: p
            });
        })]);
};
```

### 37. Collapse to an emblem: the emblem eats the line · `collapse-to-icon`

Family: exit, morph. Starter: pure recipe (`lib/moves.ts` math).

**Job.** Compression of meaning: many words or pictures become one product icon. A strong handoff into a logo or an app UI.

**Numbers.** The icon travels about 191 px in 7 f with a hard clip at its edge; or the content shrinks 602 -> 240 -> 164 px
over about 30 f into the icon.

**Presets.**

- _Icon eats the line._ The icon travels across the line; the words are clipped at the icon's trailing edge and pulled into
  it.
- _Text collapse._ A line collapses into the icon over 12 f.
- _Collage to icon._ A collage grows to 602 px, then shrinks into a 240 -> 164 px app icon; the icon then springs into a
  pill (see `morph-container`).
- _Arrow erase._ The send arrow rotates -90 degrees and flies left, clipping the text as it goes.
- _Ring implodes._ A ring of items implodes into a point that becomes the next scene.

**Rich.** The clip edge is the icon's own edge; the icon keeps moving after the text is gone and lands; an accelerating
collapse with a landing pop; the icon is the official mark.

**Cheap.** Text fading out while an icon fades in; scaling text down to a dot; a generic sparkle icon.

```ts
import { CURVE, sf, tw } from "./motion";
/** Icon travels left by `travel` px; the text to its left is clipped at the icon's right edge and pulled along. */
export const EatLine: (props: {
    atS: number;
    travel?: number;
    durS?: number;
    iconW: number;
    icon: unknown;
    text: unknown;
    textW: number;
}) => unknown = ({ atS, travel = 191, durS = 0.23, iconW, icon, text, textW }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const x = -tw(f, sf(atS, fps), sf(durS, fps), 0, travel, CURVE.exitSoft);
    const clipRight = textW + x; // visible text width shrinks with the icon
    return ({ kind: "layer", style: { position: "relative", display: "flex", alignItems: "center" }, children: [{ kind: "layer", style: { width: Math.max(0, clipRight), overflow: "hidden", whiteSpace: "nowrap" }, children: { kind: "layer", style: { transform: `translateX(${x * 0.6}px)` }, children: text } }, { kind: "layer", style: { transform: `translateX(${0}px)`, width: iconW }, children: icon }] });
};
```

### 38. Drift tail: the purposeful never-still hold · `drift-tail`

Family: timing. Starter: `lib/drift.ts`.

**Job.** The picture never stops: after an element lands it keeps moving very slowly in the direction of its last move
until the next event. Because it continues the last gesture it never looks aimless, and it is never an up-down bob.

**Numbers.**

- 0.3-2 px per frame translation, or a scale creep of 0.05-0.4 % per frame.
- Direction: continue the last move (or head toward the next one); never oscillate.
- Profile: decaying, or constant until the exit and then accelerating into it.
- Different layers drift at different rates (parallax).

**Presets.**

- _Pill float._ Enter from an off-screen edge with an expo-out landing over 24-46 f, then drift 0.3-0.5 px per frame.
- _Never static._ Every hold has a drift, a breathing glow or a scrolling stripe.
- _Block shrink._ A block shrinks 0.4 % per frame through its hold; a logo shrinks 12 % slowly to the end.
- _Decaying drift._ Left 1.6 -> 0.5 px per frame and down 0.7 -> 0.2 px per frame while it settles, on `cubic-bezier(0.16,
0.6, 0.33, 0.88)`.
- _Scroll and zoom-out._ A slow 1 px per frame scroll up; a continuous slow zoom-out (the window shrinking 0.1-0.4 % per
  frame) that turns into the next whip; a line that starts drifting left before its exit.
- _Corner markers_ drifting outward 1-2 px per frame; a footage still keeping a 1 px drift (0.05 % per frame).

**Rich.** The drift is the tail of a real move and feeds the next one (the drift becomes the exit); very slow and smooth;
layers drifting at different rates.

**Cheap.** A random camera float; up-down bobbing of cards; a drift that reverses direction.

```ts
/** Position after a landing at fLand: settle into `rest`, then keep drifting at pxPerF (30-fps frames) in the same direction. */
export const withDrift = (f: number, fLand: number, fps: number, rest: number, pxPerF = 0.4, dir: 1 | -1 = -1) => rest + dir * Math.max(0, ((f - fLand) * 30) / fps) * pxPerF;
/** Scale creep: s = Math.pow(1 - 0.004, Math.max(0, (f - f0) * 30 / fps)) */
export const creep = (f: number, f0: number, fps: number, perF = -0.004) => Math.pow(1 + perF, Math.max(0, ((f - f0) * 30) / fps));
```

### 39. Jump-echo stamps and z-swarm copies · `echo-swarm`

Family: effect, motion. See also `effects.md` `echo-copies`.

**Job.** Multiplicity, judgement, noise: a crowd made of one word. Use it rarely, for one emotional beat.

**Numbers.** Stamps: 3-6, each fading over 4-8 f. Swarm: 10-30 copies, depth-scaled, vanishing to white over 10-14 f.
Jitter: 1-3 px per copy, re-seeded on twos.

**Presets.**

- _Jump-echo stamps._ A word jumps between positions leaving stamps that fade with age, then holds.
- _Z-swarm._ Many full-white copies swarm in depth and vanish, then fading jittery copies, resolving into one line; a hold,
  then an ease-in exit.
- _Accumulated ghosts._ Stacked ghost copies of a fast move (five samples, 180-degree shutter).

**Rich.** Ages fade monotonically and only the newest copy is fully sharp; deterministic positions (seeded), depth-scaled;
one use per film.

**Cheap.** Trails on every move; random flicker copies; glitch effects with no meaning.

```ts
import { sf } from "./motion";
/** Word jumps to positions[i] at times[i]; previous positions remain as stamps fading over fadeS. */
export const EchoJumps: (props: {
    positions: [
        number,
        number
    ][];
    times: number[];
    fadeS?: number;
    children: unknown;
}) => unknown = ({ positions, times, fadeS = 0.25, children }) => {
    const f = frame;
    const { fps } = filmDefaults();
    const st = times.map((t) => sf(t, fps));
    const k = st.filter((s) => f >= s).length;
    return ([positions.slice(0, k).map((p, i) => {
            const age = i === k - 1 ? 0 : (f - st[i + 1]) / sf(fadeS, fps);
            const o = i === k - 1 ? 1 : Math.max(0, 0.6 * (1 - age));
            return o > 0 ? ({
                kind: "layer",
                key: i,
                style: { position: "absolute", left: p[0], top: p[1], opacity: o },
                children: children
            }) : null;
        })]);
};
```
