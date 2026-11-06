// @ts-nocheck
// Mocap clips as Steve's poses over time, by name "<lib>/<clip>": mixamo/<FBX file stem in motion/mixamo>, ual1/<clip>,
// ual2/<clip> (the Quaternius glTF libraries in motion/). Each is loaded once, retargeted (mocap.ts) and baked in played
// order, so a clip's at(s) gives the same pose for the same s in any order, as draw(t) needs. Film-free: imports nothing
// from the film, so it carries over to the next one with mocap.ts and player.ts.
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { MIXAMO, UAL, UE, bakeClip, retargeter, skeletonSource } from "./mocap";

const GLTF_LIBS = {
  ual1: { file: "motion/ual1/AnimationLibrary_Godot_Standard.gltf", names: UAL },
  ual2: { file: "motion/ual2/UAL2_Standard.glb", names: UE },
};
const gltfs = new Map();
const gltfOf = (lib) => {
  if (!gltfs.has(lib)) gltfs.set(lib, new GLTFLoader().loadAsync(GLTF_LIBS[lib].file));
  return gltfs.get(lib);
};

// Every clip name a library holds (Mixamo: the stems listed in motion/mixamo/_tools/clips.json)
export async function clipNames(lib) {
  if (lib === "mixamo") return (await fetch("motion/mixamo/_tools/clips.json")).json();
  return (await gltfOf(lib)).animations.map((a) => a.name);
}

// The clip's skeleton at its rest (as retargeter() needs it: before any mixer has moved it) and the clip itself
export async function loadSource(ref) {
  const [lib, name] = ref.split(/\/(.*)/s);
  if (lib === "mixamo") {
    const root = await new FBXLoader().loadAsync(`motion/mixamo/${name}.fbx`);
    root.scale.setScalar(0.01); // Mixamo works in centimetres
    if (!root.animations[0]) throw new Error(`mocap clip ${ref}: the FBX holds no animation`);
    return { root, names: MIXAMO, clip: root.animations[0] };
  }
  const L = GLTF_LIBS[lib];
  if (!L) throw new Error(`mocap clip ${ref}: no library "${lib}" (mixamo, ${Object.keys(GLTF_LIBS).join(", ")})`);
  const gl = await gltfOf(lib);
  const clip = gl.animations.find((a) => a.name === name);
  if (!clip) throw new Error(`mocap clip ${ref}: not in ${L.file}`);
  // every clip of a library shares one scene: a fresh copy, so no earlier clip's last frame becomes this one's rest
  const root = clone(gl.scene);
  return { root, names: L.names, clip };
}

// { duration, end, fps, frames, at(s) } for one clip; player: makePlayer's result (only its rest is read)
export async function loadClip(ref, player, fps = 60) {
  const { root, names, clip } = await loadSource(ref);
  const rt = retargeter(skeletonSource(root, names), player);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const bake = bakeClip(rt, (t) => mixer.setTime(t), clip.duration, fps);
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  // the clip starts where its key puts him: its hips' first ground position is the key's `at`
  const { x: x0, z: z0 } = bake.frames[0].root;
  for (const f of bake.frames) { f.root.x -= x0; f.root.z -= z0; }
  // where it leaves him, in his own frame (x his left, z his front, ry degrees to his left): the next key's place
  const { x, z, ry } = bake.frames.at(-1).root;
  return { duration: clip.duration, end: { x, z, ry }, ...bake };
}

// Every clip the refs name, once each: { ref: loadClip's result }
export async function loadClips(refs, player, fps = 60) {
  const out = {};
  for (const ref of new Set(refs)) out[ref] = await loadClip(ref, player, fps);
  return out;
}
