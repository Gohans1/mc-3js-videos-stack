import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as THREE from "three";

import { openFilm, STUDIO } from "../src/film.mjs";
import { compileLayerTiming } from "../src/layer-timing.mjs";
import { LINKAGE_DEFAULTS, recordLinkage, timingPlan } from "../src/linkage.mjs";
import { isKnownHost, isStudioProcessCmdline, tailscaleHostsForPort } from "../src/live.mjs";
import { noteDetailFormat } from "../src/note-detail.mjs";

const withBrowserGlobals = (t) => {
  const keys = [
    "window",
    "document",
    "sessionStorage",
    "localStorage",
    "matchMedia",
    "location",
    "navigator",
    "innerWidth",
    "innerHeight",
  ];
  const prev = new Map(keys.map((k) => [k, [k in globalThis, globalThis[k]]]));
  const storage = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => void m.set(k, String(v)),
      removeItem: (k) => void m.delete(k),
    };
  };
  globalThis.window ??= globalThis;
  globalThis.document ??= { documentElement: { dataset: {} } };
  globalThis.sessionStorage ??= storage();
  globalThis.localStorage ??= storage();
  globalThis.matchMedia ??= () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.location ??= { hostname: "localhost", search: "", hash: "" };
  globalThis.innerWidth ??= 1920;
  globalThis.innerHeight ??= 1080;
  t.after(() => {
    for (const [k, [had, val]] of prev) {
      if (had) globalThis[k] = val;
      else delete globalThis[k];
    }
  });
};

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SCRIPT = join(HERE, "../src/live.mjs");
const NOTES_SCRIPT = join(HERE, "../notes.mjs");
const INDEX_HTML = join(HERE, "../app/index.html");

const freePort = () =>
  new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolvePort(port)));
    });
  });

const makeTempDemoFilm = (prefix = "studio-ux-") => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ voice: { edits: {}, warp: [] }, beats: {}, end: 8 }, null, 2),
  );
  writeFileSync(
    join(dir, "src/edit.ts"),
    [
      'import raw from "./edit.json";',
      "export const EDIT = raw;",
      "export const fromSource = (t: number) => t;",
      "export const toSource = (t: number) => t;",
      "export const setEdit = () => {};",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "src/scene.ts"),
    [
      'import * as THREE from "three";',
      "export const DURATION = 8;",
      "export const SHOTS = [{ t: 0 }];",
      "export const SHOTS_OUT = [{ t: 0 }];",
      "export const applyEdit = () => {};",
      "export function buildScene() {",
      "  const scene = new THREE.Scene();",
      "  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);",
      "  const draw = Object.assign(() => {}, {",
      "    tools: {",
      "      scene,",
      "      camera,",
      "      look: new THREE.Vector3(),",
      "      free: { on: false, p: new THREE.Vector3(0, 1, 5), l: new THREE.Vector3(), fov: 45 },",
      "    },",
      "  });",
      "  return draw;",
      "}",
    ].join("\n"),
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "temp-ux-film" }));
  writeFileSync(
    join(dir, "sound.py"),
    'import sys, pathlib\nout = pathlib.Path(sys.argv[1])\nout.write_bytes(b"")\nout.with_name("trials.json").write_text("{}")\n',
  );
  return dir;
};

