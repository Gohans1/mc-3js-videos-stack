# Transitions

How one scene becomes the next: velocity cuts, zoom-throughs, shared elements, continuous camera, morphs, whips, match
cuts, irises, light handovers, exit-then-enter, cross-overs, card expands, blur-throughs, push wipes, flash frames, snap
punches, text swaps, mosaics, collapses, ground flips, hard cuts done right, torn steps, glitch breaks, split panels,
dissolves, callbacks and the last handover. Each entry gives what carries across the seam, the numbers, named presets,
what makes it rich or cheap, the sound that marks it, the starter primitive, and deterministic frame-pure TypeScript (CPU-safe: transforms,
opacity, aperture mask, masks and gradients first; blur as two fixed copies cross-faded; SVG directional blur only on fast
frames; canvas only for bitmap mosaics).

**Units.** px at 1920 x 1080. Rates are per frame at the stated fps: "x1.15-1.35 per frame at 60 fps" means the step grows
by that ratio each 60 fps frame. To convert a per-frame ratio r from 60 fps to 30 fps use r^2; to 24 fps use r^2.5.
Durations are frames at 60 fps unless noted ("f60"); halve them for 30 fps.

---

## Ten seam rules

1. **Something carries across:** motion, an element, the camera, a shape, an anchor, light, the ground or the sentence.
   Name it before you build the seam.
2. **Hide the switch in the fastest, blurriest or brightest frame.**
3. **The next shot inherits one step:** it opens at 0.5-1.15x the outgoing step and decays x0.65-0.94 per frame.
4. **Accelerate in (x1.15-1.35 per frame at 60 fps), decelerate out.**
5. **Smear only fast frames** (0.4-0.5 x the travel, above about 9 px per frame at 60 fps).
6. **One house seam per film plus three or four others;** no single kind over 40 % of the scene changes.
7. **A big change about every 2.4 s** (1.4-3.7 s); montage runs at 0.4-0.7 s per picture.
8. **No cross-fade between unrelated pictures.** A dissolve is 2-3 frames, between versions of the same subject or under a
   wash.
9. **Sound marks the seam** (a whoosh tail across a whip, a pop on a morph, a hit after a pre-hit gap).
10. **Light and dark flip only at section changes,** with a sub hit; at most twice a film.

A plain hard cut is fine for about a third of the big changes, if it carries motion, a slot or an anchor (`hard-cut-right`).
A cut on the beat is not a target: cut on the action, not on the metronome.

## Picking the house seam

Every film repeats one seam as its signature and mixes three or four others. Typical pairs: a velocity cut as the house
seam with match cuts and a light flood; an iris with morphs and exit-then-enter; a cross-over of type states with
whips; a zoom-through with shared elements; a continuous camera with atmosphere pass-throughs. Pick by what the film's
world can carry (a spatial stage carries velocity, morphs and depth dives; a light world carries washes, irises and
flashes; a type-led film carries cross-overs, text swaps and exit-then-enter).

## Shared kit (`seamKit.ts`)

Every implementation imports this file: geometric builds and decays (`buildInto`, `decayFrom`), a seeded noise, a
directional smear above a speed threshold, fixed-level blur copies and frame helpers.

