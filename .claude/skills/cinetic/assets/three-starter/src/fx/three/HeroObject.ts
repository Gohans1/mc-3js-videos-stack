// hero-object: the object a film's idea is about, built from primitives in physical materials and lit by the film's
// light: a phone (metal frame, a rendered plate under glass), a payment card (lacquered, a metal chip, the
// mark), a coin (struck metal, the mark embossed on its face), a parcel (a cardboard box with its tape) or a leaf
// (translucent, veined). One designed move brings it in and lands it still, facing the camera: 'turn' (it travels in
// from the side turned away and turns to face), 'rise' (up from below the frame), 'drop' (falls and lands with one
// small bounce on its own shadow) or 'flip' (a coin or card spinning one and a half turns into place). After the move
// it holds still: no idle spin, no bob. A soft shadow from the film's key grounds it ('shadow' ground).
// cinetic:device-palette materials: the natural colours of cardboard, a leaf and struck metal are the objects', not the brand's
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { Logo } from "../../brand/Mark";
import { C } from "../../brand/tokens";
import { E, rand } from "../../lib/anim";
import { useFilm } from "../../lib/film";
import { canvasTex, disposeAll, fitUv, markSolid, roundedRect, slabGeometry } from "./geo";
import type { GlMode } from "./gl";
import type { Light3D } from "./light";
import {
  type Backdrop,
  clamp01,
  deg,
  filmLit,
  planeDistance,
  Stage3D,
} from "./stage";

export type HeroKind = "phone" | "card" | "coin" | "parcel" | "leaf";
export type HeroMove = "turn" | "rise" | "drop" | "flip" | "hold";

/** House numbers (f@60, px@1080, degrees): each move's length and its start pose; the default sizes per kind (px). */
export const HERO = {
  dur: { turn: 60, rise: 54, drop: 48, flip: 72, hold: 1 },
  turn: { yaw: 72, pitch: 12, x: 0.17, z: -420 },
  rise: { pitch: -24, yaw: 22, y: 0.66 },
  drop: { y: 0.72, bounce: 0.035 },
  flip: { turns: 1.5, lift: 60 },
  size: { phone: 760, card: 720, coin: 440, parcel: 520, leaf: 600 },
  sweep: 40,
};

export const RECIPE = {
  id: "hero-object",
  recipe:
    "The idea as one lit object (phone, card, coin, parcel, leaf) in physical materials and the film's light; turn: it travels in from 17 % to the side and 420 px back, turned 72 deg away, and turns to face the camera (60 f, glideOut travel, settleOut turn); rise: up from below the frame (54 f); drop: falls and lands with one 3.5 % bounce on its shadow (48 f); flip: a coin or card spins 1.5 turns into place (72 f). It lands still, facing; no idle spin.",
  params: { ...HERO },
};

export type HeroObjectProps = {
  kind: HeroKind;
  frame?: number;
  at?: number;
  dur?: number; // f@60 (default per move)
  move?: HeroMove;
  /** Centre of the object (px from the frame's top-left; default the frame's centre). */
  x?: number;
  y?: number;
  /** Size in px at the frame's plane (phone: height, card and parcel: width, coin: diameter, leaf: length). */
  size?: number;
  /** The object's main colour (phone frame, card, coin metal, box, leaf); defaults per kind. */
  color?: string;
  /** Rendered plate image on the phone's screen. */
  screen?: string;
  screenTexture?: THREE.Texture | null;
  /** The brand's mark on the card, the coin's face or the parcel's label (logoParts of its SVG). */
  mark?: Logo;
  ground?: "shadow" | "none";
  light?: Light3D;
  backdrop?: Backdrop;
  samples?: number;
  gl?: GlMode;
  seed?: number | string;
};

type Built = { group: THREE.Group; dispose: () => void };

const phys = (color: string, p: THREE.MeshPhysicalMaterialParameters) =>
  filmLit(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), ...p }), color);

