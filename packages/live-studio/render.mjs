// Draft renders of any film from inside it; HELP below says everything it takes
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

import { build } from "vite";

import { cues, srt } from "./src/captions.mjs";
import { cliArgs, envTypos, jsonFile, numberArg, secondArg } from "./src/cli.mjs";
import { heardLength, STUDIO, threeFromOf, voiceMapOf } from "./src/film.mjs";
import { ratioOf, sizeOf } from "./src/frame.ts";
import { compileLayerTiming } from "./src/layer-timing.mjs";
import { narrationLines } from "./src/narration.ts";
import { audioInfo } from "./src/sound.mjs";
import { mapVoice } from "./src/timing-data.mjs";
import { filmPlugin } from "./src/vite_film.mjs";
import { writeVoiceMap } from "./src/voice-map.mjs";
import { warp } from "./src/warp.mjs";

const HELP = `Renders of the film, run inside it: draft stills, the film as video, its captions, the final for upload.
  bun run render all          stills and clip
  bun run render stills       stills only, to renders/still_<s>s.jpg (the last run's stills are cleared first)
  bun run render clip         the film as 30 s H.264 chunks in renders/chunks/, joined into renders/draft_video.mp4
  bun run render captions     renders/draft_video.srt alone, in a second
  bun run render final        the film for upload, only when the creator asks for it (a 30 s chunk at 16 sub-frames took
                              4.5 min on an RTX 2060, against 10 s for a draft one; the GPU fan runs loud meanwhile):
                              1440p, no strip under the picture, full-size AO, 8 sub-frames a frame (180-degree
                              shutter motion blur averaged as light), YouTube's H.264 (GOP half a second, 32 Mbps),
                              chunks in renders/final_chunks/ joined into renders/final_video.mp4
A clip or final run keeps every chunk already rendered from the same film code, data and settings, and renders the rest:
after a crash, the same command again picks up where it stopped. The sound timeline is not part of it: after a sound
edit, bun run mix renders/draft_video.mp4 alone puts the new sound on the draft. Chrome is restarted (up to 3 times)
when the page goes quiet for 4 minutes mid-video.
Builds the film with the studio's own bundler, opens it in headless Chrome on the GPU and writes what the page sends back.
Nothing is written outside the film. Options are environment variables:
  AT=40,41.5                 stills at these heard seconds, or as notes print them: AT=0:40,0:41.5 (default 1)
  LIST=1                     with the list of what is going on (draw.describe) over the picture; off, the picture is clean.
                             A draft frame has a strip under the picture: the heard time mm:ss.sss and the shot
  CHUNKS=3,4                 re-render only those chunks (0-based: 3 is 1:30-2:00) and join them with the ones already there
  SAMPLES=16                 sub-frames a frame for clip or final (1-64; clip 1, final 8): more is smoother blur, slower
  RES=2160                   final only: 1440 (default), 2160 or 1080 lines (the short side). YouTube re-encodes a 1440p or
                             bigger upload in VP9, sharper even for viewers at 1080p; a 1080p upload gets H.264. A Shorts
                             film defaults to 1080 (1080x1920, as big as Shorts play)
  INSPECT=px,py,pz,lx,ly,lz,fov  every still from this one fixed camera (the studio's free camera) instead of the film's
  CHECK=slide:0,108;trace:50,51,0.1  run the film's draw.checks.slide(0, 108) etc. and print the lines they return
  CHECK=motion:handR,81,83   built in for every film (target: cam, a bone, an object's .name or draw.tools.objects label),
                             between two HEARD seconds as AT takes them, not the scene seconds of src/timeline rows
                             (bun run at <s> converts and names the shot; the result says which shots it spans):
                             motion  speed graph, onion skin + speed-coloured path, pops, dead stops (render/motion.ts)
                             seen    how much of the frame it fills, hidden behind what, cut off, too dark (render/seen.ts)
                             touch   sinking into things, hanging just off them (render/touch.ts): for one shot or move in
                                     question; over a whole film it lists every small limb clip (a walk's feet, 6-10 cm)
  ENTRY=lab/prop.ts          run a page of the film's own instead (it imports "live-studio/lab"); LAB_VIEW=desk reaches it as cfg.lab.view
Examples:
  AT=12,30.5 LIST=1 bun run render stills
  CHUNKS=3 bun run render clip
  $env:AT='12,30.5'; bun run render stills; Remove-Item Env:AT     the same in PowerShell, where VAR=x cmd is no syntax
  bun run render final        then bun run mix renders/final_video.mp4 puts the soundtrack on it
package.json "live-studio": { "chrome": path } names the headless Chrome (default tools/chrome-headless-shell/...);
{ "ratio": "9:16" } makes a Shorts film, drafts at 720x1280 (src/frame.ts). Next: bun run framecheck on the clip.
Why each setting, YouTube's spec, what survives its re-encode, how to render faster: bun run skills get core --ref render.`;
// its options are environment variables: --at 12 is the flag form an AI tries first
const ENV_OPTIONS = ["AT", "LIST", "CHUNKS", "INSPECT", "CHECK", "ENTRY", "SAMPLES", "RES"];
const TARGETS = ["stills", "clip", "captions", "all", "final"];
const flagged = process.argv
  .slice(2)
  .map((a, i, all) => [/^--?([a-z]+)(?:=(.*))?$/i.exec(a), all[i + 1]])
  .find(([m]) => m && ENV_OPTIONS.includes(m[1].toUpperCase()));
