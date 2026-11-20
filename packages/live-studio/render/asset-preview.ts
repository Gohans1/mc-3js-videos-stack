// @ts-nocheck
// Standalone headless WebGL preview sheet for Minecraft blocks & items:
// renders Front + 3/4 views beside a 1.875m Steve scale figure in ONE Chrome boot.
// Invoked by `bun run asset preview [id...] --film films/<name>` via render.mjs ENTRY=.
import {
  configure,
  parseBlockstate,
  parseItemDefinition,
  prepareAssets,
  readFile,
  resolveModelData,
} from "block-model-renderer";
import { unzipSync } from "fflate";
import { canvas as glCanvas, config, done, log, still } from "live-studio/lab";
import { loadRig, makePlayer } from "mc-actor/player";
import { blockModel, itemModel } from "mc-assets/model";
import { props as sharedProps } from "mc-assets/pack";
import * as THREE from "three";

import {
  MAX_PREVIEW_ITEMS,
  normalizePreviewEntry,
  PREVIEW_JSON_PREFIX,
  validatePreviewOut,
  validatePreviewSize,
} from "../src/asset-preview-pure.mjs";
import { computeVisibleBounds } from "./probe";

const VIEW_W = 320;
const VIEW_H = 386;
const HEADER_H = 34;
const TILE_W = VIEW_W * 2;
const TILE_H = VIEW_H + HEADER_H;
const GAP = 12;
const PAD = 12;
const TITLE_H = 36;
const FOV_DEG = 36;
const STEVE_HEIGHT_M = 1.875;

const round4 = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : 0);

const isMissingModelId = (model: unknown): boolean =>
  model === "block-model-renderer:missing" || model === "block-model-renderer:missing.json";

const isMissingSentinel = (parts: unknown[]): boolean => {
  if (!Array.isArray(parts) || parts.length !== 1) return false;
  const first = parts[0] as string | { model?: string } | undefined;
  const model = typeof first === "string" ? first : first?.model;
  return isMissingModelId(model);
};

function makeFallbackSteve(): THREE.Group {
  const g = new THREE.Group();
  g.name = "steve-scale-proxy";
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x3b82a6,
    roughness: 0.78,
    metalness: 0.05,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xc99c7a,
    roughness: 0.75,
    metalness: 0.05,
  });
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x37477a,
    roughness: 0.8,
    metalness: 0.05,
  });
  const px = STEVE_HEIGHT_M / 32; // 1.875 m / 32 MC pixels
  const addPart = (
    w: number,
    h: number,
    d: number,
    x: number,
    yBottom: number,
    z: number,
    mat: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * px, h * px, d * px), mat);
    mesh.position.set(x * px, (yBottom + h / 2) * px, z * px);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  addPart(4, 12, 4, -2, 0, 0, legMat);
  addPart(4, 12, 4, 2, 0, 0, legMat);
  addPart(8, 12, 4, 0, 12, 0, bodyMat);
  addPart(4, 12, 4, -6, 12, 0, bodyMat);
  addPart(4, 12, 4, 6, 12, 0, bodyMat);
  addPart(8, 8, 8, 0, 24, 0, headMat);
  return g;
}

async function loadScaleFigure(
  jarBytes: Uint8Array,
): Promise<{ obj: THREE.Object3D; mode: "steve-rig" | "proxy" }> {
  try {
    const rig = await loadRig("rig/player.glb");
    const skinKey = "assets/minecraft/textures/entity/player/wide/steve.png";
    const unpacked = unzipSync(jarBytes, { filter: (f) => f.name === skinKey });
    const skinBytes = unpacked[skinKey];
    let skinUrl: string | null = null;
    if (skinBytes) {
      skinUrl = URL.createObjectURL(new Blob([skinBytes], { type: "image/png" }));
    }
    try {
      const steve = await makePlayer(rig, skinUrl ?? undefined, { glow: 0.03, face: "skin" });
      steve.setPose({ root: { x: 0, y: 0, z: 0 } });
      steve.g.updateMatrixWorld(true);
      const box = computeVisibleBounds(steve.g);
      if (!box.isEmpty()) {
        const cx = (box.min.x + box.max.x) / 2;
        const cz = (box.min.z + box.max.z) / 2;
        steve.g.position.set(-cx, -box.min.y, -cz);
      }
      const holder = new THREE.Group();
      holder.add(steve.g);
      return { obj: holder, mode: "steve-rig" };
    } finally {
      if (skinUrl) URL.revokeObjectURL(skinUrl);
    }
  } catch {
    return { obj: makeFallbackSteve(), mode: "proxy" };
  }
}

