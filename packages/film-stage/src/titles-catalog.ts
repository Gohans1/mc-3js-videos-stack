export interface Font {
  id: string;
  title: string;
  css: string;
  tip?: string;
}
export interface TitleVoice {
  id: string;
  title: string;
  tip: string;
  len: number;
  cat: string;
  stagger?: boolean;
  defaultStagger?: number;
  tint?: boolean;
  defaultTint?: string;
}

const NO_VI = "; no Vietnamese accents";
export const FONTS: readonly Font[] = [
  {
    id: "sans",
    title: "Inter",
    css: "'Inter Variable', sans-serif",
    tip: "Product: calm, technical, finance",
  },
  {
    id: "mono",
    title: "Plex Mono",
    css: "'IBM Plex Mono', monospace",
    tip: "Code, data, terminal",
  },
  {
    id: "serif",
    title: "Source Serif",
    css: "'Source Serif 4 Variable', serif",
    tip: "Book, documentary, quote",
  },
  {
    id: "instrument-sans",
    title: "Instrument Sans",
    css: "'Instrument Sans Variable', sans-serif",
    tip: `Swiss: calm, editorial, finance, creative${NO_VI}`,
  },
  {
    id: "schibsted-grotesk",
    title: "Schibsted Grotesk",
    css: "'Schibsted Grotesk Variable', sans-serif",
    tip: `Newsroom: editorial, bold, finance, consumer${NO_VI}`,
  },
  {
    id: "host-grotesk",
    title: "Host Grotesk",
    css: "'Host Grotesk Variable', sans-serif",
    tip: `Studio: creative, consumer, calm, AI${NO_VI}`,
  },
  {
    id: "funnel-display",
    title: "Funnel Display",
    css: "'Funnel Display Variable', sans-serif",
    tip: `Funnel headline: bold, creative, AI, technical${NO_VI}`,
  },
  {
    id: "funnel-sans",
    title: "Funnel Sans",
    css: "'Funnel Sans Variable', sans-serif",
    tip: `Funnel's text face, under a Funnel Display title${NO_VI}`,
  },
  {
    id: "mona-sans",
    title: "Mona Sans",
    css: "'Mona Sans Variable', sans-serif",
    tip: "Wide: bold, technical, AI, finance",
  },
  {
    id: "hanken-grotesk",
    title: "Hanken Grotesk",
    css: "'Hanken Grotesk Variable', sans-serif",
    tip: "Precise: calm, finance, consumer, editorial",
  },
  {
    id: "geist",
    title: "Geist",
    css: "'Geist Variable', sans-serif",
    tip: "Technical: developer tools, AI",
  },
  {
    id: "dm-sans",
    title: "DM Sans",
    css: "'DM Sans Variable', sans-serif",
    tip: `Geometric: consumer, friendly, AI, calm${NO_VI}`,
  },
  {
    id: "manrope",
    title: "Manrope",
    css: "'Manrope Variable', sans-serif",
    tip: "Friendly: consumer, warm, calm",
  },
  {
    id: "bricolage-grotesque",
    title: "Bricolage Grotesque",
    css: "'Bricolage Grotesque Variable', sans-serif",
    tip: "Expressive: creative, consumer, bold",
  },
  {
    id: "geist-mono",
    title: "Geist Mono",
    css: "'Geist Mono Variable', monospace",
    tip: "Mono beside Geist: numbers, code, labels",
  },
  {
    id: "tahoma",
    title: "Tahoma",
    css: "'Tahoma', 'DejaVu Sans', sans-serif",
    tip: "Crisp humanist sans: YouTube Shorts captions (Windows/macOS system font)",
  },
  {
    id: "verdana",
    title: "Verdana",
    css: "'Verdana', 'DejaVu Sans', sans-serif",
    tip: "Wide humanist sans: legible screen captions (Windows/macOS system font)",
  },
];
export const fontOf = (id?: string, own: readonly Font[] = []) =>
  (own.find((f) => f.id === id) ?? FONTS.find((f) => f.id === id) ?? FONTS[0]!).css;