if (flagged) {
  const [m, next] = flagged;
  const value =
    m[2] ?? (next && !next.startsWith("-") && !TARGETS.includes(next) ? next : "<value>");
  console.error(
    `${m[1].toUpperCase()} is an environment variable here, not a flag: ${m[1].toUpperCase()}=${value} bun run render ${process.argv.slice(2).find((a) => TARGETS.includes(a)) ?? "stills"}`,
  );
  process.exit(2);
}
const [what] = cliArgs(HELP, [], 1);
envTypos([...ENV_OPTIONS, "LIVE_PROJECT"]); // any LAB_* goes to the lab page as is
// a clip takes minutes and a final far longer: each is only ever made when asked for by name
if (!TARGETS.includes(what)) {
  const near = what && TARGETS.find((t) => t.startsWith(what.slice(0, 3).toLowerCase()));
  console.error(
    `${what ? `unknown target ${what}${near ? ` (did you mean ${near}?)` : ""}` : `which render?${process.env.CHECK || process.env.AT ? ` (${process.env.CHECK ? "CHECK" : "AT"} goes with stills)` : ""}`}: bun run render stills (seconds), clip (minutes), captions, all, or final (the upload; --help for everything)`,
  );
  process.exit(2);
}
const video = what === "clip" || what === "all" || what === "final";
const misplaced =
  !video && process.env.CHUNKS
    ? "CHUNKS is for render clip or final"
    : (what === "clip" || what === "final") && process.env.AT
      ? "AT is for render stills"
      : !video && process.env.SAMPLES
        ? "SAMPLES is for render clip or final"
        : what !== "final" && process.env.RES
          ? "RES is for render final"
          : what === "final" && process.env.LIST === "1"
            ? "LIST=1 draws over drafts only; a final is the picture alone"
            : null;
if (misplaced) {
  console.error(`${misplaced} (--help for which option goes with which)`);
  process.exit(2);
}

