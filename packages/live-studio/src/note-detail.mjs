import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { noteLessonFormat, toLearn } from "./note-format.mjs";
import { noteState, noteThread, WORD_NEAR } from "./note-state.mjs";

const shortTimestamp = (at) => {
  if (typeof at === "number" && Number.isFinite(at)) {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().replace(/\.\d+Z$/, "Z");
  }
  if (typeof at !== "string" || !at.trim()) return "";
  return at.trim().replace(/\.\d+(?=(?:Z|[+-]\d{2}:?\d{2})$)/, "");
};

export const noteDetailFormat = ({
  root: ROOT,
  dir,
  projectDir,
  config,
  topics,
  currentVersion,
}) => {
  const posix = (rel) => join(ROOT, rel).replaceAll("\\", "/");
  const pct = (x) => `${Math.round(x * 100) + 0}%`;
  const list = (v) => `[${v.join(", ")}]`;
  const stamp = (s) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const mins = Math.floor(ms / 60000);
    const secs = (ms % 60000) / 1000;
    return `${String(mins).padStart(2, "0")}:${secs.toFixed(3).padStart(6, "0")}`;
  };
  const filmHasVoice = (() => {
    try {
      const vm = JSON.parse(readFileSync(join(ROOT, "renders/live/voice_map.json"), "utf8"));
      if (Array.isArray(vm?.lines) && vm.lines.length > 0) return true;
    } catch {}
    try {
      const edit = JSON.parse(readFileSync(join(ROOT, "src/edit.json"), "utf8"));
      if (Array.isArray(edit?.voice?.lines) && edit.voice.lines.length > 0) return true;
    } catch {}
    return false;
  })();
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
      if (Array.isArray(lines) && lines.length > 0) {
        const here = lines.findIndex((l) => l.s <= t && t <= l.e + 0.35);
        const after = lines.findIndex((l) => l.s > t);
        const afterIdx = after < 0 ? lines.length : after;
        const [before, nxt] = here >= 0 ? [here - 1, here + 1] : [afterIdx - 1, afterIdx];
        out.line = here >= 0 ? lines[here].text : null;
        out.silence = here < 0;
        out.before = before >= 0 ? lines[before].text : null;
        out.next = nxt < lines.length ? lines[nxt].text : null;
      }
    } catch {}
    try {
      const beats = JSON.parse(readFileSync(join(ROOT, "src/edit.json"), "utf8")).beats;
      if (beats && typeof beats === "object") {
        out.beats = Object.entries(beats)
          .filter(([, b]) => b.at - 1.5 <= t && t <= b.at + (b.dur || 0) + 1.5)
          .map(([k, b]) => ({
            id: k,
            title: b.title ?? null,
            at: b.at,
            dur: b.dur ?? null,
            sounds: b.sounds ?? null,
          }));
      }
    } catch {}
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
      const minX = Math.min(x0, x1),
        maxX = Math.max(x0, x1),
        minY = Math.min(y0, y1),
        maxY = Math.max(y0, y1);
      const base = `box at ${m.t}s: ${pct(minX).slice(0, -1)}-${pct(maxX)} across, ${pct(minY).slice(0, -1)}-${pct(maxY)} down, middle ${where([(minX + maxX) / 2, (minY + maxY) / 2], hit(0))}`;
      if (hits.length >= 5) {
        const corners = [
          ["TL", [minX, minY], hit(1)],
          ["TR", [maxX, minY], hit(2)],
          ["BR", [maxX, maxY], hit(3)],
          ["BL", [minX, maxY], hit(4)],
        ].map(([name, pt, h]) => `${name} ${where(pt, h)}`);
        return `${base}; corners: ${corners.join(", ")}`;
      }
      return base;
    }
    if (m.kind === "pen") {
      const keyPts =
        Array.isArray(m.keyPts) && m.keyPts.length === hits.length && hits.length >= 2
          ? m.keyPts
          : hits.length > 2 && m.pts.length === hits.length
            ? m.pts
            : null;
      if (keyPts && keyPts.length > 2)
        return `pen at ${m.t}s: ${keyPts.map((pt, i) => where(pt, hit(i))).join(" -> ")}`;
      if (hits.length > 2) {
        const parts = hits.map((h, i) =>
          i === 0
            ? where(m.pts[0], h)
            : i === hits.length - 1
              ? where(m.pts[m.pts.length - 1], h)
              : `on "${h?.what ?? "?"}"${h?.world ? ` world ${list(h.world)}` : ""}`,
        );
        return `pen at ${m.t}s: ${parts.join(" -> ")}`;
      }
      return `pen at ${m.t}s: from ${where(m.pts[0], hit(0))}, to ${where(m.pts[m.pts.length - 1], hit(1))}`;
    }
    return `arrow at ${m.t}s: tail ${where(m.pts[0], hit(0))}, head ${where(m.pts[m.pts.length - 1], hit(1))}`;
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
    const sceneClock =
      n.srcT != null &&
      Number.isFinite(n.srcT) &&
      Number.isFinite(n.t) &&
      Math.abs(n.srcT - n.t) > 0.01
        ? ` (scene ${stamp(n.srcT)})`
        : "";
    lines.push(
      `\n## #${n.n} ${n.id} ${n.time}${sceneClock}${n.frame == null ? "" : ` frame ${n.frame},`} shot ${n.shot}${n.shotName ? `: ${n.shotName}` : ""}${stateHead(n, thread)}`,
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
      v = c.voice ?? {};
    } else v = workedOut(n);
    const suffix = c ? "" : " (today's edit)";
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
    const hasVoiceContext = filmHasVoice || Boolean(v.word || v.line || v.before || v.next);
    if (v.silence && hasVoiceContext) lines.push(`voice${suffix}: silent here`);
    for (const b of (c || v).beats || []) {
      lines.push(
        `action${suffix}: ${b.id}${b.title ? ` "${b.title}"` : ""} ${b.at}s${b.dur == null ? "" : ` +${b.dur}s`}${b.sounds?.length ? `, sounds ${b.sounds.join(", ")}` : ""}`,
      );
    }
    if (n.freeCam) lines.push(`seen through the free camera${n.cam ? `: ${n.cam.line}` : ""}`);
    if (n.finalLook) lines.push("seen in final quality");
    if (n.compareVideo?.path) {
      const layoutLabel =
        n.compareVideo.layout === "hstack"
          ? "REF | OURS side-by-side"
          : n.compareVideo.layout === "vstack"
            ? "REF / OURS top-bottom"
            : n.compareVideo.category === "reference"
              ? "reference video"
              : n.compareVideo.category === "compare"
                ? "compare video"
                : "rendered video";
      const startPart =
        Number.isFinite(n.compareVideo.startSec) && n.compareVideo.startSec > 0
          ? `, start ${n.compareVideo.startSec}s`
          : "";
      lines.push(`seen in compare video: ${n.compareVideo.path} (${layoutLabel}${startPart})`);
    }
    const writtenAt = shortTimestamp(n.at);
    if (n.version) {
      const diff =
        currentVersion && n.version !== currentVersion
          ? ` (differs from current ${currentVersion})`
          : "";
      lines.push(`said about version: ${n.version}${diff}${writtenAt ? `, at ${writtenAt}` : ""}`);
    } else if (writtenAt) {
      lines.push(`written at ${writtenAt}`);
    }
    if (n.staleBuild === true) {
      lines.push("⚠ captured on an older Studio build before reload");
    }
    for (const m of thread.slice(1)) {
      lines.push(
        m.reworded
          ? `creator reworded it, it was: ${m.text}`
          : m.by === "creator"
            ? `creator answered: ${m.text}`
            : m.ask
              ? `you asked: ${m.text}`
              : `tried: ${m.text} (${m.checkpoint})`,
      );
      if (m.by === "ai") {
        if (m.after) lines.push(`after picture: ${posix(m.after)}`);
        if (m.noAfterReason) lines.push(`no after picture reason: ${m.noAfterReason}`);
        if (m.t != null || m.cam) {
          const camParts = [];
          if (m.t != null) camParts.push(`at ${m.t}s`);
          if (m.cam) {
            camParts.push(`p=${list(m.cam.p)} l=${list(m.cam.l)}`);
            if (m.cam.fov != null) camParts.push(`fov=${m.cam.fov}`);
          }
          lines.push(`after view: ${camParts.join(" ")}`);
        }
      }
    }
    if (n.learned) lines.push(`learned (${SCOPE[n.learned.scope]}): ${n.learned.what}`);
    if (toLearn(n))
      lines.push(
        n.learned && n.learned.scope !== n.remember.scope
          ? `the creator changed it to ${SCOPE[n.remember.scope]} after you kept it for ${SCOPE[n.learned.scope]}: move the rule where ${n.remember.scope === "film" ? (hasProjectLessons ? "this film's rules go (its src, beside what it rules, or lessons/<topic>.md)" : "this film's rules go (its src, beside what it rules)") : `every film's go (${LESSONS_HERE}/<topic>.md)`}, then bun run note learned ${n.id} "the rule, where"`
          : `the creator asked you to remember this (${SCOPE[n.remember.scope]}): ${learnPrompt(n.id)}`,
      );
    if (lessons && (lessons.why || lessons.picks?.length)) {
      for (const l of lessonLines(lessons)) lines.push(l);
    }
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