```ts
import { Easing, interpolate } from "./lib/anim";
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** geometric per-frame rate authored at fromFps, used at toFps */
export const rateAt = (r: number, fromFps: number, toFps: number) => Math.pow(r, fromFps / toFps);
/** deterministic hash -> [0,1) */
export const hash = (i: number, seed = 1) => {
    const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
};
/** look up a per-frame table {frame: value}, linear between keys, clamped at the ends */
export const table = (f: number, t: Record<number, number>) => {
    const ks = Object.keys(t).map(Number).sort((a, b) => a - b);
    if (f <= ks[0])
        return t[ks[0]];
    if (f >= ks[ks.length - 1])
        return t[ks[ks.length - 1]];
    const i = ks.findIndex((k) => k > f);
    const a = ks[i - 1], b = ks[i];
    return lerp(t[a], t[b], (f - a) / (b - a));
};
/** Offset (px, negative = before) of a move that BUILDS geometrically into a cut.
 *  vCut = speed on the last frame before the cut, r = per-frame ratio (>1). */
export const buildInto = (f: number, cut: number, vCut: number, r: number) => {
    const k = cut - f; // frames left to the cut
    if (k <= 0)
        return 0;
    return -vCut * (1 - Math.pow(r, -k)) / (1 - 1 / r);
};
/** Offset (px) of a move that DECAYS geometrically after a cut: first step v0, ratio d (<1). */
export const decayFrom = (f: number, cut: number, v0: number, d: number) => {
    const k = Math.max(0, f - cut);
    return (v0 * (1 - Math.pow(d, k))) / (1 - d);
};
/** speed (px/f) of the same curves, for smear */
export const speedInto = (f: number, cut: number, vCut: number, r: number) => f >= cut ? 0 : vCut * Math.pow(r, -(cut - 1 - f));
export const speedFrom = (f: number, cut: number, v0: number, d: number) => f < cut ? 0 : v0 * Math.pow(d, f - cut);
/** log-space scale for zooms: s0 -> s1 with an easing on log(s) (zooms must be eased in log space) */
export const logScale = (t: number, s0: number, s1: number) => Math.exp(lerp(Math.log(s0), Math.log(s1), clamp01(t)));
export const E = {
    expoIn: Easing.in(Easing.exp), expoOut: Easing.out(Easing.exp), quadIn: Easing.in(Easing.quad),
    cubicIn: Easing.in(Easing.cubic), cubicOut: Easing.out(Easing.cubic), circOut: Easing.out(Easing.circle),
    inOut: Easing.inOut(Easing.cubic), sineInOut: Easing.inOut(Easing.sin),
};
export const ramp = (f: number, a: number, b: number, ease = (x: number) => x) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
/** Defocus without an animated blur radius: a sharp copy and ONE copy blurred at a fixed sigma, cross-faded. */
export const Defocus2: (props: {
    sigma: number;
    max?: number;
    children: unknown;
    style?: Record<string, string | number | undefined>;
}) => unknown = ({ sigma, max = 24, children, style, }) => {
    const k = clamp01(sigma / max);
    if (k <= 0.01)
        return { kind: "layer", style: style, children: children };
    return ({ kind: "layer", style: style, children: [{ kind: "layer", style: { opacity: 1 - k }, children: children }, { kind: "layer", style: { opacity: k, filter: `blur(${max}px)` }, children: children }] });
};
/** Directional smear along x or y: SVG blur with an anisotropic stdDeviation, only when the move is fast. */
export const Smear: (props: {
    v: number;
    axis?: 'x' | 'y';
    k?: number;
    min?: number;
    id: string;
    children: unknown;
}) => unknown = ({ v, axis = 'x', k = 0.45, min = 9, id, children, }) => {
    const len = Math.abs(v) < min ? 0 : Math.abs(v) * k; // smear length = 0.4-0.5 x travel
    if (len === 0)
        return { kind: "layer", children: children };
    const sd = len / 2.5; // a Gaussian's visible length is ~2.5 sigma
    return ({ kind: "layer", children: [{
                kind: "vector",
                width: 0,
                height: 0,
                style: { position: 'absolute' },
                children: {
                    kind: "filter",
                    id: id,
                    x: "-20%",
                    y: "-20%",
                    width: "140%",
                    height: "140%",
                    children: { kind: "feGaussianBlur", stdDeviation: axis === 'x' ? `${sd} 0` : `0 ${sd}` }
                }
            }, { kind: "layer", style: { filter: `url(#${id})` }, children: children }] });
};
/** Two layers with a hard switch at `cut`: the base of every hidden cut. */
export const CutPair: (props: {
    f: number;
    cut: number;
    out: unknown;
    in: unknown;
}) => unknown = (p) => ({ kind: "layer", children: p.f < p.cut ? p.out : p.in });
```

## Index

| #   | slug                | seam                                              | carries                |
| --- | ------------------- | ------------------------------------------------- | ---------------------- |
| 1   | `velocity-cut`      | velocity cut, hidden cut inside a whip            | motion                 |
| 2   | `zoom-through`      | zoom-through, dive into an element                | element -> next ground |
| 3   | `shared-element`    | shared element across the seam                    | element                |
| 4   | `continuous-camera` | continuous camera, atmosphere pass-through        | camera                 |
| 5   | `morph`             | morph handover                                    | shape                  |
| 6   | `whip`              | whip, spin whip, spin plunge                      | camera                 |
| 7   | `match-cut`         | match cut on an anchor                            | anchor                 |
| 8   | `iris`              | iris or mask from a meaningful point              | point -> place         |
| 9   | `light-carried`     | light flood, sweep, wash, impact                  | light                  |
| 10  | `exit-then-enter`   | exit then enter on a kept ground                  | ground                 |
| 11  | `cross-over`        | blur-scale overlap of two type states             | sentence               |
| 12  | `blur-through`      | blur-through, defocus cut                         | blur                   |
| 13  | `push-wipe`         | push wipe, doors, push-out                        | edge                   |
| 14  | `flash-frames`      | white, black, glow, inverted frames               | light                  |
| 15  | `snap-punch`        | snap zoom, punch-in, reframe                      | frame                  |
| 16  | `text-swap`         | text swap in a held slot                          | slot                   |
| 17  | `pixel-mosaic`      | mosaic ladders, stair fronts, cell wipes          | texture                |
| 18  | `collapse`          | collapse to a point, implode                      | shape                  |
| 19  | `ground-flip-dip`   | ground ramps, bleach, drain, flips                | ground                 |
| 20  | `hard-cut-right`    | contrast cuts, montage on a held slot, beat cuts  | slot, rhythm           |
| 21  | `torn-paper`        | torn-paper step wipe                              | texture                |
| 22  | `glitch-break`      | stepped full-frame re-treatments                  | reset                  |
| 23  | `split-panel`       | split panels with staggered swaps                 | anchor panel           |
| 24  | `dissolve`          | 2-3 frame dissolve                                | subject                |
| 25  | `callback`          | callback, replay seam                             | memory                 |
| 26  | `end-handover`      | the last handover into the end card               | brand                  |

---

## Entries

### 1. Velocity cut (and the hidden cut inside a camera whip) · `velocity-cut`

Carries: motion. Starter: `fx/Seam` `velocityCut`, `launch()` / `carriedCut()`, `fx/Defocus` `DirBlur`.
See also `animations.md` `whip-exit-match`.

**What.** The outgoing shot accelerates, the cut lands on its fastest frame, and the incoming shot already moves the same
way and decelerates.

**Job.** A cut becomes one continuous move: UI screen to screen without cutting; an exit becomes an entrance.

**Numbers.**

- Build x1.1-1.35 per frame at 60 fps; the last frames grow x1.6-2.6 each (native rate); the last outgoing step 16-88 px.
- Incoming opens at 0.53-0.92 x the last outgoing step and decays x0.90-0.94 per frame at 60 fps; settles in 12-24 f60.
- Smear 0-0.75 x the step, only on fast frames. The whole seam spans about 0.1 s around the cut.

**Presets.**

- _Zoom whip._ Scale per frame 1.0008, 1.000, 1.0009, 1.000, 1.0031, 1.0029, 1.0031, 1.0058, 1.0092, 1.0153, 1.0363, then
  a hidden cut with a x1.353 step into the new view, which keeps braking.
- _Scroll whip._ Content scrolls up 576 px in steps of 1, 2, 2, 4, 5, 8, 15, 36, 72 px per frame; the cut to a new chat
  (at scale 1.40) lands on the 72 px frame.
- _Pull-back into a grid._ An exponential pull-back (0.99 -> 0.84 per frame); on the fastest frame the view switches to
  an infinite grid of windows at about 52 % size, then brakes 17, 9.4, 4 px.
- _Pan through._ Outgoing x steps -2.5, -2.4, -2.8, -3.6, -4.2, -7.2, -10.9, -17.6, -33.4, -88.0 px; cut; incoming -46.9,
  -14.7, -8.6, -7.1, -4.5, -4.0, -3.6, -3.2, -2.6 px.
- _Pull-back with radial blur._ Scale 0.977, 0.971, 0.963, 0.950, 0.932, 0.902, 0.857 about a high anchor, a radial zoom
  blur of 2 / 6 / 14 px on the last three frames; the next frame shows the same card flat on a new ground.
- _Pan steps._ Steps grow x1.25 with motion blur 8, 16, 32, 60 px; one frame is a single 300 px white smear; the next
  shot's cards arrive blurred 12 px and sharpen 8, 5, 3, 1.

**Rich.** A geometric build with the cut on the fastest frame; the incoming shot opening at 0.5-0.9x in the same direction
with an exponential brake; smear only on fast frames; a ground or anchor that helps (a ground flashing the accent for
5 f).

**Cheap.** An ease-in-out that stops before the cut; opposite directions; blur on every frame; the incoming shot at full
speed or at zero.

**Sound.** A click with a falling sweep (60 ms); a hit with a 2 s uplifter; a 40 ms impact; a 410 ms whoosh 500 Hz ->
4 kHz -> 1 kHz peaking 3 frames after the cut.

```ts
// VelocityCut.ts: horizontal pan, scroll or log-scale zoom carried through a hard cut
import { buildInto, decayFrom, E, logScale, ramp, Smear, speedFrom, speedInto } from "./seamKit";
type Axis = "x" | "y";
export const VelocityCut: (props: {
    cut: number; // first frame of the incoming shot
    vCut?: number; // px/f on the last outgoing frame
    build?: number; // per-frame ratio into the cut (1.25 @30 ~ x1.12 @60; last frames 1.6-2.6)
    inRatio?: number; // first incoming step / last outgoing step (0.53-0.92)
    decay?: number; // per-frame decay after the cut (0.85 @30, 0.93 @60)
    axis?: Axis;
    dir?: 1 | -1;
    smear?: number; // 0 = crisp, 0.45 = 0.4-0.5 x travel, 0.7 = @60
    out: unknown;
    in: unknown;
}) => unknown = ({ cut, vCut = 78, build = 1.6, inRatio = 0.7, decay = 0.85, axis = "x", dir = -1, smear = 0.45, out, in: inc, }) => {
    const f = frame;
    const isOut = f < cut;
    const off = isOut ? buildInto(f, cut, vCut, build) : decayFrom(f, cut, vCut * inRatio, decay);
    const v = isOut ? speedInto(f, cut, vCut, build) : speedFrom(f, cut, vCut * inRatio, decay);
    // signed travel: outgoing is -(distance still to go) and reaches 0 on the cut; incoming grows from 0. One line of motion.
    const tr = axis === "x" ? `translateX(${dir * off}px)` : `translateY(${dir * off}px)`;
    return ({ kind: "layer", style: { overflow: "hidden" }, children: Smear({
            v: smear ? v : 0,
            k: smear,
            axis: axis,
            id: `vc${cut}`,
            children: { kind: "layer", style: { transform: tr }, children: isOut ? out : inc }
        }) });
};
// Hidden cut inside a zoom whip: scale table into the cut, one jump frame, expo-out after.
export const ZoomWhipCut: (props: {
    cut: number;
    pivot: [
        number,
        number
    ];
    out: unknown;
    in: unknown;
}) => unknown = ({ cut, pivot, out, in: inc }) => {
    const f = frame;
    const steps = [1.0008, 1.0, 1.0009, 1.0, 1.0031, 1.0029, 1.0031, 1.0058, 1.0092, 1.0153, 1.0363]; // f cut-16 .. cut-1
    let s = 1;
    if (f < cut) {
        const k0 = cut - steps.length; // first whip frame
        for (let i = 0; i < steps.length && k0 + i <= f; i++)
            s *= steps[i];
    }
    else {
        // incoming: 1.353 jump already baked into the new framing; continue 1.070, 1.027, 1.014 ... -> 1.48
        s = logScale(ramp(f, cut, cut + 18, E.expoOut), 1.0, 1.48 / 1.353);
    }
    const [px, py] = pivot;
    return ({ kind: "layer", style: { overflow: "hidden" }, children: { kind: "layer", style: { transformOrigin: `${px}px ${py}px`, transform: `scale(${s})` }, children: f < cut ? out : inc } });
};
```

### 2. Zoom-through, dive into an element · `zoom-through`

Carries: an element that becomes the next ground. Starter: `fx/Dive`, `fx/Rush`.

**What.** An exponential push centred on an element until it covers the frame; its colour or content is the next shot,
which keeps about a third of the last step and settles.

**Job.** It pushes the viewer into the product; the element is the door to the next idea.

**Numbers.** Push x1.04-1.1 per frame at 60 fps over 16-30 f60; settle 20-36 f60; the next shot carries 0.33 of the last
step; rotation 0-12 degrees; a radial smear of 0-60 px on the last frames; the whole seam 0.5-1 s.

**Presets.**

- _Bubble through white_ (24 fps). Zoom x1.74 over 15 f on a quad-in with a 12-degree rotation; the bubble's radius 300,
  330, 400 px; then three frames of its white centre carry into the next scene.
- _Word box dive._ x1.42 per step on twos (x8.2 in 6 f); the cut lands inside the next word's box; a counter glyph becomes
  the frame; no smear.
- _Packshot push._ Push 1.0078, 1.0456, 1.0514, 1.0775, 1.0801, 1.0915 per step; cut to the packshot one step larger
  (x1.086), then 1.026, 1.028 decaying.
- _Square tunnel._ Rings grow 26 px per side per frame (linear), a new square every 4-5 f; the centre square becomes the
  next frame.
- _Face into the lens._ A faceted solid swings a face into the lens; one frame is a pearly field with 60-degree streaks,
  then the soft ground of the next scene.
- _Rush in._ A line grows 1.39x over 9 f about a pivot near the top while its ink moves left.

**Rich.** A log-space exponential push on a meaningful element; the element's colour becomes the next ground; a radial
smear only on the last frames; the incoming shot keeping a third of the last step; parallax while pushing.

**Cheap.** A linear scale on the frame centre; a cross-fade at the end; a static incoming shot; zooming a raster until it
pixelates.

**Sound.** Rising air or an uplifter ending in a pop or hit on the cover frame.

```ts
// ZoomThrough.ts: exponential log-space push into an element, cut when it covers, incoming keeps 1/3 of the step
import { Defocus2, E, ramp } from "./seamKit";
export const ZoomThrough: (props: {
    start: number;
    cover: number; // push starts, element covers the frame (cut frame)
    centre: [
        number,
        number
    ]; // the element's centre (screen px at start)
    sCover: number; // total scale at the cover frame
    carry?: number; // incoming continues: total extra scale (1.026*1.028*1.018 ~ 1.074)
    settle?: number; // frames to settle the carry
    rotate?: number; // degrees over the push
    smear?: number; // max radial-smear-like defocus px in the last frames
    stepped?: 1 | 2; // 2 = on twos
    out: unknown;
    in: unknown;
}) => unknown = ({ start, cover, centre, sCover, carry = 1.074, settle = 30, rotate = 0, smear = 0, stepped = 1, out, in: inc, }) => {
    const raw = frame;
    const f = stepped === 2 ? Math.floor(raw / 2) * 2 : raw;
    if (f < cover) {
        const t = ramp(f, start, cover, E.quadIn);
        const s = Math.exp(Math.log(sCover) * t); // exponential in log space
        const [cx, cy] = centre;
        // pull the element to the frame centre while pushing
        const tx = (960 - cx) * t, ty = (540 - cy) * t;
        const blur = smear * Math.max(0, (t - 0.7) / 0.3);
        return ({ kind: "layer", style: { overflow: "hidden" }, children: Defocus2({
                sigma: blur,
                max: Math.max(1, smear),
                children: { kind: "layer", style: {
                        transformOrigin: `${cx}px ${cy}px`,
                        transform: `translate(${tx}px,${ty}px) scale(${s}) rotate(${rotate * t}deg)`,
                    }, children: out }
            }) });
    }
    const k = ramp(f, cover, cover + settle, E.expoOut);
    const s2 = Math.exp(Math.log(carry) * k); // keeps scaling, decelerating
    return ({ kind: "layer", style: { overflow: "hidden", transform: `scale(${s2 / carry})` }, children: inc });
};
// Square tunnel (720p): rings grow 26 px per side per frame, a new square every 4-5 f, last one fills.
export const SquareTunnel: (props: {
    start: number;
    births?: number[];
    fillFrom?: number;
    color?: string;
}) => unknown = ({ start, births = [0, 4, 9, 15, 20, 24, 29], fillFrom = 29, color = "#EF4305" }) => {
    const f = frame - start;
    return ({ kind: "layer", style: { background: "#F9F9F9" }, children: births.map((b, i) => {
            const age = f - b;
            if (age < 0)
                return null;
            const last = i === births.length - 1;
            const half = 43 + 26 * age; // 72-100 px square at birth
            const thick = last && f >= fillFrom ? half : Math.min(half, 24.5); // rings 48-49 px thick
            return ({ kind: "layer", key: i, style: {
                    position: "absolute",
                    left: 640 - half,
                    top: 360 - half,
                    width: 2 * half,
                    height: 2 * half,
                    boxSizing: "border-box",
                    border: `${thick}px solid ${color}`,
                } });
        }) });
};
```

### 3. Shared element across the seam · `shared-element`

Carries: an element. Starter: pure recipe (`lib/moves.ts` math), `fx/MatchCut`.

**What.** One element survives the seam and changes role while its surroundings leave and arrive around it (detached into
an overlay above both scenes, or held while the ground cuts under it).

**Job.** Continuity of meaning: the product carried into a new context.

**Numbers.** Surroundings out over 10-14 f60 and in over 8-16 f60; the element moves over 24-36 f60; plates under a held
subject swap every 5-6 f; the seam spans 0.3-1.3 s.

**Presets.**

- _Field from the side._ A white field slides in from the right (edge x 1190, 932, 730, 562, 416, 334, 208, 120, 34 px), a
  band about 190 px wide; the mark grows and moves right through it.
- _Period detaches._ Words vanish by cut left to right; the full stop detaches as a small square and grows; cut to a new
  ground where the square continues.
- _Cards above both scenes._ Two photo cards on a layer above both scenes keep stepping across a velocity cut.
- _Held product, cutting grounds._ The product is held while the ground cuts every 6 f (paper, flowers, fruit, grass); the
  product scales up about 12 % over the run.
- _Avatar carries._ An avatar grows in a word gap (16 -> 107 px over 10 f), a x5 cut onto it, a push 1.078 ... 1.019 per
  frame with a tilt up, then a match cut.
- _Text to button._ Text blooms to white and collapses into a glowing pill that becomes the next button.

**Rich.** The element never pops (the same box, or one inherited step); the element changes role; the surroundings use a
different device.

**Cheap.** Both scenes contain the logo and cross-fade; the element jumps in size or position; the element fades with the
scene.

**Sound.** The element keeps its own sound; a pop at the role change.

```ts
// SharedElement.ts: element box interpolated across two scenes; surroundings fade/blur out and in around it
import { interpolate } from "./lib/anim";
import { Defocus2, E, ramp } from "./seamKit";
type Box = {
    x: number;
    y: number;
    w: number;
    h: number;
    r?: number;
};
export const SharedElement: (props: {
    start: number;
    swap: number;
    end: number; // move starts, background swap frame, element lands
    from: Box;
    to: Box;
    element: (k: number) => unknown; // k 0..1: draw the element at its role blend (e.g. blue mark -> black inline mark)
    outScene: unknown;
    inScene: unknown;
    roleSwap?: number; // frame the element changes role
}) => unknown = ({ start, swap, end, from, to, element, outScene, inScene, roleSwap }) => {
    const f = frame;
    const t = ramp(f, start, end, E.inOut);
    const b = {
        x: interpolate(t, [0, 1], [from.x, to.x]),
        y: interpolate(t, [0, 1], [from.y, to.y]),
        w: interpolate(t, [0, 1], [from.w, to.w]),
        h: interpolate(t, [0, 1], [from.h, to.h]),
    };
    const outK = ramp(f, start, swap, E.cubicIn); // 10-14 f@60
    const inK = ramp(f, swap, swap + 12, E.cubicOut); // 8-16 f@60
    return ({ kind: "layer", children: [f < swap + 1 && (Defocus2({
                sigma: 12 * outK,
                max: 12,
                style: { opacity: 1 - outK },
                children: outScene
            })), f >= swap && { kind: "layer", style: { opacity: inK }, children: inScene }, { kind: "layer", style: { position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h }, children: element(roleSwap !== undefined ? (f >= roleSwap ? 1 : 0) : t) }] });
};
// Held subject, plates swap behind it every N frames, subject scale 1 -> 1.12.
export const PlateSwap: (props: {
    start: number;
    every: number;
    plates: unknown[];
    subject: unknown;
    grow?: number;
    dur: number;
}) => unknown = ({ start, every, plates, subject, grow = 1.12, dur }) => {
    const f = frame - start;
    const i = Math.min(plates.length - 1, Math.max(0, Math.floor(f / every)));
    const inPlate = f - i * every;
    const push = 1 + 0.03 * Math.min(1, inPlate / every); // each plate pushes in ~1.03 while held
    return ({ kind: "layer", children: [{ kind: "layer", style: { transform: `scale(${push})` }, children: plates[i] }, { kind: "layer", style: { transform: `scale(${1 + (grow - 1) * Math.min(1, f / dur)})` }, children: subject }] });
};
```

### 4. Continuous camera, atmosphere pass-through · `continuous-camera`

Carries: the camera. Starter: `lib/camera-moves.ts`, `fx/FloatDepth`. See `camera-type.md`.

**What.** One purposeful camera move carries into the next composition; a cloud, mist or foreground body passes the lens to
hide the switch.

**Job.** Space instead of an edit: one continuous world. The smoothest seam there is.

**Numbers.** 34-62 f60 long; peak speed at 40-57 % of the move; peak 16-133 px per frame at 30 fps; an occluder covering
70 % or more of the frame for 8-12 f60; the seam spans 0.4-0.9 s.

**Presets.**

- _Cloud pass._ The title drifts left 4-18 px per frame, then accelerates 25, 40, 95 px while it defocuses to sigma 10-12
  behind a foreground cloud that rushes past at 170-189 px per frame for 10 frames; the next composition is behind it.
- _Mist band._ A mist band (the brand blue at 70 %, Gaussian 60 px, 300 px tall) rises through the frame (centre y 1150,
  1000, 900, 760); the ground turns pale under it; the next scene is there when it leaves.
- _Tilt into darkness._ The white world slides up and dims to grey; the lockup assembles on a dark violet ground; an
  orchestral stab.
- _Tilt up._ An anchor rises 539, 533, 522, 505, 477, 441 px (x1.6 per frame) into the next composition.
- _Arcing move._ 5 -> 33 px per frame peaking at 40 % of the move, then x0.75-0.85 per frame, with a scale change of -1 to
  -2.2 % per frame.
- _Push without blur._ 2 -> 133 px per frame peaking at 57 %, scale up to +8 % per frame, no blur.

**Rich.** A purpose and a landing; parallax layers; the occluder in the foreground layer; the stop hidden.

**Cheap.** A 2D pan of one flat image; an aimless drift; fog as a full-frame opacity fade.

**Sound.** Band-pass noise 300 -> 2000 Hz over 440 ms; an orchestral stab on the landing.

```ts
// CraneThrough.ts: one tilt/crane carrying layers at parallax rates; an occluder covers the switch
import { Defocus2, Smear, table } from "./seamKit";
// title travel (px/f) integrated into an offset table; the plate moves 1.0x, the cloud ~2.2x
const TITLE_DY: Record<number, number> = {
    30: 0,
    40: -20,
    50: -75,
    55: -120,
    57: -145,
    58: -163,
    59: -188,
    60: -228,
    61: -323,
};
export const CraneThrough: (props: {
    start: number;
    plate: string;
    cloud: string;
    title: unknown;
    next: unknown;
    stop: number;
}) => unknown = ({ start, plate, cloud, title, next, stop }) => {
    const f = frame;
    const g = f - start + 30; // re-base to frames
    const dy = table(Math.min(g, 61), TITLE_DY) - (g > 61 ? (g - 61) * 120 : 0);
    const sigma = g < 57 ? 0 : Math.min(12, (g - 57) * 3); // title defocus to sigma 10-12
    const cloudY = 1080 - Math.max(0, g - 57) * 180; // foreground cloud rushes up 170-189 px/f
    return ({ kind: "layer", style: { background: "#EAF2F8", overflow: "hidden" }, children: [g < 64 ? ([{ kind: "plate", src: plate, style: { position: "absolute", width: "100%", top: 400 + dy * 1.0 } }, { kind: "layer", style: { transform: `translateY(${dy}px)` }, children: Defocus2({
                        sigma: sigma,
                        max: 12,
                        children: title
                    }) }]) : ({ kind: "layer", children: next /* the disc rises into view; its own move stops dead at `stop` */ }), g >= 57 && g <= 68 && (Smear({
                v: 180,
                axis: "y",
                k: 0.1,
                id: "cloud",
                children: { kind: "plate", src: cloud, style: { position: "absolute", left: -200, width: 2400, top: cloudY } }
            }))] });
};
// MistBand.ts: a fog band rising, the frame fills, the next scene arrives moving up
export const MistBand: (props: {
    start: number;
}) => unknown = ({ start }) => {
    const f = frame - start; // 0 = the first frame of the band
    const cy = f <= 10 ? table(f, { 0: 1150, 4: 1000, 7: 900, 10: 760 }) : 760 - (f - 10) * 60;
    return ({ kind: "layer", style: { pointerEvents: "none" }, children: [{ kind: "layer", style: {
                    position: "absolute",
                    left: -200,
                    right: -200,
                    top: cy - 150,
                    height: 300,
                    background: "linear-gradient(180deg, rgba(154,163,220,0.9), rgba(88,104,224,0.7) 40%, rgba(74,90,216,0.0))",
                    filter: "blur(60px)",
                } }, { kind: "layer", style: { background: "#D0D3E6", opacity: f < 0 ? 0 : Math.min(0.4, f * 0.04) } }] });
};
```

### 5. Morph handover · `morph`

Carries: a shape. Starter: pure recipe (`lib/moves.ts` math). See also `animations.md` `morph-container`.

**What.** One shape interpolates into the next hero on the same centre; a change of topology is hidden at the smallest,
blurriest or brightest moment (including a snap morph, a collapse to a pill, a UI send morph).

**Job.** The product's state change is the scene change.

**Numbers.** Interpolation 18-30 f60; settle 12-20 f60; a snap morph takes 2 frames with a +30 % luma flash; a collapse
under blur 8-10 f60; a swell of +52 %; the seam spans 0.1-0.35 s.

**Presets.**

- _Disc to window._ A grey disc (r 84) grows into a window, its box widening over 6 frames while the radius shrinks and the
  fill turns to the window's ground.
- _Snap morph._ A 50 % blend on the middle frame with a white-blue flash of +30 % luma for 2 frames; a cube becomes a
  concentric frosted tile.
- _Frame to chip._ A frame collapses under blur into a chip (8-10 f), drifts, squeezes, swells +52 % on a cubic-in over
  12 f, and swaps to the word.
- _Card over the face._ A frosted card slides over a face (12 px dot screen), slides left 150 px, a soft wash, and the face
  dissolves under it into the next scene.
- _Comment to pill._ A comment becomes a blue pill that arrives large and blurred while the ground darkens; it settles with
  a 0.5-degree clockwise turn and 6 px (the morph's overshoot).
- _Chip to dot._ The last chip collapses into a pill, then a dot.

**Rich.** The same centre; passing through a simpler shape; radius, size and colour all interpolating; a small overshoot
only on arrival.

**Cheap.** A scale-and-cross-fade of unrelated shapes; a path morph with mismatched points; big UI morphing into big UI;
a thumbnail growing into its own photo while the full photo already shows under it (two copies of one picture at two
scales: keep `object-fit: cover` on both sides of the handover, so the picture covers the growing box and the next scene waits
for it to land); a container growing out of a point with its text clipped by the box (a converge pops the next element
up whole instead); an empty frame round a shrinking photo (a side that fills the frame reveals the next scene round it).

**Sound.** A 6 kHz shimmer at -22 dB; a 470 Hz pop.

```ts
// BoxMorph.ts: disc -> rounded card on the same centre, with colour and radius, optional snap-flash
import { interpolate, interpolateColors } from "./lib/anim";
import { E, ramp, table } from "./seamKit";
export const BoxMorph: (props: {
    start: number;
    children?: unknown;
}) => unknown = ({ start, children, }) => {
    const f = frame - start; // 0 = the first frame of the morph (24 fps, 720p)
    if (f < 0)
        return null;
    // boxes per frame [x0,y0,x1,y1]
    const K: Record<number, number[]> = {
        1: [440, 179, 840, 540],
        2: [397, 150, 883, 569],
        3: [376, 137, 903, 582],
        4: [364, 129, 915, 590],
        5: [357, 123, 922, 596],
        6: [349, 116, 921, 604],
        18: [340, 126, 940, 594],
    };
    let box: number[];
    if (f < 1)
        box = [640 - 84, 360 - 84, 640 + 84, 360 + 84];
    else
        box = [0, 1, 2, 3].map((i) => table(f, Object.fromEntries(Object.entries(K).map(([k, v]) => [Number(k), v[i]]))));
    const w = box[2] - box[0], h = box[3] - box[1];
    const radius = f < 1
        ? w / 2
        : interpolate(f, [1, 6, 18], [Math.min(w, h) / 2, 24, 12], { extrapolateRight: "clamp" });
    const col = interpolateColors(Math.min(f, 5), [0, 1, 2, 3, 4, 5], ["#8A8A8A", "#6B6B6B", "#818181", "#9F9F9F", "#C1C1C1", "#E5E4E3"]);
    return ({ kind: "layer", children: { kind: "layer", style: {
                position: "absolute",
                left: box[0],
                top: box[1],
                width: w,
                height: h,
                cornerRadius: radius,
                background: f >= 6 ? "#FFFFFF" : col,
                overflow: "hidden",
            }, children: f >= 6 && children /* content fills after the shape lands */ } });
};
// SnapMorph: 2-frame dissolve between concentric look-alikes with a +30 % luma flash
export const SnapMorph: (props: {
    at: number;
    a: unknown;
    b: unknown;
}) => unknown = ({ at, a, b, }) => {
    const f = frame;
    const mix = f < at ? 0 : f === at ? 0.5 : 1;
    const flash = f === at || f === at + 1 ? 0.3 : 0;
    return ({ kind: "layer", children: [{ kind: "layer", style: { opacity: 1 - mix }, children: a }, { kind: "layer", style: { opacity: mix }, children: b }, { kind: "layer", style: { background: "#DDEBFF", mixBlendMode: "screen", opacity: flash } }] });
};
// SendMorph: input -> warm glow -> bubble: blur up, swap at the blurriest frame, sharpen into the bubble box
export const SendMorph: (props: {
    start: number;
    from: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    to: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    input: unknown;
    bubble: unknown;
}) => unknown = ({ start, from, to, input, bubble }) => {
    const f = frame - start;
    const t = ramp(f, 0, 14, E.inOut);
    const blur = 18 * Math.sin(Math.PI * Math.min(1, Math.max(0, f / 14))); // 0 -> 18 -> 0 px
    const b = {
        x: interpolate(t, [0, 1], [from.x, to.x]),
        y: interpolate(t, [0, 1], [from.y, to.y]),
        w: interpolate(t, [0, 1], [from.w, to.w]),
        h: interpolate(t, [0, 1], [from.h, to.h]),
    };
    return ({ kind: "layer", style: {
            position: "absolute",
            left: b.x,
            top: b.y,
            width: b.w,
            height: b.h,
            filter: blur > 0.5 ? `blur(${blur}px)` : undefined,
            background: f > 4 && f < 10
                ? "radial-gradient(closest-side, rgba(255,180,120,0.9), rgba(255,180,120,0))"
                : undefined,
        }, children: f < 7 ? input : bubble });
};
```

### 6. Whip, spin whip, spin plunge · `whip`

Carries: the camera. Starter: `fx/Seam` whip, `fx/Rush`. See also `camera-type.md` whips.

**What.** The camera or the plane accelerates to a peak at about 55 % of the move and brakes; the change happens in the
fast frames; smear on fast frames only.

**Job.** Energy, and adjacency between siblings; a whip into dark is a section break.

**Numbers.** 24-40 f60; build x1.12-1.2 per frame at 60 fps; peak 110-220 px per frame at 60 fps at 55-57 % of the move;
brake x0.80-0.85 per frame; smear 0-0.5 x the step. Spin plunge: -18 degrees and x1.28 over 28 f60.

**Presets.**

- _Asymmetric whip._ Speed 4.1 ... 66.7 px per frame peaking at 55-57 %, braking 58.6, 45.0, 33.2, 27.8, 24.2, 19.2,
  16.1 ... 0.5; smear 0.40-0.50 x the step above about 18 px per frame.
- _Long whip_ (24 fps). dx -2.5, -9.3, -19.7, -32.7, -51.0, -74.6, -107.2, -148.2, -186.9, -205, -212, -212, -205, -190,
  -175, -164, -132 ... -41.7 ... -2.2 px; no blur.
- _Card whips up._ A card's bottom edge goes 696 -> 164 px on `cubic-bezier(0.7, 0, 0.95, 0.5)`; the next card rises from
  below.
- _Vertical whip._ A white layer with a soft 500 px lower edge slides up and off while the card flies up; card blur 60, 40,
  20, 8, 0 px.
- _Spin whip_ (24 fps). Rotation up to 18.4 degrees per frame, the cloud swelling 1.033-1.040 per frame, a rim smear up to
  120 px.
- _Spin plunge._ Counter-clockwise 0, -0.3, -0.8, -2, -4, -5.5, -8, -12, -18 degrees, scale 1.01 ... 1.28 on the same
  curve, a radial edge blur on the last third, then the cut.

**Rich.** An asymmetric speed curve; one continuous plane; smear in proportion to speed on fast frames; a light layer that
can ride the whip.

**Cheap.** A constant-speed slide; a symmetric ease peaking at 50 %; blur on every frame; the next scene from nowhere.

**Sound.** 600 Hz -> 3 kHz over 200 ms at -14 dB; 300 -> 2000 Hz over 440 ms; 800 Hz -> 2.5 kHz over 300 ms; an air pop at
4.2 kHz on the landing; a sub drop.

```ts
// Whip.ts: one plane panned by a speed curve; smear only above a threshold
import { Smear, table } from "./seamKit";
// Speeds (px/f @30), peak at 0.55-0.57; dir is the screen direction of the content
const WHIP_SPEEDS = [
    4.1, 4.4, 4.9, 6.0, 7.3, 7.8, 8.2, 9.2, 11.4, 12.1, 14.2, 16.0, 18.5, 20.6, 25.5, 30.9, 36.0,
    45.3, 57.6, 66.7, 66.5, 58.6, 45.0, 33.2, 27.8, 24.2, 19.2, 16.1, 12.0, 8.5, 5.5, 3.2, 1.6, 0.5,
];
const cum = (a: number[]) => a.reduce<number[]>((o, v, i) => (o.push((o[i - 1] ?? 0) + v), o), []);
const WHIP_POS = cum(WHIP_SPEEDS);
export const Whip: (props: {
    start: number;
    dir: [
        number,
        number
    ];
    scale?: number;
    speeds?: number[];
    plane: unknown;
    smearK?: number;
}) => unknown = ({ start, dir, scale = 1, speeds = WHIP_SPEEDS, plane, smearK = 0.45 }) => {
    const f = frame - start;
    const pos = speeds === WHIP_SPEEDS ? WHIP_POS : cum(speeds);
    const i = Math.max(0, Math.min(pos.length - 1, Math.floor(f)));
    const fr = f - Math.floor(f);
    const d = f < 0 ? 0 : (pos[i] + (pos[Math.min(pos.length - 1, i + 1)] - pos[i]) * fr) * scale;
    const v = f < 0 || f >= speeds.length ? 0 : speeds[i] * scale;
    const [dx, dy] = dir;
    const n = Math.hypot(dx, dy) || 1;
    const axis: "x" | "y" = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    return ({ kind: "layer", style: { overflow: "hidden" }, children: Smear({
            v: v,
            axis: axis,
            k: smearK,
            min: 18,
            id: `whip${start}`,
            children: { kind: "layer", style: { transform: `translate(${(dx / n) * d}px, ${(dy / n) * d}px)` }, children: plane }
        }) });
};
// SpinPlunge.ts: rotation + scale on one ease-in curve, radial edge blur, cut on the last frame
const ROT: Record<number, number> = {
    0: 0,
    8: -0.3,
    12: -0.8,
    16: -2,
    20: -4,
    22: -5.5,
    24: -8,
    26: -12,
    28: -18,
};
const SCL: Record<number, number> = {
    0: 1,
    12: 1.01,
    16: 1.03,
    20: 1.06,
    22: 1.09,
    24: 1.13,
    26: 1.19,
    28: 1.28,
};
export const SpinPlunge: (props: {
    start: number;
    pivot: [
        number,
        number
    ];
    children: unknown;
}) => unknown = ({ start, pivot, children }) => {
    const f = frame - start;
    const r = table(f, ROT), s = table(f, SCL);
    const edge = Math.max(0, (f - 14) / 14); // radial edge blur from 14 f after the start
    return ({ kind: "layer", style: { overflow: "hidden" }, children: [{ kind: "layer", style: {
                    transformOrigin: `${pivot[0]}px ${pivot[1]}px`,
                    transform: `rotate(${r}deg) scale(${s})`,
                }, children: children }, { kind: "layer", style: {
                    background: `radial-gradient(closest-side, rgba(0,0,0,0) 60%, rgba(255,255,255,${0.15 * edge}) 100%)`,
                } }] });
};
```

### 7. Match cut on an anchor · `match-cut`

Carries: an anchor. Starter: `fx/MatchCut`.

**What.** A hard cut keeps one anchor within about 10 px; its size may jump; the ground and the luma may change (an anchor,
a screen, a word, a motion, a graphic).

**Job.** The cheapest way to make a hard cut flow; it creates rhyme.

**Numbers.** Anchor within 10 px; a size jump of 0.28-3.62x; the incoming motion at 1 / crop of the outgoing speed, decaying
x0.72-0.82 per frame at 30 fps; a luma jump of 37-220 is fine; the seam is one frame.

**Presets.**

- _Disc pair._ Two discs (r 292) contract x0.97 into the cut; an outline ring (r 240) and a rounded frame 975 x 486 sit on
  the pair's centre at the inherited size.
- _Punch-out._ A 3.1x crop drifts 0.03 ... 7.04 px per frame (x1.15-1.2 per frame); cut; the wide shot continues at 1.86 px
  per frame (about 1 / crop) and decays x0.72-0.82.
- _Screen to frame._ A screen rect (531 x 305 px) becomes the full frame (x3.62) on a hard cut with no zoom frames.
- _Match on motion._ A line accelerates up into the cut; the logo continues the upward motion (see `velocity-cut`).
- _Match on the word._ A card's title sits where the wordmark was; the card arrives blurred and close.
- _Graphic match._ A stem drops at x 960 (its bottom at 160, 237, 277, 303, 319, 332, 341 px), continuing a vertical from
  the last shot.

**Rich.** A meaningful anchor; the motion continuing at a scaled speed; the anchor inheriting its size.

**Cheap.** Centring unrelated objects; an anchor that jumps 30-80 px; motion that stops at the cut.

**Sound.** Usually none; a tick on montage cuts.

```ts
// MatchCut.ts: anchor box kept across the cut; outgoing drift accelerates in, incoming continues at ~1/crop and decays
import { buildInto, decayFrom } from "./seamKit";
export const AnchorMatchCut: (props: {
    cut: number;
    crop: number; // outgoing scale relative to the incoming
    anchor: [
        number,
        number
    ]; // anchor centre in INCOMING screen px; outgoing is scaled about it
    vCut?: number;
    build?: number;
    decay?: number; // 7.04 px/f, x1.18, x0.77 (@30)
    out: unknown;
    in: unknown;
}) => unknown = ({ cut, crop, anchor, vCut = 7, build = 1.18, decay = 0.77, out, in: inc }) => {
    const f = frame;
    const [ax, ay] = anchor;
    if (f < cut) {
        const x = buildInto(f, cut, vCut, build); // drift right, accelerating into the cut
        return ({ kind: "layer", style: { overflow: "hidden" }, children: { kind: "layer", style: {
                    transformOrigin: `${ax}px ${ay}px`,
                    transform: `translateX(${-x}px) scale(${crop})`,
                }, children: out } });
    }
    const x = decayFrom(f, cut, vCut / crop, decay); // continues at ~1/crop of the speed
    return ({ kind: "layer", style: { overflow: "hidden", transform: `translateX(${x}px)` }, children: inc });
};
// Ring carried across photo cuts: one outline ring on a kept centre, opening at the inherited radius
export const CarriedRing: (props: {
    cuts: number[];
    centre: [
        number,
        number
    ];
    radii: number[];
    contract?: number;
}) => unknown = ({ cuts, centre, radii, contract = 0.985 }) => {
    const f = frame;
    const i = cuts.filter((c) => f >= c).length - 1;
    if (i < 0)
        return null;
    const r = radii[i] * Math.pow(contract, f - cuts[i]); // still contracting after the cut, then settle
    return ({
        kind: "vector",
        width: 1920,
        height: 1080,
        style: { position: "absolute" },
        children: {
            kind: "circle",
            cx: centre[0],
            cy: centre[1],
            r: r,
            fill: "none",
            stroke: "#FFFFFF",
            strokeWidth: 4
        }
    });
};
```

### 8. Iris or mask from a meaningful point · `iris`

Carries: a point that becomes a place. Starter: `fx/Iris`. See also `effects.md` `iris`.

**What.** A mask centred on a meaningful point opens onto the next scene, already playing inside (scalloped, vesica,
porthole under UI, black disc, pixel-mosaic ring, curtains).

**Job.** An action becomes a place: "open this".

**Numbers.** A fast iris grows x1.55-1.7 per frame at 30 fps (x1.27 at 60); a soft iris takes 13-15 f; a brand iris 36 f at
30 fps; a vesica 4 f; edge 0-12 px soft; the motion inside runs 1-1.15x the outgoing motion; a house opening takes 9 f.

**Presets.**

- _Word-gap iris._ Centred in a gap between words: r 22, 44, 76, 122, 190, 295, 474, 805 px, then full (r = 22 x
  1.62^frame); a hard edge; the line inside is 1.15x the outgoing line.
- _Black disc from a button._ A hard-edged black disc grows from the clicked button: r 50, 95, 226, 370, 490, 590, 674,
  748, 813, 871, 923, 971, 1014, 1050, 1085 px ... (decelerating).
- _Porthole under the chat._ r 202, 305, 396, 472, 538, 593, 643, 688, 728, 765, 798, 828, 855 px at 24 fps under the chat
  layer; a 3 px soft edge and a 2 px rim.
- _Pill to iris._ A pill widens, then an iris opens: diameter 808, 1424, 1730, 1898 px, then full.
- _Scalloped window._ 14 lobes, a soft 12 px edge, fast-slow-fast over 36 f; the star in its centre darkens to a black hole.
- _Curtains and vesica._ Two spheres (r about 820) close like curtains; their overlap is the window, with a 3-4 px violet
  rim and a 40-80 px inner glow.

**Rich.** A meaningful (sometimes moving) centre; the next scene already moving inside; a mask with character; a rim light.

**Cheap.** A centred circle on a static frame; a linear radius; a big feather; an iris as an exit with nothing inside.

**Sound.** An 800 Hz -> 3 kHz swish (120 ms) plus a 700 Hz pop (40 ms) at -10 dBFS; a pop with an 800-930 Hz ding.

```ts
// Iris.ts: geometric or tabled circular iris; inside renders the next scene at its own clock
import { table } from "./seamKit";
export const GeoIris: (props: {
    start: number;
    centre: [
        number,
        number
    ];
    r0?: number;
    ratio?: number;
    next: unknown;
    nextStartsAt: number;
    prev: unknown;
    rim?: string;
}) => unknown = ({ start, centre, r0 = 22, ratio = 1.62, next, nextStartsAt, prev, rim }) => {
    const f = frame;
    const r = f < start ? 0 : r0 * Math.pow(ratio, f - start);
    const [cx, cy] = centre;
    const far = Math.hypot(Math.max(cx, 1920 - cx), Math.max(cy, 1080 - cy));
    if (r >= far)
        return ({ kind: "layer", children: LayerSpan({ from: nextStartsAt, children: next }) });
    return ({ kind: "layer", children: [prev, r > 0 && ({ kind: "layer", style: { aperture: `circle(${r}px at ${cx}px ${cy}px)` }, children: LayerSpan({ from: nextStartsAt, children: next }) }), rim && r > 0 && ({
                kind: "vector",
                width: 1920,
                height: 1080,
                style: { position: "absolute" },
                children: {
                    kind: "circle",
                    cx: cx,
                    cy: cy,
                    r: r,
                    fill: "none",
                    stroke: rim,
                    strokeWidth: 2
                }
            })] });
};
// Radii per frame: pass as a table instead of a ratio
export const DISC_IRIS: Record<number, number> = {
    0: 50,
    1: 95,
    2: 226,
    3: 370,
    4: 490,
    5: 590,
    6: 674,
    7: 748,
    8: 813,
    9: 871,
    10: 923,
    11: 971,
    12: 1014,
    13: 1050,
    14: 1085,
    15: 1105,
};
export const PORTHOLE_RADII: Record<number, number> = {
    0: 202,
    1: 305,
    2: 396,
    3: 472,
    4: 538,
    5: 593,
    6: 643,
    7: 688,
    8: 728,
    9: 765,
    10: 798,
    11: 828,
    12: 855,
};
// Vesica.ts: the overlap of two circles (r 820) whose centres approach
export const Vesica: (props: {
    start: number;
    next: unknown;
}) => unknown = ({ start, next }) => {
    const f = frame - start;
    const d = table(f, { 0: 1330, 1: 1100, 2: 800, 3: 420, 4: 0 }); // centre distance (1330 px on the first frame), accelerating
    const cxA = 960 - d / 2, cxB = 960 + d / 2, cy = 600, r = 820;
    return ({ kind: "layer", children: [{
                kind: "vector",
                width: 0,
                height: 0,
                children: { kind: "defs", children: { kind: "apertureMask", id: "vesA", children: {
                            kind: "circle",
                            cx: cxA,
                            cy: cy,
                            r: r
                        } } }
            }, { kind: "layer", style: { aperture: "url(#vesA)" }, children: { kind: "layer", style: { aperture: `circle(${r}px at ${cxB}px ${cy}px)` }, children: next } }, {
                kind: "vector",
                width: 1920,
                height: 1080,
                style: { position: "absolute" },
                children: [{
                        kind: "circle",
                        cx: cxA,
                        cy: cy,
                        r: r,
                        fill: "none",
                        stroke: "#754CD9",
                        strokeWidth: 3.5
                    }, {
                        kind: "circle",
                        cx: cxB,
                        cy: cy,
                        r: r,
                        fill: "none",
                        stroke: "#754CD9",
                        strokeWidth: 3.5
                    }]
            }] });
};
```

### 9. Light-carried handover · `light-carried`

Carries: light. Starter: `fx/Exposure`, `fx/Washes`. See also `effects.md` `light-flood`.

**What.** Light crosses or fills the frame; the old picture darkens or fades under it; the cut lands inside the brightest
frames (a flood, a light-sweep wipe, a white wash, an impact wash, streaks).

**Job.** Revelation, a change of state: something took effect.

**Numbers.** 10-20 f60; soft edges 120-500 px; a wash peaking at 0.35-1; streak bands 80-220 px.

**Presets.**

- _Diagonal flood._ Left / right luma 71/85, 76/83, 84/78, 99/65, 122/36, 145/14, 153/2 over 12 f: a lavender light comes
  in diagonally from the left while the right side falls to black; the cut lands inside the light.
- _Sweeping pool._ The camera pans right, accelerating, while a light pool sweeps right to left; a bright band crosses and
  leaves.
- _White wash._ A white layer with a 500 px soft edge travels x 1650 -> -300 over 11 f on an ease-out; the macro fades
  under it; the next line cuts on at about 70 % of the run.
- _Impact wash._ On an impact, median luma 115 -> 204; the next frame a lavender-white wash with a pink ring (r 70, ring
  20 px); the ground settles over 5 f.
- _Rising panel._ A white panel with a soft 120 px top edge rises about 370 px per frame; the next line rides on it.
- _Field overlay._ The floor light dims (luma 74, 70, 63, 50), then a lavender-white field overlay 0, 0.10, 0.30, 0.55,
  0.80, 1.0 over 6 f; the outgoing scene desaturates under it.

**Rich.** Directional, shaped light; the frame reacting (the far side darkens, desaturates, blurs); the cut inside the
light; the new scene's light settling.

**Cheap.** A uniform fade to white and back; a directionless flash; light that does not affect the picture.

**Sound.** A reversed swell (300 ms, -16 dB); a low hit with a pad (1.1 s); a 79 Hz punch after streaks.

```ts
// LightFlood.ts: a directional light floods in from one side, the far side darkens, cut under the light
import { E, ramp } from "./seamKit";
export const LightFlood: (props: {
    start: number;
    cut: number;
    light?: string;
    from?: "left" | "right";
    out: unknown;
    in: unknown;
}) => unknown = ({ start, cut, light = "#A59CED", from = "left", out, in: inc }) => {
    const f = frame;
    const k = ramp(f, start, cut, E.quadIn); // luma left 71 -> 153, right 85 -> 2
    const after = ramp(f, cut, cut + 6, E.cubicOut); // the new field's light settles
    const dir = from === "left" ? "115deg" : "-65deg";
    return ({ kind: "layer", children: f < cut ? ([out, { kind: "layer", style: {
                    background: `linear-gradient(${dir}, rgba(0,0,0,0) 30%, rgba(0,0,0,${0.97 * k}) 85%)`,
                } }, { kind: "layer", style: {
                    background: `linear-gradient(${dir}, ${light} 0%, rgba(165,156,237,0) ${20 + 60 * k}%)`,
                    opacity: 0.25 + 0.75 * k,
                } }]) : ([inc, { kind: "layer", style: {
                    background: `linear-gradient(${dir}, ${light} 0%, rgba(165,156,237,0) 70%)`,
                    opacity: 1 - after,
                } }]) });
};
// WhiteWash.ts: a white layer whose 500 px soft edge travels x 1650 -> -300 (ease-out)
export const WhiteWash: (props: {
    start: number;
    end: number;
    color?: string;
    under: unknown;
    over?: unknown;
    overAt?: number;
}) => unknown = ({ start, end, color = "#F4F8F9", under, over, overAt }) => {
    const f = frame;
    const x = 1650 + (-300 - 1650) * ramp(f, start, end, E.cubicOut);
    const fadeUnder = 1 - ramp(f, start + 3, end + 1);
    const mask = `linear-gradient(90deg, transparent ${x - 250}px, black ${x + 250}px)`;
    return ({ kind: "layer", children: [{ kind: "layer", style: { opacity: fadeUnder }, children: under }, { kind: "layer", style: { background: color, maskImage: mask, WebkitMaskImage: mask } }, over && overAt !== undefined && f >= overAt && over] });
};
```

### 10. Exit then enter on a kept ground · `exit-then-enter`

Carries: the ground. Starter: `fx/Seam` exit-enter.

**What.** The ground never cuts; the outgoing element accelerates away under blur and fades; 0-6 f of ground only; the
incoming element arrives from blur on an expo-out.

**Job.** The next thought; the ground holds the film together.

**Numbers.** Exit 12-18 f60 (8-24 px of travel, a cubic or expo-in, opacity 1 -> 0, blur 0 -> 10-12 px); a gap of 0-6 f60;
entry 14-24 f60 from 4-12 px of blur; overshoot 6 % at most; house 18 f in all.

**Presets.**

- _Standard._ Exit over 12-18 f with steps of 2, 3, 4, 5, 6, 6, 6, 8, 12, 16, 24 px per frame, opacity to 0 and blur to
  10-12 px; a gap of 0-6 f; entry over 14-24 f from blur on an expo-out.
- _Tracking exit._ Blur 0, 1, 2, 3 px, scale 1 -> 0.97, tracking 0 -> +0.25 -> +0.6 em over 3 frames, colour to grey,
  opacity 0.8 -> 0.5; the entry drops 18 px into place.
- _One empty frame._ Exactly one frame of bare ground between the lines.
- _Whip up and out._ A card whips up and out; the next line starts blurred.
- _Under a floor light._ The wordmark dims under a rising floor light; the hero stage rises; the headline drops in.

**Rich.** The ground keeps living during the gap; an exit with character, accelerating; an entry with a different
character; a short empty moment.

**Cheap.** A same-speed fade out and in with a long gap; linear on both sides; cutting the ground.

**Sound.** Often none; a tick on the entry.

```ts
// ExitEnter.ts: kept ground; exit accelerates + blurs + fades; optional empty frames; entry from blur, expo-out
import { Defocus2, E, ramp } from "./seamKit";
export const ExitEnter: (props: {
    exitStart: number;
    exitFrames?: number;
    gap?: number;
    enterFrames?: number;
    exitDy?: number;
    enterDy?: number;
    blur?: number;
    tracking?: boolean;
    ground: unknown;
    out: unknown;
    in: unknown;
}) => unknown = ({ exitStart, exitFrames = 8, gap = 1, enterFrames = 10, exitDy = -16, enterDy = 20, blur = 10, tracking = false, ground, out, in: inc, }) => {
    const f = frame;
    const e = ramp(f, exitStart, exitStart + exitFrames, E.expoIn);
    const enterStart = exitStart + exitFrames + gap;
    const n = ramp(f, enterStart, enterStart + enterFrames, E.expoOut);
    return ({ kind: "layer", children: [ground /* keeps moving: never cut */, f < exitStart + exitFrames && ({ kind: "layer", style: {
                    opacity: 1 - e,
                    transform: `translateY(${exitDy * e}px) scale(${1 - 0.03 * e})`,
                    letterSpacing: tracking ? `${0.6 * e}em` : undefined,
                    color: tracking ? undefined : undefined,
                }, children: Defocus2({
                    sigma: blur * e,
                    max: blur,
                    children: out
                }) }), f >= enterStart && ({ kind: "layer", style: { opacity: n, transform: `translateY(${enterDy * (1 - n)}px)` }, children: Defocus2({
                    sigma: blur * (1 - n),
                    max: blur,
                    children: inc
                }) })] });
};
```

### 11. Cross-over: blur-scale overlap of two type states · `cross-over`

Carries: the sentence. Starter: pure recipe (`lib/moves.ts` math).

**What.** The outgoing line evaporates left to right while shrinking; the incoming line enters huge and blurred from the
side and resolves; 2-6 f overlap; the frame is never empty.

**Job.** A sentence that never stops: nothing feels cut, even across a long film.

**Numbers.** Evaporation over 5-8 f at 24 fps; the front moves about 160 px per frame and is 0.6-0.8 word widths soft; an
overlap of 2-6 f; the incoming line starts at 1.6-2.5x and settles in 14-19 f at 24 fps.

**Presets.**

- _Evaporate and arrive._ The first line evaporates left to right (a 0.6-0.8 word-width ramp over 6-8 f) while shrinking;
  the product name enters huge and blurred from the left and resolves.
- _Front positions._ The evaporation front at x 583, 716, 878, 1038, 1217 px, gone on the sixth frame; the second line one
  frame later; a planet sinks; a chip fades in.
- _Cut over the fade._ The line fades left to right; a hard cut puts the next word, huge, over the last fading letters.

**Rich.** Each layer keeps its own motion; a soft, directional, slightly blurred front; a short overlap.

**Cheap.** An opacity cross-fade of two centred lines; a hard left-to-right wipe; static lines.

**Sound.** An airy tick and a falling click sweep (-36 semitones).

```ts
// CrossOver.ts: outgoing evaporates L->R (soft mask front + blur) while still shrinking; incoming scales in huge from the left
import { Defocus2, E, lerp, ramp } from "./seamKit";
export const CrossOver: (props: {
    start: number; // first frame of the evaporation
    evap?: number; // frames of evaporation (6-8)
    inStart?: number; // incoming appears
    settle?: number; // incoming resolves (19 f at 24 fps)
    lineBox: [
        number,
        number
    ]; // outgoing ink x0, x1 (px)
    out: unknown;
    in: unknown;
}) => unknown = ({ start, evap = 6, inStart, settle = 19, lineBox, out, in: inc }) => {
    const f = frame;
    const s0 = inStart ?? start + 1;
    const p = ramp(f, start, start + evap, (x) => x); // front speed constant (~160 px/f)
    const [x0, x1] = lineBox;
    const ramp_w = (0.7 * (x1 - x0)) / 4; // soft ramp ~0.6-0.8 of a word width (4-word line)
    const front = lerp(x0 - ramp_w, x1 + ramp_w, p);
    const mask = `linear-gradient(90deg, transparent ${front - ramp_w}px, black ${front + ramp_w}px)`;
    const shrink = 1 - 0.014 * Math.max(0, f - start) * (1 + p); // keeps shrinking, faster as it leaves
    const k = ramp(f, s0, s0 + settle, E.expoOut);
    const inScale = lerp(2.2, 1, k), inX = lerp(-520, 0, k); // huge, from the left side, to centre
    return ({ kind: "layer", children: [f < start + evap && ({ kind: "layer", style: {
                    transform: `scale(${shrink})`,
                    maskImage: f >= start ? mask : undefined,
                    WebkitMaskImage: f >= start ? mask : undefined,
                }, children: out }), f >= s0 && ({ kind: "layer", style: {
                    transform: `translateX(${inX}px) scale(${inScale})`,
                    opacity: Math.min(1, 0.4 + k),
                }, children: Defocus2({
                    sigma: 12 * (1 - k),
                    max: 12,
                    children: inc
                }) })] });
};
```

### 12. Blur-through, defocus cut · `blur-through`

Carries: blur. Starter: `fx/Defocus`, `fx/RackFocus`, `fx/Seam` defocus. See also `effects.md` `defocus-exit`.

**What.** The outgoing shot defocuses while moving or scaling away; the cut lands at the blur peak; the incoming shot
resolves while keeping some velocity.

**Job.** Premium lens softness; the colour-blob variant changes the mood.

**Numbers.** Out over 12-16 f60 to a 24-40 px peak; in over 10-16 f60 keeping 0.5-0.8 of the velocity; a landing scale of
1.13 -> 1.0; the seam spans 0.2-1.4 s.

**Presets.**

- _Blur morph inside a whip._ Inside the whip's blur the window cross-dissolves into a dark glass card; the card lands
  shrinking 1.13 -> 1.0 while sharpening.
- _Blob rise._ A warm blob (three palette stops) rises from the bottom-left on a power-in curve, covering the lower 40 %;
  the picture blurs 0 -> about 40 px over 16 f; the blob becomes the next ground.
- _Blur to empty._ The whole picture blurs to an empty white frame.
- _Rows resolve._ Rows resolve with speeds 105, 55, 40, 30, 24, 19 px per frame while their sharpness doubles over 8 f.
- _Dim and bloom._ A slab dims (luma 74 -> 49 over 6 f), then after the cut 49 -> 79 -> 156 -> 205 in 3 f.

**Rich.** Blur with motion and scale; a colour field rising into the blur; a landing scale decay.

**Cheap.** A blur ramp on a static frame plus a cross-fade; an animated blur radius on a full-frame layer.

**Sound.** A whoosh at about 1.2 kHz over 310 ms.

```ts
// BlurThrough.ts: out blurs + scales away (quad-in), cut at the peak, in resolves (expo-out) and lands 1.13 -> 1.0
import { Defocus2, E, ramp } from "./seamKit";
export const BlurThrough: (props: {
    cut: number;
    outFrames?: number;
    inFrames?: number;
    peak?: number;
    land?: number;
    blob?: unknown;
    out: unknown;
    in: unknown;
}) => unknown = ({ cut, outFrames = 8, inFrames = 7, peak = 32, land = 1.13, blob, out, in: inc }) => {
    const f = frame;
    if (f < cut) {
        const k = ramp(f, cut - outFrames, cut, E.quadIn);
        return ({ kind: "layer", children: [{ kind: "layer", style: { transform: `scale(${1 - 0.06 * k})` }, children: Defocus2({
                        sigma: peak * k,
                        max: peak,
                        children: out
                    }) }, blob && ({ kind: "layer", style: {
                        transform: `translate(${-400 * (1 - Math.pow(k, 1.3))}px, ${500 * (1 - Math.pow(k, 1.3))}px)`,
                    }, children: blob })] });
    }
    const k = ramp(f, cut, cut + inFrames, E.expoOut);
    return ({ kind: "layer", style: { transform: `scale(${land + (1 - land) * k})` }, children: Defocus2({
            sigma: peak * (1 - k),
            max: peak,
            children: inc
        }) });
};
```

### 13. Push wipe, doors, push-out by the next element · `push-wipe`

Carries: an edge. Starter: pure recipe (`lib/moves.ts` math).

**What.** A hard edge pushes the old shot (which moves first); or the layout splits like doors and the next element rises
through; or a new element shoves the old one out.

**Job.** Cause and effect; the layout becomes the transition.

**Numbers.** The edge enters at 70-90 px per frame at 60 fps and decays x0.79-0.85 per frame at 30 fps; the old shot moves at
0.60-0.63 of the edge speed; 40-48 f60. Doors grow x1.5 per frame over 12 f at 24 fps. A half-frame push takes 20-26 f60;
streaks 0.28-0.34 x the step.

**Presets.**

- _Edge push._ The old shot moves first (4, 10, 20, 32 px); the edge follows at 142, 134, 106, 84, 66, 52, 44, 38, 32, 26,
  24, 20, 18, 16, 12, 12, 10, 8, 6, 6, 4 px per frame and stops at 48 % of the width; the old shot moves at 0.6x the edge.
- _Doors._ A card peeks 31 px; the doors open 0.3, 3.5, 5.6, 8.7, 13.4, 19.9, 28.6, 44.4, 79.5, about 256, 257 px per frame
  (x1.5 per frame); the card rises through them (its top 976 -> 168, peaking at about 110 px per frame).
- _Card push._ A placard rises from the bottom and pushes the card up and out.
- _Half-frame push._ The phone leaves up 6, 8, 11, 13, 18, 26, 42, 66, 91 px per frame; cut; the next shot moves 94, 66, 47,
  34, 25, 19 (x0.7-0.75 per frame); the copy rewrites in place.
- _Layout in and out._ The layout comes in from below on a circ-out (dy +260 -> +3 over 57 f) and leaves on a quad-in (-28
  px per frame at the cut), with vertical motion blur at both ends.

**Rich.** The old shot reacting (moving first, at 0.6x); an edge speed profile with a streak; back-loaded doors with the card
riding their speed.

**Cheap.** A feathered wipe on a static shot; a linear slide; doors on a symmetric ease.

**Sound.** A punchy impact with a 1.2 s ring; a pop per placard.

```ts
// PushWipe.ts: two-stage push wipe from the edge steps below; old shot pushed at 0.62x the edge
import { Smear } from "./seamKit";
const PRE = [4, 10, 20, 32]; // old shot moves first (4 f)
const STAGE1 = [142, 134, 106, 84, 66, 52, 44, 38, 32, 26, 24, 20, 18, 16, 12, 12, 10, 8, 6, 6, 4]; // edge (21 f)
const STAGE2 = [6, 10, 10, 14, 18, 20, 26, 30, 38, 44, 52, 60, 68, 76, 82]; // edge leaves (from hold end)
const sum = (a: number[], n: number) => a.slice(0, Math.max(0, Math.min(a.length, n))).reduce((s, v) => s + v, 0);
export const PushWipe: (props: {
    start: number;
    hold?: number;
    panel: unknown;
    under: unknown;
    W?: number;
}) => unknown = ({ start, hold = 0, panel, under, W = 1920 }) => {
    const f = frame - start; // 0 = the old shot's first move
    const e1 = f - PRE.length; // edge stage-1 frame index
    const s2Start = PRE.length + STAGE1.length + hold;
    let edge = 0, v = 0; // edge = px the panel has covered from the right
    if (e1 >= 0) {
        edge = sum(STAGE1, e1);
        v = STAGE1[Math.min(STAGE1.length - 1, e1)] ?? 0;
    }
    if (f >= s2Start) {
        const k = f - s2Start;
        edge = sum(STAGE1, STAGE1.length) + sum(STAGE2, k);
        v = STAGE2[Math.min(STAGE2.length - 1, k)];
    }
    const oldShift = f < PRE.length
        ? -sum(PRE, f)
        : -sum(PRE, PRE.length) - 0.62 * Math.min(edge, sum(STAGE1, STAGE1.length));
    return ({ kind: "layer", style: { overflow: "hidden" }, children: [{ kind: "layer", style: { transform: `translateX(${oldShift}px)` }, children: under }, Smear({
                v: v,
                k: 0.31,
                min: 8,
                id: `pw${start}`,
                children: { kind: "layer", style: { transform: `translateX(${W - edge}px)` }, children: panel }
            })] });
};
// DoorSplit.ts: doors (x1.5/f, back-loaded) + the card rising through the gap at the doors' speed turned 90 deg
const DOOR_V = [0.3, 3.5, 5.6, 8.7, 13.4, 19.9, 28.6, 44.4, 79.5, 256, 257, 257];
const RISE_TOP = [976, 910, 836, 752, 658, 546, 436, 358, 308, 274, 252, 232, 204, 188, 176, 168];
export const DoorSplit: (props: {
    start: number;
    left: unknown;
    right: unknown;
    card: unknown;
}) => unknown = ({ start, left, right, card }) => {
    const f = frame - start; // 0 = doors start; the card rises from 5
    const d = sum(DOOR_V, f);
    const top = f < 5 ? 1040 : RISE_TOP[Math.min(RISE_TOP.length - 1, f - 5)];
    return ({ kind: "layer", style: { overflow: "hidden" }, children: [{ kind: "layer", style: { transform: `translateX(${-d}px)` }, children: left }, { kind: "layer", style: { transform: `translateX(${d}px)` }, children: right }, { kind: "layer", style: { position: "absolute", left: 0, right: 0, top }, children: card }] });
};
```

### 14. Flash frames: white, black, glow, inverted · `flash-frames`

Carries: light. Starter: pure recipe (`lib/moves.ts` math), `fx/CutFx`. See also `effects.md` `flash-frame`.

**What.** 1-6 frames of designed light (or its negative) replace the picture at the seam (a white frame, a glow frame, an
inverted frame, a flash inside a whip, a capture flash, a white matte).

**Job.** Punctuation: the old thing became the new thing.

**Numbers.** 1-6 frames; a decay over 3-4 frames; the incoming shot arrives about 3x faster than the whip that led in.

**Presets.**

- _Ghost flash in a whip._ The whip builds x1.25 per frame to 52 px per frame; one frame `#EDEDED` with a 30 px blurred grey
  ghost of the box and grey smears; then the next shot.
