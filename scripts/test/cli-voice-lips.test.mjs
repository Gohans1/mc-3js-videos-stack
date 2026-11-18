import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { mouthCues } from "../../packages/live-studio/src/lips.ts";
import { MOUTH_MAP, mouthFaults, rhubarbPath } from "../../packages/live-studio/src/mouth-map.mjs";

const REPO = resolve(import.meta.dir, "../..");
const LIPS_CLI = join(REPO, "scripts/voice/lips.ts");
const REAL_RHUBARB = rhubarbPath();
const HAS_REAL_RHUBARB = existsSync(REAL_RHUBARB);
const HAS_FFMPEG = Boolean(Bun.which("ffmpeg"));

let suiteRoot = "";
let stubRhubarb = "";
let stubFfmpeg = "";

function makeSilenceWav(seconds = 0.25, sampleRate = 16000) {
  const numSamples = Math.max(1, Math.floor(seconds * sampleRate));
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

function makeToneWav(seconds = 0.4, sampleRate = 16000, freq = 320) {
  const buf = makeSilenceWav(seconds, sampleRate);
  const numSamples = (buf.length - 44) / 2;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const amp = Math.sin(2 * Math.PI * freq * t) * (i % 3200 < 2200 ? 0.45 : 0.02);
    buf.writeInt16LE(Math.round(amp * 32767), 44 + i * 2);
  }
  return buf;
}

function makeFilm(prefix = "cli-voice-lips-") {
  const dir = mkdtempSync(join(suiteRoot, prefix));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "voice/takes"), { recursive: true });
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "export {};\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "probe-film", private: true }, null, 2),
  );
  return dir;
}

function writeEdit(film, edit) {
  writeFileSync(join(film, "src/edit.json"), JSON.stringify(edit, null, 2));
}

