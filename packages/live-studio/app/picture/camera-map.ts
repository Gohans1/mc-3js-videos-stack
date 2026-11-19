import { S } from "../core/state";
import { get } from "../core/store";
import { filmCam } from "./filmcam";

type Point = { x: number; z: number };
const SIZE = 124;
const MID = SIZE / 2;
const PAD = 18;

export const drawCameraMap = () => {
  const tools = S.tools,
    canvas = S.el.minimap;
  const { minimap, clean } = get().preview;
  if (!tools || !canvas || !minimap || clean || canvas.hidden) return;
  const ratio = Math.min(devicePixelRatio, 2),
    size = Math.round(SIZE * ratio);
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.clearRect(0, 0, SIZE, SIZE);
  const p = tools.camera.position,
    aim = tools.look;
  const extent = Math.max(6, Math.hypot(aim.x - p.x, aim.z - p.z));
  const scale = (MID - PAD) / extent;
  const x = (point: Point) => MID + (point.x - p.x) * scale;
  const y = (point: Point) => MID + (point.z - p.z) * scale;

  g.strokeStyle = "rgba(255,255,255,.2)";
  g.lineWidth = 1;
  g.beginPath();
  g.arc(MID, MID, MID - PAD, 0, Math.PI * 2);
  g.moveTo(MID - 7, MID);
  g.lineTo(MID + 7, MID);
  g.moveTo(MID, MID - 7);
  g.lineTo(MID, MID + 7);
  g.stroke();

  const path = (from: Point, to: Point, color: string, dashed = false) => {
    g.strokeStyle = color;
    g.fillStyle = color;
    g.setLineDash(dashed ? [3, 3] : []);
    g.beginPath();
    g.moveTo(x(from), y(from));
    g.lineTo(x(to), y(to));
    g.stroke();
    g.setLineDash([]);
    for (const [pt, r] of [
      [from, 3],
      [to, 2],
    ] as const) {
      g.beginPath();
      g.arc(x(pt), y(pt), r, 0, Math.PI * 2);
      g.fill();
    }
  };
  g.save();
  g.beginPath();
  g.rect(PAD / 2, PAD / 2, SIZE - PAD, SIZE - PAD);
  g.clip();
  if (tools.free.on && filmCam.rev) path(filmCam.position, filmCam.aim, "#edb874", true);
  path(p, aim, "#87dcbe");
  g.restore();
  g.fillStyle = "#dae3e5";
  g.font = "9px ui-monospace, monospace";
  g.fillText("−Z", MID - 5, 12);
  g.fillText("+X", SIZE - 16, MID + 3);
  g.fillText(extent.toFixed(extent < 10 ? 1 : 0) + " m", 7, SIZE - 6);
};
