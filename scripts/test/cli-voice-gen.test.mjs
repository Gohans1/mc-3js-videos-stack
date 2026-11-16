import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { runGen } from "../voice/gen.ts";
import {
  alignmentToWords,
  MAX_AUDIO_BYTES,
  resolveVoiceProvider,
  sts,
  tts,
} from "../voice/genvoice.ts";

const GEN_SCRIPT = fileURLToPath(new URL("../voice/gen.ts", import.meta.url));

const makeFilm = (t, edit = { takes: [] }, extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "cli-voice-gen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "probe-film" }));
  writeFileSync(join(dir, "src/scene.ts"), "// stub\n");
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify(edit, null, 2));
  for (const [rel, val] of Object.entries(extra)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(
      abs,
      typeof val === "string" || val instanceof Uint8Array ? val : JSON.stringify(val),
    );
  }
  return dir;
};

const runCli = (args, { cwd, env = {} }) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn("bun", [GEN_SCRIPT, ...args], {
      cwd,
      env: {
        ...process.env,
        ELEVENLABS_API_KEY: "",
        ELEVENLABS_API_BASE: "",
        GENVOICE_API_KEY: "",
        GENVOICE_API_BASE: "",
        RHUBARB: join(cwd, "no-such-rhubarb.exe"),
        WHISPERX_PYTHON: join(cwd, "no-such-python.exe"),
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", rejectRun);
    child.on("close", (code, signal) => {
      resolveRun({ status: code, signal, stdout, stderr });
    });
  });

const startServer = async (t, handler) => {
  const server = createServer(handler);
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((res) => server.close(res));
  });
  const addr = server.address();
  return `http://127.0.0.1:${addr.port}`;
};

const cleanEnv = (extra = {}) => ({
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  ...extra,
});

const lastNonEmptyLine = (text) =>
  text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1) ?? "";

test("voice:gen -h, --help, and help exit 0 before reading broken edit.json or needing a film dir", async (t) => {
  const brokenFilm = makeFilm(t, { takes: [] });
  writeFileSync(join(brokenFilm, "src/edit.json"), "{broken json");
  const nonFilm = mkdtempSync(join(tmpdir(), "cli-voice-gen-nofilm-"));
  t.after(() => rmSync(nonFilm, { recursive: true, force: true }));

  for (const [cwd, flag] of [
    [brokenFilm, "--help"],
    [brokenFilm, "-h"],
    [nonFilm, "help"],
  ]) {
    const res = await runCli([flag], { cwd });
    assert.equal(res.status, 0, `${flag} should exit 0 (stderr: ${res.stderr})`);
    assert.equal(res.stderr, "");
    assert.match(res.stdout, /bun run voice:gen/);
    assert.match(res.stdout, /^Next:/m);
    assert.equal(existsSync(join(cwd, "voice")), false);
  }
});

test("voice:gen exits 2 on bad flags, --takes without --try, and invalid --guide before reading broken edit.json or mutating voice/", async (t) => {
  const dir = makeFilm(t, { takes: [] });
  writeFileSync(join(dir, "src/edit.json"), "{broken json");

  const badCalls = [
    ["--unknown-flag"],
    ["-x"],
    ["--takes", "1"],
    ["--takes", "0", "--try", "01"],
    ["--takes", "21", "--try", "01"],
    ["--takes", "abc", "--try", "01"],
    ["--takes"],
    ["--try"],
    ["--guide", "voice/g.wav"],
    ["--guide", "voice/g.wav", "01", "02"],
    ["--guide"],
  ];

  for (const args of badCalls) {
    const res = await runCli(args, { cwd: dir });
    assert.equal(
      res.status,
      2,
      `args ${args.join(" ")} should exit 2, got ${res.status}: ${res.stderr}`,
    );
    assert.equal(
      existsSync(join(dir, "voice")),
      false,
      `args ${args.join(" ")} must not create voice/`,
    );
    assert.doesNotMatch(
      res.stderr,
      /SyntaxError|JSON|edit\.json/,
      `args ${args.join(" ")} must fail before parsing edit.json`,
    );
  }

  const typoRes = await runCli([], { cwd: dir, env: { LIVE_PROJET: dir } });
  assert.equal(typoRes.status, 2);
  assert.match(typoRes.stderr, /did you mean LIVE_PROJECT/);

  for (const badArgs of [
    ["-x"],
    ["--takes", "1"],
    ["--takes=2"],
    ["--takes", "99", "--try", "01"],
  ]) {
    await assert.rejects(
      () => runGen({ cwd: dir, args: badArgs, env: cleanEnv() }),
      (err) => err?.usage === true,
    );
  }
});

