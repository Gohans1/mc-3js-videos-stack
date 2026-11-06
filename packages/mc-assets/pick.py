"""Cherry-picks blocks from the vetted mod packs in the vault (vault/packs) into the film's assets/public/picked.zip, a
resource pack the page stacks between the props and client.jar. Each pick keeps its pack's namespace, so ids, models and
textures stay exactly as their authors wrote them; the zip holds only what the picked blockstates reach (models, their
parents, textures and .mcmeta), a few KB instead of whole mod jars. The film's pack/picks.json lists the picks with each
jar's licence and page (credit what asks for it): [{"jar", "namespace", "blocks": [ids], "licence", "page"}].
Run in the film folder after editing picks.json: python ../../packages/mc-assets/pick.py"""
import json
import zipfile
from pathlib import Path

VAULT = Path(__file__).resolve().parents[2] / "vault/packs"
PICKS = Path("pack/picks.json")
OUT = Path("assets/public/picked.zip")


def ref(ns, r, kind):
    """'ns:block/x' or 'block/x' -> zip path of a model or texture; None for the game's own (client.jar has them)."""
    space, _, name = r.partition(":") if ":" in r else ("minecraft", "", r)
    if space == "minecraft":
        return None
    return f"assets/{space}/{kind}/{name}" + (".json" if kind == "models" else ".png")


def main():
    files, picks = {}, json.loads(PICKS.read_text(encoding="utf-8"))
    for pick in picks:
        jar, ns, ids = pick["jar"], pick["namespace"], pick["blocks"]
        with zipfile.ZipFile(VAULT / jar) as z:
            have = set(z.namelist())

            def take(path):
                if path in files:
                    return True
                if path not in have:
                    return False
                files[path] = z.read(path)
                if path.endswith(".png") and path + ".mcmeta" in have:
                    files[path + ".mcmeta"] = z.read(path + ".mcmeta")
                return True

            def model(path):
                if path is None or path in files or not take(path):
                    return
                m = json.loads(files[path])
                if "parent" in m:
                    model(ref(ns, m["parent"], "models"))
                for t in m.get("textures", {}).values():
                    if not t.startswith("#"):
                        tp = ref(ns, t, "textures")
                        if tp and not take(tp):
                            raise SystemExit(f"{jar}: texture {t} missing ({tp})")

            for i in ids:
                state = f"assets/{ns}/blockstates/{i}.json"
                if not take(state):
                    raise SystemExit(f"{jar}: no blockstate {state}")
                s = json.loads(files[state])
                for v in list(s.get("variants", {}).values()) + [p["apply"] for p in s.get("multipart", [])]:
                    for one in v if isinstance(v, list) else [v]:
                        model(ref(ns, one["model"], "models"))
    files["pack.mcmeta"] = json.dumps({"pack": {"pack_format": 75, "description": "Blocks picked from the vault's mod packs (mc-assets/pick.py)"}}).encode()
    tmp = OUT.with_suffix(".zip.new")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
        for path in sorted(files):
            out.writestr(zipfile.ZipInfo(path, (2026, 1, 1, 0, 0, 0)), files[path], zipfile.ZIP_DEFLATED)
    tmp.replace(OUT)
    print(f"{OUT}: {len(files)} files, {OUT.stat().st_size / 1e3:.0f} KB; {sum(len(p['blocks']) for p in picks)} blocks")


main()
