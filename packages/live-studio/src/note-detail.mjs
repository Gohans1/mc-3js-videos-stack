import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { noteLessonFormat, toLearn } from "./note-format.mjs";
import { noteState, noteThread, WORD_NEAR } from "./note-state.mjs";

export const noteDetailFormat = ({ root: ROOT, dir, projectDir, config, topics }) => {
  const posix = (rel) => join(ROOT, rel).replaceAll("\\", "/");
  const pct = (x) => `${Math.round(x * 100) + 0}%`;
  const list = (v) => `[${v.join(", ")}]`;
  const SCOPE = { film: "this film", all: "every film" };
  const LESSONS_HERE = relative(ROOT, dir).replaceAll("\\", "/");
  const hasProjectLessons = Boolean(projectDir && resolve(projectDir) !== resolve(dir));
  const { learnPrompt, lessonLines } = noteLessonFormat({
    root: ROOT,
    dir,
    projectDir,
    config,
    topics,
  });
  const isOpen = (n) => noteState(n) === "open";
  const isBack = (n) => isOpen(n) && Boolean(n.fixes?.length);
  const backKind = (n, thread = noteThread(n, { rewordings: true })) => {
    const last = thread.slice(thread.findLastIndex((m) => m.by === "ai") + 1).at(-1);
    return !last ? "plain" : last.reworded ? "reworded" : "answered";
  };
  const workedOut = (n) => {
    const t = n.srcT ?? n.t,
      out = { beats: [] };
    try {
      const lines = JSON.parse(
        readFileSync(join(ROOT, "renders/live/voice_map.json"), "utf8"),
      ).lines;
      const here = lines.findIndex((l) => l.s <= t && t <= l.e + 0.35);
      const after = lines.findIndex((l) => l.s > t);
      const afterIdx = after < 0 ? lines.length : after;
      const [before, nxt] = here >= 0 ? [here - 1, here + 1] : [afterIdx - 1, afterIdx];
      out.line = here >= 0 ? lines[here].text : null;
      out.silence = here < 0;
      out.before = before >= 0 ? lines[before].text : null;
      out.next = nxt < lines.length ? lines[nxt].text : null;
      const beats = JSON.parse(readFileSync(join(ROOT, "src/edit.json"), "utf8")).beats;
      out.beats = Object.entries(beats)
        .filter(([, b]) => b.at - 1.5 <= t && t <= b.at + (b.dur || 0) + 1.5)
        .map(([k, b]) => ({
          id: k,
          title: b.title ?? null,
          at: b.at,
          dur: b.dur ?? null,
          sounds: b.sounds ?? null,
        }));
    } catch {
      /* optional files */
    }
    return out;
  };

  const where = (pt, hit) =>
    `(${pct(pt[0])}, ${pct(pt[1])}) on "${hit?.what ?? "?"}"${hit?.world ? ` world ${list(hit.world)}` : ""}`;

  const drawn = (m) => {
    const hits = m.hits || [],
      hit = (i) => (i < hits.length ? hits[i] : null);
    if (m.kind === "path") {
      const n = Math.min(m.ts.length, m.pts.length);
      const steps = [];
      for (let i = 0; i < n; i++) steps.push(`${m.ts[i]}s ${where(m.pts[i], hit(i))}`);
      return `path ${steps.join(" -> ")}`;
    }
    if (m.kind === "box") {
      const [x0, y0] = m.pts[0],
        [x1, y1] = m.pts[m.pts.length - 1];
      return `box at ${m.t}s: ${pct(Math.min(x0, x1)).slice(0, -1)}-${pct(Math.max(x0, x1))} across, ${pct(Math.min(y0, y1)).slice(0, -1)}-${pct(Math.max(y0, y1))} down, middle ${where([(x0 + x1) / 2, (y0 + y1) / 2], hit(0))}`;
    }
    const ends = { pen: ["from", "to"], arrow: ["tail", "head"] }[m.kind];
    return `${m.kind} at ${m.t}s: ${ends[0]} ${where(m.pts[0], hit(0))}, ${ends[1]} ${where(m.pts[m.pts.length - 1], hit(1))}`;
  };

  const STATE_HEAD = { open: "", check: " (WAITS FOR THE CREATOR'S CHECK)", done: " (DONE)" };
  const BACK_HEAD = {
    plain: " (BACK TO YOU)",
    reworded: " (BACK TO YOU: the creator reworded it after your answer)",
    answered: " (BACK TO YOU: the creator answered)",
  };
  const stateHead = (n, thread) =>
    isBack(n) ? BACK_HEAD[backKind(n, thread)] : STATE_HEAD[noteState(n)];

  return (n, showCam, lessons) => {
    const lines = [];
    const c = n.context,
      thread = noteThread(n, { rewordings: true });
    lines.push(
      `\n## #${n.n} ${n.id} ${n.time}${n.frame == null ? "" : ` frame ${n.frame},`} shot ${n.shot}${n.shotName ? `: ${n.shotName}` : ""}${stateHead(n, thread)}`,
    );
    lines.push(`NOTE: ${n.text}`);
    if (n.pin)
      lines.push(
        `tap: ${pct(n.pin.x)} across, ${pct(n.pin.y)} down, on "${n.pin.what ?? "?"}"${n.pin.world ? `, world ${list(n.pin.world)}` : ""}`,
      );
    else if (n.marks?.length) lines.push("tap: none, it was drawn on");
    else lines.push("tap: none (note button), about the moment as a whole");
    if (n.range) lines.push(`about ${n.range[0]}-${n.range[1]}s, not one moment`);
    for (const m of n.marks ?? []) lines.push(`drawn: ${drawn(m)}`);
    let v;
    if (c) {
      const s = c.shot;
      lines.push(`in shot: ${s.into}s of ${s.from}-${s.to}s`);
      if (c.playing)
        lines.push(`pressed while PLAYING at ${c.rate ?? 1}x: it may be about a moment earlier`);
      if (c.muted) lines.push("heard: the studio was MUTED");
      else if (c.volume != null) lines.push(`heard: the studio at ${pct(c.volume)} volume`);
      if (c.view?.phone)
        lines.push(`seen on a phone${c.view.screen ? `, screen ${c.view.screen.join("x")}` : ""}`);
      v = c.voice;
    } else v = workedOut(n);
    const suffix = c ? "" : " (today's edit)";
    // notes written before the studio kept only a near word may name one across a silence
    if (v.word && (v.wordAt == null || Math.abs(v.wordAt - n.t) <= WORD_NEAR))
      lines.push(
        `word: "${v.word}" at ${v.wordAt ?? "?"}s in "...${v.around ?? ""}..." (heard second when written; now: bun run voice:cues)`,
      );
    for (const [name, key] of [
      ["before", "before"],
      ["saying", "line"],
      ["next", "next"],
    ]) {
      if (v[key]) lines.push(`${name}${suffix}: ${v[key]}`);
    }
    if (v.silence) lines.push(`voice${suffix}: silent here`);
    for (const b of (c || v).beats || []) {
      lines.push(
        `action${suffix}: ${b.id}${b.title ? ` "${b.title}"` : ""} ${b.at}s${b.dur == null ? "" : ` +${b.dur}s`}${b.sounds?.length ? `, sounds ${b.sounds.join(", ")}` : ""}`,
      );
    }
    if (n.freeCam) lines.push(`seen through the free camera${n.cam ? `: ${n.cam.line}` : ""}`);
    if (n.finalLook) lines.push("seen in final quality");
    if (n.version) lines.push(`said about version: ${n.version}`);
    // the thread after the note itself, oldest first: what was tried or asked, what the creator said back or reworded
    for (const m of thread.slice(1))
      lines.push(
        m.reworded
          ? `creator reworded it, it was: ${m.text}`
          : m.by === "creator"
            ? `creator answered: ${m.text}`
            : m.ask
              ? `you asked: ${m.text}`
              : `tried: ${m.text} (${m.checkpoint})`,
      );
    if (n.learned) lines.push(`learned (${SCOPE[n.learned.scope]}): ${n.learned.what}`);
    if (toLearn(n))
      lines.push(
        n.learned && n.learned.scope !== n.remember.scope
          ? `the creator changed it to ${SCOPE[n.remember.scope]} after you kept it for ${SCOPE[n.learned.scope]}: move the rule where ${n.remember.scope === "film" ? (hasProjectLessons ? "this film's rules go (its src, beside what it rules, or lessons/<topic>.md)" : "this film's rules go (its src, beside what it rules)") : `every film's go (${LESSONS_HERE}/<topic>.md)`}, then bun run note learned ${n.id} "the rule, where"`
          : `the creator asked you to remember this (${SCOPE[n.remember.scope]}): ${learnPrompt(n.id)}`,
      );
    for (const l of lessonLines(lessons)) lines.push(l);
    if (showCam && n.cam && !n.freeCam)
      lines.push(`camera: ${n.cam.line ?? "?"}${n.cam.warn ? ` (${n.cam.warn})` : ""}`);
    for (const [label, key] of [
      ["seconds around (-2 -1 0 +1)", "strip"],
      ["frame", "img"],
      ["under the tap", "crop"],
    ]) {
      if (n[key]) lines.push(`${label}: ${posix(n[key])}`);
    }
    for (const f of n.frames ?? []) lines.push(`drawn at ${f.t}s: ${posix(f.img)}`);
    (n.refs ?? []).forEach((r, i) =>
      lines.push(`reference ${i + 1} (pasted by the creator, not the film): ${posix(r)}`),
    );
    return lines;
  };
};
