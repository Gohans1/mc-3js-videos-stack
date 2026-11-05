// @ts-nocheck
// The props that move in section 1.2, all from the film's own block models (pack/assets/gohans) and all placed from film
// time alone (edit.json `props`):
//   chair [{t, dx}]          the chair slides east by dx (he pulls it out at 0:50, scoots in as he sits, skids back at 1:10)
//   drawer [{t, open, ease}]  the filing drawer under the desk, open 0..1 of its 0.62 m run; ease "yank" for the jerk at 1:12
//   screen {on, lines, typing?}  the CRT's picture switches on (text in the game's own font, the cursor blinks).
//                            typing {tries: [{t, text, cps}], enter, wait, reply, keys: {R, L}}: he types each try one
//                            character every 1/cps s from t, hits Enter `enter` s after the last, and `reply` prints `wait`
//                            s later; the hand anchors "keys_R"/"keys_L" tap down on every keystroke at keys.R/keys.L
//   keyboard [{t, yaw, dx, dz, lift, ease?}]  the keyboard knocked askew on the desk (he slams it at 0:57): degrees and
//                            metres from where it stands, applied to the computer variant's loose keyboard (src/scene.ts)
//   files [{hand, folder, grab, face?, release, land: [x, z], yaw, sheets}]  the dig: folder `folder` (0 = the front one)
//                            is taken out of the drawer by that hand at grab, turned to his eyes from face (he reads its
//                            cover; none in the frenzy), thrown at release and lands at land; `sheets` pages slip out mid-air
//   pages [{title, lines}]   what is printed on the loose sheets (and the folders' cover labels): useless beginner stuff
//   spill {at, sheets: [{page, land: [x, z], yaw, pick, hand, stack?}], carry}  the burst: sheets fly out of the drawer
//                            onto the floor; one is taken by `hand` at pick, a right-hand one passes to the left at stack;
//                            carry [[t, mode]] is how the left hand holds the gathered pages from t (modes: see shapeOf)
//   desk {t, at, yaw}        his left hand lays the pages on the desk at t, the last gathered on top
//   takes [{t, hand, face}]  a hand takes the top page off the desk pile at t and holds it up to read from face
//   fling {t, lands: [[x, z], ...]}  he flings every page he holds and sweeps the desk pile off with the same stroke:
//                            the right hand's page, the left's, then the pile from the top, each to the next land
//   silverfish               src/silverfish.ts
//   button {cell: [x, y, z], presses: [t, ...]}  the stone button by the door (the game's own, on the south wall): his
//                            finger goes in at each t; anchor "press_R" is his fingertip on it
//   out {t, dur, to: [x, z], yaw}  he pulls the emptied drawer right out of the cabinet and sets it on the floor
//   scrap {at: [x, z], yaw, grab, read, hold, face}  the one page left, lying alone in the cabinet's empty slot: in his right hand
//                            from grab, held up at hold, square to the point face, from read; note {lines} is what it says
// Anchors (hand and head targets for src/steve.ts) are points on these props at time t: "handle", "chair_grip", "front",
// "folder_N", "spill_N", "desk_page", "scrap", "screen", "keys_R", "keys_L".
import * as THREE from "three";
import { createScene } from "block-model-renderer";
import { unzipSync } from "fflate";
import { buildSilverfish } from "./silverfish";
import { CABINET, CHAIR, DESK, DOME } from "./world";

const S = 1 / 16;

// The chairs to choose between (studio variant "chair"), picked from the vetted packs by pack/pick.py; the first is the
// film's own. seat: the seat's top, back: the backrest's front face (model z, facing north), top: the backrest's top, all
// in the model's 16ths. Each is scaled so its seat stands CHAIR.seat high (the mods build theirs 0.6-0.7 m tall to the
// block grid, which would lift his thighs into the desk) and hung from its backrest's front face, so every look seats him
// the same
export const CHAIRS = [
  { id: "js_furniture_mod:black_chair", title: "black slatted chair (NhatJS Furniture, MIT)", seat: 11, back: 12.5, top: 24 },
  { id: "modernfurniture:office_chair", title: "chrome cantilever office chair (Modern Furniture, CC-BY 4.0: needs a credit)", seat: 10, back: 11.75, top: 20.2 },
  { id: "modernfurniture:wood_chair_b", title: "black steel-frame chair (Modern Furniture, CC-BY 4.0: needs a credit)", seat: 9.75, back: 11.25, top: 20.25 },
  { id: "hospitals:chair", title: "steel-leg plastic chair (Hospitals, MIT)", seat: 10, back: 15, top: 27 },
];
const chairScale = (c) => (CHAIR.seat * 16) / c.seat;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
const keyAt = (keys, t) => { let i = 0; while (i < keys.length - 1 && t >= keys[i + 1].t) i++; return i; };
const track = (keys, f, t) => {
  const i = keyAt(keys, t), a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  if (b === a || t <= a.t) return a[f];
  const x = clamp01((t - a.t) / (b.t - a.t));
  const e = b.ease === "yank" ? 1 - Math.pow(1 - x, 3) : smooth(x); // a yank starts at full speed and drags to a stop
  return THREE.MathUtils.lerp(a[f], b[f], e);
};
// seeded 0..1, the same for the same (n, k) on every frame
const rnd = (n, k = 0) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

