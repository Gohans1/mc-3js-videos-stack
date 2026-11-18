// Jev (jev.py) from TypeScript: which items of a list fit what is wanted, by meaning, in any language. bun run find ranks
// the vault with it, bun run notes the lesson files a note needs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const JEV = fileURLToPath(new URL("./jev.py", import.meta.url));
const NO_REQUEST_EXIT = 78;
const CHARGE_THRESHOLD_EXIT = 79;

export class JevRunError extends Error {
  constructor(
    message: string,
    readonly outcome: "not-started" | "charge-reported",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

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
export interface JevOptions {
  choiceMax?: number;
  heat?: number;
  keep?: number;
  dedupe?: boolean;
  noulInstructionsTemplate?: string;
  route?: "auto" | "free" | "paid";
  freeModel?: string;
  paidModel?: string;
  spendCap?: number;
  onTrace?: (event: Record<string, unknown>) => void;
  deadline?: number;
}

const jevAsk = (state: unknown, questions: Record<string, unknown>, options: JevOptions = {}) =>
  new Promise<Answers>((done, fail) => {
    const remaining = (options.deadline ?? Date.now() + 180000) - Date.now();
    if (remaining <= 0) {
      fail(new Error("Jev run stopped after 180 seconds."));
      return;
    }
    const py = spawn("python", [JEV], { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      py.kill();
      fail(new Error("Jev stopped after 180 seconds; try again."));
    }, remaining);
    let out = "",
      err = "";
    py.stdout.on("data", (d) => (out += d));
    py.stderr.on("data", (d) => (err += d));
    py.on("error", (e) => {
      clearTimeout(timer);
      fail(
        (e as NodeJS.ErrnoException).code === "ENOENT"
          ? new JevRunError(
              "Python was not found. Install Python or add it to PATH, then restart Studio or your terminal.",
              "not-started",
            )
          : new JevRunError(
              "Studio could not start Python. Check your Python installation and try again.",
              "not-started",
              { cause: e },
            ),
      );
    });
    py.on("close", (code) => {
      clearTimeout(timer);
      const said = err.split("\n").filter((l) => l.trim() && !jevNotes.has(l));
      for (const l of said) jevNotes.add(l);
      if (code) {
        const message =
          err.trim().split("\n").at(-1)?.trim() ||
          "Jev stopped before returning a result. Try again.";
        if (code === NO_REQUEST_EXIT) return fail(new JevRunError(message, "not-started"));
        if (code === CHARGE_THRESHOLD_EXIT)
          return fail(new JevRunError(message, "charge-reported"));
        return fail(new Error(message));
      }
      if (said.length) console.error(said.join("\n"));
      try {
        const result = JSON.parse(out) as { answers: Answers; trace: unknown[] };
        for (const event of result.trace) options.onTrace?.(event as Record<string, unknown>);
        done(result.answers);
      } catch {
        fail(new Error("Jev returned an unreadable response. Try again."));
      }
    });
    py.stdin.on("error", fail);
    py.stdin.end(
      JSON.stringify({
        state,
        questions,
        options: {
          route: options.route,
          freeModel: options.freeModel,
          paidModel: options.paidModel,
          spendCap: options.spendCap,
        },
        trace: true,
      }),
    );
  });

export const choiceRequest = <T>(q: JevQuestion<T>, group: T[]) => {
  const criteria = Object.fromEntries(group.map((x, i) => [`c${i}`, q.text(x)]));
  return {
    state: q.wanted,
    questions: { pick: { type: "choice", instructions: q.pick, criteria } },
  };
};
const choice = async <T>(
  q: JevQuestion<T>,
  group: T[],
  options: JevOptions = {},
): Promise<[number, T][]> => {
  const request = choiceRequest(q, group);
  options.onTrace?.({ phase: "choice", request });
  const probs = (await jevAsk(request.state, request.questions, options)).pick?.probabilities ?? {};
  return group.map((x, i) => [probs[`c${i}`] ?? 0, x]);
};

// A vote always picks something, even when nothing in the list is what was asked (TypeSafe: a "none of the above" option
// often fails; ask a companion Noul instead, as catalog.py does for mocap). So each item shown gets its own yes/no, all in
// one request: the probability that it really is what was wanted
export const fitRequest = <T>(q: JevQuestion<T>, shown: T[], options: JevOptions = {}) => {
  const state = {
    wanted: q.wanted,
    ...Object.fromEntries(shown.map((x, k) => [`entry_${k + 1}`, q.text(x)])),
  };
  const qs = Object.fromEntries(
    shown.map((_, k) => [
      `fit_${k + 1}`,
      {
        type: "noul",
        instructions: (
          options.noulInstructionsTemplate ?? "Is `entry_{index}` what `wanted` asks for?"
        ).replaceAll("{index}", String(k + 1)),
        criteria: { true: q.yes, false: q.no },
      },
    ]),
  );
  return { state, questions: qs };
};
const fits = async <T>(q: JevQuestion<T>, shown: T[], options: JevOptions = {}) => {
  const request = fitRequest(q, shown, options);
  options.onTrace?.({ phase: "noul", request });
  const ans = await jevAsk(request.state, request.questions, options);
  return shown.map((_, k) => ans[`fit_${k + 1}`]?.noul ?? 0);
};

// vote: Jev's Choice, or a stand-in for tests
export async function jevRank<T>(
  q: JevQuestion<T>,
  pool: T[],
  vote: (q: JevQuestion<T>, group: T[]) => Promise<[number, T][]> = choice,
  options: JevOptions = {},
) {
  const choiceMax = options.choiceMax ?? CHOICE_MAX,
    heat = options.heat ?? HEAT,
    keep = options.keep ?? KEEP;
  if (!(keep >= 1 && keep < heat && heat <= choiceMax && choiceMax <= CHOICE_MAX))
    throw new Error("Tournament requires 1 <= keep < heat <= choiceMax <= 255");
  if (!pool.length) return [];
  // items Jev would read the same vote once, the first standing for the rest; all come back with its share
  const same = new Map<string, T[]>();
  let list: T[] = [];
  for (const x of pool) {
    const t = q.text(x);
    const seen = same.get(t);
    if (seen && options.dedupe !== false) seen.push(x);
    else {
      same.set(t, [x]);
      list.push(x);
    }
  }
  // the heats' winners run in heats again until they fit one final
  while (list.length > choiceMax) {
    // Fisher-Yates on a fixed-seed Park-Miller generator: the same query ranks the same
    let seed = 7;
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed = (seed * 16807) % 2147483647;
      const j = seed % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j] as T, shuffled[i] as T];
    }
    const heats: T[][] = [];
    for (let k = 0; k < shuffled.length; k += heat) heats.push(shuffled.slice(k, k + heat));
    options.onTrace?.({
      phase: "heats",
      candidates: list.length,
      groups: heats.map((group) => group.map(q.text)),
      keep,
    });
    const results: [number, T][][] = [];
    for (let k = 0; k < heats.length; k += 4)
      results.push(...(await Promise.all(heats.slice(k, k + 4).map((h) => vote(q, h)))));
    list = results.flatMap((r) =>
      r
        .filter(([p]) => p > 0)
        .sort((a, b) => b[0] - a[0])
        .slice(0, keep)
        .map(([, x]) => x),
    );
  }
  options.onTrace?.({ phase: "final", candidates: list.map(q.text) });
  return (await vote(q, list)).flatMap(([p, x]) =>
    (options.dedupe === false ? [x] : (same.get(q.text(x)) ?? [x])).map((y): [number, T] => [p, y]),
  );
}

// The vote over the pool, best first, then a fit for each of the first `show`
export async function jevJudge<T>(
  q: JevQuestion<T>,
  pool: T[],
  show: number,
  options: JevOptions = {},
): Promise<JevVoted<T>[]> {
  options = { ...options, deadline: options.deadline ?? Date.now() + 180000 };
  const voted = (
    await jevRank(q, pool, (question, group) => choice(question, group, options), options)
  )
    .filter(([p]) => p > 0)
    .sort((a, b) => b[0] - a[0]);
  const top = voted.slice(0, show);
  if (!top.length) return voted;
  const fit = await fits(
    q,
    top.map(([, x]) => x),
    options,
  );
  return [...top.map(([p, x], i): JevVoted<T> => [p, x, fit[i]]), ...voted.slice(show)];
}
