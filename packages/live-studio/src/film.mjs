// One film opened in the studio: where its files are, and the jobs that keep the studio's copies of them fresh (the sound mix,
// the voice's word times, the phone copies, the film contract). Everything under `project` is the film's,
// everything beside this file is the studio's.
import { execFile, spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch as fsWatch,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeBeats, renderAudio } from "./audio-process.mjs";
import {
  AdjustmentTimeline,
  CamTimeline,
  checkFiles,
  Choices,
  DOC,
  Edit,
  keyFileSchema,
  OpenFilmTimeline,
  problems,
  ShotsTimeline,
  SoundTimeline,
  StudioConfig,
  TextTimeline,
  TimingTimeline,
  Trials,
} from "./contract.ts";
import { ratioOf } from "./frame.ts";
import { openFilmHistory } from "./history.mjs";
import { createNotes, watchNotesFile } from "./notes.mjs";
import { OPENFILM_FILE, openOpenFilm } from "./openfilm.mjs";
import { openSound } from "./sound.mjs";
import { openTimelineFile } from "./timeline_file.mjs";
import { layerDuration, setTiming, timingClock } from "./timing-state.mjs";
import { voiceFileOf, writeVoiceMap } from "./voice-map.mjs";
import { openVoice } from "./voice.mjs";
import { warp } from "./warp.mjs";

export const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// One copy of three: the film's and the studio's would each otherwise bring their own, and objects from one fail instanceof in the other
export const threeFromOf = (project) =>
  existsSync(join(project, "node_modules/three")) ? project : STUDIO;
// The voice's lines and words in the voice's own seconds, which the studio writes on opening a film (voice-map.mjs)
export const voiceMapOf = (project) => join(project, "renders/live/voice_map.json");

// The film's length in heard seconds from its data alone, as the studio plays it (src/edit.json end through the voice edit and
// Speed/Freeze), so a CLI can refuse a second past the end before building anything. film: what the scene's DURATION is;
// layers: with the longest sound or overlay layer. null for a film whose end lives only in its code (no edit.json end)
export const heardLength = (project, conf) => {
  const read = (rel) => {
    try {
      return rel && existsSync(join(project, rel))
        ? JSON.parse(readFileSync(join(project, rel), "utf8"))
        : null;
    } catch {
      return null; // a broken file is bun run check's to say
    }
  };
  const edit = read("src/edit.json");
  if (typeof edit?.end !== "number") return null;
  setTiming(read(conf.timingTimeline) ?? {}, warp(edit.voice?.warp ?? [], edit.end, 0, 1));
  return { film: timingClock.duration, layers: Math.max(timingClock.duration, layerDuration()) };
};

// The files the film contract (contract.ts) covers, by the name the studio says them: [schema, text] (text undefined: absent).
// What the studio checks on every change, and bun run check (check.mjs) without a studio
export const contractFiles = (project) => {
  const pkgFile = join(project, "package.json"),
    conf =
      (existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, "utf8")) : {})["live-studio"] ?? {};
  // a folder named in place of a file reads as absent here; bun run check names it
  const textOf = (rel) => {
    const f = join(project, rel);
    return statSync(f, { throwIfNoEntry: false })?.isFile() ? readFileSync(f, "utf8") : undefined;
  };
  // older films named it sound_choices.json; validate every present choices file so a legacy one never hides a broken choices.json
  const choiceFiles = ["choices.json", "sound_choices.json"].filter((f) =>
    existsSync(join(project, f)),
  );
  // a value of the wrong shape is opened by nothing here: the "live-studio" entry's own schema names it
  const own = (key, schema) =>
    typeof conf[key] === "string" && conf[key] ? [[conf[key], [schema, textOf(conf[key])]]] : [];
  const rowsOf = (edit) => {
    const rows = conf.requiredKeyRows?.[edit];
    return Array.isArray(rows) ? rows.filter((p) => Array.isArray(p)) : [];
  };
  const entries = [
    ['package.json "live-studio"', [StudioConfig, JSON.stringify(conf)]],
    ["src/edit.json", [Edit, textOf("src/edit.json")]],
    ["renders/live/trials.json (from sound.py)", [Trials, textOf("renders/live/trials.json")]],
    ...(choiceFiles.length ? choiceFiles : ["choices.json"]).map((f) => [f, [Choices, textOf(f)]]),
    ...own("soundTimeline", SoundTimeline),
    ...own("camTimeline", CamTimeline),
    ...own("shotsTimeline", ShotsTimeline),
    ...own("textTimeline", TextTimeline),
    ...own("adjustmentTimeline", AdjustmentTimeline),
    ...own("timingTimeline", TimingTimeline),
    ...(conf.openfilmTimeline
      ? own("openfilmTimeline", OpenFilmTimeline)
      : textOf(OPENFILM_FILE) !== undefined
        ? [[OPENFILM_FILE, [OpenFilmTimeline, textOf(OPENFILM_FILE)]]]
        : []),
    ...Object.entries(conf.keyFiles ?? {}).map(([rel, edit]) => [
      rel,
      [keyFileSchema(rowsOf(edit)), textOf(rel)],
    ]),
  ];
  const files = new Map();
  for (const [file, [schema, text]] of entries) {
    const previous = files.get(file);
    files.set(file, [previous ? previous[0].and(schema) : schema, text]);
  }
  return Object.fromEntries(files);
};
const debounce = (f, ms) => {
  let h;
  return (...a) => {
    clearTimeout(h);
    h = setTimeout(() => f(...a), ms);
  };
};