const PROJECT = resolve(process.env.LIVE_PROJECT ?? process.cwd());
if (!existsSync(join(PROJECT, "src/scene.ts"))) {
  console.error(`${PROJECT} has no src/scene.ts: run this inside a film`);
  process.exit(1);
}
// A film file read here: absent gives the fallback, broken stops the render naming it (a stack trace said nothing)
const readJson = (file, fallback) => {
  if (!existsSync(file)) return fallback;
  try {
    return jsonFile(file, PROJECT);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
};
// a page of the film's own: a wrong path would only fail deep in the bundler
if (process.env.ENTRY && !existsSync(resolve(PROJECT, process.env.ENTRY))) {
  const lab = existsSync(join(PROJECT, "lab"))
    ? readdirSync(join(PROJECT, "lab")).filter((f) => /\.[jt]s$/.test(f))
    : [];
  console.error(
    `ENTRY=${process.env.ENTRY} is no file in the film (${lab.length ? `its pages: ${lab.map((f) => `lab/${f}`).join(", ")}` : "it has no lab/ pages yet"}); without ENTRY it renders the film itself`,
  );
  process.exit(2);
}
const FPS = 30,
  CHUNK = 30;
const RENDERS = join(PROJECT, "renders"),
  CHUNKS = join(RENDERS, what === "final" ? "final_chunks" : "chunks"),
  JOINED = what === "final" ? "final_video.mp4" : "draft_video.mp4",
  OUT = join(PROJECT, `node_modules/.vite/live-studio-render-${process.pid}`); // per run: two renders of one film must not share a build

// The voice's captions at the seconds heard (src/captions.mjs), named as the video so a player picks them up with it
const writeCaptions = () => {
  const map = voiceMapOf(PROJECT),
    edit = join(PROJECT, "src/edit.json");
  if (!existsSync(map)) writeVoiceMap(PROJECT, map);
  if (!existsSync(map)) {
    console.log("no captions: renders/live/voice_map.json could not be built");
    return;
  }
  const editData = readJson(edit, {});
  const w = editData.voice?.warp ?? [];
  const heard = (s) => warp(w, s, 0, 1);
  const lines = (JSON.parse(readFileSync(map, "utf8")).lines ?? []).map((l) => ({
    ...l,
    s: heard(l.s),
    e: heard(l.e),
    words: l.words.map((v) => ({ ...v, s: heard(v.s), e: heard(v.e) })),
  }));
  const packageFile = join(PROJECT, "package.json");
  const conf = readJson(packageFile, {})["live-studio"] ?? {};
  const audio = conf.soundTimeline ? readJson(join(PROJECT, conf.soundTimeline), null) : null;
  const source = audio?.narration && conf.soundSources?.[audio.narration];
  const duration =
    source && existsSync(join(PROJECT, source))
      ? (audioInfo(join(PROJECT, source))?.seconds ?? 0)
      : 0;
  const timing = conf.timingTimeline ? readJson(join(PROJECT, conf.timingTimeline), {}) : {};
  const clock = compileLayerTiming(timing, heard(editData.end ?? duration), "voice");
  const list = cues(mapVoice(narrationLines(lines, audio, duration), clock));
  mkdirSync(RENDERS, { recursive: true });
  writeFileSync(join(RENDERS, "draft_video.srt"), srt(list));
  console.log(`wrote renders/draft_video.srt (${list.length} captions)`);
};
if (what === "captions") {
  writeCaptions();
  process.exit(0);
}
const pkg = readJson(join(PROJECT, "package.json"), {});
const CHROME = join(
  PROJECT,
  pkg["live-studio"]?.chrome ?? "tools/chrome-headless-shell/chrome-headless-shell.exe",
);
const env = process.env;
// a typo here once hung the render for good: every number is checked before Chrome opens
const numbers = (name, limits) =>
  env[name].split(",").map((x, i) => numberArg(`${name} item ${i + 1}`, x.trim(), limits));
// CHECK=<name>:<args>;...: the built-in checks take <target>,<from s>,<to s> in heard seconds (mm:ss too, as notes print
// them; a minus is kept so the range check below can say the film starts at 0); a film's own take what it takes
const BUILT_IN = ["motion", "seen", "touch"];
const CHECKS = (env.CHECK ?? "")
  .split(";")
  .filter(Boolean)
  .map((c) => {
    const colon = c.indexOf(":"),
      name = (colon < 0 ? c : c.slice(0, colon)).trim(),
      args =
        colon < 0 || c.slice(colon + 1) === ""
          ? []
          : c
              .slice(colon + 1)
              .split(",")
              .map((a) => a.trim());
    if (!BUILT_IN.includes(name))
      return { c, name, args: args.map((a) => (a !== "" && !isNaN(+a) ? +a : a)) };
    if (args.length !== 3) {
      console.error(
        `CHECK ${c}: ${name} takes 3 values, <target>,<from s>,<to s>; got ${args.length} (bun run render --help)`,
      );
      process.exit(2);
    }
    const sec = (which, v) => (/^-\d/.test(v) ? +v : secondArg(`CHECK ${c}: ${which}`, v));
    return { c, name, args: [args[0], sec("from", args[1]), sec("to", args[2])] };
  });
if (env.LIST !== undefined && !["0", "1"].includes(env.LIST)) {
  console.error(`LIST is 1 (the list over the picture) or 0, got ${JSON.stringify(env.LIST)}`);
  process.exit(2);
}
const inspect = env.INSPECT ? numbers("INSPECT") : null;
if (inspect && inspect.length !== 7) {
  console.error(`INSPECT takes 7 numbers px,py,pz,lx,ly,lz,fov, got ${inspect.length}`);
  process.exit(2);
}
// a CHECK run writes its own charts; a still at 1 s beside them would only crowd bun run sheet
const at =
  what === "clip" || what === "final"
    ? []
    : env.AT === undefined
      ? env.CHECK
        ? []
        : [1]
      : env.AT.split(",").map((x, i) => secondArg(`AT item ${i + 1}`, x));
const only = env.CHUNKS ? numbers("CHUNKS", { min: 0, int: true }) : null;
const final = what === "final";
const samples = env.SAMPLES
  ? numberArg("SAMPLES", env.SAMPLES, { min: 1, max: 64, int: true })
  : final
    ? 8
    : 1;
// YouTube's upload table for 30 fps (8, 16, 35-45 Mbps), doubled: the GPU's encoder spends bits less well than x264
const FINAL_SIZES = { 1080: [1920, 16e6], 1440: [2560, 32e6], 2160: [3840, 60e6] };
const res = env.RES ?? (ratioOf(pkg) === "9:16" ? "1080" : "1440");
if (final && !FINAL_SIZES[res]) {
  console.error(
    `RES is 1440 (the default; 1080 for Shorts), 2160 or 1080, got ${JSON.stringify(env.RES)}`,
  );
  process.exit(2);
}
// A second past the end, or a CHECK range that runs backwards, is refused here: the page would say it too, after the scene build
const ends = heardLength(PROJECT, pkg["live-studio"] ?? {});
if (ends) {
  const past = at.filter((s) => s > ends.film + 0.05);
  if (past.length) {
    console.error(
      `AT ${past.join(",")} is past the film's end: it runs 0-${ends.film.toFixed(2)} s heard (bun run at <second> reads the same clock)`,
    );
    process.exit(2);
  }
  const count = Math.max(1, Math.ceil(ends.film / CHUNK));
  const beyond = (only ?? []).filter((i) => i >= count);
  if (beyond.length) {
    console.error(
      `CHUNKS ${beyond.join(",")} is past the film's end: it has chunks 0-${count - 1} (${ends.film.toFixed(2)} s, ${CHUNK} s each)`,
    );
    process.exit(2);
  }
}
for (const { c, name, args } of CHECKS.filter((x) => BUILT_IN.includes(x.name))) {
  const [, from, to] = args;
  if (from < 0) {
    console.error(
      `CHECK ${c}: from ${from} is before the film starts (0): CHECK=${name}:<target>,<from s>,<to s>, both in heard seconds`,
    );
    process.exit(2);
  }
  if (from >= to) {
    console.error(
      `CHECK ${c}: from ${from} must come before to ${to} (CHECK=${name}:<target>,<from s>,<to s>)`,
    );
    process.exit(2);
  }
  if (ends && to > ends.film + 0.05) {
    console.error(
      `CHECK ${c}: to ${to} is past the film's end: it runs 0-${ends.film.toFixed(2)} s heard (bun run at <second> reads the same clock)`,
    );
    process.exit(2);
  }
}
if (!existsSync(CHROME)) {
  console.error(
    `no headless Chrome at ${CHROME}: name it in package.json "live-studio": { "chrome": "..." }`,
  );
  process.exit(1);
}
const stillsWritten = [];
// bun run sheet lays out every still_*.jpg: one left from an earlier run would show a scene since changed beside this one's
if (at.length && existsSync(RENDERS))
  for (const f of readdirSync(RENDERS))
    if (/^still_.*\.jpg$/.test(f)) rmSync(join(RENDERS, f), { force: true });
const choicesFile = ["choices.json", "sound_choices.json"]
  .map((f) => join(PROJECT, f))
  .find(existsSync);

const ratio = ratioOf(pkg),
  [W, H] = sizeOf(ratio, final ? FINAL_SIZES[res][0] : 1280); // package.json "live-studio".ratio: 16:9, or 9:16 for Shorts
const cfg = {
  W,
  H,
  ratio,
  draft: !final,
  quality: 0.9,
  stills: at.map((s) => ({
    name: `still_${s}s.jpg`,
    frame: Math.round(s * FPS),
  })),
  clip: video
    ? {
        chunk: CHUNK,
        only,
        samples,
        bitrate: final ? FINAL_SIZES[res][1] : 4e6,
        // YouTube asks for a closed GOP of half a second; a draft only needs a keyframe to start each chunk on
        keyFrameInterval: final ? 0.5 : 2,
      }
    : null,
  list: env.LIST === "1",
  inspect,
  checks: CHECKS.map(({ name, args }) => [name, args]),
  choices: choicesFile ? readJson(choicesFile, {}) : {},
  lab: Object.fromEntries(
    Object.entries(env)
      .filter(([k]) => k.startsWith("LAB_"))
      .map(([k, v]) => [k.slice(4).toLowerCase(), v]),
  ),
};

// ---------- The page: the studio's render page, or the film's own lab page, built with the film inside
const entry = env.ENTRY ? resolve(PROJECT, env.ENTRY) : join(STUDIO, "render/page.ts");
const t0 = Date.now();
// The sound timeline never changes a frame (src/stale.mjs skips it too); only LIST=1's overlay names its rows. Left out of a
// video's build, a gain tweak keeps every chunk's stamp, so render clip redraws nothing for it
const soundFile =
  video && !cfg.list && pkg["live-studio"]?.soundTimeline
    ? resolve(PROJECT, pkg["live-studio"].soundTimeline)
    : null;
const noSound = {
  name: "picture-without-sound",
  enforce: "pre",
  load: (id) =>
    soundFile && resolve(id.split("?")[0]) === soundFile
      ? JSON.stringify({ beds: [], sfx: [] })
      : null,
};
const built = await build({
  configFile: false,
  root: join(STUDIO, "render"),
  publicDir: false, // the film's assets are served from where they are, never copied
  logLevel: "error",
  plugins: [noSound, filmPlugin({ SRC: join(PROJECT, "src"), threeFrom: threeFromOf(PROJECT) })],
  build: {
    outDir: OUT,
    emptyOutDir: true,
    minify: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: Infinity,
    rolldownOptions: {
      input: entry,
      output: {
        entryFileNames: "page.js",
        chunkFileNames: "_render/[name]-[hash].js",
        assetFileNames: "_render/[name]-[hash][extname]",
      },
    },
  },
});
const styles = (Array.isArray(built) ? built : [built])
  .flatMap((b) => b.output)
  .filter((f) => f.type === "asset" && f.fileName.endsWith(".css"))
  .map((f) => `<link rel="stylesheet" href="/${f.fileName}">`)
  .join("");
console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// A chunk's stamp: the built page (the film's code and timelines, the packages) and every setting that changes a frame.
// Equal stamps draw equal frames, so such a chunk is kept. Files under assets/public are not in it (CHUNKS= renders anew)
const stamp = (() => {
  const h = createHash("sha256");
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true })
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .forEach((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : h.update(readFileSync(join(dir, e.name))),
      );
  walk(OUT);
  const { W, H, draft, clip, list, choices } = cfg;
  h.update(JSON.stringify({ W, H, draft, list, choices, ...clip, only: null }));
  return h.digest("hex").slice(0, 16);
})();
// stills alone cannot show motion, contact or flicker: say what can, where every render prints
if (!cfg.checks.length)
  console.log(
    "checks: CHECK=motion|seen|touch:<target>,<from s>,<to s> (bun run render --help); after a clip: bun run framecheck",
  );

