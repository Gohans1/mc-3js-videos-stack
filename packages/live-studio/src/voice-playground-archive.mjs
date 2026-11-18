import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function openSharedArchive(
  dir,
  { migrateItems = false, fileName = "archive.sqlite", initialCollections = {} } = {},
) {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, fileName), { create: true });
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA journal_mode = WAL");
  db.run("CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const read = db.query("SELECT data FROM collections WHERE name = ?");
  const put = db.query(
    "INSERT INTO collections (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data",
  );
  const list = (name) => JSON.parse(read.get(name)?.data ?? "[]");
  const mutate = db.transaction((name, fn) => {
    const items = list(name);
    const result = fn(items);
    put.run(name, JSON.stringify(items));
    return result;
  });
  db.transaction(() => {
    for (const [name, rows] of Object.entries(initialCollections))
      if (!read.get(name)) put.run(name, JSON.stringify(rows));
    if (migrateItems && !read.get("items")) {
      const legacy = join(dir, "items.json");
      if (existsSync(legacy)) {
        const { items } = JSON.parse(readFileSync(legacy, "utf8"));
        put.run("items", JSON.stringify(Array.isArray(items) ? items : []));
      }
    }
  }).immediate();
  const write = db.transaction((fn) => fn());
  return {
    has: (name) => Boolean(read.get(name)),
    list,
    mutate: (name, fn) => mutate.immediate(name, fn),
    write: (fn) => write.immediate(fn),
    close: () => db.close(),
  };
}
