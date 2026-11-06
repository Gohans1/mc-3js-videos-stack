# Renders lab/catalog_sheet.ts's still for every clip the finder can return (weapons and fights left out, as
# lab/catalog.py does) into renders/catalog_sheets/, then lab/catalog_review.py makes the review pages. Resumable: a clip
# with a sheet already is skipped; chunks of 40 capped at 600 s. ~1 s a clip.
# bash lab/catalog_review.sh
cd "$(dirname "$0")/.."
mkdir -p renders/catalog_sheets
for lib in mixamo ual1 ual2; do
  todo=$(python - "$lib" <<'PY'
import json, os, sys
sys.path.insert(0, 'lab')
from catalog import FIGHT
lib = sys.argv[1]
names = [json.loads(l)['ref'].split('/', 1)[1] for l in open(f'E:/mc_vault/motion/catalog/{lib}.jsonl') if l.strip()]
print(' '.join(x for x in names if not FIGHT.search(x) and not os.path.exists(f'renders/catalog_sheets/{lib}__{x}.jpg')))
PY
)
  read -ra A <<< "$todo"
  echo "$lib: ${#A[@]} sheets to render"
  for ((i=0; i<${#A[@]}; i+=40)); do
    list=$(IFS=,; echo "${A[*]:i:40}")
    ENTRY=lab/catalog_sheet.ts LAB_LIB=$lib LAB_CLIPS=$list timeout 600 bun run render stills 2>&1 | grep "SHEET FAIL"
    for f in renders/sheet_${lib}__*.jpg; do [ -e "$f" ] && mv "$f" "renders/catalog_sheets/${f#renders/sheet_}"; done
    echo "$lib: $(ls renders/catalog_sheets | grep -c "^${lib}__") sheets"
  done
done
echo SHEETS DONE
