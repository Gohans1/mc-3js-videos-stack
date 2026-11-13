import { expect, test } from "bun:test";

import { ANIMS } from "../../packages/film-stage/src/animate";
import { TEXT_IN, TEXT_OUT } from "../../packages/film-stage/src/titles";
import { TRANSITIONS } from "../../packages/film-stage/src/transitions";
import { easeAbout, type Entry, presetEntries, rank, run, soundEntries } from "../find";

const e = (id: string, title: string, about = "", kind = "sfx", cat = ""): Entry => ({
  kind,
  id,
  cat,
  title,
  about,
});

test("rank puts the entry whose name says the query above one that only mentions it in passing", () => {
  const hits = rank(
    [
      e("door-creak", "Door creak", "old wooden hinge"),
      e("room-tone", "Room tone", "quiet room, a door far away"),
      e("glass", "Glass break", "shatter"),
    ],
    "creaky door",
  );
  expect(hits.map((h) => h.id)).toEqual(["door-creak", "room-tone"]);
});

test("rank reads camelCase ids and plurals as words", () => {
  const hits = rank([e("wordBuild", "Build up"), e("fade", "Fade in")], "words build");
  expect(hits[0]?.id).toBe("wordBuild");
});

test("rank keeps only the asked kinds", () => {
  const all = [e("whoosh", "Whoosh", "", "sfx"), e("whip", "Whip pan whoosh", "", "transition")];
  expect(rank(all, "whoosh", { kinds: ["transition"] }).map((h) => h.id)).toEqual(["whip"]);
});

test("soundEntries folds a family's takes into one line that names its first take and counts the rest", () => {
  const out = soundEntries([
    {
      name: "mc-chest-open-2",
      kind: "mc",
      category: "blocks",
      family: "mc-chest-open",
      variant: 2,
      title: "Chest open",
      seconds: 0.6,
    },
    {
      name: "mc-chest-open-1",
      kind: "mc",
      category: "blocks",
      family: "mc-chest-open",
      variant: 1,
      title: "Chest open",
      seconds: 0.5,
    },
    { name: "sfx-thud", kind: "sfx", category: "impacts", title: "Thud", seconds: 0.8 },
  ]);
  expect(out).toHaveLength(2);
  expect(out.find((x) => x.id === "mc-chest-open-1")).toMatchObject({
    kind: "mc",
    cat: "blocks",
    takes: 2,
  });
});

const vault: Entry[] = [
  { ...e("mc-mob-zombie-hurt-1", "Zombie · Hurt", "", "mc", "mobs"), src: "minecraft", takes: 2 },
  { ...e("ear-door-knock", "Door · knock", "a knuckle on wood", "sfx", "foley"), src: "earshot" },
  {
    ...e("dissolve", "Dissolve", "blend two shots", "transition", "Basic"),
    src: "film-stage/transitions.ts",
  },
];
// as jev.py exits without a key (its own words name the key file)
const noJev = () =>
  Promise.reject(new Error("Jev: no key: OPENCODE_API_KEY in ~/.secrets/opencode_zen.env"));

test("each hit names its kind, category and source", async () => {
  const out = await run(["door", "knock"], vault, noJev);
  expect(out).toContain("sfx/foley");
  expect(out).toContain("ear-door-knock");
  expect(out).toContain("[earshot]");
});

test("words that match nothing point to Jev with the kinds to pick from", async () => {
  const out = await run(["a", "sinking", "feeling"], vault, noJev);
  expect(out).toMatch(/--jev --kind/);
  expect(out).toContain("transition");
});

test("hits that miss a query word name the word and offer Jev", async () => {
  const out = await run(["zombie", "groan"], vault, noJev);
  expect(out).toContain("mc-mob-zombie-hurt-1");
  expect(out).toMatch(/groan/);
  expect(out).toMatch(/--jev --kind mc/);
});

