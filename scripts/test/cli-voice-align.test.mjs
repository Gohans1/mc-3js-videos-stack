import { afterEach, describe, expect, test } from "bun:test";
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
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ALIGN_TS = join(ROOT, "scripts/voice/align.ts");
const WORDS_PY = join(ROOT, "scripts/voice/words.py");
const PYTHON = Bun.which("python") ?? Bun.which("python3") ?? "python";

const temps = [];
const makeTemp = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop(), { recursive: true, force: true });
  }
});

const makeWavBuffer = (seconds = 0.5, rate = 16000) => {
  const n = Math.max(0, Math.round(seconds * rate));
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 160 * i) / rate) * 10000);
    data.writeInt16LE(sample, i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
};

// Fake torch + whisperx on PYTHONPATH so real words.py executes in <150ms without GPU/PyTorch models
const makeFakePythonEnv = (mode = "normal") => {
  const pyDir = makeTemp("whisperx-stub-");
  const traceFile = join(pyDir, "trace.jsonl");

  writeFileSync(
    join(pyDir, "torch.py"),
    `import os
if os.environ.get("FAKE_FAIL_ON_IMPORT") == "1":
    raise RuntimeError("torch should not be imported for this command")
def cuda_available():
    return False
class _Cuda:
    @staticmethod
    def is_available():
        return False
cuda = _Cuda()
`,
    "utf8",
  );

  writeFileSync(
    join(pyDir, "whisperx.py"),
    `import json
import math
import os
import wave
import numpy as np

if os.environ.get("FAKE_FAIL_ON_IMPORT") == "1":
    raise RuntimeError("whisperx should not be imported for this command")

TRACE = os.environ.get("FAKE_TRACE_FILE", "")
MODE = os.environ.get("FAKE_WHISPERX_MODE", "normal")

def _log(event):
    if not TRACE:
        return
    with open(TRACE, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, ensure_ascii=False) + "\\n")

class _Model:
    def __init__(self, arch, device, compute_type=None, language=None):
        self.arch = arch
        self.device = device
        self.compute_type = compute_type
        self.language = language

    def transcribe(self, audio, batch_size=8, language=None):
        _log({"op": "transcribe", "language": language, "samples": int(len(audio))})
        if MODE == "fail_on_second":
            count = sum(1 for _ in open(TRACE, "r", encoding="utf-8")) if TRACE and os.path.exists(TRACE) else 0
            # load_model(1) + load_align(2) + transcribe#1(3) + align#1(4) + transcribe#2(5)
            transcribes = [
                json.loads(line) for line in open(TRACE, "r", encoding="utf-8")
                if line.strip() and json.loads(line).get("op") == "transcribe"
            ] if TRACE and os.path.exists(TRACE) else []
            if len(transcribes) >= 2:
                raise RuntimeError("simulated CUDA out of memory on take 2")
        if MODE == "silent":
            return {"segments": []}
        if MODE == "unicode":
            return {"segments": [{"start": 0.05, "end": 0.45, "text": "Xin chào “thế giới” — 100%"}]}
        return {"segments": [{"start": 0.05, "end": 0.45, "text": "hello world"}]}

def load_model(arch, device, compute_type=None, language=None):
    _log({"op": "load_model", "arch": arch, "device": device, "compute_type": compute_type, "language": language})
    if MODE == "exit0_noop":
        os._exit(0)
    return _Model(arch, device, compute_type, language)

def load_align_model(language_code="en", device="cpu"):
    _log({"op": "load_align_model", "language_code": language_code, "device": device})
    return {"lang": language_code}, {"lang": language_code}

def load_audio(path):
    _log({"op": "load_audio", "path": path})
    if MODE == "empty_audio":
        return np.array([], dtype=np.float32)
    if MODE == "nan_audio":
        arr = np.full(1600, np.nan, dtype=np.float32)
        return arr
    with wave.open(path, "rb") as w:
        raw = w.readframes(w.getnframes())
    if not raw:
        return np.array([], dtype=np.float32)
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return pcm

def align(segments, align_model, meta, audio, device):
    lang = meta.get("lang")
    _log({"op": "align", "lang": lang, "segments": len(segments)})
    if MODE == "silent":
        return {"segments": []}
    if MODE == "nan_words":
        return {
            "segments": [
                {
                    "start": 0.05,
                    "end": 0.45,
                    "text": "In 2026 now",
                    "words": [
                        {"word": "In", "start": 0.05, "end": 0.14},
                        {"word": "2026", "start": float("nan"), "end": None},
                        {"word": "now", "start": 0.30, "end": 0.45},
                    ],
                }
            ]
        }
    if MODE == "backtrack_empty_words":
        return {
            "segments": [
                {
                    "start": 0.1,
                    "end": 0.4,
                    "text": "2026 fast",
                    "words": [],
                }
            ]
        }
    if MODE == "unicode":
        return {
            "segments": [
                {
                    "start": 0.05,
                    "end": 0.45,
                    "text": "Xin chào “thế giới” — 100%",
                    "words": [
                        {"word": "Xin", "start": 0.05, "end": 0.14},
                        {"word": "chào", "start": 0.14, "end": 0.24},
                        {"word": "“thế giới”", "start": 0.24, "end": 0.36},
                        {"word": "—", "start": 0.36, "end": 0.40},
                        {"word": "100%", "start": 0.40, "end": 0.45},
                    ],
                }
            ]
        }
    return {
        "segments": [
            {
                "start": 0.05,
                "end": 0.45,
                "text": "hello world",
                "words": [
                    {"word": "hello", "start": 0.05, "end": 0.22},
                    {"word": "world", "start": 0.24, "end": 0.44},
                ],
            }
        ]
    }
`,
    "utf8",
  );

  return {
    pyDir,
    traceFile,
    env: {
      PYTHONPATH: pyDir,
      FAKE_TRACE_FILE: traceFile,
      FAKE_WHISPERX_MODE: mode,
      WHISPERX_PYTHON: PYTHON,
      WHISPER_DEVICE: "cpu",
      WHISPER_COMPUTE_TYPE: "int8",
    },
    readTrace: () =>
      existsSync(traceFile)
        ? readFileSync(traceFile, "utf8")
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [],
  };
};

