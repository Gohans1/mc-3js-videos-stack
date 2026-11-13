import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// A film's JSON file read by a command: a broken one is named (Bun's parse error says neither file nor place), and
// bun run check says where in it. root: the film, so the name is the one the film's folder shows
export const jsonFile = (file, root = process.cwd()) => {
  const text = readFileSync(file, "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `${relative(root, file).replaceAll("\\", "/")} is not valid JSON (${e.message}): fix it, bun run check says where`,
      { cause: e },
    );
  }
};

// What every studio command does with its arguments before any work: -h, --help or a first word "help" prints its help on
// stdout and exits 0; an option it does not know, an option missing its value or a word too many stops it (exit 2) saying
// what it takes, so a typo or a probe never runs the default job (gen's default spends voice credits).
// options: its flags, "--shot N" for one that takes a value; null lets any word through. words: how many plain words it takes
export const cliArgs = (help, options = [], words = Infinity, argv = process.argv.slice(2)) => {
  if (argv.includes("-h") || argv.includes("--help") || argv[0] === "help") {
    console.log(help.trim());
    process.exit(0);
  }
  if (!options) return argv;
  const fail = (why) => {
    console.error(`${why} (--help for everything)`);
    process.exit(2);
  };
  const names = options.map((o) => o.split(" ")[0]),
    takes = options.length ? `this command takes ${options.join(", ")}` : "it takes no options";
  let plain = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!/^--?[a-z]/i.test(a)) {
      if (++plain > words)
        fail(
          `one word too many: ${a} (${words ? `it takes ${words} word${words > 1 ? "s" : ""}` : "it takes no words"}${options.length ? `; options: ${options.join(", ")}` : ""})`,
        );
      continue;
    }
    const at = names.indexOf(a.split("=")[0]);
    if (at < 0) fail(`unknown option ${a}: ${takes}`);
    if (a.includes("="))
      fail(`write ${a.replace("=", " ")}: a space between an option and its value, not =`);
    if (options[at].includes(" ") && (i + 1 >= argv.length || /^--?[a-z]/i.test(argv[i + 1])))
      fail(`${a} needs a value: ${options[at]}`);
    if (options[at].includes(" ")) i++;
  }
  return argv;
};

// A number from an argument or an environment variable, or exit 2 saying what it takes
export const numberArg = (name, text, { min = -Infinity, max = Infinity, int = false } = {}) => {
  const n = Number(text);
  if (
    text === undefined ||
    text === "" ||
    !Number.isFinite(n) ||
    (int && !Number.isInteger(n)) ||
    n < min ||
    n > max
  ) {
    console.error(
      `${name} takes ${int ? "a whole number" : "a number"}${min > -Infinity ? ` from ${min}` : ""}${max < Infinity ? ` to ${max}` : ""}, got ${JSON.stringify(text ?? "")}`,
    );
    process.exit(2);
  }
  return n;
};

// A heard second as notes, a draft's strip and bun run at print it (65, 1:05, 01:05.250, 65s), or exit 2 saying so.
// scripts/review/sheet.py and scripts/sound/listen.py read it the same way (seconds_arg)
export const secondArg = (name, text, { min = 0, max = Infinity } = {}) => {
  const s = String(text ?? "").trim();
  const m = /^(?:(\d+):([0-5]?\d(?:\.\d+)?)|(\d*\.?\d+)s?)$/.exec(s);
  const t = m ? (m[3] !== undefined ? +m[3] : +m[1] * 60 + +m[2]) : NaN;
  if (!(t >= min && t <= max)) {
    // 1:75 is a minute and 75 s: say the time it likely meant
    const over = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
    const meant =
      over && +over[2] >= 60
        ? `: a minute holds 0-59 s, did you mean ${Math.floor((+over[1] * 60 + +over[2]) / 60)}:${String(+((+over[1] * 60 + +over[2]) % 60).toFixed(3)).padStart(2, "0")}?`
        : "";
    console.error(
      `${name} takes a heard second (65, 1:05 or 01:05.250)${min > 0 ? ` from ${min}` : ""}${max < Infinity ? ` to ${max}` : ""}, got ${JSON.stringify(text ?? "")}${meant}`,
    );
    process.exit(2);
  }
  return t;
};

// An environment option spelt one letter off (ATT=1 for AT=1) would be ignored without a word: it stops the command
// (exit 2). One off in its first letter only warns, since a machine may carry such a variable for itself (a PAT token)
export const envTypos = (known, env = process.env) => {
  let stop = false;
  const off = (a, b) => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    const [x, y] = [a.slice(i + 1), b.slice(i + 1)];
    return x === y || a.slice(i) === y || b.slice(i) === x;
  };
  for (const key of Object.keys(env))
    if (/^[A-Z_]{2,16}$/.test(key) && !known.includes(key)) {
      const near = known.find((k) => off(key, k));
      if (!near) continue;
      const typo = key[0] === near[0];
      stop ||= typo;
      console.error(
        `${key}=${env[key]} is no option here: did you mean ${near}=${env[key]}? (--help for the options)${typo ? "" : " Going on, in case it is the machine's own."}`,
      );
    }
  if (stop) process.exit(2);
};

// A command that works on one film stops outside one, saying where to run it
export const needFilm = (dir = process.cwd()) => {
  if (existsSync(join(dir, "src/scene.ts"))) return dir;
  console.error(
    `${dir} is not a film (no src/scene.ts): cd films/<name> first (the films: ls films)`,
  );
  process.exit(2);
};
