// Minecraft's night vision for the free camera (Settings, Camera; off by default, kept in this browser): an even light and no
// fog, to find the way round a dark set. Only on the main view and only while the free camera flies: lit just for that one
// draw and put back after it, so the film's own lights, its camera corner, a snapshot, the drafts and the video never see it
import * as THREE from "three";

import { S } from "../core/state";
import { get } from "../core/store";

const lamp = new THREE.AmbientLight(0xffffff, 0);
lamp.name = "studio night vision";

// Around the film's draw of the main view: on before it, off after it
let fogWas: number | null = null;
export const nightVision = (on: boolean) => {
  const tools = S.tools;
  if (!tools) return;
  const fog = tools.scene.fog as THREE.FogExp2 | THREE.Fog | null;
  if (on && tools.free.on && get().nightVision) {
    if (lamp.parent !== tools.scene) tools.scene.add(lamp);
    lamp.intensity = 2.5;
    if (fog && "density" in fog) {
      fogWas = fog.density;
      fog.density = 0;
    }
    return;
  }
  lamp.intensity = 0;
  if (fog && "density" in fog && fogWas !== null) fog.density = fogWas;
  fogWas = null;
};
