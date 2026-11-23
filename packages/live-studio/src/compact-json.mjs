const WIDTH = 140;
const oneLine = (v) =>
  Array.isArray(v)
    ? `[${v.map(oneLine).join(", ")}]`
    : v && typeof v === "object"
      ? `{${Object.entries(v)
          .map(([k, x]) => `${JSON.stringify(k)}: ${oneLine(x)}`)
          .join(", ")}}`
      : JSON.stringify(v);

export const compactJson = (v, ind = 0) => {
  const one = oneLine(v);
  if (one.length + ind <= WIDTH || typeof v !== "object" || v === null || !Object.keys(v).length)
    return one;
  const pad = " ".repeat(ind + 1);
  if (Array.isArray(v))
    return `[\n${v.map((x) => pad + compactJson(x, ind + 1)).join(",\n")}\n${" ".repeat(ind)}]`;
  return `{\n${Object.entries(v)
    .map(([k, x]) => `${pad}${JSON.stringify(k)}: ${compactJson(x, ind + 1)}`)
    .join(",\n")}\n${" ".repeat(ind)}}`;
};
