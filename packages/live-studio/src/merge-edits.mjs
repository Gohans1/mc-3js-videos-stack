const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keyed = (v) =>
  Array.isArray(v) &&
  v.every((row) => object(row) && typeof row.id === "string") &&
  new Set(v.map((row) => row.id)).size === v.length;
export const equalJson = (a, b) => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equalJson(v, b[i]));
  return (
    object(a) &&
    object(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((k) => Object.hasOwn(b, k) && equalJson(a[k], b[k]))
  );
};
export const pointer = (path) =>
  "/" + path.map((k) => k.replaceAll("~", "~0").replaceAll("/", "~1")).join("/");
export const changes = (base, next, path = []) => {
  if (equalJson(base, next)) return [];
  if (
    keyed(base) &&
    keyed(next) &&
    base.length === next.length &&
    base.every((row, i) => row.id === next[i].id)
  )
    return base.flatMap((row, i) => changes(row, next[i], [...path, `@${row.id}`]));
  if (object(next) && (object(base) || (base === undefined && Object.keys(next).length)))
    return [...new Set([...Object.keys(base ?? {}), ...Object.keys(next)])].flatMap((k) =>
      changes(base?.[k], Object.hasOwn(next, k) ? next[k] : undefined, [...path, k]),
    );
  // Arrays without persistent identities are one editing unit; indices are not identities.
  return [{ path, ...(next === undefined ? { remove: true } : { value: next }) }];
};
const child = (data, key) =>
  Array.isArray(data) && key.startsWith("@")
    ? data.find((row) => row?.id === key.slice(1))
    : object(data) && Object.hasOwn(data, key)
      ? data[key]
      : undefined;
const at = (data, path) => path.reduce(child, data);
const put = (data, path, change, fallback) => {
  if (!path.length) return change.remove ? undefined : structuredClone(change.value);
  const [key, ...rest] = path;
  if (Array.isArray(fallback) && key.startsWith("@")) {
    const result = [...(Array.isArray(data) ? data : fallback)];
    const index = result.findIndex((row) => row?.id === key.slice(1));
    const value = put(
      index < 0 ? child(fallback, key) : result[index],
      rest,
      change,
      child(fallback, key),
    );
    if (index < 0) result.push(value);
    else result[index] = value;
    return result;
  }
  const result = { ...(object(data) ? data : object(fallback) ? fallback : {}) };
  if (!rest.length && change.remove) delete result[key];
  else
    Object.defineProperty(result, key, {
      value: put(child(result, key), rest, change, child(fallback, key)),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  return result;
};
export const applyEdits = (data, edits, fallback = data) =>
  edits.reduce((d, c) => put(d, c.path, c, fallback), data);
export const overlapping = (a, b) => a.every((v, i) => b[i] === v) || b.every((v, i) => a[i] === v);
export const mergeEdits = (base, person, incoming) => {
  const mine = changes(base, person),
    theirs = changes(base, incoming);
  const retained = mine
    .filter(
      (m) =>
        theirs.some((t) => overlapping(m.path, t.path)) &&
        !equalJson(at(incoming, m.path), m.remove ? undefined : m.value),
    )
    .map((m) => pointer(m.path));
  return { data: applyEdits(incoming, mine, person), retained };
};