test("film.mjs re-reads .live_hosts on create/edit/delete without restart and supports allowHost()", (t) => {
  const dir = makeTempDemoFilm("film-hosts-");
  const film = openFilm(dir, { send() {} });
  t.after(() => {
    film.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  assert.deepEqual(film.hosts, []);

  const hostsFile = join(dir, ".live_hosts");
  writeFileSync(hostsFile, "first.tail.ts.net\n");
  assert.deepEqual(film.hosts, ["first.tail.ts.net"]);

  const future = new Date(Date.now() + 5000);
  writeFileSync(hostsFile, "Second.Tail.ts.net:8443\nthird.tail.ts.net\n");
  utimesSync(hostsFile, future, future);
  assert.deepEqual(film.hosts, ["second.tail.ts.net", "third.tail.ts.net"]);

  film.allowHost("Auto.Tail.ts.net:443");
  assert.ok(film.hosts.includes("auto.tail.ts.net"));
  assert.ok(film.hosts.includes("second.tail.ts.net"));

  rmSync(hostsFile);
  assert.deepEqual(film.hosts, ["auto.tail.ts.net"]);
});

test("tailscaleHostsForPort, isKnownHost, and isStudioProcessCmdline validate hosts and studio processes", () => {
  const status = {
    Web: {
      "my-pc.tail123.ts.net:8443": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:4321" } },
      },
      "other-port.tail123.ts.net:8444": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:4322" } },
      },
      "local-name.tail123.ts.net:443": {
        Handlers: { "/sub": { Proxy: "HTTP://LOCALHOST:4321/" } },
      },
      "ipv6-loopback.tail123.ts.net:443": {
        Handlers: { "/": { Proxy: "http://[::1]:4321" } },
      },
      "remote-proxy.tail123.ts.net:443": {
        Handlers: { "/": { Proxy: "http://10.0.0.5:4321" } },
      },
    },
  };
  assert.deepEqual(tailscaleHostsForPort(status, 4321), [
    "my-pc.tail123.ts.net:8443",
    "local-name.tail123.ts.net:443",
    "ipv6-loopback.tail123.ts.net:443",
  ]);
  assert.deepEqual(tailscaleHostsForPort(status, 9999), []);
  assert.deepEqual(tailscaleHostsForPort("not json", 4321), []);

  const neverCalled = () => {
    throw new Error("should not read hosts for local request");
  };
  assert.equal(isKnownHost("localhost:4321", neverCalled), true);
  assert.equal(isKnownHost("127.0.0.1:4321", neverCalled), true);
  assert.equal(isKnownHost("[::1]:4321", neverCalled), true);
  let calls = 0;
  const readHosts = () => {
    calls += 1;
    return ["phone.ts.net"];
  };
  assert.equal(isKnownHost("phone.ts.net:4321", readHosts), true);
  assert.equal(isKnownHost("other.ts.net:4321", readHosts), false);
  assert.equal(calls, 2);

  assert.equal(
    isStudioProcessCmdline("bun W:/repo/packages/live-studio/src/live.mjs 4321", 4321),
    true,
  );
  assert.equal(isStudioProcessCmdline("bun ../src/live.mjs", 4321), true);
  assert.equal(isStudioProcessCmdline("bun ../src/live.mjs", 4322), false);
  assert.equal(isStudioProcessCmdline("bun ../src/live.mjs --lan", 4321), true);
  assert.equal(
    isStudioProcessCmdline("bun run packages/live-studio/src/live.mjs 4325 --lan", 4325),
    true,
  );
  assert.equal(
    isStudioProcessCmdline(
      '"C:\\Program Files\\Bun\\bun.exe" "C:\\My Films\\demo\\packages\\live-studio\\src\\live.mjs" 4321',
      4321,
    ),
    true,
  );
  assert.equal(
    isStudioProcessCmdline(
      '"C:\\Users\\O\'Brien\\bun.exe" "C:\\Users\\O\'Brien\\repo\\packages\\live-studio\\src\\live.mjs" 4321',
      4321,
    ),
    true,
  );
  assert.equal(
    isStudioProcessCmdline(
      "C:\\Users\\O'Brien\\bun.exe C:\\Users\\O'Brien\\repo\\packages\\live-studio\\src\\live.mjs 4321",
      4321,
    ),
    true,
  );
  assert.equal(
    isStudioProcessCmdline(
      ["/usr/local/bin/bun", "/home/o'brien/my films/packages/live-studio/src/live.mjs", "4321"],
      4321,
    ),
    true,
  );
  assert.equal(
    isStudioProcessCmdline(
      ["/usr/local/bin/bun", "/home/user/my films/packages/live-studio/src/live.mjs"],
      4322,
    ),
    false,
  );
  assert.equal(isStudioProcessCmdline(["/bin/sh", "-c", "bun live.mjs 4321"], 4321), false);
  assert.equal(isStudioProcessCmdline('powershell.exe -Command "bun live.mjs 4321"', 4321), false);
  assert.equal(
    isStudioProcessCmdline(
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "bun live.mjs 4321"',
      4321,
    ),
    false,
  );
  assert.equal(isStudioProcessCmdline('/bin/sh -c "bun live.mjs 4321"', 4321), false);
  assert.equal(isStudioProcessCmdline("bun -e \"console.log('live.mjs')\"", 4321), false);
  assert.equal(isStudioProcessCmdline("bun test packages/live-studio/src/live.mjs", 4321), false);
  assert.equal(isStudioProcessCmdline("rg live.mjs", 4321), false);
  assert.equal(isStudioProcessCmdline("code packages/live-studio/src/live.mjs", 4321), false);
  assert.equal(isStudioProcessCmdline("bun live.mjs 4321 --stop", 4321), false);
  assert.equal(isStudioProcessCmdline("bun live.mjs 4321 --status", 4321), false);
  assert.equal(isStudioProcessCmdline("bun live.mjs 4321 --detach", 4321), false);
  assert.equal(isStudioProcessCmdline("bun live.mjs 4322", 4321), false);
  assert.equal(isStudioProcessCmdline("notepad.exe", 4321), false);
});

