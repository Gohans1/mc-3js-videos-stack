import { expect, mock, test } from "bun:test";

import * as THREE from "three";

function blockBuild() {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(16, 16, 16);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);
  const disposal: string[] = [];
  geometry.addEventListener("dispose", () => disposal.push("geometry"));
  material.addEventListener("dispose", () => disposal.push("material"));
  return {
    group,
    mesh,
    disposal,
    dispose() {
      geometry.dispose();
      material.dispose();
      group.removeFromParent();
    },
  };
}

const createScene = mock(async () => blockBuild());
mock.module("block-model-renderer", () => ({
  createScene,
  listDirectory: () => [],
  renderBlock: () => null,
}));
const mobBuild = () => {
  const resources = blockBuild();
  return { ...resources, g: resources.group, clips: [], still() {} };
};
const loadMob = mock(async (_name: string) => mobBuild());
mock.module("mc-actor/mob", () => ({ loadMob }));
const { makePlaced } = await import("../src/placed");

const logBlock = (axis: string, x = 0) => ({
  what: "block:minecraft:oak_log",
  properties: { axis },
  keys: [{ t: 0, at: [x, 0, 0] }],
});

test("replacing and removing a block releases its render resources and updates picking", async () => {
  const scene = new THREE.Scene();
  const edit = { placed: { log: logBlock("y") } as Record<string, ReturnType<typeof logBlock>> };
  const first = blockBuild();
  const replacement = blockBuild();
  createScene.mockResolvedValueOnce(first).mockResolvedValueOnce(replacement);
  const placed = await makePlaced(scene, [], edit);

  edit.placed = { log: logBlock("x", 2) };
  await placed.sync();
  placed.draw(0);
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(2, 0.5, 4), new THREE.Vector3(0, 0, -1));
  const picked = ray.intersectObject(placed.root)[0]?.object;
  expect(picked).toBe(replacement.mesh);
  expect(placed.nameOf(picked)).toBe("log");
  expect(placed.nameOf(first.mesh)).toBeNull();
  expect(replacement.mesh.castShadow && replacement.mesh.receiveShadow).toBe(true);
  expect(replacement.disposal).toEqual([]);

  edit.placed = {};
  await placed.sync();
  expect(ray.intersectObject(placed.root)).toEqual([]);
  expect(placed.nameOf(replacement.mesh)).toBeNull();
  expect(first.disposal).toEqual(["geometry", "material"]);
  expect(replacement.disposal).toEqual(["geometry", "material"]);
});

test.each(["remove", "replace"])(
  "disposes a pending block when an edit will %s it",
  async (change) => {
    const edit = { placed: {} as Record<string, ReturnType<typeof logBlock>> };
    const placed = await makePlaced(new THREE.Scene(), [], edit);
    const stale = blockBuild();
    const current = blockBuild();
    const started = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<typeof stale>();
    createScene.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    if (change === "replace") createScene.mockResolvedValueOnce(current);
    const attached: number[] = [];
    placed.root.addEventListener("childadded", ({ child }: { child: THREE.Object3D }) => {
      const mesh = child.getObjectByProperty("isMesh", true);
      if (mesh) attached.push(mesh.id);
    });

    edit.placed = { log: logBlock("y") };
    const firstSync = placed.sync();
    await started.promise;
    edit.placed = change === "replace" ? { log: logBlock("z") } : {};
    const nextSync = placed.sync();
    pending.resolve(stale);
    await Promise.all([firstSync, nextSync]);

    expect({ disposal: stale.disposal, attached }).toEqual({
      disposal: ["geometry", "material"],
      attached: change === "replace" ? [current.mesh.id] : [],
    });
  },
);

test("replacing and removing a placed mob releases both instances", async () => {
  const mob = (name: string) => ({ what: `mob:${name}`, keys: [{ t: 0, at: [0, 0, 0] }] });
  const edit = { placed: { animal: mob("pig") } as Record<string, ReturnType<typeof mob>> };
  const first = mobBuild();
  const second = mobBuild();
  loadMob.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const placed = await makePlaced(new THREE.Scene(), [], edit);

  edit.placed = { animal: mob("cow") };
  await placed.sync();
  expect(placed.nameOf(second.mesh)).toBe("animal");
  expect(second.disposal).toEqual([]);

  edit.placed = {};
  await placed.sync();
  expect(placed.objectOf("animal")).toBeNull();
  expect(first.disposal).toEqual(["geometry", "material"]);
  expect(second.disposal).toEqual(["geometry", "material"]);
});

test("discarding a mob that finished loading after removal releases it without attaching it", async () => {
  const mob = { what: "mob:pig", keys: [{ t: 0, at: [0, 0, 0] }] };
  const edit = { placed: {} as Record<string, typeof mob> };
  const placed = await makePlaced(new THREE.Scene(), [], edit);
  const started = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof loadMob>>>();
  loadMob.mockImplementationOnce(() => {
    started.resolve();
    return pending.promise;
  });
  const resources = mobBuild();
  const attached: THREE.Object3D[] = [];
  placed.root.addEventListener("childadded", ({ child }: { child: THREE.Object3D }) => {
    attached.push(child);
  });

  edit.placed = { animal: mob };
  const firstSync = placed.sync();
  await started.promise;
  edit.placed = {};
  const nextSync = placed.sync();
  pending.resolve(resources);
  await Promise.all([firstSync, nextSync]);

  expect({ disposal: resources.disposal, attached }).toEqual({
    disposal: ["geometry", "material"],
    attached: [],
  });
});
