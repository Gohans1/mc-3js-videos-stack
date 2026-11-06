"""Jev (TypeSafe System One, docs.typesafe.ai): a small judge model that answers typed questions about a text state:
Choice (one option of up to 255, a probability each) and Noul (yes/no, the probability of yes). Film-agnostic: any tool
that must pick or check something from text imports it, e.g. clip-catalog/catalog.py ranks clips with it.
    from jev import Jev
    answers = Jev().ask("state text", {"q": {"type": "noul", "instructions": "...", "criteria": {"true": "...", "false": "..."}}})
"""
import json, os, sys, threading, time, urllib.error, urllib.request
from pathlib import Path


def secret(env, file):
    f = Path.home() / ".secrets" / file
    return os.environ.get(env) or (f.read_text().split("=", 1)[1].strip() if f.exists() else None)


# Jev routes, tried in order: OpenCode Zen's free one (a daily quota: 429 FreeUsageLimitError, back in hours), then
# OpenRouter's paid one ($0.042 per million input tokens: a whole-catalogue search ~$0.002, ~$0.01 with --timeline).
# Keys live in ~/.secrets/<file> or the env var, never in the repo. Inputs may be kept by the provider: scene words only.
ROUTES = [("OpenCode Zen free", "https://opencode.ai/zen/v1/systemone", "jev-1.13-free", "OPENCODE_API_KEY", "opencode_zen.env"),
          ("OpenRouter (paid)", "https://openrouter.ai/api/v1/systemone", "typesafe/jev-1.14", "OPENROUTER_API_KEY", "openrouter.env")]
SPEND_CAP = 0.05  # USD per run on a paid route: a run past it stops, as a runaway loop would


class Jev:
    """Calls Jev (TypeSafe System One, docs.typesafe.ai) on the first route in ROUTES that still has quota, adding up
    what the paid route costs. Thread-safe: the heats run in parallel."""

    def __init__(self):
        self.routes = [r for r in ROUTES if secret(*r[3:])]
        self.spent, self.lock = 0.0, threading.Lock()

    def ask(self, state, questions):
        while self.routes:
            route = self.routes[0]
            name, url, model, env, file = route
            # Cloudflare in front of Zen refuses Python's default User-Agent (error 1010)
            req = urllib.request.Request(url, data=json.dumps({"model": model, "state": state, "questions": questions}).encode(),
                headers={"Authorization": f"Bearer {secret(env, file)}", "Content-Type": "application/json", "User-Agent": "mc-films-jev/1"})
            # 429 with a short Retry-After is a burst limit: wait it out; with hours (the free quota spent): next route
            for wait in [5, 10, 20, 40, 80, 160, 0]:
                try:
                    res = json.load(urllib.request.urlopen(req, timeout=120))
                    with self.lock:
                        self.spent += res.get("usage", {}).get("cost") or 0
                        if self.spent > SPEND_CAP:
                            sys.exit(f"Jev: stopped at ${self.spent:.4f}, past SPEND_CAP ${SPEND_CAP}")
                        self.used = name
                    return res["answers"]
                except urllib.error.HTTPError as e:
                    after = float(e.headers.get("Retry-After") or wait)
                    if e.code != 429 or not wait:
                        raise
                    if after > 300:
                        with self.lock:
                            if self.routes and self.routes[0] is route:
                                print(f"Jev: {name} quota spent, back in {after / 3600:.1f} h", file=sys.stderr)
                                self.routes.pop(0)
                        break
                    time.sleep(after)
        sys.exit("Jev: no route left (keys in ~/.secrets: opencode_zen.env, openrouter.env); ")