test("preview and --dry-run never create voice/, support omitted text with guide, quote spaces in next:, and always end on next:", async (t) => {
  const dir = makeFilm(
    t,
    {
      takes: [
        { id: "01", text: "Hello world." },
        { id: "02", guide: "voice/my guide.wav" },
      ],
    },
    { "voice/my guide.wav": Buffer.from("RIFFdummy") },
  );

  const bare = await runCli([], { cwd: dir });
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(existsSync(join(dir, "voice/takes")), false);
  assert.equal(existsSync(join(dir, "voice/try")), false);
  assert.match(bare.stdout, /01 would write voice\/takes\/01\.mp3/);
  assert.match(bare.stdout, /02 would write voice\/takes\/02\.mp3/);
  assert.equal(
    lastNonEmptyLine(bare.stdout),
    "next: bun run voice:gen --yes sends these 2 takes (12 TTS characters + 1 voice changer)",
  );

  const guidePreview = await runCli(["--dry-run", "02", "--guide", "voice/my guide.wav"], {
    cwd: dir,
  });
  assert.equal(guidePreview.status, 0, guidePreview.stderr);
  assert.equal(existsSync(join(dir, "voice/takes")), false);
  assert.equal(
    lastNonEmptyLine(guidePreview.stdout),
    'next: bun run voice:gen 02 --guide "voice/my guide.wav" --yes sends this take (voice changer, billed by ElevenLabs STS credits)',
  );

  const tryPreview = await runCli(["--try", "01", "--takes", "2"], { cwd: dir });
  assert.equal(tryPreview.status, 0, tryPreview.stderr);
  assert.equal(existsSync(join(dir, "voice/try")), false);
  assert.match(tryPreview.stdout, /would write voice\/try\/01_1\.mp3/);
  assert.match(tryPreview.stdout, /would write voice\/try\/01_2\.mp3/);

  const equalsSyntax = await runCli(["--try", "01", "--takes=2"], { cwd: dir });
  assert.equal(equalsSyntax.status, 2);
});

test("empty takes, all-present takes, and unheardWords previews place next: on the very last line", async (t) => {
  const emptyDir = makeFilm(t, { takes: [] });
  const emptyRes = await runCli([], { cwd: emptyDir });
  assert.equal(emptyRes.status, 0, emptyRes.stderr);
  assert.match(emptyRes.stdout, /src\/edit\.json has no takes yet/);
  assert.equal(
    lastNonEmptyLine(emptyRes.stdout),
    'next: add takes to src/edit.json "takes", then bun run voice:gen',
  );

  const doneDir = makeFilm(
    t,
    { takes: [{ id: "01", text: "Iron door." }] },
    {
      "voice/takes/01.mp3": Buffer.from("mp3"),
      "voice/takes/01.mp3.words.json": {
        words: [
          { w: "Steel", s: 0, e: 0.2 },
          { w: "door.", s: 0.2, e: 0.5 },
        ],
      },
    },
  );
  const doneRes = await runCli([], { cwd: doneDir });
  assert.equal(doneRes.status, 0, doneRes.stderr);
  const lines = doneRes.stdout.trim().split(/\r?\n/);
  const unheardIdx = lines.findIndex((l) => l.includes('take 01: its audio says "Steel door."'));
  const nextIdx = lines.findIndex((l) => l.startsWith("next: "));
  assert.ok(unheardIdx >= 0, `expected unheardWords warning in:\n${doneRes.stdout}`);
  assert.equal(nextIdx, lines.length - 1, `expected next: last in:\n${doneRes.stdout}`);
  assert.equal(lines[nextIdx], "next: bun run voice:assemble lays them on the film");

  const unalignedDir = makeFilm(
    t,
    { takes: [{ id: "01", text: "No words json." }] },
    { "voice/takes/01.mp3": Buffer.from("mp3") },
  );
  const alignRes = await runCli([], { cwd: unalignedDir });
  assert.equal(alignRes.status, 0, alignRes.stderr);
  assert.match(lastNonEmptyLine(alignRes.stdout), /^next: bun run voice:align /);

  const lipsDir = makeFilm(
    t,
    { takes: [{ id: "01", text: "Speak up.", by: "hero" }] },
    {
      "voice/takes/01.mp3": Buffer.from("mp3"),
      "voice/takes/01.mp3.words.json": { words: [{ w: "Speak", s: 0, e: 0.2 }] },
      "voice/takes/.texts.json": { "01": "Speak up." },
    },
  );
  const lipsRes = await runCli([], { cwd: lipsDir });
  assert.equal(lipsRes.status, 0, lipsRes.stderr);
  assert.match(lastNonEmptyLine(lipsRes.stdout), /^next: bun run voice:lips /);
});

