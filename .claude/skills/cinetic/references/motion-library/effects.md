# Effects

Picture effects for launch films: depth of field and blur ladders, motion blur, glow and bloom, light pools, light
sweeps and glints, glass, masks and irises, gradients and gradient maps, flashes and washes, particles, lens
distortion, chromatic aberration, shadows, reflections, grain, vignette and 3D lighting. Each entry gives the job the
effect does, its numbers, named presets, what makes it rich or cheap, the starter primitive it extends, and a
deterministic frame-pure implementation (no WebGL needed, no `Math.random`, no wall clock).

**Units.** px at 1920 x 1080. Frames are 30 fps frames unless a line says otherwise; at another rate multiply frame
counts by `fps / 30` (the code does this with `f30()`). "Blur N px" and "sigma N" mean the CSS `blur()` value, the
Gaussian standard deviation. A film uses three to five effects from this file, never all of them.

**Order.** Entries are ranked by how much they lift a film. The first thirteen (depth, light and material) are where
production value comes from; the finishing layers near the end are mostly absent from a clean digital film.

---

## House rules

1. **Depth is made of blur ladders, not engines.** Put elements on discrete depth slots, and pair every blur step with
   a dim step and a scale step (blur 0 / 2.5 / 3 / 3.5 / 9 px with brightness 100 / 92 / 85 / 78 / 70 % and scale
   1 / 0.943 / 0.894 / 0.849 / 0.807). A blur without dimming reads as a cheap filter.
2. **Defocus is a timing tool.** It ends a beat (an 18 f accelerating ramp to 12 px), hides a cut (6 px out, then
   14-12-10-7-4-0 px in) and introduces a word (14-10-7-4-2-0 px with scale 1.09 -> 1.00). Hold opacity at 1.0 while
   the blur runs; the blur does the work a fade would do.
3. **Motion blur is a policy per film.** Either blur only the fast frames (whips, flights, rising words: a rising word
   smears 6 / 3 / 0 px on its first three frames) or keep the whole film crisp at any speed. Never blur slow moves.
   A film whose camera should read as real blurs; a flat graphic film stays crisp. Choose once (`LOOK.blur`).
4. **Light comes from below and from the object, never from a centred blob.** Anchor floor glows off-frame (an ellipse
   centred at (960, 1250) with radii 1250 x 700, or (960, 1150) with 700 x 450) so only the falloff shows. Emissive
   objects glow in their own colour at radius 20-40 px and 30-45 % strength.
5. **Glass is a dark or translucent body, light only at the rims, and a blurred copy of the world behind.** The frost
   scales with the element (sigma 6 px for a bubble, 12 for a pill, 28 for a large card). Over a flat ground there is
   nothing to frost: use a diagonal sheen instead.
6. **Light sweeps are narrow and clipped.** Bands 120-200 px wide (6-10 % of the frame), slanted about -20 degrees,
   visible only on the object's faces, one pass, 25-70 px per frame.
7. **Irises are fast and decelerate.** 4-14 frames; the radius grows about x1.5 on the first frame and x1.04 by the
   end (diameter shares 0.37, 0.65, 0.79, 0.86, 1.0). The next world is already moving inside, and a 2-4 px light
   rim marks the edge on dark worlds.
8. **Pictures develop.** Bring images in as a tint, duotone or gradient map built from the palette, then resolve them
   to true colour in reading order (blur clears 6-4-2-1-0, then a 3 f colour cross-fade per tile).
9. **A flash is one frame, on a hit, and carries a ghost** of what came before (a grey ghost of the outgoing object at
   10-30 % luma, or light streaks on the next black frame).
10. **The finishing stack is mostly absent.** A clean digital film has no global grain, no lens vignette, no global
    bloom and no chromatic aberration; flat grounds sit within one code value. Grain, vignette and fringes belong to
    footage, "filmed screen" and paper looks only, and grain there is sigma 1.2-3 on 0-255.

## Layer order

Bottom to top. A blur named for a scene applies to the camera group only, unless the whole frame is meant. Glows,
cones and beams add light to what is below them and are never drawn over the near defocused layer or the wordmark. The
lens layer is fixed to the frame and never moves with the camera.

```
stage        flat colour; never pure #000 / #FFF in a dark or light film (#090909, #010101, #010103 / #FDFDFF)
world        mesh gradient, photo plate or far geometry (blurred where far)          mesh-gradient, dof-ladder
light field  floor or under-glow, stage glow (normal alpha or screen)                floor-glow, stage-glow
hero         glass, UI planes, 3D objects with their own rims, sheen and shadows     frosted-glass, glass-solid, shadows, light-rig-3d
add light    cones, beams, halos, specular streaks, comets (screen / lighter)        light-geometry, light-trails, light-sweep
near layer   foreground blurs (additive light is not drawn over it)                  dof-ladder
type         never shadowed; a glow is a blurred copy behind the text                element-glow
overlays     flashes, washes, irises, mosaics (per shot)                              flash-frame, light-flood, iris, pixel-mosaic
lens         DOF bands, motion blur, chromatic aberration, barrel, vignette          motion-blur, chromatic-aberration, lens-distortion, vignette
grade        gradient map or LUT (photo films only), grain, final 0.6 px soften     develop, grain, final-soften
```

## Choosing a set by world

Pick three to five from the row that matches the film's world, and vary the pick from film to film.

| world                           | effects that belong together                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dark stage with glass and light | `glass-solid` + `light-sweep` (or its rim streak) + `floor-glow` + `bloom` in the object's own colour + `motion-blur` on whips + `flash-frame` with a ghost + `particle-field` (placed points)    |
| light UI world (white or pale)  | `dof-ladder` slots + `defocus-exit` / `focus-pull-in` timing + a sky-blue `floor-glow` + `frosted-glass` over a moving plate + `element-glow` click bloom + tinted `shadows` + `light-flood` wash |
| colour-field world              | `mesh-gradient` or silk field + `focus-pull-in` words + `iris` + `pixel-mosaic` + `develop`                                                                                                       |
| photographic or footage         | `develop` (gradient map / LUT) + stylised `chromatic-aberration` + `grain` sigma 3 + lens `vignette` + a 1-2 f `smear-displace` on a cut                                                          |
| editorial or paper              | paper `grain` 2-3 % + a single-word `bloom` + one-frame `flash-frame` + `colour-front-sweep`                                                                                                      |
| 3D object                       | `light-rig-3d` + `glass-solid` + `dof-ladder` at the extremes of a move + accumulated `motion-blur` on fast frames                                                                                |

## Shared code

Every implementation below imports this file. Save it as `fx-shared.ts` beside the components. It is deterministic
(seeded `random()`, no clock) and uses the starter's fixed defocus levels so no blur radius ever animates.

