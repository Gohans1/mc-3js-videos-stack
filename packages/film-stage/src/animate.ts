// @ts-nocheck
// Shot animations, CapCut's In / Out / Combo for a 3D camera. A shot row's `anim` {in?, out?, combo?}, each {fx, len?, k?},
// moves the camera the keys give (or darkens the frame) without touching the keys, so None takes it off again and its length
// stays a number to change. In plays over the shot's first `len` seconds and lands on the keyed camera, Out leaves it over the
// last `len`, Combo runs the whole shot; all three can be on one shot (a fade in under a slow push). The film calls animate()
// in draw right after cameraAt and darkens the frame by what it returns; it hands ANIMS to the studio as draw.anims, which is
// all the Animation tab lists. Each effect is named for the way the picture travels (Push in: the camera moves forward).
import * as THREE from "three";

// What the studio shows: id (stored as fx), title, cat (the tab's category chips), tip, len (seconds, the In/Out default)
const IN = [
  { id: "fade", title: "Fade in", cat: "Fade", black: true, len: 1, tip: "Opens from black" },
  { id: "zoomIn", title: "Zoom in", cat: "Zoom", move: "zoom", a: 1, len: 0.8, tip: "The lens tightens into the frame" },
  { id: "zoomOut", title: "Zoom out", cat: "Zoom", move: "zoom", a: -1, len: 0.8, tip: "The lens widens into the frame" },
  { id: "push", title: "Push in", cat: "Move", move: "push", a: 1, len: 1, tip: "The camera glides forward into the frame" },
  { id: "pull", title: "Pull back", cat: "Move", move: "push", a: -1, len: 1, tip: "The camera glides back into the frame" },
  { id: "rise", title: "Rise", cat: "Move", move: "rise", a: 1, len: 1, tip: "Comes up into the frame from below" },
  { id: "lower", title: "Lower", cat: "Move", move: "rise", a: -1, len: 1, tip: "Comes down into the frame from above" },
  { id: "slideL", title: "Slide left", cat: "Move", move: "slide", a: -1, len: 1, tip: "Travels left into the frame" },
  { id: "slideR", title: "Slide right", cat: "Move", move: "slide", a: 1, len: 1, tip: "Travels right into the frame" },
  { id: "orbitL", title: "Orbit left", cat: "Move", move: "orbit", a: -1, len: 1.2, tip: "Arcs left around the subject into the frame" },
  { id: "orbitR", title: "Orbit right", cat: "Move", move: "orbit", a: 1, len: 1.2, tip: "Arcs right around the subject into the frame" },
  { id: "panL", title: "Pan left", cat: "Turn", move: "pan", a: -1, len: 1, tip: "Turns left onto the frame" },
  { id: "panR", title: "Pan right", cat: "Turn", move: "pan", a: 1, len: 1, tip: "Turns right onto the frame" },
  { id: "tiltU", title: "Tilt up", cat: "Turn", move: "tilt", a: 1, len: 1, tip: "Tips up onto the frame" },
  { id: "tiltD", title: "Tilt down", cat: "Turn", move: "tilt", a: -1, len: 1, tip: "Tips down onto the frame" },
  { id: "whipL", title: "Whip left", cat: "Turn", move: "whip", a: -1, len: 0.35, tip: "A fast turn left that snaps onto the frame" },
  { id: "whipR", title: "Whip right", cat: "Turn", move: "whip", a: 1, len: 0.35, tip: "A fast turn right that snaps onto the frame" },
  { id: "level", title: "Level out", cat: "Turn", move: "roll", a: 1, len: 1, tip: "Starts tipped over and levels out" },
  { id: "impact", title: "Impact", cat: "Shake", jolt: true, len: 0.5, tip: "Opens on a jolt that dies away" },
];
const OUT = [
  { id: "fade", title: "Fade out", cat: "Fade", black: true, len: 1, tip: "Ends on black" },
  { id: "zoomIn", title: "Zoom in", cat: "Zoom", move: "zoom", a: 1, len: 0.8, tip: "The lens tightens as the shot ends" },
  { id: "zoomOut", title: "Zoom out", cat: "Zoom", move: "zoom", a: -1, len: 0.8, tip: "The lens widens as the shot ends" },
  { id: "push", title: "Push in", cat: "Move", move: "push", a: 1, len: 1, tip: "The camera moves forward as the shot ends" },
  { id: "pull", title: "Pull back", cat: "Move", move: "push", a: -1, len: 1, tip: "The camera backs away as the shot ends" },
  { id: "rise", title: "Rise", cat: "Move", move: "rise", a: 1, len: 1, tip: "Lifts away as the shot ends" },
  { id: "lower", title: "Lower", cat: "Move", move: "rise", a: -1, len: 1, tip: "Sinks away as the shot ends" },
  { id: "slideL", title: "Slide left", cat: "Move", move: "slide", a: -1, len: 1, tip: "Travels left out of the frame" },
  { id: "slideR", title: "Slide right", cat: "Move", move: "slide", a: 1, len: 1, tip: "Travels right out of the frame" },
  { id: "orbitL", title: "Orbit left", cat: "Move", move: "orbit", a: -1, len: 1.2, tip: "Arcs left around the subject as the shot ends" },
  { id: "orbitR", title: "Orbit right", cat: "Move", move: "orbit", a: 1, len: 1.2, tip: "Arcs right around the subject as the shot ends" },
  { id: "panL", title: "Pan left", cat: "Turn", move: "pan", a: -1, len: 1, tip: "Turns left away from the frame" },
  { id: "panR", title: "Pan right", cat: "Turn", move: "pan", a: 1, len: 1, tip: "Turns right away from the frame" },
  { id: "tiltU", title: "Tilt up", cat: "Turn", move: "tilt", a: 1, len: 1, tip: "Tips up away from the frame" },
  { id: "tiltD", title: "Tilt down", cat: "Turn", move: "tilt", a: -1, len: 1, tip: "Tips down away from the frame" },
  { id: "whipL", title: "Whip left", cat: "Turn", move: "whip", a: -1, len: 0.35, tip: "Snaps away left into the cut" },
  { id: "whipR", title: "Whip right", cat: "Turn", move: "whip", a: 1, len: 0.35, tip: "Snaps away right into the cut" },
  { id: "roll", title: "Roll away", cat: "Turn", move: "roll", a: 1, len: 1, tip: "Tips over as the shot ends" },
  { id: "impact", title: "Impact", cat: "Shake", jolt: true, len: 0.5, tip: "Ends on a jolt, into the cut" },
];
// k (strength, 1 by default) scales a Combo
const COMBO = [
  { id: "push", title: "Push in", cat: "Move", move: "push", a: 1, tip: "Dolly in: the calm, story-telling move toward what it looks at" },
  { id: "pull", title: "Pull back", cat: "Move", move: "push", a: -1, tip: "Dolly out: backs away, revealing more of the place" },
  { id: "rise", title: "Rise", cat: "Move", move: "rise", a: 1, tip: "Pedestal up, still facing the same way" },
  { id: "lower", title: "Lower", cat: "Move", move: "rise", a: -1, tip: "Pedestal down, still facing the same way" },
  { id: "slideL", title: "Slide left", cat: "Move", move: "slide", a: -1, tip: "Truck left, still facing the same way" },
  { id: "slideR", title: "Slide right", cat: "Move", move: "slide", a: 1, tip: "Truck right, still facing the same way" },
  { id: "orbitL", title: "Orbit left", cat: "Move", move: "orbit", a: -1, tip: "Arcs left around what it looks at" },
  { id: "orbitR", title: "Orbit right", cat: "Move", move: "orbit", a: 1, tip: "Arcs right around what it looks at" },
  { id: "panL", title: "Pan left", cat: "Turn", move: "pan", a: -1, tip: "Turns left on the spot" },
  { id: "panR", title: "Pan right", cat: "Turn", move: "pan", a: 1, tip: "Turns right on the spot" },
  { id: "tiltU", title: "Tilt up", cat: "Turn", move: "tilt", a: 1, tip: "Tips up on the spot" },
  { id: "tiltD", title: "Tilt down", cat: "Turn", move: "tilt", a: -1, tip: "Tips down on the spot" },
  { id: "dutch", title: "Dutch drift", cat: "Turn", move: "roll", a: 0.6, tip: "The horizon slowly tips over: unease" },
  { id: "zoomIn", title: "Zoom in", cat: "Zoom", move: "zoom", a: 1, tip: "The lens tightens without the camera moving" },
  { id: "zoomOut", title: "Zoom out", cat: "Zoom", move: "zoom", a: -1, tip: "The lens widens without the camera moving" },
  { id: "vertigoIn", title: "Dolly zoom in", cat: "Zoom", move: "vertigo", a: 1, tip: "Moves in while the lens widens: the subject keeps its size and the room stretches (Hitchcock's Vertigo)" },
  { id: "vertigoOut", title: "Dolly zoom out", cat: "Zoom", move: "vertigo", a: -1, tip: "Backs off while the lens tightens: the subject keeps its size and the room closes in" },
  { id: "breathe", title: "Breathe", cat: "Zoom", loop: "breathe", tip: "The lens slowly closes in and eases off, like a held breath" },
  { id: "handheld", title: "Handheld", cat: "Shake", loop: "handheld", tip: "A hand-held camera's slow wander: documentary, found footage" },
  { id: "shake", title: "Shake", cat: "Shake", loop: "shake", tip: "A steady fine tremble: engines, rumbling, fear" },
  { id: "sway", title: "Sway", cat: "Shake", loop: "sway", tip: "Rocks side to side: a ship, dizziness, a drunk view" },
];
export const ANIMS = { in: IN, out: OUT, combo: COMBO };
const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
const FX = { in: byId(IN), out: byId(OUT), combo: byId(COMBO) };

