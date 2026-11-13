// One lookup over everything a film can name (vault sounds, every film-stage preset), built so an agent reads ~15 lines
// instead of grepping 3 MB of SOURCES.json: bun run find --help. Jev (packages/clip-catalog/jev.py) ranks by meaning.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

import { ANIM_CURVES, ANIMS } from "../packages/film-stage/src/animate";
import { EASE_JOBS, EASES } from "../packages/film-stage/src/camera";
import { ADJUSTMENTS } from "../packages/film-stage/src/grade-color";
import {
  FONTS,
  SHAPE_IN,
  SHAPE_OUT,
  SHAPES,
  TEXT_IN,
  TEXT_OUT,
  TITLE_EASES,
} from "../packages/film-stage/src/titles";
import { TRANSITION_EASES, TRANSITIONS } from "../packages/film-stage/src/transitions";
import { VELOCITY_EFFECTS, VELOCITY_LOOKS } from "../packages/film-stage/src/velocity";
import {
  catTitle,
  editionOf,
  MC_HEADINGS,
  originOf,
  sentenceSlug,
} from "../packages/live-studio/app/sound/groups";
import { EXTERNAL, LOCAL, ROOT } from "./vault.mjs";

export type Entry = {
  kind: string;
  id: string;
  cat: string;
  title: string;
  about: string;
  src?: string;
  takes?: number;
  secs?: number;
  note?: string;
  // the catalogue record behind the line, for --show
  data?: Detail;
};
// What --show reads from a sound's SOURCES/PEAKS, a mocap clip's catalogue row or a film-stage preset
type Detail = {
  license?: string;
  url?: string;
  file?: string;
  peaks?: number[];
  takes?: string[];
  seq?: string[];
  travel?: number[];
  turn?: number;
  loop?: number[];
  energy?: number;
  checked?: boolean;
  prop?: string[];
  tl?: Record<string, [number, number, string][]>;
  glsl?: string;
  ease?: unknown;
  len?: number;
  stagger?: boolean;
  defaultStagger?: number;
  tint?: boolean;
  defaultTint?: string;
  css?: string;
  min?: number;
  max?: number;
  [k: string]: unknown;
};

const SOUND = ["sfx", "bgm", "mc"];

const USE: Record<string, string> = {
  sound:
    'audio.json sfx[] {"at","name","gain"} | beds[] {"name","from","to","gain","fadeIn","fadeOut"}',
  transition: 'shots.json shot.transition {"fx","len"}',
  "transition-ease": "shots.json shot.transition.ease",
  anim: 'shots.json shot.anim.in|out|combo {"fx","len"} (anim-in plays as the shot starts, anim-out as it ends, anim-combo across the whole shot; one id can be all three)',
  "anim-curve": "shots.json shot.anim.<in|out|combo>.curve",
  text: 'text.json items[] kind "text": .in|.out {"fx","len"}',
  shape: "text.json items[] kind arrow|circle|box|bracket|underline: .in|.out",
  font: "text.json items[].font",
  adjust: "adjust.json items[].grade.basic.<id> or shots.json shot.adjust.basic.<id>",
  velocity:
    'timing.json velocity[] {"effect","music","beats","from","to","frequency":1|2,"speed":"normal|fast|veryFast","intensity":0-100}',
  ease: "cam.json key.ease, props.json ease",
  mocap: 'steve.json moves[] {"t","at","yaw","clip"} (+ "from","rate","loop","blend")',
};
const useOf = (kind: string) =>
  SOUND.includes(kind) ? USE.sound : (USE[kind] ?? USE[kind.split("-")[0] ?? ""]);

// Light stemming, the same on both sides: creaky/creaking -> creak, doors -> door, typing/typed/type -> typ
const stem = (w: string) => {
  let s = w.replace(/^(.)(?:ies|ying)$/, "$1ie").replace(/ies$/, "y");
  if (s.length > 4) s = s.replace(/(?:ing|ed|es)$/, "");
  if (s.length > 3 && !s.endsWith("ss")) s = s.replace(/s$/, "");
  // zombie and zombies (via zomby) both end as zomb
  if (s.length > 3) s = s.replace(/(?:ie|[ye])$/, "");
  return s;
};
const plain = (text: string) =>
  text
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean);
const words = (text: string) => plain(text).map(stem);

// Words that name nothing: kept out of the query so "a" or "the" never matches a description
const STOP = new Set(
  words(
    "a an the of by to in on for with and or at from his her their it is as into onto that this these those some something thing like when which who what how be are was were very really just quite want need i me my we you your",
  ),
);

// An editor's word for what the vault names otherwise; each counts as a match for the word asked
const SAME: Record<string, string[]> = Object.fromEntries(
  Object.entries({
    crossfade: "dissolve",
    desaturate: "saturation",
    monochrome: "saturation",
    grayscale: "saturation",
    greyscale: "saturation",
    sepia: "saturation temp",
    brighten: "exposure brightness",
    darken: "exposure",
    die: "death",
    dead: "death",
    death: "die",
    kill: "death",
    monospace: "mono",
    warmer: "warm",
    cooler: "cool",
    dof: "defocus blur",
    bokeh: "defocus blur",
    unfocus: "defocus blur",
    jumpscare: "scare",
    subtitle: "caption",
    slowmo: "slow",
  }).map(([w, same]) => [stem(w), words(same)]),
);
// The query as slots, one per word: the word, what it means in the vault (SAME), and the word it makes with its neighbour
// ("ender dragon" -> enderdragon), so an entry that says any of a slot's terms has that word
const slotsOf = (query: string) => {
  const ws = [...new Set(words(query))].filter((w) => !STOP.has(w));
  return ws.map((w, i) => [
    ...new Set([
      w,
      ...(SAME[w] ?? []),
      ...[ws[i - 1] && ws[i - 1] + w, ws[i + 1] && w + ws[i + 1]].flatMap((j) =>
        j ? [stem(j)] : [],
      ),
    ]),
  ]);
};

const kindMatches = (kind: string, asked: string) =>
  kind === asked || kind.startsWith(`${asked}-`) || (asked === "sound" && SOUND.includes(kind));

// The words a query uses for a kind ("music", "beat"), so they reach entries that never say them
const KIND_WORDS: Record<string, string> = {
  bgm: "music song track score",
  sfx: "sound effect",
  mc: "minecraft sound",
  velocity: "beat sync",
  ease: "camera curve",
  adjust: "grade color look",
  font: "typeface",
  "text-in": "title caption",
  "text-out": "title caption",
  shape: "annotation mark callout",
  "shape-in": "annotation mark callout arrow circle box bracket underline",
  "shape-out": "annotation mark callout arrow circle box bracket underline",
};

// ---------- Categories as the studio's libraries group them (its chips, the Sound panel's tree), so --kind <kind>/<category>
// picks one as a click there does
const top = (kind: string) => (SOUND.includes(kind) ? kind : (kind.split("-")[0] ?? kind));
// A category as --kind writes it: "Wipe & Split" -> wipe-split, "stand>crouch" -> stand-crouch
const catSlug = (cat: string) => plain(cat).join("-");
const catKey = (x: Pick<Entry, "kind" | "cat">) => `${top(x.kind)}/${catSlug(x.cat)}`;
// The studio's heading for a sound category ("shutter" -> "Camera shutter", Minecraft "horror" -> "Horror & caves")
const catLabel = (x: Pick<Entry, "kind" | "cat">) =>
  !x.cat
    ? ""
    : x.kind === "mc"
      ? (MC_HEADINGS[x.cat] ?? catTitle(x.cat))
      : SOUND.includes(x.kind)
        ? catTitle(x.cat)
        : x.cat;
// Words an editor says for a category that neither its name nor its heading does (searched, at the weight of a description)
const CAT_WORDS: Record<string, string> = {
  "sfx/transitions": "whoosh swoosh swish whip riser downlifter sweep pass",
  "sfx/clicks": "click tap ui interface button hover tick",
  "sfx/notifications": "ding chime notification alert ping success message",
  "sfx/typing": "keyboard keystroke typewriter",
  "sfx/glitch": "digital error static stutter corrupt buzz",
  "sfx/impacts": "hit boom punch thud slam blast bang",
  "sfx/sci-fi": "laser phaser zap spaceship space engine thruster futuristic robot",
  "sfx/game": "arcade retro 8bit chiptune powerup coin pickup jump blip level",
  "sfx/voices": "voice announcer callout spoken shout narrator countdown",
  "sfx/footsteps": "step walk",
  "sfx/comedy": "funny meme joke gag fail cartoon silly awkward reaction",
  "sfx/crowd": "audience people applause clap cheer laugh boo",
  "sfx/shutter": "photo snapshot picture",
  "sfx/foley": "everyday object",
  "sfx/musical": "note instrument tone mallet pluck sparkle drip bubble bell sting stinger fanfare",
  "bgm/boss": "fight battle intense epic",
  "bgm/chill": "calm relaxed lofi peaceful soft",
  "bgm/cinematic": "orchestral trailer score epic dramatic",
  "bgm/electronic": "edm synth dance",
  "mc/ambience": "atmosphere background environment",
  "mc/combat": "fight weapon attack damage",
  "mc/footsteps": "step walk",
  "mc/horror": "scary creepy spooky",
  "mc/machines": "redstone mechanism",
  "mc/magic": "spell enchant",
  "mc/mobs": "creature animal monster",
  "mc/vehicles": "ride",
  "transition/wipe-split": "slide push",
  "transition/mask-iris": "circle reveal shape",
  "transition/light-focus": "glow blur",
  "transition/speed-glitch": "fast energetic",
  "text/build-mask": "reveal",
  "text/pop-scale": "bouncy playful",
  "text/colour-ink": "color tint",
  "text/decode-split": "hacker cipher",
  "adjust/color": "colour white balance",
  "adjust/lightness": "brightness tone",
  "ease/arrive": "land stop",
  "ease/leave": "exit accelerate",
  "ease/reposition": "reframe",
};

// BM25F by repetition: a word in the id or title counts 3x, in the category or its heading 2x, in the description, the
// category's other words and the kind once
const fieldWords = (x: Entry) => {
  const head = words(`${x.id} ${x.title}`),
    cat = words(`${x.cat} ${catLabel(x) === x.cat ? "" : catLabel(x)}`);
  const kind = words(`${x.kind} ${KIND_WORDS[x.kind] ?? ""} ${CAT_WORDS[catKey(x)] ?? ""}`);
  return [...head, ...head, ...head, ...cat, ...cat, ...words(x.about), ...kind];
};

// --kind <kind>[/<category>], a comma list for several. A kind takes its sub-kinds (anim: anim-in, -out, -combo), sound is
// sfx+bgm+mc. A category is its slug (wipe-split), else words of its name or the studio's heading (wipe; sfx/camera is
// shutter, "Camera shutter"). Returns the test and what it could not place, each with the words that put it right
export function kindFilter(asked: string[], pool: Entry[]) {
  const bad: string[] = [],
    read: string[] = [],
    as: string[] = [];
  const tests = asked.map((a) => {
    const [said = "", c = "", ...extra] = a.split("/");
    const k = kindOf(said, pool);
    as.push(c ? `${k}/${c}` : k);
    const ofKind = pool.filter((x) => kindMatches(x.kind, k));
    if (!ofKind.length) {
      bad.push(unknownKind(a, pool));
      return () => false;
    }
    if (extra.length) {
      bad.push(
        `--kind takes <kind>/<category>, one level: ${a} has more. e.g. --kind ${k}/${c}; then words to narrow: bun run find ${extra.join(" ")} --kind ${k}/${c}`,
      );
      return () => false;
    }
    if (c && !ofKind.some((x) => x.cat)) {
      bad.push(
        `${k} has no categories: bun run find --kind ${k} lists all ${ofKind.length}; to narrow, add words: bun run find ${c} --kind ${k}`,
      );
      return () => false;
    }
    if (k !== said) {
      const alsoCat = pool.filter((x) => x.cat && catSlug(x.cat) === catSlug(said)).map(catKey);
      read.push(
        `--kind ${said} read as ${k}${ALIAS_NOTE[k] ? ` (${ALIAS_NOTE[k]})` : ""}${stem(said) === "effect" ? " (a sound effect; a beat effect is --kind velocity, a look --kind adjust, a camera move --kind anim)" : ""}${alsoCat.length ? `; the category is --kind ${[...new Set(alsoCat)].join(",")}` : ""}`,
      );
    }
    if (!c) return (x: Entry) => kindMatches(x.kind, k);
    const cats = new Map(ofKind.filter((x) => x.cat).map((x) => [x.cat, x]));
    const want = plain(c).map(stem);
    // the slug, else words of the name or heading, else the category's other words (sfx/whoosh is sfx/transitions)
    const saying = (of: (cat: string, x: Entry) => string) =>
      [...cats].flatMap(([cat, x]) => {
        const has = words(of(cat, x));
        return want.length && want.every((w) => has.includes(w)) ? [cat] : [];
      });
    const exact = [...cats.keys()].filter((cat) => catSlug(cat) === catSlug(c));
    // a word cut short (sfx/noti, mc/horr) is the start of the category's slug or of a word in its heading
    const cut = catSlug(c);
    const prefix = () =>
      cut.length < 3
        ? []
        : [...cats].flatMap(([cat, x]) =>
            plain(`${cat} ${catLabel(x)}`).some((w) => w.startsWith(cut)) ||
            catSlug(cat).startsWith(cut)
              ? [cat]
              : [],
          );
    const worded = exact.length ? exact : saying((cat, x) => `${cat} ${catLabel(x)}`);
    const named = worded.length ? worded : prefix();
    const keep = new Set(named.length ? named : saying((_, x) => CAT_WORDS[catKey(x)] ?? ""));
    if (!keep.size) {
      bad.push(
        `${k} has no category ${c}. Its categories: ${catList(ofKind)}. e.g. --kind ${catKey(ofKind.find((x) => x.cat)!)}; or search the word in all of ${k}: bun run find ${c} --kind ${k}`,
      );
      return () => false;
    }
    if (!exact.length)
      read.push(
        `--kind ${said}/${c} read as ${[...keep].map((cat) => `${top(k)}/${catSlug(cat)}`).join(", ")}`,
      );
    return (x: Entry) => kindMatches(x.kind, k) && keep.has(x.cat);
  });
  return { bad, read, as, test: (x: Entry) => tests.some((t) => t(x)) };
}
// --kind as an editor says it: a plural (sounds, transitions), or another name (music, titles, camera)
const KIND_ALIAS: Record<string, string> = Object.fromEntries(
  Object.entries({
    music: "bgm",
    song: "bgm",
    soundtrack: "bgm",
    audio: "sound",
    sfxs: "sfx",
    effect: "sfx",
    minecraft: "mc",
    title: "text",
    caption: "text",
    subtitle: "text",
    typeface: "font",
    camera: "anim",
    animation: "anim",
    move: "anim",
    easing: "ease",
    curve: "ease",
    grade: "adjust",
    color: "adjust",
    colour: "adjust",
    look: "adjust",
    motion: "mocap",
    clip: "mocap",
  }).map(([w, k]) => [stem(w), k]),
);
const ALIAS_NOTE: Record<string, string> = {
  anim: "camera moves and shot animations; camera curves are --kind ease",
  bgm: "background music",
  sound: "sfx, bgm and mc together",
  text: "title and caption animations",
  transition: "the cut between two shots",
};
const kindOf = (said: string, pool: Entry[]) => {
  if (pool.some((x) => kindMatches(x.kind, said))) return said;
  const s = stem(said);
  const kinds = [...new Set(pool.map((x) => top(x.kind))), "sound"];
  // another name gives way to a category of that name (effects is adjust/effects, curve is anim/curve)
  const isCat = pool.some((x) => x.cat && catSlug(x.cat) === catSlug(said));
  return kinds.find((k) => stem(k) === s) ?? (isCat ? undefined : KIND_ALIAS[s]) ?? said;
};
// "sfx/typing 37, sfx/clicks 93 (Clicks) ...": a kind's categories as --kind takes them, biggest first, with the studio's
// heading where it says more
const catList = (xs: Entry[]) => {
  const by = new Map<string, Entry[]>();
  for (const x of xs) if (x.cat) by.set(catKey(x), [...(by.get(catKey(x)) ?? []), x]);
  return [...by]
    .toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, ys]) => {
      const label = catLabel(ys[0]!);
      return `${key} ${ys.length}${catSlug(label) === key.split("/")[1] ? "" : ` (${label})`}`;
    })
    .join(", ");
};
// Narration is generated per film, never a vault entry; the vault's sfx/voices are game-announcer one-liners
const SPOKEN = new Set(
  words("narration narrator voiceover voice speech dialogue dialog tts spoken voiceline"),
);
const SPOKEN_NOTE =
  "a spoken line (narration, voiceover, dialogue) is made, not found: in a film folder, bun run voice:gen reads the script in src/edit.json (run it bare first, a preview; --yes spends voice credits); how: bun run skills get core --ref voice. The vault's --kind sfx/voices are game-announcer one-liners only";