```ts
import { Easing, interpolate, random } from "./lib/anim";
/** Piecewise-linear lookup in a frame table {frame: value}; clamps outside. Optional easing per segment. */
export type Table = Record<number, number>;
export const at = (f: number, t: Table, easing?: (x: number) => number): number => {
    const ks = Object.keys(t)
        .map(Number)
        .sort((a, b) => a - b);
    if (ks.length === 1)
        return t[ks[0]];
    return interpolate(f, ks, ks.map((k) => t[k]), { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
};
/** 30-fps frame of the current frame (the tables in this library are given in 30 fps frames; convert with k = fps/30). */
export const f30 = (frame: number, fps: number) => (frame * 30) / fps;
/** House easing tokens (cubic-bezier control points). */
export const EZ = {
    expoOut: Easing.bezier(0.16, 1, 0.3, 1),
    wordLand: Easing.bezier(0.13, 0.68, 0.15, 0.93), // Word entry (16 f, 0.34 opacity on frame 1)
    recentre: Easing.bezier(0.08, 1.01, 0.22, 0.94), // Append-recentre: 69 % on the first frame
    pop: Easing.bezier(0.2, 0.8, 0.3, 1), // Dot growth, staircase settle
    starGrow: Easing.bezier(0.09, 0.89, 1.0, 0.96), // Star radius
    panIn: Easing.bezier(0.55, 0, 1, 0.45), // Ease-in pan
    quadIn: Easing.in(Easing.quad),
    quintIn: Easing.in(Easing.poly(5)), // Focus pull
    circOut: Easing.out(Easing.circle), // Modal 0.69 -> 1.0
};
/** hex -> rgba() */
export const rgba = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
/** Fixed defocus levels (the starter's lib/defocus.ts): no blur radius ever animates; any sigma = at most two cached copies. */
export const LEVELS = [0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64] as const;
export const levelMix = (s: number): {
    level: number;
    w: number;
}[] => {
    if (s < 0.5)
        return [{ level: 0, w: 1 }];
    const lv = [0, ...LEVELS];
    for (let i = 0; i < lv.length - 1; i++) {
        const a = lv[i], b = lv[i + 1];
        if (s <= b) {
            const w = (s - a) / (b - a);
            return [
                { level: a, w: 1 - w },
                { level: b, w },
            ].filter((c) => c.w > 0.002);
        }
    }
    return [{ level: LEVELS[LEVELS.length - 1], w: 1 }];
};
/** Soft(sigma) : defocus any layer with two fixed-level copies (bottom copy full, top copy at its weight = exact lerp on opaque pixels). */
export const Soft: (props: {
    sigma: number;
    style?: Record<string, string | number | undefined>;
    children: unknown;
}) => unknown = ({ sigma, style, children }) => {
    const mix = levelMix(sigma);
    return ({ kind: "layer", style: { position: "absolute", inset: 0, ...style }, children: mix.map((c, i) => ({
            kind: "layer",
            key: c.level,
            style: {
                position: "absolute",
                inset: 0,
                opacity: i === 0 ? 1 : c.w,
                filter: c.level ? `blur(${c.level}px)` : undefined,
            },
            children: children
        })) });
};
/** Directional (one-axis) blur as a static SVG gaussian; quantise sigma to 0.5 px steps so the filter is reused. */
export const shutterSigma = (pxPerFrame: number, shutterDeg = 180) => (Math.abs(pxPerFrame) * (shutterDeg / 360)) / Math.sqrt(12);
export const DirBlur: (props: {
    id: string;
    sx?: number;
    sy?: number;
    children: unknown;
}) => unknown = ({ id, sx = 0, sy = 0, children }) => {
    const qx = Math.round(sx * 2) / 2, qy = Math.round(sy * 2) / 2;
    const fid = `${id}-${qx}-${qy}`;
    return ([{
            kind: "vector",
            width: 0,
            height: 0,
            style: { position: "absolute" },
            children: {
                kind: "filter",
                id: fid,
                x: "-25%",
                y: "-25%",
                width: "150%",
                height: "150%",
                colorInterpolationFilters: "sRGB",
                children: { kind: "feGaussianBlur", stdDeviation: `${qx} ${qy}` }
            }
        }, { kind: "layer", style: { position: "absolute", inset: 0, filter: qx || qy ? `url(#${fid})` : undefined }, children: children }]);
};
/** Seeded gaussian (Box-Muller on seeded rand). */
export const gauss = (seed: string) => {
    const u = Math.max(1e-6, random(seed + "u")), v = random(seed + "v");
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
/** Glow stack: tight core + wide skirt (the two-radius halo). */
export const glow2 = (hex: string, tight = 10, a1 = 0.55, wide = 28, a2 = 0.25) => `drop-shadow(0 0 ${tight}px ${rgba(hex, a1)}) drop-shadow(0 0 ${wide}px ${rgba(hex, a2)})`;
```

Starter rules that apply to every entry: never animate `filter: blur()` on a large layer (use `Soft`, which mixes two
cached levels); bake low-span gradients with `scripts/dither-gradient.py` (a CSS ramp across fewer than about 30 code
values bands); real motion blur is the `scripts/probe.py --blur` pass driven by `LOOK.blur` / `CAMERA_BLUR`, and `DirBlur` is
the in-browser stand-in.

## Index

| #   | slug                   | effect                                          | family             |
| --- | ---------------------- | ----------------------------------------------- | ------------------ |
| 1   | `dof-ladder`           | depth-of-field ladder on planes                 | depth              |
| 2   | `defocus-exit`         | defocus exit and the defocus cut                | depth, transition  |
| 3   | `focus-pull-in`        | focus-pull entrance, blur-resolve words         | depth, type        |
| 4   | `motion-blur`          | motion blur on fast moves                       | motion, lens       |
| 5   | `floor-glow`           | floor and under-glow anchored off-frame         | light              |
| 6   | `frosted-glass`        | frosted glass panel                             | material           |
| 7   | `glass-solid`          | glass solid with rim light                      | material, light    |
| 8   | `light-sweep`          | light sweep, sheen and specular streak          | light, material    |
| 9   | `element-glow`         | element glow, halo, click bloom, selection ring | light              |
| 10  | `bloom`                | bloom on emissive highlights                    | light, grade       |
| 11  | `iris`                 | iris into the next world                        | mask, transition   |
| 12  | `mesh-gradient`        | mesh gradient and liquid colour field           | gradient, world    |
| 13  | `develop`              | tint, duotone or gradient map to true colour    | colour             |
| 14  | `zoom-blur`            | radial zoom blur on a push                      | motion, transition |
| 15  | `flash-frame`          | colour flash frame on a hit                     | colour, transition |
| 16  | `light-flood`          | light flood, white wash, white-out              | light, transition  |
| 17  | `soft-mask-reveal`     | soft-edge linear mask reveal                    | mask               |
| 18  | `particle-field`       | placed, glowing point fields                    | particles          |
| 19  | `light-geometry`       | light cones, pillars, beams, neon               | light              |
| 20  | `light-trails`         | light trails, comets, chromatic light lines     | light              |
| 21  | `stage-glow`           | stage glow behind the hero                      | light              |
| 22  | `light-rig-3d`         | 3D lighting rig                                 | 3D                 |
| 23  | `shadows`              | hover height, contact and tinted shadows        | depth              |
| 24  | `colour-front-sweep`   | colour front sweeping through type              | type, gradient     |
| 26  | `pixel-mosaic`         | pixel mosaic and blocky reveals                 | mask, texture      |
| 27  | `lens-distortion`      | barrel bulge and fisheye                        | lens               |
| 28  | `echo-copies`          | echo and ghost copies                           | motion             |
| 29  | `chromatic-aberration` | chromatic aberration and RGB split              | lens               |
| 30  | `grain`                | grain (off by default)                          | finish             |
| 31  | `halftone-screens`     | halftone, dot screens, screen grids             | texture            |
| 32  | `knockout-clip`        | knockout and type as a window                   | mask, blend        |
| 33  | `final-soften`         | final 0.6 px soften                             | finish             |
| 34  | `vignette`             | vignette as a lens or a content shape           | finish             |
| 35  | `reflections`          | floor and rim reflections                       | material           |
| 36  | `smear-displace`       | scan-line smear, row smear, displaced edges     | distortion         |

---

## Entries

### 1. Depth-of-field ladder on planes · `dof-ladder`

Family: depth. Starter: pure recipe (`lib/moves.ts` math), `lib/defocus.ts`
(`DOF`, `dofSigma`, `defocusMix`), `fx/Defocus`. The code adds the slot ladder, static plane classes and a focus band.

**Job.** It ranks information without making text smaller or greyer: the newest, selected or speaking item is the
sharp one. It turns a flat UI into a space the camera moves through, and tells the eye where to look while many things
are on screen.

**Numbers.**

- In-focus plane 0-1.5 px. First step back 1-3 px. Mid 2.5-4 px. Far 4-10 px. Nearest to the lens 8-25 px. Soft
  colour masses 40-60 px.
- Dimming paired with the blur: brightness 92 -> 70 % over four slots, or far opacity 0.6-0.7. Scale per slot -5 to
  -6 % (0.943^n).
- Arrival into the front slot: 6 px -> 0 in 6 f on an expo-out. Retreat: 0 -> 3-6 px over 16-17 f with a fade to
  0.38 or 0.

**Presets.**

- _Stack ladder_ (placards, messages, results). Slots 0-4: blur 0 / 2.5 / 3.0 / 3.5 / 9.0 px, brightness 100 / 92 / 85
  / 78 / 70 %, scale 1.000 / 0.943 / 0.894 / 0.849 / 0.807, visible strips 195 / 170 / 145 / 120 px. A new item
  arrives from 120 px low at scale 0.95, opacity 0.6 and blur 6 px, reaching the slot in 6 f (progress per frame 0.59,
  0.76, 0.87, 0.93, 0.96, 0.98, 1.0); one new item every 4 f. The same ladder works on a black stage.
- _Orbit by depth_ (glass tiles around a 3D object). Focus subject 1.0-1.5 px; tiles in front near the centre 1-3 px;
  side and back tiles 4-8 px; the tiles nearest the lens (over 120 px wide) 8-12 px; the far cloud plate 3-4 px.
- _Retreating stack._ Older items ride up while they blur and fade: the oldest 0 -> 6 px and 1 -> 0 over 15-17 f, the
  next 0 -> 3 px and 1 -> 0.38; avatars and labels stay sharp.
- _Static planes_ (a cloud of bubbles or tiles). Far elements 6-10 px at 0.6-0.7 opacity, the mid layer sharp, near
  tiles 4-8 px. Fixed per element; the camera lands on each cluster in turn.
- _Focus band_ (a tray or desk seen from above). Sharp in the band from 26 % to 79 % of the height, about 5 px at 12 %
  and 90 %, 8 px at the frame edges; anything nearer than the band also gets 12-20 px and motion blur. Two copies
  only: a sharp one masked to the band and a blurred one masked outside it.
- _Orbit ring._ Elements near the top and bottom of a rotating ring defocus up to 4 px; in three racing bands the
  outer bands sit at 4 px and the middle band is sharp.
- _Phone face._ Header sharp, a ramp from 0 at the tab row to about 3 px at the bottom, text fading toward a grey.
- _Selection._ The chosen card gets a focus ring while the other rows blur and dim away and the camera pushes x1.46.
- _Defocused ground._ A field blurred past 60 px reads as colour, not as a picture.

**Rich.** Discrete slots that each pair blur with dimming and scale; the focus plane on the one readable thing; blur
fixed per element and cached; the near-lens element blurred the most (8-25 px) so the frame has a foreground; the blur
retreats on the same curve as the motion.

**Cheap.** One uniform blur on everything but the hero; an animated blur radius; blur without a scale or brightness
step; blurring a line the viewer must read; depth of field on a single flat plane with nothing in front of it.

```ts
import { interpolate } from "./lib/anim";
import { EZ, f30, Soft } from "./fx-shared";
const SLOTS = {
    blur: [0, 2.5, 3.0, 3.5, 9.0],
    bright: [1, 0.92, 0.85, 0.78, 0.7],
    scale: [1, 0.943, 0.894, 0.849, 0.807],
    top: [120, 340, 530, 700, 845],
};
const ARRIVE = [0, 0.59, 0.76, 0.87, 0.93, 0.96, 0.98, 1.0]; // per frame after entry
/** A depth stack: items[i].at = the 30-fps frame it enters the front slot. Older items step back on the same curve. */
export const DepthLadder: (props: {
    items: {
        at: number;
        node: unknown;
    }[];
    cx?: number;
}) => unknown = ({ items, cx = 960 }) => {
    const { fps } = filmDefaults();
    const f = f30(frame, fps);
    const arrived = items.filter((it) => f >= it.at);
    return ({ kind: "layer", children: arrived.map((it, idx) => {
            const later = arrived.slice(idx + 1); // items that entered after this one
            const slotF = later.reduce((s, l) => s + stepProgress(f - l.at), 0); // fractional slot index
            const own = stepProgress(f - it.at); // own arrival 0..1
            const s = Math.min(slotF, 4.999);
            const i0 = Math.floor(s), u = s - i0, i1 = Math.min(4, i0 + 1);
            const lerp = (a: number[]) => a[i0] + (a[i1] - a[i0]) * u;
            const blur = lerp(SLOTS.blur) + (1 - own) * 6; // enters at 6 px
            const scale = lerp(SLOTS.scale) * (0.95 + 0.05 * own);
            const top = lerp(SLOTS.top) + (1 - own) * 120; // enters 120 px low
            const opacity = (0.6 + 0.4 * own) * (slotF > 4.5 ? interpolate(slotF, [4.5, 5], [1, 0]) : 1);
            return ({
                kind: "layer",
                key: idx,
                style: {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: 1920,
                    height: 1080,
                    zIndex: 100 - Math.round(s * 10),
                    opacity,
                },
                children: Soft({
                    sigma: blur,
                    style: {
                        transform: `translate(0px, ${top - 120}px) scale(${scale})`,
                        transformOrigin: `${cx}px 120px`,
                        filter: `brightness(${lerp(SLOTS.bright)})`,
                    },
                    children: it.node
                })
            });
        }) });
};
const stepProgress = (df: number) => df <= 0
    ? 0
    : df >= 7
        ? 1
        : ARRIVE[Math.floor(df)] +
            (ARRIVE[Math.min(7, Math.floor(df) + 1)] - ARRIVE[Math.floor(df)]) * (df % 1);
/** Static plane DOF: blur and dim by depth class; compute once per element. */
export const DOF_CLASS = {
    focus: { blur: 1.0, op: 1 },
    step: { blur: 2, op: 0.95 },
    mid: { blur: 3.5, op: 0.85 },
    far: { blur: 8, op: 0.65 },
    lens: { blur: 12, op: 1 },
} as const;
export const DepthPlane: (props: {
    depth: keyof typeof DOF_CLASS;
    children: unknown;
}) => unknown = ({ depth, children, }) => (Soft({
    sigma: DOF_CLASS[depth].blur,
    style: { opacity: DOF_CLASS[depth].op },
    children: children
}));
/** Focus band: sharp copy masked to the band, a blurred copy masked outside it (two copies only). */
export const FocusBand: (props: {
    children: unknown;
    y0?: number;
    y1?: number;
    edge?: number;
    sigma?: number;
}) => unknown = ({ children, y0 = 250, y1 = 760, edge = 130, sigma = 6 }) => {
    const m = `linear-gradient(to bottom, transparent 0, transparent ${y0 - edge}px, #000 ${y0}px, #000 ${y1}px, transparent ${y1 + edge}px)`;
    return ({ kind: "layer", children: [{ kind: "layer", style: { filter: `blur(${sigma}px)` }, children: children }, { kind: "layer", style: { WebkitMaskImage: m, maskImage: m }, children: children }] });
};
```

### 2. Defocus exit and the defocus cut · `defocus-exit`

Family: depth, transition. Starter: `fx/RackFocus` (`defocusPulse`) and the defocus seam in `fx/Seam` (9 f out, one
empty frame, 9 f in). The code adds the accelerating exit table, the velocity cut and the card flood.

**Job.** It ends a thought by taking attention away instead of deleting the thing; the old idea is still there, out of
focus. Across a cut it hides the seam and feels like the camera moving into the next place.

**Numbers.**

- Peak 4.5-40 px (words 8-12 px, a whole world 28-40 px). Ramp 3-18 frames. The curve accelerates: under 1 px for the
  first 30 % of the ramp, then fast, peaking on the cut or on the frame the next element covers it.
- After a velocity cut: 14 -> 0 px over 5-6 f (14, 12, 10, 7, 4, 0) with a +12 luma haze on the first 3 f.
- Opacity stays at 1.0 during the defocus. Pair it with a fade (to 0 or 0.38) only for UI items that leave.

**Presets.**

- _Title exit_ (at 24 fps, 18 f): sigma per frame 0.0, 0.3, 0.4, 0.8, 1.0, 1.2, 1.7, 2.2, 2.9, 3.6, 4.1, 4.8, 5.6,
  6.4, 7.2, 9.7, 12.0, 12.0, then the cut. Tie it to a camera crane or push. The code resamples it to 30 fps.
- _Velocity cut._ The outgoing scene is pushed to x1.23 and blurred about 6 px on its last frame; the next scene starts
  defocused 14, 12, 10, 7, 4 px and is sharp on the sixth frame, the move continuing through the cut.
- _Short end defocus._ 0.5 px for four frames, then 1.5, 3, 4.5 px held: a four-frame accent on the last beat.
- _Card flood._ One card at a time, the face floods with the brand colour and the card defocuses 0 -> 28 px in 3
  frames while keeping its silhouette and tilt; the next card starts 2-3 f later.
- _World defocus._ A coloured shape rises from a corner while the whole picture defocuses 0 -> 40 px over 16 f; the
  shape becomes the next ground.
- _Pull-out exit._ The camera pulls out fast while the type flies off (top line up and larger, bottom line down and
  larger) with blur 2 -> 8 px; gone in 6 f.
- _Porthole._ A 5-frame defocus 1.35, 2.0, 3.9, 5.3, 6.4 px as the camera passes through an opening.

**Rich.** An accelerating ramp tied to a camera move, peaking exactly on the cut or the cover; opacity held; a
separate defocus-in after the cut; short (18 f or less).

**Cheap.** A linear blur plus a fade on a static camera; blur that starts after the move has stopped; a long defocus
(over 20 f) with nothing happening; animating `filter: blur()` on the full frame.

```ts
import { at, f30, Soft } from "./fx-shared";
// Exit table resampled to 30 fps (x1.25): 23 frames from the start of the exit.
const EXIT: Record<number, number> = {
    0: 0,
    1.25: 0.3,
    2.5: 0.4,
    3.75: 0.8,
    5: 1.0,
    6.25: 1.2,
    7.5: 1.7,
    8.75: 2.2,
    10: 2.9,
    11.25: 3.6,
    12.5: 4.1,
    13.75: 4.8,
    15: 5.6,
    16.25: 6.4,
    17.5: 7.2,
    18.75: 9.7,
    20: 12,
    21.25: 12,
};
/** Defocus exit: opacity held, accelerating blur peaking on the cut. `peak` rescales the table (the table peaks at 12 px). */
export const DefocusExit: (props: {
    start: number;
    peak?: number;
    children: unknown;
}) => unknown = ({ start, peak = 12, children, }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    const sigma = t < 0 ? 0 : (at(t, EXIT) * peak) / 12;
    return Soft({ sigma: sigma, children: children });
};
/** Velocity cut, incoming side: 14-12-10-7-4-0 px plus a 12-luma haze on the first 3 frames. */
export const VelocityCutIn: (props: {
    cut: number;
    children: unknown;
}) => unknown = ({ cut, children, }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - cut;
    const sigma = t < 0 ? 0 : at(t, { 0: 14, 1: 12, 2: 10, 3: 7, 4: 4, 5: 0 });
    const haze = t < 0 ? 0 : at(t, { 0: 12 / 255, 2: 12 / 255, 3: 0 });
    return ({ kind: "layer", children: [Soft({ sigma: sigma, children: children }), { kind: "layer", style: { background: "#FFFFFF", opacity: haze * 2.2, mixBlendMode: "screen" } }] });
};
/** Card flood: face goes brand colour and blurs 0 -> 28 in 3 f, silhouette kept. */
export const FloodBlur: (props: {
    start: number;
    color?: string;
    children: unknown;
}) => unknown = ({ start, color = "#2D3AA0", children, }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    const p = Math.max(0, Math.min(1, t / 3));
    return (Soft({ sigma: 28 * p, children: [{ kind: "layer", style: { position: "absolute", inset: 0 }, children: children }, { kind: "layer", style: {
                    position: "absolute",
                    inset: 0,
                    background: `radial-gradient(closest-side, #27328E, ${color} 70%, #6E78D8)`,
                    opacity: p,
                    mixBlendMode: "normal",
                } }] }));
};
```

### 3. Focus-pull entrance and blur-resolve words · `focus-pull-in`

Family: depth, type. Starter: pure recipe (`lib/moves.ts` math). The code adds the halving ladder with a lagging oversize, the accent that
cools after focus, and the low translucent word build.

**Job.** The lens finds the word: attention arrives instead of text appearing. It makes a headline feel photographed
and softens the start of a long typed line.

**Numbers.**

- Start sigma: 2.5-3.5 px for a panel snap, 6-8 px for words, 10-14 px for a hero word or button.
- Duration: 3-6 f for words, 5-9 f for a hero, 20 f (at 24 fps) for a 3D fly-in.
- Curve: decelerating, roughly halving each frame (14, 10, 7, 4, 2, 0). A peak may hold 2 f, then fall on a quint-in.
- Pairing: an oversize of 1.06-1.25 that settles to 1.0 after the blur has cleared, or a rise of 20-30 px. Start
  opacity 0.3-0.4, never 0.
- Colour: the accent while blurred, the base colour 0-9 f after it is sharp.

**Presets.**

- _Hero word._ Blur 14, 10, 7, 4, 2, 0 px; scale 1.09 for five frames, then 1.06, 1.035, 1.015, 1.00 (the scale lags
  the blur by three frames). Anchor on the line's left baseline.
- _Panel snap._ 2.5, 3.5, 3, 3, 2.5, 0 px: it opens soft and snaps into focus on the sixth frame. A snap, not a ramp.
- _Pill pop._ 8, 8, 7, 5, 2, 0 px (quint-in), then hold.
- _Macro to rest._ Start close and tilted on a button at scale 1.25 and blur 8; focus and scale settle together over
  8 f, a cool light sweep crossing during the pull.
- _Accent word._ The new word enters at sigma 6-7 in the accent colour, sharpens over 4-6 f, holds the colour, then
  turns to the base colour.
- _Word build._ Each word enters 30 px low at opacity 0.4 and 2-3 px blur, settles in 3-5 f on an expo-out, 2 f
  apart; a faint vertical echo may double it on the first frames. A lighter variant: blur 8 px, opacity 0.35, 20 px
  slide, 3-5 f.
- _Row cascade._ Each row rises 24 px while blur 6 -> 0 and opacity 0 -> 1 over 5 f; rows 8 f apart.
- _3D fly-in_ (24 fps). The line flies back from the lens on a yawed plane, blur 12 -> 0 in 20 f, then shrinks x0.67
  over 24 f while its colour sweeps from the accent to ink.
- _Stepped entry._ Opacity / blur per frame 0.30 / 8, 0.50 / 6, 0.70 / 5, 0.85 / 3, 1 / 0, with a 10 px vertical smear
  on frames two and three.

**Rich.** The blur halves per frame and lands before the scale settles; a small oversize; the word partly visible
(0.3-0.4) from its first frame; the accent that cools after focus.

**Cheap.** A linear blur and an opacity ramp from 0; blur-in on paragraphs; more than 10 f for one word; every word of
a film entering the same way.

```ts
import { at, EZ, f30, Soft } from "./fx-shared";
/** Focus pull: blur halves per frame, the oversize lags the blur by 3-4 frames. Anchor = the line's left baseline. */
export const FocusPullWord: (props: {
    start: number;
    anchor?: [
        number,
        number
    ];
    accent?: string;
    base?: string;
    children: unknown;
}) => unknown = ({ start, anchor = [0, 0], accent, base, children }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    if (t < 0)
        return null;
    const blur = at(t, { 0: 14, 1: 10, 2: 7, 3: 4, 4: 2, 5: 0 });
    const scale = at(t, { 0: 1.09, 4: 1.09, 5: 1.06, 6: 1.035, 7: 1.015, 8: 1.0 });
    const color = accent && base ? (t < 8 ? accent : base) : undefined; // Accent while soft, base after
    return (Soft({
        sigma: blur,
        style: {
            transform: `scale(${scale})`,
            transformOrigin: `${anchor[0]}px ${anchor[1]}px`,
            color,
        },
        children: children
    }));
};
/** Word build: enters 30 px low at 0.4 opacity and 2.5 px blur, settles in 4 f expo-out; stagger 2 f per word. */
export const ResolveWord: (props: {
    start: number;
    children: unknown;
}) => unknown = ({ start, children, }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    if (t < 0)
        return null;
    const p = EZ.expoOut(Math.min(1, t / 4));
    return ({ kind: "layer", style: {
            display: "inline-block",
            transform: `translateY(${30 * (1 - p)}px)`,
            opacity: 0.4 + 0.6 * p,
            filter: p < 1 ? `blur(${(2.5 * (1 - p)).toFixed(2)}px)` : undefined,
        }, children: children });
};
```

### 4. Motion blur on fast moves (shutter smear) · `motion-blur`

Family: motion, lens. Starter: the `scripts/probe.py --blur` pass (`LOOK.blur`, `CAMERA_BLUR`) and `DirBlur`. The code adds
a short-shutter option and the rising-word smear.

**Job.** Weight and speed: a whip reads as a camera move, an arrival as a thrown object. It also hides whip cuts,
because the streak carries the eye across the seam.

**Numbers.**

- Shutter 90-180 degrees (the smear is 7-50 % of the per-frame displacement). 180 degrees on whips and UI flights in a
  camera-blur film; 45-90 degrees on 3D camera cranes and on type.
- Smear lengths: UI flights 20-120 px, whips 60-120 px, long streaks up to 400 px, rising words 6 / 3 / 0 px.
- Windows: 2-10 frames each, only on the listed fast frames; 4-12 samples.
- Ceiling: above 60-80 px per frame a 180-degree shutter shows stepped copies; frame-filling edges may run 150-300 px
  per frame for a few frames only.
- A Gaussian stand-in for a box smear of length L has sigma = L / sqrt(12).

**Presets.**

- _Whole-film 180._ Every moving thing smears 0.5 x its per-frame displacement along its travel; a vertical exit at 106
  px/f gives a 53 px streak, then 27, 13 as it slows.
- _Short shutter_ for cranes: smear 7-25 % of the travel (13-21 px on a fast vertical crane), so type goes soft rather
  than streaked.
- _Rising word._ 6 / 3 / 0 px vertical smear on the word's first three frames for a 40-60 px rise.
- _Rows rise blurred._ 30 px, 12 px, 0 by the sixth frame.
- _Smear slide-in._ Expo-out arrival, smear = 0.5 x displacement: a tile's first frame can be a 280 px streak, the next
  120 px.
- _Whip to dark._ 60-120 px blur into an empty dark frame, then the next shot.
- _Rotary smear._ About 90 degrees per frame with an arc-shaped smear (the shutter follows the rotation).
- _Accumulated copies._ 4-6 discrete samples per frame, visible as stacked ghost copies on the fastest frames; 12-16
  copies on a falling object with 12 samples. A deliberate look, not a smooth streak.
- _Crisp film._ No shutter blur anywhere, even at 120-176 px/f. Right for flat graphic films.

**Rich.** Only the fast frames carry blur; the shutter is centred on the frame; the smear follows the path (arcs for
rotations, radial for pushes); the blur ends exactly when the move settles; a crisp film stays crisp.

**Cheap.** Blur on slow moves; a uniform Gaussian instead of a directional one; browser-side multi-sample stacking
(8-bit plus-lighter accumulation posterises gradients and tints greys); stepped copies above 80 px/f; ghosts carried
from the previous shot across a cut.

```ts
import { DirBlur, f30, shutterSigma } from "./fx-shared";
/**
 * In-browser shutter smear for a layer whose position is a pure function pos(f30) -> [x, y].
 * Velocity is taken over ±0.5 f, so the smear is centred on the frame like a real shutter.
 * Below 2 px/f nothing is blurred (slow moves are never blurred). Above 80 px/f, prefer a cut or a mask.
 */
export const Smear: (props: {
    id: string;
    pos: (f: number) => [
        number,
        number
    ];
    shutter?: number;
    children: unknown;
}) => unknown = ({ id, pos, shutter = 180, children }) => {
    const { fps } = filmDefaults();
    const f = f30(frame, fps);
    const [x0, y0] = pos(f - 0.5), [x1, y1] = pos(f + 0.5);
    const [x, y] = pos(f);
    const vx = x1 - x0, vy = y1 - y0;
    const sx = Math.abs(vx) < 2 ? 0 : shutterSigma(vx, shutter);
    const sy = Math.abs(vy) < 2 ? 0 : shutterSigma(vy, shutter);
    return ({ kind: "layer", style: { position: "absolute", left: 0, top: 0, transform: `translate(${x}px, ${y}px)` }, children: DirBlur({
            id: id,
            sx: sx,
            sy: sy,
            children: children
        }) });
};
/** Rising word: vertical smear 6 / 3 / 0 px on the word's first three frames (40-60 px rise). */
export const riseSmear = (framesSinceStart: number) => framesSinceStart < 0 ? 0 : [6, 3, 0][Math.min(2, Math.floor(framesSinceStart))];
```

### 5. Floor and under-glow (a light pool anchored off-frame) · `floor-glow`

Family: light. Starter: pure recipe (`lib/moves.ts` math). The code adds the breathing table, plate stops and the
rim pick-up.

**Job.** It gives a flat UI or a line of type a stage and a horizon, so the object stands somewhere. It sets the time of
day and the mood without imagery: day white with sky light, night navy with brand light.

**Numbers.**

- Anchor 100-300 px below the bottom edge (y 1150-1250) or in a corner; radii 700-1250 px across, 450-700 px tall.
- It covers the lower 30-45 % of the frame; the top 45-55 % stays pure ground.
- Strength breathes +/-10-25 % over 6-15 f, or rises with the scene (black -> peak in 38 f -> black in 10 f).
- One hue from the palette: sky blue on white, warm amber on black, brand blue at night, lavender on violet.
- Objects standing in it pick it up on their lower rim.

**Presets.**

- _Sky light on white._ Ellipse centred (960, 1250), radii 1250 x 700, pure white above y 600. Colour samples at
  y 1075 / 900 / 780 / 660 move between a low state `#BADFFA` `#DBEEFD` `#EEF7FE` `#F7FBFE` and a high state `#7FABF6`
  `#A6C5F8` `#C7DBFC` `#E2EEFD`. Breathing: 0 -> 0.85 in 6 f, 0.6 by 12 f, 1.0 at 15 f (grow 3 f more before a whip).
- _Warm pool on black._ Centre (960, 1150), radii 700 x 450, core `#7A2E0A` fading to black; it rises over 38 f and is
  gone 10 f later. Objects in it take a hot lower rim `#F0B292` with a 6-10 px rim bloom `#D04C22`.
- _Linear floor_ for card and UI shots: `linear-gradient(to bottom, #FDFDFF 0 50%, #FCFBFF 55%, #F2F5FE 75%, #E4E9FD
88%, #D8DEFC 100%)`; it swells over 17 f on the end card and eases back.
- _Thin floor line._ A horizontal lavender glow filling the bottom 30 px; glass letters stand on it.
- _Night floor._ `#172480` centred at (960, 1000): a broad soft band over the lower 40 % whose upper edge undulates
  slowly; keys in the lower third pick up `#0B1240`.
- _Bloom at centre_ (for an end card only): a soft radial green-white glow about 700 px across.

**Rich.** The centre is off-frame, so only the falloff shows; it is baked with dither (no contour rings); its strength
moves with events; objects pick the light up on their lower edges.

**Cheap.** A centred blob behind the headline; an 8-bit CSS gradient that bands; a multi-hue glow; one static glow for
a whole film.

```ts
import { at, f30 } from "./fx-shared";
/**
 * Off-frame under-glow. Two baked, dithered plates (scripts/dither-gradient.py) cross-faded at full strength,
 * because a dithered plate at opacity < 1 bands again (starter finishing.md §3).
 * backdrops.json:
 *   {"name":"under-lo","type":"radial","at":[0.5,1.157],"radius":[0.651,0.648],"stops":[["#BADFFA",0],["#DBEEFD",0.45],["#FFFFFF00",1]]}
 *   {"name":"under-hi","type":"radial","at":[0.5,1.157],"radius":[0.651,0.648],"stops":[["#7FABF6",0],["#A6C5F8",0.45],["#FFFFFF00",1]]}
 */
export const UnderGlow: (props: {
    strength: (f: number) => number;
    lo?: string;
    hi?: string;
    ground?: string;
}) => unknown = ({ strength, lo = "fx/under-lo.png", hi = "fx/under-hi.png", ground = "#FFFFFF" }) => {
    const { fps } = filmDefaults();
    const s = Math.max(0, Math.min(1, strength(f30(frame, fps))));
    return ({ kind: "layer", style: { background: ground }, children: [{ kind: "plate", src: assetUrl(lo), style: { position: "absolute", inset: 0, width: 1920, height: 1080 } }, { kind: "plate", src: assetUrl(hi), style: { position: "absolute", inset: 0, width: 1920, height: 1080, opacity: s } }] });
};
// Breathing: strength = (f) => at(f, {0: 0, 6: 0.85, 12: 0.6, 15: 1});
/** Quick CSS version for previews (bands on low-span ramps; bake it for the deliverable). */
export const UnderGlowCSS: (props: {
    c0: string;
    c1: string;
    cx?: number;
    cy?: number;
    rx?: number;
    ry?: number;
}) => unknown = ({ c0, c1, cx = 960, cy = 1250, rx = 1250, ry = 700 }) => ({ kind: "layer", style: {
        background: `radial-gradient(${rx}px ${ry}px at ${cx}px ${cy}px, ${c0} 0%, ${c1} 45%, rgba(255,255,255,0) 100%)`,
    } });
/** Rim pick-up: the object's lower edge takes the glow colour. */
export const rimPickup = (glow: string, side = "#2A2A2A") => `linear-gradient(to bottom, ${side} 55%, ${glow} 100%)`;
```

### 6. Frosted glass panel (a blurred copy of the world + a bright rim) · `frosted-glass`

Family: material. Starter: pure recipe (`lib/moves.ts` math). The code makes the frost size-relative and
adds the bright-top rim, the iridescent inner edge and the flat-ground sheen.

**Job.** It makes the UI a physical object in a world: the product floats over everyday life (clouds, a beach, a café),
and the blurred world reads through it, so depth and context arrive together.

**Numbers.**

- Backdrop blur scales with the element, about 4-8 % of its short side: 6 px for a 150 px bubble, 12 px for a 170 px
  pill, 18-22 px for cards, 28 px for a large card.
- Body fill: white at 0.18-0.72 on light worlds; dark at 0.88 on dark worlds; an opaque gradient when the ground is
  flat.
- Rim: 1-2 px, white at 0.10-0.60, brighter at the top (a gradient). A bezel of 7-18 px when the glass frames an opaque
  field.
- Extras: an iridescent inner edge glow of 6 px; an outer glow of 14 px at 0.55; a soft shadow only on light worlds.

**Presets.**

- _Glass over a plate._ Every glass element shows a blurred copy of the plate behind it, clipped to its shape, sigma by
  size (6 / 12 / 28 px).
- _Logo tile._ Rounded square, corner radius 26 % of the side, side = 1.35 x the logo's coloured width (the logo fills
  70 %), body `rgba(255,255,255,.55)`, 1 px white rim, a 6 px pink / cyan iridescent inner edge.
