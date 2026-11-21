// One lookup over everything a film can name (vault sounds, every film-stage preset), built so an agent reads ~15 lines
// instead of grepping SOURCES.json: bun run find --help. Keyword and OpenFilm meaning results keep separate orders.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { FIT_NO, FIT_YES, jevJudge as judgeBy } from "../packages/clip-catalog/jev";
import { type ShakeName, SHAKES } from "../packages/film-kit/src/handheld";
import { PRIME_LENSES } from "../packages/film-kit/src/lens";
import { ANIM_CURVES, ANIMS } from "../packages/film-stage/src/animate-meta";
import { EASE_JOBS, EASES } from "../packages/film-stage/src/camera-meta";
import { ADJUSTMENTS } from "../packages/film-stage/src/grade-meta";
import { LOOK_IDS, LOOKS } from "../packages/film-stage/src/looks";
import {
  FONTS,
  SHAPE_IN,
  SHAPE_OUT,
  SHAPES,
  TEXT_IN,
  TEXT_OUT,
  TITLE_EASES,
} from "../packages/film-stage/src/titles";
import { TRANSITION_EASES, TRANSITIONS } from "../packages/film-stage/src/transitions-meta";
import { VELOCITY_EFFECTS, VELOCITY_LOOKS } from "../packages/film-stage/src/velocity-meta";
import {
  catTitle,
  editionOf,
  MC_HEADINGS,
  originOf,
  sentenceSlug,
} from "../packages/live-studio/app/sound/groups";
import { assetId, assetInfo, matchesAssetId } from "../packages/live-studio/src/asset-recipes.mjs";
import { favoriteLists, LIST_NAME } from "../packages/live-studio/src/favorites.mjs";
import {
  openPropLibrary,
  PROP_CODE_EXTS,
  PROP_MEDIA_EXTS,
} from "../packages/live-studio/src/prop-library.ts";
import {
  findVaults,
  openSound,
  probeAudio,
  walkAudio,
} from "../packages/live-studio/src/sound.mjs";
import { resolveMcAssetBounds } from "../packages/mc-assets/src/bounds.ts";
import {
  foldObjectVariants,
  loadMcAssetsCatalog,
  loadWarmMcCache,
  matchesMcPackSource,
  type McAssetItem,
} from "../packages/mc-assets/src/catalog.ts";
import { readAssetCatalog } from "./openfilm/catalog.mjs";
import { openFilmCategory, type OpenFilmLookup, openFilmSearch } from "./search/openfilm";
import { displayAbout, dualSearchOutput } from "./search/output";
import { assetFile, assetKey } from "./semantic/catalog";
import { EXTERNAL, LOCAL, ROOT, vaultPath } from "./vault.mjs";

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
  // starred by the creator (the studio's star, or find --star)
  fav?: boolean;
  // the catalogue record behind the line, for --show
  data?: Detail;
  semantic?: {
    score: number;
    part: number;
    input: "text" | "audio" | "video" | "image";
    segment?: { from: number; to: number };
  };
};
// What --show reads from a sound's SOURCES/PEAKS, a mocap clip's catalogue row or a film-stage preset
type Detail = {
  format?: string;
  group?: string;
  license?: string;
  url?: string;
  file?: string;
  peaks?: number[];
  step?: number;
  takes?: string[];
  family?: string;
  variant?: number;
  seq?: string[];
  fix?: Review;
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
  imports?: string[];
  variants?: { id: string; name: string }[];
  [k: string]: unknown;
};

const SOUND = ["sfx", "bgm", "mc"];
const OBJECT_KINDS = ["block", "item", "mob", "prop"] as const;
const isObjectKind = (k: string) => (OBJECT_KINDS as readonly string[]).includes(k);

const USE: Record<string, string> = {
  sound:
    'audio.json sfx[] {"at","name","gain"} | beds[] {"name","from","to","gain","fadeIn","fadeOut"}',
  block:
    "placed.json objects: bun run asset use block:<ns>:<id> --film films/<name> --from 0 (mod blocks auto-pick into pack/picks.json)",
  item: 'hand/scene attach: bun run asset pick item:<ns>:<id> --film films/<name>, then await itemModel(assets, "<ns>:<id>") from mc-assets/model (or loadModel(group, assets, await resolveModelData(assets, {model:"<ns>:item/<id>",type:"item"}), {display:{}})) in src/scene.ts (items do not go in placed.json)',
  mob: "placed.json objects: bun run asset use mob:<id> --film films/<name> --from 0",
  prop: 'Global: bun run asset use prop:global:<id> --film films/<name> (copies to src/props/); Film: import from "./props/<id>"',
  transition: 'shots.json shot.transition {"fx","len"}',
  "transition-ease": "shots.json shot.transition.ease",
  anim: 'shots.json shot.anim.in|out|combo {"fx"} (+ "len" on in/out; anim-in plays as the shot starts, anim-out as it ends, anim-combo across the whole shot; one id can be all three)',
  "anim-curve": "shots.json shot.anim.<in|out|combo>.curve",
  text: 'text.json items[] kind "text": .in|.out {"fx","len"}',
  shape: "text.json items[] kind arrow|circle|box|bracket|underline: .in|.out",
  font: "text.json items[].font",
  adjust: "adjust.json items[].grade.basic.<id> or shots.json shot.adjust.basic.<id>",
  look: 'shots.json shot.adjust {"look":"teal-amber"} or adjust.json items[].grade {"look":"teal-amber"}',
  lens: 'cam.json key {"mm":50,"fstop":2,"focus":"Steve.head"} or film-kit/lens helpers in scene.ts',
  shake:
    'cam.json key.handheld {"preset","amount","speed","move"} or shots.json shot.hits[] {"t","amount","decay","freq","max"}',
  velocity:
    'timing.json velocity[] {"effect","music","beats","from","to","frequency":1|2,"speed":"normal|fast|veryFast","intensity":0-100}',
  ease: "cam.json key.ease, props.json ease",
  mocap: 'steve.json moves[] {"t","at","yaw","clip"} (+ "from","rate","loop","blend")',
  asset:
    "GPU texture/transition/LUT recipes; bun run find --show <id>; bun run asset use <id> --film films/<name>",
};
const useOf = (kind: string) =>
  usageFiles(
    SOUND.includes(kind) ? USE.sound! : (USE[kind] ?? USE[kind.split("-")[0] ?? ""] ?? ""),
  );

// Light stemming, the same on both sides: creaky/creaking -> creak, doors -> door, typing/typed/type -> typ
const stem = (w: string) => {
  let s = w.replace(/^(.)(?:ies|ying)$/, "$1ie").replace(/ies$/, "y");
  if (s.length > 4) s = s.replace(/(?:ing|ed|es)$/, "");
  // sitting -> sitt -> sit (Porter's 1b; ll, ss and zz stay: falling, kissing, buzzing)
  if (s.length > 3) s = s.replace(/([^aeioulsz])\1$/, "$1");
  if (s.length > 3 && !s.endsWith("ss")) s = s.replace(/s$/, "");
  // zombie and zombies (via zomby) both end as zomb
  if (s.length > 3) s = s.replace(/(?:ie|[ye])$/, "");
  return s;
};
const plain = (text: string) =>
  text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean);
const words = (text: string) => plain(text).map(stem);
// Words are matched as English; letters outside it (Vietnamese, emoji aside) would only match stray fragments
export const isForeign = (text: string) => /[^a-z]/i.test(text.replace(/[^\p{L}]/gu, ""));

// Words that name nothing: kept out of the query so "a" or "the" never matches a description
const STOP = new Set(
  words(
    "a an the of by to in on for with and or at from his her their it is as into onto that this these those some something thing like when which who what how be are was were very really just quite want need i me my we you your",
  ),
);
// Stop words that still point a way ("fade in" vs "fade out"): never required of a hit, they only add to one that says them
const WAYS = new Set(words("in on to from into onto"));

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
  kind === asked ||
  kind.startsWith(`${asked}-`) ||
  (asked === "sound" && SOUND.includes(kind)) ||
  (asked === "object" && isObjectKind(kind));
const entryMatchesKind = (entry: Entry, asked: string) =>
  kindMatches(entry.kind, asked) ||
  (entry.kind === "asset" &&
    entry.cat === ({ look: "filter", shape: "sticker" }[asked] ?? asked)) ||
  (asked === "filter" && entry.kind === "look") ||
  (asked === "sticker" && entry.kind === "shape");
const fromSource = (entry: Entry, source: string) => {
  const src = entry.src?.toLowerCase();
  const pack = typeof entry.data?.pack === "string" ? entry.data.pack.toLowerCase() : "";
  if (isObjectKind(entry.kind)) {
    return pack ? matchesMcPackSource(source, pack, src) : src === source;
  }
  const cleanSource = source.replace(/\.(?:jar|zip)$/i, "");
  return Boolean(
    (src &&
      (src === source ||
        src === cleanSource ||
        src.startsWith(`${source}/`) ||
        (source === "builtin" && src.startsWith("film-stage/")))) ||
    (pack && (pack === source || pack.replace(/\.(?:jar|zip)$/i, "") === cleanSource)),
  );
};
const groupOf = (entry: Entry) => String(entry.data?.group ?? entry.cat);

// The words a query uses for a kind ("music", "beat"), so they reach entries that never say them
const KIND_WORDS: Record<string, string> = {
  bgm: "music song track score",
  sfx: "sound effect",
  mc: "minecraft sound",
  block: "3d object minecraft block prop furniture decor",
  item: "3d object minecraft item tool weapon held",
  mob: "3d object minecraft entity creature animal mob",
  prop: "3d object custom prop ts glb library",
  velocity: "beat sync",
  ease: "camera curve",
  lens: "camera focal fov dof bokeh focus aperture framing",
  shake: "camera handheld trauma impact hit",
  look: "grade color lut palette cinema mood",
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
const catScope = (xs: readonly Pick<Entry, "kind">[]) =>
  new Set(xs.map((x) => x.kind)).size === 1 ? xs[0]?.kind : undefined;
const narrowCatKey = (x: Pick<Entry, "kind" | "cat">, one?: string) =>
  one ? `${one}/${catSlug(x.cat)}` : catKey(x);
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
  "sfx/impacts": "hit boom punch thud slam blast bang explosion crash debris",
  "sfx/weapons": "gun gunshot shot rifle pistol reload sword blade melee arrow combat",
  "sfx/creatures": "monster zombie growl roar alien beast dragon",
  "sfx/spells": "magic spell enchant sparkle cast fairy",
  "sfx/nature": "weather rain thunder water fire animal bird dog wind",
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
  "mc/ambience": "ambient atmosphere background environment",
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
const fieldWords = (x: Entry, withKind = true) => {
  const head = words(`${x.id} ${x.title}`),
    cat = words(`${x.cat} ${catLabel(x) === x.cat ? "" : catLabel(x)}`);
  const kind = withKind
    ? words(`${x.kind} ${KIND_WORDS[x.kind] ?? ""} ${CAT_WORDS[catKey(x)] ?? ""}`)
    : [];
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
    const ofKind = pool.filter((x) => entryMatchesKind(x, k));
    if (!ofKind.length) {
      const propExts = [...PROP_CODE_EXTS, ...PROP_MEDIA_EXTS].join("/");
      bad.push(
        k === "mocap"
          ? `mocap has no indexed clips on this machine (vault/motion/catalog has no *.jsonl files). Build or sync the mocap catalogue, or write custom poses in src/timeline/steve.json.`
          : k === "prop"
            ? `prop has no custom props yet (no supported ${propExts} files in vault/props/ or active film src/props/). Add custom props there, or search built-in/mod models with bun run find --kind block,item,mob.`
            : unknownKind(a, pool),
      );
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
    if (!c) return (x: Entry) => entryMatchesKind(x, k);
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
        `--kind ${said}/${c} read as ${[...keep].map((cat) => `${k}/${catSlug(cat)}`).join(", ")}`,
      );
    return (x: Entry) => entryMatchesKind(x, k) && keep.has(x.cat);
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
    lut: "look",
    palette: "look",
    dof: "lens",
    bokeh: "lens",
    focal: "lens",
    focus: "lens",
    aperture: "lens",
    fstop: "lens",
    fov: "lens",
    framing: "lens",
    handheld: "shake",
    trauma: "shake",
    rumble: "shake",
    jolt: "shake",
    motion: "mocap",
    clip: "mocap",
    beat: "velocity",
    pulse: "velocity",
    "3d": "object",
    objects: "object",
    model: "object",
    models: "object",
    blocks: "block",
    items: "item",
    mobs: "mob",
    entity: "mob",
    entities: "mob",
    props: "prop",
    custom: "prop",
  }).map(([w, k]) => [stem(w), k]),
);
const ALIAS_NOTE: Record<string, string> = {
  anim: "camera moves and shot animations; camera curves are --kind ease",
  bgm: "background music",
  block: "Minecraft vanilla, gohans and mod blocks",
  item: "Minecraft vanilla and mod items",
  lens: "prime lenses, framing and DOF helpers",
  look: "named film-stage color looks",
  mob: "Minecraft mobs with entity animations",
  object: "blocks, items, mobs and props together",
  prop: "custom Global (vault/props) and Film (src/props) props",
  shake: "handheld presets and procedural impact trauma",
  sound: "sfx, bgm and mc together",
  text: "title and caption animations",
  transition: "the cut between two shots",
  velocity: "effects that pulse on each beat of the music",
};
const kindOf = (said: string, pool: Entry[]) => {
  if (pool.some((x) => entryMatchesKind(x, said))) return said;
  const s = stem(said);
  const kinds = [
    ...new Set(pool.flatMap((x) => (x.kind === "asset" ? [top(x.kind), x.cat] : [top(x.kind)]))),
    "sound",
    ...(pool.some((x) => isObjectKind(x.kind)) ? ["object"] : []),
  ];
  // another name gives way to a category of that name (effects is adjust/effects, curve is anim/curve)
  const isCat = pool.some((x) => x.cat && catSlug(x.cat) === catSlug(said));
  return kinds.find((k) => stem(k) === s) ?? (isCat ? undefined : KIND_ALIAS[s]) ?? said;
};
// "sfx/typing 37, sfx/clicks 93 (Clicks) ...": a kind's categories as --kind takes them, biggest first, with the studio's
// heading where it says more
const catList = (xs: Entry[]) => {
  // all of one sub-kind (--kind text-in): its categories are named under it, or text/<cat> would take text-out too
  const one = catScope(xs);
  const keyOf = (x: Entry) => narrowCatKey(x, one);
  const by = groupBy(
    xs.filter((x) => x.cat),
    keyOf,
  );
  return [...by]
    .map(([key, ys]) => [key, foldSoundEntries(ys)] as const)
    .toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, ys]) => {
      const label = catLabel(ys[0]!);
      return `${key} ${ys.length}${catSlug(label) === key.split("/")[1] ? "" : ` (${label})`}`;
    })
    .join(", ");
};
// Narration is generated per film, never a vault entry; sfx/voices holds short callouts and vocal clips
const SPOKEN = new Set(
  words("narration narrator voiceover voice speech dialogue dialog tts spoken voiceline"),
);
const SPOKEN_NOTE =
  "a spoken line (narration, voiceover, dialogue) is made, not found: in a film folder, bun run voice:gen reads the script in src/edit.json (run it bare first, a preview; --yes spends voice credits); how: bun run skills get core --ref voice. The vault's --kind sfx/voices are short callouts and vocal clips (laughs, bites, announcers), not custom spoken lines";
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
          (x) =>
            x.cat &&
            (catSlug(x.cat) === slug ||
              words(`${catLabel(x)} ${CAT_WORDS[catKey(x)] ?? ""}`).includes(stem(slug))),
        )
        .map(catKey),
    ),
  ];
  return asCat.length
    ? `${asked} is a category, not a kind: --kind ${asCat.join(",")}`
    : `Unknown --kind ${asked}. Kinds: ${counts(pool)}, or sound for sfx+bgm+mc; each takes a /<category> (bun run find --kind <kind> lists them). e.g. bun run find door --kind sfx`;
};

// The Sound panel's filters: Real / Studio recordings or Code-gen (sfx, bgm), Vanilla or Modded packs (mc)
const ORIGINS = {
  real: "Real / Studio: recordings",
  synth: "Code-gen: made in code",
  unknown: "Unverified recording or synthesis origin",
};
const EDITIONS = { vanilla: "Vanilla Minecraft", modded: "Modded packs" };
const providerOf = (x: Entry) => (typeof x.data?.source === "string" ? x.data.source : x.src);
const originOfEntry = (x: Entry) =>
  originOf({
    name: x.id,
    source: providerOf(x),
    origin: x.data?.origin as "real" | "synth" | "unknown" | undefined,
  });
const editionOfEntry = (x: Entry) =>
  isObjectKind(x.kind)
    ? x.data?.edition === "vanilla" || x.src === "minecraft"
      ? "vanilla"
      : "modded"
    : editionOf({ source: providerOf(x) });
// What a sound asks of a YouTube upload. Mojang's usage guidelines (minecraft.net/usage-guidelines) allow its game audio in
// monetised Minecraft videos; mods ship sounds under code licences (MIT, Apache, LGPL, GPL, PolyForm Shield) whose notice
// terms were written for software, so the safe reading is a credit, and whether copyleft reaches a video is untested
const LICENSES = {
  free: "nothing to do: no credit, no Content ID claim (CC0, Mixkit, Pixabay, earshot, repo)",
  credit: "CC BY: name the author and licence in the video description",
  claim: "YouTube Content ID claims the video when uploaded",
  minecraft:
    "Mojang's own game assets: fine in a Minecraft video under Mojang's usage guidelines, not in other videos",
  mod: "a mod/pack's assets under a code or custom licence (MIT, Apache, LGPL, GPL, PolyForm Shield, custom): name it and check its licence terms",
};
const CODE_LICENSE = /\b(?:MIT|Apache|L?GPL|PolyForm|MPL)\b/i;
const licenseOf = (x: Entry): keyof typeof LICENSES => {
  const l = String(x.data?.license ?? "");
  if (x.data?.contentId) return "claim";
  if (/\bCC[ -]BY\b/i.test(l)) return "credit";
  if (/^Minecraft\b/i.test(l)) return "minecraft";
  if (CODE_LICENSE.test(l)) return "mod";
  if (isObjectKind(x.kind)) {
    if (l === "repo" || /\b(?:CC0|Unlicense|Public[- ]?Domain)\b/i.test(l)) return "free";
    return "mod";
  }
  return "free";
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
  opt: { kinds?: string[]; n?: number; ownOnly?: boolean } = {},
): (Entry & { score: number; matched: number; of: number })[] {
  const pool = opt.kinds?.length
    ? entries.filter((x) => opt.kinds?.some((k) => entryMatchesKind(x, k)))
    : entries;
  const docs = pool.map((x) => fieldWords(x, !opt.ownOnly));
  const avg = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
  const q = slotsOf(query);
  const ways = [...new Set(words(query))].filter((w) => WAYS.has(w));
  const df = new Map(
    [...q.flat(), ...ways].map((w) => [w, docs.filter((d) => d.includes(w)).length] as const),
  );
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
      const bm25 =
        per.reduce((s, v) => s + v, 0) +
        (matched ? ways.reduce((s, w) => s + termScore(d, w), 0) : 0);
      // coord (Lucene's classic similarity): a hit with 3 of 4 words outranks one rare word said often
      return { ...x, score: (bm25 * matched) / (q.length || 1), matched, of: q.length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opt.n ?? Infinity);
}

