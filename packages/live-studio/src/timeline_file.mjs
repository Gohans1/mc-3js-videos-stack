// A film's timeline file the studio edits by hand (the sound lanes, the camera keys): read with an md5 version, written only
// over the version the page was looking at, so an agent's edit made meanwhile is never lost (the page gets 409 and loads it)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { problems } from "./contract.mjs";

// Same layout as the films' own timeline writer (timeline_fmt.py): anything that fits 140 columns on one line, longer opens up a
// level. A save from the studio then changes only the lines it touched
const WIDTH = 140;
// Python's json.dumps spacing (", " and ": "), so a line the studio didn't touch comes out the same, but for a whole-number
// float: Python writes 2.0, the studio 2
const oneLine = (v) => (Array.isArray(v) ? `[${v.map(oneLine).join(", ")}]`
  : v && typeof v === "object" ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${oneLine(x)}`).join(", ")}}`
  : JSON.stringify(v));
export const compactJson = (v, ind = 0) => {
  const one = oneLine(v);
  if (one.length + ind <= WIDTH || typeof v !== "object" || v === null || !Object.keys(v).length) return one;
  const pad = " ".repeat(ind + 1);
  if (Array.isArray(v)) return `[\n${v.map((x) => pad + compactJson(x, ind + 1)).join(",\n")}\n${" ".repeat(ind)}]`;
  return `{\n${Object.entries(v).map(([k, x]) => `${pad}${JSON.stringify(k)}: ${compactJson(x, ind + 1)}`).join(",\n")}\n${" ".repeat(ind)}}`;
};

// rel: the file's path in the film, as package.json names it; schema: its zod schema in contract.mjs
export const openTimelineFile = (project, rel, schema) => {
  const FILE = join(project, rel);
  const version = (buf = readFileSync(FILE)) => createHash("md5").update(buf).digest("base64url");
  let written = null; // what the studio itself last wrote, so its own save is not mistaken for someone else's edit
  const read = () => {
    if (!existsSync(FILE)) return null;
    const buf = readFileSync(FILE);
    return { version: version(buf), data: JSON.parse(buf.toString("utf8")) };
  };
  // null when data may be written over base, else what write would answer
  const check = (base, data) => {
    if (existsSync(FILE) && version() !== base) return { conflict: true };
    const bad = problems(schema, data, rel);
    return bad.length ? { problems: bad } : null;
  };
  const write = (base, data) => {
    const no = check(base, data);
    if (no) return no;
    const text = compactJson(data) + "\n", fresh = `${FILE}.new`;
    writeFileSync(fresh, text);
    renameSync(fresh, FILE);
    written = version(Buffer.from(text));
    return { version: written };
  };
  const ownWrite = () => existsSync(FILE) && version() === written;
  return { FILE, read, check, write, ownWrite };
};
