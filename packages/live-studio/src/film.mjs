// One film opened in the studio: where its files are, and the jobs that keep the studio's copies of them fresh (the sound mix,
// the voice's word times, the phone copies, the film contract). Everything under `project` is the film's,
// everything beside this file is the studio's.
import { execFile, spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch as fsWatch, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CamTimeline, checkFiles, Choices, DOC, Edit, KeyFile, problems, ShotsTimeline, SoundTimeline, StudioConfig, TextTimeline, Trials } from "./contract.mjs";
import { ratioOf } from "./frame.mjs";
import { createNotes } from "./notes.mjs";
import { openSound } from "./sound.mjs";
import { openTimelineFile } from "./timeline_file.mjs";

export const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// One copy of three: the film's and the studio's would each otherwise bring their own, and objects from one fail instanceof in the other
export const threeFromOf = (project) => (existsSync(join(project, "node_modules/three")) ? project : STUDIO);
// The voice's lines and words in the voice's own seconds, which the studio writes on opening a film (voice_map.py)
export const voiceMapOf = (project) => join(project, "renders/live/voice_map.json");

const debounce = (f, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => f(...a), ms); }; };

export const openFilm = (projectDir, { send }) => {
  const PROJECT = resolve(projectDir);
  const SRC = join(PROJECT, "src");
  if (!existsSync(join(SRC, "scene.ts"))) throw new Error(`${PROJECT} has no src/scene.ts: run this inside a film, or try bun run demo`);
  const VENV_PYTHON = join(PROJECT, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
  const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : process.platform === "win32" ? "python" : "python3";
  const PUBLIC = join(PROJECT, "assets/public");
  const WORK = join(PROJECT, "renders/live");
  const MIX = join(WORK, "mix_dry.wav"); // without the sounds being tried: the page plays those itself
  const MIX_SMALL = join(WORK, "mix_small.webm"); // the same mix for anything but this machine: a fifteenth of the size, and Opus stays on the clock where mp3 ran up to 30ms off
  const LITE = join(WORK, "lite"); // small copies of the assets, see make_lite.py
  const TRIALS = join(WORK, "trials.json");
  const EDIT = join(SRC, "edit.json");
  const VOICE_MAP = voiceMapOf(PROJECT);
  const VOICE = join(PUBLIC, "agent/full_voice.wav");
  // What was picked in the studio ("Use"), {group: {set, gain}}, read by the film's own renders; older films named it sound_choices.json
  const CHOICES = [join(PROJECT, "sound_choices.json"), join(PROJECT, "choices.json")].find(existsSync) ?? join(PROJECT, "choices.json");
  // A machine's private name (Tailscale) has no place in the studio's public repo: the film lists the names it is reached by
  const HOSTS_FILE = join(PROJECT, ".live_hosts");
  const hosts = (existsSync(HOSTS_FILE) ? readFileSync(HOSTS_FILE, "utf8") : "").split(/\s+/).filter(Boolean).map((n) => n.toLowerCase());
  const threeFrom = threeFromOf(PROJECT);
  // What sound.py reads, so a change to any of it remixes: package.json "live-studio": { "sound": [paths] }, files or folders.
  // Never list a folder the mix writes into, or every remix starts the next. Without the key: what films made before it mixed from
  const PKG = join(PROJECT, "package.json");
  const readPkg = () => (existsSync(PKG) ? JSON.parse(readFileSync(PKG, "utf8")) : {});
  const pkg = readPkg();
  const NAME = pkg.name ?? basename(PROJECT); // the page's title and a still frame's file name
  const SOUND_INPUTS = (pkg["live-studio"]?.sound ?? ["sound.py", "src/timing.ts", "assets/public/agent/sfx2", "assets/public/agent/sfx_try"]).map((f) => join(PROJECT, f));
  const has = (script) => existsSync(join(PROJECT, script)); // voice_edit.py, voice_map.py and make_lite.py are optional
  const sound = openSound(PROJECT, pkg["live-studio"]); // null: the film has no sound lanes for the studio to edit
  // "live-studio": { camTimeline: file }: the camera keys, which the film also puts in EDIT.cam (the page previews edits there)
  const camRel = pkg["live-studio"]?.camTimeline, cam = camRel ? openTimelineFile(PROJECT, camRel, CamTimeline) : null;
  // "live-studio": { keyFiles: { file: EDIT key } }: Steve's moves, the props' keys... as rows the studio retimes (contract.mjs keyRows)
  const keyFiles = Object.entries(pkg["live-studio"]?.keyFiles ?? {}).map(([rel, edit]) => ({ rel, edit, ...openTimelineFile(PROJECT, rel, KeyFile) }));
  // "live-studio": { shotsTimeline: file }: SHOTS as data (the film reads them from EDIT.shots), so a cut can be moved by hand
  const shotsRel = pkg["live-studio"]?.shotsTimeline, shots = shotsRel ? openTimelineFile(PROJECT, shotsRel, ShotsTimeline) : null;
  // "live-studio": { textTimeline: file }: titles, arrows and circles over the picture (EDIT.text, drawn by film-stage/titles.ts)
  const textRel = pkg["live-studio"]?.textTimeline, text = textRel ? openTimelineFile(PROJECT, textRel, TextTimeline) : null;
  const ownWrites = () => [sound, cam, shots, text, ...keyFiles].filter((f) => f?.ownWrite()).map((f) => f.FILE); // files whose last change was the studio's own save
  const handEdited = [sound, cam, shots, text, ...keyFiles].filter(Boolean).map((f) => f.FILE); // the page loads these itself on every change (/api)
  // "live-studio": { liveLanes: true }: the page plays the lanes itself and the film's sound.py, given --live-lanes, leaves them
  // out of the mix, so a lane edit is heard at once. A mix made before the switch still holds them: the marker says it was remade
  const LIVE = !!(sound && pkg["live-studio"]?.liveLanes);
  const LIVE_MARK = join(WORK, "mix_dry.live");
  const mixIsLive = () => existsSync(LIVE_MARK) && existsSync(MIX) && statSync(LIVE_MARK).mtimeMs >= statSync(MIX).mtimeMs;
  // Without the lanes, everything else in the timeline file is still the mix's (voiceGain, voice)
  const offLanes = (file) => { try { const { beds, sfx, tracks, ...rest } = JSON.parse(readFileSync(file, "utf8")); return JSON.stringify(rest); } catch { return ":unreadable"; } };
  const lanesOf = (file) => { try { const { beds, sfx, tracks } = JSON.parse(readFileSync(file, "utf8")); return JSON.stringify([beds, sfx, tracks]); } catch { return null; } };
  mkdirSync(WORK, { recursive: true });

  const notes = createNotes(PROJECT);
  const textOf = (f) => (existsSync(f) ? readFileSync(f, "utf8") : undefined);
  const readChoices = () => (existsSync(CHOICES) ? JSON.parse(readFileSync(CHOICES, "utf8")) : {});

  // ---------- The film contract (contract.mjs): said once when it changes, in this terminal and to the pages
  let fileProblems = null, pageProblems = null; // null: the first check says "ok" too
  const sayContract = (what, list) => console.log(list.length ? `\nfilm contract, ${what} (see ${DOC}):\n${list.join("\n\n")}\n` : `film contract, ${what}: ok`);
  const checkContract = () => {
    const now = checkFiles({
      'package.json "live-studio"': [StudioConfig, JSON.stringify(readPkg()["live-studio"] ?? {})], "src/edit.json": [Edit, textOf(EDIT)], "renders/live/trials.json (from sound.py)": [Trials, textOf(TRIALS)], [CHOICES.slice(PROJECT.length + 1)]: [Choices, textOf(CHOICES)],
      ...(sound && { [pkg["live-studio"].soundTimeline]: [SoundTimeline, textOf(sound.FILE)] }),
      ...(cam && { [camRel]: [CamTimeline, textOf(cam.FILE)] }),
      ...(shots && { [shotsRel]: [ShotsTimeline, textOf(shots.FILE)] }),
      ...(text && { [textRel]: [TextTimeline, textOf(text.FILE)] }),
      ...Object.fromEntries(keyFiles.map((k) => [k.rel, [KeyFile, textOf(k.FILE)]])),
    });
    if (JSON.stringify(now) === JSON.stringify(fileProblems)) return;
    fileProblems = now;
    sayContract("files", now);
    send("contract");
  };
  const pageSays = (list) => {
    const now = list.map((x) => x.slice(0, 4000)).slice(0, 50);
    if (JSON.stringify(now) !== JSON.stringify(pageProblems)) { pageProblems = now; sayContract("code, found by the page", now); }
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
    const all = JSON.parse(readFileSync(TRIALS, "utf8")), chosen = readChoices();
    for (const g in all) all[g].chosen = chosen[g] ?? null;
    return all;
  };
  const shotComments = () => {
    if (shots) { try { return (shots.read()?.data ?? []).map((s) => s.name ?? ""); } catch { return []; } } // half-written by an agent: no names this time
    const s = readFileSync(join(SRC, "scene.ts"), "utf8").replace(/\r/g, "");
    return s.slice(s.indexOf("export const SHOTS = ["), s.indexOf("];\nexport let DURATION")).split("\n").slice(1).filter((l) => l.trim()).map((l) => l.match(/\/\/ (.*)$/)?.[1] ?? "");
  };
  // Which version of the film a note was said about, when the film is in git
  const stamp = () => new Promise((done) => execFile("git", ["describe", "--tags", "--always", "--dirty"], { cwd: PROJECT, encoding: "utf8" }, (e, out) => done({ version: e ? undefined : out.trim() })));

  // ---------- Files that are swapped in whole while a page may be reading them
  // Windows won't replace a file someone is still reading. A mix swaps in by cutting its readers off: the page fetches the new one right after
  const readers = new Set();
  const openRead = (file, range) => {
    const s = createReadStream(file, range), me = { file, stop: () => s.destroy() };
    readers.add(me);
    s.on("close", () => readers.delete(me));
    return s;
  };
  const swapIn = async (fresh, target) => {
    for (let i = 0; i < 50; i++) {
      for (const r of readers) if (r.file === target) r.stop();
      try { renameSync(fresh, target); return true; } catch { await new Promise((done) => setTimeout(done, 100)); }
    }
    console.log("could not replace", target);
    return false;
  };
  let smallMixing = null;
  const smallMix = () => {
    if (existsSync(MIX_SMALL) && statSync(MIX_SMALL).mtimeMs >= statSync(MIX).mtimeMs) return Promise.resolve();
    // Made beside it and swapped in whole: a phone may be halfway through downloading the old one
    const fresh = MIX_SMALL + ".new.webm";
    return (smallMixing ??= new Promise((done) => spawn("ffmpeg", ["-v", "error", "-y", "-i", MIX, "-ac", "1", "-c:a", "libopus", "-b:a", "48k", fresh], { stdio: "inherit" })
      .on("error", (e) => console.log("ffmpeg is needed for the small mix:", e.message))
      .on("close", async (code) => { if (!code) await swapIn(fresh, MIX_SMALL); smallMixing = null; done(); })));
  };

  // ---------- The sound mix: written beside the old one and swapped in whole, so a page playing it never reads a half-written file
  let mixing = false, again = false;
  const remix = () => {
    if (mixing) { again = true; return; }
    mixing = true;
    send("sound-start");
    const t0 = Date.now(), fresh = MIX + ".new.wav";
    spawn(PYTHON, ["sound.py", fresh, "--dry", ...(LIVE ? ["--live-lanes"] : [])], { cwd: PROJECT, stdio: "inherit" }).on("close", async (code) => {
      if (!code && await swapIn(fresh, MIX)) { if (LIVE) writeFileSync(LIVE_MARK, ""); else rmSync(LIVE_MARK, { force: true }); }
      mixing = false;
      console.log(code ? "sound mix failed" : `sound mixed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (!code) { send("sound"); checkContract(); }
      if (again) { again = false; remix(); }
    });
  };
  // A paced voice moves everything after it: work out where the words land, tell the film, then mix
  let voicing = false, voiceAgain = false;
  const editVoice = () => {
    if (!has("voice_edit.py")) { remix(); return; }
    if (voicing) { voiceAgain = true; return; }
    voicing = true;
    send("sound-start");
    const p = spawn(PYTHON, ["voice_edit.py"], { cwd: PROJECT, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("close", (code) => {
      voicing = false;
      if (code) { console.log("voice edit failed"); return; }
      let now, paced;
      try { now = JSON.parse(readFileSync(EDIT, "utf8")); paced = JSON.parse(out); } catch { console.log("voice edit: the edit file was mid-save, trying again"); setTimeout(editVoice, 500); return; }
      // Written only when pacing really moved, or a file already right would be reformatted and read as a change
      if (Object.keys(paced).some((k) => JSON.stringify(now.voice[k]) !== JSON.stringify(paced[k]))) {
        Object.assign(now.voice, paced);
        writeFileSync(EDIT, JSON.stringify(now, null, 0));
      }
      if (voiceAgain) { voiceAgain = false; editVoice(); return; }
      remix();
    });
  };
  let mapping = false;
  const mapVoice = () => {
    if (mapping) return;
    mapping = true;
    const p = spawn(PYTHON, ["voice_map.py", VOICE_MAP], { cwd: PROJECT, stdio: ["ignore", "pipe", "inherit"] });
    p.stdout.on("data", () => send("voice"));
    p.on("close", (code) => { mapping = false; if (code) console.log("voice map failed"); else if (!Object.keys(JSON.parse(readFileSync(EDIT, "utf8")).voice.edits).length) editVoice(); });
  };

  // ---------- Watching the film's files. Code is Vite's to watch (src/vite_film.mjs); these are the files code doesn't import
  const watchers = [];
  const watch = (...a) => watchers.push(fsWatch(...a));
  const start = () => {
    // Windows can report a file as changed just because something read it, and every remix restarts the sound on every open page:
    // what counts is whether anything's size or time really moved. A file deleted is a change too, never a crash
    const stampOf = (p) => { try { if (LIVE && p === sound.FILE) return offLanes(p); const s = statSync(p); return s.isDirectory() ? readdirSync(p).map((n) => n + stampOf(join(p, n))).join() : `:${s.size}:${s.mtimeMs}`; } catch { return ":gone"; } };
    const soundFiles = [...new Set([join(PROJECT, "sound.py"), ...SOUND_INPUTS])].filter((f) => existsSync(f));
    const stamps = () => soundFiles.map(stampOf).join();
    let soundsSeen = stamps();
    const soundsChanged = debounce(() => { const now = stamps(); if (now !== soundsSeen) { soundsSeen = now; checkContract(); remix(); } }, 300);
    for (const f of soundFiles) watch(f, { recursive: statSync(f).isDirectory() }, soundsChanged);
    if (!existsSync(MIX) || !existsSync(TRIALS) || LIVE !== mixIsLive()) remix();
    // Lanes the page plays itself start no remix: an agent's edit to them is just news for the pages
    if (LIVE) {
      let lanesSeen = lanesOf(sound.FILE);
      watch(sound.FILE, debounce(() => { const now = lanesOf(sound.FILE); if (now !== null && now !== lanesSeen) { lanesSeen = now; if (!sound.ownWrite()) send("lanes"); } }, 150));
    }
    // Hand-edited files: every open page hears of a change, the one that saved it too (its load finds the version it already
    // has), so a second page open on the film never keeps an old copy to save over
    if (cam && existsSync(cam.FILE)) {
      let camSeen = textOf(cam.FILE);
      watch(cam.FILE, debounce(() => { const now = textOf(cam.FILE); if (now !== undefined && now !== camSeen) { camSeen = now; checkContract(); send("cam"); } }, 150));
    }
    if (shots && existsSync(shots.FILE)) {
      let shotsSeen = textOf(shots.FILE);
      watch(shots.FILE, debounce(() => { const now = textOf(shots.FILE); if (now !== undefined && now !== shotsSeen) { shotsSeen = now; checkContract(); send("shots"); } }, 150));
    }
    if (text && existsSync(text.FILE)) {
      let textSeen = textOf(text.FILE);
      watch(text.FILE, debounce(() => { const now = textOf(text.FILE); if (now !== undefined && now !== textSeen) { textSeen = now; checkContract(); send("text"); } }, 150));
    }
    keyFiles.forEach((k, i) => {
      if (!existsSync(k.FILE)) return;
      let seen = textOf(k.FILE);
      watch(k.FILE, debounce(() => { const now = textOf(k.FILE); if (now !== undefined && now !== seen) { seen = now; checkContract(); send("keys", i); } }, 150));
    });
    // Only a new take is worth a Whisper run
    if (existsSync(VOICE) && has("voice_map.py")) {
      let voiceSeen = statSync(VOICE).mtimeMs;
      watch(VOICE, debounce(() => { const now = statSync(VOICE).mtimeMs; if (now !== voiceSeen) { voiceSeen = now; remix(); mapVoice(); } }, 500));
      if (!existsSync(VOICE_MAP) || statSync(VOICE_MAP).mtimeMs < statSync(VOICE).mtimeMs) mapVoice();
    }
    if (!existsSync(LITE) && has("make_lite.py")) spawn(PYTHON, ["make_lite.py"], { cwd: PROJECT, stdio: "inherit" });
    watch(notes.file, debounce(() => send("notes"), 100)); // the agent ticking a note off shows up here too
    // Voice edits are made in the file: the voice and the mix follow it
    const voiceEdits = () => { try { return JSON.stringify(JSON.parse(readFileSync(EDIT, "utf8")).voice.edits); } catch { return null; } };
    let editsSeen = voiceEdits();
    watch(EDIT, debounce(() => { checkContract(); const now = voiceEdits(); if (now !== null && now !== editsSeen) { editsSeen = now; editVoice(); } }, 100));
    checkContract();
  };

  // A sound file for anything but this machine: Opus, about a tenth of the WAV, made once per version of the file
  const SFX_SMALL = join(WORK, "sfx_small"), makingSmall = new Map();
  // "live-studio": { ratio }: the frame's shape (frame.mjs), set from the studio's Settings. Read from the file each time, so the
  // page, the renders and a hand edit agree; the pages reload to draw at it
  const ratio = () => ratioOf(readPkg());
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
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return Promise.resolve(out);
    if (!makingSmall.has(name)) {
      mkdirSync(SFX_SMALL, { recursive: true });
      const fresh = `${out}.new.webm`;
      makingSmall.set(name, new Promise((done) => spawn("ffmpeg", ["-v", "error", "-y", "-i", src, "-c:a", "libopus", "-b:a", "96k", fresh], { stdio: "inherit" })
        .on("error", () => done(null))
        .on("close", async (code) => { makingSmall.delete(name); done(!code && await swapIn(fresh, out) ? out : null); })));
    }
    return makingSmall.get(name);
  };

  const measureSound = (list, i, data) => new Promise((done, fail) => {
    const script = resolve(STUDIO, "../../scripts/sound/mix.py");
    const child = execFile(PYTHON, [script, "--measure", list, String(i)], { cwd: PROJECT, windowsHide: true, timeout: 250000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { fail(new Error(stderr.trim().split("\n").at(-1) || error.message)); return; }
      try { done(JSON.parse(stdout)); } catch (e) { fail(e); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(data));
  });

  return {
    PROJECT, NAME, SRC, PUBLIC, WORK, MIX, MIX_SMALL, LITE, EDIT, VOICE_MAP, hosts, threeFrom, smallSfx, measureSound,
    liveLanes: () => LIVE && mixIsLive(),
    notes, readChoices, choose, ratio, setRatio, trials, shotComments, stamp, sound, cam, shots, text, keyFiles, ownWrites, handEdited,
    contract: () => ({ files: fileProblems }), pageSays,
    openRead, smallMix, start, stop: () => watchers.splice(0).forEach((w) => w.close()),
  };
};
