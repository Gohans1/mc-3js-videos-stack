import {
  TRANSITION_CATEGORIES,
  TRANSITION_EASES,
  type TransitionEase,
  TRANSITIONS,
} from "film-stage/transitions-meta";

export interface TransitionData {
  params?: Record<string, number | boolean | number[]>;
  props?: import("film-stage/openfilm-page").PageProps;
  fx: string;
  len: number;
  ease?: TransitionEase;
  feather?: number;
  flip?: boolean;
  [k: string]: unknown;
}

export interface TransitionMeta {
  id: string;
  title: string;
  tip: string;
  category?: string;
  cat?: string;
  len?: number;
  flip?: boolean;
  feather?: boolean;
  ease?: TransitionEase;
  glsl?: string;
}

export const transitionSupportsFlip = (fx?: TransitionMeta): boolean => {
  if (!fx) return true;
  if (typeof fx.flip === "boolean") return fx.flip;
  return typeof fx.glsl === "string" ? fx.glsl.includes("uFlip") : true;
};

export const transitionSupportsFeather = (fx?: TransitionMeta): boolean => {
  if (!fx) return true;
  if (typeof fx.feather === "boolean") return fx.feather;
  return typeof fx.glsl === "string" ? fx.glsl.includes("uFeather") : true;
};

export const transitionEaseChoices = (fx?: TransitionMeta, current?: TransitionEase) =>
  TRANSITION_EASES.filter((e) => e.id !== "linear" || fx?.ease || current === "linear");

const r2 = (v: number) => Math.round(v * 100) / 100;

export const transitionCatOf = (fx: TransitionMeta): string => fx.category ?? fx.cat ?? "Custom";

export const transitionCategories = (list: readonly TransitionMeta[]): string[] => {
  const present = new Set(list.map(transitionCatOf));
  const canonical = TRANSITION_CATEGORIES.filter((c) => present.has(c));
  const extra = [...present].filter(
    (c) => !(TRANSITION_CATEGORIES as readonly string[]).includes(c),
  );
  return ["All", "Favorites", ...canonical, ...extra];
};

export const tidyTransition = (tr: TransitionData): TransitionData => {
  const next: TransitionData = { ...tr };
  if (!next.ease || next.ease === "auto") delete next.ease;
  if (next.feather !== undefined) {
    const f = Math.min(1, Math.max(0, r2(next.feather)));
    if (f === 0.5) delete next.feather;
    else next.feather = f;
  }
  if (!next.flip) delete next.flip;
  return next;
};

const PREVIEW_IDS = new Set<string>(TRANSITIONS.map((t) => t.id));

export const transitionPreviewKind = (fx: TransitionMeta): string =>
  PREVIEW_IDS.has(fx.id) ? fx.id : `cat:${transitionCatOf(fx)}`;

export const freshTransition = (
  cur: TransitionData | undefined,
  fx: string,
  len: number,
  meta?: TransitionMeta,
): TransitionData =>
  tidyTransition({
    fx,
    len,
    ...(cur?.ease ? { ease: cur.ease } : {}),
    ...(cur?.feather !== undefined ? { feather: cur.feather } : {}),
    ...(cur?.flip && transitionSupportsFlip(meta ?? { id: fx, title: fx, tip: "" })
      ? { flip: true }
      : {}),
  });
