// app/own/own-work.ts: what a film's code adds on top of the studio's libraries, for the view-only Film tab
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fieldsOf,
  isOwnEase,
  isOwnFx,
  isOwnVelocity,
  otherKeys,
  ownWork,
  THIS_FILM,
  withFilmChip,
} from "../app/own/own-work.ts";

const dissolve = {
  id: "dissolve",
  title: "Dissolve",
  tip: "built in",
  glsl: "vec4 transition(vec2 uv){}",
};
const fade = { id: "fade", title: "Fade", cat: "Basic", tip: "built in", len: 0.5 };
const builtins = {
  transitions: [dissolve],
  anims: { in: [fade], out: [], combo: [] },
  voices: {
    text: { in: [{ id: "up", title: "Slide up", len: 0.5 }], out: [] },
    shape: { in: [], out: [] },
  },
  eases: { linear: (x) => x },
  velocityEffects: ["flash"],
  rowKeys: { Shot: ["t", "name", "anim"], Text: ["kind", "text", "from", "to"] },
};
const none = { shots: [], texts: [] };
const group = (groups, id) => groups.find((g) => g.id === id);

test("a film's own effects are listed with the heard seconds they are used at; the studio's own are not", () => {
  const glitch = {
    id: "glitch",
    title: "Glitch",
    tip: "made for this film",
    glsl: "vec4 transition(vec2 uv){\n  return vec4(0.);\n}",
  };
  const groups = ownWork(
    {
      transitions: [dissolve, glitch],
      anims: {
        in: [fade, { id: "rise", title: "Rise", cat: "Film", tip: "", apply: () => {} }],
        out: [],
        combo: [],
      },
      voices: {
        text: {
          in: [builtins.voices.text.in[0], { id: "stamp", title: "Stamp", len: 0.3 }],
          out: [],
        },
        shape: { in: [], out: [] },
      },
    },
    builtins,
    {
      shots: [
        { t: 0, anim: { in: { fx: "rise" } } },
        { t: 4.5, transition: { fx: "glitch" } },
        { t: 9, transition: { fx: "dissolve" }, anim: { out: { fx: "rise" } } },
        { t: 12, transition: { fx: "glitch" } },
      ],
      texts: [
        { kind: "text", from: 2, in: { fx: "stamp" } },
        { kind: "arrow", from: 3, in: { fx: "stamp" } }, // a shape's In names shape voices, not text ones
      ],
    },
  );
  assert.deepEqual(
    group(groups, "transitions").items.map((x) => [x.id, x.used]),
    [["glitch", [4.5, 12]]],
  );
  // an In used only in a shot's Out slot is not used: the slots are separate lists
  assert.deepEqual(
    group(groups, "animation").items.map((x) => [x.id, x.part, x.used]),
    [["rise", "In", [0]]],
  );
  assert.deepEqual(
    group(groups, "text").items.map((x) => [x.id, x.part, x.used]),
    [["stamp", "In", [2]]],
  );
});

test("the kinds come in CapCut's library order, then the 3D film's own, then what the studio can't name", () => {
  const groups = ownWork(
    {
      other: { zap: 1 },
      checks: { feet: () => "ok" },
      variants: [{ id: "chair", title: "chair", options: [], ranges: [] }],
      objects: ["room"],
      anims: { in: [{ id: "rise", title: "Rise" }], out: [], combo: [] },
      transitions: [{ id: "glitch", title: "Glitch" }],
      velocityEffects: [{ id: "smear" }],
      shapes: [{ id: "stamp", title: "Stamp" }],
      textEases: ["wobble"],
      sounds: [{ name: "sfx/door.wav" }],
    },
    builtins,
    none,
  );
  assert.deepEqual(
    groups.map((g) => g.title),
    [
      "Audio",
      "Text",
      "Stickers",
      "Effects",
      "Transitions",
      "Animation",
      "3D",
      "A/B choices",
      "Checks",
      "Other",
    ],
  );
});

test("a built-in the film hands back unchanged is not its own; one with a changed value is, and says so", () => {
  const groups = ownWork(
    {
      anims: { in: [{ ...fade }], out: [], combo: [] },
      transitions: [{ ...dissolve, glsl: "vec4 transition(vec2 uv){ return vec4(1.); }" }],
    },
    builtins,
    none,
  );
  assert.equal(
    group(groups, "animation"),
    undefined,
    "a copy of the studio's fade is still the studio's",
  );
  const [changed] = group(groups, "transitions").items;
  assert.equal(changed.id, "dissolve");
  assert.equal(changed.changes, true);
});