test("runGen validates take specs, parent-symlink guide escapes, oversized guides, and corrupt .texts.json BEFORE preview or API calls", async (t) => {
  const badSpecs = [
    [{ takes: "not-an-array" }, /"takes" must be an array/],
    [{ takes: [{ id: "01", text: "" }] }, /missing non-empty text/],
    [{ takes: [{ id: "01" }] }, /missing non-empty text/],
    [{ takes: [{ id: "01", text: 123 }] }, /text must be a string/],
    [{ takes: [{ id: "01", text: "Hi", voice: "" }] }, /voice must be a non-empty string/],
    [{ takes: [{ id: "01", text: "Hi", speed: 0 }] }, /speed must be a finite number > 0/],
    [{ takes: [{ id: "01", text: "Hi", speed: -1 }] }, /speed must be a finite number > 0/],
    [
      { takes: [{ id: "01", text: "Hi", stability: 1.5 }] },
      /stability must be a finite number between 0 and 1/,
    ],
  ];
  for (const [edit, pattern] of badSpecs) {
    const dir = makeFilm(t, edit);
    await assert.rejects(() => runGen({ cwd: dir, args: ["--dry-run"], env: cleanEnv() }), pattern);
    assert.equal(existsSync(join(dir, "voice")), false);
  }

  const outsideDir = mkdtempSync(join(tmpdir(), "cli-voice-gen-out-"));
  t.after(() => rmSync(outsideDir, { recursive: true, force: true }));
  writeFileSync(join(outsideDir, "secret.wav"), "RIFF");
  const escapeDir = makeFilm(t, { takes: [{ id: "01", guide: "voice/link/secret.wav" }] });
  mkdirSync(join(escapeDir, "voice"), { recursive: true });
  let linked = false;
  try {
    symlinkSync(
      outsideDir,
      join(escapeDir, "voice/link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    linked = true;
  } catch {
    linked = false;
  }
  if (linked) {
    await assert.rejects(
      () => runGen({ cwd: escapeDir, args: ["--dry-run"], env: cleanEnv() }),
      /escapes|symlink|junction/i,
    );
  }

  const sparseDir = makeFilm(t, { takes: [{ id: "01", guide: "voice/huge.wav" }] });
  mkdirSync(join(sparseDir, "voice"), { recursive: true });
  writeFileSync(join(sparseDir, "voice/huge.wav"), "");
  truncateSync(join(sparseDir, "voice/huge.wav"), MAX_AUDIO_BYTES + 1);
  await assert.rejects(
    () => runGen({ cwd: sparseDir, args: ["--dry-run"], env: cleanEnv() }),
    /exceeds maximum size limit/,
  );

  for (const badTexts of ["null", "[]", "{bad"]) {
    const textsDir = makeFilm(
      t,
      { takes: [{ id: "01", text: "Hi" }] },
      { "voice/takes/.texts.json": badTexts },
    );
    await assert.rejects(() => runGen({ cwd: textsDir, args: ["--dry-run"], env: cleanEnv() }));
  }
});

test("runGen preflights API key & GenVoice+guide incompatibility before onTake or HTTP requests, and recovers from null .request_ids.json", async (t) => {
  let apiHits = 0;
  const gvBase = await startServer(t, async (req, res) => {
    apiHits++;
    if (req.method === "POST" && req.url?.startsWith("/v1/text-to-speech/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "task_1" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const mixedDir = makeFilm(
    t,
    {
      takes: [
        { id: "01", text: "First TTS line." },
        { id: "02", guide: "voice/g.wav" },
      ],
    },
    { "voice/g.wav": "RIFF" },
  );
  let onTakeCalls = 0;
  await assert.rejects(
    () =>
      runGen({
        cwd: mixedDir,
        args: ["--yes"],
        env: cleanEnv({ GENVOICE_API_KEY: "gv_key", GENVOICE_API_BASE: `${gvBase}/v1` }),
        onTake: () => {
          onTakeCalls++;
        },
      }),
    /ELEVENLABS_API_KEY/,
  );
  assert.equal(
    apiHits,
    0,
    "mixed TTS + guide on GenVoice must fail before spending credits on take 01",
  );
  assert.equal(onTakeCalls, 0);
  assert.equal(existsSync(join(mixedDir, "voice/takes")), false);

  const noKeyDir = makeFilm(t, { takes: [{ id: "01", text: "Hi." }] });
  await assert.rejects(
    () =>
      runGen({
        cwd: noKeyDir,
        args: ["--yes"],
        env: cleanEnv(),
        onTake: () => {
          onTakeCalls++;
        },
      }),
    /Missing API key/,
  );
  assert.equal(onTakeCalls, 0);
  assert.equal(existsSync(join(noKeyDir, "voice/takes")), false);

  const elevenBase = await startServer(t, (req, res) => {
    res.writeHead(200, {
      "content-type": "application/json",
      "request-id": "req_recovered",
    });
    res.end(JSON.stringify({ audio_base64: Buffer.from("ID3dummy").toString("base64") }));
  });
  const nullReqDir = makeFilm(
    t,
    { takes: [{ id: "01", text: "Hi." }] },
    { "voice/takes/.request_ids.json": "null" },
  );
  const res = await runGen({
    cwd: nullReqDir,
    args: ["--yes"],
    env: cleanEnv({ ELEVENLABS_API_KEY: "el_key", ELEVENLABS_API_BASE: elevenBase }),
  });
  assert.equal(res.length, 1);
  assert.deepEqual(
    JSON.parse(await Bun.file(join(nullReqDir, "voice/takes/.request_ids.json")).text())["01"]?.id,
    "req_recovered",
  );
  const parts = readdirSync(join(nullReqDir, "voice/takes")).filter((f) => f.endsWith(".part"));
  assert.deepEqual(parts, []);
});

test("voice:gen CLI --yes cleans stale artifacts, reports studio activity fail/warn/ok, and handles GenVoice whisperX failure", async (t) => {
  const activities = [];
  const studioBase = await startServer(t, async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url === "/api/activity") activities.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const studioPort = Number(new URL(studioBase).port);

  let mode = "ok";
  const apiBase = await startServer(t, (req, res) => {
    if (mode === "fail-second" && req.url?.includes("fail_voice")) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("boom");
      return;
    }
    if (req.url?.includes("with-timestamps")) {
      res.writeHead(200, { "content-type": "application/json", "request-id": "req_el" });
      res.end(
        JSON.stringify({
          audio_base64: Buffer.from("ID3mp3").toString("base64"),
          alignment: {
            characters: ["H", "i"],
            character_start_times_seconds: [0, 0.1],
            character_end_times_seconds: [0.1, 0.2],
          },
        }),
      );
      return;
    }
    if (req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "gv_1" }));
      return;
    }
    if (req.url?.includes("/history/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "completed",
          result: { audio_url: `${apiBase}/dl/01.mp3` },
        }),
      );
      return;
    }
    if (req.url === "/dl/01.mp3") {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(Buffer.from("ID3gv"));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // Case A: overwriting speaking take clears stale wav/words/mouth files, warns when Rhubarb fails/missing, sends studio warn
  const filmA = makeFilm(
    t,
    { takes: [{ id: "01", text: "Hello.", by: "hero" }] },
    {
      "renders/live/studio.json": { port: studioPort },
      "voice/takes/01.wav": "RIFFold",
      "voice/takes/01.wav.words.json": { words: [{ w: "old", s: 0, e: 0.1 }] },
      "voice/takes/01.mp3.mouth.json": { cues: [[0, "X"]] },
      "voice/takes/01.wav.mouth.json": { cues: [[0, "X"]] },
      "renders/live/mouth.json": { takes: { "01": { by: "hero", cues: [[0, "X"]] } } },
    },
  );
  const resA = await runCli(["01", "--yes"], {
    cwd: filmA,
    env: { ELEVENLABS_API_KEY: "el_key", ELEVENLABS_API_BASE: apiBase },
  });
  assert.equal(resA.status, 0, resA.stderr);
  assert.equal(existsSync(join(filmA, "voice/takes/01.wav")), false);
  assert.equal(existsSync(join(filmA, "voice/takes/01.wav.words.json")), false);
  assert.equal(existsSync(join(filmA, "voice/takes/01.mp3.mouth.json")), false);
  assert.equal(existsSync(join(filmA, "voice/takes/01.wav.mouth.json")), false);
  assert.equal(existsSync(join(filmA, "voice/takes/01.mp3.words.json")), true);
  assert.match(resA.stderr, /bun run voice:lips/);
  assert.equal(
    lastNonEmptyLine(resA.stdout),
    "next: bun run voice:lips writes their mouth shapes, then bun run voice:assemble",
  );
  assert.equal(activities.at(-1)?.level, "warn");

  // Case B: mid-flight failure after onTake sends level: "fail" to studio
  activities.length = 0;
  mode = "fail-second";
  const filmB = makeFilm(
    t,
    {
      takes: [
        { id: "01", text: "First." },
        { id: "02", voice: "fail_voice", text: "Second." },
      ],
    },
    { "renders/live/studio.json": { port: studioPort } },
  );
  const resB = await runCli(["--yes"], {
    cwd: filmB,
    env: { ELEVENLABS_API_KEY: "el_key", ELEVENLABS_API_BASE: apiBase },
  });
  assert.equal(resB.status, 1);
  assert.equal(activities.at(-1)?.level, "fail");

  // Case C: GenVoice with unrunnable/failing WHISPERX_PYTHON keeps audio, sends level: "warn", exits 1 naming voice:align
  activities.length = 0;
  mode = "ok";
  const filmC = makeFilm(
    t,
    { takes: [{ id: "01", text: "GenVoice line." }] },
    { "renders/live/studio.json": { port: studioPort } },
  );
  const resC = await runCli(["--yes"], {
    cwd: filmC,
    env: {
      GENVOICE_API_KEY: "gv_key",
      GENVOICE_API_BASE: apiBase,
      WHISPERX_PYTHON: "bun",
    },
  });
  assert.equal(resC.status, 1);
  assert.equal(existsSync(join(filmC, "voice/takes/01.mp3")), true);
  assert.match(resC.stderr, /whisperX failed/);
  assert.match(resC.stderr, /bun run voice:align/);
  assert.equal(activities.at(-1)?.level, "warn");

  const resDirPy = await runCli(["01", "--yes"], {
    cwd: filmC,
    env: {
      GENVOICE_API_KEY: "gv_key",
      GENVOICE_API_BASE: apiBase,
      WHISPERX_PYTHON: filmC,
    },
  });
  assert.equal(resDirPy.status, 1);
  assert.match(resDirPy.stderr, /no whisperX python at/);

  // Case D: non-speaking ElevenLabs TTS succeeds -> studio level: "ok", next: voice:assemble; --try --takes 2 --yes writes voice/try
  activities.length = 0;
  const filmD = makeFilm(
    t,
    { takes: [{ id: "01", text: "Clean narrator line." }] },
    { "renders/live/studio.json": { port: studioPort } },
  );
  const resD = await runCli(["--yes"], {
    cwd: filmD,
    env: { ELEVENLABS_API_KEY: "el_key", ELEVENLABS_API_BASE: apiBase },
  });
  assert.equal(resD.status, 0, resD.stderr);
  assert.equal(activities.at(-1)?.level, "ok");
  assert.equal(lastNonEmptyLine(resD.stdout), "next: bun run voice:assemble lays them on the film");

  const resTry = await runCli(["--try", "01", "--takes", "2", "--yes"], {
    cwd: filmD,
    env: { ELEVENLABS_API_KEY: "el_key", ELEVENLABS_API_BASE: apiBase },
  });
  assert.equal(resTry.status, 0, resTry.stderr);
  assert.equal(existsSync(join(filmD, "voice/try/01_1.mp3")), true);
  assert.equal(existsSync(join(filmD, "voice/try/01_2.mp3")), true);
  assert.equal(
    lastNonEmptyLine(resTry.stdout),
    "next: hear the tries in the studio and keep one there (they are in voice/try), then bun run voice:assemble",
  );
});

test("genvoice.ts fixes: clamps invalid alignment times, rejects missing audio_base64, fails fast on GenVoice error/cancelled, and guards sts size", async (t) => {
  const clamped = alignmentToWords({
    characters: ["a", "b", " ", "c"],
    character_start_times_seconds: [-0.2, 0.1, 0.2, Number.NaN],
    character_end_times_seconds: [-0.5, -0.1, 0.2, -1],
  });
  assert.deepEqual(clamped.words, [
    { w: "ab", s: 0, e: 0 },
    { w: "c", s: 0, e: 0 },
  ]);
  assert.ok(clamped.dur >= 0);

  let polls = 0;
  let stsHeaders;
  const mockBase = await startServer(t, (req, res) => {
    if (req.url?.includes("/text-to-speech/el_empty")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ alignment: {} }));
      return;
    }
    if (req.method === "POST" && req.url?.includes("/text-to-speech/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "gv_err" }));
      return;
    }
    if (req.url?.includes("/history/gv_err")) {
      polls++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "cancelled", error: "provider aborted" }));
      return;
    }
    if (req.url?.includes("/speech-to-speech/")) {
      stsHeaders = req.headers;
      res.writeHead(200, { "content-type": "audio/mpeg", "x-request-id": "req_sts_x" });
      res.end(Buffer.from("ID3sts"));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const dir = mkdtempSync(join(tmpdir(), "cli-voice-gen-gv-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      tts({
        voiceId: "el_empty",
        text: "Hi",
        out: join(dir, "empty.mp3"),
        provider: "elevenlabs",
        apiKey: "k",
        apiBase: mockBase,
      }),
    /missing audio_base64/,
  );

  await assert.rejects(
    () =>
      tts({
        voiceId: "gv_voice",
        text: "Hi",
        out: join(dir, "err.mp3"),
        provider: "genvoice",
        apiKey: "k",
        apiBase: mockBase,
        pollIntervalMs: 1,
        maxPollMs: 5000,
      }),
    /cancelled: provider aborted/,
  );
  assert.equal(polls, 1, "cancelled status should stop polling immediately");

  const guide = join(dir, "guide.wav");
  writeFileSync(guide, "RIFF");
  const stsRes = await sts({
    voiceId: "el_voice",
    audioPath: guide,
    out: join(dir, "sts.mp3"),
    provider: "elevenlabs",
    apiKey: "k",
    apiBase: mockBase,
  });
  assert.equal(stsRes.requestId, "req_sts_x");
  assert.equal(stsHeaders["xi-api-key"], "k");

  const bigGuide = join(dir, "big.wav");
  writeFileSync(bigGuide, "");
  truncateSync(bigGuide, MAX_AUDIO_BYTES + 1);
  await assert.rejects(
    () =>
      sts({
        voiceId: "el_voice",
        audioPath: bigGuide,
        out: join(dir, "sts_big.mp3"),
        provider: "elevenlabs",
        apiKey: "k",
        apiBase: mockBase,
      }),
    /exceeds maximum size limit/,
  );
});

