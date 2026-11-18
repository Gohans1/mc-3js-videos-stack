import { openFilmCatalog } from "./openfilm.mjs";

const PREFIX = {
  transition: "transition",
  look: "filter",
  "text-in": "text/in",
  "text-out": "text/out",
  shape: "sticker",
  sfx: "sound",
  bgm: "sound",
  mc: "sound",
};
export const assetId = (entry) =>
  entry.kind === "asset"
    ? typeof entry.data?.upstreamId === "string"
      ? `openfilm:${entry.data.upstreamId}`
      : undefined
    : PREFIX[entry.kind]
      ? `${PREFIX[entry.kind]}/${entry.id}`
      : undefined;
export const matchesAssetId = (entry, id) =>
  [entry.id, assetId(entry), entry.kind === "asset" ? entry.data?.upstreamId : undefined].some(
    (value) => value?.toLowerCase() === id.toLowerCase(),
  );

export function assetRecipe(entry) {
  const id = assetId(entry);
  if (!id) return undefined;
  const data = entry.data ?? {},
    base = {
      id,
      source: "builtin",
      title: entry.title,
      group: data.group ?? entry.cat,
      about: entry.about,
      sourceFile: entry.src?.replace(/^([^/]+)\//, "packages/$1/src/"),
    };
  if (entry.kind === "asset") {
    const recipe = openFilmCatalog().find((it) => it.id === data.upstreamId);
    return {
      ...(recipe ?? data.definition),
      id,
      source: entry.src,
      kind: entry.cat,
      upstreamId: data.upstreamId,
      sourceFile: data.file,
      sourceAvailable: Boolean(recipe),
    };
  }
  if (["sfx", "bgm", "mc"].includes(entry.kind))
    return {
      ...base,
      source: data.source ?? entry.src ?? "unknown",
      sourceFile: data.file,
      kind: "sound",
      render: "audio",
      durationMs: entry.secs * 1000,
      sound: {
        name: entry.id,
        kind: entry.kind,
        seconds: entry.secs,
        file: data.file,
        license: data.license,
        url: data.url,
        origin: data.origin,
      },
    };
  if (entry.kind === "transition")
    return {
      ...base,
      kind: "transition",
      render: "transition",
      transition: data,
      durationMs: (data.len ?? 0.5) * 1000,
    };
  if (entry.kind === "look") return { ...base, kind: "filter", render: "grade", grade: data.grade };
  if (entry.kind === "shape")
    return { ...base, kind: "sticker", render: "text", item: { kind: entry.id } };
  const side = entry.kind === "text-in" ? "in" : "out";
  return {
    ...base,
    kind: "text",
    render: "text",
    item: { kind: "text", [side]: { fx: entry.id, len: data.len } },
    preset: data,
  };
}

export function assetInfo(entry) {
  const recipe = assetRecipe(entry);
  if (!recipe) return undefined;
  return {
    ...recipe,
    exampleProps:
      recipe.render === "text"
        ? {
            ...(recipe.item.kind === "text" && { text: "Your words" }),
            size: recipe.item.kind === "text" ? 56 : 160,
          }
        : recipe.render === "audio"
          ? { gain: -12 }
          : recipe.kind === "text"
            ? {
                text: Object.fromEntries(
                  (recipe.props ?? [])
                    .filter((p) => p.type === "text" && p.at)
                    .map((p) => [p.at, "Your words"]),
                ),
              }
            : {},
    units:
      recipe.render === "text"
        ? "x/y: 0-1; size: pixels at 1080px short side; rotate: degrees"
        : "HEARD seconds; HTML overlay size: scale; see bun run asset --help for placement controls",
    next: `bun run asset use ${recipe.id} --film films/<name>${recipe.kind === "transition" ? " --shot 1 --from 0 --to 0.5" : " --from 0 --to 3"} --props-file controls.json`,
  };
}

export function resolveAsset(id, entries, source) {
  const matches = entries.filter(
    (entry) =>
      matchesAssetId(entry, id) &&
      (!source ||
        (source === "builtin"
          ? entry.src?.startsWith("film-stage/")
          : entry.src === source ||
            entry.src?.startsWith(`${source}/`) ||
            entry.data?.source === source)),
  );
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? `Ambiguous asset ${id}: use ${matches.map(assetId).join(", ")}`
        : `Unknown asset ${id}; bun run find <words> or bun run find --show <id>`,
    );
  const recipe = assetRecipe(matches[0]);
  if (!recipe)
    throw new Error(`${id} is a code helper; bun run find --show ${id} gives its scene usage`);
  return recipe;
}
