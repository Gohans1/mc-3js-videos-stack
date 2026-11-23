// @ts-nocheck
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

import { bakeClip, framesAt, MIXAMO, retargeter, skeletonSource, UAL, UE } from "./mocap";

const GLTF_LIBS = {
  ual1: {
    file: "motion/ual1/AnimationLibrary_Godot_Standard.gltf",
    buffers: ["AnimationLibrary_Godot_Standard.bin"],
    names: UAL,
  },
  ual2: { file: "motion/ual2/UAL2_Standard.glb", buffers: [] as string[], names: UE },
};
const gltfs = new Map();
const gltfOf = (lib) => {
  if (!gltfs.has(lib))
    gltfs.set(
      lib,
      libFiles(lib).then((files) => parseGltf(GLTF_LIBS[lib].file, files)),
    );
  return gltfs.get(lib);
};

export async function clipNames(lib) {
  if (lib === "mixamo") return (await fetch("motion/mixamo/_tools/clips.json")).json();
  return (await gltfOf(lib)).animations.map((a) => a.name);
}

export async function loadSource(ref, files = clipFiles(ref)) {
  const [lib, name] = ref.split(/\/(.*)/s);
  if (lib === "mixamo") return fbxSource(ref, fbxOf(fbxUrl(name), (await files)[0]));
  const L = GLTF_LIBS[lib];
  if (!L)
    throw new Error(
      `mocap clip ${ref}: no library "${lib}" (mixamo, ${Object.keys(GLTF_LIBS).join(", ")})`,
    );
  const gl = await gltfOf(lib);
  const clip = gl.animations.find((a) => a.name === name);
  if (!clip) throw new Error(`mocap clip ${ref}: not in ${L.file}`);
  // every clip of a library shares one scene: a fresh copy, so no earlier clip's last frame becomes this one's rest
  const root = clone(gl.scene);
  return { root, names: L.names, clip };
}
const fbxUrl = (name) => `motion/mixamo/${name}.fbx`;
const fbxSource = (ref, root) => {
  root.scale.setScalar(0.01); // Mixamo works in centimetres
  if (!root.animations[0]) throw new Error(`mocap clip ${ref}: the FBX holds no animation`);
  return { root, names: MIXAMO, clip: root.animations[0] };
};

