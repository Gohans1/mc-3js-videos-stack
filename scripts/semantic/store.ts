import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { documentText, type Embedding, hash, MODEL, normalize, RECIPE } from "./model";

export type Asset = {
  key: string;
  title: string;
  text: string;
  media?: { kind: "audio" | "video" | "image"; file: string };
};
export type Segment = { from: number; to: number };
export type Job = {
  asset: string;
  part: number;
  fingerprint: string;
  spec: Segment;
  state: "pending" | "failed" | "done";
  error: string | null;
};
export const inputFingerprint = (asset: Asset, source: string) =>
  hash(
    JSON.stringify([
      source,
      documentText(asset.title, asset.text, !!asset.media),
      asset.media?.kind ?? "text",
    ]),
  );
const encode = (values: number[]) => {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setFloat32(i * 4, value, true));
  return bytes;
};

export const openIndex = (file: string, dimensions = 768) => {
  if (![768, 1536, 3072].includes(dimensions))
    throw new Error("Dimensions must be 768, 1536 or 3072");
  mkdirSync(dirname(resolve(file)), { recursive: true });
  const db = new Database(file, { create: true, strict: true });
  const space = JSON.stringify({ model: MODEL, dimensions, recipe: RECIPE });
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    const wrongFile = () => new Error("Database is not an embedding index; choose a separate --db");
    let saved: { space: string } | null = null;
    if (tables.length) {
      if (!tables.some((table) => table.name === "meta")) throw wrongFile();
      try {
        saved = db.query("SELECT space FROM meta LIMIT 1").get() as { space: string } | null;
      } catch {
        throw wrongFile();
      }
      if (
        !saved &&
        tables.some(
          (table) => !["meta", "assets", "jobs", "cache", "asset_errors"].includes(table.name),
        )
      )
        throw wrongFile();
    }
    if (saved && saved.space !== space)
      throw new Error(
        "Embedding space differs; use a separate --db for another model, dimension or recipe",
      );
    db.run(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS meta(space TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assets(key TEXT PRIMARY KEY, inputHash TEXT NOT NULL, definition TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs(asset TEXT, part INTEGER, fingerprint TEXT NOT NULL, spec TEXT NOT NULL, state TEXT NOT NULL, error TEXT, PRIMARY KEY(asset,part)); CREATE TABLE IF NOT EXISTS cache(key TEXT, fingerprint TEXT, vector BLOB NOT NULL, usage TEXT NOT NULL, PRIMARY KEY(key,fingerprint))",
    );
    if (!saved) db.query("INSERT INTO meta VALUES (?)").run(space);
  } catch (error) {
    db.close();
    throw error;
  }
  db.run("CREATE TABLE IF NOT EXISTS asset_errors(key TEXT PRIMARY KEY,error TEXT NOT NULL)");
  const get = (key: string) => {
    const row = db.query("SELECT inputHash,definition FROM assets WHERE key=?").get(key) as {
      inputHash: string;
      definition: string;
    } | null;
    return row ? { inputHash: row.inputHash, asset: JSON.parse(row.definition) as Asset } : null;
  };
  const decode = (value: Uint8Array) => {
    if (value.byteLength !== dimensions * 4) throw new Error("Corrupt cached embedding dimensions");
    const bytes = Buffer.from(value);
    return normalize(
      Array.from({ length: dimensions }, (_, i) => bytes.readFloatLE(i * 4)),
      dimensions,
    );
  };
  const cached = (key: string, fingerprint: string): Embedding | null => {
    const row = db
      .query("SELECT vector,usage FROM cache WHERE key=? AND fingerprint=?")
      .get(key, fingerprint) as { vector: Uint8Array; usage: string } | null;
    if (!row) return null;
    return {
      vector: decode(row.vector),
      usage: JSON.parse(row.usage),
    };
  };
  const put = (key: string, fingerprint: string, value: Embedding) =>
    db
      .query("INSERT OR REPLACE INTO cache VALUES (?,?,?,?)")
      .run(
        key,
        fingerprint,
        encode(normalize(value.vector, dimensions)),
        JSON.stringify(value.usage),
      );
  const stage = db.transaction((asset: Asset, source: string, segments: Segment[]) => {
    const inputHash = inputFingerprint(asset, source),
      previous = get(asset.key);
    db.query("INSERT OR REPLACE INTO assets VALUES (?,?,?)").run(
      asset.key,
      inputHash,
      JSON.stringify(asset),
    );
    db.query("DELETE FROM asset_errors WHERE key=?").run(asset.key);
    if (previous?.inputHash === inputHash) return;
    db.query("DELETE FROM jobs WHERE asset=?").run(asset.key);
    segments.forEach((spec, part) => {
      const fingerprint = hash(JSON.stringify([space, inputHash, spec]));
      const state = cached(asset.key, fingerprint) ? "done" : "pending";
      db.query("INSERT INTO jobs VALUES (?,?,?,?,?,NULL)").run(
        asset.key,
        part,
        fingerprint,
        JSON.stringify(spec),
        state,
      );
    });
  });
  const pending = (key: string): Job[] =>
    (
      db
        .query("SELECT * FROM jobs WHERE asset=? AND state<>'done' ORDER BY part")
        .all(key) as (Omit<Job, "spec"> & { spec: string })[]
    ).map((r) => ({ ...r, spec: JSON.parse(r.spec) }));
  const complete = db.transaction((job: Job, value: Embedding) => {
    const live = db
      .query("SELECT fingerprint FROM jobs WHERE asset=? AND part=?")
      .get(job.asset, job.part) as { fingerprint: string } | null;
    if (live?.fingerprint !== job.fingerprint)
      throw new Error("Asset changed while embedding; result was not attached to newer input");
    put(job.asset, job.fingerprint, value);
    db.query("UPDATE jobs SET state='done',error=NULL WHERE asset=? AND part=?").run(
      job.asset,
      job.part,
    );
  });
  const fail = (job: Job, message: string) =>
    db
      .query("UPDATE jobs SET state='failed',error=? WHERE asset=? AND part=? AND fingerprint=?")
      .run(message, job.asset, job.part, job.fingerprint);
  const remove = db.transaction((key: string) => {
    db.query("DELETE FROM jobs WHERE asset=?").run(key);
    db.query("DELETE FROM cache WHERE key=?").run(key);
    db.query("DELETE FROM assets WHERE key=?").run(key);
    db.query("DELETE FROM asset_errors WHERE key=?").run(key);
  });
  const search = (query: number[], eligible: Set<string>, limit = 100) => {
    const q = normalize(query, dimensions),
      hits = new Map<string, { key: string; score: number; part: number }>();
    for (const row of db
      .query(
        "SELECT j.asset,j.part,c.vector FROM jobs j JOIN cache c ON c.key=j.asset AND c.fingerprint=j.fingerprint WHERE j.state='done' AND NOT EXISTS (SELECT 1 FROM asset_errors e WHERE e.key=j.asset)",
      )
      .iterate() as Iterable<{ asset: string; part: number; vector: Uint8Array }>) {
      if (!eligible.has(row.asset)) continue;
      const vector = decode(row.vector);
      const score = vector.reduce((sum, value, i) => sum + value * q[i]!, 0);
      if (score > (hits.get(row.asset)?.score ?? -Infinity))
        hits.set(row.asset, { key: row.asset, score, part: row.part });
    }
    return [...hits.values()]
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
      .slice(0, limit);
  };
  const redo = db.transaction((key: string, part?: number) => {
    let changed = 0;
    for (const row of db.query("SELECT part,fingerprint FROM jobs WHERE asset=?").all(key) as Pick<
      Job,
      "part" | "fingerprint"
    >[]) {
      if (part !== undefined && row.part !== part) continue;
      changed++;
      db.query("DELETE FROM cache WHERE key=? AND fingerprint=?").run(key, row.fingerprint);
      db.query("UPDATE jobs SET state='pending',error=NULL WHERE asset=? AND part=?").run(
        key,
        row.part,
      );
    }
    if (!changed) throw new Error("No matching asset chunk to redo");
  });
  const ready = () =>
    (
      db
        .query(
          "SELECT DISTINCT j.asset FROM jobs j WHERE j.state='done' AND NOT EXISTS (SELECT 1 FROM asset_errors e WHERE e.key=j.asset)",
        )
        .all() as { asset: string }[]
    ).map((row) => row.asset);
  const assetFailed = (key: string, message: string) =>
    db.query("INSERT OR REPLACE INTO asset_errors VALUES (?,?)").run(key, message);
  const status = () => ({
    space: JSON.parse(space),
    assets: (db.query("SELECT count(*) AS n FROM assets").get() as { n: number }).n,
    jobs: db.query("SELECT state,count(*) AS count FROM jobs GROUP BY state").all(),
    failures: db.query("SELECT asset,part,error FROM jobs WHERE state='failed' LIMIT 20").all(),
    assetErrors: db.query("SELECT * FROM asset_errors LIMIT 20").all(),
  });
  let closed = false;
  return {
    get,
    cached,
    put,
    stage,
    pending,
    complete,
    fail,
    remove,
    redo,
    ready,
    assetFailed,
    search,
    status,
    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
  };
};
export type Index = ReturnType<typeof openIndex>;
