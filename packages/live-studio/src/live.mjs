// The studio for one film; HELP below
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";

import { createApi } from "./api.mjs";
import { cliArgs } from "./cli.mjs";
import { openFilm } from "./film.mjs";
import { buildPage } from "./page.mjs";

const HELP = `The studio for one film: a live preview the creator watches and edits, with the timeline, notes and render. Run
inside the film (or set LIVE_PROJECT); package.json's studio script carries the film's port.
  bun run studio            then open http://localhost:<port>, or the Tailscale link it prints
  bun run studio --lan      reachable from other machines on the network too
Saving the film's code offers "New version" on the page, never reloading it unasked; saving sound.py or anything
package.json lists under "live-studio".sound remixes. Problems with the film's data print here (offline: bun run check).
Ctrl+C stops it; a port still taken after that belongs to a studio left running.`;
// the film's studio script puts its port first, so "bun run studio help" arrives as "<port> help"
const argv = process.argv.slice(2);
const portArg = /^\d+$/.test(argv[0] ?? "") ? argv.shift() : undefined;
if (/^\d+$/.test(argv[0] ?? "") || argv.some((a) => /^--port(=|$)/.test(a))) {
  console.error(
    `the film's port is ${portArg}, set in package.json's "studio" script: change it there, not here (bun run studio)`,
  );
  process.exit(2);
}
cliArgs(HELP, ["--lan"], 0, argv);
const PORT = Number(portArg) || 4321;
const LAN = process.argv.includes("--lan");

const events = new Set(); // open pages, see /api/events
const send = (event, data = "") => {
  for (const page of events) page.writeSSE({ event, data: String(data) });
}; // a page that left is dropped by /api/events itself
let film;
try {
  film = openFilm(process.env.LIVE_PROJECT ?? process.cwd(), { send });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
// One studio per film: it owns notes.jsonl, and note.mjs done finds it through renders/live/studio.json, which a second one
// would take over
try {
  const { port } = JSON.parse(readFileSync(join(film.WORK, "studio.json"), "utf8"));
  if (
    port !== PORT &&
    (await fetch(`http://127.0.0.1:${port}/api/notes`, { signal: AbortSignal.timeout(1500) })).ok
  ) {
    console.error(
      `this film's studio already runs at http://localhost:${port}: use that one, or stop it first`,
    );
    process.exit(1);
  }
} catch {
  /* none recorded, or it no longer answers */
}

const page = await buildPage(film, {
  // A build made only because the studio saved the sound lanes or the camera keys is no new code for the creator to load: the
  // page has them already
  onChange: (files) => {
    const own = film.ownWrites();
    send("code", files.length && files.every((f) => own.includes(resolve(f))) ? "own" : "");
  },
  onError: (message) => send("build-error", message), // Vite prints it in this terminal itself
});

// No password here, so nothing but this machine and names the film lists may even ask. A website can point its own name at
// this machine (DNS rebinding), or make the visitor's browser ask it for something. Browsers say where a request comes from
// (Fetch Metadata): another site may link to the studio, nothing more. Origin covers the browsers that don't say
const knownHost = (host) => {
  const n = (host ?? "").replace(/:\d+$/, "").toLowerCase();
  return (
    n === "localhost" || n === "[::1]" || /^\d+\.\d+\.\d+\.\d+$/.test(n) || film.hosts.includes(n)
  );
};
const fromElsewhere = (req, host) => {
  const site = req.headers.get("sec-fetch-site");
  if (site)
    return (
      site !== "same-origin" &&
      site !== "none" &&
      !(
        req.method === "GET" &&
        req.headers.get("sec-fetch-mode") === "navigate" &&
        req.headers.get("sec-fetch-dest") === "document"
      )
    );
  if (req.method === "GET" || req.method === "HEAD") return false;
  const origin = req.headers.get("origin");
  try {
    return !!origin && new URL(origin).host !== host;
  } catch {
    return true;
  }
};

const api = createApi(film, { page, events, send });
film.start();

// This machine only, unless asked: --lan opens it to the network for a phone, and nothing here asks for a password
Bun.serve({
  port: PORT,
  hostname: LAN ? "0.0.0.0" : "127.0.0.1",
  idleTimeout: 255,
  async fetch(req, server) {
    server.timeout(req, 0);
    const host = req.headers.get("host");
    if (!knownHost(host) || fromElsewhere(req, host)) return new Response(null, { status: 403 });
    try {
      decodeURI(new URL(req.url).pathname);
    } catch {
      return new Response(null, { status: 400 });
    } // a path no file can have, before Hono trips on it
    const res = await api.fetch(req);
    // Another site can't load the film as a script, or show the studio in a frame to steal clicks
    res.headers.set("cross-origin-resource-policy", "same-origin");
    res.headers.set(
      "content-security-policy",
      "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    );
    res.headers.set("x-content-type-options", "nosniff");
    return res;
  },
});
console.log(`live at http://localhost:${PORT}`);
writeFileSync(join(film.WORK, "studio.json"), JSON.stringify({ port: PORT })); // where note.mjs done finds the studio that owns the notes
tailscaleLink();
if (LAN)
  for (const nets of Object.values(networkInterfaces()))
    for (const n of nets)
      if (n.family === "IPv4" && !n.internal)
        console.log(
          `no password: anyone on this network can open http://${n.address}:${PORT} and change the notes. tailscale serve is the safe way to a phone`,
        );

// The link the creator opens: the Tailscale https names that serve this port. Said every start, because after a reboot
// Tailscale is often not running yet, and a name missing from .live_hosts answers every request with 403
function tailscaleLink() {
  execFile(
    "tailscale",
    ["serve", "status", "--json"],
    { timeout: 5000, windowsHide: true },
    (e, out) => {
      let web = null;
      try {
        web = JSON.parse(out).Web ?? {};
      } catch {}
      if (e || !web) {
        console.log(
          "Tailscale is not answering: start the Tailscale app (often not running after a reboot); its links come back with it",
        );
        return;
      }
      const mine = Object.entries(web)
        .filter(([, w]) =>
          Object.values(w.Handlers ?? {}).some(
            (h) =>
              /^https?:\/\/(127\.0\.0\.1|localhost):(\d+)\/?$/.exec(h.Proxy ?? "")?.[2] ===
              String(PORT),
          ),
        )
        .map(([host]) => host);
      if (!mine.length) {
        console.log(
          `no Tailscale link to port ${PORT}: tailscale serve --bg --https=<a free port> http://127.0.0.1:${PORT}`,
        );
        return;
      }
      for (const host of mine) {
        const name = host.replace(/:\d+$/, "").toLowerCase();
        console.log(
          film.hosts.includes(name)
            ? `creator's link: https://${host}`
            : `https://${host} serves this studio but answers 403: add ${name} to .live_hosts in the film`,
        );
      }
    },
  );
}
