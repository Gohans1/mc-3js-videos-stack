"""A heard second as notes, a draft's strip and bun run at print it: 65, 1:05, 01:05.250 or 65s. The rule of
live-studio src/cli.mjs secondArg, for the Python commands (sheet, deliver, listen); change both together."""
import re

SAY = "65, 1:05 or 01:05.250"


def heard_second(text):
    """The second as a float, or None when text is no heard second (a minute's seconds run 0-59)."""
    m = re.fullmatch(r"(?:(\d+):([0-5]?\d(?:\.\d+)?)|(\d*\.?\d+)s?)", text.strip())
    return None if not m else float(m[3]) if m[3] is not None else int(m[1]) * 60 + float(m[2])


def meant(text):
    """What a mm:ss past 59 s was likely meant as, to end a refusal with ("1:75" -> ": ..., did you mean 2:15?"), else ""."""
    m = re.fullmatch(r"(\d+):(\d+(?:\.\d+)?)", text.strip())
    if not m or float(m[2]) < 60:
        return ""
    t = int(m[1]) * 60 + float(m[2])
    return f": a minute holds 0-59 s, did you mean {int(t // 60)}:{round(t % 60, 3):02g}?"
