import {
  ACTING_MODES,
  AUDIO_BED_STYLES,
  BEAT_ROLES,
  BGM_ENDING_BEHAVIORS,
  BGM_MOODS,
  BGM_TWIST_BEHAVIORS,
  type BoundaryCounts,
  CAMERA_ANGLES,
  CAMERA_ENERGIES,
  CAMERA_MOTION_PERSISTENCES,
  CAMERA_VELOCITY_PROFILES,
  CAPTION_STYLES,
  COLOR_PALETTE_MOODS,
  CRAFT_PILLAR_CATEGORIES,
  CRAFT_SIGNAL_KEYS,
  CRAFT_SIGNAL_KEYS_V2,
  CRAFT_SIGNAL_KEYS_V3,
  type CraftPillarCategory,
  EASING_ENERGIES,
  EMOTIONAL_DRIVERS,
  ENDING_TYPES,
  ENDING_VALENCES,
  FRAMING_ANCHORS,
  HOOK_ARCHETYPES,
  INFORMATION_REVEAL_MODES,
  LENS_FEELS,
  LIGHTING_STYLES,
  NARRATION_POVS,
  NARRATIVE_CONNECTORS,
  NARRATIVE_TIMELINES,
  OPEN_LOOP_ARCHITECTURES,
  OPEN_LOOP_PAYOFF_TIMINGS,
  OPENING_SCROLL_STOP_STATES,
  PROTAGONIST_FORMATS,
  SET_ARCHITECTURES,
  SFX_DENSITIES,
  SFX_LAYER_TYPES,
  SHADOW_QUALITIES,
  SHOT_SCALES,
  STAKES_ENGINES,
  STORY_STRUCTURES,
  THUMBNAIL_ARCHETYPES,
  THUMBNAIL_FOCAL_COMPLEXITIES,
  THUMBNAIL_GAZE_OR_CUES,
  THUMBNAIL_OPENING_PAYOFFS,
  THUMBNAIL_TEXT_RELATIONS,
  TIME_REMAP_TYPES,
  TITLE_HOOK_RELATIONS,
  TOPIC_CATEGORIES,
  type ValidationResult,
  type VideoTelemetry,
  VISUAL_LAYER_FORMATS,
  VISUAL_MEDIUMS,
  VO_VISUAL_RELATIONS,
  VOICE_DELIVERIES,
} from "./types.ts";

const setOf = <T extends string>(values: readonly T[]): Set<string> => new Set(values);

const TOPIC_SET = setOf(TOPIC_CATEGORIES);
const HOOK_SET = setOf(HOOK_ARCHETYPES);
const STORY_SET = setOf(STORY_STRUCTURES);
const CONNECTOR_SET = setOf(NARRATIVE_CONNECTORS);
const ENDING_SET = setOf(ENDING_TYPES);
const BEAT_SET = setOf(BEAT_ROLES);
const SCALE_SET = setOf(SHOT_SCALES);
const ANGLE_SET = setOf(CAMERA_ANGLES);
const CAM_ENERGY_SET = setOf(CAMERA_ENERGIES);
const LENS_SET = setOf(LENS_FEELS);
const LIGHT_SET = setOf(LIGHTING_STYLES);
const EASING_SET = setOf(EASING_ENERGIES);
const AUDIO_SET = setOf(AUDIO_BED_STYLES);
const MEDIUM_SET = setOf(VISUAL_MEDIUMS);
const PROTAGONIST_SET = setOf(PROTAGONIST_FORMATS);
const POV_SET = setOf(NARRATION_POVS);
const VOICE_SET = setOf(VOICE_DELIVERIES);
const CAPTION_SET = setOf(CAPTION_STYLES);
const EMOTION_SET = setOf(EMOTIONAL_DRIVERS);
const BGM_SET = setOf(BGM_MOODS);
const SFX_SET = setOf(SFX_DENSITIES);
const SHADOW_SET = setOf(SHADOW_QUALITIES);
const PALETTE_SET = setOf(COLOR_PALETTE_MOODS);
const ACTING_SET = setOf(ACTING_MODES);
const SET_ARCH_SET = setOf(SET_ARCHITECTURES);
const LAYER_FORMAT_SET = setOf(VISUAL_LAYER_FORMATS);
const STAKES_SET = setOf(STAKES_ENGINES);
const CAM_PERSIST_SET = setOf(CAMERA_MOTION_PERSISTENCES);
const CAM_VEL_SET = setOf(CAMERA_VELOCITY_PROFILES);
const FRAMING_ANCHOR_SET = setOf(FRAMING_ANCHORS);
const BGM_TWIST_SET = setOf(BGM_TWIST_BEHAVIORS);
const BGM_END_SET = setOf(BGM_ENDING_BEHAVIORS);
const ENDING_VALENCE_SET = setOf(ENDING_VALENCES);
const TITLE_HOOK_SET = setOf(TITLE_HOOK_RELATIONS);
const SCROLL_STOP_SET = setOf(OPENING_SCROLL_STOP_STATES);
const OPEN_LOOP_PAYOFF_SET = setOf(OPEN_LOOP_PAYOFF_TIMINGS);
const VO_VISUAL_SET = setOf(VO_VISUAL_RELATIONS);
const TIMELINE_SET = setOf(NARRATIVE_TIMELINES);
const OPEN_LOOP_ARCH_SET = setOf(OPEN_LOOP_ARCHITECTURES);
const INFO_REVEAL_SET = setOf(INFORMATION_REVEAL_MODES);
const THUMB_ARCH_SET = setOf(THUMBNAIL_ARCHETYPES);
const THUMB_TEXT_SET = setOf(THUMBNAIL_TEXT_RELATIONS);
const THUMB_PAYOFF_SET = setOf(THUMBNAIL_OPENING_PAYOFFS);
const THUMB_COMPLEXITY_SET = setOf(THUMBNAIL_FOCAL_COMPLEXITIES);
const THUMB_GAZE_SET = setOf(THUMBNAIL_GAZE_OR_CUES);
const SFX_LAYER_SET = setOf(SFX_LAYER_TYPES);
const TIME_REMAP_SET = setOf(TIME_REMAP_TYPES);
const PILLAR_BY_LOWER = new Map<string, CraftPillarCategory>(
  CRAFT_PILLAR_CATEGORIES.map((c) => [c.toLowerCase(), c]),
);

