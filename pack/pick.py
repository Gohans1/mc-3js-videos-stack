"""Cherry-picks blocks from the vetted packs in E:/mc_vault/packs into assets/public/picked.zip, a resource pack the page
stacks between the film's own pack and client.jar (src/scene.ts). Each pick keeps its pack's namespace, so ids, models and
textures stay exactly as their authors wrote them; the zip holds only what the picked blockstates reach (models, their
parents, textures and .mcmeta), a few KB instead of whole mod jars. picked.json beside this script records the source,
licence and link of every pick. Re-run after editing PICKS: python pack/pick.py"""
import json
import zipfile
from pathlib import Path

VAULT = Path("E:/mc_vault/packs")
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/public/picked.zip"

# jar in E:/mc_vault/packs -> (namespace, block ids, licence, page)
PICKS = {
    "nhatjs-furniture-mod.jar": ("js_furniture_mod", ["black_chair"], "MIT", "https://modrinth.com/mod/nhatjs-furniture-mod"),
    "hospitals.jar": ("hospitals", ["chair"], "MIT", "https://modrinth.com/mod/hospitals"),
    "modern-furniture.jar": ("modernfurniture", ["office_chair", "wood_chair_b"], "CC-BY-4.0 (credit the author)", "https://modrinth.com/mod/modern-furniture"),
}


def ref(ns, r, kind):
    """'ns:block/x' or 'block/x' -> zip path of a model or texture; None for the game's own (client.jar has them)."""
    space, _, name = r.partition(":") if ":" in r else ("minecraft", "", r)
    if space == "minecraft":
        return None
    return f"assets/{space}/{kind}/{name}" + (".json" if kind == "models" else ".png")


def main():
    files, log = {}, []
    for jar, (ns, ids, licence, page) in PICKS.items():
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
                log.append({"id": f"{ns}:{i}", "jar": jar, "licence": licence, "page": page})
    files["pack.mcmeta"] = json.dumps({"pack": {"pack_format": 75, "description": "Blocks picked from E:/mc_vault/packs (pack/pick.py)"}}).encode()
    tmp = OUT.with_suffix(".zip.new")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
        for path in sorted(files):
            out.writestr(zipfile.ZipInfo(path, (2026, 1, 1, 0, 0, 0)), files[path], zipfile.ZIP_DEFLATED)
    tmp.replace(OUT)
    (ROOT / "pack/picked.json").write_text(json.dumps(log, indent=1) + "\n", encoding="utf8", newline="\n")
    print(f"{OUT.relative_to(ROOT)}: {len(files)} files, {OUT.stat().st_size / 1e3:.0f} KB; {len(log)} blocks")


main()