test("regression #32: trims keys/apiBase, redacts secrets in stderr/studio, rejects 0-byte audio, corrupt .words.json, missing edit.json, and dir/symlink output collisions", async (t) => {
  // 1. Whitespace-only ELEVENLABS_API_KEY must not bypass missing-key check or misroute GENVOICE_* to live ElevenLabs
  assert.throws(
    () => resolveVoiceProvider({}, { ELEVENLABS_API_KEY: "   ", GENVOICE_API_KEY: "  " }),
    /Missing API key/,
  );
  const gvResolved = resolveVoiceProvider(
    {},
    {
      ELEVENLABS_API_KEY: "   ",
      GENVOICE_API_KEY: "  gv_trimmed  ",
      GENVOICE_API_BASE: "",
    },
  );
  assert.equal(gvResolved.provider, "genvoice");
  assert.equal(gvResolved.apiKey, "gv_trimmed");
  assert.equal(gvResolved.apiBase, "https://api.genvoice.pro/v1");

  const elDefault = resolveVoiceProvider(
    {},
    { ELEVENLABS_API_KEY: "el_key", ELEVENLABS_API_BASE: "   " },
  );
  assert.equal(elDefault.apiBase, "https://api.elevenlabs.io/v1");
  assert.throws(
    () =>
      resolveVoiceProvider({}, { ELEVENLABS_API_KEY: "el_key", ELEVENLABS_API_BASE: "not-a-url" }),
    /Invalid ELEVENLABS_API_BASE URL/,
  );
  assert.throws(
    () =>
      resolveVoiceProvider({}, { ELEVENLABS_API_KEY: "el_key", ELEVENLABS_API_BASE: "ftp://bad" }),
    /Invalid ELEVENLABS_API_BASE protocol/,
  );

  let mockHits = 0;
  const activities = [];
  const studioBase = await startServer(t, async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url === "/api/activity") activities.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  const studioPort = Number(new URL(studioBase).port);

  const mockBase = await startServer(t, (req, res) => {
    mockHits++;
    if (req.url?.includes("/text-to-speech/el_bad_b64")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ audio_base64: "!!!" }));
      return;
    }
    if (req.url?.includes("/text-to-speech/el_401")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          detail: "Unauthorized xi-api-key: el_super_secret_key Bearer tok_secret_abc",
        }),
      );
      return;
    }
    if (req.url?.includes("/speech-to-speech/sts_zero")) {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end();
      return;
    }
    if (req.url?.includes("/text-to-speech/gv_ok")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "task_zero" }));
      return;
    }
    if (req.url?.includes("/history/task_zero")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ status: "completed", result: { audio_url: `${mockBase}/dl/empty.mp3` } }),
      );
      return;
    }
    if (req.url === "/dl/empty.mp3") {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // Invalid apiBase & whitespace key fail BEFORE onTake / mkdirSync / HTTP calls
  const badBaseDir = makeFilm(t, { takes: [{ id: "01", text: "Hi." }] });
  let tookCalls = 0;
  await assert.rejects(
    () =>
      runGen({
        cwd: badBaseDir,
        args: ["--yes"],
        env: cleanEnv({ ELEVENLABS_API_KEY: "el_key", ELEVENLABS_API_BASE: "not-a-url" }),
        onTake: () => {
          tookCalls++;
        },
      }),
    /Invalid ELEVENLABS_API_BASE URL/,
  );
  await assert.rejects(
    () =>
      runGen({
        cwd: badBaseDir,
        args: ["--yes"],
        env: cleanEnv({
          ELEVENLABS_API_KEY: "   ",
          GENVOICE_API_KEY: "",
          ELEVENLABS_API_BASE: mockBase,
        }),
        onTake: () => {
          tookCalls++;
        },
      }),
    /Missing API key/,
  );
  assert.equal(tookCalls, 0);
  assert.equal(mockHits, 0);
  assert.equal(existsSync(join(badBaseDir, "voice")), false);

  const wsRouteRes = await runCli(["--yes"], {
    cwd: makeFilm(t, { takes: [{ id: "01", voice: "gv_ok", text: "Hello." }] }),
    env: {
      ELEVENLABS_API_KEY: "   ",
      GENVOICE_API_KEY: "gv_real",
      GENVOICE_API_BASE: mockBase,
    },
  });
  assert.equal(wsRouteRes.status, 1); // rejects 0-byte download from gv_ok
  assert.match(wsRouteRes.stderr, /GenVoice audio download returned empty audio/);
  assert.equal(mockHits, 3);

  // HTTP 401 secret redaction across stderr and Studio /api/activity
  const leakDir = makeFilm(
    t,
    { takes: [{ id: "01", voice: "el_401", text: "Secret check." }] },
    { "renders/live/studio.json": { port: studioPort } },
  );
  const leakRes = await runCli(["--yes"], {
    cwd: leakDir,
    env: {
      ELEVENLABS_API_KEY: "el_super_secret_key",
      ELEVENLABS_API_BASE: mockBase,
    },
  });
  assert.equal(leakRes.status, 1);
  assert.doesNotMatch(leakRes.stderr, /el_super_secret_key|tok_secret_abc/);
  assert.match(leakRes.stderr, /\[REDACTED\]/);
  const lastActivitySay = activities.at(-1)?.say ?? "";
  assert.doesNotMatch(lastActivitySay, /el_super_secret_key|tok_secret_abc/);
  assert.match(lastActivitySay, /\[REDACTED\]/);

  // 0-byte decoded base64, GenVoice empty body, and STS empty body must throw without writing 0-byte files
  const emptyOutDir = mkdtempSync(join(tmpdir(), "cli-voice-gen-zero-"));
  t.after(() => rmSync(emptyOutDir, { recursive: true, force: true }));
  await assert.rejects(
    () =>
      tts({
        voiceId: "el_bad_b64",
        text: "Hi",
        out: join(emptyOutDir, "bad_b64.mp3"),
        provider: "elevenlabs",
        apiKey: "el_secret_k",
        apiBase: mockBase,
      }),
    /empty audio/,
  );
  assert.equal(existsSync(join(emptyOutDir, "bad_b64.mp3")), false);

  await assert.rejects(
    () =>
      tts({
        voiceId: "gv_ok",
        text: "Hi",
        out: join(emptyOutDir, "gv_empty.mp3"),
        provider: "genvoice",
        apiKey: "gv_secret_k",
        apiBase: mockBase,
        pollIntervalMs: 1,
        maxPollMs: 3000,
      }),
    /empty audio/,
  );
  assert.equal(existsSync(join(emptyOutDir, "gv_empty.mp3")), false);

  const guideFile = join(emptyOutDir, "guide.wav");
  writeFileSync(guideFile, "RIFF");
  await assert.rejects(
    () =>
      sts({
        voiceId: "sts_zero",
        audioPath: guideFile,
        out: join(emptyOutDir, "sts_empty.mp3"),
        provider: "elevenlabs",
        apiKey: "el_secret_k",
        apiBase: mockBase,
      }),
    /empty audio/,
  );
  assert.equal(existsSync(join(emptyOutDir, "sts_empty.mp3")), false);

  // Corrupt .words.json in isMain does not emit uncaught stack trace and still prints next:
  const corruptWordsDir = makeFilm(
    t,
    { takes: [{ id: "01", text: "Hello." }] },
    {
      "voice/takes/01.mp3": "ID3",
      "voice/takes/01.mp3.words.json": "{broken",
    },
  );
  const corruptWordsRes = await runCli([], { cwd: corruptWordsDir });
  assert.equal(corruptWordsRes.status, 0, corruptWordsRes.stderr);
  assert.match(corruptWordsRes.stderr, /skipping word-mismatch check/);
  assert.doesNotMatch(corruptWordsRes.stderr, /at .*gen\.ts/);
  assert.match(lastNonEmptyLine(corruptWordsRes.stdout), /^next: /);

  // Directory collision at voice/takes/02.mp3 stops 01 + 02 BEFORE calling API for 01
  const dirCollide = makeFilm(
    t,
    {
      takes: [
        { id: "01", text: "First." },
        { id: "02", text: "Second." },
      ],
    },
    { "voice/takes/02.mp3/.keep": "" },
  );
  const hitsBeforeCollide = mockHits;
  await assert.rejects(
    () => runGen({ cwd: dirCollide, args: [], env: cleanEnv() }),
    /directory or non-file/,
  );
  await assert.rejects(
    () =>
      runGen({
        cwd: dirCollide,
        args: ["01", "02", "--yes"],
        env: cleanEnv({ ELEVENLABS_API_KEY: "el_key", ELEVENLABS_API_BASE: mockBase }),
      }),
    /directory or non-file/,
  );
  assert.equal(
    mockHits,
    hitsBeforeCollide,
    "directory output collision must abort before API call",
  );

  // Missing src/edit.json reports actionable message without ENOENT; --guide "   " exits 2; 0-byte guide rejected upfront
  const noEditDir = makeFilm(t, { takes: [] });
  rmSync(join(noEditDir, "src/edit.json"));
  const noEditRes = await runCli([], { cwd: noEditDir });
  assert.equal(noEditRes.status, 1);
  assert.match(noEditRes.stderr, /Missing src\/edit\.json/);
  assert.doesNotMatch(noEditRes.stderr, /ENOENT/);

  const wsGuideRes = await runCli(["01", "--guide", "   "], { cwd: noEditDir });
  assert.equal(wsGuideRes.status, 2);

  const zeroGuideDir = makeFilm(
    t,
    { takes: [{ id: "01", guide: "voice/zero.wav" }] },
    { "voice/zero.wav": "" },
  );
  await assert.rejects(
    () => runGen({ cwd: zeroGuideDir, args: ["--dry-run"], env: cleanEnv() }),
    /empty \(0 bytes\)/,
  );
});