- _Single white frames._ One pure white frame between statements; two glow frames; one inverted frame with a 4 px glow, one
  dark navy frame, then the cut.
- _Flash at the end of a push._ A stepped push 1.000, 1.020, 1.067, 1.143, 1.248, 1.379, 1.529, then a flash cut.
- _Overlay decay._ A white overlay 1, 0.667, 0.333, 0 over 4 frames.
- _Capture flash._ `brightness(2.6) contrast(1.6)` on the picture; the layout swaps under the flash.
- _White matte._ A white matte on the subject 1.0, 0.6, 0.12, 0.

**Rich.** A flash with content (a ghost, streaks); inside motion; the next shot arriving fast.

**Cheap.** A generic 3-frame white fade on a still; a flash on every cut; a silent flash.

**Sound.** A pop with a falling sweep (-21 semitones, 130 ms); a pop on the inverted frame.

```ts
// FlashFrames.ts: a 1-2 frame flash with content (ghost / streaks / invert), then the next shot arrives fast
import { decayFrom, hash, Smear } from "./seamKit";
export const GhostFlash: (props: {
    at: number;
    ghost?: unknown;
    out: unknown;
    in: unknown;
    slideV0?: number;
}) => unknown = ({ at, ghost, out, in: inc, slideV0 = 220 }) => {
    const f = frame;
    if (f < at)
        return { kind: "layer", children: out };
    if (f === at)
        // the white frame with a 30 px blurred ghost of the old layout
        return ({ kind: "layer", style: { background: "#EDEDED" }, children: ghost && ({ kind: "layer", style: { filter: "blur(30px)", opacity: 0.55 }, children: ghost }) });
    if (f === at + 1)
        // the black streak frame
        return ({ kind: "layer", style: { background: "#060606" }, children: Array.from({ length: 12 }).map((_, i) => {
                const y = 401 + hash(i, 7) * 214, w = 300 + hash(i, 9) * 700, x = 1714 - w - hash(i, 3) * 200;
                return ({ kind: "layer", key: i, style: {
                        position: "absolute",
                        left: x,
                        top: y,
                        width: w,
                        height: 2 + 2 * hash(i, 5),
                        background: `linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,${0.25 + 0.64 * hash(i, 4)}))`,
                        filter: "blur(1px)",
                    } });
            }) });
    const x = decayFrom(f, at + 2, slideV0, 0.8); // opens at ~3x the whip's last step, x0.78-0.85/f
    const v = slideV0 * Math.pow(0.8, f - at - 2);
    return (Smear({
        v: v,
        k: 0.45,
        id: `gf${at}`,
        children: { kind: "layer", style: { transform: `translateX(${slideV0 / 0.2 - x}px)` }, children: inc }
    }));
};
export const InvertFrame: (props: {
    at: number;
    out: unknown;
    in: unknown;
}) => unknown = ({ at, out, in: inc, }) => {
    const f = frame;
    if (f < at)
        return { kind: "layer", children: out };
    if (f === at)
        return ({ kind: "layer", style: {
                filter: "invert(1) hue-rotate(180deg) drop-shadow(0 0 4px rgba(255,255,255,0.6))",
            }, children: out });
    if (f === at + 1)
        return { kind: "layer", style: { background: "#0A1020" } };
    return { kind: "layer", children: inc };
};
export const CaptureFlash: (props: {
    start: number;
    switchAt: number;
    end: number;
    a: unknown;
    b: unknown;
}) => unknown = ({ start, switchAt, end, a, b }) => {
    const f = frame;
    const on = f >= start && f < end;
    return ({ kind: "layer", style: { filter: on ? "brightness(2.6) contrast(1.6) saturate(1.8)" : undefined }, children: f < switchAt ? a : b });
};
```

