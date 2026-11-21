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
  globalCompositeOperation: string;
  save: () => void;
  restore: () => void;
  clearRect: (x: number, y: number, w: number, h: number) => void;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  drawImage: (src: PixelCanvas, dx: number, dy: number) => void;
  getImageData: (
    x: number,
    y: number,
    w: number,
    h: number,
  ) => { data: Uint8ClampedArray; width: number };
  putImageData: (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) => void;
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
  const stack: Array<{ fillStyle: string; globalAlpha: number; globalCompositeOperation: string }> =
    [];
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
    globalCompositeOperation: "source-over",
    save() {
      stack.push({
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
        globalCompositeOperation: this.globalCompositeOperation,
      });
    },
    restore() {
      const prev = stack.pop();
      if (prev) {
        this.fillStyle = prev.fillStyle;
        this.globalAlpha = prev.globalAlpha;
        this.globalCompositeOperation = prev.globalCompositeOperation;
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
      const mul = this.globalCompositeOperation === "multiply";
      for (let py = Math.max(0, y); py < Math.min(height, y + rh); py++) {
        for (let px = Math.max(0, x); px < Math.min(width, x + rw); px++) {
          const i = (py * width + px) * 4;
          const sr = mul ? Math.round((data[i]! * r) / 255) : r;
          const sg = mul ? Math.round((data[i + 1]! * g) / 255) : g;
          const sb = mul ? Math.round((data[i + 2]! * b) / 255) : b;
          data[i] = Math.round(data[i]! * (1 - alpha) + sr * alpha);
          data[i + 1] = Math.round(data[i + 1]! * (1 - alpha) + sg * alpha);
          data[i + 2] = Math.round(data[i + 2]! * (1 - alpha) + sb * alpha);
          data[i + 3] = Math.min(255, Math.round(data[i + 3]! + (255 - data[i + 3]!) * alpha));
        }
      }
    },
    drawImage(src, dx, dy) {
      const alpha = Math.max(0, Math.min(1, this.globalAlpha));
      const mul = this.globalCompositeOperation === "multiply";
      for (let py = 0; py < src.height; py++) {
        const ty = py + dy;
        if (ty < 0 || ty >= height) continue;
        for (let px = 0; px < src.width; px++) {
          const tx = px + dx;
          if (tx < 0 || tx >= width) continue;
          const si = (py * src.width + px) * 4;
          const ti = (ty * width + tx) * 4;
          const sa = (src.data[si + 3]! / 255) * alpha;
          if (mul) {
            data[ti] = Math.round((data[ti]! * src.data[si]!) / 255);
            data[ti + 1] = Math.round((data[ti + 1]! * src.data[si + 1]!) / 255);
            data[ti + 2] = Math.round((data[ti + 2]! * src.data[si + 2]!) / 255);
          } else {
            data[ti] = Math.round(data[ti]! * (1 - sa) + src.data[si]! * sa);
            data[ti + 1] = Math.round(data[ti + 1]! * (1 - sa) + src.data[si + 1]! * sa);
            data[ti + 2] = Math.round(data[ti + 2]! * (1 - sa) + src.data[si + 2]! * sa);
            data[ti + 3] = Math.round(
              Math.min(255, data[ti + 3]! * (1 - sa) + src.data[si + 3]! * alpha),
            );
          }
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
      return { data: out, width: rw };
    },
    putImageData(img, x, y) {
      const rh = img.data.length / 4 / img.width;
      for (let py = 0; py < rh; py++)
        for (let px = 0; px < img.width; px++)
          for (let c = 0; c < 4; c++)
            data[((y + py) * width + (x + px)) * 4 + c] = img.data[(py * img.width + px) * 4 + c]!;
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

  // Fallback synthetic rig matching player.glb bone names + inner & Layer2 skinned head boxes
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

  const bones = [root, body, chest, head, uaL, laL, uaR, laR, ulL, llL, ulR, llR];
  const makeSkinned = (name: string, size: number) => {
    const geo = new THREE.BoxGeometry(size, size, size);
    geo.translate(0, 28 * PX, 0);
    const count = geo.attributes.position.count;
    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      skinIndices[i * 4] = 3;
      skinWeights[i * 4] = 1;
    }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
    mesh.name = name;
    mesh.bind(new THREE.Skeleton(bones));
    return mesh;
  };
  template.add(makeSkinned("BodyMesh", 8 * PX), makeSkinned("BodyLayer2", 8.5 * PX));
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

function getSkinMaterials(player: Awaited<ReturnType<typeof makePlayer>>): {
  inner: THREE.MeshStandardMaterial;
  outer: THREE.MeshStandardMaterial;
} {
  const innerList: THREE.MeshStandardMaterial[] = [];
  const outerList: THREE.MeshStandardMaterial[] = [];
  player.rig.traverse((o: THREE.Object3D) => {
    if (!(o as THREE.SkinnedMesh).isSkinnedMesh) return;
    const m = (o as THREE.SkinnedMesh).material as THREE.MeshStandardMaterial;
    if (/Layer2/.test(o.name)) outerList.push(m);
    else innerList.push(m);
  });
  if (!innerList[0] || !outerList[0]) {
    throw new Error("expected inner and Layer2 outer SkinnedMesh materials");
  }
  return { inner: innerList[0], outer: outerList[0] };
}

function getHeadFaceMaterials(
  player: Awaited<ReturnType<typeof makePlayer>>,
): THREE.MeshStandardMaterial[] {
  const mats: THREE.MeshStandardMaterial[] = [];
  player.bones.head.traverse((o: THREE.Object3D) => {
    if (
      (o as THREE.Mesh).isMesh &&
      (o as THREE.Mesh).material instanceof THREE.MeshStandardMaterial
    ) {
      mats.push((o as THREE.Mesh).material as THREE.MeshStandardMaterial);
    }
  });
  return mats;
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
      const mats = getHeadFaceMaterials(p);
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

  test("exposes handR, handL, and holdProp mounting props inside clean wrist groups and pruning emptied wrists on remount", async () => {
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

    // Re-mounting propR into handL prunes the now-empty wristR group cleanly
    const wristMoved = p.holdProp("L", propR);
    expect(wristMoved.parent).toBe(p.handL);
    expect(propR.parent).toBe(wristMoved);
    expect(wristR.parent).toBeNull();
    expect(p.handR.children).toHaveLength(0);

    expect(() => p.holdProp("X" as "R", propR)).toThrow();
  });

  test("paintSkinOverlay and setSkin composite deterministically across scrubs, same-size updates, Layer2 sync, and resizes", async () => {
    installPixelDocument();
    const template = await loadPlayerTemplate();
    const baseSkin = makePixelCanvas(64, 64, [200, 160, 120, 255]);
    const p = await makePlayer(template, baseSkin, { face: "skin" });
    const { inner, outer } = getSkinMaterials(p);

    // Dirty external canvas state must not corrupt redrawSkin base compositing OR overlayFn defaults
    p.skin.globalAlpha = 0.1;
    p.skin.globalCompositeOperation = "multiply";

    // Frame A: paint red mark at (10, 10)
    const ver0 = inner.map!.version;
    p.paintSkinOverlay((ctx: PixelContext) => {
      expect(ctx.globalAlpha).toBe(1);
      expect(ctx.globalCompositeOperation).toBe("source-over");
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(10, 10, 2, 2);
    });
    expect(inner.map!.version).toBeGreaterThan(ver0);
    expect(outer.map).toBe(inner.map);
    expect(readPixel(p.skin, 10, 10)[0]).toBeGreaterThan(220);

    // Frame B (scrub backward): mark at (10, 10) is gone and overlayFn still starts clean despite dirty p.skin
    const ver1 = inner.map!.version;
    p.paintSkinOverlay((ctx: PixelContext) => {
      expect(ctx.globalAlpha).toBe(1);
      expect(ctx.globalCompositeOperation).toBe("source-over");
      ctx.fillStyle = "#0000ff";
      ctx.fillRect(12, 12, 1, 1);
    });
    expect(inner.map!.version).toBeGreaterThan(ver1);
    expect(readPixel(p.skin, 10, 10)).toEqual([200, 160, 120, 255]);
    expect(readPixel(p.skin, 12, 12)).toEqual([0, 0, 255, 255]);

    // Passing null restores clean base skin completely
    p.paintSkinOverlay(null);
    expect(readPixel(p.skin, 12, 12)).toEqual([200, 160, 120, 255]);

    // Same-size setSkin reuses existing CanvasTexture without disposal and updates pixels for both inner & outer
    const sameMapBefore = inner.map;
    let sameSizeDisposed = false;
    const origDisposeSame = sameMapBefore!.dispose.bind(sameMapBefore);
    sameMapBefore!.dispose = () => {
      sameSizeDisposed = true;
      origDisposeSame();
    };
    const altSkin64 = makePixelCanvas(64, 64, [110, 140, 170, 255]);
    p.setSkin(altSkin64);
    expect(sameSizeDisposed).toBe(false);
    expect(inner.map).toBe(sameMapBefore);
    expect(outer.map).toBe(sameMapBefore);
    expect(readPixel(p.skin, 12, 12)).toEqual([110, 140, 170, 255]);

    // Works with setFace("noeyes"): base -> eye patch -> overlay
    p.setFace("noeyes");
    p.paintSkinOverlay((ctx: PixelContext) => {
      expect(ctx.globalAlpha).toBe(1);
      expect(ctx.globalCompositeOperation).toBe("source-over");
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(20, 20, 1, 1);
    });
    expect(readPixel(p.skin, 20, 20)).toEqual([0, 255, 0, 255]);
    expect(readPixel(p.skin, 9, 12)[0]).toBe((110 * 0.95) | 0);

    // Resize setSkin (64 -> 128) reallocates CanvasTexture, disposes old one, and syncs BOTH inner and Layer2 outer
    const oldMap = inner.map;
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
    expect(inner.map).not.toBe(oldMap);
    expect(inner.emissiveMap).toBe(inner.map);
    expect(outer.map).toBe(inner.map);
    expect(outer.emissiveMap).toBe(inner.map);
    expect(p.skin.canvas.width).toBe(128);
    expect(readPixel(p.skin, 100, 100)).toEqual([80, 90, 100, 255]);

    // Subsequent overlay + clear uses the new 128x128 base skin
    p.paintSkinOverlay((ctx: PixelContext, w: number, h: number) => {
      expect(w).toBe(128);
      expect(h).toBe(128);
      expect(ctx.globalAlpha).toBe(1);
      expect(ctx.globalCompositeOperation).toBe("source-over");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(100, 100, 1, 1);
    });
    expect(readPixel(p.skin, 100, 100)).toEqual([255, 255, 255, 255]);
    p.paintSkinOverlay(null);
    expect(readPixel(p.skin, 100, 100)).toEqual([80, 90, 100, 255]);
    expect(() => p.setSkin({ width: 0, height: 64 })).toThrow();
  });

  test("setSkin recolors gameFace eyelids, iris, brows, and mouth deterministically across scrubs and 128x128 HD skins", async () => {
    installPixelDocument();
    const template = await loadPlayerTemplate();

    // Paint distinct pixel colors for cheek(1,5), iris(2,4), hair/brow(3,0), lip/mouth(3,6)
    const paintFaceSamples = (
      canvas: PixelCanvas,
      scale: number,
      cols: { skin: string; iris: string; hair: string; lip: string },
    ) => {
      const c = canvas.getContext();
      const setPx = (fx: number, fy: number, hex: string) => {
        c.fillStyle = hex;
        c.fillRect((8 + fx) * scale, (8 + fy) * scale, scale, scale);
      };
      setPx(1, 5, cols.skin);
      setPx(2, 4, cols.iris);
      setPx(3, 0, cols.hair);
      setPx(3, 6, cols.lip);
    };

    const skinA = makePixelCanvas(64, 64, [20, 20, 20, 255]);
    paintFaceSamples(skinA, 1, {
      skin: "#c88c64",
      iris: "#2266dd",
      hair: "#503020",
      lip: "#b05040",
    });

    const skinB = makePixelCanvas(128, 128, [10, 10, 10, 255]);
    paintFaceSamples(skinB, 2, {
      skin: "#5080c0",
      iris: "#22bb44",
      hair: "#ccaa22",
      lip: "#8833aa",
    });

    const p = await makePlayer(template, skinA, { face: "game" });
    const mats = getHeadFaceMaterials(p);
    const lidMat = mats.find((m) => m.polygonOffsetFactor === -4)!;
    const irisMat = mats.find(
      (m) =>
        m.polygonOffsetFactor === -2 &&
        m.color.getHexString() !== "efeee4" &&
        m.color.getHexString() !== "b9534f",
    )!;
    const browMat = mats.find((m) => !m.polygonOffset)!;
    const mouthMat = mats.find(
      (m) => m.polygonOffsetFactor === -1 && m.color.getHexString() !== "f4f4f4",
    )!;
    expect(lidMat).toBeDefined();
    expect(irisMat).toBeDefined();
    expect(browMat).toBeDefined();
    expect(mouthMat).toBeDefined();

    const expA = {
      lid: new THREE.Color("#c88c64").multiplyScalar(0.9).getHexString(),
      iris: new THREE.Color("#2266dd").getHexString(),
      brow: new THREE.Color("#503020").multiplyScalar(0.75).getHexString(),
      mouth: new THREE.Color("#b05040").multiplyScalar(0.35).getHexString(),
    };
    const expB = {
      lid: new THREE.Color("#5080c0").multiplyScalar(0.9).getHexString(),
      iris: new THREE.Color("#22bb44").getHexString(),
      brow: new THREE.Color("#ccaa22").multiplyScalar(0.75).getHexString(),
      mouth: new THREE.Color("#8833aa").multiplyScalar(0.35).getHexString(),
    };

    const assertAll = (exp: typeof expA) => {
      for (const [mat, want] of [
        [lidMat, exp.lid],
        [irisMat, exp.iris],
        [browMat, exp.brow],
        [mouthMat, exp.mouth],
      ] as const) {
        expect(mat.color.getHexString()).toBe(want);
        expect(mat.emissive.getHexString()).toBe(want);
      }
    };

    assertAll(expA);
    p.setSkin(skinB);
    assertAll(expB);
    p.setSkin(skinA);
    assertAll(expA);
  });

  test("makePlayer faceColors overrides selected game-face channels and persists across setSkin and lazy setFace", async () => {
    installPixelDocument();
    const rig = await loadPlayerTemplate();

    const makeDistinctSkin = (colors: {
      cheek: [number, number, number];
      iris: [number, number, number];
      brow: [number, number, number];
      mouth: [number, number, number];
    }) => {
      const c = makePixelCanvas(64, 64, [20, 20, 20, 255]);
      const setPx = (x: number, y: number, rgb: [number, number, number]) => {
        const i = (y * 64 + x) * 4;
        c.data[i] = rgb[0];
        c.data[i + 1] = rgb[1];
        c.data[i + 2] = rgb[2];
        c.data[i + 3] = 255;
      };
      setPx(9, 13, colors.cheek);
      setPx(10, 12, colors.iris);
      setPx(11, 8, colors.brow);
      setPx(11, 14, colors.mouth);
      return c;
    };

    const skinBald = makeDistinctSkin({
      cheek: [210, 160, 120],
      iris: [40, 110, 210],
      brow: [210, 160, 120], // bald forehead: skin-colored (3,0) pixel
      mouth: [180, 90, 80],
    });
    const skinNext = makeDistinctSkin({
      cheek: [140, 100, 80],
      iris: [30, 180, 90],
      brow: [240, 240, 240],
      mouth: [120, 40, 40],
    });

    // Lazy creation: start in "skin" face, switch to "game" later (and prove caller mutations don't leak)
    const irisCol = new THREE.Color("#2288ee");
    const lazyFaceColors = { brow: "#3a2518", iris: irisCol };
    const p = await makePlayer(rig, skinBald, {
      face: "skin",
      faceColors: lazyFaceColors,
    });
    lazyFaceColors.brow = "#ff0000";
    irisCol.set("#00ff00");
    p.setFace("game");

    const pickMats = (player: Awaited<ReturnType<typeof makePlayer>>) => {
      const mats = getHeadFaceMaterials(player);
      return {
        lidMat: mats.find((m) => m.polygonOffsetFactor === -4)!,
        irisMat: mats.find(
          (m) =>
            m.polygonOffsetFactor === -2 &&
            m.color.getHexString() !== "efeee4" &&
            m.color.getHexString() !== "b9534f",
        )!,
        browMat: mats.find((m) => !m.polygonOffset)!,
        mouthMat: mats.find(
          (m) => m.polygonOffsetFactor === -1 && m.color.getHexString() !== "f4f4f4",
        )!,
      };
    };
    const expectMat = (mat: THREE.MeshStandardMaterial, hex: string) => {
      expect(mat.color.getHexString()).toBe(hex);
      expect(mat.emissive.getHexString()).toBe(hex);
    };

    const lazy = pickMats(p);
    // Overridden channels keep exact requested hex; omitted channels auto-sample skin
    expectMat(lazy.browMat, new THREE.Color("#3a2518").getHexString());
    expectMat(lazy.irisMat, new THREE.Color("#2288ee").getHexString());
    expectMat(lazy.lidMat, new THREE.Color("rgb(210,160,120)").multiplyScalar(0.9).getHexString());
    expectMat(lazy.mouthMat, new THREE.Color("rgb(180,90,80)").multiplyScalar(0.35).getHexString());

    // After setSkin, overridden brow/iris remain locked while lid/mouth re-sample skinNext
    p.setSkin(skinNext);
    expectMat(lazy.browMat, new THREE.Color("#3a2518").getHexString());
    expectMat(lazy.irisMat, new THREE.Color("#2288ee").getHexString());
    expectMat(lazy.lidMat, new THREE.Color("rgb(140,100,80)").multiplyScalar(0.9).getHexString());
    expectMat(lazy.mouthMat, new THREE.Color("rgb(120,40,40)").multiplyScalar(0.35).getHexString());

    // Default eager face: "game" with lid & numeric 0x000000 mouth overrides
    const eagerPlayer = await makePlayer(rig, skinBald, {
      faceColors: { lid: "#aabbcc", mouth: 0x000000 },
    });
    const eager = pickMats(eagerPlayer);
    expectMat(eager.lidMat, new THREE.Color("#aabbcc").getHexString());
    expectMat(eager.mouthMat, "000000");
    expectMat(eager.irisMat, new THREE.Color("rgb(40,110,210)").getHexString());
    expectMat(
      eager.browMat,
      new THREE.Color("rgb(210,160,120)").multiplyScalar(0.75).getHexString(),
    );

    eagerPlayer.setSkin(skinNext);
    expectMat(eager.lidMat, new THREE.Color("#aabbcc").getHexString());
    expectMat(eager.mouthMat, "000000");
    expectMat(eager.irisMat, new THREE.Color("rgb(30,180,90)").getHexString());
    expectMat(
      eager.browMat,
      new THREE.Color("rgb(240,240,240)").multiplyScalar(0.75).getHexString(),
    );
  });

  // a close-up of a hand needed a second, scaled chef with all his skin but one arm wiped by hand, and a red face needed
  // a raw pixel rect painted over the head: both are the player's own now
  const plainSkin = () => {
    const c = makePixelCanvas(64, 64, [200, 160, 120, 255]);
    c.getContext().clearRect(32, 0, 32, 16); // the hat layer empty, as most skins have it
    return c;
  };

  test("faceColors.white colours the eye whites", async () => {
    installPixelDocument();
    const p = await makePlayer(await loadPlayerTemplate(), plainSkin(), {
      faceColors: { white: "#ddeeff" },
    });
    const faceMats = getHeadFaceMaterials(p);
    expect(faceMats.some((m) => m.color.getHexString() === "ddeeff")).toBe(true);
    expect(faceMats.some((m) => m.color.getHexString() === "f4f4f4")).toBe(false);
  });

  test("eyeWhite recolours the eye whites, and null brings back the film's faceColors.white", async () => {
    installPixelDocument();
    const p = await makePlayer(await loadPlayerTemplate(), plainSkin(), {
      faceColors: { white: "#ddeeff" },
    });
    const whites = () => getHeadFaceMaterials(p).map((m) => m.color.getHexString());
    p.eyeWhite("#ff99aa");
    expect(whites()).toContain("ff99aa");
    expect(whites()).not.toContain("ddeeff");
    p.eyeWhite(null);
    expect(whites()).toContain("ddeeff");
    expect(whites()).not.toContain("ff99aa");
  });

  test("tintParts multiplies a SKIN_UV part's pixels and the lids follow it, through setSkin until cleared", async () => {
    installPixelDocument();
    const p = await makePlayer(await loadPlayerTemplate(), plainSkin());
    p.tintParts({ head: "#ff8000" });
    expect(readPixel(p.skin, 12, 12)).toEqual([200, 80, 0, 255]); // head front
    expect(readPixel(p.skin, 44, 12)).toEqual([0, 0, 0, 0]); // hat front stays see-through
    expect(readPixel(p.skin, 24, 24)).toEqual([200, 160, 120, 255]); // body front
    const lid = getHeadFaceMaterials(p).find((m) => m.polygonOffsetFactor === -4)!;
    expect(lid.color.getHexString()).toBe(
      new THREE.Color("rgb(200,80,0)").multiplyScalar(0.9).getHexString(),
    );
    p.setSkin(plainSkin());
    expect(readPixel(p.skin, 12, 12)).toEqual([200, 80, 0, 255]);
    p.tintParts(null);
    expect(readPixel(p.skin, 12, 12)).toEqual([200, 160, 120, 255]);
    expect(() => p.tintParts({ hands: "#fff" })).toThrow(/SKIN_UV/);
  });

  test("showParts keeps only the named parts and their overlay, hides the face, through setSkin until cleared", async () => {
    installPixelDocument();
    const p = await makePlayer(await loadPlayerTemplate(), plainSkin());
    const faceMats = getHeadFaceMaterials(p);
    const { inner } = getSkinMaterials(p);
    p.showParts(["armR"]);
    expect(readPixel(p.skin, 44, 24)).toEqual([200, 160, 120, 255]); // right arm front
    expect(readPixel(p.skin, 44, 40)).toEqual([200, 160, 120, 255]); // its sleeve
    for (const [x, y] of [
      [12, 12], // head
      [24, 24], // body
      [36, 52], // left arm
      [4, 24], // right leg
      [24, 40], // jacket
    ] as const)
      expect(readPixel(p.skin, x, y)[3]).toBe(0);
    expect(inner.alphaTest).toBe(0.5);
    expect(faceMats.every((m) => !m.visible)).toBe(true);
    p.setSkin(plainSkin());
    expect(readPixel(p.skin, 24, 24)[3]).toBe(0);
    p.showParts(null);
    expect(readPixel(p.skin, 24, 24)).toEqual([200, 160, 120, 255]);
    expect(inner.alphaTest).toBe(0);
    expect(faceMats.every((m) => m.visible)).toBe(true);
    expect(() => p.showParts(["hand"])).toThrow(/head, body, armR, armL, legR, legL/);
  });

  test("SKIN_UV maps canonical 64x64 Steve UV rects for all 12 Layer-1 and Layer-2 boxes with zero overlap", () => {
    const parts = [
      "head",
      "hat",
      "body",
      "jacket",
      "armR",
      "sleeveR",
      "armL",
      "sleeveL",
      "legR",
      "pantR",
      "legL",
      "pantL",
    ] as const;
    const faces = ["top", "bottom", "right", "front", "left", "back"] as const;

    expect(SKIN_UV.head.front).toEqual([8, 8, 8, 8]);
    expect(SKIN_UV.hat.front).toEqual([40, 8, 8, 8]);
    expect(SKIN_UV.body.front).toEqual([20, 20, 8, 12]);
    expect(SKIN_UV.jacket.front).toEqual([20, 36, 8, 12]);
    expect(SKIN_UV.armR.front).toEqual([44, 20, 4, 12]);
    expect(SKIN_UV.sleeveR.front).toEqual([44, 36, 4, 12]);
    expect(SKIN_UV.armL.front).toEqual([36, 52, 4, 12]);
    expect(SKIN_UV.sleeveL.front).toEqual([52, 52, 4, 12]);
    expect(SKIN_UV.legR.front).toEqual([4, 20, 4, 12]);
    expect(SKIN_UV.pantR.front).toEqual([4, 36, 4, 12]);
    expect(SKIN_UV.legL.front).toEqual([20, 52, 4, 12]);
    expect(SKIN_UV.pantL.front).toEqual([4, 52, 4, 12]);

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
        rects.push({ name: `${part}.${face}`, r: [x, y, w, h] });
      }
    }

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
