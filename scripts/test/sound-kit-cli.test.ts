import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { favoriteLists } from "../../packages/live-studio/src/favorites.mjs";
import { openSoundKit } from "../../packages/live-studio/src/sound-kit.mjs";
import { type Entry, run as findRun } from "../find";
import { runSoundKitCli } from "../sound-kit";

const SCRIPT_PATH = resolve(import.meta.dir, "../sound-kit.ts");

const noStars = favoriteLists(join(tmpdir(), "sound-kit-find-no-favs"));

const SAMPLE_ENTRIES: Entry[] = [
  {
    kind: "bgm",
    id: "bgm-tense-pulse",
    cat: "tense",
    title: "Tense Synth Pulse",
    about: "driving curious synth",
    src: "openfilm",
    secs: 90,
    data: { seconds: 90 },
  },
  {
    kind: "bgm",
    id: "bgm-cheesy-circus",
    cat: "playful",
    title: "Cheesy Circus Loop",
    about: "clown brass",
    src: "mixkit",
    secs: 60,
    data: { seconds: 60 },
  },
  {
    kind: "sfx",
    id: "whoosh-fast-air",
    cat: "transitions",
    title: "Fast Air Whoosh",
    about: "clean whip transition",
    src: "mixkit",
    secs: 0.45,
    data: { seconds: 0.45, family: "whoosh-air", variant: 1 },
  },
  {
    kind: "sfx",
    id: "whoosh-fast-air-2",
    cat: "transitions",
    title: "Fast Air Whoosh 2",
    about: "clean whip transition",
    src: "mixkit",
    secs: 0.48,
    data: { seconds: 0.48, family: "whoosh-air", variant: 2 },
  },
  {
    kind: "sfx",
    id: "whoosh-sword-foil",
    cat: "transitions",
    title: "Fencing Foil Swoosh",
    about: "sword fight",
    src: "sonniss",
    secs: 0.6,
    data: { seconds: 0.6 },
  },
  {
    kind: "sfx",
    id: "pop-crisp-ui",
    cat: "clicks",
    title: "Crisp Bubble Pop",
    about: "clean UI appear",
    src: "mixkit",
    secs: 0.18,
    data: { seconds: 0.18 },
  },
  {
    kind: "sfx",
    id: "impact-sub-thud",
    cat: "impacts",
    title: "Deep Sub Bass Thud",
    about: "punchy drop",
    src: "openfilm",
    secs: 0.8,
    data: { seconds: 0.8 },
  },
  {
    kind: "mocap",
    id: "walk-idle",
    cat: "stand>stand",
    title: "Walk Idle",
    about: "idle walk",
    src: "mixamo",
    secs: 2,
    data: { seq: ["stand", "stand"] },
  },
];

const SAMPLE_LIBRARY = SAMPLE_ENTRIES.filter((x) => x.kind !== "mocap").map((x) => ({
  name: x.id,
  kind: x.kind,
  category: x.cat,
  title: x.title,
  for: x.about,
  seconds: Number(x.secs ?? 1),
  source: x.src ?? "mixkit",
  family: x.data?.family,
}));

