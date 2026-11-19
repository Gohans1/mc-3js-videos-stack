import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { FACES, makePlayer, PX, SKIN_UV } from "../src/player";

interface PixelCanvas {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  getContext: () => PixelContext;
}

interface PixelContext {
  canvas: PixelCanvas;
  fillStyle: string;
  globalAlpha: number;
  save: () => void;
  restore: () => void;
  clearRect: (x: number, y: number, w: number, h: number) => void;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  drawImage: (src: PixelCanvas, dx: number, dy: number) => void;
  getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
}

function parseColor(style: string): [number, number, number, number] {
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(style);
  if (rgb) return [+rgb[1]!, +rgb[2]!, +rgb[3]!, 255];
  const hex = /^#([0-9a-f]{6})$/i.exec(style);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  return [0, 0, 0, 255];
}

function makePixelCanvas(w = 64, h = 64, fill?: [number, number, number, number]): PixelCanvas {
  let width = w;
  let height = h;
  let data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
    }
  }
  const stack: Array<{ fillStyle: string; globalAlpha: number }> = [];
  const canvas: PixelCanvas = {
    get width() {
      return width;
    },
    set width(v: number) {
      width = v;
      data = new Uint8ClampedArray(width * height * 4);
    },
    get height() {
      return height;
    },
    set height(v: number) {
      height = v;
      data = new Uint8ClampedArray(width * height * 4);
    },
    get data() {
      return data;
    },
    getContext() {
      return ctx;
    },
  };
  const ctx: PixelContext = {
    canvas,
    fillStyle: "#000000",
    globalAlpha: 1,
    save() {
      stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
    },
    restore() {
      const prev = stack.pop();
      if (prev) {
        this.fillStyle = prev.fillStyle;
        this.globalAlpha = prev.globalAlpha;
      }
    },
    clearRect(x, y, rw, rh) {
      for (let py = Math.max(0, y); py < Math.min(height, y + rh); py++) {
        for (let px = Math.max(0, x); px < Math.min(width, x + rw); px++) {
          const i = (py * width + px) * 4;
          data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
        }
      }
    },
    fillRect(x, y, rw, rh) {
      const [r, g, b, a] = parseColor(this.fillStyle);
      const alpha = Math.max(0, Math.min(1, this.globalAlpha)) * (a / 255);
      for (let py = Math.max(0, y); py < Math.min(height, y + rh); py++) {
        for (let px = Math.max(0, x); px < Math.min(width, x + rw); px++) {
          const i = (py * width + px) * 4;
          data[i] = Math.round(data[i]! * (1 - alpha) + r * alpha);
          data[i + 1] = Math.round(data[i + 1]! * (1 - alpha) + g * alpha);
          data[i + 2] = Math.round(data[i + 2]! * (1 - alpha) + b * alpha);
          data[i + 3] = Math.min(255, Math.round(data[i + 3]! + (255 - data[i + 3]!) * alpha));
        }
      }
    },
    drawImage(src, dx, dy) {
      const alpha = Math.max(0, Math.min(1, this.globalAlpha));
      for (let py = 0; py < src.height; py++) {
        const ty = py + dy;
        if (ty < 0 || ty >= height) continue;
        for (let px = 0; px < src.width; px++) {
          const tx = px + dx;
          if (tx < 0 || tx >= width) continue;
          const si = (py * src.width + px) * 4;
          const ti = (ty * width + tx) * 4;
          const sa = (src.data[si + 3]! / 255) * alpha;
          data[ti] = Math.round(data[ti]! * (1 - sa) + src.data[si]! * sa);
          data[ti + 1] = Math.round(data[ti + 1]! * (1 - sa) + src.data[si + 1]! * sa);
          data[ti + 2] = Math.round(data[ti + 2]! * (1 - sa) + src.data[si + 2]! * sa);
          data[ti + 3] = Math.round(
            Math.min(255, data[ti + 3]! * (1 - sa) + src.data[si + 3]! * alpha),
          );
        }
      }
    },
    getImageData(x, y, rw, rh) {
      const out = new Uint8ClampedArray(rw * rh * 4);
      for (let py = 0; py < rh; py++) {
        for (let px = 0; px < rw; px++) {
          const si = ((y + py) * width + (x + px)) * 4;
          const di = (py * rw + px) * 4;
          out[di] = data[si] ?? 0;
          out[di + 1] = data[si + 1] ?? 0;
          out[di + 2] = data[si + 2] ?? 0;
          out[di + 3] = data[si + 3] ?? 0;
        }
      }
      return { data: out };
    },
  };
  return canvas;
}