// Minecraft's soundtrack and discs: scripts/build_mc_sound_vault.mjs leaves music/ and records/ out of the vault
// A named grade the vault has no entry for: the adjust sliders or a LUT make it
const LOOK_WORDS = new Set(words("lut luts vhs teal bleach grading"));
const MC_MUSIC = new Set(words("c418 pigstep otherside disc jukebox records soundtrack"));
const MC_MUSIC_NOTE =
  'Minecraft\'s own music (its soundtrack and music discs) is not in the vault: the build leaves music/ and records/ out. Mojang clears only its "Minecraft Creator-Safe" playlist for videos (minecraft.net/en-us/article/can-i-use-minecraft-music-), so a track is picked and added by hand, with "Music courtesy of Mojang Studios". Minecraft-themed music here: bun run find --kind bgm/boss (the Wither Storm mod soundtrack, credit the mod)';
const unknownKind = (asked: string, pool: Entry[]) => {
  if (SPOKEN.has(stem(asked))) return `--kind ${asked}: ${SPOKEN_NOTE}`;
  // a category asked as a kind (typing, shutter, horror): the kinds that have it
  const slug = catSlug(asked);
  const asCat = [
    ...new Set(
      pool
        .filter(
          (x) => x.cat && (catSlug(x.cat) === slug || words(catLabel(x)).includes(stem(slug))),
        )
        .map(catKey),
    ),
  ];
  return asCat.length
    ? `${asked} is a category, not a kind: --kind ${asCat.join(",")}`
    : `Unknown --kind ${asked}. Kinds: ${counts(pool)}, or sound for sfx+bgm+mc; each takes a /<category> (bun run find --kind <kind> lists them). e.g. bun run find door --kind sfx`;
};

// The Sound panel's filters: Real / Studio recordings or Code-gen (sfx, bgm), Vanilla or Modded packs (mc)
const ORIGINS = { real: "Real / Studio: recordings", synth: "Code-gen: made in code by earshot" };
const EDITIONS = { vanilla: "Vanilla Minecraft", modded: "Modded packs" };
const originOfEntry = (x: Entry) =>
  originOf({ name: x.id, source: x.src, origin: x.data?.origin as "real" | "synth" | undefined });
const editionOfEntry = (x: Entry) => editionOf({ source: x.src });
// What a sound asks of a YouTube upload. Mojang's usage guidelines (minecraft.net/usage-guidelines) allow its game audio in
// monetised Minecraft videos; mods ship sounds under code licences (MIT, Apache, LGPL, GPL, PolyForm Shield) whose notice
// terms were written for software, so the safe reading is a credit, and whether copyleft reaches a video is untested
const LICENSES = {
  free: "nothing to do: no credit, no Content ID claim (CC0, Mixkit, Pixabay, earshot)",
  credit: "CC BY: name the author and licence in the video description",
  claim: "YouTube Content ID claims the video when uploaded",
  minecraft:
    "Mojang's own game sounds: fine in a Minecraft video under Mojang's usage guidelines, not in other videos",
  mod: "a mod's sounds under a code licence (MIT, Apache, LGPL, GPL, PolyForm Shield): name the mod and its licence in the description",
};
const CODE_LICENSE = /\b(?:MIT|Apache|L?GPL|PolyForm)\b/i;
const licenseOf = (x: Entry): keyof typeof LICENSES => {
  const l = String(x.data?.license ?? "");
  return x.data?.contentId
    ? "claim"
    : /\bCC[ -]BY\b/i.test(l)
      ? "credit"
      : /^Minecraft\b/.test(l)
        ? "minecraft"
        : CODE_LICENSE.test(l)
          ? "mod"
          : "free";
};
// Other words for a filter's values; anything else --license gets is matched against the licences' own names (mit, lgpl)
const VALUE_ALIAS: Record<string, Record<string, string>> = {
  "--license": {
    none: "free",
    nothing: "free",
    "no-credit": "free",
    "royalty-free": "free",
    attribution: "credit",
    "cc-by": "credit",
    ccby: "credit",
    contentid: "claim",
    "content-id": "claim",
    cid: "claim",
    claimed: "claim",
    mojang: "minecraft",
    vanilla: "minecraft",
    mods: "mod",
    modded: "mod",
    code: "mod",
    "open-source": "mod",
  },
  "--origin": {
    recorded: "real",
    recording: "real",
    studio: "real",
    synthesized: "synth",
    synthetic: "synth",
    code: "synth",
    codegen: "synth",
    "code-gen": "synth",
    generated: "synth",
    procedural: "synth",
  },
  "--edition": {
    minecraft: "vanilla",
    mojang: "vanilla",
    base: "vanilla",
    mod: "modded",
    mods: "modded",
    pack: "modded",
    packs: "modded",
  },
};

