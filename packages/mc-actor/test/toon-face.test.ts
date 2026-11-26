import { expect, test } from "bun:test";

import { MOODS, mouthAt } from "../src/player";
import {
  blendFace,
  cuteFace,
  drawToonFace,
  drawToonMarks,
  EXPRESSION_GROUPS,
  EXPRESSIONS,
  feel,
  FEELINGS,
  fromGame,
  mix,
  resolveFace,
  talk,
  TOON,
  toonLandmarks,
  withBlink,
} from "../src/toon-face";

test("a side override changes only that side's eye", () => {
  const face = resolveFace({ eye: { open: 0.5 }, L: { eye: { open: 0 } } });
  expect(face.eyes.L.open).toBe(0);
  expect(face.eyes.R.open).toBe(0.5);
});

test("a face built from a preset keeps the preset's values it does not override", () => {
  const face = resolveFace({ from: "laugh", mouth: { tongue: 0 } });
  expect(face.mouth.tongue).toBe(0);
  expect(face.mouth.open).toBe(resolveFace("laugh").mouth.open);
  expect(face.eyes.L.open).toBe(resolveFace("laugh").eyes.L.open);
});

test("a mistyped field is refused with its path, so a preset never silently draws the default", () => {
  expect(() => resolveFace({ eye: { opne: 1 } } as never)).toThrow("eye.opne");
});

test("an unknown preset name is refused with the names that exist", () => {
  expect(() => resolveFace("laugh-hard")).toThrow("laugh");
});

test("inherited property names are refused like any unknown preset or feeling", () => {
  for (const name of ["constructor", "toString", "__proto__"]) {
    expect(() => resolveFace(name)).toThrow(`no expression "${name}"`);
    expect(() => feel(name, 1)).toThrow(`no feeling or expression "${name}"`);
  }
});

test("every shipped expression resolves to finite numbers", () => {
  for (const name of Object.keys(EXPRESSIONS)) {
    const face = resolveFace(name);
    const numbers = JSON.stringify(face).match(/-?\d+(\.\d+)?(e-?\d+)?|null|NaN|Infinity/g) ?? [];
    expect(numbers.filter((n) => n === "null" || n === "NaN" || n === "Infinity")).toEqual([]);
  }
});

test("blending half way puts numbers half way between the two faces", () => {
  const a = resolveFace({ mouth: { open: 0 } });
  const b = resolveFace({ mouth: { open: 1 } });
  expect(blendFace(a, b, 0.5).mouth.open).toBeCloseTo(0.5);
});

test("an eye shape cannot be half a heart: it switches at the blend's middle", () => {
  const a = resolveFace({ eye: { shape: "eye" } });
  const b = resolveFace({ eye: { shape: "heart" } });
  expect(blendFace(a, b, 0.49).eyes.L.shape).toBe("eye");
  expect(blendFace(a, b, 0.5).eyes.L.shape).toBe("heart");
});

test("a game-face blink shuts the toon eyes", () => {
  const face = fromGame(MOODS.neutral, mouthAt([], 0), 1, [0, 0]);
  expect(face.eyes.L.open).toBe(0);
  expect(face.eyes.R.open).toBe(0);
});

test("a game-face smile curls the toon mouth up and a frown down", () => {
  const happy = fromGame(MOODS.happy, mouthAt([], 0), 0, [0, 0]);
  const sad = fromGame(MOODS.sad, mouthAt([], 0), 0, [0, 0]);
  expect(happy.mouth.curve).toBeGreaterThan(0);
  expect(sad.mouth.curve).toBeLessThan(0);
});

test("talking opens the mouth on an open viseme and keeps the mood's smile", () => {
  const smile = resolveFace("smile");
  const speaking = talk(smile, mouthAt([[0, "D"]], 1));
  expect(speaking.mouth.open).toBeGreaterThan(smile.mouth.open);
  expect(speaking.mouth.curve).toBe(smile.mouth.curve);
});

test("talking on the rest viseme leaves the mood's mouth as it was", () => {
  const smile = resolveFace("smile");
  expect(talk(smile, mouthAt([[0, "X"]], 1)).mouth).toEqual(smile.mouth);
});

