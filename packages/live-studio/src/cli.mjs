import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { warnProtectedEdits } from "./edit-protection.mjs";

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

export const cliArgs = (
  help,
  options = [],
  words = Infinity,
  argv = process.argv.slice(2),
  { helpWord = true } = {},
) => {
  if (argv.includes("-h") || argv.includes("--help") || (helpWord && argv[0] === "help")) {
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
    if (at < 0)
      fail(
        `unknown option ${a}: ${takes}${a === "--ref" ? `; the guide's topics: bun run skills get core --ref ${argv[i + 1] ?? "<topic>"}` : ""}`,
      );
    if (a.includes("="))
      fail(`write ${a.replace("=", " ")}: a space between an option and its value, not =`);
    if (options[at].includes(" ") && (i + 1 >= argv.length || /^--?[a-z]/i.test(argv[i + 1])))
      fail(`${a} needs a value: ${options[at]}`);
    if (options[at].includes(" ")) i++;
  }
  return argv;
};

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

export const secondArg = (name, text, { min = 0, max = Infinity } = {}) => {
  const s = String(text ?? "").trim();
  const m = /^(?:(\d+):([0-5]?\d(?:\.\d+)?)|(\d*\.?\d+)s?)$/.exec(s);
  const t = m ? (m[3] !== undefined ? +m[3] : +m[1] * 60 + +m[2]) : NaN;
  if (!(t >= min && t <= max)) {
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
    if (/^[A-Z_]{2,24}$/.test(key) && !known.includes(key)) {
      const near = known.find((k) => off(key, k));
      if (!near) continue;
      const typo = key[0] === near[0];
      stop ||= typo;
      console.error(
        `${key} is set in the environment, one letter off ${near} that this command reads: did you mean ${near}?${typo ? "" : " Going on, in case it is the machine's own."}`,
      );
    }
  if (stop) process.exit(2);
};

export const needFilm = (dir = process.cwd(), { warnProtected = true } = {}) => {
  if (existsSync(join(dir, "src/scene.ts"))) {
    if (warnProtected) warnProtectedEdits(dir);
    return dir;
  }
  console.error(
    `${dir} is not a film (no src/scene.ts): cd films/<name> first (the films: ls films)`,
  );
  process.exit(2);
};
