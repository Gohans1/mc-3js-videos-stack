"""Jev (TypeSafe System One, docs.typesafe.ai): a small judge model that answers typed questions about a text state:
Choice (one option of up to 255, a probability each) and Noul (yes/no, the probability of yes). Film-agnostic: any tool
that must pick or check something from text imports it, e.g. clip-catalog/catalog.py ranks clips with it.
    from jev import Jev
    answers = Jev().ask("state text", {"q": {"type": "noul", "instructions": "...", "criteria": {"true": "...", "false": "..."}}})
"""
import hashlib, json, os, re, sys, threading, time, urllib.error, urllib.request
from pathlib import Path


def keys(env, file):
    """A route's keys: the env var (several split by commas or spaces), else ~/.secrets/<file>, one per line as
    NAME=key or the bare key."""
    if os.environ.get(env):
        raw = re.split(r"[,\s]+", os.environ[env])
    else:
        f = Path.home() / ".secrets" / file
        raw = [l.split("=", 1)[-1] for l in f.read_text().splitlines() if l.strip() and not l.lstrip().startswith("#")] if f.exists() else []
    return list(dict.fromkeys(k.strip() for k in raw if k.strip()))


# Jev routes, tried in order: OpenCode Zen's free one (a daily quota per key: 429 FreeUsageLimitError, back in hours), then
# OpenRouter's paid one ($0.042 per million input tokens: a whole-catalogue search ~$0.002, ~$0.01 with --timeline).
# Keys live in ~/.secrets/<file> or the env var, never in the repo. Inputs may be kept by the provider: scene words only.
ROUTES = [("OpenCode Zen free", "https://opencode.ai/zen/v1/systemone", "jev-1.13-free", "OPENCODE_API_KEY", "opencode_zen.env"),
          ("OpenRouter (paid)", "https://openrouter.ai/api/v1/systemone", "typesafe/jev-1.14", "OPENROUTER_API_KEY", "openrouter.env")]
SPEND_CAP = 0.05  # USD per run on a paid route: a run past it stops, as a runaway loop would


# Each call is its own process (jev.ts spawns one per question), so when a key's quota is spent is kept on disk, by a hash
# of the key: {hash: back at, epoch s}. Later runs try such a key only after every other.
def spent_file():
    return Path.home() / ".cache" / "mc-films" / "jev-spent.json"


def key_id(key):
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def read_spent():
    try:
        return json.loads(spent_file().read_text())
    except (OSError, ValueError):
        return {}


class Jev:
    """Calls Jev (TypeSafe System One, docs.typesafe.ai) with the first key that still has quota: every key of each route
    in ROUTES in order, then the keys last seen spent. Adds up what the paid route costs. Thread-safe: the heats run in
    parallel."""

    def __init__(self):
        now, back = time.time(), read_spent()
        tries = [(name, url, model, key, i + 1, len(ks)) for name, url, model, env, file in ROUTES
                 for ks in [keys(env, file)] for i, key in enumerate(ks)]
        self.routes = sorted(tries, key=lambda r: back.get(key_id(r[3]), 0) > now)
        self.keyed = bool(self.routes)
        self.spent, self.lock = 0.0, threading.Lock()

    def drop(self, route, why):
        with self.lock:
            if self.routes and self.routes[0] is route:
                name, _, _, _, i, n = route
                print(f"Jev: {name}{f' key {i} of {n}' if n > 1 else ''} {why}", file=sys.stderr)
                self.routes.pop(0)

    def ask(self, state, questions):
        while self.routes:
            route = self.routes[0]
            name, url, model, key, _, _ = route
            # Cloudflare in front of Zen refuses Python's default User-Agent (error 1010)
            req = urllib.request.Request(url, data=json.dumps({"model": model, "state": state, "questions": questions}).encode(),
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "mc-films-jev/1"})
            # 429 with a short Retry-After is a burst limit: wait it out; with hours (the quota spent): the next key
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
                    if e.code in (401, 403):
                        self.drop(route, f"refused ({e.code}): a wrong or revoked key")
                        break
                    if e.code != 429 or not wait:
                        raise
                    if after > 300:
                        with self.lock:
                            back = read_spent()
                            back[key_id(key)] = time.time() + after
                            spent_file().parent.mkdir(parents=True, exist_ok=True)
                            tmp = spent_file().with_suffix(f".{os.getpid()}.tmp")
                            tmp.write_text(json.dumps(back))
                            tmp.replace(spent_file())
                        self.drop(route, f"quota spent, back in {after / 3600:.1f} h")
                        break
                    time.sleep(after)
        sys.exit("Jev: every key has spent its quota (the lines above say when each is back); add more keys, one per line, "
                 "to ~/.secrets/opencode_zen.env (free) or ~/.secrets/openrouter.env (paid)" if self.keyed else
                 "Jev: no key: OPENCODE_API_KEY in ~/.secrets/opencode_zen.env (free, a daily quota) or OPENROUTER_API_KEY in "
                 "~/.secrets/openrouter.env (paid)")


if __name__ == "__main__":
    # A pipe for tools in other languages (scripts/find.ts): {"state": ..., "questions": {...}} on stdin, the answers on stdout
    req = json.load(sys.stdin)
    print(json.dumps(Jev().ask(req["state"], req["questions"])))
