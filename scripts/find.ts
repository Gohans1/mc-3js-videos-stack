// One lookup over everything a film can name (vault sounds, every film-stage preset), built so an agent reads ~15 lines
// instead of grepping 3 MB of SOURCES.json: bun run find --help. Jev (packages/clip-catalog/jev.py) ranks by meaning.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

import { ANIM_CURVES, ANIMS } from "../packages/film-stage/src/animate";
import { EASES } from "../packages/film-stage/src/camera";
import { ADJUSTMENTS } from "../packages/film-stage/src/grade-color";
import {
  FONTS,
  SHAPE_IN,
  SHAPE_OUT,
  TEXT_IN,
  TEXT_OUT,
  TITLE_EASES,
} from "../packages/film-stage/src/titles";
import { TRANSITION_EASES, TRANSITIONS } from "../packages/film-stage/src/transitions";
import { VELOCITY_EFFECTS } from "../packages/film-stage/src/velocity";
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
  anim: 'shots.json shot.anim.in|out|combo {"fx","len"}',
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
  let s = w.replace(/ies$/, "y");
  if (s.length > 4) s = s.replace(/(?:ing|ed|es)$/, "");
  if (s.length > 3 && !s.endsWith("ss")) s = s.replace(/s$/, "");
  if (s.length > 3) s = s.replace(/[ye]$/, "");
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
  words("a an the of by to in on for with and or at from his her their it is as into onto"),
);

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
};

// BM25F by repetition: a word in the id or title counts 3x, in the category 2x, in the description and kind once
const fieldWords = (x: Entry) => {
  const head = words(`${x.id} ${x.title}`),
    cat = words(x.cat);
  const kind = words(`${x.kind} ${KIND_WORDS[x.kind] ?? ""}`);
  return [...head, ...head, ...head, ...cat, ...cat, ...words(x.about), ...kind];
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
  const q = [...new Set(words(query))].filter((w) => !STOP.has(w));
  const df = new Map(q.map((w) => [w, docs.filter((d) => d.includes(w)).length]));
  const K1 = 1.2,
    B = 0.75;
  return pool
    .map((x, i) => {
      const d = docs[i] ?? [];
      const matched = q.filter((w) => d.includes(w)).length;
      const bm25 = q.reduce((s, w) => {
        const tf = d.filter((t) => t === w).length,
          n = df.get(w) ?? 0;
        if (!tf) return s;
        const idf = Math.log(1 + (pool.length - n + 0.5) / (n + 0.5));
        return s + (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.length) / avg));
      }, 0);
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
      /\bCC[ -]BY\b/i.test(first.license ?? "") && `credit: ${first.license}`,
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
  const list = (kind: string, xs: readonly Preset[], file: string) =>
    xs.map((x) => ({
      kind,
      src: `film-stage/${file}.ts`,
      id: x.id,
      cat: x.category ?? x.cat ?? x.group ?? "",
      title: x.title ?? x.id,
      about: x.tip ?? "",
      data: { ...x },
    }));
  const ids = (kind: string, xs: readonly string[], file: string) =>
    list(
      kind,
      xs.map((id) => ({ id })),
      file,
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
    ...list("shape-in", SHAPE_IN, "titles"),
    ...list("shape-out", SHAPE_OUT, "titles"),
    ...list("font", FONTS, "titles"),
    ...list("adjust", ADJUSTMENTS, "grade-color"),
    ...ids("velocity", VELOCITY_EFFECTS, "velocity"),
    ...ids("ease", Object.keys(EASES), "camera"),
  ];
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
  const about = !tells(x) ? "" : x.about.length > 90 ? `${x.about.slice(0, 89)}…` : x.about;
  const tags = [x.src, x.note].filter(Boolean).join(", ");
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
const jevChoice = (scene: string, group: Entry[]) =>
  new Promise<[number, Entry][]>((done, fail) => {
    const criteria = Object.fromEntries(
      group.map((x, i) => [`c${i}`, `${x.kind} ${x.cat}: ${x.title}. ${x.about}`.trim()]),
    );
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
      const probs = JSON.parse(out).pick.probabilities as Record<string, number>;
      done(group.map((x, i) => [probs[`c${i}`] ?? 0, x]));
    });
    py.stdin.end(
      JSON.stringify({
        state: `What a film editor is looking for: ${scene}`,
        questions: {
          pick: { type: "choice", instructions: "Which entry fits best?", criteria },
        },
      }),
    );
  });

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

