import { expect, test } from "bun:test";

import {
  counted,
  KINDS,
  lookOf,
  makeTitles,
  mixColor,
  phaseOf,
  scrambled,
  SHAPE_CATEGORIES,
  SHAPE_IN,
  SHAPE_OUT,
  TEXT_CATEGORIES,
  TEXT_IN,
  TEXT_OUT,
  TITLE_EASES,
  typed,
} from "../src/titles";

test("an item is on screen from its start up to, not at, its end", () => {
  const it = { from: 2, to: 5 };
  expect(phaseOf(it, 1.99)).toBeNull();
  expect(phaseOf(it, 2)).toEqual({ in: 1, out: 1 });
  expect(phaseOf(it, 5)).toBeNull();
});

test("its In runs over the first len seconds and its Out over the last", () => {
  const it = { from: 2, to: 5, in: { fx: "fade", len: 1 }, out: { fx: "fade", len: 0.5 } };
  expect(phaseOf(it, 2.5)).toEqual({ in: 0.5, out: 1 });
  expect(phaseOf(it, 4)).toEqual({ in: 1, out: 1 });
  expect(phaseOf(it, 4.75)!.out).toBeCloseTo(0.5, 9);
});

test("an In and an Out longer than the item share it in their own proportions", () => {
  const it = { from: 0, to: 1, in: { fx: "fade", len: 1.5 }, out: { fx: "fade", len: 0.5 } };
  expect(phaseOf(it, 0.75)!.in).toBe(1); // the In takes 0.75 s of the 1
  expect(phaseOf(it, 0.875)!.out).toBeCloseTo(0.5, 9); // the Out the last 0.25 s
});

test("a typewriter shows whole letters, never half an emoji or a letter without its combining accent", () => {
  expect(typed("Sealed room", 0)).toBe("");
  expect(typed("Sealed room", 0.5)).toBe("Sealed");
  expect(typed("Sealed room", 1)).toBe("Sealed room");
  expect(typed("a😀b", 0.5)).toBe("a😀");
  expect(typed("ảb", 0.34)).toBe("ả");
});