test("eases, speed-ramp effects and render checks the film adds sit with what they move", () => {
  const groups = ownWork(
    {
      eases: { linear: builtins.eases.linear, bounce: (x) => x * x },
      velocityEffects: ["flash", { id: "smear", title: "Smear" }],
      checks: { feet: (t) => `feet at ${t}` },
    },
    builtins,
    none,
  );
  assert.deepEqual(
    group(groups, "animation").items.map((x) => [x.id, x.part]),
    [["bounce", "Camera ease"]],
  );
  assert.deepEqual(
    group(groups, "effects").items.map((x) => [x.id, x.title, x.part]),
    [["smear", "Smear", "Speed ramp"]],
  );
  assert.deepEqual(
    group(groups, "checks").items.map((x) => x.id),
    ["feet"],
  );
});

test("every other field shows as name and value, sorted by name; code and long values open on demand", () => {
  const fields = fieldsOf({
    id: "glitch",
    title: "Glitch",
    tip: "shown above the fields",
    cat: "Film",
    zeta: true,
    len: 0.45678,
    ease: [0.2, 0.8, 0.3, 1],
    glsl: "line one\nline two\nline three",
    apply: function apply(cam) {
      return cam;
    },
    look: { blur: 2, tint: "#fff" },
    gone: undefined,
  });
  assert.deepEqual(
    fields.map((f) => f.key),
    ["apply", "ease", "glsl", "len", "look", "zeta"],
  );
  const by = Object.fromEntries(fields.map((f) => [f.key, f]));
  assert.equal(by.zeta.text, "yes");
  assert.equal(by.len.text, "0.457");
  assert.equal(by.ease.text, "0.2, 0.8, 0.3, 1");
  assert.equal(by.ease.code, undefined);
  assert.equal(by.glsl.text, "3 lines");
  assert.equal(by.glsl.code(), "line one\nline two\nline three");
  assert.equal(by.apply.text, "code, 3 lines");
  assert.match(by.apply.code(), /return cam/);
  assert.equal(by.look.text, "2 fields");
  assert.deepEqual(JSON.parse(by.look.code()), { blur: 2, tint: "#fff" });
});

test("what the film hands the studio under a name the studio doesn't know is listed under Other", () => {
  const draw = Object.assign(() => {}, {
    tools: {},
    describe: () => [],
    transitions: [],
    disposeTransitions: () => {},
    particles: { count: 4000 },
  });
  assert.deepEqual(otherKeys(draw), ["particles"]);
  const groups = ownWork({ other: { particles: draw.particles } }, builtins, none);
  const [item] = group(groups, "other").items;
  assert.equal(item.id, "particles");
  assert.equal(item.fields[0].text, "1 field");
});

test("a list of {id, title} the film hands over under a new name is a kind of its own, named after it", () => {
  const groups = ownWork(
    {
      other: {
        weatherFx: [
          { id: "rain", title: "Rain", tip: "drops on the lens", drops: 900 },
          { id: "fog", title: "Fog" },
        ],
        "tools.sparks": [{ id: "embers" }],
        "tools.composer": { passes: [] },
        scores: [1, 2, 3], // a list, but not of things with an id
      },
    },
    builtins,
    none,
  );
  assert.deepEqual(
    groups.map((g) => [g.id, g.title, g.items.map((x) => x.title)]),
    [
      ["own:tools.sparks", "Sparks", ["embers"]],
      ["own:weatherFx", "Weather fx", ["Rain", "Fog"]],
      ["other", "Other", ["scores", "tools.composer"]],
    ],
  );
  const rain = group(groups, "own:weatherFx").items[0];
  assert.equal(rain.tip, "drops on the lens");
  assert.deepEqual(
    rain.fields.map((f) => [f.key, f.text]),
    [["drops", "900"]],
  );
});

