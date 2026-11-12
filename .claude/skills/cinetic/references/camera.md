# Camera

The camera moves with a purpose or not at all. It is still unless a shot declares a move: a push that closes on the
thing that changes, a track that follows what travels, a pull that reveals the whole, a whip or a carried cut, each one
starting, travelling and landing on an eased curve. No float, no drift, no idle push: a camera that pans one way and back
for no reason reads as aimless, and holds may be completely still while the product changes in them. This page covers
the world transform, the anchor camera (`src/lib/camera.ts`), the moves (`src/lib/camera-moves.ts`), snap zooms and
defocus (`fx/SnapZoom`, `fx/RackFocus`, `lib/defocus.ts`), footage speed ramps, holds, depth, 3D perspective,
framing and speed. Read it before building any act where the frame moves, and when a shot feels locked-off, floaty or
seasick.

Everything is a pure function of the frame: a move takes framings and returns a `ShotFn`, `(f) => Shot`, defined for
any frame (fractional frames included, so motion-blur sub-samples, scrubbing and any render order agree), and moves
nest: a move's output is a valid input to the next move. Numbers are 60 fps frames (`f@60`) unless they say otherwise;
every function takes `fps` or reads the film context.

**Contents**

1. [One world transform, one camera](#1-one-world-transform-one-camera)
2. [The anchor camera](#2-the-anchor-camera)
3. [The moves](#3-the-moves)
4. [Snap zoom and the defocus pulse](#4-snap-zoom-and-the-defocus-pulse)
5. [Rack focus and defocus levels](#5-rack-focus-and-defocus-levels)
6. [Footage that breathes](#6-footage-that-breathes)
7. [Holds may be still; moves have a purpose; speed carries through cuts](#7-holds-may-be-still-moves-have-a-purpose-speed-carries-through-cuts)
8. [Depth: three planes, parallax, occlusion](#8-depth-three-planes-parallax-occlusion)
9. [3D, perspective and axes](#9-3d-perspective-and-axes)
10. [Choosing a move for a beat](#10-choosing-a-move-for-a-beat)
11. [Framing, legibility and speed](#11-framing-legibility-and-speed)
12. [Blur policy](#12-blur-policy)
13. [The depth camera math (fx/depth)](#13-the-depth-camera-math-fxdepth)

**Depth comes from a designed 3D shot**, not from a card tilted on a flat ground: a camera with a lens, standing
somewhere in 3D space (`film-stage/camera.ts`, `fx/three/stage.ts`, `fx/depth`), looking across foreground, hero and
background depths with graded depth of field, making one move that starts, travels with its subject and lands.

---

## 1. One world transform, one camera

- Lay the stage out **once, in its own world coordinates**, and move it with **one camera pose or matrix**. Geometry never
  reflows, screen-space callouts project cleanly onto it, and both sides of a seam share identical projection math.
- **All translation lives inside the continuous transform.** Rounding offsets separately from scale or rotation snaps slow
  drifts into 1 px stairs (`frame-left-top`). Keep continuous float coordinates all the way into WebGL / Canvas2D matrices.
- **Write the film's camera as one function** and evaluate every shot through it:
  ```ts
  const cam = (f: number): Shot => (f < CUT_A ? opening(f) : f < CUT_B ? middle(f) : ending(f));
  const pose = camera(cam(f)); // apply StagePose to the Three.js rig or 2D overlay canvas
  ```
- Each depth plane gets its own independent transform (`parallax()`), never an ad-hoc rounded integer offset.
- Big zooms on type: rasterise high-DPI SDF/Canvas2D plates at peak scale and scale down, or extrude vector outlines
  (`scripts/outline-text.py`, `fx/three/geo.ts`); scaling up a low-res bitmap goes soft.

## 2. The anchor camera

Describe a framing the way a director does: _this point of the world sits there on screen, this big._

```ts
// src/lib/camera.ts (abridged)
export type Shot = {
  ax: number;
  ay: number; // world point that is framed ...
  sx: number;
  sy: number; // ... at this screen point
  k: number; // scale (world units -> screen px)
  yaw?: number;
  pitch?: number;
  roll?: number; // degrees; roll stays rigid, outside the tilt
};
export declare const lc: (A: Shot, B: Shot, t: number) => Shot; // anchors and angles linear, k in log space
export declare const camera: (s: Shot, perspective?: number) => StagePose; // pure numeric 3D stage pose
export declare const toScreen: (s: Shot, p: { x: number; y: number }) => { x: number; y: number };
export declare const dip: (t: number, depth?: number) => number; // 1 - depth * sin^2(pi t): a hop out through a whip
export declare const handoff: (t: number, v0: number, settle?: number) => number; // carry a log-scale speed
export declare const zoomHandoff: (t: number, v0: number, settle?: number) => number; // the same for a zoom-through
export declare const camPath: (f: number, base: Shot, moves: CamMove[]) => Shot; // moves that add and chain
export declare const camVel: (
  f: number,
  base: Shot,
  moves: CamMove[],
  at?: { x: number; y: number },
  film?: Partial<FilmCtx>,
) => { vx: number; vy: number; speed: number; angle: number; vk: number };
```

- Moving between two framings lerps the anchors linearly and `k` in log space, so the subject travels a straight
  screen path at an even zoom rate. Lerping translate and scale separately makes the subject swing off its line.
- The transform reads right to left (anchor to origin, scale, rotate, place on screen), so every punch pivots on the
  subject, not on a corner.
- **When the camera is the animator** (a teaser where every shot is one static layout under a moving camera), write
  the shot as `camPath(f, base, moves)`: each move is `{ at, frames, ease, zoom?, pan?, look?, roll? }` and moves
  add, so the next one starts on the frame the last one slows and the camera never holds (a slide-in settling into a
  pull-back x0.65, a rise's drift into a zoom-out x0.48, a push x1.57 into a whip-out). Whips are asymmetric (about
  12 f in on `E.launchIn`, cut at peak; 7 f out on `E.glideOut`). `camVel` gives the picture's speed and direction
  for the smear: `<DirBlur v={vel.speed / u} angle={vel.angle} shutter={DIR_BLUR.whipShutter}>` on translation only
  (pushes stay crisp), sharp under 120 px/s. Pin a camera track on measured element boxes, never on a frame where
  a hero element moves on its own.
- **Entrances that never stop** (`lib/handoff` `expoTail(f, at, from)`): a prop or plaque rising into a camera shot
  arrives on an expo tail (x0.938 a 60 fps frame, about 90 % home in 36 f) and keeps a residual drift (0.06 px a frame)
  into the next move, so a chained camera never inherits a dead stop.
- Overlays that track the 3D subject (a callout tag, the story relay object, a label pinned to an actor) are drawn in screen space at
  the projected point every frame: `toScreen(shot, ANCHOR)` (or `vector.project(camera)` in Three.js). Under rotation, project with the same maths as the
  transform.
- Modifiers multiply into `k` at the end: a payoff punch `1 + 0.012 · hitPulse(f − cue, 3, 7)` (one per payoff), a dip
  through a whip, a sub-pixel creep at most through a hold (section 7: a hold may be still).

## 3. The moves

| Move                   | What it does                                                                        | House default                                                                        | Normal range                                                  | Cut / swap on                     |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------- |
| `scaleBreath`          | push into the cut (accelerating), next shot opens off its rest and settles          | push 3 % over 20 f; open 8 %, settle 30 f on `E.glideOut`                            | push 1-8 % over 10-20 f; open 5-12 %, settle 8-50 f           | `.cut` (the push's fastest frame) |
| `whip` + `whipCurve`   | a fast reframe: long build, short brake                                             | 32 f on `E.whipBuild` (peak at 55-60 %)                                              | 17-94 f; peak 1600 px/s house, up to 3700                     | `.peak`                           |
| `peakFrame` / `swapAt` | the fastest frame of any move; a copy swap on it                                    | new copy 40 % on its first frame, arrives over 32 f on `E.snapOut`                   | first frame 35-45 %                                           | the peak                          |
| `zoomThrough`          | exponential dive into a point until a shape fills the frame                         | ×8 in 24 f, constant ratio a frame (`E.linear` on log scale)                         | 14-46 f; `E.buildIn` for a dive that accelerates              | `.cut` (99 % cover)               |
| `reframeChain`         | chained reframes with near-holds, a scale pulse at peak speed, roll                 | moves 48 f on `E.strongInOut`, holds 8 f at rest, pulse +5 %                         | moves 27-126 f, holds 4-12 f, pulse 3-6 %, roll 3-8° per move | `.moves`                          |
| `reversal`             | a pull-back that decelerates, turns, and pushes into the cut                        | pull to 0.85 over 70 f on `E.glideOut`; push +4 % over 24 f on `E.buildIn`           | pull 0.80-0.90 over 40-150 f; push 2-6 % over 16-30 f         | `.cut`                            |
| `punchOut`             | a tight crop drifts faster and faster, cut to the wide shot at the same world speed | crop ×3; drift builds on the house launch profile; wide shot opens at 1× world speed | crop ×2.5-3.5; opening ratio 0.9-1.1                          | `.cut`                            |
| `parallax`             | layers of one push at different log-scale rates                                     | type 1, cards behind about 0.5, ground 0                                             | 0.4-0.75 for the middle plane                                 | -                                 |

- **`scaleBreath({ from, to, cut, pre, post, mode, dir })`.** Every cut breathes. The push into the cut is built like
  a launch (pass `build` frames, or `a`/`p`, or explicit growth `ratios`); after the cut the incoming shot opens `open`
  off its rest and settles on `post.ease`. `mode: 'flip'` (house) opens big and settles down; `'same'` opens small and
  keeps pushing in. `breathK(f, opts)` is the multiplier alone. Keep 8 % for most cuts and save a 14 % breath for act
  breaks.
- **`whip({ from, to, start, frames, ease, dip, roll })`** blends two framings; `whipCurve({ peak, build, buildP,
brake, brakeP })` draws the curve from its speed profile. `dip` adds a small zoom-out hop at mid-move, `roll` a tilt
  taken back by the end. Put the whoosh's peak and any content swap on `.peak`.
- **`swapAt(peak, { lead, blank, first, frames, ease })`** changes copy where the eye cannot hold it: on a push,
  `lead: 1` (the new copy is already arriving on the frame before the old one goes); on a pull, `lead: 0, blank: 1`.
  The new copy's arrival is front-loaded; the old copy is never faded out.
- **`zoomThrough({ from, anchor, start, factor, frames, ease, hold, holdFrom, centre, box, cover })`**: k grows by
  `factor` in log space with the anchor held on screen. With a `box` (a letter's counter, a window, a card) `.cut` is
  the first frame the box covers `cover` of the frame: cut there into what was inside, and open the next shot still
  zooming (`handoffShot(..., { carry: ['k'] })`). `hold: 2` posterises the dive on twos.
- **`reframeChain(shots, { start, frames, gap, ease, rollEase, pulse, residual })`**: a camera that tours a 3D set or
  spatial ensemble. Between moves the frame rests (`residual` 0; a creep of at most 0.2 px/f@60 along the last move when given). Land each move as the
  next subject or mechanism reaches its beat.
- **`reversal({ from, start, pull, rest, push })`**: anticipation for the last cut before the end.
- **`punchOut({ wide, cut, crop, dir, drift, carry })`**: open on a detail; `.v(f)` is the content's screen speed.
- **`parallax(layers, move)`** with `layers = [{ w, lag, ease, pan }]`: each layer scales by `exp(w · ln(k / k0))`
  around the same anchor; `parallaxK(k, w)` does one layer of any camera.
- A move can run on stepped time: feed it `stepFrame(f, { animFps: 16 })` and declare the range in `STEPPED`.

## 4. Snap zoom and the defocus pulse

A snap zoom (`fx/SnapZoom`) is a scale change carried by one frame: a short build eases into it, the jump frame takes
most of the change (cut it on a hit), and the landing settles.

| Knob             | House default                                                 | Normal range                                                                                        |
| ---------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| build (`pre`)    | 16 f reaching 30 % of the log change                          | 3-16 f, 20-35 %                                                                                     |
| jump (`land`)    | lands on the target (1.0)                                     | 0.7-1.0 of the change in the jump frame                                                             |
| landing (`post`) | 22 f on `E.snapOut`                                           | 4-22 f; `zeta` for a damped settle that carries the jump's speed                                    |
| ratio            | -                                                             | ×1.1-2.2 in, ×0.3-0.6 out (less reads as a glitch)                                                  |
| defocus          | 4 px@1080 on the jump frame, clearing in 10 f on `E.glideOut` | 3-9 px; `lead: 1, leadShare: 0.5` softens the frame before                                          |
| flash            | off; `{ gain }` = the jump frame only                         | `{ gain, rise, fall, ease }` = a light swell around the snap (+40-60 % mean brightness on the jump) |

- `snapZoomState(f, props, film)` gives `{ k, lnk, sigma, flash, phase }`; `<SnapZoom frame at to ...>` draws it with
  one transform, the defocus as at most two copies at fixed ladder radii, the flash as a white veil.
- `declares(props)`: the jump frame is a designed step (one sample, no shutter blur across it), a jump-frame flash is a
  declared flash, and the jump is a `snapZoom` seam that carries scale. List it in `src/sync.ts` `declares()`.
- `defocusPulse({ at, frames, peakSigma, peakAt, shape, scaleJump })`: the whole frame goes soft and comes back (house
  18 f, 20 px@1080 at the middle) and the camera's scale jumps by `scaleJump` (house ×1.24) on the peak frame, where
  nobody can see it. Hide a reframe or a size change in it; at most one pulse every 0.4-1.3 s in a one-take film.
  Below 1 px of blur a frame still looks sharp and above 2 px it already looks fully soft, so the shape of the first
  and last few frames is what the eye sees.

## 5. Rack focus and defocus levels

Chromium draws a blur under about 0.5 px as sharp and steps radii, and an animated blur radius on a large layer is
both nondeterministic and expensive. So:

- **Defocus comes in fixed levels** (`lib/defocus.ts`: `DEFOCUS_LEVELS` 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32 px;
  `DEFOCUS_MAX_COPIES` 2). `defocusMix(sigma)` returns at most two copies at neighbouring levels with weights, so any
  sigma reads as a smooth ramp while no blur radius ever animates.
- **`<RackFocus levels>`** follows `t × blur` exactly with those copies; `hero` keeps the product, the word or the
  button sharp above the blurred stack while the world goes soft. `rackState(t, blur)` returns the copies. Without
  `levels` it keeps the 1.1 cross-fade of a sharp and a constant-blur copy.
- **`Defocus(props)`** (`fx/Defocus`) computes at most two discrete ladder blur copies: a hidden cut's jump frame, a plane stepping back
  in depth. **`DirBlur`** smears along the motion only, from the layer's speed (sigma = px/s × 0.0048 s,
  the smear of a 180° shutter at 30 fps), each level a static one-axis gaussian: fast pans, whips and props
  leaving at speed in a crisp film, without the shutter pass.
- **Defocus as a timing tool:** a focus-in word (`FocusWord`), a defocus pulse that hides a change, a defocus cut (9 f
  out, one empty frame, 9 f in), a foreground plate pre-softened once in its bake. Never `filter: blur()` animated on a
  large layer, never `will-change` beside an animated blur.
- Behind a payoff line, veil a defocused background at 80-85 % of the background colour.

## 6. Footage that breathes

Footage speed-ramp recipe: each clip plays fast at its ends and slow in its middle, and clips join on their fastest frames, so
the cut hides in the speed.

- Speed is a raised-cosine U from `peak` (house 2.4× real time) to `trough` (0.3) at `dip`; `join: 'cut'` turns it into
  an arch (slow ends, fast middle).
- `rampSource(f, props, film)` gives the clip, the source time (the closed-form integral of the speed) and the source
  frame, so any frame renders deterministically in any order.
- Footage shot at 120 fps or more gives smooth troughs; at the film's own rate the slow middle repeats source frames
  (declare it stepped).
- `declares(props)`: each join is a `velocity` seam. Put the cut sound on the join (`SKILL.md`).

## 7. Holds may be still; moves have a purpose; speed carries through cuts

The camera is still unless a shot declares a move. A held shot is not a stalled player when something in it changes:
the 3D subject acts (a mechanism triggers, a light shifts, a character glances), a line builds, a counter lands. What reads as
cheap is the opposite: a camera floating and panning back and forth with no reason, props bobbing while they are held,
a plane swaying. The stage has no float (`lib/drift`: `stageAt` is still without `moves`; `stageMove(at, 'push' |
'pull' | 'track')` declares one), holds have no aimless drift.

| Hold            | What moves                                             | Number                                                                                |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| any hold        | nothing but the subject's own action; the camera rests | a sub-pixel creep at most (≤ 0.2 px/f@60, 12 px/s; `holdDrift`, house 0), one way     |
| text being read | the type's own build; the camera rests                 | under 90 px/s and 15 %/s (`forensics.py read-move`)                                   |
| a declared move | a push, pull or track from rest to rest                | `stageMove` house push x1.06 / pull x0.94 / track 120 px over 72 f on `E.strongInOut` |
| logo / lockup   | the mark assembling, then still                        | a creep of ≤ 6 % at most (`creepIn`)                                                  |

- **The gates** (`references/checks.md`): `forensics.py dead-stretch` / `motion-frozen` fail only a stretch over 2.5 s
  where nothing changes at all; `camera-wander` fails a camera that pans or pushes one way and back at slow speed inside
  a shot (the old float) or drifts one way through a whole shot at a flat, slow speed, and warns on a camera that never
  rests; `checkShots(cam)` (§13) validates shot sequences before rendering.
- **A move that ends a shot may run into its exit.** A push or track that carries the cut accelerates over its last
  12-20 f (`intoCut()`): the cut lands on the fastest frame and the speed carries across.
- **Speed carries through cuts** (`lib/handoff.ts`, `references/motion-tokens.md` §6): `launch()` into the cut,
  `carry()` out of it at 0.4-1.4× the outgoing speed (house 0.7), decaying ×0.78-0.93 a frame to rest (residual 0);
  `handoffShot(A, B, cut, { carry: ['x', 'y', 'k', 'roll'] })` does it for a camera. Declare velocity seams.
- **Chained moves never stall.** When one move hands over to another, start the second on a zero-slope curve while
  the first is still moving (about 20 f of overlap for moves of similar speed, more when the first is slow); the
  secondary starts before the primary is 90 % home (`overlapAt`).
- Stillness is the default between moves: a held read, a held product state, a held lockup. A stretch over 2.5 s where
  nothing at all changes is dead (cut sooner, or let the product change in it).

## 8. Depth: three planes, parallax, occlusion

The floor against a flat film asks for two depth planes moving at different rates in at least half of the shots.

- **Three planes:** a soft foreground (one shape from the product's world, 1.2-1.6× the frame height, softened once in
  its plate, crossing near a frame edge at 1.5-2.5× the camera's speed), the subject, and a background or ground that
  moves slower (parallax weights about 1.16 : 1.08 : 1.0 for gentle depth; type 1, cards 0.5-0.75, ground 0 on a push).
  Two planes are usually enough; three is the most before it reads as a parallax demo.
- **Occlusion:** type behind an object, a foreground occluder crossing the subject, inner content that scales less
  than its container: each reads as depth without any 3D.
- **The foreground lands about 20 f before the background** (`leadBy`).
- **Lit depth:** blocks that cast shadows from one key (`references/lighting.md`) read as depth even under a locked
  camera.
- **A beat with several objects is a depth stack** (`lib/defocus.ts` `dofSigma`, `lib/camera` `weighShot`): far, mid and near planes at scale 0.6 / 1 / 1.4,
  a fixed defocus of 6 / 0 / 10 px and parallax 0.5 / 1 / 1.6 (each plane weighted by its share of the
  camera: `lib/camera weighShot()`, zoom on log scale), the far plane turned 8-25 degrees (house 16) as a receding
  wall, items carrying their own turn and the film's key-side
  rim (`fx/light`). The camera moves through it: push x1.32 with a 90 px pan and a 6 degree yaw over
  120 f on `E.strongInOut` and creep on; the near plane grows 1.6x as fast, slides out past the edges and fades as it
  passes the lens. Copy and the hero subject sit on the mid plane, sharp.
- **The shot's composition in planes** (`fx/Grounds` `Planes`): bg 0.25 (the ground), mid 0.6 (the product), fg 1.0
  (near elements), with at least one element cropped by the frame edge (`cropCheck()`).

## 9. 3D, perspective and axes

- **Perspective 1800-2600 px** equivalent (or 35-55 mm focal length) on a 1920-wide frame. Too wide distorts proportions; too long flattens depth.
- **One 3D turn per spatial layout** (`lib/camera` `swing3d`, `CAM3D`): the camera turns once, on one axis, 15-30 degrees
  in total (house 26 -> 4 over 108 f on E.strongInOut, landing nearly front-on for the read, then creeping on the same
  way) through a layout whose planes sit at distinct Z depths: `camera3d(shot)` returns a `StagePose` (`preserve3d: true`,
  uniform 3-axis scale) while `place(x, y, z)` positions each plane in 3D space so near planes swing further than far ones.
  `cam3dCheck(base, moves)` holds the rule (one axis within 15-30, the other within 6, at least 48 f, roll within 11).
  ```ts
  const sw = swing3d({ at: CUE.turn });
  const shot = camPath(f, { ...base, ...sw.start }, sw.moves);
  const stagePose = camera3d(shot);
  const planes = [
    { id: "far", pose: place(300, 210, -260) },
    { id: "hero", pose: place(780, 300, 0) },
    { id: "near", pose: place(1420, 760, 180) },
  ];
  ```
- **Place moving elements with continuous 3D transforms**, never rounded integer offsets: `place()` and the fx helpers keep full float precision.
- **Plaques and title planes face the camera.** A title slab or floating callout rests face-on
  (house tilt 0 / 0); a flat card tilted diagonally at rest reads as cheap. A 3D turn is a declared
  object move: a turn that lands face-on, an entry that settles from a turned pose, or a physical 3D rotation in the world.
- **Keep roll rigid and outside the tilt:** apply screen-space `roll` around Z outside pitch/yaw so tilted text planes never shear into faux italics.
- **Limits:** roll ≤ 11°, total visible shear ≤ 7° (for example pitch 42° with roll ≤ 12°).
- **Real 3D only.** Tilted screenshot cards floating in space are a tell; when the subject turns, turn real 3D geometry
  with its own shadow from the key on its own ground, and land it face-on. For a full thin-lens rig
  (perspective, circle-of-confusion DOF, macro close-ups, stage travel), use `film-stage/camera.ts`, `fx/three/stage.ts` or `fx/depth` (§13).
- **High-DPI text plates under zoom:** rasterise Canvas2D text plates at peak shot scale `Z` (`devicePixelRatio * Z`) and switch raster buckets only on a whole frame at a velocity peak (`references/chromium-rendering.md`).

## 10. Choosing a move for a beat

| Beat                                    | Move                                        | Note                                                       |
| --------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| opening on a detail                     | `punchOut`                                  | the first cut carries the world's speed into the wide shot |
| touring a product or a board            | `reframeChain`                              | one move per idea, near-holds at rest, roll small          |
| changing the subject in one breath      | `whip` + `swapAt(whip.peak)`                | swap copy on the peak, whoosh on the peak                  |
| a hit, a reveal, a punchline            | `SnapZoom`                                  | one jump frame, defocus on it, sound on it                 |
| going inside (an app, a letter, a card) | `zoomThrough` + `handoffShot(carry: ['k'])` | cut at 99 % cover, open still zooming                      |
| a change of size you want hidden        | `defocusPulse`                              | the jump on the peak                                       |
| the last cut before the end             | `reversal`                                  | pull, turn, push into the cut on its fastest frame         |
| every other cut                         | `scaleBreath`                               | push 3 %, open 8 %, settle 30 f                            |
| depth in a flat frame                   | `parallax`                                  | type 1, cards 0.5-0.75, ground 0                           |

At most one new signature move per beat (about 1.5-2.5 s): a camera that changes its idea every half second reads as a
demo reel. More camera devices: the device book's [camera](devices/camera.md) and
[camera transitions](devices/camera-transitions.md).

A camera journey in one function:

```ts
const chain = reframeChain([F1, F2, F3], { start: 96, frames: [54, 50], gap: 26, fps });
const toFar = whip({ from: chain, to: F4, start: 230, frames: 32, fps });
const wide = (f: number) => (f < toFar.start ? chain(f) : toFar(f));
const open = punchOut({ wide, cut: 75, crop: 3, dir: { x: -1, y: 0 }, drift: { vCut: 38 }, fps });
const swap = swapAt(toFar.peak, { fps }); // the copy changes on the whip's fastest frame
const snap = (f: number) =>
  snapZoomState(f, { at: 316, to: 1.5, defocus: { sigma: 7, lead: 1 } }, { fps });
const dive = zoomThrough({
  from: boardAt(340),
  anchor: windowCentre,
  start: 340,
  factor: 14,
  frames: 26,
  ease: E.buildIn,
  centre: E.softOut,
  box: windowRect,
  width: W,
  height: H,
  fps,
});
const inside = handoffShot(boardCam, (f) => back(f), dive.cut - 1, { carry: ["k"], fps });
const back = reversal({
  from: G0,
  start: dive.cut + 4,
  pull: { to: 0.82, frames: 110 },
  push: { to: 1.06 },
  fps,
});
const last = scaleBreath({
  cut: back.cut,
  from: inside,
  to: H0,
  pre: false,
  post: { open: 0.08, frames: 34 },
  fps,
});
```

Six camera ideas in about 9.5 s, one per beat, every cut carried.

## 11. Framing, legibility and speed

- **The product covers the frame** whenever it is the shot: clamp the camera so no window edge or void enters by
  accident (a `cover(shot, w, h)` helper keeps both edges outside the frame).
- **Bleed for pictures, centre for words.** Frame a product or picture past two edges at 1.2× the frame or more in
  most acts, off-centre at 1.1-1.6×; a picture dead centre and inside the frame in more than half the framed samples
  warns (`framing-centred`, which leaves type out). A statement stays centred in the middle band whatever the camera
  does (`scripts/forensics.py` placement).
- **Headroom:** at least 24 px between any glyph and the frame edge at maximum `k` (creep and punch included).
- **Readable text** is at least 36 px on screen after camera scale whenever it is in focus for more than 6 f
  (`TEXT_MIN`): `k ≥ 36 / fontPx` for the smallest text that carries meaning. Smaller text is texture, out of focus or
  gone within 6 f.
- **Overscan** a layer under a declared track or pull (`bleedFor`) so the move never reveals an edge.

| Move                 | Speed or length                                                         | Note                                               |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| hold                 | still (house); a creep under 12 px/s (0.2 px/f@60) at most, one way     | no float, no drift, no bob                         |
| declared stage move  | push x1.06, pull x0.94, track 120 px over 72 f on `E.strongInOut`       | starts, travels, lands; never back the way it went |
| camera move          | calm 0.5 s + 1.6 ms/px, 0.9-3.0 s; crisp 0.35 s + 1.35 ms/px, 0.6-2.4 s | `durFor(px, true)`                                 |
| whip                 | 17-94 f (house 32), peak 1600 px/s (up to 3700)                         | beside stillness, never while text is read         |
| a crisp film's frame | over 3000 px/s for more than 14 f warns (`speed-ceiling`)               | cut frames are not moves                           |

## 12. Blur policy

`LOOK.blur` in `timeline.ts` declares it: `'crisp'` (the default: flat graphics render sharp, one sample a frame) or
`'camera'` (a 180° shutter on frames moving faster than about 900-1200 px/s). A crisp film can hold a camera-real
moment: declare its range in `CAMERA_BLUR` and only those frames get shutter samples. Declared steps (a snap zoom's
jump, a stepped layer), flashes and hard seams always render from one sample. `measure-speed.py --policy auto` and
`accumulate.py` follow the declaration (`references/finishing.md`).

A spinning element smears around its centre, not along a line: `SpinBlur` (`fx/Defocus`) draws copies turned back
over half the frame's turn as a running mean (sharp under 1 degree a frame); a mark that spins in
(from x2.06 and over a turn, the turn settling before the scale, then aside to make
room while the name slides out) passes its angular velocity `omega` to it.

## 13. The depth camera math (fx/depth)

`fx/depth` (`math.ts` + `shots.ts`) supplies pure, Node-safe 3D camera, thin-lens circle-of-confusion, screen-velocity
shutter smear and shot-sequencing math — usable alongside Three.js (`film-stage/camera.ts`, `fx/three/stage.ts`) or
for projecting planes in 3D space.

**The model (`fx/depth/math.ts`).** The camera is a director's rig: the 3D point it looks at (`target`), distance
(`dist`), `yaw` (+: to the target's right), `pitch` (+: above, looking down), rigid `roll`, focal `lens` mm on the
short side (50 normal, 28-35 strong perspective, 85-100 long telephoto), focal distance `focus`, and `aperture`
(house 36). `defaultCamera` opens 1:1 on the z = 0 plane; `projectPlane` / `underStage` project 3D coordinates and
4×4 matrices deterministically at any fractional frame `f`.

**Depth of field & shutter smear.** Thin-lens circle of confusion (`cocSigma`: `aperture × (F / focus) × |depth - focus| / depth`)
scales naturally with magnification (a 3× macro framing has 3× shallower DOF), rendered via `lib/defocus` ladder levels
or post-processing DOF. Screen-space shutter smear (`planeSmear`) computes 180° shutter sigma (`0.29 × half-frame travel`)
above 120 px/s, capped at 24 px, and zero on holds.

### Shot vocabulary (`fx/depth/shots.ts`)

```ts
import {
  camera,
  checkShots,
  crane,
  follow,
  frame,
  macro,
  orbit,
  pathOf,
  pull,
  push,
  rack,
  shotDeclares,
  travel,
  whip,
  wide,
} from "../fx/depth";

const cam = camera(
  [
    push(0, macro(HERO_BOX, { mag: 3.2, yaw: 10 }), { frames: 56 }), // close on the hero mechanism
    rack(60, TARGET_POINT, { frames: 30 }), // rack focus to the secondary subject
  ],
  { base: { yaw: -6 } },
);
// checkShots(cam) validates: no overlap, no back-and-forth reversal, no slow crawl, no linear camera ease
```

| Shot          | Helper                                 | House f@60      | Easing                                              | Focus                                   | Recipe                                                                                                                                    |
| ------------- | -------------------------------------- | --------------- | --------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| push in       | `push(at, macro(box) / frame(box))`    | 60              | `E.strongInOut` (or `E.glideOut` right after a cut) | lands on the target                     | closes on the mechanism or character beat that changes; target travels a straight, eased screen path                                      |
| pull back     | `pull(at, wide())`                     | 72              | `E.strongInOut`                                     | the target, or rack to what is revealed | reveals the surrounding 3D world; hold ≥ 1.5 s before reversing a push                                                                    |
| follow        | `follow(at, subject, { frames, lag })` | lag 24, ramp 24 | the subject's own motion, bell-smoothed             | the subject                             | rides a moving 3D point (`pathOf(a, b, at, frames)` or `newestOf(points, times)`); frame the subject first and land cleanly when it stops |
| travel        | `travel(at, point or framing)`         | 84              | `E.strongInOut`                                     | the target                              | keeps angle and distance while gliding across a set, relief or architectural plane; roll may unwind as it goes                            |
| crane         | `crane(at, framing)`                   | 96              | `E.strongInOut`                                     | lands on the read                       | swings down from high pitch onto the stage, landing level                                                                                 |
| orbit         | `orbit(at, { yaw })`                   | 90              | `E.strongInOut`                                     | the target                              | orbits around the 3D hero subject (`film-stage/animate.ts` `orbitL`/`orbitR` for shot envelopes)                                          |
| whip          | `whip(at, framing)`                    | 28              | `E.whipBuild`                                       | the next subject                        | fast reframe to the next focal point; pair with directional shutter smear (`film-stage/velocity.ts`)                                      |
| rack          | `rack(at, point or 'target')`          | 30              | `E.strongInOut`                                     | travels in diopters                     | shifts focal plane between foreground and background subjects during a hold or move                                                       |
| macro framing | `macro(box, { mag, anchor })`          | -               | -                                                   | -                                       | frames one hero detail at 2.5-4× magnification with shallow DOF behind it                                                                 |

**Rules & validation.** One camera move per shot: the next starts once the last has landed (`checkShots(cam)` flags
`shot-overlap`, `shot-reverse`, `shot-drift`, `shot-short`, `shot-roll`, `shot-busy`). Never use `E.linear` on camera
translation, never reverse direction within 1.5 s without a cut or motivated beat, and keep roll within ±8° inside a
move. Export `shotDeclares(cam, { offset, frames })` in `src/sync.ts` so `forensics.py camera-wander` verifies the
rendered video against your declared moves.

### Lens & world continuity

- Use longer focal lengths (65-85 mm equivalent, narrower FOV in `film-stage/camera.ts`) for close hero ensembles so
  off-axis geometry does not keystone unnaturally; use wider lenses (28-35 mm) when flying through corridors or vaults.
- Drive world progression across act boundaries with `fx/world` `worldPath(cuts)` or continuous 3D camera keyframes in
  `cam.json` (`film-stage/camera.ts` log-tan FOV interpolation + Catmull-Rom / role-eased segments).
- Pair full-frame velocity cuts with `fx/Seam` `velocityCut` or `film-stage/animate.ts` (`whipLeft` / `whipRight` /
  `diveIn` / `dropIn` with `seam: true` in `shots.json`).
