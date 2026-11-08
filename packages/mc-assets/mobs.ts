// Mirrors MineRender's mob dataset into the vault (vault.json "root" + /mcasset/<version>): every entity model, its
// sampled vanilla clips and every entity texture, walked through the _list.json each folder of assets.mcasset.cloud has.
// mc-actor/mob.ts reads them from there, so renders never wait on the network. Mojang files: the vault only, never git.
// Re-runnable: files already there are skipped, so a cut run picks up where it stopped.
// bun packages/mc-assets/mobs.ts [version]   (default 1.21.11, the dataset MineRender 2.1 ships against)
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const VERSION = process.argv[2] ?? "1.21.11";
const ROOT = resolve(import.meta.dir, "../..");
const vault = resolve((await Bun.file(join(ROOT, "vault.json")).json()).root);
const OUT = join(vault, "mcasset", VERSION);
const CLOUD = `https://assets.mcasset.cloud/${VERSION}`;
const TREES = ["entity-models", "assets/minecraft/textures/entity"];

async function get(path: string, tries = 3): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${CLOUD}/${path}`, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return r;
      if (r.status === 404) return null;
    } catch {}
    await Bun.sleep(1000 * (i + 1));
  }
  throw new Error(`gave up on ${path}`);
}

// listings are always fetched fresh (a folder may have grown); files only when missing
const files: string[] = [];
async function walk(dir: string) {
  const r = await get(`${dir}/_list.json`);
  if (!r) return;
  const text = await r.text();
  await Bun.write(join(OUT, dir, "_list.json"), text);
  const { directories = [], files: names = [] } = JSON.parse(text);
  for (const f of names) files.push(`${dir}/${f}`);
  for (const d of directories) await walk(`${dir}/${d}`);
}
for (const t of TREES) await walk(t);

const todo = files.filter((f) => !existsSync(join(OUT, f)));
console.log(`${files.length} files listed, ${files.length - todo.length} already in ${OUT}, fetching ${todo.length}`);
let done = 0, bytes = 0;
const worker = async () => {
  for (let f; (f = todo.shift()); ) {
    const r = await get(f);
    if (!r) { console.log(`404 ${f}`); continue; }
    const buf = new Uint8Array(await r.arrayBuffer());
    mkdirSync(dirname(join(OUT, f)), { recursive: true });
    await Bun.write(join(OUT, f), buf);
    bytes += buf.length;
    if (++done % 200 === 0) console.log(`${done} fetched, ${(bytes / 1e6).toFixed(1)} MB`);
  }
};
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`done: ${done} fetched, ${(bytes / 1e6).toFixed(1)} MB`);
