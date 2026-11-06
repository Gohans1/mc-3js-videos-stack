// A lint for cinematography: walks the film frame by frame and prints, with times, the mistakes that make a film look
// amateur, the ones professional layout artists and editors check for. A clean film prints nothing (shotcheck); shotlist
// prints one line per shot (length, lens, where each subject sits) to read the edit at a glance. Wire both into draw.checks:
//   draw.checks.shots = (from, to) => shotcheck({ from, to, camera, cuts, subjects });   CHECK=shots:0,108 bun run render stills
// camera(t) -> { p, l, fov, roll? }: position, look point, vertical fov in degrees, roll in degrees (three: rotateZ after lookAt).
// cuts: the times of hard cuts. subjects(t) -> { name: { eye, at?, top?, look?, joints? } | null }: eye point, where the body
// stands (for screen direction; a head bob is not travel), top of the head, the point the subject looks at, and named joints whose slicing by a frame edge looks wrong (ankles, knees, wrists...);
// null hides a subject (a first-person shot). Points are [x, y, z] or {x, y, z} in metres, y up.
// What it checks, and whose rule it is:
//   jump cut: across a cut the same subject from under 30 degrees of change and under 20% change in size (A. Kim, "10 tips
//     to improve your CG layout", CG Channel 2018: the 30-degree and 20% rules).
//   line: across a cut two subjects swap screen sides, a moving subject's screen direction flips, or a gaze flips while the
//     look target stays put (the 180-degree rule; He, Cohen & Salesin, "The Virtual Cinematographer", SIGGRAPH 1996);
//     not across an overhead or worm's-eye shot, the neutral angle that lets a film cross the line.
//   pan: the view turns faster than one frame width per 7 s (RED's panning guide): the background strobes.
//   camera leads: a camera move starting before (or under 2 frames after) the subject's own move: an operator cannot predict
//     the actor, so a camera that knows ahead reads as animation (A. Kim, tip 7).
//   roll, zoom: a horizon tilted over 1.5 degrees, or the fov changing over 10% inside a shot (pros move the camera; Shotcraft,
//     "Layout artist": pick the lens, then move the camera instead of zooming to fix a composition).
//   framing: a frame edge slicing through a named joint (He et al.: cutting heights), the top of the head touching the
//     frame edge (a tangent), eyes below the middle of a close shot (too much headroom), a subject looking off the near edge
//     (no lead room) (A. Kim, tip 4); each only when it holds for 0.25 s.
//   flash cut: a shot under 0.4 s. A camera inside solid(p) when the film passes solid.
import { hfovOf, mmOf, nearestPrime } from "./lens";

export type Vec = [number, number, number] | { x: number; y: number; z: number };
export type Cam = { p: Vec; l: Vec; fov: number; roll?: number };
export type Subject = { eye: Vec; at?: Vec; top?: Vec; look?: Vec; joints?: Record<string, Vec> };
export const LIMITS = {
  jumpAngle: 30, // degrees
  jumpSize: 0.2, // fraction
  panSeconds: 7, // seconds per frame width
  leadFrames: 2, // the camera starts at least this many frames after the subject
  moving: 0.15, // m/s: a subject faster than this is moving
  walking: 0.4, // m/s along the ground: a subject travelling, for screen direction
  neutral: 60, // degrees: a camera looking down or up steeper than this is a neutral shot, which may cross the line
  camMoving: 0.1, // m/s
  camTurning: 5, // deg/s
  roll: 1.5, // degrees
  zoom: 0.1, // magnification change inside a shot (6% is a creep nobody sees, 15% is a zoom)
  edge: 0.04, // half the band (in NDC units, -1..1) around a frame edge that counts as touching it
  close: 0.15, // eye-to-top-of-head over this fraction of the frame height makes a close shot
  flash: 0.4, // seconds
  hold: 0.25, // seconds a framing problem must last to count (a limb sweeping past an edge is fine)
};
export type Opts = {
  from: number; to: number;
  camera: (t: number) => Cam;
  cuts: number[];
  subjects?: (t: number) => Record<string, Subject | null | undefined>;
  aspect?: number; fps?: number;
  solid?: (p: [number, number, number]) => boolean;
  limits?: Partial<typeof LIMITS>;
};

type V3 = [number, number, number];
const v = (a: Vec): V3 => (Array.isArray(a) ? [a[0], a[1], a[2]] : [a.x, a.y, a.z]);
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const n = len(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const deg = (r: number) => (r * 180) / Math.PI;
const angle = (a: V3, b: V3) => deg(Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))));

