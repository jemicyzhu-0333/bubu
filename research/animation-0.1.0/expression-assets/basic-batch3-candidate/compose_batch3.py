from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import numpy as np,json,os
P=Path(__file__).parent
BG=(239,236,232);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
def bounds(im,source=False):
 a=np.array(im.convert('RGBA'))
 if source: m=(a[:,:,0].astype(float)-a[:,:,1]>22)&(a[:,:,0].astype(float)-a[:,:,2]>16)&(a[:,:,0]>140)
 else:m=a[:,:,3]>64
 yy,xx=np.where(m);return (int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1))
def placed(im,height,source=False):
 bb=bounds(im,source);c=im.crop(bb).convert('RGBA');c=c.resize((round(c.width*height/c.height),height),Image.Resampling.LANCZOS);return c
cases=['N3','T05']
for h,tag in [(295,'large'),(99,'native99')]:
 cw=426 if h==295 else 170;ch=h+70;out=Image.new('RGB',(cw*3,ch*len(cases)+38),BG);d=ImageDraw.Draw(out);d.text((14,8),'Reference | actual 3D front | actual 3D quarter  (same character height)',font=font if h==295 else small,fill=(50,48,46))
 for ri,st in enumerate(cases):
  files=[P/'references'/f'{st}.png',P/f'basic-{st}-1.00-front.png',P/f'basic-{st}-1.00-quarter.png']
  for ci,f in enumerate(files):
   c=placed(Image.open(f),h,ci==0);x=cw*ci+(cw-c.width)//2;y=38+ri*ch+18;out.paste(c,(x,y),c);d.text((cw*ci+12,y+h+10),st+(' source' if ci==0 else ' actual'),font=font if h==295 else small,fill=(50,48,46))
 out.save(P/f'source-actual-{tag}.png')
# Unlabeled actual front and quarter, fixed99px body height, no semantic caption.
out=Image.new('RGB',(len(cases)*160,2*130),BG)
for ri,v in enumerate(['front','quarter']):
 for ci,st in enumerate(cases):
  c=placed(Image.open(P/f'basic-{st}-1.00-{v}.png'),99);out.paste(c,(ci*160+(160-c.width)//2,ri*130+15),c)
out.save(P/'actual-blind-native99.png')
if True:
 for st in cases:
  if os.environ.get('ONLY_STATE') and st!=os.environ['ONLY_STATE']:continue
  if not all((P/f'basic-{st}-{t:.2f}-{v}.png').exists() for t in [.25,.5,.75] for v in ['front','quarter','opposite','side']):continue
  for h,tag in [(295,'large'),(99,'native99')]:
   cw=426 if h==295 else 164;ch=h+45;out=Image.new('RGB',(5*cw,4*ch),BG);d=ImageDraw.Draw(out)
   for ri,v in enumerate(['front','quarter','opposite','side']):
    for ci,t in enumerate([0,.25,.5,.75,1]):
     f=P/f'basic-{st if t else "N3"}-{t:.2f}-{v}.png';c=placed(Image.open(f),h);x=ci*cw+(cw-c.width)//2;y=ri*ch+12;out.paste(c,(x,y),c);d.text((ci*cw+8,y+h+8),f'{v}  {t:g}',font=font if h==295 else small,fill=(50,48,46))
   out.save(P/f'interpolation-{st}-{tag}.png')
 # All three endpoint faces at four angles, common scale.
 for h,tag in [(295,'large'),(99,'native99')]:
  if not all((P/f'basic-{st}-1.00-{v}.png').exists() for st in cases for v in ['front','quarter','opposite','side']):continue
  cw=426 if h==295 else 164;ch=h+45;out=Image.new('RGB',(4*cw,len(cases)*ch),BG);d=ImageDraw.Draw(out)
  for ri,st in enumerate(cases):
   for ci,v in enumerate(['front','quarter','opposite','side']):
    c=placed(Image.open(P/f'basic-{st}-1.00-{v}.png'),h);x=ci*cw+(cw-c.width)//2;y=ri*ch+12;out.paste(c,(x,y),c);d.text((ci*cw+8,y+h+8),f'{st}  {v}',font=font if h==295 else small,fill=(50,48,46))
  out.save(P/f'endpoints-fourviews-{tag}.png')
