// Timeline reads protect unacknowledged Studio edits; intentional agent writes require the current version.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

import { CamTimeline, problems, ShotsTimeline } from "./contract.ts";
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

const rowSlot = (row) => `${row.t}:${!!row.cut}`;
const needsIds = (rows) => Array.isArray(rows) && rows.some((row) => row?.id === undefined);
const matchSnapshot = (rows, snapshot, alignRetimes) => {
  const slots = new Map();
  const used = new Set(rows.flatMap((row) => row.id ?? []));
  for (const { id, ...data } of snapshot) {
    const slot = rowSlot(data);
    if (!slots.has(slot)) slots.set(slot, []);
    slots.get(slot).push({ id, data });
  }
  const take = (row, exact) => {
    const match = slots
      .get(rowSlot(row))
      ?.find((candidate) => !used.has(candidate.id) && (!exact || equalJson(candidate.data, row)));
    if (match) used.add(match.id);
    return match?.id;
  };
  const positions = new Map();
  const ordered = rows.map((row) => {
    const slot = rowSlot(row);
    const position = positions.get(slot) ?? 0;
    positions.set(slot, position + 1);
    const group = slots.get(slot);
    const match = group?.[position];
    if (!match || group.length < 2 || row.id !== undefined || used.has(match.id)) return;
    used.add(match.id);
    return match;
  });
  const exact = rows.map((row, i) =>
    ordered[i] && equalJson(ordered[i].data, row)
      ? ordered[i].id
      : row.id === undefined && !ordered[i]
        ? take(row, true)
        : undefined,
  );
  const retimed = [];
  if (alignRetimes) {
    const withoutTime = ({ t: _time, ...value }) => value;
    const candidates = [...slots.values()].flat();
    for (const [i, row] of rows.entries()) {
      if (row.id !== undefined || ordered[i] || exact[i]) continue;
      const value = withoutTime(row);
      const matches = candidates.filter(
        (candidate) => !used.has(candidate.id) && equalJson(withoutTime(candidate.data), value),
      );
      if (matches.length !== 1) continue;
      retimed[i] = matches[0].id;
      used.add(matches[0].id);
    }
  }
  const ids = rows.map(
    (row, i) => row.id ?? ordered[i]?.id ?? exact[i] ?? retimed[i] ?? take(row, false),
  );
  return {
    ids,
    score: exact.filter(Boolean).length * (rows.length + 1) + ids.filter(Boolean).length,
  };
};
const identifyRows = (rows, previous, alignRetimes) => {
  let best;
  let ambiguous = false;
  for (const snapshot of previous) {
    if (
      !Array.isArray(snapshot) ||
      !snapshot.every((row) => typeof row?.id === "string" && Number.isFinite(row.t))
    )
      continue;
    const match = matchSnapshot(rows, snapshot, alignRetimes);
    if (!best || match.score > best.score) {
      best = match;
      ambiguous = false;
    } else if (match.score === best.score && !equalJson(match.ids, best.ids)) {
      ambiguous = true;
    }
  }
  return {
    ambiguous,
    data: rows.map((row, i) =>
      row.id === undefined ? { ...row, id: best?.ids[i] ?? randomUUID() } : row,
    ),
  };
};

// rel: the file's path in the film, as package.json names it; schema: its zod schema in contract.ts
export const openTimelineFile = (project, rel, schema) => {
  const FILE = assertInsideDir(project, rel, "Timeline file");
  const orderedRows = schema === CamTimeline || schema === ShotsTimeline;
  const identify = (data, previous, alignRetimes = false) =>
    orderedRows && needsIds(data) && !problems(schema, data, rel).length
      ? identifyRows(data, previous, alignRetimes)
      : { data, ambiguous: false };
  const normalize = (data, previous, alignRetimes = false) =>
    identify(data, [previous], alignRetimes).data;
  const protection = openEditProtection(project, relative(project, FILE).replaceAll("\\", "/"), {
    orderedRows,
    normalize,
  });
  const version = (buf = readFileSync(FILE)) => createHash("md5").update(buf).digest("base64url");
  let written = null,
    writer; // what the studio itself last wrote, so its own save is not mistaken for someone else's edit
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
    protection.upgradeRows();
    const snapshots = orderedRows && needsIds(incoming) ? protection.rowSnapshots() : [];
    const identified = identify(incoming, snapshots);
    const missedProtection =
      identified.data !== incoming &&
      protectedFile &&
      protection.hasUnmatchedRow(new Set(identified.data.map((row) => row.id)));
    let data;
    if ((identified.ambiguous || missedProtection) && snapshots[0]) {
      data = snapshots[0];
      protection.notify(incoming, protection.report().protected, [
        "Camera timeline IDs are ambiguous. Read the canonical file and keep its IDs when applying this edit.",
      ]);
    } else {
      data = protection.reconcile(identified.data, (value) => problems(schema, value, rel));
    }
    if (!equalJson(data, incoming)) {
      const bad = problems(schema, data, rel);
      if (bad.length) throw new Error(`Cannot preserve edits: ${bad.join("; ")}`);
      buf = Buffer.from(compactJson(data) + "\n");
      writeFileSync(`${FILE}.new`, buf);
      renameSync(`${FILE}.new`, FILE);
    }
    const got = { version: version(buf), data };
    if (!orderedRows || !problems(schema, data, rel).length) protection.remember(got.version, data);
    return got;
  };
  const prepare = (base, data, { actor = "person" } = {}) => {
    const current = read();
    const ancestor = protection.base(base);
    const before = ancestor ? ancestor.data : current?.data;
    if (current && current.version !== base && (!ancestor || actor === "agent"))
      return { conflict: true };
    if (orderedRows) {
      const bad = problems(schema, data, rel);
      if (bad.length) return { problems: bad };
      data = normalize(data, before);
    }
    const result =
      current && current.version !== base
        ? mergeEdits(before, data, current.data, orderedRows)
        : { data, retained: [] };
    const bad = problems(schema, result.data, rel);
    return bad.length
      ? { problems: bad }
      : {
          ...result,
          before,
          edited: data,
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
    protection.protect(result.before, result.edited, result.actor);
    if (result.retained.length) protection.notify(result.incoming, result.retained);
    const text = compactJson(result.data) + "\n",
      fresh = `${FILE}.new`;
    writeFileSync(fresh, text);
    renameSync(fresh, FILE);
    writer = result.actor;
    written = version(Buffer.from(text));
    protection.remember(written, result.data);
    return { version: written, data: result.data, retained: result.retained };
  };
  const ownWrite = () => existsSync(FILE) && version() === written;
  return {
    FILE,
    read,
    check,
    write,
    ownWrite,
    personWrite: () => ownWrite() && writer === "person",
    collaboration: protection.report,
    reloadProtection: protection.reload,
  };
};
