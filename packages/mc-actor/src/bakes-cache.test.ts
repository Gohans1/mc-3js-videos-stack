import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as THREE from "three";

import { makePlayer } from "./player";

async function makeTestPlayer() {
  const prevImage = (globalThis as { Image?: unknown }).Image;
  (globalThis as { Image?: unknown }).Image = class {
    width = 64;
    height = 64;
    onload: (() => void) | null = null;
    set src(_url: string) {
      queueMicrotask(() => this.onload?.());
    }
  };
  const prevDoc = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 64,
      height: 64,
      getContext() {
        return {
          canvas: this,
          drawImage() {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
          }),
          putImageData() {},
          fillRect() {},
          fillStyle: "",
        };
      },
    }),
  };
  try {
    const template = new THREE.Group();
    const bone = (name: string, x: number, y: number, z: number) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      return b;
    };
    const root = bone("center", 0, 0.75, 0);
    const body = bone("Body", 0, 0, 0);
    const chest = bone("Chest", 0, 0.35, 0);
    const head = bone("Head", 0, 0.35, 0);
    const uaL = bone("ArmLeftUpper", 0.3, 0.3, 0);
    const laL = bone("ArmLeftLower", 0, -0.35, 0);
    const uaR = bone("ArmRightUpper", -0.3, 0.3, 0);
    const laR = bone("ArmRightLower", 0, -0.35, 0);
    const ulL = bone("LegLeftUpper", 0.12, -0.05, 0);
    const llL = bone("LegLeftLower", 0, -0.35, 0);
    const ulR = bone("LegRightUpper", -0.12, -0.05, 0);
    const llR = bone("LegRightLower", 0, -0.35, 0);
    template.add(root);
    root.add(body, ulL, ulR);
    body.add(chest);
    chest.add(head, uaL, uaR);
    uaL.add(laL);
    uaR.add(laR);
    ulL.add(llL);
    ulR.add(llR);
    return await makePlayer(template, "test-skin.png");
  } finally {
    if (prevImage === undefined) delete (globalThis as { Image?: unknown }).Image;
    else (globalThis as { Image?: unknown }).Image = prevImage;
    (globalThis as { document?: unknown }).document = prevDoc;
  }
}

function installMemoryIdb() {
  const stores = new Map<string, Map<unknown, unknown>>();
  let openCount = 0;
  let unclosedCount = 0;

  const asyncReq = <T>(run: () => T) => {
    const req: {
      result?: T;
      error?: unknown;
      onsuccess?: (() => void) | null;
      onerror?: (() => void) | null;
      onupgradeneeded?: (() => void) | null;
    } = {};
    queueMicrotask(() => {
      try {
        req.result = run();
        req.onsuccess?.();
      } catch (err) {
        req.error = err;
        req.onerror?.();
      }
    });
    return req;
  };

  const prev = (globalThis as { indexedDB?: unknown }).indexedDB;
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open(name: string) {
      openCount++;
      if (!stores.has(name)) stores.set(name, new Map());
      const map = stores.get(name)!;
      const req: {
        result: unknown;
        onsuccess?: (() => void) | null;
        onerror?: (() => void) | null;
        onupgradeneeded?: (() => void) | null;
      } = {
        result: null,
      };
      let closed = false;
      const db = {
        objectStoreNames: { contains: (s: string) => s === "bakes" },
        createObjectStore: () => ({}),
        close() {
          if (!closed) {
            closed = true;
            unclosedCount--;
          }
        },
        transaction(_name: string, _mode: string) {
          const tx: {
            oncomplete?: (() => void) | null;
            onerror?: (() => void) | null;
            onabort?: (() => void) | null;
            objectStore: () => unknown;
          } = {
            objectStore: () => storeApi,
          };
          let pending = 0;
          let flushed = false;
          const finishSoon = () => {
            if (flushed) return;
            queueMicrotask(() => {
              if (pending === 0 && !flushed) {
                flushed = true;
                tx.oncomplete?.();
              }
            });
          };
          const track = <T>(fn: () => T) => {
            pending++;
            return asyncReq(() => {
              try {
                return fn();
              } finally {
                pending--;
                finishSoon();
              }
            });
          };
          const storeApi = {
            get: (k: unknown) => track(() => map.get(k)),
            put: (v: unknown, k: unknown) => track(() => (map.set(k, v), k)),
            delete: (k: unknown) => track(() => (map.delete(k), undefined)),
            getAllKeys: () => track(() => [...map.keys()]),
          };
          finishSoon();
          return tx;
        },
      };
      queueMicrotask(() => {
        unclosedCount++;
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };

  return {
    map: () => stores.get("mc-actor-bakes") ?? new Map(),
    stats: () => ({ openCount, unclosedCount }),
    restore: () => {
      (globalThis as { indexedDB?: unknown }).indexedDB = prev;
    },
  };
}

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

async function buildHashedModule(entry: string, tag = "AbCdEf12") {
  const outDir = mkdtempSync(join(tmpdir(), "mc-actor-hash-"));
  tmpDirs.push(outDir);
  const out = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    format: "esm",
    target: "browser",
    naming: `[name]-${tag}.[ext]`,
  });
  if (!out.success) throw new Error(out.logs.map((l) => l.message).join("\n"));
  const file = out.outputs.find((o) => o.kind === "entry-point")!.path;
  const url = pathToFileURL(file).href;
  return { mod: await import(url), url };
}

