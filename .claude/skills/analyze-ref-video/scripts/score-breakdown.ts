import { readFileSync } from "node:fs";
import { basename } from "node:path";

const TAXONOMY_CATEGORIES = new Set([
  "Transitions & Continuity",
  "Camera, Framing & Staging",
  "Motion, Acting & Prop State",
  "Optics: Blur, DOF & Temporal",
  "Lighting, Color & Materials",
  "VFX, Cutaways & Graphics",
  "Audio-Visual Sync & Soundscape",
  "Other",
]);

const BOUNDARY_PATTERNS = [
  /^Opening$/i,
  /^Hard Cut$/i,
  /^Hidden Cut\s*\(.+\)$/i,
  /^Transition\s*\(.+\)$/i,
  /^Continuous \[NO CUT\]\s*\(.+\)$/i,
];

const LEAK_REGEX =
  /\bdraw\(t\)|\bTHREE\.|\bminecraft\b|\bvoxel\b|\bblocky\b|block head|bun run /i;
const FAKE_MM_REGEX = /\b(14|16|18|20|24|28|35|40|50|65|70|85|100|135|200)\s*mm\b/i;

interface Row {
  cells: string[];
  line: number;
}

interface ScoreReport {
  file: string;
  chars: number;
  lines: number;
  sections: number[];
  sec2Rows: number;
  sec3Rows: number;
  sec1Counts: Record<string, number | null>;
  sec2Counts: Record<string, number>;
  pillar1Max25: {
    total: number;
    structureComplete: number;
    zeroLeaks: number;
    boundariesAndParity: number;
    taxonomyAndOrder: number;
    signalDensity: number;
  };
  metrics: {
    sec2LensPct: number;
    sec2CurvePct: number;
    hasShadowHardness: boolean;
    hasFinishingCalibration: boolean;
    hasSecretSauce: boolean;
    hasAudioCues: boolean;
    leaks: string[];
    fakeMmHits: string[];
    badBoundaries: string[];
    badCategories: string[];
    sec2OrderViolations: number;
    sec3OrderViolations: number;
    countMismatches: string[];
    audioCatchAll: boolean;
    missingOtherBoldLabel: number;
    transitionMissingSpan: number;
  };
  pillar2Max25: {
    available: boolean;
    score: number | null;
    matchedScenes: number;
    totalScenes: number;
    unmatchedScenes: number[];
  };
  gtSamplingPlan: {
    recallSlotsSec: number[];
    claimSampleFrames: number[];
  };
  issues: string[];
}

function parseTable(sectionBody: string): Row[] {
  const rows: Row[] = [];
  const lines = sectionBody.split("\n");
  let headerSeen = false;
  let sepSeen = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]?.trim() ?? "";
    if (!raw.startsWith("|")) {
      if (sepSeen) break;
      continue;
    }
    const cells = raw
      .slice(1, raw.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim());
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }
    if (!sepSeen && cells.every((c) => /^:?-+:?$/.test(c))) {
      sepSeen = true;
      continue;
    }
    if (sepSeen && cells.length >= 4) rows.push({ cells, line: i + 1 });
  }
  return rows;
}

