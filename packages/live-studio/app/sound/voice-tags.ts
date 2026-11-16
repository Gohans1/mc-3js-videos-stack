import { AUDIO_TAG_RE, stripDialogueSpeakerBrackets } from "../../src/voice-playground-text.mjs";
// Complete ElevenLabs v4 / v3 Audio Tags catalog, inline parser, cursor inserter, and credit estimator.
import type { PlaygroundModelInfo } from "../../src/voice-playground.mjs";

export { AUDIO_TAG_RE, stripDialogueSpeakerBrackets };

export interface AudioTagEntry {
  tag: string;
  label: string;
  hint: string;
}

export interface AudioTagCategory {
  id: "emotion" | "delivery" | "pacing" | "reaction" | "character" | "sfx";
  title: string;
  tags: readonly AudioTagEntry[];
}

export const AUDIO_TAG_CATEGORIES: readonly AudioTagCategory[] = [
  {
    id: "emotion",
    title: "Emotions",
    tags: [
      { tag: "excited", label: "Excited", hint: "High energy, upbeat and bright" },
      { tag: "playful", label: "Playful", hint: "Light, teasing, warm cadence" },
      { tag: "amazed", label: "Amazed", hint: "Wide-eyed wonder and awe" },
      { tag: "powerful", label: "Powerful", hint: "Commanding, projected chest voice" },
      { tag: "proud", label: "Proud", hint: "Assured and triumphant tone" },
      { tag: "optimistic", label: "Optimistic", hint: "Hopeful, lifting inflection" },
      { tag: "startled", label: "Startled", hint: "Sudden caught-off-guard beat" },
      { tag: "mad", label: "Mad", hint: "Sharp, heated frustration" },
      { tag: "aggressive", label: "Aggressive", hint: "Hard punchy stress" },
      { tag: "bitter", label: "Bitter", hint: "Cold, resentful edge" },
      { tag: "critical", label: "Critical", hint: "Clipped, disapproving judgment" },
      { tag: "anxious", label: "Anxious", hint: "Tight, uncertain breathing" },
      { tag: "stressed", label: "Stressed", hint: "Pressed for time, tense" },
      { tag: "scared", label: "Scared", hint: "Trembling, alert fear" },
      { tag: "nervous", label: "Nervous", hint: "Hesitant, slightly shaky" },
      { tag: "confused", label: "Confused", hint: "Questioning, unsettled pitch" },
      { tag: "tired", label: "Tired", hint: "Low energy, heavy exhale" },
      { tag: "bored", label: "Bored", hint: "Flat, unimpressed drag" },
      { tag: "distant", label: "Distant", hint: "Faraway, detached focus" },
      { tag: "despair", label: "Despair", hint: "Deeply defeated gravity" },
      { tag: "let down", label: "Let down", hint: "Quiet disappointment" },
      { tag: "peaceful", label: "Peaceful", hint: "Calm, unhurried warmth" },
      { tag: "curious", label: "Curious", hint: "Intrigued rising pitch" },
      { tag: "thoughtful", label: "Thoughtful", hint: "Measured reflective delivery" },
      { tag: "sarcastic", label: "Sarcastic", hint: "Dry, ironic emphasis" },
      { tag: "triumphant", label: "Triumphant", hint: "Victorious release" },
      { tag: "mischievous", label: "Mischievous", hint: "Sly, knowing smirk" },
      { tag: "hopeful", label: "Hopeful", hint: "Gentle lift toward resolution" },
    ],
  },
  {
    id: "delivery",
    title: "Delivery & Volume",
    tags: [
      { tag: "whispers", label: "Whispers", hint: "Soft breathy secret close to mic" },
      { tag: "hushed", label: "Hushed", hint: "Low, intense quiet room tone" },
      { tag: "softly", label: "Softly", hint: "Gentle low-volume intimacy" },
      { tag: "quietly", label: "Quietly", hint: "Restrained low projection" },
      { tag: "barely audible", label: "Barely audible", hint: "Near-silence edge" },
      { tag: "shouts", label: "Shouts", hint: "Full-force projected callout" },
      { tag: "booming", label: "Booming", hint: "Giant stadium/announcer projection" },
      { tag: "low, threatening", label: "Low, threatening", hint: "Dropped pitch, warning weight" },
      { tag: "flatly", label: "Flatly", hint: "Minimal pitch variation" },
      { tag: "deadpan", label: "Deadpan", hint: "Dry unbothered comic timing" },
      { tag: "dramatically", label: "Dramatically", hint: "Theatrical heightened stress" },
      { tag: "hushed and reverent", label: "Reverent", hint: "Documentary awe and respect" },
    ],
  },
  {
    id: "pacing",
    title: "Pacing & Beats",
    tags: [
      { tag: "slowly", label: "Slowly", hint: "Deliberate stretched phrasing" },
      { tag: "rushed", label: "Rushed", hint: "Hurried, breathless run-on" },
      { tag: "speedy", label: "Speedy", hint: "Crisp fast tempo" },
      { tag: "snappy", label: "Snappy", hint: "Sharp concise rhythm" },
      { tag: "pause", label: "Pause", hint: "Natural beat before next clause" },
      { tag: "short pause", label: "Short pause", hint: "Brief dramatic hesitation" },
      { tag: "long pause", label: "Long pause", hint: "Extended silent tension" },
      { tag: "drawn out", label: "Drawn out", hint: "Elongated vowel emphasis" },
      { tag: "stammers", label: "Stammers", hint: "Broken faltering start" },
    ],
  },
  {
    id: "reaction",
    title: "Human Reactions",
    tags: [
      { tag: "laughs", label: "Laughs", hint: "Natural spoken laugh" },
      { tag: "chuckles", label: "Chuckles", hint: "Warm understated laugh" },
      { tag: "giggles", label: "Giggles", hint: "Quick light laugh" },
      { tag: "sighs", label: "Sighs", hint: "Audible release or weariness" },
      { tag: "gasps", label: "Gasps", hint: "Sharp intake of breath" },
      { tag: "clears throat", label: "Clears throat", hint: "Pre-line vocal reset" },
      { tag: "crying", label: "Crying", hint: "Teary catching breath" },
      { tag: "sobs", label: "Sobs", hint: "Heavy emotional break" },
      { tag: "gulps", label: "Gulps", hint: "Audible nervous swallow" },
      { tag: "yawns", label: "Yawns", hint: "Sleepy mid-phrase stretch" },
      { tag: "coughs", label: "Coughs", hint: "Brief throat cough" },
      { tag: "groans", label: "Groans", hint: "Exasperated low groan" },
    ],
  },
  {
    id: "character",
    title: "Accents & Persona",
    tags: [
      { tag: "British accent", label: "British", hint: "Shift phrasing to UK English cadence" },
      { tag: "American accent", label: "American", hint: "General US inflection" },
      { tag: "Australian accent", label: "Australian", hint: "Relaxed Aussie vowels" },
      { tag: "Irish accent", label: "Irish", hint: "Lilt and Irish cadence" },
      { tag: "French accent", label: "French", hint: "French-inflected delivery" },
      { tag: "pirate voice", label: "Pirate", hint: "Gruff theatrical character read" },
      { tag: "storyteller", label: "Storyteller", hint: "Fireside narrative pull" },
      { tag: "tired detective", label: "Detective", hint: "Gravelly world-weary noir" },
      {
        tag: "like a sports commentator, speeding up",
        label: "Commentator",
        hint: "Ascending live-play excitement",
      },
    ],
  },
  {
    id: "sfx",
    title: "Scene SFX",
    tags: [
      { tag: "thunder rumbling", label: "Thunder", hint: "Distant low roll behind line" },
      { tag: "footsteps", label: "Footsteps", hint: "Approaching step cues" },
      { tag: "door creaking", label: "Door creak", hint: "Slow hinge tension" },
      { tag: "clapping", label: "Clapping", hint: "Applause cue" },
      { tag: "applause", label: "Applause", hint: "Room reaction cue" },
      { tag: "leaves rustling", label: "Leaves", hint: "Soft outdoor wind cue" },
      { tag: "owl hooting", label: "Owl hooting", hint: "Night woods ambience" },
      { tag: "dog barking", label: "Dog barking", hint: "Sudden bark interruption" },
    ],
  },
];