const makeFilm = (takes = [], opts = {}) => {
  const film = makeTemp("film-align-");
  mkdirSync(join(film, "src"), { recursive: true });
  mkdirSync(join(film, "voice/takes"), { recursive: true });
  writeFileSync(join(film, "src/scene.ts"), "export const scene = {};\n", "utf8");
  if (!opts.skipEditJson) {
    writeFileSync(join(film, "src/edit.json"), JSON.stringify({ takes }, null, 2), "utf8");
  }
  return film;
};

const runAlignCli = (cwd, args = [], extraEnv = {}) =>
  spawnSync(process.execPath, [ALIGN_TS, ...args], {
    cwd,
    env: { ...process.env, LIVE_PROJECT: cwd, ...extraEnv },
    encoding: "utf8",
  });

const runWordsPy = (cwd, args = [], extraEnv = {}) =>
  spawnSync(PYTHON, [WORDS_PY, ...args], {
    cwd,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });

describe("voice:align CLI contract & preflight", () => {
  test("rejects non-object edit documents instead of claiming no takes", () => {
    const dir = makeFilm();
    for (const doc of [null, [], "mistyped edit", 42]) {
      writeFileSync(join(dir, "src/edit.json"), JSON.stringify(doc));
      const res = runAlignCli(dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("src/edit.json must be a JSON object");
    }
  });
  test("-h, --help, and help exit 0 even outside a film", () => {
    const bare = makeTemp("non-film-");
    for (const arg of ["-h", "--help", "help"]) {
      const res = runAlignCli(bare, [arg]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Next: bun run voice:assemble");
    }
  });

  test("unknown flags, = options, and env var typos exit 2 before film checks", () => {
    const bare = makeTemp("non-film-");
    for (const arg of ["--bogus", "--take=01", "-x"]) {
      const res = runAlignCli(bare, [arg]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("--help for everything");
    }
    const typo = runAlignCli(bare, [], { WHISPER_PYTHON: PYTHON });
    expect(typo.status).toBe(2);
    expect(typo.stderr).toContain("did you mean WHISPERX_PYTHON");
  });

  test("non-film directory without src/scene.ts exits 2", () => {
    const bare = makeTemp("non-film-");
    const res = runAlignCli(bare, []);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("is not a film");
  });

  test("missing src/edit.json exits 1 naming src/edit.json", () => {
    const film = makeFilm([], { skipEditJson: true });
    const res = runAlignCli(film, []);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("src/edit.json");
  });

  test("corrupt src/edit.json exits 1 naming src/edit.json instead of hiding it", () => {
    const film = makeFilm([], { skipEditJson: true });
    writeFileSync(join(film, "src/edit.json"), "{ broken json", "utf8");

    const bare = runAlignCli(film, []);
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain("src/edit.json");

    const withId = runAlignCli(film, ["01"]);
    expect(withId.status).toBe(1);
    expect(withId.stderr).toContain("src/edit.json");
  });

  test("invalid take id in src/edit.json exits 1 cleanly", () => {
    const film = makeFilm([{ id: "../escape", text: "hi" }]);
    const res = runAlignCli(film, []);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Invalid take id");
  });

  test("symlink/junction voice/takes directory or .words.json fails confinement (exit 1)", () => {
    const outside = makeTemp("outside-");
    const film = makeFilm([{ id: "01", text: "hi" }], {});
    rmSync(join(film, "voice/takes"), { recursive: true, force: true });
    symlinkSync(outside, join(film, "voice/takes"), "junction");

    const dirRes = runAlignCli(film, []);
    expect(dirRes.status).toBe(1);
    expect(dirRes.stderr).toMatch(/symlink|junction|escapes/i);

    // Real voice/takes, but .words.json replaced by a junction/symlink
    const film2 = makeFilm([{ id: "01", text: "hi" }]);
    writeFileSync(join(film2, "voice/takes/01.wav"), makeWavBuffer());
    symlinkSync(outside, join(film2, "voice/takes/01.wav.words.json"), "junction");
    const fileRes = runAlignCli(film2, []);
    expect(fileRes.status).toBe(1);
    expect(fileRes.stderr).toMatch(/symlink|junction|unsafe/i);
  });

  test("unknown explicit take ID exits 2 without invoking python", () => {
    const film = makeFilm([{ id: "01", text: "hello" }]);
    writeFileSync(join(film, "voice/takes/01.wav"), makeWavBuffer());
    const stub = makeFakePythonEnv();
    const res = runAlignCli(film, ["99"], stub.env);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("no take 99");
    expect(stub.readTrace()).toHaveLength(0);
  });

  test("takes without audio exit 0 suggesting bun run voice:gen", () => {
    const film = makeFilm([{ id: "01", text: "hello" }]);
    const res = runAlignCli(film, []);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("next: bun run voice:gen");
  });

  test("all takes freshly aligned exit 0 suggesting bun run voice:assemble without running python", () => {
    const film = makeFilm([{ id: "01", text: "hello" }]);
    const audio = join(film, "voice/takes/01.wav");
    writeFileSync(audio, makeWavBuffer());
    const wf = `${audio}.words.json`;
    writeFileSync(
      wf,
      JSON.stringify({
        text: "hello",
        dur: 0.5,
        pitch_p10_p90_st: [0, 0],
        words: [{ w: "hello", s: 0.05, e: 0.4 }],
      }),
      "utf8",
    );
    const tAudio = new Date("2025-01-01T00:00:00Z");
    const tWords = new Date("2025-01-01T00:00:05Z");
    utimesSync(audio, tAudio, tAudio);
    utimesSync(wf, tWords, tWords);

    const stub = makeFakePythonEnv();
    const res = runAlignCli(film, [], stub.env);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("next: bun run voice:assemble");
    expect(stub.readTrace()).toHaveLength(0);
  });
});

describe("voice:align staleness, env, partial fail, and studio telemetry", () => {
  test("detects stale, corrupt JSON, and empty-words .words.json on bare run", () => {
    const film = makeFilm([
      { id: "01", text: "stale audio" },
      { id: "02", text: "corrupt json" },
      { id: "03", text: "empty words" },
    ]);

    const a1 = join(film, "voice/takes/01.wav");
    const a2 = join(film, "voice/takes/02.wav");
    const a3 = join(film, "voice/takes/03.wav");
    for (const a of [a1, a2, a3]) writeFileSync(a, makeWavBuffer());

    // 01: stale (audio newer than words.json)
    writeFileSync(
      `${a1}.words.json`,
      JSON.stringify({ text: "old", dur: 0.5, words: [{ w: "old", s: 0.1, e: 0.2 }] }),
    );
    utimesSync(
      `${a1}.words.json`,
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-01T00:00:00Z"),
    );
    utimesSync(a1, new Date("2025-06-01T00:00:00Z"), new Date("2025-06-01T00:00:00Z"));

    // 02: corrupt JSON
    writeFileSync(`${a2}.words.json`, "{ broken json", "utf8");

    // 03: valid JSON but 0 valid words
    writeFileSync(`${a3}.words.json`, JSON.stringify({ text: "", dur: 0.5, words: [] }), "utf8");

    const stub = makeFakePythonEnv();
    const res = runAlignCli(film, [], stub.env);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("wrote 3 word timing files");
    expect(res.stdout).toContain("next: bun run voice:assemble");

    for (const a of [a1, a2, a3]) {
      const parsed = JSON.parse(readFileSync(`${a}.words.json`, "utf8"));
      expect(parsed.words.length).toBeGreaterThan(0);
      expect(statSync(`${a}.words.json`).mtimeMs).toBeGreaterThanOrEqual(statSync(a).mtimeMs);
    }
  });

  test("WHISPERX_PYTHON accepts PATH command name 'python' and rejects missing path or directory", () => {
    const film = makeFilm([{ id: "01", text: "hello" }]);
    const audio = join(film, "voice/takes/01.wav");
    writeFileSync(audio, makeWavBuffer());

    const badPath = runAlignCli(film, [], { WHISPERX_PYTHON: join(film, "missing-python.exe") });
    expect(badPath.status).toBe(1);
    expect(badPath.stderr).toContain("no whisperX python at");

    const dirPath = runAlignCli(film, [], { WHISPERX_PYTHON: film });
    expect(dirPath.status).toBe(1);
    expect(dirPath.stderr).toContain("no whisperX python at");

    const stub = makeFakePythonEnv();
    const cmdName = runAlignCli(film, [], { ...stub.env, WHISPERX_PYTHON: "python" });
    expect(cmdName.status).toBe(0);
    expect(existsSync(`${audio}.words.json`)).toBe(true);
  });

  test("deduplicates duplicate CLI IDs and passes per-take language hints (explicit + vi auto-detect)", () => {
    const film = makeFilm([
      { id: "01", text: "Xin chào các bạn hôm nay", language: "vi" },
      { id: "02", text: "Đường về nhà hôm nay rất đẹp" },
      { id: "03", text: "Hello world" },
    ]);
    for (const id of ["01", "02", "03"]) {
      writeFileSync(join(film, `voice/takes/${id}.wav`), makeWavBuffer());
    }

    const stub = makeFakePythonEnv();
    const res = runAlignCli(film, ["01", "01", "02", "03"], stub.env);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("wrote 3 word timing files");

    const trace = stub.readTrace();
    const transcribes = trace.filter((e) => e.op === "transcribe");
    expect(transcribes.map((e) => e.language)).toEqual(["vi", "vi", "en"]);

    const alignLoads = trace.filter((e) => e.op === "load_align_model");
    expect(alignLoads.map((e) => e.language_code)).toEqual(["vi", "en"]);
  });

  test("partial failure keeps finished takes, never miscounts pre-existing stale files, and resumes", () => {
    const film = makeFilm([
      { id: "01", text: "first take" },
      { id: "02", text: "second take" },
    ]);
    const a1 = join(film, "voice/takes/01.wav");
    const a2 = join(film, "voice/takes/02.wav");
    writeFileSync(a1, makeWavBuffer());
    writeFileSync(a2, makeWavBuffer());
    // Pre-existing stale .words.json on 02 must NOT be counted as aligned when 02 fails
    writeFileSync(
      `${a2}.words.json`,
      JSON.stringify({ text: "stale", dur: 0.5, words: [{ w: "stale", s: 0.1, e: 0.2 }] }),
    );
    utimesSync(
      `${a2}.words.json`,
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-01T00:00:00Z"),
    );
    utimesSync(a2, new Date("2025-06-01T00:00:00Z"), new Date("2025-06-01T00:00:00Z"));

    const failStub = makeFakePythonEnv("fail_on_second");
    const res1 = runAlignCli(film, ["01", "02"], failStub.env);
    expect(res1.status).toBe(1);
    expect(res1.stderr).toContain("1 of 2 aligned");
    expect(res1.stderr).toContain("still without timings: 02");
    expect(existsSync(`${a1}.words.json`)).toBe(true);

    // Resume bare run only runs 02
    const okStub = makeFakePythonEnv("normal");
    const res2 = runAlignCli(film, [], okStub.env);
    expect(res2.status).toBe(0);
    expect(okStub.readTrace().filter((e) => e.op === "load_audio")).toHaveLength(1);
  });

  test("exit 0 from python without writing .words.json still fails cleanly and ends studio job", async () => {
    const film = makeFilm([{ id: "01", text: "hello" }]);
    writeFileSync(join(film, "voice/takes/01.wav"), makeWavBuffer());

    const events = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        if (req.url === "/api/activity") events.push(JSON.parse(body));
        res.writeHead(200).end("ok");
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const addr = server.address();
      mkdirSync(join(film, "renders/live"), { recursive: true });
      writeFileSync(join(film, "renders/live/studio.json"), JSON.stringify({ port: addr.port }));

      const runAlignCliAsync = (args = [], extraEnv = {}) =>
        new Promise((resolveRun) => {
          const child = spawn(process.execPath, [ALIGN_TS, ...args], {
            cwd: film,
            env: { ...process.env, LIVE_PROJECT: film, ...extraEnv },
          });
          let stdout = "";
          let stderr = "";
          child.stdout?.on("data", (d) => {
            stdout += d.toString();
          });
          child.stderr?.on("data", (d) => {
            stderr += d.toString();
          });
          child.on("close", (status) => resolveRun({ status, stdout, stderr }));
        });

      const noopStub = makeFakePythonEnv("exit0_noop");
      const failRes = await runAlignCliAsync([], noopStub.env);
      expect(failRes.status).toBe(1);
      expect(failRes.stderr).toContain("still without timings: 01");
      expect(events).toHaveLength(2);
      expect(events[0].job?.key).toBe("voice:align");
      expect(events[1].job).toEqual({ key: "voice:align", end: true });
      expect(events[1].level).toBe("fail");

      // Also verify ok activity reporting
      events.length = 0;
      const okStub = makeFakePythonEnv("normal");
      const okRes = await runAlignCliAsync([], okStub.env);
      expect(okRes.status).toBe(0);
      expect(events).toHaveLength(2);
      expect(events[1].job).toEqual({ key: "voice:align", end: true });
      expect(events[1].level).toBe("ok");
    } finally {
      server.close();
    }
  });
});

describe("words.py direct CLI and edge cases", () => {
  test("-h/--help/help exits 0 and bad flags or missing args exit 2 BEFORE importing torch/whisperx", () => {
    const bare = makeTemp("words-py-");
    const stub = makeFakePythonEnv();
    const noImportEnv = { ...stub.env, FAKE_FAIL_ON_IMPORT: "1" };

    for (const arg of ["-h", "--help", "help"]) {
      const res = runWordsPy(bare, [arg], noImportEnv);
      expect(res.status).toBe(0);
      expect(res.stdout.toLowerCase()).toContain("usage");
    }

    for (const args of [[], ["--bogus", "a.wav"], ["--lang=vi", "a.wav"], ["--lang"]]) {
      const res = runWordsPy(bare, args, noImportEnv);
      expect(res.status).toBe(2);
    }
  });

  test("nonexistent audio fails cleanly exit 1 without loading models", () => {
    const bare = makeTemp("words-missing-");
    const stub = makeFakePythonEnv();
    const res = runWordsPy(bare, [join(bare, "does-not-exist.wav")], stub.env);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("does-not-exist.wav");
    expect(stub.readTrace()).toHaveLength(0);
  });

  test("interpolates missing/NaN word timestamps and falls back when backtrack returns words: []", () => {
    const bare = makeTemp("words-nan-");
    const w1 = join(bare, "nan.wav");
    writeFileSync(w1, makeWavBuffer(0.6));

    const stubNan = makeFakePythonEnv("nan_words");
    const resNan = runWordsPy(bare, [w1], stubNan.env);
    expect(resNan.status).toBe(0);
    const out1Raw = readFileSync(`${w1}.words.json`, "utf8");
    expect(out1Raw).not.toContain("\r\n");
    const out1 = JSON.parse(out1Raw);
    expect(out1.words).toHaveLength(3);
    expect(out1.words[1].w).toBe("2026");
    expect(out1.words[1].s).toBeGreaterThanOrEqual(out1.words[0].e);
    expect(out1.words[1].e).toBeLessThanOrEqual(out1.words[2].s);

    const w2 = join(bare, "empty-words.wav");
    writeFileSync(w2, makeWavBuffer(0.6));
    const stubBacktrack = makeFakePythonEnv("backtrack_empty_words");
    const resBt = runWordsPy(bare, [w2], stubBacktrack.env);
    expect(resBt.status).toBe(0);
    const out2 = JSON.parse(readFileSync(`${w2}.words.json`, "utf8"));
    expect(out2.words.map((x) => x.w)).toEqual(["2026", "fast"]);
    expect(out2.words[0].s).toBeCloseTo(0.1, 3);
    expect(out2.words[1].e).toBeCloseTo(0.4, 3);
  });

  test("rejects silent 0-word audio and empty 0-sample audio without writing broken .words.json", () => {
    const bare = makeTemp("words-empty-");
    const silent = join(bare, "silent.wav");
    writeFileSync(silent, makeWavBuffer(0.5));
    const empty = join(bare, "empty.wav");
    writeFileSync(empty, makeWavBuffer(0));

    const silentRes = runWordsPy(bare, [silent], makeFakePythonEnv("silent").env);
    expect(silentRes.status).toBe(1);
    expect(existsSync(`${silent}.words.json`)).toBe(false);

    const emptyRes = runWordsPy(bare, [empty], makeFakePythonEnv("empty_audio").env);
    expect(emptyRes.status).toBe(1);
    expect(existsSync(`${empty}.words.json`)).toBe(false);
  });

  test("handles short <40ms audio pitch, non-finite audio, and UTF-8 piped output cleanly", () => {
    const bare = makeTemp("words-utf8-");
    const tiny = join(bare, "tiny.wav");
    writeFileSync(tiny, makeWavBuffer(0.02));

    const res = runWordsPy(bare, ["--lang", "vi", tiny], {
      ...makeFakePythonEnv("unicode").env,
      PYTHONIOENCODING: "",
      PYTHONUTF8: "",
    });
    expect(res.status).toBe(0);
    const parsed = JSON.parse(readFileSync(`${tiny}.words.json`, "utf8"));
    expect(parsed.pitch_p10_p90_st).toEqual([0, 0]);
    expect(parsed.text).toContain("Xin chào");

    const nanWav = join(bare, "nan-audio.wav");
    writeFileSync(nanWav, makeWavBuffer(0.2));
    const nanRes = runWordsPy(bare, [nanWav], makeFakePythonEnv("nan_audio").env);
    expect(nanRes.status).toBe(0);
    const nanParsed = JSON.parse(readFileSync(`${nanWav}.words.json`, "utf8"));
    expect(nanParsed.pitch_p10_p90_st).toEqual([0, 0]);
    expect(nanParsed.words.length).toBeGreaterThan(0);
  });

  test("reads film src/edit.json language fallback when WHISPERX_LANGS is unset", () => {
    const film = makeFilm([{ id: "01", text: "Tôi đang ở trong căn phòng" }]);
    const audio = join(film, "voice/takes/01.wav");
    writeFileSync(audio, makeWavBuffer(0.5));
    const stub = makeFakePythonEnv("normal");
    const res = runWordsPy(film, [audio], stub.env);
    expect(res.status).toBe(0);
    const transcribes = stub.readTrace().filter((e) => e.op === "transcribe");
    expect(transcribes[0]?.language).toBe("vi");
  });
});