test("feet.warm hashes rest rig + g.scale regardless of active pose and closes IDB connections", async () => {
  const idb = installMemoryIdb();
  try {
    const { mod: feetMod } = await buildHashedModule(join(import.meta.dir, "feet.ts"), "Feet1234");
    const { makeFeet } = feetMod;
    const player = await makeTestPlayer();
    let bakes = 0;
    const bodyAt = (moves: unknown[], t: number) => {
      if (t === 0) bakes++;
      return {
        at: [0, 0, t],
        yaw: 0,
        pose: moves.length ? { ulL: [20, 0, 0] } : {},
        gait: null,
      };
    };
    const moves = [{ t: 0, at: [0, 0, 0], yaw: 0, pose: "stand" }];

    // 1. Warm at rest
    player.setPose({});
    const feetA = makeFeet(player, () => 0.5, bodyAt, {});
    await feetA.warm(moves, "https://studio/app-AbCdEf12.js");
    expect(bakes).toBe(1);
    const keysAfterRest = [...idb.map().keys()];
    expect(keysAfterRest.length).toBe(1);
    expect(idb.stats().unclosedCount).toBe(0);

    // 2. Pose the actor dynamically before calling warm() on a fresh instance -> must hit same cache key without mutating pose
    player.setPose({ root: { y: 0.35, rx: 22 }, ulL: [55, 0, 0], llL: [-70, 0, 0] });
    const poseQBefore = player.bones.ulL.quaternion.toArray();
    const feetB = makeFeet(player, () => 0.5, bodyAt, {});
    await feetB.warm(moves, "https://studio/app-AbCdEf12.js");
    expect(bakes).toBe(1); // IndexedDB hit, no rebake!
    expect([...idb.map().keys()]).toEqual(keysAfterRest);
    expect(player.bones.ulL.quaternion.toArray()).toEqual(poseQBefore);
    expect(idb.stats().unclosedCount).toBe(0);

    // 3. Scaling player.g changes kinematics in legsAt -> must produce a distinct slot key
    player.g.scale.set(1.5, 1.5, 1.5);
    const feetScaled = makeFeet(player, () => 0.5, bodyAt, {});
    await feetScaled.warm(moves, "https://studio/app-AbCdEf12.js");
    expect(bakes).toBe(2);
    expect(idb.map().size).toBe(2);
    expect(idb.stats().unclosedCount).toBe(0);
  } finally {
    idb.restore();
  }
});

test("clips.keptBakes preserves valid sibling rig/FPS scopes within the same build and awaits stale deletes", async () => {
  const idb = installMemoryIdb();
  try {
    const { mod: clipsMod, url: clipsUrl } = await buildHashedModule(
      join(import.meta.dir, "clips.ts"),
      "Clips123",
    );
    const keptBakes = clipsMod.keptBakes;
    expect(typeof keptBakes).toBe("function");

    const rigA = await makeTestPlayer();
    const rigB = await makeTestPlayer();
    rigB.g.scale.set(1.25, 1.25, 1.25);

    const bytesA = new TextEncoder().encode("clip-bytes-a");
    const bytesB = new TextEncoder().encode("clip-bytes-b");
    const fakeBake = { fps: 30, last: {} };

    // Rig A bakes and flushes at 30fps
    const storeA = await keptBakes(rigA, 30);
    expect(storeA).not.toBeNull();
    expect(await storeA.get("ual1/Walk", async () => [bytesA])).toBeNull();
    storeA.put("ual1/Walk", fakeBake);
    await storeA.flush();
    const rigAKey = [...idb.map().keys()].find((k) => String(k).includes("ual1/Walk")) as string;
    expect(rigAKey).toBeTruthy();

    // Rig B in the same build MUST NOT evict Rig A's payload bake!
    const storeB = await keptBakes(rigB, 60);
    expect(storeB).not.toBeNull();
    expect(await storeB.get("ual1/Walk", async () => [bytesB])).toBeNull();
    storeB.put("ual1/Walk", fakeBake);
    await storeB.flush();
    expect(idb.map().has(rigAKey)).toBe(true);

    // A later old-build startup DOES evict previous build's scopes and awaits deletion before returning
    const oldMetaKey = `meta:clips:${"a".repeat(64)}`;
    const oldDataKey = `${"a".repeat(64)} ual1/Run ${"b".repeat(64)}`;
    const oldFeetKey = `meta:feet:${"c".repeat(64)}`;
    const curFeetKey = `meta:feet:${"d".repeat(64)}`;
    idb.map().set(oldMetaKey, { ver: "/old-build.js", entries: {} });
    idb.map().set(oldDataKey, { old: true });
    idb.map().set(oldFeetKey, { ver: "/old-build.js", key: "old" });
    idb.map().set(curFeetKey, {
      ver: clipsUrl,
      key: "cur",
    });
    idb.map().set("meta:prefetch", { ver: "/old-build.js", clips: {} });
    const storeA2 = await keptBakes(rigA, 30);
    expect(storeA2).not.toBeNull();
    expect(idb.map().has(oldDataKey)).toBe(false);
    expect(idb.map().has(oldMetaKey)).toBe(false);
    expect(idb.map().has(oldFeetKey)).toBe(false);
    expect(idb.map().has(curFeetKey)).toBe(true);
  } finally {
    idb.restore();
  }
});
