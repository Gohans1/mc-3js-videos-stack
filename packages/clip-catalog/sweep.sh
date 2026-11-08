# Retarget health of every clip of the motion libraries: clip-catalog/mocap.ts's numbers (worst frame of each check: joint
# jumps and spins the source doesn't make, hands or knees inside him, sinking, floating...) appended to
# vault/motion/catalog/sweep_<lib>.jsonl (the tag readers skip sweep_ files), one ROW per clip; python ../../packages/clip-catalog/sweep_report.py ranks them.
# Resumable: a clip already in the file is skipped; chunks of 20 capped at 600 s. ~2 s a clip.
# Run from a film folder (it renders on the studio's page): bash ../../packages/clip-catalog/sweep.sh [lib ...] (default: mixamo)
HERE=$(dirname "$0")
M=$HERE/../../vault/motion
for lib in ${@:-mixamo}; do
  OUT=$M/catalog/sweep_$lib.jsonl
  touch $OUT
  todo=$(python - "$lib" "$OUT" "$M/" <<'PY'
import json, struct, sys
lib, out, M = sys.argv[1:]
if lib == 'mixamo':
    names = json.load(open(M + 'mixamo/_tools/clips.json'))
else:
    f = {'ual1': 'ual1/AnimationLibrary_Godot_Standard.gltf', 'ual2': 'ual2/UAL2_Standard.glb'}[lib]
    raw = open(M + f, 'rb').read()
    g = json.loads(raw[20:20 + struct.unpack('<I', raw[12:16])[0]] if raw[:4] == b'glTF' else raw)
    names = [a['name'] for a in g['animations']]
done = {json.loads(l)['clip'] for l in open(out) if l.strip()}
print(' '.join(x for x in names if x not in done))
PY
)
  read -ra A <<< "$todo"
  echo "$lib: ${#A[@]} to sweep"
  for ((i=0; i<${#A[@]}; i+=20)); do
    list=$(IFS=,; echo "${A[*]:i:20}")
    ENTRY=$HERE/mocap.ts LAB_LIB=$lib LAB_CLIPS=$list timeout 600 bun run render stills 2>&1 | grep "^ROW " | cut -c5- >> $OUT
    echo "$lib: $(wc -l < $OUT) swept"
  done
done
echo SWEEP DONE
