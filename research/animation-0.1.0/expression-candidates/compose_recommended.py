from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import numpy as np,json,hashlib
P=Path(__file__).resolve().parent
spec=json.loads((P/'selection-and-crop-spec.json').read_text());items={e['id']:dict(e,path=str(P/e['path'])) for e in spec['entries']};rows=[(name,[items[id] if id else None for id in ids]) for name,ids in spec['rows']]
def get(e):
 im=Image.open(e['path']).convert('RGBA')
 if e.get('region') is not None:im=im.crop(e['region'])
 if e['cell'] is not None:
  cw=im.width/e['grid'][0];ch=im.height/e['grid'][1];c=e['cell']%e['grid'][0];rr=e['cell']//e['grid'][0];im=im.crop((round(c*cw),round(rr*ch),round((c+1)*cw),round((rr+1)*ch)))
 a=np.asarray(im);r,g,b=[a[:,:,i].astype(int) for i in range(3)];yy,xx=np.where((r>g+22)&(r>b+12)&(r>110)&(a[:,:,3]>30));box=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)];h=box[3]-box[1];box=[max(0,box[0]-10),max(0,box[1]-10),min(im.width,box[2]+10),min(im.height,box[3]+10)];return im.crop(box),h
fontpath='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';boldpath='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
for bodyh,name in [(220,'recommended-five-groups-large.png'),(99,'recommended-five-groups-native99.png')]:
 f=ImageFont.truetype(fontpath,22 if bodyh>100 else 15);small=ImageFont.truetype(fontpath,16 if bodyh>100 else 12);head=ImageFont.truetype(boldpath,26 if bodyh>100 else 18)
 cw=round(bodyh*1.65);rowh=bodyh+103;titleh=85;left=26;out=Image.new('RGB',(cw*4+left*2,rowh*5+titleh+40),(240,238,235));d=ImageDraw.Draw(out)
 d.text((left,12),'五组表情 · 精简评审',font=head,fill=(40,40,40));d.text((left,49),'原样引用已批脸；其余为生图参考候选，尚未迁移 3D。',font=small,fill=(80,80,80))
 for ri,(group,items) in enumerate(rows):
  top=titleh+ri*rowh;d.line((left,top-6,out.width-left,top-6),fill=(202,198,192));d.text((left,top),group,font=f,fill=(55,55,55))
  for ci,item in enumerate(items):
   x=left+ci*cw;y=top+35
   if item is None:
    txt='害羞暂缺清楚的独立脸\n后续用回避注视 / 动作验证' if ri==2 else '近义强度已合并\n不按数量硬凑构型'
    d.multiline_text((x+12,y+bodyh*.40),txt,font=small,fill=(110,110,110),spacing=8);continue
   im,h=get(item);q=bodyh/h;im=im.resize((round(im.width*q),round(im.height*q)),Image.Resampling.LANCZOS);out.paste(im,(x+(cw-im.width)//2,y),im)
   d.text((x+cw/2,y+bodyh+14),item['id']+'  '+item['meaning'],font=f,anchor='mt',fill=(40,40,40));d.text((x+cw/2,y+bodyh+42),'已批 · 原图引用' if item['approved'] else '参考候选',font=small,anchor='mt',fill=(60,115,90) if item['approved'] else (110,85,65))
 out.save(P/name)
flat=[a for _,row in rows for a in row if a]
for a in flat:a['sourceSHA256']=hashlib.sha256(Path(a['path']).read_bytes()).hexdigest()
for a in flat:a['path']=str(Path(a['path']).relative_to(P))
(P/'recommended-manifest.json').write_text(json.dumps({'status':'reference candidate set awaiting user selection','rowOrder':[x[0] for x in rows],'entries':flat,'totalImages':len(flat),'approvedQuotedImages':sum(a['approved'] for a in flat),'newOrPriorUnapprovedReferences':sum(not a['approved'] for a in flat),'merged':['D1/D2','N3/N4','P1/P2','P3/P4 with S2 potential shared warm face','T2/T3 focus/preparation','T6/S5/S6 sadness','S3/S4 worry'],'unresolved':['D3 not reliably awake-drowsy at99px','shy not yet distinct without gaze/acting','request not guaranteed by static face','focus and determination share face; serious possible'],'processing':'Only source crops, uniform resize, alpha composite and labels. No repainted face pixels or body migration.'},indent=2,ensure_ascii=False))