// activity: src/activity.mjs's, told of each edit made outside the studio (the AI's)
export const openFilm = (projectDir, { send, activity }) => {
  const PROJECT = resolve(projectDir);
  const SRC = join(PROJECT, "src");
  if (!existsSync(join(SRC, "scene.ts")))
    throw new Error(`${PROJECT} has no src/scene.ts: run this inside a film, or try bun run demo`);
  const VENV_PYTHON = join(
    PROJECT,
    process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python",
  );
  const PYTHON = existsSync(VENV_PYTHON)
    ? VENV_PYTHON
    : process.platform === "win32"
      ? "python"
      : "python3";
  const PUBLIC = join(PROJECT, "assets/public");
  const WORK = join(PROJECT, "renders/live");
  const MIX = join(WORK, "mix_dry.wav"); // without the sounds being tried: the page plays those itself
  const MIX_SMALL = join(WORK, "mix_small.webm"); // the same mix for anything but this machine: a fifteenth of the size, and Opus stays on the clock where mp3 ran up to 30ms off
  const RENDERS = join(PROJECT, "renders");
  const VIDEO_SMALL = join(WORK, "video_small.mp4"); // 540p H.264/AAC faststart copy so a phone downloads a draft at a fraction of the size
  const LITE = join(WORK, "lite"); // small copies of the assets, see make_lite.py
  const TRIALS = join(WORK, "trials.json");
  const EDIT = join(SRC, "edit.json");
  const VOICE_MAP = voiceMapOf(PROJECT);
  const VOICE = voiceFileOf(PROJECT);
  // What was picked in the studio ("Use"), {group: {set, gain}}, read by the film's own renders; older films named it sound_choices.json
  const CHOICES =
    [join(PROJECT, "choices.json"), join(PROJECT, "sound_choices.json")].find(existsSync) ??
    join(PROJECT, "choices.json");
  // A machine's private name (Tailscale) has no place in the studio's public repo: the film lists the names it is reached by
  const HOSTS_FILE = join(PROJECT, ".live_hosts");
  const hosts = (existsSync(HOSTS_FILE) ? readFileSync(HOSTS_FILE, "utf8") : "")
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n.toLowerCase());
  const threeFrom = threeFromOf(PROJECT);
  // What sound.py reads, so a change to any of it remixes: package.json "live-studio": { "sound": [paths] }, files or folders.
  // Never list a folder the mix writes into, or every remix starts the next. Without the key: what films made before it mixed from
  const PKG = join(PROJECT, "package.json");
  const readPkg = () => (existsSync(PKG) ? JSON.parse(readFileSync(PKG, "utf8")) : {});
  const pkg = readPkg();
  const NAME = pkg.name ?? basename(PROJECT); // the page's title and a still frame's file name
  const SOUND_INPUTS = [
    ...new Set([
      ...(pkg["live-studio"]?.sound ?? [
        "sound.py",
        "src/timing.ts",
        "assets/public/agent/sfx2",
        "assets/public/agent/sfx_try",
      ]),
      ...Object.values(pkg["live-studio"]?.soundSources ?? {}),
    ]),
  ].map((f) => join(PROJECT, f));
  const has = (script) => existsSync(join(PROJECT, script)); // make_lite.py is optional
  const sound = openSound(PROJECT, pkg["live-studio"]); // null: the film has no sound lanes for the studio to edit
  const readers = new Set();
  let syncVoiceAssemble = () => {};
  let syncNotes = () => {};
  const voice = openVoice(PROJECT, pkg["live-studio"], {
    releaseFile: (target) => {
      for (const r of readers) if (r.file === target) r.stop();
    },
    onAssemble: () => syncVoiceAssemble(),
  });
  // "live-studio": { camTimeline: file }: the camera keys, which the film also puts in EDIT.cam (the page previews edits there)
  const camRel = pkg["live-studio"]?.camTimeline,
    cam = camRel ? openTimelineFile(PROJECT, camRel, CamTimeline) : null;
  // "live-studio": { keyFiles: { file: EDIT key } }: Steve's moves, the props' keys... as rows the studio retimes (contract.ts keyRows)
  const keyFiles = Object.entries(pkg["live-studio"]?.keyFiles ?? {}).map(([rel, edit]) => {
    const requiredRows = pkg["live-studio"]?.requiredKeyRows?.[edit] ?? [],
      schema = keyFileSchema(requiredRows);
    return { rel, edit, requiredRows, schema, ...openTimelineFile(PROJECT, rel, schema) };
  });
  // "live-studio": { shotsTimeline: file }: SHOTS as data (the film reads them from EDIT.shots), so a cut can be moved by hand
  const shotsRel = pkg["live-studio"]?.shotsTimeline,
    shots = shotsRel ? openTimelineFile(PROJECT, shotsRel, ShotsTimeline) : null;
  // "live-studio": { textTimeline: file }: titles, arrows and circles over the picture (EDIT.text, drawn by film-stage/titles.ts)
  const textRel = pkg["live-studio"]?.textTimeline,
    text = textRel ? openTimelineFile(PROJECT, textRel, TextTimeline) : null;
  const adjustmentRel = pkg["live-studio"]?.adjustmentTimeline,
    adjustment = adjustmentRel
      ? openTimelineFile(PROJECT, adjustmentRel, AdjustmentTimeline)
      : null;
  const timingRel = pkg["live-studio"]?.timingTimeline,
    timing = timingRel ? openTimelineFile(PROJECT, timingRel, TimingTimeline) : null;
  const openfilm = openOpenFilm(PROJECT, pkg["live-studio"]);
  const editable = [sound, cam, shots, text, adjustment, timing, openfilm, ...keyFiles].filter(
    Boolean,
  );
  const ownWrites = () => [
    ...editable.filter((f) => f.ownWrite()).map((f) => f.FILE),
    ...(voice.ownEditWrite() ? [EDIT] : []),
  ]; // files whose last change was the studio's own save
  const handEdited = editable.map((f) => f.FILE);
  const history = openFilmHistory(PROJECT, {
    beforeCapture: () => {
      return editable.flatMap((file) => {
        try {
          file.read();
          return [];
        } catch (error) {
          return [`${relative(PROJECT, file.FILE)}: ${error.message}`];
        }
      });
    },
    afterRestore: () => {
      for (const file of editable) file.reloadProtection();
    },
    changed: () => send("history"),
  });
  // "live-studio": { liveLanes: true }: the page plays the lanes itself and the film's sound.py, given --live-lanes, leaves them
  // out of the mix, so a lane edit is heard at once. A mix made before the switch still holds them: the marker says it was remade
  const LIVE = !!(sound && pkg["live-studio"]?.liveLanes);
  const LIVE_MARK = join(WORK, "mix_dry.live");
  const mixIsLive = () =>
    existsSync(LIVE_MARK) &&
    existsSync(MIX) &&
    statSync(LIVE_MARK).mtimeMs >= statSync(MIX).mtimeMs;
  // Without the lanes, everything else in the timeline file is still the mix's (voiceGain, voice)
  const offLanes = (file) => {
    try {
      const {
        beds: _beds,
        sfx: _sfx,
        tracks: _tracks,
        ...rest
      } = JSON.parse(readFileSync(file, "utf8"));
      return JSON.stringify(rest);
    } catch {
      return ":unreadable";
    }
  };
  const lanesOf = (file) => {
    try {
      const { beds, sfx, tracks } = JSON.parse(readFileSync(file, "utf8"));
      return JSON.stringify([beds, sfx, tracks]);
    } catch {
      return null;
    }
  };
  mkdirSync(WORK, { recursive: true });

  const notes = createNotes(PROJECT);
  const textOf = (f) => (existsSync(f) ? readFileSync(f, "utf8") : undefined);
  const readChoices = () => (existsSync(CHOICES) ? JSON.parse(readFileSync(CHOICES, "utf8")) : {});

  // ---------- The film contract (contract.ts): said once when it changes, in this terminal and to the pages
  let fileProblems = null,
    pageProblems = null; // null: the first check says "ok" too
  const sayContract = (what, list) =>
    console.log(
      list.length
        ? `\nfilm contract, ${what} (see ${DOC}):\n${list.join("\n\n")}\n`
        : `film contract, ${what}: ok`,
    );
  const checkContract = () => {
    const now = checkFiles(contractFiles(PROJECT));
    if (JSON.stringify(now) === JSON.stringify(fileProblems)) return;
    fileProblems = now;
    sayContract("files", now);
    send("contract");
  };
  const pageSays = (list) => {
    const now = list.map((x) => x.slice(0, 4000)).slice(0, 50);
    if (JSON.stringify(now) !== JSON.stringify(pageProblems)) {
      pageProblems = now;
      sayContract("code, found by the page", now);
    }
  };

  const choose = ({ group, set, gain }) => {
    const next = { ...readChoices(), [group]: { set, gain } };
    if (problems(Choices, next, "choice").length) return false;
    writeFileSync(CHOICES, JSON.stringify(next, null, 1) + "\n");
    checkContract();
    return true;
  };
  const trials = () => {
    if (!existsSync(TRIALS)) return null;
    const all = JSON.parse(readFileSync(TRIALS, "utf8")),
      chosen = readChoices();
    for (const g in all) all[g].chosen = chosen[g] ?? null;
    return all;
  };
  const shotComments = () => {
    if (shots) {
      try {
        return (shots.read()?.data ?? []).map((s) => s.name ?? "");
      } catch {
        return [];
      }
    } // half-written by an agent: no names this time
    const s = readFileSync(join(SRC, "scene.ts"), "utf8").replace(/\r/g, "");
    return s
      .slice(s.indexOf("export const SHOTS = ["), s.indexOf("];\nexport let DURATION"))
      .split("\n")
      .slice(1)
      .filter((l) => l.trim())
      .map((l) => l.match(/\/\/ (.*)$/)?.[1] ?? "");
  };
  // Which version of the film a note was said about, when the film is in git
  const stamp = () =>
    new Promise((done) =>
      execFile(
        "git",
        ["describe", "--tags", "--always", "--dirty"],
        { cwd: PROJECT, encoding: "utf8" },
        (e, out) => done({ version: e ? undefined : out.trim() }),
      ),
    );

  // ---------- Files that are swapped in whole while a page may be reading them
  // Windows won't replace a file someone is still reading. A mix swaps in by cutting its readers off: the page fetches the new one right after
  const openRead = (file, range) => {
    const s = createReadStream(file, range),
      me = { file, stop: () => s.destroy() };
    readers.add(me);
    s.on("close", () => readers.delete(me));
    return s;
  };
  const swapIn = async (fresh, target) => {
    for (let i = 0; i < 50; i++) {
      for (const r of readers) if (r.file === target) r.stop();
      try {
        renameSync(fresh, target);
        return true;
      } catch {
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    console.log("could not replace", target);
    return false;
  };
  const newestOf = (names) => {
    let best = null,
      bestMtime = -1;
    for (const name of names) {
      const file = join(RENDERS, name);
      if (!existsSync(file)) continue;
      const mtime = statSync(file).mtimeMs;
      if (mtime > bestMtime) {
        best = file;
        bestMtime = mtime;
      }
    }
    return best;
  };
  const videoSource = () =>
    newestOf(["final.mp4", "draft.mp4"]) ?? newestOf(["final_video.mp4", "draft_video.mp4"]);
  let smallVideoing = null;
  const smallVideo = () => {
    const source = videoSource();
    if (!source) return Promise.resolve(null);
    if (existsSync(VIDEO_SMALL) && statSync(VIDEO_SMALL).mtimeMs >= statSync(source).mtimeMs)
      return Promise.resolve(VIDEO_SMALL);
    const fresh = VIDEO_SMALL + ".new.mp4";
    return (smallVideoing ??= new Promise((done) => {
      mkdirSync(WORK, { recursive: true });
      const proc = spawn(
        "ffmpeg",
        [
          "-y",
          "-v",
          "error",
          "-i",
          source,
          "-vf",
          "scale=w='if(gte(iw,ih),-2,trunc(min(540,iw)/2)*2)':h='if(gte(iw,ih),trunc(min(540,ih)/2)*2,-2)'",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "25",
          "-maxrate",
          "1000k",
          "-bufsize",
          "2000k",
          "-profile:v",
          "main",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "96k",
          "-ac",
          "2",
          "-movflags",
          "+faststart",
          fresh,
        ],
        { stdio: "inherit" },
      );
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (!ok) rmSync(fresh, { force: true });
        smallVideoing = null;
        done(ok ? VIDEO_SMALL : source);
      };
      proc.on("error", () => finish(false));
      proc.on("close", async (code) =>
        finish(!code && existsSync(fresh) && (await swapIn(fresh, VIDEO_SMALL))),
      );
    }));
  };
  let smallMixing = null,
    smallSource = null,
    smallBuildSeq = 0,
    mixSeq = 0;
  const smallMix = () => {
    if (!existsSync(MIX)) return Promise.resolve();
    const mixSt = statSync(MIX);
    const sameSource = smallSource
      ? smallBuildSeq === mixSeq &&
        smallSource.size === mixSt.size &&
        smallSource.mtimeMs === mixSt.mtimeMs
      : statSync(MIX_SMALL, { throwIfNoEntry: false })?.mtimeMs >= mixSt.mtimeMs;
    if (existsSync(MIX_SMALL) && sameSource) {
      smallSource ??= { size: mixSt.size, mtimeMs: mixSt.mtimeMs };
      smallBuildSeq = mixSeq;
      return Promise.resolve();
    }
    // Made beside it and swapped in whole: a phone may be halfway through downloading the old one
    const fresh = MIX_SMALL + ".new.webm";
    const builtForSeq = mixSeq;
    return (smallMixing ??= new Promise((done) =>
      spawn(
        "ffmpeg",
        ["-v", "error", "-y", "-i", MIX, "-ac", "1", "-c:a", "libopus", "-b:a", "48k", fresh],
        { stdio: "inherit" },
      )
        .on("error", (e) => {
          console.log("ffmpeg is needed for the small mix:", e.message);
          smallMixing = null;
          done();
        })
        .on("close", async (code) => {
          if (!code) {
            await swapIn(fresh, MIX_SMALL);
            if (builtForSeq === mixSeq) {
              smallBuildSeq = builtForSeq;
              smallSource = { size: mixSt.size, mtimeMs: mixSt.mtimeMs };
            }
          }
          smallMixing = null;
          done();
        }),
    ));
  };

  // ---------- The sound mix: written beside the old one and swapped in whole, so a page playing it never reads a half-written file
  let mixing = false,
    again = false;
  const remix = () => {
    if (mixing) {
      again = true;
      return;
    }
    mixing = true;
    send("sound-start");
    const t0 = Date.now(),
      fresh = MIX + ".new.wav";
    spawn(PYTHON, ["sound.py", fresh, "--dry", ...(LIVE ? ["--live-lanes"] : [])], {
      cwd: PROJECT,
      stdio: "inherit",
    }).on("close", async (code) => {
      if (!code && (await swapIn(fresh, MIX))) {
        mixSeq++;
        smallSource = null;
        if (LIVE) writeFileSync(LIVE_MARK, "");
        else rmSync(LIVE_MARK, { force: true });
      }
      mixing = false;
      console.log(
        code ? "sound mix failed" : `sound mixed in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      if (!code) {
        send("sound");
        checkContract();
      }
      if (again) {
        again = false;
        remix();
      }
    });
  };
  const mapVoice = () => {
    try {
      const { words } = writeVoiceMap(PROJECT, VOICE_MAP);
      console.log(`words ${words}`);
      send("voice");
    } catch (e) {
      console.log("voice map failed:", e.message);
    }
  };

  // ---------- Watching the film's files. Code is Vite's to watch (src/vite_film.mjs); these are the files code doesn't import
  const watchers = [];
  const watch = (...a) => watchers.push(fsWatch(...a));
  const timelineContent = (file) => {
    const text = textOf(file);
    if (text === undefined) return undefined;
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {
      return null;
    }
  };
  const watchDocument = (file, change, { snapshot = timelineContent, acceptMissing = false } = {}) => {
    if (!file) return;
    const target = file.FILE;
    let folder = dirname(target);
    while (!existsSync(folder) && folder !== PROJECT) folder = dirname(folder);
    let seen = snapshot(target), accepted = seen;
    const refresh = debounce(() => {
      let now;
      try {
        now = snapshot(target);
      } catch {
        return;
      }
      if (now === seen) return;
      seen = now;
      checkContract();
      if (now === accepted || now === null || (!acceptMissing && now === undefined)) return;
      accepted = now;
      change();
    }, 150);
    watch(folder, { recursive: folder !== dirname(target) }, (_, name) => {
      if (!name || resolve(folder, String(name)) === target) refresh();
    });
  };
  const announce = (file, surface, say) => {
    if (!file.personWrite()) activity?.add({ surface, say });
  };
  const start = () => {
    history.start();
    for (const file of [sound, cam, shots, text, adjustment, timing, ...keyFiles].filter(Boolean)) {
      if (!existsSync(dirname(file.FILE))) continue;
      watch(
        dirname(file.FILE),
        debounce(() => {
          try {
            file.read();
          } catch (error) {
            console.error(`Edit protection: ${error.message}`);
          }
        }, 50),
      );
    }
    // Windows can report a file as changed just because something read it, and every remix restarts the sound on every open page:
    // what counts is whether anything's size or time really moved. A file deleted is a change too, never a crash
    const stampOf = (p) => {
      try {
        if (LIVE && p === sound.FILE) return offLanes(p);
        const s = statSync(p);
        return s.isDirectory()
          ? readdirSync(p)
              .map((n) => n + stampOf(join(p, n)))
              .join()
          : `:${s.size}:${s.mtimeMs}`;
      } catch {
        return ":gone";
      }
    };
    const soundFiles = [...new Set([join(PROJECT, "sound.py"), ...SOUND_INPUTS])].filter((f) =>
      existsSync(f),
    );
    const stamps = () => soundFiles.map(stampOf).join();
    let soundsSeen = stamps();
    const soundsChanged = debounce(() => {
      const now = stamps();
      if (now !== soundsSeen) {
        soundsSeen = now;
        checkContract();
        remix();
      }
    }, 300);
    for (const f of soundFiles) watch(f, { recursive: statSync(f).isDirectory() }, soundsChanged);
    if (!existsSync(MIX) || !existsSync(TRIALS) || LIVE !== mixIsLive()) remix();
    // The server also saves timelines by atomic rename. Watch the parent so the next edit still arrives.
    if (LIVE) {
      watchDocument(sound, () => {
        if (sound.personWrite()) return;
        send("lanes");
        activity?.add({ surface: "sound", say: "Edited the sound lanes" });
      }, { snapshot: lanesOf });
    } else {
      watchDocument(sound, () => {
        if (soundFiles.includes(sound.FILE)) soundsChanged();
        announce(sound, "sound", "Edited the sound lanes");
      });
    }

    const timeline = (file, event, surface, message, data, after) =>
      watchDocument(file, () => {
        send(event, data);
        announce(file, surface, message);
        after?.();
      }, { acceptMissing: event === "openfilm" });
    timeline(cam, "cam", "cam", "Edited the camera keys");
    timeline(shots, "shots", "cam", "Edited the shots");
    timeline(text, "text", "text", "Edited the titles and text");
    timeline(adjustment, "adjustment", "adjust", "Edited the adjustment layers");
    timeline(timing, "timing", "speed", "Edited the timing (speed, freezes, gaps)", undefined, remix);
    timeline(openfilm, "openfilm", "openfilm", "Edited the overlay layers");
    keyFiles.forEach((file, i) =>
      timeline(file, "keys", "keys", `Edited the keys in ${basename(file.FILE)}`, i),
    );
    let watchingVoiceFile = false,
      voiceSeen = existsSync(VOICE) ? statSync(VOICE).mtimeMs : -1;
    const ensureVoiceFileWatch = (initial = false) => {
      if (watchingVoiceFile || !existsSync(VOICE)) return;
      watchingVoiceFile = true;
      voiceSeen = statSync(VOICE).mtimeMs;
      watch(
        VOICE,
        debounce(() => {
          if (!existsSync(VOICE)) return;
          const now = statSync(VOICE).mtimeMs;
          if (now !== voiceSeen) {
            voiceSeen = now;
            remix();
            mapVoice();
          }
        }, 500),
      );
      if (!existsSync(VOICE_MAP) || statSync(VOICE_MAP).mtimeMs < voiceSeen) mapVoice();
      if (!initial) remix();
    };
    ensureVoiceFileWatch(true);
    let watchingVoiceDir = false,
      voiceBootWatcher = null;
    const closeVoiceBootWatcher = () => {
      if (!voiceBootWatcher) return;
      const idx = watchers.indexOf(voiceBootWatcher);
      if (idx >= 0) watchers.splice(idx, 1);
      voiceBootWatcher.close();
      voiceBootWatcher = null;
    };
    const ensureVoiceWatch = (notify = false) => {
      if (watchingVoiceDir || !existsSync(voice.VOICE_DIR)) return;
      watchingVoiceDir = true;
      closeVoiceBootWatcher();
      let voiceDirSeen = stampOf(voice.VOICE_DIR);
      watch(
        voice.VOICE_DIR,
        { recursive: true },
        debounce(() => {
          const now = stampOf(voice.VOICE_DIR);
          if (now !== voiceDirSeen) {
            voiceDirSeen = now;
            ensureVoiceFileWatch(false);
            send("voice");
          }
        }, 200),
      );
      if (notify) {
        ensureVoiceFileWatch(false);
        send("voice");
      }
    };
    ensureVoiceWatch(false);
    if (!watchingVoiceDir) {
      voiceBootWatcher = fsWatch(
        PROJECT,
        debounce(() => {
          if (existsSync(voice.VOICE_DIR)) ensureVoiceWatch(true);
        }, 150),
      );
      watchers.push(voiceBootWatcher);
    }
    if (!existsSync(LITE) && has("make_lite.py"))
      spawn(PYTHON, ["make_lite.py"], { cwd: PROJECT, stdio: "inherit" });
    const notesWatcher = watchNotesFile(notes.file, () => send("notes"), { debounceMs: 80 });
    watchers.push(notesWatcher); // external edits or atomic rewrites show up without dropping events
    syncNotes = () => notesWatcher.sync();
    // Voice edits and takes live in edit.json: keep the mix and word map following them
    const voiceEdits = () => {
      try {
        return JSON.stringify(JSON.parse(readFileSync(EDIT, "utf8")).voice.edits);
      } catch {
        return null;
      }
    };
    const voiceTakes = () => {
      try {
        return JSON.stringify(JSON.parse(readFileSync(EDIT, "utf8")).takes ?? []);
      } catch {
        return null;
      }
    };
    let editsSeen = voiceEdits(),
      takesSeen = voiceTakes();
    syncVoiceAssemble = () => {
      soundsSeen = stamps();
      if (existsSync(VOICE)) voiceSeen = statSync(VOICE).mtimeMs;
      ensureVoiceFileWatch(true);
      editsSeen = voiceEdits();
      takesSeen = voiceTakes();
      checkContract();
      if (sound) send("lanes");
      remix();
    };
    watch(
      EDIT,
      debounce(() => {
        checkContract();
        ensureVoiceWatch();
        ensureVoiceFileWatch(false);
        const nowTakes = voiceTakes();
        if (nowTakes !== null && nowTakes !== takesSeen) {
          takesSeen = nowTakes;
          if (existsSync(VOICE)) mapVoice();
          else send("voice");
        }
        const now = voiceEdits();
        if (now !== null && now !== editsSeen) {
          editsSeen = now;
          remix();
        }
      }, 100),
    );
    checkContract();
  };

  // A sound file for anything but this machine: Opus, about a tenth of the WAV, made once per version of the file
  const SFX_SMALL = join(WORK, "sfx_small"),
    makingSmall = new Map();
  // "live-studio": { ratio }: the frame's shape (frame.ts), set from the studio's Settings. Read from the file each time, so the
  // page, the renders and a hand edit agree; the pages reload to draw at it
  const ratio = () => ratioOf(readPkg());
  const preloads = () => {
    const parsed = StudioConfig.shape.preload.safeParse(readPkg()["live-studio"]?.preload);
    return parsed.success ? (parsed.data ?? []) : [];
  };
  const setRatio = (r) => {
    const now = readPkg();
    if (ratioOf(now) === r) return;
    now["live-studio"] = { ...now["live-studio"], ratio: r };
    if (r === "16:9") delete now["live-studio"].ratio;
    writeFileSync(PKG, JSON.stringify(now, null, 2) + "\n");
    checkContract();
    send("film");
  };
  const smallSfx = (name) => {
    const src = sound?.fileOf(name);
    if (!src) return Promise.resolve(null);
    const out = join(SFX_SMALL, `${name}.webm`);
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs)
      return Promise.resolve(out);
    if (!makingSmall.has(name)) {
      mkdirSync(SFX_SMALL, { recursive: true });
      const fresh = `${out}.new.webm`;
      makingSmall.set(
        name,
        new Promise((done) =>
          spawn(
            "ffmpeg",
            ["-v", "error", "-y", "-i", src, "-c:a", "libopus", "-b:a", "96k", fresh],
            { stdio: "inherit" },
          )
            .on("error", () => done(null))
            .on("close", async (code) => {
              makingSmall.delete(name);
              done(!code && (await swapIn(fresh, out)) ? out : null);
            }),
        ),
      );
    }
    return makingSmall.get(name);
  };

  const measureSound = (list, i, data) =>
    new Promise((done, fail) => {
      const script = resolve(STUDIO, "../../scripts/sound/mix.py");
      const child = execFile(
        PYTHON,
        [script, "--measure", list, String(i)],
        { cwd: PROJECT, windowsHide: true, timeout: 250000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            fail(new Error(stderr.trim().split("\n").at(-1) || error.message));
            return;
          }
          try {
            done(JSON.parse(stdout));
          } catch (e) {
            fail(e);
          }
        },
      );
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(data));
    });

  return {
    PROJECT,
    NAME,
    SRC,
    PUBLIC,
    WORK,
    MIX,
    MIX_SMALL,
    VIDEO_SMALL,
    LITE,
    EDIT,
    VOICE_MAP,
    hosts,
    threeFrom,
    smallSfx,
    measureSound,
    processSound: (name, settings, small) =>
      renderAudio(sound.fileOf(name), settings, PYTHON, {
        small,
        kept: join(WORK, "processed"),
      }),
    analyzeBeats: (name, settings) => analyzeBeats(sound.fileOf(name), settings, PYTHON),
    liveLanes: () => LIVE && mixIsLive(),
    notes,
    syncNotes: () => syncNotes(),
    readChoices,
    choose,
    ratio,
    preloads,
    setRatio,
    features: () => ({
      cam: !!cam,
      shots: !!shots,
      text: !!text,
      adjustment: !!adjustment,
      timing: !!timing,
      keys: keyFiles.length > 0,
      sound: !!sound,
      voice: !!voice,
      voiceMap: existsSync(VOICE_MAP),
      trials: existsSync(TRIALS),
      choices: existsSync(CHOICES),
      mix: existsSync(MIX),
    }),
    trials,
    shotComments,
    stamp,
    sound,
    voice,
    cam,
    shots,
    text,
    adjustment,
    openfilm,
    timing,
    keyFiles,
    ownWrites,
    handEdited,
    history,
    contract: () => ({ files: fileProblems ?? [] }),
    hasPageProblems: () => pageProblems === null || pageProblems.length > 0,
    pageSays,
    openRead,
    smallMix,
    videoSource,
    smallVideo,
    start,
    stop: () => {
      history.close();
      watchers.splice(0).forEach((w) => w.close());
    },
  };
};
