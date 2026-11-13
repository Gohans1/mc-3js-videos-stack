// bun run pace: how long each shot runs and how long the picture holds still, with the narration over each hold; HELP below.
// A new picture is a cut, or a third of the frame looking different (by over CHANGED of 255) from the last new picture,
// so a slow pan adds up to one. The numbers to read them against: popular films since 2000 average about 4 s a shot,
// open on longer shots and shorten into the climax (Cutting, "The evolution of pace in popular movies", 2016); YouTube
// judges an intro by who still watches at 30 s (YouTube Help, key moments for audience retention). A Short (9:16) is read
// against Shorts instead: popular ones average about 2.5 s a shot (100 Shorts of 2024, in "Visual Storytelling Without
// Dialogue", 2025) and viral ones a median 4.7 s with the first cut by about 2 s (Viibeo, 54 Shorts, 2026, counting cuts
// only); YouTube's Shorts analytics count who stays past the first seconds. Measures, never verdicts: a hold can be the
// film's best moment, so this always exits 0
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cliArgs, needFilm, numberArg } from "../../packages/live-studio/src/cli.mjs";
import { ratioOf } from "../../packages/live-studio/src/frame.ts";
import { staleVideo } from "../../packages/live-studio/src/stale.mjs";

const HELP = `How the film moves: how long each shot runs, and every stretch where the picture holds still, with what the
narration says over it. Run inside the film, on a video bun run render clip made.
  bun run pace                         renders/draft_video.mp4, with renders/cuts.json
  bun run pace renders/final_video.mp4 any whole-film video
  bun run pace --hold 12               call a hold from 12 s with no new picture (default 8: twice the 4 s average shot
                                       of popular films since 2000; in a Short 5, twice their 2.5 s)
A Short (package.json "live-studio".ratio "9:16") is read against Shorts: their shot lengths and its first 3 s.
A new picture is a cut, or a third of the frame looking different from the last new picture (a slow pan adds up).
Measures only, always exit 0: a long hold can be the point. Why these numbers: bun run skills get core --ref review.`;

export const CHANGED = 24;
export const SHARE = 1 / 3;
const FPS = 10;

type Word = { w: string; s: number; e: number };

// seconds where a new picture starts: the first frame, every cut, and every frame a third different from the last new one
export const newPictures = (frames: Uint8Array[], fps: number, cuts: number[]) => {
  const out: number[] = [];
  let anchor: Uint8Array | null = null,
    c = 0;
  frames.forEach((f, i) => {
    const t = i / fps;
    let cut: number | null = null;
    while (c < cuts.length && cuts[c] <= t + 1e-9) cut = cuts[c++];
    if (anchor && cut === null) {
      let n = 0;
      for (let k = 0; k < f.length; k++) if (Math.abs(f[k] - anchor[k]) > CHANGED) n++;
      if (n / f.length < SHARE - 1e-9) return;
    }
    out.push(cut ?? t);
    anchor = f;
  });
  return out;
};

