"""Writes assets/public/mc/client_assets.zip: client.jar without its Java code (.class, META-INF), 12 MB instead of 41 (about 7
on the wire, the studio compresses it). The page downloads it on every first visit, phones over Tailscale too. Run it again after
replacing client.jar. Mojang's files: stays on this PC, like the jar. mc/ is a junction to E:/mc_vault/jar, so the zip lands
in the vault beside the jar; mc-asset-browser reads it from there too.

data/ stays although block-model-renderer never reads from it (logged every read and listing on 2026-11-05): without
data/minecraft/structure, one wall edge at 18.5 s drew 1 px off (14 pixels, the same on every load). With it, every frame
matches the jar exactly. Test any further trimming that way: same frame, jar vs zip, pixel by pixel."""
import sys
import zipfile
from pathlib import Path

MC = Path(__file__).parent / "assets/public/mc"
JAR, OUT = MC / "client.jar", MC / "client_assets.zip"

if OUT.exists() and OUT.stat().st_mtime >= JAR.stat().st_mtime and "--force" not in sys.argv:
    sys.exit(f"{OUT.name} is newer than {JAR.name}; --force to rebuild")
tmp = OUT.with_suffix(".zip.new")
with zipfile.ZipFile(JAR) as jar, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
    for e in jar.infolist():
        if e.is_dir() or e.filename.endswith(".class") or e.filename.startswith("META-INF/"):
            continue
        if e.filename.startswith(("assets/", "data/")) or "/" not in e.filename:
            out.writestr(zipfile.ZipInfo(e.filename, e.date_time), jar.read(e), zipfile.ZIP_DEFLATED)
tmp.replace(OUT)
print(f"{OUT}: {OUT.stat().st_size / 1e6:.1f} MB (jar {JAR.stat().st_size / 1e6:.1f} MB)")
