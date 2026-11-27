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
  expect(phaseOf(it, 0.75)!.in).toBe(1);
  expect(phaseOf(it, 0.875)!.out).toBeCloseTo(0.5, 9);
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

    filled.length = 0;
    it.color = "#ff5500";
    draw([it], 2.1);
    expect(filled.some((x) => x.startsWith("#ff5500:"))).toBe(true);
    expect(measureCalls).toBe(2);

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

test("a film's own font is drawn, loaded before the first frame and offered in the studio's list", async () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  const fonts: string[] = [],
    loaded: string[] = [];
  const ctx = new Proxy(
    { measureText: (s: string) => ({ width: s.length * 12 }) } as Record<string, unknown>,
    {
      get: (o, k) => (k in o ? o[k as string] : () => {}),
      set: (o, k, v) => ((o[k as string] = v), k === "font" && fonts.push(v), true),
    },
  );
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    fonts: { load: async (css: string) => void loaded.push(css), addEventListener() {} },
  };
  try {
    const pixel = { id: "pixel", title: "Pixel", css: "'Pixel Film', monospace" };
    const it = { kind: "text", from: 0, to: 4, text: "MINE", font: "pixel" };
    const draw = makeTitles({ autoClear: true, render() {} }, 1920, 1080, {
      fonts: [pixel],
      items: [it],
    });
    await draw.ready;
    expect(loaded.some((css) => css.includes("'Pixel Film'"))).toBe(true);
    draw([it], 1);
    expect(fonts.some((css) => css.includes("'Pixel Film'"))).toBe(true);
    expect(draw.fonts.map((f: { id: string }) => f.id)).toContain("pixel");
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

test("a text's own shadow is drawn at its colour, blur and offset in fractions of its size, and redraws when it changes", () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  const seen: { color: unknown; blur: unknown; x: unknown; y: unknown }[] = [];
  const ctx = new Proxy(
    { measureText: (s: string) => ({ width: s.length * 12 }) } as Record<string, unknown>,
    {
      get: (o, k) =>
        k in o
          ? o[k as string]
          : k === "fillText"
            ? () => seen.push({ color: o.shadowColor, blur: o.shadowBlur, x: o.shadowOffsetX, y: o.shadowOffsetY })
            : () => {},
      set: (o, k, v) => ((o[k as string] = v), true),
    },
  );
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    fonts: { load: async () => {}, addEventListener() {} },
  };
  try {
    const draw = makeTitles({ autoClear: true, render() {} }, 1080, 1920);
    const it: Record<string, unknown> = {
      kind: "text",
      from: 0,
      to: 4,
      text: "it was strange",
      size: 100,
      shadow: { color: "rgba(0,0,0,0.9)", blur: 0.05, x: 0.04, y: 0.05 },
    };
    draw([it], 1);
    expect(seen.at(-1)).toEqual({ color: "rgba(0,0,0,0.9)", blur: 5, x: 4, y: 5 });
    it.shadow = { color: "#000", blur: 0.1, x: 0, y: 0.02 };
    draw([it], 1.1);
    expect(seen.at(-1)).toEqual({ color: "#000", blur: 10, x: 0, y: 2 });
    it.shadow = false;
    draw([it], 1.2);
    expect(seen.at(-1)!.color).not.toBe("#000");
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
    draw([dual], 0.18);
    expect(wordsDrawn).toContain("Every");
    const boxIn = draw.boxes([dual], 0.18)[0]!;
    const boxRest = draw.boxes([dual], 1.5)[0]!;
    expect(boxIn.box[1]).toBeGreaterThan(boxRest.box[1]);

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

  const wrEarly = lookOf({ kind: "text", in: { fx: "wordRise", len: 0.5 } }, { in: 0.08, out: 1 });
  expect(wrEarly.alpha).toBeGreaterThan(0.5);
  expect(wrEarly.dy).toBeGreaterThan(0.15);

  const ovStart = lookOf({ kind: "text", in: { fx: "oversize", len: 0.5 } }, { in: 0.05, out: 1 });
  const ovLate = lookOf({ kind: "text", in: { fx: "oversize", len: 0.5 } }, { in: 0.65, out: 1 });
  expect(ovStart.scaleX).toBeGreaterThan(1.2);
  expect(ovLate.blur).toBeCloseTo(0, 4);

  const colEnd = lookOf(
    { kind: "text", out: { fx: "collapseOut", len: 0.35 } },
    { in: 1, out: 0.05 },
  );
  expect(colEnd.scaleX).toBeGreaterThan(0.8);
  expect(colEnd.scaleX).toBeLessThan(0.95);

  const linMid = lookOf(
    { kind: "text", in: { fx: "up", len: 0.5, ease: "linear" } },
    { in: 0.25, out: 1 },
  );
  const snapMid = lookOf(
    { kind: "text", in: { fx: "up", len: 0.5, ease: "snap" } },
    { in: 0.25, out: 1 },
  );
  expect(snapMid.dy).toBeLessThan(linMid.dy);

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
  expect(fontsFor({ preset: "zack-d-films", items: [{ text: "hello" }] }).map((f) => f.id)).toEqual(
    ["tahoma"],
  );
});

