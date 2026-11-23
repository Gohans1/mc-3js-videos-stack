export const TPS = 20;
export const KINDS = {
  living: { order: "pad", g: 0.08, dv: 0.98, dh: 0.91 },
  slowFalling: { order: "pad", g: 0.01, dv: 0.98, dh: 0.91 },
  block: { order: "apd", g: 0.04, dv: 0.98, dh: 0.98 },
  item: { order: "apd", g: 0.04, dv: 0.98, dh: 0.98 },
  xp: { order: "apd", g: 0.03, dv: 0.98, dh: 0.98 },
  thrown: { order: "adp", g: 0.03, dv: 0.99, dh: 0.99 },
  potion: { order: "adp", g: 0.05, dv: 0.99, dh: 0.99 },
  arrow: { order: "pda", g: 0.05, dv: 0.99, dh: 0.99 },
} as const;
export type Kind = keyof typeof KINDS;
export const FRICTION = { normal: 0.6, slime: 0.8, ice: 0.98, blueIce: 0.989 };
export const MC = {
  jump: 0.42,
  knock: 0.4,
  hurt: 10,
  death: 20,
  flip: 90,
  fallHurts: 3,
  speed: { walk: 4.317, sprint: 5.612, sneak: 1.295 },
};

type V3 = [number, number, number];
type Ground = number | ((x: number, z: number) => number);
const floorAt = (g: Ground, x: number, z: number) => (typeof g === "number" ? g : g(x, z));

type State = { p: V3; v: V3; on: boolean };
function tick(
  s: State,
  k: { order: string; g: number; dv: number; dh: number },
  ground: Ground,
  friction: number,
  stick: boolean,
) {
  let landedFrom = -1;
  for (const op of k.order) {
    if (op === "a") s.v[1] -= k.g;
    else if (op === "d") {
      const h = s.on ? k.dh * friction : k.dh;
      s.v[0] *= h;
      s.v[1] *= k.dv;
      s.v[2] *= h;
    } else {
      s.p = [s.p[0] + s.v[0], s.p[1] + s.v[1], s.p[2] + s.v[2]];
      const f = floorAt(ground, s.p[0], s.p[2]);
      if (s.p[1] <= f && s.v[1] <= 0) {
        if (!s.on) landedFrom = 1;
        s.p[1] = f;
        s.v[1] = 0;
        s.on = true;
        if (stick) s.v = [0, 0, 0];
      } else if (s.p[1] > f + 1e-6) s.on = false;
    }
  }
  return landedFrom;
}

const lerp3 = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

export function fly(
  kind: Kind,
  p0: V3,
  v0: V3,
  {
    t0 = 0,
    ground = -Infinity as Ground,
    friction = FRICTION.normal,
    ticks = 1200,
    stick = kind === "arrow",
  } = {},
) {
  const k = KINDS[kind],
    s: State = { p: [...p0] as V3, v: [...v0] as V3, on: false };
  const P: V3[] = [s.p],
    landings: { t: number; v: number }[] = [];
  for (let i = 1; i <= ticks; i++) {
    const vy = s.v[1];
    if (tick(s, k, ground, friction, stick) > 0) landings.push({ t: t0 + i / TPS, v: -vy });
    P.push(s.p);
  }
  const at = (t: number) => {
    const x = Math.min(Math.max((t - t0) * TPS, 0), ticks - 1e-6),
      i = Math.floor(x);
    return lerp3(P[i], P[i + 1], x - i);
  };
  return Object.assign((t: number) => ({ p: at(t) }), { landings });
}

export type McEvent = {
  t: number;
  hit?: [number, number];
  from?: [number, number];
  strength?: number;
  jump?: boolean;
  die?: boolean;
  push?: V3;
};
export function mcBody(
  p0: V3,
  events: McEvent[],
  { ground = 0 as Ground, friction = FRICTION.normal, end = 60, flip = MC.flip, resist = 0 } = {},
) {
  const k = KINDS.living,
    n = Math.ceil(end * TPS) + 2;
  const s: State = { p: [...p0] as V3, v: [0, 0, 0], on: true };
  const P: V3[] = [],
    V: V3[] = [],
    ON: boolean[] = [];
  const evs = [...events].sort((a, b) => a.t - b.t);
  const out: { t: number; kind: "land" | "hit" | "jump" | "die"; fall?: number; at: V3 }[] = [];
  let e = 0,
    top = s.p[1],
    died = Infinity;
  const hits: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / TPS;
    while (e < evs.length && evs[e].t <= t) {
      const x = evs[e++];
      if (x.die && died === Infinity) {
        died = x.t;
        out.push({ t: x.t, kind: "die", at: s.p });
      }
      if (x.jump && s.on) {
        s.v[1] = MC.jump;
        s.on = false;
        out.push({ t: x.t, kind: "jump", at: s.p });
      }
      if (x.push) s.v = [s.v[0] + x.push[0], s.v[1] + x.push[1], s.v[2] + x.push[2]];
      if (x.hit || x.from) {
        hits.push(x.t);
        out.push({ t: x.t, kind: "hit", at: s.p });
        const str = (x.strength ?? MC.knock) * (1 - resist);
        let [dx, dz] = x.from ?? [x.hit![0] - s.p[0], x.hit![1] - s.p[2]];
        const d = Math.hypot(dx, dz) || 1;
        dx = (dx / d) * str;
        dz = (dz / d) * str;
        s.v = [s.v[0] / 2 - dx, s.on ? Math.min(0.4, s.v[1] / 2 + str) : s.v[1], s.v[2] / 2 - dz];
        if (s.on) s.on = false;
      }
    }
    P.push(s.p);
    V.push([...s.v] as V3);
    ON.push(s.on);
    if (!s.on) top = Math.max(top, s.p[1]);
    if (tick(s, k, ground, friction, false) > 0) {
      out.push({ t: (i + 1) / TPS, kind: "land", fall: top - s.p[1], at: s.p });
      top = s.p[1];
    }
    if (s.on) top = s.p[1];
  }
  const read = (t: number) => {
    const x = Math.min(Math.max(t * TPS, 0), n - 1 - 1e-6),
      i = Math.floor(x);
    return { i, f: x - i };
  };
  const body = (t: number) => {
    const { i, f } = read(t);
    const dt = (t - died) * TPS;
    const hurt = hits.some((h) => t >= h && t < h + MC.hurt / TPS);
    return {
      p: lerp3(P[i], P[i + 1], f),
      v: V[i],
      onGround: ON[i],
      red: hurt || dt >= 0,
      roll: dt > 0 ? Math.min(1, Math.sqrt(Math.max(0, (dt - 1) / 20) * 1.6)) * flip : 0,
      gone: dt >= MC.death,
      puff: dt >= MC.death ? (dt - MC.death) / TPS : -1,
    };
  };
  return Object.assign(body, { events: out });
}

export function jumpArc(v0 = MC.jump) {
  const s: State = { p: [0, 0, 0], v: [0, v0, 0], on: false };
  let top = 0,
    i = 0;
  do {
    tick(s, KINDS.living, 0, FRICTION.normal, false);
    top = Math.max(top, s.p[1]);
    i++;
  } while (!s.on && i < 400);
  return { height: top, ticks: i };
}
