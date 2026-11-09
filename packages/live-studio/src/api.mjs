// What the studio page asks the server for, as one Hono app: the built page (src/page.mjs) at / and /_studio/, its data and
// live events under /api/, and everything else from the film's own files (assets/public as /, small phone copies as /lite/).
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, isAbsolute, join, relative } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConsts, gzip } from "node:zlib";
import { zValidator } from "@hono/zod-validator";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { html } from "hono/html";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import * as z from "zod";
import { FavoriteChange, openFavorites } from "./favorites.mjs";
import { LutUpload, openGrades, PresetUpload } from "./grades.mjs";
import { RATIOS } from "./frame.mjs";
import { weighFirstVisit } from "./weight.mjs";
import { SoundProcess, SoundTimeline } from "./contract.mjs";

const MIME = { ".gltf": "application/json", ".glb": "model/gltf-binary", ".jpg": "image/jpeg", ".png": "image/png", ".bin": "application/octet-stream", ".js": "text/javascript", ".json": "application/json", ".wav": "audio/wav", ".webm": "audio/webm", ".jar": "application/java-archive" };
// The page sends null for a picture it could not make (no pin, no crop): the words still count
const jpeg = z.string().startsWith("data:image/jpeg;base64,/9j/").nullish();
const NoteIn = z.object({
  note: z.looseObject({ id: z.string().regex(/^[a-z0-9]+$/), t: z.number().refine(Number.isFinite), text: z.string() }),
  img: jpeg, crop: jpeg, strip: jpeg,
  // A drawn note spans moments: one picture per moment it was drawn at, with what was drawn there
  frames: z.array(z.object({ t: z.number().refine(Number.isFinite), img: jpeg })).max(8).optional(),
});
const NoteChange = z.object({ text: z.string().optional(), remove: z.boolean().optional(), restore: z.boolean().optional(), done: z.boolean().optional(), fix: z.looseObject({}).optional() });
const Choose = z.object({ group: z.string().min(1), set: z.string(), gain: z.number().optional() });
const FilmChange = z.object({ ratio: z.enum(RATIOS) });
const PageProblems = z.object({ problems: z.array(z.string()) });
const SoundSave = z.object({ base: z.string(), data: z.looseObject({}) });
const SoundMeasure = z.object({ list: z.enum(["beds", "sfx"]), i: z.number().int().nonnegative(), data: SoundTimeline });
const CamSave = z.object({ base: z.string(), data: z.array(z.looseObject({})) });
const ShotsSave = CamSave;
const TextSave = SoundSave;
const TogetherSave = z.object({ files: z.array(z.object({ name: z.string(), base: z.string(), data: z.unknown() })).min(2)
  .refine((fs) => new Set(fs.map((f) => f.name)).size === fs.length, "each file once") });
const KeySave = z.object({ base: z.string(), data: z.union([z.looseObject({}), z.array(z.unknown())]) });
const PageWeight = z.object({ files: z.array(z.object({ path: z.string().max(1000), bytes: z.number().nonnegative() })).max(5000) });

// Formats that are compressed inside already: trying them again only costs time on a first visit
const PACKED = /\.(png|jpe?g|webp|avif|gif|webm|mp3|mp4|m4a|ogg|opus|flac|woff2|ktx2)$/i;
const PACK_MAX = 16 * 1024 * 1024; // bigger is held in memory per version: slim it in the film instead
const inside = (root, file) => { const r = relative(root, file); return r && !r.startsWith("..") && !isAbsolute(r); };

