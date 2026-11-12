import { expect, test } from "bun:test";

import {
  TRANSITION_EASES,
  transitionAt,
  transitionLength,
  transitionProgress,
  TRANSITIONS,
  viewTime,
} from "../src/transitions";

const shots = [{ t: 0 }, { t: 4, transition: { fx: "dissolve", len: 2 } }, { t: 10 }];

test("a transition straddles the cut, without moving the cut or changing film time", () => {
  expect(transitionAt(shots, 14, 2.9)).toBeNull();
  expect(transitionAt(shots, 14, 3)).toMatchObject({ shot: 1, progress: 0, fx: "dissolve" });
  expect(transitionAt(shots, 14, 4)).toMatchObject({ shot: 1, progress: 0.5 });
  expect(transitionAt(shots, 14, 5)).toBeNull();
  expect(shots[1].t).toBe(4);
});

test("long transitions share short shots without overlapping adjacent transitions", () => {
  const short = [
    { t: 0 },
    { t: 4, transition: { fx: "wipe", len: 20 } },
    { t: 5, transition: { fx: "black", len: 20 } },
  ];
  expect(transitionLength(short, 10, 1)).toBe(1);
  expect(transitionLength(short, 10, 2)).toBe(1);
  expect(transitionAt(short, 10, 4.49)?.shot).toBe(1);
  expect(transitionAt(short, 10, 4.5)?.shot).toBe(2);
});

test("each view stays inside its camera shot while the world keeps its actual time", () => {
  expect(viewTime(shots, 14, 0, 4.5)).toBeCloseTo(4 - 1e-6, 8);
  expect(viewTime(shots, 14, 1, 3.5)).toBe(4);
  expect(viewTime(shots, 14, 1, 5)).toBe(5);
});

test("first shots, unknown effects and invalid durations never create a transition", () => {
  for (const transition of [
    { fx: "unknown", len: 1 },
    { fx: "black", len: -1 },
    { fx: "wipe", len: Infinity },
  ]) {
    expect(transitionAt([{ t: 0 }, { t: 4, transition }], 8, 4)).toBeNull();
  }
  expect(transitionAt([{ t: 0, transition: { fx: "black", len: 1 } }], 8, 0)).toBeNull();
});

test("transition ids are unique, so a shot's fx names one shader (compile and hand-over: transitions-gpu.test.ts)", () => {
  expect(new Set(TRANSITIONS.map((t) => t.id)).size).toBe(TRANSITIONS.length);
});

test("transition settings warp progress with Cinetic curves and normalize feather and flip", () => {
  expect(TRANSITION_EASES.map((e) => e.id)).toEqual(["auto", "linear", "smooth", "snap", "glide"]);
  expect(transitionProgress(0.25, "snap")).toBeGreaterThan(0.5);
  expect(transitionProgress(0.25, "linear")).toBeCloseTo(0.25, 5);
  expect(transitionProgress(0.25, [0, 0.9, 0.2, 1])).toBeGreaterThan(0.5);

  const styled = [
    { t: 0 },
    {
      t: 4,
      transition: { fx: "softWipe", len: 2, ease: "snap" as const, feather: 0.85, flip: true },
    },
    { t: 10 },
  ];
  const hit = transitionAt(styled, 14, 3.5);
  expect(hit).not.toBeNull();
  expect(hit!.rawProgress).toBeCloseTo(0.25, 5);
  expect(hit!.progress).toBeGreaterThan(0.5);
  expect(hit!.feather).toBeCloseTo(0.85, 5);
  expect(hit!.flip).toBe(true);

  const clamped = [
    { t: 0 },
    { t: 4, transition: { fx: "irisOpen", len: 2, feather: 5 } },
    { t: 10 },
  ];
  expect(transitionAt(clamped, 14, 4)?.feather).toBe(1);
});

test("supports custom film-defined transitions without closed-enum cages", () => {
  const custom = [
    {
      id: "portalVortex",
      title: "Portal Vortex",
      tip: "Custom film swirl transition",
      category: "Custom",
      glsl: "vec4 transition(vec2 uv) { return mix(getFromColor(uv), getToColor(uv), progress); }",
    },
  ];
  const filmShots = [{ t: 0 }, { t: 5, transition: { fx: "portalVortex", len: 1.6 } }, { t: 10 }];
  expect(transitionLength(filmShots, 12, 1, custom)).toBeCloseTo(1.6, 5);
  expect(transitionAt(filmShots, 12, 5, custom)).toMatchObject({
    shot: 1,
    fx: "portalVortex",
    progress: 0.5,
  });
});

