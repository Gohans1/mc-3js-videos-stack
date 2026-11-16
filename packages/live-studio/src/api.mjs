import { createHash } from "node:crypto";
// What the studio page asks the server for, as one Hono app: the built page (src/page.mjs) at / and /_studio/, its data and
// live events under /api/, and everything else from the film's own files (assets/public as /, small phone copies as /lite/).
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConsts, gzip } from "node:zlib";

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { html } from "hono/html";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import * as z from "zod";

import { Activity, createActivity } from "./activity.mjs";
import { SoundProcess, SoundTimeline } from "./contract.ts";
import { FavoriteChange, openFavorites } from "./favorites.mjs";
import { RATIOS } from "./frame.ts";
import { LutUpload, openGrades, PresetUpload } from "./grades.mjs";
import { openLessonFiles } from "./lesson-files.mjs";
import { noteNumbers } from "./notes.mjs";
import { createPortsService } from "./ports.mjs";
import { openVoiceLibrary } from "./voice-library.mjs";
import { weighFirstVisit } from "./weight.mjs";

const MIME = {
  ".gltf": "application/json",
  ".glb": "model/gltf-binary",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".bin": "application/octet-stream",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".mp4": "video/mp4",
  ".jar": "application/java-archive",
};
// The page sends null for a picture it could not make (no pin, no crop): the words still count
const jpeg = z.string().startsWith("data:image/jpeg;base64,/9j/").nullish();
const NoteIn = z.object({
  note: z.looseObject({
    id: z.string().regex(/^[a-z0-9]+$/),
    t: z.number().refine(Number.isFinite),
    text: z.string(),
  }),
  img: jpeg,
  crop: jpeg,
  strip: jpeg,
  // A drawn note spans moments: one picture per moment it was drawn at, with what was drawn there
  frames: z
    .array(z.object({ t: z.number().refine(Number.isFinite), img: jpeg }))
    .max(8)
    .optional(),
  // pictures the creator pasted beside the words (a reference, a screenshot), drawn on or not
  refs: z.array(z.string().startsWith("data:image/jpeg;base64,/9j/")).max(6).optional(),
});
const LessonSave = z.object({
  path: z.string().max(200),
  text: z.string().max(1_000_000),
  base: z.string().nullable(),
});
const LessonDelete = z.object({
  path: z.string().max(200),
  base: z.string().nullable(),
});
// note-state.mjs says which of these may happen to a note now; {remove}/{restore} are the file's own
const NoteChange = z.object({
  text: z.string().optional(),
  remove: z.boolean().optional(),
  restore: z.boolean().optional(),
  done: z.boolean().optional(),
  fix: z.looseObject({ what: z.string(), ask: z.boolean().optional() }).optional(),
  approve: z.literal(true).optional(),
  again: z.string().optional(),
  remember: z.enum(["film", "all"]).nullable().optional(),
  learned: z.object({ what: z.string() }).optional(),
});
const Choose = z.object({ group: z.string().min(1), set: z.string(), gain: z.number().optional() });
const FilmChange = z.object({ ratio: z.enum(RATIOS) });
const PageProblems = z.object({ problems: z.array(z.string()) });
const SoundSave = z.object({ base: z.string(), data: z.looseObject({}) });
const SoundMeasure = z.object({
  list: z.enum(["beds", "sfx"]),
  i: z.number().int().nonnegative(),
  data: SoundTimeline,
});
const CamSave = z.object({ base: z.string(), data: z.array(z.looseObject({})) });
const ShotsSave = CamSave;
const TextSave = SoundSave;
const TogetherSave = z.object({
  files: z
    .array(z.object({ name: z.string(), base: z.string(), data: z.unknown() }))
    .min(2)
    .refine((fs) => new Set(fs.map((f) => f.name)).size === fs.length, "each file once"),
});
const KeySave = z.object({
  base: z.string(),
  data: z.union([z.looseObject({}), z.array(z.unknown())]),
});
const PageWeight = z.object({
  files: z
    .array(z.object({ path: z.string().max(1000), bytes: z.number().nonnegative() }))
    .max(5000),
});
const VoiceUseTry = z.object({
  takeId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  tryFile: z.string().regex(/^[A-Za-z0-9_-]{1,120}\.(mp3|wav)$/),
});

// Formats that are compressed inside already: trying them again only costs time on a first visit
const PACKED = /\.(png|jpe?g|webp|avif|gif|webm|mp3|mp4|m4a|ogg|opus|flac|woff2|ktx2)$/i;
const PACK_MAX = 16 * 1024 * 1024; // bigger is held in memory per version: slim it in the film instead
const inside = (root, file) => {
  const r = relative(root, file);
  return r && !r.startsWith("..") && !isAbsolute(r);
};