test("a field of its own on a shot, a text or any other row is listed by name, with where it is set and its values", () => {
  const groups = ownWork(
    {
      rows: [
        { kind: "Shot", t: 0, row: { t: 0, name: "wide" } },
        { kind: "Shot", t: 12.5, row: { t: 3, name: "close", pov: true, noHead: true } },
        { kind: "Shot", t: 30, row: { t: 9, pov: true } },
        { kind: "Text", t: 4, row: { kind: "text", text: "hi", from: 4, glow: 2 } },
        { kind: "Text", t: 8, row: { kind: "text", text: "yo", from: 8, glow: 0.5 } },
      ],
    },
    builtins,
    none,
  );
  const fields = group(groups, "fields");
  assert.equal(fields.title, "Custom fields");
  assert.deepEqual(
    fields.items.map((x) => [x.id, x.title, x.part, x.used]),
    [
      ["noHead", "noHead", "Shot", [12.5]],
      ["pov", "pov", "Shot", [12.5, 30]],
      ["glow", "glow", "Text", [4, 8]],
    ],
  );
  const by = Object.fromEntries(fields.items.map((x) => [x.title, x.fields]));
  assert.deepEqual(
    by.pov.map((f) => [f.key, f.text]),
    [["value", "yes"]],
  );
  assert.equal(by.glow[0].key, "values");
  assert.equal(by.glow[0].text, "2, 0.5");
});

test("a field of its own inside a slot the studio reads (a shot's anim, a text's in) is listed by its path", () => {
  const groups = ownWork(
    {
      rows: [
        { kind: "Shot", t: 2, row: { t: 0, anim: { in: { fx: "fade", len: 1, wobble: 3 } } } },
        { kind: "Shot", t: 6, row: { t: 4, anim: { in: { fx: "fade" }, beat: 2 } } },
        { kind: "Text", t: 4, row: { kind: "text", from: 4, in: { fx: "up", jitter: 0.2 } } },
      ],
    },
    {
      ...builtins,
      rowKeys: {
        Shot: ["t", "anim", "anim.in.fx", "anim.in.len"],
        Text: ["kind", "from", "in", "in.fx"],
      },
    },
    none,
  );
  assert.deepEqual(
    group(groups, "fields").items.map((x) => [x.title, x.part, x.used]),
    [
      ["anim.beat", "Shot", [6]],
      ["anim.in.wobble", "Shot", [2]],
      ["in.jitter", "Text", [4]],
    ],
  );
});

test("the film's own sounds show where they play, and the 3D it builds in code is listed by name", () => {
  const groups = ownWork(
    {
      sounds: [{ name: "sfx/unused.wav" }, { name: "sfx/door_slam.wav", title: "Door slam" }], // the playing one goes first
      objects: ["room", "CCTV camera (mc-assets pack/cctv_camera.json)"],
    },
    builtins,
    {
      ...none,
      sounds: [
        { name: "sfx/door_slam.wav", t: 31.5 },
        { name: "sfx/door_slam.wav", t: 8 },
        { name: "vault/hiss.wav", t: 0 },
      ],
    },
  );
  assert.deepEqual(
    group(groups, "audio").items.map((x) => [x.title, x.used]),
    [
      ["Door slam", [8, 31.5]],
      ["sfx/unused.wav", []],
    ],
  );
  assert.deepEqual(
    group(groups, "3d").items.map((x) => [x.title, x.part]),
    [
      ["room", "Object"],
      ["CCTV camera (mc-assets pack/cctv_camera.json)", "Object"],
    ],
  );
});

test("the film's own stickers, text eases, A/B choices and materials each get their kind", () => {
  const groups = ownWork(
    {
      shapes: [{ id: "stamp", title: "Stamp", tip: "a rubber stamp" }],
      textEases: ["linear", "wobble"],
      variants: [
        {
          id: "chair",
          title: "chair",
          options: [
            { id: "A", title: "slatted" },
            { id: "B", title: "office" },
          ],
          pick: { id: "B", title: "office" },
          ranges: [
            [35.5, 98.8],
            [12, 20],
          ],
        },
      ],
      materials: ["CRT glass (screen.ts)"],
    },
    { ...builtins, textEases: ["linear"] },
    {
      ...none,
      texts: [
        { kind: "stamp", from: 7 },
        { kind: "text", from: 9 },
      ],
    },
  );
  assert.deepEqual(
    group(groups, "stickers").items.map((x) => [x.title, x.part, x.used]),
    [["Stamp", "Sticker", [7]]],
  );
  assert.deepEqual(
    group(groups, "text").items.map((x) => [x.id, x.part]),
    [["wobble", "Ease"]],
  );
  const [choice] = group(groups, "choices").items;
  assert.deepEqual(choice.used, [12, 35.5]);
  assert.deepEqual(choice.fields, [
    { key: "options", text: "slatted, office" },
    { key: "shown", text: "office" },
  ]);
  assert.deepEqual(
    group(groups, "3d").items.map((x) => [x.title, x.part]),
    [["CRT glass (screen.ts)", "Material"]],
  );
});

