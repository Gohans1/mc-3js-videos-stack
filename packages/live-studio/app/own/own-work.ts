// What a film's code adds on top of the studio's libraries, for the view-only Film tab and the "Film" mark on the pickers.
// Grouped as CapCut's libraries are (Audio, Text, Stickers, Effects, Transitions, then the clip's Animation), then what only a
// 3D film has (3D, fields of its own on the JSON rows, A/B choices, checks). A list of {id} the film hands over under a name the
// studio doesn't know is a kind of its own, named after it; anything else unknown lands in Other. The studio shows these and
// never edits them: the film's code is the AI's to change, so nothing here may refuse or drop a field.
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
  rows?: readonly { kind: string; t: number; row: Rec }[]; // the timeline JSON's rows (a shot, a text…) at their heard second
  other?: Rec;
}
export interface Builtins {
  transitions: readonly Fx[];
  anims: Slots<Fx>;
  voices: Voices<Fx>;
  eases: Record<string, Fn>;
  velocityEffects: readonly string[];
  textEases?: readonly string[];
  rowKeys?: Record<string, readonly string[]>; // by row kind, the fields the studio or its template reads
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
  id: string; // "audio", "text"…, or "own:<name>" for a kind the film made up
  title: string;
  items: OwnItem[];
}

// What the studio already reads from a film's draw and its tools (src/contract.ts Draw, Tools), what makeTransitions adds, and
// what templates/film's scene hands over in every film (clips, composer, a props film's anchor): not the film's own work
const TOOLS = new Set([
  "clips",
  "composer",
  "anchor",
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
export const isOwnEase = (
  id: string,
  base: Record<string, unknown>,
  eases?: Record<string, unknown>,
) => !(id in base) || (!!eases && id in eases && eases[id] !== base[id]);
export const isOwnVelocity = (fx: string | Fx, base: readonly string[]) =>
  isOwnFx(
    typeof fx === "string" ? { id: fx } : fx,
    base.map((id) => ({ id })),
  );
// CapCut's "Yours", named as the Audio tab's: a picker's chip after Favorites keeping only the film's own, when it has any
export const THIS_FILM = "This film";
export const withFilmChip = (cats: string[], any: boolean) =>
  any ? cats.flatMap((c) => (c === "Favorites" ? [c, THIS_FILM] : [c])) : cats;

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
  Object.entries(rec ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([id, v]): OwnItem[] =>
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
const parted = (items: OwnItem[], part: string) => items.map((x) => ({ ...x, part }));

// A kind the film made up: a list whose every entry has an id, as the studio's own libraries are
const isKind = (v: unknown): v is Fx[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every(
    (x) => !!x && typeof x === "object" && typeof (x as Rec).id === "string" && (x as Rec).id,
  );
// "tools.clips" → "Clips", "weatherFx" → "Weather fx"
const kindTitle = (key: string) => {
  const w = key
    .replace(/^tools\./, "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

// The fields of its own a film puts on its timeline rows, one item per field name and row kind. A kind the studio has no
// list of read fields for shows none of them, rather than every field as the film's own
const short = (v: unknown) =>
  typeof v === "boolean"
    ? v
      ? "yes"
      : "no"
    : typeof v === "number"
      ? String(Math.round(v * 1000) / 1000)
      : typeof v === "string" && !v.includes("\n")
        ? v
        : null;
const keyOf = (v: unknown) => {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};
// A slot the studio reads inside a row (a shot's anim.in) is opened when its read fields are listed by path ("anim.in.fx")
const ownPaths = (x: Rec, read: readonly string[], at = ""): [string, unknown][] =>
  Object.keys(x).flatMap((k): [string, unknown][] => {
    const path = at + k,
      v = x[k];
    if (v === undefined) return [];
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      read.some((r) => r.startsWith(`${path}.`))
    )
      return ownPaths(v as Rec, read, `${path}.`);
    return read.includes(path) ? [] : [[path, v]];
  });
const rowFields = (rows: OwnInput["rows"], known: Builtins["rowKeys"]): OwnItem[] => {
  const by = new Map<string, { kind: string; key: string; uses: { t: number; v: unknown }[] }>();
  for (const { kind, t, row } of rows ?? []) {
    const read = known?.[kind];
    if (!read) continue;
    for (const [key, v] of ownPaths(row, read)) {
      const id = `${kind}.${key}`;
      if (!by.has(id)) by.set(id, { kind, key, uses: [] });
      by.get(id)!.uses.push({ t, v });
    }
  }
  const kinds = [...new Set((rows ?? []).map((r) => r.kind))];
  return [...by.entries()]
    .sort(
      ([, a], [, b]) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.key.localeCompare(b.key),
    )
    .map(([, { kind, key, uses }]) => {
      const values = [...new Map(uses.map((u) => [keyOf(u.v), u.v])).values()];
      const shorts = values.map(short);
      const list = shorts.every((s) => s !== null) ? shorts.join(", ") : null;
      const field: OwnField | null =
        values.length === 1
          ? valueField("value", values[0])
          : list !== null && list.length <= 60
            ? { key: "values", text: list }
            : {
                key: "values",
                text: plural(values.length, "value"),
                code: () =>
                  uses.map((u) => `${u.t.toFixed(2)} s  ${short(u.v) ?? keyOf(u.v)}`).join("\n"),
              };
      return {
        id: key, // the row kind is its part, so the name alone heads it
        title: key,
        part: kind,
        used: seconds(uses.map((u) => u.t)),
        fields: field ? [field] : [],
      };
    });
};

export const ownWork = (film: OwnInput, base: Builtins, usage: Usage): OwnGroup[] => {
  const { shots, texts } = usage;
  const slots = ["in", "out", "combo"] as const;
  const voices = (kind: "text" | "shape") =>
    (["in", "out"] as const).flatMap((slot) =>
      own(
        film.voices?.[kind][slot],
        base.voices[kind][slot],
        (id) =>
          seconds(
            texts.flatMap((it) =>
              (it.kind === "text") === (kind === "text") && it[slot]?.fx === id ? [it.from] : [],
            ),
          ),
        slot === "in" ? "In" : "Out",
      ),
    );
  const unknown = Object.entries(film.other ?? {});
  const kinds = unknown
    .filter(([, v]) => isKind(v))
    .map(([key, v]) => ({
      id: `own:${key}`,
      title: kindTitle(key),
      items: own(v as Fx[], [], () => []),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const groups: OwnGroup[] = [
    {
      id: "audio",
      title: "Audio",
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
      id: "text",
      title: "Text",
      items: [
        ...voices("text"),
        ...(film.textEases ?? [])
          .filter((id) => !base.textEases?.includes(id))
          .map((id) => ({ id, title: id, part: "Ease", used: [], fields: [] })),
      ],
    },
    {
      id: "stickers",
      title: "Stickers",
      items: [
        ...parted(
          own(film.shapes, [], (id) =>
            seconds(texts.flatMap((it) => (it.kind === id ? [it.from] : []))),
          ),
          "Sticker",
        ),
        ...voices("shape"),
      ],
    },
    {
      id: "effects",
      title: "Effects",
      items: parted(
        own(
          film.velocityEffects?.map((v) => (typeof v === "string" ? { id: v } : v)),
          base.velocityEffects.map((id) => ({ id })),
          () => [],
        ),
        "Speed ramp",
      ),
    },
    {
      id: "transitions",
      title: "Transitions",
      items: own(film.transitions, base.transitions, (id) =>
        seconds(shots.flatMap((s) => (s.transition?.fx === id ? [s.t] : []))),
      ),
    },
    {
      id: "animation",
      title: "Animation",
      items: [
        ...slots.flatMap((slot) =>
          own(
            film.anims?.[slot],
            base.anims[slot],
            (id) => seconds(shots.flatMap((s) => (s.anim?.[slot]?.fx === id ? [s.t] : []))),
            slot === "combo" ? "Combo" : slot === "in" ? "In" : "Out",
          ),
        ),
        ...parted(named(film.eases, base.eases), "Camera ease"),
      ],
    },
    {
      id: "3d",
      title: "3D",
      items: [
        ...(film.objects ?? []).map((name) => ({
          id: name,
          title: name,
          part: "Object",
          used: [],
          fields: [],
        })),
        ...(film.materials ?? []).map((name) => ({
          id: name,
          title: name,
          part: "Material",
          used: [],
          fields: [],
        })),
      ],
    },
    { id: "fields", title: "Custom fields", items: rowFields(film.rows, base.rowKeys) },
    {
      id: "choices",
      title: "A/B choices",
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
      id: "checks",
      title: "Checks",
      items: Object.entries(film.checks ?? {}).map(([id, v]) => ({
        id,
        title: id,
        used: [],
        fields: [valueField("check", v)].flatMap((f) => f ?? []),
      })),
    },
    ...kinds,
    {
      id: "other",
      title: "Other",
      items: named(Object.fromEntries(unknown.filter(([, v]) => !isKind(v)))),
    },
  ];
  return groups.filter((g) => g.items.length);
};
