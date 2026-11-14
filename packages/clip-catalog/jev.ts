// Jev (jev.py) from TypeScript: which items of a list fit what is wanted, by meaning, in any language. bun run find ranks
// the vault with it, bun run notes the lesson files a note needs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const JEV = fileURLToPath(new URL("./jev.py", import.meta.url));

// What to ask of a list: the state Jev reads, the question that picks the best item, what makes one item fit or not, and
// an item as Jev reads it
export interface JevQuestion<T> {
  wanted: string;
  pick: string;
  yes: string;
  no: string;
  text: (x: T) => string;
}
// [share of the vote, item, fit]: fit (0-1, Jev's own yes that the item is what was wanted) only on the ones it checked
export type JevVoted<T> = [number, T, number?];

// Jev Choice: one option per item, CHOICE_MAX at most; a longer list runs in shuffled heats of HEAT whose top KEEP meet
// in a final (catalog.py rerank explains why: rounded probabilities, neighbours knocking each other out)
const CHOICE_MAX = 255,
  HEAT = 200,
  KEEP = 8;
// A fit at or past FIT_YES is Jev's yes, under FIT_NO its no, between them it is unsure
export const FIT_YES = 0.7,
  FIT_NO = 0.3;

// jev.py's own notes (a route's quota spent, its cost): parallel heats repeat them, so each is printed once per run
const jevNotes = new Set<string>();
type Answers = Record<string, { probabilities?: Record<string, number>; noul?: number }>;
const jevAsk = (state: unknown, questions: Record<string, unknown>) =>
  new Promise<Answers>((done, fail) => {
    const py = spawn("python", [JEV], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "";
    py.stdout.on("data", (d) => (out += d));
    py.stderr.on("data", (d) => (err += d));
    py.on("error", fail);
    py.on("close", (code) => {
      const said = err.split("\n").filter((l) => l.trim() && !jevNotes.has(l));
      for (const l of said) jevNotes.add(l);
      if (code) return fail(new Error(said.at(-1)?.trim() || `jev.py exited ${code}`));
      if (said.length) console.error(said.join("\n"));
      done(JSON.parse(out) as Answers);
    });
    py.stdin.end(JSON.stringify({ state, questions }));
  });

const choice = async <T>(q: JevQuestion<T>, group: T[]): Promise<[number, T][]> => {
  const criteria = Object.fromEntries(group.map((x, i) => [`c${i}`, q.text(x)]));
  const probs =
    (await jevAsk(q.wanted, { pick: { type: "choice", instructions: q.pick, criteria } })).pick
      ?.probabilities ?? {};
  return group.map((x, i) => [probs[`c${i}`] ?? 0, x]);
};

// A vote always picks something, even when nothing in the list is what was asked (TypeSafe: a "none of the above" option
// often fails; ask a companion Noul instead, as catalog.py does for mocap). So each item shown gets its own yes/no, all in
// one request: the probability that it really is what was wanted
const fits = async <T>(q: JevQuestion<T>, shown: T[]) => {
  const state = {
    wanted: q.wanted,
    ...Object.fromEntries(shown.map((x, k) => [`entry_${k + 1}`, q.text(x)])),
  };
  const qs = Object.fromEntries(
    shown.map((_, k) => [
      `fit_${k + 1}`,
      {
        type: "noul",
        instructions: `Is \`entry_${k + 1}\` what \`wanted\` asks for?`,
        criteria: { true: q.yes, false: q.no },
      },
    ]),
  );
  const ans = await jevAsk(state, qs);
  return shown.map((_, k) => ans[`fit_${k + 1}`]?.noul ?? 0);
};

// vote: Jev's Choice, or a stand-in for tests
export async function jevRank<T>(
  q: JevQuestion<T>,
  pool: T[],
  vote: (q: JevQuestion<T>, group: T[]) => Promise<[number, T][]> = choice,
) {
  // items Jev would read the same vote once, the first standing for the rest; all come back with its share
  const same = new Map<string, T[]>();
  let list: T[] = [];
  for (const x of pool) {
    const t = q.text(x);
    const seen = same.get(t);
    if (seen) seen.push(x);
    else {
      same.set(t, [x]);
      list.push(x);
    }
  }
  // the heats' winners run in heats again until they fit one final
  while (list.length > CHOICE_MAX) {
    // Fisher-Yates on a fixed-seed Park-Miller generator: the same query ranks the same
    let seed = 7;
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed = (seed * 16807) % 2147483647;
      const j = seed % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j] as T, shuffled[i] as T];
    }
    const heats: T[][] = [];
    for (let k = 0; k < shuffled.length; k += HEAT) heats.push(shuffled.slice(k, k + HEAT));
    const results: [number, T][][] = [];
    for (let k = 0; k < heats.length; k += 4)
      results.push(...(await Promise.all(heats.slice(k, k + 4).map((h) => vote(q, h)))));
    list = results.flatMap((r) =>
      r
        .filter(([p]) => p > 0)
        .sort((a, b) => b[0] - a[0])
        .slice(0, KEEP)
        .map(([, x]) => x),
    );
  }
  return (await vote(q, list)).flatMap(([p, x]) =>
    (same.get(q.text(x)) ?? [x]).map((y): [number, T] => [p, y]),
  );
}

// The vote over the pool, best first, then a fit for each of the first `show`
export async function jevJudge<T>(
  q: JevQuestion<T>,
  pool: T[],
  show: number,
): Promise<JevVoted<T>[]> {
  const voted = (await jevRank(q, pool)).filter(([p]) => p > 0).sort((a, b) => b[0] - a[0]);
  const top = voted.slice(0, show);
  if (!top.length) return voted;
  const fit = await fits(
    q,
    top.map(([, x]) => x),
  );
  return [...top.map(([p, x], i): JevVoted<T> => [p, x, fit[i]]), ...voted.slice(show)];
}
