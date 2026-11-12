// Writes client_assets.zip: client.jar without Java code (.class, META-INF), keeping assets/, data/ (including
// data/minecraft/structure so block wall edges match client.jar pixel-for-pixel) and root files.
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { unzipSync, zipSync } from "fflate";

export function slimJar({ mcDir = join(process.cwd(), "assets/public/mc"), force = false } = {}) {
  const jar = join(mcDir, "client.jar"),
    out = join(mcDir, "client_assets.zip");
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(jar).mtimeMs && !force) {
    try {
      unzipSync(readFileSync(out));
    } catch {
      throw new Error(`Corrupt ${out}; --force to rebuild`);
    }
    console.log("client_assets.zip verified; --force to rebuild");
    return;
  }

  const kept = unzipSync(readFileSync(jar), {
    filter: (f) =>
      !f.name.endsWith("/") &&
      !f.name.endsWith(".class") &&
      !f.name.startsWith("META-INF/") &&
      (f.name.startsWith("assets/") || f.name.startsWith("data/") || !f.name.includes("/")),
  });

  const tmp = `${out}.new`;
  writeFileSync(tmp, zipSync(kept, { level: 6 }));
  renameSync(tmp, out);
  console.log(
    `${out}: ${(statSync(out).size / 1e6).toFixed(1)} MB (jar ${(statSync(jar).size / 1e6).toFixed(1)} MB)`,
  );
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { "mc-dir": { type: "string" }, force: { type: "boolean", default: false } },
  });
  try {
    slimJar({
      mcDir: values["mc-dir"] ? resolve(values["mc-dir"]) : undefined,
      force: values.force,
    });
  } catch (e) {
    console.error(e.message ?? e);
    process.exit(1);
  }
}
