// glass-tiles: the products a film works with as frosted glass tiles floating in depth, each official icon crisp on
// the face of a thick, round-edged glass square whose edges refract the plate behind and catch the light stage as rim
// light (a thin-film sheen and a little dispersion on the bevels). One designed move: 'arrive' (the tiles rise into
// frame from below and behind, turning to face the camera, outward from the centre, while the camera pushes in once
// and lands), or 'pass' (the tiles hold in depth and the camera tracks past them, landing on the chosen tile as the
// focus pulls to it). Tiles face the camera at rest; nothing bobs.
// Pass the film's plate as `backdrop` (the same picture the film shows behind) so the glass refracts it; without one
// the canvas is transparent and the glass reads as clear, lit edges over whatever is behind.
// cinetic:device-palette glass: the clear white of glass and its frost are light, not brand colours
import * as THREE from "three";

import { E, rand } from "../../lib/anim";
import { useFilm } from "../../lib/film";
import { slabGeometry } from "./geo";
import type { GlMode } from "./gl";
import type { Light3D } from "./light";
import {
  type Backdrop,
  clamp01,
  deg,
  filmLit,
  lerp,
  planeDistance,
  Stage3D,
} from "./stage";

/**
 * House numbers (f@60, px@1080): tile size; depth, corner radius and icon size as shares of the size; frost (0 clear
 * .. 1 milky); the arrival (stagger between tiles, each tile's flight, how far below and behind it starts, its turn);
 * the camera (push from x1.3 of the plane distance, the shot's length) and the lens (aperture as a share of focus);
 * the row's width (share of the frame) and how far its outer tiles come toward the camera (px).
 */
export const TILES = {
  size: 330,
  depth: 0.42,
  radius: 0.27,
  icon: 0.6,
  frost: 0.5,
  stagger: 6,
  arrive: 48,
  back: 560,
  turn: 34,
  push: 1.3,
  dur: 150,
  aperture: 0.018,
  spread: 0.78,
  arc: 360,
};

export const RECIPE = {
  id: "glass-tiles",
  recipe:
    "Official icons crisp in thick milky glass tiles (330 px, fully rounded edges, depth 42 %, rainbow fringes and bright rims on the bevels), on an arc opening toward the camera: the middle tiles sharp at the lockup plane, the outer ones nearer, bigger and soft, framing them; arrive: they rise from below and behind, turning 34 deg to face the camera, outward from the centre 6 f apart (48 f each, glideOut) while the camera pushes in from x1.3 and lands after them (150 f, stdInOut); pass: the camera tracks past them and lands on the chosen tile as the focus pulls to it. Faces the camera at rest; no bob.",
  params: { ...TILES },
};

export type TileMove = "arrive" | "pass" | "hold";
export type TileLayout = "row" | "flank";
export type TilePlace = { x: number; y: number; z: number }; // px from the frame's centre (y up), depth toward the camera

export type GlassTilesProps = {
  /** Official icon files (asset paths to SVG or PNG), one tile each. */
  icons: string[];
  iconTextures?: (THREE.Texture | null)[];
  frame?: number;
  at?: number;
  /** Length of the shot's move, f@60 (default 150). */
  dur?: number;
  move?: TileMove;
  /** 'row' (an arc opening toward the camera: the middle tiles sharp, the outer ones nearer and soft) or 'flank' (tiles both sides of an empty centre for a line or a product). */
  layout?: TileLayout;
  /** Or place each tile yourself (px from the centre, y up, z toward the camera). */
  places?: TilePlace[];
  /** Tile size in px at the frame's plane (default 330). */
  size?: number;
  /** 0 clear .. 1 milky (default 0.5). */
  frost?: number;
  /** The tile the shot lands on and focuses (default the middle one). */
  focus?: number;
  light?: Light3D;
  backdrop?: Backdrop;
  samples?: number;
  gl?: GlMode;
  seed?: number | string;
};

/** The tile's glass. */
export const tileGlass = (size: number, frost: number) =>
  filmLit(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(1, 1, 1),
      // frost: a rougher surface blurs what is behind it, and the milky share (diffuse white lit by the key and the light
      // stage) keeps the tile bright on any plate; the clearcoat stays sharp, so the rims and highlights stay crisp
      roughness: 0.06 + 0.36 * frost,
      transmission: 1 - 0.5 * frost,
      envMapIntensity: 2,
      thickness: size * TILES.depth,
      ior: 1.45,
      iridescence: 1,
      iridescenceIOR: 1.3,
      iridescenceThicknessMinimum: 220,
      iridescenceThicknessMaximum: 620,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      specularIntensity: 1,
      dispersion: 0.45,
    }),
    "#FFFFFF",
  );

export type Tile = { group: THREE.Group; dispose: () => void };

/** One glass tile with its icon on the face (size px). */
export const makeTile = (
  size: number,
  tex: THREE.Texture | null,
  frost: number = TILES.frost,
): Tile => {
  const group = new THREE.Group();
  const d = size * TILES.depth;
  // edges rounded all the way through (a soap-bar block): the bevels catch the light stage as bright rims
  const geo = slabGeometry(size, size, d, size * TILES.radius, 0.5);
  const glass = tileGlass(size, frost);
  const body = new THREE.Mesh(geo, glass);
  group.add(body);
  let icon: THREE.Mesh | null = null;
  if (tex) {
    const s = size * TILES.icon;
    icon = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    icon.position.z = d / 2 + 0.6;
    icon.renderOrder = 2;
    group.add(icon);
  }
  // (no glass drawn over the icon: its reflection would lift the icon's blacks; official colours stay exact)
  return {
    group,
    dispose: () => {
      geo.dispose();
      glass.dispose();
      if (icon) {
        icon.geometry.dispose();
        (icon.material as THREE.Material).dispose();
      }
    },
  };
};

