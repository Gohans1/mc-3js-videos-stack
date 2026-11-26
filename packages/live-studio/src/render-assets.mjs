import { statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import { openFilmAssetFile } from "./openfilm.mjs";

export const publicRenderAsset = (project, path) => {
  const root = join(project, "assets/public");
  const file = join(root, path);
  const rel = relative(root, file);
  return rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) ? file : null;
};

export const renderAssetIdentity = (file) => {
  const st = statSync(file, { throwIfNoEntry: false });
  return st?.isFile() ? { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs } : null;
};

export const changedRenderAsset = (project, inputs, current = new Map()) => {
  for (const [path, old] of Object.entries(inputs ?? {})) {
    let file;
    try {
      file = openFilmAssetFile(path) ?? publicRenderAsset(project, path);
    } catch {
      return path;
    }
    if (!file) return path;
    if (!current.has(file)) current.set(file, renderAssetIdentity(file));
    const now = current.get(file);
    if (old?.size !== now?.size || old?.mtimeMs !== now?.mtimeMs || old?.ctimeMs !== now?.ctimeMs)
      return relative(project, file).replaceAll("\\", "/");
  }
  return null;
};
