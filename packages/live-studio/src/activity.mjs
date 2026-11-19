// What the AI is doing, for the creator's studio to show as it happens (app/activity): a line from each of the film's commands
// (bun run notes, at, render…, sent by src/tell.mjs) and from each edit to the film's files made outside the studio. The
// pages only show it: nothing here moves the playhead, reloads a page or touches what the creator is writing
import * as z from "zod";

// at/to: heard seconds, as bun run at and SPAN take them. job: a long command (a render) sends one line as it starts and one
// with end: true as it stops, so the studio shows it busy in between; its pid lets the studio end it for a command killed
// before its end line (an agent's timeout, a closed terminal: Windows runs no exit handler then)
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
  // how a command that checks or makes something came out; none for a line that only says what the AI is at
  level: z.enum(["ok", "warn", "fail"]).optional(),
  // what a check found, each at its heard seconds: lit on the ruler and listed under the line, a click away
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

const JOB_MS = 3600e3; // a job with no pid to watch is let go after render's own hour
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

// send: live.mjs's, to every open page. state() is what a page opened (or back online) later reads: the latest lines, the
// jobs running, this studio's start (a new studio numbers its lines from 1 again) and its clock (a phone's may be off)
export const createActivity = (send, { keep = 40, every = 3000 } = {}) => {
  const recent = [],
    running = new Map(), // job key: the line that started it
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