const phone = (h: number, color: string, screen: THREE.Texture | null): Built => {
  const group = new THREE.Group();
  const w = h * 0.486;
  const d = h * 0.05;
  const r = w * 0.17;
  const frame = phys(color, {
    metalness: 1,
    roughness: 0.3,
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
  });
  group.add(new THREE.Mesh(slabGeometry(w, h, d, r, 0.24), frame));
  const bez = w * 0.035;
  const glassShape = fitUv(
    new THREE.ShapeGeometry(roundedRect(w - 2 * bez, h - 2 * bez, r - bez), 24),
  );
  const scr = filmLit(
    new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: screen ?? undefined,
      emissiveIntensity: screen ? 1 : 0,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    }),
    "#000000",
  );
  const face = new THREE.Mesh(glassShape, scr);
  face.position.z = d / 2 + 0.3;
  group.add(face);
  const island = new THREE.Mesh(
    slabGeometry(w * 0.3, w * 0.085, 0.6, w * 0.0425, 0.3),
    phys("#050506", { roughness: 0.15, clearcoat: 1 }),
  );
  island.position.set(0, h / 2 - bez - w * 0.075, d / 2 + 0.4);
  group.add(island);
  // the back: a camera plate with three lenses, seen while it turns
  const plate = new THREE.Mesh(slabGeometry(w * 0.42, w * 0.42, d * 0.22, w * 0.11, 0.4), frame);
  plate.position.set(-w * 0.22, h / 2 - w * 0.3, -d / 2 - d * 0.08);
  group.add(plate);
  const lensMat = phys("#0B0C0E", { roughness: 0.05, clearcoat: 1, metalness: 0.2 });
  [
    [-0.07, 0.07],
    [-0.07, -0.08],
    [0.08, 0],
  ].forEach(([lx, ly]) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.07, w * 0.075, d * 0.3, 40), lensMat);
    l.rotation.x = Math.PI / 2;
    l.position.set(-w * 0.22 + lx * w * 1.2, h / 2 - w * 0.3 + ly * w * 1.2, -d / 2 - d * 0.2);
    group.add(l);
  });
  // side buttons
  [
    [-1, 0.18, 0.1],
    [-1, 0.05, 0.1],
    [1, 0.12, 0.16],
  ].forEach(([side, y, len]) => {
    const b = new THREE.Mesh(slabGeometry(d * 0.5, h * len, d * 0.25, d * 0.12, 0.4), frame);
    b.rotation.y = Math.PI / 2;
    b.position.set(side * (w / 2 + d * 0.06), h * y, 0);
    group.add(b);
  });
  return { group, dispose: disposeAll(group) };
};

const card = (w: number, color: string, mark: Logo | undefined): Built => {
  const group = new THREE.Group();
  const h = w * 0.63;
  const d = w * 0.014;
  const base = new THREE.Color(color);
  const grad = canvasTex(512, 324, (g) => {
    const lg = g.createLinearGradient(0, 0, 512, 324);
    lg.addColorStop(0, `#${base.clone().offsetHSL(0, 0, 0.06).getHexString()}`);
    lg.addColorStop(1, `#${base.clone().offsetHSL(0, 0, -0.08).getHexString()}`);
    g.fillStyle = lg;
    g.fillRect(0, 0, 512, 324);
  });
  const body = new THREE.Mesh(
    slabGeometry(w, h, d, w * 0.045, 0.35),
    filmLit(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: grad,
        roughness: 0.34,
        metalness: 0.2,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
      }),
      color,
    ),
  );
  // planar UVs for the face gradient
  fitUv(body.geometry);
  group.add(body);
  const chipTex = canvasTex(256, 200, (g) => {
    g.fillStyle = "#C9C6BD";
    g.fillRect(0, 0, 256, 200);
    g.strokeStyle = "#8E8B83";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, 100);
    g.lineTo(90, 100);
    g.moveTo(166, 100);
    g.lineTo(256, 100);
    g.moveTo(90, 0);
    g.lineTo(90, 200);
    g.moveTo(166, 0);
    g.lineTo(166, 200);
    g.stroke();
  });
  const chip = new THREE.Mesh(
    fitUv(new THREE.ShapeGeometry(roundedRect(w * 0.14, w * 0.11, w * 0.018), 8)),
    filmLit(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: chipTex,
        metalness: 1,
        roughness: 0.32,
      }),
      "#C9C6BD",
    ),
  );
  chip.position.set(-w * 0.3, h * 0.05, d / 2 + 0.3);
  group.add(chip);
  if (mark) {
    const m = markSolid(mark, 6, 0.8, "satin", "#FFFFFF");
    const ks = (w * 0.16) / 100;
    m.root.scale.setScalar(ks);
    m.root.position.set(w * 0.34, -h * 0.3, d / 2 + m.thickness * ks);
    group.add(m.root);
  }
  return { group, dispose: disposeAll(group) };
};

