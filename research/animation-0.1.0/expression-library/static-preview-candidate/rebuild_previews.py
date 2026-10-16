from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFont
P=Path(__file__).resolve().parent;ROOT=P.parent;BG=(239,236,232)
coverage=json.loads((P/'coverage.json').read_text());rows={r['assetStateID']:r for r in coverage['rows']}
groups=[('Daily / low energy',['R0','D1','A7','D4']),('Attention / surprise',['01','N2','N3','T05']),('Positive',['07','P2','08']),('Task / effort',['A4','04','A8']),('Social / sadness',['S2','S3','T5','S5'])]
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',12)
def source(st,view):
 return P/'inputs'/f'{st}-{view}.png'
def placed(im,h):
 a=np.array(im.convert('RGBA'));y,x=np.where(a[:,:,3]>64);im=im.crop((x.min(),y.min(),x.max()+1,y.max()+1));return im.resize((round(im.width*h/im.height),h),Image.Resampling.LANCZOS)
manifest=[]
for view in ['front']:
 for h,tag in [(99,'native99'),(295,'large')]:
  cw=170 if h==99 else 426;ch=h+66;out=Image.new('RGB',(4*cw,5*ch+40),BG);d=ImageDraw.Draw(out);d.text((12,10),f'Actual 3D static library candidate | {view} |18 reference slots',font=small if h==99 else font,fill=(45,43,41))
  for ri,(group,states) in enumerate(groups):
   d.text((12,40+ri*ch),group,font=small if h==99 else font,fill=(75,72,68))
   for ci,st in enumerate(states):
    p=source(st,view);c=placed(Image.open(p),h);x=ci*cw+(cw-c.width)//2;y=40+ri*ch+25;out.paste(c,(x,y),c);d.text((ci*cw+12,y+h+7),st,font=small if h==99 else font,fill=(45,43,41))
    if h==99:manifest.append({'state':st,'view':view,'sourceFrame':str(p.relative_to(P)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'status':rows[st]['status']})
  out.save(P/f'library18-{view}-{tag}.png')
# One compact, unlabelled sheet for genuine adjacent-face comparison.
out=Image.new('RGB',(6*160,3*130),BG)
order=[s for _,states in groups for s in states]
for i,st in enumerate(order):
 c=placed(Image.open(source(st,'front')),99);out.paste(c,((i%6)*160+(160-c.width)//2,(i//6)*130+15),c)
out.save(P/'library18-blind-native99.png')
(P/'preview-provenance.json').write_text(json.dumps({'type':'composition of actual independently rendered 3D frames, not new AI art','sameApprovedBody':True,'sameFrozenLook':True,'dynamicApproval':False,'frames':manifest,'blindOrder':order},indent=2))