export interface TextStroke {
  color?: string;
  width?: number;
  join?: "round" | "miter" | "bevel";
  miterLimit?: number;
}
export interface TextShadow {
  color?: string;
  blur?: number;
  x?: number;
  y?: number;
}
export interface TextSafeArea {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}
export interface TextStylePreset {
  id: string;
  title: string;
  tip: string;
  style: Record<string, unknown>;
}
export const TEXT_PRESETS: readonly TextStylePreset[] = [
  {
    id: "zack-d-films",
    title: "Zack D. Films",
    tip: "Pixel-matched 9:16 narration captions: Tahoma Bold 75px, 2px black miter outline, tight drop shadow, y=78.4%",
    style: {
      kind: "text",
      font: "tahoma",
      weight: 700,
      bold: true,
      size: 75,
      line: 1.15,
      spacing: 0,
      x: 0.5,
      y: 0.784,
      align: "center",
      color: "#FFFFFF",
      stroke: { color: "#000000", width: 4, join: "miter", miterLimit: 4 },
      shadow: { color: "rgba(0,0,0,1)", blur: 0.015, x: 0.034, y: 0.034 },
      safeArea: { bottom: 0.18 },
      seamlessGap: 0.06,
    },
  },
  {
    id: "clean-caption",
    title: "Clean caption",
    tip: "High-contrast Inter Bold subtitles with soft outline and shadow",
    style: {
      kind: "text",
      font: "sans",
      weight: 700,
      bold: true,
      size: 64,
      line: 1.18,
      x: 0.5,
      y: 0.78,
      align: "center",
      color: "#FFFFFF",
      stroke: { color: "#000000", width: 4, join: "round" },
      shadow: { color: "rgba(0,0,0,0.75)", blur: 0.08, x: 0, y: 0.03 },
      safeArea: { bottom: 0.18 },
    },
  },
  {
    id: "doc-lower-third",
    title: "Doc lower-third",
    tip: "Documentary lower-left Plex Mono readout",
    style: {
      kind: "text",
      font: "mono",
      weight: 600,
      size: 40,
      spacing: 0.06,
      line: 1.35,
      x: 0.07,
      y: 0.84,
      align: "left",
      color: "#FFFFFF",
    },
  },
];
export const TEXT_PRESET_IDS: readonly string[] = TEXT_PRESETS.map((p) => p.id);
export const textPresetOf = (id?: string, own: readonly TextStylePreset[] = []) =>
  id ? (own.find((p) => p.id === id) ?? TEXT_PRESETS.find((p) => p.id === id) ?? null) : null;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const mergeStyleLayer = (
  base: Record<string, unknown>,
  patch?: Record<string, unknown> | null,
): Record<string, unknown> => {
  if (!isObj(patch)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "stroke") {
      out.stroke =
        v === null || v === false
          ? undefined
          : isObj(v) && isObj(out.stroke)
            ? { ...out.stroke, ...v }
            : v;
    } else if (k === "shadow") {
      out.shadow =
        v === false || v === null
          ? false
          : isObj(v) && isObj(out.shadow)
            ? { ...out.shadow, ...v }
            : v;
    } else if (k === "background") {
      out.background =
        v === null || v === false
          ? undefined
          : isObj(v) && isObj(out.background)
            ? { ...out.background, ...v }
            : v;
    } else if (k === "safeArea") {
      out.safeArea =
        v === false
          ? false
          : isObj(v) && isObj(out.safeArea)
            ? { ...out.safeArea, ...v }
            : v;
    } else if (k === "in" || k === "out") {
      out[k] = v === null || (isObj(v) && v.fx === "none") ? undefined : v;
    } else {
      out[k] = v;
    }
  }
  return out;
};

export interface TextDocLike {
  items?: readonly Record<string, unknown>[];
  tracks?: Record<string, unknown>;
  preset?: string;
  defaults?: Record<string, unknown>;
}

