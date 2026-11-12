import assert from "node:assert/strict";
import { test } from "node:test";

import { ADJUSTMENTS } from "film-stage/grade-color";

import {
  checkFiles,
  checkFilm,
  Edit,
  Grade,
  ShotsTimeline,
  SoundProcess,
  SoundTimeline,
  StudioConfig,
  TextTimeline,
  TimingTimeline,
  Trials,
} from "../src/contract.ts";

const v3 = () => ({ isVector3: true });
const film = () => ({
  buildScene() {},
  applyEdit() {},
  DURATION: 10,
  SHOTS: [{ t: 0 }, { t: 4 }],
  SHOTS_OUT: [{ t: 0 }, { t: 4 }],
});
const draw = (tools) =>
  Object.assign(() => {}, {
    tools: {
      scene: { isObject3D: true },
      camera: { isCamera: true },
      look: v3(),
      free: { on: false, p: v3(), l: v3(), fov: 40 },
      ...tools,
    },
  });

test("shot adjustments accept the finishing sliders in [0..100] and reject values outside", () => {
  const shots = (basic) => [{ t: 0, adjust: { enabled: true, basic } }];
  assert.equal(
    ShotsTimeline.safeParse(
      shots({
        exposure: 25,
        vignette: -100,
        sharpen: 100,
        halation: 45,
        dither: 50,
        soften: 60,
        fringe: 40,
        fisheye: 100,
      }),
    ).success,
    true,
  );
  for (const basic of [
    { exposure: 101 },
    { sharpen: -1 },
    { halation: -1 },
    { halation: 101 },
    { dither: -5 },
    { dither: 105 },
    { soften: -1 },
    { fringe: 101 },
    { fisheye: -10 },
    { temp: Infinity },
    { exposure: "20" },
  ]) {
    assert.equal(ShotsTimeline.safeParse(shots(basic)).success, false);
  }
});

test("color curves require ordered distinct inputs, bounded points and valid HSL values", () => {
  const parse = (adjust) => ShotsTimeline.safeParse([{ t: 0, adjust }]).success;
  assert.equal(
    parse({
      curves: {
        luma: [
          [0, 0],
          [0.5, 0.8],
          [1, 1],
        ],
      },
      hsl: { green: { saturation: -100 } },
    }),
    true,
  );
  for (const points of [
    [[0, 0]],
    [
      [0, 0],
      [0, 1],
    ],
    [
      [1, 1],
      [0, 0],
    ],
    [
      [0, -1],
      [1, 1],
    ],
  ])
    assert.equal(parse({ curves: { red: points } }), false);
  assert.equal(parse({ hsl: { blue: { hue: 101 } } }), false);
  assert.equal(
    parse({ wheels: { mode: "log", offset: { rgb: [0.1, -0.1, 0], saturation: 50 } } }),
    true,
  );
  for (const wheels of [
    { amount: 101 },
    { mode: "invalid" },
    { shadows: { rgb: [0, 0, 2] } },
    { offset: { saturation: -1 } },
  ])
    assert.equal(parse({ wheels }), false);
});

test("transitions welcome Cinetic and custom film effects with ease, feather and flip while rejecting invalid bounds", () => {
  const shots = (transition) => [{ t: 0 }, { t: 4, transition }];
  assert.equal(ShotsTimeline.safeParse(shots({ fx: "dissolve", len: 1 })).success, true);
  assert.equal(
    ShotsTimeline.safeParse(
      shots({
        fx: "lumaMelt",
        len: 0.65,
        ease: "glide",
        feather: 0.35,
        flip: true,
        customUniform: 2,
      }),
    ).success,
    true,
  );
  assert.equal(
    ShotsTimeline.safeParse(shots({ fx: "customPortal", len: 0.8, ease: [0.2, 0, 0, 1] })).success,
    true,
  );
  for (const transition of [
    { fx: "", len: 1 },
    { fx: "black", len: 0 },
    { fx: "wipe", len: Infinity },
    { fx: "lumaMelt", len: 0.5, feather: 1.5 },
    { fx: "lumaMelt", len: 0.5, flip: "yes" },
    { fx: "lumaMelt", len: 0.5, ease: "" },
  ]) {
    assert.equal(ShotsTimeline.safeParse(shots(transition)).success, false);
  }
});