function readPixel(ctx: PixelContext, x: number, y: number): [number, number, number, number] {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]!];
}

async function loadPlayerTemplate(): Promise<THREE.Object3D> {
  const vaultRoot = process.env.MC_VAULT_ROOT;
  const glbPath = vaultRoot ? join(vaultRoot, "mcprep/player.glb") : null;
  if (glbPath && existsSync(glbPath)) {
    const buf = readFileSync(glbPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const gltf = await new Promise<{ scene: THREE.Object3D }>((res, rej) =>
      new GLTFLoader().parse(ab, "", res, rej),
    );
    return gltf.scene;
  }

  // Fallback synthetic rig matching player.glb bone names + skinned head box vertices
  const template = new THREE.Group();
  const bone = (name: string, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    return b;
  };
  const root = bone("center", 0, 12 * PX, 0);
  const body = bone("Body", 0, 0, 0);
  const chest = bone("Chest", 0, 6 * PX, 0);
  const head = bone("Head", 0, 6 * PX, 0);
  const uaL = bone("ArmLeftUpper", 6 * PX, 4 * PX, 0);
  const laL = bone("ArmLeftLower", 0, -6 * PX, 0);
  const uaR = bone("ArmRightUpper", -6 * PX, 4 * PX, 0);
  const laR = bone("ArmRightLower", 0, -6 * PX, 0);
  const ulL = bone("LegLeftUpper", 2 * PX, 0, 0);
  const llL = bone("LegLeftLower", 0, -6 * PX, 0);
  const ulR = bone("LegRightUpper", -2 * PX, 0, 0);
  const llR = bone("LegRightLower", 0, -6 * PX, 0);
  template.add(root);
  root.add(body, ulL, ulR);
  body.add(chest);
  chest.add(head, uaL, uaR);
  uaL.add(laL);
  uaR.add(laR);
  ulL.add(llL);
  ulR.add(llR);

  const geo = new THREE.BoxGeometry(8 * PX, 8 * PX, 8 * PX);
  geo.translate(0, 28 * PX, 0);
  const count = geo.attributes.position.count;
  const bones = [root, body, chest, head, uaL, laL, uaR, laR, ulL, llL, ulR, llR];
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    skinIndices[i * 4] = 3; // head bone index
    skinWeights[i * 4] = 1;
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = "BodyMesh";
  mesh.bind(new THREE.Skeleton(bones));
  template.add(mesh);
  return template;
}

const prevDoc = (globalThis as { document?: unknown }).document;
afterEach(() => {
  (globalThis as { document?: unknown }).document = prevDoc;
});

function installPixelDocument() {
  (globalThis as { document?: unknown }).document = {
    createElement: () => makePixelCanvas(64, 64),
  };
}

function getBodyMaterial(
  player: Awaited<ReturnType<typeof makePlayer>>,
): THREE.MeshStandardMaterial {
  const mats: THREE.MeshStandardMaterial[] = [];
  player.rig.traverse((o: THREE.Object3D) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !/Layer2/.test(o.name)) {
      mats.push((o as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial);
    }
  });
  if (!mats[0]) throw new Error("expected inner SkinnedMesh material");
  return mats[0];
}

