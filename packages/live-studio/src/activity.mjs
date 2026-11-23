import * as z from "zod";

export const Activity = z.object({
  surface: z
    .enum([
      "film",
      "cli",
      "sound",
      "text",
      "cam",
      "light",
      "adjust",
      "openfilm",
      "keys",
      "speed",
      "transition",
      "objects",
    ])
    .optional(),
  say: z.string().trim().min(1).max(200),
  notes: z
    .array(z.string().regex(/^[a-z0-9]+$/))
    .max(50)
    .optional(),
  lessons: z.array(z.string().min(1).max(200)).max(20).optional(),
  at: z.number().nonnegative().optional(),
  to: z.number().nonnegative().optional(),
  level: z.enum(["ok", "warn", "fail"]).optional(),
  marks: z
    .array(
      z.object({
        at: z.number().nonnegative(),
        to: z.number().nonnegative().optional(),
        say: z.string().trim().min(1).max(80).optional(),
      }),
    )
    .max(20)
    .optional(),
  job: z
    .object({
      key: z.string().min(1).max(40),
      end: z.boolean().optional(),
      pid: z.number().int().positive().optional(),
    })
    .optional(),
});

const JOB_MS = 3600e3;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

export const createActivity = (send, { keep = 40, every = 3000 } = {}) => {
  const recent = [],
    running = new Map(),
    boot = Date.now();
  let last = 0,
    timer;
  const add = (entry) => {
    const a = { ...entry, id: ++last, when: Date.now() };
    recent.push(a);
    if (recent.length > keep) recent.shift();
    if (a.job?.end) running.delete(a.job.key);
    else if (a.job) running.set(a.job.key, a);
    send("activity", JSON.stringify(a));
    if (running.size && !timer) {
      timer = setInterval(check, every);
      timer.unref?.();
    } else if (!running.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
    return a;
  };
  const check = () => {
    for (const [key, a] of running)
      if (a.job.pid ? !alive(a.job.pid) : Date.now() - a.when > JOB_MS)
        add({
          say: `${key[0].toUpperCase()}${key.slice(1)} stopped before it ended`,
          level: "fail",
          surface: a.surface,
          job: { key, end: true },
        });
  };
  const state = () => ({
    boot,
    now: Date.now(),
    lines: recent.slice(),
    running: [...running.values()],
  });
  return { add, state };
};