export function parseDominantCategoryCell(cell: string): CraftPillarCategory | null {
  const brackets = [...cell.matchAll(/\[([^\]]+)\]/g)];
  for (let i = brackets.length - 1; i >= 0; i--) {
    const raw = brackets[i]![1]!.replace(/[*`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const exact = PILLAR_BY_LOWER.get(raw);
    if (exact) return exact;
    if (raw.includes("camera") && raw.includes("framing")) return "Camera, Framing & Staging";
    if (raw.includes("motion") && raw.includes("acting")) return "Motion, Acting & Prop State";
    if (raw.includes("optics") || (raw.includes("blur") && raw.includes("dof")))
      return "Optics: Blur, DOF & Temporal";
    if (raw.includes("lighting") && raw.includes("color")) return "Lighting, Color & Materials";
    if (raw.includes("transitions") && raw.includes("continuity"))
      return "Transitions & Continuity";
    if (raw.includes("vfx") || raw.includes("cutaways")) return "VFX, Cutaways & Graphics";
    if (raw.includes("audio-visual") || raw.includes("soundscape"))
      return "Audio-Visual Sync & Soundscape";
    if (raw === "other") return "Other";
  }
  return null;
}

export interface ParsedSection3Shot {
  id: string;
  startSec: number | null;
  endSec: number | null;
  durationSec: number | null;
  startFrame: number | null;
  endFrame: number | null;
  boundaryKind: "opening" | "hard_cut" | "hidden_cut" | "transition" | "continuous" | "unknown";
  boundaryDetail: string;
  transitionType: string | null;
  transitionFrames: number | null;
  scale: string | null;
  angle: string | null;
  dominantCategory: CraftPillarCategory | null;
  confidence: "High" | "Med" | "Low" | null;
}

export function parseMarkdownTableRows(sectionText: string): string[][] {
  return sectionText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !/^\|[\s:|-]+\|$/.test(line))
    .slice(1)
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

export function classifyBoundaryCell(
  cell: string,
): "opening" | "hard_cut" | "hidden_cut" | "transition" | "continuous" | "unknown" {
  const clean = cell.replace(/[*`]/g, "").trim();
  if (/^Opening\b/i.test(clean)) return "opening";
  if (/^Hard Cut\b/i.test(clean)) return "hard_cut";
  if (/^Hidden Cut\b/i.test(clean)) return "hidden_cut";
  if (/^Transition\b/i.test(clean)) return "transition";
  if (/^Continuous\s*\[NO CUT\]/i.test(clean)) return "continuous";
  return "unknown";
}

export function parseScaleAngleCell(cell: string): { scale: string | null; angle: string | null } {
  const clean = cell.replace(/[*`]/g, "").trim();
  const parts = clean.split("/").map((p) => p.trim());
  const rawScale = parts[0]?.toUpperCase() ?? "";
  const rawAngle = parts[1]?.toLowerCase() ?? "";
  return {
    scale: SCALE_SET.has(rawScale) ? rawScale : null,
    angle: ANGLE_SET.has(rawAngle) ? rawAngle : null,
  };
}

export function parseTimestampToSec(raw: string): number | null {
  const parts = raw.trim().split(":");
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null;
  }
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    return Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)
      ? h * 3600 + m * 60 + s
      : null;
  }
  return null;
}

export function parseTimeSpanEndSec(cell: string): number | null {
  const matches = cell.match(/\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?/g);
  if (!matches || matches.length < 2) return null;
  return parseTimestampToSec(matches[1]!);
}

const STANDARD_FPS = [24, 25, 30, 50, 60] as const;

export function parseSection3Shots(markdown: string): {
  shots: ParsedSection3Shot[];
  inferredFps: number;
} {
  const sec3Split = markdown.split(/^###\s+3\./m)[1] ?? "";
  const sec3Block = sec3Split.split(/^###\s+4\./m)[0] ?? "";
  const rows = parseMarkdownTableRows(sec3Block);
  const shots: ParsedSection3Shot[] = [];
  let maxEndSec = 0;
  let maxEndFrame = 0;

  for (const row of rows) {
    const id = (row[0] ?? "").replace(/[*`]/g, "").trim();
    const timeCell = row[1] ?? "";
    const boundaryCell = (row[2] ?? "").replace(/[*`]/g, "").trim();
    const { scale, angle } = parseScaleAngleCell(row[3] ?? "");
    const dominantCategory = parseDominantCategoryCell(row[4] ?? "");
    const confRaw = (row[5] ?? "").replace(/[*`]/g, "").trim().toLowerCase();
    const confidence: "High" | "Med" | "Low" | null = /^high\b/.test(confRaw)
      ? "High"
      : /^med(?:ium)?\b/.test(confRaw)
        ? "Med"
        : /^low\b/.test(confRaw)
          ? "Low"
          : null;

    const tsMatches = timeCell.match(/\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?/g);
    const startSec = tsMatches && tsMatches.length >= 1 ? parseTimestampToSec(tsMatches[0]!) : null;
    const endSec = tsMatches && tsMatches.length >= 2 ? parseTimestampToSec(tsMatches[1]!) : null;
    const durationSec =
      startSec !== null && endSec !== null && endSec >= startSec
        ? Number((endSec - startSec).toFixed(3))
        : null;

    const frameMatch = timeCell.match(/\bf(\d+)\s*(?:–|-|→|->)\s*f(\d+)\b/i);
    const startFrame = frameMatch ? Number(frameMatch[1]) : null;
    const endFrame = frameMatch ? Number(frameMatch[2]) : null;
    if (endSec !== null && endSec > maxEndSec) maxEndSec = endSec;
    if (endFrame !== null && endFrame > maxEndFrame) maxEndFrame = endFrame;

    const boundaryKind = classifyBoundaryCell(boundaryCell);
    const openParen = boundaryCell.indexOf("(");
    const closeParen = boundaryCell.lastIndexOf(")");
    const boundaryDetail =
      openParen >= 0 && closeParen > openParen
        ? boundaryCell.slice(openParen + 1, closeParen).trim()
        : "";
    let transitionType: string | null = null;
    let transitionFrames: number | null = null;
    if (boundaryKind === "transition" && boundaryDetail) {
      const tHead = (boundaryDetail.split(",")[0] ?? "")
        .replace(/\s*\bf\d+\s*(?:–|-|→|->)\s*f\d+\b.*$/i, "")
        .trim();
      if (tHead) transitionType = tHead;
      const tFrames = boundaryDetail.match(/\bf(\d+)\s*(?:–|-|→|->)\s*f(\d+)\b/i);
      if (tFrames) {
        const span = Number(tFrames[2]) - Number(tFrames[1]);
        if (Number.isFinite(span) && span >= 0) transitionFrames = span;
      }
    }

    shots.push({
      id,
      startSec,
      endSec,
      durationSec,
      startFrame,
      endFrame,
      boundaryKind,
      boundaryDetail,
      transitionType,
      transitionFrames,
      scale,
      angle,
      dominantCategory,
      confidence,
    });
  }

  let inferredFps = 30;
  if (maxEndSec > 1 && maxEndFrame > 10) {
    const rawFps = maxEndFrame / maxEndSec;
    const closest = STANDARD_FPS.reduce((best, std) =>
      Math.abs(rawFps - std) < Math.abs(rawFps - best) ? std : best,
    );
    inferredFps =
      Math.abs(rawFps - closest) / closest <= 0.12 ? closest : Number(rawFps.toFixed(2));
  }
  return { shots, inferredFps };
}

