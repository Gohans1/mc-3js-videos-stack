import { makeLayerAdjustments } from "film-stage/grade";
import { makeTitles } from "film-stage/titles";
import { makeTransitions } from "film-stage/transitions";
import * as THREE from "three";

import { EDIT } from "./edit";

export const SHOTS: { t: number; name?: string; transition?: { fx: string; len: number } }[] = [];
export const SHOTS_OUT = SHOTS;
export let DURATION = 6;
export function applyEdit() {
  SHOTS.splice(0, SHOTS.length, ...EDIT.shots);
  DURATION = EDIT.end;
}
applyEdit();

export async function buildScene(canvas: HTMLCanvasElement, width: number, height: number) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x182333);
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  const look = new THREE.Vector3();
  const free = { on: false, p: new THREE.Vector3(4, 2, 5), l: new THREE.Vector3(), fov: 45 };
  const material = new THREE.MeshStandardMaterial({ color: 0xe3aa46, roughness: 0.3 });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), material);
  cube.name = "Cube";
  scene.add(cube);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x344354, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(0xcce8ff, 0x3b2519, 2));
  const light = new THREE.DirectionalLight(0xffe5bf, 3);
  light.position.set(4, 6, 3);
  scene.add(light);
  const grade = makeLayerAdjustments(renderer),
    titles = makeTitles(renderer, width, height);
  await titles.ready;
  await grade.prepare(EDIT.adjustments.items.map((it: { grade: unknown }) => it.grade));
  const composite = makeTransitions(
    renderer,
    (t, forced) => {
      const shot = forced ?? (t >= 3 ? 1 : 0),
        key = EDIT.cam[shot];
      cube.rotation.set(0.15, t * 0.5, 0);
      material.color.set(EDIT.fx[0].look.color);
      camera.position.fromArray(free.on ? free.p.toArray() : key.p);
      look.fromArray(free.on ? free.l.toArray() : key.l);
      camera.fov = free.on ? free.fov : key.fov;
      camera.lookAt(look);
      camera.updateProjectionMatrix();
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    },
    () => SHOTS,
    () => DURATION,
    free,
    (t) => {
      grade(
        EDIT.adjustments.items.filter(
          (it: { from: number; to: number }) => t >= it.from && t < it.to,
        ),
        t,
      );
      titles(EDIT.text.items, t, camera);
    },
    undefined,
    [
      {
        id: "own-tint",
        title: "AI tint",
        category: "This film",
        tip: "A custom shader with editable intensity",
        uniforms: { intensity: 0.25 },
        glsl: "uniform float intensity; vec4 transition(vec2 uv){ return mix(mix(getFromColor(uv),getToColor(uv),progress), vec4(0.1,0.7,0.5,1.),intensity); }",
      },
    ],
  );
  const draw = Object.assign((t: number) => composite(t), composite);
  return Object.assign(draw, {
    tools: {
      renderer,
      scene,
      camera,
      look,
      free,
      titles,
      objects: [[cube, "Cube"]],
      materials: [[material, "Cube"]],
    },
    adjustments: { prepare: grade.prepare },
  });
}
