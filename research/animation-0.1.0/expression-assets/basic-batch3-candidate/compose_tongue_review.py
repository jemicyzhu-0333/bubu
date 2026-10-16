from PIL import Image,ImageDraw
from pathlib import Path
from compose_batch3 import placed,BG,font,small
P=Path(__file__).parent
for h,tag in [(295,'large'),(99,'native99')]:
 cw=426 if h==295 else 164;ch=h+45;o=Image.new('RGB',(4*cw,2*ch),BG);d=ImageDraw.Draw(o)
 for ri,v in enumerate(['front','quarter']):
  for ci,t in enumerate([.49,.51,.55,.625]):
   c=placed(Image.open(P/f'basic-N3-{t:.2f}-{v}.png'),h);x=ci*cw+(cw-c.width)//2;y=ri*ch+12;o.paste(c,(x,y),c);d.text((ci*cw+8,y+h+8),f'N3 {t:g} {v}',font=font if h==295 else small,fill=(50,48,46))
 o.save(P/f'tongue-threshold-{tag}.png')
# Actual full side renders, identical camera/light. Magnified face crop is diagnostic.
o=Image.new('RGB',(828,550),BG);d=ImageDraw.Draw(o)
for i,f in enumerate([P/'diagnostics/pre-rim/basic-N3-1.00-side.png',P/'basic-N3-1.00-side.png']):
 im=Image.open(f).convert('RGBA');o.paste(im,(414*i,24),im);d.text((414*i+15,4),'before depth' if i==0 else 'after depth',fill=(45,43,41),font=font);crop=im.crop((305,180,345,245)).resize((100,162));o.paste(crop,(414*i+157,378),crop)
o.save(P/'mouth-rim-before-after-side.png')
