// jev.py with several keys for one route: a key whose daily quota is spent hands over to the next, and later runs skip it
// until it is back. A stand-in Jev server answers by key; the real routes are swapped for it, so no test reaches the net
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JEV_DIR = join(import.meta.dir, "../../packages/clip-catalog");

// key -> how the stand-in answers it: "ok", or "spent" (429, the free quota back in an hour)
let answers: Record<string, "ok" | "spent"> = {};
const asked: string[] = [];
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const key = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    asked.push(key);
    return answers[key] === "ok"
      ? Response.json({ answers: { q: { noul: 0.9 } }, usage: { cost: 0 } })
      : new Response("FreeUsageLimitError", { status: 429, headers: { "Retry-After": "3600" } });
  },
});
afterAll(() => server.stop(true));

// a home with ~/.secrets/zen.env holding these key lines; each run of jev.py is a fresh process, as jev.ts spawns it
const home = (lines: string) => {
  const dir = mkdtempSync(join(tmpdir(), "jev-home-"));
  mkdirSync(join(dir, ".secrets"));
  writeFileSync(join(dir, ".secrets/zen.env"), lines);
  return dir;
};
const ask = async (dir: string) => {
  const py = `import sys, json; sys.path.insert(0, ${JSON.stringify(JEV_DIR)}); import jev
jev.ROUTES = [("Zen", "${server.url}systemone", "jev", "JEV_TEST_KEY", "zen.env")]
print(json.dumps(jev.Jev().ask("state", {})))`;
  const env = { ...process.env, HOME: dir, USERPROFILE: dir };
  delete env.JEV_TEST_KEY;
  // async: the stand-in server answers from this same process
  const p = Bun.spawn(["python", "-I", "-c", py], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, out, err };
};

test("a key whose quota is spent hands over to the next key in the file", async () => {
  answers = { k1: "spent", k2: "ok" };
  asked.length = 0;
  const r = await ask(home("OPENCODE_API_KEY=k1\nOPENCODE_API_KEY=k2\n"));
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out)).toEqual({ q: { noul: 0.9 } });
  expect(asked).toEqual(["k1", "k2"]);
  expect(r.err).toContain("Jev: Zen key 1 of 2 quota spent, back in 1.0 h");
  expect(r.err).not.toContain("k1");
});

test("the next run starts on a key that still has quota, not the spent one", async () => {
  answers = { k1: "spent", k2: "ok" };
  const dir = home("k1\nk2\n");
  await ask(dir);
  asked.length = 0;
  const r = await ask(dir);
  expect(r.code).toBe(0);
  expect(asked).toEqual(["k2"]);
});

test("every key spent: it says to add another key, one per line", async () => {
  answers = { k1: "spent", k2: "spent" };
  const r = await ask(home("k1\nk2\n"));
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("every key has spent its quota");
  expect(r.err).toContain("one per line");
});

test("a key remembered as spent is still tried last, in case its quota came back early", async () => {
  answers = { k1: "spent", k2: "ok" };
  const dir = home("k1\nk2\n");
  await ask(dir);
  answers = { k1: "ok", k2: "spent" };
  asked.length = 0;
  const r = await ask(dir);
  expect(r.code).toBe(0);
  expect(asked).toEqual(["k2", "k1"]);
});
