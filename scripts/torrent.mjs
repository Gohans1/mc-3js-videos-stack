import { createHash } from "node:crypto";

// A .torrent's own bencode: integers, lists, dictionaries and byte strings (kept as bytes: names may not be UTF-8)
function bdecode(buf) {
  let i = 0;
  let infoAt = null;
  const next = (depth) => {
    const c = buf[i];
    if (c === 0x69) {
      const end = buf.indexOf(0x65, i);
      const n = Number(buf.toString("latin1", i + 1, end));
      i = end + 1;
      return n;
    }
    if (c === 0x6c || c === 0x64) {
      i++;
      const list = c === 0x6c ? [] : null,
        dict = c === 0x64 ? {} : null;
      while (buf[i] !== 0x65) {
        if (list) {
          list.push(next(depth + 1));
          continue;
        }
        const key = next(depth + 1).toString("utf8");
        const from = i;
        dict[key] = next(depth + 1);
        if (depth === 0 && key === "info") infoAt = [from, i];
      }
      i++;
      return list ?? dict;
    }
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) throw new Error("not a .torrent file");
    const from = colon + 1,
      to = from + Number(buf.toString("latin1", i, colon));
    i = to;
    return buf.subarray(from, to);
  };
  const root = next(0);
  return { root, info: infoAt && buf.subarray(...infoAt) };
}

/** A .torrent's info hash (BitTorrent v1) and its files in the order clients number them (from 1). */
export function readTorrent(bytes) {
  const { root, info } = bdecode(Buffer.from(bytes));
  if (!root?.info || !info) throw new Error("not a .torrent file");
  const text = (b) => Buffer.from(b).toString("utf8");
  const files = root.info.files
    ? root.info.files.map((f) => ({
        path: (f["path.utf-8"] ?? f.path).map(text),
        length: f.length,
      }))
    : [{ path: [text(root.info["name.utf-8"] ?? root.info.name)], length: root.info.length }];
  return {
    btih: createHash("sha1").update(info).digest("hex"),
    name: text(root.info["name.utf-8"] ?? root.info.name),
    files,
  };
}

// Windows refuses these characters, a trailing space or dot, and the old device names; libtorrent maps names the same
// way (blog.libtorrent.org/2014/12/filenames)
const BAD = /[\p{Cc}<>:"/\\|?*]/gu;
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const DIR_MAX = 80;
const safe = (name) => {
  let s = name
    .replace(BAD, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (!s || s === "." || s === "..") s = "_";
  if (DEVICE.test(s)) s = `_${s}`;
  return s;
};
const cut = (name, max) => {
  if (name.length <= max) return name;
  const ext = name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "";
  return name.slice(0, Math.max(1, max - ext.length)).replace(/[. ]+$/, "") + ext;
};

/**
 * Where each file of a torrent is written, relative to its pack folder: the torrent's top folder dropped, every name
 * made one Windows accepts, the whole path at most `budget` characters, and names that would collide (Windows ignores
 * case) numbered. For aria2's index-out, which takes the file's index from 1.
 */
export function torrentPaths(torrent, budget) {
  const taken = new Set();
  return torrent.files.map((f, k) => {
    const dirs = f.path.slice(0, -1).map((d) => cut(safe(d), DIR_MAX));
    const prefix = dirs.length ? `${dirs.join("/")}/` : "";
    const base = cut(safe(f.path.at(-1) ?? ""), Math.max(24, budget - prefix.length));
    let path = prefix + base;
    for (let n = 2; taken.has(path.toLowerCase()); n++) {
      const ext = base.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "";
      path = `${prefix}${cut(base.slice(0, base.length - ext.length), budget - prefix.length - ext.length - 4 - String(n).length)} (${n})${ext}`;
    }
    taken.add(path.toLowerCase());
    return { index: k + 1, path, length: f.length };
  });
}