- _Prompt pill, light._ `rgba(255,255,255,0.72)` over an 18 px backdrop blur, 1 px white border at 60 %, shadow `0 8px
30px rgba(20,40,60,0.12)`. Dark variant: `#0E1218` at 88 % over a 20 px blur.
- _Flat-ground glass._ No blur at all: a diagonal sheen, darker toward two opposite corners (`#2250B0`, `#204CA4`) and
  lighter along the other diagonal, 1 px rim `rgba(255,255,255,0.16)`, radius 56.
- _Bezel frame._ A white field (radius 3) inside a translucent bezel 16-18 px wide (white about 35 % over the ground),
  bezel radius 12, outer white glow 14 px at 0.55.
- _Dark glass slab._ Pill-rect 975 x 182, radius 42, fill `#242424` with the top 40 px at `#2A2A2A`, a 1.5 px border
  `rgba(255,255,255,0.10)`, a soft outer glow (sigma 60 px, 6 %). Pairs with the rim streak in `light-sweep`.
- _Glass grid over photos._ Thin white grid lines with small four-point highlights at the crossings; selected cells fill
  with tinted glass panels.
- _Soft relief button._ Fill `#F1F1F1`, shadow `0 6px 18px rgba(0,0,0,0.07)`, a white top-left highlight `-2px -2px
6px rgba(255,255,255,0.9)`.

**Rich.** A real, moving picture behind the glass to blur; the blur scaled to the element; the rim a gradient, bright
on top; the inner edge tinted or iridescent; the light direction matching the scene.

**Cheap.** A white 50 % rectangle over a flat colour; a uniform 1 px grey border; glass plus a heavy drop shadow plus a
bevel; a live full-frame `plate refraction` (slow, and unstable from frame to frame on the CPU).

```ts
/**
 * Frosted glass over a moving world. `world` is the SAME element as the background (same transform),
 * rendered again inside the clip with a fixed blur. The blur radius never animates.
 */
export const FrostedPanel: (props: {
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
    world: unknown; // the plate, positioned in frame coordinates
    sigma?: number; // default: size-relative, 6 % of the short side
    tint?: string; // body fill over the blur
    rimTop?: string;
    rimBottom?: string; // rim gradient
    iridescent?: boolean; // Inner edge
    children?: unknown;
}) => unknown = ({ x, y, w, h, r, world, sigma, tint = "rgba(255,255,255,0.55)", rimTop = "rgba(255,255,255,0.75)", rimBottom = "rgba(255,255,255,0.12)", iridescent, children, }) => {
    const s = sigma ?? Math.round(Math.min(w, h) * 0.06);
    return ({ kind: "layer", style: {
            position: "absolute",
            left: x,
            top: y,
            width: w,
            height: h,
            cornerRadius: r,
            overflow: "hidden",
        }, children: [{ kind: "layer", style: {
                    position: "absolute",
                    left: -x,
                    top: -y,
                    width: 1920,
                    height: 1080,
                    filter: `blur(${s}px)`,
                }, children: world }, { kind: "layer", style: { position: "absolute", inset: 0, background: tint } }, iridescent && ({ kind: "layer", style: {
                    position: "absolute",
                    inset: 0,
                    cornerRadius: r,
                    halo: "inset 0 0 6px 1px rgba(255,170,220,0.55), inset 0 0 14px 2px rgba(150,230,255,0.35)",
                } }), { kind: "layer", style: {
                    position: "absolute",
                    inset: 0,
                    cornerRadius: r,
                    padding: 1.5,
                    background: `linear-gradient(to bottom, ${rimTop}, ${rimBottom})`,
                    WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                } }, { kind: "layer", style: { position: "absolute", inset: 0 }, children: children }] });
};
/** Flat-ground glass: no blur at all, a diagonal sheen and a 1 px rim. */
export const SheenCard: (props: {
    x: number;
    y: number;
    w: number;
    h: number;
    r?: number;
    dark?: string;
    light?: string;
    children?: unknown;
}) => unknown = ({ x, y, w, h, r = 56, dark = "#2250B0", light = "#2E63C8", children }) => ({ kind: "layer", style: {
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        cornerRadius: r,
        background: `linear-gradient(135deg, ${light} 0%, ${dark} 30%, ${light} 50%, ${dark} 72%, #204CA4 100%)`,
        halo: "inset 0 0 0 1px rgba(255,255,255,0.16)",
    }, children: children });
```

### 7. Glass solid with rim light (dark body, light only at the edges) · `glass-solid`

Family: material, light. Starter: pure recipe (`lib/moves.ts` math). The code adds the dark-glass disc, glass type
and a three.js iridescent dome.

**Job.** The hero object (the product's mark, its main button, its one idea) made precious. Light reveals the form, so
the object reads as real and expensive without a texture.

**Numbers.**

- Rim 1.5-5 px, brightest on the side facing the key (top or bottom), with a two-radius glow (10 px at 0.55, 28 px at
  0.25).
- Body: dark (L 4-20 %) with 2-3 tonal zones, or a vertical gradient from black at the top to a light accent at the
  bottom; translucent solids at alpha 0.35-0.75.
- Inner pools: a crescent along the lit edge, an inner reflection rim 40 px inside, thin-film bands of 30-60 px; zone
  edges blurred about 0.12 R.
- State changes: filling with light over 6-10 f; frost to clear over about 12 f; the face turning into the light over
  about 12 f.

**Presets.**

- _Dark glass disc_ (a main button). Rim 2.5 px `#FBFCFF`, glow `0 0 10px rgba(255,255,255,.55), 0 0 28px
rgba(130,120,255,.25)`. Three zones along the vertical axis (t from -1 at the top to +1 at the bottom): top
  `#1E06F0` -> `#1D0EB7` -> `#1D127B` (t -1 to -0.55); middle `#1A1444` -> `#1D1934` -> `#1A1628` (to +0.45); bottom
  `#18144A` -> `#2413C8` -> `#2411EC` -> `#1C0AF2`; a spot `#6A60FF` at t 0.45-0.85. Zone edges blurred 0.12 R.
- _Glass type_ (a wordmark about 1000 px tall, a display serif). Each glyph face is a vertical gradient: black at the
  top, `#937BF0` at 60 %, `#A996F9` at 75 %, `#CFC1FC` at 90 %, `#E6DDFB` at the bottom; a 1.5 px mint rim `#C8E8D0` at
  60 % on the top 45 % only; letters standing on a 30 px lavender floor glow `#EBC6EF`.
- _Glass world._ Solids at alpha 0.35-0.75 over the far world with opaque rims; spheres filled from `#151128` (shadow)
  to `#2E216B` (lit upper inner side), a 3-5 px violet-blue rim `#6A5AE8`, a 20 px inner glow and a reflection rim
  40 px inside.
- _Clear dome_ (three.js). A refraction band about 50 px at the rim (`#7D89A6`), a 40 px thin-film highlight, iridescent
  arcs of 30-60 px; fresnel power 3, ramp `#DED3DA` `#B9C9E8` `#E8D8B8` `#C8E8E8`, opacity 0.35 over a white base at
  0.08.
- _Faceted solid._ Faces painted with flat colours (no live refraction) and one caustic band about 260 px wide across a
  face, from a mint-white core through warm stops to the face colour.

**Rich.** A dark body with light only at the rims and in a pool on the lit side; 2-3 tonal zones with soft edges; thin
rims (1.5-3 px) brighter where the key is; a floor glow to stand on; one sweep across it.

**Cheap.** A uniform translucent fill; an even outline all round; a glossy top ellipse; a drop shadow under glass;
chrome.

```ts
/** Dark glass disc: three zones as stacked gradients clipped to a circle; rim + two-radius glow. */
export const DarkGlassDisc: (props: {
    cx: number;
    cy: number;
    R: number;
    children?: unknown;
}) => unknown = ({ cx, cy, R, children }) => ({ kind: "layer", style: {
        position: "absolute",
        left: cx - R,
        top: cy - R,
        width: 2 * R,
        height: 2 * R,
        cornerRadius: "50%",
        overflow: "hidden",
        halo: "0 0 0 2.5px #FBFCFF, 0 0 10px 2.5px rgba(255,255,255,.55), 0 0 28px 2.5px rgba(130,120,255,.25)",
    }, children: [{ kind: "layer", style: {
                position: "absolute",
                inset: 0,
                background: "linear-gradient(to bottom, #1E06F0 0%, #1D0EB7 10%, #1D127B 20%, #1A1444 28%, #1D1934 45%, #1A1628 60%, #18144A 72%, #2413C8 82%, #2411EC 92%, #1C0AF2 100%)",
            } }, { kind: "layer", style: {
                position: "absolute",
                inset: 0,
                background: "radial-gradient(40% 22% at 50% 80%, rgba(31,21,117,0.85), rgba(31,21,117,0) 100%)",
            } }, { kind: "layer", style: {
                position: "absolute",
                left: "72.5%",
                top: "92.5%",
                width: R * 0.18,
                height: R * 0.12,
                cornerRadius: "50%",
                background: "#6A60FF",
                filter: `blur(${R * 0.04}px)`,
                transform: "translate(-50%,-50%)",
            } }, children] });
/** Glass type: vertical gradient face, a mint rim on the top 45 % only, a floor glow under the letters. */
export const GlassType: (props: {
    text: string;
    x: number;
    y: number;
    size?: number;
    font?: string;
}) => unknown = ({ text, x, y, size = 1000, font = "Instrument Serif" }) => ({
    kind: "vector",
    width: 1920,
    height: 1080,
    style: { position: "absolute", inset: 0 },
    children: [{ kind: "defs", children: [{
                    kind: "linearGradient",
                    id: "gt-face",
                    x1: "0",
                    y1: y - size * 0.72,
                    x2: "0",
                    y2: y,
                    gradientUnits: "userSpaceOnUse",
                    children: [{ kind: "stop", offset: "0", stopColor: "#000000" }, { kind: "stop", offset: "0.4", stopColor: "#05030A" }, { kind: "stop", offset: "0.6", stopColor: "#937BF0" }, { kind: "stop", offset: "0.75", stopColor: "#A996F9" }, { kind: "stop", offset: "0.9", stopColor: "#CFC1FC" }, { kind: "stop", offset: "1", stopColor: "#E6DDFB" }]
                }, { kind: "apertureMask", id: "gt-top", children: {
                        kind: "rect",
                        x: 0,
                        y: y - size * 0.75,
                        width: 1920,
                        height: size * 0.75 * 0.45
                    } }, {
                    kind: "linearGradient",
                    id: "gt-floor",
                    x1: "0",
                    y1: "1050",
                    x2: "0",
                    y2: "1080",
                    gradientUnits: "userSpaceOnUse",
                    children: [{
                            kind: "stop",
                            offset: "0",
                            stopColor: "#EBC6EF",
                            stopOpacity: "0"
                        }, { kind: "stop", offset: "1", stopColor: "#EBC6EF" }]
                }] }, {
            kind: "rect",
            x: 0,
            y: 1050,
            width: 1920,
            height: 30,
            fill: "url(#gt-floor)"
        }, {
            kind: "text",
            x: x,
            y: y,
            fontFamily: font,
            fontSize: size,
            fill: "url(#gt-face)",
            children: text
        }, {
            kind: "text",
            x: x,
            y: y,
            fontFamily: font,
            fontSize: size,
            fill: "none",
            stroke: "#C8E8D0",
            strokeOpacity: 0.6,
            strokeWidth: 1.5,
            aperture: "url(#gt-top)",
            children: text
        }]
});
```

### 8. Light sweep, sheen and specular streak, clipped to the object · `light-sweep`

Family: light, material. Starter: `fx/Exposure` `LightSweep` (a light front 0.45 x the frame wide, 12 degrees, gain
0.55, 44 f at 60 fps on `E.launchIn`). The house band is a light front, not a glyph sweep; the code adds a
narrow glyph sweep and a rim streak.

**Job.** "Finished, locked, precious." A sweep marks the moment a thing is complete (a wordmark lands, a row is done)
and makes its material read (glass, metal, satin). A travelling specular streak says a real light hangs above the
object.

**Numbers.**

- Band 120-200 px wide (6-10 % of the frame width; 12-40 % of the element height). Specular streak cores 3 x 170 px.
- Angle -20 to -30 degrees; vertical bands are fine on rows.
- Peak 12-60 % white in screen blend; a streak core reaches luma 135-152 over a dark box.
- Speed 25-70 px per frame; 6-25 f; one pass (one late, smaller highlight is allowed).
- Clipped strictly to the faces: a glyph mask, a border band of +/-8 px, or the card shape.

**Presets.**

- _Glyph sweep._ 120 px band at -20 degrees, peak 0.55, 22 f, slightly accelerating; visible only on the letter faces,
  glyph by glyph; a glassy chime (1.3-2.3 kHz) under it.
- _Row shimmer._ 120 px band, white 35 % in screen blend, left to right at 60 px per frame across the row that just
  completed; each new word of the previous row is brighter for 3 frames.
- _Banner sheen._ A 200 px band at 12 % crossing in 6 frames.
- _Coloured sweep._ A soft diagonal band in a cool accent at 60 % during a focus pull.
- _Rim streak._ The reflection of an overhead light in a glass rim: a 3 px core 170 px long whose brightness along its
  length is a Gaussian (sigma 45 px), a glow 10 px tall and 40 px long (both sigma), white, drawn additively and clipped
  to the border band. One streak holds near the top rim; the other slides along the bottom rim about 640 px in 24 f,
  then rides with the box. Opacity 0.4 on its first frame, 1 from the third.
- _Button sheen._ Two parallel 30-degree stripes in a lighter tint of the button colour at 40 %.
- _Edge travel._ A highlight in the accent travels along a pill's top edge.
- _Glints._ Three 3 px white points with 10 px glows on a dark disc.

**Rich.** Narrow, soft, slanted, clipped to the object's faces, one pass on a beat, with a glassy sound; specular
streaks that move as the object moves.

**Cheap.** A wide band crossing the whole frame; repeated loops; a sweep over a flat card with no material; a hard-edged
band; spill outside the glyphs.