const Y = new THREE.Vector3(0, 1, 0);
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), v = new THREE.Vector3();
// The camera's own axes; returns how far it stands from what it looks at
const frame = (c) => {
  fwd.copy(c.l).sub(c.p);
  const dist = Math.max(0.1, fwd.length());
  fwd.divideScalar(dist);
  right.copy(fwd).cross(Y);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  up.copy(right).cross(fwd);
  return dist;
};
const deg = (x) => (x * Math.PI) / 180;
const lens = (fov) => THREE.MathUtils.clamp(fov, 5, 120);
// Each move at amount a: 1 is its full size at strength 1, the sign its way (+ right, up, forward, tighter)
const MOVES = {
  push: (c, a) => { const d = frame(c); c.p.addScaledVector(fwd, 0.15 * d * a); },
  slide: (c, a) => { const d = frame(c); v.copy(right).multiplyScalar(0.12 * d * a); c.p.add(v); c.l.add(v); },
  rise: (c, a) => { const d = frame(c); c.p.y += 0.12 * d * a; c.l.y += 0.12 * d * a; },
  orbit: (c, a) => { v.copy(c.p).sub(c.l).applyAxisAngle(Y, deg(12 * a)); c.p.copy(c.l).add(v); },
  pan: (c, a) => { const d = frame(c); v.copy(fwd).applyAxisAngle(Y, deg(-8 * a)); c.l.copy(c.p).addScaledVector(v, d); },
  whip: (c, a) => { const d = frame(c); v.copy(fwd).applyAxisAngle(Y, deg(-40 * a)); c.l.copy(c.p).addScaledVector(v, d); },
  tilt: (c, a) => { const d = frame(c); v.copy(fwd).applyAxisAngle(right, deg(6 * a)); c.l.copy(c.p).addScaledVector(v, d); },
  zoom: (c, a) => { c.fov = lens(c.fov * (1 - 0.2 * a)); },
  roll: (c, a) => { c.roll += 0.14 * a; },
  // forward by s of the distance, the lens widened so what it looks at keeps its size on screen: d·tan(fov/2) stays the same
  vertigo: (c, a) => {
    const d = frame(c), s = THREE.MathUtils.clamp(0.35 * a, -1, 0.8);
    c.p.addScaledVector(fwd, s * d);
    c.fov = lens((2 * Math.atan(Math.tan(deg(c.fov) / 2) / (1 - s)) * 180) / Math.PI);
  },
};
// Two or three sines at unrelated rates, so a shake never repeats visibly; the same t always gives the same offset
const wander = (t, f, ph) => Math.sin(t * f + ph) * 0.6 + Math.sin(t * f * 2.17 + ph * 1.7 + 1.3) * 0.3 + Math.sin(t * f * 3.91 + ph * 0.4 + 2.1) * 0.1;
const nudge = (c, t, f, amp, look) => {
  frame(c);
  const x = wander(t, f, 0.3) * amp, y = wander(t, f * 1.13, 2.2) * amp;
  c.p.addScaledVector(right, x).addScaledVector(up, y);
  c.l.addScaledVector(right, x * look).addScaledVector(up, y * look);
};
const LOOPS = {
  handheld: (c, t, k) => { nudge(c, t, 1.1, 0.012 * k, 1.8); c.roll += 0.006 * k * wander(t, 0.7, 4.1); },
  shake: (c, t, k) => { nudge(c, t, 13, 0.004 * k, 1.2); },
  sway: (c, t, k) => { c.roll += 0.05 * k * Math.sin(t * 1.25); },
  breathe: (c, t, k) => { c.fov = lens(c.fov * (1 - 0.03 * k * (0.5 - 0.5 * Math.cos(t * 0.8)))); },
};
// A jolt of size e (0 to 1): the impact shake, sideways, up and a little roll
const jolt = (c, t, e) => { nudge(c, t, 31, 0.035 * e, 1); c.roll += 0.02 * e * Math.sin(t * 43.7 + 0.3); };