const HELP = `Usage: bun run find <words> [options]     (works from a film folder too, and then also searches the film's own sounds)
       bun run find --show <id[,id]>      everything about one entry: what it does, its settings, a line to paste, how to see it

Finds what a film can name: vault sounds, mocap clips, transitions, camera anims and curves, text and shape voices,
fonts, adjust sliders, beat effects, camera eases. One line per hit: kind/category  id-to-write  length  title —
description  [source], then where that id goes in the film's src/timeline and what to try next.

Options:
  --kind <k[,k]>   sfx, bgm, mc (Minecraft) or sound (all three); mocap; transition anim text shape font adjust velocity ease
  --source <s[,s]> sources (minecraft, earshot, mixkit, mixamo, film-stage/transitions.ts ...; a wrong name lists them)
  -n <N>           hits shown (default 12)
  --all            every take of a sound family on its own line (default: one line per family, "(N takes)")
  --jev            rank by meaning with Jev, a small AI judge that reads any language: 1-3 s, under $0.01 a search. With
                   --kind it reads every entry of those kinds; without, it only reorders the word matches
  --show <id>      the entry in full (ids are the second column; any take of a family)
  mocap by body:   --from <posture> (at its start) --to <posture> (at its end) --has <posture> (anywhere in it)
                   --still (stays within 0.3 m) | --moves, --loop, --dur 1-6 (seconds), --energy 10-40 (deg/s:
                   idle ~10, walk ~30, jump 200). With words or --jev "<scene>"; a wrong posture lists them
  --kind or --source alone lists what it holds (every entry when there are 60 or fewer).

Words first: free, offline, instant, English. Switch to --jev when there are no hits, when the hits miss a word that
matters, or when the cue is a feeling or a moment ("the moment he realises the door is locked") rather than a named thing.
Every vault sound is cleared for YouTube; a row tagged credit needs the author named in the video description. Mixamo
and Quaternius (ual1, ual2) clips are free to use in videos.

Examples:
  bun run find creaky door
  bun run find impact --kind sfx -n 20
  bun run find --kind bgm
  bun run find --jev --kind transition "a memory slipping away"
  bun run find --jev --kind mocap "he searches the floor for something hidden"
  bun run find sit --from stand --to sitFloor
  bun run find --show dissolve`;

const top = (kind: string) => (SOUND.includes(kind) ? kind : (kind.split("-")[0] ?? kind));
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
  const max = word.length >= 8 ? 2 : 1;
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

// What to do when nothing in the vault fits, for the kinds asked
const MAKE_SOUND =
  "a sound: source a recording with the real-sound skill or make one with the earshot skill, into the film's sound/sfx/ with a SOURCES.json credit";
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

// Postures the catalogue measured (stand, kneel, sitFloor ...) and the hint that lists them
const postures = (pool: Entry[]) =>
  [...new Set(pool.flatMap((x) => (x.kind === "mocap" ? (x.data?.seq ?? []) : [])))].toSorted();
const mocapNext = (pool: Entry[]) =>
  `mocap: one clip in full (its timeline, where it leaves him): bun run find --show <id>. By body: add --from <posture> --to <posture> --has <posture> --still|--moves --loop --dur 1-6 --energy 10-40${postures(pool).length ? ` (postures: ${postures(pool).join(" ")})` : ""}`;

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