```ts
import { EZ, f30 } from "./fx-shared";
/** A band clipped to text: a second copy of the text whose fill is a moving gradient (background-clip:text), screen-blended. */
export const GlyphSweep: (props: {
    start: number;
    text: string;
    style: Record<string, string | number | undefined>;
    width: number;
    band?: number;
    angle?: number;
    peak?: number;
    frames?: number;
}) => unknown = ({ start, text, style, width, band = 120, angle = -20, peak = 0.55, frames = 22 }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    if (t < 0 || t > frames)
        return null;
    const u = 0.65 * (t / frames) + 0.35 * EZ.panIn(t / frames); // slightly accelerating
    const x = -band + (width + 2 * band) * u;
    const g = `linear-gradient(${90 + angle}deg, transparent ${x - band / 2}px, rgba(255,255,255,${peak}) ${x}px, transparent ${x + band / 2}px)`;
    return ({ kind: "layer", style: {
            ...style,
            position: "absolute",
            backgroundImage: g,
            backgroundRepeat: "no-repeat",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            mixBlendMode: "screen",
        }, children: text });
};
/** Rim streak: a 3 x 170 px core with a Gaussian profile along its length + glow; clip it to the border band. */
export const RimStreak: (props: {
    x: number;
    y: number;
    opacity: number;
}) => unknown = ({ x, y, opacity, }) => ({ kind: "layer", style: {
        position: "absolute",
        left: x - 120,
        top: y - 12,
        width: 240,
        height: 24,
        opacity,
        mixBlendMode: "screen",
        pointerEvents: "none",
    }, children: [{ kind: "layer", style: {
                position: "absolute",
                left: 60,
                top: 6,
                width: 120,
                height: 12,
                cornerRadius: "50%",
                background: "rgba(255,255,255,0.45)",
                filter: "blur(10px)",
            } }, { kind: "layer", style: {
                position: "absolute",
                left: 35,
                top: 10.5,
                width: 170,
                height: 3,
                cornerRadius: 2,
                background: "linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.53) 23%, #FFFFFF 50%, rgba(255,255,255,0.53) 77%, rgba(255,255,255,0) 100%)",
            } }] });
```

### 9. Element glow and halo (two-radius glows, text glows, contact blooms) · `element-glow`

Family: light. Starter: pure recipe (`lib/moves.ts` math). The code adds a
click bloom and a selection ring.

**Job.** State: selected, active, live, working, clicked. A glow is the visible form of an event, so it appears on the
event and then leaves.

**Numbers.**

- Two-radius stack: a tight core of 6-14 px at 0.40-0.60 plus a wide skirt of 22-40 px at 0.12-0.35.
- Text glows: a blurred copy behind the text, 20-40 px, opacity 0.25-0.6, a hue slightly lighter than the text.
- Click blooms: radius 150-300 px (an under-glow up to 500), life 8-16 f (rise 4-7 f, fade 5-6 f).
- Selection rings: a 2 px stroke + a 14 px glow at 0.35, and an echo ring 60 px out for 5 f.

**Presets.**

- _Glass button rim._ `0 0 10px rgba(255,255,255,.55), 0 0 28px rgba(130,120,255,.25)`.
- _Decode halo._ `#2A1FFF` around the scrambling glyphs, radius about 18 px plus a weaker 40 px skirt; off at lock.
- _Pill glow._ `linear-gradient(180deg, #3B78F2, #2C63E6)`, 2 px rim `rgba(255,255,255,0.35)`, outer glow `0 0 24px
rgba(60,120,255,0.35)`.
- _Selection ring._ A rounded rect 24 px outside the card, 2 px stroke `#2B4FA8`, 14 px glow `rgba(47,107,234,0.35)`,
  an echo ring 60 px out for 5 f.
- _Glowing border field._ A 1.6 px border in a three-stop conic gradient; the outer glow is the same gradient blurred
  22 px at 0.7, strongest under the bottom edge, over a dark tinted haze.
- _Search field._ A 3 px border `#6BBDF2`, outer glow `0 0 36px rgba(107,189,242,0.35)`; the word carries a faint 6 px
  glow of its own colours.
- _Text glow at night._ A blurred copy of the text in a lighter brand tint behind it, radius about 20 px, its opacity
  rising with the colour change.
- _Click bloom_ (24 fps). A soft radial light-blue bloom over the pill and under the text: 150 px across on its first
  frame, peak 4-7 f later (core `#AFD6F5` at the focal point, half intensity at radius 150 px, falloff to 290 px), gone 14 f
  after it appeared.
- _Click ring._ A white ring of 8 px plus a 24 px white outer glow at 80 %, 12 f, gone 4 f later; under it a soft glow
  of radius 500 at 35 % in the accent.
- _Hover light._ A soft white radial glow about 70 px wide `rgba(255,255,255,0.55)`, strongest at the click.
- _Own-colour shadow-glow_ under an object: 40 px at 30 %.
- _End-card glyph glow._ `text-shadow: 0 0 10px rgba(196,140,255,g), 0 0 34px rgba(150,80,240,g)`, g rising with the
  beat.

**Rich.** Two radii (core and skirt); the element's own hue, a little lighter; a short life tied to an event; the glow
under the text, never over it; strongest on the side facing the light.

**Cheap.** One huge neon outer glow; a glow on every card at rest; a glow colour from outside the palette;
`text-shadow` glows on body copy.

```ts
import { at, f30, glow2 } from "./fx-shared";
/** Text glow: a blurred copy of the same text BEHIND it (scope: that text only). */
export const GlowText: (props: {
    text: string;
    style: Record<string, string | number | undefined>;
    glow: string;
    radius?: number;
    alpha?: number;
}) => unknown = ({ text, style, glow, radius = 20, alpha = 0.5 }) => ({ kind: "layer", style: { position: "relative", display: "inline-block" }, children: [{
            kind: "layer",
            "aria-hidden": true,
            style: {
                ...style,
                position: "absolute",
                inset: 0,
                color: glow,
                filter: `blur(${radius}px)`,
                opacity: alpha,
            },
            children: text
        }, { kind: "layer", style: { ...style, position: "relative" }, children: text }] });
/** Click bloom at (x, y): appears at `start` (30 fps frames), peaks at +5..+9, gone at +18. */
export const ClickBloom: (props: {
    x: number;
    y: number;
    start: number;
    core?: string;
}) => unknown = ({ x, y, start, core = "#AFD6F5", }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    if (t < 0 || t > 18)
        return null;
    const r = at(t, { 0: 75, 5: 290, 9: 300, 18: 320 });
    const a = at(t, { 0: 0.35, 5: 1, 9: 1, 18: 0 });
    return ({ kind: "layer", style: {
            position: "absolute",
            left: x - r,
            top: y - r,
            width: 2 * r,
            height: 2 * r,
            cornerRadius: "50%",
            opacity: a,
            background: `radial-gradient(closest-side, ${core} 0%, ${core}80 50%, transparent 100%)`,
            mixBlendMode: "screen",
            pointerEvents: "none",
        } });
};
/** Selection ring: 24 px outside the card, a 2 px stroke + a 14 px glow, and an echo ring 60 px out for 5 f. */
export const FocusRing: (props: {
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
    start: number;
}) => unknown = ({ x, y, w, h, r, start }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    if (t < 0)
        return null;
    const a = at(t, { 0: 0, 3: 1 });
    const echo = at(t, { 4: 0, 5: 0.5, 9: 0 });
    const ring = (o: number, op: number) => ({ kind: "layer", style: {
            position: "absolute",
            left: x - o,
            top: y - o,
            width: w + 2 * o,
            height: h + 2 * o,
            cornerRadius: r + o,
            border: "2px solid #2B4FA8",
            opacity: op,
            halo: "0 0 14px rgba(47,107,234,0.35), inset 0 0 14px rgba(47,107,234,0.15)",
        } });
    return ([ring(24, a), echo > 0 && ring(84, echo)]);
};
```

### 10. Bloom on emissive highlights · `bloom`

Family: light, grade. Starter: `film-stage/grade.ts` (`halation` bloom pass) and pure recipe (`lib/moves.ts` math). The code
adds an end-bloom on light elements and documents the threshold policy.

**Job.** It makes light sources read as light (emissive) instead of paint, and pulls the eye to the brightest thing.

**Numbers.**

- Threshold about luma 200: only near-whites and emissives bloom. Radius 10-18 px for crisp symbols, 20-40 px for objects,
  40-60 px halos for light pillars, 90-140 px for single words.
- Strength 0.25-0.55. Falloff: 50 % at about 15 px outside the edge, 25 % at 40 px, 10 % at 70 px.
- Life: on the hit (a one-frame white word bloom, a bloom at the end of a shot), or constant on emissives.

**Presets.**

- _Dark-stage threshold._ Every value above luma 200 blooms with radius 18 px, strength 0.35; the stage stays at
  `#090909`, so only the few whites bloom.
- _Own-colour emissives._ Pillars, beams, neon lines and halos glow in their own colour at radius 20-40 px, 30-45 %.
  A bloom is never drawn over the near defocused layer or the wordmark.
- _Emissive prop bloom._ Primary light core 14 px at 0.55 white; secondary slabs 10 px at 0.25 lilac; accent bars 12 px at 0.35.
- _End bloom._ Only at the end of a shot every tile and word glows white; build it with a drop-shadow whose radius is
  20 + 40 g and a brightness of 1 + 0.8 g, g from 0 to 1.
- _Bloom in._ Opacity 0, 0.3, 0.6, 0.85, 1.0 over 10 f (24 fps) from one corner.
- _Word bloom._ One word in white with a big soft white bloom (radius about 140 px) for one frame, then the next word in
  blue with a strong blue bloom.

**Rich.** Bloom only on the few emissive things; in their own colour; a falloff with three radii; dark grounds kept
dark.

**Cheap.** Bloom on everything (a grey haze over the frame); white bloom on coloured objects; a single uniform halo.

```ts
/**
 * Bloom an emissive layer only: the layer itself + three blurred copies in screen blend.
 * Weights follow the starter (0.85 / 0.5 / 0.28 at 5 / 18 / 56 px), scaled by `strength`; the tint is the layer's own colour.
 */
export const EmissiveBloom: (props: {
    strength?: number;
    radii?: [
        number,
        number,
        number
    ];
    children: unknown;
}) => unknown = ({ strength = 0.4, radii = [5, 18, 56], children }) => {
    const w = [0.85, 0.5, 0.28].map((x) => x * strength);
    return ({ kind: "layer", style: { position: "absolute", inset: 0 }, children: [radii.map((r, i) => ({
                kind: "layer",
                key: r,
                style: {
                    position: "absolute",
                    inset: 0,
                    filter: `blur(${r}px)`,
                    opacity: w[i],
                    mixBlendMode: "screen",
                },
                children: children
            })), { kind: "layer", style: { position: "absolute", inset: 0 }, children: children }] });
};
/** End bloom on a light element; glow level g in 0..1 (drop-shadow + brightness). */
export const endBloom = (g: number) => `drop-shadow(0 0 ${20 + 40 * g}px rgba(255,255,255,${0.9 * g})) brightness(${1 + 0.8 * g})`;
```

### 11. Iris (a circular or shaped window into the next world) · `iris`

Family: mask, transition. Starter: `fx/Iris` (`IRIS_REVEAL.shape` [0, .565, .756, .851, .919, 1], r0Share .37). The
code adds an iris under the UI, a vesica window and the light rim.

**Job.** It enters a new world through the old one, so the two feel connected; it says "look inside" or "into the
product". A shaped iris (scallop, vesica, star) makes the transition belong to the brand.

**Numbers.**

- 4-14 f (house 5 f; 36 f with a slow middle for a hero opening).
- Radius growth per frame: about x1.5 on the first step, decaying to x1.04 (202 -> 305 -> 396 -> 472 px: x1.51, 1.30,
  1.19, 1.14, 1.10 ...). Diameter as a share of the final: 0.37, 0.65, 0.79, 0.86, 1.
- Edge 3-12 px soft (a white-out uses a 200 px feather); a 2-4 px light rim on dark worlds, plus a 40-80 px inner glow.
- Centre: the subject that carries over (a rock, a dome, a word), not always the frame centre.

**Presets.**

- _Fast iris._ A circle centred on the frame with a 6 px soft edge: diameter 808, 1424, 1730, 1898 px, then full frame
  on the fifth frame.
- _Iris under the UI_ (24 fps). A circular window opens under the chat layer (the bubbles and labels slide over it),
  the top-view plate already moving inside; radius per frame 202, 305, 396, 472, 538, 593, 643, 688, 728, 765, 798,
  828, 855 px; 3 px soft edge with a 2 px rim at 50 % white.
- _Scalloped iris._ 14 shallow round lobes, a 12 px soft edge, opening around a star over 36 f; the star stays on top.
- _White-out reveal_ (25 fps). A white layer at 100 % for two frames, then a radial hole growing from the subject,
  feather 200 px, fully open 8 f later.
- _Vesica._ Two circles of radius about 820 px overlap and their overlap is the window into the next scene; the lens
  half-width grows 145, 354, 776, 961 px over four frames; a 3-4 px violet rim `#754CD9` and a 40-80 px inner glow.
- _Mosaic ring._ A ring of 22 px mosaic squares in five tiers of the accent (`#2A0628` `#5A0F57` `#8E1A8A` `#C42AA4`
  `#E04C9A`, feather 30 px) grows from a small disc over a word: outer / inner radius 118 / 0, 285 / 85, 395 / 252,
  485 / 328, 564 / 421, 632 / 505, 700 / 539, 780 / 640 px.
- _Opening disc._ An iris disc opens the film; discs may open and then blur out.

**Rich.** The next world already alive inside the iris; the iris centred on what carries over; the radius
decelerating; the rim catching light; UI staying on top of the iris when it should.

**Cheap.** A circle wipe from black to black; a linear radius; a hard edge with no rim; an iris that has nothing to do
with the content.

```ts
import { at, f30 } from "./fx-shared";
// Normalised radius shares per frame after the start (r / farCorner); a slower decay for longer irises.
const SHARE_FAST = { 0: 0.37, 1: 0.65, 2: 0.79, 3: 0.86, 4: 1.0 };
const farCorner = (x: number, y: number) => Math.hypot(Math.max(x, 1920 - x), Math.max(y, 1080 - y));
/** Circular iris: `next` is revealed inside, `prev` stays outside. Soft edge + a light rim. `under` keeps UI above. */
export const IrisReveal: (props: {
    start: number;
    cx?: number;
    cy?: number;
    soft?: number;
    rim?: boolean;
    next: unknown;
    prev?: unknown;
    ui?: unknown;
}) => unknown = ({ start, cx = 960, cy = 540, soft = 6, rim = true, next, prev, ui }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    const R = farCorner(cx, cy) + soft;
    const r = t < 0 ? 0 : at(t, SHARE_FAST) * R;
    const mask = `radial-gradient(circle at ${cx}px ${cy}px, #000 ${Math.max(0, r - soft)}px, transparent ${r}px)`;
    return ({ kind: "layer", children: [prev, r > 0 && ({ kind: "layer", style: { WebkitMaskImage: mask, maskImage: mask }, children: next }), rim && r > 0 && r < R && ({ kind: "layer", style: {
                    position: "absolute",
                    left: cx - r,
                    top: cy - r,
                    width: 2 * r,
                    height: 2 * r,
                    cornerRadius: "50%",
                    halo: "0 0 0 2px rgba(255,255,255,.5)",
                } }), ui /* The chat layer stays above the iris */] });
};
/** Vesica window: intersection of two circles (r 820) whose centres approach; violet rim + inner glow. */
export const VesicaIris: (props: {
    start: number;
    next: unknown;
}) => unknown = ({ start, next }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    const half = at(t, { 0: 145, 1.25: 354, 2.5: 776, 3.75: 961, 5: 1300 }); // 24 fps half-widths resampled to 30 fps
    if (t < 0)
        return null;
    const r = 820, d = r - half; // centres at 960 ∓ d (y 600): the lens half-width at y 540 ≈ half
    const ring = (cx: number) => ({ kind: "layer", style: {
            position: "absolute",
            left: cx - r,
            top: 600 - r,
            width: 2 * r,
            height: 2 * r,
            cornerRadius: "50%",
            halo: "inset 0 0 0 3.5px #754CD9, inset 0 0 60px 6px rgba(117,76,217,0.55)",
        } });
    // nested clip-paths intersect: outer = circle A, inner = circle B
    return ({ kind: "layer", style: { aperture: `circle(${r}px at ${960 - d}px 600px)` }, children: { kind: "layer", style: { aperture: `circle(${r}px at ${960 + d}px 600px)` }, children: [next, ring(960 - d), ring(960 + d)] } });
};
```

### 12. Mesh gradient and liquid colour field (a living ground with no edges) · `mesh-gradient`

Family: gradient, world. Starter: `fx/Gradients`. The code adds a colour-table mesh field and silk
bands, both rendered small and upscaled.

**Job.** A living world and a mood without photographs: the brand colour becomes atmosphere, and the field's motion
keeps the frame alive during holds, so the picture never stops.

**Numbers.**

- 3-6 blobs; blur 90-250 px (or a tiny canvas upscaled); one hue family plus a real value range (a field may span
  `#010101` to `#F7ADC3`).
- Drift 0.3-2 px per frame; colour samples change every 9-18 f; a hue cycle period of about 48 f.
- A swirl-in takes 4-6 f; the field breathes or contracts slowly; never fully static.

**Presets.**

- _Colour-table mesh._ A 3 x 3 colour table interpolated every 9 f (at 25 fps) on a 64 x 36 canvas, upscaled with a
  120-250 px blur. A first table: `#F7ADC3` `#EBC6F4` `#CAB1F4` / `#0D0A1A` `#090813` `#CFBAF8` / `#F6A7B0` `#F8C0E7`
  `#DEB8F3` (light corners, a dark middle row). The field blooms when a point field arrives.
- _Split ground._ The top 40 % light grey `#E7E7E7` with a soft edge; below it four blurred blobs drift slowly (warm,
  red, pink, lavender), colours re-sampled every 18 f.
- _Silk bands._ Broad soft curved diagonal bands from lower left to upper right, each 250-350 px wide, at about
  -35 degrees, flowing slowly up and right; colours `#E95951` `#EC7652` `#DD2E6E` `#87079F` `#440162`, hue period 48 f.
- _Liquid ellipses._ 3-4 large blurred ellipses or paths on a teal ground, drifting about 2 px per frame.
- _Blob ring vignette._ A thick ring of heavily blurred periwinkle (sigma 90-120 px; tiers `#4553C4` `#5965C7`
  `#8690D7` `#B9BDE6`) swirls in from one side within 4-6 frames and leaves an elliptical clear hole about 1000-1250 px
  wide around the text.
- _Cheap blob._ Blurred ellipses with `filter: blur(140px)` on a half-scale layer (render at 480 x 270 and upscale).
- _Swirl open._ A luminous S-swirl flashes open into a moving blue mesh.

**Rich.** Rendered small and upscaled (perfectly smooth, no banding), dithered, slowly drifting, one hue family with
real value contrast, the field reacting to events.

**Cheap.** A static two-stop CSS linear gradient; a rainbow of hues; banding; blobs whose edges show.