export const resolveTextItem = <T extends Record<string, unknown>>(
  it: T,
  doc?: TextDocLike | null,
  extraPresets: readonly TextStylePreset[] = [],
): T => {
  const itemPreset =
    typeof it?.preset === "string" ? textPresetOf(it.preset, extraPresets)?.style : undefined;
  const effKind = it?.kind ?? itemPreset?.kind;
  const rawDocPreset = textPresetOf(doc?.preset, extraPresets)?.style;
  const docPreset =
    rawDocPreset && (!effKind || effKind === (rawDocPreset.kind ?? "text"))
      ? rawDocPreset
      : undefined;
  const rawDocDefaults = doc?.defaults;
  const docDefaults =
    rawDocDefaults && (!effKind || effKind === (rawDocDefaults.kind ?? "text"))
      ? rawDocDefaults
      : undefined;
  if (!docPreset && !docDefaults && !itemPreset) {
    const cleaned =
      (isObj(it?.in) && (it.in as Record<string, unknown>).fx === "none") ||
      (isObj(it?.out) && (it.out as Record<string, unknown>).fx === "none");
    if (!cleaned) return it.kind ? it : ({ kind: "text", ...it } as T);
    const out = mergeStyleLayer({}, it);
    if (!out.kind) out.kind = "text";
    return out as T;
  }
  let merged: Record<string, unknown> = {};
  if (!itemPreset && docPreset) merged = mergeStyleLayer(merged, docPreset);
  if (docDefaults) merged = mergeStyleLayer(merged, docDefaults);
  if (itemPreset) merged = mergeStyleLayer(merged, itemPreset);
  merged = mergeStyleLayer(merged, it);
  if (!merged.kind) merged.kind = "text";
  return merged as T;
};

const sameTimebase = (a: unknown, b: unknown) =>
  a === b || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));

export const bridgeSeamlessGaps = <T extends Record<string, unknown>>(
  items: readonly T[],
  tracks?: Record<string, unknown> | null,
): T[] => {
  const out = items.slice();
  const byTrack = new Map<number, number[]>();
  for (let i = 0; i < out.length; i++) {
    const it = out[i];
    if (!it || (it.kind ?? "text") !== "text" || it.hidden || it.at) continue;
    const tr = typeof it.track === "number" ? it.track : 0;
    const trackInfo = tracks?.[tr];
    if (isObj(trackInfo) && trackInfo.hidden) continue;
    if (
      typeof it.from !== "number" ||
      typeof it.to !== "number" ||
      !Number.isFinite(it.from) ||
      !Number.isFinite(it.to) ||
      it.to <= it.from
    )
      continue;
    const bucket = byTrack.get(tr);
    if (bucket) bucket.push(i);
    else byTrack.set(tr, [i]);
  }
  for (const idxs of byTrack.values()) {
    if (idxs.length < 2) continue;
    idxs.sort(
      (a, b) =>
        (out[a]!.from as number) - (out[b]!.from as number) ||
        (out[a]!.to as number) - (out[b]!.to as number),
    );
    for (let k = 0; k < idxs.length - 1; k++) {
      const pi = idxs[k]!;
      const prev = out[pi]!;
      const maxGap =
        typeof prev.seamlessGap === "number" && Number.isFinite(prev.seamlessGap)
          ? prev.seamlessGap
          : 0;
      if (maxGap <= 0) continue;
      if (isObj(prev.out) && prev.out.fx) continue;
      const px = typeof prev.x === "number" ? prev.x : 0.5,
        py = typeof prev.y === "number" ? prev.y : 0.5;
      const pTo = prev.to as number;
      for (let m = k + 1; m < idxs.length; m++) {
        const next = out[idxs[m]!]!;
        const gap = (next.from as number) - pTo;
        if (gap > maxGap) break;
        const nx = typeof next.x === "number" ? next.x : 0.5,
          ny = typeof next.y === "number" ? next.y : 0.5;
        if (Math.abs(px - nx) >= 0.08 || Math.abs(py - ny) >= 0.08) continue;
        if (!sameTimebase(prev.timebase, next.timebase)) continue;
        if (gap <= 0) {
          if ((next.to as number) > pTo) break;
          continue;
        }
        out[pi] = { ...prev, to: next.from };
        break;
      }
    }
  }
  return out;
};

export const resolveTextItems = <T extends Record<string, unknown>>(
  listOrDoc?: readonly T[] | TextDocLike | null,
  extraPresets: readonly TextStylePreset[] = [],
): T[] => {
  if (!listOrDoc) return [];
  if (Array.isArray(listOrDoc)) {
    return bridgeSeamlessGaps(listOrDoc.map((it) => resolveTextItem(it, null, extraPresets)));
  }
  const doc = listOrDoc as TextDocLike;
  return bridgeSeamlessGaps(
    (doc.items ?? []).map((it) => resolveTextItem(it as T, doc, extraPresets)),
    doc.tracks,
  );
};

