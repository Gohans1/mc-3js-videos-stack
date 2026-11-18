import type { OpenFilmItem } from "./openfilm";

export interface OpenFilmTemplate {
  id: string;
  durationMs: number;
  music?: string;
  clips: {
    at: number;
    track: number;
    clip: {
      src: string;
      time: [number, number];
      attrs?: Record<string, string>;
      overrides?: { at?: string; text?: string; fade?: [number, number] }[];
    };
  }[];
}
export function expandTemplate(
  recipe: OpenFilmTemplate,
  from = 0,
  to = from + recipe.durationMs / 1000,
) {
  const scale = (to - from) / (recipe.durationMs / 1000);
  if (!(scale > 0)) throw new Error("Template range must be positive");
  const slots: { slot: number; from: number; to: number }[] = [];
  const items: Omit<OpenFilmItem, "id">[] = [];
  recipe.clips.forEach(({ clip, at, track }, i) => {
    const [a, b] = clip.time,
      start = from + at * scale,
      end = start + (b - a) * scale;
    if (clip.attrs?.["data-slot"]) {
      slots.push({ slot: Number(clip.attrs["data-slot"]), from: start, to: end });
      return;
    }
    const place = JSON.parse(clip.attrs?.["data-place"] ?? "{}");
    const text: Record<string, string> = {},
      fade = clip.overrides?.find((o) => o.fade)?.fade;
    for (const override of clip.overrides ?? [])
      if (override.at && override.text !== undefined) text[override.at] = override.text;
    items.push({
      asset: `${recipe.id}/clips/${i}`,
      from: start,
      to: end,
      track: 100 - track,
      x: place.x ?? 0.5,
      y: place.y ?? 0.5,
      ...(place.fit && { size: place.fit }),
      rate: 1 / scale,
      offset: a,
      ...(Object.keys(text).length && { text }),
      ...(fade && { fadeIn: fade[0] * scale, fadeOut: fade[1] * scale }),
    });
  });
  return { items, slots, music: recipe.music };
}