const coin = (dia: number, color: string, mark: Logo | undefined): Built => {
  const group = new THREE.Group();
  const r = dia / 2;
  const t = dia * 0.1;
  const rec = t * 0.16;
  const pts = [
    [0, t / 2 - rec],
    [r * 0.8, t / 2 - rec],
    [r * 0.83, t / 2],
    [r * 0.95, t / 2],
    [r * 0.99, t * 0.42],
    [r, t * 0.3],
    [r, -t * 0.3],
    [r * 0.99, -t * 0.42],
    [r * 0.95, -t / 2],
    [r * 0.83, -t / 2],
    [r * 0.8, -t / 2 + rec],
    [0, -t / 2 + rec],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const metal = phys(color, { metalness: 1, roughness: 0.22, clearcoat: 0.15 });
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 128), metal);
  body.rotation.x = Math.PI / 2; // the lathe's axis (y) toward the camera
  group.add(body);
  if (mark) {
    const m = markSolid(mark, 5, 1.4, "metal", color);
    const ks = (r * 1.05) / 100;
    m.root.scale.setScalar(ks);
    m.root.position.z = t / 2 - rec + m.thickness * ks;
    group.add(m.root);
  }
  return { group, dispose: disposeAll(group) };
};

const parcel = (w: number, color: string, mark: Logo | undefined, seed: string): Built => {
  const group = new THREE.Group();
  const h = w * 0.64;
  const d = w * 0.76;
  const fibre = canvasTex(512, 512, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      const a = rand(`${seed}:f${i}`);
      g.fillStyle = a < 0.5 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.04)";
      g.fillRect(rand(`${seed}:x${i}`) * 512, rand(`${seed}:y${i}`) * 512, 1 + a * 22, 1);
    }
  });
  const box = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, d, 3, w * 0.012),
    filmLit(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: fibre,
        roughness: 0.86,
        sheen: 0.25,
        sheenRoughness: 0.8,
        sheenColor: new THREE.Color(1, 1, 1),
      }),
      color,
    ),
  );
  box.castShadow = true;
  group.add(box);
  const tapeMat = filmLit(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color).offsetHSL(0, -0.05, 0.08),
      roughness: 0.3,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
      transparent: true,
      opacity: 0.92,
    }),
    color,
  );
  const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, 0.8, d + 1.2), tapeMat);
  top.position.y = h / 2 + 0.45;
  group.add(top);
  const front = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, h * 0.32, 0.8), tapeMat);
  front.position.set(0, h / 2 - h * 0.16, d / 2 + 0.5);
  group.add(front);
  if (mark) {
    const label = new THREE.Mesh(
      new THREE.ShapeGeometry(roundedRect(w * 0.3, h * 0.28, w * 0.02), 6),
      phys("#F4F5F6", { roughness: 0.7 }),
    );
    label.position.set(w * 0.27, -h * 0.18, d / 2 + 0.4);
    group.add(label);
    const m = markSolid(mark, 1.5, 0.3, "satin");
    const ks = (h * 0.18) / 100;
    m.root.scale.setScalar(ks);
    m.root.position.set(w * 0.27, -h * 0.18, d / 2 + 0.6 + m.thickness * ks);
    group.add(m.root);
  }
  return { group, dispose: disposeAll(group) };
};