test("invalid cached cue times and shapes require regeneration and never enter mouth.json", () => {
  const film = makeFilm("invalid-cues-");
  writeEdit(film, { takes: [{ id: "01", by: "steve", text: "Hello" }] });
  const audio = join(film, "voice/takes/01.wav");
  writeFileSync(audio, makeToneWav());
  writeFileSync(
    `${audio}.words.json`,
    JSON.stringify({ dur: 0.4, words: [{ w: "Hello", s: 0.05, e: 0.3 }] }),
  );
  for (const cues of [
    [[-10, "A"]],
    [[0, "INVALID"]],
    [
      [0.2, "A"],
      [0.1, "X"],
    ],
  ]) {
    writeFileSync(`${audio}.mouth.json`, JSON.stringify({ cues }));
    expect(mouthFaults(film).length).toBeGreaterThan(0);
    const r = runLips([], { cwd: film, env: { RHUBARB: join(film, "missing-rhubarb") } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Rhubarb");
    expect(existsSync(join(film, MOUTH_MAP))).toBe(false);
  }
});

function runLips(args = [], opts = {}) {
  const { cwd = REPO, env = {} } = opts;
  return spawnSync(process.execPath, [LIPS_CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function runLipsAsync(args = [], opts = {}) {
  const { cwd = REPO, env = {} } = opts;
  return new Promise((resolveDone) => {
    const child = spawn(process.execPath, [LIPS_CLI, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolveDone({ status, stdout, stderr }));
  });
}

async function withStudioServer(film, fn) {
  const events = [];
  const srv = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      events.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      events.push(null);
    }
    res.writeHead(200);
    res.end("ok");
  });
  await new Promise((done) => srv.listen(0, "127.0.0.1", done));
  const { port } = srv.address();
  writeFileSync(join(film, "renders/live/studio.json"), JSON.stringify({ port }));
  try {
    return await fn(events);
  } finally {
    srv.close();
  }
}

function compileStubs() {
  const binDir = join(suiteRoot, "bin");
  mkdirSync(binDir, { recursive: true });
  const ext = process.platform === "win32" ? ".exe" : "";

  const rhubarbSrc = join(suiteRoot, "stub-rhubarb.ts");
  writeFileSync(
    rhubarbSrc,
    `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const val = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};
const out = val("-o");
const dialogPath = val("-d");
const recognizer = val("-r");
const audio = args[args.length - 1];
const dialog = dialogPath ? readFileSync(dialogPath, "utf8") : undefined;
const logPath = process.env.STUB_RHUBARB_LOG;
if (logPath) {
  appendFileSync(logPath, JSON.stringify({ args, recognizer, dialog, audio }) + "\\n");
}
const failIds = (process.env.STUB_RHUBARB_FAIL_MATCH ?? "").split(",").filter(Boolean);
if (
  (audio && failIds.some((s) => audio.includes(s))) ||
  (dialog && failIds.some((s) => dialog.includes(s)))
) {
  console.error("stub rhubarb failed");
  process.exit(1);
}
if (process.env.STUB_RHUBARB_EMPTY === "1") {
  if (out) writeFileSync(out, JSON.stringify({ mouthCues: [] }));
  process.exit(0);
}
if (process.env.STUB_RHUBARB_BAD_JSON === "1") {
  if (out) writeFileSync(out, "{not json");
  process.exit(0);
}
if (out) {
  writeFileSync(
    out,
    JSON.stringify({
      mouthCues: [
        { start: 0.0, end: 0.1, value: "X" },
        { start: 0.1, end: 0.22, value: "B" },
        { start: 0.22, end: 0.3, value: "X" },
      ],
    }),
  );
}
`,
  );
  stubRhubarb = join(binDir, `rhubarb${ext}`);
  const r1 = spawnSync("bun", ["build", "--compile", rhubarbSrc, "--outfile", stubRhubarb], {
    cwd: suiteRoot,
    encoding: "utf8",
  });
  if (r1.status !== 0) {
    throw new Error(`failed to compile stub rhubarb: ${r1.stderr || r1.stdout}`);
  }

  const ffmpegSrc = join(suiteRoot, "stub-ffmpeg.ts");
  writeFileSync(
    ffmpegSrc,
    `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const iIdx = args.indexOf("-i");
const input = iIdx >= 0 ? args[iIdx + 1] : undefined;
const out = args[args.length - 1];
const ffLogPath = process.env.STUB_FFMPEG_LOG;
if (ffLogPath) {
  appendFileSync(ffLogPath, JSON.stringify({ input, out }) + "\\n");
}
if (!input || !existsSync(input)) {
  console.error("stub ffmpeg missing input");
  process.exit(1);
}
const raw = readFileSync(input);
if (raw.toString("utf8", 0, 7) === "CORRUPT") {
  console.error("stub ffmpeg corrupt input");
  process.exit(1);
}
const ffFail = (process.env.STUB_FFMPEG_FAIL_MATCH ?? "").split(",").filter(Boolean);
if (ffFail.some((s) => input.includes(s))) {
  console.error("stub ffmpeg failed on " + input);
  process.exit(1);
}
const dataSize = 3200;
const wav = Buffer.alloc(44 + dataSize);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + dataSize, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24);
wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(dataSize, 40);
if (out) writeFileSync(out, wav);
`,
  );
  stubFfmpeg = join(binDir, `ffmpeg${ext}`);
  const r2 = spawnSync("bun", ["build", "--compile", ffmpegSrc, "--outfile", stubFfmpeg], {
    cwd: suiteRoot,
    encoding: "utf8",
  });
  if (r2.status !== 0) {
    throw new Error(`failed to compile stub ffmpeg: ${r2.stderr || r2.stdout}`);
  }
}

function stubEnv(extra = {}) {
  const sep = process.platform === "win32" ? ";" : ":";
  return {
    RHUBARB: stubRhubarb,
    PATH: `${dirname(stubFfmpeg)}${sep}${process.env.PATH ?? ""}`,
    ...extra,
  };
}

beforeAll(() => {
  suiteRoot = mkdtempSync(join(tmpdir(), "cli-voice-lips-suite-"));
  compileStubs();
});

afterAll(() => {
  if (suiteRoot && existsSync(suiteRoot)) {
    rmSync(suiteRoot, { recursive: true, force: true });
  }
});

describe("voice:lips CLI argument and pre-flight checks", () => {
  test("--help, -h, and help exit 0 even outside a film or with broken edit.json", () => {
    const film = makeFilm();
    writeFileSync(join(film, "src/edit.json"), "{broken");
    for (const flag of ["--help", "-h", "help"]) {
      const outside = runLips([flag], { cwd: suiteRoot });
      expect(outside.status).toBe(0);
      expect(outside.stdout).toContain(MOUTH_MAP);
      expect(outside.stdout).toContain("voice/takes/<take>");

      const broken = runLips([flag], { cwd: film });
      expect(broken.status).toBe(0);
      expect(broken.stdout).toContain("Next:");
    }
  });

  test("unknown flags exit 2 before reading broken edit.json or mutating mouth.json", () => {
    const film = makeFilm();
    writeFileSync(join(film, "src/edit.json"), "{broken");
    const mouthPath = join(film, MOUTH_MAP);
    writeFileSync(mouthPath, '{"sentinel":true}\n');

    for (const flag of ["--bogus", "--yes"]) {
      const res = runLips([flag], { cwd: film });
      expect(res.status).toBe(2);
      expect(res.stderr.toLowerCase()).toContain("unknown");
      expect(readFileSync(mouthPath, "utf8")).toBe('{"sentinel":true}\n');
    }
  });

  test("running outside a film directory exits 2", () => {
    const outside = mkdtempSync(join(suiteRoot, "not-a-film-"));
    const res = runLips([], { cwd: outside });
    expect(res.status).toBe(2);
  });

  test("env variable typo RHUBAR=... exits 2 before running", () => {
    const film = makeFilm();
    writeEdit(film, { takes: [] });
    const res = runLips([], { cwd: film, env: { RHUBAR: stubRhubarb } });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("RHUBAR");
  });

  test("symlinked voice/takes escaping the film directory is rejected", () => {
    const film = makeFilm();
    const outside = mkdtempSync(join(suiteRoot, "outside-takes-"));
    writeFileSync(join(outside, "01.wav"), makeSilenceWav());
    rmSync(join(film, "voice/takes"), { recursive: true, force: true });
    let created = false;
    try {
      symlinkSync(outside, join(film, "voice/takes"), "junction");
      created = true;
    } catch {
      created = false;
    }
    if (!created) return;

    writeEdit(film, {
      takes: [{ id: "01", by: "steve", start: 0, text: "hi" }],
    });
    const res = runLips([], { cwd: film, env: stubEnv() });
    expect(res.status).not.toBe(0);
    expect(existsSync(join(film, MOUTH_MAP))).toBe(false);
  });
});

describe("voice:lips src/edit.json and take validation", () => {
  test("missing src/edit.json exits 2 with actionable error", () => {
    const film = makeFilm();
    const res = runLips([], { cwd: film, env: stubEnv() });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("src/edit.json");
  });

  test("malformed src/edit.json exits 1 and reports src/edit.json (with or without positional IDs)", () => {
    const film = makeFilm();
    writeFileSync(join(film, "src/edit.json"), "{not-valid-json");

    const bare = runLips([], { cwd: film, env: stubEnv() });
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain("src/edit.json");

    const withId = runLips(["01"], { cwd: film, env: stubEnv() });
    expect(withId.status).toBe(1);
    expect(withId.stderr).toContain("src/edit.json");
  });

  test("invalid edit.takes structure or duplicate take IDs fail clearly", () => {
    const film = makeFilm();
    writeEdit(film, {
      takes: [
        { id: "01", by: "steve", start: 0, text: "a" },
        { id: "01", by: "steve", start: 1, text: "b" },
      ],
    });
    const dup = runLips([], { cwd: film, env: stubEnv() });
    expect(dup.status).toBe(1);
    expect(dup.stderr.toLowerCase()).toContain("duplicate");

    writeEdit(film, { takes: "bad" });
    const bad = runLips([], { cwd: film, env: stubEnv() });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("takes");
  });

  test("narrator-only edit (no takes with by) exits 0, points to voice:cues, and clears stale mouth.json", () => {
    const film = makeFilm();
    writeFileSync(
      join(film, MOUTH_MAP),
      JSON.stringify({ takes: [{ id: "old", at: 0, cues: [[0, "X"]] }] }),
    );
    writeEdit(film, { takes: [{ id: "01", start: 0, text: "Narrator only" }] });

    const res = runLips([], { cwd: film, env: stubEnv() });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("no take is said on screen");
    expect(res.stdout).toContain("next: bun run voice:cues");
    expect(JSON.parse(readFileSync(join(film, MOUTH_MAP), "utf8"))).toEqual({ takes: [] });
  });

  test("takes with by but no audio in voice/takes exit 0 pointing to voice:gen and warn clearly on positional IDs", () => {
    const film = makeFilm();
    writeEdit(film, {
      takes: [
        { id: "01", start: 0, text: "Narrator" },
        { id: "02", by: "steve", start: 1, text: "Hello" },
      ],
    });

    const bare = runLips([], { cwd: film, env: stubEnv() });
    expect(bare.status).toBe(0);
    expect(bare.stdout).toContain("02");
    expect(bare.stdout).toContain("next: bun run voice:gen");

    const posMissingAudio = runLips(["02"], { cwd: film, env: stubEnv() });
    expect(posMissingAudio.status).toBe(2);
    expect(posMissingAudio.stderr).toContain("02");
    expect(posMissingAudio.stderr).toContain("voice:gen");

    const posNarrator = runLips(["01"], { cwd: film, env: stubEnv() });
    expect(posNarrator.status).toBe(2);
    expect(posNarrator.stderr).toContain("01");
    expect(posNarrator.stderr).toContain('"by"');

    const posUnknown = runLips(["99"], { cwd: film, env: stubEnv() });
    expect(posUnknown.status).toBe(2);
    expect(posUnknown.stderr).toContain("99");
  });

  test("studio activity reports startJob and ok/fail ended events asynchronously, and skips startJob on preflight errors", async () => {
    const film = makeFilm();
    writeEdit(film, { takes: [{ id: "01", by: "steve", start: 0, text: "Hi" }] });
    writeFileSync(join(film, "voice/takes/01.wav"), makeSilenceWav());

    // Pre-flight failure (missing ffmpeg) must NOT start a studio job
    await withStudioServer(film, async (events) => {
      const noFf = await runLipsAsync([], { cwd: film, env: { RHUBARB: stubRhubarb, PATH: "" } });
      expect(noFf.status).toBe(1);
      expect(events).toHaveLength(0);
    });

    // Success -> start + ok ended
    await withStudioServer(film, async (events) => {
      const ok = await runLipsAsync([], { cwd: film, env: stubEnv() });
      expect(ok.status).toBe(0);
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].say).toContain("01");
      expect(events.at(-1).level).toBe("ok");
    });

    // Failure -> start + fail ended
    await withStudioServer(film, async (events) => {
      const fail = await runLipsAsync(["01"], {
        cwd: film,
        env: stubEnv({ STUB_FFMPEG_FAIL_MATCH: "01.wav" }),
      });
      expect(fail.status).toBe(1);
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.at(-1).level).toBe("fail");
    });
  });
});

