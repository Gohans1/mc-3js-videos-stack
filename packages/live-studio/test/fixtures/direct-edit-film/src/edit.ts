import { setEdit } from "live-studio/edit";

import data from "./edit.json";
import adjustments from "./timeline/adjust.json";
import cam from "./timeline/cam.json";
import fx from "./timeline/fx.json";
import shots from "./timeline/shots.json";
import text from "./timeline/text.json";
setEdit({ ...data, cam, shots, text, adjustments, fx });
export * from "live-studio/edit";
