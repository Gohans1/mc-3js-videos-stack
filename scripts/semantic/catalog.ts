import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import type { Entry } from "../find";
import { ROOT } from "../vault.mjs";
import type { Asset } from "./store";

export const assetKey = (entry: Pick<Entry, "kind" | "id" | "src" | "data">) => {
  const pack = entry.kind === "block" || entry.kind === "item" ? entry.data?.pack : undefined;
  return JSON.stringify([
    entry.kind,
    typeof pack === "string" ? pack : (entry.src ?? ""),
    entry.id,
  ]);
};
export const assetFile = (entry: Entry, root = ROOT) => {
  const raw = typeof entry.data?.file === "string" ? entry.data.file : "";
  return raw ? resolve(entry.src === "this-film" ? process.cwd() : root, raw) : "";
};
const mediaKind = (file: string): "audio" | "video" | "image" | null => {
  const extension = extname(file).toLowerCase();
  if ([".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".m4a", ".opus"].includes(extension))
    return "audio";
  if ([".mp4", ".mov", ".webm", ".mkv"].includes(extension)) return "video";
  if ([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".avif", ".heic", ".heif"].includes(extension))
    return "image";
  return null;
};
export const assetFromEntry = (entry: Entry, root = ROOT): Asset => {
  let file = assetFile(entry, root);
  if (!mediaKind(file) && typeof entry.data?.preview === "string" && existsSync(entry.data.preview))
    file = entry.data.preview;
  if (!mediaKind(file) && entry.src === "openfilm" && typeof entry.data?.upstreamId === "string") {
    const folder = resolve(root, "vault/openfilm/library", entry.data.upstreamId);
    const preview = [join(folder, "preview.mp4"), join(folder, "poster.jpg")].find(existsSync);
    if (preview) file = preview;
  }
  const kind = file ? mediaKind(file) : null;
  const heard = Array.isArray(entry.data?.heard)
    ? entry.data.heard.filter((x) => typeof x === "string").join("; ")
    : "";
  const tags = Array.isArray(entry.data?.tags)
    ? entry.data.tags.filter((x) => typeof x === "string").join(", ")
    : "";
  return {
    key: assetKey(entry),
    title: entry.title || entry.id,
    text: [
      entry.kind,
      entry.cat,
      entry.about && `Description or intended use: ${entry.about}`,
      heard && `Heard: ${heard}`,
      tags,
    ]
      .filter(Boolean)
      .join(". "),
    ...(kind && {
      media: { kind, file },
    }),
  };
};
export const readManifest = (file: string): Asset[] => {
  if (statSync(file).size > 64 * 1024 * 1024) throw new Error("Manifest exceeds 64 MB");
  const input: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(input))
    throw new Error("Manifest must be an array of {key,title,text,media?}");
  const keys = new Set<string>();
  return input.map((row: unknown, i) => {
    if (!row || typeof row !== "object") throw new Error(`Invalid manifest row ${i}`);
    const data = row as Record<string, unknown>;
    if (
      typeof data.key !== "string" ||
      !data.key.trim() ||
      data.key === "?query" ||
      data.key.length > 2048 ||
      typeof data.title !== "string" ||
      !data.title.trim() ||
      typeof data.text !== "string"
    )
      throw new Error(`Invalid key/title/text in manifest row ${i}`);
    if (keys.has(data.key)) throw new Error(`Duplicate asset key: ${data.key}`);
    keys.add(data.key);
    let media: Asset["media"];
    if (data.media !== undefined) {
      const m = data.media as Record<string, unknown> | null;
      if (
        !m ||
        !["audio", "video", "image"].includes(String(m.kind)) ||
        typeof m.file !== "string" ||
        !m.file.trim() ||
        /^[a-z]+:\/\//i.test(m.file)
      )
        throw new Error(`Media must name a local audio/video/image file in row ${i}`);
      media = { kind: m.kind as "audio" | "video" | "image", file: resolve(dirname(file), m.file) };
    }
    return { key: data.key, title: data.title, text: data.text, ...(media && { media }) };
  });
};
export const readiness = (assets: Asset[]) => {
  const missing = assets.filter(
    (asset) =>
      asset.media && (!existsSync(asset.media.file) || !statSync(asset.media.file).isFile()),
  );
  return {
    assets: assets.length,
    textOnly: assets.filter((a) => !a.media).length,
    audio: assets.filter((a) => a.media?.kind === "audio").length,
    image: assets.filter((a) => a.media?.kind === "image").length,
    video: assets.filter((a) => a.media?.kind === "video").length,
    missingMedia: missing.length,
    examples: missing.slice(0, 20).map((a) => ({ key: a.key, file: a.media!.file })),
    note: "Catalog only, not every raw vault file. No embedding requests or vector writes in this plan.",
  };
};
