import os
from pathlib import Path
from PIL import Image,ImageDraw
import json,math,hashlib
O=Path(__file__).resolve().parent;P=Path(os.environ['DANGO_CANONICAL_PACKAGE']);source=O/'masters/run-contact-study-v3.png';im=Image.open(source).convert('RGBA');(O/'feet').mkdir(exist_ok=True);(O/'source-crops').mkdir(exist_ok=True)
S=73.025641/465
palette=[(248,104,120),(248,128,128),(240,80,104),(26,27,38)]
specs=[
('near-support','near',[385.5,439.5],[(327,417),(430,417),(448,436),(448,466),(437,482),(425,494),(333,494),(314,478),(312,439)],'loaded sole, top-left'),
('far-reach','far',[562.5,405.5],[(547,396),(615,396),(633,396),(657,395),(669,418),(654,443),(630,459),(590,477),(550,477),(531,464),(518,437),(518,410)],'forward lifted, top-left'),
('near-reach','near',[1019.5,414.5],[(971,390),(1002,387),(1041,403),(1056,423),(1056,450),(1041,479),(981,482),(945,461),(925,442),(925,414)],'forward lifted, top-right'),
('far-support','far',[1191.5,439.5],[(1138,419),(1233,419),(1255,439),(1255,469),(1240,484),(1229,494),(1141,494),(1127,480),(1126,442)],'loaded sole, top-right'),
('near-recovery','near',[394.5,850.5],[(335,831),(389,831),(421,851),(432,873),(432,898),(414,922),(368,925),(334,905),(310,897),(298,877),(298,852)],'raised oblique, bottom-left'),
('far-recovery','far',[568.5,860.5],[(556,843),(611,837),(636,853),(652,865),(651,892),(627,906),(600,918),(562,923),(543,911),(532,892),(532,872)],'raised shallow oblique, bottom-left'),
('near-trailing','near',[1015.5,859.5],[(956,841),(1028,841),(1058,861),(1067,885),(1054,915),(1029,934),(989,933),(968,913),(945,901),(940,875)],'raised rearward rounded, bottom-right'),
('far-forward','far',[1224.5,841.5],[(1210,825),(1263,825),(1289,825),(1318,825),(1330,851),(1325,874),(1301,891),(1276,905),(1233,918),(1208,910),(1194,891),(1190,865),(1192,840)],'raised forward oblique, bottom-right')]
records=[]
for name,side,root,polygon,observed in specs:
 mask=Image.new('L',im.size);ImageDraw.Draw(mask).polygon(polygon,fill=255)
 crop=(min(x for x,y in polygon),min(y for x,y in polygon),max(x for x,y in polygon)+1,max(y for x,y in polygon)+1)
 cut=im.crop(crop);ma=mask.crop(crop);alpha=cut.getchannel('A');alpha=Image.eval(alpha,lambda a:255 if a>=200 else 0)
 import PIL.ImageChops
 alpha=PIL.ImageChops.multiply(alpha,ma);cut.putalpha(alpha);cut.save(O/'source-crops'/f'{name}.png');ma.save(O/'source-crops'/f'{name}-mask.png')
 rt=[math.ceil((root[k]-crop[k])*S)+3.5 for k in [0,1]];size=[math.ceil((crop[k+2]-root[k])*S+rt[k])+3 for k in [0,1]];out=Image.new('RGBA',size)
 for y in range(size[1]):
  for x in range(size[0]):
   sx=math.floor((x+.5-rt[0])/S+root[0]);sy=math.floor((y+.5-rt[1])/S+root[1]);
   if 0<=sx<im.width and 0<=sy<im.height and mask.getpixel((sx,sy)) and im.getpixel((sx,sy))[3]>=200:
    rgb=im.getpixel((sx,sy))[:3];col=min(palette,key=lambda p:sum((a-b)**2 for a,b in zip(rgb,p)));out.putpixel((x,y),(*col,255))
 pix=[(x,y) for y in range(size[1]) for x in range(size[0]) if out.getpixel((x,y))[3]];my=max(y for x,y in pix);bottom=[x for x,y in pix if y==my];sole=[min(bottom,key=lambda x:abs(x+.5-rt[0]))+.5,my+.5]
 f=O/'feet'/f'{name}.png';out.save(f);out.resize((size[0]*8,size[1]*8),Image.Resampling.NEAREST).save(O/'feet'/f'{name}@8x.png')
 pivot=out.copy();pd=ImageDraw.Draw(pivot);pd.point(tuple(int(v) for v in rt),fill=(0,255,0,255));pd.point(tuple(int(v) for v in sole),fill=(0,128,255,255));pivot.save(O/'feet'/f'{name}.pivot.png')
 records.append({'pivot':f'feet/{name}.pivot.png','id':name,'sideRole':side,'observedPose':observed,'src':f'feet/{name}.png','productionSrc':f'feet/{name}@8x.png','sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'source':'masters/run-contact-study-v3.png','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'polygon':polygon,'crop':crop,'sourceRootCenter':root,'root':rt,'sole':sole,'soleRole':'lowest observed opaque pixel center, not proof of support in original panel','bounds':out.getbbox(),'size':size,'scaleArtPerSourcePixel':S,'inverseSamplingMatrix':[[1/S,0,root[0]-rt[0]/S],[0,1/S,root[1]-rt[1]/S]],'pixelEdits':[]})
meta={'diagnosticPivots':{'root':'#00ff00','sole':'#0080ff','role':'diagnostic only, not production palette'},'sourceMasksNote':'Two far proximal upper boundaries exclude original torso contour; no per-pixel silhouette replacement.','software':{'pythonPillow':Image.__version__},'schema':'dango-gait-source/1','status':'candidate extracted anatomy; runtime grounding separately authored','palette':palette,'alphaPolicy':'explicit anatomical polygon intersected with source alpha >=200; faint glow/antialias excluded by alpha, never RGB color key','productionScale':8,'view':'three-quarter-right','bodyScaleAudit':{'canonicalBodyWidthArt':73.025641,'sourceTorsoWidthPixels':465,'scale':S,'method':'shared nominal torso width from actual four panels near maximum torso extent, excluding hands; same scale for all eight feet','uncertaintySourcePixels':8},'frames':records}
(O/'gait-source.json').write_text(json.dumps(meta,indent=2)+'\n')
sheet=Image.new('RGB',(4*230,2*210),'#f1f3ee');d=ImageDraw.Draw(sheet)
for i,r in enumerate(records):
 a=Image.open(O/r['src']);a=a.resize((a.width*6,a.height*6),Image.Resampling.NEAREST);x=i%4*230;y=i//4*210;sheet.paste(a,(x+5,y+25),a);d.text((x+5,y+5),r['id'],fill='#1a1b26')
sheet.save(O/'extracted-feet-review.png')
print([(r['id'],r['size'],r['bounds'],r['root'],r['sole'])for r in records])