const CLIP_KEY = Symbol.for("mc-actor.clipKey");
const HASHED_SCRIPT = /\/[^/]+-[A-Za-z0-9_-]{6,}\.[cm]?js(?:$|\?)/;
const cleanUrl = (u) => {
  const i = u.search(/[?#]/);
  return i >= 0 ? u.slice(0, i) : u;
};
const scriptTag = (u = import.meta.url) => {
  const c = cleanUrl(u);
  return HASHED_SCRIPT.test(c) ? c : null;
};
const decodeSafe = (p) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};
const urlPath = (url) => {
  try {
    return typeof location !== "undefined" ? new URL(url, location.href).pathname : url;
  } catch {
    return url;
  }
};
const stripEtag = (t) => (t ? t.replace(/^W\//, "").replace(/^"|"$/g, "") : null);
const bootTagFor = (url) => {
  const tags = globalThis.__STUDIO_BOOT?.tags;
  if (!tags) return null;
  const p = urlPath(url);
  return tags[p] ?? tags[decodeSafe(p)] ?? null;
};
const fileTags = new Map();
const fileBytes = async (url) => {
  if (typeof fetch !== "function")
    return new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(url);
  const manager = THREE.DefaultLoadingManager;
  manager.itemStart(url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const tag = bootTagFor(url) ?? stripEtag(res.headers.get("etag"));
    if (tag) fileTags.set(url, tag);
    const buf = await res.arrayBuffer();
    manager.itemEnd(url);
    return buf;
  } catch (e) {
    manager.itemError(url);
    manager.itemEnd(url);
    throw e;
  }
};
const mixamoFiles = new Map();
const clipUrls = new Map();
const clipFiles = (ref) => {
  const [lib, name] = ref.split(/\/(.*)/s);
  if (lib !== "mixamo") return libFiles(lib);
  const url = fbxUrl(name);
  clipUrls.set(ref, [url]);
  if (!mixamoFiles.has(url))
    mixamoFiles.set(
      url,
      fileBytes(url).then((b) => [b]),
    );
  return mixamoFiles.get(url);
};
const libFileSets = new Map();
const libUrls = new Map();
const libFiles = (lib) => {
  const entry = GLTF_LIBS[lib];
  if (!entry) return Promise.resolve([]);
  if (!libFileSets.has(lib)) libFileSets.set(lib, gltfFiles(lib, entry.file, entry.buffers));
  return libFileSets.get(lib);
};
const gltfFiles = async (lib, file, knownBuffers: string[] = []) => {
  const dir = THREE.LoaderUtils.extractUrlBase(file);
  const known = new Map(
    knownBuffers.map((u) => {
      const p = fileBytes(dir + u);
      p.catch(() => {});
      return [u, p];
    }),
  );
  const mainP = fileBytes(file);
  const main = await mainP;
  if (!file.endsWith(".gltf")) {
    libUrls.set(lib, [file]);
    return [main];
  }
  const uris = (JSON.parse(new TextDecoder().decode(main)).buffers ?? [])
    .map((b) => b.uri)
    .filter((u) => u && !u.startsWith("data:"));
  libUrls.set(lib, [file, ...uris.map((u) => dir + u)]);
  return [main, ...(await Promise.all(uris.map((u) => known.get(u) ?? fileBytes(dir + u))))];
};
const tagsForRef = (ref) => {
  const [lib] = ref.split(/\/(.*)/s);
  const urls = lib === "mixamo" ? clipUrls.get(ref) : libUrls.get(lib);
  if (!urls?.length) return null;
  const out = {};
  for (const u of urls) {
    const tag = bootTagFor(u) ?? fileTags.get(u);
    if (!tag) return null;
    out[u] = tag;
  }
  return out;
};
export function prefetchClips(refs) {
  const unique = [...new Set(refs)];
  if (!unique.length) return;
  const ver = scriptTag();
  const tags = globalThis.__STUDIO_BOOT?.tags;
  if (!ver || !tags || typeof indexedDB === "undefined") {
    for (const ref of unique) void clipFiles(ref).catch(() => {});
    return;
  }
  void (async () => {
    try {
      const db = await openBakesDb();
      const meta = db
        ? await request(
            db.transaction("bakes", "readonly").objectStore("bakes").get("meta:prefetch"),
          ).catch(() => null)
        : null;
      for (const ref of unique) {
        const rec = meta?.ver === ver ? meta.clips?.[ref] : null;
        const entries = rec ? Object.entries(rec) : null;
        const hit = entries?.length && entries.every(([u, t]) => bootTagFor(u) === t);
        if (!hit) void clipFiles(ref).catch(() => {});
      }
    } catch {
      for (const ref of unique) void clipFiles(ref).catch(() => {});
    }
  })();
}
const fbxOf = (url, bytes) => {
  try {
    return new FBXLoader().parse(bytes, THREE.LoaderUtils.extractUrlBase(url));
  } catch (e) {
    THREE.DefaultLoadingManager.itemError(url);
    throw e;
  }
};
const parseGltf = async (file, [main, ...buffers]) => {
  const dir = THREE.LoaderUtils.extractUrlBase(file),
    blobs = new Map();
  if (buffers.length) {
    const uris = JSON.parse(new TextDecoder().decode(main)).buffers.map((b) => b.uri);
    for (const [i, u] of uris.filter((u) => u && !u.startsWith("data:")).entries())
      blobs.set(dir + u, URL.createObjectURL(new Blob([buffers[i]])));
  }
  const manager = new THREE.LoadingManager().setURLModifier((u) => blobs.get(u) ?? u);
  try {
    return await new GLTFLoader(manager).parseAsync(main, dir);
  } catch (e) {
    THREE.DefaultLoadingManager.itemError(file);
    throw e;
  } finally {
    for (const b of blobs.values()) URL.revokeObjectURL(b);
  }
};

export async function loadClip(ref, player, fps = 60) {
  return clipOf(bakeKept(await loadSource(ref), player, fps));
}
function bakeKept({ root, names, clip }, player, fps) {
  const rt = retargeter(skeletonSource(root, names), player);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const bake = bakeClip(rt, (t) => mixer.setTime(t), clip.duration, fps);
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  const last = structuredClone(bake.frames.at(-1));
  leaveAsBaked(player, last);
  const { x: x0, z: z0 } = bake.frames[0].root;
  for (const f of bake.frames) {
    f.root.x -= x0;
    f.root.z -= z0;
  }
  const { x, z, ry } = bake.frames.at(-1).root;
  return { duration: clip.duration, end: { x, z, ry }, frames: bake.frames, fps, last };
}
const clipOf = ({ duration, end, frames, fps }, clipKey = null) => {
  const out = {
    duration,
    end,
    frames,
    fps,
    at: framesAt(frames, fps),
  };
  if (clipKey) Object.defineProperty(out, CLIP_KEY, { value: clipKey, enumerable: false });
  return out;
};

const playerStores = new WeakMap();
const playerClipPromises = new WeakMap();

const storeFor = (player, fps) => {
  let byFps = playerStores.get(player);
  if (!byFps) playerStores.set(player, (byFps = new Map()));
  let p = byFps.get(fps);
  if (!p) byFps.set(fps, (p = keptBakes(player, fps)));
  return p;
};

export async function loadClips(refs, player, fps = 60) {
  const unique = [...new Set(refs)];
  if (!unique.length) return {};
  let cache = playerClipPromises.get(player);
  if (!cache) playerClipPromises.set(player, (cache = new Map()));
  const missing = unique.filter((ref) => !cache.has(`${fps}\0${ref}`));
  if (missing.length) {
    const batch = (async () => {
      const files = Array.from({ length: missing.length }),
        getFiles = (i) => (files[i] ??= clipFiles(missing[i])),
        store = storeFor(player, fps);
      const found = missing.map((ref, i) =>
        store.then((s) => s?.get(ref, () => getFiles(i)) ?? null),
      );
      const sources = missing.map(async (ref, i) =>
        (await found[i]) ? null : loadSource(ref, getFiles(i)),
      );
      for (const p of sources) p.catch(() => {});
      const loaded = missing.map(async (_ref, i) => {
        const hit = await found[i];
        return hit
          ? { hit: true, k: hit.data, key: hit.key }
          : { hit: false, src: await sources[i] };
      });
      const kept = await store;
      const out = {};
      let lastHit = null;
      for (const [i, ref] of missing.entries()) {
        const item = await loaded[i];
        let k;
        if (item.hit) {
          k = item.k;
          lastHit = k.last;
        } else {
          k = bakeKept(item.src, player, fps);
          kept?.put(ref, k);
          lastHit = null;
        }
        out[ref] = clipOf(k, item.key ?? kept?.keyOf(ref) ?? null);
      }
      if (lastHit) leaveAsBaked(player, lastHit);
      await kept?.flush();
      return out;
    })();
    for (const ref of missing) {
      const key = `${fps}\0${ref}`;
      const p = batch.then((out) => out[ref]);
      p.catch(() => {
        if (cache.get(key) === p) cache.delete(key);
      });
      cache.set(key, p);
    }
  }
  const entries = await Promise.all(
    unique.map(async (ref) => [ref, await cache.get(`${fps}\0${ref}`)]),
  );
  return Object.fromEntries(entries);
}

const DB = "mc-actor-bakes";
let dbPromise = null;
let dbHost = null;
const openBakesDb = () => {
  if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) return null;
  if (!dbPromise || dbHost !== indexedDB) {
    dbHost = indexedDB;
    dbPromise = new Promise((done, fail) => {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("bakes")) open.result.createObjectStore("bakes");
      };
      open.onsuccess = () => done(open.result);
      open.onerror = () => fail(open.error);
    }).catch(() => {
      if (dbHost === indexedDB) dbPromise = null;
      return null;
    });
  }
  return dbPromise;
};
const sha = async (parts) => {
  const each = await Promise.all(parts.map((p) => crypto.subtle.digest("SHA-256", p)));
  const all = new Uint8Array(32 * each.length);
  for (const [i, d] of each.entries()) all.set(new Uint8Array(d), 32 * i);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const bytesOf = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
};
const rigOf = (player) => {
  player.setPose({});
  const nums = [player.restLegReach ?? player.legReach],
    parts = [];
  player.g.traverse((o) => {
    if (!o.isBone && !o.isSkinnedMesh) return;
    parts.push(new TextEncoder().encode(o.name));
    nums.push(...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray());
    if (!o.isSkinnedMesh) return;
    for (const n of ["position", "skinIndex", "skinWeight"])
      parts.push(o.geometry.attributes[n].array);
    nums.push(...o.bindMatrix.elements);
    for (const m of o.skeleton.boneInverses) nums.push(...m.elements);
  });
  return [new Float64Array(nums), ...parts];
};
const request = (r) =>
  new Promise((done, fail) => {
    r.onsuccess = () => done(r.result);
    r.onerror = () => fail(r.error);
  });
