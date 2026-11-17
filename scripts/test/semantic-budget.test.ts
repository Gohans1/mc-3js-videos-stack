import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BudgetError, openBudget } from "../semantic/budget";
import { openIndex } from "../semantic/store";

test("request reservations survive reopening and are shared by independent index connections", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-budget-"));
  const file = join(folder, "requests.sqlite");
  const now = () => Date.parse("2026-11-17T09:00:00Z");
  let first = openBudget(file, 2, now);
  const second = openBudget(file, 2, now);
  try {
    first.reserve();
    first.close();
    first = openBudget(file, 2, now);
    second.reserve();
    expect(() => first.reserve()).toThrow(BudgetError);
    expect(second.status()).toEqual({
      day: "2026-11-17",
      timezone: "America/Los_Angeles",
      limit: 2,
      used: 2,
      remaining: 0,
    });
  } finally {
    first.close();
    second.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

for (const [before, after] of [
  ["2026-11-17T07:59:59Z", "2026-11-17T08:00:00Z"],
  ["2026-07-17T06:59:59Z", "2026-07-17T07:00:00Z"],
])
  test(`the daily allowance resets at Pacific midnight across ${after}`, () => {
    let clock = Date.parse(before!);
    const budget = openBudget(":memory:", 1, () => clock);
    try {
      budget.reserve();
      expect(() => budget.reserve()).toThrow(BudgetError);
      clock = Date.parse(after!);
      expect(budget.status().remaining).toBe(1);
      budget.reserve();
      expect(budget.status().used).toBe(1);
    } finally {
      budget.close();
    }
  });

test("a quota path cannot silently turn an existing vector database into a ledger", () => {
  const folder = mkdtempSync(join(tmpdir(), "semantic-budget-wrong-file-"));
  const file = join(folder, "vectors.sqlite");
  const index = openIndex(file);
  index.close();
  try {
    const inspect = () => {
      const db = new Database(file, { readonly: true });
      try {
        return db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      } finally {
        db.close();
      }
    };
    const before = inspect();
    expect(() => openBudget(file, 10)).toThrow(/quota ledger/i);
    expect(inspect()).toEqual(before);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
