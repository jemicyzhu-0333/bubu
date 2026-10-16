from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import numpy as np,json
ROOT=Path(__file__).parent;P=ROOT/'_renders';BG=(239,236,232);samples=[.359375,.390625,.40625]
for h,tag in [(295,'large'),(99,'native99')]:
 cw=426 if h==295 else 164;ch=h+45;out=Image.new('RGB',(3*cw,2*ch),BG);d=ImageDraw.Draw(out);f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17 if h==295 else 12)
 for ri,v in enumerate(['front','quarter']):
  for ci,t in enumerate(samples):
   im=Image.open(P/f'basic-A7-{t:.2f}-{v}.png').convert('RGBA');a=np.array(im);yy,xx=np.where(a[:,:,3]>64);c=im.crop((xx.min(),yy.min(),xx.max()+1,yy.max()+1));c=c.resize((round(c.width*h/c.height),h),Image.Resampling.LANCZOS);x=ci*cw+(cw-c.width)//2;y=ri*ch+10;out.paste(c,(x,y),c);d.text((ci*cw+8,y+h+8),f'{v} {t:.6f}',font=f,fill=(50,48,46))
 out.save(P/f'highlight-pole-review-{tag}.png')
