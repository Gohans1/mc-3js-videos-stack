import { lstat, readdir, realpath } from "node:fs/promises";
import { extname, resolve } from "node:path";

export type PropScope = "global" | "film";
type PropPreview = { path: string; version: string };
export type PropEntry = { id: string; image?: PropPreview; model?: PropPreview; source?: string };
export type PropCatalog = Record<PropScope, PropEntry[]>;

const mediaTypes = new Map([
  [".avif", "image/avif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".glb", "model/gltf-binary"],
]);

const validSegment = (segment: string) =>
  segment.length > 0 &&
  !segment.startsWith(".") &&
  !/[\\:]/.test(segment) &&
  !segment.includes("\0");

const missing = (error: unknown) =>
  ["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException)?.code ?? "");

export function openPropLibrary(project: string, vault: string) {
  const rootOf = async (scope: PropScope) => {
    try {
      const base = await realpath(scope === "global" ? vault : project);
      const root = scope === "global" ? resolve(base, "props") : resolve(base, "src", "props");
      return (await realpath(root)) === root && (await lstat(root)).isDirectory() ? root : null;
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  };

  const list = async (scope: PropScope) => {
    const root = await rootOf(scope);
    if (!root) return [];
    const entries = new Map<string, PropEntry>();
    const visit = async (parts: string[]) => {
      const dir = resolve(root, ...parts);
      let files;
      try {
        if ((await realpath(dir)) !== dir) return;
        files = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (missing(error)) return;
        throw error;
      }
      files.sort((a, b) => a.name.localeCompare(b.name));
      for (const file of files) {
        if (!validSegment(file.name)) continue;
        const next = [...parts, file.name];
        if (file.isDirectory()) {
          await visit(next);
          continue;
        }
        if (!file.isFile()) continue;
        const ext = extname(file.name);
        const lower = ext.toLowerCase();
        const mime = mediaTypes.get(lower);
        const source =
          [".ts", ".tsx"].includes(lower) && !file.name.toLowerCase().endsWith(".d.ts");
        if (!mime && !source) continue;
        const path = next.join("/");
        const id = path.slice(0, -ext.length);
        const entry = entries.get(id) ?? { id };
        if (source) {
          entry.source ??= path;
        } else {
          const kind = lower === ".glb" ? "model" : "image";
          if (entry[kind]) continue;
          try {
            const info = await lstat(resolve(dir, file.name));
            if (!info.isFile()) continue;
            entry[kind] = { path, version: info.mtimeMs + "-" + info.size };
          } catch (error) {
            if (missing(error)) continue;
            throw error;
          }
        }
        entries.set(id, entry);
      }
    };
    await visit([]);
    return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  };

  return {
    async catalog(): Promise<PropCatalog> {
      const [global, film] = await Promise.all([list("global"), list("film")]);
      return { global, film };
    },
    async preview(scope: string | undefined, path: string | undefined) {
      if ((scope !== "global" && scope !== "film") || !path) return null;
      const parts = path.split("/");
      const type = mediaTypes.get(extname(path).toLowerCase());
      if (!type || !parts.every(validSegment)) return null;
      const root = await rootOf(scope);
      if (!root) return null;
      const file = resolve(root, ...parts);
      try {
        if ((await realpath(file)) !== file || !(await lstat(file)).isFile()) return null;
        return { file, type };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
  };
}
