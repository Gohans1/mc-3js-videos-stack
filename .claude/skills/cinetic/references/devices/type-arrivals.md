# Type arrivals

Part of the device book: [INDEX](INDEX.md) has the pick-by-job table, the materials and VFX notes and one line for every device.

How a word, a line or a letter comes onto the screen. Pick the arrival by the job of the copy: a calm statement fades and rises, a hit pops or lands oversized, a product string decodes, typed text types like a person or a machine.

[Each word arrives on its own torn layer](#each-word-arrives-on-its-own-torn-layer) · [Typeface cycles while the line steps larger](#typeface-cycles-while-the-line-steps-larger) · [Giant word rises in, cropped by the frame](#giant-word-rises-in-cropped-by-the-frame) · [Masked roll swap with a pre-zoom](#masked-roll-swap-with-a-pre-zoom) · [Anagrams reshuffle and lock](#anagrams-reshuffle-and-lock) · [Caption resolves out of a light streak](#caption-resolves-out-of-a-light-streak) · [Old word erodes while new letters rise](#old-word-erodes-while-new-letters-rise) · [Scattered letters assemble into the word](#scattered-letters-assemble-into-the-word) · [Words fly in from behind the camera](#words-fly-in-from-behind-the-camera) · [Words jump through positions, leaving fading stamps](#words-jump-through-positions-leaving-fading-stamps) · [Word shown first as a block of its own size](#word-shown-first-as-a-block-of-its-own-size) · [Fade-and-rise word, front-loaded](#fade-and-rise-word-front-loaded) · [In-place ink-up from partial strength](#in-place-ink-up-from-partial-strength) · [Line whose stagger and fade shrink word by word](#line-whose-stagger-and-fade-shrink-word-by-word) · [Line written on behind a soft moving edge](#line-written-on-behind-a-soft-moving-edge) · [Cut on low at full ink, slide home](#cut-on-low-at-full-ink-slide-home) · [Word rises out of a baseline mask](#word-rises-out-of-a-baseline-mask) · [Word inks along a colour path](#word-inks-along-a-colour-path) · [A label rises in gradient ink, then a blink wave turns it white](#a-label-rises-in-gradient-ink-then-a-blink-wave-turns-it-white) · [Glyph scramble that locks into the word](#glyph-scramble-that-locks-into-the-word) · [Handwritten line writes on at pen speed](#handwritten-line-writes-on-at-pen-speed) · [Letters appear in random order](#letters-appear-in-random-order) · [Sans line with a contrasting-voice payoff word](#sans-line-with-a-contrasting-voice-payoff-word) · [Word decodes from a low-res pixel version](#word-decodes-from-a-low-res-pixel-version) · [Line opens room, then the key word types in](#line-opens-room-then-the-key-word-types-in) · [Pre-centred words switch on every two frames](#pre-centred-words-switch-on-every-two-frames) · [Letter-by-letter fade across a word](#letter-by-letter-fade-across-a-word) · [Set line resolves from blur left to right](#set-line-resolves-from-blur-left-to-right) · [Word flips up from a flat line](#word-flips-up-from-a-flat-line) · [Word halves slide out from behind a plate](#word-halves-slide-out-from-behind-a-plate) · [Letter spacing snaps to normal](#letter-spacing-snaps-to-normal) · [Ticker words slam in, old words cut off the edge](#ticker-words-slam-in-old-words-cut-off-the-edge) · [Words rise and drop onto one baseline with overshoot](#words-rise-and-drop-onto-one-baseline-with-overshoot) · [Word cuts on and drifts, then leaves the same way](#word-cuts-on-and-drifts-then-leaves-the-same-way) · [Taglines swap on the second with a small pop](#taglines-swap-on-the-second-with-a-small-pop)

### Each word arrives on its own torn layer

`dv-torn-layer-carrier` · signature · energy medium · launch, sting · primitive: no primitive yet (recipe below)

Each new word is printed on its own torn-paper image layer, which tears into view in stop-motion steps; the sentence builds across a stack of torn images. **When:** A crafted, editorial film with images; a statement that grows over several pictures. **Avoid:** 3D subject films.

- **Anatomy:** Layer = image + word; the tear edge advances in 4 held steps (15, 45, 72, 100 %); layers stack.
- **Timing:** Tear steps every 10 f (30-40 f per layer), layers 50-65 f apart.
- **Sound:** Paper tears within ±80 ms of beats.
- **Build:** Recipe: an SVG torn-edge mask whose reveal advances in held steps inside `<Stepped>`.
- **Materials and numbers:** Each torn layer carries its own copy of the growing sentence, so where a new layer has torn in partway the text on it and below it sit a few pixels apart and words break across the tear (the offset = half the width of the newly added word); tear edges irregular 3-6 px with hard alpha; a new layer every 20 f.

### Typeface cycles while the line steps larger

`dv-typeface-cycle` · signature · energy high · launch, sting · primitive: recipe (3D / shader)

Every 3 frames the typeface of a title swaps (serif, mono, light grotesk, heavy), while the line steps larger; it lands on the brand face. **When:** A launch about type, image or style; a title once. **Avoid:** Any film whose brand face must be respected from the first frame.

- **Anatomy:** Hard swaps of the face, the line re-centred each swap, scale stepping up.
- **Timing:** 8 swaps a second (every 7-8 f); 38 f in all.
- **Sound:** None needed; or a tick per swap.
- **Build:** `<FontCycle text at states={[{ wght, track, family }]} every60={7.5} scale={[1, 1.2]}>` (shader / 3D recipe): the word steps through font styles (regular, black, thin wide-tracked, mono, black wide, landing on the brand style) on whole frames, re-measured and re-centred on each state frame while it steps larger; no slant axis. fontCycleFrames() gives the state frames; declares() the stepped run.
- **Materials and numbers:** Only the brand word shuffles through font styles every 4-6 f (regular, black, thin extended, black extended, back to regular) while the rest of the line stays still; cap height constant, the extended styles pushing the word about 25 % wider. With a variable font this is a wght and wdth change per state; the house bans italic, so leave the slant axis out.
- **Ban-safe default:** Cycle between weights and widths of the brand family only. (the full look relies on serif; use it only when the brand supplies it)

### Giant word rises in, cropped by the frame

`dv-giant-cropped-rise` · signature · energy medium · launch, feature, sting, vertical · primitive: recipe (3D / shader)

One word so large the frame crops it (cap height 31-55 % of the frame) rises or drops into place on a steep expo-out; often the layout pans at the same time, so the path is a J-shaped swoop, or the product swaps underneath it. **When:** Opening a film or a section with one word; a word that rides over a product shot. **Avoid:** Words whose meaning depends on the cropped letters.

- **Anatomy:** A single display word at 3-6x body size; rise 330-740 px; variants: on every third frame held (stepped); with the whole layout panning left as it rises; dropping from above while a one-hue band about 1.5 letters wide travels through the letters.
- **Timing:** 17-60 f expo-out (tau about 15 f); pan 55 f on 16 fps steps; band crosses in 16 f.
- **Sound:** A spacebar-like click, or sub-bass plus kick when the product swaps under it.
- **Build:** `<Words>` at display size with rise 0.8-1 em and dur 20-60 on E.snapOut inside a cropping frame; stepped variant inside `<Stepped fps={16}>`; the band is a LightSweep clipped to the text.

### Masked roll swap with a pre-zoom

`dv-roll-swap-bracket` · signature · energy high · launch, feature, sting · primitive: recipe (3D / shader)

A word inside a bracket rolls up out of the mask while the next word rolls in from below (vertical blur on the roll), after a small anticipation zoom; the bracket grows to the new width. **When:** Swapping the key noun of a held line on a beat. **Avoid:** Swaps faster than every 1.5 s.

- **Anatomy:** Pre-zoom (anticipation), roll up/out and up/in, box 175 -> 327 px, cubic-out settle.
- **Timing:** Pre-zoom 8 f; roll 10 f; settle 14 f.
- **Sound:** A key or kick on the roll.
- **Build:** MaskRise for the incoming word, an upward launch exit for the outgoing one inside one clip; the bracket width via a 14 f tween; SnapZoom pre with a 4 % build.

### Anagrams reshuffle and lock

`dv-anagram-converge` · signature · energy medium · launch, sting · primitive: recipe (3D / shader)

Two jumbled words sit apart and every 2-3 frames their letters reshuffle (real anagrams of the target words) while they converge and lock; or one word becomes another by swapping letters one at a time. **When:** A name or a claim that is "made" in front of the viewer. **Avoid:** Long words (beyond about 8 letters it reads as noise).

- **Anatomy:** Letters re-ordered in steps, colour shifting each step; convergence on the last step; letter-swap variant: letters drop or rise a few px as they change.
- **Timing:** Steps every 4-6 f at 60 fps; 34 f; letter swap about 2 f per letter.
- **Sound:** Ticks on the steps.
- **Build:** `<Scramble steps>` (anagram stages); letter swap with Scramble order 'ltr' and steps of one letter.

### Caption resolves out of a light streak

`dv-streak-resolve` · signature · energy medium · launch, sting, vertical · primitive: recipe (3D / shader)

The next caption first exists as a thin bright horizontal streak (letters unreadable), widens, turns into a heavily smeared word, then snaps sharp: the caption is born from light rather than faded in. The exit is the same device reversed: the caption dims, gains a horizontal ghost and collapses into a wide bright streak (or a thin grey line) that vanishes. **When:** Voice-led films where captions follow the narration; the first caption after a section break; a word that grows out of the one before it. **Avoid:** Long lines; anything that must be read on its first frames.

- **Anatomy:** Stage 1 streak (a 1-4 px tall bar, 200-660 px wide, front-loaded widening), stage 2 a horizontally smeared word for 2 f, stage 3 sharp. Variant: the smear grows rightward out of the previous word on twos, then a 2-frame scramble, then sharp. Exit: dim to 40 %, ghost, collapse to a 330-600 px streak on twos, accelerating.
- **Timing:** Streak 3-15 f, smear 5 f, sharp: 8-20 f in all, stepped, front-loaded; the caption leads the spoken word by 2-16 f.
- **Sound:** No hit of its own; it rides the voice onset.
- **Build:** `<StreakResolve at text x y font light>` (shader / 3D recipe): the caption through a heavy sideways blur squeezed to a hairline with a bright core, opening over the first half of 15 f on E.whipBuild (width 0.89 -> 1.03 of the caption, height to the line: measured), then the word smeared sideways for 5 f, then sharp, one sample a frame; `exit={{ at }}` dims to 40 %, ghosts, and collapses into a widening streak on twos (18 f).
- **Materials and numbers:** Relay construction: the outgoing caption gets a trailing ghost (4 f), blurs sideways into a doubled bar (4 f), becomes a bright horizontal streak about 1100 px wide with a fainter offset copy (+40, +12 px at 35 %) for 6 f, breaks for one frame into blocky glyph fragments (a decode) and lands sharp as the next caption; on twos except the decode frame.

### Old word erodes while new letters rise

`dv-erode-and-rise` · signature · energy medium · launch, feature · primitive: recipe (3D / shader)

The old word disappears from its end, letter by letter, each blurring out horizontally, while the new word's letters rise into place behind it. **When:** Swapping one key word in a held line. **Avoid:** Words the viewer has not read yet.

- **Anatomy:** Exit letters right to left, 1-2 f each with a horizontal smear; entry letters 3 f stagger, expo-out, full opacity in 3 f.
- **Timing:** 40 f in all; new letters 20 f each.
- **Sound:** Voice.
- **Build:** `<ErodeRise from to at every60={3} frames60={6}>` (shader / 3D recipe): the old letters go right to left, each fading through one fixed horizontal blur copy (10 px), while the new word's letters rise half an em into place behind it (20 f each on E.snapOut, 2 f apart, starting 6 f in); erodeRiseState() is pure.

### Scattered letters assemble into the word

`dv-letters-scatter-assemble` · signature · energy medium · launch, sting · primitive: recipe (3D / shader)

The letters of the payoff word start scattered (random offsets above and below, grey, almost still), accelerate gently and snap into the word together, usually during a camera push. **When:** The payoff word of an act; a word in a mono or brand face. **Avoid:** Fast films (the drift needs a beat to read).

- **Anatomy:** Per letter a seeded offset (up to 330 px), slow float, then an ease-in convergence with a hard landing; grey to ink on arrival.
- **Timing:** 34-60 f; float 40 f, final convergence 13 f; each glyph expo-out when it lands.
- **Sound:** Voice; or a soft lock on the landing.
- **Build:** `<ScatterAssemble text at radius={330} float60={40} land60={13} seed>` (shader / 3D recipe): seeded offsets that drift 18 % inward over the float, then land together on a 13 f E.snapOut, grey turning to ink on landing; scatterState() is pure.

### Words fly in from behind the camera

`dv-fly-past-lens-word` · signature · energy high · launch, sting · primitive: recipe (3D / shader)

Each word starts about 10x its size (one letter fills the frame), blurred and off-centre, and shrinks into its slot: the words seem to come from behind the viewer. **When:** A tagline or a closing line on a strong beat; once per film. **Avoid:** Calm films; more than 4 words.

- **Anatomy:** Per word: scale 10x to 1, a lateral start (left, centre, right in turn), blur clearing as it shrinks; staggered.
- **Timing:** About 23 f per word, stagger 10 f, sharp by the last word's landing.
- **Sound:** The first word on a kick (+19 ms); a soft air pass per word.
- **Build:** `<Oversize from={10} dur={23} defocus={14} defocusDur={18}>` per word with an x offset that converges; stagger 10.

### Words jump through positions, leaving fading stamps

`dv-jump-echo-stamp` · signature · energy high · launch, sting, vertical · primitive: recipe (3D / shader)

Words teleport on ones through about five converging positions on their way to the final line; every visited position leaves a stamp of the word that fades out, with corner ticks riding along. **When:** A hook line that should feel like a camera-less glitch of motion; a title in a techno film. **Avoid:** Calm films; more than once.

- **Anatomy:** Positions on a converging path (progress 0, .40, .60, .66, .75, hold, 1); each stamp a copy at that position fading 0.2 per frame.
- **Timing:** 12 f at 60 fps for the jumps; stamps fade over 10 f; first jump 227-292 px.
- **Sound:** An impact on the landing.
- **Build:** `<EchoStamp at x y from={{ x: 640, y: -250 }} ticks={{ color }}>{word}</EchoStamp>` (shader / 3D recipe): on ones at 30 fps through progress 0, .40, .60, .66, .75, hold, 1 (12 f at 60); each left position leaves a stamp from 75 % that fades in 10 f; the hold leaves none; two L ticks ride the live word.

### Word shown first as a block of its own size

`dv-word-block-placeholder` · signature · energy high · launch, feature, vertical · primitive: recipe (3D / shader)

Each word first appears as a solid colour block exactly its size, then becomes the word, which drops 25 px onto the baseline; blocks can rotate through the accents' tints. **When:** A voice-led headline in a bold, graphic film. **Avoid:** Calm films; more than one line.

- **Anatomy:** Block (the word's box, one colour, 3 f) -> word; alternate words rise or drop; 1-2 words per step.
- **Timing:** 4 f per word at 60 fps; block 6 f; 4-5 f per word in a run.
- **Sound:** Voice words; a ding on the line's completion.
- **Build:** BlockStep silhouette per word (the incoming element's flat silhouette steps to the real word), or HardStep on/off frames with a rect of the measured word box.

### Fade-and-rise word, front-loaded

`dv-word-fade-rise` · workhorse · energy calm · any · primitive: recipe (3D / shader)

The default way a word arrives: it is already a third visible on its first frame and rises a third of its line box as it fades, so it reads as present at once and lands softly. **When:** Any calm statement, voice-clocked captions, the body copy of a launch or update film. **Avoid:** A beat that needs a hit (use a pop or an oversized landing), or a line already moving with the camera.

- **Anatomy:** One tween per word on opacity (from about 35 %) and y (0.2-0.8 em, house 0.33 line box). Variants: a drop from above with a short vertical smear for an energetic headline; a diagonal entry (from 54 px low and 68 px right) for a new line that rides a camera move; a second word starting one frame after the first on the same curve so a two-word opener reads as one object.
- **Timing:** Fade 32 f on a steep ease-out (50 % at 10 % of the time, 90 % by 15 f), rise 22-25 f. Stagger 8-14 f on a reading cadence; 2 f for a two-word opener; 8-14 f for a voice-clocked caption. Travel 23-77 px at 1080p.
- **Sound:** Words sit on voice onsets; with no voice, one soft tick per fragment on the last word's landing, never one per word.
- **Build:** `<Words>` at house numbers (dur 32, rise 0.33 line, stagger 12, cadence 'reading'); a drop uses riseDir up with a 2-frame vertical ghost; a diagonal entry offsets x by 1.2x the rise.
- **Materials and numbers:** Floor-reflection variant: each word rises into place trailing a faded, vertically flipped copy under it (blur 1 px, 40 % decaying to 0 in 8 f) as if it rose out of a glossy floor, the word itself going from 50 to 100 % white.

### In-place ink-up from partial strength

`dv-ink-in-place` · workhorse · energy calm · any · primitive: recipe (3D / shader)

Words or rows appear exactly in their final place, already 29-60 % strong on the first frame, and ink up to full with no movement at all; several words are often mid-fade together. **When:** Dense layouts (a page, a card, data rows, captions on photos) where motion would fight the layout, and small UI copy. **Avoid:** A hero line that needs energy; long lines that would all be half-inked at once.

- **Anatomy:** Opacity only (or a colour from the panel tint or a light grey to the ink). Variants: words land grey and snap to full ink on the frame the next word lands (the recency snap); data rows dim then bright 1-2 f apart; pairs of two words at a time for small UI copy; side words fading in 7 f after a hit.
- **Timing:** First frame 29-60 % (house 38 %); 90 % by 10-20 f, full by 20-32 f on an expo-out. Stagger 4-12 f per word; lines 5-8 f apart; rows 2-4 f apart; a recency snap is one frame.
- **Sound:** Key or click ticks on word onsets for a typed feel, otherwise none.
- **Build:** `<Words rise={0} dur={20} stagger={8}>` with the first-frame strength set by the ease (E.snapOut gives about 35 %); colour-from-tint via accent = the panel tint and accentHold 0.

### Line whose stagger and fade shrink word by word

`dv-accelerating-cadence` · workhorse · energy medium · any · primitive: recipe (3D / shader)

Each later word starts sooner and fades faster than the one before, so the line gathers speed into its payoff (often the brand name). **When:** A payoff line, the last line of an act. **Avoid:** Every line (one accelerating run per act).

- **Anatomy:** Geometric gaps (0.30, 0.23, 0.13, 0.10 s), fades shortening with them; variant: words cut on and slide only their last 10-12 px.
- **Timing:** Gaps 18 -> 6 f at 60 fps; second line fades 12 f with 6-8 f stagger.
- **Sound:** A stab on word 1; or none.
- **Build:** `<Words cadence="accelerate" accelTo={0.4}>`.

### Line written on behind a soft moving edge

`dv-soft-edge-write-on` · workhorse · energy calm · any · primitive: recipe (3D / shader)

A line is revealed left to right by a soft travelling edge, near-constant speed, so it washes on; glyphs can be born in a hot accent and cool; a status line can end with a spinner turning into a check. **When:** Status lines, single lines over a picture. **Avoid:** Edges narrower than a letter (that reads as a hard wipe).

- **Anatomy:** Soft alpha ramp about 70 % of the element; glyphs accent -> ink as the edge passes.
- **Timing:** 6-24 f across 880 px (first 4 f slower); fall-off 56 f.
- **Sound:** A soft notification ding mid-reveal, or a kick at the end.
- **Build:** `<Wipe kind="gradient">` on the line; accent via HueSweep or Words accent.

### Cut on low at full ink, slide home

`dv-pop-low-slide` · workhorse · energy medium · any · primitive: recipe (3D / shader)

A word cuts on at full opacity a little below (or beside) its slot and slides home on an exponential, so the first frame is a clean hit and the motion is pure settle. **When:** Punchier copy on a beat, headline words on a coloured field, a word that should touch the one before it. **Avoid:** Very large type (the cut-on jump reads as a glitch above about 60 px of offset).

- **Anatomy:** Opacity 1 from frame one; offset 0.27-0.45 of the cap height (18-56 px at 1080p) below or 66 px to the right; variant: two linear frames of 104 px before the expo tail for a word that must travel far (259 px); variant: slide left until it touches the previous word.
- **Timing:** Settle 10-38 f expo-out; stagger 2-5 f; a far travel uses 2 linear frames then 20 f expo.
- **Sound:** Each word on a kick or a soft tick; a run of words gets one sound.
- **Build:** `<Words dur={1} rise={0.45} riseUnit="em" riseDur={22} riseEase={E.snapOut} stagger={5}>`; for a side entry rotate the rise direction.

### Word rises out of a baseline mask

`dv-mask-rise-word` · workhorse · energy medium · any · primitive: recipe (3D / shader)

Each word rises from behind an invisible baseline mask while going grey to ink; the last word takes twice as long; verb-plus-object lines can follow with a 3 f lag. **When:** Short commands, verbs on hits, any line that should feel cut and precise. **Avoid:** Long lines (the masked rise loses its snap).

- **Anatomy:** Rise of about 90 px from under the baseline, ink from grey; variant: staggered hard exit.
- **Timing:** Rise 18-20 f; second word 6 f behind; exit 14 f; lines 60 f apart.
- **Sound:** Hits on each verb.
- **Build:** `<MaskRise lastScale={2} ink>`.

### Word inks along a colour path

`dv-hue-path-ink` · accent · energy calm · launch, feature · primitive: recipe (3D / shader)

Each new word appears at full size but pale and walks along a colour path into the ink, letter by letter from one end; the colour change is the reveal. **When:** A text-led opener, an AI line that should feel generated, a keyword. **Avoid:** More than one per act; a full rainbow walk (it reads as a template).

- **Anatomy:** Lightness held first, then darkened through the accent into the ink; the front crosses the word with the right end leading (or right to left for a cooling ramp); variant: the first word nudges 18 px into centre while it colours.
- **Timing:** 18-20 f per word, onsets 20-24 f apart; a ramp front of 13 f with a 30 f tail; AI lines 28-44 f each.
- **Sound:** A soft whoosh on the first word; word cadence off the beat.
- **Build:** `<TypeFill mode="band" text stops={spectralInk(ink)} from={1} to={0} dur={48}>` (shader / 3D recipe): a spectral run that leaves ink behind it; the default run is the cool side of the wheel, FULL_SPECTRUM (fx/plates) for a brand that owns a rainbow; `<HueSweep>` stays the one-hue path.
- **Materials and numbers:** A wide spectral band slides right to left through the label and leaves ink behind: the line arrives as a horizontal rainbow (yellow, orange, magenta, red, olive), the band (about three times the label's width) slides left on a bezier (0.37, 0.13, 0.26, 0.95) at about 12 px/f, so mid-move the line reads warm at its end and cool at its start, and the tail of the band is ink. Ten stops from warm to green, teal, blue, navy and ink.
- **Material layer:** no primitive yet for the material; until there is one, build it from the recipe above.
- **Conditions:** gradients baked as dithered plates and moved by transform; the film's one spectral accent.

### A label rises in gradient ink, then a blink wave turns it white

`dv-tinted-then-white-blink` · accent · energy medium · launch, feature · primitive: recipe (3D / shader)

A small label rises from a baseline mask filled with the same gradient as the card behind it, so it is almost camouflaged; then a wave passes left to right: each letter blinks out for a few frames and comes back pure white, so for a moment the word reads white, gap, tinted. **When:** A label on a gradient or tinted card; a product name inside a 3D slab. **Avoid:** Long copy; plain grounds (the camouflage needs the gradient behind).

- **Anatomy:** Rise 12 f; tinted hold 16 f (text clipped to the card's gradient at about 0.8); dropout wave about 4 f apart per letter, each letter off for 4 f, then white.
- **Timing:** About 76 f in all.
- **Sound:** A soft tick per letter, or none.
- **Build:** `<MaskRise>` for the rise, then `<TypeFill mode="swap" text stops stagger={4} gap={4} color="white">` (shader / 3D recipe); the dropouts are declared stepped.

### Glyph scramble that locks into the word

`dv-glyph-scramble-lock` · accent · energy medium · launch, feature, sting · primitive: recipe (3D / shader)

Random glyphs (letters, digits, symbols) cycle in each slot and lock into the word, left to right or out of order, with exactly one accent glyph at a time; a sentence can scramble out the same way. **When:** A product name, a code, a version, a title once per film. **Avoid:** Running copy; more than once per film.

- **Anatomy:** Per slot 10 changes a second, locking in order; one glyph in the accent; variants: arrow or symbol glyphs decoding into a wordmark, each new letter accent first then all ink; a sentence dropping out to random glyphs while the title resolves in the accent and flips to ink.
- **Timing:** A state every 6 f (10 Hz); 7 states over 38 f; decode out 13 f, in 10 f, colour flip 1 f.
- **Sound:** A UI pop on the scramble's start; the title can land in a stop-down silence.
- **Build:** `<Scramble rateHz={10} order="ltr">` (or 'random'); accent glyph via the accent prop; declares the span stepped.
- **Materials and numbers:** Two constructions. Halo scramble: the word cycles through whole random glyph sets, each held exactly 6 f (10 Hz), inside a soft white halo (a blurred copy at 20 px, 45 %, screen) with the scrambling accent glyphs carrying a smaller accent glow; the halo switches off on the lock frame as a cut, while the word settles from 1.2x to 1.0. Positional scramble: letters keep their slots, random letters drop out, foreign glyphs and ligatures appear in the gaps, then the new string resolves through a pale tint for one state before the ink (about 4 f per state).

### Handwritten line writes on at pen speed

`dv-signature-write-on` · accent · energy calm · launch, feature · primitive: recipe (3D / shader)

A monoline handwritten signature draws left to right at a constant pen speed on a card; it can write twice as cards swap. **When:** Personal, signed, approved moments. **Avoid:** Fonts pretending to be handwriting.

- **Anatomy:** One SVG stroke, dash offset at constant speed.
- **Timing:** 52-67 f linear per write; card swap 37 f overlapping by 12 f.
- **Sound:** A soft pen scratch.
- **Build:** SVG path with stroke-dashoffset from strokeDrawn() (65 px a frame at 60 fps) or a linear tween.

### Letters appear in random order

`dv-random-order-letters` · accent · energy calm · feature, walkthrough · primitive: recipe (3D / shader)

The letters of a label or status line appear one by one in a shuffled order (each faint first, then full) until the word is whole. **When:** A button label appearing, an "Analyzing..." status line. **Avoid:** Headlines.

- **Anatomy:** Seeded permutation of letter onsets; each letter faint -> full in 2-4 f.
- **Timing:** 24-32 f for a line (about one letter a frame) on an ease-in count.
- **Sound:** Voice or none.
- **Build:** `<ScatterAssemble text at order="random" radius={0} stagger60={2}>` (shader / 3D recipe): each letter appears faint (35 %) at its own shuffled onset and turns full as it lands; orderRanks() gives ltr, rtl, centre or a seeded random order.

### Sans line with a contrasting-voice payoff word

`dv-contrast-voice-pair` · accent · energy calm · launch, feature · primitive: recipe (3D / shader)

A short phrase pairs a plain sans word with a payoff word in a contrasting voice (a handwritten script, a serif italic, small caps); the contrasting word enters 5-7 frames later. **When:** "No X." style lists; editorial films. **Avoid:** Films whose brand has one family only.

- **Anatomy:** Sans word blur-fade-rise; contrasting word later; varied exits; a one-frame blank between phrases; variant: display caps fading in while a small italic connector types.
- **Timing:** Entry 10-16 f; contrasting word +10-14 f; hold creeping 146 f.
- **Sound:** A quiet breath before each cut.
- **Build:** `<Words>` with the payoff word in the second face and its own start.
- **Ban-safe default:** Contrast by weight and size within the brand family (light vs heavy, or a mono payoff word). (the full look relies on serif, italic; use it only when the brand supplies it)

### Word decodes from a low-res pixel version

`dv-resolution-ladder-decode` · accent · energy medium · launch, sting · primitive: recipe (3D / shader)

A word appears as a coarse low-resolution pixel version in the accent, then half-resolved in a pale tone, then crisp in the ink, one frame each, and settles with a small posterised overshoot. **When:** Words in a film about images, rendering or AI generation. **Avoid:** Small type (the low-res stage is unreadable mush below about 60 px).

- **Anatomy:** Three resolution states, colour accent -> pale -> ink; a stepped spring settle.
- **Timing:** Decode 7 f (one state per 2-3 f at 60 fps); settle 7 f on twos.
- **Sound:** A drum on the decode, a kick on the settle.
- **Build:** `<Pixelate>` in-phase only on the word with a three-size ladder (pixelLadder of 3 sizes) and the colour stepped per state.

### Line opens room, then the key word types in

`dv-room-then-type` · accent · energy calm · launch, feature · primitive: recipe (3D / shader)

A held line accelerates sideways to open room, then the key word types in letter by letter in the accent, and the line leaves with blur. **When:** The key word of a statement. **Avoid:** Room moves slower than the typing.

- **Anatomy:** Pre-shift accelerating (-2 -> -36 px/f), typing about one letter a frame, exit left with blur.
- **Timing:** Pre-shift 20 f; typing 20 f; exit 12 f.
- **Sound:** Voice.
- **Build:** `<LineSnap mode="room">` then `<TypeOn kind="human">` in the opened slot; exit 'launch'.

### Pre-centred words switch on every two frames

`dv-slot-pop-on-twos` · accent · energy high · launch, feature, sting, vertical · primitive: recipe (3D / shader)

Words appear in one frame each, at full ink, in the slots of a line that is already laid out and centred, one every 2 frames (12 words a second); they can be erased in the same order. **When:** A fast opener, a title that rides a camera move, hit captions over footage, huge words on a full accent field. **Avoid:** Calm films; lines longer than 5 words (the build becomes a flicker).

- **Anatomy:** Final layout solved first, words cut on in reading order, no fade, no scale; variants: huge left-aligned words (66 % of the frame width, 190 px tall) on the accent field; 10-frame steps for a slow caption; hit captions held 12-25 f and cut off in one frame.
- **Timing:** 5 f at 60 fps per word (2 f at 24-30 fps); erase 5 f apart in the same order; slow version 10 f per word; hit captions hold 30-60 f.
- **Sound:** The completed phrase lands on a kick; hit captions sit on hits or in a stop-down silence.
- **Build:** `<Words dur={1} rise={0} stagger={5}>` (Words lays out the final centred line); erase with exit 'words' at 5 f; hit captions are HardStep on/off frames.

### Letter-by-letter fade across a word

`dv-letter-fade-sweep` · accent · energy calm · launch, feature · primitive: recipe (3D / shader)

A word fades in letter by letter from left to right, about one letter a frame, each with a short fade; trailing letters can rise in one at a time while the line moves. **When:** An "Introducing" over a photo; the end of a line entering at the frame edge. **Avoid:** Body copy.

- **Anatomy:** Each letter a 4-8 f fade (and optionally a 60 px rise at 50 % white); 1-2 f apart.
- **Timing:** 30 f for 11 letters; trailing letters 13 f with 1.5 f stagger.
- **Sound:** A water-drop on the start.
- **Build:** `<Letters mode="pop">`, or on huge words `<TypeFill mode="develop" fronts={[{ color: pale }, { color: mid }, { color: ink }]}>` for the soft luminance front.
- **Materials and numbers:** On huge words the newest letters develop through a soft luminance front rather than whole-word fades: a ramp ink -> mid grey -> pale over 4-5 letters (about 350 px at a 150 px cap height) runs across the line at 12-20 px/f, matching the camera pan, while new words still rise about a third of a line.
- **Material layer:** no primitive yet for the material; until there is one, build it from the recipe above.

### Set line resolves from blur left to right

`dv-focus-travel-line` · accent · energy calm · launch, feature · primitive: recipe (3D / shader)

The whole line is laid out at once but only the first words are sharp; sharpness travels across it left to right, and the last word closes a gap as it sharpens. **When:** A sentence that reads in one sweep; a calm opener. **Avoid:** Lines the viewer has to wait for.

- **Anatomy:** Per-word blur and opacity by position; last word gap close.
- **Timing:** Sweep 34 f; gap close 16 f; continuous drift.
- **Sound:** None.
- **Build:** `titles({ preset: "glide", text, at })` or per-word focus-rack sweep with the line split into words.
- **Materials and numbers:** Separate soft word plaques the colour of the stage, defined by a subtle contact shadow (0 6px 18px at 8 %) and an inner top rim highlight (0 -2px 6px white at 90 %); no hard borders.

### Word flips up from a flat line

`dv-flip-up-word` · accent · energy medium · launch, feature · primitive: no primitive yet (recipe below)

A word flips up about its baseline from a flat line (rotateX) while rising and darkening. **When:** A word that should feel lifted off the page. **Avoid:** Thin type (the flat phase disappears).

- **Anatomy:** Glyph height 12 -> 57 px in 3 frames, rise 66 px, grey to ink.
- **Timing:** Height 8 f, position 25 f, colour 20 f.
- **Sound:** None.
- **Build:** Recipe: rotateX(90deg -> 0) about the baseline with perspective 800 px plus the Words rise.

### Word halves slide out from behind a plate

`dv-split-word-emerge` · accent · energy calm · launch, feature · primitive: recipe (plain layers)

The two halves of one word emerge from under a plate (masked by it) and drift outward, the word opening around the object. **When:** A word that wraps a product or a dock. **Avoid:** Words that split badly.

- **Anatomy:** Two halves clipped by the plate's edge, drifting apart.
- **Timing:** 40 f ease-out.
- **Sound:** None.
- **Build:** Recipe: two word groups inside an aperture mask that excludes the plate, translated outward on E.snapOut.

### Letter spacing snaps to normal

`dv-tracking-snap` · accent · energy medium · launch, feature, sting · primitive: recipe (3D / shader)

A word appears too tight (letters overlapping) or too loose and snaps or tracks in to its normal spacing. **When:** Words on cards in a fast cut sequence; a small subtitle settling under a figure. **Avoid:** Long sentences.

- **Anatomy:** Tracking from 78-83 % or 102-128 % of the word's width to 100 %, on 16 fps steps or an ease-out.
- **Timing:** 8-15 f on steps; a slow track-in 20 f.
- **Sound:** The hard cut.
- **Build:** `<Letters tracking>` (house +0.024 em closing over 20 f) or Wordmark trackingState.

### Ticker words slam in, old words cut off the edge

`dv-ticker-slam` · accent · energy high · launch, sting · primitive: recipe (3D / shader)

Each new word enters from the right with a huge first-frame jump (135-290 px) and an expo tail; the older words are pushed left and cut off by the frame. **When:** A rapid list of verbs or features on hits. **Avoid:** Copy that must be read in full.

- **Anatomy:** Jump frame + tail per word, the line shifts by the new word's width; exits on single frames at the left edge.
- **Timing:** 2 f jump + 12 f tail per word.
- **Sound:** A hit per word.
- **Build:** `<Chain recentre="jump" ink="pop" edgeMask={{ left: 0 }}>` with the line anchored right.

### Words rise and drop onto one baseline with overshoot

`dv-baseline-converge-overshoot` · accent · energy medium · launch, feature, sting · primitive: recipe (plain layers)

One word rises from below and the next drops from above onto a shared baseline, each landing with a real overshoot, while the background pans with a pulse. **When:** A playful two-word title on a coloured field. **Avoid:** A film that already spends its one spring elsewhere.

- **Anatomy:** Alternate directions; landing overshoot 11-19 %, zeta 0.46-0.57; a 2-step rise.
- **Timing:** Landings 12-22 f; pan 72 f.
- **Sound:** A kick on the first landing, onsets per word.
- **Build:** Recipe: per word a damped spring on y (SPR.landing) from ±0.8 em.

### Word cuts on and drifts, then leaves the same way

`dv-cut-on-drift` · accent · energy calm · any · primitive: recipe (3D / shader)

Labels appear in one frame at full ink and keep drifting (diagonally apart, or sideways on an expo-out), hold briefly and accelerate out along the same line. **When:** Two labels that relate (a pair of words apart in the frame); a single word between scenes. **Avoid:** Text that must sit still to be read.

- **Anatomy:** Cut-on (1 f fade), drift 60-70 px, short hold, launch exit.
- **Timing:** Drift 26-68 f; hold 8 f; exit 16 f accelerating (2, 4, 8, 14 px...).
- **Sound:** Each label near a beat.
- **Build:** `<Words dur={1} rise={0}>` inside a drift transform; exit 'launch' along the drift.

### Taglines swap on the second with a small pop

`dv-tagline-metronome` · accent · energy calm · launch, vertical · primitive: recipe (3D / shader)

Small taglines replace each other exactly every second; the new one appears slightly small and pops to size in 2 frames while its contrast rises. **When:** A run of short claims over a photo. **Avoid:** More than about four swaps.

- **Anatomy:** Hard swap; scale 0.88 -> 1 in 2 f; contrast up over 16-28 f.
- **Timing:** Every 60 f; pop 2 f.
- **Sound:** On round seconds, not on beats.
- **Build:** HardStep swaps every 60 f; scale via a 2 f tween; opacity contrast over 20 f.