test("a film-defined transition's own ease is its Natural curve, and a shot's ease still overrides it", () => {
  const custom = [
    {
      id: "slamPortal",
      title: "Slam Portal",
      tip: "Custom",
      category: "Custom",
      ease: "snapOut" as const,
      glsl: "vec4 transition(vec2 uv) { return mix(getFromColor(uv), getToColor(uv), progress); }",
    },
  ];
  const natural = [{ t: 0 }, { t: 5, transition: { fx: "slamPortal", len: 2 } }, { t: 10 }];
  expect(transitionAt(natural, 12, 4.5, custom)?.progress).toBeCloseTo(
    transitionProgress(0.25, "snapOut"),
    6,
  );
  const linear = [
    { t: 0 },
    { t: 5, transition: { fx: "slamPortal", len: 2, ease: "linear" as const } },
    { t: 10 },
  ];
  expect(transitionAt(linear, 12, 4.5, custom)?.progress).toBeCloseTo(0.25, 6);
});

type GlVal = number | number[];
const vMap = (a: GlVal, b: GlVal, f: (x: number, y: number) => number): GlVal =>
  Array.isArray(a)
    ? a.map((x, i) => f(x, Array.isArray(b) ? b[i] : b))
    : Array.isArray(b)
      ? b.map((y) => f(a, y))
      : f(a, b);
const v1 = (a: GlVal, f: (x: number) => number): GlVal => (Array.isArray(a) ? a.map(f) : f(a));
const flat = (xs: GlVal[]) => xs.flatMap((x) => (Array.isArray(x) ? x : [x]));
const smooth1 = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0 || 1e-9)));
  return t * t * (3 - 2 * t);
};