```ts
import { f30 } from "./fx-shared";
type RGB = [
    number,
    number,
    number
];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
/**
 * Mesh: a 3x3 colour table every `every` frames (30-fps frames), bicubic-ish upsample on a 64x36 canvas
 * displayed at 1920x1080 with smoothing. No CSS blur on a full-frame layer; the tiny canvas IS the blur.
 */
export const MeshField: (props: {
    table: Record<number, string[]>;
    every?: number;
}) => unknown = ({ table, every = 11, }) => {
    const ref = { current: document.createElement("canvas") };
    const { fps } = filmDefaults();
    const f = f30(frame, fps);
    const keys = Object.keys(table)
        .map(Number)
        .sort((a, b) => a - b);
    const k1 = keys.find((k) => k > f) ?? keys[keys.length - 1];
    const k0 = [...keys].reverse().find((k) => k <= f) ?? keys[0];
    const u = k1 === k0 ? 0 : (f - k0) / (k1 - k0);
    const g = table[k0].map((c, i) => mix(hex(c), hex(table[k1][i]), u)); // 9 colours
    const ctx = ref.current!.getContext("2d")!;
    const W = 64, H = 36, img = ctx.createImageData(W, H);
    const smooth = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const gx = (x / (W - 1)) * 2, gy = (y / (H - 1)) * 2;
            const ix = Math.min(1, Math.floor(gx)), iy = Math.min(1, Math.floor(gy));
            const tx = smooth(gx - ix), ty = smooth(gy - iy);
            const c = (r: number, cc: number) => g[r * 3 + cc];
            const top = mix(c(iy, ix), c(iy, ix + 1), tx), bot = mix(c(iy + 1, ix), c(iy + 1, ix + 1), tx);
            const p = mix(top, bot, ty), o = (y * W + x) * 4;
            img.data[o] = p[0];
            img.data[o + 1] = p[1];
            img.data[o + 2] = p[2];
            img.data[o + 3] = 255;
        }
    ctx.putImageData(img, 0, 0);
    return ({
        kind: "canvas",
        ref: ref,
        width: 64,
        height: 36,
        style: { position: "absolute", inset: 0, width: 1920, height: 1080, imageRendering: "auto" }
    });
};
// Grade-safety: the 8-bit upscale can band on low-span fields; for the deliverable, render through scripts/probe.py --blur
// (accumulate.py dithers smooth ramps) or overlay the starter's 1-LSB dither plate.
/** Silk bands: three soft diagonal bands drifting up-right; hue cycles with a 48 f period. */
export const SilkBands: (props: {
    colours?: string[];
}) => unknown = ({ colours = ["#E95951", "#EC7652", "#DD2E6E", "#87079F", "#440162"], }) => {
    const { fps } = filmDefaults();
    const f = f30(frame, fps);
    const phase = (f % 48) / 48;
    const shift = (i: number) => colours[(i + Math.floor(phase * colours.length)) % colours.length];
    const off = (f * 3) % 600; // bands flow right/up
    return ({ kind: "layer", style: { overflow: "hidden", background: shift(4) }, children: { kind: "layer", style: {
                position: "absolute",
                left: -800,
                top: -800,
                width: 3520,
                height: 2680,
                transform: `rotate(-35deg) translateX(${off}px)`,
                background: `repeating-linear-gradient(90deg, ${shift(0)} 0px, ${shift(1)} 150px, ${shift(2)} 300px, ${shift(3)} 450px, ${shift(0)} 600px)`,
                filter: "blur(60px)",
            } } });
};
```

### 13. Develop: tint, duotone or gradient map to true colour · `develop`

Family: colour, gradient. Starter: pure recipe (`lib/moves.ts` math). The code adds a per-tile develop with a blur ladder,
a reading-order stagger and a decaying arrival tint.

**Job.** "Generating, loading -> the real result." Pictures arrive as data and become real. It also pulls foreign
photos into the film's palette while they are new, so stock never looks random.

**Numbers.**

- Tint phase 3-14 f; per-item stagger 1-4 f in reading order; a 3 f cross-fade per item.
- With blur: the blur clears first (8-10 px, then 6, 4, 2, 1, 0), then the colour arrives.
- Maps: 2-5 stops from the brand palette (the duotone shadow is the brand colour, the highlight white or paper).
- A multiply tint decays roughly geometrically: 1.0, 0.75, 0.5, 0.35, 0.22, 0.08, 0 over 7 f.

**Presets.**

- _Blueprint to colour._ Rows rise blurred (vertical smear 30, 12, 0 px); thumbnails start as white plates `#F2F4FA`
  with blue line art, then develop to colour one by one.
- _Duotone window._ The whole window starts blurred 8 px and blue-monochrome (shadow `#1E44C8` or `#2F5FE0`, highlight
  white), sharpens 4, 2, 1, 0, then each tile cross-fades to colour in 3 f, column by column 3 f apart and the next row
  5 f later.
- _Pastel map._ Cards and tiles arrive gradient-mapped in three pastels (magenta `#D76FE3`, peach `#F8C37B`, mint
  `#9EE8F7`) and flip to true colour; a backdrop blurred 30 px cycles through `#EFADA8` `#E28AD1` `#D479F9` `#C0CDF6`
  every 4 f.
- _Arrival tint._ A newly landed item is a flat accent silhouette; its real texture fades in under a decaying multiply
  (1.0, 0.75, 0.5, 0.35, 0.22, 0.08, 0), with a lighter tint of the accent in between.
- _Card develop_ (24 fps). A pink screen-plus-multiply tint fading 1 -> 0 per card over 14-24 f, cards starting 0-9 f
  apart.

**Rich.** Maps built from the palette; a staggered develop in reading order; sharpen first, colour second; true colour
arriving region by region.

**Cheap.** A global greyscale-to-colour fade; sepia; every image tinted the same way all film long.

```ts
import { at, f30, Soft } from "./fx-shared";
/** SVG gradient map: luminance -> table per channel. Stops are hex strings, evenly spaced. */
export const GradientMapFilter: (props: {
    id: string;
    stops: string[];
}) => unknown = ({ id, stops }) => {
    const ch = (i: number) => stops.map((s) => (parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16) / 255).toFixed(3)).join(" ");
    return ({
        kind: "vector",
        width: 0,
        height: 0,
        style: { position: "absolute" },
        children: {
            kind: "filter",
            id: id,
            colorInterpolationFilters: "sRGB",
            children: [{ kind: "feColorMatrix", type: "matrix", values: "0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0" }, { kind: "feComponentTransfer", children: [{ kind: "feFuncR", type: "table", tableValues: ch(0) }, { kind: "feFuncG", type: "table", tableValues: ch(1) }, { kind: "feFuncB", type: "table", tableValues: ch(2) }] }]
        }
    });
};
/** Develop for one tile: duotone + blur hold, blur ladder 6-4-2-1-0, then a 3 f colour cross-fade at `colourAt`. */
export const DevelopTile: (props: {
    start: number;
    colourAt: number;
    id: string;
    shadow?: string;
    children: unknown;
}) => unknown = ({ start, colourAt, id, shadow = "#1E44C8", children }) => {
    const { fps } = filmDefaults();
    const f = f30(frame, fps);
    const blur = at(f - start, { 0: 10, 3: 10, 4: 6, 5: 4, 6: 2, 7: 1, 8: 0 });
    const colour = at(f, { [colourAt]: 0, [colourAt + 3]: 1 });
    return (Soft({ sigma: blur, children: [GradientMapFilter({ id: id, stops: [shadow, "#FFFFFF"] }), { kind: "layer", style: { filter: `url(#${id})` }, children: children }, { kind: "layer", style: { opacity: colour }, children: children }] }));
};
// Reading-order stagger: colourAt = groupStart + 3 * column (+5 for the next row).
/** Arrival tint: a flat colour multiply over the item, decaying 1 / .75 / .5 / .35 / .22 / .08 / 0 over 7 f (30 fps). */
export const ArrivalTint: (props: {
    start: number;
    tint?: string;
    children: unknown;
}) => unknown = ({ start, tint = "#F07818", children, }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    const a = at(t, { 0: 1, 1: 0.75, 2: 0.5, 3: 0.35, 4: 0.22, 6: 0.08, 7: 0 });
    return ({ kind: "layer", style: { position: "relative", isolation: "isolate" }, children: [children, { kind: "layer", style: {
                    position: "absolute",
                    inset: 0,
                    background: tint,
                    mixBlendMode: t < 1 ? "normal" : "multiply",
                    opacity: a,
                } }] });
};
```

### 14. Radial zoom blur on a push · `zoom-blur`

Family: motion, transition. Starter: `fx/Rush`, `fx/Dive`. The code adds a sharp-centre zoom blur made of scaled copies
and a four-frame cross-zoom.

**Job.** "We go in": a fast push into the product or a detail, with the speed of a camera rushing forward; it masks a
cut from wide to macro.

**Numbers.** 1-5 frames; zoom x1.06-1.2 per frame; streaks 4-40 px growing with the distance from the centre; the centre
sharp within 25-35 % of the frame; often a 4 px blurred bridging frame and then the cut.

**Presets.**

- _Cross-zoom into a macro_ (four frames at 30 fps): frame 0 the wide view pushed x1.2 with 6 % spread copies; frame 1
  x1.28; frame 2 a bridging plate at 4 px blur; frame 3 the macro, sharp. Streaks 25-40 px at the edges.
- _Collage hit._ The collage enters scaled x1.06 with a radial blur on the music's uplifter.
- _Carried zoom._ The cut lands still carrying the zoom blur of the previous shot; the list fades in over the next 3 f.
- _Spin plunge._ A steep ease-in counter-clockwise rotation plus zoom about the phone, with a growing edge blur, into a
  hard cut.
- _One-frame radial smear._ Cells doubled with 4-6 px trails toward the centre.

**Rich.** The centre stays sharp (the subject), the streaks grow with radius, it lasts 2-4 f and lands on a detail; the
push is real (3D, parallax).

**Cheap.** A uniform zoom blur over the whole frame for 10 frames or more; zoom blur as a generic transition between
unrelated shots.

```ts
/**
 * Radial zoom blur: `copies` versions scaled 1 .. 1+spread about (cx, cy), averaged (each at 1/(i+1) so the sum is a mean),
 * then a sharp copy masked to the centre. streak at radius r ≈ r * spread (r = 600 px, spread 0.06 -> 36 px).
 */
export const ZoomBlur: (props: {
    cx?: number;
    cy?: number;
    spread: number;
    copies?: number;
    sharpR?: number;
    children: unknown;
}) => unknown = ({ cx = 960, cy = 540, spread, copies = 8, sharpR = 380, children }) => {
    if (spread <= 0.001)
        return { kind: "layer", children: children };
    const mask = `radial-gradient(circle at ${cx}px ${cy}px, #000 ${sharpR * 0.6}px, transparent ${sharpR}px)`;
    return ({ kind: "layer", children: [Array.from({ length: copies }, (_, i) => ({
                kind: "layer",
                key: i,
                style: {
                    transform: `scale(${1 + (spread * i) / (copies - 1)})`,
                    transformOrigin: `${cx}px ${cy}px`,
                    opacity: 1 / (i + 1),
                },
                children: children
            })), { kind: "layer", style: { WebkitMaskImage: mask, maskImage: mask }, children: children }] });
};
```

### 15. Colour flash frame (1-6 frames, on a hit) · `flash-frame`

Family: colour, transition. Starter: pure recipe (`lib/moves.ts` math). The code adds the ghost flash, the capture overexposure and the
element flash.

**Job.** The punch: energy at a cut point, a capture or create moment, a state change. One frame of light reads as an
event, not as a transition.

**Numbers.**

- 1-6 frames: one full-frame white frame by default; 2-3 f for a matte or dissolve flash; 6 f for an
  overexposed capture.
- Full-frame `#EDEDED`-`#FFFFFF`, or element-only (a button, a silhouette, tiles); +30 % luma for a material snap.
- It often carries a ghost of the outgoing image at 10-30 % luma, an inverted band (x 21-78 % of the width), or light
  streaks on the following black frame.
- Sound: always on a hit.

**Presets.**

- _Ghost flash._ At peak speed of a blurred whip, one frame `#EDEDED` with a grey ghost of the outgoing box, then one
  black frame with faint horizontal light streaks (mean luma about 8), then the next shot.
- _Pure white frame._ One `#FFFFFF` frame between a subtitle collapsing into a streak and the streak resolving into
  the next word.
- _Flash between lines._ Line, white flash, line, white flash, line: three statements in one rhythm.
- _Inverted band._ Three one-frame flash images, each with a colour-inverted vertical band over 21-78 % of the width.
- _Element flash._ A button whitens (`#E8F6FF` fill, 60 px glow) for one frame, then the whip cut.
- _Material snap._ A 2-frame dissolve with a +30 % luma flash as an object snaps into a new material state.
- _Impact wash._ A 3-4 frame flash around an impact: core radius 50 px, half intensity at 82 px, a tenth at 98 px.
- _Capture flash._ `brightness(2.6) contrast(1.6) saturate(2.4)` on the picture for 6 frames, with the shutter click.
- _Matte flash._ Opacity 1.0, 0.6, 0.12 over three frames.

**Rich.** One frame, exactly on the audio hit, carrying a ghost or streak of what came before; element flashes tied to
an action (click, snap).

**Cheap.** Multi-frame fade-to-white cross-fades; repeated strobing; a flash on every cut.

```ts
import { f30, Soft } from "./fx-shared";
/** Ghost flash: frame `at` = #EDEDED with a grey ghost of `ghost`; frame at+1 = black with soft horizontal streaks. */
export const GhostFlash: (props: {
    at: number;
    ghost: unknown;
}) => unknown = ({ at: a, ghost }) => {
    const { fps } = filmDefaults();
    const f = Math.floor(f30(frame, fps));
    if (f === a)
        return ({ kind: "layer", style: { background: "#EDEDED" }, children: Soft({
                sigma: 6,
                style: {
                    filter: "grayscale(1) brightness(0.55) contrast(0.6)",
                    opacity: 0.28,
                    mixBlendMode: "multiply",
                },
                children: ghost
            }) });
    if (f === a + 1)
        return ({ kind: "layer", style: { background: "#000" }, children: [0.42, 0.47, 0.53, 0.58].map((y, i) => ({ kind: "layer", key: i, style: {
                    position: "absolute",
                    left: 634,
                    width: 1080,
                    top: 1080 * y,
                    height: 3 + (i % 2) * 2,
                    background: "rgba(255,255,255,0.10)",
                    filter: "blur(3px)",
                } })) });
    return null;
};
/** Capture flash: overexpose the current picture for 6 frames. */
export const overexpose = (active: boolean) => active ? "brightness(2.6) contrast(1.6) saturate(2.4)" : undefined;
/** Element flash: one frame of a light fill + a 60 px glow. */
export const flashStyle = (on: boolean, fill = "#E8F6FF"): Record<string, string | number | undefined> => on ? { background: fill, halo: `0 0 60px ${fill}` } : {};
```

### 16. Light flood, white wash and white-out · `light-flood`

Family: light, transition. Starter: `fx/Washes`, `fx/Exposure`. The code adds a directional wash with a soft front.

**Job.** A soft scene change that feels like light, not an edit: the old world is overexposed away and the new one
forms out of the light. It suits calm, optimistic beats.

**Numbers.** 8-15 frames (11 f at 24 fps); luma target 240-255 (a pale wash at 0.75). Directional (a front with a soft
edge about a quarter of the frame wide), radial (from the subject) or a zoom-through (quad-in, x1.7). The new content
cuts on mid-wash, while the light covers the frame.

**Presets.**

- _White wash_ (24 fps). A soft white front travels right to left in 11 f over the old shot (built from 8 strips about
  206 px wide); the macro fades under it; the new line cuts on at about 80 % of the run.
- _Pale wash._ `#F0F5F9` from alpha 0 to 0.75 over 10 f; out through 0.85, 0.6, 0.35, 0.12 in 4 f.
- _Push-out flood._ A push-out and a light flood with the hard cut hidden under the light.
- _Frosted fly-in._ A huge white frosted window flies in from in front of the lens and covers the frame; the next scene
  is behind it.
- _Zoom through white_ (24 fps). An accelerating push (quad-in, x1.74 over 19 f) through the white centre of an object
  into the next scene.
- _Blur to white._ A line blurs into an empty white frame.

**Rich.** A front with direction and a soft edge; the cut hidden at peak light; the new content already there as the
light recedes.

**Cheap.** A plain cross-dissolve through white; a fade to white that holds an empty white frame.

```ts
import { EZ, f30 } from "./fx-shared";
/** Wash: a soft white front crosses the frame right -> left in `frames`; `next` cuts on at `cutShare` of the run. */
export const WhiteWash: (props: {
    start: number;
    frames?: number;
    cutShare?: number;
    prev: unknown;
    next: unknown;
    colour?: string;
}) => unknown = ({ start, frames = 14, cutShare = 0.7, prev, next, colour = "#FFFFFF" }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    if (t < 0)
        return { kind: "layer", children: prev };
    if (t > frames)
        return { kind: "layer", children: next };
    const u = t / frames;
    const soft = 520;
    const front = 1920 + soft - (1920 + 2 * soft) * EZ.expoOut(Math.min(1, u / 0.85)); // white edge x, moving left
    const wash = `linear-gradient(to right, transparent ${front - soft}px, ${colour} ${front}px, ${colour} 100%)`;
    const out = u > 0.85 ? (u - 0.85) / 0.15 : 0; // wash recedes over the last 15 %
    return ({ kind: "layer", children: [u < cutShare ? prev : next, { kind: "layer", style: { background: wash, opacity: 1 - out } }] });
};
```

### 17. Soft-edge linear mask reveal (feathered wipes on type and cards) · `soft-mask-reveal`

Family: mask. Starter: pure recipe (`lib/moves.ts` math). The code adds a slide that carries its own feathered
mask, and a screen-fixed edge fade.

**Job.** A reveal that reads like light passing or like the reading direction, tied to the element's own motion, so the
word is born as it moves.