export function rank(
  entries: Entry[],
  query: string,
  opt: { kinds?: string[]; n?: number } = {},
): (Entry & { score: number; matched: number; of: number })[] {
  const pool = opt.kinds?.length
    ? entries.filter((x) => opt.kinds?.some((k) => kindMatches(x.kind, k)))
    : entries;
  const docs = pool.map(fieldWords);
  const avg = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
  const q = slotsOf(query);
  const df = new Map(q.flat().map((w) => [w, docs.filter((d) => d.includes(w)).length] as const));
  const K1 = 1.2,
    B = 0.75;
  const termScore = (d: string[], w: string) => {
    const tf = d.filter((t) => t === w).length,
      n = df.get(w) ?? 0;
    if (!tf) return 0;
    const idf = Math.log(1 + (pool.length - n + 0.5) / (n + 0.5));
    return (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.length) / avg));
  };
  return pool
    .map((x, i) => {
      const d = docs[i] ?? [];
      // a slot scores its best term: "crossfade" is matched by dissolve as fully as by its own word
      const per = q.map((slot) => Math.max(...slot.map((w) => termScore(d, w))));
      const matched = per.filter((s) => s > 0).length;
      const bm25 = per.reduce((s, v) => s + v, 0);
      // coord (Lucene's classic similarity): a hit with 3 of 4 words outranks one rare word said often
      return { ...x, score: (bm25 * matched) / (q.length || 1), matched, of: q.length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opt.n ?? Infinity);
}

type SoundItem = {
  name: string;
  kind?: string;
  category?: string;
  family?: string;
  variant?: number;
  title?: string;
  for?: string;
  source?: string;
  license?: string;
  contentId?: boolean;
  seconds?: number;
  url?: string;
  file?: string;
  peaks?: number[];
};

export function soundEntries(items: SoundItem[], fold = true): Entry[] {
  const groups = new Map<string, SoundItem[]>();
  for (const it of items) {
    const key = fold && it.family ? `family:${it.family}` : `name:${it.name}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  return [...groups.values()].map((takes) => {
    const first = takes.toSorted((a, b) => (a.variant ?? 0) - (b.variant ?? 0))[0] as SoundItem;
    const note = [
      /\bCC[ -]BY\b/i.test(first.license ?? "")
        ? `credit: ${first.license}`
        : CODE_LICENSE.test(first.license ?? "") && `credit the mod: ${first.license}`,
      first.contentId && "YouTube Content ID: claimed if uploaded",
    ]
      .filter(Boolean)
      .join(", ");
    return {
      kind: first.kind ?? "sfx",
      id: first.name,
      cat: first.category ?? "",
      title: first.title ?? first.name,
      about: first.for ?? "",
      ...(first.source && { src: first.source }),
      takes: takes.length,
      secs: first.seconds,
      ...(note && { note }),
      data: { ...first, takes: takes.map((t) => t.name) },
    };
  });
}

// Mocap clips from the catalogue clip-catalog/catalog.sh measured (vault/motion/catalog/<lib>.jsonl), with the notes
// written by eye (review.json); category = the posture it starts and ends in. catalog.py keeps the body filters and Jev's rerank.
type Clip = { ref: string; dur?: number; start?: string; end?: string; [k: string]: unknown };
type Review = { desc?: string; mood?: string[]; flaw?: string };
function mocapEntries(): Entry[] {
  const dir = join(ROOT, "vault/motion/catalog");
  const review: Record<string, Review> = readJson(join(dir, "review.json"));
  return ["mixamo", "ual1", "ual2"].flatMap((lib) => {
    const f = join(dir, `${lib}.jsonl`);
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const c = JSON.parse(l) as Clip,
          r = review[c.ref] ?? {};
        return {
          kind: "mocap",
          id: c.ref,
          cat: c.start === c.end ? (c.start ?? "") : `${c.start}>${c.end}`,
          title: (c.ref.split("/")[1] ?? "").replace(/_[0-9a-f]{8}$/, "").replace(/_/g, " "),
          about: [r.desc, r.mood?.length && `(${r.mood.join(", ")})`].filter(Boolean).join(" "),
          src: lib,
          secs: c.dur,
          ...((r.flaw || (c.dur ?? 1) < 0.1) && {
            note: r.flaw ? `flaw: ${r.flaw}` : "one frame: a still pose",
          }),
          data: { ...c, ...r, checked: c.ref in review },
        };
      });
  });
}

export function presetEntries(): Entry[] {
  type Preset = {
    id: string;
    title?: string;
    tip?: string;
    cat?: string;
    category?: string;
    group?: string;
  };
  // a sub-kind with no groups of its own is one group of its kind: transition-ease is --kind transition/ease
  const sub = (kind: string) => (kind.includes("-") ? sentenceSlug(kind.split("-")[1]!) : "");
  const list = (kind: string, xs: readonly Preset[], file: string) =>
    xs.map((x) => ({
      kind,
      src: `film-stage/${file}.ts`,
      id: x.id,
      cat: x.category ?? x.cat ?? x.group ?? sub(kind),
      title: x.title ?? x.id,
      about: x.tip ?? "",
      data: { ...x },
    }));
  const eases = Object.entries(EASE_JOBS).flatMap(([group, { eases, job }]) =>
    eases.map((id) => ({
      id,
      group,
      tip: `${easeAbout((EASES as Record<string, (t: number) => number>)[id]!)}; for ${job}`,
    })),
  );
  return [
    ...list("transition", TRANSITIONS, "transitions"),
    ...list("transition-ease", TRANSITION_EASES, "transitions"),
    ...list("anim-in", ANIMS.in, "animate"),
    ...list("anim-out", ANIMS.out, "animate"),
    ...list("anim-combo", ANIMS.combo, "animate"),
    ...list("anim-curve", ANIM_CURVES, "animate"),
    ...list("text-in", TEXT_IN, "titles"),
    ...list("text-out", TEXT_OUT, "titles"),
    ...list(
      "shape",
      Object.entries(SHAPES).map(([id, s]) => ({ id, ...s, cat: "Marks" })),
      "titles-catalog",
    ),
    ...list("shape-in", SHAPE_IN, "titles"),
    ...list("shape-out", SHAPE_OUT, "titles"),
    ...list("font", FONTS, "titles"),
    ...list("adjust", ADJUSTMENTS, "grade-color"),
    ...list(
      "velocity",
      VELOCITY_EFFECTS.map((id) => ({ id, ...VELOCITY_LOOKS[id] })),
      "velocity",
    ),
    ...list("ease", eases, "camera"),
  ];
}

// An ease in words, read off its own curve: an editor asks for "a slow start" or "a wind-up", not for snapOut
export function easeAbout(f: (t: number) => number): string {
  const y = Array.from({ length: 101 }, (_, i) => f(i / 100));
  const step = y.slice(1).map((v, i) => v - y[i]!);
  const top = Math.max(...step),
    peak = step.indexOf(top) / 100;
  const [q1, half, q3] = [f(0.25), f(0.5), f(0.75)];
  const shape = y.every((v, i) => Math.abs(v - i / 100) < 0.02)
    ? "constant speed, no easing"
    : q1 > 0.35 && q3 < 0.65
      ? "fast at both ends, drifting slowly through the middle"
      : peak < 0.2
        ? q1 > 0.9
          ? "almost instant: lands at once, then a long still settle"
          : q1 > 0.75
            ? "fast start: a sharp snap that brakes hard into rest"
            : q1 > 0.55
              ? "fast start: a smooth glide that slows into rest"
              : q1 > 0.45
                ? "fast start: a gentle settle, slowing steadily into rest"
                : "a soft slow-down, barely braking"
        : peak > 0.8
          ? q3 < 0.25
            ? "slow start, fast end: a hard launch that barely moves, then rushes off"
            : q3 < 0.4
              ? "slow start, fast end: a strong build, speeding up hard"
              : q3 < 0.56
                ? "slow start, fast end: a steady build"
                : "slow start: a soft build, still gentle at the end"
          : `${top > 0.028 ? "a strong" : top < 0.014 ? "a very gentle" : "an"} S-curve${peak < 0.4 ? ": a short ease in, fastest early, then a long ease into rest" : peak > 0.55 ? ": a long slow build, fastest late, then a short ease into rest" : ", slow start and slow stop"}`;
  return [
    shape,
    Math.min(...y) < -0.01 && "pulls back first, a wind-up before it goes",
    Math.max(...y) > 1.01 && "overshoots the key and settles back",
    `${Math.round(q1 * 100)}% of the way a quarter of the time in, ${Math.round(half * 100)}% at half`,
  ]
    .filter(Boolean)
    .join("; ");
}

// The vault's sound folders as the studio reads them (live-studio/src/sound.mjs findVaults): <kind>/<category>/<name>.<ext>
// with SOURCES.json (credits) and PEAKS.json (seconds) beside them
const readJson = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
function vaultSounds(): SoundItem[] {
  const mc = [join(LOCAL, "mc-sound"), join(EXTERNAL, "mc-sound")].find(existsSync);
  const out: SoundItem[] = [];
  for (const dir of [mc, join(LOCAL, "sound")].filter((d): d is string => !!d && existsSync(d))) {
    const sources = readJson(join(dir, "SOURCES.json")),
      peaks = readJson(join(dir, "PEAKS.json"));
    for (const kind of readdirSync(dir).filter((k) => SOUND.includes(k))) {
      for (const category of readdirSync(join(dir, kind))) {
        const files = readdirSync(join(dir, kind, category)).filter((f) =>
          /\.(?:wav|ogg)$/i.test(f),
        );
        for (const f of files) {
          const name = basename(f, extname(f));
          out.push({
            ...sources[name],
            name,
            kind,
            category,
            seconds: peaks[name]?.seconds,
            peaks: peaks[name]?.peaks,
            file: relative(ROOT, join(dir, kind, category, f)).replaceAll("\\", "/"),
          });
        }
      }
    }
  }
  return out;
}

// Run from a film folder: its own sounds too, from the folder package.json "live-studio".sfx names (as the studio lists them)
function filmSounds(film: string): SoundItem[] {
  const conf = readJson(join(film, "package.json"))["live-studio"];
  if (typeof conf?.sfx !== "string") return [];
  const dir = join(film, conf.sfx);
  if (!existsSync(dir)) return [];
  const sources = readJson(join(dir, "SOURCES.json"));
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(?:wav|ogg)$/i.test(f))
    .map((f) => {
      const name = basename(f, extname(f)),
        [top = "", ...rest] = f.split(/[\\/]/).slice(0, -1);
      const kind = sources[name]?.kind ?? (SOUND.includes(top) ? top : "sfx");
      const category = (SOUND.includes(top) ? rest : [top, ...rest]).join("/");
      return {
        ...sources[name],
        name,
        kind,
        category,
        source: "this-film",
        file: join(conf.sfx, f).replaceAll("\\", "/"),
      };
    });
}

export const allEntries = (fold = true, film = process.cwd()) => [
  ...presetEntries(),
  ...soundEntries([...filmSounds(film), ...vaultSounds()], fold),
  ...mocapEntries(),
];

// A description is printed only when it says at least two words the id, title and category don't (Minecraft's own
// "for" lines just repeat the event id); every vault sound is already licence-checked, so only Content ID is flagged
const tells = (x: Entry) => {
  const shown = new Set(words(`${x.id} ${x.title} ${x.cat} minecraft`));
  return (
    words(x.about.replace(/\([^)]*\)/g, "")).filter((w) => !/^\d+$/.test(w) && !shown.has(w))
      .length >= 2
  );
};
const line = (x: Entry, lead = "") => {
  // a Minecraft sound says what the game's subtitles call it ("Door creaks"), the plainest account of what is heard
  const heard = Array.isArray(x.data?.heard) ? (x.data.heard as string[]).join("; ") : "";
  const said = heard ? `heard: ${heard}` : !tells(x) ? "" : x.about;
  const about = said.length > 90 ? `${said.slice(0, 89)}…` : said;
  const synth = (x.kind === "sfx" || x.kind === "bgm") && originOfEntry(x) === "synth";
  const tags = [x.src, synth && "made in code", x.note].filter(Boolean).join(", ");
  return [
    `${lead}${x.kind}${x.cat ? `/${x.cat}` : ""}`,
    `${x.id}${(x.takes ?? 1) > 1 ? ` (${x.takes} takes)` : ""}`,
    x.secs ? `${x.secs.toFixed(1)}s` : "",
    `${x.title}${about && about !== x.title ? ` — ${about}` : ""}`,
    tags ? `[${tags}]` : "",
  ]
    .filter(Boolean)
    .join("  ");
};

// Jev Choice: one option per entry; past HEAT entries the list runs in shuffled heats whose top KEEP meet in a final
// (catalog.py rerank explains why: rounded probabilities, neighbours knocking each other out)
const HEAT = 200,
  KEEP = 8,
  POOL = 250;
// jev.py's own notes (a route's quota spent, its cost): parallel heats repeat them, so each is printed once per run
const jevNotes = new Set<string>();
const jevText = (x: Entry) => `${x.kind} ${x.cat}: ${x.title}. ${x.about}`.trim();
type Answers = Record<string, { probabilities?: Record<string, number>; noul?: number }>;
const jevAsk = (state: unknown, questions: Record<string, unknown>) =>
  new Promise<Answers>((done, fail) => {
    const py = spawn("python", [join(ROOT, "packages/clip-catalog/jev.py")], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    py.stdout.on("data", (d) => (out += d));
    py.stderr.on("data", (d) => (err += d));
    py.on("error", fail);
    py.on("close", (code) => {
      const said = err.split("\n").filter((l) => l.trim() && !jevNotes.has(l));
      for (const l of said) jevNotes.add(l);
      if (code) return fail(new Error(said.at(-1)?.trim() || `jev.py exited ${code}`));
      if (said.length) console.error(said.join("\n"));
      done(JSON.parse(out) as Answers);
    });
    py.stdin.end(JSON.stringify({ state, questions }));
  });
const jevChoice = async (scene: string, group: Entry[]): Promise<[number, Entry][]> => {
  const criteria = Object.fromEntries(group.map((x, i) => [`c${i}`, jevText(x)]));
  const probs =
    (
      await jevAsk(`What a film editor is looking for: ${scene}`, {
        pick: { type: "choice", instructions: "Which entry fits best?", criteria },
      })
    ).pick?.probabilities ?? {};
  return group.map((x, i) => [probs[`c${i}`] ?? 0, x]);
};
// A vote always picks something, even when nothing in the kind is what was asked (TypeSafe: a "none of the above" option
// often fails; ask a companion Noul instead, as catalog.py does for mocap). So each entry shown gets its own yes/no, all
// in one request: the probability that it really is what the editor asked for
export const FIT_YES = 0.7,
  FIT_NO = 0.3;
const jevFits = async (scene: string, shown: Entry[]) => {
  const state = {
    wanted: `What a film editor is looking for: ${scene}`,
    ...Object.fromEntries(shown.map((x, k) => [`entry_${k + 1}`, jevText(x)])),
  };
  const qs = Object.fromEntries(
    shown.map((_, k) => [
      `fit_${k + 1}`,
      {
        type: "noul",
        instructions: `Is \`entry_${k + 1}\` what \`wanted\` asks for?`,
        criteria: {
          true: "The editor would use this entry as it is: it is the thing, sound, look or motion asked for",
          false: "It is a different thing, or only loosely related to what was asked",
        },
      },
    ]),
  );
  const ans = await jevAsk(state, qs);
  return shown.map((_, k) => ans[`fit_${k + 1}`]?.noul ?? 0);
};

export async function jevRank(scene: string, pool: Entry[]) {
  let list = pool;
  if (list.length > HEAT) {
    // Fisher-Yates on a fixed-seed Park-Miller generator: the same query ranks the same
    let seed = 7;
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed = (seed * 16807) % 2147483647;
      const j = seed % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j] as Entry, shuffled[i] as Entry];
    }
    const heats: Entry[][] = [];
    for (let k = 0; k < shuffled.length; k += HEAT) heats.push(shuffled.slice(k, k + HEAT));
    const results: [number, Entry][][] = [];
    for (let k = 0; k < heats.length; k += 4)
      results.push(...(await Promise.all(heats.slice(k, k + 4).map((h) => jevChoice(scene, h)))));
    list = results.flatMap((r) =>
      r
        .filter(([p]) => p > 0)
        .sort((a, b) => b[0] - a[0])
        .slice(0, KEEP)
        .map(([, x]) => x),
    );
  }
  return jevChoice(scene, list);
}

// The vote over the pool, best first, then a fit for each of the first `show`
export async function jevJudge(scene: string, pool: Entry[], show: number): Promise<Voted[]> {
  const voted = (await jevRank(scene, pool)).filter(([p]) => p > 0).sort((a, b) => b[0] - a[0]);
  const top = voted.slice(0, show);
  if (!top.length) return voted;
  const fits = await jevFits(
    scene,
    top.map(([, x]) => x),
  );
  return [...top.map(([p, x], i): Voted => [p, x, fits[i]]), ...voted.slice(show)];
}

const HELP = `Usage: bun run find <words> [options]     (works from a film folder too, and then also searches the film's own sounds)
       bun run find --show <id[,id]>      everything about one entry: what it does, its settings, a line to paste, how to see it

Finds what a film can name: vault sounds, mocap clips, transitions, camera anims and curves, text and shape voices,
fonts, adjust sliders, beat effects, camera eases. One line per hit: kind/category  id-to-write  length  title —
description  [source], then where that id goes in the film's src/timeline and what to try next.

Options:
  --kind <k[,k]>   sfx, bgm, mc (Minecraft) or sound (all three); mocap; transition anim text shape font adjust velocity ease
                   each with /<category>, the studio's groups: --kind sfx/typing, mc/horror, transition/wipe, text/pop
                   (a word of the group is enough, and plain names work: music is bgm, titles is text, camera is anim;
                   the first line says how a loose one was read). --kind <kind> alone: its groups with counts, then
                   every entry when 60 or fewer; --kind <kind>/<category>: that group, and the words its entries are
                   named by when it is long
  --source <s[,s]> where it comes from: minecraft and each mod pack by name (alexs-caves, quality-sounds ...), earshot,
                   mixkit, mixamo, film-stage (every preset) or one preset file
  --origin <o>     sfx and bgm: real (recordings, the studio's Real / Studio) or synth (made in code, its Code-gen)
  --edition <e>    Minecraft sounds: vanilla (the game itself) or modded (mod packs)
  --license <l>    sounds by what a YouTube upload must do: free (nothing), credit (CC BY: name the author), claim
                   (Content ID claims the video), minecraft (Mojang's game sounds: Minecraft videos only), mod (a mod's
                   code licence: credit the mod); or a word of a licence's own name: --license mit, --license lgpl
  --dur <min-max>  length in seconds, sounds and mocap clips: --dur 0-1 a short hit, --dur 120-600 a long track
  Any filter without a value lists its values with counts: bun run find --source lists every source and mod pack.
  Other names work and the first line says how they were read: --licence, --type/--category (--kind), --pack/--mod
  (--source), --length/--duration (--dur), --limit (-n); values too: --origin recorded, --edition mods, --license cc-by
  -n <N>           hits shown (default 12)
  --all            every take of a sound family on its own line (default: one line per family, "(N takes)")
  --jev            rank by meaning with Jev, a small AI judge that reads any language: 1-3 s, under $0.01 a search. With
                   --kind it reads every entry of those kinds; without, it only reorders the word matches. Each hit
                   shown also gets "fits" 0-1, Jev's own yes that it is what you asked for; the next: line then says
                   FOUND (use the first), UNSURE (--show it first) or NOT IN THE VAULT (do not use them: make it)
  --show <id>      the entry in full (ids are the second column; any take of a family)
  mocap by body:   --from <posture> (at its start) --to <posture> (at its end) --has <posture> (anywhere in it)
                   --still (stays within 0.3 m) | --moves, --loop, --energy 10-40 (deg/s: idle ~10, walk ~30,
                   jump 200), --dur; hands: --head (at his head) --up (above it) --ground (on the floor), --bend
                   (bent over), --air yes|no, --look 45 (head turn, deg); --mood scared, --prop chair (clips checked
                   by eye only; a wrong one lists them); --fights keeps weapons and fights (left out by default).
                   With words or --jev "<scene>"; a wrong posture lists them
  Any filter alone (--kind, --source, --origin, --edition, --license, --dur) lists what it keeps.

Words first: free, offline, instant, English only (translate first). Name the thing, not the moment: "whoosh", not "the
camera flies past"; Minecraft sounds also match what the game's subtitles say ("creeper hisses", "door creaks"). A sound
ask without --kind also meets mocap clips and presets: add --kind sound. No hit: other plain words, then browse the
groups (--kind sfx, then --kind sfx/<group>). Music has no tags beyond its group: for another mood, list a bgm group
and rank it by ear (earshot rank). --jev (paid) last, when the cue is a feeling or a moment ("the moment he realises
the door is locked") and words and groups miss it.
Every vault sound may be used on YouTube: a row tagged credit needs the author (or the mod) named in the video
description, one tagged Content ID gets the video claimed (--license free keeps neither); Minecraft's own sounds are
fine in a Minecraft video. Mixamo and Quaternius (ual1, ual2) clips are free to use in videos. --show <id> ends with
where to make your own of that kind when no built-in fits.

Examples:
  bun run find creaky door
  bun run find impact --kind sfx -n 20
  bun run find --kind sfx                  its groups, with counts and filters
  bun run find --kind sfx/whoosh           one group whole (whoosh is in sfx/transitions)
  bun run find cave --kind mc/horror --edition vanilla
  bun run find --kind bgm --origin real
  bun run find whoosh --kind sfx --dur 0-1 --license free
  bun run find --jev --kind transition "a memory slipping away"
  bun run find --jev --kind mocap "he searches the floor for something hidden"
  bun run find sit --from stand --to sitFloor
  bun run find --show dissolve`;