test("an unknown kind is an error that lists the kinds there are", async () => {
  const out = run(["door", "--kind", "noise"], vault, noJev);
  await expect(out).rejects.toThrow(/unknown --kind noise.*sfx/i);
});

test("an unknown source is an error that lists the sources, never a silent empty search", async () => {
  await expect(run(["door", "--source", "nope"], vault, noJev)).rejects.toThrow(
    /unknown --source nope.*earshot.*minecraft/i,
  );
});

test("an option it does not know, or one missing its value, is an error rather than ignored", async () => {
  await expect(run(["door", "--bogus"], vault, noJev)).rejects.toThrow(/--bogus/);
  await expect(run(["door", "--kind"], vault, noJev)).rejects.toThrow(/--kind needs a value/);
  await expect(run(["door", "-n", "abc"], vault, noJev)).rejects.toThrow(/-n/);
  await expect(run(["door", "-n", "0"], vault, noJev)).rejects.toThrow(/-n/);
});

test("--kind or --source with no words lists a small set whole and a big one by category", async () => {
  const small = await run(["--source", "minecraft"], vault, noJev);
  expect(small).toContain("mc-mob-zombie-hurt-1");
  const many = Array.from({ length: 61 }, (_, i) => e(`hit-${i}`, "Hit", "", "sfx", "impacts"));
  const big = await run(["--kind", "sfx"], many, noJev);
  expect(big).toMatch(/61 entries by category.*\n {2}sfx\/impacts 61/);
  expect(big).toMatch(/bun run find --kind sfx\/impacts/);
});

test("--show gives one entry in full with a line to paste, and close ids for a wrong one", async () => {
  const out = await run(["--show", "dissolve"], vault, noJev);
  expect(out).toMatch(/"transition": \{"fx": "dissolve", "len": 0\.5\}/);
  expect(out).toMatch(/see it:/);
  // an id nothing has is a wrong word and nothing was shown: exit 2 on stderr, with the near ids
  const miss = run(["--show", "disolve"], vault, noJev);
  await expect(miss).rejects.toMatchObject({
    code: 2,
    message: expect.stringMatching(/Close: dissolve/),
  });
});

test("a word in a kind the --kind left out is pointed to, by its category", async () => {
  const out = await run(["zombie", "--kind", "sfx"], vault, noJev);
  expect(out).toMatch(
    /outside --kind sfx these words are in: mc\/mobs 1 \(bun run find zombie --kind mc\/mobs\)/,
  );
});

// The studio's groups: a category by its slug, a word of it, or a word of the Sound panel's heading for it
const shutter = { ...e("snap-1", "Snap", "", "sfx", "shutter"), src: "mixkit" };
const wipe = {
  ...e("wipe", "Wipe Right", "", "transition", "Wipe & Split"),
  src: "film-stage/transitions.ts",
};
const synthHit = { ...e("ear-hit", "Hit", "", "sfx", "impacts"), src: "earshot" };
const groups = [...vault, synthHit, shutter, wipe];

test("--kind <kind>/<category> keeps one of the studio's groups, by slug, word or heading", async () => {
  for (const k of ["transition/wipe-split", "transition/wipe", "transition/Wipe & Split"])
    expect(await run(["--kind", k], groups, noJev)).toContain("transition/Wipe & Split  wipe");
  const camera = await run(["--kind", "sfx/camera"], groups, noJev);
  expect(camera).toContain("snap-1");
  expect(camera).not.toContain("ear-hit");
});

test("a category asked as a kind, or one a kind lacks, says the --kind that has it", async () => {
  await expect(run(["--kind", "shutter"], groups, noJev)).rejects.toThrow(
    /shutter is a category, not a kind: --kind sfx\/shutter/,
  );
  await expect(run(["--kind", "sfx/zzz"], groups, noJev)).rejects.toThrow(
    /sfx has no category zzz\. Its categories: .*sfx\/shutter 1 \(Camera shutter\)/,
  );
});

