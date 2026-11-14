// @ts-nocheck
// Mocap clips as Steve's poses over time, by name "<lib>/<clip>": mixamo/<FBX file stem in motion/mixamo>, ual1/<clip>,
// ual2/<clip> (the Quaternius glTF libraries in motion/). Each is loaded once, retargeted (mocap.ts) and baked in played
// order, so a clip's at(s) gives the same pose for the same s in any order, as draw(t) needs. Film-free: imports nothing
// from the film, so it carries over to the next one with mocap.ts and player.ts.
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

import { bakeClip, framesAt, MIXAMO, retargeter, skeletonSource, UAL, UE } from "./mocap";

const GLTF_LIBS = {
  ual1: { file: "motion/ual1/AnimationLibrary_Godot_Standard.gltf", names: UAL },
  ual2: { file: "motion/ual2/UAL2_Standard.glb", names: UE },
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

// Every clip name a library holds (Mixamo: the stems listed in motion/mixamo/_tools/clips.json)
export async function clipNames(lib) {
  if (lib === "mixamo") return (await fetch("motion/mixamo/_tools/clips.json")).json();
  return (await gltfOf(lib)).animations.map((a) => a.name);
}

// The clip's skeleton at its rest (as retargeter() needs it: before any mixer has moved it) and the clip itself
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

// A clip's files, fetched once for both its key (kept below) and its source, through three's loading manager as its loader
// would fetch them (the studio counts and names files by it): an FBX, or a glTF library's .glb, or its .gltf and buffers
const fileBytes = (url) => new THREE.FileLoader().setResponseType("arraybuffer").loadAsync(url);
const clipFiles = async (ref) => {
  const [lib, name] = ref.split(/\/(.*)/s);
  return lib === "mixamo" ? [await fileBytes(fbxUrl(name))] : libFiles(lib);
};
const libFileSets = new Map();
const libFiles = (lib) => {
  if (!GLTF_LIBS[lib]) return Promise.resolve([]); // loadSource names the libraries there are
  if (!libFileSets.has(lib)) libFileSets.set(lib, gltfFiles(GLTF_LIBS[lib].file));
  return libFileSets.get(lib);
};
const gltfFiles = async (file) => {
  const main = await fileBytes(file);
  if (!file.endsWith(".gltf")) return [main];
  const dir = THREE.LoaderUtils.extractUrlBase(file);
  const uris = (JSON.parse(new TextDecoder().decode(main)).buffers ?? [])
    .map((b) => b.uri)
    .filter((u) => u && !u.startsWith("data:"));
  return [main, ...(await Promise.all(uris.map((u) => fileBytes(dir + u))))];
};
// The loaders' own parse of those bytes, failing to the loading manager as their load() does. A .gltf's buffers are
// handed over as blob URLs, the way three's editor opens a dropped .gltf (its own manager, so they count once)
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

// { duration, end, fps, frames, at(s) } for one clip; player: makePlayer's result (only its rest is read)
export async function loadClip(ref, player, fps = 60) {
  return clipOf(bakeKept(await loadSource(ref), player, fps));
}
// The clip and the pose the bake leaves him in (its last frame before the shift below), so a bake kept from an earlier
// load can leave him the same
function bakeKept({ root, names, clip }, player, fps) {
  const rt = retargeter(skeletonSource(root, names), player);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const bake = bakeClip(rt, (t) => mixer.setTime(t), clip.duration, fps);
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  const last = structuredClone(bake.frames.at(-1));
  // the clip starts where its key puts him: its hips' first ground position is the key's `at`
  const { x: x0, z: z0 } = bake.frames[0].root;
  for (const f of bake.frames) {
    f.root.x -= x0;
    f.root.z -= z0;
  }
  // where it leaves him, in his own frame (x his left, z his front, ry degrees to his left): the next key's place
  const { x, z, ry } = bake.frames.at(-1).root;
  return { duration: clip.duration, end: { x, z, ry }, frames: bake.frames, fps, last };
}
const clipOf = ({ duration, end, frames, fps }) => ({
  duration,
  end,
  frames,
  fps,
  at: framesAt(frames, fps),
});

// Every clip the refs name, once each: { ref: loadClip's result }
// Every file is asked for at once, so the downloads overlap the bakes; the bakes still run one at a time in the refs' order,
// as they pose the one player. A clip that fails to load throws at its turn, as it would alone. A bake an earlier load of
// this page kept (kept below) is read back instead, and leaves him posed as the bake would have
export async function loadClips(refs, player, fps = 60) {
  const unique = [...new Set(refs)],
    files = unique.map((ref) => clipFiles(ref)),
    store = unique.length ? keptBakes(player, fps) : null;
  const found = unique.map((ref, i) =>
    store ? store.then((s) => s?.get(ref, files[i]) ?? null) : null,
  );
  const sources = unique.map(async (ref, i) =>
    (await found[i]) ? null : loadSource(ref, files[i]),
  );
  for (const p of [...files, ...sources]) p.catch(() => {});
  const kept = await store;
  const out = {};
  for (const [i, ref] of unique.entries()) {
    let k = await found[i];
    if (k) leaveAsBaked(player, k.last);
    else {
      k = bakeKept(await sources[i], player, fps);
      kept?.put(ref, k);
    }
    out[ref] = clipOf(k);
  }
  return out;
}

// ---------- Bakes kept in the browser between loads (IndexedDB)
// A bake is a pure function of the clip's files, the rig (makePlayer's) and the code that bakes it, so it is kept under all
// three: the files' bytes, the rig at rest, and the bytes of the script this module was built into (live-studio's
// src/page.mjs builds clips, mocap and player into a chunk of their own, so a film's edit leaves it) with three's revision.
// Without IndexedDB or crypto.subtle (plain http to a LAN address), or on any error, it bakes as before
const DB = "mc-actor-bakes";
// a hash of each part's hash, so no part is copied into one big buffer first
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
// his bones at rest and the skinned meshes the retargeter measures his body from (mocap.ts bodyBoxes)
const rigOf = (player) => {
  player.setPose({});
  const nums = [player.legReach],
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
// { get(ref, files): Promise of a kept bake or null, put(ref, kept) after a get }, or null where nothing can be kept
async function keptBakes(player, fps) {
  try {
    if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) return null;
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("bakes");
    const [db, code] = await Promise.all([request(open), bytesOf(import.meta.url)]);
    const scope = await sha([
      code,
      new TextEncoder().encode(`${THREE.REVISION} ${fps}`),
      ...rigOf(player),
    ]);
    const bakes = (mode) => db.transaction("bakes", mode).objectStore("bakes");
    // what an older build or rig kept is dropped
    for (const key of await request(bakes("readonly").getAllKeys()))
      if (!key.startsWith(scope)) bakes("readwrite").delete(key);
    const keys = new Map();
    return {
      get: async (ref, files) => {
        try {
          keys.set(ref, `${scope} ${ref} ${await sha(await files)}`);
          return (await request(bakes("readonly").get(keys.get(ref)))) ?? null;
        } catch {
          return null;
        }
      },
      // put copies it at once, before the film can change the frames it is given
      put: (ref, kept) => {
        try {
          if (keys.has(ref)) bakes("readwrite").put(kept, keys.get(ref));
        } catch {}
      },
    };
  } catch {
    return null;
  }
}
// The player as the bake leaves him: posed at its last frame at the origin, matrices updated there (mocap.ts atOrigin)
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