test("makeTitles caches line width measurement across animated frames and invalidates on visual edits or font loads", () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  let measureCalls = 0;
  let fontLoaded: (() => void) | null = null;
  const filled: string[] = [];
  const ctx = {
    font: "",
    letterSpacing: "",
    textBaseline: "",
    textAlign: "",
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    filter: "none",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    lineWidth: 1,
    lineJoin: "",
    lineCap: "",
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    strokeText() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    ellipse() {},
    fillText(s: string) {
      filled.push(`${this.fillStyle}:${s}`);
    },
    measureText(s: string) {
      measureCalls++;
      return { width: s.length * 12 };
    },
  };
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    fonts: {
      load: async () => {},
      addEventListener: (ev: string, fn: () => void) => {
        if (ev === "loadingdone") fontLoaded = fn;
      },
    },
  };
  try {
    const draw = makeTitles({ autoClear: true, render() {} }, 1920, 1080);
    const it: Record<string, unknown> = {
      kind: "text",
      from: 0,
      to: 4,
      text: "Chapter 1\nSealed Room",
      size: 56,
      font: "serif",
      color: "#ffffff",
      in: { fx: "type", len: 2 },
      out: { fx: "fade", len: 1 },
    };
    for (let f = 0; f < 60; f++) draw([it], f / 30);
    expect(measureCalls).toBe(2);

    // Mutating color in place redraws with the new fillStyle without needing a fresh measureText
    filled.length = 0;
    it.color = "#ff5500";
    draw([it], 2.1);
    expect(filled.some((x) => x.startsWith("#ff5500:"))).toBe(true);
    expect(measureCalls).toBe(2);

    // Changing text or font load invalidates cached widths
    it.text = "Chapter 2";
    draw([it], 2.2);
    expect(measureCalls).toBe(3);

    fontLoaded?.();
    draw([it], 2.3);
    expect(measureCalls).toBe(4);
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

test("exposes categorized Cinetic typography and shape voices with unique ids and positive defaults", () => {
  expect(TEXT_CATEGORIES).toEqual([
    "Clean",
    "Build & Mask",
    "Pop & Scale",
    "Colour & Ink",
    "Decode & Split",
  ]);
  expect(SHAPE_CATEGORIES).toEqual(["Draw", "Pop & Scale", "Clean"]);
  expect(TITLE_EASES).toContain("auto");
  expect(KINDS).toEqual(["text", "arrow", "circle", "box", "bracket", "underline"]);

  const inIds = TEXT_IN.map((v) => v.id);
  expect(new Set(inIds).size).toBe(inIds.length);
  for (const req of [
    "fade",
    "type",
    "easedType",
    "up",
    "down",
    "wordRise",
    "staggerWords",
    "clipRise",
    "wipeIn",
    "centreUnmask",
    "zoom",
    "oversize",
    "popIn",
    "barrelIn",
    "blur",
    "trackingIn",
    "inkIn",
    "hueSweepIn",
    "scramble",
    "lineSplitIn",
  ]) {
    expect(inIds).toContain(req);
  }
  for (const v of TEXT_IN) {
    expect(TEXT_CATEGORIES).toContain(v.cat);
    expect(v.len).toBeGreaterThan(0);
  }

  const outIds = TEXT_OUT.map((v) => v.id);
  expect(new Set(outIds).size).toBe(outIds.length);
  for (const req of [
    "fade",
    "type",
    "up",
    "down",
    "clipDrop",
    "clipUp",
    "wordDropOut",
    "zoom",
    "collapseOut",
    "whipLeft",
    "whipRight",
    "barrelOut",
    "blur",
    "blurExit",
    "trackingOut",
    "lineSplitOut",
    "scrambleOut",
  ]) {
    expect(outIds).toContain(req);
  }
  for (const v of TEXT_OUT) {
    expect(TEXT_CATEGORIES).toContain(v.cat);
    expect(v.len).toBeGreaterThan(0);
  }

  for (const req of ["draw", "spinDraw", "wipeIn", "popIn", "oversize", "zoom", "fade"]) {
    expect(SHAPE_IN.map((v) => v.id)).toContain(req);
  }
  for (const req of ["undraw", "expandFade", "collapseOut", "zoom", "fade"]) {
    expect(SHAPE_OUT.map((v) => v.id)).toContain(req);
  }
});

test("scrambled decodes deterministically without splitting UTF-16 surrogate pairs or spaces", () => {
  const sample = "SEALED 😀 42";
  expect(scrambled(sample, 1, 7)).toBe(sample);
  const midA = scrambled(sample, 0.35, 7);
  const midB = scrambled(sample, 0.35, 7);
  expect(midA).toBe(midB);
  const cps = Array.from(midA);
  expect(cps.length).toBe(Array.from(sample).length);
  expect(midA.includes("\uD83D") && !midA.includes("😀")).toBe(false);
  expect(cps[6]).toBe(" ");
  expect(cps[8]).toBe(" ");
});

test("mixColor interpolates perceptually in OKLab, supports CSS named/HSL colors, and never returns NaN", () => {
  expect(mixColor("#ff6b2c", "#ffffff", 0)).toBe("rgb(255, 107, 44)");
  expect(mixColor("#ff6b2c", "#ffffff", 1)).toBe("rgb(255, 255, 255)");
  const mid = mixColor("#ff6b2c", "#ffffff", 0.5);
  expect(mid).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  expect(mid).not.toBe("rgb(255, 255, 255)");
  expect(mixColor("cyan", "white", 0)).toBe("rgb(0, 255, 255)");
  expect(mixColor("steelblue", "white", 0)).toBe("rgb(70, 130, 180)");
  expect(mixColor("RebeccaPurple", "white", 0)).toBe("rgb(102, 51, 153)");
  expect(mixColor("hsl(180, 100%, 50%)", "gold", 0.5)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  expect(mixColor("not-a-color", "#ffffff", Number.NaN)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
});

test("inactive slot at p=1 never clobbers active slot or resting state, and overlapping wordRise+clipDrop compose cleanly", () => {
  const dual = {
    kind: "text",
    from: 0,
    to: 3,
    text: "Every frame\ncarries weight",
    in: { fx: "wordRise", len: 0.6 },
    out: { fx: "clipDrop", len: 0.4 },
  };
  const duringIn = lookOf(dual, { in: 0.3, out: 1 });
  expect(duringIn.wordMode).toBe("wordRise");
  expect(duringIn.clip).toBeNull();
  expect(duringIn.dy).toBeGreaterThan(0.05);

  // Settled resting hold on inkIn and hueSweepIn leaves zero active word/tint/sweep/clip flags
  const restInk = lookOf(
    { kind: "text", in: { fx: "inkIn", len: 0.5 }, out: { fx: "clipDrop", len: 0.4 } },
    { in: 1, out: 1 },
  );
  expect(restInk.wordMode).toBeNull();
  expect(restInk.tint).toBeNull();
  expect(restInk.clip).toBeNull();
  const restSweep = lookOf({ kind: "text", in: { fx: "hueSweepIn", len: 0.5 } }, { in: 1, out: 1 });
  expect(restSweep.sweepAt).toBe(-1);
  expect(restSweep.clip).toBeNull();

  // Canvas draw & boxes preserve per-word drawing and non-zero ty during wordRise even when out is clipDrop, AND when overlapping
  const prevDoc = (globalThis as { document?: unknown }).document;
  const wordsDrawn: string[] = [];
  let clips = 0;
  const ctx = {
    font: "",
    letterSpacing: "",
    textBaseline: "",
    textAlign: "",
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    filter: "none",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    lineWidth: 1,
    lineJoin: "",
    lineCap: "",
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    clip() {
      clips++;
    },
    beginPath() {},
    roundRect() {},
    rect() {},
    fill() {},
    strokeText() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    ellipse() {},
    fillText(s: string) {
      wordsDrawn.push(s);
    },
    measureText(s: string) {
      return { width: s.length * 14 };
    },
  };
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    fonts: { load: async () => {}, addEventListener() {} },
  };
  try {
    const draw = makeTitles({ autoClear: true, render() {} }, 1920, 1080);
    draw([dual], 0.18); // ph.in = 0.3, ph.out = 1
    expect(wordsDrawn).toContain("Every");
    const boxIn = draw.boxes([dual], 0.18)[0]!;
    const boxRest = draw.boxes([dual], 1.5)[0]!;
    expect(boxIn.box[1]).toBeGreaterThan(boxRest.box[1]);

    // Proportional fit on a 0.5s item hands off cleanly from wordRise (t=0.15) into clipDrop line-masking (t=0.4),
    // and direct overlapping phases preserve both wordMode and line clip together.
    const both = lookOf(dual, { in: 0.4, out: 0.4 });
    expect(both.wordMode).toBe("wordRise");
    expect(both.clip).toEqual({ kind: "line" });
    wordsDrawn.length = 0;
    clips = 0;
    const shortDual = { ...dual, to: 0.5 };
    draw([shortDual], 0.15);
    expect(wordsDrawn).toContain("Every");
    expect(clips).toBe(0);
    draw([shortDual], 0.4);
    expect(clips).toBeGreaterThanOrEqual(2);
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

test("every Cinetic voice settles cleanly at p=1 and responds to ease, stagger, tint, and custom extra voices", () => {
  for (const v of TEXT_IN) {
    const settled = lookOf({ kind: "text", in: { fx: v.id, len: v.len } }, { in: 1, out: 1 });
    expect(settled.alpha).toBeCloseTo(1, 5);
    expect(settled.dx).toBeCloseTo(0, 5);
    expect(settled.dy).toBeCloseTo(0, 5);
    expect(settled.scaleX).toBeCloseTo(1, 5);
    expect(settled.scaleY).toBeCloseTo(1, 5);
    expect(settled.blur).toBeCloseTo(0, 5);
    expect(settled.tracking).toBeCloseTo(0, 5);
    expect(settled.show).toBeCloseTo(1, 5);
  }

  // wordRise starts already legible on frame 1 (Cinetic firstInk >= 0.5) and settles from below
  const wrEarly = lookOf({ kind: "text", in: { fx: "wordRise", len: 0.5 } }, { in: 0.08, out: 1 });
  expect(wrEarly.alpha).toBeGreaterThan(0.5);
  expect(wrEarly.dy).toBeGreaterThan(0.15);

  // oversize lands from > 1.2x in log space (never from 0) and clears blur by p = 0.65
  const ovStart = lookOf({ kind: "text", in: { fx: "oversize", len: 0.5 } }, { in: 0.05, out: 1 });
  const ovLate = lookOf({ kind: "text", in: { fx: "oversize", len: 0.5 } }, { in: 0.65, out: 1 });
  expect(ovStart.scaleX).toBeGreaterThan(1.2);
  expect(ovLate.blur).toBeCloseTo(0, 4);

  // collapseOut shrinks toward ~0.86 on launchIn, never collapsing to zero
  const colEnd = lookOf(
    { kind: "text", out: { fx: "collapseOut", len: 0.35 } },
    { in: 1, out: 0.05 },
  );
  expect(colEnd.scaleX).toBeGreaterThan(0.8);
  expect(colEnd.scaleX).toBeLessThan(0.95);

  // Explicit ease override changes progression vs linear
  const linMid = lookOf(
    { kind: "text", in: { fx: "up", len: 0.5, ease: "linear" } },
    { in: 0.25, out: 1 },
  );
  const snapMid = lookOf(
    { kind: "text", in: { fx: "up", len: 0.5, ease: "snap" } },
    { in: 0.25, out: 1 },
  );
  expect(snapMid.dy).toBeLessThan(linMid.dy);

  // Unknown custom fx never throws, and custom extra voice step runs when supplied
  expect(() =>
    lookOf({ kind: "text", in: { fx: "aiCustomQuantumTitle" } }, { in: 0.4, out: 1 }),
  ).not.toThrow();
  const custom = lookOf(
    { kind: "text", in: { fx: "orbitTilt" } },
    { in: 0.5, out: 1 },
    {
      text: {
        in: [
          {
            id: "orbitTilt",
            title: "Orbit tilt",
            len: 0.5,
            cat: "Clean",
            step: (st, p) => {
              st.rot += (1 - p) * 24;
            },
          },
        ],
      },
    },
  );
  expect(custom.rot).toBeCloseTo(12, 5);
});

test("makeTitles draws Cinetic word-staggered inkIn, new annotation shapes, and invalidates visualKey on setting tweaks", () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  const filled: string[] = [];
  let strokes = 0;
  const ctx = {
    font: "",
    letterSpacing: "",
    textBaseline: "",
    textAlign: "",
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    filter: "none",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    lineWidth: 1,
    lineJoin: "",
    lineCap: "",
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    clip() {},
    beginPath() {},
    roundRect() {},
    rect() {},
    fill() {},
    strokeText() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    stroke() {
      strokes++;
    },
    ellipse() {},
    fillText(s: string) {
      filled.push(`${this.fillStyle}:${s}`);
    },
    measureText(s: string) {
      return { width: s.length * 14 };
    },
  };
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    fonts: { load: async () => {}, addEventListener() {} },
  };
  try {
    const draw = makeTitles({ autoClear: true, render() {} }, 1920, 1080);
    const items: Record<string, unknown>[] = [
      {
        kind: "text",
        from: 0,
        to: 3,
        text: "COLD STEEL",
        color: "#ffffff",
        in: { fx: "inkIn", len: 1, stagger: 0.5, tint: "#ff6b2c" },
      },
      { kind: "box", from: 0, to: 3, w: 300, h: 160, in: { fx: "draw", len: 0.6 } },
      { kind: "bracket", from: 0, to: 3, w: 280, h: 140, in: { fx: "popIn", len: 0.4 } },
      { kind: "underline", from: 0, to: 3, size: 220, in: { fx: "draw", len: 0.5 } },
    ];
    draw(items, 0.25);
    expect(filled.some((x) => x.startsWith("rgb("))).toBe(true);
    expect(strokes).toBeGreaterThanOrEqual(3);
    expect(draw.boxes(items, 0.25).length).toBe(4);

    // Changing tint at the exact same timestamp must invalidate visualKey and redraw with the new tint
    const before = filled.slice();
    filled.length = 0;
    (items[0].in as Record<string, unknown>).tint = "#22d3ee";
    draw(items, 0.25);
    expect(filled.length).toBeGreaterThan(0);
    expect(filled).not.toEqual(before);
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

test("custom AI annotation shape kinds use extra.shape voices, extra.eases, full w x h hit-boxes, and custom extra.shapes drawers", () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  let customCalls = 0;
  let strokes = 0;
  const ctx = {
    font: "",
    letterSpacing: "",
    textBaseline: "",
    textAlign: "",
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    filter: "none",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    lineWidth: 1,
    lineJoin: "",
    lineCap: "",
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    clip() {},
    beginPath() {},
    roundRect() {},
    rect() {},
    fill() {},
    strokeText() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    stroke() {
      strokes++;
    },
    ellipse() {},
    fillText() {},
    measureText(s: string) {
      return { width: s.length * 14 };
    },
  };
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    fonts: { load: async () => {}, addEventListener() {} },
  };
  try {
    const extra = {
      eases: { quadIn: (t: number) => t * t },
      shape: {
        in: [
          {
            id: "growX",
            title: "Grow X",
            len: 0.5,
            cat: "Pop & Scale",
            step: (st: { scaleX: number }, p: number) => {
              st.scaleX = p;
            },
          },
        ],
      },
      shapes: {
        customCallout: {
          draw: () => {
            customCalls++;
          },
        },
      },
    };
    const easedText = lookOf(
      { kind: "text", in: { fx: "up", ease: "quadIn" } },
      { in: 0.5, out: 1 },
      extra,
    );
    expect(easedText.dy).toBeCloseTo((1 - 0.25) * 0.6, 5);

    const shapeLook = lookOf(
      { kind: "customCallout", in: { fx: "growX", len: 1 } },
      { in: 0.4, out: 1 },
      extra,
    );
    expect(shapeLook.scaleX).toBeCloseTo(0.4, 5);

    const draw = makeTitles({ autoClear: true, render() {} }, 1920, 1080, extra);
    const items = [
      { kind: "customCallout", from: 0, to: 3, w: 384, h: 216, in: { fx: "growX", len: 1 } },
      { kind: "unregisteredBadge", from: 0, to: 3, w: 240, h: 120 },
    ];
    draw(items, 0.5);
    expect(customCalls).toBe(1);
    expect(strokes).toBeGreaterThanOrEqual(1);

    const boxes = draw.boxes(items, 1);
    expect(boxes.length).toBe(2);
    expect(boxes[0].box[2] - boxes[0].box[0]).toBeCloseTo(384 / 1920, 4);
    expect(boxes[0].box[3] - boxes[0].box[1]).toBeCloseTo(216 / 1080, 4);
    expect(boxes[1].box[2] - boxes[1].box[0]).toBeCloseTo(240 / 1920, 4);

    // Editing a custom AI field on TextItem or TitleFx while parked invalidates the 2D canvas cache
    draw(items, 0.5);
    expect(customCalls).toBe(1);
    (items[0] as Record<string, unknown>).badge = "UPDATED";
    draw(items, 0.5);
    expect(customCalls).toBe(2);
    (items[0].in as Record<string, unknown>).customAmp = 2.5;
    draw(items, 0.5);
    expect(customCalls).toBe(3);
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

test("makeTitles.disposeTitles releases GPU resources and unregisters document.fonts listener", () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  let addedFn: unknown = null;
  let removedFn: unknown = null;
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ measureText: () => ({ width: 10 }) }),
    }),
    fonts: {
      load: async () => {},
      addEventListener: (ev: string, fn: unknown) => {
        if (ev === "loadingdone") addedFn = fn;
      },
      removeEventListener: (ev: string, fn: unknown) => {
        if (ev === "loadingdone") removedFn = fn;
      },
    },
  };
  try {
    const draw = makeTitles({ autoClear: true, render() {} }, 1920, 1080);
    expect(typeof draw.disposeTitles).toBe("function");
    expect(addedFn).not.toBeNull();
    draw.disposeTitles();
    expect(removedFn).toBe(addedFn);
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

const NEW_TEXT_IN = [
  "letterReveal",
  "assemble",
  "counter",
  "flipUp",
  "wordBuild",
  "fontCycle",
  "wordBounce",
  "gravityDrop",
  "pendulum",
  "arcFlight",
  "lensFly",
  "echoIn",
];
const NEW_TEXT_OUT = ["letterHide", "shatter", "flipAway", "gravityFall", "lensFlyOut", "echoOut"];

// The studio shows the Stagger slider from the catalogue's flag alone, so the flag must say which voices read it
test("a voice is marked stagger exactly when its stagger changes how it looks", () => {
  const sides = [
    ["in", TEXT_IN],
    ["out", TEXT_OUT],
  ] as const;
  for (const [side, voices] of sides)
    for (const v of voices) {
      const look = (stagger: number) =>
        lookOf({ kind: "text", [side]: { fx: v.id, len: 1, stagger } }, { in: 0.5, out: 0.5 });
      const reads = JSON.stringify(look(0.1)) !== JSON.stringify(look(0.9));
      expect(Boolean(v.stagger), v.id).toBe(reads);
    }
});

test("counted runs every number up from zero on cut digits, keeping decimals and thousands commas", () => {
  expect(counted("1,200 users and 40%", 0.5)).toBe("600 users and 20%");
  expect(counted("12,000", 0.5)).toBe("6,000");
  expect(counted("3.5x faster", 0)).toBe("0.0x faster");
  expect(counted("3.5x faster", 1)).toBe("3.5x faster");
  expect(counted("no digits here", 0.3)).toBe("no digits here");
});

test("the new voices move mid-way and rest exactly at the end", () => {
  const mid = (slot: "in" | "out", fx: string, p: number) =>
    lookOf({ kind: "text", [slot]: { fx, len: 0.6 } }, { in: 1, out: 1, [slot]: p });
  expect(mid("in", "gravityDrop", 0.1).dy).toBeLessThan(0);
  expect(Math.abs(mid("in", "pendulum", 0.2).rot)).toBeGreaterThan(1);
  expect(mid("in", "arcFlight", 0.3).dx).toBeLessThan(0);
  expect(mid("in", "arcFlight", 0.5).scaleX).toBeGreaterThan(1);
  const lens = mid("in", "lensFly", 0.1);
  expect(lens.scaleX).toBeGreaterThan(2);
  expect(lens.blur).toBeGreaterThan(5);
  const echo = mid("in", "echoIn", 0.3);
  expect(echo.echo).toBeGreaterThan(0);
  expect(echo.dx).toBeLessThan(0);
  expect(mid("in", "letterReveal", 0.3)).toMatchObject({
    wordMode: "letterReveal",
    unit: "letter",
  });
  expect(mid("in", "assemble", 0.3)).toMatchObject({ wordMode: "assemble", unit: "letter" });
  expect(mid("in", "wordBounce", 0.3)).toMatchObject({ wordMode: "wordBounce", unit: "word" });
  const count = mid("in", "counter", 0.4).count;
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(1);
  const flip = mid("in", "flipUp", 0.3);
  expect(flip.scaleY).toBeLessThan(1);
  expect(flip.tintMix).toBeGreaterThan(0);
  expect(mid("in", "wordBuild", 0.3)).toMatchObject({ wordMode: "wordBuild", unit: "word" });
  expect(Number.isInteger(mid("in", "fontCycle", 0.4).fontHop)).toBe(true);
  expect(mid("out", "gravityFall", 0.5).dy).toBeGreaterThan(0);
  const dot = lookOf({ kind: "circle", in: { fx: "growDot", len: 0.25 } }, { in: 0.05, out: 1 });
  expect(dot.scaleX).toBeLessThan(0.6);
  const lensOut = mid("out", "lensFlyOut", 0.5);
  expect(lensOut.scaleX).toBeGreaterThan(1);
  expect(lensOut.blur).toBeGreaterThan(0);
  expect(mid("out", "echoOut", 0.5).dx).toBeGreaterThan(0);
  expect(mid("out", "letterHide", 0.5)).toMatchObject({ wordMode: "letterHide", unit: "letter" });
  expect(mid("out", "shatter", 0.5)).toMatchObject({ wordMode: "shatter", unit: "letter" });
  const tilt = mid("out", "flipAway", 0.5);
  expect(tilt.scaleY).toBeLessThan(1);
  expect(tilt.blur).toBeGreaterThan(0);

  for (const fx of [...NEW_TEXT_IN, ...NEW_TEXT_OUT]) {
    const rest = lookOf({ kind: "text", in: { fx }, out: { fx } }, { in: 1, out: 1 });
    expect(rest).toMatchObject({ alpha: 1, dx: 0, dy: 0, rot: 0, scaleX: 1, scaleY: 1, blur: 0 });
    expect(rest.echo).toBe(0);
    expect(rest.count).toBeNull();
    expect(rest.fontHop).toBeNull();
  }
});

test("hold steps a voice on twos or threes of the 30 fps clock", () => {
  const at = (p: number, hold?: number) =>
    lookOf({ kind: "text", in: { fx: "fade", len: 0.5, hold } }, { in: p, out: 1 }).alpha;
  expect(at(0.1, 2)).toBe(at(0, 2));
  expect(at(0.2, 2)).toBeCloseTo(at(2 / 15), 6);
  expect(at(0.2, 3)).toBeCloseTo(at(0.2 - (0.2 % (3 / 15))), 6);
  expect(at(0.2)).toBeGreaterThan(at(0.2, 2));
  // An item too short for its In plays it faster, so its frames are counted on the In it really gets
  const short = { kind: "text", from: 0, to: 0.5, in: { fx: "fade", len: 1, hold: 2 } };
  expect(lookOf(short, { in: 0.1, out: 1 }).alpha).toBe(0);
  expect(lookOf(short, { in: 0.14, out: 1 }).alpha).toBeGreaterThan(0);
});

test("makeTitles draws every new voice mid-way without throwing", () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  const filled: string[] = [];
  const noop = () => {};
  const ctx = {
    font: "",
    letterSpacing: "",
    textBaseline: "",
    textAlign: "",
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    filter: "none",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    lineWidth: 1,
    lineJoin: "",
    lineCap: "",
    setTransform: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    clip: noop,
    beginPath: noop,
    roundRect: noop,
    rect: noop,
    fill: noop,
    strokeText: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    stroke: noop,
    ellipse: noop,
    arc: noop,
    fillText(s: string) {
      filled.push(s);
    },
    measureText(s: string) {
      return { width: s.length * 14 };
    },
  };
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    fonts: { load: async () => {}, addEventListener() {} },
  };
  try {
    const draw = makeTitles({ autoClear: true, render() {} }, 1920, 1080);
    for (const fx of NEW_TEXT_IN) {
      filled.length = 0;
      draw([{ kind: "text", from: 0, to: 3, text: "REVENUE 1,200", in: { fx, len: 1 } }], 0.4);
      expect(filled.length, fx).toBeGreaterThan(0);
    }
    for (const fx of NEW_TEXT_OUT) {
      filled.length = 0;
      draw([{ kind: "text", from: 0, to: 3, text: "GONE NOW", out: { fx, len: 1 } }], 2.6);
      expect(filled.length, fx).toBeGreaterThan(0);
    }
    filled.length = 0;
    draw([{ kind: "text", from: 0, to: 3, text: "1,200", in: { fx: "counter", len: 1 } }], 0.5);
    expect(filled.length).toBeGreaterThan(1);
    expect(filled.every((s) => s.length === 1)).toBe(true);
    expect(filled.join("")).not.toBe("1,200");
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

test("a film waits only on the fonts its items draw in, every font once one cycles through them", async () => {
  const { FONTS, fontsFor } = await import("../src/titles-catalog");
  expect(
    fontsFor([{ font: "serif" }, { text: "no font is Inter" }, { font: "serif" }]).map((f) => f.id),
  ).toEqual(["sans", "serif"]);
  expect(fontsFor([])).toEqual([]);
  expect(fontsFor([{ font: "serif", out: { fx: "fontCycle" } }])).toEqual(FONTS);
  expect(fontsFor(undefined)).toEqual(FONTS);
});
