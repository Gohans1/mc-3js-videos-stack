// The caption under the picture: the voice line being said now. One transcribed line can run to 95 words, so a caption is
// the piece being said now, cut where a reader would pause
import type { Line } from "../core/state";
import { S } from "../core/state";

const CAPTION_WORDS = 10;
const captionPieces = (words: Line["words"]) => {
  const pieces: Line["words"][] = [];
  let piece: Line["words"] = [];
  for (const word of words) {
    piece.push(word);
    if (/[.?!]["']?$/.test(word.w) || (/[,;:]$/.test(word.w) && piece.length >= 5) || piece.length >= CAPTION_WORDS) { pieces.push(piece); piece = []; }
  }
  if (piece.length) { if (piece.length < 3 && pieces.length) pieces.at(-1)!.push(...piece); else pieces.push(piece); }
  return pieces;
};
export const captionAt = (x: number) => {
  const line = S.voiceOut.find((l) => x >= l.s && x <= l.e + 0.35);
  if (!line) return null;
  if (!line.words.length) return line.text;
  line.pieces ??= captionPieces(line.words);
  const now = line.pieces.findLast((piece) => x >= piece[0].s) ?? line.pieces[0];
  return now.map((word) => word.w).join(" ");
};
