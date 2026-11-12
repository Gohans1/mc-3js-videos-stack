# Chromium rendering traps: symptom, cause, fix, detection

Covers the ways Chromium's rasteriser makes a correct-looking composition render wrong: pixel-snapped stairs, text that settles in whole-pixel ticks, soft text under perspective, stepped blurs, ghost frames, negative geometry clamps, aliasing, depth order, banding, faux italics and seam shimmer. All of it applies to headless Chromium rendering WebGL + 2D Canvas overlays (`packages/live-studio`). Read it before building camera moves and 3D, and whenever a render shows something the code does not explain.

Every item here was hit on a real film and fixed. The numbers are what was measured then; treat them as orders of magnitude, not thresholds.

## The table

| #   | Symptom                                                                                                                  | Cause                                                                                                   | Fix                                                                                                                                                                                                                   | Detect                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Slow drifts move in 1 px stairs; text shimmers on slow pushes                                                            | integer rounding (`Math.round`) combined with continuous matrix scale/translation                       | keep continuous float coordinates inside one Canvas2D `setTransform` / WebGL matrix                                                                                                                                   | `forensics.py` judder (phase-correlated patches, `--track x,y,w,h`) |
| 2   | Text goes soft when zoomed up on a 3D plane                                                                              | texture plate rasterised at 1× base resolution and magnified in 3D                                      | rasterise the CanvasTexture at peak shot scale `Z` (`width * Z`, `height * Z`); switch `Z` on a velocity-peak whole frame                                                                                             | 1:1 crops (`grab.sh --crop`); `forensics.py` sharpness              |
| 3   | A defocus snaps from sharp to soft in one frame                                                                          | animated `ctx.filter = "blur(...)"` on a large plate ramps in discrete steps (Laplacian 1416 → 83)      | cross-fade a sharp plate and fixed-sigma blur copies (`src/fx/RackFocus.ts`, `lib/defocus.ts`)                                                                                                                        | `forensics.py` sharpness step; MAD spike during the rack            |
| 4   | A stale copy of an element flashes on single frames, different frames each render                                        | GPU surface caching across concurrent tabs or un-flushed offscreen canvases                             | clear and redraw deterministic offscreen plates per frame `t`; render twice and compare hashes                                                                                                                        | `forensics.py --against` a second render; ghost check               |
| 5   | A shape freezes in an old pose for a few frames after an overshoot                                                       | negative radius/width (`rx`, `r`, `width`) from spring overshoot is rejected or inverted                | clamp every geometric input `Math.max(0, v)` before building paths or meshes                                                                                                                                          | stills at overshoot frames                                          |
| 6   | Thin gaps and strokes crawl as dashes when small                                                                         | missing mipmaps or sub-pixel features aliasing under minification                                       | enable `LinearMipmapLinearFilter` + anisotropy on textures; gaps ≥ 8 units, strokes ≥ 1.5 px at final scale, fade hairlines out                                                                                       | 1:1 crops; every-frame sheet of the small section                   |
| 7   | Transparent 3D planes draw in the wrong depth order                                                                      | `depthWrite` conflicts or unsorted transparent meshes                                                   | sort transparent planes back-to-front (`renderOrder` or explicit Z sort) and set `depthWrite: false`                                                                                                                  | stills during lifts                                                 |
| 8   | Contour rings in soft falloffs and vignettes                                                                             | 8-bit colour quantisation without dither                                                                | enable `grade.ts` TPDF dither (`1 / 255`) and bake flat plates with `scripts/dither-gradient.py`                                                                                                                      | ×12 contrast stretch (`forensics.py` banding sheet)                 |
| 9   | Type looks sheared / faux-italic on a tilted 3D plane                                                                    | Euler order applies roll inside pitch/tilt                                                              | keep roll rigid in screen space outside tilt (`YXZ` / screen-Z outside X tilt)                                                                                                                                        | look at text on tilted shots at 1:1                                 |
| 10  | Overlay callouts shimmer ~0.4 px on a cut                                                                                | shared element projected with rounded coordinates on one side and float matrix on the other             | identical float projection (`toScreen` / `vector.project`) on both sides of the seam                                                                                                                                  | `forensics.py` seam pop; phase correlation across the cut           |
| 11  | Doubled indicators, half-opacity letters in the blurred master                                                           | discrete state computed from fractional sub-frame times                                                 | discrete state from `fd(frame)` (`Math.round`)                                                                                                                                                                        | 1:1 crops of stepped counters in the master                         |
| 12  | A fallback font on early frames, or text boxes sized for the wrong font                                                  | rendering or measuring before the web font loaded                                                       | await `document.fonts.load()` + `document.fonts.ready` before rendering                                                                                                                                               | first frames of each render tab; `--against`                        |
| 13  | Animations differ between renders or ignore the timeline                                                                 | `Math.random`, `Date.now`, `performance.now` or stateful particle delta accumulators                    | everything is a pure function of `t` / `frame`; seeded `rand()` only                                                                                                                                                  | `forensics.py --against` a second render                            |
| 14  | WebGL canvases render blank or very slowly                                                                               | no GPU GL backend in headless Linux                                                                     | run Chromium with `--use-gl=angle` and validate at concurrency 1                                                                                                                                                      | a still of the canvas frame                                         |
| 15  | A word settles in 1 px ticks at the end of its rise; slow vertical text drift stair-steps                                | 2D glyph sub-pixel vertical positioning quantises on some headless backends                             | end vertical text moves on `arrive(p)` / start exits on `depart(q)` (`src/lib/anim.ts`, `film-stage/titles.ts`); for ultra-slow vertical pushes over giant type, extrude vector outlines (`scripts/outline-text.py`)  | `forensics.py` judder on the text region                            |
| 17  | Vector paths vs raster text drift apart under 3D camera motion                                                           | mismatched baseline origin between 2D canvas text and 3D extruded shapes                                | align both by measured font metrics (`lib/measure.ts`, `outline-text.py`)                                                                                                                                             | 1:1 crops under camera motion                                       |
| 16  | Text snaps from slightly soft to sharp a few frames after it has stopped                                                 | 2D canvas `blur()` radii quantise in ~0.5 px steps and anything under ~0.75 px renders sharp            | clear entrance blur by 60% of the move (`blurIn`), start exit blur once moving (`blurOut`)                                                                                                                            | `forensics.py` sharpness step                                       |

