// @ts-nocheck
// What is going on at film time t, for the review overlay (the studio's top-left list and every draft frame): shot, camera,
// Steve, light and look, voice, sound, which libraries draw what is in frame, and where in edit.json each part lives.
// Read from the same edit.json and camera the picture is drawn from, never typed by hand, so it cannot disagree with the
// frame. Call it right after draw(t): "in frame" tests use the camera draw(t) left behind.
// Returns [{ head, lines: [{ text, fresh }] }]; fresh marks what started less than FRESH seconds ago.
import * as THREE from "three";
import { cameraAt } from "./camera";
import { BED, DESK, DOOR, LAMP } from "./world";

const FRESH = 1;
const deg = THREE.MathUtils.radToDeg;
// a 3D lens has no focal length: this is the full-frame (24 mm tall sensor) lens that sees the same vertical angle
const mm = (fov) => Math.round(12 / Math.tan(THREE.MathUtils.degToRad(fov) / 2));
const box = (a, b) => new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b));

export function makeDescribe({ EDIT, SHOTS, shotAt, keysOf, camera, steveBox, steveBody }) {
  const PROPS = [
    ["Steve", steveBox, "MCprep player.glb (CC-BY)"],
    ["iron bed", box([BED.x, 0, BED.head], [BED.x + 1, 0.9, BED.head + 2]), "pack/iron_bed.json"],
    ["CRT + keyboard", box([DESK.x, 1, DESK.z], [DESK.x + 1, 1.7, DESK.z + 1]), "pack/computer.json"],
    ["steel desk + chair", box([DESK.x, 0, DESK.z], [DESK.x + 2, 1, DESK.z + 2]), "iron_trapdoor, deepslate stairs"],
    ["steel door", box([DOOR.x - 1, 0, DOOR.z], [DOOR.x + 2, 3, DOOR.z + 1]), "iron_door"],
    ["ceiling lamp", box([LAMP[0][0], LAMP[0][1], LAMP[0][2]], [LAMP[1][0] + 1, LAMP[1][1] + 1, LAMP[1][2] + 1]), "sea_lantern (own scene)"],
  ];
  const frustum = new THREE.Frustum(), m = new THREE.Matrix4();
  const f0 = new THREE.Vector3(), f1 = new THREE.Vector3(), v = new THREE.Vector3();
  const inView = (b) => {
    for (let x = 0; x <= 2; x++) for (let y = 0; y <= 2; y++) for (let z = 0; z <= 2; z++) {
      v.set(b.min.x + ((b.max.x - b.min.x) * x) / 2, b.min.y + ((b.max.y - b.min.y) * y) / 2, b.min.z + ((b.max.z - b.min.z) * z) / 2);
      if (frustum.containsPoint(v)) return true;
    }
    return false;
  };
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

  return (t) => {
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

    const L = EDIT.steve, char = [];
    char.push(line(i === 2 ? "POV: his head + upper arms hidden" : "pose: lying on his back (sleep)"));
    const tw = t - L.twitch;
    if (tw >= 0 && tw < 0.35) char.push(line("right hand twitches", L.twitch, t));
    if (t < L.eyesOpen) char.push(line("eyes closed"));
    else if (t < L.eyesOpen + 0.1) char.push(line("eyes snap open (0.09 s)", L.eyesOpen, t));
    else if (t < L.eyesOpen + 0.1 + L.pupil.narrow) char.push(line("pupils narrowing under the lamp", L.eyesOpen + 0.1, t));
    else if (i === 1) char.push(line("eyes open, pupils narrow"));
    add("STEVE", char);

    const C = EDIT.light, K = EDIT.cctv;
    const look = [line("key: 1 cold spot from the ceiling lamp"), line(`fill ${C.fill} · bounce ${C.bounce} · rim ${C.rim} · fog ${C.fog}`)];
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
    if (!voice.length) {
      const next = EDIT.takes.find((k, n) => (EDIT.voice.lines[n]?.[0] ?? k.t) > t);
      voice.push(line(next ? `silence · next line at ${next.t}s` : "silence"));
    }
    add("VOICE", voice);

    const A = EDIT.audio, sound = [];
    const said = (n) => n.replace(/_/g, " ");
    for (const b of A.beds) if (t >= b.from && t < b.to) {
      const lp = b.filters?.join(" ").match(/lowpass=f=(\d+)/)?.[1];
      sound.push(line(`bed: ${said(b.name)}${lp ? ` (low-pass ${lp} Hz)` : ""}`, b.from, t));
    }
    // one-shots without a length in edit.json are listed for 1 s
    for (const s of A.sfx) if (t >= s.at && t < s.at + (s.length ?? 1)) sound.push(line(`sfx: ${said(s.name)}`, s.at, t));
    sound.push(line("CC0 Freesound · ffmpeg mix (sound/mix.py)"));
    add("SOUND", sound);

    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // in his own view the lens sits inside his head, so only the body below the neck counts. Frustum.intersectsBox is
    // conservative (a box past a frame corner still passes), so a point of a 3x3x3 grid over the box must be in view
    const seen = PROPS.filter(([name, b]) => inView(name === "Steve" && i === 2 ? steveBody : b));
    add("IN FRAME / STACK", [
      line("three.js r186 · room: block-model-renderer"),
      line("room block mix: pmndrs/math mulberry32"),
      ...seen.map(([name, , how]) => line(`${name}: ${how}`)),
    ]);

    const k0 = keys.reduce((n, k, j) => (k.t <= t ? j : n), 0);
    const edit = [`cam[${k0}]${k0 + 1 < keys.length && !keys[k0 + 1].cut ? ` -> cam[${k0 + 1}]` : ""}`];
    if (i === 0) edit.push("cctv");
    if (char.some((l) => /twitch/.test(l.text))) edit.push("steve.twitch");
    if (char.some((l) => /eyes snap|pupils narrowing/.test(l.text))) edit.push("steve.eyesOpen, steve.pupil");
    EDIT.takes.forEach((k, n) => { const [s, e] = EDIT.voice.lines[n] ?? []; if (t >= s && t < e + 0.3) edit.push(`takes[${n}]`); });
    A.sfx.forEach((s, n) => { if (t >= s.at && t < s.at + (s.length ?? 1)) edit.push(`audio.sfx[${n}]`); });
    add("EDIT HERE (src/edit.json)", [line(edit.join(" · ")), line("light · look · audio.beds")]);
    return sections;
  };
}