// the drawer's full run, metres: full-extension slides bring its back corner out past the desk's edge (x 1), so his head
// stays clear of the desk top while he leans in over it
const RUN = 0.62;
const FOLDERS = 14; // A..Z, two letters a folder, front (A) to back (Z)
const PITCH = 0.032;
// in the closed drawer (world): the front folder, the floor, the side walls
const F0 = { x: CABINET.x + 0.91, y: 0.1125, z0: CABINET.z + 0.69 };
const FLOOR_Y = 0.004;

export async function buildProps(sources, scene, EDIT) {
  const P = () => EDIT.props;
  const block = async (id, properties) => {
    const s = await createScene(sources, [{ id, pos: [0, 0, 0], ...(properties && { properties }) }], { lighting: "scene", animate: false });
    s.group.scale.setScalar(S);
    s.group.position.set(0.5, 0.5, 0.5); // a block at pos 0 spans 0..1 once seated like the room
    s.group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    return s.group;
  };
  const holder = (inner) => { const h = new THREE.Group(); h.add(inner); return h; };

  // facing west, a model's z runs along world x: its backrest front (model z = back) lands on the chair group's origin
  const chair = new THREE.Group();
  chair.position.set(CHAIR.x, 0, CHAIR.z);
  const chairLooks = await Promise.all(CHAIRS.map(async (c) => {
    const k = chairScale(c), look = holder(await block(c.id, { facing: "west" }));
    look.scale.setScalar(k);
    look.position.set((-k * c.back) / 16, 0, -k * 0.5);
    chair.add(look);
    return look;
  }));
  let chairPick = 0;
  const chairBox = new THREE.Box3(new THREE.Vector3(CHAIR.x - 0.7, 0, CHAIR.z - 0.4), new THREE.Vector3(CHAIR.x + 0.8, 1.3, CHAIR.z + 0.4));
  const tray = holder(await block("gohans:file_drawer", { facing: "east" })); // children are in the cabinet cell's own frame
  const dome = holder(await block("gohans:cctv_dome"));
  dome.position.set(...DOME);
  const button = holder(await block("minecraft:stone_button", { face: "wall", facing: "north", powered: "false" }));
  scene.add(chair, tray, dome, button);

  const folderLooks = await Promise.all([0, 1, 2].map((k) => block(`gohans:folder_${k}`)));
  const sheetLook = await block("gohans:sheet");
  const folders = Array.from({ length: FOLDERS }, (_, j) => holder(folderLooks[j % 3].clone()));
  folders.forEach((f) => { f.rotation.order = "YXZ"; scene.add(f); });
  // the scrap lies alone on the floor of the cabinet's slot, found once the drawer is out (props.scrap)
  const scrap = holder(await block("gohans:paper_scrap"));
  scene.add(scrap);

  const sheets =Array.from({ length: 40 }, () => { const h = holder(sheetLook.clone()); h.visible = false; scene.add(h); return h; });

  // ---- the CRT picture: game font (ascii.png, 8 px cells, widths from the glyphs' own pixels) on a blue-grey glow ----
  const font = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "mcasset/1.21.11/assets/minecraft/textures/font/ascii.png"; });
  const fc = document.createElement("canvas"); fc.width = fc.height = 128;
  const fx = fc.getContext("2d", { willReadFrequently: true }); fx.drawImage(font, 0, 0);
  const fpx = fx.getImageData(0, 0, 128, 128).data;
  const width = (c) => { if (c === 32) return 4; const gx = (c % 16) * 8, gy = Math.floor(c / 16) * 8; for (let x = 7; x >= 0; x--) for (let y = 0; y < 8; y++) if (fpx[((gy + y) * 128 + gx + x) * 4 + 3] > 0) return x + 2; return 0; };
  const W = 288, H = 224, SC = 2; // 9 x 7 model pixels of glass, 32 canvas pixels each
  const screenCanvas = document.createElement("canvas"); screenCanvas.width = W; screenCanvas.height = H;
  const sx = screenCanvas.getContext("2d");
  const tint = document.createElement("canvas"); tint.width = tint.height = 128;
  const tx = tint.getContext("2d");
  tx.drawImage(font, 0, 0); tx.globalCompositeOperation = "source-in"; tx.fillStyle = "#b9d3df"; tx.fillRect(0, 0, 128, 128);
  const text = (s, x, y) => { for (const ch of s) { const c = ch.charCodeAt(0); sx.drawImage(tint, (c % 16) * 8, Math.floor(c / 16) * 8, 8, 8, x, y, 8 * SC, 8 * SC); x += width(c) * SC; } return x; };
  const keystrokes = () => {
    const T = P().screen.typing, out = [];
    for (const tr of T?.tries ?? []) {
      for (let i = 0; i < tr.text.length; i++) out.push({ t: tr.t + i / tr.cps, hand: i % 2 ? "L" : "R", ch: tr.text[i] });
      out.push({ t: tr.t + tr.text.length / tr.cps + T.enter, hand: "R", ch: "Enter" });
    }
    return out;
  };
  // the terminal at time t: the fixed lines, then each try as far as it is typed and its reply; it scrolls past 11 lines
  const screenLines = (t) => {
    const S = P().screen, T = S.typing;
    if (!T) return S.lines;
    const lines = S.lines.slice(0, -1); // the last line is the empty prompt the first try is typed on
    let typing = false;
    for (const tr of T.tries) {
      if (t < tr.t) break;
      lines.push("> " + tr.text.slice(0, Math.floor((t - tr.t) * tr.cps) + 1));
      typing = t < tr.t + tr.text.length / tr.cps + T.enter + T.wait;
      if (typing) break;
      lines.push("  " + T.reply);
    }
    if (!typing) lines.push("> ");
    return lines.slice(-11);
  };
  let drawn = null;
  const paint = (lines, cursor) => {
    const key = lines.join("|") + cursor;
    if (drawn === key) return;
    drawn = key;
    const g = sx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, "#22394a"); g.addColorStop(1, "#0b141b");
    sx.fillStyle = g; sx.fillRect(0, 0, W, H);
    let y = 10, end = 0;
    for (const line of lines) { end = text(line, 12, y); y += 9 * SC; }
    if (cursor) { sx.fillStyle = "#b9d3df"; sx.fillRect(end + 2, y - 9 * SC + 14, 10, 3); }
    sx.fillStyle = "rgba(0,0,0,.22)"; for (let r = 0; r < H; r += 4) sx.fillRect(0, r, W, 2); // scanlines
    tex.needsUpdate = true;
  };
  const tex = new THREE.CanvasTexture(screenCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(9 * S, 7 * S), new THREE.MeshBasicMaterial({ map: tex }));
  glass.material.color.setScalar(1.7); // brighter than paper white: the glow blooms a little, as a CRT in a dark room does
  // the CRT faces east; its glass (model x 3.5..12.5, y 3.5..10.5, z 6.75) lands at x 0.578, z 8.22..8.78, y 1.22..1.66
  glass.position.set(0.5785 + 0.002, 1 + 7 * S, DESK.z + 0.5);
  glass.rotation.y = Math.PI / 2;

  // ---- print on the paper (edit.json props.pages): useless beginner pages, so what he throws away reads as worthless ----
  // A page is printed in the game's font, ink only (transparent elsewhere), on a plane a hair above the model's paper face;
  // the folders carry the same titles on a cover label with their letters (A..Z, two a folder)
  const inkFont = (color) => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); x.drawImage(font, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, 128, 128); return c; };
  const INK = inkFont("#262626"), GREY = inkFont("#5d5d5d");
  const lineW = (str) => [...str].reduce((w, ch) => w + width(ch.charCodeAt(0)), 0);
  const print = (g, ink, str, x, y, sc) => { for (const ch of str) { const c = ch.charCodeAt(0); g.drawImage(ink, (c % 16) * 8, Math.floor(c / 16) * 8, 8, 8, x, y, 8 * sc, 8 * sc); x += width(c) * sc; } };
  const inkMaterial = (canvas) => {
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.anisotropy = 8;
    return new THREE.MeshLambertMaterial({ map, transparent: true, alphaTest: 0.35, polygonOffset: true, polygonOffsetFactor: -2 });
  };
  // a printed page: big title fitted to the width, a rule under it, then the body lines
  const pageInk = ({ title, lines }) => {
    const c = document.createElement("canvas"); c.width = 152; c.height = 200;
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
    const sc = Math.max(1, Math.min(4, Math.floor(136 / lineW(title))));
    print(g, INK, title, (152 - lineW(title) * sc) / 2, 12, sc);
    g.fillStyle = "#4a4a4a"; g.fillRect(12, 20 + 8 * sc, 128, 2);
    lines.forEach((l, i) => print(g, GREY, l, 14, 34 + 8 * sc + i * 22, 2));
    return inkMaterial(c);
  };
  const labelInk = (title, letters) => {
    const c = document.createElement("canvas"); c.width = 96; c.height = 72;
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
    g.fillStyle = "#e9e4d4"; g.fillRect(8, 8, 80, 42); g.fillStyle = "#3b3b3b"; g.fillRect(8, 8, 80, 1); g.fillRect(8, 49, 80, 1);
    const sc = lineW(title) * 2 <= 72 ? 2 : 1;
    print(g, INK, title, (96 - lineW(title) * sc) / 2, 12, sc);
    print(g, INK, letters, (96 - lineW(letters) * 2) / 2, 32, 2);
    return inkMaterial(c);
  };
  // holders still sit at the origin unturned here, so their boxes are the models' own extents
  const PAGES = P().pages ?? [];
  const sb = new THREE.Box3().setFromObject(sheets[0]), ss = sb.getSize(new THREE.Vector3());
  const sheetMid = new THREE.Vector3((sb.min.x + sb.max.x) / 2, sb.min.y, (sb.min.z + sb.max.z) / 2);
  const pageMats = PAGES.map(pageInk);
  if (PAGES.length) {
    sheets.forEach((h, i) => {
      const ink = new THREE.Mesh(new THREE.PlaneGeometry(ss.x * 0.94, ss.z * 0.94), pageMats[i % pageMats.length]);
      ink.position.set(sheetMid.x, sb.max.y + 0.0006, sheetMid.z);
      ink.rotation.x = -Math.PI / 2;
      h.add(ink);
      h.userData.ink = ink;
    });
    // what the scrap says (props.note), small lines filling its face
    const nb = new THREE.Box3().setFromObject(scrap), ns = nb.getSize(new THREE.Vector3());
    const nc = document.createElement("canvas"); nc.width = 240; nc.height = 306;
    const ng = nc.getContext("2d"); ng.imageSmoothingEnabled = false;
    (P().note?.lines ?? []).forEach((l, i) => print(ng, INK, l, 12, 12 + i * 17, 2));
    const noteInk = new THREE.Mesh(new THREE.PlaneGeometry(ns.x * 0.9, ns.z * 0.9), inkMaterial(nc));
    noteInk.position.set((nb.min.x + nb.max.x) / 2, nb.max.y + 0.0006, (nb.min.z + nb.max.z) / 2);
    noteInk.rotation.x = -Math.PI / 2;
    scrap.add(noteInk);
    const fb = new THREE.Box3().setFromObject(folders[0]), fs = fb.getSize(new THREE.Vector3());
    const az = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    folders.forEach((h, j) => {
      const mat = labelInk(PAGES[j % PAGES.length].title, `${az[2 * j]}-${az[Math.min(2 * j + 1, 25)]}`);
      for (const side of [1, -1]) {
        const label = new THREE.Mesh(new THREE.PlaneGeometry(fs.x * 0.8, fs.x * 0.6), mat);
        label.position.set((fb.min.x + fb.max.x) / 2, fb.min.y + fs.y * 0.55, side > 0 ? fb.max.z + 0.0006 : fb.min.z - 0.0006);
        if (side < 0) label.rotation.y = Math.PI;
        h.add(label);
      }
    });
  }
  scene.add(glass);
  const glow = new THREE.PointLight(0x9fc3da, 0, 4.5, 1.6); // the screen's light on his face and the desk
  glow.position.set(0.95, 1.42, DESK.z + 0.5);
  scene.add(glow);
  paint(P().screen.lines, true);

  // the silverfish, its texture straight out of client.jar (the last source)
  const SF = "assets/minecraft/textures/entity/silverfish/silverfish.png";
  const sfUrl = URL.createObjectURL(new Blob([unzipSync(sources[sources.length - 1], { filter: (f) => f.name === SF })[SF]], { type: "image/png" }));
  const silverfish = await buildSilverfish(sfUrl);
  URL.revokeObjectURL(sfUrl);
  scene.add(silverfish.g);

  const open = (t) => track(P().drawer, "open", t) * RUN;
  // the drawer's place: in its slides, or on its way out of the cabinet onto the floor (props.out)
  const trayAt = (t) => {
    const o = P().out, slot = { x: CABINET.x + open(t), y: 0, z: CABINET.z, yaw: 0 };
    if (!o || t < o.t) return slot;
    const u = smooth((t - o.t) / o.dur);
    return { x: THREE.MathUtils.lerp(slot.x, o.to[0], u), y: 0.18 * Math.sin(Math.PI * u), z: THREE.MathUtils.lerp(slot.z, o.to[1] - 0.5, u), yaw: (o.yaw * Math.PI / 180) * u };
  };
  const chairDx = (t) => track(P().chair, "dx", t);
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  // the hand hops from key to key: over the cap it strikes (capAt, set by src/scene.ts from the keyboard it built), down
  // with the key, then across to the next one; without capAt it taps on the spot at typing.keys
  let capAt = null;
  const tapAt = (hand, t) => {
    const k = P().screen.typing.keys[hand], strokes = keystrokes().map((s, n) => ({ ...s, n })).filter((s) => s.hand === hand);
    const over = (s) => (capAt && s ? capAt(s).add(v(0, 0.012, 0)) : v(...k));
    let i = strokes.findLastIndex((s) => t >= s.t);
    const a = strokes[i], b = strokes[i + 1] ?? a ?? strokes[0];
    const dip = a && t < a.t + 0.09 ? Math.sin((Math.PI * (t - a.t)) / 0.09) : 0;
    const go = a && b !== a ? smooth((t - a.t - 0.09) / Math.max(0.02, b.t - a.t - 0.09)) : 0;
    return (a ? over(a).lerp(over(b), go) : over(b)).add(v(0, -0.025 * dip, 0));
  };
  // how far in his finger is at t, 0..1: it comes in over 0.12 s, holds 0.12 s, leaves over 0.13 s
  const pushIn = (t) => {
    let s = 0;
    for (const p of P().button?.presses ?? []) {
      const x = t - p;
      s = Math.max(s, x < -0.12 || x > 0.25 ? 0 : x < 0 ? smooth((x + 0.12) / 0.12) : x < 0.12 ? 1 : 1 - smooth((x - 0.12) / 0.13));
    }
    return s;
  };
  const buttonIn = (t) => clamp01((pushIn(t) - 0.7) / 0.3); // the cap gives only once the finger is on it
  const anchors = {
    // the button's face (a wall button stands 2 px proud of the wall, 1 px when pressed); his fist draws back 16 cm between jabs
    press_R: (t) => { const c = P().button.cell; return v(c[0] + 0.5, c[1] + 0.5, c[2] + 1 - 0.125 + 0.0625 * buttonIn(t) - 0.16 * (1 - pushIn(t))); },
    handle: (t) => { const a = trayAt(t); return v(a.x + 1.03, a.y + 0.625, a.z + 0.5); },
    // the top of the chosen chair's backrest, on his side (he comes from the south)
    chair_grip: (t) => { const c = CHAIRS[chairPick]; return v(CHAIR.x + chairDx(t) + 0.03, (chairScale(c) * c.top) / 16 - 0.03, CHAIR.z + 0.22); },
    // the top of folder j, front (0) to back
    folder: (t, j) => v(F0.x - j * PITCH + open(t) + 0.015, F0.y + 0.32, CABINET.z + 0.5),
    // the scrap on the slot's floor, and the dark slot itself (where he peers)
    scrap: () => { const c = P().scrap; return v(c.at[0] + 0.07, 0.08, c.at[1]); },
    near_scrap: () => { const c = P().scrap; return v(c.at[0] + 0.2, 0.14, c.at[1]); },
    slot: () => v(CABINET.x + 0.5, 0.35, CABINET.z + 0.5),
    // where he holds it up to read: pinched at its bottom edge, so the hand sits below the text, not over it
    note_R: () => { const c = P().scrap; return v(c.hold[0] + 0.03, c.hold[1] - 0.17, c.hold[2] - 0.03); },
    note_L: () => { const c = P().scrap; return v(c.hold[0], c.hold[1] - 0.04, c.hold[2] + 0.09); },
    screen: () => v(0.58, 1.43, DESK.z + 0.5),
    // his fingers on the keyboard while he types (props.screen.typing): each keystroke dips that hand 2.5 cm for 0.09 s
    keys_R: (t) => tapAt("R", t),
    keys_L: (t) => tapAt("L", t),
    // the middle of spilt sheet k on the floor, for his hand to take it
    spill: (t, k) => { const s = P().spill.sheets[k]; return v(s.land[0], 0.03, s.land[1]); },
    silverfish: (t) => { const S = P().silverfish; return S ? silverfish.where(S.path, t).add(v(0, 0.08, 0)) : v(2, 0, 9.5); },
    desk_page: () => { const D = P().desk; return v(D.at[0], D.at[1] + 0.02, D.at[2]); },
  };

  // where folder j stands in the drawer (world) at t: tidy, or shaken while he digs through it (props.files)
  const scratch = new THREE.Object3D();
  scratch.rotation.order = "YXZ";
  const drawerPose = (j, t) => {
    const F = P().files ?? [], ta = trayAt(t);
    let lean = (rnd(j, 1) - 0.5) * 0.08, lift = 0;
    if (F.length) {
      const shake = smooth((t - F[0].grab + 0.3) / 0.4) * (1 - smooth((t - F[F.length - 1].release) / 0.3));
      if (shake > 0) { lean += shake * 0.18 * Math.sin(t * 13 + j * 2.1); lift += shake * 0.03 * Math.max(0, Math.sin(t * 9 + j)); }
    }
    scratch.position.set(F0.x - j * PITCH + ta.x - CABINET.x, F0.y + lift + ta.y, F0.z0 + ta.z - CABINET.z);
    scratch.rotation.set(lean, Math.PI / 2, 0);
    scratch.updateMatrix();
    return { p: scratch.position.clone(), q: scratch.quaternion.clone() };
  };
  // the scrap's grip in his right hand: pinched at its edge
  const gripR = new THREE.Matrix4().compose(v(0.02, -0.03, 0.0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2, "YXZ")), v(1, 1, 1));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const heldWith = (hand, g, out) => { hand.updateWorldMatrix(true, false); m.multiplyMatrices(hand.matrixWorld, g).decompose(p, q, sc); out.position.copy(p); out.quaternion.copy(q); };
  // lying flat, its middle at (x, y, z), turned yaw
  const flatAt = (o, x, y, z, yaw) => { o.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ")); o.position.set(x, y, z).sub(sheetMid.clone().applyQuaternion(o.quaternion)); };
  const scrapBox = new THREE.Box3().setFromObject(scrap);
  const scrapMid = new THREE.Vector3((scrapBox.min.x + scrapBox.max.x) / 2, scrapBox.min.y, (scrapBox.min.z + scrapBox.max.z) / 2);
  // a folder's middle, and the middle of the face it lands on when it falls on its side (model -z turns to the floor)
  const fb = new THREE.Box3().setFromObject(folders[0]), fs = fb.getSize(new THREE.Vector3());
  const folderMid = fb.getCenter(new THREE.Vector3()), folderBase = folderMid.clone().setZ(fb.min.z);

  const ONE = v(1, 1, 1), UP = v(0, 1, 0);
  const toMat = (o) => new THREE.Matrix4().compose(o.p, o.q, ONE);
  const fromMat = (mat) => { const o = { p: v(0, 0, 0), q: new THREE.Quaternion() }; mat.decompose(o.p, o.q, v(0, 0, 0)); return o; };
  const mixPose = (a, b, k) => (k <= 0 ? a : { p: a.p.clone().lerp(b.p, k), q: a.q.clone().slerp(b.q, k) });
  // a throw: from a pose to lying at f.land [x, z] turned f.yaw (f.flat: a page face up; else a folder on its side), its
  // f.mid on the spot, up in an arc of height f.h, tumbling as it goes; f.layer lifts it a hair so things landing on one
  // spot don't flicker through each other
  const fly = (from, f, u) => {
    const e = clamp01(u);
    const down = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.flat ? 0 : -Math.PI / 2, f.yaw, 0, "YXZ"));
    const land = v(f.land[0], FLOOR_Y + (f.layer % 8) * 0.0012, f.land[1]).sub(f.mid.clone().applyQuaternion(down));
    const pos = from.p.clone().lerp(land, e);
    pos.y += f.h * 4 * e * (1 - e);
    const rot = from.q.clone().slerp(down, smooth(e));
    if (e < 1) rot.multiply(new THREE.Quaternion().setFromAxisAngle(v(0.3, 1, 0.5).normalize(), f.spin * Math.sin(Math.PI * e)));
    return { p: pos, q: rot };
  };

  // ---- carrying ----
  // grips(tt): his two hands' grip groups (world matrices) and his eyes at film time tt. draw() sets the live ones for the
  // frame it draws; any other moment comes from scene.ts handAt, which poses Steve at tt (cached per edit)
  let live = { t: NaN, g: null }, handAtFn = null;
  const gripsOf = (hR, hL, head) => {
    hR.updateWorldMatrix(true, false); hL.updateWorldMatrix(true, false);
    return { R: hR.matrixWorld.clone(), L: hL.matrixWorld.clone(), eyes: head.getWorldPosition(v(0, 0, 0)).add(v(0, 0.2, 0)) };
  };
  const grips = (tt) => (tt === live.t ? live.g : handAtFn(tt, gripsOf));
  // How a held thing sits, by mode:
  //   "hang"  a page pinched at its top edge, hanging from the hand in the plane of his side, so it clears his leg
  //   "flat"  a page lying level under the hand, about to be put down
  //   "face"  held up square to his eyes, pinched at its bottom edge, print upright: how anyone holds a page to read it
  // slot stacks several pages in one hand a few millimetres apart
  const HANG = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(v(0, 0, -1), v(1, 0, 0), v(0, -1, 0)));
  const shapeOf = (kind, mode, g, hand, slot, yaw) => {
    const H = g[hand], at = v(0, 0, 0).setFromMatrixPosition(H), page = kind === "page";
    if (mode === "hang") {
      const local = v(0.005 * slot, -(ss.z / 2 - 0.02), 0).sub(sheetMid.clone().applyQuaternion(HANG));
      return fromMat(H.clone().multiply(new THREE.Matrix4().compose(local, HANG, ONE)));
    }
    if (mode === "flat") { flatAt(scratch, at.x, at.y - 0.012 - 0.003 * slot, at.z, yaw); return { p: scratch.position.clone(), q: scratch.quaternion.clone() }; }
    // the page's printed face is its model +y with the print's top towards -z; a folder's label is on its +z side
    const n = g.eyes.clone().sub(at).normalize(), up = UP.clone().addScaledVector(n, -n.y).normalize();
    const rot = new THREE.Quaternion();
    if (page) { const zAx = up.clone().negate(); rot.setFromRotationMatrix(new THREE.Matrix4().makeBasis(n.clone().cross(zAx), n, zAx)); }
    else rot.setFromRotationMatrix(new THREE.Matrix4().makeBasis(up.clone().cross(n), up, n));
    const half = page ? ss.z / 2 : fs.y / 2, mid = page ? sheetMid : folderMid;
    const centre = at.clone().addScaledVector(up, half - 0.03).addScaledVector(n, 0.012 + 0.004 * slot);
    return { p: centre.sub(mid.clone().applyQuaternion(rot)), q: rot };
  };
  // An item's story is a list of states, each holding from its t: {at(tt)} lying where it lies; {fly} thrown from wherever
  // the state before left it; {lay} put down out of the hand onto a fixed pose over 0.3 s; {hand, kind, modes} in that hand.
  // Taking it freezes its pose relative to the hand at that moment, so it leaves the floor (desk, drawer) from exactly where
  // it lay and never jumps into the fingers; modes [[t, mode]] then turn it into a way of holding it, each over 0.35 s
  const poseIn = (S, i, tt) => {
    const s = S[i];
    if (s.at) return s.at(tt);
    if (s.fly) return fly(poseIn(S, i - 1, s.t), s.fly, (tt - s.t) / s.fly.dur);
    if (s.lay) return mixPose(poseIn(S, i - 1, s.t), s.lay, smooth((tt - s.t) / 0.3));
    const g0 = grips(s.t), g = grips(tt);
    const rel = g0[s.hand].clone().invert().multiply(toMat(poseIn(S, i - 1, s.t)));
    let pose = fromMat(g[s.hand].clone().multiply(rel));
    for (const [tm, mode] of s.modes ?? []) if (tt > tm) pose = mixPose(pose, shapeOf(s.kind, mode, g, s.hand, s.slot ?? 0, s.yaw ?? 0), smooth((tt - tm) / 0.35));
    return pose;
  };
  const show = (o, S, t) => {
    let i = -1;
    S.forEach((s, k) => { if (t >= s.t) i = k; });
    if (i < 0) return;
    const at = poseIn(S, i, t);
    o.position.copy(at.p);
    o.quaternion.copy(at.q);
    o.visible = true;
  };
  const inkIt = (o, page) => { const ink = o.userData.ink; if (ink && pageMats.length) ink.material = pageMats[page % pageMats.length]; };

  // The pages the silverfish spills: gathered off the floor, laid on the desk, taken up one by one and read, flung off.
  // Every page's states come from edit.json alone (props.spill, desk, takes, fling); returns the next free sheet
  const pagesAt = (t) => {
    const Pr = P(), Sp = Pr.spill, D = Pr.desk;
    if (!Sp) return 0;
    const DEG = Math.PI / 180;
    const mouth = (k) => ({ p: v(CABINET.x + 0.85 + open(Sp.at), 0.5, CABINET.z + 0.5 + ((k % 3) - 1) * 0.09), q: new THREE.Quaternion() });
    const S = Sp.sheets.map((s, k) => {
      const t0 = Sp.at + k * 0.035;
      const st = [{ t: t0, at: () => mouth(k) }, { t: t0, fly: { land: s.land, yaw: s.yaw * DEG, dur: 0.75 + 0.12 * (k % 3), h: 0.55 + 0.25 * rnd(k, 25), spin: 7, layer: k, flat: true, mid: sheetMid } }];
      if (s.pick != null) st.push({ t: s.pick, hand: s.hand, kind: "page" });
      if (s.stack != null) st.push({ t: s.stack, hand: "L", kind: "page" });
      return st;
    });
    // the left hand's pages in the order they came into it: the last lies on top of the pile
    const pile = Sp.sheets.map((s, k) => ({ k, t: s.hand === "L" ? s.pick : s.stack })).filter((x) => x.t != null).sort((a, b) => a.t - b.t).map((x) => x.k);
    pile.forEach((k, n) => Object.assign(S[k][S[k].length - 1], { slot: n, modes: Sp.carry ?? [], yaw: (D?.yaw ?? 0) * DEG }));
    if (D) {
      pile.forEach((k, n) => { flatAt(scratch, D.at[0], D.at[1] + 0.001 + n * 0.0028, D.at[2], (D.yaw + (rnd(n, 21) - 0.5) * 8) * DEG); S[k].push({ t: D.t, lay: { p: scratch.position.clone(), q: scratch.quaternion.clone() } }); });
      const left = pile.slice();
      const taken = (Pr.takes ?? []).slice().sort((a, b) => a.t - b.t).map((tk) => {
        const k = left.pop();
        if (k != null) S[k].push({ t: tk.t, hand: tk.hand, kind: "page", modes: [[tk.face, "face"]] });
        return { k, hand: tk.hand };
      }).filter((x) => x.k != null);
      const F = Pr.fling;
      if (F) {
        const order = [...taken.filter((x) => x.hand === "R"), ...taken.filter((x) => x.hand !== "R")].map((x) => ({ k: x.k, held: true }))
          .concat(left.slice().reverse().map((k) => ({ k, held: false })));
        order.forEach(({ k, held }, n) => {
          const l = F.lands[n % F.lands.length];
          S[k].push({ t: F.t + (held ? 0 : 0.05 + 0.04 * n), fly: { land: l, yaw: rnd(n, 24) * 6.28, dur: 0.8, h: held ? 0.25 : 0.18, spin: 5, layer: 3 + n, flat: true, mid: sheetMid } });
        });
      }
    }
    Sp.sheets.forEach((s, k) => { inkIt(sheets[k], s.page); show(sheets[k], S[k], t); });
    return Sp.sheets.length;
  };

  // the folders: in the drawer, then each one he takes (props.files) in his hand, held up to read, thrown
  const filesAt = (t, sheet) => {
    const F = P().files ?? [], DEG = Math.PI / 180;
    const S = folders.map((_, j) => [{ t: -Infinity, at: (tt) => drawerPose(j, tt) }]);
    F.forEach((it, n) => {
      S[it.folder].push({ t: it.grab, hand: it.hand, kind: "folder", modes: it.face != null ? [[it.face, "face"]] : [] });
      S[it.folder].push({ t: it.release, fly: { land: it.land, yaw: it.yaw * DEG, dur: 0.9, h: 0.35, spin: 3, layer: 8 + n, flat: false, mid: folderBase } });
    });
    folders.forEach((f, j) => show(f, S[j], t));
    // the loose pages that slip out of a thrown folder near the top of its arc and flutter down around where it lands
    F.forEach((it, n) => {
      const fs0 = S[it.folder], i = fs0.length - 1;
      for (let k = 0; k < it.sheets; k++, sheet++) {
        const t0 = it.release + 0.25 + k * 0.06, o = sheets[sheet];
        if (t < t0) continue;
        const from = poseIn(fs0, i, t0), m2 = n * 10 + k;
        const land = [it.land[0] + (rnd(m2, 6) - 0.5) * 0.9, it.land[1] + (rnd(m2, 7) - 0.5) * 0.9];
        inkIt(o, 3 + m2);
        show(o, [{ t: t0, at: () => from }, { t: t0, fly: { land, yaw: rnd(m2, 8) * 6.28, dur: 1.1, h: 0.15, spin: 5, layer: 20 + m2, flat: true, mid: sheetMid } }], t);
      }
    });
  };

  // handAt(tt, fn) poses Steve at tt and gives fn(right grip, left grip, head bone) (scene.ts, cached per edit)
  const draw = (t, handNow, handAt, handL, head) => {
    const Pr = P();
    handAtFn = handAt;
    live = { t, g: gripsOf(handNow, handL, head) };
    const ta = trayAt(t);
    tray.position.set(ta.x, ta.y, ta.z);
    tray.rotation.y = ta.yaw;
    const sc0 = Pr.scrap;
    if (sc0) {
      const lie = new THREE.Object3D();
      lie.quaternion.setFromEuler(new THREE.Euler(0, (sc0.yaw * Math.PI) / 180, 0, "YXZ"));
      lie.position.set(sc0.at[0], 0.0635, sc0.at[1]).sub(scrapMid.clone().applyQuaternion(lie.quaternion));
      if (t < sc0.grab) { scrap.position.copy(lie.position); scrap.quaternion.copy(lie.quaternion); }
      else {
        // pinched up off the slot floor, then held up square to the point `face` (the last shot's lens), text upright
        const held = new THREE.Object3D();
        heldWith(handNow, gripR, held);
        const read = new THREE.Object3D();
        // the model's printed face is its +y, the text's top its -z
        const n = v(...sc0.face).sub(v(...sc0.hold)).normalize(), up = v(0, 1, 0).addScaledVector(n, -n.y).normalize();
        const zAx = up.clone().negate(), xAx = n.clone().cross(zAx);
        read.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAx, n, zAx));
        read.position.set(...sc0.hold).sub(scrapMid.clone().applyQuaternion(read.quaternion));
        const u = smooth((t - sc0.read) / 0.6);
        scrap.position.lerpVectors(held.position, read.position, u);
        scrap.quaternion.slerpQuaternions(held.quaternion, read.quaternion, u);
      }
    }
    chair.position.x = CHAIR.x + chairDx(t);
    if (Pr.button) button.position.set(Pr.button.cell[0], Pr.button.cell[1], Pr.button.cell[2] + 0.0625 * buttonIn(t));
    const on = t >= Pr.screen.on;
    glass.visible = on;
    glow.intensity = on ? EDIT.light.screen : 0;
    if (on) paint(screenLines(t), Math.floor((t - Pr.screen.on) * 1.9) % 2 === 0);

    sheets.forEach((s) => { s.visible = false; });
    silverfish.draw(Pr.silverfish, t);
    filesAt(t, pagesAt(t));
  };
  // where the keyboard has been knocked to (props.keyboard)
  const keyboardAt = (t) => {
    const K = P().keyboard;
    if (!K?.length) return { yaw: 0, dx: 0, dz: 0, lift: 0 };
    return { yaw: track(K, "yaw", t), dx: track(K, "dx", t), dz: track(K, "dz", t), lift: track(K, "lift", t) };
  };
  return {
    keyboardAt,
    // the keys down at t: [{n, hand, ch, depth 0..1}], one per keystroke (n counts them), down for 0.09 s
    setCapAt: (f) => { capAt = f; },
    // the lamp's level lv (scene.ts flickerAt): when it drops out the screen dies with it, as on one failing circuit
    dim: (lv) => { const k = smooth(lv / 0.3); glow.intensity *= k; glass.material.color.setScalar(1.7 * (0.04 + 0.96 * k)); },
    keysDown: (t) => keystrokes().map((s, n) => ({ ...s, n, depth: t >= s.t && t < s.t + 0.09 ? Math.sin((Math.PI * (t - s.t)) / 0.09) : 0 })).filter((s) => s.depth > 0),
    draw, anchors, dome, glass, chair, tray, folders, sheets, scrap, silverfish: silverfish.g,
    // the chair's looks for the studio (src/variants.ts asVariant); setChair keeps chair_grip on the shown one
    chairLooks, chairBox, setChair: (id) => { const i = CHAIRS.findIndex((c) => c.id === id); if (i >= 0) chairPick = i; },
    open, chairDx,
    objects: [[button, "stone button (minecraft:stone_button)"], [chair, "chair (pack/pick.py, choices.json)"], [tray, "filing drawer (pack/file_drawer.json)"], [dome, "CCTV dome (pack/cctv_dome.json)"], [scrap, "folded scrap (pack/paper_scrap.json)"], [glass, "CRT picture (props.ts, game font)"], [silverfish.g, "silverfish (src/silverfish.ts, game model)"]],
  };
}
