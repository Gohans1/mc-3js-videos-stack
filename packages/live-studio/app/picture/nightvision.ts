import * as THREE from "three";

import { S } from "../core/state";
import { get } from "../core/store";

const lamp = new THREE.AmbientLight(0xffffff, 0);
lamp.name = "studio night vision";

let restoreFog: (() => void) | null = null;
export const nightVision = (on: boolean) => {
  restoreFog?.();
  restoreFog = null;
  lamp.intensity = 0;
  const tools = S.tools;
  if (!on || !tools?.free.on || !get().nightVision) return;
  if (lamp.parent !== tools.scene) tools.scene.add(lamp);
  lamp.intensity = 2.5;
  const { scene } = tools;
  const fog = scene.fog;
  scene.fog = null;
  restoreFog = () => {
    scene.fog = fog;
  };
};
