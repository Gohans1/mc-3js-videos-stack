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
import { makeCarry } from "./carry";
import { clamp01, smooth } from "./ease";
import { loadFont } from "./gamefont";
import { printProps } from "./ink";
import { buildScreen } from "./screen";
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

  const sheets = Array.from({ length: 40 }, () => { const h = holder(sheetLook.clone()); h.visible = false; scene.add(h); return h; });

  // the CRT's picture (src/screen.ts) and the print on the paper (src/ink.ts), both in the game's font (src/gamefont.ts)
  const font = await loadFont();
  const screen = buildScreen(font, P, EDIT), { glass, keystrokes } = screen;
  // holders still sit at the origin unturned here, so their boxes are the models' own extents
  const sb = new THREE.Box3().setFromObject(sheets[0]), ss = sb.getSize(new THREE.Vector3());
  const sheetMid = new THREE.Vector3((sb.min.x + sb.max.x) / 2, sb.min.y, (sb.min.z + sb.max.z) / 2);
  const pageMats = printProps(font, { sheets, scrap, folders, pages: P().pages ?? [], note: P().note });
  scene.add(glass, screen.glow);

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
  const scrapBox = new THREE.Box3().setFromObject(scrap);
  const scrapMid = new THREE.Vector3((scrapBox.min.x + scrapBox.max.x) / 2, scrapBox.min.y, (scrapBox.min.z + scrapBox.max.z) / 2);
  // a folder's middle, and the middle of the face it lands on when it falls on its side (model -z turns to the floor)
  const fb = new THREE.Box3().setFromObject(folders[0]), fs = fb.getSize(new THREE.Vector3());
  const folderMid = fb.getCenter(new THREE.Vector3()), folderBase = folderMid.clone().setZ(fb.min.z);

  // pages and folders in his hands, put down and thrown (src/carry.ts)
  const carry = makeCarry({ sheetMid, sheetSize: ss, folderMid, folderSize: fs, floorY: FLOOR_Y }), { flatAt, poseIn, show } = carry;
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
    carry.frame(t, handNow, handL, head, handAt);
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
    screen.draw(t);

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
    dim: screen.dim,
    keysDown: (t) => keystrokes().map((s, n) => ({ ...s, n, depth: t >= s.t && t < s.t + 0.09 ? Math.sin((Math.PI * (t - s.t)) / 0.09) : 0 })).filter((s) => s.depth > 0),
    draw, anchors, dome, glass, chair, tray, folders, sheets, scrap, silverfish: silverfish.g,
    // the chair's looks for the studio (src/variants.ts asVariant); setChair keeps chair_grip on the shown one
    chairLooks, chairBox, setChair: (id) => { const i = CHAIRS.findIndex((c) => c.id === id); if (i >= 0) chairPick = i; },
    open, chairDx,
    objects: [[button, "stone button (minecraft:stone_button)"], [chair, "chair (pack/pick.py, choices.json)"], [tray, "filing drawer (pack/file_drawer.json)"], [dome, "CCTV dome (pack/cctv_dome.json)"], [scrap, "folded scrap (pack/paper_scrap.json)"], [glass, "CRT picture (props.ts, game font)"], [silverfish.g, "silverfish (src/silverfish.ts, game model)"]],
  };
}