// ---------- Serve it to a headless Chrome and keep what it posts back
mkdirSync(CHUNKS, { recursive: true });
const MIME = {
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".glb": "model/gltf-binary",
}; // wasm: instantiateStreaming refuses anything else
const chunkFile = (i) => join(CHUNKS, `c${String(i).padStart(2, "0")}.mp4`);
const stampsFile = join(CHUNKS, "stamps.json");
let stamps = {};
try {
  stamps = JSON.parse(readFileSync(stampsFile, "utf8"));
} catch {} // none yet, or from before stamps: every chunk renders
const renderedNow = new Set();
// asked again after a restart: what is left. A CHUNKS list is rendered as asked, the rest skips the chunks still current
const pageConfig = () =>
  cfg.clip
    ? {
        ...cfg,
        clip: {
          ...cfg.clip,
          only: cfg.clip.only?.filter((i) => !renderedNow.has(i)) ?? null,
          unchanged: cfg.clip.only
            ? []
            : Object.keys(stamps)
                .map(Number)
                .filter((i) => stamps[i] === stamp && existsSync(chunkFile(i))),
        },
      }
    : cfg;
let finish,
  failed = false,
  chunks = null,
  lastAlive = null;
const finished = new Promise((done) => {
  finish = done;
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const url = decodeURIComponent(new URL(req.url).pathname);
    if (req.method === "POST") {
      const b = Buffer.from(await req.arrayBuffer());
      if (url === "/log") {
        const m = b.toString();
        (m.startsWith("ERROR") ? console.error : console.log)(m);
        if (m.startsWith("ERROR")) {
          failed = true;
          finish();
        }
      } else if (url.startsWith("/still/")) {
        writeFileSync(join(RENDERS, url.slice(7)), b);
        if (url.endsWith(".jpg")) stillsWritten.push(`renders/${url.slice(7)}`);
      } else if (url.startsWith("/chunk/")) {
        const i = +url.slice(7);
        writeFileSync(chunkFile(i), b);
        stamps[i] = stamp;
        writeFileSync(stampsFile, JSON.stringify(stamps));
        renderedNow.add(i);
        lastAlive = Date.now();
      } else if (url === "/alive") lastAlive = Date.now();
      else if (url === "/done") {
        chunks = b.length ? +b.toString() : null;
        finish();
      }
      return new Response("ok");
    }
    // The classic script reports errors thrown while the module's imports evaluate, before the page's own handlers exist
    if (url === "/")
      return new Response(
        "<!doctype html>" +
          styles +
          '<canvas id="gl"></canvas><script>onerror = (m, s, l, c, e) => { fetch("/log", { method: "POST", body: "ERROR " + (e && e.stack || m) }); };</script><script type="module" src="/page.js"></script>',
        { headers: { "content-type": "text/html" } },
      );
    if (url === "/config")
      return new Response(JSON.stringify(pageConfig()), {
        headers: { "content-type": "application/json" },
      });
    const file =
      url === "/page.js" || url.startsWith("/_render/")
        ? join(OUT, url)
        : join(PROJECT, "assets/public", url);
    const f = Bun.file(file);
    if (!(await f.exists())) return new Response(null, { status: 404 });
    return new Response(f, {
      headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream" },
    });
  },
});
// a profile per attempt: a killed Chrome's helper processes can hold the last one's lock for a while
const profiles = [];
const launch = () => {
  const profile = join(tmpdir(), `live_render_${process.pid}_${profiles.length}`);
  profiles.push(profile);
  mkdirSync(profile, { recursive: true });
  return spawn(
    CHROME,
    [
      "--headless",
      "--use-gl=angle",
      "--use-angle=d3d11",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--disable-gpu-vsync",
      "--disable-frame-rate-limit",
      "--no-first-run",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      `--user-data-dir=${profile}`,
      `http://127.0.0.1:${server.port}/`,
    ],
    { stdio: "ignore" },
  );
};
let chrome = launch(),
  attempt = 1;
