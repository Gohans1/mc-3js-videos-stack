// @ts-nocheck
// What is going on at film time t, for the review overlay (the studio's top-left list and every draft frame): shot, camera,
// Steve, light and look, voice, sound, which libraries draw what is in frame, and where in the timeline files each part lives.
// Read from the same EDIT (src/edit.ts) and camera the picture is drawn from, never typed by hand, so it cannot disagree with the
// frame. Call it right after draw(t): "in frame" tests use the camera draw(t) left behind.
// Returns [{ head, lines: [{ text, fresh }] }]; fresh marks what started less than FRESH seconds ago.
import * as THREE from "three";
import { cameraAt } from "./camera";
import { BED, CABINET, CHAIR, DESK, DOOR, DOME, LAMP } from "./world";
import { FACES } from "./steve";
import { MOODS } from "./player";

const FRESH = 1;
const deg = THREE.MathUtils.radToDeg;
// a 3D lens has no focal length: this is the full-frame (24 mm tall sensor) lens that sees the same vertical angle
const mm = (fov) => Math.round(12 / Math.tan(THREE.MathUtils.degToRad(fov) / 2));
const box = (a, b) => new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b));
const v = new THREE.Vector3();
// Frustum.intersectsBox is conservative (a box past a frame corner still passes), so a point of a 3x3x3 grid over the
// box must be in view
const inView = (frustum, b) => {
  for (let x = 0; x <= 2; x++) for (let y = 0; y <= 2; y++) for (let z = 0; z <= 2; z++) {
    v.set(b.min.x + ((b.max.x - b.min.x) * x) / 2, b.min.y + ((b.max.y - b.min.y) * y) / 2, b.min.z + ((b.max.z - b.min.z) * z) / 2);
    if (frustum.containsPoint(v)) return true;
  }
  return false;
};

// [[from, to], ...] film seconds when the box is on screen, the film's camera sampled every 0.1 s (the same way draw sets it)
export function onScreenRanges(b, keys, end, aspect) {
  const cam = new THREE.PerspectiveCamera(60, aspect, 0.02, 100), frustum = new THREE.Frustum(), m = new THREE.Matrix4();
  const out = [];
  let from = null;
  for (let i = 0; i * 0.1 <= end + 1e-6; i++) {
    const t = i * 0.1, c = cameraAt(t, keys);
    cam.position.copy(c.p); cam.up.set(0, 1, 0); cam.lookAt(c.l); cam.rotateZ(c.roll);
    cam.fov = c.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const seen = inView(frustum.setFromProjectionMatrix(m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)), b);
    if (seen && from === null) from = t;
    if (!seen && from !== null) { out.push([+from.toFixed(1), +t.toFixed(1)]); from = null; }
  }
  if (from !== null) out.push([+from.toFixed(1), end]);
  return out;
}

