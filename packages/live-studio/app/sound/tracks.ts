import { classifyPopularSound } from "../../src/sound-kit-classify.mjs";

export const TRACK_ROLES = [
  "voice",
  "bgm",
  "whoosh",
  "riser",
  "pop-ui",
  "impact",
  "ambience",
  "custom",
] as const;

export type TrackRole = (typeof TRACK_ROLES)[number];

export interface TrackRoleMeta {
  id: TrackRole;
  label: string;
  tier: "core" | "custom";
}

export const TRACK_ROLE_META: Record<TrackRole, TrackRoleMeta> = {
  voice: { id: "voice", label: "Voice", tier: "core" },
  bgm: { id: "bgm", label: "BGM", tier: "core" },
  whoosh: { id: "whoosh", label: "Whoosh", tier: "core" },
  riser: { id: "riser", label: "Riser", tier: "core" },
  "pop-ui": { id: "pop-ui", label: "Pop & UI", tier: "core" },
  impact: { id: "impact", label: "Impact", tier: "core" },
  ambience: { id: "ambience", label: "Ambience", tier: "core" },
  custom: { id: "custom", label: "Custom", tier: "custom" },
};

const ROLE_ORDER = new Map<TrackRole, number>(TRACK_ROLES.map((r, i) => [r, i]));

export const isTrackRole = (value: unknown): value is TrackRole =>
  typeof value === "string" && ROLE_ORDER.has(value as TrackRole);

export interface Track {
  id: string;
  name: string;
  role?: TrackRole;
  mute?: boolean;
  lock?: boolean;
  gain?: number;
  filters?: string[];
  [k: string]: unknown;
}
export type List = "beds" | "sfx";
export interface Ref {
  list: List;
  i: number;
}
interface Entry {
  track?: string;
  name?: string;
  dialogue?: boolean;
  length?: number;
  [k: string]: unknown;
}
export interface Tracked {
  beds: Entry[];
  sfx: Entry[];
  tracks?: Track[];
  narration?: string;
  [k: string]: unknown;
}
export type SpanOf = (r: Ref) => [number, number];
export type RoleOf = (r: Ref) => TrackRole;

const CARTOON_POP_RE =
  /\b(boing|cartoon|spring|twang|squeak|squeaks|bonk|honk|slide[\s-]?whistle|whistle|record[\s-]?scratch|vinyl[\s-]?scratch|fail[\s-]?chime|buzzer)\b/i;

export function inferClipTrackRole(
  clip: { name: string; dialogue?: boolean; length?: number },
  list: List,
  item?: {
    name?: string;
    title?: string;
    for?: string;
    category?: string;
    role?: string;
    kind?: string;
    seconds?: number;
  } | null,
  narrationName?: string,
  durationSec?: number,
): TrackRole {
  if (clip.dialogue || (narrationName && clip.name === narrationName)) return "voice";
  const probe = item
    ? { ...item, name: item.name ?? clip.name }
    : { name: clip.name, kind: list === "beds" ? "bgm" : "sfx" };
  if (list === "beds") {
    if (item?.kind === "bgm") return "bgm";
    if (classifyPopularSound(probe) === "ambience") return "ambience";
    return "bgm";
  }
  const kitCat = classifyPopularSound(probe);
  if (kitCat === "bgm") return "bgm";
  if (kitCat === "whoosh") return "whoosh";
  if (kitCat === "riser") return "riser";
  if (kitCat === "pop-ui") return "pop-ui";
  if (kitCat === "impact") return "impact";
  if (kitCat === "ambience") {
    const cat = String(item?.category ?? "").toLowerCase();
    const dur = durationSec ?? clip.length ?? item?.seconds ?? 0;
    return cat === "ambience" || dur >= 4 ? "ambience" : "custom";
  }
  if (kitCat === "comedy-glitch") {
    const cat = String(item?.category ?? "").toLowerCase();
    const titleText = `${clip.name} ${item?.title ?? ""}`.replaceAll("_", " ");
    return cat === "comedy" || CARTOON_POP_RE.test(titleText) ? "pop-ui" : "custom";
  }
  return "custom";
}

