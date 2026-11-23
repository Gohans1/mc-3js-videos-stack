"""A line about what the AI is doing now, for the creator's studio open on the film: live-studio src/tell.mjs, for the Python
commands (sheet, listen, mix, deliver); change both together. Never in the command's way: with no studio running, or one slow
to answer, the command goes on as if unsaid."""
import json
import os
import urllib.request
from pathlib import Path

# the studio is on this machine: a proxy set for the web must not carry the line away
_direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _cut(s, n):
    s = " ".join(s.split())
    return s if len(s) <= n else s[:n - 1] + "…"


def _at(x):
    """at and to never under 0: arithmetic lands a hair below"""
    return {**x, **{k: max(0.0, x[k]) for k in ("at", "to") if x.get(k) is not None}}


def _mark(m):
    words = _cut(m.get("say") or "", 80)
    return {**{k: v for k, v in _at(m).items() if k != "say"}, **({"say": words} if words else {})}


def tell(project, say, **fields):
    """fields as src/activity.mjs Activity takes them (at, to: heard seconds; notes; lessons; level; marks), cut to what the
    studio takes (a refused line is lost). Whether a studio took it."""
    try:
        port = json.loads((Path(project) / "renders/live/studio.json").read_text(encoding="utf8"))["port"]
        fields = _at({k: v for k, v in fields.items() if v is not None})
        if "marks" in fields:
            fields["marks"] = [_mark(m) for m in fields["marks"][:20]]
        for k, most in (("notes", 50), ("lessons", 20)):
            if k in fields:
                fields[k] = fields[k][:most]
        body = json.dumps({**fields, "say": _cut(say, 200)}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/activity", body, {"content-type": "application/json"})
        with _direct.open(req, timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def job(project, key, say, **fields):
    """A long command: the studio shows it busy from this line until the one the returned end(say, **fields) sends, or until
    this process is gone."""
    tell(project, say, job={"key": key, "pid": os.getpid()}, **fields)
    return lambda last, **more: tell(project, last, job={"key": key, "end": True}, **more)
