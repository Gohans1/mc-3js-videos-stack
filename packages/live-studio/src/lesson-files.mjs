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
  const seen = new Map();
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
  const watch = (onChange) => {
    const waiting = new Set();
    let watchState = { status: "unwatched" };
    const settled = (timer) => {
      if (watchState.status !== "watching" || watchState.timer !== timer) return;
      watchState.timer = null;
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
      if (watchState.status !== "watching") return;
      waiting.add(path);
      if (watchState.timer) clearTimeout(watchState.timer);
      const timer = setTimeout(() => settled(timer), 150);
      watchState.timer = timer;
    };
    const attachDir = (notifyExisting) => {
      if (watchState.status === "watching" || watchState.status === "closed" || !existsSync(dir))
        return false;
      const dirWatch = fsWatch(dir, { recursive: true }, (_, name) => {
        const path = name?.replaceAll("\\", "/");
        if (!path || !NAME.test(path)) return;
        queue(path);
      });
      const prev = watchState;
      watchState = { status: "watching", watcher: dirWatch, timer: null };
      if (prev.status === "waiting-parent") prev.watcher.close();
      for (const f of list()) {
        if (notifyExisting) {
          if (f.tag !== (seen.get(f.path) ?? null)) queue(f.path);
        } else {
          seen.set(f.path, f.tag);
        }
      }
      return true;
    };
    if (!attachDir(false)) {
      const parent = dirname(dir);
      if (existsSync(parent)) {
        const parentWatch = fsWatch(parent, () => {
          if (watchState.status !== "waiting-parent") return;
          attachDir(true);
        });
        watchState = { status: "waiting-parent", watcher: parentWatch };
      }
    }
    return () => {
      const prev = watchState;
      watchState = { status: "closed" };
      if (prev.status === "watching") {
        if (prev.timer) clearTimeout(prev.timer);
        prev.watcher.close();
      } else if (prev.status === "waiting-parent") {
        prev.watcher.close();
      }
    };
  };
  return { dir, list, write, remove, watch };
};