/** Where n tiles sit (px from the centre, y up, z toward the camera). */
export const tilePlaces = (
  n: number,
  W: number,
  H: number,
  layout: TileLayout = "row",
  spread = TILES.spread,
  seed: number | string = 0,
): TilePlace[] => {
  const jit = (i: number) => rand(`tiles:${seed}:${i}`) - 0.5;
  return Array.from({ length: n }, (_, i) => {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const c = u - 0.5; // -0.5 .. 0.5
    if (layout === "flank") {
      // both sides of an empty centre third, alternating depth, a little height variation
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const m = Math.ceil(n / 2);
      const v = m === 1 ? 0.5 : k / (m - 1);
      return {
        x: side * W * lerp(0.2, spread / 2 + 0.06, v),
        y: H * (0.06 * Math.sin(v * 3.1 + side) + 0.03 * jit(i)),
        z: (k % 2 === 0 ? 120 : -160) + 30 * jit(i + 9),
      };
    }
    // an arc opening toward the camera: the middle tiles at the lockup plane (sharp), the outer ones nearer and wider
    // (bigger, soft in the lens: a foreground that frames the middle)
    const v = 2 * c; // -1 .. 1
    return {
      x: c * W * spread,
      y: H * (0.04 * (i % 2 === 0 ? -1 : 1) + 0.02 * jit(i)),
      z: TILES.arc * v * v + 30 * jit(i + 5),
    };
  });
};

/** Official icons as frosted glass tiles in depth on vanilla three.js (see the file's header). */
export const GlassTiles = ({
  icons,
  iconTextures,
  frame = 0,
  at = 0,
  dur = TILES.dur,
  move = "arrive",
  layout = "row",
  places,
  size = TILES.size,
  frost = TILES.frost,
  focus,
  light,
  backdrop,
  samples,
  seed = 0,
}: GlassTilesProps) => {
  const { fps, width: W, height: H } = useFilm();
  const k = fps / 60;
  const durF = dur * k;
  const pl = places ?? tilePlaces(icons.length, W, H, layout, TILES.spread, seed);
  const f = focus ?? Math.floor((icons.length - 1) / 2);
  const mirror = rand(`glass-tiles:${seed}`) < 0.5 ? -1 : 1;
  const tex = iconTextures ?? icons.map(() => null);
  const tiles = tex.map((t) => makeTile(size, t, frost));
  const root = new THREE.Group();
  tiles.forEach((t) => root.add(t.group));
  const D = planeDistance(H);
  const rank = pl
    .map((_, i) => i)
    .sort((a, b) => Math.abs(a - f) - Math.abs(b - f) || a - b);
  const order = pl.map((_, i) => rank.indexOf(i));
  const fp = pl[Math.min(pl.length - 1, Math.max(0, f))] ?? { x: 0, y: 0, z: 0 };

  const apply = (t: number) => {
    const local = t - at;
    const p = clamp01(local / durF);
    let camX = 0;
    let camZ = D;
    if (move === "arrive") camZ = D * lerp(TILES.push, 1, E.stdInOut(p));
    if (move === "pass") camX = lerp(-mirror * W * 0.42, fp.x, E.strongInOut(p));
    let moving = p > 0 && p < 1;
    tiles.forEach((tile, i) => {
      const place = pl[i];
      let q = 1;
      if (move === "arrive") {
        q = clamp01((local - order[i] * TILES.stagger * k) / (TILES.arrive * k));
        if (q > 0 && q < 1) moving = true;
      }
      const e = E.glideOut(q);
      const r = E.settleOut(q);
      const z0 = place.z - TILES.back;
      const y0 = ((-H / 2 - size) * (D - z0)) / D;
      tile.group.position.set(
        lerp(place.x * 0.85, place.x, e),
        lerp(y0, place.y, e),
        lerp(z0, place.z, e),
      );
      const side = place.x === 0 ? mirror : Math.sign(place.x);
      tile.group.rotation.set(
        deg(-TILES.turn * 0.7 * (1 - r)),
        deg(side * TILES.turn * (1 - r)),
        deg(side * -6 * (1 - r)),
      );
    });
    root.position.set(-camX, 0, D - camZ);
    const focusDist = camZ - fp.z;
    return {
      aperture: TILES.aperture * focusDist,
      focus: focusDist,
      still: !moving && TILES.aperture === 0,
      moving,
    };
  };

  const stage = Stage3D({
    frame,
    width: W,
    height: H,
    light,
    backdrop,
    samples,
    children: root,
    setup: ({ addSampler }) => addSampler(apply),
  });
  apply(frame);
  return {
    ...stage,
    root,
    tiles,
    places: pl,
    pose: apply,
    dispose: () => {
      tiles.forEach((t) => t.dispose());
      stage.dispose();
    },
  };
};