const s2 = (x: number) => x.toFixed(2);
const said = (words: Word[], a: number, b: number) => {
  const text = words
    .filter((w) => w.s >= a && w.s < b)
    .map((w) => w.w)
    .join(" ");
  return text ? `"${text.length > 70 ? `${text.slice(0, 69)}…` : text}"` : "no narration";
};

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
  const shots = edges.slice(1).map((b, i) => ({ i, a: edges[i], b, len: b - edges[i] }));
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
  const gaps = news
    .map((t, i) => ({ a: t, b: news[i + 1] ?? length }))
    .map((g) => ({ ...g, len: g.b - g.a }));
  const holds = gaps.filter((g) => g.len >= hold);
  const near = gaps
    .filter((g) => g.len < hold)
    .toSorted((p, q) => q.len - p.len)
    .slice(0, 3);
  const opensIn = short ? 3 : 30;
  const opening = news.filter((t) => t > 0 && t < opensIn);
  const firstCut = cuts.find((c) => c > 0);
  const worst = holds.toSorted((p, q) => q.len - p.len)[0] ?? near[0];
  return [
    `shots: ${shots.length}, mean ${s2(mean)} s, median ${s2(median)} s (${short ? "popular Shorts: about 2.5-4.7 s" : "popular films since 2000: about 4 s"})`,
    `  longest: ${longest.map((s) => `shot ${s.i} at ${s2(s.a)}-${s2(s.b)} (${s2(s.len)} s)`).join(", ")}`,
    `  lengths vary by ${Math.round(spread * 100)}% of the mean (shots all one length read flat: mix short, medium, long)`,
    `  mean by quarter of the film: ${quarter.join(" ")} s (${short ? "a Short opens at full pace and keeps the picture switching steadily to the end" : "films tend to open on longer shots and shorten into the climax"})`,
    `new pictures: ${news.length - 1}, one every ${s2(length / news.length)} s`,
    ...holds.map(
      (g) =>
        `  HOLD ${s2(g.a)}-${s2(g.b)} (${g.len.toFixed(1)} s) with no new picture; narration there: ${said(words, g.a, g.b)}`,
    ),
    ...(near.length
      ? [
          `  longest stills under ${hold} s: ${near.map((g) => `${s2(g.a)}-${s2(g.b)} (${g.len.toFixed(1)} s)`).join(", ")}`,
        ]
      : []),
    short
      ? `first 3 s: ${opening.length} new pictures, ${news[1] === undefined ? "the picture never changes" : `the picture first changes at ${s2(news[1])}`} (YouTube counts who stays past a Short's first seconds; viral Shorts change the picture within about 2 s)`
      : `first 30 s: ${opening.length} new pictures, ${firstCut === undefined ? "no cut" : `the first cut at ${s2(firstCut)}`} (YouTube judges an intro by who still watches at 30 s)`,
    `next: bun run at ${worst ? +((worst.a + worst.b) / 2).toFixed(2) : 0} names what plays in the longest still; AT=<s> bun run render stills to look`,
  ];
};

// ---------- The command
if (import.meta.main) {
  const argv = cliArgs(HELP, ["--hold S"], 1);
  const PROJECT = needFilm(process.env.LIVE_PROJECT);
  const pkg = JSON.parse(readFileSync(join(PROJECT, "package.json"), "utf8"));
  const short = ratioOf(pkg) === "9:16";
  const holdAt = argv.indexOf("--hold");
  const hold =
    holdAt < 0 ? (short ? 5 : 8) : numberArg("--hold", argv[holdAt + 1] ?? "", { min: 1 });
  const arg = argv.find((a, i) => !a.startsWith("-") && argv[i - 1] !== "--hold");
  const video = resolve(PROJECT, arg ?? "renders/draft_video.mp4");
  if (!existsSync(video)) {
    console.error(`no ${arg ?? "renders/draft_video.mp4"}: bun run render clip makes it`);
    process.exit(2);
  }
  const cutsFile = join(PROJECT, "renders/cuts.json");
  if (!existsSync(cutsFile)) {
    console.error(
      "no renders/cuts.json, the shots' cuts: bun run render clip writes it with the video",
    );
    process.exit(2);
  }
  const cuts: number[] = JSON.parse(readFileSync(cutsFile, "utf8"));
  const stale = staleVideo(PROJECT, video);
  if (stale) console.log(`STALE: ${stale.message}`);
  // the picture only: a draft has a strip under it, so the top of the frame at the film's own shape
  const tall = short ? "16/9" : "9/16";
  const w = 64,
    h = short ? 114 : 36;
  // 64 pixels wide, 10 a second: a 20-minute film is about 27 MB
  const ff = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      video,
      "-vf",
      `fps=${FPS},crop=iw:trunc(iw*${tall}/2)*2:0:0,scale=${w}:${h}:flags=area,format=gray`,
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 2 ** 31, timeout: 600e3 },
  );
  if (ff.status !== 0) {
    console.error(
      `ffmpeg could not read ${arg ?? "renders/draft_video.mp4"}: ${String(ff.stderr).trim() || ff.error?.message}`,
    );
    process.exit(1);
  }
  const frames = Array.from(
    { length: Math.floor(ff.stdout.length / (w * h)) },
    (_, i) => new Uint8Array(ff.stdout.buffer, ff.stdout.byteOffset + i * w * h, w * h),
  );
  let words: Word[] = [];
  try {
    const { buildVoiceCues } = await import("../voice/cues.ts");
    words = buildVoiceCues(PROJECT).lines.flatMap((l: { words?: Word[] }) => l.words ?? []);
  } catch {} // a film with no narration yet: the holds are said without words
  const length = frames.length / FPS;
  console.log(`pace of ${arg ?? "renders/draft_video.mp4"}, ${s2(length)} s heard`);
  const news = newPictures(frames, FPS, cuts);
  for (const l of paceReport({ length, cuts, news, words, hold, short })) console.log(l);
}