type FontUser = { font?: string; preset?: string; in?: { fx?: string }; out?: { fx?: string } };
export const fontsFor = (
  itemsOrDoc?: readonly FontUser[] | TextDocLike | null,
  own: readonly Font[] = [],
  extraPresets: readonly TextStylePreset[] = [],
): readonly Font[] => {
  const all = [...own, ...FONTS];
  if (!itemsOrDoc) return all;
  const resolved = resolveTextItems(itemsOrDoc as readonly Record<string, unknown>[] | TextDocLike, extraPresets) as FontUser[];
  if (resolved.some((it) => it.in?.fx === "fontCycle" || it.out?.fx === "fontCycle")) return all;
  const ids = new Set(resolved.map((it) => all.find((f) => f.id === it.font)?.id ?? FONTS[0]!.id));
  return all.filter((f) => ids.has(f.id));
};

export const TEXT_CATEGORIES = [
  "Clean",
  "Build & Mask",
  "Pop & Scale",
  "Colour & Ink",
  "Decode & Split",
];
export const SHAPE_CATEGORIES = ["Draw", "Pop & Scale", "Clean"];
export const TITLE_EASES: readonly string[] = [
  "auto",
  "linear",
  "smooth",
  "snap",
  "glide",
  "launch",
];
export const KINDS: readonly string[] = ["text", "arrow", "circle", "box", "bracket", "underline"];
export const isShapeKind = (kind?: string) => Boolean(kind && kind !== "text");
export const SHAPES: Readonly<Record<string, { title: string; tip: string }>> = {
  arrow: { title: "Arrow", tip: "A hand-drawn arrow pointing at something on screen" },
  circle: { title: "Circle", tip: "A ring or ellipse drawn around something to call it out" },
  box: { title: "Box", tip: "A rectangle drawn to frame something, an outline highlight" },
  bracket: {
    title: "Corner brackets",
    tip: "Four corner marks framing something, like a viewfinder or a target lock",
  },
  underline: { title: "Underline", tip: "A stroke drawn under a word or a thing to stress it" },
};

export const DEFAULT_TINT = "#FF6B2C";