// The view as three.js builds it: lookAt with y up, then rotateZ(roll)
export type View = { p: V3; f: V3; r: V3; u: V3; fov: number; roll: number; tx: number; ty: number };
export function view(c: Cam, aspect = 16 / 9): View {
  const p = v(c.p), f = norm(sub(v(c.l), p));
  let r = cross(f, [0, 1, 0]);
  r = len(r) < 1e-9 ? [1, 0, 0] : norm(r);
  let u = cross(r, f);
  const roll = c.roll ?? 0, k = (roll * Math.PI) / 180, cs = Math.cos(k), sn = Math.sin(k);
  [r, u] = [add(r.map((x) => x * cs) as V3, u, sn), add(u.map((x) => x * cs) as V3, r, -sn)];
  const ty = Math.tan((c.fov * Math.PI) / 360);
  return { p, f, r, u, fov: c.fov, roll, tx: ty * aspect, ty };
}
// screen position in NDC (-1..1, y up) and depth in metres; depth <= 0 is behind the camera
export function project(w: View, q: Vec) {
  const d = sub(v(q), w.p), z = dot(d, w.f);
  return { x: dot(d, w.r) / (z * w.tx), y: dot(d, w.u) / (z * w.ty), z };
}
const onScreen = (s: { x: number; y: number; z: number }) => s.z > 0.05 && Math.abs(s.x) <= 1 && Math.abs(s.y) <= 1;

type Shot = { a: number; b: number; ts: number[]; views: View[]; subs: Record<string, Subject | null | undefined>[] };

function shotsOf(o: Opts) {
  const fps = o.fps ?? 30, aspect = o.aspect ?? 16 / 9;
  const bounds = [o.from, ...o.cuts.filter((c) => c > o.from && c < o.to).sort((a, b) => a - b), o.to];
  const shots: Shot[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], b = bounds[i + 1], ts: number[] = [];
    for (let t = a; t < b - 1e-6; t += 1 / fps) ts.push(t);
    ts.push(Math.max(a, b - 1e-3));
    shots.push({ a, b, ts, views: ts.map((t) => view(o.camera(t), aspect)), subs: ts.map((t) => o.subjects?.(t) ?? {}) });
  }
  return shots;
}

// consecutive samples that break a rule become one line: "a-b message"
class Runs {
  out: [number, string][] = [];
  open = new Map<string, { a: number; b: number; worst: number; say: (w: number) => string; min: number }>();
  hit(key: string, t: number, value: number, say: (w: number) => string, gap: number, min = 0) {
    const r = this.open.get(key);
    if (r && t - r.b <= gap) { r.b = t; if (Math.abs(value) > Math.abs(r.worst)) r.worst = value; return; }
    if (r) this.close(key);
    this.open.set(key, { a: t, b: t, worst: value, say, min });
  }
  close(key: string) { const r = this.open.get(key)!; if (r.b - r.a >= r.min - 1e-6) this.out.push([r.a, `${r.a.toFixed(2)}-${r.b.toFixed(2)} ${r.say(r.worst)}`]); this.open.delete(key); }
  flush() { for (const k of [...this.open.keys()]) this.close(k); }
}