test("--origin and --edition filter sounds as the Sound panel's Filter does", async () => {
  const real = await run(["--origin", "real", "--kind", "sfx"], groups, noJev);
  expect(real).toContain("snap-1");
  expect(real).not.toContain("ear-hit");
  expect(await run(["--edition", "vanilla"], groups, noJev)).toContain("mc-mob-zombie-hurt-1");
  await expect(run(["--origin", "studio"], groups, noJev)).rejects.toThrow(
    /--origin is real or synth/,
  );
});

test("a word matching nothing points to other words and the categories before Jev", async () => {
  const out = await run(["xyzzy", "--kind", "sfx"], groups, noJev);
  expect(out.indexOf("browse instead: bun run find --kind sfx lists its categories")).toBeLessThan(
    out.indexOf("--jev"),
  );
});

const boom = { ...e("ear-boom", "Explosion · near", "", "sfx", "impacts"), src: "earshot" };

test("a misspelt word gets the vault's closest word", async () => {
  const out = await run(["explosio"], [...vault, boom], noJev);
  expect(out).toMatch(/did you mean: explosion/);
});

test("the word a hit lacks is quoted as typed, not as its stem", async () => {
  const out = await run(["tense", "zombie"], vault, noJev);
  expect(out).toMatch(/lacks: tense\b/);
});

test("a query in another language goes to Jev instead of matching letter fragments", async () => {
  const out = await run(["cửa", "đóng", "sầm"], vault, noJev);
  expect(out).not.toContain("ear-door-knock");
  expect(out).toMatch(/English/);
  expect(out).toMatch(/--jev --kind/);
});

test("a dead end with --kind reuses that kind and says how to make the missing thing", async () => {
  const sfx = await run(["xyzzy", "--kind", "sfx"], vault, noJev);
  expect(sfx).toMatch(/--jev --kind sfx "xyzzy"/);
  expect(sfx).toMatch(/real-sound/);
  const tr = await run(["xyzzy", "--kind", "transition"], vault, noJev);
  expect(tr).toMatch(/src\/scene\.ts/);
  expect(tr).toContain("packages/film-stage/src/transitions.ts");
});

test("a word for what a kind does reaches its entries", async () => {
  const sat = {
    ...e("saturation", "Saturation", "", "adjust", ""),
    src: "film-stage/grade-color.ts",
  };
  const out = await run(["grade"], [...vault, sat], noJev);
  expect(out).toContain("saturation");
});

const walk = {
  ...e("mixamo/Walking_1", "Walking", "walks forward", "mocap", "stand"),
  src: "mixamo",
};

test("mocap clips are found like any entry and say where they go", async () => {
  const out = await run(["walking"], [...vault, walk], noJev);
  expect(out).toContain("mixamo/Walking_1");
  expect(out).toMatch(/steve\.json moves\[\]/);
});

test("mocap by meaning goes to the catalogue's own Jev rerank", async () => {
  const clips = (args: string[]) => Promise.resolve(`ranked: ${args.join(" ")}`);
  const out = await run(["--jev", "--kind", "mocap", "he kneels"], [...vault, walk], noJev, clips);
  expect(out).toContain("ranked: --jev he kneels");
  expect(out).toMatch(/steve\.json moves\[\]/);
});

test("a sound whose licence asks for credit says so on its row", async () => {
  const [bed] = soundEntries([
    { name: "bgm-x", kind: "bgm", category: "chill", license: "CC BY 4.0", title: "X" },
  ]);
  const out = await run(["x"], [bed as Entry], noJev);
  expect(out).toMatch(/credit: CC BY 4\.0/);
});

test("a split Jev vote is flagged as unsure", async () => {
  const jev = (_: string, pool: Entry[]) =>
    Promise.resolve(pool.map((x) => [0.2, x] as [number, Entry]));
  const out = await run(["--jev", "--kind", "sound", "someone at the door"], vault, jev);
  expect(out).toMatch(/unsure/);
});