**Numbers.** Feather 60-250 px (one to two glyph widths, up to a word's width); the mask edge moves with the element;
6-15 f. Hard clip edges (feather 0) for slot reveals; screen-fixed fades about 300 px wide.

**Presets.**

- _Slide and reveal_ (24 fps). A word slides left 154 px on an expo-out while a soft 250 px linear mask reveals it left
  to right over 10 f; no per-letter animation.
- _Double wash._ Text revealed right to left twice with a 60 px soft edge: first a pale accent ghost, then the ink.
- _Edge fade._ `alpha = smoothstep(x, 120, 430)` fixed to the screen: a moving line fades in as it crosses the left
  edge. Around a sphere: text alpha multiplied by `smoothstep(dist, 210, 330)`.
- _Gradient sweep down._ A dark vertical gradient sweeps down over the cards to close a scene.
- _Slot reveal._ Text clipped to one side of a moving edge (a card side or a panel divider) while it slides out;
  panels are `overflow: hidden` windows onto full-size content.

**Rich.** A wide feather (a glyph or more); the mask edge travelling with the slide; a fixed clip edge the content
passes under (it feels physical).

**Cheap.** A hard-edged linear wipe on a static word; a wipe direction unrelated to the motion.

```ts
import { EZ, f30 } from "./fx-shared";
/** Slide left `slide` px while a `feather` px soft mask reveals left -> right, both on one expo-out. */
export const SoftMaskSlide: (props: {
    start: number;
    frames?: number;
    slide?: number;
    feather?: number;
    width: number;
    children: unknown;
}) => unknown = ({ start, frames = 12, slide = 154, feather = 250, width, children }) => {
    const { fps } = filmDefaults();
    const t = f30(frame, fps) - start;
    const p = EZ.expoOut(Math.max(0, Math.min(1, t / frames)));
    const edge = -feather + (width + feather) * p; // mask edge in element px
    const m = `linear-gradient(to right, #000 ${edge}px, transparent ${edge + feather}px)`;
    return ({ kind: "layer", style: { transform: `translateX(${slide * (1 - p)}px)`, WebkitMaskImage: m, maskImage: m }, children: children });
};
/** Screen-fixed edge fade: wrap a moving line; the mask does not move with it. */
export const EdgeFade: (props: {
    from?: number;
    to?: number;
    children: unknown;
}) => unknown = ({ from = 120, to = 430, children, }) => {
    const m = `linear-gradient(to right, transparent ${from}px, #000 ${to}px)`;
    return ({ kind: "layer", style: { position: "absolute", inset: 0, WebkitMaskImage: m, maskImage: m }, children: children });
};
```

### 18. Particle and point fields (few, placed, glowing) · `particle-field`

Family: particles, light. Starter: pure recipe (`lib/moves.ts` math). The code adds a placed point field, a zooming star
field and the depth extras.

**Job.** Scale and multitude ("many signals", "the whole team"), a network, a night; a field the camera dives through to
change scenes.

**Numbers.**

- 6-15 hero points, plus 2-10 faint depth points at 30-40 % opacity; texture fields (digits, specks) up to about 60
  visible items.
- Points 2-31 px (glow-core diameter 11-31 px); objects 110-150 px; bokeh 52-103 px blurred 4 px.
- Glow 6-10 px Gaussian at 30-50 %. One motion law per field.
- Stagger one new point every 2 f; growth about 8 f on `cubic-bezier(0.2, 0.8, 0.3, 1)`.

**Presets.**

- _Placed night._ Eleven blue dots pop in one every 2 frames at fixed positions (x, y, diameter): (475, 634, 21),
  (536, 291, 21), (643, 724, 28), (752, 559, 17), (830, 365, 25), (965, 547, 30), (1185, 728, 18), (1203, 575, 11),
  (1222, 348, 31), (1377, 718, 21), (1416, 495, 17). Each grows from 0 over 8 f, pops 20-190 px right of its place and
  glides in over 12 f, then drifts 0.3 px per frame. Core `#4A5BF0` (45 % of the diameter), glow `#2A3BD0` at 50 %,
  sigma 6-10; ten faint 3-5 px points at 30 %. The field recedes about (950, 520) with cumulative scale 0.998, 0.995,
  0.993, 0.988, 0.982, 0.968, 0.94.
- _Star field._ A hard cut to 15 white dots (10 px, a 1.5 px soft edge, a 6 px white glow at 30 %) around the centre;
  the positions zoom outward from the centre while the dots keep their size; later the dots become UI chips.
- _Glass rain._ 6-10 small gradient glass cubes (110-150 px) drift down 4-10 px per frame and spin 1-2 degrees per
  frame; the near ones blurred.
- _Digit field._ A binary-digit texture (cap 11 px, pitch 17 x 19, ink `#161616` on `#090909`) masked by an ellipse
  560 x 520 with a 260 px feather, drifting with the camera.
- _Bokeh._ Dark dots float in: diameter 103 px half off a corner blurred 4 px, 52 px nearer the middle, a few more.

**Rich.** Few points at placed positions; staggered pops; depth through faint, blurred extras; one motion law for the
field; points that become UI.

**Cheap.** Hundreds of random twinkling dots; sparkles and confetti; every particle with its own random motion;
particles as decoration with no job.

```ts
import { random } from "./lib/anim";
import { at, EZ, f30 } from "./fx-shared";
type P = [
    number,
    number,
    number
]; // x, y, glow-core diameter
/** Point field: one point every `cadence` f, pops right of its place, glides in over 12 f, grows over 8 f, drifts 0.3 px/f. */
export const PointField: (props: {
    start: number;
    points: P[];
    cadence?: number;
    core?: string;
    glow?: string;
    recedeAt?: number;
}) => unknown = ({ start, points, cadence = 2, core = "#4A5BF0", glow = "#2A3BD0", recedeAt }) => {
    const { fps } = filmDefaults();
    const f = f30(frame, fps);
    const t0 = f - start;
    // recede: cumulative scale about (950,520) from a frame table
    const k = recedeAt === undefined
        ? 1
        : at(f - recedeAt, {
            0: 1,
            1: 0.998,
            2: 0.993,
            3: 0.986,
            4: 0.974,
            5: 0.957,
            6: 0.926,
            7: 0.871,
        });
    return ({ kind: "layer", style: { transform: `scale(${k})`, transformOrigin: "950px 520px" }, children: points.map(([x, y, d], i) => {
            const t = t0 - i * cadence;
            if (t < 0)
                return null;
            const off = 20 + 170 * random(`pop${i}`);
            const gx = x + off * (1 - EZ.expoOut(Math.min(1, t / 12))) + 0.3 * Math.max(0, t - 12) * 0.7;
            const gy = y + 0.3 * Math.max(0, t - 12) * 0.7;
            const s = EZ.pop(Math.min(1, t / 8));
            const breathe = 1 + 0.06 * Math.sin((f + i * 7) / 9);
            return ({
                kind: "layer",
                key: i,
                style: {
                    position: "absolute",
                    left: gx - d / 2,
                    top: gy - d / 2,
                    width: d,
                    height: d,
                    transform: `scale(${s * breathe})`,
                },
                children: [{ kind: "layer", style: {
                            position: "absolute",
                            inset: -d * 0.4,
                            cornerRadius: "50%",
                            background: glow,
                            opacity: 0.5,
                            filter: `blur(${d * 0.3}px)`,
                        } }, { kind: "layer", style: {
                            position: "absolute",
                            inset: d * 0.275,
                            cornerRadius: "50%",
                            background: core,
                        } }]
            });
        }) });
};
/** Star field: positions zoom from a centre (the dots themselves do not grow). zoom(f) from a frame table or an expo-out. */
export const ZoomField: (props: {
    dots: [
        number,
        number
    ][];
    centre: [
        number,
        number
    ];
    zoom: number;
}) => unknown = ({ dots, centre, zoom }) => ({ kind: "layer", children: dots.map(([x, y], i) => {
        const X = centre[0] + zoom * (x - centre[0]), Y = centre[1] + zoom * (y - centre[1]);
        return ({ kind: "layer", key: i, style: {
                position: "absolute",
                left: X - 5,
                top: Y - 5,
                width: 10,
                height: 10,
                cornerRadius: "50%",
                background: "#FFFFFF",
                halo: "0 0 0 1.5px rgba(255,255,255,0.4), 0 0 6px 2px rgba(255,255,255,0.3)",
            } });
    }) });
```

### 19. Light cones, pillars, beams and neon (emissive geometry) · `light-geometry`

Family: light. Starter: `fx/light/*`. The code adds a hard additive light cone and a growing pillar.

**Job.** It makes a world out of light alone (a stage, a hall, a horizon) and points at the hero: a cone or a pillar is
a spotlight that says "this".

**Numbers.**

- Edges sharp (2-4 px) with a soft inner falloff of 30-60 px; halos 40-60 px in the element's own colour.
- Growth 3-10 f (a pillar's top goes from y 620 to 0 in 4 f on an expo-out); beams thin as the camera pulls away (40 ->
  4 px over the pull-back).
- Blend: additive (screen) over the world, never over the near defocused layer or the wordmark.

**Presets.**

- _Pillar shoot_ (24 fps). An emissive strip grows up from the bottom edge and widens; its top at y 620, 328, 158, 32, 0
  on successive frames; its colour white -> `#FBDDBB` -> `#ED31AC` over 3 frames; half-width on `cubic-bezier(0.2, 0.9,
0.3, 1)`; halo 40-60 px.
- _Travelling pulse._ A pale band travels along a coloured emissive strip with a soft 150-250 px boundary, period 6-10 f.
- _Y-split._ A thin pillar splits into two straight beams racing to the top corners at 44 degrees; they thin and dim as
  the camera pulls back.
- _Hard cone._ An additive inverted triangle from the top edge: its top edge at y 198 spanning x 804-1113 and its apex
  at (960, 753), widening in 2 frames to the full top edge (x 618-1308) with the apex at (948, 828); a cream centre
  `#FBDDBB` to accent edges `#ED31AC`, 30-60 px inner falloff, 2-4 px edge.
- _Neon ring._ A ring whose stroke thins 40, 24, 12, 6, 4 px as the camera pulls away.
- _Horizon._ A straight cool neon horizon rises out of the top of the frame as the camera tilts down, a reflection
  below the line.
- _Light curtain._ A generated page floats on a curtain of vertical glowing columns; glow bars rise behind a grid.

**Rich.** Sharp-edged geometry with a soft interior falloff; own-colour halos; additive blending; light that thins with
distance.

**Cheap.** Soft blurry god rays everywhere; lens flares; a light with no source or no target.

```ts
/** Hard light cone: an inverted triangle, sharp edge, cream centre -> accent edges (30-60 px inner falloff), additive. */
export const LightCone: (props: {
    topX0: number;
    topX1: number;
    apex: [
        number,
        number
    ];
    centre?: string;
    edge?: string;
}) => unknown = ({ topX0, topX1, apex, centre = "#FBDDBB", edge = "#ED31AC" }) => {
    const id = `cone-${topX0}-${apex[1]}`;
    return ({ kind: "layer", style: { mixBlendMode: "screen" }, children: {
            kind: "vector",
            width: 1920,
            height: 1080,
            children: [{ kind: "defs", children: {
                        kind: "linearGradient",
                        id: id,
                        x1: topX0,
                        y1: "0",
                        x2: topX1,
                        y2: "0",
                        gradientUnits: "userSpaceOnUse",
                        children: [{ kind: "stop", offset: "0", stopColor: edge }, {
                                kind: "stop",
                                offset: "0.12",
                                stopColor: centre,
                                stopOpacity: "0.9"
                            }, { kind: "stop", offset: "0.5", stopColor: centre }, {
                                kind: "stop",
                                offset: "0.88",
                                stopColor: centre,
                                stopOpacity: "0.9"
                            }, { kind: "stop", offset: "1", stopColor: edge }]
                    } }, { kind: "polygon", points: `${topX0},0 ${topX1},0 ${apex[0]},${apex[1]}`, fill: `url(#${id})` }]
        } });
};
/** Pillar: a strip from the bottom edge up to topY, own-colour halo (60 px), additive. */
export const LightPillar: (props: {
    x: number;
    topY: number;
    halfW: number;
    colour: string;
    halo?: string;
}) => unknown = ({ x, topY, halfW, colour, halo = colour }) => ({ kind: "layer", style: { mixBlendMode: "screen" }, children: [{ kind: "layer", style: {
                position: "absolute",
                left: x - halfW - 60,
                top: topY,
                width: 2 * halfW + 120,
                height: 1080 - topY,
                background: `linear-gradient(to right, transparent, ${halo}55 40%, ${halo}55 60%, transparent)`,
                filter: "blur(20px)",
            } }, { kind: "layer", style: {
                position: "absolute",
                left: x - halfW,
                top: topY,
                width: 2 * halfW,
                height: 1080 - topY,
                background: colour,
                cornerRadius: halfW,
            } }] });
```

### 20. Light trails, comets and chromatic light lines · `light-trails`

Family: light, particles. Starter: pure recipe (`lib/moves.ts` math). The code adds a ring of light arcs on a canvas and a
three-colour chromatic line.

**Job.** Energy, speed, "something powerful running": light that moves through space and then resolves into the next
element (a word, a logo, a cut).

**Numbers.** Strand widths 2-18 px; additive; colour from a white-hot core to the accent to a dark tail; a chromatic
fringe offset of 1-3 px. Arcs rotate about 3 degrees per frame; comets orbit and converge on the cut; spirals draw on
clockwise, on twos.

**Presets.**

- _Light-trail ring._ About 60 arcs like long-exposure light painting: ellipse radii 520-620 x 380-460 px tilted
  -20 degrees, strokes 2-18 px, colours white, gold `#DDBA20`, dark `#5C3A05`, each arc sweeping 120-300 degrees and
  advancing 3 degrees per frame; a 12 px blurred glow copy; a 3 px cyan / magenta fringe pair; `lighter` blend.
- _Comets._ Two point-symmetric comets expand, orbit and collapse, with light-painting squiggles in the last 8 frames
  (5-7 strokes of 2 px, 40-110 px long, on a 300-600 px ring, re-seeded every frame).
- _Chromatic spiral._ One continuous light line drawn clockwise as a loose spiral around a caption: a 2-3 px white
  core, a 3 px warm / cool fringe, a tail through orange, green and blue offset 0 / 1 / 2 px.
- _Streak resolve._ Three parallel 6 px-apart light lines across 350 px resolve into a word on the next frame.
- _Roaming light._ A light roams; three curves merge into one line that draws right; a light-sweep wipe carries into the
  next scene.

**Rich.** Additive strands with a white-hot core and an accent body; a fringe of 1-3 px; motion that ends in a
convergence or a resolve.

**Cheap.** Neon loops with no destination; a glow trail on every moving prop; lines in many unrelated hues.

```ts
import { random } from "./lib/anim";
import { f30 } from "./fx-shared";
/** Ring of light arcs on a canvas ('lighter'); pure function of the frame (no state). Bake to PNGs if slow. */
export const TrailRing: (props: {
    cx?: number;
    cy?: number;
    n?: number;
}) => unknown = ({ cx = 700, cy = 540, n = 60, }) => {
    const ref = { current: document.createElement("canvas") };
    const { fps } = filmDefaults();
    const f = f30(frame, fps);
    const c = ref.current!, g = c.getContext("2d")!;
    g.clearRect(0, 0, 1920, 1080);
    g.globalCompositeOperation = "lighter";
    const draw = (dx: number, tint?: string, alpha = 1) => {
        for (let i = 0; i < n; i++) {
            const rx = 520 + 100 * random(`rx${i}`), ry = 380 + 80 * random(`ry${i}`);
            const sweep = (120 + 180 * random(`sw${i}`)) * (Math.PI / 180);
            const a0 = (random(`a${i}`) * 360 + 3 * f) * (Math.PI / 180);
            const w = 2 + 16 * Math.pow(random(`w${i}`), 3);
            const heat = random(`h${i}`);
            g.strokeStyle = tint ?? (heat > 0.8 ? "#FFFFFF" : heat > 0.35 ? "#DDBA20" : "#5C3A05");
            g.globalAlpha = alpha * (0.35 + 0.65 * heat);
            g.lineWidth = w;
            g.beginPath();
            g.ellipse(cx + dx, cy, rx, ry, (-20 * Math.PI) / 180, a0, a0 + sweep);
            g.stroke();
        }
    };
    g.filter = "blur(12px)";
    draw(0, undefined, 0.6); // the glow copy (canvas filter, Chromium)
    g.filter = "none";
    draw(-3, "#00E5FF", 0.18);
    draw(3, "#FF3DCB", 0.18);
    draw(0); // fringe copies, then the strands
    return ({
        kind: "canvas",
        ref: ref,
        width: 1920,
        height: 1080,
        style: { position: "absolute", inset: 0, mixBlendMode: "screen" }
    });
};
// Slow in software GL? Render it once to a PNG sequence at 960x540 and play it back with <Img>.
/** Chromatic line: one path stroked three times with offsets 0 / 1 / 2 px (orange, green, blue) under a white core. */
export const ChromaticPath: (props: {
    d: string;
    progress: number;
    len: number;
}) => unknown = ({ d, progress, len, }) => ({
    kind: "vector",
    width: 1920,
    height: 1080,
    style: { position: "absolute", inset: 0, mixBlendMode: "screen" },
    children: [[
            ["#E07040", 0],
            ["#3CC85A", 1],
            ["#3058D0", 2],
        ].map(([c, o]) => ({
            kind: "path",
            key: c as string,
            d: d,
            fill: "none",
            stroke: c as string,
            strokeWidth: 3,
            transform: `translate(${o},${o})`,
            strokeDasharray: len,
            strokeDashoffset: len * (1 - progress)
        })), {
            kind: "path",
            d: d,
            fill: "none",
            stroke: "#F4F8FF",
            strokeWidth: 2.5,
            strokeDasharray: len,
            strokeDashoffset: len * (1 - progress)
        }]
});
```

### 21. Stage glow behind the hero (a soft radial halo) · `stage-glow`

Family: light. Starter: pure recipe (`lib/moves.ts` math). The code adds a hopping glow and the baked dark halo.

**Job.** It lights the hero so the dark stage reads as a space and the eye goes to the lit spot; a hopping glow says
which item is active now.

**Numbers.** Radius 70-600 px; tiny on dark grounds (+5 to +12 luma at the core); it follows the hero or hops to the
active item in 2-4 f steps.

**Presets.**

- _Dark stage halo._ Stage `#090909`, under-glow `#121212` (+9 luma), centred on the hero for the whole film except a
  flash frame; the box glow is sigma 60 px at 6 %. Bake and dither it: a CSS ramp across nine code values bands.
- _Click under-glow._ `rgba(240,120,40,0.35)` with radius 500 under a click ring, living 0.9 -> 0.6 -> 0 over 12 f.
- _Hopping glow._ A radial `#FFB27A` at 40 %, radius 70 px, behind KPI cards, hopping from card to card in 2-6 f steps,
  gone 14 f later.
- _Centre lift._ Ground `#0B0D12` with a soft lighter centre `#14171E` (radius about 600 px) behind the centre line.

**Rich.** Nearly invisible (+5-12 luma), dithered, following the hero.

**Cheap.** A bright visible blob; a glow fixed at the frame centre with nothing in it.

```ts
import { at, f30 } from "./fx-shared";
/** A hopping glow: x/y tables in 30-fps frames; stepped hops are short eases between keys. */
export const HopGlow: (props: {
    x: Record<number, number>;
    y: number;
    r?: number;
    colour?: string;
    alpha?: number;
    gone?: number;
}) => unknown = ({ x, y, r = 70, colour = "#FFB27A", alpha = 0.4, gone }) => {
    const { fps } = filmDefaults();
    const f = f30(frame, fps);
    if (gone !== undefined && f > gone)
        return null;
    const cx = at(f, x);
    return ({ kind: "layer", style: {
            position: "absolute",
            left: cx - r,
            top: y - r,
            width: 2 * r,
            height: 2 * r,
            cornerRadius: "50%",
            opacity: alpha,
            background: `radial-gradient(closest-side, ${colour}, transparent)`,
        } });
};
```

### 22. 3D lighting rig (key, rim, hemisphere fill; no realtime shadows) · `light-rig-3d`

Family: 3D lighting. Starter: `fx/three/*`, `fx/KeyLight`. The code adds an extruded-mark
rig and a pull-back with a matching roll.

**Job.** It gives the hero object volume (the logo becomes a thing), and its light makes the object belong to the
film's world (the key matches the floor glow and the sweeps).

**Numbers.**

- Key from the upper left (azimuth about 315 degrees, elevation 35-50 degrees); a cool rim from the right or behind; a
  hemisphere fill at 0.6-0.9.