test("a short P, B, or M cue seals an open toon mouth while idle keeps the expression", () => {
  const face = resolveFace("happy-talk");
  const cues = [[0, "D"], [1, "A"], [1.07, "D"], [2, "X"]];
  expect(talk(face, mouthAt(cues, 1)).mouth.open).toBe(0);
  expect(talk(face, mouthAt(cues, 1.03)).mouth.open).toBe(0);
  expect(talk(face, mouthAt(cues, 1.07)).mouth.open).toBeGreaterThan(0);
  expect(talk(face, mouthAt(cues, 2)).mouth).toEqual(face.mouth);
});

test("the cute range turns a menacing face into a sweet one pulling a face, and leaves a mild one alone", () => {
  const menacing = resolveFace({ brow: { tilt: -70, curve: 0 }, eye: { pupil: 0.3, tilt: -25 }, mouth: { skew: 1, width: 1.6 } });
  const soft = cuteFace(menacing, TOON.cute!);
  expect(TOON.brow.tilt + soft.brows.L.tilt).toBe(TOON.cute!.browTilt[0]);
  expect(soft.brows.R.curve).toBe(TOON.cute!.browCurve);
  expect(soft.eyes.L.pupil).toBe(TOON.cute!.pupil);
  expect(soft.eyes.R.tilt).toBe(-TOON.cute!.eyeTilt);
  expect(soft.mouth.skew).toBe(TOON.cute!.skew);
  expect(soft.mouth.width).toBe(TOON.cute!.mouthWidth);
  expect(cuteFace(resolveFace("laugh"), TOON.cute!)).toEqual(resolveFace("laugh"));
});

test("a blink shuts open eyes to the resting lid line, not a happy arch, and leaves already-shut eyes alone", () => {
  const blinking = withBlink(resolveFace("neutral"), 1);
  expect(blinking.eyes.L.open).toBe(0);
  expect(blinking.eyes.L.closed).toBeCloseTo(resolveFace("content").eyes.L.closed);
  expect(withBlink(resolveFace("laugh"), 1)).toEqual(resolveFace("laugh"));
});

test("a full blink closes symbolic open eyes and keeps expressions that already squeeze an eye shut", () => {
  for (const name of ["excited", "love", "greedy", "dizzy", "clueless"]) {
    const face = resolveFace(name);
    expect(withBlink(face, 0)).toEqual(face);
    const closed = withBlink(face, 1);
    expect(closed.eyes.L.shape).toBe("eye");
    expect(closed.eyes.L.open).toBe(0);
    expect(closed.eyes.L.closed).toBeCloseTo(0.05);
  }
  for (const name of ["wince", "knocked-out"]) {
    const face = resolveFace(name);
    expect(withBlink(face, 1)).toEqual(face);
  }
});

test("an intensity walks a feeling's ladder: none is neutral, a third the mild face, two thirds the base one, all the intense one", () => {
  const [mild, base, intense] = FEELINGS.anger!;
  expect(feel("anger", 0)).toEqual(resolveFace("neutral"));
  expect(feel("anger", 1 / 3)).toEqual(resolveFace(mild!));
  expect(feel("anger", "medium")).toEqual(resolveFace(base!));
  expect(feel("anger", "strong")).toEqual(resolveFace(intense!));
});

test("an intensity between two rungs blends them, so a feeling can build up smoothly", () => {
  const [mild, base] = FEELINGS.anger!;
  const half = (resolveFace(mild!).mouth.open + resolveFace(base!).mouth.open) / 2;
  expect(feel("anger", 0.5).mouth.open).toBeCloseTo(half);
});

test("strong confusion keeps its questioning cue instead of turning into vertigo", () => {
  const strong = feel("confusion", "strong");
  expect(strong.extras.question).toBeGreaterThan(0);
  expect(strong.extras.stars).toBeUndefined();
});

test("an intensity past the ends is held to them", () => {
  expect(feel("joy", 7)).toEqual(feel("joy", 1));
  expect(feel("joy", -1)).toEqual(feel("joy", 0));
});

test("a single expression's intensity is its weight from neutral", () => {
  const half = (resolveFace("neutral").mouth.open + resolveFace("surprised").mouth.open) / 2;
  expect(feel("surprised", 0.5).mouth.open).toBeCloseTo(half);
});

test("an unknown feeling is refused with the feelings that exist", () => {
  expect(() => feel("angst", 1)).toThrow("anger");
});

test("an intensity that is not a number is refused instead of drawing a broken face", () => {
  expect(() => feel("joy", Number.NaN)).toThrow("intensity");
});