const decodeText = new TextDecoder();

function splitAssetId(id: string): { ns: string; path: string } {
  const colon = id.indexOf(":");
  return colon >= 0
    ? { ns: id.slice(0, colon), path: id.slice(colon + 1) }
    : { ns: "minecraft", path: id };
}

async function modelChainExists(sources: unknown, modelRef: unknown): Promise<boolean> {
  if (typeof modelRef === "object" && modelRef !== null) return true;
  if (typeof modelRef !== "string" || !modelRef || isMissingModelId(modelRef)) return false;
  let current = modelRef;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) return false;
    seen.add(current);
    const { ns, path } = splitAssetId(current);
    const bytes = await readFile(`assets/${ns}/models/${path}.json`, sources);
    if (!bytes) return false;
    let parsed: { parent?: unknown };
    try {
      parsed = JSON.parse(typeof bytes === "string" ? bytes : decodeText.decode(bytes));
    } catch {
      return false;
    }
    if (!parsed || typeof parsed !== "object") return false;
    const parent = typeof parsed.parent === "string" ? parsed.parent : "";
    if (!parent || parent.startsWith("builtin")) break;
    current = parent;
  }
  return true;
}

async function checkPartsMissing(sources: unknown, parts: unknown[]): Promise<boolean> {
  if (!Array.isArray(parts) || !parts.length || isMissingSentinel(parts)) return true;
  let anyResolved = false;
  for (const part of parts) {
    if (part && typeof part === "object" && (part as { special?: unknown }).special) {
      anyResolved = true;
      continue;
    }
    const modelRef = typeof part === "string" ? part : (part as { model?: unknown })?.model;
    if (!(await modelChainExists(sources, modelRef))) return true;
    const resolved = await resolveModelData(sources, part);
    if (!resolved || isMissingModelId(resolved.model)) return true;
    const hasGeom =
      (Array.isArray(resolved.elements) && resolved.elements.length > 0) ||
      Boolean(resolved.textures && Object.keys(resolved.textures).length > 0);
    if (!hasGeom) return true;
    anyResolved = true;
  }
  return !anyResolved;
}

async function checkAssetMissing(
  sources: unknown,
  kind: "block" | "item",
  id: string,
): Promise<boolean> {
  try {
    if (kind === "block") {
      const parts = await parseBlockstate(sources, id, { data: {} });
      return await checkPartsMissing(sources, parts);
    }
    const { ns, path } = splitAssetId(id);
    if (path.includes("/")) {
      return await checkPartsMissing(sources, [{ model: id, type: "item" }]);
    }
    const parsed = await parseItemDefinition(sources, id, { display: {} });
    if (parsed.length && !isMissingSentinel(parsed)) {
      return await checkPartsMissing(sources, parsed);
    }
    return await checkPartsMissing(sources, [{ model: `${ns}:item/${path}`, type: "item" }]);
  } catch {
    return true;
  }
}

function fitCameraToBox(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
  azimuthRad: number,
  elevationRad: number,
): void {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const dx = Math.sin(azimuthRad) * Math.cos(elevationRad);
  const dy = Math.sin(elevationRad);
  const dz = Math.cos(azimuthRad) * Math.cos(elevationRad);
  const dir = new THREE.Vector3(dx, dy, dz).normalize();

  // Compute exact projected half-extents perpendicular to view direction
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const camUp = new THREE.Vector3().crossVectors(dir, right).normalize();

  let maxRight = 0;
  let maxUp = 0;
  let maxDepth = 0;
  const hx = Math.max(size.x / 2, 0.05);
  const hy = Math.max(size.y / 2, 0.05);
  const hz = Math.max(size.z / 2, 0.05);
  for (const sx of [-hx, hx]) {
    for (const sy of [-hy, hy]) {
      for (const sz of [-hz, hz]) {
        const vx = sx;
        const vy = sy;
        const vz = sz;
        maxRight = Math.max(maxRight, Math.abs(vx * right.x + vy * right.y + vz * right.z));
        maxUp = Math.max(maxUp, Math.abs(vx * camUp.x + vy * camUp.y + vz * camUp.z));
        maxDepth = Math.max(maxDepth, Math.abs(vx * dir.x + vy * dir.y + vz * dir.z));
      }
    }
  }

  const vFovRad = THREE.MathUtils.degToRad(camera.fov);
  const tanV = Math.tan(vFovRad / 2);
  const tanH = tanV * camera.aspect;
  const margin = 1.24;
  const distV = (maxUp * margin) / tanV;
  const distH = (maxRight * margin) / tanH;
  const dist = Math.max(distV, distH, 0.45) + maxDepth;

  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);
  camera.near = Math.max(0.02, dist - maxDepth * 4 - 2);
  camera.far = Math.max(100, dist + maxDepth * 4 + 20);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const mat of mats) mat.dispose();
  });
}

