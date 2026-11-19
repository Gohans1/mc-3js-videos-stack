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

const noticeKey = (notice) => (notice ? (notice.id ?? notice.at ?? "__legacy__") : null);

export const openEditProtection = (
  project,
  rel,
  { orderedRows = false, normalize = (data) => data } = {},
) => {
  const folder = join(project, ".studio/collaboration");
  const key = createHash("sha256").update(rel).digest("hex");
  const file = join(folder, `${key}.json`);
  const readState = () => ({
    guards: [],
    notices: [],
    versions: [],
    latest: null,
    acknowledgedNoticeId: null,
    ...(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}),
  });
  let state = readState();
  const save = () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(`${file}.new`, JSON.stringify(state));
    renameSync(`${file}.new`, file);
  };
  const acknowledge = () => {
    const last = state.notices?.at(-1);
    if (last) state.acknowledgedNoticeId = noticeKey(last);
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
    state.notices = [...(state.notices ?? []), notice].slice(-20);
    save();
  };
  const withRowExistence = (edits) =>
    orderedRows
      ? edits.flatMap((edit) =>
          edit.path.length === 1 && edit.path[0].startsWith("@") && !edit.remove
            ? [{ ...edit, ensure: true }, ...changes({ id: edit.value.id }, edit.value, edit.path)]
            : [edit],
        )
      : edits;
  return {
    notify,
    remember(version, data) {
      if (state.latest?.version === version) return;
      state.latest = { version, data: structuredClone(data) };
      if (!state.versions.some((v) => v.version === version)) state.versions.push(state.latest);
      state.versions = state.versions.slice(-32);
      if (orderedRows || state.guards.length || existsSync(file)) save();
    },
    base: (version) => state.versions.find((v) => v.version === version),
    rowSnapshots: () => [state.latest?.data, ...state.versions.toReversed().map((v) => v.data)],
    hasUnmatchedRow: (ids) =>
      state.guards.some(({ path }) => path[0]?.startsWith("@") && !ids.has(path[0].slice(1))),
    upgradeRows() {
      const guard = state.guards.find((g) => !g.path.length);
      const latest = state.latest;
      if (
        !orderedRows ||
        !latest ||
        !Array.isArray(guard?.value) ||
        !guard.value.some((row) => row?.id === undefined)
      )
        return;

      const guarded = normalize(guard.value);
      const versions = state.versions.map((v) => ({
        ...v,
        data: normalize(v.data, guarded, true),
      }));
      const ancestors = versions.map((v) => v.data).filter((data) => !equalJson(data, guarded));
      const before = ancestors[0];
      // Legacy snapshots have no authors. Only a single distinct predecessor can explain the guard.
      if (
        !guard.whole &&
        versions.length < 32 &&
        equalJson(guard.value, latest.data) &&
        Array.isArray(before) &&
        before.every((row) => typeof row?.id === "string") &&
        ancestors.every((data) => equalJson(data, before))
      ) {
        state.guards = withRowExistence(changes(before, guarded, [], orderedRows));
      }
      if (state.guards.includes(guard)) guard.value = guarded;
      state.versions = versions;
      state.latest = { ...latest, data: normalize(latest.data, guarded) };
      save();
    },
    protect(base, data, actor) {
      const edited = changes(base, data, [], orderedRows);
      const prefix = (a, b) => a.every((v, i) => b[i] === v);
      state.guards = state.guards.flatMap((g) => {
        const related = edited.filter((e) => overlapping(g.path, e.path));
        if (!related.length) return [g];
        if (g.ensure) return related.some((e) => prefix(e.path, g.path)) ? [] : [g];
        if (actor !== "person" || related.some((e) => prefix(e.path, g.path))) return [];
        const nested = related.map((e) => ({ ...e, path: e.path.slice(g.path.length) }));
        return [
          { ...g, value: applyEdits(g.value, nested, g.value, orderedRows && !g.path.length) },
        ];
      });
      if (actor === "person")
        state.guards.push(
          ...withRowExistence(
            edited.filter((e) => !state.guards.some((g) => !g.ensure && prefix(g.path, e.path))),
          ),
        );
      else acknowledge();
      save();
    },
    reconcile(incoming, validate) {
      const fallback = state.latest?.data ?? incoming;
      let data = normalize(applyEdits(incoming, state.guards, fallback, orderedRows), fallback);
      const bad = validate(data);
      if (bad.length && state.guards.length && state.latest)
        data = normalize(state.latest.data, incoming);
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
      if (existsSync(file)) state = readState();
    },
    reset(version, data) {
      state.guards =
        data === undefined ? [] : [{ path: [], value: structuredClone(data), whole: true }];
      state.versions = data === undefined ? [] : [{ version, data: structuredClone(data) }];
      state.latest = state.versions[0] ?? null;
      acknowledge();
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
    const notice = Array.isArray(state.notices) ? state.notices.at(-1) : null;
    if (
      Array.isArray(state.guards) &&
      state.guards.length &&
      notice &&
      noticeKey(notice) !== (state.acknowledgedNoticeId ?? null)
    )
      console.error(
        `Studio retained human edits in ${notice.file}: ${(notice.retained ?? []).join(", ")}. Read the file again; use collab read/write to intentionally revise protected fields.`,
      );
  }
};
