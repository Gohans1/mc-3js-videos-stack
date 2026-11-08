// The free camera: looking around the scene without changing the film. Held like a camera: turning stays where you stand,
// because orbiting a target leaves these small rooms at once. It flies like Minecraft's creative flight (flight.ts)
import * as THREE from "three";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { createFlight } from "./flight";

export const flight = createFlight();
// One frame's flying, by the time that passed since the last
export const fly = (dt: number) => {
  if (S.tools?.free.on) { const d = flight.step(dt, get().flySpeed); if (d) flyCam(...d); } else flight.clear();
};
const camDir = new THREE.Vector3(), camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), sph = new THREE.Spherical();
export const turnAbout = (centre: THREE.Vector3, moving: THREE.Vector3, dx: number, dy: number) => {
  camDir.copy(moving).sub(centre);
  sph.setFromVector3(camDir);
  sph.theta += dx; sph.phi = Math.max(0.03, Math.min(Math.PI - 0.03, sph.phi + dy));
  camDir.setFromSpherical(sph);
  moving.copy(centre).add(camDir);
};
export const moveCam = (forward: number, right: number, up: number) => {
  const f = S.tools!.free;
  camDir.copy(f.l).sub(f.p).normalize(); camRight.crossVectors(camDir, THREE.Object3D.DEFAULT_UP).normalize(); camUp.crossVectors(camRight, camDir);
  const d = new THREE.Vector3().addScaledVector(camDir, forward).addScaledVector(camRight, right).addScaledVector(camUp, up);
  f.p.add(d); f.l.add(d);
  S.viewMoved = true;
};
// The flying keys' move (picture/flight.ts), Minecraft's: forward and right level with the floor whatever the pitch, up straight up
export const flyCam = (forward: number, right: number, up: number) => {
  const f = S.tools!.free;
  camDir.copy(f.l).sub(f.p).setY(0).normalize(); camRight.crossVectors(camDir, THREE.Object3D.DEFAULT_UP);
  const d = new THREE.Vector3().addScaledVector(camDir, forward).addScaledVector(camRight, right).addScaledVector(THREE.Object3D.DEFAULT_UP, up);
  f.p.add(d); f.l.add(d);
  S.viewMoved = true;
};
// The first free camera after a page load starts at the film's home spot (tools.home), so a reload never leaves the
// creator wherever the playhead happened to be; later ones start from the shot's own camera, and so does one a drag on the
// picture turns on (here), which must turn the view seen
let homed = false;
export const setFree = (on: boolean, here = false) => {
  const tools = S.tools;
  if (!tools) return;
  const f = tools.free, home = !homed && !here && tools.home;
  if (on && home) { f.p.set(...home.p); f.l.set(...home.l); f.fov = home.fov ?? tools.camera.fov; }
  else if (on) { f.p.copy(tools.camera.position); f.l.copy(tools.look); f.fov = tools.camera.fov; }
  if (on) homed = true;
  f.on = on;
  set({ free: on });
  S.dirty = true;
};
export const setFov = (d: number) => {
  const f = S.tools?.free;
  if (!f?.on) return;
  f.fov = Math.max(8, Math.min(100, f.fov + d));
  S.viewMoved = true;
  say(`FOV ${f.fov}°`);
};
