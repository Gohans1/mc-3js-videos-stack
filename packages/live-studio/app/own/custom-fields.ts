export type FieldPath = (string | number)[];
export interface EditableField {
  path: FieldPath;
  value: unknown;
}
const internal = new Set(["__timing", "timebase"]);

export function editableFields(
  value: Record<string, unknown>,
  known: readonly string[] = [],
  prefix: FieldPath = [],
): EditableField[] {
  return Object.entries(value).flatMap(([key, item]): EditableField[] => {
    if (internal.has(key) || item === undefined || typeof item === "function") return [];
    const path = [...prefix, key],
      name = path.join(".");
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      known.some((k) => k.startsWith(`${name}.`))
    )
      return editableFields(item as Record<string, unknown>, known, path);
    if (known.includes(name)) return [];
    return [{ path, value: item }];
  });
}

export function replaceField(root: object, path: FieldPath, value: unknown) {
  if (!path.length) throw new Error("Choose an existing field");
  let at: unknown = root;
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    if (!at || typeof at !== "object" || !Object.hasOwn(at, key))
      throw new Error("This field changed; select it again");
    const row = at as Record<string | number, unknown>;
    if (i === path.length - 1) row[key] = value;
    else at = row[key];
  }
}