test("sound:kit add, set, list, stats, and remove manage kit items", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-cli-crud-"));
  const kitFile = join(dir, "core.json");
  try {
    await runSoundKitCli(
      [
        "add",
        "whoosh-fast-air",
        "whoosh-sword-foil",
        "--category",
        "whoosh",
        "--status",
        "inbox",
        "--tags",
        "short,whip",
        "--note",
        "test batch",
      ],
      { kitFile, library: SAMPLE_LIBRARY },
    );

    await runSoundKitCli(
      ["set", "whoosh-fast-air", "--status", "core", "--tier", "1", "--tags", ""],
      { kitFile, library: SAMPLE_LIBRARY },
    );
    expect(openSoundKit(kitFile).read().items["whoosh-fast-air"]?.tags).toEqual([]);
    expect(openSoundKit(kitFile).read().items["whoosh-fast-air"]?.tier).toBe(1);

    const listText = await runSoundKitCli(["list", "--category", "whoosh", "--status", "core"], {
      kitFile,
      library: SAMPLE_LIBRARY,
    });
    expect(listText).toContain("whoosh-fast-air");
    expect(listText).not.toContain("whoosh-sword-foil");

    const listJson = JSON.parse(
      await runSoundKitCli(["list", "--json"], { kitFile, library: SAMPLE_LIBRARY }),
    );
    expect(listJson.items).toHaveLength(2);

    const outStats = await runSoundKitCli(["stats"], { kitFile, library: SAMPLE_LIBRARY });
    expect(outStats).toContain("whoosh");
    expect(outStats).toContain("core: 1");

    const remJson = await runSoundKitCli(["remove", "whoosh-sword-foil", "--json"], {
      kitFile,
      library: SAMPLE_LIBRARY,
    });
    expect(JSON.parse(remJson).removed).toEqual(["whoosh-sword-foil"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound:kit ab, decisions, recommend, and similar --stage work end to end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-cli-ab-"));
  const kitFile = join(dir, "core.json");
  try {
    await runSoundKitCli(["ab", "set", "whoosh-fast-air", "whoosh-sword-foil"], {
      kitFile,
      library: SAMPLE_LIBRARY,
    });
    expect(await runSoundKitCli(["ab", "show"], { kitFile, library: SAMPLE_LIBRARY })).toContain(
      "A: whoosh-fast-air",
    );

    await runSoundKitCli(
      [
        "ab",
        "pick",
        "whoosh-fast-air",
        "--category",
        "whoosh",
        "--ban-losers",
        "--reason",
        "sword sounds weird",
      ],
      { kitFile, library: SAMPLE_LIBRARY },
    );
    expect(
      await runSoundKitCli(["ab", "clear", "--json"], { kitFile, library: SAMPLE_LIBRARY }),
    ).toContain("[]");

    const outDecisions = await runSoundKitCli(["decisions"], { kitFile, library: SAMPLE_LIBRARY });
    expect(outDecisions).toContain("sword sounds weird");

    const recJson = await runSoundKitCli(
      ["recommend", "--category", "whoosh", "--top", "3", "--json"],
      { kitFile, library: SAMPLE_LIBRARY, semanticDb: join(dir, "none.sqlite") },
    );
    const rec = JSON.parse(recJson);
    expect(rec.picks).toHaveLength(1);
    expect(rec.picks[0].id).toBe("whoosh-fast-air");

    const durMiss = await runSoundKitCli(["recommend", "--category", "whoosh", "--dur", "5-10"], {
      kitFile,
      library: SAMPLE_LIBRARY,
      semanticDb: join(dir, "none.sqlite"),
    });
    expect(durMiss).toContain("No core sounds matched those filters");
    expect(durMiss).not.toContain("No approved core sounds available");

    const simOut = await runSoundKitCli(["similar", "bgm-tense-pulse", "--limit", "3", "--stage"], {
      kitFile,
      library: SAMPLE_LIBRARY,
      semanticDb: join(dir, "none.sqlite"),
    });
    expect(simOut).toContain("bgm-cheesy-circus");
    expect(openSoundKit(kitFile).read().items["bgm-cheesy-circus"]?.status).toBe("inbox");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound:kit seed writes inbox candidates, balances BGM moods, and returns valid JSON when nothing new remains", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-cli-seed-"));
  const kitFile = join(dir, "core.json");
  const richLibrary = [
    ...SAMPLE_LIBRARY,
    {
      name: "bgm-lofi-1",
      kind: "bgm",
      category: "lofi",
      title: "Lofi Study",
      seconds: 60,
      source: "openfilm",
    },
    {
      name: "bgm-cine-1",
      kind: "bgm",
      category: "cinematic",
      title: "Cinematic Tension",
      seconds: 60,
      source: "openfilm",
    },
    {
      name: "bgm-upbeat-1",
      kind: "bgm",
      category: "upbeat",
      title: "Upbeat Drive",
      seconds: 60,
      source: "openfilm",
    },
    {
      name: "bgm-warm-1",
      kind: "bgm",
      category: "warm",
      title: "Warm Rhodes",
      seconds: 60,
      source: "openfilm",
    },
    {
      name: "bgm-elec-1",
      kind: "bgm",
      category: "electronic",
      title: "Electronic Pulse",
      seconds: 60,
      source: "openfilm",
    },
    {
      name: "bgm-tense-2",
      kind: "bgm",
      category: "tense",
      title: "Tense Pulse 2",
      seconds: 60,
      source: "openfilm",
    },
  ];
  try {
    const drySeed = await runSoundKitCli(["seed", "--per-category", "7", "--dry-run", "--json"], {
      kitFile,
      library: richLibrary,
    });
    const dryParsed = JSON.parse(drySeed);
    expect(dryParsed.dryRun).toBe(true);
    const bgmMoods = new Set(
      dryParsed.items
        .filter((x: { category: string }) => x.category === "bgm")
        .map((x: { tags: string[] }) => x.tags[0]),
    );
    expect(bgmMoods.size).toBe(7);

    const firstSeed = JSON.parse(
      await runSoundKitCli(["seed", "--per-category", "10", "--json"], {
        kitFile,
        library: richLibrary,
      }),
    );
    expect(firstSeed.added).toBeGreaterThan(0);

    const exhaustedSeedJson = JSON.parse(
      await runSoundKitCli(["seed", "--per-category", "10", "--json"], {
        kitFile,
        library: [],
      }),
    );
    expect(exhaustedSeedJson.added).toBe(0);

    const exhaustedSeedText = await runSoundKitCli(["seed", "--per-category", "10"], {
      kitFile,
      library: [],
    });
    expect(exhaustedSeedText).toContain("No new starter candidates");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound:kit CLI rejects invalid options, empty category/status values, and atomic remove errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-cli-err-"));
  const kitFile = join(dir, "core.json");
  try {
    await runSoundKitCli(["add", "whoosh-fast-air", "--category", "whoosh"], {
      kitFile,
      library: SAMPLE_LIBRARY,
    });
    await expect(
      runSoundKitCli(["list", "--cat", "whoosh"], { kitFile, library: SAMPLE_LIBRARY }),
    ).rejects.toThrow(/Unknown option/);
    await expect(
      runSoundKitCli(["list", "--category="], { kitFile, library: SAMPLE_LIBRARY }),
    ).rejects.toThrow(/Unknown category/);
    await expect(
      runSoundKitCli(["list", "--status="], { kitFile, library: SAMPLE_LIBRARY }),
    ).rejects.toThrow(/Unknown status/);
    await expect(
      runSoundKitCli(["recommend", "--dur="], { kitFile, library: SAMPLE_LIBRARY }),
    ).rejects.toThrow(/--dur takes/);
    await expect(
      runSoundKitCli(["seed", "--per-category", "abc", "--dry-run"], {
        kitFile,
        library: SAMPLE_LIBRARY,
      }),
    ).rejects.toThrow(/positive integer/);
    await expect(
      runSoundKitCli(["similar", "whoosh-fast-air", "--limit", "abc"], {
        kitFile,
        library: SAMPLE_LIBRARY,
      }),
    ).rejects.toThrow(/positive integer/);
    await expect(
      runSoundKitCli(["set", "whoosh-fast-air", "--status", "core", "--by", "bot"], {
        kitFile,
        library: SAMPLE_LIBRARY,
      }),
    ).rejects.toThrow(/ai or human/);
    await expect(
      runSoundKitCli(["set", "whoosh-fast-air", "pop-crisp-ui", "--status", "core"], {
        kitFile,
        library: SAMPLE_LIBRARY,
      }),
    ).rejects.toThrow(/one sound id/);
    await expect(
      runSoundKitCli(
        ["add", "whoosh-fast-air", "--category", "whoosh", "--tags", "--status", "core"],
        { kitFile, library: SAMPLE_LIBRARY },
      ),
    ).rejects.toThrow(/requires a value/);
    await expect(
      runSoundKitCli(["remove", "whoosh-fast-air", "__proto__"], {
        kitFile,
        library: SAMPLE_LIBRARY,
      }),
    ).rejects.toThrow(/Invalid sound id/);
    expect(openSoundKit(kitFile).read().items["whoosh-fast-air"]).toBeDefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound:kit CLI subprocess exits 0 on --help and exits 2 on usage or Zod schema violations", async () => {
  const helpProc = Bun.spawn([process.execPath, SCRIPT_PATH, "--help"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await helpProc.exited).toBe(0);
  expect(await new Response(helpProc.stdout).text()).toContain("Core Sound Kit");

  const badFlag = Bun.spawn([process.execPath, SCRIPT_PATH, "list", "--bogus"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await badFlag.exited).toBe(2);

  const badNote = Bun.spawn(
    [
      process.execPath,
      SCRIPT_PATH,
      "add",
      "whoosh-fast-air",
      "--category",
      "whoosh",
      "--note",
      "x".repeat(300),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await badNote.exited).toBe(2);
});

test("find --kit handles ban exclusion, --show/--unstar on banned sounds, family folding, --semantic --json, narrowing, and incompatible kind guards", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-find-"));
  const kitFile = join(dir, "core.json");
  const favLists = favoriteLists(join(dir, "favs"));
  try {
    const kit = openSoundKit(kitFile);
    kit.setItem({ id: "whoosh-fast-air-2", category: "whoosh", status: "core", addedBy: "human" });
    kit.setItem({ id: "whoosh-sword-foil", category: "whoosh", status: "ban", addedBy: "human" });
    kit.setItem({ id: "bgm-tense-pulse", category: "bgm", status: "core", addedBy: "human" });
    favLists.open("default").set({ kind: "sounds", id: "whoosh-sword-foil", on: true });

    const folded = await findRun(
      ["air", "whoosh"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      favLists,
      undefined,
      kit,
    );
    expect(folded).toContain("whoosh-fast-air");
    expect(folded).toContain("kit:whoosh");
    expect(folded).not.toContain("whoosh-sword-foil");

    const shownBanned = await findRun(
      ["--show", "whoosh-sword-foil"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      favLists,
      undefined,
      kit,
    );
    expect(shownBanned).toContain("whoosh-sword-foil");
    expect(shownBanned).toContain("kit:ban");

    const unstarredBanned = await findRun(
      ["--unstar", "whoosh-sword-foil"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      favLists,
      undefined,
      kit,
    );
    expect(unstarredBanned).toContain("unstarred");
    expect(favLists.open("default").read().sounds).toEqual([]);

    const filteredEmpty = await findRun(
      ["--kit", "whoosh", "--dur", "10-20"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      noStars,
      undefined,
      kit,
    ).catch((e) => String(e.message));
    expect(filteredEmpty).not.toContain("no approved Core Sound Kit sounds yet");

    const emptySemanticJson = JSON.parse(
      await findRun(
        ["riser", "--kit", "riser", "--semantic", "--json"],
        SAMPLE_ENTRIES,
        undefined,
        undefined,
        noStars,
        undefined,
        kit,
      ),
    );
    expect(emptySemanticJson.mode).toBe("keyword-fallback");
    expect(Array.isArray(emptySemanticJson.results)).toBe(true);

    const kitHints = await findRun(
      ["--kit", "whoosh"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      noStars,
      undefined,
      kit,
    );
    expect(kitHints).toContain("--kit whoosh");

    await expect(
      findRun(
        ["--from", "stand", "--kit"],
        SAMPLE_ENTRIES,
        undefined,
        undefined,
        noStars,
        undefined,
        kit,
      ),
    ).rejects.toThrow(/--kit/);

    await expect(
      findRun(
        ["--kit", "--kind", "block"],
        SAMPLE_ENTRIES,
        undefined,
        undefined,
        noStars,
        undefined,
        kit,
      ),
    ).rejects.toThrow(/filters sounds only/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound:kit add without --status or --by preserves existing core/ban items while defaulting new ones to inbox/ai", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-cli-preserve-"));
  const kitFile = join(dir, "core.json");
  try {
    const kit = openSoundKit(kitFile);
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core", addedBy: "human" });
    kit.setItem({ id: "whoosh-sword-foil", category: "whoosh", status: "ban", addedBy: "human" });

    const out = await runSoundKitCli(
      [
        "add",
        "whoosh-fast-air",
        "whoosh-sword-foil",
        "pop-crisp-ui",
        "--tags",
        "tagged",
        "--note",
        "-crisp",
      ],
      { kitFile, library: SAMPLE_LIBRARY },
    );
    const items = kit.read().items;
    expect(items["whoosh-fast-air"]?.status).toBe("core");
    expect(items["whoosh-fast-air"]?.addedBy).toBe("human");
    expect(items["whoosh-fast-air"]?.note).toBe("-crisp");
    expect(items["whoosh-sword-foil"]?.status).toBe("ban");
    expect(items["whoosh-sword-foil"]?.addedBy).toBe("human");
    expect(items["pop-crisp-ui"]?.status).toBe("inbox");
    expect(items["pop-crisp-ui"]?.addedBy).toBe("ai");
    expect(out).toContain("whoosh-fast-air:whoosh/core");
    expect(out).toContain("whoosh-sword-foil:whoosh/ban");
    expect(out).toContain("pop-crisp-ui:pop-ui/inbox");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound:kit ab pick rejects empty tray and off-tray typo winners without mutating tray items", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-cli-abguard-"));
  const kitFile = join(dir, "core.json");
  try {
    await expect(
      runSoundKitCli(["ab", "pick", "whoosh-fast-air", "--category", "whoosh"], {
        kitFile,
        library: SAMPLE_LIBRARY,
      }),
    ).rejects.toThrow(/A\/B tray is empty/);

    await runSoundKitCli(["ab", "set", "whoosh-fast-air", "whoosh-sword-foil"], {
      kitFile,
      library: SAMPLE_LIBRARY,
    });
    await expect(
      runSoundKitCli(["ab", "pick", "whoosh-fast-typo", "--category", "whoosh", "--ban-losers"], {
        kitFile,
        library: SAMPLE_LIBRARY,
      }),
    ).rejects.toThrow(/not in the A\/B tray/);

    const state = openSoundKit(kitFile).read();
    expect(Object.keys(state.items)).toEqual([]);
    expect(state.decisions).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound:kit similar rejects --category when --stage is omitted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-cli-simcat-"));
  const kitFile = join(dir, "core.json");
  try {
    await expect(
      runSoundKitCli(["similar", "whoosh-fast-air", "--category", "impact"], {
        kitFile,
        library: SAMPLE_LIBRARY,
        semanticDb: join(dir, "none.sqlite"),
      }),
    ).rejects.toThrow(/requires --stage/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("find supports --include-banned, --core-kit alias, --kit typo hint, and kitMiss category hint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-find-extra-"));
  const kitFile = join(dir, "core.json");
  try {
    const kit = openSoundKit(kitFile);
    kit.setItem({ id: "whoosh-fast-air", category: "whoosh", status: "core", addedBy: "human" });
    kit.setItem({ id: "whoosh-sword-foil", category: "whoosh", status: "ban", addedBy: "human" });

    const withBanned = await findRun(
      ["sword", "--include-banned"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      noStars,
      undefined,
      kit,
    );
    expect(withBanned).toContain("whoosh-sword-foil");
    expect(withBanned).toContain("kit:ban");

    const aliasOut = await findRun(
      ["--core-kit"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      noStars,
      undefined,
      kit,
    );
    expect(aliasOut).toContain("whoosh-fast-air");

    const typoOut = await findRun(
      ["--kit", "pop"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      noStars,
      undefined,
      kit,
    );
    expect(typoOut).toContain("did you mean --kit pop-ui?");

    const missOut = await findRun(
      ["zzznomatchword", "--kit", "whoosh"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      noStars,
      undefined,
      kit,
    );
    expect(missOut).toContain("sound:kit recommend --category whoosh");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound:kit add preserves human-overridden categories and skips tracked niche sounds under --skip-existing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-cli-catkeep-"));
  const kitFile = join(dir, "core.json");
  try {
    const kit = openSoundKit(kitFile);
    kit.setItem({ id: "whoosh-fast-air", category: "impact", status: "core", addedBy: "human" });
    kit.setItem({
      id: "scifi-alien-laser",
      category: "comedy-glitch",
      status: "core",
      addedBy: "human",
    });

    await runSoundKitCli(["add", "whoosh-fast-air", "scifi-alien-laser", "--tags", "favorite"], {
      kitFile,
      library: SAMPLE_LIBRARY,
    });
    const afterUpdate = kit.read().items;
    expect(afterUpdate["whoosh-fast-air"]?.category).toBe("impact");
    expect(afterUpdate["scifi-alien-laser"]?.category).toBe("comedy-glitch");
    expect(afterUpdate["scifi-alien-laser"]?.tags).toEqual(["favorite"]);

    const skipRes = JSON.parse(
      await runSoundKitCli(
        ["add", "scifi-alien-laser", "pop-crisp-ui", "--skip-existing", "--json"],
        { kitFile, library: SAMPLE_LIBRARY },
      ),
    );
    expect(skipRes.skipped).toBe(1);
    expect(skipRes.added).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound:kit ab set rejects more than 4 unique sound ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-cli-abmax-"));
  const kitFile = join(dir, "core.json");
  try {
    await expect(
      runSoundKitCli(["ab", "set", "s1", "s2", "s3", "s4", "s5"], {
        kitFile,
        library: SAMPLE_LIBRARY,
      }),
    ).rejects.toThrow(/at most 4/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sound:kit pass status works in CLI, skips re-seeding, stays searchable in normal find, and stays excluded from find --kit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-kit-cli-pass-"));
  const kitFile = join(dir, "core.json");
  try {
    await runSoundKitCli(["set", "whoosh-sword-foil", "--category", "whoosh", "--status", "pass"], {
      kitFile,
      library: SAMPLE_LIBRARY,
    });
    await runSoundKitCli(["set", "whoosh-fast-air", "--category", "whoosh", "--status", "core"], {
      kitFile,
      library: SAMPLE_LIBRARY,
    });

    const statsOut = await runSoundKitCli(["stats"], { kitFile, library: SAMPLE_LIBRARY });
    expect(statsOut).toContain("pass: 1");

    const passList = await runSoundKitCli(["list", "--status", "pass"], {
      kitFile,
      library: SAMPLE_LIBRARY,
    });
    expect(passList).toContain("whoosh-sword-foil");
    expect(passList).not.toContain("whoosh-fast-air");

    await runSoundKitCli(["seed", "--per-category", "5"], { kitFile, library: SAMPLE_LIBRARY });
    expect(openSoundKit(kitFile).read().items["whoosh-sword-foil"]?.status).toBe("pass");

    const kit = openSoundKit(kitFile);
    const normalFind = await findRun(
      ["sword"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      noStars,
      undefined,
      kit,
    );
    expect(normalFind).toContain("whoosh-sword-foil");
    expect(normalFind).not.toContain("kit:ban");

    const kitFind = await findRun(
      ["--kit", "whoosh"],
      SAMPLE_ENTRIES,
      undefined,
      undefined,
      noStars,
      undefined,
      kit,
    );
    expect(kitFind).toContain("whoosh-fast-air");
    expect(kitFind).not.toContain("whoosh-sword-foil");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