## Details and code

### 1. Pixel-snap stairs

Rounding `x`/`y` before applying scale jumps −1 px on ~40% of frames during a 0.05 px/f drift, making a caption climb in visible 1 px stairs every 6–8 frames. Keep all translation and scale inside one continuous float transform:

```ts
// wrong: integer rounding before transform
ctx.drawImage(plate, Math.round(x), Math.round(y), w * s, h * s);
// right: continuous float matrix
ctx.save();
ctx.translate(x, y);
ctx.scale(s, s);
ctx.drawImage(plate, 0, 0);
ctx.restore();
```

### 2. Perspective texture resolution cap

A `THREE.CanvasTexture` rasterised at 1× and zoomed 2× in 3D goes visibly soft. Rasterise the backing canvas at peak shot scale `Z`, and divide the 3D plane's world scale by `Z`:

```ts
const Z = fd(f) >= CUE.split && fd(f) < CUE.close ? 2.1 : 1; // switch on whole frames at velocity peak
canvas.width = Math.round(PLATE_W * Z);
canvas.height = Math.round(PLATE_H * Z);
ctx.setTransform(Z, 0, 0, Z, 0, 0);
drawPlate(ctx);
mesh.scale.set(worldW, worldH, 1);
```

Switch `Z` only on a whole frame at a velocity peak, where the re-raster hides inside the motion (`references/camera.md`).

### 3. Stepped blur ramps

Animating `ctx.filter = "blur(...)"` on a full-frame plate jumps between discrete strengths. Pre-bake or cache fixed ladder radii and cross-fade (`src/fx/RackFocus.ts`, `lib/defocus.ts`):

```ts
const copies = rackState(prog(f, CUE.rackIn - 1, CUE.rackIn + 20, E.smooth), 11, { levels: true });
for (const c of copies) {
  drawCachedBlurPlate(ctx, c.sigma, c.opacity);
}
```

- Constant blur of 10–12 px reads as defocused background; `defocusMix` blends at most two neighbouring ladder levels.
- Overscan blurred plates by 80 px so edge clamping never pulls dark or transparent fringes inward.
- Small word plates (`film-stage/titles.ts`) can use `blurIn(p, px)` as long as blur clears while the word is still moving fast (item 16).
- Never leave landed text blurred; blur belongs to entrances (`SKILL.md`).

