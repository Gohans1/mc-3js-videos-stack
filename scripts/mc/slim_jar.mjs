import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { brotliCompressSync, constants as Z } from "node:zlib";

import { unzipSync, zipSync } from "fflate";

const fresh = (file, than) => existsSync(file) && statSync(file).mtimeMs >= statSync(than).mtimeMs;

export function slimJar({ mcDir = join(process.cwd(), "assets/public/mc"), force = false } = {}) {
  const jar = join(mcDir, "client.jar"),
    out = join(mcDir, "client_assets.zip"),
    br = `${out}.br`;
  if (!force && fresh(out, jar) && fresh(br, out)) {
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

  const zip = zipSync(kept, { level: 0 });
  writeFileSync(`${out}.new`, zip);
  renameSync(`${out}.new`, out);
  // written after the zip, so it is the newer of the two (the studio sends it only then)
  const squeezed = brotliCompressSync(zip, {
    params: {
      [Z.BROTLI_PARAM_QUALITY]: 11,
      [Z.BROTLI_PARAM_LGWIN]: 24,
      [Z.BROTLI_PARAM_SIZE_HINT]: zip.length,
    },
  });
  writeFileSync(`${br}.new`, squeezed);
  renameSync(`${br}.new`, br);
  const mb = (n) => (n / 1e6).toFixed(1);
  console.log(
    `${out}: ${mb(zip.length)} MB stored, ${mb(squeezed.length)} MB as .br on the wire (jar ${mb(statSync(jar).size)} MB)`,
  );
}

if (import.meta.main) {
  const { cliArgs } = await import("../../packages/live-studio/src/cli.mjs");
  cliArgs(
    `Build a slim Minecraft asset ZIP and Brotli copy from a prepared game JAR.
  bun scripts/mc/slim_jar.mjs [--mc-dir DIR] [--force]
Default directory: assets/public/mc in the current film or repo.
Writes slim ZIP/.br caches; --force rebuilds existing output. No downloads.`,
    ["--mc-dir DIR", "--force"],
    0,
  );
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
