import {
  DEFAULT_TINT,
  SHAPE_CATEGORIES,
  TEXT_CATEGORIES,
  TEXT_IN,
  TEXT_OUT,
  TITLE_EASES,
} from "film-stage/titles";

import type { Ease } from "../core/ease";

export interface TitleFxData {
  fx: string;
  len?: number;
  ease?: Ease;
  stagger?: number;
  tint?: string;
  hold?: number;
  [k: string]: unknown;
}

export interface TitleFxMeta {
  id: string;
  title: string;
  len: number;
  cat?: string;
  tip?: string;
  stagger?: boolean;
  defaultStagger?: number;
  tint?: boolean;
  defaultTint?: string;
}

const BUILTIN_VOICES = new Map<string, TitleFxMeta>(
  [...TEXT_IN, ...TEXT_OUT].map((v) => [v.id, v as TitleFxMeta]),
);

export const TINT_SWATCHES = [
  DEFAULT_TINT,
  "#38BDF8",
  "#FDE68A",
  "#E5484D",
  "#3AA99F",
  "#A78BFA",
] as const;

// Cinetic on-twos: a voice may step its clock every 2 or 3 film frames
export const TITLE_HOLDS = [
  { id: "1", title: "Smooth" },
  { id: "2", title: "On twos" },
  { id: "3", title: "On threes" },
] as const;

// The ids come from film-stage's TITLE_EASES, so a curve added there shows here even before it gets words of its own
const CURVE_WORDS: Record<string, { title: string; tip: string }> = {
  auto: { title: "Auto", tip: "Each voice's own tuned Cinetic curve" },
  linear: { title: "Linear", tip: "Constant rate from start to finish" },
  smooth: { title: "Smooth", tip: "Symmetric stdInOut acceleration and settle" },
  snap: { title: "Snap", tip: "Front-loaded snapOut arrival or crisp exit" },
  glide: { title: "Glide", tip: "Cinetic house glideOut arrival" },
  launch: { title: "Launch", tip: "Accelerating launchIn into the cut" },
};
export const TITLE_CURVES = TITLE_EASES.map((id) => ({
  id,
  ...(CURVE_WORDS[id] ?? { title: id, tip: "" }),
}));

const r2 = (v: number) => Math.round(v * 100) / 100;

const metaOf = (idOrMeta: string | TitleFxMeta | null | undefined): TitleFxMeta | undefined => {
  if (!idOrMeta) return undefined;
  return typeof idOrMeta === "string" ? BUILTIN_VOICES.get(idOrMeta) : idOrMeta;
};

// What a voice takes comes from its catalogue entry (film-stage titles-catalog.ts) or a film's own voice meta
export const voiceSupportsStagger = (idOrMeta: string | TitleFxMeta | null | undefined) =>
  metaOf(idOrMeta)?.stagger === true;

export const voiceSupportsTint = (idOrMeta: string | TitleFxMeta | null | undefined) =>
  metaOf(idOrMeta)?.tint === true;

export const voiceDefaultStagger = (idOrMeta: string | TitleFxMeta | null | undefined) =>
  metaOf(idOrMeta)?.defaultStagger ?? 0.4;

export const voiceDefaultTint = (idOrMeta: string | TitleFxMeta | null | undefined): string =>
  metaOf(idOrMeta)?.defaultTint ?? DEFAULT_TINT;

export const shapeUsesLength = (kind: string): boolean => kind === "arrow" || kind === "underline";

export const shapeLabel = (kind: string): string => {
  if (kind === "arrow") return "Arrow";
  if (kind === "circle") return "Circle";
  if (kind === "box") return "Box";
  if (kind === "bracket") return "Brackets";
  if (kind === "underline") return "Underline";
  return kind ? kind[0]!.toUpperCase() + kind.slice(1) : "Shape";
};

export const shapeGlyph = (kind: string): string => {
  if (kind === "arrow") return "↗";
  if (kind === "circle") return "◯";
  if (kind === "box") return "□";
  if (kind === "bracket") return "[ ]";
  if (kind === "underline") return "▁";
  return "◇";
};

export const orderedTitleCategories = (
  list: readonly { cat?: string }[],
  shape = false,
): string[] => {
  const present = new Set(list.map((x) => x.cat ?? "Custom"));
  const base = shape ? SHAPE_CATEGORIES : TEXT_CATEGORIES;
  const canonical = base.filter((c) => present.has(c));
  const extra = [...present].filter((c) => !(base as readonly string[]).includes(c));
  return ["All", "Favorites", ...canonical, ...extra];
};

export const tidyTitleFx = (fx: TitleFxData, meta?: TitleFxMeta): TitleFxData => {
  const next: TitleFxData = { ...fx };
  const isBuiltin = meta ? BUILTIN_VOICES.has(meta.id) : false;
  if (next.len !== undefined) next.len = Math.max(0.05, r2(next.len));
  if (!next.ease || next.ease === "auto") delete next.ease;
  if (next.hold !== undefined) {
    const hold = Math.round(Number(next.hold));
    if (hold >= 2 && hold <= 12) next.hold = hold;
    else delete next.hold;
  }
  if (next.stagger !== undefined) {
    if (meta && (meta.stagger === false || (isBuiltin && !voiceSupportsStagger(meta))))
      delete next.stagger;
    else next.stagger = Math.min(1, Math.max(0, r2(next.stagger)));
  }
  if (next.tint !== undefined) {
    if (!next.tint || (meta && (meta.tint === false || (isBuiltin && !voiceSupportsTint(meta)))))
      delete next.tint;
    else if (/^#[0-9a-f]{3,8}$/i.test(next.tint)) next.tint = next.tint.toUpperCase();
  }
  return next;
};

export const freshTitleFx = (cur: TitleFxData | undefined, meta: TitleFxMeta): TitleFxData =>
  tidyTitleFx(
    {
      fx: meta.id,
      len: cur?.len ?? meta.len,
      ...(cur?.ease ? { ease: cur.ease } : {}),
      ...(cur?.hold ? { hold: cur.hold } : {}),
      ...(cur?.stagger !== undefined && voiceSupportsStagger(meta) ? { stagger: cur.stagger } : {}),
      ...(cur?.tint && voiceSupportsTint(meta) ? { tint: cur.tint } : {}),
    },
    meta,
  );