const stuck = (why) => {
  if (cfg.clip && attempt < 3) {
    attempt++;
    console.log(
      `${why}: Chrome restarted (attempt ${attempt} of 3), the chunks finished so far are kept`,
    );
    lastAlive = null;
    chrome.kill();
    chrome = launch();
  } else {
    console.error(
      `ERROR ${why}${cfg.clip ? ", three times" : ""}. ${cfg.clip ? `The same command again renders only the chunks not finished (renders/${CHUNKS.slice(RENDERS.length + 1)}/stamps.json); ` : ""}a GPU that hangs again: close what else uses it`,
    );
    failed = true;
    finish();
  }
};
// Once frames flow the page says so every few seconds, and 4 minutes of quiet is a hang (a GPU reset, a lost context);
// before that (building the scene, a long CHECK) only an hour of quiet ends the run
let quietSince = Date.now();
const watchdog = setInterval(() => {
  if (lastAlive !== null) quietSince = lastAlive;
  const quiet = Date.now() - quietSince;
  if (lastAlive !== null ? quiet > 240e3 : quiet > 3600e3) {
    quietSince = Date.now();
    stuck(
      `no frame from the page for ${lastAlive !== null ? "4 minutes" : "an hour"} (chunks done this run: ${[...renderedNow].join(", ") || "none"})`,
    );
  }
}, 10e3);
await finished;
clearInterval(watchdog);
chrome.kill();
server.stop(true);
for (const profile of profiles)
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Chrome may still hold it for a moment */
  }
