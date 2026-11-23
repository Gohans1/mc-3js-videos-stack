import { say } from "../core/store";
import { stamp } from "../core/time";
import { hitOf, type Role } from "./hit";
import { decoded } from "./mixer";
import { addShots, library, type NewShot } from "./sound";

export const SWEETS: readonly { label: string; parts: readonly (readonly [Role, number])[] }[] = [
  {
    label: "Riser + impact",
    parts: [
      ["riser", 0],
      ["impact", 0],
    ],
  },
  {
    label: "Swell + soft impact",
    parts: [
      ["riser", 1],
      ["impact", 1],
    ],
  },
  {
    label: "Whoosh + impact",
    parts: [
      ["whoosh", 0],
      ["impact", 0],
    ],
  },
  { label: "Quick whoosh", parts: [["whoosh", 1]] },
  {
    label: "Impact + downlifter",
    parts: [
      ["impact", 0],
      ["downlifter", 0],
    ],
  },
];
const LEVEL: Record<Role, number> = { impact: -14, whoosh: -18, riser: -20, downlifter: -24 };
const LONGEST_RISE = 3;

export const hasSweeteners = () => library.some((x) => x.role);

export const sweeten = async (cut: number, preset: number) => {
  const { label, parts } = SWEETS[preset];
  const picked = parts.map(([role, k]) => {
    const all = library.filter((x) => x.role === role);
    return { role, item: all[k] ?? all[0] };
  });
  const missing = picked.filter((p) => !p.item).map((p) => p.role);
  if (missing.length) {
    say(
      `This film has no ${missing.join(" or ")} sound yet: ask the AI to fetch the cut sweeteners`,
    );
    return;
  }
  const shots: NewShot[] = [];
  for (const { role, item } of picked) {
    const buf = await decoded(item.name);
    if (!buf) {
      say(`${item.name} couldn't be loaded, so nothing was added`);
      return;
    }
    const { at: hit, loudest } = hitOf(
      role,
      Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)),
      buf.sampleRate,
    );
    let start = role === "riser" ? Math.max(0, hit - LONGEST_RISE) : 0,
      at = cut - (hit - start);
    let length = role === "riser" ? hit - start : undefined;
    if (at < 0) {
      start -= at;
      if (length !== undefined) length += at;
      at = 0;
    }
    shots.push({
      name: item.name,
      at,
      gain: Math.round((LEVEL[role] - loudest) * 10) / 10,
      start,
      length,
      fadeOut: role === "riser" ? 0.01 : undefined,
    });
  }
  addShots(shots);
  say(`${label} on the cut at ${stamp(cut)}. Ctrl+Z to undo`);
};
