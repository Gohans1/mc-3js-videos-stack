// @ts-nocheck
// The film's whole timeline is EDIT: src/edit.json holds what the studio reads (voice, beats) and the film's small settings;
// Steve's keys, the camera keys, the shots, the props, the objects dropped in from the studio, the audio, the fades to black (fx.json) and the titles over the picture (text.json) each have their own file in src/timeline/ (write them with
// scripts/timeline_fmt.py). The ones package.json "live-studio" lists (camTimeline, soundTimeline, shotsTimeline, textTimeline, keyFiles) the
// studio reads and writes itself, so a save shows at once; saving any other rebuilds the page, and its next reload shows it.
import data from "./edit.json";
import audio from "./timeline/audio.json";
import cam from "./timeline/cam.json";
import fx from "./timeline/fx.json";
import placed from "./timeline/placed.json";
import props from "./timeline/props.json";
import shots from "./timeline/shots.json";
import steve from "./timeline/steve.json";
import text from "./timeline/text.json";
import adjustments from "./timeline/adjust.json";
import { setEdit } from "live-studio/edit";

setEdit({ ...data, steve, cam, props, placed, audio, shots, fx, text, adjustments });
export * from "live-studio/edit";