test("Jev failing says why and still answers with the word match", async () => {
  const out = await run(["--jev", "--kind", "sfx", "door"], vault, noJev);
  expect(out).toMatch(
    /Jev: no key: OPENCODE_API_KEY in ~\/\.secrets\/opencode_zen\.env\. Word matches below/,
  );
  expect(out).toContain("ear-door-knock");
  // one that never reached jev.py says what it needs instead
  const noPython = () => Promise.reject(new Error("spawn python ENOENT"));
  expect(await run(["--jev", "--kind", "sfx", "door"], vault, noPython)).toMatch(
    /Jev did not run: spawn python ENOENT\. Word matches below\. Jev needs python on PATH/,
  );
});

test("Jev's order replaces the word order when it answers", async () => {
  const jev = (_: string, pool: Entry[]) =>
    Promise.resolve(pool.map((x, i) => [i === pool.length - 1 ? 0.9 : 0.05, x] as [number, Entry]));
  const out = await run(["--jev", "--kind", "sound", "someone at the door"], vault, jev);
  expect(out.indexOf("ear-door-knock")).toBeLessThan(out.indexOf("mc-mob-zombie-hurt-1"));
});

test("presetEntries lists every transition, camera move and text voice the studio offers", () => {
  const ids = (kind: string) =>
    new Set(
      presetEntries()
        .filter((x) => x.kind === kind)
        .map((x) => x.id),
    );
  expect(ids("transition")).toEqual(new Set(TRANSITIONS.map((t) => t.id)));
  expect(ids("anim-in")).toEqual(new Set(ANIMS.in.map((t) => t.id)));
  expect(ids("text-in")).toEqual(new Set(TEXT_IN.map((t) => t.id)));
  expect(ids("text-out")).toEqual(new Set(TEXT_OUT.map((t) => t.id)));
});

test("every preset says what it does: Jev reads only the line, never the code", () => {
  expect(
    presetEntries()
      .filter((x) => !x.about.trim())
      .map((x) => `${x.kind} ${x.id}`),
  ).toEqual([]);
});

test("an ease is described by its own curve", () => {
  expect(easeAbout((t) => t)).toMatch(/constant speed/);
  expect(easeAbout((t) => 1 - (1 - t) ** 8)).toMatch(/snap|instant/);
  expect(easeAbout((t) => t ** 3)).toMatch(/build|launch/);
  expect(
    easeAbout((t) => (t < 0.3 ? -0.1 * Math.sin((Math.PI * t) / 0.3) : (t - 0.3) / 0.7)),
  ).toMatch(/wind-up/);
});

test("when Jev doubts every hit fits, find says it is not in the vault", async () => {
  const jev = (_: string, pool: Entry[]) =>
    Promise.resolve(pool.map((x, i): [number, Entry, number] => [i ? 0.1 : 0.8, x, 0.05]));
  const out = await run(["--jev", "--kind", "sound", "a dog barking"], vault, jev);
  expect(out).toMatch(/NOT IN THE VAULT/);
  expect(out).toContain("fits 0.05");
});

test("a hit Jev believes goes above the vote's favourite it doubts", async () => {
  const jev = (_: string, pool: Entry[]) =>
    Promise.resolve(
      pool.map((x): [number, Entry, number] =>
        x.id === "ear-door-knock" ? [0.2, x, 0.9] : [0.4, x, 0.1],
      ),
    );
  const out = await run(["--jev", "--kind", "sound", "someone knocks"], vault, jev);
  const lines = out.split("\n").filter((l) => /fits \d/.test(l));
  expect(lines[0]).toContain("ear-door-knock");
  expect(out).toMatch(/FOUND: ear-door-knock/);
});

test("a dead end on words never claims Jev was tried", async () => {
  const out = await run(["xyzzy"], vault, noJev);
  expect(out).not.toMatch(/Jev included/);
  expect(out).toMatch(/--jev --kind/);
});

