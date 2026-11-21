import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ANIMS } from "../../packages/film-stage/src/animate";
import { TEXT_IN, TEXT_OUT } from "../../packages/film-stage/src/titles";
import { TRANSITIONS } from "../../packages/film-stage/src/transitions";
import { favoriteLists } from "../../packages/live-studio/src/favorites.mjs";
import { openSound } from "../../packages/live-studio/src/sound.mjs";
import {
  allEntries,
  easeAbout,
  type Entry,
  markStarred,
  mocapEntries,
  presetEntries,
  rank,
  run as findRun,
  soundEntries,
  vaultSounds,
} from "../find";
import { ROOT } from "../vault.mjs";

// the creator's real stars (favorites/) never reach a test: an empty folder unless a test gives its own
const noStars = favoriteLists(join(tmpdir(), "find-test-no-favorites"));
const run = (...[argv, given, judge, clips, favs]: Parameters<typeof findRun>) =>
  findRun(argv, given, judge, clips, favs ?? noStars);

const pastedArgs = (command: string, tool: "earshot" | "bun" = "earshot") => {
  const dir = mkdtempSync(join(tmpdir(), "find-native-argv-"));
  try {
    const echo = join(dir, "echo.ts");
    writeFileSync(echo, "console.log(JSON.stringify(process.argv.slice(2)));\n");
    const windows = process.platform === "win32";
    const literal = (value: string) =>
      windows
        ? `'${value.replace(/['\u2018\u2019]/g, "$&$&")}'`
        : `'${value.replaceAll("'", "'\\''")}'`;
    const prefix = `${windows ? "& " : ""}${literal(process.execPath)} ${literal(echo)}`;
    const native = command.replace(new RegExp(`^${tool}\\b`), prefix);
    const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); ${native}`;
    const result = windows
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(script, "utf16le").toString("base64"),
          ],
          { encoding: "utf8", timeout: 25000 },
        )
      : spawnSync("sh", ["-c", native], { encoding: "utf8", timeout: 25000 });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

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
  expect(out).toContain("[earshot, made in code]");
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
    /unknown --source nope[\s\S]*sfx: earshot 1[\s\S]*mc: minecraft 1/i,
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

test("--show of a music track says how to make music, not a sound effect", async () => {
  const track = { ...e("bgm-calm", "Calm", "", "bgm", "chill"), src: "cinetic" };
  const out = await run(["--show", "bgm-calm"], [track], noJev);
  expect(out).toMatch(/make your own: music: the real-sound skill/);
  expect(out).not.toMatch(/sfx:get/);
});

test("--show of an imported page exposes its files, controls and licence without inventing a timeline lane", async () => {
  const folder = mkdtempSync(join(tmpdir(), "find-imported-page-"));
  const file = join(folder, "files/snow.html"),
    preview = join(folder, "preview.mp4"),
    settings = join(folder, "saved.json");
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "<style>:root { --amount: 1 }</style>");
    writeFileSync(
      settings,
      JSON.stringify({
        clip: { attrs: { "data-props": '[{"name":"Amount","type":"var","var":"--amount"}]' } },
      }),
    );
    const output = await run(
      ["--show", "snow"],
      [
        {
          ...e("snow", "Snow", "Sparse falling flakes", "asset", "effect"),
          src: "openfilm",
          data: {
            file,
            preview,
            format: "openfilm-page",
            license: "CC0 1.0",
            url: "https://example.test/library/LICENSE.md",
          },
        },
      ],
      noJev,
    );
    expect(output).toContain(`file: ${file}`);
    expect(output).toContain(`see it: ${preview}`);
    expect(output).toContain(`settings: ${settings}`);
    expect(output).toContain("format: openfilm-page");
    expect(output).toContain("licence: CC0 1.0  https://example.test/library/LICENSE.md");
    expect(output).toContain("src/scene.ts");
    expect(output).toContain("no native timeline lane");
    expect(output).not.toContain("undefined");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("--show separates an explicit licence document from the audio download URL", async () => {
  const output = await run(
    ["--show", "farewell"],
    [
      {
        ...e("farewell", "Farewell", "", "bgm", "sad"),
        data: {
          license: "CC0 1.0",
          licenseUrl: "https://example.test/library/LICENSE.md",
          url: "https://example.test/music.mp3",
        },
      },
    ],
    noJev,
  );
  expect(output).toContain("licence: CC0 1.0  https://example.test/library/LICENSE.md");
  expect(output).toContain("source: https://example.test/music.mp3");
});

test("--show discloses unknown audio provenance even when it belongs to the Real / Studio grouping", async () => {
  const output = await run(
    ["--show", "wind"],
    [{ ...e("wind", "Wind"), data: { origin: "unknown" } }],
    noJev,
  );
  expect(output).toContain("provenance: unknown");
  expect(output).toContain("not verified recording provenance");
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
  const studio = await run(["--origin", "studio", "--kind", "sfx"], groups, noJev);
  expect(studio.split("\n")[0]).toMatch(/--origin studio read as real/);
  expect(studio).toContain("snap-1");
  await expect(run(["--origin", "nope"], groups, noJev)).rejects.toThrow(
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
  expect(sfx).toMatch(/--jev --kind sfx ['"]?xyzzy['"]?/);
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

test("every preset's source is the file that writes it, so an agent copying one opens the right file", () => {
  const read = new Map<string, string>();
  const textOf = (p: string) => {
    if (!read.has(p)) read.set(p, readFileSync(p, "utf8"));
    return read.get(p)!;
  };
  const away = presetEntries().filter((x) => {
    if (!x.src) return false;
    const [pkg, file] = x.src.split("/");
    const path = join(import.meta.dir, `../../packages/${pkg}/src/${file}`);
    let src = textOf(path);
    if (file === "handheld.ts")
      src += "\n" + textOf(join(import.meta.dir, `../../packages/${pkg}/data/shakify.json`));
    return !new RegExp(
      `["']?${x.id}["']?\\s*[:,}]|id: ["']${x.id}["']|export (?:async )?(?:function|const) ${x.id}\\b`,
    ).test(src);
  });
  expect(away.map((x) => `${x.kind} ${x.id} in ${x.src}`)).toEqual([]);
});