### 4. Concurrent surface ghosts

Reusing a mutable offscreen canvas without resetting transform/alpha state or relying on browser compositor layer caches can leak stale frames across renders. Clear and reset every offscreen buffer deterministically per frame `t`; verify determinism with `forensics.py out/a.mp4 --against out/b.mp4`.

### 5. Negative geometry attributes

A spring rebound pushing `shut` above 1 makes `rx = 30 * (1 - shut)` negative, which throws in `ctx.roundRect` or flips geometry. Clamp every value derived from an overshooting curve:

```ts
const rx = Math.max(0, 30 * (1 - shut));
const width = Math.max(0, w);
const blurPx = Math.max(0, b);
```

### 6. Minification aliasing

Enable `LinearMipmapLinearFilter` and `renderer.capabilities.getMaxAnisotropy()` on every 3D texture plate. Keep designed gaps ≥ 8 units in a 100-unit mark, drop or thicken strokes that would fall under 1.5 px at final scale, and fade hairlines out as the camera pulls back. Check pull-backs at 1:1 on an every-frame contact sheet (`scripts/sheet.py --from A --to B --every 1`).

### 7. Transparent 3D depth order

Unsorted transparent 3D planes with `depthWrite: true` occlude planes in front of them depending on scene-graph insertion order. Sort transparent planes explicitly by view-space Z (or set deterministic `mesh.renderOrder` with `depthWrite: false`):

```ts
planes
  .slice()
  .sort((a, b) => a.position.z - b.position.z)
  .forEach((plane, idx) => {
    plane.renderOrder = idx;
  });
```

### 8. Gradient banding

Covered in `references/finishing.md` §3: compute the ramp in float, dither, quantise once, and load it as a PNG. Dither added after Chromium has quantised the gradient cannot remove the bands.

### 9. Faux italics

In a transform string the rightmost function applies to the element first. `perspective(2400px) rotateX(48deg) rotateZ(-26deg)` rolls the content inside the plane and then tilts it, which shears the type into a fake oblique. Roll the tilted plane rigidly instead, in screen space, and keep it small:

```ts
transform: `perspective(2400px) rotateZ(${roll}deg) rotateX(${tilt}deg)`; // roll outside the tilt
```

Keep the roll within about 11° and the total visible shear within about 7° (`references/camera.md`).

### 10. Seam shimmer from placement

When one act places the UI by layout (`left`, flex position) and the next places the same UI by transform, the two rasterise with different sub-pixel offsets; the whole UI shifted 0.42 px on the cut. On both sides of a seam, place the shared element with the same method and the same transform string, so the first frame of the new act is pixel-identical to the last frame of the old one. `forensics.py` reports a seam pop on the act boundary.

### 11. Discrete state under sub-frames

The motion-blur pass renders fractional frames. Anything discrete must agree across one output frame's samples, so compute it from `fd(frame)`: stepped character counts, indicators, counters, label text, layout thresholds, raster-scale switches (item 2). Continuous motion stays on the fractional frame. Details in `references/finishing.md` §2.

### 12. Fonts

The first frames a render tab captures can show the fallback face, and any measurement taken then is wrong and stays cached for the rest of the render. Always await `document.fonts.load()` for every face and weight, then `document.fonts.ready`, and continue on the next animation frame before rendering or measuring (`lib/measure.ts`).

### 13. Wall-clock animation