### 15. Snap zoom, punch-in, reframe cut · `snap-punch`

Carries: the frame. Starter: `fx/SnapZoom`. See also `animations.md` `punch-in`.

**What.** The same scene re-framed in 1-2 frames: a punch-in with a landing blur, a x5-x8 snap zoom, or a hidden snap zoom
under a defocus and a luma flash.

**Job.** Look closer without leaving the scene; it keeps long UI holds alive.

**Numbers.** Punch x1.07-1.5; big jumps x1.97-5; snaps x5.8-7.9; punch-outs x0.11-0.52; a landing blur of 3-6 px over 2-3 f;
a creep of 0.4-0.9 % afterwards.

**Presets.**

- _Snap onto the anchor._ x5.8 then x1.364 (x7.9 in total) on the focal anchor, no blur; a snap out x0.112 over 2 frames.
- _Punch with landing blur._ x1.347 about the centre with blur 6, 4, 2, 0 px; later x1.126 with blur 3, 1.5, 0; then a creep
  1.000 -> 1.006 -> 1.008 -> 1.009.
- _Hidden snap-out._ A slow pull 0.998 ... 0.961, a jump 0.85 -> 0.52 under a defocus that clears in 5-6 f and a luma lift
  92 -> 148, then 0.967 ... 0.994.
