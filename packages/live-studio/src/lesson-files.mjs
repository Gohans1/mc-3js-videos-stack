// The lesson files (global LESSONS or a film's lessons/) as the studio's Lessons tab reads and writes them. A save names the version it was
// made on (tag): the AI may have changed the file meanwhile (bun run note learned), and its words are never written over.
// The page edits plain lines (a textarea turns CRLF into LF), so a file's byte-order mark and CRLF lines are put back on save
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  watch as fsWatch,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

import { LESSONS } from "./lessons.mjs";

const NAME = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.md$/;
const tagOf = (buf) => createHash("md5").update(buf).digest("base64url");
const BOM = String.fromCharCode(0xfeff);
const plain = (raw) => (raw.startsWith(BOM) ? raw.slice(1) : raw).replace(/\r\n/g, "\n");

export const openLessonFiles = (dir = LESSONS) => {
  const seen = new Map(); // path: the tag last known there, read by watch or written by the studio; null once gone
  const fileOf = (path) => {
    if (typeof path !== "string" || !NAME.test(path)) return null;
    const file = join(dir, path),
      r = relative(dir, file);
    return r && !r.startsWith("..") && !isAbsolute(r) ? file : null;
  };
  const list = () =>
    existsSync(dir)
      ? readdirSync(dir, { recursive: true, withFileTypes: true })
          .filter((f) => f.isFile() && f.name.endsWith(".md"))
          .map((f) => {
            const file = join(f.parentPath, f.name),
              raw = readFileSync(file);
            return {
              path: relative(dir, file).replaceAll("\\", "/"),
              tag: tagOf(raw),
              text: plain(raw.toString("utf8")),
            };
          })
          .filter((f) => NAME.test(f.path))
          .toSorted((a, b) => (a.path < b.path ? -1 : 1))
      : [];
  // base: the tag the page read, or null for a new file
  const write = (path, text, base) => {
    const file = fileOf(path);
    if (!file)
      return { error: `not a lesson file name: ${path} (letters, digits, - and _, ending .md)` };
    const was = existsSync(file) ? readFileSync(file) : null;
    if ((was ? tagOf(was) : null) !== base)
      return was
        ? { conflict: true, tag: tagOf(was), text: plain(was.toString("utf8")) }
        : { conflict: true, tag: null, text: null };
    const old = was?.toString("utf8") ?? "",
      crlf = old.includes("\r\n"),
      body = (old.startsWith(BOM) ? BOM : "") + (crlf ? text.replace(/\r?\n/g, "\r\n") : text),
      buf = Buffer.from(body, "utf8"),
      fresh = `${file}.new`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(fresh, buf, { flush: true });
    renameSync(fresh, file);
    seen.set(path, tagOf(buf));
    return { tag: tagOf(buf) };
  };
  const remove = (path, base) => {
    const file = fileOf(path);
    if (!file)
      return { error: `not a lesson file name: ${path} (letters, digits, - and _, ending .md)` };
    const was = existsSync(file) ? readFileSync(file) : null;
    if (!was) {
      seen.set(path, null);
      return { removed: false, missing: true };
    }
    if (base !== undefined && tagOf(was) !== base) {
      return { conflict: true, tag: tagOf(was), text: plain(was.toString("utf8")) };
    }
    unlinkSync(file);
    seen.set(path, null);
    for (
      let parent = dirname(file);
      relative(dir, parent) && !relative(dir, parent).startsWith("..");
      parent = dirname(parent)
    ) {
      if (readdirSync(parent).length) break;
      rmdirSync(parent);
    }
    return { removed: true };
  };
  // onChange(paths): the files someone else (the AI) changed, together once the writes settle, so a whole folder copied in is
  // one change; a file written again with the same words is no change. Gives the way to stop
  const watch = (onChange) => {
    const waiting = new Set();
    let timer;
    let dirWatch = null;
    let parentWatch = null;
    const settled = () => {
      const paths = [...waiting].filter((path) => {
        const file = join(dir, path),
          tag = existsSync(file) ? tagOf(readFileSync(file)) : null;
        if (tag === (seen.get(path) ?? null)) return false;
        seen.set(path, tag);
        return true;
      });
      waiting.clear();
      if (paths.length) onChange(paths);
    };
    const queue = (path) => {
      waiting.add(path);
      clearTimeout(timer);
      timer = setTimeout(settled, 150);
    };
    const attachDir = (notifyExisting) => {
      if (dirWatch || !existsSync(dir)) return false;
      for (const f of list()) {
        if (notifyExisting) {
          if (f.tag !== (seen.get(f.path) ?? null)) queue(f.path);
        } else {
          seen.set(f.path, f.tag);
        }
      }
      dirWatch = fsWatch(dir, { recursive: true }, (_, name) => {
        const path = name?.replaceAll("\\", "/");
        if (!path || !NAME.test(path)) return;
        queue(path);
      });
      return true;
    };
    if (!attachDir(false)) {
      const parent = dirname(dir);
      if (existsSync(parent)) {
        parentWatch = fsWatch(parent, () => {
          if (!attachDir(true)) return;
          parentWatch?.close();
          parentWatch = null;
        });
      }
    }
    return () => {
      dirWatch?.close();
      parentWatch?.close();
      clearTimeout(timer);
    };
  };
  return { dir, list, write, remove, watch };
};