(async () => {
  const cfg = await config();
  let rawSpec;
  try {
    rawSpec = JSON.parse(cfg.lab?.preview_spec ?? "");
  } catch {
    await log("ERROR asset-preview: missing or invalid LAB_PREVIEW_SPEC");
    return;
  }
  if (
    !rawSpec ||
    typeof rawSpec !== "object" ||
    !Array.isArray(rawSpec.items) ||
    !rawSpec.items.length
  ) {
    await log("ERROR asset-preview: no items to preview");
    return;
  }
  let outName;
  let itemSize;
  let validatedItems;
  try {
    outName = validatePreviewOut(rawSpec.out);
    itemSize = validatePreviewSize(rawSpec.size);
    if (rawSpec.items.length > MAX_PREVIEW_ITEMS) {
      throw new Error(
        `too many preview items (${rawSpec.items.length}); max is ${MAX_PREVIEW_ITEMS}`,
      );
    }
    validatedItems = rawSpec.items.map((entry) => {
      if (typeof entry === "string") return normalizePreviewEntry(entry);
      if (!entry || typeof entry !== "object") {
        throw new Error("each preview item must be an object or block:/item: ID");
      }
      const rawId =
        typeof entry.label === "string"
          ? entry.label
          : typeof entry.kind === "string" && typeof entry.id === "string"
            ? `${entry.kind}:${entry.id}`
            : "";
      return normalizePreviewEntry(rawId);
    });
  } catch (err) {
    await log(`ERROR asset-preview: ${err instanceof Error ? err.message : err}`);
    return;
  }
  const stagingErrors = new Map<string, string>();
  if (
    rawSpec.stagingErrors &&
    typeof rawSpec.stagingErrors === "object" &&
    !Array.isArray(rawSpec.stagingErrors)
  ) {
    for (const [k, v] of Object.entries(rawSpec.stagingErrors as Record<string, unknown>)) {
      if (typeof v === "string") stagingErrors.set(k, v);
    }
  }
  const spec = {
    items: validatedItems,
    out: outName,
    size: itemSize,
    showScale: rawSpec.showScale !== false,
    hasOverlay: rawSpec.hasOverlay === true,
    skipPicked: rawSpec.skipPicked === true,
    stagingErrors,
  };

  configure({ THREE, assetsUrl: "vendor/bmr_assets.zip" });
  const jarResp = await fetch("mc/client_assets.zip");
  if (!jarResp.ok) {
    await log(
      "ERROR mc/client_assets.zip is missing: run bun run link <film> at the repo root first",
    );
    return;
  }
  const jarBytes = new Uint8Array(await jarResp.arrayBuffer());
  const packList: unknown[] = [sharedProps];
  if (spec.hasOverlay) {
    const overlayResp = await fetch("_preview_overlay.zip");
    if (!overlayResp.ok) {
      await log("ERROR asset-preview failed to fetch staged vault pack overlay");
      return;
    }
    const overlayBytes = new Uint8Array(await overlayResp.arrayBuffer());
    if (overlayBytes.byteLength > 0) packList.push(overlayBytes);
  }
  let hasPickedZip = false;
  if (!spec.skipPicked) {
    try {
      const pickedResp = await fetch("picked.zip");
      if (pickedResp.ok) {
        const pickedBytes = new Uint8Array(await pickedResp.arrayBuffer());
        if (pickedBytes.byteLength > 0) {
          packList.push(pickedBytes);
          hasPickedZip = true;
        }
      }
    } catch {
      // picked.zip is optional when previewing vanilla/shared blocks
    }
  }
  packList.push(jarBytes);
  let sources;
  try {
    sources = await prepareAssets(packList, { cache: true });
  } catch (err) {
    const hint = hasPickedZip
      ? " (check assets/public/picked.zip and rebuild with bun ../../packages/mc-assets/pick.mjs)"
      : "";
    await log(
      `ERROR asset-preview failed to load asset packs${hint}: ${err instanceof Error ? err.message : err}`,
    );
    return;
  }

  const gl = glCanvas();
  gl.width = VIEW_W;
  gl.height = VIEW_H;
  const renderer = new THREE.WebGLRenderer({
    canvas: gl,
    alpha: false,
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setSize(VIEW_W, VIEW_H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d222b);

  const camera = new THREE.PerspectiveCamera(FOV_DEG, VIEW_W / VIEW_H, 0.02, 100);

  // Neutral balanced 3-point studio lighting so both light and dark models read crisply
  const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x3b414c, 1.15);
  const key = new THREE.DirectionalLight(0xfff4e4, 1.85);
  key.position.set(4.5, 7.5, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 25;
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0005;
  const fill = new THREE.DirectionalLight(0xc4dafc, 0.75);
  fill.position.set(-5, 3.5, 2.5);
  const rim = new THREE.DirectionalLight(0xdce7ff, 0.55);
  rim.position.set(-2, 4, -5);
  scene.add(hemi, key, fill, rim);

  // Ground plane + 1 m scale grid
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.MeshStandardMaterial({ color: 0x252b35, roughness: 0.94, metalness: 0.0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.001;
  ground.receiveShadow = true;
  const grid = new THREE.GridHelper(16, 16, 0x4b5669, 0x323a48);
  grid.position.y = 0.001;
  scene.add(ground, grid);

  let scaleFigure: THREE.Object3D | null = null;
  let scaleMode: "steve-rig" | "proxy" | "none" = "none";
  let scaleHalfW = 0.25;
  if (spec.showScale) {
    const loaded = await loadScaleFigure(jarBytes);
    scaleFigure = loaded.obj;
    scaleMode = loaded.mode;
    scaleFigure.updateMatrixWorld(true);
    const sBox = computeVisibleBounds(scaleFigure);
    if (!sBox.isEmpty()) {
      scaleHalfW = Math.max(0.2, (sBox.max.x - sBox.min.x) / 2);
    }
    scene.add(scaleFigure);
  }

  const cols = spec.items.length === 1 ? 1 : 2;
  const rows = Math.ceil(spec.items.length / cols);
  const sheet = document.createElement("canvas");
  sheet.width = PAD * 2 + cols * TILE_W + (cols - 1) * GAP;
  sheet.height = TITLE_H + PAD * 2 + rows * TILE_H + (rows - 1) * GAP;
  const ctx = sheet.getContext("2d");

  ctx.fillStyle = "#11151c";
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  // Top sheet title bar
  ctx.fillStyle = "#171c26";
  ctx.fillRect(0, 0, sheet.width, TITLE_H);
  ctx.fillStyle = "#e6edf7";
  ctx.font = '600 14px "Segoe UI", Consolas, sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const scaleTag = spec.showScale ? `Steve 1.875m (${scaleMode})` : "solo framing";
  ctx.fillText(
    `Asset Preview — ${spec.items.length} asset${spec.items.length === 1 ? "" : "s"}  |  Front + 3/4  |  ${scaleTag}`,
    PAD,
    TITLE_H / 2,
  );

  const results = [];
  for (let i = 0; i < spec.items.length; i++) {
    const item = spec.items[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const tileX = PAD + col * (TILE_W + GAP);
    const tileY = TITLE_H + PAD + row * (TILE_H + GAP);

    let model: THREE.Group | null = null;
    let error: string | null = null;
    let missing = false;
    let boundsMeta: {
      size: [number, number, number];
      min: [number, number, number];
      max: [number, number, number];
    } | null = null;

    if (spec.stagingErrors.has(item.label)) {
      missing = true;
      error = spec.stagingErrors.get(item.label) || "failed to stage vault asset";
    } else {
      try {
        missing = await checkAssetMissing(sources, item.kind, item.id);
        if (!missing) {
          model =
            item.kind === "block"
              ? await blockModel(sources, item.id, {}, { shadows: true, animate: false })
              : await itemModel(sources, item.id, spec.size, { shadows: true, animate: false });
          model.updateMatrixWorld(true);
          const rawBox = computeVisibleBounds(model);
          if (rawBox.isEmpty()) {
            missing = true;
          } else {
            const sizeVec = rawBox.getSize(new THREE.Vector3());
            boundsMeta = {
              size: [round4(sizeVec.x), round4(sizeVec.y), round4(sizeVec.z)],
              min: [round4(rawBox.min.x), round4(rawBox.min.y), round4(rawBox.min.z)],
              max: [round4(rawBox.max.x), round4(rawBox.max.y), round4(rawBox.max.z)],
            };
            const cx = (rawBox.min.x + rawBox.max.x) / 2;
            const cz = (rawBox.min.z + rawBox.max.z) / 2;
            model.position.set(-cx, -rawBox.min.y, -cz);
          }
          scene.add(model);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }

    const assetHalfW = boundsMeta ? boundsMeta.size[0] / 2 : 0.5;
    if (scaleFigure) {
      scaleFigure.visible = true;
      scaleFigure.position.set(-(assetHalfW + scaleHalfW + 0.35), 0, 0);
      scaleFigure.updateMatrixWorld(true);
    }

    const frameBox = new THREE.Box3();
    if (model) {
      model.updateMatrixWorld(true);
      const placedBox = computeVisibleBounds(model);
      if (!placedBox.isEmpty()) frameBox.union(placedBox);
    }
    if (scaleFigure) {
      const sBox = computeVisibleBounds(scaleFigure);
      if (!sBox.isEmpty()) frameBox.union(sBox);
    }
    if (frameBox.isEmpty()) {
      frameBox.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    }

    // Tile background & border
    ctx.fillStyle = "#1b2029";
    ctx.fillRect(tileX, tileY, TILE_W, TILE_H);
    ctx.strokeStyle = "#2e3748";
    ctx.lineWidth = 1;
    ctx.strokeRect(tileX + 0.5, tileY + 0.5, TILE_W - 1, TILE_H - 1);

    // Render Front (azimuth 0 deg, slight +8 deg elevation)
    fitCameraToBox(camera, frameBox, 0, THREE.MathUtils.degToRad(8));
    renderer.render(scene, camera);
    ctx.drawImage(gl, tileX, tileY + HEADER_H, VIEW_W, VIEW_H);

    // Render 3/4 (azimuth 36 deg, elevation 24 deg)
    fitCameraToBox(camera, frameBox, THREE.MathUtils.degToRad(36), THREE.MathUtils.degToRad(24));
    renderer.render(scene, camera);
    ctx.drawImage(gl, tileX + VIEW_W, tileY + HEADER_H, VIEW_W, VIEW_H);

    // Center divider between Front and 3/4
    ctx.fillStyle = "#2e3748";
    ctx.fillRect(tileX + VIEW_W, tileY + HEADER_H, 1, VIEW_H);

    // Header bar
    ctx.fillStyle = "#141821";
    ctx.fillRect(tileX, tileY, TILE_W, HEADER_H);
    ctx.font = "600 13px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = error || missing ? "#f97360" : "#e8eef8";
    ctx.fillText(item.label, tileX + 10, tileY + HEADER_H / 2, TILE_W - 175);

    ctx.textAlign = "right";
    ctx.font = "12px Consolas, monospace";
    if (error) {
      ctx.fillStyle = "#f97360";
      ctx.fillText("ERROR", tileX + TILE_W - 10, tileY + HEADER_H / 2);
    } else if (missing) {
      ctx.fillStyle = "#f97360";
      ctx.fillText("MISSING MODEL", tileX + TILE_W - 10, tileY + HEADER_H / 2);
    } else if (boundsMeta) {
      ctx.fillStyle = "#9fb3cc";
      const [bw, bh, bd] = boundsMeta.size;
      ctx.fillText(
        `${bw.toFixed(2)}×${bh.toFixed(2)}×${bd.toFixed(2)} m`,
        tileX + TILE_W - 10,
        tileY + HEADER_H / 2,
      );
    }

    // View angle badges
    const drawBadge = (bx: number, by: number, text: string) => {
      ctx.font = '600 11px "Segoe UI", sans-serif';
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = "rgba(15, 19, 27, 0.78)";
      ctx.fillRect(bx, by, w, 20);
      ctx.fillStyle = "#cbd5e1";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx + 6, by + 10);
    };
    drawBadge(tileX + 8, tileY + HEADER_H + 8, "FRONT");
    drawBadge(tileX + VIEW_W + 8, tileY + HEADER_H + 8, "3/4");

    if (model) {
      scene.remove(model);
      disposeObject(model);
    }

    results.push({
      id: item.label,
      kind: item.kind,
      bounds: missing || error ? null : boundsMeta,
      missing,
      ...(error ? { error } : {}),
    });
  }

  await still(spec.out, sheet, 0.92);
  const okCount = results.filter((r) => !r.error && !r.missing).length;
  const payload = {
    ok: okCount > 0,
    output: `renders/${spec.out}`,
    width: sheet.width,
    height: sheet.height,
    count: results.length,
    resolved: okCount,
    scaleRef: scaleMode,
    items: results,
  };
  await log(`${PREVIEW_JSON_PREFIX}${JSON.stringify(payload)}`);
  await done();
})();
