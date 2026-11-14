// jev.py's routes and keys: Zen counts its free quota per network (egress IP), not per key, so a spent quota skips the
// route's other keys, and later runs try that route last until it is back; a refused key hands over to the route's next
// key. A stand-in Jev server answers by key; the real routes are swapped for it, so no test reaches the net
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JEV_DIR = join(import.meta.dir, "../../packages/clip-catalog");

// key -> how the stand-in answers it: "ok", "spent" (429, back in an hour) or "refused" (403, a key that cannot call)
let answers: Record<string, "ok" | "spent" | "refused"> = {};
const asked: string[] = [];
const server = Bun.serve({
  port: 0,
  // the body read before answering: on Windows a socket closed with it unread resets, and python sees an abort
  async fetch(req) {
    await req.text();
    const key = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    asked.push(key);
    const a = answers[key];
    return a === "ok"
      ? Response.json({ answers: { q: { noul: 0.9 } }, usage: { cost: 0 } })
      : a === "refused"
        ? new Response("This API key can't call models", { status: 403 })
        : new Response("FreeUsageLimitError", { status: 429, headers: { "Retry-After": "3600" } });
  },
});
afterAll(() => server.stop(true));

// a home with ~/.secrets/zen.env and paid.env holding these key lines
const home = (zen: string, paid = "") => {
  const dir = mkdtempSync(join(tmpdir(), "jev-home-"));
  mkdirSync(join(dir, ".secrets"));
  writeFileSync(join(dir, ".secrets/zen.env"), zen);
  if (paid) writeFileSync(join(dir, ".secrets/paid.env"), paid);
  return dir;
};
// each run of jev.py is a fresh process, as jev.ts spawns it (async: the stand-in answers from this same process)
const ask = async (dir: string) => {
  const py = `import sys, json; sys.path.insert(0, ${JSON.stringify(JEV_DIR)}); import jev
jev.ROUTES = [("Zen", "${server.url}systemone", "jev", "JEV_TEST_ZEN", "zen.env"),
              ("Paid", "${server.url}systemone", "jev", "JEV_TEST_PAID", "paid.env")]
print(json.dumps(jev.Jev().ask("state", {})))`;
  const env = { ...process.env, HOME: dir, USERPROFILE: dir };
  delete env.JEV_TEST_ZEN;
  delete env.JEV_TEST_PAID;
  const p = Bun.spawn(["python", "-I", "-c", py], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, out, err };
};

test("a spent quota skips the route's other keys, as Zen counts it per network", async () => {
  answers = { z1: "spent", z2: "ok", p1: "ok" };
  asked.length = 0;
  const r = await ask(home("OPENCODE_API_KEY=z1\nOPENCODE_API_KEY=z2\n", "p1\n"));
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out)).toEqual({ q: { noul: 0.9 } });
  expect(asked).toEqual(["z1", "p1"]);
  expect(r.err).toContain("Jev: Zen quota spent, back in 1.0 h");
  expect(r.err).not.toContain("z1");
});

test("the next run starts on a route with quota, not the spent one", async () => {
  answers = { z1: "spent", p1: "ok" };
  const dir = home("z1\n", "p1\n");
  await ask(dir);
  asked.length = 0;
  const r = await ask(dir);
  expect(r.code).toBe(0);
  expect(asked).toEqual(["p1"]);
});

test("a route remembered as spent is still tried last, in case its quota came back early", async () => {
  answers = { z1: "spent", p1: "ok" };
  const dir = home("z1\n", "p1\n");
  await ask(dir);
  answers = { z1: "ok", p1: "spent" };
  asked.length = 0;
  const r = await ask(dir);
  expect(r.code).toBe(0);
  expect(asked).toEqual(["p1", "z1"]);
});

test("a refused key hands over to the route's next key", async () => {
  answers = { z1: "refused", z2: "ok" };
  asked.length = 0;
  const r = await ask(home("z1\nz2\n"));
  expect(r.code).toBe(0);
  expect(asked).toEqual(["z1", "z2"]);
  expect(r.err).toContain("Jev: Zen key 1 of 2 refused (403)");
});

test("every route spent: it says when, and that more keys on one network do not help", async () => {
  answers = { z1: "spent", p1: "spent" };
  const r = await ask(home("z1\n", "p1\n"));
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("every route has spent its quota");
  expect(r.err).toContain("per network");
});
