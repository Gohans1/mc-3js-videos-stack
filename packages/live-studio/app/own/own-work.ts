// What a film's code adds on top of the studio's libraries (its own transitions, shot and text animations, eases, speed-ramp
// effects, render checks, sounds, the 3D it builds, stickers, A/B choices, materials, and anything under a name the studio
// doesn't know), for the view-only Film tab, grouped by the kind of thing it is (CapCut's library kinds, plus a 3D film's own),
// and for the "Film" mark on the studio's pickers. The studio
// shows these and never edits them: the film's code is the AI's to change, so nothing here may refuse or drop a field.
// Pure, so the tests read it without a page.

type Rec = Record<string, unknown>;
interface Fx extends Rec {
  id: string;
  title?: string;
  tip?: string;
}
type Slots<T> = { in: readonly T[]; out: readonly T[]; combo: readonly T[] };
type Voices<T> = {
  text: { in: readonly T[]; out: readonly T[] };
  shape: { in: readonly T[]; out: readonly T[] };
};
type Fn = (...a: never[]) => unknown;

export interface OwnInput {
  transitions?: readonly Fx[];
  anims?: Slots<Fx>;
  voices?: Voices<Fx>;
  eases?: Record<string, Fn>;
  velocityEffects?: readonly (string | Fx)[];
  checks?: Record<string, Fn>;
  sounds?: readonly { name: string; title?: string }[]; // the film's own sound files (the Audio library's This film)
  objects?: readonly string[]; // draw.tools.objects' names: what the film's code builds in 3D
  materials?: readonly string[]; // draw.tools.materials' names
  shapes?: readonly Fx[]; // titles.shapes: stickers only the film draws
  textEases?: readonly string[]; // titles.eases
  variants?: readonly {
    id: string;
    title: string;
    options: readonly { id: string; title: string }[];
    pick?: { title: string };
    ranges: readonly (readonly [number, number])[]; // heard seconds
  }[];
  other?: Rec;
}
export interface Builtins {
  transitions: readonly Fx[];
  anims: Slots<Fx>;
  voices: Voices<Fx>;
  eases: Record<string, Fn>;
  velocityEffects: readonly string[];
  textEases?: readonly string[];
}
type Pick = { fx?: string } | undefined;
export interface Usage {
  shots: readonly { t: number; transition?: Pick; anim?: Partial<Record<keyof Slots<Fx>, Pick>> }[]; // heard seconds
  texts: readonly { kind: string; from: number; in?: Pick; out?: Pick }[];
  sounds?: readonly { name: string; t: number }[];
}

// One field as Blender's Custom Properties panel shows it: the name, a one-line value, and the whole of a long one on demand
export interface OwnField {
  key: string;
  text: string;
  code?: () => string; // written out only when opened: an engine object the film hands over can be megabytes
}
export interface OwnItem {
  id: string;
  title: string;
  tip?: string;
  part?: string; // which list of its group it is in: "In", "Out", "Text In"…
  changes?: boolean; // a built-in's id with a value of its own
  used: number[];
  fields: OwnField[];
}
export interface OwnGroup {
  id:
    | "transitions"
    | "anims"
    | "voices"
    | "shapes"
    | "sounds"
    | "3d"
    | "materials"
    | "choices"
    | "eases"
    | "velocity"
    | "checks"
    | "other";
  title: string;
  items: OwnItem[];
}

// What the studio already reads from a film's draw and its tools (src/contract.ts Draw, Tools) and what makeTransitions adds
const TOOLS = new Set([
  "scene",
  "camera",
  "look",
  "free",
  "home",
  "objects",
  "targets",
  "renderer",
  "materials",
  "rig",
  "bones",
  "zoomOf",
  "smoother",
  "head",
  "CELL",
  "placed",
  "titles",
]);
const DRAW = new Set([
  "tools",
  "describe",
  "checks",
  "variants",
  "eases",
  "keyEases",
  "anims",
  "transitions",
  "velocity",
  "velocityEffects",
  "adjustments",
  "disposeTransitions",
]);
export const otherKeys = (of: object, part: "draw" | "tools" = "draw") =>
  Object.keys(of).filter((k) => !(part === "tools" ? TOOLS : DRAW).has(k));

