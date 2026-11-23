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
const tieOrder = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const time = String(row.t);
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time).push(row.id);
  }
  return groups;
};

export const changes = (base, next, path = [], orderedRows = false) => {
  if (equalJson(base, next)) return [];
  if (orderedRows && keyed(next) && (base === undefined || keyed(base))) {
    const before = new Map((base ?? []).map((row) => [row.id, row]));
    const after = new Set(next.map((row) => row.id));
    const oldOrder = tieOrder(base ?? []);
    const reordered = [...tieOrder(next)].filter(([time, ids]) => {
      if (ids.length < 2) return false;
      const retained = oldOrder.get(time)?.filter((id) => ids.includes(id)) ?? [];
      return !equalJson(retained, ids);
    });
    return [
      ...[...before.keys()]
        .filter((id) => !after.has(id))
        .map((id) => ({ path: [`@${id}`], remove: true })),
      ...next.flatMap((row) => {
        const rowPath = [`@${row.id}`];
        return before.has(row.id)
          ? changes(before.get(row.id), row, rowPath)
          : [{ path: rowPath, value: row }];
      }),
      ...reordered.map(([time, ids]) => ({ path: ["$order", time], value: ids, order: true })),
    ];
  }
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
  return [{ path, ...(next === undefined ? { remove: true } : { value: next }) }];
};
const child = (data, key) =>
  Array.isArray(data) && key.startsWith("@")
    ? data.find((row) => row?.id === key.slice(1))
    : key === "$order" && keyed(data)
      ? Object.fromEntries(tieOrder(data))
      : object(data) && Object.hasOwn(data, key)
        ? data[key]
        : undefined;
const at = (data, path) => path.reduce(child, data);
const put = (data, path, change, fallback) => {
  if (!path.length) return change.remove ? undefined : structuredClone(change.value);
  const [key, ...rest] = path;
  if (change.order) {
    if (!keyed(data)) return data;
    const [time] = rest;
    const matching = new Map(
      data
        .filter((row) => String(row.t) === time && change.value.includes(row.id))
        .map((row) => [row.id, row]),
    );
    const ordered = change.value.filter((id) => matching.has(id)).map((id) => matching.get(id));
    let next = 0;
    return data.map((row) => (matching.has(row.id) ? ordered[next++] : row));
  }
  if (Array.isArray(fallback) && key.startsWith("@")) {
    const result = [...(Array.isArray(data) ? data : fallback)];
    const index = result.findIndex((row) => row?.id === key.slice(1));
    if (change.remove && (index < 0 || !rest.length)) {
      if (index >= 0) result.splice(index, 1);
      return result;
    }
    if (change.ensure && index >= 0) return data;
    const value = put(
      index < 0 ? child(fallback, key) : result[index],
      rest,
      change.ensure ? { ...change, value: child(fallback, key) ?? change.value } : change,
      child(fallback, key),
    );
    if (index >= 0) result[index] = value;
    else {
      const position = fallback.findIndex((row) => row?.id === key.slice(1));
      const following = new Set(
        fallback
          .slice(position + 1)
          .filter((row) => row?.t === value?.t)
          .map((row) => row.id),
      );
      const next = result.findIndex((row) => row?.t === value?.t && following.has(row?.id));
      result.splice(next < 0 ? result.length : next, 0, value);
    }
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
export const applyEdits = (data, edits, fallback = data, orderedRows = false) => {
  const orders = orderedRows ? edits.filter((c) => c.order) : [];
  const rows = orderedRows ? edits.filter((c) => !c.order) : edits;
  let result = rows.reduce((d, c) => put(d, c.path, c, fallback), data);
  for (const order of orders) result = put(result, order.path, order, fallback);
  return orderedRows && keyed(result) && result !== data
    ? result.toSorted((a, b) => a.t - b.t)
    : result;
};
export const overlapping = (a, b) => a.every((v, i) => b[i] === v) || b.every((v, i) => a[i] === v);
export const mergeEdits = (base, person, incoming, orderedRows = false) => {
  const mine = changes(base, person, [], orderedRows),
    theirs = changes(base, incoming, [], orderedRows);
  const retained = mine
    .filter(
      (m) =>
        theirs.some((t) => overlapping(m.path, t.path)) &&
        !equalJson(at(incoming, m.path), m.remove ? undefined : m.value),
    )
    .map((m) => pointer(m.path));
  return { data: applyEdits(incoming, mine, person, orderedRows), retained };
};
