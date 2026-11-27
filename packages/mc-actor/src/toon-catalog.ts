import {
  EXPRESSION_GROUPS,
  EXPRESSIONS,
  type ExpressionGroup,
  type ExpressionName,
} from "./toon-expressions";

interface ExpressionMetadata {
  readonly description: string;
  readonly aliases: readonly [string, ...string[]];
}

const metadata = {
  neutral: { description: "Soft resting smile for a relaxed default face.", aliases: ["resting face", "default face"] },
  blank: { description: "Level gaze and flat lips when giving nothing away.", aliases: ["expressionless", "blank stare", "poker face"] },
  serious: { description: "Steady gaze and firm lips for businesslike attention.", aliases: ["stern", "solemn", "businesslike"] },
  listening: { description: "Attentive eyes and a small smile while someone speaks.", aliases: ["paying attention", "attentive", "listening quietly"] },
  concerned: { description: "Soft brows and a lowered gaze show concern for someone else.", aliases: ["empathetic concern", "worried for a friend", "sympathy"] },
  chill: { description: "Loose half-lidded gaze and relaxed open mouth.", aliases: ["laid back", "relaxed", "at ease"] },
  cool: { description: "Half-lidded self-assurance with a lopsided smile and glints.", aliases: ["unfazed", "playing it cool", "cool confidence"] },

  content: { description: "Quiet satisfaction with soft shut eyes and a small smile.", aliases: ["satisfied", "peaceful smile", "quiet happiness"] },
  smile: { description: "Friendly eyes and a clean, bright crescent smile.", aliases: ["happy", "friendly smile", "warm greeting"] },
  grin: { description: "Broad open-eyed smile with visible teeth.", aliases: ["big grin", "toothy smile", "beaming"] },
  "happy-talk": { description: "Open smiling mouth for a cheerful speaking beat.", aliases: ["cheerful dialogue", "talking happily", "bright speech"] },
  giggle: { description: "Small closed-eye laugh with flushed cheeks.", aliases: ["little laugh", "titter", "soft giggling"] },
  laugh: { description: "Closed-eye arches and a wide, open laugh.", aliases: ["laughing", "belly laugh", "cracking up"] },
  overjoyed: { description: "Bigger closed-eye laugh with blush and celebratory sparkles.", aliases: ["ecstatic", "elated", "euphoric"] },
  amused: { description: "Half-lidded eyes and a small smile at something funny.", aliases: ["quiet amusement", "finding it funny", "knowing smile"] },
  proud: { description: "Eyes closed in satisfaction after a win or achievement.", aliases: ["pride", "triumphant", "satisfied with oneself"] },
  relieved: { description: "Closed lids and a loose mouth with a visible sigh.", aliases: ["relief", "phew", "sigh of relief"] },
  hopeful: { description: "Upturned gaze with wide shining eyes and a tentative smile.", aliases: ["optimistic", "looking up hopefully", "tentative hope"] },
  grateful: { description: "Moist bright eyes and a gentle appreciative smile.", aliases: ["thankful", "appreciative", "touched by kindness"] },
  "joyful-tears": { description: "Tears flowing under a big smile and happy closed eyes.", aliases: ["tears of joy", "crying happy", "happy crying"] },
  bittersweet: { description: "A small smile held over a subdued, lowered gaze.", aliases: ["sad smile", "mixed joy and sadness", "wistful smile"] },
  silly: { description: "Closed cheerful eyes and a tongue-out joke face.", aliases: ["goofy face", "making a funny face", "tongue out"] },
  playful: { description: "Tongue out with one eye closed for teasing.", aliases: ["playful teasing", "teasing wink", "cheeky tongue"] },
  whistle: { description: "Puckered lips, sidelong gaze and floating whistling notes.", aliases: ["whistling", "whistle a tune", "casual whistle"] },
  singing: { description: "Closed eyes and an open singing mouth with musical notes.", aliases: ["sing a song", "singing happily", "humming a tune"] },
  yummy: { description: "Eyes shut in delight, tongue out and cheeks slightly flushed.", aliases: ["delicious", "tastes good", "tasting delicious food"] },
  chewing: { description: "Puffed cheeks and a small off-center mouth while chewing.", aliases: ["mouth full", "chewing food", "chewing a bite"] },

  fond: { description: "Closed eyes and a restrained blush smile at someone dear.", aliases: ["warm affection", "fond smile", "tender affection"] },
  love: { description: "Heart-shaped eyes and a warm open smile.", aliases: ["heart eyes", "adoration", "in love"] },
  smitten: { description: "Heart eyes, stronger blush and floating hearts for a crush.", aliases: ["lovestruck", "infatuated", "crushing hard"] },
  kiss: { description: "Puckered lips, closed eyes and floating hearts.", aliases: ["blowing a kiss", "kissy face", "smooch"] },
  admiring: { description: "Shining upturned eyes when looking up to someone.", aliases: ["admiration", "looking up to someone", "in admiration"] },
  dreamy: { description: "Upward soft gaze and a thought bubble for pleasant daydreaming.", aliases: ["daydreaming", "lost in a daydream", "dreamy gaze"] },

  oh: { description: "A small round mouth and lifted brows at a mild revelation.", aliases: ["mild surprise", "little gasp", "oh reaction"] },
  surprised: { description: "Raised brows, wide eyes and a rounded open mouth.", aliases: ["surprise", "caught off guard", "gasp"] },
  "happy-surprise": { description: "Wide shining eyes and an open grin at an unexpected delight.", aliases: ["pleasantly surprised", "delighted surprise", "good news reveal"] },
  shocked: { description: "Very wide eyes and an open mouth when news lands hard.", aliases: ["shock", "staggered", "mouth agape"] },
  startled: { description: "Quick widened eyes and impact marks at a sudden interruption.", aliases: ["jumpscare reaction", "jump scare", "taken by surprise"] },
  stunned: { description: "Blank wide eyes and pallor after a jarring revelation.", aliases: ["dumbstruck", "shell shocked", "stunned silence"] },
  awe: { description: "Shining wide eyes and a slack mouth at something spectacular.", aliases: ["wonder", "awed", "marveling"] },
  idea: { description: "Lifted brows and a lightbulb when an answer clicks.", aliases: ["eureka", "lightbulb moment", "getting an idea"] },
  disbelief: { description: "One eyebrow up and uneven lips when something seems impossible.", aliases: ["incredulous", "can't believe it", "did that just happen"] },
  speechless: { description: "Flat speechless lips and ellipsis during a silent pause.", aliases: ["lost for words", "wordless pause", "at a loss for words"] },
  impressed: { description: "Raised uneven brows and shining eyes in measured approval.", aliases: ["respectful surprise", "impressed approval", "well done reaction"] },

  worried: { description: "Soft raised brows and a tiny frown before trouble arrives.", aliases: ["anxious", "apprehensive", "quiet worry"] },
  scared: { description: "Wide rising gaze and a rounded grimace at a visible threat.", aliases: ["afraid", "frightened", "fear"] },
  terrified: { description: "Wide eyes, pale face and a large trembling mouth in danger.", aliases: ["terror", "horrified", "petrified"] },
  nervous: { description: "Side glance, wavy lips and sweat while under pressure.", aliases: ["nerves", "feeling uneasy", "on edge"] },
  "nervous-laugh": { description: "Tight teeth and closed laughing eyes with a sweat drop.", aliases: ["uneasy laugh", "laughing nervously", "anxious laugh"] },
  awkward: { description: "Small closed-eye smile and a sweat drop in a social pause.", aliases: ["awkward silence", "social discomfort", "awkward smile"] },
  panicked: { description: "Raised brows, urgent open mouth and a burst of sweat.", aliases: ["panic", "freaking out", "alarmed panic"] },
  scream: { description: "Eyes squeezed shut and a large open scream.", aliases: ["screaming", "yell in fear", "shriek"] },
  "uh-oh": { description: "Side glance and clenched teeth at an immediate mistake.", aliases: ["in trouble", "imminent trouble", "caught out"] },
  "frozen-with-fear": { description: "Wide fixed stare, faint pallor and barely parted lips.", aliases: ["fear freeze", "scared stiff", "frozen in fear"] },

  pensive: { description: "Lowered thoughtful eyes and a restrained frown.", aliases: ["melancholy", "quiet reflection", "lost in thought sadly"] },
  sad: { description: "Soft high inner brows and a clear downturned mouth.", aliases: ["sadness", "unhappy", "blue mood"] },
  crying: { description: "Eyes closed and open mouth with visible tear trails.", aliases: ["cry", "in tears", "weeping"] },
  sobbing: { description: "Large open cry, flushed cheeks and heavy tear streams.", aliases: ["bawling", "crying hard", "inconsolable"] },
  teary: { description: "Tears well in open eyes above a small wavy mouth.", aliases: ["tearing up", "on the verge of tears", "watery eyes"] },
  pleading: { description: "Eyes look up with soft brows when asking for mercy.", aliases: ["puppy eyes", "begging", "please forgive me"] },
  disappointed: { description: "Low eyes and a small downturned mouth after a letdown.", aliases: ["let down", "disappointment", "deflated"] },
  sorry: { description: "Downturned side glance and trembling lips for an apology.", aliases: ["apologetic", "remorseful", "apology"] },
  heartbroken: { description: "Wet lowered eyes, deep frown and a broken heart mark.", aliases: ["heartbreak", "crushed by loss", "brokenhearted"] },
  gloomy: { description: "Heavy shadow and half-lidded eyes under a rain cloud.", aliases: ["gloom", "dejected", "under a cloud"] },
  "angry-grief": { description: "Tears, clenched teeth and uneven brows when hurt turns to anger.", aliases: ["angry crying", "grief and anger", "crying through anger"] },

  icky: { description: "Small uneven grimace and sidelong gaze at mild unpleasantness.", aliases: ["mild disgust", "icky reaction", "yuck"] },
  disgusted: { description: "Sidelong recoil with a raised brow and tongue showing.", aliases: ["disgust", "revolted", "repulsed"] },
  "grossed-out": { description: "Clenched lids, green tint and tongue at strong disgust.", aliases: ["gross reaction", "gagging in disgust", "utterly disgusted"] },
  bored: { description: "Heavy sidelong eyes and a sigh when nothing is happening.", aliases: ["boredom", "restless boredom", "tedium"] },
  unimpressed: { description: "Symmetric half-lidded eyes and a flat, unenthused mouth.", aliases: ["not impressed", "underwhelmed", "unenthused"] },
  contempt: { description: "One narrowed eye and a mouth pulled aside in disdain.", aliases: ["disdain", "sneer", "dismissive side eye"] },
  deadpan: { description: "Flat eye lines, flat mouth and a small comic sweat drop for a dry pause.", aliases: ["deadpan delivery", "straight faced", "dry reaction"] },
  skeptical: { description: "One questioning eyebrow up and one eye narrowed.", aliases: ["skepticism", "doubtful", "raised eyebrow"] },
  suspicious: { description: "Both eyes narrow and slide sideways at a suspected trick.", aliases: ["distrustful", "sus", "suspicious glance"] },
  "eye-roll": { description: "Upward pupils and skewed lips with an exasperated sigh.", aliases: ["rolling eyes", "exasperated", "oh brother"] },

  annoyed: { description: "Half-lidded side glance and a tight frown at a nuisance.", aliases: ["irritated", "miffed", "mild anger"] },
  angry: { description: "Low sharp brows and a clear open frown.", aliases: ["anger", "mad", "pissed"] },
  furious: { description: "Wide yelling mouth under low brows and a visible anger vein.", aliases: ["rage", "livid", "enraged"] },
  pouty: { description: "Puckered lips, averted eyes and a touch of blush.", aliases: ["pouting", "sulking", "sulky"] },
  huffy: { description: "Shut eyes and pursed lips with steam after an offense.", aliases: ["huff", "offended pout", "huffing in annoyance"] },
  frustrated: { description: "Clenched teeth under angry brows with steam and a vein.", aliases: ["frustration", "fed up", "gritting teeth in anger"] },
  tantrum: { description: "Eyes squeezed shut in a loud cry with comic anger marks.", aliases: ["throwing a fit", "meltdown", "temper tantrum"] },
  jealous: { description: "Sidelong glare and a small pout at someone getting what you want.", aliases: ["envy", "envious", "jealous side glance"] },

  sly: { description: "Low sidelong eyes and an uneven grin while hiding a plan.", aliases: ["scheming", "cunning", "secret plan"] },
  smug: { description: "Heavy lids and a small cat smile, pleased with oneself.", aliases: ["self satisfied", "smugness", "smug smile"] },
  mischievous: { description: "An uneven toothy grin and glints before a prank.", aliases: ["mischief", "planning a prank", "impish"] },
  "evil-laugh": { description: "Low brows, shut smiling eyes and an open villain laugh.", aliases: ["villain laugh", "maniacal laugh", "mwa ha ha"] },
  wink: { description: "One eye closed with a broad grin to signal shared knowledge.", aliases: ["winking", "knowing wink", "wink at camera"] },
  snicker: { description: "A discreet closed-eye cat smile at a mischievous joke.", aliases: ["snickering", "suppressed giggle", "laughing under breath"] },

  curious: { description: "One high brow and wide eyes leaning toward a new detail.", aliases: ["curiosity", "intrigued", "interested"] },
  eager: { description: "Bright wide eyes and a grin while waiting for a reward.", aliases: ["keen", "can't wait", "eager anticipation"] },
  excited: { description: "Star-shaped eyes and a wide smile for intense anticipation.", aliases: ["excitement", "starry eyes", "hyped"] },
  determined: { description: "Low angled brows and a small smile before a challenge.", aliases: ["determination", "resolved", "ready for a challenge"] },
  "protective-resolve": { description: "Uneven braced brows, clenched teeth and a watchful gaze.", aliases: ["brave despite fear", "protecting a friend", "protective determination"] },
  focused: { description: "Low brows and a little tongue out while concentrating.", aliases: ["concentrating", "concentration", "working carefully"] },
  hungry: { description: "Bright eyes and drool when anticipating food.", aliases: ["craving food", "mouth watering", "hunger"] },
  greedy: { description: "Diamond eyes, drool and glints on seeing a prize.", aliases: ["avarice", "diamond eyes", "mine all mine"] },

  shy: { description: "Averted eyes and warm cheeks with a small bashful smile.", aliases: ["bashful", "timid smile", "shyness"] },
  embarrassed: { description: "Closed eyes, exposed teeth, blush and sweat after a social slip.", aliases: ["embarrassment", "mortified", "turned red"] },
  flustered: { description: "Spiral eyes, hatching and panic marks when overwhelmed.", aliases: ["fluster", "all a flutter", "overwhelmed by attention"] },
  guilty: { description: "Downward side glance and a sweat drop when hiding a mistake.", aliases: ["guilt", "guilty conscience", "caught red handed"] },
  cringe: { description: "Tight teeth and narrowed eyes at secondhand embarrassment.", aliases: ["secondhand embarrassment", "cringing", "social recoil"] },
  "forced-smile": { description: "Tight toothy smile held under alert asymmetric eyes.", aliases: ["fake smile", "polite smile", "smiling through nerves"] },

  tired: { description: "Drooping eyes and under-eye bags when low on energy.", aliases: ["fatigued", "weary", "worn down"] },
  sleepy: { description: "Very low lids and a small parted mouth at bedtime.", aliases: ["drowsy", "dozing off", "falling asleep"] },
  asleep: { description: "Flat closed lids, parted lips and floating sleep marks.", aliases: ["sleeping", "fast asleep", "zzz"] },
  waking: { description: "One eye cracks open while the other remains shut.", aliases: ["waking up", "groggy", "one eye opening"] },
  yawn: { description: "Eyes squeezed into arcs above a wide rounded yawn.", aliases: ["yawning", "big yawn", "sleepy stretch"] },
  exhausted: { description: "Drooping gaze and an open pant with comic soul effect.", aliases: ["spent", "wiped out", "totally drained"] },

  ouch: { description: "One eye squeezes shut at the instant of a small hit.", aliases: ["ow", "small impact", "stubbed toe"] },
  wince: { description: "Both eyes squeeze shut and the teeth show briefly.", aliases: ["flinch", "wincing", "pain grimace"] },
  hurt: { description: "Tight shut eyes and a large pained mouth with tears.", aliases: ["in pain", "injured", "strong pain"] },
  straining: { description: "Compressed lids and clenched teeth during a heavy effort.", aliases: ["physical exertion", "lifting heavy", "struggling to pull", "gurning with effort"] },
  breathless: { description: "Awake eyes and a rounded mouth while catching breath.", aliases: ["panting", "out of breath", "gasping for air"] },
  "holding-breath": { description: "Wide fixed eyes, puffed cheeks and sealed tiny lips.", aliases: ["holding your breath", "hold breath", "staying silent underwater"] },
  sick: { description: "Green tint, drooping lids and wavy lips when nauseated.", aliases: ["nauseous", "queasy", "ill"] },
  dizzy: { description: "Spiral eyes and small stars after losing balance.", aliases: ["vertigo", "disoriented", "dazed and dizzy"] },
  "knocked-out": { description: "X-shaped eyes and orbiting stars after a comic knockout.", aliases: ["knockout", "unconscious", "seeing stars after a hit"] },
  freezing: { description: "Pale cheeks, chattering teeth and shiver marks in cold.", aliases: ["shivering", "chattering teeth", "very cold"] },
  overheated: { description: "Flushed face and visible tongue with heavy heat sweat.", aliases: ["too hot", "heat exhaustion", "hot and sweaty"] },

  puzzled: { description: "A small raised brow and question mark at a simple puzzle.", aliases: ["perplexed", "slightly confused", "what is this"] },
  confused: { description: "Deeply uneven brows and a question mark for a mismatch.", aliases: ["confusion", "bewildered", "doesn't make sense"] },
  baffled: { description: "Large questioning eyes, a wavering lip and a sweat drop.", aliases: ["utter confusion", "completely baffled", "totally bewildered"] },
  thinking: { description: "Eyes look up to one side while working out an answer.", aliases: ["pondering", "considering", "thinking hard"] },
  clueless: { description: "Dot eyes and flat lips under a question mark.", aliases: ["no idea", "clueless confusion", "comically lost"] },
} satisfies Record<ExpressionName, ExpressionMetadata>;

