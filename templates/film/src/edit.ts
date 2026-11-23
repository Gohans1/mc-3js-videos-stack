// @ts-nocheck
import { setEdit } from "live-studio/edit";

import data from "./edit.json";
import adjustments from "./timeline/adjust.json";
import audio from "./timeline/audio.json";
import cam from "./timeline/cam.json";
import fx from "./timeline/fx.json";
import mouth from "./timeline/mouth.json";
import placed from "./timeline/placed.json";
import props from "./timeline/props.json";
import shots from "./timeline/shots.json";
import steve from "./timeline/steve.json";
import text from "./timeline/text.json";

const lights = import.meta.glob("./timeline/lights.json", { eager: true, import: "default" })[
  "./timeline/lights.json"
];
setEdit({ ...data, steve, cam, lights, props, placed, audio, fx, text, adjustments, shots, mouth });
export * from "live-studio/edit";