- _Cut onto the avatar._ A x5 cut onto the avatar, then a push 1.078, 1.045, 1.034, 1.024, 1.022, 1.019 per frame.

**Rich.** Centred on what changes next; a landing blur and a slow creep; exact 2-frame snaps.

**Cheap.** A wandering 15-frame zoom; a punch on nothing; a pixelated raster.

**Sound.** A tick on each punch-in.

```ts
// PunchIn.ts: cut to a closer framing about a centre, landing blur 6/4/2/0, then a slow creep
import { Defocus2 } from "./seamKit";
export const PunchIns: (props: {
    cuts: {
        at: number;
        k: number;
        blur: number[];
    }[];
    centre?: [
        number,
        number
    ];
    children: unknown;
}) => unknown = ({ cuts, centre = [960, 540], children }) => {
    const f = frame;
    let s = 1, sigma = 0;
    for (const c of cuts) {
        if (f >= c.at) {
            s *= c.k;
            const i = f - c.at;
            sigma = i < c.blur.length ? c.blur[i] : 0;
            s *= 1 + 0.009 * (1 - Math.exp(-(f - c.at) / 6)); // creep 1.000 -> 1.006 (5 f) -> 1.009
        }
    }
    return ({ kind: "layer", style: { overflow: "hidden" }, children: { kind: "layer", style: { transformOrigin: `${centre[0]}px ${centre[1]}px`, transform: `scale(${s})` }, children: Defocus2({
                sigma: sigma,
                max: 6,
                children: children
            }) } });
};
// <PunchIns cuts={[{at: 90, k: 1.347, blur: [6, 4, 2]}, {at: 110, k: 1.126, blur: [3, 1.5]}]}>{card}</PunchIns>
// SnapZoom2: x5.8 then x1.364 more on two frames, about the pivot, no blur
export const SnapZoom2: (props: {
    at: number;
    pivot: [
        number,
        number
    ];
    children: unknown;
}) => unknown = ({ at, pivot, children }) => {
    const f = frame;
    const s = f < at ? 1 : f === at ? 5.8 : 7.9;
    return ({ kind: "layer", style: { overflow: "hidden" }, children: { kind: "layer", style: {
                transformOrigin: `${pivot[0]}px ${pivot[1]}px`,
                transform: `translate(${(960 - pivot[0]) * (s > 1 ? 1 : 0)}px, 0) scale(${s})`,
            }, children: children } });
};
```