export const TEXT_IN: readonly TitleVoice[] = [
  {
    id: "fade",
    title: "Fade in",
    tip: "Fades up from nothing, no movement",
    len: 0.5,
    cat: "Clean",
  },
  {
    id: "up",
    title: "Slide up",
    tip: "Fades in while sliding up a little into place",
    len: 0.5,
    cat: "Clean",
  },
  {
    id: "down",
    title: "Slide down",
    tip: "Fades in while dropping down a little into place",
    len: 0.5,
    cat: "Clean",
  },
  {
    id: "blur",
    title: "Blur",
    tip: "Comes into focus from a heavy blur while fading in",
    len: 0.6,
    cat: "Clean",
  },
  {
    id: "trackingIn",
    title: "Tracking lock",
    tip: "Letters start spread wide apart and close in to normal spacing",
    len: 0.55,
    cat: "Clean",
  },

  {
    id: "wordRise",
    title: "Word rise",
    tip: "Each word rises into place a moment after the one before, soft at first",
    len: 0.45,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.35,
  },
  {
    id: "staggerWords",
    title: "Beat words",
    tip: "Words fade in one after another in reading order, on a beat",
    len: 0.65,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.45,
  },
  {
    id: "clipRise",
    title: "Baseline mask",
    tip: "The line rises up from behind an invisible baseline, as if cut out by a mask",
    len: 0.45,
    cat: "Build & Mask",
  },
  {
    id: "wipeIn",
    title: "Soft write-on",
    tip: "A soft-edged wipe writes the line on from left to right",
    len: 0.5,
    cat: "Build & Mask",
  },
  {
    id: "centreUnmask",
    title: "Centre unmask",
    tip: "Opens from the centre outward, letters tightening as they appear",
    len: 0.45,
    cat: "Build & Mask",
  },
  {
    id: "type",
    title: "Typewriter",
    tip: "Typewriter: letters appear one at a time at an even pace",
    len: 1,
    cat: "Build & Mask",
  },
  {
    id: "easedType",
    title: "Burst typing",
    tip: "Burst typing: letters appear in fast bursts with a blinking caret, like someone typing in a terminal",
    len: 0.85,
    cat: "Build & Mask",
  },
  {
    id: "wordBuild",
    title: "Word build",
    tip: "Words pop up one by one with a small hop, building the sentence",
    len: 0.8,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.7,
  },
  {
    id: "letterReveal",
    title: "Letter reveal",
    tip: "Each letter tumbles in small, turned and offset, then settles; can flash an accent colour",
    len: 0.6,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.6,
    tint: true,
    defaultTint: DEFAULT_TINT,
  },
  {
    id: "flipUp",
    title: "Baseline flip",
    tip: "The line flips up on a hinge at its baseline, like a card standing up",
    len: 0.3,
    cat: "Build & Mask",
  },

  {
    id: "zoom",
    title: "Zoom in",
    tip: "Grows from slightly smaller while fading in",
    len: 0.5,
    cat: "Pop & Scale",
  },
  {
    id: "oversize",
    title: "Oversize land",
    tip: "Lands from oversized and blurred, shrinking sharply into place",
    len: 0.45,
    cat: "Pop & Scale",
  },
  {
    id: "popIn",
    title: "Crisp pop",
    tip: "Pops in with a quick scale overshoot, crisp and bouncy",
    len: 0.38,
    cat: "Pop & Scale",
  },
  {
    id: "barrelIn",
    title: "Cylinder roll in",
    tip: "Rolls in like a cylinder turning toward you, squashed then full height",
    len: 0.48,
    cat: "Pop & Scale",
  },
  {
    id: "wordBounce",
    title: "Spring bounce",
    tip: "Words spring in from above and below alternately and bounce to rest",
    len: 0.7,
    cat: "Pop & Scale",
    stagger: true,
    defaultStagger: 0.45,
  },
  {
    id: "gravityDrop",
    title: "Gravity drop",
    tip: "Falls in from above, hits, squashes and bounces once",
    len: 0.7,
    cat: "Pop & Scale",
  },
  {
    id: "pendulum",
    title: "Damped swing",
    tip: "Swings in hanging from its top edge, a damped swing that settles",
    len: 0.9,
    cat: "Pop & Scale",
  },
  {
    id: "arcFlight",
    title: "Arc flight",
    tip: "Flies in along an arc from the left, turning as it lands",
    len: 0.55,
    cat: "Pop & Scale",
  },
  {
    id: "lensFly",
    title: "Fly from lens",
    tip: "Rushes in from right in front of the lens, huge and blurred, shrinking into place",
    len: 0.7,
    cat: "Pop & Scale",
  },

  {
    id: "inkIn",
    title: "Accent cool",
    tip: "Words arrive in an accent colour and cool to the text colour, staggered",
    len: 0.55,
    cat: "Colour & Ink",
    stagger: true,
    defaultStagger: 0.4,
    tint: true,
    defaultTint: DEFAULT_TINT,
  },
  {
    id: "hueSweepIn",
    title: "Light sweep",
    tip: "A coloured light sweep passes across and reveals the line behind it",
    len: 0.6,
    cat: "Colour & Ink",
    tint: true,
    defaultTint: DEFAULT_TINT,
  },

  {
    id: "fontCycle",
    title: "Font hop",
    tip: "Hops through several typefaces quickly before landing on its own",
    len: 0.5,
    cat: "Colour & Ink",
    tint: true,
    defaultTint: DEFAULT_TINT,
  },

  {
    id: "scramble",
    title: "Glyph decode",
    tip: "Random glyphs decode into the real letters, like a hacker or cipher reveal",
    len: 0.65,
    cat: "Decode & Split",
  },
  {
    id: "lineSplitIn",
    title: "Opposing split",
    tip: "Two halves slide in from opposite sides and meet",
    len: 0.5,
    cat: "Decode & Split",
  },
  {
    id: "counter",
    title: "Count up",
    tip: "A number counts up from zero to its value, for statistics and totals",
    len: 1,
    cat: "Decode & Split",
  },
  {
    id: "assemble",
    title: "Assemble",
    tip: "Letters fly in from scattered, turned positions and assemble into the word",
    len: 0.75,
    cat: "Decode & Split",
    stagger: true,
    defaultStagger: 0.5,
  },
  {
    id: "echoIn",
    title: "Echo stamps",
    tip: "Arrives in hops, stamping repeated echo copies that trail behind it",
    len: 0.6,
    cat: "Decode & Split",
  },
];

