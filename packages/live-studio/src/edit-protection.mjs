import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { applyEdits, changes, equalJson, overlapping, pointer } from "./merge-edits.mjs";

export const openEditProtection = (project, rel) => {
  const folder = join(project, ".studio/collaboration");
  const key = createHash("sha256").update(rel).digest("hex");
  const file = join(folder, `${key}.json`);
  let state = { guards: [], notices: [], versions: [], latest: null };
  if (existsSync(file)) state = JSON.parse(readFileSync(file, "utf8"));
  const save = () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(`${file}.new`, JSON.stringify(state));
    renameSync(`${file}.new`, file);
  };
  const notify = (incoming, retained, bad = []) => {
    const notice = {
      id: randomUUID(),
      file: rel,
      at: new Date().toISOString(),
      retained,
      incoming,
      ...(bad.length ? { problems: bad } : {}),
    };
    mkdirSync(folder, { recursive: true });
    appendFileSync(join(folder, "notices.jsonl"), JSON.stringify(notice) + "\n");
    state.notices = [...state.notices, notice].slice(-20);
    save();
  };
  return {
    notify,
    remember(version, data) {
      if (state.latest?.version === version) return;
      state.latest = { version, data: structuredClone(data) };
      if (!state.versions.some((v) => v.version === version)) state.versions.push(state.latest);
      state.versions = state.versions.slice(-32);
      if (state.guards.length || existsSync(file)) save();
    },
    base: (version) => state.versions.find((v) => v.version === version),
    protect(base, data, actor) {
      const edited = changes(base, data);
      const prefix = (a, b) => a.every((v, i) => b[i] === v);
      state.guards = state.guards.flatMap((g) => {
        const related = edited.filter((e) => overlapping(g.path, e.path));
        if (!related.length) return [g];
        if (actor !== "person" || related.some((e) => prefix(e.path, g.path))) return [];
        const nested = related.map((e) => ({ ...e, path: e.path.slice(g.path.length) }));
        return [{ path: g.path, value: applyEdits(g.value, nested, g.value) }];
      });
      if (actor === "person")
        state.guards.push(
          ...edited.filter((e) => !state.guards.some((g) => prefix(g.path, e.path))),
        );
      save();
    },
    reconcile(incoming, validate) {
      let data = applyEdits(incoming, state.guards, state.latest?.data ?? incoming);
      const bad = validate(data);
      if (bad.length && state.guards.length && state.latest) data = state.latest.data;
      if (!equalJson(data, incoming)) {
        notify(
          incoming,
          state.guards.map((g) => pointer(g.path)),
          bad,
        );
      }
      return data;
    },
    report: () => ({ protected: state.guards.map((g) => pointer(g.path)), notices: state.notices }),
    reload() {
      if (existsSync(file)) state = JSON.parse(readFileSync(file, "utf8"));
    },
    reset(version, data) {
      state.guards = data === undefined ? [] : [{ path: [], value: structuredClone(data) }];
      state.versions = data === undefined ? [] : [{ version, data: structuredClone(data) }];
      state.latest = state.versions[0] ?? null;
      save();
    },
  };
};

export const resetProtectedFiles = (project, names) => {
  const updates = [];
  for (const rel of names) {
    const key = createHash("sha256").update(rel).digest("hex");
    if (!existsSync(join(project, ".studio/collaboration", `${key}.json`))) continue;
    const content = existsSync(join(project, rel)) ? readFileSync(join(project, rel)) : null;
    let data;
    try {
      data = content ? JSON.parse(content.toString("utf8")) : undefined;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    const version = content ? createHash("md5").update(content).digest("base64url") : "";
    const protection = openEditProtection(project, rel);
    updates.push(() => protection.reset(version, data));
  }
  for (const update of updates) update();
};

export const warnProtectedEdits = (project) => {
  const folder = join(project, ".studio/collaboration");
  if (!existsSync(folder)) return;
  for (const file of readdirSync(folder).filter((f) => /^[a-f0-9]{64}\.json$/.test(f))) {
    const state = JSON.parse(readFileSync(join(folder, file), "utf8"));
    const notice = state.notices.at(-1);
    if (state.guards.length && notice)
      console.error(
        `Studio retained human edits in ${notice.file}: ${notice.retained.join(", ")}. Read the file again; use collab read/write to intentionally revise protected fields.`,
      );
  }
};