describe("voice:lips Rhubarb & ffmpeg pre-flight checks", () => {
  test("directory RHUBARB or missing ffmpeg fails before shaping", () => {
    const film = makeFilm();
    writeEdit(film, { takes: [{ id: "01", by: "steve", start: 0, text: "Hi" }] });
    writeFileSync(join(film, "voice/takes/01.wav"), makeSilenceWav());

    const dirTarget = join(suiteRoot, "rhubarb-dir");
    mkdirSync(dirTarget, { recursive: true });
    const dirRes = runLips([], {
      cwd: film,
      env: stubEnv({ RHUBARB: dirTarget }),
    });
    expect(dirRes.status).toBe(1);
    expect(dirRes.stderr.toLowerCase()).toContain("directory");

    const noFfmpeg = runLips([], {
      cwd: film,
      env: { RHUBARB: stubRhubarb, PATH: "" },
    });
    expect(noFfmpeg.status).toBe(1);
    expect(noFfmpeg.stderr.toLowerCase()).toContain("ffmpeg");
  });

  test("updating mouth.json when all shapes are already valid works even without RHUBARB or ffmpeg", () => {
    const film = makeFilm();
    writeEdit(film, { takes: [{ id: "01", by: "steve", start: 0, text: "Hi" }] });
    const wavPath = join(film, "voice/takes/01.wav");
    writeFileSync(wavPath, makeSilenceWav());
    expect(runLips([], { cwd: film, env: stubEnv() }).status).toBe(0);

    // Move take on timeline and remove RHUBARB/ffmpeg availability: should still update mouth.json
    writeEdit(film, { takes: [{ id: "01", by: "steve", start: 4.5, text: "Hi" }] });
    const res = runLips([], {
      cwd: film,
      env: { RHUBARB: join(suiteRoot, "does-not-exist"), PATH: "" },
    });
    expect(res.status).toBe(0);
    const map = JSON.parse(readFileSync(join(film, MOUTH_MAP), "utf8"));
    expect(map.takes[0].at).toBe(4.5);
    expect(mouthFaults(film)).toEqual([]);
  });
});

