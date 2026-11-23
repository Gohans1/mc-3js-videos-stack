import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { MAX_FOV, MIN_FOV } from "film-kit/lens";

import { filmVersion } from "./film-version.mjs";
import { noteState, wholeNote } from "./note-state.mjs";
import { createNotes, deletedSaid, findNote, noteNumbers } from "./notes.mjs";
import { studioPort } from "./tell.mjs";

const MAX_AFTER_BYTES = 15 * 1024 * 1024;

const detectImageMime = (buf) => {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
};

export const readAfterDataUrl = (project, rawPath) => {
  if (typeof rawPath !== "string" || !rawPath.trim())
    throw new Error("--after needs an image file path");
  const full = isAbsolute(rawPath) ? rawPath : resolve(project, rawPath);
  if (!existsSync(full)) throw new Error(`after image not found: ${rawPath}`);
  const st = statSync(full);
  if (!st.isFile()) throw new Error(`after image is not a file: ${rawPath}`);
  if (st.size === 0) throw new Error(`after image is empty: ${rawPath}`);
  if (st.size > MAX_AFTER_BYTES)
    throw new Error(
      `after image exceeds 15 MB (${(st.size / (1024 * 1024)).toFixed(1)} MB): ${rawPath}`,
    );
  const buf = readFileSync(full);
  const mime = detectImageMime(buf);
  if (!mime) throw new Error(`--after must be a PNG, JPEG, or WebP image: ${rawPath}`);
  return `data:${mime};base64,${buf.toString("base64")}`;
};

export const parseFixCam = (raw) => {
  if (!raw) return undefined;
  if (typeof raw === "object") return raw;
  const parts = String(raw)
    .split(",")
    .map((s) => {
      const trimmed = s.trim();
      return trimmed ? Number(trimmed) : Number.NaN;
    });
  if (parts.length < 6 || parts.length > 8 || parts.some((n) => !Number.isFinite(n)))
    throw new Error("--cam takes 6-8 numbers: px,py,pz,lx,ly,lz[,fov[,roll]]");
  const p = parts.slice(0, 3);
  const l = parts.slice(3, 6);
  if (Math.hypot(p[0] - l[0], p[1] - l[1], p[2] - l[2]) <= 1e-4)
    throw new Error("--cam position p and look-at l must differ");
  const fov = parts[6];
  if (fov !== undefined && (fov < MIN_FOV || fov > MAX_FOV))
    throw new Error(`--cam fov must be in ${MIN_FOV}..${MAX_FOV}, got ${fov}`);
  const roll = parts[7];
  if (roll !== undefined && Math.abs(roll) > Math.PI + 1e-4)
    throw new Error(`--cam roll (radians) must stay within +/-pi, got ${roll}`);
  return {
    p,
    l,
    ...(fov !== undefined ? { fov } : {}),
    ...(roll !== undefined ? { roll } : {}),
  };
};

export const parseFixTime = (raw) => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) throw new Error(`--t must be >= 0 s, got ${raw}`);
    return raw;
  }
  const s = String(raw).trim();
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
  const v = m ? Number(m[1]) * 60 + Number(m[2]) : Number(s);
  if (!Number.isFinite(v) || v < 0)
    throw new Error(`--t expects seconds or m:ss (non-negative), got ${JSON.stringify(raw)}`);
  return v;
};

const version = (project) => filmVersion(project);

export const resolveNote = (project, key) => {
  const hit = findNote(project, key);
  if (hit?.gone) throw new Error(deletedSaid(hit));
  if (!hit)
    throw new Error(
      `no such note: ${key} (the ids and #numbers: bun run notes, --done for fixed ones too)`,
    );
  return hit.id;
};

