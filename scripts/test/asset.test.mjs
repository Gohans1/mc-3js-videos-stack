import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileLayerTiming } from "../../packages/live-studio/src/layer-timing.mjs";
import { LINKAGE_DEFAULTS, recordLinkage } from "../../packages/live-studio/src/linkage.mjs";
import { mapTimeline } from "../../packages/live-studio/src/timing-data.mjs";

const root = mkdtempSync(join(tmpdir(), "mc-asset-cli-"));
mkdirSync(join(root, "src/timeline"), { recursive: true });
writeFileSync(join(root, "src/scene.ts"), "");
const conf = {
  shotsTimeline: "src/timeline/shots.json",
  textTimeline: "src/timeline/text.json",
  adjustmentTimeline: "src/timeline/adjust.json",
  soundTimeline: "src/timeline/audio.json",
  timingTimeline: "src/timeline/timing.json",
  sfx: "sound/sfx",
};
writeFileSync(join(root, "package.json"), JSON.stringify({ "live-studio": conf }));
writeFileSync(join(root, "src/edit.json"), JSON.stringify({ end: 20 }));
writeFileSync(join(root, conf.shotsTimeline), JSON.stringify([{ t: 0 }, { t: 5 }, { t: 10 }]));
writeFileSync(
  join(root, conf.timingTimeline),
  JSON.stringify({ speeds: [{ from: 0, to: 20, rate: 2 }] }),
);
afterAll(() => rmSync(root, { recursive: true, force: true }));
const run = (...args) =>
  Bun.spawnSync([process.execPath, "scripts/asset.mjs", ...args], {
    cwd: join(import.meta.dir, "../.."),
    timeout: 15000,
  });
