from PIL import Image,ImageDraw
from pathlib import Path
import sys
r=Path(__file__).resolve().parents[1]
ids=sys.argv[2:];batch=sys.argv[1]
for mounted in (False,True):
 out=Image.new('RGB',(1280,350*len(ids)),'#eeeeee');d=ImageDraw.Draw(out)
 for row,id in enumerate(ids):
  for col,a in enumerate([0,45,90,180] if mounted else ['front','quarter','side','back']):
   p=r/'renders'/(f'mounted-{id}-{a}/0000.png' if mounted else f'{id}-{a}.png')
   if not p.exists():continue
   im=Image.open(p).convert('RGBA');im.thumbnail((320,320));out.paste(im,(320*col,350*row),im);d.text((320*col+10,350*row+325),f'{id} {a}',fill='black')
 out.save(r/'renders'/(f'{batch}-'+('mounted' if mounted else 'isolated')+'.png'))