export function shotcheck(o: Opts): string[] {
  const L = { ...LIMITS, ...o.limits }, fps = o.fps ?? 30, aspect = o.aspect ?? 16 / 9, dt = 1 / fps;
  const out: [number, string][] = [];
  const at = (t: number) => ({ w: view(o.camera(t), aspect), s: o.subjects?.(t) ?? {} });
  const sideways = (w: View, from: V3, dir: V3) => { const a = project(w, from), b = project(w, add(from, dir, 0.3)); return a.z > 0 && b.z > 0 ? b.x - a.x : 0; };

  // across each cut
  for (const c of o.cuts.filter((c) => c > o.from && c < o.to)) {
    const A = at(c - 1e-3), B = at(c + 1e-3), A0 = at(c - 0.1), B1 = at(c + 0.1);
    const names = Object.keys(A.s).filter((n) => A.s[n] && B.s[n]);
    const steep = (w: View) => Math.abs(deg(Math.asin(w.f[1]))) > L.neutral;
    const neutral = steep(A.w) || steep(B.w); // overhead or worm's-eye: the line has no side to keep
    const seen = names.filter((n) => onScreen(project(A.w, A.s[n]!.eye)) && onScreen(project(B.w, B.s[n]!.eye)));
    for (const n of seen) {
      const e = v(A.s[n]!.eye), pa = project(A.w, e), pb = project(B.w, v(B.s[n]!.eye));
      const turn = angle(sub(A.w.p, e), sub(B.w.p, v(B.s[n]!.eye)));
      const ratio = (pa.z * A.w.ty) / (pb.z * B.w.ty), size = Math.max(ratio, 1 / ratio) - 1;
      if (turn < L.jumpAngle && size < L.jumpSize)
        out.push([c, `${c.toFixed(2)} cut: jump cut on ${n} (${turn.toFixed(0)} deg, size ${ratio >= 1 ? "+" : "-"}${(size * 100).toFixed(0)}%): change the angle by ${L.jumpAngle}+ deg or the size by ${L.jumpSize * 100}%+`]);
    }
    for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) {
      const [m, n] = [seen[i], seen[j]];
      const da = project(A.w, A.s[m]!.eye).x - project(A.w, A.s[n]!.eye).x, db = project(B.w, B.s[m]!.eye).x - project(B.w, B.s[n]!.eye).x;
      if (!neutral && Math.abs(da) > 0.05 && Math.abs(db) > 0.05 && Math.sign(da) !== Math.sign(db))
        out.push([c, `${c.toFixed(2)} cut: ${m} and ${n} swap screen sides (crossed the 180-degree line)`]);
    }
    for (const n of neutral ? [] : names) {
      const s = A.s[n]!, s2 = B.s[n]!, foot = (x?: Subject | null) => v(x?.at ?? x?.eye ?? [0, 0, 0]);
      const ground = (d: V3): V3 => [d[0] / 0.1, 0, d[2] / 0.1];
      const before = ground(sub(foot(s), A0.s[n] ? foot(A0.s[n]) : foot(s))), after = ground(sub(B1.s[n] ? foot(B1.s[n]) : foot(s2), foot(s2)));
      if (len(before) > L.walking && len(after) > L.walking) {
        const xa = sideways(A.w, foot(s), norm(before)), xb = sideways(B.w, foot(s2), norm(after));
        if (Math.abs(xa) > 0.02 && Math.abs(xb) > 0.02 && Math.sign(xa) !== Math.sign(xb))
          out.push([c, `${c.toFixed(2)} cut: ${n} moves ${xa > 0 ? "right" : "left"} before and ${xb > 0 ? "right" : "left"} after (screen direction flips)`]);
      }
      if (s.look && s2.look && len(sub(v(s.look), v(s2.look))) < 0.3) {
        const xa = sideways(A.w, v(s.eye), norm(sub(v(s.look), v(s.eye)))), xb = sideways(B.w, v(s2.eye), norm(sub(v(s2.look), v(s2.eye))));
        if (Math.abs(xa) > 0.02 && Math.abs(xb) > 0.02 && Math.sign(xa) !== Math.sign(xb))
          out.push([c, `${c.toFixed(2)} cut: ${n} looks ${xa > 0 ? "right" : "left"} before and ${xb > 0 ? "right" : "left"} after at the same thing (eyeline flips)`]);
      }
    }
  }

  // inside each shot
  for (const S of shotsOf(o)) {
    const R = new Runs(), gap = 1.5 * dt;
    const len_ = S.b - S.a;
    const truncated = (S.a === o.from && !o.cuts.includes(o.from)) || S.b === o.to;
    if (len_ < L.flash && !truncated) out.push([S.a, `${S.a.toFixed(2)}-${S.b.toFixed(2)} shot lasts ${Math.round(len_ * fps)} frames: a flash cut, meant?`]);
    const fovs = S.views.map((w) => w.fov), lo = Math.min(...fovs), hi = Math.max(...fovs), tan = (f: number) => Math.tan((f * Math.PI) / 360);
    if (tan(hi) / tan(lo) - 1 > L.zoom) out.push([S.a, `${S.a.toFixed(2)}-${S.b.toFixed(2)} fov ${fovs[0].toFixed(0)} -> ${fovs[fovs.length - 1].toFixed(0)} deg (range ${lo.toFixed(0)}-${hi.toFixed(0)}) inside the shot: a zoom; move the camera unless the zoom is the point`]);

    const camOn: boolean[] = [], subOn: Record<string, boolean[]> = {};
    S.ts.forEach((t, i) => {
      const w = S.views[i], s = S.subs[i];
      if (Math.abs(w.roll) > L.roll) R.hit("roll", t, w.roll, (x) => `horizon tilted up to ${x.toFixed(1)} deg: meant (a Dutch angle)?`, gap);
      if (o.solid?.(w.p)) R.hit("solid", t, 1, () => "camera inside a wall", gap);
      if (i > 0) {
        const pw = S.views[i - 1], h = S.ts[i] - S.ts[i - 1];
        const turn = angle(pw.f, w.f) / h, limit = hfovOf(w.fov, aspect) / L.panSeconds;
        if (turn > limit) R.hit("pan", t, turn, (x) => `pans up to ${x.toFixed(0)} deg/s; this lens wants under ${limit.toFixed(0)} (a frame width per ${L.panSeconds} s) or the picture strobes`, gap);
        camOn.push(len(sub(w.p, pw.p)) / h > L.camMoving || turn > L.camTurning);
      } else camOn.push(false);
      for (const [n, x] of Object.entries(s)) {
        subOn[n] ??= Array(i).fill(false);
        const prev = i > 0 ? S.subs[i - 1][n] : null;
        subOn[n].push(!!(x && prev && len(sub(v(x.eye), v(prev.eye))) / (S.ts[i] - S.ts[i - 1]) > L.moving));
        if (!x) continue;
        const e = project(w, x.eye);
        if (!onScreen(e)) continue;
        for (const [j, q] of Object.entries(x.joints ?? {})) {
          const pj = project(w, q);
          if (pj.z <= 0.05) continue;
          const edge = Math.abs(pj.x) <= 1 && Math.abs(Math.abs(pj.y) - 1) < L.edge ? (pj.y > 0 ? "top" : "bottom")
            : Math.abs(pj.y) <= 1 && Math.abs(Math.abs(pj.x) - 1) < L.edge ? (pj.x > 0 ? "right" : "left") : "";
          if (edge) R.hit(`joint ${n} ${j} ${edge}`, t, 1, () => `${edge} edge cuts ${n} at ${j}: frame above or below the joint`, gap, L.hold);
        }
        if (x.top) {
          const top = project(w, x.top), head = (top.y - e.y) / 2;
          if (Math.abs(top.y - 1) < L.edge * 0.75 && Math.abs(top.x) <= 1) R.hit(`tangent ${n}`, t, 1, () => `top of ${n}'s head touches the frame edge: leave room or cut into the forehead`, gap, L.hold);
          if (head > L.close && e.y < 0) R.hit(`headroom ${n}`, t, e.y, () => `${n}'s eyes sit below the middle of a close shot: too much headroom (eyes near the upper third)`, gap, L.hold);
        }
        if (x.look) {
          const dx = sideways(w, v(x.eye), norm(sub(v(x.look), v(x.eye))));
          if (Math.abs(dx) > 0.05 && e.x * Math.sign(dx) > 0.2) R.hit(`leadroom ${n}`, t, e.x, () => `${n} looks off the near edge: give the gaze side the room (lead room)`, gap, L.hold);
        }
      }
    });
    // the camera should follow a move, never foresee it: compare where camera and subject moves start
    const starts = (on: boolean[]) => on.flatMap((x, i) => { const q = Math.round(0.25 * fps); return x && i >= q && on.slice(i - q, i).every((y) => !y) ? [S.ts[i]] : []; });
    for (const tc of starts(camOn)) for (const [n, on] of Object.entries(subOn)) {
      const ts = starts(on).filter((t) => Math.abs(t - tc) < 0.75).sort((a, b) => Math.abs(a - tc) - Math.abs(b - tc))[0];
      if (ts !== undefined && tc < ts + L.leadFrames / fps - 1e-6) {
        const f = Math.round((ts - tc) * fps);
        out.push([tc, `${tc.toFixed(2)} camera starts ${f > 0 ? `${f} frames before` : "with"} ${n}'s move: start it ${L.leadFrames}-6 frames after`]);
      }
    }
    R.flush();
    out.push(...R.out);
  }
  return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