const json = (...args) => {
  const r = run(...args);
  expect(r.exitCode, r.stderr.toString()).toBe(0);
  return JSON.parse(r.stdout.toString());
};
const wave = (film, name, seconds) => {
  mkdirSync(join(film, "sound/sfx"), { recursive: true });
  const size = Math.round(48000 * seconds) * 2,
    data = Buffer.alloc(44 + size);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(48000, 24);
  data.writeUInt32LE(96000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(size, 40);
  writeFileSync(join(film, `sound/sfx/${name}.wav`), data);
};

test("native and imported placement share heard seconds and return editable targets", () => {
  const grade = json("use", "filter/teal-amber", "--film", root, "--from", "1", "--to", "3");
  expect(grade.target).toMatch(/^adjustment:/);
  const text = json(
    "use",
    "text/in/fade",
    "--film",
    root,
    "--from",
    "2",
    "--to",
    "4",
    "--props",
    JSON.stringify({ text: "Hello", custom: "kept" }),
  );
  expect(text.target).toMatch(/^text:/);
  const edited = json(
    "edit",
    text.target,
    "--film",
    root,
    "--props",
    JSON.stringify({ from: 3, to: 5, text: "New" }),
  );
  expect(edited.data.items[0]).toMatchObject({ from: 3, to: 5, text: "New", custom: "kept" });
  expect(
    JSON.parse(readFileSync(join(root, conf.textTimeline), "utf8")).items[0].timebase,
  ).toBeDefined();
  const cut = json("use", "transition/dissolve", "--film", root, "--shot", "1");
  expect(cut.target).toBe("transitions:1");
  expect(
    JSON.parse(readFileSync(join(root, conf.shotsTimeline), "utf8"))[1].transition.len,
  ).toBeCloseTo(1);
  const overlay = json("use", "of-effects-snow", "--film", root, "--from", "1", "--to", "2");
  expect(overlay.target).toMatch(/^effects:/);
  json("remove", overlay.target, "--film", root);
  expect(json("timeline", "--film", root, "--lane", "effects").data.items).toEqual([]);
  expect(json("validate", "--film", root).valid).toBe(true);
});

test("invalid command filters and creative controls fail before changing the film", () => {
  const before = readFileSync(join(root, conf.shotsTimeline), "utf8");
  expect(run("list", "--kind", "transtion").exitCode).toBe(2);
  expect(run("list", "--source", "typo").exitCode).toBe(2);
  expect(
    run("use", "transition/dissolve", "--film", root, "--shot", "1", "--props", "[]").exitCode,
  ).toBe(2);
  expect(readFileSync(join(root, conf.shotsTimeline), "utf8")).toBe(before);
});

test("sound and transition edits complete the shared workflow", () => {
  mkdirSync(join(root, "sound/sfx"), { recursive: true });
  const wav = Buffer.alloc(44 + 9600);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(9600, 40);
  writeFileSync(join(root, "sound/sfx/click.wav"), wav);
  const sound = json(
    "use",
    "sound/click",
    "--film",
    root,
    "--from",
    "2",
    "--to",
    "2.05",
    "--props",
    '{"gain":-12}',
  );
  expect(sound.item.at).toBe(2);
  expect(sound.item.length).toBeCloseTo(0.05);
  json("edit", sound.target, "--film", root, "--props", '{"at":3,"gain":-6}');
  const audio = json("timeline", "--film", root, "--lane", "audio");
  expect(audio.data.sfx[0]).toMatchObject({ at: 3, gain: -6 });
  expect(JSON.parse(readFileSync(join(root, conf.soundTimeline), "utf8")).sfx[0].at).toBe(6);
  json("remove", sound.target, "--film", root);
  expect(json("timeline", "--film", root, "--lane", "audio").data.sfx).toEqual([]);
  json("use", "transition/dissolve", "--film", root, "--shot", "1");
  json("edit", "transitions:1", "--film", root, "--props", '{"len":0.25,"ease":"linear"}');
  expect(
    json("timeline", "--film", root, "--lane", "transitions").data[1].transition,
  ).toMatchObject({ len: 0.25, ease: "linear" });
  json("remove", "transitions:1", "--film", root);
  expect(JSON.parse(readFileSync(join(root, conf.shotsTimeline), "utf8"))).toHaveLength(3);
});

test("audio lane keeps narration on its own linkage clock", () => {
  const film = mkdtempSync(join(tmpdir(), "mc-asset-voice-clock-"));
  try {
    mkdirSync(join(film, "src/timeline"), { recursive: true });
    writeFileSync(join(film, "src/scene.ts"), "");
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(join(film, "src/edit.json"), JSON.stringify({ end: 10 }));
    const timing = { freezes: [{ at: 2, duration: 3 }] };
    recordLinkage(timing, {}, timing, true, { ...LINKAGE_DEFAULTS, voice: false });
    writeFileSync(join(film, conf.timingTimeline), JSON.stringify(timing));
    writeFileSync(
      join(film, conf.soundTimeline),
      JSON.stringify({
        narration: "voice",
        beds: [],
        sfx: [
          { name: "voice", at: 5, length: 1, gain: 0 },
          { name: "hit", at: 5, length: 1, gain: 0 },
        ],
      }),
    );
    const result = json("timeline", "--film", film, "--lane", "audio");
    expect(result.data.sfx.map((it) => it.at)).toEqual([5, 8]);
    json("edit", result.targets[0], "--film", film, "--props", '{"gain":-3}');
    const source = JSON.parse(readFileSync(join(film, conf.soundTimeline), "utf8"));
    expect(source.sfx.map((it) => it.at)).toEqual([5, 5]);
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("music and explicit ambience beds have valid fade defaults and editable targets", () => {
  wave(root, "music", 1);
  wave(root, "ambience", 1);
  writeFileSync(
    join(root, "sound/sfx/SOURCES.json"),
    JSON.stringify({ music: { kind: "bgm" }, ambience: { kind: "sfx" } }),
  );
  const music = json("use", "sound/music", "--film", root, "--from", "1", "--to", "3");
  expect(music.target).toMatch(/^audio:beds:/);
  expect(music.item).toMatchObject({ from: 1, to: 3, fadeIn: 0, fadeOut: 0 });
  const ambience = json(
    "use",
    "sound/music",
    "--film",
    root,
    "--from",
    "4",
    "--to",
    "6",
    "--props",
    '{"bed":true,"fadeIn":0.1,"fadeOut":0.2}',
  );
  expect(ambience.item.fadeIn).toBeCloseTo(0.1);
  expect(ambience.item.fadeOut).toBeCloseTo(0.2);
  const sfxBed = json(
    "use",
    "sound/ambience",
    "--film",
    root,
    "--from",
    "6",
    "--to",
    "7",
    "--props",
    '{"bed":true}',
  );
  expect(sfxBed.item.fadeIn).toBe(0);
  for (const placed of [music, ambience, sfxBed]) json("remove", placed.target, "--film", root);
});

test("new implicit one-shots preserve their waveform through fast and slow playback", () => {
  for (const rate of [0.5, 2]) {
    const film = mkdtempSync(join(tmpdir(), "mc-asset-natural-sfx-"));
    try {
      mkdirSync(join(film, "src/timeline"), { recursive: true });
      writeFileSync(join(film, "src/scene.ts"), "");
      writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
      writeFileSync(join(film, "src/edit.json"), JSON.stringify({ end: 20 }));
      wave(film, "hit", 1);
      writeFileSync(join(film, conf.soundTimeline), JSON.stringify({ beds: [], sfx: [] }));
      writeFileSync(
        join(film, conf.timingTimeline),
        JSON.stringify({ speeds: [{ from: 0, to: 20, rate }] }),
      );
      const added = json(
        "use",
        "sound/hit",
        "--film",
        film,
        "--from",
        "2",
        "--props",
        '{"fadeOut":0.2}',
      );
      const source = JSON.parse(readFileSync(join(film, conf.soundTimeline), "utf8")).sfx[0];
      expect(source.length).toBeUndefined();
      expect(source.at).toBeCloseTo(2 * rate);
      expect(source.fadeOut).toBeCloseTo(0.2 * rate);
      expect(added.item.length).toBeCloseTo(1 / rate);
    } finally {
      rmSync(film, { recursive: true, force: true });
    }
  }
});

test("code-defined durations are explicit and placement agrees with the actual runtime clock", () => {
  const film = mkdtempSync(join(tmpdir(), "mc-asset-code-duration-"));
  try {
    mkdirSync(join(film, "src/timeline"), { recursive: true });
    writeFileSync(join(film, "src/scene.ts"), "export const DURATION = 20;");
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(join(film, "src/edit.json"), "{}");
    const timing = { speeds: [{ from: 0, to: 20, rate: 2 }] };
    writeFileSync(join(film, conf.timingTimeline), JSON.stringify(timing));
    const rejected = run(
      "use",
      "text/in/fade",
      "--film",
      film,
      "--from",
      "1",
      "--to",
      "3",
      "--props",
      '{"text":"Hello"}',
    );
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stderr.toString()).toContain("--duration");
    for (const id of ["text/in/fade", "of-effects-snow"]) {
      json(
        "use",
        id,
        "--film",
        film,
        "--duration",
        "20",
        "--from",
        "1",
        "--to",
        "3",
        "--props",
        id.startsWith("text/") ? '{"text":"Hello"}' : "{}",
      );
    }
    const raw = JSON.parse(readFileSync(join(film, conf.textTimeline), "utf8"));
    const actual = mapTimeline("text", raw, compileLayerTiming(timing, 20, "text"));
    expect(actual.items[0]).toMatchObject({ from: 1, to: 3 });
    expect(json("timeline", "--film", film, "--duration", "20").data.items[0]).toMatchObject({
      from: 1,
      to: 3,
    });
    const overlays = json("timeline", "--film", film, "--duration", "20");
    const overlayFile = join(film, "src/timeline/openfilm.json"),
      before = readFileSync(overlayFile, "utf8");
    const refused = run("remove", overlays.targets[0], "--film", film);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr.toString()).toContain("--duration");
    expect(readFileSync(overlayFile, "utf8")).toBe(before);
    expect(readFileSync(join(film, "src/edit.json"), "utf8")).toBe("{}");
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("held audio times fail without writes while independent SFX clocks remain usable", () => {
  const film = mkdtempSync(join(tmpdir(), "mc-asset-held-sfx-"));
  try {
    mkdirSync(join(film, "src/timeline"), { recursive: true });
    writeFileSync(join(film, "src/scene.ts"), "");
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(join(film, "src/edit.json"), JSON.stringify({ end: 20 }));
    wave(film, "hit", 1);
    const timing = { freezes: [{ at: 2, duration: 3 }] },
      audio = JSON.stringify({ beds: [], sfx: [] });
    writeFileSync(join(film, conf.timingTimeline), JSON.stringify(timing));
    writeFileSync(join(film, conf.soundTimeline), audio);
    const refused = run("use", "sound/hit", "--film", film, "--from", "3");
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr.toString()).toContain("clock");
    expect(readFileSync(join(film, conf.soundTimeline), "utf8")).toBe(audio);
    timing.layerKinds = { sfx: { base: {}, changes: [] } };
    writeFileSync(join(film, conf.timingTimeline), JSON.stringify(timing));
    expect(json("use", "sound/hit", "--film", film, "--from", "3").item.at).toBe(3);
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("implicit SFX duration keeps end fades correct across a speed boundary", () => {
  const film = mkdtempSync(join(tmpdir(), "mc-asset-duration-"));
  try {
    mkdirSync(join(film, "src/timeline"), { recursive: true });
    writeFileSync(join(film, "src/scene.ts"), "");
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(join(film, "src/edit.json"), JSON.stringify({ end: 20 }));
    writeFileSync(
      join(film, conf.timingTimeline),
      JSON.stringify({ speeds: [{ from: 0, to: 10, rate: 2 }] }),
    );
    wave(film, "long", 10);
    writeFileSync(
      join(film, conf.soundTimeline),
      JSON.stringify({ beds: [], sfx: [{ name: "long", at: 4, gain: 0, fadeOut: 1 }] }),
    );
    const view = json("timeline", "--film", film, "--lane", "audio");
    expect(view.data.sfx[0]).toMatchObject({ at: 2, length: 7, fadeOut: 1 });
    json("edit", view.targets[0], "--film", film, "--props", '{"fadeOut":2}');
    const source = JSON.parse(readFileSync(join(film, conf.soundTimeline), "utf8")).sfx[0];
    expect(source.fadeOut).toBe(2);
    expect(source.length).toBeUndefined();
    const before = readFileSync(join(film, conf.soundTimeline), "utf8");
    expect(
      run("edit", "audio:sfx:0:extra", "--film", film, "--props", '{"gain":-12}').exitCode,
    ).not.toBe(0);
    expect(readFileSync(join(film, conf.soundTimeline), "utf8")).toBe(before);
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});