const roleFromTrackName = (name?: string): TrackRole | null => {
  const s = (name ?? "").trim().toLowerCase();
  if (/^(voice|vox|dialogue|narration)\b/.test(s)) return "voice";
  if (/^(bgm|music|bed)\b/.test(s)) return "bgm";
  if (/^(whoosh|transition|whip)\b/.test(s)) return "whoosh";
  if (/^(riser|swell)\b/.test(s)) return "riser";
  if (/^(pop|ui|chime|click)\b/.test(s)) return "pop-ui";
  if (/^(impact|hit|boom|thud)\b/.test(s)) return "impact";
  if (/^(ambience|ambient|atmos|room)\b/.test(s)) return "ambience";
  if (/^(custom|foley|scene)\b/.test(s)) return "custom";
  return null;
};

export const inferTrackRole = (l: Tracked, track: Track, roleOf?: RoleOf): TrackRole => {
  if (isTrackRole(track.role)) return track.role;
  if (roleOf) {
    const counts = new Map<TrackRole, number>();
    for (const r of refs(l)) {
      if (entry(l, r).track !== track.id) continue;
      const role = roleOf(r);
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    if (counts.size > 0) {
      return [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || ROLE_ORDER.get(a[0])! - ROLE_ORDER.get(b[0])!,
      )[0][0];
    }
  }
  return roleFromTrackName(track.name) ?? "custom";
};

export const firstCustomTrackIndex = (l: Tracked, roleOf?: RoleOf): number => {
  const ts = l.tracks ?? [];
  let sawCore = false;
  for (let i = 0; i < ts.length; i++) {
    const role = inferTrackRole(l, ts[i], roleOf);
    if (TRACK_ROLE_META[role].tier === "core") sawCore = true;
    else if (sawCore) return i;
  }
  return -1;
};

export function missingSoundNames(
  l: {
    narration?: string;
    beds?: readonly { name?: string; beatSource?: string; try?: readonly string[] }[];
    sfx?: readonly { name?: string; beatSource?: string; try?: readonly string[] }[];
  } | null,
  known: (name: string) => boolean,
): string[] {
  if (!l) return [];
  const missing: string[] = [];
  const check = (name?: string) => {
    if (name && name !== "off" && !known(name)) missing.push(name);
  };
  check(l.narration);
  for (const list of [l.beds, l.sfx]) {
    if (!list) continue;
    for (const item of list) {
      check(item.name);
      check(item.beatSource);
      if (item.try) for (const alt of item.try) check(alt);
    }
  }
  return missing;
}

const KIND_NAME: Record<List, string> = { beds: "Bed", sfx: "SFX" };
const TOUCH = 0.02;

export const refs = (l: Tracked): Ref[] =>
  (["beds", "sfx"] as const).flatMap((list) => l[list].map((_, i) => ({ list, i })));
export const entry = (l: Tracked, r: Ref) => l[r.list][r.i];
export const same = (a: Ref, b: Ref) => a.list === b.list && a.i === b.i;
export const trackOf = (l: Tracked, r: Ref) => l.tracks?.find((t) => t.id === entry(l, r)?.track);

const newId = (l: Tracked, extra: readonly Track[] = []) =>
  `t${1 + Math.max(0, ...[...(l.tracks ?? []), ...extra].map((t) => Number(t.id.slice(1)) || 0))}`;

const uniqueTrackName = (taken: Set<string>, base: string) => {
  const named = (n: number) => (n > 1 ? `${base} ${n}` : base);
  let n = 1;
  while (taken.has(named(n))) n++;
  const out = named(n);
  taken.add(out);
  return out;
};

export const addTrack = (l: Tracked, kind: List, at?: number): Track => {
  l.tracks ??= [];
  const taken = new Set(l.tracks.map((t) => t.name));
  const t: Track = { id: newId(l), name: uniqueTrackName(taken, KIND_NAME[kind]) };
  l.tracks.splice(at ?? l.tracks.length, 0, t);
  return t;
};

export const addRoleTrack = (l: Tracked, role: TrackRole, at?: number, roleOf?: RoleOf): Track => {
  l.tracks ??= [];
  const taken = new Set(l.tracks.map((t) => t.name));
  const t: Track = {
    id: newId(l),
    name: uniqueTrackName(taken, TRACK_ROLE_META[role].label),
    role,
  };
  if (at !== undefined) {
    l.tracks.splice(at, 0, t);
    return t;
  }
  let insertAt = -1;
  const order = ROLE_ORDER.get(role)!;
  for (let i = 0; i < l.tracks.length; i++) {
    const r = inferTrackRole(l, l.tracks[i], roleOf);
    if (r === role) insertAt = i + 1;
  }
  if (insertAt < 0) {
    insertAt = l.tracks.findIndex((x) => ROLE_ORDER.get(inferTrackRole(l, x, roleOf))! > order);
    if (insertAt < 0) insertAt = l.tracks.length;
  }
  l.tracks.splice(insertAt, 0, t);
  return t;
};

export const fits = (
  l: Tracked,
  id: string,
  [s, e]: [number, number],
  spanOf: SpanOf,
  skip: Ref[] = [],
) =>
  refs(l).every((r) => {
    if (entry(l, r).track !== id || skip.some((k) => same(k, r))) return true;
    const [a, b] = spanOf(r);
    return e <= a + TOUCH || s >= b - TOUCH;
  });

export const placeShift = (
  l: Tracked,
  moved: Ref[],
  spanOf: SpanOf,
  want: number,
  [lo, hi]: [number, number],
): number | null => {
  if (moved.some((r) => trackOf(l, r)?.lock)) return null;
  const still = refs(l).filter((r) => !moved.some((m) => same(m, r))),
    blocked: [number, number][] = [];
  for (const r of moved) {
    const [s, e] = spanOf(r);
    for (const other of still)
      if (entry(l, r).track === entry(l, other).track) {
        const [a, b] = spanOf(other);
        blocked.push([a - e, b - s]);
      }
  }
  const merged: [number, number][] = [];
  for (const interval of blocked.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && interval[0] < last[1] - 1e-6) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  const at = Math.max(lo, Math.min(hi, want)),
    blockedAt = merged.find(([a, b]) => at > a + 1e-6 && at < b - 1e-6);
  if (!blockedAt) return at;
  return (
    blockedAt
      .filter((d) => d >= lo && d <= hi)
      .sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0] ?? null
  );
};

