import { listToonExpressions } from "../../packages/mc-actor/src/toon-catalog";
import { FEELINGS } from "../../packages/mc-actor/src/toon-expressions";
import { MARKS } from "../../packages/mc-actor/src/toon-shapes";
import type { Entry } from "../find";

const aliases: Partial<Record<string, string[]>> = {
  angry: ["giận", "tức giận", "nổi giận"],
  furious: ["extremely mad", "pissed beyond words", "rất giận"],
  pouty: ["mad and sulking", "pissed but quiet", "dỗi vì giận"],
  tantrum: ["mad outburst", "pissed and yelling", "giận ăn vạ"],
  smile: ["cười", "vui", "mỉm cười"],
  sad: ["buồn", "buồn bã"],
  scared: ["sợ", "sợ hãi"],
  surprised: ["ngạc nhiên", "bất ngờ"],
  confused: ["bối rối", "khó hiểu"],
  embarrassed: ["xấu hổ", "ngượng"],
  "forced-smile": ["cười gượng", "nervous smile"],
  straining: ["gồng sức", "gồng"],
  "holding-breath": ["nín thở"],
  breathless: ["thở dốc", "hụt hơi"],
};

const marks: Record<keyof typeof MARKS, [string, ...string[]]> = {
  blush: ["Rosy cheeks with hatching at higher strength.", "blushing", "pink cheeks"],
  pale: ["Pale blue wash across a frightened face.", "pallor", "turn pale"],
  sick: ["Green wash across a nauseated face.", "green face", "nausea"],
  gloom: ["Dark vertical shading across the upper face.", "gloom lines", "manga shadow"],
  "puffed-cheeks": ["Curved cheek outlines for holding breath or a full mouth.", "cheeks puff up"],
  bags: ["Shadows beneath tired eyes.", "undereye bags", "dark circles"],
  tears: ["Tear trails under both eyes, widening at higher strength.", "teardrops", "crying streams"],
  sweat: ["One sweat drop beside the brow.", "manga sweat drop", "nervous sweat"],
  vein: ["Comic anger vein drawn on the forehead.", "forehead anger vein", "anger cross"],
  drool: ["Saliva at the mouth corner.", "drooling", "saliva"],
  question: ["Question marks floating beside the head.", "question mark above head", "manga confusion mark", "dấu hỏi trên đầu"],
  exclaim: ["Exclamation mark beside the head.", "exclamation mark above head", "alert punctuation"],
  zzz: ["Floating sleep letters.", "sleep symbols above head", "snoring letters"],
  steam: ["Puffs of steam around the head.", "angry steam", "steam from ears"],
  hearts: ["Floating hearts around the head.", "hearts above head", "love symbols"],
  notes: ["Floating musical notes.", "music notes above head", "singing symbols"],
  idea: ["Lightbulb over the character.", "light bulb above head", "eureka symbol"],
  lines: ["Short strokes thrown out from the head at a startle.", "surprise lines", "shock lines"],
  anger: ["Floating comic anger cross.", "anger symbol above head", "manga anger mark"],
  panic: ["Sweat and short impact marks flung outward.", "panic marks", "flying sweat"],
  dots: ["Ellipsis beside the head for a silent pause.", "ellipsis above head", "three dots"],
  sparkles: ["Bright floating twinkles.", "sparkles around head", "shining stars"],
  cloud: ["A gloomy cloud above the head.", "rain cloud above head", "gloom cloud"],
  soul: ["A cartoon spirit drifting away from the head.", "soul leaving body", "ghost reaction"],
  stars: ["Little stars orbiting the head.", "seeing stars", "dizzy stars"],
  heartbreak: ["A floating broken heart.", "broken heart above head", "heartbreak symbol"],
  sigh: ["A small air puff at the side of the face.", "sigh puff", "breath puff"],
  thought: ["A bubble floating beside the head.", "thought bubble above head", "daydream bubble"],
  shiver: ["Wavy lines to signal a shiver.", "shivering lines", "cold shake marks"],
};

export type FaceResult = {
  name: string;
  type: "preset" | "ramp" | "mark";
};

export const faceEntry = (entry: Entry): FaceResult | undefined => {
  if (entry.kind !== "face") return undefined;
  const [, type, name] = entry.id.split("/");
  if ((type === "ramp" || type === "mark") && name) return { name, type };
  if (type && !name) return { name: type, type: "preset" };
};

export const foldFaceWords = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");

export const faceAliases = (entry: Entry): string[] =>
  entry.kind === "face" && Array.isArray(entry.data?.aliases) ? entry.data.aliases : [];

export function faceEntries(): Entry[] {
  const presets = listToonExpressions().map((info) => ({
    kind: "face",
    id: `face/${info.name}`,
    cat: info.group,
    title: info.name.replaceAll("-", " "),
    about: info.description,
    src: "mc-actor/toon-expressions.ts",
    data: { aliases: [...info.aliases, ...(aliases[info.name] ?? [])] },
  }));
  const ramps = Object.entries(FEELINGS).map(([name, stops]) => ({
    kind: "face",
    id: `face/ramp/${name}`,
    cat: "ramp",
    title: `${name} intensity ramp`,
    about: `Blend from neutral through ${stops.join(", ")}.`,
    src: "mc-actor/toon-expressions.ts",
    data: { aliases: [`${name} intensity`, `${name} ramp`] },
  }));
  const symbols = Object.entries(MARKS).map(([name, mark]) => {
    const [about, ...aliases] = marks[name] ?? [`Toon mark drawn ${mark.at} the face.`];
    return {
      kind: "face",
      id: `face/mark/${name}`,
      cat: "mark",
      title: `${name.replaceAll("-", " ")} mark`,
      about,
      src: "mc-actor/toon-shapes.ts",
      data: { aliases },
    };
  });
  return [...presets, ...ramps, ...symbols];
}

export function faceDetails(entry: Entry, recipe: FaceResult): string[] {
  const { name, type } = recipe;
  const quote = JSON.stringify(name);
  const levels = ["light", "medium", "strong"];
  const lines = [`category: ${entry.cat}`];
  const aliases = faceAliases(entry);
  if (aliases.length) lines.push(`aliases: ${aliases.join(", ")}`);
  if (type === "mark") {
    lines.push(
      `layer: ${MARKS[name]?.at}`,
      `use: wear.set({ from: "neutral", extras: { [${quote}]: 1 } })`,
    );
  } else if (type === "ramp") {
    lines.push(
      `rungs: ${FEELINGS[name]?.map((stop, i) => `${levels[i]} = ${stop}`).join(" · ")}`,
      `use: wear.set(feel(${quote}, 0.6))`,
      `timeline: face.json actor[] { "t": 3.2, "face": ${quote}, "k": 0.6 }`,
    );
  } else {
    const ramps = Object.entries(FEELINGS).flatMap(([family, stops]) =>
      stops.flatMap((stop, i) => stop === name ? [`${family} (${levels[i]})`] : []),
    );
    if (ramps.length) lines.push(`ramp: ${ramps.join(", ")}`);
    lines.push(
      `use: wear.set(${quote})`,
      `timeline: face.json actor[] { "t": 3.2, "face": ${quote} }`,
    );
  }
  lines.push(
    'setup: import { wearToonFace, feel } from "mc-actor/toon-face"; const wear = wearToonFace(player);',
    "custom faces: bun run skills get core --ref film",
  );
  return lines;
}