export interface ToonExpressionEntry extends ExpressionMetadata {
  readonly name: ExpressionName;
  readonly group: ExpressionGroup;
  readonly extras: readonly string[];
}

export interface ToonExpressionFilters {
  readonly group?: ExpressionGroup;
  readonly query?: string;
}

const mergedExtras = (
  name: ExpressionName,
  seen = new Set<ExpressionName>(),
): Record<string, number> => {
  if (seen.has(name)) return {};
  seen.add(name);
  const spec = EXPRESSIONS[name];
  const parent =
    spec.from && spec.from in EXPRESSIONS
      ? mergedExtras(spec.from as ExpressionName, seen)
      : {};
  return { ...parent, ...spec.extras };
};

const extrasOf = (name: ExpressionName): readonly string[] =>
  Object.entries(mergedExtras(name))
    .filter(([, v]) => typeof v === "number" && v > 0)
    .map(([k]) => k);

const catalog: readonly ToonExpressionEntry[] = (Object.keys(EXPRESSION_GROUPS) as ExpressionGroup[]).flatMap(
  (group) =>
    EXPRESSION_GROUPS[group].map((name) => ({
      name,
      group,
      ...metadata[name],
      extras: extrasOf(name),
    })),
);

const normalize = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
const index = catalog.map((entry) => {
  const name = normalize(entry.name);
  const aliases = entry.aliases.map(normalize);
  const words = new Set(normalize([name, entry.group, entry.description, ...aliases].join(" ")).split(" "));
  return { entry, name, aliases, words };
});

export function listToonExpressions({ group, query = "" }: ToonExpressionFilters = {}): readonly ToonExpressionEntry[] {
  const phrase = normalize(query);
  const entries = group ? index.filter(({ entry }) => entry.group === group) : index;
  if (!phrase) return entries.map(({ entry }) => entry);
  const words = phrase.split(" ");
  const match = ({ name, aliases }: (typeof index)[number]) => {
    if (name === phrase) return 2;
    if (aliases.includes(phrase)) return 1;
    return 0;
  };
  return entries
    .filter((candidate) => words.every((word) => candidate.words.has(word)))
    .sort((a, b) => match(b) - match(a))
    .map(({ entry }) => entry);
}
