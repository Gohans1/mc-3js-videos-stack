// Search eval for `bun run find`: runs every case of a set through the CLI as an agent would, scores it against the
// case's answer key, and keeps the numbers (HELP below). Cases: cases/<set>.tsv, one per line, tab separated:
//   id  kind  lang(en|vi)  style(name|para|scene|use|none)  query  accept
// accept is a regex on the entry id (the second column find prints), or NONE when nothing in that kind fits.
// A case is right when the first hit matches accept and Jev does not call it a misfit (best fits < FIT_NO); a NONE case
// is right when Jev doubts every hit it shows (best fits < FIT_YES), or the words find nothing.
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)),
  ROOT = join(HERE, "../../..");
// TypeSafe's starting thresholds for a Noul answer: yes above 0.7, no below 0.3 (catalog.py uses the same)
const FIT_YES = 0.7,
  FIT_NO = 0.3;
const KINDS = new Set(
  "transition anim text shape font adjust velocity ease sfx bgm mc mocap sound".split(" "),
);

const HELP = `Usage: bun run eval:find [--set <name>] [--mode jev|words|both] [--kind <k>] [--fresh] [-j N] [--finish] [--note <t>]
Runs scripts/evals/find/cases/<set>.tsv (default: every set) through bun run find, scores it, and keeps:
  runs/<set>.<mode>.jsonl   every case's top 5 hits, fits and verdict (the last run; a stopped run resumes from it)
  runs/history.jsonl        one line per finished run: accuracy overall, per kind, language and style, commit, time
--fresh starts the set over; -j how many cases run at once (default 3; Jev's free route rate-limits bursts).
--finish scores a stopped run as it is (cases that failed to run are left out, counted as failed); --note "<what changed>"
labels the run in history.jsonl.`;

type Case = {
  id: string;
  kind: string;
  lang: string;
  style: string;
  query: string;
  accept: string;
};
type Hit = { id: string; share: number | null; fits: number | null };
type Row = Case & {
  mode: string;
  hits: Hit[];
  verdict: "fits" | "unsure" | "none" | "-";
  rank: number;
  ok: boolean;
  secs: number;
  err?: string;
};

const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(k);
  return i < 0 ? undefined : args[i + 1];
};
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const sets = flag("--set")
  ? [flag("--set")!]
  : ["dev", "holdout-a", "holdout-b"].filter((s) => existsSync(join(HERE, "cases", `${s}.tsv`)));
const modes = (flag("--mode") ?? "jev") === "both" ? ["jev", "words"] : [flag("--mode") ?? "jev"];
const onlyKind = flag("--kind");
const fresh = args.includes("--fresh");
// --finish scores a stopped run as it stands, the cases that failed to run left out and counted; --note labels the run
const finish = args.includes("--finish"),
  note = flag("--note");
const jobs = Number(flag("-j") ?? 3);

const readCases = (set: string): Case[] => {
  const f = join(HERE, "cases", `${set}.tsv`);
  if (!existsSync(f)) {
    console.error(`no set ${set}: cases/${set}.tsv`);
    process.exit(2);
  }
  return readFileSync(f, "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l, i) => {
      const c = l.split("\t");
      if (c.length !== 6 || !KINDS.has(c[1]!)) {
        console.error(
          `cases/${set}.tsv line ${i + 1}: want 6 tab-separated columns with a known kind, got: ${l}`,
        );
        process.exit(2);
      }
      const [id, kind, lang, style, query, accept] = c as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      return { id, kind, lang, style, query, accept };
    });
};

// find's hit lines: "[0.74  ][fits 0.93  ][3/4 words  ]<kind>/<cat>  <id>  ..." and mocap's "0.75  fits 0.96  <lib>/<clip>  ..."
const KIND_HEAD = /^(transition|anim|text|shape|font|adjust|velocity|ease|sfx|bgm|mc|mocap)\b/;
const parseHits = (out: string): Hit[] =>
  out
    // catalog.py (mocap) is Python: \r\n on Windows
    .split(/\r?\n/)
    .flatMap((raw) => {
      let l = raw.replace(/^\d+\/\d+ words\s+/, "");
      let share: number | null = null,
        fits: number | null = null;
      const s = l.match(/^(\d\.\d\d)\s{2,}(.*)$/);
      if (s) [share, l] = [Number(s[1]), s[2]!];
      const f = l.match(/^fits (\d\.\d\d)\s{2,}(.*)$/);
      if (f) [fits, l] = [Number(f[1]), f[2]!];
      const parts = l.split(/\s{2,}/);
      if (KIND_HEAD.test(parts[0] ?? "") && parts[1])
        return [{ id: parts[1].replace(/ \(\d+ takes\)$/, ""), share, fits }];
      if (share !== null && fits !== null && parts[0]) return [{ id: parts[0], share, fits }];
      return [];
    })
    .slice(0, 5);

const score = (c: Case, mode: string, hits: Hit[]) => {
  const fitsSeen = hits.map((h) => h.fits).filter((x): x is number => x !== null);
  const best = fitsSeen.length ? Math.max(...fitsSeen) : null;
  const top = hits[0]?.fits ?? null;
  const verdict: Row["verdict"] =
    mode !== "jev" || best === null
      ? "-"
      : best < FIT_NO
        ? "none"
        : best < FIT_YES
          ? "unsure"
          : "fits";
  if (c.accept === "NONE") {
    const ok = mode === "jev" ? verdict === "none" || verdict === "unsure" : hits.length === 0;
    return { verdict, rank: -1, ok };
  }
  const re = new RegExp(c.accept);
  const rank = hits.findIndex((h) => re.test(h.id));
  // the first hit is the answer an agent takes; Jev saying it does not fit makes the agent drop it
  const ok = rank === 0 && !(mode === "jev" && top !== null && top < FIT_NO);
  return { verdict, rank, ok };
};