test("as a feeling grows its eyes never pop back open once they have shut", () => {
  const shut = (open: number) => open < 0.05;
  for (const name of Object.keys(FEELINGS)) {
    const closedAt: Record<string, number> = {};
    for (let i = 0; i <= 100; i++) {
      const face = feel(name, i / 100);
      for (const side of ["L", "R"] as const) {
        const eye = face.eyes[side];
        if (eye.shape !== "eye") continue;
        if (shut(eye.open)) closedAt[side] ??= i / 100;
        else if (closedAt[side] !== undefined) expect([name, side, i / 100, "reopens"]).toEqual([name, side, closedAt[side], "stays shut"]);
      }
    }
  }
});

test("every feeling's ladder names three shipped expressions, and no feeling is named like an expression", () => {
  for (const [name, ladder] of Object.entries(FEELINGS)) {
    expect(ladder).toHaveLength(3);
    for (const rung of ladder) expect(EXPRESSIONS).toHaveProperty([rung]);
    expect(EXPRESSIONS).not.toHaveProperty([name]);
  }
});

test("every shipped expression sits in exactly one group", () => {
  const grouped = Object.values(EXPRESSION_GROUPS).flat();
  expect(new Set(grouped).size).toBe(grouped.length);
  expect([...grouped].sort()).toEqual(Object.keys(EXPRESSIONS).sort());
});

test("every shipped expression is designed inside the cute range, so what is authored is what is drawn", () => {
  for (const name of Object.keys(EXPRESSIONS)) expect([name, cuteFace(resolveFace(name), TOON.cute!)]).toEqual([name, resolveFace(name)]);
});

test("mixing layers adds each one's change from rest, so a mouth-only layer and a brow-only layer both show", () => {
  const face = mix([{ mouth: { open: 0.5 } }, 1], [{ brow: { y: 0.3 } }, 1]);
  expect(face.mouth.open).toBeCloseTo(0.5);
  expect(face.brows.L.y).toBeCloseTo(0.3);
});

test("a layer mixed at half weight adds half its change", () => {
  expect(mix([{ mouth: { open: 0.5 } }, 0.5]).mouth.open).toBeCloseTo(0.25);
});

test("a mark only one face has fades in from nothing as the faces blend", () => {
  const halfway = blendFace(resolveFace("neutral"), resolveFace({ extras: { vein: 1 } }), 0.5);
  expect(halfway.extras.vein).toBeCloseTo(0.5);
});

test("talking swaps a drawn mouth shape for the open mouth the viseme needs", () => {
  const kiss = resolveFace({ mouth: { shape: "pout" } });
  expect(talk(kiss, mouthAt([[0, "D"]], 1)).mouth.shape).toBe("mouth");
});

const anyCanvas = () =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })),
  }) as unknown as CanvasRenderingContext2D;

test("drawing a mark the style lacks is refused with the marks it has", () => {
  expect(() => drawToonFace(anyCanvas(), resolveFace({ extras: { sparkels: 1 } }), TOON)).toThrow("sparkles");
});

test("every shipped expression draws with the default style, so a misspelt mark or shape in the library fails here and not in a render", () => {
  for (const name of Object.keys(EXPRESSIONS)) {
    const face = resolveFace(name);
    expect(() => {
      drawToonFace(anyCanvas(), face, TOON);
      drawToonMarks(anyCanvas(), face, TOON);
    }).not.toThrow();
  }
});

test("drawing a mouth shape the style lacks is refused with the shapes it has", () => {
  expect(() => drawToonFace(anyCanvas(), resolveFace({ mouth: { shape: "puot" } }), TOON)).toThrow("pout");
});

test("a face's landmarks ignore a blink, lip-sync and an eye dart, which move fast by nature", () => {
  const face = resolveFace("smile");
  const darted = resolveFace({ from: "smile", eye: { look: [0.8, -0.6] } });
  expect(toonLandmarks(withBlink(talk(darted, [2, 1, 0.4, 0.2]), 1))).toEqual(toonLandmarks(face));
});

test("an angry face pulls the inner brows down by more than a third of a face pixel", () => {
  const calm = toonLandmarks(resolveFace("neutral")),
    angry = toonLandmarks(resolveFace("angry"));
  expect(angry["brow R inner"]![1] - calm["brow R inner"]![1]).toBeGreaterThan(0.35);
});
