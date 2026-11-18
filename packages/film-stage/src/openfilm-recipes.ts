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
import type { OpenFilmRecipe } from "./openfilm";

export function resolveOpenFilmRecipe(
  id: string,
  recipes: readonly OpenFilmRecipe[],
  width = 1920,
  height = 1080,
): OpenFilmRecipe | undefined {
  const scale = 1920 / Math.max(width, height);
  return (
    recipes.find((r) => r.id === id) ??
    (/^\/(?!\/)[^?#]*\.html(?:[?#].*)?$/.test(id)
      ? {
          id,
          title: id.split("/").pop()!,
          cat: "page",
          group: "This film",
          render: "page",
          url: id,
          w: Math.round(width * scale),
          h: Math.round(height * scale),
          fit: 1,
        }
      : undefined)
  );
}
