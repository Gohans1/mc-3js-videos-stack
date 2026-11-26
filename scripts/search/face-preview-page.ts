import { drawToonFace, drawToonMarks, feel, REF_ALEX, resolveFace, TOON } from "../../packages/mc-actor/src/toon-face";
import type { FaceSample } from "./face-preview";

const samples: FaceSample[] = JSON.parse(document.querySelector("#recipes")!.textContent!);
for (const { name, type, level } of samples) {
  const card = document.createElement("article");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 204;
  const g = canvas.getContext("2d")!;
  g.setTransform(12.75, 0, 0, 12.75, 51, 51);
  g.fillStyle = REF_ALEX.skin.tones.skin;
  g.fillRect(0, 0, 8, 8);
  g.fillStyle = REF_ALEX.skin.tones.hair;
  g.fillRect(0, 0, 8, 2);
  g.fillRect(0, 2, 3, 1);
  g.fillRect(0, 3, 2, 1);
  const face = type === "ramp"
    ? feel(name, level)
    : resolveFace(type === "mark" ? { from: "neutral", extras: { [name]: 1 } } : name);
  drawToonFace(g, face, TOON);
  drawToonMarks(g, face, TOON);
  const label = document.createElement("p");
  label.textContent = level ? `${name} · ${level}` : name;
  card.append(canvas, label);
  document.body.append(card);
}