rmSync(OUT, { recursive: true, force: true });
console.log(`render ${what}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (stillsWritten.length)
  console.log(
    `wrote ${stillsWritten.join(" ")}${failed ? "" : `\nnext: open ${stillsWritten.length > 1 ? "them" : "it"} to look${stillsWritten.filter((f) => f.includes("/still_")).length > 1 ? "; many stills at once: bun run sheet (6 to a picture)" : ""}`}`,
  );

// Every chunk starts on a keyframe with the same encoder settings, so the join is a lossless stream copy
if (!failed && chunks) {
  const all = Array.from({ length: chunks }, (_, i) => chunkFile(i));
  const missing = all.flatMap((f, i) => (existsSync(f) ? [] : [i]));
  const folder = `renders/${CHUNKS.slice(RENDERS.length + 1).replaceAll("\\", "/")}`;
  if (missing.length)
    console.log(
      `not joined into renders/${JOINED}: ${missing.length === 1 ? `chunk ${missing[0]} is` : `chunks ${missing.join(", ")} are`} not in ${folder} (a CHUNKS run joins the chunks it draws with the ones already there, and a copied or fresh film has none).\nnext: CHUNKS=${missing.join(",")} bun run render ${what} draws just ${missing.length === 1 ? "that one" : "those"}; bun run render ${what} draws every chunk not current`,
    );
  else {
    writeFileSync(
      join(CHUNKS, "list.txt"),
      all.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"),
    );
    const j = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        join(CHUNKS, "list.txt"),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        join(RENDERS, JOINED),
      ],
      { stdio: "inherit" },
    );
    // a CHUNKS run keeps the other chunks as they are, even those drawn before the film last changed
    const old =
      only && j.status === 0 ? all.flatMap((_, i) => (stamps[i] === stamp ? [] : [i])) : [];
    if (old.length)
      console.log(
        `⚠ ${old.length === 1 ? `chunk ${old[0]} was` : `chunks ${old.join(", ")} were`} drawn before the film's last change and joined as ${old.length === 1 ? "it was" : "they were"}: CHUNKS=${old.join(",")} bun run render ${what} redraws ${old.length === 1 ? "it" : "them"} (bun run render ${what} redraws every chunk not current)`,
      );
    console.log(
      j.status !== 0
        ? "ERROR join failed"
        : final
          ? `joined renders/${JOINED} (${W}x${H}, ${samples} sub-frames a frame)\nnext: bun run mix renders/${JOINED} (the soundtrack on it: renders/final.mp4, the file to upload), then bun run framecheck renders/${JOINED}`
          : `joined renders/${JOINED}, picture only${existsSync(join(RENDERS, "draft.mp4")) ? ": renders/draft.mp4 keeps the old picture with its sound until bun run mix renders/" + JOINED : ""}\nnext: bun run framecheck (black, flashes, jumps, freezes); frames to look at: bun run sheet renders/${JOINED} 10,20,30`,
    );
    if (j.status) failed = true;
    else writeCaptions();
  }
}
process.exit(failed ? 1 : 0);
