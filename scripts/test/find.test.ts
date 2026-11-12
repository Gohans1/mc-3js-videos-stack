import { expect, test } from "bun:test";

import { ANIMS } from "../../packages/film-stage/src/animate";
import { TEXT_IN, TEXT_OUT } from "../../packages/film-stage/src/titles";
import { TRANSITIONS } from "../../packages/film-stage/src/transitions";
import { type Entry, presetEntries, rank, run, soundEntries } from "../find";

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
const noJev = () => Promise.reject(new Error("no key"));

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
  expect(big).toMatch(/bun run find <words> --kind sfx/);
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

test("a word in a kind the --kind left out is pointed to", async () => {
  const out = await run(["zombie", "--kind", "sfx"], vault, noJev);
  expect(out).toMatch(/other kinds have these words: mc 1/);
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
  expect(out).toMatch(/Jev failed: no key/);
  expect(out).toContain("ear-door-knock");
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
    /sfx\/impacts 61 \(hit-0, hit-1, hit-2/,
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
