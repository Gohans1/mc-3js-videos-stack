# Renders clip-catalog/catalog_sheet.ts's still for every clip the finder can return (weapons and fights left out, as
# clip-catalog/catalog.py does) into vault/motion/catalog/sheets/, then clip-catalog/catalog_review.py makes the review pages. Resumable: a clip
# with a sheet already is skipped; chunks of 40 capped at 600 s. ~1 s a clip.
# Run from a film folder (it renders on the studio's page): bash ../../packages/clip-catalog/catalog_review.sh
HERE=$(dirname "$0")
SHEETS=$HERE/../../vault/motion/catalog/sheets
mkdir -p $SHEETS
for lib in mixamo ual1 ual2; do
  todo=$(PYTHONPATH=$HERE python - "$lib" <<'PY'
import json, sys
from catalog import FIGHT, ROOT
lib = sys.argv[1]
names = [json.loads(l)['ref'].split('/', 1)[1] for l in open(ROOT / f'catalog/{lib}.jsonl') if l.strip()]
print(' '.join(x for x in names if not FIGHT.search(x) and not (ROOT / f'catalog/sheets/{lib}__{x}.jpg').exists()))
PY
)
  read -ra A <<< "$todo"
  echo "$lib: ${#A[@]} sheets to render"
  for ((i=0; i<${#A[@]}; i+=40)); do
    list=$(IFS=,; echo "${A[*]:i:40}")
    ENTRY=$HERE/catalog_sheet.ts LAB_LIB=$lib LAB_CLIPS=$list timeout 600 bun run render stills 2>&1 | grep "SHEET FAIL"
    for f in renders/sheet_${lib}__*.jpg; do [ -e "$f" ] && mv "$f" "$SHEETS/${f#renders/sheet_}"; done
    echo "$lib: $(ls $SHEETS | grep -c "^${lib}__") sheets"
  done
done
echo SHEETS DONE
