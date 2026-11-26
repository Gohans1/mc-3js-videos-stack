// @ts-nocheck
import * as THREE from "three";

import { findPops, findSlides, report } from "../checks/pops.mjs";
import { spanOf } from "../src/frame";
import { post } from "./lab";
import { inside } from "./target";

const FPS = 30;
const SIDES = ["L", "R"];
const SOLE_CLEARANCE = 0.03;

const supportSampler = (scene) => {
  const ray = new THREE.Raycaster(undefined, new THREE.Vector3(0, -1, 0), 0, SOLE_CLEARANCE * 2);
  const matrix = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  let meshes;

  return {
    nextFrame() {
      meshes = undefined;
    },
    at(sole, actor) {
      if (!meshes) {
        meshes = [];
        scene.traverseVisible((object) => {
          if (object.isMesh && !object.isSkinnedMesh) meshes.push(object);
        });
      }
      ray.ray.origin.copy(sole);
      ray.ray.origin.y += SOLE_CLEARANCE;
      for (const hit of ray.intersectObjects(meshes, false)) {
        const { object, face, instanceId, batchId, point } = hit;
        const itemId = instanceId ?? batchId;
        const material = Array.isArray(object.material)
          ? object.material[face?.materialIndex]
          : object.material;
        if (
          !face ||
          inside(actor, object) ||
          !material?.visible ||
          (material.transparent && material.opacity < 0.5)
        )
          continue;
        matrix.copy(object.matrixWorld);
        if (itemId !== undefined) {
          object.getMatrixAt(itemId, local);
          matrix.multiply(local);
        }
        normal.copy(face.normal).applyNormalMatrix(normalMatrix.getNormalMatrix(matrix));
        if (normal.y <= 0.45) continue;
        return {
          id: itemId === undefined ? object.uuid : `${object.uuid}:${itemId}`,
          position: position.copy(point).applyMatrix4(local.copy(matrix).invert()).toArray(),
          scale: scale.setFromMatrixScale(matrix).toArray(),
          height: sole.y - point.y,
        };
      }
      return null;
    },
  };
};

const worldVisible = (o) => {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};

export const popsCheck =
  (render, cuts = [], windows = [], lastFrame = Infinity) =>
  async (_target, from, to) => {
    const draw = render.renderFrame?.bind(render) ?? render;
    const { scene, camera, objects = [] } = render.tools ?? {};
    if (!scene || !camera)
      return ["ERROR --check pops requires draw.tools.scene and draw.tools.camera on the film"];

    const labelled = new Map(objects.map(([o, label]) => [o, label]));
    const actors = new Map();
    const ownerOf = (o) => {
      let named = null;
      for (let p = o; p; p = p.parent) {
        if (labelled.has(p)) return labelled.get(p);
        if (p.soleNow) {
          if (!actors.has(p)) actors.set(p, p.name || `actor ${actors.size + 1}`);
          return actors.get(p);
        }
        if (!named && p.name && !p.isBone) named = p.name;
      }
      return named ?? "scene";
    };

    const tracks = new Map();
    const { first, last } = spanOf([from, to], FPS, lastFrame);
    const support = supportSampler(scene);
    const ndc = new THREE.Vector3();
    const inView = (p) => {
      ndc.copy(p).project(camera);
      return ndc.z < 1 && Math.abs(ndc.x) <= 1.05 && Math.abs(ndc.y) <= 1.05;
    };
    const sample = (key, make, i, t, value, seen) => {
      let track = tracks.get(key);
      if (!track) tracks.set(key, (track = { ...make(), t: [], v: [], seen: [] }));
      while (track.t.length < i) {
        track.t.push((first + track.t.length) / FPS);
        track.v.push(null);
        track.seen.push(false);
      }
      track.t.push(t);
      track.v.push(value);
      track.seen.push(seen);
      return track;
    };

    const wp = new THREE.Vector3(),
      sole = new THREE.Vector3(),
      rotation = new THREE.Quaternion();
    for (let frame = first; frame <= last; frame++) {
      const i = frame - first;
      const t = frame / FPS;
      await draw(t);
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      support.nextFrame();
      scene.traverse((o) => {
        if (o.isBone) {
          o.getWorldPosition(wp);
          const seen = worldVisible(o) && inView(wp);
          sample(
            `${o.uuid}|turn`,
            () => ({ owner: ownerOf(o), part: o.name || "bone", kind: "turn" }),
            i,
            t,
            o.quaternion.toArray(),
            seen,
          );
          if (!o.parent?.isBone)
            sample(
              `${o.uuid}|move`,
              () => ({ owner: ownerOf(o), part: `${o.name || "root"} position`, kind: "move" }),
              i,
              t,
              wp.toArray(),
              seen,
            );
          return;
        }
        if (o.userData?.facePx) {
          o.getWorldPosition(wp);
          const seen = worldVisible(o) && inView(wp);
          const px = o.userData.facePx;
          sample(
            `${o.uuid}|face`,
            () => ({ owner: ownerOf(o), part: o.name, kind: "face" }),
            i,
            t,
            o.position.toArray().map((x) => x / px),
            seen,
          );
          sample(
            `${o.uuid}|tilt`,
            () => ({ owner: ownerOf(o), part: `${o.name} tilt`, kind: "turn" }),
            i,
            t,
            o.quaternion.toArray(),
            seen,
          );
          return;
        }
        if (o.userData?.landmarks) {
          o.getWorldPosition(wp);
          const seen = worldVisible(o) && inView(wp);
          sample(
            `${o.uuid}|landmarks`,
            () => ({ owner: ownerOf(o), part: "face", kind: "landmarks" }),
            i,
            t,
            seen ? Object.values(o.userData.landmarks()).flat() : null,
            seen,
          );
          return;
        }
        if (o.soleNow) {
          const seen = worldVisible(o);
          o.getWorldPosition(wp);
          sample(
            `${o.uuid}|root-turn`,
            () => ({ owner: ownerOf(o), part: "root rotation", kind: "turn" }),
            i,
            t,
            o.getWorldQuaternion(rotation).toArray(),
            seen && inView(wp),
          );
          for (const sd of SIDES) {
            o.soleNow(sd, sole);
            const visible = seen && inView(sole);
            const track = sample(
              `${o.uuid}|sole${sd}`,
              () => ({ owner: ownerOf(o), part: sd, kind: "sole", support: [] }),
              i,
              t,
              null,
              visible,
            );
            track.support[i] = visible ? support.at(sole, o) : null;
          }
        }
        if (labelled.has(o) && !o.isBone) {
          o.getWorldPosition(wp);
          sample(
            `${o.uuid}|move`,
            () => ({ owner: labelled.get(o), part: "position", kind: "move" }),
            i,
            t,
            wp.toArray(),
            worldVisible(o) && inView(wp),
          );
        }
      });
    }

    const all = [...tracks.values()];
    const pops = findPops(
      all.filter((x) => x.kind !== "sole"),
      cuts,
      windows,
    );
    const slides = findSlides(
      all.filter((x) => x.kind === "sole"),
      cuts,
    );
    const owners = new Set(all.map((x) => x.owner)).size;
    await post(
      "/still/pops.json",
      JSON.stringify(
        { clock: "heard seconds", from, to, fps: FPS, cuts, transitions: windows, pops, slides },
        null,
        1,
      ),
    );
    return report({ from, to, fps: FPS, tracks: all.length, owners, pops, slides });
  };
