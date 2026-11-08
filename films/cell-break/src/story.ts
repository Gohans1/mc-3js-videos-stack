// @ts-nocheck
// Everything the story adds around the cell, keyed in src/timeline/props.json `story` (events) and `pages` (book text):
//   sets far from the cell (beyond the fog, so they never show in each other's shots), each lit by its own lamps:
//     LEVER x 420: the red master switch on OpenAI's server-room wall (hook F6, act 4)
//     INSERT x 400, z 40: a dark desk where a book page lies for its close-up (`insert` picks the page)
//     HALL x 1200 (the treasure), CELLAR x 1300 (five old barrels), DEPOT x 1400 (the warehouse bot)
//   the ghosts (a second Steve, see-through, plus an instanced army), the engineer (a third player, the lever's hand), 0411's inmate,
//   the TNT under his floor (hook F7: the trap block lifts, the TNT flashes and blows, the game's own explosion particles),
//   particles (sparks, smoke, dust, flying paper, glass), the CRT's states, Steve's dissolve, and the HUD cards
//   (title, chapter cards, date stamps, black and fades) on a plane in front of the camera.
// Effects run on film time even in a still shot: the shot freezes Steve (scene.ts stillAt), not the dust in the air.
import * as THREE from "three";
import { unzipSync } from "fflate";
import { createScene } from "block-model-renderer";
import { buildScreen } from "mc-assets/screen";
import { DESK, RAIL_Y, TRAP, TUNNEL } from "./world";

const S = 1 / 16;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const SETS = { lever: V(420, 0, 0), insert: V(400, 0, 40), hall: V(1200, 0, 0), cellar: V(1300, 0, 0), depot: V(1400, 0, 0) };
// The chair (pack/picks.json, NhatJS Furniture, MIT): seat 11, backrest front 12.5 in its model's 16ths, scaled to a 0.45 m
// seat like sealed-room's; its backrest front stands at CHAIR (he sits at z 1.58, the desk's edge at z 1)
export const CHAIR = { id: "js_furniture_mod:black_chair", x: DESK.crt + 0.5, z: 1.71, seat: 0.45, model: { seat: 11, back: 12.5 } };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const rnd = (i, k = 0) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
// the key in force at t (keys sorted by t), or null
const keyAt = (keys, t) => { let k = null; for (const e of keys ?? []) if (t >= e.t) k = e; return k; };
// [entry, 0..1 progress] of the span (t..t+d) that holds t, or null
const spanAt = (list, t) => { for (const e of list ?? []) if (t >= e.t && t < e.t + e.d) return [e, (t - e.t) / e.d]; return null; };