### 16. Text swap in a held slot · `text-swap`

Carries: the slot. Starter: pure recipe (`lib/moves.ts` math). See also `animations.md` `swap-drum`.

**What.** The slot holds; the words change inside a camera move, under blur, by a push-up stack, by a letter swap or by an
ink-in.

**Job.** The slot is the speaker.

**Numbers.** A blur swap 18-22 f60; a push-up 16-20 f60; an ink-in 10-20 f60; a swap zoom rate of 0.95-1.048 per frame.

**Presets.**

- _Swap in a push._ Scale per frame 1.000 (held 8 f), 1.005, 1.010, 1.010, 1.015, 1.022, 1.030, 1.039, 1.049, 1.064, 1.079,
  1.104, 1.133, 1.178; the swap lands on the fastest frame.
- _Push-up stack._ The old line pushes up 5, 12, 39, 35, 18, 13, 8, 6, 2 px per frame; the new line rises under it.
- _Letter swap._ One phrase turns into another letter by letter in place (outgoing letters drop, new ones rise).
- _Blur swap._ The line blurs out, one empty frame, the next line blurs in.

**Rich.** The swap hidden in speed or blur, or made an event; a smooth re-centring.

**Cheap.** A cross-fade in place; the centre jumping; a typewriter on every swap.

**Sound.** A 240 Hz thump with a 2 kHz tick.