Renders seek frame by frame in several tabs at once. CSS `transition`/`animation`, `@keyframes`, utility-class `animate-*`, `Math.random()`, `Date.now()` and `performance.now()` all run on wall-clock time, so frames disagree between tabs and between renders. Drive everything from the frame and use seeded randomness (the starter's `rand(seed)`). `scripts/forensics.py` catches the patterns.

### 14. WebGL

Canvases using WebGL (effects, 3D, maps) need a working GL backend in headless Linux: set `Config.setChromiumOpenGlRenderer('angle')` or pass `--gl=angle`. Validate at `--concurrency=1` first, render a still of the canvas frame, and keep canvases at most 4096 px per side, moving a pre-rendered plate with CSS rather than re-rendering the canvas every frame.

### 15. Vertical text snaps to whole pixels

Measured in headless Chromium (Chromium 141): a word rising 40 px on `E.out` can land on whole-pixel rows near the slow tail (the last 3–4 px of a 26 f reveal), arriving as 1 px ticks separated by 1–3 frame holds, which reads as the word "clicking" into place (`forensics.py` reports judder there).

- **Reveals:** finish the vertical part of the move while it still travels ~0.5–1 px/f, then stop. `arrive(p, k = 0.94)` rescales eased progress so the move completes at 94% of its curve (right for a ~40 px rise; `arriveK(px, dur, ease)` gives the `k` for any other travel or fps); `depart(q, k = 0.06)` skips the slow start of an exit. Opacity, blur and horizontal motion keep the plain progress (`lib/moves.ts` `wordRise`, `film-stage/titles.ts`).

```ts
const p = prog(f, s, s + 26, E.out);
const yOffsetEm = (1 - arrive(p)) * 0.32;
const alpha = p;
const blurPx = blurIn(p, 14);
```

- **Slow vertical drifts of text** (a caption creeping up 8 px over 2 s): drift sideways, push with scale about its own centre, or extrude vector outlines (`scripts/outline-text.py`).
- **Camera moves** that carry text vertically at more than ~1 px/f are unaffected in practice; the ticks only show when the text is nearly still.

### 16. Blur radii are quantised

2D canvas `blur(r)` renders in steps of about 0.5–0.6 px of radius, and any radius under about 0.75 px renders exactly sharp (measured: 0.1–0.7 px identical to no blur; 0.8–1.3 px one level; 1.4–1.8 px the next). A blur ramp that eases to 0 alongside a slowing move therefore spends its last frames at "slightly soft", then snaps to sharp once the word has already stopped. Clear entrance blur early with `blurIn(p, px)` (gone by 60% of the eased move, when the word is still fast and half transparent) and start exit blur only once the element moves (`blurOut(q, px)`); both are in `src/lib/anim.ts`. Large defocus goes through `RackFocus` (item 3).

### 17. Defocus at fixed levels

An animated blur radius is quantised (item 16), expensive on a large plate, and its last frames snap. Draw
defocus as at most two copies at fixed levels (`lib/defocus.ts`: 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32 px),
cross-faded by opacity (`defocusMix(sigma)`), so any sigma reads as a smooth ramp and no radius ever animates. When a
defocused plate also fades, fade the composite group, not each copy (fading each copy shifts the mix toward the sharper one).
Bake large soft shapes (a foreground occluder, a glow, a shadow) once into a plate.

### 18. Scaled text rasterisation

Text scaled up from a small size is rasterised at its base size and goes soft; text scaled down without mipmaps shimmers (item 6). Rasterise text plates at peak shot size and scale down with mipmaps, or extrude a giant word as vector outlines (`scripts/outline-text.py`, `fx/three/geo.ts`). A giant word (400 px and up) that the 3D camera crosses is best as extruded 3D paths.

### 19. GPU cost inside the frame

Large per-frame blurs, stacked full-screen defocus passes and live screen-space blur passes on 1080p targets load the GPU on
every frame. `scripts/forensics.py` warns (`gpu-cost`) on a blur over 40 px, more
than 2 blurred layers in a file, an animated per-frame filter, any live screen-space blur pass, and a chain holding more
than 24 sharp word layers. The fix is a baked plate (`scripts/dither-gradient.py`), static ladder levels picked per frame,
and frost built from two copies instead of a live screen-space blur pass.

### 20. Two scenes at once

A transition that draws both shots (a window, a dive, an exposure hand-over) doubles the layer count for its frames.
Keep the outgoing shot's heavy layers (defocus copies, footage) only for the frames they are visible, unmount the rest,
and prefer one shared plate for both sides.

## When something looks wrong and none of these fit

1. Render the frame as a still and the same frame inside a short video; if they differ, suspect items 4, 12 or 13.
2. Render the range twice (`scripts/probe.py ... --frames A-B --no-audio --no-check`) and run `forensics.py a.mp4 --against b.mp4`; any difference is nondeterminism.
3. Grab the exact frames with `scripts/grab.sh video.mp4 <frame>...` and compare at 1:1 before reading code, because contact sheets hide sub-pixel problems.
4. Bisect by removing layers in the composition until the artifact disappears; the last layer removed is where the fix goes.
