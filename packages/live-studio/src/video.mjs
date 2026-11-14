import { spawnSync } from "node:child_process";

// Where a rendered video sits on the film's heard clock, read from its name (render.mjs names them so):
//   renders/chunks/cNN.mp4, renders/final_chunks/cNN.mp4  NN*30 s on (render.mjs CHUNK)
//   renders/span_<from>-<to>.mp4                           a SPAN run's, <from> s on
// anything else starts at 0. scripts/review/sheet.py reads the same names in Python; change both together.
export const videoStart = (video) => {
  const chunk = /(?:^|[\\/])(final_)?chunks[\\/]c(\d+)\.mp4$/.exec(video);
  if (chunk) return { start: Number(chunk[2]) * 30, kind: "chunk", final: Boolean(chunk[1]) };
  const span = /(?:^|[\\/])span_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\.mp4$/.exec(video);
  if (span)
    return { start: Number(span[1]), kind: "span", span: [Number(span[1]), Number(span[2])] };
  return { start: 0, kind: null };
};

// A video's stream as ffprobe reads it ({ width, height, fps }), or null for a picture (ffprobe reads one as a one-frame
// video stream: image2, png_pipe, ...) or a file it cannot read
export const probeVideo = (file) => {
  const r = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate:format=format_name",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8" },
  );
  let probed;
  try {
    probed = JSON.parse(r.stdout || "{}");
  } catch {
    return null;
  }
  const st = probed.streams?.[0];
  if (!st || /^image2|_pipe$/.test(probed.format?.format_name ?? "")) return null;
  const [num, den] = st.r_frame_rate.split("/").map(Number);
  return { width: st.width, height: st.height, fps: num / (den || 1) };
};