- Roughness 0.3-0.6, metalness 0; emissive only for the part that is alive (a figure's head, a core).
- No realtime shadows (bake contact shadows instead, see `shadows`); a screen-fixed gradient background; depth of field
  only at the extremes of a move.

**Presets.**

- _Extruded mark._ Extrude the mark's SVG paths with depth 0.35 x the arm width, a 2-3 % bevel with rounded edges
  (radius 0.08 x arm width). Coloured face `#1E56E8`, roughness 0.35, metalness 0, edge glint `#6FD3FF`; dark variant
  `#141416`, roughness 0.3, sides `#8A8A8C` / `#2A2A2C`. Key directional upper-left-front, cool rim right, hemisphere
  sky `#CFE0FF` / ground white. Background radial `#4B7BEF` -> `#9FBDF5` at 300 px -> white at 520 px. Pull-back:
  scale 1.0, 0.624, 0.456, 0.378, 0.33, 0.297, 0.287, 0.278 at 0, 3, 8, 13, 18, 23, 28, 33 f with a roll building to
  about 15 degrees, then landing in the lockup.
- _Diorama._ About 6k triangles: a lathe disc with a rounded profile, white standard material at roughness 0.6, a
  shallow bowl under it; key, rim and hemisphere fill as above.
- _Light as sprites._ Light effects as additive sprites; glass at alpha 0.35-0.75 with opaque rims; emissives blooming
  in their own colour.
- _Flat cubes._ Flat faces (`#154626`, sides `#092913`), no outlines, no ground shadows, no reflections; fast frames
  blurred by 5-sample accumulation.
- _Filmed render._ A clean 3D render seen as if filmed off a screen: a lens layer of depth bands, fringes and a screen
  grid over it.
- _Pre-rendered objects._ Phones and coins rendered once to an image sequence rather than run live in software GL.

**Rich.** One key, one rim, a soft fill; edge glints on bevels; a quiet background; a purposeful camera move (a
pull-back that lands).

**Cheap.** A default ambient plus a point light; chrome or metallic logos; an idle spinning logo; realtime shadow maps
that alias in software GL.

```ts
import { Stage3D } from "./fx/three/stage";
import { interpolate } from "./lib/anim";
import * as THREE from "three";
/** The house rig: key (upper-left-front), cool rim (right/back), hemisphere fill. No shadow maps (software GL). */
export const RefRig: () => unknown = () => ([{ kind: "hemisphereLight", args: ["#CFE0FF", "#FFFFFF", 0.75] }, {
        kind: "directionalLight",
        position: [-4, 5, 6],
        intensity: 1.6,
        color: "#FFFFFF"
    }, {
        kind: "directionalLight",
        position: [6, 1, -4],
        intensity: 0.9,
        color: "#BFD8FF"
    }]);
/** Pull-back: camera distance grows x3.6 on a log-distance ease with a matching roll (30 fps frames from the start). */
export const PullBackMark: (props: {
    start: number;
    geometry: THREE.BufferGeometry;
}) => unknown = ({ start, geometry, }) => {
    const frame = frame;
    const { fps, width, height } = filmDefaults();
    const t = Math.max(0, Math.min(1, ((frame * 30) / fps - start) / 34));
    const e = 1 - Math.pow(1 - t, 3); // close to cubic-bezier(0, .31, .4, .89) on log distance
    const dist = 4 * Math.pow(3.6, e);
    const roll = THREE.MathUtils.degToRad(17.1 * e);
    return (Stage3D({
        width: width,
        height: height,
        camera: { position: [0, 0, dist], fov: 30 },
        gl: { antialias: true },
        children: [RefRig({}), { kind: "group", rotation: [0, 0, -roll], children: { kind: "mesh", geometry: geometry, children: {
                        kind: "meshStandardMaterial",
                        color: "#1E56E8",
                        roughness: 0.35,
                        metalness: 0
                    } } }]
    }));
};
```

### 23. Shadows: elevation height, contact, tinted slab shadows · `shadows`

Family: depth, light. Starter: pure recipe (`lib/moves.ts` math). The code adds a hover shadow that converges as the element
lands, and a contact shadow.

**Job.** Height and weight: a far shadow says "above", a converging shadow says "landing", a contact shadow says
"standing here".

**Numbers.**

- Light UI: y 2-18 px, blur 6-50 px, alpha 0.04-0.12, tinted with the ground's hue (blue-grey, plum, navy).
- Dark UI: y 18-20 px, blur 24-60 px, alpha 0.35-0.5, tinted navy (`rgba(8,16,48,.35)`).
- Hover: the offset scales with height (170 px -> 13 px over 16 f as an object descends), the blur shrinking with it.
- Contact: an ellipse 0.3-0.5 x the object's width, alpha 0.5, blur 25 px, just below the object.

**Presets.**

- _Descending hero badge_ (24 fps). A raised 3D badge with a soft drop shadow far below and right descends onto the floor;
  shadow offset goes (170, 120), (140, 147), (133, 133), (70, 90), (20, 40), (13, 33) px over 16 f as it lands; on
  contact it squashes to 0.88.
- _Object on a desk._ `rgba(0,0,0,0.35)`, blur 30 px, offset 40 px down-right.
- _Contact under a title._ A soft dark ellipse about 520 x 70 px centred 55 px below the title centre, black at 0.5,
  blur 25 px.
- _Tinted badge._ Shadow in the brand blue at 25 %, blur 12 px, offset 6 px down-right; a phone at 25 %, blur 20,
  offset 8 down.
- _Plain lifted prop._ Offset (12, 22), blur 20, `rgba(0,0,0,0.16)`.
- _Card stacks._ `0 18px 50px rgba(40,80,120,.08), 0 6px 18px rgba(60,100,140,.06)` on pale blue; `0 18px 40px
rgba(60,70,160,.12)` on periwinkle.

**Rich.** Tinted with the ground hue, very low alpha, the offset proportional to height; converging on landing;
contact shadows under objects on light floors.

**Cheap.** A grey `rgba(0,0,0,.3)` on everything; the same shadow at every height; text shadows.

```ts
import { at, f30 } from "./fx-shared";
/** Hover: offset and blur shrink as the element descends; height h in 0..1 (1 = high). */
export const hoverShadow = (h: number, tint = "rgba(60,70,90,0.28)") => {
    const dx = 13 + 157 * h, dy = 33 + 107 * h, blur = 8 + 30 * h;
    return `drop-shadow(${dx}px ${dy}px ${blur}px ${tint})`;
};
// Descent at 30 fps over 20 f: h = at(t, {0: 1, 5: 0.88, 11: 0.8, 16: 0.42, 19: 0.05, 20: 0})
/** Contact shadow under a moving element. */
export const ContactShadow: (props: {
    cx: number;
    y: number;
    w?: number;
    h?: number;
}) => unknown = ({ cx, y, w = 520, h = 70, }) => ({ kind: "layer", style: {
        position: "absolute",
        left: cx - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        cornerRadius: "50%",
        background: "#000",
        opacity: 0.5,
        filter: "blur(25px)",
    } });
/** Tinted light-UI card shadows (two layers, ground hue). */
export const cardShadow = (hueRgb = "40,80,120") => `0 18px 50px rgba(${hueRgb},.08), 0 6px 18px rgba(${hueRgb},.06)`;
```

### 24. Colour-front sweep through type (gradient fill sweep) · `colour-front-sweep`

Family: gradient, type. Starter: pure recipe (`lib/moves.ts` math). The code adds a heat entry (a five-stop gradient
sliding through the word) and a front with a hot leading band.

**Job.** It marks the newest word with the accent and then lets it settle into the sentence: the eye follows the colour
front through the line.

**Numbers.** The front is 0.3-1 word wide; 6-25 f; the settle from accent to ink takes 3-9 f. Fronts carry a hot band
ahead of the final colour (orange-peach ahead of white; gold ahead of black).

**Presets.**

- _Write and sweep_ (25 fps). The title writes on left to right in a coral-to-pink gradient over 11 f, then a white
  front sweeps left to right through it over 20 f with a warm band ahead of the white.
- _Ink to white._ The fill becomes a horizontal white -> black gradient whose stop slides right over 5 f (24 fps).
- _Outline then fill._ The title outline writes on, then a fill sweep follows.
- _Palette ink._ A word written in an eight-stop ink (`#F7D34C` `#F1A051` `#E6606B` `#A3BA67` `#78A69A` `#407CD0`
  `#25549E` `#1A1B1E`) that resolves to the last, darkest stop.
- _Born in the accent._ Words are born blue and settle to ink; the accent word stays blue.
- _Heat entry_ (seven frames). A five-stop gradient across the word slides left, the dark end on the right: frame 0
  `transparent transparent #F8D794 #EEA653 #CC6E56`; frame 1 `transparent #F8DA99 #F1AA55 #CB715D #80374C`; frame 2
  `#F6C16B #E18650 #A14756 #461A2B #110509`; frame 3 `#D77B54 #8E3D50 #2E111B #030102 #000`; frame 4 `#AA5258 #521F34
#0F080B #000 #000`; frame 5 `#6D2C43 #1E0A12 #000 #000 #000`; frame 6 all black.

**Rich.** A front with a hot leading band and a settle; colours from the palette; the sweep following reading or
motion.

**Cheap.** A rainbow gradient left on the text; every word animating its colour.

```ts
import { f30 } from "./fx-shared";
/** Heat entry: the word's fill is a 5-stop gradient from the table; step u = frame since entry (0..6). */
const HEAT = [
    ["transparent", "transparent", "#F8D794", "#EEA653", "#CC6E56"],
    ["transparent", "#F8DA99", "#F1AA55", "#CB715D", "#80374C"],
    ["#F6C16B", "#E18650", "#A14756", "#461A2B", "#110509"],
    ["#D77B54", "#8E3D50", "#2E111B", "#030102", "#000000"],
    ["#AA5258", "#521F34", "#0F080B", "#000000", "#000000"],
    ["#6D2C43", "#1E0A12", "#000000", "#000000", "#000000"],
];
export const HeatWord: (props: {
    start: number;
    text: string;
    style: Record<string, string | number | undefined>;
}) => unknown = ({ start, text, style, }) => {
    const { fps } = filmDefaults();
    const u = Math.floor(f30(frame, fps) * (23.976 / 30) - start * (23.976 / 30)); // table is per 23.976 fps frame
    if (u < 0)
        return null;
    if (u >= 6)
        return { kind: "layer", style: { ...style, color: "#000" }, children: text };
    return ({ kind: "layer", style: {
            ...style,
            backgroundImage: `linear-gradient(to right, ${HEAT[u].join(", ")})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
        }, children: text });
};
```

### 25. Pixel mosaic and blocky reveals · `pixel-mosaic`

Family: mask, texture. Starter: pure recipe (`lib/moves.ts` math). The code adds a structured block reveal
with seeded ragged fronts and a progressive image load on twos.

**Job.** "Digital, generated, loading": the picture assembles from data. It also works as a brand-coloured wipe.

**Numbers.** Blocks 10-30 px (house cells 14-24 px); steps on twos; 3-25 f; ragged fronts from seeded per-block
thresholds; diamond or ring orders from a centre; the palette's accent as the block colour.

**Presets.**

- _Diamond reveal._ A photo revealed through square cells (14.5-16 px) in diamond rings from a centre; the cells settle
  with a small spring of 120, 40, 37, -19, -19, 11, 0 px offsets.
- _Accent wipe_ (60 fps). A 30 px mosaic wipe in the accent and near-black sweeps left to right with a ragged front and
  covers the frame.
- _Stair wipe_ (25 fps). Grey 24 px blocks from the top-left, on twos, with a ragged front and a tinted fringe.
- _Element mosaic._ A nearest-neighbour upscale of a 1/b downscale inside the element's box (+16 px around text, +40 px
  when its background is included); text blocks binarised at 0.45.
- _Blocky deal._ A new photo card dealt on top every 8 f through a 3-frame dissolve of 10 px blocks whose threshold is
  seeded noise.
- _Progressive load_ (on twos). A picture starts as a 6 px dot, each size held 2 frames, warm and low-res -> final in
  12 f.
- _Mosaic ring iris._ See `iris`.

**Rich.** Block size tied to the layout grid; seeded ragged fronts; on twos; a structured order (rings, diagonals,
reading order).

**Cheap.** A CSS pixelate filter on the full frame; random per-frame noise blocks; blocks aligned to nothing.

```ts
import { random } from "./lib/anim";
import { f30 } from "./fx-shared";
/** Mosaic wipe: blocks of `cell` px switch on when progress passes their seeded threshold; order = left->right with a ragged front. */
export const MosaicWipe: (props: {
    start: number;
    frames?: number;
    cell?: number;
    colour?: string;
    order?: "ltr" | "ring";
    cx?: number;
    cy?: number;
}) => unknown = ({ start, frames = 20, cell = 30, colour = "#B8F03A", order = "ltr", cx = 960, cy = 540 }) => {
    const { fps } = filmDefaults();
    const raw = (f30(frame, fps) - start) / frames;
    const p = (Math.floor((raw * frames) / 2) * 2) / frames; // on twos
    if (raw <= 0)
        return null;
    const cols = Math.ceil(1920 / cell), rows = Math.ceil(1080 / cell);
    const cells: unknown[] = [];
    const maxD = Math.hypot(1920, 1080) / 2;
    for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
            const base = order === "ltr" ? i / cols : Math.hypot(i * cell - cx, j * cell - cy) / maxD;
            const th = base * 0.82 + 0.18 * random(`m${i}-${j}`); // ragged front
            if (p >= th)
                cells.push({ kind: "layer", key: `${i}-${j}`, style: {
                        position: "absolute",
                        left: i * cell,
                        top: j * cell,
                        width: cell,
                        height: cell,
                        background: colour,
                    } });
        }
    return { kind: "layer", children: cells };
};
```

### 26. Lens distortion: barrel bulge and fisheye · `lens-distortion`

Family: lens, distortion. Starter: `fx/Barrel`. The code adds a barrel warp whose strength is driven per
frame and keeps overlays straight.

**Job.** A lens is physical: a bulge on a push makes the move feel like a real camera rushing in; a fisheye says "an old
screen, surveillance, too much".

**Numbers.** `r' = r (1 + k r^2)` with r normalised to the half-diagonal. k 0.01-0.06 for a push accent (it peaks for
about 8 f, then releases); k 0.18 for a fisheye screen look; edges bow 14-25 % of the frame. Always on a push or a
scale-up; foreground HUD / title overlays stay undistorted.

**Presets.**

- _Push bulge._ k = 0.01, 0.03, 0.05, 0.06 over the first 6 f, held to frame 14, then 0.04, 0.02, 0 over 4 f; the edges
  bow about 14 px.
- _UI out of a bulge._ The whole UI scales up out of a lens bulge: barrel strong for 4 f and gone 6 f later, while the
  card grows 552 -> 776 -> 960 -> 1100 -> 1168 -> 1208 -> 1240 -> 1290 px wide over 42 f (a 25 px liquid bulge at the
  start).
- _Fisheye screen._ k = +0.18 over everything except the 4 px scanlines, edges stretched about 25 %.
- _Bowed grid._ A dashed grid drawn bowed, as if seen through the same lens.

**Rich.** A small k that peaks with the push and releases; foreground titles kept straight.

**Cheap.** A permanent fisheye; distortion on text that must be read; warps without a camera move.

```ts
/**
 * Barrel warp with feDisplacementMap. The map encodes the per-pixel source offset for k = 1:
 *   offset = (p - c) * (1/(1 + r^2) - 1)  (sample nearer the centre -> content bulges outward)
 * feDisplacementMap: P'(x,y) = P(x + s*(R-0.5), y + s*(G-0.5)); drive s linearly with k (small-k approximation).
 */
const useBarrelMap = (W = 480, H = 270) => (() => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!, img = g.createImageData(W, H);
    const half = Math.hypot(W / 2, H / 2), maxOff = 0.5 * half; // normalisation for the scale
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const dx = x - W / 2, dy = y - H / 2, r = Math.hypot(dx, dy) / half;
            const f = 1 / (1 + r * r) - 1; // k = 1
            const o = (y * W + x) * 4;
            img.data[o] = 128 + 127 * ((dx * f) / maxOff);
            img.data[o + 1] = 128 + 127 * ((dy * f) / maxOff);
            img.data[o + 2] = 0;
            img.data[o + 3] = 255;
        }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
})();
export const BarrelWarp: (props: {
    k: number;
    id?: string;
    children: unknown;
}) => unknown = ({ k, id = "barrel", children, }) => {
    const map = useBarrelMap();
    const s = k * 2 * 0.5 * Math.hypot(960, 540); // map units -> px at 1920x1080 (maxOff scaled up x4)
    if (k <= 0.001)
        return { kind: "layer", children: children };
    return ({ kind: "layer", children: [{
                kind: "vector",
                width: 0,
                height: 0,
                style: { position: "absolute" },
                children: {
                    kind: "filter",
                    id: id,
                    x: "0",
                    y: "0",
                    width: "100%",
                    height: "100%",
                    colorInterpolationFilters: "sRGB",
                    children: [{
                            kind: "feImage",
                            href: map,
                            x: "0",
                            y: "0",
                            width: "1920",
                            height: "1080",
                            preserveAspectRatio: "none",
                            result: "m"
                        }, {
                            kind: "feDisplacementMap",
                            in: "SourceGraphic",
                            in2: "m",
                            scale: s,
                            xChannelSelector: "R",
                            yChannelSelector: "G"
                        }]
                }
            }, { kind: "layer", style: { filter: `url(#${id})` }, children: children }] });
};
```

### 27. Echo and ghost copies (stamps, ghosting, doubled frames) · `echo-copies`

Family: motion, texture. Starter: pure recipe (`lib/moves.ts` math). The code adds jump-echo stamps with an age rule and a short ghosting
burst.

**Job.** It shows a path and speed in stop-motion terms (stepped, graphic) and makes a word arrive with force.

**Numbers.** 1-5 copies; opacity by age 1.0 -> 0.20 over 4-5 frames (-0.2 per frame); offsets 6-40 px; no blur on
stamps, a 15 px blur on ghosting.

**Presets.**

- _Jump-echo stamps._ Every position a word leaves stays as a copy that fades about 50 luma per frame: opacity by age
  1.0, 0.81, 0.61, 0.41, 0.20, 0; no blur.
- _Echo behind._ A second copy 30-40 px behind (to the left) at 45 % with an 8 px RGB split; a doubled frame offset
  8 px at 60 % for two frames.
- _Ghosting on a spring._ Frames 1-3 of a fast spring show two copies offset 6 px at 50 % plus a 15 px horizontal blur.
- _Vertical echo._ Rising words doubled by a faint vertical echo.
- _Accumulated copies._ See `motion-blur` (3-4 or 12-16 stacked copies).

**Rich.** A strict age rule, few copies, on stepped motion only.

**Cheap.** Trails behind every move; copies that never fade.

```ts
/** Stamps: positions[k] = where the live word was k frames ago (k = 0 live). Opacity by age, no blur. */
const AGE = [1.0, 0.81, 0.61, 0.41, 0.2];
export const Stamps: (props: {
    positions: [
        number,
        number
    ][];
    children: unknown;
}) => unknown = ({ positions, children, }) => ([positions.slice(0, AGE.length).map(([x, y], k) => ({
        kind: "layer",
        key: k,
        style: { position: "absolute", left: x, top: y, opacity: AGE[k] },
        children: children
    }))]);
