import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MEDIA_HOME = resolve(
  process.env.MC_MEDIA_HOME || fileURLToPath(new URL("../../vault/tools/media", import.meta.url)),
);

export const mediaPython = (id) =>
  join(MEDIA_HOME, id, "env", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