const tally = (keys: string[]) => {
  const c = new Map<string, number>();
  for (const k of keys) c.set(k, (c.get(k) ?? 0) + 1);
  return [...c]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
};
const counts = (xs: Entry[]) => tally(xs.map((x) => top(x.kind)));

const levenshtein = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] ?? 0;
      row[j] = Math.min(cur + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] ?? Infinity;
};

// The vault's closest spelling of a word no entry has (a typo, or a word cut short)
const closest = (word: string, pool: Entry[]) => {
  const vocab = new Map<string, number>();
  for (const x of pool)
    for (const w of plain(`${x.id} ${x.title} ${x.cat}`))
      if (w.length > 2 && !/\d/.test(w)) vocab.set(w, (vocab.get(w) ?? 0) + 1);
  // a 3-letter word is one letter from too many others (dof -> dot, fog -> log) for a guess to mean anything
  const max = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
  let best: [string, number, number] | undefined;
  for (const [w, n] of vocab) {
    if (w === word) continue;
    const d =
      word.length >= 4 && w.startsWith(word)
        ? 1
        : Math.abs(w.length - word.length) > max
          ? Infinity
          : levenshtein(word, w);
    if (d <= max && (!best || d < best[1] || (d === best[1] && n > best[2]))) best = [w, d, n];
  }
  return best?.[0];
};

// Query words that name a kind ("tense music"): the hint to filter by it instead of matching titles that say "music"
const KIND_NAMED: Record<string, string> = Object.fromEntries(
  Object.entries({
    music: "bgm",
    song: "bgm",
    soundtrack: "bgm",
    bgm: "bgm",
    sfx: "sfx",
    transition: "transition",
    font: "font",
    typeface: "font",
    mocap: "mocap",
    minecraft: "mc",
    title: "text",
    caption: "text",
    subtitle: "text",
  }).map(([w, k]) => [stem(w), k]),
);

// The words a long list's entries are named by, most common first ("zombie 40, say 31 ..."): its sub-groups, to search inside
const namedBy = (xs: Entry[]) => {
  const same = new Set(xs.flatMap((x) => plain(`${x.kind} ${x.cat} ${catLabel(x)} minecraft`)));
  const seen = xs.flatMap((x) => [
    ...new Set(
      plain(x.title).filter(
        (w) => w.length > 2 && !/\d/.test(w) && !same.has(w) && !STOP.has(stem(w)),
      ),
    ),
  ]);
  return tally(seen).split(", ").slice(0, 24).join(", ");
};
// A track's only tag is its folder: a mood no folder names has to be heard
const MOODS = new Set(
  words(
    "sad happy tense upbeat dramatic epic dark uplifting melancholy hopeful scary eerie triumphant romantic horror creepy spooky suspense mysterious",
  ),
);
const BGM_MOOD =
  'a track says no more than its group (bun run find --kind bgm lists the groups): for a mood or genre a group does not name (sad, tense, upbeat), list the nearest group and let earshot rank "<the mood>" <its files> choose by ear';

// What to do when nothing in the vault fits, for the kinds asked
const MAKE_SOUND =
  'a sound, in the film folder: bun run sfx:get find "<words>" (a Freesound CC0 recording; pin it, then bun run sfx:get), or earshot sfx list --kind hit then earshot sfx render <id> -o sound/sfx/<name>.wav (made in code); more: the real-sound skill (licensed recordings), the earshot skill (earshot forge), bun run skills get core --ref sound';
const MAKE_MOCAP =
  "a move: key Steve's body by hand (steve.json moves[] pose instead of clip), or retarget a new clip into vault/motion";
const HOOKS = "src/scene.ts (hooks: bun run skills get core --ref contract)";
const MAKE_LOOK =
  'a look (teal and orange, VHS, bleach bypass): no named looks; mix the adjust sliders (bun run find --kind adjust) or load a .cube LUT, adjust.json items[].grade.lut {"url","name","amount"}';
const make = (kinds: string[] | undefined, entries: Entry[]) => {
  if (!kinds)
    return [`an effect, overlay or look: the film's own, in ${HOOKS}`, MAKE_SOUND, MAKE_MOCAP];
  const one = (k: string) => {
    if (SOUND.includes(k) || k === "sound") return MAKE_SOUND;
    if (k === "mocap") return MAKE_MOCAP;
    if (k === "adjust") return MAKE_LOOK;
    if (k === "text")
      return 'a plain title or caption needs no preset: text.json items[] {"kind": "text", "text": "…", "from": 0, "to": 3} (+ "in"/"out" voices: bun run find --kind text)';
    const src = entries.find((x) => kindMatches(x.kind, k))?.src;
    return `a${/^[aeiou]/.test(k) ? "n" : ""} ${k}: the film's own, in ${HOOKS}${src ? `, shaped like those in packages/${src.replace("/", "/src/")}` : ""}`;
  };
  return [...new Set(kinds.map(one))];
};

// catalog.py's line, read out (its docstring and --help say the same)
const MOCAP_COLUMNS =
  "columns: id, seconds, postures in order (stand>kneel), travel m to his left,m ahead, turn deg, energy (mean joint speed deg/s: idle ~10, walk ~30, jump 200), look (head turn on the neck, deg), then seconds of: head (a hand at his head), up (a hand above it), ground (a hand on the floor), bend (bent over on his feet), air (off the floor); LOOP = last frame meets the first (plays on repeat); (unchecked) = nobody has looked at it yet; FLAW = a fault seen by eye";

// Postures the catalogue measured (stand, kneel, sitFloor ...) and the hint that lists them
const postures = (pool: Entry[]) =>
  [...new Set(pool.flatMap((x) => (x.kind === "mocap" ? (x.data?.seq ?? []) : [])))].toSorted();
const mocapNext = (pool: Entry[]) => {
  const ps = postures(pool.filter((x) => x.kind === "mocap")).join(" ");
  return `mocap: one clip in full (its timeline, where it leaves him): bun run find --show <id>. By body, any mix: --from|--to|--has <posture>${ps ? ` (${ps})` : ""}, --still|--moves, --loop, --dur 1-6, --energy 10-40, a hand --head|--up|--ground, --bend, --air yes|no, --look 45, --mood <m>, --prop <p> (clips checked by eye; --mood or --prop alone lists them), --fights (weapons, left out by default)`;
};
// earshot rank over the files a list shows: the first few, as each call takes ~40 s whatever their number
const HEAR_MAX = 8;
const hearThem = (what: string, files: string[]) =>
  `hear them (you cannot): earshot rank "${what.replaceAll('"', "")}" ${files.slice(0, HEAR_MAX).join(" ")} --top 3${files.length > HEAR_MAX ? `  (the first ${HEAR_MAX} of ${files.length})` : ""}`;

// ---------- --show: one entry in full, from the catalogue record behind its line

const timelineDir = () =>
  existsSync(join(process.cwd(), "src/timeline")) ? "src/timeline" : "films/<film>/src/timeline";
const num = (v: unknown, d = 2) => (typeof v === "number" ? +v.toFixed(d) : undefined);
const BARS = "▁▂▃▄▅▆▇█";
// A sound's loudness over time from its PEAKS.json bins (20 ms): the shape at a glance and the times the Studio's Sync
// buttons would use (attack, peak, end), read off the bins so good to ~20 ms
const envelope = (peaks: number[], step = 0.02) => {
  const loud = Math.max(...peaks);
  if (!(loud > 0)) return "silent";
  const n = Math.min(32, peaks.length),
    per = peaks.length / n;
  const bars = Array.from({ length: n }, (_, i) => {
    const a = Math.floor(i * per),
      seg = peaks.slice(a, Math.max(a + 1, Math.floor((i + 1) * per)));
    return BARS[Math.min(7, Math.round((Math.max(...seg) / loud) * 7))];
  }).join("");
  let end = peaks.length - 1;
  while (end > 0 && (peaks[end] ?? 0) <= loud * 0.003) end--;
  const at = (i: number) => (i * step).toFixed(2);
  return `${bars}  attack ${at(peaks.findIndex((v) => v >= loud * 0.1))} s, peak ${at(peaks.indexOf(loud))} s, dies out ${at(end)} s`;
};
const TL: Record<string, string> = {
  body: "body",
  moves: "travel",
  turns: "turns",
  gaze: "gaze",
  handR: "right hand",
  handL: "left hand",
  tempo: "tempo",
};

// a vault file is kept relative to the repo root, a film's own to the film: said from where find runs
const soundFile = (file: string) =>
  existsSync(file) ? file : relative(process.cwd(), join(ROOT, file)).replaceAll("\\", "/");

// --show's last word on an entry: where a film makes its own of that kind when no built-in is right (the hooks are the
// contract's "Your own work" table; the studio's Film tab lists what a film adds)
const VOICE_OWN =
  'a voice: {id, title, tip, len, cat, step(st, p, cfg, it)} in makeTitles\' 4th argument in src/scene.ts ({items, text: {"in": [...], "out": [...]}, shape: {"in", "out"}}); step changes the look st at progress p. Built-ins: packages/film-stage/src/titles-catalog.ts, drawn by titles-look.ts';
const OWN: Record<string, string> = {
  transition:
    "a transition: {id, title, tip, category, glsl} passed as makeTransitions' last argument in src/scene.ts; glsl defines vec4 transition(vec2 uv) from getFromColor, getToColor and progress (copy a built-in's from packages/film-stage/src/transitions.ts)",
  anim: "an anim: {id, title, cat, tip, len, apply(cam, u, t, k)} added to the anims src/scene.ts passes to animate; apply moves cam.p, cam.l, cam.fov at progress u and returns how black the frame goes. Built-ins: packages/film-stage/src/animate.ts",
  text: VOICE_OWN,
  "shape-voice": VOICE_OWN,
  shape:
    'a mark: makeTitles\' 4th argument in src/scene.ts, shapes: {"<kind>": {title, tip, measure(it, k, W, H) => {w, h}, draw(g, it, m, look)}}, then text.json items[] {"kind": "<kind>", ...}. Built-ins: packages/film-stage/src/titles.ts',
  font: "a font: {id, title, css, tip} in FONTS (packages/film-stage/src/titles-catalog.ts) plus its @fontsource import at the top of packages/film-stage/src/titles.ts; shared by every film, OFL faces only",
  adjust: MAKE_LOOK,
  velocity:
    'an effect: makeVelocity(renderer, {"<name>": (frame, optics) => a partial CameraOptics}) in src/scene.ts. Built-ins: packages/film-stage/src/velocity.ts',
  ease: "a curve: a function of t (0-1 to 0-1) added to EASES from film-stage/camera in src/scene.ts (cameraAt reads EASES by name; draw.eases is what the studio draws). Built-ins: packages/film-stage/src/camera.ts",
  sound: MAKE_SOUND,
  mocap: MAKE_MOCAP,
};
const ownOf = (kind: string) =>
  OWN[
    SOUND.includes(kind)
      ? "sound"
      : kind.startsWith("anim-") && kind !== "anim-curve"
        ? "anim"
        : kind.startsWith("text-")
          ? "text"
          : kind.startsWith("shape-")
            ? "shape-voice"
            : kind
  ];

