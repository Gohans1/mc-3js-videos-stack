# Collage and composition

Part of the device book: [INDEX](INDEX.md) has the pick-by-job table, the materials and VFX notes and one line for every device.

Frames built from many parts: four live panels, stop-motion collages, objects popping around a word, one layout shared by a before and an after.

[Four de-synchronised mini-films in a gutterless grid](#four-de-synchronised-mini-films-in-a-gutterless-grid) · [One composition rule per act](#one-composition-rule-per-act) · [Hard split: image half, text half](#hard-split-image-half-text-half) · [Objects pop around a word at full size](#objects-pop-around-a-word-at-full-size) · [A set of physical objects as the film's vocabulary](#a-set-of-physical-objects-as-the-films-vocabulary) · [Cards flick onto a pile](#cards-flick-onto-a-pile) · [Tiles in a mixed shape vocabulary](#tiles-in-a-mixed-shape-vocabulary)

### Four de-synchronised mini-films in a gutterless grid

`dv-quad-grid-films` · signature · energy high · loop, launch, feature · primitive: recipe (plain layers)

The frame is split into four panels with no gutters (or near-invisible hairlines), each running its own mini-film in its own style; cuts happen in one panel at a time on an irregular clock (never two on the same frame, at least two panels always moving); motifs echo across panels; near the loop's end the panels relay scenes to each other so the loop never visibly restarts. **When:** Social loops and hero loops that must show breadth; feature reels. **Avoid:** Synchronised cuts across panels; 9:16 frames (panels get too small).

- **Anatomy:** Panels 960 x 540 at 1080p; per-panel state changes about every 1 s; cut gaps 12-88 f at 60 fps, irregular; a motif from one panel reappearing (inverted) in another.
- **Timing:** Panel cuts 12-88 f apart; relays 16 f apart at the loop end.
- **Sound:** One shared bed; pane cuts driven by SFX onsets (whooshes, pops, keypresses), not the beat.
- **Build:** Recipe: CSS grid 2x2, each cell a scaled 1920x1080 composition in `<Loop>` with awkward periods; merge all cut frames and nudge apart any within 6 f.

### One composition rule per act

`dv-act-composition-rule` · workhorse · energy calm · any · primitive: recipe (plain layers)

An act keeps exactly one centred object on black for its whole length (a dot, a line, a triangle, a prism), then the next act flips to an off-centre cropped UI: the composition change marks the act change. **When:** Films with a construction act and a product act. **Avoid:** Mixing the two rules within one act.

- **Anatomy:** Centred single object vs off-centre crop.
- **Timing:** Acts of 2-3 s.
- **Sound:** A section change on the switch.
- **Build:** Recipe: a layout rule per act in the timeline.

### Hard split: image half, text half

`dv-hard-split-screen` · workhorse · energy calm · any · primitive: recipe (plain layers)

The frame divides vertically: one half a mockup or picture, the other half a ground with type; the image half can carry a stepped dithered border. **When:** Product plus claim, side by side. **Avoid:** Centred copy in the text half (left-align it).

- **Anatomy:** 50/50 split; cuts swap both halves together.
- **Timing:** About 95 f per pair.
- **Sound:** Cuts on beats.
- **Build:** Recipe: two viewport-clipped 50 % stage halves with their own content.

### Objects pop around a word at full size

`dv-pop-around-word` · accent · energy high · launch, feature · primitive: recipe (3D / shader)

Around a word or a stacked lockup, sticker objects, ad images or tilted 3D badges pop on at full size, no scale or fade, staggered by 1-4 frames (one settles 7 px), framing the word with context. **When:** Showing what a word covers (integrations, formats, uses). **Avoid:** More than about eight objects.

- **Anatomy:** Cut-ons at full size; tilts 5-15 deg; lines 2-3 f apart.
- **Timing:** 1 f each; 1-4 f stagger.
- **Sound:** Chat pops.
- **Build:** HardStep visibility per object, positions laid around the word's box.
- **Materials and numbers:** The chips pop exactly where the next words land, so for about 20 f the sentence is tangled with the logos (text over chips, no knockout; chips tilted -25 to +20 deg, white pills with a 1 px border at 6 % and a 6 % shadow); then the chips drift about 220 px upward on an expo-out and the line clears (cleared by 0.7 s).

### A set of physical objects as the film's vocabulary

`dv-object-vocabulary` · accent · energy calm · launch, feature · primitive: recipe (3D / shader)

Logos become die-cut stickers with a white border and a soft shadow lying on a cutting mat; letters sit on square tiles that drift apart radially under a pull-back, each at its own speed. **When:** Tabletop, crafted films. **Avoid:** Mixing object styles.

- **Anatomy:** Sticker border 6-8 px, contact shadow; tiles about 70 px each with one letter.
- **Timing:** Static, or a radial drift over 36 f.
- **Sound:** None.
- **Build:** Cutouts with paper border; tiles as Cards with radial drift.

### Cards flick onto a pile

`dv-card-pile-on` · accent · energy medium · launch, feature · primitive: recipe (3D / shader)

New photo cards pop onto the top of a fanned stack one after another, each starting small and motion-blurred, the cadence decaying until the cut; inside a framed screen, cards spin in toward level, pile up and orbit as a ring. **When:** Accumulation: saves, uploads, picks. **Avoid:** Even cadence.

- **Anatomy:** Arrival 6 f each; one card every 9-10 f, decaying; spin 10 f; orbit 100 f in two pushes.
- **Timing:** 60-110 f.
- **Sound:** A beat bed; a wood-block hit.
- **Build:** Cards cardArrive (rot, scale from 0.7) with starts on a decaying list.
- **Materials and numbers:** A new card is born inside the face of the current top card: small (35 % of a card) and heavily blurred (20 px for 2-4 f) over its right half, it grows and turns toward the viewer (yaw 15 -> 5 deg in perspective) and lands as the new top card with a soft drop shadow appearing; about 12 f per card, one every 24 f.

### Tiles in a mixed shape vocabulary

`dv-shape-vocabulary` · accent · energy calm · any · primitive: recipe (plain layers)

A layout uses a small set of shapes (circles, a rounded square, pills, photos with asymmetric corners), flat colour blocks mixed among photos, tinted photo cards, coloured tag chips and side accent bars, all cropped by the frame. **When:** Bento and collage layouts that should feel designed, not templated. **Avoid:** Every tile the same radius.

- **Anatomy:** Mixed radii (one corner fully round, others small); colour blocks 40-120 px.
- **Timing:** Static after the unfold; tags pop 4-8 f.
- **Sound:** Pops and a ding.
- **Build:** Recipe: per-tile corner-radius arrays on rounded-rect geometry; colour blocks as slabs.
- **Materials and numbers:** Every frame device is drawn from the logo's parts before the logo appears: the photo mask, the hairline caption frames, the pair of circles and the blobs are the mark's rounded rect, its circular cut-out and its dot; a construction drawing shows the primitives with anchor nodes; the film resolves on their assembly.