export function makeDescribe({ EDIT, SHOTS, shotAt, keysOf, camera, steveBox, steveBody, variants, steve, now, props }) {
  const computer = variants.find((x) => x.id === "computer");
  // Steve's box now, from his joints (a skinned mesh's own box stays in the rest pose)
  const live = new THREE.Box3(), jp = new THREE.Vector3();
  const steveNow = () => { live.makeEmpty(); for (const b of Object.values(steve.bones)) live.expandByPoint(b.getWorldPosition(jp)); return live.expandByScalar(0.25); };
  const objBox = (o) => new THREE.Box3().setFromObject(o);
  const PROPS = [
    ["Steve", null, "MCprep player.glb (CC-BY)"],
    ["black bed", box([BED.x, 0, BED.head], [BED.x + 1, 0.5625, BED.head + 2]), "black_bed (client.jar)"],
    ["CRT + keyboard", box([DESK.x, 1, DESK.z], [DESK.x + 1, 1.7, DESK.z + 1]), () => `${computer.pick.title} (pack/${computer.pick.id}.json, choices.json)`],
    ["steel desk", box([DESK.x, 0, DESK.z], [DESK.x + 1, 1, DESK.z + 2]), "iron_trapdoor"],
    ["filing cabinet", box([CABINET.x, 0, CABINET.z], [CABINET.x + 1, 0.8, CABINET.z + 1]), "pack/file_cabinet.json (block-model-renderer)"],
    ["filing drawer", () => objBox(props.tray), () => `pack/file_drawer.json, open ${Math.round((props.open(lastT) / 0.5) * 100)}%`],
    ["chair", () => objBox(props.chair), () => { const c = variants.find((x) => x.id === "chair")?.pick; return `${c?.title} (pack/pick.py, choices.json), seat ${CHAIR.seat} m`; }],
    ["CRT picture", () => (props.glass.visible ? objBox(props.glass) : null), "props.ts canvas, game font ascii.png"],
    ["CCTV dome", () => (props.dome.visible ? box(DOME, [DOME[0] + 1, DOME[1] + 1, DOME[2] + 1]) : null), "pack/cctv_dome.json"],
    ["folded scrap", () => objBox(props.scrap), "pack/paper_scrap.json"],
    ["steel door", box([DOOR.x - 1, 0, DOOR.z], [DOOR.x + 2, 3, DOOR.z + 1]), "iron_door"],
    ["ceiling lamp", box([LAMP[0][0], LAMP[0][1], LAMP[0][2]], [LAMP[1][0] + 1, LAMP[1][1] + 1, LAMP[1][2] + 1]), "sea_lantern (own scene)"],
  ];
  const frustum = new THREE.Frustum(), m = new THREE.Matrix4();
  const f0 = new THREE.Vector3(), f1 = new THREE.Vector3();
  const line = (text, since, t) => ({ text, fresh: since !== undefined && t >= since && t - since < FRESH });

  const cameraLines = (t, keys) => {
    const out = [];
    const a = cameraAt(t, keys), b = cameraAt(t + 0.1, keys);
    f0.copy(a.l).sub(a.p).normalize();
    f1.copy(b.l).sub(b.p).normalize();
    const pitch = deg(Math.asin(THREE.MathUtils.clamp(f0.y, -1, 1)));
    out.push(pitch < -50 ? "angle: top-down" : pitch < -12 ? `angle: high, looking down ${Math.round(-pitch)}°`
      : pitch > 50 ? "angle: straight up" : pitch > 12 ? `angle: low, looking up ${Math.round(pitch)}°` : "angle: eye level");
    out.push(`lens: ~${mm(a.fov)}mm (FOV ${Math.round(a.fov)}°)`);
    // rates per second over the next 0.1 s; the breathing sway alone stays under these
    const turn = deg(f0.angleTo(f1)) * 10;
    const side = new THREE.Vector3().crossVectors(f0, f1).y;
    const tilt = (deg(Math.asin(THREE.MathUtils.clamp(f1.y, -1, 1))) - pitch) * 10;
    const zoom = (b.fov - a.fov) * 10;
    // moving towards the look point, as a share of the distance to it per second: 1 cm/s is a push-in on an eye 38 cm away
    const along = (v.copy(b.p).sub(a.p).dot(f0) * 10) / Math.max(0.05, a.p.distanceTo(a.l));
    const moves = [];
    if (turn > 3 && Math.abs(side) > 1e-4) moves.push(`pan ${side > 0 ? "left" : "right"}`);
    if (Math.abs(tilt) > 3) moves.push(`tilt ${tilt > 0 ? "up" : "down"}`);
    if (Math.abs(along) > 0.01) moves.push(along > 0 ? "push in" : "pull out");
    if (Math.abs(zoom) > 0.5) moves.push(zoom < 0 ? "zoom in" : "zoom out");
    out.push(`move: ${moves.length ? moves.join(" + ") : "held (static)"}`);
    const next = keys.find((k) => k.t > t);
    if (moves.length && next) out.push(`ease: ${next.ease ?? "smooth"} into key at ${next.t}s`);
    const wave = keys.reduce((w, k) => (k.t <= t ? k.wave ?? 1 : w), keys[0].wave ?? 1);
    if (wave > 0) out.push(`sway: breathing float x${wave}`);
    out.push("path: Catmull-Rom spline (camera.ts)");
    return out;
  };

  let lastT = 0;
  const said = (n) => n.replace(/_/g, " ");
  const where = (a) => (a == null ? "" : Array.isArray(a) ? `[${a.map((x) => +x.toFixed(2)).join(", ")}]` : said(a));
  const moodName = (m) => {
    let best = "neutral", d = 1e9;
    for (const [n, v] of Object.entries({ ...MOODS, ...FACES })) {
      const e = Object.keys(MOODS.neutral).reduce((s, f) => s + Math.abs((v[f] ?? 0) - (m[f] ?? 0)), 0);
      if (e < d) { d = e; best = n; }
    }
    return best;
  };
  return (t) => {
    lastT = t;
    const keys = keysOf(EDIT.cam);
    const i = shotAt(t), S = SHOTS[i];
    const start = keys.find((k) => Math.abs(k.t - S.t) < 1e-6);
    const sections = [];
    const add = (head, lines) => { if (lines.length) sections.push({ head, lines }); };

    add("SHOT", [
      line(`${i + 1}/${SHOTS.length} ${S.size} · ${S.what}`, S.t, t),
      line(`${start?.cut || i === 0 ? "CUT" : "continuous"} in at ${S.t.toFixed(1)}s`, S.t, t),
    ]);
    add("CAMERA", cameraLines(t, keys).map((s) => line(s)));

    const L = EDIT.steve, char = [], B = now.B;
    if (S.pov) char.push(line("POV: his head + upper arms hidden"));
    if (B?.act?.do && t >= 27) char.push(line(B.act.do, L.moves[B.key].t, t)); // fresh from the start of this move
    if (B) {
      const k = L.moves[B.key], n = L.moves[Math.min(B.key + 1, L.moves.length - 1)];
      const name = (m) => (m.clip ? `mocap ${m.clip} (src/clips.ts, baked 60 Hz, slerp blends)` : m.pose);
      char.push(line(B.moving && n !== k ? `pose: ${name(k)} -> ${name(n)}${n.walk ? " (walking, steps from distance)" : ""}${n.via ? ` via ${n.via}` : ""}` : `pose: ${name(k)}`));
      if (B.speed > 0.05) char.push(line(`moving ${B.speed.toFixed(2)} m/s`));
    }
    const tw = t - L.twitch;
    if (tw >= 0 && tw < 0.35) char.push(line("right hand twitches", L.twitch, t));
    if (t < L.eyesOpen) char.push(line("eyes closed"));
    else if (t < L.eyesOpen + 0.1) char.push(line("eyes snap open (0.09 s)", L.eyesOpen, t));
    else if (t < L.eyesOpen + 0.1 + L.pupil.narrow) char.push(line("pupils narrowing under the lamp", L.eyesOpen + 0.1, t));
    const hk = (f) => { const ks = L.hands.filter((h) => f in h && h.t <= t); return ks.length ? ks[ks.length - 1] : null; };
    for (const [f, name] of [["R", "right"], ["L", "left"]]) {
      const tgt = f === "R" ? now.R : now.Lh, k = hk(f);
      if (tgt && k) char.push(line(`${name} hand IK -> ${where(k[f]) || "letting go"}${tgt.w < 0.99 ? ` (${Math.round(tgt.w * 100)}%)` : ""}`, k.t, t));
    }
    if (now.look) { const ks = L.look.filter((h) => h.t <= t); const k = ks[ks.length - 1]; char.push(line(`head aims at ${where(k?.at) || "(returning)"}`, k?.t, t)); }
    if (t >= 27 && now.mood) char.push(line(`face: ${moodName(now.mood)} (brows thin, never over the eyes)`));
    if ((L.read ?? []).some(([a, b]) => t >= a && t < b)) char.push(line("eyes: reading, saccades left to right"));
    if (now.blink > 0.05 && t > L.eyesOpen + 1) char.push(line("blink", t));
    if (t >= L.exhale && t < L.exhale + 1.2) char.push(line("heavy breath out, lips part", L.exhale, t));
    add("STEVE", char);

    const Pr = EDIT.props, pr = [];
    if (t >= Pr.screen.on) pr.push(line(`CRT on: "${Pr.screen.lines[1]}", cursor blinks`, Pr.screen.on, t));
    const dx = props.chairDx(t);
    const ck = Pr.chair.find((k, j) => j > 0 && t >= Pr.chair[j - 1].t && t < k.t && k.dx !== Pr.chair[j - 1].dx);
    if (ck) pr.push(line(`chair slides to +${ck.dx} m`, Pr.chair[Pr.chair.indexOf(ck) - 1].t, t));
    const o = props.open(t);
    if (o > 0.001 && o < 0.499) pr.push(line(`drawer opening (${Pr.drawer[Pr.drawer.length - 1].ease ?? "smooth"})`, Pr.drawer[Pr.drawer.length - 2].t, t));
    for (const s of Pr.files ?? []) {
      if (t >= s.grab && t < s.release) pr.push(line(`folder ${s.folder} in his ${s.hand === "R" ? "right" : "left"} hand${s.face != null && t >= s.face ? ", held up to read" : ""}`, s.grab, t));
      if (t >= s.release && t < s.release + 1.2) pr.push(line(`folder ${s.folder} thrown: arc to [${s.land}], ${s.sheets} pages flutter out`, s.release, t));
    }
    add("PROPS (src/timeline/props.json)", pr);

    const C = EDIT.light, K = EDIT.cctv;
    const look = [line("key: 1 cold spot from the ceiling lamp"), line(`fill ${C.fill} · bounce ${C.bounce} · rim ${C.rim} · fog ${C.fog}`)];
    if (t >= EDIT.props.screen.on) look.push(line(`CRT glow: blue-grey point light ${C.screen}`, EDIT.props.screen.on, t));
    if (S.fill) look.push(line(`close fill under the desk ${C.closeFill} (this shot only)`, S.t, t));
    else if (C.face) look.push(line(`face fill ${C.face} riding above the lens (reaches 2.2 m)`));
    if (i === 0) look.push(line(`CCTV: lens bend ${K.distortion} · grain ${K.grain}`, S.t, t), line(`CCTV: saturation ${K.saturation} · contrast +${K.contrast}`), line(`caption "${K.label}" (MineRender)`));
    else look.push(line(`saturation ${EDIT.look.saturation}`));
    look.push(line("AO (n8ao) · bloom · vignette · AgX · SMAA"));
    add("LIGHT & LOOK", look);

    const voice = [];
    EDIT.takes.forEach((k, n) => {
      const [s, e] = EDIT.voice.lines[n] ?? [k.t, k.t];
      if (t >= s && t < e + 0.3) {
        const tag = k.text.match(/^\[([^\]]*)\]/)?.[1];
        voice.push(line(`"${k.text.replace(/^\[[^\]]*\]\s*/, "")}"`, s, t), line(`Seff Echo · take ${k.id}${tag ? ` · [${tag}]` : ""}`));
      }
    });
    for (const k of EDIT.script_lines ?? []) if (t >= k.t && t < k.until) {
      voice.push(line(`(no voice yet) "${k.text.replace(/\[[^\]]*\]\s*/g, "")}"`, k.t, t), line(`script line ${k.t}-${k.until}s, to be voiced by Seff Echo`));
    }
    if (!voice.length) {
      const next = [...EDIT.takes.map((k) => k.t), ...(EDIT.script_lines ?? []).map((k) => k.t)].filter((x) => x > t).sort((a, b) => a - b)[0];
      voice.push(line(next ? `silence · next line at ${next}s` : "silence"));
    }
    add("VOICE", voice);

    const A = EDIT.audio, sound = [];
    for (const b of A.beds) if (t >= b.from && t < b.to) {
      const lp = b.filters?.join(" ").match(/lowpass=f=(\d+)/)?.[1];
      sound.push(line(`bed: ${said(b.name)}${lp ? ` (low-pass ${lp} Hz)` : ""}`, b.from, t));
    }
    // one-shots without a length in audio.json are listed for 1 s
    for (const s of A.sfx) if (t >= s.at && t < s.at + (s.length ?? 1)) sound.push(line(`sfx: ${said(s.name)}`, s.at, t));
    sound.push(line("CC0 Freesound · ffmpeg mix (sound/mix.py)"));
    add("SOUND", sound);

    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // in his own view the lens sits inside his head, so only the body below the neck counts
    const seen = PROPS.filter(([name, b]) => {
      const bb = name === "Steve" ? (S.pov ? steveBody : steveNow()) : typeof b === "function" ? b() : b;
      return bb && inView(frustum, bb);
    });
    const papers = [...props.folders, ...props.sheets].filter((f) => f.visible && inView(frustum, objBox(f))).length;
    add("IN FRAME / STACK", [
      line("three.js r186 · room: block-model-renderer"),
      line("room block mix: pmndrs/math mulberry32"),
      ...seen.map(([name, , how]) => line(`${name}: ${typeof how === "function" ? how() : how}`)),
      ...(papers ? [line(`${papers} folders/pages: pack/folder_0..2.json, sheet.json`)] : []),
    ]);

    const k0 = keys.reduce((n, k, j) => (k.t <= t ? j : n), 0);
    const edit = [`cam[${k0}]${k0 + 1 < keys.length && !keys[k0 + 1].cut ? ` -> cam[${k0 + 1}]` : ""}`];
    if (i === 0) edit.push("cctv");
    if (char.some((l) => /twitch/.test(l.text))) edit.push("steve.twitch");
    if (B && t >= 27) edit.push(`steve.moves[${B.key}]`, "steve.hands · look · face");
    if (pr.length) edit.push("props");
    if (char.some((l) => /eyes snap|pupils narrowing/.test(l.text))) edit.push("steve.eyesOpen, steve.pupil");
    EDIT.takes.forEach((k, n) => { const [s, e] = EDIT.voice.lines[n] ?? []; if (t >= s && t < e + 0.3) edit.push(`takes[${n}]`); });
    A.sfx.forEach((s, n) => { if (t >= s.at && t < s.at + (s.length ?? 1)) edit.push(`audio.sfx[${n}]`); });
    add("EDIT HERE (src/timeline/NAME.json)", [line(edit.join(" · ")), line("audio.beds · src/edit.json: light · look")]);
    return sections;
  };
}