function detail(x: Entry): string[] {
  const own = ownOf(x.kind);
  return [
    ...details(x),
    ...(own ? [`make your own: ${own} (every hook: bun run skills get core --ref contract)`] : []),
  ];
}
function details(x: Entry): string[] {
  const d = x.data ?? {},
    side = x.kind.split("-")[1] ?? "in",
    dir = timelineDir();
  const out: string[] = [];
  const use = (file: string, json: string) => out.push(`use: ${dir}/${file} ${json}`);
  if (SOUND.includes(x.kind)) {
    const takes = d.takes ?? [];
    if (takes.length > 1)
      out.push(
        `takes: ${takes.length > 6 ? `${takes.length} of them, ${takes[0]} to ${takes.at(-1)}` : takes.join(", ")} (vary a repeated sound across them)`,
      );
    if (d.license) out.push(`licence: ${d.license}${d.url ? `  ${d.url}` : ""}`);
    if (d.peaks?.length) out.push(`loudness: ${envelope(d.peaks)}`);
    const bed = `beds[]: {"name": "${x.id}", "from": 0, "to": ${num(x.secs) ?? 10}, "gain": 0, "fadeIn": 1, "fadeOut": 1}  (gain in dB; + "start", "duck", "pan"; a bed shorter than its span loops)`;
    const hit = `sfx[]: {"at": <scene seconds, not heard: bun run at <heard s> gives the scene second>, "name": "${x.id}", "gain": 0}  (gain in dB; + "rate", "pitch", "reverse", "fadeIn", "fadeOut")`;
    // a long ambience is a bed under the scene as music is; a short one is a hit at a second
    use("audio.json", x.kind === "bgm" ? bed : hit);
    if (x.kind !== "bgm" && (x.secs ?? 0) >= 10)
      out.push(`      or under a whole scene, looping: ${bed}`);
    if (d.file) {
      const file = soundFile(d.file);
      out.push(
        Bun.which("earshot")
          ? `hear it: earshot describe ${file}`
          : `hear it: earshot describe ${file}  (earshot is not on PATH here: INSTALL.md sets it up, earshot doctor checks it)`,
      );
    }
  } else if (x.kind === "mocap") {
    const travel = d.travel,
      loop = d.loop;
    out.push(
      [
        `postures: ${(d.seq ?? []).join(" > ")}`,
        travel && `ends ${travel[0]} m to his left, ${travel[1]} m ahead`,
        d.turn !== undefined && `turns ${d.turn} deg`,
        loop && loop[0]! < 15 && loop[1]! < 5 && "loops (last frame meets the first)",
        `energy ${d.energy}`,
      ]
        .filter(Boolean)
        .join("; "),
    );
    const hands = ["head", "up", "ground", "bend", "air"]
      .filter((k) => Number(d[k]) > 0)
      .map(
        (k) =>
          `${{ head: "hand at head", up: "hand up", ground: "hand on floor", bend: "bends over", air: "off the floor" }[k]} ${d[k]} s`,
      );
    if (hands.length) out.push(hands.join("; "));
    const touches = d.prop?.filter((p) => p !== "none") ?? [];
    out.push(
      d.checked
        ? `checked by eye${touches.length ? `; touches: ${touches.join(", ")}` : ""}`
        : "nobody has checked this clip by eye yet: see it before you trust the name",
    );
    const tl = d.tl ?? {};
    for (const [k, label] of Object.entries(TL))
      if (tl[k]?.length)
        out.push(`${label}: ${tl[k].map(([a, b, what]) => `${a}-${b} ${what}`).join(" · ")}`);
    use(
      "steve.json",
      `moves[]: {"t": <scene seconds, not heard: bun run at <heard s> gives them>, "at": [x, 0, z], "yaw": 0, "clip": "${x.id}"}  (+ "from" seconds into the clip, "rate" its speed (0 holds the frame at from), "loop": true, "blend" seconds of crossfade into the next key, default 0.4). The next key's at = at + the end offset above turned by yaw`,
    );
    out.push(
      `see it: LAB_CLIP=${x.id} ENTRY=lab/clip.ts bun run render stills  (in a film folder)`,
    );
  } else if (x.kind === "transition") {
    const glsl = typeof d.glsl === "string" ? d.glsl : "";
    const knobs = [
      '"len" seconds of the change',
      `"ease" one of ${TRANSITION_EASES.map((e) => e.id).join(", ")}${d.ease ? " (auto = its own curve)" : ""}`,
      glsl.includes("uFeather") && '"feather" 0..1 softness of its edge',
      (!glsl || glsl.includes("uFlip")) && '"flip": true reverses its direction',
    ].filter(Boolean);
    out.push(`settings: ${knobs.join("; ")}`);
    use("shots.json", `the shot after the cut: "transition": {"fx": "${x.id}", "len": 0.5}`);
    out.push(
      "see it: AT=<cut time> bun run render stills  (in a film folder), or the Studio's Shot inspector",
    );
  } else if (x.kind.startsWith("anim-") && x.kind !== "anim-curve") {
    out.push(
      `settings: "len" seconds (default ${num(d.len) ?? 1}); "k" strength (1 as designed); "curve" one of ${ANIM_CURVES.map((c) => c.id).join(", ")}`,
    );
    use("shots.json", `shot: "anim": {"${side}": {"fx": "${x.id}", "len": ${num(d.len) ?? 1}}}`);
    out.push("see it: AT=<shot time> bun run render stills  (in a film folder)");
  } else if (x.kind.startsWith("text-") || x.kind.startsWith("shape-")) {
    const knobs = [
      `"len" seconds (default ${num(d.len) ?? 0.5})`,
      d.stagger &&
        `"stagger" 0..1 how far apart the words or letters start (default ${d.defaultStagger ?? 0.4})`,
      d.tint && `"tint" a colour it passes through (default ${d.defaultTint ?? "#FF6B2C"})`,
      '"hold" 2 or 3 moves on twos or threes',
      `"ease" one of ${TITLE_EASES.join(", ")}`,
    ].filter(Boolean);
    out.push(`settings: ${knobs.join("; ")}`);
    const item = x.kind.startsWith("text-")
      ? `{"kind": "text", "text": "…", "from": 0, "to": 3`
      : `{"kind": "box", "x": 0.5, "y": 0.5, "w": 320, "h": 190, "from": 0, "to": 3`;
    use(
      "text.json",
      `items[]: ${item}, "${side}": {"fx": "${x.id}", "len": ${num(d.len) ?? 0.5}}}`,
    );
    out.push("see it: AT=<time> bun run render stills  (in a film folder)");
  } else if (x.kind === "font") {
    out.push(`face: ${d.css}`);
    use("text.json", `items[]: {..., "font": "${x.id}"}`);
  } else if (x.kind === "adjust") {
    out.push(`range: ${d.min}..${d.max}, 0 = untouched`);
    use(
      "adjust.json",
      `items[]: {"id": "<new, unique>", "name": "${x.id}", "from": 0, "to": 4, "track": 0, "grade": {"basic": {"${x.id}": 30}}}  (or a shot's "adjust": {"basic": {...}} in shots.json)`,
    );
  } else if (x.kind === "velocity") {
    use(
      "timing.json",
      `velocity[]: {"effect": "${x.id}", "from": 0, "to": 4, "music": "<a beds[] name in audio.json>", "beats": [<its beat times in film seconds>], "frequency": 1, "speed": "normal", "intensity": 60}  (frequency 1|2 = every beat or every other; speed normal|fast|veryFast; intensity 0-100)`,
    );
    out.push(
      `beats: echo '{"duration": <seconds>}' | python scripts/sound/beats.py <the bed's sound file> prints {"bpm", "beats"} in the track's own seconds; film second = the bed's "from" + beat - its "start" (at rate 1). The Studio's Auto mark beats, on a sound row, marks them too`,
    );
  } else if (x.kind === "ease") {
    const f = (EASES as Record<string, (t: number) => number>)[x.id];
    if (f)
      out.push(
        `curve: at 25%, 50%, 75% of the time it has gone ${[0.25, 0.5, 0.75].map((t) => f(t).toFixed(2)).join(", ")}`,
      );
    use("cam.json", `a key: "ease": "${x.id}"  (the move into that key)`);
  } else if (x.kind === "shape") {
    // arrow and underline are a stroke of a length (size), the rest a frame of w x h; x, y place its middle (0-1)
    const sized =
      x.id === "arrow" || x.id === "underline"
        ? `"size": ${x.id === "arrow" ? 160 : 220}, "rotate": 0`
        : `"w": 260, "h": 170`;
    use(
      "text.json",
      `items[]: {"kind": "${x.id}", "x": 0.5, "y": 0.5, ${sized}, "width": 10, "color": "#E5484D", "from": 0, "to": 3, "in": {"fx": "draw", "len": 0.5}}  (size and width in px at 1080p; "at": [x, y, z] pins it to a world point; in/out voices: bun run find --kind shape)`,
    );
  } else out.push(`use: ${dir}/${useOf(x.kind)}`);
  if (!SOUND.includes(x.kind) && !out.some((l) => l.startsWith("see it:")))
    out.push(
      "see it: AT=<a second it is on screen> bun run render stills  (in a film folder), or the Studio at that second",
    );
  return out;
}

function show(ids: string[], pool: Entry[]) {
  return ids
    .map((id) => {
      let low = id.toLowerCase();
      // A mocap clip named without its library (Walking_1 for mixamo/Walking_1), or with the wrong one, when only one
      // library has it
      const name = low.split("/").at(-1)!;
      const bare = pool.filter((x) => x.id.toLowerCase().endsWith(`/${name}`));
      let readAs = "";
      if (!pool.some((x) => x.id.toLowerCase() === low) && bare.length === 1) {
        low = bare[0]!.id.toLowerCase();
        if (id.includes("/"))
          readAs = `(${id} read as ${bare[0]!.id}: no clip has that id under ${id.split("/")[0]})\n`;
      }
      // Each take is its own entry here (its own file and loudness); its family's takes come from the family name
      const hits = pool.flatMap((x) => {
        if (x.id.toLowerCase() !== low) return [];
        const family = x.data?.family;
        const takes = family ? pool.filter((y) => y.data?.family === family).map((y) => y.id) : [];
        return [takes.length > 1 ? { ...x, data: { ...x.data, takes: takes.toSorted() } } : x];
      });
      if (!hits.length) {
        if (pool.some((x) => kindMatches(x.kind, low)))
          return `${id} is a kind: bun run find --kind ${low} lists it, bun run find <words> --kind ${low} searches it`;
        const near = [
          ...new Set(
            pool
              .map((x) => x.id)
              .filter(
                (i) => i.toLowerCase().includes(low) || levenshtein(low, i.toLowerCase()) <= 2,
              ),
          ),
        ].slice(0, 6);
        throw new FindError(
          `no entry has the id "${id}"${near.length ? `. Close: ${near.join(", ")}` : ""}. Ids are the second column of bun run find <words> (a film's own sounds show only from its folder).`,
        );
      }
      const shared =
        hits.length > 1
          ? [`${hits.length} kinds share the id ${hits[0]!.id}: each goes where its use line says`]
          : [];
      return (
        readAs +
        [
          ...shared,
          ...hits.map((x) =>
            [
              line(x),
              ...(x.about && !line(x).includes(x.about) ? [`about: ${x.about}`] : []),
              ...detail(x),
            ].join("\n"),
          ),
        ].join("\n\n")
      );
    })
    .concat("after pasting it in: bun run check (in the film) says whether the file still fits")
    .join("\n\n");
}

// [share of the vote, entry, fit]: fit (0-1, Jev's yes that it is what was asked) only on the hits it checked
type Voted = [number, Entry, number?];
type Judge = (scene: string, pool: Entry[], show: number) => Promise<Voted[]>;
type Catalog = (args: string[]) => Promise<string>;

