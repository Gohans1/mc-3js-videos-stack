import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(realpathSync(fileURLToPath(import.meta.url))), "../..");
const cmd = process.argv[2];
const asked = process.argv.slice(3).some((a) => ["-h", "--help", "help"].includes(a));
const say = asked ? console.log : console.error;
if (existsSync(join(process.cwd(), "src/scene.ts"))) {
  const up = relative(process.cwd(), ROOT).replaceAll("\\", "/") || ".";
  say(
    `${cmd} works on the whole repo, not one film: cd ${up} && bun run ${cmd} --help first, to see what it does (the repo's commands: bun run help there)`,
  );
} else {
  const films = existsSync(join(ROOT, "films"))
    ? readdirSync(join(ROOT, "films")).filter((f) =>
        existsSync(join(ROOT, "films", f, "src/scene.ts")),
      )
    : [];
  say(
    `${cmd} works on one film: cd films/<name> && bun run ${cmd} --help (the films: ${films.join(", ") || "none yet, bun run new-film <name>"})`,
  );
}
process.exit(asked ? 0 : 2);