export interface PromptSegment {
  kind: "text" | "tag";
  value: string;
}

const isSpeakerCueAt = (text: string, start: number, matchLen: number): boolean => {
  if (text[start + matchLen] !== ":") return false;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  return /^[ \t]*$/.test(text.slice(lineStart, start));
};

export const parsePromptSegments = (text: string): PromptSegment[] => {
  if (!text) return [];
  const out: PromptSegment[] = [];
  let lastIndex = 0;
  for (const m of text.matchAll(AUDIO_TAG_RE)) {
    const start = m.index ?? 0;
    if (isSpeakerCueAt(text, start, m[0].length)) continue;
    if (start > lastIndex) {
      out.push({ kind: "text", value: text.slice(lastIndex, start) });
    }
    const clean = (m[1] ?? "").trim().replace(/\s+/g, " ");
    if (clean) out.push({ kind: "tag", value: clean });
    lastIndex = start + m[0].length;
  }
  if (lastIndex < text.length) {
    out.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return out;
};

export const insertAudioTagAtSelection = (
  text: string,
  selStart: number,
  selEnd: number,
  rawTag: string,
): { text: string; cursor: number } => {
  const clean = rawTag
    .trim()
    .replace(/^\[+|\]+$/g, "")
    .trim();
  if (!clean) return { text, cursor: selEnd };
  const token = `[${clean}]`;
  const start = Math.max(0, Math.min(text.length, selStart));
  const end = Math.max(start, Math.min(text.length, selEnd));
  const before = text.slice(0, start);
  const after = text.slice(end);
  const needLeadSpace = before.length > 0 && !/[\s(\n]$/.test(before);
  const needTrailSpace = after.length === 0 ? before.length === 0 : !/^[\s.,!?;:\])]/.test(after);
  const inserted = `${needLeadSpace ? " " : ""}${token}${needTrailSpace ? " " : ""}`;
  return {
    text: `${before}${inserted}${after}`,
    cursor: before.length + inserted.length,
  };
};

export const modelSupportsAudioTags = (modelId: string): boolean => {
  const id = (modelId || "").toLowerCase();
  return id.startsWith("eleven_v4") || id.startsWith("eleven_v3");
};

export const estimateGenerationCredits = (
  charCount: number,
  model?: Pick<PlaygroundModelInfo, "model_rates"> | null,
  opts?: { exportTranscript?: boolean; variations?: number },
): number => {
  const baseChars = Math.max(0, Math.trunc(charCount));
  if (!baseChars) return 0;
  const rate = model?.model_rates?.character_cost_multiplier ?? 1;
  const srtMul = opts?.exportTranscript ? 1.15 : 1;
  const variations = Math.max(1, Math.trunc(opts?.variations ?? 1));
  const perTake = Math.ceil(Number((baseChars * rate * srtMul).toFixed(6)));
  return perTake * variations;
};
