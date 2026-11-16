from PIL import Image, ImageChops
from pathlib import Path
root=Path('scripts/evals/load/runs');a=root/'2026-11-16T17-45-29-604Z';b=root/'2026-11-16T17-51-13-699Z'
for p in ['desk','phone']:
 for t in [0,2.4,4.7,8.2,10.5,13.2]:
  n=f'{p}-at-{t}.png';x=Image.open(a/n).convert('RGB');y=Image.open(b/n).convert('RGB')
  if x.size!=y.size: print(n,'size',x.size,y.size);continue
  diff=ImageChops.difference(x,y); h=diff.histogram(); count=sum(max(v) != 0 for v in diff.getdata());print(n,x.size,'pixels',count,'bbox',diff.getbbox(),'max',max(i%256 for i,n in enumerate(h) if n))
