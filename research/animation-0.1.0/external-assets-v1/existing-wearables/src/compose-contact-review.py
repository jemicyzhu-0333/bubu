from PIL import Image,ImageDraw
from pathlib import Path
import json
from portable_paths import P;items=json.loads((P/'reports/contact-keyframe-index.json').read_text());canvas=Image.new('RGB',(1536,2160),(240,237,231));draw=ImageDraw.Draw(canvas)
for row,kind in enumerate(['satchel','scarf']):
 for yawIndex,yaw in enumerate([0,45]):
  y=(row*2+yawIndex)*540
  for column,phase in enumerate(['first','max','raised_cup']):
   x=column*512;im=Image.open(P/f'review/contact-renders/{kind}-{phase}-{yaw}/0000.png').convert('RGBA');canvas.paste(im,(x,y),im);r=next(i for i in items if i['kind']==kind and i['case']==phase);draw.text((x+8,y+512),f'{kind}: {phase} t={r["time"]:.3f}s, yaw{yaw} | CPU 64 samples',fill=(30,30,30));draw.text((x+8,y+525),'Left palm: pouch/flap; right palm: strap' if kind=='satchel' else 'Both palms: collar crossing seams; raised cup: clear',fill=(30,30,30))
canvas.save(P/'review/tea-contact-actual-sheet.png')