```

### 28. Chromatic aberration and RGB split · `chromatic-aberration`

Family: lens, distortion. Starter: `fx/Fringe`. The code adds a radial lens split and a lateral split.

**Job.** It says "a real lens, a real screen, a real signal", or marks glass and light as optical.

**Numbers.**

- Lens: 1 / 3 / 7 px (centre / mid-frame / corner), channel scales 1.000 / 1.0015 / 1.003, red outward and blue inward.
- Stylised lateral: 1.5-10 px on figures and type for short windows; 20-30 px for an offline holographic treatment.
- Edge fringes on glass and light: 1-3 px.

**Presets.**

- _Lens layer._ A radial split about 1 px at the centre, 3 px mid-frame, 6-8 px at the corners, visible as cyan / red
  edges on bright contours; fixed to the frame.
- _Figures and crowds._ Red outline +6 px left, cyan -6 px right on a walking figure; 2-10 px on silhouettes, growing
  with figure size; 2-4 px on light lines; 1.5 px on a caption; never on the ground.
- _Holographic treatment_ (offline). Red shifted +25 px, blue -25 px, a 15-30 px blur and a five-stop gradient map
  (`#2B2E8C` `#1E7A78` `#E2457E` `#F07A5A` `#E8D8F0`).
- _Light ring fringe._ Two thin cyan / magenta copies of a light ring offset 3 px.
- _Glass edge fringe._ 1 px mint / pink on glass edges; a faint red / blue fringe on a 3D mark's silhouette only.

**Rich.** Radial (growing toward the corners), small (3 px or less over most of the frame), tied to a lens look or to
glass edges.

**Cheap.** A constant lateral RGB split over the whole frame; fringes on body text; glitch fringes without a reason.

```ts
/** Radial CA: R and B channel copies scaled about the centre (1.003 / 1.0015 / 1.0), screen-combined over black. */
export const RadialCA: (props: {
    amount?: number;
    children: unknown;
}) => unknown = ({ amount = 1, children, }) => {
    const ch = (m: string, s: number) => ({ kind: "layer", style: { transform: `scale(${1 + (s - 1) * amount})`, mixBlendMode: "screen" }, children: { kind: "layer", style: { filter: `url(#ca-${m})` }, children: children } });
    return ({ kind: "layer", style: { background: "#000", isolation: "isolate" }, children: [{
                kind: "vector",
                width: 0,
                height: 0,
                style: { position: "absolute" },
                children: [{ kind: "filter", id: "ca-r", children: { kind: "feColorMatrix", type: "matrix", values: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" } }, { kind: "filter", id: "ca-g", children: { kind: "feColorMatrix", type: "matrix", values: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" } }, { kind: "filter", id: "ca-b", children: { kind: "feColorMatrix", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" } }]
            }, ch("r", 1.003), ch("g", 1.0015), ch("b", 1.0)] });
};
```

### 29. Grain (off by default; sigma 1.2-3 when used) · `grain`

Family: finish. Starter: `brand/tokens.ts` (`TEXTURES.grain`, `sigma` 6: two to five times too strong; set 1.5-2.5 and
leave it off unless the film needs it) and `film-stage/grade.ts` TPDF dither.

**Job.** Mostly technical: it stops banding on dark ramps and ties CG to photographic plates. On paper or editorial
films it is the material of the paper.

**Numbers.** Sigma 1.2-3 on 0-255 globally (6 only on a single photo shot); opacity 3-6 % in overlay builds; grain size
1-1.5 px; re-seeded every frame or every second frame.

**Presets.**

- _Anti-banding._ Fine luma noise sigma 1.2, static per frame (seeded), on everything; it keeps dark ramps from banding.
- _Editorial._ Monochrome sigma about 2.5 % luma, 1 px, re-seeded every second frame; on paper scenes add a faint fibre
  noise (`feTurbulence` base frequency 0.02 / 0.6, opacity 3 %).
- _Lilac ground._ Sigma about 2.5 levels from a pre-rendered 512 px tile in overlay at 6 %, a new offset every frame.
- _Footage._ Monochrome sigma about 3 in the darks, re-seeded every frame, overlay 0.06: on held frames it is the only
  thing that changes.
- _Light film grain._ Opacity 0.04 with a new seed every frame; a cream paper ground with a 2 % contrast texture.
- _Scoped grain._ Sigma 3, 1.5 px, on one coloured stage only.
- _Local grain._ A photo inset at sigma 6 for its own shot; an anime inset at 6 %.

**Rich.** Invisible at a glance (sigma 1-3), monochrome, seeded per frame, on dark ramps or paper only.

**Cheap.** Visible film-grain overlays; colour noise; grain on a clean digital 3D motion film.

```ts
import { random } from "./lib/anim";
import { f30, gauss } from "./fx-shared";
/** Grain: one 512 px Gaussian tile made once; per frame a seeded offset; overlay at `opacity`. Measure: a flat patch's std ≈ target σ. */
export const Grain: (props: {
    opacity?: number;
    every?: number;
    tileSigma?: number;
}) => unknown = ({ opacity = 0.06, every = 1, tileSigma = 40, }) => {
    const { fps } = filmDefaults();
    const step = Math.floor(f30(frame, fps) / every);
    const url = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 512;
        const g = c.getContext("2d")!, img = g.createImageData(512, 512);
        for (let i = 0; i < 512 * 512; i++) {
            const v = Math.max(0, Math.min(255, 128 + tileSigma * gauss(`g${i}`)));
            img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
            img.data[4 * i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        return c.toDataURL();
    })();
    const ox = Math.floor(random(`gx${step}`) * 512), oy = Math.floor(random(`gy${step}`) * 512);
    return ({ kind: "layer", style: {
            backgroundImage: `url(${url})`,
            backgroundPosition: `${ox}px ${oy}px`,
            mixBlendMode: "overlay",
            opacity,
            pointerEvents: "none",
        } });
};
```

### 30. Halftone, dither, dot screens and screen grids · `halftone-screens`

Family: texture. Starter: pure recipe (`lib/moves.ts` math). The code adds a 1-bit halftone, a difference
dot screen clipped to type, and a frame-fixed screen grid.

**Job.** It turns a photo into print, data or a screen: the picture becomes graphic and brand-coloured, and a screen
grid says "this is a display being filmed".

**Numbers.** Dots 3-10 px on a 6-24 px pitch; screen grids 4-8 px; opacity 0.2-0.35; 1-bit on a brand colour for the
halftone look; fixed to the frame.

**Presets.**

- _1-bit halftone._ A cloud photo rendered as 1-bit dots on a sky accent `#59C9F6`.
- _Ring-dot dither_ on a figure's outline for 16 f (strong, then faint), and a two-frame dither flare.
- _Halftone burst._ An accent halftone annulus expands and fades around a click (with the click ring of `element-glow`).
- _Halftone crowd._ Five halftone silhouettes; after a flip their dots turn near-white blue (`#5A9CFF`-`#BFE0FF`).
- _Difference screen._ A dot grid on black; a copy of the grid in `difference` blend clipped to the title's white ink, so
  dark dots show inside the letters.
- _Screen grid._ A 7.75 px repeating grid of 1.5 px lines, `#8A7F96` at 0.22, `multiply`, fixed to the frame.
- _Dot field._ 3 px dots on a 24 px pitch at 0.35.

**Rich.** 1-bit on one brand colour; the grid fixed to the frame; dots tied to a layout pitch.

**Cheap.** A halftone filter over a whole film; moiré from a grid rendered at the wrong scale.

```ts
/** Screen grid: frame-fixed, multiply, 7.75 px period, 1.5 px lines. Render at full 1920 width. */
export const ScreenGrid: (props: {
    period?: number;
    line?: number;
    colour?: string;
    opacity?: number;
}) => unknown = ({ period = 7.75, line = 1.5, colour = "#8A7F96", opacity = 0.22 }) => ({ kind: "layer", style: {
        mixBlendMode: "multiply",
        opacity,
        pointerEvents: "none",
        backgroundImage: `linear-gradient(to right, ${colour} ${line}px, transparent ${line}px), linear-gradient(to bottom, ${colour} ${line}px, transparent ${line}px)`,
        backgroundSize: `${period}px ${period}px`,
    } });
/** A dot grid copy in difference blend, clipped to the title (put the title text in the mask). */
export const DotScreenInType: (props: {
    text: string;
    style: Record<string, string | number | undefined>;
    pitch?: number;
}) => unknown = ({ text, style, pitch = 18 }) => ({ kind: "layer", style: {
        ...style,
        position: "absolute",
        color: "transparent",
        mixBlendMode: "difference",
        backgroundImage: `radial-gradient(circle, #FFFFFF 2px, transparent 2.5px)`,
        backgroundSize: `${pitch}px ${pitch}px`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
    }, children: text });
```

### 31. Knockout and type as a window (blend and clip effects) · `knockout-clip`

Family: mask, blend. Starter: pure recipe (`lib/moves.ts` math). The code adds a soft moving knockout,
picture-in-text and text behind a subject.

**Job.** It binds type and picture into one object (the word is made of the product's world; the subject stands in front
of the word), which makes the frame feel designed rather than layered.

**Numbers.** Knockouts follow a moving soft shape (a blob's alpha); picture-in-text on 1-3 rows; behind-subject cutouts
with a 2-3 px light outline for the first 2-3 f.

**Presets.**

- _Blob knockout._ A soft blob slides under the text from the right over 13 f; the text is knocked out to white by the
  blob's alpha, with a soft white glow (blur 6 px, 40 %).
- _Difference screen in type._ See `halftone-screens`.
- _Picture in text._ `background-clip: text` with the campaign picture, three rows over 5 f.
- _Text behind the subject._ A cutout of the subject (prepared offline) stands in front of the word, with a 2-3 px light
  outline on its first 2-3 frames.
- _Words behind an object._ Big words pass behind a 3D phone in opposite directions.
- _Tint bands in type._ Gradient bands through text with `background-clip: text`; a designed permanent blur on the right
  40 % of one word.

**Rich.** A clean cutout, a soft moving knockout, the outline only on the first frames.

**Cheap.** Picture-in-text with a busy photo that kills legibility; a hard rectangular knockout.

```ts
/** Knockout: inside the blob, the text turns white (a white copy masked by the blob's alpha), with a soft glow. */
export const BlobKnockout: (props: {
    text: string;
    style: Record<string, string | number | undefined>;
    blobX: number;
    blobY: number;
    blobR: number;
}) => unknown = ({ text, style, blobX, blobY, blobR }) => {
    const m = `radial-gradient(circle at ${blobX}px ${blobY}px, #000 ${blobR * 0.6}px, transparent ${blobR}px)`;
    return ([{ kind: "layer", style: { ...style, position: "absolute" }, children: text }, { kind: "layer", style: {
                ...style,
                position: "absolute",
                color: "#FFFFFF",
                WebkitMaskImage: m,
                maskImage: m,
                filter: "drop-shadow(0 0 6px rgba(255,255,255,0.4))",
            }, children: text }]);
};
```

### 32. Final soften (a global 0.6 px blur) · `final-soften`

Family: finish. Starter: `scripts/probe.py` post pass (an ffmpeg `gblur` after the render, never CSS).

**Job.** It removes the vector-perfect edge so CG UI reads as filmed rather than screenshotted.

**Numbers.** 0.5-0.6 px at 1080p, the whole frame, every frame; never above 0.8 px.

**Rich.** Barely visible: it fixes shimmer on thin lines and hairline aliasing.

**Cheap.** More than about 0.8 px (the film looks out of focus).

```bash
# after the render, before the mux (CPU only):
ffmpeg -y -i picture.mp4 -vf "gblur=sigma=0.6" -c:v libx264 -crf 14 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 picture_soft.mp4
```

### 33. Vignette (only as a lens or a content shape) · `vignette`

Family: finish, lens. Starter: pure recipe (`lib/moves.ts` math).

**Job.** A lens vignette belongs to a footage or filmed look; a content vignette (a shape of colour) frames the line of
type.

**Numbers.** Lens: -20 to -35 % at the corners, clear to 55 % of the half-diagonal; tinted with the ground on coloured
stages. In a clean 3D motion film: none, or 2 % at most.

**Presets.**

- _Light lens._ Corners about 22 % darker than the centre on a light ground (centre `#D4D3D8`, corner `#9697A1`).
- _Footage lens._ Radial from the centre, clear to 55 % of the half-diagonal, -35 % at the corners.
- _Tinted stage._ Radial and tinted with the stage (`#4F705E` top-left, `#5E8971` top-right, `#5B856F` bottom), fixed to
  the screen.
- _Paper._ None measurable; a 2 % radial darkening at most.
- _Content vignettes._ A blob ring of colour around the line (see `mesh-gradient`); a faint dark-blue ring around the
  centre during a selection.

**Rich.** Tinted with the ground, clear over the middle 55 %, only in lens-look films.

**Cheap.** A black radial vignette on a clean 3D motion film.

```ts
/** Lens vignette: clear to 55 % of the half-diagonal, −35 % at the corners; tint = a darker ground colour (bake it for dark films). */
export const LensVignette: (props: {
    rgb?: string;
    strength?: number;
}) => unknown = ({ rgb = "0,0,0", strength = 0.35, }) => ({ kind: "layer", style: {
        pointerEvents: "none",
        background: `radial-gradient(circle 1101px at 960px 540px, rgba(${rgb},0) 55%, rgba(${rgb},${strength}) 100%)`,
    } });
```

### 34. Reflections (rare, always physical) · `reflections`

Family: light, material. Starter: pure recipe (`lib/moves.ts` math).

**Job.** It puts an object on a floor (it stands somewhere) and makes glass read as glass. The first reflection to reach for is
a specular highlight on a rim (see `light-sweep`), not a mirror.

**Numbers.** Floor reflections at 0.15-0.3 opacity, fading over 30-40 % of the object's height, blurred 2-4 px; inner
reflection rims 1 px, 40 px inside the edge.

**Presets.**

- _Neon floor._ A glass cube stands on a neon horizon, reflected below it on a near-black floor with a faint reflection
  of the band.
- _Rim highlight._ A glossy black product whose rim highlight is a thin bright arc.
- _Wet ground._ A walking figure reflected on wet sand (photographic).
- _Chart reflection._ A chart faintly reflected on the floor below.

**Rich.** Faint, fading, slightly blurred, only on glossy floors.

**Cheap.** A full-strength mirror copy under every card (the glossy floor of old web pages).

```ts
/** Floor reflection: a mirrored copy under the object, fading over 35 % of its height, blurred 3 px, at 0.22. */
export const FloorReflection: (props: {
    h: number;
    children: unknown;
}) => unknown = ({ h, children, }) => ({ kind: "layer", style: {
        position: "absolute",
        top: h,
        left: 0,
        right: 0,
        height: h,
        transform: "scaleY(-1)",
        transformOrigin: "top",
        opacity: 0.22,
        filter: "blur(3px)",
        WebkitMaskImage: "linear-gradient(to top, #000 0%, transparent 35%)",
        maskImage: "linear-gradient(to top, #000 0%, transparent 35%)",
    }, children: children });
```

### 35. Scan-line smear, row smear and displaced edges · `smear-displace`

Family: distortion, texture. Starter: pure recipe (`lib/moves.ts` math). The code adds a seeded scan-line smear and a
displaced marker edge.

**Job.** "Signal, transmission, memory": a picture breaks into scan lines at a cut. On strokes, displacement gives a
hand-made edge. Only in a film about signal; otherwise the house no-glitch rule applies.

**Numbers.** 1-2 frame bursts, or 3-14 f; strips 8-40 px; smear runs 40-120 px; displacement scale about 9 px on stroke
edges.

**Presets.**

- _Scan-line smear._ Cut the frame into about 25 horizontal strips of 8-40 px (seeded) and stretch each sideways for 2
  frames, colour-mapped to the palette (`#08304E` at 0, `#3FA0D8` at 0.4, `#7FE6F2` at 0.7, `#E8FBFF` at 1).
- _Row smear_ (offline). Horizontal streaks on 10-25 % of the rows (a running maximum over 40-120 px, like a pixel sort)
  on a few cuts.
- _Ragged marker edge._ One edge of a marker stroke displaced: `feTurbulence` base frequency 0.09 / 0.35 (along /
  across), 2 octaves, a seed per stroke, `feDisplacementMap` scale 9 on that edge only.
- _Block break._ A block-glitch transition between two liquid-gradient scenes (8 f).
- _Scanlines._ 4 px lines on a fisheye screen (see `lens-distortion`).

**Rich.** 1-2 frames on a cut, colour-mapped to the palette, seeded; displacement on one edge of a stroke only.

**Cheap.** A looping glitch; RGB noise blocks; glitch as decoration.

```ts
import { random } from "./lib/anim";
/** Scan-line smear: strips that show one pixel row stretched across, colour-mapped. `src` = a still of the plate. */
export const ScanSmear: (props: {
    src: string;
    seed?: string;
}) => unknown = ({ src, seed = "smear" }) => {
    const strips: unknown[] = [];
    let y = 0, i = 0;
    while (y < 830) {
        const h = 8 + Math.floor(32 * random(`${seed}h${i}`));
        const x0 = 400 + Math.floor(1400 * random(`${seed}x${i}`)); // the pixel column that streaks across the strip
        strips.push({
            kind: "layer",
            key: i,
            style: {
                position: "absolute",
                left: 0,
                top: y,
                width: 1920,
                height: h,
                overflow: "hidden",
            },
            children: { kind: "layer", style: {
                    position: "absolute",
                    left: 0,
                    top: -y,
                    width: 1920,
                    height: 1080,
                    backgroundImage: `url(${src})`,
                    backgroundSize: "1920px 1080px",
                    transform: `scaleX(1920)`,
                    transformOrigin: `${x0}px 0`,
                } }
        });
        y += h;
        i++;
    }
    return ({ kind: "layer", style: { background: "#000", filter: "url(#cyan-map)" }, children: strips });
};
```

---

## Checking a build against these numbers

Measure on rendered frames (CPU tools such as OpenCV and numpy, through the project's heavy-job wrapper).

- **Blur and defocus:** the Laplacian variance (sharpness) of a fixed box per frame; a focus pull reads as a curve such
  as 134, 81, 98, 102, 133, 297 (a snap), an end defocus as 39, 21, 16. Match the curve's shape within +/-20 %.
- **Motion blur:** the streak length along the motion is 0.5 x the per-frame displacement at 180 degrees; measure the run
  of pixels above half the element's contrast along its path.
- **Glows:** the mean B-R (or the hue channel) in a ring 4-20 px outside the ink, per frame.
- **Light sweep:** the area of near-white pixels (min(R, G, B) > 215) on the object per frame; it should rise and fall
  once.
- **Floor glow:** colour samples at fixed points per frame; delta E under 3 against the plan.
- **Iris:** the extent of non-ground pixels per frame against the shares 0.37, 0.65, 0.79, 0.86, 1.
- **Particles:** the count of components per frame (one more every 2 f) and the extent of the field.
- **Grain:** the standard deviation of a flat 200 x 200 patch on a held frame (target 1.2-3).
- **Flashes:** the frame mean luma (a single frame near 237-255, then the next shot).