function evalGlslTransition(
  glsl: string,
  uv: [number, number],
  u: { progress: number; uFeather: number; uFlip: number; uRatio: number },
  fromFn: (p: [number, number]) => [number, number, number, number],
  toFn: (p: [number, number]) => [number, number, number, number],
): [number, number, number, number] {
  const toks =
    glsl.match(/\d+\.\d*|\.\d+|\d+|[A-Za-z_]\w*|<=|>=|==|!=|\+=|\+\+|[+\-*/<>?:(),;{}.=]/g) ?? [];
  let p = toks.indexOf("{") + 1;
  const builtins: Record<string, (...a: GlVal[]) => GlVal> = {
    float: (x) => Number(x),
    vec2: (...a) => {
      const f = flat(a);
      return f.length === 1 ? [f[0], f[0]] : [f[0], f[1]];
    },
    vec3: (...a) => {
      const f = flat(a);
      return f.length === 1 ? [f[0], f[0], f[0]] : [f[0], f[1], f[2]];
    },
    vec4: (...a) => {
      const f = flat(a);
      return f.length === 1 ? [f[0], f[0], f[0], f[0]] : [f[0], f[1], f[2], f[3]];
    },
    mix: (a, b, t) => vMap(a, b, (x, y) => x + (y - x) * (Array.isArray(t) ? t[0] : t)),
    smoothstep: (e0, e1, x) =>
      Array.isArray(x)
        ? x.map((xi, i) =>
            smooth1(Array.isArray(e0) ? e0[i] : e0, Array.isArray(e1) ? e1[i] : e1, xi),
          )
        : smooth1(e0 as number, e1 as number, x),
    step: (edge, x) => vMap(edge, x, (e, v) => (v < e ? 0 : 1)),
    clamp: (x, lo, hi) =>
      Array.isArray(x)
        ? x.map((xi, i) =>
            Math.max(Array.isArray(lo) ? lo[i] : lo, Math.min(Array.isArray(hi) ? hi[i] : hi, xi)),
          )
        : Math.max(lo as number, Math.min(hi as number, x)),
    pow: (a, b) => vMap(a, b, (x, y) => Math.pow(Math.max(0, x), y)),
    exp: (a) => v1(a, Math.exp),
    exp2: (a) => v1(a, (x) => 2 ** x),
    sin: (a) => v1(a, Math.sin),
    cos: (a) => v1(a, Math.cos),
    atan: (y, x) => Math.atan2(y as number, x as number),
    abs: (a) => v1(a, Math.abs),
    floor: (a) => v1(a, Math.floor),
    fract: (a) => v1(a, (x) => x - Math.floor(x)),
    min: (a, b) => vMap(a, b, Math.min),
    max: (a, b) => vMap(a, b, Math.max),
    sign: (a) => v1(a, (x) => (x > 0 ? 1 : x < 0 ? -1 : 0)),
    length: (a) => Math.hypot(...(Array.isArray(a) ? a : [a])),
    dot: (a, b) => (a as number[]).reduce((s, x, i) => s + x * (b as number[])[i], 0),
    getFromColor: (q) => {
      const c = q as number[];
      return fromFn([
        Math.max(0.0005, Math.min(0.9995, c[0])),
        Math.max(0.0005, Math.min(0.9995, c[1])),
      ]);
    },
    getToColor: (q) => {
      const c = q as number[];
      return toFn([
        Math.max(0.0005, Math.min(0.9995, c[0])),
        Math.max(0.0005, Math.min(0.9995, c[1])),
      ]);
    },
  };
  const env: Record<string, GlVal> = { uv: [...uv], ...u };
  const swiz: Record<string, number[]> = { x: [0], y: [1], r: [0], g: [1], b: [2], rgb: [0, 1, 2] };
  const expr = (): GlVal => {
    const c = cmp();
    if (toks[p] === "?") {
      p++;
      const t = expr();
      p++;
      const f = expr();
      return c ? t : f;
    }
    return c;
  };
  const cmp = (): GlVal => {
    let l = add();
    while (["<", ">", "<=", ">=", "=="].includes(toks[p])) {
      const op = toks[p++];
      const r = add() as number;
      const lv = l as number;
      l =
        op === "<"
          ? +(lv < r)
          : op === ">"
            ? +(lv > r)
            : op === "<="
              ? +(lv <= r)
              : op === ">="
                ? +(lv >= r)
                : +(lv === r);
    }
    return l;
  };
  const add = (): GlVal => {
    let l = mul();
    while (toks[p] === "+" || toks[p] === "-") {
      const op = toks[p++];
      const r = mul();
      l = vMap(l, r, (a, b) => (op === "+" ? a + b : a - b));
    }
    return l;
  };
  const mul = (): GlVal => {
    let l = unary();
    while (toks[p] === "*" || toks[p] === "/") {
      const op = toks[p++];
      const r = unary();
      l = vMap(l, r, (a, b) => (op === "*" ? a * b : a / b));
    }
    return l;
  };
  const unary = (): GlVal => (toks[p] === "-" ? (p++, v1(unary(), (x) => -x)) : post());
  const post = (): GlVal => {
    let v = prim();
    while (toks[p] === ".") {
      p++;
      const idx = swiz[toks[p++]];
      const arr = v as number[];
      v = idx.length === 1 ? arr[idx[0]] : idx.map((i) => arr[i]);
    }
    return v;
  };
  const prim = (): GlVal => {
    const t = toks[p++];
    if (t === "(") {
      const v = expr();
      p++;
      return v;
    }
    if (/^[\d.]/.test(t)) return Number(t);
    if (toks[p] === "(") {
      p++;
      const args: GlVal[] = [];
      if (toks[p] !== ")") {
        args.push(expr());
        while (toks[p] === ",") {
          p++;
          args.push(expr());
        }
      }
      p++;
      return builtins[t](...args);
    }
    return env[t];
  };
  const block = (): GlVal | undefined => {
    while (p < toks.length && toks[p] !== "}") {
      if (toks[p] === "{") {
        p++;
        const r = block();
        p++;
        if (r !== undefined) return r;
        continue;
      }
      if (toks[p] === "return") {
        p++;
        const v = expr();
        p++;
        return v;
      }
      if (toks[p] === "if") {
        p += 2;
        const c = expr();
        p++;
        const start = p;
        if (c) {
          p++;
          const r = block();
          p++;
          if (r !== undefined) return r;
        } else {
          let d = 0;
          do {
            if (toks[p] === "{") d++;
            if (toks[p] === "}") d--;
            p++;
          } while (d > 0);
        }
        void start;
        continue;
      }
      if (toks[p] === "for") {
        p += 3; // for ( int
        const vName = toks[p++];
        p++; // =
        env[vName] = expr();
        p++; // ;
        const condPos = p;
        while (toks[p] !== ";") p++;
        p++;
        const stepVar = toks[p++];
        p += 2; // ++ )
        const bodyPos = p;
        while (true) {
          p = condPos;
          const ok = expr();
          if (!ok) break;
          p = bodyPos + 1;
          const r = block();
          if (r !== undefined) return r;
          env[stepVar] = (env[stepVar] as number) + 1;
        }
        p = bodyPos;
        let d = 0;
        do {
          if (toks[p] === "{") d++;
          if (toks[p] === "}") d--;
          p++;
        } while (d > 0);
        continue;
      }
      if (["float", "int", "vec2", "vec3", "vec4"].includes(toks[p])) p++;
      const id = toks[p++];
      const op = toks[p++];
      const val = expr();
      p++;
      env[id] = op === "+=" ? vMap(env[id], val, (a, b) => a + b) : val;
    }
    return undefined;
  };
  return block() as [number, number, number, number];
}