const SHOWN = new Set(["id", "title", "tip", "cat", "category"]); // already in the item's head
const lines = (s: string) => s.split("\n").length;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const MOST = 20_000;
const written = (v: object) => () => {
  let out: string;
  try {
    out = JSON.stringify(v, (_, x) => (typeof x === "function" ? "(code)" : x), 2);
  } catch {
    return "(can't be written out: it points back at itself, as a scene object's parent and children do)";
  }
  return out.length > MOST
    ? `${out.slice(0, MOST)}
… (the first 20,000 of ${out.length.toLocaleString("en-US")} characters)`
    : out;
};
const valueField = (key: string, v: unknown): OwnField | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "function") {
    const code = v.toString();
    return { key, text: `code, ${plural(lines(code), "line")}`, code: () => code };
  }
  if (typeof v === "boolean") return { key, text: v ? "yes" : "no" };
  if (typeof v === "number") return { key, text: String(Math.round(v * 1000) / 1000) };
  if (typeof v === "string")
    return v.includes("\n") || v.length > 60
      ? { key, text: plural(lines(v), "line"), code: () => v }
      : { key, text: v };
  if (
    Array.isArray(v) &&
    v.length <= 4 &&
    v.every((x) => typeof x === "number" || typeof x === "string")
  )
    return { key, text: v.join(", ") };
  if (typeof v !== "object") return { key, text: String(v as bigint | symbol) };
  return {
    key,
    text: Array.isArray(v) ? plural(v.length, "item") : plural(Object.keys(v).length, "field"),
    code: written(v),
  };
};
export const fieldsOf = (x: Rec): OwnField[] =>
  Object.keys(x)
    .filter((k) => !SHOWN.has(k))
    .sort()
    .flatMap((k) => valueField(k, x[k]) ?? []);

// The same value a built-in has: functions by identity (a film can't rewrite one without making its own), the rest by content
const same = (a: Rec, b: Rec) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k],
      y = b[k];
    if (x === y) continue;
    if (typeof x === "function" || typeof y === "function") return false;
    try {
      if (JSON.stringify(x) !== JSON.stringify(y)) return false;
    } catch {
      return false; // points back at itself: not a built-in's plain value
    }
  }
  return true;
};
const seconds = (ts: number[]) => [...new Set(ts)].sort((a, b) => a - b);

// The film's own against the studio's: a new id, or a built-in's id with a value of its own
export const isOwnFx = (x: Fx, base: readonly Fx[]) => {
  const b = base.find((y) => y.id === x.id);
  return !b || (b !== x && !same(x, b));
};
const own = (
  list: readonly Fx[] | undefined,
  base: readonly Fx[],
  used: (id: string) => number[],
  part?: string,
) =>
  (list ?? []).flatMap((x): OwnItem[] => {
    if (!isOwnFx(x, base)) return [];
    const b = base.find((y) => y.id === x.id);
    return [
      {
        id: x.id,
        title: x.title || x.id,
        ...(x.tip ? { tip: x.tip } : {}),
        ...(part ? { part } : {}),
        ...(b ? { changes: true } : {}),
        used: used(x.id),
        fields: fieldsOf(x),
      },
    ];
  });
const named = (rec: Record<string, unknown> | undefined, base: Record<string, unknown> = {}) =>
  Object.entries(rec ?? {}).flatMap(([id, v]): OwnItem[] =>
    base[id] === v
      ? []
      : [
          {
            id,
            title: id,
            ...(id in base ? { changes: true } : {}),
            used: [],
            fields: [valueField("value", v)].flatMap((f) => f ?? []),
          },
        ],
  );

