from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,numpy as np,hashlib
P=Path(__file__).resolve().parent;ids=['R0','A7','N3','05','S2'];items={};meta={}
fontpath='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
def crop(im):
 a=np.asarray(im);r,g,b=[a[:,:,i].astype(int) for i in range(3)];y,x=np.where((r>g+22)&(r>b+12)&(r>110)&(a[:,:,3]>30));box=[int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1)];h=box[3]-box[1];return im.crop((max(0,box[0]-10),max(0,box[1]-10),min(im.width,box[2]+10),min(im.height,box[3]+10))),h,box
master=Image.open(P/'master-02.png').convert('RGBA')
for i,id in enumerate(ids):
 c=i%3;r=i//3;im=master.crop((round(c*master.width/3),round(r*master.height/2),round((c+1)*master.width/3),round((r+1)*master.height/2)));new=crop(im);items[(id,'new')]=new;meta[id]={'masterCell':i,'newBodyBBox':new[2],'newBodyHeight':new[1]}
for height,kind in [(99,'native99'),(240,'large')]:
 cw=round(height*1.65);ch=height+60;f=ImageFont.truetype(fontpath,15 if height==99 else 22)
 # New-only board carries IDs, no semantic captions.
 out=Image.new('RGB',(cw*5,ch),(240,238,235));d=ImageDraw.Draw(out)
 for ci,id in enumerate(ids):
  im,h,b=items[(id,'new')];q=height/h;im=im.resize((round(im.width*q),round(im.height*q)),Image.Resampling.LANCZOS);out.paste(im,(ci*cw+(cw-im.width)//2,8),im);d.text((ci*cw+cw/2,height+28),id,font=f,anchor='mt',fill=(35,35,35))
 out.save(P/f'new-five-{kind}.png')
