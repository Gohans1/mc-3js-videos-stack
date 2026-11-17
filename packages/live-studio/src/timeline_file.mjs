// Timeline reads protect unacknowledged Studio edits; intentional agent writes require the current version.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

import { problems } from "./contract.ts";
import { openEditProtection } from "./edit-protection.mjs";
import { equalJson, mergeEdits } from "./merge-edits.mjs";
import { assertInsideDir } from "./voice-map.mjs";

// Same layout as the films' own timeline writer (timeline_fmt.py): anything that fits 140 columns on one line, longer opens up a
// level. A save from the studio then changes only the lines it touched
const WIDTH = 140;
// Python's json.dumps spacing (", " and ": "), so a line the studio didn't touch comes out the same, but for a whole-number
// float: Python writes 2.0, the studio 2
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

// rel: the file's path in the film, as package.json names it; schema: its zod schema in contract.ts
export const openTimelineFile = (project, rel, schema) => {
  const FILE = assertInsideDir(project, rel, "Timeline file");
  const protection = openEditProtection(project, relative(project, FILE).replaceAll("\\", "/"));
  const version = (buf = readFileSync(FILE)) => createHash("md5").update(buf).digest("base64url");
  let written = null; // what the studio itself last wrote, so its own save is not mistaken for someone else's edit
  const read = () => {
    protection.reload();
    const protectedFile = protection.report().protected.length > 0;
    if (!existsSync(FILE) && !protectedFile) return null;
    let buf = existsSync(FILE) ? readFileSync(FILE) : Buffer.from("null");
    let incoming;
    try {
      incoming = JSON.parse(buf.toString("utf8"));
    } catch (error) {
      if (!protectedFile) throw error;
      incoming = buf.toString("utf8");
    }
    const data = protection.reconcile(incoming, (value) => problems(schema, value, rel));
    if (!equalJson(data, incoming)) {
      const bad = problems(schema, data, rel);
      if (bad.length) throw new Error(`Cannot preserve edits: ${bad.join("; ")}`);
      buf = Buffer.from(compactJson(data) + "\n");
      writeFileSync(`${FILE}.new`, buf);
      renameSync(`${FILE}.new`, FILE);
    }
    const got = { version: version(buf), data };
    protection.remember(got.version, data);
    return got;
  };
  const prepare = (base, data, { actor = "person" } = {}) => {
    const current = read();
    const ancestor = protection.base(base);
    if (current && current.version !== base && (!ancestor || actor === "agent"))
      return { conflict: true };
    const result =
      current && current.version !== base
        ? mergeEdits(ancestor.data, data, current.data)
        : { data, retained: [] };
    const bad = problems(schema, result.data, rel);
    return bad.length
      ? { problems: bad }
      : {
          ...result,
          before: ancestor ? ancestor.data : current?.data,
          incoming: current?.data,
          actor,
        };
  };
  // null when data may be written over base, else what write would answer
  const check = (base, data) => {
    const result = prepare(base, data);
    return result.conflict || result.problems ? result : null;
  };
  const write = (base, data, options) => {
    const result = prepare(base, data, options);
    if (result.conflict || result.problems) return result;
    protection.protect(result.before, data, result.actor);
    if (result.retained.length) protection.notify(result.incoming, result.retained);
    const text = compactJson(result.data) + "\n",
      fresh = `${FILE}.new`;
    writeFileSync(fresh, text);
    renameSync(fresh, FILE);
    written = version(Buffer.from(text));
    protection.remember(written, result.data);
    return { version: written, data: result.data, retained: result.retained };
  };
  const ownWrite = () => existsSync(FILE) && version() === written;
  return { FILE, read, check, write, ownWrite, collaboration: protection.report, reloadProtection: protection.reload };
};