test("a dead end of a kind with its own make line says that line", async () => {
  const font = { ...e("inter", "Inter", "", "font", ""), src: "film-stage/titles-catalog.ts" };
  const out = await run(["zzqx", "--kind", "font"], [font], noJev);
  expect(out).toMatch(/in fonts of makeTitles' 4th argument in src\/scene\.ts/);
  expect(out).not.toMatch(/the film's own, in src\/scene\.ts/);
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
  expect(out).toMatch(/--jev --kind mocap (['"])search the floor\1/);
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

test("a mocap category beside body filters is the postures it starts and ends in", async () => {
  let got: string[] = [];
  const clips = (args: string[]) => ((got = args), Promise.resolve("catalogue rows"));
  await run(["--kind", "mocap/stand-sit-floor", "--still"], [...vault, sitDown], noJev, clips);
  expect(got).toEqual(expect.arrayContaining(["--from", "stand", "--to", "sitFloor", "--still"]));
  // by meaning in a category: the catalogue's own Jev, which reads what was checked by eye
  await run(
    ["--jev", "he sits", "--kind", "mocap/stand-sit-floor"],
    [...vault, sitDown],
    noJev,
    clips,
  );
  expect(got).toEqual(
    expect.arrayContaining(["--jev", "he sits", "--from", "stand", "--to", "sitFloor"]),
  );
  await expect(
    run(
      ["--kind", "mocap/stand-sit-floor", "--from", "sitFloor"],
      [...vault, sitDown],
      noJev,
      clips,
    ),
  ).rejects.toThrow(/mocap\/stand-sit-floor starts in stand/);
});

test("a body filter with a source that has no clips is an error naming the clip sources", async () => {
  await expect(
    run(["--from", "stand", "--source", "earshot"], [...vault, sitDown], noJev),
  ).rejects.toThrow(/clips come from mixamo/);
});

test("body filters take mocap by any name it goes by, and a posture said as a verb beside a category", async () => {
  let got: string[] = [];
  const clips = (args: string[]) => ((got = args), Promise.resolve("catalogue rows"));
  await run(["--kind", "motion", "--still"], [...vault, sitDown], noJev, clips);
  expect(got).toContain("--still");
  await run(
    ["--kind", "mocap/stand-sit-floor", "--from", "standing"],
    [...vault, sitDown],
    noJev,
    clips,
  );
  expect(got).toEqual(expect.arrayContaining(["--from", "stand", "--to", "sitFloor"]));
});

test("--jev over a shortened timing category votes over its entries", async () => {
  const ease = {
    ...e("glide", "Glide Out", "eases into the shot", "transition-ease", "Ease"),
    src: "film-stage/transitions.ts",
  };
  let pool: Entry[] = [];
  const judge = (_: string, p: Entry[]) => (
    (pool = p),
    Promise.resolve([[0.9, ease]] as [number, Entry][])
  );
  await run(["--jev", "a slow arrival", "--kind", "transition/eas"], [...vault, ease], judge);
  expect(pool.map((x) => x.id)).toEqual(["glide"]);
});

test("--jev over a posture category beside another kind says what it refuses", async () => {
  const clips = () => Promise.resolve("catalogue rows");
  await expect(
    run(["--jev", "x", "--kind", "mocap/stand-sit-floor,sfx"], [...vault, sitDown], noJev, clips),
  ).rejects.toThrow(
    /^--jev over mocap\/stand-sit-floor filters mocap clips by the body; ask the other kinds in a call of their own/,
  );
});

test("--jev with no words is an error for every kind, not a silent list", async () => {
  await expect(run(["--jev", "--kind", "transition"], vault, noJev)).rejects.toThrow(
    /--jev needs the scene in words/,
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
    /sfx\/impacts 61( "[^"]*")? {2}\(hit-0, hit-1, hit-2/,
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
    /earshot rank (['"])door slam\1 \S*vault\/sound\/sfx\/foley\/door-a\.wav \S*vault\/sound\/sfx\/foley\/door-b\.wav --top 3/,
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

test("a hit with the word its neighbour joins is not said to lack it", async () => {
  const pool = [e("mc-mob-enderdragon-end", "Enderdragon · End", "Dragon dies", "mc", "mobs")];
  expect(await run(["ender", "dragon"], pool, noJev)).not.toMatch(/lacks/);
});

test("in, on and from tell two directions apart, and a doubled consonant before -ing is one word", () => {
  const titles = [
    e("fade-out", "Fade out", "Fades away, no movement", "text-out", "Clean"),
    e("fade-in", "Fade in", "Fades up from nothing, no movement", "text-in", "Clean"),
  ];
  expect(rank(titles, "fade in")[0]?.id).toBe("fade-in");
  expect(rank([e("sit", "Sit down"), e("hit", "Hit")], "sitting")[0]?.id).toBe("sit");
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

test("a file's extension in its source title is not a word it is named by", async () => {
  const takes = Array.from({ length: 50 }, (_, i) =>
    e(`take-${i}`, i % 2 ? `Door creak ${i}.wav` : `Chair drag ${i}.mp3`, "", "sfx", "foley"),
  );
  const out = await run(["--kind", "sfx/foley", "-n", "10"], takes, noJev);
  expect(out).toMatch(/named by: chair 25, creak 25, door 25, drag 25$/m);
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
    sound("rain-vanilla", { license: "Minecraft 26.3 Assets" }),
    sound("rain-lgpl", { license: "LGPL-3.0-only" }),
  ];
  const ids = async (l: string) =>
    (await run(["rain", "--license", l], pool, noJev)).match(/rain-\w+/g) ?? [];
  expect(await ids("free")).toEqual(["rain-cc0"]);
  expect(await ids("credit")).toEqual(["rain-ccby"]);
  expect(await ids("claim")).toEqual(["rain-pixabay"]);
  expect(await ids("minecraft")).toEqual(["rain-vanilla"]);
  expect(await ids("mod")).toEqual(["rain-lgpl"]);
  // a licence by its own name, and "gpl" is not the end of "lgpl"
  expect(await ids("lgpl")).toEqual(["rain-lgpl"]);
  // a whole word: "cc" is CC BY's first word, not the start of CC0
  expect(await ids("cc")).toEqual(["rain-ccby"]);
  await expect(run(["rain", "--license", "gpl"], pool, noJev)).rejects.toThrow(
    /--license is free, credit, claim, minecraft, mod .*free 1 .*mod 1 .*LGPL-3\.0-only 1/,
  );
});

test("a filter named without a value lists its values with counts", async () => {
  await expect(run(["--license"], vault, noJev)).rejects.toThrow(
    /--license needs a value, e.g. --license free\. --license: free 2 .*minecraft 0/,
  );
  await expect(run(["door", "--source"], vault, noJev)).rejects.toThrow(
    /--source needs a value[\s\S]*mc: minecraft 1/,
  );
  // counted inside the --kind asked for, as the search would filter
  const pool = [
    { ...e("mixamo/Wave", "Wave", "", "mocap", "stand"), secs: 3 },
    { ...e("door-slam", "Door slam", "", "sfx", "foley"), secs: 0.5 },
  ];
  await expect(run(["--kind", "mocap", "--dur"], pool, noJev)).rejects.toThrow(
    /--dur needs a value.*Here: 1-5 1$/,
  );
});

test("another name for an option is read as the option, and the first line says so", async () => {
  const out = await run(["door", "--type", "sfx", "--limit", "1"], vault, noJev);
  expect(out.split("\n")[0]).toBe("(--type read as --kind; --limit read as -n)");
  expect(out).toContain("ear-door-knock");
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

test("search hits end with the filters that would split them, each value with its count", async () => {
  const pool = [
    {
      ...e("mc-door-open", "Door · Open", "", "mc", "blocks"),
      src: "minecraft",
      secs: 0.4,
      data: { license: "Minecraft 26.3 Assets" },
    },
    {
      ...e("mc-garage-door", "Garage door", "", "mc", "blocks"),
      src: "macaws-doors",
      secs: 1.2,
      data: { license: "MIT" },
    },
  ];
  const out = await run(["door"], pool, noJev);
  expect(out).toMatch(
    /narrow these 2: --edition vanilla 1, modded 1 \| --license minecraft 1, mod 1 \| --source macaws-doors 1, minecraft 1 \| --dur 0-1 1, 1-5 1/,
  );
});

test("a transition ease or an anim curve says a film's own is a cubic-bezier in place of the name", async () => {
  const curve = await run(["--show", "linear", "--kind", "anim-curve"], presetEntries(), noJev);
  expect(curve).toMatch(/make your own: .*"curve": \[0\.2, 0, 0, 1\]/);
  const ease = await run(["--show", "linear", "--kind", "transition-ease"], presetEntries(), noJev);
  expect(ease).toMatch(/make your own: .*"ease": \[0\.2, 0, 0, 1\]/);
});

test("--show with --kind shows only that kind's entry of a shared id", async () => {
  const out = await run(["--show", "fade", "--kind", "text-in"], presetEntries(), noJev);
  expect(out).toMatch(/^text-in\/Clean {2}fade/m);
  expect(out).not.toMatch(/kinds share the id|anim-in|text-out/);
});

test("words the filters took are counted without the word naming the kind", async () => {
  const pool = [
    { ...e("bgm-boss", "Boss theme", "", "bgm", "boss"), src: "wither-storm" },
    { ...e("bgm-cry", "Sad piano", "", "bgm", "chill"), src: "pixabay" },
  ];
  const out = await run(["sad", "music", "--kind", "bgm", "--source", "wither-storm"], pool, noJev);
  expect(out).toMatch(
    /these words are in --kind bgm, but not with --source wither-storm: --source pixabay 1 /,
  );
});

test("a category listed whole offers Jev inside that category", async () => {
  const out = await run(["--kind", "sfx/foley"], vault, noJev);
  expect(out).toMatch(/bun run find --jev --kind sfx\/foley "<the scene or feeling>"/);
});

test("Jev offered beside a filtered list or search keeps the filters", async () => {
  expect(await run(["--kind", "sfx", "--license", "free"], vault, noJev)).toMatch(
    /bun run find --jev --kind sfx --license free "<the scene or feeling>"/,
  );
  expect(await run(["xyzzy", "--kind", "sfx", "--license", "free"], vault, noJev)).toMatch(
    /bun run find --jev --kind sfx --license free ['"]?xyzzy['"]?/,
  );
});

test("--show says where a film makes its own of that kind, and a mark gets a line to paste", async () => {
  expect(await run(["--show", "dissolve"], vault, noJev)).toMatch(
    /make your own: a transition: \{id, title, tip, category, glsl\} passed as makeTransitions' last argument/,
  );
  const arrow = await run(["--show", "arrow"], presetEntries(), noJev);
  expect(arrow).toMatch(
    /text\.json items\[\]: \{"kind": "arrow", "x": 0\.5, "y": 0\.5, "size": 160/,
  );
  expect(arrow).toMatch(/see it: bun run render stills --at /);
});

test("the mocap hint names every body filter, and says how to list the moods and props", async () => {
  const clip = {
    ...e("mixamo/Shiver", "Shiver", "", "mocap", "stand"),
    data: { seq: ["stand"], mood: ["scared"], prop: ["none", "chair"], style: ["natural"] },
  };
  const out = await run(["shiver"], [clip], noJev);
  expect(out).toMatch(/--from\|--to\|--has <posture> \(stand\)/);
  expect(out).toMatch(
    /--mood <m>, --prop <p>, --style <s> \(clips checked by eye; --mood, --prop or --style alone lists them\)/,
  );
  expect(out).toMatch(/--air yes\|no/);
  await expect(run(["--mood"], [clip], noJev)).rejects.toThrow(/--mood .*: scared 1/);
  await expect(run(["--style"], [clip], noJev)).rejects.toThrow(/--style .*: natural 1/);
});

test("a mood or posture said another way is read as the tag the clips carry", async () => {
  const clip = {
    ...e("mixamo/Shiver", "Shiver", "", "mocap", "stand"),
    data: { seq: ["stand"], mood: ["scared"] },
  };
  const seen: string[][] = [];
  const clips = async (args: string[]) => (seen.push(args), "1 matches");
  const out = await run(["--mood", "frightened", "--from", "standing"], [clip], noJev, clips);
  expect(out.split("\n")[0]).toBe(
    "(--from standing read as stand; --mood frightened read as scared)",
  );
  expect(seen[0]).toEqual(["--from", "stand", "--mood", "scared", "-n", "12"]);
  await expect(
    run(["--from", "sitting"], [{ ...clip, data: { seq: ["sitFloor", "sitSeat"] } }], noJev, clips),
  ).rejects.toThrow(/close: sitFloor, sitSeat/);
});

test("a clip's name said with underscores reaches the body filters as its words", async () => {
  const clip = {
    ...e("mixamo/Arms_Holding_Knee_c9c00004", "Arms Holding Knee", "", "mocap", "sitSeat"),
    data: { seq: ["sitSeat"] },
  };
  const seen: string[][] = [];
  const clips = async (args: string[]) => (seen.push(args), "1 matches");
  await run(["Arms_Holding_Knee", "--from", "sitSeat"], [clip], noJev, clips);
  expect(seen[0]).toEqual(["arms", "holding", "knee", "--from", "sitSeat", "-n", "12"]);
});

test("a kind too long to list names a category to go into, keeping the filters given", async () => {
  const pool = ["foley", "impacts"].flatMap((cat) =>
    Array.from({ length: 40 }, (_, i) => ({
      ...e(`${cat}-${i}`, `${cat} ${i}`, "", "sfx", cat),
      secs: 0.5,
    })),
  );
  const out = await run(["--kind", "sfx", "--dur", "0-1"], pool, noJev);
  expect(out).toMatch(/next: one category: bun run find --kind sfx\/\w+ --dur 0-1\n/);
  expect(out).toMatch(/search inside it: bun run find <english words> --kind sfx\/\w+ --dur 0-1;/);
});

test("an option quoted into the words is refused, not searched as a word", async () => {
  await expect(run(["door --kind sfx"], vault, noJev)).rejects.toThrow(
    /--kind sits inside the quotes \("door --kind sfx"\).*\(bun run find door --kind sfx\)/,
  );
  // another name for an option, with its value after =, is an option too
  await expect(run(["door --type=sfx"], vault, noJev)).rejects.toThrow(/--type=sfx sits inside/);
  // a description with a dash in it is still words
  await expect(run(["--jev", "a slow fade - then silence"], vault, noJev)).resolves.toBeDefined();
});

test("sources count mocap as a search finds it: fight clips only with --fights", async () => {
  const pool = [
    { ...e("mixamo/Wave", "Wave", "", "mocap", "stand"), src: "mixamo" },
    { ...e("mixamo/Sword_Slash", "Sword Slash", "", "mocap", "stand"), src: "mixamo" },
  ];
  await expect(run(["--source"], pool, noJev)).rejects.toThrow(/mocap: mixamo 1\b/);
});

test("a sub-kind's categories are named under it, so a category keeps to that side", async () => {
  const pool = [
    e("rise", "Rise", "", "text-in", "Build & Mask"),
    e("pop", "Pop", "", "text-in", "Pop & Scale"),
    e("sink", "Sink", "", "text-out", "Build & Mask"),
  ];
  const out = await run(["--kind", "text-in"], pool, noJev);
  expect(out).toMatch(
    /categories \(--kind <kind>\/<category>\): text-in\/build-mask 1, text-in\/pop-scale 1/,
  );
});

test("a body filter named without a value says what it measures", async () => {
  for (const [o, says] of [
    ["--energy", /mean joint speed .*idle ~10, walk ~30, jump 200/],
    ["--air", /yes .*off the floor.*no .*feet down/],
    ["--look", /head turn on the neck.*degrees/],
  ] as const)
    await expect(run([o], vault, noJev)).rejects.toThrow(says);
});

test("words that name a kind put its hits first", async () => {
  const pool = [
    e("sad-pose", "Sad pose", "", "mocap", "stand"),
    e("bgm-sad", "Sad piano", "", "bgm", "chill"),
  ];
  const out = await run(["sad", "music"], pool, noJev);
  expect(out.indexOf("bgm-sad")).toBeLessThan(out.indexOf("sad-pose"));
  expect(out).toMatch(/bun run find sad --kind bgm searches only that/);
});

test("a source's name in the words is a filter, and a kind it never fills is said to be absent", async () => {
  const pool = [
    { ...e("mixamo/Walk", "Walk", "", "mocap", "stand"), src: "mixamo" },
    { ...e("bgm-calm", "Calm music", "", "bgm", "chill"), src: "pixabay" },
  ];
  const out = await run(["mixamo", "music"], pool, noJev);
  expect(out).toMatch(
    /mixamo is a source with no bgm \(only mocap\): the vault has no mixamo bgm\. bgm comes from: pixabay 1/,
  );
  expect(await run(["mixamo", "walk"], pool, noJev)).toMatch(
    /mixamo is a source: add --source mixamo/,
  );
});

test("a filter that leaves a kind empty names the filter, even when the source never had that kind", async () => {
  const pool = [
    { ...e("mc-cave", "Cave", "", "mc", "ambience"), src: "alexs-caves" },
    { ...e("ear-hit", "Hit", "", "sfx", "impacts"), src: "earshot" },
  ];
  await expect(run(["--kind", "sfx", "--source", "alexs-caves"], pool, noJev)).rejects.toThrow(
    /--source alexs-caves keeps mc 1, none of it --kind sfx/,
  );
});

test("--show finds a clip named under the wrong library when only one library has it", async () => {
  const clip = { ...e("ual1/Sitting_Enter", "Sitting Enter", "", "mocap", "stand"), src: "ual1" };
  expect(await run(["--show", "mixamo/Sitting_Enter"], [clip], noJev)).toContain(
    "ual1/Sitting_Enter",
  );
});

test("a word no title says but a category is about points to that category", async () => {
  const pool = [
    e("mc-cave-amb", "Cave · Ambience", "", "mc", "ambience"),
    e("mc-cave-eerie", "Cave", "", "mc", "horror"),
  ];
  const out = await run(["creepy", "cave", "ambience"], pool, noJev);
  expect(out).toMatch(
    /"creepy" is what a category holds: mc\/horror 1\. bun run find cave ambience --kind mc\/horror/,
  );
  expect(out).not.toMatch(/a track says no more than its group/);
});

test("when every clip shown has a flaw, find says none is clean and how to get one", async () => {
  const clips = async () =>
    "1 match\nmixamo/Fall_Pool  3s  stand>sitFloor\n      falls\n      FLAW: meant to land in water";
  const out = await run(
    ["--from", "stand"],
    [{ ...e("mixamo/Fall_Pool", "Fall", "", "mocap", "stand"), data: { seq: ["stand"] } }],
    noJev,
    clips,
  );
  expect(out).toMatch(/next: every clip shown has a FLAW seen by eye: none is clean as it is/);
});

test("narration is made with voice:gen, never found, whether asked as words or as a kind", async () => {
  expect(await run(["narration"], vault, noJev)).toMatch(
    /next: a spoken line .* bun run voice:gen/,
  );
  await expect(run(["hello", "--kind", "voice"], vault, noJev)).rejects.toThrow(
    /--kind voice: a spoken line .*voice:gen/,
  );
});

test("Minecraft's own music is said to be absent, however it is asked", async () => {
  const pool = [
    { ...e("mc-door", "Door", "", "mc", "blocks"), src: "minecraft" },
    { ...e("bgm-boss", "Boss theme", "", "bgm", "boss"), src: "wither-storm" },
  ];
  for (const ask of [["minecraft", "music"], ["pigstep"], ["music", "--kind", "mc"]])
    expect(await run(ask, pool, noJev)).toMatch(/Minecraft's own music .* is not in the vault/);
  await expect(run(["--kind", "bgm", "--source", "minecraft"], pool, noJev)).rejects.toThrow(
    /none of it --kind bgm[\s\S]*Minecraft's own music/,
  );
});

test("a long sound offers a looping bed as well as a hit", async () => {
  const amb = { ...e("mc-cave-amb", "Cave ambience", "", "mc", "ambience"), secs: 40 };
  expect(await run(["--show", "mc-cave-amb"], [amb], noJev)).toMatch(
    /or under a whole scene, looping: beds\[\]: \{"name": "mc-cave-amb"/,
  );
});

test("an entry is starred by the id the studio's star gives it, and any take stars its sound family", () => {
  const [door] = soundEntries([
    { name: "door-1", family: "door", variant: 1 },
    { name: "door-2", family: "door", variant: 2 },
  ]);
  const xs = markStarred(
    [
      door!,
      e("dissolve", "Dissolve", "", "transition"),
      e("pop", "Pop", "", "anim-in"),
      e("pop", "Pop", "", "text-in"),
      e("ring", "Ring", "", "shape-out"),
      e("mixamo/Walking", "Walking", "", "mocap"),
      e("slide", "Slide", "", "transition"),
    ],
    {
      sounds: ["door-2"],
      effects: [
        "transition:dissolve",
        "text:text:in:pop",
        "text:shape:out:ring",
        "mocap:mixamo/Walking",
      ],
    },
  );
  expect(xs.map((x) => `${x.kind}:${x.id}:${!!x.fav}`)).toEqual([
    "sfx:door-1:true",
    "transition:dissolve:true",
    "anim-in:pop:false",
    "text-in:pop:true",
    "shape-out:ring:true",
    "mocap:mixamo/Walking:true",
    "transition:slide:false",
  ]);
});

// A favourites folder of the test's own, with these lists written into it
const withFavorites = async (
  lists: Record<string, { sounds?: string[]; effects?: string[] }>,
  body: (favs: ReturnType<typeof favoriteLists>) => Promise<void>,
) => {
  const dir = mkdtempSync(join(tmpdir(), "fav-"));
  try {
    for (const [name, l] of Object.entries(lists))
      writeFileSync(join(dir, `${name}.json`), JSON.stringify({ sounds: [], effects: [], ...l }));
    await body(favoriteLists(dir));
  } finally {
    rmSync(dir, { recursive: true });
  }
};
const starredPool = () => [
  e("boom", "Big boom", "", "sfx", "impacts"),
  e("thud", "Boom thud", "", "sfx", "impacts"),
  e("dissolve", "Dissolve", "", "transition", "basic"),
];

test("--fav keeps only what the creator starred, and each starred line says so", () =>
  withFavorites(
    { default: { sounds: ["boom"], effects: ["transition:dissolve"] } },
    async (favs) => {
      const out = await run(["boom", "--fav"], starredPool(), noJev, undefined, favs);
      expect(out).toMatch(/boom .*\[starred\]/);
      expect(out).not.toMatch(/thud/);
      const all = await run(["--favorites"], starredPool(), noJev, undefined, favs);
      expect(all).toMatch(
        /^\(--favorites read as --fav\)\n2 starred by the creator in the default favourites/,
      );
      expect(all).toMatch(/dissolve/);
    },
  ));

test("--fav reads the default list unless a list is named, and offers the others", () =>
  withFavorites({ default: { sounds: ["boom"] }, horror: { sounds: ["thud"] } }, async (favs) => {
    const plain = await run(["boom", "--fav"], starredPool(), noJev, undefined, favs);
    expect(plain).toMatch(
      /other favourites lists: horror 1 \(this one: default; another: bun run find --fav horror boom\)/,
    );
    const horror = await run(["boom", "--fav", "horror"], starredPool(), noJev, undefined, favs);
    expect(horror).toMatch(/thud .*\[starred\]/);
    expect(horror).not.toMatch(/Big boom/);
    const typo = await run(["--fav=horrror"], starredPool(), noJev, undefined, favs);
    expect(typo).toMatch(/^\(no favourites list "horrror", the default list used\)/);
  }));

test("a word after --fav that names no list is said to be read as a search word, with one list too", () =>
  withFavorites({ default: { sounds: ["boom"] } }, async (favs) => {
    const out = await run(["--fav", "horror"], starredPool(), noJev, undefined, favs);
    expect(out).toMatch(
      /"horror" after --fav names no favourites list \(default\): read as a search word/,
    );
  }));

test("--fav with nothing starred says how a star is given", () =>
  withFavorites({}, async (favs) => {
    const out = await run(["--fav"], starredPool(), noJev, undefined, favs);
    expect(out).toMatch(/nothing is starred yet in the default favourites/);
    expect(out).toMatch(/bun run find --star <id>/);
  }));

test("a list with starred entries offers --fav among its filters", () =>
  withFavorites({ default: { sounds: ["boom"] } }, async (favs) => {
    expect(await run(["--kind", "sfx"], starredPool(), noJev, undefined, favs)).toMatch(
      /filter: --fav 1 starred/,
    );
  }));

test("--star and --unstar write the list the studio reads, or a named one", () =>
  withFavorites({}, async (favs) => {
    const pool = [
      e("boom", "Big boom", "", "sfx"),
      e("fade", "Fade", "", "transition"),
      e("fade", "Fade", "", "anim-in"),
    ];
    expect(await run(["--star", "boom"], pool, noJev, undefined, favs)).toMatch(
      /starred in the default favourites: sfx boom/,
    );
    await expect(run(["--star", "fade"], pool, noJev, undefined, favs)).rejects.toThrow(
      /fade is a transition and an anim-in: add --kind/,
    );
    await run(["--star", "fade", "--kind", "anim"], pool, noJev, undefined, favs);
    await run(["--star", "boom", "--fav", "horror"], pool, noJev, undefined, favs);
    await run(["--unstar", "boom"], pool, noJev, undefined, favs);
    expect(favs.open().read()).toEqual({ sounds: [], effects: ["in:fade"] });
    expect(favs.open("horror").read().sounds).toEqual(["boom"]);
  }));

test("--star with commas and no id is an error, not an empty success", async () => {
  await expect(run(["--star", ","], [e("boom", "Big boom")], noJev)).rejects.toThrow(
    /--star needs an id/,
  );
});

test("--star into a list name no list can have stars nothing", () =>
  withFavorites({}, async (favs) => {
    await expect(
      run(
        ["--star", "boom", "--fav", "bad name!"],
        [e("boom", "Big boom")],
        noJev,
        undefined,
        favs,
      ),
    ).rejects.toThrow(/"bad name!" cannot name a favourites list: a-z, 0-9 and -/);
    expect(favs.open().read().sounds).toEqual([]);
  }));

test("a bgm list says Minecraft's own music is not in the vault", async () => {
  const pool = [{ ...e("bgm-boss", "Boss theme", "", "bgm", "boss"), src: "wither-storm" }];
  expect(await run(["--kind", "bgm"], pool, noJev)).toMatch(
    /Minecraft's own music .* is not in the vault/,
  );
});

test("words no favourite has point to the lists that have them, and to the search without --fav", () =>
  withFavorites(
    { default: { effects: ["transition:dissolve"] }, horror: { sounds: ["thud"] } },
    async (favs) => {
      expect(await run(["thud", "--fav"], starredPool(), noJev, undefined, favs)).toMatch(
        /none of the default favourites has these words; other lists do: horror 1 \(bun run find thud --fav horror\); \d+ entries outside the favourites do \(bun run find thud\)/,
      );
    },
  ));

test("a word after --fav that names no list is said to be read as a search word", () =>
  withFavorites({ default: { sounds: ["boom"] }, horror: { sounds: ["thud"] } }, async (favs) => {
    expect(await run(["--fav", "horrror", "boom"], starredPool(), noJev, undefined, favs)).toMatch(
      /^\("horrror" after --fav names no favourites list \(default, horror\): read as a search word/,
    );
  }));

test("a search without --fav names the creator's favourites when there are some", () =>
  withFavorites({ horror: { sounds: ["thud"] } }, async (favs) => {
    expect(await run(["dissolve"], starredPool(), noJev, undefined, favs)).toMatch(
      /the creator's favourites: horror 1 \(only those: add --fav, or --fav <list>\)/,
    );
  }));

test("beat and ambient are read as the kind and category they mean", async () => {
  const pool = [
    e("pulse", "Pulse", "", "velocity"),
    { ...e("mc-wind", "Wind", "", "mc", "ambience"), src: "minecraft" },
  ];
  expect(await run(["--kind", "beats"], pool, noJev)).toMatch(/--kind beats read as velocity/);
  await expect(run(["--kind", "ambient"], pool, noJev)).rejects.toThrow(
    /ambient is a category, not a kind: --kind mc\/ambience/,
  );
});

test("a feeling searched among mocap clips points to the mood they are tagged with", async () => {
  const clip = { ...e("mixamo/Cower", "Cower", "", "mocap"), data: { mood: ["scared"] } };
  expect(await run(["frightened", "--kind", "mocap"], [clip], noJev)).toMatch(
    /scared is a mood clips checked by eye are tagged with: bun run find --mood scared \(1 clips\)/,
  );
});

test("mocap by meaning keeps the length and source filters it was given", async () => {
  let got: string[] = [];
  const clips = (args: string[]) => ((got = args), Promise.resolve("catalogue rows"));
  const pool = [...vault, { ...walk, secs: 2 }];
  await run(
    ["--jev", "--kind", "mocap", "--dur", "1-4", "--source", "mixamo", "he walks"],
    pool,
    noJev,
    clips,
  );
  expect(got).toEqual(
    expect.arrayContaining(["--jev", "he walks", "--dur", "1-4", "--lib", "mixamo"]),
  );
});

test("Jev picking a transition votes over transitions, not the eases that time them, unless eases are asked", async () => {
  const pool = [
    ...vault,
    {
      ...e("linear", "Linear", "constant speed", "transition-ease", "ease"),
      src: "film-stage/transitions.ts",
    },
  ];
  let voted: string[] = [];
  const jev = (_: string, xs: Entry[]) => (
    (voted = xs.map((x) => x.id)),
    Promise.resolve(xs.map((x): [number, Entry, number] => [0.5, x, 0.9]))
  );
  await run(["--jev", "--kind", "transition", "a hard cut"], pool, jev);
  expect(voted).toEqual(["dissolve"]);
  await run(["--jev", "--kind", "transition/ease", "steady speed"], pool, jev);
  expect(voted).toEqual(["linear"]);
});

test("a hit Jev is sure of names --show once and offers no way to make one", async () => {
  const jev = (_: string, xs: Entry[]) =>
    Promise.resolve(
      xs.map((x): [number, Entry, number] => [x.id === "ear-door-knock" ? 0.9 : 0.05, x, 0.9]),
    );
  const out = await run(["--jev", "--kind", "sound", "someone knocks"], vault, jev);
  expect(out).toMatch(/FOUND: ear-door-knock/);
  expect(out).not.toMatch(/one in full/);
  expect(out).not.toMatch(/make it|sfx:get/);
});

test("mocap hits name --show once, in the general line", async () => {
  const out = await run(["walking"], [...vault, walk], noJev);
  expect(out.match(/bun run find --show <id>/g)).toHaveLength(1);
});

test("Jev checks the fit of a dozen hits at most, however many are listed", async () => {
  let show = 0;
  const jev = (_: string, xs: Entry[], s: number) => ((show = s), Promise.resolve([]));
  await run(["--jev", "--kind", "sound", "-n", "100", "a knock"], vault, jev);
  expect(show).toBe(12);
});

test("words in another language never go to earshot, which hears English descriptions only", async () => {
  const pool = [
    {
      ...e("door-a", "Door A", "door slam", "sfx", "foley"),
      data: { file: "sfx/foley/door-a.wav" },
    },
    {
      ...e("door-b", "Door B", "door slam", "sfx", "foley"),
      data: { file: "sfx/foley/door-b.wav" },
    },
  ];
  const jev = (_: string, xs: Entry[]) =>
    Promise.resolve(xs.map((x): [number, Entry, number] => [0.5, x, 0.5]));
  const out = await run(["--jev", "--kind", "sfx", "cửa đóng sầm"], pool, jev);
  expect(out).toMatch(/earshot rank (['"])<the sound in English words>\1/);
  expect(out).not.toMatch(/earshot rank ['"]cửa/);
});

test("--show of an id several kinds share says each way to make your own once", async () => {
  const pool = presetEntries().filter((x) => x.id === "fade");
  const out = await run(["--show", "fade"], pool, noJev);
  for (const own of new Set(
    out.split("\n").filter((l) => l.startsWith("make your own:") && !l.includes(" as for ")),
  ))
    expect(out.split(own).length - 1).toBe(1);
  expect(out).toMatch(/make your own: as for anim-in above/);
});

test("--all is gone: a family's takes are in its --show, and a list never takes more than 200 lines", async () => {
  await expect(run(["door", "--all"], vault, noJev)).rejects.toThrow(
    /--show <id> names every take/,
  );
  await expect(run(["door", "-n", "500"], vault, noJev)).rejects.toThrow(
    /200 at most. Narrow instead/,
  );
  expect(await run(["zombie"], vault, noJev)).toMatch(/--show <id> names every take/);
});

test("when Jev rejects every hit it checked, the ones it never checked are not shown as answers", async () => {
  const pool = Array.from({ length: 4 }, (_, i) =>
    e(`door-${i}`, `Door ${i}`, "a door", "sfx", "foley"),
  );
  // two checked and rejected; the two under them got a vote but no check
  const jev = (_: string, xs: Entry[]) =>
    Promise.resolve(
      xs.map((x, i): [number, Entry, number?] => [0.4 - i * 0.1, x, i < 2 ? 0.05 : undefined]),
    );
  const out = await run(["--jev", "--kind", "sfx", "-n", "4", "a dog barking"], pool, jev);
  expect(out).toMatch(/NOT IN THE VAULT/);
  expect(out).not.toMatch(/door-2|door-3/);
});

test("music Jev rejects points to making music, not to the rejects or to other kinds", async () => {
  const pool = ["a", "b"].map((k) => ({
    ...e(`bgm-${k}`, `Track ${k}`, "a sad slow theme", "bgm", "cinematic"),
    data: { file: `bgm/cinematic/bgm-${k}.wav` },
  }));
  const stand = { ...e("mx-stand", "Stand", "a sad slow idle", "mocap", "stand"), secs: 3 };
  const jev = (_: string, xs: Entry[]) =>
    Promise.resolve(xs.map((x): [number, Entry, number] => [0.5, x, 0.1]));
  const out = await run(["--jev", "--kind", "bgm", "a sad slow lullaby"], [...pool, stand], jev);
  expect(out).toMatch(/NOT IN THE VAULT/);
  expect(out).toMatch(/real-sound/);
  expect(out).not.toMatch(/sfx:get|outside --kind|--kind sound|--show <id>|earshot rank/);
});

test("the mocap filters offered next leave out the ones already given", async () => {
  const clips = () => Promise.resolve("mixamo/Sit_1  2.0s  stand>sitFloor");
  const sit = {
    ...e("mixamo/Sit_1", "Sit", "sits down", "mocap", "stand"),
    src: "mixamo",
    data: { seq: ["stand", "sitFloor"] },
  };
  const out = await run(
    ["sit", "--from", "stand", "--to", "sitFloor"],
    [...vault, sit],
    noJev,
    clips,
  );
  const offer = out.split("\n").find((l) => l.includes("any mix:"))!;
  expect(offer).not.toMatch(/--from|--to\b/);
  expect(offer).toMatch(/--has <posture>/);
});

test("hits Jev says are not what was asked are left out, but the best of them stays", async () => {
  const pool = ["a", "b", "c"].map((k) => e(`door-${k}`, `Door ${k}`, "door", "sfx", "foley"));
  const fits: Record<string, number> = { "door-a": 0.9, "door-b": 0.5, "door-c": 0.1 };
  const jev = (_: string, xs: Entry[]) =>
    Promise.resolve(xs.map((x): [number, Entry, number] => [fits[x.id]!, x, fits[x.id]!]));
  const out = await run(["--jev", "--kind", "sfx", "a door"], pool, jev);
  expect(out).toMatch(/door-a/);
  expect(out).toMatch(/door-b/);
  expect(out).not.toMatch(/door-c/);
  const none = (_: string, xs: Entry[]) =>
    Promise.resolve(xs.map((x): [number, Entry, number] => [fits[x.id]!, x, 0.1]));
  const miss = await run(["--jev", "--kind", "sfx", "a door"], pool, none);
  expect(miss).toMatch(/0\.90 +fits 0\.10 .*door-a/);
  expect(miss).not.toMatch(/door-b|door-c/);
});

test("a miss shows the row whose fit it quotes", async () => {
  const pool = ["a", "b"].map((k) => e(`door-${k}`, `Door ${k}`, "door", "sfx", "foley"));
  const jev = (_: string, xs: Entry[]) =>
    Promise.resolve(
      xs.map((x): [number, Entry, number] => (x.id === "door-a" ? [0.9, x, 0.04] : [0.1, x, 0.2])),
    );
  const out = await run(["--jev", "--kind", "sfx", "a dragon singing opera"], pool, jev);
  expect(out).toMatch(/best fit 0\.20/);
  expect(out).toMatch(/fits 0\.20 .*door-b/);
});

test("weapon and fight clips stay out of a word search, as the catalogue's own leaves them out", async () => {
  const rifle = {
    ...e("mixamo/Rifle_Walk_c9ce9930", "Rifle Walk", "", "mocap", "stand"),
    src: "mixamo",
  };
  const relaxed = {
    ...e("mixamo/Relaxed_Walk_c9ce0000", "Relaxed Walk", "", "mocap", "stand"),
    src: "mixamo",
  };
  const out = await run(["walk"], [rifle, relaxed], noJev);
  expect(out).toMatch(/Relaxed_Walk/);
  expect(out).not.toMatch(/Rifle_Walk/);
});

test("words only fight clips have point to --fights, not to making the move", async () => {
  const sword = {
    ...e("mixamo/Sword_Slash_c9ce0001", "Sword Slash", "", "mocap", "stand"),
    src: "mixamo",
  };
  const out = await run(["sword", "--kind", "mocap"], [sword, walk], noJev);
  expect(out).toMatch(
    /1 weapon or fight clip has more of these words \(left out by default\): mixamo\/Sword_Slash_c9ce0001;.*--fights/,
  );
  expect(out).not.toMatch(/make it/);
});

test("the kinds listed count mocap as a search finds it, the fight clips said apart", async () => {
  const sword = { ...e("mixamo/Sword_Slash_c9ce0001", "Sword Slash", "", "mocap", "stand") };
  await expect(run(["--kind"], [walk, sword], noJev)).rejects.toThrow(
    /Kinds: mocap 1 \(and 1 weapon or fight clip, left out unless --fights\)/,
  );
});

test("a fight clip with more of the words than the top hit is named, though the top hit has some", async () => {
  const zombie = {
    ...e("mixamo/Zombie_Walking_c9c60315", "Zombie Walking", "", "mocap", "stand"),
    src: "mixamo",
  };
  const out = await run(["zombie", "walking", "--kind", "mocap"], [zombie, walk], noJev);
  expect(out).toMatch(/fight clip has more of these words .*mixamo\/Zombie_Walking_c9c60315/);
  const shown = await run(["walking", "--kind", "mocap"], [zombie, walk], noJev);
  expect(shown).not.toMatch(/fight clip/);
});

test("a clip whose retarget breaks on Steve says so, as the catalogue's own search does", () => {
  const dir = mkdtempSync(join(tmpdir(), "find-mocap-"));
  writeFileSync(
    join(dir, "mixamo.jsonl"),
    `${JSON.stringify({ ref: "mixamo/Spin_c9c00000", dur: 2 })}\n`,
  );
  writeFileSync(
    join(dir, "sweep_mixamo.jsonl"),
    `${JSON.stringify({ clip: "Spin_c9c00000", s: { "spin forearm L": [90, 1.2], "sink (low)": [3, 0.5] } })}\n`,
  );
  writeFileSync(join(dir, "review.json"), "{}");
  const [clip] = mocapEntries(dir);
  expect(clip?.note).toBe("flaw: retarget breaks on Steve: a limb flips round at 1.2 s");
  rmSync(dir, { recursive: true });
});

test("a clip's postures start and end where --from and --to read them, unless checked by eye", async () => {
  const dir = mkdtempSync(join(tmpdir(), "find-mocap-"));
  // measured: standing in its first 0.2 s, a run too short to make the sequence
  const row = (ref: string) => ({
    ref,
    dur: 2.5,
    start: "stand",
    end: "sitFloor",
    seq: ["crouch", "lie", "sitFloor"],
    tl: { body: [[0, 2.5, "stand"]] },
  });
  writeFileSync(
    join(dir, "mixamo.jsonl"),
    `${JSON.stringify(row("mixamo/Hit_c9c00001"))}\n${JSON.stringify(row("mixamo/Fixed_c9c00002"))}\n`,
  );
  writeFileSync(
    join(dir, "review.json"),
    JSON.stringify({ "mixamo/Fixed_c9c00002": { seq: ["crouch", "sitFloor"] } }),
  );
  const [hit, fixed] = mocapEntries(dir);
  expect(hit?.data?.seq).toEqual(["stand", "crouch", "lie", "sitFloor"]);
  expect(fixed?.data?.seq).toEqual(["crouch", "sitFloor"]);
  expect(await run(["--show", fixed!.id], [fixed!], noJev)).toContain(
    "body (checked by eye): crouch > sitFloor",
  );
  rmSync(dir, { recursive: true });
});

test("mocap duration filters and details use the eye-checked duration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "find-reviewed-duration-"));
  try {
    const ref = "mixamo/Idle_c9c00003";
    writeFileSync(
      join(dir, "mixamo.jsonl"),
      JSON.stringify({ ref, dur: 0, start: "stand", end: "stand" }) + "\n",
    );
    writeFileSync(join(dir, "review.json"), JSON.stringify({ [ref]: { dur: 4 } }));
    const clips = mocapEntries(dir);
    const found = await run(["--kind", "mocap", "--dur", "3-5"], clips, noJev);
    expect(found).toContain(ref);
    expect(found).toContain("4.0s");
    expect(await run(["--show", ref], clips, noJev)).not.toContain("one frame");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a clip's category is its postures as checked by eye, not as measured", () => {
  const dir = mkdtempSync(join(tmpdir(), "find-mocap-"));
  writeFileSync(
    join(dir, "mixamo.jsonl"),
    `${JSON.stringify({ ref: "mixamo/Knee_c9c00003", dur: 0, start: "crouch", end: "crouch" })}\n`,
  );
  writeFileSync(
    join(dir, "review.json"),
    JSON.stringify({ "mixamo/Knee_c9c00003": { start: "sitSeat", end: "sitSeat" } }),
  );
  const [clip] = mocapEntries(dir);
  expect(clip?.cat).toBe("sitSeat");
  expect(clip?.data?.seq).toEqual(["sitSeat"]);
  rmSync(dir, { recursive: true });
});

test("a word search finds a clip by what it touches, as --prop does", async () => {
  const dir = mkdtempSync(join(tmpdir(), "find-mocap-"));
  writeFileSync(
    join(dir, "mixamo.jsonl"),
    `${JSON.stringify({ ref: "mixamo/Sit_Idle_c9c00004", dur: 3 })}\n${JSON.stringify({ ref: "mixamo/Idle_c9c00005", dur: 3 })}\n`,
  );
  writeFileSync(
    join(dir, "review.json"),
    JSON.stringify({
      "mixamo/Sit_Idle_c9c00004": { desc: "seated, still", mood: ["calm"], prop: ["chair"] },
      "mixamo/Idle_c9c00005": { desc: "stands still", mood: ["calm"], prop: ["none"] },
    }),
  );
  const pool = mocapEntries(dir);
  rmSync(dir, { recursive: true });
  expect(await run(["chair", "--kind", "mocap"], pool, noJev)).toMatch(/Sit_Idle_c9c00004/);
  expect(await run(["none", "--kind", "mocap"], pool, noJev)).not.toMatch(/Idle_c9c00005/);
});

test("a sound-only filter beside a body filter is refused, never silently dropped", async () => {
  const sit = {
    ...e("mixamo/Sit_1", "Sit", "sits down", "mocap", "stand"),
    data: { seq: ["stand", "sitFloor"] },
  };
  await expect(
    run(["sit", "--from", "stand", "--origin", "real", "--license", "free"], [sit], noJev),
  ).rejects.toThrow(/--origin --license .*mocap clips have none/);
});

test("a film's own sounds have their length, and its bgm folder holds music", () => {
  const film = mkdtempSync(join(tmpdir(), "find-film-"));
  writeFileSync(
    join(film, "package.json"),
    JSON.stringify({ "live-studio": { sfx: "sound/sfx" } }),
  );
  // one second of 8 kHz 8-bit mono silence
  const wav = (path: string) => {
    const head = Buffer.alloc(44);
    head.write("RIFF", 0);
    head.writeUInt32LE(36 + 8000, 4);
    head.write("WAVEfmt ", 8);
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(1, 22);
    head.writeUInt32LE(8000, 24);
    head.writeUInt32LE(8000, 28);
    head.writeUInt16LE(1, 32);
    head.writeUInt16LE(8, 34);
    head.write("data", 36);
    head.writeUInt32LE(8000, 40);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.concat([head, Buffer.alloc(8000, 128)]));
  };
  writeFileSync(join(film, "vault.json"), JSON.stringify({ root: "vault" }));
  wav(join(film, "vault/sound/sfx/vault-hit.wav"));
  wav(join(film, "sound/sfx/my-hit.wav"));
  wav(join(film, "sound/sfx/bgm/calm/my-theme.wav"));
  const fixtureVault = join(film, "vault");
  wav(join(fixtureVault, "sound/sfx/foley/vault-hit.wav"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--no-env-file",
        "-e",
        `import {allEntries} from ${JSON.stringify(new URL("../find.ts", import.meta.url).href)};
import {copyFileSync} from "node:fs";
const film = ${JSON.stringify(film)};
const before = allEntries(true, film);
copyFileSync(film + "/sound/sfx/my-hit.wav", film + "/sound/sfx/vault-hit.wav");
console.log(JSON.stringify({before, after: allEntries(true, film).filter(x => x.id === "vault-hit")}));`,
      ],
      {
        env: { ...process.env, MC_VAULT_ROOT: fixtureVault, MC_VAULT_EXTERNAL: fixtureVault },
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const { before, after } = JSON.parse(result.stdout) as { before: Entry[]; after: Entry[] };
    const mine = before.filter((x) => x.src === "this-film");
    expect(mine.find((x) => x.id === "my-hit")?.secs).toBeCloseTo(1, 2);
    expect(mine.find((x) => x.id === "my-theme")?.kind).toBe("bgm");
    expect(before.find((x) => x.id === "vault-hit")).toMatchObject({ kind: "sfx", takes: 1 });
    expect(after.map((x) => [x.src, x.takes])).toEqual([["this-film", 1]]);
  } finally {
    rmSync(film, { recursive: true });
  }
});

test("the eases of one group are told apart at the start of their rows, not by the job they share", async () => {
  const eases = presetEntries().filter((x) => x.cat === "arrive");
  const out = await run(["--kind", "ease/arrive"], eases, noJev);
  const starts = out
    .split("\n")
    .filter((l) => l.startsWith("ease/"))
    .map((l) => l.split(" — ")[1]!.slice(0, 30));
  expect(starts).toHaveLength(eases.length);
  expect(new Set(starts).size).toBeGreaterThan(eases.length / 2);
});

test("a stray clip among sounds brings no body filters along", async () => {
  const out = await run(["walking", "door"], [...vault, walk], noJev);
  expect(out).not.toMatch(/--from\|--to/);
  expect(await run(["walking"], [...vault, walk], noJev)).toMatch(/--from\|--to/);
});

test("--fav default names the default list, never a search word", () =>
  withFavorites({ default: { sounds: ["boom"] }, horror: { sounds: ["thud"] } }, async (favs) => {
    const out = await run(["--fav", "default"], starredPool(), noJev, undefined, favs);
    expect(out).not.toMatch(/after --fav names no favourites list/);
    await expect(
      run(["--fav", "horror", "--fav", "default"], starredPool(), noJev, undefined, favs),
    ).rejects.toThrow(/--fav given twice/);
  }));

test("an id said whole comes first, before the kind a word of it names", async () => {
  const pool = [
    ...Array.from({ length: 5 }, (_, i) => e(`bgm-${i}`, `Track ${i}`, "", "bgm", "chill")),
    e("bgm_drone", "Bgm Drone", "a low drone", "sfx", "ambience"),
  ];
  const out = await run(["bgm_drone"], pool, noJev);
  expect(out.split("\n")[0]).toMatch(/bgm_drone/);
  // the word naming the kind asked is dropped from the search, never from the id said whole
  const music = [
    ...Array.from({ length: 5 }, (_, i) => e(`drone-${i}`, "Drone", "drone drone", "bgm", "drone")),
    e("bgm_drone", "Bgm Drone", "", "bgm", "dark"),
  ];
  const asked = await run(["bgm_drone", "--kind", "bgm"], music, noJev);
  expect(asked.split("\n")[0]).toMatch(/ bgm_drone /);
});

test("words beside body filters reach catalog.py without the words that name nothing", async () => {
  const clip = {
    ...e("mixamo/Sit_c9c00006", "Sit", "", "mocap", "stand"),
    data: { seq: ["stand", "sitSeat"] },
  };
  const seen: string[][] = [];
  const clips = async (args: string[]) => (seen.push(args), "1 matches");
  await run(["sitting", "in", "a", "chair", "--from", "stand"], [clip], noJev, clips);
  expect(seen[0]?.slice(0, 2)).toEqual(["sitting", "chair"]);
  // words that all name nothing, or are not English, would reach it as no words: every clip the filters pass
  await expect(run(["like", "this", "--from", "stand"], [clip], noJev, clips)).rejects.toThrow(
    /names no move/,
  );
  await expect(run(["ngồi xuống", "--from", "stand"], [clip], noJev, clips)).rejects.toThrow(
    /English only/,
  );
  expect(seen).toHaveLength(1);
});
test("bad --kind is reported even with body filters, and swing3d matches swing3D", async () => {
  await expect(run(["--kind", "bogus", "--from", "stand"], vault, noJev)).rejects.toThrow(
    /Unknown --kind bogus/,
  );
  const anims = presetEntries().filter((x) => x.kind === "anim-in");
  const out = await run(["swing3d", "-n", "3"], anims, noJev);
  expect(out).toMatch(/anim-in\/\S+\s+swing3D\b/);
});

test("find --kind lens exposes prime lenses, DOF/framing helpers, aliases, and pasteable snippets", async () => {
  const presets = presetEntries();
  const list = await run(["--kind", "lens"], presets, noJev);
  for (const id of [
    "14mm",
    "18mm",
    "24mm",
    "35mm",
    "50mm",
    "85mm",
    "135mm",
    "shotSize",
    "frameSubject",
    "dollyZoom",
    "followTarget",
  ])
    expect(list).toContain(id);

  const alias = await run(["--kind", "dof"], presets, noJev);
  expect(alias).toContain("read as lens");

  const primeShow = await run(["--show", "50mm"], presets, noJev);
  expect(primeShow).toContain('"mm": 50');
  expect(primeShow).toContain('"fstop"');
  expect(primeShow).toContain('"focus"');

  const helperShow = await run(["--show", "frameSubject"], presets, noJev);
  expect(helperShow).toContain("film-kit/lens");
  expect(helperShow).toContain("frameSubject(");
  expect(helperShow).not.toContain("targetBox");
  expect(helperShow).toContain("[0, 1.5, 0]");

  const followShow = await run(["--show", "followTarget"], presets, noJev);
  expect(followShow).toContain("film-kit/spring");
  expect(followShow).toContain("from: 0, to: 10");
  expect(followShow).not.toContain("halfLife");

  const shotShow = await run(["--show", "shotSize"], presets, noJev);
  expect(shotShow).toContain("ECU/CU/MCU/MS/WS/EWS");
  expect(shotShow).not.toContain("MLS");

  const teleShow = await run(["--show", "85mm"], presets, noJev);
  expect(teleShow).toContain("~14 deg V-FOV on 16:9");

  const filmKitLenses = await run(["--source", "film-kit", "--kind", "lens"], presets, noJev);
  for (const id of ["14mm", "50mm", "135mm", "frameSubject"]) expect(filmKitLenses).toContain(id);
});

test("find --kind shake exposes all SHAKES handheld presets, trauma hits, and snippets", async () => {
  const presets = presetEntries();
  const list = await run(["--kind", "shake"], presets, noJev);
  for (const id of [
    "INVESTIGATION",
    "THE_CLOSEUP",
    "THE_WEDDING",
    "WALK_TO_THE_STORE",
    "HANDYCAM_RUN",
    "BIKE_ON_GRAVEL_2D",
    "hits",
    "shake",
  ])
    expect(list).toContain(id);

  const alias = await run(["--kind", "handheld"], presets, noJev);
  expect(alias).toContain("read as shake");

  const showPreset = await run(["--show", "THE_CLOSEUP"], presets, noJev);
  expect(showPreset).toContain('"handheld"');
  expect(showPreset).toContain('"THE_CLOSEUP"');

  const showHits = await run(["--show", "hits"], presets, noJev);
  expect(showHits).toContain("shots.json");
  expect(showHits).toContain('"hits"');

  const showShake = await run(["--show", "shake"], presets, noJev);
  expect(showShake).toContain("simplex2d");
  expect(showShake).toContain("rotation-only");
  expect(showShake).not.toContain("Perlin");
  expect(showShake).not.toContain("translation");
});

test("find --kind look exposes all named look presets and removes stale 'no named looks' wording", async () => {
  const presets = presetEntries();
  const list = await run(["--kind", "look"], presets, noJev);
  for (const id of [
    "docu-clean",
    "teal-amber",
    "noir-slate",
    "warm-film",
    "horror-cold",
    "neon-pop",
    "bleach-grit",
  ])
    expect(list).toContain(id);

  const search = await run(["teal"], presets, noJev);
  expect(search).toContain("teal-amber");
  expect(search).not.toContain("no named looks");

  const showLook = await run(["--show", "teal-amber"], presets, noJev);
  expect(showLook).toContain('"look": "teal-amber"');
  expect(showLook).toContain("adjust.json");
  expect(showLook).toContain("shots.json");
});

test("--kind keeps query words that name real entries in that kind, and stray files in sound folders are ignored", async () => {
  const presets = presetEntries();
  const shakeHit = await run(["heavy", "impact", "--kind", "shake"], presets, noJev);
  expect(shakeHit).toMatch(/shake\/\S+\s+hits\b/);
  expect(shakeHit).toMatch(/shake\/\S+\s+SPACESHIP_SHAKE_2D\b/);
  const noFakeBokeh = await run(["bokeh", "--kind", "lens"], presets, noJev);
  expect(noFakeBokeh).not.toMatch(/lens\/Primes\s+14mm\b/);

  // Stray non-directory file under sfx/ should not throw ENOTDIR when --dir isn't overriding soundEntries
  const dir = mkdtempSync(join(tmpdir(), "find-stray-"));
  mkdirSync(join(dir, "sfx/hits"), { recursive: true });
  writeFileSync(join(dir, "sfx/.DS_Store"), "x");
  writeFileSync(join(dir, "sfx/hits/bang.wav"), "x");
  const { vaultSounds } = await import("../find");
  const entries = soundEntries(vaultSounds([dir]));
  expect(entries.map((x) => x.id)).toContain("bang");
  rmSync(dir, { recursive: true, force: true });
});

test("Round 15: unfiltered/favMiss/missing respect ownOnly under --kind, mocapEntries skips error rows, and sub-kind read-as keeps sub-kind", async () => {
  const pool: Entry[] = [
    { ...e("track_a", "Warm Guitar", "soft acoustic", "bgm", "acoustic"), secs: 60 },
    { ...e("track_b", "Deep Drone", "ambient pad", "bgm", "ambient"), secs: 250 },
    { ...e("snd_hit", "Door Slam", "wooden bang", "sfx", "impacts"), secs: 1 },
    { ...e("snd_ui", "Click Sound", "short UI click", "sfx", "ui"), secs: 0.2 },
    {
      ...e("mixkit-1487", "Dagger woosh", "a fast air whoosh, a whip pan", "sfx", "transitions"),
      secs: 0.3,
    },
    { ...e("ear-dl", "Downlifter", "synth drop", "sfx", "transitions"), secs: 2 },
  ];
  const badUnfiltered = await run(["score", "--kind", "bgm", "--dur", "200-500"], pool, noJev);
  expect(badUnfiltered).not.toContain("these words are in --kind bgm");

  await withFavorites({ default: { sounds: ["snd_hit"] } }, async (favs) => {
    const favOut = await run(
      ["zzzzzzz", "sound", "--kind", "sfx", "--fav"],
      pool,
      noJev,
      undefined,
      favs,
    );
    expect(favOut).toContain("1 entries outside the favourites");
  });

  const partial = await run(
    ["dagger", "downlifter", "--kind", "sfx/transitions"],
    pool.filter((x) => x.id !== "ear-dl"),
    noJev,
  );
  expect(partial).toContain("top hit lacks: downlifter");
  expect(partial).toContain("bun run find --jev --kind sfx/transitions");

  const catDir = mkdtempSync(join(tmpdir(), "find-err-r15-"));
  try {
    writeFileSync(
      join(catDir, "mixamo.jsonl"),
      `${JSON.stringify({ ref: "mixamo/Broken_00000001", error: "no skeleton" })}\n` +
        `${JSON.stringify({ ref: "mixamo/Idle_00000002", dur: 2, start: "stand", end: "stand", seq: ["stand"], energy: 10 })}\n`,
    );
    const clips = mocapEntries(catDir);
    expect(clips.map((c) => c.id)).toEqual(["mixamo/Idle_00000002"]);
  } finally {
    rmSync(catDir, { recursive: true, force: true });
  }

  const presets = presetEntries();
  const subRead = await run(["--kind", "text-in/build"], presets, noJev);
  expect(subRead).toContain("read as text-in/build-mask");

  const bodyRead = await run(
    ["--kind", "motion", "--from", "stand"],
    [{ ...e("mixamo/Idle_1", "Idle", "", "mocap", "stand"), data: { seq: ["stand"] } }],
    noJev,
    async () => "mixamo/Idle_1  2.0s  stand",
  );
  expect(bodyRead).toContain("(--kind motion read as mocap)");

  await withFavorites({ default: { sounds: ["snd_hit"] } }, async (favs) => {
    const withPresets = [...pool, ...presets];
    const multiFav = await run(
      ["--kind", "transition,sfx", "--fav"],
      withPresets,
      noJev,
      undefined,
      favs,
    );
    expect(multiFav).toContain("snd_hit");
    expect(multiFav).toContain("Door Slam");
    await expect(
      run(["--kind", "ease", "--fav"], withPresets, noJev, undefined, favs),
    ).rejects.toThrow(/none of it --kind ease/);
  });

  const jevFlawed = await run(
    ["--jev", "--kind", "mocap", "walk slowly"],
    [{ ...e("mixamo/Bad_1", "Bad", "", "mocap", "stand"), data: { seq: ["stand"] } }],
    noJev,
    async () =>
      "0.912  fits 0.850  mixamo/Bad_1  1.4s  stand  Walk\n       FLAW: foot slides\n       0-1.4 stand",
  );
  expect(jevFlawed).toContain("every clip shown has a FLAW seen by eye");

  const catErrDir = mkdtempSync(join(tmpdir(), "find-catpy-err-"));
  try {
    mkdirSync(join(catErrDir, "catalog"), { recursive: true });
    writeFileSync(
      join(catErrDir, "catalog/mixamo.jsonl"),
      `${JSON.stringify({ ref: "mixamo/Broken_00000001", error: "no skeleton" })}\n` +
        `${JSON.stringify({ ref: "mixamo/Idle_00000002", dur: 2, start: "stand", end: "stand", seq: ["stand"], energy: 10 })}\n`,
    );
    const catPy = resolve(import.meta.dir, "../../packages/clip-catalog/catalog.py");
    const pyRes = spawnSync(
      "python",
      [
        "-c",
        "import sys, pathlib; sys.path.insert(0, sys.argv[1]); import catalog; catalog.ROOT = pathlib.Path(sys.argv[2]); print('\\n'.join(r['ref'] for r in catalog.rows(['mixamo'])))",
        dirname(catPy),
        catErrDir,
      ],
      { encoding: "utf8" },
    );
    expect(pyRes.status).toBe(0);
    expect(pyRes.stdout).toContain("mixamo/Idle_00000002");
  } finally {
    rmSync(catErrDir, { recursive: true, force: true });
  }
});

test("Round 18: catalog.py builds seq from review.json start/end overrides and comma-empty --kind/--source fail", async () => {
  const revDir = mkdtempSync(join(tmpdir(), "find-catpy-rev-"));
  try {
    mkdirSync(join(revDir, "catalog"), { recursive: true });
    writeFileSync(
      join(revDir, "catalog/mixamo.jsonl"),
      `${JSON.stringify({ ref: "mixamo/Knee_00000003", dur: 2, start: "crouch", end: "crouch", seq: [], energy: 10, loop: [0, 0], reach: 0, travel: [0, 0], turn: 0, look: 0, seen: false })}\n`,
    );
    writeFileSync(
      join(revDir, "catalog/review.json"),
      JSON.stringify({ "mixamo/Knee_00000003": { start: "sitSeat", end: "sitSeat" } }),
    );
    const catPy = resolve(import.meta.dir, "../../packages/clip-catalog/catalog.py");
    const runCat = (has: string) =>
      spawnSync(
        "python",
        [
          "-c",
          "import sys, pathlib; sys.path.insert(0, sys.argv[1]); import catalog; catalog.ROOT = pathlib.Path(sys.argv[2]); sys.argv = [sys.argv[1], '--lib', 'mixamo', '--has', sys.argv[3]]; catalog.main()",
          dirname(catPy),
          revDir,
          has,
        ],
        { encoding: "utf8" },
      );
    const hit = runCat("sitSeat");
    expect(hit.status).toBe(0);
    expect(hit.stdout).toContain("mixamo/Knee_00000003");
    const stale = runCat("crouch");
    expect(stale.status).toBe(0);
    expect(stale.stdout).not.toContain("mixamo/Knee_00000003");
  } finally {
    rmSync(revDir, { recursive: true, force: true });
  }

  const tinyPool: Entry[] = [
    { ...e("snd_hit", "Door Slam", "wooden bang", "sfx", "impacts"), secs: 1 },
  ];
  await expect(run(["door", "--kind", ","], tinyPool, noJev)).rejects.toThrow(/--kind/);
  await expect(run(["door", "--source", ","], tinyPool, noJev)).rejects.toThrow(/--source/);
});

test("Round 19: catalog.py splits camelCase and strips prop none, rerank drops 0.0, find handles spaced --kind and empty --jev misses", async () => {
  const revDir = mkdtempSync(join(tmpdir(), "find-catpy-r19-"));
  try {
    mkdirSync(join(revDir, "catalog"), { recursive: true });
    writeFileSync(
      join(revDir, "catalog/ual2.jsonl"),
      `${JSON.stringify({ ref: "ual2/TreeChopping_Loop", dur: 2, start: "stand", end: "stand", seq: ["stand"], energy: 30, loop: [0, 0], reach: 0, travel: [0, 0], turn: 0, look: 0, seen: true })}\n`,
    );
    writeFileSync(
      join(revDir, "catalog/review.json"),
      JSON.stringify({ "ual2/TreeChopping_Loop": { prop: ["none"] } }),
    );
    const catPy = resolve(import.meta.dir, "../../packages/clip-catalog/catalog.py");
    const runCat = (words: string[]) =>
      spawnSync(
        "python",
        [
          "-c",
          "import sys, pathlib; sys.path.insert(0, sys.argv[1]); import catalog; catalog.ROOT = pathlib.Path(sys.argv[2]); sys.argv = [sys.argv[1], '--lib', 'ual2', *sys.argv[3:]]; catalog.main()",
          dirname(catPy),
          revDir,
          ...words,
        ],
        { encoding: "utf8" },
      );
    const camelHit = runCat(["chopping"]);
    expect(camelHit.status).toBe(0);
    expect(camelHit.stdout).toContain("ual2/TreeChopping_Loop");
    const propNone = runCat(["none"]);
    expect(propNone.status).toBe(0);
    expect(propNone.stdout).not.toContain("ual2/TreeChopping_Loop");

    const rerankOut = spawnSync(
      "python",
      [
        "-c",
        "import sys; sys.path.insert(0, sys.argv[1]); import catalog\nclass F:\n def ask(self, *a): return {'clip': {'probabilities': {'c0': 0.9, 'c1': 0.0}}}\nh = catalog.rerank(F(), 's', [{'ref':'a/A','dur':1,'start':'s','end':'s','turn':0,'reach':0,'loop':[0,0]},{'ref':'a/B','dur':1,'start':'s','end':'s','turn':0,'reach':0,'loop':[0,0]}])\nprint(len(h), h[0][1]['ref'] if h else '')",
        dirname(catPy),
      ],
      { encoding: "utf8" },
    );
    expect(rerankOut.status).toBe(0);
    expect(rerankOut.stdout.trim()).toBe("1 a/A");
  } finally {
    rmSync(revDir, { recursive: true, force: true });
  }

  const spacedOut = await run(
    ["wipe", "--kind", "transition/Wipe & Split,look", "--source", "film-stage/looks.ts"],
    presetEntries(),
    noJev,
  );
  expect(spacedOut).not.toContain("not with & Split");
  expect(spacedOut).toMatch(/--kind (['"])transition\/Wipe & Split,look\1/);

  const emptyJevErr = await run(
    ["--jev", "--kind", "transition", "completelynonexistentwords"],
    presetEntries(),
    noJev,
  );
  expect(emptyJevErr).not.toMatch(/Word matches below/i);
  expect(emptyJevErr).not.toContain("by meaning (Jev");

  const emptyJevZero = await run(
    ["--jev", "--kind", "transition", "completelynonexistentwords"],
    presetEntries(),
    async () => [],
  );
  expect(emptyJevZero).not.toMatch(/word matches below/i);
  expect(emptyJevZero).not.toContain("by meaning (Jev");

  const mockClips = async () => "0 matches";
  const mocapEmpty = await run(
    ["--kind", "mocap", "--from", "stand", "--jev", "hero"],
    [{ ...e("mixamo/Stand_1", "Stand", "idle", "mocap", "stand>stand"), data: { seq: ["stand"] } }],
    noJev,
    mockClips,
  );
  expect(mocapEmpty).not.toContain("bun run find --jev --kind mocap");
});

test("Round 20: catalog.describe keeps ual suffixes, jev.ask handles null usage, find keeps sub-kinds in category hints and accurate empty timing --jev message", async () => {
  const catPy = resolve(import.meta.dir, "../../packages/clip-catalog/catalog.py");
  const pyRes = spawnSync(
    "python",
    [
      "-c",
      [
        "import sys, io, json, urllib.request; sys.path.insert(0, sys.argv[1]); import catalog, jev",
        "base = {'dur': 1, 'start': 's', 'end': 's', 'turn': 0, 'reach': 0, 'loop': [0, 0]}",
        "print(catalog.describe({**base, 'ref': 'ual1/Pistol_Reload'}))",
        "print(catalog.describe({**base, 'ref': 'mixamo/Standing_Up_000000ab'}))",
        "class R(io.BytesIO):",
        " def __enter__(self): return self",
        " def __exit__(self, *a): pass",
        "jev.urllib.request.urlopen = lambda req, timeout=0: R(json.dumps({'answers': {'a': 1}, 'usage': None}).encode())",
        "j = jev.Jev()",
        "j.routes = [('mock', 'https://example.invalid', 'm', 'k', 1, 1)]",
        "print(j.ask('p', {'a': 'str'}))",
      ].join("\n"),
      dirname(catPy),
    ],
    { encoding: "utf8" },
  );
  expect(pyRes.status).toBe(0);
  const pyLines = pyRes.stdout.trim().split(/\r?\n/);
  expect(pyLines[0]).toContain("Pistol Reload (not checked by eye)");
  expect(pyLines[1]).toContain("Standing Up (not checked by eye)");
  expect(pyLines[2]).toContain("{'a': 1}");

  const spreadOut = await run(["fade", "--kind", "text-in"], presetEntries(), noJev);
  expect(spreadOut).toContain("--kind text-in/");
  expect(spreadOut).not.toMatch(/Narrow to one: --kind text\//);

  const holdsOut = await run(["hacker", "fade", "--kind", "text-in"], presetEntries(), noJev);
  expect(holdsOut).toContain("--kind text-in/decode-split");
  expect(holdsOut).not.toContain("--kind text/decode-split");

  const favDir = mkdtempSync(join(tmpdir(), "find-fav-r20-"));
  try {
    writeFileSync(join(favDir, "default.json"), JSON.stringify({ effects: ["anim-curve:linear"] }));
    const favs = favoriteLists(favDir);
    const out = await run(
      ["--jev", "--kind", "anim", "--fav=default", "snappy"],
      presetEntries(),
      noJev,
      undefined,
      favs,
    );
    expect(out).toContain("after hiding timing curves");
    expect(out).not.toContain("--jev without --kind");
  } finally {
    rmSync(favDir, { recursive: true, force: true });
  }
});

test("Round 22: velocity frequency docs match runtime, empty mocap gives clear message, allEntries honors soundVault/soundSources/SOURCES overrides, and mocapEntries skips null errors", async () => {
  const showVel = await run(["--show", "flash"], presetEntries(), noJev);
  expect(showVel).toContain("every 4th beat or every beat");
  expect(showVel).not.toContain("every beat or every other");

  await expect(run(["--kind", "mocap"], presetEntries(), noJev)).rejects.toThrow(
    /no indexed clips|catalogue/i,
  );
  await expect(run(["--still"], presetEntries(), noJev)).rejects.toThrow(
    /no mocap clips|catalogue/i,
  );
  await expect(run(["--from", "stand"], presetEntries(), noJev)).rejects.toThrow(
    /no mocap clips|catalogue/i,
  );

  // soundVault: false, custom soundVault, custom soundSources (except narration), SOURCES.json override
  const film = mkdtempSync(join(tmpdir(), "find-r22-film-"));
  const customVault = join(film, "my-vault");
  const wavBytes = (() => {
    const head = Buffer.alloc(44);
    head.write("RIFF", 0);
    head.writeUInt32LE(36 + 8000, 4);
    head.write("WAVEfmt ", 8);
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(1, 22);
    head.writeUInt32LE(8000, 24);
    head.writeUInt32LE(8000, 28);
    head.writeUInt16LE(1, 32);
    head.writeUInt16LE(8, 34);
    head.write("data", 36);
    head.writeUInt32LE(8000, 40);
    return Buffer.concat([head, Buffer.alloc(8000, 128)]);
  })();
  try {
    mkdirSync(join(film, "sound/sfx"), { recursive: true });
    mkdirSync(join(film, "assets/public/agent"), { recursive: true });
    mkdirSync(join(customVault, "sfx/hits"), { recursive: true });
    writeFileSync(join(film, "sound/sfx/local_beep.wav"), wavBytes);
    writeFileSync(join(film, "sound/custom_src.wav"), wavBytes);
    writeFileSync(join(film, "assets/public/agent/full_voice.wav"), wavBytes);
    writeFileSync(join(customVault, "sfx/hits/vault_clap.wav"), wavBytes);
    writeFileSync(
      join(customVault, "SOURCES.json"),
      JSON.stringify({ vault_clap: { title: "Vault Clap", license: "CC0" } }),
    );
    writeFileSync(
      join(film, "sound/sfx/SOURCES.json"),
      JSON.stringify({ vault_clap: { title: "Film Custom Clap", for: "trailer punch" } }),
    );

    // a) soundVault: false + soundSources (custom_src included, narration excluded)
    writeFileSync(
      join(film, "package.json"),
      JSON.stringify({
        "live-studio": {
          sfx: "sound/sfx",
          soundVault: false,
          soundSources: {
            custom_src: "sound/custom_src.wav",
            narration: "assets/public/agent/full_voice.wav",
          },
        },
      }),
    );
    const noVaultSounds = allEntries(true, film).filter((x) =>
      ["sfx", "bgm", "mc"].includes(x.kind),
    );
    expect(noVaultSounds.some((x) => x.id === "local_beep")).toBe(true);
    expect(noVaultSounds.some((x) => x.id === "custom_src")).toBe(true);
    expect(noVaultSounds.some((x) => x.id === "narration")).toBe(false);
    // All remaining sfx/bgm/mc come ONLY from this film (no repo vault leak)
    expect(noVaultSounds.every((x) => x.src === "this-film")).toBe(true);

    // b) custom string soundVault + SOURCES.json override onto vault sound
    writeFileSync(
      join(film, "package.json"),
      JSON.stringify({
        "live-studio": {
          sfx: "sound/sfx",
          soundVault: "my-vault",
        },
      }),
    );
    const customVaultSounds = allEntries(true, film).filter((x) => x.id === "vault_clap");
    expect(customVaultSounds).toHaveLength(1);
    expect(customVaultSounds[0]?.title).toBe("Film Custom Clap");
    expect(customVaultSounds[0]?.about).toContain("trailer punch");
  } finally {
    rmSync(film, { recursive: true, force: true });
  }

  const catDir = mkdtempSync(join(tmpdir(), "find-r22-cat-"));
  try {
    writeFileSync(
      join(catDir, "mixamo.jsonl"),
      [
        JSON.stringify({
          ref: "mixamo/Good_1",
          dur: 1,
          start: "stand",
          end: "stand",
          turn: 0,
          reach: 0,
          loop: [0, 0],
        }),
        JSON.stringify({
          ref: "mixamo/ErrNull_1",
          error: null,
          dur: 1,
          start: "stand",
          end: "stand",
          turn: 0,
          reach: 0,
          loop: [0, 0],
        }),
      ].join("\n"),
    );
    const clips = mocapEntries(catDir);
    expect(clips.map((c) => c.id)).toEqual(["mixamo/Good_1"]);
  } finally {
    rmSync(catDir, { recursive: true, force: true });
  }
});

test("Round 23: anim-combo show omits unused len while anim-in keeps it, and catalog.py matches inflected words", async () => {
  const presets = presetEntries();
  const combo = presets.find((e) => e.kind === "anim-combo")!;
  const animIn = presets.find((e) => e.kind === "anim-in")!;

  const showCombo = await run(["--show", combo.id, "--kind", "anim-combo"], presets, noJev);
  expect(showCombo).toContain(`"fx": "${combo.id}"`);
  expect(showCombo).not.toContain('"len"');

  const showIn = await run(["--show", animIn.id, "--kind", "anim-in"], presets, noJev);
  expect(showIn).toContain('"len"');

  const catScript = resolve(import.meta.dir, "../../packages/clip-catalog/catalog.py");
  const catDir = mkdtempSync(join(tmpdir(), "find-catpy-stem-"));
  try {
    mkdirSync(join(catDir, "catalog"), { recursive: true });
    writeFileSync(
      join(catDir, "catalog/mixamo.jsonl"),
      [
        {
          ref: "mixamo/Sit_00000001",
          dur: 2,
          start: "sitSeat",
          end: "sitSeat",
          seq: ["sitSeat"],
          energy: 5,
          loop: [0, 0],
          reach: 0,
          travel: [0, 0],
          turn: 0,
          look: 0,
        },
        {
          ref: "mixamo/Walk_Forward_00000002",
          dur: 2,
          start: "stand",
          end: "stand",
          seq: ["stand"],
          energy: 30,
          loop: [0, 0],
          reach: 1.5,
          travel: [0, 1.5],
          turn: 0,
          look: 0,
        },
        {
          ref: "mixamo/Disposition_00000003",
          dur: 2,
          start: "stand",
          end: "stand",
          seq: ["stand"],
          energy: 10,
          loop: [0, 0],
          reach: 0,
          travel: [0, 0],
          turn: 0,
          look: 0,
        },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n"),
    );
    for (const [word, expected] of [
      ["sitting", /mixamo\/Sit_00000001/],
      ["walking", /mixamo\/Walk_Forward_00000002/],
      ["walks", /mixamo\/Walk_Forward_00000002/],
      ["walked", /mixamo\/Walk_Forward_00000002/],
    ] as const) {
      const res = spawnSync(
        "python",
        [
          "-c",
          "import sys, pathlib; sys.path.insert(0, sys.argv[1]); import catalog; catalog.ROOT = pathlib.Path(sys.argv[2]); sys.argv = ['catalog.py', '--lib', 'mixamo', sys.argv[3]]; catalog.main()",
          dirname(catScript),
          catDir,
          word,
        ],
        { encoding: "utf8" },
      );
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(expected);
      expect(res.stdout).not.toContain("Disposition");
    }
  } finally {
    rmSync(catDir, { recursive: true, force: true });
  }
});

test("find uses the same soundSources override as the Studio", () => {
  const film = mkdtempSync(join(tmpdir(), "find-source-priority-"));
  try {
    mkdirSync(join(film, "sound"));
    mkdirSync(join(film, "assets"));
    for (const [file, duration] of [
      ["sound/hit.wav", 1],
      ["assets/hit.wav", 2],
    ] as const) {
      const made = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", `sine=d=${duration}`, join(film, file)],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(made.status, made.stderr).toBe(0);
    }
    const conf = {
      soundTimeline: "audio.json",
      sfx: "sound",
      soundVault: false,
      soundSources: { hit: "assets/hit.wav" },
    };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    const hits = allEntries(true, film).filter((x) => x.id === "hit");
    const studio = openSound(film, conf);
    expect(hits).toHaveLength(1);
    expect(resolve(film, hits[0]!.data!.file!)).toBe(studio.fileOf("hit")!);
    expect(hits[0]!.secs).toBe(studio.library().find((x) => x.name === "hit")!.seconds);
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("find groups local sounds by SOURCES metadata as the Studio does", async () => {
  const film = mkdtempSync(join(tmpdir(), "find-source-category-"));
  try {
    mkdirSync(join(film, "sound"));
    const made = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(film, "sound/hit.wav")],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const conf = { soundTimeline: "audio.json", sfx: "sound", soundVault: false };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(
      join(film, "sound/SOURCES.json"),
      JSON.stringify({ hit: { category: "impacts" } }),
    );
    const entries = allEntries(true, film);
    expect(entries.find((x) => x.id === "hit")!.cat).toBe(
      openSound(film, conf)
        .library()
        .find((x) => x.name === "hit")!.category!,
    );
    expect(await run(["--kind", "sfx/impacts"], entries, noJev)).toContain("hit");
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("find's dollyZoom snippet executes with the imports it prints", async () => {
  const shown = await run(["--show", "dollyZoom"], presetEntries(), noJev);
  const code = shown
    .split("\n")
    .find((line) => line.includes("use: src/scene.ts"))!
    .split("src/scene.ts")[1]!
    .trim();
  const url = pathToFileURL(resolve(import.meta.dir, "../../packages/film-kit/src/lens.ts")).href;
  const result = spawnSync(
    process.execPath,
    ["-e", `${code.replace("'film-kit/lens'", JSON.stringify(url))}; console.log(d1);`],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(Number(result.stdout.trim())).toBeGreaterThan(0);
});

test("find keeps local provider origin for folder and soundSources entries", async () => {
  const film = mkdtempSync(join(tmpdir(), "find-local-origin-"));
  try {
    mkdirSync(join(film, "sound"));
    for (const name of ["localTone", "customTone"]) {
      const made = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(film, `sound/${name}.wav`)],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(made.status, made.stderr).toBe(0);
    }
    const conf = {
      soundTimeline: "audio.json",
      sfx: "sound",
      soundVault: false,
      soundSources: { customTone: "sound/customTone.wav" },
    };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(
      join(film, "sound/SOURCES.json"),
      JSON.stringify({ localTone: { source: "earshot" }, customTone: { source: "earshot" } }),
    );
    const entries = allEntries(true, film);
    const found = await run(["--origin", "synth"], entries, noJev);
    for (const id of ["localTone", "customTone"]) {
      expect(found).toContain(id);
      expect(entries.find((x) => x.id === id)!.src).toBe("this-film");
    }
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("find custom vault discovery and metadata match the Studio at nested depths", () => {
  const film = mkdtempSync(join(tmpdir(), "find-vault-parity-"));
  try {
    const vault = join(film, "my-vault");
    for (const [file, duration] of [
      ["sfx/raw/vaultTone.wav", 2],
      ["bgm/chill/deep/nestedTone.wav", 3],
    ] as const) {
      mkdirSync(dirname(join(vault, file)), { recursive: true });
      const made = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", `sine=d=${duration}`, join(vault, file)],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(made.status, made.stderr).toBe(0);
    }
    const conf = { soundTimeline: "audio.json", sfx: "sound", soundVault: "my-vault" };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(
      join(vault, "SOURCES.json"),
      JSON.stringify({ vaultTone: { kind: "bgm", category: "electronic" } }),
    );
    const entries = allEntries(true, film);
    const studio = openSound(film, conf).library();
    for (const id of ["vaultTone", "nestedTone"]) {
      const actual = entries.find((x) => x.id === id);
      const expected = studio.find((x) => x.name === id)!;
      expect(actual).toBeDefined();
      expect([actual!.kind, actual!.cat, actual!.secs]).toEqual([
        expected.kind,
        expected.category,
        expected.seconds,
      ]);
    }
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("find local duplicate IDs describe the same file the Studio plays", () => {
  const film = mkdtempSync(join(tmpdir(), "find-local-duplicate-"));
  try {
    for (const [file, duration] of [
      ["sound/a/tap.ogg", 1],
      ["sound/z/tap.wav", 2],
    ] as const) {
      mkdirSync(dirname(join(film, file)), { recursive: true });
      const made = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", `sine=d=${duration}`, join(film, file)],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(made.status, made.stderr).toBe(0);
    }
    const conf = { soundTimeline: "audio.json", sfx: "sound", soundVault: false };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    const entry = allEntries(true, film).find((x) => x.id === "tap")!;
    const studio = openSound(film, conf);
    expect(resolve(film, entry.data!.file!)).toBe(studio.fileOf("tap")!);
    expect(entry.secs).toBe(studio.library().find((x) => x.name === "tap")!.seconds);
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("local replacements inherit vault metadata and attribution as the Studio does", async () => {
  const film = mkdtempSync(join(tmpdir(), "find-inherited-metadata-"));
  try {
    for (const file of ["sound/shared.wav", "my-vault/bgm/electronic/shared.wav"]) {
      mkdirSync(dirname(join(film, file)), { recursive: true });
      const made = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(film, file)],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(made.status, made.stderr).toBe(0);
    }
    const conf = { soundTimeline: "audio.json", sfx: "sound", soundVault: "my-vault" };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(
      join(film, "my-vault/SOURCES.json"),
      JSON.stringify({
        shared: {
          title: "Shared theme",
          kind: "bgm",
          category: "electronic",
          license: "CC BY 4.0",
          family: "theme-takes",
          variant: 1,
        },
      }),
    );
    const entries = allEntries(false, film);
    const found = entries.find((x) => x.id === "shared")!;
    const expected = openSound(film, conf)
      .library()
      .find((x) => x.name === "shared")!;
    expect([found.kind, found.cat, found.title, found.data!.license, found.data!.family]).toEqual([
      expected.kind,
      expected.category,
      expected.title,
      expected.license,
      expected.family,
    ]);
    expect(found.src).toBe("this-film");
    expect(await run(["--license", "credit"], entries, noJev)).toContain("shared");
    await expect(run(["--license", "free"], entries, noJev)).rejects.toThrow(/nothing/);
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("find reads UTF-8 BOM sound metadata as the Studio does", () => {
  const film = mkdtempSync(join(tmpdir(), "find-bom-metadata-"));
  try {
    mkdirSync(join(film, "sound"));
    const made = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(film, "sound/tone.wav")],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const conf = { soundTimeline: "audio.json", sfx: "sound", soundVault: false };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(
      join(film, "sound/SOURCES.json"),
      "\uFEFF" + JSON.stringify({ tone: { license: "CC BY 4.0" } }),
    );
    const expected = openSound(film, conf)
      .library()
      .find((x) => x.name === "tone")!;
    expect(allEntries(true, film).find((x) => x.id === "tone")!.data!.license).toBe(
      expected.license!,
    );
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("body filters read BOM review metadata accepted by word search", async () => {
  const root = mkdtempSync(join(tmpdir(), "find-bom-review-"));
  try {
    mkdirSync(join(root, "catalog"));
    const ref = "mixamo/Idle_12345678";
    writeFileSync(
      join(root, "catalog/mixamo.jsonl"),
      JSON.stringify({
        ref,
        dur: 2,
        start: "stand",
        end: "stand",
        seq: ["stand"],
        energy: 1,
        loop: [0, 0],
        reach: 0,
        travel: [0, 0],
        turn: 0,
        look: 0,
      }) + "\n",
    );
    writeFileSync(
      join(root, "catalog/review.json"),
      "\uFEFF" +
        JSON.stringify({
          [ref]: { desc: "seated and calm", start: "sitSeat", end: "sitSeat", seq: ["sitSeat"] },
        }),
    );
    const entries = mocapEntries(join(root, "catalog"));
    const catalogue = async (args: string[]) => {
      const py = spawnSync(
        "python",
        [
          "-B",
          "-c",
          "import sys,pathlib;sys.path.insert(0,sys.argv[1]);import catalog;catalog.ROOT=pathlib.Path(sys.argv[2]);sys.argv=['catalog.py',*sys.argv[3:]];catalog.main()",
          resolve(import.meta.dir, "../../packages/clip-catalog"),
          root,
          ...args,
        ],
        { encoding: "utf8", timeout: 10000 },
      );
      if (py.status !== 0) throw new Error(py.stderr);
      return py.stdout + py.stderr;
    };
    expect(await run(["seated", "--kind", "mocap"], entries, noJev, catalogue)).toContain(ref);
    expect(await run(["--from", "sitSeat"], entries, noJev, catalogue)).toContain(ref);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("find names malformed film JSON and the recovery command without a stack trace", () => {
  const root = mkdtempSync(join(tmpdir(), "find-json-error-"));
  try {
    writeFileSync(join(root, "package.json"), "{ broken");
    const cli = spawnSync(
      process.execPath,
      [resolve(import.meta.dir, "../find.ts"), "--kind", "transition"],
      { cwd: root, encoding: "utf8", timeout: 10000 },
    );
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain("package.json");
    expect(cli.stderr).toContain("bun run check");
    expect(cli.stderr).not.toMatch(/\n\s+at /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("find probes a vault file when its cached duration is not numeric", () => {
  const vault = mkdtempSync(join(tmpdir(), "find-peak-seconds-"));
  try {
    const made = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(vault, "tone.wav")],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    writeFileSync(join(vault, "PEAKS.json"), JSON.stringify({ tone: { seconds: "0.5" } }));
    expect(vaultSounds([vault]).find((x) => x.name === "tone")!.seconds).toBe(1);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("empty favourites still reject invalid filter values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "find-empty-validation-"));
  try {
    const favs = favoriteLists(dir);
    const pool = [{ ...e("tone", "Tone"), src: "mixkit" }];
    for (const flag of ["--kind", "--source", "--origin", "--edition", "--license"])
      await expect(
        run(["--fav", flag, "bogus"], pool, noJev, undefined, favs),
      ).rejects.toMatchObject({ code: 2 });
    expect(await run(["--fav", "--kind", "sfx"], pool, noJev, undefined, favs)).toContain(
      "nothing is starred",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("find help takes precedence over parsing and the paid judge", async () => {
  let calls = 0;
  const judge = async () => {
    calls++;
    return [];
  };
  const pool = [e("tone", "Tone")];
  const help = await run(["--help"], pool, judge);
  expect(await run(["help", "--jev", "--kind", "sfx"], pool, judge)).toBe(help);
  expect(calls).toBe(0);
  const cli = spawnSync(
    process.execPath,
    [resolve(import.meta.dir, "../find.ts"), "--help", "--bogus"],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(cli.status, cli.stderr).toBe(0);
  expect(cli.stdout.trim()).toBe(help.trim());
});

test("find earshot commands preserve literal sound paths in pasted shell commands", async () => {
  const paths = ["sound/(preview)/tone.wav", "my vault/a'b$voice.wav"];
  const pool = [
    { ...e("tone", "Tone"), data: { file: paths[0] } },
    { ...e("tone-alt", "Tone alternative"), data: { file: paths[1] } },
  ];
  for (const [i, entry] of pool.entries()) {
    const shown = await run(["--show", entry.id], pool, noJev);
    expect(pastedArgs(shown.match(/hear it: (earshot describe .+)/)![1]!)).toEqual([
      "describe",
      paths[i],
    ]);
  }
  const listed = await run(["tone"], pool, noJev);
  expect(
    pastedArgs(listed.match(/hear them \(you cannot\): (earshot rank .+? --top 3)/)![1]!),
  ).toEqual(["rank", "tone", ...paths, "--top", "3"]);
});

test.each(["earshot", "bun"] as const)(
  "printed %s queries survive pasting literally",
  async (tool) => {
    const query = '$([math]::Abs(-7)) impact "sharp edge"';
    if (tool === "earshot") {
      const sounds = ["impact-a", "impact-b"].map((id) => ({
        ...e(id, "Impact"),
        data: { file: `sound/${id}.wav` },
      }));
      const list = await run([query], sounds, noJev);
      expect(
        pastedArgs(list.match(/hear them \(you cannot\): (earshot rank .+? --top 3)/)![1]!)[1],
      ).toBe(query);
    } else {
      const miss = await run(
        [query, "--kind", "transition"],
        [e("dissolve", "Dissolve", "", "transition")],
        noJev,
      );
      const command = miss.match(/bun run find --jev --kind transition .+/)![0]!;
      expect(pastedArgs(command, "bun")).toEqual([
        "run",
        "find",
        "--jev",
        "--kind",
        "transition",
        query,
      ]);
    }
  },
);

test("catalogue process failures reject with a nonzero error and recovery", async () => {
  const clip = {
    ...e("mixamo/Idle_12345678", "Idle", "", "mocap", "stand"),
    data: { seq: ["stand"] },
  };
  const clips = async () => {
    throw new Error("spawn python ENOENT");
  };
  await expect(run(["--from", "stand"], [clip], noJev, clips)).rejects.toMatchObject({
    code: 1,
    message: expect.stringMatching(/mocap catalogue failed.*ENOENT.*Words alone still work/),
  });
});

test.each(['"sharp edge"', 'path "sharp edge"\\', 'a\\"sharp edge"'])(
  "native command queries preserve quote/backslash combinations: %s",
  async (query) => {
    const sounds = ["sharp-a", "sharp-b"].map((id) => ({
      ...e(id, "Sharp edge"),
      data: { file: `sound/${id}.wav` },
    }));
    const list = await run([query], sounds, noJev);
    expect(
      pastedArgs(list.match(/hear them \(you cannot\): (earshot rank .+? --top 3)/)![1]!)[1],
    ).toBe(query);
  },
);

test("comma filters trim token edges while preserving category spaces", async () => {
  const presets = presetEntries();
  for (const [option, spaced, compact] of [
    ["--source", "film-stage, film-kit", "film-stage,film-kit"],
    ["--kind", "transition, look", "transition,look"],
    ["--kind", "transition/Wipe & Split, look", "transition/Wipe & Split,look"],
  ]) {
    expect(await run([option!, spaced!, "-n", "2"], presets, noJev)).toBe(
      await run([option!, compact!, "-n", "2"], presets, noJev),
    );
  }
});

test("rejected semantic mocap candidates end with action recovery", async () => {
  const clip = {
    ...e("mixamo/Idle_12345678", "Idle", "", "mocap", "stand"),
    data: { seq: ["stand"] },
  };
  const rejected = "1.00 fits 0.10 mixamo/Idle_12345678 2s stand travel 0,0 turn 0";
  const output = await run(
    ["--jev", "--kind", "mocap", "hop away"],
    [clip],
    noJev,
    async () => rejected,
  );
  expect(output).toContain(rejected);
  expect(output).toMatch(/next:.*(?:do not fit|no .*fits|rejected).*\n?/i);
  expect(output).toMatch(/rephrase/i);
  expect(output).toMatch(/key .*body|retarget/i);
});

test("malformed mocap and sweep JSONL errors identify the file and line", () => {
  const dir = mkdtempSync(join(tmpdir(), "find-broken-jsonl-"));
  try {
    const row = JSON.stringify({
      ref: "mixamo/Idle_12345678",
      dur: 2,
      start: "stand",
      end: "stand",
    });
    for (const filename of ["mixamo.jsonl", "sweep_mixamo.jsonl"]) {
      writeFileSync(join(dir, "mixamo.jsonl"), row + "\n");
      const first = filename.startsWith("sweep_")
        ? JSON.stringify({ clip: "Idle_12345678", s: {} })
        : row;
      writeFileSync(join(dir, filename), first + "\n{\n");
      let fault: any;
      try {
        mocapEntries(dir);
      } catch (error) {
        fault = error;
      }
      expect(fault?.code).toBe(1);
      expect(fault?.message).toContain(`${filename}:2: not valid JSON`);
      expect(fault?.message).toMatch(/Fix|repair|rebuild/i);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("find usage points to the film's configured timeline files", async () => {
  const film = mkdtempSync(join(tmpdir(), "find-configured-usage-"));
  const before = process.cwd();
  try {
    writeFileSync(
      join(film, "package.json"),
      JSON.stringify({
        "live-studio": { soundTimeline: "data/soundtrack.json", shotsTimeline: "data/cuts.json" },
      }),
    );
    process.chdir(film);
    const tone = e("tone", "Tone");
    const output = [
      await run(["--show", "tone"], [tone]),
      await run(["--show", "dissolve"], presetEntries()),
      await run(["tone"], [tone]),
    ].join("\n");
    expect(output).toContain("use: data/soundtrack.json sfx[]");
    expect(output).toContain("use: data/cuts.json the shot after the cut");
    expect(output).toMatch(/where:[\s\S]*data\/soundtrack\.json/);
    expect(output).not.toMatch(/src\/timeline\/(?:audio|shots)\.json/);
  } finally {
    process.chdir(before);
    rmSync(film, { recursive: true, force: true });
  }
});

test("render hints pass their flags through the native shell", async () => {
  const dir = mkdtempSync(join(tmpdir(), "find-render-hints-"));
  try {
    const windows = process.platform === "win32";
    writeFileSync(
      join(dir, windows ? "bun.cmd" : "bun"),
      windows
        ? '@echo off\r\necho {"args":"%*"}\r\n'
        : '#!/bin/sh\nprintf \'{"args":"%s"}\\n\' "$*"\n',
      { mode: 0o755 },
    );
    const clip = e("mixamo/Idle_12345678", "Idle", "", "mocap", "stand");
    for (const [entry, pool] of [
      ["dissolve", presetEntries()],
      [clip.id, [clip]],
    ] as const) {
      const shown = await run(["--show", entry], [...pool], noJev);
      const command = shown
        .match(/^see it: (.+?)  \(in a film folder\)/m)![1]!
        .replace(/<[^>]+>/g, "1.25");
      const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); ${command}`;
      const options = {
        cwd: dir,
        encoding: "utf8" as const,
        timeout: 25000,
        env: {
          ...process.env,
          PATH: [dir, process.env.PATH].join(delimiter),
        },
      };
      const result = windows
        ? spawnSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-EncodedCommand",
              Buffer.from(script, "utf16le").toString("base64"),
            ],
            options,
          )
        : spawnSync("sh", ["-c", command], options);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(
        entry === "dissolve"
          ? { args: "run render stills --at 1.25" }
          : { args: `run render stills --entry lab/clip.ts --lab clip=${clip.id}` },
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const withFamilyFilm = async (inspect: (film: string) => Promise<void>) => {
  const film = mkdtempSync(join(tmpdir(), "find-eligible-family-"));
  const before = process.cwd();
  try {
    mkdirSync(join(film, "sound"));
    mkdirSync(join(film, "my-vault/mc/blocks"), { recursive: true });
    writeFileSync(
      join(film, "package.json"),
      JSON.stringify({
        "live-studio": { soundTimeline: "audio.json", sfx: "sound", soundVault: "my-vault" },
      }),
    );
    writeFileSync(join(film, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));
    const made = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(film, "sound/pulse-real.wav")],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const wav = readFileSync(join(film, "sound/pulse-real.wav"));
    for (const file of [
      "sound/pulse-synth.wav",
      "sound/door-local.wav",
      "my-vault/mc/blocks/door-vault.wav",
    ])
      writeFileSync(join(film, file), wav);
    writeFileSync(
      join(film, "sound/SOURCES.json"),
      JSON.stringify({
        "pulse-real": {
          kind: "sfx",
          category: "early",
          family: "pulse",
          variant: 1,
          title: "Pulse",
          origin: "real",
          license: "CC BY 4.0",
        },
        "pulse-synth": {
          kind: "sfx",
          category: "late",
          family: "pulse",
          variant: 2,
          title: "Pulse",
          origin: "synth",
          license: "CC0",
        },
        "door-local": {
          kind: "mc",
          category: "blocks",
          family: "door",
          variant: 1,
          title: "Knock",
          license: "CC0",
        },
      }),
    );
    writeFileSync(
      join(film, "my-vault/SOURCES.json"),
      JSON.stringify({
        "door-vault": {
          kind: "mc",
          category: "blocks",
          family: "door",
          variant: 2,
          title: "Knock",
          source: "minecraft",
          license: "CC BY 4.0",
        },
      }),
    );
    process.chdir(film);
    await inspect(film);
  } finally {
    process.chdir(before);
    rmSync(film, { recursive: true, force: true });
  }
};

test.each([
  ["--source", "minecraft", "knock", "mc", "door-vault"],
  ["--edition", "vanilla", "knock", "mc", "door-vault"],
  ["--origin", "synth", "pulse", "sfx", "pulse-synth"],
  ["--license", "free", "pulse", "sfx", "pulse-synth"],
  ["--license", "cc0", "pulse", "sfx", "pulse-synth"],
] as const)(
  "family selection applies %s %s to each take",
  async (option, value, query, kind, id) => {
    await withFamilyFilm(async () => {
      const output = await run([query, "--kind", kind, option, value], undefined, noJev);
      expect(output).toContain(id);
      expect(output).not.toContain("(2 takes)");
      if (id === "pulse-synth") expect(output).not.toContain("pulse-real");
    });
  },
);

test("family kind filters, conjunctions, favourites and full details stay coherent", async () => {
  await withFamilyFilm(async (film) => {
    expect(await run(["pulse", "--kind", "sfx/late"], undefined, noJev)).toContain("pulse-synth");
    await expect(
      run(
        ["knock", "--kind", "mc", "--source", "minecraft", "--license", "free"],
        undefined,
        noJev,
      ),
    ).rejects.toThrow(/keeps nothing|none of it/);
    const detail = await run(["--show", "door-vault"], undefined, noJev);
    expect(detail).toContain("door-local");
    expect(detail).toContain("door-vault");
    const favDir = join(film, "favorites");
    mkdirSync(favDir);
    writeFileSync(
      join(favDir, "default.json"),
      JSON.stringify({ sounds: ["door-local"], effects: [] }),
    );
    expect(
      await run(
        ["knock", "--kind", "mc", "--source", "minecraft", "--fav"],
        undefined,
        noJev,
        undefined,
        favoriteLists(favDir),
      ),
    ).toContain("door-vault");
    await expect(run(["--source"], undefined, noJev)).rejects.toThrow(/minecraft 1/);
    await expect(run(["--kind"], undefined, noJev)).rejects.toThrow(/sfx 1/);
  });
});

test("family variation advice describes the selected take without assigning variant one", async () => {
  const family = soundEntries(
    [
      { name: "pulse-long", family: "pulse", variant: 1, title: "Pulse", seconds: 1.5 },
      { name: "pulse-short", family: "pulse", variant: 2, title: "Pulse", seconds: 0.5 },
      { name: "pulse-tiny", family: "pulse", variant: 3, title: "Pulse", seconds: 0.25 },
    ],
    true,
    [0, 1],
  );
  const output = await run(["pulse", "--dur", "0-1"], family, noJev);
  expect(output).toContain("pulse-short");
  expect(output).toContain("the id shown plays as is");
  expect(output).not.toContain("the id shown is take 1");
});

test("find uses Studio metadata fallbacks for vault overrides", async () => {
  const film = mkdtempSync(join(tmpdir(), "find-vault-fallback-"));
  try {
    mkdirSync(join(film, "sound"));
    mkdirSync(join(film, "my-vault/bgm/chill"), { recursive: true });
    const made = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(film, "my-vault/bgm/chill/music.wav")],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const conf = { soundTimeline: "audio.json", sfx: "sound", soundVault: "my-vault" };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(
      join(film, "my-vault/SOURCES.json"),
      JSON.stringify({ music: { kind: "sfx", category: "foley", title: "Music" } }),
    );
    writeFileSync(
      join(film, "sound/SOURCES.json"),
      JSON.stringify({ music: { kind: null, category: null } }),
    );
    const entries = allEntries(false, film);
    const found = entries.find((x) => x.id === "music")!;
    const expected = openSound(film, conf)
      .library()
      .find((x) => x.name === "music")!;
    expect([found.kind, found.cat, found.title]).toEqual([
      expected.kind,
      expected.category,
      expected.title,
    ]);
    expect(await run(["music", "--kind", "bgm/chill"], entries, noJev)).toContain("music");
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("ordinary mocap words include eye-checked acting styles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "find-reviewed-style-"));
  try {
    const ref = "mixamo/Idle_c9c00005";
    writeFileSync(
      join(dir, "mixamo.jsonl"),
      JSON.stringify({ ref, dur: 2, start: "stand", end: "stand" }) + "\n",
    );
    writeFileSync(
      join(dir, "review.json"),
      JSON.stringify({ [ref]: { desc: "waits and looks ahead", style: ["cartoonish"] } }),
    );
    expect(await run(["cartoonish", "--kind", "mocap"], mocapEntries(dir), noJev)).toContain(ref);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("duration search finds shorter takes in a folded sound family", () => {
  const film = mkdtempSync(join(tmpdir(), "find-family-duration-"));
  try {
    mkdirSync(join(film, "sound"));
    writeFileSync(
      join(film, "package.json"),
      JSON.stringify({
        "live-studio": { soundTimeline: "audio.json", sfx: "sound", soundVault: false },
      }),
    );
    const sources: Record<string, unknown> = {};
    for (const [name, seconds, variant] of [
      ["pulse-long", 1.5, 1],
      ["pulse-short", 0.5, 2],
    ] as const) {
      const made = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", `sine=d=${seconds}`, join(film, `sound/${name}.wav`)],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(made.status, made.stderr).toBe(0);
      sources[name] = { kind: "sfx", title: "Pulse", family: "pulse", variant };
    }
    writeFileSync(join(film, "sound/SOURCES.json"), JSON.stringify(sources));
    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dir, "../find.ts"), "pulse", "--kind", "sfx", "--dur", "0-1"],
      { cwd: film, encoding: "utf8", timeout: 10000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("pulse-short");
    expect(result.stdout).not.toContain("pulse-long");
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("find ignores null optional sound metadata as the Studio does", () => {
  const film = mkdtempSync(join(tmpdir(), "find-null-metadata-"));
  try {
    mkdirSync(join(film, "sound"));
    const made = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(film, "sound/tone.wav")],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const conf = { soundTimeline: "audio.json", sfx: "sound", soundVault: false };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(join(film, "sound/SOURCES.json"), "null");
    const expected = openSound(film, conf)
      .library()
      .find((x) => x.name === "tone")!;
    expect(allEntries(true, film).find((x) => x.id === "tone")!.secs).toBe(expected.seconds);
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("find retains the default vault source used by the Studio", async () => {
  const film = mkdtempSync(join(tmpdir(), "find-vault-source-"));
  try {
    mkdirSync(join(film, "my-vault/sfx"), { recursive: true });
    const made = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(film, "my-vault/sfx/tone.wav")],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const conf = { soundTimeline: "audio.json", sfx: "sound", soundVault: "my-vault" };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    const expected = openSound(film, conf)
      .library()
      .find((x) => x.name === "tone")!;
    const entries = allEntries(true, film);
    expect(entries.find((x) => x.id === "tone")!.src).toBe(expected.source!);
    expect(await run(["--source", "vault"], entries, noJev)).toContain("tone");
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("find excludes vault IDs rejected by the resolver and missing explicit overrides", () => {
  const film = mkdtempSync(join(tmpdir(), "find-resolvable-vault-"));
  try {
    mkdirSync(join(film, "my-vault/sfx"), { recursive: true });
    for (const name of ["hit", "bad name"]) {
      const made = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(film, `my-vault/sfx/${name}.wav`)],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(made.status, made.stderr).toBe(0);
    }
    const conf = {
      soundTimeline: "audio.json",
      sfx: "sound",
      soundVault: "my-vault",
      soundSources: { hit: "assets/missing.wav" },
    };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    expect(openSound(film, conf).library()).toEqual([]);
    expect(allEntries(true, film).filter((x) => ["hit", "bad name"].includes(x.id))).toEqual([]);
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

const searchableFamily = () =>
  soundEntries(
    [
      {
        name: "pulse-soft",
        title: "Soft pulse",
        category: "early",
        family: "pulse",
        variant: 1,
        kind: "sfx",
      },
      {
        name: "pulse-glint",
        title: "Sharp pulse",
        for: "metallic resonance",
        category: "late",
        family: "pulse",
        variant: 2,
        kind: "sfx",
      },
    ],
    false,
  );

test.each(["sharp", "resonance", "late", "glint"])(
  "family word search finds a matching later take: %s",
  async (query) => {
    const output = await run([query, "--kind", "sfx"], searchableFamily(), noJev);
    const rows = output.split("\n").filter((line) => line.startsWith("sfx/"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("pulse-glint");
    expect(output).not.toContain("no entry");
  },
);

test("family word results stay unique and browsing keeps the first take", async () => {
  const family = searchableFamily();
  const browse = await run(["--kind", "sfx"], family, noJev);
  const search = await run(["pulse", "--kind", "sfx"], family, noJev);
  for (const output of [browse, search]) {
    const rows = output.split("\n").filter((line) => line.startsWith("sfx/"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("(2 takes)");
  }
  expect(browse.split("\n").find((line) => line.startsWith("sfx/"))).toContain("pulse-soft");
});

test("comma detail and favourite ids trim token edges", async () => {
  const presets = presetEntries();
  expect(await run(["--show", " dissolve, push "], presets, noJev)).toBe(
    await run(["--show", "dissolve,push"], presets, noJev),
  );
  await withFavorites({ default: {} }, async (favs) => {
    await run(["--star", " boom, thud ", "--kind", "sfx"], starredPool(), noJev, undefined, favs);
    expect(favs.open("default").read().sounds.toSorted()).toEqual(["boom", "thud"]);
    await run(["--unstar", "boom, thud", "--kind", "sfx"], starredPool(), noJev, undefined, favs);
    expect(favs.open("default").read().sounds).toEqual([]);
    for (const option of ["--show", "--star", "--unstar"])
      await expect(run([option, " , "], presets, noJev, undefined, favs)).rejects.toThrow(
        /needs an id/,
      );
  });
});

test("FOUND reports the selected entry's own fit when both candidates pass", async () => {
  const pool = [e("leader", "Leader"), e("runner", "Runner")];
  const output = await run(["query", "--jev", "--kind", "sfx"], pool, async () => [
    [0.8, pool[0]!, 0.75],
    [0.2, pool[1]!, 0.95],
  ]);
  expect(output).toContain("FOUND: leader (fit 0.75)");
  expect(output).toMatch(/fits 0\.95\s+sfx\s+runner/);
});

test("catalogue readers use the latest measurement and sweep for each clip", () => {
  const root = mkdtempSync(join(tmpdir(), "find-latest-jsonl-"));
  try {
    const dir = join(root, "catalog");
    mkdirSync(dir);
    const rows = [
      { ref: "mixamo/Walk", dur: 1 },
      { ref: "mixamo/Walk", dur: 3 },
      { ref: "mixamo/Rest", dur: 1 },
      { ref: "mixamo/Rest", error: "measurement failed" },
      { ref: "mixamo/Spin", dur: 2 },
    ];
    writeFileSync(join(dir, "mixamo.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n"));
    writeFileSync(
      join(dir, "review.json"),
      JSON.stringify({ "mixamo/Walk": { flaw: "hand clips" } }),
    );
    writeFileSync(
      join(dir, "sweep_mixamo.jsonl"),
      [
        { clip: "Walk", s: { "spin forearm L": [90, 1.2] } },
        { clip: "Walk", s: {} },
        { clip: "Spin", s: { "spin forearm L": [90, 0.5] } },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    const ts = mocapEntries(dir).map((entry) => [entry.id, entry.secs, entry.note ?? null]);
    const py = spawnSync(
      "python",
      [
        "-B",
        "-c",
        "import sys,pathlib,json;sys.path.insert(0,sys.argv[1]);import catalog;catalog.ROOT=pathlib.Path(sys.argv[2]);print(json.dumps([[r['ref'],r.get('dur'),('flaw: '+r['flaw']) if r.get('flaw') else None] for r in catalog.rows(['mixamo'])]))",
        resolve(import.meta.dir, "../../packages/clip-catalog"),
        root,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(py.status, py.stderr).toBe(0);
    const expected = [
      ["mixamo/Walk", 3, "flaw: hand clips"],
      ["mixamo/Spin", 2, "flaw: retarget breaks on Steve: a limb flips round at 0.5 s"],
    ];
    expect([ts, JSON.parse(py.stdout)]).toEqual([expected, expected]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic search can select a later distinct take without repeating its family", async () => {
  const pool = [
    ...soundEntries(
      [
        { name: "soft", title: "Soft pulse", kind: "sfx", family: "pulse", variant: 1 },
        { name: "glint", title: "Sharp metallic bell", kind: "sfx", family: "pulse", variant: 2 },
      ],
      false,
    ),
    e("chime", "Metallic chime"),
  ];
  const votes: Record<string, [number, number]> = {
    soft: [0.6, 0.1],
    glint: [0.3, 0.9],
    chime: [0.1, 0.8],
  };
  const output = await run(["metallic bell", "--jev", "--kind", "sfx"], pool, async (_, xs) =>
    xs.map((x) => [votes[x.id]![0], x, votes[x.id]![1]]),
  );
  const rows = output.split("\n").filter((line) => /^\d\.\d{2} +fits/.test(line));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatch(/\bglint\b/);
  expect(rows.join("\n")).not.toMatch(/\bsoft\b/);
  expect(output).toContain("FOUND: glint (fit 0.90)");
  expect(output).not.toContain("got none");
});

test.each([
  [0.75, 0.95, "soft", "FOUND: soft (fit 0.75)"],
  [0.1, 0.2, "glint", "best fit 0.20"],
] as const)(
  "semantic family selection keeps useful fit evidence: %s/%s",
  async (softFit, glintFit, selected, advice) => {
    const pool = soundEntries(
      [
        { name: "soft", title: "Soft pulse", kind: "sfx", family: "pulse", variant: 1 },
        { name: "glint", title: "Metallic bell", kind: "sfx", family: "pulse", variant: 2 },
      ],
      false,
    );
    const output = await run(["metallic effect", "--jev", "--kind", "sfx"], pool, async (_, xs) =>
      xs.map((x) => (x.id === "soft" ? [0.8, x, softFit] : [0.2, x, glintFit])),
    );
    const rows = output.split("\n").filter((line) => /^\d\.\d{2} +fits/.test(line));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(selected);
    expect(output).toContain(advice);
  },
);

test("semantically identical takes remain one choice with their family count", async () => {
  const pool = soundEntries(
    [1, 2, 3].map((variant) => ({
      name: `pulse-${variant}`,
      title: "Pulse",
      kind: "sfx",
      family: "pulse",
      variant,
    })),
    false,
  );
  const output = await run(["pulse", "--jev", "--kind", "sfx"], pool, async (_, xs) =>
    xs.map((x) => [0.8, x, 0.9]),
  );
  expect(output).toContain("Jev voted among 1 entries");
  expect(output).toContain("pulse-1 (3 takes)");
});

test("empty reviewed sequences retain catalogue postures and supported body filters", async () => {
  const root = mkdtempSync(join(tmpdir(), "find-empty-seq-"));
  try {
    const dir = join(root, "catalog");
    mkdirSync(dir);
    const row = {
      ref: "mixamo/Idle",
      dur: 2,
      start: "stand",
      end: "stand",
      seq: ["stand", "crouch", "stand"],
      energy: 1,
      loop: [0, 0],
      reach: 0,
      travel: [0, 0],
      turn: 0,
      look: 0,
    };
    writeFileSync(join(dir, "mixamo.jsonl"), JSON.stringify(row) + "\n");
    writeFileSync(join(dir, "review.json"), JSON.stringify({ [row.ref]: { seq: [] } }));
    const pyDir = resolve(import.meta.dir, "../../packages/clip-catalog");
    const parity = spawnSync(
      "python",
      [
        "-B",
        "-c",
        "import sys,pathlib,json;sys.path.insert(0,sys.argv[1]);import catalog,catalog_review;catalog.ROOT=pathlib.Path(sys.argv[2]);row=json.loads((catalog.ROOT/'catalog/mixamo.jsonl').read_text());catalog_review.validate({'seq':[]},row);print(json.dumps(list(catalog.rows(['mixamo']))[0]['seq']))",
        pyDir,
        root,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(parity.status, parity.stderr).toBe(0);
    const entries = mocapEntries(dir);
    expect(entries[0]!.data!.seq).toEqual(JSON.parse(parity.stdout));
    const catalogue = async (args: string[]) => {
      const result = spawnSync(
        "python",
        [
          "-B",
          "-c",
          "import sys,pathlib;sys.path.insert(0,sys.argv[1]);import catalog;catalog.ROOT=pathlib.Path(sys.argv[2]);sys.argv=['catalog.py',*sys.argv[3:]];catalog.main()",
          pyDir,
          root,
          ...args,
        ],
        { encoding: "utf8", timeout: 10000 },
      );
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout + result.stderr;
    };
    for (const option of ["--from", "--has"])
      expect(await run([option, "stand"], entries, noJev, catalogue)).toContain(row.ref);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.each([
  ["spark-a", "tap-blue", "glass-low", "click-red", "snap-dry", "tick-soft", "bell-long"],
  Array.from({ length: 12 }, (_, i) => `click-${i + 1}`),
])("family details name every usable take", async (...names) => {
  const pool = soundEntries(
    names.map((name, i) => ({
      name,
      title: "Click",
      family: "click",
      kind: "sfx",
      variant: i + 1,
    })),
    false,
  );
  const output = await run(["--show", names[0]!], pool, noJev);
  const takes = output.split("\n").find((line) => line.startsWith("takes:"));
  for (const name of names) expect(takes).toContain(name);
});

test("large sub-kind listings keep their side in category continuations", async () => {
  const pool = [
    ...Array.from({ length: 61 }, (_, i) => e(`enter-${i}`, `Fade ${i}`, "", "text-in", "Fade")),
    e("exit-only", "Fade out", "", "text-out", "Fade"),
  ];
  const output = await run(["--kind", "text-in"], pool, noJev);
  const category = output.match(/next: one category: bun run find --kind (\S+)/)?.[1];
  expect(category).toBe("text-in/fade");
  const continued = await run(["--kind", category!, "-n", "100"], pool, noJev);
  const rows = continued.split("\n").filter((line) => line.startsWith("text-in/"));
  expect(rows).toHaveLength(61);
  expect(continued).not.toContain("exit-only");
});

test.each([
  ["promote an accepted runner", 0.1, 0.9, "ual1/SearchFloor"],
  ["keep a confident favourite", 0.75, 0.95, "ual1/Wave"],
  ["accept the shared fit threshold", 0.1, 0.7, "ual1/SearchFloor"],
  ["preserve negative recovery", 0.1, 0.2, "ual1/Wave"],
] as const)("mocap semantic ranking: %s", async (name, firstFit, secondFit, expected) => {
  const pool = ["Wave", "SearchFloor"].map((id) => ({
    ...e(`ual1/${id}`, id, "", "mocap", "stand"),
    src: "ual1",
    secs: 2,
    data: { seq: ["stand"] },
  }));
  const source = `import sys
sys.path.insert(0, sys.argv[1])
import catalog
first, second = map(float, sys.argv[2:4])
base = {'dur':2,'start':'stand','end':'stand','seq':['stand'],'reach':0,'loop':[0,0],'energy':10,'look':0,'travel':[0,0],'turn':0,'seen':False}
items = [{**base,'ref':'ual1/Wave'}, {**base,'ref':'ual1/SearchFloor'}]
catalog.rows = lambda libs: iter(items)
catalog.keywords = lambda: {}
class FakeJev:
 used = 'injected fixture'
 spent = 0
 def ask(self, state, questions):
  if 'clip' in questions:
   return {'clip': {'probabilities': {'c0':0.8, 'c1':0.2}}}
  return {'fit_1': {'noul':first}, 'fit_2': {'noul':second}}
catalog.Jev = FakeJev
sys.argv = ['catalog.py', *sys.argv[4:]]
catalog.main()
`;
  const catalogue = async (args: string[]) => {
    const result = spawnSync(
      "python",
      [
        "-B",
        "-c",
        source,
        resolve(import.meta.dir, "../../packages/clip-catalog"),
        String(firstFit),
        String(secondFit),
        ...args,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(result.status, `${name}: ${result.stderr}`).toBe(0);
    return result.stdout + result.stderr;
  };
  const output = await run(
    ["--jev", "--kind", "mocap", "he searches the floor", "-n", "2"],
    pool,
    noJev,
    catalogue,
  );
  const rows = output.split("\n").filter((line) => /^\d\.\d{2} +fits/.test(line));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain(expected);
  if (Math.max(firstFit, secondFit) >= 0.7)
    expect(output).not.toMatch(/Jev: unsure|no shown clip fits/);
  else expect(output).toContain("no shown clip fits");
});

test("default vault discovery follows the film's nearest vault.json like Studio", () => {
  const film = mkdtempSync(join(tmpdir(), "find-default-vault-"));
  try {
    mkdirSync(join(film, "assets/sound/sfx"), { recursive: true });
    mkdirSync(join(film, "sound"));
    const conf = { soundTimeline: "audio.json", sfx: "sound" };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(join(film, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));
    writeFileSync(join(film, "vault.json"), JSON.stringify({ root: "assets" }));
    const made = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=d=1",
        join(film, "assets/sound/sfx/private-tone.wav"),
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    writeFileSync(
      join(film, "assets/sound/SOURCES.json"),
      JSON.stringify({
        "private-tone": {
          kind: "sfx",
          category: "bells",
          title: "Private Bell",
          origin: "real",
          source: "private",
          license: "CC0",
        },
      }),
    );
    const studio = openSound(film, conf);
    const expected = studio.library().find((x) => x.name === "private-tone")!;
    const entries = allEntries(false, film);
    const found = entries.find((x) => x.id === expected.name);
    expect(found).toBeDefined();
    expect([found!.secs, found!.cat, found!.title, found!.src, found!.data!.license]).toEqual([
      expected.seconds,
      expected.category,
      expected.title,
      expected.source,
      expected.license,
    ]);
    expect(resolve(found!.data!.file!)).toBe(resolve(studio.fileOf(expected.name)!));
    expect(entries.filter((x) => ["sfx", "bgm", "mc"].includes(x.kind)).map((x) => x.id)).toEqual(
      studio.library().map((x) => x.name),
    );
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("duration facet counts equal inclusive filtering at boundaries and across family takes", async () => {
  const pool = soundEntries(
    [
      ...[0.5, 1, 5, 30, 3600, 7200].map((seconds) => ({
        name: `tone-${seconds}`,
        title: "Tone",
        kind: "sfx",
        seconds,
      })),
      {
        name: "family-short",
        title: "Family",
        family: "family",
        variant: 1,
        kind: "sfx",
        seconds: 1,
      },
      {
        name: "family-long",
        title: "Family",
        family: "family",
        variant: 2,
        kind: "sfx",
        seconds: 5,
      },
    ],
    false,
  );
  let values = "";
  try {
    await run(["--dur"], pool, noJev);
  } catch (error) {
    values = (error as Error).message;
  }
  expect(values).toContain("Here:");
  for (const range of ["0-1", "1-5", "5-30", "30-7200"]) {
    const output = await run(["--dur", range], pool, noJev);
    const rows = output.split("\n").filter((line) => line.startsWith("sfx  "));
    expect(values).toMatch(new RegExp(`${range} ${rows.length}(?:,|$)`));
  }
});

test("colliding default vault ids audition the resolved file and its own peaks", async () => {
  const film = mkdtempSync(join(tmpdir(), "find-vault-collision-"));
  try {
    const conf = { soundTimeline: "audio.json", sfx: "local" };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(join(film, "vault.json"), JSON.stringify({ root: "assets" }));
    writeFileSync(join(film, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));
    for (const [folder, seconds, title, kind, peaks] of [
      ["mc-sound", 1, "Minecraft door", "mc", [0.1, 0.2]],
      ["sound", 2, "Canonical door", "sfx", [0.8, 0.9]],
    ] as const) {
      const dir = join(film, "assets", folder);
      mkdirSync(join(dir, "sfx"), { recursive: true });
      const made = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", `sine=d=${seconds}`, join(dir, "sfx/shared.wav")],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(made.status, made.stderr).toBe(0);
      writeFileSync(
        join(dir, "SOURCES.json"),
        JSON.stringify({ shared: { title, kind, source: folder } }),
      );
      writeFileSync(join(dir, "PEAKS.json"), JSON.stringify({ shared: { seconds, peaks } }));
    }
    const studio = openSound(film, conf);
    const canonical = studio.fileOf("shared")!;
    const pool = allEntries(false, film);
    const entries = pool.filter((x) => x.id === "shared");
    expect(entries).toHaveLength(1);
    expect(resolve(import.meta.dir, "../..", entries[0]!.data!.file!)).toBe(canonical);
    expect(entries[0]!.data!.peaks).toEqual([0.8, 0.9]);
    expect([entries[0]!.secs, entries[0]!.title]).toEqual([2, "Canonical door"]);
    const detail = await run(["--show", "shared"], pool, noJev);
    const command = detail.match(/hear it: (earshot describe .+)/)![1]!;
    expect(resolve(pastedArgs(command)[1])).toBe(canonical);
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("film-local Minecraft sounds keep provider edition and this-film scope", async () => {
  const film = mkdtempSync(join(tmpdir(), "find-local-mc-edition-"));
  try {
    mkdirSync(join(film, "sound"));
    const conf = { soundTimeline: "audio.json", sfx: "sound", soundVault: false };
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(join(film, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));
    const made = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", join(film, "sound/local-vanilla.wav")],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    writeFileSync(
      join(film, "sound/local-modded.wav"),
      readFileSync(join(film, "sound/local-vanilla.wav")),
    );
    writeFileSync(
      join(film, "sound/SOURCES.json"),
      JSON.stringify({
        "local-vanilla": { kind: "mc", title: "Vanilla door", source: "minecraft" },
        "local-modded": { kind: "mc", title: "Modded door", source: "macaws-doors" },
      }),
    );
    const pool = allEntries(false, film);
    for (const [edition, included, excluded, provider] of [
      ["vanilla", "local-vanilla", "local-modded", "minecraft"],
      ["modded", "local-modded", "local-vanilla", "macaws-doors"],
    ]) {
      const output = await run(
        ["--kind", "mc", "--source", "this-film", "--edition", edition!],
        pool,
        noJev,
      );
      expect(output).toContain(included!);
      expect(output).not.toContain(excluded!);
      expect(pool.find((x) => x.id === included)!.data!.source).toBe(provider);
      expect(pool.find((x) => x.id === included)!.src).toBe("this-film");
    }
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test.each(["vault", "local"])(
  "mixed-format sound precedence agrees with export: %s",
  async (mode) => {
    const film = mkdtempSync(join(tmpdir(), "find-format-precedence-"));
    try {
      const conf = { soundTimeline: "audio.json", sfx: "local" };
      writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
      writeFileSync(join(film, "vault.json"), JSON.stringify({ root: "assets" }));
      writeFileSync(join(film, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));
      mkdirSync(join(film, "local"));
      for (const [folder, extension, duration, title] of [
        ["assets/mc-sound/sfx", "wav", 0.5, "First vault"],
        ["assets/sound/sfx", "ogg", 0.8, "Later vault"],
        ...(mode === "local" ? [["local", "ogg", 0.3, "Local override"]] : []),
      ]) {
        const dir = join(film, String(folder));
        mkdirSync(dir, { recursive: true });
        const made = spawnSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            `sine=d=${duration}`,
            join(dir, `shared.${extension}`),
          ],
          { encoding: "utf8", timeout: 10000 },
        );
        expect(made.status, made.stderr).toBe(0);
        const metaDir = folder === "local" ? dir : dirname(dir);
        writeFileSync(
          join(metaDir, "SOURCES.json"),
          JSON.stringify({ shared: { title, kind: "sfx", source: String(folder) } }),
        );
      }
      const result = spawnSync(
        "python",
        [
          "-B",
          "-c",
          "import runpy,sys,json; m=runpy.run_path(sys.argv[1]); print(json.dumps(str(m['audio_file']('shared'))))",
          resolve(import.meta.dir, "../sound/mix.py"),
        ],
        { cwd: film, encoding: "utf8", timeout: 10000 },
      );
      expect(result.status, result.stderr).toBe(0);
      const mixedFile = JSON.parse(result.stdout);
      const studio = openSound(film, conf);
      expect(studio.fileOf("shared")).toBe(mixedFile);
      const entry = allEntries(false, film).find((x) => x.id === "shared")!;
      expect(
        resolve(
          entry.src === "this-film" ? film : resolve(import.meta.dir, "../.."),
          entry.data!.file!,
        ),
      ).toBe(mixedFile);
      expect(entry.title).toBe(mode === "local" ? "Local override" : "Later vault");
      expect(entry.secs).toBeCloseTo(mode === "local" ? 0.3 : 0.8, 2);
    } finally {
      rmSync(film, { recursive: true, force: true });
    }
  },
);

test.each([
  ["mixamo.jsonl", null],
  ["sweep_mixamo.jsonl", null],
  ["mixamo.jsonl", { dur: 1 }],
] as const)("invalid catalogue records name their file and repairable row: %s", (filename, row) => {
  const dir = mkdtempSync(join(tmpdir(), "find-record-diagnostic-"));
  try {
    writeFileSync(join(dir, "mixamo.jsonl"), JSON.stringify({ ref: "mixamo/Idle", dur: 1 }) + "\n");
    writeFileSync(join(dir, filename), "\n" + JSON.stringify(row) + "\n");
    let failure: unknown;
    try {
      mocapEntries(dir);
    } catch (error) {
      failure = error;
    }
    expect((failure as Error & { code: number }).code).toBe(1);
    expect((failure as Error).message).toContain(`${filename}:2`);
    expect((failure as Error).message).toMatch(/fix.*row|repair.*row|rebuild.*catalogue/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("semantic rows without a fit check are explicitly explained without raising the check budget", async () => {
  const pool = Array.from({ length: 13 }, (_, i) => e(`bell-${i}`, `Bell ${i}`));
  const output = await run(
    ["bell", "--jev", "--kind", "sfx", "-n", "13"],
    pool,
    async (_, xs, show) => xs.map((x, i) => [0.99 - i / 100, x, i < show ? 0.9 : undefined]),
  );
  expect(output.split("\n").filter((line) => /^\d\.\d{2} +fits/.test(line))).toHaveLength(12);
  expect(output).toContain("bell-12");
  expect(output).toContain("rows without fits are unchecked");
});

test("word-query facets count matching takes while browse retains full families", async () => {
  const pool = soundEntries(
    [
      ...[1, 2].flatMap((n) => [
        {
          name: `soft-${n}`,
          title: "Soft",
          kind: "sfx",
          family: `hit-${n}`,
          variant: 1,
          origin: "synth" as const,
          seconds: 0.5,
        },
        {
          name: `sharp-${n}`,
          title: "Sharp",
          kind: "sfx",
          family: `hit-${n}`,
          variant: 2,
          origin: "real" as const,
          seconds: 3,
        },
      ]),
      { name: "sharp-synth", title: "Sharp synthetic", kind: "sfx", origin: "synth", seconds: 0.5 },
    ],
    false,
  );
  const browse = await run(["--kind", "sfx"], pool, noJev);
  expect(browse).toContain("real 2");
  expect(browse).toContain("synth 3");
  const output = await run(["sharp", "--kind", "sfx"], pool, noJev);
  const narrow = output.split("\n").find((line) => line.includes("narrow these"))!;
  for (const [option, value] of [
    ["--origin", "real"],
    ["--origin", "synth"],
    ["--dur", "0-1"],
    ["--dur", "1-5"],
  ]) {
    const filtered = await run(["sharp", "--kind", "sfx", option!, value!], pool, noJev);
    const count = filtered.split("\n").filter((line) => line.startsWith("sfx  ")).length;
    expect(narrow).toContain(`${value} ${count}`);
  }
});

test("partial promoted top hit does not deny a complete lower hit", async () => {
  const pool = [e("drive", "Drive", "", "bgm"), e("sting", "Sad music sting")];
  const output = await run(["sad music"], pool, noJev);
  expect(output.indexOf("bgm  drive")).toBeLessThan(output.indexOf("sfx  sting"));
  expect(output).toContain("top hit lacks: sad");
  expect(output).not.toContain("no entry has every word");
});

test("sound details use the cached waveform interval shown in the Studio", async () => {
  const film = mkdtempSync(join(tmpdir(), "find-peaks-step-"));
  try {
    const conf = { soundTimeline: "audio.json", sfx: "sound", soundVault: "cache" };
    const vault = join(film, "cache");
    mkdirSync(join(vault, "sfx"), { recursive: true });
    const made = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", "sine=d=0.4", join(vault, "sfx/ping.wav")],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(made.status, made.stderr).toBe(0);
    writeFileSync(join(film, "package.json"), JSON.stringify({ "live-studio": conf }));
    writeFileSync(join(film, "audio.json"), JSON.stringify({ beds: [], sfx: [] }));
    writeFileSync(
      join(vault, "PEAKS.json"),
      JSON.stringify({ ping: { seconds: 0.4, step: 0.1, peaks: [0, 0, 1, 0] } }),
    );
    const studio = openSound(film, conf);
    expect(studio.peaks("ping")).toEqual({ step: 0.1, peaks: [0, 0, 1, 0] });
    const output = await run(["--show", "ping"], allEntries(false, film), noJev);
    expect(output).toContain("attack 0.20 s, peak 0.20 s, dies out 0.20 s");
  } finally {
    rmSync(film, { recursive: true, force: true });
  }
});

test("a shared vault override supplies the same real sounds to discovery and the Studio", () => {
  const folder = mkdtempSync(join(tmpdir(), "find-shared-vault-"));
  try {
    mkdirSync(join(folder, "mc-sound/mc"), { recursive: true });
    const audio = Buffer.alloc(2044);
    audio.write("RIFF");
    audio.writeUInt32LE(2036, 4);
    audio.write("WAVE", 8);
    audio.write("fmt ", 12);
    audio.writeUInt32LE(16, 16);
    audio.writeUInt16LE(1, 20);
    audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(1000, 24);
    audio.writeUInt32LE(2000, 28);
    audio.writeUInt16LE(2, 32);
    audio.writeUInt16LE(16, 34);
    audio.write("data", 36);
    audio.writeUInt32LE(2000, 40);
    writeFileSync(join(folder, "mc-sound/mc/shared-stone.wav"), audio);
    const script = `import { allEntries } from ${JSON.stringify(new URL("../find.ts", import.meta.url).href)};
import { findVaults, openSound } from ${JSON.stringify(new URL("../../packages/live-studio/src/sound.mjs", import.meta.url).href)};
const film = process.cwd();
console.log(JSON.stringify({
  dirs: findVaults(film, {}),
  disabled: findVaults(film, { soundVault: false }),
  entries: allEntries(false, film).filter(entry => entry.id === 'shared-stone'),
  studio: openSound(film, { soundTimeline: 'audio.json', sfx: 'sound' }).library().filter(entry => entry.name === 'shared-stone'),
}));`;
    const result = spawnSync(process.execPath, ["--no-env-file", "-e", script], {
      cwd: ROOT,
      env: { ...process.env, MC_VAULT_ROOT: folder, MC_VAULT_EXTERNAL: folder },
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.disabled).toEqual([]);
    expect(output.dirs).toEqual([join(folder, "mc-sound")]);
    expect(output.entries.map((entry: Entry) => entry.id)).toEqual(["shared-stone"]);
    expect(output.studio.map((entry: { name: string }) => entry.name)).toEqual(["shared-stone"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