test("resolveTextItem merges document preset, defaults, item preset, and item overrides cleanly", async () => {
  const { resolveTextItem, textPresetOf } = await import("../src/titles-catalog");
  expect(textPresetOf("zack-d-films")?.style).toMatchObject({
    font: "tahoma",
    weight: 700,
    size: 75,
    y: 0.784,
    stroke: { color: "#000000", width: 4, join: "miter", miterLimit: 4 },
  });

  const doc = {
    preset: "zack-d-films",
    defaults: { color: "#FFEEAA", stroke: { width: 6 } },
    items: [],
  };
  const merged = resolveTextItem({ from: 0, to: 1, text: "test", stroke: { color: "#111111" } }, doc);
  expect(merged.kind).toBe("text");
  expect(merged.font).toBe("tahoma");
  expect(merged.weight).toBe(700);
  expect(merged.size).toBe(75);
  expect(merged.color).toBe("#FFEEAA");
  expect(merged.stroke).toEqual({ color: "#111111", width: 6, join: "miter", miterLimit: 4 });
  expect(merged.shadow).toEqual({ color: "rgba(0,0,0,1)", blur: 0.015, x: 0.034, y: 0.034 });

  const noShadow = resolveTextItem({ from: 0, to: 1, text: "clean", shadow: false, stroke: null }, doc);
  expect(noShadow.shadow).toBe(false);
  expect(noShadow.stroke).toBeUndefined();

  const shapeItem = resolveTextItem({ kind: "arrow", from: 0, to: 1 }, doc);
  expect(shapeItem.kind).toBe("arrow");
  expect(shapeItem.size).toBeUndefined();
  expect(shapeItem.y).toBeUndefined();
  expect(shapeItem.stroke).toBeUndefined();
  expect(shapeItem.color).toBeUndefined();

  const lowerThird = resolveTextItem(
    { preset: "doc-lower-third", from: 0, to: 1, text: "Dr. Chen" },
    { preset: "zack-d-films", items: [] },
  );
  expect(lowerThird.align).toBe("left");
  expect(lowerThird.stroke).toBeUndefined();
  expect(lowerThird.bold).toBeUndefined();
  expect(lowerThird.safeArea).toBeUndefined();

  const noAnim = resolveTextItem(
    { from: 0, to: 1, text: "still", in: { fx: "none" } },
    { defaults: { kind: "text", in: { fx: "fade", len: 0.4 } }, items: [] },
  );
  expect(noAnim.in).toBeUndefined();
});