test("the by-meaning hint names the kind most hits are, not just the top one", async () => {
  const floor = (id: string) => ({ ...e(id, `${id} floor`, "", "mocap", "stand"), src: "mixamo" });
  const pool = [
    { ...e("mc-search", "Search", "", "mc", "blocks"), src: "minecraft" },
    floor("a"),
    floor("b"),
    floor("c"),
  ];
  const out = await run(["search", "the", "floor"], pool, noJev);
  expect(out).toMatch(/--jev --kind mocap "search the floor"/);
});

test("a hit with every query word ranks above one that only has a rare word, and partial hits say how many they have", async () => {
  const pool = [
    e("raygun-empty", "Raygun empty", "empty click"),
    e("door-slam", "Door slam", "a hallway door"),
    ...Array.from({ length: 20 }, (_, i) => e(`door-${i}`, "Door", "slam")),
  ];
  const out = await run(["door", "slam", "empty", "hallway"], pool, noJev);
  expect(out.indexOf("door-slam ")).toBeLessThan(out.indexOf("raygun-empty"));
  expect(out).toMatch(/1\/4 words.*raygun-empty/);
});

const sitDown = {
  ...e("mixamo/Sit_Down", "Sit down", "", "mocap", "stand>sitFloor"),
  src: "mixamo",
  data: { seq: ["stand", "sitFloor"] },
};

test("posture filters go to the mocap catalogue with the words", async () => {
  let got: string[] = [];
  const clips = (args: string[]) => ((got = args), Promise.resolve("catalogue rows"));
  const out = await run(
    ["sit", "--from", "stand", "--to", "sitFloor", "--still"],
    [...vault, sitDown],
    noJev,
    clips,
  );
  expect(out).toContain("catalogue rows");
  expect(got).toEqual(
    expect.arrayContaining(["sit", "--from", "stand", "--to", "sitFloor", "--still"]),
  );
});

test("a posture the catalogue lacks, or a posture filter on another kind, is an error", async () => {
  await expect(run(["--from", "fly"], [...vault, sitDown], noJev)).rejects.toThrow(
    /postures:.*sitFloor/,
  );
  await expect(
    run(["sit", "--from", "stand", "--kind", "sfx"], [...vault, sitDown], noJev),
  ).rejects.toThrow(/mocap/);
});

test("a one-frame clip ranks after clips that move", async () => {
  const still = {
    ...e("mixamo/Walking_still", "Walking walking", "", "mocap", "stand"),
    src: "mixamo",
    note: "one frame: a still pose",
    secs: 0.03,
  };
  const out = await run(["walking"], [still, walk], noJev);
  expect(out.indexOf("mixamo/Walking_1")).toBeLessThan(out.indexOf("mixamo/Walking_still"));
});

test("--show on any take of a family names all its takes", async () => {
  const takes = soundEntries(
    [
      {
        name: "mc-door-1",
        kind: "mc",
        category: "blocks",
        family: "mc-door",
        variant: 1,
        title: "Door",
      },
      {
        name: "mc-door-2",
        kind: "mc",
        category: "blocks",
        family: "mc-door",
        variant: 2,
        title: "Door",
      },
    ],
    false,
  );
  const out = await run(["--show", "mc-door-2"], takes, noJev);
  expect(out).toMatch(/takes: mc-door-1, mc-door-2/);
  expect(out).toContain('"name": "mc-door-2"');
});