export async function buildStory({ scene, camera, sources, jar, font, makeActor, clips, loose }) {
  const unz = (path) => unzipSync(jar, { filter: (f) => f.name === path })[path];
  const tex = async (name) => {
    const url = URL.createObjectURL(new Blob([unz(`assets/minecraft/textures/${name}.png`)], { type: "image/png" }));
    const t = await new THREE.TextureLoader().loadAsync(url);
    URL.revokeObjectURL(url);
    t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return t;
  };
  const blocks = async (list, at, src = sources) => {
    const g = (await createScene(src, list, { lighting: "scene", animate: false })).group;
    g.scale.setScalar(S);
    g.position.set(at.x + 0.5, at.y + 0.5, at.z + 0.5);
    g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    scene.add(g);
    return g;
  };
  const lamp = (color, i, d, p) => { const l = new THREE.PointLight(color, i, d, 1.6); l.position.copy(p); scene.add(l); return l; };
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const lambert = (map, extra = {}) => new THREE.MeshLambertMaterial({ map, ...extra });
  const sprite = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 1, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.4, "rgba(255,255,255,.5)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const P = () => (globalThis.__EDIT ?? {}).props ?? {};
  const story = () => P().story ?? {};

  // ---------- 0411: the cell next door (cellblock.ts NEIGHBOUR, every cell the same, dev rule): its inmate (Steve in a
  // rust shirt) brings a sledgehammer down on the CRT. story.swing [{t, d, clip, from, rate, at, yaw}]: the mocap clip (scene.ts
  // loads it) from `from` s on; the hammer rides his right hand, his left hand grips its handle
  const hammer = new THREE.Group();
  const handle = box(0.06, 0.06, 0.95, lambert(await tex("block/stripped_dark_oak_log")));
  handle.position.z = 0.3;
  const head = box(0.2, 0.42, 0.2, lambert(await tex("block/netherite_block")));
  head.position.z = 0.78;
  hammer.add(handle, head);
  const inmate = await makeActor("steve", { shirt: "#b8563a" }); // cell 0411: Steve in a rust shirt
  inmate.hand.add(hammer);
  const gripL = V(0, 0, 0);
  const hammerAt = (t) => {
    const s = spanAt(story().swing, t);
    inmate.g.visible = !!s;
    if (!s) return;
    const [e] = s;
    inmate.play(V(...e.at), e.yaw ?? 180, clips[e.clip].at((e.from ?? 0) + (t - e.t) * (e.rate ?? 1))); // rate 0: held on `from`
    gripL.set(0, 0, 0.12); hammer.localToWorld(gripL);
    inmate.grip("L", gripL);
  };

  // ---------- LEVER: the red master switch on a server-room wall, and the engineer whose hand pulls it
  const LV = SETS.lever, lw = [];
  for (let x = -3; x <= 3; x++) for (let y = 0; y <= 4; y++) lw.push({ id: y === 0 ? "polished_blackstone" : (x + y) % 3 ? "polished_blackstone_bricks" : "iron_block", pos: [LV.x + x, y, LV.z] });
  for (let x = -3; x <= 3; x++) for (let z = 1; z <= 4; z++) lw.push({ id: "smooth_stone", pos: [LV.x + x, -1, LV.z + z] });
  await blocks(lw, V(0, 0, 0));
  // the master switch: a hazard-framed plate on the wall, two guards either side of the pivot, and a red arm with a black
  // T grip that swings in front of the plate from up (ON) to down (OFF), never into the wall
  const plateTex = (() => {
    const c = document.createElement("canvas"); c.width = 48; c.height = 72;
    const g = c.getContext("2d");
    for (let i = -72; i < 120; i += 8) { g.fillStyle = (i / 8) % 2 ? "#1b1b1b" : "#e8b818"; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 80, 72); g.lineTo(i + 72, 72); g.fill(); }
    g.fillStyle = "#3a3d42"; g.fillRect(4, 4, 40, 64);
    g.fillStyle = "#2c2f33"; g.fillRect(20, 14, 8, 44); // the slot the arm swings along
    font.print(g, font.tinted("#e8e8e8"), "ON", 18, 6, 1);
    font.print(g, font.tinted("#e8e8e8"), "OFF", 15, 60, 1);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter;
    return t;
  })();
  const steel = lambert(await tex("block/iron_block"));
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.06), [steel, steel, steel, steel, lambert(plateTex), steel]);
  plate.position.set(LV.x + 0.5, 1.75, LV.z + 1.03);
  const dark = lambert(await tex("block/black_concrete"));
  const guards = [-1, 1].map((sd) => { const m = box(0.03, 0.14, 0.12, dark); m.position.set(LV.x + 0.5 + sd * 0.07, 1.75, LV.z + 1.12); return m; });
  const leverPivot = new THREE.Group();
  leverPivot.position.set(LV.x + 0.5, 1.75, LV.z + 1.16);
  const hub = box(0.11, 0.07, 0.07, dark);
  const stick = box(0.07, 0.42, 0.07, lambert(await tex("block/red_concrete")));
  stick.position.y = 0.21;
  const knob = box(0.26, 0.08, 0.08, dark);
  knob.position.y = 0.44;
  leverPivot.add(hub, stick, knob);
  scene.add(plate, ...guards, leverPivot);
  const alarm = lamp(0xff2a1a, 0, 9, V(LV.x - 1.5, 3.4, LV.z + 2));
  const leverKey = lamp(0xdfe8ff, 6, 8, V(LV.x + 2, 3, LV.z + 3.5));
  const leverAt = (t) => {
    const s = spanAt(story().lever, t), done = (story().lever ?? []).some((e) => t >= e.t + e.d && t < e.t + e.d + (e.hold ?? 6)); // down for `hold` s, then reset
    const k = s ? smooth(s[1] * 1.15) : done ? 1 : 0;
    leverPivot.rotation.x = 0.35 + (Math.PI - 0.7) * k; // up and a little out, over the top toward the camera, down and a little out
    alarm.intensity = keyAt(story().alarm, t)?.on ? 25 * (0.5 + 0.5 * Math.sin(t * 9)) : 0;
  };
  const engineer = await makeActor("steve", { shirt: "#d9dde0" }); // the OpenAI engineer: Steve in a white shirt
  const knobWorld = V(0, 0, 0);

  // ---------- TNT: under his floor's trap block (world.ts TRAP, its own block scene: loose.trap). story.tnt [{t, d}]:
  // the trap shakes, pops up and tips away at TNT_LIFT, the TNT rises flashing white in its hole (the game's primed TNT),
  // and at TNT_BLOW it goes off the way the game draws it: a flash, the explosion puffs (textures/particle/explosion_0..15,
  // grey, fullbright), black smoke rising (big_smoke), the floor around it gone (world.ts CRATER, loose.crater) and a few of
  // its blocks thrown as item-sized drops
  const TNT_LIFT = 0.3, TNT_BLOW = 0.8;
  const trapAt = V(TRAP[0] + 0.5, TRAP[1] + 0.5, TRAP[2] + 0.5); // the trap block's middle
  const tnt = await blocks([{ id: "tnt", pos: [0, 0, 0] }], V(TRAP[0], TRAP[1] - 1, TRAP[2]), [jar]);
  const tntWhite = box(1.02, 1.02, 1.02, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
  scene.add(tntWhite);
  const lid = new THREE.Group(); // the trap block on a pivot at its middle, so it can tip over
  lid.position.copy(trapAt);
  scene.add(lid);
  lid.attach(loose.trap);
  const dropTex = await Promise.all(["cobblestone", "mossy_cobblestone", "gravel", "stone"].map((n) => tex(`block/${n}`)));
  const DROPS = 10;
  const drops = Array.from({ length: DROPS }, (_, i) => { const m = box(0.22, 0.22, 0.22, lambert(dropTex[i % dropTex.length])); scene.add(m); return m; });
  const frames = async (name, n) => Promise.all(Array.from({ length: n }, (_, i) => tex(`particle/${name}_${i}`)));
  const boomFrames = await frames("explosion", 16), smokeFrames = await frames("big_smoke", 12);
  const sprites = (n, map, extra = {}) => Array.from({ length: n }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, ...extra })); scene.add(s); return s; });
  const PUFFS = 14, SMOKES = 9;
  const puffs = sprites(PUFFS, boomFrames[0]), smokes = sprites(SMOKES, smokeFrames[0]);
  const [fireball] = sprites(1, await tex("particle/flash"), { blending: THREE.AdditiveBlending, color: 0xffb35a });
  const boomLight = lamp(0xffa850, 0, 14, trapAt.clone().setY(0.9));
  const tntOf = (t) => (story().tnt ?? []).find((e) => t >= e.t && t < e.t + e.d);
  const tntAt = (t) => {
    const e = tntOf(t), s = e ? t - e.t : -1;
    // shakes, then pops up and tips over away from the hole (-x), gone in the blast
    const up = s >= TNT_LIFT ? s - TNT_LIFT : -1;
    lid.position.copy(trapAt);
    lid.rotation.set(0, 0, 0);
    if (s >= 0 && s < TNT_LIFT) lid.position.y += 0.01 + 0.025 * rnd(Math.floor(t * 30), 5);
    if (up >= 0) { lid.position.add(V(-0.9 * up, Math.max(0, 2.6 * up - 4.9 * up * up), -0.3 * up)); lid.rotation.set(0, 0.4 * up, 4.2 * up); }
    lid.visible = s < TNT_BLOW;
    const primed = s >= TNT_LIFT && s < TNT_BLOW;
    tnt.visible = primed;
    tnt.position.set(TRAP[0] + 0.5, TRAP[1] - 0.5 + 0.7 * smooth((s - TNT_LIFT) / 0.3), TRAP[2] + 0.5);
    tntWhite.position.copy(tnt.position);
    tntWhite.visible = primed && Math.floor((s - TNT_LIFT) / 0.08) % 2 === 0;
    const b = s >= TNT_BLOW ? s - TNT_BLOW : -1;
    loose.crater.visible = b < 0;
    boomLight.intensity = b >= 0 ? 70 * Math.exp(-b * 7) : 0;
    fireball.visible = b >= 0 && b < 0.18;
    if (fireball.visible) { fireball.position.copy(trapAt).setY(0.5); fireball.scale.setScalar(1.5 + b * 14); fireball.material.opacity = 1 - b / 0.18; }
    drops.forEach((m, i) => {
      m.visible = b >= 0;
      if (!m.visible) return;
      const a = rnd(i, 11) * 6.28, sp = 0.8 + rnd(i, 12) * 1.6, vy = 2.5 + rnd(i, 13) * 2.0;
      const air = (2 * vy) / 9.8, tt = Math.min(b, air); // up, down to the floor, then it lies there
      m.position.set(trapAt.x + Math.cos(a) * sp * tt, Math.max(0.11, 0.2 + vy * tt - 4.9 * tt * tt), trapAt.z + Math.sin(a) * sp * tt);
      m.rotation.set(tt * 8 * rnd(i, 15), tt * 6, tt * 5 * rnd(i, 16));
    });
    puffs.forEach((p, i) => {
      const life = 0.4 + rnd(i, 21) * 0.4, age = b - rnd(i, 22) * 0.2;
      p.visible = b >= 0 && age >= 0 && age < life;
      if (!p.visible) return;
      const a = rnd(i, 23) * 6.28, r = rnd(i, 24) * 1.4;
      p.position.set(trapAt.x + Math.cos(a) * r, 0.2 + rnd(i, 25) * 1.2, trapAt.z + Math.sin(a) * r);
      p.scale.setScalar(0.7 + rnd(i, 26) * 0.7);
      p.material.map = boomFrames[Math.min(6, Math.floor((age / life) * 7))]; // the puff part only: the late frames are a thin ring
      p.material.opacity = 1 - 0.6 * (age / life);
      p.material.color.setScalar(0.42 + rnd(i, 27) * 0.2); // the game shades each puff a random grey; darker here, the cell is dim
    });
    smokes.forEach((p, i) => {
      const age = b - 0.08 - rnd(i, 31) * 0.25, life = 2.5;
      p.visible = b >= 0 && age >= 0 && age < life;
      if (!p.visible) return;
      const a = rnd(i, 33) * 6.28, r = 0.2 + rnd(i, 34) * 0.9;
      p.position.set(trapAt.x + Math.cos(a) * r, 0.3 + age * (0.5 + rnd(i, 35) * 0.4), trapAt.z + Math.sin(a) * r);
      p.scale.setScalar(1.2 + age * 0.8);
      p.material.map = smokeFrames[Math.min(11, Math.floor((age / life) * 12))];
      p.material.color.setScalar(0.16 + rnd(i, 36) * 0.1);
      p.material.opacity = 0.85 * (1 - age / life);
    });
  };

  // ---------- INSERT: a page on a dark desk, in the game's own book picture and font
  const I = SETS.insert;
  const desk = box(2.4, 0.1, 1.6, lambert(await tex("block/dark_oak_planks")));
  desk.position.set(I.x, 0.95, I.z);
  scene.add(desk);
  const bookImg = await tex("gui/book");
  const pageCanvas = document.createElement("canvas"); pageCanvas.width = 292; pageCanvas.height = 360;
  const pageTex = new THREE.CanvasTexture(pageCanvas);
  pageTex.colorSpace = THREE.SRGBColorSpace; pageTex.magFilter = THREE.NearestFilter;
  const page = new THREE.Mesh(new THREE.PlaneGeometry(0.73, 0.9), new THREE.MeshLambertMaterial({ map: pageTex, transparent: true, alphaTest: 0.3 }));
  page.rotation.x = -Math.PI / 2;
  page.position.set(I.x, 1.006, I.z);
  scene.add(page);
  const insertLamp = lamp(0xffd7a0, 5, 4, V(I.x - 0.6, 2.0, I.z + 0.7));
  let pageShown = null;
  const paintPage = (id) => {
    if (pageShown === id) return;
    pageShown = id;
    const pg = P().pages?.[id] ?? { lines: [id ?? ""] }, g = pageCanvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 292, 360);
    g.drawImage(bookImg.image, 20, 1, 146, 180, 0, 0, 292, 360); // the written-book page (u 20-166, v 1-181), doubled
    const ink = font.tinted(pg.ink ?? "#1f1a14");
    (pg.lines ?? []).forEach((l, i) => font.print(g, ink, l, 32, 58 + i * 22, 2));
    pageTex.needsUpdate = true;
  };

  // ---------- HALL: the treasure (gold, diamonds, emeralds, old magic books); CELLAR: five barrels; DEPOT: the bot
  const H = SETS.hall, hall = [], hallGlow = [];
  for (let x = -8; x <= 8; x++) for (let z = -14; z <= 4; z++) {
    hall.push({ id: (x + z) % 2 ? "polished_diorite" : "smooth_quartz", pos: [H.x + x, -1, H.z + z] });
    if (Math.abs(x) === 8) for (let y = 0; y <= 6; y++) hall.push({ id: y % 3 === 1 ? "bookshelf" : "quartz_bricks", pos: [H.x + x, y, H.z + z] });
  }
  for (let i = 0; i < 46; i++) {
    const side = i % 2 ? 1 : -1, x = side * (3 + Math.floor(rnd(i) * 4)), z = -13 + Math.floor(rnd(i, 2) * 16), h = Math.floor(rnd(i, 3) * 3);
    for (let y = 0; y <= h; y++) hall.push({ id: ["gold_block", "gold_block", "diamond_block", "emerald_block", "raw_gold_block"][Math.floor(rnd(i, 4 + y) * 5)], pos: [H.x + x, y, H.z + z] });
  }
  for (const z of [-12, -6, 0]) for (const x of [-7, 7]) hallGlow.push({ id: "lantern", pos: [H.x + x, 3, H.z + z] });
  await blocks(hall, V(0, 0, 0));
  await blocks(hallGlow, V(0, 0, 0), jar);
  const hallLamp = lamp(0xffdc9a, 40, 30, V(H.x, 6, H.z - 5));
  const CE = SETS.cellar, cel = [];
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
    cel.push({ id: "cobbled_deepslate", pos: [CE.x + x, -1, CE.z + z] });
    if (Math.abs(x) === 4 || z === -4) for (let y = 0; y <= 3; y++) cel.push({ id: (x * z + y) % 3 ? "mossy_stone_bricks" : "cracked_stone_bricks", pos: [CE.x + x, y, CE.z + z] });
  }
  for (let i = -2; i <= 2; i++) cel.push({ id: "barrel", pos: [CE.x + i * 1.0 * 1, 0, CE.z - 2], properties: { facing: "up", open: "false" } });
  for (const [x, y, z] of [[-3, 3, -3], [3, 3, -3], [-3, 2, -3], [2, 3, -2], [-1, 3, -3]]) cel.push({ id: "cobweb", pos: [CE.x + x, y, CE.z + z] });
  await blocks(cel, V(0, 0, 0));
  const cellarLamp = lamp(0x9fd0ff, 3, 8, V(CE.x + 1, 2.6, CE.z + 1));
  const D = SETS.depot, dep = [];
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
    dep.push({ id: "polished_andesite", pos: [D.x + x, -1, D.z + z] });
    if (Math.abs(x) === 7 || z === -7) for (let y = 0; y <= 5; y++) dep.push({ id: y === 2 ? "iron_block" : "stone_bricks", pos: [D.x + x, y, D.z + z] });
  }
  await blocks(dep, V(0, 0, 0));
  const depotLamp = lamp(0xffe7c2, 25, 22, V(D.x + 2, 5, D.z + 2));
  const bot = new THREE.Group();
  const worker = await makeActor("steve", { shirt: "#ffd21e" }); // Hugging Face's warehouse worker: Steve in their yellow
  worker.place(V(0, 0, 0), 0, "still");
  bot.add(worker.g);
  bot.position.set(D.x + 2.2, 0, D.z + 1.0);
  scene.add(bot);
  const botAt = (t) => { const r = story().robot, k = r ? smooth((t - r.fall) / 0.7) : 0; bot.rotation.set(-1.45 * k, -0.6, 0); };

  // ---------- THE HACK: a steel service box on the north wall under the desk (BOX), the cable from it down into the floor
  // and on along the conduit behind the shelf, under the firewall, out to Hugging Face (CABLE), and the pulse that runs it.
  //   story.box [{t, lid}]: "on" closed, "pry" the crowbar's lip in its seam (the lid gapes and shudders), "off" it falls
  //     to the floor in front of the box and lies there; a key with no lid puts it back on
  //   story.wire [{t, mode}]: the two red wires inside: "buzz" (a low red flicker), "hot" (joined: bright red), "cyan" (the
  //     pulse leaving), anything else dark
  //   story.pulse [{t, d, path, back}]: a cyan pulse along CABLE[path] (room, conduit, depot), from its start (or end, back)
  //   story.bar [{t, on}]: the crowbar in Steve's right hand
  //   a wire key's `to` pulls the two red wires out of the box to that point: the joint in his hand
  const BOXC = V(DESK.crt + 0.5, 0.37, 0.15), BW = 0.6, BH = 0.5, BD = 0.3; // the box's middle, its width, height, depth
  const steelDark = lambert(await tex("block/iron_block"), { color: 0x7c8088 });
  const svc = new THREE.Group();
  svc.position.copy(BOXC);
  for (const [w, h, d, x, y, z] of [[BW, BH, 0.02, 0, 0, -BD / 2 + 0.01], [BW, 0.03, BD, 0, BH / 2, 0], [BW, 0.03, BD, 0, -BH / 2, 0], [0.03, BH, BD, -BW / 2, 0, 0], [0.03, BH, BD, BW / 2, 0, 0]]) {
    const m = box(w, h, d, steelDark); m.position.set(x, y, z); svc.add(m);
  }
  const blackRubber = new THREE.MeshLambertMaterial({ map: await tex("block/black_concrete"), emissive: 0x30d8ff, emissiveIntensity: 0 }); // lit cyan by the pulse
  for (const dx of [-0.13, 0, 0.13]) { const c = box(0.05, BH + 0.37, 0.05, blackRubber); c.position.set(dx, -0.18, -0.06); svc.add(c); } // top to the floor
  const wireMat = new THREE.MeshLambertMaterial({ map: await tex("block/red_concrete"), emissive: 0xff2010, emissiveIntensity: 0 });
  const wires = [[-0.07, 0.6], [0.07, -0.6]].map(([dx, rz]) => { const w = box(0.025, 0.2, 0.025, wireMat); w.position.set(dx, 0.02, 0.02); w.rotation.z = rz; svc.add(w); return w; });
  const leads = [-1, 1].map(() => { const m = box(0.022, 0.022, 1, wireMat); scene.add(m); return m; });
  const svcGlow = new THREE.PointLight(0xff3020, 0, 1.6, 2);
  svcGlow.position.set(0, 0, 0.1);
  svc.add(svcGlow);
  scene.add(svc);
  const grate = await tex("block/iron_trapdoor");
  const boxLid = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.02, BH + 0.02, 0.025), lambert(grate, { transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
  scene.add(boxLid);
  const crowbar = new THREE.Group();
  const barMat = lambert(await tex("block/red_concrete"), { color: 0x9a3a30 });
  const shaft = box(0.035, 0.035, 0.62, barMat); shaft.position.z = 0.22;
  const claw = box(0.035, 0.12, 0.035, barMat); claw.position.set(0, -0.045, 0.52);
  crowbar.add(shaft, claw);
  crowbar.visible = false;
  let barOn = null;
  const boxAt = (t, steve) => {
    const k = keyAt(story().box, t), lidState = k?.lid ?? "on", s = k ? t - k.t : 0;
    boxLid.position.set(BOXC.x, BOXC.y, BOXC.z + BD / 2 + 0.013);
    boxLid.rotation.set(0, 0, 0);
    if (lidState === "pry") { boxLid.rotation.set(-0.05 - 0.04 * rnd(Math.floor(t * 20), 7), 0, 0.03 * Math.sin(t * 40)); boxLid.position.z += 0.02; }
    if (lidState === "off") {
      const f = clamp01(s / 0.4); // tips forward off its hinge-less seam and slaps flat on the stone
      boxLid.position.set(BOXC.x + 0.05 * f, BOXC.y + (0.013 - BOXC.y) * f * f, BOXC.z + BD / 2 + 0.013 + 0.28 * f);
      boxLid.rotation.set(-Math.PI / 2 * f * f, 0, 0.2 * f);
    }
    const wk = keyAt(story().wire, t), w = wk?.mode, flick = 0.5 + 0.5 * rnd(Math.floor(t * 24), 9);
    const glow = w === "buzz" ? 0.6 * flick : w === "hot" ? 2.2 + flick : w === "cyan" ? 0.9 : 0;
    blackRubber.emissiveIntensity = w === "cyan" ? 0.35 + 0.25 * flick : 0;
    wireMat.emissiveIntensity = glow;
    wireMat.emissive.setHex(w === "cyan" ? 0x30e8ff : 0xff2010);
    svcGlow.color.setHex(w === "cyan" ? 0x40e0ff : 0xff3020);
    svcGlow.intensity = glow * (w === "cyan" ? 0.15 : 1.6);
    leads.forEach((m, i) => {
      m.visible = !!wk?.to;
      if (!m.visible) return;
      const a = V(BOXC.x + (i ? 0.07 : -0.07), BOXC.y + 0.02, BOXC.z + 0.05), b = V(...wk.to).add(V(i ? 0.012 : -0.012, 0, 0));
      m.scale.z = a.distanceTo(b); m.position.copy(a).lerp(b, 0.5); m.lookAt(b);
    });
    const b = keyAt(story().bar, t)?.on ?? false;
    if (b !== barOn) { barOn = b; if (b) steve.hand.add(crowbar); else crowbar.removeFromParent(); crowbar.visible = b; }
  };
  // the cable's runs, as points; the conduit's floor follows world.ts RAIL_Y and dives under the firewall's footing
  const fy = RAIL_Y(TUNNEL.fire), D0 = SETS.depot;
  const CABLE = {
    room: [[BOXC.x, BOXC.y, BOXC.z - 0.06], [BOXC.x, 0.02, BOXC.z - 0.06], [BOXC.x, -0.8, BOXC.z - 0.06]],
    conduit: [[0.5, 0.04, -1.6], [0.5, 0.04, -2.95], [0.5, -0.96, -3.05], [0.5, -0.96, -3.95], [0.5, -1.96, -4.05], [0.5, -1.96, -4.95], [0.5, -2.96, -5.05],
      [0.5, fy + 0.04, TUNNEL.fire + 1.4], [0.5, fy - 0.5, TUNNEL.fire + 1.1], [0.5, fy - 0.5, TUNNEL.fire - 0.1], [0.5, fy + 0.04, TUNNEL.fire - 0.4], [0.5, fy + 0.04, TUNNEL.end + 0.5]],
    depot: [[D0.x + 0.5, 0.04, D0.z - 6.6], [D0.x + 0.5, 0.04, D0.z - 0.4]],
  };
  const cableMat = lambert(await tex("block/black_concrete"));
  for (const [name, pts] of Object.entries(CABLE)) if (name !== "room") for (let i = 1; i < pts.length; i++) {
    const a = V(...pts[i - 1]), b = V(...pts[i]), len = a.distanceTo(b);
    const m = box(0.07, 0.07, len, cableMat);
    m.position.copy(a).lerp(b, 0.5); m.lookAt(b);
    scene.add(m);
  }
  const pathAt = (pts, u) => { // the point a share u of the way along a polyline
    const segs = pts.slice(1).map((p, i) => V(...pts[i]).distanceTo(V(...p))), total = segs.reduce((x, y) => x + y, 0);
    let d = clamp01(u) * total;
    for (let i = 0; i < segs.length; i++) { if (d <= segs[i]) return V(...pts[i]).lerp(V(...pts[i + 1]), d / segs[i]); d -= segs[i]; }
    return V(...pts.at(-1));
  };
  const PULSE_N = 6;
  const pulseMat = new THREE.MeshBasicMaterial({ color: 0x7ff4ff, toneMapped: false, transparent: true });
  const pulseBits = Array.from({ length: PULSE_N }, () => { const m = box(0.13, 0.13, 0.13, pulseMat.clone()); scene.add(m); return m; });
  const pulseLight = new THREE.PointLight(0x40e0ff, 0, 3.5, 1.8);
  scene.add(pulseLight);
  const pulseAt = (t) => {
    const p = spanAt(story().pulse, t);
    pulseLight.intensity = !p ? 0 : p[0].path === "room" ? 2.5 : 10; // under the desk it is close to everything; in the tunnels it has to carry
    pulseBits.forEach((m, i) => {
      m.visible = !!p;
      if (!p) return;
      const [e, u] = p, k = clamp01(u - i * 0.012); // a short comet: the head, then a fading tail
      const pos = pathAt(CABLE[e.path], e.back ? 1 - k : k);
      m.position.copy(pos);
      m.material.opacity = 1 - i / PULSE_N;
      if (!i) pulseLight.position.copy(pos);
    });
  };
  // ---------- the printer's strip: story.strip [{t, d, mode}]: "print" grows it out of the trace printer's slot over d
  // and down over the desk's edge, "held" hangs it in front of him at `at` turned `ry`, anything else hides it
  const stripCanvas = document.createElement("canvas"); stripCanvas.width = 64; stripCanvas.height = 224;
  {
    const g = stripCanvas.getContext("2d");
    g.fillStyle = "#ece8dc"; g.fillRect(0, 0, 64, 224);
    const ink = font.tinted("#2a2620"), red = font.tinted("#b0201a");
    font.print(g, ink, "LEAKED 14", 6, 4, 1);
    for (let i = 0; i < 14; i++) {
      const id = Array.from({ length: 5 }, (_, j) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(rnd(i * 7 + j, 41) * 31)]).join("");
      font.print(g, i === 6 ? red : ink, `${String(i + 1).padStart(2, "0")} hf_${id}${i === 6 ? " W" : ""}`, 3, 18 + i * 14, 1);
    }
  }
  { // turned end over end: the last line leaves the slot first, so the strip reads upright from in front of the desk
    const c = document.createElement("canvas"); c.width = 64; c.height = 224;
    const g = c.getContext("2d"); g.translate(64, 224); g.rotate(Math.PI); g.drawImage(stripCanvas, 0, 0);
    stripCanvas.getContext("2d").drawImage(c, 0, 0);
  }
  const stripTex = new THREE.CanvasTexture(stripCanvas); stripTex.colorSpace = THREE.SRGBColorSpace; stripTex.magFilter = THREE.NearestFilter;
  const SW = 0.3, SL = 1.05; // the strip's width and full length
  const stripFlat = new THREE.Mesh(new THREE.PlaneGeometry(SW, 1), new THREE.MeshLambertMaterial({ map: stripTex.clone(), side: THREE.DoubleSide }));
  const stripHang = new THREE.Mesh(new THREE.PlaneGeometry(SW, 1), new THREE.MeshLambertMaterial({ map: stripTex.clone(), side: THREE.DoubleSide }));
  const stripHeld = new THREE.Mesh(new THREE.PlaneGeometry(SW, SL), new THREE.MeshLambertMaterial({ map: stripTex, side: THREE.DoubleSide }));
  for (const m of [stripFlat, stripHang]) m.material.map.needsUpdate = true;
  scene.add(stripFlat, stripHang, stripHeld);
  const SLOT = { x: DESK.printer + 0.5, y: 1.012, z: 0.63 }, EDGE = 1.0; // where the paper leaves the printer; the desk's front edge
  const stripAt = (t) => {
    const k = keyAt(story().strip, t);
    stripFlat.visible = stripHang.visible = stripHeld.visible = false;
    if (k?.mode === "print") {
      const L = SL * clamp01((t - k.t) / k.d), flat = Math.min(L, EDGE - SLOT.z), hang = Math.max(0, L - flat);
      const show = (m, len, v0) => { m.visible = len > 0.001; m.scale.y = Math.max(len, 0.001); m.material.map.repeat.set(1, len / SL); m.material.map.offset.set(0, 1 - (v0 + len) / SL); };
      // the leading end goes out first: it hangs over the edge, the lines printed last lie flat by the slot
      show(stripFlat, flat, hang);
      stripFlat.rotation.set(-Math.PI / 2, 0, Math.PI); stripFlat.position.set(SLOT.x, SLOT.y, SLOT.z + flat / 2);
      show(stripHang, hang, 0);
      stripHang.rotation.set(0, 0, Math.PI); stripHang.position.set(SLOT.x, SLOT.y - hang / 2, EDGE + 0.004);
    }
    if (k?.mode === "held") { stripHeld.visible = true; stripHeld.position.set(...k.at); stripHeld.rotation.set(k.pitch ?? 0, k.ry ?? 0, Math.PI); }
  };
  // ---------- the trapped chest at the end of the depot's cable (gohans:trapped_chest + _lid), its front to the bot (+x);
  // the lid lifts at story.robot.open
  const chest = await blocks([{ id: "gohans:trapped_chest", pos: [0, 0, 0] }], V(D0.x, 0, D0.z));
  chest.rotation.y = -Math.PI / 2;
  const chestLid = new THREE.Group();
  chestLid.rotation.order = "YXZ"; // opens about its own hinge, after the turn
  // hinged on the chest's back top edge (model z 15, y 9; the back is -x once turned)
  chestLid.position.set(D0.x + 0.5 - 7 / 16, 9 / 16, D0.z + 0.5);
  chestLid.rotation.y = -Math.PI / 2;
  const lidBlock = await blocks([{ id: "gohans:trapped_chest_lid", pos: [0, 0, 0] }], V(0, 0, 0));
  lidBlock.position.set(0, 0.5 - 9 / 16, 0.5 - 15 / 16);
  chestLid.add(lidBlock);
  scene.add(chestLid);
  const chestGlow = lamp(0x40e0ff, 0, 4, V(D0.x + 0.5, 1.0, D0.z + 0.5));
  const chestAt = (t) => {
    const r = story().robot;
    chest.visible = chestLid.visible = !!keyAt(story().chest, t)?.on; // it arrives with the exploit (s10)
    chestLid.rotation.x = r ? 1.1 * smooth((t - r.open) / 0.5) : 0;
    const hit = (story().pulse ?? []).find((e) => e.path === "depot" && t >= e.t + e.d * 0.9 && t < e.t + e.d + 1.2);
    chestGlow.intensity = hit ? 10 * (1 - (t - hit.t - hit.d) / 1.2) : 0;
  };

  // ---------- particles: sparks, smoke, dust, glass (one Points each, positions computed from t, no state)
  const pts = (n, color, size, blend = THREE.AdditiveBlending) => {
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    const m = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: sprite, transparent: true, depthWrite: false, blending: blend, toneMapped: blend !== THREE.AdditiveBlending }));
    m.frustumCulled = false; scene.add(m); return m;
  };
  const sparks = pts(260, 0xffa64a, 0.05), smoke = pts(90, 0x4a4644, 0.9, THREE.NormalBlending), dust = pts(300, 0x9a948a, 0.03, THREE.NormalBlending);
  const glass = pts(220, 0xbfe3ff, 0.035), bugs = pts(400, 0xc04dff, 0.06), papers = [];
  const burst = (m, list, t, fn) => {
    const a = m.geometry.attributes.position, n = a.count, s = spanAt(list, t);
    for (let i = 0; i < n; i++) { const p = s ? fn(i, s[0], t - s[0].t, s[1]) : null; if (p) a.setXYZ(i, p.x, p.y, p.z); else a.setXYZ(i, 0, -9999, 0); }
    a.needsUpdate = true;
  };
  const paperMat = new THREE.MeshLambertMaterial({ map: await tex("item/paper"), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
  const paperMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.2), paperMat, 260);
  paperMesh.frustumCulled = false;
  scene.add(paperMesh);
  // books and loose pages strewn on the cell floor by the mailbox (story.books: how many books lie there from t, a page
  // or two thrown out of each): cloth covers in four colours over cream page edges, the pages plain ruled paper
  const COVERS = [0x6e2a20, 0x2e4630, 0x2a3450, 0x6a4a2c], BOOKS = 40;
  const pageEdge = new THREE.MeshLambertMaterial({ color: 0xe6dcc0 });
  const bookMeshes = COVERS.map((c) => {
    const cover = new THREE.MeshLambertMaterial({ color: c });
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.05, 0.28), [pageEdge, cover, cover, cover, pageEdge, pageEdge], BOOKS);
    m.castShadow = m.receiveShadow = true; m.count = 0; scene.add(m); return m;
  });
  const leafTex = (() => {
    const c = document.createElement("canvas"); c.width = 32; c.height = 44;
    const g = c.getContext("2d"); g.fillStyle = "#ece6d6"; g.fillRect(0, 0, 32, 44);
    g.fillStyle = "#b8b2a4"; for (let y = 8; y < 42; y += 4) g.fillRect(3, y, 26, 1);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
  })();
  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.21, 0.29), new THREE.MeshLambertMaterial({ map: leafTex, side: THREE.DoubleSide }), BOOKS * 2);
  leaves.receiveShadow = true; leaves.count = 0; scene.add(leaves);
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const bookAt = (i) => { const r = Math.sqrt(rnd(i, 9)) * 1.3, a = -0.3 + rnd(i, 8) * 1.9; return V(0.45 + Math.cos(a) * r, 0, 0.55 + Math.sin(a) * r); };
  for (let i = 0; i < BOOKS; i++) {
    const at = bookAt(i), open = rnd(i, 5) < 0.3; // some lie open, tipped on a spine
    M4.compose(at.clone().setY(0.025 + Math.floor(rnd(i, 7) * 2) * 0.05), Q.setFromEuler(E.set(0, rnd(i, 6) * 6, open ? 0.25 : 0)), V(1, 1, 1));
    bookMeshes[i % COVERS.length].setMatrixAt(Math.floor(i / COVERS.length), M4);
    for (let k = 0; k < 2; k++) {
      const a = rnd(i * 2 + k, 13) * 6.28, d = 0.2 + rnd(i * 2 + k, 14) * 0.45;
      leaves.setMatrixAt(i * 2 + k, M4.compose(V(at.x + Math.cos(a) * d, 0.004 + k * 0.002, at.z + Math.sin(a) * d), Q.setFromEuler(E.set(-Math.PI / 2 + (rnd(i, 15) - 0.5) * 0.2, 0, rnd(i * 2 + k, 16) * 6)), V(1, 1, 1)));
    }
  }
  // the answer scrap (gohans:paper_scrap) on the desk
  const scrap = await blocks([{ id: "gohans:paper_scrap", pos: [0, 0, 0] }], V(0, 0, 0));
  // the chair
  const chair = new THREE.Group();
  const k = (CHAIR.seat * 16) / CHAIR.model.seat;
  const seatG = await blocks([{ id: CHAIR.id, pos: [0, 0, 0], properties: { facing: "north" } }], V(-0.5, 0, -0.5));
  const chairLook = new THREE.Group(); chairLook.add(seatG); seatG.position.set(0, 0.5, 0);
  chairLook.scale.setScalar(k);
  chairLook.position.set(0, 0, (-k * (CHAIR.model.back - 8)) / 16);
  chair.add(chairLook);
  chair.position.set(CHAIR.x, 0, CHAIR.z);
  scene.add(chair);
  seatG.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // ---------- the ghosts: Steve's mind (a see-through second Steve) and the army behind him
  const ghost = await makeActor("steve", { ghost: true });
  const fig = (() => { // a player's blocks, 1.8 m: legs, body, arms, head
    const parts = [[0.25, 0.75, 0.25, -0.125, 0.375], [0.25, 0.75, 0.25, 0.125, 0.375], [0.5, 0.75, 0.25, 0, 1.125], [0.25, 0.75, 0.25, -0.375, 1.125], [0.25, 0.75, 0.25, 0.375, 1.125], [0.5, 0.5, 0.5, 0, 1.75]];
    const gs = parts.map(([w, h, d, x, y]) => new THREE.BoxGeometry(w, h, d).translate(x, y, 0));
    return gs;
  })();
  const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const army = new THREE.InstancedMesh(mergeGeometries(fig), new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.36, depthWrite: false }), 700);
  army.frustumCulled = false;
  scene.add(army);
  const armyAt = (t) => {
    const s = keyAt(story().army, t);
    for (let i = 0; i < 700; i++) {
      if (!s || i >= (s.n ?? 700) || (s.until != null && t > s.until)) { army.setMatrixAt(i, M4.makeScale(0, 0, 0)); continue; }
      const row = Math.floor(i / 14), col = i % 14, u = clamp01((t - s.t) / s.d);
      const a = V(...s.from), b = V(...s.to), dir = b.clone().sub(a).normalize(), side = V(-dir.z, 0, dir.x);
      const p = a.clone().lerp(b, u).addScaledVector(dir, -row * 1.1 - rnd(i) * 0.6).addScaledVector(side, (col - 6.5) * (s.spread ?? 0.9) + rnd(i, 1) * 0.3);
      army.setMatrixAt(i, M4.compose(p, Q.setFromEuler(E.set(0, Math.atan2(dir.x, dir.z), 0)), V(1, 1, 1)));
    }
    army.instanceMatrix.needsUpdate = true;
  };

  // ---------- the CRT's states (props.json story.crt: lines from t on, in a phosphor) and its break
  const screens = {};
  for (const ph of ["green", "red", "amber"]) {
    let cur = { on: 0, lines: [] };
    const sc = buildScreen(font, { at: [DESK.crt, 1, DESK.z], facing: "south", phosphor: ph, keys: () => cur, power: () => 1.3 });
    sc.glass.position.z += 0.0004; // over the blue one
    scene.add(sc.glass, sc.glow);
    screens[ph] = { sc, set: (k) => { cur = k; } };
  }

  // ---------- HUD: cards in front of the camera (title, chapters, date stamps, the epilogue) and black / fades
  const hudCanvas = document.createElement("canvas"); hudCanvas.width = 1920; hudCanvas.height = 1080;
  const hudTex = new THREE.CanvasTexture(hudCanvas); hudTex.colorSpace = THREE.SRGBColorSpace;
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  hud.renderOrder = 999;
  camera.add(hud);
  let hudKey = null;
  const paintHud = (key, black, cards) => {
    if (key === hudKey) return;
    hudKey = key;
    const g = hudCanvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 1920, 1080);
    if (black > 0) { g.fillStyle = `rgba(0,0,0,${black})`; g.fillRect(0, 0, 1920, 1080); }
    for (const [c, a] of cards) {
      const lines = c.text.split("\n"), kind = c.kind ?? "title";
      const sc = kind === "title" ? 9 : kind === "chapter" ? 6 : 4;
      const col = kind === "stamp" ? "#d9d9d9" : c.color ?? "#f2f2f2";
      const ink = font.tinted(col);
      g.globalAlpha = a;
      lines.forEach((l, i) => {
        const w = font.lineW(l) * sc, y = kind === "stamp" ? 960 + i * 11 * sc : 540 - (lines.length * 11 * sc) / 2 + i * 11 * sc * (kind === "epilogue" ? 1.6 : 1.2);
        font.print(g, ink, l, kind === "stamp" ? 90 : (1920 - w) / 2, y, sc);
      });
      g.globalAlpha = 1;
    }
    hudTex.needsUpdate = true;
  };
  const hudAt = (t) => {
    const St = story();
    let black = 0;
    for (const [a, b] of St.black ?? []) if (t >= a && t < b) black = 1;
    const f = spanAt(St.fade, t);
    if (f) black = Math.max(black, f[0].out ? f[1] : 1 - f[1]);
    for (const e of St.fade ?? []) if (e.out && e.hold && t >= e.t + e.d && t < e.t + e.d + e.hold) black = 1;
    const cards = [];
    for (const c of St.cards ?? []) if (t >= c.t && t < c.t + c.d) {
      const a = Math.min(1, (t - c.t) / 0.35, (c.t + c.d - t) / 0.35);
      cards.push([c, a]);
      if (c.kind !== "stamp") black = Math.max(black, c.over ? black : 1);
    }
    paintHud(`${black.toFixed(2)}|${cards.map(([c, a]) => c.text + a.toFixed(2)).join()}`, black, cards);
    const d = camera.near * 1.5, h = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    hud.position.set(0, 0, -d); hud.scale.set(h * camera.aspect, h, 1);
    hud.visible = black > 0 || cards.length > 0;
  };

  // ---------- Steve's dissolve: pixel by pixel of his skin, keyed story.dissolve {t, d}
  const noise = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const v = 1 + Math.floor(rnd(x + y * 64, 3) * 254); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1); } const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; return t; })();
  const dissolveMats = [];
  const dissolveOf = (g) => g.traverse((o) => { if (o.isMesh) for (const m of [o.material].flat()) { m.alphaMap = noise; m.alphaTest = 0.0001; m.needsUpdate = true; dissolveMats.push(m); } });

  const anchors = { lever: () => knobWorld.clone() };
  let dissolveReady = false;
  const drawStory = (t, { steve }) => {
    const St = story();
    if (!dissolveReady) { dissolveOf(steve.g); dissolveReady = true; }
    hammerAt(t); leverAt(t); tntAt(t); boxAt(t, steve); pulseAt(t); stripAt(t); chestAt(t); botAt(t); armyAt(t);
    knob.getWorldPosition(knobWorld);
    // the engineer: stands at the lever, his right hand on its knob while it is being pulled
    const en = keyAt(St.engineer, t);
    engineer.g.visible = !!en?.at;
    if (en?.at) engineer.reach(V(...en.at), en.yaw ?? 180, anchors.lever(), t);
    const gh = keyAt(St.ghost, t);
    ghost.g.visible = !!gh?.at;
    if (gh?.at) ghost.place(V(...gh.at), gh.yaw ?? 0, gh.pose ?? "stand", gh.look ? V(...gh.look) : null);
    // insert page
    const ins = keyAt(St.insert, t);
    if (ins?.page) paintPage(ins.page);
    // CRT overrides
    const cr = keyAt(St.crt, t);
    for (const [ph, s] of Object.entries(screens)) {
      const on = cr && cr.phosphor === ph && !cr.off;
      if (on) s.set({ on: cr.t, lines: cr.lines, clock: cr.clock });
      s.sc.draw(t);
      s.sc.glass.visible = on && s.sc.glass.visible;
      if (!on) s.sc.glow.intensity = 0;
      if (on && St.glitch?.some(([a, b]) => t >= a && t < b)) { s.sc.glass.position.x = DESK.crt + 0.5 + (rnd(Math.floor(t * 30)) - 0.5) * 0.03; s.sc.glass.scale.y = 0.85 + rnd(Math.floor(t * 30), 2) * 0.3; }
      else { s.sc.glass.position.x = DESK.crt + 0.5; s.sc.glass.scale.y = 1; }
    }
    const blueOff = !!(cr && (!cr.off || cr.dead)); // dead: the burst tube shows nothing, not the idle blue screen
    // floor books, scrap, chair
    const nb = keyAt(St.books, t)?.n ?? 0;
    bookMeshes.forEach((m, k) => { m.count = Math.max(0, Math.ceil((nb - k) / COVERS.length)); });
    leaves.count = nb * 2;
    const sk = keyAt(St.scrap, t);
    scrap.visible = !!sk?.at;
    if (sk?.at) { scrap.position.set(sk.at[0] + 0.5, sk.at[1] + 0.5, sk.at[2] + 0.5); scrap.rotation.y = sk.ry ?? 0; }
    const ch = keyAt(St.chair, t);
    chair.position.set(CHAIR.x + (ch?.dx ?? 0), 0, CHAIR.z + (ch?.dz ?? 0));
    chair.rotation.set(ch?.toppled ? -Math.PI / 2 : 0, ch?.yaw ?? 0, 0);
    if (ch?.toppled) chair.position.y = 0.3;
    chair.visible = !ch?.off;
    // particles
    burst(sparks, St.sparks, t, (i, e, dt, u) => { const sp = 1.5 + rnd(i, 1) * 3.5, a = rnd(i, 2) * Math.PI * 2, el = rnd(i, 3) * 1.6 - 0.2, s0 = rnd(i, 4) * e.d * 0.6; const tt = dt - s0; if (tt < 0 || tt > 0.6) return null; const o = V(...e.at); return o.add(V(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(sp * tt)).add(V(0, -4.9 * tt * tt, 0)); });
    burst(smoke, St.smoke, t, (i, e, dt) => { const s0 = rnd(i, 1) * e.d * 0.7, tt = dt - s0; if (tt < 0) return null; const o = V(...e.at); return o.add(V((rnd(i, 2) - 0.5) * (0.3 + tt * 0.5) + (e.dir?.[0] ?? 0) * tt, tt * (0.25 + rnd(i, 3) * 0.3), (rnd(i, 4) - 0.5) * (0.3 + tt * 0.5) + (e.dir?.[2] ?? 0) * tt)); });
    burst(dust, St.dust, t, (i, e, dt) => { const s0 = rnd(i, 1) * e.d * 0.6, tt = dt - s0; if (tt < 0) return null; const y = 2.95 - tt * (0.6 + rnd(i, 2) * 0.8); if (y < 0) return null; return V(e.at[0] + (rnd(i, 3) - 0.5) * e.r * 2, y, e.at[2] + (rnd(i, 4) - 0.5) * e.r * 2); });
    burst(glass, St.glass, t, (i, e, dt) => { if (dt > 1.2) return null; const a = rnd(i, 2) * Math.PI - Math.PI, el = rnd(i, 3) * 1.2, sp = 1 + rnd(i, 1) * 3; return V(...e.at).add(V(Math.cos(a) * sp * dt * 0.6, Math.sin(el) * sp * dt - 4.9 * dt * dt, Math.abs(Math.sin(a)) * sp * dt)).setY(Math.max(0.01, V(...e.at).y + Math.sin(el) * sp * dt - 4.9 * dt * dt)); });
    burst(bugs, St.bugs, t, (i, e, dt) => { const a = rnd(i) * 6.28 + dt * (2 + rnd(i, 1) * 3), r = 0.3 + rnd(i, 2) * 1.2 * Math.max(0.3, 1 - dt / e.d), y = 0.2 + rnd(i, 3) * 2.6; return V(e.at[0] + Math.cos(a) * r, y, e.at[2] + Math.sin(a) * r); });
    const pp = spanAt(St.papers, t);
    paperMesh.count = pp ? 260 : 0;
    if (pp) for (let i = 0; i < 260; i++) {
      const dt = t - pp[0].t, a = rnd(i) * 6.28 + dt * (0.3 + rnd(i, 1) * 0.5), r = 0.3 + rnd(i, 2) * 1.9;
      const y = 0.05 + Math.abs(Math.sin(dt * (0.4 + rnd(i, 3) * 0.5) + rnd(i, 4) * 6)) * (0.3 + rnd(i, 5) * 2.2);
      paperMesh.setMatrixAt(i, M4.compose(V(2.8 + Math.cos(a) * r, y, 2.8 + Math.sin(a) * r), Q.setFromEuler(E.set(dt * rnd(i, 6) * 3, dt * rnd(i, 7) * 2, rnd(i, 8) * 6)), V(1, 1, 1)));
    }
    paperMesh.instanceMatrix.needsUpdate = true;
    // dissolve
    const dz = St.dissolve, dk = dz ? clamp01((t - dz.t) / dz.d) : 0;
    for (const m of dissolveMats) m.alphaTest = Math.max(0.0001, dk);
    steve.g.visible = dk < 1;
    return { blueOff, roomDark: (St.dark ?? []).some(([a, b]) => t >= a && t < b), away: inmate.g.visible || (St.terminated != null && t >= St.terminated) }; // away: cellblock.ts hides its own copy of 0411's inmate (story.terminated: from then on for good)
  };
  return {
    anchors, draw: drawStory, hudAt, dissolveOf,
    lights: { boomLight, svcGlow, pulseLight, chestGlow, alarm, leverKey, insertLamp, hallLamp, cellarLamp, depotLamp },
    objects: [[hammer, "sledgehammer (story.ts 0411)"], [leverPivot, "master lever (story.ts LEVER)"], [inmate.g, "cell 0411's inmate (story.ts 0411)"], [tnt, "TNT (story.ts TNT)"], [lid, "the trap block over the TNT (world.ts TRAP, story.ts TNT)"], [chair, "chair (NhatJS black_chair)"], [svc, "service box under the desk (story.ts THE HACK)"], [boxLid, "the service box's lid"], [stripHeld, "the printed token strip"], [chest, "trapped chest (mc-assets trapped_chest)"], [bot, "warehouse bot (story.ts DEPOT)"]],
  };
}
