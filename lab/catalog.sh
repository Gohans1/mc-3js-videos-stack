# Tags every clip of the motion libraries with lab/catalog.ts into E:/mc_vault/motion/catalog/<lib>.jsonl (one JSON line
# per clip). Resumable: a clip already in the file is skipped, so after a stop or a new Mixamo download just run it again;
# each chunk of 40 is capped (timeout) so one stuck clip can't hold the run. To re-tag after changing catalog.ts, delete
# the files. Clip names: Mixamo's clips.json, the glTF libraries' own animation lists (src/clips.ts GLTF_LIBS files).
# bash lab/catalog.sh [lib ...]   (default: mixamo ual1 ual2; ~1.5 s a clip)
cd "$(dirname "$0")/.."
OUT=E:/mc_vault/motion/catalog
mkdir -p $OUT
for lib in ${@:-mixamo ual1 ual2}; do
  touch $OUT/$lib.jsonl
  todo=$(python - "$lib" "$OUT/$lib.jsonl" <<'PY'
import json, struct, sys
lib, out = sys.argv[1:]
M = 'E:/mc_vault/motion/'
if lib == 'mixamo':
    names = json.load(open(M + 'mixamo/_tools/clips.json'))
else:
    f = {'ual1': 'ual1/AnimationLibrary_Godot_Standard.gltf', 'ual2': 'ual2/UAL2_Standard.glb'}[lib]
    raw = open(M + f, 'rb').read()
    g = json.loads(raw[20:20 + struct.unpack('<I', raw[12:16])[0]] if raw[:4] == b'glTF' else raw)
    names = [a['name'] for a in g['animations']]
done = {json.loads(l)['ref'] for l in open(out) if l.strip()}
print(' '.join(x for x in names if f'{lib}/{x}' not in done))
PY
)
  read -ra A <<< "$todo"
  echo "$lib: ${#A[@]} to tag"
  for ((i=0; i<${#A[@]}; i+=40)); do
    list=$(IFS=,; echo "${A[*]:i:40}")
    ENTRY=lab/catalog.ts LAB_LIB=$lib LAB_CLIPS=$list timeout 600 bun run render stills 2>&1 | grep "^ROW " | cut -c5- >> $OUT/$lib.jsonl
    echo "$lib: $(wc -l < $OUT/$lib.jsonl) tagged"
  done
done
echo CATALOG DONE
