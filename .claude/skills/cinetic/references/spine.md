# The spine: one action, carried

A launch or update film that reads as one idea follows ONE action from end to end. It is one sentence played as
3-5 acts; every act is one verb of that sentence, done to ONE case (the same request, names and numbers from the input
to the result) by ONE element whose form changes from act to act: a word becomes a pill, the pill grows into the
page, the page's button swells into a live pill, the pill flies off and lands as the first notification, the
notifications converge into a count, the count becomes the mark. Every change of scene hands that element on. A film
built as "a line, then a card, then a line, then a card" is a checklist of moments with no idea joining them; a
spine is a chain.

Read this before the beat sheet of a launch or update film. The parts: `src/lib/spine.ts` (the grammar, the plan,
the checks' contract), `src/lib/handover.ts` (the element state carried across a cut),
`scene.ts` projected bounding boxes (where each 3D hero form sits on screen), `src/fx/world` `WorldSteps` (the world's one step per act).
Numbers are 60 fps frames (`f@60`) and px at 1080p unless they say otherwise.

**Contents**

1. [The sentence and its acts](#1-the-sentence-and-its-acts)
2. [The case](#2-the-case)
3. [The element and its forms](#3-the-element-and-its-forms)
4. [Handovers](#4-handovers)
5. [Where the lines live](#5-where-the-lines-live)
6. [The world's arc](#6-the-worlds-arc)
7. [The lockup grows out of the last form](#7-the-lockup-grows-out-of-the-last-form)
8. [Rules that keep it from becoming a checklist](#8-rules-that-keep-it-from-becoming-a-checklist)
9. [Writing a spine in code](#9-writing-a-spine-in-code)
10. [Catalogue rows](#10-catalogue-rows)

## 1. The sentence and its acts

Write the film as one sentence: "[Name] [verb 1]s [the case], [verb 2]s it, [verb 3]s it." Each verb is an act.

| part     | rule                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| sentence | one action; a film that needs "and also" is two films: cut one idea                                                 |
| acts     | 3-5 for a launch (4 for 15-35 s, 5 from about 45 s); 3-4 for an update (the hook and 2-3 changes)                   |
| shares   | the first act about a quarter of the body (20-32 %), the last about a fifth (12-31 %), the middle acts the rest     |
| scenes   | 1-3 states of the element in an act, each a change of its state (cause, action, result)                             |
| changes  | every scene change hands the element on; two thirds or more of them carry it, and almost every change inside an act |
| cuts     | a bare cut (nothing carried) only as a section break between two acts, on a downbeat, once a film at most           |

An update film plays the same way: one session, the same person doing one task that uses each change in turn,
ordered by the session, not by importance ("plan Saturday's hike": see the summit, check the trail, join the group).

## 2. The case

Pick the one subject, artefact or physical action every act works on, in concrete terms from the brief: the key phrase,
the 3D hero object it awakens, the chamber or world it opens, the count or mark it resolves into. What starts in act 1
or 2 is the exact artefact paid off later; names, colours and numbers agree from act to act. Record them in `strings`
on the spine (`scripts/grid-check.ts`) so the checks can follow the thread through the film.

## 3. The element and its forms

One element id, one form per scene, never two at once. The forms are a fixed vocabulary (`src/lib/spine.ts`):

`word` · `pill` · `chip` · `button` · `card` · `page` · `window` · `list` · `notice` · `thread` · `photo` · `count` · `world` · `mark`

In a 3D film (`scene.ts`), project each shot's active hero mesh or title anchor to 1080p screen coordinates (`{ x, y, w, h, r }`) so handovers and `forensics.py --spine` track its exact screen box across cuts:

```ts
const heroBox = projectMeshBox(heroMesh, camera, W, H); // { x, y, w, h, r } in 1080p screen px at time t
```

| 3D / title anchor                                                         | spine form       |
| ------------------------------------------------------------------------- | ---------------- |
| Hero title word / key phrase                                              | `word`           |
| Callout badge / floating tag (`titles.ts` `pill` / `tag`)                 | `pill` or `chip` |
| Physical trigger / switch / rune                                          | `button`         |
| Framed plaque / callout slab (`titles.ts` `card`)                         | `card`           |
| Portal / architectural aperture / vault door                              | `window`         |
| Ensemble / array of props or shards                                       | `list`           |
| Studio plate / textured banner                                            | `photo`          |
| Live metric / countdown readout                                           | `count`          |
| Full 3D environment (`scene.ts`, `fx/world`)                              | `world`          |
| Extruded 3D brand mark / closing lockup (`fx/three/Logo3D`, `brand/Mark`) | `mark`           |

`world` is the 3D environment itself (`scene.ts` / `fx/world`), `mark` the closing lockup.

## 4. Handovers

The element passes from scene k (drawn in its frame, under its camera) to scene k + 1 (another frame, another camera)
as one object: its box, corner, fill, rim, shadow, blur and content morph from where the outgoing scene draws it to
where the incoming scene draws it, so the cut between the two scenes never shows.

How every handover moves:

- size on a log scale (a 40 px chip and a 900 px page meet at an even perceived speed); the path on a soft arc (a
  thrown element rises a little; a change in place does not arc); fill and rim mixed in OKLCH;
- the moving kinds are fastest on the cut frame, with the speed matched across it;
- content never scales: each side's content is laid out at its own size and rides the clipping box (or stays home
  while the box reveals it: an iris, a porthole). It fades (the old content out over the first 35 %, the new one in
  over the last 40 %; a grow cross-blurs round the middle) or swaps in one frame at the smallest or most blurred frame;
- blur is at most two fixed ladder copies (lib/defocus), never an animated radius;
- every value is a closed form of the frame: any frame, any order, sub-frames for the shutter.

### 4.1 The catalogue

`lead` frames before the cut (the incoming scene's first frame) and `land` frames after it, f@60; "draws" says who
draws the element during the handover (the handover itself, or the scene, with the handover declaring its track).

| id  | handover     | what carries                                                                                                         | lead + land (range)                      | use it when                                                                    | draws    |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| H1  | grow         | the element's rect, corner and fill become the next screen; the contents cross-blur                                  | 12 + 18 (24-36; a 3D swing-open to 76)   | the request becomes the result; a notice opens                                 | handover |
| H2  | shrink       | the whole scene or card collapses into a chip under a 12-20 px blur, one jump on the cut                             | 12 + 8 (10-20)                           | the whole becomes one item; a scene becomes a token                            | handover |
| H3  | swell        | a small thing swells +40-60 % and is replaced at its pre-swell size, colour kept                                     | 12 + 17                                  | a state becomes the next control: chip to word, icon to pill, status to button | handover |
| H4  | press-open   | a pressed button squeezes to 88 %, drains and opens as a window (a porthole)                                         | 22 + 36                                  | the press reveals who or what does the work                                    | handover |
| H5  | iris         | a shape from the element opens onto the next world                                                                   | 0 + 28 (fast 14-16, a brand shape to 76) | a turn: into the product, out to the world                                     | handover |
| H6  | zoom-into    | an exponential push into the element until it is the frame; the next scene keeps growing at a third of the last step | 22 + 28                                  | going inside: the screen, the photo, the app                                   | scene    |
| H7  | pull-out     | the detail is revealed as part of the bigger thing, one log-scale pull about one point                               | 30 + 48 (a snap 4-12)                    | the macro type is the whole request; the 3D mark is the lockup                 | scene    |
| H8  | fly          | the element launches on an arc and lands as the next scene's first element                                           | 14 + 22                                  | something is sent or delivered                                                 | handover |
| H9  | stay         | the element holds while its surroundings change                                                                      | 0 + 18                                   | choosing one of many; the same request, a new answer                           | scene    |
| H10 | word         | a word survives the cut and becomes the next line, the name or the mark                                              | 0 + 36 (the letter swap)                 | the case's key word becomes the claim or the name                              | handover |
| H11 | part         | the line parts; the element appears in the gap or takes a word's slot                                                | 0 + 18 (6-36; a slot take 8)             | the line names the thing; the thing arrives in it                              | scene    |
| H12 | converge     | many collapse to a point (a spark); the next element grows from it                                                   | 10 + 26                                  | many become one: results, the count, the mark                                  | handover |
| H13 | same-surface | the camera makes one front-loaded move across the same screen to the next state                                      | 0 + 36 (34-40)                           | the next step happens in the same product                                      | scene    |
| H14 | momentum     | speed only: a velocity cut or a whip, the same direction                                                             | 16 + 18                                  | a run of consequences of the same case; never between two subjects             | scene    |

### 4.2 Which handover for which forms

The first recipe of a pair is the house one; the others are dealt for variety. A pair with no recipe goes through a
chip first (shrink it into a chip scene) or through a point (converge), which are always allowed.

| from \ to     | pill / chip          | card / page / window            | button                      | notice / list    | thread | photo             | count    | world            | mark               |
| ------------- | -------------------- | ------------------------------- | --------------------------- | ---------------- | ------ | ----------------- | -------- | ---------------- | ------------------ |
| word          | swell, part          | part then grow (through a pill) | part (slot take)            |                  |        | part (porthole)   |          | part             | word               |
| pill / chip   | same-surface         | grow, fly                       | swell                       | fly              | fly    | grow (develop)    | shrink   | iris             | converge, swell    |
| card / page   | shrink               | grow, same-surface              | same-surface (push into it) | stay (isolate)   |        | zoom-into         |          | iris             | pull-out, converge |
| window        | swell                | iris                            |                             |                  | swell  | iris              |          | iris             | iris then converge |
| button        | swell                | press-open                      |                             | fly, swell       | fly    | press-open        |          | press-open, iris | swell              |
| notice / list | shrink (row to pill) | stay then grow                  |                             | momentum (a run) |        |                   | converge |                  | converge           |
| photo         | shrink               | shrink, zoom-into               |                             |                  |        | stay (world swap) |          | zoom-into        | converge           |
| count         | shrink               |                                 |                             |                  |        |                   |          |                  | converge, pull-out |
| world         | shrink               |                                 |                             |                  |        |                   |          | stay             |                    |

A chip becomes a word by a swell. A word goes to a page through a pill (the word parts, the pill appears, the pill
grows): add the pill scene.

### 4.3 Building one

Put the handover above both scenes, outside their cameras; it draws in screen px. Each side's box is that scene's
layout box put through that scene's camera: `underShot(box, shot)` for the anchor camera (lib/camera),
`underStage(box, cam, film)` for the depth stage (fx/depth), and the screens' forms for where a form is.

```ts
import { handoverDeclares, type HandoverSpec, handoverState } from "./lib/handover";

const spec: HandoverSpec = {
  kind: "grow",
  at: CUT,
  element: "artifact",
  from: { form: "pill", box: (f) => underShot(outBox(f), camK(f)), fill: face, shadow },
  to: { form: "window", box: (f) => underShot(inBox(f), camK1(f)), fill: face, shadow },
};
const state = handoverState(f, spec, film); // box, corner, fill, blur, scenes transforms at frame f
```

- Lay out outgoing and incoming anchors at their projected screen boxes at the start and end of the handover span so
  they land seamlessly on the incoming shot's hero subject.
- An iris or a camera kind takes the two scenes as `outScene` / `inScene` (full frame): the iris opens the next scene
  inside its shape; zoom-into pushes the outgoing scene into the element and opens the next one still growing; pull-out
  scales both about one point; momentum launches one and carries the next. `handoverState(f, spec, film).scenes` gives
  the exact transforms for custom 3D or `film-stage` renders.
- zoom-into: the in side's box is the frame. pull-out: the detail and its place share a shape (the 3D mark seen
  macro-close, then the lockup's mark).
- Declare it: `handoverDeclares(spec, film)` (`src/lib/handover.ts`) emits one seam at the cut, named for the handover
  (`handover:H1-grow:artifact`), with the element's box on every frame of its span; list it in `src/sync.ts` `declares()`.

## 5. Where the lines live

| place  | when                                                                                                                                              | how                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| alone  | the promise (act 1) and the claim (the last act) only, and joined: born from the element or turning into it (a swell, a word, a part, a converge) | the film's line voices (`film-stage/titles.ts`); a key word that swells into the 3D subject      |
| inside | the default between the promise and the claim: diegetic inscriptions, counters or callout tags on the 3D subject carry the words                  | diegetic plates, `titles.ts` `tag` / `pill` callouts, a word swapping in its slot                |
| around | the human line between: the 3D hero parts it, sits in it, rises in front of it, or the line sits inside a portal                                  | a porthole parting the line, giant type occluded behind the foreground 3D subject, a type window |
| over   | rare: a line over a full-bleed 3D wide shot, once a film at most                                                                                  | centred middle or lower band with >= 3:1 contrast                                                |

At most four statements in a 15-30 s film besides the product's own words. Two alone lines in a row only as a joined
pair (a word swap, a letter swap in the same slot). A line alone in a middle act with nothing joining it on either side
is an island: the film turns back into text then cards.

## 6. The world's arc

One world a film (one place or field, one ground family, one material). It changes on act cuts only, one step each,
and holds its course inside an act (or changes through the element: an iris, a zoom into a screen).

| step      | what changes                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| enter     | act 1: the camera enters the place, then the lens racks the plate soft once the element has arrived                                               |
| closer    | a step into the place: a push and a rise, fastest on the cut (it carries it), landing at the act's end                                            |
| light     | the key climbs and brightens (glass, rims and glowing type read it) and a pool of light rises from the floor                                      |
| turn      | the film's one colour or value event: a flood out of the element (a light world turns deep, a dark one pale, or the accent) that stays the ground |
| pull-back | the place wide again for the claim and the lockup: the pushes undone, a little wider                                                              |
| hold      | nothing changes; the element turns                                                                                                                |

About half the act cuts change the world; the biggest change sits at the turn act. Each move starts, travels and lands
at its act's end: the world never drifts and never stands dead between two cuts.

```tsx
<WorldSteps
  kind={world}
  src={plate}
  soft={plateSoft}
  steps={stepsFromPlan(SPINE_PLAN, { turnFrom: liveCentre })}
>
  {scenes}
</WorldSteps>
// src/sync.ts declares(): { id: 'world', ...worldStepDeclares(steps, film) }   (the moves as camera shots, the turn as a colour event)
```

## 7. The lockup grows out of the last form

The element's last form becomes the mark: the notifications converge into the count and the count into the mark, the
last screen pulls back into the 3D mark that lands on the flat lockup, a chip swells into the mark, or the case's key
word letter-swaps into the wordmark. Then the name, the one fact, a still hold of 2-3 s and the settle-out with the
music. The one other way: the mark enters with its own designed entry on the claim's kept ground. A mark cut in from a
picture, or after empty frames, carries nothing and fails.

## 8. Rules that keep it from becoming a checklist

1. **One idea**: the sentence. Every act is one of its verbs; a scene that does not move the case is cut.
2. **Devices by need**: a hero shot or creative element is chosen by its act's verb and draws the element in that act's
   form, filled from the case. awakens / opens: iris, glass-dome · builds / shapes: hero-extrude, glass-tiles · launches /
   strikes: dive, porthole · gathers / arrives: converge-swarm · chooses / isolates: rack-focus, focus-swap ·
   counts / grows: data-sculpture · reveals world: crane-down, photo-develop · connects / orbits:
   logo-orbit. A device with no verb is out.
3. **Few devices**: no more devices than acts + 1; one signature event a film, at the turn.
4. **Connected devices**: two devices in adjacent acts need a handover between their forms (a ring of photos does not
   hand to a notification stack without a collapse to a chip or a point first).
5. **Variety from the deal, not the list**: handover recipes, the world, the forms' looks and the devices are dealt by
   fit and recency; at least three handover kinds a film, one house kind leading at most 60 % of the changes.
6. **The chain sentence test**: write the cut film as "A becomes B becomes C ..." (`chainSentence(plan)` prints it).
   Every "then" between two scenes is a join to design; a film that needs "and also" is two films.

## 9. Writing a spine in code

```ts
import { planSpine, type Spine, spineDeclares } from "./lib/spine";

export const SPINE: Spine = {
  sentence: "Folio turns one sentence into a launch page that fills itself.",
  element: "request",
  case: {
    request: "A waitlist page for my Saturday ceramics class",
    result: "folio.page/ceramics",
    names: ["Saturday Ceramics"],
    numbers: ["128"],
  },
  acts: [
    {
      verb: "asks",
      scenes: ["word", { form: "pill", name: "prompt" }],
      line: { text: "Folio writes your launch page.", becomes: "pill" },
      strings: ["A waitlist page for my Saturday ceramics class"],
    },
    {
      verb: "writes",
      scenes: [{ form: "page", name: "page" }],
      strings: ["Saturday Ceramics"],
      devices: [{ id: "page-fly" }],
    },
    {
      verb: "publishes",
      scenes: [
        { form: "button", name: "publish" },
        { form: "pill", name: "live" },
      ],
      line: { text: "Live at folio.page/ceramics", place: "inside" },
      strings: ["folio.page/ceramics"],
    },
    {
      verb: "fills",
      scenes: [
        { form: "notice", name: "signups" },
        { form: "count", via: "converge" },
      ],
      line: { text: "It tells you who joins.", place: "around" },
      strings: ["128 on the waitlist"],
    },
  ],
  claim: { text: "One sentence. A full class.", join: { in: "element" } },
};
export const SPINE_PLAN = planSpine(SPINE, { fps: FPS, b, bars: 12 }); // the timeline's own b(bar, beat)
export const SEAMS = [...spineDeclares(SPINE_PLAN).seams];
```

- `planSpine` lays the acts on whole bars (the first about a quarter, the last about a fifth, or each act's `bars` /
  `share`), each act's scenes on whole beats, adds the lockup as the last scene, and gives every change a handover
  (the scene's `via`, else the pair's recipe, the least used first). `world` per act defaults to enter, closer, (light),
  turn, pull-back.
- `SPINE_PLAN` is plain data the checks read without running the film: acts, scenes, changes (frame, span, handover,
  what each carries), lines and their places, the world's steps, devices, the case, and `issues` (validateSpine: what
  breaks the grammar, what leaves it). Print `SPINE_PLAN.issues` and `chainSentence(SPINE_PLAN)` while writing.
- `spineDeclares(plan)` is one seam per change, its id naming the handover and the forms
  (`spine:H1-grow:request:pill>page`); a momentum seam carries its axis and direction.

## 10. Catalogue rows

| id                    | what it does                                                                    | where                                              |
| --------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| handover-grow         | the element's box becomes the next frame or portal, the contents cross-blurring | spine.md 4, lib/handover.ts                        |
| handover-shrink       | the whole collapses into a chip under blur, one jump on the cut                 | spine.md 4, lib/handover.ts                        |
| handover-swell        | a small thing swells and is replaced at its pre-swell size                      | spine.md 4, lib/handover.ts                        |
| handover-press-open   | the triggered rune or switch drains and opens as a porthole                     | spine.md 4, lib/handover.ts                        |
| handover-iris         | a shape from the element opens onto the next world                              | spine.md 4, fx/Iris, film-stage/transitions.ts     |
| handover-zoom-into    | the push into the element until it is the frame                                 | spine.md 4, lib/handover.ts (outScene / inScene)   |
| handover-pull-out     | the detail pulled back into the bigger thing about one point                    | spine.md 4, lib/handover.ts (outScene / inScene)   |
| handover-fly          | the element thrown on an arc, landing as the next scene's first element         | spine.md 4, lib/handover.ts                        |
| handover-stay         | the element holds while its surroundings change                                 | spine.md 4 (the scene draws it)                    |
| handover-word         | a word survives the cut and becomes the next line or the name                   | spine.md 4, lib/handover.ts                        |
| handover-part         | the line parts and the element arrives in the gap                               | spine.md 4, lib/handover.ts                        |
| handover-converge     | many meet in a spark; the next element grows from it                            | spine.md 4, lib/handover.ts                        |
| handover-same-surface | one camera move across the same world to the next state                         | spine.md 4 (the scene's camera)                    |
| handover-momentum     | a velocity cut or whip in one direction, for a run of consequences              | spine.md 4, film-stage/animate.ts, lib/handover.ts |
| world-steps           | the world's one step per act: enter, closer, light, turn, pull-back             | spine.md 6, fx/world WorldSteps                    |
