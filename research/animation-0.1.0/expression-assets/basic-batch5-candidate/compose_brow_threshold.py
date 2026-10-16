from compose_batch5 import P,BG,font,small,placed
from PIL import Image,ImageDraw
for h,tag in [(295,'large'),(99,'native99')]:
 cw=426 if h==295 else 164;ch=h+45;out=Image.new('RGB',(4*cw,4*ch),BG);d=ImageDraw.Draw(out)
 for ri,(st,v) in enumerate([(st,v) for st in ['S3','S5'] for v in ['front','quarter']]):
  for ci,t in enumerate([.12,.14,.1875,.25]):
   c=placed(Image.open(P/f'basic-{st}-{t:.2f}-{v}.png'),h);x=ci*cw+(cw-c.width)//2;y=ri*ch+12;out.paste(c,(x,y),c);d.text((ci*cw+8,y+h+8),f'{st} {v} {t:g}',font=font if h==295 else small,fill=(50,48,46))
 out.save(P/f'brow-threshold-{tag}.png')
