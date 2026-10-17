from pathlib import Path
import json,hashlib,sys
from PIL import Image,ImageDraw,ImageFont
import numpy as np
from face_library import STATES
P=Path(__file__).resolve().parent;OUT=P/'review';OUT.mkdir(exist_ok=True)
V=['front','quarter','opposite','side'];BG=(239,236,232);F='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
# A single full-body crop and scale per camera for every semantic face; no expression fitting.
boxes={}
for v in V:
 im=Image.open(P/f'renders/Basis-0.00-{v}.png').convert('RGBA');a=np.asarray(im);y,x=np.where(a[:,:,3]>64);boxes[v]=(int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1))
def pic(st,t,v,h):
 im=Image.open(P/f'renders/{st}-{t:.2f}-{v}.png').convert('RGBA').crop(boxes[v]);return im.resize((round(im.width*h/im.height),h),Image.Resampling.LANCZOS)
def grid(file,rows,h,title):
 cw=165 if h==99 else 426;ch=h+34;font=ImageFont.truetype(F,12 if h==99 else 18)
 out=Image.new('RGB',(len(rows[0])*cw,len(rows)*ch+36),BG);d=ImageDraw.Draw(out);d.text((10,9),title,font=font,fill=(45,43,41))
 for ri,row in enumerate(rows):
  for ci,(st,t,v,label) in enumerate(row):
   im=pic(st,t,v,h);x=ci*cw+(cw-im.width)//2;y=36+ri*ch;out.paste(im,(x,y),im);d.text((ci*cw+8,y+h+6),label,font=font,fill=(45,43,41))
 out.save(OUT/file)
for v in V:
 rows=[[(st,1,v,st) for st in STATES[i:i+6]] for i in range(0,18,6)]
 for h,tag in [(99,'native99'),(295,'large')]:grid(f'library18-{v}-{tag}.png',rows,h,f'Merged approved static library | {v} | 18 slots')
for h,tag in [(99,'native99'),(295,'large')]:
 grid(f'Basis-fourview-{tag}.png',[[("Basis",0,v,v) for v in V]],h,'All layers at zero: original small-O Basis')
 if '--endpoints-only' not in sys.argv:
  rows=[[(st,.5,v,f'{st} .5 | {v}') for v in V] for st in ['04','N3','A7','07','S5','R0','N2']]
  grid(f'slice7-midpoint-fourview-{tag}.png',rows,h,'Representative merged paths | half intensity | same frozen look')
# Explicit empty-state / current neutral semantic distinction.
for h,tag in [(99,'native99'),(295,'large')]:
 grid(f'Basis-vs-R0-{tag}.png',[[('Basis',0,'front','Basis: original small O'),('R0',1,'front','R0: short horizontal')]],h,'Two distinct states; no replacement of Basis')
(P/'REVIEW-MANIFEST.json').write_text(json.dumps({'fixedCropPerView':boxes,'scale':'99 or295 pixels high using the neutral full-body silhouette, never refitted per face','files':[{'file':str(f.relative_to(P)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(OUT.glob('*.png'))]},indent=2))
print('Review boards complete')
