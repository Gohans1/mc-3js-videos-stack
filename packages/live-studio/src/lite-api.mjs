import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { html } from "hono/html";
import { HTTPException } from "hono/http-exception";
import * as z from "zod";

import { pickDefaultLiteVideo } from "./compare-video-meta.ts";
import {
  isValidCompareVideoPath,
  listCompareVideos,
  probeCompareVideo,
  resolveCompareVideoFile,
} from "./compare-videos.mjs";
import { filmVersionAsync } from "./film-version.mjs";
import { ratioOf } from "./frame.ts";
import { createNotes, noteNumbers } from "./notes.mjs";
import { compileTiming } from "./timing.mjs";
import { warp } from "./warp.mjs";

export { pickDefaultLiteVideo };

const VIDEO_MIME = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

const jpeg = z.string().startsWith("data:image/jpeg;base64,/9j/").nullish();

const NoteCompareVideo = z.object({
  path: z.string().min(1).max(300).refine(isValidCompareVideoPath, "Invalid compare video path"),
  category: z.enum(["compare", "render", "reference"]),
  layout: z.enum(["hstack", "vstack", "single"]),
  startSec: z.number().finite().nonnegative().optional(),
});

const NoteIn = z.object({
  note: z.looseObject({
    id: z.string().regex(/^[a-z0-9]+$/),
    t: z.number().refine(Number.isFinite),
    text: z.string(),
    staleBuild: z.boolean().optional(),
    compareVideo: NoteCompareVideo.optional(),
  }),
  img: jpeg,
  crop: jpeg,
  strip: jpeg,
  frames: z
    .array(z.object({ t: z.number().refine(Number.isFinite), img: jpeg }))
    .max(8)
    .optional(),
  refs: z.array(z.string().startsWith("data:image/jpeg;base64,/9j/")).max(6).optional(),
});

const NoteChange = z.object({
  text: z.string().optional(),
  remove: z.boolean().optional(),
  restore: z.boolean().optional(),
  done: z.boolean().optional(),
  fix: z
    .looseObject({
      what: z.string(),
      ask: z.boolean().optional(),
      after: z.string().optional(),
      afterData: z.string().optional(),
      noAfterReason: z.string().optional(),
      t: z.number().finite().nonnegative().optional(),
      cam: z.looseObject({}).optional(),
    })
    .optional(),
  approve: z.literal(true).optional(),
  again: z.string().optional(),
  remember: z.enum(["film", "all"]).nullable().optional(),
  learned: z.object({ what: z.string() }).optional(),
});