describe("mc-actor player rig primitives", () => {
  test("face: 'skin' is registered, creates no floating face meshes, and switching from 'game' hides them", async () => {
    installPixelDocument();
    expect(FACES.some((f: { id: string }) => f.id === "skin")).toBe(true);

    const template = await loadPlayerTemplate();
    const baseSkin = makePixelCanvas(64, 64, [210, 170, 140, 255]);

    const skinOnly = await makePlayer(template, baseSkin, { face: "skin" });
    const headPlanesSkin = skinOnly.bones.head.children.filter(
      (c: THREE.Object3D) => (c as THREE.Mesh).isMesh,
    );
    expect(headPlanesSkin).toHaveLength(0);

    // Switching game -> skin hides all floating face pieces cleanly
    const gamePlayer = await makePlayer(template, baseSkin, { face: "game" });
    const headMeshes = gamePlayer.bones.head.children.filter(
      (c: THREE.Object3D) => (c as THREE.Mesh).isMesh,
    );
    expect(headMeshes.length).toBeGreaterThan(5);
    gamePlayer.setFace("skin");
    expect(headMeshes.every((m: THREE.Object3D) => !m.visible)).toBe(true);
    expect(readPixel(gamePlayer.skin, 9, 12)).toEqual([210, 170, 140, 255]);
  });

  test("eye-white and teeth emissive intensity is restrained by glow and never hardcoded at 0.25", async () => {
    installPixelDocument();
    const template = await loadPlayerTemplate();
    const baseSkin = makePixelCanvas(64, 64, [200, 160, 130, 255]);

    const eyeWhiteEmissive = async (glow: number) => {
      const p = await makePlayer(template, baseSkin, { glow, face: "game" });
      const mats: THREE.MeshStandardMaterial[] = [];
      p.bones.head.traverse((o: THREE.Object3D) => {
        if (
          (o as THREE.Mesh).isMesh &&
          (o as THREE.Mesh).material instanceof THREE.MeshStandardMaterial
        ) {
          mats.push((o as THREE.Mesh).material as THREE.MeshStandardMaterial);
        }
      });
      const white = mats.find((m) => m.color.getHexString() === "f4f4f4");
      const teeth = mats.find((m) => m.color.getHexString() === "efeee4");
      expect(white).toBeDefined();
      expect(teeth).toBeDefined();
      return { white: white!.emissiveIntensity, teeth: teeth!.emissiveIntensity };
    };

    const atDefault = await eyeWhiteEmissive(0.08);
    expect(atDefault.white).toBeLessThanOrEqual(0.08);
    expect(atDefault.white).toBeGreaterThan(0);
    expect(atDefault.teeth).toBeLessThanOrEqual(0.08);

    const atWarmInterior = await eyeWhiteEmissive(0.03);
    expect(atWarmInterior.white).toBeLessThanOrEqual(0.03);
    expect(atWarmInterior.white).toBeGreaterThanOrEqual(0);

    const atZero = await eyeWhiteEmissive(0);
    expect(atZero.white).toBe(0);
    expect(atZero.teeth).toBe(0);

    const atHighGlow = await eyeWhiteEmissive(0.5);
    expect(atHighGlow.white).toBeLessThanOrEqual(0.08);
    expect(atHighGlow.teeth).toBeLessThanOrEqual(0.08);
  });

  test("exposes handR, handL, and holdProp mounting props inside clean wrist groups without mutating hand transforms", async () => {
    installPixelDocument();
    const template = await loadPlayerTemplate();
    const baseSkin = makePixelCanvas(64, 64, [180, 150, 120, 255]);
    const p = await makePlayer(template, baseSkin, { face: "skin" });

    expect(p.handR).toBe(p.hand);
    expect(p.handR).toBeInstanceOf(THREE.Group);
    expect(p.handL).toBeInstanceOf(THREE.Group);
    expect(p.handR.name).toBe("handR");
    expect(p.handL.name).toBe("handL");

    p.g.updateMatrixWorld(true);
    const scaleR = p.handR.getWorldScale(new THREE.Vector3());
    expect(scaleR.x).toBeCloseTo(1, 5);
    expect(scaleR.y).toBeCloseTo(1, 5);
    expect(scaleR.z).toBeCloseTo(1, 5);

    const handRPosBefore = p.handR.position.toArray();
    const propR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1));
    const wristR = p.holdProp("R", propR, { pos: [0.05, -0.1, 0.2], rot: [0.5, 0.25, 0] });
    expect(wristR).toBeInstanceOf(THREE.Group);
    expect(wristR.parent).toBe(p.handR);
    expect(propR.parent).toBe(wristR);
    expect(wristR.position.toArray()).toEqual([0.05, -0.1, 0.2]);
    expect(wristR.rotation.x).toBeCloseTo(0.5, 6);
    expect(wristR.rotation.y).toBeCloseTo(0.25, 6);
    expect(p.handR.position.toArray()).toEqual(handRPosBefore);

    const propL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
    const wristL = p.holdProp("L", propL);
    expect(wristL.parent).toBe(p.handL);
    expect(propL.parent).toBe(wristL);

    expect(() => p.holdProp("X" as "R", propL)).toThrow();
  });

  test("paintSkinOverlay and setSkin composite deterministically from an immutable base skin across scrubs and resizes", async () => {
    installPixelDocument();
    const template = await loadPlayerTemplate();
    const baseSkin = makePixelCanvas(64, 64, [200, 160, 120, 255]);
    const p = await makePlayer(template, baseSkin, { face: "skin" });
    const mat = getBodyMaterial(p);

    // Frame A: paint a red mark at (10, 10) and dirty ctx.globalAlpha to verify save/restore isolation
    const ver0 = mat.map!.version;
    p.paintSkinOverlay((ctx: PixelContext) => {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(10, 10, 2, 2);
    });
    expect(mat.map!.version).toBeGreaterThan(ver0);
    expect(readPixel(p.skin, 10, 10)[0]).toBeGreaterThan(220);

    // Frame B (scrub backward/different overlay): mark at (10, 10) MUST be gone, base restored at full alpha
    const ver1 = mat.map!.version;
    p.paintSkinOverlay((ctx: PixelContext) => {
      ctx.fillStyle = "#0000ff";
      ctx.fillRect(12, 12, 1, 1);
    });
    expect(mat.map!.version).toBeGreaterThan(ver1);
    expect(readPixel(p.skin, 10, 10)).toEqual([200, 160, 120, 255]);
    expect(readPixel(p.skin, 12, 12)).toEqual([0, 0, 255, 255]);

    // Passing null restores clean base skin completely
    p.paintSkinOverlay(null);
    expect(readPixel(p.skin, 12, 12)).toEqual([200, 160, 120, 255]);

    // Works with setFace("noeyes") too: base -> noeyes cheek patch -> overlay
    p.setFace("noeyes");
    p.paintSkinOverlay((ctx: PixelContext) => {
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(20, 20, 1, 1);
    });
    expect(readPixel(p.skin, 20, 20)).toEqual([0, 255, 0, 255]);
    // Eye pixel (8+1, 8+4) = (9, 12) is painted 0.95x cheek by noeyes
    expect(readPixel(p.skin, 9, 12)[0]).toBe((200 * 0.95) | 0);

    // setSkin replaces base skin (including dimension resize 64 -> 128) and reallocates CanvasTexture
    const oldMap = mat.map;
    let disposed = false;
    const origDispose = oldMap!.dispose.bind(oldMap);
    oldMap!.dispose = () => {
      disposed = true;
      origDispose();
    };
    const hdSkin = makePixelCanvas(128, 128, [80, 90, 100, 255]);
    p.setFace("skin");
    p.paintSkinOverlay(null);
    p.setSkin(hdSkin);
    expect(disposed).toBe(true);
    expect(mat.map).not.toBe(oldMap);
    expect(mat.emissiveMap).toBe(mat.map);
    expect(p.skin.canvas.width).toBe(128);
    expect(readPixel(p.skin, 100, 100)).toEqual([80, 90, 100, 255]);

    // Subsequent overlay + clear uses the new 128x128 base skin
    p.paintSkinOverlay((ctx: PixelContext, w: number, h: number) => {
      expect(w).toBe(128);
      expect(h).toBe(128);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(100, 100, 1, 1);
    });
    expect(readPixel(p.skin, 100, 100)).toEqual([255, 255, 255, 255]);
    p.paintSkinOverlay(null);
    expect(readPixel(p.skin, 100, 100)).toEqual([80, 90, 100, 255]);
    expect(() => p.setSkin({ width: 0, height: 64 })).toThrow();
  });

  test("SKIN_UV maps canonical 64x64 Steve UV rects for all 6 limbs with zero overlap", () => {
    const parts = ["head", "body", "armR", "armL", "legR", "legL"] as const;
    const faces = ["top", "bottom", "right", "front", "left", "back"] as const;

    expect(SKIN_UV.head.front).toEqual([8, 8, 8, 8]);
    expect(SKIN_UV.body.front).toEqual([20, 20, 8, 12]);
    expect(SKIN_UV.armR.front).toEqual([44, 20, 4, 12]);
    expect(SKIN_UV.armL.front).toEqual([36, 52, 4, 12]);
    expect(SKIN_UV.legR.front).toEqual([4, 20, 4, 12]);
    expect(SKIN_UV.legL.front).toEqual([20, 52, 4, 12]);

    const rects: Array<{ name: string; r: readonly [number, number, number, number] }> = [];
    for (const part of parts) {
      for (const face of faces) {
        const r = SKIN_UV[part][face];
        expect(r).toHaveLength(4);
        const [x, y, w, h] = r;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(w).toBeGreaterThan(0);
        expect(h).toBeGreaterThan(0);
        expect(x + w).toBeLessThanOrEqual(64);
        expect(y + h).toBeLessThanOrEqual(64);
        rects.push({ name: `${part}.${face}`, r });
      }
    }

    // Verify no two face rects overlap in the 64x64 atlas
    for (let i = 0; i < rects.length; i++) {
      const [ax, ay, aw, ah] = rects[i]!.r;
      for (let j = i + 1; j < rects.length; j++) {
        const [bx, by, bw, bh] = rects[j]!.r;
        const overlap = ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
        expect(overlap, `${rects[i]!.name} overlaps ${rects[j]!.name}`).toBe(false);
      }
    }
  });
});
