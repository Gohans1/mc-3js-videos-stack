// SubRip captions of the voice, cut the way Netflix's English timed-text style guide asks: at most 42 characters a line and two
// lines a caption, each on screen 5/6 s to 7 s and two frames clear of the next, a sentence's end closing its caption. Each
// caption keeps its words' own times (whisperX, voice_map.json) through heard(), the voice edit's map to the seconds heard
const SENTENCE_END = /[.!?…]["')\]]*$/;

// The guide's line breaks: after punctuation, before a preposition or a conjunction, and never between an article, a
// preposition, a conjunction or a possessive and what it leads. Weighed in characters of unevenness between the two lines
const AFTER_PUNCTUATION = /[,;:.!?…]["')\]]*$/;
const JOINS = ["of", "to", "in", "on", "at", "by", "for", "from", "with", "into", "onto", "and", "or", "but", "nor"];
const BEFORE = new Set(JOINS), LEADS = new Set([...JOINS, "a", "an", "the", "his", "her", "its", "my", "your", "our", "their", "this", "that"]);

// The words as one or two lines, split where the two come out nearest in length (the lower one the longer on a tie)
const layout = (words, chars) => {
  const one = words.join(" ");
  if (one.length <= chars || words.length < 2) return one;
  let best = null;
  for (let k = 1; k < words.length; k++) {
    const top = words.slice(0, k).join(" "), bottom = words.slice(k).join(" "), last = words[k - 1];
    if (top.length > chars || bottom.length > chars) continue;
    const off = Math.abs(top.length - bottom.length) + (top.length > bottom.length ? 0.5 : 0)
      - (AFTER_PUNCTUATION.test(last) ? 10 : 0) - (BEFORE.has(words[k].toLowerCase()) ? 5 : 0) + (LEADS.has(last.toLowerCase()) ? chars : 0);
    if (!best || off < best.off) best = { off, text: `${top}\n${bottom}` };
  }
  return best?.text ?? null;
};

export const cues = (lines, heard = (s) => s, { chars = 42, min = 5 / 6, max = 7, gap = 2 / 30 } = {}) => {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  for (const l of lines) {
    l.words.forEach((x, i) => {
      const w = { w: x.w, s: heard(x.s), e: heard(x.e) };
      if (cur.length && (layout([...cur, w].map((y) => y.w), chars) === null || w.e - cur[0].s > max)) flush();
      cur.push(w);
      if (i === l.words.length - 1 || SENTENCE_END.test(x.w)) flush();
    });
  }
  return out.map((ws, i) => {
    const s = ws[0].s, next = out[i + 1];
    return { s, e: Math.min(Math.max(ws.at(-1).e, s + min), next ? next[0].s - gap : Infinity), text: layout(ws.map((w) => w.w), chars) ?? ws.map((w) => w.w).join(" ") };
  });
};

const stamp = (x) => {
  const ms = Math.max(0, Math.round(x * 1000)), p = (n, d = 2) => String(n).padStart(d, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
export const srt = (list) => list.map((c, i) => `${i + 1}\n${stamp(c.s)} --> ${stamp(c.e)}\n${c.text}\n`).join("\n");