describe("voice:lips shaping, tag stripping, non-English, recovery, and partial failure", () => {
  test("strips [audio] tags for English (-r pocketSphinx) and skips pocketSphinx for non-English", () => {
    const film = makeFilm();
    const logPath = join(film, "rhubarb-calls.jsonl");
    const ffLogPath = join(film, "ffmpeg-calls.jsonl");
    writeEdit(film, {
      takes: [
        { id: "01", by: "steve", start: 0.5, text: "[tense] Watch out [pause] behind you!" },
        { id: "02", by: "alex", language: "vi", start: 2.0, text: "[happy] Xin chào thế giới" },
        { id: "03", by: "steve", start: 4.0, text: "Audio coming later" },
      ],
    });
    writeFileSync(join(film, "voice/takes/01.wav"), makeSilenceWav());
    writeFileSync(join(film, "voice/takes/02.mp3"), Buffer.from("FAKE_MP3_OK"));

    const res = runLips([], {
      cwd: film,
      env: stubEnv({ STUB_RHUBARB_LOG: logPath, STUB_FFMPEG_LOG: ffLogPath }),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("03");
    expect(res.stdout).toContain("voice:gen");

    const ffCalls = readFileSync(ffLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(ffCalls).toHaveLength(2);
    expect(ffCalls[0].input).toContain("01.wav");
    expect(ffCalls[1].input).toContain("02.mp3");

    const calls = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls).toHaveLength(2);

    const [engCall, viCall] = calls;
    expect(engCall.recognizer).toBe("pocketSphinx");
    expect(engCall.dialog).toBe("Watch out behind you!");

    expect(viCall.recognizer).toBe("phonetic");
    expect(viCall.dialog).toBe("Xin chào thế giới");

    expect(mouthFaults(film)).toEqual([]);
    const map = JSON.parse(readFileSync(join(film, MOUTH_MAP), "utf8"));
    expect(map.takes.map((t) => [t.id, t.at])).toEqual([
      ["01", 0.5],
      ["02", 2.0],
    ]);
  });

  test("positional ID re-runs only requested takes and preserves existing shapes on others", () => {
    const film = makeFilm();
    const logPath = join(film, "rhubarb-calls.jsonl");
    const ffLogPath = join(film, "ffmpeg-calls.jsonl");
    writeEdit(film, {
      takes: [
        { id: "01", by: "steve", start: 0, text: "First" },
        { id: "02", by: "steve", start: 1, text: "Second" },
      ],
    });
    writeFileSync(join(film, "voice/takes/01.wav"), makeSilenceWav());
    writeFileSync(join(film, "voice/takes/02.wav"), makeSilenceWav());

    expect(runLips([], { cwd: film, env: stubEnv() }).status).toBe(0);
    const res = runLips(["02"], {
      cwd: film,
      env: stubEnv({ STUB_RHUBARB_LOG: logPath, STUB_FFMPEG_LOG: ffLogPath }),
    });
    expect(res.status).toBe(0);
    const calls = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls).toHaveLength(1);
    expect(calls[0].dialog).toBe("Second");
    const ffCalls = readFileSync(ffLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(ffCalls).toHaveLength(1);
    expect(ffCalls[0].input).toContain("02.wav");
  });

  test("corrupt or empty .mouth.json with newer mtime is repaired automatically, and empty Rhubarb cues fail", () => {
    const film = makeFilm();
    writeEdit(film, {
      takes: [{ id: "01", by: "steve", start: 0, text: "Hello" }],
    });
    const wavPath = join(film, "voice/takes/01.wav");
    const mouthFile = `${wavPath}.mouth.json`;
    writeFileSync(wavPath, makeSilenceWav());

    // Newer empty cues file -> bare run must regenerate it
    writeFileSync(mouthFile, JSON.stringify({ cues: [] }));
    const future = new Date(statSync(wavPath).mtimeMs + 10_000);
    utimesSync(mouthFile, future, future);
    expect(mouthFaults(film).length).toBeGreaterThan(0);

    const repairRes = runLips([], { cwd: film, env: stubEnv() });
    expect(repairRes.status).toBe(0);
    expect(mouthFaults(film)).toEqual([]);

    // Corrupt JSON mouth file with newer mtime -> bare run must also regenerate it
    writeFileSync(mouthFile, "{broken");
    utimesSync(mouthFile, future, future);
    expect(mouthFaults(film).length).toBeGreaterThan(0);
    const repairCorrupt = runLips([], { cwd: film, env: stubEnv() });
    expect(repairCorrupt.status).toBe(0);
    expect(mouthFaults(film)).toEqual([]);

    // Stub returning empty mouthCues: [] on explicit re-run -> must exit 1
    const emptyRhubarb = runLips(["01"], {
      cwd: film,
      env: stubEnv({ STUB_RHUBARB_EMPTY: "1" }),
    });
    expect(emptyRhubarb.status).toBe(1);
  });

  test("partial failure keeps succeeded take shapes, writes mouth.json, exits 1, and resumes on retry", () => {
    const film = makeFilm();
    writeEdit(film, {
      takes: [
        { id: "01", by: "steve", start: 0, text: "One" },
        { id: "02", by: "steve", start: 2, text: "TwoFail" },
      ],
    });
    writeFileSync(join(film, "voice/takes/01.wav"), makeSilenceWav());
    writeFileSync(join(film, "voice/takes/02.wav"), makeSilenceWav());

    const partial = runLips([], {
      cwd: film,
      env: stubEnv({ STUB_RHUBARB_FAIL_MATCH: "TwoFail" }),
    });
    expect(partial.status).toBe(1);
    expect(partial.stderr).toContain("02");
    expect(existsSync(join(film, "voice/takes/01.wav.mouth.json"))).toBe(true);
    expect(existsSync(join(film, "voice/takes/02.wav.mouth.json"))).toBe(false);
    const partialMap = JSON.parse(readFileSync(join(film, MOUTH_MAP), "utf8"));
    expect(partialMap.takes.map((t) => t.id)).toEqual(["01"]);

    // Resume without positional args: only shapes 02 and now exits 0
    const ffLogPath = join(film, "resume-ffmpeg.jsonl");
    const resumed = runLips([], {
      cwd: film,
      env: stubEnv({ STUB_FFMPEG_LOG: ffLogPath }),
    });
    expect(resumed.status).toBe(0);
    const ffCalls = readFileSync(ffLogPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(ffCalls).toHaveLength(1);
    expect(ffCalls[0].input).toContain("02.wav");
    expect(mouthFaults(film)).toEqual([]);
  });

  test("edit.ts integration warning avoids relative traversal outside repo and disappears once mouth.json is imported", () => {
    const film = makeFilm("film with spaces-");
    writeEdit(film, { takes: [{ id: "01", by: "steve", start: 1.5, text: "Hi" }] });
    writeFileSync(join(film, "voice/takes/01.wav"), makeSilenceWav());
    writeFileSync(join(film, "src/edit.ts"), "export const EDIT = {};\n");

    const res1 = runLips([], { cwd: film, env: stubEnv() });
    expect(res1.status).toBe(0);
    expect(res1.stdout).toContain("does not import src/timeline/mouth.json");
    expect(res1.stdout).not.toContain("../../../");

    writeFileSync(
      join(film, "src/edit.ts"),
      'import mouth from "./timeline/mouth.json";\nexport const EDIT = { mouth };\n',
    );
    const res2 = runLips(["01"], { cwd: film, env: stubEnv() });
    expect(res2.status).toBe(0);
    expect(res2.stdout).not.toContain("does not import");
  });

  test("moving a take keeps mouth cues on native audio seconds despite narrative warp", () => {
    const film = makeFilm();
    writeEdit(film, {
      takes: [{ id: "01", by: "steve", start: 1.0, text: "Hello" }],
      voice: {
        warp: [
          [0, 0],
          [5, 10],
        ],
      },
    });
    writeFileSync(join(film, "voice/takes/01.wav"), makeSilenceWav());
    expect(runLips([], { cwd: film, env: stubEnv() }).status).toBe(0);

    // Move take in src/edit.json -> mouthFaults detects stale -> voice:lips updates mouth.json
    writeEdit(film, {
      takes: [{ id: "01", by: "steve", start: 2.5, text: "Hello" }],
      voice: {
        warp: [
          [0, 0],
          [5, 10],
        ],
      },
    });
    expect(mouthFaults(film).length).toBeGreaterThan(0);
    expect(runLips([], { cwd: film, env: stubEnv() }).status).toBe(0);
    expect(mouthFaults(film)).toEqual([]);

    const mouthJson = JSON.parse(readFileSync(join(film, MOUTH_MAP), "utf8"));
    expect(mouthJson.takes[0].at).toBe(2.5);
    const cues = mouthCues(
      { ...JSON.parse(readFileSync(join(film, "src/edit.json"), "utf8")), mouth: mouthJson },
      "steve",
    );
    expect(cues.length).toBeGreaterThan(0);
    expect(cues).toEqual(mouthJson.takes[0].cues.map(([at, shape]) => [2.5 + at, shape]));
  });
});

if (HAS_REAL_RHUBARB && HAS_FFMPEG) {
  describe("voice:lips with real Rhubarb binary", () => {
    test("shapes a tone WAV end-to-end and passes mouthFaults", () => {
      const film = makeFilm("real rhubarb ");
      writeEdit(film, {
        takes: [{ id: "01", by: "steve", start: 1.25, text: "[happy] Hello there" }],
      });
      writeFileSync(join(film, "voice/takes/01.wav"), makeToneWav(0.5));

      const res = runLips([], { cwd: film });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("take 01 (by steve):");
      expect(mouthFaults(film)).toEqual([]);
      const map = JSON.parse(readFileSync(join(film, MOUTH_MAP), "utf8"));
      expect(map.takes).toHaveLength(1);
      expect(map.takes[0].at).toBe(1.25);
      expect(map.takes[0].cues.length).toBeGreaterThan(0);
    });
  });
}