export async function keptBakes(player, fps) {
  try {
    const dbP = openBakesDb();
    if (!dbP) return null;
    const ver = scriptTag();
    const enc = new TextEncoder();
    const [db, code] = await Promise.all([
      dbP,
      ver ? Promise.resolve(enc.encode(ver)) : bytesOf(import.meta.url),
    ]);
    if (!db) return null;
    const scope = await sha([code, enc.encode(`${THREE.REVISION} ${fps}`), ...rigOf(player)]);
    const metaKey = `meta:clips:${scope}`;
    const bakes = (mode) => db.transaction("bakes", mode).objectStore("bakes");
    const ro = bakes("readonly");
    const [allKeys, metaDoc, prefetchDoc] = await Promise.all([
      request(ro.getAllKeys()),
      request(ro.get(metaKey)).catch(() => null),
      ver ? request(ro.get("meta:prefetch")).catch(() => null) : Promise.resolve(null),
    ]);
    const existing = new Set();
    const stale = [];
    const dropOldBuilds = !!(ver && prefetchDoc?.ver && prefetchDoc.ver !== ver);
    const keepScopes = new Set([scope]);
    const keepFeet = new Set();
    if (dropOldBuilds) {
      const otherMetaKeys = allKeys.filter(
        (k) =>
          typeof k === "string" &&
          ((k.startsWith("meta:clips:") && k !== metaKey) || k.startsWith("meta:feet:")),
      );
      if (otherMetaKeys.length) {
        const docs = await Promise.all(
          otherMetaKeys.map((k) => request(bakes("readonly").get(k)).catch(() => null)),
        );
        for (let i = 0; i < otherMetaKeys.length; i++) {
          const mk = otherMetaKeys[i];
          if (mk.startsWith("meta:feet:")) {
            if (ver && docs[i]?.ver === ver) keepFeet.add(mk);
            else stale.push(mk);
          } else {
            const otherScope = mk.slice("meta:clips:".length);
            if (docs[i]?.ver === ver) keepScopes.add(otherScope);
            else stale.push(mk);
          }
        }
      }
    }
    const scopeOfKey = (k) => {
      const sp = k.indexOf(" ");
      return sp === 64 ? k.slice(0, 64) : null;
    };
    const scopePrefix = `${scope} `;
    for (const key of allKeys) {
      if (typeof key !== "string") {
        stale.push(key);
        continue;
      }
      if (key.startsWith(scopePrefix)) {
        existing.add(key);
        continue;
      }
      if (
        key === "meta:prefetch" ||
        key === metaKey ||
        key === "meta:feet" ||
        key.startsWith("meta:clips:") ||
        keepFeet.has(key)
      )
        continue;
      if (key.startsWith("meta:feet:")) {
        if (!dropOldBuilds) continue;
        stale.push(key);
        continue;
      }
      const keyScope = scopeOfKey(key);
      if (keyScope && (!dropOldBuilds || keepScopes.has(keyScope))) continue;
      stale.push(key);
    }
    if (stale.length) {
      const tx = db.transaction("bakes", "readwrite");
      const store = tx.objectStore("bakes");
      for (const key of stale) store.delete(key);
      await new Promise((done, fail) => {
        tx.oncomplete = () => done(undefined);
        tx.onerror = () => fail(tx.error);
        tx.onabort = () => fail(tx.error);
      }).catch(() => {});
    }
    const meta = { ...(metaDoc?.ver === (ver ?? "raw") ? metaDoc.entries : {}) };
    let metaDirty = false;
    const keys = new Map();
    const pending = [];
    const newPrefetch = {};
    return {
      keyOf: (ref) => keys.get(ref) ?? null,
      get: async (ref, fetchFiles) => {
        try {
          const cached = meta[ref];
          const tagEntries = cached?.tags ? Object.entries(cached.tags) : null;
          if (
            cached?.key &&
            existing.has(cached.key) &&
            tagEntries?.length &&
            tagEntries.every(([u, t]) => bootTagFor(u) === t)
          ) {
            const hit = await request(bakes("readonly").get(cached.key));
            if (hit) {
              keys.set(ref, cached.key);
              return { key: cached.key, data: hit };
            }
          }
          const bytes = await fetchFiles();
          const key = `${scope} ${ref} ${await sha(bytes)}`;
          keys.set(ref, key);
          if (!existing.has(key)) return null;
          const data = await request(bakes("readonly").get(key));
          if (!data) return null;
          const tags = tagsForRef(ref);
          if (tags && ver) {
            meta[ref] = { key, tags };
            newPrefetch[ref] = tags;
            metaDirty = true;
          }
          return { key, data };
        } catch {
          return null;
        }
      },
      put: (ref, kept) => {
        const key = keys.get(ref);
        if (!key) return;
        existing.add(key);
        pending.push([key, kept]);
        const tags = tagsForRef(ref);
        if (tags && ver) {
          meta[ref] = { key, tags };
          newPrefetch[ref] = tags;
          metaDirty = true;
        }
      },
      flush: async () => {
        if (!pending.length && !metaDirty) return;
        const batch = pending.splice(0, pending.length);
        const saveMeta = metaDirty;
        metaDirty = false;
        const prefetchPatch = { ...newPrefetch };
        for (const k of Object.keys(newPrefetch)) delete newPrefetch[k];
        try {
          const tx = db.transaction("bakes", "readwrite");
          const store = tx.objectStore("bakes");
          for (const [key, kept] of batch) store.put(kept, key);
          if (saveMeta && ver) {
            store.put({ ver, entries: meta }, metaKey);
            const req = store.get("meta:prefetch");
            req.onsuccess = () => {
              const cur = req.result ?? {};
              const baseClips = cur.ver === ver ? cur.clips : {};
              store.put({ ver, clips: { ...baseClips, ...prefetchPatch } }, "meta:prefetch");
            };
          }
          await new Promise((done, fail) => {
            tx.oncomplete = () => done(undefined);
            tx.onerror = () => fail(tx.error);
            tx.onabort = () => fail(tx.error);
          });
        } catch {}
      },
    };
  } catch {
    return null;
  }
}
function leaveAsBaked(player, last) {
  const { g } = player,
    p0 = g.position.clone(),
    q0 = g.quaternion.clone();
  g.position.set(0, 0, 0);
  g.quaternion.identity();
  player.setPose(last);
  g.updateMatrixWorld(true);
  g.position.copy(p0);
  g.quaternion.copy(q0);
}
