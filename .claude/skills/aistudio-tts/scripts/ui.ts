import { ab, js, StepError, toLF } from "../../aistudio/scripts/lib";
import { requireSpeechPage } from "./editor";
import { exists } from "./page-map";

const globalControls =
  /Google Account:|Skip to main content|Get API key|No API key selected|Collapse navigation menu|Expand navigation menu|What's new|"Settings"|"Search \(Ctrl/;

export function snapshot() {
  requireSpeechPage();
  const codeDialog = js<boolean>(exists("codeDialog"));
  return (codeDialog ? ab("snapshot") : ab("snapshot", "-i"))
    .split(/\r?\n/)
    .filter(
      (line) =>
        (!codeDialog || /\[ref=e\d+/.test(line)) &&
        !globalControls.test(line) &&
        !/^\s*- link /.test(line),
    )
    .join("\n");
}

function ensureRef(ref: string, current: string) {
  if (!/^@?e\d+$/.test(ref))
    throw new StepError("Expected a browser reference such as e42 from snapshot.");
  const token = ref.replace(/^@/, "");
  const line = current
    .split("\n")
    .find((row) => new RegExp(`\\bref=${token}(?:[\\s,\\]]|$)`).test(row));
  if (!line)
    throw new StepError(
      `${ref} is missing or out of scope. Take a fresh snapshot on the same tab.`,
    );
  return { target: `@${token}`, line };
}

export async function actOnUi(action: string, ref: string, input?: string) {
  const current = snapshot();
  const { target, line } = ensureRef(ref, current);
  switch (action) {
    case "fill": {
      if (!/\b(textbox|searchbox|spinbutton|combobox)\b/.test(line)) {
        throw new StepError("Fill expects an editable field from snapshot.");
      }
      ab("fill", target, "--", input!);
      const { data } = JSON.parse(ab("get", "value", target, "--json")) as {
        data: { value: string };
      };
      if (toLF(data.value) !== toLF(input!)) {
        throw new StepError(`${target} did not retain the exact value. Inspect the new snapshot.`);
      }
      break;
    }
    case "press":
      ab("focus", target);
      ab("press", input!);
      break;
    case "drag":
      ab("drag", target, ensureRef(input!, current).target);
      break;
    case "upload":
      ab("upload", target, input!);
      break;
    default:
      ab(action, target);
  }
  return { target: line.trim(), action, snapshot: snapshot() };
}
