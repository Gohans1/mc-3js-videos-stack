import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  cliArgs,
  envTypos,
  jsonFile,
  needFilm,
  numberArg,
} from "../../packages/live-studio/src/cli.mjs";
import { ratioOf } from "../../packages/live-studio/src/frame.ts";
import { staleVideo } from "../../packages/live-studio/src/stale.mjs";
import { startJob } from "../../packages/live-studio/src/tell.mjs";
import { filmVideo, probeVideo, renderCuts } from "../../packages/live-studio/src/video.mjs";

const HELP = `How the film moves: how long each shot runs, and every stretch where the picture holds still, with what the
planned narration says over it. Use a current whole-film render. Use reference study for other files.
  bun run pace                         renders/draft_video.mp4, with renders/cuts.json
  bun run pace renders/final_video.mp4 the whole final
  bun run pace --hold 12               call a hold from 12 s with no new picture (default 8: twice the 4 s average shot
                                       of popular films since 2000; in a Short 5, twice their 2.5 s)
A Short (package.json "live-studio".ratio "9:16") is read against Shorts: their shot lengths and its first 3 s.
A new picture is a cut, or a third of the frame looking different from the last new picture (a slow pan adds up).
Measures only: exit 0 once measured, whatever it finds (a long hold can be the point); 1 on a decode error; 2 when the full render or current cut context is unavailable.
Why these numbers: bun run skills get core --ref review.`;

export const CHANGED = 24;
export const SHARE = 1 / 3;
const FPS = 10;

type Word = { w: string; s: number; e: number };

export const newPictures = (frames: Uint8Array[], fps: number, cuts: number[]) => {
  const out: number[] = [];
  let anchor: Uint8Array | null = null,
    c = 0;
  frames.forEach((f, i) => {
    const t = i / fps;
    const next = c;
    while (c < cuts.length && cuts[c] <= t + 1e-9) {
      if (cuts[c] > 0) out.push(cuts[c]);
      c++;
    }
    if (!anchor) out.push(t);
    else if (next === c) {
      let n = 0;
      for (let k = 0; k < f.length; k++) if (Math.abs(f[k] - anchor[k]) > CHANGED) n++;
      if (n / f.length < SHARE - 1e-9) return;
      out.push(t);
    }
    anchor = f;
  });
  while (c < cuts.length && cuts[c] < frames.length / fps) out.push(cuts[c++]);
  return out;
};

const s2 = (x: number) => x.toFixed(2);
const said = (words: Word[], a: number, b: number) => {
  const text = words
    .filter((w) => w.e > a && w.s < b)
    .map((w) => w.w)
    .join(" ");
  return text ? `"${text.length > 70 ? `${text.slice(0, 69)}…` : text}"` : "no narration";
};

export const stills = (news: number[], length: number) =>
  news.map((a, i) => ({ a, b: news[i + 1] ?? length, len: (news[i + 1] ?? length) - a }));

