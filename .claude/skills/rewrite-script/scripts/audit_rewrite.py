#!/usr/bin/env python3
"""Deterministic Pre-TTS Auditor for the `rewrite-script` skill.

Enforces the consensus priority hierarchy:
  Gate 0: Copyright & YouTube YPP Risk Triage + Multi-Layer Anti-Copy
  P1: Plain Spoken English (empirical lexicon + morphological stemmer, zero slop/!, Clean-Read TTS)
  P2: Continuous Spoken Momentum (WPM < 180 Flop cliff, burstiness CV, slot fill ratio)
  P3: Action-to-Scene Lock (anchor presence & non-empty visual scene labels)
  P4: Time-First Syllable/Duration Isochrony (SPS budget; optional --strict-word-delta opt-in)

Usage:
  python audit_rewrite.py beats.json [--strict] [--format markdown|cards|json]
                                     [--target-sps 3.9] [--strict-word-delta N]
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from alignment_core import load_beats_doc, norm_token, parse_slot, tokenize_words  # noqa: E402

LEXICON_PATH = SCRIPT_DIR.parent / "references" / "lexicon" / "familiar_words_en.txt"

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "so", "if", "as", "at", "by", "for", "from",
    "in", "into", "of", "off", "on", "onto", "out", "over", "to", "up", "with", "about",
    "after", "before", "between", "through", "during", "without", "under", "around",
    "is", "am", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "can", "may", "might", "must",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
    "my", "your", "his", "its", "our", "their", "mine", "yours", "hers", "ours", "theirs",
    "this", "that", "these", "those", "there", "here", "then", "than", "when", "where",
    "while", "which", "who", "whom", "whose", "what", "why", "how", "not", "no", "just",
    "only", "very", "too", "also", "still", "even", "now", "all", "some", "any", "each",
    "both", "more", "most", "other", "own", "same", "such", "until", "because", "though",
    "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "won't",
    "wouldn't", "couldn't", "shouldn't", "can't", "it's", "that's", "there's", "he's",
    "she's", "they're", "we're", "you're", "i'm",
}

BANNED_SLOP_PHRASES = [
    "delve into", "testament to", "it's worth noting", "in a world where",
    "picture this", "buckle up", "you won't believe", "little did", "needless to say",
    "at the end of the day", "in today's video", "did you know", "like and subscribe",
    "smash that", "let's dive in", "crazy right", "think about that",
]

META_CAMERA_PHRASES = [
    "close-up", "close up", "cut to", "wide shot", "camera zooms", "camera pans",
    "on screen", "in this frame", "in the next shot", "voiceover", "b-roll",
]

# Accurate syllable overrides for tricky everyday & benchmark words
SYLLABLE_OVERRIDES: dict[str, int] = {
    "somehow": 2, "somewhere": 2, "something": 2, "someone": 2, "sometimes": 2,
    "idea": 3, "ideas": 3, "area": 3, "areas": 3, "video": 3, "videos": 3,
    "radio": 3, "real": 1, "really": 2, "quiet": 2, "giant": 2, "science": 2,
    "scientist": 3, "scientists": 3, "create": 2, "created": 3, "creating": 3,
    "people": 2, "every": 2, "everyone": 3, "everybody": 4, "everything": 3,
    "different": 2, "business": 2, "interesting": 3, "parachute": 3, "parachutes": 3,
    "skydiver": 3, "skydivers": 3, "skydiving": 3, "suddenly": 3, "accidentally": 4,
    "actually": 3, "usually": 3, "finally": 3, "family": 2, "fire": 1, "hour": 1,
    "hours": 1, "our": 1, "toward": 1, "towards": 1, "world": 1, "clothes": 1,
    "breathed": 1, "blessed": 1, "learned": 1, "naked": 2, "wicked": 2,
    "wanted": 2, "started": 2, "ended": 2, "landed": 2, "needed": 2, "drifted": 2,
    "pointed": 2, "waited": 2, "decided": 2, "admitted": 3, "connected": 3,
    "expected": 3, "prepared": 2, "allowed": 2, "stationed": 2, "enlisted": 3,
    "enlisting": 3, "reacting": 3, "overeat": 3, "gibberish": 3, "certainty": 3,
    "understood": 3, "venomous": 3, "civilian": 3, "soldier": 2, "soldering": 3,
    "eventually": 4, "explosion": 3, "pressure": 2, "blanket": 2, "timer": 2,
    "helmet": 2, "forest": 2, "branches": 2, "crashes": 2, "watches": 2,
    "faces": 2, "boxes": 2, "places": 2, "slices": 2, "chances": 2, "pieces": 2,
    "changes": 2, "causes": 2, "pauses": 2, "fuses": 2, "uses": 2, "loses": 2,
    "closes": 2, "senses": 2, "voices": 2, "noises": 2, "choices": 2, "prices": 2,
    "spices": 2, "sauces": 2, "edges": 2, "judges": 2, "bridges": 2, "pages": 2,
    "dishes": 2, "pushes": 2, "rushes": 2, "flashes": 2, "smashes": 2, "washes": 2,
    "catches": 2, "matches": 2, "scratches": 2, "reaches": 2, "pinches": 2, "punches": 2,
    "misses": 2, "passes": 2, "glasses": 2, "classes": 2, "crosses": 2, "fixes": 2,
    "mixes": 2, "prizes": 2, "sizes": 2, "freezes": 2, "squeezes": 2, "homemade": 2,
    "boyfriend": 2, "girlfriend": 2, "restaurant": 2, "chocolate": 2, "favorite": 2,
    "camera": 2, "memory": 3, "history": 3, "mystery": 3, "factory": 3,
    "companies": 3, "company": 3, "ingredients": 4, "delicious": 3, "dangerous": 3,
    "curious": 3, "serious": 3, "obvious": 3, "previous": 3, "various": 3,
    "million": 2, "billion": 2, "onion": 2, "opinion": 3, "champion": 3,
    "spicier": 3, "heavier": 3, "easier": 3, "happier": 3, "earlier": 3,
    "doesn't": 2, "didn't": 2, "couldn't": 2, "wouldn't": 2, "shouldn't": 2,
    "wasn't": 2, "weren't": 1, "isn't": 2, "aren't": 1, "hasn't": 2, "haven't": 2,
    "hadn't": 2, "won't": 1, "can't": 1, "don't": 1, "they're": 1, "we're": 1,
    "you're": 1, "it's": 1, "that's": 1, "there's": 1, "what's": 1, "who's": 1,
    "unconscious": 3, "anticoagulants": 6, "anticoagulant": 5, "plummeted": 3,
    "elephant": 3, "umbrella": 3, "banana": 3, "ambulance": 3, "afternoon": 3,
    "understand": 3, "impossible": 4, "mosquito": 3, "butterfly": 3, "gravity": 3,
    "oxygen": 3, "skeleton": 3, "accident": 3, "hospital": 3, "detective": 3,
    "policeman": 3, "officer": 3, "officers": 3, "interview": 3, "remember": 3,
    "together": 3, "another": 3, "tomorrow": 3, "yesterday": 3, "anything": 3,
    "anybody": 4, "nobody": 3, "somebody": 3, "however": 3, "whatever": 3,
    "whenever": 3, "wherever": 3, "forever": 3, "already": 3, "probably": 3,
    "potato": 3, "tomato": 3, "animal": 3, "animals": 3, "energy": 3,
    "finally": 3, "regular": 3, "popular": 3, "similar": 3, "computer": 3,
}

# Optional CMUdict hook if installed in the active Python environment
_CMU_DICT: dict[str, list[list[str]]] | None = None
try:
    import cmudict as _cmudict_mod  # type: ignore
    _CMU_DICT = _cmudict_mod.dict()
except Exception:
    _CMU_DICT = None

_LEXICON_CACHE: set[str] | None = None


def load_familiar_lexicon() -> set[str]:
    global _LEXICON_CACHE
    if _LEXICON_CACHE is not None:
        return _LEXICON_CACHE
    words: set[str] = set()
    if LEXICON_PATH.exists():
        for line in LEXICON_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip().lower()
            if line and not line.startswith("#"):
                words.add(line)
    _LEXICON_CACHE = words
    return words


def _count_single_word_syllables(w: str) -> int:
    w = norm_token(w)
    if not w:
        return 0
    if w.isdigit():
        return max(1, len(w))
    if w in SYLLABLE_OVERRIDES:
        return SYLLABLE_OVERRIDES[w]
    if _CMU_DICT and w in _CMU_DICT:
        prons = _CMU_DICT[w]
        if prons:
            return max(1, sum(1 for ph in prons[0] if ph[-1].isdigit()))
    if len(w) <= 3:
        return 1

    base = w.replace("'", "")
    if base in SYLLABLE_OVERRIDES:
        return SYLLABLE_OVERRIDES[base]

    # Strip silent endings carefully:
    # - Keep -ted / -ded (started, landed, drifted -> +1 syllable)
    # - Keep sibilant -es (branches, crashes, watches, faces, boxes, sizes -> +1 syllable)
    # - Keep syllabic -le after consonant (table, bottle, candle -> +1 syllable)
    core = base
    add_syllables = 0

    if re.search(r"(?:[td])ed$", core) and len(core) > 4:
        core = core[:-2]
        add_syllables += 1
    elif core.endswith("ed") and len(core) > 4:
        core = core[:-2]
    elif re.search(r"(?:s|x|z|ch|sh|ge|ce)es$", core) and len(core) > 4:
        core = core[:-2]
        add_syllables += 1
    elif core.endswith("es") and not core.endswith("ies") and len(core) > 4:
        core = core[:-2]
    elif core.endswith("e"):
        if re.search(r"[^aeiouy]le$", core) and len(core) > 3:
            pass  # keep syllabic -le
        elif core.endswith(("ee", "oe", "ye", "ue")):
            pass
        else:
            core = core[:-1]

    if core.startswith("y"):
        core = core[1:]

    groups = re.findall(r"[aeiouy]+", core)
    count = len(groups) + add_syllables

    # Hiatus vowel pairs that form 2 syllables (idea, area, giant, create, riot, lion, fluid, poem)
    for pat in (r"ia", r"io", r"iu", r"eo", r"ua", r"uo", r"oa(?=[td])", r"eeing", r"oing", r"ying"):
        # Avoid double-counting -tion/-sion/-cious/-tious
        if pat == r"io" and re.search(r"(?:t|s|c|x)io", core):
            continue
        if pat == r"ia" and re.search(r"(?:t|c|s)ia", core):
            continue
        if re.search(pat, core):
            count += 1

    # Compound silent-e interior (e.g., "somehow", "homemade", "baseball", "safely", "hopeless")
    if re.search(r"(?:some|home|safe|life|time|side|wide|fire|wire|base|case|care|bare|lone|love|live|move|make|take|wake|give|hide|ride|rope|nose|rose|hole|pole|bone|tone|note|gate|late|mate|rate|date|name|same|game|came|flame|shame|blame|frame|place|space|grace|trace|stage|page|cage|face|race|pace|line|fine|mine|nine|pine|vine|wine|shine|spine|store|shore|score|more|core|fore|bore|sore|wore|tore|pure|sure|cure|fire|tire|hire|wire)(?:how|where|one|body|thing|time|times|made|work|sick|less|full|ful|ly|ment|ness|ward|way|ball|board|book|box|man|men|room|house|yard|land|line|light|fall|out|in|up|down|off|over|back|side|step|walk|run|fly|drop|cut|set|top|end|day|night)", base):
        # Usually silent interior 'e' shouldn't count as a vowel group
        if count > 2:
            count -= 1

    return max(1, count)


def count_syllables(word: str) -> int:
    parts = [p for p in re.split(r"[\-—–/]+", word) if p]
    if not parts:
        return 0
    return sum(_count_single_word_syllables(p) for p in parts)


def simple_lemma(word: str) -> str:
    """Lightweight deterministic English stemmer/lemmatizer (zero external deps)."""
    w = norm_token(word)
    if not w:
        return ""
    if w.endswith("'s"):
        w = w[:-2]
    irregular = {
        "fell": "fall", "falling": "fall", "fallen": "fall",
        "dropped": "drop", "dropping": "drop",
        "slid": "slide", "sliding": "slide",
        "woke": "wake", "woken": "wake", "waking": "wake",
        "began": "begin", "begun": "begin", "beginning": "begin",
        "ran": "run", "running": "run",
        "saw": "see", "seen": "see", "seeing": "see",
        "took": "take", "taken": "take", "taking": "take",
        "made": "make", "making": "make",
        "gave": "give", "given": "give", "giving": "give",
        "went": "go", "gone": "go", "going": "go",
        "came": "come", "coming": "come",
        "knew": "know", "known": "know",
        "thought": "think", "thinking": "think",
        "told": "tell", "telling": "tell",
        "said": "say", "saying": "say",
        "found": "find", "finding": "find",
        "left": "leave", "leaving": "leave",
        "hid": "hide", "hidden": "hide", "hiding": "hide",
        "kept": "keep", "keeping": "keep",
        "held": "hold", "holding": "hold",
        "caught": "catch", "catching": "catch",
        "bit": "bite", "bitten": "bite", "biting": "bite",
        "broke": "break", "broken": "break", "breaking": "break",
        "drove": "drive", "driven": "drive", "driving": "drive",
        "flew": "fly", "flown": "fly", "flying": "fly",
        "blew": "blow", "blown": "blow",
        "grew": "grow", "grown": "grow",
        "threw": "throw", "thrown": "throw",
        "wrote": "write", "written": "write", "writing": "write",
        "rode": "ride", "ridden": "ride",
        "spoke": "speak", "spoken": "speak",
        "stole": "steal", "stolen": "steal",
        "chose": "choose", "chosen": "choose",
        "ate": "eat", "eaten": "eat", "eating": "eat",
        "drank": "drink", "drunk": "drink",
        "swam": "swim", "swum": "swim",
        "slept": "sleep", "sleeping": "sleep",
        "felt": "feel", "feeling": "feel",
        "met": "meet", "meeting": "meet",
        "paid": "pay", "paying": "pay",
        "laid": "lay", "laying": "lay",
        "led": "lead", "leading": "lead",
        "fed": "feed", "feeding": "feed",
        "fled": "flee",
        "hung": "hang",
        "dug": "dig",
        "spun": "spin", "spinning": "spin",
        "struck": "strike",
        "stuck": "stick",
        "stood": "stand",
        "understood": "understand",
        "brought": "bring",
        "bought": "buy",
        "fought": "fight",
        "sought": "seek",
        "taught": "teach",
        "heard": "hear",
        "built": "build",
        "sent": "send",
        "spent": "spend",
        "lent": "lend",
        "bent": "bend",
        "lost": "lose", "losing": "lose",
        "shot": "shoot",
        "lit": "light",
        "sat": "sit", "sitting": "sit",
        "got": "get", "gotten": "get", "getting": "get",
        "forgotten": "forget", "forgot": "forget",
        "feet": "foot", "teeth": "tooth", "men": "man", "women": "woman",
        "children": "child", "mice": "mouse", "geese": "goose", "lives": "life",
        "knives": "knife", "leaves": "leaf", "wolves": "wolf",
        "better": "good", "best": "good", "worse": "bad", "worst": "bad",
    }
    if w in irregular:
        return irregular[w]
    if len(w) <= 3:
        return w
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("ied") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("ing") and len(w) > 5:
        stem = w[:-3]
        if len(stem) >= 3 and stem[-1] == stem[-2] and stem[-1] not in "lsz":
            return stem[:-1]
        return stem
    if w.endswith("ed") and len(w) > 4:
        stem = w[:-2]
        if len(stem) >= 3 and stem[-1] == stem[-2] and stem[-1] not in "lsz":
            return stem[:-1]
        return stem
    if w.endswith("es") and len(w) > 4 and re.search(r"(?:s|x|z|ch|sh)$", w[:-2]):
        return w[:-2]
    if w.endswith("s") and not w.endswith(("ss", "us", "is")) and len(w) > 3:
        return w[:-1]
    if w.endswith("ly") and len(w) > 5:
        return w[:-2]
    return w


def is_familiar_word(raw_word: str, lexicon: set[str], allow_set: set[str]) -> bool:
    """Check whether `raw_word` is everyday spoken English or an allowed on-screen noun."""
    # Split hyphenated compounds first ("six-year-old", "mid-air", "ex-boyfriend")
    parts = [p for p in re.split(r"[\-—–/]+", raw_word) if p]
    if len(parts) > 1:
        return all(is_familiar_word(p, lexicon, allow_set) for p in parts)

    w = norm_token(raw_word)
    if not w or w.isdigit():
        return True
    if w in lexicon or w in allow_set or w in STOPWORDS:
        return True

    # Possessive / contraction stem
    if w.endswith("'s"):
        base = w[:-2]
        if base in lexicon or base in allow_set:
            return True
    if "'" in w:
        head = w.split("'", 1)[0]
        if head in lexicon or head in allow_set or head in STOPWORDS:
            return True

    # Morphological candidate stems
    candidates = {simple_lemma(w)}
    if w.endswith("ing") and len(w) > 5:
        stem = w[:-3]
        candidates.add(stem)
        candidates.add(stem + "e")
        if len(stem) >= 3 and stem[-1] == stem[-2]:
            candidates.add(stem[:-1])
    if w.endswith("ed") and len(w) > 4:
        stem = w[:-2]
        candidates.add(stem)
        candidates.add(stem + "e")
        if len(stem) >= 3 and stem[-1] == stem[-2]:
            candidates.add(stem[:-1])
    if w.endswith("d") and len(w) > 4:
        candidates.add(w[:-1])
    if w.endswith("er") and len(w) > 4:
        stem = w[:-2]
        candidates.add(stem)
        candidates.add(stem + "e")
        if stem.endswith("i"):
            candidates.add(stem[:-1] + "y")
        if len(stem) >= 3 and stem[-1] == stem[-2]:
            candidates.add(stem[:-1])
    if w.endswith("est") and len(w) > 5:
        stem = w[:-3]
        candidates.add(stem)
        candidates.add(stem + "e")
        if stem.endswith("i"):
            candidates.add(stem[:-1] + "y")
    if w.endswith("es") and len(w) > 4:
        candidates.add(w[:-2])
        candidates.add(w[:-1])
    if w.endswith("ves") and len(w) > 4:
        candidates.add(w[:-3] + "f")
        candidates.add(w[:-3] + "fe")
    if w.endswith("s") and len(w) > 3:
        candidates.add(w[:-1])
    if w.endswith("ly") and len(w) > 5:
        stem = w[:-2]
        candidates.add(stem)
        if stem.endswith("i"):
            candidates.add(stem[:-1] + "y")
    if w.endswith("y") and len(w) > 4:
        candidates.add(w[:-1])
        candidates.add(w[:-1] + "e")

    return any(c in lexicon or c in allow_set for c in candidates)


def find_exact_ngrams(a_tokens: list[str], b_tokens: list[str], n: int) -> list[str]:
    if len(a_tokens) < n or len(b_tokens) < n:
        return []
    a_set = {" ".join(a_tokens[i : i + n]) for i in range(len(a_tokens) - n + 1)}
    hits: list[str] = []
    seen: set[str] = set()
    for i in range(len(b_tokens) - n + 1):
        g = " ".join(b_tokens[i : i + n])
        if g in a_set and g not in seen:
            hits.append(g)
            seen.add(g)
    return hits


def content_lemmas(text: str, exclude: set[str] | None = None) -> list[str]:
    excl = exclude or set()
    out: list[str] = []
    for tok in tokenize_words(text):
        if tok in STOPWORDS or tok.isdigit():
            continue
        lem = simple_lemma(tok)
        if not lem or lem in STOPWORDS or lem in excl or tok in excl:
            continue
        out.append(lem)
    return out


def jaccard_similarity(a: list[str], b: list[str]) -> tuple[float, int]:
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0, 0
    inter = sa & sb
    union = sa | sb
    return (len(inter) / len(union)), len(inter)


def rouge_l_f1(a: list[str], b: list[str]) -> float:
    """ROUGE-L F1 = 2 * LCS / (|a| + |b|) on content-word lemma sequences."""
    if not a or not b:
        return 0.0
    m, n = len(a), len(b)
    prev = [0] * (n + 1)
    for i in range(1, m + 1):
        curr = [0] * (n + 1)
        ai = a[i - 1]
        for j in range(1, n + 1):
            if ai == b[j - 1]:
                curr[j] = prev[j - 1] + 1
            else:
                curr[j] = prev[j] if prev[j] >= curr[j - 1] else curr[j - 1]
        prev = curr
    lcs = prev[n]
    return (2.0 * lcs) / (m + n)


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"[.!?]+", text) if p.strip()]
    return parts


def check_tts_readiness(tts_text: str) -> list[str]:
    issues: list[str] = []
    if re.search(r"[%$€£°]", tts_text):
        issues.append("unexpanded_tts_symbol")
    if re.search(r"\b\d+(?:\.\d+)?\b", tts_text):
        issues.append("unexpanded_tts_digit")
    return issues


def audit_document(
    doc: dict[str, Any],
    target_sps_override: float | None = None,
    strict_word_delta: int | None = None,
) -> dict[str, Any]:
    lexicon = load_familiar_lexicon()
    target_sps = float(target_sps_override if target_sps_override is not None else doc.get("target_sps", 3.6))
    content_risk = str(doc.get("content_risk", "green")).lower()
    risk_ack = bool(doc.get("risk_acknowledged", False))

    raw_allow = [str(w).lower().strip() for w in doc.get("allow_words", []) if str(w).strip()]
    allow_set: set[str] = set()
    for phrase in raw_allow:
        for tok in tokenize_words(phrase):
            allow_set.add(tok)
            allow_set.add(simple_lemma(tok))

    beats = doc.get("beats", [])
    beat_rows: list[dict[str, Any]] = []
    fails: list[str] = []
    warns: list[str] = []

    # Gate 0 Risk Triage
    if content_risk == "red":
        msg = "GATE0_RED_CONTENT_RISK: original fiction/visual-clone risk — warn user about copyright & YPP Reused Content"
        if not risk_ack:
            fails.append(msg)
        else:
            warns.append(msg)
    elif content_risk == "yellow":
        warns.append("GATE0_YELLOW_RISK: strip creator's unique analogies/jokes and draft fresh from facts")

    all_before_texts: list[str] = []
    all_after_texts: list[str] = []
    all_tts_texts: list[str] = []
    total_bw = total_aw = total_bs = total_as = 0
    total_slot_sec = 0.0
    slots_present = 0

    for idx, beat in enumerate(beats):
        bid = str(beat.get("id") or f"b{idx + 1}")
        scene = str(beat.get("scene", "")).strip()
        before = str(beat.get("before", "")).strip()
        after = str(beat.get("after", "")).strip()
        tts_text = str(beat.get("tts_text") or after).strip()
        sfx_before = bool(beat.get("sfx_beat_before", False))
        slot_s, slot_e = parse_slot(beat)

        all_before_texts.append(before)
        all_after_texts.append(after)
        all_tts_texts.append(tts_text)

        b_toks = tokenize_words(before)
        a_toks = tokenize_words(after)
        tts_toks = tokenize_words(tts_text)

        bw, aw = len(b_toks), len(a_toks)
        bs = sum(count_syllables(w) for w in b_toks)
        a_syl = sum(count_syllables(w) for w in tts_toks)
        total_bw += bw
        total_aw += aw
        total_bs += bs
        total_as += a_syl

        b_fails: list[str] = []
        b_warns: list[str] = []

        # P1: Plain Spoken English + Slop + Meta-Camera + ! + TTS readiness
        raw_words = re.findall(r"[A-Za-z0-9]+(?:['\u2019\-][A-Za-z0-9]+)*", after)
        unfamiliar: list[str] = []
        for rw in raw_words:
            if not is_familiar_word(rw, lexicon, allow_set):
                # Allow capitalized mid-sentence proper nouns ONLY if explicitly allow-listed; flag otherwise
                unfamiliar.append(rw.lower())
        if unfamiliar:
            uniq = sorted(set(unfamiliar))
            b_fails.append(f"P1_unfamiliar_vocab:{','.join(uniq)}")

        low_after = after.lower()
        for phrase in BANNED_SLOP_PHRASES:
            if phrase in low_after:
                b_fails.append(f"P1_ai_slop:'{phrase}'")
        for phrase in META_CAMERA_PHRASES:
            if phrase in low_after:
                b_fails.append(f"P1_meta_camera:'{phrase}'")
        if "!" in after or "!" in tts_text:
            b_fails.append("P1_exclamation_mark")

        for tts_issue in check_tts_readiness(tts_text):
            b_fails.append(f"P1_{tts_issue}")

        # P1 Per-beat Anti-Copy (Jaccard excluding allow_words, only when shared_count >= 2)
        b_cont = content_lemmas(before, exclude=allow_set)
        a_cont = content_lemmas(after, exclude=allow_set)
        b_jacc, shared_n = jaccard_similarity(b_cont, a_cont)
        if shared_n >= 2 and b_jacc > 0.40:
            b_fails.append(f"P1_beat_jaccard:{b_jacc:.2f}>0.40(shared={shared_n})")

        # P3: Scene description & anchors check
        if not scene:
            b_warns.append("P3_missing_scene_description")
        for anc in beat.get("anchors") or []:
            anc_phrase = str(anc.get("phrase", "")).strip()
            if anc_phrase:
                anc_toks = tokenize_words(anc_phrase)
                if not find_exact_ngrams(tts_toks, anc_toks, len(anc_toks)):
                    # Check case-insensitive substring fallback
                    if " ".join(anc_toks) not in " ".join(tts_toks):
                        b_fails.append(f"P3_anchor_missing_in_text:'{anc_phrase}'")

        # P4: Time-First Syllable/Duration Isochrony
        slot_dur = None
        usable_sec = None
        est_sec = None
        fill_ratio = None
        beat_sps = None
        if slot_s is not None and slot_e is not None and slot_e > slot_s:
            slots_present += 1
            slot_dur = round(slot_e - slot_s, 3)
            total_slot_sec += slot_dur
            planned_pause = 0.0 if idx == 0 else (0.38 if sfx_before else 0.18)
            usable_sec = round(max(0.35, slot_dur - planned_pause), 3)
            est_sec = round(a_syl / target_sps, 3)
            fill_ratio = round(est_sec / usable_sec, 2)
            beat_sps = round(a_syl / usable_sec, 2)

            if beat_sps > 4.8:
                b_fails.append(f"P4_beat_rushed:{beat_sps:.2f}syl/s>4.80 (fill={fill_ratio:.2f})")
            elif fill_ratio > 1.18:
                b_fails.append(f"P4_slot_overflow_risk:fill={fill_ratio:.2f}>1.18 ({a_syl}syl in {usable_sec:.2f}s)")
            elif fill_ratio > 1.08:
                b_warns.append(f"P4_slot_tight:fill={fill_ratio:.2f}")
            elif slot_dur >= 2.5 and fill_ratio < 0.78:
                b_warns.append(f"P4_slot_sparse_dead_air_risk:fill={fill_ratio:.2f}")

        # Optional opt-in word delta (--strict-word-delta N)
        w_delta = aw - bw
        if strict_word_delta is not None and abs(w_delta) > strict_word_delta:
            b_fails.append(f"P4_optin_word_delta:{w_delta:+d}(limit=±{strict_word_delta})")

        for f in b_fails:
            fails.append(f"{bid}:{f}")
        for w in b_warns:
            warns.append(f"{bid}:{w}")

        beat_rows.append({
            "id": bid,
            "time": f"{slot_s:.2f}-{slot_e:.2f}s" if slot_s is not None and slot_e is not None else str(beat.get("time", "")),
            "slot_dur": slot_dur,
            "usable_sec": usable_sec,
            "scene": scene,
            "before": before,
            "after": after,
            "tts_text": tts_text,
            "before_words": bw,
            "after_words": aw,
            "word_delta": w_delta,
            "before_syl": bs,
            "after_syl": a_syl,
            "est_sec": est_sec,
            "fill_ratio": fill_ratio,
            "beat_sps": beat_sps,
            "beat_jaccard": round(b_jacc, 3),
            "shared_content_words": shared_n,
            "fails": b_fails,
            "warns": b_warns,
        })

    # Full-script Anti-Copy checks
    full_before = " ".join(all_before_texts)
    full_after = " ".join(all_after_texts)
    full_tts = " ".join(all_tts_texts)

    exact_4grams = find_exact_ngrams(tokenize_words(full_before), tokenize_words(full_after), 4)
    if exact_4grams:
        fails.append(f"P1_exact_4gram_overlap:{exact_4grams[:5]}")

    # Lemmatized 3-content-word n-gram (INCLUDES allow_words so prop+verb triples cannot be copied!)
    b_cont_all = content_lemmas(full_before, exclude=set())
    a_cont_all = content_lemmas(full_after, exclude=set())
    content_3grams = find_exact_ngrams(b_cont_all, a_cont_all, 3)
    if content_3grams:
        fails.append(f"P1_content_3gram_overlap:{content_3grams[:5]}")

    # Full-script Jaccard & ROUGE-L F1 (EXCLUDES allow_words)
    b_cont_no_allow = content_lemmas(full_before, exclude=allow_set)
    a_cont_no_allow = content_lemmas(full_after, exclude=allow_set)
    full_jacc, full_shared = jaccard_similarity(b_cont_no_allow, a_cont_no_allow)
    full_rouge_l = rouge_l_f1(b_cont_no_allow, a_cont_no_allow)

    if full_jacc > 0.32:
        fails.append(f"P1_full_jaccard:{full_jacc:.3f}>0.32")
    if full_rouge_l > 0.35:
        fails.append(f"P1_full_rouge_l:{full_rouge_l:.3f}>0.35")

    # Full-script WPM & Burstiness CV
    total_dur = float(doc["total_dur"]) if doc.get("total_dur") else (total_slot_sec if total_slot_sec > 0 else None)
    est_wpm = round(total_aw / total_dur * 60.0, 1) if total_dur and total_dur > 0 else None
    est_total_spoken_sec = round(total_as / target_sps, 2)
    if est_wpm is not None and est_wpm >= 180.0:
        fails.append(f"P2_projected_wpm_flop_cliff:{est_wpm:.1f}>=180")

    sents = split_sentences(full_after)
    sent_lens = [len(tokenize_words(s)) for s in sents if tokenize_words(s)]
    burstiness_cv = None
    if len(sent_lens) >= 4:
        mean_l = sum(sent_lens) / len(sent_lens)
        var_l = sum((x - mean_l) ** 2 for x in sent_lens) / len(sent_lens)
        burstiness_cv = round(math.sqrt(var_l) / mean_l, 3) if mean_l > 0 else 0.0
        if burstiness_cv < 0.20:
            warns.append(f"P1_low_burstiness_cv:{burstiness_cv:.2f}<0.20(monotonous sentence length)")

    return {
        "ok": len(fails) == 0,
        "film": doc.get("film"),
        "content_risk": content_risk,
        "fails": fails,
        "warns": warns,
        "summary": {
            "beats": len(beats),
            "total_dur_sec": round(total_dur, 2) if total_dur else None,
            "before_words": total_bw,
            "after_words": total_aw,
            "word_delta": total_aw - total_bw,
            "before_syllables": total_bs,
            "after_syllables": total_as,
            "target_sps": target_sps,
            "est_spoken_sec": est_total_spoken_sec,
            "est_wpm": est_wpm,
            "sentence_count": len(sent_lens),
            "burstiness_cv": burstiness_cv,
            "exact_4gram_overlaps": exact_4grams,
            "content_3gram_overlaps": content_3grams,
            "full_jaccard": round(full_jacc, 3),
            "full_shared_content": full_shared,
            "full_rouge_l_f1": round(full_rouge_l, 3),
            "full_tts_text": full_tts,
        },
        "beats": beat_rows,
    }


def _esc_md(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def format_markdown(report: dict[str, Any]) -> str:
    s = report["summary"]
    lines = [
        f"## Rewrite Audit: `{report['film']}` — {'PASS' if report['ok'] else 'FAIL'}",
        f"- Gate 0 Risk: `{report['content_risk']}` | Beats: `{s['beats']}` | Sentences: `{s['sentence_count']}` (Burstiness CV: `{s['burstiness_cv']}`)",
        f"- Words: `{s['before_words']} -> {s['after_words']}` (`{s['word_delta']:+d}`) | Syllables: `{s['before_syllables']} -> {s['after_syllables']}` | Est Spoken: `{s['est_spoken_sec']}s` @ `{s['target_sps']} syl/s` | Projected WPM: `{s['est_wpm']}`",
        f"- Anti-Copy: 4-grams=`{len(s['exact_4gram_overlaps'])}` | 3-content-grams=`{len(s['content_3gram_overlaps'])}` | Jaccard=`{s['full_jaccard']}` (`<=0.32`) | ROUGE-L F1=`{s['full_rouge_l_f1']}` (`<=0.35`)",
        "",
        "| Beat | Time | Scene | Before | After | Syl / Fill | Jaccard | Status |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for b in report["beats"]:
        st = "PASS" if not b["fails"] else "FAIL: " + "; ".join(b["fails"])
        if b["warns"] and not b["fails"]:
            st = "WARN: " + "; ".join(b["warns"])
        fill_str = f"{b['after_syl']}s / {b['fill_ratio']}" if b["fill_ratio"] is not None else f"{b['after_syl']}s"
        lines.append(
            f"| `{b['id']}` | `{b['time']}` | {_esc_md(b['scene'])} | {_esc_md(b['before'])} | {_esc_md(b['after'])} | `{fill_str}` | `{b['beat_jaccard']}` | {_esc_md(st)} |"
        )
    if report["fails"]:
        lines.append("\n### Fails")
        for f in report["fails"]:
            lines.append(f"- {f}")
    if report["warns"]:
        lines.append("\n### Warnings")
        for w in report["warns"]:
            lines.append(f"- {w}")
    return "\n".join(lines)


def format_cards(report: dict[str, Any]) -> str:
    s = report["summary"]
    lines = [
        f"REWRITE AUDIT: {report['film']} -> {'PASS' if report['ok'] else 'FAIL'}",
        f"Risk={report['content_risk']} | Words={s['before_words']}->{s['after_words']} | Syl={s['before_syllables']}->{s['after_syllables']} | EstWPM={s['est_wpm']} | CV={s['burstiness_cv']}",
        f"Anti-Copy: 4g={len(s['exact_4gram_overlaps'])}, c3g={len(s['content_3gram_overlaps'])}, Jaccard={s['full_jaccard']}, ROUGE-L={s['full_rouge_l_f1']}",
    ]
    for b in report["beats"]:
        status = "PASS" if not b["fails"] else f"FAIL ({', '.join(b['fails'])})"
        lines.append(f"\n[{b['id']}] {b['time']} | {b['scene']} -> {status}")
        lines.append(f"  BEFORE ({b['before_words']}w/{b['before_syl']}syl): {b['before']}")
        lines.append(f"  AFTER  ({b['after_words']}w/{b['after_syl']}syl, fill={b['fill_ratio']}, sps={b['beat_sps']}): {b['after']}")
    if report["fails"]:
        lines.append("\nFAILS:\n  - " + "\n  - ".join(report["fails"]))
    if report["warns"]:
        lines.append("\nWARNS:\n  - " + "\n  - ".join(report["warns"]))
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="Pre-TTS deterministic auditor for rewrite-script.")
    ap.add_argument("beats_json", help="Path to unified beats.json")
    ap.add_argument("--strict", action="store_true", help="Exit non-zero if any FAIL is reported")
    ap.add_argument("--format", choices=("markdown", "cards", "json"), default="cards")
    ap.add_argument("--target-sps", type=float, default=None, help="Override target syllables/sec")
    ap.add_argument("--strict-word-delta", type=int, default=None, help="Optional opt-in ±N word parity limit")
    args = ap.parse_args()

    doc = load_beats_doc(args.beats_json)
    report = audit_document(doc, target_sps_override=args.target_sps, strict_word_delta=args.strict_word_delta)

    if args.format == "json":
        print(json.dumps(report, indent=2, ensure_ascii=False))
    elif args.format == "markdown":
        print(format_markdown(report))
    else:
        print(format_cards(report))

    if args.strict and not report["ok"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