test("a big kind listed alone shows a few ids per category to start from", async () => {
  const many = Array.from({ length: 61 }, (_, i) => e(`hit-${i}`, "Hit", "", "sfx", "impacts"));
  expect(await run(["--kind", "sfx"], many, noJev)).toMatch(
    /sfx\/impacts 61 {2}\(hit-0, hit-1, hit-2/,
  );
});

test("--dur and --energy take a min-max range, and --still with --moves contradict", async () => {
  const pool = [...vault, sitDown];
  for (const bad of ["9", "1-", "abc", "6-1", "1-2-3"])
    await expect(run(["--dur", bad], pool, noJev)).rejects.toThrow(/--dur takes min-max/);
  await expect(run(["--energy", "40"], pool, noJev)).rejects.toThrow(/--energy takes min-max/);
  await expect(run(["sit", "--still", "--moves"], pool, noJev)).rejects.toThrow(/--still.*--moves/);
});

test("a posture typed short names the postures it could mean", async () => {
  await expect(run(["--has", "sit"], [...vault, sitDown], noJev)).rejects.toThrow(
    /posture sit \(close: sitFloor\)/,
  );
});

test("an option given twice is an error, never a silent pick of one", async () => {
  await expect(run(["door", "--kind", "mc", "--kind", "sfx"], vault, noJev)).rejects.toThrow(
    /--kind given twice/,
  );
});

test("--source names a whole source or its folder, never part of a name", async () => {
  await expect(run(["--source", "mine"], vault, noJev)).rejects.toThrow(/Unknown --source mine/);
  expect(await run(["--source", "film-stage"], vault, noJev)).toContain("dissolve");
});

test("-n caps a listing too", async () => {
  const two = [...vault, { ...e("mc-chest", "Chest", "", "mc", "blocks"), src: "minecraft" }];
  const out = await run(["--source", "minecraft", "-n", "1"], two, noJev);
  expect(out).toMatch(/first 1 of 2/);
  expect(out.match(/^mc\//gm)).toHaveLength(1);
});

test("--show of a kind name or a bare clip name points to the right thing", async () => {
  expect(await run(["--show", "mc"], vault, noJev)).toMatch(/mc is a kind: bun run find --kind mc/);
  expect(await run(["--show", "Walking_1"], [...vault, walk], noJev)).toMatch(
    /^mocap\/stand {2}mixamo\/Walking_1/,
  );
});

// an AI cannot hear the shortlist: find hands it the one earshot call that ranks those files by the words it searched
test("a list of sounds ends with the earshot rank that hears them, paths ready", async () => {
  const sound = (id: string, file: string): Entry => ({
    ...e(id, "Door · slam", "", "sfx", "foley"),
    data: { file },
  });
  const out = await run(
    ["door", "slam"],
    [
      sound("door-a", "vault/sound/sfx/foley/door-a.wav"),
      sound("door-b", "vault/sound/sfx/foley/door-b.wav"),
    ],
    noJev,
  );
  expect(out).toMatch(
    /earshot rank "door slam" \S*vault\/sound\/sfx\/foley\/door-a\.wav \S*vault\/sound\/sfx\/foley\/door-b\.wav --top 3/,
  );
  const one = await run(
    ["door", "slam"],
    [sound("door-a", "vault/sound/sfx/foley/door-a.wav")],
    noJev,
  );
  expect(one).not.toMatch(/earshot rank/);
});

test("an editor's word reaches what the vault names otherwise: a synonym, a joined id, a dying form", () => {
  const pool = [
    e("dissolve", "Dissolve", "blend two shots", "transition", "Basic"),
    e("mc-mob-enderdragon-growl", "Enderdragon · Growl", "", "mc", "mobs"),
    e("mc-mob-cow-step", "Cow · Step", "", "mc", "mobs"),
    e("mc-mob-creeper-death", "Creeper · Death", "Creeper dies", "mc", "mobs"),
  ];
  expect(rank(pool, "crossfade")[0]?.id).toBe("dissolve");
  expect(rank(pool, "ender dragon")[0]).toMatchObject({
    id: "mc-mob-enderdragon-growl",
    matched: 2,
    of: 2,
  });
  expect(rank(pool, "die").map((h) => h.id)).toEqual(["mc-mob-creeper-death"]);
  expect(rank(pool, "a sound that dies")[0]?.id).toBe("mc-mob-creeper-death");
});

test("a kind said loosely is read as the kind, and the first line says how", async () => {
  const pool = [
    e("bgm-calm", "Calm", "", "bgm", "chill"),
    e("whip", "Whip", "", "transition", "Basic"),
    e("ear-whoosh", "Whoosh", "", "sfx", "transitions"),
  ];
  const music = await run(["--kind", "music"], pool, noJev);
  expect(music.split("\n")[0]).toMatch(/--kind music read as bgm/);
  expect(music).toMatch(/bgm-calm/);
  const plural = await run(["--kind", "transitions"], pool, noJev);
  expect(plural.split("\n")[0]).toMatch(
    /read as transition .*the category is --kind sfx\/transitions/,
  );
  expect(plural).toMatch(/whip/);
  expect(plural).not.toMatch(/ear-whoosh/);
});

test("a filter that leaves no entry of the kind is named as the cause, not the kind", async () => {
  const pool = [
    { ...e("bgm-calm", "Calm", "", "bgm", "chill"), src: "pixabay" },
    { ...e("ear-hit", "Hit", "", "sfx", "impacts"), src: "earshot" },
    { ...e("mc-hit", "Hit", "", "mc", "combat"), src: "minecraft" },
  ];
  const synth = run(["--kind", "bgm", "--origin", "synth"], pool, noJev);
  await expect(synth).rejects.toThrow(/--origin synth keeps sfx 1, none of it --kind bgm/);
  await expect(synth).rejects.not.toThrow(/Unknown --kind/);
  await expect(
    run(["hit", "--origin", "real", "--edition", "vanilla"], pool, noJev),
  ).rejects.toThrow(/together they keep nothing/);
});

test("a category too long to read lists its first entries and the words they are named by, to search inside", async () => {
  const mobs = Array.from({ length: 70 }, (_, i) =>
    e(
      `mc-mob-${i % 2 ? "zombie" : "wolf"}-${i}`,
      `${i % 2 ? "Zombie" : "Wolf"} · Say`,
      "",
      "mc",
      "mobs",
    ),
  );
  const out = await run(["--kind", "mc/mobs"], mobs, noJev);
  expect(out).toMatch(/^first 40 of 70:/m);
  expect(out).toMatch(/named by: say 70, wolf 35, zombie 35/);
  expect(out).toMatch(/search inside: bun run find <word> --kind mc\/mobs/);
  expect(out).not.toMatch(/one category in full: bun run find --kind mc\/mobs/);
});

test("the shapes text.json draws are found by their names", () => {
  const hits = rank(presetEntries(), "underline");
  expect(hits[0]).toMatchObject({ kind: "shape", id: "underline" });
});

test("a Minecraft sound line says what the game's subtitles call it", async () => {
  const door = {
    ...e(
      "mc-door-toggle",
      "Door · Toggle",
      "Minecraft 26.3 blocks — Door creaks; door toggle",
      "mc",
      "blocks",
    ),
    data: { heard: ["Door creaks"] },
  };
  expect(await run(["creaky", "door"], [door], noJev)).toMatch(
    /Door · Toggle — heard: Door creaks/,
  );
});

test("a category asked of a kind that has none says so, never a crash", async () => {
  const pool = [e("inter", "Inter", "clean sans", "font"), e("mono", "Plex Mono", "code", "font")];
  await expect(run(["--kind", "font/serif"], pool, noJev)).rejects.toThrow(
    /font has no categories: bun run find --kind font lists all 2; .*bun run find serif --kind font/,
  );
});

test("a name that is also a category is the category, not another kind's alias", async () => {
  const pool = [
    e("vignette", "Vignette", "", "adjust", "Effects"),
    e("ear-hit", "Hit", "", "sfx", "impacts"),
  ];
  await expect(run(["--kind", "effects"], pool, noJev)).rejects.toThrow(
    /effects is a category, not a kind: --kind adjust\/effects/,
  );
});

test("words a --source filter hides are named with the sources that have them", async () => {
  const pool = [
    { ...e("mc-zombie-say", "Zombie · Say", "", "mc", "mobs"), src: "minecraft" },
    { ...e("mc-cave-drip", "Cave · Drip", "", "mc", "ambience"), src: "alexs-caves" },
  ];
  const out = await run(["zombie", "--kind", "mc", "--source", "alexs-caves"], pool, noJev);
  expect(out).toMatch(
    /these words are in --kind mc, but not with --source alexs-caves: --source minecraft 1/,
  );
  expect(out).toMatch(/no entry of --kind mc with --source alexs-caves has these words/);
});

test("--dur keeps sounds and clips whose length is in the range, whatever the kind", async () => {
  const pool = [
    { ...e("hit-short", "Hit short", "", "sfx", "impacts"), secs: 0.4 },
    { ...e("hit-long", "Hit long", "", "sfx", "impacts"), secs: 3 },
    e("hit-fx", "Hit flash", "", "transition", "Basic"),
  ];
  const out = await run(["hit", "--dur", "0-1"], pool, noJev);
  expect(out).toMatch(/hit-short/);
  expect(out).not.toMatch(/hit-long|hit-fx/);
  await expect(run(["hit", "--dur", "2-1"], pool, noJev)).rejects.toThrow(/low first/);
});

test("--license sorts sounds by what an upload must do: credit for CC BY, claim for Content ID, free otherwise", async () => {
  const sound = (id: string, data: Record<string, unknown>): Entry => ({
    ...e(id, "Rain", "", "sfx", "foley"),
    data,
  });
  const pool = [
    sound("rain-cc0", { license: "CC0 1.0" }),
    sound("rain-ccby", { license: "CC BY 4.0" }),
    sound("rain-pixabay", { license: "Pixabay Content License", contentId: true }),
  ];
  const ids = async (l: string) =>
    (await run(["rain", "--license", l], pool, noJev)).match(/rain-\w+/g) ?? [];
  expect(await ids("free")).toEqual(["rain-cc0"]);
  expect(await ids("credit")).toEqual(["rain-ccby"]);
  expect(await ids("claim")).toEqual(["rain-pixabay"]);
  await expect(run(["--license", "nope"], pool, noJev)).rejects.toThrow(
    /--license is free, credit or claim \(sounds\): free 1 .*credit 1 .*claim 1/,
  );
});

test("under --kind, a word that only names the kind matches nothing, so a mood ask gets the mood advice", async () => {
  const pool = [e("bgm-drive", "Drive", "synthwave", "bgm", "electronic")];
  const out = await run(["horror", "music", "--kind", "bgm"], pool, noJev);
  expect(out).not.toMatch(/bgm-drive/);
  expect(out).toMatch(/earshot rank "<the mood>"[\s\S]*last, by meaning/);
});

test("a plural ending in -ies finds its singular", () => {
  expect(rank([e("mc-zombie-say", "Zombie · Say", "", "mc", "mobs")], "zombies")[0]?.id).toBe(
    "mc-zombie-say",
  );
});

test("a category cut short is read as the one it starts", async () => {
  const pool = [
    e("ding", "Ding", "", "sfx", "notifications"),
    e("boom", "Boom", "", "sfx", "impacts"),
  ];
  const out = await run(["--kind", "sfx/noti"], pool, noJev);
  expect(out.split("\n")[0]).toMatch(/--kind sfx\/noti read as sfx\/notifications/);
  expect(out).toMatch(/ding/);
  expect(out).not.toMatch(/boom/);
});

test("a mocap mood no checked clip carries lists the moods the clips do carry", async () => {
  const clip = {
    ...e("mixamo/Shiver", "Shiver", "", "mocap", "stand"),
    data: { mood: ["scared"] },
  };
  await expect(run(["--mood", "scaredd"], [clip], noJev)).rejects.toThrow(
    /no checked clip has --mood scaredd\..*scared 1/,
  );
});
