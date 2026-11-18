"""Jev (TypeSafe System One, docs.typesafe.ai): a small judge model that answers typed questions about a text state:
Choice (one option of up to 255, a probability each) and Noul (yes/no, the probability of yes). Film-agnostic: any tool
that must pick or check something from text imports it, e.g. clip-catalog/catalog.py ranks clips with it.
    from jev import Jev
    answers = Jev().ask("state text", {"q": {"type": "noul", "instructions": "...", "criteria": {"true": "...", "false": "..."}}})
"""
import email.utils, http.client, json, math, os, re, sys, threading, time, urllib.error, urllib.request
from pathlib import Path


def keys(env, file):
    """A route's keys: the env var (several split by commas or spaces), else ~/.secrets/<file>, one per line as
    NAME=key or the bare key."""
    if os.environ.get(env):
        raw = re.split(r"[,\s]+", os.environ[env])
    else:
        f = Path.home() / ".secrets" / file
        raw = [l.split("=", 1)[-1] for l in f.read_text(encoding="utf-8").splitlines() if l.strip() and not l.lstrip().startswith("#")] if f.exists() else []
    return list(dict.fromkeys(k.strip() for k in raw if k.strip()))


# Jev routes, tried in order: OpenCode Zen's free one (a daily quota per network, not per key: every key from one egress
# IP shares it, back at 00:00 UTC; 429 FreeUsageLimitError), then OpenRouter's paid one ($0.042 per million input tokens:
# a whole-catalogue search ~$0.002, ~$0.01 with --timeline). Keys live in ~/.secrets/<file> or the env var, never in the
# repo; a route's next key only stands in for one it refuses. Inputs may be kept by the provider: scene words only.
ROUTES = [("OpenCode Zen free", "https://opencode.ai/zen/v1/systemone", "jev-1.13-free", "OPENCODE_API_KEY", "opencode_zen.env"),
          ("OpenRouter (paid)", "https://openrouter.ai/api/v1/systemone", "typesafe/jev-1.14", "OPENROUTER_API_KEY", "openrouter.env")]
SPEND_CAP = 0.05  # USD per run on a paid route: a run past it stops, as a runaway loop would


# Each call is its own process (jev.ts spawns one per question), so when a route's quota is back is kept on disk:
# {route name: back at, epoch s}. Later runs try that route only after every other.
def spent_file():
    return Path.home() / ".cache" / "mc-films" / "jev-quota.json"


def read_spent():
    try:
        return json.loads(spent_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def retry_after(value, wait):
    """Retry-After is seconds or an HTTP date (RFC 9110); one it cannot read (or below 0, or not finite) waits the
    loop's own wait."""
    if not value:
        return wait
    try:
        s = float(value)
        return s if math.isfinite(s) and s >= 0 else wait
    except ValueError:
        pass
    try:
        return max(0.0, email.utils.parsedate_to_datetime(value).timestamp() - time.time())
    except (TypeError, ValueError):
        return wait


class Jev:
    """Calls Jev (TypeSafe System One, docs.typesafe.ai) on the first route in ROUTES that still has quota (those last
    seen spent go last), with its first key the route accepts. Adds up what the paid route costs. Thread-safe: the heats
    run in parallel."""

    def __init__(self, options=None):
        options = options or {}
        self.options, self.trace = options, []
        now, back = time.time(), read_spent()
        tries = [(name, url, model, key, i + 1, len(ks)) for name, url, model, env, file in ROUTES
                 if options.get("route", "auto") == "auto" or (options.get("route") == "free") == ("free" in name)
                 for ks in [keys(env, file)] for i, key in enumerate(ks)]
        self.routes = sorted(tries, key=lambda r: back.get(r[0], 0) > now)
        self.keyed = bool(self.routes)
        self.spent, self.lock = 0.0, threading.Lock()

    def ask(self, state, questions):
        while True:
            # another heat may drop the last route between a check and a read
            with self.lock:
                if not self.routes:
                    break
                route = self.routes[0]
            name, url, model, key, i, n = route
            model = self.options.get("freeModel" if "free" in name else "paidModel") or model
            # Cloudflare in front of Zen refuses Python's default User-Agent (error 1010)
            req = urllib.request.Request(url, data=json.dumps({"model": model, "state": state, "questions": questions}).encode(),
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "mc-films-jev/1"})
            # 429 with a short Retry-After is a burst limit: wait it out; with hours (the quota spent): the next route
            for wait in [5, 10, 20, 40, 80, 160, 0]:
                try:
                    res = json.load(urllib.request.urlopen(req, timeout=120))
                    with self.lock:
                        self.spent += (res.get("usage") or {}).get("cost") or 0
                        cap = self.options.get("spendCap", SPEND_CAP)
                        self.trace.append({"phase": "response", "route": name, "request": {"model": model, "state": state, "questions": questions}, "answers": res["answers"], "usage": (res.get("usage") or {}), "cost": (res.get("usage") or {}).get("cost")})
                        if self.spent > cap:
                            sys.exit(f"Jev: stopped at ${self.spent:.4f}, past SPEND_CAP ${cap}")
                        self.used = name
                    return res["answers"]
                except urllib.error.HTTPError as e:
                    after = retry_after(e.headers.get("Retry-After"), wait)
                    if e.code in (401, 403):
                        with self.lock:
                            if self.routes and self.routes[0] is route:
                                print(f"Jev: {name}{f' key {i} of {n}' if n > 1 else ''} refused ({e.code}): a wrong or revoked key",
                                      file=sys.stderr)
                                self.routes.pop(0)
                        break
                    # a server fault (5xx) passes like a burst: one lost answer would throw away every heat paid before it
                    if e.code == 429 and after > 300:
                        with self.lock:
                            if any(r[0] == name for r in self.routes):
                                back = read_spent()
                                back[name] = time.time() + after
                                spent_file().parent.mkdir(parents=True, exist_ok=True)
                                tmp = spent_file().with_suffix(f".{os.getpid()}.tmp")
                                tmp.write_text(json.dumps(back), encoding="utf-8")
                                tmp.replace(spent_file())
                                print(f"Jev: {name} quota spent, back in {after / 3600:.1f} h", file=sys.stderr)
                                self.routes = [r for r in self.routes if r[0] != name]
                        break
                    if (e.code != 429 and e.code < 500) or not wait:
                        raise
                    time.sleep(after)
                # a connection dropped mid-answer or malformed 200 payload is retried cleanly
                except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException, ValueError, KeyError):
                    if not wait:
                        raise
                    time.sleep(wait)
        sys.exit("Jev: every route has spent its quota (the lines above say when each is back). Zen's free quota is per "
                 "network, so more Zen keys on this machine do not help; OpenRouter credit does: OPENROUTER_API_KEY in "
                 "~/.secrets/openrouter.env" if self.keyed else
                 "Jev: no key: OPENCODE_API_KEY in ~/.secrets/opencode_zen.env (free, a daily quota) or OPENROUTER_API_KEY in "
                 "~/.secrets/openrouter.env (paid)")


if __name__ == "__main__":
    # A pipe for tools in other languages (scripts/find.ts): {"state": ..., "questions": {...}} on stdin, the answers on stdout
    req = json.load(sys.stdin)
    jev = Jev(req.get("options"))
    answers = jev.ask(req["state"], req["questions"])
    print(json.dumps({"answers": answers, "trace": jev.trace} if req.get("trace") else answers))