const once = async (c: Case, mode: string): Promise<Row> => {
  const t0 = performance.now();
  const p = spawn(
    "bun",
    ["scripts/find.ts", ...(mode === "jev" ? ["--jev"] : []), "--kind", c.kind, c.query, "-n", "5"],
    { cwd: ROOT },
  );
  const timer = setTimeout(() => p.kill(), 300_000);
  let out = "",
    err = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (err += d));
  const code = await new Promise<number | null>((done) => p.on("close", done));
  clearTimeout(timer);
  const hits = parseHits(out + "\n" + err);
  // Jev unreachable (quota, key, network): find falls back to word matches, which must not score as Jev's answer. With
  // --kind Jev always votes, so a Jev run with no voted hit is a failed run, not an empty answer
  const jevDown = mode === "jev" && (!hits.length || hits.every((h) => h.share === null));
  return {
    ...c,
    mode,
    hits,
    ...score(c, mode, hits),
    secs: Math.round(performance.now() - t0) / 1000,
    ...((code || jevDown) && {
      err: `${err}\n${out}`.trim().split("\n").slice(-4).join(" | ").slice(0, 600),
    }),
  };
};

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const group = (rows: Row[], key: (r: Row) => string) => {
  const m: Record<string, { n: number; ok: number; acc: number }> = {};
  for (const r of rows) {
    const g = (m[key(r)] ??= { n: 0, ok: 0, acc: 0 });
    g.n++;
    if (r.ok) g.ok++;
  }
  for (const g of Object.values(m)) g.acc = pct(g.ok, g.n);
  return m;
};
const git = (a: string[]) => spawnSync("git", a, { cwd: ROOT, encoding: "utf8" }).stdout.trim();

mkdirSync(join(HERE, "runs"), { recursive: true });
for (const set of sets) {
  const cases = readCases(set).filter((c) => !onlyKind || c.kind === onlyKind);
  for (const mode of modes) {
    const part = join(HERE, "runs", `${set}.${mode}.partial.jsonl`),
      last = join(HERE, "runs", `${set}.${mode}.jsonl`);
    if (fresh && existsSync(part)) writeFileSync(part, "");
    const done = new Map<string, Row>(
      existsSync(part)
        ? readFileSync(part, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => {
              const r = JSON.parse(l) as Row;
              return [r.id, r];
            })
        : [],
    );
    // a case whose query or key changed since it ran runs again
    const todo = cases.filter((c) => {
      const r = done.get(c.id);
      if (finish) return false;
      return !r || r.err || r.query !== c.query || r.accept !== c.accept || r.kind !== c.kind;
    });
    console.log(`${set} ${mode}: ${cases.length} cases, ${todo.length} to run`);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const c = todo[next++]!;
        const r = await once(c, mode);
        done.set(r.id, r);
        appendFileSync(part, JSON.stringify(r) + "\n");
        if (!r.ok || r.err)
          console.log(
            `  ${r.ok ? "ok  " : "MISS"} ${r.id} ${r.kind} "${r.query}" -> ${
              r.hits
                .slice(0, 3)
                .map((h) => `${h.id}${h.fits !== null ? ` fits ${h.fits}` : ""}`)
                .join(", ") || "nothing"
            }${r.err ? `  ERR ${r.err}` : ""}`,
          );
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
    const ran = cases.map((c) => done.get(c.id)!).filter(Boolean);
    const errs = ran.filter((r) => r.err).length + cases.length - ran.length;
    const rows = finish ? ran.filter((r) => !r.err) : ran;
    if (errs && !finish) {
      console.log(
        `${set} ${mode}: ${errs} cases failed to run (kept in ${part}); run again to retry them`,
      );
      continue;
    }
    writeFileSync(last, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    if (existsSync(part)) rmSync(part);
    const ok = rows.filter((r) => r.ok).length,
      pos = rows.filter((r) => r.accept !== "NONE");
    const summary = {
      at: new Date().toISOString(),
      set,
      mode,
      kind: onlyKind ?? "all",
      commit: git(["rev-parse", "--short", "HEAD"]),
      dirty:
        git([
          "status",
          "--porcelain",
          "scripts/find.ts",
          "packages/clip-catalog",
          "packages/film-stage/src",
        ]) !== "",
      ...(note && { note }),
      n: rows.length,
      ...(errs && { failed: errs }),
      accuracy: pct(ok, rows.length),
      top3: pct(pos.filter((r) => r.rank >= 0 && r.rank < 3).length, pos.length),
      none:
        group(
          rows.filter((r) => r.accept === "NONE"),
          () => "none",
        ).none ?? null,
      byKind: group(rows, (r) => r.kind),
      byLang: group(rows, (r) => r.lang),
      byStyle: group(rows, (r) => r.style),
      secs: {
        mean: Math.round((100 * rows.reduce((s, r) => s + r.secs, 0)) / rows.length) / 100,
        max: Math.max(...rows.map((r) => r.secs)),
      },
    };
    appendFileSync(join(HERE, "runs", "history.jsonl"), JSON.stringify(summary) + "\n");
    console.log(
      `${set} ${mode}: ${summary.accuracy}% right (${ok}/${rows.length}), top-3 ${summary.top3}%; by kind ${Object.entries(
        summary.byKind,
      )
        .map(([k, g]) => `${k} ${g.acc}`)
        .join(", ")}; by lang ${Object.entries(summary.byLang)
        .map(([k, g]) => `${k} ${g.acc}`)
        .join(", ")}`,
    );
  }
}
