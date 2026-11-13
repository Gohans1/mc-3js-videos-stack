// Writes client_assets.zip: client.jar without Java code (.class, META-INF), keeping assets/, data/ and root files. The page
// downloads it on every first visit, phones over Tailscale too; mc/ links to the vault's jar/, so it lands beside the jar.
// data/ stays although block-model-renderer never reads from it (every read and listing logged on 2026-11-05): without
// data/minecraft/structure, one wall edge at 18.5 s drew 1 px off (14 pixels, the same on every load). Test any further
// trimming that way: the same frame, jar vs zip, pixel by pixel.
// The files are stored, not deflated, and client_assets.zip.br squeezes the whole zip once (the studio sends it to browsers
// that read brotli): 21k small JSON files deflated one by one keep their repeats, and their 4 MB of zip headers too.
// 7.2 MB on the wire before, 5.2 after; the same files, so the same picture
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
