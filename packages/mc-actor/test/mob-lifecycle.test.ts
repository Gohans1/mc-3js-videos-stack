import { afterEach, expect, mock, spyOn, test } from "bun:test";

import * as MineRender from "minerender/browser";
import * as THREE from "three";

mock.module("minerender", () => MineRender);
const { loadMob } = await import("../src/mob");

afterEach(() => mock.restore());

test("disposing a mob frees its mesh resources and preserves textures shared by another mob", async () => {
  const key = new MineRender.BasicAssetKey("minecraft", "test-mob");
  spyOn(MineRender.Entities, "getEntity").mockResolvedValue({
    id: "test-mob",
    key,
    layer: {
      texture: [16, 16],
      root: {
        pose: { offset: [0, 0, 0], rotation: [0, 0, 0] },
        cubes: [{ origin: [0, 0, 0], size: [2, 2, 2], uv: [0, 0] }],
        children: {},
      },
    },
  });
  spyOn(MineRender.Entities, "getAnimations").mockResolvedValue({});
  const sharedTexture = new THREE.Texture();
  const sharedMaterial = new THREE.MeshBasicMaterial({ map: sharedTexture });
  const init = MineRender.EntityObject.prototype.init;
  spyOn(MineRender.EntityObject.prototype, "init").mockImplementation(function (
    this: MineRender.EntityObject,
  ) {
    return init.call(this, sharedMaterial);
  });
  const root = "http://127.0.0.1/mcasset";
  const removed = await loadMob("test-mob", { root });
  const retained = await loadMob("test-mob", { root });
  const removedMesh = removed.mob.getMeshByName("root");
  const retainedMesh = retained.mob.getMeshByName("root");
  const disposal: string[] = [];
  removedMesh.geometry.addEventListener("dispose", () => disposal.push("removed geometry"));
  removedMesh.material.addEventListener("dispose", () => disposal.push("removed material"));
  retainedMesh.geometry.addEventListener("dispose", () => disposal.push("retained geometry"));
  retainedMesh.material.addEventListener("dispose", () => disposal.push("retained material"));
  sharedMaterial.addEventListener("dispose", () => disposal.push("shared material"));
  sharedTexture.addEventListener("dispose", () => disposal.push("shared texture"));

  removed.dispose();

  expect(retainedMesh.material.map).toBe(sharedTexture);
  expect(disposal.sort()).toEqual(["removed geometry", "removed material"]);
});