test("stroke width 0 skips strokeText and preserves fill shadow instead of drawing stale lineWidth", () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  let strokeCalls = 0;
  let fillShadowColor = "";
  const ctx = new Proxy(
    { lineWidth: 9, measureText: (s: string) => ({ width: s.length * 14 }) } as Record<string, unknown>,
    {
      get: (o, k) =>
        k in o
          ? o[k as string]
          : k === "strokeText"
            ? () => {
                strokeCalls++;
              }
            : k === "fillText"
              ? () => {
                  fillShadowColor = typeof o.shadowColor === "string" ? o.shadowColor : "";
                }
              : () => {},
      set: (o, k, v) => ((o[k as string] = v), true),
    },
  );
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    fonts: { load: async () => {}, addEventListener() {} },
  };
  try {
    const draw = makeTitles({ autoClear: true, render() {} }, 1080, 1920);
    draw(
      [
        {
          kind: "text",
          from: 0,
          to: 2,
          text: "no stroke",
          stroke: { color: "#000000", width: 0 },
          shadow: { color: "rgba(0,0,0,0.9)", blur: 0.05, x: 0.02, y: 0.02 },
        },
      ],
      1,
    );
    expect(strokeCalls).toBe(0);
    expect(fillShadowColor).toBe("rgba(0,0,0,0.9)");
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

test("zack-d-films seamlessGap closes 1-frame blank caption gaps cleanly while preserving real pauses, opt-out 0, and out fades", () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  const drawn: string[] = [];
  const ctx = new Proxy(
    { measureText: (s: string) => ({ width: s.length * 14 }) } as Record<string, unknown>,
    {
      get: (o, k) =>
        k in o
          ? o[k as string]
          : k === "fillText"
            ? (s: string) => drawn.push(s)
            : () => {},
      set: (o, k, v) => ((o[k as string] = v), true),
    },
  );
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    fonts: { load: async () => {}, addEventListener() {} },
  };
  try {
    const draw = makeTitles({ autoClear: true, render() {} }, 1080, 1920);
    const doc = {
      preset: "zack-d-films",
      items: [
        { from: 0.0, to: 0.534, text: "She jumped" },
        { from: 0.567, to: 1.2, text: "from a plane" },
        { from: 1.5, to: 2.0, text: "after pause" },
        { from: 2.033, to: 2.5, text: "with opt-out", seamlessGap: 0 },
        { from: 2.533, to: 3.0, text: "after opt-out" },
        { from: 3.0, to: 3.5, text: "fading out", out: { fx: "fade", len: 0.2 } },
        { from: 3.533, to: 4.0, text: "after fade" },
      ],
    };

    drawn.length = 0;
    draw(doc, 17 / 30);
    expect(drawn).toEqual(["She jumped"]);

    drawn.length = 0;
    draw(doc, 18 / 30);
    expect(drawn).toEqual(["from a plane"]);

    drawn.length = 0;
    draw(doc, 1.35);
    expect(drawn).toEqual([]);

    drawn.length = 0;
    draw(doc, 2.515);
    expect(drawn).toEqual([]);

    drawn.length = 0;
    draw(doc, 3.515);
    expect(drawn).toEqual([]);
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

test("makeTitles supersamples 720p drafts crisply, honors weight/stroke.join, and keeps normalized boxes identical", () => {
  const prevDoc = (globalThis as { document?: unknown }).document;
  const createdCanvas = { width: 0, height: 0, getContext: () => ctx };
  const strokes: { join: unknown; miter: unknown; width: unknown; font: unknown }[] = [];
  const ctx = new Proxy(
    { measureText: (s: string) => ({ width: s.length * 18 }) } as Record<string, unknown>,
    {
      get: (o, k) =>
        k in o
          ? o[k as string]
          : k === "strokeText"
            ? () =>
                strokes.push({
                  join: o.lineJoin,
                  miter: o.miterLimit,
                  width: o.lineWidth,
                  font: o.font,
                })
            : () => {},
      set: (o, k, v) => ((o[k as string] = v), true),
    },
  );
  (globalThis as { document?: unknown }).document = {
    createElement: () => createdCanvas,
    fonts: { load: async () => {}, addEventListener() {} },
  };
  try {
    const doc = {
      preset: "zack-d-films",
      items: [{ from: 0, to: 2, text: "it was strange" }],
    };
    const draw = makeTitles({ autoClear: true, render() {} }, 720, 1280, { doc });
    expect(createdCanvas.width).toBe(1080);
    expect(createdCanvas.height).toBe(1920);
    expect(draw.presets.some((p: { id: string }) => p.id === "zack-d-films")).toBe(true);

    draw(doc, 1);
    expect(strokes.at(-1)).toMatchObject({ join: "miter", miter: 4, width: 4 });
    expect(String(strokes.at(-1)!.font)).toContain("700 75px");
    expect(String(strokes.at(-1)!.font)).toContain("Tahoma");

    const beforeLen = strokes.length;
    (doc.items[0] as Record<string, unknown>).stroke = { join: "bevel" };
    draw(doc, 1);
    expect(strokes.length).toBeGreaterThan(beforeLen);
    expect(strokes.at(-1)!.join).toBe("bevel");

    const boxes = draw.boxes(doc, 1);
    expect(boxes.length).toBe(1);
    expect(boxes[0].box[1]).toBeGreaterThan(0.7);
    expect(boxes[0].box[3]).toBeLessThan(0.85);
  } finally {
    (globalThis as { document?: unknown }).document = prevDoc;
  }
});

test("zack-d-films preset renders Tahoma Bold at exact 1080x1920 reference bbox in headless Chrome", async () => {
  const { existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { spawn } = await import("node:child_process");
  const { FONTS, resolveTextItem } = await import("../src/titles-catalog");
  const chrome = resolve(
    import.meta.dir,
    "../../../vault/tools/chrome-headless-shell/chrome-headless-shell.exe",
  );
  if (!existsSync(chrome)) return;

  const item = resolveTextItem(
    { from: 0, to: 2, text: "it was strange" },
    { preset: "zack-d-films", items: [] },
  );
  const fontCss = FONTS.find((f) => f.id === item.font)!.css;
  let metrics: Record<string, number> | null = null;
  let done!: () => void;
  const waited = new Promise<void>((r) => {
    done = r;
  });
  const html = `<!doctype html><html><body><canvas id="c" width="1080" height="1920"></canvas><script>
const c = document.getElementById("c");
const ctx = c.getContext("2d");
ctx.fillStyle = "rgb(128,128,128)";
ctx.fillRect(0, 0, 1080, 1920);
const px = ${item.size};
ctx.font = "${item.weight} " + px + "px ${fontCss.replace(/"/g, '\\"')}";
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.textRendering = "geometricPrecision";
ctx.fontKerning = "normal";
const x = Math.round(1080 * ${item.x});
const y = Math.round(1920 * ${item.y});
ctx.save();
ctx.lineJoin = "${item.stroke!.join}";
ctx.miterLimit = ${item.stroke!.miterLimit};
ctx.lineWidth = ${item.stroke!.width};
ctx.strokeStyle = "${item.stroke!.color}";
ctx.shadowColor = "${item.shadow && typeof item.shadow === "object" ? item.shadow.color : "transparent"}";
ctx.shadowBlur = px * ${item.shadow && typeof item.shadow === "object" ? item.shadow.blur : 0};
ctx.shadowOffsetX = px * ${item.shadow && typeof item.shadow === "object" ? item.shadow.x : 0};
ctx.shadowOffsetY = px * ${item.shadow && typeof item.shadow === "object" ? item.shadow.y : 0};
ctx.strokeText("it was strange", x, y);
ctx.restore();
ctx.fillStyle = "${item.color}";
ctx.fillText("it was strange", x, y);
const d = ctx.getImageData(0, 0, 1080, 1920).data;
let wx0 = 1080, wx1 = 0, wy0 = 1920, wy1 = 0;
let dx0 = 1080, dx1 = 0, dy0 = 1920, dy1 = 0;
for (let py = 1400; py < 1620; py++) {
  for (let px0 = 150; px0 < 930; px0++) {
    const i = (py * 1080 + px0) * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 235 && g > 235 && b > 235) {
      if (px0 < wx0) wx0 = px0; if (px0 > wx1) wx1 = px0;
      if (py < wy0) wy0 = py; if (py > wy1) wy1 = py;
    }
    if (r < 40 && g < 40 && b < 40) {
      if (px0 < dx0) dx0 = px0; if (px0 > dx1) dx1 = px0;
      if (py < dy0) dy0 = py; if (py > dy1) dy1 = py;
    }
  }
}
fetch("/done", { method: "POST", body: JSON.stringify({ wx0, wx1, wy0, wy1, dx0, dx1, dy0, dy1 }) });
</script></body></html>`;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === "/done") {
        metrics = (await req.json()) as Record<string, number>;
        done();
        return new Response("ok");
      }
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  const proc = spawn(
    chrome,
    ["--headless", "--disable-gpu", "--no-first-run", `http://127.0.0.1:${server.port}/`],
    { stdio: "ignore" },
  );
  try {
    await Promise.race([
      waited,
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error("chrome timeout")), 15000)),
    ]);
  } finally {
    proc.kill();
    server.stop(true);
  }
  expect(metrics).not.toBeNull();
  expect(Math.abs(metrics!.wx0 - 277)).toBeLessThanOrEqual(2);
  expect(Math.abs(metrics!.wx1 - 804)).toBeLessThanOrEqual(2);
  expect(Math.abs(metrics!.wy0 - 1470)).toBeLessThanOrEqual(2);
  expect(Math.abs(metrics!.wy1 - 1541)).toBeLessThanOrEqual(2);
  expect(metrics!.wx0 - metrics!.dx0).toBeGreaterThanOrEqual(1);
  expect(metrics!.wx0 - metrics!.dx0).toBeLessThanOrEqual(4);
  expect(metrics!.dx1 - metrics!.wx1).toBeGreaterThanOrEqual(1);
  expect(metrics!.dx1 - metrics!.wx1).toBeLessThanOrEqual(6);
  expect(metrics!.dy1 - metrics!.wy1).toBeGreaterThanOrEqual(1);
  expect(metrics!.dy1 - metrics!.wy1).toBeLessThanOrEqual(6);
});

test("bridgeSeamlessGaps scans past intervening same-track labels at different positions", async () => {
  const { resolveTextItems } = await import("../src/titles-catalog");
  const bridged = resolveTextItems({
    preset: "zack-d-films",
    items: [
      { from: 0, to: 0.534, text: "She jumped" },
      { from: 0.2, to: 2.0, y: 0.2, text: "30,000 FT" },
      { from: 0.567, to: 1.2, text: "from a plane" },
      { from: 1.233, to: 1.8, text: "wrong clock", timebase: "heard" },
      { from: 1.234, to: 2.0, text: "and survived" },
    ],
  });
  expect(bridged[0].to).toBe(0.567);
  expect(bridged[1].to).toBe(2.0);
  expect(bridged[2].to).toBe(1.234);
  expect(bridged[3].to).toBe(1.8);
});
