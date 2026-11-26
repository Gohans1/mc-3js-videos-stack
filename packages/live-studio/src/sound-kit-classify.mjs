export const KIT_CATEGORIES = [
  {
    id: "bgm",
    title: "BGM",
    hint: "Music beds (tense pulse, playful, lofi, cinematic, warm)",
    suggestedTags: ["tense", "playful", "lofi", "cinematic", "upbeat", "warm", "loopable"],
  },
  {
    id: "whoosh",
    title: "Whoosh",
    hint: "Transitions, whip-pans, camera pass-bys, swipes",
    suggestedTags: ["short", "medium", "long", "whip", "airy", "spin", "soft"],
  },
  {
    id: "pop-ui",
    title: "Pop & UI",
    hint: "Pops, clicks, chimes, sparkles, shutters, typing, alerts",
    suggestedTags: ["pop", "click", "chime", "sparkle", "shutter", "typing", "notification"],
  },
  {
    id: "impact",
    title: "Impact",
    hint: "Thuds, sub booms, hits, slams, drops, crashes",
    suggestedTags: ["thud", "boom", "hit", "slam", "sub", "crash", "soft-hit"],
  },
  {
    id: "riser",
    title: "Riser",
    hint: "Risers, reverse swells, tension builds, drones, downlifters",
    suggestedTags: ["riser", "swell", "reverse", "tension", "drone", "downlifter"],
  },
  {
    id: "ambience",
    title: "Ambience",
    hint: "Background beds: room tone, wind, rain, water, fire, city, forest",
    suggestedTags: ["room-tone", "wind", "rain", "water", "fire", "city", "forest", "crowd"],
  },
  {
    id: "foley-core",
    title: "Foley Core",
    hint: "Everyday physical hits: footsteps, bite, pour, paper, door, cloth, glass, metal",
    suggestedTags: ["footsteps", "bite", "pour", "paper", "door", "cloth", "glass", "metal"],
  },
  {
    id: "comedy-glitch",
    title: "Comedy & Glitch",
    hint: "Cartoon accents (boing, squeak, bonk, scratch) and digital glitches/zaps",
    suggestedTags: ["boing", "squeak", "bonk", "scratch", "glitch", "zap", "stutter", "fail"],
  },
];

export const KIT_CATEGORY_IDS = KIT_CATEGORIES.map((c) => c.id);
export const KIT_STATUSES = ["inbox", "core", "pass", "ban"];
export const TASTE_REASONS = [
  "clean",
  "punchy",
  "signature",
  "fits-vibe",
  "too-cheesy",
  "harsh",
  "wrong-material",
  "too-long",
  "repetitive",
  "noisy",
];

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const SOUND_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}$/;
export const isSafeSoundId = (value) =>
  typeof value === "string" &&
  SOUND_ID_RE.test(value) &&
  !RESERVED_KEYS.has(value) &&
  value !== "." &&
  value !== "..";

const BGM_CATEGORIES = new Set([
  "bgm",
  "chill",
  "cinematic",
  "corporate",
  "electronic",
  "emotional",
  "festive",
  "lofi",
  "playful",
  "tense",
  "upbeat",
  "warm",
]);

const RISER_STRONG_RE =
  /\b(riser|risers|swell|swells|reverse|uplifter|downlifter|build[\s-]?up|sweep[\s-]?up|suck[\s-]?back)\b/i;
const RISER_SOFT_RE = /\b(tension|drone|suspense)\b/i;
const WHOOSH_RE =
  /\b(whoosh|woosh|swoosh|swish|whip|swipe|pass[\s-]?by|flyby|fly[\s-]?by|slide[\s-]?by|zip[\s-]?past|air[\s-]?rush)\b/i;
const IMPACT_RE =
  /\b(impact|thud|boom|slam|hit|punch|thump|drop[\s-]?out|sub[\s-]?bass|stomp|smash|crash|bang|knock[\s-]?down|braam|stinger)\b/i;
const COMEDY_GLITCH_RE =
  /\b(boing|cartoon|spring|twang|squeak|squeaks|bonk|honk|slide[\s-]?whistle|record[\s-]?scratch|vinyl[\s-]?scratch|fail[\s-]?chime|buzzer|glitch|stutter|tape[\s-]?rewind|static|electric[\s-]?arc|zap|zaps|data[\s-]?corrupt|error[\s-]?buzz)\b/i;