export const paceReport = ({
  length,
  cuts,
  news,
  words,
  hold,
  short = false,
}: {
  length: number;
  cuts: number[];
  news: number[];
  words: Word[];
  hold: number;
  short?: boolean;
}) => {
  const edges = [0, ...cuts.filter((c) => c > 0 && c < length), length];
  const shots = edges.slice(1).map((b, i) => ({ a: edges[i], b, len: b - edges[i] }));
  const lens = shots.map((s) => s.len).toSorted((p, q) => p - q);
  const mean = length / shots.length,
    median = lens[Math.floor(lens.length / 2)],
    spread = Math.sqrt(lens.reduce((n, l) => n + (l - mean) ** 2, 0) / lens.length) / mean;
  const quarter = [0, 1, 2, 3].map((q) => {
    const inQ = shots.filter(
      (s) => (s.a + s.b) / 2 >= (q * length) / 4 && (s.a + s.b) / 2 < ((q + 1) * length) / 4,
    );
    return inQ.length ? (inQ.reduce((n, s) => n + s.len, 0) / inQ.length).toFixed(1) : "-";
  });
  const longest = shots.toSorted((p, q) => q.len - p.len).slice(0, 3);
  const gaps = stills(news, length);
  const holds = gaps.filter((g) => g.len >= hold);
  const near = gaps
    .filter((g) => g.len < hold)
    .toSorted((p, q) => q.len - p.len)
    .slice(0, 3);
  const opensIn = short ? 3 : 30;
  const opening = news.filter((t) => t > 0 && t < opensIn);
  const firstCut = cuts.find((c) => c > 0);
  const worst = holds.toSorted((p, q) => q.len - p.len)[0] ?? near[0];
  const spoken = holds.filter((g) => said(words, g.a, g.b) !== "no narration");
  const slowOpen = short && (news[1] ?? length) > 2;
  const mid = worst ? +((worst.a + worst.b) / 2).toFixed(2) : 0;
  return [
    `shots: ${shots.length}, mean ${s2(mean)} s, median ${s2(median)} s (${short ? "popular Shorts: about 2.5-4.7 s" : "popular films since 2000: about 4 s"})`,
    `  longest: ${longest.map((s) => `${s2(s.a)}-${s2(s.b)} (${s2(s.len)} s)`).join(", ")}`,
    `  lengths vary by ${Math.round(spread * 100)}% of the mean (shots all one length read flat: mix short, medium, long)`,
    `  mean by quarter of the film: ${quarter.join(" ")} s (${short ? "a Short opens at full pace and keeps the picture switching steadily to the end" : "films tend to open on longer shots and shorten into the climax"})`,
    `new pictures: ${news.length - 1}, one every ${s2(length / news.length)} s`,
    ...holds.map(
      (g) =>
        `  HOLD ${s2(g.a)}-${s2(g.b)} (${g.len.toFixed(1)} s) with no new picture; narration there: ${said(words, g.a, g.b)}`,
    ),
    ...(spoken.length
      ? [
          "  a hold under narration: cut to what the words say, or move the camera; keep it when the stillness is the point",
        ]
      : []),
    ...(holds.length > spoken.length
      ? [
          "  a hold with nothing said: a cut, a camera move or something moving in the frame, or keep it as a breath before what comes",
        ]
      : []),
    ...(near.length
      ? [
          `  longest stills under ${hold} s: ${near.map((g) => `${s2(g.a)}-${s2(g.b)} (${g.len.toFixed(1)} s)`).join(", ")}`,
        ]
      : []),
    short
      ? `first 3 s: ${opening.length} new pictures, ${news[1] === undefined ? "the picture never changes" : `the picture first changes at ${s2(news[1])}`} (YouTube counts who stays past a Short's first seconds; viral Shorts change the picture within about 2 s)`
      : `first 30 s: ${opening.length} new pictures, ${firstCut === undefined ? "no cut" : `the first cut at ${s2(firstCut)}`} (YouTube judges an intro by who still watches at 30 s)`,
    slowOpen
      ? `next: bun run render stills --at 1 shows the opening picture; a cut, a camera move or motion inside 2 s holds the swipe`
      : `next: bun run at ${mid} names what plays in the longest still; bun run render stills --at ${mid} to look`,
  ];
};

