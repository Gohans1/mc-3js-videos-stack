# Wipes, masks and irises

Part of the device book: [INDEX](INDEX.md) has the pick-by-job table, the materials and VFX notes and one line for every device.

Reveals with an edge: irises from a point on screen, feathered and stepped wipes, block bursts, pill breaths, windows that open inside the shot.

[Iris opens from a point already on screen](#iris-opens-from-a-point-already-on-screen) · [Flat blocks burst out and reveal the next shot](#flat-blocks-burst-out-and-reveal-the-next-shot) · [Pixel-staircase wipe stepped on twos](#pixel-staircase-wipe-stepped-on-twos) · [The next shot arrives as an LED dot matrix, then melts solid](#the-next-shot-arrives-as-an-led-dot-matrix-then-melts-solid) · [Title fills with the next image and takes over](#title-fills-with-the-next-image-and-takes-over) · [Two discs converge and their overlap opens a world](#two-discs-converge-and-their-overlap-opens-a-world) · [Halves part like doors and the next card rises through](#halves-part-like-doors-and-the-next-card-rises-through) · [Next shot opens as a window; the old shot steps back](#next-shot-opens-as-a-window-the-old-shot-steps-back) · [A text-height slot opens behind the line onto the photo](#a-text-height-slot-opens-behind-the-line-onto-the-photo) · [A colour block wipes the line on and lingers](#a-colour-block-wipes-the-line-on-and-lingers) · [Concentric squares radiate at constant speed](#concentric-squares-radiate-at-constant-speed) · [A soft light band carries the old graphic out](#a-soft-light-band-carries-the-old-graphic-out) · [Frame halves flip to a new ground in turn](#frame-halves-flip-to-a-new-ground-in-turn) · [Scene emerges from white, hero first](#scene-emerges-from-white-hero-first)

### Iris opens from a point already on screen

`dv-iris-open` · signature · energy medium · any · primitive: Iris

A circle opens from the object the eye is on (the gap between two words, a sparkle, the centre of a pixel field, the space under a header) and grows by a constant ratio a frame (x1.28 at 60 fps, x1.63 at 30) until it passes the corners, revealing the next scene already moving inside; a scalloped cloud edge makes the matte the subject; it can start already 40 % wide and cover in 4 frames; a pill can widen on an ease-in as the wind-up. **When:** Section changes; reveals from a word or a dot. **Avoid:** Eased irises that start invisible.

- **Anatomy:** r0 about 22 px (visible on frame one), constant ratio; scallop 9 lobes at 6-8 % depth with an 8-12 px feather; inner scene zooming; porthole variant under a header.
- **Timing:** 8-18 f to the far corner; cloud iris 74 f in two phases (40 f expo-out, 30 f ease-in to overfill).
- **Sound:** A glockenspiel note or an orchestral stab on the first frame.
- **Build:** `<Iris mode="rate" originFrom scallop>`.
- **Materials and numbers:** Scalloped iris: about 10 round lobes on the rim (lobe radius about 0.18 of the radius), edge feathered 8-12 px; it grows from about 140 px to past the frame over 72 f (ease-in, then fast) while the footage inside is already moving; the shape that started it becomes a hole in the ground colour.

### Flat blocks burst out and reveal the next shot

`dv-block-burst-wipe` · signature · energy high · launch, feature · primitive: recipe (3D / shader)

Hard-edged blocks take over the frame: outlined square blocks explode radially out of an icon and cover the frame, revealing a textured field; blocks retreat to one edge in steps while the next frame decodes; after a click, stepped white rectangles grow out of the button leaving a dark window around it; flat rectangles in two colours pop at random places for 1-2 frames each, the next shot showing through. **When:** A click that changes everything; playful, graphic brands. **Avoid:** Gradient or glowing blocks.

- **Anatomy:** Coverage 8.7 -> 95 % in 10 f, or +12-16 % a frame; blocks 280-560 px wide; 2-4 new blocks a step.
- **Timing:** 12-29 f.
- **Sound:** A bubble pop; a UI click; a drum cluster.
- **Build:** `<BlockStep blocks>` with a seeded block list growing from the source box.

### Pixel-staircase wipe stepped on twos

`dv-pixel-stair-wipe` · signature · energy medium · launch, feature · primitive: recipe (3D / shader)

A wipe in the next scene's colour built from 22-23 px square blocks advances diagonally with a random staircase edge, stepped on twos, with a faint fringe; or horizontal bands of the next scene slide in over the old with a dither-staircase edge. **When:** Image or pixel-flavoured films; a beat with crunchy clicks. **Avoid:** Smooth films.

- **Anatomy:** Coverage 0.3 -> 22 -> 62 -> 85 -> 99 % on 12.5 fps steps, 80 % in the middle 0.36 s; cells 8-23 px.
- **Timing:** 16-55 f.
- **Sound:** A riser peak; crunchy clicks under the steps.
- **Build:** `<StairWipe at color outgoing incoming>` (shader / 3D recipe): 22 px blocks advance diagonally (35 deg) with a seeded staircase edge (12 %), stepped at 12.5 fps, 80 % of the coverage in the middle on M.pixelStair (55 f); a fringe of blocks in the next scene's colour leads it (`fringeAlpha={1}` for a solid accent edge); a wipe seam.
- **Build (bands):** `<DitherBands at outgoing incoming>` (shader / 3D recipe): six wide rectangles (2.5-7 times wider than tall) open from their own centres, born over the first 45 % of the run, their rims an ordered dither of 10 px cells 0.06 of the frame height deep; 16 f at 60 fps on E.stdInOut, every frame a step (declared), a wipe seam on the last. Works on any two scenes, no photo; it reads only between grounds that differ (type on paper into a UI, light into dark). `frames={3}` for a dither cut hidden in a zoom jump.

### The next shot arrives as an LED dot matrix, then melts solid

`dv-dot-matrix-arrival` · signature · energy high · launch, sting · primitive: recipe (3D / shader)

Over the current shot the coming one appears first as round dots on a regular grid, each dot the colour of the incoming picture at that cell, in blob and band shapes that grow frame by frame (an ellipse, then full-width bands); the gaps still show the outgoing shot, so the two interleave cell by cell; then the solid image fades in under the dots and the dots go. **When:** A cut into a screen, a 3D subject or a digital world; once per film. **Avoid:** Calm films; a pixelate cut in the same act.

- **Anatomy:** Cell 12 px, dot radius 4.5 px; mask = a soft ellipse (scale 0.3 -> 1.2) plus rows switching on by a seeded hash, stepped rather than smooth; the solid image under the dots, then the dots off.
- **Timing:** About 28 f: first cluster 2 f, mask growth 14 f, solid fade 8 f, dots gone in 6 f.
- **Sound:** A tick cluster under the music.
- **Build:** `<DotMatrix src x y w h at cell={12} r={4.5} centre ellipse={[0.3, 1.2]} rowsFrom={0.35} band={3} grow={14} solid={8} gone={6} seed>` (shader / 3D recipe) laid over the outgoing shot: one canvas of dots in the picture's own colours (sampled once), a blob growing on twos plus seeded bands of rows, then the solid picture under the dots; declared stepped; dotMatrixFrames() for the cues.
- **Materials and numbers:** The dots keep the picture's own colours; the gaps show the outgoing plate, never black.

### Title fills with the next image and takes over

`dv-type-window` · signature · energy high · launch, sting · primitive: recipe (3D / shader)

A title pushes in accelerating, punches +11 % in one frame, its letters fill with the next image, giant echo copies appear, and the image takes over the frame. **When:** The title before the main section. **Avoid:** Thin letters.

- **Anatomy:** Push +6 % accelerating; punch 1 f; window 23 f; step-out 1 f.
- **Timing:** 95 f in all.
- **Sound:** A drum hit at +45 dB on the step-out.
- **Build:** `<TypeWindow>` (letters as the window, stepped growth) with a SnapZoom punch.

### Two discs converge and their overlap opens a world

`dv-vesica-portal` · signature · energy medium · launch, sting · primitive: recipe (plain layers)

Two dark spheres slide together until only their lens-shaped overlap remains at the centre, rimmed in light, and the next world shows through that overlap. **When:** Two ideas meeting; a hero reveal. **Avoid:** Discs that do not read as objects.

- **Anatomy:** Intersection of two circles as the mask; quad in-out.
- **Timing:** 12 f at 60 fps.
- **Sound:** The beat (+10 ms); a glockenspiel just before.
- **Build:** Recipe: an aperture mask made of the SDF intersection of two circles, positions in closed form.

### Halves part like doors and the next card rises through

`dv-door-split-rise` · signature · energy medium · launch, feature · primitive: doorSplitState

The next card peeks up 31 px from the bottom edge as a preview, then the two halves of the current layout accelerate off left and right like doors, and the card rises through the gap. **When:** Introducing the next product surface. **Avoid:** Halves with content that splits a word.

- **Anatomy:** Peek 32 px; doors on the measured path (each step about x1.5 the last, leaving at speed); the card rides up from the bottom edge a third into the doors' run, peaks with them, decays home.
- **Timing:** Peek 12 f; doors 30 f; rise 50 f.
- **Sound:** A pop, a hit, a punchy accent.
- **Build:** doorSplitState({ start, rise: { top } }): the halves' offset and the card's `rise`; draw the card above the halves.

### Next shot opens as a window; the old shot steps back

`dv-window-step` · signature · energy medium · launch, feature · primitive: recipe (3D / shader)

A rectangle opens around the product showing the next shot at 1:1 while the old shot shrinks into a card on paper in a few held steps; or a framed photo unfolds from portrait to landscape in two stages. **When:** Product-to-world transitions; a framed image growing. **Avoid:** Smooth tweens (the steps are the look).

- **Anatomy:** Old shot 1 -> 0.94 -> 0.80 on 16 fps holds; window grows each step.
- **Timing:** 15-48 f.
- **Sound:** Sub-bass and a kick.
- **Build:** `<Window rects oldScale cadence>`.

### A text-height slot opens behind the line onto the photo

`dv-slot-behind-line` · accent · energy medium · launch, feature · primitive: recipe (plain layers)

On the word swap a hard-edged slot exactly the height of the text opens behind the line and shows the coming photo; the type flips from grey to white inside it and the lead marker becomes a selection block for one frame; later the photo fills the frame. **When:** A line that introduces imagery: a new way to see. **Avoid:** Multi-line copy.

- **Anatomy:** Slot about 9 % of the frame tall with hard edges, the photo blurred 4 px inside it; text ink -> white as the slot opens; lead marker block about 0.6 em at 40 % for 2 f; the full frame fades in 40 f later.
- **Timing:** lead marker block 2 f, slot fades in 6 f, colour flip 2 f, full frame over 40 f.
- **Sound:** The music returns on the reveal hit after a short dropout.
- **Build:** Photo clipped by an inset to the line's band, a colour step on the text, then a full-frame Photo fade.

### A colour block wipes the line on and lingers

`dv-colour-block-wipe-on` · accent · energy medium · launch, feature · primitive: recipe (3D / shader)

A block shoots across a line (its leading edge covering 400 px in 3 frames), leaving the words behind it, its trailing edge slower; on the second line it lingers on the last word, which cools from the block's colour. **When:** A tagline on. **Avoid:** A second multi-hue run in the same film.

- **Anatomy:** Lead edge fast, trail edge 3x slower; words cool 15 f.
- **Timing:** Lead 8 f; trail 23-50 f.
- **Sound:** A pop.
- **Build:** Two Wipe edges (lead and trail) with different speeds; words revealed behind the lead.
- **Conditions:** gradients baked as dithered plates and moved by transform.

### Concentric squares radiate at constant speed

`dv-radiating-squares` · accent · energy medium · launch, sting · primitive: recipe (3D / shader)

Square outline rings are born at the centre every few frames and expand at a constant speed, thick strokes and wide gaps, like a pulse leaving the centre. **When:** A hub, an end card, a "broadcast" moment. **Avoid:** Easing the expansion (constant speed is the look).

- **Anatomy:** Births every 4-6 f; 38 px/f; stroke about 75 px, gap about 98 px at birth.
- **Timing:** 70 f.
- **Sound:** None.
- **Build:** `<Radiate start x y color stroke={75} speed={15}>` (shader / 3D recipe): square (or `shape="circle"`) rings born every 10-15 f (seeded, or `births` on the beat), growing at one constant speed; `swallow={{ at }}` thickens them until only hairline gaps remain. `bornAt={54}` pops each ring in as a solid square that opens (no tiny first frame); `speeds` gives rings their own speeds (the first a little slower reads as a pulse, not a pattern); `flood={{ at }}` fills the centre with a solid square growing ×1.09 a frame until it covers the frame, the hand-off to a full-colour end card.

### A soft light band carries the old graphic out

`dv-light-band-wipe` · accent · energy medium · any · primitive: recipe (3D / shader)

The diagram slides out on an expo-in while a soft band of light travels across the frame, accelerating, taking the old graphic with it. **When:** Clearing a diagram or chart. **Avoid:** A glow that is not part of the band (a halo round type).

- **Anatomy:** Band about 0.45 of the width; ease-in.
- **Timing:** 44 f.
- **Sound:** Voice.
- **Build:** `<LightSweep frames={44} gain={0.55}>` + the diagram's exit on E.launchIn. Recipe: an SVG fractal-noise filter stretched vertically (baseFrequency 0.06 x 0.0015) coloured to the accent, masked by a horizontal gradient, translated; bake it as a plate for render speed.
- **Materials and numbers:** The light is textured: fine vertical streaks (6-20 px, plus or minus 15 % luminance) run through the band like a light curtain or a long-exposure aurora, its edge falling off to black over about 300 px; it drifts slowly, then accelerates across as the wipe (about 44 f).

### Frame halves flip to a new ground in turn

`dv-split-flip-frame` · accent · energy high · launch, sting · primitive: recipe (3D / shader)

The left half of the frame flips to a new ground for 3 frames, then the right half (the left reverting), then the whole frame. **When:** A rhythmic flip into an end section. **Avoid:** More than one per film.

- **Anatomy:** Hard halves, one beat each.
- **Timing:** 6 + 8 f, then full.
- **Sound:** A snare, then a whoosh.
- **Build:** HardStep on two half-frame layers.

### Scene emerges from white, hero first

`dv-emerge-from-white` · accent · energy calm · launch, feature · primitive: recipe (3D / shader)

A 3D room emerges from a white frame centre-out: the desk gains colour first, then the floor, the right wall, the ceiling, the window. **When:** Revealing a set or a product scene. **Avoid:** Without separable regions.

- **Anatomy:** Per region masks developing in order of importance.
- **Timing:** 24 f power-out.
- **Sound:** A reverse-cymbal riser.
- **Build:** Develop per region (each region a mask over the plate) with starts in order.