test("every transition shader starts cleanly on From at progress=0, lands cleanly on To at progress=1, and reverses spatially when uFlip=1", () => {
  const fromPat = ([x, y]: [number, number]): [number, number, number, number] => [
    0.15 + 0.5 * x,
    0.2 + 0.4 * y,
    0.75 - 0.3 * x,
    1,
  ];
  const toPat = ([x, y]: [number, number]): [number, number, number, number] => [
    0.85 - 0.4 * y,
    0.1 + 0.6 * x,
    0.25 + 0.5 * y,
    1,
  ];
  const uvs: [number, number][] = [
    [0.5, 0.5],
    [0.001, 0.001],
    [0.999, 0.999],
    [0.001, 0.5],
    [0.999, 0.5],
    [0.5, 0.001],
    [0.5, 0.999],
    [0.23, 0.67],
    [0.77, 0.31],
  ];
  for (const tr of TRANSITIONS) {
    for (const uFlip of [0, 1]) {
      for (const uFeather of [0, 1]) {
        for (const uv of uvs) {
          const at0 = evalGlslTransition(
            tr.glsl,
            uv,
            { progress: 0, uFeather, uFlip, uRatio: 16 / 9 },
            fromPat,
            toPat,
          );
          const want0 = fromPat(uv);
          for (let c = 0; c < 3; c++) {
            expect(
              Math.abs(at0[c] - want0[c]),
              `${tr.id} p=0 flip=${uFlip} feather=${uFeather} uv=${uv} ch=${c}`,
            ).toBeLessThan(2e-3);
          }
          const at1 = evalGlslTransition(
            tr.glsl,
            uv,
            { progress: 1, uFeather, uFlip, uRatio: 16 / 9 },
            fromPat,
            toPat,
          );
          const want1 = toPat(uv);
          for (let c = 0; c < 3; c++) {
            expect(
              Math.abs(at1[c] - want1[c]),
              `${tr.id} p=1 flip=${uFlip} feather=${uFeather} uv=${uv} ch=${c}`,
            ).toBeLessThan(2e-3);
          }
        }
      }
    }
    if (tr.glsl.includes("uFlip")) {
      const diffMid = uvs.some((uv) => {
        const a = evalGlslTransition(
          tr.glsl,
          uv,
          { progress: 0.35, uFeather: 0.5, uFlip: 0, uRatio: 16 / 9 },
          fromPat,
          toPat,
        );
        const b = evalGlslTransition(
          tr.glsl,
          uv,
          { progress: 0.35, uFeather: 0.5, uFlip: 1, uRatio: 16 / 9 },
          fromPat,
          toPat,
        );
        return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-3;
      });
      expect(diffMid, `${tr.id} uFlip spatial reversal`).toBe(true);
    }
  }
});
