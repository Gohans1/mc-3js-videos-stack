import {
  type Bezier,
  bezierEaseFn,
  DEFAULT_CUSTOM_CURVE,
  type Ease,
  easeToBezierWith,
  endSlope,
  entryHandleForSlope,
  exitHandleForSlope,
  fitBezier,
  KNOWN_BEZIERS,
  roundCurve,
  sameCurve,
  startSlope,
} from "./ease-math";
import { getFile, postJson } from "./net";
import { S } from "./state";
import { stored } from "./storage";
import { get, set } from "./store";

export type { Bezier, Ease };
export {
  DEFAULT_CUSTOM_CURVE,
  endSlope,
  entryHandleForSlope,
  exitHandleForSlope,
  fitBezier,
  KNOWN_BEZIERS,
  sameCurve,
  startSlope,
};

export interface EaseTemplate {
  id: string;
  name: string;
  curve: Bezier;
  basedOn?: string;
}

export const easeFn = (e: Ease | undefined, fallback: string): ((x: number) => number) | null => {
  if (typeof e === "string" && e.startsWith("reverse:")) {
    const original = easeFn(e.slice(8), fallback);
    return original ? (u) => 1 - original(1 - u) : null;
  }
  if (Array.isArray(e)) return bezierEaseFn(e);
  return S.render?.eases?.[e ?? fallback] ?? null;
};
export const easeNames = () => Object.keys(S.render?.eases ?? {});

export const easeToBezier = (e: Ease | undefined, fallback: string): Bezier =>
  easeToBezierWith(e, fallback, (name) => S.render?.eases?.[name] ?? null);

export const alignedEntryCurve = ({
  prevCurve,
  prevDuration,
  currCurve,
  currDuration,
  fallback = "smooth",
}: {
  prevCurve: Ease | undefined;
  prevDuration: number;
  currCurve: Ease | undefined;
  currDuration: number;
  fallback?: string;
}): Bezier => {
  const fPrev = easeFn(prevCurve, fallback);
  const vIn = fPrev && prevDuration > 1e-5 ? endSlope(fPrev) / prevDuration : 0;
  const targetSlope = Math.max(0, vIn * Math.max(currDuration, 1e-5));
  const [, , cx2, cy2] = easeToBezier(currCurve, fallback);
  const [x1, y1] = entryHandleForSlope(targetSlope);
  return [x1, y1, cx2, cy2];
};

export const alignedExitCurve = ({
  currCurve,
  currDuration,
  nextCurve,
  nextDuration,
  fallback = "smooth",
}: {
  currCurve: Ease | undefined;
  currDuration: number;
  nextCurve: Ease | undefined;
  nextDuration: number;
  fallback?: string;
}): Bezier => {
  const fNext = easeFn(nextCurve, fallback);
  const vOut = fNext && nextDuration > 1e-5 ? startSlope(fNext) / nextDuration : 0;
  const targetSlope = Math.max(0, vOut * Math.max(currDuration, 1e-5));
  const [cx1, cy1] = easeToBezier(currCurve, fallback);
  const [x2, y2] = exitHandleForSlope(targetSlope);
  return [cx1, cy1, x2, y2];
};

const TITLES: Record<string, string> = {
  smooth: "Smooth",
  linear: "Linear",
  out: "Ease Out",
  in: "Ease In",
  inout: "Ease",
  expo: "Expo In",
  snapOut: "Snap Out",
  glideOut: "Glide Out",
  settleOut: "Settle Out",
  softOut: "Soft Out",
  liftOut: "Lift Out",
  jump: "Jump Out",
  xpArrive: "Exp Arrive",
  stdInOut: "Std S-Curve",
  strongInOut: "Strong S",
  whipBuild: "Whip Build",
  anticipate: "Anticipate",
  xpTravel: "Exp Travel",
  softIn: "Soft Leave",
  buildIn: "Build Leave",
  launchIn: "Launch Leave",
  xpLeave: "Exp Leave",
};
export const easeTitle = (e: Ease | undefined, fallback: string) =>
  Array.isArray(e) ? `Custom curve (${e.join(", ")})` : (TITLES[e ?? fallback] ?? e ?? fallback);

const LOCAL_TEMPLATES_KEY = "easeTemplates";

const readLocalTemplates = (): EaseTemplate[] => {
  try {
    const raw = JSON.parse(stored.get(LOCAL_TEMPLATES_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

const writeLocalTemplates = (list: EaseTemplate[]) => {
  set({ easeTemplates: list });
  stored.set(LOCAL_TEMPLATES_KEY, JSON.stringify(list));
};

export const loadEaseTemplates = async () => {
  try {
    const r = await fetch("/api/ease-templates");
    if (r.ok) {
      const list = (await r.json()) as EaseTemplate[];
      writeLocalTemplates(Array.isArray(list) ? list : []);
      return;
    }
  } catch {}
  set({ easeTemplates: readLocalTemplates() });
};

export const saveEaseTemplate = async (input: {
  id?: string;
  name: string;
  curve: Bezier;
  basedOn?: string;
}): Promise<EaseTemplate | null> => {
  const name = input.name.trim();
  if (!name) return null;
  const payload = {
    ...(input.id ? { id: input.id } : {}),
    name,
    curve: roundCurve(input.curve),
    ...(input.basedOn ? { basedOn: input.basedOn } : {}),
  };
  try {
    const r = await postJson("/api/ease-templates", payload);
    if (r.ok) {
      const saved = (await r.json()) as EaseTemplate;
      const cur = get().easeTemplates;
      const idx = cur.findIndex((t) => t.id === saved.id);
      writeLocalTemplates(idx >= 0 ? cur.map((t, i) => (i === idx ? saved : t)) : [...cur, saved]);
      return saved;
    }
  } catch {}
  const cur = get().easeTemplates;
  const saved: EaseTemplate = {
    id: input.id || `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    curve: payload.curve,
    ...(input.basedOn ? { basedOn: input.basedOn } : {}),
  };
  const idx = cur.findIndex((t) => t.id === saved.id);
  writeLocalTemplates(idx >= 0 ? cur.map((t, i) => (i === idx ? saved : t)) : [...cur, saved]);
  return saved;
};

export const deleteEaseTemplate = async (id: string) => {
  try {
    await fetch(`/api/ease-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {}
  writeLocalTemplates(get().easeTemplates.filter((t) => t.id !== id));
};

export const getEaseTemplatesSnapshot = async () => {
  const r = await getFile("/api/ease-templates").catch(() => null);
  return r?.ok ? ((await r.json()) as EaseTemplate[]) : readLocalTemplates();
};