export const freeTrack = (
  l: Tracked,
  kind: List,
  sp: [number, number],
  spanOf: SpanOf,
  from: string,
  role?: TrackRole,
  roleOf?: RoleOf,
) => {
  l.tracks ??= [];
  const ts = l.tracks,
    at = ts.findIndex((t) => t.id === from);
  const near = [ts[at], ...ts.slice(at + 1), ...ts.slice(0, Math.max(0, at)).reverse()];
  if (role) {
    const t = near.find(
      (x) =>
        x &&
        (x.id === from || inferTrackRole(l, x, roleOf) === role) &&
        !x.lock &&
        fits(l, x.id, sp, spanOf),
    );
    return t ? t.id : addRoleTrack(l, role, at < 0 ? undefined : at + 1, roleOf).id;
  }
  const own = new Set(
    refs(l)
      .filter((r) => r.list === kind)
      .map((r) => entry(l, r).track),
  );
  const t = near.find(
    (t) => t && (t.id === from || own.has(t.id)) && !t.lock && fits(l, t.id, sp, spanOf),
  );
  return t ? t.id : addTrack(l, kind, at < 0 ? undefined : at + 1).id;
};

export const normalize = (l: Tracked, spanOf: SpanOf, roleOf?: RoleOf) => {
  l.tracks ??= [];
  const known = new Set(l.tracks.map((t) => t.id));
  if (!roleOf) {
    const homeless = refs(l)
      .filter((r) => !known.has(entry(l, r).track as string))
      .sort((a, b) => a.list.localeCompare(b.list) || spanOf(a)[0] - spanOf(b)[0]);
    const own = new Map<string, List>();
    for (const r of refs(l))
      if (known.has(entry(l, r).track as string)) own.set(entry(l, r).track as string, r.list);
    for (const r of homeless) {
      const sp = spanOf(r);
      let t = l.tracks.find((t) => own.get(t.id) === r.list && fits(l, t.id, sp, spanOf));
      if (!t) {
        t = addTrack(l, r.list);
        own.set(t.id, r.list);
      }
      entry(l, r).track = t.id;
    }
    return homeless.length > 0;
  }
  const homeless = refs(l)
    .filter((r) => !known.has(entry(l, r).track as string))
    .sort(
      (a, b) =>
        ROLE_ORDER.get(roleOf(a))! - ROLE_ORDER.get(roleOf(b))! || spanOf(a)[0] - spanOf(b)[0],
    );
  if (!homeless.length) return false;
  const trackRoles = new Map<string, TrackRole>();
  for (const t of l.tracks) trackRoles.set(t.id, inferTrackRole(l, t, roleOf));
  for (const r of homeless) {
    const role = roleOf(r);
    const sp = spanOf(r);
    let t = l.tracks.find(
      (x) => trackRoles.get(x.id) === role && !x.lock && fits(l, x.id, sp, spanOf),
    );
    if (!t) {
      t = addRoleTrack(l, role, undefined, roleOf);
      trackRoles.set(t.id, role);
    }
    entry(l, r).track = t.id;
  }
  return true;
};