export const sendChange = async (project, id, change) => {
  const notes = createNotes(project);
  if (!change.restore && !notes.read().some((n) => n.id === id))
    throw new Error(`no such note: ${id}`);
  const port = studioPort(project);
  if (port) {
    let r = null;
    try {
      r = await fetch(`http://127.0.0.1:${port}/api/notes/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
        signal: AbortSignal.timeout(3000),
      });
    } catch (e) {
      if (e?.name === "TimeoutError")
        throw new Error(
          "the studio did not answer in 3 s (busy building or rendering?) and may still take it: see whether it did (bun run notes ID) before you send it again",
        );
    }
    if (r && !r.ok) throw new Error(`the studio refused it: ${await r.text()}`);
    if (r) return "studio";
  }
  const r = notes.change(id, change);
  if (!r.ok) throw new Error(r.why);
  return "file";
};

export const markDone = (project, id, what, opts = {}) => {
  const ask = typeof opts === "boolean" ? opts : !!opts?.ask;
  const o = typeof opts === "object" && opts ? opts : {};
  const hasAfter = typeof o.after === "string" && o.after.length > 0;
  const hasAfterData = typeof o.afterData === "string" && o.afterData.length > 0;
  const reason = typeof o.noAfterReason === "string" ? o.noAfterReason.trim() : "";
  const hasReason = reason.length > 0;
  if (!ask) {
    if ((hasAfter || hasAfterData) && hasReason)
      throw new Error('pass either --after <image> or --no-after "<reason>", not both');
    if (!hasAfter && !hasAfterData && !hasReason)
      throw new Error(
        'done needs --after <image> or --no-after "<reason>" (if the subject moved or the note view no longer fits, capture a custom frame via bun run render stills --inspect px,py,pz,lx,ly,lz,fov --at <s> and pass --cam px,py,pz,lx,ly,lz,fov --t <s>)',
      );
  }
  const afterData = hasAfterData
    ? o.afterData
    : hasAfter
      ? readAfterDataUrl(project, o.after)
      : undefined;
  const cam = o.cam !== undefined ? parseFixCam(o.cam) : undefined;
  const t = o.t !== undefined ? parseFixTime(o.t) : undefined;
  return sendChange(project, id, {
    fix: {
      what,
      checkpoint: version(project),
      ...(ask ? { ask: true } : {}),
      ...(afterData ? { afterData } : {}),
      ...(hasReason ? { noAfterReason: reason } : {}),
      ...(cam ? { cam } : {}),
      ...(t !== undefined ? { t } : {}),
    },
  });
};

const READS_FILE = "notes/note-reads.json";

const normalizeReads = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { byId: {} };
  const byId =
    raw.byId && typeof raw.byId === "object" && !Array.isArray(raw.byId) ? { ...raw.byId } : {};
  const lastList =
    raw.lastList && typeof raw.lastList === "object" && Array.isArray(raw.lastList.knownIds)
      ? raw.lastList
      : undefined;
  return { byId, ...(lastList ? { lastList } : {}) };
};

const readNoteReads = (project) => {
  const file = join(project, READS_FILE);
  if (!existsSync(file)) return { byId: {} };
  try {
    return normalizeReads(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { byId: {} };
  }
};

const writeNoteReads = (project, data) => {
  const file = join(project, READS_FILE);
  mkdirSync(join(project, "notes"), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
};

export const recordNoteReads = (project, shownIds, allActiveNotes) => {
  if (!existsSync(join(project, "notes/notes.jsonl"))) return;
  const data = readNoteReads(project);
  const knownIds = allActiveNotes.map((n) => n?.id).filter((id) => typeof id === "string" && id);
  const snap = { at: Date.now(), knownIds };
  data.lastList = snap;
  for (const id of shownIds) {
    if (typeof id === "string" && id) data.byId[id] = snap;
  }
  writeNoteReads(project, data);
};

const openNotes = (project) =>
  existsSync(join(project, "notes/notes.jsonl"))
    ? createNotes(project)
        .read()
        .filter((n) => wholeNote(n) && noteState(n) === "open")
    : [];

export const unreadNotes = (project, open = openNotes(project)) => {
  const reads = readNoteReads(project);
  const known = new Set(reads.lastList?.knownIds ?? []);
  return open.filter((n) => !known.has(n.id) && !reads.byId?.[n.id]);
};

export const noteNudge = (project) => {
  const open = openNotes(project);
  if (!open.length) return "";
  const fresh = unreadNotes(project, open).length;
  return `next: bun run notes first: the creator has ${open.length} open note${open.length > 1 ? "s" : ""}${fresh ? `, ${fresh} new since your last bun run notes` : ""}`;
};

export const collectNewNotesAfterRead = (project, targetId, { consume = false } = {}) => {
  const file = join(project, READS_FILE);
  if (!existsSync(file)) return [];
  const data = readNoteReads(project);
  const baseline = data.byId?.[targetId] ?? data.lastList;
  if (!baseline || !Array.isArray(baseline.knownIds)) return [];

  const active = createNotes(project).read().filter(wholeNote);
  const target = active.find((n) => n.id === targetId);
  const targetT = Number.isFinite(target?.t) ? target.t : 0;
  const numbers = noteNumbers(project);
  const known = new Set(baseline.knownIds);

  const newlyAdded = active
    .filter((n) => n.id !== targetId && !known.has(n.id))
    .map((n) => ({
      ...n,
      n: numbers.get(n.id)?.n ?? null,
      state: noteState(n),
    }))
    .toSorted((a, b) => {
      const da = Math.abs((Number.isFinite(a.t) ? a.t : 0) - targetT);
      const db = Math.abs((Number.isFinite(b.t) ? b.t : 0) - targetT);
      if (Math.abs(da - db) > 1e-6) return da - db;
      const ta = Date.parse(a.at ?? "") || 0;
      const tb = Date.parse(b.at ?? "") || 0;
      if (tb !== ta) return tb - ta;
      return (a.n ?? 0) - (b.n ?? 0);
    });

  if (consume) {
    data.byId = {
      ...data.byId,
      [targetId]: {
        at: Date.now(),
        knownIds: active.map((n) => n?.id).filter((id) => typeof id === "string" && id),
      },
    };
    writeNoteReads(project, data);
  }
  return newlyAdded;
};

export const formatNewNotesSinceRead = (project, targetId, newNotes) => {
  if (!newNotes.length) return "";
  const active = createNotes(project).read();
  const numbers = noteNumbers(project);
  const target = active.find((n) => n.id === targetId);
  const targetNum = numbers.get(targetId)?.n;
  const targetT = typeof target?.t === "number" && Number.isFinite(target.t) ? target.t : 0;
  const targetTime =
    typeof target?.time === "string"
      ? target.time
      : typeof target?.t === "number" && Number.isFinite(target.t)
        ? `${target.t}s`
        : "";
  const targetRef = targetNum != null ? `#${targetNum}` : targetId;
  const header = `new note${newNotes.length === 1 ? "" : "s"} added while you worked on ${targetRef} (closest to ${targetTime} first — check whether they supplement this fix):`;
  const lines = newNotes.map((n) => {
    const numStr = n.n != null ? `#${n.n} ` : "";
    const nT = typeof n.t === "number" && Number.isFinite(n.t) ? n.t : 0;
    const timeStr = typeof n.time === "string" ? n.time : `${nT}s`;
    const shotStr = typeof n.shot === "number" ? ` shot ${n.shot}` : "";
    const delta = nT - targetT;
    const near =
      Math.abs(delta) < 0.05
        ? "same second"
        : `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(1)}s`;
    const raw = String(n.text ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
    const preview = raw.length > 100 ? `${raw.slice(0, 99)}…` : raw || "(no words)";
    return `  ${numStr}${n.id} ${timeStr}${shotStr} (${near} from ${targetRef}) [${n.state}] ${preview}`;
  });
  return [header, ...lines].join("\n");
};