function firstFrame(cell: string): number | null {
  const m = cell.match(/\bf(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

function classifyBoundary(val: string): string {
  const clean = val.replace(/`/g, "").trim();
  if (/^Opening\b/i.test(clean)) return "Opening";
  if (/^Hard Cut\b/i.test(clean)) return "Hard Cut";
  if (/^Hidden Cut\b/i.test(clean)) return "Hidden Cut";
  if (/^Transition\b/i.test(clean)) return "Transition";
  if (/^Continuous \[NO CUT\]/i.test(clean)) return "Continuous";
  return "INVALID";
}

function extractSec1Count(sec1: string, label: string): number | null {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(\\d+)\\s+\`?${esc}(?:\\s*\\[NO CUT\\])?\`?`, "i"),
    new RegExp(`\`?${esc}(?:\\s*\\[NO CUT\\])?\`?\\s*[:=]\\s*(\\d+)`, "i"),
    new RegExp(`\`?${esc}(?:\\s*\\[NO CUT\\])?\`?\\s*\\((\\d+)\\)`, "i"),
  ];
  for (const re of patterns) {
    const m = sec1.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

function scoreMarkdown(
  filePath: string,
  scenesPath?: string,
  durationSec?: number,
  fps = 30,
): ScoreReport {
  const text = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const secMatches = [...text.matchAll(/^###\s+([1-4])\.\s+.+$/gm)];
  const sections = secMatches.map((m) => Number(m[1]));

  const sliceSec = (n: number): string => {
    const idx = secMatches.findIndex((m) => Number(m[1]) === n);
    if (idx < 0) return "";
    const start = secMatches[idx]!.index ?? 0;
    const end = idx + 1 < secMatches.length ? (secMatches[idx + 1]!.index ?? text.length) : text.length;
    return text.slice(start, end);
  };

  const sec1 = sliceSec(1);
  const sec2 = sliceSec(2);
  const sec3 = sliceSec(3);
  const sec4 = sliceSec(4);

  const sec2Rows = parseTable(sec2);
  const sec3Rows = parseTable(sec3);
  const issues: string[] = [];

  let structureComplete = 0;
  for (const req of [1, 2, 3, 4]) {
    if (sections.includes(req)) structureComplete += 1;
    else issues.push(`Missing Section ${req}`);
  }
  if (sec4.trim().length < 40) {
    structureComplete = Math.max(0, structureComplete - 1);
    issues.push("Section 4 looks truncated or empty");
  }

  const leaks: string[] = [];
  const fakeMmHits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lm = line.match(LEAK_REGEX);
    if (lm) leaks.push(`L${i + 1}: ${lm[0]}`);
    const mm = line.match(FAKE_MM_REGEX);
    if (mm && !/on-set monitor|field monitor|telemetry|HUD|film\s+stock/i.test(line)) {
      fakeMmHits.push(`L${i + 1}: ${mm[0]}`);
    }
  }
  const zeroLeaks = Math.max(0, 5 - leaks.length * 2.5 - fakeMmHits.length * 1.5);
  if (leaks.length) issues.push(`Style/engine leaks: ${leaks.join(", ")}`);
  if (fakeMmHits.length) issues.push(`Guessed numeric focal mm: ${fakeMmHits.join(", ")}`);

  const sec2Counts: Record<string, number> = {
    Opening: 0,
    "Hard Cut": 0,
    "Hidden Cut": 0,
    Transition: 0,
    Continuous: 0,
  };
  const badBoundaries: string[] = [];
  let sec2OrderViolations = 0;
  let prevF2 = -1;
  let transitionMissingSpan = 0;
  const sec2Starts: number[] = [];

  for (const row of sec2Rows) {
    const timeCell = row.cells[1] ?? "";
    const boundaryCell = (row.cells[2] ?? "").replace(/`/g, "").trim();
    const f = firstFrame(timeCell);
    if (f !== null) {
      sec2Starts.push(f);
      if (f < prevF2) sec2OrderViolations++;
      prevF2 = f;
    }
    const validEnum = BOUNDARY_PATTERNS.some((re) => re.test(boundaryCell));
    const kind = classifyBoundary(boundaryCell);
    if (!validEnum || kind === "INVALID") badBoundaries.push(boundaryCell);
    else sec2Counts[kind] = (sec2Counts[kind] ?? 0) + 1;
    if (kind === "Transition" && !/f\d+\s*[–\-→]\s*f\d+/i.test(boundaryCell)) {
      transitionMissingSpan++;
    }
  }

  const sec1Counts: Record<string, number | null> = {
    "Hard Cut": extractSec1Count(sec1, "Hard Cut"),
    "Hidden Cut": extractSec1Count(sec1, "Hidden Cut"),
    Transition: extractSec1Count(sec1, "Transition"),
    Continuous: extractSec1Count(sec1, "Continuous"),
  };
  const countMismatches: string[] = [];
  for (const key of ["Hard Cut", "Hidden Cut", "Transition", "Continuous"]) {
    const reported = sec1Counts[key];
    const actual = sec2Counts[key] ?? 0;
    if (reported !== null && reported !== actual) {
      countMismatches.push(`${key}: Sec1=${reported} vs Sec2=${actual}`);
    }
  }
  let boundariesAndParity = 6;
  if (sec2Rows.length === 0) boundariesAndParity = 0;
  boundariesAndParity -= Math.min(3, badBoundaries.length * 1.5);
  boundariesAndParity -= Math.min(2, countMismatches.length * 1.0);
  boundariesAndParity -= Math.min(1, sec2OrderViolations * 0.5 + transitionMissingSpan * 0.5);
  boundariesAndParity = Math.max(0, Number(boundariesAndParity.toFixed(2)));
  if (badBoundaries.length) issues.push(`Invalid Sec 2 boundaries: ${badBoundaries.join("; ")}`);
  if (countMismatches.length) issues.push(`Sec 1/2 count mismatch: ${countMismatches.join("; ")}`);
  if (sec2OrderViolations) issues.push(`Sec 2 ascending frame violations: ${sec2OrderViolations}`);

  const badCategories: string[] = [];
  let sec3OrderViolations = 0;
  let prevF3 = -1;
  let audioCatchAll = false;
  let missingOtherBoldLabel = 0;
  const sec3Starts: number[] = [];

  for (const row of sec3Rows) {
    const timeCell = row.cells[0] ?? "";
    const cat = (row.cells[2] ?? "").replace(/`/g, "").trim();
    const desc = row.cells[3] ?? "";
    const f = firstFrame(timeCell);
    if (f !== null) {
      sec3Starts.push(f);
      if (f < prevF3) sec3OrderViolations++;
      prevF3 = f;
    }
    if (!TAXONOMY_CATEGORIES.has(cat)) badCategories.push(cat);
    if (cat === "Other" && !/\*\*[^*]+:\*\*/.test(desc)) missingOtherBoldLabel++;
    if (cat === "Audio-Visual Sync & Soundscape" && /00:00\.000.*(END|end)/i.test(timeCell)) {
      audioCatchAll = true;
    }
  }

  let taxonomyAndOrder = 6;
  if (sec3Rows.length === 0) taxonomyAndOrder = 0;
  taxonomyAndOrder -= Math.min(3, badCategories.length * 1.5);
  taxonomyAndOrder -= Math.min(2, sec3OrderViolations * 0.5);
  if (audioCatchAll) taxonomyAndOrder -= 1;
  if (missingOtherBoldLabel) taxonomyAndOrder -= 0.5;
  taxonomyAndOrder = Math.max(0, Number(taxonomyAndOrder.toFixed(2)));
  if (badCategories.length) issues.push(`Invalid Sec 3 categories: ${badCategories.join("; ")}`);
  if (sec3OrderViolations) issues.push(`Sec 3 ascending frame violations: ${sec3OrderViolations}`);
  if (audioCatchAll) issues.push("Sec 3 has forbidden 00:00-END audio catch-all row");

  const lensRe =
    /\b(ultra-wide|wide-angle|wide|normal|telephoto|macro|flat 2D|2D ortho|ortho|low-angle|high-angle|eye-level|bird'?s-eye|ground-level|close-up|medium|tight crop|overhead|locked)\b/i;
  const curveRe = /\b(ease-in|ease-out|snap|snappy|overshoot|settle|bounce|linear|stepped|on-2s|on-3s|on-1s|slow-mo|timelapse|hit-stop|weight|damped|whip|drift)\b/i;
  const sec2LensHits = sec2Rows.filter((r) => lensRe.test(r.cells[3] ?? "")).length;
  const sec2CurveHits = sec2Rows.filter(
    (r) => curveRe.test(r.cells[3] ?? "") || curveRe.test(r.cells[4] ?? ""),
  ).length;
  const sec2LensPct = sec2Rows.length ? Math.round((sec2LensHits / sec2Rows.length) * 1000) / 10 : 0;
  const sec2CurvePct = sec2Rows.length ? Math.round((sec2CurveHits / sec2Rows.length) * 1000) / 10 : 0;
  const hasShadowHardness = /\b(hard|crisp|soft|diffuse|flat unlit)\b.*\bshadow|flat unlit/i.test(sec1 + sec3);
  const hasFinishingCalibration = /\b(clean render|no optical grit|grain|halation|flare|vignette|bloom|chromatic)\b/i.test(sec1);
  const hasSecretSauce = /Secret-Sauce/i.test(sec1);
  const hasAudioCues = /\b(BGM|voiceover|VO|silence|J-cut|L-cut|silent|SFX)\b/i.test(sec1);

  let signalDensity = 0;
  if (sec2LensPct >= 30) signalDensity += 1;
  else issues.push(`Low Sec 2 lens/angle coverage (${sec2LensPct}%)`);
  if (sec2CurvePct >= 15 || curveRe.test(sec3)) signalDensity += 1;
  else issues.push(`Low motion curve/weight coverage (${sec2CurvePct}%)`);
  if (hasShadowHardness && hasFinishingCalibration) signalDensity += 1;
  else issues.push("Missing shadow hardness or optical finishing calibration in Sec 1");
  if (hasSecretSauce && hasAudioCues) signalDensity += 1;
  else issues.push("Missing Secret-Sauce or Soundscape bullet in Sec 1");

  const pillar1Total = Number(
    (structureComplete + zeroLeaks + boundariesAndParity + taxonomyAndOrder + signalDensity).toFixed(2),
  );

  let pillar2: ScoreReport["pillar2Max25"] = {
    available: false,
    score: null,
    matchedScenes: 0,
    totalScenes: 0,
    unmatchedScenes: [],
  };
  if (scenesPath) {
    const raw = JSON.parse(readFileSync(scenesPath, "utf8"));
    let cutFrames: number[] = [];
    if (Array.isArray(raw?.scenes)) {
      cutFrames = raw.scenes
        .slice(1)
        .map((s: { startFrame?: number; startSeconds?: number; start?: number }) =>
          typeof s.startFrame === "number"
            ? s.startFrame
            : Math.round(Number(s.startSeconds ?? s.start ?? 0) * fps),
        )
        .filter((f: number) => f > 3);
    } else if (Array.isArray(raw?.cuts)) {
      cutFrames = raw.cuts
        .map((c: { frame?: number; t?: number; time?: number }) =>
          typeof c.frame === "number" ? c.frame : Math.round(Number(c.t ?? c.time ?? 0) * fps),
        )
        .filter((f: number) => f > 3);
    }
    const unmatched: number[] = [];
    let matched = 0;
    for (const cf of cutFrames) {
      if (sec2Starts.some((sf) => Math.abs(sf - cf) <= 5)) matched++;
      else unmatched.push(cf);
    }
    const ratio = cutFrames.length ? matched / cutFrames.length : 1;
    pillar2 = {
      available: true,
      score: Number((ratio * 25).toFixed(2)),
      matchedScenes: matched,
      totalScenes: cutFrames.length,
      unmatchedScenes: unmatched,
    };
  }

  const maxFrame = Math.max(0, ...sec2Starts, ...sec3Starts);
  const estDuration = durationSec ?? (maxFrame > 0 ? maxFrame / fps : 30);
  const recallSlotsSec = [0.05, 0.35, 0.68, 0.94].map((p) => Number((estDuration * p).toFixed(2)));
  const pool = [...new Set([...sec2Starts, ...sec3Starts])].sort((a, b) => a - b);
  const claimSampleFrames: number[] = [];
  if (pool.length <= 8) {
    claimSampleFrames.push(...pool);
  } else {
    for (let i = 0; i < 8; i++) {
      const idx = Math.min(pool.length - 1, Math.round((i * (pool.length - 1)) / 7));
      claimSampleFrames.push(pool[idx]!);
    }
  }

  return {
    file: basename(filePath),
    chars: text.length,
    lines: lines.length,
    sections,
    sec2Rows: sec2Rows.length,
    sec3Rows: sec3Rows.length,
    sec1Counts,
    sec2Counts,
    pillar1Max25: {
      total: pillar1Total,
      structureComplete,
      zeroLeaks,
      boundariesAndParity,
      taxonomyAndOrder,
      signalDensity,
    },
    metrics: {
      sec2LensPct,
      sec2CurvePct,
      hasShadowHardness,
      hasFinishingCalibration,
      hasSecretSauce,
      hasAudioCues,
      leaks,
      fakeMmHits,
      badBoundaries,
      badCategories,
      sec2OrderViolations,
      sec3OrderViolations,
      countMismatches,
      audioCatchAll,
      missingOtherBoldLabel,
      transitionMissingSpan,
    },
    pillar2Max25: pillar2,
    gtSamplingPlan: {
      recallSlotsSec,
      claimSampleFrames,
    },
    issues,
  };
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: bun .claude/skills/analyze-ref-video/scripts/score-breakdown.ts <breakdown.md> [--scenes <scenes.json>] [--duration <sec>] [--fps <30>] [--json]",
  );
  process.exit(0);
}

const file = args[0]!;
const getFlag = (name: string): string | undefined => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};
const scenes = getFlag("--scenes");
const dur = getFlag("--duration") ? Number(getFlag("--duration")) : undefined;
const fps = getFlag("--fps") ? Number(getFlag("--fps")) : 30;
const report = scoreMarkdown(file, scenes, dur, fps);

if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `${report.file}: Pillar1=${report.pillar1Max25.total}/25` +
      (report.pillar2Max25.available ? ` | Pillar2=${report.pillar2Max25.score}/25` : "") +
      ` | Sec2=${report.sec2Rows} rows, Sec3=${report.sec3Rows} rows, ${report.chars} chars`,
  );
  if (report.issues.length) {
    for (const issue of report.issues) console.log(`  - ${issue}`);
  } else {
    console.log("  OK: 0 deterministic contract/hygiene issues");
  }
}