// activity: src/activity.mjs's, what the AI is doing; lessons: src/lesson-files.mjs's, the one live.mjs watches
export const createApi = (
  film,
  {
    page,
    events,
    send,
    activity = createActivity(send),
    lessons = openLessonFiles(),
    voiceLibrary = openVoiceLibrary({
      project: film?.PROJECT,
      autoSync: false,
      onEvent: () => send("voice-library"),
    }),
    favorites = openFavorites(),
    port = null,
    ports = null,
  },
) => {
  const portsService = ports ?? createPortsService({ repoRoot: film?.PROJECT, selfPort: port });
  // Text and geometry shrink a lot and pictures don't. Squeezed once per version, so the next visit costs nothing here either;
  // what barely shrinks (a zip of pictures) is remembered as not worth it and goes out as it is
  // Off the main thread (a few MB takes a second), and kept as the promise so a second visit meanwhile waits for the same work
  const packed = new Map(),
    toBr = promisify(brotliCompress),
    toGzip = promisify(gzip);
  let voiceCache = null;
  const pickEncoding = (raw) => {
    let hasGzip = false;
    for (const part of String(raw ?? "")
      .toLowerCase()
      .split(",")) {
      const [nameRaw, ...params] = part.trim().split(";");
      const name = nameRaw?.trim();
      if (name !== "br" && name !== "gzip") continue;
      if (params.some((p) => /^q\s*=\s*0+(?:\.0*)?$/.test(p.trim()))) continue;
      if (name === "br") return "br";
      hasGzip = true;
    }
    return hasGzip ? "gzip" : "";
  };
  const squeeze = async (c, buf, tag, memoize = true) => {
    const how = pickEncoding(c.req.header("accept-encoding"));
    c.header("vary", "accept-encoding");
    if (!how) return buf;
    const brQuality = memoize ? (buf.length > 262_144 ? 5 : 9) : 4;
    const compress = () =>
      (how === "br"
        ? toBr(buf, { params: { [zlibConsts.BROTLI_PARAM_QUALITY]: brQuality } })
        : toGzip(buf)
      ).then((small) => (small.length < buf.length * 0.9 ? small : null));
    let small;
    if (memoize) {
      const key = how + tag;
      if (!packed.has(key)) {
        if (packed.size >= 400) packed.delete(packed.keys().next().value);
        packed.set(
          key,
          compress().catch((err) => {
            packed.delete(key);
            throw err;
          }),
        );
      }
      small = await packed.get(key);
    } else {
      small = await compress();
    }
    if (!small) return buf;
    c.header("content-encoding", how);
    return small;
  };
  // Track served versioned URLs so '/' can hand the browser current ?v= stamps with zero 304 roundtrips
  const servedTags = new Map();
  const currentSoundVersion = () => film.sound?.read?.()?.version ?? null;
  const statMeta = (p) => {
    try {
      const st = statSync(p);
      return { size: st.size, mtimeMs: Math.round(st.mtimeMs) };
    } catch {
      return null;
    }
  };
  const recordTag = (
    reqPath,
    tag,
    { file = null, isFileTag = false, onSound = false, sfxName = null, sourceFile = null } = {},
  ) => {
    if (!reqPath) return;
    const st = file ? statMeta(file) : null;
    if (file && !st) return;
    const resolvedSource = sourceFile ?? (sfxName ? (film.sound?.fileOf?.(sfxName) ?? null) : null);
    const sourceSt = resolvedSource ? statMeta(resolvedSource) : null;
    if (servedTags.size >= 400 && !servedTags.has(reqPath))
      servedTags.delete(servedTags.keys().next().value);
    servedTags.set(reqPath, {
      tag,
      file,
      isFileTag,
      size: st?.size ?? null,
      mtimeMs: st?.mtimeMs ?? null,
      sfxName,
      sourceFile: resolvedSource,
      sourceSize: sourceSt?.size ?? null,
      sourceMtimeMs: sourceSt?.mtimeMs ?? null,
      soundVer: onSound ? currentSoundVersion() : undefined,
    });
  };
  const currentTags = () => {
    const out = {},
      soundVer = currentSoundVersion();
    for (const [reqPath, entry] of servedTags) {
      if (entry.soundVer !== undefined && entry.soundVer !== soundVer) {
        servedTags.delete(reqPath);
        continue;
      }
      if (entry.sfxName) {
        const curSource = film.sound?.fileOf?.(entry.sfxName) ?? null;
        if (curSource !== entry.sourceFile) {
          servedTags.delete(reqPath);
          continue;
        }
      }
      if (entry.sourceFile && entry.sourceFile !== entry.file) {
        const cst = statMeta(entry.sourceFile);
        if (!cst || cst.size !== entry.sourceSize || cst.mtimeMs !== entry.sourceMtimeMs) {
          servedTags.delete(reqPath);
          continue;
        }
      }
      if (entry.file) {
        const st = statMeta(entry.file);
        if (!st) {
          servedTags.delete(reqPath);
          continue;
        }
        if (st.size !== entry.size || st.mtimeMs !== entry.mtimeMs) {
          if (entry.isFileTag) {
            entry.size = st.size;
            entry.mtimeMs = st.mtimeMs;
            entry.tag = `${st.size}-${st.mtimeMs}`;
          } else {
            servedTags.delete(reqPath);
            continue;
          }
        }
      }
      out[reqPath] = entry.tag;
    }
    return out;
  };
  const filmMeta = () => ({
    name: film.NAME,
    ratio: film.ratio(),
    video: Boolean(film.videoSource?.()),
    project: film?.PROJECT ?? null,
    port: port ?? null,
    has: film.features?.() ?? {
      cam: !!film.cam,
      shots: !!film.shots,
      text: !!film.text,
      adjustment: !!film.adjustment,
      timing: !!film.timing,
      keys: (film.keyFiles?.length ?? 0) > 0,
      sound: !!film.sound,
      voice: !!film.voice,
      voiceMap: film.VOICE_MAP ? existsSync(film.VOICE_MAP) : false,
      trials: true,
      choices: true,
      mix: film.MIX ? existsSync(film.MIX) : false,
    },
  });

  // Unchanged means no download, and asking costs a few bytes
  const text = async (c, buf, type = "application/json", knownTag, tagOpts) => {
    const tag = knownTag ?? `"${createHash("md5").update(buf).digest("base64url")}"`;
    const rawTag = tag.slice(1, -1);
    if (tagOpts) recordTag(tagOpts.path ?? c.req.path, rawTag, tagOpts);
    if (c.req.query("v") === rawTag) {
      c.header("cache-control", "public, max-age=31536000, immutable");
    } else {
      c.header("etag", tag);
      c.header("cache-control", "no-cache");
      if (c.req.header("if-none-match") === tag) return c.body(null, 304);
    }
    c.header("content-type", type);
    return c.body(await squeeze(c, buf, tag));
  };
  const fresh = (c, data) => {
    c.header("cache-control", "no-store");
    return c.json(data);
  };
  const safeErr = (e, fallback = "Audio processing failed") =>
    String(e?.message || fallback)
      .replace(
        /[A-Za-z]:[\\/][^\s"']+|\/(?:Users|home|tmp|var|etc|private|mnt)[\\/][^\s"']+/g,
        "<path>",
      )
      .slice(0, 240);
  const fileOrMissing = (c, file) =>
    existsSync(file)
      ? text(c, readFileSync(file), "application/json", undefined, {
          path: c.req.path,
          file,
          onSound: true,
        })
      : c.body(null, 404);

  // A film file, with byte ranges (seeking in the sound needs them) and an etag so a reload on a phone fetches nothing again
  const sendFile = async (
    c,
    file,
    { store = false, pack = false, onSound = false, sfxName = null, sourceFile = null } = {},
  ) => {
    const { size, mtimeMs } = statSync(file);
    c.header("content-type", MIME[extname(file)] ?? "application/octet-stream");
    c.header("accept-ranges", "bytes");
    const range = c.req.header("range");
    const rawTag = `${size}-${Math.round(mtimeMs)}`;
    const tag = `"${rawTag}"`;
    recordTag(c.req.path, rawTag, { file, isFileTag: true, onSound, sfxName, sourceFile });
    if (c.req.query("v") === rawTag) {
      c.header("cache-control", "public, max-age=31536000, immutable");
    } else if (store) {
      c.header("cache-control", "no-store");
    } else {
      c.header("etag", tag);
      c.header("cache-control", "no-cache"); // a re-made copy shows up at once
      if (c.req.header("if-none-match") === tag && !range) return c.body(null, 304);
    }
    if (!store) {
      // A copy squeezed once at its best (scripts/mc/slim_jar.mjs writes one for the Minecraft jar): too big to squeeze per
      // request, and it shrinks most when squeezed whole. Only while it is newer than the file it copies
      const br = `${file}.br`;
      if (!range && /\bbr\b/.test(c.req.header("accept-encoding") ?? "") && existsSync(br)) {
        const copy = statSync(br);
        c.header("vary", "accept-encoding");
        if (copy.mtimeMs >= mtimeMs) {
          c.header("content-encoding", "br");
          c.header("content-length", String(copy.size));
          return c.body(Readable.toWeb(film.openRead(br)));
        }
      }
      if (pack && !range && size <= PACK_MAX)
        return c.body(await squeeze(c, readFileSync(file), tag));
    }
    const m = /bytes=(\d*)-(\d*)/.exec(range ?? "");
    if (m) {
      const a = m[1] ? +m[1] : 0,
        b = m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (a > b) {
        c.header("content-range", `bytes */${size}`);
        return c.body(null, 416);
      } // a page still reading past the end of a mix that got shorter
      c.header("content-range", `bytes ${a}-${b}/${size}`);
      c.header("content-length", String(b - a + 1));
      return c.body(Readable.toWeb(film.openRead(file, { start: a, end: b })), 206);
    }
    c.header("content-length", String(size));
    return c.body(Readable.toWeb(film.openRead(file)));
  };

  const app = new Hono();

  // The page names the build it came from, so after the studio restarts it can tell whether it is still the current one
  let lastBuiltHtml = null,
    lastBuildTag = "";
  const build = () => {
    const src = page.html() ?? "";
    if (src !== lastBuiltHtml) {
      lastBuiltHtml = src;
      lastBuildTag = createHash("md5").update(src).digest("base64url");
    }
    return lastBuildTag;
  };
  app.get("/", (c) => {
    c.header("cache-control", "no-cache");
    const built = page.html();
    // No page yet: the first build failed. Shown until a save fixes it
    if (!built)
      return c.html(
        html`<!doctype html><meta charset="utf-8" /><meta http-equiv="refresh" content="3" /><title>
            Studio
          </title>
          <pre
            style="white-space:pre-wrap"
          >The film's code has an error, so the page can't be built yet. It reloads once it's fixed.<br><br>${page.error() ?? ""}</pre>`,
        503,
      );
    const bootJson = JSON.stringify({
      film: filmMeta(),
      contract: film.contract?.() ?? { files: [] },
      hasPageProblems: film.hasPageProblems?.() ?? false,
      tags: currentTags(),
    }).replace(/</g, "\\u003c");
    const headScript = `<meta name="live-build" content="${build()}"><script>window.__STUDIO_BOOT=${bootJson};(()=>{const b=window.__STUDIO_BOOT,h=b.film&&b.film.has,t=b.tags||{},p=window.__PREFETCH={};const f=(u)=>{p[u]=fetch(!u.includes("?")&&t[u]?u+"?v="+t[u]:u).then((r)=>(r.ok||r.status===404)?r:null,()=>null)};for(const u of["/api/shots.json","/api/notes","/api/favorites","/api/activity"])f(u);if(h)for(const[k,u]of[["timing","/api/timing"],["shots","/api/shots"],["voiceMap","/api/voice_map.json"],["voice","/api/voice"],["cam","/api/cam"],["keys","/api/keys"],["text","/api/text"],["adjustment","/api/adjustment"],["sound","/api/sound?used=1"],["trials","/api/trials.json"],["choices","/api/choices.json"]])if(h[k])f(u)})();</script>`;
    return c.html(
      built.includes('<script type="module"')
        ? built.replace('<script type="module"', `${headScript}<script type="module"`)
        : built.replace("</head>", `${headScript}</head>`),
    );
  });
  app.get(
    "/_studio/*",
    serveStatic({
      root: page.dir,
      precompressed: true,
      onFound: (_, c) => c.header("cache-control", "public, max-age=31536000, immutable"),
    }),
  );

  // Saves and jobs, as they happen (see send in live.mjs). A browser reconnects to this by itself, without reloading the page
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      // Hono tells only the listeners it already has when a page leaves, so listen before the first write can wait on it
      const gone = new Promise((done) => {
        stream.onAbort(done);
        if (stream.aborted) done();
      });
      events.add(stream);
      await stream.writeSSE({ event: "hello", data: build() });
      const alive = setInterval(() => stream.write(": alive\n\n"), 25e3); // a proxy drops a line that stays quiet
      await gone;
      clearInterval(alive);
      events.delete(stream);
    }),
  );
  // The films' own scripts still call two paths from before /api/: checkpoint.py marks notes done at /notes/:id, and
  // publish_pages.py reads /edit.json
  app.on("POST", ["/api/*", "/notes/*"], bodyLimit({ maxSize: 20 * 1024 * 1024 }));

  app.get("/api/notes", (c) => {
    const dir = film.dir ?? film.PROJECT;
    if (dir) {
      const nums = {};
      for (const [id, v] of noteNumbers(dir)) if (!v.gone) nums[id] = v.n;
      c.header("x-note-numbers", JSON.stringify(nums));
    }
    return fresh(c, film.notes.read());
  });
  app.post("/api/notes", zValidator("json", NoteIn), async (c) => {
    film.notes.add(c.req.valid("json"), await film.stamp());
    film.syncNotes?.();
    send("notes");
    return c.text("ok");
  });
  app.on(
    "POST",
    ["/api/notes/:id{[a-z0-9]+}", "/notes/:id{[a-z0-9]+}"],
    zValidator("json", NoteChange),
    (c) => {
      const r = film.notes.change(c.req.param("id"), c.req.valid("json"));
      if (!r.ok) return c.text(r.why, 409);
      film.syncNotes?.();
      send("notes");
      return c.text("ok");
    },
  );
  app.get("/api/note-img/:name{[a-z0-9]+(_crop|_strip|_f\\d|_r\\d)?\\.jpg}", (c) => {
    const pic = film.notes.picture(c.req.param("name").slice(0, -4));
    if (!pic) return c.body(null, 404);
    c.header("content-type", "image/jpeg");
    c.header("cache-control", "max-age=31536000, immutable");
    return c.body(pic);
  });

  // What the AI is doing (src/activity.mjs): a line from each of the film's commands (src/tell.mjs), the latest for a new page
  app.get("/api/activity", (c) => fresh(c, activity.state()));
  app.post("/api/activity", zValidator("json", Activity), (c) => {
    activity.add(c.req.valid("json"));
    return c.text("ok");
  });

  // The repo's lessons/*.md, every film's, for the creator to read and edit (src/lesson-files.mjs): 409 is the AI's newer words
  app.get("/api/lessons", (c) =>
    fresh(c, { dir: lessons.dir.replaceAll("\\", "/"), files: lessons.list() }),
  );
  app.post("/api/lessons", zValidator("json", LessonSave), (c) => {
    const { path, text, base } = c.req.valid("json"),
      r = lessons.write(path, text, base);
    return c.json(r, r.error ? 400 : r.conflict ? 409 : 200);
  });
  app.delete("/api/lessons", zValidator("json", LessonDelete), (c) => {
    const { path, base } = c.req.valid("json"),
      r = lessons.remove(path, base);
    return c.json(r, r.error ? 400 : r.conflict ? 409 : 200);
  });

  app.on("GET", ["/api/edit.json", "/edit.json"], (c) => text(c, readFileSync(film.EDIT)));
  app.get("/api/voice_map.json", (c) => fileOrMissing(c, film.VOICE_MAP));
  app.get("/api/voice", (c) => (film.voice ? fresh(c, film.voice.read()) : c.body(null, 404)));
  app.get("/api/voice/audio/:kind/:file", (c) => {
    const f = film.voice?.audioFile(c.req.param("kind"), c.req.param("file"));
    return f ? sendFile(c, f, { onSound: true }) : c.body(null, 404);
  });
  app.post("/api/voice/use-try", zValidator("json", VoiceUseTry), async (c) => {
    if (!film.voice) return c.body(null, 404);
    const r = await film.voice.useTry(c.req.valid("json"));
    if (r.error) return c.json({ error: r.error }, r.status ?? 400);
    send("voice");
    return fresh(c, r);
  });
  app.get("/api/voice/library", async (c) => {
    const metaOnly = c.req.query("meta") === "1";
    if (!metaOnly) voiceLibrary.ensureWarm();
    const st = voiceLibrary.state();
    if (metaOnly) return fresh(c, st);
    const json = voiceLibrary.payloadJson();
    if (st.status === "ready") {
      if (!voiceCache || voiceCache.json !== json) {
        if (voiceCache) {
          packed.delete(`br${voiceCache.tag}`);
          packed.delete(`gzip${voiceCache.tag}`);
        }
        const buf = Buffer.from(json);
        const tag = `"${createHash("md5").update(buf).digest("base64url")}"`;
        voiceCache = { json, buf, tag };
      }
      return text(c, voiceCache.buf, "application/json", voiceCache.tag);
    }
    c.header("cache-control", "no-store");
    c.header("content-type", "application/json; charset=utf-8");
    return c.body(await squeeze(c, Buffer.from(json), null, false));
  });
  app.post("/api/voice/library/sync", (c) => {
    if (!voiceLibrary.hasKey()) {
      return c.json({ error: "Missing GENVOICE_API_KEY (or ELEVENLABS_API_KEY) on server" }, 400);
    }
    voiceLibrary.sync().catch(() => {
      // Failure state is captured in voiceLibrary.state() and broadcast over SSE
    });
    return c.json({ started: true, ...voiceLibrary.state() }, 202);
  });
  app.get("/api/shots.json", (c) => text(c, Buffer.from(JSON.stringify(film.shotComments()))));
  app.get("/api/trials.json", (c) => {
    const t = film.trials();
    return t ? text(c, Buffer.from(JSON.stringify(t))) : c.body(null, 404);
  });
  app.get("/api/choices.json", (c) => text(c, Buffer.from(JSON.stringify(film.readChoices()))));
  app.post("/api/choose", zValidator("json", Choose), (c) =>
    film.choose(c.req.valid("json")) ? c.text("ok") : c.body(null, 400),
  );
  app.get("/api/contract.json", (c) => fresh(c, film.contract()));
  // The film's frame shape (frame.ts), which the page needs before it builds the scene; Settings change it
  app.get("/api/film.json", (c) => fresh(c, filmMeta()));
  app.get("/api/ports", async (c) => {
    const refresh = c.req.query("refresh");
    const forceRefresh = refresh === "1" || refresh === "true";
    try {
      return fresh(c, await portsService.getSnapshot({ currentPort: port, forceRefresh }));
    } catch (e) {
      c.header("cache-control", "no-store");
      return c.json({ error: safeErr(e, "Failed to scan studio ports") }, 500);
    }
  });
  app.post("/api/film", zValidator("json", FilmChange), (c) => {
    film.setRatio(c.req.valid("json").ratio);
    return c.text("ok");
  });
  app.post("/api/contract", zValidator("json", PageProblems), (c) => {
    film.pageSays(c.req.valid("json").problems);
    return c.text("ok");
  });

  // The creator's stars, kept for every film (src/favorites.mjs); every open page of this studio hears a change
  app.get("/api/favorites", (c) => fresh(c, favorites.shown()));
  app.post("/api/favorites", zValidator("json", FavoriteChange), (c) => {
    const all = favorites.set(c.req.valid("json"));
    send("favorites");
    return c.json(all);
  });

  const grades = openGrades(film.PUBLIC);
  const gradeResult = (c, fn) => {
    try {
      return c.json(fn());
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  };
  app.get("/api/adjust", (c) => gradeResult(c, grades.list));
  app.post("/api/adjust/lut", zValidator("json", LutUpload), (c) =>
    gradeResult(c, () => grades.addLut(c.req.valid("json"))),
  );
  app.post("/api/adjust/preset", zValidator("json", PresetUpload), (c) =>
    gradeResult(c, () => {
      const { name, grade } = c.req.valid("json");
      return grades.savePreset(name, grade);
    }),
  );
  app.post("/api/adjust/preset/:id/apply", (c) =>
    gradeResult(c, () => grades.applyPreset(c.req.param("id"))),
  );

  let weighed = null; // the heavy files last named, so each reload doesn't say it again
  app.post("/api/weight", zValidator("json", PageWeight), (c) => {
    const heavy = weighFirstVisit(c.req.valid("json").files);
    if ((heavy?.names ?? null) !== weighed) {
      console.log(
        heavy ? heavy.text : "a first visit from a phone or over Tailscale is back under budget",
      );
      weighed = heavy?.names ?? null;
    }
    return c.text("ok");
  });

  // The sound lanes, when the film names them (src/sound.mjs). A save names the version it was made on: 409 means the file
  // changed meanwhile (an agent fixing a note), and the page loads that one instead of writing over it
  const noSound = (c) => c.body(null, 404);
  let soundCache = null;
  let soundUsedCache = null;
  let soundLibCache = null;
  const usedSoundLibrary = (data, lib) => {
    const names = new Set();
    if (data?.narration) names.add(data.narration);
    for (const list of [data?.beds, data?.sfx]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item?.name) names.add(item.name);
        if (item?.beatSource) names.add(item.beatSource);
        if (Array.isArray(item?.try)) for (const alt of item.try) names.add(alt);
      }
    }
    const families = new Set();
    for (const item of lib) {
      if (names.has(item.name) && item.family) families.add(item.family);
    }
    return lib.filter(
      (item) =>
        names.has(item.name) ||
        (item.family && families.has(item.family)) ||
        !item.source ||
        item.source === "film" ||
        Boolean(item.role),
    );
  };
  app.get("/api/sound", (c) => {
    const s = film.sound?.read();
    if (!s) return noSound(c);
    const live = film.liveLanes();
    if (c.req.query("lanes") === "1") {
      return text(c, Buffer.from(JSON.stringify({ ...s, live })));
    }
    const library = film.sound.library();
    if (c.req.query("library") === "1") {
      if (soundLibCache?.library !== library) {
        const buf = Buffer.from(JSON.stringify({ library }));
        soundLibCache = {
          library,
          buf,
          etag: `"${createHash("md5").update(buf).digest("base64url")}"`,
        };
      }
      return text(c, soundLibCache.buf, "application/json", soundLibCache.etag);
    }
    if (c.req.query("used") === "1") {
      if (
        soundUsedCache?.version !== s.version ||
        soundUsedCache.live !== live ||
        soundUsedCache.library !== library
      ) {
        const buf = Buffer.from(
          JSON.stringify({ ...s, library: usedSoundLibrary(s.data, library), live }),
        );
        soundUsedCache = {
          version: s.version,
          live,
          library,
          buf,
          etag: `"${createHash("md5").update(buf).digest("base64url")}"`,
        };
      }
      return text(c, soundUsedCache.buf, "application/json", soundUsedCache.etag);
    }
    if (
      soundCache?.version !== s.version ||
      soundCache.live !== live ||
      soundCache.library !== library
    ) {
      const buf = Buffer.from(JSON.stringify({ ...s, library, live }));
      soundCache = {
        version: s.version,
        live,
        library,
        buf,
        etag: `"${createHash("md5").update(buf).digest("base64url")}"`,
      };
    }
    return text(c, soundCache.buf, "application/json", soundCache.etag);
  });
  app.post("/api/sound", zValidator("json", SoundSave), (c) => {
    if (!film.sound) return noSound(c);
    const { base, data } = c.req.valid("json"),
      r = film.sound.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  app.post("/api/sound/measure", zValidator("json", SoundMeasure), async (c) => {
    if (!film.sound) return noSound(c);
    const { list, i, data } = c.req.valid("json"),
      clip = data[list][i],
      names = clip ? [clip.name, ...(clip.try ?? [])] : [];
    if (!clip || !names.every((n) => film.sound.fileOf(n)))
      return c.json({ error: "This sound file is unavailable" }, 404);
    try {
      return c.json(await film.measureSound(list, i, data));
    } catch (e) {
      return c.json({ error: safeErr(e) }, 422);
    }
  });
  app.post("/api/sound/process", zValidator("json", SoundProcess), async (c) => {
    const settings = c.req.valid("json");
    if (!film.sound?.fileOf(settings.name))
      return c.json({ error: "This sound file is unavailable" }, 404);
    try {
      const small = c.req.query("small") === "1";
      const body = await film.processSound(settings.name, settings, small);
      c.header("Content-Type", small ? "audio/webm" : "audio/wav");
      return c.body(body);
    } catch (e) {
      return c.json({ error: safeErr(e) }, 422);
    }
  });
  app.post("/api/sound/beats", zValidator("json", SoundProcess), async (c) => {
    const settings = c.req.valid("json");
    if (!film.sound?.fileOf(settings.name))
      return c.json({ error: "This sound file is unavailable" }, 404);
    try {
      return c.json(await film.analyzeBeats(settings.name, settings));
    } catch (e) {
      return c.json({ error: safeErr(e) }, 422);
    }
  });
  // The camera keys, the same way (package.json "live-studio".camTimeline)
  app.get("/api/cam", (c) => {
    const s = film.cam?.read();
    return s ? fresh(c, s) : noSound(c);
  });
  app.post("/api/cam", zValidator("json", CamSave), (c) => {
    if (!film.cam) return noSound(c);
    const { base, data } = c.req.valid("json"),
      r = film.cam.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  // The shots, the same way (package.json "live-studio".shotsTimeline)
  app.get("/api/shots", (c) => {
    const s = film.shots?.read();
    return s ? fresh(c, s) : noSound(c);
  });
  app.post("/api/shots", zValidator("json", ShotsSave), (c) => {
    if (!film.shots) return noSound(c);
    const { base, data } = c.req.valid("json"),
      r = film.shots.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  // The words and shapes over the picture, the same way (package.json "live-studio".textTimeline)
  app.get("/api/text", (c) => {
    const s = film.text?.read();
    return s ? fresh(c, s) : noSound(c);
  });
  app.post("/api/text", zValidator("json", TextSave), (c) => {
    if (!film.text) return noSound(c);
    const { base, data } = c.req.valid("json"),
      r = film.text.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  app.get("/api/adjustment", (c) => {
    const data = film.adjustment?.read();
    return data ? fresh(c, data) : noSound(c);
  });
  app.post("/api/adjustment", zValidator("json", SoundSave), (c) => {
    if (!film.adjustment) return noSound(c);
    const { base, data } = c.req.valid("json"),
      r = film.adjustment.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  app.get("/api/timing", (c) => {
    const data = film.timing?.read();
    return data ? fresh(c, data) : noSound(c);
  });
  app.post("/api/timing", zValidator("json", SoundSave), (c) => {
    if (!film.timing) return noSound(c);
    const { base, data } = c.req.valid("json"),
      r = film.timing.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  // The key files (package.json "live-studio".keyFiles), each the same way, by its place in that list
  app.get("/api/keys", (c) =>
    fresh(
      c,
      film.keyFiles.map((k) => ({ file: k.rel, edit: k.edit, requiredRows: k.requiredRows ?? [] })),
    ),
  );
  app.get("/api/keys/:i{[0-9]+}", (c) => {
    const s = film.keyFiles[+c.req.param("i")]?.read();
    return s ? fresh(c, s) : noSound(c);
  });
  app.post("/api/keys/:i{[0-9]+}", zValidator("json", KeySave), (c) => {
    const k = film.keyFiles[+c.req.param("i")];
    if (!k) return noSound(c);
    const { base, data } = c.req.valid("json"),
      r = k.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  // Files edited in one go (a cut moved on the camera row changes cam.json and shots.json), named as their own routes name them:
  // every one is checked before any is written, so a 409 on one never leaves the others half saved
  const named = (name) =>
    new Map([
      ["sound", film.sound],
      ["cam", film.cam],
      ["shots", film.shots],
      ["text", film.text],
      ["adjustment", film.adjustment],
      ["timing", film.timing],
      ...film.keyFiles.map((k, i) => [`keys/${i}`, k]),
    ]).get(name);
  app.post("/api/together", zValidator("json", TogetherSave), (c) => {
    const files = c.req.valid("json").files.map((f) => ({ ...f, file: named(f.name) }));
    if (files.some((f) => !f.file)) return noSound(c);
    const nos = files.map((f) => f.file.check(f.base, f.data));
    if (nos.some((no) => no?.conflict)) return c.body(null, 409);
    if (nos.some(Boolean))
      return c.json({ problems: nos.flatMap((no) => no?.problems ?? []) }, 400);
    return c.json({
      versions: Object.fromEntries(
        files.map((f) => [f.name, f.file.write(f.base, f.data).version]),
      ),
    });
  });
  app.get("/api/sfx/:name{[A-Za-z0-9_.-]+}/peaks", async (c) => {
    const name = c.req.param("name");
    const p = film.sound?.peaksAsync
      ? await film.sound.peaksAsync(name)
      : film.sound?.peaks?.(name);
    return p
      ? text(c, Buffer.from(JSON.stringify(p)), "application/json", undefined, {
          path: c.req.path,
          file: film.sound?.fileOf?.(name),
          onSound: true,
          sfxName: name,
        })
      : noSound(c);
  });
  app.get("/api/sfx/:name{[A-Za-z0-9_.-]+[.]wav}", (c) => {
    const name = c.req.param("name").slice(0, -4);
    const f = film.sound?.fileOf(name);
    return f ? sendFile(c, f, { onSound: true, sfxName: name }) : noSound(c);
  });
  app.get("/api/sfx/:name{[A-Za-z0-9_.-]+[.]ogg}", (c) => {
    const name = c.req.param("name").slice(0, -4);
    const f = film.sound?.fileOf(name);
    return f ? sendFile(c, f, { onSound: true, sfxName: name }) : noSound(c);
  });
  app.get("/api/sfx/:name{[A-Za-z0-9_.-]+[.]webm}", async (c) => {
    const name = c.req.param("name").slice(0, -5);
    const f = await film.smallSfx(name);
    return f ? sendFile(c, f, { onSound: true, sfxName: name }) : noSound(c);
  });

  app.get("/api/mix.wav", (c) =>
    existsSync(film.MIX)
      ? sendFile(c, film.MIX, { store: true, onSound: true })
      : c.body(null, 404),
  );
  app.get("/api/mix_small.webm", async (c) => {
    if (!existsSync(film.MIX)) return c.body(null, 404);
    await film.smallMix();
    return existsSync(film.MIX_SMALL)
      ? sendFile(c, film.MIX_SMALL, { onSound: true, sourceFile: film.MIX })
      : c.body(null, 404);
  }); // no ffmpeg, no small copy: the page plays the full mix
  app.get("/api/video.mp4", async (c) => {
    let target;
    try {
      target = await film.smallVideo?.();
    } catch (err) {
      send("video-failed");
      throw err;
    }
    if (!target || !existsSync(target)) {
      send("video-failed");
      return c.body(null, 404);
    }
    if (c.req.method === "GET" && !c.req.header("range")) send("video-ready");
    const safeName = (film.NAME || "film").replace(/[^\w.-]+/g, "_") || "film";
    const suffix = !film.VIDEO_SMALL || target === film.VIDEO_SMALL ? "-540p" : "";
    c.header("content-disposition", `attachment; filename="${safeName}${suffix}.mp4"`);
    return sendFile(c, target);
  });

  // The film's own files, last
  app.get("*", (c) => {
    const url = decodeURIComponent(c.req.path);
    const lite = url.startsWith("/lite/");
    const root = lite ? film.LITE : film.PUBLIC;
    const file = join(root, lite ? url.slice(5) : url);
    if (!inside(root, file) || !existsSync(file) || statSync(file).isDirectory())
      return c.body(null, 404);
    return sendFile(c, file, { pack: !PACKED.test(file) });
  });
  app.onError((e, c) => {
    console.log(`${c.req.method} ${c.req.path}: ${e.message}`);
    return e instanceof HTTPException ? e.getResponse() : c.body(null, 500);
  }); // one bad request must not take the studio down, and a page keeps a note it could not save and tries again
  return app;
};