export const keywordSearch = (entries: Entry[], query: string, kinds?: string[]) => {
  const foreign = isForeign(query);
  const kindNames = kinds?.map((kind) => kind.split("/")[0]!);
  const kindSaid = new Set(
    (kindNames ?? []).flatMap((kind) =>
      (kind === "sound" ? SOUND : [kind]).flatMap((name) => [
        ...words(`${name} ${KIND_WORDS[name] ?? ""}`),
        ...Object.entries(KIND_ALIAS).flatMap(([word, to]) => (to === name ? [word] : [])),
        ...Object.entries(KIND_NAMED).flatMap(([word, to]) => (to === name ? [word] : [])),
      ]),
    ),
  );
  const asksOf = (pool: Entry[]) => {
    const own = kinds?.length
      ? new Set(pool.flatMap((entry) => fieldWords(entry, false)))
      : undefined;
    const said = plain(query).filter((word) => !kindSaid.has(stem(word)) || own?.has(stem(word)));
    return { said, asks: said.length ? said.join(" ") : query };
  };
  const options = { ownOnly: Boolean(kinds?.length) };
  const rankIn = (pool: Entry[]) => rank(pool, asksOf(pool).asks, options);
  const { said, asks } = asksOf(entries);
  const ranked = foreign ? [] : rank(entries, asks, options);
  const typed = [...new Set(plain(asks))].filter(
    (word) => !STOP.has(stem(word)) && !/^\d+$/.test(word),
  );
  const named = kinds ? [] : [...new Set(typed.flatMap((word) => KIND_NAMED[stem(word)] ?? []))];
  const whole = plain(query).join(" ");
  const first = (entry: Entry) =>
    plain(entry.id).join(" ") === whole
      ? -1
      : (entry.kind === "mocap" && (entry.secs ?? 1) < 0.1 ? 2 : 0) +
        (named.length && !named.includes(top(entry.kind)) ? 1 : 0);
  const wordMatches = ranked.toSorted((a, b) => first(a) - first(b));
  return {
    foreign,
    said,
    asks,
    ranked,
    typed,
    named,
    rankIn,
    wordMatches,
    matches: foldSoundEntries(wordMatches, true, (takes) => takes[0]!),
  };
};

type SoundItem = {
  name: string;
  kind?: string;
  category?: string;
  family?: string;
  variant?: number;
  title?: string;
  for?: string;
  source?: string;
  origin?: "real" | "synth" | "unknown";
  license?: string;
  contentId?: boolean;
  seconds?: number;
  url?: string;
  file?: string;
  peaks?: number[];
  step?: number;
};

const inRange = (value: number | undefined, [lo, hi]: readonly [number, number]) =>
  value !== undefined && value >= lo && value <= hi;

const groupBy = <T, K>(items: T[], keyOf: (item: T) => K) => {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item),
      group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
};
const soundKey = (entry: Entry, fold = true) =>
  SOUND.includes(entry.kind)
    ? fold && entry.data?.family
      ? `family:${entry.data.family}`
      : `name:${entry.id}`
    : entry;
const foldSoundEntries = <T extends Entry>(
  entries: T[],
  fold = true,
  representative = (takes: T[]) =>
    takes.toSorted((a, b) => (a.data?.variant ?? 0) - (b.data?.variant ?? 0))[0]!,
): T[] =>
  [...groupBy(entries, (entry) => soundKey(entry, fold)).values()].map((takes) => {
    if (!SOUND.includes(takes[0]!.kind)) return takes[0]!;
    const first = representative(takes);
    const names = [...new Set(takes.flatMap((take) => take.data?.takes ?? [take.id]))];
    return {
      ...first,
      takes: Math.max(names.length, ...takes.map((take) => take.takes ?? 1)),
      data: { ...first.data, takes: names },
      ...(takes.some((take) => take.fav) && { fav: true }),
    };
  });

export function soundEntries(
  items: SoundItem[],
  fold = true,
  duration?: readonly [number, number],
): Entry[] {
  const entries: Entry[] = items
    .filter((item) => !duration || inRange(item.seconds, duration))
    .map((first) => {
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
        takes: 1,
        secs: first.seconds,
        ...(note && { note }),
        data: { ...first, takes: [first.name] },
      };
    });
  return foldSoundEntries(entries, fold);
}

// Mocap clips from the catalogue clip-catalog/catalog.sh measured (vault/motion/catalog/<lib>.jsonl), with the notes
// written by eye (review.json); category = the posture it starts and ends in. catalog.py keeps the body filters and Jev's rerank.
type Clip = {
  ref: string;
  dur?: number;
  start?: string;
  end?: string;
  seq?: string[];
  [k: string]: unknown;
};
// start/end/seq: postures as checked by eye, over the measured ones
type Review = {
  dur?: number;
  desc?: string;
  mood?: string[];
  prop?: string[];
  style?: string[];
  flaw?: string;
  start?: string;
  end?: string;
  seq?: string[];
};
// catalog.py's own fight words and retarget-break limits (catalog.py fights(), broken())
const SCREEN: { fights: string[]; broken: Record<string, [number, string]> } = JSON.parse(
  readFileSync(join(ROOT, "packages/clip-catalog/screen.json"), "utf8"),
);
// a fight word at a word's start in the clip's name (after a non-letter or a camel hump): Wheelbarrow is no arrow
export const isFight = (ref: string) => {
  const name = ref.split("/").at(-1)!;
  return [...name.matchAll(/(?<![A-Za-z])[A-Za-z]|(?<=[a-z])[A-Z]/g)].some((m) =>
    SCREEN.fights.some((w) => name.slice(m.index).toLowerCase().startsWith(w)),
  );
};
export const defaultSearchEntry = (entry: Entry) => entry.kind !== "mocap" || !isFight(entry.id);
// ref -> "retarget breaks on Steve: <what> at <s> s; ..." for clips whose sweep (sweep_<lib>.jsonl) crosses a limit
const brokenOf = (dir: string, lib: string) => {
  const f = join(dir, `sweep_${lib}.jsonl`);
  const out = new Map<string, string>();
  if (!existsSync(f)) return out;
  for (const r of readJsonl<{ clip: string; s?: Record<string, [number, number]> }>(f, "clip")) {
    const seen = new Map<string, number>();
    for (const [k, [v, t]] of Object.entries(r.s ?? {}))
      for (const [check, [limit, what]] of Object.entries(SCREEN.broken))
        if (k.startsWith(check) && v > limit && !seen.has(what)) seen.set(what, t);
    if (seen.size)
      out.set(
        `${lib}/${r.clip}`,
        `retarget breaks on Steve: ${[...seen]
          .toSorted((a, b) => a[1] - b[1])
          .map(([w, t]) => `${w} at ${t} s`)
          .join("; ")}`,
      );
  }
  return out;
};
export function mocapEntries(dir = join(LOCAL, "motion/catalog")): Entry[] {
  const review: Record<string, Review> = readJson(join(dir, "review.json"));
  return ["mixamo", "ual1", "ual2"].flatMap((lib) => {
    const f = join(dir, `${lib}.jsonl`);
    if (!existsSync(f)) return [];
    const brk = brokenOf(dir, lib);
    return readJsonl<Clip & { error?: unknown }>(f, "ref").flatMap((c) => {
      if ("error" in c) return [];
      const seen = review[c.ref] ?? {},
        flaw = [seen.flaw, brk.get(c.ref)].filter(Boolean).join("; "),
        r = { ...seen, ...(flaw && { flaw }) },
        dur = r.dur ?? c.dur,
        start = r.start ?? c.start,
        end = r.end ?? c.end,
        // what he touches is searched as --prop and catalog.py's words read it: most descs never say "chair"
        props = (r.prop ?? []).filter((p) => p !== "none"),
        tags = [
          r.mood?.join(", "),
          r.style?.join(", "),
          props.length && `touches ${props.join(", ")}`,
        ].filter(Boolean);
      return [
        {
          kind: "mocap",
          id: c.ref,
          cat: start === end ? (start ?? "") : `${start}>${end}`,
          title: (c.ref.split("/")[1] ?? "").replace(/_[0-9a-f]{8}$/, "").replace(/_/g, " "),
          about: [r.desc, tags.length && `(${tags.join("; ")})`].filter(Boolean).join(" "),
          src: lib,
          secs: dur,
          ...((r.flaw || (dur ?? 1) < 0.1) && {
            note: r.flaw ? `flaw: ${r.flaw}` : "one frame: a still pose",
          }),
          // seq drops runs under 0.2 s, but --from/--to read the first and last 0.2 s: the shown order holds both
          data: {
            ...c,
            ...r,
            seq: r.seq?.length
              ? r.seq
              : [start, ...(r.seq ?? c.seq ?? []), end].filter(
                  (x, i, a): x is string => !!x && x !== a[i - 1],
                ),
            fix: r,
            checked: c.ref in review,
          },
        },
      ];
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
  const list = (kind: string, xs: readonly (Preset & { file?: string })[], file: string) =>
    xs.map((x) => {
      const f = x.file ?? file;
      return {
        kind,
        ...(f && { src: f.includes("/") ? f : `film-stage/${f}.ts` }),
        id: x.id,
        cat: x.category ?? x.cat ?? x.group ?? sub(kind),
        title: x.title ?? x.id,
        about: x.tip ?? "",
        data: { ...x },
      };
    });
  const SHAKE_META: Partial<Record<ShakeName, { title: string; tip: string }>> = {
    INVESTIGATION: {
      title: "Investigation",
      tip: "Attentive handheld search drift (rotate and move, 24fps Shakify)",
    },
    THE_CLOSEUP: {
      title: "The Closeup",
      tip: "Subtle breathing poise for tight character shots and dialogue (rotate and move)",
    },
    THE_WEDDING: {
      title: "The Wedding",
      tip: "Warm, balanced documentary hand sway (rotate and move)",
    },
    WALK_TO_THE_STORE: {
      title: "Walk To The Store",
      tip: "Rhythmic walking footsteps cadence (rotate and move)",
    },
    HANDYCAM_RUN: {
      title: "Handycam Run",
      tip: "Urgent jogging chase bounce (rotate and move)",
    },
    OUT_CAR_WINDOW: {
      title: "Out Car Window",
      tip: "Engine hum and high-frequency road vibration (rotate and move)",
    },
    BIKE_ON_GRAVEL_2D: {
      title: "Bike On Gravel 2D",
      tip: "Coarse chatter without translation drift (rotate only)",
    },
    SPACESHIP_SHAKE_2D: {
      title: "Spaceship Shake 2D",
      tip: "Heavy low-frequency hull rumble (rotate only)",
    },
    THE_ZEEK_2D: {
      title: "The Zeek 2D",
      tip: "Loose erratic tremble (rotate only)",
    },
  };
  const lenses = [
    ...PRIME_LENSES,
    {
      id: "shotSize",
      cat: "Helpers",
      title: "Shot Size Distance",
      tip: "Distance in metres for ECU/CU/MCU/MS/WS/EWS from subject height and mm",
      pkg: "film-kit/lens",
      code: "const d = shotSize('MCU', { height: 1.8, mm: 50 });",
    },
    {
      id: "frameSubject",
      cat: "Helpers",
      title: "Frame Subject",
      tip: "Computes { p, l, fov, mm } around a target [x, y, z] by shot size, angle, headroom, thirdX",
      pkg: "film-kit/lens",
      code: "const key = frameSubject([0, 1.5, 0], { size: 'MCU', mm: 50, thirdX: -0.33 });",
    },
    {
      id: "dollyZoom",
      cat: "Helpers",
      title: "Vertigo Dolly-Zoom",
      tip: "New camera distance holding subject size while changing lens FOV",
      pkg: "film-kit/lens",
      imports: ["dollyZoom", "fovOf"],
      code: "const d1 = dollyZoom(3, fovOf(35, 16 / 9), fovOf(85, 16 / 9));",
    },
    {
      id: "followTarget",
      cat: "Helpers",
      title: "Damped Rig Follow",
      tip: "Deterministic critically damped 3D spring lag/lead chase tracker across [from, to]",
      pkg: "film-kit/spring",
      code: "const rig = followTarget((t) => [x(t), 1.5, z(t)], { from: 0, to: 10, smooth: 0.25, lead: 0.15 });",
      file: "film-kit/spring.ts",
    },
  ];
  const shakes = [
    ...SHAKES.map((id) => ({
      id,
      cat: "Shakify",
      ...(SHAKE_META[id] ?? { title: id, tip: "Camera Shakify handheld loop" }),
    })),
    {
      id: "hits",
      cat: "Trauma",
      title: "Shot Impact Trauma",
      tip: "shots.json shot.hits[] decaying impact rattle; keeps frame exempt from motion POPS",
      file: "film-stage/animate.ts",
    },
    {
      id: "shake",
      cat: "Trauma",
      title: "Procedural Trauma",
      tip: "Seeded simplex2d Eiserloh trauma^2 rotation-only ([yaw, pitch, roll] deg, no move) for custom rigs in scene.ts",
      file: "film-kit/shake.ts",
    },
  ];
  const eases = Object.entries(EASE_JOBS).flatMap(([group, { eases, job }]) =>
    eases.map((id) => ({
      id,
      group,
      tip: easeAbout((EASES as Record<string, (t: number) => number>)[id]!, job),
    })),
  );
  return [
    ...list("transition", TRANSITIONS, "transitions-meta"),
    ...list("transition-ease", TRANSITION_EASES, "transitions-meta"),
    ...list("anim-in", ANIMS.in, "animate-meta"),
    ...list("anim-out", ANIMS.out, "animate-meta"),
    ...list("anim-combo", ANIMS.combo, "animate-meta"),
    ...list("anim-curve", ANIM_CURVES, "animate-meta"),
    ...list("text-in", TEXT_IN, "titles-catalog"),
    ...list("text-out", TEXT_OUT, "titles-catalog"),
    ...list(
      "shape",
      Object.entries(SHAPES).map(([id, s]) => ({ id, ...s, cat: "Marks" })),
      "titles-catalog",
    ),
    ...list("shape-in", SHAPE_IN, "titles-catalog"),
    ...list("shape-out", SHAPE_OUT, "titles-catalog"),
    ...list("font", FONTS, "titles-catalog"),
    ...list("adjust", ADJUSTMENTS, "grade-meta"),
    ...list(
      "look",
      LOOK_IDS.map((id) => ({ id, cat: "Look Presets", ...LOOKS[id]! })),
      "looks",
    ),
    ...list("lens", lenses, "film-kit/lens.ts"),
    ...list("shake", shakes, "film-kit/handheld.ts"),
    ...list(
      "velocity",
      VELOCITY_EFFECTS.map((id) => ({ id, ...VELOCITY_LOOKS[id] })),
      "velocity-meta",
    ),
    ...list("ease", eases, "camera-meta"),
  ];
}

// An ease in words, read off its own curve: an editor asks for "a slow start" or "a wind-up", not for snapOut. A list
// row cuts the end: the shape first (what tells a group's eases apart), its group's job, the numbers last
export function easeAbout(f: (t: number) => number, job?: string): string {
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
    job && `for ${job}`,
    `${Math.round(q1 * 100)}% of the way a quarter of the time in, ${Math.round(half * 100)}% at half`,
  ]
    .filter(Boolean)
    .join("; ");
}

// The vault's sound folders as the studio reads them (live-studio/src/sound.mjs findVaults): <kind>/<category>/<name>.<ext>
// with SOURCES.json (credits) and PEAKS.json (seconds) beside them
const jsonFault = (f: string, why: string, line?: number) =>
  new FindError(
    `${relative(process.cwd(), f).replaceAll("\\", "/")}${line === undefined ? "" : `:${line}`}: ${why}. ${line === undefined ? "Fix the file; bun run check names the fault in a film." : "Fix the row or rebuild this catalogue, then run find again."}`,
    1,
  );
const parseJson = (text: string, f: string, line?: number) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw jsonFault(f, `not valid JSON (${e instanceof Error ? e.message : String(e)})`, line);
  }
};
const readJsonl = <T>(f: string, key: keyof T): T[] => {
  const rows = new Map<T[keyof T], T>();
  for (const [line, text] of readFileSync(f, "utf8").split("\n").entries()) {
    if (!text.trim()) continue;
    const row = parseJson(text, f, line + 1) as T;
    if (typeof row?.[key] !== "string")
      throw jsonFault(f, `catalogue row needs a string "${String(key)}"`, line + 1);
    rows.set(row[key], row);
  }
  return [...rows.values()];
};
const commaList = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
const readJson = (f: string) => {
  if (!existsSync(f)) return {};
  const parsed = parseJson(readFileSync(f, "utf8").replace(/^\uFEFF/, ""), f);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
};
export function vaultSounds(dirs?: string[]): SoundItem[] {
  const mc = [join(LOCAL, "mc-sound"), join(EXTERNAL, "mc-sound")].find(existsSync);
  const out: SoundItem[] = [];
  for (const dir of (dirs ?? [mc, join(LOCAL, "sound")]).filter(
    (d): d is string => !!d && existsSync(d),
  )) {
    const sources = readJson(join(dir, "SOURCES.json")),
      peaks = readJson(join(dir, "PEAKS.json"));
    for (const [name, entry] of walkAudio(dir, dir, realpathSync(dir))) {
      const meta = sources[name] ?? {},
        cachedSeconds = peaks[name]?.seconds;
      out.push({
        ...meta,
        source: meta.source ?? "vault",
        name,
        kind: SOUND.includes(meta.kind) ? meta.kind : (entry.kind ?? "sfx"),
        category: (typeof meta.category === "string" && meta.category) || entry.category || "",
        seconds:
          Number.isFinite(cachedSeconds) && cachedSeconds > 0
            ? cachedSeconds
            : probeAudio(entry.file)?.seconds,
        peaks: peaks[name]?.peaks,
        step: peaks[name]?.step,
        file: relative(ROOT, entry.file).replaceAll("\\", "/"),
      });
    }
  }
  return out;
}

// Run from a film folder: its own sounds too, from the folder package.json "live-studio".sfx names (as the studio lists them:
// a top folder bgm/, sfx/ or mc/ is the kind). No PEAKS.json there: the length is read off the file's header
function filmConfig(film: string): Record<string, any> {
  return readJson(join(film, "package.json"))["live-studio"] ?? {};
}
function filmSourcesMap(film: string, conf = filmConfig(film)): Record<string, any> {
  if (typeof conf?.sfx !== "string") return {};
  const dir = resolve(film, conf.sfx);
  const rel = relative(resolve(film), dir);
  if (rel.startsWith("..") || isAbsolute(rel)) return {};
  return readJson(join(dir, "SOURCES.json"));
}
function filmSounds(
  film: string,
  conf: ReturnType<typeof filmConfig>,
  sound: ReturnType<typeof openSound>,
): SoundItem[] {
  const sources = filmSourcesMap(film, conf);
  if (!sound) return [];
  const own = new Set([
    ...walkAudio(resolve(film, conf.sfx ?? "sound/sfx"), null, realpathSync(film)).keys(),
    ...Object.keys(conf.soundSources ?? {}),
  ]);
  // soundSources exposes custom project files outside conf.sfx (keep "narration" pointing to voice:gen)
  return sound
    .library()
    .filter((item) => item.name !== "narration" && own.has(item.name))
    .map((item) => ({
      ...sources[item.name],
      ...item,
      origin: originOf(item),
      file: relative(film, sound.fileOf(item.name)!).replaceAll("\\", "/"),
    }));
}

// The id the studio's star gives an entry (live-studio/src/favorites.mjs): a sound by its file name, an effect by its
// panel's prefix; kinds no panel stars (mocap, fonts, eases...) by "<kind>:<id>", starred with find --star only
const STAR_PREFIX: Record<string, string> = {
  transition: "transition:",
  "anim-in": "in:",
  "anim-out": "out:",
  "anim-combo": "combo:",
  "text-in": "text:text:in:",
  "text-out": "text:text:out:",
  "shape-in": "text:shape:in:",
  "shape-out": "text:shape:out:",
};
type Favorites = { sounds: string[]; effects: string[] };
type FavoriteLists = ReturnType<typeof favoriteLists>;
const starOf = (x: Entry) =>
  SOUND.includes(x.kind)
    ? { kind: "sounds" as const, id: x.id }
    : isObjectKind(x.kind)
      ? { kind: "effects" as const, id: x.id }
      : { kind: "effects" as const, id: `${STAR_PREFIX[x.kind] ?? `${x.kind}:`}${x.id}` };
// a sound family is starred when any of its takes is (the studio stars the take that was playing)
export const markStarred = (xs: Entry[], favs: Favorites) => {
  const sounds = new Set(favs.sounds),
    effects = new Set(favs.effects);
  const starredFamilies = new Set(
    xs
      .filter(
        (x) =>
          SOUND.includes(x.kind) && [x.id, ...(x.data?.takes ?? [])].some((id) => sounds.has(id)),
      )
      .map((x) => soundKey(x)),
  );
  return xs.map((x) => {
    const s = starOf(x);
    const fav = s.kind === "sounds" ? starredFamilies.has(soundKey(x)) : effects.has(s.id);
    return fav === !!x.fav ? x : { ...x, fav };
  });
};

export const allEntries = (
  fold = true,
  film = process.cwd(),
  duration?: readonly [number, number],
) => {
  // a film file named as a vault sound plays instead of it (live-studio/src/sound.mjs)
  const conf = filmConfig(film);
  const sound = openSound(film, {
    ...conf,
    soundTimeline: conf.soundTimeline ?? "src/timeline/audio.json",
    sfx: conf.sfx ?? "sound/sfx",
  });
  const own = filmSounds(film, conf, sound),
    mine = new Set([...own.map((x) => x.name), ...Object.keys(conf.soundSources ?? {})]);
  const vaultDirs = (() => {
    try {
      return findVaults(film, conf);
    } catch {
      return [];
    }
  })();
  const rawVault = vaultSounds(vaultDirs);
  const resolved = new Map(sound?.library().map((item) => [item.name, item]));
  const vault = [
    ...groupBy(
      rawVault.filter((x) => !mine.has(x.name)),
      (x) => x.name,
    ).values(),
  ].flatMap((copies) => {
    const chosen =
      copies.length === 1
        ? copies[0]!
        : copies.find((x) => resolve(ROOT, x.file!) === sound?.fileOf(x.name));
    return chosen
      ? [
          {
            ...(resolved.get(chosen.name) ?? chosen),
            file: chosen.file,
            peaks: chosen.peaks,
            step: chosen.step,
          },
        ]
      : [];
  });
  return [
    ...presetEntries(),
    // src scopes discovery; data.source keeps the provider used by origin and edition.
    ...soundEntries([...own, ...vault], fold, duration).map((x) =>
      mine.has(x.id) ? { ...x, src: "this-film" } : x,
    ),
    ...mocapEntries(),
    ...readAssetCatalog(join(LOCAL, "openfilm")),
  ];
};

function readPickedSet(filmRoot?: string): Set<string> {
  const out = new Set<string>();
  if (!filmRoot) return out;
  const p = join(filmRoot, "pack/picks.json");
  if (!existsSync(p)) return out;
  try {
    const picks = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(picks)) return out;
    for (const row of picks) {
      const ns = typeof row?.namespace === "string" ? row.namespace : "";
      const jar = typeof row?.jar === "string" ? row.jar : "";
      if (!ns) continue;
      for (const b of Array.isArray(row?.blocks) ? row.blocks : []) {
        out.add(`block:${ns}:${b}`);
        if (jar) out.add(`${jar}|block:${ns}:${b}`);
      }
      for (const it of Array.isArray(row?.items) ? row.items : []) {
        out.add(`item:${ns}:${it}`);
        if (jar) out.add(`${jar}|item:${ns}:${it}`);
      }
    }
  } catch {}
  return out;
}

