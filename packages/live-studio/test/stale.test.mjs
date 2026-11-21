// src/stale.mjs: framecheck, sheet, pace and deliver say when the video they read is older than the film data it was drawn from
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { seenSound } from "../src/narration.ts";
import { staleVideo } from "../src/stale.mjs";
import { renderIdentity, writeRenderEvidence } from "../src/video.mjs";

const film = () => {
  const dir = mkdtempSync(join(tmpdir(), "stale-"));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "renders"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { soundTimeline: "src/timeline/audio.json" } }),
  );
  for (const f of [
    "src/scene.ts",
    "src/timeline/cam.json",
    "src/timeline/audio.json",
    "renders/draft_video.mp4",
  ])
    writeFileSync(join(dir, f), "x");
  const at = (f, s) => utimesSync(join(dir, f), s, s);
  at("package.json", 1000);
  at("src/scene.ts", 1000);
  at("src/timeline/cam.json", 1000);
  at("src/timeline/audio.json", 1000);
  at("renders/draft_video.mp4", 2000);
  return { dir, at };
};

test("a video rendered after every change to the film is current, and a sound-only change does not age it", () => {
  const { dir, at } = film();
  try {
    expect(staleVideo(dir, "renders/draft_video.mp4")).toBeNull();
    at("src/timeline/audio.json", 5000);
    expect(staleVideo(dir, "renders/draft_video.mp4")).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sound pick can change without aging picture; the render's visual choices still matter", () => {
  const { dir, at } = film();
  try {
    const video = "renders/draft_video.mp4";
    writeRenderEvidence(join(dir, video), { cuts: [], pictureChoices: { costume: "blue" } });
    const picks = join(dir, "choices.json");
    writeFileSync(picks, JSON.stringify({ costume: { set: "blue" }, hit: { set: "soft" } }));
    at("choices.json", 5000);
    expect(staleVideo(dir, video)).toBeNull();
    writeFileSync(picks, JSON.stringify({ costume: { set: "red" }, hit: { set: "soft" } }));
    expect(staleVideo(dir, video)?.file).toBe("choices.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a video older than a picture change names the newest such file and the command that renders it again", () => {
  const { dir, at } = film();
  try {
    at("src/timeline/cam.json", 2600);
    const s = staleVideo(dir, "renders/draft_video.mp4");
    expect(s?.file).toBe("src/timeline/cam.json");
    expect(s?.message).toMatch(
      /renders\/draft_video\.mp4 is older than src\/timeline\/cam\.json \(changed 10 min after it\)/,
    );
    expect(s?.message).toMatch(/bun run render clip/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// draft.mp4 is mix's: draft_video.mp4's picture with the sound of when mix ran, so either can be older than the film
test("a draft with sound is older than its picture, or than its sound, and says which mix brings it up to date", () => {
  const { dir, at } = film();
  try {
    writeFileSync(join(dir, "renders/draft.mp4"), "x");
    mkdirSync(join(dir, "assets/public/agent"), { recursive: true });
    writeFileSync(join(dir, "assets/public/agent/full_voice.wav"), "x");
    at("assets/public/agent/full_voice.wav", 1000);
    at("renders/draft.mp4", 3000);
    expect(staleVideo(dir, "renders/draft.mp4")).toBeNull();

    at("renders/draft_video.mp4", 3600);
    expect(staleVideo(dir, "renders/draft.mp4")?.message).toMatch(
      /renders\/draft\.mp4 has an older picture than renders\/draft_video\.mp4[^\n]*bun run mix renders\/draft_video\.mp4/,
    );

    at("renders/draft_video.mp4", 2000);
    at("src/timeline/audio.json", 3600);
    expect(staleVideo(dir, "renders/draft.mp4")?.message).toMatch(
      /renders\/draft\.mp4 has an older sound than src\/timeline\/audio\.json[^\n]*bun run mix renders\/draft_video\.mp4/,
    );
    at("src/timeline/audio.json", 1000);
    at("assets/public/agent/full_voice.wav", 3600);
    expect(staleVideo(dir, "renders/draft.mp4")?.file).toBe("assets/public/agent/full_voice.wav");

    at("assets/public/agent/full_voice.wav", 1000);
    at("src/scene.ts", 2500);
    expect(staleVideo(dir, "renders/draft.mp4")?.message).toMatch(
      /older than src\/scene\.ts[^\n]*bun run render clip[^\n]*then bun run mix renders\/draft_video\.mp4/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mixed freshness sees removed audio choices and restored input pictures", () => {
  const { dir, at } = film();
  try {
    const picture = join(dir, "renders/draft_video.mp4");
    const output = join(dir, "renders/draft.mp4");
    const choices = join(dir, "choices.json");
    writeFileSync(choices, "{}");
    writeFileSync(output, "x");
    at("choices.json", 1800);
    at("renders/draft.mp4", 3000);
    writeRenderEvidence(picture, { cuts: [], pictureChoices: {} });
    writeRenderEvidence(output, {
      cuts: [],
      pictureInput: renderIdentity(picture),
      audioChoices: { file: "choices.json", ...renderIdentity(choices) },
    });
    expect(staleVideo(dir, output)).toBeNull();
    rmSync(choices);
    expect(staleVideo(dir, output)?.file).toBe("choices.json");
    writeFileSync(picture, "another picture");
    at("renders/draft_video.mp4", 1700);
    expect(staleVideo(dir, output)?.file).toBe("renders/draft_video.mp4");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the upload older than a picture change is drawn again by render final, not render clip", () => {
  const { dir, at } = film();
  try {
    writeFileSync(join(dir, "renders/final.mp4"), "x");
    at("renders/final.mp4", 2000);
    at("src/scene.ts", 3600);
    const message = staleVideo(dir, "renders/final.mp4")?.message;
    expect(message).toMatch(/bun run render final[^\n]*then bun run mix renders\/final_video\.mp4/);
    expect(message).not.toMatch(/render clip/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a span or a final chunk older than a picture change names the render that draws it again", () => {
  const { dir, at } = film();
  try {
    mkdirSync(join(dir, "renders/final_chunks"));
    for (const f of ["renders/span_40-44.mp4", "renders/final_chunks/c02.mp4"]) {
      writeFileSync(join(dir, f), "x");
      at(f, 2000);
    }
    at("src/scene.ts", 3600);
    expect(staleVideo(dir, "renders/span_40-44.mp4")?.message).toMatch(
      /bun run render clip --span 40,44 draws it again/,
    );
    expect(staleVideo(dir, "renders/final_chunks/c02.mp4")?.message).toMatch(
      /bun run render final draws it again/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// the mouths follow the narration clips (src/lips.ts): a render keeps what it drew them from in <chunks>/seen-sound.json
test("a video drawn before a narration clip moved is stale; a gain or a bed changed since is not", () => {
  const { dir, at } = film();
  try {
    const sound = (sfx, beds = []) =>
      writeFileSync(
        join(dir, "src/timeline/audio.json"),
        JSON.stringify({ narration: "n", beds, sfx }),
      );
    mkdirSync(join(dir, "renders/chunks"));
    writeFileSync(
      join(dir, "renders/chunks/seen-sound.json"),
      JSON.stringify(seenSound({ narration: "n", sfx: [{ name: "n", at: 0 }] })),
    );
    sound(
      [
        { name: "n", at: 0, gain: -3 },
        { name: "door", at: 2 },
      ],
      [{ name: "rain", gain: -9 }],
    );
    at("src/timeline/audio.json", 5000);
    expect(staleVideo(dir, "renders/draft_video.mp4")).toBeNull();

    sound([{ name: "n", at: 1.5 }]);
    at("src/timeline/audio.json", 5000);
    const s = staleVideo(dir, "renders/draft_video.mp4");
    expect(s?.file).toBe("src/timeline/audio.json");
    expect(s?.message).toMatch(/narration clips moved[^\n]*bun run render clip draws it again/);

    writeFileSync(join(dir, "renders/draft.mp4"), "x");
    at("renders/draft.mp4", 6000);
    expect(staleVideo(dir, "renders/draft.mp4")?.message).toMatch(
      /narration clips moved[^\n]*bun run render clip[^\n]*then bun run mix renders\/draft_video\.mp4/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bun stale.mjs <video>, as sheet.py and deliver.py run it, prints what aged the video", () => {
  const { dir, at } = film();
  try {
    mkdirSync(join(dir, "renders/chunks"));
    writeFileSync(join(dir, "renders/chunks/c02.mp4"), "x");
    at("renders/chunks/c02.mp4", 2000);
    at("src/scene.ts", 3600);
    const r = spawnSync(
      "bun",
      [fileURLToPath(new URL("../src/stale.mjs", import.meta.url)), "renders/chunks/c02.mp4"],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, LIVE_PROJECT: dir },
      },
    );
    expect(r.stdout).toMatch(
      /renders\/chunks\/c02\.mp4 is older than src\/scene\.ts[^\n]*bun run render clip/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
