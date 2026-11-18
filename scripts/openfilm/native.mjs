import { existsSync, readFileSync } from "node:fs";

import { readCatalog, safePath } from "./catalog.mjs";
export { expandTemplate } from "../../packages/film-stage/src/openfilm-recipes.ts";

export function nativeCatalog(root, items = readCatalog(root)) {
  return items
    .filter((item) => !["sound", "music"].includes(item.cat))
    .map((original) => {
      const file =
        original.kind === "page" ? null : safePath(root, `_definitions/${original.id}.json`);
      const item = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : original;
      if (item.id !== original.id)
        throw new Error(`Definition ID differs from its catalog entry: ${original.id}`);
      const recipe = { ...item, title: item.name.en, render: item.kind };
      if (item.kind === "page") {
        recipe.path = `${item.id}/files/${item.src}`;
        const saved = item.id.startsWith("stickers/emoji/")
          ? {}
          : JSON.parse(readFileSync(safePath(root, `${item.id}/saved.json`), "utf8"));
        recipe.props = JSON.parse(saved.clip?.attrs?.["data-props"] ?? "[]");
        recipe.clip = saved.clip;
      } else if (["textstyle", "textmotion"].includes(item.kind)) {
        recipe.render = "page";
        recipe.path = "text/text/files/text.html";
        recipe.props = [
          { name: "Text", type: "text", at: ".t" },
          { name: "Color", type: "var", var: "--color" },
          { name: "Font", type: "var", var: "--font" },
        ];
      } else if (item.kind === "group") {
        const saved = JSON.parse(readFileSync(safePath(root, `${item.id}/saved.json`), "utf8"));
        recipe.clips = saved.clips;
        recipe.children = saved.clips.flatMap(({ clip }, i) =>
          clip.attrs?.["data-slot"]
            ? []
            : [
                {
                  id: `${item.id}/clips/${i}`,
                  title: `${item.name.en} / ${clip.src}`,
                  cat: clip.attrs?.["data-place"] ? "text" : "effect",
                  group: item.group,
                  render: "page",
                  path: `${item.id}/files/${clip.src}`,
                  w: clip.size?.w,
                  h: clip.size?.h,
                  durationMs: (clip.time?.[1] ?? 3) * 1000,
                  props: JSON.parse(clip.attrs?.["data-props"] ?? "[]"),
                },
              ],
        );
      }
      if (!["page", "motion", "fade", "look", "group"].includes(recipe.render))
        throw new Error(`No native renderer for ${item.id} (${item.kind})`);
      return recipe;
    });
}

const clamp = (x) => Math.max(0, Math.min(1, x));
const rounded = (x) => Math.round(x * 1000) / 1000;
const at = (table, x) => {
  if (!table?.length) return x;
  if (table.length === 1) return table[0];
  const p = clamp(x) * (table.length - 1),
    i = Math.min(table.length - 2, Math.floor(p));
  return table[i] + (table[i + 1] - table[i]) * (p - i);
};

export function gradePixel(grade, rgb) {
  const mix = grade.mix;
  let c =
    mix?.length === 12
      ? [0, 1, 2].map((r) =>
          clamp(rgb.reduce((v, x, j) => v + x * rounded(mix[r * 4 + j]), rounded(mix[r * 4 + 3]))),
        )
      : [...rgb];
  if (grade.sat !== undefined) {
    const s = rounded(grade.sat),
      l = c[0] * 0.213 + c[1] * 0.715 + c[2] * 0.072;
    c = c.map((x) => clamp(l + (x - l) * s));
  }
  if (!grade.all && !grade.r && !grade.g && !grade.b) return c;
  return c.map((x, i) => {
    const own = grade[["r", "g", "b"][i]];
    const table = Array.from({ length: 17 }, (_, n) =>
      rounded(clamp(at(own, at(grade.all, n / 16)))),
    );
    return at(table, x);
  });
}

export function makeCube(grade, name, size = 33) {
  const rows = [
    `TITLE ${JSON.stringify(name)}`,
    `LUT_3D_SIZE ${size}`,
    "DOMAIN_MIN 0 0 0",
    "DOMAIN_MAX 1 1 1",
  ];
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++)
        rows.push(
          gradePixel(grade, [r / (size - 1), g / (size - 1), b / (size - 1)])
            .map((x) => +x.toFixed(6))
            .join(" "),
        );
  return rows.join("\n") + "\n";
}