const mcItemToEntry = (item: McAssetItem, pickedSet?: Set<string>): Entry => {
  const isPicked =
    pickedSet && (item.pack ? pickedSet.has(`${item.pack}|${item.id}`) : pickedSet.has(item.id));
  const gplWarn =
    item.license && /\bGPL\b/i.test(item.license) && !/LGPL/i.test(item.license)
      ? `${item.license} copyleft`
      : "";
  const propKeys = item.props ? Object.keys(item.props).join(" ") : "";
  const clipNames = item.clips ? item.clips.map((c) => c.name).join(" ") : "";
  const note = [
    isPicked && "picked",
    !item.renderable && "non-renderable",
    gplWarn,
    !gplWarn && item.license && !["minecraft", "repo"].includes(item.license) && item.license,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    kind: item.kind,
    id: item.id,
    cat: item.kind === "mob" ? "minecraft" : item.namespace,
    title: item.title,
    about: [
      item.packTitle,
      item.namespace,
      propKeys && `props: ${propKeys}`,
      clipNames && `clips: ${clipNames}`,
      !item.renderable && item.brokenReason ? `broken: ${item.brokenReason}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    src: item.source,
    ...(note && { note }),
    data: { ...item, source: item.source },
  };
};

export async function objectEntries(options?: {
  vaultRoot?: string;
  gohansPackDir?: string;
  filmRoot?: string;
  quiet?: boolean;
}): Promise<Entry[]> {
  const envVault = process.env.MC_VAULT_ROOT?.trim()
    ? vaultPath(process.env.MC_VAULT_ROOT.trim())
    : LOCAL;
  const vaultRoot = options?.vaultRoot ?? envVault;
  const filmRoot =
    options?.filmRoot ??
    (existsSync(join(process.cwd(), "src/scene.ts")) ? process.cwd() : undefined);
  const pickedSet = readPickedSet(filmRoot);
  const cat = loadMcAssetsCatalog({
    vaultRoot,
    gohansPackDir: options?.gohansPackDir,
    quiet: options?.quiet,
  });
  const out = cat.items.map((it) => mcItemToEntry(it, pickedSet));

  const propLib = openPropLibrary(filmRoot ?? join(ROOT, "__no_film__"), vaultRoot);
  const propsCat = await propLib.catalog();
  for (const scope of ["global", "film"] as const) {
    if (scope === "film" && !filmRoot) continue;
    for (const p of propsCat[scope]) {
      const formats = [p.source && "ts", p.model && "glb", p.image && "image"]
        .filter(Boolean)
        .join(", ");
      const src = scope === "global" ? "global" : "this-film";
      out.push({
        kind: "prop",
        id: `prop:${scope}:${p.id}`,
        cat: scope,
        title: p.id.replaceAll("_", " ").replaceAll("/", " "),
        about: `${formats ? `${formats} ` : ""}${scope} custom prop`,
        src,
        data: { ...p, sourceFile: p.source, scope, rawId: p.id, source: src, renderable: true },
      });
    }
  }
  return out;
}

function partitionObjectEntries<T extends Entry>(entries: T[]) {
  const pos = new Map(entries.map((e, i) => [e, i]));
  const fixed: T[] = [];
  const mc: {
    entry: T;
    kind: "block" | "item" | "mob";
    id: string;
    pack?: string;
    source: string;
    namespace?: string;
    name?: string;
    title: string;
  }[] = [];
  for (const x of entries) {
    if (x.kind === "block" || x.kind === "item") {
      mc.push({
        entry: x,
        kind: x.kind,
        id: x.id,
        pack: typeof x.data?.pack === "string" ? x.data.pack : undefined,
        source: x.src ?? "",
        namespace: typeof x.data?.namespace === "string" ? x.data.namespace : undefined,
        name: typeof x.data?.name === "string" ? x.data.name : undefined,
        title: x.title,
      });
    } else {
      fixed.push(x);
    }
  }
  return { pos, fixed, mc };
}

function foldObjectEntries<T extends Entry>(entries: T[]): T[] {
  const { pos, fixed, mc } = partitionObjectEntries(entries);
  type FoldedRow = T & { _orig?: T };
  const foldedMc: FoldedRow[] = foldObjectVariants(mc).map((group) => {
    const head = group.entry;
    return group.variants && group.variants.length > 1
      ? ({
          ...head,
          _orig: head,
          data: {
            ...head.data,
            variants: group.variants.map((v) => ({
              id: v.id,
              name: typeof v.entry.data?.name === "string" ? v.entry.data.name : v.id,
            })),
          },
        } as FoldedRow)
      : head;
  });
  return ([...fixed, ...foldedMc] as FoldedRow[])
    .sort((a, b) => (pos.get(a._orig ?? a) ?? 0) - (pos.get(b._orig ?? b) ?? 0))
    .map((x) => {
      if (!("_orig" in x)) return x;
      const { _orig: _, ...clean } = x;
      return clean as T;
    });
}

const variantKey = (pack: string | undefined, source: string, id: string) =>
  `${pack ?? source}|${id}`;

function attachObjectVariants<T extends Entry>(entries: T[], includeBroken = false): T[] {
  const { mc } = partitionObjectEntries(
    entries.filter((x) => includeBroken || x.data?.renderable !== false),
  );
  const byId = new Map<string, { id: string; name: string }[]>();
  for (const group of foldObjectVariants(mc)) {
    if (!group.variants || group.variants.length <= 1) continue;
    const list = group.variants.map((v) => ({
      id: v.id,
      name: typeof v.entry.data?.name === "string" ? v.entry.data.name : v.id,
    }));
    for (const v of group.variants) byId.set(variantKey(v.pack, v.source, v.id), list);
  }
  if (!byId.size) return entries;
  return entries.map((x) => {
    const vs = byId.get(
      variantKey(typeof x.data?.pack === "string" ? x.data.pack : undefined, x.src ?? "", x.id),
    );
    return vs ? ({ ...x, data: { ...x.data, variants: vs } } as T) : x;
  });
}

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
  const said = heard ? `heard: ${heard}` : !tells(x) ? "" : displayAbout(x.about);
  const about = said.length > 90 ? `${said.slice(0, 89)}…` : said;
  const synth = (x.kind === "sfx" || x.kind === "bgm") && originOfEntry(x) === "synth";
  const tags = [x.fav && "starred", x.src, synth && "made in code", x.note]
    .filter(Boolean)
    .join(", ");
  const variantCount = Array.isArray(x.data?.variants) ? x.data.variants.length : 0;
  return [
    `${lead}${x.kind}${x.cat ? `/${x.cat}` : ""}`,
    `${x.id}${(x.takes ?? 1) > 1 ? ` (${x.takes} takes)` : ""}`,
    x.secs ? `${x.secs.toFixed(1)}s` : "",
    `${x.title}${variantCount > 1 ? ` (+${variantCount - 1} variants)` : ""}${about && about !== x.title ? ` — ${about}` : ""}`,
    tags ? `[${tags}]` : "",
  ]
    .filter(Boolean)
    .join("  ");
};

// The word matches Jev votes over when --jev has no --kind
const POOL = 250;
// Jev's yes/no fit is asked of this many hits at most, all in one request (a long -n lists more, unchecked)
const FITS_MAX = 12;
// A category longer than this is never offered whole (-n): 500 lines of it are ~65k characters of an agent's context
const LIST_ALL = 200;
// Sub-kinds that time an effect rather than being one (see the --jev pool)
const TIMING = ["transition-ease", "anim-curve"];
const jevText = (x: Entry) => `${x.kind} ${x.cat}: ${x.title}. ${x.about}`.trim();
// Jev's vote over the pool, best first, then a fit for each of the first `show`
export const jevJudge = (scene: string, pool: Entry[], show: number): Promise<Voted[]> =>
  judgeBy(
    {
      wanted: `What a film editor is looking for: ${scene}`,
      pick: "Which entry fits best?",
      yes: "The editor would use this entry as it is: it is the thing, sound, look or motion asked for",
      no: "It is a different thing, or only loosely related to what was asked",
      text: jevText,
    },
    pool,
    show,
  );

const HELP = `Usage: bun run find <words> [options]     (works from a film folder too, and then also searches the film's own sounds)
       bun run find --show <id[,id]>      files/licence, settings, and timeline placement or source adaptation

Finds what a film can name: vault sounds, mocap clips, native/imported transitions, effects, stickers, templates,
camera anims and curves, text and shape voices, fonts, adjust sliders, beat effects, camera eases.
One line per hit: kind/category  id-to-write  length  title —
description  [source], then where that id goes in the film's src/timeline and what to try next.

Options:
  --kind <k[,k]>   sfx, bgm, mc (Minecraft) or sound (all three); mocap; transition anim text shape font adjust look lens shake velocity ease; asset (editable source);
                   3D assets (opt-in): block, item, mob, prop or object (all four; alias 3d); each with /<namespace-or-scope> (block/decor, prop/global)
                   transition, text, look/filter and shape/sticker include native and imported visuals;
                   effect and template select imported visuals (asset/<category> also works)
                   each with /<category>, the studio's groups: --kind sfx/typing, mc/horror, transition/wipe, text/pop
                   (a word of the group is enough, and plain names work: music is bgm, titles is text, camera is anim;
                   the output says how a loose one was read). --kind <kind> alone: its groups with counts, then
                   every entry when 60 or fewer; --kind <kind>/<category>: that group, and the words its entries are
                   named by when it is long
  --variants       with object kinds: unfold grouped wood/color/tier variants onto separate lines
  --broken         with object kinds: include non-renderable models (.geo.json, .obj, custom loaders, missing parent/texture)
  --source <s[,s]> where it comes from: minecraft and each mod pack by name (alexs-caves, dusty-decorations ...), gohans, global, this-film, earshot,
                   mixkit, mixamo, openfilm, film-stage or film-kit (every preset) or one preset file; builtin aliases film-stage
  --group <name>   one native category or imported visual group (e.g. Basic, fade, ambience); alone lists groups
  --offset <N>     skip N entries in offline lists or word results; start at 0 and combine with -n
  --origin <o>     sfx and bgm: real (recordings), synth (made in code), unknown (unverified origin)
  --edition <e>    Minecraft sounds & 3D objects: vanilla (the game itself) or modded (mod packs)
  --license <l>    sounds & mod packs: free (nothing), credit (CC BY), claim (Content ID), minecraft, mod; or a word of a licence's own name: --license mit, --license lgpl
  --dur <min-max>  length in seconds, sounds and mocap clips: --dur 0-1 a short hit, --dur 120-600 a long track
  --fav [list]     only what the creator starred (the studio's star; rows tagged starred): the default list, or a named
                   one (--fav horror). Lists live in favorites/<list>.json, for every film; an answer names the others.
                   When the creator says "use my favourites", add --fav to every search. --favorites, --starred work too
  --star <id[,id]> star for the creator, when asked (--unstar takes it off); into a named list: --star boom --fav horror
                   (a new name makes the list). An id in several kinds needs --kind
  Any filter without a value lists its values with counts: bun run find --source lists every source and mod pack.
  Other names work and the output says how they were read: --licence, --type/--category (--kind), --pack/--mod
  (--source), --length/--duration (--dur), --limit (-n); values too: --origin recorded, --edition mods, --license cc-by
  -n <N>           hits per block (default 12, at most 200); BM25 and OpenFilm semantic have independent limits
  --offline        no OpenFilm requests: use its saved responses (24 h cache), else show BM25 with a cache-miss note
  --json           ordinary search schemaVersion 2: {mode,query,notes,keyword:{results},semantic:{scope,categories,results}}
                   keyword results are full records. A semantic hit with alsoKeyword:true has only key/rank/similarity;
                   find its full record in keyword.results by key. Other semantic hits include their full records.
                   The two blocks keep independent ranks. Similarity is not confidence; --semantic below keeps its old schema.
  --jev            rank by meaning with Jev, a small AI judge that reads any language: 1-3 s, under $0.01 a search. With
                   --kind it reads every entry of those kinds; without, it only reorders the word matches. Up to ${FITS_MAX} shown hits
                   get "fits" 0-1, Jev's own yes that it is what you asked for. Rows without fits are unchecked.
                   The next: line then says
                   FOUND (use the first), UNSURE (--show it first) or NOT IN THE VAULT (do not use them: make it)
  --semantic       hybrid local vectors + keywords; requires a prepared assets:semantic index. Cached queries
                   are offline; --yes permits a query API call. Failure falls back to keywords.
                   --db PATH and --dimensions 768|1536|3072 select a compatible index. Each audio take is separate.
                   --provider gemini (default), auto (Gemini alias) or explicitly openrouter. No failover.
                   MC_SEMANTIC_DB selects the shared index; live queries share its configured daily request budget.
                   --json returns {mode,query,notes,results}, including semantic input type and source chunk seconds;
                   keyword fallback stays JSON. Vector score is similarity, not confidence; inspect/listen before use.
                   Keeps kind/source/origin/edition/license/dur/fav filters; body filters and --jev are separate calls.
  --show <id>      the entry in full (ids are the second column; any take of a family); --kind/--source disambiguate
                   usable assets include the full recipe, source, exampleProps, units and asset use command
                   canonical recipe IDs (text/in/fade, openfilm:effects/snow, sound/<name>) also work
  mocap by body:   --from <posture> (at its start) --to <posture> (at its end) --has <posture> (anywhere in it)
                   --still (stays within 0.3 m) | --moves, --loop, --energy 10-40 (deg/s: idle ~10, walk ~30,
                   jump 200), --dur; hands: --head (at his head) --up (above it) --ground (on the floor), --bend
                   (bent over), --air yes|no, --look 45 (head turn, deg); --mood scared, --prop chair, --style natural (clips checked
                   by eye only; a wrong one lists them); --fights keeps weapons and fights (left out by default).
                   With words or --jev "<scene>"; a wrong posture lists them
  Any filter alone (--kind, --source, --group, --origin, --edition, --license, --dur, --fav) lists what it keeps.

Ordinary search returns BM25 first, then independent OpenFilm semantic candidates when those assets pass your filters.
OpenFilm receives only query text/category/limit, no files or keys; each category waits at most 2.5 s, two at a time.
Responses are cached for 24 h in MC_FIND_CACHE or .studio/openfilm-search.sqlite; MC_FIND_OFFLINE=1 disables requests.
API/cache errors keep BM25 intact. No prepared embedding index, Gemini, OpenRouter or Jev is used by default.
MC_FIND_CACHE paths start at the repo root; --offline uses fresh cache entries only. --kind mc never calls OpenFilm.
The semantic service always returns nearest candidates, even for nonsense: listen/view; no result is a fit guarantee.
BM25 searches English only (translate first); OpenFilm accepts other languages but cannot search local-only Minecraft.
Name the thing for precise keywords ("whoosh"); describe the scene for semantic alternatives. Minecraft sounds also
match the game's subtitles ("creeper hisses", "door creaks"). A sound
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
  bun run find --kind transition --source openfilm --group fade -n 20 --offset 20
  bun run find --show text/in/fade
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
const tallyEntries = (xs: Entry[], keyOf: (entry: Entry) => string) =>
  tally([...groupBy(xs, keyOf)].flatMap(([key, group]) => foldSoundEntries(group).map(() => key)));
const counts = (xs: Entry[]) => tallyEntries(xs, (x) => top(x.kind));

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
    dof: "lens",
    bokeh: "lens",
    handheld: "shake",
  }).map(([w, k]) => [stem(w), k]),
);

// The words a long list's entries are named by, most common first ("zombie 40, say 31 ..."): its sub-groups, to search inside
const namedBy = (xs: Entry[]) => {
  const same = new Set(xs.flatMap((x) => plain(`${x.kind} ${x.cat} ${catLabel(x)} minecraft`)));
  const seen = xs.flatMap((x) => [
    ...new Set(
      plain(x.title).filter(
        (w) =>
          w.length > 2 &&
          !/\d|^(wav|ogg|aiff?|flac)$/.test(w) &&
          !same.has(w) &&
          !STOP.has(stem(w)),
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
const MAKE_MUSIC =
  "music: the real-sound skill (licensed tracks from composer libraries, cut at bar lines), saved in the film's own sound folder under bgm/ (sound/sfx/bgm/<group>/<name>.wav: a bed names it), its licence a row of sound/sfx/SOURCES.json; more: bun run skills get core --ref sound";
const MAKE_MOCAP =
  "a move: key Steve's body by hand (steve.json moves[] pose instead of clip), or retarget a new clip into vault/motion";
const HOOKS = "src/scene.ts (hooks: bun run skills get core --ref contract)";
const MAKE_LOOK =
  'a named look preset: bun run find --kind look (docu-clean, teal-amber, noir-slate, warm-film, horror-cold, neon-pop, bleach-grit), mix adjust sliders (bun run find --kind adjust), or load a .cube LUT, adjust.json items[].grade.lut {"url","name","amount"}';
const make = (kinds: string[] | undefined, entries: Entry[]) => {
  if (!kinds)
    return [`an effect, overlay or look: the film's own, in ${HOOKS}`, MAKE_SOUND, MAKE_MOCAP];
  const one = (k: string) => {
    if (k === "bgm") return MAKE_MUSIC;
    if (SOUND.includes(k) || k === "sound") return MAKE_SOUND;
    if (k === "mocap") return MAKE_MOCAP;
    if (k === "adjust" || k === "look") return MAKE_LOOK;
    if (k === "lens") return USE.lens!;
    if (k === "shake") return USE.shake!;
    const own = ownOf(k);
    if (own) return own;
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
// show: name --show too, where no other line of the answer does; used: the options already given, never offered again
const mocapNext = (pool: Entry[], show = true, used: string[] = []) => {
  const ps = postures(pool.filter((x) => x.kind === "mocap")).join(" ");
  const left = (flags: string[], after = "") => {
    const fs = flags.filter((f) => !used.includes(f));
    return fs.length ? [`${fs.join("|")}${after}`] : [];
  };
  const offer = [
    ...left(["--from", "--to", "--has"], ` <posture>${ps ? ` (${ps})` : ""}`),
    ...left(["--still", "--moves"]),
    ...left(["--loop"]),
    ...left(["--dur"], " 1-6"),
    ...left(["--energy"], " 10-40"),
    ...left(["--head", "--up", "--ground"]).map((f) => `a hand ${f}`),
    ...left(["--bend"]),
    ...left(["--air"], " yes|no"),
    ...left(["--look"], " 45"),
    ...left(["--mood"], " <m>"),
    ...left(["--prop"], " <p>"),
    ...left(["--style"], " <s> (clips checked by eye; --mood, --prop or --style alone lists them)"),
    ...left(["--fights"], " (weapons, left out by default)"),
  ];
  return `mocap: ${show ? "one clip in full (its timeline, where it leaves him): bun run find --show <id>. By body" : "clips by body"}, any mix: ${offer.join(", ")}`;
};
// earshot rank over the files a list shows: the first few, as each call takes ~40 s whatever their number
const HEAR_MAX = 8;
const psLiteral = (s: string) => `'${s.replace(/['\u2018\u2019]/g, "$&$&")}'`;
const qArg = (s: string) => {
  if (/^[\w./,:+=-]+$/.test(s)) return s;
  if (process.platform !== "win32") return `'${s.replaceAll("'", "'\\''")}'`;
  if (!s.includes('"') && !s.endsWith("\\")) return psLiteral(s);
  // PowerShell 5 consumes native quotes; 7.3+ preserves them outside Legacy mode.
  const legacy = `"${s.replace(/(\\*)"/g, '$1$1""').replace(/\\+$/g, "$&$&")}"`;
  return `$(if ($PSVersionTable.PSVersion -ge [version]'7.3' -and $PSNativeCommandArgumentPassing -ne 'Legacy') { ${psLiteral(s)} } else { ${psLiteral(legacy)} })`;
};
const renderStills = (env: Record<string, string>) =>
  process.platform === "win32"
    ? // cmd.exe keeps legacy parsing in PowerShell's default Windows mode.
      `cmd /d /c ${psLiteral([...Object.entries(env).map(([key, value]) => `set "${key}=${value}"`), "bun run render stills"].join("&"))}`
    : `${Object.entries(env)
        .map(([key, value]) => `${key}=${qArg(value)}`)
        .join(" ")} bun run render stills`;
const hearThem = (what: string, files: string[]) =>
  `hear them (you cannot): earshot rank ${qArg(what)} ${files.slice(0, HEAR_MAX).map(qArg).join(" ")} --top 3${files.length > HEAR_MAX ? `  (the first ${HEAR_MAX} of ${files.length})` : ""}`;

// ---------- --show: one entry in full, from the catalogue record behind its line

const timelineDir = () =>
  existsSync(join(process.cwd(), "src/timeline")) ? "src/timeline" : "films/<film>/src/timeline";
const timelineFile = (file: string) => {
  const conf = filmConfig(process.cwd());
  const keys: Record<string, string> = {
    "audio.json": "soundTimeline",
    "shots.json": "shotsTimeline",
    "text.json": "textTimeline",
    "adjust.json": "adjustmentTimeline",
    "cam.json": "camTimeline",
    "timing.json": "timingTimeline",
  };
  const configured = keys[file]
    ? conf[keys[file]]
    : Object.entries(conf.keyFiles ?? {}).find(
        ([, role]) => role === file.replace(/\.json$/, ""),
      )?.[0];
  return typeof configured === "string"
    ? configured.replaceAll("\\", "/")
    : `${timelineDir()}/${file}`;
};
const usageFiles = (text: string) =>
  text.replace(/\b(?:audio|shots|text|adjust|cam|timing|steve|props)\.json\b/g, timelineFile);
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
  font: 'a font: {id, title, css} in fonts of makeTitles\' 4th argument in src/scene.ts, its face loaded there (@font-face or FontFace), then text.json items[].font "<id>"; for every film: FONTS in packages/film-stage/src/titles-catalog.ts plus its @fontsource import in titles.ts (OFL faces only)',
  adjust: MAKE_LOOK,
  velocity:
    'an effect: makeVelocity(renderer, {"<name>": (frame, optics) => a partial CameraOptics}) in src/scene.ts. Built-ins: packages/film-stage/src/velocity.ts',
  ease: "a curve: a function of t (0-1 to 0-1) added to EASES from film-stage/camera in src/scene.ts (cameraAt reads EASES by name; draw.eases is what the studio draws). Built-ins: packages/film-stage/src/camera.ts",
  "transition-ease":
    'a curve: a CSS cubic-bezier [x1, y1, x2, y2] in place of the name (x1, x2 in 0-1), e.g. "ease": [0.2, 0, 0, 1]',
  "anim-curve":
    'a curve: a CSS cubic-bezier [x1, y1, x2, y2] in place of the name (x1, x2 in 0-1), e.g. "curve": [0.2, 0, 0, 1]',
  sound: MAKE_SOUND,
  bgm: MAKE_MUSIC,
  mocap: MAKE_MOCAP,
  block:
    "a block/prop model: add blockstate+model JSON to packages/mc-assets/pack/assets/gohans/ and register in packages/mc-assets/src/pack.ts, or custom TypeScript/GLB in src/props/",
  item: "a custom item: add blockstate/model JSON or custom Mesh/GLB helper in src/props/ attached to player.handR",
  mob: "Minecraft entity models are mirrored by mc:mobs; custom animated rigs go in src/props/",
  prop: "put reusable TypeScript/GLB props in vault/props/ (Global) or film-only props in src/props/",
};
const ownOf = (kind: string) =>
  OWN[
    kind !== "bgm" && SOUND.includes(kind)
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
    ...(own
      ? [`make your own: ${usageFiles(own)} (every hook: bun run skills get core --ref contract)`]
      : []),
  ];
}
function details(x: Entry): string[] {
  const d = x.data ?? {},
    side = x.kind.split("-")[1] ?? "in";
  const info = assetInfo(x);
  const out: string[] = info
    ? [
        `asset recipe: ${JSON.stringify(typeof info.about === "string" ? { ...info, about: displayAbout(info.about) } : info, null, 2)}`,
      ]
    : [];
  if (x.kind === "asset" && info)
    return [
      `format: ${d.format}; category: ${x.cat}; group: ${d.group ?? "other"}`,
      `source: ${d.file}`,
      `licence: ${d.license}  ${d.url}`,
      ...out,
      `use: bun run asset use ${assetId(x)} --film films/<name>`,
    ];
  const use = (file: string, json: string) => out.push(`use: ${timelineFile(file)} ${json}`);
  const licenceUrl = typeof d.licenseUrl === "string" ? d.licenseUrl : d.url;
  if (d.license) out.push(`licence: ${d.license}${licenceUrl ? `  ${licenceUrl}` : ""}`);
  if (d.licenseUrl && d.url && d.url !== d.licenseUrl) out.push(`source: ${d.url}`);
  if (SOUND.includes(x.kind)) {
    const takes = d.takes ?? [];
    if (takes.length > 1)
      out.push(`takes: ${takes.join(", ")} (vary a repeated sound across them)`);
    if (d.origin === "unknown")
      out.push(
        "provenance: unknown; Real / Studio is a grouping, not verified recording provenance",
      );
    if (d.peaks?.length) out.push(`loudness: ${envelope(d.peaks, d.step)}`);
    const bed = `beds[]: {"name": "${x.id}", "from": 0, "to": ${num(x.secs) ?? 10}, "gain": 0, "fadeIn": 1, "fadeOut": 1}  (gain in dB; + "start", "duck", "pan"; a bed shorter than its span loops)`;
    const hit = `sfx[]: {"at": <scene seconds, not heard: bun run at <heard s> gives the scene second>, "name": "${x.id}", "gain": 0}  (gain in dB; + "rate", "pitch", "reverse", "fadeIn", "fadeOut")`;
    // a long ambience is a bed under the scene as music is; a short one is a hit at a second
    use("audio.json", x.kind === "bgm" ? bed : hit);
    if (x.kind !== "bgm" && (x.secs ?? 0) >= 10)
      out.push(`      or under a whole scene, looping: ${bed}`);
    if (d.file) {
      const file = qArg(soundFile(d.file));
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
      if (k === "body" && d.fix?.seq && d.seq)
        out.push(`body (checked by eye): ${d.seq.join(" > ")}`);
      else if (tl[k]?.length)
        out.push(`${label}: ${tl[k].map(([a, b, what]) => `${a}-${b} ${what}`).join(" · ")}`);
    use(
      "steve.json",
      `moves[]: {"t": <scene seconds, not heard: bun run at <heard s> gives them>, "at": [x, 0, z], "yaw": 0, "clip": "${x.id}"}  (+ "from" seconds into the clip, "rate" its speed (0 holds the frame at from), "loop": true, "blend" seconds of crossfade into the next key, default 0.4). The next key's at = at + the end offset above turned by yaw`,
    );
    out.push(
      `see it: ${renderStills({ LAB_CLIP: x.id, ENTRY: "lab/clip.ts" })}  (in a film folder)`,
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
      `see it: ${renderStills({ AT: "<cut time>" })}  (in a film folder), or the Studio's Shot inspector`,
    );
  } else if (x.kind.startsWith("anim-") && x.kind !== "anim-curve") {
    out.push(
      `settings: ${side === "combo" ? "" : `"len" seconds (default ${num(d.len) ?? 1}); `}"k" strength (1 as designed); "curve" one of ${ANIM_CURVES.map((c) => c.id).join(", ")}`,
    );
    use(
      "shots.json",
      side === "combo"
        ? `shot: "anim": {"combo": {"fx": "${x.id}"}}`
        : `shot: "anim": {"${side}": {"fx": "${x.id}", "len": ${num(d.len) ?? 1}}}`,
    );
    out.push(`see it: ${renderStills({ AT: "<shot time>" })}  (in a film folder)`);
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
    out.push(`see it: ${renderStills({ AT: "<time>" })}  (in a film folder)`);
  } else if (x.kind === "font") {
    out.push(`face: ${d.css}`);
    use("text.json", `items[]: {..., "font": "${x.id}"}`);
  } else if (x.kind === "adjust") {
    out.push(`range: ${d.min}..${d.max}, 0 = untouched`);
    use(
      "adjust.json",
      `items[]: {"id": "<new, unique>", "name": "${x.id}", "from": 0, "to": 4, "track": 0, "grade": {"basic": {"${x.id}": 30}}}  (or a shot's "adjust": {"basic": {...}} in shots.json)`,
    );
  } else if (x.kind === "look") {
    const grade = (d.grade ?? {}) as Record<string, unknown>;
    const basic = (grade.basic ?? {}) as Record<string, number>;
    const summary = [
      ...Object.entries(basic).map(([k, v]) => `${k} ${v}`),
      ...Object.entries(grade)
        .filter(([k]) => k !== "basic")
        .map(([k]) => k),
    ];
    if (summary.length) out.push(`preset keys: ${summary.join(", ")}`);
    use("shots.json", `shot.adjust: {"look": "${x.id}"}`);
    out.push(
      `or ${timelineFile("adjust.json")} items[].grade: {"look": "${x.id}"} (explicit sliders override via resolveGrade)`,
    );
  } else if (x.kind === "lens") {
    if (typeof d.mm === "number") {
      const fstop = typeof d.fstop === "number" ? d.fstop : 2.8;
      use(
        "cam.json",
        `[{"t": 0, "p": [0, 1.6, 4], "l": [0, 1.3, 0], "mm": ${d.mm}, "fstop": ${fstop}, "focus": "Steve.head"}]`,
      );
      out.push(
        `code: import { fovOf, shotSize } from 'film-kit/lens'; shotSize('MCU', { height: 1.8, mm: ${d.mm} })`,
      );
    } else {
      out.push(
        `use: src/scene.ts  import { ${(d.imports ?? [x.id]).join(", ")} } from '${d.pkg}'; ${d.code}`,
      );
    }
  } else if (x.kind === "shake") {
    if (x.cat === "Shakify") {
      use(
        "cam.json",
        `keys[]: {..., "handheld": {"preset": "${x.id}", "amount": 0.6, "speed": 1, "move": 0.5}}`,
      );
      out.push('turn off on later cut: "handheld": "off" or false');
    } else if (x.id === "hits") {
      use(
        "shots.json",
        'shot: {"hits": [{"t": 1.2, "amount": 0.85, "decay": 2.5, "freq": 18, "max": 6}]}',
      );
      out.push("note: hits add decaying rotational trauma without triggering motion POPS");
    } else {
      out.push(
        "use: src/scene.ts  import { shake } from 'film-kit/shake'; const shk = shake([{ t: 1.2, amount: 0.6 }]); const [yaw, pitch, roll] = shk(t); // degrees, rotation only",
      );
    }
  } else if (x.kind === "velocity") {
    use(
      "timing.json",
      `velocity[]: {"effect": "${x.id}", "from": 0, "to": 4, "music": "<a beds[] name in audio.json>", "beats": [<its beat times in film seconds>], "frequency": 2, "speed": "normal", "intensity": 60}  (frequency 1|2 = every 4th beat or every beat; speed normal|fast|veryFast; intensity 0-100)`,
    );
    out.push(
      `beats: echo '{"duration": <seconds>}' | python ${relative(process.cwd(), join(ROOT, "scripts/sound/beats.py")).replaceAll("\\", "/")} <the bed's sound file> prints {"bpm", "beats"} in the track's own seconds; film second = the bed's "from" + beat - its "start" (at rate 1). The Studio's Auto mark beats, on a sound row, marks them too`,
    );
  } else if (x.kind === "ease") {
    const f = (EASES as Record<string, (t: number) => number>)[x.id];
    if (f)
      out.push(
        `curve: at 25%, 50%, 75% of the time it has gone ${[0.25, 0.5, 0.75].map((t) => f(t).toFixed(2)).join(", ")}`,
      );
    use("cam.json", `a key: "ease": "${x.id}"  (the move into that key; also a key of props.json)`);
  } else if (x.kind === "block" || x.kind === "item" || x.kind === "mob" || x.kind === "prop") {
    const packName = typeof d.pack === "string" ? d.pack : "";
    const packTitle = typeof d.packTitle === "string" ? d.packTitle : "";
    const ns = typeof d.namespace === "string" ? d.namespace : "";
    const name = typeof d.name === "string" ? d.name : "";
    const srcName = typeof d.source === "string" ? d.source : "";
    const scopeName = typeof d.scope === "string" ? d.scope : "";
    const sourceFile = typeof d.sourceFile === "string" ? d.sourceFile : "";
    const rawId = typeof d.rawId === "string" ? d.rawId : x.id;
    const itemType = typeof d.type === "string" ? d.type : "";
    const brokenReason =
      typeof d.brokenReason === "string" ? d.brokenReason : "unknown loader or missing files";
    if (x.kind === "prop") {
      const files = [
        sourceFile && `source: ${sourceFile}`,
        (scopeName || srcName) && `scope: ${scopeName || srcName}`,
        d.model && `model: ${(d.model as { path?: string }).path}`,
        d.image && `image: ${(d.image as { path?: string }).path}`,
      ].filter(Boolean);
      if (files.length) out.push(files.join("; "));
      if (scopeName === "global") {
        out.push(
          `use: bun run asset use ${x.id} --film films/<name>  (copies into src/props/; keeps relative imports safe)`,
        );
      } else if (sourceFile) {
        out.push(`use: import from "./props/${rawId}"  (already in this film's src/props/)`);
      } else if (d.model) {
        out.push(
          `use: load "./src/props/${(d.model as { path?: string }).path}" via GLTFLoader  (already in this film's src/props/)`,
        );
      } else if (d.image) {
        out.push(
          `use: use image/texture "./src/props/${(d.image as { path?: string }).path}"  (already in this film's src/props/)`,
        );
      }
      return out;
    }
    if (x.kind === "mob") {
      out.push(`source: vault/mcasset/1.21.11  (licence: minecraft)`);
      const clips = Array.isArray(d.clips)
        ? (d.clips as { name: string; length?: number; loop?: boolean }[])
        : [];
      if (clips.length) {
        out.push(
          `clips (${clips.length}): ${clips.map((c) => `${c.name}${c.length ? ` (${c.length}s${c.loop ? " loop" : ""})` : ""}`).join(", ")}`,
        );
      } else {
        out.push('clips: still entity (no animations indexed; use clip: "none")');
      }
      out.push(`use: bun run asset use ${x.id} --film films/<name> --from 0`);
      return out;
    }
    // block or item
    if (packName) {
      out.push(
        `pack: ${packTitle ? `${packTitle} (${packName})` : packName}${itemType ? ` [${itemType}]` : ""}`,
      );
    } else if (x.src) {
      out.push(`source: ${x.src}`);
    }
    if (typeof d.license === "string" && /\bGPL\b/i.test(d.license) && !/LGPL/i.test(d.license)) {
      out.push(`warning: ${d.license} is copyleft; avoid unless licence terms fit your project`);
    }
    if (d.renderable === false) {
      out.push(`status: non-renderable (${brokenReason})`);
    } else {
      const vaultRoot = process.env.MC_VAULT_ROOT?.trim()
        ? vaultPath(process.env.MC_VAULT_ROOT.trim())
        : LOCAL;
      const bounds = resolveMcAssetBounds(
        {
          kind: x.kind as "block" | "item",
          namespace: ns,
          name,
          ...(packName ? { pack: packName } : {}),
        },
        { vaultRoot },
      );
      if (bounds) {
        const fmt = (n: number) => Number(n.toFixed(3)).toString();
        const scaleNote = x.kind === "item" ? " [unscaled; itemModel defaults to size=0.42]" : "";
        out.push(
          `bounds: ${fmt(bounds.size[0])} x ${fmt(bounds.size[1])} x ${fmt(bounds.size[2])} blocks (x: ${fmt(bounds.min[0])}..${fmt(bounds.max[0])}, y: ${fmt(bounds.min[1])}..${fmt(bounds.max[1])}, z: ${fmt(bounds.min[2])}..${fmt(bounds.max[2])})${scaleNote}`,
        );
      }
    }
    if (d.props && typeof d.props === "object") {
      const propText = Object.entries(d.props as Record<string, string[]>)
        .map(([k, vs]) => `${k}: ${vs.join("|")}`)
        .join("; ");
      if (propText) out.push(`properties: ${propText}`);
    }
    if (Array.isArray(d.variants) && d.variants.length > 1) {
      const vs = (d.variants as { name: string }[]).map((v) => v.name);
      out.push(`variants (${vs.length}): ${vs.join(", ")}`);
    }
    const srcFlag = packName ? ` --source ${qArg(packName)}` : "";
    if (x.kind === "item") {
      out.push(
        `note: items pick into assets/public/picked.zip and attach in src/scene.ts via await itemModel(assets, "${ns}:${name}") from mc-assets/model (or low-level loadModel(group, assets, await resolveModelData(assets, {model: "${ns}:item/${name}", type: "item"}), {display: {}}) with assets = await prepareAssets(sources)); items do not go in placed.json.`,
      );
      if (!packName) {
        out.push(
          `use: vanilla client_assets.zip already ships ${ns}:item/${name}; load with await itemModel(assets, "${ns}:${name}") from mc-assets/model`,
        );
      } else {
        out.push(`pick: bun run asset pick ${x.id} --film films/<name>${srcFlag}`);
      }
    } else {
      if (packName) {
        out.push(`pick: bun run asset pick ${x.id} --film films/<name>${srcFlag}`);
      }
      out.push(`use: bun run asset use ${x.id} --film films/<name> --from 0${srcFlag}`);
    }
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
  } else {
    const lane = x.kind === "asset" ? "" : useOf(x.kind);
    if (lane) out.push(`use: ${lane}`);
    else {
      const file = assetFile(x);
      out.push(`file: ${file || "not recorded in the catalog"}`);
      if (typeof d.format === "string") out.push(`format: ${d.format}`);
      if (!d.license) out.push("licence: not recorded; inspect the source before reuse");
      if (file && d.format === "openfilm-page") {
        const settings = join(dirname(file), "..", "saved.json");
        if (existsSync(settings))
          out.push(
            `settings: ${settings} (clip.attrs data-props names controls; source defines defaults)`,
          );
      }
      out.push(`use: no native timeline lane for ${x.kind}; inspect/adapt the source in ${HOOKS}`);
      const preview = typeof d.preview === "string" ? d.preview : "";
      out.push(`see it: ${preview || file || "no source or preview recorded"}`);
    }
  }
  if (!SOUND.includes(x.kind) && !out.some((l) => l.startsWith("see it:")))
    out.push(
      `see it: ${renderStills({ AT: "<a second it is on screen>" })}  (in a film folder), or the Studio at that second`,
    );
  return out;
}

// --star / --unstar: the creator's favourites, written where the studio's star keeps them (favorites/<list>.json)
function star(
  ids: string,
  on: boolean,
  kinds: string[] | undefined,
  pool: Entry[],
  listName: string,
  favorites: ReturnType<FavoriteLists["open"]>,
) {
  const kf = kinds ? kindFilter(kinds, pool) : undefined;
  if (kf?.bad.length) throw new FindError(kf.bad.join("\n"));
  // every id is checked before any is written: a wrong one in a list leaves the list as it was
  const found = commaList(ids).map((id) => {
    const hits = pool.filter((x) => x.id.toLowerCase() === id.toLowerCase() && (!kf || kf.test(x)));
    if (!hits.length)
      throw new FindError(
        `no entry${kinds ? ` of --kind ${kinds.join(",")}` : ""} has the id "${id}": ids are the second column of bun run find <words> (bun run find ${id} searches by words)`,
      );
    const kindsOf = [...new Set(hits.map((x) => x.kind))];
    if (kindsOf.length > 1)
      throw new FindError(
        `${id} is ${kindsOf.map((k) => `a${/^[aeiou]/.test(k) ? "n" : ""} ${k}`).join(" and ")}: add --kind ${kindsOf[0]} (or another of them) to say which`,
      );
    return hits[0]!;
  });
  const done = found.map((x) => {
    const family = x.data?.family;
    // unstarring a sound takes the star off every take of its family, whichever take the studio starred
    const targets =
      !on && family ? pool.filter((y) => y.data?.family === family).map(starOf) : [starOf(x)];
    const was = favorites.read();
    const had = targets.some((t) => was[t.kind].includes(t.id));
    for (const t of targets) favorites.set({ ...t, on });
    return `${x.kind} ${x.id}${on === had ? ` (already ${on ? "starred" : "not starred"})` : ""}`;
  });
  const fav = listName === "default" ? "--fav" : `--fav ${listName}`;
  return [
    `${on ? "starred" : "unstarred"} in the ${listName} favourites: ${done.join(", ")} (${relative(ROOT, favorites.file).replaceAll("\\", "/")}, for every film${listName === "default" ? "; an open studio shows it after a reload" : ""})`,
    `next: every starred entry: bun run find ${fav}; search only those: bun run find <words> ${fav}`,
  ].join("\n");
}

function show(ids: string[], pool: Entry[]) {
  const sourceOnly = ids.every((id) =>
    pool.some((x) => x.kind === "asset" && matchesAssetId(x, id)),
  );
  // kinds that share a way to make your own (anim-in and anim-out, the four title voices) say it once
  const ownBy = new Map<string, string>();
  const once = (x: Entry, l: string) => {
    if (!l.startsWith("make your own:")) return l;
    const first = ownBy.get(l);
    if (first) return `make your own: as for ${first} above`;
    ownBy.set(l, x.kind);
    return l;
  };
  return ids
    .map((id) => {
      let low = id.toLowerCase();
      // A mocap clip named without its library (Walking_1 for mixamo/Walking_1), or an object named without its kind (barrel or decor:oak_chair)
      const name = low.split("/").at(-1)!;
      const bare = pool.filter(
        (x) =>
          x.id.toLowerCase().endsWith(`/${name}`) ||
          (isObjectKind(x.kind) && x.id.toLowerCase().endsWith(`:${low}`)),
      );
      let readAs = "";
      if (!pool.some((x) => matchesAssetId(x, low)) && bare.length === 1) {
        low = bare[0]!.id.toLowerCase();
        if (id.includes("/") || id.includes(":"))
          readAs = `(${id} read as ${bare[0]!.id}: no entry has that id under ${id.split(/[/:]/)[0]})\n`;
      }
      // Each take is its own entry here (its own file and loudness); its family's takes come from the family name
      const hits = pool.flatMap((x) => {
        if (!matchesAssetId(x, low)) return [];
        const family = x.data?.family;
        const takes = family ? pool.filter((y) => y.data?.family === family).map((y) => y.id) : [];
        return [takes.length > 1 ? { ...x, data: { ...x.data, takes: takes.toSorted() } } : x];
      });
      if (!hits.length) {
        if (pool.some((x) => kindMatches(x.kind, low)))
          return `${id} is a kind: bun run find --kind ${low} lists it, bun run find <words> --kind ${low} searches it`;
        if (bare.length > 1) {
          throw new FindError(
            `"${id}" matches ${bare.length} entries: ${bare
              .slice(0, 6)
              .map((x) => x.id)
              .join(
                ", ",
              )}${bare.length > 6 ? "…" : ""}. Pass the full id or add --kind ${bare[0]!.kind}`,
          );
        }
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
      const uniqueKinds = new Set(hits.map((x) => x.kind));
      const firstPack = hits[0]!.data?.pack;
      const firstSource = typeof firstPack === "string" ? firstPack : (hits[0]!.src ?? "");
      const shared =
        hits.length > 1
          ? uniqueKinds.size > 1
            ? [
                `${hits.length} kinds share the id ${hits[0]!.id}: each goes where its use line says (one of them: --show ${hits[0]!.id} --kind ${hits[0]!.kind})`,
              ]
            : [
                `${hits.length} sources share the id ${hits[0]!.id}: add --source <name> to pick one (e.g. --show ${hits[0]!.id} --source ${qArg(firstSource)})`,
              ]
          : [];
      return (
        readAs +
        [
          ...shared,
          ...hits.map((x) =>
            [
              line(x),
              ...(displayAbout(x.about) && !line(x).includes(displayAbout(x.about))
                ? [`about: ${displayAbout(x.about)}`]
                : []),
              ...detail(x).map((l) => once(x, l)),
            ].join("\n"),
          ),
        ].join("\n\n")
      );
    })
    .concat(
      sourceOnly
        ? []
        : ["after pasting it in: bun run check (in the film) says whether the file still fits"],
    )
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

// A usage mistake (a wrong word, value or id): the CLI prints it and exits 2, nothing done, instead of answering a
// different question than the one asked
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
  "--jev": null,
  "--semantic": null,
  "--json": null,
  "--offline": null,
  "--yes": null,
  "--variants": null,
  "--broken": null,
  "--db": "--db path.sqlite",
  "--dimensions": "--dimensions 768",
  "--provider": "--provider auto|gemini|openrouter",
  "--fav": null,
  "--star": "--star dissolve",
  "--unstar": "--unstar dissolve",
  "--kind": "--kind sfx",
  "--source": "--source minecraft",
  "--group": "--group fade",
  "--offset": "--offset 40",
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
  "--style": "--style natural",
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
const TAGGED = ["--mood", "--prop", "--style"] as const;
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
  "--favs": "--fav",
  "--faves": "--fav",
  "--favorite": "--fav",
  "--favorites": "--fav",
  "--favourite": "--fav",
  "--favourites": "--fav",
  "--starred": "--fav",
  "--stars": "--fav",
  "--liked": "--fav",
  "--unrenderable": "--broken",
};
const isOption = (a: string) => /^--?[a-z]/i.test(a);
function parse(argv: string[], lists: string[] = []) {
  const set = new Map<string, string>(),
    rest: string[] = [],
    notes: string[] = [],
    bare: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!isOption(arg)) {
      // an option quoted into the words is searched as a word ("door --kind sfx" looks for "kind")
      const quoted = arg.split(/\s+/).find((w) => {
        const name = w.toLowerCase().split("=")[0]!;
        return name in OPTIONS || name in OPTION_ALIAS;
      });
      if (quoted && /\s/.test(arg.trim()))
        throw new FindError(
          `${quoted} sits inside the quotes ("${arg}"), so it would be searched as a word: options go outside them (bun run find ${arg.trim()})`,
        );
      rest.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const typed = (eq > 0 ? arg.slice(0, eq) : arg).toLowerCase();
    const name = OPTION_ALIAS[typed] ?? typed;
    if (name !== typed) notes.push(`${typed} read as ${name}`);
    // every take on its own line only filled the context: one family's takes are in its --show
    if (typed === "--all" || typed === "--takes")
      throw new FindError(
        `${typed} is gone: a list shows one line per sound family, "(N takes)"; bun run find --show <id> names every take`,
      );
    if (!(name in OPTIONS))
      throw new FindError(
        `Unknown option ${typed}. Options: ${Object.keys(OPTIONS)
          .filter((key) => !(key in BODY))
          .join(
            " ",
          )}; mocap by body: ${Object.keys(BODY).join(" ")}. Any filter without a value lists its values.`,
      );
    if (name === "--fav") {
      // a favourites list's name may follow (--fav horror); any other word after it is a search word, except when
      // starring, where it names the list to make
      const next = argv[i + 1]?.toLowerCase();
      const starring = argv.some((a) => /^--(?:un)?star(?:=|$)/i.test(a));
      const named = eq < 0 && !!next && (lists.includes(next) || (starring && !isOption(next)));
      const v = eq > 0 ? arg.slice(eq + 1) : named ? (i++, next!) : "default";
      // a word that may be a list's name mistyped: said, since it is read as a search word
      if (eq < 0 && !named && next && !isOption(next) && lists.length)
        notes.push(
          `"${next}" after --fav names no favourites list (${lists.join(", ")}): read as a search word, the default list used`,
        );
      if (set.has(name) && set.get(name) !== v.toLowerCase())
        throw new FindError(
          `--fav given twice (${set.get(name)}, ${v.toLowerCase()}); a search reads one favourites list`,
        );
      set.set(name, v.toLowerCase());
      continue;
    }
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
  const by = new Map<string, Entry[]>();
  // counted as a search finds them: weapon and fight clips are left out of mocap unless --fights
  for (const x of pool) {
    if (!x.src || (x.kind === "mocap" && isFight(x.id))) continue;
    const k =
      x.src.startsWith("film-stage/") || x.src.startsWith("film-kit/") ? "presets" : top(x.kind);
    by.set(k, by.get(k) ?? [])
      .get(k)!
      .push(x);
  }
  const order = ["sfx", "bgm", "mc", "mocap"];
  const at = (k: string) => (k === "presets" ? 99 : order.indexOf(k) + 1 || 50);
  return [...by]
    .toSorted(([a], [b]) => at(a) - at(b))
    .map(([k, srcs]) =>
      k === "presets"
        ? `presets: film-stage or film-kit (every preset), or one file: ${[...new Set(srcs.map((x) => x.src))].join(", ")}`
        : `${k}: ${tallyEntries(srcs, (x) => x.src!)}`,
    )
    .join("\n  ");
};
// The Sound panel's filters and the licence buckets: which entries each sorts, and what it calls each one
const hasLicense = (x: Entry) =>
  SOUND.includes(x.kind) || ["block", "item", "mob"].includes(x.kind);
const FACETS: Record<
  string,
  { keep: (x: Entry) => boolean; of: (x: Entry) => string; t: Record<string, string> }
> = {
  "--origin": {
    keep: (x) => SOUND.includes(x.kind) && x.kind !== "mc",
    of: originOfEntry,
    t: ORIGINS,
  },
  "--edition": {
    keep: (x) => x.kind === "mc" || ["block", "item", "mob"].includes(x.kind),
    of: editionOfEntry,
    t: EDITIONS,
  },
  "--license": { keep: hasLicense, of: licenseOf, t: LICENSES },
};
// "free 120 (nothing to do ...), credit 9 (...)": all = every value with its meaning (what the filter takes), held = the
// values these entries have, with their meaning, terse = those values bare
const buckets = (o: string, xs: Entry[], style: "all" | "held" | "terse" = "all") => {
  const f = FACETS[o]!,
    ys = xs.filter(f.keep);
  return Object.entries(f.t)
    .map(
      ([k, label]) => [k, foldSoundEntries(ys.filter((y) => f.of(y) === k)).length, label] as const,
    )
    .filter(([, c]) => style === "all" || c > 0)
    .map(([k, c, label]) => `${k} ${c}${style === "terse" ? "" : ` (${label})`}`)
    .join(", ");
};
const rawLicenses = (xs: Entry[]) =>
  tallyEntries(
    xs.filter((x) => hasLicense(x) && x.data?.license),
    (x) => String(x.data!.license),
  );
const durOf = (secs: number) =>
  secs < 1
    ? "0-1"
    : secs < 5
      ? "1-5"
      : secs < 30
        ? "5-30"
        : `30-${Math.max(3600, Math.ceil(secs))}`;
const durs = (xs: Entry[]) => {
  const longest = xs.reduce((hi, x) => Math.max(hi, x.secs ?? 0), 3600);
  const ranges = [
    [0, 1],
    [1, 5],
    [5, 30],
    [30, Math.ceil(longest)],
  ] as const;
  return tally(
    ranges.flatMap((range) =>
      foldSoundEntries(xs.filter((x) => inRange(x.secs, range))).map(() => range.join("-")),
    ),
  );
};
const tagged = (field: string, clips: Entry[]) =>
  tally(clips.flatMap((x) => (Array.isArray(x.data?.[field]) ? (x.data[field] as string[]) : [])));
const DUR_SAYS =
  "min-max seconds, low first, for sounds and mocap clips: --dur 0-1 a short hit, 1-5, 5-30, 30-3600 a track or long ambience";
const ENERGY_SAYS =
  "min-max mean joint speed in deg/s, low first, e.g. --energy 10-40 (calm idle ~10, walk ~30, jump 200)";
const LOOK_SAYS = "the least head turn on the neck in degrees, e.g. --look 45";
const AIR_SAYS =
  "yes (off the floor a while: a jump, or on furniture) or no (feet down throughout)";
const objectSourcesSummary = () => {
  const vRoot = process.env.MC_VAULT_ROOT?.trim()
    ? vaultPath(process.env.MC_VAULT_ROOT.trim())
    : LOCAL;
  const packIndex = readJson(join(vRoot, "packs_index.json"));
  const slugs = new Set<string>();
  const warm = loadWarmMcCache(vRoot);
  if (warm) {
    for (const p of Object.values(warm.packs)) if (p.meta?.slug) slugs.add(p.meta.slug);
  }
  for (const [file, info] of Object.entries(packIndex)) {
    const slug =
      (typeof (info as any)?.slug === "string" && (info as any).slug) ||
      file.replace(/\.(jar|zip)$/i, "");
    if (slug) slugs.add(slug);
  }
  const packsDir = join(vRoot, "packs");
  if (existsSync(packsDir)) {
    try {
      for (const f of readdirSync(packsDir)) {
        if (!/\.(jar|zip)$/i.test(f)) continue;
        const info = packIndex[f] as { slug?: unknown } | undefined;
        const slug =
          (typeof info?.slug === "string" && info.slug) || f.replace(/\.(jar|zip)$/i, "");
        if (slug) slugs.add(slug);
      }
    } catch {}
  }
  const sortedPacks = [...slugs].toSorted();
  const shownPacks =
    sortedPacks.length > 20
      ? [
          ...sortedPacks.slice(0, 20),
          `+${sortedPacks.length - 20} more (bun run find --kind object --source)`,
        ]
      : sortedPacks;
  return ["minecraft", "gohans", "global", "this-film", ...shownPacks].join(", ");
};

// What a filter takes, from the entries here: asked by naming it without a value
const valuesOf = (o: string, pool: Entry[]) => {
  const clips = pool.filter((x) => x.kind === "mocap");
  if (o === "--kind") {
    // counted as a search finds them: weapon and fight clips are left out of mocap unless --fights
    const fights = clips.filter((x) => isFight(x.id)).length;
    const kinds = counts(pool.filter((x) => x.kind !== "mocap" || !isFight(x.id))).replace(
      /\bmocap \d+/,
      (m) =>
        fights
          ? `${m} (and ${fights} weapon or fight clip${fights > 1 ? "s" : ""}, left out unless --fights)`
          : m,
    );
    const objHint = pool.some((x) => isObjectKind(x.kind))
      ? ""
      : "; 3D objects (opt-in): block, item, mob, prop, or object for all four";
    return `Kinds: ${kinds}, or sound for sfx+bgm+mc. Each takes /<category> (bun run find --kind <kind> lists them); plain names work too: music is bgm, titles is text, camera is anim${objHint}`;
  }
  if (o === "--source") {
    const objHint = pool.some((x) => isObjectKind(x.kind))
      ? ""
      : `\n  3D objects (opt-in via --kind object): ${objectSourcesSummary()}`;
    return `Sources (a comma list for several):\n  ${sourceList(pool)}${objHint}`;
  }
  if (o === "--group") return `Groups: ${tallyEntries(pool, groupOf)}`;
  if (o in FACETS)
    return `${o}: ${buckets(o, pool)}${o === "--license" && rawLicenses(pool) ? `. Or a licence by name (--license mit): ${rawLicenses(pool)}` : ""}`;
  if (o === "--dur") return `--dur takes ${DUR_SAYS}. Here: ${durs(pool)}`;
  if (o === "--energy") return `--energy takes ${ENERGY_SAYS}`;
  if (o === "--look") return `--look takes ${LOOK_SAYS}`;
  if (o === "--air") return `--air is ${AIR_SAYS}`;
  if (o === "--from" || o === "--to" || o === "--has")
    return clips.length
      ? `postures: ${postures(clips).join(" ")}`
      : "no mocap clips are indexed (vault/motion/catalog is empty or missing)";
  if ((TAGGED as readonly string[]).includes(o))
    return clips.length
      ? `${o} (only clips checked by eye carry it): ${tagged(o.slice(2), clips)}`
      : "no mocap clips are indexed (vault/motion/catalog is empty or missing)";
  if (o === "--show" || o === "--star" || o === "--unstar")
    return "an id: the second column of bun run find <words>";
  return "";
};

export async function run(
  argv: string[],
  given?: Entry[],
  judge: Judge = jevJudge,
  clips: Catalog = catalog,
  favorites: FavoriteLists = favoriteLists(),
  lookup: OpenFilmLookup = openFilmSearch,
): Promise<string> {
  if (
    argv.some((a) => a.toLowerCase() === "--help" || a.toLowerCase() === "-h") ||
    argv[0]?.toLowerCase() === "help"
  )
    return HELP;
  const lists = favorites.lists();
  const { set, query, notes, bare } = parse(
    argv,
    lists.map((l) => l.name),
  );
  // how a loose option or value was read (--licence as --license, --origin recorded as real), above the answer
  const noted = (text: string) => (notes.length ? `(${notes.join("; ")})\n${text}` : text);
  const jev = set.has("--jev");
  const semantic = set.has("--semantic");
  const list = (v?: string) => (v === undefined ? undefined : commaList(v));
  // a category keeps its case, which marks its word breaks (mocap/sitSeat is sit-seat)
  const asked = list(set.get("--kind"))?.map((a) => a.replace(/^[^/]*/, (k) => k.toLowerCase())),
    sources = list(set.get("--source")?.toLowerCase());
  let kinds = asked;
  if (set.has("--help") || set.has("-h")) return HELP;
  if (set.has("--offline") && (jev || set.has("--yes")))
    throw new FindError("--offline cannot be combined with --jev or --yes");
  if (set.has("--json") && (jev || !query || Object.keys(BODY).some((key) => set.has(key))))
    throw new FindError(
      "--json needs search words; use --jev or mocap body filters in a separate call",
    );
  if (semantic && (jev || !query || Object.keys(BODY).some((key) => set.has(key))))
    throw new FindError(
      "--semantic needs scene words and keeps catalog filters; use --jev or mocap body filters in a separate call",
    );
  if (!semantic && ["--yes", "--db", "--dimensions", "--provider"].some((key) => set.has(key)))
    throw new FindError("--yes, --db, --dimensions and --provider apply only to --semantic");
  if (semantic && !["auto", "gemini", "openrouter"].includes(set.get("--provider") ?? "auto"))
    throw new FindError("--provider is auto, gemini or openrouter");
  const dimensions = Number(set.get("--dimensions") ?? 768);
  if (semantic && ![768, 1536, 3072].includes(dimensions))
    throw new FindError("--dimensions is 768, 1536 or 3072");
  const nRaw = set.get("-n");
  if (nRaw !== undefined && !/^[1-9]\d*$/.test(nRaw))
    throw new FindError("-n takes a whole number of hits, 1 or more, e.g. -n 20");
  const n = Number(nRaw ?? 12);
  const offsetRaw = set.get("--offset") ?? "0";
  if (!/^\d+$/.test(offsetRaw) || !Number.isSafeInteger(Number(offsetRaw)))
    throw new FindError("--offset takes a whole number from 0");
  const offset = Number(offsetRaw);
  if (offset && (jev || Object.keys(BODY).some((key) => set.has(key))))
    throw new FindError(
      "--offset pages offline word searches and lists; drop it for Jev or mocap body filters",
    );
  if (n > LIST_ALL)
    throw new FindError(
      `-n ${n} would put ${n} lines in your context; ${LIST_ALL} at most. Narrow instead: --kind <kind>/<category>, words, or by meaning: --jev --kind <kind> "<the moment>"`,
    );
  const starring = set.has("--star") ? "--star" : set.has("--unstar") ? "--unstar" : undefined;
  // The favourites list in use: default unless --fav names another; a name no list has falls back to default, said so
  // (--star into a new name makes that list)
  let listName = set.get("--fav") ?? "default";
  if (starring && !LIST_NAME.test(listName))
    throw new FindError(
      `"${listName}" cannot name a favourites list: a-z, 0-9 and - only (e.g. --fav ${plain(listName).join("-") || "horror"})`,
    );
  if (!lists.some((l) => l.name === listName) && !starring) {
    notes.push(`no favourites list "${listName}", the default list used`);
    listName = "default";
  }
  const stars = favorites.open(listName);
  const resolvedVault = process.env.MC_VAULT_ROOT?.trim()
    ? vaultPath(process.env.MC_VAULT_ROOT.trim())
    : LOCAL;
  let objEntriesCache: Entry[] | undefined;
  const loadObjects = async () =>
    (objEntriesCache ??= await objectEntries({
      vaultRoot: resolvedVault,
      quiet: set.has("--json"),
    }));
  const resolveKindBase = (k: string) => {
    const b = k.split("/")[0]!;
    return KIND_ALIAS[stem(b)] ?? b;
  };
  const wantsObjects =
    Boolean(
      asked?.some((k) => {
        const r = resolveKindBase(k);
        return r === "object" || isObjectKind(r);
      }),
    ) ||
    set.has("--variants") ||
    set.has("--broken");
  const wantsNonObjects = Boolean(
    asked?.some((k) => {
      const r = resolveKindBase(k);
      return r !== "object" && !isObjectKind(r);
    }),
  );
  if ((set.has("--variants") || set.has("--broken")) && asked && !wantsObjects)
    throw new FindError(
      "--variants and --broken apply only to 3D object kinds (block, item, mob, prop, object)",
    );
  const entriesOf = (fold = false) => markStarred(given ?? allEntries(fold), stars.shown());
  const poolOf = async (fold = false) => {
    if (given) return markStarred(given, stars.shown());
    if (wantsObjects && !wantsNonObjects) return markStarred(await loadObjects(), stars.shown());
    if (wantsObjects && wantsNonObjects)
      return markStarred([...allEntries(fold), ...(await loadObjects())], stars.shown());
    if (
      set.has("--fav") &&
      !asked &&
      stars.shown().effects.some((id) => /^(?:block|item|mob|prop):/i.test(id))
    )
      return markStarred([...allEntries(fold), ...(await loadObjects())], stars.shown());
    return markStarred(allEntries(fold), stars.shown());
  };
  const fav = set.has("--fav"),
    favArg = listName === "default" ? "--fav" : `--fav ${listName}`;
  // the creator's other lists, offered beside the one in use, never forced
  const otherLists = lists.filter((l) => l.name !== listName && l.count);
  const listsLine = otherLists.length
    ? `other favourites lists: ${otherLists.map((l) => `${l.name} ${l.count}`).join(", ")} (this one: ${listName}; another: bun run find --fav ${otherLists[0]!.name}${query ? ` ${qArg(query)}` : ""})`
    : "";
  // without --fav: the creator's favourites are said to exist, once, so a search for anything else learns of them
  const starredLists = lists.filter((l) => l.count);
  const favsLine =
    !fav && starredLists.length
      ? `the creator's favourites: ${starredLists.map((l) => `${l.name} ${l.count}`).join(", ")} (only those: add --fav, or --fav <list>)`
      : "";
  const asRead = (read: string[] | undefined, text: string) =>
    noted(read?.length ? `(${read.join("; ")})\n${text}` : text);
  if (bare.length) {
    const all = await poolOf(),
      kf = asked && !bare.includes("--kind") ? kindFilter(asked, all) : undefined,
      byKind = kf && !kf.bad.length ? all.filter(kf.test) : all,
      pool = sources ? byKind.filter((x) => sources.some((s) => fromSource(x, s))) : byKind;
    throw new FindError(
      bare
        .map((o) =>
          `${o} needs a value, e.g. ${o === "--group" && pool[0] ? `--group ${qArg(groupOf(pool[0]))}` : OPTIONS[o]}. ${valuesOf(o, pool)}`.trim(),
        )
        .join("\n"),
    );
  }
  if (asked && !asked.length)
    throw new FindError(`--kind needs a value, e.g. ${OPTIONS["--kind"]}.`);
  if (sources && !sources.length)
    throw new FindError(`--source needs a value, e.g. ${OPTIONS["--source"]}.`);
  const showIds = list(set.get("--show"));
  if (showIds && !showIds.length) throw new FindError("--show needs an id, e.g. --show dissolve");
  if (starring && !commaList(set.get(starring)!).length)
    throw new FindError(`${starring} needs an id, e.g. ${starring} dissolve`);
  if (showIds) {
    const extra = [
      query,
      ...[...set.keys()].filter(
        (k) => !["--show", "-n", "--kind", "--source", "--broken", "--offline"].includes(k),
      ),
    ];
    if (extra.some(Boolean))
      throw new FindError(
        `--show takes ids, --kind and --source only (a comma list for several: --show dissolve,push; --kind text-in for one kind's of a shared id); drop ${extra.filter(Boolean).join(" ")}`,
      );
    let all = !given ? (wantsObjects ? await poolOf(false) : entriesOf(false)) : entriesOf(false);
    if (!given && !wantsObjects) {
      const anyMissed =
        showIds.some((rawId) => {
          const low = rawId.toLowerCase();
          return !all.some((x) => matchesAssetId(x, low));
        }) || Boolean(sources?.some((source) => !all.some((entry) => fromSource(entry, source))));
      if (anyMissed) all = markStarred([...all, ...(await loadObjects())], stars.shown());
    }
    if (sources?.some((source) => !all.some((entry) => fromSource(entry, source))))
      throw new FindError(`Unknown --source; ${valuesOf("--source", all)}`);
    const scoped = attachObjectVariants(
      sources ? all.filter((entry) => sources.some((source) => fromSource(entry, source))) : all,
      set.has("--broken"),
    );
    const kf = asked ? kindFilter(asked, scoped) : undefined;
    if (kf?.bad.length) throw new FindError(kf.bad.join("\n"));
    return asRead(kf?.read, show(showIds, kf ? scoped.filter(kf.test) : scoped));
  }
  if (starring) {
    const extra = [
      query,
      ...[...set.keys()].filter((k) => k !== starring && k !== "--kind" && k !== "--fav"),
    ];
    if (extra.some(Boolean))
      throw new FindError(
        `${starring} takes ids, --kind and --fav <list> only (a comma list for several: ${starring} boom,dissolve); drop ${extra.filter(Boolean).join(" ")}`,
      );
    const starIds = commaList(set.get(starring)!);
    const baseEntries = entriesOf(false);
    const needsObjects =
      !given &&
      (wantsObjects ||
        starIds.some(
          (id) =>
            /^(?:block|item|mob|prop):/i.test(id) ||
            !baseEntries.some((x) => x.id.toLowerCase() === id.toLowerCase()),
        ));
    const starPool = needsObjects
      ? markStarred([...baseEntries, ...(await loadObjects())], stars.shown())
      : baseEntries;
    return noted(star(set.get(starring)!, starring === "--star", asked, starPool, listName, stars));
  }
  const catalogSays = async (args: string[], clipPool: Entry[]) => {
    const ranJev = args.includes("--jev");
    try {
      const said = await clips([...args, "-n", `${n}`]);
      if (/^0 matches/m.test(said))
        return `${said}\nnext: no clip passes every word and filter together (${args.join(" ")}). Drop one filter or widen a range (--energy, --dur), then add it back; words match from a word start in the clip's name and description.${ranJev ? "" : `\n      by meaning (Jev, paid): bun run find --jev --kind mocap "<the move in words>"`}\n      ${mocapNext(clipPool, true, [...set.keys()])}\n      none fits: ${MAKE_MOCAP}`;
      // catalog.py prints a clip per unindented line (with an optional "--jev" score prefix), its FLAW on an indented one under it
      const clipRows = said
          .split("\n")
          .filter((l) => /^(?:-?\d+\.\d+\s+(?:fits\s+-?\d+\.\d+\s+)?)?\S+\/\S+\s/.test(l)),
        rows = clipRows.length,
        flawed = said.split("\n").filter((l) => /^\s+FLAW:/.test(l)).length;
      const checkedFits = clipRows.flatMap((line) => {
        const fit = /^\S+\s+fits\s+(-?\d+(?:\.\d+)?)\s/.exec(line);
        return fit ? [Number(fit[1])] : [];
      });
      const allFlawed =
        rows && flawed === rows
          ? `every clip shown has a FLAW seen by eye: none is clean as it is. Drop or loosen a filter (--mood, --to, --from, --dur) for a clean one${ranJev ? "" : ', or by meaning (Jev, paid): bun run find --jev --kind mocap "<the move in words>"'}; else ${MAKE_MOCAP}\n      `
          : "";
      const next =
        ranJev && checkedFits.length > 0 && checkedFits.every((fit) => fit < FIT_NO)
          ? `the checked clips do not fit. Rephrase the action, or make it: ${MAKE_MOCAP}`
          : `${allFlawed}${mocapNext(clipPool, true, [...set.keys()])}`;
      return `${said}\n\n${MOCAP_COLUMNS}\nwhere: ${useOf("mocap")}\nnext: ${next}`;
    } catch (err) {
      throw new FindError(
        `the mocap catalogue failed: ${(err as Error).message}. Words alone still work: bun run find --kind mocap <words>`,
        1,
      );
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
          : `--energy takes ${ENERGY_SAYS}; got ${v}`,
      );
    return [lo!, hi!] as const;
  };
  const dur = span("--dur");
  span("--energy");
  if (jev && !query)
    throw new FindError(
      `--jev needs the scene in words, e.g. bun run find --jev --kind ${asked?.join(",") ?? "sfx"} "<the scene or feeling>"`,
    );
  const body = Object.keys(BODY).filter((o) => set.has(o));
  if (set.has("--group") && body.length)
    throw new FindError(
      "--group filters the local catalog; use --kind mocap/<category> with body filters instead",
    );
  // a mocap category is the postures its clips start and end in, so body filters and catalog.py's Jev can take it
  // --kind as read (motion is mocap), so a body filter or the catalogue's Jev knows the clips were asked for
  const askedKind = asked && (body.length || jev) ? kindFilter(asked, entriesOf()) : undefined;
  if (askedKind?.bad.length) throw new FindError(askedKind.bad.join("\n"));
  const askedAs = askedKind?.as;
  const clipCats = askedAs?.filter((k) => k.startsWith("mocap/")) ?? [];
  const clipCat = clipCats.length
    ? (() => {
        const clipPool = entriesOf().filter((x) => x.kind === "mocap");
        const kf = kindFilter(clipCats, clipPool);
        if (kf.bad.length) throw new FindError(kf.bad.join("\n"));
        const cats = [...new Set(clipPool.filter(kf.test).map((x) => x.cat))];
        if (cats.length !== 1)
          throw new FindError(
            `${clipCats.join(",")} holds clips starting and ending in ${cats.length} ways (${cats.join(", ")}); body filters take one: --kind mocap/<one of them>, or --kind mocap with --from and --to`,
          );
        const [from = "", to = from] = cats[0]!.split(">");
        return { name: clipCats.join(","), from, to, read: kf.read };
      })()
    : undefined;
  if (body.length || (jev && clipCat)) {
    const clipPool = entriesOf().filter((x) => x.kind === "mocap");
    // catalog.py reads the clips' own records, which know no stars: the starred clips are few enough to list
    if (fav)
      throw new FindError(
        `--fav does not combine with ${body.length ? `the body filters (${body.join(" ")})` : `--jev --kind ${clipCats.join(",")}`}; the starred clips: bun run find --kind mocap ${favArg} (${clipPool.filter((x) => x.fav).length} of them)`,
      );
    if (askedAs && !askedAs.every((k) => k === "mocap" || k.startsWith("mocap/"))) {
      const soundy = askedAs.some((k) => [...SOUND, "sound"].includes(k.split("/")[0]!));
      throw new FindError(
        body.length
          ? `${body.join(" ")} ${body.length > 1 ? "filter" : "filters"} mocap clips by the body; use --kind mocap or no --kind${soundy && set.has("--mood") ? `. For music: ${BGM_MOOD}` : ""}`
          : `--jev over ${clipCats.join(",")} filters mocap clips by the body; ask the other kinds in a call of their own`,
      );
    }
    const soundOnly = ["--origin", "--license", "--edition"].filter((o) => set.has(o));
    if (soundOnly.length)
      throw new FindError(
        `${soundOnly.join(" ")} filter${soundOnly.length > 1 ? "" : "s"} sounds; mocap clips have none: drop ${soundOnly.length > 1 ? "them" : "it"} (clips filter by --source and --dur)`,
      );
    if (!clipPool.length)
      throw new FindError(
        `no mocap clips are indexed (vault/motion/catalog is empty or missing); drop ${body.join(" ")} or build the mocap catalogue first`,
      );
    const libs = [...new Set(clipPool.map((x) => x.src!))];
    const noClips = sources?.filter((s) => !libs.includes(s));
    if (noClips?.length)
      throw new FindError(
        `--source ${noClips.join(",")} has no mocap clips; clips come from ${libs.join(", ")}`,
      );
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
        if (!/^\d+(?:\.\d+)?$/.test(v)) throw new FindError(`--look takes ${LOOK_SAYS}; got ${v}`);
        return [o, v];
      }
      if (o === "--air") {
        if (v !== "yes" && v !== "no") throw new FindError(`--air is ${AIR_SAYS}; got ${v}`);
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
    const libArg = sources ? ["--lib", sources.join(",")] : [];
    // catalog.py matches each word at a word start: a name said as Arms_Holding or sitSeat is its words
    const words = jev ? ["--jev", query] : plain(query).filter((w) => !STOP.has(stem(w)));
    if (!jev && isForeign(query))
      throw new FindError(
        `words match English only: say the move in 1-3 plain English words (sit, kneel, look around), or by meaning in any language: bun run find --jev --kind mocap ${qArg(query)}`,
      );
    if (!words.length && query.trim())
      throw new FindError(
        `"${query}" names no move (filler words only): say the move (sit, kneel, look around), or drop the words to list every clip the filters pass`,
      );
    const durArg = dur ? ["--dur", set.get("--dur")!] : [];
    // a posture beside the category is read first (standing is stand), then must be the category's own
    for (const o of clipCat ? (["--from", "--to"] as const) : []) {
      const want = o === "--from" ? clipCat!.from : clipCat!.to;
      if (set.has(o) && args[args.indexOf(o) + 1] !== want)
        throw new FindError(
          `--kind ${clipCat!.name} starts in ${clipCat!.from} and ends in ${clipCat!.to}: drop ${o} ${set.get(o)} or the category`,
        );
    }
    const catArgs = clipCat
      ? (["--from", "--to"] as const).flatMap((o) =>
          set.has(o) ? [] : [o, o === "--from" ? clipCat.from : clipCat.to],
        )
      : [];
    return asRead(
      [...new Set([...(askedKind?.read ?? []), ...(clipCat?.read ?? [])])],
      await catalogSays([...words, ...args, ...catArgs, ...durArg, ...libArg], clipPool),
    );
  }
  if (
    !query &&
    !kinds &&
    !sources &&
    !["--origin", "--edition", "--license", "--dur", "--fav", "--group"].some((o) => set.has(o))
  ) {
    if (argv.length)
      throw new FindError(
        'find needs words, e.g. bun run find door slam, or --jev --kind sfx "a heavy door slams" (bun run find --help)',
      );
    return HELP;
  }

  // weapons and fights are left out, as the catalogue's own search leaves them (--fights, a body filter, goes there)
  const pool = (await poolOf()).filter(defaultSearchEntry);
  const kf = kinds ? kindFilter(kinds, pool) : undefined;
  // A source by its whole name, or a folder of them (film-stage = every film-stage/*.ts)
  const bySource = sources ? pool.filter((x) => sources.some((s) => fromSource(x, s))) : pool;
  const group = set.get("--group")?.toLowerCase();
  const inGroup = (entry: Entry) =>
    group === undefined ||
    groupOf(entry).toLowerCase() === group ||
    catSlug(groupOf(entry)) === group;
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
  const groupScope = kf && !kf.bad.length ? bySource.filter(kf.test) : bySource;
  if (group !== undefined && !groupScope.some(inGroup))
    throw new FindError(`Unknown --group ${group}. ${valuesOf("--group", groupScope)}`);
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
      `--origin is real or synth or unknown (sfx and bgm): ${buckets("--origin", bySource)}`,
    );
  if (edition !== undefined && !(edition in EDITIONS))
    throw new FindError(
      `--edition is vanilla or modded (Minecraft sounds & 3D objects): ${buckets("--edition", bySource)}`,
    );
  if (origin && edition)
    throw new FindError(
      `--origin sorts sfx and bgm, --edition sorts mc/objects: together they keep nothing. Give one: --origin ${origin} for sfx/bgm, --edition ${edition} for mc`,
    );
  // --license is a bucket (what an upload must do), else a word of a licence's own name: mit, lgpl, cc0, polyform
  const namedLicense =
    license !== undefined && !(license in LICENSES)
      ? new RegExp(`\\b${license.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
      : undefined;
  if (
    namedLicense &&
    !bySource.some((x) => hasLicense(x) && namedLicense.test(String(x.data?.license ?? "")))
  )
    throw new FindError(
      `--license is ${Object.keys(LICENSES).join(", ")} (sounds & mod packs): ${buckets("--license", bySource)}. Or a word of a licence's own name: ${rawLicenses(bySource)}`,
    );
  const licensed = (x: Entry) =>
    hasLicense(x) &&
    (namedLicense ? namedLicense.test(String(x.data?.license ?? "")) : licenseOf(x) === license);
  // every filter but --fav: what a search outside the favourites, or in another list, would meet
  const unstarred = bySource.filter(
    (x) =>
      inGroup(x) &&
      (origin === undefined ||
        (SOUND.includes(x.kind) && x.kind !== "mc" && originOfEntry(x) === origin)) &&
      (edition === undefined ||
        ((x.kind === "mc" || ["block", "item", "mob"].includes(x.kind)) &&
          editionOfEntry(x) === edition)) &&
      (license === undefined || licensed(x)) &&
      (!dur || inRange(x.secs, dur)),
  );
  const entries = fav ? unstarred.filter((x) => x.fav) : unstarred;
  const filter = [
    group && `--group ${qArg(group)}`,
    sources && `--source ${sources.join(",")}`,
    origin && `--origin ${origin}`,
    edition && `--edition ${edition}`,
    license && `--license ${license}`,
    dur && `--dur ${set.get("--dur")}`,
    fav && favArg,
  ]
    .filter(Boolean)
    .join(" ");
  if (kf?.bad.length) {
    throw new FindError(
      !filter
        ? kf.bad.join("\n")
        : `${filter} keeps ${counts(entries) || "nothing"}: ${kf.bad.join("; ")}`,
    );
  }
  // nothing in the list in use: how a star is given, and the lists that have some
  if (fav && !pool.some((x) => x.fav)) {
    const message = [
      `nothing is starred yet in the ${listName} favourites (${relative(ROOT, stars.file).replaceAll("\\", "/")}).`,
      ...(listsLine ? [listsLine] : []),
      `next: the creator stars in the studio (the star on a sound card or an effect tile), or asks you to: bun run find --star <id>${listName === "default" ? "" : ` --fav ${listName}`}`,
      `      without --fav, find searches everything: bun run find ${query ? qArg(query) : "<words>"}`,
    ].join("\n");
    if (set.has("--json")) {
      if (semantic)
        return JSON.stringify(
          { mode: "keyword-fallback", query, notes: [...notes, message], results: [] },
          null,
          2,
        );
      return dualSearchOutput(
        query,
        [],
        { hits: [], categories: [], notes: [] },
        {
          limit: n,
          offset,
          json: true,
          notes: [...notes, message],
          foreign: isForeign(query),
          line: (entry) => line(entry),
          where: () => [],
        },
      );
    }
    return noted(message);
  }
  kinds = kf?.as;
  const rawCandidates = kf ? entries.filter(kf.test) : entries;
  const brokenCandidates = rawCandidates.filter((x) => x.data?.renderable === false);
  const candidates =
    set.has("--broken") || !wantsObjects
      ? rawCandidates
      : rawCandidates.filter((x) => x.data?.renderable !== false);
  const inKinds = foldSoundEntries(
    !set.has("--variants") && wantsObjects ? foldObjectEntries(candidates) : candidates,
  );
  const candidateSounds = groupBy(
    candidates.filter((x) => SOUND.includes(x.kind)),
    (x) => soundKey(x),
  );
  if (kf && !inKinds.length && !brokenCandidates.length && filter) {
    // the kind exists in pool but the filter took it all: say which filter, not "unknown kind"
    throw new FindError(
      `${filter} keeps ${counts(entries) || "nothing"}, none of it --kind ${kinds!.join(",")}.${origin ? ` --origin sorts sfx and bgm (bgm has ${bySource.filter((x) => x.kind === "bgm" && originOfEntry(x) === origin).length} ${origin}).` : ""}${edition ? " --edition sorts mc and 3D objects." : ""}${license ? " --license sorts sounds and mod packs." : ""}${dur ? " --dur keeps only what has a length (sounds, mocap clips)." : ""} Drop it, or see what --kind ${kinds!.join(",")} holds: bun run find --kind ${kinds!.join(",")}${sources?.includes("minecraft") && kinds!.some((k) => k.startsWith("bgm")) ? `\n${MC_MUSIC_NOTE}` : ""}`,
    );
  }
  // how a loose --kind was read (music as bgm, sfx/riser as sfx/transitions), above whatever it found
  const readAs = (text: string) => asRead(kf?.read, text);
  // what --kind names without its categories (sfx/typing is sfx), for the hints that speak of a kind
  const kindNames = kinds?.map((k) => k.split("/")[0]!);
  // the filters besides --kind: Jev offered on these entries keeps them, or it votes over the whole kind
  const narrowing = `${sources ? ` --source ${sources.join(",")}` : ""}${group ? ` --group ${qArg(group)}` : ""}${origin ? ` --origin ${origin}` : ""}${edition ? ` --edition ${edition}` : ""}${license ? ` --license ${license}` : ""}${dur ? ` --dur ${set.get("--dur")}` : ""}${fav ? ` ${favArg}` : ""}`;
  const filters = `${kinds ? ` --kind ${qArg(kinds.join(","))}` : ""}${narrowing}${set.has("--variants") ? " --variants" : ""}${set.has("--broken") ? " --broken" : ""}`;
  // The filters these entries can still take, each value with how many it keeps (a filter already given is left out).
  // Terse (under a search): only filters that would split the hits, values without their meaning
  const filtersFor = (xs: Entry[], terse = false, familyMembers = candidateSounds) => {
    const members = xs.flatMap((x) =>
      SOUND.includes(x.kind) ? (familyMembers.get(soundKey(x)) ?? [x]) : [x],
    );
    const given: Record<string, unknown> = {
      "--origin": origin,
      "--edition": edition,
      "--license": license,
    };
    const facets = Object.keys(FACETS).flatMap((o) => {
      const ys = members.filter(FACETS[o]!.keep);
      if (given[o] || !ys.length) return [];
      if (terse && new Set(ys.map(FACETS[o]!.of)).size < 2) return [];
      return [`${o} ${buckets(o, ys, terse ? "terse" : "held")}`];
    });
    const bySrc = tallyEntries(
      members.filter(
        (x) => (SOUND.includes(x.kind) || x.kind === "mocap" || isObjectKind(x.kind)) && !!x.src,
      ),
      (x) => x.src!,
    )
      .split(", ")
      .filter(Boolean);
    if (!sources && bySrc.length > (terse ? 1 : 0))
      facets.push(
        `--source ${terse && bySrc.length > 8 ? `${bySrc.slice(0, 8).join(", ")} and ${bySrc.length - 8} more (bun run find --source lists all)` : bySrc.join(", ")}`,
      );
    const lengths = durs(members).split(", ").filter(Boolean);
    if (!dur && lengths.length > (terse ? 1 : 0)) facets.push(`--dur ${lengths.join(", ")}`);
    const starredHere = foldSoundEntries(members.filter((x) => x.fav)).length;
    if (!fav && starredHere && (!terse || starredHere < xs.length))
      facets.push(`--fav ${starredHere} starred (the creator's favourites)`);
    return facets;
  };
  const where = (shown: Entry[]) => {
    const uses = [...new Set(shown.map((x) => useOf(x.kind)))];
    return uses.length ? ["", `where: ${uses.join("\n       ")}`] : [];
  };
  if (!query) {
    if (!inKinds.length) {
      if (brokenCandidates.length && !set.has("--broken"))
        return readAs(
          `0 renderable matches (${brokenCandidates.length} non-renderable models hidden — .geo.json/.obj, custom loaders, or missing parent/texture).\nnext: include them: bun run find${filters} --broken`,
        );
      throw new FindError(
        `nothing has${filters}: drop one (bun run find --kind sfx lists the sound filters)`,
      );
    }
    const kindsHere = [...new Set(inKinds.map((x) => top(x.kind)))];
    const narrowed = kinds?.some((k) => k.includes("/"));
    const jevHere = `by meaning (Jev, paid; reads every entry of the kind or category): bun run find --jev --kind ${qArg(kinds?.join(",") ?? kindsHere.join(","))}${narrowing} "<the scene or feeling>"`;
    const groups =
      narrowed ||
      kindsHere.every((k) => !catList(candidates.filter((x) => top(x.kind) === k)).includes(","))
        ? []
        : [`categories (--kind <kind>/<category>): ${catList(candidates)}`];
    // one category, or a kind small enough to read: its entries (a long category: the first 40 and the words they are
    // named by, to search inside it)
    if (inKinds.length <= 60 || nRaw || narrowed || set.has("--offset")) {
      if (offset >= inKinds.length)
        return readAs(
          `0 entries at offset ${offset}; ${inKinds.length} entries match. Reduce --offset.`,
        );
      const some = inKinds.slice(
        offset,
        offset + (nRaw || set.has("--offset") ? n : inKinds.length <= 60 ? 60 : 40),
      );
      const cut = offset + some.length < inKinds.length;
      const files = some.flatMap((x) =>
        SOUND.includes(x.kind) && x.data?.file ? [soundFile(x.data.file)] : [],
      );
      return readAs(
        [
          ...(fav
            ? [
                `${inKinds.length} starred by the creator in the ${listName} favourites${listsLine ? `; ${listsLine}` : ""}:`,
              ]
            : []),
          ...groups,
          ...(cut
            ? [
                offset
                  ? `entries ${offset + 1}-${offset + some.length} of ${inKinds.length}:`
                  : `first ${some.length} of ${inKinds.length}:`,
              ]
            : []),
          ...some.map((x) => line(x)),
          ...where(some),
          ...filtersFor(inKinds).map((f) => `filter: ${f}`),
          ...(cut ? [`named by: ${namedBy(inKinds)}`] : []),
          ...(some.some((x) => x.kind === "bgm") ? [BGM_MOOD, MC_MUSIC_NOTE] : []),
          `next: ${cut ? `next page: bun run find${filters} -n ${some.length} --offset ${offset + some.length}; search inside: bun run find <word>${filters} (a word from "named by")${inKinds.length <= LIST_ALL ? `; all ${inKinds.length}: -n ${inKinds.length}` : ""}` : `bun run find <words>${filters} searches these`}; one in full: bun run find --show <id>`,
          `      ${jevHere}`,
          ...(wantsObjects && !set.has("--broken") && brokenCandidates.length
            ? [
                `      ${brokenCandidates.length} non-renderable models hidden; add --broken to include`,
              ]
            : []),
          ...(wantsObjects && some.some((x) => (x.data?.variants?.length ?? 0) > 1)
            ? [`      (+N variants): add --variants to expand every variant`]
            : []),
          ...(some.some((x) => x.kind === "mocap")
            ? [`      ${mocapNext(pool, false, [...set.keys()])}`]
            : []),
          ...(files.length > 1 && files.length <= 20
            ? [`      ${hearThem("<what it should sound or feel like>", files)}`]
            : []),
          ...(favsLine ? [`      ${favsLine}`] : []),
        ].join("\n"),
      );
    }
    const categoryScope = catScope(inKinds);
    const cats = new Map<string, Entry[]>();
    for (const x of inKinds) {
      const key = x.cat ? narrowCatKey(x, categoryScope) : x.kind;
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
        `${inKinds.length} ${fav ? `starred in the ${listName} favourites` : "entries"} by category, as --kind takes them (the studio's heading, a few ids):`,
        ...(fav && listsLine ? [listsLine] : []),
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
        `next: one category: bun run find --kind ${example ?? "<kind>/<category>"}${narrowing}`,
        `      search inside it: bun run find <english words> --kind ${example ?? "<kind>/<category>"}${narrowing}; one in full: bun run find --show <id>`,
        `      by meaning inside one (Jev, paid): bun run find --jev --kind ${example ?? "<kind>/<category>"}${narrowing} "<the scene or feeling>"`,
        ...(inKinds.some((x) => x.kind === "mocap")
          ? [`      ${mocapNext(pool, false, [...set.keys()])}`]
          : []),
        ...(favsLine ? [`      ${favsLine}`] : []),
      ].join("\n"),
    );
  }

  if (semantic) {
    const lexical = isForeign(query) ? [] : rank(candidates, query, { n: 100 });
    const json = (mode: "hybrid" | "keyword-fallback", entries: Entry[], message?: string) =>
      JSON.stringify(
        {
          mode,
          query,
          notes: [...notes, ...(message ? [message] : [])],
          results: entries.map((entry) => {
            const { data, ...summary } = entry;
            return {
              key: assetKey(entry),
              ...summary,
              file: assetFile(entry) || undefined,
              license: typeof data?.license === "string" ? data.license : undefined,
            };
          }),
        },
        null,
        2,
      );
    try {
      const { hybridSearch } = await import("./semantic/search");
      const hits = await hybridSearch(query, candidates, lexical, {
        allowApi: set.has("--yes"),
        file: set.get("--db"),
        provider: set.get("--provider"),
        dimensions,
        limit: offset + n,
      }).then((entries) => entries.slice(offset, offset + n));
      if (set.has("--json")) return json("hybrid", hits);
      return readAs(
        [
          `hybrid semantic + keywords: ${hits.length} candidates (listen/view before choosing)`,
          ...hits.map((entry) => {
            const segment = entry.semantic?.segment;
            return (
              line(entry) +
              (segment
                ? `  [source chunk ${segment.from.toFixed(2)}–${segment.to.toFixed(2)}s]`
                : "")
            );
          }),
          ...where(hits),
          "next: bun run find --show <id> for settings, file and usage; Jev remains available for a closer fit check.",
        ].join("\n"),
      );
    } catch (error) {
      const message = `semantic unavailable: ${error instanceof Error ? error.message : String(error)}; keyword results follow`;
      if (set.has("--json"))
        return json("keyword-fallback", lexical.slice(offset, offset + n), message);
      notes.push(message);
    }
  }

  if (jev && kinds?.length === 1 && kinds[0] === "mocap" && !fav && !group)
    return readAs(
      await catalogSays(
        [
          "--jev",
          query,
          ...(dur ? ["--dur", set.get("--dur")!] : []),
          ...(sources ? ["--lib", sources.join(",")] : []),
        ],
        pool,
      ),
    );

  const {
    foreign,
    said,
    asks,
    ranked,
    typed,
    named,
    wordMatches,
    matches: rawMatches,
    rankIn,
  } = keywordSearch(candidates, query, kinds);
  const matches =
    !set.has("--variants") && wantsObjects ? foldObjectEntries(rawMatches) : rawMatches;
  const hiddenBrokenMatches =
    wantsObjects && !set.has("--broken") && brokenCandidates.length
      ? keywordSearch(brokenCandidates, query, kinds).matches.length
      : 0;
  if (
    !jev &&
    !semantic &&
    (set.has("--json") || candidates.some((entry) => openFilmCategory(entry)))
  ) {
    const found = candidates.some((entry) => openFilmCategory(entry))
      ? await lookup(query, candidates, {
          offline: set.has("--offline") || process.env.MC_FIND_OFFLINE === "1",
        })
      : { hits: [], categories: [], notes: [] };
    return dualSearchOutput(query, matches, found, {
      limit: n,
      offset,
      json: set.has("--json"),
      notes: [...notes, ...(kf?.read ?? [])],
      foreign,
      line: (entry) => line(entry),
      where,
      nextPage: `bun run find ${qArg(query)}${filters} -n ${n} --offset ${offset + n}`,
    });
  }
  if (offset && offset >= matches.length)
    return readAs(
      `0 entries at offset ${offset}; ${matches.length} entries match. Reduce --offset.`,
    );
  const out: string[] = [],
    next: string[] = [];
  let shown: [string, Entry][] | undefined;
  // Jev said none of the shown is what was asked: no line may send the agent back to them
  let rejected = false;
  const byMeaning = (kind: string) =>
    `bun run find --jev --kind ${qArg(kind)}${narrowing} ${qArg(query)}`;
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
    return `outside --kind ${kinds!.join(",")} these words are in: ${where.join(", ")} (bun run find ${qArg(query)} --kind ${where[0]!.split(" ")[0]})`;
  };
  // Hits spread over categories: the one to narrow to, as the studio's chips would
  const spread = (xs: Entry[]) => {
    if (kinds?.every((k) => k.includes("/"))) return "";
    const one = catScope(xs);
    const cats = tally(xs.map((x) => (x.cat ? narrowCatKey(x, one) : x.kind))).split(", ");
    return cats.length > 1
      ? `hits by category: ${cats.slice(0, 6).join(", ")}${cats.length > 6 ? ", …" : ""}. Narrow to one: --kind ${qArg(cats[0]!.split(" ")[0]!)}`
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
    // an ease times an effect and is never the effect asked for: Jev votes over eases only when --kind names them
    // (transition/ease); with them in, "linear" outvoted every cut for "a hard cut on the beat"
    // transition/ease, or cut short as transition/eas, names the timing kind transition-ease
    const timing = (x: Entry) =>
      TIMING.includes(x.kind) &&
      !kinds!.some((k) => {
        const named = k.replace("/", "-").toLowerCase();
        return named.startsWith(x.kind) || (k.includes("/") && x.kind.startsWith(named));
      });
    const meaningCandidates = kinds?.length ? candidates.filter((x) => !timing(x)) : wordMatches;
    const descriptions = groupBy(meaningCandidates, (x) =>
      SOUND.includes(x.kind) ? JSON.stringify([soundKey(x), jevText(x)]) : x,
    );
    const jevPool = [...descriptions.values()]
      .map((takes) => foldSoundEntries(takes)[0]!)
      .slice(0, kinds?.length ? Infinity : POOL);
    if (!jevPool.length)
      next.push(
        kinds?.length
          ? `nothing left in --kind ${qArg(kinds.join(","))} after hiding timing curves; name --kind transition/ease or --kind anim-curve, or drop --jev.`
          : "--jev without --kind only reorders word matches, and none matched: add --kind <kind>.",
      );
    else {
      try {
        const choices = (await judge(query, jevPool, Math.min(n, FITS_MAX)))
          .filter(([p]) => p > 0)
          .sort((a, b) => b[0] - a[0]);
        const voted = [...groupBy(choices, ([, x]) => soundKey(x)).values()]
          .map(
            (takes) =>
              takes.find(([, , fit]) => fit !== undefined && fit >= FIT_YES) ??
              takes.toSorted((a, b) => (b[2] ?? -1) - (a[2] ?? -1))[0]!,
          )
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
          // the ones Jev says are not what was asked say nothing, but the first and the best fit (the one a miss quotes) stay;
          // when even the best fit is a no, the ones never checked (under its top FITS_MAX) are no answer either
          const none = bestFit?.[2] !== undefined && bestFit[2] < FIT_NO;
          const kept = voted
            .slice(0, n)
            .filter(
              (v, i) => i === 0 || v === bestFit || (v[2] === undefined ? !none : v[2] >= FIT_NO),
            );
          const left = Math.min(n, voted.length) - kept.length;
          out.push(
            `Jev voted among ${jevPool.length} ${kinds?.length ? "entries" : "word matches (add --kind to vote over a whole kind)"}; first column = its share of the vote${checked.length ? `, then "fits" = its own yes/no that the entry is what you asked for (0-1)` : ""}${choices.length < Math.min(n, jevPool.length) ? `; the other ${jevPool.length - choices.length} got none` : ""}${left ? `; ${left} it says are not it are left out` : ""}${kept.some(([, , fit]) => fit === undefined) ? "; rows without fits are unchecked" : ""}.`,
          );
          shown = kept.map(([p, x, f]) => [
            `${p.toFixed(2)}  ${f === undefined ? "" : `fits ${f.toFixed(2)}  `}`,
            x,
          ]);
          const best = Math.round((voted[0]?.[0] ?? 0) * 100);
          const fit = bestFit?.[2];
          rejected = fit !== undefined && fit < FIT_NO;
          if (
            (fit !== undefined ? fit < FIT_YES : best < 50) &&
            kinds?.length === 1 &&
            ["sfx", "mc"].includes(kindNames![0]!)
          )
            next.push(
              `also try --kind sound: sfx and Minecraft together (a door creak may be a Minecraft block sound)`,
            );
          next.push(
            fit !== undefined
              ? fit < FIT_NO
                ? `NOT IN THE VAULT: Jev says none of these is what you asked for (best fit ${fit.toFixed(2)}). Do not use one as if it were. Ask once more in other words (what it is, or the feeling it should give), or make it:`
                : fit < FIT_YES
                  ? `UNSURE: Jev half-believes the best (fit ${fit.toFixed(2)}): read it with --show ${bestFit![1].id}, use it only if it really is what the moment needs; else make it:`
                  : `FOUND: ${voted[0]![1].id} (fit ${voted[0]![2]!.toFixed(2)})${promoted ? `, moved above the vote's favourite ${promoted[1].id}, which Jev doubts is what you asked for (fit ${promoted[2]!.toFixed(2)})` : ""}. --show ${voted[0]![1].id} gives its settings and the line to paste.`
              : best < 20
                ? `probably not in the vault (the best has only ${best}% of the vote). Make it:`
                : best < 50
                  ? `unsure (the best has ${best}% of the vote): several fit about equally, or none does. Compare the top few with --show; if none fits, make it:`
                  : `Jev prefers the first (${best}% of the vote). A vote always picks something, so check it with --show; if none fits, make it:`,
            ...(fit !== undefined && fit >= FIT_YES ? [] : make(kindNames, entries)).map(
              (m) => `  ${m}`,
            ),
          );
        } else
          next.push(
            matches.length
              ? "Jev found no entry that fits; word matches below."
              : "Jev found no entry that fits, and no word matches either.",
          );
      } catch (err) {
        // jev.py's own words already say which key or quota; anything else never reached it
        const why = (err as Error).message;
        const tail = matches.length ? "Word matches below." : "No word matches either.";
        next.push(
          why.startsWith("Jev:")
            ? `${why}. ${tail}`
            : `Jev did not run: ${why}. ${tail}${/ENOENT|spawn/i.test(why) ? " Jev needs python on PATH (packages/clip-catalog/jev.py)." : ""}`,
        );
      }
    }
  }
  if (!shown) {
    const page = matches.slice(offset, offset + n);
    const part = typed.length > 1 && page.some((x) => x.matched < x.of);
    shown = page.map((x) => [part && x.matched < x.of ? `${x.matched}/${x.of} words  ` : "", x]);
    if (offset || matches.length > n)
      out.push(
        `${matches.length} word matches (${counts(matches)}); ${offset ? `entries ${offset + 1}-${offset + page.length}` : `top ${n}`}:`,
      );
    if (!jev && offset + n < matches.length)
      next.push(`next page: bun run find ${qArg(query)}${filters} -n ${n} --offset ${offset + n}`);
    const best = matches[0];
    // weapon and fight clips (zombie walk, jab punch) are left out of the pool, as the catalogue's own search leaves them:
    // those with more of the words than the best shown are named by id, since --fights (catalog.py) needs every word
    const fightLine = () => {
      if (kinds && !kindNames?.includes("mocap")) return "";
      const hits = rank(
        entriesOf().filter((x) => x.kind === "mocap" && isFight(x.id)),
        asks,
      ).filter((x) => x.matched > (best?.matched ?? 0));
      return hits.length
        ? `${hits.length} weapon or fight clip${hits.length > 1 ? "s have" : " has"} more of these words (left out by default): ${hits
            .slice(0, 3)
            .map((x) => x.id)
            .join(
              ", ",
            )}; one in full: bun run find --show <id>; with every word: bun run find ${qArg(query)} --kind mocap --fights`
        : "";
    };
    const scene = typed.length >= 8;
    // Words first (free, instant): plain English, then the studio's groups; Jev (paid) only once both came up short
    const PLAIN =
      "entries are named plainly: what it is, not the moment (whoosh, impact, riser, glitch, door creak, chime; Minecraft by mob or block: zombie say, chest open; mocap by action: sit, kneel, look around; transitions and anims by motion: wipe, zoom, spin, blur)";
    if (foreign)
      next.push(
        `words match English only: say it again in 1-3 plain English words, ${PLAIN}. e.g. bun run find <english words>${filters}`,
        browse(),
        ...(!jev
          ? [
              `last, by meaning in any language (Jev, a paid call): ${byMeaning(kinds?.join(",") ?? "<kind>")}`,
            ]
          : []),
      );
    else if (!best) {
      const known = new Set(inKinds.flatMap((x) => fieldWords(x, !kinds?.length)));
      const guesses = typed.flatMap((w) => (known.has(stem(w)) ? [] : (closest(w, inKinds) ?? [])));
      // the words are there, but --source/--origin/--edition took them: name the sources that have them
      const unfiltered =
        sources || origin || edition || license || dur
          ? rankIn(kinds ? pool.filter(kindFilter(kinds, pool).test) : pool)
          : [];
      const other = unfiltered.length
        ? `these words are in${kinds ? ` --kind ${qArg(kinds.join(","))}` : ""}, but not with${narrowing}: ${tally(
            unfiltered.map((x) =>
              sources
                ? `--source ${x.src ?? "?"}`
                : license
                  ? `--license ${hasLicense(x) ? licenseOf(x) : `(${top(x.kind)} has none)`}`
                  : origin
                    ? `--origin ${SOUND.includes(x.kind) && x.kind !== "mc" ? originOfEntry(x) : `(${top(x.kind)} has none)`}`
                    : edition
                      ? `--edition ${FACETS["--edition"]!.keep(x) ? editionOfEntry(x) : `(${top(x.kind)} has none)`}`
                      : `--dur ${x.secs === undefined ? `(${top(x.kind)} has no length)` : durOf(x.secs)}`,
            ),
          )
            .split(", ")
            .slice(0, 5)
            .join(
              ", ",
            )} (bun run find ${qArg(query)}${kinds ? ` --kind ${qArg(kinds.join(","))}` : ""})`
        : elsewhere();
      // under --fav: the creator's other lists that have these words, then everything outside the favourites
      const inKind = (xs: Entry[]) => (kf ? xs.filter(kf.test) : xs);
      const inLists = fav
        ? otherLists.flatMap((l) => {
            const xs = markStarred(unstarred, favorites.open(l.name).shown());
            const hits = rankIn(inKind(xs.filter((x) => x.fav))).length;
            return hits ? [`${l.name} ${hits}`] : [];
          })
        : [];
      const favMiss = fav
        ? `none of the ${listName} favourites has these words${inLists.length ? `; other lists do: ${inLists.join(", ")} (bun run find ${qArg(query)} --fav ${inLists[0]!.split(" ")[0]})` : ""}; ${rankIn(inKind(unstarred)).length} entries outside the favourites do (bun run find ${qArg(query)}${filters.replace(` ${favArg}`, "")})`
        : "";
      // the words may be a weapon's or a fight's, whose clips the pool leaves out: they exist, so nothing needs making
      const fights = fightLine();
      if (fights) next.push(fights, ...(other ? [other] : []));
      // the creator chose from the favourites: a miss goes back to them, not into making one
      else if (favMiss)
        next.push(
          favMiss,
          `if the creator asked for favourites only: say none has it and ask which to use, or which to star (bun run find --star <id>${listName === "default" ? "" : ` --fav ${listName}`}). The favourites in full: bun run find ${favArg}`,
        );
      else
        next.push(
          ...(other ? [other] : []),
          `no entry${kinds ? ` of --kind ${qArg(kinds.join(","))}` : ""}${unfiltered.length ? ` with${narrowing}` : ""} has these words${guesses.length ? ` (did you mean: ${guesses.join(", ")}?)` : ""}. Try other words: ${PLAIN}`,
          browse(),
          ...(music ? [moodAdvice()] : []),
          ...(!jev ? [`last, by meaning (Jev, a paid call): ${byMeaning(guess())}`] : []),
          "if none of these has it, make it:",
          ...make(kindNames, entries).map((m) => `  ${m}`),
        );
    } else if (!jev) {
      const has = new Set(fieldWords(best, !kinds?.length));
      // each word's slot as the query made it, so "ender" keeps the "enderdragon" it joins with its neighbour
      const slotOf = new Map(slotsOf(asks).map((slot) => [slot[0]!, slot]));
      const missing = typed.filter(
        (w) => !(slotOf.get(stem(w)) ?? [stem(w)]).some((t) => has.has(t)),
      );
      const fights = fightLine();
      if (fights) next.push(fights);
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
          `a sound? add --kind sound (sfx, bgm and Minecraft only): bun run find ${qArg(query)} --kind sound`,
        );
      // a word no title says may be what a whole category is ("creepy": mc/horror): the category, searched with the rest
      const one = catScope(inKinds);
      const cats = new Map<string, Entry[]>();
      for (const x of inKinds)
        if (x.cat) {
          const k = narrowCatKey(x, one);
          cats.set(k, [...(cats.get(k) ?? []), x]);
        }
      for (const w of missing) {
        const holds = [...cats].filter(
          ([key, xs]) =>
            key !== narrowCatKey(best, one) &&
            words(`${xs[0]!.cat} ${catLabel(xs[0]!)} ${CAT_WORDS[catKey(xs[0]!)] ?? ""}`).includes(
              stem(w),
            ),
        );
        const rest = typed.filter((t) => t !== w).join(" ");
        if (holds.length)
          next.push(
            `"${w}" is what a category holds: ${holds.map(([key, xs]) => `${key} ${xs.length}`).join(", ")}. bun run find ${rest ? `${rest} ` : ""}--kind ${qArg(holds[0]![0])}`,
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
          `top hit lacks: ${missing.join(", ")}. Drop or swap that word, or ${browse().replace("browse instead: ", "browse: ")}. By meaning (Jev, paid): ${byMeaning(kind)}`,
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
  else if (shown.length && !rejected && !next.some((l) => l.includes("--show ")))
    next.push("one in full (settings, a line to paste, how to see it): bun run find --show <id>");
  if (shown.some(([, x]) => (x.takes ?? 1) > 1))
    next.push(
      "(N takes): the id shown plays as is; --show <id> names every take, to vary a sound that repeats.",
    );
  if (shown.some(([, x]) => Array.isArray(x.data?.variants) && x.data.variants.length > 1))
    next.push("(+N variants): add --variants to expand every variant; --show <id> lists all.");
  if (hiddenBrokenMatches > 0)
    next.push(
      `${hiddenBrokenMatches} non-renderable match${hiddenBrokenMatches > 1 ? "es" : ""} hidden (.geo.json/.obj, custom loader, or missing parent/texture); add --broken to include.`,
    );
  if (
    !given &&
    !wantsObjects &&
    !kinds &&
    !set.has("--json") &&
    !semantic &&
    typed.length &&
    !foreign
  ) {
    const warm = loadWarmMcCache(resolvedVault);
    if (warm) {
      const qTokens = typed.map(stem);
      const warmHits: McAssetItem[] = [];
      const checkWarm = (items: McAssetItem[]) => {
        for (const it of items) {
          if (it.renderable === false) continue;
          const hay = words(`${it.name} ${it.title}`);
          if (qTokens.every((t) => hay.includes(t))) {
            warmHits.push(it);
            if (warmHits.length >= 12) return;
          }
        }
      };
      if (warm.vanilla?.entries) checkWarm(warm.vanilla.entries);
      if (warmHits.length < 12) {
        for (const p of Object.values(warm.packs)) {
          checkWarm(p.entries);
          if (warmHits.length >= 12) break;
        }
      }
      if (warmHits.length) {
        const folded = foldObjectVariants(warmHits);
        next.push(
          `3D vault also matches "${query}" (${folded
            .slice(0, 3)
            .map((x) => x.id)
            .join(
              ", ",
            )}${folded.length > 3 ? "…" : ""}): bun run find ${qArg(query)} --kind object`,
        );
      }
    }
  }
  // the filters that would split these hits, so a pack, a licence or a length is never a guess
  const narrow =
    !jev && matches.length > 1
      ? filtersFor(
          matches,
          true,
          groupBy(
            wordMatches.filter((x) => SOUND.includes(x.kind)),
            (x) => soundKey(x),
          ),
        )
      : [];
  if (narrow.length)
    next.push(
      `narrow these ${matches.length}: ${narrow.join(" | ")}  (a filter named alone, e.g. --license, says what its values mean)`,
    );
  if (shown.some(([, x]) => x.kind === "mocap") || kindNames?.includes("mocap")) {
    // a feeling said as a word ("scared") is a mood checked clips are tagged with, which words never reach
    const clipsHere = pool.filter((x) => x.kind === "mocap");
    const moods = new Map(
      tagged("mood", clipsHere)
        .split(", ")
        .map((t) => t.split(" ") as [string, string]),
    );
    const mood = typed
      .map((w) => (moods.has(w.toLowerCase()) ? w.toLowerCase() : MOOD_ALIAS[stem(w)]))
      .find((m) => m && moods.has(m));
    if (mood)
      next.push(
        `${mood} is a mood clips checked by eye are tagged with: bun run find --mood ${mood} (${moods.get(mood)} clips)`,
      );
    // the body filters only where clips are what was looked for, not a stray clip among sounds
    if (
      kindNames?.includes("mocap") ||
      shown.filter(([, x]) => x.kind === "mocap").length * 2 > shown.length
    )
      next.push(mocapNext(pool, false, [...set.keys()]));
  }
  if (fav && listsLine && shown.length) next.push(listsLine);
  if (favsLine) next.push(favsLine);
  const files = shown.flatMap(([, x]) =>
    SOUND.includes(x.kind) && x.data?.file ? [soundFile(x.data.file)] : [],
  );
  if (files.length > 1 && !rejected)
    next.push(
      `${hearThem(foreign ? "<the sound in English words>" : query, files)}  (about 40 s a call; describe the sound, not its job; which earshot command for what: bun run skills get core --ref sound)`,
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