```ts
// SwapInPush.ts: the copy swaps on the fastest frame of the push
import { table } from "./seamKit";
const S: Record<number, number> = {
    72: 1,
    79: 1,
    80: 1.005,
    81: 1.01,
    82: 1.01,
    83: 1.015,
    84: 1.022,
    85: 1.03,
    86: 1.039,
    87: 1.049,
    88: 1.064,
    89: 1.079,
    90: 1.104,
    91: 1.133,
    92: 1.178,
    93: 1.235,
};
export const SwapInPush: (props: {
    offset: number;
    swapAt?: number;
    pivot?: [
        number,
        number
    ];
    a: unknown;
    b: unknown;
}) => unknown = ({ offset, swapAt = 93, pivot = [960, 540], a, b }) => {
    const f = frame + offset; // map to frames
    const s = table(f, S);
    return ({ kind: "layer", style: { transformOrigin: `${pivot[0]}px ${pivot[1]}px`, transform: `scale(${s})` }, children: f < swapAt ? a : b });
};
// PushUpStack: new line enters one pitch below and pushes the old up; old ends at 40 %
const STEPS = [5, 12, 39, 35, 18, 13, 8, 6, 2];
export const PushUpStack: (props: {
    start: number;
    pitch: number;
    old: unknown;
    next: unknown;
}) => unknown = ({ start, pitch, old, next }) => {
    const f = frame - start;
    const moved = STEPS.slice(0, Math.max(0, Math.min(STEPS.length, f))).reduce((s, v) => s + v, 0);
    const k = moved / STEPS.reduce((s, v) => s + v, 0);
    return ({ kind: "layer", style: { transform: `translateY(${-pitch * k}px)` }, children: [{ kind: "layer", style: { opacity: 1 - 0.6 * k }, children: old }, { kind: "layer", style: { position: "absolute", top: pitch, left: 0, right: 0, opacity: Math.min(1, k * 2) }, children: next }] });
};
```

### 17. Pixel and mosaic transitions · `pixel-mosaic`

Carries: texture. Starter: pure recipe (`lib/moves.ts` math). See also `effects.md` `pixel-mosaic`.

**What.** Blocks replace the picture: mosaic ladders, stepped stair fronts, slanted cell wipes, 2-frame block glitches.

**Job.** Digital material for AI and developer brands; texture on a cut.

**Numbers.** Mosaic out 7 f60 and in 7 f60; a develop of 40 f60; a stair wipe of 25 f at 25 fps; blocks 22-30 px; a cell wipe
of 71 f60; a glitch of 11 f at 30 fps.

**Presets.**

- _Mosaic ladder._ Out through grids of 9 x 9, 14 x 13, 22 x 19, 34 x 28, 56 x 42, 96 x 60, 160 x 77 cells (wider than
  tall); cut; in through 190 x 83, 96 x 60, 46 x 34, 27 x 23, 18 x 16, 13 x 12, 10 x 10; each cell its true mean colour.
- _Stair front._ A grey stair front from the top-left in 22-24 px blocks, on twos, with a tinted front (yellow, pink,
  violet); coverage 0.003, 0.024 ... accelerating.
- _Cell wipe._ 64 x 36 cells of 30 px in the accent; progress s = column + 0.42 x row; a timing table T(s) accelerating
  over 71 f; jitter -2 to +2 f; 2 % of cells as early islands.
- _Block glitch._ Flat rectangles in three palette colours, 2 f each; the scene is replaced underneath on the middle frame.

**Rich.** A stepped ladder, wider than tall; an anchored grid with true mean colours; a ragged front on twos; a
brand-coloured front.

**Cheap.** A pixelated scaled screenshot with even steps; a uniform diagonal; random noise blocks.

**Sound.** A 2 -> 8 kHz riser with 10-13 kHz clicks per step; 13-14.7 kHz clicks.

```ts
import { hash, table } from "./seamKit";
const T: Record<number, number> = {
    1: 212,
    3: 223,
    5: 231,
    7: 234,
    9: 238,
    11: 240,
    13: 243,
    15: 245,
    17: 247,
    19: 249,
    21: 250,
    23: 252,
    25: 253,
    27: 254,
    29: 255,
    31: 256,
    33: 257,
    35: 258,
    39: 259,
    41: 260,
    45: 261,
    47: 262,
    51: 263,
    55: 264,
    59: 265,
    61: 266,
    67: 267,
    71: 268,
    77: 269,
};
const jitter = (i: number) => {
    // jitter -2..+2 f, mostly 0 or +-1; 2 % islands 4-8 f early
    const u = hash(i, 11);
    if (hash(i, 13) < 0.02)
        return -(4 + Math.floor(hash(i, 17) * 5));
    return u < 0.05 ? -2 : u < 0.25 ? -1 : u < 0.75 ? 0 : u < 0.95 ? 1 : 2;
};
export const CellWipe: (props: {
    offset?: number;
    color?: string;
    cell?: number;
}) => unknown = ({ offset = 0, color = "#79CD05", cell = 30, }) => {
    const f = frame + offset; // offset maps to frames
    const rects: unknown[] = [];
    for (let row = 0; row < 36; row++)
        for (let col = 0; col < 64; col++) {
            const s = col + 0.42 * row;
            const on = table(Math.max(1, s), T) + jitter(row * 64 + col);
            if (f >= on)
                rects.push({
                    kind: "rect",
                    key: row * 64 + col,
                    x: col * cell,
                    y: row * cell,
                    width: cell,
                    height: cell
                });
        }
    return ({
        kind: "vector",
        width: 1920,
        height: 1080,
        style: { position: "absolute" },
        shapeRendering: "crispEdges",
        children: { kind: "g", fill: color, children: rects }
    });
};
// Mosaic of a bitmap: canvas downscale with area averaging, upscale without smoothing; block ladder per frame
export const MosaicImg: (props: {
    src: string;
    block: [
        number,
        number
    ] | null;
}) => unknown = ({ src, block, }) => {
    const ref = { current: document.createElement("canvas") };
    const img = new Image();
    img.src = assetUrl(src);
    img.onload = () => {
        const c = ref.current!;
        const ctx = c.getContext("2d")!;
        if (!block) {
            ctx.drawImage(img, 0, 0, 1920, 1080);
            /* font ready */
            return;
        }
        const [bw, bh] = block, w = Math.ceil(1920 / bw), hh = Math.ceil(1080 / bh);
        const off = document.createElement("canvas");
        off.width = w;
        off.height = hh;
        const o = off.getContext("2d")!;
        o.imageSmoothingQuality = "high";
        o.drawImage(img, 0, 0, w, hh);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, w, hh, 0, 0, w * bw, hh * bh);
    };
    return {
        kind: "canvas",
        ref: ref,
        width: 1920,
        height: 1080,
        style: { position: "absolute", inset: 0 }
    };
};
export const MOSAIC_OUT: [
    number,
    number
][] = [
    [9, 9],
    [14, 13],
    [22, 19],
    [34, 28],
    [56, 42],
    [96, 60],
    [160, 77],
];
export const MOSAIC_IN: [
    number,
    number
][] = [
    [190, 83],
    [96, 60],
    [46, 34],
    [27, 23],
    [18, 16],
    [13, 12],
    [10, 10],
];
```

### 18. Collapse to a point, implode · `collapse`

Carries: a shape. Starter: pure recipe (`lib/moves.ts` math). See also `animations.md` `collapse-to-icon`.

**What.** The frame or the hero contracts into a small shape on a new ground; the next scene starts there, or a hard cut
follows.

**Job.** Contraction: a problem, an ending, a seed.

**Numbers.** A frame collapse of 3-4 f at 30 fps; a square shrinking over 28 f; the content shrinking 0.6-0.75 as fast as the
frame; a final step of -30 %.

**Presets.**

- _Frame to square._ The left and right edges close over 2 f, then top and bottom over 1 f: a square that shrinks,
  decelerating then accelerating into the cut; the text inside scales 0.75, then 0.60.
- _Chip to dot._ A chip becomes a pill, then a dot.
- _Grid to point._ A grid becomes a square, then a point, shrinking 2.4-4.5 % per frame and then one final -30 % step.
- _Implode._ A glass button implodes into the next scene.

**Rich.** An anisotropic collapse; content shrinking less than the frame; a second acceleration into the cut; a whoosh.

**Cheap.** A uniform `scale(0)` to the centre.

**Sound.** A noise sweep 600 Hz -> 6 kHz over 300 ms.

```ts
// FrameCollapse.ts: L/R edges close first, then T/B, to a square that shrinks in-out until the cut
import { interpolate } from "./lib/anim";
import { E, ramp } from "./seamKit";
export const FrameCollapse: (props: {
    start: number;
    cut: number;
    ground?: string;
    children: unknown;
}) => unknown = ({ start, cut, ground = "#3C4BE0", children }) => {
    const f = frame;
    const lr = ramp(f, start, start + 2, E.cubicIn); // 2 f
    const tb = ramp(f, start + 2, start + 3, E.cubicIn); // 1 f
    const sq = ramp(f, start + 3, cut, E.sineInOut); // square keeps shrinking, decel then accel
    const side0 = 620; // square side after the collapse (~ height of the text block area)
    const w = f < start + 3 ? interpolate(lr, [0, 1], [1920, side0]) : side0 * (1 - 0.55 * sq);
    const h = f < start + 2
        ? 1080
        : f < start + 3
            ? interpolate(tb, [0, 1], [1080, side0])
            : side0 * (1 - 0.55 * sq);
    const textS = f < start + 3 ? 1 - 0.25 * lr : 0.75 - 0.15 * sq; // 0.75 after the collapse, 0.60 at the cut
    return ({ kind: "layer", style: { background: ground }, children: { kind: "layer", style: {
                position: "absolute",
                left: 960 - w / 2,
                top: 540 - h / 2,
                width: w,
                height: h,
                background: "#000",
                overflow: "hidden",
            }, children: { kind: "layer", style: {
                    position: "absolute",
                    left: w / 2 - 960,
                    top: h / 2 - 540,
                    width: 1920,
                    height: 1080,
                    transform: `scale(${textS})`,
                }, children: children } } });
};
```

### 19. Ground flip and dip · `ground-flip-dip`

Carries: the ground. Starter: `fx/Grounds`. See also `backgrounds.md`.

**What.** The ground changes on purpose: a designed ramp, a 1-frame grey flash and a fade-up, a heat bleach with the colour
leading, a drain to grey, hard flips with the content held.

**Job.** Mood and section; a dip with a morph says same idea, new world.

**Numbers.** A dip of 13 f at 24 fps (20 f60); a fade-up of 6 f at 30 fps; a bleach of 10 f at 24 fps; a drain of 9-10 f at
30 fps; flips three times, 5 f apart.

**Presets.**

- _Dip to black._ `#F9F9F9`, `#F8F8F8`, `#F4F4F4`, `#F1F1F1`, `#E6E6E6`, `#DADADA`, `#C4C4C4`, `#9A9A9A`, `#525252`,
  `#252525`, `#101010`, `#050505`, `#010101`, `#000000` (slow, then fast, then slow); chips keep acting during it.
- _Dip from the top._ The dark falls from the top: the top corners reach black before the bottom (for example top-left /
  top-centre / bottom `#E8E8E8` / `#EBEBEB` / `#EFEFEF` -> `#000000` / `#010101` / `#565656` over 16 f), black by frame 20.
- _Fade-up._ `#2B2B2B`, `#7B7B7B`, `#A3A3A3`, `#C4C4C4`, `#DFDFDF`, `#E7E7E7`, `#E4E4E4` (a slight settle back).
- _Heat bleach._ Ink black -> dark olive -> gold-tan -> peach -> white; no scale, no blur, no move.
- _Warm pulse._ 15 frames: grey -> yellow -> peach over 7 f, then a bleach to white over 8 f.
- _Mode flip._ A hard cut to the same layout in dark mode in the middle of a collapse.

**Rich.** A non-linear ramp with the content acting during it; the hue leading the luminance in a bleach; flips only at
section changes, with a sub hit.

**Cheap.** A linear fade to black and back up; a flip in the middle of a sentence; a dip that carries nothing.

**Sound.** A 265 ms swell; a 0.5 s reversed swell; a sub hit or sub drop.

```ts
// GroundRamp.ts: a ground colour ramp under content that keeps doing its own thing
import { interpolateColors } from "./lib/anim";
const DIP_TO_BLACK = [
    "#F9F9F9",
    "#F8F8F8",
    "#F4F4F4",
    "#F1F1F1",
    "#E6E6E6",
    "#DADADA",
    "#C4C4C4",
    "#9A9A9A",
    "#525252",
    "#252525",
    "#101010",
    "#050505",
    "#010101",
    "#000000",
];
export const GroundRamp: (props: {
    start: number;
    ramp?: string[];
    children?: unknown;
}) => unknown = ({ start, ramp = DIP_TO_BLACK, children }) => {
    const f = frame - start;
    const bg = interpolateColors(Math.max(0, Math.min(ramp.length - 1, f)), ramp.map((_, i) => i), ramp);
    return { kind: "layer", style: { background: bg }, children: children };
};
// HeatBleach.ts: ink colour leads the fade black -> olive -> gold-tan -> peach -> white, no scale, no blur
export const HeatBleach: (props: {
    start: number;
    frames?: number;
    children: (color: string) => unknown;
}) => unknown = ({ start, frames = 9, children }) => {
    const f = frame - start;
    const t = Math.max(0, Math.min(1, f / frames));
    const c = interpolateColors(t, [0, 0.25, 0.5, 0.75, 1], ["#111111", "#4A4A1E", "#C9A66B", "#F6C9A8", "#FFFFFF"]);
    return [children(c)];
};
```