test("a beat without a time is reported with its file and where in it", () => {
  const edit = JSON.stringify({
    voice: { edits: {}, warp: [] },
    beats: { spin: { title: "spin", dur: 1, kind: "motion", sounds: [] } },
  });
  const [p] = checkFiles({ "src/edit.json": [Edit, edit] });
  assert.match(p, /^src\/edit\.json/);
  assert.match(p, /beats\.spin\.at/);
});

test("a sound group whose options share an id is reported, a missing file is not", () => {
  const trials = JSON.stringify({
    hum: {
      title: "hum",
      kind: "stem",
      from: 0,
      to: 5,
      options: [
        { id: "a", title: "A", files: ["/a.webm"] },
        { id: "a", title: "B", files: ["/b.webm"] },
      ],
    },
  });
  assert.match(checkFiles({ trials: [Trials, trials] })[0], /option ids must differ/);
  assert.deepEqual(checkFiles({ trials: [Trials, undefined] }), []);
});

test("a film is told what its draw lacks, and a complete one passes", () => {
  assert.deepEqual(checkFilm(film(), draw()), []);
  assert.match(checkFilm(film(), draw({ camera: undefined })).join(), /tools\.camera/);
  assert.match(
    checkFilm({ ...film(), SHOTS_OUT: [{ t: 4 }, { t: 0 }] }, draw()).join(),
    /in order of time/,
  );
});

test("draw.checks, when a film has them, are functions by name", () => {
  const withChecks = (checks) => Object.assign(draw(), { checks });
  assert.deepEqual(checkFilm(film(), withChecks({ slide: () => [] })), []);
  assert.match(checkFilm(film(), withChecks({ slide: "0,108" })).join(), /checks\.slide/);
});

test("key easing controls only offer evaluators the film can draw", () => {
  const withEase = (names) =>
    Object.assign(draw(), {
      eases: { linear: (t) => t },
      keyEases: [{ edit: "steve", path: ["moves"], names }],
    });
  assert.deepEqual(checkFilm(film(), withEase(["linear"])), []);
  assert.match(checkFilm(film(), withEase(["missing"])).join(), /keyEases/);
  assert.match(checkFilm(film(), withEase([])).join(), /keyEases/);
});

test("scene selection targets bind real objects to explicit key paths and have unique ids", () => {
  const target = {
    id: "steve",
    title: "Steve",
    objects: [{ isObject3D: true }],
    rows: [{ edit: "steve", path: [] }],
  };
  assert.deepEqual(checkFilm(film(), draw({ targets: [target] })), []);
  assert.match(
    checkFilm(film(), draw({ targets: [target, target] })).join(),
    /target ids must differ/,
  );
  assert.match(
    checkFilm(film(), draw({ targets: [{ ...target, objects: ["steve"] }] })).join(),
    /targets.*objects/,
  );
  const transform = {
    row: target.rows[0],
    axes: { translate: [true, false, false] },
    read() {},
    write() {},
  };
  assert.deepEqual(checkFilm(film(), draw({ targets: [{ ...target, transform }] })), []);
  assert.match(
    checkFilm(
      film(),
      draw({ targets: [{ ...target, transform: { ...transform, write: "missing" } }] }),
    ).join(),
    /transform.*write/,
  );
});

test("a home spot is optional, and one without a look point is reported", () => {
  assert.deepEqual(
    checkFilm(film(), draw({ home: { p: [2.5, 1.6, 3], l: [2.5, 1.4, 0], fov: 60 } })),
    [],
  );
  assert.match(checkFilm(film(), draw({ home: { p: [2.5, 1.6, 3] } })).join(), /tools\.home\.l/);
});