if (import.meta.main) {
  const argv = cliArgs(HELP, ["--hold S"], 1);
  envTypos(["LIVE_PROJECT"]);
  const PROJECT = needFilm(process.env.LIVE_PROJECT);
  const readJson = (file: string) => {
    try {
      return jsonFile(file, PROJECT);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  };
  const pkg = readJson(join(PROJECT, "package.json"));
  const short = ratioOf(pkg) === "9:16";
  const holdAt = argv.indexOf("--hold");
  const hold =
    holdAt < 0 ? (short ? 5 : 8) : numberArg("--hold", argv[holdAt + 1] ?? "", { min: 1 });
  const arg = argv.find((a, i) => !a.startsWith("-") && argv[i - 1] !== "--hold");
  const video = resolve(PROJECT, arg ?? "renders/draft_video.mp4");
  const shown = arg ?? "renders/draft_video.mp4";
  if (!existsSync(video) || statSync(video).isDirectory()) {
    console.error(`no video ${shown}: bun run render clip makes renders/draft_video.mp4`);
    process.exit(2);
  }
  const render = filmVideo(PROJECT, video);
  const part = render?.kind;
  if (part) {
    console.error(
      `${shown} is a ${part} of the film; pace measures the whole film: bun run pace renders/draft_video.mp4 (framecheck and sheet read a ${part})`,
    );
    process.exit(2);
  }
  if (basename(video) === "youtube_preview.mp4") {
    console.error(
      `${shown} is deliver's re-encode of a stretch, from its own second 0; pace measures the whole film: bun run pace renders/draft_video.mp4`,
    );
    process.exit(2);
  }
  if (!probeVideo(video)) {
    console.error(`${shown} is no video: give it a render's mp4, as renders/draft_video.mp4`);
    process.exit(2);
  }
  if (!render) {
    console.error(
      `${shown} has no film timeline context: bun run reference study "${shown}" measures the file itself`,
    );
    process.exit(2);
  }
  const stale = staleVideo(PROJECT, video);
  if (stale) {
    console.error(
      `STALE: ${stale.message}\nTo inspect this file as it is: bun run sheet "${shown}" overview`,
    );
    process.exit(2);
  }
  const cutInfo = renderCuts(PROJECT, video);
  if (!("times" in cutInfo)) {
    console.error(cutInfo.reason);
    process.exit(cutInfo.status === "invalid" ? 1 : 2);
  }
  const cuts = [...new Set(cutInfo.times)].toSorted((a, b) => a - b);
  const ended = await startJob(PROJECT, "pace", { say: `Measuring the pace of ${shown}` });
  const tall = short ? "16/9" : "9/16";
  const w = 64,
    h = short ? 114 : 36;
  const ff = spawnSync(
    "ffmpeg",
    [
      "-xerror",
      "-v",
      "error",
      "-i",
      video,
      "-map",
      "0:V:0",
      "-vf",
      `fps=${FPS},crop=iw:min(ih\\,trunc(iw*${tall}/2)*2):0:0,scale=${w}:${h}:flags=area,format=gray`,
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 2 ** 31, timeout: 600e3 },
  );
  if (ff.status !== 0) {
    console.error(
      `ffmpeg could not read ${shown}: ${String(ff.stderr).trim() || ff.error?.message}`,
    );
    await ended({ say: `Could not measure pace of ${shown}`, level: "fail" });
    process.exit(1);
  }
  const frames = Array.from(
    { length: Math.floor(ff.stdout.length / (w * h)) },
    (_, i) => new Uint8Array(ff.stdout.buffer, ff.stdout.byteOffset + i * w * h, w * h),
  );
  if (!frames.length) {
    console.error(`${shown} has no frames to measure: bun run render clip makes it again`);
    await ended({ say: `Could not measure pace of ${shown}`, level: "fail" });
    process.exit(1);
  }
  let words: Word[] = [];
  try {
    const { buildVoiceCues } = await import("../voice/cues.ts");
    const cues = buildVoiceCues(PROJECT);
    if (!cues.voiceOff && !cues.voiceMuted && !cues.audioFault)
      words = cues.lines.flatMap((l: { words?: Word[] }) => l.words ?? []);
    if (words.length)
      console.log(
        "Words are planned narration from voice:cues. Check the encoded audio separately.",
      );
  } catch (e) {
    console.log(
      `narration not read (${(e as Error).message.split("\n")[0]}): the holds are said without it; bun run voice:cues says why`,
    );
  }
  const length = frames.length / FPS;
  console.log(`pace of ${shown}, ${s2(length)} s heard`);
  const news = newPictures(frames, FPS, cuts);
  for (const l of paceReport({ length, cuts, news, words, hold, short })) console.log(l);
  const holds = stills(news, length).filter((g) => g.len >= hold);
  await ended({
    say: `Pace of ${shown}: ${holds.length ? `${holds.length} hold${holds.length > 1 ? "s" : ""} of ${hold} s or more with no new picture` : `a new picture every ${s2(length / news.length)} s, no hold of ${hold} s`}`,
    level: holds.length ? "warn" : "ok",
    ...(holds.length && {
      marks: holds.map((g) => ({ at: g.a, to: g.b, say: `HOLD ${g.len.toFixed(1)} s` })),
    }),
  });
}