export function extractJsonBlock(sec4Text: string): string | null {
  const match = sec4Text.match(/```json\s*\r?\n([\s\S]*?)\r?\n[ \t]*```/i);
  return match ? match[1].trim() : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isNonNegInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

export interface DossierValidationOptions {
  expectAudio?: boolean;
  expectThumbnail?: boolean;
  expectedFps?: number;
  expectedDurationSec?: number;
}

const DEGRADED_FPS_RE =
  /\b(?:only\s+1\s*fps|1\s*fps\s+(?:sampled|subsampl\w*|downsampl\w*|stills?|frames?)|(?:sampled|subsampled|downsampled|capped|delivered)\s+(?:at|to)\s+1\s*fps|only\s+\d+\s+still\s+jpeg\s+frames?|30(?:f|[-\s]?frame)\s+(?:gaps?|stride))\b/i;
const MISSING_AUDIO_DISCLOSURE_RE =
  /\b(?:no\s+(?:attached\s+)?audio\s+(?:stream|track)|audio\s+(?:stream|track)\s+(?:(?:is|was)\s+)?(?:unavailable|not\s+attached|missing|not\s+provided)|without\s+an?\s+attached\s+audio)\b/i;

export function parseAndValidateDossier(
  markdown: string,
  opts: DossierValidationOptions = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const inputFailure =
    /(?:^|[^A-Za-z0-9_])[*`_]*INPUT_INCOMPLETE[*`_]*\s*:[*`_\s]*(AUDIO_UNAVAILABLE|VIDEO_SAMPLING_TOO_SPARSE)[*`_]*(?=$|[^A-Za-z0-9_])/.exec(
      markdown,
    );
  if (inputFailure) {
    return {
      valid: false,
      errors: [`incomplete media input: ${inputFailure[1]}`],
      warnings,
      sectionsFound: 0,
      sec3TotalRows: 0,
      sec3BoundaryCounts: { hard_cut: 0, hidden_cut: 0, transition: 0, continuous: 0 },
      telemetry: null,
    };
  }

  if ((opts.expectedFps ?? 24) >= 10 && DEGRADED_FPS_RE.test(markdown)) {
    errors.push("incomplete media input: degraded 1fps/still-frame delivery disclosed in dossier");
  }
  if (opts.expectAudio === true && MISSING_AUDIO_DISCLOSURE_RE.test(markdown)) {
    errors.push(
      "incomplete media input: missing audio track disclosed despite source having audio",
    );
  }

  const hasSec1 = /^###\s+1\./m.test(markdown);
  const hasSec2 = /^###\s+2\./m.test(markdown);
  const hasSec3 = /^###\s+3\./m.test(markdown);
  const hasSec4 = /^###\s+4\./m.test(markdown);
  const sectionsFound = [hasSec1, hasSec2, hasSec3, hasSec4].filter(Boolean).length;
  if (sectionsFound < 4) {
    errors.push(`missing sections: found ${sectionsFound}/4 (need ### 1..4)`);
  }

  const engineLeaks = markdown.match(/\b(?:draw\(t\)|THREE\.\w+|bpy\.\w+|bun run\s+\w+)/g) ?? [];
  if (engineLeaks.length > 0) {
    errors.push(`engine/CLI leak detected: ${engineLeaks.slice(0, 3).join(", ")}`);
  }

  const sec3Split = markdown.split(/^###\s+3\./m)[1] ?? "";
  const sec3Block = sec3Split.split(/^###\s+4\./m)[0] ?? "";
  const sec4Block = markdown.split(/^###\s+4\./m)[1] ?? "";

  const sec3Rows = parseMarkdownTableRows(sec3Block);
  const sec3BoundaryCounts: BoundaryCounts = {
    hard_cut: 0,
    hidden_cut: 0,
    transition: 0,
    continuous: 0,
  };
  const sec3ScaleCounts: Record<string, number> = Object.fromEntries(
    SHOT_SCALES.map((s) => [s, 0]),
  );
  const sec3AngleCounts: Record<string, number> = Object.fromEntries(
    CAMERA_ANGLES.map((a) => [a, 0]),
  );
  let parsedScaleRows = 0;
  let parsedAngleRows = 0;
  let badScales = 0;
  let badAngles = 0;
  let openingCount = 0;
  let openingRowIdx = -1;
  let openingRowEndSec: number | null = null;
  let sec3MaxEndSec: number | null = null;
  let badBoundaries = 0;
  let wideSamplingBracketRows = 0;

  for (let i = 0; i < sec3Rows.length; i++) {
    const row = sec3Rows[i]!;
    const rowEndSec = parseTimeSpanEndSec(row[1] ?? "");
    if (rowEndSec !== null && (sec3MaxEndSec === null || rowEndSec > sec3MaxEndSec)) {
      sec3MaxEndSec = rowEndSec;
    }
    const boundaryCell = row[2] ?? "";
    const kind = classifyBoundaryCell(boundaryCell);
    if (kind === "opening") {
      openingCount++;
      if (openingRowIdx === -1) {
        openingRowIdx = i;
        openingRowEndSec = rowEndSec;
      }
    } else if (kind === "unknown") {
      badBoundaries++;
    } else {
      sec3BoundaryCounts[kind]++;
      if (kind !== "transition") {
        const hasWideBracket = [...boundaryCell.matchAll(/\bf(\d+)\s*(?:→|->)\s*f(\d+)\b/g)].some(
          (m) => Number(m[2]) - Number(m[1]) >= 15,
        );
        if (hasWideBracket) wideSamplingBracketRows++;
      }
    }
    const { scale, angle } = parseScaleAngleCell(row[3] ?? "");
    if (scale) {
      sec3ScaleCounts[scale] = (sec3ScaleCounts[scale] ?? 0) + 1;
      parsedScaleRows++;
    } else {
      badScales++;
    }
    if (angle) {
      sec3AngleCounts[angle] = (sec3AngleCounts[angle] ?? 0) + 1;
      parsedAngleRows++;
    } else {
      badAngles++;
    }
  }
  if ((opts.expectedFps ?? 24) >= 10 && wideSamplingBracketRows >= 2) {
    errors.push(
      `incomplete media input: ${wideSamplingBracketRows} Section 3 non-transition boundaries carry >=15f sampling brackets indicating degraded low-FPS delivery`,
    );
  }
  if (sec3Rows.length === 0) {
    errors.push("Section 3 shot table has 0 rows");
  }
  if (openingCount !== 1 && sec3Rows.length > 0) {
    errors.push(`Section 3 must have exactly 1 Opening row (found ${openingCount})`);
  } else if (openingRowIdx > 0) {
    errors.push(`Section 3 Opening row must be Row 1 (found at row ${openingRowIdx + 1})`);
  } else if (openingRowIdx === 0 && openingRowEndSec === null) {
    warnings.push("Section 3 Opening row missing parseable start-end timestamp");
  }
  if (badBoundaries > 0) {
    errors.push(`Section 3 has ${badBoundaries} invalid boundary enum(s)`);
  }
  if (badScales > 0) {
    errors.push(`Section 3 has ${badScales} invalid shot scale enum(s)`);
  }
  if (badAngles > 0) {
    errors.push(`Section 3 has ${badAngles} invalid camera angle enum(s)`);
  }

  const rawJson = extractJsonBlock(sec4Block);
  if (!rawJson) {
    errors.push("Section 4 missing closed ```json ... ``` block (possible truncation)");
    return {
      valid: false,
      errors,
      warnings,
      sectionsFound,
      sec3TotalRows: sec3Rows.length,
      sec3BoundaryCounts,
      telemetry: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    errors.push(`Section 4 JSON parse error: ${(err as Error).message}`);
    return {
      valid: false,
      errors,
      warnings,
      sectionsFound,
      sec3TotalRows: sec3Rows.length,
      sec3BoundaryCounts,
      telemetry: null,
    };
  }

  if (!isRecord(parsed)) {
    errors.push("Section 4 JSON root must be an object");
    return {
      valid: false,
      errors,
      warnings,
      sectionsFound,
      sec3TotalRows: sec3Rows.length,
      sec3BoundaryCounts,
      telemetry: null,
    };
  }

  const isV3 = parsed.schema_version === 3;
  const isV2Plus = parsed.schema_version === 2 || isV3;
  if (parsed.schema_version !== 1 && !isV2Plus) {
    errors.push("schema_version must be 1, 2, or 3");
  }
  if (!isFiniteNumber(parsed.duration_sec) || parsed.duration_sec <= 0) {
    errors.push("duration_sec must be a positive number");
  } else if (isFiniteNumber(opts.expectedDurationSec) && opts.expectedDurationSec > 0) {
    const durTol = Math.max(3, opts.expectedDurationSec * 0.12);
    if (Math.abs(parsed.duration_sec - opts.expectedDurationSec) > durTol) {
      errors.push(
        `duration_sec (${parsed.duration_sec}s) diverges from probed duration (${opts.expectedDurationSec}s)`,
      );
    }
    if (sec3MaxEndSec !== null && sec3MaxEndSec < opts.expectedDurationSec * 0.8) {
      errors.push(
        `Section 3 timeline ends at ${sec3MaxEndSec}s (<80% of probed ${opts.expectedDurationSec}s; possible truncation)`,
      );
    }
  }
  if (typeof parsed.topic_category !== "string" || !TOPIC_SET.has(parsed.topic_category))
    errors.push(`invalid topic_category: ${String(parsed.topic_category)}`);
  if (typeof parsed.topic_sublabel !== "string" || !parsed.topic_sublabel.trim())
    errors.push("topic_sublabel must be a non-empty string");
  if (typeof parsed.hook_archetype !== "string" || !HOOK_SET.has(parsed.hook_archetype))
    errors.push(`invalid hook_archetype: ${String(parsed.hook_archetype)}`);
  if (!isFiniteNumber(parsed.opening_shot_sec) || parsed.opening_shot_sec <= 0) {
    errors.push("opening_shot_sec must be a positive number");
  } else {
    if (isFiniteNumber(parsed.duration_sec) && parsed.opening_shot_sec > parsed.duration_sec + 1) {
      errors.push(
        `opening_shot_sec (${parsed.opening_shot_sec}) exceeds duration_sec (${parsed.duration_sec})`,
      );
    }
    if (openingRowEndSec !== null) {
      const diff = Math.abs(parsed.opening_shot_sec - openingRowEndSec);
      const msg = `opening_shot_sec (${parsed.opening_shot_sec}s) diverges from Section 3 Opening row end (${openingRowEndSec}s)`;
      if (diff >= 1.5) errors.push(msg);
      else if (diff >= 0.5) warnings.push(msg);
    }
  }
  if (parsed.opening_spoken_line !== null && typeof parsed.opening_spoken_line !== "string")
    errors.push("opening_spoken_line must be string or null");
  if (typeof parsed.hook_visual_trigger !== "string" || !parsed.hook_visual_trigger.trim())
    errors.push("hook_visual_trigger must be a non-empty string");
  if (typeof parsed.story_structure !== "string" || !STORY_SET.has(parsed.story_structure))
    errors.push(`invalid story_structure: ${String(parsed.story_structure)}`);
  if (
    typeof parsed.narrative_connector !== "string" ||
    !CONNECTOR_SET.has(parsed.narrative_connector)
  )
    errors.push(`invalid narrative_connector: ${String(parsed.narrative_connector)}`);
  if (typeof parsed.ending_type !== "string" || !ENDING_SET.has(parsed.ending_type))
    errors.push(`invalid ending_type: ${String(parsed.ending_type)}`);
  if (
    parsed.twist_at_pct !== null &&
    (!isFiniteNumber(parsed.twist_at_pct) || parsed.twist_at_pct < 0 || parsed.twist_at_pct > 100)
  )
    errors.push(`invalid twist_at_pct: ${JSON.stringify(parsed.twist_at_pct)}`);
  if (
    !Array.isArray(parsed.rehook_timestamps_sec) ||
    !parsed.rehook_timestamps_sec.every((n) => isFiniteNumber(n) && n >= 0)
  ) {
    errors.push("rehook_timestamps_sec must be an array of non-negative numbers");
  } else {
    if (isFiniteNumber(parsed.duration_sec)) {
      const over = parsed.rehook_timestamps_sec.filter(
        (n) => n > (parsed.duration_sec as number) + 1,
      );
      if (over.length > 0) {
        warnings.push(`rehook_timestamps_sec exceeds duration_sec: ${over.join(", ")}`);
      }
    }
    for (let i = 1; i < parsed.rehook_timestamps_sec.length; i++) {
      if (
        (parsed.rehook_timestamps_sec[i] as number) <=
        (parsed.rehook_timestamps_sec[i - 1] as number)
      ) {
        warnings.push("rehook_timestamps_sec should be strictly increasing without duplicates");
        break;
      }
    }
  }

  if (!Array.isArray(parsed.story_beats) || parsed.story_beats.length === 0) {
    errors.push("story_beats must be a non-empty array");
  } else {
    let pctSum = 0;
    let prevEnd: number | null = null;
    let hasBeatGapOrOverlap = false;
    const twistBeats: Array<{ start_sec: number }> = [];
    for (let i = 0; i < parsed.story_beats.length; i++) {
      const b = parsed.story_beats[i];
      if (!isRecord(b)) {
        errors.push(`story_beats[${i}] must be an object`);
        continue;
      }
      if (typeof b.role !== "string" || !BEAT_SET.has(b.role))
        errors.push(`story_beats[${i}].role invalid: ${String(b.role)}`);
      if (
        !isFiniteNumber(b.start_sec) ||
        !isFiniteNumber(b.end_sec) ||
        b.start_sec < 0 ||
        b.end_sec < b.start_sec
      ) {
        errors.push(`story_beats[${i}] invalid start/end times`);
      } else {
        if (prevEnd !== null && Math.abs(b.start_sec - prevEnd) > 1.0) {
          hasBeatGapOrOverlap = true;
        }
        prevEnd = b.end_sec;
        if (b.role === "twist") twistBeats.push({ start_sec: b.start_sec });
      }
      if (!isFiniteNumber(b.pct_runtime) || b.pct_runtime < 0 || b.pct_runtime > 100)
        errors.push(`story_beats[${i}].pct_runtime invalid`);
      else pctSum += b.pct_runtime;
    }
    if (pctSum < 90 || pctSum > 110) {
      errors.push(`story_beats pct_runtime sum (${pctSum}) outside 90..110`);
    }
    if (hasBeatGapOrOverlap) {
      warnings.push("story_beats has chronological gap or overlap exceeding 1.0s");
    }
    if (isFiniteNumber(parsed.twist_at_pct) && twistBeats.length === 0) {
      warnings.push(`twist_at_pct is ${parsed.twist_at_pct} without a twist beat in story_beats`);
    } else if (parsed.twist_at_pct === null && twistBeats.length > 0) {
      warnings.push("story_beats contains a twist beat while twist_at_pct is null");
    } else if (
      isFiniteNumber(parsed.twist_at_pct) &&
      twistBeats.length > 0 &&
      isFiniteNumber(parsed.duration_sec) &&
      parsed.duration_sec > 0
    ) {
      const closestBeatPct = twistBeats.reduce(
        (best, tb) => {
          const pct = Math.round((tb.start_sec / (parsed.duration_sec as number)) * 100);
          return Math.abs((parsed.twist_at_pct as number) - pct) <
            Math.abs((parsed.twist_at_pct as number) - best)
            ? pct
            : best;
        },
        Math.round((twistBeats[0]!.start_sec / parsed.duration_sec) * 100),
      );
      if (Math.abs(parsed.twist_at_pct - closestBeatPct) > 15) {
        warnings.push(
          `twist_at_pct (${parsed.twist_at_pct}%) diverges >15pp from nearest twist beat start (${closestBeatPct}%)`,
        );
      }
    }
  }

  if (!isRecord(parsed.boundary_counts)) {
    errors.push("boundary_counts must be an object");
  } else {
    const keys = ["hard_cut", "hidden_cut", "transition", "continuous"] as const;
    let boundarySum = 0;
    let allBoundaryInts = true;
    for (const k of keys) {
      if (!isNonNegInt(parsed.boundary_counts[k])) {
        errors.push(`boundary_counts.${k} must be a non-negative integer`);
        allBoundaryInts = false;
      } else {
        boundarySum += parsed.boundary_counts[k];
        if (parsed.boundary_counts[k] !== sec3BoundaryCounts[k]) {
          const diff = Math.abs(parsed.boundary_counts[k] - sec3BoundaryCounts[k]);
          const msg = `boundary_counts.${k} (${parsed.boundary_counts[k]}) != Section 3 (${sec3BoundaryCounts[k]})`;
          if (diff >= 2) errors.push(msg);
          else warnings.push(msg);
        }
      }
    }
    if (allBoundaryInts && sec3Rows.length > 0) {
      const expectedBoundaries = Math.max(0, sec3Rows.length - 1);
      if (Math.abs(boundarySum - expectedBoundaries) >= 2) {
        errors.push(
          `boundary_counts sum (${boundarySum}) diverges from Section 3 non-opening rows (${expectedBoundaries})`,
        );
      } else if (boundarySum !== expectedBoundaries) {
        warnings.push(
          `boundary_counts sum (${boundarySum}) differs by 1 from Section 3 non-opening rows (${expectedBoundaries})`,
        );
      }
    }
  }

  if (
    !Array.isArray(parsed.transition_types) ||
    !parsed.transition_types.every((s) => typeof s === "string")
  ) {
    errors.push("transition_types must be an array of strings");
  } else if (isRecord(parsed.boundary_counts)) {
    if (parsed.boundary_counts.transition === 0 && parsed.transition_types.length > 0) {
      warnings.push(
        `transition_types has ${parsed.transition_types.length} entry(ies) while boundary_counts.transition is 0`,
      );
    } else if (
      isNonNegInt(parsed.boundary_counts.transition) &&
      parsed.boundary_counts.transition > 0 &&
      parsed.transition_types.length === 0
    ) {
      warnings.push(
        `transition_types is empty while boundary_counts.transition is ${parsed.boundary_counts.transition}`,
      );
    }
  }

  if (!isRecord(parsed.shot_scale_counts)) {
    errors.push("shot_scale_counts must be an object");
  } else {
    let scaleSum = 0;
    for (const k of SHOT_SCALES) {
      const v = parsed.shot_scale_counts[k];
      if (!isNonNegInt(v)) {
        errors.push(`shot_scale_counts.${k} must be a non-negative integer`);
      } else {
        scaleSum += v;
        if (parsedScaleRows === sec3Rows.length && sec3Rows.length > 0) {
          const expected = sec3ScaleCounts[k] ?? 0;
          const diff = Math.abs(v - expected);
          if (diff >= 2) {
            errors.push(`shot_scale_counts.${k} (${v}) != Section 3 (${expected})`);
          } else if (diff === 1) {
            warnings.push(`shot_scale_counts.${k} (${v}) != Section 3 (${expected})`);
          }
        }
      }
    }
    if (scaleSum === 0) errors.push("shot_scale_counts sum must be > 0");
    else if (sec3Rows.length > 0 && Math.abs(scaleSum - sec3Rows.length) >= 2) {
      errors.push(
        `shot_scale_counts sum (${scaleSum}) diverges from Section 3 rows (${sec3Rows.length})`,
      );
    } else if (sec3Rows.length > 0 && scaleSum !== sec3Rows.length) {
      warnings.push(
        `shot_scale_counts sum (${scaleSum}) differs by 1 from Section 3 rows (${sec3Rows.length})`,
      );
    }
  }

  if (!isRecord(parsed.camera_angle_counts)) {
    errors.push("camera_angle_counts must be an object");
  } else {
    let angleSum = 0;
    for (const k of CAMERA_ANGLES) {
      const v = parsed.camera_angle_counts[k];
      if (!isNonNegInt(v)) {
        errors.push(`camera_angle_counts.${k} must be a non-negative integer`);
      } else {
        angleSum += v;
        if (parsedAngleRows === sec3Rows.length && sec3Rows.length > 0) {
          const expected = sec3AngleCounts[k] ?? 0;
          const diff = Math.abs(v - expected);
          if (diff >= 2) {
            errors.push(`camera_angle_counts.${k} (${v}) != Section 3 (${expected})`);
          } else if (diff === 1) {
            warnings.push(`camera_angle_counts.${k} (${v}) != Section 3 (${expected})`);
          }
        }
      }
    }
    if (angleSum === 0) errors.push("camera_angle_counts sum must be > 0");
    else if (sec3Rows.length > 0 && Math.abs(angleSum - sec3Rows.length) >= 2) {
      errors.push(
        `camera_angle_counts sum (${angleSum}) diverges from Section 3 rows (${sec3Rows.length})`,
      );
    } else if (sec3Rows.length > 0 && angleSum !== sec3Rows.length) {
      warnings.push(
        `camera_angle_counts sum (${angleSum}) differs by 1 from Section 3 rows (${sec3Rows.length})`,
      );
    }
  }

  if (typeof parsed.camera_energy !== "string" || !CAM_ENERGY_SET.has(parsed.camera_energy))
    errors.push(`invalid camera_energy: ${String(parsed.camera_energy)}`);
  if (typeof parsed.dominant_lens_feel !== "string" || !LENS_SET.has(parsed.dominant_lens_feel))
    errors.push(`invalid dominant_lens_feel: ${String(parsed.dominant_lens_feel)}`);
  if (typeof parsed.lighting_style !== "string" || !LIGHT_SET.has(parsed.lighting_style))
    errors.push(`invalid lighting_style: ${String(parsed.lighting_style)}`);
  if (typeof parsed.easing_energy !== "string" || !EASING_SET.has(parsed.easing_energy))
    errors.push(`invalid easing_energy: ${String(parsed.easing_energy)}`);
  if (typeof parsed.audio_bed_style !== "string" || !AUDIO_SET.has(parsed.audio_bed_style))
    errors.push(`invalid audio_bed_style: ${String(parsed.audio_bed_style)}`);

  if (!isRecord(parsed.craft_signals)) {
    errors.push("craft_signals must be an object");
  } else {
    for (const k of CRAFT_SIGNAL_KEYS) {
      if (typeof parsed.craft_signals[k] !== "boolean") {
        errors.push(`craft_signals.${k} must be boolean`);
      }
    }
    if (isV2Plus) {
      for (const k of CRAFT_SIGNAL_KEYS_V2) {
        if (typeof parsed.craft_signals[k] !== "boolean") {
          errors.push(`craft_signals.${k} must be boolean (schema_version >= 2)`);
        }
      }
      const anySubBlur =
        parsed.craft_signals.uses_camera_turn_blur === true ||
        parsed.craft_signals.uses_translation_or_radial_blur === true ||
        parsed.craft_signals.uses_object_motion_blur === true ||
        parsed.craft_signals.uses_subject_tracking_blur === true;
      if (parsed.craft_signals.uses_motion_blur === false && anySubBlur) {
        warnings.push("craft_signals granular blur flag is true while uses_motion_blur is false");
      } else if (parsed.craft_signals.uses_motion_blur === true && !anySubBlur) {
        warnings.push(
          "craft_signals.uses_motion_blur is true while all 4 granular blur flags are false",
        );
      }
    }
    if (isV3) {
      for (const k of CRAFT_SIGNAL_KEYS_V3) {
        if (typeof parsed.craft_signals[k] !== "boolean") {
          errors.push(`craft_signals.${k} must be boolean (schema_version 3)`);
        }
      }
    }
    if (
      typeof parsed.ending_type === "string" &&
      typeof parsed.craft_signals.has_seamless_loop === "boolean" &&
      (parsed.ending_type === "seamless_loop") !== parsed.craft_signals.has_seamless_loop
    ) {
      warnings.push(
        `ending_type (${parsed.ending_type}) disagrees with craft_signals.has_seamless_loop (${String(parsed.craft_signals.has_seamless_loop)})`,
      );
    }
  }

  if (isV2Plus) {
    const v2Enums: Array<[string, Set<string>, unknown]> = [
      ["visual_medium", MEDIUM_SET, parsed.visual_medium],
      ["protagonist_format", PROTAGONIST_SET, parsed.protagonist_format],
      ["narration_pov", POV_SET, parsed.narration_pov],
      ["voice_delivery", VOICE_SET, parsed.voice_delivery],
      ["caption_style", CAPTION_SET, parsed.caption_style],
      ["emotional_driver", EMOTION_SET, parsed.emotional_driver],
      ["bgm_mood", BGM_SET, parsed.bgm_mood],
      ["sfx_density", SFX_SET, parsed.sfx_density],
      ["shadow_quality", SHADOW_SET, parsed.shadow_quality],
      ["color_palette_mood", PALETTE_SET, parsed.color_palette_mood],
    ];
    for (const [field, allowed, val] of v2Enums) {
      if (typeof val !== "string" || !allowed.has(val)) {
        errors.push(`invalid ${field}: ${String(val)}`);
      }
    }
    if (parsed.audio_bed_style === "silent") {
      if (parsed.bgm_mood !== "none") {
        warnings.push(`audio_bed_style is silent while bgm_mood is ${String(parsed.bgm_mood)}`);
      }
      if (parsed.sfx_density !== "none") {
        warnings.push(
          `audio_bed_style is silent while sfx_density is ${String(parsed.sfx_density)}`,
        );
      }
      if (parsed.voice_delivery !== "unvoiced") {
        warnings.push(
          `audio_bed_style is silent while voice_delivery is ${String(parsed.voice_delivery)}`,
        );
      }
      if (parsed.narration_pov !== "unvoiced") {
        warnings.push(
          `audio_bed_style is silent while narration_pov is ${String(parsed.narration_pov)}`,
        );
      }
      if (parsed.opening_spoken_line !== null) {
        warnings.push("audio_bed_style is silent while opening_spoken_line is non-null");
      }
      if (
        isRecord(parsed.craft_signals) &&
        (parsed.craft_signals.has_sfx_whoosh_or_riser === true ||
          parsed.craft_signals.has_jl_cut === true ||
          parsed.craft_signals.has_pre_impact_silence === true)
      ) {
        warnings.push("audio_bed_style is silent while an audio craft signal is true");
      }
    } else if (
      parsed.audio_bed_style === "music_sfx_no_vo" ||
      parsed.audio_bed_style === "foley_ambient_no_vo"
    ) {
      if (parsed.voice_delivery !== "unvoiced") {
        warnings.push(
          `audio_bed_style is ${parsed.audio_bed_style} while voice_delivery is ${String(parsed.voice_delivery)}`,
        );
      }
      if (parsed.narration_pov !== "unvoiced") {
        warnings.push(
          `audio_bed_style is ${parsed.audio_bed_style} while narration_pov is ${String(parsed.narration_pov)}`,
        );
      }
      if (parsed.opening_spoken_line !== null) {
        warnings.push(
          `audio_bed_style is ${parsed.audio_bed_style} while opening_spoken_line is non-null`,
        );
      }
      if (parsed.audio_bed_style === "foley_ambient_no_vo" && parsed.bgm_mood !== "none") {
        warnings.push(
          `audio_bed_style is foley_ambient_no_vo while bgm_mood is ${String(parsed.bgm_mood)}`,
        );
      }
    } else if (
      typeof parsed.audio_bed_style === "string" &&
      AUDIO_SET.has(parsed.audio_bed_style)
    ) {
      if (parsed.voice_delivery === "unvoiced") {
        warnings.push(
          `audio_bed_style (${parsed.audio_bed_style}) expects voice while voice_delivery is unvoiced`,
        );
      }
      if (parsed.narration_pov === "unvoiced") {
        warnings.push(
          `audio_bed_style (${parsed.audio_bed_style}) expects voice while narration_pov is unvoiced`,
        );
      }
      if (parsed.audio_bed_style === "vo_only_dry" && parsed.bgm_mood !== "none") {
        warnings.push(
          `audio_bed_style is vo_only_dry while bgm_mood is ${String(parsed.bgm_mood)}`,
        );
      }
      if (
        (parsed.audio_bed_style === "continuous_bgm_plus_vo" ||
          parsed.audio_bed_style === "shifting_bgm_plus_vo") &&
        parsed.bgm_mood === "none"
      ) {
        warnings.push(
          `audio_bed_style (${parsed.audio_bed_style}) expects BGM while bgm_mood is none`,
        );
      }
    }
    if (!isFiniteNumber(parsed.outro_hold_sec) || parsed.outro_hold_sec < 0) {
      errors.push("outro_hold_sec must be a non-negative number");
    } else if (
      isFiniteNumber(parsed.duration_sec) &&
      parsed.outro_hold_sec > parsed.duration_sec + 0.5
    ) {
      errors.push(
        `outro_hold_sec (${parsed.outro_hold_sec}) exceeds duration_sec (${parsed.duration_sec})`,
      );
    }
    if (
      !Array.isArray(parsed.camera_moves_used) ||
      !parsed.camera_moves_used.every((s) => typeof s === "string" && s.trim().length > 0)
    ) {
      errors.push("camera_moves_used must be an array of non-empty strings");
    } else if (parsed.camera_moves_used.length === 0 && parsed.camera_energy !== "locked_static") {
      warnings.push("camera_moves_used is empty while camera_energy is not locked_static");
    }
    if (
      parsed.lighting_style === "flat_2d_unlit" &&
      typeof parsed.shadow_quality === "string" &&
      SHADOW_SET.has(parsed.shadow_quality) &&
      parsed.shadow_quality !== "flat_unlit"
    ) {
      warnings.push(
        `lighting_style is flat_2d_unlit while shadow_quality is ${parsed.shadow_quality}`,
      );
    }
  }

  if (isV3) {
    const v3Enums: Array<[string, Set<string>, unknown]> = [
      ["acting_mode", ACTING_SET, parsed.acting_mode],
      ["set_architecture", SET_ARCH_SET, parsed.set_architecture],
      ["visual_layer_format", LAYER_FORMAT_SET, parsed.visual_layer_format],
      ["stakes_engine", STAKES_SET, parsed.stakes_engine],
      ["camera_motion_persistence", CAM_PERSIST_SET, parsed.camera_motion_persistence],
      ["camera_velocity_profile", CAM_VEL_SET, parsed.camera_velocity_profile],
      ["framing_anchor", FRAMING_ANCHOR_SET, parsed.framing_anchor],
      ["bgm_twist_behavior", BGM_TWIST_SET, parsed.bgm_twist_behavior],
      ["bgm_ending_behavior", BGM_END_SET, parsed.bgm_ending_behavior],
      ["ending_valence", ENDING_VALENCE_SET, parsed.ending_valence],
      ["title_hook_relation", TITLE_HOOK_SET, parsed.title_hook_relation],
      ["opening_scroll_stop_state", SCROLL_STOP_SET, parsed.opening_scroll_stop_state],
      ["open_loop_payoff_timing", OPEN_LOOP_PAYOFF_SET, parsed.open_loop_payoff_timing],
      ["vo_visual_relation", VO_VISUAL_SET, parsed.vo_visual_relation],
      ["narrative_timeline", TIMELINE_SET, parsed.narrative_timeline],
      ["open_loop_architecture", OPEN_LOOP_ARCH_SET, parsed.open_loop_architecture],
      ["information_reveal_mode", INFO_REVEAL_SET, parsed.information_reveal_mode],
      ["thumbnail_archetype", THUMB_ARCH_SET, parsed.thumbnail_archetype],
      ["thumbnail_text_relation", THUMB_TEXT_SET, parsed.thumbnail_text_relation],
      ["thumbnail_opening_payoff", THUMB_PAYOFF_SET, parsed.thumbnail_opening_payoff],
      ["thumbnail_focal_complexity", THUMB_COMPLEXITY_SET, parsed.thumbnail_focal_complexity],
      ["thumbnail_gaze_or_cue", THUMB_GAZE_SET, parsed.thumbnail_gaze_or_cue],
    ];
    for (const [field, allowed, val] of v3Enums) {
      if (typeof val !== "string" || !allowed.has(val)) {
        errors.push(`invalid ${field}: ${String(val)}`);
      }
    }
    if (
      !Array.isArray(parsed.sfx_layers_used) ||
      parsed.sfx_layers_used.length === 0 ||
      !parsed.sfx_layers_used.every((s) => typeof s === "string" && SFX_LAYER_SET.has(s))
    ) {
      errors.push("sfx_layers_used must be a non-empty array of valid SFX layer enums");
    } else {
      const hasNoneSfx = parsed.sfx_layers_used.includes("none");
      const hasActiveSfx = parsed.sfx_layers_used.some((s) => s !== "none");
      if (hasNoneSfx && hasActiveSfx) {
        warnings.push("sfx_layers_used mixes none with active SFX layers");
      }
      if (parsed.sfx_density === "none" && hasActiveSfx) {
        warnings.push("sfx_density is none while sfx_layers_used includes active SFX");
      } else if (
        typeof parsed.sfx_density === "string" &&
        SFX_SET.has(parsed.sfx_density) &&
        parsed.sfx_density !== "none" &&
        parsed.audio_bed_style !== "silent" &&
        !hasActiveSfx
      ) {
        warnings.push(`sfx_density is ${parsed.sfx_density} while sfx_layers_used is only none`);
      }
    }
    if (
      !Array.isArray(parsed.time_remap_types) ||
      parsed.time_remap_types.length === 0 ||
      !parsed.time_remap_types.every((s) => typeof s === "string" && TIME_REMAP_SET.has(s))
    ) {
      errors.push("time_remap_types must be a non-empty array of valid time remap enums");
    } else {
      const hasNoneRemap = parsed.time_remap_types.includes("none");
      const hasNonNoneRemap = parsed.time_remap_types.some((t) => t !== "none");
      if (hasNoneRemap && hasNonNoneRemap) {
        warnings.push("time_remap_types mixes none with active remap types");
      }
      if (isRecord(parsed.craft_signals)) {
        if (parsed.craft_signals.has_time_remap_or_hit_stop === false && hasNonNoneRemap) {
          warnings.push(
            "time_remap_types has active remap while has_time_remap_or_hit_stop is false",
          );
        } else if (parsed.craft_signals.has_time_remap_or_hit_stop === true && !hasNonNoneRemap) {
          warnings.push("has_time_remap_or_hit_stop is true while time_remap_types is only none");
        }
      }
    }
    if (parsed.bgm_mood === "none") {
      if (
        typeof parsed.bgm_twist_behavior === "string" &&
        BGM_TWIST_SET.has(parsed.bgm_twist_behavior) &&
        parsed.bgm_twist_behavior !== "no_bgm"
      ) {
        warnings.push(
          `bgm_mood is none while bgm_twist_behavior is ${String(parsed.bgm_twist_behavior)}`,
        );
      }
      if (
        typeof parsed.bgm_ending_behavior === "string" &&
        BGM_END_SET.has(parsed.bgm_ending_behavior) &&
        parsed.bgm_ending_behavior !== "no_bgm"
      ) {
        warnings.push(
          `bgm_mood is none while bgm_ending_behavior is ${String(parsed.bgm_ending_behavior)}`,
        );
      }
    } else if (
      typeof parsed.bgm_mood === "string" &&
      BGM_SET.has(parsed.bgm_mood) &&
      parsed.audio_bed_style !== "silent"
    ) {
      if (parsed.bgm_twist_behavior === "no_bgm") {
        warnings.push(`bgm_mood is ${parsed.bgm_mood} while bgm_twist_behavior is no_bgm`);
      }
      if (parsed.bgm_ending_behavior === "no_bgm") {
        warnings.push(`bgm_mood is ${parsed.bgm_mood} while bgm_ending_behavior is no_bgm`);
      }
    }
    if (
      parsed.audio_bed_style === "silent" &&
      Array.isArray(parsed.sfx_layers_used) &&
      parsed.sfx_layers_used.some((s) => s !== "none")
    ) {
      warnings.push("audio_bed_style is silent while sfx_layers_used includes active SFX");
    }
    if (
      parsed.narration_pov === "unvoiced" &&
      typeof parsed.vo_visual_relation === "string" &&
      VO_VISUAL_SET.has(parsed.vo_visual_relation) &&
      parsed.vo_visual_relation !== "unvoiced_visual_led"
    ) {
      warnings.push(
        `narration_pov is unvoiced while vo_visual_relation is ${parsed.vo_visual_relation}`,
      );
    } else if (
      typeof parsed.narration_pov === "string" &&
      POV_SET.has(parsed.narration_pov) &&
      parsed.narration_pov !== "unvoiced" &&
      parsed.vo_visual_relation === "unvoiced_visual_led"
    ) {
      warnings.push(
        `narration_pov is ${parsed.narration_pov} while vo_visual_relation is unvoiced_visual_led`,
      );
    }
    if (
      parsed.acting_mode === "no_character_acting" &&
      isRecord(parsed.craft_signals) &&
      parsed.craft_signals.has_expressive_facial_or_gesture_acting === true
    ) {
      warnings.push(
        "acting_mode is no_character_acting while has_expressive_facial_or_gesture_acting is true",
      );
    }
    if (
      (parsed.protagonist_format === "faceless_objects_diagrams" ||
        parsed.protagonist_format === "none") &&
      (parsed.acting_mode === "talking_head_presenter" || parsed.acting_mode === "subtle_realistic")
    ) {
      warnings.push(
        `protagonist_format is ${parsed.protagonist_format} while acting_mode is ${parsed.acting_mode}`,
      );
    }
    const thumbAbsent =
      parsed.thumbnail_archetype === "not_applicable_shorts_feed" ||
      parsed.thumbnail_archetype === "no_thumbnail_provided";
    const thumbPresent =
      typeof parsed.thumbnail_archetype === "string" &&
      THUMB_ARCH_SET.has(parsed.thumbnail_archetype) &&
      !thumbAbsent;
    if (opts.expectThumbnail === true && thumbAbsent) {
      errors.push(
        `thumbnail image was attached but thumbnail_archetype is ${String(parsed.thumbnail_archetype)}`,
      );
    } else if (opts.expectThumbnail === false && thumbPresent) {
      errors.push(
        `no thumbnail image was attached but thumbnail_archetype is ${String(parsed.thumbnail_archetype)}`,
      );
    }
    if (thumbAbsent) {
      for (const [k, v, validSet] of [
        ["thumbnail_text_relation", parsed.thumbnail_text_relation, THUMB_TEXT_SET],
        ["thumbnail_opening_payoff", parsed.thumbnail_opening_payoff, THUMB_PAYOFF_SET],
        ["thumbnail_focal_complexity", parsed.thumbnail_focal_complexity, THUMB_COMPLEXITY_SET],
        ["thumbnail_gaze_or_cue", parsed.thumbnail_gaze_or_cue, THUMB_GAZE_SET],
      ] as const) {
        if (typeof v === "string" && validSet.has(v) && v !== "not_applicable") {
          warnings.push(
            `thumbnail_archetype is ${String(parsed.thumbnail_archetype)} while ${k} is ${v}`,
          );
        }
      }
    } else if (thumbPresent) {
      for (const [k, v] of [
        ["thumbnail_text_relation", parsed.thumbnail_text_relation],
        ["thumbnail_opening_payoff", parsed.thumbnail_opening_payoff],
        ["thumbnail_focal_complexity", parsed.thumbnail_focal_complexity],
        ["thumbnail_gaze_or_cue", parsed.thumbnail_gaze_or_cue],
      ] as const) {
        if (v === "not_applicable") {
          warnings.push(
            `thumbnail_archetype is ${String(parsed.thumbnail_archetype)} while ${k} is not_applicable`,
          );
        }
      }
    }
  }

  if (
    typeof parsed.reusable_script_template !== "string" ||
    !parsed.reusable_script_template.trim()
  )
    errors.push("reusable_script_template must be a non-empty string");
  if (
    !Array.isArray(parsed.secret_sauce_cues) ||
    !parsed.secret_sauce_cues.every((s) => typeof s === "string")
  )
    errors.push("secret_sauce_cues must be an array of strings");
  if (
    !Array.isArray(parsed.weaknesses_or_drag) ||
    !parsed.weaknesses_or_drag.every((s) => typeof s === "string")
  )
    errors.push("weaknesses_or_drag must be an array of strings");

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sectionsFound,
    sec3TotalRows: sec3Rows.length,
    sec3BoundaryCounts,
    telemetry: errors.length === 0 ? (parsed as unknown as VideoTelemetry) : null,
  };
}
