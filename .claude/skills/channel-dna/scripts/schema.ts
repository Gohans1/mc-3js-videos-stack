import {
  AUDIO_BED_STYLES,
  BEAT_ROLES,
  type BoundaryCounts,
  CAMERA_ANGLES,
  CAMERA_ENERGIES,
  CRAFT_SIGNAL_KEYS,
  EASING_ENERGIES,
  ENDING_TYPES,
  HOOK_ARCHETYPES,
  LENS_FEELS,
  LIGHTING_STYLES,
  NARRATIVE_CONNECTORS,
  SHOT_SCALES,
  STORY_STRUCTURES,
  TOPIC_CATEGORIES,
  type ValidationResult,
  type VideoTelemetry,
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

export function extractJsonBlock(sec4Text: string): string | null {
  const match = sec4Text.match(/```json\s*\r?\n([\s\S]*?)\r?\n```/i);
  return match ? match[1].trim() : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isNonNegInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

export function parseAndValidateDossier(markdown: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasSec1 = /^###\s+1\./m.test(markdown);
  const hasSec2 = /^###\s+2\./m.test(markdown);
  const hasSec3 = /^###\s+3\./m.test(markdown);
  const hasSec4 = /^###\s+4\./m.test(markdown);
  const sectionsFound = [hasSec1, hasSec2, hasSec3, hasSec4].filter(Boolean).length;
  if (sectionsFound < 4) {
    errors.push(`missing sections: found ${sectionsFound}/4 (need ### 1..4)`);
  }

  const engineLeaks = markdown.match(/\b(?:draw\(t\)|THREE\.\w+|bun run\s+\w+)/g) ?? [];
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
  let badBoundaries = 0;

  for (let i = 0; i < sec3Rows.length; i++) {
    const row = sec3Rows[i]!;
    const kind = classifyBoundaryCell(row[2] ?? "");
    if (kind === "opening") {
      openingCount++;
      if (openingRowIdx === -1) {
        openingRowIdx = i;
        openingRowEndSec = parseTimeSpanEndSec(row[1] ?? "");
      }
    } else if (kind === "unknown") {
      badBoundaries++;
    } else {
      sec3BoundaryCounts[kind]++;
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

  if (parsed.schema_version !== 1) errors.push("schema_version must be 1");
  if (!isFiniteNumber(parsed.duration_sec) || parsed.duration_sec <= 0)
    errors.push("duration_sec must be a positive number");
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
  } else if (isFiniteNumber(parsed.duration_sec)) {
    const over = parsed.rehook_timestamps_sec.filter(
      (n) => n > (parsed.duration_sec as number) + 1,
    );
    if (over.length > 0) {
      warnings.push(`rehook_timestamps_sec exceeds duration_sec: ${over.join(", ")}`);
    }
  }

  if (!Array.isArray(parsed.story_beats) || parsed.story_beats.length === 0) {
    errors.push("story_beats must be a non-empty array");
  } else {
    let pctSum = 0;
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
      )
        errors.push(`story_beats[${i}] invalid start/end times`);
      if (!isFiniteNumber(b.pct_runtime) || b.pct_runtime < 0 || b.pct_runtime > 100)
        errors.push(`story_beats[${i}].pct_runtime invalid`);
      else pctSum += b.pct_runtime;
    }
    if (pctSum < 90 || pctSum > 110) {
      errors.push(`story_beats pct_runtime sum (${pctSum}) outside 90..110`);
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