// Mocap by body (posture filters) or by meaning is catalog.py's: it filters on the measured postures, reranks every clip's
// note with Jev and asks a yes/no fit for the ones it shows
const catalog: Catalog = (args) =>
  new Promise((done, fail) => {
    const py = spawn("python", [join(ROOT, "packages/clip-catalog/catalog.py"), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    py.stdout.on("data", (d) => (out += d));
    py.stderr.on("data", (d) => (err += d));
    py.on("error", fail);
    py.on("close", (code) =>
      code
        ? fail(new Error(err.trim() || `catalog.py exited ${code}`))
        : done(`${err}${out}`.trim()),
    );
  });

// A usage mistake: the CLI prints it and exits 2 instead of answering a different question than the one asked
// exit 2: the words asked wrong; exit 1: asked right, nothing has that id
export class FindError extends Error {
  constructor(
    message: string,
    readonly code = 2,
  ) {
    super(message);
  }
}
const OPTIONS: Record<string, string | null> = {
  "--help": null,
  "-h": null,
  "--all": null,
  "--jev": null,
  "--kind": "--kind sfx",
  "--source": "--source minecraft",
  "--origin": "--origin real",
  "--edition": "--edition vanilla",
  "--license": "--license free",
  "--dur": "--dur 0-1",
  "-n": "-n 20",
  "--show": "--show dissolve",
};
// catalog.py's body filters, passed through as they are; a value-less one is a switch
const BODY: Record<string, string | null> = {
  "--from": "--from stand",
  "--to": "--to sitFloor",
  "--has": "--has kneel",
  "--energy": "--energy 10-40",
  "--look": "--look 45",
  "--air": "--air yes",
  "--mood": "--mood scared",
  "--prop": "--prop chair",
  "--still": null,
  "--moves": null,
  "--loop": null,
  "--head": null,
  "--up": null,
  "--ground": null,
  "--bend": null,
  "--fights": null,
};
// Tags written by eye (catalog_review.py), read off the clips that have them so the list never drifts from the data
const TAGGED = ["--mood", "--prop"] as const;
// Other words for the moods clips are tagged with, keyed by stem
const MOOD_ALIAS: Record<string, string> = Object.fromEntries(
  Object.entries({
    frightened: "scared",
    afraid: "scared",
    fear: "scared",
    fearful: "scared",
    terrified: "scared",
    unhappy: "sad",
    upset: "sad",
    depressed: "sad",
    mad: "angry",
    furious: "angry",
    joyful: "happy",
    glad: "happy",
    cheerful: "happy",
    exhausted: "tired",
    sleepy: "tired",
    shocked: "surprised",
    anxious: "nervous",
    worried: "nervous",
    relaxed: "calm",
    thoughtful: "thinking",
    hurt: "pain",
    injured: "pain",
    ill: "sick",
  }).map(([w, m]) => [stem(w), m]),
);
Object.assign(OPTIONS, BODY);
// Other names an agent reaches for, read as the option they mean (the first line of the answer says so)
const OPTION_ALIAS: Record<string, string> = {
  "--licence": "--license",
  "--licenses": "--license",
  "--duration": "--dur",
  "--length": "--dur",
  "--seconds": "--dur",
  "--secs": "--dur",
  "--pack": "--source",
  "--mod": "--source",
  "--src": "--source",
  "--type": "--kind",
  "--category": "--kind",
  "--cat": "--kind",
  "--limit": "-n",
  "--top": "-n",
  "--count": "-n",
  "--info": "--show",
  "--details": "--show",
  "--meaning": "--jev",
  "--ai": "--jev",
  "--takes": "--all",
};
const isOption = (a: string) => /^--?[a-z]/i.test(a);
function parse(argv: string[]) {
  const set = new Map<string, string>(),
    rest: string[] = [],
    notes: string[] = [],
    bare: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!isOption(arg)) {
      rest.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const typed = (eq > 0 ? arg.slice(0, eq) : arg).toLowerCase();
    const name = OPTION_ALIAS[typed] ?? typed;
    if (name !== typed) notes.push(`${typed} read as ${name}`);
    if (!(name in OPTIONS))
      throw new FindError(
        `Unknown option ${typed}. Options: --kind --source --origin --edition --license --dur -n --all --jev --show --help; mocap by body: ${Object.keys(BODY).join(" ")}. Any of them without a value lists its values.`,
      );
    const example = OPTIONS[name];
    if (!example) {
      if (eq > 0) throw new FindError(`${name} takes no value: write ${name} alone`);
      set.set(name, "");
      continue;
    }
    const v = eq > 0 ? arg.slice(eq + 1) : argv[i + 1];
    // a filter with no value is asked what it takes: run() answers with its values
    if (v === undefined || v === "" || isOption(v)) {
      bare.push(name);
      continue;
    }
    if (eq < 0) i++;
    if (set.has(name))
      throw new FindError(
        `${name} given twice; give it once${name === "--kind" || name === "--source" ? `, with a comma list for several: ${name} ${set.get(name)},${v}` : ""}`,
      );
    set.set(name, v);
  }
  return { set, query: rest.join(" ").trim(), notes, bare };
}

// ---------- What each filter takes, with how many entries each value keeps: said whenever a filter is named without a
// value, given a wrong one, or could narrow a list, so an agent never has to guess a pack or a licence exists

// Every source by kind, biggest first; Minecraft mods by their pack name
const sourceList = (pool: Entry[]) => {
  const by = new Map<string, string[]>();
  for (const x of pool) {
    if (!x.src) continue;
    const k = x.src.startsWith("film-stage/") ? "presets" : top(x.kind);
    by.set(k, by.get(k) ?? [])
      .get(k)!
      .push(x.src);
  }
  const order = ["sfx", "bgm", "mc", "mocap"];
  const at = (k: string) => (k === "presets" ? 99 : order.indexOf(k) + 1 || 50);
  return [...by]
    .toSorted(([a], [b]) => at(a) - at(b))
    .map(([k, srcs]) =>
      k === "presets"
        ? `presets: film-stage (every preset), or one file: ${[...new Set(srcs)].join(", ")}`
        : `${k}: ${tally(srcs)}`,
    )
    .join("\n  ");
};
// The Sound panel's filters and the licence buckets: which entries each sorts, and what it calls each one
const FACETS: Record<
  string,
  { keep: (x: Entry) => boolean; of: (x: Entry) => string; t: Record<string, string> }
> = {
  "--origin": {
    keep: (x) => SOUND.includes(x.kind) && x.kind !== "mc",
    of: originOfEntry,
    t: ORIGINS,
  },
  "--edition": { keep: (x) => x.kind === "mc", of: editionOfEntry, t: EDITIONS },
  "--license": { keep: (x) => SOUND.includes(x.kind), of: licenseOf, t: LICENSES },
};
// "free 120 (nothing to do ...), credit 9 (...)": all = every value with its meaning (what the filter takes), held = the
// values these entries have, with their meaning, terse = those values bare
const buckets = (o: string, xs: Entry[], style: "all" | "held" | "terse" = "all") => {
  const f = FACETS[o]!,
    ys = xs.filter(f.keep);
  return Object.entries(f.t)
    .map(([k, label]) => [k, ys.filter((y) => f.of(y) === k).length, label] as const)
    .filter(([, c]) => style === "all" || c > 0)
    .map(([k, c, label]) => `${k} ${c}${style === "terse" ? "" : ` (${label})`}`)
    .join(", ");
};
const rawLicenses = (xs: Entry[]) =>
  tally(
    xs.flatMap((x) => (SOUND.includes(x.kind) && x.data?.license ? [String(x.data.license)] : [])),
  );
const durOf = (secs: number) =>
  secs < 1 ? "0-1" : secs < 5 ? "1-5" : secs < 30 ? "5-30" : "30-3600";
const durs = (xs: Entry[]) =>
  tally(xs.flatMap((x) => (x.secs === undefined ? [] : [durOf(x.secs)])));
const tagged = (field: string, clips: Entry[]) =>
  tally(clips.flatMap((x) => (Array.isArray(x.data?.[field]) ? (x.data[field] as string[]) : [])));
const DUR_SAYS =
  "min-max seconds, low first, for sounds and mocap clips: --dur 0-1 a short hit, 1-5, 5-30, 30-3600 a track or long ambience";
// What a filter takes, from the entries here: asked by naming it without a value
const valuesOf = (o: string, pool: Entry[]) => {
  const clips = pool.filter((x) => x.kind === "mocap");
  if (o === "--kind")
    return `Kinds: ${counts(pool)}, or sound for sfx+bgm+mc. Each takes /<category> (bun run find --kind <kind> lists them); plain names work too: music is bgm, titles is text, camera is anim`;
  if (o === "--source") return `Sources (a comma list for several):\n  ${sourceList(pool)}`;
  if (o in FACETS)
    return `${o}: ${buckets(o, pool)}${o === "--license" && rawLicenses(pool) ? `. Or a licence by name (--license mit): ${rawLicenses(pool)}` : ""}`;
  if (o === "--dur") return `--dur takes ${DUR_SAYS}. Here: ${durs(pool)}`;
  if (o === "--from" || o === "--to" || o === "--has")
    return `postures: ${postures(clips).join(" ")}`;
  if (o === "--mood" || o === "--prop")
    return `${o} (only clips checked by eye carry it): ${tagged(o.slice(2), clips)}`;
  if (o === "--show") return "an id: the second column of bun run find <words>";
  return "";
};

export async function run(
  argv: string[],
  given?: Entry[],
  judge: Judge = jevJudge,
  clips: Catalog = catalog,
): Promise<string> {
  const { set, query, notes, bare } = parse(argv);
  // how a loose option or value was read (--licence as --license, --origin recorded as real), above the answer
  const noted = (text: string) => (notes.length ? `(${notes.join("; ")})\n${text}` : text);
  const all = set.has("--all"),
    jev = set.has("--jev");
  const list = (v?: string) => v?.toLowerCase().split(",").filter(Boolean);
  // a category keeps its case, which marks its word breaks (mocap/sitSeat is sit-seat)
  const asked = set
      .get("--kind")
      ?.split(",")
      .filter(Boolean)
      .map((a) => a.replace(/^[^/]*/, (k) => k.toLowerCase())),
    sources = list(set.get("--source"));
  let kinds = asked;
  const nRaw = set.get("-n");
  if (nRaw !== undefined && !/^[1-9]\d*$/.test(nRaw))
    throw new FindError("-n takes a whole number of hits, 1 or more, e.g. -n 20");
  const n = Number(nRaw ?? 12);
  if (set.has("--help") || set.has("-h")) return HELP;
  if (query.toLowerCase() === "help" && set.size === 0 && !bare.length) return HELP;
  if (bare.length) {
    const pool = given ?? allEntries();
    throw new FindError(
      bare
        .map((o) => `${o} needs a value, e.g. ${OPTIONS[o]}. ${valuesOf(o, pool)}`.trim())
        .join("\n"),
    );
  }
  const showIds = set.get("--show")?.split(",").filter(Boolean);
  if (showIds && !showIds.length) throw new FindError("--show needs an id, e.g. --show dissolve");
  if (showIds) {
    if (query || set.size > 1 + (nRaw ? 1 : 0))
      throw new FindError(
        `--show takes ids only (a comma list for several: --show dissolve,push); drop ${[query, ...[...set.keys()].filter((k) => k !== "--show" && k !== "-n")].filter(Boolean).join(" ")}`,
      );
    return noted(show(showIds, given ?? allEntries(false)));
  }
  const catalogSays = async (args: string[], clipPool: Entry[]) => {
    try {
      const said = await clips([...args, "-n", `${n}`]);
      if (/^0 matches/m.test(said))
        return `${said}\nnext: no clip passes every word and filter together (${args.join(" ")}). Drop one filter or widen a range (--energy, --dur), then add it back; words match from a word start in the clip's name and description.\n      by meaning (Jev, paid): bun run find --jev --kind mocap "<the move in words>"\n      ${mocapNext(clipPool)}\n      none fits: ${MAKE_MOCAP}`;
      // catalog.py prints a clip per unindented line, its FLAW (a fault seen by eye) on an indented one under it
      const rows = said.split("\n").filter((l) => /^\S+\/\S+\s/.test(l)).length,
        flawed = said.split("\n").filter((l) => /^\s+FLAW:/.test(l)).length;
      const allFlawed =
        rows && flawed === rows
          ? `every clip shown has a FLAW seen by eye: none is clean as it is. Drop or loosen a filter (--mood, --to, --from, --dur) for a clean one, or by meaning (Jev, paid): bun run find --jev --kind mocap "<the move in words>"; else ${MAKE_MOCAP}\n      `
          : "";
      return `${said}\n\n${MOCAP_COLUMNS}\nwhere (in ${timelineDir()}/): ${USE.mocap}\nnext: ${allFlawed}${mocapNext(clipPool)}`;
    } catch (err) {
      return `the mocap catalogue failed: ${(err as Error).message}. Words alone still work: bun run find --kind mocap <words>`;
    }
  };
  // min-max, low first: --dur in seconds (sounds and clips), --energy in deg/s (clips)
  const span = (o: string) => {
    const v = set.get(o);
    if (v === undefined) return undefined;
    const [lo, hi, extra] = v.split("-").map((x) => (/^\d+(?:\.\d+)?$/.test(x) ? Number(x) : NaN));
    if (extra !== undefined || !(lo! <= hi!))
      throw new FindError(
        o === "--dur"
          ? `--dur takes min-max seconds, low first, e.g. --dur 0-1 (a short hit), --dur 120-600 (a long track), 3-3 for exactly 3; got ${v}`
          : `--energy takes min-max mean joint speed in deg/s, low first, e.g. --energy 10-40 (calm idle ~10, walk ~30, jump 200); got ${v}`,
      );
    return [lo!, hi!] as const;
  };
  const dur = span("--dur");
  span("--energy");
  const body = Object.keys(BODY).filter((o) => set.has(o));
  if (body.length) {
    const clipPool = (given ?? allEntries()).filter((x) => x.kind === "mocap");
    if (kinds && kinds.join() !== "mocap") {
      const soundy = kinds.some((k) =>
        [...SOUND, "sound"].includes(kindOf(k.split("/")[0]!, clipPool)),
      );
      throw new FindError(
        `${body.join(" ")} filter mocap clips by the body; use --kind mocap or no --kind${soundy && set.has("--mood") ? `. For music: ${BGM_MOOD}` : ""}`,
      );
    }
    if (jev && !query)
      throw new FindError(`--jev needs the scene in words, e.g. --jev "he kneels to tie a shoe"`);
    if (set.has("--still") && set.has("--moves"))
      throw new FindError(
        "--still (stays within 0.3 m) and --moves (goes further) contradict: give one",
      );
    const known = postures(clipPool);
    const args = body.flatMap((o) => {
      if (!BODY[o]) return [o];
      const v = set.get(o) ?? "";
      if (o === "--energy") return [o, v];
      if (o === "--look") {
        if (!/^\d+(?:\.\d+)?$/.test(v))
          throw new FindError(
            `--look takes the least head turn on the neck in degrees, e.g. --look 45; got ${v}`,
          );
        return [o, v];
      }
      if (o === "--air") {
        if (v !== "yes" && v !== "no")
          throw new FindError(
            `--air is yes (off the floor a while: a jump, or on furniture) or no (feet down throughout); got ${v}`,
          );
        return [o, v];
      }
      if ((TAGGED as readonly string[]).includes(o)) {
        const seen = tagged(o.slice(2), clipPool);
        const known = seen.split(", ").map((s) => s.split(" ")[0]);
        const said = v.toLowerCase(),
          tag = o === "--mood" && !known.includes(said) ? MOOD_ALIAS[stem(said)] : undefined;
        if (tag && known.includes(tag)) {
          notes.push(`${o} ${said} read as ${tag}`);
          return [o, tag];
        }
        if (!known.includes(said))
          throw new FindError(
            `no checked clip has ${o} ${v}. ${o} (only clips checked by eye carry it): ${seen}`,
          );
        return [o, said];
      }
      if (v.includes(","))
        throw new FindError(
          `${o} takes one posture (a clip starts and ends in one), not a list: ${v}`,
        );
      // standing is stand, lying is lie: a posture said as a verb is read as the one its stem names
      const pose =
        known.find((p) => p.toLowerCase() === v.toLowerCase()) ??
        known.find((p) => {
          const hit = p.toLowerCase() === stem(v.toLowerCase());
          if (hit) notes.push(`${o} ${v} read as ${p}`);
          return hit;
        });
      if (!pose) {
        const start = stem(v.toLowerCase()).slice(0, 3);
        const close = known.filter(
          (p) =>
            p.toLowerCase().includes(v.toLowerCase()) ||
            p.toLowerCase().startsWith(start) ||
            levenshtein(p.toLowerCase(), v.toLowerCase()) <= (v.length > 4 ? 2 : 1),
        );
        throw new FindError(
          `no clip has the posture ${v}${close.length ? ` (close: ${close.join(", ")})` : ""}. postures: ${known.join(" ")}`,
        );
      }
      return [o, pose];
    });
    const libs = sources ? ["--lib", sources.join(",")] : [];
    const words = jev ? ["--jev", query] : query.split(/\s+/).filter(Boolean);
    const durArg = dur ? ["--dur", set.get("--dur")!] : [];
    return noted(await catalogSays([...words, ...args, ...durArg, ...libs], clipPool));
  }
  if (
    !query &&
    !kinds &&
    !sources &&
    !["--origin", "--edition", "--license", "--dur"].some((o) => set.has(o))
  ) {
    if (argv.length)
      throw new FindError(
        'find needs words, e.g. bun run find door slam, or --jev --kind sfx "a heavy door slams" (bun run find --help)',
      );
    return HELP;
  }

  const pool = given ?? allEntries(!all);
  // A source by its whole name, or a folder of them (film-stage = every film-stage/*.ts)
  const fromSource = (x: Entry, s: string) => {
    const src = x.src?.toLowerCase();
    return !!src && (src === s || src.startsWith(`${s}/`));
  };
  const bySource = sources ? pool.filter((x) => sources.some((s) => fromSource(x, s))) : pool;
  const badSource = sources?.filter((s) => !pool.some((x) => fromSource(x, s)));
  if (badSource?.length) {
    const names = [...new Set(pool.flatMap((x) => x.src?.toLowerCase() ?? []))];
    const close = badSource.flatMap((s) =>
      names.filter(
        (n) =>
          n.includes(s) ||
          s.includes(n.split("/")[0]!) ||
          levenshtein(s, n) <= (s.length > 5 ? 2 : 1),
      ),
    );
    throw new FindError(
      `${badSource.includes("this-film") ? "this-film is a film's own sounds: run find from its folder (cd films/<film>). " : ""}Unknown --source ${badSource.join(",")}${close.length ? ` (did you mean: ${[...new Set(close)].slice(0, 6).join(", ")}?)` : ""}. ${valuesOf("--source", pool)}`,
    );
  }
  // A filter's value said another way (--origin recorded is real), read as the value and said so on the first line
  const valueOf = (o: string) => {
    const v = set.get(o)?.toLowerCase();
    const a = v && VALUE_ALIAS[o]?.[v];
    if (a) notes.push(`${o} ${v} read as ${a}`);
    return a || v;
  };
  // The Sound panel's two filters; either keeps sounds only (a transition is neither a recording nor a pack)
  const origin = valueOf("--origin"),
    edition = valueOf("--edition"),
    license = valueOf("--license");
  if (origin !== undefined && !(origin in ORIGINS))
    throw new FindError(
      `--origin is real or synth (sfx and bgm): ${buckets("--origin", bySource)}`,
    );
  if (edition !== undefined && !(edition in EDITIONS))
    throw new FindError(
      `--edition is vanilla or modded (Minecraft sounds): ${buckets("--edition", bySource)}`,
    );
  if (origin && edition)
    throw new FindError(
      `--origin sorts sfx and bgm, --edition sorts mc (Minecraft): together they keep nothing. Give one: --origin ${origin} for sfx/bgm, --edition ${edition} for mc`,
    );
  // --license is a bucket (what an upload must do), else a word of a licence's own name: mit, lgpl, cc0, polyform
  const namedLicense =
    license !== undefined && !(license in LICENSES)
      ? new RegExp(`\\b${license.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
      : undefined;
  if (
    namedLicense &&
    !bySource.some(
      (x) => SOUND.includes(x.kind) && namedLicense.test(String(x.data?.license ?? "")),
    )
  )
    throw new FindError(
      `--license is ${Object.keys(LICENSES).join(", ")} (sounds, by what a YouTube upload must do): ${buckets("--license", bySource)}. Or a word of a licence's own name: ${rawLicenses(bySource)}`,
    );
  const licensed = (x: Entry) =>
    SOUND.includes(x.kind) &&
    (namedLicense ? namedLicense.test(String(x.data?.license ?? "")) : licenseOf(x) === license);
  const entries = bySource.filter(
    (x) =>
      (origin === undefined ||
        (SOUND.includes(x.kind) && x.kind !== "mc" && originOfEntry(x) === origin)) &&
      (edition === undefined || (x.kind === "mc" && editionOfEntry(x) === edition)) &&
      (license === undefined || licensed(x)) &&
      (!dur || (x.secs !== undefined && x.secs >= dur[0] && x.secs <= dur[1])),
  );
  const kf = kinds ? kindFilter(kinds, entries) : undefined;
  if (kf?.bad.length) {
    const filter = [
      sources && `--source ${sources.join(",")}`,
      origin && `--origin ${origin}`,
      edition && `--edition ${edition}`,
      license && `--license ${license}`,
      dur && `--dur ${set.get("--dur")}`,
    ]
      .filter(Boolean)
      .join(" ");
    // the kind exists but the filter took it all: say which filter, not "unknown kind"
    throw new FindError(
      !filter
        ? kf.bad.join("\n")
        : !kindFilter(kinds!, pool).bad.length
          ? `${filter} keeps ${counts(entries) || "nothing"}, none of it --kind ${kinds!.join(",")}.${origin ? ` --origin sorts sfx and bgm (bgm has ${bySource.filter((x) => x.kind === "bgm" && originOfEntry(x) === origin).length} ${origin}).` : ""}${edition ? " --edition sorts mc only." : ""}${license ? " --license sorts sounds only." : ""}${dur ? " --dur keeps only what has a length (sounds, mocap clips)." : ""} Drop it, or see what --kind ${kinds!.join(",")} holds: bun run find --kind ${kinds!.join(",")}${sources?.includes("minecraft") && kinds!.some((k) => k.startsWith("bgm")) ? `\n${MC_MUSIC_NOTE}` : ""}`
          : `${filter} keeps ${counts(entries) || "nothing"}: ${kf.bad.join("; ")}`,
    );
  }
  kinds = kf?.as;
  const inKinds = kf ? entries.filter(kf.test) : entries;
  // how a loose --kind was read (music as bgm, sfx/riser as sfx/transitions), above whatever it found
  const readAs = (text: string) =>
    noted(kf?.read.length ? `(${kf.read.join("; ")})\n${text}` : text);
  // what --kind names without its categories (sfx/typing is sfx), for the hints that speak of a kind
  const kindNames = kinds?.map((k) => k.split("/")[0]!);
  const filters = `${kinds ? ` --kind ${kinds.join(",")}` : ""}${sources ? ` --source ${sources.join(",")}` : ""}${origin ? ` --origin ${origin}` : ""}${edition ? ` --edition ${edition}` : ""}${license ? ` --license ${license}` : ""}${dur ? ` --dur ${set.get("--dur")}` : ""}`;
  // The filters these entries can still take, each value with how many it keeps (a filter already given is left out).
  // Terse (under a search): only filters that would split the hits, values without their meaning
  const filtersFor = (xs: Entry[], terse = false) => {
    const given: Record<string, unknown> = {
      "--origin": origin,
      "--edition": edition,
      "--license": license,
    };
    const facets = Object.keys(FACETS).flatMap((o) => {
      const ys = xs.filter(FACETS[o]!.keep);
      if (given[o] || !ys.length) return [];
      if (terse && new Set(ys.map(FACETS[o]!.of)).size < 2) return [];
      return [`${o} ${buckets(o, ys, terse ? "terse" : "held")}`];
    });
    const srcs = xs.flatMap((x) =>
      (SOUND.includes(x.kind) || x.kind === "mocap") && x.src ? [x.src] : [],
    );
    const bySrc = tally(srcs).split(", ").filter(Boolean);
    if (!sources && bySrc.length > (terse ? 1 : 0))
      facets.push(
        `--source ${terse && bySrc.length > 8 ? `${bySrc.slice(0, 8).join(", ")} and ${bySrc.length - 8} more (bun run find --source lists all)` : bySrc.join(", ")}`,
      );
    const lengths = durs(xs).split(", ").filter(Boolean);
    if (!dur && lengths.length > (terse ? 1 : 0)) facets.push(`--dur ${lengths.join(", ")}`);
    return facets;
  };
  const where = (shown: Entry[]) => {
    const uses = [...new Set(shown.map((x) => useOf(x.kind)))];
    return uses.length ? ["", `where (in ${timelineDir()}/): ${uses.join("\n       ")}`] : [];
  };
  if (!query) {
    if (!inKinds.length)
      throw new FindError(
        `nothing has${filters}: drop one (bun run find --kind sfx lists the sound filters)`,
      );
    const kindsHere = [...new Set(inKinds.map((x) => top(x.kind)))];
    const narrowed = kinds?.some((k) => k.includes("/"));
    const jevHere = `by meaning (Jev, paid; reads every entry of the kind or category): bun run find --jev --kind ${kinds?.join(",") ?? kindsHere.join(",")} "<the scene or feeling>"`;
    const groups =
      narrowed ||
      kindsHere.every((k) => !catList(inKinds.filter((x) => top(x.kind) === k)).includes(","))
        ? []
        : [`categories (--kind <kind>/<category>): ${catList(inKinds)}`];
    // one category, or a kind small enough to read: its entries (a long category: the first 40 and the words they are
    // named by, to search inside it)
    if (inKinds.length <= 60 || nRaw || narrowed) {
      const some = inKinds.slice(0, nRaw ? n : inKinds.length <= 60 ? 60 : 40);
      const cut = some.length < inKinds.length;
      const files = some.flatMap((x) =>
        SOUND.includes(x.kind) && x.data?.file ? [soundFile(x.data.file)] : [],
      );
      return readAs(
        [
          ...groups,
          ...(cut ? [`first ${some.length} of ${inKinds.length}:`] : []),
          ...some.map((x) => line(x)),
          ...where(some),
          ...filtersFor(inKinds).map((f) => `filter: ${f}`),
          ...(cut ? [`named by: ${namedBy(inKinds)}`] : []),
          ...(some.some((x) => x.kind === "bgm") ? [BGM_MOOD] : []),
          `next: ${cut ? `search inside: bun run find <word>${filters} (a word from "named by"); all ${inKinds.length}: -n ${inKinds.length}` : `bun run find <words>${filters} searches these`}; one in full: bun run find --show <id>`,
          `      ${jevHere}`,
          ...(some.some((x) => x.kind === "mocap") ? [`      ${mocapNext(pool)}`] : []),
          ...(files.length > 1 && files.length <= 20
            ? [`      ${hearThem("<what it should sound or feel like>", files)}`]
            : []),
        ].join("\n"),
      );
    }
    const cats = new Map<string, Entry[]>();
    for (const x of inKinds) {
      const key = x.cat ? catKey(x) : x.kind;
      cats.set(key, [...(cats.get(key) ?? []), x]);
    }
    const big = [...cats].toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const more =
      big.length > 20
        ? [
            `  and ${big.length - 20} smaller: ${big
              .slice(20)
              .map(([k, xs]) => `${k} ${xs.length}`)
              .join(", ")}`,
          ]
        : [];
    const example = big.find(([k]) => k.includes("/"))?.[0];
    return readAs(
      [
        `${inKinds.length} entries by category, as --kind takes them (the studio's heading, a few ids):`,
        ...big.slice(0, 20).map(([k, xs]) => {
          const label = catLabel(xs[0]!);
          // the ids to start from: vanilla Minecraft and real recordings before modded packs and code-made ones
          const first = (x: Entry) =>
            x.src === "minecraft"
              ? 0
              : SOUND.includes(x.kind) && originOfEntry(x) === "synth"
                ? 2
                : 1;
          return `  ${k} ${xs.length}${label && catSlug(label) !== k.split("/")[1] ? ` "${label}"` : ""}  (${xs
            .toSorted((a, b) => first(a) - first(b))
            .slice(0, 3)
            .map((x) => x.id)
            .join(", ")}${xs.length > 3 ? "…" : ""})`;
        }),
        ...more,
        ...filtersFor(inKinds).map((f) => `filter: ${f}`),
        `next: one category in full: bun run find --kind ${example ?? "<kind>/<category>"}${sources ? ` --source ${sources.join(",")}` : ""} (-n 500 for every entry)`,
        `      search inside it: bun run find <english words> --kind ${example ?? "<kind>/<category>"}; one in full: bun run find --show <id>`,
        `      by meaning inside one (Jev, paid): bun run find --jev --kind ${example ?? "<kind>/<category>"} "<the scene or feeling>"`,
        ...(inKinds.some((x) => x.kind === "mocap") ? [`      ${mocapNext(pool)}`] : []),
      ].join("\n"),
    );
  }

  if (jev && kinds?.length === 1 && kinds[0] === "mocap" && !sources)
    return readAs(await catalogSays(["--jev", query], pool));

  // Words are matched as English; letters outside it (Vietnamese, emoji aside) would only match stray fragments
  const foreign = /[^a-z]/i.test(query.replace(/[^\p{L}]/gu, ""));
  // Under --kind, a word that only names that kind ("music" with --kind bgm) matches every entry and says nothing
  const kindSaid = new Set(
    (kindNames ?? []).flatMap((k) =>
      (k === "sound" ? SOUND : [k]).flatMap((kk) => [
        ...words(`${kk} ${KIND_WORDS[kk] ?? ""}`),
        ...Object.entries(KIND_ALIAS).flatMap(([w, to]) => (to === kk ? [w] : [])),
        ...Object.entries(KIND_NAMED).flatMap(([w, to]) => (to === kk ? [w] : [])),
      ]),
    ),
  );
  const said = plain(query).filter((w) => !kindSaid.has(stem(w)));
  const asks = said.length ? said.join(" ") : query;
  const ranked = foreign ? [] : rank(inKinds, asks);
  // A one-frame mocap clip is a still pose: it never plays the move its name says, so it goes last
  const isStill = (x: Entry) => x.kind === "mocap" && (x.secs ?? 1) < 0.1;
  const typed = [...new Set(plain(asks))].filter((w) => !STOP.has(stem(w)) && !/^\d+$/.test(w));
  const named = kinds ? [] : [...new Set(typed.flatMap((w) => KIND_NAMED[stem(w)] ?? []))];
  // words naming a kind ("sad background music", "title animation") put that kind's hits first, as --kind would keep them
  const first = (x: Entry) =>
    (isStill(x) ? 2 : 0) + (named.length && !named.includes(top(x.kind)) ? 1 : 0);
  const matches = ranked.toSorted((a, b) => first(a) - first(b));
  const out: string[] = [],
    next: string[] = [];
  let shown: [string, Entry][] | undefined;
  const byMeaning = (kind: string) => `bun run find --jev --kind ${kind} "${query}"`;
  const moodAdvice = () =>
    `${BGM_MOOD}; bgm groups: ${catList(pool.filter((x) => x.kind === "bgm"))}`;
  // an ask for music, or in a mood: words cannot find a mood no group names
  const music =
    [...(kindNames ?? []), ...named].some((k) => k === "bgm" || k === "sound") ||
    // a mood word ("creepy") asks for music only when music is among the hits, or nothing matched
    (typed.some((w) => MOODS.has(stem(w))) &&
      (!ranked.length || ranked.slice(0, n).some((x) => x.kind === "bgm")));
  // The kind to hand Jev: the one the words name, else the one most of the hits are
  const guess = () => {
    if (kinds) return kinds.join(",");
    if (named.length) return named.join(",");
    const seen = new Map<string, number>();
    for (const x of matches.slice(0, n)) seen.set(top(x.kind), (seen.get(top(x.kind)) ?? 0) + 1);
    return [...seen].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? "<kind>";
  };
  // Word matches the --kind left out ("door" is under mc, not sfx; "whoosh" is sfx/transitions, not sfx/impacts), by category
  const elsewhere = () => {
    if (!kf || foreign) return "";
    const other = rank(
      entries.filter((x) => !kf.test(x)),
      query,
    );
    if (!other.length) return "";
    const where = tally(other.map((x) => (x.cat ? catKey(x) : x.kind)))
      .split(", ")
      .slice(0, 5);
    return `outside --kind ${kinds!.join(",")} these words are in: ${where.join(", ")} (bun run find ${query} --kind ${where[0]!.split(" ")[0]})`;
  };
  // Hits spread over categories: the one to narrow to, as the studio's chips would
  const spread = (xs: Entry[]) => {
    if (kinds?.every((k) => k.includes("/"))) return "";
    const cats = tally(xs.map((x) => (x.cat ? catKey(x) : x.kind))).split(", ");
    return cats.length > 1
      ? `hits by category: ${cats.slice(0, 6).join(", ")}${cats.length > 6 ? ", ..." : ""}. Narrow to one: --kind ${cats[0]!.split(" ")[0]}`
      : "";
  };
  const browse = () => {
    const k = kindNames?.join(",") ?? (guess() === "<kind>" ? "" : guess());
    const grouped = entries.some(
      (x) => x.cat && k.split(",").some((kk) => kindMatches(x.kind, kk)),
    );
    return !k
      ? `browse instead: bun run find --kind <kind> lists a kind's categories. Kinds: ${counts(entries)}`
      : grouped
        ? `browse instead: bun run find --kind ${k} lists its categories (the studio's groups), --kind ${k}/<category> one whole category`
        : `browse instead: bun run find --kind ${k} lists every one (${k} has no categories)`;
  };
  if (jev) {
    const jevPool = kinds?.length ? inKinds : matches.slice(0, POOL);
    if (!jevPool.length)
      next.push(
        "--jev without --kind only reorders word matches, and none matched: add --kind <kind>.",
      );
    else {
      try {
        const voted = (await judge(query, jevPool, n))
          .filter(([p]) => p > 0)
          .sort((a, b) => b[0] - a[0]);
        if (voted.length) {
          const checked = voted.slice(0, n).filter(([, , f]) => f !== undefined);
          const bestFit = checked.toSorted((a, b) => b[2]! - a[2]!)[0],
            doubted = voted[0]![2];
          // the first line is the answer an agent takes: a hit Jev believes beats the vote's favourite it doubts
          const promoted =
            bestFit && doubted !== undefined && doubted < FIT_YES && bestFit[2]! >= FIT_YES
              ? voted[0]!
              : undefined;
          if (promoted) {
            voted.splice(voted.indexOf(bestFit!), 1);
            voted.unshift(bestFit!);
          }
          out.push(
            `Jev voted among ${jevPool.length} ${kinds?.length ? "entries" : "word matches (add --kind to vote over a whole kind)"}; first column = its share of the vote${checked.length ? `, then "fits" = its own yes/no that the entry is what you asked for (0-1)` : ""}${voted.length < Math.min(n, jevPool.length) ? `; the other ${jevPool.length - voted.length} got none` : ""}.`,
          );
          shown = voted
            .slice(0, n)
            .map(([p, x, f]) => [
              `${p.toFixed(2)}  ${f === undefined ? "" : `fits ${f.toFixed(2)}  `}`,
              x,
            ]);
          const best = Math.round((voted[0]?.[0] ?? 0) * 100);
          const fit = bestFit?.[2];
          if (
            (fit !== undefined ? fit < FIT_YES : best < 50) &&
            kinds?.length === 1 &&
            SOUND.includes(kindNames![0]!)
          )
            next.push(
              `also try --kind sound: sfx, bgm and Minecraft together (a door creak may be a Minecraft block sound)`,
            );
          next.push(
            fit !== undefined
              ? fit < FIT_NO
                ? `NOT IN THE VAULT: Jev says none of these is what you asked for (best fit ${fit.toFixed(2)}). Do not use one as if it were. Ask once more in other words (what it is, or the feeling it should give), or make it:`
                : fit < FIT_YES
                  ? `UNSURE: Jev only half-believes the best of these (${bestFit![1].id}, fit ${fit.toFixed(2)}). Read it with --show ${bestFit![1].id} and use it only if it really is what the moment needs; else make it:`
                  : `FOUND: ${voted[0]![1].id} (fit ${fit.toFixed(2)})${promoted ? `, moved above the vote's favourite ${promoted[1].id}, which Jev doubts is what you asked for (fit ${promoted[2]!.toFixed(2)})` : ""}. --show ${voted[0]![1].id} gives its settings and the line to paste. If it still does not suit the moment, make it:`
              : best < 20
                ? `probably not in the vault (the best has only ${best}% of the vote). Make it:`
                : best < 50
                  ? `unsure (the best has ${best}% of the vote): several fit about equally, or none does. Compare the top few with --show; if none fits, make it:`
                  : `Jev prefers the first (${best}% of the vote). A vote always picks something, so check it with --show; if none fits, make it:`,
            ...make(kindNames, entries).map((m) => `  ${m}`),
          );
          // a found entry needs no detour into other kinds
          const other = fit !== undefined && fit >= FIT_YES ? "" : elsewhere();
          if (other) next.push(other);
        } else next.push("Jev found no entry that fits; word matches below.");
      } catch (err) {
        // jev.py's own words already say which key or quota; anything else never reached it
        const why = (err as Error).message;
        next.push(
          why.startsWith("Jev:")
            ? `${why}. Word matches below.`
            : `Jev did not run: ${why}. Word matches below. Jev needs python on PATH (packages/clip-catalog/jev.py).`,
        );
      }
    }
  }
  if (!shown) {
    const part = typed.length > 1 && matches.slice(0, n).some((x) => x.matched < x.of);
    shown = matches
      .slice(0, n)
      .map((x) => [part && x.matched < x.of ? `${x.matched}/${x.of} words  ` : "", x]);
    if (matches.length > n)
      out.push(`${matches.length} word matches (${counts(matches)}); top ${n}:`);
    const best = matches[0];
    const scene = typed.length >= 8;
    // Words first (free, instant): plain English, then the studio's groups; Jev (paid) only once both came up short
    const PLAIN =
      "entries are named plainly: what it is, not the moment (whoosh, impact, riser, glitch, door creak, chime; Minecraft by mob or block: zombie say, chest open; mocap by action: sit, kneel, look around; transitions and anims by motion: wipe, zoom, spin, blur)";
    if (foreign)
      next.push(
        `words match English only: say it again in 1-3 plain English words, ${PLAIN}. e.g. bun run find <english words>${filters}`,
        browse(),
        `last, by meaning in any language (Jev, a paid call): ${byMeaning(kinds?.join(",") ?? "<kind>")}`,
      );
    else if (!best) {
      const known = new Set(inKinds.flatMap(fieldWords));
      const guesses = typed.flatMap((w) => (known.has(stem(w)) ? [] : (closest(w, inKinds) ?? [])));
      // the words are there, but --source/--origin/--edition took them: name the sources that have them
      const unfiltered =
        sources || origin || edition || license || dur
          ? rank(kinds ? pool.filter(kindFilter(kinds, pool).test) : pool, query)
          : [];
      const other = unfiltered.length
        ? `these words are in${kinds ? ` --kind ${kinds.join(",")}` : ""}, but not with${filters.replace(/ --kind \S+/, "")}: ${tally(
            unfiltered.map((x) =>
              sources
                ? `--source ${x.src ?? "?"}`
                : license
                  ? `--license ${SOUND.includes(x.kind) ? licenseOf(x) : `(${top(x.kind)} has none)`}`
                  : origin
                    ? `--origin ${SOUND.includes(x.kind) && x.kind !== "mc" ? originOfEntry(x) : `(${top(x.kind)} has none)`}`
                    : edition
                      ? `--edition ${x.kind === "mc" ? editionOfEntry(x) : `(${top(x.kind)} has none)`}`
                      : `--dur ${x.secs === undefined ? `(${top(x.kind)} has no length)` : x.secs < 1 ? "0-1" : x.secs < 5 ? "1-5" : x.secs < 30 ? "5-30" : "30-600"}`,
            ),
          )
            .split(", ")
            .slice(0, 5)
            .join(", ")} (bun run find ${query}${kinds ? ` --kind ${kinds.join(",")}` : ""})`
        : elsewhere();
      next.push(
        ...(other ? [other] : []),
        `no entry${kinds ? ` of --kind ${kinds.join(",")}` : ""}${unfiltered.length ? ` with${filters.replace(/ --kind \S+/, "")}` : ""} has these words${guesses.length ? ` (did you mean: ${guesses.join(", ")}?)` : ""}. Try other words: ${PLAIN}`,
        browse(),
        ...(music ? [moodAdvice()] : []),
        `last, by meaning (Jev, a paid call): ${byMeaning(guess())}`,
        "if none of these has it, make it:",
        ...make(kindNames, entries).map((m) => `  ${m}`),
      );
    } else if (!jev) {
      const has = new Set(fieldWords(best));
      const missing = typed.filter((w) => !(slotsOf(w)[0] ?? []).some((t) => has.has(t)));
      const kind = guess();
      const where = spread(matches.slice(0, Math.max(n, 30)));
      if (where) next.push(where);
      const near = matches.slice(0, Math.max(n, 30));
      if (
        !kinds &&
        near.some((x) => SOUND.includes(x.kind)) &&
        near.some((x) => !SOUND.includes(x.kind))
      )
        next.push(
          `a sound? add --kind sound (sfx, bgm and Minecraft only): bun run find ${query} --kind sound`,
        );
      // a word no title says may be what a whole category is ("creepy": mc/horror): the category, searched with the rest
      const cats = new Map<string, Entry[]>();
      for (const x of inKinds) if (x.cat) cats.set(catKey(x), [...(cats.get(catKey(x)) ?? []), x]);
      for (const w of missing) {
        const holds = [...cats].filter(
          ([key, xs]) =>
            key !== catKey(best) &&
            words(`${xs[0]!.cat} ${catLabel(xs[0]!)} ${CAT_WORDS[key] ?? ""}`).includes(stem(w)),
        );
        const rest = typed.filter((t) => t !== w).join(" ");
        if (holds.length)
          next.push(
            `"${w}" is what a category holds: ${holds.map(([key, xs]) => `${key} ${xs.length}`).join(", ")}. bun run find ${rest ? `${rest} ` : ""}--kind ${holds[0]![0]}`,
          );
      }
      if (kind === "adjust" && missing.length)
        next.push(`top hits are adjust sliders, which lack: ${missing.join(", ")}. ${MAKE_LOOK}`);
      else if (scene)
        next.push(
          `this reads like a scene, and words match names: try 1-3 words for the thing itself (${PLAIN}); or by meaning (Jev, paid): ${byMeaning(kind)}`,
        );
      else if (missing.length)
        next.push(
          `no entry has every word (top hit lacks: ${missing.join(", ")}): drop or swap that word, or ${browse().replace("browse instead: ", "browse: ")}. By meaning (Jev, paid): ${byMeaning(kind)}`,
        );
    }
    if (named.length)
      next.push(
        `your words name a kind: bun run find ${said.filter((w) => !KIND_NAMED[stem(w)]).join(" ") || query} --kind ${named.join(",")} searches only that`,
      );
    if (music && best && best.matched < best.of) next.push(moodAdvice());
  }
  // a word that is a source's name ("minecraft music", "mixamo walk") is a filter, not a word in titles; asked of a kind
  // that source never fills, the vault simply has none, and says so
  // what the vault never holds, said first: Minecraft's own music, and a spoken line
  const saysMusic =
    [...(kindNames ?? []), ...named].includes("bgm") || typed.some((w) => stem(w) === "music");
  const saysMinecraft = typed.some((w) => w === "minecraft") || (kindNames ?? []).includes("mc");
  const mcMusic = typed.some((w) => MC_MUSIC.has(stem(w))) || (saysMusic && saysMinecraft);
  if (typed.some((w) => SPOKEN.has(stem(w)))) next.unshift(SPOKEN_NOTE);
  if (typed.some((w) => LOOK_WORDS.has(stem(w))) && !next.some((l) => l.includes(MAKE_LOOK)))
    next.push(MAKE_LOOK);
  if (mcMusic) next.unshift(MC_MUSIC_NOTE);
  if (!sources) {
    const bySrc = new Map<string, Set<string>>();
    for (const x of pool)
      if (x.src) bySrc.set(x.src, (bySrc.get(x.src) ?? new Set()).add(top(x.kind)));
    for (const w of typed) {
      const kindsOf = bySrc.get(w.toLowerCase());
      if (!kindsOf || (mcMusic && w === "minecraft")) continue;
      const lacking = (kindNames ?? named).filter((k) => k !== "sound" && !kindsOf.has(k));
      next.push(
        lacking.length
          ? `${w} is a source with no ${lacking.join(" or ")} (only ${[...kindsOf].join(", ")}): the vault has no ${w} ${lacking.join("/")}. ${lacking.map((k) => `${k} comes from: ${tally(pool.filter((x) => top(x.kind) === k).flatMap((x) => x.src ?? []))}`).join("; ")}`
          : `${w} is a source: add --source ${w} to keep only its entries (bun run find --source lists every source)`,
      );
    }
  }
  out.push(...shown.map(([lead, x]) => line(x, lead)), ...where(shown.map(([, x]) => x)));
  const exact = shown.find(([, x]) => x.id.toLowerCase() === query.toLowerCase());
  if (exact) next.unshift(`that is an exact id: bun run find --show ${exact[1].id}`);
  else if (shown.length)
    next.push("one in full (settings, a line to paste, how to see it): bun run find --show <id>");
  if (shown.some(([, x]) => (x.takes ?? 1) > 1))
    next.push(
      "(N takes): the id shown is take 1 and plays as is; --all lists every take's id, to vary a sound that repeats.",
    );
  // the filters that would split these hits, so a pack, a licence or a length is never a guess
  const narrow = !jev && matches.length > 1 ? filtersFor(matches, true) : [];
  if (narrow.length)
    next.push(
      `narrow these ${matches.length}: ${narrow.join(" | ")}  (a filter named alone, e.g. --license, says what its values mean)`,
    );
  if (shown.some(([, x]) => x.kind === "mocap")) next.push(mocapNext(pool));
  const files = shown.flatMap(([, x]) =>
    SOUND.includes(x.kind) && x.data?.file ? [soundFile(x.data.file)] : [],
  );
  if (files.length > 1)
    next.push(
      `${hearThem(query, files)}  (about 40 s a call; describe the sound, not its job; which earshot command for what: bun run skills get core --ref sound)`,
    );
  if (next.length) out.push(`next: ${next.join("\n      ")}`);
  return readAs(out.join("\n"));
}

if (import.meta.main) {
  try {
    console.log(await run(process.argv.slice(2)));
  } catch (err) {
    if (!(err instanceof FindError)) throw err;
    console.error(err.message);
    process.exit(err.code);
  }
}
