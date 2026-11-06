// @ts-nocheck
// The film's whole timeline is EDIT: src/edit.json holds what the studio reads (voice, beats) and the film's small settings;
// Steve's keys, the camera keys, the props and the audio each have their own file in src/timeline/ (write them with
// scripts/timeline_fmt.py). Saving any of them rebuilds the studio page, and its next reload shows the change.
import data from "./edit.json";
import audio from "./timeline/audio.json";
import cam from "./timeline/cam.json";
import props from "./timeline/props.json";
import steve from "./timeline/steve.json";
import { setEdit } from "live-studio/edit";

setEdit({ ...data, steve, cam, props, audio });
export * from "live-studio/edit";