test("\"off\" is the studio's own option, never a film's", () => {
  const trials = JSON.stringify({
    hum: {
      title: "hum",
      kind: "stem",
      from: 0,
      to: 5,
      options: [
        { id: "off", title: "A", files: ["/a.webm"] },
        { id: "b", title: "B", files: ["/b.webm"] },
      ],
    },
  });
  assert.match(checkFiles({ trials: [Trials, trials] })[0], /studio's Off chip/);
});

test("a shot's animation welcomes Cinetic curves, Bezier tuples and seam toggle while reporting invalid options", () => {
  const shots = (anim) => JSON.stringify([{ t: 0 }, { t: 4, anim }]);
  assert.deepEqual(
    checkFiles({
      "src/timeline/shots.json": [
        ShotsTimeline,
        shots({
          in: { fx: "rush", len: 1, curve: "whip", flip: true, optics: 0.5, seam: false },
          out: { fx: "carryLaunch", len: 0.45, curve: [0.2, 0, 0, 1] },
          combo: { fx: "push", k: 2 },
        }),
      ],
    }),
    [],
  );
  const [p] = checkFiles({
    "src/timeline/shots.json": [ShotsTimeline, shots({ out: { fx: "fade", len: -1 } })],
  });
  assert.match(p, /anim/);
  assert.match(
    checkFiles({ "src/timeline/shots.json": [ShotsTimeline, shots({ in: { len: 1 } })] })[0],
    /fx/,
  );
  for (const bad of [
    { fx: "push", curve: "" },
    { fx: "push", curve: [2, 0, 0, 1] },
    { fx: "push", flip: "yes" },
    { fx: "rush", seam: "no" },
    { fx: "rush", optics: 1.5 },
    { fx: "rush", optics: -0.1 },
    { fx: "push", k: 0 },
    { fx: "push", k: -1 },
  ]) {
    assert.equal(ShotsTimeline.safeParse([{ t: 0 }, { t: 4, anim: { in: bad } }]).success, false);
  }
});

test("velocity and text timelines welcome Cinetic accents, annotation shapes, voice settings, and custom AI kinds", () => {
  const velOk = {
    velocity: [
      {
        from: 0,
        to: 4,
        music: "beat",
        beats: [0.5, 1.5],
        effect: "hitPunch",
        frequency: 1,
        speed: "fast",
        intensity: 80,
      },
    ],
  };
  const velCustom = {
    velocity: [
      {
        from: 0,
        to: 4,
        music: "beat",
        beats: [0.5, 1.5],
        effect: "customStrobe",
        frequency: 2,
        speed: "normal",
        intensity: 60,
        customGain: 1.2,
      },
    ],
  };
  assert.equal(TimingTimeline.safeParse(velOk).success, true);
  assert.equal(TimingTimeline.safeParse(velCustom).success, true);
  assert.equal(
    TimingTimeline.safeParse({ velocity: [{ ...velOk.velocity[0], effect: "" }] }).success,
    false,
  );

  const textOk = {
    items: [
      {
        kind: "text",
        from: 0,
        to: 3,
        text: "ACT I",
        in: { fx: "inkIn", len: 0.6, ease: "glide", stagger: 0.5, tint: "#38BDF8" },
        out: { fx: "wordDropOut", len: 0.4, stagger: 0.35 },
      },
      { kind: "box", from: 0.5, to: 2.5, w: 320, h: 180, in: { fx: "spinDraw", len: 0.5 } },
      { kind: "bracket", from: 0.5, to: 2.5, w: 280, h: 160 },
      { kind: "underline", from: 1, to: 3, size: 240 },
      { kind: "customCallout", from: 1, to: 2.5, badge: "AI" },
    ],
  };
  assert.equal(TextTimeline.safeParse(textOk).success, true);
  assert.equal(TextTimeline.safeParse({ items: [{ kind: "", from: 0, to: 2 }] }).success, false);
  assert.equal(
    TextTimeline.safeParse({
      items: [{ kind: "text", from: 0, to: 2, in: { fx: "inkIn", stagger: 1.4 } }],
    }).success,
    false,
  );
  const held = (hold) =>
    TextTimeline.safeParse({
      items: [{ kind: "text", from: 0, to: 2, in: { fx: "counter", len: 1, hold } }],
    }).success;
  assert.equal(held(2), true);
  assert.equal(held(0), false);
  assert.equal(held(2.5), false);
});

test("draw.anims and draw.transitions, when a film has them, validate id, title and tip", () => {
  const anims = {
    in: [{ id: "fade", title: "Fade in", cat: "Lens & Light", tip: "Opens from black" }],
    out: [],
    combo: [],
  };
  const transitions = [
    {
      id: "lumaMelt",
      title: "Luma Melt",
      category: "Light & Focus",
      tip: "Organic luminance threshold dissolve",
    },
  ];
  assert.deepEqual(checkFilm(film(), Object.assign(draw(), { anims, transitions })), []);
  assert.match(
    checkFilm(
      film(),
      Object.assign(draw(), { anims: { ...anims, combo: [{ id: "push" }] } }),
    ).join(),
    /anims/,
  );
  assert.match(
    checkFilm(film(), Object.assign(draw(), { transitions: [{ id: "lumaMelt" }] })).join(),
    /transitions/,
  );
});

test("draw.velocity, draw.velocityEffects, and draw.adjustments validate optional studio hooks", () => {
  assert.deepEqual(
    checkFilm(
      film(),
      Object.assign(draw(), {
        velocity: true,
        velocityEffects: ["flash", { id: "customStrobe", title: "Strobe", preview: "pulse" }],
        adjustments: { prepare: async () => {} },
      }),
    ),
    [],
  );
  assert.match(checkFilm(film(), Object.assign(draw(), { velocity: "yes" })).join(), /velocity/);
  assert.match(
    checkFilm(film(), Object.assign(draw(), { velocityEffects: [""] })).join(),
    /velocityEffects/,
  );
  assert.match(
    checkFilm(
      film(),
      Object.assign(draw(), { velocityEffects: ["flash", { id: "flash" }] }),
    ).join(),
    /velocityEffects/,
  );
  assert.match(
    checkFilm(film(), Object.assign(draw(), { adjustments: { prepare: "nope" } })).join(),
    /adjustments/,
  );
});

test("Edit contract validates optional takes array while reporting unsafe or duplicate take ids", () => {
  const validEdit = {
    voice: { lines: [], edits: {}, warp: [] },
    takes: [
      { id: "01_hook", text: "[whispering] Wake up.", stability: 0.5 },
      { id: "02", t: 4.2, voice: "ZaZosYpkIGmSqOwAlfnk", text: "Stone walls." },
    ],
    beats: {},
  };
  assert.equal(Edit.safeParse(validEdit).success, true);
  assert.equal(
    Edit.safeParse({ ...validEdit, takes: [{ id: "01.bad", text: "Dot in id" }] }).success,
    false,
  );
  assert.equal(
    Edit.safeParse({
      ...validEdit,
      takes: [
        { id: "01", text: "A" },
        { id: "01", text: "B" },
      ],
    }).success,
    false,
  );
});

test("a time written as text, as 0:50, is answered with the seconds it should be", () => {
  const [text] = checkFiles({
    "src/timeline/audio.json": [
      SoundTimeline,
      JSON.stringify({
        beds: [],
        sfx: [
          { at: 1, name: "door", gain: 0 },
          { at: "0:50", name: "slam", gain: 0 },
        ],
      }),
    ],
  });
  assert.match(
    text,
    /seconds as a number, like 50 for 0:50; got the text "0:50"\n\s+→ at sfx\[1\]\.at/,
  );
});

test("SoundTimeline accepts safe clip filters, try options, pan and mastering fields while rejecting traversal names and filtergraph injection", () => {
  const validAudio = {
    narration: "narration",
    voice: false,
    voiceGain: 0,
    lufs: -14.3,
    drive: 9,
    beds: [
      {
        name: "room_hum",
        from: 0,
        to: 12,
        gain: -6,
        fadeIn: 0.2,
        fadeOut: 1,
        pan: -0.5,
        filters: ["lowpass=f=1800:poles=2", "highpass=f=200"],
        try: ["hum_lowfreq", "bgm-pulse"],
      },
    ],
    sfx: [
      {
        at: 1.5,
        name: "cabinet_rustle",
        gain: -2.2,
        pan: 0.4,
        filters: ["lowpass=f=2500:poles=2"],
        try: ["cabinet_rustle_crumple"],
      },
    ],
  };
  assert.equal(SoundTimeline.safeParse(validAudio).success, true);
  assert.equal(
    StudioConfig.safeParse({ soundSources: { narration: "assets/public/agent/full_voice.wav" } })
      .success,
    true,
  );
  assert.equal(StudioConfig.safeParse({ soundSources: { "..": "../secret.wav" } }).success, false);

  const badCases = [
    { ...validAudio, beds: [{ ...validAudio.beds[0], name: ".." }] },
    { ...validAudio, beds: [{ ...validAudio.beds[0], name: ".hidden" }] },
    { ...validAudio, beds: [{ ...validAudio.beds[0], try: ["../escape"] }] },
    { ...validAudio, beds: [{ ...validAudio.beds[0], try: [".."] }] },
    { ...validAudio, beds: [{ ...validAudio.beds[0], filters: ["volume=1;amovie=/etc/passwd"] }] },
    {
      ...validAudio,
      beds: [{ ...validAudio.beds[0], filters: ["lowpass=f=1800,amovie=foo.wav"] }],
    },
    { ...validAudio, sfx: [{ ...validAudio.sfx[0], filters: ["amovie=foo.wav"] }] },
    { ...validAudio, sfx: [{ ...validAudio.sfx[0], pan: 2 }] },
    { ...validAudio, sfx: [{ ...validAudio.sfx[0], pan: "left" }] },
    { ...validAudio, drive: "9;amovie=x" },
  ];
  for (const bad of badCases) {
    assert.equal(SoundTimeline.safeParse(bad).success, false);
  }
});

test("audioFilter allowlists stateless DSP filters and rejects file-I/O or infinite filters", () => {
  const base = { beds: [], sfx: [{ at: 0, name: "tap", gain: 0 }] };
  for (const ok of [
    "lowpass=f=2500:poles=2",
    "highpass=f=120",
    "acompressor=threshold=-18dB:ratio=3",
    "volume=1.5",
  ]) {
    assert.equal(
      SoundTimeline.safeParse({ ...base, sfx: [{ ...base.sfx[0], filters: [ok] }] }).success,
      true,
      `expected ${ok} to be allowed`,
    );
  }
  for (const unsafe of [
    "firequalizer=dumpfile=clobbered.txt",
    "whisper=model=ggml.bin:destination=out.txt",
    "arnndn=m=model.rnnn",
    "sofalizer=sofa=hrtf.sofa",
    "aloop=loop=-1:size=2000000000",
    "aresample=384000000",
  ]) {
    assert.equal(
      SoundTimeline.safeParse({ ...base, sfx: [{ ...base.sfx[0], filters: [unsafe] }] }).success,
      false,
      `expected ${unsafe} to be rejected`,
    );
  }
});

test("SoundProcess and SoundTimeline enforce upper bounds on audio duration", () => {
  assert.equal(
    SoundProcess.safeParse({ name: "tap", start: 0, duration: 120, loop: false }).success,
    true,
  );
  assert.equal(
    SoundProcess.safeParse({ name: "tap", start: 0, duration: 10000, loop: true }).success,
    false,
  );
  assert.equal(
    SoundTimeline.safeParse({
      beds: [{ name: "hum", from: 0, to: 100000, gain: -6, fadeIn: 0, fadeOut: 0 }],
      sfx: [],
    }).success,
    false,
  );
  assert.equal(
    SoundTimeline.safeParse({
      beds: [],
      sfx: [{ at: 0, name: "tap", gain: 0, length: 100000 }],
    }).success,
    false,
  );
});

test("the contract's Basic sliders are film-stage's ADJUSTMENTS, each with its own lower bound", () => {
  const basic = Grade.shape.basic.unwrap().shape;
  assert.deepEqual(Object.keys(basic).sort(), ADJUSTMENTS.map((a) => a.id).sort());
  for (const a of ADJUSTMENTS) {
    assert.equal(basic[a.id].safeParse(a.min).success, true, a.id);
    assert.equal(basic[a.id].safeParse(a.min - 1).success, false, a.id);
  }
});