const leaf = (len: number, color: string): Built => {
  const group = new THREE.Group();
  const width = len * 0.46;
  const g = new THREE.PlaneGeometry(1, 1, 24, 48);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) * 2; // -1..1 across
    const v = pos.getY(i) + 0.5; // 0 base .. 1 tip
    const half = (width / 2) * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.85)), 0.9);
    const y = (v - 0.5) * len;
    const z = len * (0.07 * u * u * (half / (width / 2)) - 0.1 * (v - 0.45) * (v - 0.45));
    pos.setXYZ(i, u * half, y, z);
  }
  g.computeVertexNormals();
  const base = new THREE.Color(color);
  const veins = canvasTex(256, 512, (c) => {
    c.fillStyle = color;
    c.fillRect(0, 0, 256, 512);
    c.strokeStyle = `#${base.clone().offsetHSL(0, -0.1, 0.12).getHexString()}`;
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(128, 512);
    c.lineTo(128, 0);
    c.stroke();
    c.lineWidth = 2.4;
    for (let k = 0; k < 9; k++) {
      const y0 = 470 - k * 50;
      c.beginPath();
      c.moveTo(128, y0);
      c.quadraticCurveTo(170, y0 - 30, 250, y0 - 70);
      c.moveTo(128, y0);
      c.quadraticCurveTo(86, y0 - 30, 6, y0 - 70);
      c.stroke();
    }
  });
  const mat = filmLit(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: veins,
      roughness: 0.45,
      sheen: 0.6,
      sheenRoughness: 0.5,
      sheenColor: base.clone().offsetHSL(0, 0, 0.25),
      side: THREE.DoubleSide,
      clearcoat: 0.3,
      clearcoatRoughness: 0.4,
    }),
    color,
  );
  const blade = new THREE.Mesh(g, mat);
  blade.castShadow = true;
  group.add(blade);
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -len / 2, -len * 0.004),
    new THREE.Vector3(len * 0.02, -len * 0.6, -len * 0.02),
    new THREE.Vector3(len * 0.05, -len * 0.68, -len * 0.05),
  ]);
  const stem = new THREE.Mesh(
    new THREE.TubeGeometry(stemCurve, 16, len * 0.012, 10),
    phys(`#${base.clone().offsetHSL(0, -0.1, 0.08).getHexString()}`, { roughness: 0.5 }),
  );
  group.add(stem);
  group.position.y = len * 0.08;
  return { group, dispose: disposeAll(group) };
};

const KIND_COLOR: Record<HeroKind, string> = {
  phone: "#3A3D42",
  card: C.accent,
  coin: "#D3D6DB",
  parcel: "#C29B6E",
  leaf: "#3F8A4C",
};

/** Build a hero object (px units, centred, facing +z): for GlassDome and your own scenes. */
export const heroSolid = (
  kind: HeroKind,
  size: number,
  opts: { color?: string; screen?: THREE.Texture | null; mark?: Logo; seed?: string } = {},
): Built => {
  const color = opts.color ?? KIND_COLOR[kind];
  const b =
    kind === "phone"
      ? phone(size, color, opts.screen ?? null)
      : kind === "card"
        ? card(size, color, opts.mark)
        : kind === "coin"
          ? coin(size, color, opts.mark)
          : kind === "parcel"
            ? parcel(size, color, opts.mark, opts.seed ?? "parcel")
            : leaf(size, color);
  b.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return b;
};

