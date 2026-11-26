import { matcher } from "../core/search";

export type ExpressionEntry =
  { kind: "preset"; name: string; description?: string; aliases?: readonly string[] } |
  { kind: "ramp"; name: string; stops: readonly string[] };

export type ExpressionGroup = {
  id: string;
  label: string;
  entries: ExpressionEntry[];
};

export const expressionLabel = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1).replaceAll("-", " ");

export const expressionKey = (entry: ExpressionEntry) => `${entry.kind}:${entry.name}`;

export function buildExpressionGroups(
  presets: Readonly<Record<string, unknown>>,
  categories: Readonly<Record<string, readonly string[]>>,
  ramps: Readonly<Record<string, readonly string[]>>,
  details?: ReadonlyMap<string, { description: string; aliases: readonly string[] }>,
): ExpressionGroup[] {
  const assigned = new Set<string>();
  const groups = Object.entries(categories).map(([id, names]) => {
    const entries: ExpressionEntry[] = [];
    for (const name of names) {
      if (!Object.hasOwn(presets, name) || assigned.has(name)) continue;
      assigned.add(name);
      const info = details?.get(name);
      entries.push({ kind: "preset", name, ...(info && { description: info.description, aliases: info.aliases }) });
    }
    return { id, label: expressionLabel(id), entries };
  });
  for (const [name, stops] of Object.entries(ramps)) {
    const entry: ExpressionEntry = { kind: "ramp", name, stops };
    const group = groups.find(({ id }) => id === name);
    if (group) group.entries.unshift(entry);
    else groups.push({ id: name, label: expressionLabel(name), entries: [entry] });
  }
  groups.push({
    id: ":uncategorized",
    label: "Uncategorized",
    entries: Object.keys(presets)
      .filter((name) => !assigned.has(name))
      .map((name) => ({ kind: "preset", name })),
  });
  return groups.filter(({ entries }) => entries.length > 0);
}

export function filterExpressionGroups(
  groups: ExpressionGroup[],
  query: string,
  category = "",
): ExpressionGroup[] {
  const matches = matcher(query);
  return groups
    .filter(({ id }) => !category || category === id)
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) =>
        matches(
          [group.label, entry.name, entry.kind, ...(entry.kind === "ramp" ? entry.stops :
            [entry.description ?? "", ...(entry.aliases ?? [])])].join(
            " ",
          ),
        ),
      ),
    }))
    .filter(({ entries }) => entries.length > 0);
}