test("what the film's tools carry under a name the studio doesn't know is listed too; the starter kit's own are not", () => {
  assert.deepEqual(
    otherKeys(
      { scene: {}, camera: {}, objects: [], clips: {}, composer: {}, anchor: () => {}, sparks: {} },
      "tools",
    ),
    ["sparks"],
  );
});

test("a picker marks an effect as the film's own by the same rule the Film tab lists it", () => {
  assert.equal(isOwnFx(fade, builtins.anims.in), false);
  assert.equal(isOwnFx({ ...fade }, builtins.anims.in), false);
  assert.equal(isOwnFx({ ...fade, len: 2 }, builtins.anims.in), true);
  assert.equal(isOwnFx({ id: "rise", title: "Rise" }, builtins.anims.in), true);
  assert.equal(isOwnEase("linear", builtins.eases, builtins.eases), false);
  assert.equal(isOwnEase("linear", builtins.eases), false);
  assert.equal(isOwnEase("bounce", builtins.eases, { bounce: (x) => x }), true);
  assert.equal(isOwnEase("linear", builtins.eases, { linear: (x) => x * x }), true);
  assert.equal(isOwnVelocity("flash", builtins.velocityEffects), false);
  assert.equal(isOwnVelocity("smear", builtins.velocityEffects), true);
  assert.equal(
    isOwnVelocity({ id: "flash", title: "White flash" }, builtins.velocityEffects),
    true,
  );
});

test("a picker gets a This film chip after Favorites only when the film made some of its effects", () => {
  const cats = ["All", "Favorites", "Basic", "Glitch"];
  assert.deepEqual(withFilmChip(cats, true), ["All", "Favorites", THIS_FILM, "Basic", "Glitch"]);
  assert.deepEqual(withFilmChip(cats, false), cats);
});

test("a value that can't be written out (a scene object pointing back at itself) still shows, by its size", () => {
  const node = { name: "rig", children: [] };
  node.children.push({ parent: node });
  const [f] = fieldsOf({ rig: node, big: 10n });
  assert.equal(f.key, "big");
  assert.equal(f.text, "10");
  const rig = fieldsOf({ rig: node })[0];
  assert.equal(rig.text, "2 fields");
  assert.match(rig.code(), /points back at itself/);
});

test("a huge value (an engine object the film hands over) is written out only when opened, and cut short", () => {
  let read = 0;
  const engine = {
    get passes() {
      read++;
      return Array.from({ length: 5000 }, (_, i) => ({ name: `pass ${i}`, enabled: true }));
    },
  };
  const [f] = fieldsOf({ engine });
  assert.equal(read, 0, "listing it costs nothing");
  const code = f.code();
  assert.ok(code.length < 20_100);
  assert.match(code, /first 20,000 of [\d,]+ characters/);
});

test("an effect pointing back at itself, or a check left empty, never breaks the tab", () => {
  const loop = { id: "fade", title: "Fade" };
  loop.self = loop;
  assert.equal(isOwnFx(loop, builtins.anims.in), true);
  const groups = ownWork({ checks: { gone: undefined, feet: () => [] } }, builtins, none);
  assert.deepEqual(
    group(groups, "checks").items.map((x) => [x.id, x.fields.length]),
    [
      ["gone", 0],
      ["feet", 1],
    ],
  );
});

test("a film that adds nothing of its own gives no groups", () => {
  assert.deepEqual(
    ownWork(
      {
        transitions: [dissolve],
        anims: builtins.anims,
        rows: [{ kind: "Shot", t: 0, row: { t: 0, name: "wide" } }],
      },
      builtins,
      none,
    ),
    [],
  );
});
