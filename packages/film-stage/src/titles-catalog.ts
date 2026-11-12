// The title catalogue: fonts, kinds, and the In/Out voices the studio lists for text and shapes (titles-look.ts plays them).
// A film adds its own voices through makeTitles' extra (an id with a step), which take the place of a built-in one of that id.
export interface Font {
  id: string;
  title: string;
  css: string;
  // the look and the moods it suits (Cinetic faces.json), and whether it draws Vietnamese accents
  tip?: string;
}
export interface TitleVoice {
  id: string;
  title: string;
  len: number;
  cat: string;
  // takes a stagger (0-1 of len spread across words or letters), defaultStagger when the item gives none
  stagger?: boolean;
  defaultStagger?: number;
  // takes an accent tint, defaultTint when the item gives none
  tint?: boolean;
  defaultTint?: string;
}

const NO_VI = "; no Vietnamese accents";
// Every css family here is imported in titles.ts; the rest are Cinetic's faces (all OFL, @fontsource-variable)
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
];
export const fontOf = (id?: string) => (FONTS.find((f) => f.id === id) ?? FONTS[0]!).css;

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

export const DEFAULT_TINT = "#FF6B2C";

export const TEXT_IN: readonly TitleVoice[] = [
  { id: "fade", title: "Fade in", len: 0.5, cat: "Clean" },
  { id: "up", title: "Slide up", len: 0.5, cat: "Clean" },
  { id: "down", title: "Slide down", len: 0.5, cat: "Clean" },
  { id: "blur", title: "Blur", len: 0.6, cat: "Clean" },
  { id: "trackingIn", title: "Tracking lock", len: 0.55, cat: "Clean" },

  {
    id: "wordRise",
    title: "Word rise",
    len: 0.45,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.35,
  },
  {
    id: "staggerWords",
    title: "Beat words",
    len: 0.65,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.45,
  },
  { id: "clipRise", title: "Baseline mask", len: 0.45, cat: "Build & Mask" },
  { id: "wipeIn", title: "Soft write-on", len: 0.5, cat: "Build & Mask" },
  { id: "centreUnmask", title: "Centre unmask", len: 0.45, cat: "Build & Mask" },
  { id: "type", title: "Typewriter", len: 1, cat: "Build & Mask" },
  { id: "easedType", title: "Burst typing", len: 0.85, cat: "Build & Mask" },
  {
    id: "wordBuild",
    title: "Word build",
    len: 0.8,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.7,
  },
  {
    id: "letterReveal",
    title: "Letter reveal",
    len: 0.6,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.6,
    tint: true,
    defaultTint: DEFAULT_TINT,
  },
  { id: "flipUp", title: "Baseline flip", len: 0.3, cat: "Build & Mask" },

  { id: "zoom", title: "Zoom in", len: 0.5, cat: "Pop & Scale" },
  { id: "oversize", title: "Oversize land", len: 0.45, cat: "Pop & Scale" },
  { id: "popIn", title: "Crisp pop", len: 0.38, cat: "Pop & Scale" },
  { id: "barrelIn", title: "Cylinder roll in", len: 0.48, cat: "Pop & Scale" },
  {
    id: "wordBounce",
    title: "Spring bounce",
    len: 0.7,
    cat: "Pop & Scale",
    stagger: true,
    defaultStagger: 0.45,
  },
  { id: "gravityDrop", title: "Gravity drop", len: 0.7, cat: "Pop & Scale" },
  { id: "pendulum", title: "Damped swing", len: 0.9, cat: "Pop & Scale" },
  { id: "arcFlight", title: "Arc flight", len: 0.55, cat: "Pop & Scale" },
  { id: "lensFly", title: "Fly from lens", len: 0.7, cat: "Pop & Scale" },

  {
    id: "inkIn",
    title: "Accent cool",
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
    len: 0.6,
    cat: "Colour & Ink",
    tint: true,
    defaultTint: DEFAULT_TINT,
  },

  {
    id: "fontCycle",
    title: "Font hop",
    len: 0.5,
    cat: "Colour & Ink",
    tint: true,
    defaultTint: DEFAULT_TINT,
  },

  { id: "scramble", title: "Glyph decode", len: 0.65, cat: "Decode & Split" },
  { id: "lineSplitIn", title: "Opposing split", len: 0.5, cat: "Decode & Split" },
  { id: "counter", title: "Count up", len: 1, cat: "Decode & Split" },
  {
    id: "assemble",
    title: "Assemble",
    len: 0.75,
    cat: "Decode & Split",
    stagger: true,
    defaultStagger: 0.5,
  },
  { id: "echoIn", title: "Echo stamps", len: 0.6, cat: "Decode & Split" },
];

