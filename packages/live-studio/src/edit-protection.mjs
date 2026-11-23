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
import { isAbsolute, join, relative, resolve } from "node:path";

import { applyEdits, changes, equalJson, overlapping, pointer } from "./merge-edits.mjs";

const noticeKey = (notice) => (notice ? (notice.id ?? notice.at ?? "__legacy__") : null);
export const COLLAB_SNAPSHOTS = Symbol("collab.snapshots");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unescapeSeg = (seg) => seg.replaceAll("~1", "/").replaceAll("~0", "~");
const shortRowId = (id) => (UUID_RE.test(id) || id.length > 16 ? id.slice(0, 8) : id);

const lookupRowAt = (candidateDocs, prefixSegs, id) => {
  for (const doc of candidateDocs) {
    if (doc == null || typeof doc !== "object") continue;
    let cur = doc;
    for (const seg of prefixSegs) {
      if (cur == null || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      if (Array.isArray(cur) && seg.startsWith("@")) {
        cur = cur.find((row) => row && typeof row === "object" && row.id === seg.slice(1));
      } else if (!Array.isArray(cur) && Object.hasOwn(cur, seg)) {
        cur = cur[seg];
      } else {
        cur = undefined;
        break;
      }
    }
    if (Array.isArray(cur)) {
      const hit = cur.find((row) => row && typeof row === "object" && row.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
};

export const formatProtectedPointer = (ptr, candidateDocs = []) => {
  if (typeof ptr !== "string" || !ptr.startsWith("/") || ptr === "/") return String(ptr ?? "");
  const rawSegs = ptr.slice(1).split("/");
  const unescaped = rawSegs.map(unescapeSeg);
  let foundTime;
  const displaySegs = rawSegs.map((raw, i) => {
    const seg = unescaped[i];
    if (!seg.startsWith("@")) return raw;
    const id = seg.slice(1);
    const row = lookupRowAt(candidateDocs, unescaped.slice(0, i), id);
    if (typeof row?.t === "number" && Number.isFinite(row.t)) foundTime = +row.t.toFixed(3);
    const shortId = shortRowId(id);
    return shortId === id ? raw : `@${shortId.replaceAll("~", "~0").replaceAll("/", "~1")}`;
  });
  const label = `/${displaySegs.join("/")}`;
  return foundTime === undefined ? label : `${label} (t=${foundTime}s)`;
};

export const summarizeNotice = (notice, candidateDocs = [], { full = false } = {}) => {
  const paths = Array.isArray(notice?.retained) ? notice.retained : [];
  const docs = [...candidateDocs, notice?.incoming];
  const pathLabels = paths.map((p) => formatProtectedPointer(p, docs));
  const kind = notice?.kind ?? (notice?.problems?.length ? "rejected" : "retained");
  if (full) {
    return {
      ...notice,
      kind,
      paths,
      pathLabels,
    };
  }
  return {
    ...(notice?.id !== undefined ? { id: notice.id } : {}),
    ...(notice?.file !== undefined ? { file: notice.file } : {}),
    ...(notice?.at !== undefined ? { at: notice.at } : {}),
    kind,
    retained: paths,
    paths,
    pathLabels,
    ...(notice?.problems?.length ? { problems: notice.problems } : {}),
  };
};

const readDiskDoc = (project, rel) => {
  if (typeof rel !== "string" || !rel) return undefined;
  try {
    const root = resolve(project);
    const target = resolve(root, rel);
    const r = relative(root, target);
    if (!r || r.split(/[\\/]/)[0] === ".." || isAbsolute(r) || !existsSync(target))
      return undefined;
    return JSON.parse(readFileSync(target, "utf8"));
  } catch {
    return undefined;
  }
};

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
    report: () => {
      const out = { protected: state.guards.map((g) => pointer(g.path)), notices: state.notices };
      Object.defineProperty(out, COLLAB_SNAPSHOTS, {
        value: [state.latest?.data, ...state.versions.toReversed().map((v) => v.data)],
        enumerable: false,
      });
      return out;
    },
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
    ) {
      const candidateDocs = [
        readDiskDoc(project, notice.file),
        state.latest?.data,
        notice.incoming,
        ...(Array.isArray(state.versions) ? state.versions.toReversed().map((v) => v?.data) : []),
      ];
      const labels = (notice.retained ?? []).map((p) => formatProtectedPointer(p, candidateDocs));
      console.error(
        `Studio retained human edits in ${notice.file}: ${labels.join(", ")}. Read the file again; use collab read/write to intentionally revise protected fields.`,
      );
    }
  }
};
