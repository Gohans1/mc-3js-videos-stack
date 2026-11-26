import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JEV_DIR = join(import.meta.dir, "../../packages/clip-catalog");

let answers: Record<string, "ok" | "spent" | "refused" | "busy" | "down" | "badjson"> = {};
let burst = "1";
const asked: string[] = [];
const ok = () => Response.json({ answers: { q: { noul: 0.9 } }, usage: { cost: 0 } });
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    await req.text();
    const key = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    asked.push(key);
    const a = answers[key];
    const again = asked.filter((k) => k === key).length > 1;
    if (a === "ok" || ((a === "busy" || a === "down" || a === "badjson") && again)) return ok();
    return a === "busy"
      ? new Response("RateLimitError", { status: 429, headers: { "Retry-After": burst } })
      : a === "down"
        ? new Response("Bad Gateway", { status: 503 })
        : a === "badjson"
          ? new Response("<html>bad gateway</html>", { status: 200 })
          : a === "refused"
            ? new Response("This API key can't call models", { status: 403 })
            : new Response("FreeUsageLimitError", {
                status: 429,
                headers: { "Retry-After": "3600" },
              });
  },
});
let connections = 0;
const handledSockets = new WeakSet();
const flaky = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    async data(socket) {
      if (handledSockets.has(socket)) return;
      handledSockets.add(socket);
      if (connections++ === 0) return void socket.end();
      const res = await ok().text();
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${res.length}\r\nConnection: close\r\n\r\n${res}`,
      );
    },
  },
});
const temps: string[] = [];
afterAll(() => {
  server.stop(true);
  flaky.stop(true);
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const home = (zen: string, paid = "") => {
  const dir = mkdtempSync(join(tmpdir(), "jev-home-"));
  temps.push(dir);
  mkdirSync(join(dir, ".secrets"));
  writeFileSync(join(dir, ".secrets/zen.env"), zen);
  if (paid) writeFileSync(join(dir, ".secrets/paid.env"), paid);
  return dir;
};
const ask = async (dir: string, url = server.url.href) => {
  const py = `import sys, json; sys.path.insert(0, ${JSON.stringify(JEV_DIR)}); import jev
nap = jev.time.sleep
jev.time.sleep = lambda s: nap(min(s, 0.01)) if s >= 0 else nap(s)
jev.ROUTES = [("Zen", "${url}systemone", "jev", "JEV_TEST_ZEN", "zen.env"),
              ("Paid", "${url}systemone", "jev", "JEV_TEST_PAID", "paid.env")]
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
}, 15000);

test("the next run starts on a route with quota, not the spent one", async () => {
  answers = { z1: "spent", p1: "ok" };
  const dir = home("z1\n", "p1\n");
  await ask(dir);
  asked.length = 0;
  const r = await ask(dir);
  expect(r.code).toBe(0);
  expect(asked).toEqual(["p1"]);
}, 15000);

test("a route remembered as spent is still tried last, in case its quota came back early", async () => {
  answers = { z1: "spent", p1: "ok" };
  const dir = home("z1\n", "p1\n");
  await ask(dir);
  answers = { z1: "ok", p1: "spent" };
  asked.length = 0;
  const r = await ask(dir);
  expect(r.code).toBe(0);
  expect(asked).toEqual(["p1", "z1"]);
}, 15000);

test("a refused key hands over to the route's next key", async () => {
  answers = { z1: "refused", z2: "ok" };
  asked.length = 0;
  const r = await ask(home("z1\nz2\n"));
  expect(r.code).toBe(0);
  expect(asked).toEqual(["z1", "z2"]);
  expect(r.err).toContain("Jev: Zen key 1 of 2 refused (403)");
}, 15000);

test("reports each exhausted route's retry time and skips its remaining keys", async () => {
  answers = { z1: "spent", z2: "ok", p1: "spent", p2: "ok" };
  asked.length = 0;
  const r = await ask(home("z1\nz2\n", "p1\np2\n"));
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("Zen quota is exhausted. Try again in 1.0 hours.");
  expect(r.err).toContain("Paid quota is exhausted. Try again in 1.0 hours.");
  expect(asked).toEqual(["z1", "p1"]);
}, 15000);

for (const [label, a, after] of [
  ["seconds Retry-After", "busy", "1"],
  ["HTTP-date Retry-After", "busy", "Wed, 21 Oct 2015 07:28:00 GMT"],
  ["negative Retry-After", "busy", "-5"],
  ["non-numeric Retry-After", "busy", "nan"],
  ["server 503", "down", ""],
  ["non-JSON 200 body", "badjson", ""],
] as const) {
  test(`burst limit / transient fault retried on same key (${label})`, async () => {
    answers = { z1: a };
    burst = after;
    asked.length = 0;
    const r = await ask(home("z1\n"));
    expect(r.code, `${a} ${after}: ${r.err}`).toBe(0);
    expect(asked).toEqual(["z1", "z1"]);
  }, 15000);
}

test("a connection dropped before any answer is retried", async () => {
  connections = 0;
  answers = { z1: "ok" };
  const r = await ask(home("z1\n"), `http://127.0.0.1:${flaky.port}/`);
  expect(r.code, r.err).toBe(0);
  expect(JSON.parse(r.out)).toEqual({ q: { noul: 0.9 } });
  expect(connections).toBe(2);
}, 15000);
