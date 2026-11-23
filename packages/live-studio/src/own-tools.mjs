import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const GAPS = fileURLToPath(new URL("../../../scripts/gaps.jsonl", import.meta.url));
const SCRIPT = /\.(?:py|sh|ps1|mjs|cjs|js|ts)$/i;
const TEMPLATE = (f) => f === "sound.py" || /\.config\.[cm]?[jt]s$/.test(f);
const isDir = (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

const ownTools = (project) => [
  ...readdirSync(project).filter((f) => SCRIPT.test(f) && !TEMPLATE(f) && !isDir(join(project, f))),
  ...["tools", "scripts"].flatMap((dir) =>
    isDir(join(project, dir))
      ? readdirSync(join(project, dir))
          .filter((f) => !f.startsWith(".") && f !== "__pycache__")
          .map((f) => `${dir}/${f}`)
      : [],
  ),
];

const gapsFrom = (file, film) => {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => {
      try {
        return JSON.parse(line)?.film === film;
      } catch {
        return false;
      }
    }).length;
};

export const ownToolsWarning = (project, gapsFile = GAPS) => {
  const tools = ownTools(project);
  const logged = gapsFrom(gapsFile, basename(project));
  if (tools.length <= logged) return "";
  const shown =
    tools.slice(0, 6).join(", ") + (tools.length > 6 ? `, ${tools.length - 6} more` : "");
  return `⚠ the film runs ${tools.length} tool${tools.length > 1 ? "s" : ""} of its own (${shown}) and bun run gap holds ${logged} from it: each is a command the repo lacked. Log what each does for you: bun run gap "<what you needed>" --did "<the tool>" --cmd <the command that lacked it>`;
};
