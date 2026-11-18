// Notes spoken in the studio: one JSON object per line in notes/notes.jsonl, so an AI agent can read them. Pictures sit beside
// them in notes/img. Notes are an hour of someone's work: one bad line can't hide the rest, a crash mid-write can't cut the file,
// × only moves a note to notes/deleted.jsonl, and copies pile up in renders/notes_backup.
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  watch as fsWatch,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { applyChange, wholeNote } from "./note-state.mjs";

const BACKUP_EVERY = 5 * 60e3;

const parseLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};
const lines = (file) =>
  (existsSync(file) ? readFileSync(file, "utf8") : "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map(parseLine);

export const readNoteRows = (project) => lines(join(project, "notes/notes.jsonl"));

const archiveLines = (file) => {
  const bytes = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
  const rows = [];
  for (let start = 0; start < bytes.length;) {
    const newline = bytes.indexOf(10, start);
    const end = newline < 0 ? bytes.length : newline + 1;
    rows.push(bytes.subarray(start, end));
    start = end;
  }
  return rows;
};
const archiveDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const hasThreadText = (entries, key) =>
  entries == null || (
    Array.isArray(entries) && entries.every((entry) =>
      typeof entry?.[key] === "string" && (entry.at == null || typeof entry.at === "string"),
    )
  );
const isArchivedNote = (n) =>
  typeof n?.id === "string" &&
  /^[a-z0-9]+$/.test(n.id) &&
  typeof n.text === "string" &&
  Number.isFinite(n.t) &&
  (n.time == null || typeof n.time === "string") &&
  (n.shot == null || Number.isFinite(n.shot)) &&
  (n.at == null || typeof n.at === "string") &&
  hasThreadText(n.fixes, "what") &&
  hasThreadText(n.asks, "text") &&
  hasThreadText(n.edits, "was");
const parseArchiveLine = (bytes) => {
  try {
    const line = archiveDecoder.decode(bytes);
    if (!line.trim()) return undefined;
    const note = parseLine(line);
    return isArchivedNote(note) ? note : null;
  } catch {
    return null;
  }
};

export const readDeletedNotes = (project) =>
  archiveLines(join(project, "notes/deleted.jsonl")).map(parseArchiveLine).filter((note) => note !== undefined);

// #N, as every command names a note (notes, note, at): its place among every note written, in the order written, the ones
// the creator deleted counted too. Keep historical slots even when an archive row fails recovery validation. id -> {n, gone}
export const noteNumbers = (project) => {
  const seen = new Map();
  for (const [notes, gone] of [
    [readNoteRows(project), false],
    [lines(join(project, "notes/deleted.jsonl")), true],
  ])
    for (const n of notes)
      if (wholeNote(n) && !seen.has(n.id)) seen.set(n.id, { at: n.at ?? "", gone });
  const byAge = [...seen].toSorted(([, a], [, b]) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return new Map(byAge.map(([id, { gone }], i) => [id, { n: i + 1, gone }]));
};
// A note as the commands take it, by its id or its number (#N or N): {id, n, gone}, or null when no whole note is that
export const findNote = (project, key) => {
  const numbers = noteNumbers(project);
  if (numbers.has(key)) return { id: key, ...numbers.get(key) };
  const want = Number(/^#?(\d+)$/.exec(key)?.[1]),
    hit = [...numbers].find(([, x]) => x.n === want);
  return hit ? { id: hit[0], ...hit[1] } : null;
};
export const deletedSaid = ({ id, n }) =>
  `note #${n} (${id}) was deleted by the creator: nothing to answer there (bun run notes --deleted)`;

export const createNotes = (project) => {
  const file = join(project, "notes/notes.jsonl");
  const img = join(project, "notes/img");
  const deleted = join(project, "notes/deleted.jsonl");
  const backups = join(project, "renders/notes_backup");
  for (const d of [dirname(file), img, backups]) mkdirSync(d, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, "");

  const parse = (f) =>
    (existsSync(f) ? readFileSync(f, "utf8") : "")
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          console.error("bad note line kept in backups:", l);
          return [];
        }
      });
  const read = () => parse(file);

  let backedUp = 0;
  const backup = () => {
    if (Date.now() - backedUp < BACKUP_EVERY || !existsSync(file) || !statSync(file).size) return; // gone is no reason to refuse the next note
    backedUp = Date.now();
    copyFileSync(
      file,
      join(backups, `notes-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`),
    );
  };
  const replace = (target, text) => {
    const fresh = `${target}.new`;
    writeFileSync(fresh, text, { flush: true });
    for (let i = 0; ; i++) {
      try {
        renameSync(fresh, target);
        return;
      } catch (e) {
        // Windows refuses while something is reading it
        if (i >= 20) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  };
  const write = (all) => {
    backup();
    replace(file, all.map((n) => JSON.stringify(n) + "\n").join(""));
  };
  const archive = (note) => {
    const fd = openSync(deleted, "a+");
    try {
      const { size } = fstatSync(fd);
      const last = Buffer.alloc(1);
      if (size) readSync(fd, last, 0, 1, size - 1);
      const separator = size && last[0] !== 10 ? "\n" : "";
      appendFileSync(fd, separator + JSON.stringify(note) + "\n", { flush: true });
    } finally {
      closeSync(fd);
    }
  };
  const savePicture = (name, dataUrl) =>
    writeFileSync(join(img, `${name}.jpg`), Buffer.from(dataUrl.split(",")[1], "base64"));

  // A new note, with its pictures (data URLs): the film's (img, crop, strip, frames) and the creator's own pasted ones (refs).
  // What has been done to a note is the server's to say
  const add = ({ note, img: picture, crop, strip, frames, refs }, stamp) => {
    for (const k of [
      "crop",
      "strip",
      "frames",
      "refs",
      "fixes",
      "edits",
      "done",
      "state",
      "asks",
      "approved",
      "remember",
      "learned",
    ])
      delete note[k];
    note.img = picture ? `notes/img/${note.id}.jpg` : undefined;
    if (picture) savePicture(note.id, picture);
    for (const [kind, pic] of [
      ["crop", crop],
      ["strip", strip],
    ]) {
      if (!pic) continue;
      note[kind] = `notes/img/${note.id}_${kind}.jpg`;
      savePicture(`${note.id}_${kind}`, pic);
    }
    if (frames?.length)
      note.frames = frames.flatMap((f, i) => {
        if (!f.img) return [];
        savePicture(`${note.id}_f${i}`, f.img);
        return [{ t: f.t, img: `notes/img/${note.id}_f${i}.jpg` }];
      });
    if (refs?.length)
      note.refs = refs.map((r, i) => {
        savePicture(`${note.id}_r${i}`, r);
        return `notes/img/${note.id}_r${i}.jpg`;
      });
    Object.assign(note, stamp);
    const all = read();
    if (!all.some((n) => n.id === note.id)) write([...all, note]); // a retry after a lost answer isn't a second note
  };

  // {remove} and {restore} move the note between the files; every other change is note-state.mjs's. Says whether it applied, and why not
  const change = (id, c) => {
    const all = read();
    let n = all.find((x) => x.id === id);
    if (n && c.remove) {
      archive(n);
      write(all.filter((x) => x !== n));
    } else if (c.restore) {
      let archived;
      const kept = archiveLines(deleted).filter((line) => {
        const row = parseArchiveLine(line);
        if (!row || row.id !== id) return true;
        archived = row;
        return false;
      });
      if (!n) {
        if (!archived) return { ok: false, why: `no such note: ${id}` };
        n = archived;
        all.push(n);
        if (typeof c.text === "string") n.text = c.text;
        write(all);
      } else if (typeof c.text === "string" && c.text !== n.text) {
        n.text = c.text;
        write(all);
      }
      if (archived) replace(deleted, Buffer.concat(kept));
    } else if (n) {
      const r = applyChange(n, c);
      if (r.ok) write(all);
      return r;
    } else if (!c.remove) return { ok: false, why: `no such note: ${id}` };
    return { ok: true };
  };

  const picture = (name) => {
    const p = join(img, `${name}.jpg`);
    return existsSync(p) ? readFileSync(p) : null;
  };

  return { file, read, add, change, picture };
};

// Watch notes.jsonl via its directory so atomic renameSync and fresh first creation on Windows never drop events.
export const watchNotesFile = (file, onChange, { debounceMs = 80 } = {}) => {
  const dir = dirname(file),
    target = basename(file),
    snap = () => {
      if (!existsSync(file)) return "";
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null;
      }
    };
  mkdirSync(dir, { recursive: true });
  let seen = snap() ?? "",
    timer = null;
  const check = () => {
    const now = snap();
    if (now === null || now === seen) return;
    seen = now;
    onChange();
  };
  const watcher = fsWatch(dir, (_, name) => {
    if (name && basename(String(name)) !== target) return;
    clearTimeout(timer);
    timer = setTimeout(check, debounceMs);
  });
  return {
    sync: () => {
      const now = snap();
      if (now !== null) seen = now;
    },
    close: () => {
      clearTimeout(timer);
      watcher.close();
    },
  };
};