const readJsonSafe = (file) => {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const FILM_META_CACHE_MAX = 32;
const filmMetaCache = new Map();

const fileStamp = (file) => {
  if (!file) return "none";
  try {
    const st = statSync(file, { throwIfNoEntry: false });
    return st?.isFile() ? `${st.size}:${st.mtimeMs}:${st.ctimeMs}` : "missing";
  } catch {
    return "missing";
  }
};

export const readLiteFilmMeta = (projectDir, port = null) => {
  const root = resolve(projectDir);
  const pkgPath = join(root, "package.json");
  const editPath = join(root, "src/edit.json");
  const pkgStamp = fileStamp(pkgPath);
  const editStamp = fileStamp(editPath);
  const cacheKey = `${root}\0${port ?? ""}`;
  const cached = filmMetaCache.get(cacheKey);
  if (
    cached &&
    cached.pkgStamp === pkgStamp &&
    cached.editStamp === editStamp &&
    fileStamp(cached.shotsPath) === cached.shotsStamp &&
    fileStamp(cached.timingPath) === cached.timingStamp
  ) {
    return cached.meta;
  }

  const pkg = readJsonSafe(pkgPath) ?? {};
  const conf = pkg["live-studio"] ?? {};
  const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name : basename(root);
  const ratio = ratioOf(pkg);
  const edit = readJsonSafe(editPath);
  const shotsPath =
    typeof conf.shotsTimeline === "string" && conf.shotsTimeline
      ? join(root, conf.shotsTimeline)
      : null;
  const timingPath =
    typeof conf.timingTimeline === "string" && conf.timingTimeline
      ? join(root, conf.timingTimeline)
      : null;
  const rawShots = shotsPath ? readJsonSafe(shotsPath) : null;
  const timing = timingPath ? (readJsonSafe(timingPath) ?? {}) : {};
  const voiceWarp = Array.isArray(edit?.voice?.warp) ? edit.voice.warp : [];
  const hasEnd = typeof edit?.end === "number" && Number.isFinite(edit.end) && edit.end > 0;
  let duration = 0;
  let clock = null;
  if (hasEnd) {
    try {
      const sourceDuration = warp(voiceWarp, edit.end, 0, 1);
      clock = compileTiming(timing, sourceDuration);
      duration =
        Number.isFinite(clock.duration) && clock.duration > 0 ? +clock.duration.toFixed(3) : 0;
    } catch {
      duration = +edit.end.toFixed(3);
    }
  }
  const shots = Array.isArray(rawShots)
    ? rawShots
        .filter((s) => Number.isFinite(s?.t))
        .map((s) => {
          const sceneT = warp(voiceWarp, s.t, 0, 1);
          const heardT = clock ? clock.outputAt(sceneT, "after") : sceneT;
          return {
            t: +heardT.toFixed(3),
            name: typeof s.name === "string" ? s.name : "",
          };
        })
    : [];
  const meta = {
    name,
    ratio,
    project: root,
    port: port ?? null,
    lite: true,
    duration,
    shots: shots.length ? shots : [{ t: 0, name: "" }],
  };
  if (filmMetaCache.size >= FILM_META_CACHE_MAX && !filmMetaCache.has(cacheKey)) {
    filmMetaCache.delete(filmMetaCache.keys().next().value);
  }
  filmMetaCache.set(cacheKey, {
    pkgStamp,
    editStamp,
    shotsPath,
    shotsStamp: fileStamp(shotsPath),
    timingPath,
    timingStamp: fileStamp(timingPath),
    meta,
  });
  return meta;
};

const videoBody = (file, range) => {
  if (typeof Bun !== "undefined") {
    const bunFile = Bun.file(file);
    return range ? bunFile.slice(range.start, range.end + 1) : bunFile;
  }
  return Readable.toWeb(createReadStream(file, range));
};

const sendVideoFile = (c, file, { download = false } = {}) => {
  const { size, mtimeMs } = statSync(file);
  const ext = extname(file).toLowerCase();
  const safeName = basename(file).replace(/[^A-Za-z0-9._-]/g, "_");
  const headers = new Headers({
    "content-type": VIDEO_MIME[ext] ?? "application/octet-stream",
    "content-disposition": download ? `attachment; filename="${safeName}"` : "inline",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  });

  const rawTag = `${size}-${Math.round(mtimeMs)}`;
  const tag = `"${rawTag}"`;
  const head = c.req.method === "HEAD";
  const ifRange = c.req.header("if-range");
  const range = !head && (!ifRange || ifRange === tag) ? c.req.header("range") : undefined;

  if (c.req.query("v") === rawTag) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  } else {
    headers.set("etag", tag);
    headers.set("cache-control", "no-cache");
    if (c.req.header("if-none-match") === tag) return new Response(null, { status: 304, headers });
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec((range ?? "").trim());
  if (m && (m[1] || m[2])) {
    let a;
    let b;
    if (!m[1] && m[2]) {
      const suffix = Number(m[2]);
      if (!Number.isFinite(suffix) || suffix <= 0 || size <= 0) {
        headers.set("content-range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      a = Math.max(0, size - suffix);
      b = size - 1;
    } else {
      a = Number(m[1]);
      b = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    }
    if (a > b || a < 0 || b >= size) {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("content-range", `bytes ${a}-${b}/${size}`);
    headers.set("content-length", String(b - a + 1));
    return new Response(videoBody(file, { start: a, end: b }), { status: 206, headers });
  }

  headers.set("content-length", String(size));
  return new Response(head ? null : videoBody(file), { status: 200, headers });
};

export const createLiteApi = ({
  projectDir,
  page,
  port = null,
  notes = createNotes(projectDir),
}) => {
  const root = resolve(projectDir);
  const app = new Hono();

  const fresh = (c, data) => {
    c.header("cache-control", "no-store");
    return c.json(data);
  };

  app.get("/", (c) => {
    c.header("cache-control", "no-cache");
    const built = page.html();
    if (!built) {
      return c.html(
        html`<!doctype html><meta charset="utf-8" /><title>Live Studio Lite</title>
          <pre style="white-space:pre-wrap">
Live Studio Lite could not be built yet.<br><br>${page.error() ?? ""}</pre>`,
        503,
      );
    }
    const bootJson = JSON.stringify({ film: readLiteFilmMeta(root, port) }).replace(
      /</g,
      "\\u003c",
    );
    const boot = `<script>window.__LITE_BOOT=${bootJson};</script>`;
    return c.html(
      built.includes('<script type="module"')
        ? built.replace('<script type="module"', () => `${boot}<script type="module"`)
        : built.replace("</head>", () => `${boot}</head>`),
    );
  });

  app.get(
    "/_lite/*",
    serveStatic({
      root: page.dir,
      precompressed: true,
      onFound: (_, c) => c.header("cache-control", "public, max-age=31536000, immutable"),
    }),
  );

  app.get("/api/film.json", (c) => fresh(c, readLiteFilmMeta(root, port)));

  app.get("/api/compare-videos", (c) => {
    const catalog = listCompareVideos(root);
    return fresh(c, { ...catalog, defaultPath: pickDefaultLiteVideo(catalog.videos) });
  });

  app.get("/api/compare-videos/probe", async (c) => {
    const probed = await probeCompareVideo(root, c.req.query("path"));
    if (!probed.ok) return c.json({ error: probed.error }, probed.status);
    const { ok: _ok, ...meta } = probed;
    return fresh(c, meta);
  });

  app.get("/api/compare-videos/file", (c) => {
    const resolved = resolveCompareVideoFile(root, c.req.query("path"));
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const download = c.req.query("download") === "1";
    try {
      return sendVideoFile(c, resolved.file, { download });
    } catch (err) {
      if (err?.code === "ENOENT") return c.json({ error: "Video file not found" }, 404);
      throw err;
    }
  });

  const notesPostBodyLimit = bodyLimit({
    maxSize: 24 * 1024 * 1024,
    onError: (c) => c.json({ error: "Payload exceeds 24 MB limit" }, 413),
  });
  app.on("POST", ["/api/notes", "/api/notes/*", "/notes/*"], notesPostBodyLimit);

  app.get("/api/notes", (c) => {
    const nums = {};
    for (const [id, v] of noteNumbers(root)) if (!v.gone) nums[id] = v.n;
    c.header("x-note-numbers", JSON.stringify(nums));
    return fresh(c, notes.read());
  });

  app.post("/api/notes", zValidator("json", NoteIn), async (c) => {
    notes.add(c.req.valid("json"), { version: await filmVersionAsync(root) });
    return c.text("ok");
  });

  app.on(
    "POST",
    ["/api/notes/:id{[a-z0-9]+}", "/notes/:id{[a-z0-9]+}"],
    zValidator("json", NoteChange),
    (c) => {
      const r = notes.change(c.req.param("id"), c.req.valid("json"));
      if (!r.ok) return c.text(r.why, 409);
      return c.text("ok");
    },
  );

  app.get(
    "/api/note-img/:name{[a-z0-9]+(_crop|_strip|_f\\d+|_r\\d+|_fix\\d+)?\\.(jpg|jpeg|png|webp)}",
    (c) => {
      const name = c.req.param("name");
      const pic = notes.picture(name);
      if (!pic) return c.body(null, 404);
      const ext = name.split(".").pop();
      c.header(
        "content-type",
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
      );
      c.header("cache-control", "max-age=31536000, immutable");
      return c.body(pic);
    },
  );

  app.onError((e, c) => {
    console.log(`${c.req.method} ${c.req.path}: ${e.message}`);
    return e instanceof HTTPException ? e.getResponse() : c.body(null, 500);
  });

  return app;
};