test("live.mjs --detach, --status, dynamic .live_hosts over HTTP, and --stop work end-to-end safely", async (t) => {
  const dir = makeTempDemoFilm("live-detach-");
  const otherDir = makeTempDemoFilm("live-other-");
  const port = await freePort();
  let recordedPid = null;
  let decoyProc = null;

  t.after(() => {
    if (decoyProc) {
      try {
        decoyProc.kill();
      } catch {}
    }
    if (recordedPid) {
      try {
        process.kill(recordedPid, "SIGTERM");
      } catch {}
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(otherDir, { recursive: true, force: true });
  });

  const runLive = (projectDir, ...args) =>
    spawnSync(process.execPath, [LIVE_SCRIPT, String(port), ...args], {
      cwd: STUDIO,
      env: { ...process.env, LIVE_PROJECT: projectDir },
      encoding: "utf8",
      timeout: 45000,
    });

  const help = runLive(dir, "--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--detach/);
  assert.match(help.stdout, /--status/);
  assert.match(help.stdout, /--stop/);
  assert.equal(runLive(dir, "--detach", "--stop").status, 2);
  assert.equal(runLive(dir, "--lan", "--status").status, 2);

  const statusBefore = runLive(dir, "--status");
  assert.equal(statusBefore.status, 1);

  const detach = runLive(dir, "--detach");
  assert.equal(
    detach.status,
    0,
    `detach failed:\nstdout: ${detach.stdout}\nstderr: ${detach.stderr}`,
  );
  assert.match(detach.stdout, new RegExp(`http://localhost:${port}`));
  assert.match(detach.stdout, /pid:\s*\d+/);
  assert.match(detach.stdout, /studio\.log/);

  const studioJsonPath = join(dir, "renders/live/studio.json");
  assert.equal(existsSync(studioJsonPath), true);
  const studioInfo = JSON.parse(readFileSync(studioJsonPath, "utf8"));
  assert.equal(studioInfo.port, port);
  assert.equal(Number.isInteger(studioInfo.pid) && studioInfo.pid > 0, true);
  recordedPid = studioInfo.pid;
  assert.equal(existsSync(join(dir, "renders/live/studio.log")), true);

  const statusRunning = runLive(dir, "--status");
  assert.equal(statusRunning.status, 0, statusRunning.stderr);
  assert.match(statusRunning.stdout, new RegExp(`http://localhost:${port}`));
  assert.match(statusRunning.stdout, new RegExp(String(recordedPid)));

  const alreadyRunning = runLive(dir, "--detach");
  assert.equal(alreadyRunning.status, 1);
  assert.match(alreadyRunning.stderr, new RegExp(`already runs at http://localhost:${port}`));

  const denied = await fetch(`http://127.0.0.1:${port}/`, {
    headers: { host: `phone.tail.ts.net:${port}` },
  });
  assert.equal(denied.status, 403);

  writeFileSync(join(dir, ".live_hosts"), "phone.tail.ts.net\n");
  const allowed = await fetch(`http://127.0.0.1:${port}/`, {
    headers: { host: `phone.tail.ts.net:${port}` },
  });
  assert.equal(allowed.status, 200);
  const html = await allowed.text();
  assert.match(html, /#100F0F/i);
  assert.match(html, /Starting Studio/);

  mkdirSync(join(otherDir, "renders/live"), { recursive: true });
  writeFileSync(
    join(otherDir, "renders/live/studio.json"),
    JSON.stringify({ port, project: dir, pid: recordedPid }),
  );
  const wrongStop = runLive(otherDir, "--stop");
  assert.equal(wrongStop.status, 1);
  const stillUp = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(stillUp.status, 200);

  decoyProc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const savedStudioInfo = readFileSync(studioJsonPath, "utf8");
  writeFileSync(studioJsonPath, JSON.stringify({ port, project: dir, pid: decoyProc.pid }));
  const mismatchStop = runLive(dir, "--stop");
  assert.equal(
    mismatchStop.status,
    1,
    `expected exit 1 when live studio answers but pid is non-studio:\nstdout: ${mismatchStop.stdout}\nstderr: ${mismatchStop.stderr}`,
  );
  assert.equal(decoyProc.exitCode, null, "non-studio decoy process must stay alive");
  assert.doesNotThrow(() => process.kill(decoyProc.pid, 0));
  assert.equal(existsSync(studioJsonPath), true, "studio.json must remain intact when probe.ok");
  assert.equal(JSON.parse(readFileSync(studioJsonPath, "utf8")).pid, decoyProc.pid);
  decoyProc.kill();
  decoyProc = null;
  writeFileSync(studioJsonPath, savedStudioInfo);

  const stop = runLive(dir, "--stop");
  assert.equal(stop.status, 0, `stop failed:\nstdout: ${stop.stdout}\nstderr: ${stop.stderr}`);
  recordedPid = null;

  const statusAfter = runLive(dir, "--status");
  assert.equal(statusAfter.status, 1);

  const detachLan = runLive(dir, "--detach", "--lan");
  assert.equal(
    detachLan.status,
    0,
    `detach --lan failed:\nstdout: ${detachLan.stdout}\nstderr: ${detachLan.stderr}`,
  );
  const lanInfo = JSON.parse(readFileSync(studioJsonPath, "utf8"));
  recordedPid = lanInfo.pid;
  assert.equal(runLive(dir, "--status").status, 0);
  const stopLan = runLive(dir, "--stop");
  assert.equal(stopLan.status, 0, stopLan.stderr);
  recordedPid = null;
});

test("live.mjs --detach prints log tail and exits 1 when child exits early", async (t) => {
  const dir = makeTempDemoFilm("live-detach-fail-");
  const blocker = createServer();
  await new Promise((resolveListen) => blocker.listen(0, "127.0.0.1", resolveListen));
  t.after(() => {
    blocker.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const busyPort = blocker.address().port;

  const res = spawnSync(process.execPath, [LIVE_SCRIPT, String(busyPort), "--detach"], {
    cwd: STUDIO,
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(res.status, 1);
  assert.match(`${res.stdout}\n${res.stderr}`, /exited early|failed|already in use|EADDRINUSE/i);
});

test("live.mjs --stop refuses recycled non-studio PIDs and --status rejects non-studio HTTP servers", async (t) => {
  const dir = makeTempDemoFilm("live-safety-");
  const benign = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const otherServer = createHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("not studio");
  });
  await new Promise((done) => otherServer.listen(0, "127.0.0.1", done));
  const otherPort = otherServer.address().port;
  const unusedPort = await freePort();

  t.after(() => {
    try {
      benign.kill();
    } catch {}
    otherServer.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const studioJsonPath = join(dir, "renders/live/studio.json");
  mkdirSync(dirname(studioJsonPath), { recursive: true });

  writeFileSync(studioJsonPath, JSON.stringify({ port: otherPort, project: dir, pid: benign.pid }));
  const fakeStatus = spawnSync(process.execPath, [LIVE_SCRIPT, String(otherPort), "--status"], {
    cwd: STUDIO,
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(
    fakeStatus.status,
    1,
    `status should reject non-studio server:\n${fakeStatus.stdout}`,
  );

  writeFileSync(studioJsonPath, JSON.stringify({ port: 0, project: dir, pid: benign.pid }));
  const stopBadPort = spawnSync(process.execPath, [LIVE_SCRIPT, String(unusedPort), "--stop"], {
    cwd: STUDIO,
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(stopBadPort.status, 1);
  assert.match(stopBadPort.stderr, /no valid port/i);
  assert.equal(benign.exitCode, null, "non-studio process must still be alive");

  writeFileSync(
    studioJsonPath,
    JSON.stringify({ port: unusedPort, project: dir, pid: benign.pid }),
  );
  const stopRecycled = spawnSync(process.execPath, [LIVE_SCRIPT, String(unusedPort), "--stop"], {
    cwd: STUDIO,
    env: { ...process.env, LIVE_PROJECT: dir },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(
    stopRecycled.status,
    0,
    `stop recycled pid failed:\nstdout: ${stopRecycled.stdout}\nstderr: ${stopRecycled.stderr}`,
  );
  assert.equal(existsSync(studioJsonPath), false, "stale studio.json should be cleared");
  assert.equal(benign.exitCode, null, "non-studio process must still be alive");
  assert.doesNotThrow(() => process.kill(benign.pid, 0));
});

test("live.mjs --detach returns promptly when the film has an initial Vite build error", async (t) => {
  const dir = makeTempDemoFilm("live-build-err-");
  writeFileSync(join(dir, "src/scene.ts"), "export const broken = ;\n");
  const port = await freePort();
  let pid = null;

  t.after(() => {
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const runLive = (...args) =>
    spawnSync(process.execPath, [LIVE_SCRIPT, String(port), ...args], {
      cwd: STUDIO,
      env: { ...process.env, LIVE_PROJECT: dir },
      encoding: "utf8",
      timeout: 30000,
    });

  const t0 = Date.now();
  const detach = runLive("--detach");
  const elapsed = Date.now() - t0;
  assert.equal(
    detach.status,
    0,
    `detach on syntax-error film failed:\nstdout: ${detach.stdout}\nstderr: ${detach.stderr}`,
  );
  assert.ok(elapsed < 25000, `detach should not wait for 30s timeout (took ${elapsed}ms)`);
  assert.match(detach.stdout, new RegExp(`http://localhost:${port}`));
  assert.match(detach.stdout, /build error/i);
  assert.match(detach.stdout, /pid:\s*\d+/);
  assert.match(detach.stdout, /studio\.log/);

  const info = JSON.parse(readFileSync(join(dir, "renders/live/studio.json"), "utf8"));
  pid = info.pid;

  const status = runLive("--status");
  assert.equal(status.status, 0, status.stderr);

  const stop = runLive("--stop");
  assert.equal(stop.status, 0, stop.stderr);
  pid = null;
});

test("app/index.html provides an inline Flexoki dark loading shell and hides it when showFailure renders <pre>", () => {
  const html = readFileSync(INDEX_HTML, "utf8");
  assert.match(
    html,
    /<style>[\s\S]*@layer\s+base\s*\{[\s\S]*html,\s*body[\s\S]*#100F0F[\s\S]*#CECDC3[\s\S]*color-scheme:\s*dark[\s\S]*\}[\s\S]*<\/style>/i,
  );
  assert.match(html, /body:has\(#root \+ pre\)\s*#studio-boot\s*\{[\s\S]*display:\s*none/i);
  assert.match(html, /<div id="root">[\s\S]*id="studio-boot"[\s\S]*Starting Studio…[\s\S]*<\/div>/);
  assert.match(html, /Couldn’t load Studio\. Check your connection, then reload\./);
});

test("lookAtClick skips colorWrite:false, zero-opacity transparent, non-depthWrite transparent, noPick ancestors, and all-invisible multi-material meshes", async (t) => {
  withBrowserGlobals(t);
  const { S } = await import("../app/core/state.ts");
  const { lookAtClick, lookOnPlane } = await import("../app/picture/look.ts");
  const prevTools = S.tools;
  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 5, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const makePlane = (name, y, material) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
      mesh.name = name;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, y, 0);
      mesh.updateMatrixWorld(true);
      return mesh;
    };

    const shadowCeiling = makePlane(
      "shadow_ceiling",
      4,
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    const zeroOpacity = makePlane(
      "zero_opacity",
      3.5,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: true }),
    );
    const ghostOverlay = makePlane(
      "ghost_overlay",
      3.0,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false }),
    );
    const negativeOpacity = makePlane(
      "negative_opacity",
      2.9,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: -0.1, depthWrite: true }),
    );
    const matInvisible = makePlane(
      "mat_invisible",
      2.85,
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    const meshInvisible = makePlane("mesh_invisible", 2.8, new THREE.MeshBasicMaterial());
    meshInvisible.visible = false;
    const selfNoPick = makePlane("self_no_pick", 2.75, new THREE.MeshBasicMaterial());
    selfNoPick.userData.noPick = true;
    const noPickGroup = new THREE.Group();
    noPickGroup.userData.noPick = true;
    noPickGroup.add(makePlane("inside_no_pick", 2.5, new THREE.MeshBasicMaterial()));
    noPickGroup.updateMatrixWorld(true);

    const makeMultiBox = (name, y, materials) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4), materials);
      mesh.name = name;
      mesh.position.set(0, y, 0);
      mesh.updateMatrixWorld(true);
      return mesh;
    };

    const allInvisibleMulti = makeMultiBox("all_invisible_multi", 2.0, [
      new THREE.MeshBasicMaterial({ colorWrite: false }),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    ]);

    const invisibleTopBottomMulti = makeMultiBox("invisible_top_bottom_multi", 1.5, [
      new THREE.MeshBasicMaterial({ color: 0x334455 }),
      new THREE.MeshBasicMaterial({ color: 0x334455 }),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
      new THREE.MeshBasicMaterial({ color: 0x334455 }),
      new THREE.MeshBasicMaterial({ color: 0x334455 }),
    ]);

    const realFloor = makePlane("real_floor", 0, new THREE.MeshBasicMaterial({ color: 0x888888 }));

    scene.add(
      shadowCeiling,
      zeroOpacity,
      ghostOverlay,
      negativeOpacity,
      matInvisible,
      meshInvisible,
      selfNoPick,
      noPickGroup,
      allInvisibleMulti,
      invisibleTopBottomMulti,
      realFloor,
    );
    scene.updateMatrixWorld(true);

    S.tools = { scene, camera, objects: [[realFloor, "real_floor"]] };

    const hit = lookAtClick(0.5, 0.5);
    assert.equal(hit.what, "real_floor");
    assert.deepEqual(hit.world, [0, 0, 0]);

    const topFaceMat = new THREE.MeshBasicMaterial({ color: 0x22aa44 });
    const mixedMulti = makeMultiBox("mixed_multi", 1.0, [
      new THREE.MeshBasicMaterial({ colorWrite: false }),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
      topFaceMat,
      new THREE.MeshBasicMaterial({ colorWrite: false }),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
    ]);
    scene.add(mixedMulti);
    scene.updateMatrixWorld(true);
    S.tools = {
      scene,
      camera,
      objects: [[realFloor, "real_floor"]],
      materials: [[topFaceMat, "green_top_face"]],
    };

    const mixedHit = lookAtClick(0.5, 0.5);
    assert.equal(mixedHit.what, "green_top_face");
    assert.deepEqual(mixedHit.world, [0, 1.1, 0]);

    const opaqueZeroOpacity = makePlane(
      "opaque_zero_opacity",
      1.25,
      new THREE.MeshBasicMaterial({ transparent: false, opacity: 0, color: 0x445566 }),
    );
    scene.add(opaqueZeroOpacity);
    scene.updateMatrixWorld(true);
    S.tools = {
      scene,
      camera,
      objects: [
        [realFloor, "real_floor"],
        [opaqueZeroOpacity, "opaque_zero_opacity"],
      ],
    };
    const opaqueHit = lookAtClick(0.5, 0.5);
    assert.equal(opaqueHit.what, "opaque_zero_opacity");
    assert.deepEqual(opaqueHit.world, [0, 1.25, 0]);

    assert.deepEqual(lookOnPlane(0.5, 0.5, 2), [0, 2, 0]);
    camera.lookAt(0, 10, 0);
    camera.updateMatrixWorld(true);
    assert.equal(lookOnPlane(0.5, 0.5, 0), null);
  } finally {
    S.tools = prevTools;
  }
});

test("simplifyPenPoints and markHits preserve pen bends (capped at 6) and box center + 4 corners with horizontal plane fallback", async (t) => {
  withBrowserGlobals(t);
  const { inkWords, markHits, simplifyPenPoints } = await import("../app/notes/ink.ts");
  const straight = Array.from({ length: 20 }, (_, i) => [0.1 + i * 0.04, 0.5]);
  assert.deepEqual(simplifyPenPoints(straight), [straight[0], straight.at(-1)]);

  const lShape = [
    [0.1, 0.2],
    [0.2, 0.2],
    [0.3, 0.2],
    [0.4, 0.2],
    [0.4, 0.3],
    [0.4, 0.5],
    [0.4, 0.7],
  ];
  const simplifiedL = simplifyPenPoints(lShape);
  assert.equal(simplifiedL.length, 3);
  assert.deepEqual(simplifiedL, [
    [0.1, 0.2],
    [0.4, 0.2],
    [0.4, 0.7],
  ]);

  const circle = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 35) * Math.PI * 2;
    return [0.5 + 0.2 * Math.cos(a), 0.5 + 0.2 * Math.sin(a)];
  });
  const simplifiedCircle = simplifyPenPoints(circle, 0.015, 6);
  assert.ok(simplifiedCircle.length >= 4 && simplifiedCircle.length <= 6);
  assert.deepEqual(simplifiedCircle[0], circle[0]);
  assert.deepEqual(simplifiedCircle.at(-1), circle.at(-1));

  const zigzag = Array.from({ length: 25 }, (_, i) => [i / 24, i % 2 === 0 ? 0.2 : 0.8]);
  const capped = simplifyPenPoints(zigzag, 0.015, 6);
  assert.equal(capped.length, 6);
  assert.deepEqual(capped[0], zigzag[0]);
  assert.deepEqual(capped.at(-1), zigzag.at(-1));

  const penMark = { kind: "pen", t: 2, pts: lShape };
  const fakeLook = (x, y) => ({
    what: `p_${Math.round(x * 10)}_${Math.round(y * 10)}`,
    world: [+(x * 10).toFixed(1), 0, +(y * 10).toFixed(1)],
  });
  markHits(penMark, { look: fakeLook, plane: () => null });
  assert.equal(
    penMark.pts.length,
    lShape.length,
    "original pts stay untouched for smooth rendering",
  );
  assert.deepEqual(penMark.keyPts, simplifiedL);
  assert.equal(penMark.hits.length, 3);
  assert.equal(inkWords([penMark]), "pen stroke 00:02.000: p_1_2 … p_4_7");

  const planeCalls = [];
  const boxMark = {
    kind: "box",
    t: 3,
    pts: [
      [0.8, 0.7],
      [0.2, 0.3],
    ],
  };
  markHits(boxMark, {
    look: (x, y) => {
      if (Math.abs(x - 0.5) < 1e-6 && Math.abs(y - 0.5) < 1e-6)
        return { what: "table", world: [2, 1.5, 3] };
      if (Math.abs(x - 0.2) < 1e-6 && Math.abs(y - 0.3) < 1e-6)
        return { what: "wall", world: [0, 2, 1] };
      return { what: "empty space" };
    },
    plane: (x, y, planeY) => {
      planeCalls.push([x, y, planeY]);
      return [+(x * 10).toFixed(1), planeY, +(y * 10).toFixed(1)];
    },
  });
  assert.equal(boxMark.hits.length, 5);
  assert.deepEqual(boxMark.hits[0], { what: "table", world: [2, 1.5, 3] });
  assert.deepEqual(boxMark.hits[1], { what: "wall", world: [0, 2, 1] });
  assert.deepEqual(boxMark.hits[2], { what: "empty space", world: [8, 1.5, 3] });
  assert.deepEqual(boxMark.hits[3], { what: "empty space", world: [8, 1.5, 7] });
  assert.deepEqual(boxMark.hits[4], { what: "empty space", world: [2, 1.5, 7] });
  assert.equal(
    planeCalls.every(([, , y]) => y === 1.5),
    true,
  );

  const emptyBox = {
    kind: "box",
    t: 4,
    pts: [
      [0.1, 0.1],
      [0.9, 0.9],
    ],
  };
  const zeroPlanes = [];
  markHits(emptyBox, {
    look: () => ({ what: "empty space" }),
    plane: (_x, _y, planeY) => {
      zeroPlanes.push(planeY);
      return [0, planeY, 0];
    },
  });
  assert.deepEqual(zeroPlanes, [0, 0, 0, 0]);
});

test("note-detail prints srcT when diverged, prints pen key vertices and box corners, and omits empty voice/lesson boilerplate", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "note-detail-ux-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ voice: { lines: [] }, beats: {} }));

  const format = noteDetailFormat({ root: dir, dir: join(dir, "lessons") });

  const richOut = format(
    {
      n: 1,
      id: "abc1",
      t: 17.22,
      srcT: 12.967,
      time: "00:17.220",
      frame: 517,
      shot: 2,
      shotName: "kitchen",
      text: "check curve and box",
      context: {
        shot: { from: 10, to: 20, into: 7.22 },
        voice: { silence: true },
        beats: [],
      },
      marks: [
        {
          kind: "pen",
          t: 17.22,
          pts: [
            [0.1, 0.2],
            [0.4, 0.2],
            [0.4, 0.7],
          ],
          keyPts: [
            [0.1, 0.2],
            [0.4, 0.2],
            [0.4, 0.7],
          ],
          hits: [
            { what: "floor", world: [1, 0, 2] },
            { what: "corner", world: [4, 0, 2] },
            { what: "wall", world: [4, 0, 7] },
          ],
        },
        {
          kind: "box",
          t: 17.22,
          pts: [
            [0.2, 0.3],
            [0.8, 0.7],
          ],
          hits: [
            { what: "table", world: [5, 1, 5] },
            { what: "tl", world: [2, 1, 3] },
            { what: "tr", world: [8, 1, 3] },
            { what: "br", world: [8, 1, 7] },
            { what: "bl", world: [2, 1, 7] },
          ],
        },
      ],
    },
    false,
    { picks: [] },
  ).join("\n");

  assert.match(richOut, /## #1 abc1 00:17\.220 \(scene 00:12\.967\) frame 517, shot 2: kitchen/);
  assert.ok(
    richOut.includes(
      'drawn: pen at 17.22s: (10%, 20%) on "floor" world [1, 0, 2] -> (40%, 20%) on "corner" world [4, 0, 2] -> (40%, 70%) on "wall" world [4, 0, 7]',
    ),
    richOut,
  );
  assert.ok(richOut.includes('middle (50%, 50%) on "table" world [5, 1, 5]'), richOut);
  assert.ok(richOut.includes('TL (20%, 30%) on "tl" world [2, 1, 3]'), richOut);
  assert.ok(richOut.includes('BR (80%, 70%) on "br" world [8, 1, 7]'), richOut);
  assert.ok(
    !richOut.includes("voice: silent here"),
    `should omit empty voice boilerplate:\n${richOut}`,
  );
  assert.ok(
    !richOut.includes("Jev says none fits"),
    `should omit empty lesson boilerplate:\n${richOut}`,
  );

  const legacyOut = format(
    {
      n: 2,
      id: "leg1",
      t: 5.0,
      srcT: 5.004,
      time: "00:05.000",
      shot: 0,
      text: "legacy",
      marks: [
        {
          kind: "pen",
          t: 5,
          pts: [
            [0.1, 0.1],
            [0.9, 0.9],
          ],
          hits: [{ what: "a" }, { what: "b" }],
        },
        {
          kind: "box",
          t: 5,
          pts: [
            [0.2, 0.3],
            [0.8, 0.7],
          ],
          hits: [{ what: "door" }],
        },
      ],
    },
    false,
    undefined,
  ).join("\n");

  assert.doesNotMatch(legacyOut, /\(scene /);
  const frozenOut = format(
    { n: 4, id: "frz1", t: 2.5, srcT: 0, time: "00:02.500", shot: 0, text: "held start" },
    false,
    undefined,
  ).join("\n");
  assert.match(frozenOut, /## #4 frz1 00:02\.500 \(scene 00:00\.000\) shot 0/);
  assert.ok(
    legacyOut.includes('drawn: pen at 5s: from (10%, 10%) on "a", to (90%, 90%) on "b"'),
    legacyOut,
  );
  assert.ok(
    legacyOut.includes('drawn: box at 5s: 20-80% across, 30-70% down, middle (50%, 50%) on "door"'),
    legacyOut,
  );
  assert.ok(!legacyOut.includes("corners:"), legacyOut);

  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(
    join(dir, "renders/live/voice_map.json"),
    JSON.stringify({ lines: [{ s: 0, e: 2, text: "Hello" }] }),
  );
  const withVoiceFormat = noteDetailFormat({ root: dir, dir: join(dir, "lessons") });
  const voicedSilence = withVoiceFormat(
    {
      n: 3,
      id: "v1",
      t: 5,
      time: "00:05.000",
      shot: 0,
      text: "during pause",
      context: { shot: { from: 0, to: 10, into: 5 }, voice: { silence: true }, beats: [] },
    },
    false,
    undefined,
  ).join("\n");
  assert.ok(voicedSilence.includes("voice: silent here"), voicedSilence);
});

test("notes.mjs prints local-<8hex> fingerprint instead of parent-repo git hash for local/untracked films and updates when src/ changes", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "notes-gitignore-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  writeFileSync(join(repo, ".gitignore"), "films/\n");
  mkdirSync(join(repo, "tracked/notes"), { recursive: true });
  const sampleNote = JSON.stringify({
    id: "n1",
    t: 2,
    at: "2026-11-20T00:00:00Z",
    time: "00:02.000",
    shot: 0,
    text: "hello",
  });
  writeFileSync(join(repo, "tracked/notes/notes.jsonl"), `${sampleNote}\n`);
  execFileSync("git", ["add", ".gitignore", "tracked/notes/notes.jsonl"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
  const commitHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();

  const ignoredFilm = join(repo, "films/my-local-film");
  mkdirSync(join(ignoredFilm, "notes"), { recursive: true });
  mkdirSync(join(ignoredFilm, "src"), { recursive: true });
  writeFileSync(join(ignoredFilm, "package.json"), JSON.stringify({ name: "my-local-film" }));
  writeFileSync(join(ignoredFilm, "src/scene.ts"), "export const v = 1;\n");
  writeFileSync(join(ignoredFilm, "notes/notes.jsonl"), `${sampleNote}\n`);

  const ignoredOut1 = execFileSync(process.execPath, [NOTES_SCRIPT], {
    cwd: ignoredFilm,
    encoding: "utf8",
    env: { ...process.env, MC_LESSONS: join(repo, "no-lessons") },
  });
  const m1 = /Film now: (local-[0-9a-f]{8})\./.exec(ignoredOut1);
  assert.ok(m1, `expected local-<8hex>:\n${ignoredOut1}`);
  assert.ok(!ignoredOut1.includes(commitHash), `should not leak parent hash:\n${ignoredOut1}`);

  writeFileSync(join(ignoredFilm, "src/scene.ts"), "export const v = 2;\n");
  const ignoredOut2 = execFileSync(process.execPath, [NOTES_SCRIPT], {
    cwd: ignoredFilm,
    encoding: "utf8",
    env: { ...process.env, MC_LESSONS: join(repo, "no-lessons") },
  });
  const m2 = /Film now: (local-[0-9a-f]{8})\./.exec(ignoredOut2);
  assert.ok(m2, `expected local-<8hex>:\n${ignoredOut2}`);
  assert.notEqual(m2[1], m1[1], "changing src/ must update local version stamp");

  const untrackedFilm = join(repo, "local-films/untracked-film");
  mkdirSync(join(untrackedFilm, "notes"), { recursive: true });
  mkdirSync(join(untrackedFilm, "src"), { recursive: true });
  writeFileSync(join(untrackedFilm, "src/scene.ts"), "export const u = 1;\n");
  writeFileSync(join(untrackedFilm, "notes/notes.jsonl"), `${sampleNote}\n`);
  const untrackedOut = execFileSync(process.execPath, [NOTES_SCRIPT], {
    cwd: untrackedFilm,
    encoding: "utf8",
    env: { ...process.env, MC_LESSONS: join(repo, "no-lessons") },
  });
  assert.match(untrackedOut, /Film now: local-[0-9a-f]{8}\./);
  assert.ok(!untrackedOut.includes(commitHash), `should not leak parent hash:\n${untrackedOut}`);

  const trackedOut = execFileSync(process.execPath, [NOTES_SCRIPT], {
    cwd: join(repo, "tracked"),
    encoding: "utf8",
    env: { ...process.env, MC_LESSONS: join(repo, "no-lessons") },
  });
  assert.ok(trackedOut.includes(commitHash), trackedOut);
});

test("linkage.mjs skips identity no-ops, folds pure-speed edits/resets without bloat, and preserves non-bijective cut history", () => {
  const flat = timingPlan({});
  const s15 = timingPlan({ speeds: [{ from: 0, to: 10, rate: 1.5 }] });
  const s20 = timingPlan({ speeds: [{ from: 0, to: 10, rate: 2.0 }] });
  const s05 = timingPlan({ speeds: [{ from: 0, to: 10, rate: 0.5 }] });

  const noop = {};
  recordLinkage(noop, flat, flat, true, LINKAGE_DEFAULTS);
  recordLinkage(noop, {}, { speeds: undefined, main: undefined }, true, LINKAGE_DEFAULTS);
  assert.equal(noop.layerKinds, undefined);

  const t = {};
  for (const [before, after] of [
    [flat, s15],
    [s15, s20],
    [s20, s05],
  ]) {
    Object.assign(t, structuredClone(after));
    recordLinkage(t, before, after, true, LINKAGE_DEFAULTS);
  }
  assert.equal(compileLayerTiming(t, 10, "text").outputAt(4), 8);
  assert.equal(compileLayerTiming(t, 10, "audio").outputAt(4), 4);
  for (const kind of Object.keys(LINKAGE_DEFAULTS)) {
    assert.equal(
      t.layerKinds[kind].changes.length,
      0,
      `${kind} should fold pure-speed chain into base`,
    );
  }

  Object.assign(t, structuredClone(flat));
  recordLinkage(t, s05, flat, true, LINKAGE_DEFAULTS);
  assert.equal(t.layerKinds, undefined);
  assert.equal(compileLayerTiming(t, 10, "text").outputAt(4), 4);
  assert.equal(compileLayerTiming(t, 10, "audio").outputAt(4), 4);

  const mid = {};
  Object.assign(mid, structuredClone(s20));
  recordLinkage(mid, flat, s20, true, LINKAGE_DEFAULTS);
  Object.assign(mid, structuredClone(s05));
  recordLinkage(mid, s20, s05, true, { ...LINKAGE_DEFAULTS, audio: true });
  Object.assign(mid, structuredClone(s15));
  recordLinkage(mid, s05, s15, true, { ...LINKAGE_DEFAULTS, audio: true });
  assert.equal(mid.layerKinds.audio.changes.length, 1);
  const reference = {
    ...s15,
    layers: {
      base: flat,
      changes: [
        { before: s20, after: s05 },
        { before: s05, after: s15 },
      ],
    },
  };
  const actualClock = compileLayerTiming(mid, 10, "audio");
  const refClock = compileLayerTiming(reference, 10, "audio");
  for (const x of [0, 1, 3.5, 5, 8.2, 10]) {
    assert.ok(Math.abs(actualClock.outputAt(x) - refClock.outputAt(x)) < 1e-6);
  }

  const cut = timingPlan({ cuts: [{ from: 2, to: 5 }] });
  const cutTiming = {};
  Object.assign(cutTiming, structuredClone(cut));
  recordLinkage(cutTiming, flat, cut, true, LINKAGE_DEFAULTS);
  Object.assign(cutTiming, structuredClone(flat));
  recordLinkage(cutTiming, cut, flat, true, LINKAGE_DEFAULTS);
  assert.equal(cutTiming.layerKinds.text.changes.length, 2);
  assert.equal(compileLayerTiming(cutTiming, 10, "text").visible(3), false);

  const gap = timingPlan({ gaps: [{ from: 2, to: 4 }] });
  const gapTiming = {};
  Object.assign(gapTiming, structuredClone(gap));
  recordLinkage(gapTiming, flat, gap, true, LINKAGE_DEFAULTS);
  Object.assign(gapTiming, structuredClone(flat));
  recordLinkage(gapTiming, gap, flat, true, LINKAGE_DEFAULTS);
  assert.equal(gapTiming.layerKinds.text.changes.length, 2);
  assert.equal(compileLayerTiming(gapTiming, 10, "text").visible(3), false);
});