export const ownWork = (film: OwnInput, base: Builtins, usage: Usage): OwnGroup[] => {
  const { shots, texts } = usage;
  const slots = ["in", "out", "combo"] as const;
  const groups: OwnGroup[] = [
    {
      id: "transitions",
      title: "Transitions",
      items: own(film.transitions, base.transitions, (id) =>
        seconds(shots.flatMap((s) => (s.transition?.fx === id ? [s.t] : []))),
      ),
    },
    {
      id: "anims",
      title: "Shot animations",
      items: slots.flatMap((slot) =>
        own(
          film.anims?.[slot],
          base.anims[slot],
          (id) => seconds(shots.flatMap((s) => (s.anim?.[slot]?.fx === id ? [s.t] : []))),
          slot === "combo" ? "Combo" : slot === "in" ? "In" : "Out",
        ),
      ),
    },
    {
      id: "voices",
      title: "Text and shape animations",
      items: (["text", "shape"] as const).flatMap((kind) =>
        (["in", "out"] as const).flatMap((slot) =>
          own(
            film.voices?.[kind][slot],
            base.voices[kind][slot],
            (id) =>
              seconds(
                texts.flatMap((it) =>
                  (it.kind === "text") === (kind === "text") && it[slot]?.fx === id
                    ? [it.from]
                    : [],
                ),
              ),
            `${kind === "text" ? "Text" : "Shape"} ${slot === "in" ? "In" : "Out"}`,
          ),
        ),
      ),
    },
    {
      id: "shapes",
      title: "Stickers and shapes",
      items: own(film.shapes, [], (id) =>
        seconds(texts.flatMap((it) => (it.kind === id ? [it.from] : []))),
      ),
    },
    {
      id: "sounds",
      title: "Sounds",
      items: (film.sounds ?? [])
        .map((x) => ({
          id: x.name,
          title: x.title || x.name,
          used: seconds((usage.sounds ?? []).flatMap((u) => (u.name === x.name ? [u.t] : []))),
          fields: [],
        }))
        .sort((a, b) => Number(!a.used.length) - Number(!b.used.length)), // the ones playing first
    },
    {
      id: "3d",
      title: "3D in the scene",
      items: (film.objects ?? []).map((name) => ({ id: name, title: name, used: [], fields: [] })),
    },
    {
      id: "materials",
      title: "Materials and shaders",
      items: (film.materials ?? []).map((name) => ({
        id: name,
        title: name,
        used: [],
        fields: [],
      })),
    },
    {
      id: "choices",
      title: "Choices (A/B)",
      items: (film.variants ?? []).map((v) => ({
        id: v.id,
        title: v.title,
        used: seconds(v.ranges.map(([a]) => a)),
        fields: [
          { key: "options", text: v.options.map((o) => o.title).join(", ") },
          ...(v.pick ? [{ key: "shown", text: v.pick.title }] : []),
        ],
      })),
    },
    {
      id: "eases",
      title: "Eases",
      items: [
        ...named(film.eases, base.eases).map((x) => ({ ...x, part: "Camera" })),
        ...(film.textEases ?? [])
          .filter((id) => !base.textEases?.includes(id))
          .map((id) => ({ id, title: id, part: "Text", used: [], fields: [] })),
      ],
    },
    {
      id: "velocity",
      title: "Speed ramp effects",
      items: own(
        film.velocityEffects?.map((v) => (typeof v === "string" ? { id: v } : v)),
        base.velocityEffects.map((id) => ({ id })),
        () => [],
      ),
    },
    {
      id: "checks",
      title: "Render checks",
      items: Object.entries(film.checks ?? {}).map(([id, v]) => ({
        id,
        title: id,
        used: [],
        fields: [valueField("check", v)].flatMap((f) => f ?? []),
      })),
    },
    { id: "other", title: "Other", items: named(film.other) },
  ];
  return groups.filter((g) => g.items.length);
};