const smooth = (x) => x * x * (3 - 2 * x) * 0.6 + x * 0.4; // film-stage EASES.smooth: a Combo never stops dead at either end
const smoothstep = (x) => x * x * (3 - 2 * x);

// How far through the shot's In (x 0 to 1) the effect still is: an arrival slows into the keyed frame, a whip snaps into it
const leftOf = (fx, x) => (fx.black ? 1 - smoothstep(x) : Math.pow(1 - x, fx.move === "whip" ? 4 : 2.2));
// and through its Out: a leaving speeds up into the cut
const grownBy = (fx, x) => (fx.black ? smoothstep(x) : Math.pow(x, fx.move === "whip" ? 4 : 2.2));

// The shot (in `shots`, start times in the seconds draw(t) gets) at t changes the camera c {p, l, fov, roll} in place; returns
// how black the frame should be (0 to 1). end: the film's length, where the last shot ends
export function animate(c, t, shots, end) {
  let i = -1;
  for (let j = 0; j < (shots?.length ?? 0); j++) if (t >= shots[j].t) i = j;
  const anim = shots?.[i]?.anim;
  if (!anim) return 0;
  const t0 = shots[i].t, t1 = i + 1 < shots.length ? shots[i + 1].t : end, span = Math.max(1e-3, t1 - t0);
  const fxIn = anim.in && FX.in[anim.in.fx], fxOut = anim.out && FX.out[anim.out.fx], fxCombo = anim.combo && FX.combo[anim.combo.fx];
  let black = 0;
  if (fxCombo) {
    const k = anim.combo.k ?? 1;
    if (fxCombo.loop) LOOPS[fxCombo.loop](c, t, k);
    else MOVES[fxCombo.move](c, fxCombo.a * k * smooth(THREE.MathUtils.clamp((t - t0) / span, 0, 1)));
  }
  // An In and an Out longer together than the shot share it, each shortened in step
  let lenIn = fxIn ? Math.max(0.01, anim.in.len ?? fxIn.len) : 0, lenOut = fxOut ? Math.max(0.01, anim.out.len ?? fxOut.len) : 0;
  if (lenIn + lenOut > span) { const s = span / (lenIn + lenOut); lenIn *= s; lenOut *= s; }
  // e: how much of the effect is on (0 to 1). An In's camera starts back along its way of travel (way -1), an Out's goes on
  const at = (fx, e, way, k) => {
    if (e <= 0) return;
    if (fx.black) black = Math.max(black, e);
    else if (fx.jolt) jolt(c, t, e * k);
    else MOVES[fx.move](c, way * fx.a * e * k);
  };
  if (fxIn && t < t0 + lenIn) at(fxIn, leftOf(fxIn, (t - t0) / lenIn), -1, anim.in.k ?? 1);
  if (fxOut && t > t1 - lenOut) at(fxOut, grownBy(fxOut, (t - (t1 - lenOut)) / lenOut), 1, anim.out.k ?? 1);
  return black;
}