export const TEXT_OUT: readonly TitleVoice[] = [
  { id: "fade", title: "Fade out", tip: "Fades away, no movement", len: 0.5, cat: "Clean" },
  {
    id: "down",
    title: "Slide down",
    tip: "Slides down a little while fading out",
    len: 0.5,
    cat: "Clean",
  },
  {
    id: "up",
    title: "Drift up",
    tip: "Drifts up a little while fading out",
    len: 0.45,
    cat: "Clean",
  },
  {
    id: "blur",
    title: "Blur",
    tip: "Melts into a heavy blur while fading out",
    len: 0.6,
    cat: "Clean",
  },
  {
    id: "blurExit",
    title: "Defocus tail",
    tip: "Defocuses hard and shrinks slightly as it fades, a soft tail",
    len: 0.4,
    cat: "Clean",
  },

  {
    id: "type",
    title: "Typewriter",
    tip: "Typewriter backwards: letters delete one at a time",
    len: 0.6,
    cat: "Build & Mask",
  },
  {
    id: "clipDrop",
    title: "Baseline drop",
    tip: "Drops down out of sight behind an invisible baseline mask",
    len: 0.38,
    cat: "Build & Mask",
  },
  {
    id: "clipUp",
    title: "Mask lift",
    tip: "Lifts up out of sight behind an invisible mask",
    len: 0.38,
    cat: "Build & Mask",
  },
  {
    id: "wordDropOut",
    title: "Reading drop-out",
    tip: "Words fade away one after another in reading order, sinking slightly",
    len: 0.5,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.45,
  },
  {
    id: "letterHide",
    title: "Vanish from end",
    tip: "Letters vanish one by one from the end of the line",
    len: 0.45,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.8,
  },
  {
    id: "flipAway",
    title: "Tilt away",
    tip: "Tips away backward on its baseline and blurs out",
    len: 0.35,
    cat: "Build & Mask",
  },

  {
    id: "zoom",
    title: "Zoom out",
    tip: "Shrinks a little while fading out",
    len: 0.5,
    cat: "Pop & Scale",
  },
  {
    id: "collapseOut",
    title: "Shrink into cut",
    tip: "Shrinks quickly into the cut, accelerating",
    len: 0.35,
    cat: "Pop & Scale",
  },
  {
    id: "whipLeft",
    title: "Launch left",
    tip: "Launches off to the left with motion blur",
    len: 0.32,
    cat: "Pop & Scale",
  },
  {
    id: "whipRight",
    title: "Launch right",
    tip: "Launches off to the right with motion blur",
    len: 0.32,
    cat: "Pop & Scale",
  },
  {
    id: "barrelOut",
    title: "Cylinder fold",
    tip: "Folds away like a cylinder rolling back, squashing flat",
    len: 0.38,
    cat: "Pop & Scale",
  },
  {
    id: "gravityFall",
    title: "Sink",
    tip: "Falls down off the frame under gravity, stretching as it drops",
    len: 0.45,
    cat: "Pop & Scale",
  },
  {
    id: "lensFlyOut",
    title: "Rush to lens",
    tip: "Rushes forward into the lens, growing huge and blurred",
    len: 0.45,
    cat: "Pop & Scale",
  },

  {
    id: "trackingOut",
    title: "Tracking spread",
    tip: "Letters spread wide apart and grow as it fades out",
    len: 0.35,
    cat: "Decode & Split",
  },
  {
    id: "lineSplitOut",
    title: "Opposing split out",
    tip: "Splits in two halves that slide apart to opposite sides",
    len: 0.4,
    cat: "Decode & Split",
  },
  {
    id: "scrambleOut",
    title: "Glyph erode",
    tip: "Letters erode into random glyphs and vanish",
    len: 0.45,
    cat: "Decode & Split",
  },
  {
    id: "shatter",
    title: "Letters fall",
    tip: "Letters break apart one by one, spinning and falling down like debris",
    len: 0.5,
    cat: "Decode & Split",
    stagger: true,
    defaultStagger: 0.5,
  },
  {
    id: "echoOut",
    title: "Echo stamps out",
    tip: "Leaves in hops, stamping echo copies as it goes",
    len: 0.5,
    cat: "Decode & Split",
  },
];