// One line per shot: span, length, lens, and where each visible subject's eyes and head top sit (x, y in -1..1, y up); then
// the average and median shot length (Hollywood features after 2000: about 4 s; Bordwell 2002, Cutting et al. 2011).
export function shotlist(o: Opts): string[] {
  const aspect = o.aspect ?? 16 / 9, out: string[] = [], lengths: number[] = [];
  const shots = shotsOf({ ...o, fps: 4 });
  for (const S of shots) {
    const i = Math.floor(S.ts.length / 2), w = S.views[i], s = S.subs[i];
    const mm = mmOf(w.fov, aspect);
    lengths.push(S.b - S.a);
    const who = Object.entries(s).flatMap(([n, x]) => {
      if (!x) return [];
      const e = project(w, x.eye);
      if (!onScreen(e)) return [];
      const sg = (k: number) => `${k >= 0 ? "+" : ""}${k.toFixed(2)}`;
      const top = x.top ? ` top y${sg(project(w, x.top).y)}` : "";
      return [`${n} eyes x${sg(e.x)} y${sg(e.y)}${top}`];
    });
    out.push(`${S.a.toFixed(2)}-${S.b.toFixed(2)} ${(S.b - S.a).toFixed(1)} s ${mm.toFixed(0)} mm (prime ${nearestPrime(mm)}) ${who.join(", ") || "-"}`);
  }
  const sorted = [...lengths].sort((a, b) => a - b), mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  out.push(`${lengths.length} shots, average ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)} s, median ${median.toFixed(1)} s`);
  return out;
}