/** The move at local frame t (frames since `at`), as an offset from the rest pose. */
export const heroPose = (
  move: HeroMove,
  t: number,
  durF: number,
  W: number,
  H: number,
  mirror: number,
) => {
  const p = clamp01(t / durF);
  if (move === "turn") {
    const e = E.glideOut(p);
    const r = E.settleOut(p);
    return {
      x: mirror * W * HERO.turn.x * (1 - e),
      y: 0,
      z: HERO.turn.z * (1 - e),
      yaw: -mirror * HERO.turn.yaw * (1 - r),
      pitch: HERO.turn.pitch * (1 - r),
      roll: 0,
      moving: p > 0 && p < 1,
    };
  }
  if (move === "rise") {
    const e = E.glideOut(p);
    const r = E.settleOut(p);
    return {
      x: 0,
      y: -H * HERO.rise.y * (1 - e),
      z: -120 * (1 - e),
      yaw: mirror * HERO.rise.yaw * (1 - r),
      pitch: HERO.rise.pitch * (1 - r),
      roll: 0,
      moving: p > 0 && p < 1,
    };
  }
  if (move === "drop") {
    // fall with gravity to the contact at 72 %, one small damped bounce, rest
    const c = 0.72;
    let y: number;
    if (p < c) y = H * HERO.drop.y * (1 - (p / c) * (p / c));
    else {
      const q = (p - c) / (1 - c);
      y = H * HERO.drop.y * HERO.drop.bounce * Math.sin(Math.PI * Math.min(1, q * 1.6)) * (1 - q);
    }
    const r = E.settleOut(p);
    return {
      x: 0,
      y,
      z: 0,
      yaw: mirror * 18 * (1 - r),
      pitch: -10 * (1 - r),
      roll: mirror * 6 * (1 - r),
      moving: p > 0 && p < 1,
    };
  }
  if (move === "flip") {
    const e = E.settleOut(p);
    return {
      x: 0,
      y: HERO.flip.lift * Math.sin(Math.PI * Math.min(1, p * 1.15)),
      z: -160 * (1 - E.glideOut(p)),
      yaw: -mirror * 360 * HERO.flip.turns * (1 - e),
      pitch: 8 * (1 - e),
      roll: 0,
      moving: p > 0 && p < 1,
    };
  }
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, moving: false };
};

/** The film's idea as one lit 3D object on vanilla three.js (see the file's header). */
export const HeroObject = ({
  kind,
  frame = 0,
  at = 0,
  dur,
  move = "turn",
  x,
  y,
  size,
  color,
  screenTexture = null,
  mark,
  ground = "shadow",
  light,
  backdrop,
  samples,
  seed = 0,
}: HeroObjectProps) => {
  const { fps, width: W, height: H } = useFilm();
  const durF = ((dur ?? HERO.dur[move]) * fps) / 60;
  const sz = size ?? HERO.size[kind];
  const mirror = rand(`hero-object:${seed}`) < 0.5 ? -1 : 1;
  const cx = x ?? W / 2;
  const cy = y ?? H / 2;
  const built = heroSolid(kind, sz, {
    color,
    screen: kind === "phone" ? screenTexture : null,
    mark,
    seed: String(seed),
  });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 4, W * 4),
    new THREE.ShadowMaterial({ opacity: 0.22, color: new THREE.Color(0, 0, 0) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const D = planeDistance(H);
  const box = new THREE.Box3().setFromObject(built.group);
  const rest = { x: cx - W / 2, y: H / 2 - cy };
  floor.position.set(rest.x, rest.y + box.min.y - 0.5, 0);
  floor.visible = ground === "shadow";

  const apply = (t: number) => {
    const st = heroPose(move, t - at, durF, W, H, mirror);
    built.group.position.set(rest.x + st.x, rest.y + st.y, st.z);
    built.group.rotation.set(deg(st.pitch), deg(st.yaw), deg(st.roll), "YXZ");
    const focus = D - st.z;
    const p = clamp01((t - at) / durF);
    return {
      aperture: 0,
      focus,
      still: !st.moving,
      moving: st.moving,
      sweep: HERO.sweep * mirror * (1 - E.settleOut(p)),
    };
  };

  const stage = Stage3D({
    frame,
    width: W,
    height: H,
    light,
    backdrop,
    samples,
    shadows: ground === "shadow",
    shadowBox: Math.max(400, sz),
    children: [built.group, floor],
    setup: ({ addSampler }) => addSampler(apply),
  });
  apply(frame);
  return {
    ...stage,
    built,
    floor,
    pose: apply,
    dispose: () => {
      built.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      stage.dispose();
    },
  };
};