export const createApi = (film, { page, events, send }) => {
  // Text and geometry shrink a lot and pictures don't. Squeezed once per version, so the next visit costs nothing here either;
  // what barely shrinks (a zip of pictures) is remembered as not worth it and goes out as it is
  // Off the main thread (a few MB takes a second), and kept as the promise so a second visit meanwhile waits for the same work
  const packed = new Map(), toBr = promisify(brotliCompress), toGzip = promisify(gzip);
  const squeeze = async (c, buf, tag) => {
    const accepts = c.req.header("accept-encoding") ?? "", how = /\bbr\b/.test(accepts) ? "br" : /gzip/.test(accepts) ? "gzip" : "";
    c.header("vary", "accept-encoding");
    if (!how) return buf;
    const key = how + tag;
    if (!packed.has(key)) {
      if (packed.size > 400) packed.clear();
      const work = how === "br" ? toBr(buf, { params: { [zlibConsts.BROTLI_PARAM_QUALITY]: 9 } }) : toGzip(buf);
      packed.set(key, work.then((small) => (small.length < buf.length * 0.9 ? small : null)));
    }
    const small = await packed.get(key);
    if (!small) return buf;
    c.header("content-encoding", how);
    return small;
  };
  // Unchanged means no download, and asking costs a few bytes
  const text = async (c, buf, type = "application/json") => {
    const tag = `"${createHash("md5").update(buf).digest("base64url")}"`;
    c.header("etag", tag);
    c.header("cache-control", "no-cache");
    if (c.req.header("if-none-match") === tag) return c.body(null, 304);
    c.header("content-type", type);
    return c.body(await squeeze(c, buf, tag));
  };
  const fresh = (c, data) => { c.header("cache-control", "no-store"); return c.json(data); };
  const fileOrMissing = (c, file) => (existsSync(file) ? text(c, readFileSync(file)) : c.body(null, 404));

  // A film file, with byte ranges (seeking in the sound needs them) and an etag so a reload on a phone fetches nothing again
  const sendFile = async (c, file, { store = false, pack = false } = {}) => {
    const { size, mtimeMs } = statSync(file);
    c.header("content-type", MIME[extname(file)] ?? "application/octet-stream");
    c.header("accept-ranges", "bytes");
    const range = c.req.header("range");
    if (store) c.header("cache-control", "no-store");
    else {
      const tag = `"${size}-${Math.round(mtimeMs)}"`;
      c.header("etag", tag);
      c.header("cache-control", "no-cache"); // a re-made copy shows up at once
      if (c.req.header("if-none-match") === tag && !range) return c.body(null, 304);
      if (pack && !range && size <= PACK_MAX) return c.body(await squeeze(c, readFileSync(file), tag));
    }
    const m = /bytes=(\d*)-(\d*)/.exec(range ?? "");
    if (m) {
      const a = m[1] ? +m[1] : 0, b = m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (a > b) { c.header("content-range", `bytes */${size}`); return c.body(null, 416); } // a page still reading past the end of a mix that got shorter
      c.header("content-range", `bytes ${a}-${b}/${size}`);
      c.header("content-length", String(b - a + 1));
      return c.body(Readable.toWeb(film.openRead(file, { start: a, end: b })), 206);
    }
    c.header("content-length", String(size));
    return c.body(Readable.toWeb(film.openRead(file)));
  };

  const app = new Hono();

  // The page names the build it came from, so after the studio restarts it can tell whether it is still the current one
  const build = () => createHash("md5").update(page.html() ?? "").digest("base64url");
  app.get("/", (c) => {
    c.header("cache-control", "no-cache");
    const built = page.html();
    // No page yet: the first build failed. Shown until a save fixes it
    if (!built) return c.html(html`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Studio</title><pre style="white-space:pre-wrap">The film's code has an error, so the page can't be built yet. It reloads once it's fixed.<br><br>${page.error() ?? ""}</pre>`, 503);
    return c.html(built.replace("</head>", `<meta name="live-build" content="${build()}"></head>`));
  });
  app.get("/_studio/*", serveStatic({ root: page.dir, precompressed: true, onFound: (_, c) => c.header("cache-control", "public, max-age=31536000, immutable") }));

  // Saves and jobs, as they happen (see send in live.mjs). A browser reconnects to this by itself, without reloading the page
  app.get("/api/events", (c) => streamSSE(c, async (stream) => {
    // Hono tells only the listeners it already has when a page leaves, so listen before the first write can wait on it
    const gone = new Promise((done) => { stream.onAbort(done); if (stream.aborted) done(); });
    events.add(stream);
    await stream.writeSSE({ event: "hello", data: build() });
    const alive = setInterval(() => stream.write(": alive\n\n"), 25e3); // a proxy drops a line that stays quiet
    await gone;
    clearInterval(alive);
    events.delete(stream);
  }));
  // The films' own scripts still call two paths from before /api/: checkpoint.py marks notes done at /notes/:id, and
  // publish_pages.py reads /edit.json
  app.on("POST", ["/api/*", "/notes/*"], bodyLimit({ maxSize: 20 * 1024 * 1024 }));

  app.get("/api/notes", (c) => fresh(c, film.notes.read()));
  app.post("/api/notes", zValidator("json", NoteIn), async (c) => {
    film.notes.add(c.req.valid("json"), await film.stamp());
    return c.text("ok");
  });
  app.on("POST", ["/api/notes/:id{[a-z0-9]+}", "/notes/:id{[a-z0-9]+}"], zValidator("json", NoteChange), (c) => {
    film.notes.change(c.req.param("id"), c.req.valid("json"));
    return c.text("ok");
  });
  app.get("/api/note-img/:name{[a-z0-9]+(_crop|_strip|_f\\d)?\\.jpg}", (c) => {
    const pic = film.notes.picture(c.req.param("name").slice(0, -4));
    if (!pic) return c.body(null, 404);
    c.header("content-type", "image/jpeg");
    c.header("cache-control", "max-age=31536000, immutable");
    return c.body(pic);
  });

  app.on("GET", ["/api/edit.json", "/edit.json"], (c) => text(c, readFileSync(film.EDIT)));
  app.get("/api/voice_map.json", (c) => fileOrMissing(c, film.VOICE_MAP));
  app.get("/api/shots.json", (c) => text(c, Buffer.from(JSON.stringify(film.shotComments()))));
  app.get("/api/trials.json", (c) => { const t = film.trials(); return t ? text(c, Buffer.from(JSON.stringify(t))) : c.body(null, 404); });
  app.get("/api/choices.json", (c) => text(c, Buffer.from(JSON.stringify(film.readChoices()))));
  app.post("/api/choose", zValidator("json", Choose), (c) => (film.choose(c.req.valid("json")) ? c.text("ok") : c.body(null, 400)));
  app.get("/api/contract.json", (c) => fresh(c, film.contract()));
  // The film's frame shape (frame.mjs), which the page needs before it builds the scene; Settings change it
  app.get("/api/film.json", (c) => fresh(c, { name: film.NAME, ratio: film.ratio() }));
  app.post("/api/film", zValidator("json", FilmChange), (c) => { film.setRatio(c.req.valid("json").ratio); return c.text("ok"); });
  app.post("/api/contract", zValidator("json", PageProblems), (c) => { film.pageSays(c.req.valid("json").problems); return c.text("ok"); });

  // The creator's stars, kept for every film (src/favorites.mjs); every open page of this studio hears a change
  const favorites = openFavorites();
  app.get("/api/favorites", (c) => fresh(c, favorites.shown()));
  app.post("/api/favorites", zValidator("json", FavoriteChange), (c) => { const all = favorites.set(c.req.valid("json")); send("favorites"); return c.json(all); });

  const grades = openGrades(film.PUBLIC);
  const gradeResult = (c, fn) => { try { return c.json(fn()); } catch (e) { return c.json({ error: e.message }, 400); } };
  app.get("/api/adjust", (c) => gradeResult(c, grades.list));
  app.post("/api/adjust/lut", zValidator("json", LutUpload), (c) => gradeResult(c, () => grades.addLut(c.req.valid("json"))));
  app.post("/api/adjust/preset", zValidator("json", PresetUpload), (c) => gradeResult(c, () => { const { name, grade } = c.req.valid("json"); return grades.savePreset(name, grade); }));
  app.post("/api/adjust/preset/:id/apply", (c) => gradeResult(c, () => grades.applyPreset(c.req.param("id"))));

  let weighed = null; // the heavy files last named, so each reload doesn't say it again
  app.post("/api/weight", zValidator("json", PageWeight), (c) => {
    const heavy = weighFirstVisit(c.req.valid("json").files);
    if ((heavy?.names ?? null) !== weighed) {
      console.log(heavy ? heavy.text : "a first visit from a phone or over Tailscale is back under budget");
      weighed = heavy?.names ?? null;
    }
    return c.text("ok");
  });

  // The sound lanes, when the film names them (src/sound.mjs). A save names the version it was made on: 409 means the file
  // changed meanwhile (an agent fixing a note), and the page loads that one instead of writing over it
  const noSound = (c) => c.body(null, 404);
  app.get("/api/sound", (c) => { const s = film.sound?.read(); return s ? fresh(c, { ...s, library: film.sound.library(), live: film.liveLanes() }) : noSound(c); });
  app.post("/api/sound", zValidator("json", SoundSave), (c) => {
    if (!film.sound) return noSound(c);
    const { base, data } = c.req.valid("json"), r = film.sound.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  app.post("/api/sound/measure", zValidator("json", SoundMeasure), async (c) => {
    if (!film.sound) return noSound(c);
    const { list, i, data } = c.req.valid("json"), clip = data[list][i];
    if (!clip || !film.sound.fileOf(clip.name)) return c.json({ error: "This sound file is unavailable" }, 404);
    try { return c.json(await film.measureSound(list, i, data)); }
    catch (e) { return c.json({ error: e.message }, 422); }
  });
  app.post("/api/sound/process", zValidator("json", SoundProcess), async (c) => {
    const settings = c.req.valid("json");
    if (!film.sound?.fileOf(settings.name)) return noSound(c);
    try { c.header("Content-Type", "audio/wav"); return c.body(await film.processSound(settings.name, settings)); }
    catch (e) { return c.json({ error: e.message }, 422); }
  });
  app.post("/api/sound/beats", zValidator("json", SoundProcess), async (c) => {
    const settings = c.req.valid("json");
    if (!film.sound?.fileOf(settings.name)) return noSound(c);
    try { return c.json(await film.analyzeBeats(settings.name, settings)); }
    catch (e) { return c.json({ error: e.message }, 422); }
  });
  // The camera keys, the same way (package.json "live-studio".camTimeline)
  app.get("/api/cam", (c) => { const s = film.cam?.read(); return s ? fresh(c, s) : noSound(c); });
  app.post("/api/cam", zValidator("json", CamSave), (c) => {
    if (!film.cam) return noSound(c);
    const { base, data } = c.req.valid("json"), r = film.cam.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  // The shots, the same way (package.json "live-studio".shotsTimeline)
  app.get("/api/shots", (c) => { const s = film.shots?.read(); return s ? fresh(c, s) : noSound(c); });
  app.post("/api/shots", zValidator("json", ShotsSave), (c) => {
    if (!film.shots) return noSound(c);
    const { base, data } = c.req.valid("json"), r = film.shots.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  // The words and shapes over the picture, the same way (package.json "live-studio".textTimeline)
  app.get("/api/text", (c) => { const s = film.text?.read(); return s ? fresh(c, s) : noSound(c); });
  app.post("/api/text", zValidator("json", TextSave), (c) => {
    if (!film.text) return noSound(c);
    const { base, data } = c.req.valid("json"), r = film.text.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  app.get("/api/adjustment", (c) => { const data = film.adjustment?.read(); return data ? fresh(c, data) : noSound(c); });
  app.post("/api/adjustment", zValidator("json", SoundSave), (c) => {
    if (!film.adjustment) return noSound(c);
    const { base, data } = c.req.valid("json"), r = film.adjustment.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  // The key files (package.json "live-studio".keyFiles), each the same way, by its place in that list
  app.get("/api/keys", (c) => fresh(c, film.keyFiles.map((k) => ({ file: k.rel, edit: k.edit }))));
  app.get("/api/keys/:i{[0-9]+}", (c) => { const s = film.keyFiles[+c.req.param("i")]?.read(); return s ? fresh(c, s) : noSound(c); });
  app.post("/api/keys/:i{[0-9]+}", zValidator("json", KeySave), (c) => {
    const k = film.keyFiles[+c.req.param("i")];
    if (!k) return noSound(c);
    const { base, data } = c.req.valid("json"), r = k.write(base, data);
    return r.conflict ? c.body(null, 409) : r.problems ? c.json(r, 400) : c.json(r);
  });
  // Files edited in one go (a cut moved on the camera row changes cam.json and shots.json), named as their own routes name them:
  // every one is checked before any is written, so a 409 on one never leaves the others half saved
  const named = (name) => new Map([["sound", film.sound], ["cam", film.cam], ["shots", film.shots], ["text", film.text], ["adjustment", film.adjustment], ...film.keyFiles.map((k, i) => [`keys/${i}`, k])]).get(name);
  app.post("/api/together", zValidator("json", TogetherSave), (c) => {
    const files = c.req.valid("json").files.map((f) => ({ ...f, file: named(f.name) }));
    if (files.some((f) => !f.file)) return noSound(c);
    const nos = files.map((f) => f.file.check(f.base, f.data));
    if (nos.some((no) => no?.conflict)) return c.body(null, 409);
    if (nos.some(Boolean)) return c.json({ problems: nos.flatMap((no) => no?.problems ?? []) }, 400);
    return c.json({ versions: Object.fromEntries(files.map((f) => [f.name, f.file.write(f.base, f.data).version])) });
  });
  app.get("/api/sfx/:name{[A-Za-z0-9_.-]+}/peaks", (c) => { const f = film.sound?.fileOf(c.req.param("name")); return f ? text(c, Buffer.from(JSON.stringify(film.sound.peaks(c.req.param("name"))))) : noSound(c); });
  app.get("/api/sfx/:name{[A-Za-z0-9_.-]+[.]wav}", (c) => { const f = film.sound?.fileOf(c.req.param("name").slice(0, -4)); return f ? sendFile(c, f) : noSound(c); });
  app.get("/api/sfx/:name{[A-Za-z0-9_.-]+[.]webm}", async (c) => { const f = await film.smallSfx(c.req.param("name").slice(0, -5)); return f ? sendFile(c, f) : noSound(c); });

  app.get("/api/mix.wav", (c) => (existsSync(film.MIX) ? sendFile(c, film.MIX, { store: true }) : c.body(null, 404)));
  app.get("/api/mix_small.webm", async (c) => { if (!existsSync(film.MIX)) return c.body(null, 404); await film.smallMix(); return existsSync(film.MIX_SMALL) ? sendFile(c, film.MIX_SMALL) : c.body(null, 404); }); // no ffmpeg, no small copy: the page plays the full mix

  // The film's own files, last
  app.get("*", (c) => {
    const url = decodeURIComponent(c.req.path);
    const lite = url.startsWith("/lite/");
    const root = lite ? film.LITE : film.PUBLIC;
    const file = join(root, lite ? url.slice(5) : url);
    if (!inside(root, file) || !existsSync(file) || statSync(file).isDirectory()) return c.body(null, 404);
    return sendFile(c, file, { pack: !PACKED.test(file) });
  });
  app.onError((e, c) => { console.log(`${c.req.method} ${c.req.path}: ${e.message}`); return e instanceof HTTPException ? e.getResponse() : c.body(null, 500); }); // one bad request must not take the studio down, and a page keeps a note it could not save and tries again
  return app;
};