export const SHAPE_IN: readonly TitleVoice[] = [
  {
    id: "draw",
    title: "Draw on",
    tip: "The outline draws itself on like a pen stroke",
    len: 0.5,
    cat: "Draw",
  },
  {
    id: "spinDraw",
    title: "Spin draw",
    tip: "Draws itself on while spinning into place",
    len: 0.55,
    cat: "Draw",
  },
  {
    id: "wipeIn",
    title: "Wipe on",
    tip: "A wipe reveals the shape from one side",
    len: 0.45,
    cat: "Draw",
  },
  {
    id: "popIn",
    title: "Crisp pop",
    tip: "Pops in with a quick scale overshoot",
    len: 0.38,
    cat: "Pop & Scale",
  },
  {
    id: "oversize",
    title: "Snap shrink",
    tip: "Snaps in from oversized and blurred, shrinking into place",
    len: 0.45,
    cat: "Pop & Scale",
  },
  {
    id: "zoom",
    title: "Zoom in",
    tip: "Grows from slightly smaller while fading in",
    len: 0.4,
    cat: "Pop & Scale",
  },
  {
    id: "growDot",
    title: "Grow from dot",
    tip: "Grows out of a tiny dot to full size",
    len: 0.25,
    cat: "Pop & Scale",
  },
  {
    id: "gravityDrop",
    title: "Gravity drop",
    tip: "Falls in from above, hits, squashes and bounces once",
    len: 0.7,
    cat: "Pop & Scale",
  },
  {
    id: "pendulum",
    title: "Damped swing",
    tip: "Swings in hanging from its top, a damped swing that settles",
    len: 0.9,
    cat: "Pop & Scale",
  },
  { id: "fade", title: "Fade in", tip: "Fades up, no movement", len: 0.4, cat: "Clean" },
  {
    id: "up",
    title: "Slide up",
    tip: "Fades in while sliding up a little",
    len: 0.4,
    cat: "Clean",
  },
];

export const SHAPE_OUT: readonly TitleVoice[] = [
  {
    id: "undraw",
    title: "Erase off",
    tip: "The outline erases itself like a pen stroke run backward",
    len: 0.4,
    cat: "Draw",
  },
  {
    id: "expandFade",
    title: "Ripple out",
    tip: "Expands outward and fades, like a ripple",
    len: 0.45,
    cat: "Pop & Scale",
  },
  {
    id: "collapseOut",
    title: "Shrink into cut",
    tip: "Shrinks quickly into the cut",
    len: 0.35,
    cat: "Pop & Scale",
  },
  {
    id: "gravityFall",
    title: "Sink",
    tip: "Falls down off the frame under gravity",
    len: 0.45,
    cat: "Pop & Scale",
  },
  {
    id: "zoom",
    title: "Zoom out",
    tip: "Shrinks a little while fading out",
    len: 0.4,
    cat: "Pop & Scale",
  },
  { id: "fade", title: "Fade out", tip: "Fades away, no movement", len: 0.4, cat: "Clean" },
  {
    id: "down",
    title: "Slide down",
    tip: "Slides down a little while fading out",
    len: 0.4,
    cat: "Clean",
  },
];

export const TEXT_ITEM_KEYS = [
  "id",
  "kind",
  "preset",
  "text",
  "from",
  "to",
  "timebase",
  "track",
  "hidden",
  "read",
  "safeArea",
  "seamlessGap",
  "x",
  "y",
  "at",
  "x2",
  "y2",
  "dx",
  "dy",
  "target",
  "upper",
  "font",
  "weight",
  "bold",
  "italic",
  "size",
  "line",
  "spacing",
  "align",
  "color",
  "opacity",
  "scale",
  "rotate",
  "w",
  "h",
  "width",
  "shadow",
  "stroke",
  "background",
  "in",
  "out",
];