const GENERIC_TRACK_NAME_RE =
  /^(Bed|SFX|Voice|BGM|Whoosh|Riser|Pop & UI|Impact|Ambience|Custom)( \d+)?$/i;

const mixPropsOf = (t?: Track) => ({
  mute: t?.mute ? true : undefined,
  gain: t?.gain ? t.gain : undefined,
  filters: t?.filters?.length ? [...t.filters] : undefined,
});

const mixSignatureOf = (t?: Track) => {
  const m = mixPropsOf(t);
  return JSON.stringify([Boolean(m.mute), m.gain ?? 0, m.filters ?? []]);
};

const DEFAULT_MIX_SIG = mixSignatureOf(undefined);

export const organizeTracks = (l: Tracked, spanOf: SpanOf, roleOf: RoleOf): boolean => {
  l.tracks ??= [];
  const before = JSON.stringify({
    tracks: l.tracks,
    beds: l.beds.map((b) => b.track),
    sfx: l.sfx.map((s) => s.track),
  });
  const lockedTracks = l.tracks.filter((t) => t.lock);
  const lockedIds = new Set(lockedTracks.map((t) => t.id));
  const unlockedClips = refs(l).filter((r) => !lockedIds.has(entry(l, r).track as string));
  if (!unlockedClips.length) return false;

  const trackById = new Map(l.tracks.map((t) => [t.id, t]));
  const reusable = new Map<string, Track[]>();
  for (const t of l.tracks) {
    if (t.lock) continue;
    const role = inferTrackRole(l, t, roleOf);
    const key = `${role}\0${mixSignatureOf(t)}`;
    const list = reusable.get(key) ?? [];
    list.push({ ...t });
    reusable.set(key, list);
  }

  const clipMeta = unlockedClips.map((r) => {
    const oldTrack = trackById.get(entry(l, r).track as string);
    return {
      r,
      role: roleOf(r),
      sig: mixSignatureOf(oldTrack),
      mix: mixPropsOf(oldTrack),
    };
  });
  for (const r of unlockedClips) entry(l, r).track = undefined;

  const takenNames = new Set(lockedTracks.map((t) => t.name));
  const created: Track[] = [];
  const byRole = new Map<
    TrackRole,
    Map<string, { mix: ReturnType<typeof mixPropsOf>; refs: Ref[] }>
  >();
  for (const item of clipMeta) {
    let sigMap = byRole.get(item.role);
    if (!sigMap) {
      sigMap = new Map();
      byRole.set(item.role, sigMap);
    }
    let bucket = sigMap.get(item.sig);
    if (!bucket) {
      bucket = { mix: item.mix, refs: [] };
      sigMap.set(item.sig, bucket);
    }
    bucket.refs.push(item.r);
  }

  for (const role of TRACK_ROLES) {
    const sigMap = byRole.get(role);
    if (!sigMap?.size) continue;
    const sigEntries = [...sigMap.entries()].sort(([a], [b]) =>
      a === DEFAULT_MIX_SIG ? -1 : b === DEFAULT_MIX_SIG ? 1 : a.localeCompare(b),
    );
    for (const [sig, bucket] of sigEntries) {
      bucket.refs.sort((a, b) => spanOf(a)[0] - spanOf(b)[0]);
      const lanesForBucket: Track[] = [];
      const pool = reusable.get(`${role}\0${sig}`) ?? [];
      for (const r of bucket.refs) {
        const sp = spanOf(r);
        let t = lanesForBucket.find((x) => fits(l, x.id, sp, spanOf));
        if (!t) {
          const reused = pool.shift();
          if (reused) {
            const keepCustom =
              reused.name.trim().length > 0 &&
              !GENERIC_TRACK_NAME_RE.test(reused.name.trim()) &&
              !takenNames.has(reused.name.trim());
            reused.name = keepCustom
              ? reused.name.trim()
              : uniqueTrackName(takenNames, TRACK_ROLE_META[role].label);
            if (keepCustom) takenNames.add(reused.name);
            reused.role = role;
            t = reused;
          } else {
            t = {
              id: newId(l, [...lockedTracks, ...created]),
              name: uniqueTrackName(takenNames, TRACK_ROLE_META[role].label),
              role,
              ...(bucket.mix.mute ? { mute: true } : {}),
              ...(bucket.mix.gain !== undefined ? { gain: bucket.mix.gain } : {}),
              ...(bucket.mix.filters ? { filters: [...bucket.mix.filters] } : {}),
            };
          }
          lanesForBucket.push(t);
          created.push(t);
        }
        entry(l, r).track = t.id;
      }
    }
  }

  const all = [...lockedTracks, ...created].map((t, idx) => ({
    t,
    idx,
    order: ROLE_ORDER.get(inferTrackRole(l, t, roleOf))!,
  }));
  all.sort((a, b) => a.order - b.order || a.idx - b.idx);
  l.tracks = all.map((x) => x.t);
  tidy(l);

  const after = JSON.stringify({
    tracks: l.tracks,
    beds: l.beds.map((b) => b.track),
    sfx: l.sfx.map((s) => s.track),
  });
  return after !== before;
};

export const shiftRoom = (l: Tracked, moved: Ref[], spanOf: SpanOf): [number, number] => {
  if (moved.some((r) => trackOf(l, r)?.lock)) return [0, 0];
  let lo = -Infinity,
    hi = Infinity;
  const still = refs(l).filter((r) => !moved.some((m) => same(m, r)));
  for (const r of moved) {
    const [s, e] = spanOf(r);
    for (const other of still)
      if (entry(l, r).track === entry(l, other).track) {
        const [a, b] = spanOf(other);
        if (b <= s + TOUCH) lo = Math.max(lo, b - s);
        else if (a >= e - TOUCH) hi = Math.min(hi, a - e);
        else return [0, 0];
      }
  }
  return [lo, hi];
};

export const tidy = (l: Tracked) => {
  const used = new Set(refs(l).map((r) => entry(l, r).track));
  l.tracks = (l.tracks ?? []).filter((t) => used.has(t.id));
};
