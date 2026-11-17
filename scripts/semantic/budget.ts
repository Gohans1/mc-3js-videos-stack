import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const timezone = "America/Los_Angeles";
const calendar = new Intl.DateTimeFormat("en", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayOf = (now: number) => {
  const parts = calendar.formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join("-");
};
const summary = (day: string, limit: number, used: number) => ({
  day,
  timezone,
  limit,
  used,
  remaining: Math.max(0, limit - used),
});

export class BudgetError extends Error {
  constructor(limit: number, day: string) {
    super(
      `Local daily embedding budget reached (${limit} on ${day}); resumes after midnight ${timezone}`,
    );
    this.name = "BudgetError";
  }
}

export const openBudget = (file: string, limit = 1000, now = Date.now) => {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Set a positive whole daily request budget");
  mkdirSync(dirname(resolve(file)), { recursive: true });
  const db = new Database(file, { create: true, strict: true });
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    if (tables.length) {
      if (!tables.some((table) => table.name === "embedding_request_budget"))
        throw new Error("Database is not an embedding quota ledger; choose a separate quota path");
      db.query("SELECT day,attempts FROM embedding_request_budget LIMIT 0").all();
    }
    db.run(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS embedding_request_budget(day TEXT PRIMARY KEY,attempts INTEGER NOT NULL)",
    );
  } catch (error) {
    db.close();
    throw error;
  }
  const status = () => {
    const day = dayOf(now());
    const row = db.query("SELECT attempts FROM embedding_request_budget WHERE day=?").get(day) as {
      attempts: number;
    } | null;
    const used = row?.attempts ?? 0;
    return summary(day, limit, used);
  };
  const reserve = db.transaction(() => {
    const day = dayOf(now());
    db.query("INSERT OR IGNORE INTO embedding_request_budget VALUES (?,0)").run(day);
    const row = db
      .query(
        "UPDATE embedding_request_budget SET attempts=attempts+1 WHERE day=? AND attempts<? RETURNING attempts",
      )
      .get(day, limit);
    if (!row) throw new BudgetError(limit, day);
  });
  let closed = false;
  return {
    status,
    reserve,
    backup(target: string) {
      const output = resolve(target);
      if (existsSync(output))
        throw new Error("Budget backup destination already exists; choose a new file");
      mkdirSync(dirname(output), { recursive: true });
      db.query("VACUUM INTO ?").run(output);
      return output;
    },
    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
  };
};

export const readBudget = (file: string, limit = 1000) => {
  if (!existsSync(file)) return summary(dayOf(Date.now()), limit, 0);
  const budget = openBudget(file, limit);
  try {
    return budget.status();
  } finally {
    budget.close();
  }
};
