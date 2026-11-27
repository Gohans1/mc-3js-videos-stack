import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

import { resetProtectedFiles } from "./edit-protection.mjs";
import { assertInsideDir } from "./voice-map.mjs";

const ROOT_FILES = [
  "package.json",
  "sound.py",
  "choices.json",
  "sound_choices.json",
  "pack/picks.json",
];
const EXCLUDED = ["node_modules", ".studio", ".git", "renders"];
const SOURCE = /\.(?:[cm]?[jt]sx?|json|css|html|glsl|wgsl|py)$/i;
const hash = (data) => createHash("sha256").update(data).digest("hex");
const eligible = (name) =>
  ROOT_FILES.includes(name) ||
  (name.startsWith("src/") &&
    SOURCE.test(name) &&
    !name.split("/").some((p) => EXCLUDED.includes(p)));

export class HistoryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const openFilmHistory = (
  project,
  {
    beforeCapture = () => {},
    afterRestore = () => {},
    changed = () => {},
    onError = console.error,
  } = {},
) => {
  const folder = assertInsideDir(project, ".studio", "History");
  mkdirSync(folder, { recursive: true });
  const db = new Database(assertInsideDir(project, ".studio/history.sqlite", "History"), {
    create: true,
    strict: true,
  });
  db.run(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS blobs(hash TEXT PRIMARY KEY, content BLOB NOT NULL); CREATE TABLE IF NOT EXISTS revisions(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, fingerprint TEXT NOT NULL, manifest TEXT NOT NULL)",
  );
  const hadPaths = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='paths'")
    .get();
  db.run("CREATE TABLE IF NOT EXISTS paths(name TEXT PRIMARY KEY)");
  if (!hadPaths)
    db.transaction(() => {
      for (const row of db.query("SELECT manifest FROM revisions").all())
        for (const name of Object.keys(JSON.parse(row.manifest)))
          db.query("INSERT OR IGNORE INTO paths VALUES (?)").run(name);
    })();
  const safe = (name) => {
    if (name.split("/").some((p) => EXCLUDED.includes(p)))
      throw new HistoryError(`Not an editing file: ${name}`);
    const file = assertInsideDir(project, name, "History file");
    if (relative(project, file).replaceAll("\\", "/") !== name)
      throw new HistoryError(`Noncanonical editing path: ${name}`);
    if (existsSync(file) && !lstatSync(file).isFile())
      throw new HistoryError(`Not a regular file: ${name}`);
    return file;
  };
  // Bun realpath keeps requested casing on Windows; directory entries reveal the file's spelling.
  const actualName = (name) => {
    const file = assertInsideDir(project, name, "History file");
    let parent = project;
    const parts = [];
    for (const part of relative(project, file).replaceAll("\\", "/").split("/")) {
      let actual = part;
      if (existsSync(parent)) {
        const names = readdirSync(parent);
        if (!names.includes(part) && existsSync(join(parent, part))) {
          const ino = lstatSync(join(parent, part), { bigint: true }).ino;
          actual =
            names.find(
              (n) =>
                n.toLowerCase() === part.toLowerCase() &&
                lstatSync(join(parent, n), { bigint: true }).ino === ino,
            ) ?? part;
        }
      }
      parts.push(actual);
      parent = join(parent, actual);
    }
    return parts.join("/");
  };
  let watched = new Set(ROOT_FILES),
    preparationProblem = null;
  const snapshot = () => {
    preparationProblem = beforeCapture()?.join("; ") || null;
    const files = new Map();
    let bytes = 0;
    const add = (name) => {
      name = actualName(name);
      if (files.has(name)) return;
      const file = safe(name);
      if (lstatSync(file).size > 8 * 1024 * 1024)
        throw new HistoryError(`History file exceeds 8 MB: ${name}`);
      const content = readFileSync(file);
      bytes += content.length;
      if (bytes > 64 * 1024 * 1024) throw new HistoryError("Editing snapshot exceeds 64 MB");
      files.set(name, content);
    };
    const walk = (dir) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        if (EXCLUDED.includes(item.name)) continue;
        const file = assertInsideDir(project, join(dir, item.name), "History source");
        if (item.isDirectory()) walk(file);
        else if (item.isFile()) {
          const name = relative(project, file).replaceAll("\\", "/");
          if (eligible(name)) add(name);
        }
      }
    };
    if (existsSync(join(project, "src"))) walk(assertInsideDir(project, "src", "History source"));
    for (const name of ROOT_FILES) if (existsSync(join(project, name))) add(name);
    watched = new Set([
      ...ROOT_FILES,
      ...db
        .query("SELECT name FROM paths")
        .all()
        .map((row) => row.name),
    ]);
    let config;
    try {
      config = JSON.parse(files.get("package.json")?.toString("utf8") ?? "{}")["live-studio"];
    } catch (error) {
      preparationProblem = `package.json: ${error.message}`;
    }
    const configured = [
      ...[
        "soundTimeline",
        "camTimeline",
        "lightsTimeline",
        "shotsTimeline",
        "textTimeline",
        "adjustmentTimeline",
        "timingTimeline",
        "openfilmTimeline",
      ].map((key) => config?.[key]),
      ...Object.keys(config?.keyFiles ?? {}),
    ];
    for (const name of configured) {
      if (typeof name !== "string") continue;
      try {
        const file = assertInsideDir(project, name, "History timeline");
        const canonical = relative(project, file).replaceAll("\\", "/");
        safe(canonical);
        watched.add(canonical);
        watched.add(actualName(canonical));
      } catch (error) {
        preparationProblem = [preparationProblem, error.message].filter(Boolean).join("; ");
      }
    }
    for (const name of watched) if (!files.has(name) && existsSync(join(project, name))) add(name);
    const manifest = Object.fromEntries(
      [...files.keys()]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((name) => [name, hash(files.get(name))]),
    );
    return { files, manifest, fingerprint: hash(JSON.stringify(manifest)) };
  };
  const keep = db.transaction((name, kind, state) => {
    const last = db
      .query("SELECT seq,id,name,kind,at,fingerprint FROM revisions ORDER BY seq DESC LIMIT 1")
      .get();
    if (kind === "auto" && last?.fingerprint === state.fingerprint)
      return { revision: last, created: false };
    const id = randomUUID(),
      at = new Date().toISOString();
    for (const path of watched) db.query("INSERT OR IGNORE INTO paths VALUES (?)").run(path);
    for (const [file, content] of state.files) {
      db.query("INSERT OR IGNORE INTO paths VALUES (?)").run(file);
      db.query("INSERT OR IGNORE INTO blobs VALUES (?, ?)").run(state.manifest[file], content);
    }
    db.query(
      "INSERT INTO revisions(id,name,kind,at,fingerprint,manifest) VALUES (?,?,?,?,?,?)",
    ).run(id, name, kind, at, state.fingerprint, JSON.stringify(state.manifest));
    return {
      revision: db
        .query("SELECT seq,id,name,kind,at,fingerprint FROM revisions WHERE id=?")
        .get(id),
      created: true,
    };
  });
  const capture = (name = "Autosave", kind = "auto") => {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 160 ||
      !["auto", "named", "before-restore", "restore"].includes(kind)
    )
      throw new HistoryError("A revision needs a name of 1-160 characters and a valid kind");
    const { revision, created } = keep(name.trim(), kind, snapshot());
    if (created) changed();
    return revision;
  };
  const list = (limit = 100, before = Number.MAX_SAFE_INTEGER) =>
    db
      .query(
        "SELECT seq,id,name,kind,at,fingerprint FROM revisions WHERE seq < ? ORDER BY seq DESC LIMIT ?",
      )
      .all(before, Math.max(1, Math.min(100, limit)));
  const current = () => {
    const state = snapshot();
    return { fingerprint: state.fingerprint, files: state.files.size };
  };
  const restore = (id, base) => {
    const row = db.query("SELECT * FROM revisions WHERE id=?").get(id);
    if (!row) throw new HistoryError("Revision not found", 404);
    const before = snapshot();
    if (before.fingerprint !== base)
      throw new HistoryError("The film changed; refresh history before restoring", 409);
    const target = JSON.parse(row.manifest),
      contents = new Map();
    for (const [name, digest] of Object.entries(target)) {
      safe(name);
      const blob = db.query("SELECT content FROM blobs WHERE hash=?").get(digest)?.content;
      if (!blob || hash(blob) !== digest)
        throw new HistoryError(`Missing or corrupt history content: ${name}`, 500);
      contents.set(name, blob);
    }
    const { revision: backup } = keep("Before restoring " + row.name, "before-restore", before);
    changed();
    const touchedPaths = new Map();
    for (const name of [...before.files.keys(), ...contents.keys()]) {
      const actual = actualName(name);
      if (!touchedPaths.has(actual)) touchedPaths.set(actual, name);
    }
    const touched = [...touchedPaths.values()];
    const protections = [...new Set([...touched, ...watched])];
    const staged = [];
    try {
      for (const [name, content] of contents) {
        const file = safe(name);
        mkdirSync(dirname(file), { recursive: true });
        const temp = `${file}.${randomUUID()}.history-new`;
        writeFileSync(temp, content);
        staged.push([temp, file]);
      }
      for (const [temp, file] of staged) renameSync(temp, file);
      const targets = new Set([...contents.keys()].map(actualName));
      for (const name of before.files.keys())
        if (!targets.has(actualName(name))) rmSync(safe(name));
      resetProtectedFiles(project, protections);
      afterRestore();
    } catch (error) {
      const failures = [];
      for (const name of touched) {
        try {
          const file = safe(name);
          if (before.files.has(name)) writeFileSync(file, before.files.get(name));
          else rmSync(file, { force: true });
        } catch (failed) {
          failures.push(failed.message);
        }
      }
      try {
        resetProtectedFiles(project, protections);
        afterRestore();
      } catch (failed) {
        failures.push(failed.message);
      }
      throw new HistoryError(
        `Restore failed; recovery revision ${backup.id}: ${error.message}${failures.length ? "; rollback: " + failures.join("; ") : ""}`,
        500,
      );
    } finally {
      for (const [temp] of staged) rmSync(temp, { force: true });
    }
    const { revision: restored } = keep("Restored " + row.name, "restore", snapshot());
    changed();
    const previousPackage = before.files.get("package.json"),
      nextPackage = contents.get("package.json");
    return {
      backup,
      revision: restored,
      restartRequired: hash(previousPackage ?? "") !== hash(nextPackage ?? ""),
    };
  };
  let watchState = { status: "idle" },
    problem = null;
  const start = () => {
    if (watchState.status !== "idle") return;
    watchState = { status: "watching", watcher: null, timer: null };
    const autosave = () => {
      if (watchState.status !== "watching") return;
      const previousProblem = problem ?? preparationProblem;
      let created = false;
      try {
        ({ created } = keep("Autosave", "auto", snapshot()));
        problem = null;
      } catch (error) {
        problem = error.message;
        onError(error.message);
      }
      if (watchState.status === "watching" && (created || previousProblem !== (problem ?? preparationProblem)))
        changed();
    };
    autosave();
    if (watchState.status !== "watching") return;
    const schedule = () => {
      if (watchState.status !== "watching") return;
      if (watchState.timer !== null) clearTimeout(watchState.timer);
      const handle = setTimeout(() => {
        if (watchState.status !== "watching" || watchState.timer !== handle) return;
        watchState.timer = null;
        autosave();
      }, 1000);
      watchState.timer = handle;
    };
    const watcher = watch(project, { recursive: true }, (_, file) => {
      if (watchState.status !== "watching") return;
      const name = String(file).replaceAll("\\", "/");
      if (name.split("/").some((p) => EXCLUDED.includes(p))) return;
      if (
        name === "src" ||
        name.startsWith("src/") ||
        watched.has(name) ||
        [...watched].some(
          (p) => p.toLowerCase() === name.toLowerCase() && actualName(p) === actualName(name),
        ) ||
        [...watched].some((p) => p.startsWith(name + "/"))
      )
        schedule();
    });
    if (watchState.status === "watching") watchState.watcher = watcher;
    else watcher.close();
  };
  return {
    capture,
    list,
    current,
    restore,
    start,
    get problem() {
      return problem ?? preparationProblem;
    },
    close() {
      if (watchState.status === "closed") return;
      const prev = watchState;
      watchState = { status: "closed" };
      if (prev.status === "watching") {
        if (prev.timer !== null) clearTimeout(prev.timer);
        prev.watcher?.close();
      }
      db.close();
    },
  };
};
