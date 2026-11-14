// Can the words over the picture be read: the subtitle standards are the published rules for words over moving pictures.
// Netflix's timed text: up to 20 characters a second for adults, at least 5/6 s on screen. BBC's subtitle guidelines: a
// line 7-8% of the frame height as authored, which a player may shrink to about half; SIZE_MIN (36 px at 1080, 3.3%) is
// that half, and the floor under which words turn to mush on a phone. An item with "read": false is decor (a sign in the
// world, a glitch) and is never judged
import { graphemes, inOutLengths } from "film-stage/titles-text";

export const READ_CPS = 20;
export const READ_MIN = 5 / 6;
export const SIZE_MIN = 36;

// tracks: the text file's own (a hidden track's items are off screen, as a hidden item is)
export const isRead = (it, tracks) =>
  it?.kind === "text" &&
  it.read !== false &&
  !it.hidden &&
  !tracks?.[it.track ?? 0]?.hidden &&
  !!it.text?.trim();
export const charsOf = (text) => graphemes(text.replace(/\s*\n\s*/g, " ").trim()).length;
// px at 1080 on the frame's short side, as film-stage/titles.ts sizes it
export const pxOf = (it) => (it.size ?? 56) * (it.scale ?? 1);

// heard: the item mapped to heard seconds. A fade or a typing is about half there at its middle, so half the In and half
// the Out count as read; both are the item's own seconds, scaled when a Speed stretches the item. The size floor holds
// for a Short too: played full screen, a film's short side (a Short's width) is the phone's short side either way
// the size floor needs no clock: said even for a film whose length is not in its data
export const sizeFaults = (scene, ratio = "16:9") => {
  // titles.ts multiplies them: a word ("big", "2") draws at no size the canvas takes
  const word = ["size", "scale"].find((k) => scene[k] != null && typeof scene[k] !== "number");
  if (word)
    return [
      `"${word}" is ${JSON.stringify(scene[word])}, not a number: ${word === "size" ? "px at 1080, e.g. 56" : "a factor, e.g. 1.5"}`,
    ];
  const px = pxOf(scene);
  if (!(px > 0))
    return [
      `size ${+px.toFixed(1)} draws no text: a size above 0 (${SIZE_MIN} or more to read on a phone)`,
    ];
  return px < SIZE_MIN
    ? [
        `size ${+px.toFixed(1)} is ${((px / 1080) * 100).toFixed(1)}% of the frame ${ratio === "9:16" ? "width" : "height"}; under ${SIZE_MIN} (3.3%) words are mush on a phone (BBC subtitles: a line is 7-8%): size ${SIZE_MIN} or more`,
      ]
    : [];
};
export const readFaults = (scene, heard, ratio = "16:9") => {
  const span = heard.to - heard.from,
    io = inOutLengths(scene),
    k = span / (scene.to - scene.from || 1);
  const readable = span - ((io.in + io.out) / 2) * k,
    chars = charsOf(scene.text),
    needs = Math.max(READ_MIN, chars / READ_CPS);
  return [
    ...(readable < needs - 0.005
      ? [
          `readable about ${readable.toFixed(2)} s for ${chars} characters; a reader needs ${needs.toFixed(2)} s (${READ_CPS} a second and at least ${READ_MIN.toFixed(2)} s, Netflix's subtitle pace): hold it longer, cut words, or a shorter In and Out`,
        ]
      : []),
    ...sizeFaults(scene, ratio),
  ];
};