export const TEXT_OUT: readonly TitleVoice[] = [
  { id: "fade", title: "Fade out", len: 0.5, cat: "Clean" },
  { id: "down", title: "Slide down", len: 0.5, cat: "Clean" },
  { id: "up", title: "Drift up", len: 0.45, cat: "Clean" },
  { id: "blur", title: "Blur", len: 0.6, cat: "Clean" },
  { id: "blurExit", title: "Defocus tail", len: 0.4, cat: "Clean" },

  { id: "type", title: "Typewriter", len: 0.6, cat: "Build & Mask" },
  { id: "clipDrop", title: "Baseline drop", len: 0.38, cat: "Build & Mask" },
  { id: "clipUp", title: "Mask lift", len: 0.38, cat: "Build & Mask" },
  {
    id: "wordDropOut",
    title: "Reading drop-out",
    len: 0.5,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.45,
  },
  {
    id: "letterHide",
    title: "Vanish from end",
    len: 0.45,
    cat: "Build & Mask",
    stagger: true,
    defaultStagger: 0.8,
  },
  { id: "flipAway", title: "Tilt away", len: 0.35, cat: "Build & Mask" },

  { id: "zoom", title: "Zoom out", len: 0.5, cat: "Pop & Scale" },
  { id: "collapseOut", title: "Shrink into cut", len: 0.35, cat: "Pop & Scale" },
  { id: "whipLeft", title: "Launch left", len: 0.32, cat: "Pop & Scale" },
  { id: "whipRight", title: "Launch right", len: 0.32, cat: "Pop & Scale" },
  { id: "barrelOut", title: "Cylinder fold", len: 0.38, cat: "Pop & Scale" },
  { id: "gravityFall", title: "Sink", len: 0.45, cat: "Pop & Scale" },
  { id: "lensFlyOut", title: "Rush to lens", len: 0.45, cat: "Pop & Scale" },

  { id: "trackingOut", title: "Tracking spread", len: 0.35, cat: "Decode & Split" },
  { id: "lineSplitOut", title: "Opposing split out", len: 0.4, cat: "Decode & Split" },
  { id: "scrambleOut", title: "Glyph erode", len: 0.45, cat: "Decode & Split" },
  {
    id: "shatter",
    title: "Letters fall",
    len: 0.5,
    cat: "Decode & Split",
    stagger: true,
    defaultStagger: 0.5,
  },
  { id: "echoOut", title: "Echo stamps out", len: 0.5, cat: "Decode & Split" },
];

export const SHAPE_IN: readonly TitleVoice[] = [
  { id: "draw", title: "Draw on", len: 0.5, cat: "Draw" },
  { id: "spinDraw", title: "Spin draw", len: 0.55, cat: "Draw" },
  { id: "wipeIn", title: "Wipe on", len: 0.45, cat: "Draw" },
  { id: "popIn", title: "Crisp pop", len: 0.38, cat: "Pop & Scale" },
  { id: "oversize", title: "Snap shrink", len: 0.45, cat: "Pop & Scale" },
  { id: "zoom", title: "Zoom in", len: 0.4, cat: "Pop & Scale" },
  { id: "growDot", title: "Grow from dot", len: 0.25, cat: "Pop & Scale" },
  { id: "gravityDrop", title: "Gravity drop", len: 0.7, cat: "Pop & Scale" },
  { id: "pendulum", title: "Damped swing", len: 0.9, cat: "Pop & Scale" },
  { id: "fade", title: "Fade in", len: 0.4, cat: "Clean" },
  { id: "up", title: "Slide up", len: 0.4, cat: "Clean" },
];

export const SHAPE_OUT: readonly TitleVoice[] = [
  { id: "undraw", title: "Erase off", len: 0.4, cat: "Draw" },
  { id: "expandFade", title: "Ripple out", len: 0.45, cat: "Pop & Scale" },
  { id: "collapseOut", title: "Shrink into cut", len: 0.35, cat: "Pop & Scale" },
  { id: "gravityFall", title: "Sink", len: 0.45, cat: "Pop & Scale" },
  { id: "zoom", title: "Zoom out", len: 0.4, cat: "Pop & Scale" },
  { id: "fade", title: "Fade out", len: 0.4, cat: "Clean" },
  { id: "down", title: "Slide down", len: 0.4, cat: "Clean" },
];