const POP_UI_RE =
  /\b(pop|pops|blip|bloop|bubble|click|clicks|tap|tick|tock|ding|chime|bell|ping|sparkle|shimmer|glint|twinkle|notification|confirm|toggle|button|switch|shutter|camera[\s-]?click|camera[\s-]?flash|ui|plop|typing|keyboard|keystroke)\b/i;
const AMBIENCE_RE =
  /\b(ambience|ambient|room[\s-]?tone|atmosphere|rain|wind|thunder|storm|ocean|waves|surf|forest|birds|crickets|campfire|crowd|chatter|traffic|city|street|cafe|office|hum|murmur|underwater)\b/i;
const FOLEY_CORE_RE =
  /\b(footstep|footsteps|walk|step|steps|run|paper|page|card|book|notebook|cloth|fabric|rustle|crinkle|zipper|pour|pouring|liquid|splash|water|drip|door|latch|hinge|creak|glass|clink|cup|bottle|mug|bite|crunch|chew|chomp|crack|snap|wood|knock|scrape|slide|brush|coin|coins|rattle|hiss|steam|sizzle|fire|crackle|breath|heartbeat|clock|metal|switch|gear|drawer)\b/i;
const NICHE_EXCLUDE_RE =
  /\b(alien|plasma|laser|blaster|spaceship|ufo|phaser|cyber|robot[\s-]?voice|dragon|monster|zombie|demon|gore|vomit|fart|burp|scream|gunshot|rifle|machine[\s-]?gun|cannon|grenade|helicopter|jet[\s-]?fighter|siren)\b/i;

const BOILERPLATE_FOR_RE =
  /\b(a whoosh, riser or transition|a human voice: shout, scream or breath|a musical hit, note or tension tone)\b/gi;

export const soundMetaText = (item) =>
  `${item.name ?? ""} ${item.title ?? ""} ${String(item.for ?? "").replace(BOILERPLATE_FOR_RE, " ")} ${item.category ?? ""} ${item.role ?? ""}`
    .replaceAll("_", " ")
    .toLowerCase();

const soundPrimaryText = (item) =>
  `${item.name ?? ""} ${item.title ?? ""}`.replaceAll("_", " ").toLowerCase();

export const classifyPopularSound = (item) => {
  if (!item || typeof item !== "object") return null;
  const kind = String(item.kind ?? "").toLowerCase();
  const cat = String(item.category ?? "").toLowerCase();
  const secs = Number(item.seconds ?? 0);
  if (kind === "bgm" || BGM_CATEGORIES.has(cat)) return "bgm";
  const primary = soundPrimaryText(item);
  const text = soundMetaText(item);
  if (
    NICHE_EXCLUDE_RE.test(primary) &&
    !WHOOSH_RE.test(primary) &&
    !RISER_STRONG_RE.test(primary) &&
    !RISER_SOFT_RE.test(primary) &&
    !COMEDY_GLITCH_RE.test(primary)
  ) {
    return null;
  }
  if (WHOOSH_RE.test(primary)) return "whoosh";
  if (
    RISER_STRONG_RE.test(primary) ||
    (RISER_SOFT_RE.test(primary) && cat !== "ambience" && (secs === 0 || secs < 12))
  ) {
    return "riser";
  }
  if (cat === "transitions") return "whoosh";
  if (cat === "ambience") return "ambience";
  if (cat === "comedy" || COMEDY_GLITCH_RE.test(primary)) return "comedy-glitch";
  if (cat === "impacts" || IMPACT_RE.test(primary)) return "impact";
  if (cat === "clicks" || cat === "notifications" || POP_UI_RE.test(primary)) return "pop-ui";
  if (
    RISER_STRONG_RE.test(text) ||
    (RISER_SOFT_RE.test(text) && cat !== "ambience" && (secs === 0 || secs < 12))
  ) {
    return "riser";
  }
  if (WHOOSH_RE.test(text)) return "whoosh";
  if (COMEDY_GLITCH_RE.test(text)) return "comedy-glitch";
  if (IMPACT_RE.test(text)) return "impact";
  if (POP_UI_RE.test(text)) return "pop-ui";
  if (
    (cat === "nature" && (secs === 0 || secs >= 4)) ||
    (AMBIENCE_RE.test(text) && (secs === 0 || secs >= 3.5))
  ) {
    return "ambience";
  }
  if (cat === "foley" || cat === "nature" || FOLEY_CORE_RE.test(text)) {
    if (kind === "mc" && !FOLEY_CORE_RE.test(text)) return null;
    return "foley-core";
  }
  return null;
};