function detail(x: Entry): string[] {
  const d = x.data ?? {},
    side = x.kind.split("-")[1] ?? "in",
    dir = timelineDir();
  const out: string[] = [];
  const use = (file: string, json: string) => out.push(`use: ${dir}/${file} ${json}`);
  if (SOUND.includes(x.kind)) {
    const takes = d.takes ?? [];
    if (takes.length > 1)
      out.push(`takes: ${takes.join(", ")} (vary a repeated sound across them)`);
    if (d.license) out.push(`licence: ${d.license}${d.url ? `  ${d.url}` : ""}`);
    if (d.peaks?.length) out.push(`loudness: ${envelope(d.peaks)}`);
    use(
      "audio.json",
      x.kind === "bgm"
        ? `beds[]: {"name": "${x.id}", "from": 0, "to": ${num(x.secs) ?? 10}, "gain": 0, "fadeIn": 1, "fadeOut": 1}  (gain in dB; + "start", "duck", "pan"; a bed shorter than its span loops)`
        : `sfx[]: {"at": <scene seconds, not heard: bun run at <heard s> gives the scene second>, "name": "${x.id}", "gain": 0}  (gain in dB; + "rate", "pitch", "reverse", "fadeIn", "fadeOut")`,
    );
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
  } else if (x.kind === "ease") {
    const f = (EASES as Record<string, (t: number) => number>)[x.id];
    if (f)
      out.push(
        `curve: at 25%, 50%, 75% of the time it has gone ${[0.25, 0.5, 0.75].map((t) => f(t).toFixed(2)).join(", ")}`,
      );
    use("cam.json", `a key: "ease": "${x.id}"  (the move into that key)`);
  } else out.push(`use: ${dir}/${useOf(x.kind)}`);
  return out;
}

function show(ids: string[], pool: Entry[]) {
  return ids
    .map((id) => {
      let low = id.toLowerCase();
      // A mocap clip named without its library (Walking_1 for mixamo/Walking_1), when only one library has it
      const bare = pool.filter((x) => x.id.toLowerCase().endsWith(`/${low}`));
      if (!pool.some((x) => x.id.toLowerCase() === low) && bare.length === 1)
        low = bare[0]!.id.toLowerCase();
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
      return [
        ...shared,
        ...hits.map((x) =>
          [
            line(x),
            ...(x.about && !line(x).includes(x.about) ? [`about: ${x.about}`] : []),
            ...detail(x),
          ].join("\n"),
        ),
      ].join("\n\n");
    })
    .concat("after pasting it in: bun run check (in the film) says whether the file still fits")
    .join("\n\n");
}

type Judge = (scene: string, pool: Entry[]) => Promise<[number, Entry][]>;
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
  "-n": "-n 20",
  "--show": "--show dissolve",
};
// catalog.py's body filters, passed through as they are; a value-less one is a switch
const BODY: Record<string, string | null> = {
  "--from": "--from stand",
  "--to": "--to sitFloor",
  "--has": "--has kneel",
  "--dur": "--dur 1-6",
  "--energy": "--energy 10-40",
  "--still": null,
  "--moves": null,
  "--loop": null,
};
Object.assign(OPTIONS, BODY);
const isOption = (a: string) => /^--?[a-z]/i.test(a);
function parse(argv: string[]) {
  const set = new Map<string, string>(),
    rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!isOption(arg)) {
      rest.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (!(name in OPTIONS))
      throw new FindError(
        `Unknown option ${name}. Options: --kind --source -n --all --jev --show --help; mocap by body: ${Object.keys(BODY).join(" ")}`,
      );
    const example = OPTIONS[name];
    if (!example) {
      if (eq > 0) throw new FindError(`${name} takes no value: write ${name} alone`);
      set.set(name, "");
      continue;
    }
    const v = eq > 0 ? arg.slice(eq + 1) : argv[i + 1];
    if (v === undefined || v === "" || isOption(v))
      throw new FindError(`${name} needs a value, e.g. ${example}`);
    if (eq < 0) i++;
    if (set.has(name))
      throw new FindError(
        `${name} given twice; give it once${name === "--kind" || name === "--source" ? `, with a comma list for several: ${name} ${set.get(name)},${v}` : ""}`,
      );
    set.set(name, v);
  }
  return { set, query: rest.join(" ").trim() };
}