### 20. Hard cut done right · `hard-cut-right`

Carries: a slot or a rhythm. Starter: pure recipe (`lib/moves.ts` math).

**What.** A plain cut that still carries motion, a slot or a deliberate ground flip; or a montage where the slot holds and
the pictures change on a rhythm.

**Job.** Rhythm and contrast: abundance or reversal.

**Numbers.** Montage pictures 3-20 f each (house 0.4-0.7 s); a luma jump of about 59 on a contrast cut; a
pre-hit gap of 2-5 f.

**Presets.**

- _Contrast cut._ The scale grows +0.4 to +1.8 % per frame into the cut; the incoming shot grows +5.5, +6.2, +3.8 % per
  frame; luma 238 -> 19; the type stays in the same slot.
- _Montage under held words._ Billboards change under held words every 11-20 f; elsewhere 12 cuts in 67 f.
- _Pre-hit gap._ The bed drops to silence and ducks -16 dB for 2-5 f, the cut lands, the accent hits on the first frame
  after.
- _Micro-scenes._ A run of short scenes about 0.5 s each.
- _Re-punch run._ Swaps re-punching on an accelerating rhythm: 7, 10, 7, 6, 7, 12, 8, 4, 4, 9, 8, 4, 4, 4, 3 frames apart.

**Rich.** Motion on both sides; a slot or anchor that holds; cuts accelerating in a run; a gap before the hit.

**Cheap.** Static compositions changing everything at once; even spacing; every cut on the beat by default.

**Sound.** A 2-5 f pre-hit gap; a kick or sub on the first frame after; ticks on montage cuts.

```ts
// MontageSlot.ts: pictures cut on a list of frames under a held word slot; each picture pushes 1.03 while held
export const MontageSlot: (props: {
    cuts: number[];
    pictures: unknown[];
    slot: unknown;
    stepped?: number;
}) => unknown = ({ cuts, pictures, slot, stepped = 1 }) => {
    const raw = frame;
    const f = Math.floor(raw / stepped) * stepped; // Graphics on threes: stepped = 3
    const i = Math.max(0, cuts.filter((c) => f >= c).length - 1);
    const held = f - cuts[i], len = (cuts[i + 1] ?? cuts[i] + 24) - cuts[i];
    const push = 1 + 0.03 * Math.min(1, held / len);
    return ({ kind: "layer", children: [{ kind: "layer", style: { transform: `scale(${push})` }, children: pictures[i] }, slot /* the word + corner markers never move */] });
};
```

### 21. Torn-paper step wipe · `torn-paper`

Carries: texture. Starter: pure recipe (`lib/moves.ts` math).

**What.** A jagged hard edge with a fibre fringe advances in 10-frame steps.

**Job.** Analogue craft, collage.

**Numbers.** 4 steps of 10 f60; a seeded noise amplitude of 40-90 px and wavelengths of 30-120 px; a fringe of 2-6 px white
with a 1-2 px grey shadow.

**Presets.**

- _Four tears._ The edge polyline jumps to a new position every 10 frames (6 per second), each time with a new seeded jagged
  profile; the picture keeps moving under it.

**Rich.** Steps at 6 per second; a fringe and a shadow; the picture moving underneath.

**Cheap.** A smooth jagged wipe.

**Sound.** Stabs or bell notes at 990-1400 Hz on each tear.

```ts
// TornStep.ts: a seeded jagged edge that advances in 10-frame steps; the page keeps everything on one side
import { hash } from "./seamKit";
const tornPath = (pts: [
    number,
    number
][], seed: number) => {
    // densify the polyline and displace it by seeded noise (amp 40-90, wavelength 30-120)
    const out: string[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 40));
        for (let k = 0; k < n; k++) {
            const t = k / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
            const nx = -(y1 - y0), ny = x1 - x0, L = Math.hypot(nx, ny) || 1;
            const a = (hash(i * 100 + k, seed) - 0.5) * 2 * (20 + 25 * hash(k, seed + 1));
            out.push(`${x + (nx / L) * a},${y + (ny / L) * a}`);
        }
    }
    out.push(pts[pts.length - 1].join(","));
    return out;
};
export const TornStep: (props: {
    start: number;
    steps: [
        number,
        number
    ][][];
    page: string;
    under: unknown;
}) => unknown = ({ start, steps, page, under }) => {
    const f = frame - start;
    const i = Math.floor(f / 10); // 10-frame steps (6 fps at 60)
    if (i >= steps.length)
        return { kind: "layer", children: under };
    const edge = tornPath(steps[i], 7 + i); // runs from a point on the top edge to a point on the right edge
    const px = (p: string) => p.replace(",", "px ") + "px";
    // the page keeps everything below/left of the edge (one top-right tear; a second tear adds a second polygon)
    const pagePoly = `polygon(0px 0px, ${edge.map(px).join(", ")}, 1920px 1080px, 0px 1080px)`;
    return ({ kind: "layer", children: [under, { kind: "layer", style: { background: page, aperture: pagePoly } }, {
                kind: "vector",
                width: 1920,
                height: 1080,
                style: { position: "absolute" },
                children: [{
                        kind: "polyline",
                        points: edge.join(" "),
                        fill: "none",
                        stroke: "rgba(0,0,0,.18)",
                        strokeWidth: 6
                    }, {
                        kind: "polyline",
                        points: edge.join(" "),
                        fill: "none",
                        stroke: "#FFFFFF",
                        strokeWidth: 4
                    }]
            }] });
};
```

### 22. Glitch break · `glitch-break`

Carries: a reset. Starter: `fx/CutFx`. Only in a film about signal or reality breaking.

**What.** Designed full-frame states, 2 frames each, hard cuts, with luma alternating.

**Job.** A reboot, a break in reality.

**Numbers.** 2 frames per state; 4 states; 8-11 f in all.

**Presets.**

- _Four states._ A ghost frame (RGB split +/-6 px and a white motion ghost blurred 20 px at 70 %), a blue mosaic duotone in
  six rows, a cyan-green treatment, a white frame: 2 frames each.
- _Scramble break._ A letter scramble, two lavender frames, one black frame.

**Rich.** Each state a complete re-treatment of the frame, exactly 2 f.

**Cheap.** RGB jitter and noise bars for 20 f.

**Sound.** A digital click per state.

```ts
// GlitchBreak.ts: N designed full-frame states, 2 frames each, hard cuts, then a white frame
export const GlitchBreak: (props: {
    start: number;
    states: unknown[];
    hold?: number;
    after: unknown;
}) => unknown = ({ start, states, hold = 2, after }) => {
    const f = frame - start;
    const i = Math.floor(f / hold);
    if (f < 0)
        return null;
    if (i < states.length)
        return { kind: "layer", children: states[i] };
    return { kind: "layer", children: after };
};
```

### 23. Split panels with staggered swaps · `split-panel`

Carries: the anchor panel. Starter: pure recipe (`lib/moves.ts` math).

**What.** Panels cut on independent rhythms; one anchor panel never cuts; sync cuts are rare.

**Job.** Breadth at once.

**Numbers.** One anchor panel; the busiest panel cuts 1-30 f apart.

**Presets.**

- _Quad reels._ Top-right cuts on frames 19, 104, 123; bottom-left on 8, 19, 49, 50, 51, 52, 60, 71, 101, 102, 103, 104,
  112, 123; bottom-right on 104; top-left never (the anchor). Frames 19, 104 and 123 are the rare sync cuts.
- _Four quadrants._ Each quadrant changes on its own frames.

**Rich.** An anchor panel, staggered others, rare sync cuts.

**Cheap.** All panels cutting together.

**Sound.** Ticks on the sync cuts.

```ts
// PanelReel.ts: each panel has its own cut list; panel 0 is the anchor (no cuts)
export const PanelReel: (props: {
    panels: {
        box: [
            number,
            number,
            number,
            number
        ];
        cuts: number[];
        shots: unknown[];
    }[];
}) => unknown = ({ panels }) => {
    const f = frame;
    return ({ kind: "layer", children: panels.map((p, k) => {
            const i = p.cuts.filter((c) => f >= c).length; // shot index = cuts passed
            const [x, y, w, h] = p.box;
            return ({
                kind: "layer",
                key: k,
                style: {
                    position: "absolute",
                    left: x,
                    top: y,
                    width: w,
                    height: h,
                    overflow: "hidden",
                },
                children: p.shots[i % p.shots.length]
            });
        }) });
};
```

### 24. Dissolve · `dissolve`

Carries: the subject. Starter: `fx/Seam` dissolve.

**What.** A very short dissolve, only between versions of the same subject, under a flash or wash, or under a fixed anchor.

**Job.** Continuity of the same subject.

**Numbers.** 2-3 frames.

**Presets.**

- _Blueprint to photo._ Opacity 0.35 -> 1 in two frames.
- _Images under a logo._ Seven images dissolving 3 f each under a fixed logo.
- _Logo to line._ A 2-frame dissolve from the logo to the next line.

**Rich.** 2-3 f, with an anchor above or a wash over it.

**Cheap.** A 15-30 f cross-fade of unrelated scenes.

```ts
// QuickDissolve.ts: 2-3 frame dissolve, optionally under a white wash peak
import { interpolate } from "./lib/anim";
export const QuickDissolve: (props: {
    at: number;
    frames?: number;
    washPeak?: number;
    a: unknown;
    b: unknown;
}) => unknown = ({ at, frames = 3, washPeak = 0, a, b }) => {
    const f = frame;
    const k = interpolate(f, [at, at + frames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    const wash = washPeak * (1 - Math.abs(k - 0.5) * 2);
    return ({ kind: "layer", children: [k < 1 && { kind: "layer", children: a }, k > 0 && { kind: "layer", style: { opacity: k }, children: b }, wash > 0 && { kind: "layer", style: { background: "#FFFFFF", opacity: wash } }] });
};
```

### 25. Callback, replay seam · `callback`

Carries: memory. Starter: `lib/spine.ts`.

**What.** An earlier passage returns (a frame-shifted replay) after the proof section, entered by the house seam.

**Job.** Rhyme and closure.

**Numbers.** A replay of 36-107 f.

**Presets.**

- _Opening replay._ The opening move (36-42 f) replays near the end, offset in time, now carrying the product.
- _Section replay._ A 107 f passage from the first act replays before the end card.
- _Badge callback._ The end-card badge is an earlier shot time-shifted.

**Rich.** Entered by the house seam; the same sound as the first time.

**Cheap.** A copy plus a cross-fade.

```ts
// Callback.ts: replay a scene component at a frame offset
export const Callback: (props: {
    at: number;
    srcFrom: number;
    dur: number;
    Scene: () => unknown;
}) => unknown = ({ at, srcFrom, dur, Scene, }) => (LayerSpan({
    from: at,
    durationInFrames: dur,
    children: LayerSpan({ from: -srcFrom, children: Scene({}) })
}));
```

### 26. The last handover: into the end card and out · `end-handover`

Carries: the brand. Starter: pure recipe (`lib/moves.ts` math), `lib/film.ts`. See also `../devices/logo-and-end-card.md`.

**What.** How a film ends: a hold with a slow creep, a dip, or an end in the middle of a move.

**Job.** The brand rests; the last motion slow and purposeful.

**Numbers.** A hold of 2.1-6.1 s; a creep between 0.93 and 1.054 over the hold; a black tail of 3-24 f.

**Presets.**

- _Spin-in lockup._ The badge spins in from 2.16x and +84 degrees and settles in about 54 f; the wordmark slides 183 px while
  fading 0.22 -> 1; the lockup closes 30 f later and holds.
- _Shrinking lockup._ The lockup shrinks to about 0.93 about the centre over the whole hold.
- _Hold to the end._ The end card holds to the last frame and never fades.
- _Black bookends._ 8 black frames, the end card for about 5 s, 3 black frames.

**Rich.** A slow linear creep; a natural decay of the sound.

**Cheap.** A frozen lockup and a one-second fade to black.

**Sound.** A stab or a tonal resolution; then silence or the natural decay.

```ts
// EndHold.ts: the lockup lands, then a slow linear creep;
// optional black tail or none
import { interpolate } from "./lib/anim";
export const EndHold: (props: {
    land: number;
    end: number;
    to?: number;
    pivot?: [
        number,
        number
    ];
    blackTail?: number;
    children: unknown;
}) => unknown = ({ land, end, to = 1.054, pivot = [960, 540], blackTail = 0, children }) => {
    const f = frame;
    const s = interpolate(f, [land, end - blackTail], [1, to], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    }); // linear on purpose
    const black = blackTail > 0 && f >= end - blackTail;
    return ({ kind: "layer", style: { background: "#000" }, children: !black && ({ kind: "layer", style: { transformOrigin: `${pivot[0]}px ${pivot[1]}px`, transform: `scale(${s})` }, children: children }) });
};
```

---

## Planning a film's seams

1. List the scene changes; mark the two or three section changes (the only places a ground may flip light or dark).
2. Pick the house seam from what the world carries; use it on 30-45 % of the changes.
3. Fill the rest with three or four other kinds, never the same kind twice in a row, and one exit-then-enter, text swap or
   match cut if the film has four lines or more.
4. For every hard cut, name what it carries (motion, slot, anchor, ground flip); a cut that carries nothing becomes a
   `velocity-cut`, a `match-cut` or a `blur-through`.
5. Give every seam its sound from the entry, landing on the cover frame, the fastest frame or one frame after the cut.