export async function run(
  argv: string[],
  given?: Entry[],
  judge: Judge = jevRank,
  clips: Catalog = catalog,
): Promise<string> {
  const { set, query } = parse(argv);
  const all = set.has("--all"),
    jev = set.has("--jev");
  const list = (v?: string) => v?.toLowerCase().split(",").filter(Boolean);
  const kinds = list(set.get("--kind")),
    sources = list(set.get("--source"));
  const nRaw = set.get("-n");
  if (nRaw !== undefined && !/^[1-9]\d*$/.test(nRaw))
    throw new FindError("-n takes a whole number of hits, 1 or more, e.g. -n 20");
  const n = Number(nRaw ?? 12);
  if (set.has("--help") || set.has("-h")) return HELP;
  if (query.toLowerCase() === "help" && set.size === 0) return HELP;
  const showIds = set.get("--show")?.split(",").filter(Boolean);
  if (showIds && !showIds.length) throw new FindError("--show needs an id, e.g. --show dissolve");
  if (showIds) {
    if (query || set.size > 1 + (nRaw ? 1 : 0))
      throw new FindError(
        `--show takes ids only (a comma list for several: --show dissolve,push); drop ${[query, ...[...set.keys()].filter((k) => k !== "--show" && k !== "-n")].filter(Boolean).join(" ")}`,
      );
    return show(showIds, given ?? allEntries(false));
  }
  const catalogSays = async (args: string[], clipPool: Entry[]) => {
    try {
      return `${await clips([...args, "-n", `${n}`])}\n\nwhere (in ${timelineDir()}/): ${USE.mocap}\nnext: ${mocapNext(clipPool)}`;
    } catch (err) {
      return `the mocap catalogue failed: ${(err as Error).message}. Words alone still work: bun run find --kind mocap <words>`;
    }
  };
  const body = Object.keys(BODY).filter((o) => set.has(o));
  if (body.length) {
    const clipPool = (given ?? allEntries()).filter((x) => x.kind === "mocap");
    if (kinds && kinds.join() !== "mocap")
      throw new FindError(
        `${body.join(" ")} filter mocap clips by the body; use --kind mocap or no --kind`,
      );
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
      if (o === "--dur" || o === "--energy") {
        const [lo, hi, extra] = v
          .split("-")
          .map((x) => (/^\d+(?:\.\d+)?$/.test(x) ? Number(x) : NaN));
        if (extra !== undefined || !(lo! <= hi!))
          throw new FindError(
            o === "--dur"
              ? `--dur takes min-max seconds, low first, e.g. --dur 1-6 (3-3 for exactly 3); got ${v}`
              : `--energy takes min-max mean joint speed in deg/s, low first, e.g. --energy 10-40 (calm idle ~10, walk ~30, jump 200); got ${v}`,
          );
        return [o, v];
      }
      if (v.includes(","))
        throw new FindError(
          `${o} takes one posture (a clip starts and ends in one), not a list: ${v}`,
        );
      const pose = known.find((p) => p.toLowerCase() === v.toLowerCase());
      if (!pose) {
        const close = known.filter(
          (p) =>
            p.toLowerCase().includes(v.toLowerCase()) ||
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
    return catalogSays([...words, ...args, ...libs], clipPool);
  }
  if (!query && !kinds && !sources) {
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
  const entries = sources ? pool.filter((x) => sources.some((s) => fromSource(x, s))) : pool;
  const badSource = sources?.filter((s) => !pool.some((x) => fromSource(x, s)));
  if (badSource?.length)
    throw new FindError(
      `${badSource.includes("this-film") ? "this-film is a film's own sounds: run find from its folder (cd films/<film>). " : ""}Unknown --source ${badSource.join(",")}. Sources: ${tally(
        pool.flatMap((x) => x.src ?? []),
      )
        .split(", ")
        .slice(0, 12)
        .join(", ")}, ... (bun run find --source <one> lists it; film-stage = every preset)`,
    );
  const bad = kinds?.filter((k) => !entries.some((x) => kindMatches(x.kind, k)));
  if (bad?.length)
    throw new FindError(
      sources
        ? `--source ${sources.join(",")} has no ${bad.join(",")}; it has ${counts(entries)}.`
        : `Unknown --kind ${bad.join(",")}. Kinds: ${counts(entries)}, or sound for sfx+bgm+mc. e.g. bun run find door --kind sfx`,
    );
  const inKinds = kinds
    ? entries.filter((x) => kinds.some((k) => kindMatches(x.kind, k)))
    : entries;
  const filters = `${kinds ? ` --kind ${kinds.join(",")}` : ""}${sources ? ` --source ${sources.join(",")}` : ""}`;
  const where = (shown: Entry[]) => {
    const uses = [...new Set(shown.map((x) => useOf(x.kind)))];
    return uses.length ? ["", `where (in ${timelineDir()}/): ${uses.join("\n       ")}`] : [];
  };
  if (!query) {
    if (inKinds.length <= 60 || nRaw) {
      const some = inKinds.slice(0, nRaw ? n : 60);
      return [
        ...(some.length < inKinds.length ? [`first ${some.length} of ${inKinds.length}:`] : []),
        ...some.map((x) => line(x)),
        ...where(some),
        "next: bun run find --show <id> for one in full",
      ].join("\n");
    }
    const cats = new Map<string, string[]>();
    for (const x of inKinds) {
      const key = `${x.kind}${x.cat ? `/${x.cat}` : ""}`;
      cats.set(key, [...(cats.get(key) ?? []), x.id]);
    }
    const big = [...cats].toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const more =
      big.length > 20
        ? [
            `  and ${big.length - 20} smaller: ${big
              .slice(20)
              .map(([k]) => k)
              .join(", ")}`,
          ]
        : [];
    return [
      `${inKinds.length} entries by category (a few ids each):`,
      ...big
        .slice(0, 20)
        .map(
          ([k, xs]) =>
            `  ${k} ${xs.length} (${xs.slice(0, 3).join(", ")}${xs.length > 3 ? "…" : ""})`,
        ),
      ...more,
      `next: bun run find <words>${filters}, or bun run find --show <id>`,
    ].join("\n");
  }

  if (jev && kinds?.length === 1 && kinds[0] === "mocap" && !sources)
    return catalogSays(["--jev", query], pool);

  // Words are matched as English; letters outside it (Vietnamese, emoji aside) would only match stray fragments
  const foreign = /[^a-z]/i.test(query.replace(/[^\p{L}]/gu, ""));
  const ranked = foreign ? [] : rank(entries, query, { kinds });
  // A one-frame mocap clip is a still pose: it never plays the move its name says, so it goes last
  const isStill = (x: Entry) => x.kind === "mocap" && (x.secs ?? 1) < 0.1;
  const matches = [...ranked.filter((x) => !isStill(x)), ...ranked.filter(isStill)];
  const typed = [...new Set(plain(query))].filter((w) => !STOP.has(stem(w)) && !/^\d+$/.test(w));
  const out: string[] = [],
    next: string[] = [];
  let shown: [string, Entry][] | undefined;
  const byMeaning = (kind: string) => `bun run find --jev --kind ${kind} "${query}"`;
  const named = kinds ? [] : [...new Set(typed.flatMap((w) => KIND_NAMED[stem(w)] ?? []))];
  // The kind to hand Jev: the one the words name, else the one most of the hits are
  const guess = () => {
    if (kinds) return kinds.join(",");
    if (named.length) return named.join(",");
    const seen = new Map<string, number>();
    for (const x of matches.slice(0, n)) seen.set(top(x.kind), (seen.get(top(x.kind)) ?? 0) + 1);
    return [...seen].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? "<kind>";
  };
  // Word matches in kinds the --kind left out ("door" is under mc, not sfx)
  const elsewhere = () => {
    if (!kinds || foreign) return "";
    const other = rank(
      entries.filter((x) => !kinds.some((k) => kindMatches(x.kind, k))),
      query,
    );
    return other.length
      ? `other kinds have these words: ${counts(other)} (bun run find ${query}${sources ? ` --source ${sources.join(",")}` : ""})`
      : "";
  };
  if (jev) {
    const jevPool = kinds?.length ? inKinds : matches.slice(0, POOL);
    if (!jevPool.length)
      next.push(
        "--jev without --kind only reorders word matches, and none matched: add --kind <kind>.",
      );
    else {
      try {
        const voted = (await judge(query, jevPool))
          .filter(([p]) => p > 0)
          .sort((a, b) => b[0] - a[0]);
        if (voted.length) {
          out.push(
            `Jev voted among ${jevPool.length} ${kinds?.length ? "entries" : "word matches (add --kind to vote over a whole kind)"}; first column = its share of the vote${voted.length < Math.min(n, jevPool.length) ? `; the other ${jevPool.length - voted.length} got none` : ""}.`,
          );
          shown = voted.slice(0, n).map(([p, x]) => [`${p.toFixed(2)}  `, x]);
          const best = Math.round((voted[0]?.[0] ?? 0) * 100);
          if (best < 50 && kinds?.length === 1 && SOUND.includes(kinds[0]!))
            next.push(
              `also try --kind sound: sfx, bgm and Minecraft together (a door creak may be a Minecraft block sound)`,
            );
          next.push(
            best < 20
              ? `probably not in the vault (the best has only ${best}% of the vote). Make it:`
              : best < 50
                ? `unsure (the best has ${best}% of the vote): several fit about equally, or none does. Compare the top few with --show; if none fits, make it:`
                : `Jev prefers the first (${best}% of the vote). A vote always picks something, so check it with --show; if none fits, make it:`,
            ...make(kinds, entries).map((m) => `  ${m}`),
          );
          const other = elsewhere();
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
    const kindList = kinds ? "" : `   kinds: ${counts(entries)}`;
    const scene = typed.length >= 8;
    if (foreign)
      next.push(
        `words match English names only; Jev reads any language: ${byMeaning(kinds?.join(",") ?? "<kind>")}${kindList}`,
      );
    else if (!best) {
      const known = new Set(inKinds.flatMap(fieldWords));
      const guesses = typed.flatMap((w) => (known.has(stem(w)) ? [] : (closest(w, inKinds) ?? [])));
      const other = elsewhere();
      next.push(
        ...(other ? [other] : []),
        `no entry${kinds ? ` of --kind ${kinds.join(",")}` : ""} has these words${guesses.length ? ` (did you mean: ${guesses.join(", ")}?)` : ""}. By meaning: ${byMeaning(guess())}${kindList}`,
        ...(kinds
          ? []
          : [
              "other words: entries are named plainly (door, impact, whoosh, riser, glitch, hum); Minecraft sounds by mob or block (zombie say, chest open); mocap by action (sit, kneel, look around)",
            ]),
        "if Jev finds nothing either, make it:",
        ...make(kinds, entries).map((m) => `  ${m}`),
      );
    } else if (!jev) {
      const has = new Set(fieldWords(best));
      const missing = typed.filter((w) => !has.has(stem(w)));
      const kind = guess();
      if (kind === "adjust" && missing.length)
        next.push(`top hits are adjust sliders, which lack: ${missing.join(", ")}. ${MAKE_LOOK}`);
      else if (scene) next.push(`this reads like a scene: rank by meaning, ${byMeaning(kind)}`);
      else if (missing.length)
        next.push(
          `no entry has every word (top hit lacks: ${missing.join(", ")}). By meaning: ${byMeaning(kind)}`,
        );
    }
    if (named.length)
      next.push(`your words name a kind: add --kind ${named.join(",")} to search only that`);
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
  if (shown.some(([, x]) => x.kind === "mocap")) next.push(mocapNext(pool));
  const files = shown.flatMap(([, x]) =>
    SOUND.includes(x.kind) && x.data?.file ? [soundFile(x.data.file)] : [],
  );
  if (files.length > 1)
    next.push(
      `hear them (you cannot): earshot rank "${query.replaceAll('"', "")}" ${files.join(" ")} --top 3  (about 40 s, its models load each call; describe the sound, not its job; which earshot command for what: bun run skills get core --ref sound)`,
    );
  if (next.length) out.push(`next: ${next.join("\n      ")}`);
  return out.join("\n");
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
